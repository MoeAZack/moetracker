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
  type OfficialRankedFact,
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
  lastAttemptGeneration: 3, lastAttemptStartedAt: '2026-10-12T08:59:00Z',
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
  state: state(), quota: { remaining: 12, windowStartedAt: '2026-10-12T12:00:00+03:00', resetsAt: '2026-10-12T12:01:00+03:00' },
  requestedScopes: ['ranked-match-history', 'official-rank-rr'], pageSize: 25,
});

describe('provider-neutral ranked sync planning', () => {
  it('plans only an incremental domain request and preserves opaque cursor/watermark', () => {
    expect(planRankedSync(input())).toEqual({
      kind: 'incremental-ranked-sync', engineVersion: 'moe-ranked-sync/1', providerId: 'approved-provider',
      playerId: 'player-1', account, endpointFamily: 'documented-ranked-v2', sourceSchemaVersion: 'provider-schema/4',
      policyVersion: 'terms/2026-09', cursor: 'opaque-cursor', watermark: 'opaque-watermark', pageSize: 25,
      quotaCost: 1, requestedScopes: ['official-rank-rr', 'ranked-match-history'],
      attempt: { generation: 4, startedAt: '2026-10-12T12:00:00+03:00' }, manualEntryAvailable: true,
    });
  });

  it.each([
    ['missing consent', (x: RankedSyncPlanInput) => { x.consent = null; }, 'consent-missing'],
    ['revoked consent', (x: RankedSyncPlanInput) => { x.consent!.revokedAt = '2026-10-12T11:00:00+03:00'; }, 'consent-revoked'],
    ['missing scope', (x: RankedSyncPlanInput) => { x.consent!.scopes = ['ranked-match-history']; }, 'consent-scope-missing'],
    ['empty requested scopes', (x: RankedSyncPlanInput) => { x.requestedScopes = []; }, 'invalid-input'],
    ['unknown requested scope', (x: RankedSyncPlanInput) => {
      x.requestedScopes = ['private-profile'] as unknown as RankedSyncPlanInput['requestedScopes'];
    }, 'invalid-input'],
    ['future consent', (x: RankedSyncPlanInput) => { x.consent!.grantedAt = '2026-10-12T12:00:01+03:00'; }, 'invalid-input'],
    ['account mismatch', (x: RankedSyncPlanInput) => { x.consent!.account.providerAccountId = 'other'; }, 'account-mismatch'],
    ['unapproved provider', (x: RankedSyncPlanInput) => { x.provider.approvedStatus = 'pending'; }, 'provider-not-approved'],
    ['unconfigured provider', (x: RankedSyncPlanInput) => { x.provider.configured = false; }, 'provider-not-configured'],
    ['undocumented capability', (x: RankedSyncPlanInput) => { x.provider.documentedEndpointFamily = null; }, 'provider-capability-incomplete'],
    ['exhausted quota', (x: RankedSyncPlanInput) => { x.quota.remaining = 0; }, 'quota-exhausted'],
    ['quota above limit', (x: RankedSyncPlanInput) => { x.quota.remaining = 101; }, 'invalid-input'],
    ['fractional quota', (x: RankedSyncPlanInput) => { x.quota.remaining = 1.5; }, 'invalid-input'],
    ['non-finite quota capability', (x: RankedSyncPlanInput) => { x.provider.quota!.windowMs = Number.POSITIVE_INFINITY; }, 'provider-capability-incomplete'],
    ['expired quota window', (x: RankedSyncPlanInput) => {
      x.quota.windowStartedAt = '2026-10-12T11:59:00+03:00'; x.quota.resetsAt = x.now;
    }, 'quota-window-expired'],
  ])('fails closed for %s while retaining manual entry', (_label, alter, reason) => {
    const changed = input(); alter(changed);
    expect(planRankedSync(changed)).toMatchObject({ kind: 'blocked', reason, status: 'blocked', manualEntryAvailable: true });
  });
});

