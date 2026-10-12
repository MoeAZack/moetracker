import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CoachEngineAuthoring, CoachEngineReadiness, RankedConsentPanel, type RankedAccountView, type RankedConsentView } from '../src/components/IntegrationStatus';
import VodReview from '../src/components/VodReview';
import { createSeed } from '../lib/seed';

const account: RankedAccountView = { playerId: 'p1', providerId: 'official', account: { providerAccountId: 'Alpha#EU', region: 'eu', platform: 'pc' }, revision: 1, fingerprint: 'account-fingerprint' };
const consent: RankedConsentView = { playerId: 'p1', providerId: 'official', scopes: ['ranked-match-history'], consentVersion: 'consent/v1', grantedAt: '2026-10-12T12:00:00Z', revokedAt: null, revision: 1 };
const render = (role: string | null, accounts: RankedAccountView[], consents: RankedConsentView[], initialSelection = '') => renderToStaticMarkup(<RankedConsentPanel role={role} accounts={accounts} consents={consents} initialSelection={initialSelection} />);

describe('ranked consent role rendering', () => {
  it.each(['owner', 'coach'])('never renders grant controls for %s', role => {
    const html = render(role, [account], [consent]);
    expect(html).toContain('cannot fabricate consent'); expect(html).not.toContain('Grant ranked consent');
  });
  it.each(['owner', 'coach'])('renders the same non-fabrication policy for empty %s state', role => {
    expect(render(role, [], [])).toContain('cannot fabricate consent');
  });
  it('renders an explicit empty state for an unbound player', () => {
    expect(render('player', [], [])).toContain('No coach-confirmed ranked account');
  });
  it('requires selection instead of silently choosing the first populated account', () => {
    const html = render('player', [account], []);
    expect(html).toContain('Select an account'); expect(html).not.toContain('Requested scopes:'); expect(html).not.toContain('Grant ranked consent</button>');
  });
  it('shows provider, exact account, region/platform, requested scopes and confirmation after deliberate selection', () => {
    const html = render('player', [account], [], 'p1:official');
    for (const value of ['official', 'Alpha#EU', 'eu / pc', 'Ranked match history', 'Official rank and RR', 'I confirm this exact account']) expect(html).toContain(value);
    expect(html).toContain('aria-live="polite"'); expect(html).toContain('disabled=""');
  });
  it('shows revoke rather than grant for a selected active consent', () => {
    expect(render('player', [account], [consent], 'p1:official')).toContain('Revoke ranked consent');
  });
});

describe('coach persisted engine readiness', () => {
  it('renders only persisted replay, rating calibration/contributions and ranked health facts', () => {
    const html = renderToStaticMarkup(<CoachEngineReadiness role="coach" engineState={{
      replay: [{ status: 'review-required' }],
      ratings: { configs: { c: { key: 'shadow/v1:b:1', calibrationStatus: 'uncalibrated', formula: { weights: { killsPerRound: .2 } } } }, records: { r: { recordKey: 'r', status: 'review-required', calibrationStatus: 'uncalibrated', result: { context: { playerId: 'p1' }, coverage: { ratio: .8 }, metrics: [{ metric: 'killsPerRound', included: true, weightedContribution: .12 }] } } } },
      ranked: { providers: [{ approvedStatus: 'approved', configured: true }], accounts: [account], consents: [consent], states: [{ status: 'fresh' }] },
    }} />);
    for (const value of ['1 active · 1 awaiting review', '1 recomputed · 0 calibrated', '1 eligible · 1 accounts · 1 consented · 1 fresh', 'authoritative score unavailable', 'killsPerRound']) expect(html).toContain(value);
  });
  it('does not expose coach readiness to players', () => expect(renderToStaticMarkup(<CoachEngineReadiness role="player" engineState={{}} />)).toBe(''));
  it('mounts explicit coach authoring controls while players receive none', () => {
    const coach = renderToStaticMarkup(<CoachEngineAuthoring role="coach" engineState={{ ratings: { records: {} } }} onChanged={() => {}} />);
    for (const value of ['Formula, baseline, validation input and expectedRevision JSON', 'Preview weights', 'Recompute on server', 'Provider capability and expectedRevision JSON', 'Exact account JSON', 'network activation remains disabled']) expect(coach).toContain(value);
    expect(renderToStaticMarkup(<CoachEngineAuthoring role="player" engineState={{}} onChanged={() => {}} />)).toBe('');
  });
});

describe('match-scoped replay authoring', () => {
  it('renders first-draft validation for a focused active match with no linked VOD', () => {
    const data: any = { ...createSeed(), matches: [{ id: 'match-no-vod', opponent: 'Opponent', map: 'Ascent', date: '2026-10-12', type: 'Scrim' }], vodReviews: [], rounds: [], playerStats: [] };
    const html = renderToStaticMarkup(<VodReview data={data} theme={{ border: 'border-test', cardBg: 'card-test' }} role="coach" onRefresh={async () => {}} initialMatchId="match-no-vod" />);
    expect(html).toContain('Create replay evidence draft'); expect(html).toContain('match-no-vod'); expect(html).toContain('Validate and save draft');
  });
});
