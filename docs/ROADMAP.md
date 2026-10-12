# MoeTracker team release contract

Owner decisions recorded 2026-10-12 (Africa/Cairo).

## Product and authority

- One private VALORANT team. Owner and coach have full editing, management and analysis access.
- Players may see team/player performance, results, schedules and goals through a simpler read-only experience; replies/comments remain permitted. Authentication records and integrations are never player-visible.
- Both owner and coach record matches. Manual entry is always available. A 1920x1080 scoreboard should populate a reviewable draft; users complete missing fields before saving.
- The daily review compares performance by player, agent, map and time period. Show sample size and unknown/missing data. Do not confuse different agents/maps or small samples with genuine improvement.
- Owner addition, 2026-10-12: retain lightweight opponent-team history so repeated meetings can be compared. Store a stable opponent ID, coach-confirmed team name/aliases, match date/type, map, final score, side splits and team-level opening-duel totals where supported. Keep our detailed player performance linked to each meeting; do not create detailed enemy-player profiles or retain their account IDs, individual stat histories or raw replay payloads by default.
- Prefer approved Google sign-in. Keep high-entropy access keys as a fallback until the owner/coach onboarding is proven.
- Latest owner clarification, 2026-10-12: the app is not in use; current development data and state may be reset/replaced during this build without further approval. Prior current-state preservation requirements are superseded. The future roster-reset feature must still archive the old season/roster first, then start a fresh active dataset; returning players' archived history must not mix into current-roster metrics automatically.
- Prefer free tooling and existing infrastructure. No new subscriptions, billing upgrades or paid providers without an explicit owner decision. Existing cloud usage is not guaranteed to cost zero.
- Owner authorizes implementation, bounded tests, independent review, GitHub integration and deployment within this roadmap. Use a branch/PR and passing checks; simplify development migrations/recovery because current state is disposable. Backup/restore guarantees remain required product features before real usage. Never print credentials. Ask only for required product choices, account onboarding, unavailable input files or new costs.
- Owner authorization, 2026-10-12: automate the nine implementation milestones using Sol for building/research and Astra for independent audit before release. Include a bounded tracker/open-source landscape survey, consent-based automatic ranked tracking where approved access is available, and transparent automatic player performance ratings. See `AUTONOMY.md`; research proposals do not silently expand the build queue. Never represent this as an exhaustive internet inventory or a promise of zero usage cost.

## NOW — production security and recovery

1. Ship repository security fixes that never reached Cloud Run. Player responses must omit authKeys, allowedUsers, secretValues and credential-valued settings. Every write requires the appropriate role.
2. Require expiring signed sessions; exchange fallback keys at login only. New keys contain at least 128 random bits. Prefer Google sign-in and invalidate legacy credentials safely.
3. Separate server artifacts from the static directory. Both old server-file URLs must return 404. Expose a nonsecret build SHA through health.
4. Preserve corrupted databases, reject stale writes and preserve failed-save drafts.
5. Release gates: typecheck, lint, meaningful HTTP role/redaction/revocation tests, store tests, build, dependency audit, independent review, candidate smoke test, production verification and recorded rollback revision.
6. Repair and automate release promotion without exposing service-account keys. A failed backend build must not publish a newer frontend. Verify backups use the existing durable bucket.

## NEXT — accurate entry and coach review

### Durable owner-priority engine queue (updated 2026-10-12)

1. Coach analytics calculation engine, then a separately reviewed UI connection.
2. Replay draft and first-kill/first-death evidence engine.
3. Transparent player-rating formula in shadow mode only.
4. Consent- and provider-gated ranked sync.
5. Opponent history after those four engines.

Build note, 2026-10-12: milestone 3 now has a domain-only implementation on
`codex/shadow-player-rating`, pending exact-head independent review. Its output is
strictly shadow/advisory, never a rank, hidden-MMR estimate, map-ranking score or
selection authority. No UI, persistence, network or deployment work is included.

Build note, 2026-10-12: milestone 4 now has a provider-neutral domain implementation
on `codex/ranked-sync-infrastructure`, pending exact-head independent review. It
plans nothing until explicit versioned player consent, exact account identity and
approved/configured documented provider capability are all present. It adds pure
incremental, retry, reconciliation, status, Cairo-bucket and retention contracts;
no provider adapter, network, persistence, route, UI, deployment or provider
eligibility claim is included. Manual entry remains available. **LIVE RELEASE DEFERRED.**

Keep storage migration, accessibility and integration truthfulness requirements in the release register below, but they do not reorder this engine queue unless they become a demonstrated prerequisite. UI redesign, live deployment, formula calibration and any authoritative rating use remain outside the current shadow calculation-engine slice.

### First: core, tryouts and stand-ins (owner approved)

