// frontend/lib/auth0.ts
import { Auth0Client } from '@auth0/nextjs-auth0/server';

// When this is "1", we don't hard-fail if env vars are missing.
// We'll use this ONLY during Docker build.
const ALLOW_MISSING_ENV = process.env.SKIP_AUTH0_VALIDATION === '1';

const safeEnv = (key: string, fallback?: string): string => {
  const value = process.env[key];
  if (value) return value;

  if (ALLOW_MISSING_ENV) {
    // During build, return a harmless placeholder so Next can compile.
    return fallback ?? `__MISSING_${key}__`;
  }

  throw new Error(`Missing required Auth0 environment variable "${key}"`);
};

const safeDomain = (): string => {
  const domain = process.env.AUTH0_DOMAIN ?? process.env.AUTH0_ISSUER_BASE_URL;
  if (domain) return domain;

  if (ALLOW_MISSING_ENV) {
    // Placeholder domain used only at build time.
    return 'example.auth0.com';
  }

  throw new Error('Set AUTH0_DOMAIN or AUTH0_ISSUER_BASE_URL');
};

const safeAppBaseUrl = (): string => {
  const appBaseUrl = process.env.APP_BASE_URL ?? process.env.AUTH0_BASE_URL;
  if (appBaseUrl) return appBaseUrl;

  if (ALLOW_MISSING_ENV) {
    return 'http://localhost:3000';
  }

  throw new Error('Set APP_BASE_URL or AUTH0_BASE_URL');
};

export const auth0 = new Auth0Client({
  domain: safeDomain(),
  clientId: safeEnv('AUTH0_CLIENT_ID'),
  clientSecret: safeEnv('AUTH0_CLIENT_SECRET'),
  appBaseUrl: safeAppBaseUrl(),
  secret: safeEnv('AUTH0_SECRET'),
  authorizationParameters: {
    audience: process.env.AUTH0_AUDIENCE,
    scope: 'openid profile email',
  },
});
