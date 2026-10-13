import { describe, expect, it } from 'vitest';
import { matchPracticeCompleteness, practiceDatasetCoverage } from '../lib/practiceCompleteness';

describe('practice completeness', () => {
  const data = {
    settings: { players: ['Legacy'] },
    rosterPlayers: [{ id: 'p1', displayName: 'Alpha' }, { id: 'p2', displayName: 'Bravo' }, { id: 'old', displayName: 'Old', retiredAt: '2026-01-01' }],
    matches: [{ id: 'm1' }, { id: 'm2' }],
    playerStats: [{ matchId: 'm1', player: 'Renamed Alpha', playerId: 'p1' }, { matchId: 'm1', player: 'Guest' }],
    rounds: [
      { id: 'r1', matchId: 'm1', roundNo: 1, buy: 'Full', clutchType: '1v2', replayEvidence: { tacticalAssessment: 'reviewed' } },
      { id: 'r2', matchId: 'm1', roundNo: 2, buy: '', replayEvidence: { tradeOpportunities: 0, successfulTrades: 0, tacticalAssessment: 'unreviewed' } },
      { id: 'r3', matchId: 'm1', roundNo: 3, isThrow: 'TRUE', notes: 'Coach reviewed the overpeek.' },
    ],
  };

  it('reports mapped active roster, evidence coverage, and explicit tactical review states', () => {
    expect(matchPracticeCompleteness(data, 'm1')).toMatchObject({
      roster: { mapped: 1, expected: 2, rows: 2 },
      rounds: { recorded: 3, economyKnown: 1 },
      tactical: { reviewed: 2, unreviewed: 1 },
    });
  });

  it('reports dataset coverage without manufacturing missing match evidence', () => {
    expect(practiceDatasetCoverage(data)).toEqual({ matches: 2, withStats: 1, withRounds: 1 });
  });
});
