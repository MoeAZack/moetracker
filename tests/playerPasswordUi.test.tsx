import React from 'react';
import fs from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import LoginScreen from '../src/components/LoginScreen';
import PlayerPasswordForm from '../src/components/PlayerPasswordForm';
import RosterManager from '../src/components/RosterManager';

const rosterSource = fs.readFileSync('src/components/RosterManager.tsx', 'utf8');
const passwordFormSource = fs.readFileSync('src/components/PlayerPasswordForm.tsx', 'utf8');

describe('player password UI', () => {
  it('opens on the simple player-name and password login', () => {
    const html = renderToStaticMarkup(<LoginScreen onLoginSuccess={() => {}} />);
    expect(html).toContain('aria-label="Login type"');
    expect(html).toContain('aria-selected="true">Player');
    expect(html).toContain('Coach / access key');
    expect(html).toContain('id="player-name"');
    expect(html).toContain('placeholder="Ahmed"');
    expect(html).toContain('id="player-password"');
    expect(html).toContain('placeholder="xyz"');
    expect(html).toContain('minLength="3"');
    expect(html).toContain('Use a longer password for better protection.');
    expect(html).not.toContain('id="access-key"');
  });

  it('renders a per-player set/reset form without exposing an old password', () => {
    const html = renderToStaticMarkup(<PlayerPasswordForm playerId="player-1" playerName="Ahmed" />);
    expect(html).toContain('aria-label="New password for Ahmed"');
    expect(html).toContain('placeholder="Set/reset password"');
    expect(html).toContain('type="password"');
    expect(html).toContain('minLength="3"');
    expect(html).toContain('for example, xyz');
    expect(html).not.toContain('Copy login details');
    expect(html).not.toContain('Login:');
  });

  it('offers an optional password on roster creation and a reset form on the player card', () => {
    const data = {
      rosterPlayers: [{ id: 'player-1', displayName: 'Ahmed' }],
      coreMemberships: [],
      tryoutBatches: [],
      seasonArchives: [],
    } as any;
    const html = renderToStaticMarkup(<RosterManager data={data} theme={{ border: '', cardBg: '' }} onRefresh={async () => {}} />);
    expect(html).toContain('aria-label="Optional player password"');
    expect(html).toContain('placeholder="Password (optional, e.g. xyz)"');
    expect(html).toContain('aria-label="New password for Ahmed"');
    expect(html).toContain('placeholder="Set/reset password"');
  });

  it('marks a created player before refresh and provides observable clipboard fallbacks', () => {
    const createPlayerSource = rosterSource.slice(rosterSource.indexOf('const createPlayer'), rosterSource.indexOf('const copyFreshLogin'));
    expect(createPlayerSource.indexOf('setPendingPasswordPlayer(player);')).toBeLessThan(createPlayerSource.indexOf('await onRefresh();'));
    for (const source of [rosterSource, passwordFormSource]) {
      expect(source).toContain('await navigator.clipboard.writeText');
      expect(source).toContain("setCopyStatus('copied')");
      expect(source).toContain("setCopyStatus('fallback')");
      expect(source).toContain('Copy unavailable. Select these login details:');
      expect(source).toContain('<textarea readOnly');
    }
  });
});
