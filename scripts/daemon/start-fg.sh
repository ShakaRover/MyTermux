#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/../lib/common.sh"

mytermux_load_env
mytermux_force_local_no_tls
mytermux_ensure_daemon_dist

RELAY_HOST="${RELAY_HOST:-127.0.0.1}"
RELAY_PORT="${RELAY_PORT:-62200}"
RELAY_URL="${RELAY_URL:-ws://${RELAY_HOST}:${RELAY_PORT}}"
DAEMON_HOST="${DAEMON_HOST:-127.0.0.1}"
DAEMON_PORT="${DAEMON_PORT:-62300}"

daemon_args=(start -f --relay "$RELAY_URL" --listen-host "$DAEMON_HOST" --listen-port "$DAEMON_PORT")
if [[ -n "${MYTERMUX_DAEMON_LINK_TOKEN:-}" ]]; then
  daemon_args+=(--daemon-link-token "$MYTERMUX_DAEMON_LINK_TOKEN")
fi

echo "[daemon] 前台启动: relay=${RELAY_URL}, listen=http://${DAEMON_HOST}:${DAEMON_PORT}"
cd "$MYTERMUX_ROOT_DIR"
exec pnpm --filter @mytermux/daemon exec node dist/index.js "${daemon_args[@]}"
