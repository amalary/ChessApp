// frontend/lib/getAccessTokenClient.ts
export async function getAccessTokenClient(): Promise<string | null> {
  const res = await fetch("/auth/access-token", {
    method: "GET",
    credentials: "include", // send cookies
  });

  if (!res.ok) {
    console.error("Failed to get access token", await res.text());
    return null;
  }

  const data = await res.json();
  return data.accessToken ?? null;
}

