#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/../lib/common.sh"

mytermux_load_env
mytermux_force_local_no_tls
mytermux_ensure_server_dist

SERVER_HOST="${SERVER_HOST:-127.0.0.1}"
SERVER_PORT="${SERVER_PORT:-62200}"

echo "[server] 后台启动: http://${SERVER_HOST}:${SERVER_PORT}"
cd "$MYTERMUX_ROOT_DIR"
exec pnpm --filter @mytermux/relay exec node dist/cli.js start --host "$SERVER_HOST" --port "$SERVER_PORT"
