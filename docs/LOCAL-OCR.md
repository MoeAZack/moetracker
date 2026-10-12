# Local screenshot OCR foundation

This slice adds a browser-local, non-writing OCR engine foundation for the exact `1920x1080` Valorant scoreboard layout profile. It does not change navigation or enable screenshot saving.

## Reproducible runtime

- `tesseract.js` is pinned to `7.0.0` and English trained data to `@tesseract.js-data/eng@1.0.0` in the lockfile.
- `npm run stage:ocr-assets` verifies SHA-256 for the worker, six WebAssembly wrappers and trained data before copying them from `node_modules` into the ignored `public/ocr-assets/` build input.
- The browser worker uses only `/ocr-assets/...` paths. It does not require Gemini, a CDN, a paid API, or a screenshot upload.
- `predev` and `prebuild` stage the verified assets. A hash mismatch fails the command rather than silently changing the OCR runtime.

The source packages and runtime layout follow the official Tesseract.js [local installation](https://github.com/naptha/tesseract.js/blob/master/docs/local-installation.md) and [worker API](https://github.com/naptha/tesseract.js/blob/master/docs/api.md) contracts.

## Safety contract

- The layout profile rejects any dimensions other than original `1920x1080`; resized/cropped inputs need a separately tested profile.
- Pixel preprocessing is deterministic grayscale plus Otsu thresholding over fixed regions.
- Numeric fields accept only bounded digit strings. Suspect values such as a death count of `177` become `null`; the parser never “corrects” them to a guessed value.
- The v1 profile reads only K/D/A, first blood, plant and defuse cells. Agent, ACS, ADR, headshot percentage, first deaths, round order and stable player IDs remain unknown unless explicitly supplied by a later accepted extractor.
- Raw OCR names and numeric strings remain in the review draft. Accent-insensitive roster matching is allowed only when unique; collisions are explicitly `ambiguous` with all candidates and no selected identity.
- Every result uses the existing `review-required` screenshot draft contract with `alliedSideConfirmed: false`. There is no auto-save path.
- Gemini remains an optional existing fallback. Local OCR neither requires nor invokes it.

## Acceptance boundary

The committed fixture is synthetic and sanitized; no private screenshot or private player identifier is stored. A private resized `1839x821` sample currently yields only 52/60 exact numeric cells, including assist errors and a `177` versus `17` death error, so it is evidence of the remaining accuracy gap—not acceptance. UI and accuracy acceptance require the original representative `1920x1080` sample and must prove 60/60 numeric cells plus aggregate K 165, D 165, A 63, first bloods 22, plants 18 and defuses 7. Names must retain raw text and ambiguity.
