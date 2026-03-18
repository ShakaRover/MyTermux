#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/../lib/common.sh"

mytermux_load_env
mytermux_force_local_no_tls

VITE_HOST="${VITE_HOST:-127.0.0.1}"
VITE_PORT="${VITE_PORT:-62100}"

echo "[web] 前台启动: http://${VITE_HOST}:${VITE_PORT}"
cd "$MYTERMUX_ROOT_DIR"
exec pnpm --filter @mytermux/web exec vite --host "$VITE_HOST" --port "$VITE_PORT" --strictPort
