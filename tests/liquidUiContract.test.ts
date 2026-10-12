import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = fs.readFileSync('src/index.css', 'utf8');
const app = fs.readFileSync('src/App.tsx', 'utf8');
const replay = fs.readFileSync('src/components/ReplayWorkspace.tsx', 'utf8');

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

  it('applies the system to shell, navigation, modal and replay review controls', () => {
    expect(app).toContain('app-shell min-h-screen');
    expect(app).toContain('liquid-chrome app-sidebar');
    expect(app).toContain('route-stage flex-grow');
    expect(app).toContain('liquid-panel w-full max-w-2xl');
    expect(replay).toContain('liquid-panel overflow-hidden rounded-xl');
    expect(replay).toContain('replay-inbox-item');
    expect(replay).toContain('ui-button ui-button-primary');
    expect(replay).toContain('ui-field mt-1 min-h-11');
  });
});
