import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RankedConsentPanel, type RankedAccountView, type RankedConsentView } from '../src/components/IntegrationStatus';

const account: RankedAccountView = { playerId: 'p1', providerId: 'official', account: { providerAccountId: 'Alpha#EU', region: 'eu', platform: 'pc' }, revision: 1 };
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
