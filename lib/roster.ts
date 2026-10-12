import crypto from 'node:crypto';

type IdFactory = () => string;
type Clock = () => string;

const defaultId: IdFactory = () => crypto.randomUUID();
const defaultClock: Clock = () => new Date().toISOString();

function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}

export function ensureRoster(db: any) {
  if (!Array.isArray(db.rosterPlayers)) db.rosterPlayers = [];
  if (!Array.isArray(db.coreMemberships)) db.coreMemberships = [];
  if (!Array.isArray(db.tryoutBatches)) db.tryoutBatches = [];
  if (!Array.isArray(db.seasonArchives)) db.seasonArchives = [];
  if (!db.settings) db.settings = {};
  return db;
}

export const SEASON_COLLECTION_POLICY = {
  archive: [
    'rosterPlayers', 'coreMemberships', 'tryoutBatches', 'schedule', 'goals',
    'matches', 'playerStats', 'soloq', 'rounds', 'vetos', 'stratRuns', 'vodReviews',
  ],
  retain: ['seasonArchives', 'lineups', 'authKeys', 'allowedUsers', 'engineAdapters'],
  retainAndSnapshotReferences: ['strats'],
} as const;

const SEASON_ARRAY_KEYS = SEASON_COLLECTION_POLICY.archive;
const CLASSIFIED_COLLECTION_KEYS = new Set<string>([
  ...SEASON_COLLECTION_POLICY.archive,
  ...SEASON_COLLECTION_POLICY.retain,
  ...SEASON_COLLECTION_POLICY.retainAndSnapshotReferences,
]);

// Each archive is an entity document in schema v2. Keep every entity below a
// conservative limit while allowing the archive collection itself to grow.
export const MAX_SEASON_ARCHIVES_BYTES = 800 * 1024;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

export function assertSeasonArchivesStorageSize(archives: unknown) {
  if (!Array.isArray(archives)) fail('Season archive storage must be an array.', 400);
  for (const archive of archives) {
    const bytes = Buffer.byteLength(JSON.stringify({ v: archive }), 'utf8');
    if (bytes > MAX_SEASON_ARCHIVES_BYTES) {
      fail(`Season archive storage would exceed the safe ${Math.floor(MAX_SEASON_ARCHIVES_BYTES / 1024)} KiB limit. Reduce this archive before retrying.`, 413);
    }
  }
}

export function assertSeasonCollectionPolicy(db: any) {
  const unclassified = Object.entries(db)
    .filter(([key, value]) => Array.isArray(value) && value.length > 0 && !CLASSIFIED_COLLECTION_KEYS.has(key))
    .map(([key]) => key);
  if (unclassified.length > 0) {
    fail(`Cannot archive while unclassified collections contain data: ${unclassified.join(', ')}. Add an explicit archive or retain policy first.`, 409);
  }
}

export function hasActiveSeasonData(db: any) {
  ensureRoster(db);
  return SEASON_ARRAY_KEYS.some(key => Array.isArray(db[key]) && db[key].length > 0)
    || Object.keys(db.settings.riotIds || {}).length > 0
    || (db.settings.players || []).length > 0
    || (db.settings.inactivePlayers || []).length > 0;
}

