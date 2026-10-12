# Historical lineup context

New manual and LiveLogger matches require a coach-selected lineup context. Confirmed statistic rows store a stable player ID, the display name at save time, and whether the appearance was core, tryout, or stand-in. A stand-in is a known player identity and does not gain core membership. Promotions and later membership changes do not rewrite saved appearances.

Existing records and OCR/scrim imports without confirmed identity evidence are saved as `unclassified`; the application never guesses their historical membership from the current roster. A coach can open one of those matches and explicitly assign identities, appearance types, and context.

Read-only analytics use one shared history filter. By default it hides pure tryout matches linked to archived batches and hides only the tryout rows from archived mixed-lineup matches. Core, stand-in, mixed-match, and unclassified history remains visible, and no source record is deleted. The helper also supports explicit core, tryout, stand-in, and unclassified views; dedicated filter controls are not yet exposed in every analytics screen.
