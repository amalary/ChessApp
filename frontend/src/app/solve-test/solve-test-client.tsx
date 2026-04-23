'use client';

import React, { useEffect, useId, useMemo, useState } from 'react';
import { useTheme } from 'next-themes';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Crown, LayoutDashboard } from 'lucide-react';
import {
  addPuzzleSubmission,
  estimatePuzzleElo,
  getPuzzleSubmissionUpdateEventName,
  getUnseenPuzzleSubmissionCount,
} from '@/lib/puzzle-submissions';

type SolveResponse = {
  solution_line?: unknown;
  moves_san?: unknown;
  mate_found?: unknown;
  mate_in?: unknown;
  vision_confidence?: unknown;
  vision_side_to_move?: unknown;
  vision_attempts_used?: unknown;
  error?: unknown;
  detail?: unknown;
};

type SolveMeta = {
  sideToMove: 'white' | 'black' | null;
  confidence: number | null;
  attemptsUsed: number | null;
  mateFound: boolean | null;
  mateIn: number | null;
};

const DEFAULT_DASHBOARD_ACCENT = '#7A94BF';
const DEFAULT_DASHBOARD_SECONDARY = '#A58EB4';
const DASHBOARD_ACCENT_STORAGE_KEY = 'chessapp.dashboard.accent';
const DASHBOARD_SECONDARY_STORAGE_KEY = 'chessapp.dashboard.secondary';
const DASHBOARD_GRADIENT_ENABLED_STORAGE_KEY = 'chessapp.dashboard.gradient.enabled';
const DASHBOARD_GRADIENT_DIRECTION_STORAGE_KEY = 'chessapp.dashboard.gradient.direction';

type GradientDirection = 'top-to-bottom' | 'diagonal' | 'bottom-to-top';

function toText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function toBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') {
    return value;
  }
  return null;
}

function normalizeHexColor(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(normalized)) {
    return null;
  }

  return normalized.toUpperCase();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function rgbToHsl(red: number, green: number, blue: number): [number, number, number] {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const chroma = max - min;
  const lightness = (max + min) / 2;
  let hue = 0;
  let saturation = 0;

  if (chroma > 0) {
    saturation = chroma / (1 - Math.abs(2 * lightness - 1));
    if (max === r) {
      hue = ((g - b) / chroma + (g < b ? 6 : 0)) * 60;
    } else if (max === g) {
      hue = ((b - r) / chroma + 2) * 60;
    } else {
      hue = ((r - g) / chroma + 4) * 60;
    }
  }

  return [hue, saturation * 100, lightness * 100];
}

function hslToRgb(hue: number, saturation: number, lightness: number): [number, number, number] {
  const h = ((hue % 360) + 360) % 360;
  const s = clamp(saturation, 0, 100) / 100;
  const l = clamp(lightness, 0, 100) / 100;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const huePrime = h / 60;
  const x = chroma * (1 - Math.abs((huePrime % 2) - 1));
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;

  if (huePrime >= 0 && huePrime < 1) {
    r1 = chroma;
    g1 = x;
  } else if (huePrime < 2) {
    r1 = x;
    g1 = chroma;
  } else if (huePrime < 3) {
    g1 = chroma;
    b1 = x;
  } else if (huePrime < 4) {
    g1 = x;
    b1 = chroma;
  } else if (huePrime < 5) {
    r1 = x;
    b1 = chroma;
  } else {
    r1 = chroma;
    b1 = x;
  }

  const match = l - chroma / 2;
  return [
    Math.round((r1 + match) * 255),
    Math.round((g1 + match) * 255),
    Math.round((b1 + match) * 255),
  ];
}

function rgbChannelsToHex(channels: [number, number, number]): string {
  return `#${channels.map((channel) => clamp(Math.round(channel), 0, 255).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

function hexToRgbChannels(hexColor: string): [number, number, number] | null {
  const normalized = normalizeHexColor(hexColor);
  if (!normalized) {
    return null;
  }

  const value = normalized.slice(1);
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}

function toNeumorphicHexColor(value: string | null | undefined): string | null {
  const normalized = normalizeHexColor(value);
  if (!normalized) {
    return null;
  }

  const channels = hexToRgbChannels(normalized);
  if (!channels) {
    return null;
  }

  const [hue, saturation, lightness] = rgbToHsl(channels[0], channels[1], channels[2]);
  const neumoSaturation = clamp(24 + saturation * 0.38, 24, 58);
  const neumoLightness = clamp(60 + (lightness - 50) * 0.2, 54, 74);
  const neumoChannels = hslToRgb(hue, neumoSaturation, neumoLightness);
  return rgbChannelsToHex(neumoChannels);
}

function rgbaFromChannels(channels: [number, number, number], alpha: number): string {
  return `rgba(${channels[0]}, ${channels[1]}, ${channels[2]}, ${alpha})`;
}

function resolveGradientAngle(direction: GradientDirection): string {
  if (direction === 'top-to-bottom') {
    return '180deg';
  }
  if (direction === 'bottom-to-top') {
    return '0deg';
  }
  return '135deg';
}

function buildDashboardBackground(
  primary: [number, number, number],
  secondary: [number, number, number],
  gradientEnabled: boolean,
  gradientDirection: GradientDirection,
): string {
  if (!gradientEnabled) {
    return `radial-gradient(1200px circle at 18% 18%, rgba(255,255,255,0.85), rgba(237,242,250,0) 60%), radial-gradient(940px circle at 88% 8%, ${rgbaFromChannels(primary, 0.2)}, rgba(255,255,255,0) 56%), linear-gradient(180deg, #dfe6f1 0%, #d9e2ef 100%)`;
  }

  const gradientAngle = resolveGradientAngle(gradientDirection);
  return `radial-gradient(1200px circle at 18% 18%, rgba(255,255,255,0.78), rgba(237,242,250,0) 60%), radial-gradient(940px circle at 88% 8%, ${rgbaFromChannels(primary, 0.24)}, rgba(255,255,255,0) 56%), linear-gradient(${gradientAngle}, ${rgbaFromChannels(primary, 0.52)} 0%, ${rgbaFromChannels(secondary, 0.56)} 100%), linear-gradient(180deg, #dfe6f1 0%, #d9e2ef 100%)`;
}

