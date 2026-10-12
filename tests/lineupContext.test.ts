import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateAndNormalizeLineup } from '../lib/matchContext';
import { addCoreMembership } from '../lib/roster';
import { saveMatchSchema } from '../schemas';
import { filterAnalyticsHistory } from '../src/utils/historyFilter';
import { reconcileAppearanceMap, reconcileStatsForContext } from '../src/utils/lineupContext';

const coreId = '00000000-0000-4000-8000-000000000001';
const trialId = '00000000-0000-4000-8000-000000000002';
const standInId = '00000000-0000-4000-8000-000000000003';
const batchId = '00000000-0000-4000-8000-000000000004';
const otherBatchId = '00000000-0000-4000-8000-000000000005';

function rosterDb() {
  return {
    settings: { players: [] },
    rosterPlayers: [
      { id: coreId, displayName: 'Core Player' },
      { id: trialId, displayName: 'Trial Player' },
      { id: standInId, displayName: 'Stand In' },
    ],
    coreMemberships: [{ id: 'core-membership', playerId: coreId, joinedAt: '2026-01-01' }],
    tryoutBatches: [
      { id: batchId, name: 'Batch A', status: 'active', candidatePlayerIds: [trialId] },
      { id: otherBatchId, name: 'Batch B', status: 'active', candidatePlayerIds: [] },
    ],
  };
}

describe('lineup context contract', () => {
  it('keeps a confirmed tryout appearance historical after promotion', () => {
    const db = rosterDb();
    const match = { rosterContext: { kind: 'tryout', tryoutBatchId: batchId } };
    const [saved] = validateAndNormalizeLineup(db, match, [{ playerId: trialId, appearanceType: 'tryout' }]);
    addCoreMembership(db, trialId, batchId, () => 'new-membership', () => '2026-02-01');
    expect(saved).toMatchObject({
      playerId: trialId,
      player: 'Trial Player',
      displayNameSnapshot: 'Trial Player',
      appearanceType: 'tryout',
    });
  });

  it('allows a known stand-in without adding core membership', () => {
    const db = rosterDb();
    const match = { rosterContext: { kind: 'mixed' } };
    const [saved] = validateAndNormalizeLineup(db, match, [{ playerId: standInId, appearanceType: 'standIn' }]);
    expect(saved.appearanceType).toBe('standIn');
    expect(db.coreMemberships.some((membership: any) => membership.playerId === standInId)).toBe(false);
  });

  it('rejects a tryout appearance from a foreign batch or unknown identity', () => {
    const db = rosterDb();
    expect(() => validateAndNormalizeLineup(
      db,
      { rosterContext: { kind: 'tryout', tryoutBatchId: otherBatchId } },
      [{ playerId: trialId, appearanceType: 'tryout' }],
    )).toThrow('selected batch');
    expect(() => validateAndNormalizeLineup(
      db,
      { rosterContext: { kind: 'mixed' } },
      [{ playerId: '00000000-0000-4000-8000-000000000099', appearanceType: 'standIn' }],
    )).toThrow('unknown roster identity');
  });

  it('keeps legacy/import rows unclassified and requires a batch for typed tryout context', () => {
    const legacy = [{ player: 'Unknown historical name', kills: 9 }];
    expect(validateAndNormalizeLineup(rosterDb(), {}, legacy)).toEqual(legacy);
    expect(saveMatchSchema.safeParse({
      match: { rosterContext: { kind: 'tryout' } },
      statsUpdate: { operation: 'replace', stats: [] },
    }).success).toBe(false);
  });
});

describe('central analytics history filtering', () => {
  it('hides only explicitly linked archived trial history by default', () => {
    const data: any = {
      settings: {}, rosterPlayers: [], coreMemberships: [],
      tryoutBatches: [{ id: batchId, name: 'Archived', status: 'archived', candidatePlayerIds: [trialId] }],
      matches: [
        { id: 'trial-match', rosterContext: { kind: 'tryout', tryoutBatchId: batchId } },
        { id: 'mixed-match', rosterContext: { kind: 'mixed', tryoutBatchId: batchId } },
        { id: 'legacy-match' },
      ],
      playerStats: [
        { id: 'trial', matchId: 'trial-match', appearanceType: 'tryout' },
        { id: 'mixed-trial', matchId: 'mixed-match', appearanceType: 'tryout' },
        { id: 'mixed-core', matchId: 'mixed-match', appearanceType: 'core' },
        { id: 'mixed-standin', matchId: 'mixed-match', appearanceType: 'standIn' },
        { id: 'legacy', matchId: 'legacy-match' },
      ],
      rounds: [{ id: 'hidden-round', matchId: 'trial-match' }, { id: 'visible-round', matchId: 'mixed-match' }],
      vetos: [], goals: [], schedule: [], soloq: [], strats: [], stratRuns: [], secrets: {}, serverTime: '',
    };
    const filtered = filterAnalyticsHistory(data);
    expect(filtered.matches.map(match => match.id)).toEqual(['mixed-match', 'legacy-match']);
    expect(filtered.playerStats.map(stat => stat.id)).toEqual(['mixed-core', 'mixed-standin', 'legacy']);
    expect(filterAnalyticsHistory(data, 'standIn').playerStats.map(stat => stat.id)).toEqual(['mixed-standin']);
    expect(filterAnalyticsHistory(data, 'unclassified').playerStats.map(stat => stat.id)).toEqual(['legacy']);
    expect(filterAnalyticsHistory(data, 'all', true).matches).toHaveLength(3);
  });

  it('routes Solo Tracker through the same filtered analytics data', () => {
    const app = fs.readFileSync('src/App.tsx', 'utf8');
    expect(app).toMatch(/<PlayerSoloTracker data=\{analyticsData\}/);
  });
});

describe('entry context transitions', () => {
  it('preserves explicit mixed appearances on batch-only updates and resets only for strict contexts', () => {
    const current = { Alpha: 'core', Guest: 'standIn' } as const;
    expect(reconcileAppearanceMap(current, { kind: 'mixed', tryoutBatchId: batchId })).toBe(current);
    expect(reconcileAppearanceMap(current, { kind: 'core' })).toEqual({ Alpha: 'core', Guest: 'core' });
    expect(reconcileAppearanceMap(current, { kind: 'tryout', tryoutBatchId: batchId })).toEqual({ Alpha: 'tryout', Guest: 'tryout' });
  });

  it('clears hidden classification metadata when a coach returns a match to unclassified', () => {
    const stats: any[] = [{
      id: 'stat', matchId: 'match', player: 'Historical Name', kills: 12,
      playerId: trialId, displayNameSnapshot: 'Trial Player', appearanceType: 'tryout',
    }];
    expect(reconcileStatsForContext(stats, { kind: 'unclassified' })).toEqual([
      { id: 'stat', matchId: 'match', player: 'Historical Name', kills: 12 },
    ]);
  });

  it('visibly requires a coach to confirm mixed appearance types', () => {
    const form = fs.readFileSync('src/components/MatchLogRounds.tsx', 'utf8');
    expect(form).toContain('<option value="" disabled>Choose appearance…</option>');
    expect(form).toMatch(/value=\{st\.appearanceType \|\| ''\}\s+required/);
  });
});
