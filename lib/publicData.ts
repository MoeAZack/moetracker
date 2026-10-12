const PRIVATE_TOP_LEVEL_KEYS = new Set(['authKeys', 'allowedUsers', 'secretValues', '_storage']);
const PRIVATE_SETTING_KEYS = new Set(['discordWebhook', 'gridApiKey', 'henrikApiKey']);

/** Build the tracker payload that is safe to send to the authenticated role. */
export function toPublicTrackerData(db: Record<string, any>, role: 'coach' | 'player' = 'coach') {
  const publicData: Record<string, any> = {};
  for (const [key, value] of Object.entries(db)) {
    if (!PRIVATE_TOP_LEVEL_KEYS.has(key)) publicData[key] = value;
  }
  const settings = { ...(publicData.settings || {}) };
  // Replay intake contains device credentials, ownership links, raw parser evidence,
  // and mutable review overlays. Engine adapters contain private rating inputs and
  // replay observations. Both have dedicated role-aware endpoints and must never
  // hitchhike in the broad tracker payload, including for coaches.
  delete publicData.replayIntake;
  delete publicData.engineAdapters;
  if (Array.isArray(publicData.seasonArchives)) publicData.seasonArchives = publicData.seasonArchives.map((archive: any) => {
    const { accessIdentities: _privateAccessIdentities, engineAdapters: _privateEngineAdapters, replayIntake: _privateReplayIntake, ...safeArchive } = archive || {};
    return safeArchive;
  });
  for (const key of PRIVATE_SETTING_KEYS) delete settings[key];
  if (role === 'player') {
    delete settings.riotIds;
    // Full archive bodies contain private identifiers and historical coach/VOD
    // material. Players do not need archive data for any read-only view.
    publicData.seasonArchives = [];
    publicData.vodReviews = [];
  }
  publicData.settings = settings;
  publicData.secrets = {
    GEMINI_API_KEY: !!process.env.GEMINI_API_KEY,
    HENRIK_API_KEY: !!process.env.HENRIK_API_KEY,
    GRID_API_KEY: !!process.env.GRID_API_KEY,
    DISCORD_WEBHOOK_URL: !!process.env.DISCORD_WEBHOOK_URL
  };
  return publicData;
}

/** Remove credential fields from imported legacy backups before storage. */
export function stripLegacySecrets<T extends Record<string, any>>(input: T): T {
  const clean: Record<string, any> = { ...input };
  delete clean.authKeys;
  delete clean.secretValues;
  if (clean.settings) {
    clean.settings = { ...clean.settings };
    for (const key of PRIVATE_SETTING_KEYS) delete clean.settings[key];
  }
  return clean as T;
}