function buildPanelGradientBackground(
  primary: [number, number, number],
  secondary: [number, number, number],
  gradientEnabled: boolean,
  gradientDirection: GradientDirection,
): string | undefined {
  if (!gradientEnabled) {
    return undefined;
  }

  const gradientAngle = resolveGradientAngle(gradientDirection);
  return `linear-gradient(${gradientAngle}, ${rgbaFromChannels(primary, 0.26)} 0%, ${rgbaFromChannels(secondary, 0.3)} 100%), linear-gradient(180deg, rgba(255,255,255,0.28) 0%, rgba(255,255,255,0.08) 100%), rgb(var(--surface))`;
}

function normalizeSide(value: unknown): 'white' | 'black' | null {
  const text = toText(value)?.toLowerCase();
  if (!text) {
    return null;
  }
  if (text === 'white' || text === 'w') {
    return 'white';
  }
  if (text === 'black' || text === 'b') {
    return 'black';
  }
  return null;
}

function extractSolveMeta(data: SolveResponse): SolveMeta {
  const rawConfidence = toFiniteNumber(data.vision_confidence);
  const normalizedConfidence =
    rawConfidence === null
      ? null
      : Math.max(0, Math.min(1, rawConfidence > 1 ? rawConfidence / 100 : rawConfidence));

  const rawMateIn = toFiniteNumber(data.mate_in);
  const mateIn =
    rawMateIn !== null && Number.isInteger(rawMateIn) && rawMateIn >= 1 ? rawMateIn : null;

  const rawAttempts = toFiniteNumber(data.vision_attempts_used);
  const attemptsUsed =
    rawAttempts !== null && Number.isInteger(rawAttempts) && rawAttempts >= 1 ? rawAttempts : null;

  return {
    sideToMove: normalizeSide(data.vision_side_to_move),
    confidence: normalizedConfidence,
    attemptsUsed,
    mateFound: toBoolean(data.mate_found),
    mateIn,
  };
}

function formatConfidence(confidence: number | null): string {
  if (confidence === null) {
    return 'Unavailable';
  }
  return `${(confidence * 100).toFixed(1)}%`;
}

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

