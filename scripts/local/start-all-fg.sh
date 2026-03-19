#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

cleanup() {
  bash "${ROOT_DIR}/scripts/daemon/stop.sh" || true
  bash "${ROOT_DIR}/scripts/server/stop.sh" || true
}

trap cleanup EXIT INT TERM

bash "${ROOT_DIR}/scripts/server/start-bg.sh"

# shellcheck disable=SC1091
source "${ROOT_DIR}/scripts/lib/common.sh"
mytermux_load_env
SERVER_HOST="${SERVER_HOST:-127.0.0.1}"
SERVER_PORT="${SERVER_PORT:-62200}"
echo "[local] 等待 Server 健康检查就绪..."
if ! mytermux_wait_http_ready "http://${SERVER_HOST}:${SERVER_PORT}/health" 30; then
  echo "[local] Server 未在预期时间内就绪"
  exit 1
fi

echo "[local] Server 已就绪，启动 Daemon（前台）..."
bash "${ROOT_DIR}/scripts/daemon/start-fg.sh"
