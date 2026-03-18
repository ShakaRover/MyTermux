#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

bash "${ROOT_DIR}/scripts/web/stop.sh" || true
bash "${ROOT_DIR}/scripts/daemon/stop.sh" || true
bash "${ROOT_DIR}/scripts/relay/stop.sh" || true

echo "[local] relay/daemon/web 已停止"
