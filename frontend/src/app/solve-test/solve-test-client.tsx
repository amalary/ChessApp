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
  FirstMoveAssessmentStatus,
  getPuzzleSubmissionUpdateEventName,
  type PuzzleSubmissionRecord,
  getUnseenPuzzleSubmissionCount,
  replacePuzzleSubmissions,
} from '@/lib/puzzle-submissions';
import {
  readActiveLocalAuthUser,
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
const FIRST_MOVE_MIN_CONFIDENCE = 0.75;
const BOARD_FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;
const BOARD_RANKS = ['8', '7', '6', '5', '4', '3', '2', '1'] as const;

type FirstMoveAttempt = {
  sourceSquare: string;
  destinationSquare: string;
  moveUci: string;
  timeToFirstMoveSeconds: number;
  createdAt: string;
};

type FirstMoveSolveOutcome = {
  status: FirstMoveAssessmentStatus;
  isFirstMoveCorrect: boolean;
  bestMove: string | null;
  isValidForFirstMoveAccuracy: boolean;
  invalidReason: string | null;
};

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

function createAttemptId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `attempt-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

function squareFromBoardIndex(row: number, col: number): string {
  return `${BOARD_FILES[col]}${BOARD_RANKS[row]}`;
}

function normalizeUciMove(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim().toLowerCase();
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function extractFirstUciMove(data: SolveResponse): string | null {
  if (!Array.isArray(data.moves_uci)) {
    return null;
  }
  for (const candidate of data.moves_uci) {
    const normalized = normalizeUciMove(candidate);
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

function isValidFenString(value: unknown): boolean {
  if (typeof value !== 'string') {
    return false;
  }
  const fen = value.trim();
  if (!fen) {
    return false;
  }
  const fields = fen.split(/\s+/);
  if (fields.length < 4) {
    return false;
  }
  const board = fields[0];
  const ranks = board.split('/');
  if (ranks.length !== 8) {
    return false;
  }
  const squaresPerRankValid = ranks.every((rank) => {
    let count = 0;
    for (const symbol of rank) {
      if (/[1-8]/.test(symbol)) {
        count += Number(symbol);
      } else if (/[prnbqkPRNBQK]/.test(symbol)) {
        count += 1;
      } else {
        return false;
      }
    }
    return count === 8;
  });
  if (!squaresPerRankValid) {
    return false;
  }
  if (fields[1] !== 'w' && fields[1] !== 'b') {
    return false;
  }
  return true;
}

function createPuzzleId(fen: unknown, file: File): string {
  if (typeof fen === 'string' && fen.trim()) {
    return `fen:${fen.trim()}`;
  }
  return `upload:${file.name}:${file.size}:${file.lastModified}`;
}

function classifyFirstMove(
  attemptedMove: string,
  bestMove: string | null,
): { status: FirstMoveAssessmentStatus; isFirstMoveCorrect: boolean } {
  const normalizedAttempt = normalizeUciMove(attemptedMove);
  const normalizedBest = normalizeUciMove(bestMove);
  if (!normalizedAttempt || !normalizedBest) {
    return { status: 'incorrect', isFirstMoveCorrect: false };
  }

  const attemptCore = normalizedAttempt.slice(0, 4);
  const bestCore = normalizedBest.slice(0, 4);
  if (attemptCore === bestCore) {
    return { status: 'correct', isFirstMoveCorrect: true };
  }

  const sameSource = attemptCore.slice(0, 2) === bestCore.slice(0, 2);
  const sameDestination = attemptCore.slice(2, 4) === bestCore.slice(2, 4);
  if (sameSource || sameDestination) {
    return { status: 'almost_correct', isFirstMoveCorrect: false };
  }

  return { status: 'incorrect', isFirstMoveCorrect: false };
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
  const [attemptId, setAttemptId] = useState<string>(() => createAttemptId());
  const [attemptStartedAtMs, setAttemptStartedAtMs] = useState<number | null>(null);
  const [selectedSourceSquare, setSelectedSourceSquare] = useState<string | null>(null);
  const [firstMoveAttempt, setFirstMoveAttempt] = useState<FirstMoveAttempt | null>(null);
  const [firstMoveSolveOutcome, setFirstMoveSolveOutcome] = useState<FirstMoveSolveOutcome | null>(null);

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

  useEffect(() => {
    const localAuthUser = readActiveLocalAuthUser();
    const localAuthUserId = localAuthUser?.id ?? '';
    if (!localAuthUserId) {
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    async function loadStoredSubmissions() {
      try {
        const response = await fetch(`${backendUrl}/puzzles/submissions?limit=500`, {
          method: 'GET',
          headers: {
            'X-Local-Auth-User-Id': localAuthUserId,
          },
          signal: controller.signal,
          cache: 'no-store',
        });

        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as unknown;
        if (cancelled || !Array.isArray(payload)) {
          return;
        }
        replacePuzzleSubmissions(payload as PuzzleSubmissionRecord[]);
      } catch {
        // Keep local-only behavior when backend history fetch fails.
      }
    }

    loadStoredSubmissions();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [backendUrl]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const chosen = e.target.files?.[0] ?? null;
    setFile(chosen);
    setSolutionLines([]);
    setSolveMeta(null);
    setError(null);
    setSubmitStatus('idle');
    setSelectedSourceSquare(null);
    setFirstMoveAttempt(null);
    setFirstMoveSolveOutcome(null);
    setAttemptId(createAttemptId());
    setAttemptStartedAtMs(chosen ? performance.now() : null);
  };

  const handleSquareClick = (square: string) => {
    if (!file || loading) {
      return;
    }

    if (firstMoveAttempt) {
      const isSelectedFirstMoveSquare =
        square === firstMoveAttempt.sourceSquare || square === firstMoveAttempt.destinationSquare;
      if (isSelectedFirstMoveSquare) {
        setFirstMoveAttempt(null);
        setFirstMoveSolveOutcome(null);
        setSelectedSourceSquare(null);
      }
      return;
    }

    if (!selectedSourceSquare) {
      setSelectedSourceSquare(square);
      setError(null);
      return;
    }

    if (selectedSourceSquare === square) {
      setSelectedSourceSquare(null);
      return;
    }

    const elapsedMs =
      attemptStartedAtMs !== null ? Math.max(0, performance.now() - attemptStartedAtMs) : 0;
    const timeToFirstMoveSeconds = Math.round((elapsedMs / 1000) * 100) / 100;
    setFirstMoveAttempt({
      sourceSquare: selectedSourceSquare,
      destinationSquare: square,
      moveUci: `${selectedSourceSquare}${square}`.toLowerCase(),
      timeToFirstMoveSeconds,
      createdAt: new Date().toISOString(),
    });
    setSelectedSourceSquare(null);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setSolutionLines([]);
    setSolveMeta(null);
    setSubmitStatus('sending');
    setFirstMoveSolveOutcome(null);

    if (!file) {
      setError('Please choose an image first.');
      setSubmitStatus('idle');
      return;
    }

    if (!firstMoveAttempt) {
      setError('Select your first move on the puzzle board before pressing Solve.');
      setSubmitStatus('idle');
      return;
    }

    const token = process.env.NEXT_PUBLIC_AUTH0_TEST_TOKEN;

    const formData = new FormData();
    formData.append('image', file);
    formData.append('expected_side_to_move', queenIsWhite ? 'white' : 'black');
    formData.append('first_move_uci', firstMoveAttempt.moveUci);
    formData.append('time_to_first_move_seconds', String(firstMoveAttempt.timeToFirstMoveSeconds));
    formData.append('attempt_id', attemptId);
    formData.append('attempt_created_at', firstMoveAttempt.createdAt);
    formData.append('puzzle_id', createPuzzleId(null, file));
    const solveStartedAt = performance.now();

    setLoading(true);

    try {
      const headers: HeadersInit = {};
      const localAuthUserId = readActiveLocalAuthUser()?.id ?? null;
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
      if (localAuthUserId) {
        headers['X-Local-Auth-User-Id'] = localAuthUserId;
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
          const bestMove = extractFirstUciMove(data);
          const firstMoveClassification = classifyFirstMove(firstMoveAttempt.moveUci, bestMove);
          const hasLowConfidence =
            meta.confidence === null || meta.confidence < FIRST_MOVE_MIN_CONFIDENCE;
          const hasInvalidFen = !isValidFenString(data.fen);
          const normalizedFen =
            typeof data.fen === 'string' && isValidFenString(data.fen) ? data.fen.trim() : null;
          const hasNoConfirmedMate =
            meta.mateFound !== true || meta.mateIn === null || bestMove === null;
          let invalidReason: string | null = null;
          if (hasLowConfidence) {
            invalidReason = 'low_vision_confidence';
          } else if (hasInvalidFen) {
            invalidReason = 'invalid_fen';
          } else if (hasNoConfirmedMate) {
            invalidReason = 'stockfish_no_mate';
          }
          const isValidForFirstMoveAccuracy = invalidReason === null;
          setFirstMoveSolveOutcome({
            status: firstMoveClassification.status,
            isFirstMoveCorrect: firstMoveClassification.isFirstMoveCorrect,
            bestMove,
            isValidForFirstMoveAccuracy,
            invalidReason,
          });
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
            fen: normalizedFen,
            solveTimeMs,
            puzzleElo,
            originalPuzzleImageDataUrl,
            positionCheck: meta,
            solutionLines: normalizedLines,
            firstMoveAssessment: {
              firstMove: firstMoveAttempt.moveUci,
              bestMove,
              isFirstMoveCorrect: firstMoveClassification.isFirstMoveCorrect,
              status: firstMoveClassification.status,
              timeToFirstMoveSeconds: firstMoveAttempt.timeToFirstMoveSeconds,
              puzzleId: createPuzzleId(data.fen, file),
              userId: user?.sub ?? localAuthUserId,
              attemptId,
              createdAt: firstMoveAttempt.createdAt,
              isValidForFirstMoveAccuracy,
              invalidReason,
            },
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
  const hasSolveResponse = solutionLines.length > 0 || solveMeta !== null;
  const canClickPuzzleToReplace = !!previewUrl && hasSolveResponse && !controlsLocked;
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
              {previewUrl ? (
                <div className="space-y-3">
                  <div className="neumo-ring w-[260px] h-[260px] rounded-[28px] p-4 flex items-center justify-center">
                    <div
                      className={`w-full h-full rounded-[20px] overflow-hidden flex items-center justify-center relative ${
                        canClickPuzzleToReplace ? 'cursor-pointer group' : ''
                      }`}
                      role={canClickPuzzleToReplace ? 'button' : undefined}
                      tabIndex={canClickPuzzleToReplace ? 0 : undefined}
                      onClick={
                        canClickPuzzleToReplace
                          ? () => {
                              const input = document.getElementById(fileInputId) as HTMLInputElement | null;
                              input?.click();
                            }
                          : undefined
                      }
                      onKeyDown={
                        canClickPuzzleToReplace
                          ? (event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                const input = document.getElementById(fileInputId) as HTMLInputElement | null;
                                input?.click();
                              }
                            }
                          : undefined
                      }
                      aria-label={
                        canClickPuzzleToReplace ? 'Click puzzle image to replace or re-upload' : undefined
                      }
                    >
                      <Image
                        src={previewUrl}
                        alt="Puzzle preview"
                        fill
                        unoptimized
                        sizes="260px"
                        className="w-full h-full object-cover"
                      />
                      {canClickPuzzleToReplace ? (
                        <div className="absolute inset-0 bg-black/0 hover:bg-black/25 transition-colors duration-150 flex items-center justify-center">
                          <span className="text-white text-sm font-medium opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                            Click to replace image
                          </span>
                        </div>
                      ) : (
                        <div className="absolute inset-0 grid grid-cols-8 grid-rows-8">
                          {Array.from({ length: 64 }, (_, idx) => {
                            const row = Math.floor(idx / 8);
                            const col = idx % 8;
                            const square = squareFromBoardIndex(row, col);
                            const isSelectedSource = selectedSourceSquare === square;
                            const isSelectedDestination = firstMoveAttempt?.destinationSquare === square;
                            const isCommittedSource = firstMoveAttempt?.sourceSquare === square;
                            return (
                              <button
                                key={square}
                                type="button"
                                onClick={() => handleSquareClick(square)}
                                disabled={controlsLocked}
                                className={`border border-black/15 dark:border-white/10 transition-colors ${
                                  isSelectedSource
                                    ? 'bg-sky-500/35'
                                    : isCommittedSource || isSelectedDestination
                                      ? 'bg-emerald-500/35'
                                      : 'bg-transparent hover:bg-white/12'
                                }`}
                                aria-label={`Select square ${square}`}
                              />
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <label
                  htmlFor={controlsLocked ? undefined : fileInputId}
                  onClick={controlsLocked ? (e) => e.preventDefault() : undefined}
                  className={`group ${controlsLocked ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                  aria-label="Upload or replace puzzle image"
                  aria-disabled={controlsLocked}
                >
                  <div className="neumo-ring w-[260px] h-[260px] rounded-[28px] p-4 flex items-center justify-center">
                    <div className="w-full h-full rounded-[20px] overflow-hidden flex items-center justify-center relative">
                      <div
                        className={`w-full h-full neumo-inset flex items-center justify-center transition-all duration-150 ${controlsLocked ? '' : 'group-hover:brightness-[1.03] group-hover:scale-[1.01]'}`}
                      >
                        <span className="text-sm opacity-60 px-6 text-center">
                          Upload a puzzle image
                        </span>
                      </div>
                    </div>
                  </div>
                </label>
              )}
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
                <div className="relative h-[50px] min-w-[172px]">
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
                    {file && !firstMoveAttempt ? (
                      <label
                        htmlFor={controlsLocked ? undefined : fileInputId}
                        onClick={controlsLocked ? (e) => e.preventDefault() : undefined}
                        className={`neumo-pill w-full h-full px-8 py-3 text-base font-medium whitespace-nowrap flex items-center justify-center ${pressable} ${
                          controlsLocked ? 'cursor-not-allowed opacity-60 pointer-events-none' : 'cursor-pointer'
                        }`}
                        style={themedButtonStyle}
                        aria-disabled={controlsLocked}
                      >
                        Replace Image
                      </label>
                    ) : (
                      <button
                        type="submit"
                        disabled={!file || !firstMoveAttempt}
                        className={`neumo-pill w-full h-full px-8 py-3 text-base font-medium disabled:opacity-60 disabled:active:translate-y-0 ${pressable}`}
                        style={themedButtonStyle}
                      >
                        Solve
                      </button>
                    )}
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

                {firstMoveSolveOutcome && (
                  <div className="mt-4 rounded-xl bg-white/35 dark:bg-white/5 px-3 py-3 text-xs md:text-sm">
                    <p className="font-semibold">First move evaluation</p>
                    <p className="mt-1">
                      Status:{' '}
                      <span className="font-medium">
                        {firstMoveSolveOutcome.status === 'almost_correct'
                          ? 'Almost correct'
                          : firstMoveSolveOutcome.status}
                      </span>
                    </p>
                    <p className="mt-1">
                      Best move:{' '}
                      <span className="font-medium">
                        {firstMoveSolveOutcome.bestMove ?? 'Unavailable'}
                      </span>
                    </p>
                    {!firstMoveSolveOutcome.isValidForFirstMoveAccuracy && (
                      <p className="mt-1 opacity-70">
                        Excluded from First-Move Accuracy: {firstMoveSolveOutcome.invalidReason}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
