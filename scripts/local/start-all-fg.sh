#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

cleanup() {
  bash "${ROOT_DIR}/scripts/web/stop.sh" || true
  bash "${ROOT_DIR}/scripts/daemon/stop.sh" || true
  bash "${ROOT_DIR}/scripts/relay/stop.sh" || true
}

trap cleanup EXIT INT TERM

bash "${ROOT_DIR}/scripts/relay/start-bg.sh"

# shellcheck disable=SC1091
source "${ROOT_DIR}/scripts/lib/common.sh"
mytermux_load_env
RELAY_HOST="${RELAY_HOST:-127.0.0.1}"
RELAY_PORT="${RELAY_PORT:-62200}"
echo "[local] 等待 Relay 健康检查就绪..."
if ! mytermux_wait_http_ready "http://${RELAY_HOST}:${RELAY_PORT}/health" 30; then
  echo "[local] Relay 未在预期时间内就绪"
  exit 1
fi

bash "${ROOT_DIR}/scripts/daemon/start-bg.sh"
bash "${ROOT_DIR}/scripts/web/start-fg.sh"
