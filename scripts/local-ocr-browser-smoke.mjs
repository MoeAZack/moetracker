import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { build } from 'esbuild';

const root = process.cwd();
const chromePaths = [
  process.env.LOCAL_OCR_BROWSER,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);

async function availablePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  server.close();
  await once(server, 'close');
  return port;
}

await build({
  entryPoints: [path.join(root, 'scripts', 'local-ocr-browser-smoke-entry.ts')],
  outfile: path.join(root, 'dist', 'ocr-worker-smoke.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
});
await writeFile(path.join(root, 'dist', 'ocr-worker-smoke.html'), '<!doctype html><html><body><script type="module" src="/ocr-worker-smoke.js"></script></body></html>');

const port = await availablePort();
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['build/server.cjs'], {
  cwd: root,
  env: {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(port),
    USE_FIRESTORE: 'false',
    ADMIN_PASSWORD: 'browser-smoke-admin-secret-123',
    JWT_SECRET: 'browser-smoke-jwt-secret-12345',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', chunk => { serverLog += String(chunk); });
server.stderr.on('data', chunk => { serverLog += String(chunk); });

let browser;
try {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/api/health`);
      if (response.ok) break;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const health = await fetch(`${origin}/api/health`);
  if (!health.ok) throw new Error(`Production server did not become healthy: ${serverLog.slice(-1000)}`);

  const executablePath = chromePaths.find(candidate => candidate && requireFile(candidate));
  if (!executablePath) throw new Error('No local Chrome/Edge executable found. Set LOCAL_OCR_BROWSER.');
  browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage();
  const externalRequests = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.origin !== origin) externalRequests.push(request.url());
  });
  const response = await page.goto(`${origin}/ocr-worker-smoke.html`, { waitUntil: 'domcontentloaded' });
  const csp = response?.headers()['content-security-policy'] || '';
  if (!csp.includes("worker-src 'self'") || !csp.includes("'wasm-unsafe-eval'") || csp.includes('blob:')) {
    throw new Error(`Unexpected production CSP: ${csp}`);
  }
  await page.waitForFunction(() => (window).__ocrWorkerSmoke?.status !== 'running', null, { timeout: 60_000 });
  const result = await page.evaluate(() => (window).__ocrWorkerSmoke);
  if (result?.status !== 'ok') throw new Error(`Worker initialization failed: ${result?.error || 'unknown error'}`);
  if (externalRequests.length > 0) throw new Error(`OCR worker made external requests: ${externalRequests.join(', ')}`);
  console.log('Local OCR production browser smoke passed: same-origin worker/core/lang initialized and terminated under CSP.');
} finally {
  await browser?.close();
  server.kill();
  await Promise.race([once(server, 'exit'), new Promise(resolve => setTimeout(resolve, 5_000))]);
  await Promise.all([
    rm(path.join(root, 'dist', 'ocr-worker-smoke.js'), { force: true }),
    rm(path.join(root, 'dist', 'ocr-worker-smoke.html'), { force: true }),
  ]);
}

function requireFile(candidate) {
  try {
    return process.getBuiltinModule('fs').existsSync(candidate);
  } catch {
    return false;
  }
}
