import fs from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import RosterManager from '../src/components/RosterManager';
import TryoutModePanel from '../src/components/TryoutModePanel';

const settingsSource = fs.readFileSync('src/components/SettingsControl.tsx', 'utf8');

describe('repeatable tryouts mode UI', () => {
  it('starts a named phase, archives on mode off, and refreshes the full database', () => {
    expect(settingsSource).toContain("'/api/roster/tryouts/mode'");
    expect(settingsSource).toContain('New tryout phase name');
    expect(settingsSource).toContain('Start fresh phase');
    expect(settingsSource).toContain('Turn off and archive phase');
    expect(settingsSource).toContain('Candidate history is preserved; nothing is deleted and core membership stays unchanged.');
    expect(settingsSource).toContain('await onRefresh()');
  });

  it('renders the active phase candidate alias mapping and promotion controls', () => {
    const html = renderToStaticMarkup(<TryoutModePanel
      enabled activeBatchId="batch-active" busy={false} corePlayerIds={new Set()}
      mutate={vi.fn(async () => true)}
      players={[{ id: 'candidate-1', displayName: 'Ahmed', createdAt: '2026-10-13T00:00:00Z' }]}
      batches={[{ id: 'batch-active', name: 'October trials', status: 'active', candidatePlayerIds: ['candidate-1'], aliases: [{ playerId: 'candidate-1', alias: 'A7' }], createdAt: '2026-10-13T00:00:00Z' }] as any}
    />);
    expect(html).toContain('October trials');
    expect(html).toContain('Active phase · 1 candidates');
    expect(html).toContain('aria-label="Add tryout alias for Ahmed"');
    expect(html).toContain('placeholder="Add another in-game alias"');
    expect(html).toContain('Add alias');
    expect(html).toContain('A7');
    expect(html).toContain('aria-label="Remove alias A7 from Ahmed"');
    expect(html).toContain('Promote to core');
    expect(html).toContain('Historical phases (0)');
  });

  it('hides archived-only candidates from the normal roster while preserving core players', () => {
    const data = {
      settings: { theme: 'slate', tryoutsMode: false, activeTryoutBatchId: null },
      rosterPlayers: [
        { id: 'archived-only', displayName: 'Archived Candidate', createdAt: '2026-10-01T00:00:00Z' },
        { id: 'core', displayName: 'Core Player', createdAt: '2026-10-01T00:00:00Z' },
      ],
      coreMemberships: [{ id: 'membership', playerId: 'core', joinedAt: '2026-10-01T00:00:00Z' }],
      tryoutBatches: [{ id: 'old', name: 'Old phase', status: 'archived', candidatePlayerIds: ['archived-only', 'core'], aliases: [], createdAt: '2026-10-01T00:00:00Z' }],
      seasonArchives: [],
    } as any;
    const html = renderToStaticMarkup(<RosterManager data={data} theme={{ border: '', cardBg: '' }} onRefresh={async () => {}} />);
    expect(html).not.toContain('Archived Candidate');
    expect(html).toContain('Core Player');
    expect(html).toContain('Old phase');
    expect(html).toContain('Archived safely');
  });
});
