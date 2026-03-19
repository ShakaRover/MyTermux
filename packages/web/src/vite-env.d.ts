/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Server 地址（兼容旧变量：VITE_RELAY_URL） */
  readonly VITE_SERVER_URL?: string;
  /** 兼容旧变量 */
  readonly VITE_RELAY_URL?: string;
  /** Web -> Server 链接 token（对应 MYTERMUX_WEB_LINK_TOKEN） */
  readonly VITE_MYTERMUX_WEB_LINK_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
