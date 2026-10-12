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

This file records the original slice 1 boundary. Historical lineup context was added in the subsequent slice described in `LINEUP-CONTEXT.md`; unresolved legacy/import rows intentionally remain unclassified. Archiving never deletes match statistics.

The unsafe empty-stat save path was resolved before lineup context landed. Dedicated core/tryout/stand-in filter controls are not yet exposed in every analytics screen; all screens share the safe default described in `LINEUP-CONTEXT.md`.
