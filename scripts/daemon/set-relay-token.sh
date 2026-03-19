#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "[daemon] 脚本已弃用，请改用 scripts/daemon/set-server-token.sh"
exec bash "${SCRIPT_DIR}/set-server-token.sh" "$@"
