import { toCairoDateKey } from './coachAnalytics';

/** Pure domain contract. This module performs no network, storage, route, or UI work. */
export const RANKED_SYNC_ENGINE_VERSION = 'moe-ranked-sync/1';
export const RANKED_SYNC_TIME_ZONE = 'Africa/Cairo';

export type RankedConsentScope = 'ranked-match-history' | 'official-rank-rr';
export type RankedSyncStatus = 'never-synced' | 'fresh' | 'stale' | 'partial' | 'error' | 'blocked';
export type SyncStopReason =
  | 'invalid-input'
  | 'consent-missing'
  | 'consent-revoked'
  | 'consent-scope-missing'
  | 'account-mismatch'
  | 'provider-not-approved'
  | 'provider-not-configured'
  | 'provider-capability-incomplete'
  | 'quota-window-expired'
  | 'quota-exhausted'
  | 'authentication-failed'
  | 'eligibility-lost'
  | 'unknown-account';

export interface RankedAccountIdentity {
  providerAccountId: string;
  region: string;
  platform: string;
}

export interface RankedConsent {
  playerId: string;
  providerId: string;
  account: RankedAccountIdentity;
  consentVersion: string;
  scopes: readonly RankedConsentScope[];
  grantedAt: string;
  revokedAt: string | null;
  /** Explicit ranked-data consent is separate from app/Google authentication. */
  obtainedThrough: 'explicit-ranked-consent';
}

export interface ProviderCapability {
  providerId: string;
  approvedStatus: 'approved' | 'pending' | 'denied' | 'unknown';
  configured: boolean;
  documentedEndpointFamily: string | null;
  sourceSchemaVersion: string | null;
  termsPolicyVersion: string | null;
  quota: { limit: number; windowMs: number } | null;
}

export interface QuotaBudget {
  remaining: number;
  windowStartedAt: string;
  resetsAt: string;
}

export interface RankedSyncState {
  playerId: string;
  providerId: string;
  account: RankedAccountIdentity;
  cursor: string | null;
  watermark: string | null;
  status: RankedSyncStatus;
  lastAttemptAt: string | null;
  lastAttemptGeneration: number;
  lastAttemptStartedAt: string | null;
  lastSuccessfulSyncAt: string | null;
  /** Null means unknown/never established. It must not be presented as zero. */
  knownMatchCount: number | null;
  lastErrorCode: string | null;
}

export interface RankedSyncPlanInput {
  now: string;
  consent: RankedConsent | null;
  provider: ProviderCapability;
  account: RankedAccountIdentity;
  state: RankedSyncState;
  quota: QuotaBudget;
  requestedScopes: readonly RankedConsentScope[];
  pageSize: number;
}

export type RankedSyncPlan =
  | {
      kind: 'blocked';
      engineVersion: typeof RANKED_SYNC_ENGINE_VERSION;
      reason: SyncStopReason;
      status: 'blocked';
      manualEntryAvailable: true;
    }
  | {
      kind: 'incremental-ranked-sync';
      engineVersion: typeof RANKED_SYNC_ENGINE_VERSION;
      providerId: string;
      playerId: string;
      account: RankedAccountIdentity;
      endpointFamily: string;
      sourceSchemaVersion: string;
      policyVersion: string;
      cursor: string | null;
      watermark: string | null;
      pageSize: number;
      quotaCost: 1;
      requestedScopes: RankedConsentScope[];
      attempt: { generation: number; startedAt: string };
      manualEntryAvailable: true;
    };

const nonblank = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const validInstant = (value: unknown): value is string =>
  nonblank(value) && /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(new Date(value).getTime());
const instantMs = (value: string): number => new Date(value).getTime();
const integerInRange = (value: unknown, minimum: number, maximum = Number.MAX_SAFE_INTEGER): value is number =>
  Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum;
const CONSENT_SCOPES: readonly RankedConsentScope[] = ['ranked-match-history', 'official-rank-rr'];

function sameAccount(left: RankedAccountIdentity, right: RankedAccountIdentity): boolean {
  return left.providerAccountId === right.providerAccountId
    && left.region === right.region
    && left.platform === right.platform;
}

export function validateProviderCapability(provider: ProviderCapability): boolean {
  if (!provider || !nonblank(provider.providerId)
    || !['approved', 'pending', 'denied', 'unknown'].includes(provider.approvedStatus)
    || typeof provider.configured !== 'boolean') return false;
  if (provider.approvedStatus !== 'approved' || !provider.configured) return true;
  return nonblank(provider.documentedEndpointFamily) && nonblank(provider.sourceSchemaVersion)
    && nonblank(provider.termsPolicyVersion) && !!provider.quota
    && integerInRange(provider.quota.limit, 1) && integerInRange(provider.quota.windowMs, 1);
}

