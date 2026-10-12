# Private vrfkit replay parser

Status: implemented and locally validated; **not deployed and off by default**.

MoeTracker accepts only the independently configured Windows x64 release of [vrfkit](https://github.com/yakisoba0728/vrfkit) pinned below:

- tag: `v0.2.5`
- source commit: `c4d6cc0e5ec3904fdb64b350b2656b8e3ff33d53`
- release ZIP SHA-256: `2cf8375191f7de8b8199f84a69e91a02e5e4d5b541c242e466c9d9aa24ef7494`
- packaged `vrfkit.exe` SHA-256: `aa55fc410f1596a6ffedc7ab579341da6edb262197c64902e74b4eed485dc23f`
- license: Apache-2.0

The server re-hashes the executable before every job. A mismatched executable is never run.

## Gated installation

1. Download `vrfkit-v0.2.5-windows-x64.zip` and its `.zip.sha256` only from the official GitHub `v0.2.5` release. MoeTracker does not download or update parser binaries.
2. Before extraction, run `Get-FileHash -Algorithm SHA256` on the ZIP and require the exact ZIP digest above. Also compare the official checksum-file text. Stop on any mismatch.
3. Extract to a private, administrator-controlled tools directory. Require only `vrfkit.exe`, `build-info.json`, `LICENSE`, and `NOTICE.md`.
4. Hash `vrfkit.exe` and require the exact executable digest above. Inspect `build-info.json` and require the exact tag, commit, executable digest, and `x86_64-pc-windows-msvc` target above.
5. Provide a separately managed Python environment with `pyarrow` available. Pin the wheel version and hash in the deployment's dependency lock; install from that lock with hash verification. Do not let the web process install packages.
6. Set absolute `VRFKIT_BINARY_PATH` and `VRFKIT_PYTHON_PATH` values. Keep `VRFKIT_JOBS_DIR` unset or make it a private child of `REPLAY_STORAGE_DIR`. Restart and use a coach session to start one bounded validation job.

The release is independent community software, not Riot-endorsed. Keep its `LICENSE` and `NOTICE.md` with the binary.

## Job flow and security boundary

1. An enrolled device uploads and SHA-256-verifies a `.vrf` into private hash-addressed storage. Nothing parses automatically.
2. A coach deliberately calls `POST /api/replay-intake/uploads/:sha256/parse`.
3. The server re-hashes both the private replay and pinned executable, creates a fresh private job directory, and launches vrfkit without a command shell.
4. `vrfkit export ... --checkpoints` receives only a minimal OS environment allowlist (never server secrets) and is bounded by wall time, output bytes, file count, filesystem containment, and symlink/reparse rejection. Timeout and limit failures terminate the whole process tree and wait for confirmed exit. Standard output/error are bounded and never returned as raw diagnostics.
5. The local normalizer reads only the new export. It writes one bounded JSON result with replay, binary, commit, manifest, and output-size provenance.
6. The existing replay evidence engine derives openings, trades, clutch candidates, and objective evidence only when complete identity/team/timeline capabilities and an independent trusted `manifest.players` roster mapping are present. Every result is non-writable and `review-required`.
7. Raw exports and the intermediate normalized file are deleted after every success or failure. Only bounded normalized/provenance/status evidence remains. The scheduler defaults to one parser process, eight queued jobs, two active jobs per coach/device, and deterministic 30-day/100-job terminal retention.

The status/result endpoint is `GET /api/replay-intake/uploads/:sha256/parser`. Coaches can see all private replay jobs. A player can see only a replay associated with that player's own enrolled device identity. API responses never include raw paths, account UUIDs, source filenames from other devices, or parser stdout.

## Evidence contract

Supported when the corresponding replay evidence is complete:

- map asset path and reviewed friendly-name mapping;
- final team score from typed `RoundResults` winner rows;
- player K/D/A from final `BasicCombatStatsComponent` aggregates;
- first blood/death and the round event timeline from cross-checked `characterDeath` events;
- plants and defuses from authoritative objective events cross-checked to typed RPC player references;
- trades and clutch candidates derived by the review engine from complete life-state event order.

Missing fields are `{ value: null, status: "unavailable" }`. Zero appears only when the complete evidence stream proves no event occurred for that player. The replay does not expose a verified player display-name field: `ProfileName` contains crosshair/profile labels, so player names remain unavailable and identities are replay-scoped pseudonyms until a coach reviews an independent roster/screenshot mapping.

## Real replay validation (private, 12 Oct 2026 Cairo)

The pinned executable and full runner were exercised against the owner's original replay in place; the raw replay was not copied, uploaded, or committed. Private screenshot comparison confirmed:

- Haven, 22 played rounds, score 9–13;
- ten complete K/D/A rows totaling 165 kills and 165 deaths;
- 22 first-blood events, 18 plants, and 7 defuses;
- all 22 opening events resolved; downstream output remained non-writable and review-required.

The replay manifest duration is not silently replaced with the post-game UI duration; any difference stays visible for review. Player-name mapping remains the only scoreboard field unavailable from replay evidence itself.
