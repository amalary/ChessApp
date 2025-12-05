import { AuthNav } from "components/AuthNav";

const HomePage = () => {
  return <AuthNav />;
};

export default HomePage; 

"use client";

import { FormEvent, useState } from "react";
import { getAccessTokenClient } from "lib/getAccessTokenClient";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8002";

export function SolveForm() {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setResult(null);

    if (!file) {
      setError("Please choose an image first");
      return;
    }

    setLoading(true);
    try {
      // 1) Get access token from /auth/access-token
      const accessToken = await getAccessTokenClient();
      if (!accessToken) {
        setError("You must be logged in to solve puzzles.");
        setLoading(false);
        return;
      }

      // 2) Build multipart/form-data for FastAPI
      const formData = new FormData();
      formData.append("image", file);

      // 3) Call FastAPI /solve with Authorization: Bearer <token>
      const resp = await fetch(`${BACKEND_URL}/solve`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        body: formData,
      });

      const data = await resp.json();

      if (!resp.ok) {
        setError(data.detail || "Backend error");
      } else {
        setResult(data);
      }
    } catch (err: any) {
      setError(err?.message || "Unexpected error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <input
        type="file"
        accept="image/*"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />

      <button
        type="submit"
        disabled={loading || !file}
        className="rounded-md border px-4 py-2"
      >
        {loading ? "Solving..." : "Solve puzzle"}
      </button>

      {error && <p className="text-red-500 text-sm">{error}</p>}
      {result && (
        <pre className="mt-4 text-xs bg-black/5 p-3 rounded">
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </form>
  );
}



