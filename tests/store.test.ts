import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

let tempDir = '';
afterEach(async () => {
  vi.resetModules();
  delete process.env.DB_PATH;
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
});

describe('file store concurrency', () => {
  it('rejects a stale whole-database write instead of losing an update', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'moetracker-'));
    const dbPath = path.join(tempDir, 'db.json');
    await fs.writeFile(dbPath, JSON.stringify({ settings: {}, matches: [] }));
    process.env.DB_PATH = dbPath;
    process.env.USE_FIRESTORE = 'false';
    const { readDB, saveDB } = await import('../lib/store');

    const first = await readDB();
    const stale = await readDB();
    first.matches.push({ id: 'first' });
    await saveDB(first);
    stale.matches.push({ id: 'stale' });

    await expect(saveDB(stale)).rejects.toMatchObject({ status: 409 });
    await expect(readDB()).resolves.toMatchObject({ matches: [{ id: 'first' }] });
  });
});
