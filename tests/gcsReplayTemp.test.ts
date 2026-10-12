import { afterEach, describe, expect, it, vi } from 'vitest';
import { cancelRawReplayUpload, rawReplayConfig } from '../lib/gcsReplayTemp';

afterEach(() => vi.unstubAllEnvs());

describe('coach raw replay configuration gate', () => {
  it('fails closed until the dedicated bucket is explicitly enabled', () => {
    vi.stubEnv('REPLAY_RAW_GCS_ENABLED', 'false');
    expect(() => rawReplayConfig()).toThrow('disabled');
  });

  it('bounds session lifetime and rejects unsafe bucket names', () => {
    vi.stubEnv('REPLAY_RAW_GCS_ENABLED', 'true'); vi.stubEnv('REPLAY_RAW_GCS_BUCKET', 'Replay Bucket');
    expect(() => rawReplayConfig()).toThrow('configured safely');
    vi.stubEnv('REPLAY_RAW_GCS_BUCKET', 'moetracker-replay-temp-cairo'); vi.stubEnv('REPLAY_RAW_SESSION_TTL_MINUTES', '30');
    expect(rawReplayConfig()).toEqual({ bucket: 'moetracker-replay-temp-cairo', ttlMinutes: 30 });
    vi.stubEnv('REPLAY_RAW_SESSION_TTL_MINUTES', '1440'); expect(() => rawReplayConfig()).toThrow('5–60');
  });

  it('cancels only a storage resumable bearer URI without logging it', async () => {
    const prior = globalThis.fetch; const request = vi.fn(async () => new Response(null, { status: 204 })); globalThis.fetch = request as any;
    try {
      await cancelRawReplayUpload('https://storage.googleapis.com/upload-session-secret');
      expect(request).toHaveBeenCalledWith('https://storage.googleapis.com/upload-session-secret', expect.objectContaining({ method: 'DELETE', redirect: 'error' }));
      await expect(cancelRawReplayUpload('https://attacker.example/session')).rejects.toThrow('Unsafe');
    } finally { globalThis.fetch = prior; }
  });
});
