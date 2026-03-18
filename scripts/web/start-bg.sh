#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/../lib/common.sh"

mytermux_load_env
mytermux_force_local_no_tls
mytermux_ensure_config_dir

VITE_HOST="${VITE_HOST:-127.0.0.1}"
VITE_PORT="${VITE_PORT:-62100}"
WEB_PID_FILE="${MYTERMUX_CONFIG_DIR}/web.pid"
WEB_LOG_FILE="${MYTERMUX_CONFIG_DIR}/web.log"

if [[ -f "$WEB_PID_FILE" ]]; then
  old_pid="$(cat "$WEB_PID_FILE" 2>/dev/null || true)"
  if [[ -n "$old_pid" ]] && kill -0 "$old_pid" 2>/dev/null; then
    echo "[web] 已在运行 (PID: ${old_pid})"
    exit 0
  fi
  rm -f "$WEB_PID_FILE"
fi

cd "$MYTERMUX_ROOT_DIR"
nohup setsid pnpm --filter @mytermux/web exec vite --host "$VITE_HOST" --port "$VITE_PORT" --strictPort >> "$WEB_LOG_FILE" 2>&1 < /dev/null &
new_pid=$!
echo "$new_pid" > "$WEB_PID_FILE"

sleep 1
if ! kill -0 "$new_pid" 2>/dev/null; then
  echo "[web] 后台启动失败，请检查日志: $WEB_LOG_FILE"
  rm -f "$WEB_PID_FILE"
  exit 1
fi

echo "[web] 后台已启动 (PID: ${new_pid})"
echo "[web] 地址: http://${VITE_HOST}:${VITE_PORT}"
echo "[web] 日志: ${WEB_LOG_FILE}"
