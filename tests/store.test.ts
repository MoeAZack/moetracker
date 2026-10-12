import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

let tempDir = '';
afterEach(async () => {
  vi.resetModules();
  vi.unstubAllEnvs();
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
});

describe('file store concurrency', () => {
  it('rejects a corrupt existing database and preserves its exact bytes', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'moetracker-corrupt-'));
    const dbPath = path.join(tempDir, 'db.json');
    const corrupted = '{"matches":[{"id":"valuable-record"}], broken';
    await fs.writeFile(dbPath, corrupted);
    vi.stubEnv('DB_PATH', dbPath);
    vi.stubEnv('USE_FIRESTORE', 'false');
    const { readDB } = await import('../lib/store');
    await expect(readDB()).rejects.toBeInstanceOf(SyntaxError);
    expect(await fs.readFile(dbPath, 'utf8')).toBe(corrupted);
  });

  it('rejects a stale whole-database write instead of losing an update', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'moetracker-'));
    const dbPath = path.join(tempDir, 'db.json');
    await fs.writeFile(dbPath, JSON.stringify({ settings: {}, matches: [] }));
    vi.stubEnv('DB_PATH', dbPath);
    vi.stubEnv('USE_FIRESTORE', 'false');
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