export function validateRankedConsentRecord(consent: RankedConsent, now: string): boolean {
  return !!consent && validInstant(now) && consent.obtainedThrough === 'explicit-ranked-consent'
    && nonblank(consent.consentVersion) && validInstant(consent.grantedAt)
    && nonblank(consent.playerId) && nonblank(consent.providerId)
    && instantMs(consent.grantedAt) <= instantMs(now)
    && (consent.revokedAt === null || (validInstant(consent.revokedAt) && instantMs(consent.revokedAt) >= instantMs(consent.grantedAt)))
    && nonblank(consent.account?.providerAccountId) && nonblank(consent.account?.region)
    && nonblank(consent.account?.platform) && Array.isArray(consent.scopes)
    && consent.scopes.length > 0 && new Set(consent.scopes).size === consent.scopes.length
    && consent.scopes.every(scope => CONSENT_SCOPES.includes(scope));
}

function blocked(reason: SyncStopReason): RankedSyncPlan {
  return { kind: 'blocked', engineVersion: RANKED_SYNC_ENGINE_VERSION, reason, status: 'blocked', manualEntryAvailable: true };
}

/** Fail-closed gate. No provider is assumed eligible and Google login is never consent. */
export function planRankedSync(input: RankedSyncPlanInput): RankedSyncPlan {
  const { provider, consent, state, account, quota } = input;
  if (!validInstant(input.now) || !Number.isInteger(input.pageSize) || input.pageSize < 1
    || !nonblank(provider.providerId) || !nonblank(state.playerId)
    || !nonblank(account.providerAccountId) || !nonblank(account.region) || !nonblank(account.platform)
    || provider.providerId !== state.providerId || !sameAccount(account, state.account)
    || !integerInRange(state.lastAttemptGeneration, 0, Number.MAX_SAFE_INTEGER - 1)
    || (state.lastAttemptStartedAt !== null && !validInstant(state.lastAttemptStartedAt))) {
    return blocked('invalid-input');
  }
  if (!consent) return blocked('consent-missing');
  if (!validateRankedConsentRecord(consent, input.now) || consent.playerId !== state.playerId
    || consent.providerId !== provider.providerId) {
    return blocked('invalid-input');
  }
  if (consent.revokedAt !== null) return blocked('consent-revoked');
  if (!sameAccount(consent.account, account)) return blocked('account-mismatch');
  if (!Array.isArray(input.requestedScopes) || input.requestedScopes.length < 1
    || input.requestedScopes.some(scope => !CONSENT_SCOPES.includes(scope))) return blocked('invalid-input');
  const scopes: RankedConsentScope[] = [...new Set<RankedConsentScope>(input.requestedScopes)].sort();
  if (scopes.some(scope => !consent.scopes.includes(scope))) return blocked('consent-scope-missing');
  if (!validateProviderCapability(provider)) return blocked('provider-capability-incomplete');
  if (provider.approvedStatus !== 'approved') return blocked('provider-not-approved');
  if (!provider.configured) return blocked('provider-not-configured');
  if (!nonblank(provider.documentedEndpointFamily) || !nonblank(provider.sourceSchemaVersion)
    || !nonblank(provider.termsPolicyVersion) || !provider.quota
    || !integerInRange(provider.quota.limit, 1)
    || !integerInRange(provider.quota.windowMs, 1)) {
    return blocked('provider-capability-incomplete');
  }
  if (!integerInRange(quota.remaining, 0, provider.quota.limit)
    || !validInstant(quota.windowStartedAt) || !validInstant(quota.resetsAt)
    || instantMs(quota.resetsAt) - instantMs(quota.windowStartedAt) !== provider.quota.windowMs
    || instantMs(input.now) < instantMs(quota.windowStartedAt)) {
    return blocked('invalid-input');
  }
  if (instantMs(input.now) >= instantMs(quota.resetsAt)) return blocked('quota-window-expired');
  if (quota.remaining < 1) {
    return blocked('quota-exhausted');
  }
  return {
    kind: 'incremental-ranked-sync',
    engineVersion: RANKED_SYNC_ENGINE_VERSION,
    providerId: provider.providerId,
    playerId: state.playerId,
    account: { ...account },
    endpointFamily: provider.documentedEndpointFamily,
    sourceSchemaVersion: provider.sourceSchemaVersion,
    policyVersion: provider.termsPolicyVersion,
    cursor: state.cursor,
    watermark: state.watermark,
    pageSize: input.pageSize,
    quotaCost: 1,
    requestedScopes: scopes,
    attempt: { generation: state.lastAttemptGeneration + 1, startedAt: input.now },
    manualEntryAvailable: true,
  };
}

