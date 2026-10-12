import { describe, expect, it } from 'vitest';
import {
  buildCoachAnalytics,
  compareCoachAnalyticsPeriods,
  isInCairoDateWindow,
  toCairoDateKey,
  type CoachAnalyticsData,
} from '../lib/coachAnalytics';
import type { Match, PlayerStats, Round, TryoutBatch } from '../src/types';

const manualSource = { method: 'manual' as const, capturedAt: '2026-05-02T12:00:00+03:00' };

function match(id: string, date: string, overrides: Partial<Match> = {}): Match {
  return {
    id, date, type: 'Scrim', opponent: 'Opponent', map: 'Ascent',
    attW: null, attL: null, defW: null, defL: null,
    rosterContext: { kind: 'core' },
    ...overrides,
  };
}

function stat(id: string, matchId: string, overrides: Partial<PlayerStats> = {}): PlayerStats {
  return {
    id, matchId, player: 'Alpha', agent: 'Jett',
    kAtt: null, kDef: null, dAtt: null, dDef: null, aAtt: null, aDef: null,
    kills: null, deaths: null, assists: null,
    ...overrides,
  };
}

function data(
  matches: Match[],
  playerStats: PlayerStats[] = [],
  rounds: Round[] = [],
  tryoutBatches: TryoutBatch[] = [],
): CoachAnalyticsData {
  return { matches, playerStats, rounds, tryoutBatches };
}

const mayWindow = { start: '2026-05-01', end: '2026-05-31' };

describe('coach analytics date windows', () => {
  it('uses Africa/Cairo calendar membership across both DST transitions', () => {
    expect(toCairoDateKey('2026-04-23T21:30:00Z')).toBe('2026-04-23');
    expect(toCairoDateKey('2026-04-23T22:30:00Z')).toBe('2026-04-24');
    expect(toCairoDateKey('2026-10-29T20:30:00Z')).toBe('2026-10-29');
    expect(toCairoDateKey('2026-10-29T22:30:00Z')).toBe('2026-10-30');
    expect(isInCairoDateWindow('2026-07-31T21:30:00Z', { start: '2026-08-01', end: '2026-08-01' })).toBe(true);
    expect(isInCairoDateWindow('2026-01-31T21:30:00Z', { start: '2026-02-01', end: '2026-02-01' })).toBe(false);
    expect(toCairoDateKey('2026-05-01T12:00:00')).toBeNull();
    expect(toCairoDateKey('2026-02-30T12:00:00Z')).toBeNull();
    expect(toCairoDateKey('2026-04-31T12:00:00+03:00')).toBeNull();
    expect(() => isInCairoDateWindow('2026-05-01', { start: '2026-05-02', end: '2026-05-01' })).toThrow(RangeError);
  });
});

