# Delivery status

Updated 2026-10-12 (Africa/Cairo).

- **Continuation:** app heartbeat `moetracker-staged-delivery` created ACTIVE, hourly, in this task. It dispatches substantive work to Sol and requires Astra acceptance before release; no claim of uninterrupted execution when the app/environment is unavailable. Owner notifications only for meaningful changes, failures or required action.

- **Live:** security foundation, PR #1. Exact tested build 396d66c5fcb6b56927eeea3cc6719b3519bd4292; Cloud Run moetracker-00027-lof and Firebase verified. 16 tests and CI passed; backup exported; old access keys revoked. No later feature release yet.
- **Environment:** owner clarified current app is unused development, data/state disposable; resets/rebuilds/deployments are authorized. Do not stall features on preserving legacy development state. Product archive-before-reset and authentication protections remain required.
- **Current:** PR #2 merged after passing CI. Sol implements release-pipeline repair on `codex/release-pipeline`; Astra conditionally approved the narrow IAM matrix. Three separate runtime/build/deploy accounts and scoped grants are provisioned. WIF trust, workflow acceptance and candidate deployment are not yet complete. Existing deployed revision/traffic is unchanged. Research is not proof of provider approval or validated rating formulas.
- **Next ready action:** finish and independently review the bounded keyless pipeline, configure exact workflow trust, verify deployment; then move to archive/reset and honest entry. Do not bundle screenshot/replay work into this slice.
- **After that:** archive/reset guarantees; honest manual/import entry; screenshot draft; bounded replay draft; opponent history and coach/player dashboards. Ranked sync depends on eligible access/consent; rating formulas begin in shadow with explicit coverage.
- **External inputs:** coach Google email; ranked-player Riot IDs/region and consent; approved provider access if selected. These do not block release/recovery work.
- **Not yet complete:** production release automation, restoration drill, roster archives/reset, OCR/replay website import, opponent dashboard, automatic ranked sync and trustworthy unified performance scoring.
