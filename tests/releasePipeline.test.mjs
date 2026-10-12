import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertCandidateTraffic, assertPromotedTraffic, exactTrafficMap, validateReleasePolicy } from '../scripts/release/policy.mjs';
import { smokeDeployment, smokeStaticHosting } from '../scripts/release/smoke.mjs';

const sha = 'a'.repeat(40);
const validPolicy = {
  acceptedSha: sha,
  checkoutSha: sha,
  mainSha: sha,
  isMainAncestor: true,
  reviewUrl: 'https://github.com/MoeAZack/moetracker/pull/3#issuecomment-123',
  reviewAccepted: 'true',
  githubRepository: 'MoeAZack/moetracker',
  githubRepositoryId: '1300351996',
  githubOwnerId: '279140809',
  githubRef: 'refs/heads/main',
  githubEventName: 'workflow_dispatch',
  githubWorkflowRef: 'MoeAZack/moetracker/.github/workflows/deploy-once.yml@refs/heads/main',
  workloadIdentityProvider: 'projects/329619434756/locations/global/workloadIdentityPools/github/providers/moetracker',
  deployServiceAccount: 'deploy@moetracker-raad.iam.gserviceaccount.com',
  buildServiceAccount: 'build@moetracker-raad.iam.gserviceaccount.com',
  runtimeServiceAccount: 'runtime@moetracker-raad.iam.gserviceaccount.com',
  projectId: 'moetracker-raad',
};

describe('release input policy', () => {
  it('accepts only the exact current main SHA with review attestation and separate identities', () => {
    expect(validateReleasePolicy(validPolicy)).toMatchObject({ acceptedSha: sha });
    for (const override of [
      { acceptedSha: 'main' },
      { checkoutSha: 'b'.repeat(40) },
      { mainSha: 'b'.repeat(40) },
      { isMainAncestor: false },
      { reviewAccepted: 'false' },
      { reviewUrl: 'https://example.invalid/review' },
      { githubRepositoryId: '999' },
      { githubRef: 'refs/heads/feature' },
      { githubWorkflowRef: 'MoeAZack/moetracker/.github/workflows/other.yml@refs/heads/main' },
      { workloadIdentityProvider: '' },
      { runtimeServiceAccount: validPolicy.buildServiceAccount },
    ]) expect(() => validateReleasePolicy({ ...validPolicy, ...override })).toThrow();
  });

  it('requires an exact named prior traffic map and a zero-percent candidate', () => {
    expect(exactTrafficMap({ status: { traffic: [{ revisionName: 'old-a', percent: 80 }, { revisionName: 'old-b', percent: 20 }] } })).toBe('old-a=80,old-b=20');
    expect(() => exactTrafficMap({ status: { traffic: [{ latestRevision: true, percent: 100 }] } })).toThrow();
    const candidate = { status: { traffic: [{ tag: 'candidate-aaa', revisionName: 'new-a', percent: 0, url: 'https://candidate.example' }] } };
    expect(assertCandidateTraffic(candidate, 'new-a', 'candidate-aaa')).toBe('https://candidate.example');
    expect(() => assertCandidateTraffic({ status: { traffic: [{ ...candidate.status.traffic[0], percent: 1 }] } }, 'new-a', 'candidate-aaa')).toThrow();
    expect(() => assertCandidateTraffic({ status: { traffic: [candidate.status.traffic[0], { revisionName: 'new-a', percent: 100 }] } }, 'new-a', 'candidate-aaa')).toThrow();
    expect(() => assertPromotedTraffic({ status: { traffic: [{ revisionName: 'other', percent: 100 }] } }, 'new-a')).toThrow();
  });
});

describe('unauthenticated production smoke', () => {
  it('checks exact build identity, public config shape, auth denials, and artifact denials', async () => {
    const fetchMock = async url => {
      const route = new URL(url).pathname;
      if (route === '/api/health') return new Response(JSON.stringify({ status: 'ok', build: sha }), { status: 200 });
      if (route === '/api/config') return new Response(JSON.stringify({ googleEnabled: false, googleClientId: '' }), { status: 200 });
      if (['/api/data', '/api/access', '/api/keys'].includes(route)) return new Response('{}', { status: 401, headers: { 'cache-control': 'no-store' } });
      return new Response('', { status: 404 });
    };
    await expect(smokeDeployment('https://candidate.example', sha, fetchMock)).resolves.toMatchObject({ build: sha });
  });

  it('fails closed on a wrong SHA, an unexpected public config field, or an auth leak', async () => {
    const baseFetch = async url => {
      const route = new URL(url).pathname;
      if (route === '/api/health') return new Response(JSON.stringify({ status: 'ok', build: sha }), { status: 200 });
      if (route === '/api/config') return new Response(JSON.stringify({ googleEnabled: false, googleClientId: '', secret: true }), { status: 200 });
      return new Response('{}', { status: 200 });
    };
    await expect(smokeDeployment('https://candidate.example', 'b'.repeat(40), baseFetch)).rejects.toThrow('accepted build SHA');
    await expect(smokeDeployment('https://candidate.example', sha, baseFetch)).rejects.toThrow('unexpected field');
  });
});

