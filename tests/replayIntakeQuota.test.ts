import { describe, expect, it } from 'vitest';
import { publishVerifiedReplayTemp, reserveReplayUpload } from '../lib/replayIntakeSafety';
import crypto from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

describe('replay in-flight quota reservation', () => {
  it('bounds concurrent streams per device and releases reservations idempotently', () => {
    const first = reserveReplayUpload('quota-device', 100, 0, 0); const second = reserveReplayUpload('quota-device', 100, 0, 0);
    expect(first.ok).toBe(true); expect(second.ok).toBe(true);
    const blocked = reserveReplayUpload('quota-device', 100, 0, 0); expect(blocked).toMatchObject({ ok: false, status: 429 });
    if (first.ok) { first.release(); first.release(); } if (second.ok) second.release();
    const afterRelease = reserveReplayUpload('quota-device', 100, 0, 0); expect(afterRelease.ok).toBe(true); if (afterRelease.ok) afterRelease.release();
  });

  it('never overwrites an existing final blob during atomic publication', async () => {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'replay-publish-'));
    try {
      const bytes = Buffer.from('verified replay bytes'); const hash = crypto.createHash('sha256').update(bytes).digest('hex'); const final = path.join(folder, `${hash}.vrf`); const duplicate = path.join(folder, 'duplicate.tmp');
      await fs.writeFile(final, bytes); await fs.writeFile(duplicate, bytes);
      await expect(publishVerifiedReplayTemp(duplicate, final, hash, bytes.length)).resolves.toBe(false); expect(await fs.readFile(final)).toEqual(bytes);
      const conflicting = path.join(folder, 'conflicting.tmp'); await fs.writeFile(conflicting, bytes);
      await fs.writeFile(final, Buffer.from('different'));
      await expect(publishVerifiedReplayTemp(conflicting, final, hash, bytes.length)).rejects.toThrow(/conflicts/); expect(await fs.readFile(final, 'utf8')).toBe('different');
    } finally { await fs.rm(folder, { recursive: true, force: true }); }
  });
});
