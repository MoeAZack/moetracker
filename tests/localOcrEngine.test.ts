import { describe, expect, it } from 'vitest';
import fixture from './fixtures/local-ocr-sanitized.json';
import firebaseConfig from '../firebase.json';
import {
  LOCAL_OCR_PROFILE_LIMITS,
  LOCAL_OCR_RUNTIME,
  createImmutableLocalOcrProfile,
  createValorantEndScreenProfile,
  extractLocalScoreboardDraft,
  parseLocalScoreboardRecognitions,
  preprocessRegionPixels,
  type LocalOcrAdapter,
  type LocalOcrProfile,
  type LocalOcrRecognition,
} from '../lib/localOcrEngine';

const capturedAt = '2026-10-12T12:00:00.000Z';
const rosterPlayers = Array.from({ length: 10 }, (_, index) => ({
  id: `player-${index + 1}`,
  displayName: `Player ${String(index + 1).padStart(2, '0')}`,
}));
const recognitions = fixture.recognitions as LocalOcrRecognition[];

const metricNames = ['kills', 'deaths', 'assists', 'fk', 'plants', 'defuses'] as const;

function acceptedTestProfile(): LocalOcrProfile {
  const regions: LocalOcrProfile['regions'] = [
    { id: 'map', kind: 'text', rectangle: { left: 0, top: 0, width: 1, height: 1 } },
    { id: 'score.left', kind: 'integer', rectangle: { left: 0, top: 0, width: 1, height: 1 } },
    { id: 'score.right', kind: 'integer', rectangle: { left: 0, top: 0, width: 1, height: 1 } },
    ...Array.from({ length: 10 }, (_, row) => [
      { id: `player.${row}.name`, kind: 'text' as const, rectangle: { left: 0, top: 0, width: 1, height: 1 } },
      ...metricNames.map(metric => ({
        id: `player.${row}.${metric}`,
        kind: 'integer' as const,
        rectangle: { left: 0, top: 0, width: 1, height: 1 },
      })),
    ]).flat(),
  ];
  return {
    id: 'test-only-contract',
    version: 1,
    status: 'accepted',
    dimensions: { width: 100, height: 100 },
    regions,
  };
}