describe('Firebase static artifact smoke', () => {
  it('matches the built index and every referenced asset, failing on stale content', async () => {
    const distDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'moetracker-release-'));
    await fsp.mkdir(path.join(distDir, 'assets'));
    const index = '<!doctype html><script type="module" src="/assets/app-123.js"></script><link rel="stylesheet" href="/assets/app-123.css">';
    const files = new Map([
      ['/index.html', index],
      ['/assets/app-123.js', 'console.log("current")'],
      ['/assets/app-123.css', 'body{color:white}'],
    ]);
    await Promise.all([...files].map(async ([route, body]) => {
      const target = path.join(distDir, ...route.split('/').filter(Boolean));
      await fsp.writeFile(target, body);
    }));
    const fetchFiles = async url => new Response(files.get(new URL(url).pathname) ?? '', { status: files.has(new URL(url).pathname) ? 200 : 404 });

    try {
      await expect(smokeStaticHosting('https://moetracker.web.app', distDir, fetchFiles)).resolves.toMatchObject({ assets: [{ path: '/assets/app-123.js' }, { path: '/assets/app-123.css' }] });
      const staleIndex = async url => new Response(new URL(url).pathname === '/index.html' ? '<html>stale</html>' : files.get(new URL(url).pathname) ?? '', { status: 200 });
      await expect(smokeStaticHosting('https://moetracker.web.app', distDir, staleIndex)).rejects.toThrow('index does not match');
      const staleAsset = async url => new Response(new URL(url).pathname === '/assets/app-123.js' ? 'stale' : files.get(new URL(url).pathname) ?? '', { status: 200 });
      await expect(smokeStaticHosting('https://moetracker.web.app', distDir, staleAsset)).rejects.toThrow('asset /assets/app-123.js does not match');
    } finally {
      await fsp.rm(distDir, { recursive: true, force: true });
    }
  });
});

describe('workflow contract', () => {
  it('is manual, keyless, action-pinned, candidate-first, and frontend-last', () => {
    const workflow = fs.readFileSync('.github/workflows/deploy-once.yml', 'utf8');
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('actions: read');
    expect(workflow).toContain('GH_TOKEN: ${{ github.token }}');
    expect(workflow).toContain('candidate_only:');
    expect(workflow).toContain('candidate_revision:');
    expect(workflow).not.toMatch(/\n\s+push:/);
    expect(workflow).toContain('workload_identity_provider:');
    expect(workflow).not.toContain('credentials_json:');
    expect(workflow).not.toMatch(/uses:\s+[^\s]+@v\d/);
    expect(workflow.indexOf('node scripts/release/preflight.mjs')).toBeLessThan(workflow.indexOf('google-github-actions/auth@'));
    expect(workflow.indexOf('node scripts/release/release.mjs')).toBeGreaterThan(workflow.indexOf('npm run check'));
    expect(fs.existsSync('.github/workflows/release.yml')).toBe(false);

    const preflight = fs.readFileSync('scripts/release/preflight.mjs', 'utf8');
    expect(preflight).toContain('/git/ref/heads/main');
    expect(preflight).toContain('/actions/workflows/ci.yml/runs?');
    expect(preflight).toContain("run.conclusion === 'success'");

    const release = fs.readFileSync('scripts/release/release.mjs', 'utf8');
    expect(release.indexOf("'--no-traffic'")).toBeLessThan(release.indexOf('promoted = true'));
    expect(release.indexOf('promoted = true')).toBeLessThan(release.indexOf('firebase-tools@'));
    expect(release).toContain('--build-service-account=');
    expect(release).toContain('--service-account=');
    expect(release).toContain('restoreHosting');
    expect(release).toContain('restoreTraffic');
    expect(release).toContain('candidate-verified');
    expect(release).toContain('promotion requires exact candidate revision');
    expect(release).toContain('smokeStaticHosting');
  });
});
