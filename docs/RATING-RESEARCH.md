# Player rating research and recommended specification

_Checked 12 October 2026. This is a coaching/performance score, not Riot Rank Rating (RR), hidden MMR, Tracker Score, or VLR Rating._

## What the published ratings mean

- **Riot RR/MMR:** RR is ladder progress. Riot says match outcome dominates, round differential matters, individual damage/assists have smaller impact, and a hidden MMR-to-visible-rank convergence adjustment changes gains/losses. The hidden MMR and its formula are not available to MoeTracker, so the app must never estimate or label anything “MMR.” [Riot: How RR is calculated](https://support.riotgames.com/en-us/valorant/gameplay/how-rank-rating-rr-is-calculated)
- **Riot match performance:** as of patch 13.06, Riot replaced ACS in several modes with a 0–500 Performance Score. Riot lists damage, context-adjusted kills/deaths, trades, assists, agent-normalized utility, plants and defuses, in decreasing impact order, and explicitly says it does **not** affect RR. The exact weights are unpublished. Historical ACS is a damage/kill/multikill/non-damaging-assist combat summary, not a complete team-value measure. Store Performance Score as a distinct field/version from legacy ACS and never merge their time series. Do not reverse-label MoeTracker’s score as either. [Riot Performance Score](https://support.riotgames.com/en-us/valorant/gameplay/performance-score), [patch 13.06](https://playvalorant.com/en-gb/news/game-updates/valorant-patch-notes-13-06/)
- **Tracker Score:** Tracker Network describes a population-relative 0–1,000 composite of win rate, KAST, ACS and damage delta/round, but publishes neither weights nor reference population/window. It says this is not MMR/rank, and it cannot be reproduced exactly. [Tracker methodology](https://tracker.gg/valorant/articles/tracker-score-our-new-performance-rating)
- **VLR:** VLR publishes structure, not coefficients. Its original rating used context-weighted kills/deaths, APR, adjusted ADR and survival; Rating 2.0 reduced trade/assist effects, removed survival, and centered near 1.0. Copying its scale would falsely imply equivalence. [VLR explainer](https://www.vlr.gg/160667/vlr-gg-player-rating-explained), [2.0 update](https://www.vlr.gg/381456/vlr-rating-2-0-update/)

## Recommended local score: `Moe Performance Rating v1`

**Policy gate:** Riot’s VALORANT developer policy prohibits products that create alternatives to official skill-ranking systems such as MMR/ELO. Calling a composite “performance” rather than “skill” does not automatically make a private retrospective coach metric acceptable. Confirm the product’s registration/API-policy applicability and obtain any required Riot approval before implementation or release; if not confirmed, ship descriptive component statistics and self-trends only. [Riot Developer Portal policy](https://developer.riotgames.com/docs/valorant)

Use only imported facts; make settings visible/exportable. Compute per-round rates first, never averages of match ratios. The equation, weights, caps and thresholds below are **uncalibrated, unvalidated design candidates—not release-ready**. Given a later validated baseline, calculate `(player rate − peer median) / peer MAD`, cap to `[-3, 3]`, then:

`MPR = clamp(0, 2, 1.00 + 0.15 × Σ(weight × signed z) / Σ(available weight))`

Proposed coach-editable starting weights (not validated defaults):

| Metric | Weight | Direction |
|---|---:|---:|
| Kills/round (KPR) | 25 | + |
| Deaths/round (DPR) | 20 | − |
| Assists/round (APR) | 10 | + |
| ADR | 15 | + |
| KAST | 15 | + |
| First kills/round (FKPR) | 10 | + |
| First deaths/round (FDPR) | 5 | − |

Do not add K/D alongside KPR/DPR: it double-counts events. Do not score HS%. Display plants/defuses as role/opportunity context; an optional objective weight should be capped at 5%. Keep win rate in team/map reporting.

Store `formulaVersion`, weights, available metrics, baseline ID, match IDs, computed time, rounds, maps and mode. Weight changes create a new version; never silently rewrite old series.

### Conditioning and bias control

KAST, ADR, FK/FD and assists are role-sensitive; assist credit changes by agent/patch and plants reflect assignment. A future corpus could fall back from **mode + patch + map + agent** to map + role, role, then mode-wide, shrinking narrow groups toward their parent. The proposed 300 peer-round threshold is unvalidated.

A private five-player roster cannot supply stable peer medians, dispersion or role/agent norms. Until MoeTracker has a sufficiently broad, lawful and representative reference corpus, show raw per-round rates, roster-relative descriptive comparisons and player-versus-own-baseline trends; mark normalized MPR **unrated**. If a selected peer baseline is absent, too small under the eventual validated policy, or has `MAD = 0`, do not divide, substitute another scale silently, or assign 1.0: return **unrated** and identify the missing baseline. Keep ranked, Premier/scrim, and other queues separate and never pool them.

## Coverage, uncertainty and the present sample

Missing metrics are `null`, never zero/average. Coverage is `available weight / total weight`; show it and compare no leaderboards across coverage profiles. Candidate labels (`<100` provisional, `100–299` low, `300–999` developing, `≥1,000` established rounds) are unvalidated UX proposals.

With enough independent matches, bootstrap whole maps, not rounds; establish minimum counts by simulation. Otherwise show **interval unavailable**. Wilson intervals apply only to bounded binary proportions (for example KAST), never count rates such as KPR/APR. Show map/round counts and role/agent mix.

The current replay sample (165 kills across 22 rounds) can derive KPR and, if the event reconstruction is complete, FKPR/FDPR. The screenshot path supplies K/D/A, first bloods, plants and defuses, but not ACS/Performance Score, ADR, HS%, KAST or necessarily first deaths. It therefore supports only a **partial, provisional** MPR; do not synthesize missing values or compare it with full-event imports.

## Refresh and trend automation

After import: validate/deduplicate match ID, classify mode, update aggregates, recompute eligible baselines/MPR versions, then refresh caches. Key caches by dataset hash + formula version. Preserve only structured evidence needed for reproducibility/provenance; do not retain or expose unnecessary raw enemy personal data.

Trend views may descriptively compare a rolling last 5 and 10 maps against the player’s prior 20-map or season baseline, within the same mode and preferably the same role/map mix. Report deltas and uncertainty without automatic “signal” claims. The 5- and 10-map windows overlap and therefore are not independent confirmation; repeated-window direction or non-overlapping intervals alone is not a validated change test. Never infer causation from a short run.

## Current implementation hazards

- `lib/seed.ts:147` creates example ratings on a 6.4-7.2 scale, while `AITacticalHub.tsx:228` awards its highest grade at 1.25. `lib/routes/integrations.ts:233` also imports an external rating without a source/formula identifier. These scales cannot safely share a column or leaderboard; tag legacy/demo rows and keep them out of validated ratings until explicitly migrated.
- `Dashboard.tsx:130` turns a missing rating into `1.0`, manufacturing average performance; keep it `null` and exclude it from averages.
- `AITacticalHub.tsx:199–203` mixes saved ratings, K/D fallback and `1.0` in one agent average; these are incompatible measures and should be replaced by one versioned MPR result or “unrated.”
- `settings.weights` in `MapBestStats.tsx:135+` configures **map** scoring. Add a separate `settings.playerRating` object (`version`, weights, thresholds, baseline policy); never reuse map weights.

## Open uncertainties

MoeTracker cannot recover Riot hidden MMR, proprietary coefficients, unrecorded utility/trade context, opponent strength, comms/IGL value, spacing or decision quality from these inputs. Patch changes can shift assist and agent baselines. No MPR formula or threshold in this note is validated or ready for release. Acquire an appropriate reference corpus, define privacy/retention boundaries, and validate calibration, repeatability, role parity, missingness behavior and sensitivity before enabling grades or roster decisions; retain the component panel so coaches can disagree with the composite intelligently.
