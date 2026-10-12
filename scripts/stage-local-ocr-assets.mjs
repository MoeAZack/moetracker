import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const destination = path.join(root, 'public', 'ocr-assets');

const assets = [
  ['node_modules/tesseract.js/dist/worker.min.js', 'worker.min.js', '576b7df7e3393e137e51849357c9adb53fe7ac1bb69bfa06cf3d61520f182c6d'],
  ['node_modules/@tesseract.js-data/eng/4.0.0/eng.traineddata.gz', 'lang/eng.traineddata.gz', 'ed350f3752f81ee8f38769edc14d92d997dababe23b565c59879372cc46a2468'],
  ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js', 'core/tesseract-core-lstm.wasm.js', 'eef5f8b2f8e20e150680b20adaec4a60babafee3adbe8a94583c81fee46e8680'],
  ['node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js', 'core/tesseract-core-relaxedsimd-lstm.wasm.js', '861a536cf9ef8e63cb644d57bab39c388f37f7d6b6f60024b741c5f6b39a59b3'],
  ['node_modules/tesseract.js-core/tesseract-core-relaxedsimd.wasm.js', 'core/tesseract-core-relaxedsimd.wasm.js', '843074aa5bad1cc6421b74a86201768ced9f244795e4d81435435a61a40ce535'],
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'core/tesseract-core-simd-lstm.wasm.js', 'c58b46a4c796c0b8afccf77591d5b875b6896b45d402bbce8caa6f5362447b38'],
  ['node_modules/tesseract.js-core/tesseract-core-simd.wasm.js', 'core/tesseract-core-simd.wasm.js', '6b61ef4e911b5cf57e656bbfe983d6e2b3711a02dd164154ddda064566e8e09d'],
  ['node_modules/tesseract.js-core/tesseract-core.wasm.js', 'core/tesseract-core.wasm.js', '0bc6ce3e5fbbd0cd89706cf2fd70960e3372f4f01ee24265b26990808aaeb286'],
];

for (const [sourceRelative, destinationRelative, expectedSha256] of assets) {
  const source = path.join(root, sourceRelative);
  const bytes = await readFile(source);
  const actualSha256 = createHash('sha256').update(bytes).digest('hex');
  if (actualSha256 !== expectedSha256) {
    throw new Error(`Refusing to stage unexpected OCR asset ${sourceRelative}: ${actualSha256}`);
  }
  const target = path.join(destination, destinationRelative);
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(source, target);
}

console.log(`Staged ${assets.length} verified local OCR assets.`);
