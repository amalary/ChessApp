import { Auth0Client } from '@auth0/nextjs-auth0/server';
import { NextResponse } from 'next/server';

// Next sets this phase while running `next build`.
const IS_NEXT_PRODUCTION_BUILD =
  process.env.NEXT_PHASE === 'phase-production-build';

// When this is "1", or while Next is collecting build-time page data,
// we don't hard-fail if Auth0 env vars are missing.
const ALLOW_MISSING_ENV =
  process.env.SKIP_AUTH0_VALIDATION === '1' || IS_NEXT_PRODUCTION_BUILD;

const cleanEnvValue = (value: string): string =>
  value.trim().replace(/\s+#.*$/, '').trim();

const requireEnv = (key: string, fallback?: string): string => {
  const value = process.env[key];
  if (value) return cleanEnvValue(value);

  if (ALLOW_MISSING_ENV) {
    // During build, return a harmless placeholder so Next can compile.
    return fallback ?? `__MISSING_${key}__`;
  }

  throw new Error(`Missing required Auth0 environment variable "${key}"`);
};

const normalizeAuthDomain = (value: string): string => {
  const cleaned = cleanEnvValue(value);
  if (!cleaned) return cleaned;

  const withProtocol = cleaned.includes('://') ? cleaned : `https://${cleaned}`;
  const parsed = new URL(withProtocol);
  return parsed.host;
};

const normalizeAppBaseUrl = (value: string): string => {
  const cleaned = cleanEnvValue(value);
  if (!cleaned) return cleaned;

  const withProtocol = cleaned.includes('://') ? cleaned : `http://${cleaned}`;
  const parsed = new URL(withProtocol);
  return parsed.origin;
};

const getDomain = (): string => {
  const domain = process.env.AUTH0_DOMAIN ?? process.env.AUTH0_ISSUER_BASE_URL;
  if (domain) return normalizeAuthDomain(domain);

  if (ALLOW_MISSING_ENV) {
    // Placeholder domain used only at build time.
    return 'example.auth0.com';
  }

  throw new Error('Set AUTH0_DOMAIN or AUTH0_ISSUER_BASE_URL');
};

const getAppBaseUrl = (): string => {
  const appBaseUrl = process.env.APP_BASE_URL ?? process.env.AUTH0_BASE_URL;
  if (appBaseUrl) return normalizeAppBaseUrl(appBaseUrl);

  if (ALLOW_MISSING_ENV) {
    // Safe default for build-only.
    return 'http://localhost:3000';
  }

  throw new Error('Set APP_BASE_URL or AUTH0_BASE_URL');
};

const secret = requireEnv('AUTH0_SECRET');
if (!ALLOW_MISSING_ENV && !/^[0-9a-fA-F]{64}$/.test(secret)) {
  throw new Error(
    'AUTH0_SECRET must be a 64-character hex string (openssl rand -hex 32).'
  );
}

const appBaseUrl = getAppBaseUrl();

export const auth0 = new Auth0Client({
  domain: getDomain(),
  clientId: requireEnv('AUTH0_CLIENT_ID'),
  clientSecret: requireEnv('AUTH0_CLIENT_SECRET'),
  appBaseUrl,
  secret,
  session: {
    cookie: {
      // Keep cookie persistent across browser refresh/restarts.
      transient: false,
      sameSite: 'lax',
      secure: appBaseUrl.startsWith('https://'),
    },
  },
  onCallback: async (error, ctx) => {
    if (error) {
      const url = new URL('/login-test', appBaseUrl);
      url.searchParams.set('auth_error', 'callback_failed');
      return NextResponse.redirect(url, 302);
    }

    return NextResponse.redirect(new URL(ctx.returnTo || '/', appBaseUrl), 302);
  },
  authorizationParameters: {
    audience: process.env.AUTH0_AUDIENCE,
    scope: 'openid profile email',
  },
});
