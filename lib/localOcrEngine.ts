import { buildScreenshotReviewDraft } from './entryEngine';

export const LOCAL_OCR_RUNTIME = Object.freeze({
  tesseractVersion: '7.0.0',
  languagePackage: '@tesseract.js-data/eng@1.0.0',
  workerPath: '/ocr-assets/worker.min.js',
  corePath: '/ocr-assets/core',
  langPath: '/ocr-assets/lang',
  cropProfileRequired: true,
});

export type LocalOcrMetric = 'kills' | 'deaths' | 'assists' | 'fk' | 'plants' | 'defuses';
export type LocalOcrRegionKind = 'text' | 'integer';

export interface LocalOcrRegion {
  id: string;
  kind: LocalOcrRegionKind;
  rectangle: { left: number; top: number; width: number; height: number };
}

export interface LocalOcrRecognition {
  regionId: string;
  text: string;
  confidence: number | null;
}

export interface LocalOcrProfile {
  readonly id: string;
  readonly version: number;
  readonly status: 'unvalidated' | 'accepted';
  readonly dimensions: Readonly<{ width: number; height: number }>;
  readonly regions: readonly LocalOcrRegion[];
}

export interface LocalOcrAdapter {
  recognize(image: CanvasImageSource, profile: LocalOcrProfile): Promise<LocalOcrRecognition[]>;
  terminate(): Promise<void>;
}

const METRICS: readonly LocalOcrMetric[] = ['kills', 'deaths', 'assists', 'fk', 'plants', 'defuses'];
export const LOCAL_OCR_PROFILE_LIMITS = Object.freeze({
  maxDimension: 8192,
  maxPixels: 40_000_000,
});
const VALORANT_END_SCREEN_REFERENCE = Object.freeze({ width: 1839, height: 821 });
const VALORANT_PLAYER_TABLE_REFERENCE = Object.freeze({ width: 1016, height: 405 });

export interface ScoreboardSelection { names: { left: number; top: number; width: number; height: number }; kda: { left: number; top: number; width: number; height: number } }
/** User-selected columns, normalized to the image; header and portraits are excluded. */
export function createSelectedScoreboardProfile(width: number, height: number, selection: ScoreboardSelection): LocalOcrProfile {
  const regions: LocalOcrRegion[] = [];
  for (const box of [selection.names, selection.kda]) {
    if (![box.left, box.top, box.width, box.height].every(Number.isFinite) || box.left < 0 || box.top < 0 || box.width <= 0 || box.height <= 0 || box.left + box.width > 1.001 || box.top + box.height > 1.001) throw new Error('Keep both selection boxes inside the image.');
  }
  for (let row = 0; row < 10; row++) {
    for (const [index, metric] of ['name', 'kills', 'deaths', 'assists'].entries()) {
      const box = metric === 'name' ? selection.names : selection.kda;
      const divisions = metric === 'name' ? 1 : 3;
      const column = metric === 'name' ? 0 : index - 1;
      const left = Math.round((box.left + column * box.width / divisions) * width);
      const rowTop = (box.top + row * box.height / 10) * height; const rowHeight = box.height * height / 10;
      const top = Math.round(rowTop + rowHeight * .08); const bottom = Math.round(rowTop + rowHeight * .92);
      regions.push({ id: `player.${row}.${metric}`, kind: metric === 'name' ? 'text' : 'integer', rectangle: { left, top, width: Math.max(1, Math.min(width - left, Math.round(box.width * width / divisions))), height: Math.max(1, Math.min(height - top, bottom - top)) } });
    }
  }
  return createImmutableLocalOcrProfile({ id: 'valorant-player-table-v1', version: 1, status: 'accepted', dimensions: { width, height }, regions });
}

