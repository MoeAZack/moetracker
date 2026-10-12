import { buildScreenshotReviewDraft } from './entryEngine';

export const LOCAL_OCR_RUNTIME = Object.freeze({
  tesseractVersion: '7.0.0',
  languagePackage: '@tesseract.js-data/eng@1.0.0',
  workerPath: '/ocr-assets/worker.min.js',
  corePath: '/ocr-assets/core',
  langPath: '/ocr-assets/lang',
  layoutProfile: 'valorant-scoreboard-1920x1080-v1',
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

export interface LocalOcrAdapter {
  recognize(image: CanvasImageSource, regions: readonly LocalOcrRegion[]): Promise<LocalOcrRecognition[]>;
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

export function createScoreboard1920Layout(width: number, height: number): LocalOcrRegion[] {
  if (width !== 1920 || height !== 1080) {
    throw Object.assign(new Error('Local OCR layout v1 accepts only an original 1920x1080 scoreboard. Resize/cropped images require a separately accepted profile.'), { status: 422 });
  }
  const regions: LocalOcrRegion[] = [
    { id: 'map', kind: 'text', rectangle: { left: 840, top: 120, width: 240, height: 50 } },
    { id: 'score.left', kind: 'integer', rectangle: { left: 790, top: 180, width: 90, height: 70 } },
    { id: 'score.right', kind: 'integer', rectangle: { left: 1040, top: 180, width: 90, height: 70 } },
  ];
  const sideLayouts = [
    { rowOffset: 0, nameLeft: 270, metricLefts: [645, 700, 755, 810, 865, 920] },
    { rowOffset: 5, nameLeft: 1035, metricLefts: [1410, 1465, 1520, 1575, 1630, 1685] },
  ];
  for (const side of sideLayouts) {
    for (let sideRow = 0; sideRow < 5; sideRow += 1) {
      const row = side.rowOffset + sideRow;
      const top = 330 + sideRow * 78;
      regions.push({ id: `player.${row}.name`, kind: 'text', rectangle: { left: side.nameLeft, top, width: 250, height: 44 } });
      METRICS.forEach((metric, index) => regions.push({
        id: `player.${row}.${metric}`,
        kind: 'integer',
        rectangle: { left: side.metricLefts[index], top, width: 48, height: 44 },
      }));
    }
  }
  return regions;
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
    model: `${LOCAL_OCR_RUNTIME.tesseractVersion}/eng-1.0.0/${LOCAL_OCR_RUNTIME.layoutProfile}`,
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
) {
  const regions = createScoreboard1920Layout(dimensions.width, dimensions.height);
  const recognitions = await adapter.recognize(image, regions);
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
  });
  return {
    async recognize(image, regions) {
      const results: LocalOcrRecognition[] = [];
      const source = document.createElement('canvas');
      source.width = 1920;
      source.height = 1080;
      const sourceContext = source.getContext('2d', { willReadFrequently: true });
      if (!sourceContext) throw new Error('Canvas preprocessing is unavailable.');
      sourceContext.drawImage(image, 0, 0, source.width, source.height);
      const sourcePixels = sourceContext.getImageData(0, 0, source.width, source.height);
      for (const region of regions) {
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
