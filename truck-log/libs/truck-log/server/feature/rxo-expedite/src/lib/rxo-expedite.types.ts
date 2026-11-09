/** Input accepted by the Expedite credential control endpoint. */
export type CredentialInput = {
  username?: unknown;
  password?: unknown;
};

/** Input accepted by the Expedite scheduler settings endpoint. */
export type ExpediteSettingsInput = {
  intervalMinutes?: unknown;
  syncOnStart?: unknown;
};
