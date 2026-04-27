export const authConfig = {
  secret: process.env.SES_AUTH_SECRET || 'ses-dev-secret',
  assertProductionSecret(): void {
    if (process.env.NODE_ENV !== 'production') return;
    const s = process.env.SES_AUTH_SECRET;
    if (!s || s.length < 32) {
      throw new Error('SES_AUTH_SECRET must be a random string of at least 32 characters in production.');
    }
  },
} as const;
