import type { NextApiRequest, NextApiResponse } from 'next';

const LEGACY_ROUTE_MAP: Record<string, string> = {
  login: '/auth/login',
  logout: '/auth/logout',
  callback: '/auth/callback',
  me: '/auth/profile',
  profile: '/auth/profile',
  'access-token': '/auth/access-token',
  'backchannel-logout': '/auth/backchannel-logout',
  connect: '/auth/connect'
};

export default function legacyAuthHandler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const segments = Array.isArray(req.query.auth0) ? req.query.auth0 : [];
  const action = segments[0]?.toLowerCase() ?? '';
  const targetPath = LEGACY_ROUTE_MAP[action];

  if (!targetPath) {
    res
      .status(404)
      .json({ error: `Unknown legacy auth route "${segments.join('/')}"` });
    return;
  }

  const hasQuery = typeof req.url === 'string' && req.url.includes('?');
  const query = hasQuery ? req.url!.substring(req.url!.indexOf('?')) : '';
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

  res.redirect(307, `${basePath}${targetPath}${query}`);
}
