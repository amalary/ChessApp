'use client';

import React, { useEffect, useId, useMemo, useState } from 'react';
import { useTheme } from 'next-themes';
import { Crown } from 'lucide-react';

type SolveResponse = {
  solution_line?: unknown;
  moves_san?: unknown;
  mate_found?: boolean;
  detail?: unknown;
};

function extractSolutionLines(data: SolveResponse): string[] {
  if (typeof data.solution_line === 'string' && data.solution_line.trim()) {
    return [data.solution_line.trim()];
  }

  const moves = Array.isArray(data.moves_san)
    ? data.moves_san.filter((m): m is string => typeof m === 'string')
    : [];

  if (moves.length > 0) {
    const singleLine = moves.length === 1 ? moves[0] : moves.join(' ');
    return [singleLine];
  }

  if (data.mate_found === false) {
    return ['No forced mate found in the search range.'];
  }

  if (typeof data.detail === 'string') {
    return [data.detail];
  }

  return ['No mate solution returned.'];
}

export default function SolveTestClient() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const isDark = theme === 'dark' || (theme === 'system' && resolvedTheme === 'dark');
  const fileInputId = useId();

  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const [solutionLines, setSolutionLines] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [queenIsWhite, setQueenIsWhite] = useState(true);
  const [sideOverrideEnabled, setSideOverrideEnabled] = useState(false);

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
    return process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://127.0.0.1:8010';
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const chosen = e.target.files?.[0] ?? null;
    setFile(chosen);
    setSolutionLines([]);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setSolutionLines([]);

    if (!file) {
      setError('Please choose an image first.');
      return;
    }

    const token = process.env.NEXT_PUBLIC_AUTH0_TEST_TOKEN;

    const formData = new FormData();
    formData.append('image', file);
    if (sideOverrideEnabled) {
      formData.append('expected_side_to_move', queenIsWhite ? 'white' : 'black');
    }

    setLoading(true);

    try {
      const headers: HeadersInit = {};
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const res = await fetch(`${backendUrl}/solve`, {
        method: 'POST',
        headers,
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

  const handleQueenClick = () => {
    setSideOverrideEnabled(true);
    setQueenIsWhite((prev) => !prev);
  };

  const pressable =
    'transition-all duration-150 ease-out select-none ' +
    'shadow-[10px_10px_20px_rgba(0,0,0,0.12),-10px_-10px_20px_rgba(255,255,255,0.75)] ' +
    'hover:-translate-y-[1px] hover:shadow-[12px_12px_24px_rgba(0,0,0,0.16),-12px_-12px_24px_rgba(255,255,255,0.8)] ' +
    'hover:outline hover:outline-2 hover:outline-black/10 dark:hover:outline-white/25 ' +
    'active:translate-y-[1px] ' +
    'active:shadow-[inset_8px_8px_16px_rgba(0,0,0,0.12),inset_-8px_-8px_16px_rgba(255,255,255,0.75)] ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/10';

  const queenStroke = isDark ? '#e2e8f0' : '#111827';
  const controlsLocked = loading;

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-[520px]">
        <div className="neumo-surface p-8 md:p-10 relative">
          <div className="absolute top-4 left-4">
            <button
              type="button"
              onClick={handleQueenClick}
              disabled={controlsLocked}
              className={`neumo-pill h-12 w-12 flex items-center justify-center disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:translate-y-0 ${pressable}`}
              aria-label={
                sideOverrideEnabled
                  ? `Side override enabled: ${queenIsWhite ? 'white' : 'black'}. Click to toggle.`
                  : 'Side override is auto. Click to enable manual side toggle.'
              }
              title={
                sideOverrideEnabled
                  ? `Side override: ${queenIsWhite ? 'white' : 'black'}`
                  : 'Side override: auto'
              }
            >
              <Crown
                className="h-6 w-6 transition-colors duration-200"
                color={queenStroke}
                fill={queenIsWhite ? 'none' : queenStroke}
                strokeWidth={2.2}
              />
            </button>
          </div>

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
            <input
              id={fileInputId}
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              disabled={controlsLocked}
              className="hidden"
            />

            {!file && (
              <div className="flex justify-center">
                <label
                  htmlFor={controlsLocked ? undefined : fileInputId}
                  onClick={controlsLocked ? (e) => e.preventDefault() : undefined}
                  aria-disabled={controlsLocked}
                  className={`neumo-pill px-8 py-4 text-lg font-medium tracking-tight ${pressable} ${controlsLocked ? 'cursor-not-allowed opacity-60 pointer-events-none' : 'cursor-pointer'}`}
                >
                  Upload Image
                </label>
              </div>
            )}

            <div className={`${file ? 'mt-6' : 'mt-10'} flex justify-center`}>
              <label
                htmlFor={controlsLocked ? undefined : fileInputId}
                onClick={controlsLocked ? (e) => e.preventDefault() : undefined}
                className={`group ${controlsLocked ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                aria-label="Upload or replace puzzle image"
                aria-disabled={controlsLocked}
              >
                <div className="neumo-ring w-[260px] h-[260px] p-4 flex items-center justify-center">
                  <div className="w-full h-full rounded-full overflow-hidden flex items-center justify-center relative">
                    {previewUrl ? (
                      <>
                        <img src={previewUrl} alt="Puzzle preview" className="w-full h-full object-cover" />
                        <div
                          className={`absolute inset-0 flex items-center justify-center bg-black/35 opacity-0 transition-opacity duration-150 ${controlsLocked ? '' : 'group-hover:opacity-100'}`}
                        >
                          <span className="text-white text-sm font-medium px-4 text-center">
                            Click to re-upload
                          </span>
                        </div>
                      </>
                    ) : (
                      <div
                        className={`w-full h-full neumo-inset flex items-center justify-center transition-all duration-150 ${controlsLocked ? '' : 'group-hover:brightness-[1.03] group-hover:scale-[1.01]'}`}
                      >
                        <span className="text-sm opacity-60 px-6 text-center">Upload a puzzle image</span>
                      </div>
                    )}
                  </div>
                </div>
              </label>
            </div>

            <div className="mt-8 flex justify-center">
              <button
                type="submit"
                disabled={loading || !file}
                className={`neumo-pill px-8 py-3 text-base font-medium disabled:opacity-60 disabled:active:translate-y-0 ${pressable}`}
              >
                {loading ? 'Sending...' : 'Solve'}
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

          </div>
        </div>
      </div>
    </main>
  );
}
