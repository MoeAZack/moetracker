import fs from 'fs/promises';
import path from 'path';
import { Firestore } from '@google-cloud/firestore';
import { createSeed } from './seed';
import crypto from 'crypto';

export const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'db.json');

// Firestore is the durable, concurrent-safe store in production (set USE_FIRESTORE=true).
// The whole tracker is sharded one document per top-level key inside the `tracker` collection,
// which keeps the existing readDB()/saveDB(wholeObject) contract while gaining atomic batched
// writes, native backups (PITR), and no file/bucket fragility. Local dev falls back to a file.
const USE_FIRESTORE = process.env.USE_FIRESTORE === 'true';
const firestore = USE_FIRESTORE ? new Firestore({ ignoreUndefinedProperties: true }) : null;
const DB_COLLECTION = 'tracker';
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
  Object.defineProperty(data, VERSION, { value: version, enumerable: false, configurable: false });
  return data;
}

// Write all top-level keys to Firestore as one atomic batch.
async function persistFirestore(data: any) {
  const col = firestore!.collection(DB_COLLECTION);
  const expected = data[VERSION];
  await firestore!.runTransaction(async (transaction) => {
    const metaRef = col.doc('_meta');
    const meta = await transaction.get(metaRef);
    const current = Number(meta.data()?.version || 0);
    if (expected !== undefined && Number(expected) !== current) {
      throw Object.assign(new Error('Data changed while this request was being processed. Please retry.'), { status: 409 });
    }
    for (const k of Object.keys(data)) transaction.set(col.doc(k), { v: data[k] ?? null });
    transaction.set(metaRef, { version: current + 1, updatedAt: new Date().toISOString() });
  });
}

async function readDBFirestore() {
  const snap = await firestore!.collection(DB_COLLECTION).get();
  const dataDocs = snap.docs.filter((doc) => doc.id !== '_meta');
  if (dataDocs.length === 0) {
    // First boot on Firestore: migrate an existing file DB (bucket) if present, else seed.
    let initial: any;
    try {
      initial = JSON.parse(await fs.readFile(DB_PATH, 'utf-8'));
      console.log('[firestore] Migrating existing file database into Firestore.');
    } catch {
      initial = createSeed();
      console.log('[firestore] Seeding a fresh Firestore database.');
    }
    await persistFirestore(initial);
    return initial;
  }
  const obj: any = {};
  let version = 0;
  snap.forEach((doc) => {
    if (doc.id === '_meta') version = Number(doc.data().version || 0);
    else obj[doc.id] = doc.data().v;
  });
  // Backfill any keys added after the initial migration.
  const seed = createSeed();
  for (const k of Object.keys(seed)) if (obj[k] === undefined) obj[k] = (seed as any)[k];
  return attachVersion(obj, version);
}

export async function readDB() {
  if (firestore) return readDBFirestore();
  try {
    const data = await fs.readFile(DB_PATH, 'utf-8');
    return attachVersion(JSON.parse(data), crypto.createHash('sha256').update(data).digest('hex'));
  } catch (err) {
    const seed = createSeed();
    await saveDB(seed);
    return seed;
  }
}

// Serialize writes so concurrent requests can't interleave read-modify-write and lose data.
let writeQueue: Promise<void> = Promise.resolve();

export async function saveDB(data: any) {
  const run = writeQueue.then(async () => {
    removeLegacySecrets(data);
    if (firestore) {
      await persistFirestore(data);
      return;
    }
    const expected = data[VERSION];
    if (expected !== undefined) {
      const current = await fs.readFile(DB_PATH, 'utf-8');
      const currentVersion = crypto.createHash('sha256').update(current).digest('hex');
      if (expected !== currentVersion) {
        throw Object.assign(new Error('Data changed while this request was being processed. Please retry.'), { status: 409 });
      }
    }
    // File fallback: write to a temp file then rename, so a crash mid-write can't corrupt db.json.
    const tmpPath = `${DB_PATH}.${process.pid}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    await fs.rename(tmpPath, DB_PATH);
  });
  // Keep the chain alive even if this write fails, so later writes still run.
  writeQueue = run.catch(() => {});
  return run;
}
