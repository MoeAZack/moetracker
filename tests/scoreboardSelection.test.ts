import { describe, expect, it } from 'vitest';
import { createSelectedScoreboardProfile } from '../lib/localOcrEngine';
import { pairReplayScreenshots } from '../lib/replayScreenshotPairing';

describe('user-selected scoreboard geometry', () => {
  it.each([[1920, 1080], [1016, 405], [750, 1000], [3840, 2160]])('keeps all 40 cells inside an arbitrary %sx%s image', (width, height) => {
    const profile = createSelectedScoreboardProfile(width, height, { names: { left: .12, top: .18, width: .3, height: .65 }, kda: { left: .51, top: .18, width: .19, height: .65 } });
    expect(profile.regions).toHaveLength(40);
    for (const { rectangle: r } of profile.regions) { expect(r.left + r.width).toBeLessThanOrEqual(width); expect(r.top + r.height).toBeLessThanOrEqual(height); expect(r.width).toBeGreaterThan(0); }
    expect(profile.regions[0].rectangle.left).toBe(Math.round(width * .12));
    expect(profile.regions[36].rectangle.top).toBe(Math.round(height * (.18 + .65 * (.9 + .008))));
    const lastRowBottom = profile.regions[36].rectangle.top + profile.regions[36].rectangle.height;
    expect(lastRowBottom).toBeLessThanOrEqual(Math.round(height * (.18 + .65 * .992)));
  });
  it('rejects selections outside the image', () => {
    expect(() => createSelectedScoreboardProfile(100, 100, { names: { left: .9, top: 0, width: .2, height: 1 }, kda: { left: 0, top: 0, width: .2, height: 1 } })).toThrow();
  });
  it('keeps screenshot-only drafts out of automatic replay pairing', () => {
    const record: any = { deviceId: 'manual-entry', status: 'linked', suggestions: [{ playerId: 'x' }], replaySha256: 'old' };
    pairReplayScreenshots({ screenshots: { one: record } });
    expect(record).toMatchObject({ status: 'pending', replaySha256: null, suggestions: [] });
  });
});
