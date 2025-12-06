"use client";

import React, { useState } from "react";

// Type for your backend response
// If you know the real shape, you can replace this with an interface
type SolveResponse = unknown;

export default function SolveTestPage() {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<SolveResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const chosen = e.target.files?.[0] ?? null;
    setFile(chosen);
    setResult(null);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setResult(null);

    if (!file) {
      setError("Please choose an image first.");
      return;
    }

    const backendUrl =
      process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://127.0.0.1:8000";

    const token = process.env.NEXT_PUBLIC_AUTH0_TEST_TOKEN;
    if (!token) {
      setError("Missing NEXT_PUBLIC_AUTH0_TEST_TOKEN in .env.local");
      return;
    }

    const formData = new FormData();
    formData.append("image", file);

    setLoading(true);

    try {
      const res = await fetch(`${backendUrl}/solve`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      const data: SolveResponse = await res.json();

      if (!res.ok) {
        let msg = `Error ${res.status}`;

        // Safely inspect common error fields without using `any`
        if (typeof data === "object" && data !== null) {
          if (
            "detail" in data &&
            typeof (data as { detail?: unknown }).detail === "string"
          ) {
            msg = (data as { detail: string }).detail;
          } else if (
            "error" in data &&
            typeof (data as { error?: unknown }).error === "string"
          ) {
            msg = (data as { error: string }).error;
          }
        }

        setError(msg);
      } else {
        setResult(data);
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Network error";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="max-w-xl mx-auto p-4 space-y-4">
      <h1 className="text-2xl font-semibold">Test /solve Route</h1>

      <form onSubmit={handleSubmit} className="space-y-4">
        <label className="block">
          Upload image:
          <input
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            className="mt-2"
          />
        </label>

        <button
          type="submit"
          disabled={loading || !file}
          className="px-4 py-2 rounded bg-blue-600 text-white disabled:opacity-50"
        >
          {loading ? "Sending..." : "Send to /solve"}
        </button>
      </form>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {result !== null && (
        <pre className="mt-2 text-sm bg-gray-100 p-2 rounded">
          {typeof result === "string"
            ? result
            : JSON.stringify(result, null, 2)}
        </pre>
      )}
    </main>
  );
}
