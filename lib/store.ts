import fs from 'fs/promises';
import path from 'path';
import { Firestore } from '@google-cloud/firestore';
import { createSeed } from './seed';

export const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'db.json');

// Firestore is the durable, concurrent-safe store in production (set USE_FIRESTORE=true).
// The whole tracker is sharded one document per top-level key inside the `tracker` collection,
// which keeps the existing readDB()/saveDB(wholeObject) contract while gaining atomic batched
// writes, native backups (PITR), and no file/bucket fragility. Local dev falls back to a file.
const USE_FIRESTORE = process.env.USE_FIRESTORE === 'true';
const firestore = USE_FIRESTORE ? new Firestore({ ignoreUndefinedProperties: true }) : null;
const DB_COLLECTION = 'tracker';

// Write all top-level keys to Firestore as one atomic batch.
async function persistFirestore(data: any) {
  const col = firestore!.collection(DB_COLLECTION);
  const batch = firestore!.batch();
  for (const k of Object.keys(data)) batch.set(col.doc(k), { v: data[k] ?? null });
  await batch.commit();
}

async function readDBFirestore() {
  const snap = await firestore!.collection(DB_COLLECTION).get();
  if (snap.empty) {
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
  snap.forEach((doc) => { obj[doc.id] = doc.data().v; });
  // Backfill any keys added after the initial migration.
  const seed = createSeed();
  for (const k of Object.keys(seed)) if (obj[k] === undefined) obj[k] = (seed as any)[k];
  return obj;
}

export async function readDB() {
  if (firestore) return readDBFirestore();
  try {
    const data = await fs.readFile(DB_PATH, 'utf-8');
    return JSON.parse(data);
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
    if (firestore) {
      await persistFirestore(data);
      return;
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
