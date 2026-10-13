import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = fs.readFileSync('src/index.css', 'utf8');
const app = fs.readFileSync('src/App.tsx', 'utf8');
const replay = fs.readFileSync('src/components/ReplayWorkspace.tsx', 'utf8');
const login = fs.readFileSync('src/components/LoginScreen.tsx', 'utf8');
const scoreboardCrop = fs.readFileSync('src/components/ScoreboardCrop.tsx', 'utf8');
const matchLogRounds = fs.readFileSync('src/components/MatchLogRounds.tsx', 'utf8');

describe('liquid UI presentation contract', () => {
  it('uses shared depth, spacing, motion and focus tokens', () => {
    for (const token of [
      '--ui-bg', '--ui-surface', '--ui-glass', '--ui-line', '--ui-specular',
      '--ui-teal', '--ui-red', '--ui-focus', '--ui-radius-lg', '--ui-ease',
    ]) expect(css).toContain(token);
    expect(css).toContain('.liquid-chrome');
    expect(css).toContain('.surface-card');
    expect(css).toContain('.ui-button');
    expect(css).toContain('.ui-field');
  });

  it('keeps blur on chrome and overlays, not dense scrolling data surfaces', () => {
    const dataSurfaceRule = css.match(/\.data-surface\s*\{([^}]*)\}/)?.[1] || '';
    const tableShellRule = css.match(/\.ui-table-shell\s*\{([^}]*)\}/)?.[1] || '';
    expect(css.match(/\.liquid-chrome,[\s\S]*?backdrop-filter: blur\(22px\)/)).toBeTruthy();
    expect(dataSurfaceRule).not.toContain('backdrop-filter');
    expect(tableShellRule).not.toContain('backdrop-filter');
    expect(replay).toContain('data-surface grid');
    expect(replay).toContain('ui-table-shell');
  });

  it('respects motion, transparency and contrast preferences', () => {
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('@media (prefers-reduced-transparency: reduce)');
    expect(css).toContain('@media (prefers-contrast: more)');
    expect(css).not.toMatch(/animation:\s*[^;]*infinite/i);
  });

  it('keeps sticky chrome and viewport overlays out of persistent containing blocks', () => {
    const chromeRule = css.match(/\.liquid-chrome,\s*\n\.liquid-panel\s*\{([^}]*)\}/)?.[1] || '';
    const routeRule = css.match(/\.route-stage\s*\{([^}]*)\}/)?.[1] || '';
    expect(chromeRule).not.toContain('position: relative');
    expect(routeRule).not.toContain('both');
    expect(css).toMatch(/@keyframes route-enter[\s\S]*?to \{ opacity: 1; transform: none; \}/);
  });

  it('provides a coherent daylight surface and isolates dark analysis/modal regions', () => {
    expect(app).toContain('data-theme={themeMode}');
    expect(css).toContain('.app-shell[data-theme="daylight"]');
    expect(css).toContain('--ui-surface: #ffffff');
    expect(css).toContain('.app-shell[data-theme="daylight"] .replay-workspace');
    expect(css).toMatch(/\.app-shell\[data-theme="daylight"\] \.replay-workspace \{[\s\S]*?--ui-bg: #07131d;[\s\S]*?--ui-text: #edf7f8;[\s\S]*?background: var\(--ui-bg\);[\s\S]*?padding: clamp/);
    expect(css).toContain('.app-shell[data-theme="daylight"] .modal-scrim .liquid-panel');
  });

  it('keeps reduced-transparency fallbacks theme-aware', () => {
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-transparency: reduce)'));
    expect(reduced).toContain('background: #0b1924');
    expect(reduced).toContain('.app-shell[data-theme="daylight"] .liquid-chrome');
    expect(reduced).toContain('background: #f8fbfc');
    expect(reduced).toContain('.app-shell[data-theme="daylight"] .replay-workspace .liquid-panel');
  });

  it('routes free scoreboard imports to Replay and traps focus in both remaining dialogs', () => {
    expect(app).toContain("setActiveTab('replays')");
    expect(app).toContain('onClick={openReplayImport}');
    expect(app).toContain('IMPORT SCOREBOARD');
    expect(app).not.toContain('ocrDialogRef');

    for (const dialog of [scoreboardCrop, matchLogRounds]) {
      expect(dialog).toContain('role="dialog"');
      expect(dialog).toContain('aria-modal="true"');
      expect(dialog).toContain("event.key === 'Escape'");
      expect(dialog).toMatch(/event\.key (?:===|!==) 'Tab'/);
      expect(dialog).toContain('button:not([disabled]), input:not([disabled])');
      expect(dialog).toMatch(/previous\?\.focus\(\)|returnFocus\?\.focus\(\)/);
      expect(dialog).toContain('document.activeElement === first');
      expect(dialog).toContain('document.activeElement === last');
    }
    expect(scoreboardCrop).toContain('aria-label="Adjust scoreboard columns"');
    expect(matchLogRounds).toContain('aria-label="Match details"');
    expect(login).toContain('min-h-11 min-w-11');
  });

  it('applies the system to shell, navigation, modal and replay review controls', () => {
    expect(app).toContain('app-shell min-h-screen');
    expect(app).toContain('liquid-chrome app-sidebar');
    expect(app).toContain('route-stage flex-grow');
    expect(scoreboardCrop).toContain('liquid-panel mx-auto max-w-5xl');
    expect(matchLogRounds).toContain('w-full max-w-4xl p-6 rounded-2xl border');
    expect(replay).toContain('liquid-panel overflow-hidden rounded-xl');
    expect(replay).toContain('replay-inbox-item');
    expect(replay).toContain('ui-button ui-button-primary');
    expect(replay).toContain('ui-field mt-1 min-h-11');
  });
});
