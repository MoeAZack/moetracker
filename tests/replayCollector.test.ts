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
});
