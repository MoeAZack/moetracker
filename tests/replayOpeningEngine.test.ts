import { describe, expect, it } from 'vitest';
import {
  buildReplayOpeningReviewDraft,
  type ReplayEliminationEvent,
  type ReplayParserDraftInput,
  type ReplayReviewReference,
} from '../lib/replayOpeningEngine';

const identities = [
  { playerId: 'a1', teamId: 'a', displayName: 'Alpha' },
  { playerId: 'a2', teamId: 'a', displayName: 'Able' },
  { playerId: 'b1', teamId: 'b', displayName: 'Bravo' },
  { playerId: 'b2', teamId: 'b', displayName: 'Baker' },
];
const summary = {
  map: 'Ascent', finalScore: { teamA: 1, teamB: 1 }, roundCount: 2,
  players: [
    { playerId: 'a1', kills: 2, deaths: 1 }, { playerId: 'a2', kills: 0, deaths: 1 },
    { playerId: 'b1', kills: 1, deaths: 1 }, { playerId: 'b2', kills: 1, deaths: 1 },
  ],
};
const reference: ReplayReviewReference = { identities, summary };

function event(overrides: Partial<ReplayEliminationEvent> = {}): ReplayEliminationEvent {
  return {
    eventId: 'e1', roundNumber: 1, sequence: 1, timestampMs: 100,
    kind: 'player-elimination', killerPlayerId: 'a1', victimPlayerId: 'b1',
    killerTeamId: 'a', victimTeamId: 'b', identityStatus: 'resolved', ...overrides,
  };
}

function input(rounds: ReplayParserDraftInput['rounds']): ReplayParserDraftInput {
  const roundCount = rounds.length;
  return {
    parser: { name: 'normalized-test-adapter', version: '0.1.0' },
    provenance: { fileSha256: 'sanitized-test-hash', importedAt: '2026-10-12T12:00:00.000Z' },
    file: { format: 'normalized-test', support: 'supported' }, identities,
    summary: { map: 'Ascent', finalScore: roundCount === 2 ? { teamA: 1, teamB: 1 } : { teamA: roundCount, teamB: 0 }, roundCount },
    rounds,
    capabilities: [{ signal: 'eliminations', support: 'complete', grade: 'event-log', coveredRoundNumbers: rounds.map(round => round.roundNumber) }],
  };
}

