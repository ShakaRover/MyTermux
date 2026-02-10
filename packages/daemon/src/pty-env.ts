/**
 * PTY 环境变量工具
 *
 * 为 node-pty 子进程提供正确的环境变量，
 * 确保 daemon 后台运行时 locale 不丢失
 */

/** 默认 UTF-8 locale 回退值（C.UTF-8 在绝大多数 Linux 系统上可用，包括 Alpine 等最小化发行版） */
const DEFAULT_UTF8_LOCALE = 'C.UTF-8';

/**
 * 创建 PTY 子进程的环境变量
 *
 * 在 process.env 基础上确保 UTF-8 locale 环境变量存在，
 * 防止 daemon 后台运行时继承空 locale 导致中文乱码。
 * 优先保留用户已有的 locale 设置，仅在缺失时回退到 C.UTF-8。
 */
export function createPtyEnv(): Record<string, string> {
  const lang = process.env['LANG'];
  const lcCtype = process.env['LC_CTYPE'];

  if (!lang || !lcCtype) {
    console.warn(
      `[pty-env] locale 环境变量缺失，使用回退值: ` +
      `LANG=${lang ?? DEFAULT_UTF8_LOCALE}${!lang ? ' (回退)' : ''}, ` +
      `LC_CTYPE=${lcCtype ?? DEFAULT_UTF8_LOCALE}${!lcCtype ? ' (回退)' : ''}`
    );
  }

  return {
    ...process.env,
    LANG: lang ?? DEFAULT_UTF8_LOCALE,
    LC_CTYPE: lcCtype ?? DEFAULT_UTF8_LOCALE,
  } as Record<string, string>;
}
