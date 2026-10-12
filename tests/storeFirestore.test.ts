import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_SEASON_ARCHIVES_BYTES } from '../lib/roster';

const firestoreMock = vi.hoisted(() => ({
  get: vi.fn(),
  runTransaction: vi.fn(),
  transactionSet: vi.fn(),
}));

vi.mock('@google-cloud/firestore', () => ({
  Firestore: class {
    collection() {
      return {
        get: firestoreMock.get,
        doc: vi.fn((id: string) => ({ id })),
      };
    }

    runTransaction = firestoreMock.runTransaction;
  },
}));

let tempDir = '';

afterEach(async () => {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('Firestore first-boot archive boundary', () => {
  it('rejects an oversized migration seed before starting any write transaction', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'moetracker-firestore-size-'));
    const dbPath = path.join(tempDir, 'db.json');
    await fs.writeFile(dbPath, JSON.stringify({
      settings: {},
      seasonArchives: [{ id: 'too-large', body: 'x'.repeat(MAX_SEASON_ARCHIVES_BYTES) }],
    }));
    firestoreMock.get.mockResolvedValue({ docs: [], forEach: vi.fn() });
    firestoreMock.runTransaction.mockImplementation(async (operation: (transaction: any) => Promise<void>) => {
      await operation({ get: vi.fn(), set: firestoreMock.transactionSet });
    });
    vi.stubEnv('DB_PATH', dbPath);
    vi.stubEnv('USE_FIRESTORE', 'true');
    vi.stubEnv('FIRESTORE_IMPORT_JSON_ON_FIRST_BOOT', 'true');

    const { readDB } = await import('../lib/store');
    await expect(readDB()).rejects.toMatchObject({ status: 413 });
    expect(firestoreMock.runTransaction).not.toHaveBeenCalled();
    expect(firestoreMock.transactionSet).not.toHaveBeenCalled();
  });
});
