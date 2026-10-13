import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { createSeed } from './seed';
import { assertSeasonArchivesStorageSize } from './roster';
import { decodeFirestoreDocuments, encodeFirestoreDocuments, ensureStorageSchema, planFirestoreWriteBatches, planRevisionActivation, STORAGE_SCHEMA_VERSION, validateTrackerState } from './storageSchema';

// Runtime state never defaults to the repository's historical/demo db.json.
// Existing deployments keep their explicit DB_PATH; a fresh local install gets
// an empty structural seed under the private runtime data directory.
export const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'data', 'db.json');
const USE_FIRESTORE = process.env.USE_FIRESTORE === 'true';
let firestore: any = null;
async function getFirestore() {
  if (!USE_FIRESTORE) return null;
  if (!firestore) {
    const packageName = '@google-cloud/firestore';
    const module = await import(packageName);
    firestore = new module.Firestore({ ignoreUndefinedProperties: true });
  }
  return firestore;
}
const LEGACY_COLLECTION = 'tracker';
const META_COLLECTION = 'tracker_v2';
const REVISION_COLLECTION = 'tracker_v2_revisions';
const VERSION = Symbol('tracker-version');
let d1: any = null;

/** Cloudflare Worker entrypoint injects its D1 binding before the first request. */
export function configureD1Store(binding: any) { d1 = binding; }

function removeLegacySecrets(data: any) {
  delete data.secretValues;
  if (data.settings) {
    delete data.settings.discordWebhook;
    delete data.settings.gridApiKey;
    delete data.settings.henrikApiKey;
  }
}

function attachVersion<T extends Record<string, any>>(data: T, version: string | number): T {
  Object.defineProperty(data, VERSION, { value: version, enumerable: false, configurable: true });
  return data;
}

function hashText(text: string) { return crypto.createHash('sha256').update(text).digest('hex'); }

