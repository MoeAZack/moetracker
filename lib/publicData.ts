const PRIVATE_TOP_LEVEL_KEYS = new Set(['authKeys', 'allowedUsers', 'secretValues']);
const PRIVATE_SETTING_KEYS = new Set(['discordWebhook', 'gridApiKey', 'henrikApiKey']);

/** Build the tracker payload that is safe to send to authenticated browsers. */
export function toPublicTrackerData(db: Record<string, any>) {
  const publicData: Record<string, any> = {};
  for (const [key, value] of Object.entries(db)) {
    if (!PRIVATE_TOP_LEVEL_KEYS.has(key)) publicData[key] = value;
  }
  const settings = { ...(publicData.settings || {}) };
  for (const key of PRIVATE_SETTING_KEYS) delete settings[key];
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
