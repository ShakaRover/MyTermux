#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/../lib/common.sh"

mytermux_try_load_env || true
mytermux_ensure_daemon_dist

token="${1:-${MYTERMUX_DAEMON_LINK_TOKEN:-}}"

cd "$MYTERMUX_ROOT_DIR"
if [[ "${token}" == "--clear" ]]; then
  echo "[daemon] 清空 MYTERMUX_DAEMON_LINK_TOKEN"
  exec pnpm --filter @mytermux/daemon exec node dist/index.js relay-token --clear
fi

if [[ -z "${token}" ]]; then
  echo "用法: bash scripts/daemon/set-relay-token.sh <token>"
  echo "或:   bash scripts/daemon/set-relay-token.sh --clear"
  exit 1
fi

echo "[daemon] 设置 MYTERMUX_DAEMON_LINK_TOKEN"
exec pnpm --filter @mytermux/daemon exec node dist/index.js relay-token --set "${token}"