export function archiveAndResetSeason(
  db: any,
  archiveName: string,
  newSeasonName: string,
  idFactory = defaultId,
  clock = defaultClock,
) {
  ensureRoster(db);
  assertSeasonCollectionPolicy(db);
  const cleanArchiveName = archiveName.trim();
  const normalized = cleanArchiveName.toLocaleLowerCase();
  if (db.seasonArchives.some((archive: any) => archive.name.toLocaleLowerCase() === normalized)) {
    fail('A season archive already uses this name.', 409);
  }
  if (!hasActiveSeasonData(db)) fail('There is no active roster-season data to archive.', 409);

  const archive: any = {
    id: idFactory(),
    name: cleanArchiveName,
    seasonName: String(db.settings.season || cleanArchiveName),
    archivedAt: clock(),
    schemaVersion: 1,
    riotIds: clone(db.settings.riotIds || {}),
    legacyPlayers: clone(db.settings.players || []),
    legacyInactivePlayers: clone(db.settings.inactivePlayers || []),
  };
  for (const key of SEASON_ARRAY_KEYS) archive[key] = clone(Array.isArray(db[key]) ? db[key] : []);
  const referencedStratIds = new Set(archive.stratRuns.map((run: any) => run.stratId).filter(Boolean));
  const strats = Array.isArray(db.strats) ? db.strats : [];
  const knownStratIds = new Set(strats.map((strat: any) => strat.id));
  const missingStratIds = [...referencedStratIds].filter(id => !knownStratIds.has(id));
  if (missingStratIds.length > 0) {
    fail(`Cannot archive strategy runs with missing strategy definitions: ${missingStratIds.join(', ')}.`, 409);
  }
  archive.strats = clone(strats.filter((strat: any) => referencedStratIds.has(strat.id)));
  archive.engineAdapters = archiveSeasonAdapters(db, archive);
  archive.accessIdentities = archiveSeasonAccessIdentities(db, archive, archive.engineAdapters);

  const nextArchives = [...db.seasonArchives, archive];
  assertSeasonArchivesStorageSize(nextArchives);
  db.seasonArchives = nextArchives;

  for (const key of SEASON_ARRAY_KEYS) db[key] = [];
  db.settings.season = newSeasonName.trim();
  db.settings.players = [];
  db.settings.inactivePlayers = [];
  db.settings.riotIds = {};
  removeArchivedAdapters(db, archive.engineAdapters);
  removeArchivedAccessIdentities(db, archive.accessIdentities);
  return archive;
}

export function restoreSeasonArchive(db: any, archiveId: string) {
  ensureRoster(db);
  assertSeasonCollectionPolicy(db);
  const archive = db.seasonArchives.find((entry: any) => entry.id === archiveId);
  if (!archive) fail('Season archive was not found.', 404);
  if (hasActiveSeasonData(db)) {
    fail('Archive the current active season before restoring another season.', 409);
  }
  const identityState = { engineAdapters: db.engineAdapters ? clone(db.engineAdapters) : undefined, authKeys: clone(db.authKeys || []), allowedUsers: clone(db.allowedUsers || []) };
  restoreArchivedAdapters(identityState, archive.engineAdapters);
  restoreArchivedAccessIdentities(identityState, archive.accessIdentities);
  db.engineAdapters = identityState.engineAdapters; db.authKeys = identityState.authKeys; db.allowedUsers = identityState.allowedUsers;
  for (const key of SEASON_ARRAY_KEYS) db[key] = clone(Array.isArray(archive[key]) ? archive[key] : []);
  if (!Array.isArray(db.strats)) db.strats = [];
  const currentStratIds = new Set(db.strats.map((strat: any) => strat.id));
  for (const strat of archive.strats || []) {
    if (!currentStratIds.has(strat.id)) db.strats.push(clone(strat));
  }
  db.settings.season = archive.seasonName;
  db.settings.riotIds = clone(archive.riotIds || {});
  if (db.rosterPlayers.length > 0 || db.coreMemberships.length > 0) {
    syncLegacyCoreNames(db);
    db.settings.inactivePlayers = clone(archive.legacyInactivePlayers || []);
  } else {
    db.settings.players = clone(archive.legacyPlayers || []);
    db.settings.inactivePlayers = clone(archive.legacyInactivePlayers || []);
  }
  return archive;
}

function emptyAdapterArchive() {
  return { schemaVersion: 1, replay: {}, ratings: { records: {} }, ranked: { accounts: {}, consents: {}, states: {} }, idempotency: {} };
}

