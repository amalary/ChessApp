'use client';

import React, { useEffect, useId, useMemo, useState, useSyncExternalStore } from 'react';
import { useUser } from '@auth0/nextjs-auth0/client';
import { useTheme } from 'next-themes';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { CheckCircle2, Crown, LayoutDashboard } from 'lucide-react';
import {
  addPuzzleSubmission,
  estimatePuzzleElo,
  getPuzzleSubmissionUpdateEventName,
  getUnseenPuzzleSubmissionCount,
} from '@/lib/puzzle-submissions';
import {
  readScopedStorageValue,
  resolveUserSettingsScope,
  writeScopedStorageValue,
} from '@/lib/dashboard-theme-settings';
import {
  buildDashboardBackground,
  buildPanelGradientBackground,
  DEFAULT_DASHBOARD_ACCENT,
  DEFAULT_DASHBOARD_SECONDARY,
  extractSolutionLines,
  extractSolveMeta,
  formatConfidence,
  GradientDirection,
  hexToRgbChannels,
  isSuccessfulSolve,
  normalizeHexColor,
  SolveMeta,
  SolveResponse,
} from './solve-test-utils';

const DASHBOARD_ACCENT_STORAGE_KEY = 'chessapp.dashboard.accent';
const DASHBOARD_SECONDARY_STORAGE_KEY = 'chessapp.dashboard.secondary';
const DASHBOARD_GRADIENT_ENABLED_STORAGE_KEY = 'chessapp.dashboard.gradient.enabled';
const DASHBOARD_GRADIENT_DIRECTION_STORAGE_KEY = 'chessapp.dashboard.gradient.direction';
const DASHBOARD_THEME_MODE_STORAGE_KEY = 'chessapp.dashboard.theme.mode';
const DASHBOARD_THEME_UPDATED_EVENT = 'chessapp.dashboard.theme.updated';

function loadImageFromObjectUrl(objectUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to load puzzle image'));
    image.src = objectUrl;
  });
}