describe('coach analytics aggregation', () => {
  it('groups by stable identity, appearance, agent, map and historical context without inventing unknown values', () => {
    const analytics = buildCoachAnalytics(data([
      match('m1', '2026-05-01', { sourceMetadata: manualSource }),
      match('m2', '2026-05-02', { sourceMetadata: manualSource }),
      match('legacy', '2026-05-03', { rosterContext: { kind: 'unclassified' } }),
    ], [
      stat('s1', 'm1', {
        playerId: 'player-1', displayNameSnapshot: 'Alpha old', appearanceType: 'core',
        kills: 10, deaths: 0, acs: 0, fk: 0, fd: null, sourceMetadata: manualSource,
      }),
      stat('s2', 'm2', {
        playerId: 'player-1', displayNameSnapshot: 'Alpha current', appearanceType: 'core',
        kills: null, deaths: 5, acs: null, fk: null, fd: null, sourceMetadata: manualSource,
      }),
      stat('legacy-a', 'legacy', { player: 'Same legacy name', kills: 2, deaths: 1 }),
      stat('legacy-b', 'legacy', { player: 'Same legacy name', kills: 4, deaths: 2 }),
    ]), { window: mayWindow, minimumMatchSample: 3 });

    const known = analytics.playerAgentMaps.find(row => row.playerId === 'player-1')!;
    expect(known).toMatchObject({
      displayName: 'Alpha current', appearance: 'core', agent: 'Jett', map: 'Ascent',
      context: { rosterKind: 'core', tryoutBatchId: null }, matchCount: 2, statRowCount: 2,
      metrics: {
        kd: { value: null, numerator: 10, denominator: 0, samples: 1 },
        acs: { value: 0, samples: 1 },
        firstKills: { total: 0, samples: 1 },
        firstDeaths: { total: null, samples: 0 },
      },
    });
    expect(known.warnings).toEqual([
      'partial-acs-coverage', 'partial-kd-coverage', 'partial-opening-coverage', 'small-match-sample',
    ]);
    expect(analytics.playerAgentMaps.filter(row => row.playerId.startsWith('unclassified-row:'))).toHaveLength(2);
    expect(analytics.playerAgentMaps.map(row => row.key)).toEqual(
      [...analytics.playerAgentMaps.map(row => row.key)].sort((left, right) => left.localeCompare(right, 'en')),
    );
  });

  it('uses explicit final scores, never turns missing splits into draws, and exposes map weaknesses against like context', () => {
    const analytics = buildCoachAnalytics(data([
      match('ascent-known', '2026-05-01', {
        map: 'Ascent', ourScore: 13, theirScore: 9, attW: 0, attL: 0, defW: 0, defL: 0,
      }),
      match('ascent-unknown', '2026-05-02', { map: 'Ascent' }),
      match('bind-loss', '2026-05-03', { map: 'Bind', ourScore: 8, theirScore: 13 }),
    ]), { window: mayWindow });

    const ascent = analytics.teamMaps.find(row => row.map === 'Ascent')!;
    const bind = analytics.teamMaps.find(row => row.map === 'Bind')!;
    expect(ascent).toMatchObject({
      matchCount: 2, resultCoverage: { covered: 1, total: 2 }, wins: 1, losses: 0, draws: 0,
      winRate: 1, averageRoundDifferential: 4,
      comparisonToContext: { winRateDelta: 0.5, roundDifferentialDelta: 4.5 },
    });
    expect(bind).toMatchObject({
      matchCount: 1, resultCoverage: { covered: 1, total: 1 }, wins: 0, losses: 1, draws: 0,
      winRate: 0, averageRoundDifferential: -5,
      comparisonToContext: { winRateDelta: -0.5, roundDifferentialDelta: -4.5 },
    });
  });

  it('derives K/D only from a complete side split and excludes partial splits', () => {
    const analytics = buildCoachAnalytics(data([
      match('complete', '2026-05-01'),
      match('partial', '2026-05-02'),
    ], [
      stat('complete', 'complete', {
        playerId: 'player-1', appearanceType: 'core', kAtt: 4, kDef: 6, dAtt: 2, dDef: 3,
      }),
      stat('partial', 'partial', {
        playerId: 'player-1', appearanceType: 'core', kAtt: 4, kDef: null, dAtt: 2, dDef: 3,
      }),
    ]), { window: mayWindow });
    expect(analytics.playerAgentMaps[0].metrics.kd).toEqual({
      value: 2, numerator: 10, denominator: 5, samples: 1,
    });
    expect(analytics.playerAgentMaps[0].warnings).toContain('partial-kd-coverage');
  });

  it('requires provenance for opening totals and reports match and round coverage separately', () => {
    const explicitMatch = match('explicit', '2026-05-01', { sourceMetadata: manualSource });
    const legacyMatch = match('legacy', '2026-05-02');
    const rounds: Round[] = [
      { id: 'r1', matchId: 'explicit', roundNo: 1, side: 'Attack', result: 'W', firstKillBy: 'Alpha', firstDeathBy: 'Enemy' },
      { id: 'r2', matchId: 'explicit', roundNo: 2, side: 'Attack', result: 'L' },
      { id: 'r3', matchId: 'legacy', roundNo: 1, side: 'Attack', result: 'W', firstKillBy: 'Alpha', firstDeathBy: 'Enemy' },
    ];
    const analytics = buildCoachAnalytics(data([explicitMatch, legacyMatch], [
      stat('explicit-stat', 'explicit', {
        playerId: 'player-1', appearanceType: 'core', kills: 4, deaths: 2, fk: 0, fd: 1,
        sourceMetadata: manualSource,
      }),
      stat('legacy-stat', 'legacy', {
        playerId: 'player-1', appearanceType: 'core', kills: 4, deaths: 2, fk: 9, fd: 0,
      }),
    ], rounds), { window: mayWindow });

    const row = analytics.playerAgentMaps[0];
    expect(row.metrics).toMatchObject({
      firstKills: { total: 0, samples: 1 },
      firstDeaths: { total: 1, samples: 1 },
      openingDifferential: { total: -1, samples: 1 },
      matchCoverage: { covered: 1, total: 2 },
      roundCoverage: { covered: 1, total: 3 },
    });
  });

  it('does not let match provenance authenticate legacy opening totals', () => {
    const analytics = buildCoachAnalytics(data([
      match('documented-match', '2026-05-01', { sourceMetadata: manualSource }),
    ], [
      stat('legacy-stat', 'documented-match', {
        playerId: 'player-1', appearanceType: 'core', fk: 7, fd: 2,
      }),
    ]), { window: mayWindow });

    expect(analytics.playerAgentMaps[0].metrics).toMatchObject({
      firstKills: { total: null, samples: 0 },
      firstDeaths: { total: null, samples: 0 },
      openingDifferential: { total: null, samples: 0 },
      matchCoverage: { covered: 0, total: 1 },
    });
  });
});

