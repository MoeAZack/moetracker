import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ReplayWorkspace, { ReplayReviewEvidence } from '../src/components/ReplayWorkspace';

const available = (value: number | string) => ({ value, status: 'available', source: 'redacted fixture', confidence: 1 });
const players = [
  { playerId: 'raw-a', teamId: 'team-us', displayName: available('Player A'), kills: available(2), deaths: available(1), assists: available(3), firstBloods: available(1), firstDeaths: available(0), plants: available(1), defuses: available(0) },
  { playerId: 'raw-x', teamId: 'team-them', displayName: available('Opponent X'), kills: available(1), deaths: available(2), assists: available(0), firstBloods: available(0), firstDeaths: available(1), plants: available(0), defuses: available(0) },
];
const detail = { parser: { version: '0.2.5' }, result: { scoreboard: { map: available('Haven'), finalScore: { teamA: { teamId: 'team-us', score: available(13) }, teamB: { teamId: 'team-them', score: available(9) } }, players }, reviewDraft: { coverage: { playedRounds: 22, resolvedRounds: 20 }, rounds: [{ roundNumber: 1, status: 'resolved', firstKillPlayerId: 'raw-a', firstDeathPlayerId: 'raw-x' }], evidence: { rounds: [{ roundNumber: 1, winnerTeamId: 'team-us', endReason: 'elimination', derived: { successfulTrades: 1, tradeOpportunities: 1, clutches: [] } }] } }, diagnostics: { replaySha256: 'a'.repeat(64) } }, review: { status: 'review-required', revision: 1, ratingDraftKeys: [] } };
const data: any = { matches: [{ id: 'm1', date: '2026-10-03', opponent: 'Redacted', map: 'Haven' }], rosterPlayers: [{ id: 'p1', displayName: 'Alpha' }] };
const mappings = [{ parserPlayerId: 'raw-a', rosterPlayerId: 'p1', displayName: 'Reviewed Alpha' }, { parserPlayerId: 'raw-x', rosterPlayerId: null, displayName: 'Opponent X' }];

describe('replay review workspace semantics', () => {
  it('renders a dense labeled evidence workflow with explicit acceptance and immutable-evidence copy', () => {
    const html = renderToStaticMarkup(<ReplayReviewEvidence detail={detail} data={data} matchId="m1" setMatchId={() => {}} teamId="team-us" setTeamId={() => {}} mappings={mappings} setMapping={() => {}} teams={['team-us', 'team-them']} busy="" confirmed={false} setConfirmed={() => {}} saveReview={() => {}} accept={() => {}} />);
    expect(html).toContain('Coach review draft'); expect(html).toContain('Scoreboard and identity overlay'); expect(html).toContain('Round evidence');
    expect(html).toContain('never inside it'); expect(html).toContain('I reviewed the match, team, names, and evidence'); expect(html).toContain('aria-labelledby="events-heading"');
    expect(html).toContain('Reviewed name for raw-a'); expect(html).toContain('Roster mapping for Reviewed Alpha'); expect(html).not.toContain('gradient'); expect(html).not.toContain('backdrop-blur');
  });

  it('keeps the player surface simplified and explains that acceptance is coach-only', () => {
    const html = renderToStaticMarkup(<ReplayWorkspace data={data} role="player" onAccepted={() => {}} />);
    expect(html).toContain('Your private uploads'); expect(html).toContain('Players cannot change mappings or accept match data'); expect(html).not.toContain('Coach review draft');
  });
});