/** Accepted geometry for the standard VALORANT post-match scoreboard shown in the app. */
export function createValorantEndScreenProfile(width: number, height: number): LocalOcrProfile {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw Object.assign(new Error('The scoreboard image dimensions are invalid.'), { status: 422 });
  }
  const aspect = width / height;
  if (aspect >= 2.35 && aspect <= 2.75) {
    const sx = width / VALORANT_PLAYER_TABLE_REFERENCE.width; const sy = height / VALORANT_PLAYER_TABLE_REFERENCE.height;
    const rectangle = (left: number, top: number, regionWidth: number, regionHeight: number) => ({ left: Math.round(left * sx), top: Math.round(top * sy), width: Math.max(1, Math.round(regionWidth * sx)), height: Math.max(1, Math.round(regionHeight * sy)) });
    const regions: LocalOcrRegion[] = [];
    for (let row = 0; row < 10; row += 1) {
      const top = 33 + row * 37;
      regions.push({ id: `player.${row}.name`, kind: 'text', rectangle: rectangle(43, top, 330, 33) });
      regions.push({ id: `player.${row}.kills`, kind: 'integer', rectangle: rectangle(420, top, 31, 33) });
      regions.push({ id: `player.${row}.deaths`, kind: 'integer', rectangle: rectangle(451, top, 31, 33) });
      regions.push({ id: `player.${row}.assists`, kind: 'integer', rectangle: rectangle(482, top, 34, 33) });
    }
    return createImmutableLocalOcrProfile({ id: 'valorant-player-table-v1', version: 1, status: 'accepted', dimensions: { width, height }, regions });
  }
  if (aspect < 2.05 || aspect > 2.35) {
    throw Object.assign(new Error('Use the full VALORANT scoreboard or crop to the ten player rows and K/D/A table.'), { status: 422 });
  }
  const sx = width / VALORANT_END_SCREEN_REFERENCE.width;
  const sy = height / VALORANT_END_SCREEN_REFERENCE.height;
  const rectangle = (left: number, top: number, regionWidth: number, regionHeight: number) => ({
    left: Math.round(left * sx), top: Math.round(top * sy),
    width: Math.max(1, Math.round(regionWidth * sx)), height: Math.max(1, Math.round(regionHeight * sy)),
  });
  const regions: LocalOcrRegion[] = [
    { id: 'map', kind: 'text', rectangle: rectangle(1650, 73, 145, 24) },
    { id: 'score.left', kind: 'integer', rectangle: rectangle(18, 25, 55, 64) },
    { id: 'score.right', kind: 'integer', rectangle: rectangle(207, 25, 75, 64) },
  ];
  const metricGeometry: Record<LocalOcrMetric, [number, number]> = {
    kills: [956, 42], deaths: [997, 42], assists: [1038, 42],
    fk: [1168, 72], plants: [1374, 72], defuses: [1580, 72],
  };
  for (let row = 0; row < 10; row += 1) {
    const top = 232 + row * 48;
    regions.push({ id: `player.${row}.name`, kind: 'text', rectangle: rectangle(461, top, 395, 42) });
    for (const metric of METRICS) {
      const [left, regionWidth] = metricGeometry[metric];
      regions.push({ id: `player.${row}.${metric}`, kind: 'integer', rectangle: rectangle(left, top, regionWidth, 42) });
    }
  }
  return createImmutableLocalOcrProfile({
    id: 'valorant-post-match-scoreboard-v1', version: 1, status: 'accepted',
    dimensions: { width, height }, regions,
  });
}
const MAX_BY_METRIC: Record<LocalOcrMetric, number> = {
  kills: 100,
  deaths: 100,
  assists: 100,
  fk: 50,
  plants: 50,
  defuses: 50,
};

export function createImmutableLocalOcrProfile(profile: LocalOcrProfile): LocalOcrProfile {
  const dimensions = Object.freeze({ ...profile.dimensions });
  const regions = Object.freeze(profile.regions.map(region => Object.freeze({
    ...region,
    rectangle: Object.freeze({ ...region.rectangle }),
  })));
  return Object.freeze({ ...profile, dimensions, regions });
}

const EXPECTED_REGION_KINDS = new Map<string, LocalOcrRegionKind>([
  ['map', 'text'],
  ['score.left', 'integer'],
  ['score.right', 'integer'],
  ...Array.from({ length: 10 }, (_, row) => [
    [`player.${row}.name`, 'text'] as [string, LocalOcrRegionKind],
    ...METRICS.map(metric => [`player.${row}.${metric}`, 'integer'] as [string, LocalOcrRegionKind]),
  ]).flat(),
]);
const CROPPED_REGION_KINDS = new Map<string, LocalOcrRegionKind>(Array.from({ length: 10 }, (_, row) => [
  [`player.${row}.name`, 'text'] as [string, LocalOcrRegionKind],
  ...(['kills', 'deaths', 'assists'] as const).map(metric => [`player.${row}.${metric}`, 'integer'] as [string, LocalOcrRegionKind]),
]).flat());