export type RetryFailure =
  | 'rate-limit'
  | 'network'
  | 'server'
  | 'authentication'
  | 'eligibility'
  | 'consent'
  | 'unknown-account'
  | 'invalid-response';

export interface RetryPlanInput {
  failure: RetryFailure;
  attempt: number;
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** Deterministic caller-supplied jitter in integer basis points [0, 10000]. */
  jitterBasisPoints: number;
  retryAfterMs?: number | null;
  quotaRemaining: number;
}

export type RetryPlan =
  | { action: 'retry'; delayMs: number; nextAttempt: number; reason: RetryFailure }
  | { action: 'stop'; reason: RetryFailure | 'attempts-exhausted' | 'quota-exhausted' | 'invalid-retry-input' };

const MAX_RETRY_DELAY_MS = 86_400_000;

export function planRankedRetry(input: RetryPlanInput): RetryPlan {
  if (!integerInRange(input.attempt, 1) || !integerInRange(input.maxAttempts, 1)
    || !integerInRange(input.baseDelayMs, 0, MAX_RETRY_DELAY_MS)
    || !integerInRange(input.maxDelayMs, input.baseDelayMs, MAX_RETRY_DELAY_MS)
    || !integerInRange(input.jitterBasisPoints, 0, 10_000)
    || !integerInRange(input.quotaRemaining, 0)
    || (input.retryAfterMs !== undefined && input.retryAfterMs !== null
      && !integerInRange(input.retryAfterMs, 0, MAX_RETRY_DELAY_MS))) {
    return { action: 'stop', reason: 'invalid-retry-input' };
  }
  const terminal: readonly RetryFailure[] = ['authentication', 'eligibility', 'consent', 'unknown-account', 'invalid-response'];
  if (terminal.includes(input.failure)) return { action: 'stop', reason: input.failure };
  if (input.quotaRemaining < 1) return { action: 'stop', reason: 'quota-exhausted' };
  if (input.attempt >= input.maxAttempts) return { action: 'stop', reason: 'attempts-exhausted' };
  // Cap before multiplication: 0 * Infinity is NaN and very large attempts must remain finite.
  const exponent = Math.min(input.attempt - 1, 52);
  const exponential = input.baseDelayMs === 0
    ? 0
    : Math.min(input.maxDelayMs, input.baseDelayMs * (2 ** exponent));
  const jittered = Math.round(exponential * (0.5 + input.jitterBasisPoints / 20_000));
  const retryAfter = input.retryAfterMs ?? 0;
  return {
    action: 'retry',
    // A provider's Retry-After is authoritative even when it exceeds our exponential-backoff cap.
    delayMs: Math.max(jittered, retryAfter),
    nextAttempt: input.attempt + 1,
    reason: input.failure,
  };
}

/** Ranked official facts cannot be confused with custom ratings or scrim/custom evidence. */
export interface OfficialRankedFact {
  kind: 'official-provider-ranked-fact';
  mode: 'ranked';
  queue: 'competitive';
  providerId: string;
  providerPlayerId: string;
  sourceSchemaVersion: string;
  playerId: string;
  matchId: string;
  playedAt: string;
  mapId: string | null;
  outcome: 'win' | 'loss' | 'draw' | null;
  ourScore: number | null;
  theirScore: number | null;
  officialRank: string | null;
  officialRr: number | null;
}

export interface RankedMatchMutation {
  providerId: string;
  providerPlayerId: string;
  playerId: string;
  matchId: string;
  sourceEventId: string;
  sourceSchemaVersion: string;
  revision: number;
  observedAt: string;
  operation: 'upsert' | 'tombstone';
  /** Normalized domain facts only; never a broad raw provider payload. */
  normalized: Readonly<OfficialRankedFact> | null;
}

export interface ReconciledRankedMatch {
  key: string;
  providerId: string;
  playerId: string;
  providerPlayerId: string;
  matchId: string;
  sourceSchemaVersion: string;
  revision: number;
  sourceEventId: string;
  observedAt: string;
  tombstoned: boolean;
  normalized: Readonly<OfficialRankedFact> | null;
}

