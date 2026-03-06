'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useTheme } from 'next-themes';

type SolveResponse = unknown;

function extractSolutionLines(data: SolveResponse): string[] {
  if (typeof data === 'string') return [data];

  if (typeof data === 'object' && data !== null) {
    if ('moves' in data && Array.isArray((data as { moves?: unknown }).moves)) {
      const moves = (data as { moves: unknown }).moves as unknown[];
      return moves.filter((m): m is string => typeof m === 'string');
    }

    if ('solution' in data) {
      const sol = (data as { solution?: unknown }).solution;
      if (typeof sol === 'string') return [sol];
      if (Array.isArray(sol)) return sol.filter((m): m is string => typeof m === 'string');
    }

    if ('detail' in data && typeof (data as { detail?: unknown }).detail === 'string') {
      return [(data as { detail: string }).detail];
    }
  }

  return [];
}

export default function SolveTestClient() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const isDark = theme === 'dark' || (theme === 'system' && resolvedTheme === 'dark');

  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const [result, setResult] = useState<SolveResponse | null>(null);
  const [solutionLines, setSolutionLines] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }

    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const backendUrl = useMemo(() => {
    return process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://127.0.0.1:8000';
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const chosen = e.target.files?.[0] ?? null;
    setFile(chosen);
    setResult(null);
    setSolutionLines([]);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setResult(null);
    setSolutionLines([]);

    if (!file) {
      setError('Please choose an image first.');
      return;
    }

    const token = process.env.NEXT_PUBLIC_AUTH0_TEST_TOKEN;
    if (!token) {
      setError('Missing NEXT_PUBLIC_AUTH0_TEST_TOKEN in .env.local');
      return;
    }

    const formData = new FormData();
    formData.append('image', file);

    setLoading(true);

    try {
      const res = await fetch(`${backendUrl}/solve`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      const data: SolveResponse = await res.json();

      if (!res.ok) {
        let msg = `Error ${res.status}`;

        if (typeof data === 'object' && data !== null) {
          if ('detail' in data && typeof (data as { detail?: unknown }).detail === 'string') {
            msg = (data as { detail: string }).detail;
          } else if ('error' in data && typeof (data as { error?: unknown }).error === 'string') {
            msg = (data as { error: string }).error;
          }
        }

        setError(msg);
      } else {
        setResult(data);
        const lines = extractSolutionLines(data);
        setSolutionLines(lines.length ? lines : ['(No solution returned)']);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Network error';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  // Neumorphic “press” effect (works on click / active)
  const pressable =
    'transition-all duration-150 ease-out select-none ' +
    'shadow-[10px_10px_20px_rgba(0,0,0,0.12),-10px_-10px_20px_rgba(255,255,255,0.75)] ' +
    'active:translate-y-[1px] ' +
    'active:shadow-[inset_8px_8px_16px_rgba(0,0,0,0.12),inset_-8px_-8px_16px_rgba(255,255,255,0.75)] ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/10';

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-[520px]">
        {/* Theme toggle moved INSIDE the main container (top-right) */}
        <div className="neumo-surface p-8 md:p-10 relative">
          <div className="absolute top-4 right-4">
            <button
              type="button"
              onClick={() => setTheme(isDark ? 'light' : 'dark')}
              className={`neumo-pill px-4 py-2 text-sm ${pressable}`}
              aria-label="Toggle theme"
            >
              {isDark ? 'Dark' : 'Light'}
            </button>
          </div>

          <form onSubmit={handleSubmit}>
            <div className="flex justify-center">
              <label
                className={`neumo-pill px-8 py-4 cursor-pointer text-lg font-medium tracking-tight ${pressable}`}
              >
                Upload Image
                <input type="file" accept="image/*" onChange={handleFileChange} className="hidden" />
              </label>
            </div>

            <div className="mt-10 flex justify-center">
              <div className="neumo-ring w-[260px] h-[260px] p-4 flex items-center justify-center">
                <div className="w-full h-full rounded-full overflow-hidden flex items-center justify-center">
                  {previewUrl ? (
                    <img src={previewUrl} alt="Puzzle preview" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full neumo-inset flex items-center justify-center">
                      <span className="text-sm opacity-60 px-6 text-center">
                        Upload a puzzle image to preview it here
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-8 flex justify-center">
              <button
                type="submit"
                disabled={loading || !file}
                className={`neumo-pill px-8 py-3 text-base font-medium disabled:opacity-60 disabled:active:translate-y-0 ${pressable}`}
              >
                {loading ? 'Sending...' : 'Send to /solve'}
              </button>
            </div>
          </form>

          {error && (
            <div className="mt-5 text-center text-sm opacity-90">
              <span className="px-4 py-2 neumo-surface-soft inline-block">{error}</span>
            </div>
          )}

          <div className="mt-10 neumo-surface-soft p-8">
            <h2 className="text-4xl font-semibold tracking-tight mb-5">Solution</h2>

            {solutionLines.length > 0 ? (
              <ol className="space-y-3 text-2xl md:text-[28px] leading-snug">
                {solutionLines.map((line, idx) => (
                  <li key={`${idx}-${line}`} className="flex gap-4">
                    <span className="w-8 text-right opacity-70">{idx + 1}.</span>
                    <span className="font-medium">{line}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-base opacity-70">Upload an image and press solve.</p>
            )}

            {result !== null && (
              <pre className="mt-6 text-xs whitespace-pre-wrap break-words opacity-70">
                {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
              </pre>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}