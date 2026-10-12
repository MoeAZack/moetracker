import crypto from 'crypto';
import fs from 'fs/promises';
import { createReadStream } from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { Transform } from 'stream';
import { DB_PATH, readDB, replaceDB } from './store';
import { STORAGE_SCHEMA_VERSION, validateTrackerState } from './storageSchema';
import { assertSeasonArchivesStorageSize } from './roster';

export const PRIVATE_BACKUP_FORMAT = 'moetracker-private-backup/v1';

function sha256(value: string | Buffer) { return crypto.createHash('sha256').update(value).digest('hex'); }

async function sha256File(file: string) {
  const hash = crypto.createHash('sha256');
  await pipeline(createReadStream(file), new Transform({ transform(chunk, _encoding, callback) { hash.update(chunk); callback(); } }));
  return hash.digest('hex');
}

function backupRoot() { return path.resolve(process.env.PRIVATE_BACKUP_DIR || path.join(path.dirname(DB_PATH), 'private-backups')); }
function replayRoot() { return path.resolve(process.env.REPLAY_STORAGE_DIR || path.join(path.dirname(DB_PATH), 'private-replays')); }

async function replayInventory(state: any) {
  const records = Object.values(state.replayIntake?.blobs || {}) as any[];
  const inventory = [];
  for (const record of records.sort((a, b) => String(a.sha256).localeCompare(String(b.sha256)))) {
    const hash = String(record.sha256 || '');
    const byteRequirement = record.ingestionMode === 'local-evidence' ? 'none-evidence-only'
      : record.ingestionMode === 'coach-raw' && record.rawObject?.status === 'deleted' ? 'none-intentionally-deleted'
        : record.ingestionMode === 'coach-raw' ? 'external-active-raw' : 'local-required';
    if (!/^[a-f0-9]{64}$/.test(hash)) { inventory.push({ sha256: hash, metadataSize: Number(record.size || 0), byteRequirement, present: false, storedSize: null, checksumVerified: false, metadataValid: false }); continue; }
    const file = path.join(replayRoot(), hash.slice(0, 2), `${hash}.vrf`);
    const stat = await fs.stat(file).catch(() => null);
    let actualSha256: string | null = null;
    if (stat?.isFile()) actualSha256 = await sha256File(file);
    inventory.push({ sha256: hash, metadataSize: Number(record.size || 0), byteRequirement, present: !!stat?.isFile(), storedSize: stat?.size ?? null, checksumVerified: actualSha256 === hash, metadataValid: true });
  }
  return inventory;
}