describe('coach analytics roster filtering and comparisons', () => {
  const archivedBatch: TryoutBatch = {
    id: 'batch-old', name: 'Old trials', status: 'archived', candidatePlayerIds: ['trial'], createdAt: '2026-04-01',
  };
  const rosterData = data([
    match('trial-only', '2026-05-01', { rosterContext: { kind: 'tryout', tryoutBatchId: 'batch-old' } }),
    match('mixed', '2026-05-02', { rosterContext: { kind: 'mixed', tryoutBatchId: 'batch-old' } }),
    match('core-only', '2026-05-03'),
  ], [
    stat('trial-a', 'trial-only', { playerId: 'trial', appearanceType: 'tryout' }),
    stat('trial-b', 'mixed', { playerId: 'trial', appearanceType: 'tryout' }),
    stat('core-mixed', 'mixed', { playerId: 'core', appearanceType: 'core' }),
    stat('stand-in', 'mixed', { playerId: 'guest', appearanceType: 'standIn' }),
    stat('core-only', 'core-only', { playerId: 'core', appearanceType: 'core' }),
  ], [], [archivedBatch]);

  it('hides archived trial rows, preserves mixed core/stand-in context, and narrows match denominators', () => {
    const all = buildCoachAnalytics(rosterData, { window: mayWindow });
    expect(all.coverage).toMatchObject({ matches: 2, matchesWithSelectedStats: 2, selectedStatRows: 3 });
    expect(all.playerAgentMaps.map(row => row.appearance).sort()).toEqual(['core', 'core', 'standIn']);
    expect(all.teamMaps.map(row => row.context.rosterKind)).toEqual(['core', 'mixed']);

    const standIns = buildCoachAnalytics(rosterData, { window: mayWindow, appearance: 'standIn' });
    expect(standIns.coverage).toMatchObject({ matches: 1, matchesWithSelectedStats: 1, selectedStatRows: 1 });
    expect(standIns.teamMaps).toHaveLength(1);
    expect(standIns.teamMaps[0].context).toEqual({ rosterKind: 'mixed', tryoutBatchId: 'batch-old' });

    const hiddenTryouts = buildCoachAnalytics(rosterData, { window: mayWindow, appearance: 'tryout' });
    expect(hiddenTryouts.coverage).toMatchObject({ matches: 0, selectedStatRows: 0 });
    const restoredTryouts = buildCoachAnalytics(rosterData, {
      window: mayWindow, appearance: 'tryout', includeArchivedTryouts: true,
    });
    expect(restoredTryouts.coverage).toMatchObject({ matches: 2, selectedStatRows: 2 });
  });

  it('compares only identical player-agent-map-appearance-context keys and leaves sparse deltas null', () => {
    const comparisonData = data([
      match('base-jett', '2026-04-05'),
      match('current-jett', '2026-05-05'),
      match('current-sova', '2026-05-06'),
    ], [
      stat('base-jett', 'base-jett', { playerId: 'p1', appearanceType: 'core', agent: 'Jett', kills: 10, deaths: 5, acs: 200 }),
      stat('current-jett', 'current-jett', { playerId: 'p1', appearanceType: 'core', agent: 'Jett', kills: 15, deaths: 5, acs: 250 }),
      stat('current-sova', 'current-sova', { playerId: 'p1', appearanceType: 'core', agent: 'Sova', kills: 20, deaths: 10, acs: 300 }),
    ]);
    const comparison = compareCoachAnalyticsPeriods(
      comparisonData,
      { window: mayWindow, minimumMatchSample: 2 },
      { window: { start: '2026-04-01', end: '2026-04-30' }, minimumMatchSample: 2 },
    );
    expect(comparison.filterIdentity).toEqual({
      appearance: 'all', includeArchivedTryouts: false, playerIds: null, agents: null, maps: null,
    });
    const jett = comparison.playerAgentMaps.find(row => row.key.includes('"Jett"'))!;
    const sova = comparison.playerAgentMaps.find(row => row.key.includes('"Sova"'))!;
    expect(jett.kd).toEqual({ current: 3, baseline: 2, delta: 1, currentSamples: 1, baselineSamples: 1 });
    expect(jett.acs).toEqual({ current: 250, baseline: 200, delta: 50, currentSamples: 1, baselineSamples: 1 });
    expect(jett.warnings).toEqual(['small-baseline-sample', 'small-current-sample']);
    expect(sova.kd).toEqual({ current: 2, baseline: null, delta: null, currentSamples: 1, baselineSamples: 0 });
    expect(sova.warnings).toEqual(['missing-baseline', 'small-current-sample']);
  });

  it.each([
    [{ appearance: 'core' as const }, { appearance: 'standIn' as const }],
    [{ playerIds: ['core'] }, { playerIds: ['guest'] }],
    [{ agents: ['Jett'] }, { agents: ['Sova'] }],
  ])('rejects comparisons across independently filtered populations', (currentFilters, baselineFilters) => {
    expect(() => compareCoachAnalyticsPeriods(
      rosterData,
      { window: mayWindow, ...currentFilters },
      { window: { start: '2026-04-01', end: '2026-04-30' }, ...baselineFilters },
    )).toThrow(/identical appearance, player, agent, map, and archive filters/);
  });
});