describe('replay opening-duel review engine', () => {
  it('builds a review-only draft and selects the first opponent elimination in each round', () => {
    const draft = buildReplayOpeningReviewDraft(input([
      { roundNumber: 1, sequenceCompleteFromStart: true, events: [
        event({ eventId: 'env', kind: 'environmental', sequence: 0, killerPlayerId: null, victimPlayerId: null }),
        event(), event({ eventId: 'later', sequence: 2, timestampMs: 200, killerPlayerId: 'b2', victimPlayerId: 'a2', killerTeamId: 'b', victimTeamId: 'a' }),
      ] },
      { roundNumber: 2, sequenceCompleteFromStart: true, events: [
        event({ eventId: 'r2', roundNumber: 2, killerPlayerId: 'b1', victimPlayerId: 'a1', killerTeamId: 'b', victimTeamId: 'a' }),
      ] },
    ]), reference);

    expect(draft).toMatchObject({
      contractVersion: 1, status: 'review-required', reviewRequired: true, writable: false,
      parser: { name: 'normalized-test-adapter', version: '0.1.0' },
      provenance: { fileSha256: 'sanitized-test-hash' },
      coverage: { playedRounds: 2, resolvedRounds: 2, unknownRounds: 0, resolvedPercent: 100 },
    });
    expect(draft.crossChecks.every(check => check.status !== 'mismatch')).toBe(true);
    expect(draft.rounds).toMatchObject([
      { roundNumber: 1, status: 'resolved', firstKillPlayerId: 'a1', firstDeathPlayerId: 'b1', excludedEventCount: 1 },
      { roundNumber: 2, status: 'resolved', firstKillPlayerId: 'b1', firstDeathPlayerId: 'a1' },
    ]);
    expect(draft.playerTotals.find(total => total.playerId === 'a2')).toMatchObject({ firstKills: 0, firstDeaths: 0 });
  });

  it('excludes duplicate, self, team, environmental, resurrection and repeated-death artifacts', () => {
    const draft = buildReplayOpeningReviewDraft(input([{
      roundNumber: 1, sequenceCompleteFromStart: true, events: [
        event({ eventId: 'environment', sequence: 0, kind: 'non-player' }),
        event({ eventId: 'self', sequence: 1, killerPlayerId: 'a1', victimPlayerId: 'a1', victimTeamId: 'a' }),
        event({ eventId: 'team', sequence: 2, killerPlayerId: 'a1', victimPlayerId: 'a2', victimTeamId: 'a' }),
        event({ eventId: 'repeat', sequence: 3, victimPlayerId: 'a2', killerPlayerId: 'b1', killerTeamId: 'b', victimTeamId: 'a' }),
        event({ eventId: 'res', sequence: 4, resurrectionArtifact: true }),
        event({ eventId: 'winner', sequence: 5, victimPlayerId: 'b2' }),
        event({ eventId: 'winner-copy', sequence: 6, duplicateOfEventId: 'winner', victimPlayerId: 'b2' }),
      ],
    }]));
    expect(draft.rounds[0]).toMatchObject({
      status: 'resolved', firstKillPlayerId: 'a1', firstDeathPlayerId: 'b2', excludedEventCount: 6,
    });
  });

  it.each([
    ['missing early events', { roundNumber: 1, sequenceCompleteFromStart: false, events: [event()] }, 'missing-early-sequence'],
    ['ambiguous identity', { roundNumber: 1, sequenceCompleteFromStart: true, events: [event({ identityStatus: 'ambiguous' })] }, 'identity-ambiguity'],
    ['no opponent elimination', { roundNumber: 1, sequenceCompleteFromStart: true, events: [event({ kind: 'environmental' })] }, 'no-qualifying-elimination'],
  ] as const)('keeps %s unknown with an explicit reason', (_label, round, reason) => {
    const draft = buildReplayOpeningReviewDraft(input([round]));
    expect(draft.rounds[0]).toMatchObject({ status: 'unknown', reason, firstKillPlayerId: null, firstDeathPlayerId: null });
    expect(draft.playerTotals.every(total => total.firstKills === null && total.firstDeaths === null)).toBe(true);
  });

  it('keeps equal timestamps unknown unless a unique sequence resolves them', () => {
    const tied = [event({ eventId: 'one', sequence: null }), event({ eventId: 'two', sequence: null, killerPlayerId: 'b1', victimPlayerId: 'a1', killerTeamId: 'b', victimTeamId: 'a' })];
    expect(buildReplayOpeningReviewDraft(input([{ roundNumber: 1, sequenceCompleteFromStart: true, events: tied }])).rounds[0].reason).toBe('unresolved-order');
    const sequenced = tied.map((item, index) => ({ ...item, sequence: index + 1 }));
    expect(buildReplayOpeningReviewDraft(input([{ roundNumber: 1, sequenceCompleteFromStart: true, events: sequenced }])).rounds[0]).toMatchObject({ status: 'resolved', firstKillPlayerId: 'a1' });
  });

  it.each(['unsupported', 'incomplete'] as const)('rejects %s files into wholly unknown evidence', support => {
    const replay = input([{ roundNumber: 1, sequenceCompleteFromStart: true, events: [event()] }]);
    replay.file.support = support;
    const draft = buildReplayOpeningReviewDraft(replay, reference);
    expect(draft.rounds[0].reason).toBe(`${support}-file`);
    expect(draft.coverage).toMatchObject({ resolvedRounds: 0, unknownRounds: 1 });
  });

  it('fails closed on supplied map, score, round, K/D or stable identity mismatches', () => {
    const mismatched: ReplayReviewReference = {
      identities: reference.identities?.map(identity => identity.playerId === 'a1' ? { ...identity, teamId: 'b' } : identity),
      summary: { ...summary, map: 'Bind', finalScore: { teamA: 13, teamB: 0 }, roundCount: 13, players: [{ playerId: 'a1', kills: 99, deaths: 0 }] },
    };
    const replay = input([{ roundNumber: 1, sequenceCompleteFromStart: true, events: [event()] }]);
    replay.summary = { ...replay.summary, players: [{ playerId: 'a1', kills: 1, deaths: 0 }] };
    const draft = buildReplayOpeningReviewDraft(replay, mismatched);
    expect(draft.crossChecks.filter(check => check.status === 'mismatch').map(check => check.field)).toEqual([
      'identities', 'map', 'rounds', 'final-score', 'kills-deaths',
    ]);
    expect(draft.rounds[0].reason).toBe('invalid-round-structure');
  });

  it('reports partial coverage while withholding totals instead of inventing zeroes', () => {
    const draft = buildReplayOpeningReviewDraft(input([
      { roundNumber: 1, sequenceCompleteFromStart: true, events: [event()] },
      { roundNumber: 2, sequenceCompleteFromStart: false, events: [] },
    ]));
    expect(draft.coverage).toEqual({
      playedRounds: 2, resolvedRounds: 1, unknownRounds: 1, resolvedPercent: 50,
      unknownReasons: { 'missing-early-sequence': 1 },
    });
    expect(draft.playerTotals.find(total => total.playerId === 'a1')).toMatchObject({ observedFirstKills: 1, firstKills: null, firstDeaths: null });
  });

  it('uses null coverage for an empty draft and never fabricates played rounds', () => {
    const draft = buildReplayOpeningReviewDraft(input([]), reference);
    expect(draft.coverage).toEqual({ playedRounds: 0, resolvedRounds: 0, unknownRounds: 0, resolvedPercent: null, unknownReasons: {} });
    expect(draft.playerTotals.every(total => total.firstKills === null && total.firstDeaths === null)).toBe(true);
  });

  it('derives trades, a clutch and multikills only from complete event-log evidence', () => {
    const replay = input([{
      roundNumber: 1,
      sequenceCompleteFromStart: true,
      participantPlayerIds: ['a1', 'a2', 'b1', 'b2'],
      winnerTeamId: 'a', endReason: 'elimination', sideByTeam: { a: 'attack', b: 'defense' },
      events: [
        event({ eventId: 'death', sequence: 1, timestampMs: 1_000, killerPlayerId: 'b1', victimPlayerId: 'a2', killerTeamId: 'b', victimTeamId: 'a' }),
        event({ eventId: 'trade', sequence: 2, timestampMs: 3_000, killerPlayerId: 'a1', victimPlayerId: 'b1', killerTeamId: 'a', victimTeamId: 'b' }),
        event({ eventId: 'clutch-end', sequence: 3, timestampMs: 5_000, killerPlayerId: 'a1', victimPlayerId: 'b2', killerTeamId: 'a', victimTeamId: 'b' }),
      ],
    }]);
    replay.derivation = { tradeWindowMs: 2_500 };
    replay.capabilities = [
      { signal: 'eliminations', support: 'complete', grade: 'event-log' },
      { signal: 'round-winner', support: 'complete', grade: 'event-log' },
      { signal: 'round-end-reason', support: 'complete', grade: 'event-log' },
      { signal: 'side', support: 'complete', grade: 'event-log' },
    ];
    const derived = buildReplayOpeningReviewDraft(replay).evidence;
    expect(derived.tradeWindowMs).toBe(2_500);
    expect(derived.rounds[0]).toMatchObject({
      winnerTeamId: 'a', endReason: 'elimination', sideByTeam: { a: 'attack', b: 'defense' },
      derived: {
        tradeOpportunities: 2, successfulTrades: 1, tradedDeathPlayerIds: ['a2'],
        multikills: [{ playerId: 'a1', kills: 2 }],
        clutches: expect.arrayContaining([{ playerId: 'a1', opponents: 2, result: 'won' }]),
      },
    });
    expect(derived.playerMetrics.find(metric => metric.playerId === 'a1')).toMatchObject({ kills: 2, deaths: 0 });
    expect(derived.playerMetrics.find(metric => metric.playerId === 'a2')).toMatchObject({ kills: 0, deaths: 1 });
  });

  it('aggregates explicit assists, objectives, utility and damage only with complete event-log capability', () => {
    const replay = input([{ roundNumber: 1, sequenceCompleteFromStart: true, participantPlayerIds: identities.map(identity => identity.playerId), events: [event()] }]);
    replay.capabilities = [
      { signal: 'assists', support: 'complete', grade: 'event-log' },
      { signal: 'damage', support: 'complete', grade: 'event-log' },
      { signal: 'utility-cast', support: 'complete', grade: 'event-log' },
      { signal: 'ultimate-use', support: 'complete', grade: 'event-log' },
      { signal: 'plant', support: 'complete', grade: 'event-log' },
      { signal: 'defuse', support: 'unsupported', grade: 'event-log' },
    ];
    replay.observations = [
      { observationId: 'assist', roundNumber: 1, signal: 'assists', grade: 'event-log', explicitlyPresent: true, confidence: 1, playerId: 'a1' },
      { observationId: 'damage', roundNumber: 1, signal: 'damage', grade: 'event-log', explicitlyPresent: true, confidence: 1, playerId: 'a1', attributes: { amount: 80 } },
      { observationId: 'cast', roundNumber: 1, signal: 'utility-cast', grade: 'event-log', explicitlyPresent: true, confidence: 1, playerId: 'a1', attributes: { ability: 'smoke' } },
      { observationId: 'ult', roundNumber: 1, signal: 'ultimate-use', grade: 'event-log', explicitlyPresent: true, confidence: 1, playerId: 'a1' },
      { observationId: 'plant', roundNumber: 1, signal: 'plant', grade: 'event-log', explicitlyPresent: true, confidence: 1, playerId: 'a1', occurredAtMs: 42_000 },
    ];
    expect(buildReplayOpeningReviewDraft(replay).evidence.playerMetrics.find(metric => metric.playerId === 'a1')).toEqual({
      playerId: 'a1', kills: null, deaths: null, assists: 1, damage: 80, utilityCasts: 1, ultimateUses: 1, plants: 1, defuses: null,
    });
  });

  it('preserves tactical video/OCR/inference observations separately without promoting them to facts', () => {
    const replay = input([{ roundNumber: 1, sequenceCompleteFromStart: true, participantPlayerIds: identities.map(identity => identity.playerId), events: [] }]);
    replay.capabilities = [
      { signal: 'rotation', support: 'partial', grade: 'video-observation', coveredRoundNumbers: [1] },
      { signal: 'position-zone', support: 'partial', grade: 'inference' },
      { signal: 'economy', support: 'partial', grade: 'ocr' },
      { signal: 'damage', support: 'unsupported', grade: 'video-observation' },
    ];
    replay.observations = [
      { observationId: 'rotate', roundNumber: 1, signal: 'rotation', grade: 'video-observation', explicitlyPresent: true, confidence: 0.8, teamId: 'a', phase: 'mid', attributes: { from: 'A', to: 'B' } },
      { observationId: 'zone', roundNumber: 1, signal: 'position-zone', grade: 'inference', explicitlyPresent: false, confidence: 0.55, playerId: 'a1', attributes: { zone: 'market' } },
      { observationId: 'eco', roundNumber: 1, signal: 'economy', grade: 'ocr', explicitlyPresent: true, confidence: 0.9, teamId: 'a', attributes: { classification: 'eco' } },
    ];
    const evidence = buildReplayOpeningReviewDraft(replay).evidence;
    expect(evidence.observations).toEqual(replay.observations);
    expect(evidence.coverageBySignal).toContainEqual({ signal: 'damage', support: 'unsupported', grade: 'video-observation', coveredRounds: 0, playedRounds: 1 });
    expect(evidence.playerMetrics.find(metric => metric.playerId === 'a1')?.damage).toBeNull();
    expect(evidence.rounds[0].derived).toEqual({
      tradeOpportunities: null, successfulTrades: null, tradedDeathPlayerIds: null, multikills: null, clutches: null,
    });
  });

  it('keeps a partial capability at declared field/round coverage instead of treating it as complete', () => {
    const replay = input([
      { roundNumber: 1, sequenceCompleteFromStart: true, events: [] },
      { roundNumber: 2, sequenceCompleteFromStart: true, events: [] },
    ]);
    replay.capabilities = [{ signal: 'loadout', support: 'partial', grade: 'event-log', coveredRoundNumbers: [1] }];
    const evidence = buildReplayOpeningReviewDraft(replay).evidence;
    expect(evidence.coverageBySignal).toEqual([
      { signal: 'loadout', support: 'partial', grade: 'event-log', coveredRounds: 1, playedRounds: 2 },
    ]);
  });

  it('blocks every deterministic derived metric when file or cross-check validation fails', () => {
    const replay = input([{
      roundNumber: 1, sequenceCompleteFromStart: true,
      participantPlayerIds: identities.map(identity => identity.playerId), winnerTeamId: 'a',
      events: [event()],
    }]);
    replay.capabilities = [
      { signal: 'eliminations', support: 'complete', grade: 'event-log' },
      { signal: 'round-winner', support: 'complete', grade: 'event-log' },
    ];
    const mismatch = { identities, summary: { map: 'Bind', finalScore: { teamA: 1, teamB: 0 }, roundCount: 1 } };
    const draft = buildReplayOpeningReviewDraft(replay, mismatch);
    expect(draft.rounds[0].reason).toBe('cross-check-mismatch');
    expect(draft.evidence.rounds[0]).toMatchObject({
      winnerTeamId: null,
      derived: { tradeOpportunities: null, successfulTrades: null, multikills: null, clutches: null },
    });
    expect(draft.evidence.playerMetrics.every(metric => metric.kills === null && metric.deaths === null)).toBe(true);
  });

  it('requires complete event-log elimination capability for each specific opening-duel round', () => {
    const rounds = [
      { roundNumber: 1, sequenceCompleteFromStart: true, events: [event()] },
      { roundNumber: 2, sequenceCompleteFromStart: true, events: [event({ roundNumber: 2, eventId: 'r2' })] },
    ];
    const ocrOnly = input(rounds);
    ocrOnly.capabilities = [{ signal: 'eliminations', support: 'complete', grade: 'ocr' }];
    expect(buildReplayOpeningReviewDraft(ocrOnly).rounds.every(round => round.reason === 'missing-capability')).toBe(true);

    const firstRoundOnly = input(rounds);
    firstRoundOnly.capabilities = [{ signal: 'eliminations', support: 'complete', grade: 'event-log', coveredRoundNumbers: [1] }];
    expect(buildReplayOpeningReviewDraft(firstRoundOnly).rounds.map(round => [round.status, round.reason])).toEqual([
      ['resolved', null], ['unknown', 'missing-capability'],
    ]);
  });

  it('fails closed on conflicting capabilities and keeps grade-specific coverage isolated', () => {
    const conflicting = input([{ roundNumber: 1, sequenceCompleteFromStart: true, events: [event()] }]);
    conflicting.capabilities = [
      { signal: 'eliminations', support: 'complete', grade: 'event-log' },
      { signal: 'eliminations', support: 'unsupported', grade: 'event-log' },
    ];
    const rejected = buildReplayOpeningReviewDraft(conflicting);
    expect(rejected.crossChecks).toContainEqual(expect.objectContaining({ field: 'capabilities', status: 'mismatch' }));
    expect(rejected.rounds[0].reason).toBe('cross-check-mismatch');

    const graded = input([{ roundNumber: 1, sequenceCompleteFromStart: true, participantPlayerIds: identities.map(item => item.playerId), events: [] }]);
    graded.capabilities = [
      { signal: 'rotation', support: 'partial', grade: 'event-log', coveredRoundNumbers: [] },
      { signal: 'rotation', support: 'partial', grade: 'video-observation', coveredRoundNumbers: [1] },
    ];
    graded.observations = [{ observationId: 'video', roundNumber: 1, signal: 'rotation', grade: 'video-observation', explicitlyPresent: true, confidence: 0.8, teamId: 'a' }];
    expect(buildReplayOpeningReviewDraft(graded).evidence.coverageBySignal).toEqual([
      { signal: 'rotation', support: 'partial', grade: 'event-log', coveredRounds: 0, playedRounds: 1 },
      { signal: 'rotation', support: 'partial', grade: 'video-observation', coveredRounds: 1, playedRounds: 1 },
    ]);
  });

  it.each([
    [[1, 1], 'duplicate'],
    [[1, 3], 'missing'],
  ] as const)('rejects %s round identifiers instead of trusting matching declared totals', (roundIds, _label) => {
    const replay = input(roundIds.map((roundNumber, index) => ({
      roundNumber, sequenceCompleteFromStart: true,
      events: [event({ eventId: `event-${index}`, roundNumber })],
    })));
    const draft = buildReplayOpeningReviewDraft(replay);
    expect(draft.crossChecks).toContainEqual(expect.objectContaining({ field: 'rounds', status: 'mismatch' }));
    expect(draft.rounds.every(round => round.reason === 'invalid-round-structure')).toBe(true);
  });

  it('checks matching supplied K/D summaries against complete event-derived K/D', () => {
    const replay = input([{
      roundNumber: 1, sequenceCompleteFromStart: true,
      participantPlayerIds: identities.map(item => item.playerId), events: [event()],
    }]);
    replay.summary = { ...replay.summary, players: [{ playerId: 'a1', kills: 0, deaths: 0 }] };
    const matchingButWrong = { identities, summary: { ...replay.summary } };
    const draft = buildReplayOpeningReviewDraft(replay, matchingButWrong);
    expect(draft.crossChecks).toContainEqual(expect.objectContaining({ field: 'kills-deaths', status: 'mismatch' }));
    expect(draft.evidence.playerMetrics.every(metric => metric.kills === null && metric.deaths === null)).toBe(true);
  });

  it('rejects foreign-round events and produces permutation-invariant results for ordered evidence', () => {
    const foreign = input([{ roundNumber: 1, sequenceCompleteFromStart: true, events: [event({ roundNumber: 2 })] }]);
    expect(buildReplayOpeningReviewDraft(foreign).rounds[0].reason).toBe('invalid-round-structure');

    const orderedEvents = [
      event({ eventId: 'second', sequence: 2, timestampMs: 200, killerPlayerId: 'b1', victimPlayerId: 'a1', killerTeamId: 'b', victimTeamId: 'a' }),
      event({ eventId: 'first', sequence: 1, timestampMs: 100 }),
    ];
    const first = buildReplayOpeningReviewDraft(input([{ roundNumber: 1, sequenceCompleteFromStart: true, events: orderedEvents }]));
    const second = buildReplayOpeningReviewDraft(input([{ roundNumber: 1, sequenceCompleteFromStart: true, events: [...orderedEvents].reverse() }]));
    expect(second.rounds).toEqual(first.rounds);
    expect(second.evidence.rounds[0].events).toEqual(first.evidence.rounds[0].events);
  });

  it('withholds life-state derivations when participants or discarded death transitions are incomplete', () => {
    const missingActor = input([{
      roundNumber: 1, sequenceCompleteFromStart: true, participantPlayerIds: ['a1', 'a2', 'b2'], events: [event()],
    }]);
    const missing = buildReplayOpeningReviewDraft(missingActor).evidence.rounds[0].derived;
    expect(missing).toEqual({ tradeOpportunities: null, successfulTrades: null, tradedDeathPlayerIds: null, multikills: null, clutches: null });

    const environmental = input([{
      roundNumber: 1, sequenceCompleteFromStart: true, participantPlayerIds: identities.map(item => item.playerId),
      events: [event({ eventId: 'hazard', kind: 'environmental', killerPlayerId: null, victimPlayerId: 'a2' }), event({ eventId: 'kill', sequence: 2 })],
    }]);
    expect(buildReplayOpeningReviewDraft(environmental).evidence.rounds[0].derived.tradeOpportunities).toBeNull();
  });

  it('retains every clutch attempt including 1v1 and names trade opportunities precisely', () => {
    const replay = input([{
      roundNumber: 1, sequenceCompleteFromStart: true,
      participantPlayerIds: identities.map(item => item.playerId), winnerTeamId: 'a',
      events: [
        event({ eventId: 'one', sequence: 1, timestampMs: 1_000, killerPlayerId: 'b1', victimPlayerId: 'a2', killerTeamId: 'b', victimTeamId: 'a' }),
        event({ eventId: 'two', sequence: 2, timestampMs: 2_000, killerPlayerId: 'a1', victimPlayerId: 'b1', killerTeamId: 'a', victimTeamId: 'b' }),
        event({ eventId: 'three', sequence: 3, timestampMs: 3_000, killerPlayerId: 'a1', victimPlayerId: 'b2', killerTeamId: 'a', victimTeamId: 'b' }),
      ],
    }]);
    replay.capabilities = [
      { signal: 'eliminations', support: 'complete', grade: 'event-log' },
      { signal: 'round-winner', support: 'complete', grade: 'event-log' },
    ];
    const derived = buildReplayOpeningReviewDraft(replay).evidence.rounds[0].derived;
    expect(derived.tradeOpportunities).toBe(2);
    expect(derived).not.toHaveProperty('tradeAttempts');
    expect(derived.clutches).toEqual([
      { playerId: 'a1', opponents: 2, result: 'won' },
      { playerId: 'b2', opponents: 1, result: 'lost' },
    ]);
  });

  it('deduplicates and validates observation identity, round, player, target and team before aggregation', () => {
    const replay = input([{
      roundNumber: 1, sequenceCompleteFromStart: true, participantPlayerIds: identities.map(item => item.playerId), events: [],
    }]);
    replay.capabilities = [{ signal: 'assists', support: 'complete', grade: 'event-log' }];
    replay.observations = [
      { observationId: 'valid', roundNumber: 1, signal: 'assists', grade: 'event-log', explicitlyPresent: true, confidence: 1, playerId: 'a1', targetPlayerId: 'b1', teamId: 'a' },
      { observationId: 'dupe', roundNumber: 1, signal: 'assists', grade: 'event-log', explicitlyPresent: true, confidence: 1, playerId: 'a1' },
      { observationId: 'dupe', roundNumber: 1, signal: 'assists', grade: 'event-log', explicitlyPresent: true, confidence: 1, playerId: 'a1' },
      { observationId: 'bad-round', roundNumber: 2, signal: 'assists', grade: 'event-log', explicitlyPresent: true, confidence: 1, playerId: 'a1' },
      { observationId: 'bad-player', roundNumber: 1, signal: 'assists', grade: 'event-log', explicitlyPresent: true, confidence: 1, playerId: 'foreign' },
      { observationId: 'bad-target', roundNumber: 1, signal: 'assists', grade: 'event-log', explicitlyPresent: true, confidence: 1, playerId: 'a1', targetPlayerId: 'foreign' },
      { observationId: 'bad-team', roundNumber: 1, signal: 'assists', grade: 'event-log', explicitlyPresent: true, confidence: 1, playerId: 'a1', teamId: 'b' },
    ];
    const evidence = buildReplayOpeningReviewDraft(replay).evidence;
    expect(evidence.observations.map(item => item.observationId)).toEqual(['valid']);
    expect(evidence.observationIssues).toHaveLength(5);
    expect(evidence.playerMetrics.find(metric => metric.playerId === 'a1')?.assists).toBe(1);
  });
});
