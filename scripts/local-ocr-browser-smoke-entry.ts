import { createBrowserLocalTesseractAdapter } from '../lib/localOcrEngine';

const result = { status: 'running', error: '' };
(window as any).__ocrWorkerSmoke = result;

try {
  const adapter = await createBrowserLocalTesseractAdapter();
  await adapter.terminate();
  result.status = 'ok';
  document.body.dataset.ocrWorker = 'ok';
} catch (error) {
  result.status = 'error';
  result.error = error instanceof Error ? error.message : String(error);
  document.body.dataset.ocrWorker = 'error';
}
