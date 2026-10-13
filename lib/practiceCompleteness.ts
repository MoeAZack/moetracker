type PracticeData = {
  settings?: { players?: string[] };
  rosterPlayers?: Array<{ id: string; displayName: string; retiredAt?: string }>;
  matches?: Array<{ id: string }>;
  playerStats?: Array<{ matchId: string; player?: string; playerId?: string }>;
  rounds?: Array<{
    id: string; matchId: string; roundNo: number; buy?: unknown;
    clutchType?: unknown; clutchPlayer?: unknown; clutchResult?: unknown;
    isThrow?: unknown; throwReason?: unknown; thrownBy?: unknown;
    notes?: unknown;
    replayEvidence?: unknown;
  }>;
};

export type TacticalRound = {
  id: string;
  roundNo: number;
  signals: string[];
  reviewState: 'reviewed' | 'unreviewed';
};

const text = (value: unknown) => typeof value === 'string' && value.trim().length > 0;

export function matchPracticeCompleteness(data: PracticeData, matchId: string) {
  const stats = (data.playerStats || []).filter(row => row.matchId === matchId);
  const rounds = (data.rounds || []).filter(round => round.matchId === matchId);
  const activeRoster = (data.rosterPlayers || []).filter(player => !player.retiredAt);
  const expectedIdentities = activeRoster.length
    ? activeRoster.map(player => ({ id: player.id, name: player.displayName }))
    : (data.settings?.players || []).map(name => ({ id: '', name }));
  const mappedRoster = expectedIdentities.filter(identity => stats.some(row =>
    (identity.id && row.playerId === identity.id) || row.player === identity.name
  )).length;

  const tacticalRounds: TacticalRound[] = rounds.flatMap(round => {
    const replay = (round as any).replayEvidence;
    const signals: string[] = [];
    if (text(round.clutchType) || text(round.clutchPlayer) || text(round.clutchResult)) signals.push('clutch');
    if (String(round.isThrow).toLowerCase() === 'true' || text(round.throwReason) || text(round.thrownBy)) signals.push('throw');
    if (replay && (typeof replay.tradeOpportunities === 'number' || typeof replay.successfulTrades === 'number')) signals.push('trade');
    if (!signals.length) return [];
    return [{
      id: String(round.id || `${matchId}:${round.roundNo}`),
      roundNo: round.roundNo,
      signals,
      // A saved round note is the existing persisted coach annotation. Replay
      // intake starts tactical evidence as unreviewed; no separate review-state
      // write exists, so notes are the honest completion signal in this view.
      reviewState: replay?.tacticalAssessment === 'reviewed' || text(round.notes) ? 'reviewed' as const : 'unreviewed' as const,
    }];
  });

  return {
    roster: { mapped: mappedRoster, expected: expectedIdentities.length, rows: stats.length },
    rounds: { recorded: rounds.length, economyKnown: rounds.filter(round => text(round.buy)).length },
    tactical: {
      reviewed: tacticalRounds.filter(round => round.reviewState === 'reviewed').length,
      unreviewed: tacticalRounds.filter(round => round.reviewState === 'unreviewed').length,
      rounds: tacticalRounds,
    },
  };
}

export function practiceDatasetCoverage(data: PracticeData) {
  const matchIds = new Set((data.matches || []).map(match => match.id));
  const statsMatches = new Set((data.playerStats || []).filter(row => matchIds.has(row.matchId)).map(row => row.matchId));
  const roundMatches = new Set((data.rounds || []).filter(row => matchIds.has(row.matchId)).map(row => row.matchId));
  return { matches: matchIds.size, withStats: statsMatches.size, withRounds: roundMatches.size };
}
