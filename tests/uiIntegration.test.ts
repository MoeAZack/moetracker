import { describe, expect, it } from 'vitest';
import { activeRosterCount, aggregateObservedPlayerKd, cairoDateKeyAt, canOpenPrivateMatchReview, engineAdapterUiSummary, matchDateWindow, rankedIntegrationReadiness, replayIntegrationReadiness, resolveInitialVodSelection, selectedVodMatchId, shadowRatingReadiness, vodContextMatchId } from '../lib/uiIntegration';
import type { Match, VodReview } from '../src/types';

const review = (id: string, matchId?: string): VodReview => ({ id, matchId, title: id, vodUrl: 'https://example.invalid', notes: [] });

describe('VOD selection behavior', () => {
  it('selects the initial linked review once and preserves a later user selection across refreshed objects', () => {
    const first = [review('a', 'm1'), review('b', 'm2')];
    expect(resolveInitialVodSelection(first, 'm1')).toBe('a');
    const refreshed = first.map(item => ({ ...item }));
    expect(selectedVodMatchId(refreshed, 'b')).toBe('m2');
  });
  it('does not fall back to initial match context for an unlinked selected review', () => {
    const reviews = [review('unlinked'), review('linked', 'm1')];
    expect(selectedVodMatchId(reviews, 'unlinked')).toBeNull();
    expect(resolveInitialVodSelection(reviews, 'missing')).toBeNull();
    expect(vodContextMatchId(reviews, 'unlinked', 'm1', true)).toBeNull();
  });
  it('preserves an initially requested unlinked match until a review is explicitly selected', () => {
    const reviews = [review('unlinked'), review('linked', 'm2')];
    expect(vodContextMatchId(reviews, null, 'm1', false)).toBe('m1');
    expect(vodContextMatchId(reviews.map(item => ({ ...item })), null, 'm1', false)).toBe('m1');
    expect(vodContextMatchId(reviews, 'unlinked', 'm1', true)).toBeNull();
  });
});

describe('observed player K/D aggregation', () => {
  it('uses only finite kills and deaths paired on the same row', () => {
    const result = aggregateObservedPlayerKd([
      { id: 'a', matchId: 'm1', player: 'Alpha', playerId: 'p1', kills: 10, deaths: null },
      { id: 'b', matchId: 'm2', player: 'Alpha', playerId: 'p1', kills: null, deaths: 5 },
      { id: 'c', matchId: 'm3', player: 'Alpha', playerId: 'p1', kills: 8, deaths: 4 },
    ] as any);
    expect(result[0]).toMatchObject({ pairedSamples: 1, recordedRows: 3, kd: 2 });
  });
  it('keeps identical display names with different stable IDs separate', () => {
    const result = aggregateObservedPlayerKd([
      { id: 'a', matchId: 'm1', player: 'Same', playerId: 'p1', kills: 10, deaths: 5 },
      { id: 'b', matchId: 'm2', player: 'Same', playerId: 'p2', kills: 3, deaths: 6 },
    ] as any);
    expect(result.map(row => [row.playerId, row.kd])).toEqual([['p1', 2], ['p2', 0.5]]);
  });
});

describe('role-safe match actions', () => {
  it('permits private match review only for coaches', () => {
    expect(canOpenPrivateMatchReview('coach')).toBe(true);
    expect(canOpenPrivateMatchReview('player')).toBe(false);
    expect(canOpenPrivateMatchReview(null)).toBe(false);
  });
});

describe('engine adapter UI summary', () => {
  it('labels accepted evidence without implying ranked activation or rating authority', () => {
    expect(engineAdapterUiSummary({
      replay: [{ status: 'accepted' }], ratings: [{ status: 'accepted' }],
      ranked: { consents: [{ revokedAt: null }] },
    })).toEqual({
      replay: { configured: true, note: '1 persisted review; acceptance required' },
      shadowRating: { configured: true, note: '1 recomputed shadow record; uncalibrated results stay experimental and never authoritative' },
      rankedConsent: { configured: true, note: 'Offline consent/status only; provider sync remains disabled' },
    });
  });
  it('derives readiness and ranked health from persisted adapter facts', () => {
    const payload = { replay: [{ status: 'accepted' }], ratings: { records: { r: { status: 'accepted', calibrationStatus: 'uncalibrated', result: { eligibleForShadowAggregate: true } } } }, ranked: { providers: [{ approvedStatus: 'approved' }], accounts: [{}], consents: [{ revokedAt: null }], states: [{ status: 'fresh' }, { status: 'partial' }, { status: 'never-synced' }] } };
    expect(replayIntegrationReadiness(payload)).toMatchObject({ status: 'ready', detail: expect.stringContaining('1 accepted') });
    expect(shadowRatingReadiness(payload)).toMatchObject({ status: 'ready', detail: expect.stringContaining('1 accepted with coverage') });
    const ranked = rankedIntegrationReadiness(payload); expect(ranked.status).toBe('ready'); expect(ranked.detail).toContain('1 fresh'); expect(ranked.detail).toContain('1 partial'); expect(ranked.detail).toContain('1 never-synced'); expect(ranked.detail).not.toContain('healthy');
  });
  it('counts an accepted player-safe shadow projection without private coach result input', () => {
    const readiness = shadowRatingReadiness({ ratings: [{ status: 'accepted', acceptedWithCoverage: true, calibrationStatus: 'uncalibrated', experimental: true, coverage: { availableWeight: .8, totalWeight: 1, ratio: .8 }, score: 1.07, authoritativeScore: null }] });
    expect(readiness).toMatchObject({ status: 'ready', detail: expect.stringContaining('1 accepted with coverage') });
  });
});

describe('dashboard normalization', () => {
  it('uses Africa/Cairo for winter, summer DST and UTC-midnight date defaults', () => {
    expect(cairoDateKeyAt(new Date('2026-01-01T22:00:00.000Z'))).toBe('2026-01-02');
    expect(cairoDateKeyAt(new Date('2026-07-01T21:00:00.000Z'))).toBe('2026-07-02');
    expect(cairoDateKeyAt(new Date('2026-01-01T00:00:00.000Z'))).toBe('2026-01-01');
  });
  it('includes offset timestamps by Cairo date and excludes malformed dates without throwing', () => {
    const matches = [
      { date: '2026-10-11T22:30:00Z' },
      { date: 'bad-date' },
      { date: '2026-10-13' },
    ] as Match[];
    expect(matchDateWindow(matches)).toEqual({ start: '2026-10-12', end: '2026-10-13' });
  });
  it('distinguishes a valid zero-active membership model from missing legacy membership data', () => {
    const settings = { players: ['Legacy'] } as any;
    expect(activeRosterCount({ coreMemberships: [{ id: 'm', playerId: 'p', joinedAt: '2026-01-01', endedAt: '2026-02-01' }], settings })).toEqual({ count: 0, source: 'membership' });
    expect(activeRosterCount({ coreMemberships: undefined as any, settings })).toEqual({ count: 1, source: 'legacy' });
  });
});
