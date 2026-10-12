import { describe, expect, it } from 'vitest';
import fixture from './fixtures/local-ocr-sanitized.json';
import {
  LOCAL_OCR_RUNTIME,
  createScoreboard1920Layout,
  extractLocalScoreboardDraft,
  parseLocalScoreboardRecognitions,
  preprocessRegionPixels,
  type LocalOcrAdapter,
  type LocalOcrRecognition,
} from '../lib/localOcrEngine';

const capturedAt = '2026-10-12T12:00:00.000Z';
const rosterPlayers = Array.from({ length: 10 }, (_, index) => ({
  id: `player-${index + 1}`,
  displayName: `Player ${String(index + 1).padStart(2, '0')}`,
}));
const recognitions = fixture.recognitions as LocalOcrRecognition[];

describe('local screenshot OCR engine foundation', () => {
  it('creates one deterministic 1920x1080 layout and fails closed for the resized private-sample class', () => {
    const first = createScoreboard1920Layout(1920, 1080);
    const second = createScoreboard1920Layout(1920, 1080);
    expect(first).toEqual(second);
    expect(first).toHaveLength(73);
    expect(new Set(first.map(region => region.id)).size).toBe(first.length);
    expect(() => createScoreboard1920Layout(1839, 821)).toThrow(/only an original 1920x1080/);
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

  it('uses an injectable adapter and returns only the typed review draft', async () => {
    let receivedRegions = 0;
    const adapter: LocalOcrAdapter = {
      async recognize(_image, regions) {
        receivedRegions = regions.length;
        return recognitions;
      },
      async terminate() {},
    };
    const draft = await extractLocalScoreboardDraft(adapter, {} as CanvasImageSource, { width: 1920, height: 1080 }, { capturedAt, rosterPlayers });
    expect(receivedRegions).toBe(73);
    expect(draft.status).toBe('review-required');
    expect(draft).not.toHaveProperty('save');
    expect(LOCAL_OCR_RUNTIME).toMatchObject({ tesseractVersion: '7.0.0', languagePackage: '@tesseract.js-data/eng@1.0.0' });
  });
});