describe('bounded deterministic retry policy', () => {
  it('uses exponential backoff, deterministic jitter and Retry-After', () => {
    expect(planRankedRetry({ failure: 'rate-limit', attempt: 2, maxAttempts: 5, baseDelayMs: 1_000,
      maxDelayMs: 30_000, jitterBasisPoints: 0, retryAfterMs: 5_000, quotaRemaining: 1 })).toEqual({
      action: 'retry', delayMs: 5_000, nextAttempt: 3, reason: 'rate-limit',
    });
    expect(planRankedRetry({ failure: 'network', attempt: 3, maxAttempts: 5, baseDelayMs: 1_000,
      maxDelayMs: 30_000, jitterBasisPoints: 10_000, quotaRemaining: 1 })).toMatchObject({ action: 'retry', delayMs: 4_000 });
  });

  it.each(['authentication', 'eligibility', 'consent', 'unknown-account'] as const)('stops on %s', failure => {
    expect(planRankedRetry({ failure, attempt: 1, maxAttempts: 5, baseDelayMs: 100,
      maxDelayMs: 5_000, jitterBasisPoints: 5_000, quotaRemaining: 5 })).toEqual({ action: 'stop', reason: failure });
  });

  it('stops at quota and attempt bounds', () => {
    expect(planRankedRetry({ failure: 'server', attempt: 1, maxAttempts: 5, baseDelayMs: 100,
      maxDelayMs: 5_000, jitterBasisPoints: 5_000, quotaRemaining: 0 })).toEqual({ action: 'stop', reason: 'quota-exhausted' });
    expect(planRankedRetry({ failure: 'server', attempt: 5, maxAttempts: 5, baseDelayMs: 100,
      maxDelayMs: 5_000, jitterBasisPoints: 5_000, quotaRemaining: 2 })).toEqual({ action: 'stop', reason: 'attempts-exhausted' });
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 86_400_001, 1.5])('rejects malformed Retry-After %s', retryAfterMs => {
    expect(planRankedRetry({ failure: 'rate-limit', attempt: 1, maxAttempts: 3, baseDelayMs: 100,
      maxDelayMs: 5_000, jitterBasisPoints: 5_000, retryAfterMs, quotaRemaining: 2 }))
      .toEqual({ action: 'stop', reason: 'invalid-retry-input' });
  });

  it('rejects non-integer retry and quota planning inputs', () => {
    expect(planRankedRetry({ failure: 'network', attempt: 1, maxAttempts: 3, baseDelayMs: Number.NaN,
      maxDelayMs: 5_000, jitterBasisPoints: 5_000, quotaRemaining: 2 }))
      .toEqual({ action: 'stop', reason: 'invalid-retry-input' });
    expect(planRankedRetry({ failure: 'authentication', attempt: 1, maxAttempts: 3, baseDelayMs: 100,
      maxDelayMs: 5_000, jitterBasisPoints: 5_000, retryAfterMs: Number.NaN, quotaRemaining: 2 }))
      .toEqual({ action: 'stop', reason: 'invalid-retry-input' });
    expect(planRankedRetry({ failure: 'network', attempt: 1, maxAttempts: 3, baseDelayMs: 100,
      maxDelayMs: 5_000, jitterBasisPoints: 5_000.5, quotaRemaining: 2 }))
      .toEqual({ action: 'stop', reason: 'invalid-retry-input' });
  });
});

const fact = (overrides: Partial<OfficialRankedFact> = {}): OfficialRankedFact => ({
  kind: 'official-provider-ranked-fact', mode: 'ranked', queue: 'competitive', providerId: 'provider',
  providerPlayerId: 'provider-player', sourceSchemaVersion: 'schema/1', playerId: 'player', matchId: 'match-1',
  playedAt: '2026-10-12T09:00:00Z', mapId: 'ascent', outcome: 'win', ourScore: 13, theirScore: 9,
  officialRank: 'Gold 2', officialRr: 55, ...overrides,
});
const mutation = (overrides: Partial<RankedMatchMutation> = {}): RankedMatchMutation => ({
  providerId: 'provider', providerPlayerId: 'provider-player', playerId: 'player', matchId: 'match-1',
  sourceEventId: 'event-1', sourceSchemaVersion: 'schema/1', revision: 1,
  observedAt: '2026-10-12T10:00:00Z', operation: 'upsert', normalized: fact(), ...overrides,
});

