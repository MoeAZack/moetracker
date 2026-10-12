# MoeTracker automated delivery contract

Owner-authorized 2026-10-12, Africa/Cairo. Scope: docs/ROADMAP.md and its nine staged implementation milestones; consent-based ranked tracking and transparent rating research are included.

## Model roles and cost discipline

- Sol (`gpt-5.6-sol`, available in this task): medium reasoning for research, implementation and targeted tests; high only for genuinely difficult parser/storage/debugging work. Use concise fresh-context handoffs, not the entire conversation.
- Astra (`gpt-6-astra`): independent exact-head review of completed changes, security/data correctness/recovery gates and final acceptance. Do not repeat adequate Sol research or implement the same change in parallel.
- The coordinator cannot switch its own running model. It selects explicit models for supported delegated tasks. A heartbeat resumes this task using the task's configured model; the prompt routes substantive builds to Sol. Do not claim every token is Sol-priced or promise specific savings.
- At most two background agents, each with an independent bounded deliverable and disjoint write scope. One integration owner. Stop idle agents; no agent-only polling loops. Targeted tests while iterating, one full suite per final reviewed head.
- Keep updates short: meaningful completions, failures and owner-required decisions. Do not print secrets, raw match payloads or long logs. No repeated whole-internet scouting; refresh only a source relevant to the active ticket.

## Delivery loop

1. Read current GitHub/main, open PRs, CI and the latest handoff before acting. Preserve user changes. Check for running work so scheduled runs do not duplicate it.
2. Take the next ready milestone in order: release/recovery; archive/reset; honest entry; screenshot drafts; replay drafts; opponent history; coach dashboard; player experience; storage/usability/final validation. Pull storage changes forward only when prerequisites demand it. Ranked/rating features belong to the data/dashboard milestones, not an unrelated redesign.
3. Sol implements one bounded slice on a feature branch and reports exact SHA, changed files, targeted test evidence, limitations and next step. No unchecked production deployment.
4. Astra independently reviews that exact head. Findings return to Sol; re-review only affected areas. Any head change invalidates the old acceptance for changed code. CI and review are both necessary, neither sufficient alone.
5. Before migrations/reset operations, verify a usable backup and restore path. Deploy a candidate without normal traffic, check role boundaries and data integrity, then promote and verify both Cloud Run/Firebase addresses. Record the release, safe rollback target and open limitations.
6. Advance the roadmap and concise status promptly. Do not claim completion from code, a mock, a configured key, a parse-success message or green CI without relevant acceptance evidence.

## Boundaries and external gates

- Existing team data is disposable, but do not reset it just to make implementation convenient. Roster reset is an explicit owner/coach action that archives first. Keep authentication and archived data protected.
- No new subscriptions, billing upgrades or paid APIs without an owner decision. Existing infrastructure usage is allowed but not guaranteed free.
- No game credentials/tokens, game-memory access, authentication bypass or unapproved scraping. Verify provider terms/eligibility and player consent before ranked data activation. Never upload private replay/screenshot content to public issues/repos or third-party services for convenience.
- Account onboarding, consent, unavailable permissions/credentials, new costs or materially broader features require user input. Continue non-conflicting ready work; do not repeatedly retry an unchanged blocked external gate.
- Owner/coach account access setup may require their interaction. No automation can bypass product-enforced confirmations.

## Resume pointers

- Repository: https://github.com/MoeAZack/moetracker
- Working clone currently `C:/Users/princ/AppData/Local/Temp/moetracker-work/repo`; temporary paths can disappear. Recover from GitHub into a writable task workspace if absent. Never rely solely on the temporary clone for roadmap/status.
- Security foundation PR #1 is merged; live Cloud Run revision at handoff `moetracker-00027-lof`, build `396d66c5fcb6b56927eeea3cc6719b3519bd4292`. Re-read live state before later deployment. Backup/export and release evidence are in PR #1's audit comment.
- Known release blocker: deploy-once workflow only triggers for its own file and publishes frontend before backend; old service-account deployment failed actAs. Design least-privilege/keyless delivery and a reviewed promotion gate before enabling automatic production pushes.
- Local replay lab is `../replay-lab`; vrfkit source `../vrfkit` at c4d6cc0. Sample validated 22 rounds,165 corroborated eliminations,13-9 and all10 firstblood totals. Not a production parser or broad accuracy proof; keep sample private. A sanitized summary is in this task's outputs/replay-validation.json.
- Current scoreboard attachment was 1839x821, not original1080p. Cropped local OCR recovered 30 FB/plant/defuse values; names/KDA still had errors. Editable review remains mandatory.
- Scout and rating reports are repository documents. Maintain a compact `docs/DELIVERY-STATUS.md` with active slice, branch/SHA, review, tests, actual deployment and next ready action.
