import type { AppearanceType, MatchRosterContext, PlayerStats } from '../types';

export function reconcileAppearanceMap(
  current: Record<string, AppearanceType>,
  context: MatchRosterContext,
): Record<string, AppearanceType> {
  if (context.kind === 'mixed' || context.kind === 'unclassified') return current;
  const required: AppearanceType = context.kind === 'tryout' ? 'tryout' : 'core';
  return Object.fromEntries(Object.keys(current).map(player => [player, required]));
}

export function reconcileStatsForContext(
  stats: PlayerStats[],
  context: MatchRosterContext,
): PlayerStats[] {
  if (context.kind === 'unclassified') {
    return stats.map(({ playerId: _playerId, displayNameSnapshot: _snapshot, appearanceType: _appearance, ...stat }) => stat as PlayerStats);
  }
  if (context.kind === 'mixed') return stats;
  const required: AppearanceType = context.kind === 'tryout' ? 'tryout' : 'core';
  return stats.map(stat => ({ ...stat, appearanceType: required }));
}