function isFiniteInteger(value: number): boolean {
  return Number.isFinite(value) && Number.isInteger(value);
}

function acceptedProfile(
  profile: LocalOcrProfile | undefined,
  dimensions: { width: number; height: number },
): LocalOcrProfile {
  const fail = (message: string): never => {
    throw Object.assign(new Error(message), { status: 422 });
  };
  if (!profile || profile.status !== 'accepted') {
    return fail('Local OCR is unavailable until a calibrated crop profile is independently accepted.');
  }
  const validateDimensions = (value: Readonly<{ width: number; height: number }>, label: string) => {
    const { width, height } = value;
    if (!isFiniteInteger(width) || !isFiniteInteger(height)
      || width <= 0 || height <= 0
      || width > LOCAL_OCR_PROFILE_LIMITS.maxDimension
      || height > LOCAL_OCR_PROFILE_LIMITS.maxDimension
      || width * height > LOCAL_OCR_PROFILE_LIMITS.maxPixels) {
      return fail(`${label} dimensions exceed the local OCR safety limits.`);
    }
  };
  validateDimensions(dimensions, 'The supplied image');
  validateDimensions(profile.dimensions, 'The local OCR crop profile');
  if (profile.dimensions.width !== dimensions.width || profile.dimensions.height !== dimensions.height) {
    return fail('The accepted local OCR crop profile does not match the supplied image dimensions.');
  }
  const expectedRegions = profile.id === 'valorant-player-table-v1' ? CROPPED_REGION_KINDS : EXPECTED_REGION_KINDS;
  if (!Array.isArray(profile.regions) || profile.regions.length !== expectedRegions.size) {
    return fail(`The local OCR crop profile must contain exactly ${expectedRegions.size} regions.`);
  }
  const seen = new Set<string>();
  for (const region of profile.regions) {
    const { left, top, width, height } = region.rectangle;
    if (seen.has(region.id)) return fail(`The local OCR crop profile repeats region ${region.id}.`);
    const expectedKind = expectedRegions.get(region.id);
    if (!expectedKind) return fail(`The local OCR crop profile has unexpected region ${region.id}.`);
    if (region.kind !== expectedKind) {
      return fail(`The local OCR crop profile has the wrong kind for region ${region.id}.`);
    }
    seen.add(region.id);
    if (!isFiniteInteger(left) || !isFiniteInteger(top)
      || !isFiniteInteger(width) || !isFiniteInteger(height)
      || left < 0 || top < 0 || width <= 0 || height <= 0
      || left + width > dimensions.width || top + height > dimensions.height) {
      return fail(`The local OCR crop profile has an invalid region ${region.id}.`);
    }
  }
  const missing = [...expectedRegions.keys()].find(id => !seen.has(id));
  if (missing) return fail(`The local OCR crop profile is missing required region ${missing}.`);
  return createImmutableLocalOcrProfile(profile);
}

function recognizedById(recognitions: readonly LocalOcrRecognition[]) {
  const byId = new Map<string, LocalOcrRecognition>();
  for (const recognition of recognitions) {
    if (!byId.has(recognition.regionId)) byId.set(recognition.regionId, recognition);
  }
  return byId;
}

