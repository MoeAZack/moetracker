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
  requestedScopes?: readonly RankedConsentScope[];
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
      manualEntryAvailable: true;
    };

const nonblank = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const validInstant = (value: unknown): value is string =>
  nonblank(value) && /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(new Date(value).getTime());

function sameAccount(left: RankedAccountIdentity, right: RankedAccountIdentity): boolean {
  return left.providerAccountId === right.providerAccountId
    && left.region === right.region
    && left.platform === right.platform;
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
    || provider.providerId !== state.providerId || !sameAccount(account, state.account)) {
    return blocked('invalid-input');
  }
  if (!consent) return blocked('consent-missing');
  if (consent.obtainedThrough !== 'explicit-ranked-consent' || !nonblank(consent.consentVersion)
    || !validInstant(consent.grantedAt) || consent.playerId !== state.playerId
    || consent.providerId !== provider.providerId) {
    return blocked('invalid-input');
  }
  if (consent.revokedAt !== null) return blocked('consent-revoked');
  if (!sameAccount(consent.account, account)) return blocked('account-mismatch');
  const defaultScopes: readonly RankedConsentScope[] = ['ranked-match-history', 'official-rank-rr'];
  const scopes: RankedConsentScope[] = [...new Set<RankedConsentScope>(input.requestedScopes ?? defaultScopes)].sort();
  if (scopes.some(scope => !consent.scopes.includes(scope))) return blocked('consent-scope-missing');
  if (provider.approvedStatus !== 'approved') return blocked('provider-not-approved');
  if (!provider.configured) return blocked('provider-not-configured');
  if (!nonblank(provider.documentedEndpointFamily) || !nonblank(provider.sourceSchemaVersion)
    || !nonblank(provider.termsPolicyVersion) || !provider.quota
    || !Number.isInteger(provider.quota.limit) || provider.quota.limit < 1
    || !Number.isInteger(provider.quota.windowMs) || provider.quota.windowMs < 1) {
    return blocked('provider-capability-incomplete');
  }
  if (!Number.isInteger(quota.remaining) || quota.remaining < 1 || !validInstant(quota.resetsAt)) {
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
  /** Deterministic caller-supplied sample in [0, 1], so plans are reproducible in tests/jobs. */
  jitterUnit: number;
  retryAfterMs?: number | null;
  quotaRemaining: number;
}

export type RetryPlan =
  | { action: 'retry'; delayMs: number; nextAttempt: number; reason: RetryFailure }
  | { action: 'stop'; reason: RetryFailure | 'attempts-exhausted' | 'quota-exhausted' };

export function planRankedRetry(input: RetryPlanInput): RetryPlan {
  const terminal: readonly RetryFailure[] = ['authentication', 'eligibility', 'consent', 'unknown-account', 'invalid-response'];
  if (terminal.includes(input.failure)) return { action: 'stop', reason: input.failure };
  if (input.quotaRemaining < 1) return { action: 'stop', reason: 'quota-exhausted' };
  if (!Number.isInteger(input.attempt) || input.attempt < 1 || !Number.isInteger(input.maxAttempts)
    || input.maxAttempts < 1 || input.attempt >= input.maxAttempts) {
    return { action: 'stop', reason: 'attempts-exhausted' };
  }
  if (!Number.isFinite(input.baseDelayMs) || input.baseDelayMs < 0 || !Number.isFinite(input.maxDelayMs)
    || input.maxDelayMs < input.baseDelayMs || !Number.isFinite(input.jitterUnit)
    || input.jitterUnit < 0 || input.jitterUnit > 1) {
    return { action: 'stop', reason: 'attempts-exhausted' };
  }
  const exponential = Math.min(input.maxDelayMs, input.baseDelayMs * (2 ** (input.attempt - 1)));
  const jittered = Math.round(exponential * (0.5 + input.jitterUnit * 0.5));
  const retryAfter = Number.isFinite(input.retryAfterMs) && (input.retryAfterMs ?? 0) >= 0
    ? Math.round(input.retryAfterMs ?? 0)
    : 0;
  return {
    action: 'retry',
    // A provider's Retry-After is authoritative even when it exceeds our exponential-backoff cap.
    delayMs: Math.max(jittered, retryAfter),
    nextAttempt: input.attempt + 1,
    reason: input.failure,
  };
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
  normalized: Readonly<Record<string, unknown>> | null;
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
  normalized: Readonly<Record<string, unknown>> | null;
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
    && (item.operation === 'tombstone' ? item.normalized === null : item.normalized !== null);
}

