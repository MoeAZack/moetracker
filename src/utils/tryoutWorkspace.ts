import type { TrackerData, MatchRosterContext } from '../types';

export function activeTryoutPhase(data: TrackerData) {
  return data.settings.tryoutsMode ? (data.tryoutBatches || []).find(batch => batch.id === data.settings.activeTryoutBatchId && batch.status === 'active') : undefined;
}

/** View-only separation. Switching modes never deletes or rewrites saved facts. */
export function filterTryoutWorkspace(data: TrackerData, historicalPhaseId?: string): TrackerData {
  const phase = (historicalPhaseId ? (data.tryoutBatches || []).find(batch => batch.id === historicalPhaseId && batch.status === 'archived') : undefined) || activeTryoutPhase(data);
  const phaseMatch = (match: TrackerData['matches'][number]) => !!match.rosterContext?.tryoutBatchId || match.rosterContext?.kind === 'tryout';
  const matches = data.matches.filter(match => phase ? match.rosterContext?.tryoutBatchId === phase.id : !phaseMatch(match));
  const ids = new Set(matches.map(match => match.id));
  const phasePlayers = phase ? (data.rosterPlayers || []).filter(player => phase.candidatePlayerIds.includes(player.id)).map(player => player.displayName) : data.settings.players;
  return { ...data, settings: { ...data.settings, players: phasePlayers }, matches, playerStats: data.playerStats.filter(row => ids.has(row.matchId)), rounds: (data.rounds || []).filter(row => ids.has(row.matchId)), vetos: (data.vetos || []).filter(row => ids.has(row.matchId)), vodReviews: (data.vodReviews || []).filter(row => row.matchId ? ids.has(row.matchId) : !phase), stratRuns: (data.stratRuns || []).filter(row => row.matchId ? ids.has(row.matchId) : !phase) };
}

export function newWorkspaceMatchContext(data: TrackerData): MatchRosterContext {
  const phase = activeTryoutPhase(data);
  return phase ? { kind: 'tryout', tryoutBatchId: phase.id } : { kind: 'core' };
}

export function resolvePhaseAlias(data: TrackerData, name: string): string | undefined {
  const phase = activeTryoutPhase(data); const normalized = name.trim().toLocaleLowerCase();
  if (!phase || !normalized) return undefined;
  const ids = new Set((phase.aliases || []).filter(item => item.alias.trim().toLocaleLowerCase() === normalized && phase.candidatePlayerIds.includes(item.playerId)).map(item => item.playerId));
  return ids.size === 1 ? [...ids][0] : undefined;
}
