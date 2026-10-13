import { describe, expect, it } from 'vitest';
import fixture from './fixtures/local-ocr-sanitized.json';
import { readFileSync } from 'node:fs';
import {
  LOCAL_OCR_PROFILE_LIMITS,
  LOCAL_OCR_RUNTIME,
  createImmutableLocalOcrProfile,
  createValorantEndScreenProfile,
  browserRecognitionRegions,
  extractLocalScoreboardDraft,
  parseStrictKda,
  parseLocalScoreboardRecognitions,
  preprocessRegionPixels,
  preprocessNumericGrayscale,
  segmentKdaNumberRectangles,
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

  it('normalizes dark scoreboard rows to black glyphs on a majority-white background', () => {
    const pixels = new Uint8ClampedArray([
      0, 0, 0, 255, 0, 0, 0, 255,
      0, 0, 0, 255, 255, 255, 255, 255,
    ]);
    const result = preprocessRegionPixels({ width: 2, height: 2, data: pixels }, { left: 0, top: 0, width: 2, height: 2 });
    expect(result.inverted).toBe(true);
    expect([...result.data]).toEqual([
      255, 255, 255, 255, 255, 255, 255, 255,
      255, 255, 255, 255, 0, 0, 0, 255,
    ]);
  });

  it('preserves intermediate antialiasing values in dark-background numeric crops', () => {
    const data = new Uint8ClampedArray([
      20, 20, 20, 255,
      100, 100, 100, 255,
      220, 220, 220, 255,
    ]);
    const result = preprocessNumericGrayscale({ width: 3, height: 1, data }, { left: 0, top: 0, width: 3, height: 1 });
    expect(result).toMatchObject({ width: 3, height: 1, inverted: true, low: 20, high: 220 });
    expect([result.data[0], result.data[4], result.data[8]]).toEqual([255, 153, 0]);
    expect(result.data[4]).toBeGreaterThan(0);
    expect(result.data[4]).toBeLessThan(255);
  });

  it('segments numeric K/D/A spans from projected whitespace without fixed columns', () => {
    const width = 72; const height = 20; const data = new Uint8ClampedArray(width * height * 4).fill(255);
    const ink = (x: number, y: number) => { const offset = (y * width + x) * 4; data[offset] = data[offset + 1] = data[offset + 2] = 0; };
    const block = (left: number, right: number) => { for (let y = 3; y <= 16; y += 1) for (let x = left; x <= right; x += 1) ink(x, y); };
    block(2, 6); block(8, 12); // a two-digit number with a tiny intra-number gap
    for (let y = 2; y <= 17; y += 1) ink(24 - Math.floor(y / 4), y);
    block(32, 36); block(38, 42);
    for (let y = 2; y <= 17; y += 1) ink(54 - Math.floor(y / 4), y);
    block(62, 66);
    expect(segmentKdaNumberRectangles({ width, height, data })).toEqual([
      { left: 0, top: 1, width: 15, height: 18 },
      { left: 30, top: 1, width: 15, height: 18 },
      { left: 60, top: 1, width: 9, height: 18 },
    ]);
  });

  it('segments short centered glyphs even when the selected row has large vertical margins', () => {
    const width = 72; const height = 31; const data = new Uint8ClampedArray(width * height * 4).fill(255);
    const ink = (x: number, y: number) => { const offset = (y * width + x) * 4; data[offset] = data[offset + 1] = data[offset + 2] = 0; };
    const block = (left: number, right: number) => { for (let y = 11; y <= 19; y += 1) for (let x = left; x <= right; x += 1) ink(x, y); };
    block(2, 6); block(8, 12);
    for (let y = 11; y <= 19; y += 1) ink(24 - Math.floor((y - 11) / 3), y);
    block(32, 36); block(38, 42);
    for (let y = 11; y <= 19; y += 1) ink(54 - Math.floor((y - 11) / 3), y);
    block(62, 66);
    expect(segmentKdaNumberRectangles({ width, height, data })).toEqual([
      { left: 0, top: 9, width: 15, height: 13 },
      { left: 30, top: 9, width: 15, height: 13 },
      { left: 60, top: 9, width: 9, height: 13 },
    ]);
  });

  it('fails closed when tied gaps cannot distinguish digit spacing from separators', () => {
    const width = 61; const height = 20; const data = new Uint8ClampedArray(width * height * 4).fill(255);
    const ink = (x: number, y: number) => { const offset = (y * width + x) * 4; data[offset] = data[offset + 1] = data[offset + 2] = 0; };
    for (const left of [1, 9, 17, 25, 33, 41, 49]) for (let y = 4; y <= 15; y += 1) for (let x = left; x <= left + 3; x += 1) ink(x, y);
    expect(segmentKdaNumberRectangles({ width, height, data })).toBeNull();
  });

  it('rejects uncertain K/D/A projections instead of inventing separators', () => {
    const width = 60; const height = 20; const data = new Uint8ClampedArray(width * height * 4).fill(255);
    for (const left of [2, 14, 26, 38, 50]) for (let y = 3; y <= 16; y += 1) for (let x = left; x < left + 4; x += 1) {
      const offset = (y * width + x) * 4; data[offset] = data[offset + 1] = data[offset + 2] = 0;
    }
    expect(segmentKdaNumberRectangles({ width, height, data })).toBeNull();
    expect(segmentKdaNumberRectangles({ width: 4, height, data: new Uint8ClampedArray(4 * height * 4) })).toBeNull();
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

  it('strictly parses a joined K/D/A line without repairing ambiguous OCR', () => {
    expect(parseStrictKda(' 22 / 14 / 7\n')).toEqual({ kills: 22, deaths: 14, assists: 7 });
    expect(parseStrictKda('0/0/0')).toEqual({ kills: 0, deaths: 0, assists: 0 });
    for (const invalid of ['22 14 7', '22/14', '22/14/7/1', '2O/14/7', '-1/14/7', '101/14/7', '22|14|7']) {
      expect(parseStrictKda(invalid), invalid).toBeNull();
    }
  });

  it('uses joined row-wide K/D/A recognition for player-table profiles while retaining the fixed profile', () => {
    const selected = createValorantEndScreenProfile(1016, 405);
    const joined = browserRecognitionRegions(selected);
    expect(joined).toHaveLength(20);
    expect(joined.find(region => region.id === 'player.0.kda')).toMatchObject({
      recognitionKind: 'kda', rectangle: { left: 420, top: 33, width: 96, height: 33 },
    });
    expect(joined.some(region => region.id === 'player.0.kills')).toBe(false);

    const fixed = createValorantEndScreenProfile(1839, 821);
    expect(browserRecognitionRegions(fixed)).toHaveLength(73);
    expect(browserRecognitionRegions(fixed).map(region => region.id)).toContain('player.0.kills');
  });

  it('applies valid joined K/D/A recognition and leaves malformed joined rows null', () => {
    const joined: LocalOcrRecognition[] = Array.from({ length: 10 }, (_, row) => [
      { regionId: `player.${row}.name`, text: `Player ${String(row + 1).padStart(2, '0')}`, confidence: 90 },
      { regionId: `player.${row}.kda`, text: row === 1 ? '12 8 4' : `${20 - row}/${10 + row}/${row}`, confidence: 90 },
    ]).flat();
    const draft = parseLocalScoreboardRecognitions(joined, { capturedAt, rosterPlayers });
    expect(draft.stats[0]).toMatchObject({ kills: 20, deaths: 10, assists: 0, rawMetrics: { kda: '20/10/0' } });
    expect(draft.stats[1]).toMatchObject({ kills: null, deaths: null, assists: null, rawMetrics: { kda: '12 8 4' } });
  });

  it('builds the accepted standard post-match scoreboard geometry at the supplied resolution', () => {
    const profile = createValorantEndScreenProfile(1839, 821);
    expect(profile).toMatchObject({ id: 'valorant-post-match-scoreboard-v1', status: 'accepted', dimensions: { width: 1839, height: 821 } });
    expect(profile.regions).toHaveLength(73);
    expect(profile.regions.map(region => region.id)).toContain('player.9.defuses');
    expect(() => createValorantEndScreenProfile(900, 1600)).toThrow(/full VALORANT scoreboard/);
  });

  it('accepts a proportionally resized crop containing only the ten names and K/D/A rows', () => {
    const exact = createValorantEndScreenProfile(1016, 405);
    const resized = createValorantEndScreenProfile(1524, 608);
    expect(exact).toMatchObject({ id: 'valorant-player-table-v1', dimensions: { width: 1016, height: 405 } });
    expect(exact.regions).toHaveLength(40); expect(resized.regions).toHaveLength(40);
    expect(exact.regions.map(region => region.id)).toContain('player.9.assists');
    expect(exact.regions.some(region => region.id === 'map' || region.id.startsWith('score.'))).toBe(false);
  });

  it('keeps the static-hosting worker and Wasm policy same-origin without blob workers', () => {
    const csp = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8');
    expect(csp).toContain("worker-src 'self'");
    expect(csp).toContain("'wasm-unsafe-eval'");
    expect(csp).not.toContain('blob:');
  });
});
