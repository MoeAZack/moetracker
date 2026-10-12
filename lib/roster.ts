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

const SEASON_ARRAY_KEYS = [
  'rosterPlayers', 'coreMemberships', 'tryoutBatches', 'schedule', 'goals',
  'matches', 'playerStats', 'soloq', 'rounds', 'vetos', 'stratRuns', 'vodReviews',
] as const;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
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
  db.seasonArchives.push(archive);

  for (const key of SEASON_ARRAY_KEYS) db[key] = [];
  db.settings.season = newSeasonName.trim();
  db.settings.players = [];
  db.settings.inactivePlayers = [];
  db.settings.riotIds = {};
  return archive;
}

export function restoreSeasonArchive(db: any, archiveId: string) {
  ensureRoster(db);
  const archive = db.seasonArchives.find((entry: any) => entry.id === archiveId);
  if (!archive) fail('Season archive was not found.', 404);
  if (hasActiveSeasonData(db)) {
    fail('Archive the current active season before restoring another season.', 409);
  }
  for (const key of SEASON_ARRAY_KEYS) db[key] = clone(Array.isArray(archive[key]) ? archive[key] : []);
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
