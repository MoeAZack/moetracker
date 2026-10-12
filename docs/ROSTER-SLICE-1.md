# Roster slice 1: identities and membership

This development slice adds stable player IDs, core-membership history, and named tryout candidate batches. A fresh installation starts with no invented core players. Owner/coach sessions can mutate the roster; player sessions remain read-only.

## Current behavior

- A player identity persists independently from core and tryout membership.
- Ending core membership closes the active membership record rather than deleting history.
- Promoting a candidate is idempotent, records the source tryout batch, and leaves the player in that batch for trial context.
- Archiving and resetting a batch is one database write: the original batch and its candidate IDs are retained and a new empty batch is created.
- Restoring an archived batch reactivates that same batch ID and candidate list when its name does not conflict with an active batch.
- `settings.players` is now a server-maintained list of active core display names. Existing name-based match selectors read this compatibility projection; the legacy settings editor can no longer write a competing player list.

## Explicit boundary and slice 2

Matches and `playerStats` are still keyed by player names. Slice 1 does **not** attach a roster/batch context to a match, represent stand-in appearances, filter history by tryout batch, or archive/reset/delete match statistics. The roster screen labels that boundary next to the batch action.

Slice 2 must add a match roster context plus stable `playerId`, display-name snapshot, and appearance type to saved player statistics, then update match entry/imports and historical views. It must also resolve the existing save path where `LiveLogger` can call `onSaveMatch(updatedMatch, [])`: the server currently treats that empty list as the complete replacement and removes the match's stored player-stat rows. That behavior must be fixed and regression-tested before context-aware match history or stand-ins are claimed complete.