async function createSubmissionImageDataUrl(file: File): Promise<string | null> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return null;
  }

  if (!file.type.startsWith('image/')) {
    return null;
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImageFromObjectUrl(objectUrl);
    const maxDimension = 320;
    const largestDimension = Math.max(image.naturalWidth, image.naturalHeight);
    const scale = largestDimension > maxDimension ? maxDimension / largestDimension : 1;
    const targetWidth = Math.max(1, Math.round(image.naturalWidth * scale));
    const targetHeight = Math.max(1, Math.round(image.naturalHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const context = canvas.getContext('2d');
    if (!context) {
      return null;
    }

    context.drawImage(image, 0, 0, targetWidth, targetHeight);
    return canvas.toDataURL('image/jpeg', 0.8);
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export default function SolveTestClient() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const { user } = useUser();
  const router = useRouter();
  const isMounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const isDark = theme === 'dark' || (theme === 'system' && resolvedTheme === 'dark');
  const fileInputId = useId();

  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const [solutionLines, setSolutionLines] = useState<string[]>([]);
  const [solveMeta, setSolveMeta] = useState<SolveMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<'idle' | 'sending' | 'done' | 'returning'>('idle');
  const [visibleSolutionCount, setVisibleSolutionCount] = useState(0);
  const [visibleMetaCount, setVisibleMetaCount] = useState(0);
  const [showLowConfidenceHint, setShowLowConfidenceHint] = useState(false);

  const [queenIsWhite, setQueenIsWhite] = useState(true);
  const [isTransitioningToDashboard, setIsTransitioningToDashboard] = useState(false);
  const [unseenSubmissionCount, setUnseenSubmissionCount] = useState(0);
  const [accentColor, setAccentColor] = useState<string>(DEFAULT_DASHBOARD_ACCENT);
  const [secondaryColor, setSecondaryColor] = useState<string>(DEFAULT_DASHBOARD_SECONDARY);
  const [gradientEnabled, setGradientEnabled] = useState<boolean>(false);
  const [gradientDirection, setGradientDirection] = useState<GradientDirection>('top-to-bottom');
  const [settingsStorageScope, setSettingsStorageScope] = useState<string | null>(null);
  const appliedThemeScopeRef = React.useRef<string | null>(null);
  const submitStatusReturnTimerRef = React.useRef<number | null>(null);
  const submitStatusResetTimerRef = React.useRef<number | null>(null);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }

    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    const syncUnseenCount = () => {
      setUnseenSubmissionCount(getUnseenPuzzleSubmissionCount());
    };

    const updateEventName = getPuzzleSubmissionUpdateEventName();
    syncUnseenCount();
    window.addEventListener('storage', syncUnseenCount);
    window.addEventListener(updateEventName, syncUnseenCount);

    return () => {
      window.removeEventListener('storage', syncUnseenCount);
      window.removeEventListener(updateEventName, syncUnseenCount);
    };
  }, []);

  useEffect(() => {
    const syncSettingsScope = () => {
      setSettingsStorageScope(resolveUserSettingsScope(user?.sub ?? null));
    };

    syncSettingsScope();
    window.addEventListener('storage', syncSettingsScope);
    window.addEventListener('focus', syncSettingsScope);
    return () => {
      window.removeEventListener('storage', syncSettingsScope);
      window.removeEventListener('focus', syncSettingsScope);
    };
  }, [user?.sub]);

  useEffect(() => {
    const syncThemeFromStorage = () => {
      const nextAccent =
        normalizeHexColor(readScopedStorageValue(DASHBOARD_ACCENT_STORAGE_KEY, settingsStorageScope)) ??
        DEFAULT_DASHBOARD_ACCENT;
      const nextSecondary =
        normalizeHexColor(
          readScopedStorageValue(DASHBOARD_SECONDARY_STORAGE_KEY, settingsStorageScope),
        ) ?? DEFAULT_DASHBOARD_SECONDARY;
      const nextGradientEnabled =
        readScopedStorageValue(DASHBOARD_GRADIENT_ENABLED_STORAGE_KEY, settingsStorageScope) === '1';
      setAccentColor((previous) => (previous === nextAccent ? previous : nextAccent));
      setSecondaryColor((previous) => (previous === nextSecondary ? previous : nextSecondary));
      setGradientEnabled((previous) =>
        previous === nextGradientEnabled ? previous : nextGradientEnabled,
      );
      const storedDirection = readScopedStorageValue(
        DASHBOARD_GRADIENT_DIRECTION_STORAGE_KEY,
        settingsStorageScope,
      );
      if (
        storedDirection === 'top-to-bottom' ||
        storedDirection === 'diagonal' ||
        storedDirection === 'bottom-to-top'
      ) {
        setGradientDirection((previous) => (previous === storedDirection ? previous : storedDirection));
      } else {
        setGradientDirection((previous) => (previous === 'top-to-bottom' ? previous : 'top-to-bottom'));
      }
    };

    syncThemeFromStorage();
    window.addEventListener('storage', syncThemeFromStorage);
    window.addEventListener('focus', syncThemeFromStorage);
    window.addEventListener(DASHBOARD_THEME_UPDATED_EVENT, syncThemeFromStorage);
    return () => {
      window.removeEventListener('storage', syncThemeFromStorage);
      window.removeEventListener('focus', syncThemeFromStorage);
      window.removeEventListener(DASHBOARD_THEME_UPDATED_EVENT, syncThemeFromStorage);
    };
  }, [settingsStorageScope]);

  useEffect(() => {
    if (submitStatus !== 'done') {
      return;
    }
    if (submitStatusReturnTimerRef.current !== null) {
      window.clearTimeout(submitStatusReturnTimerRef.current);
    }
    if (submitStatusResetTimerRef.current !== null) {
      window.clearTimeout(submitStatusResetTimerRef.current);
    }
    submitStatusReturnTimerRef.current = window.setTimeout(() => {
      setSubmitStatus('returning');
      submitStatusReturnTimerRef.current = null;
    }, 3400);
    submitStatusResetTimerRef.current = window.setTimeout(() => {
      setSubmitStatus('idle');
      submitStatusResetTimerRef.current = null;
    }, 3900);
    return () => {
      if (submitStatusReturnTimerRef.current !== null) {
        window.clearTimeout(submitStatusReturnTimerRef.current);
        submitStatusReturnTimerRef.current = null;
      }
      if (submitStatusResetTimerRef.current !== null) {
        window.clearTimeout(submitStatusResetTimerRef.current);
        submitStatusResetTimerRef.current = null;
      }
    };
  }, [submitStatus]);

  useEffect(() => {
    setVisibleSolutionCount(0);
    setVisibleMetaCount(0);
    setShowLowConfidenceHint(false);

    if (solutionLines.length === 0 && !solveMeta) {
      return;
    }

    const timers: number[] = [];
    const lineStartDelay = 80;
    const lineStepDelay = 260;
    const metaStepDelay = 190;

    solutionLines.forEach((_, idx) => {
      timers.push(
        window.setTimeout(() => {
          setVisibleSolutionCount(idx + 1);
        }, lineStartDelay + idx * lineStepDelay),
      );
    });

    const rowCount = solveMeta ? 4 : 0;
    const metaStartDelay =
      lineStartDelay +
      Math.max(0, solutionLines.length - 1) * lineStepDelay +
      (solutionLines.length > 0 ? 260 : 0);

    for (let idx = 0; idx < rowCount; idx += 1) {
      timers.push(
        window.setTimeout(() => {
          setVisibleMetaCount(idx + 1);
        }, metaStartDelay + idx * metaStepDelay),
      );
    }

    if (solveMeta && solveMeta.confidence !== null && solveMeta.confidence < 0.75) {
      timers.push(
        window.setTimeout(() => {
          setShowLowConfidenceHint(true);
        }, metaStartDelay + rowCount * metaStepDelay + 140),
      );
    }

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [solutionLines, solveMeta]);

  useEffect(() => {
    const scopeKey = settingsStorageScope ?? '__default__';
    if (appliedThemeScopeRef.current === scopeKey) {
      return;
    }
    appliedThemeScopeRef.current = scopeKey;

    const storedThemeMode = readScopedStorageValue(
      DASHBOARD_THEME_MODE_STORAGE_KEY,
      settingsStorageScope,
    );
    if (storedThemeMode === 'light' || storedThemeMode === 'dark') {
      setTheme(storedThemeMode);
    }
  }, [setTheme, settingsStorageScope]);

  useEffect(() => {
    if (theme === 'light' || theme === 'dark') {
      writeScopedStorageValue(DASHBOARD_THEME_MODE_STORAGE_KEY, settingsStorageScope, theme);
    }
  }, [settingsStorageScope, theme]);

  const backendUrl = useMemo(() => {
    return process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://127.0.0.1:8010';
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const chosen = e.target.files?.[0] ?? null;
    setFile(chosen);
    setSolutionLines([]);
    setSolveMeta(null);
    setError(null);
    setSubmitStatus('idle');
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setSolutionLines([]);
    setSolveMeta(null);
    setSubmitStatus('sending');

    if (!file) {
      setError('Please choose an image first.');
      setSubmitStatus('idle');
      return;
    }

    const token = process.env.NEXT_PUBLIC_AUTH0_TEST_TOKEN;

    const formData = new FormData();
    formData.append('image', file);
    formData.append('expected_side_to_move', queenIsWhite ? 'white' : 'black');
    const solveStartedAt = performance.now();

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
        setSubmitStatus('idle');
      } else {
        const lines = extractSolutionLines(data);
        const normalizedLines = lines.length ? lines : ['(No solution returned)'];
        const meta = extractSolveMeta(data);
        setSolutionLines(normalizedLines);
        setSolveMeta(meta);
        setSubmitStatus('done');

        if (isSuccessfulSolve(data)) {
          const solveTimeMs = Math.max(0, Math.round(performance.now() - solveStartedAt));
          const originalPuzzleImageDataUrl = await createSubmissionImageDataUrl(file);
          const puzzleElo = estimatePuzzleElo({
            solveTimeMs,
            mateIn: meta.mateIn,
            confidence: meta.confidence,
            attemptsUsed: meta.attemptsUsed,
            solutionLines: normalizedLines,
          });
          addPuzzleSubmission({
            fileName: file.name,
            expectedSideToMove: queenIsWhite ? 'white' : 'black',
            solveTimeMs,
            puzzleElo,
            originalPuzzleImageDataUrl,
            positionCheck: meta,
            solutionLines: normalizedLines,
          });
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Network error';
      setError(message);
      setSubmitStatus('idle');
    } finally {
      setLoading(false);
    }
  };

  const handleQueenClick = () => {
    setQueenIsWhite((prev) => !prev);
  };

  const handleDashboardClick = () => {
    if (loading || isTransitioningToDashboard) {
      return;
    }
    setIsTransitioningToDashboard(true);
    window.setTimeout(() => {
      router.push('/dashboard');
    }, 280);
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
  const controlsLocked = loading || isTransitioningToDashboard;
  const accentChannels = useMemo<[number, number, number]>(
    () => hexToRgbChannels(accentColor) ?? hexToRgbChannels(DEFAULT_DASHBOARD_ACCENT) ?? [122, 148, 191],
    [accentColor],
  );
  const secondaryChannels = useMemo<[number, number, number]>(
    () =>
      hexToRgbChannels(secondaryColor) ??
      hexToRgbChannels(DEFAULT_DASHBOARD_SECONDARY) ??
      [165, 142, 180],
    [secondaryColor],
  );
  const pageBackground = useMemo(
    () =>
      buildDashboardBackground(
        accentChannels,
        secondaryChannels,
        gradientEnabled,
        gradientDirection,
        isDark,
      ),
    [accentChannels, gradientDirection, gradientEnabled, isDark, secondaryChannels],
  );
  const chessAppPanelGradient = useMemo(
    () =>
      buildPanelGradientBackground(
        accentChannels,
        secondaryChannels,
        gradientEnabled,
        gradientDirection,
        isDark,
      ),
    [accentChannels, gradientDirection, gradientEnabled, isDark, secondaryChannels],
  );
  const chessAppPanelStyle = chessAppPanelGradient
    ? ({
        background: chessAppPanelGradient,
      } as React.CSSProperties)
    : undefined;
  const themedButtonStyle = chessAppPanelStyle;

  if (!isMounted) {
    return <main className="min-h-screen flex items-center justify-center p-6" />;
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6" style={{ background: pageBackground }}>
      <div
        className={`w-full max-w-[520px] transition-all duration-300 ${
          isTransitioningToDashboard
            ? 'opacity-0 scale-[0.98] translate-y-1'
            : 'opacity-100 scale-100 translate-y-0'
        }`}
      >
        <div className="neumo-surface p-8 md:p-10 relative" style={chessAppPanelStyle}>
          <div className="absolute top-4 left-4">
            <button
              type="button"
              onClick={handleQueenClick}
              disabled={controlsLocked}
              className={`neumo-pill h-12 w-12 flex items-center justify-center disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:translate-y-0 ${pressable}`}
              style={themedButtonStyle}
              aria-label={`Side to move: ${queenIsWhite ? 'white' : 'black'}. Click to toggle.`}
              title={`Side to move: ${queenIsWhite ? 'white' : 'black'}`}
            >
              <Crown
                className="h-6 w-6 transition-colors duration-200"
                color={queenStroke}
                fill={queenIsWhite ? 'none' : queenStroke}
                strokeWidth={2.2}
              />
            </button>
          </div>

          <div className="absolute top-4 right-4 flex items-center gap-2">
            <button
              type="button"
              onClick={handleDashboardClick}
              disabled={controlsLocked}
              className={`relative neumo-pill px-3 py-2 text-sm flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed ${pressable}`}
              style={themedButtonStyle}
              aria-label="Open dashboard"
            >
              <LayoutDashboard className="h-4 w-4" />
              Dashboard
              {unseenSubmissionCount > 0 && (
                <span
                  className="absolute -top-2 -right-2 min-w-5 h-5 px-1 rounded-full bg-red-600 text-white text-[11px] leading-none font-semibold flex items-center justify-center shadow-[0_2px_8px_rgba(220,38,38,0.45)]"
                  aria-label={`${unseenSubmissionCount} new solved submissions`}
                  title={`${unseenSubmissionCount} new solved submissions`}
                >
                  {unseenSubmissionCount > 99 ? '99+' : unseenSubmissionCount}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setTheme(isDark ? 'light' : 'dark')}
              disabled={controlsLocked}
              className={`neumo-pill px-4 py-2 text-sm disabled:opacity-60 disabled:cursor-not-allowed ${pressable}`}
              style={themedButtonStyle}
              aria-label="Toggle theme"
            >
              {isDark ? 'Dark' : 'Light'}
            </button>
          </div>

          <form onSubmit={handleSubmit} aria-busy={loading}>
            <input
              id={fileInputId}
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              disabled={controlsLocked}
              className="hidden"
            />

            {!file && (
              <div className="mt-16 md:mt-14 flex justify-center">
                <label
                  htmlFor={controlsLocked ? undefined : fileInputId}
                  onClick={controlsLocked ? (e) => e.preventDefault() : undefined}
                  aria-disabled={controlsLocked}
                  className={`neumo-pill px-8 py-4 text-lg font-medium tracking-tight ${pressable} ${controlsLocked ? 'cursor-not-allowed opacity-60 pointer-events-none' : 'cursor-pointer'}`}
                  style={themedButtonStyle}
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
                        <Image
                          src={previewUrl}
                          alt="Puzzle preview"
                          fill
                          unoptimized
                          sizes="260px"
                          className="w-full h-full object-cover"
                        />
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
                        <span className="text-sm opacity-60 px-6 text-center">
                          Upload a puzzle image
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </label>
            </div>

            <div className="mt-8 flex justify-center">
              {loading || submitStatus === 'sending' ? (
                <div
                  className="neumo-surface-soft px-5 py-3 flex items-center gap-3"
                  style={chessAppPanelStyle}
                  role="status"
                  aria-live="polite"
                >
                  <div className="chess-loading-track-inline" aria-hidden="true">
                    <Crown
                      className="h-4 w-4 chess-loading-piece-inline"
                      color={queenStroke}
                      fill={queenIsWhite ? 'none' : queenStroke}
                      strokeWidth={2}
                    />
                  </div>
                  <span className="text-sm font-medium chess-loading-text">Sending</span>
                </div>
              ) : (
                <div className="relative h-[50px] min-w-[136px]">
                  <div
                    className={`absolute inset-0 transition-all duration-500 ${
                      submitStatus === 'done'
                        ? 'opacity-100 translate-y-0 scale-100'
                        : 'opacity-0 -translate-y-1 scale-[0.98] pointer-events-none'
                    }`}
                  >
                    <div
                      className="neumo-surface-soft chess-status-done px-5 py-3 h-full flex items-center justify-center gap-3"
                      style={chessAppPanelStyle}
                      role="status"
                      aria-live="polite"
                    >
                      <span className="text-sm font-semibold tracking-tight">Done</span>
                      <CheckCircle2
                        className="h-5 w-5 text-emerald-500 chess-done-check"
                        strokeWidth={2.4}
                        aria-hidden="true"
                      />
                      <span className="chess-status-done-sheen" aria-hidden="true" />
                    </div>
                  </div>
                  <div
                    className={`absolute inset-0 transition-all duration-500 ${
                      submitStatus === 'returning' || submitStatus === 'idle'
                        ? 'opacity-100 translate-y-0 scale-100'
                        : 'opacity-0 translate-y-1 scale-[0.98] pointer-events-none'
                    }`}
                  >
                    <button
                      type="submit"
                      disabled={!file}
                      className={`neumo-pill w-full h-full px-8 py-3 text-base font-medium disabled:opacity-60 disabled:active:translate-y-0 ${pressable}`}
                      style={themedButtonStyle}
                    >
                      Solve
                    </button>
                  </div>
                </div>
              )}
            </div>
          </form>

          {error && (
            <div className="mt-5 text-center text-sm opacity-90">
              <span className="px-4 py-2 neumo-surface-soft inline-block" style={chessAppPanelStyle}>
                {error}
              </span>
            </div>
          )}

          <div className="mt-10 neumo-surface-soft p-8" style={chessAppPanelStyle}>
            <h2 className="text-4xl font-semibold tracking-tight mb-5">Solution</h2>

            {solutionLines.length > 0 ? (
              <ol className="space-y-3 text-2xl md:text-[28px] leading-snug">
                {solutionLines.slice(0, visibleSolutionCount).map((line, idx) => (
                  <li key={`${idx}-${line}`} className="flex gap-4 chess-stream-item">
                    <span className="w-8 text-right opacity-70">{idx + 1}.</span>
                    <span className="font-medium">{line}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-base opacity-70">Upload an image and press solve.</p>
            )}

            {solveMeta && (
              <div className="mt-8 pt-6 border-t border-black/10 dark:border-white/15">
                <h3 className="text-lg font-semibold tracking-tight">Position Check</h3>
                <dl className="mt-4 space-y-3 text-sm md:text-base">
                  {visibleMetaCount >= 1 && (
                    <div className="flex items-start justify-between gap-4 chess-stream-item">
                      <dt className="opacity-70">Side to move</dt>
                      <dd className="font-medium">{solveMeta.sideToMove ?? 'Unavailable'}</dd>
                    </div>
                  )}
                  {visibleMetaCount >= 2 && (
                    <div className="flex items-start justify-between gap-4 chess-stream-item">
                      <dt className="opacity-70">Vision confidence</dt>
                      <dd className="font-medium">{formatConfidence(solveMeta.confidence)}</dd>
                    </div>
                  )}
                  {visibleMetaCount >= 3 && (
                    <div className="flex items-start justify-between gap-4 chess-stream-item">
                      <dt className="opacity-70">Vision attempts</dt>
                      <dd className="font-medium">{solveMeta.attemptsUsed ?? 'Unavailable'}</dd>
                    </div>
                  )}
                  {visibleMetaCount >= 4 && (
                    <div className="flex items-start justify-between gap-4 chess-stream-item">
                      <dt className="opacity-70">Mate status</dt>
                      <dd className="font-medium">
                        {solveMeta.mateFound === null
                          ? 'Unavailable'
                          : solveMeta.mateFound
                            ? `Mate in ${solveMeta.mateIn ?? '?'}`
                            : 'No forced mate (1-3)'}
                      </dd>
                    </div>
                  )}
                </dl>

                {showLowConfidenceHint && (
                  <p className="mt-4 text-xs opacity-70 chess-stream-item">
                    Low vision confidence can cause wrong puzzle positions. Try a cleaner crop and
                    verify the side selector in the top-left.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