async function atomicWrite(file: string, contents: string) {
  const temporary = `${file}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  const handle = await fs.open(temporary, 'wx', 0o600);
  try { await handle.writeFile(contents, 'utf8'); await handle.sync(); } finally { await handle.close(); }
  await fs.rename(temporary, file);
}

export async function createPrivateBackup(options: { reason?: string; directory?: string } = {}) {
  const state = await readDB(); validateTrackerState(state);
  const createdAt = new Date().toISOString();
  const id = `${createdAt.replace(/[:.]/g, '-')}-${crypto.randomBytes(5).toString('hex')}`;
  const directory = path.resolve(options.directory || path.join(backupRoot(), id));
  if (!directory.startsWith(`${backupRoot()}${path.sep}`) && !options.directory) throw new Error('Backup path escaped its private root.');
  await fs.mkdir(path.dirname(directory), { recursive: true, mode: 0o700 });
  await fs.mkdir(directory, { recursive: false, mode: 0o700 });
  const stateText = JSON.stringify(state);
  const stateFile = 'state.json';
  await atomicWrite(path.join(directory, stateFile), stateText);
  const inventory = await replayInventory(state);
  const manifest = {
    format: PRIVATE_BACKUP_FORMAT,
    id,
    createdAt,
    reason: options.reason || 'scheduled-private-recovery',
    storageSchemaVersion: STORAGE_SCHEMA_VERSION,
    completeReplacement: true,
    files: [{ path: stateFile, bytes: Buffer.byteLength(stateText), sha256: sha256(stateText) }],
    replayBlobs: { embedded: false, inventory },
  };
  const manifestText = JSON.stringify(manifest, null, 2);
  await atomicWrite(path.join(directory, 'manifest.json'), manifestText);
  return { id, directory, manifest };
}

export async function validatePrivateBackup(directory: string) {
  const root = path.resolve(directory);
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8'));
  if (manifest?.format !== PRIVATE_BACKUP_FORMAT || manifest?.completeReplacement !== true || !Array.isArray(manifest.files) || manifest.files.length !== 1) throw Object.assign(new Error('Private backup manifest is invalid or unsupported.'), { status: 400 });
  if (Number(manifest.storageSchemaVersion) > STORAGE_SCHEMA_VERSION) throw Object.assign(new Error('Private backup uses a newer storage schema.'), { status: 409 });
  const stateEntry = manifest.files[0];
  if (stateEntry.path !== 'state.json' || !/^[a-f0-9]{64}$/.test(String(stateEntry.sha256))) throw Object.assign(new Error('Private backup state entry is invalid.'), { status: 400 });
  const stateText = await fs.readFile(path.join(root, 'state.json'), 'utf8');
  if (Buffer.byteLength(stateText) !== Number(stateEntry.bytes) || sha256(stateText) !== stateEntry.sha256) throw Object.assign(new Error('Private backup checksum validation failed.'), { status: 422 });
  const state = JSON.parse(stateText); assertSeasonArchivesStorageSize(state.seasonArchives || []); validateTrackerState(state, { jsonFile: true });
  if (!manifest.replayBlobs || manifest.replayBlobs.embedded !== false || !Array.isArray(manifest.replayBlobs.inventory)) throw Object.assign(new Error('Private backup replay inventory metadata is invalid.'), { status: 400 });
  const expectedHashes = Object.keys(state.replayIntake?.blobs || {}).sort();
  const manifestHashes = manifest.replayBlobs.inventory.map((item: any) => String(item?.sha256 || '')).sort();
  if (expectedHashes.length !== manifestHashes.length || expectedHashes.some((hash, index) => hash !== manifestHashes[index])) throw Object.assign(new Error('Private backup replay inventory does not match state metadata.'), { status: 422 });
  const currentInventory = await replayInventory(state);
  const manifestRequirements = new Map(manifest.replayBlobs.inventory.map((item: any) => [String(item?.sha256 || ''), item?.byteRequirement ? String(item.byteRequirement) : null]));
  if (currentInventory.some(item => manifestRequirements.get(item.sha256) && manifestRequirements.get(item.sha256) !== item.byteRequirement)) throw Object.assign(new Error('Private backup replay byte requirements do not match state metadata.'), { status: 422 });
  const missing = currentInventory.filter(item => item.byteRequirement === 'local-required' && !item.present).map(item => item.sha256);
  const corrupt = currentInventory.filter(item => item.byteRequirement === 'local-required' && item.present && (item.storedSize !== item.metadataSize || !item.checksumVerified)).map(item => item.sha256);
  const externalUnverified = currentInventory.filter(item => item.byteRequirement === 'external-active-raw').map(item => item.sha256);
  const intentionallyOmitted = currentInventory.filter(item => item.byteRequirement.startsWith('none-')).map(item => item.sha256);
  const invalidMetadata = currentInventory.filter(item => !item.metadataValid).map(item => item.sha256);
  const blobStatus = { complete: missing.length === 0 && corrupt.length === 0 && externalUnverified.length === 0 && invalidMetadata.length === 0, missing, corrupt, externalUnverified, intentionallyOmitted, invalidMetadata, checked: currentInventory.length };
  return { manifest, state, metadataValid: true, blobStatus };
}

export async function restorePrivateBackup(directory: string, options: { dryRun?: boolean } = {}) {
  let validated: Awaited<ReturnType<typeof validatePrivateBackup>>;
  try { validated = await validatePrivateBackup(directory); }
  catch (error: any) {
    if (options.dryRun) return { dryRun: true, metadataValid: false, blobInventoryComplete: null, readyForRestore: false, blobStatus: null, backupId: null, preRestoreBackupId: null, metadataError: error?.message || 'Private backup metadata is invalid.' };
    throw error;
  }
  if (options.dryRun) return { dryRun: true, metadataValid: validated.metadataValid, blobInventoryComplete: validated.blobStatus.complete, readyForRestore: validated.metadataValid && validated.blobStatus.complete, blobStatus: validated.blobStatus, backupId: validated.manifest.id, preRestoreBackupId: null };
  if (!validated.blobStatus.complete) throw Object.assign(new Error('Private backup metadata is valid, but its replay blob inventory is missing or corrupt.'), { status: 409, blobStatus: validated.blobStatus });
  const before = await createPrivateBackup({ reason: `pre-restore:${validated.manifest.id}` });
  await replaceDB(validated.state);
  return { dryRun: false, restored: true, backupId: validated.manifest.id, preRestoreBackupId: before.id, completeReplacement: true };
}

export async function reconcileReplayBlobInventory() {
  const state = await readDB(); const inventory = await replayInventory(state);
  return {
    checked: inventory.length,
    healthy: inventory.filter(item => item.byteRequirement.startsWith('none-') || (item.byteRequirement === 'local-required' && item.present && item.storedSize === item.metadataSize && item.checksumVerified)).length,
    missing: inventory.filter(item => item.byteRequirement === 'local-required' && !item.present).map(item => item.sha256),
    corrupt: inventory.filter(item => item.byteRequirement === 'local-required' && item.present && (item.storedSize !== item.metadataSize || !item.checksumVerified)).map(item => item.sha256),
    externalUnverified: inventory.filter(item => item.byteRequirement === 'external-active-raw').map(item => item.sha256),
    intentionallyOmitted: inventory.filter(item => item.byteRequirement.startsWith('none-')).map(item => item.sha256),
  };
}
