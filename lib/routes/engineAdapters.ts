import type { Express, Request, Response } from 'express';
import crypto from 'crypto';
import { readDB, saveDB } from '../store';
import { buildReplayOpeningReviewDraft, type ReplayParserDraftInput, type ReplayReviewReference } from '../replayOpeningEngine';
import {
  calculateShadowPlayerRating, previewShadowRatingWeights, SHADOW_RATING_ENGINE_VERSION,
  type PlayerRatingFormula, type PlayerRatingInput, type RatingBaseline,
} from '../playerRatingEngine';
import {
  RANKED_SYNC_ENGINE_VERSION, validateProviderCapability, validateRankedConsentRecord, applyRankedSyncOutcome,
  type ProviderCapability, type RankedAccountIdentity, type RankedConsent, type RankedSyncState,
  type SyncOutcome,
} from '../rankedSyncEngine';

type Actor = { role: 'coach' | 'player'; username: string; playerId?: string; actorId: string };
type Stored<T> = T & { revision: number; requestId: string; requestHash: string; updatedAt: string };

const bad = (res: Response, message: string, status = 400) => res.status(status).json({ error: message });
const actor = (req: Request) => (req as any).user as Actor;
const coach = (req: Request, res: Response) => actor(req)?.role === 'coach' || !bad(res, 'Only a coach can manage engine evidence.', 403);
const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null;
const revision = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;