function archiveSeasonAdapters(db: any, archive: any) {
  const source = db.engineAdapters;
  const snapshot: any = emptyAdapterArchive();
  if (!source || typeof source !== 'object' || Array.isArray(source)) return snapshot;
  const matchIds = new Set((archive.matches || []).map((item: any) => item?.id).filter(Boolean));
  const playerIds = new Set((archive.rosterPlayers || []).map((item: any) => item?.id).filter(Boolean));
  for (const item of archive.coreMemberships || []) if (item?.playerId) playerIds.add(item.playerId);
  for (const item of archive.playerStats || []) if (item?.playerId) playerIds.add(item.playerId);
  for (const item of archive.tryoutBatches || []) for (const playerId of item?.candidatePlayerIds || []) if (playerId) playerIds.add(playerId);
  for (const [key, record] of Object.entries(source.replay || {}) as any) if (matchIds.has(record?.matchId || key)) {
    snapshot.replay[key] = clone(record);
    for (const item of record?.draft?.playerTotals || []) if (item?.playerId) playerIds.add(item.playerId);
    for (const item of record?.draft?.evidence?.playerMetrics || []) if (item?.playerId) playerIds.add(item.playerId);
  }
  for (const [key, record] of Object.entries(source.ratings?.records || {}) as any) {
    const linkedMatches = record?.input?.context?.matchIds || record?.result?.context?.matchIds || [];
    const linkedPlayer = record?.result?.context?.playerId || record?.input?.context?.playerId;
    if (playerIds.has(linkedPlayer) || (Array.isArray(linkedMatches) && linkedMatches.some((id: any) => matchIds.has(id)))) {
      snapshot.ratings.records[key] = clone(record);
      if (linkedPlayer) playerIds.add(linkedPlayer);
    }
  }
  // Ranked records in the active adapter store are explicit season identities.
  for (const record of Object.values(source.ranked?.accounts || {}) as any[]) if (record?.playerId) playerIds.add(record.playerId);
  for (const collection of ['accounts', 'consents', 'states']) {
    for (const [key, record] of Object.entries(source.ranked?.[collection] || {}) as any) if (playerIds.has(record?.playerId)) snapshot.ranked[collection][key] = clone(record);
  }
  // Ledger entries are opaque hashes. Snapshot and clear them as a unit so a
  // restored season gets exactly its original retry semantics without guesses.
  snapshot.idempotency = clone(source.idempotency || {});
  return snapshot;
}

function archiveSeasonAccessIdentities(db: any, archive: any, adapterSnapshot: any) {
  const playerIds = new Set<string>((archive.rosterPlayers || []).map((item: any) => item?.id).filter(Boolean));
  const playerNames = new Set<string>([
    ...(archive.rosterPlayers || []).map((item: any) => item?.displayName),
    ...(archive.legacyPlayers || []),
    ...(archive.playerStats || []).flatMap((item: any) => [item?.player, item?.displayNameSnapshot]),
  ].filter(Boolean).map((value: any) => String(value).trim().toLocaleLowerCase()));
  for (const item of archive.coreMemberships || []) if (item?.playerId) playerIds.add(item.playerId);
  for (const item of archive.playerStats || []) if (item?.playerId) playerIds.add(item.playerId);
  for (const item of archive.tryoutBatches || []) for (const playerId of item?.candidatePlayerIds || []) if (playerId) playerIds.add(playerId);
  for (const record of Object.values(adapterSnapshot?.replay || {}) as any[]) {
    for (const item of record?.draft?.playerTotals || []) if (item?.playerId) playerIds.add(item.playerId);
    for (const item of record?.draft?.evidence?.playerMetrics || []) if (item?.playerId) playerIds.add(item.playerId);
  }
  for (const collection of ['accounts', 'consents', 'states']) for (const record of Object.values(adapterSnapshot?.ranked?.[collection] || {}) as any[]) if (record?.playerId) playerIds.add(record.playerId);
  for (const record of Object.values(adapterSnapshot?.ratings?.records || {}) as any[]) {
    const playerId = record?.input?.context?.playerId || record?.result?.context?.playerId;
    if (playerId) playerIds.add(playerId);
  }
  return {
    authKeys: clone((db.authKeys || []).filter((item: any) => item?.role === 'player' && (playerIds.has(item?.playerId) || playerNames.has(String(item?.label || '').trim().toLocaleLowerCase())))),
    allowedUsers: clone((db.allowedUsers || []).filter((item: any) => item?.role === 'player' && (playerIds.has(item?.playerId) || playerNames.has(String(item?.name || '').trim().toLocaleLowerCase())))),
  };
}

function removeArchivedAccessIdentities(db: any, snapshot: any) {
  const keyIds = new Set((snapshot?.authKeys || []).map((item: any) => item.id));
  const emails = new Set((snapshot?.allowedUsers || []).map((item: any) => String(item.email || '').toLocaleLowerCase()));
  db.authKeys = (db.authKeys || []).filter((item: any) => !keyIds.has(item.id));
  db.allowedUsers = (db.allowedUsers || []).filter((item: any) => !emails.has(String(item.email || '').toLocaleLowerCase()));
}

