#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/../lib/common.sh"

mytermux_try_load_env || true
RELAY_HOST="${RELAY_HOST:-127.0.0.1}"
RELAY_PORT="${RELAY_PORT:-62200}"

echo "[relay] 停止服务"
cd "$MYTERMUX_ROOT_DIR"
exec pnpm --filter @mytermux/relay exec node dist/cli.js stop --host "$RELAY_HOST" --port "$RELAY_PORT"
