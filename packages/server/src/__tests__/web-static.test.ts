import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from '../server';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

function createWebDistFixture(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mytermux-web-dist-'));
  tempDirs.push(tmpDir);

  fs.writeFileSync(path.join(tmpDir, 'index.html'), '<!doctype html><html><body>MyTermux Web</body></html>', 'utf8');
  fs.mkdirSync(path.join(tmpDir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'assets', 'app.js'), 'console.log("mytermux");', 'utf8');

  return tmpDir;
}

describe('Server 静态托管', () => {
  it('应返回 index.html 作为根页面与 SPA fallback', async () => {
    const webDistDir = createWebDistFixture();
    const app = createServer({ webDistDir });

    const rootResp = await app.request('/');
    expect(rootResp.status).toBe(200);
    expect(rootResp.headers.get('content-type')).toContain('text/html');
    expect(await rootResp.text()).toContain('MyTermux Web');

    const fallbackResp = await app.request('/sessions');
    expect(fallbackResp.status).toBe(200);
    expect(fallbackResp.headers.get('content-type')).toContain('text/html');
    expect(await fallbackResp.text()).toContain('MyTermux Web');
  });

  it('应正确返回静态资源并保留 API 路径语义', async () => {
    const webDistDir = createWebDistFixture();
    const app = createServer({ webDistDir });

    const assetResp = await app.request('/assets/app.js');
    expect(assetResp.status).toBe(200);
    expect(assetResp.headers.get('content-type')).toContain('text/javascript');
    expect(await assetResp.text()).toContain('console.log');

    const apiResp = await app.request('/api/info');
    expect(apiResp.status).toBe(200);
    const apiBody = await apiResp.json() as { name: string };
    expect(apiBody.name).toBe('MyTermux Server');

    const missingApiResp = await app.request('/api/not-exists');
    expect(missingApiResp.status).toBe(404);
  });
});
