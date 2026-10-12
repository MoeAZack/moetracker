# Local replay collector (Windows, review-first)

Status: implemented for local/test validation; **not deployed**. Replay parsing remains unavailable until a parser is independently validated against hand-checked rounds.

## What it does

- Scans `%LOCALAPPDATA%\VALORANT\Saved\Demos` plus coach/player-configured folders for `.vrf` files.
- Requires a file to remain unchanged across scans for at least 30 seconds and verifies it can be opened before hashing.
- Records SHA-256, size, observation state, approval, and upload receipt in a per-Windows-user local manifest.
- Defaults to dry-run/review-required. A person approves one hash with `approve`, or deliberately enables auto-upload for that device.
- Streams approved files to private server storage with a strict replay content type, declared size, server-side SHA-256 verification, quotas, timeout, temporary file, and atomic rename.
- Deduplicates by SHA-256. The status remains `parserStatus: unavailable` and `reviewStatus: review-required`; upload does not imply successful parsing or accepted match evidence.

It does **not** inspect game memory, read Riot credentials/tokens, capture the screen, scan unrelated folders, upload videos, or upload screenshots. Raw replay paths and bytes are never returned to players or public responses.

## Enrollment and ownership

1. Sign into MoeTracker normally.
2. Create a device through `POST /api/replay-intake/devices/enroll` with a safe device name. A player session can bind only to its own active roster player. A coach can bind a team device to a selected active player or to the coach identity.
3. The response shows one 256-bit device credential once. The server stores only its SHA-256 hash.
4. On the device, run:

   ```powershell
   .\scripts\install-replay-collector.ps1 -Server "https://your-private-moetracker" -DeviceId "SERVER_DEVICE_ID"
   ```

5. Paste the one-time credential when prompted. It is protected with Windows DPAPI for the current Windows user. The collector fails closed outside Windows; no plaintext fallback exists.

Devices expire after 90 days by default and can be revoked immediately. Players can list/revoke only their own devices; coaches can manage all devices. Revocation invalidates later uploads. Use HTTPS; plain HTTP is accepted only for localhost development.

## Daily use

```powershell
node .\scripts\replay-collector.mjs status
node .\scripts\replay-collector.mjs scan
node .\scripts\replay-collector.mjs approve --sha256 HASH_FROM_SCAN
node .\scripts\replay-collector.mjs watch
```

Add another replay folder or deliberately enable automatic upload:

```powershell
node .\scripts\replay-collector.mjs configure --add-path "D:\VALORANT-Replays"
node .\scripts\replay-collector.mjs configure --enable-auto-upload
```

Disable it with `configure --disable-auto-upload`. `watch` is a foreground process by default. A start-on-login shortcut may be added manually later; the installer does not create a service or persistence automatically and requires no administrator access.

Uninstall removes the DPAPI credential but preserves the local audit manifest unless requested:

```powershell
.\scripts\uninstall-replay-collector.ps1
.\scripts\uninstall-replay-collector.ps1 -RemoveLocalManifest
```

Revoke the device in MoeTracker too. Uninstalling locally cannot revoke a server credential by itself.

## Scoreboard and evidence contract

The primary scoreboard must come from replay summary/events **only after an accepted parser supplies those fields**. Until that gate passes, scoreboard, trades, clutches, utility, economy, objectives, and other signals remain unavailable rather than misleading zeroes.

Screenshots are an optional separate fallback. Configure one narrow folder and approve one image explicitly:

```powershell
node .\scripts\replay-collector.mjs configure --scoreboard-folder "D:\Approved-Scoreboards"
node .\scripts\replay-collector.mjs scoreboard-approve --file "D:\Approved-Scoreboards\match.png" --replay-sha256 REPLAY_HASH_FROM_SCAN
```

This only queues the image for MoeTracker's existing local OCR review flow and associates that local evidence with the exact replay hash. It does not run screen capture or upload the image. OCR output remains an editable draft and requires explicit human review before save.

## Server controls

- `REPLAY_STORAGE_DIR`: private directory outside static/frontend assets (defaults beside `DB_PATH` under `private-replays`).
- `REPLAY_MAX_BYTES`: maximum replay bytes (default 2 GiB).
- `REPLAY_UPLOAD_TIMEOUT_MS`: streaming deadline (default 10 minutes).
- `REPLAY_DAILY_BYTES`: per-device daily bytes (default 8 GiB).
- `REPLAY_DAILY_FILES`: per-device daily file count (default 30).
- `REPLAY_DEVICE_TTL_MS`: credential lifetime (default 90 days).

Only metadata is stored in the tracker database. Parser-normalized evidence may enter the existing replay adapter only after local parser validation; it always enters as `review-required` and is never auto-accepted.