export interface ReconcileResult {
  records: ReconciledRankedMatch[];
  duplicateEvents: string[];
  conflicts: Array<{ key: string; revision: number }>;
}

const mutationKey = (item: Pick<RankedMatchMutation, 'providerId' | 'playerId' | 'matchId'>) =>
  JSON.stringify([item.providerId, item.playerId, item.matchId]);

function mutationValid(item: RankedMatchMutation): boolean {
  return [item.providerId, item.providerPlayerId, item.playerId, item.matchId, item.sourceEventId, item.sourceSchemaVersion]
    .every(nonblank)
    && Number.isInteger(item.revision) && item.revision >= 0 && validInstant(item.observedAt)
    && (item.operation === 'tombstone'
      ? item.normalized === null
      : validOfficialRankedFact(item.normalized, item));
}

const OFFICIAL_RANKED_FACT_FIELDS: readonly (keyof OfficialRankedFact)[] = [
  'kind', 'mode', 'queue', 'providerId', 'providerPlayerId', 'sourceSchemaVersion', 'playerId', 'matchId',
  'playedAt', 'mapId', 'outcome', 'ourScore', 'theirScore', 'officialRank', 'officialRr',
];

function nullableNonnegativeInteger(value: unknown, maximum = Number.MAX_SAFE_INTEGER): boolean {
  return value === null || integerInRange(value, 0, maximum);
}

function validOfficialRankedFact(
  fact: Readonly<OfficialRankedFact> | null,
  identity: Pick<RankedMatchMutation, 'providerId' | 'providerPlayerId' | 'sourceSchemaVersion' | 'playerId' | 'matchId'>,
): fact is Readonly<OfficialRankedFact> {
  if (!fact || typeof fact !== 'object' || Array.isArray(fact)) return false;
  const keys = Object.keys(fact).sort();
  if (keys.length !== OFFICIAL_RANKED_FACT_FIELDS.length
    || keys.some((key, index) => key !== [...OFFICIAL_RANKED_FACT_FIELDS].sort()[index])) return false;
  return fact.kind === 'official-provider-ranked-fact' && fact.mode === 'ranked' && fact.queue === 'competitive'
    && fact.providerId === identity.providerId && fact.providerPlayerId === identity.providerPlayerId
    && fact.sourceSchemaVersion === identity.sourceSchemaVersion && fact.playerId === identity.playerId
    && fact.matchId === identity.matchId && validInstant(fact.playedAt)
    && (fact.mapId === null || nonblank(fact.mapId))
    && (fact.outcome === null || fact.outcome === 'win' || fact.outcome === 'loss' || fact.outcome === 'draw')
    && nullableNonnegativeInteger(fact.ourScore) && nullableNonnegativeInteger(fact.theirScore)
    && (fact.officialRank === null || nonblank(fact.officialRank))
    && nullableNonnegativeInteger(fact.officialRr, 100);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function semanticMutation(item: RankedMatchMutation): string {
  return canonicalJson({
    providerId: item.providerId,
    providerPlayerId: item.providerPlayerId,
    playerId: item.playerId,
    matchId: item.matchId,
    sourceSchemaVersion: item.sourceSchemaVersion,
    revision: item.revision,
    operation: item.operation,
    normalized: item.normalized,
  });
}

/** Deterministic idempotency, correction, and tombstone reconciliation. */
export function reconcileRankedMutations(mutations: readonly RankedMatchMutation[]): ReconcileResult {
  const eventIds = new Map<string, { serialized: string; recordKey: string; item: RankedMatchMutation }>();
  const winners = new Map<string, RankedMatchMutation>();
  const duplicates = new Set<string>();
  const conflicts = new Map<string, { key: string; revision: number }>();
  const conflictedRecordKeys = new Set<string>();
  const ordered = [...mutations].sort((a, b) =>
    mutationKey(a).localeCompare(mutationKey(b)) || a.revision - b.revision || a.sourceEventId.localeCompare(b.sourceEventId));

  for (const item of ordered) {
    if (!mutationValid(item)) throw new TypeError('Ranked mutations require stable IDs, versions, revisions, timestamps, and normalized payload semantics.');
    const serialized = semanticMutation(item);
    const key = mutationKey(item);
    const eventKey = JSON.stringify([item.providerId, item.sourceEventId]);
    const priorEvent = eventIds.get(eventKey);
    if (priorEvent !== undefined) {
      if (priorEvent.serialized !== serialized) {
        conflicts.set(`event:${eventKey}`, { key: `event:${eventKey}`, revision: item.revision });
        conflictedRecordKeys.add(priorEvent.recordKey);
        conflictedRecordKeys.add(key);
        continue;
      }
      duplicates.add(item.sourceEventId);
      if (preferObservation(item, priorEvent.item)) eventIds.set(eventKey, { serialized, recordKey: key, item });
    } else {
      eventIds.set(eventKey, { serialized, recordKey: key, item });
    }
    const prior = winners.get(key);
    if (!prior || item.revision > prior.revision) {
      winners.set(key, item);
    } else if (item.revision === prior.revision) {
      if (semanticMutation(item) !== semanticMutation(prior)) {
        conflicts.set(`${key}:${item.revision}`, { key, revision: item.revision });
        conflictedRecordKeys.add(key);
      } else {
        duplicates.add(item.sourceEventId);
        // Semantic facts are equal: retain the latest observation, then the lexically smaller event ID.
        if (preferObservation(item, prior)) winners.set(key, item);
      }
    }
  }

  return {
    records: [...winners.entries()].filter(([key]) => !conflictedRecordKeys.has(key))
      .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => ({
      key,
      providerId: item.providerId,
      playerId: item.playerId,
      providerPlayerId: item.providerPlayerId,
      matchId: item.matchId,
      sourceSchemaVersion: item.sourceSchemaVersion,
      revision: item.revision,
      sourceEventId: item.sourceEventId,
      observedAt: item.observedAt,
      tombstoned: item.operation === 'tombstone',
      normalized: item.normalized,
    })),
    duplicateEvents: [...duplicates].sort(),
    conflicts: [...conflicts.values()].sort((a, b) => a.key.localeCompare(b.key)),
  };
}

