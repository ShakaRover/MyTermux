/**
 * @mycc/relay 中继服务器入口
 */

import { serve } from '@hono/node-server';
import { createServer } from './server';

const port = Number(process.env['PORT']) || 3000;

const app = createServer();

console.log(`MyCC Relay Server starting on port ${port}...`);

serve({
  fetch: app.fetch,
  port,
});

console.log(`MyCC Relay Server running at http://localhost:${port}`);
