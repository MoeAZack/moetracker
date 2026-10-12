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
  db.engineAdapters ||= { schemaVersion: 1, replay: {}, ratings: { configs: {}, records: {} }, ranked: { providers: {}, accounts: {}, consents: {}, states: {} } };
  db.engineAdapters.replay ||= {};
  db.engineAdapters.ratings ||= { configs: {}, records: {} };
  db.engineAdapters.ratings.configs ||= {}; db.engineAdapters.ratings.records ||= {};
  db.engineAdapters.ranked ||= { providers: {}, accounts: {}, consents: {}, states: {} };
  for (const key of ['providers', 'accounts', 'consents', 'states']) db.engineAdapters.ranked[key] ||= {};
  return db.engineAdapters;
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
  const requestHash = crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
  return { expected, requestId, requestHash };
}

function replayPublic(record: any) {
  if (record?.status !== 'accepted') return null;
  const draft = record.draft;
  return {
    matchId: record.matchId, status: 'accepted', acceptedAt: record.acceptedAt,
    parser: draft.parser, file: draft.file, crossChecks: draft.crossChecks,
    coverage: draft.coverage, playerTotals: draft.playerTotals,
    evidence: {
      coverageBySignal: draft.evidence.coverageBySignal,
      playerMetrics: draft.evidence.playerMetrics,
      rounds: draft.evidence.rounds.map((round: any) => ({ roundNumber: round.roundNumber, winnerTeamId: round.winnerTeamId, endReason: round.endReason, derived: round.derived })),
    },
  };
}

function ratingPublic(record: any) {
  const result = record?.result;
  if (record?.status !== 'accepted' || !result?.eligibleForShadowAggregate || result?.calculation?.shadowScore === null) return null;
  return {
    playerId: result.context.playerId, status: 'accepted', label: result.label, advisory: result.advisory,
    formulaVersion: result.formulaVersion, baseline: result.baseline, coverage: result.coverage,
    score: result.calculation.shadowScore, authoritativeScore: null, warnings: result.warnings,
    contributions: result.metrics.filter((metric: any) => metric.included).map((metric: any) => ({ metric: metric.metric, direction: metric.direction, weightedContribution: metric.weightedContribution })),
  };
}

