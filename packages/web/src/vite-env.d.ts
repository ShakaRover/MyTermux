/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 中继服务器地址 */
  readonly VITE_RELAY_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
