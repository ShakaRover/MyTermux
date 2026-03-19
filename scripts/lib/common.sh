#!/usr/bin/env bash

MYTERMUX_COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MYTERMUX_ROOT_DIR="$(cd "${MYTERMUX_COMMON_DIR}/../.." && pwd)"
MYTERMUX_CONFIG_DIR="${MYTERMUX_CONFIG_DIR:-${HOME}/.mytermux}"

mytermux_require_env_file() {
  local env_file="$1"
  if [[ ! -f "$env_file" ]]; then
    echo "未找到 ${env_file}，请先执行: cp .env.example .env 并填写配置"
    exit 1
  fi
}

mytermux_load_env() {
  local env_file="${MYTERMUX_ENV_FILE:-.env}"
  if [[ "$env_file" != /* ]]; then
    env_file="${MYTERMUX_ROOT_DIR}/${env_file}"
  fi
  mytermux_require_env_file "$env_file"

  set -a
  # shellcheck disable=SC1090
  source "$env_file"
  set +a

  export MYTERMUX_ACTIVE_ENV_FILE="$env_file"
}

mytermux_try_load_env() {
  local env_file="${MYTERMUX_ENV_FILE:-.env}"
  if [[ "$env_file" != /* ]]; then
    env_file="${MYTERMUX_ROOT_DIR}/${env_file}"
  fi
  if [[ ! -f "$env_file" ]]; then
    return 1
  fi

  set -a
  # shellcheck disable=SC1090
  source "$env_file"
  set +a

  export MYTERMUX_ACTIVE_ENV_FILE="$env_file"
  return 0
}

mytermux_force_local_no_tls() {
  export VITE_HTTPS=false
  unset TLS_CERT
  unset TLS_KEY
}

mytermux_ensure_config_dir() {
  mkdir -p "$MYTERMUX_CONFIG_DIR"
}

mytermux_wait_http_ready() {
  local url="$1"
  local timeout_sec="${2:-30}"
  local i=0
  while [[ "$i" -lt "$timeout_sec" ]]; do
    if command -v curl >/dev/null 2>&1; then
      if curl -fsS "$url" >/dev/null 2>&1; then
        return 0
      fi
    else
      if node -e "fetch(process.argv[1]).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" "$url" >/dev/null 2>&1; then
        return 0
      fi
    fi
    sleep 1
    i=$((i + 1))
  done
  return 1
}

mytermux_ensure_server_dist() {
  if [[ ! -f "${MYTERMUX_ROOT_DIR}/packages/server/dist/cli.js" ]]; then
    echo "[server] 未检测到 dist，先执行构建"
    (cd "$MYTERMUX_ROOT_DIR" && pnpm --filter @mytermux/server build)
  fi
}

mytermux_ensure_daemon_dist() {
  if [[ ! -f "${MYTERMUX_ROOT_DIR}/packages/daemon/dist/index.js" ]]; then
    echo "[daemon] 未检测到 dist，先执行构建"
    (cd "$MYTERMUX_ROOT_DIR" && pnpm --filter @mytermux/daemon build)
  fi
}