function strictInteger(raw: string | undefined, max: number): number | null {
  const trimmed = raw?.trim() || '';
  if (!/^\d{1,3}$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isInteger(value) && value >= 0 && value <= max ? value : null;
}

export function parseStrictKda(raw: string | undefined): { kills: number; deaths: number; assists: number } | null {
  const matched = (raw?.trim() || '').match(/^(\d{1,3})\s*\/\s*(\d{1,3})\s*\/\s*(\d{1,3})$/);
  if (!matched) return null;
  const [kills, deaths, assists] = matched.slice(1).map(Number);
  if (kills > MAX_BY_METRIC.kills || deaths > MAX_BY_METRIC.deaths || assists > MAX_BY_METRIC.assists) return null;
  return { kills, deaths, assists };
}

type BrowserRecognitionRegion = LocalOcrRegion & { recognitionKind?: 'kda' };
export function browserRecognitionRegions(profile: LocalOcrProfile): BrowserRecognitionRegion[] {
  if (profile.id !== 'valorant-player-table-v1') return profile.regions.map(region => ({ ...region, rectangle: { ...region.rectangle } }));
  const byId = new Map(profile.regions.map(region => [region.id, region]));
  const output: BrowserRecognitionRegion[] = [];
  for (let row = 0; row < 10; row += 1) {
    const name = byId.get(`player.${row}.name`); const kills = byId.get(`player.${row}.kills`);
    const deaths = byId.get(`player.${row}.deaths`); const assists = byId.get(`player.${row}.assists`);
    if (!name || !kills || !deaths || !assists) continue;
    output.push({ ...name, rectangle: { ...name.rectangle } });
    const left = Math.min(kills.rectangle.left, deaths.rectangle.left, assists.rectangle.left);
    const top = Math.min(kills.rectangle.top, deaths.rectangle.top, assists.rectangle.top);
    const right = Math.max(kills.rectangle.left + kills.rectangle.width, deaths.rectangle.left + deaths.rectangle.width, assists.rectangle.left + assists.rectangle.width);
    const bottom = Math.max(kills.rectangle.top + kills.rectangle.height, deaths.rectangle.top + deaths.rectangle.height, assists.rectangle.top + assists.rectangle.height);
    output.push({ id: `player.${row}.kda`, kind: 'text', recognitionKind: 'kda', rectangle: { left, top, width: right - left, height: bottom - top } });
  }
  return output;
}

export function parseLocalScoreboardRecognitions(
  recognitions: readonly LocalOcrRecognition[],
  options: { capturedAt: string; rosterPlayers: Array<{ id?: string; displayName: string }> },
) {
  const byId = recognizedById(recognitions);
  const players = Array.from({ length: 10 }, (_, row) => {
    const joinedRaw = byId.get(`player.${row}.kda`)?.text || '';
    const rawMetrics = { ...Object.fromEntries(METRICS.map(metric => [metric, byId.get(`player.${row}.${metric}`)?.text || ''])), kda: joinedRaw };
    const parsedMetrics = Object.fromEntries(METRICS.map(metric => [metric, strictInteger(rawMetrics[metric], MAX_BY_METRIC[metric])])) as Record<LocalOcrMetric, number | null>;
    const joinedKda = parseStrictKda(joinedRaw);
    if (joinedKda) Object.assign(parsedMetrics, joinedKda);
    return {
      name: byId.get(`player.${row}.name`)?.text?.trim() || '',
      agent: null,
      ...parsedMetrics,
      acs: null,
      adr: null,
      hs: null,
      fd: null,
      rawMetrics,
    };
  });
  return buildScreenshotReviewDraft({
    map: byId.get('map')?.text?.trim() || null,
    ourScore: strictInteger(byId.get('score.left')?.text, 100),
    theirScore: strictInteger(byId.get('score.right')?.text, 100),
    confident: false,
    players,
  }, {
    model: `${LOCAL_OCR_RUNTIME.tesseractVersion}/eng-1.0.0/parser-v1`,
    provider: 'tesseract-local',
    capturedAt: options.capturedAt,
    rosterPlayers: options.rosterPlayers,
  });
}

export async function extractLocalScoreboardDraft(
  adapter: LocalOcrAdapter,
  image: CanvasImageSource,
  dimensions: { width: number; height: number },
  options: { capturedAt: string; rosterPlayers: Array<{ id?: string; displayName: string }> },
  profile?: LocalOcrProfile,
) {
  const immutableProfile = acceptedProfile(profile, dimensions);
  const recognitions = await adapter.recognize(image, immutableProfile);
  return parseLocalScoreboardRecognitions(recognitions, options);
}

export function preprocessRegionPixels(
  image: { width: number; height: number; data: Uint8ClampedArray },
  rectangle: LocalOcrRegion['rectangle'],
) {
  const { left, top, width, height } = rectangle;
  if (left < 0 || top < 0 || width <= 0 || height <= 0 || left + width > image.width || top + height > image.height) {
    throw new Error('OCR crop lies outside the source image.');
  }
  const luminance = new Uint8Array(width * height);
  const histogram = new Uint32Array(256);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceIndex = ((top + y) * image.width + left + x) * 4;
      const value = (77 * image.data[sourceIndex] + 150 * image.data[sourceIndex + 1] + 29 * image.data[sourceIndex + 2]) >> 8;
      luminance[y * width + x] = value;
      histogram[value] += 1;
    }
  }
  let total = 0;
  let weighted = 0;
  for (let value = 0; value < 256; value += 1) {
    total += histogram[value];
    weighted += value * histogram[value];
  }
  let backgroundWeight = 0;
  let backgroundSum = 0;
  let bestVariance = -1;
  let threshold = 127;
  for (let value = 0; value < 256; value += 1) {
    backgroundWeight += histogram[value];
    if (backgroundWeight === 0) continue;
    const foregroundWeight = total - backgroundWeight;
    if (foregroundWeight === 0) break;
    backgroundSum += value * histogram[value];
    const backgroundMean = backgroundSum / backgroundWeight;
    const foregroundMean = (weighted - backgroundSum) / foregroundWeight;
    const variance = backgroundWeight * foregroundWeight * (backgroundMean - foregroundMean) ** 2;
    if (variance > bestVariance) {
      bestVariance = variance;
      threshold = value;
    }
  }
  let whitePixels = 0;
  for (const value of luminance) if (value > threshold) whitePixels += 1;
  // Tesseract is more stable with dark glyphs on a light field. VALORANT uses
  // light text on dark rows, so make the majority/background pixels white.
  const invert = whitePixels < luminance.length / 2;
  const output = new Uint8ClampedArray(width * height * 4);
  luminance.forEach((value, index) => {
    const thresholded = value > threshold ? 255 : 0;
    const binary = invert ? 255 - thresholded : thresholded;
    output[index * 4] = binary;
    output[index * 4 + 1] = binary;
    output[index * 4 + 2] = binary;
    output[index * 4 + 3] = 255;
  });
  return { width, height, data: output, threshold, inverted: invert };
}

