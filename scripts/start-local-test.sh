#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE="${MYTERMUX_ENV_FILE:-.env}"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "未找到 ${ENV_FILE}，请先执行: cp .env.example .env 并填写配置"
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

# 本地测试强制无证书
export VITE_HTTPS=false
unset TLS_CERT
unset TLS_KEY

RELAY_HOST="${RELAY_HOST:-127.0.0.1}"
RELAY_PORT="${RELAY_PORT:-62200}"
RELAY_URL="${RELAY_URL:-ws://127.0.0.1:${RELAY_PORT}}"
DAEMON_HOST="${DAEMON_HOST:-127.0.0.1}"
DAEMON_PORT="${DAEMON_PORT:-62300}"
VITE_HOST="${VITE_HOST:-127.0.0.1}"
VITE_PORT="${VITE_PORT:-62100}"

relay_pid=0
daemon_pid=0
web_pid=0

cleanup() {
  for pid in "$web_pid" "$daemon_pid" "$relay_pid"; do
    if [[ "$pid" -gt 0 ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done
}

trap cleanup EXIT INT TERM

wait_for_relay_ready() {
  local url="http://${RELAY_HOST}:${RELAY_PORT}/health"
  local i=0
  while [[ $i -lt 30 ]]; do
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

echo "[local-test] 使用环境文件: $ENV_FILE"
echo "[local-test] Relay:  http://${RELAY_HOST}:${RELAY_PORT}"
echo "[local-test] Daemon: http://${DAEMON_HOST}:${DAEMON_PORT}"
echo "[local-test] Web:    http://${VITE_HOST}:${VITE_PORT}"

if [[ ! -f "packages/relay/dist/cli.js" || ! -f "packages/daemon/dist/index.js" ]]; then
  echo "[local-test] 未检测到 dist，先执行构建"
  pnpm --filter @mytermux/relay build
  pnpm --filter @mytermux/daemon build
fi

pnpm --filter @mytermux/relay exec node dist/cli.js start -f --host "$RELAY_HOST" --port "$RELAY_PORT" &
relay_pid=$!

echo "[local-test] 等待 Relay 健康检查就绪..."
if ! wait_for_relay_ready; then
  echo "[local-test] Relay 未在预期时间内就绪，启动终止"
  exit 1
fi

daemon_args=(--relay "$RELAY_URL" --listen-host "$DAEMON_HOST" --listen-port "$DAEMON_PORT")
if [[ -n "${MYTERMUX_DAEMON_LINK_TOKEN:-}" ]]; then
  daemon_args+=(--daemon-link-token "$MYTERMUX_DAEMON_LINK_TOKEN")
fi
pnpm --filter @mytermux/daemon exec node dist/index.js start -f "${daemon_args[@]}" &
daemon_pid=$!

pnpm --filter @mytermux/web exec vite --host "$VITE_HOST" --port "$VITE_PORT" &
web_pid=$!

echo "[local-test] 组件已启动，按 Ctrl+C 可一键停止"
wait -n "$relay_pid" "$daemon_pid" "$web_pid"
echo "[local-test] 检测到子进程退出，正在停止其余组件"