function restoreArchivedAccessIdentities(db: any, snapshot: any) {
  if (!snapshot) return;
  const mergeExact = (target: any[], source: any[], identity: (item: any) => string, label: string) => {
    for (const value of source || []) {
      const key = identity(value); const current = target.find(item => identity(item) === key);
      if (current && JSON.stringify(current) !== JSON.stringify(value)) fail(`Cannot restore ${label} because active identity ${key} conflicts.`, 409);
      if (!current) target.push(clone(value));
    }
  };
  db.authKeys ||= []; db.allowedUsers ||= [];
  mergeExact(db.authKeys, snapshot.authKeys, item => String(item.id), 'access key');
  mergeExact(db.allowedUsers, snapshot.allowedUsers, item => String(item.email || '').toLocaleLowerCase(), 'Google access');
}

function removeArchivedAdapters(db: any, snapshot: any) {
  if (!db.engineAdapters || !snapshot) return;
  for (const key of Object.keys(snapshot.replay || {})) delete db.engineAdapters.replay?.[key];
  for (const key of Object.keys(snapshot.ratings?.records || {})) delete db.engineAdapters.ratings?.records?.[key];
  for (const collection of ['accounts', 'consents', 'states']) for (const key of Object.keys(snapshot.ranked?.[collection] || {})) delete db.engineAdapters.ranked?.[collection]?.[key];
  db.engineAdapters.idempotency = {};
}

function restoreArchivedAdapters(db: any, snapshot: any) {
  if (!snapshot) return;
  db.engineAdapters ||= { schemaVersion: 1, idempotency: {}, replay: {}, ratings: { configs: {}, records: {}, formulaVersions: {}, baselineVersions: {} }, ranked: { providers: {}, accounts: {}, consents: {}, states: {} } };
  const target = clone(db.engineAdapters);
  target.replay ||= {}; target.ratings ||= {}; target.ratings.records ||= {}; target.ranked ||= {};
  for (const collection of ['accounts', 'consents', 'states']) target.ranked[collection] ||= {};
  const mergeExact = (into: any, from: any, label: string) => {
    for (const [key, value] of Object.entries(from || {})) {
      if (into[key] !== undefined && JSON.stringify(into[key]) !== JSON.stringify(value)) fail(`Cannot restore ${label} because active identity ${key} conflicts.`, 409);
      into[key] = clone(value);
    }
  };
  mergeExact(target.replay, snapshot.replay, 'replay evidence');
  mergeExact(target.ratings.records, snapshot.ratings?.records, 'rating evidence');
  for (const collection of ['accounts', 'consents', 'states']) mergeExact(target.ranked[collection], snapshot.ranked?.[collection], `ranked ${collection}`);
  target.idempotency ||= {};
  mergeExact(target.idempotency, snapshot.idempotency, 'idempotency ledger');
  db.engineAdapters = target;
}

export function activeCorePlayerIds(db: any): Set<string> {
  ensureRoster(db);
  return new Set(db.coreMemberships.filter((membership: any) => !membership.endedAt).map((membership: any) => membership.playerId));
}

export function syncLegacyCoreNames(db: any) {
  const activeIds = activeCorePlayerIds(db);
  db.settings.players = db.rosterPlayers
    .filter((player: any) => activeIds.has(player.id) && !player.retiredAt)
    .map((player: any) => player.displayName);
  db.settings.inactivePlayers = [];
}

function playerById(db: any, playerId: string) {
  const player = db.rosterPlayers.find((entry: any) => entry.id === playerId);
  if (!player) fail('Roster player was not found.', 404);
  return player;
}

function batchById(db: any, batchId: string) {
  const batch = db.tryoutBatches.find((entry: any) => entry.id === batchId);
  if (!batch) fail('Tryout batch was not found.', 404);
  return batch;
}

function assertUniqueActiveBatchName(db: any, name: string, excludedBatchId?: string) {
  const normalized = name.trim().toLocaleLowerCase();
  if (db.tryoutBatches.some((batch: any) => batch.id !== excludedBatchId && batch.status === 'active' && batch.name.toLocaleLowerCase() === normalized)) {
    fail('An active tryout batch already uses this name.', 409);
  }
}

export function createRosterPlayer(db: any, displayName: string, idFactory = defaultId, clock = defaultClock) {
  ensureRoster(db);
  const cleanName = displayName.trim();
  if (db.rosterPlayers.some((player: any) => !player.retiredAt && player.displayName.toLocaleLowerCase() === cleanName.toLocaleLowerCase())) {
    fail('An active roster player already uses this name.', 409);
  }
  const player = { id: idFactory(), displayName: cleanName, createdAt: clock() };
  db.rosterPlayers.push(player);
  return player;
}

