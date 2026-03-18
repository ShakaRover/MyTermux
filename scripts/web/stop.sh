#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/../lib/common.sh"

mytermux_try_load_env || true
mytermux_ensure_config_dir

WEB_PID_FILE="${MYTERMUX_CONFIG_DIR}/web.pid"

if [[ ! -f "$WEB_PID_FILE" ]]; then
  echo "[web] 未发现 PID 文件，视为未运行"
  exit 0
fi

pid="$(cat "$WEB_PID_FILE" 2>/dev/null || true)"
if [[ -z "$pid" ]]; then
  rm -f "$WEB_PID_FILE"
  echo "[web] PID 文件为空，已清理"
  exit 0
fi

if ! kill -0 "$pid" 2>/dev/null; then
  rm -f "$WEB_PID_FILE"
  echo "[web] 进程不存在，已清理旧 PID 文件"
  exit 0
fi

echo "[web] 正在停止 (PID: ${pid})"
# 优先按进程组停止，确保 pnpm/vite 子进程一并退出
kill -TERM "-${pid}" 2>/dev/null || kill "$pid" 2>/dev/null || true

for _ in $(seq 1 30); do
  if ! kill -0 "$pid" 2>/dev/null; then
    rm -f "$WEB_PID_FILE"
    echo "[web] 已停止"
    exit 0
  fi
  sleep 0.1
done

echo "[web] 进程未响应，执行强制停止"
kill -9 "-${pid}" 2>/dev/null || kill -9 "$pid" 2>/dev/null || true
rm -f "$WEB_PID_FILE"
echo "[web] 已强制停止"