- Separate core roster history, named tryout batches and temporary stand-in match appearances. Do not silently mix trial/stand-in results into core-only comparisons.
- Owner/coach can quickly archive and reset a tryout batch; preserve an identifiable archive and restoration path. Core history must not be reset by this action. Players cannot reset or manage rosters.
- Compare candidates, promote selected players into the core, and retain their trial history with its original context. Stand-in appearances do not automatically grant core membership.
- Keep stable player IDs and match-time lineup/context so later membership changes do not rewrite historical participation. Core names are not yet supplied; use configurable membership, not invented players.
- Acceptance covers isolated batch reset, archive/restore, core protection, role denial, promotion/history retention, stand-in appearances and context-filtered statistics. Current development data remains disposable.

1. Replace invented defaults with unknown values throughout manual/import workflows and calculators. Use typed schemas, validation, source and correction metadata. Repair VLR team mapping/idempotency or disable the importer until valid.
2. Free browser OCR using a pinned, locally served Tesseract.js worker/model. Screenshot remains local for this path. Detect layout, crop cells, match roster names, mark ambiguous values and preview all rows. Never silently save OCR results. Need a representative owner-supplied 1080p scoreboard for field mapping and acceptance accuracy.
3. Daily coach dashboard: date windows in Africa/Cairo; player x agent x map comparisons; team/map weaknesses; adequate-sample warnings; K/D, ACS and opening-duel metrics only when supported by source data. The engine must keep stable player IDs, agent, map, appearance, match-time roster context and tryout batch in its comparison keys; unknown values are excluded with per-metric denominators, never coerced to zero. Player UI is simpler and read-only.
4. Replace whole-array Firestore documents with entity documents, targeted queries and transactions. Migration requires backup, dry-run and restore proof. Add versioned backup/restore and archive-before-reset for roster changes.
5. Accessible forms/dialogs, labeled controls, keyboard operation and retryable save errors. Remove fake calendar sync and distinguish configured integrations from successful runs.
6. Opponent history: replace free-text-only opponent grouping with stable team records and selectable existing opponents. Offer coach-reviewed alias/duplicate merges; never infer team identity from a few overlapping players or silently merge similar names. Import previews explicitly confirm our side and the opponent, since scoreboards can mix both teams in one sorted list. Missing team identity stays unassigned until confirmed. Show meetings, map-level W/L and round differential, attack/defense trends, and our player/agent performance against that opponent. Compare equivalent maps/periods with sample counts and coverage. Retain a lightweight roster-change note when needed to avoid misleading comparisons; respect our active-roster/archive filter. Players may see opponent results in their simplified view; owner/coach get the detailed comparisons. Acceptance tests cover aliases, separate similarly named teams, mixed scoreboard rows, repeated imports, missing splits, and archived rosters.
7. Ranked tracking: separate consenting players' ranked match history from scrims, using an eligible documented data provider. Persist stable player/match IDs, region/platform, source and timestamps; poll incrementally within verified quotas, deduplicate, retry with backoff and display stale/partial sync instead of invented zeroes. Cairo-local daily summaries and DST tests are required. Google sign-in is not Riot consent. Existing Henrik integration is not proof of API eligibility or working credentials. Provider approval/onboarding is an external gate; manual entry remains available.
8. Player ratings: distinguish official Riot rank/RR from a custom MoeTracker performance score and from existing map-ranking weights. Use transparent, versioned deterministic formulas; owner/coach can preview weight changes, see metric contributions and coverage, and recompute consistently when source data is corrected. Keep ranked/scrim and source/formula versions separate. Missing metrics never become average/zero ratings. Show role/agent/map context and sample sizes; do not claim to recover hidden MMR or proprietary third-party ratings. Validate the initial formula in shadow before treating it as a selection/coaching authority.

## NEXT — first kill / first death evidence prototype

- A normal scoreboard cannot establish hidden event order. Only extract FK/FD when explicitly displayed; otherwise leave unknown.
- Define an opening duel as the first qualifying opponent elimination in each played round. Killer gets FK and victim gets FD. Exclude duplicate, self/team, environmental and resurrection notifications; unresolved timestamp ties or missing early events stay unknown. Track coverage per round.
- Validate a pinned community .vrf replay parser in an isolated, resource-limited worker against a current owner-supplied custom replay and hand-counted ground truth. The custom-game host must enable recording before each game.
- Parser output is a draft. Cross-check identities, map, score, rounds and K/D; retain parser/version/provenance. Reject unsupported or incomplete files. No automatic ingestion release until policy/access and accuracy are validated.
- No game-memory access, credential/token scraping or undocumented authentication bypass. Riot API approval is not assumed; Google login is not Riot consent.

## LATER

- Durable distributed login throttling and documented trusted-proxy handling.
- Exact authenticated backup replacement semantics, restoration drills, observability and runtime cost controls.
- Optional Riot/GRID integrations only if eligible and useful. Windows live-event companion only if replay upload cannot meet needs.
- No multi-team SaaS, public registration or paid AI dependency in this release.

## Evidence and completion

For every milestone record commit, independent review, test results, deployed revision, smoke checks and open limitations in the PR/release record. A successful CI run is not deployment proof. Do not label a feature connected, accurate or complete without evidence.
