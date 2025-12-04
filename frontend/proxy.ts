import { auth0 } from './lib/auth0';

// Next.js 16 proxy entrypoint that mounts the Auth0 SDK routes.
export async function proxy(request: Request) {
  return auth0.middleware(request);
}

export const config = {
  matcher: [
    // Skip static assets and metadata files to limit unnecessary session work.
    '/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)'
  ]
};

