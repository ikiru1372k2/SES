export const appConfig = {
  port: Number(process.env.PORT) || 3211,
  host: process.env.HOST?.trim() || '127.0.0.1',
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  isTest: process.env.NODE_ENV === 'test',
  corsOrigins: (process.env.SES_CORS_ORIGINS?.trim()
    ? process.env.SES_CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
    : ['http://127.0.0.1:3210', 'http://localhost:3210']),
  throttleLimit: () => (process.env.NODE_ENV === 'test' ? 10_000 : 400),
} as const;
