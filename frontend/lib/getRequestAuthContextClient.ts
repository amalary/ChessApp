import { readActiveLocalAuthUser } from "@/lib/dashboard-theme-settings";
import { getAccessTokenClient } from "./getAccessTokenClient";

type GetRequestAuthContextOptions = {
  includeJsonContentType?: boolean;
};

export type RequestAuthContext = {
  headers: HeadersInit;
  token: string | null;
  localAuthUserId: string | null;
  localAuthSessionToken: string | null;
  hasAnyAuth: boolean;
};

export async function getRequestAuthContextClient(
  options?: GetRequestAuthContextOptions,
): Promise<RequestAuthContext> {
  const headers: Record<string, string> = {};
  if (options?.includeJsonContentType) {
    headers["Content-Type"] = "application/json";
  }

  const token = await getAccessTokenClient({ suppressMissingSessionLog: true });
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const activeLocalAuthUser = readActiveLocalAuthUser();
  const localAuthUserId = activeLocalAuthUser?.id ?? null;
  const localAuthSessionToken = activeLocalAuthUser?.sessionToken ?? null;
  if (localAuthUserId) {
    headers["X-Local-Auth-User-Id"] = localAuthUserId;
  }
  if (localAuthSessionToken) {
    headers["X-Local-Auth-Session"] = localAuthSessionToken;
  }

  return {
    headers,
    token,
    localAuthUserId,
    localAuthSessionToken,
    hasAnyAuth: Boolean(token || (localAuthUserId && localAuthSessionToken)),
  };
}
