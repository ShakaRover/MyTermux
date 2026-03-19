/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Server WebSocket 地址（默认 /ws） */
  readonly VITE_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
