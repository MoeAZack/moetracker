import { describe, expect, it } from 'vitest';
import {
  applyImmutableEntryMetadata,
  buildScreenshotReviewDraft,
  canCommitScreenshotReview,
  prepareLiveFinalStat,
  reconcileStatTotals,
} from '../lib/entryEngine';
import { saveMatchSchema } from '../schemas';

describe('honest entry engine', () => {
  it('accepts replay-derived fractional HS percentages and their auditable counters', () => {
    const parsed = saveMatchSchema.safeParse({
      match: { id: 'match-1' },
      statsUpdate: { operation: 'replace', stats: [{
        id: 'stat-1', matchId: 'match-1', player: 'Alpha', hs: 33.33,
        headshots: 1, headshotEligibleKills: 3, orbPoints: 2,
      }] },
    });
    expect(parsed.success).toBe(true);
  });

  it('preserves imported totals until both side splits are known', () => {
    expect(reconcileStatTotals({
      kills: 20, kAtt: 8, kDef: null,
      deaths: 14, dAtt: undefined, dDef: undefined,
      assists: 99, aAtt: 3, aDef: 4,
    })).toMatchObject({ kills: 20, deaths: 14, assists: 7 });
    expect(reconcileStatTotals({ kills: null, kAtt: null, kDef: null }).kills).toBeNull();
    expect(reconcileStatTotals({ kills: 0, kAtt: null, kDef: null }).kills).toBe(0);
  });

  it('normalizes screenshot output into one review-only contract with unknown distinct from zero', () => {
    const draft = buildScreenshotReviewDraft({
      map: 'Ascent', ourScore: 13, theirScore: 0, confident: false,
      players: [{ name: 'Alpha', agent: 'Omen', kills: 0, deaths: null, assists: 4, acs: null }],
    }, {
      model: 'test-model',
      capturedAt: '2026-10-12T12:00:00.000Z',
      rosterPlayers: [{ id: 'player-1', displayName: 'Alpha' }],
    });

    expect(draft).toMatchObject({
      contractVersion: 1, status: 'review-required', reviewRequired: true,
      match: { ourScore: 13, theirScore: 0, alliedSideConfirmed: false, attW: null, defW: null },
      stats: [{ matchedPlayerId: 'player-1', kills: 0, deaths: null, acs: null, kAtt: null }],
    });
  });

  it('keeps source immutable and appends server-owned correction history', () => {
    const source = { method: 'screenshot' as const, provider: 'gemini', capturedAt: '2026-10-12T12:00:00.000Z' };
    const existing = { id: 'match-1', opponent: 'Before', sourceMetadata: source, corrections: [] };
    const updated = applyImmutableEntryMetadata(existing, {
      id: 'match-1', opponent: 'After',
      sourceMetadata: { method: 'manual', capturedAt: '2099-01-01T00:00:00.000Z' },
      corrections: [{ correctedAt: 'fake', correctedBy: 'fake', fields: ['fake'] }],
    }, 'Coach', '2026-10-12T13:00:00.000Z');

    expect(updated.sourceMetadata).toEqual(source);
    expect(updated.corrections).toEqual([{
      correctedAt: '2026-10-12T13:00:00.000Z', correctedBy: 'Coach', fields: ['opponent'],
    }]);
  });

  it('requires explicit allied-side confirmation and complete screenshot match identity', () => {
    const complete = { opponent: 'Opponent', map: 'Ascent', ourScore: 13, theirScore: 0 };
    expect(canCommitScreenshotReview(complete, false)).toBe(false);
    expect(canCommitScreenshotReview({ ...complete, map: '' }, true)).toBe(false);
    expect(canCommitScreenshotReview({ ...complete, ourScore: null }, true)).toBe(false);
    expect(canCommitScreenshotReview(complete, true)).toBe(true);
  });

  it('keeps a legacy source authoritative over submitted provenance', () => {
    const updated = applyImmutableEntryMetadata(
      { id: 'legacy', source: 'manual' },
      { id: 'legacy', sourceMetadata: { method: 'screenshot', capturedAt: '2099-01-01T00:00:00.000Z' } },
      'Coach',
      '2026-10-12T13:00:00.000Z',
    );
    expect(updated.sourceMetadata.method).toBe('manual');
  });

  it('rejects non-finite numeric ratings before JSON transport can coerce them', () => {
    const request = (rating: number) => ({
      match: { opponent: 'Opponent' },
      statsUpdate: { operation: 'replace', stats: [{ player: 'Alpha', rating }] },
    });
    expect(saveMatchSchema.safeParse(request(Number.NaN)).success).toBe(false);
    expect(saveMatchSchema.safeParse(request(Number.POSITIVE_INFINITY)).success).toBe(false);
  });

  it('reuses persisted live-row identity and marks only later additions as creates', () => {
    const persisted = {
      id: 'server-stat', matchId: 'live-match', player: 'Alpha',
      sourceMetadata: { method: 'live-logger', capturedAt: '2026-10-12T12:00:00.000Z' },
      corrections: [{ correctedAt: '2026-10-12T12:01:00.000Z', correctedBy: 'Coach', fields: ['kills'] }],
    };
    const updated = prepareLiveFinalStat({ matchId: 'live-match', player: 'Alpha', kills: 13 }, persisted);
    expect(updated).toMatchObject({
      id: 'server-stat', kills: 13,
      sourceMetadata: persisted.sourceMetadata,
      corrections: persisted.corrections,
    });
    expect(updated).not.toHaveProperty('rowOperation');
    expect(prepareLiveFinalStat({ matchId: 'live-match', player: 'Late Player' })).toMatchObject({
      id: '', rowOperation: 'create', player: 'Late Player',
    });
  });
});
