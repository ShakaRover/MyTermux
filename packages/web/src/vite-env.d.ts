/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 中继服务器地址 */
  readonly VITE_RELAY_URL: string;
  /** Web -> Relay 链接 token（对应 MYTERMUX_WEB_LINK_TOKEN） */
  readonly VITE_MYTERMUX_WEB_LINK_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
