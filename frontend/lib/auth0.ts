// frontend/lib/auth0.ts
import { Auth0Client } from '@auth0/nextjs-auth0/server';

const requireEnv = (key: string): string => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required Auth0 environment variable "${key}"`);
  }
  return value;
};

const domain =
  process.env.AUTH0_DOMAIN ??
  process.env.AUTH0_ISSUER_BASE_URL ??
  (() => {
    throw new Error('Set AUTH0_DOMAIN or AUTH0_ISSUER_BASE_URL');
  })();

const appBaseUrl =
  process.env.APP_BASE_URL ??
  process.env.AUTH0_BASE_URL ??
  (() => {
    throw new Error('Set APP_BASE_URL or AUTH0_BASE_URL');
  })();

export const auth0 = new Auth0Client({
  domain,
  clientId: requireEnv('AUTH0_CLIENT_ID'),
  clientSecret: requireEnv('AUTH0_CLIENT_SECRET'),
  appBaseUrl,
  secret: requireEnv('AUTH0_SECRET'),
  authorizationParameters: {
    audience: process.env.AUTH0_AUDIENCE,
    scope: 'openid profile email'
  }
});
