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

function requiredRegionIds() {
  return [
    'map', 'score.left', 'score.right',
    ...Array.from({ length: 10 }, (_, row) => [
      `player.${row}.name`,
      ...METRICS.map(metric => `player.${row}.${metric}`),
    ]).flat(),
  ];
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
  const immutable = createImmutableLocalOcrProfile(profile);
  if (immutable.dimensions.width !== dimensions.width || immutable.dimensions.height !== dimensions.height) {
    return fail('The accepted local OCR crop profile does not match the supplied image dimensions.');
  }
  const seen = new Set<string>();
  for (const region of immutable.regions) {
    const { left, top, width, height } = region.rectangle;
    if (seen.has(region.id)) return fail(`The local OCR crop profile repeats region ${region.id}.`);
    seen.add(region.id);
    if (left < 0 || top < 0 || width <= 0 || height <= 0
      || left + width > dimensions.width || top + height > dimensions.height) {
      return fail(`The local OCR crop profile has an invalid region ${region.id}.`);
    }
  }
  const missing = requiredRegionIds().find(id => !seen.has(id));
  if (missing) return fail(`The local OCR crop profile is missing required region ${missing}.`);
  return immutable;
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

export function parseLocalScoreboardRecognitions(
  recognitions: readonly LocalOcrRecognition[],
  options: { capturedAt: string; rosterPlayers: Array<{ id?: string; displayName: string }> },
) {
  const byId = recognizedById(recognitions);
  const players = Array.from({ length: 10 }, (_, row) => {
    const rawMetrics = Object.fromEntries(METRICS.map(metric => [metric, byId.get(`player.${row}.${metric}`)?.text || '']));
    const parsedMetrics = Object.fromEntries(METRICS.map(metric => [metric, strictInteger(rawMetrics[metric], MAX_BY_METRIC[metric])])) as Record<LocalOcrMetric, number | null>;
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
  const output = new Uint8ClampedArray(width * height * 4);
  luminance.forEach((value, index) => {
    const binary = value > threshold ? 255 : 0;
    output[index * 4] = binary;
    output[index * 4 + 1] = binary;
    output[index * 4 + 2] = binary;
    output[index * 4 + 3] = 255;
  });
  return { width, height, data: output, threshold };
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
      for (const region of immutableProfile.regions) {
        const processed = preprocessRegionPixels(sourcePixels, region.rectangle);
        const crop = document.createElement('canvas');
        crop.width = processed.width;
        crop.height = processed.height;
        const cropContext = crop.getContext('2d');
        if (!cropContext) throw new Error('Canvas preprocessing is unavailable.');
        cropContext.putImageData(new ImageData(processed.data, processed.width, processed.height), 0, 0);
        await worker.setParameters({
          tessedit_pageseg_mode: tesseract.PSM.SINGLE_LINE,
          ...(region.kind === 'integer' ? { tessedit_char_whitelist: '0123456789' } : { tessedit_char_whitelist: '' }),
        });
        const result = await worker.recognize(crop);
        results.push({ regionId: region.id, text: result.data.text || '', confidence: Number.isFinite(result.data.confidence) ? result.data.confidence : null });
      }
      return results;
    },
    async terminate() {
      await worker.terminate();
    },
  };
}