function adapters(db: any) {
  db.engineAdapters ||= { schemaVersion: 1, idempotency: {}, replay: {}, ratings: { configs: {}, records: {}, formulaVersions: {}, baselineVersions: {} }, ranked: { providers: {}, accounts: {}, consents: {}, states: {} } };
  db.engineAdapters.idempotency ||= {};
  db.engineAdapters.replay ||= {};
  db.engineAdapters.ratings ||= { configs: {}, records: {} };
  db.engineAdapters.ratings.configs ||= {}; db.engineAdapters.ratings.records ||= {};
  db.engineAdapters.ratings.formulaVersions ||= {}; db.engineAdapters.ratings.baselineVersions ||= {};
  for (const config of Object.values(db.engineAdapters.ratings.configs) as any[]) {
    if (config?.formula?.version) {
      canonicalIdentity(config.formula.version, 'stored formula.version');
      const hash = contentHash(config.formula); const prior = db.engineAdapters.ratings.formulaVersions[config.formula.version];
      if (prior && prior !== hash) throw Object.assign(new Error('Stored formula version identities conflict.'), { status: 409 });
      db.engineAdapters.ratings.formulaVersions[config.formula.version] = hash;
    }
    if (config?.baseline?.version) {
      canonicalIdentity(config.baseline.id, 'stored baseline.id'); canonicalIdentity(config.baseline.version, 'stored baseline.version');
      canonicalIdentity(config.baseline.source?.id, 'stored baseline.source.id'); canonicalIdentity(config.baseline.source?.version, 'stored baseline.source.version');
      const hash = contentHash(config.baseline); const prior = db.engineAdapters.ratings.baselineVersions[config.baseline.version];
      if (prior && prior !== hash) throw Object.assign(new Error('Stored baseline version identities conflict.'), { status: 409 });
      db.engineAdapters.ratings.baselineVersions[config.baseline.version] = hash;
    }
  }
  db.engineAdapters.ranked ||= { providers: {}, accounts: {}, consents: {}, states: {} };
  for (const key of ['providers', 'accounts', 'consents', 'states']) db.engineAdapters.ranked[key] ||= {};
  return db.engineAdapters;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, nested]) => `${JSON.stringify(key)}:${canonical(nested)}`).join(',')}}`;
  return JSON.stringify(value);
}
const contentHash = (value: unknown) => crypto.createHash('sha256').update(canonical(value)).digest('hex');
const onlyKeys = (value: any, keys: readonly string[]) => !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key));
const IDENTITY = /^[A-Za-z0-9][A-Za-z0-9._/@-]{0,127}$/;
function canonicalIdentity(value: unknown, label: string) {
  if (typeof value !== 'string' || value !== value.trim() || value.normalize('NFKC') !== value || !IDENTITY.test(value)) throw Object.assign(new Error(`${label} must be a canonical nonempty ASCII identity.`), { status: 400 });
  return value;
}
function normalizeRatingIdentities(formulaRaw: any, baselineRaw: any, inputRaw: any) {
  const formula = structuredClone(formulaRaw); const baseline = structuredClone(baselineRaw); const input = structuredClone(inputRaw);
  formula.version = canonicalIdentity(formula.version, 'formula.version');
  baseline.id = canonicalIdentity(baseline.id, 'baseline.id'); baseline.version = canonicalIdentity(baseline.version, 'baseline.version');
  baseline.source = { id: canonicalIdentity(baseline.source?.id, 'baseline.source.id'), version: canonicalIdentity(baseline.source?.version, 'baseline.source.version') };
  input.context.source = { id: canonicalIdentity(input.context?.source?.id, 'input.context.source.id'), version: canonicalIdentity(input.context?.source?.version, 'input.context.source.version') };
  return { formula, baseline, input } as { formula: PlayerRatingFormula; baseline: RatingBaseline; input: PlayerRatingInput };
}
function canonicalConfigKey(value: unknown) {
  if (typeof value !== 'string' || value !== value.trim() || value.normalize('NFKC') !== value || !/^[A-Za-z0-9._/@-]+:[A-Za-z0-9._/@-]+:[A-Za-z0-9._/@-]+$/.test(value)) throw Object.assign(new Error('configKey must use canonical version identities.'), { status: 400 });
  return value;
}

function normalizeReplayInput(raw: any): ReplayParserDraftInput {
  if (!onlyKeys(raw, ['parser', 'provenance', 'file', 'identities', 'summary', 'rounds', 'capabilities', 'observations', 'derivation'])) throw Object.assign(new Error('Replay input contains unsupported fields.'), { status: 400 });
  if (!onlyKeys(raw?.parser, ['name', 'version']) || !text(raw.parser.name) || !text(raw.parser.version)) throw Object.assign(new Error('Replay parser identity must contain only name and version.'), { status: 400 });
  if (!onlyKeys(raw?.file, ['format', 'support']) || !text(raw.file.format) || !['supported', 'unsupported', 'incomplete'].includes(raw.file.support)) throw Object.assign(new Error('Replay file metadata must contain only format and supported status.'), { status: 400 });
  if (!raw?.provenance || typeof raw.provenance !== 'object' || Array.isArray(raw.provenance)) throw Object.assign(new Error('Replay provenance is required.'), { status: 400 });
  for (const [key, value] of Object.entries(raw.provenance)) if (!/^[A-Za-z0-9._-]{1,80}$/.test(key) || (!['string', 'boolean'].includes(typeof value) && value !== null && !(typeof value === 'number' && Number.isFinite(value)))) throw Object.assign(new Error('Replay provenance keys and values must be safe scalars.'), { status: 400 });
  if (!Array.isArray(raw.identities) || !Array.isArray(raw.rounds)) throw Object.assign(new Error('Replay identities and rounds must be arrays.'), { status: 400 });
  raw.identities.forEach((item: any) => {
    if (!onlyKeys(item, ['playerId', 'teamId', 'displayName']) || !text(item.playerId) || !text(item.teamId) || (item.displayName !== undefined && typeof item.displayName !== 'string')) throw Object.assign(new Error('Replay identity is invalid.'), { status: 400 });
  });
  if (raw.summary !== undefined) validateReplaySummary(raw.summary);
  raw.rounds.forEach(validateReplayRound);
  if (raw.capabilities !== undefined) {
    if (!Array.isArray(raw.capabilities)) throw Object.assign(new Error('Replay capabilities must be an array.'), { status: 400 });
    raw.capabilities.forEach(validateReplayCapability);
  }
  if (raw.observations !== undefined) {
    if (!Array.isArray(raw.observations)) throw Object.assign(new Error('Replay observations must be an array.'), { status: 400 });
    raw.observations.forEach(validateReplayObservation);
  }
  if (raw.derivation !== undefined && (!onlyKeys(raw.derivation, ['tradeWindowMs']) || !finiteNonnegative(raw.derivation.tradeWindowMs))) throw Object.assign(new Error('Replay derivation is invalid.'), { status: 400 });
  return { ...structuredClone(raw), parser: { name: raw.parser.name.trim(), version: raw.parser.version.trim() }, file: { format: raw.file.format.trim(), support: raw.file.support } };
}

const finiteNonnegative = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const integerAtLeast = (value: unknown, minimum: number) => Number.isSafeInteger(value) && Number(value) >= minimum;
const nullableText = (value: unknown) => value === null || typeof value === 'string';
const REPLAY_SIGNALS = new Set(['eliminations', 'assists', 'damage', 'utility-cast', 'utility-effect', 'ultimate-use', 'plant', 'defuse', 'round-winner', 'round-end-reason', 'side', 'economy', 'loadout', 'credits', 'ultimate-state', 'site-entry', 'execute', 'rotation', 'retake', 'post-plant', 'save-eco-decision', 'objective-timing', 'position-zone', 'round-phase']);
function validateReplaySummary(summary: any) {
  if (!onlyKeys(summary, ['map', 'finalScore', 'roundCount', 'players']) || (summary.map !== undefined && !nullableText(summary.map)) || (summary.roundCount !== undefined && summary.roundCount !== null && !integerAtLeast(summary.roundCount, 0))) throw Object.assign(new Error('Replay summary is invalid.'), { status: 400 });
  if (summary.finalScore !== undefined && summary.finalScore !== null && (!onlyKeys(summary.finalScore, ['teamA', 'teamB']) || !integerAtLeast(summary.finalScore.teamA, 0) || !integerAtLeast(summary.finalScore.teamB, 0))) throw Object.assign(new Error('Replay final score is invalid.'), { status: 400 });
  if (summary.players !== undefined) {
    if (!Array.isArray(summary.players)) throw Object.assign(new Error('Replay summary players must be an array.'), { status: 400 });
    for (const player of summary.players) if (!onlyKeys(player, ['playerId', 'kills', 'deaths']) || !text(player.playerId) || (player.kills !== undefined && player.kills !== null && !integerAtLeast(player.kills, 0)) || (player.deaths !== undefined && player.deaths !== null && !integerAtLeast(player.deaths, 0))) throw Object.assign(new Error('Replay summary player is invalid.'), { status: 400 });
  }
}
function validateReplayRound(round: any) {
  if (!onlyKeys(round, ['roundNumber', 'sequenceCompleteFromStart', 'events', 'participantPlayerIds', 'participantCoverage', 'winnerTeamId', 'endReason', 'sideByTeam']) || !integerAtLeast(round.roundNumber, 1) || typeof round.sequenceCompleteFromStart !== 'boolean' || !Array.isArray(round.events) || (round.winnerTeamId !== undefined && !nullableText(round.winnerTeamId)) || (round.endReason !== undefined && !nullableText(round.endReason))) throw Object.assign(new Error('Replay round scalar fields are invalid.'), { status: 400 });
  if (round.participantPlayerIds !== undefined && (!Array.isArray(round.participantPlayerIds) || round.participantPlayerIds.some((id: any) => !text(id)))) throw Object.assign(new Error('Replay round participants are invalid.'), { status: 400 });
  if (round.participantCoverage !== undefined && (!onlyKeys(round.participantCoverage, ['status', 'expectedPlayerCount']) || !['complete', 'partial', 'unknown'].includes(round.participantCoverage.status) || (round.participantCoverage.expectedPlayerCount !== undefined && !integerAtLeast(round.participantCoverage.expectedPlayerCount, 0)))) throw Object.assign(new Error('Replay participant coverage is invalid.'), { status: 400 });
  if (round.sideByTeam !== undefined && (round.sideByTeam === null || typeof round.sideByTeam !== 'object' || Array.isArray(round.sideByTeam) || Object.entries(round.sideByTeam).some(([key, value]) => !text(key) || !['attack', 'defense', 'unknown'].includes(String(value))))) throw Object.assign(new Error('Replay side mapping is invalid.'), { status: 400 });
  round.events.forEach((event: any) => validateReplayEvent(event, round.roundNumber));
}
function validateReplayEvent(event: any, roundNumber: number) {
  const stringFields = ['eventId', 'killerPlayerId', 'victimPlayerId', 'killerTeamId', 'victimTeamId', 'duplicateOfEventId'];
  if (!onlyKeys(event, ['eventId', 'roundNumber', 'sequence', 'timestampMs', 'kind', 'killerPlayerId', 'victimPlayerId', 'killerTeamId', 'victimTeamId', 'identityStatus', 'duplicateOfEventId', 'resurrectionArtifact']) || event.roundNumber !== roundNumber || !['player-elimination', 'environmental', 'non-player', 'unknown'].includes(event.kind) || stringFields.some(key => event[key] !== undefined && !nullableText(event[key])) || (event.sequence !== undefined && event.sequence !== null && !integerAtLeast(event.sequence, 0)) || (event.timestampMs !== undefined && event.timestampMs !== null && !finiteNonnegative(event.timestampMs)) || (event.identityStatus !== undefined && !['resolved', 'ambiguous', 'unknown'].includes(event.identityStatus)) || (event.resurrectionArtifact !== undefined && typeof event.resurrectionArtifact !== 'boolean')) throw Object.assign(new Error('Replay event is invalid.'), { status: 400 });
}
function validateReplayCapability(item: any) {
  if (!onlyKeys(item, ['signal', 'support', 'grade', 'coveredRoundNumbers', 'details']) || !REPLAY_SIGNALS.has(item.signal) || !['complete', 'partial', 'unsupported'].includes(item.support) || !['event-log', 'video-observation', 'ocr', 'inference'].includes(item.grade) || (item.details !== undefined && typeof item.details !== 'string') || (item.coveredRoundNumbers !== undefined && (!Array.isArray(item.coveredRoundNumbers) || item.coveredRoundNumbers.some((round: any) => !integerAtLeast(round, 1))))) throw Object.assign(new Error('Replay capability is invalid.'), { status: 400 });
}
function validateReplayObservation(item: any) {
  if (!onlyKeys(item, ['observationId', 'roundNumber', 'signal', 'grade', 'explicitlyPresent', 'confidence', 'occurredAtMs', 'phase', 'playerId', 'targetPlayerId', 'teamId', 'attributes']) || !text(item.observationId) || !integerAtLeast(item.roundNumber, 1) || !REPLAY_SIGNALS.has(item.signal) || !['event-log', 'video-observation', 'ocr', 'inference'].includes(item.grade) || typeof item.explicitlyPresent !== 'boolean' || (item.confidence !== null && (!finiteNonnegative(item.confidence) || item.confidence > 1)) || (item.occurredAtMs !== undefined && item.occurredAtMs !== null && !finiteNonnegative(item.occurredAtMs)) || (item.phase !== undefined && !['pre-round', 'barrier', 'early', 'mid', 'late', 'post-plant', 'round-end', 'unknown'].includes(item.phase)) || ['playerId', 'targetPlayerId', 'teamId'].some(key => item[key] !== undefined && !nullableText(item[key])) || (item.attributes !== undefined && (item.attributes === null || typeof item.attributes !== 'object' || Array.isArray(item.attributes)))) throw Object.assign(new Error('Replay observation is invalid.'), { status: 400 });
}

function normalizeAccount(raw: any): RankedAccountIdentity {
  if (!onlyKeys(raw, ['providerAccountId', 'region', 'platform'])) throw Object.assign(new Error('Ranked account identity contains unsupported fields.'), { status: 400 });
  const providerAccountId = text(raw?.providerAccountId); const region = text(raw?.region); const platform = text(raw?.platform);
  if (!providerAccountId || !region || !platform) throw Object.assign(new Error('Exact account identity is required.'), { status: 400 });
  return { providerAccountId, region, platform };
}

function accountFingerprint(record: any) {
  return contentHash({
    playerId: typeof record?.playerId === 'string' ? record.playerId : null,
    providerId: typeof record?.providerId === 'string' ? record.providerId : null,
    account: {
      providerAccountId: typeof record?.account?.providerAccountId === 'string' ? record.account.providerAccountId : null,
      region: typeof record?.account?.region === 'string' ? record.account.region : null,
      platform: typeof record?.account?.platform === 'string' ? record.account.platform : null,
    },
    revision: Number.isSafeInteger(record?.revision) ? record.revision : null,
  });
}

function normalizeProvider(raw: any): ProviderCapability {
  if (!onlyKeys(raw, ['providerId', 'approvedStatus', 'configured', 'documentedEndpointFamily', 'sourceSchemaVersion', 'termsPolicyVersion', 'quota'])
    || (raw?.quota !== null && !onlyKeys(raw?.quota, ['limit', 'windowMs']))) throw Object.assign(new Error('Provider capability contains unsupported fields.'), { status: 400 });
  if (!['approved', 'pending', 'denied', 'unknown'].includes(raw?.approvedStatus) || typeof raw?.configured !== 'boolean'
    || !['documentedEndpointFamily', 'sourceSchemaVersion', 'termsPolicyVersion'].every(key => raw?.[key] === null || typeof raw?.[key] === 'string')
    || (raw?.quota !== null && (!Number.isSafeInteger(raw?.quota?.limit) || raw.quota.limit < 1 || !Number.isSafeInteger(raw?.quota?.windowMs) || raw.quota.windowMs < 1))) {
    throw Object.assign(new Error('Provider capability fields are invalid.'), { status: 400 });
  }
  const provider: ProviderCapability = {
    providerId: text(raw.providerId) || '', approvedStatus: raw.approvedStatus, configured: raw.configured,
    documentedEndpointFamily: text(raw.documentedEndpointFamily), sourceSchemaVersion: text(raw.sourceSchemaVersion),
    termsPolicyVersion: text(raw.termsPolicyVersion), quota: raw.quota === null ? null : { limit: raw.quota.limit, windowMs: raw.quota.windowMs },
  };
  if (!validateProviderCapability(provider)) throw Object.assign(new Error('Invalid or incomplete provider capability.'), { status: 400 });
  return provider;
}

function operationScope(req: Request, operation: string, target: string, requestId: string) {
  const user = actor(req);
  return contentHash({ operation, actorId: user.actorId, role: user.role, target, requestId });
}
function operationRetry(data: any, scope: string, requestHash: string) {
  const prior = data.idempotency[scope];
  if (!prior) return null;
  if (prior.requestHash !== requestHash) throw Object.assign(new Error('Idempotency key was reused with a different request.'), { status: 409 });
  return structuredClone(prior.response);
}
function rememberOperation(data: any, scope: string, requestHash: string, response: any) {
  data.idempotency[scope] = { requestHash, response: structuredClone(response), completedAt: new Date().toISOString() };
  const overflow = Object.entries(data.idempotency).sort(([, left]: any, [, right]: any) => String(left.completedAt).localeCompare(String(right.completedAt))).slice(0, -1000);
  for (const [expiredRequestId] of overflow) delete data.idempotency[expiredRequestId];
}

function nextRecord<T extends object>(current: Stored<any> | undefined, expected: number, requestId: string, requestHash: string, value: T): Stored<T> {
  if (current?.requestId === requestId) {
    if (current.requestHash !== requestHash) throw Object.assign(new Error('Idempotency key was reused with a different request.'), { status: 409 });
    return current as Stored<T>;
  }
  if ((current?.revision || 0) !== expected) throw Object.assign(new Error('Stale revision. Reload and retry.'), { status: 409 });
  return { ...structuredClone(value), revision: expected + 1, requestId, requestHash, updatedAt: new Date().toISOString() };
}
function transitionRecord<T extends object>(current: Stored<any>, expected: number, requestId: string, requestHash: string, value: T): Stored<T> {
  if ((current?.revision || 0) !== expected) throw Object.assign(new Error('Stale revision. Reload and retry.'), { status: 409 });
  return { ...structuredClone(value), revision: expected + 1, requestId, requestHash, updatedAt: new Date().toISOString() };
}

function writeInput(body: any) {
  const expected = revision(body?.expectedRevision);
  const requestId = text(body?.requestId);
  if (expected === null || !requestId) throw Object.assign(new Error('expectedRevision and requestId are required.'), { status: 400 });
  const requestHash = crypto.createHash('sha256').update(canonical(body)).digest('hex');
  return { expected, requestId, requestHash };
}

const publicString = (value: unknown) => typeof value === 'string' ? value : null;
const publicNumber = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null;
const publicStrings = (value: unknown) => Array.isArray(value) && value.every(item => typeof item === 'string') ? [...value] : null;
const publicMultikills = (value: unknown) => Array.isArray(value) ? value.filter(item => item && typeof item.playerId === 'string' && Number.isSafeInteger(item.kills)).map(item => ({ playerId: item.playerId, kills: item.kills })) : null;
const publicClutches = (value: unknown) => Array.isArray(value) ? value.filter(item => item && typeof item.playerId === 'string' && Number.isSafeInteger(item.opponents) && ['won', 'lost', 'unknown'].includes(item.result)).map(item => ({ playerId: item.playerId, opponents: item.opponents, result: item.result })) : null;

function replayPublic(record: any) {
  if (record?.status !== 'accepted') return null;
  const draft = record.draft;
  return {
    matchId: publicString(record.matchId), status: 'accepted', acceptedAt: publicString(record.acceptedAt),
    parser: { name: publicString(draft?.parser?.name), version: publicString(draft?.parser?.version) }, file: { format: publicString(draft?.file?.format), support: publicString(draft?.file?.support) },
    crossChecks: Array.isArray(draft?.crossChecks) ? draft.crossChecks.map((item: any) => ({ field: publicString(item?.field), status: publicString(item?.status) })) : [],
    coverage: { playedRounds: publicNumber(draft?.coverage?.playedRounds), resolvedRounds: publicNumber(draft?.coverage?.resolvedRounds), unknownRounds: publicNumber(draft?.coverage?.unknownRounds), resolvedPercent: publicNumber(draft?.coverage?.resolvedPercent) },
    playerTotals: Array.isArray(draft?.playerTotals) ? draft.playerTotals.map((item: any) => ({ playerId: publicString(item?.playerId), firstKills: publicNumber(item?.firstKills), firstDeaths: publicNumber(item?.firstDeaths) })) : [],
    evidence: {
      coverageBySignal: Array.isArray(draft?.evidence?.coverageBySignal) ? draft.evidence.coverageBySignal.map((item: any) => ({ signal: publicString(item?.signal), support: publicString(item?.support), grade: publicString(item?.grade), coveredRounds: publicNumber(item?.coveredRounds), playedRounds: publicNumber(item?.playedRounds) })) : [],
      playerMetrics: Array.isArray(draft?.evidence?.playerMetrics) ? draft.evidence.playerMetrics.map((item: any) => ({ playerId: publicString(item?.playerId), kills: publicNumber(item?.kills), deaths: publicNumber(item?.deaths), assists: publicNumber(item?.assists), damage: publicNumber(item?.damage), utilityCasts: publicNumber(item?.utilityCasts), utilityEffects: publicNumber(item?.utilityEffects), ultimateUses: publicNumber(item?.ultimateUses), plants: publicNumber(item?.plants), defuses: publicNumber(item?.defuses) })) : [],
      rounds: Array.isArray(draft?.evidence?.rounds) ? draft.evidence.rounds.map((round: any) => ({ roundNumber: publicNumber(round?.roundNumber), winnerTeamId: publicString(round?.winnerTeamId), endReason: publicString(round?.endReason), derived: { tradeOpportunities: publicNumber(round?.derived?.tradeOpportunities), successfulTrades: publicNumber(round?.derived?.successfulTrades), tradedDeathPlayerIds: publicStrings(round?.derived?.tradedDeathPlayerIds), multikills: publicMultikills(round?.derived?.multikills), clutches: publicClutches(round?.derived?.clutches) } })) : [],
    },
  };
}

function ratingPublic(record: any) {
  const result = record?.result;
  if (record?.status !== 'accepted' || !result?.eligibleForShadowAggregate || result?.calculation?.shadowScore === null) return null;
  return {
    playerId: publicString(result?.context?.playerId), status: 'accepted', label: publicString(result?.label), advisory: publicString(result?.advisory),
    formulaVersion: publicString(result?.formulaVersion), baseline: { id: publicString(result?.baseline?.id), version: publicString(result?.baseline?.version) },
    calibrationStatus: publicString(record.calibrationStatus), experimental: record.calibrationStatus !== 'calibrated',
    coverage: { availableWeight: publicNumber(result?.coverage?.availableWeight), totalWeight: publicNumber(result?.coverage?.totalWeight), ratio: publicNumber(result?.coverage?.ratio) },
    score: publicNumber(result?.calculation?.shadowScore), authoritativeScore: null, warnings: publicStrings(result?.warnings) || [],
    contributions: Array.isArray(result?.metrics) ? result.metrics.filter((metric: any) => metric?.included === true).map((metric: any) => ({ metric: publicString(metric?.metric), direction: publicString(metric?.direction), weightedContribution: publicNumber(metric?.weightedContribution) })) : [],
  };
}

function safeRankedForPlayer(data: any, playerId: string) {
  const accounts = Object.values(data.accounts).filter((item: any) => item.playerId === playerId).map((item: any) => ({
    playerId, providerId: publicString(item?.providerId), account: { providerAccountId: publicString(item?.account?.providerAccountId), region: publicString(item?.account?.region), platform: publicString(item?.account?.platform) }, revision: publicNumber(item?.revision), fingerprint: accountFingerprint(item),
  }));
  const consents = Object.values(data.consents).filter((item: any) => item.playerId === playerId).map((item: any) => ({
    playerId, providerId: publicString(item?.providerId), scopes: publicStrings(item?.scopes) || [], consentVersion: publicString(item?.consentVersion),
    grantedAt: publicString(item?.grantedAt), revokedAt: publicString(item?.revokedAt), revision: publicNumber(item?.revision),
  }));
  const states = Object.values(data.states).filter((item: any) => item.playerId === playerId).map((item: any) => ({
    playerId, providerId: publicString(item?.providerId), status: publicString(item?.status), lastSuccessfulSyncAt: publicString(item?.lastSuccessfulSyncAt),
    knownMatchCount: publicNumber(item?.knownMatchCount), lastErrorCode: publicString(item?.lastErrorCode), revision: publicNumber(item?.revision),
  }));
  return { engineVersion: RANKED_SYNC_ENGINE_VERSION, activation: 'disabled', accounts, consents, states };
}

const consentResponse = (item: any) => ({ playerId: item.playerId, providerId: item.providerId, scopes: [...item.scopes], consentVersion: item.consentVersion, grantedAt: item.grantedAt, revokedAt: item.revokedAt, revision: item.revision });

function rankedForCoach(data: any) {
  return {
    engineVersion: RANKED_SYNC_ENGINE_VERSION, activation: 'disabled',
    providers: Object.values(data.providers).map((item: any) => ({ providerId: item.providerId, approvedStatus: item.approvedStatus, configured: item.configured, documentedEndpointFamily: item.documentedEndpointFamily, sourceSchemaVersion: item.sourceSchemaVersion, termsPolicyVersion: item.termsPolicyVersion, quota: item.quota ? { limit: item.quota.limit, windowMs: item.quota.windowMs } : null, revision: item.revision })),
    accounts: Object.values(data.accounts).map((item: any) => ({ playerId: item.playerId, providerId: item.providerId, account: { providerAccountId: item.account.providerAccountId, region: item.account.region, platform: item.account.platform }, revision: item.revision, fingerprint: accountFingerprint(item) })),
    consents: Object.values(data.consents).map((item: any) => ({ playerId: item.playerId, providerId: item.providerId, scopes: [...item.scopes], consentVersion: item.consentVersion, grantedAt: item.grantedAt, revokedAt: item.revokedAt, grantedBy: item.grantedBy ? { kind: item.grantedBy.kind, playerId: item.grantedBy.playerId, username: item.grantedBy.username } : null, revision: item.revision })),
    states: Object.values(data.states).map((item: any) => ({ playerId: item.playerId, providerId: item.providerId, status: item.status, lastAttemptAt: item.lastAttemptAt, lastSuccessfulSyncAt: item.lastSuccessfulSyncAt, knownMatchCount: item.knownMatchCount, lastErrorCode: item.lastErrorCode, revision: item.revision })),
  };
}

export function registerEngineAdapterRoutes(app: Express) {
  app.get('/api/engine-adapters', async (req, res) => {
    try {
      const db = await readDB(); const data = adapters(db); const user = actor(req);
      const activeMatchIds = new Set((db.matches || []).map((item: any) => item?.id).filter(Boolean));
      const activePlayerIds = new Set((db.rosterPlayers || []).map((item: any) => item?.id).filter(Boolean));
      for (const item of db.coreMemberships || []) if (item?.playerId) activePlayerIds.add(item.playerId);
      for (const item of db.playerStats || []) if (item?.playerId && activeMatchIds.has(item.matchId)) activePlayerIds.add(item.playerId);
      const activeReplay = Object.values(data.replay).filter((item: any) => activeMatchIds.has(item?.matchId));
      const activeRatings = Object.fromEntries(Object.entries(data.ratings.records).filter(([, item]: any) => {
        const matchIds = item?.input?.context?.matchIds || item?.result?.context?.matchIds || [];
        const playerId = item?.input?.context?.playerId || item?.result?.context?.playerId;
        return activePlayerIds.has(playerId) && Array.isArray(matchIds) && matchIds.length > 0 && matchIds.every((id: any) => activeMatchIds.has(id));
      }));
      const activeRanked = {
        ...data.ranked,
        accounts: Object.fromEntries(Object.entries(data.ranked.accounts).filter(([, item]: any) => activePlayerIds.has(item?.playerId))),
        consents: Object.fromEntries(Object.entries(data.ranked.consents).filter(([, item]: any) => activePlayerIds.has(item?.playerId))),
        states: Object.fromEntries(Object.entries(data.ranked.states).filter(([, item]: any) => activePlayerIds.has(item?.playerId))),
      };
      if (user.role === 'coach') return res.json({ replay: activeReplay, ratings: { ...data.ratings, records: activeRatings }, ranked: rankedForCoach(activeRanked) });
      if (!user.playerId) return res.json({ replay: [], ratings: [], ranked: { engineVersion: RANKED_SYNC_ENGINE_VERSION, activation: 'disabled', accounts: [], consents: [], states: [] } });
      res.json({
        replay: activeReplay.map(replayPublic).filter(Boolean),
        ratings: Object.values(activeRatings).map(ratingPublic).filter((item: any) => item?.playerId === user.playerId),
        ranked: safeRankedForPlayer(activeRanked, user.playerId),
      });
    } catch (error: any) { bad(res, error.message, error.status || 500); }
  });

  app.post('/api/engine-adapters/replay/draft', async (req, res) => {
    try {
      if (!coach(req, res)) return;
      const matchId = text(req.body?.matchId); if (!matchId) return bad(res, 'matchId is required.');
      const { expected, requestId, requestHash } = writeInput(req.body);
      const parserInput = normalizeReplayInput(req.body.parserInput);
      const draft = buildReplayOpeningReviewDraft(parserInput, req.body.reference as ReplayReviewReference | undefined);
      if (draft.crossChecks.some(item => item.status === 'mismatch') || draft.evidence.observationIssues.length) return bad(res, 'Replay draft conflicts with its review reference or declared evidence coverage.', 409);
      const db = await readDB(); if (!(db.matches || []).some((match: any) => match.id === matchId)) return bad(res, 'Replay drafts require an active-season match.', 404);
      const data = adapters(db); const current = data.replay[matchId];
      const record = nextRecord(current, expected, requestId, requestHash, { matchId, status: 'review-required', acceptedAt: null, draft });
      if (record !== current) { data.replay[matchId] = record; await saveDB(db); }
      res.json(record);
    } catch (error: any) { bad(res, error.message, error.status || 400); }
  });

  app.post('/api/engine-adapters/replay/accept', async (req, res) => {
    try {
      if (!coach(req, res)) return;
      const matchId = text(req.body?.matchId); if (!matchId) return bad(res, 'matchId is required.');
      const { expected, requestId, requestHash } = writeInput(req.body); const db = await readDB(); const data = adapters(db); const current = data.replay[matchId];
      if (!(db.matches || []).some((match: any) => match.id === matchId) || !current) return bad(res, 'A persisted replay draft for an authorized match is required.', 404);
      const scope = operationScope(req, 'replay-accept', `match:${matchId}`, requestId);
      const prior = operationRetry(data, scope, requestHash); if (prior) return res.json(prior);
      if (current.status !== 'review-required') return bad(res, 'A current review-required draft is required.', 409);
      const record = transitionRecord(current, expected, requestId, requestHash, { ...current, status: 'accepted', acceptedAt: new Date().toISOString() });
      if (record !== current) { data.replay[matchId] = record; rememberOperation(data, scope, requestHash, record); await saveDB(db); }
      res.json(record);
    } catch (error: any) { bad(res, error.message, error.status || 400); }
  });

  app.post('/api/engine-adapters/ratings/config', async (req, res) => {
    try {
      if (!coach(req, res)) return;
      const { expected, requestId, requestHash } = writeInput(req.body);
      const { formula, baseline, input: validationInput } = normalizeRatingIdentities(req.body.formula, req.body.baseline, req.body.validationInput);
      calculateShadowPlayerRating(validationInput, baseline, formula);
      const key = `${formula.version}:${baseline.id}:${baseline.version}`; const db = await readDB(); const data = adapters(db); const current = data.ratings.configs[key];
      const formulaHash = contentHash(formula); const baselineHash = contentHash(baseline);
      const lockedFormula = data.ratings.formulaVersions[formula.version]; const lockedBaseline = data.ratings.baselineVersions[baseline.version];
      if (lockedFormula && lockedFormula !== formulaHash) return bad(res, 'Formula version is immutable and already identifies different content.', 409);
      if (lockedBaseline && lockedBaseline !== baselineHash) return bad(res, 'Baseline version is immutable and already identifies different content.', 409);
      const record = nextRecord(current, expected, requestId, requestHash, { key, calibrationStatus: 'uncalibrated', label: 'Uncalibrated experimental shadow configuration', engineVersion: SHADOW_RATING_ENGINE_VERSION, formula, baseline, formulaHash, baselineHash });
      if (record !== current) { data.ratings.configs[key] = record; data.ratings.formulaVersions[formula.version] = formulaHash; data.ratings.baselineVersions[baseline.version] = baselineHash; await saveDB(db); }
      res.json(record);
    } catch (error: any) { bad(res, error.message, error.status || 400); }
  });

  app.post('/api/engine-adapters/ratings/preview', async (req, res) => {
    try {
      if (!coach(req, res)) return;
      const db = await readDB(); const config = adapters(db).ratings.configs[canonicalConfigKey(req.body?.configKey)];
      if (!config) return bad(res, 'Unknown rating configuration.', 404);
      res.json(previewShadowRatingWeights(req.body.input, config.baseline, config.formula, req.body.candidateFormula));
    } catch (error: any) { bad(res, error.message, error.status || 400); }
  });

  app.post('/api/engine-adapters/ratings/recompute', async (req, res) => {
    try {
      if (!coach(req, res)) return;
      const { expected, requestId, requestHash } = writeInput(req.body); const db = await readDB(); const data = adapters(db);
      const config = data.ratings.configs[canonicalConfigKey(req.body?.configKey)]; if (!config) return bad(res, 'Unknown rating configuration.', 404);
      const { input: normalizedIdentityInput } = normalizeRatingIdentities(config.formula, config.baseline, req.body.input);
      const result = calculateShadowPlayerRating(normalizedIdentityInput, config.baseline, config.formula);
      const normalizedInput: PlayerRatingInput = {
        context: structuredClone(result.context),
        metrics: Object.fromEntries(result.metrics.map(metric => [metric.metric, structuredClone(metric.input)])) as PlayerRatingInput['metrics'],
      };
      const recordKey = `${result.context.playerId}:${result.seriesKey}`; const current = data.ratings.records[recordKey];
      const record = nextRecord(current, expected, requestId, requestHash, { recordKey, status: 'review-required', acceptedAt: null, calibrationStatus: config.calibrationStatus, experimental: config.calibrationStatus !== 'calibrated', input: normalizedInput, configKey: config.key, result });
      if (record !== current) { data.ratings.records[recordKey] = record; await saveDB(db); }
      res.json(record);
    } catch (error: any) { bad(res, error.message, error.status || 400); }
  });

  app.post('/api/engine-adapters/ratings/accept', async (req, res) => {
    try {
      if (!coach(req, res)) return;
      const { expected, requestId, requestHash } = writeInput(req.body); const key = text(req.body?.recordKey); if (!key) return bad(res, 'recordKey is required.');
      const db = await readDB(); const data = adapters(db); const current = data.ratings.records[key];
      if (!current) return bad(res, 'A persisted rating target is required.', 404);
      const scope = operationScope(req, 'rating-accept', `rating:${key}`, requestId);
      const prior = operationRetry(data, scope, requestHash); if (prior) return res.json(prior);
      if (current.status !== 'review-required') return bad(res, 'A current recomputed rating is required.', 409);
      const record = transitionRecord(current, expected, requestId, requestHash, { ...current, status: 'accepted', acceptedAt: new Date().toISOString() });
      if (record !== current) { data.ratings.records[key] = record; rememberOperation(data, scope, requestHash, record); await saveDB(db); } res.json(record);
    } catch (error: any) { bad(res, error.message, error.status || 400); }
  });

  app.post('/api/engine-adapters/ranked/provider', async (req, res) => {
    try {
      if (!coach(req, res)) return;
      const { expected, requestId, requestHash } = writeInput(req.body); const provider = normalizeProvider(req.body.provider);
      const db = await readDB(); const data = adapters(db); const current = data.ranked.providers[provider.providerId];
      const record = nextRecord(current, expected, requestId, requestHash, { ...provider, activation: 'disabled', engineVersion: RANKED_SYNC_ENGINE_VERSION });
      if (record !== current) { data.ranked.providers[provider.providerId] = record; await saveDB(db); } res.json(record);
    } catch (error: any) { bad(res, error.message, error.status || 400); }
  });

  app.post('/api/engine-adapters/ranked/account', async (req, res) => {
    try {
      if (!coach(req, res)) return;
      const { expected, requestId, requestHash } = writeInput(req.body); const playerId = text(req.body.playerId); const providerId = text(req.body.providerId);
      const account = normalizeAccount(req.body.account);
      if (!playerId || !providerId) return bad(res, 'Exact player and provider identity are required.');
      const db = await readDB(); if (!(db.rosterPlayers || []).some((item: any) => item.id === playerId && !item.retiredAt)) return bad(res, 'Ranked accounts require an active roster identity.', 409);
      const data = adapters(db); if (!data.ranked.providers[providerId]) return bad(res, 'Provider capability is not persisted.', 409);
      const key = `${playerId}:${providerId}`; const current = data.ranked.accounts[key];
      const activeConsent = data.ranked.consents[key];
      const accountChanged = !current || JSON.stringify(current.account) !== JSON.stringify(account);
      if (current && activeConsent && !activeConsent.revokedAt && accountChanged) return bad(res, 'Revoke active consent before changing the exact account identity.', 409);
      const record = nextRecord(current, expected, requestId, requestHash, { playerId, providerId, account: structuredClone(account) });
      if (record !== current) { data.ranked.accounts[key] = record; if (accountChanged || !data.ranked.states[key]) data.ranked.states[key] = initialState(playerId, providerId, account); await saveDB(db); } res.json(record);
    } catch (error: any) { bad(res, error.message, error.status || 400); }
  });

  app.post('/api/engine-adapters/ranked/consent', async (req, res) => {
    try {
      const user = actor(req);
      if (user.role !== 'player' || !user.playerId || (req.body.playerId && req.body.playerId !== user.playerId)) return bad(res, 'Only the bound player may grant their own ranked consent.', 403);
      const requestedPlayerId = user.playerId;
      const { expected, requestId, requestHash } = writeInput(req.body); const providerId = text(req.body.providerId); if (!providerId) return bad(res, 'providerId is required.');
      const db = await readDB(); const data = adapters(db); const key = `${requestedPlayerId}:${providerId}`; const accountRecord = data.ranked.accounts[key];
      if (!accountRecord) return bad(res, 'Coach-confirmed exact account identity is required.', 409);
      let displayedAccount: RankedAccountIdentity;
      try { displayedAccount = normalizeAccount(req.body.account); } catch { return bad(res, 'The displayed exact account identity is required. Reload and confirm it again.', 409); }
      const displayedRevision = revision(req.body.accountRevision); const displayedFingerprint = text(req.body.accountFingerprint);
      if (displayedRevision === null || !displayedFingerprint || displayedRevision !== accountRecord.revision
        || canonical(displayedAccount) !== canonical(accountRecord.account) || displayedFingerprint !== accountFingerprint(accountRecord)) {
        return bad(res, 'The ranked account changed after it was displayed. Reload and confirm the current exact account.', 409);
      }
      const now = new Date().toISOString(); const consent: RankedConsent = {
        playerId: requestedPlayerId, providerId, account: accountRecord.account,
        consentVersion: text(req.body.consentVersion) || '', scopes: req.body.scopes,
        grantedAt: now, revokedAt: null, obtainedThrough: 'explicit-ranked-consent',
      };
      if (!validateRankedConsentRecord(consent, now)) return bad(res, 'Invalid consent version or scopes.');
      const persistedConsent = { ...consent, grantedBy: { kind: 'bound-player-session', playerId: requestedPlayerId, username: user.username } };
      const current = data.ranked.consents[key]; const record = nextRecord(current, expected, requestId, requestHash, persistedConsent);
      if (record !== current) { data.ranked.consents[key] = record; await saveDB(db); } res.json(consentResponse(record));
    } catch (error: any) { bad(res, error.message, error.status || 400); }
  });

  app.post('/api/engine-adapters/ranked/revoke', async (req, res) => {
    try {
      const user = actor(req); const requestedPlayerId = user.role === 'player' ? user.playerId : text(req.body.playerId);
      if (!requestedPlayerId || (user.role === 'player' && req.body.playerId && req.body.playerId !== requestedPlayerId)) return bad(res, 'Player identity is not bound to this session.', 403);
      const { expected, requestId, requestHash } = writeInput(req.body); const providerId = text(req.body.providerId); const db = await readDB(); const data = adapters(db); const key = `${requestedPlayerId}:${providerId}`; const current = data.ranked.consents[key];
      if (!providerId || !data.ranked.providers[providerId] || !data.ranked.accounts[key] || !current) return bad(res, 'Authorized provider, account, and consent target are required.', 404);
      const scope = operationScope(req, 'ranked-consent-revoke', `player:${requestedPlayerId}:provider:${providerId}`, requestId);
      const prior = operationRetry(data, scope, requestHash); if (prior) return res.json(prior);
      if (current.revokedAt) return bad(res, 'Active consent is required.', 409);
      const record = transitionRecord(current, expected, requestId, requestHash, { ...current, revokedAt: new Date().toISOString() });
      if (record !== current) {
        data.ranked.consents[key] = record;
        const storedState = data.ranked.states[key];
        if (storedState) {
          const now = new Date().toISOString(); const state = stripStoredState(storedState);
          data.ranked.states[key] = {
            ...applyRankedSyncOutcome(state, { kind: 'blocked', generation: state.lastAttemptGeneration + 1, startedAt: now, at: now, errorCode: 'consent-revoked' }),
            revision: (storedState.revision || 0) + 1, requestId: `consent-revocation:${requestId}`, requestHash, updatedAt: now,
          };
        }
        const response = consentResponse(record); rememberOperation(data, scope, requestHash, response); await saveDB(db);
      } res.json(consentResponse(record));
    } catch (error: any) { bad(res, error.message, error.status || 400); }
  });

  app.post('/api/engine-adapters/ranked/outcome', async (req, res) => {
    try {
      if (!coach(req, res)) return;
      const { expected, requestId, requestHash } = writeInput(req.body); const playerId = text(req.body.playerId); const providerId = text(req.body.providerId);
      if (!playerId || !providerId) return bad(res, 'playerId and providerId are required.');
      const db = await readDB(); const data = adapters(db); const key = `${playerId}:${providerId}`; const current = data.ranked.states[key];
      if (!current) return bad(res, 'Persisted account state is required.', 409);
      if (current.requestId === requestId) {
        if (current.requestHash !== requestHash) return bad(res, 'Idempotency key was reused with a different request.', 409);
        return res.json(current);
      }
      if ((current.revision || 0) !== expected) return bad(res, 'Stale revision. Reload and retry.', 409);
      const state = applyRankedSyncOutcome(stripStoredState(current), req.body.outcome as SyncOutcome);
      const record = { ...state, revision: expected + 1, requestId, requestHash, updatedAt: new Date().toISOString() };
      data.ranked.states[key] = record; await saveDB(db); res.json(record);
    } catch (error: any) { bad(res, error.message, error.status || 400); }
  });
}

function initialState(playerId: string, providerId: string, account: RankedAccountIdentity): RankedSyncState {
  return { playerId, providerId, account: structuredClone(account), cursor: null, watermark: null, status: 'never-synced', lastAttemptAt: null, lastAttemptGeneration: 0, lastAttemptStartedAt: null, lastSuccessfulSyncAt: null, knownMatchCount: null, lastErrorCode: null };
}

function stripStoredState(value: any): RankedSyncState {
  const { revision: _revision, requestId: _requestId, updatedAt: _updatedAt, ...state } = value;
  return state;
}
