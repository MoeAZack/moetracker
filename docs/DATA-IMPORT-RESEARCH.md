# Scoreboard and opening-duel ingestion

Researched 2026-10-12. Implementation priority: manual entry -> screenshot draft -> validated replay draft.

## Screenshot

[Tesseract.js](https://github.com/naptha/tesseract.js) runs OCR in a browser using WebAssembly. It can avoid a paid vision API. A 1080p image is an input target, not an accuracy guarantee. Extract only visible columns; retain unknown values and ask for corrections in a preview before saving. Use actual team screenshots to validate layout/roster matching. Do not infer ADR, HS%, first death or per-round order when not visible.

## Replay

[Riot patch 12.10](https://playvalorant.com/en-us/news/game-updates/valorant-patch-notes-12-10/) adds custom-game replays and requires the host to enable recording before each game. [Riot's overview](https://playvalorant.com/en-us/news/dev/replays-everything-you-need-to-know/) describes kill/death markers and player perspectives. Replay trackers reconstruct time-ordered game events; the first valid opponent kill in each round provides FK/FD.

Candidate parsers: [vrfkit](https://github.com/yakisoba0728/vrfkit) (Apache-2.0; [data documentation](https://github.com/yakisoba0728/vrfkit/blob/main/docs/DATA.md)) and [ValorantReplayParser](https://github.com/michel-giehl/ValorantReplayParser) (MIT, experimental). These are community projects, not evidence of Riot approval or verified accuracy. Pin a reviewed revision and sandbox execution. Validate against a real current custom replay; successful parsing alone is insufficient.

First kills are round openings, not each player's first personal kill. Handle duplicate/resurrection/non-opponent events and missing coverage. Cross-check scores, rounds and player totals. Preserve raw-source identity, parser version and coach corrections.

## Alternatives and limits

[Riot's VALORANT policy](https://developer.riotgames.com/docs/valorant#game-policy) does not support personal keys, lists private personal-use applications as unapproved use cases, and requires opt-in/RSO for identifiable stats. Production approval is not a launch assumption. Resolve applicability/consent before releasing automated replay ingestion. Do not scrape game credentials.

[Overwolf game events](https://dev.overwolf.com/ow-native/live-game-data-gep/supported-games/valorant/) offer kill feed and round data but require an installed companion and completeness checks; their documented custom-match end-event limitations and resurrection events need explicit handling.

[GRID access](https://grid.gg/get-access/) includes application-based noncommercial/team plans. Eligibility and coverage for this team's scrims are unverified. Neither GRID nor a paid vision service is a required dependency.