/** Deterministic idempotency, correction, and tombstone reconciliation. */
export function reconcileRankedMutations(mutations: readonly RankedMatchMutation[]): ReconcileResult {
  const eventIds = new Map<string, { serialized: string; recordKey: string }>();
  const winners = new Map<string, RankedMatchMutation>();
  const duplicates = new Set<string>();
  const conflicts = new Map<string, { key: string; revision: number }>();
  const conflictedRecordKeys = new Set<string>();
  const ordered = [...mutations].sort((a, b) =>
    mutationKey(a).localeCompare(mutationKey(b)) || a.revision - b.revision || a.sourceEventId.localeCompare(b.sourceEventId));

  for (const item of ordered) {
    if (!mutationValid(item)) throw new TypeError('Ranked mutations require stable IDs, versions, revisions, timestamps, and normalized payload semantics.');
    const serialized = JSON.stringify(item);
    const key = mutationKey(item);
    const eventKey = JSON.stringify([item.providerId, item.sourceEventId]);
    const priorEvent = eventIds.get(eventKey);
    if (priorEvent !== undefined) {
      if (priorEvent.serialized !== serialized) {
        conflicts.set(`event:${eventKey}`, { key: `event:${eventKey}`, revision: item.revision });
        conflictedRecordKeys.add(priorEvent.recordKey);
        conflictedRecordKeys.add(key);
      }
      else duplicates.add(item.sourceEventId);
      continue;
    }
    eventIds.set(eventKey, { serialized, recordKey: key });
    const prior = winners.get(key);
    if (!prior || item.revision > prior.revision) {
      winners.set(key, item);
    } else if (item.revision === prior.revision) {
      if (JSON.stringify({ ...item, sourceEventId: '' }) !== JSON.stringify({ ...prior, sourceEventId: '' })) {
        conflicts.set(`${key}:${item.revision}`, { key, revision: item.revision });
        conflictedRecordKeys.add(key);
      } else {
        duplicates.add(item.sourceEventId);
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

export type SyncOutcome =
  | { kind: 'success'; at: string; cursor: string | null; watermark: string | null; knownMatchCount: number }
  | { kind: 'partial'; at: string; cursor: string | null; watermark: string | null; knownMatchCount: number | null; errorCode: string }
  | { kind: 'error'; at: string; errorCode: string }
  | { kind: 'blocked'; at: string; errorCode: SyncStopReason };

/** Pure transition; failures retain the last known count/cursor instead of replacing them with zero. */
export function applyRankedSyncOutcome(state: RankedSyncState, outcome: SyncOutcome): RankedSyncState {
  if (!validInstant(outcome.at)) throw new TypeError('Sync outcomes require an offset-bearing timestamp.');
  if (outcome.kind === 'success' && (!Number.isInteger(outcome.knownMatchCount) || outcome.knownMatchCount < 0)) {
    throw new TypeError('Successful sync counts must be non-negative integers.');
  }
  if (outcome.kind === 'partial' && outcome.knownMatchCount !== null
    && (!Number.isInteger(outcome.knownMatchCount) || outcome.knownMatchCount < 0)) {
    throw new TypeError('Partial sync counts must be null or non-negative integers.');
  }
  if (outcome.kind === 'error' || outcome.kind === 'blocked') {
    return { ...state, status: outcome.kind, lastAttemptAt: outcome.at, lastErrorCode: outcome.errorCode };
  }
  return {
    ...state,
    status: outcome.kind === 'success' ? 'fresh' : 'partial',
    lastAttemptAt: outcome.at,
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

/** Ranked official facts cannot be confused with custom shadow rating or scrim/custom evidence. */
export interface OfficialRankedFact {
  kind: 'official-provider-ranked-fact';
  mode: 'ranked';
  providerId: string;
  sourceSchemaVersion: string;
  playerId: string;
  matchId: string;
  officialRank: string | null;
  officialRr: number | null;
  customShadowRating: null;
}
