#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/../lib/common.sh"

mytermux_load_env
mytermux_force_local_no_tls
mytermux_ensure_daemon_dist

SERVER_HOST="${SERVER_HOST:-127.0.0.1}"
SERVER_PORT="${SERVER_PORT:-62200}"
SERVER_URL="${SERVER_URL:-ws://${SERVER_HOST}:${SERVER_PORT}}"
DAEMON_HOST="${DAEMON_HOST:-127.0.0.1}"
DAEMON_PORT="${DAEMON_PORT:-62300}"

daemon_args=(start --server "$SERVER_URL" --listen-host "$DAEMON_HOST" --listen-port "$DAEMON_PORT")
if [[ -n "${MYTERMUX_DAEMON_LINK_TOKEN:-}" ]]; then
  daemon_args+=(--daemon-link-token "$MYTERMUX_DAEMON_LINK_TOKEN")
fi

echo "[daemon] 后台启动: server=${SERVER_URL}, listen=http://${DAEMON_HOST}:${DAEMON_PORT}"
cd "$MYTERMUX_ROOT_DIR"
exec pnpm --filter @mytermux/daemon exec node dist/index.js "${daemon_args[@]}"
