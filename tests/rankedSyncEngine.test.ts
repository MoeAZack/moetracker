import { describe, expect, it } from 'vitest';
import {
  applyRankedSyncOutcome,
  deriveRankedSyncStatus,
  planRankedRetry,
  planRankedSync,
  reconcileRankedMutations,
  toRankedCairoDailyBucket,
  validateRankedRetention,
  type ProviderCapability,
  type RankedConsent,
  type RankedMatchMutation,
  type RankedSyncPlanInput,
  type RankedSyncState,
} from '../lib/rankedSyncEngine';

const account = { providerAccountId: 'acct-stable-7', region: 'eu', platform: 'pc' };
const state = (): RankedSyncState => ({
  playerId: 'player-1', providerId: 'approved-provider', account: { ...account },
  cursor: 'opaque-cursor', watermark: 'opaque-watermark', status: 'fresh',
  lastAttemptAt: '2026-10-12T09:00:00Z', lastSuccessfulSyncAt: '2026-10-12T09:00:00Z',
  knownMatchCount: 14, lastErrorCode: null,
});
const consent = (): RankedConsent => ({
  playerId: 'player-1', providerId: 'approved-provider', account: { ...account },
  consentVersion: 'ranked-consent/2', scopes: ['ranked-match-history', 'official-rank-rr'],
  grantedAt: '2026-10-01T10:00:00+03:00', revokedAt: null,
  obtainedThrough: 'explicit-ranked-consent',
});
const provider = (): ProviderCapability => ({
  providerId: 'approved-provider', approvedStatus: 'approved', configured: true,
  documentedEndpointFamily: 'documented-ranked-v2', sourceSchemaVersion: 'provider-schema/4',
  termsPolicyVersion: 'terms/2026-09', quota: { limit: 100, windowMs: 60_000 },
});
const input = (): RankedSyncPlanInput => ({
  now: '2026-10-12T12:00:00+03:00', consent: consent(), provider: provider(), account: { ...account },
  state: state(), quota: { remaining: 12, resetsAt: '2026-10-12T12:01:00+03:00' }, pageSize: 25,
});

describe('provider-neutral ranked sync planning', () => {
  it('plans only an incremental domain request and preserves opaque cursor/watermark', () => {
    expect(planRankedSync(input())).toEqual({
      kind: 'incremental-ranked-sync', engineVersion: 'moe-ranked-sync/1', providerId: 'approved-provider',
      playerId: 'player-1', account, endpointFamily: 'documented-ranked-v2', sourceSchemaVersion: 'provider-schema/4',
      policyVersion: 'terms/2026-09', cursor: 'opaque-cursor', watermark: 'opaque-watermark', pageSize: 25,
      quotaCost: 1, requestedScopes: ['official-rank-rr', 'ranked-match-history'], manualEntryAvailable: true,
    });
  });

  it.each([
    ['missing consent', (x: RankedSyncPlanInput) => { x.consent = null; }, 'consent-missing'],
    ['revoked consent', (x: RankedSyncPlanInput) => { x.consent!.revokedAt = '2026-10-12T11:00:00+03:00'; }, 'consent-revoked'],
    ['missing scope', (x: RankedSyncPlanInput) => { x.consent!.scopes = ['ranked-match-history']; }, 'consent-scope-missing'],
    ['account mismatch', (x: RankedSyncPlanInput) => { x.consent!.account.providerAccountId = 'other'; }, 'account-mismatch'],
    ['unapproved provider', (x: RankedSyncPlanInput) => { x.provider.approvedStatus = 'pending'; }, 'provider-not-approved'],
    ['unconfigured provider', (x: RankedSyncPlanInput) => { x.provider.configured = false; }, 'provider-not-configured'],
    ['undocumented capability', (x: RankedSyncPlanInput) => { x.provider.documentedEndpointFamily = null; }, 'provider-capability-incomplete'],
    ['exhausted quota', (x: RankedSyncPlanInput) => { x.quota.remaining = 0; }, 'quota-exhausted'],
  ])('fails closed for %s while retaining manual entry', (_label, alter, reason) => {
    const changed = input(); alter(changed);
    expect(planRankedSync(changed)).toMatchObject({ kind: 'blocked', reason, status: 'blocked', manualEntryAvailable: true });
  });
});

describe('bounded deterministic retry policy', () => {
  it('uses exponential backoff, deterministic jitter and Retry-After', () => {
    expect(planRankedRetry({ failure: 'rate-limit', attempt: 2, maxAttempts: 5, baseDelayMs: 1_000,
      maxDelayMs: 30_000, jitterUnit: 0, retryAfterMs: 5_000, quotaRemaining: 1 })).toEqual({
      action: 'retry', delayMs: 5_000, nextAttempt: 3, reason: 'rate-limit',
    });
    expect(planRankedRetry({ failure: 'network', attempt: 3, maxAttempts: 5, baseDelayMs: 1_000,
      maxDelayMs: 30_000, jitterUnit: 1, quotaRemaining: 1 })).toMatchObject({ action: 'retry', delayMs: 4_000 });
  });

  it.each(['authentication', 'eligibility', 'consent', 'unknown-account'] as const)('stops on %s', failure => {
    expect(planRankedRetry({ failure, attempt: 1, maxAttempts: 5, baseDelayMs: 100,
      maxDelayMs: 5_000, jitterUnit: 0.5, quotaRemaining: 5 })).toEqual({ action: 'stop', reason: failure });
  });

  it('stops at quota and attempt bounds', () => {
    expect(planRankedRetry({ failure: 'server', attempt: 1, maxAttempts: 5, baseDelayMs: 100,
      maxDelayMs: 5_000, jitterUnit: 0.5, quotaRemaining: 0 })).toEqual({ action: 'stop', reason: 'quota-exhausted' });
    expect(planRankedRetry({ failure: 'server', attempt: 5, maxAttempts: 5, baseDelayMs: 100,
      maxDelayMs: 5_000, jitterUnit: 0.5, quotaRemaining: 2 })).toEqual({ action: 'stop', reason: 'attempts-exhausted' });
  });
});

