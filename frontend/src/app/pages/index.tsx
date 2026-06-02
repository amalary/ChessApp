"use client";

import { FormEvent, useState } from "react";
import { AuthNav } from "@/components/AuthNav";
import { getRequestAuthContextClient } from "lib/getRequestAuthContextClient";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8010";

type SolveResponse = unknown; // tighten later if you know the shape

const HomePage = () => {
  return (
    <>
      <AuthNav />
      <main className="max-w-xl mx-auto p-4 space-y-4">
        <h1 className="text-2xl font-semibold">Solve a chess puzzle</h1>
        <SolveForm />
      </main>
    </>
  );
};

export default HomePage;

export function SolveForm() {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<SolveResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setResult(null);

    if (!file) {
      setError("Please choose an image first");
      return;
    }

    setLoading(true);

    try {
      const auth = await getRequestAuthContextClient();
      if (!auth.hasAnyAuth) {
        setError("You must be logged in to solve puzzles.");
        return;
      }

      // 2) Build multipart/form-data for FastAPI
      const formData = new FormData();
      formData.append("image", file);

      const resp = await fetch(`${BACKEND_URL}/solve`, {
        method: "POST",
        headers: auth.headers,
        body: formData,
      });

      const data = await resp.json();

      if (!resp.ok) {
        setError(data.detail ?? "Backend error");
      } else {
        setResult(data);
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Unexpected error";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <input
          type="file"
          accept="image/*"
          onChange={(e) => {
            const chosenFile = e.target.files?.[0] ?? null;
            setFile(chosenFile);
          }}
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        className="px-4 py-2 rounded bg-blue-600 text-white disabled:opacity-50"
      >
        {loading ? "Solving..." : "Solve puzzle"}
      </button>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {result !== null && (
        <pre className="mt-2 text-sm bg-gray-100 p-2 rounded">
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </form>
  );
}
