import crypto from 'crypto';

export const STORAGE_SCHEMA_VERSION = 2;
export const MAX_ENTITY_BYTES = 840 * 1024;
export const MAX_DOCUMENT_BYTES = 900 * 1024;
export const MAX_JSON_DATABASE_BYTES = 64 * 1024 * 1024;
export const FIRESTORE_CHUNK_BYTES = 480 * 1024;

const GROWTH_ARRAYS = new Set(['matches', 'playerStats', 'seasonArchives']);
const GROWTH_TREES = new Set(['replayIntake', 'engineAdapters']);

export type StorageMetadata = {
  schemaVersion: number;
  migratedAt: string;
  migrationLedger: Array<{ from: number; to: number; at: string }>;
};

export type EncodedDocument = {
  id: string;
  payload: Record<string, unknown>;
};

export function planRevisionActivation(currentVersion: number | null, expected: number | undefined, mode: 'ordinary' | 'initialize' | 'replace') {
  const exists = currentVersion !== null;
  const current = currentVersion || 0;
  if (mode === 'initialize' && exists) throw Object.assign(new Error('Firestore was initialized concurrently.'), { status: 409 });
  if (mode === 'ordinary' && (expected === undefined || current !== expected)) throw Object.assign(new Error('Data changed while this request was being processed. Please retry.'), { status: 409 });
  return current + 1;
}

function bytes(value: unknown) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function storageError(message: string, status = 413) {
  return Object.assign(new Error(message), { status });
}