describe('ranked reconciliation', () => {
  it('deduplicates repeated events and applies corrections/tombstones deterministically', () => {
    const original = mutation();
    const correction = mutation({ sourceEventId: 'event-2', revision: 2, normalized: fact({ officialRr: 58 }) });
    const tombstone = mutation({ sourceEventId: 'event-3', revision: 3, operation: 'tombstone', normalized: null });
    const result = reconcileRankedMutations([tombstone, original, correction, original]);
    expect(result.duplicateEvents).toEqual(['event-1']);
    expect(result.conflicts).toEqual([]);
    expect(result.records[0]).toMatchObject({ revision: 3, sourceEventId: 'event-3', tombstoned: true, normalized: null });
    expect(reconcileRankedMutations([original, correction, tombstone])).toEqual({ ...result, duplicateEvents: [] });
  });

  it('reports same-revision conflicts without silently choosing the later input', () => {
    const result = reconcileRankedMutations([
      mutation(), mutation({ sourceEventId: 'event-2', normalized: fact({ officialRr: 99 }) }),
    ]);
    expect(result.records).toEqual([]);
    expect(result.conflicts).toEqual([{ key: '["provider","player","match-1"]', revision: 1 }]);
  });

  it('treats key order and observation time as metadata while retaining real semantic conflicts', () => {
    const reordered = Object.fromEntries(Object.entries(fact()).reverse()) as unknown as OfficialRankedFact;
    const duplicate = mutation({ sourceEventId: 'event-2', observedAt: '2026-10-12T10:05:00Z', normalized: reordered });
    const result = reconcileRankedMutations([mutation(), duplicate]);
    expect(result.conflicts).toEqual([]);
    expect(result.duplicateEvents).toEqual(['event-2']);
    expect(result.records).toHaveLength(1);
  });

  it.each([
    ['raw payload', { ...fact(), rawPayload: { token: 'secret' } }],
    ['credential', { ...fact(), password: 'secret' }],
    ['scrim mode', { ...fact(), mode: 'scrim' }],
    ['custom queue', { ...fact(), queue: 'custom' }],
    ['shadow rating', { ...fact(), customShadowRating: 1.2 }],
    ['wrong source identity', { ...fact(), providerId: 'other-provider' }],
  ])('rejects %s normalized data', (_label, normalized) => {
    expect(() => reconcileRankedMutations([mutation({ normalized: normalized as unknown as OfficialRankedFact })])).toThrow(TypeError);
  });
});

describe('truthful status and privacy boundaries', () => {
  it('retains last-good facts on errors and represents never-synced/stale/partial explicitly', () => {
    const errored = applyRankedSyncOutcome(state(), { kind: 'error', generation: 4,
      startedAt: '2026-10-12T11:59:00Z', at: '2026-10-12T12:00:00Z', errorCode: 'timeout' });
    expect(errored).toMatchObject({ status: 'error', knownMatchCount: 14, cursor: 'opaque-cursor', lastErrorCode: 'timeout' });
    expect(deriveRankedSyncStatus({ ...state(), status: 'never-synced', lastSuccessfulSyncAt: null, knownMatchCount: null },
      '2026-10-12T12:00:00Z', 60_000)).toBe('never-synced');
    expect(deriveRankedSyncStatus(state(), '2026-10-12T12:00:00Z', 60_000)).toBe('stale');
    expect(deriveRankedSyncStatus({ ...state(), status: 'partial' }, '2026-10-12T12:00:00Z', 60_000)).toBe('partial');
  });

  it('ignores stale attempts and uses fail-closed equal-time precedence', () => {
    const current = applyRankedSyncOutcome(state(), { kind: 'success', generation: 5,
      startedAt: '2026-10-12T10:00:00Z', at: '2026-10-12T10:01:00Z', cursor: 'new-cursor',
      watermark: 'new-watermark', knownMatchCount: 20 });
    const stale = applyRankedSyncOutcome(current, { kind: 'success', generation: 4,
      startedAt: '2026-10-12T09:30:00Z', at: '2026-10-12T12:00:00Z', cursor: 'old-cursor',
      watermark: 'old-watermark', knownMatchCount: 1 });
    expect(stale).toEqual(current);
    const falselyNewGeneration = applyRankedSyncOutcome(current, { kind: 'success', generation: 6,
      startedAt: '2026-10-12T09:00:00Z', at: '2026-10-12T12:00:00Z', cursor: 'old-cursor',
      watermark: 'old-watermark', knownMatchCount: 1 });
    expect(falselyNewGeneration).toEqual(current);
    const olderSameAttempt = applyRankedSyncOutcome(current, { kind: 'partial', generation: 5,
      startedAt: '2026-10-12T10:00:00Z', at: '2026-10-12T10:00:30Z', cursor: 'old-cursor',
      watermark: 'old-watermark', knownMatchCount: 2, errorCode: 'late-page' });
    expect(olderSameAttempt).toEqual(current);
    const blocked = applyRankedSyncOutcome(current, { kind: 'blocked', generation: 5,
      startedAt: '2026-10-12T10:00:00Z', at: '2026-10-12T10:01:00Z', errorCode: 'consent-revoked' });
    expect(blocked.status).toBe('blocked');
    expect(applyRankedSyncOutcome(blocked, { kind: 'success', generation: 6,
      startedAt: '2026-10-12T11:00:00Z', at: '2026-10-12T11:01:00Z', cursor: 'unsafe',
      watermark: 'unsafe', knownMatchCount: 99 })).toEqual(blocked);
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