describe('local screenshot OCR engine foundation', () => {
  it('ships no crop geometry and fails closed for missing or unvalidated injected profiles', async () => {
    let called = false;
    const adapter: LocalOcrAdapter = {
      async recognize() { called = true; return recognitions; },
      async terminate() {},
    };
    const profile = createImmutableLocalOcrProfile({
      id: 'private-sample-draft', version: 1, status: 'unvalidated',
      dimensions: { width: 1839, height: 821 }, regions: [],
    });
    expect(Object.isFrozen(profile)).toBe(true);
    expect(Object.isFrozen(profile.dimensions)).toBe(true);
    await expect(extractLocalScoreboardDraft(
      adapter, {} as CanvasImageSource, profile.dimensions, { capturedAt, rosterPlayers },
    )).rejects.toMatchObject({ status: 422 });
    await expect(extractLocalScoreboardDraft(
      adapter, {} as CanvasImageSource, profile.dimensions, { capturedAt, rosterPlayers }, profile,
    )).rejects.toThrow(/independently accepted/);
    expect(called).toBe(false);
  });

  it('rejects every malformed accepted profile before invoking the OCR adapter', async () => {
    let adapterCalls = 0;
    const adapter: LocalOcrAdapter = {
      async recognize() { adapterCalls += 1; return recognitions; },
      async terminate() {},
    };
    const cases: Array<{ label: string; mutate: (profile: LocalOcrProfile) => void }> = [
      { label: 'NaN dimension', mutate: profile => { (profile.dimensions as { width: number }).width = Number.NaN; } },
      { label: 'infinite dimension', mutate: profile => { (profile.dimensions as { height: number }).height = Number.POSITIVE_INFINITY; } },
      { label: 'fractional dimension', mutate: profile => { (profile.dimensions as { width: number }).width = 99.5; } },
      { label: 'zero dimension', mutate: profile => { (profile.dimensions as { width: number }).width = 0; } },
      { label: 'negative dimension', mutate: profile => { (profile.dimensions as { height: number }).height = -1; } },
      { label: 'oversized axis', mutate: profile => { (profile.dimensions as { width: number }).width = LOCAL_OCR_PROFILE_LIMITS.maxDimension + 1; } },
      { label: 'oversized pixel area', mutate: profile => {
        (profile.dimensions as { width: number; height: number }).width = 7000;
        (profile.dimensions as { width: number; height: number }).height = 7000;
      } },
      { label: 'NaN crop coordinate', mutate: profile => { profile.regions[0].rectangle.left = Number.NaN; } },
      { label: 'infinite crop coordinate', mutate: profile => { profile.regions[0].rectangle.top = Number.POSITIVE_INFINITY; } },
      { label: 'fractional crop coordinate', mutate: profile => { profile.regions[0].rectangle.left = 0.5; } },
      { label: 'fractional crop size', mutate: profile => { profile.regions[0].rectangle.width = 1.5; } },
      { label: 'zero crop size', mutate: profile => { profile.regions[0].rectangle.width = 0; } },
      { label: 'negative crop size', mutate: profile => { profile.regions[0].rectangle.height = -1; } },
      { label: 'out-of-bounds crop', mutate: profile => { profile.regions[0].rectangle.left = 100; } },
      { label: 'wrong region kind', mutate: profile => { profile.regions[0].kind = 'integer'; } },
      { label: 'missing region', mutate: profile => { (profile.regions as LocalOcrProfile['regions'] & unknown[]).pop(); } },
      { label: 'duplicate region', mutate: profile => { profile.regions[1].id = profile.regions[0].id; } },
      { label: 'extra region', mutate: profile => { (profile.regions as LocalOcrProfile['regions'] & unknown[]).push({
        id: 'unexpected', kind: 'integer', rectangle: { left: 0, top: 0, width: 1, height: 1 },
      }); } },
    ];

    expect(acceptedTestProfile().regions).toHaveLength(73);
    for (const testCase of cases) {
      const profile = structuredClone(acceptedTestProfile());
      testCase.mutate(profile);
      await expect(extractLocalScoreboardDraft(
        adapter,
        {} as CanvasImageSource,
        profile.dimensions,
        { capturedAt, rosterPlayers },
        profile,
      ), testCase.label).rejects.toMatchObject({ status: 422 });
    }
    const validProfile = acceptedTestProfile();
    await expect(extractLocalScoreboardDraft(
      adapter,
      {} as CanvasImageSource,
      { width: Number.NaN, height: validProfile.dimensions.height },
      { capturedAt, rosterPlayers },
      validProfile,
    )).rejects.toMatchObject({ status: 422 });
    expect(adapterCalls).toBe(0);
  });

  it('applies deterministic grayscale/Otsu preprocessing without changing crop dimensions', () => {
    const pixels = new Uint8ClampedArray([
      0, 0, 0, 255, 255, 255, 255, 255,
      255, 255, 255, 255, 0, 0, 0, 255,
    ]);
    const first = preprocessRegionPixels({ width: 2, height: 2, data: pixels }, { left: 0, top: 0, width: 2, height: 2 });
    const second = preprocessRegionPixels({ width: 2, height: 2, data: pixels }, { left: 0, top: 0, width: 2, height: 2 });
    expect(first).toEqual(second);
    expect(first).toMatchObject({ width: 2, height: 2, threshold: 0 });
    expect([...first.data]).toEqual([...pixels]);
  });

  it('parses a sanitized 60-cell fixture into a non-writing review draft with expected aggregates', () => {
    const draft = parseLocalScoreboardRecognitions(recognitions, { capturedAt, rosterPlayers });
    expect(draft).toMatchObject({
      contractVersion: 1,
      status: 'review-required',
      reviewRequired: true,
      sourceMetadata: { method: 'screenshot', provider: 'tesseract-local' },
      match: { map: 'Ascent', ourScore: 13, theirScore: 9, alliedSideConfirmed: false },
    });
    expect(draft.stats).toHaveLength(10);
    expect(draft.stats.every(stat => stat.rosterMatch.status === 'matched')).toBe(true);
    const sum = (field: 'kills' | 'deaths' | 'assists' | 'fk' | 'plants' | 'defuses') =>
      draft.stats.reduce((total, stat) => total + (stat[field] || 0), 0);
    expect({
      kills: sum('kills'), deaths: sum('deaths'), assists: sum('assists'),
      fk: sum('fk'), plants: sum('plants'), defuses: sum('defuses'),
    }).toEqual({ kills: 165, deaths: 165, assists: 63, fk: 22, plants: 18, defuses: 7 });
    expect(draft.stats.every(stat => stat.agent === null && stat.acs === null && stat.adr === null && stat.hs === null && stat.fd === null)).toBe(true);
  });

  it('preserves raw OCR names, reports normalized-name ambiguity, and never repairs suspect numbers', () => {
    const suspect = recognitions.map(recognition => ({ ...recognition }));
    suspect.find(recognition => recognition.regionId === 'player.0.name')!.text = 'Pláyer 01';
    suspect.find(recognition => recognition.regionId === 'player.0.deaths')!.text = '177';
    const draft = parseLocalScoreboardRecognitions(suspect, {
      capturedAt,
      rosterPlayers: [
        { id: 'one', displayName: 'Player 01' },
        { id: 'two', displayName: 'Player-01' },
      ],
    });
    expect(draft.stats[0]).toMatchObject({
      extractedName: 'Pláyer 01',
      matchedPlayerId: null,
      matchedPlayerName: null,
      rosterMatch: { status: 'ambiguous', candidatePlayerIds: ['one', 'two'] },
      deaths: null,
      rawMetrics: { deaths: '177' },
    });
  });

  it('exposes only a pinned runtime/parser foundation, not an enabled crop profile', () => {
    expect(LOCAL_OCR_RUNTIME).toMatchObject({
      tesseractVersion: '7.0.0',
      languagePackage: '@tesseract.js-data/eng@1.0.0',
      cropProfileRequired: true,
    });
    expect(LOCAL_OCR_RUNTIME).not.toHaveProperty('layoutProfile');
  });

  it('builds the accepted standard post-match scoreboard geometry at the supplied resolution', () => {
    const profile = createValorantEndScreenProfile(1839, 821);
    expect(profile).toMatchObject({ id: 'valorant-post-match-scoreboard-v1', status: 'accepted', dimensions: { width: 1839, height: 821 } });
    expect(profile.regions).toHaveLength(73);
    expect(profile.regions.map(region => region.id)).toContain('player.9.defuses');
    expect(() => createValorantEndScreenProfile(900, 1600)).toThrow(/full-width/);
  });

  it('keeps the static-hosting worker and Wasm policy same-origin without blob workers', () => {
    const csp = firebaseConfig.hosting.headers[0].headers.find(header => header.key === 'Content-Security-Policy')?.value || '';
    expect(csp).toContain("worker-src 'self'");
    expect(csp).toContain("'wasm-unsafe-eval'");
    expect(csp).not.toContain('blob:');
  });
});