function isSuccessfulSolve(data: SolveResponse): boolean {
  if (data.mate_found === true) {
    return true;
  }

  if (typeof data.solution_line === 'string' && data.solution_line.trim()) {
    return true;
  }

  if (Array.isArray(data.moves_san)) {
    return data.moves_san.some((move) => typeof move === 'string' && move.trim().length > 0);
  }

  return false;
}

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
  const router = useRouter();
  const isDark = theme === 'dark' || (theme === 'system' && resolvedTheme === 'dark');
  const fileInputId = useId();

  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const [solutionLines, setSolutionLines] = useState<string[]>([]);
  const [solveMeta, setSolveMeta] = useState<SolveMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [queenIsWhite, setQueenIsWhite] = useState(true);
  const [isTransitioningToDashboard, setIsTransitioningToDashboard] = useState(false);
  const [unseenSubmissionCount, setUnseenSubmissionCount] = useState(0);
  const [accentColor, setAccentColor] = useState<string>(() => {
    if (typeof window === 'undefined') {
      return DEFAULT_DASHBOARD_ACCENT;
    }
    return (
      toNeumorphicHexColor(window.localStorage.getItem(DASHBOARD_ACCENT_STORAGE_KEY)) ??
      DEFAULT_DASHBOARD_ACCENT
    );
  });
  const [secondaryColor, setSecondaryColor] = useState<string>(() => {
    if (typeof window === 'undefined') {
      return DEFAULT_DASHBOARD_SECONDARY;
    }
    return (
      toNeumorphicHexColor(window.localStorage.getItem(DASHBOARD_SECONDARY_STORAGE_KEY)) ??
      DEFAULT_DASHBOARD_SECONDARY
    );
  });
  const [gradientEnabled, setGradientEnabled] = useState<boolean>(() => {
    if (typeof window === 'undefined') {
      return false;
    }
    return window.localStorage.getItem(DASHBOARD_GRADIENT_ENABLED_STORAGE_KEY) === '1';
  });
  const [gradientDirection, setGradientDirection] = useState<GradientDirection>(() => {
    if (typeof window === 'undefined') {
      return 'top-to-bottom';
    }
    const storedDirection = window.localStorage.getItem(DASHBOARD_GRADIENT_DIRECTION_STORAGE_KEY);
    if (
      storedDirection === 'top-to-bottom' ||
      storedDirection === 'diagonal' ||
      storedDirection === 'bottom-to-top'
    ) {
      return storedDirection;
    }
    return 'top-to-bottom';
  });

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
    const syncThemeFromStorage = () => {
      setAccentColor(
        toNeumorphicHexColor(window.localStorage.getItem(DASHBOARD_ACCENT_STORAGE_KEY)) ??
          DEFAULT_DASHBOARD_ACCENT,
      );
      setSecondaryColor(
        toNeumorphicHexColor(window.localStorage.getItem(DASHBOARD_SECONDARY_STORAGE_KEY)) ??
          DEFAULT_DASHBOARD_SECONDARY,
      );
      setGradientEnabled(
        window.localStorage.getItem(DASHBOARD_GRADIENT_ENABLED_STORAGE_KEY) === '1',
      );
      const storedDirection = window.localStorage.getItem(DASHBOARD_GRADIENT_DIRECTION_STORAGE_KEY);
      if (
        storedDirection === 'top-to-bottom' ||
        storedDirection === 'diagonal' ||
        storedDirection === 'bottom-to-top'
      ) {
        setGradientDirection(storedDirection);
      } else {
        setGradientDirection('top-to-bottom');
      }
    };

    syncThemeFromStorage();
    window.addEventListener('storage', syncThemeFromStorage);
    window.addEventListener('focus', syncThemeFromStorage);
    return () => {
      window.removeEventListener('storage', syncThemeFromStorage);
      window.removeEventListener('focus', syncThemeFromStorage);
    };
  }, []);

  const backendUrl = useMemo(() => {
    return process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://127.0.0.1:8010';
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const chosen = e.target.files?.[0] ?? null;
    setFile(chosen);
    setSolutionLines([]);
    setSolveMeta(null);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setSolutionLines([]);
    setSolveMeta(null);

    if (!file) {
      setError('Please choose an image first.');
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
      } else {
        const lines = extractSolutionLines(data);
        const normalizedLines = lines.length ? lines : ['(No solution returned)'];
        const meta = extractSolveMeta(data);
        setSolutionLines(normalizedLines);
        setSolveMeta(meta);

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
      ),
    [accentChannels, gradientDirection, gradientEnabled, secondaryChannels],
  );
  const chessAppPanelGradient = useMemo(
    () =>
      buildPanelGradientBackground(
        accentChannels,
        secondaryChannels,
        gradientEnabled,
        gradientDirection,
      ),
    [accentChannels, gradientDirection, gradientEnabled, secondaryChannels],
  );
  const chessAppPanelStyle = chessAppPanelGradient
    ? ({
        background: chessAppPanelGradient,
      } as React.CSSProperties)
    : undefined;
  const themedButtonStyle = chessAppPanelStyle;

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
              {loading ? (
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
                <button
                  type="submit"
                  disabled={!file}
                  className={`neumo-pill px-8 py-3 text-base font-medium disabled:opacity-60 disabled:active:translate-y-0 ${pressable}`}
                  style={themedButtonStyle}
                >
                  Solve
                </button>
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

            {solveMeta && (
              <div className="mt-8 pt-6 border-t border-black/10 dark:border-white/15">
                <h3 className="text-lg font-semibold tracking-tight">Position Check</h3>
                <dl className="mt-4 space-y-3 text-sm md:text-base">
                  <div className="flex items-start justify-between gap-4">
                    <dt className="opacity-70">Side to move</dt>
                    <dd className="font-medium">{solveMeta.sideToMove ?? 'Unavailable'}</dd>
                  </div>
                  <div className="flex items-start justify-between gap-4">
                    <dt className="opacity-70">Vision confidence</dt>
                    <dd className="font-medium">{formatConfidence(solveMeta.confidence)}</dd>
                  </div>
                  <div className="flex items-start justify-between gap-4">
                    <dt className="opacity-70">Vision attempts</dt>
                    <dd className="font-medium">{solveMeta.attemptsUsed ?? 'Unavailable'}</dd>
                  </div>
                  <div className="flex items-start justify-between gap-4">
                    <dt className="opacity-70">Mate status</dt>
                    <dd className="font-medium">
                      {solveMeta.mateFound === null
                        ? 'Unavailable'
                        : solveMeta.mateFound
                          ? `Mate in ${solveMeta.mateIn ?? '?'}`
                          : 'No forced mate (1-3)'}
                    </dd>
                  </div>
                </dl>

                {solveMeta.confidence !== null && solveMeta.confidence < 0.75 && (
                  <p className="mt-4 text-xs opacity-70">
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
