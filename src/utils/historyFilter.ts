import type { AppearanceType, TrackerData } from '../types';

export type AppearanceHistoryFilter = AppearanceType | 'unclassified' | 'all';

export function filterAnalyticsHistory(
  data: TrackerData,
  appearance: AppearanceHistoryFilter = 'all',
  includeArchivedTryouts = false,
): TrackerData {
  const archivedBatchIds = new Set(
    (data.tryoutBatches || []).filter(batch => batch.status === 'archived').map(batch => batch.id),
  );
  const hiddenTryoutMatchIds = new Set(
    includeArchivedTryouts ? [] : (data.matches || [])
      .filter(match => match.rosterContext?.kind === 'tryout' && match.rosterContext.tryoutBatchId && archivedBatchIds.has(match.rosterContext.tryoutBatchId))
      .map(match => match.id),
  );
  const matches = (data.matches || []).filter(match => !hiddenTryoutMatchIds.has(match.id));
  const playerStats = (data.playerStats || []).filter(stat => {
    if (hiddenTryoutMatchIds.has(stat.matchId)) return false;
    const match = (data.matches || []).find(entry => entry.id === stat.matchId);
    const hidesArchivedMixedTryout = !includeArchivedTryouts
      && match?.rosterContext?.kind === 'mixed'
      && !!match.rosterContext.tryoutBatchId
      && archivedBatchIds.has(match.rosterContext.tryoutBatchId)
      && stat.appearanceType === 'tryout';
    if (hidesArchivedMixedTryout) return false;
    if (appearance === 'all') return true;
    if (appearance === 'unclassified') return !stat.appearanceType;
    return stat.appearanceType === appearance;
  });
  const visibleMatchIds = new Set(matches.map(match => match.id));
  return {
    ...data,
    matches,
    playerStats,
    rounds: (data.rounds || []).filter(round => visibleMatchIds.has(round.matchId)),
    vetos: (data.vetos || []).filter(veto => visibleMatchIds.has(veto.matchId)),
    stratRuns: (data.stratRuns || []).filter(run => !run.matchId || visibleMatchIds.has(run.matchId)),
  };
}