function safeRankedForPlayer(data: any, playerId: string) {
  const accounts = Object.values(data.accounts).filter((item: any) => item.playerId === playerId).map((item: any) => ({
    playerId, providerId: item.providerId, account: item.account, revision: item.revision,
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

export function registerEngineAdapterRoutes(app: Express) {
  app.get('/api/engine-adapters', async (req, res) => {
    try {
      const db = await readDB(); const data = adapters(db); const user = actor(req);
      if (user.role === 'coach') return res.json(data);
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
      const draft = buildReplayOpeningReviewDraft(req.body.parserInput as ReplayParserDraftInput, req.body.reference as ReplayReviewReference | undefined);
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
      if (!current || current.status !== 'review-required') return bad(res, 'A current review-required draft is required.', 409);
      const record = nextRecord(current, expected, requestId, requestHash, { ...current, status: 'accepted', acceptedAt: new Date().toISOString() });
      if (record !== current) { data.replay[matchId] = record; await saveDB(db); }
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
      const record = nextRecord(current, expected, requestId, requestHash, { key, readiness: 'uncalibrated', label: 'Uncalibrated shadow configuration', engineVersion: SHADOW_RATING_ENGINE_VERSION, formula, baseline });
      if (record !== current) { data.ratings.configs[key] = record; await saveDB(db); }
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
      const record = nextRecord(current, expected, requestId, requestHash, { recordKey, status: 'review-required', acceptedAt: null, input: normalizedInput, configKey: config.key, result });
      if (record !== current) { data.ratings.records[recordKey] = record; await saveDB(db); }
      res.json(record);
    } catch (error: any) { bad(res, error.message, error.status || 400); }
  });

  app.post('/api/engine-adapters/ratings/accept', async (req, res) => {
    try {
      if (!coach(req, res)) return;
      const { expected, requestId, requestHash } = writeInput(req.body); const key = text(req.body?.recordKey); if (!key) return bad(res, 'recordKey is required.');
      const db = await readDB(); const data = adapters(db); const current = data.ratings.records[key];
      if (!current || current.status !== 'review-required') return bad(res, 'A current recomputed rating is required.', 409);
      const record = nextRecord(current, expected, requestId, requestHash, { ...current, status: 'accepted', acceptedAt: new Date().toISOString() });
      if (record !== current) { data.ratings.records[key] = record; await saveDB(db); } res.json(record);
    } catch (error: any) { bad(res, error.message, error.status || 400); }
  });

  app.post('/api/engine-adapters/ranked/provider', async (req, res) => {
    try {
      if (!coach(req, res)) return;
      const { expected, requestId, requestHash } = writeInput(req.body); const provider = req.body.provider as ProviderCapability;
      if (!validateProviderCapability(provider)) return bad(res, 'Invalid or incomplete provider capability.');
      const db = await readDB(); const data = adapters(db); const current = data.ranked.providers[provider.providerId];
      const record = nextRecord(current, expected, requestId, requestHash, { ...provider, activation: 'disabled', engineVersion: RANKED_SYNC_ENGINE_VERSION });
      if (record !== current) { data.ranked.providers[provider.providerId] = record; await saveDB(db); } res.json(record);
    } catch (error: any) { bad(res, error.message, error.status || 400); }
  });

  app.post('/api/engine-adapters/ranked/account', async (req, res) => {
    try {
      if (!coach(req, res)) return;
      const { expected, requestId, requestHash } = writeInput(req.body); const playerId = text(req.body.playerId); const providerId = text(req.body.providerId);
      const account = req.body.account as RankedAccountIdentity;
      if (!playerId || !providerId || !text(account?.providerAccountId) || !text(account?.region) || !text(account?.platform)) return bad(res, 'Exact player, provider, and account identity are required.');
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
      const user = actor(req); const requestedPlayerId = user.role === 'player' ? user.playerId : text(req.body.playerId);
      if (!requestedPlayerId || (user.role === 'player' && req.body.playerId && req.body.playerId !== requestedPlayerId)) return bad(res, 'Player identity is not bound to this session.', 403);
      const { expected, requestId, requestHash } = writeInput(req.body); const providerId = text(req.body.providerId); if (!providerId) return bad(res, 'providerId is required.');
      const db = await readDB(); const data = adapters(db); const key = `${requestedPlayerId}:${providerId}`; const accountRecord = data.ranked.accounts[key];
      if (!accountRecord) return bad(res, 'Coach-confirmed exact account identity is required.', 409);
      const now = new Date().toISOString(); const consent: RankedConsent = {
        playerId: requestedPlayerId, providerId, account: accountRecord.account,
        consentVersion: text(req.body.consentVersion) || '', scopes: req.body.scopes,
        grantedAt: now, revokedAt: null, obtainedThrough: 'explicit-ranked-consent',
      };
      if (!validateRankedConsentRecord(consent, now)) return bad(res, 'Invalid consent version or scopes.');
      const current = data.ranked.consents[key]; const record = nextRecord(current, expected, requestId, requestHash, consent);
      if (record !== current) { data.ranked.consents[key] = record; await saveDB(db); } res.json({ ...record, account: undefined });
    } catch (error: any) { bad(res, error.message, error.status || 400); }
  });

  app.post('/api/engine-adapters/ranked/revoke', async (req, res) => {
    try {
      const user = actor(req); const requestedPlayerId = user.role === 'player' ? user.playerId : text(req.body.playerId);
      if (!requestedPlayerId || (user.role === 'player' && req.body.playerId && req.body.playerId !== requestedPlayerId)) return bad(res, 'Player identity is not bound to this session.', 403);
      const { expected, requestId, requestHash } = writeInput(req.body); const providerId = text(req.body.providerId); const db = await readDB(); const data = adapters(db); const key = `${requestedPlayerId}:${providerId}`; const current = data.ranked.consents[key];
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
        await saveDB(db);
      } res.json({ ...record, account: undefined });
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
