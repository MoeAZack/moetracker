#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function cleanBaseUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:') throw new Error('smoke target must use HTTPS');
  url.pathname = url.pathname.replace(/\/$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

async function json(response, label) {
  const body = await response.json().catch(() => { throw new Error(`${label} did not return JSON`); });
  return body;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export async function smokeStaticHosting(baseUrl, distDir = 'dist', fetchImpl = fetch) {
  const base = cleanBaseUrl(baseUrl);
  const request = url => fetchImpl(url, {
    redirect: 'error',
    cache: 'no-store',
    headers: { 'Cache-Control': 'no-cache' },
    signal: AbortSignal.timeout(15_000),
  });
  const localIndex = await readFile(path.resolve(distDir, 'index.html'));
  const deployedIndexResponse = await request(`${base}/index.html?release-check=${Date.now()}`);
  if (deployedIndexResponse.status !== 200) throw new Error(`deployed index returned ${deployedIndexResponse.status}`);
  const deployedIndex = Buffer.from(await deployedIndexResponse.arrayBuffer());
  const expectedIndexHash = sha256(localIndex);
  if (sha256(deployedIndex) !== expectedIndexHash) throw new Error('deployed Firebase index does not match local dist/index.html');

  const references = [...localIndex.toString('utf8').matchAll(/(?:src|href)=["']([^"']+)["']/g)]
    .map(match => match[1])
    .filter(reference => new URL(reference, `${base}/`).pathname.startsWith('/assets/'));
  if (references.length === 0) throw new Error('local dist/index.html has no referenced assets to verify');

  const assets = [];
  for (const reference of [...new Set(references)]) {
    const assetUrl = new URL(reference, `${base}/`);
    const localAssetPath = path.resolve(distDir, `.${decodeURIComponent(assetUrl.pathname)}`);
    const relativeAssetPath = path.relative(path.resolve(distDir), localAssetPath);
    if (relativeAssetPath.startsWith('..') || path.isAbsolute(relativeAssetPath)) throw new Error('index contains an unsafe asset path');
    const localAsset = await readFile(localAssetPath);
    assetUrl.searchParams.set('release-check', String(Date.now()));
    const deployedAssetResponse = await request(assetUrl.toString());
    if (deployedAssetResponse.status !== 200) throw new Error(`${assetUrl.pathname} returned ${deployedAssetResponse.status}`);
    const deployedAsset = Buffer.from(await deployedAssetResponse.arrayBuffer());
    const expectedAssetHash = sha256(localAsset);
    if (sha256(deployedAsset) !== expectedAssetHash) throw new Error(`deployed Firebase asset ${assetUrl.pathname} does not match local dist`);
    assets.push({ path: assetUrl.pathname, sha256: expectedAssetHash });
  }

  return { baseUrl: base, indexSha256: expectedIndexHash, assets, checkedAt: new Date().toISOString() };
}

export async function smokeDeployment(baseUrl, expectedSha, fetchImpl = fetch) {
  const base = cleanBaseUrl(baseUrl);
  if (!/^[0-9a-f]{40}$/.test(expectedSha)) throw new Error('expected smoke SHA must be a lowercase 40-character commit SHA');
  const request = (url, options = {}) => fetchImpl(url, { ...options, signal: AbortSignal.timeout(15_000) });

  const healthResponse = await request(`${base}/api/health`, { redirect: 'error' });
  if (healthResponse.status !== 200) throw new Error(`health returned ${healthResponse.status}`);
  const health = await json(healthResponse, 'health');
  if (health.status !== 'ok' || health.build !== expectedSha) {
    throw new Error(`health did not report the accepted build SHA`);
  }

  const configResponse = await request(`${base}/api/config`, { redirect: 'error' });
  if (configResponse.status !== 200) throw new Error(`config returned ${configResponse.status}`);
  const config = await json(configResponse, 'config');
  const configKeys = Object.keys(config).sort();
  if (typeof config.googleEnabled !== 'boolean' || typeof config.googleClientId !== 'string') {
    throw new Error('public config has an invalid shape');
  }
  if (configKeys.some(key => !['googleClientId', 'googleEnabled'].includes(key))) {
    throw new Error('public config exposed an unexpected field');
  }

  for (const route of ['/api/data', '/api/access', '/api/keys']) {
    const response = await request(`${base}${route}`, { redirect: 'error' });
    if (response.status !== 401) throw new Error(`${route} allowed unauthenticated access (${response.status})`);
    if (response.headers.get('cache-control') !== 'no-store') throw new Error(`${route} auth denial is cacheable`);
  }

  const invalidBearer = await request(`${base}/api/data`, {
    redirect: 'error',
    headers: { Authorization: 'Bearer invalid-production-smoke-token' },
  });
  if (invalidBearer.status !== 401) throw new Error(`/api/data accepted an invalid bearer token (${invalidBearer.status})`);
  if (invalidBearer.headers.get('cache-control') !== 'no-store') throw new Error('/api/data invalid-token denial is cacheable');

  for (const route of ['/server.cjs', '/server.cjs.map', '/build/server.cjs', '/build/server.cjs.map']) {
    const response = await request(`${base}${route}`, { redirect: 'error' });
    if (response.status !== 404) throw new Error(`${route} returned ${response.status}, expected 404`);
  }

  return { baseUrl: base, build: expectedSha, checkedAt: new Date().toISOString() };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  smokeDeployment(process.argv[2] || '', process.argv[3] || '')
    .then(result => console.log(JSON.stringify(result)))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
