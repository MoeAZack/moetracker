import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import fs from 'fs';
import { describe, expect, it } from 'vitest';
import ReplayWorkspace, { ReplayReviewEvidence, createLatestRequestGuard, matchScoreboardNames, refreshReplayWorkspace, reviewEditorSnapshot, visibleCollectionDevices } from '../src/components/ReplayWorkspace';

const available = (value: number | string) => ({ value, status: 'available', source: 'redacted fixture', confidence: 1 });
const players = [
  { playerId: 'raw-a', teamId: 'team-us', displayName: available('Player A'), kills: available(2), deaths: available(1), assists: available(3), firstBloods: available(1), firstDeaths: available(0), plants: available(1), defuses: available(0) },
  { playerId: 'raw-x', teamId: 'team-them', displayName: available('Opponent X'), kills: available(1), deaths: available(2), assists: available(0), firstBloods: available(0), firstDeaths: available(1), plants: available(0), defuses: available(0) },
];
const detail = { parser: { version: '0.2.5' }, result: { scoreboard: { map: available('Haven'), finalScore: { teamA: { teamId: 'team-us', score: available(13) }, teamB: { teamId: 'team-them', score: available(9) } }, players }, reviewDraft: { coverage: { playedRounds: 22, resolvedRounds: 20 }, rounds: [{ roundNumber: 1, status: 'resolved', firstKillPlayerId: 'raw-a', firstDeathPlayerId: 'raw-x' }], evidence: { playerMetrics: [{ playerId: 'raw-a', headshotKills: 1, eligibleHeadshotKills: 2, headshotPercentage: 50, orbCaptures: 3 }], rounds: [{ roundNumber: 1, winnerTeamId: 'team-us', endReason: 'elimination', derived: { successfulTrades: 1, tradeOpportunities: 1, clutches: [] } }] } }, diagnostics: { replaySha256: 'a'.repeat(64) } }, review: { status: 'review-required', revision: 1, ratingDraftKeys: [] } };
const data: any = { matches: [{ id: 'm1', date: '2026-10-03', opponent: 'Redacted', map: 'Haven' }], rosterPlayers: [{ id: 'p1', displayName: 'Alpha' }] };
const mappings = [{ parserPlayerId: 'raw-a', rosterPlayerId: 'p1', displayName: 'Reviewed Alpha' }, { parserPlayerId: 'raw-x', rosterPlayerId: null, displayName: 'Opponent X' }];

