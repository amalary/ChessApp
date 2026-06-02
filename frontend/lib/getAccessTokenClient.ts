// frontend/lib/getAccessTokenClient.ts
type GetAccessTokenClientOptions = {
  suppressMissingSessionLog?: boolean;
};

function isMissingSessionPayload(text: string): boolean {
  if (!text) {
    return false;
  }
  const lowered = text.toLowerCase();
  return lowered.includes("missing_session") || lowered.includes("active session");
}

export async function getAccessTokenClient(
  options?: GetAccessTokenClientOptions,
): Promise<string | null> {
  const res = await fetch("/auth/access-token", {
    method: "GET",
    credentials: "include", // send cookies
  });

  if (!res.ok) {
    const responseText = await res.text();
    const suppressMissingSession =
      options?.suppressMissingSessionLog === true &&
      isMissingSessionPayload(responseText);
    if (!suppressMissingSession) {
      console.error("Failed to get access token", responseText);
    }
    return null;
  }

  const data = (await res.json()) as {
    token?: unknown;
    accessToken?: unknown;
  };

  if (typeof data.token === 'string' && data.token.trim()) {
    return data.token;
  }

  if (typeof data.accessToken === 'string' && data.accessToken.trim()) {
    return data.accessToken;
  }

  return null;
}

