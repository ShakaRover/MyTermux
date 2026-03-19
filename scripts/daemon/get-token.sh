#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/../lib/common.sh"

mytermux_try_load_env || true
mytermux_ensure_daemon_dist

echo "[daemon] 获取 MYTERMUX_DAEMON_TOKEN"
cd "$MYTERMUX_ROOT_DIR"
exec pnpm --filter @mytermux/daemon exec node dist/index.js token "$@"
