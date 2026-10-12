import { describe, expect, it } from 'vitest';
import { activeRosterCount, matchDateWindow, resolveInitialVodSelection, selectedVodMatchId } from '../lib/uiIntegration';
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
  });
});

describe('dashboard normalization', () => {
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