async function writeJsonFile(data: any, expected: string | undefined, allowCreate: boolean) {
  assertSeasonArchivesStorageSize(data.seasonArchives || []);
  validateTrackerState(data, { jsonFile: true });
  let currentText: string | null = null;
  try { currentText = await fs.readFile(DB_PATH, 'utf8'); } catch (error: any) { if (error?.code !== 'ENOENT') throw error; }
  if (currentText === null && !allowCreate) throw Object.assign(new Error('Database revision is required for ordinary writes.'), { status: 409 });
  if (currentText !== null && expected === undefined) throw Object.assign(new Error('Database revision is required for ordinary writes.'), { status: 409 });
  if (currentText !== null && hashText(currentText) !== expected) throw Object.assign(new Error('Data changed while this request was being processed. Please retry.'), { status: 409 });
  await fs.mkdir(path.dirname(DB_PATH), { recursive: true });
  const tempPath = `${DB_PATH}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  const serialized = JSON.stringify(data, null, 2);
  const handle = await fs.open(tempPath, 'wx', 0o600);
  try { await handle.writeFile(serialized, 'utf8'); await handle.sync(); } finally { await handle.close(); }
  await fs.rename(tempPath, DB_PATH);
  return hashText(serialized);
}

async function stageFirestoreRevision(data: any, revisionId: string) {
  const firestore = await getFirestore();
  const encoded = encodeFirestoreDocuments(data);
  for (const documents of planFirestoreWriteBatches(encoded, revisionId)) {
    const batch = firestore!.batch();
    for (const doc of documents) batch.create(firestore!.collection(REVISION_COLLECTION).doc(`${revisionId}_${doc.id}`), { revisionId, ...doc.payload });
    await batch.commit();
  }
  return encoded.length;
}

async function deleteFirestoreRevision(revisionId: string) {
  const firestore = await getFirestore();
  const snapshot = await firestore!.collection(REVISION_COLLECTION).where('revisionId', '==', revisionId).get();
  for (let offset = 0; offset < snapshot.docs.length; offset += 400) {
    const batch = firestore!.batch();
    snapshot.docs.slice(offset, offset + 400).forEach(doc => batch.delete(doc.ref));
    await batch.commit();
  }
}

async function activateFirestoreRevision(data: any, expected: number | undefined, mode: 'ordinary' | 'initialize' | 'replace') {
  const firestore = await getFirestore();
  removeLegacySecrets(data); ensureStorageSchema(data); assertSeasonArchivesStorageSize(data.seasonArchives || []); validateTrackerState(data);
  if (mode === 'ordinary' && expected === undefined) throw Object.assign(new Error('Database revision is required for ordinary writes.'), { status: 409 });
  const revisionId = crypto.randomUUID();
  const metaRef = firestore!.collection(META_COLLECTION).doc('meta');
  try {
    const documentCount = await stageFirestoreRevision(data, revisionId);
    return await firestore!.runTransaction(async transaction => {
      const snapshot = await transaction.get(metaRef); const current = Number(snapshot.data()?.version || 0);
      const version = planRevisionActivation(snapshot.exists ? current : null, expected, mode);
      transaction.set(metaRef, { schemaVersion: STORAGE_SCHEMA_VERSION, version, activeRevision: revisionId, documentCount, updatedAt: new Date().toISOString() });
      return version;
    });
  } catch (error) {
    await deleteFirestoreRevision(revisionId).catch(() => {});
    throw error;
  }
}

async function readLegacyFirestore() {
  const firestore = await getFirestore();
  const snapshot = await firestore!.collection(LEGACY_COLLECTION).get();
  const docs = snapshot.docs.filter(doc => doc.id !== '_meta');
  if (!docs.length) return null;
  const legacy: any = {};
  docs.forEach(doc => { legacy[doc.id] = doc.data().v; });
  return legacy;
}

async function initializeFirestore() {
  // This is the only legacy migration branch. Ordinary saves can never infer a first boot.
  let initial = await readLegacyFirestore();
  if (!initial && process.env.FIRESTORE_IMPORT_JSON_ON_FIRST_BOOT === 'true') {
    try { initial = JSON.parse(await fs.readFile(DB_PATH, 'utf8')); }
    catch (error: any) { if (error?.code !== 'ENOENT') throw error; }
  }
  if (!initial) initial = createSeed();
  ensureStorageSchema(initial); assertSeasonArchivesStorageSize(initial.seasonArchives || []); validateTrackerState(initial);
  try { await activateFirestoreRevision(initial, undefined, 'initialize'); }
  catch (error: any) { if (error?.status !== 409) throw error; }
}

async function readDBFirestore() {
  const firestore = await getFirestore();
  const metaRef = firestore!.collection(META_COLLECTION).doc('meta');
  const readMeta = async () => typeof (metaRef as any).get === 'function' ? (metaRef as any).get() : ({ exists: false, data: () => undefined });
  let meta = await readMeta();
  if (!meta.exists) { await initializeFirestore(); meta = await readMeta(); }
  const metadata = meta.data()!;
  if (Number(metadata.schemaVersion) > STORAGE_SCHEMA_VERSION) throw Object.assign(new Error('Firestore schema is newer than this server supports.'), { status: 409 });
  const revisionId = String(metadata.activeRevision || '');
  if (!revisionId) throw new Error('Firestore metadata has no active revision.');
  const snapshot = await firestore!.collection(REVISION_COLLECTION).where('revisionId', '==', revisionId).get();
  if (snapshot.empty || snapshot.size !== Number(metadata.documentCount)) throw new Error('Active Firestore revision is incomplete.');
  const docs = snapshot.docs.map(doc => ({ id: doc.id, payload: doc.data() }));
  const state = decodeFirestoreDocuments(docs);
  const seed = createSeed();
  for (const key of Object.keys(seed)) if (state[key] === undefined) state[key] = (seed as any)[key];
  return attachVersion(state, Number(metadata.version));
}

export async function readDB() {
  if (d1) return readDBD1();
  if (USE_FIRESTORE) return readDBFirestore();
  try {
    const text = await fs.readFile(DB_PATH, 'utf8');
    const data = JSON.parse(text); ensureStorageSchema(data); validateTrackerState(data, { jsonFile: true });
    return attachVersion(data, hashText(text));
  } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error;
    const seed = ensureStorageSchema(createSeed());
    const version = await writeJsonFile(seed, undefined, true);
    return attachVersion(seed, version);
  }
}

let writeQueue: Promise<void> = Promise.resolve();

export async function saveDB(data: any) {
  const run = writeQueue.then(async () => {
    const expected = data[VERSION];
    if (expected === undefined) throw Object.assign(new Error('Database revision is required for ordinary writes.'), { status: 409 });
    removeLegacySecrets(data); ensureStorageSchema(data);
    if (d1) await activateD1Revision(data, Number(expected), 'ordinary');
    else if (USE_FIRESTORE) await activateFirestoreRevision(data, Number(expected), 'ordinary');
    else await writeJsonFile(data, String(expected), false);
  });
  writeQueue = run.catch(() => {});
  return run;
}

/** Complete replacement for validated recovery/migration paths only. */
export async function replaceDB(data: any) {
  const replacement = structuredClone(data); removeLegacySecrets(replacement); ensureStorageSchema(replacement); validateTrackerState(replacement, { jsonFile: !USE_FIRESTORE && !d1 });
  const run = writeQueue.then(async () => {
    if (d1) await activateD1Revision(replacement, undefined, 'replace');
    else if (USE_FIRESTORE) await activateFirestoreRevision(replacement, undefined, 'replace');
    else {
      let current: string | undefined;
      try { current = hashText(await fs.readFile(DB_PATH, 'utf8')); } catch (error: any) { if (error?.code !== 'ENOENT') throw error; }
      await writeJsonFile(replacement, current, current === undefined);
    }
  });
  writeQueue = run.catch(() => {});
  return run;
}

export const storeInternals = { VERSION, writeJsonFile, stageFirestoreRevision, activateFirestoreRevision };

const D1_CHUNK_CHARS = 200_000;
const D1_MAX_CHUNKS = 32;
let d1TablesReady = false;

async function ensureD1Tables() {
  if (d1TablesReady) return;
  await d1.exec(`CREATE TABLE IF NOT EXISTS tracker_meta (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL, active_revision TEXT NOT NULL, chunk_count INTEGER NOT NULL, sha256 TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS tracker_revisions (revision_id TEXT NOT NULL, ordinal INTEGER NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (revision_id, ordinal)); CREATE INDEX IF NOT EXISTS tracker_revisions_created ON tracker_revisions(created_at); CREATE TABLE IF NOT EXISTS tracker_committed_revisions (revision_id TEXT PRIMARY KEY, committed_at TEXT NOT NULL);`);
  d1TablesReady = true;
}

function d1Chunks(data: any) {
  removeLegacySecrets(data); ensureStorageSchema(data); assertSeasonArchivesStorageSize(data.seasonArchives || []); validateTrackerState(data);
  const serialized = JSON.stringify(data);
  const chunks: string[] = [];
  for (let offset = 0; offset < serialized.length;) {
    let end = Math.min(serialized.length, offset + D1_CHUNK_CHARS);
    if (end < serialized.length && serialized.charCodeAt(end - 1) >= 0xD800 && serialized.charCodeAt(end - 1) <= 0xDBFF
      && serialized.charCodeAt(end) >= 0xDC00 && serialized.charCodeAt(end) <= 0xDFFF) end -= 1;
    chunks.push(serialized.slice(offset, end));
    offset = end;
  }
  if (chunks.length > D1_MAX_CHUNKS) throw Object.assign(new Error('Active data exceeds the Cloudflare Free safety budget. Archive older matches before saving.'), { status: 413 });
  return { chunks, sha256: hashText(serialized) };
}

async function readDBD1() {
  await ensureD1Tables();
  let meta: any = await d1.prepare('SELECT version, active_revision, chunk_count, sha256 FROM tracker_meta WHERE id = 1').first();
  if (!meta) {
    const seed = ensureStorageSchema(createSeed());
    await activateD1Revision(seed, undefined, 'initialize');
    meta = await d1.prepare('SELECT version, active_revision, chunk_count, sha256 FROM tracker_meta WHERE id = 1').first();
  }
  const result = await d1.prepare(`SELECT m.version, m.active_revision, m.chunk_count, m.sha256, r.ordinal, r.payload
    FROM tracker_meta m JOIN tracker_revisions r ON r.revision_id = m.active_revision
    WHERE m.id = 1 ORDER BY r.ordinal`).all();
  const rows = result.results || [];
  if (!rows.length) throw new Error('Active D1 revision is missing.');
  meta = rows[0];
  if (rows.length !== Number(meta.chunk_count)) throw new Error('Active D1 revision is incomplete.');
  const serialized = rows.map((row: any) => row.payload).join('');
  if (hashText(serialized) !== meta.sha256) throw new Error('Active D1 revision failed integrity validation.');
  const state = JSON.parse(serialized); ensureStorageSchema(state); validateTrackerState(state);
  return attachVersion(state, Number(meta.version));
}

async function activateD1Revision(data: any, expected: number | undefined, mode: 'ordinary' | 'initialize' | 'replace') {
  if (mode === 'ordinary' && expected === undefined) throw Object.assign(new Error('Database revision is required for ordinary writes.'), { status: 409 });
  await ensureD1Tables();
  const { chunks, sha256 } = d1Chunks(data);
  const revisionId = crypto.randomUUID(); const now = new Date().toISOString();
  await d1.batch(chunks.map((payload, ordinal) => d1.prepare('INSERT INTO tracker_revisions (revision_id, ordinal, payload, created_at) VALUES (?, ?, ?, ?)').bind(revisionId, ordinal, payload, now)));
  let result: any;
  if (mode === 'initialize') result = await d1.prepare('INSERT OR IGNORE INTO tracker_meta (id, version, active_revision, chunk_count, sha256, updated_at) VALUES (1, 1, ?, ?, ?, ?)').bind(revisionId, chunks.length, sha256, now).run();
  else if (mode === 'replace') result = await d1.prepare('INSERT INTO tracker_meta (id, version, active_revision, chunk_count, sha256, updated_at) VALUES (1, 1, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET version = tracker_meta.version + 1, active_revision = excluded.active_revision, chunk_count = excluded.chunk_count, sha256 = excluded.sha256, updated_at = excluded.updated_at').bind(revisionId, chunks.length, sha256, now).run();
  else result = await d1.prepare('UPDATE tracker_meta SET version = version + 1, active_revision = ?, chunk_count = ?, sha256 = ?, updated_at = ? WHERE id = 1 AND version = ?').bind(revisionId, chunks.length, sha256, now, expected).run();
  if (!result?.meta?.changes) {
    await d1.prepare('DELETE FROM tracker_revisions WHERE revision_id = ?').bind(revisionId).run();
    throw Object.assign(new Error('Data changed while this request was being processed. Please retry.'), { status: 409 });
  }
  // A revision becomes cleanup-eligible only after its activation succeeded.
  // Staged/in-flight candidates are deliberately absent from this ledger.
  await d1.prepare('INSERT OR IGNORE INTO tracker_committed_revisions (revision_id, committed_at) VALUES (?, ?)').bind(revisionId, now).run();
  await d1.prepare(`DELETE FROM tracker_revisions WHERE revision_id IN (
    SELECT c.revision_id FROM tracker_committed_revisions c
    WHERE c.revision_id != (SELECT active_revision FROM tracker_meta WHERE id = 1)
    ORDER BY c.committed_at DESC LIMIT -1 OFFSET 3
  )`).run().catch((error: any) => console.warn('[d1] inactive revision cleanup failed:', error?.message || error));
  await d1.prepare('DELETE FROM tracker_committed_revisions WHERE revision_id NOT IN (SELECT DISTINCT revision_id FROM tracker_revisions)').run().catch(() => {});
  return Number(expected || 0) + 1;
}