const mutation = (overrides: Partial<RankedMatchMutation> = {}): RankedMatchMutation => ({
  providerId: 'provider', providerPlayerId: 'provider-player', playerId: 'player', matchId: 'match-1',
  sourceEventId: 'event-1', sourceSchemaVersion: 'schema/1', revision: 1,
  observedAt: '2026-10-12T10:00:00Z', operation: 'upsert', normalized: { officialRr: 55 }, ...overrides,
});

describe('ranked reconciliation', () => {
  it('deduplicates repeated events and applies corrections/tombstones deterministically', () => {
    const original = mutation();
    const correction = mutation({ sourceEventId: 'event-2', revision: 2, normalized: { officialRr: 58 } });
    const tombstone = mutation({ sourceEventId: 'event-3', revision: 3, operation: 'tombstone', normalized: null });
    const result = reconcileRankedMutations([tombstone, original, correction, original]);
    expect(result.duplicateEvents).toEqual(['event-1']);
    expect(result.conflicts).toEqual([]);
    expect(result.records[0]).toMatchObject({ revision: 3, sourceEventId: 'event-3', tombstoned: true, normalized: null });
    expect(reconcileRankedMutations([original, correction, tombstone])).toEqual({ ...result, duplicateEvents: [] });
  });

  it('reports same-revision conflicts without silently choosing the later input', () => {
    const result = reconcileRankedMutations([
      mutation(), mutation({ sourceEventId: 'event-2', normalized: { officialRr: 99 } }),
    ]);
    expect(result.records).toEqual([]);
    expect(result.conflicts).toEqual([{ key: '["provider","player","match-1"]', revision: 1 }]);
  });
});

describe('truthful status and privacy boundaries', () => {
  it('retains last-good facts on errors and represents never-synced/stale/partial explicitly', () => {
    const errored = applyRankedSyncOutcome(state(), { kind: 'error', at: '2026-10-12T12:00:00Z', errorCode: 'timeout' });
    expect(errored).toMatchObject({ status: 'error', knownMatchCount: 14, cursor: 'opaque-cursor', lastErrorCode: 'timeout' });
    expect(deriveRankedSyncStatus({ ...state(), status: 'never-synced', lastSuccessfulSyncAt: null, knownMatchCount: null },
      '2026-10-12T12:00:00Z', 60_000)).toBe('never-synced');
    expect(deriveRankedSyncStatus(state(), '2026-10-12T12:00:00Z', 60_000)).toBe('stale');
    expect(deriveRankedSyncStatus({ ...state(), status: 'partial' }, '2026-10-12T12:00:00Z', 60_000)).toBe('partial');
  });

  it('uses Cairo calendar dates across both DST offsets', () => {
    expect(toRankedCairoDailyBucket('2026-04-23T22:30:00Z')).toEqual({ timeZone: 'Africa/Cairo', dateKey: '2026-04-24' });
    expect(toRankedCairoDailyBucket('2026-10-29T22:30:00Z')).toEqual({ timeZone: 'Africa/Cairo', dateKey: '2026-10-30' });
    expect(toRankedCairoDailyBucket('2026-10-29T22:30:00')).toBeNull();
  });

  it('requires deletion metadata for any temporary raw provider payload', () => {
    expect(validateRankedRetention({ mode: 'normalized-fields-only', allowedNormalizedFields: ['matchId', 'officialRr'],
      capturedAt: '2026-10-12T12:00:00Z', deleteAt: null, purpose: 'ranked-sync-validation' })).toBe(true);
    expect(validateRankedRetention({ mode: 'encrypted-temporary-raw', allowedNormalizedFields: ['matchId'],
      capturedAt: '2026-10-12T12:00:00Z', deleteAt: null, purpose: 'ranked-sync-validation' })).toBe(false);
    expect(validateRankedRetention({ mode: 'encrypted-temporary-raw', allowedNormalizedFields: ['matchId'],
      capturedAt: '2026-10-12T12:00:00Z', deleteAt: '2026-10-13T12:00:00Z', purpose: 'ranked-sync-validation' })).toBe(true);
    expect(validateRankedRetention({ mode: 'normalized-fields-only', allowedNormalizedFields: ['password'],
      capturedAt: '2026-10-12T12:00:00Z', deleteAt: null, purpose: 'ranked-sync-validation' })).toBe(false);
  });
});
