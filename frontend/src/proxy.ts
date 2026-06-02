import { auth0 } from './lib/auth0';
import { NextResponse } from 'next/server';

// Next.js 16 proxy entrypoint that mounts the Auth0 SDK routes.
export async function proxy(request: Request) {
  const url = new URL(request.url);

  // Preserve backward compatibility for old links while keeping login in-app.
  if (url.pathname === '/auth/login') {
    const targetUrl = new URL('/api/auth/login', url);
    targetUrl.search = url.search;
    return NextResponse.redirect(targetUrl, 307);
  }

  return auth0.middleware(request);
}

export const config = {
  matcher: [
    // Skip static assets and metadata files to limit unnecessary session work.
    '/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)'
  ]
};
