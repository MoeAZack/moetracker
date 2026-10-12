# Local screenshot OCR foundation

This slice adds a browser-local, non-writing OCR parser/runtime foundation. It does not ship an enabled crop layout, change navigation or enable screenshot saving.

## Reproducible runtime

- `tesseract.js` is pinned to `7.0.0` and English trained data to `@tesseract.js-data/eng@1.0.0` in the lockfile.
- `npm run stage:ocr-assets` verifies SHA-256 for the worker, six WebAssembly wrappers and trained data before copying them from `node_modules` into the ignored `public/ocr-assets/` build input.
- The browser worker uses only `/ocr-assets/...` paths with `workerBlobURL: false`. The production CSP permits same-origin workers and WebAssembly compilation without permitting `blob:` workers. It does not require Gemini, a CDN, a paid API, or a screenshot upload.
- `predev` and `prebuild` stage the verified assets. A hash mismatch fails the command rather than silently changing the OCR runtime.
- `npm run test:ocr-browser` builds the production app, serves it with the production CSP, launches local Chrome/Edge, initializes and terminates the worker/core/language runtime, and fails if any OCR request leaves the same origin.

The source packages and runtime layout follow the official Tesseract.js [local installation](https://github.com/naptha/tesseract.js/blob/master/docs/local-installation.md) and [worker API](https://github.com/naptha/tesseract.js/blob/master/docs/api.md) contracts.

## Safety contract

- There is no default crop profile. Extraction returns `422` unless code injects an immutable profile with exact dimensions, the exact 73 parser region IDs and kinds, and `status: 'accepted'`; `status: 'unvalidated'` is deliberately unavailable. Both image axes and every crop coordinate/size must be finite integers, crops must remain in bounds, and the safety ceiling is 8,192 pixels per axis and 40 megapixels per image.
- Pixel preprocessing is deterministic grayscale plus Otsu thresholding over the regions of that separately calibrated profile.
- Numeric fields accept only bounded digit strings. Suspect values such as a death count of `177` become `null`; the parser never “corrects” them to a guessed value.
- The v1 parser contract maps only K/D/A, first blood, plant and defuse cells. Agent, ACS, ADR, headshot percentage, first deaths, round order and stable player IDs remain unknown unless explicitly supplied by a later accepted extractor.
- Raw OCR names and numeric strings remain in the review draft. Accent-insensitive roster matching is allowed only when unique; collisions are explicitly `ambiguous` with all candidates and no selected identity.
- Every result uses the existing `review-required` screenshot draft contract with `alliedSideConfirmed: false`. There is no auto-save path.
- Gemini remains an optional existing fallback. Local OCR neither requires nor invokes it.

## Acceptance boundary

The committed fixture is synthetic parser metadata only; it validates field mapping and contains no geometry, pixels or private identifiers. The supplied private screenshot is a vertical 10-row scoreboard at `1839x821`, not a two-column layout. No crop profile for it—or for any assumed `1920x1080` layout—is accepted or shipped. Current private OCR evidence yields only 52/60 exact numeric cells, including assist errors and a `177` versus `17` death error, so it proves the remaining accuracy gap. UI/accuracy acceptance needs calibrated geometry against the representative source and must prove 60/60 numeric cells plus aggregate K 165, D 165, A 63, first bloods 22, plants 18 and defuses 7. Names must retain raw text and ambiguity.
