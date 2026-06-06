'use client';

import React, { useEffect, useId, useMemo, useState, useSyncExternalStore } from 'react';
import { useUser } from '@auth0/nextjs-auth0/client';
import { useTheme } from 'next-themes';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { Activity, CheckCircle2, Crown, House, LayoutDashboard, Puzzle, UserRound } from 'lucide-react';
import {
  addPuzzleSubmission,
  estimatePuzzleElo,
  FirstMoveAssessmentStatus,
  getPuzzleSubmissionUpdateEventName,
  readPuzzleSubmissions,
  type PuzzleSubmissionRecord,
  getUnseenPuzzleSubmissionCount,
  replacePuzzleSubmissions,
} from '@/lib/puzzle-submissions';
import {
  LOCAL_AUTH_ACTIVE_USER_UPDATED_EVENT,
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
import {
  buildBeatScheduleMs,
  buildConversationalBeats,
  formatConversationalText,
  type AssistantRhythmIntent,
} from '@/lib/assistant-rhythm';
import { readResponsePayload, responseErrorMessage } from '@/lib/http-response';
import { getRequestAuthContextClient } from 'lib/getRequestAuthContextClient';

const DASHBOARD_ACCENT_STORAGE_KEY = 'chessapp.dashboard.accent';
const DASHBOARD_SECONDARY_STORAGE_KEY = 'chessapp.dashboard.secondary';
const DASHBOARD_GRADIENT_ENABLED_STORAGE_KEY = 'chessapp.dashboard.gradient.enabled';
const DASHBOARD_GRADIENT_DIRECTION_STORAGE_KEY = 'chessapp.dashboard.gradient.direction';
const DASHBOARD_THEME_MODE_STORAGE_KEY = 'chessapp.dashboard.theme.mode';
const DASHBOARD_THEME_UPDATED_EVENT = 'chessapp.dashboard.theme.updated';
const AMY_CONVERSATION_MODE_STORAGE_KEY = 'chessapp.solve-test.amy.conversation-mode';
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

type BoardPoint = {
  x: number;
  y: number;
};

type MoveSquares = {
  sourceSquare: string;
  destinationSquare: string;
};

type FirstMoveSolveOutcome = {
  status: FirstMoveAssessmentStatus;
  isFirstMoveCorrect: boolean;
  bestMove: string | null;
  isValidForFirstMoveAccuracy: boolean;
  invalidReason: string | null;
};

type AmyAssistantPhase = 'idle' | 'thinking' | 'analyzing' | 'coaching' | 'responding';
type AmyConversationMode = 'coach' | 'rival' | 'grandmaster' | 'club_friend' | 'minimal';

type AmyModeRhythm = {
  beatIntent: AssistantRhythmIntent;
  scheduleIntent: AssistantRhythmIntent;
  maxBeats: number;
  beatOffsetMs: number;
  phaseIntervalMs: number;
};

type AmyModeConfig = {
  label: string;
  modeIndicator: string;
  phaseLabels: Record<AmyAssistantPhase, string>;
  emotionalStates: Record<AmyAssistantPhase, string>;
  rhythm: AmyModeRhythm;
};

type AmyCueInput = {
  solveSucceeded: boolean;
  firstMoveStatus: FirstMoveAssessmentStatus | null;
  bestMove: string | null;
  meta: SolveMeta;
};

const AMY_PHASE_ROTATION: AmyAssistantPhase[] = ['thinking', 'analyzing', 'coaching'];
const AMY_CONVERSATION_MODE_ORDER: AmyConversationMode[] = [
  'coach',
  'rival',
  'grandmaster',
  'club_friend',
  'minimal',
];

const AMY_MODE_CONFIG: Record<AmyConversationMode, AmyModeConfig> = {
  coach: {
    label: 'Coach',
    modeIndicator: 'Coach mode active',
    phaseLabels: {
      idle: 'Coach mode active.',
      thinking: 'Calibrating your next training cue...',
      analyzing: 'Amy is analyzing tactical pressure...',
      coaching: 'Amy is shaping a practical plan...',
      responding: 'Amy is delivering your next cue...',
    },
    emotionalStates: {
      idle: 'Amy is focused',
      thinking: 'Reviewing your patterns',
      analyzing: 'Analyzing tactical pressure',
      coaching: 'Balancing confidence and precision',
      responding: 'Guiding your next decision',
    },
    rhythm: {
      beatIntent: 'hint',
      scheduleIntent: 'hint',
      maxBeats: 4,
      beatOffsetMs: 170,
      phaseIntervalMs: 1500,
    },
  },
  rival: {
    label: 'Rival',
    modeIndicator: 'Rival mode active',
    phaseLabels: {
      idle: 'Rival mode active.',
      thinking: 'Measuring your tactical speed...',
      analyzing: 'Amy is testing move-order discipline...',
      coaching: 'Amy is preparing a hard verdict...',
      responding: 'Amy is calling the line directly...',
    },
    emotionalStates: {
      idle: 'Amy is focused',
      thinking: 'Tracking decision speed',
      analyzing: 'Analyzing tactical pressure',
      coaching: 'Reviewing your patterns',
      responding: 'Applying competitive pressure',
    },
    rhythm: {
      beatIntent: 'hint',
      scheduleIntent: 'hint',
      maxBeats: 3,
      beatOffsetMs: 120,
      phaseIntervalMs: 1250,
    },
  },
  grandmaster: {
    label: 'Grandmaster',
    modeIndicator: 'Grandmaster mode active',
    phaseLabels: {
      idle: 'Grandmaster mode active.',
      thinking: 'Pruning non-forcing branches...',
      analyzing: 'Amy is evaluating forcing continuations...',
      coaching: 'Amy is condensing principal variation...',
      responding: 'Amy is presenting the critical line...',
    },
    emotionalStates: {
      idle: 'Amy is focused',
      thinking: 'Filtering practical noise',
      analyzing: 'Analyzing tactical pressure',
      coaching: 'Reviewing your patterns',
      responding: 'Enforcing forcing-line clarity',
    },
    rhythm: {
      beatIntent: 'hint',
      scheduleIntent: 'hint',
      maxBeats: 3,
      beatOffsetMs: 140,
      phaseIntervalMs: 1700,
    },
  },
  club_friend: {
    label: 'Club Friend',
    modeIndicator: 'Club Friend mode active',
    phaseLabels: {
      idle: 'Club Friend mode active.',
      thinking: 'Reading the position with you...',
      analyzing: 'Amy is checking tactical pressure...',
      coaching: 'Amy is shaping a friendly plan...',
      responding: 'Amy is sharing the next idea...',
    },
    emotionalStates: {
      idle: 'Amy is focused',
      thinking: 'Reviewing your patterns',
      analyzing: 'Analyzing tactical pressure',
      coaching: 'Building practical confidence',
      responding: 'Keeping the rhythm relaxed',
    },
    rhythm: {
      beatIntent: 'chat',
      scheduleIntent: 'chat',
      maxBeats: 5,
      beatOffsetMs: 180,
      phaseIntervalMs: 1550,
    },
  },
  minimal: {
    label: 'Minimal',
    modeIndicator: 'Minimal mode active',
    phaseLabels: {
      idle: 'Minimal mode active.',
      thinking: 'Selecting only essentials...',
      analyzing: 'Amy is filtering tactical priorities...',
      coaching: 'Amy is reducing to one actionable cue...',
      responding: 'Amy is sending concise guidance...',
    },
    emotionalStates: {
      idle: 'Amy is focused',
      thinking: 'Prioritizing one clean line',
      analyzing: 'Analyzing tactical pressure',
      coaching: 'Reviewing your patterns',
      responding: 'Minimizing noise',
    },
    rhythm: {
      beatIntent: 'status',
      scheduleIntent: 'status',
      maxBeats: 2,
      beatOffsetMs: 80,
      phaseIntervalMs: 1100,
    },
  },
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

function dataUrlToFile(dataUrl: string, fileName: string): File | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) {
    return null;
  }

  const mimeType = match[1];
  const base64Payload = match[2];
  try {
    const binary = window.atob(base64Payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    const safeFileName = fileName.trim() ? fileName : `retry-puzzle-${Date.now()}.jpg`;
    return new File([bytes], safeFileName, { type: mimeType });
  } catch {
    return null;
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

function getSquareCenterPoint(square: string): BoardPoint | null {
  if (!/^[a-h][1-8]$/.test(square)) {
    return null;
  }
  const fileIndex = BOARD_FILES.indexOf(square[0] as (typeof BOARD_FILES)[number]);
  const rank = Number(square[1]);
  const rowIndex = 8 - rank;
  if (fileIndex < 0 || rowIndex < 0 || rowIndex > 7) {
    return null;
  }
  return {
    x: ((fileIndex + 0.5) / 8) * 100,
    y: ((rowIndex + 0.5) / 8) * 100,
  };
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

function extractMoveSquares(moveUci: string | null): MoveSquares | null {
  const normalized = normalizeUciMove(moveUci);
  if (!normalized) {
    return null;
  }
  return {
    sourceSquare: normalized.slice(0, 2),
    destinationSquare: normalized.slice(2, 4),
  };
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

function buildAmyCue(input: AmyCueInput, mode: AmyConversationMode): string {
  if (mode === 'minimal') {
    if (!input.solveSucceeded) {
      return 'Recheck board.';
    }
    if (input.firstMoveStatus === 'correct') {
      return input.meta.mateFound === true ? 'Right first move. Force checks.' : 'Correct first move.';
    }
    if (input.firstMoveStatus === 'almost_correct') {
      return 'Close. Move order.';
    }
    if (input.bestMove) {
      return `Key move: ${input.bestMove}.`;
    }
    return 'Checks first.';
  }

  if (!input.solveSucceeded) {
    if (mode === 'rival') {
      return 'You rushed the read. Recheck crop and side to move, then solve again.';
    }
    if (mode === 'grandmaster') {
      return 'Position input is unstable. Verify side to move and board clarity before calculation.';
    }
    if (mode === 'club_friend') {
      return 'Position read looks off. Let us clean the crop and retry together.';
    }
    return 'You are close. This position still looks unstable. Recheck crop and side to move, then run it again.';
  }

  if (input.firstMoveStatus === 'correct') {
    if (mode === 'rival') {
      return 'You found the right move. Convert without drift.';
    }
    if (mode === 'grandmaster') {
      return input.meta.mateFound === true
        ? 'Correct first move. Only forcing continuations preserve the win.'
        : 'Correct first move. Convert by prioritizing forcing tempo.';
    }
    if (mode === 'club_friend') {
      return input.meta.mateFound === true
        ? 'Nice read. First move is right, now keep it forcing with checks and captures.'
        : 'Good first move. Keep the initiative and convert step by step.';
    }
    if (input.meta.mateFound === true) {
      return 'That first move is right. Keep the initiative with forcing checks and captures.';
    }
    return 'You chose the right first move. Convert cleanly from here.';
  }

  if (input.firstMoveStatus === 'almost_correct') {
    if (mode === 'rival') {
      return 'You saw the tactic late. Move order beat you.';
    }
    if (mode === 'grandmaster') {
      return 'Idea recognized, execution imprecise. Move order decides the line.';
    }
    if (mode === 'club_friend') {
      return 'Good idea. Small move-order adjustment and you have it.';
    }
    return 'Close. The idea is there, but move order is the key.';
  }

  if (input.bestMove) {
    if (mode === 'rival') {
      return `You missed the forcing move: ${input.bestMove}.`;
    }
    if (mode === 'grandmaster') {
      return `Only forcing line works. Start with ${input.bestMove}.`;
    }
    if (mode === 'club_friend') {
      return `Good try. The tactical key is ${input.bestMove}.`;
    }
    return `This feels playable until one forcing move appears. The key move is ${input.bestMove}.`;
  }

  if (mode === 'rival') {
    return 'No forcing line, no progress. Start with checks.';
  }
  if (mode === 'grandmaster') {
    return 'Prioritize checks, captures, then direct threats.';
  }
  if (mode === 'club_friend') {
    return 'Let us scan checks, captures, and threats one move at a time.';
  }
  return 'This line collapses after a forcing sequence. Start with checks, then captures, then direct threats.';
}

export default function SolveTestClient() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const { user, isLoading: isUserLoading } = useUser();
  const router = useRouter();
  const searchParams = useSearchParams();
  const retrySubmissionId = searchParams?.get('retrySubmissionId')?.trim() ?? '';
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
  const [coachCueBeats, setCoachCueBeats] = useState<string[]>([]);
  const [amyPhase, setAmyPhase] = useState<AmyAssistantPhase>('idle');
  const [, setAmyIsTyping] = useState(false);
  const [amyConversationMode, setAmyConversationMode] = useState<AmyConversationMode>('coach');
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
  const [parallaxTiltX, setParallaxTiltX] = useState(0);
  const [parallaxTiltY, setParallaxTiltY] = useState(0);
  const [hasVerifiedAuthState, setHasVerifiedAuthState] = useState(false);
  const [hasAuthenticatedSession, setHasAuthenticatedSession] = useState(false);
  const appliedThemeScopeRef = React.useRef<string | null>(null);
  const hydratedRetrySubmissionIdRef = React.useRef<string | null>(null);
  const submitStatusReturnTimerRef = React.useRef<number | null>(null);
  const submitStatusResetTimerRef = React.useRef<number | null>(null);
  const amyPhaseCycleTimerRef = React.useRef<number | null>(null);
  const amyPhaseIdleTimerRef = React.useRef<number | null>(null);
  const amyStreamTimersRef = React.useRef<number[]>([]);

  const clearAmyTimers = React.useCallback(() => {
    if (amyPhaseCycleTimerRef.current !== null) {
      window.clearInterval(amyPhaseCycleTimerRef.current);
      amyPhaseCycleTimerRef.current = null;
    }
    if (amyPhaseIdleTimerRef.current !== null) {
      window.clearTimeout(amyPhaseIdleTimerRef.current);
      amyPhaseIdleTimerRef.current = null;
    }
    amyStreamTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    amyStreamTimersRef.current = [];
  }, []);

  const resetAmyState = React.useCallback(() => {
    clearAmyTimers();
    setAmyPhase('idle');
    setAmyIsTyping(false);
    setCoachCueBeats([]);
  }, [clearAmyTimers]);

  const beginAmyThinkingCycle = React.useCallback(() => {
    clearAmyTimers();
    setAmyIsTyping(true);
    setAmyPhase('thinking');
    const phaseIntervalMs = AMY_MODE_CONFIG[amyConversationMode].rhythm.phaseIntervalMs;
    let phaseIndex = 0;
    amyPhaseCycleTimerRef.current = window.setInterval(() => {
      phaseIndex = (phaseIndex + 1) % AMY_PHASE_ROTATION.length;
      setAmyPhase(AMY_PHASE_ROTATION[phaseIndex]);
    }, phaseIntervalMs);
  }, [amyConversationMode, clearAmyTimers]);

  const streamAmyCue = React.useCallback(
    (text: string, mode: AmyConversationMode) => {
      clearAmyTimers();
      const modeRhythm = AMY_MODE_CONFIG[mode].rhythm;
      const beats = buildConversationalBeats(text, {
        intent: modeRhythm.beatIntent,
        maxBeats: modeRhythm.maxBeats,
      });
      setCoachCueBeats([]);
      if (beats.length === 0) {
        setAmyPhase('idle');
        setAmyIsTyping(false);
        return;
      }

      setAmyPhase('responding');
      setAmyIsTyping(true);
      const schedule = buildBeatScheduleMs(beats, modeRhythm.scheduleIntent).map(
        (delay, idx) => delay + idx * modeRhythm.beatOffsetMs,
      );

      beats.forEach((beat, idx) => {
        const timer = window.setTimeout(() => {
          setCoachCueBeats((previous) => [...previous, beat]);
          if (idx === beats.length - 1) {
            setAmyIsTyping(false);
            amyPhaseIdleTimerRef.current = window.setTimeout(() => {
              setAmyPhase('idle');
              amyPhaseIdleTimerRef.current = null;
            }, 420);
          }
        }, schedule[idx]);
        amyStreamTimersRef.current.push(timer);
      });
    },
    [clearAmyTimers],
  );

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
    if (!isMounted || isUserLoading) {
      return;
    }

    const syncAuthState = () => {
      const localAuthUser = readActiveLocalAuthUser();
      const hasSession =
        Boolean(user?.sub) ||
        Boolean(localAuthUser?.id && localAuthUser?.sessionToken);
      setHasAuthenticatedSession(hasSession);
      setHasVerifiedAuthState(true);
      if (!hasSession) {
        const returnTo =
          typeof window === 'undefined'
            ? '/solve-test'
            : `${window.location.pathname}${window.location.search}`;
        router.replace(`/login-test?mode=login&returnTo=${encodeURIComponent(returnTo)}`);
      }
    };

    syncAuthState();
    window.addEventListener('storage', syncAuthState);
    window.addEventListener('focus', syncAuthState);
    window.addEventListener(LOCAL_AUTH_ACTIVE_USER_UPDATED_EVENT, syncAuthState);

    return () => {
      window.removeEventListener('storage', syncAuthState);
      window.removeEventListener('focus', syncAuthState);
      window.removeEventListener(LOCAL_AUTH_ACTIVE_USER_UPDATED_EVENT, syncAuthState);
    };
  }, [isMounted, isUserLoading, router, user?.sub]);

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
    window.addEventListener(LOCAL_AUTH_ACTIVE_USER_UPDATED_EVENT, syncSettingsScope);
    return () => {
      window.removeEventListener('storage', syncSettingsScope);
      window.removeEventListener('focus', syncSettingsScope);
      window.removeEventListener(LOCAL_AUTH_ACTIVE_USER_UPDATED_EVENT, syncSettingsScope);
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
    return () => {
      clearAmyTimers();
    };
  }, [clearAmyTimers]);

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
    return '/backend';
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const storedMode = window.localStorage.getItem(AMY_CONVERSATION_MODE_STORAGE_KEY);
    if (!storedMode || !AMY_CONVERSATION_MODE_ORDER.includes(storedMode as AmyConversationMode)) {
      return;
    }
    setAmyConversationMode(storedMode as AmyConversationMode);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem(AMY_CONVERSATION_MODE_STORAGE_KEY, amyConversationMode);
  }, [amyConversationMode]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function loadStoredSubmissions() {
      try {
        const auth = await getRequestAuthContextClient();
        if (!auth.hasAnyAuth) {
          return;
        }

        const response = await fetch(`${backendUrl}/puzzles/submissions?limit=500`, {
          method: 'GET',
          headers: auth.headers,
          signal: controller.signal,
          cache: 'no-store',
        });

        if (!response.ok) {
          return;
        }

        const { payload } = await readResponsePayload(response);
        if (cancelled || !Array.isArray(payload)) {
          return;
        }
        const incoming = payload as PuzzleSubmissionRecord[];
        const existingLocal = readPuzzleSubmissions();
        if (incoming.length === 0 && existingLocal.length > 0) {
          // Defensive fallback: keep local solved history if server-side history
          // is temporarily empty (for example due to auth linkage drift).
          return;
        }
        replacePuzzleSubmissions(incoming);
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

  useEffect(() => {
    if (!retrySubmissionId) {
      return;
    }
    if (hydratedRetrySubmissionIdRef.current === retrySubmissionId) {
      return;
    }

    hydratedRetrySubmissionIdRef.current = retrySubmissionId;
    const submission = readPuzzleSubmissions().find((entry) => entry.id === retrySubmissionId);
    if (!submission) {
      setError('Could not load this review puzzle from your saved submission history.');
      return;
    }

    const imageDataUrl =
      typeof submission.originalPuzzleImageDataUrl === 'string' &&
      submission.originalPuzzleImageDataUrl.startsWith('data:image/')
        ? submission.originalPuzzleImageDataUrl
        : null;
    if (!imageDataUrl) {
      setError('This review puzzle has no stored image available to preload.');
      return;
    }

    const hydratedFile = dataUrlToFile(imageDataUrl, submission.fileName || `retry-${submission.id}.jpg`);
    if (!hydratedFile) {
      setError('Failed to prepare the review puzzle image. Please upload it manually.');
      return;
    }

    setFile(hydratedFile);
    setSolutionLines([]);
    setSolveMeta(null);
    resetAmyState();
    setSubmitStatus('idle');
    setError(null);
    setSelectedSourceSquare(null);
    setFirstMoveAttempt(null);
    setFirstMoveSolveOutcome(null);
    setAttemptId(createAttemptId());
    setAttemptStartedAtMs(performance.now());
    setQueenIsWhite(submission.expectedSideToMove === 'white');
  }, [resetAmyState, retrySubmissionId]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const chosen = e.target.files?.[0] ?? null;
    setFile(chosen);
    setSolutionLines([]);
    setSolveMeta(null);
    resetAmyState();
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
    resetAmyState();
    setSubmitStatus('sending');
    setFirstMoveSolveOutcome(null);

    if (!file) {
      setError('Please choose an image first.');
      setSubmitStatus('idle');
      return;
    }

    const formData = new FormData();
    formData.append('image', file);
    formData.append('expected_side_to_move', queenIsWhite ? 'white' : 'black');
    formData.append('attempt_id', attemptId);
    if (firstMoveAttempt) {
      formData.append('first_move_uci', firstMoveAttempt.moveUci);
      formData.append('time_to_first_move_seconds', String(firstMoveAttempt.timeToFirstMoveSeconds));
      formData.append('attempt_created_at', firstMoveAttempt.createdAt);
    }
    formData.append('puzzle_id', createPuzzleId(null, file));
    const solveStartedAt = performance.now();

    beginAmyThinkingCycle();
    setLoading(true);

    try {
      const auth = await getRequestAuthContextClient();
      if (!auth.hasAnyAuth) {
        setError('Authentication is required. Please log in and try again.');
        setSubmitStatus('idle');
        clearAmyTimers();
        setAmyPhase('idle');
        setAmyIsTyping(false);
        return;
      }
      const localAuthUserId = auth.localAuthUserId;

      const res = await fetch(`${backendUrl}/solve`, {
        method: 'POST',
        headers: auth.headers,
        body: formData,
      });

      const { payload, text } = await readResponsePayload<SolveResponse>(res);
      const data = payload ?? {};

      if (!res.ok) {
        const msg = responseErrorMessage(data, `Error ${res.status}`, text);

        setError(msg);
        setSubmitStatus('idle');
        clearAmyTimers();
        setAmyPhase('idle');
        setAmyIsTyping(false);
      } else {
        const lines = extractSolutionLines(data);
        const normalizedLines = lines.length ? lines : ['(No solution returned)'];
        const meta = extractSolveMeta(data);
        const bestMove = extractFirstUciMove(data);
        const firstMoveClassification = firstMoveAttempt
          ? classifyFirstMove(firstMoveAttempt.moveUci, bestMove)
          : null;
        setSolutionLines(normalizedLines);
        setSolveMeta(meta);
        streamAmyCue(
          buildAmyCue(
            {
              solveSucceeded: isSuccessfulSolve(data),
              firstMoveStatus: firstMoveClassification?.status ?? null,
              bestMove,
              meta,
            },
            amyConversationMode,
          ),
          amyConversationMode,
        );
        setSubmitStatus('done');

        if (isSuccessfulSolve(data)) {
          const solveTimeMs = Math.max(0, Math.round(performance.now() - solveStartedAt));
          const originalPuzzleImageDataUrl = await createSubmissionImageDataUrl(file);
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
          if (firstMoveAttempt && firstMoveClassification) {
            setFirstMoveSolveOutcome({
              status: firstMoveClassification.status,
              isFirstMoveCorrect: firstMoveClassification.isFirstMoveCorrect,
              bestMove,
              isValidForFirstMoveAccuracy,
              invalidReason,
            });
          }
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
            firstMoveAssessment:
              firstMoveAttempt && firstMoveClassification
                ? {
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
                  }
                : null,
          });
        }
      }
    } catch (err: unknown) {
      const message =
        err instanceof TypeError && err.message.toLowerCase().includes('fetch')
          ? `Browser could not connect to the solver at ${backendUrl}. Verify ${backendUrl}/health returns {"status":"ok"}, then check CORS/CSP for this frontend origin.`
          : err instanceof Error
            ? err.message
            : 'Network error';
      setError(message);
      setSubmitStatus('idle');
      clearAmyTimers();
      setAmyPhase('idle');
      setAmyIsTyping(false);
    } finally {
      if (amyPhaseCycleTimerRef.current !== null) {
        window.clearInterval(amyPhaseCycleTimerRef.current);
        amyPhaseCycleTimerRef.current = null;
      }
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

  const handleMobileNavClick = (target: 'home' | 'training' | 'profile') => {
    if (loading || isTransitioningToDashboard) {
      return;
    }
    setIsTransitioningToDashboard(true);
    const section =
      target === 'training' ? 'Training' : target === 'profile' ? 'Settings' : 'Dashboard';
    window.setTimeout(() => {
      router.push(`/dashboard?section=${encodeURIComponent(section)}`);
    }, 280);
  };

  const handlePanelPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const relativeX = (event.clientX - rect.left) / rect.width;
    const relativeY = (event.clientY - rect.top) / rect.height;
    const centeredX = (relativeX - 0.5) * 2;
    const centeredY = (relativeY - 0.5) * 2;
    setParallaxTiltX(Number((centeredX * 8).toFixed(2)));
    setParallaxTiltY(Number((centeredY * 8).toFixed(2)));
  };

  const handlePanelPointerLeave = () => {
    setParallaxTiltX(0);
    setParallaxTiltY(0);
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
  const displayedAmyPhase: AmyAssistantPhase =
    amyPhase === 'idle' && loading ? 'thinking' : amyPhase;
  const analysisIsActive =
    loading ||
    displayedAmyPhase === 'thinking' ||
    displayedAmyPhase === 'analyzing' ||
    displayedAmyPhase === 'coaching' ||
    displayedAmyPhase === 'responding';
  const attemptedMoveSquares = useMemo(
    () => (firstMoveAttempt ? extractMoveSquares(firstMoveAttempt.moveUci) : null),
    [firstMoveAttempt],
  );
  const bestMoveSquares = useMemo(
    () => extractMoveSquares(firstMoveSolveOutcome?.bestMove ?? null),
    [firstMoveSolveOutcome],
  );
  const tacticalMoveSquares = bestMoveSquares ?? attemptedMoveSquares;
  const tacticalSourceSquare = tacticalMoveSquares?.sourceSquare ?? null;
  const tacticalDestinationSquare = tacticalMoveSquares?.destinationSquare ?? null;
  const tacticalSourcePoint = useMemo(
    () => (tacticalSourceSquare ? getSquareCenterPoint(tacticalSourceSquare) : null),
    [tacticalSourceSquare],
  );
  const tacticalDestinationPoint = useMemo(
    () => (tacticalDestinationSquare ? getSquareCenterPoint(tacticalDestinationSquare) : null),
    [tacticalDestinationSquare],
  );
  const pathGradientId = useMemo(
    () => `amy-path-${fileInputId.replace(/[^a-zA-Z0-9_-]/g, '')}`,
    [fileInputId],
  );
  const tacticalPath =
    tacticalSourcePoint && tacticalDestinationPoint
      ? {
          x1: tacticalSourcePoint.x,
          y1: tacticalSourcePoint.y,
          x2: tacticalDestinationPoint.x,
          y2: tacticalDestinationPoint.y,
        }
      : null;
  const tacticalDangerActive =
    !loading &&
    (firstMoveSolveOutcome?.status === 'incorrect' || firstMoveSolveOutcome?.status === 'almost_correct');
  const confidenceScore =
    solveMeta?.confidence === null || solveMeta?.confidence === undefined
      ? 0.5
      : Math.min(1, Math.max(0, solveMeta.confidence));
  const phasePressureBoost = analysisIsActive ? 0.2 : 0;
  const outcomePressureBoost =
    firstMoveSolveOutcome?.status === 'incorrect'
      ? 0.4
      : firstMoveSolveOutcome?.status === 'almost_correct'
        ? 0.26
        : firstMoveSolveOutcome?.status === 'correct'
          ? 0.1
          : 0;
  const pressureLevel = Math.min(1, Math.max(0.2, (1 - confidenceScore) * 0.5 + phasePressureBoost + outcomePressureBoost));
  const boardIntensityStyle = {
    '--amy-board-pressure': pressureLevel.toFixed(2),
    '--amy-eval-strength': confidenceScore.toFixed(2),
    '--amy-parallax-x': `${parallaxTiltX}px`,
    '--amy-parallax-y': `${parallaxTiltY}px`,
  } as React.CSSProperties;
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

  if (!isMounted || !hasVerifiedAuthState || !hasAuthenticatedSession) {
    return <main className="min-h-screen flex items-center justify-center p-4 sm:p-6" />;
  }

  return (
    <main
      className="min-h-screen overflow-x-clip flex items-start justify-center px-3 pb-24 pt-4 sm:px-4 sm:pb-28 md:items-center md:p-6 cinematic-amy-scene"
      style={{ background: pageBackground }}
    >
      <div className="amy-scene-atmosphere" aria-hidden="true">
        <span className="amy-scene-atmosphere__orb amy-scene-atmosphere__orb--a" />
        <span className="amy-scene-atmosphere__orb amy-scene-atmosphere__orb--b" />
        <span className="amy-scene-atmosphere__orb amy-scene-atmosphere__orb--c" />
      </div>
      <div
        className={`w-full max-w-[520px] transition-all duration-300 solve-cinematic-shell ${
          analysisIsActive ? 'solve-cinematic-shell--active' : ''
        } ${
          isTransitioningToDashboard
            ? 'opacity-0 scale-[0.98] translate-y-1'
            : 'opacity-100 scale-100 translate-y-0'
        }`}
        style={boardIntensityStyle}
      >
        <div
          className="neumo-surface p-5 sm:p-6 md:p-10 relative solve-cinematic-panel"
          style={chessAppPanelStyle}
          onPointerMove={handlePanelPointerMove}
          onPointerLeave={handlePanelPointerLeave}
        >
          <div className="solve-cinematic-layer solve-cinematic-layer--back" aria-hidden="true" />
          <div className="solve-cinematic-layer solve-cinematic-layer--mid" aria-hidden="true" />
          <div className="solve-cinematic-layer solve-cinematic-layer--front" aria-hidden="true" />
          <div className="absolute left-3 top-3 sm:left-4 sm:top-4">
            <button
              type="button"
              onClick={handleQueenClick}
              disabled={controlsLocked}
              className={`neumo-pill h-10 w-10 sm:h-12 sm:w-12 flex items-center justify-center disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:translate-y-0 ${pressable}`}
              style={themedButtonStyle}
              aria-label={`Side to move: ${queenIsWhite ? 'white' : 'black'}. Click to toggle.`}
              title={`Side to move: ${queenIsWhite ? 'white' : 'black'}`}
            >
              <Crown
                className="h-5 w-5 sm:h-6 sm:w-6 transition-colors duration-200"
                color={queenStroke}
                fill={queenIsWhite ? 'none' : queenStroke}
                strokeWidth={2.2}
              />
            </button>
          </div>

          <div className="absolute right-3 top-3 flex max-w-[72%] flex-wrap items-center justify-end gap-2 sm:right-4 sm:top-4 sm:max-w-none">
            <button
              type="button"
              onClick={handleDashboardClick}
              disabled={controlsLocked}
              className={`relative neumo-pill px-3 py-2 text-sm flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed ${pressable}`}
              style={themedButtonStyle}
              aria-label="Open dashboard"
            >
              <LayoutDashboard className="h-4 w-4" />
              <span className="hidden sm:inline">Dashboard</span>
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
              className={`neumo-pill px-3 sm:px-4 py-2 text-sm disabled:opacity-60 disabled:cursor-not-allowed ${pressable}`}
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
                  className={`neumo-pill px-6 py-3 text-base sm:px-8 sm:py-4 sm:text-lg font-medium tracking-tight ${pressable} ${controlsLocked ? 'cursor-not-allowed opacity-60 pointer-events-none' : 'cursor-pointer'}`}
                  style={themedButtonStyle}
                >
                  Upload Image
                </label>
              </div>
            )}

            <div className={`${file ? 'mt-6' : 'mt-10'} flex justify-center`}>
              {previewUrl ? (
                <div className="space-y-3">
                  <div className="neumo-ring h-[240px] w-[240px] rounded-[28px] p-4 sm:h-[260px] sm:w-[260px] flex items-center justify-center chess-board-shell">
                    <div
                      className={`w-full h-full rounded-[20px] overflow-hidden flex items-center justify-center relative chess-board-stage ${
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
                        className="w-full h-full object-cover chess-board-image"
                      />
                      {canClickPuzzleToReplace ? (
                        <div className="absolute inset-0 bg-black/0 hover:bg-black/25 transition-colors duration-150 flex items-center justify-center">
                          <span className="text-white text-sm font-medium opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                            Click to replace image
                          </span>
                        </div>
                      ) : (
                        <div className="absolute inset-0">
                          <div className="absolute inset-0 grid grid-cols-8 grid-rows-8">
                            {Array.from({ length: 64 }, (_, idx) => {
                              const row = Math.floor(idx / 8);
                              const col = idx % 8;
                              const square = squareFromBoardIndex(row, col);
                              const isSelectedSource = selectedSourceSquare === square;
                              const isSelectedDestination = firstMoveAttempt?.destinationSquare === square;
                              const isCommittedSource = firstMoveAttempt?.sourceSquare === square;
                              const isTacticalSource = tacticalSourceSquare === square;
                              const isTacticalDestination = tacticalDestinationSquare === square;
                              const isDangerSquare = tacticalDangerActive && isTacticalDestination;
                              return (
                                <button
                                  key={square}
                                  type="button"
                                  onClick={() => handleSquareClick(square)}
                                  disabled={controlsLocked}
                                  className={`border border-black/15 dark:border-white/10 transition-colors chess-square-cell ${
                                    isSelectedSource
                                      ? 'bg-sky-500/35'
                                      : isCommittedSource || isSelectedDestination
                                        ? 'bg-emerald-500/35'
                                        : 'bg-transparent hover:bg-white/12'
                                  } ${isTacticalSource ? 'chess-square-cell--source' : ''} ${
                                    isTacticalDestination ? 'chess-square-cell--target' : ''
                                  } ${isDangerSquare ? 'chess-square-cell--danger' : ''}`}
                                  aria-label={`Select square ${square}`}
                                />
                              );
                            })}
                          </div>
                          {tacticalPath && !canClickPuzzleToReplace && (
                            <div className="absolute inset-0 pointer-events-none chess-board-intelligence">
                              <svg
                                viewBox="0 0 100 100"
                                preserveAspectRatio="none"
                                className="h-full w-full overflow-visible"
                                aria-hidden="true"
                              >
                                <defs>
                                  <linearGradient id={pathGradientId} x1="0%" y1="0%" x2="100%" y2="0%">
                                    <stop offset="0%" stopColor="rgba(56, 189, 248, 0.08)" />
                                    <stop offset="45%" stopColor="rgba(56, 189, 248, 0.88)" />
                                    <stop offset="100%" stopColor="rgba(244, 114, 182, 0.82)" />
                                  </linearGradient>
                                </defs>
                                <line
                                  x1={tacticalPath.x1}
                                  y1={tacticalPath.y1}
                                  x2={tacticalPath.x2}
                                  y2={tacticalPath.y2}
                                  className="chess-intel-path-line"
                                  stroke={`url(#${pathGradientId})`}
                                />
                                <circle
                                  cx={tacticalPath.x2}
                                  cy={tacticalPath.y2}
                                  r="2.8"
                                  className="chess-intel-path-dot"
                                />
                              </svg>
                            </div>
                          )}
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
                  <div className="neumo-ring h-[240px] w-[240px] rounded-[28px] p-4 sm:h-[260px] sm:w-[260px] flex items-center justify-center">
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

          <div className="mt-8 neumo-surface-soft p-5 sm:p-6 md:p-8 solve-cinematic-solution" style={chessAppPanelStyle}>
            <h2 className="mb-4 text-2xl font-semibold tracking-tight sm:mb-5 sm:text-3xl md:text-4xl">Solution</h2>

            {coachCueBeats.length > 0 && (
              <div className="mb-5 space-y-2">
                {coachCueBeats.map((beat, idx) => (
                  <p
                    key={`${idx}-${beat}`}
                    className="whitespace-pre-line text-sm font-medium opacity-85 chess-stream-item"
                  >
                    {beat}
                  </p>
                ))}
              </div>
            )}

            {solutionLines.length > 0 ? (
              <ol className="space-y-3 text-lg leading-snug sm:text-2xl md:text-[28px]">
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
                  <p className="mt-4 whitespace-pre-line text-xs opacity-70 chess-stream-item">
                    {formatConversationalText(
                      'This position may be misread. Use a cleaner crop, then verify the side selector in the top-left.',
                      { intent: 'status', maxBeats: 3 },
                    )}
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
      <nav className="fixed inset-x-3 bottom-3 z-40 lg:hidden" aria-label="Mobile navigation">
        <div
          className="mx-auto flex w-full max-w-xl items-center gap-2 rounded-2xl border border-slate-200/70 bg-white/70 p-2 shadow-[0_14px_34px_rgba(15,23,42,0.2)] backdrop-blur-xl dark:border-slate-500/65 dark:bg-slate-900/78"
          style={chessAppPanelStyle}
        >
          <button
            type="button"
            onClick={() => handleMobileNavClick('home')}
            className="flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-[11px] font-semibold text-slate-500 transition hover:text-slate-700 dark:text-slate-300 dark:hover:text-slate-100"
          >
            <House className="h-4 w-4" />
            <span className="truncate">Home</span>
          </button>
          <button
            type="button"
            className="flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-[11px] font-semibold neumo-pill text-slate-800 dark:text-slate-100"
            aria-current="page"
          >
            <Puzzle className="h-4 w-4" />
            <span className="truncate">Solve</span>
          </button>
          <button
            type="button"
            onClick={() => handleMobileNavClick('training')}
            className="flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-[11px] font-semibold text-slate-500 transition hover:text-slate-700 dark:text-slate-300 dark:hover:text-slate-100"
          >
            <Activity className="h-4 w-4" />
            <span className="truncate">Training</span>
          </button>
          <button
            type="button"
            onClick={() => handleMobileNavClick('profile')}
            className="flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-[11px] font-semibold text-slate-500 transition hover:text-slate-700 dark:text-slate-300 dark:hover:text-slate-100"
          >
            <UserRound className="h-4 w-4" />
            <span className="truncate">Profile</span>
          </button>
        </div>
      </nav>
    </main>
  );
}