function preferObservation(candidate: RankedMatchMutation, current: RankedMatchMutation): boolean {
  const timeDelta = instantMs(candidate.observedAt) - instantMs(current.observedAt);
  return timeDelta > 0 || (timeDelta === 0 && candidate.sourceEventId.localeCompare(current.sourceEventId) < 0);
}

export type SyncOutcome =
  | { kind: 'success'; generation: number; startedAt: string; at: string; cursor: string | null; watermark: string | null; knownMatchCount: number }
  | { kind: 'partial'; generation: number; startedAt: string; at: string; cursor: string | null; watermark: string | null; knownMatchCount: number | null; errorCode: string }
  | { kind: 'error'; generation: number; startedAt: string; at: string; errorCode: string }
  | { kind: 'blocked'; generation: number; startedAt: string; at: string; errorCode: SyncStopReason };

const outcomePrecedence: Record<SyncOutcome['kind'], number> = { success: 1, partial: 2, error: 3, blocked: 4 };
const statusPrecedence: Record<RankedSyncStatus, number> = {
  'never-synced': 0, fresh: 1, stale: 1, partial: 2, error: 3, blocked: 4,
};

const TERMINAL_BLOCK_REASONS: readonly SyncStopReason[] = [
  'consent-revoked', 'authentication-failed', 'eligibility-lost', 'unknown-account',
];

function isTerminalBlockedState(state: RankedSyncState): boolean {
  return state.status === 'blocked'
    && TERMINAL_BLOCK_REASONS.includes(state.lastErrorCode as SyncStopReason);
}

