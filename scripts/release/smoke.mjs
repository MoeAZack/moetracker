#!/usr/bin/env node

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

if (import.meta.url === `file://${process.argv[1]}`) {
  smokeDeployment(process.argv[2] || '', process.argv[3] || '')
    .then(result => console.log(JSON.stringify(result)))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
