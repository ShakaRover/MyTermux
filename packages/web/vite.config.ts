import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import tailwindcss from '@tailwindcss/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// 是否启用 HTTPS（远程部署时需要，因为 Web Crypto API 要求安全上下文）
const enableHttps = process.env.VITE_HTTPS === 'true';

// Server 地址（用于 /api 与 /ws 代理）
const relayTarget = process.env.VITE_SERVER_URL || process.env.VITE_RELAY_URL || 'ws://127.0.0.1:62200/ws';

// 从 ws(s)://host:port/path 中提取 http(s)://host:port
function extractProxyTarget(wsUrl: string): string {
  return wsUrl
    .replace(/^wss:/, 'https:')
    .replace(/^ws:/, 'http:')
    .replace(/\/ws\/?$/, '');
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // 自签名 HTTPS 证书（仅开发/测试用）
    ...(enableHttps ? [basicSsl()] : []),
  ],
  server: {
    // 支持通过环境变量配置 host 和 port
    host: process.env.VITE_HOST || '127.0.0.1',
    port: Number(process.env.VITE_PORT) || 62100,
    // 始终代理 /ws 与 /api，保证本地开发直连 Relay
    proxy: {
      '/ws': {
        target: extractProxyTarget(relayTarget),
        ws: true,
        changeOrigin: true,
      },
      '/api': {
        target: extractProxyTarget(relayTarget),
        changeOrigin: true,
      },
      '/health': {
        target: extractProxyTarget(relayTarget),
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
});
