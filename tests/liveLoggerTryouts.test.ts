import { describe, expect, it } from 'vitest';
import { getLiveLoggerDefaults, preserveMixedTryoutPhase } from '../src/components/LiveLogger';

describe('live logger tryout defaults', () => {
  it('starts an active tryout phase with its available candidates instead of the core roster', () => {
    const data: any = {
      settings: { tryoutsMode: true, activeTryoutBatchId: 'phase-2', players: ['Core One'] },
      rosterPlayers: [
        { id: 'core-1', displayName: 'Core One' },
        { id: 'candidate-1', displayName: 'Candidate One' },
        { id: 'candidate-2', displayName: 'Retired Candidate', retiredAt: '2026-10-01' },
      ],
      tryoutBatches: [
        { id: 'phase-1', status: 'archived', candidatePlayerIds: ['core-1'] },
        { id: 'phase-2', status: 'active', candidatePlayerIds: ['candidate-1', 'candidate-2'] },
      ],
    };

    expect(getLiveLoggerDefaults(data)).toMatchObject({
      activeRoster: ['Candidate One'],
      rosterContext: { kind: 'tryout', tryoutBatchId: 'phase-2' },
      appearanceByPlayer: { 'Core One': 'core', 'Candidate One': 'tryout', 'Retired Candidate': 'tryout' },
    });
  });

  it('uses the core roster outside tryout mode and preserves a phase when changing to mixed', () => {
    const data: any = {
      settings: { tryoutsMode: false, activeTryoutBatchId: null, players: ['Core One'] },
      rosterPlayers: [{ id: 'core-1', displayName: 'Core One' }],
      tryoutBatches: [],
    };

    expect(getLiveLoggerDefaults(data)).toMatchObject({ activeRoster: ['Core One'], rosterContext: { kind: 'core' } });
    expect(preserveMixedTryoutPhase(
      { kind: 'mixed' },
      { kind: 'tryout', tryoutBatchId: 'phase-2' },
    )).toEqual({ kind: 'mixed', tryoutBatchId: 'phase-2' });
    expect(preserveMixedTryoutPhase(
      { kind: 'mixed', tryoutBatchId: 'explicit-phase' },
      { kind: 'tryout', tryoutBatchId: 'phase-2' },
    )).toEqual({ kind: 'mixed', tryoutBatchId: 'explicit-phase' });
  });
});
