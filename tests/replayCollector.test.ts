import { describe, expect, it } from 'vitest';
import path from 'path';
import { collectorInternals } from '../scripts/replay-collector.mjs';

describe('Windows replay collector boundaries', () => {
  it('recognizes only files strictly inside an explicitly configured folder', () => {
    const folder = path.resolve('C:/approved-scoreboards');
    expect(collectorInternals.inside(path.join(folder, 'score.png'), folder)).toBe(true);
    expect(collectorInternals.inside(path.resolve(folder, '../private.png'), folder)).toBe(false);
    expect(collectorInternals.inside(folder, folder)).toBeFalsy();
  });

  it('ships the VALORANT default replay discovery location', () => {
    expect(collectorInternals.DEFAULT_DEMO.replace(/\\/g, '/')).toMatch(/(?:^|\/)VALORANT\/Saved\/Demos$/);
  });

  it('requires HTTPS except for explicit localhost development', () => {
    expect(collectorInternals.serverUrl('https://tracker.example')).toBe('https://tracker.example');
    expect(collectorInternals.serverUrl('http://localhost:3000')).toBe('http://localhost:3000');
    expect(() => collectorInternals.serverUrl('http://tracker.example')).toThrow(/HTTPS/);
    expect(() => collectorInternals.serverUrl('https://token@tracker.example')).toThrow(/credentials/);
  });

  it('disables redirects and fixes the credential-bearing request to the validated origin', () => {
    const request = collectorInternals.uploadRequest('https://tracker.example/base', 'a'.repeat(64), 'private-device-token', path.resolve('package.json'), 123, 'device-12345678');
    expect(request.endpoint).toBe(`https://tracker.example/api/replay-intake/uploads/${'a'.repeat(64)}`); expect(request.options).toMatchObject({ method: 'PUT', redirect: 'error' });
    expect((request.options.headers as Record<string, string>)['X-Device-Token']).toBe('private-device-token');
    (request.options.body as { destroy(): void }).destroy();
  });

  it('associates an explicitly approved local scoreboard with an exact replay hash', () => {
    const folder = path.resolve('C:/approved-scoreboards'); const file = path.join(folder, 'redacted-fixture.png');
    const approval = collectorInternals.scoreboardApproval(file, folder, 'a'.repeat(64), 'b'.repeat(64), '2026-10-12T00:00:00.000Z');
    expect(approval).toMatchObject({ replaySha256: 'a'.repeat(64), sha256: 'b'.repeat(64), status: 'local-ocr-review-required' });
    expect(() => collectorInternals.scoreboardApproval(file, folder, '', 'b'.repeat(64))).toThrow(/replay-sha256/);
  });

  it('migrates legacy configuration to local evidence without enabling raw fallback', () => {
    const migrated = collectorInternals.migrateConfig({ schemaVersion: 1, server: 'https://tracker.example', replayPaths: ['D:/Demos'], autoUpload: true });
    expect(migrated).toMatchObject({ schemaVersion: 2, ingestionMode: 'local-evidence', autoUpload: true, localRuntime: { binaryPath: '', pythonPath: '', normalizerPath: '' } });
    expect(collectorInternals.migrateConfig({ ingestionMode: 'coach-raw' }).ingestionMode).toBe('coach-raw');
  });

  it('resumes a GCS session after the last acknowledged byte', async () => {
    const prior = globalThis.fetch; globalThis.fetch = (async () => new Response(null, { status: 308, headers: { Range: 'bytes=0-4095' } })) as any;
    try { await expect(collectorInternals.resumableOffset({ uploadUrl: 'https://storage.googleapis.com/session-secret' }, 10_000)).resolves.toEqual({ complete: false, offset: 4096 }); }
    finally { globalThis.fetch = prior; }
  });

  it('treats a submitted review draft as terminal for collector upload', () => {
    expect(collectorInternals.collectorUploadComplete('submitted-review-required')).toBe(true);
    expect(collectorInternals.collectorUploadComplete('review-required')).toBe(false);
    expect(collectorInternals.collectorUploadComplete('processing-local')).toBe(false);
  });

  it('recognizes an already-completed resumable session', async () => {
    const prior = globalThis.fetch; globalThis.fetch = (async () => new Response(JSON.stringify({ generation: '7' }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as any;
    try { await expect(collectorInternals.resumableOffset({ uploadUrl: 'https://storage.googleapis.com/session-secret' }, 10_000)).resolves.toEqual({ complete: true, metadata: { generation: '7' } }); }
    finally { globalThis.fetch = prior; }
  });
});
