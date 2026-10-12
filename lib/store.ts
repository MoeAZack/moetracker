import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { Firestore } from '@google-cloud/firestore';
import { createSeed } from './seed';
import { assertSeasonArchivesStorageSize } from './roster';
import { decodeFirestoreDocuments, encodeFirestoreDocuments, ensureStorageSchema, planFirestoreWriteBatches, planRevisionActivation, STORAGE_SCHEMA_VERSION, validateTrackerState } from './storageSchema';

export const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'db.json');
const USE_FIRESTORE = process.env.USE_FIRESTORE === 'true';
const firestore = USE_FIRESTORE ? new Firestore({ ignoreUndefinedProperties: true }) : null;
const LEGACY_COLLECTION = 'tracker';
const META_COLLECTION = 'tracker_v2';
const REVISION_COLLECTION = 'tracker_v2_revisions';
const VERSION = Symbol('tracker-version');

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
  const encoded = encodeFirestoreDocuments(data);
  for (const documents of planFirestoreWriteBatches(encoded, revisionId)) {
    const batch = firestore!.batch();
    for (const doc of documents) batch.create(firestore!.collection(REVISION_COLLECTION).doc(`${revisionId}_${doc.id}`), { revisionId, ...doc.payload });
    await batch.commit();
  }
  return encoded.length;
}

async function deleteFirestoreRevision(revisionId: string) {
  const snapshot = await firestore!.collection(REVISION_COLLECTION).where('revisionId', '==', revisionId).get();
  for (let offset = 0; offset < snapshot.docs.length; offset += 400) {
    const batch = firestore!.batch();
    snapshot.docs.slice(offset, offset + 400).forEach(doc => batch.delete(doc.ref));
    await batch.commit();
  }
}

async function activateFirestoreRevision(data: any, expected: number | undefined, mode: 'ordinary' | 'initialize' | 'replace') {
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
  if (!initial) {
    try { initial = JSON.parse(await fs.readFile(DB_PATH, 'utf8')); }
    catch (error: any) { if (error?.code !== 'ENOENT') throw error; initial = createSeed(); }
  }
  ensureStorageSchema(initial); assertSeasonArchivesStorageSize(initial.seasonArchives || []); validateTrackerState(initial);
  try { await activateFirestoreRevision(initial, undefined, 'initialize'); }
  catch (error: any) { if (error?.status !== 409) throw error; }
}

async function readDBFirestore() {
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
  if (firestore) return readDBFirestore();
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
    if (firestore) await activateFirestoreRevision(data, Number(expected), 'ordinary');
    else await writeJsonFile(data, String(expected), false);
  });
  writeQueue = run.catch(() => {});
  return run;
}

/** Complete replacement for validated recovery/migration paths only. */
export async function replaceDB(data: any) {
  const replacement = structuredClone(data); removeLegacySecrets(replacement); ensureStorageSchema(replacement); validateTrackerState(replacement, { jsonFile: !firestore });
  const run = writeQueue.then(async () => {
    if (firestore) await activateFirestoreRevision(replacement, undefined, 'replace');
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
