// frontend/lib/auth0.ts
import { Auth0Client } from '@auth0/nextjs-auth0/server';

// When this is "1", we don't hard-fail if env vars are missing.
// Used only during Docker build.
const ALLOW_MISSING_ENV = process.env.SKIP_AUTH0_VALIDATION === '1';

const requireEnv = (key: string, fallback?: string): string => {
  const value = process.env[key];
  if (value) return value;

  if (ALLOW_MISSING_ENV) {
    // During build, return a harmless placeholder so Next can compile.
    return fallback ?? `__MISSING_${key}__`;
  }

  throw new Error(`Missing required Auth0 environment variable "${key}"`);
};

const getDomain = (): string => {
  const domain = process.env.AUTH0_DOMAIN ?? process.env.AUTH0_ISSUER_BASE_URL;
  if (domain) return domain;

  if (ALLOW_MISSING_ENV) {
    // Placeholder domain used only at build time.
    return 'example.auth0.com';
  }

  throw new Error('Set AUTH0_DOMAIN or AUTH0_ISSUER_BASE_URL');
};

const getAppBaseUrl = (): string => {
  const appBaseUrl = process.env.APP_BASE_URL ?? process.env.AUTH0_BASE_URL;
  if (appBaseUrl) return appBaseUrl;

  if (ALLOW_MISSING_ENV) {
    // Safe default for build-only.
    return 'http://localhost:3000';
  }

  throw new Error('Set APP_BASE_URL or AUTH0_BASE_URL');
};

export const auth0 = new Auth0Client({
  domain: getDomain(),
  clientId: requireEnv('AUTH0_CLIENT_ID'),
  clientSecret: requireEnv('AUTH0_CLIENT_SECRET'),
  appBaseUrl: getAppBaseUrl(),
  secret: requireEnv('AUTH0_SECRET'),
  authorizationParameters: {
    audience: process.env.AUTH0_AUDIENCE,
    scope: 'openid profile email',
  },
});