function stableId(parts: unknown[]) {
  return crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

function assertEntity(value: unknown, label: string) {
  const size = bytes(value);
  if (size > MAX_ENTITY_BYTES) {
    throw storageError(`${label} is ${size} bytes and exceeds the conservative ${MAX_ENTITY_BYTES}-byte entity limit.`);
  }
}

export function ensureStorageSchema(input: any, now = new Date().toISOString()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw storageError('Database state must be an object.', 400);
  const declared = Number(input._storage?.schemaVersion || 1);
  if (!Number.isSafeInteger(declared) || declared < 1) throw storageError('Database storage schema is invalid.', 400);
  if (declared > STORAGE_SCHEMA_VERSION) throw storageError(`Database schema ${declared} is newer than this server supports (${STORAGE_SCHEMA_VERSION}).`, 409);
  const ledger = Array.isArray(input._storage?.migrationLedger) ? input._storage.migrationLedger.filter((item: any) =>
    Number.isSafeInteger(item?.from) && Number.isSafeInteger(item?.to) && typeof item?.at === 'string') : [];
  if (declared < STORAGE_SCHEMA_VERSION) ledger.push({ from: declared, to: STORAGE_SCHEMA_VERSION, at: now });
  input._storage = { schemaVersion: STORAGE_SCHEMA_VERSION, migratedAt: declared < STORAGE_SCHEMA_VERSION ? now : String(input._storage?.migratedAt || now), migrationLedger: ledger } satisfies StorageMetadata;
  return input;
}

export function validateTrackerState(input: any, options: { jsonFile?: boolean } = {}) {
  ensureStorageSchema(input);
  for (const key of GROWTH_ARRAYS) {
    const collection = input[key];
    if (collection !== undefined && !Array.isArray(collection)) throw storageError(`${key} must be an array.`, 400);
    for (let index = 0; index < (collection || []).length; index += 1) assertEntity(collection[index], `${key}[${index}]`);
  }
  for (const key of GROWTH_TREES) {
    const tree = input[key];
    if (tree !== undefined && (!tree || typeof tree !== 'object' || Array.isArray(tree))) throw storageError(`${key} must be an object.`, 400);
  }
  const total = bytes(input);
  if (options.jsonFile && total > MAX_JSON_DATABASE_BYTES) throw storageError(`JSON database exceeds the ${MAX_JSON_DATABASE_BYTES}-byte development limit.`);
  // Encoding performs the final per-leaf and per-document checks used by Firestore.
  encodeFirestoreDocuments(input);
  return input;
}

function emitValue(docs: EncodedDocument[], topKey: string, path: Array<string | number>, value: unknown) {
  assertEntity(value, `${topKey}${path.map(part => `[${String(part)}]`).join('')}`);
  const payload = { schemaVersion: STORAGE_SCHEMA_VERSION, topKey, path, kind: 'value', value };
  if (bytes(payload) > MAX_DOCUMENT_BYTES) throw storageError(`Encoded Firestore document for ${topKey} exceeds its safe document limit.`);
  docs.push({ id: stableId([topKey, path]), payload });
}

function emitGrowthTree(docs: EncodedDocument[], topKey: string, value: any, path: Array<string | number>, depth: number) {
  if (!value || typeof value !== 'object') return emitValue(docs, topKey, path, value);
  const container = Array.isArray(value) ? 'array' : 'object';
  docs.push({ id: stableId([topKey, path, 'container']), payload: { schemaVersion: STORAGE_SCHEMA_VERSION, topKey, path, kind: 'container', container } });
  const entries = Array.isArray(value) ? value.map((item, index) => [index, item] as const) : Object.entries(value);
  for (const [childKey, child] of entries) {
    const childPath = [...path, childKey];
    // Two forced levels make each replay/adapter record independently bounded.
    if (child && typeof child === 'object' && (depth < 2 || bytes(child) > MAX_ENTITY_BYTES)) emitGrowthTree(docs, topKey, child, childPath, depth + 1);
    else emitValue(docs, topKey, childPath, child);
  }
}

export function encodeFirestoreDocuments(input: Record<string, any>): EncodedDocument[] {
  const docs: EncodedDocument[] = [];
  for (const [topKey, value] of Object.entries(input)) {
    if (GROWTH_ARRAYS.has(topKey)) {
      docs.push({ id: stableId([topKey, 'container']), payload: { schemaVersion: STORAGE_SCHEMA_VERSION, topKey, path: [], kind: 'container', container: 'array' } });
      (value || []).forEach((entity: unknown, index: number) => emitValue(docs, topKey, [index], entity));
    } else if (GROWTH_TREES.has(topKey)) {
      emitGrowthTree(docs, topKey, value || {}, [], 0);
    } else if (bytes(value) <= MAX_ENTITY_BYTES) {
      emitValue(docs, topKey, [], value);
    } else {
      const serialized = JSON.stringify(value);
      const chunks: string[] = [];
      // Slice conservatively by code units, then shrink any multi-byte overflow.
      for (let offset = 0; offset < serialized.length;) {
        let end = Math.min(serialized.length, offset + FIRESTORE_CHUNK_BYTES);
        while (Buffer.byteLength(serialized.slice(offset, end), 'utf8') > FIRESTORE_CHUNK_BYTES) end -= 1024;
        chunks.push(serialized.slice(offset, end)); offset = end;
      }
      docs.push({ id: stableId([topKey, 'chunks']), payload: { schemaVersion: STORAGE_SCHEMA_VERSION, topKey, path: [], kind: 'chunks', count: chunks.length, sha256: crypto.createHash('sha256').update(serialized).digest('hex') } });
      chunks.forEach((chunk, index) => emitValue(docs, topKey, ['__chunk', index], chunk));
    }
  }
  return docs;
}

function setPath(root: any, path: Array<string | number>, value: unknown) {
  if (path.length === 0) return value;
  let cursor = root;
  for (let index = 0; index < path.length - 1; index += 1) cursor = cursor[path[index]];
  cursor[path[path.length - 1]] = value;
  return root;
}

export function decodeFirestoreDocuments(docs: EncodedDocument[]) {
  const output: Record<string, any> = {};
  const ordered = [...docs].sort((left, right) => {
    const a = left.payload.path as any[]; const b = right.payload.path as any[];
    return a.length - b.length;
  });
  const chunkMeta = new Map<string, any>();
  const chunks = new Map<string, string[]>();
  for (const { payload } of ordered) {
    if (Number(payload.schemaVersion) > STORAGE_SCHEMA_VERSION) throw storageError('Firestore state uses a newer unsupported schema.', 409);
    const topKey = String(payload.topKey); const path = payload.path as Array<string | number>;
    if (payload.kind === 'chunks') { chunkMeta.set(topKey, payload); chunks.set(topKey, []); continue; }
    if (path?.[0] === '__chunk') { (chunks.get(topKey) || [])[Number(path[1])] = String(payload.value); continue; }
    if (payload.kind === 'container') {
      const container = payload.container === 'array' ? [] : {};
      if (path.length === 0) output[topKey] = container; else setPath(output[topKey], path, container);
    } else if (path.length === 0) output[topKey] = payload.value;
    else setPath(output[topKey], path, payload.value);
  }
  for (const [topKey, meta] of chunkMeta) {
    const serialized = (chunks.get(topKey) || []).join('');
    if ((chunks.get(topKey) || []).length !== Number(meta.count) || crypto.createHash('sha256').update(serialized).digest('hex') !== meta.sha256) throw storageError(`Chunked Firestore value ${topKey} failed integrity validation.`, 500);
    output[topKey] = JSON.parse(serialized);
  }
  return ensureStorageSchema(output);
}
