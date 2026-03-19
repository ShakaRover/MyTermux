#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "[relay] 脚本已弃用，请改用 scripts/server/start-bg.sh"
exec bash "${SCRIPT_DIR}/../server/start-bg.sh" "$@"