/** Pure transition; failures retain the last known count/cursor instead of replacing them with zero. */
export function applyRankedSyncOutcome(state: RankedSyncState, outcome: SyncOutcome): RankedSyncState {
  if (!validInstant(outcome.at) || !validInstant(outcome.startedAt)
    || instantMs(outcome.startedAt) > instantMs(outcome.at) || !integerInRange(outcome.generation, 1)) {
    throw new TypeError('Sync outcomes require a valid attempt identity and ordered offset-bearing timestamps.');
  }
  if (outcome.kind === 'success' && (!Number.isInteger(outcome.knownMatchCount) || outcome.knownMatchCount < 0)) {
    throw new TypeError('Successful sync counts must be non-negative integers.');
  }
  if (outcome.kind === 'partial' && outcome.knownMatchCount !== null
    && (!Number.isInteger(outcome.knownMatchCount) || outcome.knownMatchCount < 0)) {
    throw new TypeError('Partial sync counts must be null or non-negative integers.');
  }
  // Only revoked consent/auth/ineligibility/unknown-account latch this state. Quota blocks are recoverable.
  if (isTerminalBlockedState(state)) return state;
  if (!integerInRange(state.lastAttemptGeneration, 0)
    || (state.lastAttemptAt !== null && !validInstant(state.lastAttemptAt))
    || (state.lastAttemptStartedAt !== null && !validInstant(state.lastAttemptStartedAt))) {
    throw new TypeError('Sync state has an invalid attempt identity.');
  }
  if (outcome.generation < state.lastAttemptGeneration) return state;
  if (outcome.generation > state.lastAttemptGeneration && state.lastAttemptStartedAt !== null
    && instantMs(outcome.startedAt) < instantMs(state.lastAttemptStartedAt)) return state;
  if (outcome.generation === state.lastAttemptGeneration) {
    if (state.lastAttemptStartedAt !== outcome.startedAt) return state;
    const previousCompleted = state.lastAttemptAt === null ? Number.NEGATIVE_INFINITY : instantMs(state.lastAttemptAt);
    const incomingCompleted = instantMs(outcome.at);
    if (incomingCompleted < previousCompleted
      || (incomingCompleted === previousCompleted && outcomePrecedence[outcome.kind] <= statusPrecedence[state.status])) return state;
  }
  if (outcome.kind === 'error' || outcome.kind === 'blocked') {
    return {
      ...state,
      status: outcome.kind,
      lastAttemptAt: outcome.at,
      lastAttemptGeneration: outcome.generation,
      lastAttemptStartedAt: outcome.startedAt,
      lastErrorCode: outcome.errorCode,
    };
  }
  return {
    ...state,
    status: outcome.kind === 'success' ? 'fresh' : 'partial',
    lastAttemptAt: outcome.at,
    lastAttemptGeneration: outcome.generation,
    lastAttemptStartedAt: outcome.startedAt,
    lastSuccessfulSyncAt: outcome.kind === 'success' ? outcome.at : state.lastSuccessfulSyncAt,
    cursor: outcome.cursor,
    watermark: outcome.watermark,
    knownMatchCount: outcome.knownMatchCount ?? state.knownMatchCount,
    lastErrorCode: outcome.kind === 'partial' ? outcome.errorCode : null,
  };
}

export function deriveRankedSyncStatus(state: RankedSyncState, now: string, staleAfterMs: number): RankedSyncStatus {
  if (state.status === 'blocked' || state.status === 'error' || state.status === 'partial') return state.status;
  if (state.lastSuccessfulSyncAt === null) return 'never-synced';
  if (!validInstant(now) || !validInstant(state.lastSuccessfulSyncAt) || !Number.isFinite(staleAfterMs) || staleAfterMs < 0) {
    throw new TypeError('Staleness requires valid instants and a non-negative threshold.');
  }
  return new Date(now).getTime() - new Date(state.lastSuccessfulSyncAt).getTime() > staleAfterMs ? 'stale' : 'fresh';
}

export interface RankedDailyBucket {
  timeZone: typeof RANKED_SYNC_TIME_ZONE;
  dateKey: string;
}

export function toRankedCairoDailyBucket(timestamp: string): RankedDailyBucket | null {
  if (!validInstant(timestamp)) return null;
  const dateKey = toCairoDateKey(timestamp);
  return dateKey ? { timeZone: RANKED_SYNC_TIME_ZONE, dateKey } : null;
}

export interface RankedRetentionMetadata {
  mode: 'normalized-fields-only' | 'encrypted-temporary-raw';
  allowedNormalizedFields: readonly string[];
  capturedAt: string;
  deleteAt: string | null;
  purpose: 'ranked-sync-validation';
}

export const RANKED_NORMALIZED_FIELD_ALLOWLIST = [
  'matchId', 'providerAccountId', 'playedAt', 'queue', 'mapId', 'outcome', 'ourScore', 'theirScore',
  'officialRank', 'officialRr', 'sourceSchemaVersion',
] as const;

export function validateRankedRetention(metadata: RankedRetentionMetadata): boolean {
  if (!validInstant(metadata.capturedAt) || metadata.allowedNormalizedFields.length < 1
    || metadata.allowedNormalizedFields.some(field =>
      !nonblank(field) || !(RANKED_NORMALIZED_FIELD_ALLOWLIST as readonly string[]).includes(field))) return false;
  if (metadata.mode === 'normalized-fields-only') return metadata.deleteAt === null;
  return validInstant(metadata.deleteAt) && new Date(metadata.deleteAt).getTime() > new Date(metadata.capturedAt).getTime();
}
