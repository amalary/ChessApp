// pages/api/profile.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { auth0 } from "../../lib/auth0";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await auth0.getSession();

  if (!session) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  return res.status(200).json({ user: session.user });
}
