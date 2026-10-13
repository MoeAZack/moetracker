import { expect, it } from 'vitest';
import { filterTryoutWorkspace, resolvePhaseAlias, newWorkspaceMatchContext } from '../src/utils/tryoutWorkspace';

it('separates recurring phases from core history without mutating evidence', () => {
  const data: any = { settings: { tryoutsMode: true, activeTryoutBatchId: 'next' }, tryoutBatches: [{ id: 'old', status: 'archived' }, { id: 'next', status: 'active', candidatePlayerIds: ['p'], aliases: [{ playerId: 'p', alias: 'Alternate#1' }] }], matches: [{ id: 'core', rosterContext: { kind: 'core' } }, { id: 'old', rosterContext: { kind: 'tryout', tryoutBatchId: 'old' } }, { id: 'next', rosterContext: { kind: 'mixed', tryoutBatchId: 'next' } }], playerStats: [{ matchId: 'core' }, { matchId: 'next' }], rounds: [{ matchId: 'next' }], vodReviews: [{ matchId: 'old' }, { matchId: 'next' }] };
  expect(filterTryoutWorkspace(data).matches.map(row => row.id)).toEqual(['next']);
  expect(resolvePhaseAlias(data, 'alternate#1')).toBe('p');
  expect(newWorkspaceMatchContext(data)).toEqual({ kind: 'tryout', tryoutBatchId: 'next' });
  data.settings.tryoutsMode = false;
  expect(filterTryoutWorkspace(data).matches.map(row => row.id)).toEqual(['core']);
  expect(resolvePhaseAlias(data, 'Alternate#1')).toBeUndefined();
  expect(data.matches).toHaveLength(3);
  expect(filterTryoutWorkspace(data, 'old').matches.map(row => row.id)).toEqual(['old']);
  expect(filterTryoutWorkspace(data, 'missing').matches.map(row => row.id)).toEqual(['core']);
});