export interface KdaNumberRectangle { left: number; top: number; width: number; height: number }

/** Preserve antialiased glyph edges while normalizing a numeric crop to dark text on white. */
export function preprocessNumericGrayscale(
  image: { width: number; height: number; data: Uint8ClampedArray },
  rectangle: LocalOcrRegion['rectangle'],
) {
  const { left, top, width, height } = rectangle;
  if (left < 0 || top < 0 || width <= 0 || height <= 0 || left + width > image.width || top + height > image.height) throw new Error('OCR crop lies outside the source image.');
  const values = new Uint8Array(width * height); const histogram = new Uint32Array(256);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const source = ((top + y) * image.width + left + x) * 4;
    const value = (77 * image.data[source] + 150 * image.data[source + 1] + 29 * image.data[source + 2]) >> 8;
    values[y * width + x] = value; histogram[value] += 1;
  }
  const percentile = (fraction: number) => {
    const target = Math.ceil(values.length * fraction); let count = 0;
    for (let value = 0; value < 256; value += 1) { count += histogram[value]; if (count >= target) return value; }
    return 255;
  };
  const low = percentile(.05); const high = percentile(.95); const median = percentile(.5); const range = Math.max(1, high - low);
  const darkBackground = median < 128; const output = new Uint8ClampedArray(width * height * 4);
  values.forEach((value, index) => {
    const stretched = Math.max(0, Math.min(255, Math.round((value - low) * 255 / range)));
    const normalized = darkBackground ? 255 - stretched : stretched;
    output[index * 4] = output[index * 4 + 1] = output[index * 4 + 2] = normalized; output[index * 4 + 3] = 255;
  });
  return { width, height, data: output, inverted: darkBackground, low, high };
}

