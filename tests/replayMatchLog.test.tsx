import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ReplayMatchLog, { replayBackedMatches } from '../src/components/ReplayMatchLog';

const data: any = {
  settings: {},
  matches: [{ id: 'm1', date: '2026-10-13', type: 'Practice', opponent: 'Apex', map: 'Haven', ourScore: 9, theirScore: 13, sourceMetadata: { method: 'provider-import', capturedAt: '2026-10-13T07:00:00Z', provider: 'vrfkit' } }],
  playerStats: [{ id: 'p1', matchId: 'm1', player: 'raw', displayNameSnapshot: 'Ahmed', agent: 'Omen', kills: 18, deaths: 15, assists: 5, fk: 3, fd: 2, plants: 1, defuses: 0, hs: 44, orbPoints: 2, adr: 151.4, sourceMetadata: { method: 'provider-import', capturedAt: '2026-10-13T07:00:00Z', provider: 'vrfkit' } }],
  rounds: Array.from({ length: 22 }, (_, index) => ({ id: `r${index}`, matchId: 'm1', roundNo: index + 1, result: index < 9 ? 'W' : 'L', side: 'Attack' })),
};

describe('shared replay match log', () => {
  it('recognizes accepted replay-backed matches and shows the reviewed scoreboard', () => {
    expect(replayBackedMatches(data)).toHaveLength(1);
    const html = renderToStaticMarkup(<ReplayMatchLog data={data} theme={{}} />);
    expect(html).toContain('Haven · Apex');
    expect(html).toContain('9–13');
    expect(html).toContain('22 rounds');
    expect(html).toContain('Ahmed');
    expect(html).toContain('18 / 15 / 5');
    expect(html).toContain('Economy unknown');
  });
});
