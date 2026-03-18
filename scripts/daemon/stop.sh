#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/../lib/common.sh"

mytermux_try_load_env || true

echo "[daemon] 停止服务"
cd "$MYTERMUX_ROOT_DIR"
exec pnpm --filter @mytermux/daemon exec node dist/index.js stop