/** Split a thresholded, black-on-white K/D/A row without assuming fixed columns. */
export function segmentKdaNumberRectangles(image: { width: number; height: number; data: Uint8ClampedArray }): KdaNumberRectangle[] | null {
  if (!Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 5 || image.height < 5 || image.data.length !== image.width * image.height * 4) return null;
  const inkByColumn = Array.from({ length: image.width }, (_, x) => {
    let ink = 0;
    for (let y = 0; y < image.height; y += 1) if (image.data[(y * image.width + x) * 4] < 128) ink += 1;
    return ink;
  });
  const runs: Array<{ left: number; right: number }> = [];
  for (let x = 0; x < image.width; x += 1) {
    if (!inkByColumn[x]) continue;
    const left = x;
    while (x + 1 < image.width && inkByColumn[x + 1]) x += 1;
    runs.push({ left, right: x });
  }
  if (runs.length < 5) return null;
  const gaps = runs.slice(0, -1).map((run, index) => ({ index, width: runs[index + 1].left - run.right - 1 }));
  const boundaries = gaps.filter(gap => gap.width >= Math.max(2, Math.floor(image.height * .06)))
    .sort((a, b) => b.width - a.width || a.index - b.index).slice(0, 4).map(gap => gap.index).sort((a, b) => a - b);
  if (boundaries.length !== 4) return null;
  const groups: Array<{ left: number; right: number }> = [];
  let start = 0;
  for (const boundary of boundaries) { groups.push({ left: runs[start].left, right: runs[boundary].right }); start = boundary + 1; }
  groups.push({ left: runs[start].left, right: runs[runs.length - 1].right });
  if (groups.length !== 5) return null;

  const inkBounds = (group: { left: number; right: number }) => {
    let top = image.height; let bottom = -1; let count = 0;
    for (let y = 0; y < image.height; y += 1) for (let x = group.left; x <= group.right; x += 1) {
      if (image.data[(y * image.width + x) * 4] < 128) { top = Math.min(top, y); bottom = Math.max(bottom, y); count += 1; }
    }
    return { ...group, top, bottom, count };
  };
  const bounded = groups.map(inkBounds);
  if (bounded.some(group => group.count === 0 || group.bottom < group.top)) return null;
  const isSlash = (group: ReturnType<typeof inkBounds>) => {
    const height = group.bottom - group.top + 1; const width = group.right - group.left + 1;
    const numericHeight = Math.max(...[bounded[0], bounded[2], bounded[4]].map(value => value.bottom - value.top + 1));
    if (height < Math.max(3, numericHeight * .6) || width > height * .8) return false;
    const third = Math.max(1, Math.floor(height / 3));
    const centroid = (from: number, to: number) => {
      let sum = 0; let count = 0;
      for (let y = from; y <= to; y += 1) for (let x = group.left; x <= group.right; x += 1) if (image.data[(y * image.width + x) * 4] < 128) { sum += x; count += 1; }
      return count ? sum / count : null;
    };
    const top = centroid(group.top, group.top + third - 1); const bottom = centroid(group.bottom - third + 1, group.bottom);
    return top !== null && bottom !== null && Math.abs(top - bottom) >= Math.max(1, width * .2);
  };
  if (!isSlash(bounded[1]) || !isSlash(bounded[3])) return null;
  const pad = Math.max(1, Math.round(image.height * .08));
  return [bounded[0], bounded[2], bounded[4]].map(group => ({
    left: Math.max(0, group.left - pad), top: Math.max(0, group.top - pad),
    width: Math.min(image.width, group.right + pad + 1) - Math.max(0, group.left - pad),
    height: Math.min(image.height, group.bottom + pad + 1) - Math.max(0, group.top - pad),
  }));
}