export function retireRosterPlayer(db: any, playerId: string, clock = defaultClock) {
  ensureRoster(db);
  const player = playerById(db, playerId);
  if (player.retiredAt) return { player, changed: false };
  const retiredAt = clock();
  player.retiredAt = retiredAt;
  for (const membership of db.coreMemberships) if (membership.playerId === playerId && !membership.endedAt) membership.endedAt = retiredAt;
  for (const batch of db.tryoutBatches) if (batch.status === 'active') batch.candidatePlayerIds = batch.candidatePlayerIds.filter((id: string) => id !== playerId);
  for (const key of db.authKeys || []) if (key.playerId === playerId && !key.revokedAt) key.revokedAt = retiredAt;
  for (const device of Object.values(db.replayIntake?.devices || {}) as any[]) if (device.owner?.playerId === playerId && !device.revokedAt) device.revokedAt = retiredAt;
  syncLegacyCoreNames(db);
  return { player, changed: true };
}

export function addCoreMembership(db: any, playerId: string, sourceTryoutBatchId?: string, idFactory = defaultId, clock = defaultClock) {
  ensureRoster(db);
  playerById(db, playerId);
  const existing = db.coreMemberships.find((membership: any) => membership.playerId === playerId && !membership.endedAt);
  if (existing) return { membership: existing, created: false };
  const membership = {
    id: idFactory(),
    playerId,
    joinedAt: clock(),
    ...(sourceTryoutBatchId ? { sourceTryoutBatchId } : {}),
  };
  db.coreMemberships.push(membership);
  syncLegacyCoreNames(db);
  return { membership, created: true };
}

export function endCoreMembership(db: any, playerId: string, clock = defaultClock) {
  ensureRoster(db);
  playerById(db, playerId);
  const membership = db.coreMemberships.find((entry: any) => entry.playerId === playerId && !entry.endedAt);
  if (!membership) return { membership: null, changed: false };
  membership.endedAt = clock();
  syncLegacyCoreNames(db);
  return { membership, changed: true };
}

export function createTryoutBatch(db: any, name: string, idFactory = defaultId, clock = defaultClock) {
  ensureRoster(db);
  const cleanName = name.trim();
  assertUniqueActiveBatchName(db, cleanName);
  const batch = { id: idFactory(), name: cleanName, status: 'active', candidatePlayerIds: [], createdAt: clock() };
  db.tryoutBatches.push(batch);
  return batch;
}

export function addTryoutCandidate(db: any, batchId: string, playerId: string) {
  ensureRoster(db);
  const player = playerById(db, playerId);
  const batch = batchById(db, batchId);
  if (batch.status !== 'active') fail('Candidates can be added only to an active tryout batch.', 409);
  if (!batch.candidatePlayerIds.includes(player.id)) batch.candidatePlayerIds.push(player.id);
  return batch;
}

export function archiveAndResetTryoutBatch(db: any, batchId: string, newBatchName: string, idFactory = defaultId, clock = defaultClock) {
  ensureRoster(db);
  const batch = batchById(db, batchId);
  if (batch.status !== 'active') fail('Only an active tryout batch can be archived.', 409);
  const cleanName = newBatchName.trim();
  assertUniqueActiveBatchName(db, cleanName, batch.id);
  const archivedAt = clock();
  batch.status = 'archived';
  batch.archivedAt = archivedAt;
  const replacement = { id: idFactory(), name: cleanName, status: 'active', candidatePlayerIds: [], createdAt: archivedAt };
  db.tryoutBatches.push(replacement);
  return { archived: batch, replacement };
}

export function restoreTryoutBatch(db: any, batchId: string) {
  ensureRoster(db);
  const batch = batchById(db, batchId);
  if (batch.status !== 'archived') return { batch, changed: false };
  assertUniqueActiveBatchName(db, batch.name, batch.id);
  batch.status = 'active';
  delete batch.archivedAt;
  return { batch, changed: true };
}

export function promoteTryoutCandidate(db: any, batchId: string, playerId: string, idFactory = defaultId, clock = defaultClock) {
  ensureRoster(db);
  const batch = batchById(db, batchId);
  playerById(db, playerId);
  if (batch.status !== 'active') fail('Candidates can be promoted only from an active tryout batch.', 409);
  if (!batch.candidatePlayerIds.includes(playerId)) fail('Player is not a candidate in this tryout batch.', 409);
  return addCoreMembership(db, playerId, batch.id, idFactory, clock);
}
