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

type Actor = { role: 'coach' | 'player'; username: string; playerId?: string };
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
      const hash = contentHash(config.formula); const prior = db.engineAdapters.ratings.formulaVersions[config.formula.version];
      if (prior && prior !== hash) throw Object.assign(new Error('Stored formula version identities conflict.'), { status: 409 });
      db.engineAdapters.ratings.formulaVersions[config.formula.version] = hash;
    }
    if (config?.baseline?.version) {
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

function normalizeReplayInput(raw: any): ReplayParserDraftInput {
  if (!onlyKeys(raw?.parser, ['name', 'version']) || !text(raw.parser.name) || !text(raw.parser.version)) throw Object.assign(new Error('Replay parser identity must contain only name and version.'), { status: 400 });
  if (!onlyKeys(raw?.file, ['format', 'support']) || !text(raw.file.format) || !['supported', 'unsupported', 'incomplete'].includes(raw.file.support)) throw Object.assign(new Error('Replay file metadata must contain only format and supported status.'), { status: 400 });
  if (!raw?.provenance || typeof raw.provenance !== 'object' || Array.isArray(raw.provenance)) throw Object.assign(new Error('Replay provenance is required.'), { status: 400 });
  for (const value of Object.values(raw.provenance)) if (!['string', 'number', 'boolean'].includes(typeof value) && value !== null) throw Object.assign(new Error('Replay provenance values must be scalar.'), { status: 400 });
  return { ...structuredClone(raw), parser: { name: raw.parser.name.trim(), version: raw.parser.version.trim() }, file: { format: raw.file.format.trim(), support: raw.file.support } };
}

function normalizeAccount(raw: any): RankedAccountIdentity {
  if (!onlyKeys(raw, ['providerAccountId', 'region', 'platform'])) throw Object.assign(new Error('Ranked account identity contains unsupported fields.'), { status: 400 });
  const providerAccountId = text(raw?.providerAccountId); const region = text(raw?.region); const platform = text(raw?.platform);
  if (!providerAccountId || !region || !platform) throw Object.assign(new Error('Exact account identity is required.'), { status: 400 });
  return { providerAccountId, region, platform };
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

function requestRetry(current: any, requestId: string, requestHash: string) {
  if (current?.requestId !== requestId) return null;
  if (current.requestHash !== requestHash) throw Object.assign(new Error('Idempotency key was reused with a different request.'), { status: 409 });
  return current;
}

function operationRetry(data: any, requestId: string, requestHash: string) {
  const prior = data.idempotency[requestId];
  if (!prior) return null;
  if (prior.requestHash !== requestHash) throw Object.assign(new Error('Idempotency key was reused with a different request.'), { status: 409 });
  return structuredClone(prior.response);
}
function rememberOperation(data: any, requestId: string, requestHash: string, response: any) {
  data.idempotency[requestId] = { requestHash, response: structuredClone(response), completedAt: new Date().toISOString() };
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

function writeInput(body: any) {
  const expected = revision(body?.expectedRevision);
  const requestId = text(body?.requestId);
  if (expected === null || !requestId) throw Object.assign(new Error('expectedRevision and requestId are required.'), { status: 400 });
  const requestHash = crypto.createHash('sha256').update(canonical(body)).digest('hex');
  return { expected, requestId, requestHash };
}

function replayPublic(record: any) {
  if (record?.status !== 'accepted') return null;
  const draft = record.draft;
  return {
    matchId: record.matchId, status: 'accepted', acceptedAt: record.acceptedAt,
    parser: { name: draft.parser.name, version: draft.parser.version }, file: { format: draft.file.format, support: draft.file.support },
    crossChecks: draft.crossChecks.map((item: any) => ({ field: item.field, status: item.status })),
    coverage: { playedRounds: draft.coverage.playedRounds, resolvedRounds: draft.coverage.resolvedRounds, unknownRounds: draft.coverage.unknownRounds, resolvedPercent: draft.coverage.resolvedPercent },
    playerTotals: draft.playerTotals.map((item: any) => ({ playerId: item.playerId, firstKills: item.firstKills, firstDeaths: item.firstDeaths })),
    evidence: {
      coverageBySignal: draft.evidence.coverageBySignal.map((item: any) => ({ signal: item.signal, support: item.support, grade: item.grade, coveredRounds: item.coveredRounds, playedRounds: item.playedRounds })),
      playerMetrics: draft.evidence.playerMetrics.map((item: any) => ({ playerId: item.playerId, kills: item.kills, deaths: item.deaths, assists: item.assists, damage: item.damage, utilityCasts: item.utilityCasts, utilityEffects: item.utilityEffects, ultimateUses: item.ultimateUses, plants: item.plants, defuses: item.defuses })),
      rounds: draft.evidence.rounds.map((round: any) => ({ roundNumber: round.roundNumber, winnerTeamId: round.winnerTeamId, endReason: round.endReason, derived: { tradeOpportunities: round.derived.tradeOpportunities, successfulTrades: round.derived.successfulTrades, tradedDeathPlayerIds: round.derived.tradedDeathPlayerIds, multikills: round.derived.multikills?.map((item: any) => ({ playerId: item.playerId, kills: item.kills })) ?? null, clutches: round.derived.clutches?.map((item: any) => ({ playerId: item.playerId, opponents: item.opponents, result: item.result })) ?? null } })),
    },
  };
}

function ratingPublic(record: any) {
  const result = record?.result;
  if (record?.status !== 'accepted' || !result?.eligibleForShadowAggregate || result?.calculation?.shadowScore === null) return null;
  return {
    playerId: result.context.playerId, status: 'accepted', label: result.label, advisory: result.advisory,
    formulaVersion: result.formulaVersion, baseline: { id: result.baseline.id, version: result.baseline.version },
    calibrationStatus: record.calibrationStatus, experimental: record.calibrationStatus !== 'calibrated',
    coverage: { availableWeight: result.coverage.availableWeight, totalWeight: result.coverage.totalWeight, ratio: result.coverage.ratio },
    score: result.calculation.shadowScore, authoritativeScore: null, warnings: result.warnings,
    contributions: result.metrics.filter((metric: any) => metric.included).map((metric: any) => ({ metric: metric.metric, direction: metric.direction, weightedContribution: metric.weightedContribution })),
  };
}

function safeRankedForPlayer(data: any, playerId: string) {
  const accounts = Object.values(data.accounts).filter((item: any) => item.playerId === playerId).map((item: any) => ({
    playerId, providerId: item.providerId, account: { providerAccountId: item.account.providerAccountId, region: item.account.region, platform: item.account.platform }, revision: item.revision,
  }));
  const consents = Object.values(data.consents).filter((item: any) => item.playerId === playerId).map((item: any) => ({
    playerId, providerId: item.providerId, scopes: item.scopes, consentVersion: item.consentVersion,
    grantedAt: item.grantedAt, revokedAt: item.revokedAt, revision: item.revision,
  }));
  const states = Object.values(data.states).filter((item: any) => item.playerId === playerId).map((item: any) => ({
    playerId, providerId: item.providerId, status: item.status, lastSuccessfulSyncAt: item.lastSuccessfulSyncAt,
    knownMatchCount: item.knownMatchCount, lastErrorCode: item.lastErrorCode, revision: item.revision,
  }));
  return { engineVersion: RANKED_SYNC_ENGINE_VERSION, activation: 'disabled', accounts, consents, states };
}

const consentResponse = (item: any) => ({ playerId: item.playerId, providerId: item.providerId, scopes: [...item.scopes], consentVersion: item.consentVersion, grantedAt: item.grantedAt, revokedAt: item.revokedAt, revision: item.revision });

function rankedForCoach(data: any) {
  return {
    engineVersion: RANKED_SYNC_ENGINE_VERSION, activation: 'disabled',
    providers: Object.values(data.providers).map((item: any) => ({ providerId: item.providerId, approvedStatus: item.approvedStatus, configured: item.configured, documentedEndpointFamily: item.documentedEndpointFamily, sourceSchemaVersion: item.sourceSchemaVersion, termsPolicyVersion: item.termsPolicyVersion, quota: item.quota ? { limit: item.quota.limit, windowMs: item.quota.windowMs } : null, revision: item.revision })),
    accounts: Object.values(data.accounts).map((item: any) => ({ playerId: item.playerId, providerId: item.providerId, account: { providerAccountId: item.account.providerAccountId, region: item.account.region, platform: item.account.platform }, revision: item.revision })),
    consents: Object.values(data.consents).map((item: any) => ({ playerId: item.playerId, providerId: item.providerId, scopes: [...item.scopes], consentVersion: item.consentVersion, grantedAt: item.grantedAt, revokedAt: item.revokedAt, grantedBy: item.grantedBy ? { kind: item.grantedBy.kind, playerId: item.grantedBy.playerId, username: item.grantedBy.username } : null, revision: item.revision })),
    states: Object.values(data.states).map((item: any) => ({ playerId: item.playerId, providerId: item.providerId, status: item.status, lastAttemptAt: item.lastAttemptAt, lastSuccessfulSyncAt: item.lastSuccessfulSyncAt, knownMatchCount: item.knownMatchCount, lastErrorCode: item.lastErrorCode, revision: item.revision })),
  };
}

export function registerEngineAdapterRoutes(app: Express) {
  app.get('/api/engine-adapters', async (req, res) => {
    try {
      const db = await readDB(); const data = adapters(db); const user = actor(req);
      if (user.role === 'coach') return res.json({ replay: Object.values(data.replay), ratings: data.ratings, ranked: rankedForCoach(data.ranked) });
      if (!user.playerId) return res.json({ replay: [], ratings: [], ranked: { engineVersion: RANKED_SYNC_ENGINE_VERSION, activation: 'disabled', accounts: [], consents: [], states: [] } });
      res.json({
        replay: Object.values(data.replay).map(replayPublic).filter(Boolean),
        ratings: Object.values(data.ratings.records).map(ratingPublic).filter((item: any) => item?.playerId === user.playerId),
        ranked: safeRankedForPlayer(data.ranked, user.playerId),
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
      const db = await readDB(); const data = adapters(db); const current = data.replay[matchId];
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
      const prior = operationRetry(data, requestId, requestHash); if (prior) return res.json(prior);
      const retry = requestRetry(current, requestId, requestHash); if (retry) return res.json(retry);
      if (!current || current.status !== 'review-required') return bad(res, 'A current review-required draft is required.', 409);
      const record = nextRecord(current, expected, requestId, requestHash, { ...current, status: 'accepted', acceptedAt: new Date().toISOString() });
      if (record !== current) { data.replay[matchId] = record; rememberOperation(data, requestId, requestHash, record); await saveDB(db); }
      res.json(record);
    } catch (error: any) { bad(res, error.message, error.status || 400); }
  });

  app.post('/api/engine-adapters/ratings/config', async (req, res) => {
    try {
      if (!coach(req, res)) return;
      const { expected, requestId, requestHash } = writeInput(req.body); const formula = req.body.formula as PlayerRatingFormula;
      const baseline = req.body.baseline as RatingBaseline; const validationInput = req.body.validationInput as PlayerRatingInput;
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
      const db = await readDB(); const config = adapters(db).ratings.configs[text(req.body?.configKey) || ''];
      if (!config) return bad(res, 'Unknown rating configuration.', 404);
      res.json(previewShadowRatingWeights(req.body.input, config.baseline, config.formula, req.body.candidateFormula));
    } catch (error: any) { bad(res, error.message, error.status || 400); }
  });

  app.post('/api/engine-adapters/ratings/recompute', async (req, res) => {
    try {
      if (!coach(req, res)) return;
      const { expected, requestId, requestHash } = writeInput(req.body); const db = await readDB(); const data = adapters(db);
      const config = data.ratings.configs[text(req.body?.configKey) || '']; if (!config) return bad(res, 'Unknown rating configuration.', 404);
      const result = calculateShadowPlayerRating(req.body.input, config.baseline, config.formula);
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
      const prior = operationRetry(data, requestId, requestHash); if (prior) return res.json(prior);
      const retry = requestRetry(current, requestId, requestHash); if (retry) return res.json(retry);
      if (!current || current.status !== 'review-required') return bad(res, 'A current recomputed rating is required.', 409);
      const record = nextRecord(current, expected, requestId, requestHash, { ...current, status: 'accepted', acceptedAt: new Date().toISOString() });
      if (record !== current) { data.ratings.records[key] = record; rememberOperation(data, requestId, requestHash, record); await saveDB(db); } res.json(record);
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
      const db = await readDB(); const data = adapters(db); if (!data.ranked.providers[providerId]) return bad(res, 'Provider capability is not persisted.', 409);
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
      const prior = operationRetry(data, requestId, requestHash); if (prior) return res.json(prior);
      const retry = requestRetry(current, requestId, requestHash); if (retry) return res.json(consentResponse(retry));
      if (!current || current.revokedAt) return bad(res, 'Active consent is required.', 409);
      const record = nextRecord(current, expected, requestId, requestHash, { ...current, revokedAt: new Date().toISOString() });
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
        const response = consentResponse(record); rememberOperation(data, requestId, requestHash, response); await saveDB(db);
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