export async function createBrowserLocalTesseractAdapter(): Promise<LocalOcrAdapter> {
  if (typeof document === 'undefined') throw new Error('The local OCR adapter requires a browser canvas runtime.');
  const imported = await import('tesseract.js');
  const tesseract = (imported as any).default || imported;
  const worker = await tesseract.createWorker('eng', tesseract.OEM.LSTM_ONLY, {
    workerPath: LOCAL_OCR_RUNTIME.workerPath,
    corePath: LOCAL_OCR_RUNTIME.corePath,
    langPath: LOCAL_OCR_RUNTIME.langPath,
    workerBlobURL: false,
  });
  return {
    async recognize(image, profile) {
      const immutableProfile = acceptedProfile(profile, profile.dimensions);
      const results: LocalOcrRecognition[] = [];
      const source = document.createElement('canvas');
      source.width = immutableProfile.dimensions.width;
      source.height = immutableProfile.dimensions.height;
      const sourceContext = source.getContext('2d', { willReadFrequently: true });
      if (!sourceContext) throw new Error('Canvas preprocessing is unavailable.');
      sourceContext.drawImage(image, 0, 0, source.width, source.height);
      const sourcePixels = sourceContext.getImageData(0, 0, source.width, source.height);
      for (const region of browserRecognitionRegions(immutableProfile)) {
        const processed = preprocessRegionPixels(sourcePixels, region.rectangle);
        const rawCrop = document.createElement('canvas'); rawCrop.width = processed.width; rawCrop.height = processed.height;
        const rawContext = rawCrop.getContext('2d');
        if (!rawContext) throw new Error('Canvas preprocessing is unavailable.');
        rawContext.putImageData(new ImageData(processed.data, processed.width, processed.height), 0, 0);
        let recognitionImage = rawCrop;
        if (region.recognitionKind === 'kda') {
          const segmented = segmentKdaNumberRectangles(processed);
          if (segmented) {
            const values: string[] = []; const confidences: number[] = [];
            for (const rectangle of segmented) {
              const scale = Math.max(4, Math.ceil(96 / rectangle.height)); const padding = 12;
              const grayscale = preprocessNumericGrayscale(sourcePixels, {
                left: region.rectangle.left + rectangle.left, top: region.rectangle.top + rectangle.top,
                width: rectangle.width, height: rectangle.height,
              });
              const grayscaleCrop = document.createElement('canvas'); grayscaleCrop.width = grayscale.width; grayscaleCrop.height = grayscale.height;
              const grayscaleContext = grayscaleCrop.getContext('2d'); if (!grayscaleContext) throw new Error('Canvas preprocessing is unavailable.');
              grayscaleContext.putImageData(new ImageData(grayscale.data, grayscale.width, grayscale.height), 0, 0);
              const number = document.createElement('canvas'); number.width = rectangle.width * scale + padding * 2; number.height = rectangle.height * scale + padding * 2;
              const numberContext = number.getContext('2d'); if (!numberContext) throw new Error('Canvas preprocessing is unavailable.');
              numberContext.fillStyle = '#fff'; numberContext.fillRect(0, 0, number.width, number.height); numberContext.imageSmoothingEnabled = true; numberContext.imageSmoothingQuality = 'high';
              numberContext.drawImage(grayscaleCrop, padding, padding, rectangle.width * scale, rectangle.height * scale);
              await worker.setParameters({ tessedit_pageseg_mode: tesseract.PSM.SINGLE_WORD, tessedit_char_whitelist: '0123456789' });
              const result = await worker.recognize(number); const text = (result.data.text || '').trim(); const confidence = result.data.confidence;
              if (!/^\d{1,3}$/.test(text) || !Number.isFinite(confidence) || confidence < 70) { values.length = 0; break; }
              values.push(text); confidences.push(confidence);
            }
            if (values.length === 3) {
              results.push({ regionId: region.id, text: values.join('/'), confidence: confidences.length ? Math.min(...confidences) : null });
            }
            else results.push({ regionId: region.id, text: '', confidence: confidences.length ? Math.min(...confidences) : null });
            continue;
          }
          const scale = Math.max(4, Math.ceil(96 / processed.height)); const padding = 12;
          const padded = document.createElement('canvas'); padded.width = processed.width * scale + padding * 2; padded.height = processed.height * scale + padding * 2;
          const paddedContext = padded.getContext('2d');
          if (!paddedContext) throw new Error('Canvas preprocessing is unavailable.');
          paddedContext.fillStyle = '#fff'; paddedContext.fillRect(0, 0, padded.width, padded.height); paddedContext.imageSmoothingEnabled = false;
          paddedContext.drawImage(rawCrop, padding, padding, processed.width * scale, processed.height * scale); recognitionImage = padded;
        }
        await worker.setParameters({
          tessedit_pageseg_mode: tesseract.PSM.SINGLE_LINE,
          ...(region.recognitionKind === 'kda' ? { tessedit_char_whitelist: '' }
            : region.kind === 'integer' ? { tessedit_char_whitelist: '0123456789' } : { tessedit_char_whitelist: '' }),
        });
        const result = await worker.recognize(recognitionImage);
        const confidence = Number.isFinite(result.data.confidence) ? result.data.confidence : null;
        results.push({ regionId: region.id, text: region.recognitionKind === 'kda' && (confidence === null || confidence < 70) ? '' : result.data.text || '', confidence });
      }
      return results;
    },
    async terminate() {
      await worker.terminate();
    },
  };
}