describe('replay review workspace semantics', () => {
  it('renders a dense labeled evidence workflow with explicit acceptance and immutable-evidence copy', () => {
    const html = renderToStaticMarkup(<ReplayReviewEvidence detail={detail} data={data} matchId="m1" setMatchId={() => {}} teamId="team-us" setTeamId={() => {}} mappings={mappings} setMapping={() => {}} teams={['team-us', 'team-them']} busy="" dirty={false} confirmed={false} setConfirmed={() => {}} saveReview={() => {}} accept={() => {}} />);
    expect(html).toContain('Coach review draft'); expect(html).toContain('Scoreboard and identity overlay'); expect(html).toContain('Round evidence');
    expect(html).toContain('Import actual names'); expect(html).toContain('unique exact K/D/A matches'); expect(html).toContain('I reviewed the match, team, names, and evidence'); expect(html).toContain('aria-labelledby="events-heading"');
    expect(html).toContain('Reviewed name for raw-a'); expect(html).toContain('Roster mapping for Reviewed Alpha'); expect(html).toContain('overflow-x-auto overflow-y-auto'); expect(html).not.toContain('gradient'); expect(html).not.toContain('backdrop-blur');
    expect(html).toContain('50%'); expect(html).toContain('1/2 weapon kills'); expect(html).toContain('>3</td>');
    const dirtyHtml = renderToStaticMarkup(<ReplayReviewEvidence detail={detail} data={data} matchId="m1" setMatchId={() => {}} teamId="team-us" setTeamId={() => {}} mappings={mappings} setMapping={() => {}} teams={['team-us', 'team-them']} busy="" dirty={true} confirmed={false} setConfirmed={() => {}} saveReview={() => {}} accept={() => {}} />);
    expect(dirtyHtml).toContain('Unsaved changes'); expect(dirtyHtml).not.toContain('Accept this saved revision'); expect(dirtyHtml).toMatch(/<button[^>]*disabled=""[^>]*>Accept replay<\/button>/);
  });

  it('proposes actual screenshot names only for unique exact K/D/A matches', () => {
    const replay = [
      { playerId: 'one', kills: available(22), deaths: available(16), assists: available(5) },
      { playerId: 'two', kills: available(19), deaths: available(14), assists: available(6) },
      { playerId: 'ambiguous', kills: available(12), deaths: available(18), assists: available(8) },
      { playerId: 'same-one', kills: available(7), deaths: available(7), assists: available(7) },
      { playerId: 'same-two', kills: available(7), deaths: available(7), assists: available(7) },
      { playerId: 'unknown', kills: { value: null, status: 'unavailable' }, deaths: { value: null, status: 'unavailable' }, assists: { value: null, status: 'unavailable' } },
    ];
    const screenshot = [
      { extractedName: 'Yohpa', kills: 22, deaths: 16, assists: 5 },
      { extractedName: 'secret santa', kills: 19, deaths: 14, assists: 6 },
      { extractedName: 'duplicate one', kills: 12, deaths: 18, assists: 8 },
      { extractedName: 'duplicate two', kills: 12, deaths: 18, assists: 8 },
      { extractedName: 'one name for duplicate replay rows', kills: 7, deaths: 7, assists: 7 },
      { extractedName: 'null metrics must not match', kills: null, deaths: null, assists: null },
    ];
    const result = matchScoreboardNames(replay, screenshot);
    expect(Object.fromEntries(result.proposed)).toEqual({ one: 'Yohpa', two: 'secret santa' });
    expect([...result.ambiguous]).toEqual(['ambiguous', 'same-one', 'same-two']);
    expect(result.proposed.has('unknown')).toBe(false);
  });

  it('keeps the player surface simplified and explains that acceptance is coach-only', () => {
    const html = renderToStaticMarkup(<ReplayWorkspace data={data} role="player" onAccepted={() => {}} />);
    expect(html).toContain('Your private uploads'); expect(html).toContain('Players cannot change mappings or accept match data'); expect(html).not.toContain('Coach review draft');
  });

  it('offers the coach a manual path when a screenshot has no replay match', () => {
    const source = fs.readFileSync('src/components/ReplayWorkspace.tsx', 'utf8');
    expect(source).toContain('Complete manually →');
    expect(source).toContain('!item.replaySha256 && onManualFallback');
    const matchEditor = fs.readFileSync('src/components/MatchLogRounds.tsx', 'utf8');
    expect(matchEditor).toContain("source: 'screenshot-manual-fallback'");
    expect(matchEditor).toContain('sourceMetadata: manualReplayDraft.sourceMetadata');
    expect(matchEditor).toContain("map: manualReplayDraft.match?.map || ''");
    expect(matchEditor).toContain("agent: imported?.agent || ''");
  });

  it('loads local screenshots through the CSP-allowed data URL path rather than blocked blob URLs', () => {
    const source = fs.readFileSync('src/components/ReplayWorkspace.tsx', 'utf8');
    expect(source).toContain('reader.readAsDataURL(file)');
    expect(source).not.toContain('URL.createObjectURL(file)');
  });

  it('removes revoked collectors from the visible collection-device list', () => {
    const device = (id: string, status: 'active' | 'expired' | 'revoked') => ({ id, name: id, owner: { role: 'coach', playerId: null }, createdAt: '', expiresAt: '', revokedAt: status === 'revoked' ? '2026-10-12T00:00:00.000Z' : null, lastSeenAt: null, status });
    expect(visibleCollectionDevices([device('active', 'active'), device('removed', 'revoked'), device('expired', 'expired')]).map(item => item.id)).toEqual(['active', 'expired']);
  });

  it('treats every edit as a different saved snapshot and rejects stale async detail responses', () => {
    const saved = reviewEditorSnapshot('m1', 'team-us', mappings);
    expect(reviewEditorSnapshot('m2', 'team-us', mappings)).not.toBe(saved);
    expect(reviewEditorSnapshot('m1', 'team-them', mappings)).not.toBe(saved);
    expect(reviewEditorSnapshot('m1', 'team-us', mappings.map(item => item.parserPlayerId === 'raw-a' ? { ...item, displayName: 'Edited' } : item))).not.toBe(saved);
    const guard = createLatestRequestGuard(); const requestA = guard.start(); const requestB = guard.start(); expect(guard.isCurrent(requestA)).toBe(false); expect(guard.isCurrent(requestB)).toBe(true); guard.cancel(); expect(guard.isCurrent(requestB)).toBe(false);
  });

  it('refreshes parser detail even when the selected replay hash is unchanged', async () => {
    const details: string[] = []; await refreshReplayWorkspace(async () => 'same-replay-hash', async sha256 => { details.push(sha256); }, true); await refreshReplayWorkspace(async () => 'same-replay-hash', async sha256 => { details.push(sha256); }, true);
    expect(details).toEqual(['same-replay-hash', 'same-replay-hash']);
  });

  it('keeps mobile header controls named, stateful, connected and at least 44px', () => {
    const app = fs.readFileSync('src/App.tsx', 'utf8');
    expect(app).toContain("aria-label={mobileMenuOpen ? 'Close navigation' : 'Open navigation'}"); expect(app).toContain('aria-expanded={mobileMenuOpen}'); expect(app).toContain('aria-controls="mobile-navigation"'); expect(app).toContain('<nav id="mobile-navigation"');
    expect(app).toMatch(/aria-label="Open AI Scoreboard Import"[\s\S]*?<Image className="w-4 h-4"/); expect((app.match(/className="w-11 h-11 inline-flex items-center justify-center/g) || [])).toHaveLength(2);
  });
});
