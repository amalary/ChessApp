'use client';

import React, { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import Image from 'next/image';
import { useUser } from '@auth0/nextjs-auth0/client';
import { useTheme } from 'next-themes';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Activity,
  ArrowLeft,
  BarChart3,
  Bot,
  ChevronDown,
  ChevronUp,
  House,
  LayoutDashboard,
  LogOut,
  Puzzle,
  Settings,
  UserRound,
} from 'lucide-react';
import { AgentPage } from './agent-panel';
import { PuzzleLabPanel } from './puzzle-lab-panel';
import { TrainingPanel } from './training-panel';
import {
  getPuzzleSubmissionUpdateEventName,
  estimatePuzzleElo,
  markPuzzleSubmissionNotificationsSeen,
  readPuzzleSubmissions,
  replacePuzzleSubmissions,
  type PuzzleSubmissionRecord,
} from '@/lib/puzzle-submissions';
import {
  LOCAL_AUTH_ACTIVE_USER_UPDATED_EVENT,
  readActiveLocalAuthUser,
  readScopedStorageValue,
  resolveUserSettingsScope,
  writeActiveLocalAuthUser,
  writeScopedStorageValue,
} from '@/lib/dashboard-theme-settings';
import {
  ASSISTANT_CONVERSATION_MODE_OPTIONS,
  readAssistantConversationMode,
  writeAssistantConversationMode,
  type AssistantConversationMode,
} from '@/lib/assistant-conversation-mode';
import { readResponsePayload, responseErrorMessage } from '@/lib/http-response';
import { getRequestAuthContextClient } from 'lib/getRequestAuthContextClient';

type NavItem = {
  label: string;
  icon: React.ElementType;
};

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', icon: LayoutDashboard },
  { label: 'Analytics', icon: BarChart3 },
  { label: 'Puzzle Lab', icon: Puzzle },
  { label: 'Training', icon: Activity },
  { label: 'Agent', icon: Bot },
  { label: 'Settings', icon: Settings },
];

type MobileNavKey = 'home' | 'solve' | 'training' | 'profile';

const RANGE_TABS = ['Today', 'Week', 'Month', 'Year'] as const;
const DASHBOARD_PUZZLE_ELO_RANGES = ['7 Days', '30 Days', '90 Days', 'All Time'] as const;
const DASHBOARD_PUZZLE_ELO_CATEGORIES = [
  { id: 'overall', label: 'Overall', mateIn: null },
  { id: 'mate-in-1', label: 'Mate in 1', mateIn: 1 },
  { id: 'mate-in-2', label: 'Mate in 2', mateIn: 2 },
  { id: 'mate-in-3', label: 'Mate in 3', mateIn: 3 },
] as const;
const ANALYTICS_THEMES = ['Forks', 'Pins', 'Back-Rank Mates', 'Sacrifices', 'Skewers'] as const;
const ANALYTICS_SECONDARY_SUBSECTIONS = [
  'Solve Time vs Difficulty',
  'Puzzle Rating Progression',
  'Accuracy by Difficulty',
  'First-Move Accuracy',
] as const;
const ANALYTICS_MAX_OPEN_SECONDARY_SECTIONS = 2;
const ANALYTICS_RECENT_SOLVE_LIMIT = 60;
const DIFFICULTY_ELO_BUCKET_SIZE = 200;
const DAY_MS = 86400000;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const AGENT_CHAT_SESSION_STORAGE_KEY = 'chessapp.agent.chat.session.v1';
const AGENT_CHAT_INACTIVITY_TIMEOUT_MS = 2 * 60 * 1000;
const AGENT_CHAT_BADGE_WARNING_WINDOW_MS = 60 * 1000;
const AGENT_CHAT_BADGE_POLL_INTERVAL_MS = 5 * 1000;
const DEFAULT_DASHBOARD_ACCENT = '#7A94BF';
const DEFAULT_DASHBOARD_SECONDARY = '#A58EB4';
const DEFAULT_DASHBOARD_ACCENT_CHANNELS: [number, number, number] = [122, 148, 191];
const DASHBOARD_ACCENT_STORAGE_KEY = 'chessapp.dashboard.accent';
const DASHBOARD_SECONDARY_STORAGE_KEY = 'chessapp.dashboard.secondary';
const DASHBOARD_GRADIENT_ENABLED_STORAGE_KEY = 'chessapp.dashboard.gradient.enabled';
const DASHBOARD_GRADIENT_DIRECTION_STORAGE_KEY = 'chessapp.dashboard.gradient.direction';
const DASHBOARD_THEME_MODE_STORAGE_KEY = 'chessapp.dashboard.theme.mode';
const DASHBOARD_THEME_UPDATED_EVENT = 'chessapp.dashboard.theme.updated';
const NEUMORPHIC_SWATCH_COLORS = [
  '#5F7FE0',
  '#32AFA3',
  '#86B94A',
  '#D6924C',
  '#9A6FD8',
  '#3D9CDB',
] as const;
const ACCURACY_THEME_NEON_SWATCH_COLORS = [
  '#5B7BFF',
  '#2FD8B7',
  '#C2E94B',
  '#FFAF4E',
  '#FF74BC',
  '#46CDFF',
] as const;
const GRADIENT_DIRECTIONS = [
  { value: 'top-to-bottom', label: 'Top to bottom' },
  { value: 'diagonal', label: 'Diagonal' },
  { value: 'bottom-to-top', label: 'Bottom to top' },
] as const;

type ActivityRange = (typeof RANGE_TABS)[number];
type DashboardPuzzleEloRange = (typeof DASHBOARD_PUZZLE_ELO_RANGES)[number];
type DashboardPuzzleEloCategory = (typeof DASHBOARD_PUZZLE_ELO_CATEGORIES)[number]['id'];
type AnalyticsSecondarySubsection = (typeof ANALYTICS_SECONDARY_SUBSECTIONS)[number];
type PuzzleActivityData = {
  values: number[];
  axisLabels: string[];
  subtitle: string;
};

type EloTrendData = {
  values: number[];
  axisLabels: string[];
  subtitle: string;
};

type DashboardPuzzleEloSummary = {
  currentElo: number | null;
  bestElo: number | null;
  eloChangeLast7Days: number | null;
  eloChangeThisMonth: number | null;
  currentPuzzleStreak: number;
  weeklyAccuracyChange: number | null;
  strongestGainCategory: string | null;
  currentStreakDays: number;
  longestStreakDays: number;
};

type DashboardPuzzleEloProgressData = EloTrendData & {
  summary: DashboardPuzzleEloSummary;
  dataPointCount: number;
  insights: string[];
};

type DashboardPuzzleEloAnalyticsEvent =
  | 'Puzzle Elo Graph Viewed'
  | 'Time Filter Changed'
  | 'Category Filter Changed'
  | 'New Personal Best Reached';

type DashboardPuzzleEloAnalyticsPayload = {
  eventName: DashboardPuzzleEloAnalyticsEvent;
  range: DashboardPuzzleEloRange;
  category: DashboardPuzzleEloCategory;
  currentElo: number | null;
  bestElo: number | null;
  dataPointCount: number;
};

type DashboardPuzzleEloSummaryCard = {
  label: string;
  value: string;
  meta: string;
  priority?: boolean;
  valueClassName?: string;
};

type AccuracyTrendData = {
  values: number[];
  axisLabels: string[];
  subtitle: string;
};

type PuzzleRatingProgressionData = {
  eloValues: number[];
  accuracyValues: number[];
  axisLabels: string[];
  subtitle: string;
};

type GradientDirection = (typeof GRADIENT_DIRECTIONS)[number]['value'];
type AnalyticsTheme = (typeof ANALYTICS_THEMES)[number];
type ThemeSettings = {
  accentColor: string;
  secondaryColor: string;
  gradientEnabled: boolean;
  gradientDirection: GradientDirection;
};

type ThemeSubmissionAssessment = {
  submission: PuzzleSubmissionRecord;
  theme: AnalyticsTheme;
  reason: string;
  accuracyPercent: number;
};

type PersistedAgentChatSessionMessage = {
  role: 'assistant' | 'user';
};

type PersistedAgentChatSession = {
  messages: PersistedAgentChatSessionMessage[];
  lastActivityAtMs: number;
};

type ThemeAccuracyRow = {
  theme: AnalyticsTheme;
  accuracyPercent: number;
  solvedCount: number;
  assessments: ThemeSubmissionAssessment[];
};

type SolveTimeDifficultyBucket = {
  label: string;
  avgSolveTimeMs: number;
  solvedCount: number;
};

type SolveTimeDifficultyData = {
  buckets: SolveTimeDifficultyBucket[];
  totalSolvedCount: number;
};

type FirstMoveAccuracySummary = {
  validAttemptCount: number;
  correctCount: number;
  accuracyPercent: number | null;
  averageTimeToFirstMoveSeconds: number | null;
  commonWrongFirstMoves: Array<{
    move: string;
    count: number;
  }>;
};

type DifficultyBucketAnalyticsBucket = {
  label: string;
  totalAttempts: number;
  correctAttempts: number;
  accuracyPercentage: number;
  averageSolveTimeSeconds: number | null;
};

type DifficultyBucketAnalyticsData = {
  difficultyBuckets: DifficultyBucketAnalyticsBucket[];
  totalValidAttempts: number;
  confidenceThreshold: number;
};

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

function buildAgentChatSessionStorageKey(): string {
  const activeLocalUser = readActiveLocalAuthUser();
  const userScope =
    activeLocalUser?.id ?? activeLocalUser?.username ?? activeLocalUser?.email ?? 'anonymous';
  const normalizedScope = userScope.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 96) || 'anonymous';
  return `${AGENT_CHAT_SESSION_STORAGE_KEY}.${normalizedScope}`;
}

function readPersistedAgentChatSession(storageKey: string): PersistedAgentChatSession | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const raw = window.localStorage.getItem(storageKey);
  if (!raw) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    const candidate = parsed as {
      messages?: unknown;
      lastActivityAtMs?: unknown;
    };
    if (!Array.isArray(candidate.messages) || typeof candidate.lastActivityAtMs !== 'number') {
      return null;
    }
    const hasUserTurn = candidate.messages.some(
      (message) =>
        !!message &&
        typeof message === 'object' &&
        (message as { role?: unknown }).role === 'user',
    );
    if (!hasUserTurn) {
      return null;
    }
    return {
      messages: candidate.messages as PersistedAgentChatSessionMessage[],
      lastActivityAtMs: candidate.lastActivityAtMs,
    };
  } catch {
    return null;
  }
}

function shouldShowAgentTimeoutBadge(session: PersistedAgentChatSession | null): boolean {
  if (!session) {
    return false;
  }
  const elapsedMs = Date.now() - session.lastActivityAtMs;
  if (elapsedMs >= AGENT_CHAT_INACTIVITY_TIMEOUT_MS) {
    return false;
  }
  return elapsedMs >= AGENT_CHAT_BADGE_WARNING_WINDOW_MS;
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
  isDark: boolean,
): string {
  if (isDark) {
    if (!gradientEnabled) {
      return `radial-gradient(1150px circle at 16% 16%, rgba(148,163,184,0.16), rgba(2,6,23,0) 58%), radial-gradient(900px circle at 86% 8%, ${rgbaFromChannels(primary, 0.24)}, rgba(2,6,23,0) 56%), linear-gradient(180deg, #0F172A 0%, #020617 100%)`;
    }

    const gradientAngle = resolveGradientAngle(gradientDirection);
    return `radial-gradient(1150px circle at 16% 16%, rgba(148,163,184,0.12), rgba(2,6,23,0) 58%), radial-gradient(900px circle at 86% 8%, ${rgbaFromChannels(primary, 0.2)}, rgba(2,6,23,0) 56%), linear-gradient(${gradientAngle}, ${rgbaFromChannels(primary, 0.34)} 0%, ${rgbaFromChannels(secondary, 0.38)} 100%), linear-gradient(180deg, #0F172A 0%, #020617 100%)`;
  }

  if (!gradientEnabled) {
    if (
      primary[0] === DEFAULT_DASHBOARD_ACCENT_CHANNELS[0] &&
      primary[1] === DEFAULT_DASHBOARD_ACCENT_CHANNELS[1] &&
      primary[2] === DEFAULT_DASHBOARD_ACCENT_CHANNELS[2]
    ) {
      return `radial-gradient(1200px circle at 18% 18%, rgba(255,255,255,0.85), rgba(237,242,250,0) 60%), radial-gradient(940px circle at 88% 8%, ${rgbaFromChannels(primary, 0.2)}, rgba(255,255,255,0) 56%), linear-gradient(180deg, #dfe6f1 0%, #d9e2ef 100%)`;
    }
    return `radial-gradient(1200px circle at 18% 18%, rgba(255,255,255,0.86), rgba(237,242,250,0) 60%), radial-gradient(980px circle at 86% 10%, ${rgbaFromChannels(primary, 0.34)}, rgba(255,255,255,0) 58%), linear-gradient(180deg, ${rgbaFromChannels(primary, 0.14)} 0%, rgba(255,255,255,0.04) 100%), linear-gradient(180deg, #dfe6f1 0%, #d9e2ef 100%)`;
  }

  const gradientAngle = resolveGradientAngle(gradientDirection);
  return `radial-gradient(1200px circle at 18% 18%, rgba(255,255,255,0.78), rgba(237,242,250,0) 60%), radial-gradient(940px circle at 88% 8%, ${rgbaFromChannels(primary, 0.24)}, rgba(255,255,255,0) 56%), linear-gradient(${gradientAngle}, ${rgbaFromChannels(primary, 0.52)} 0%, ${rgbaFromChannels(secondary, 0.56)} 100%), linear-gradient(180deg, #dfe6f1 0%, #d9e2ef 100%)`;
}

function buildPanelGradientBackground(
  primary: [number, number, number],
  secondary: [number, number, number],
  gradientEnabled: boolean,
  gradientDirection: GradientDirection,
  isDark: boolean,
): string | undefined {
  if (isDark) {
    if (!gradientEnabled) {
      if (
        primary[0] === DEFAULT_DASHBOARD_ACCENT_CHANNELS[0] &&
        primary[1] === DEFAULT_DASHBOARD_ACCENT_CHANNELS[1] &&
        primary[2] === DEFAULT_DASHBOARD_ACCENT_CHANNELS[2]
      ) {
        return `linear-gradient(180deg, rgba(15,23,42,0.86) 0%, rgba(2,6,23,0.92) 100%), rgb(var(--surface))`;
      }
      return `linear-gradient(180deg, ${rgbaFromChannels(primary, 0.26)} 0%, rgba(2,6,23,0.6) 100%), linear-gradient(180deg, rgba(15,23,42,0.8) 0%, rgba(2,6,23,0.92) 100%), rgb(var(--surface))`;
    }

    const gradientAngle = resolveGradientAngle(gradientDirection);
    return `linear-gradient(${gradientAngle}, ${rgbaFromChannels(primary, 0.24)} 0%, ${rgbaFromChannels(secondary, 0.28)} 100%), linear-gradient(180deg, rgba(15,23,42,0.82) 0%, rgba(2,6,23,0.92) 100%), rgb(var(--surface))`;
  }

  if (!gradientEnabled) {
    if (
      primary[0] === DEFAULT_DASHBOARD_ACCENT_CHANNELS[0] &&
      primary[1] === DEFAULT_DASHBOARD_ACCENT_CHANNELS[1] &&
      primary[2] === DEFAULT_DASHBOARD_ACCENT_CHANNELS[2]
    ) {
      return undefined;
    }
    return `linear-gradient(180deg, ${rgbaFromChannels(primary, 0.26)} 0%, ${rgbaFromChannels(primary, 0.14)} 100%), linear-gradient(180deg, rgba(255,255,255,0.28) 0%, rgba(255,255,255,0.08) 100%), rgb(var(--surface))`;
  }

  const gradientAngle = resolveGradientAngle(gradientDirection);
  return `linear-gradient(${gradientAngle}, ${rgbaFromChannels(primary, 0.26)} 0%, ${rgbaFromChannels(secondary, 0.3)} 100%), linear-gradient(180deg, rgba(255,255,255,0.28) 0%, rgba(255,255,255,0.08) 100%), rgb(var(--surface))`;
}

function buildChartPaths(values: number[], width: number, height: number) {
  if (values.length < 2) {
    return { areaPath: '', linePath: '' };
  }

  const sanitizedValues = values.map((value) =>
    typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0,
  );
  const maxValue = Math.max(...sanitizedValues, 0);
  const step = width / (values.length - 1);
  const padTop = 18;
  const usableHeight = height - padTop - 16;
  const points = sanitizedValues.map((value, idx) => {
    const x = idx * step;
    const normalizedValue = maxValue > 0 ? value / maxValue : 0;
    const y = height - 12 - normalizedValue * usableHeight;
    return { x, y };
  });

  let curve = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const current = points[i];
    const midX = (prev.x + current.x) / 2;
    curve += ` Q ${midX} ${prev.y} ${current.x} ${current.y}`;
  }

  const areaPath = `${curve} L ${width} ${height} L 0 ${height} Z`;
  return { areaPath, linePath: curve };
}

function buildLinePathWithMax(values: number[], width: number, height: number, maxValue: number): string {
  if (values.length < 2) {
    return '';
  }

  const clampedMaxValue = Math.max(maxValue, 1);
  const sanitizedValues = values.map((value) =>
    typeof value === 'number' && Number.isFinite(value)
      ? clamp(value, 0, clampedMaxValue)
      : 0,
  );
  const step = width / (values.length - 1);
  const padTop = 18;
  const usableHeight = height - padTop - 16;
  const points = sanitizedValues.map((value, idx) => {
    const x = idx * step;
    const normalizedValue = value / clampedMaxValue;
    const y = height - 12 - normalizedValue * usableHeight;
    return { x, y };
  });

  let curve = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const current = points[i];
    const midX = (prev.x + current.x) / 2;
    curve += ` Q ${midX} ${prev.y} ${current.x} ${current.y}`;
  }

  return curve;
}

function buildYAxisTicks(values: number[]): number[] {
  const sanitizedValues = values.map((value) =>
    typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0,
  );
  const maxValue = Math.max(...sanitizedValues, 0);
  if (maxValue === 0) {
    return [0];
  }

  const rawTicks = Array.from({ length: 4 }, (_, idx) =>
    Math.round(maxValue - (idx * maxValue) / 3),
  );
  const ticks = Array.from(new Set(rawTicks));
  if (ticks[ticks.length - 1] !== 0) {
    ticks.push(0);
  }
  return ticks;
}

function StatCard({
  label,
  value,
  meta,
  onClick,
  active = false,
  cardClassName = '',
  valueClassName = '',
  metaClassName = '',
  cardStyle,
}: {
  label: string;
  value: string;
  meta: string;
  onClick?: () => void;
  active?: boolean;
  cardClassName?: string;
  valueClassName?: string;
  metaClassName?: string;
  cardStyle?: React.CSSProperties;
}) {
  const content = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className={`text-3xl font-semibold text-slate-700 ${valueClassName}`}>{value}</p>
          <p className="mt-1 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
            {label}
          </p>
        </div>
        <span className="text-fuchsia-500 text-xl leading-none">:</span>
      </div>
      <p className={`mt-4 text-xs text-slate-400 ${metaClassName}`}>{meta}</p>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`neumo-surface-soft rounded-3xl px-5 py-4 text-left transition-all duration-200 hover:-translate-y-[1px] hover:shadow-[0_8px_16px_rgba(15,23,42,0.12)] ${
          active ? 'ring-2 ring-slate-300/80' : ''
        } ${cardClassName}`}
        style={cardStyle}
      >
        {content}
      </button>
    );
  }

  return (
    <article className={`neumo-surface-soft rounded-3xl px-5 py-4 ${cardClassName}`} style={cardStyle}>
      {content}
    </article>
  );
}

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return 'Unknown time';
  }
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatConfidence(confidence: number | null): string {
  if (confidence === null) {
    return 'Unavailable';
  }
  return `${(confidence * 100).toFixed(1)}%`;
}

function formatMateStatus(submission: PuzzleSubmissionRecord): string {
  const { mateFound, mateIn } = submission.positionCheck;
  if (mateFound === null) {
    return 'Unavailable';
  }
  if (!mateFound) {
    return 'No forced mate (1-3)';
  }
  return `Mate in ${mateIn ?? '?'}`;
}

function formatSolveTimeMs(milliseconds: number): string {
  const totalSeconds = milliseconds / 1000;
  if (totalSeconds < 60) {
    return `${totalSeconds.toFixed(1)}s`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return `${minutes}m ${seconds}s`;
}

function formatSolveTimeSeconds(seconds: number): string {
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.round(seconds % 60);
  return `${minutes}m ${remaining}s`;
}

function formatDifficultyBucketLabel(label: string): string {
  if (label.includes('+')) {
    return label;
  }
  const [start, end] = label.split('-');
  if (!start || !end) {
    return label;
  }
  return `${start}\u2013${end}`;
}

function normalizeDifficultyBucketAnalyticsPayload(
  payload: unknown,
): DifficultyBucketAnalyticsData | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const candidate = payload as Record<string, unknown>;
  if (!Array.isArray(candidate.difficulty_buckets)) {
    return null;
  }

  const buckets = candidate.difficulty_buckets
    .map((row): DifficultyBucketAnalyticsBucket | null => {
      if (!row || typeof row !== 'object') {
        return null;
      }
      const entry = row as Record<string, unknown>;
      if (typeof entry.label !== 'string') {
        return null;
      }
      const totalAttempts =
        typeof entry.total_attempts === 'number' && Number.isFinite(entry.total_attempts)
          ? Math.max(0, Math.floor(entry.total_attempts))
          : 0;
      const correctAttempts =
        typeof entry.correct_attempts === 'number' && Number.isFinite(entry.correct_attempts)
          ? Math.max(0, Math.floor(entry.correct_attempts))
          : 0;
      const accuracyPercentage =
        typeof entry.accuracy_percentage === 'number' && Number.isFinite(entry.accuracy_percentage)
          ? clamp(entry.accuracy_percentage, 0, 100)
          : 0;
      const averageSolveTimeSeconds =
        typeof entry.average_solve_time_seconds === 'number' &&
        Number.isFinite(entry.average_solve_time_seconds) &&
        entry.average_solve_time_seconds >= 0
          ? entry.average_solve_time_seconds
          : null;

      return {
        label: entry.label,
        totalAttempts,
        correctAttempts: Math.min(totalAttempts, correctAttempts),
        accuracyPercentage,
        averageSolveTimeSeconds,
      };
    })
    .filter((row): row is DifficultyBucketAnalyticsBucket => row !== null);

  const totalValidAttempts =
    typeof candidate.total_valid_attempts === 'number' && Number.isFinite(candidate.total_valid_attempts)
      ? Math.max(0, Math.floor(candidate.total_valid_attempts))
      : buckets.reduce((sum, bucket) => sum + bucket.totalAttempts, 0);
  const confidenceThreshold =
    typeof candidate.confidence_threshold === 'number' && Number.isFinite(candidate.confidence_threshold)
      ? clamp(candidate.confidence_threshold, 0, 1)
      : 0.75;

  return {
    difficultyBuckets: buckets,
    totalValidAttempts,
    confidenceThreshold,
  };
}

function resolveDifficultyInsight(
  analytics: DifficultyBucketAnalyticsData | null,
): { message: string; highlightLabel: string | null } {
  const defaultMessage = 'Solve more puzzles to unlock difficulty insights.';
  if (!analytics || analytics.totalValidAttempts < 6) {
    return { message: defaultMessage, highlightLabel: null };
  }

  const bucketsWithData = analytics.difficultyBuckets.filter((bucket) => bucket.totalAttempts >= 2);
  if (bucketsWithData.length < 2) {
    return { message: defaultMessage, highlightLabel: null };
  }

  let largestDrop = 0;
  let dropLabel: string | null = null;
  for (let index = 1; index < bucketsWithData.length; index += 1) {
    const previous = bucketsWithData[index - 1];
    const current = bucketsWithData[index];
    const drop = previous.accuracyPercentage - current.accuracyPercentage;
    if (drop > largestDrop) {
      largestDrop = drop;
      dropLabel = current.label;
    }
  }

  if (dropLabel && largestDrop >= 6) {
    return {
      message: `You start struggling around ${formatDifficultyBucketLabel(dropLabel)} puzzles.`,
      highlightLabel: dropLabel,
    };
  }

  const weakest = bucketsWithData.reduce((min, bucket) =>
    bucket.accuracyPercentage < min.accuracyPercentage ? bucket : min,
  );
  if (weakest.accuracyPercentage < 70) {
    return {
      message: `You start struggling around ${formatDifficultyBucketLabel(weakest.label)} puzzles.`,
      highlightLabel: weakest.label,
    };
  }

  return {
    message: 'Performance is currently steady across your solved difficulty range.',
    highlightLabel: null,
  };
}

function buildEvenlySpacedLabels(labels: string[], maxLabels: number): string[] {
  if (labels.length <= maxLabels) {
    return labels;
  }

  const indexes = new Set<number>();
  for (let i = 0; i < maxLabels; i += 1) {
    const idx = Math.round((i * (labels.length - 1)) / (maxLabels - 1));
    indexes.add(idx);
  }

  return Array.from(indexes)
    .sort((a, b) => a - b)
    .map((idx) => labels[idx]);
}

function buildPuzzleActivityData(
  activeRange: ActivityRange,
  submissions: PuzzleSubmissionRecord[],
): PuzzleActivityData {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const hourFormatter = new Intl.DateTimeFormat(undefined, { hour: 'numeric' });
  const weekdayFormatter = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
  const monthDayFormatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
  const monthFormatter = new Intl.DateTimeFormat(undefined, { month: 'short' });

  if (activeRange === 'Today') {
    const values = Array.from({ length: 12 }, () => 0);
    const labels = Array.from({ length: 12 }, (_, idx) =>
      hourFormatter.format(new Date(todayStart.getTime() + idx * TWO_HOURS_MS)),
    );

    submissions.forEach((submission) => {
      const submittedAt = new Date(submission.submittedAt);
      if (Number.isNaN(submittedAt.getTime())) {
        return;
      }
      if (
        submittedAt.getFullYear() !== todayStart.getFullYear() ||
        submittedAt.getMonth() !== todayStart.getMonth() ||
        submittedAt.getDate() !== todayStart.getDate()
      ) {
        return;
      }

      const offset = submittedAt.getTime() - todayStart.getTime();
      const bucketIndex = Math.min(values.length - 1, Math.max(0, Math.floor(offset / TWO_HOURS_MS)));
      values[bucketIndex] += 1;
    });

    labels[labels.length - 1] = 'Now';
    return {
      values,
      axisLabels: buildEvenlySpacedLabels(labels, 6),
      subtitle: 'Submissions split across today',
    };
  }

  if (activeRange === 'Week') {
    const start = new Date(todayStart.getTime() - 6 * DAY_MS);
    const values = Array.from({ length: 7 }, () => 0);
    const labels = Array.from({ length: 7 }, (_, idx) =>
      weekdayFormatter.format(new Date(start.getTime() + idx * DAY_MS)),
    );

    submissions.forEach((submission) => {
      const submittedAt = new Date(submission.submittedAt);
      if (Number.isNaN(submittedAt.getTime())) {
        return;
      }

      const submittedDay = new Date(
        submittedAt.getFullYear(),
        submittedAt.getMonth(),
        submittedAt.getDate(),
      );
      const dayIndex = Math.floor((submittedDay.getTime() - start.getTime()) / DAY_MS);
      if (dayIndex >= 0 && dayIndex < values.length) {
        values[dayIndex] += 1;
      }
    });

    labels[labels.length - 1] = 'Today';
    return {
      values,
      axisLabels: labels,
      subtitle: 'Daily submissions over the last 7 days',
    };
  }

  if (activeRange === 'Month') {
    const start = new Date(todayStart.getTime() - 29 * DAY_MS);
    const values = Array.from({ length: 30 }, () => 0);
    const labels = Array.from({ length: 30 }, (_, idx) =>
      monthDayFormatter.format(new Date(start.getTime() + idx * DAY_MS)),
    );

    submissions.forEach((submission) => {
      const submittedAt = new Date(submission.submittedAt);
      if (Number.isNaN(submittedAt.getTime())) {
        return;
      }

      const submittedDay = new Date(
        submittedAt.getFullYear(),
        submittedAt.getMonth(),
        submittedAt.getDate(),
      );
      const dayIndex = Math.floor((submittedDay.getTime() - start.getTime()) / DAY_MS);
      if (dayIndex >= 0 && dayIndex < values.length) {
        values[dayIndex] += 1;
      }
    });

    labels[labels.length - 1] = 'Today';
    return {
      values,
      axisLabels: buildEvenlySpacedLabels(labels, 6),
      subtitle: 'Daily submissions over the last 30 days',
    };
  }

  const yearStart = new Date(todayStart.getFullYear(), todayStart.getMonth() - 11, 1);
  const values = Array.from({ length: 12 }, () => 0);
  const labels = Array.from({ length: 12 }, (_, idx) =>
    monthFormatter.format(new Date(yearStart.getFullYear(), yearStart.getMonth() + idx, 1)),
  );

  submissions.forEach((submission) => {
    const submittedAt = new Date(submission.submittedAt);
    if (Number.isNaN(submittedAt.getTime())) {
      return;
    }
    const monthIndex =
      (submittedAt.getFullYear() - yearStart.getFullYear()) * 12 +
      (submittedAt.getMonth() - yearStart.getMonth());
    if (monthIndex >= 0 && monthIndex < values.length) {
      values[monthIndex] += 1;
    }
  });

  labels[labels.length - 1] = 'This month';
  return {
    values,
    axisLabels: buildEvenlySpacedLabels(labels, 6),
    subtitle: 'Monthly submissions over the last 12 months',
  };
}

function fillMissingWithNearest(values: Array<number | null>, fallback: number): number[] {
  const next = [...values];

  for (let i = 1; i < next.length; i += 1) {
    if (next[i] === null && next[i - 1] !== null) {
      next[i] = next[i - 1];
    }
  }

  for (let i = next.length - 2; i >= 0; i -= 1) {
    if (next[i] === null && next[i + 1] !== null) {
      next[i] = next[i + 1];
    }
  }

  return next.map((value) => Math.round(value ?? fallback));
}

function resolveDashboardPuzzleEloCategoryLabel(category: DashboardPuzzleEloCategory): string {
  return DASHBOARD_PUZZLE_ELO_CATEGORIES.find((option) => option.id === category)?.label ?? 'Overall';
}

function filterDashboardPuzzleEloSubmissions(
  submissions: PuzzleSubmissionRecord[],
  category: DashboardPuzzleEloCategory,
): PuzzleSubmissionRecord[] {
  const option = DASHBOARD_PUZZLE_ELO_CATEGORIES.find((item) => item.id === category);
  if (!option || option.mateIn === null) {
    return submissions;
  }
  return submissions.filter((submission) => submission.positionCheck.mateIn === option.mateIn);
}

function buildDashboardPuzzleAccuracyChange(
  submissions: PuzzleSubmissionRecord[],
  todayStart: Date,
): number | null {
  const thisWeekStart = new Date(todayStart.getTime() - 6 * DAY_MS);
  const previousWeekStart = new Date(todayStart.getTime() - 13 * DAY_MS);
  const buildAccuracy = (start: Date, end: Date) => {
    const assessments = submissions
      .filter((submission) => {
        const submittedAt = new Date(submission.submittedAt);
        return (
          !Number.isNaN(submittedAt.getTime()) &&
          submittedAt.getTime() >= start.getTime() &&
          submittedAt.getTime() < end.getTime() &&
          submission.firstMoveAssessment?.isValidForFirstMoveAccuracy === true
        );
      })
      .map((submission) => submission.firstMoveAssessment);

    if (assessments.length === 0) {
      return null;
    }

    const correctCount = assessments.filter((assessment) => assessment?.isFirstMoveCorrect === true).length;
    return Math.round((correctCount / assessments.length) * 100);
  };
  const thisWeekAccuracy = buildAccuracy(thisWeekStart, new Date(todayStart.getTime() + DAY_MS));
  const previousWeekAccuracy = buildAccuracy(previousWeekStart, thisWeekStart);

  return thisWeekAccuracy !== null && previousWeekAccuracy !== null
    ? thisWeekAccuracy - previousWeekAccuracy
    : null;
}

function buildDashboardPuzzleCurrentStreak(submissions: PuzzleSubmissionRecord[]): number {
  const sortedSubmissions = [...submissions]
    .filter((submission) => submission.firstMoveAssessment?.isValidForFirstMoveAccuracy === true)
    .sort((a, b) => Date.parse(b.submittedAt) - Date.parse(a.submittedAt));

  let streak = 0;
  for (const submission of sortedSubmissions) {
    if (submission.firstMoveAssessment?.isFirstMoveCorrect !== true) {
      break;
    }
    streak += 1;
  }

  return streak;
}

function buildDashboardPuzzleStrongestGainCategory(
  submissions: PuzzleSubmissionRecord[],
  todayStart: Date,
): string | null {
  const monthStart = new Date(todayStart.getFullYear(), todayStart.getMonth(), 1);
  const gains = DASHBOARD_PUZZLE_ELO_CATEGORIES.filter((option) => option.mateIn !== null).map((option) => {
    const entries = submissions
      .filter((submission) => submission.positionCheck.mateIn === option.mateIn)
      .map((submission) => ({
        submittedAt: new Date(submission.submittedAt),
        elo: resolveSubmissionElo(submission),
      }))
      .filter(
        (entry) =>
          !Number.isNaN(entry.submittedAt.getTime()) &&
          entry.submittedAt.getTime() >= monthStart.getTime(),
      )
      .sort((a, b) => a.submittedAt.getTime() - b.submittedAt.getTime());
    let gain = 0;
    for (let idx = 1; idx < entries.length; idx += 1) {
      gain += Math.max(0, entries[idx].elo - entries[idx - 1].elo);
    }
    return { label: option.label, gain };
  });
  const strongest = gains.sort((a, b) => b.gain - a.gain)[0];
  return strongest && strongest.gain > 0 ? strongest.label : null;
}

function buildDashboardPuzzleEloSummary(
  entries: Array<{ submittedAt: Date; elo: number }>,
  submissions: PuzzleSubmissionRecord[],
  todayStart: Date,
): DashboardPuzzleEloSummary {
  const validEntries = entries
    .filter((entry) => !Number.isNaN(entry.submittedAt.getTime()))
    .sort((a, b) => a.submittedAt.getTime() - b.submittedAt.getTime());
  const weeklyAccuracyChange = buildDashboardPuzzleAccuracyChange(submissions, todayStart);
  const currentPuzzleStreak = buildDashboardPuzzleCurrentStreak(submissions);
  const strongestGainCategory = buildDashboardPuzzleStrongestGainCategory(submissions, todayStart);

  if (validEntries.length === 0) {
    return {
      currentElo: null,
      bestElo: null,
      eloChangeLast7Days: null,
      eloChangeThisMonth: null,
      currentPuzzleStreak,
      weeklyAccuracyChange,
      strongestGainCategory,
      currentStreakDays: 0,
      longestStreakDays: 0,
    };
  }

  const currentElo = validEntries[validEntries.length - 1].elo;
  const bestElo = Math.max(...validEntries.map((entry) => entry.elo));
  const sevenDayStart = new Date(todayStart.getTime() - 6 * DAY_MS);
  const firstRecentEntry = validEntries.find(
    (entry) => entry.submittedAt.getTime() >= sevenDayStart.getTime(),
  );
  const eloChangeLast7Days = firstRecentEntry ? currentElo - firstRecentEntry.elo : null;
  const monthStart = new Date(todayStart.getFullYear(), todayStart.getMonth(), 1);
  const firstMonthlyEntry = validEntries.find(
    (entry) => entry.submittedAt.getTime() >= monthStart.getTime(),
  );
  const eloChangeThisMonth = firstMonthlyEntry ? currentElo - firstMonthlyEntry.elo : null;
  const solvedDayKeys = new Set(
    validEntries.map((entry) => {
      const day = new Date(
        entry.submittedAt.getFullYear(),
        entry.submittedAt.getMonth(),
        entry.submittedAt.getDate(),
      );
      return Math.floor(day.getTime() / DAY_MS);
    }),
  );
  const sortedDayKeys = Array.from(solvedDayKeys).sort((a, b) => a - b);
  let longestStreakDays = 0;
  let runningStreakDays = 0;
  let previousDayKey: number | null = null;

  sortedDayKeys.forEach((dayKey) => {
    runningStreakDays = previousDayKey !== null && dayKey === previousDayKey + 1 ? runningStreakDays + 1 : 1;
    longestStreakDays = Math.max(longestStreakDays, runningStreakDays);
    previousDayKey = dayKey;
  });

  const todayKey = Math.floor(todayStart.getTime() / DAY_MS);
  let currentStreakDays = 0;
  for (let dayKey = todayKey; solvedDayKeys.has(dayKey); dayKey -= 1) {
    currentStreakDays += 1;
  }

  return {
    currentElo,
    bestElo,
    eloChangeLast7Days,
    eloChangeThisMonth,
    currentPuzzleStreak,
    weeklyAccuracyChange,
    strongestGainCategory,
    currentStreakDays,
    longestStreakDays,
  };
}

function buildDashboardPuzzleEloInsights(
  summary: DashboardPuzzleEloSummary,
  category: DashboardPuzzleEloCategory,
): string[] {
  const insights: string[] = [];
  const categoryLabel = resolveDashboardPuzzleEloCategoryLabel(category);
  const categoryPrefix = category === 'overall' ? 'Your rating' : `Your ${categoryLabel} rating`;

  if (summary.eloChangeThisMonth !== null && summary.eloChangeThisMonth !== 0) {
    insights.push(
      `${categoryPrefix} ${summary.eloChangeThisMonth > 0 ? 'increased' : 'decreased'} ${Math.abs(
        summary.eloChangeThisMonth,
      )} points this month.`,
    );
  }

  if (category === 'overall' && summary.strongestGainCategory) {
    insights.push(`Most gains came from ${summary.strongestGainCategory} puzzles.`);
  }

  if (summary.currentPuzzleStreak > 1) {
    insights.push(`You're currently on a ${summary.currentPuzzleStreak}-puzzle first-move streak.`);
  }

  if (summary.weeklyAccuracyChange !== null && summary.weeklyAccuracyChange !== 0) {
    insights.push(
      `Your accuracy ${summary.weeklyAccuracyChange > 0 ? 'improved' : 'dropped'} ${Math.abs(
        summary.weeklyAccuracyChange,
      )} points this week.`,
    );
  }

  if (insights.length === 0 && summary.eloChangeLast7Days !== null && summary.eloChangeLast7Days !== 0) {
    insights.push(
      `${categoryPrefix} ${summary.eloChangeLast7Days > 0 ? 'gained' : 'lost'} ${Math.abs(
        summary.eloChangeLast7Days,
      )} points over the last 7 days.`,
    );
  }

  return insights.slice(0, 4);
}

function buildDashboardPuzzleEloProgressData(
  activeRange: DashboardPuzzleEloRange,
  submissions: PuzzleSubmissionRecord[],
  category: DashboardPuzzleEloCategory,
): DashboardPuzzleEloProgressData {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const monthDayFormatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
  const monthFormatter = new Intl.DateTimeFormat(undefined, { month: 'short' });
  const filteredSubmissions = filterDashboardPuzzleEloSubmissions(submissions, category);
  const categoryLabel = resolveDashboardPuzzleEloCategoryLabel(category);
  const eloEntries = filteredSubmissions.map((submission) => ({
    submittedAt: new Date(submission.submittedAt),
    elo: resolveSubmissionElo(submission),
  }));
  const summary = buildDashboardPuzzleEloSummary(eloEntries, filteredSubmissions, todayStart);
  const insights = buildDashboardPuzzleEloInsights(summary, category);
  const validEntries = eloEntries.filter((entry) => !Number.isNaN(entry.submittedAt.getTime()));
  const globalFallback = summary.currentElo ?? 900;

  if (validEntries.length === 0) {
    return {
      values: [],
      axisLabels: [],
      subtitle:
        activeRange === 'All Time'
          ? `Estimated puzzle Elo across ${categoryLabel.toLowerCase()} submissions`
          : `Daily average estimated Elo over the last ${
              activeRange === '7 Days' ? 7 : activeRange === '30 Days' ? 30 : 90
            } days for ${categoryLabel.toLowerCase()}`,
      summary,
      dataPointCount: 0,
      insights,
    };
  }

  if (activeRange === 'All Time') {
    const sortedEntries = [...validEntries].sort(
      (a, b) => a.submittedAt.getTime() - b.submittedAt.getTime(),
    );
    const firstEntry = sortedEntries[0];
    const lastEntry = sortedEntries[sortedEntries.length - 1];
    const startMonth = new Date(firstEntry.submittedAt.getFullYear(), firstEntry.submittedAt.getMonth(), 1);
    const endMonth = new Date(lastEntry.submittedAt.getFullYear(), lastEntry.submittedAt.getMonth(), 1);
    const monthCount = Math.max(
      1,
      (endMonth.getFullYear() - startMonth.getFullYear()) * 12 +
        (endMonth.getMonth() - startMonth.getMonth()) +
        1,
    );
    const values = Array.from({ length: monthCount }, () => [] as number[]);
    const labels = Array.from({ length: monthCount }, (_, idx) =>
      monthFormatter.format(new Date(startMonth.getFullYear(), startMonth.getMonth() + idx, 1)),
    );

    sortedEntries.forEach((entry) => {
      const monthIndex =
        (entry.submittedAt.getFullYear() - startMonth.getFullYear()) * 12 +
        (entry.submittedAt.getMonth() - startMonth.getMonth());
      if (monthIndex >= 0 && monthIndex < values.length) {
        values[monthIndex].push(entry.elo);
      }
    });

    return {
      values: fillMissingWithNearest(
        values.map((bucket) =>
          bucket.length > 0 ? bucket.reduce((sum, elo) => sum + elo, 0) / bucket.length : null,
        ),
        globalFallback,
      ),
      axisLabels: buildEvenlySpacedLabels(labels, 6),
      subtitle: `Estimated puzzle Elo across ${categoryLabel.toLowerCase()} submissions`,
      summary,
      dataPointCount: sortedEntries.length,
      insights,
    };
  }

  const dayCount = activeRange === '7 Days' ? 7 : activeRange === '30 Days' ? 30 : 90;
  const start = new Date(todayStart.getTime() - (dayCount - 1) * DAY_MS);
  const values = Array.from({ length: dayCount }, () => [] as number[]);
  const labels = Array.from({ length: dayCount }, (_, idx) =>
    monthDayFormatter.format(new Date(start.getTime() + idx * DAY_MS)),
  );

  validEntries.forEach((entry) => {
    const submittedDay = new Date(
      entry.submittedAt.getFullYear(),
      entry.submittedAt.getMonth(),
      entry.submittedAt.getDate(),
    );
    const dayIndex = Math.floor((submittedDay.getTime() - start.getTime()) / DAY_MS);
    if (dayIndex >= 0 && dayIndex < values.length) {
      values[dayIndex].push(entry.elo);
    }
  });

  labels[labels.length - 1] = 'Today';
  return {
    values: fillMissingWithNearest(
      values.map((bucket) =>
        bucket.length > 0 ? bucket.reduce((sum, elo) => sum + elo, 0) / bucket.length : null,
      ),
      globalFallback,
    ),
    axisLabels: buildEvenlySpacedLabels(labels, activeRange === '7 Days' ? 7 : 6),
    subtitle: `Daily average estimated Elo over the last ${dayCount} days for ${categoryLabel.toLowerCase()}`,
    summary,
    dataPointCount: validEntries.filter((entry) => entry.submittedAt.getTime() >= start.getTime()).length,
    insights,
  };
}

function buildEloTrendData(
  activeRange: ActivityRange,
  submissions: PuzzleSubmissionRecord[],
): EloTrendData {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const hourFormatter = new Intl.DateTimeFormat(undefined, { hour: 'numeric' });
  const weekdayFormatter = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
  const monthDayFormatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
  const monthFormatter = new Intl.DateTimeFormat(undefined, { month: 'short' });

  const eloEntries = submissions.map((submission) => ({
    submittedAt: new Date(submission.submittedAt),
    elo: resolveSubmissionElo(submission),
  }));
  const globalAverageElo =
    eloEntries.length > 0
      ? Math.round(eloEntries.reduce((sum, entry) => sum + entry.elo, 0) / eloEntries.length)
      : 900;

  if (activeRange === 'Today') {
    const values = Array.from({ length: 12 }, () => [] as number[]);
    const labels = Array.from({ length: 12 }, (_, idx) =>
      hourFormatter.format(new Date(todayStart.getTime() + idx * TWO_HOURS_MS)),
    );

    eloEntries.forEach((entry) => {
      if (Number.isNaN(entry.submittedAt.getTime())) {
        return;
      }
      if (
        entry.submittedAt.getFullYear() !== todayStart.getFullYear() ||
        entry.submittedAt.getMonth() !== todayStart.getMonth() ||
        entry.submittedAt.getDate() !== todayStart.getDate()
      ) {
        return;
      }

      const offset = entry.submittedAt.getTime() - todayStart.getTime();
      const bucketIndex = Math.min(values.length - 1, Math.max(0, Math.floor(offset / TWO_HOURS_MS)));
      values[bucketIndex].push(entry.elo);
    });

    labels[labels.length - 1] = 'Now';
    const averaged = fillMissingWithNearest(
      values.map((bucket) =>
        bucket.length > 0 ? bucket.reduce((sum, elo) => sum + elo, 0) / bucket.length : null,
      ),
      globalAverageElo,
    );
    return {
      values: averaged,
      axisLabels: buildEvenlySpacedLabels(labels, 6),
      subtitle: 'Estimated puzzle Elo trend across today',
    };
  }

  if (activeRange === 'Week') {
    const start = new Date(todayStart.getTime() - 6 * DAY_MS);
    const values = Array.from({ length: 7 }, () => [] as number[]);
    const labels = Array.from({ length: 7 }, (_, idx) =>
      weekdayFormatter.format(new Date(start.getTime() + idx * DAY_MS)),
    );

    eloEntries.forEach((entry) => {
      if (Number.isNaN(entry.submittedAt.getTime())) {
        return;
      }

      const submittedDay = new Date(
        entry.submittedAt.getFullYear(),
        entry.submittedAt.getMonth(),
        entry.submittedAt.getDate(),
      );
      const dayIndex = Math.floor((submittedDay.getTime() - start.getTime()) / DAY_MS);
      if (dayIndex >= 0 && dayIndex < values.length) {
        values[dayIndex].push(entry.elo);
      }
    });

    labels[labels.length - 1] = 'Today';
    const averaged = fillMissingWithNearest(
      values.map((bucket) =>
        bucket.length > 0 ? bucket.reduce((sum, elo) => sum + elo, 0) / bucket.length : null,
      ),
      globalAverageElo,
    );
    return {
      values: averaged,
      axisLabels: labels,
      subtitle: 'Daily average estimated Elo over the last 7 days',
    };
  }

  if (activeRange === 'Month') {
    const start = new Date(todayStart.getTime() - 29 * DAY_MS);
    const values = Array.from({ length: 30 }, () => [] as number[]);
    const labels = Array.from({ length: 30 }, (_, idx) =>
      monthDayFormatter.format(new Date(start.getTime() + idx * DAY_MS)),
    );

    eloEntries.forEach((entry) => {
      if (Number.isNaN(entry.submittedAt.getTime())) {
        return;
      }

      const submittedDay = new Date(
        entry.submittedAt.getFullYear(),
        entry.submittedAt.getMonth(),
        entry.submittedAt.getDate(),
      );
      const dayIndex = Math.floor((submittedDay.getTime() - start.getTime()) / DAY_MS);
      if (dayIndex >= 0 && dayIndex < values.length) {
        values[dayIndex].push(entry.elo);
      }
    });

    labels[labels.length - 1] = 'Today';
    const averaged = fillMissingWithNearest(
      values.map((bucket) =>
        bucket.length > 0 ? bucket.reduce((sum, elo) => sum + elo, 0) / bucket.length : null,
      ),
      globalAverageElo,
    );
    return {
      values: averaged,
      axisLabels: buildEvenlySpacedLabels(labels, 6),
      subtitle: 'Daily average estimated Elo over the last 30 days',
    };
  }

  const yearStart = new Date(todayStart.getFullYear(), todayStart.getMonth() - 11, 1);
  const values = Array.from({ length: 12 }, () => [] as number[]);
  const labels = Array.from({ length: 12 }, (_, idx) =>
    monthFormatter.format(new Date(yearStart.getFullYear(), yearStart.getMonth() + idx, 1)),
  );

  eloEntries.forEach((entry) => {
    if (Number.isNaN(entry.submittedAt.getTime())) {
      return;
    }
    const monthIndex =
      (entry.submittedAt.getFullYear() - yearStart.getFullYear()) * 12 +
      (entry.submittedAt.getMonth() - yearStart.getMonth());
    if (monthIndex >= 0 && monthIndex < values.length) {
      values[monthIndex].push(entry.elo);
    }
  });

  labels[labels.length - 1] = 'This month';
  const averaged = fillMissingWithNearest(
    values.map((bucket) =>
      bucket.length > 0 ? bucket.reduce((sum, elo) => sum + elo, 0) / bucket.length : null,
    ),
    globalAverageElo,
  );
  return {
    values: averaged,
    axisLabels: buildEvenlySpacedLabels(labels, 6),
    subtitle: 'Monthly average estimated Elo over the last 12 months',
  };
}

function buildAccuracyTrendData(
  activeRange: ActivityRange,
  submissions: PuzzleSubmissionRecord[],
): AccuracyTrendData {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const hourFormatter = new Intl.DateTimeFormat(undefined, { hour: 'numeric' });
  const weekdayFormatter = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
  const monthDayFormatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
  const monthFormatter = new Intl.DateTimeFormat(undefined, { month: 'short' });

  const accuracyEntries = submissions.map((submission) => ({
    submittedAt: new Date(submission.submittedAt),
    accuracyPercent: calculateSubmissionAccuracyPercent(submission),
  }));
  const globalAverageAccuracy =
    accuracyEntries.length > 0
      ? Math.round(
          accuracyEntries.reduce((sum, entry) => sum + entry.accuracyPercent, 0) /
            accuracyEntries.length,
        )
      : 75;

  if (activeRange === 'Today') {
    const values = Array.from({ length: 12 }, () => [] as number[]);
    const labels = Array.from({ length: 12 }, (_, idx) =>
      hourFormatter.format(new Date(todayStart.getTime() + idx * TWO_HOURS_MS)),
    );

    accuracyEntries.forEach((entry) => {
      if (Number.isNaN(entry.submittedAt.getTime())) {
        return;
      }
      if (
        entry.submittedAt.getFullYear() !== todayStart.getFullYear() ||
        entry.submittedAt.getMonth() !== todayStart.getMonth() ||
        entry.submittedAt.getDate() !== todayStart.getDate()
      ) {
        return;
      }

      const offset = entry.submittedAt.getTime() - todayStart.getTime();
      const bucketIndex = Math.min(values.length - 1, Math.max(0, Math.floor(offset / TWO_HOURS_MS)));
      values[bucketIndex].push(entry.accuracyPercent);
    });

    labels[labels.length - 1] = 'Now';
    const averaged = fillMissingWithNearest(
      values.map((bucket) =>
        bucket.length > 0
          ? bucket.reduce((sum, accuracyPercent) => sum + accuracyPercent, 0) / bucket.length
          : null,
      ),
      globalAverageAccuracy,
    );
    return {
      values: averaged,
      axisLabels: buildEvenlySpacedLabels(labels, 6),
      subtitle: 'Estimated solve accuracy trend across today',
    };
  }

  if (activeRange === 'Week') {
    const start = new Date(todayStart.getTime() - 6 * DAY_MS);
    const values = Array.from({ length: 7 }, () => [] as number[]);
    const labels = Array.from({ length: 7 }, (_, idx) =>
      weekdayFormatter.format(new Date(start.getTime() + idx * DAY_MS)),
    );

    accuracyEntries.forEach((entry) => {
      if (Number.isNaN(entry.submittedAt.getTime())) {
        return;
      }

      const submittedDay = new Date(
        entry.submittedAt.getFullYear(),
        entry.submittedAt.getMonth(),
        entry.submittedAt.getDate(),
      );
      const dayIndex = Math.floor((submittedDay.getTime() - start.getTime()) / DAY_MS);
      if (dayIndex >= 0 && dayIndex < values.length) {
        values[dayIndex].push(entry.accuracyPercent);
      }
    });

    labels[labels.length - 1] = 'Today';
    const averaged = fillMissingWithNearest(
      values.map((bucket) =>
        bucket.length > 0
          ? bucket.reduce((sum, accuracyPercent) => sum + accuracyPercent, 0) / bucket.length
          : null,
      ),
      globalAverageAccuracy,
    );
    return {
      values: averaged,
      axisLabels: labels,
      subtitle: 'Daily average solve accuracy over the last 7 days',
    };
  }

  if (activeRange === 'Month') {
    const start = new Date(todayStart.getTime() - 29 * DAY_MS);
    const values = Array.from({ length: 30 }, () => [] as number[]);
    const labels = Array.from({ length: 30 }, (_, idx) =>
      monthDayFormatter.format(new Date(start.getTime() + idx * DAY_MS)),
    );

    accuracyEntries.forEach((entry) => {
      if (Number.isNaN(entry.submittedAt.getTime())) {
        return;
      }

      const submittedDay = new Date(
        entry.submittedAt.getFullYear(),
        entry.submittedAt.getMonth(),
        entry.submittedAt.getDate(),
      );
      const dayIndex = Math.floor((submittedDay.getTime() - start.getTime()) / DAY_MS);
      if (dayIndex >= 0 && dayIndex < values.length) {
        values[dayIndex].push(entry.accuracyPercent);
      }
    });

    labels[labels.length - 1] = 'Today';
    const averaged = fillMissingWithNearest(
      values.map((bucket) =>
        bucket.length > 0
          ? bucket.reduce((sum, accuracyPercent) => sum + accuracyPercent, 0) / bucket.length
          : null,
      ),
      globalAverageAccuracy,
    );
    return {
      values: averaged,
      axisLabels: buildEvenlySpacedLabels(labels, 6),
      subtitle: 'Daily average solve accuracy over the last 30 days',
    };
  }

  const yearStart = new Date(todayStart.getFullYear(), todayStart.getMonth() - 11, 1);
  const values = Array.from({ length: 12 }, () => [] as number[]);
  const labels = Array.from({ length: 12 }, (_, idx) =>
    monthFormatter.format(new Date(yearStart.getFullYear(), yearStart.getMonth() + idx, 1)),
  );

  accuracyEntries.forEach((entry) => {
    if (Number.isNaN(entry.submittedAt.getTime())) {
      return;
    }
    const monthIndex =
      (entry.submittedAt.getFullYear() - yearStart.getFullYear()) * 12 +
      (entry.submittedAt.getMonth() - yearStart.getMonth());
    if (monthIndex >= 0 && monthIndex < values.length) {
      values[monthIndex].push(entry.accuracyPercent);
    }
  });

  labels[labels.length - 1] = 'This month';
  const averaged = fillMissingWithNearest(
    values.map((bucket) =>
      bucket.length > 0
        ? bucket.reduce((sum, accuracyPercent) => sum + accuracyPercent, 0) / bucket.length
        : null,
    ),
    globalAverageAccuracy,
  );
  return {
    values: averaged,
    axisLabels: buildEvenlySpacedLabels(labels, 6),
    subtitle: 'Monthly average solve accuracy over the last 12 months',
  };
}

function buildPuzzleRatingProgressionData(
  activeRange: ActivityRange,
  submissions: PuzzleSubmissionRecord[],
): PuzzleRatingProgressionData {
  const eloTrendData = buildEloTrendData(activeRange, submissions);
  const accuracyTrendData = buildAccuracyTrendData(activeRange, submissions);
  const valueCount = Math.min(eloTrendData.values.length, accuracyTrendData.values.length);
  const axisCount = Math.min(eloTrendData.axisLabels.length, valueCount);

  return {
    eloValues: eloTrendData.values.slice(0, valueCount),
    accuracyValues: accuracyTrendData.values.slice(0, valueCount),
    axisLabels: eloTrendData.axisLabels.slice(0, axisCount),
    subtitle: 'Am I improving over time?',
  };
}

function resolveSubmissionElo(submission: PuzzleSubmissionRecord): number {
  if (
    typeof submission.difficultyRating === 'number' &&
    Number.isFinite(submission.difficultyRating)
  ) {
    return submission.difficultyRating;
  }
  if (
    typeof submission.estimatedDifficultyRating === 'number' &&
    Number.isFinite(submission.estimatedDifficultyRating)
  ) {
    return submission.estimatedDifficultyRating;
  }
  if (typeof submission.puzzleElo === 'number' && Number.isFinite(submission.puzzleElo)) {
    return submission.puzzleElo;
  }

  return estimatePuzzleElo({
    solveTimeMs: submission.solveTimeMs ?? null,
    mateIn: submission.positionCheck.mateIn,
    confidence: submission.positionCheck.confidence,
    attemptsUsed: submission.positionCheck.attemptsUsed,
    solutionLines: submission.solutionLines,
  });
}

function toLocalDayIndex(iso: string): number | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const localMidnight = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.floor(localMidnight.getTime() / 86400000);
}

function calculateStreaks(submissions: PuzzleSubmissionRecord[]) {
  const dayIndexes = Array.from(
    new Set(
      submissions
        .map((submission) => toLocalDayIndex(submission.submittedAt))
        .filter((index): index is number => index !== null),
    ),
  ).sort((a, b) => a - b);

  if (dayIndexes.length === 0) {
    return { bestStreakDays: 0, currentStreakDays: 0 };
  }

  let bestStreakDays = 1;
  let running = 1;
  for (let i = 1; i < dayIndexes.length; i += 1) {
    if (dayIndexes[i] === dayIndexes[i - 1] + 1) {
      running += 1;
    } else {
      running = 1;
    }
    bestStreakDays = Math.max(bestStreakDays, running);
  }

  const today = new Date();
  const todayIndex = Math.floor(
    new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() / 86400000,
  );
  const daySet = new Set(dayIndexes);
  const latestDay = dayIndexes[dayIndexes.length - 1];
  let currentStreakDays = 0;

  if (latestDay === todayIndex || latestDay === todayIndex - 1) {
    let cursor = latestDay;
    while (daySet.has(cursor)) {
      currentStreakDays += 1;
      cursor -= 1;
    }
  }

  return { bestStreakDays, currentStreakDays };
}

function hashText(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function calculateSubmissionAccuracyPercent(submission: PuzzleSubmissionRecord): number {
  const confidence = submission.positionCheck.confidence;
  if (typeof confidence === 'number' && Number.isFinite(confidence)) {
    return clamp(Math.round(confidence * 100), 1, 100);
  }

  let score = 78;
  const attemptsUsed = submission.positionCheck.attemptsUsed;
  if (typeof attemptsUsed === 'number' && Number.isFinite(attemptsUsed) && attemptsUsed > 1) {
    score -= Math.min(20, Math.round((attemptsUsed - 1) * 6));
  }

  if (typeof submission.solveTimeMs === 'number' && Number.isFinite(submission.solveTimeMs)) {
    const solveTimeSeconds = submission.solveTimeMs / 1000;
    if (solveTimeSeconds > 20) {
      score -= Math.min(22, Math.round((solveTimeSeconds - 20) / 6));
    } else {
      score += Math.min(8, Math.round((20 - solveTimeSeconds) / 5));
    }
  }

  if (submission.positionCheck.mateFound === true) {
    score += 4;
  }

  return clamp(Math.round(score), 30, 99);
}

function inferSubmissionTheme(submission: PuzzleSubmissionRecord): {
  theme: AnalyticsTheme;
  reason: string;
} {
  const searchable = `${submission.fileName} ${submission.solutionLines.join(' ')}`.toLowerCase();
  const sanLine = submission.solutionLines.join(' ');
  const captureCount = (sanLine.match(/x/g) ?? []).length;

  if (/\bback[-\s]?rank\b/.test(searchable)) {
    return { theme: 'Back-Rank Mates', reason: 'Detected back-rank keyword' };
  }
  if (/\bskewer(s)?\b|\bx[-\s]?ray\b/.test(searchable)) {
    return { theme: 'Skewers', reason: 'Detected skewer keyword' };
  }
  if (/\bsacrific(e|es|ed|ing)?\b|\bdecoy\b|\bdeflection\b|\bclearance\b/.test(searchable)) {
    return { theme: 'Sacrifices', reason: 'Detected sacrifice-style keyword' };
  }
  if (/\bpin(s|ned|ning)?\b/.test(searchable)) {
    return { theme: 'Pins', reason: 'Detected pin keyword' };
  }
  if (/\bfork(s|ed|ing)?\b/.test(searchable)) {
    return { theme: 'Forks', reason: 'Detected fork keyword' };
  }

  if (/\b[QR][a-h]?[1-8]?x?[a-h][18]#\b/.test(sanLine)) {
    return { theme: 'Back-Rank Mates', reason: 'Detected back-rank mate pattern in SAN' };
  }
  if (
    /\bN[a-h]?[1-8]?x?[a-h][1-8][+#]\b/.test(sanLine) ||
    /\bN[a-h][1-8]\+/.test(sanLine)
  ) {
    return { theme: 'Forks', reason: 'Detected forcing knight tactic pattern' };
  }
  if (
    /\bB[a-h]?[1-8]?x?[a-h][1-8]\+/.test(sanLine) ||
    /\bQ[a-h]?[1-8]?x?[a-h][1-8]\+/.test(sanLine)
  ) {
    return { theme: 'Pins', reason: 'Detected pressure-line check pattern' };
  }
  if (captureCount >= 2 && (submission.positionCheck.mateIn ?? 0) >= 2) {
    return { theme: 'Sacrifices', reason: 'Detected multi-capture conversion pattern' };
  }
  if (/\b[QRB][a-h]?[1-8]?x?[a-h][1-8]\+/.test(sanLine)) {
    return { theme: 'Skewers', reason: 'Detected line-piece forcing pattern' };
  }

  const fallbackIndex =
    hashText(`${submission.id}|${submission.fileName}|${submission.submittedAt}`) %
    ANALYTICS_THEMES.length;
  return {
    theme: ANALYTICS_THEMES[fallbackIndex],
    reason: 'Fallback classification from recent solve metadata',
  };
}

function buildThemeAccuracyRows(submissions: PuzzleSubmissionRecord[]): {
  rows: ThemeAccuracyRow[];
  weakestTheme: AnalyticsTheme;
} {
  const grouped = new Map<AnalyticsTheme, ThemeSubmissionAssessment[]>();
  ANALYTICS_THEMES.forEach((theme) => grouped.set(theme, []));

  submissions.slice(0, ANALYTICS_RECENT_SOLVE_LIMIT).forEach((submission) => {
    const { theme, reason } = inferSubmissionTheme(submission);
    const bucket = grouped.get(theme);
    if (!bucket) {
      return;
    }
    bucket.push({
      submission,
      theme,
      reason,
      accuracyPercent: calculateSubmissionAccuracyPercent(submission),
    });
  });

  const rows = ANALYTICS_THEMES.map((theme) => {
    const assessments = grouped.get(theme) ?? [];
    if (assessments.length === 0) {
      return {
        theme,
        accuracyPercent: 0,
        solvedCount: 0,
        assessments: [],
      };
    }

    const liveAverage =
      assessments.reduce((sum, assessment) => sum + assessment.accuracyPercent, 0) /
      assessments.length;

    return {
      theme,
      accuracyPercent: clamp(Math.round(liveAverage), 1, 100),
      solvedCount: assessments.length,
      assessments,
    };
  });

  const weakestTheme = rows.reduce((weakest, row) =>
    row.accuracyPercent < weakest.accuracyPercent ? row : weakest,
  ).theme;

  return { rows, weakestTheme };
}

function buildSolveTimeDifficultyData(
  submissions: PuzzleSubmissionRecord[],
): SolveTimeDifficultyData {
  const timedEntries = submissions
    .map((submission) => {
      if (typeof submission.solveTimeMs !== 'number' || !Number.isFinite(submission.solveTimeMs)) {
        return null;
      }
      return {
        elo: resolveSubmissionElo(submission),
        solveTimeMs: submission.solveTimeMs,
      };
    })
    .filter((entry): entry is { elo: number; solveTimeMs: number } => entry !== null);

  if (timedEntries.length === 0) {
    return { buckets: [], totalSolvedCount: 0 };
  }

  const bucketMap = new Map<number, { sumSolveTimeMs: number; solvedCount: number }>();
  timedEntries.forEach((entry) => {
    const bucketStart =
      Math.floor(entry.elo / DIFFICULTY_ELO_BUCKET_SIZE) * DIFFICULTY_ELO_BUCKET_SIZE;
    const bucket = bucketMap.get(bucketStart);
    if (bucket) {
      bucket.sumSolveTimeMs += entry.solveTimeMs;
      bucket.solvedCount += 1;
      return;
    }
    bucketMap.set(bucketStart, {
      sumSolveTimeMs: entry.solveTimeMs,
      solvedCount: 1,
    });
  });

  const sortedStarts = Array.from(bucketMap.keys()).sort((a, b) => a - b);
  const buckets = sortedStarts.map((start) => {
    const summary = bucketMap.get(start)!;
    const end = start + DIFFICULTY_ELO_BUCKET_SIZE - 1;
    return {
      label: `${start}-${end}`,
      avgSolveTimeMs: summary.sumSolveTimeMs / summary.solvedCount,
      solvedCount: summary.solvedCount,
    };
  });

  return {
    buckets,
    totalSolvedCount: timedEntries.length,
  };
}

function buildFirstMoveAccuracySummary(
  submissions: PuzzleSubmissionRecord[],
): FirstMoveAccuracySummary {
  const firstMoveAssessments = submissions
    .map((submission) => submission.firstMoveAssessment ?? null)
    .filter((assessment): assessment is NonNullable<PuzzleSubmissionRecord['firstMoveAssessment']> =>
      assessment !== null,
    );

  const validAssessments = firstMoveAssessments.filter(
    (assessment) => assessment.isValidForFirstMoveAccuracy,
  );
  const validAttemptCount = validAssessments.length;
  const correctCount = validAssessments.filter((assessment) => assessment.isFirstMoveCorrect).length;
  const accuracyPercent =
    validAttemptCount > 0 ? Math.round((correctCount / validAttemptCount) * 100) : null;

  const averageTimeToFirstMoveSeconds =
    validAttemptCount > 0
      ? validAssessments.reduce((sum, assessment) => sum + assessment.timeToFirstMoveSeconds, 0) /
        validAttemptCount
      : null;

  const wrongMoveFrequency = new Map<string, number>();
  validAssessments.forEach((assessment) => {
    if (assessment.isFirstMoveCorrect) {
      return;
    }
    const normalizedMove = assessment.firstMove.trim().toLowerCase();
    if (!normalizedMove) {
      return;
    }
    wrongMoveFrequency.set(normalizedMove, (wrongMoveFrequency.get(normalizedMove) ?? 0) + 1);
  });
  const commonWrongFirstMoves = Array.from(wrongMoveFrequency.entries())
    .map(([move, count]) => ({ move, count }))
    .sort((a, b) => b.count - a.count || a.move.localeCompare(b.move))
    .slice(0, 4);

  return {
    validAttemptCount,
    correctCount,
    accuracyPercent,
    averageTimeToFirstMoveSeconds,
    commonWrongFirstMoves,
  };
}

function AreaChart({
  title,
  subtitle,
  values,
  axisLabels,
  yAxisTicks,
  sectionStyle,
}: {
  title: string;
  subtitle: string;
  values: number[];
  axisLabels?: string[];
  yAxisTicks?: number[];
  sectionStyle?: React.CSSProperties;
}) {
  const { areaPath, linePath } = useMemo(() => buildChartPaths(values, 860, 190), [values]);
  const chartId = title.toLowerCase().replace(/\s+/g, '-');
  const labels = axisLabels ?? ['9:00 AM', '12:00 PM', '3:00 PM', '6:00 PM', '9:00 PM', 'Now'];
  const ticks = yAxisTicks ?? [];
  const hasYAxis = ticks.length > 0;
  const maxTick = ticks.length > 0 ? Math.max(ticks[0], 0) : 0;
  const axisTickY = (tick: number) => {
    const padTop = 18;
    const usableHeight = 190 - padTop - 16;
    const normalizedValue = maxTick > 0 ? tick / maxTick : 0;
    return 190 - 12 - normalizedValue * usableHeight;
  };

  return (
    <section className="neumo-surface-soft rounded-[26px] p-5 md:p-7" style={sectionStyle}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-3xl font-semibold tracking-tight text-slate-700">{title}</h2>
          <p className="text-sm text-slate-500">{subtitle}</p>
        </div>
      </div>

      <div className="mt-5">
        <svg
          viewBox={hasYAxis ? '-44 0 904 190' : '0 0 860 190'}
          className="h-[170px] w-full"
          role="img"
          aria-label={`${title} area chart`}
        >
          <defs>
            <linearGradient id={`${chartId}-fill`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#e9eef6" stopOpacity="0.5" />
            </linearGradient>
            <linearGradient id={`${chartId}-line`} x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%" stopColor="#94a3b8" stopOpacity="0.65" />
              <stop offset="100%" stopColor="#64748b" stopOpacity="0.75" />
            </linearGradient>
          </defs>

          {hasYAxis ? (
            <>
              <g stroke="rgba(148,163,184,0.22)" strokeWidth="1">
                {ticks.map((tick, idx) => (
                  <line key={`${tick}-${idx}`} x1="0" y1={axisTickY(tick)} x2="860" y2={axisTickY(tick)} />
                ))}
                <line x1="0" y1="18" x2="0" y2="178" />
              </g>
              <g fill="rgba(100,116,139,0.78)" fontSize="10">
                {ticks.map((tick, idx) => (
                  <text
                    key={`y-axis-${tick}-${idx}`}
                    x="-8"
                    y={axisTickY(tick) + 3}
                    textAnchor="end"
                  >
                    {tick}
                  </text>
                ))}
              </g>
            </>
          ) : (
            <g stroke="rgba(148,163,184,0.22)" strokeWidth="1">
              <line x1="0" y1="36" x2="860" y2="36" />
              <line x1="0" y1="92" x2="860" y2="92" />
              <line x1="0" y1="148" x2="860" y2="148" />
            </g>
          )}

          <path d={areaPath} fill={`url(#${chartId}-fill)`} />
          <path
            d={linePath}
            fill="none"
            stroke={`url(#${chartId}-line)`}
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>

        <div className="mt-3 flex items-center justify-between gap-2 text-[11px] text-slate-400 md:text-xs">
          {labels.map((label, idx) => (
            <span key={`${label}-${idx}`} className={idx === labels.length - 1 ? 'text-right' : ''}>
              {label}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function formatDashboardPuzzleEloValue(value: number | null): string {
  return value === null ? 'N/A' : String(value);
}

function formatDashboardPuzzleEloChange(value: number | null): string {
  if (value === null) {
    return 'N/A';
  }
  if (value > 0) {
    return `+${value}`;
  }
  return String(value);
}

function trackDashboardPuzzleEloGraphEvent(payload: DashboardPuzzleEloAnalyticsPayload): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(
    new CustomEvent('dashboard:puzzle-elo-graph:event', {
      detail: payload,
    }),
  );
}

function PuzzleEloProgressSection({
  data,
  activeRange,
  activeCategory,
  onRangeChange,
  onCategoryChange,
  onSolvePuzzles,
  sectionStyle,
  buttonStyle,
}: {
  data: DashboardPuzzleEloProgressData;
  activeRange: DashboardPuzzleEloRange;
  activeCategory: DashboardPuzzleEloCategory;
  onRangeChange: (range: DashboardPuzzleEloRange) => void;
  onCategoryChange: (category: DashboardPuzzleEloCategory) => void;
  onSolvePuzzles: () => void;
  sectionStyle?: React.CSSProperties;
  buttonStyle?: React.CSSProperties;
}) {
  const chartId = useId();
  const viewedRef = useRef(false);
  const previousBestByCategoryRef = useRef<Partial<Record<DashboardPuzzleEloCategory, number | null>>>({});
  const { areaPath, linePath } = useMemo(() => buildChartPaths(data.values, 860, 190), [data.values]);
  const yAxisTicks = useMemo(() => buildYAxisTicks(data.values), [data.values]);
  const hasValues = data.values.length >= 2 && data.dataPointCount > 1;
  const maxTick = yAxisTicks.length > 0 ? Math.max(yAxisTicks[0], 0) : 0;
  const chartMaxValue = Math.max(
    ...data.values.map((value) =>
      typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0,
    ),
    1,
  );
  const chartValueY = (value: number) => {
    const padTop = 18;
    const usableHeight = 190 - padTop - 16;
    const normalizedValue = chartMaxValue > 0 ? clamp(value, 0, chartMaxValue) / chartMaxValue : 0;
    return 190 - 12 - normalizedValue * usableHeight;
  };
  const axisTickY = (tick: number) => {
    const padTop = 18;
    const usableHeight = 190 - padTop - 16;
    const normalizedValue = maxTick > 0 ? tick / maxTick : 0;
    return 190 - 12 - normalizedValue * usableHeight;
  };
  const skillBands = [
    { label: 'Beginner', from: 0, to: 1000, color: 'rgba(14,165,233,0.08)' },
    { label: 'Intermediate', from: 1000, to: 1400, color: 'rgba(16,185,129,0.075)' },
    { label: 'Advanced', from: 1400, to: 1800, color: 'rgba(245,158,11,0.07)' },
    { label: 'Expert', from: 1800, to: Number.POSITIVE_INFINITY, color: 'rgba(168,85,247,0.065)' },
  ]
    .map((band) => {
      const visibleFrom = clamp(band.from, 0, chartMaxValue);
      const visibleTo = clamp(Number.isFinite(band.to) ? band.to : chartMaxValue, 0, chartMaxValue);
      const y = chartValueY(visibleTo);
      const height = chartValueY(visibleFrom) - y;
      return { ...band, y, height };
    })
    .filter((band) => band.height > 0.5);
  const achievementMarkers = (() => {
    const step = data.values.length > 1 ? 860 / (data.values.length - 1) : 0;
    const majorGainThreshold = 100;
    const markers: Array<{
      key: string;
      type: 'personal-best' | 'big-improvement';
      x: number;
      y: number;
      tooltip: string;
    }> = [];
    let bestValue = data.values[0] ?? 0;

    data.values.forEach((value, idx) => {
      if (idx === 0 || !Number.isFinite(value)) {
        return;
      }

      const previousValue = data.values[idx - 1] ?? value;
      const x = idx * step;
      const y = chartValueY(value);
      const isPersonalBest = value > bestValue;
      const isBigImprovement = value - previousValue >= majorGainThreshold;

      if (isPersonalBest) {
        markers.push({
          key: `personal-best-${idx}`,
          type: 'personal-best',
          x,
          y,
          tooltip: 'New Personal Best',
        });
        bestValue = value;
      }

      if (isBigImprovement) {
        markers.push({
          key: `big-improvement-${idx}`,
          type: 'big-improvement',
          x,
          y: y - (isPersonalBest ? 11 : 0),
          tooltip: 'Big Improvement',
        });
      }
    });

    return markers;
  })();
  const analyticsPayload = useMemo(
    () => ({
      range: activeRange,
      category: activeCategory,
      currentElo: data.summary.currentElo,
      bestElo: data.summary.bestElo,
      dataPointCount: data.dataPointCount,
    }),
    [
      activeCategory,
      activeRange,
      data.dataPointCount,
      data.summary.bestElo,
      data.summary.currentElo,
    ],
  );
  const handleCategoryChange = (category: DashboardPuzzleEloCategory) => {
    if (category === activeCategory) {
      return;
    }

    trackDashboardPuzzleEloGraphEvent({
      ...analyticsPayload,
      eventName: 'Category Filter Changed',
      category,
    });
    onCategoryChange(category);
  };
  const handleRangeChange = (range: DashboardPuzzleEloRange) => {
    if (range === activeRange) {
      return;
    }

    trackDashboardPuzzleEloGraphEvent({
      ...analyticsPayload,
      eventName: 'Time Filter Changed',
      range,
    });
    onRangeChange(range);
  };
  useEffect(() => {
    if (viewedRef.current) {
      return;
    }

    viewedRef.current = true;
    trackDashboardPuzzleEloGraphEvent({
      ...analyticsPayload,
      eventName: 'Puzzle Elo Graph Viewed',
    });
  }, [analyticsPayload]);
  useEffect(() => {
    const previousBest = previousBestByCategoryRef.current[activeCategory];
    const currentBest = data.summary.bestElo;

    if (previousBest === undefined) {
      previousBestByCategoryRef.current[activeCategory] = currentBest;
      return;
    }

    if (currentBest !== null && previousBest !== null && currentBest > previousBest) {
      trackDashboardPuzzleEloGraphEvent({
        ...analyticsPayload,
        eventName: 'New Personal Best Reached',
      });
    }

    previousBestByCategoryRef.current[activeCategory] = currentBest;
  }, [activeCategory, analyticsPayload, data.summary.bestElo]);
  const recentChange = data.summary.eloChangeLast7Days;
  const trendLabel =
    recentChange === null
      ? 'Trend unavailable'
      : recentChange > 0
        ? 'Improving'
        : recentChange < 0
          ? 'Needs attention'
          : 'Holding steady';
  const trendClassName =
    recentChange === null
      ? 'text-slate-500 dark:text-slate-300'
      : recentChange > 0
        ? 'text-emerald-600 dark:text-emerald-300'
        : recentChange < 0
          ? 'text-amber-600 dark:text-amber-300'
          : 'text-slate-600 dark:text-slate-200';
  const summaryCards: DashboardPuzzleEloSummaryCard[] = [
    {
      label: 'Current Elo',
      value: formatDashboardPuzzleEloValue(data.summary.currentElo),
      meta: 'Latest solved puzzle estimate',
      priority: true,
    },
    {
      label: '7-Day Change',
      value: formatDashboardPuzzleEloChange(data.summary.eloChangeLast7Days),
      meta: trendLabel,
      valueClassName: trendClassName,
    },
    {
      label: 'Best Elo',
      value: formatDashboardPuzzleEloValue(data.summary.bestElo),
      meta: 'Personal best achievement',
    },
    {
      label: 'Strongest Category',
      value: data.summary.strongestGainCategory ?? 'N/A',
      meta: 'Largest rating gain this month',
    },
    {
      label: 'Month Change',
      value: formatDashboardPuzzleEloChange(data.summary.eloChangeThisMonth),
      meta: 'Current minus first monthly solve',
    },
    {
      label: 'Solve Streak',
      value: `${data.summary.currentStreakDays}`,
      meta: `day${data.summary.currentStreakDays === 1 ? '' : 's'} active`,
    },
  ];

  return (
    <section className="neumo-surface-soft rounded-[26px] p-4 sm:p-5 md:p-7" style={sectionStyle}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h2 className="text-2xl font-semibold tracking-tight text-slate-700 dark:text-slate-100 sm:text-3xl">
            Puzzle Elo Progress
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-300">{data.subtitle}</p>
        </div>
        <div className="grid w-full min-w-0 gap-2 lg:w-auto lg:min-w-[360px]">
          <div className="grid grid-cols-2 gap-2 rounded-2xl neumo-inset p-1 sm:grid-cols-4 lg:flex lg:flex-wrap">
            {DASHBOARD_PUZZLE_ELO_CATEGORIES.map((category) => {
              const isActive = activeCategory === category.id;
              return (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => handleCategoryChange(category.id)}
                  className={`min-h-10 rounded-xl px-2 py-2 text-xs font-semibold transition-all duration-200 sm:px-3 ${
                    isActive
                      ? 'neumo-pill text-slate-700 dark:text-slate-100'
                      : 'text-slate-500 hover:text-slate-700 dark:text-slate-300 dark:hover:text-slate-100'
                  }`}
                  style={isActive ? buttonStyle : undefined}
                  aria-pressed={isActive}
                >
                  {category.label}
                </button>
              );
            })}
          </div>
          <div className="grid grid-cols-2 gap-2 rounded-2xl neumo-inset p-1 sm:grid-cols-4 lg:flex lg:flex-wrap">
            {DASHBOARD_PUZZLE_ELO_RANGES.map((range) => {
              const isActive = activeRange === range;
              return (
                <button
                  key={range}
                  type="button"
                  onClick={() => handleRangeChange(range)}
                  className={`min-h-10 rounded-xl px-2 py-2 text-xs font-semibold transition-all duration-200 sm:px-3 ${
                    isActive
                      ? 'neumo-pill text-slate-700 dark:text-slate-100'
                      : 'text-slate-500 hover:text-slate-700 dark:text-slate-300 dark:hover:text-slate-100'
                  }`}
                  style={isActive ? buttonStyle : undefined}
                  aria-pressed={isActive}
                >
                  {range}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {summaryCards.map((card) => (
          <article
            key={card.label}
            className={`neumo-surface-soft min-w-0 rounded-2xl px-3 py-3 sm:px-4 ${
              card.priority ? 'col-span-2 sm:col-span-1' : ''
            }`}
            style={sectionStyle}
          >
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500 dark:text-slate-300 sm:text-[11px]">
              {card.label}
            </p>
            <p
              className={`mt-2 truncate text-xl font-semibold sm:text-2xl ${
                card.valueClassName ?? 'text-slate-700 dark:text-slate-100'
              }`}
              title={card.value}
            >
              {card.value}
            </p>
            <p className="mt-1 text-xs text-slate-400 dark:text-slate-300">{card.meta}</p>
          </article>
        ))}
      </div>

      {!hasValues ? (
        <div className="mt-5 rounded-2xl neumo-inset px-4 py-6 text-center sm:px-6 sm:py-8">
          <p className="mx-auto max-w-sm text-sm font-medium text-slate-600 dark:text-slate-200">
            Complete a few puzzles to begin tracking your progress.
          </p>
          <button
            type="button"
            onClick={onSolvePuzzles}
            className="neumo-pill mt-4 inline-flex min-h-11 items-center justify-center rounded-2xl px-5 py-2.5 text-sm font-semibold text-slate-700 transition-all duration-200 hover:-translate-y-[1px] hover:text-slate-900 hover:shadow-[0_8px_16px_rgba(15,23,42,0.12)] dark:text-slate-100 dark:hover:text-white"
            style={buttonStyle}
          >
            Solve Puzzles
          </button>
        </div>
      ) : (
        <div className="mt-5 min-w-0">
          <svg
            viewBox="-44 0 904 190"
            className="h-[190px] w-full touch-pan-y sm:h-[170px]"
            role="img"
            aria-label="Puzzle Elo Progress area chart"
          >
            <title>Puzzle Elo Progress</title>
            <desc>
              Estimated puzzle Elo over time, including skill bands, personal best markers, and large
              improvement markers.
            </desc>
            <defs>
              <linearGradient id={`${chartId}-puzzle-elo-fill`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#ffffff" stopOpacity="0.9" />
                <stop offset="100%" stopColor="#e9eef6" stopOpacity="0.5" />
              </linearGradient>
              <linearGradient id={`${chartId}-puzzle-elo-line`} x1="0" x2="1" y1="0" y2="0">
                <stop offset="0%" stopColor="#1d4ed8" stopOpacity="0.76" />
                <stop offset="100%" stopColor="#0891b2" stopOpacity="0.82" />
              </linearGradient>
            </defs>

            <g aria-hidden="true">
              {skillBands.map((band) => (
                <g key={band.label}>
                  <rect x="0" y={band.y} width="860" height={band.height} fill={band.color} />
                  {band.height >= 18 ? (
                    <text x="846" y={band.y + Math.min(band.height - 5, 14)} textAnchor="end" fill="rgba(100,116,139,0.5)" fontSize="10" fontWeight="600">
                      {band.label}
                    </text>
                  ) : null}
                </g>
              ))}
            </g>

            <g stroke="rgba(148,163,184,0.22)" strokeWidth="1">
              {yAxisTicks.map((tick, idx) => (
                <line key={`${tick}-${idx}`} x1="0" y1={axisTickY(tick)} x2="860" y2={axisTickY(tick)} />
              ))}
              <line x1="0" y1="18" x2="0" y2="178" />
            </g>
            <g fill="rgba(100,116,139,0.78)" fontSize="10">
              {yAxisTicks.map((tick, idx) => (
                <text key={`puzzle-elo-y-axis-${tick}-${idx}`} x="-8" y={axisTickY(tick) + 3} textAnchor="end">
                  {tick}
                </text>
              ))}
            </g>

            <path d={areaPath} fill={`url(#${chartId}-puzzle-elo-fill)`} />
            <path
              d={linePath}
              fill="none"
              stroke={`url(#${chartId}-puzzle-elo-line)`}
              strokeWidth="3.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <g>
              {achievementMarkers.map((marker) =>
                marker.type === 'personal-best' ? (
                  <g key={marker.key}>
                    <circle cx={marker.x} cy={marker.y} r="16" fill="transparent">
                      <title>{marker.tooltip}</title>
                    </circle>
                    <circle
                      cx={marker.x}
                      cy={marker.y}
                      r="5"
                      fill="#ffffff"
                      stroke="#0ea5e9"
                      strokeWidth="2"
                      pointerEvents="none"
                    />
                  </g>
                ) : (
                  <g key={marker.key}>
                    <circle cx={marker.x} cy={marker.y} r="16" fill="transparent">
                      <title>{marker.tooltip}</title>
                    </circle>
                    <path
                      d={`M ${marker.x} ${marker.y - 5} L ${marker.x - 5} ${marker.y + 5} L ${marker.x + 5} ${marker.y + 5} Z`}
                      fill="#10b981"
                      fillOpacity="0.88"
                      stroke="#ffffff"
                      strokeWidth="1.5"
                      strokeLinejoin="round"
                      pointerEvents="none"
                    />
                  </g>
                ),
              )}
            </g>
          </svg>

          <div className="mt-3 grid grid-flow-col items-center justify-between gap-1 text-[10px] text-slate-500 dark:text-slate-300 sm:gap-2 sm:text-xs">
            {data.axisLabels.map((label, idx) => (
              <span key={`${label}-${idx}`} className={`min-w-0 truncate ${idx === data.axisLabels.length - 1 ? 'text-right' : ''}`}>
                {label}
              </span>
            ))}
          </div>
        </div>
      )}

      {data.insights.length > 0 ? (
        <div className="mt-5 rounded-2xl neumo-inset px-4 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500 dark:text-slate-300">Insights</p>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {data.insights.map((insight) => (
              <p key={insight} className="rounded-xl bg-white/45 px-3 py-2 text-sm font-medium text-slate-600 dark:bg-white/10 dark:text-slate-200">
                {insight}
              </p>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function SolveTimeVsDifficultyChart({
  data,
  sectionStyle,
  accentChannels,
  onCollapse,
}: {
  data: SolveTimeDifficultyData;
  sectionStyle?: React.CSSProperties;
  accentChannels: [number, number, number];
  onCollapse?: () => void;
}) {
  const chartId = useId();
  const buckets = Array.isArray(data?.buckets) ? data.buckets : [];

  return (
    <article
      id={`solve-time-vs-difficulty-${chartId}`}
      className="neumo-surface-soft rounded-3xl px-5 py-4 min-h-[108px] flex flex-col justify-between"
      style={sectionStyle}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.08em] text-slate-500">Analytics</p>
          <h3 className="mt-1 text-base font-semibold text-slate-700">Solve Time vs Difficulty</h3>
          <p className="mt-1 text-xs text-slate-500">
            Difficulty buckets mapped to average solve time.
          </p>
        </div>
        {onCollapse && (
          <button
            type="button"
            onClick={onCollapse}
            className="rounded-full neumo-pill px-3 py-1 text-xs font-semibold text-slate-600 inline-flex items-center gap-1.5 transition-all duration-200 hover:-translate-y-[1px] hover:text-slate-700 hover:shadow-[0_8px_16px_rgba(15,23,42,0.12)]"
            style={sectionStyle}
            aria-label="Collapse solve time vs difficulty section"
          >
            <ChevronUp className="h-3.5 w-3.5" />
            Collapse
          </button>
        )}
      </div>

      {buckets.length === 0 ? (
        <p className="mt-3 text-xs text-slate-400">No solve timing data yet.</p>
      ) : (
        <div className="mt-3 space-y-2">
          <div className="rounded-xl border border-slate-200/70 bg-white/25 px-3 py-2">
            <p className="text-[11px] uppercase tracking-[0.08em] text-slate-400">Elo buckets</p>
            <div className="mt-2 space-y-1.5">
              {buckets.slice(0, 6).map((bucket) => (
                <div key={bucket.label} className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="font-medium text-slate-600">{bucket.label}</span>
                  <span
                    className="rounded-full px-2 py-0.5 text-slate-600"
                    style={{ backgroundColor: rgbaFromChannels(accentChannels, 0.16) }}
                  >
                    {formatSolveTimeMs(bucket.avgSolveTimeMs)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <p className="text-[11px] text-slate-400">
            Based on {data.totalSolvedCount} solved submission
            {data.totalSolvedCount === 1 ? '' : 's'} with timing data.
          </p>
        </div>
      )}
    </article>
  );
}

function AccuracyByDifficultyCard({
  analytics,
  loading,
  error,
  sectionStyle,
  onCollapse,
}: {
  analytics: DifficultyBucketAnalyticsData | null;
  loading: boolean;
  error: string | null;
  sectionStyle?: React.CSSProperties;
  onCollapse?: () => void;
}) {
  const { message, highlightLabel } = useMemo(
    () => resolveDifficultyInsight(analytics),
    [analytics],
  );
  const buckets = analytics?.difficultyBuckets ?? [];
  const maxAttempts = Math.max(1, ...buckets.map((bucket) => bucket.totalAttempts));

  return (
    <article
      className="neumo-surface-soft rounded-3xl px-5 py-4 min-h-[108px] flex flex-col justify-between"
      style={sectionStyle}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.08em] text-slate-500">Analytics</p>
          <h3 className="mt-1 text-base font-semibold text-slate-700">Accuracy by Difficulty</h3>
          <p className="mt-1 text-xs text-slate-500">
            Correct first-move rate by puzzle difficulty bucket.
          </p>
        </div>
        {onCollapse && (
          <button
            type="button"
            onClick={onCollapse}
            className="rounded-full neumo-pill px-3 py-1 text-xs font-semibold text-slate-600 inline-flex items-center gap-1.5 transition-all duration-200 hover:-translate-y-[1px] hover:text-slate-700 hover:shadow-[0_8px_16px_rgba(15,23,42,0.12)]"
            style={sectionStyle}
            aria-label="Collapse accuracy by difficulty section"
          >
            <ChevronUp className="h-3.5 w-3.5" />
            Collapse
          </button>
        )}
      </div>

      {loading ? (
        <p className="mt-3 text-xs text-slate-400">Loading difficulty analytics…</p>
      ) : error ? (
        <p className="mt-3 text-xs text-slate-400">Difficulty analytics are unavailable right now.</p>
      ) : (
        <>
          <div className="mt-3 space-y-2">
            {buckets.map((bucket) => {
              const isHighlighted = highlightLabel !== null && highlightLabel === bucket.label;
              const accuracyWidth = `${clamp(bucket.accuracyPercentage, 0, 100)}%`;
              const attemptsWidth = `${Math.max(8, (bucket.totalAttempts / maxAttempts) * 100)}%`;
              return (
                <div
                  key={bucket.label}
                  className={`rounded-xl border px-3 py-2 ${
                    isHighlighted
                      ? 'border-amber-300/80 bg-amber-50/60 dark:bg-amber-900/20'
                      : 'border-slate-200/70 bg-white/25'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="font-medium text-slate-700">
                      {formatDifficultyBucketLabel(bucket.label)}
                    </span>
                    <span className="font-semibold text-slate-700">
                      {Math.round(bucket.accuracyPercentage)}%
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 rounded-full bg-slate-200/70">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-cyan-500/80 to-blue-600/80"
                      style={{ width: accuracyWidth }}
                    />
                  </div>
                  <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px] text-slate-500">
                    <span>
                      {bucket.correctAttempts}/{bucket.totalAttempts} correct
                    </span>
                    <span>
                      Avg solve:{' '}
                      {bucket.averageSolveTimeSeconds === null
                        ? 'N/A'
                        : formatSolveTimeSeconds(bucket.averageSolveTimeSeconds)}
                    </span>
                  </div>
                  <div className="mt-1 h-1 rounded-full bg-slate-200/45">
                    <div
                      className="h-full rounded-full bg-slate-400/55"
                      style={{ width: attemptsWidth }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-[11px] text-slate-500">{message}</p>
          {analytics && (
            <p className="mt-1 text-[10px] text-slate-400">
              Based on {analytics.totalValidAttempts} valid attempts (confidence threshold{' '}
              {Math.round(analytics.confidenceThreshold * 100)}%).
            </p>
          )}
        </>
      )}
    </article>
  );
}

function PuzzleRatingProgressionChart({
  data,
  sectionStyle,
  onCollapse,
}: {
  data: PuzzleRatingProgressionData;
  sectionStyle?: React.CSSProperties;
  onCollapse?: () => void;
}) {
  const chartId = useId();
  const [showAccuracyOverlay, setShowAccuracyOverlay] = useState(false);
  const eloValues = data.eloValues;
  const accuracyValues = data.accuracyValues;
  const axisLabels = data.axisLabels;
  const hasValues = eloValues.length >= 2;
  const hasAccuracyOverlay = accuracyValues.length === eloValues.length && accuracyValues.length >= 2;
  const yAxisTicks = useMemo(() => buildYAxisTicks(eloValues), [eloValues]);
  const maxElo = yAxisTicks.length > 0 ? Math.max(yAxisTicks[0], 0) : 0;
  const normalizedEloMax = Math.max(maxElo, 1);
  const { areaPath, linePath } = useMemo(() => buildChartPaths(eloValues, 860, 190), [eloValues]);
  const scaledAccuracyValues = useMemo(
    () =>
      accuracyValues.map((value) =>
        (clamp(value, 0, 100) / 100) * normalizedEloMax,
      ),
    [accuracyValues, normalizedEloMax],
  );
  const accuracyLinePath = useMemo(
    () => buildLinePathWithMax(scaledAccuracyValues, 860, 190, normalizedEloMax),
    [scaledAccuracyValues, normalizedEloMax],
  );
  const axisTickY = (tick: number) => {
    const padTop = 18;
    const usableHeight = 190 - padTop - 16;
    const normalizedValue = normalizedEloMax > 0 ? tick / normalizedEloMax : 0;
    return 190 - 12 - normalizedValue * usableHeight;
  };

  return (
    <article
      id={`puzzle-rating-progression-${chartId}`}
      className="neumo-surface-soft rounded-3xl px-5 py-4 min-h-[108px] flex flex-col justify-between"
      style={sectionStyle}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.08em] text-slate-500">Analytics</p>
          <h3 className="mt-1 text-base font-semibold text-slate-700">Puzzle Rating Progression</h3>
          <p className="mt-1 text-xs text-slate-500">{data.subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          {hasAccuracyOverlay && (
            <button
              type="button"
              onClick={() => setShowAccuracyOverlay((previous) => !previous)}
              className="rounded-full neumo-pill px-3 py-1 text-xs font-semibold text-slate-600 inline-flex items-center gap-1.5 transition-all duration-200 hover:-translate-y-[1px] hover:text-slate-700 hover:shadow-[0_8px_16px_rgba(15,23,42,0.12)]"
              style={sectionStyle}
              aria-pressed={showAccuracyOverlay}
              aria-label="Toggle accuracy trend overlay"
            >
              {showAccuracyOverlay ? 'Hide accuracy overlay' : 'Show accuracy overlay'}
            </button>
          )}
          {onCollapse && (
            <button
              type="button"
              onClick={onCollapse}
              className="rounded-full neumo-pill px-3 py-1 text-xs font-semibold text-slate-600 inline-flex items-center gap-1.5 transition-all duration-200 hover:-translate-y-[1px] hover:text-slate-700 hover:shadow-[0_8px_16px_rgba(15,23,42,0.12)]"
              style={sectionStyle}
              aria-label="Collapse puzzle rating progression section"
            >
              <ChevronUp className="h-3.5 w-3.5" />
              Collapse
            </button>
          )}
        </div>
      </div>

      {!hasValues ? (
        <p className="mt-3 text-xs text-slate-400">No solved puzzle Elo data yet.</p>
      ) : (
        <div className="mt-3">
          <svg
            viewBox="-44 0 904 190"
            className="h-[170px] w-full"
            role="img"
            aria-label="Puzzle rating progression line chart"
          >
            <defs>
              <linearGradient id={`${chartId}-rating-fill`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#ffffff" stopOpacity="0.88" />
                <stop offset="100%" stopColor="#e9eef6" stopOpacity="0.42" />
              </linearGradient>
              <linearGradient id={`${chartId}-rating-line`} x1="0" x2="1" y1="0" y2="0">
                <stop offset="0%" stopColor="#1d4ed8" stopOpacity="0.76" />
                <stop offset="100%" stopColor="#0891b2" stopOpacity="0.82" />
              </linearGradient>
              <linearGradient id={`${chartId}-accuracy-line`} x1="0" x2="1" y1="0" y2="0">
                <stop offset="0%" stopColor="#d946ef" stopOpacity="0.72" />
                <stop offset="100%" stopColor="#f97316" stopOpacity="0.78" />
              </linearGradient>
            </defs>

            <g stroke="rgba(148,163,184,0.22)" strokeWidth="1">
              {yAxisTicks.map((tick, idx) => (
                <line key={`${tick}-${idx}`} x1="0" y1={axisTickY(tick)} x2="860" y2={axisTickY(tick)} />
              ))}
              <line x1="0" y1="18" x2="0" y2="178" />
            </g>
            <g fill="rgba(100,116,139,0.78)" fontSize="10">
              {yAxisTicks.map((tick, idx) => (
                <text key={`rating-y-axis-${tick}-${idx}`} x="-8" y={axisTickY(tick) + 3} textAnchor="end">
                  {tick}
                </text>
              ))}
            </g>

            <path d={areaPath} fill={`url(#${chartId}-rating-fill)`} />
            <path
              d={linePath}
              fill="none"
              stroke={`url(#${chartId}-rating-line)`}
              strokeWidth="3.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {showAccuracyOverlay && hasAccuracyOverlay && (
              <path
                d={accuracyLinePath}
                fill="none"
                stroke={`url(#${chartId}-accuracy-line)`}
                strokeWidth="2.4"
                strokeDasharray="5 5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
          </svg>

          <div className="mt-2 flex flex-wrap items-center gap-4 text-[11px] text-slate-500">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-blue-500/80" />
              Puzzle Elo
            </span>
            {showAccuracyOverlay && hasAccuracyOverlay && (
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-fuchsia-500/70" />
                Accuracy (scaled overlay)
              </span>
            )}
          </div>
          {showAccuracyOverlay && hasAccuracyOverlay && (
            <p className="mt-1 text-[11px] text-slate-400">
              Accuracy overlay is normalized to the Elo axis for visual comparison.
            </p>
          )}
          <div className="mt-3 flex items-center justify-between gap-2 text-[11px] text-slate-400 md:text-xs">
            {axisLabels.map((label, idx) => (
              <span key={`${label}-${idx}`} className={idx === axisLabels.length - 1 ? 'text-right' : ''}>
                {label}
              </span>
            ))}
          </div>
        </div>
      )}
    </article>
  );
}

function FirstMoveAccuracyCard({
  summary,
  sectionStyle,
  onCollapse,
}: {
  summary: FirstMoveAccuracySummary;
  sectionStyle?: React.CSSProperties;
  onCollapse?: () => void;
}) {
  const accuracyText =
    summary.accuracyPercent === null ? 'N/A' : `${summary.accuracyPercent}%`;
  const avgTimeText =
    summary.averageTimeToFirstMoveSeconds === null
      ? 'N/A'
      : `${summary.averageTimeToFirstMoveSeconds.toFixed(2)}s`;

  return (
    <article
      className="neumo-surface-soft rounded-3xl px-5 py-4 min-h-[108px] flex flex-col justify-between"
      style={sectionStyle}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.08em] text-slate-500">Analytics</p>
          <h3 className="mt-1 text-base font-semibold text-slate-700">First-Move Accuracy</h3>
          <p className="mt-1 text-xs text-slate-500">
            Measures whether the first move matched the best tactical move.
          </p>
        </div>
        {onCollapse && (
          <button
            type="button"
            onClick={onCollapse}
            className="rounded-full neumo-pill px-3 py-1 text-xs font-semibold text-slate-600 inline-flex items-center gap-1.5 transition-all duration-200 hover:-translate-y-[1px] hover:text-slate-700 hover:shadow-[0_8px_16px_rgba(15,23,42,0.12)]"
            style={sectionStyle}
            aria-label="Collapse first-move accuracy section"
          >
            <ChevronUp className="h-3.5 w-3.5" />
            Collapse
          </button>
        )}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 text-[11px]">
        <div className="rounded-xl border border-slate-200/70 bg-white/25 px-3 py-2">
          <p className="uppercase tracking-[0.08em] text-slate-400">Accuracy</p>
          <p className="mt-1 text-base font-semibold text-slate-700">{accuracyText}</p>
          <p className="mt-1 text-slate-400">
            {summary.correctCount} / {summary.validAttemptCount} valid attempts
          </p>
        </div>
        <div className="rounded-xl border border-slate-200/70 bg-white/25 px-3 py-2">
          <p className="uppercase tracking-[0.08em] text-slate-400">Avg first-move time</p>
          <p className="mt-1 text-base font-semibold text-slate-700">{avgTimeText}</p>
          <p className="mt-1 text-slate-400">From valid attempted puzzles</p>
        </div>
      </div>

      <div className="mt-3 rounded-xl border border-slate-200/70 bg-white/25 px-3 py-2">
        <p className="text-[11px] uppercase tracking-[0.08em] text-slate-400">Common wrong first moves</p>
        {summary.commonWrongFirstMoves.length === 0 ? (
          <p className="mt-2 text-[11px] text-slate-400">No wrong first-move patterns yet.</p>
        ) : (
          <div className="mt-2 space-y-1.5">
            {summary.commonWrongFirstMoves.map((entry) => (
              <div
                key={`${entry.move}-${entry.count}`}
                className="flex items-center justify-between gap-2 text-[11px]"
              >
                <span className="font-medium text-slate-600">{entry.move}</span>
                <span className="rounded-full px-2 py-0.5 text-slate-600 bg-slate-100">
                  {entry.count}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

function NeumorphicColorWheel({
  label,
  color,
  onColorChange,
}: {
  label: string;
  color: string;
  onColorChange: (nextColor: string) => void;
}) {
  const wheelRef = useRef<HTMLDivElement | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const colorChannels = useMemo<[number, number, number]>(
    () => hexToRgbChannels(color) ?? hexToRgbChannels(DEFAULT_DASHBOARD_ACCENT) ?? [122, 148, 191],
    [color],
  );
  const [hue, saturation] = useMemo(
    () => rgbToHsl(colorChannels[0], colorChannels[1], colorChannels[2]),
    [colorChannels],
  );
  const puckRadiusPercent = clamp(saturation, 8, 100) / 100;
  const puckDistancePercent = puckRadiusPercent * 40;
  const hueRadians = (hue * Math.PI) / 180;
  const puckLeftPercent = 50 + Math.cos(hueRadians) * puckDistancePercent;
  const puckTopPercent = 50 + Math.sin(hueRadians) * puckDistancePercent;

  const applyPointerColor = (clientX: number, clientY: number) => {
    if (!wheelRef.current) {
      return;
    }

    const rect = wheelRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const dx = clientX - centerX;
    const dy = clientY - centerY;
    const maxRadius = rect.width / 2;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const clampedDistance = Math.min(distance, maxRadius);
    const hueAngle = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
    const saturationPercent = clamp((clampedDistance / maxRadius) * 100, 8, 100);
    const nextChannels = hslToRgb(hueAngle, saturationPercent, 62);
    onColorChange(rgbChannelsToHex(nextChannels));
  };

  return (
    <div className="flex flex-col items-center">
      <div
        ref={wheelRef}
        aria-label={`${label} color wheel`}
        className={`relative h-44 w-44 rounded-full p-[10px] select-none touch-none ${
          isDragging ? 'cursor-grabbing' : 'cursor-grab'
        }`}
        style={{
          background:
            'conic-gradient(#FF4D4D, #FFB74D, #A3E635, #22D3EE, #6366F1, #EC4899, #FF4D4D)',
          boxShadow: `0 0 0 1px ${rgbaFromChannels(colorChannels, 0.2)}, 14px 14px 24px rgba(15, 23, 42, 0.16)`,
        }}
        onPointerDown={(event) => {
          event.preventDefault();
          activePointerIdRef.current = event.pointerId;
          wheelRef.current?.setPointerCapture(event.pointerId);
          setIsDragging(true);
          applyPointerColor(event.clientX, event.clientY);
        }}
        onPointerMove={(event) => {
          if (activePointerIdRef.current !== event.pointerId) {
            return;
          }
          applyPointerColor(event.clientX, event.clientY);
        }}
        onPointerUp={(event) => {
          if (activePointerIdRef.current !== event.pointerId) {
            return;
          }
          if (wheelRef.current?.hasPointerCapture(event.pointerId)) {
            wheelRef.current.releasePointerCapture(event.pointerId);
          }
          activePointerIdRef.current = null;
          setIsDragging(false);
        }}
        onPointerCancel={(event) => {
          if (activePointerIdRef.current !== event.pointerId) {
            return;
          }
          if (wheelRef.current?.hasPointerCapture(event.pointerId)) {
            wheelRef.current.releasePointerCapture(event.pointerId);
          }
          activePointerIdRef.current = null;
          setIsDragging(false);
        }}
      >
        <div className="pointer-events-none h-full w-full rounded-full bg-[radial-gradient(circle,#ffffff_0%,#f1f5f9_65%,#cbd5e1_100%)]" />
        <span
          className="pointer-events-none absolute h-14 w-14 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-white shadow-[0_12px_20px_rgba(15,23,42,0.28)]"
          style={{
            left: `${puckLeftPercent}%`,
            top: `${puckTopPercent}%`,
            backgroundColor: color,
          }}
        />
      </div>
      <p className="mt-3 text-xs uppercase tracking-[0.08em] text-slate-500">{label}</p>
    </div>
  );
}

function SettingsPanel({
  backendUrl,
  isDark,
  accentColor,
  accentChannels,
  secondaryColor,
  secondaryChannels,
  gradientEnabled,
  gradientDirection,
  onThemeModeChange,
  onAccentChange,
  onSecondaryColorChange,
  onGradientEnabledChange,
  onGradientDirectionChange,
  assistantConversationMode,
  onAssistantConversationModeChange,
  onAccentReset,
  onSaveTheme,
  hasUnsavedThemeChanges,
  themeSavedNoticeVisible,
  sectionStyle,
  buttonStyle,
}: {
  backendUrl: string;
  isDark: boolean;
  accentColor: string;
  accentChannels: [number, number, number];
  secondaryColor: string;
  secondaryChannels: [number, number, number];
  gradientEnabled: boolean;
  gradientDirection: GradientDirection;
  onThemeModeChange: (mode: 'light' | 'dark') => void;
  onAccentChange: (nextColor: string) => void;
  onSecondaryColorChange: (nextColor: string) => void;
  onGradientEnabledChange: (enabled: boolean) => void;
  onGradientDirectionChange: (direction: GradientDirection) => void;
  assistantConversationMode: AssistantConversationMode;
  onAssistantConversationModeChange: (mode: AssistantConversationMode) => void;
  onAccentReset: () => void;
  onSaveTheme: () => void;
  hasUnsavedThemeChanges: boolean;
  themeSavedNoticeVisible: boolean;
  sectionStyle?: React.CSSProperties;
  buttonStyle?: React.CSSProperties;
}) {
  const swatchColors = NEUMORPHIC_SWATCH_COLORS;
  const { user } = useUser();
  const [activeLocalUser, setActiveLocalUser] = useState(() => readActiveLocalAuthUser());
  const [profileEmail, setProfileEmail] = useState('');
  const [profileUsername, setProfileUsername] = useState('');
  const [profileStatus, setProfileStatus] = useState<string | null>(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordStatus, setPasswordStatus] = useState<string | null>(null);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const authDisplayEmail = typeof user?.email === 'string' ? user.email : '';
  const authDisplayName =
    (typeof user?.name === 'string' && user.name.trim()) ||
    (typeof user?.nickname === 'string' && user.nickname.trim()) ||
    authDisplayEmail;
  const hasLocalSession = Boolean(activeLocalUser?.id && activeLocalUser?.sessionToken);

  useEffect(() => {
    const syncActiveLocalUser = () => {
      setActiveLocalUser(readActiveLocalAuthUser());
    };

    syncActiveLocalUser();
    window.addEventListener(LOCAL_AUTH_ACTIVE_USER_UPDATED_EVENT, syncActiveLocalUser);
    window.addEventListener('storage', syncActiveLocalUser);
    return () => {
      window.removeEventListener(LOCAL_AUTH_ACTIVE_USER_UPDATED_EVENT, syncActiveLocalUser);
      window.removeEventListener('storage', syncActiveLocalUser);
    };
  }, []);

  useEffect(() => {
    setProfileEmail(activeLocalUser?.email ?? authDisplayEmail ?? '');
    setProfileUsername(activeLocalUser?.username ?? authDisplayName ?? '');
  }, [activeLocalUser?.email, activeLocalUser?.username, authDisplayEmail, authDisplayName]);

  const handleProfileSave = async () => {
    setProfileStatus(null);
    const nextEmail = profileEmail.trim().toLowerCase();
    const nextUsername = profileUsername.trim();
    if (!hasLocalSession) {
      setProfileStatus('Sign in with a local account to update profile details.');
      return;
    }
    if (!nextEmail || !nextUsername) {
      setProfileStatus('Email and username are required.');
      return;
    }

    setProfileSaving(true);
    try {
      const authContext = await getRequestAuthContextClient({ includeJsonContentType: true });
      const response = await fetch(`${backendUrl}/auth/me/local/profile`, {
        method: 'PATCH',
        headers: authContext.headers,
        body: JSON.stringify({ email: nextEmail, username: nextUsername }),
      });
      const { payload, text } = await readResponsePayload<{
        id?: string;
        username?: string;
        email?: string;
      }>(response);

      if (!response.ok) {
        setProfileStatus(responseErrorMessage(payload, 'Could not save profile.', text));
        return;
      }

      const updatedUser = {
        id: typeof payload?.id === 'string' ? payload.id : activeLocalUser?.id ?? '',
        username: typeof payload?.username === 'string' ? payload.username : nextUsername,
        email: typeof payload?.email === 'string' ? payload.email : nextEmail,
        sessionToken: activeLocalUser?.sessionToken ?? '',
      };
      writeActiveLocalAuthUser(updatedUser);
      setProfileStatus('Profile saved.');
    } catch {
      setProfileStatus('Could not reach the profile service.');
    } finally {
      setProfileSaving(false);
    }
  };

  const handlePasswordUpdate = async () => {
    setPasswordStatus(null);
    if (!hasLocalSession) {
      setPasswordStatus('Sign in with a local account to change your password.');
      return;
    }
    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordStatus('Current password, new password, and confirmation are required.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordStatus('New password and confirmation do not match.');
      return;
    }
    if (newPassword.length < 8 || !/[a-zA-Z]/.test(newPassword) || !/\d/.test(newPassword)) {
      setPasswordStatus('New password must be at least 8 characters and include a letter and number.');
      return;
    }

    setPasswordSaving(true);
    try {
      const authContext = await getRequestAuthContextClient({ includeJsonContentType: true });
      const response = await fetch(`${backendUrl}/auth/me/local/password`, {
        method: 'POST',
        headers: authContext.headers,
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
        }),
      });
      const { payload, text } = await readResponsePayload(response);
      if (!response.ok) {
        setPasswordStatus(responseErrorMessage(payload, 'Could not update password.', text));
        return;
      }

      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordStatus('Password updated.');
    } catch {
      setPasswordStatus('Could not reach the password service.');
    } finally {
      setPasswordSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <section className="neumo-surface-soft rounded-[26px] p-5 md:p-7" style={sectionStyle}>
        <h2 className="text-2xl font-semibold tracking-tight text-slate-700">Account &amp; Profile</h2>
        <p className="mt-1 text-sm text-slate-500">
          Update identity details, manage credentials, and control account access.
        </p>

        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <article className="rounded-2xl neumo-inset px-4 py-4">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
              Email / username
            </p>
            <div className="mt-3 space-y-3">
              <label className="block">
                <span className="text-xs text-slate-500">Email</span>
                <input
                  type="email"
                  value={profileEmail}
                  onChange={(event) => setProfileEmail(event.target.value)}
                  autoComplete="email"
                  className="mt-1 w-full rounded-xl border border-slate-200/70 bg-white/80 px-3 py-2 text-sm text-slate-700 outline-none focus:border-slate-400"
                />
              </label>
              <label className="block">
                <span className="text-xs text-slate-500">Username</span>
                <input
                  type="text"
                  value={profileUsername}
                  onChange={(event) => setProfileUsername(event.target.value)}
                  autoComplete="username"
                  className="mt-1 w-full rounded-xl border border-slate-200/70 bg-white/80 px-3 py-2 text-sm text-slate-700 outline-none focus:border-slate-400"
                />
              </label>
              <button
                type="button"
                onClick={handleProfileSave}
                disabled={profileSaving || !hasLocalSession}
                className="neumo-pill mt-1 px-4 py-2 text-sm font-semibold text-slate-600 transition-all duration-200 hover:-translate-y-[1px] hover:text-slate-700 hover:shadow-[0_8px_16px_rgba(15,23,42,0.12)]"
                style={buttonStyle}
              >
                {profileSaving ? 'Saving...' : 'Save profile'}
              </button>
              {profileStatus && <p className="text-xs text-slate-500">{profileStatus}</p>}
            </div>
          </article>

          <article className="rounded-2xl neumo-inset px-4 py-4">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
              Change password
            </p>
            <div className="mt-3 space-y-3">
              <label className="block">
                <span className="text-xs text-slate-500">Current password</span>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  autoComplete="current-password"
                  className="mt-1 w-full rounded-xl border border-slate-200/70 bg-white/80 px-3 py-2 text-sm text-slate-700 outline-none focus:border-slate-400"
                />
              </label>
              <label className="block">
                <span className="text-xs text-slate-500">New password</span>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  autoComplete="new-password"
                  className="mt-1 w-full rounded-xl border border-slate-200/70 bg-white/80 px-3 py-2 text-sm text-slate-700 outline-none focus:border-slate-400"
                />
              </label>
              <label className="block">
                <span className="text-xs text-slate-500">Confirm password</span>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  autoComplete="new-password"
                  className="mt-1 w-full rounded-xl border border-slate-200/70 bg-white/80 px-3 py-2 text-sm text-slate-700 outline-none focus:border-slate-400"
                />
              </label>
              <button
                type="button"
                onClick={handlePasswordUpdate}
                disabled={passwordSaving || !hasLocalSession}
                className="neumo-pill mt-1 px-4 py-2 text-sm font-semibold text-slate-600 transition-all duration-200 hover:-translate-y-[1px] hover:text-slate-700 hover:shadow-[0_8px_16px_rgba(15,23,42,0.12)]"
                style={buttonStyle}
              >
                {passwordSaving ? 'Updating...' : 'Update password'}
              </button>
              {passwordStatus && <p className="text-xs text-slate-500">{passwordStatus}</p>}
            </div>
          </article>
        </div>

        <article className="mt-4 rounded-2xl neumo-inset px-4 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
            Assistant conversation mode
          </p>
          <p className="mt-1 text-sm text-slate-500">
            Choose how the chess assistant speaks, paces hints, and structures guidance.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {ASSISTANT_CONVERSATION_MODE_OPTIONS.map((option) => {
              const isActive = assistantConversationMode === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => onAssistantConversationModeChange(option.value)}
                  className={`rounded-2xl border px-3 py-2 text-left transition-all duration-200 ${
                    isActive
                      ? isDark
                        ? 'border-slate-500/80 bg-slate-700/85 shadow-[0_8px_16px_rgba(0,0,0,0.28)]'
                        : 'border-cyan-300/80 bg-cyan-50/75 shadow-[0_8px_16px_rgba(15,23,42,0.1)]'
                      : isDark
                        ? 'border-slate-700/70 bg-slate-900/45 hover:border-slate-500/80'
                        : 'border-slate-200/70 bg-white/80 hover:border-cyan-200/70'
                  }`}
                >
                  <p
                    className={`text-sm font-semibold ${
                      isActive && isDark ? 'text-slate-50' : 'text-slate-700 dark:text-slate-200'
                    }`}
                  >
                    {option.label}
                  </p>
                  <p
                    className={`mt-0.5 text-xs ${
                      isActive && isDark ? 'text-slate-200' : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    {option.tone}
                  </p>
                  <p
                    className={`mt-1 text-xs ${
                      isActive && isDark ? 'text-slate-100' : 'text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    &quot;{option.sample}&quot;
                  </p>
                </button>
              );
            })}
          </div>
        </article>

        <article className="mt-4 rounded-2xl border border-red-200/70 bg-red-50/70 px-4 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-red-500">Delete account</p>
          <p className="mt-2 text-sm text-red-700">
            Permanently remove your profile and puzzle history. This action is irreversible.
          </p>
          <button
            type="button"
            className="mt-3 rounded-full bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700"
          >
            Delete account
          </button>
        </article>
      </section>

      <section className="neumo-surface-soft rounded-[26px] p-5 md:p-7" style={sectionStyle}>
        <h2 className="text-2xl font-semibold tracking-tight text-slate-700">Theme &amp; UI</h2>
        <p className="mt-1 text-sm text-slate-500">
          Drag the hockey puck to recolor the dashboard background in real time while keeping the
          classic Chess App neumorphic surface style.
        </p>

        <div className="mt-5 rounded-2xl neumo-inset px-4 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Theme mode</p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => onThemeModeChange('light')}
              className={`px-4 py-2 text-sm font-semibold rounded-full transition-all duration-200 hover:-translate-y-[1px] hover:shadow-[0_8px_16px_rgba(15,23,42,0.12)] ${
                !isDark ? 'neumo-pill text-slate-700' : 'neumo-inset text-slate-500'
              }`}
              style={buttonStyle}
            >
              Light
            </button>
            <button
              type="button"
              onClick={() => onThemeModeChange('dark')}
              className={`px-4 py-2 text-sm font-semibold rounded-full transition-all duration-200 hover:-translate-y-[1px] hover:shadow-[0_8px_16px_rgba(15,23,42,0.12)] ${
                isDark ? 'neumo-pill text-slate-700' : 'neumo-inset text-slate-500'
              }`}
              style={buttonStyle}
            >
              Dark
            </button>
          </div>
        </div>

        <div className="mt-4 rounded-2xl neumo-inset px-4 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
            Background style
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => onGradientEnabledChange(false)}
              className={`px-4 py-2 text-sm font-semibold rounded-full transition-all duration-200 hover:-translate-y-[1px] hover:shadow-[0_8px_16px_rgba(15,23,42,0.12)] ${
                !gradientEnabled ? 'neumo-pill text-slate-700' : 'neumo-inset text-slate-500'
              }`}
              style={buttonStyle}
            >
              Solid
            </button>
            <button
              type="button"
              onClick={() => onGradientEnabledChange(true)}
              className={`px-4 py-2 text-sm font-semibold rounded-full transition-all duration-200 hover:-translate-y-[1px] hover:shadow-[0_8px_16px_rgba(15,23,42,0.12)] ${
                gradientEnabled ? 'neumo-pill text-slate-700' : 'neumo-inset text-slate-500'
              }`}
              style={buttonStyle}
            >
              Gradient
            </button>
          </div>
        </div>

        {gradientEnabled && (
          <div className="mt-4 rounded-2xl neumo-inset px-4 py-4">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
              Gradient direction
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {GRADIENT_DIRECTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => onGradientDirectionChange(option.value)}
                  className={`px-4 py-2 text-sm font-semibold rounded-full transition-all duration-200 hover:-translate-y-[1px] hover:shadow-[0_8px_16px_rgba(15,23,42,0.12)] ${
                    gradientDirection === option.value
                      ? 'neumo-pill text-slate-700'
                      : 'neumo-inset text-slate-500'
                  }`}
                  style={buttonStyle}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-5 grid gap-6 xl:grid-cols-[minmax(220px,1fr)_1fr]">
          <div className="space-y-5">
            <NeumorphicColorWheel
              label="Primary puck"
              color={accentColor}
              onColorChange={onAccentChange}
            />
            {gradientEnabled && (
              <NeumorphicColorWheel
                label="Gradient puck"
                color={secondaryColor}
                onColorChange={onSecondaryColorChange}
              />
            )}
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl neumo-inset px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                Active application colors
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <span
                  className="h-8 w-8 rounded-full border-2 border-white shadow-[0_4px_10px_rgba(15,23,42,0.18)]"
                  style={{ backgroundColor: accentColor }}
                />
                <code className="rounded-lg bg-slate-900 px-2 py-1 text-xs text-slate-100">{accentColor}</code>
                {gradientEnabled && (
                  <>
                    <span
                      className="h-8 w-8 rounded-full border-2 border-white shadow-[0_4px_10px_rgba(15,23,42,0.18)]"
                      style={{ backgroundColor: secondaryColor }}
                    />
                    <code className="rounded-lg bg-slate-900 px-2 py-1 text-xs text-slate-100">
                      {secondaryColor}
                    </code>
                  </>
                )}
                <button
                  type="button"
                  onClick={onAccentReset}
                  className="neumo-pill px-4 py-2 text-sm font-semibold text-slate-600 transition-all duration-200 hover:-translate-y-[1px] hover:text-slate-700 hover:shadow-[0_8px_16px_rgba(15,23,42,0.12)]"
                  style={buttonStyle}
                >
                  Reset default
                </button>
                <button
                  type="button"
                  onClick={onSaveTheme}
                  disabled={!hasUnsavedThemeChanges}
                  className="neumo-pill px-4 py-2 text-sm font-semibold text-slate-600 transition-all duration-200 hover:-translate-y-[1px] hover:text-slate-700 hover:shadow-[0_8px_16px_rgba(15,23,42,0.12)] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-none"
                  style={buttonStyle}
                >
                  Save theme
                </button>
                {themeSavedNoticeVisible && (
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-emerald-600">
                    Saved
                  </span>
                )}
              </div>
            </div>

            <div className="rounded-2xl neumo-inset px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                Quick color swatches
              </p>
              {!gradientEnabled && (
                <div className="mt-3">
                  <p className="mb-2 text-[11px] uppercase tracking-[0.08em] text-slate-400">
                    Solid color
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {swatchColors.map((color) => (
                      <button
                        key={`solid-${color}`}
                        type="button"
                        onClick={() => onAccentChange(color)}
                        aria-label={`Set solid color ${color}`}
                        className={`h-9 w-9 rounded-full border-2 border-white shadow-sm transition hover:scale-105 ${
                          color === accentColor ? 'ring-2 ring-slate-400/70' : ''
                        }`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>
              )}

              {gradientEnabled && (
                <div className="mt-3 space-y-3">
                  <div>
                    <p className="mb-2 text-[11px] uppercase tracking-[0.08em] text-slate-400">
                      Gradient start
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {swatchColors.map((color) => (
                        <button
                          key={`gradient-start-${color}`}
                          type="button"
                          onClick={() => onAccentChange(color)}
                          aria-label={`Set gradient start color ${color}`}
                          className={`h-9 w-9 rounded-full border-2 border-white shadow-sm transition hover:scale-105 ${
                            color === accentColor ? 'ring-2 ring-slate-400/70' : ''
                          }`}
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="mb-2 text-[11px] uppercase tracking-[0.08em] text-slate-400">
                      Gradient end
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {swatchColors.map((color) => (
                        <button
                          key={`gradient-end-${color}`}
                          type="button"
                          onClick={() => onSecondaryColorChange(color)}
                          aria-label={`Set gradient end color ${color}`}
                          className={`h-9 w-9 rounded-full border-2 border-white shadow-sm transition hover:scale-105 ${
                            color === secondaryColor ? 'ring-2 ring-slate-400/70' : ''
                          }`}
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {gradientEnabled && (
              <div className="rounded-2xl neumo-inset px-4 py-4">
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                  Gradient preview
                </p>
                <div
                  className="mt-3 h-14 rounded-2xl"
                  style={{
                    background: `linear-gradient(${resolveGradientAngle(gradientDirection)}, ${rgbaFromChannels(accentChannels, 0.92)} 0%, ${rgbaFromChannels(secondaryChannels, 0.95)} 100%)`,
                    boxShadow:
                      'inset 8px 8px 14px rgba(15,23,42,0.14), inset -8px -8px 14px rgba(255,255,255,0.62)',
                  }}
                />
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function DashboardPageContent() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const { user, isLoading: isUserLoading } = useUser();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedSection = searchParams?.get('section')?.trim().toLowerCase() ?? null;
  const initialNavLabel =
    NAV_ITEMS.find((item) => item.label.toLowerCase() === requestedSection)?.label ?? 'Dashboard';
  const isMounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const [hasVerifiedAuthState, setHasVerifiedAuthState] = useState(false);
  const [hasAuthenticatedSession, setHasAuthenticatedSession] = useState(false);
  const [activeNavLabel, setActiveNavLabel] = useState<string>(initialNavLabel);
  const [activeRange, setActiveRange] = useState<(typeof RANGE_TABS)[number]>('Today');
  const [dashboardPuzzleEloRange, setDashboardPuzzleEloRange] =
    useState<DashboardPuzzleEloRange>('7 Days');
  const [dashboardPuzzleEloCategory, setDashboardPuzzleEloCategory] =
    useState<DashboardPuzzleEloCategory>('overall');
  const [selectedAnalyticsTheme, setSelectedAnalyticsTheme] = useState<AnalyticsTheme | null>(null);
  const [isAnalyticsSectionsOpen, setIsAnalyticsSectionsOpen] = useState(true);
  const [openAnalyticsSecondarySubsections, setOpenAnalyticsSecondarySubsections] = useState<
    AnalyticsSecondarySubsection[]
  >(['Solve Time vs Difficulty', 'Puzzle Rating Progression']);
  const [isTransitioningToChessApp, setIsTransitioningToChessApp] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [showSubmissionHistory, setShowSubmissionHistory] = useState(false);
  const [submissions, setSubmissions] = useState<PuzzleSubmissionRecord[]>([]);
  const [submissionsSyncLoading, setSubmissionsSyncLoading] = useState(false);
  const [submissionsSyncError, setSubmissionsSyncError] = useState<string | null>(null);
  const [expandedSubmissionId, setExpandedSubmissionId] = useState<string | null>(null);
  const [accentColor, setAccentColor] = useState<string>(DEFAULT_DASHBOARD_ACCENT);
  const [secondaryColor, setSecondaryColor] = useState<string>(DEFAULT_DASHBOARD_SECONDARY);
  const [gradientEnabled, setGradientEnabled] = useState<boolean>(false);
  const [gradientDirection, setGradientDirection] = useState<GradientDirection>('top-to-bottom');
  const [savedThemeSettings, setSavedThemeSettings] = useState<ThemeSettings>({
    accentColor: DEFAULT_DASHBOARD_ACCENT,
    secondaryColor: DEFAULT_DASHBOARD_SECONDARY,
    gradientEnabled: false,
    gradientDirection: 'top-to-bottom',
  });
  const [themeSavedNoticeVisible, setThemeSavedNoticeVisible] = useState(false);
  const [settingsStorageScope, setSettingsStorageScope] = useState<string | null>(null);
  const [showAgentTimeoutBadge, setShowAgentTimeoutBadge] = useState(false);
  const [assistantConversationMode, setAssistantConversationMode] =
    useState<AssistantConversationMode>('coach');
  const [difficultyBucketAnalytics, setDifficultyBucketAnalytics] =
    useState<DifficultyBucketAnalyticsData | null>(null);
  const [difficultyBucketAnalyticsLoading, setDifficultyBucketAnalyticsLoading] = useState(false);
  const [difficultyBucketAnalyticsError, setDifficultyBucketAnalyticsError] = useState<string | null>(
    null,
  );
  const themeSavedNoticeTimeoutRef = useRef<number | null>(null);
  const autoThemePersistTimeoutRef = useRef<number | null>(null);
  const appliedThemeScopeRef = useRef<string | null>(null);
  const isDark = theme === 'dark' || (theme === 'system' && resolvedTheme === 'dark');
  const backendUrl = useMemo(
    () => process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://127.0.0.1:8010',
    [],
  );
  const isSolveTimeSectionOpen = openAnalyticsSecondarySubsections.includes(
    'Solve Time vs Difficulty',
  );
  const isRatingProgressionSectionOpen = openAnalyticsSecondarySubsections.includes(
    'Puzzle Rating Progression',
  );
  const isAccuracyByDifficultySectionOpen = openAnalyticsSecondarySubsections.includes(
    'Accuracy by Difficulty',
  );
  const isFirstMoveAccuracySectionOpen = openAnalyticsSecondarySubsections.includes(
    'First-Move Accuracy',
  );

  const openAnalyticsSecondarySubsection = useCallback((section: AnalyticsSecondarySubsection) => {
    setOpenAnalyticsSecondarySubsections((current) => {
      if (current.includes(section)) {
        return current;
      }
      if (current.length < ANALYTICS_MAX_OPEN_SECONDARY_SECTIONS) {
        return [...current, section];
      }
      return [...current.slice(0, -1), section];
    });
  }, []);

  const collapseAnalyticsSecondarySubsection = useCallback(
    (section: AnalyticsSecondarySubsection) => {
      setOpenAnalyticsSecondarySubsections((current) =>
        current.filter((currentSection) => currentSection !== section),
      );
    },
    [],
  );

  const applyThemeCssVariables = useCallback((accent: string, secondary: string) => {
    document.documentElement.style.setProperty('--chess-app-accent', accent);
    document.documentElement.style.setProperty('--chess-app-accent-secondary', secondary);
  }, []);

  useEffect(() => {
    if (!isMounted || isUserLoading) {
      return;
    }

    const syncAuthState = () => {
      const localAuthUser = readActiveLocalAuthUser();
      const hasSession =
        Boolean(user?.sub) ||
        Boolean(localAuthUser?.id);
      setHasAuthenticatedSession(hasSession);
      setHasVerifiedAuthState(true);
      if (!hasSession) {
        const returnTo =
          typeof window === 'undefined'
            ? '/dashboard'
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
    const refreshAgentTimeoutBadge = () => {
      const storageKey = buildAgentChatSessionStorageKey();
      const session = readPersistedAgentChatSession(storageKey);
      const shouldShow = shouldShowAgentTimeoutBadge(session);
      setShowAgentTimeoutBadge(shouldShow);

      if (!session) {
        return;
      }
      const elapsedMs = Date.now() - session.lastActivityAtMs;
      if (elapsedMs >= AGENT_CHAT_INACTIVITY_TIMEOUT_MS) {
        window.localStorage.removeItem(storageKey);
      }
    };

    refreshAgentTimeoutBadge();
    const interval = window.setInterval(
      refreshAgentTimeoutBadge,
      AGENT_CHAT_BADGE_POLL_INTERVAL_MS,
    );
    window.addEventListener('focus', refreshAgentTimeoutBadge);
    window.addEventListener('storage', refreshAgentTimeoutBadge);
    window.addEventListener(LOCAL_AUTH_ACTIVE_USER_UPDATED_EVENT, refreshAgentTimeoutBadge);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshAgentTimeoutBadge);
      window.removeEventListener('storage', refreshAgentTimeoutBadge);
      window.removeEventListener(LOCAL_AUTH_ACTIVE_USER_UPDATED_EVENT, refreshAgentTimeoutBadge);
    };
  }, []);

  const persistThemeSettings = useCallback(
    (themeSettings: ThemeSettings, options?: { showSavedNotice?: boolean }) => {
      const showSavedNotice = options?.showSavedNotice ?? true;
      const normalizedAccent = normalizeHexColor(themeSettings.accentColor) ?? DEFAULT_DASHBOARD_ACCENT;
      const normalizedSecondary =
        normalizeHexColor(themeSettings.secondaryColor) ?? DEFAULT_DASHBOARD_SECONDARY;
      const normalizedDirection =
        themeSettings.gradientDirection === 'top-to-bottom' ||
        themeSettings.gradientDirection === 'diagonal' ||
        themeSettings.gradientDirection === 'bottom-to-top'
          ? themeSettings.gradientDirection
          : 'top-to-bottom';

      writeScopedStorageValue(DASHBOARD_ACCENT_STORAGE_KEY, settingsStorageScope, normalizedAccent);
      writeScopedStorageValue(
        DASHBOARD_SECONDARY_STORAGE_KEY,
        settingsStorageScope,
        normalizedSecondary,
      );
      writeScopedStorageValue(
        DASHBOARD_GRADIENT_ENABLED_STORAGE_KEY,
        settingsStorageScope,
        themeSettings.gradientEnabled ? '1' : '0',
      );
      writeScopedStorageValue(
        DASHBOARD_GRADIENT_DIRECTION_STORAGE_KEY,
        settingsStorageScope,
        normalizedDirection,
      );
      if (theme === 'light' || theme === 'dark') {
        writeScopedStorageValue(DASHBOARD_THEME_MODE_STORAGE_KEY, settingsStorageScope, theme);
      }
      applyThemeCssVariables(normalizedAccent, normalizedSecondary);
      window.dispatchEvent(new Event(DASHBOARD_THEME_UPDATED_EVENT));

      setSavedThemeSettings({
        accentColor: normalizedAccent,
        secondaryColor: normalizedSecondary,
        gradientEnabled: themeSettings.gradientEnabled,
        gradientDirection: normalizedDirection,
      });
      if (!showSavedNotice) {
        setThemeSavedNoticeVisible(false);
        if (themeSavedNoticeTimeoutRef.current !== null) {
          window.clearTimeout(themeSavedNoticeTimeoutRef.current);
          themeSavedNoticeTimeoutRef.current = null;
        }
        return;
      }
      setThemeSavedNoticeVisible(true);
      if (themeSavedNoticeTimeoutRef.current !== null) {
        window.clearTimeout(themeSavedNoticeTimeoutRef.current);
      }
      themeSavedNoticeTimeoutRef.current = window.setTimeout(() => {
        setThemeSavedNoticeVisible(false);
        themeSavedNoticeTimeoutRef.current = null;
      }, 1600);
    },
    [applyThemeCssVariables, settingsStorageScope, theme],
  );

  useEffect(() => {
    const syncThemeFromStorage = () => {
      const nextAccent =
        normalizeHexColor(readScopedStorageValue(DASHBOARD_ACCENT_STORAGE_KEY, settingsStorageScope)) ??
        DEFAULT_DASHBOARD_ACCENT;
      const nextSecondary =
        normalizeHexColor(
          readScopedStorageValue(DASHBOARD_SECONDARY_STORAGE_KEY, settingsStorageScope),
        ) ??
        DEFAULT_DASHBOARD_SECONDARY;
      const nextGradientEnabled =
        readScopedStorageValue(DASHBOARD_GRADIENT_ENABLED_STORAGE_KEY, settingsStorageScope) === '1';
      const storedDirection = readScopedStorageValue(
        DASHBOARD_GRADIENT_DIRECTION_STORAGE_KEY,
        settingsStorageScope,
      );
      const nextGradientDirection: GradientDirection =
        storedDirection === 'top-to-bottom' ||
        storedDirection === 'diagonal' ||
        storedDirection === 'bottom-to-top'
          ? storedDirection
          : 'top-to-bottom';

      setAccentColor((previous) => (previous === nextAccent ? previous : nextAccent));
      setSecondaryColor((previous) => (previous === nextSecondary ? previous : nextSecondary));
      setGradientEnabled((previous) =>
        previous === nextGradientEnabled ? previous : nextGradientEnabled,
      );
      setGradientDirection((previous) =>
        previous === nextGradientDirection ? previous : nextGradientDirection,
      );
      setSavedThemeSettings((previous) => {
        if (
          previous.accentColor === nextAccent &&
          previous.secondaryColor === nextSecondary &&
          previous.gradientEnabled === nextGradientEnabled &&
          previous.gradientDirection === nextGradientDirection
        ) {
          return previous;
        }
        return {
          accentColor: nextAccent,
          secondaryColor: nextSecondary,
          gradientEnabled: nextGradientEnabled,
          gradientDirection: nextGradientDirection,
        };
      });
      applyThemeCssVariables(nextAccent, nextSecondary);
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
  }, [applyThemeCssVariables, settingsStorageScope]);

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
    const syncAssistantConversationMode = () => {
      setAssistantConversationMode(readAssistantConversationMode(settingsStorageScope));
    };

    syncAssistantConversationMode();
    window.addEventListener('storage', syncAssistantConversationMode);
    window.addEventListener('focus', syncAssistantConversationMode);
    return () => {
      window.removeEventListener('storage', syncAssistantConversationMode);
      window.removeEventListener('focus', syncAssistantConversationMode);
    };
  }, [settingsStorageScope]);

  useEffect(() => {
    if (theme === 'light' || theme === 'dark') {
      writeScopedStorageValue(DASHBOARD_THEME_MODE_STORAGE_KEY, settingsStorageScope, theme);
    }
  }, [settingsStorageScope, theme]);

  useEffect(() => {
    const syncSubmissions = () => {
      const nextSubmissions = readPuzzleSubmissions();
      setSubmissions(nextSubmissions);
      markPuzzleSubmissionNotificationsSeen(nextSubmissions.length);
    };

    const updateEventName = getPuzzleSubmissionUpdateEventName();
    syncSubmissions();
    window.addEventListener('storage', syncSubmissions);
    window.addEventListener(updateEventName, syncSubmissions);

    return () => {
      window.removeEventListener('storage', syncSubmissions);
      window.removeEventListener(updateEventName, syncSubmissions);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function loadDifficultyAnalytics() {
      setDifficultyBucketAnalyticsLoading(true);
      setDifficultyBucketAnalyticsError(null);
      try {
        const auth = await getRequestAuthContextClient();
        if (!auth.hasAnyAuth) {
          throw new Error('auth_required');
        }

        const response = await fetch(`${backendUrl}/puzzles/analytics/difficulty-buckets`, {
          method: 'GET',
          headers: auth.headers,
          cache: 'no-store',
          signal: controller.signal,
        });
        const { payload, text } = await readResponsePayload(response);
        if (!response.ok) {
          throw new Error(
            responseErrorMessage(
              payload,
              `difficulty analytics fetch failed: ${response.status}`,
              text,
            ),
          );
        }
        const normalized = normalizeDifficultyBucketAnalyticsPayload(payload);
        if (cancelled) {
          return;
        }
        setDifficultyBucketAnalytics(normalized);
      } catch (error) {
        if (cancelled) {
          return;
        }
        setDifficultyBucketAnalytics(null);
        setDifficultyBucketAnalyticsError(
          error instanceof Error ? error.message : 'failed_to_load_difficulty_analytics',
        );
      } finally {
        if (!cancelled) {
          setDifficultyBucketAnalyticsLoading(false);
        }
      }
    }

    loadDifficultyAnalytics();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [backendUrl, submissions.length]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function loadStoredSubmissions() {
      setSubmissionsSyncLoading(true);
      setSubmissionsSyncError(null);
      try {
        const auth = await getRequestAuthContextClient();
        if (!auth.hasAnyAuth) {
          throw new Error('auth_required');
        }

        const response = await fetch(`${backendUrl}/puzzles/submissions?limit=500`, {
          method: 'GET',
          headers: auth.headers,
          cache: 'no-store',
          signal: controller.signal,
        });
        const { payload, text } = await readResponsePayload(response);
        if (!response.ok) {
          throw new Error(
            responseErrorMessage(
              payload,
              `puzzle submissions sync failed: ${response.status}`,
              text,
            ),
          );
        }

        if (!Array.isArray(payload)) {
          throw new Error('puzzle submissions sync returned unexpected payload');
        }
        if (cancelled) {
          return;
        }
        const incoming = payload as PuzzleSubmissionRecord[];
        const existingLocal = readPuzzleSubmissions();
        if (incoming.length === 0 && existingLocal.length > 0) {
          // Defensive fallback: avoid wiping local solved history when backend
          // returns empty due to transient auth/user-link mismatch.
          return;
        }
        replacePuzzleSubmissions(incoming);
      } catch (error) {
        if (cancelled) {
          return;
        }
        setSubmissionsSyncError(
          error instanceof Error ? error.message : 'failed_to_sync_puzzle_submissions',
        );
      } finally {
        if (!cancelled) {
          setSubmissionsSyncLoading(false);
        }
      }
    }

    loadStoredSubmissions();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [backendUrl, settingsStorageScope]);

  useEffect(() => {
    return () => {
      if (themeSavedNoticeTimeoutRef.current !== null) {
        window.clearTimeout(themeSavedNoticeTimeoutRef.current);
      }
      if (autoThemePersistTimeoutRef.current !== null) {
        window.clearTimeout(autoThemePersistTimeoutRef.current);
      }
    };
  }, []);

  const currentThemeSettings: ThemeSettings = useMemo(
    () => ({
      accentColor,
      secondaryColor,
      gradientEnabled,
      gradientDirection,
    }),
    [accentColor, gradientDirection, gradientEnabled, secondaryColor],
  );
  const hasUnsavedThemeChanges =
    currentThemeSettings.accentColor !== savedThemeSettings.accentColor ||
    currentThemeSettings.secondaryColor !== savedThemeSettings.secondaryColor ||
    currentThemeSettings.gradientEnabled !== savedThemeSettings.gradientEnabled ||
    currentThemeSettings.gradientDirection !== savedThemeSettings.gradientDirection;

  useEffect(() => {
    if (!hasUnsavedThemeChanges) {
      if (autoThemePersistTimeoutRef.current !== null) {
        window.clearTimeout(autoThemePersistTimeoutRef.current);
        autoThemePersistTimeoutRef.current = null;
      }
      return;
    }

    if (autoThemePersistTimeoutRef.current !== null) {
      window.clearTimeout(autoThemePersistTimeoutRef.current);
    }

    autoThemePersistTimeoutRef.current = window.setTimeout(() => {
      persistThemeSettings(currentThemeSettings, { showSavedNotice: false });
      autoThemePersistTimeoutRef.current = null;
    }, 350);

    return () => {
      if (autoThemePersistTimeoutRef.current !== null) {
        window.clearTimeout(autoThemePersistTimeoutRef.current);
        autoThemePersistTimeoutRef.current = null;
      }
    };
  }, [currentThemeSettings, hasUnsavedThemeChanges, persistThemeSettings]);

  const handleSaveTheme = () => {
    persistThemeSettings(currentThemeSettings, { showSavedNotice: true });
  };

  const handleThemeReset = () => {
    setAccentColor(DEFAULT_DASHBOARD_ACCENT);
    setSecondaryColor(DEFAULT_DASHBOARD_SECONDARY);
    setGradientEnabled(false);
    setGradientDirection('top-to-bottom');
    setThemeSavedNoticeVisible(false);
  };

  const handleBackToChessApp = () => {
    if (isTransitioningToChessApp) {
      return;
    }
    if (hasUnsavedThemeChanges) {
      persistThemeSettings(currentThemeSettings, { showSavedNotice: true });
    }
    setIsTransitioningToChessApp(true);
    window.setTimeout(() => {
      router.push('/solve-test');
    }, 280);
  };

  const handleLogout = () => {
    if (isLoggingOut) {
      return;
    }

    setIsLoggingOut(true);

    if (user?.sub) {
      window.location.href = '/api/auth/logout?returnTo=%2Flogin-test';
      return;
    }

    writeActiveLocalAuthUser(null);
    router.push('/login-test');
  };

  const solvedCount = submissions.length;
  const solvedMeta =
    solvedCount > 0
      ? `Last solve ${formatDateTime(submissions[0].submittedAt)}`
      : 'No solved submissions yet';
  const confidenceValues = submissions
    .map((submission) => submission.positionCheck.confidence)
    .filter((confidence): confidence is number => confidence !== null);
  const averageConfidence =
    confidenceValues.length > 0
      ? confidenceValues.reduce((sum, confidence) => sum + confidence, 0) / confidenceValues.length
      : null;
  const accuracyValue = averageConfidence !== null ? formatConfidence(averageConfidence) : 'N/A';
  const accuracyMeta =
    confidenceValues.length > 0
      ? `Across ${confidenceValues.length} submissions`
      : 'No confidence data yet';
  const { bestStreakDays, currentStreakDays } = calculateStreaks(submissions);
  const streakValue = `${bestStreakDays}d`;
  const streakMeta =
    submissions.length === 0
      ? 'Start submitting daily'
      : `Current streak ${currentStreakDays} day${currentStreakDays === 1 ? '' : 's'}`;
  const streakTier =
    bestStreakDays >= 14 ? 'legend' : bestStreakDays >= 7 ? 'hot' : bestStreakDays >= 3 ? 'warm' : 'base';
  const streakCardClassName =
    streakTier === 'legend'
      ? 'ring-2 ring-fuchsia-300/70 shadow-[0_0_0_1px_rgba(236,72,153,0.2),0_0_24px_rgba(236,72,153,0.28)]'
      : streakTier === 'hot'
      ? 'ring-2 ring-amber-300/70 shadow-[0_0_0_1px_rgba(245,158,11,0.2),0_0_22px_rgba(245,158,11,0.24)]'
      : streakTier === 'warm'
      ? 'ring-2 ring-emerald-300/70 shadow-[0_0_0_1px_rgba(16,185,129,0.15),0_0_16px_rgba(16,185,129,0.2)]'
      : '';
  const streakValueClassName =
    streakTier === 'legend'
      ? 'text-fuchsia-600 animate-pulse'
      : streakTier === 'hot'
      ? 'text-amber-600'
      : streakTier === 'warm'
      ? 'text-emerald-600'
      : '';
  const streakMetaClassName =
    streakTier === 'legend'
      ? 'text-fuchsia-500'
      : streakTier === 'hot'
      ? 'text-amber-500'
      : streakTier === 'warm'
      ? 'text-emerald-500'
      : '';
  const puzzleActivityData = useMemo(
    () => buildPuzzleActivityData(activeRange, submissions),
    [activeRange, submissions],
  );
  const puzzleActivityYAxisTicks = useMemo(
    () => buildYAxisTicks(puzzleActivityData.values),
    [puzzleActivityData.values],
  );
  const dashboardPuzzleEloProgressData = useMemo(
    () => buildDashboardPuzzleEloProgressData(dashboardPuzzleEloRange, submissions, dashboardPuzzleEloCategory),
    [dashboardPuzzleEloCategory, dashboardPuzzleEloRange, submissions],
  );
  const solveTimeValues = submissions
    .map((submission) => submission.solveTimeMs)
    .filter((solveTimeMs): solveTimeMs is number => solveTimeMs !== null && solveTimeMs !== undefined);
  const averageSolveTimeMs =
    solveTimeValues.length > 0
      ? solveTimeValues.reduce((sum, solveTimeMs) => sum + solveTimeMs, 0) / solveTimeValues.length
      : null;
  const averageSolveTimeValue =
    averageSolveTimeMs !== null ? formatSolveTimeMs(averageSolveTimeMs) : 'N/A';
  const averageSolveTimeMeta =
    solveTimeValues.length > 0
      ? `Across ${solveTimeValues.length} solved submissions`
      : 'No solve timing data yet';
  const puzzleEloValues = submissions.map((submission) => resolveSubmissionElo(submission));
  const averagePuzzleElo =
    puzzleEloValues.length > 0
      ? Math.round(
          puzzleEloValues.reduce((sum, submissionElo) => sum + submissionElo, 0) /
            puzzleEloValues.length,
        )
      : null;
  const averageEloValue = averagePuzzleElo !== null ? String(averagePuzzleElo) : 'N/A';
  const averageEloMeta =
    puzzleEloValues.length > 0
      ? `Average across ${puzzleEloValues.length} submitted puzzles`
      : 'No puzzle submissions yet';
  const recentAnalyticsSubmissions = useMemo(
    () => submissions.slice(0, ANALYTICS_RECENT_SOLVE_LIMIT),
    [submissions],
  );
  const themeAnalytics = useMemo(
    () => buildThemeAccuracyRows(recentAnalyticsSubmissions),
    [recentAnalyticsSubmissions],
  );
  const solveTimeDifficultyData = useMemo(
    () => buildSolveTimeDifficultyData(submissions),
    [submissions],
  );
  const puzzleRatingProgressionData = useMemo(
    () => buildPuzzleRatingProgressionData(activeRange, submissions),
    [activeRange, submissions],
  );
  const firstMoveAccuracySummary = useMemo(
    () => buildFirstMoveAccuracySummary(submissions),
    [submissions],
  );
  const activeAnalyticsTheme = selectedAnalyticsTheme ?? themeAnalytics.weakestTheme;
  const selectedThemeRow =
    themeAnalytics.rows.find((row) => row.theme === activeAnalyticsTheme) ?? themeAnalytics.rows[0];
  const selectedThemeAssessments = selectedThemeRow?.assessments ?? [];
  const selectedThemeLabel = selectedThemeRow?.theme ?? ANALYTICS_THEMES[0];
  const selectedThemeSolvedCount = selectedThemeRow?.solvedCount ?? 0;
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
  const dashboardPanelGradient = useMemo(
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
  const dashboardPanelStyle = dashboardPanelGradient
    ? ({
        background: dashboardPanelGradient,
      } as React.CSSProperties)
    : undefined;
  const isDashboardView = activeNavLabel === 'Dashboard';
  const isAnalyticsView = activeNavLabel === 'Analytics';
  const isTrainingView = activeNavLabel === 'Training';
  const isPuzzleLabView = activeNavLabel === 'Puzzle Lab';
  const isAgentView = activeNavLabel === 'Agent';
  const isSettingsView = activeNavLabel === 'Settings';
  const activeMobileNavKey: MobileNavKey =
    activeNavLabel === 'Training'
      ? 'training'
      : activeNavLabel === 'Settings'
        ? 'profile'
        : 'home';
  const dashboardContainerStyle = dashboardPanelStyle;
  const dashboardButtonStyle = dashboardPanelStyle;
  const brandTextStyle: React.CSSProperties = {
    backgroundImage: `linear-gradient(${resolveGradientAngle(gradientDirection)}, ${rgbaFromChannels(
      accentChannels,
      0.92,
    )} 0%, ${rgbaFromChannels(secondaryChannels, 0.95)} 100%)`,
    WebkitBackgroundClip: 'text',
    backgroundClip: 'text',
    color: 'transparent',
  };

  if (!isMounted || !hasVerifiedAuthState || !hasAuthenticatedSession) {
    return <main className="dashboard-theme min-h-screen overflow-x-clip p-3 sm:p-4 md:p-8" />;
  }

  const handleMobileNavSelection = (target: MobileNavKey) => {
    if (target === 'solve') {
      handleBackToChessApp();
      return;
    }
    if (target === 'training') {
      setActiveNavLabel('Training');
      return;
    }
    if (target === 'profile') {
      setActiveNavLabel('Settings');
      return;
    }
    setActiveNavLabel('Dashboard');
  };

  return (
    <main
      className="dashboard-theme min-h-screen overflow-x-clip px-3 pb-24 pt-3 sm:px-4 sm:pb-28 sm:pt-4 md:px-8 md:pb-8 md:pt-8"
      style={{ background: pageBackground }}
    >
      <div
        className={`mx-auto w-full max-w-[1380px] neumo-surface rounded-[28px] p-2.5 sm:p-3 md:rounded-[36px] md:p-5 transition-all duration-300 ${
          isTransitioningToChessApp
            ? 'opacity-0 scale-[0.98] translate-y-1'
            : 'opacity-100 scale-100 translate-y-0'
        }`}
        style={dashboardContainerStyle}
      >
        <div className="grid gap-3 md:gap-4 lg:grid-cols-[240px_1fr]">
          <aside className="hidden rounded-[26px] p-6 md:p-7 lg:block neumo-surface-soft" style={dashboardContainerStyle}>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl neumo-inset">
                <svg viewBox="0 0 24 24" className="h-7 w-7 drop-shadow-sm" aria-hidden="true">
                  <defs>
                    <linearGradient id="dashboard-knight-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor={rgbaFromChannels(accentChannels, 0.95)} />
                      <stop offset="100%" stopColor={rgbaFromChannels(secondaryChannels, 0.95)} />
                    </linearGradient>
                  </defs>
                  <text
                    x="12"
                    y="16.8"
                    textAnchor="middle"
                    fill="url(#dashboard-knight-gradient)"
                    style={{
                      fontSize: '16px',
                      fontWeight: 700,
                      fontFamily: '"Segoe UI Symbol", "Noto Sans Symbols", "DejaVu Sans", serif',
                    }}
                  >
                    {'\u265E'}
                  </text>
                </svg>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.14em] font-semibold" style={brandTextStyle}>
                  Terrible App Chess
                </p>
                <p className="text-lg font-semibold text-slate-700 dark:text-slate-100">Dashboard</p>
              </div>
            </div>

            <nav className="mt-10 space-y-3">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = item.label === activeNavLabel;
                const showAgentBadge =
                  item.label === 'Agent' && showAgentTimeoutBadge && activeNavLabel !== 'Agent';
                return (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => setActiveNavLabel(item.label)}
                    className={`dashboard-nav-button group flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-all duration-200 ${
                      active
                        ? 'dashboard-nav-active neumo-pill text-slate-700 dark:text-slate-100 hover:-translate-y-[1px] hover:shadow-[0_8px_18px_rgba(15,23,42,0.12)]'
                        : 'dashboard-nav-inactive text-slate-500 dark:text-slate-300 hover:text-slate-700 dark:hover:text-slate-100 hover:bg-white/30 dark:hover:bg-white/12 hover:-translate-y-[1px] hover:shadow-[0_8px_18px_rgba(15,23,42,0.1)]'
                    }`}
                    style={
                      active
                        ? {
                            ...(dashboardButtonStyle ?? {}),
                            color: isDark ? 'rgb(248, 250, 252)' : rgbaFromChannels(accentChannels, 0.95),
                            background: isDark
                              ? `linear-gradient(135deg, ${rgbaFromChannels(accentChannels, 0.32)} 0%, rgba(15, 23, 42, 0.72) 100%)`
                              : `linear-gradient(135deg, ${rgbaFromChannels(accentChannels, 0.18)} 0%, rgba(255, 255, 255, 0.68) 100%)`,
                          }
                        : isDark
                          ? {
                              ...(dashboardButtonStyle ?? {}),
                              color: 'rgb(203, 213, 225)',
                              background: 'rgba(15, 23, 42, 0.34)',
                            }
                          : dashboardButtonStyle
                    }
                  >
                    <span className="h-8 w-8 rounded-xl neumo-inset flex items-center justify-center transition-transform duration-200 group-hover:scale-105">
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="flex items-center gap-2 text-sm font-medium">
                      <span>{item.label}</span>
                      {showAgentBadge && (
                        <span
                          className="inline-flex h-2.5 w-2.5 rounded-full bg-[crimson] shadow-[0_0_10px_rgba(220,20,60,0.78)]"
                          aria-label="Unfinished conversation nearing timeout"
                          title="Unfinished conversation nearing timeout"
                        />
                      )}
                    </span>
                  </button>
                );
              })}
            </nav>

            <button
              type="button"
              onClick={handleBackToChessApp}
              disabled={isTransitioningToChessApp}
              className="mt-8 w-full neumo-pill px-4 py-2.5 text-sm font-semibold text-slate-600 flex items-center justify-center gap-2 transition-all duration-200 hover:-translate-y-[1px] hover:text-slate-700 hover:shadow-[0_10px_22px_rgba(15,23,42,0.14)] disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-none"
              style={dashboardButtonStyle}
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Chess App
            </button>
            <button
              type="button"
              onClick={() => setTheme(isDark ? 'light' : 'dark')}
              className="mt-3 w-full neumo-pill px-4 py-2.5 text-sm font-semibold text-slate-600 transition-all duration-200 hover:-translate-y-[1px] hover:text-slate-700 hover:shadow-[0_10px_22px_rgba(15,23,42,0.14)]"
              style={dashboardButtonStyle}
              aria-label="Toggle theme"
            >
              {isDark ? 'Dark' : 'Light'}
            </button>
            <button
              type="button"
              onClick={handleLogout}
              disabled={isLoggingOut}
              className="mt-3 w-full neumo-pill px-4 py-2.5 text-sm font-semibold text-slate-600 flex items-center justify-center gap-2 transition-all duration-200 hover:-translate-y-[1px] hover:text-slate-700 hover:shadow-[0_10px_22px_rgba(15,23,42,0.14)] disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-none"
              style={dashboardButtonStyle}
              aria-label="Log out"
            >
              <LogOut className="h-4 w-4" />
              {isLoggingOut ? 'Logging out...' : 'Log out'}
            </button>
          </aside>

          <section
            className="neumo-surface-soft space-y-4 overflow-x-hidden rounded-[26px] p-3 sm:p-4 md:p-5"
            style={dashboardContainerStyle}
          >
            {isDashboardView && (
              <>
                <header className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <StatCard
                label="Puzzles solved"
                value={String(solvedCount)}
                meta={solvedMeta}
                onClick={() => setShowSubmissionHistory((prev) => !prev)}
                active={showSubmissionHistory}
                cardStyle={dashboardContainerStyle}
              />
              <StatCard
                label="Accuracy"
                value={accuracyValue}
                meta={accuracyMeta}
                cardStyle={dashboardContainerStyle}
              />
              <StatCard
                label="Best streak"
                value={streakValue}
                meta={streakMeta}
                cardClassName={streakCardClassName}
                valueClassName={streakValueClassName}
                metaClassName={streakMetaClassName}
                cardStyle={dashboardContainerStyle}
              />
              <StatCard
                label="Avg solve time"
                value={averageSolveTimeValue}
                meta={averageSolveTimeMeta}
                cardStyle={dashboardContainerStyle}
              />
              <StatCard
                label="Elo"
                value={averageEloValue}
                meta={averageEloMeta}
                cardStyle={dashboardContainerStyle}
              />
                </header>

                {showSubmissionHistory && (
                  <section
                    className="neumo-surface-soft rounded-[26px] p-5 md:p-7"
                    style={dashboardContainerStyle}
                  >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-2xl font-semibold tracking-tight text-slate-700">
                      Solved Puzzle Submissions
                    </h2>
                    <p className="text-sm text-slate-500">
                      Each successful solve with timestamp, puzzle image, and position check details
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowSubmissionHistory(false)}
                    className="neumo-pill px-4 py-2 text-xs font-semibold text-slate-500 transition-all duration-200 hover:-translate-y-[1px] hover:text-slate-700 hover:shadow-[0_8px_16px_rgba(15,23,42,0.12)]"
                    style={dashboardButtonStyle}
                  >
                    Hide
                  </button>
                </div>

                {submissions.length === 0 ? (
                  <p className="mt-4 rounded-2xl neumo-inset px-4 py-4 text-sm text-slate-500">
                    No solved puzzles recorded yet. Solve a puzzle in the chess app and it will
                    appear here.
                  </p>
                ) : (
                  <div
                    className={`mt-4 space-y-3 ${
                      submissions.length > 2 ? 'max-h-[56rem] overflow-y-auto pr-1' : ''
                    }`}
                  >
                    {submissions.map((submission, index) => {
                      const submissionNumber = submissions.length - index;
                      const submissionImageSrc =
                        typeof submission.originalPuzzleImageDataUrl === 'string' &&
                        submission.originalPuzzleImageDataUrl.startsWith('data:image/')
                          ? submission.originalPuzzleImageDataUrl
                          : null;
                      const hasSubmissionImage = Boolean(submissionImageSrc);
                      const submissionImageAlt = `Submitted puzzle image for ${
                        submission.fileName || `submission ${submissionNumber}`
                      }`;
                      return (
                        <article
                          key={submission.id}
                          className="rounded-2xl neumo-inset px-4 py-4 text-sm text-slate-600"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <p className="font-semibold text-slate-700">
                                Submission {submissionNumber}
                              </p>
                              <p className="text-xs text-slate-500">
                                {submission.fileName || 'Untitled puzzle'}
                              </p>
                            </div>
                            <p className="text-xs text-slate-500">{formatDateTime(submission.submittedAt)}</p>
                          </div>
                          {hasSubmissionImage && (
                            <div className="mt-3">
                              <button
                                type="button"
                                onClick={() => {
                                  setExpandedSubmissionId((previous) =>
                                    previous === submission.id ? null : submission.id,
                                  );
                                }}
                                className="group inline-flex flex-col items-start gap-2 rounded-lg"
                                aria-label={`Expand puzzle image for submission ${submissionNumber}`}
                              >
                                <div className="relative h-24 w-24 overflow-hidden rounded-lg border border-slate-200/90 bg-slate-100 sm:h-28 sm:w-28">
                                  <Image
                                    src={submissionImageSrc!}
                                    alt={submissionImageAlt}
                                    fill
                                    sizes="(max-width: 640px) 96px, 112px"
                                    unoptimized
                                    className="object-contain p-1 transition group-hover:scale-[1.02]"
                                  />
                                </div>
                                <span className="text-[11px] uppercase tracking-[0.08em] text-slate-400">
                                  {expandedSubmissionId === submission.id
                                    ? 'Click image to collapse'
                                    : 'Click image to expand'}
                                </span>
                              </button>
                            </div>
                          )}
                          {hasSubmissionImage && expandedSubmissionId === submission.id && (
                            <div
                              className="mt-3 w-full overflow-hidden rounded-xl border border-slate-200/90 bg-slate-100 p-2"
                              style={{ height: '60vh', minHeight: 260, maxHeight: 760 }}
                            >
                              <div className="relative h-full w-full">
                                <Image
                                  src={submissionImageSrc!}
                                  alt={submissionImageAlt}
                                  fill
                                  sizes="100vw"
                                  unoptimized
                                  className="object-contain"
                                />
                              </div>
                            </div>
                          )}
                          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                            <p>
                              <span className="text-slate-400">Expected side:</span>{' '}
                              <span className="font-medium text-slate-700">
                                {submission.expectedSideToMove}
                              </span>
                            </p>
                            <p>
                              <span className="text-slate-400">Detected side:</span>{' '}
                              <span className="font-medium text-slate-700">
                                {submission.positionCheck.sideToMove ?? 'Unavailable'}
                              </span>
                            </p>
                            <p>
                              <span className="text-slate-400">Solver confidence:</span>{' '}
                              <span className="font-medium text-slate-700">
                                {formatConfidence(submission.positionCheck.confidence)}
                              </span>
                            </p>
                            <p>
                              <span className="text-slate-400">Vision attempts:</span>{' '}
                              <span className="font-medium text-slate-700">
                                {submission.positionCheck.attemptsUsed ?? 'Unavailable'}
                              </span>
                            </p>
                            <p>
                              <span className="text-slate-400">Mate status:</span>{' '}
                              <span className="font-medium text-slate-700">
                                {formatMateStatus(submission)}
                              </span>
                            </p>
                            <p>
                              <span className="text-slate-400">Estimated Elo:</span>{' '}
                              <span className="font-medium text-slate-700">
                                {resolveSubmissionElo(submission)}
                              </span>
                            </p>
                          </div>
                          {submission.solutionLines.length > 0 && (
                            <div className="mt-3 rounded-xl bg-white/50 px-3 py-3">
                              <p className="text-xs uppercase tracking-[0.08em] text-slate-400">
                                Solution
                              </p>
                              <p className="mt-2 text-sm font-medium text-slate-700">
                                {submission.solutionLines.join(' | ')}
                              </p>
                            </div>
                          )}
                        </article>
                      );
                    })}
                  </div>
                )}
                  </section>
                )}

                <div className="flex flex-wrap gap-3">
                  {RANGE_TABS.map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setActiveRange(tab)}
                      className={`px-5 py-2 text-sm font-medium rounded-full transition-all duration-200 hover:-translate-y-[1px] hover:shadow-[0_8px_16px_rgba(15,23,42,0.12)] ${
                        activeRange === tab ? 'neumo-pill text-slate-700' : 'neumo-inset text-slate-500'
                      }`}
                      style={
                        activeRange === tab
                          ? {
                              ...(dashboardButtonStyle ?? {}),
                              color: rgbaFromChannels(accentChannels, 0.95),
                              background: `linear-gradient(135deg, ${rgbaFromChannels(accentChannels, 0.16)} 0%, rgba(255, 255, 255, 0.72) 100%)`,
                            }
                          : dashboardButtonStyle
                      }
                    >
                      {tab}
                    </button>
                  ))}
                </div>

                <AreaChart
                  title="Puzzle Activity"
                  subtitle={puzzleActivityData.subtitle}
                  values={puzzleActivityData.values}
                  axisLabels={puzzleActivityData.axisLabels}
                  yAxisTicks={puzzleActivityYAxisTicks}
                  sectionStyle={dashboardContainerStyle}
                />
                <PuzzleEloProgressSection
                  data={dashboardPuzzleEloProgressData}
                  activeRange={dashboardPuzzleEloRange}
                  activeCategory={dashboardPuzzleEloCategory}
                  onRangeChange={setDashboardPuzzleEloRange}
                  onCategoryChange={setDashboardPuzzleEloCategory}
                  onSolvePuzzles={() => setActiveNavLabel('Puzzle Lab')}
                  sectionStyle={dashboardContainerStyle}
                  buttonStyle={dashboardButtonStyle}
                />
              </>
            )}

            {isAnalyticsView && (
              <section
                className="neumo-surface-soft rounded-[26px] p-5 md:p-7"
                style={dashboardContainerStyle}
              >
                <h2 className="text-3xl font-semibold tracking-tight text-slate-700">Analytics</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Performance views configured for puzzle-solving insights.
                </p>

                {isAnalyticsSectionsOpen ? (
                  <div className="mt-5 grid gap-4 xl:grid-cols-3">
                    <article
                      className="neumo-surface-soft rounded-3xl px-5 py-5 xl:col-span-2"
                      style={dashboardContainerStyle}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-[11px] uppercase tracking-[0.08em] text-slate-500">
                            Analytics
                          </p>
                          <h3 className="mt-1 text-xl font-semibold text-slate-700">Accuracy by Theme</h3>
                          <p className="mt-1 text-sm text-slate-500">
                            Dynamic accuracy from the last {recentAnalyticsSubmissions.length} solved
                            puzzles.
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="rounded-full neumo-pill px-3 py-1 text-xs font-semibold text-amber-600">
                            Weakest: {themeAnalytics.weakestTheme}
                          </span>
                          <button
                            type="button"
                            onClick={() => setIsAnalyticsSectionsOpen(false)}
                            className="rounded-full neumo-pill px-3 py-1 text-xs font-semibold text-slate-600 inline-flex items-center gap-1.5 transition-all duration-200 hover:-translate-y-[1px] hover:text-slate-700 hover:shadow-[0_8px_16px_rgba(15,23,42,0.12)]"
                            style={dashboardButtonStyle}
                            aria-expanded={isAnalyticsSectionsOpen}
                            aria-label="Collapse analytics sections"
                          >
                            <ChevronUp className="h-3.5 w-3.5" />
                            Collapse
                          </button>
                        </div>
                      </div>

                      <div className="mt-5 space-y-3">
                        {themeAnalytics.rows.map((row) => {
                          const isActive = row.theme === selectedThemeLabel;
                          const isWeakest = row.theme === themeAnalytics.weakestTheme;
                          const paletteColorHex =
                            ACCURACY_THEME_NEON_SWATCH_COLORS[
                              ANALYTICS_THEMES.indexOf(row.theme) %
                                ACCURACY_THEME_NEON_SWATCH_COLORS.length
                            ];
                          const paletteColorChannels =
                            hexToRgbChannels(paletteColorHex) ?? accentChannels;
                          return (
                            <button
                              key={row.theme}
                              type="button"
                              onClick={() => setSelectedAnalyticsTheme(row.theme)}
                              className={`w-full rounded-2xl px-4 py-3 text-left transition-all duration-200 hover:-translate-y-[1px] hover:shadow-[0_8px_16px_rgba(15,23,42,0.1)] ${
                                isActive ? 'neumo-pill' : 'neumo-inset hover:bg-white/35'
                              }`}
                              style={
                                isActive
                                  ? {
                                      ...(dashboardButtonStyle ?? {}),
                                      color: rgbaFromChannels(paletteColorChannels, 0.95),
                                      background: `linear-gradient(135deg, ${rgbaFromChannels(paletteColorChannels, 0.24)} 0%, rgba(255, 255, 255, 0.74) 100%)`,
                                    }
                                  : dashboardButtonStyle
                              }
                            >
                              <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap sm:gap-3">
                                <span
                                  className="h-3 w-3 shrink-0 rounded-full"
                                  style={{
                                    background: `linear-gradient(135deg, ${rgbaFromChannels(paletteColorChannels, 0.98)} 0%, ${rgbaFromChannels(paletteColorChannels, 0.72)} 100%)`,
                                    boxShadow: `inset 1px 1px 2px rgba(255,255,255,0.45), 2px 2px 4px rgba(15,23,42,0.16), 0 0 8px ${rgbaFromChannels(paletteColorChannels, 0.42)}`,
                                  }}
                                />
                                <span className="min-w-0 flex-1 text-sm font-medium text-slate-700 sm:w-[118px] sm:flex-none">
                                  {row.theme}
                                </span>
                                <div
                                  className="relative h-4 w-full overflow-hidden rounded-full sm:w-auto sm:flex-1"
                                  style={{
                                    background: `linear-gradient(180deg, rgba(255,255,255,0.82) 0%, ${rgbaFromChannels(paletteColorChannels, 0.12)} 100%)`,
                                    boxShadow: `inset 7px 7px 12px rgba(15,23,42,0.16), inset -7px -7px 12px rgba(255,255,255,0.9), 0 0 10px ${rgbaFromChannels(paletteColorChannels, 0.14)}`,
                                  }}
                                >
                                  <span
                                    className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-300"
                                    style={{
                                      width: `${row.accuracyPercent}%`,
                                      background: `linear-gradient(90deg, ${rgbaFromChannels(paletteColorChannels, 0.99)} 0%, ${rgbaFromChannels(paletteColorChannels, 0.9)} 58%, ${rgbaFromChannels(paletteColorChannels, 0.72)} 100%)`,
                                      boxShadow: `inset 1px 1px 2px rgba(255,255,255,0.32), 3px 3px 8px ${rgbaFromChannels(paletteColorChannels, 0.36)}, 0 0 10px ${rgbaFromChannels(paletteColorChannels, 0.34)}`,
                                    }}
                                  />
                                </div>
                                <span className="w-auto text-right text-sm font-semibold text-slate-700 sm:w-14">
                                  {row.accuracyPercent}%
                                </span>
                              </div>
                              <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-slate-400">
                                <span>
                                  {row.solvedCount > 0
                                    ? `${row.solvedCount} recent solved puzzle${row.solvedCount === 1 ? '' : 's'}`
                                    : 'No recent solved puzzles tagged yet'}
                                </span>
                                {isWeakest && (
                                  <span className="font-semibold uppercase tracking-[0.08em] text-amber-600">
                                    Weakest
                                  </span>
                                )}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </article>

                    <div className="space-y-3">
                      {ANALYTICS_SECONDARY_SUBSECTIONS.map((title) =>
                        title === 'Solve Time vs Difficulty' ? (
                          isSolveTimeSectionOpen ? (
                            <SolveTimeVsDifficultyChart
                              key={title}
                              data={solveTimeDifficultyData}
                              sectionStyle={dashboardContainerStyle}
                              accentChannels={accentChannels}
                              onCollapse={() =>
                                collapseAnalyticsSecondarySubsection('Solve Time vs Difficulty')
                              }
                            />
                          ) : (
                            <button
                              key={title}
                              type="button"
                              onClick={() =>
                                openAnalyticsSecondarySubsection('Solve Time vs Difficulty')
                              }
                              className="w-full neumo-surface-soft rounded-3xl px-5 py-4 min-h-[108px] flex flex-col justify-between text-left transition-all duration-200 hover:-translate-y-[1px] hover:shadow-[0_8px_16px_rgba(15,23,42,0.12)]"
                              style={dashboardContainerStyle}
                              aria-expanded={false}
                              aria-label="Expand solve time vs difficulty section"
                            >
                              <div>
                                <p className="text-[11px] uppercase tracking-[0.08em] text-slate-500">
                                  Analytics
                                </p>
                                <h3 className="mt-1 text-base font-semibold text-slate-700">
                                  Solve Time vs Difficulty
                                </h3>
                              </div>
                              <p className="text-xs text-slate-400 inline-flex items-center gap-1.5">
                                <ChevronDown className="h-3.5 w-3.5" />
                                Click to expand
                              </p>
                            </button>
                          )
                        ) : title === 'Puzzle Rating Progression' ? (
                          isRatingProgressionSectionOpen ? (
                          <PuzzleRatingProgressionChart
                              key={title}
                              data={puzzleRatingProgressionData}
                              sectionStyle={dashboardContainerStyle}
                              onCollapse={() =>
                                collapseAnalyticsSecondarySubsection('Puzzle Rating Progression')
                              }
                            />
                          ) : (
                            <button
                              key={title}
                              type="button"
                              onClick={() =>
                                openAnalyticsSecondarySubsection('Puzzle Rating Progression')
                              }
                              className="w-full neumo-surface-soft rounded-3xl px-5 py-4 min-h-[108px] flex flex-col justify-between text-left transition-all duration-200 hover:-translate-y-[1px] hover:shadow-[0_8px_16px_rgba(15,23,42,0.12)]"
                              style={dashboardContainerStyle}
                              aria-expanded={false}
                              aria-label="Expand puzzle rating progression section"
                            >
                              <div>
                                <p className="text-[11px] uppercase tracking-[0.08em] text-slate-500">
                                  Analytics
                                </p>
                                <h3 className="mt-1 text-base font-semibold text-slate-700">
                                  Puzzle Rating Progression
                                </h3>
                              </div>
                              <p className="text-xs text-slate-400 inline-flex items-center gap-1.5">
                                <ChevronDown className="h-3.5 w-3.5" />
                                Click to expand
                              </p>
                            </button>
                          )
                        ) : title === 'Accuracy by Difficulty' ? (
                          isAccuracyByDifficultySectionOpen ? (
                          <AccuracyByDifficultyCard
                              key={title}
                              analytics={difficultyBucketAnalytics}
                              loading={difficultyBucketAnalyticsLoading}
                              error={difficultyBucketAnalyticsError}
                              sectionStyle={dashboardContainerStyle}
                              onCollapse={() =>
                                collapseAnalyticsSecondarySubsection('Accuracy by Difficulty')
                              }
                            />
                          ) : (
                            <button
                              key={title}
                              type="button"
                              onClick={() =>
                                openAnalyticsSecondarySubsection('Accuracy by Difficulty')
                              }
                              className="w-full neumo-surface-soft rounded-3xl px-5 py-4 min-h-[108px] flex flex-col justify-between text-left transition-all duration-200 hover:-translate-y-[1px] hover:shadow-[0_8px_16px_rgba(15,23,42,0.12)]"
                              style={dashboardContainerStyle}
                              aria-expanded={false}
                              aria-label="Expand accuracy by difficulty section"
                            >
                              <div>
                                <p className="text-[11px] uppercase tracking-[0.08em] text-slate-500">
                                  Analytics
                                </p>
                                <h3 className="mt-1 text-base font-semibold text-slate-700">
                                  Accuracy by Difficulty
                                </h3>
                              </div>
                              <p className="text-xs text-slate-400 inline-flex items-center gap-1.5">
                                <ChevronDown className="h-3.5 w-3.5" />
                                Click to expand
                              </p>
                            </button>
                          )
                        ) : title === 'First-Move Accuracy' ? (
                          isFirstMoveAccuracySectionOpen ? (
                          <FirstMoveAccuracyCard
                              key={title}
                              summary={firstMoveAccuracySummary}
                              sectionStyle={dashboardContainerStyle}
                              onCollapse={() =>
                                collapseAnalyticsSecondarySubsection('First-Move Accuracy')
                              }
                            />
                          ) : (
                            <button
                              key={title}
                              type="button"
                              onClick={() =>
                                openAnalyticsSecondarySubsection('First-Move Accuracy')
                              }
                              className="w-full neumo-surface-soft rounded-3xl px-5 py-4 min-h-[108px] flex flex-col justify-between text-left transition-all duration-200 hover:-translate-y-[1px] hover:shadow-[0_8px_16px_rgba(15,23,42,0.12)]"
                              style={dashboardContainerStyle}
                              aria-expanded={false}
                              aria-label="Expand first-move accuracy section"
                            >
                              <div>
                                <p className="text-[11px] uppercase tracking-[0.08em] text-slate-500">
                                  Analytics
                                </p>
                                <h3 className="mt-1 text-base font-semibold text-slate-700">
                                  First-Move Accuracy
                                </h3>
                              </div>
                              <p className="text-xs text-slate-400 inline-flex items-center gap-1.5">
                                <ChevronDown className="h-3.5 w-3.5" />
                                Click to expand
                              </p>
                            </button>
                          )
                        ) : (
                          <article
                            key={title}
                            className="neumo-surface-soft rounded-3xl px-5 py-4 min-h-[108px] flex flex-col justify-between"
                            style={dashboardContainerStyle}
                          >
                            <div>
                              <p className="text-[11px] uppercase tracking-[0.08em] text-slate-500">
                                Analytics
                              </p>
                              <h3 className="mt-1 text-base font-semibold text-slate-700">{title}</h3>
                            </div>
                            <p className="text-xs text-slate-400">Ready for chart and metric bindings.</p>
                          </article>
                        ),
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    <button
                      type="button"
                      onClick={() => setIsAnalyticsSectionsOpen(true)}
                      className="neumo-surface-soft rounded-3xl px-5 py-4 min-h-[108px] flex flex-col justify-between text-left transition-all duration-200 hover:-translate-y-[1px] hover:shadow-[0_8px_16px_rgba(15,23,42,0.12)]"
                      style={dashboardContainerStyle}
                      aria-expanded={false}
                      aria-label="Expand accuracy by theme section"
                    >
                      <div>
                        <p className="text-[11px] uppercase tracking-[0.08em] text-slate-500">Analytics</p>
                        <h3 className="mt-1 text-base font-semibold text-slate-700">Accuracy by Theme</h3>
                      </div>
                      <p className="text-xs text-slate-400 inline-flex items-center gap-1.5">
                        <ChevronDown className="h-3.5 w-3.5" />
                        Click to expand
                      </p>
                    </button>
                    {ANALYTICS_SECONDARY_SUBSECTIONS.map((title) =>
                      title === 'Solve Time vs Difficulty' ? (
                        isSolveTimeSectionOpen ? (
                          <SolveTimeVsDifficultyChart
                            key={title}
                            data={solveTimeDifficultyData}
                            sectionStyle={dashboardContainerStyle}
                            accentChannels={accentChannels}
                            onCollapse={() =>
                              collapseAnalyticsSecondarySubsection('Solve Time vs Difficulty')
                            }
                          />
                        ) : (
                          <button
                            key={title}
                            type="button"
                            onClick={() =>
                              openAnalyticsSecondarySubsection('Solve Time vs Difficulty')
                            }
                            className="w-full neumo-surface-soft rounded-3xl px-5 py-4 min-h-[108px] flex flex-col justify-between text-left transition-all duration-200 hover:-translate-y-[1px] hover:shadow-[0_8px_16px_rgba(15,23,42,0.12)]"
                            style={dashboardContainerStyle}
                            aria-expanded={false}
                            aria-label="Expand solve time vs difficulty section"
                          >
                            <div>
                              <p className="text-[11px] uppercase tracking-[0.08em] text-slate-500">
                                Analytics
                              </p>
                              <h3 className="mt-1 text-base font-semibold text-slate-700">
                                Solve Time vs Difficulty
                              </h3>
                            </div>
                            <p className="text-xs text-slate-400 inline-flex items-center gap-1.5">
                              <ChevronDown className="h-3.5 w-3.5" />
                              Click to expand
                            </p>
                          </button>
                        )
                      ) : title === 'Puzzle Rating Progression' ? (
                        isRatingProgressionSectionOpen ? (
                          <PuzzleRatingProgressionChart
                            key={title}
                            data={puzzleRatingProgressionData}
                            sectionStyle={dashboardContainerStyle}
                            onCollapse={() =>
                              collapseAnalyticsSecondarySubsection('Puzzle Rating Progression')
                            }
                          />
                        ) : (
                          <button
                            key={title}
                            type="button"
                            onClick={() =>
                              openAnalyticsSecondarySubsection('Puzzle Rating Progression')
                            }
                            className="w-full neumo-surface-soft rounded-3xl px-5 py-4 min-h-[108px] flex flex-col justify-between text-left transition-all duration-200 hover:-translate-y-[1px] hover:shadow-[0_8px_16px_rgba(15,23,42,0.12)]"
                            style={dashboardContainerStyle}
                            aria-expanded={false}
                            aria-label="Expand puzzle rating progression section"
                          >
                            <div>
                              <p className="text-[11px] uppercase tracking-[0.08em] text-slate-500">
                                Analytics
                              </p>
                              <h3 className="mt-1 text-base font-semibold text-slate-700">
                                Puzzle Rating Progression
                              </h3>
                            </div>
                            <p className="text-xs text-slate-400 inline-flex items-center gap-1.5">
                              <ChevronDown className="h-3.5 w-3.5" />
                              Click to expand
                            </p>
                          </button>
                        )
                      ) : title === 'Accuracy by Difficulty' ? (
                        isAccuracyByDifficultySectionOpen ? (
                          <AccuracyByDifficultyCard
                            key={title}
                            analytics={difficultyBucketAnalytics}
                            loading={difficultyBucketAnalyticsLoading}
                            error={difficultyBucketAnalyticsError}
                            sectionStyle={dashboardContainerStyle}
                            onCollapse={() =>
                              collapseAnalyticsSecondarySubsection('Accuracy by Difficulty')
                            }
                          />
                        ) : (
                          <button
                            key={title}
                            type="button"
                            onClick={() =>
                              openAnalyticsSecondarySubsection('Accuracy by Difficulty')
                            }
                            className="w-full neumo-surface-soft rounded-3xl px-5 py-4 min-h-[108px] flex flex-col justify-between text-left transition-all duration-200 hover:-translate-y-[1px] hover:shadow-[0_8px_16px_rgba(15,23,42,0.12)]"
                            style={dashboardContainerStyle}
                            aria-expanded={false}
                            aria-label="Expand accuracy by difficulty section"
                          >
                            <div>
                              <p className="text-[11px] uppercase tracking-[0.08em] text-slate-500">
                                Analytics
                              </p>
                              <h3 className="mt-1 text-base font-semibold text-slate-700">
                                Accuracy by Difficulty
                              </h3>
                            </div>
                            <p className="text-xs text-slate-400 inline-flex items-center gap-1.5">
                              <ChevronDown className="h-3.5 w-3.5" />
                              Click to expand
                            </p>
                          </button>
                        )
                      ) : title === 'First-Move Accuracy' ? (
                        isFirstMoveAccuracySectionOpen ? (
                          <FirstMoveAccuracyCard
                            key={title}
                            summary={firstMoveAccuracySummary}
                            sectionStyle={dashboardContainerStyle}
                            onCollapse={() =>
                              collapseAnalyticsSecondarySubsection('First-Move Accuracy')
                            }
                          />
                        ) : (
                          <button
                            key={title}
                            type="button"
                            onClick={() =>
                              openAnalyticsSecondarySubsection('First-Move Accuracy')
                            }
                            className="w-full neumo-surface-soft rounded-3xl px-5 py-4 min-h-[108px] flex flex-col justify-between text-left transition-all duration-200 hover:-translate-y-[1px] hover:shadow-[0_8px_16px_rgba(15,23,42,0.12)]"
                            style={dashboardContainerStyle}
                            aria-expanded={false}
                            aria-label="Expand first-move accuracy section"
                          >
                            <div>
                              <p className="text-[11px] uppercase tracking-[0.08em] text-slate-500">
                                Analytics
                              </p>
                              <h3 className="mt-1 text-base font-semibold text-slate-700">
                                First-Move Accuracy
                              </h3>
                            </div>
                            <p className="text-xs text-slate-400 inline-flex items-center gap-1.5">
                              <ChevronDown className="h-3.5 w-3.5" />
                              Click to expand
                            </p>
                          </button>
                        )
                      ) : (
                        <article
                          key={title}
                          className="neumo-surface-soft rounded-3xl px-5 py-4 min-h-[108px] flex flex-col justify-between"
                          style={dashboardContainerStyle}
                        >
                          <div>
                            <p className="text-[11px] uppercase tracking-[0.08em] text-slate-500">
                              Analytics
                            </p>
                            <h3 className="mt-1 text-base font-semibold text-slate-700">{title}</h3>
                          </div>
                          <p className="text-xs text-slate-400">Ready for chart and metric bindings.</p>
                        </article>
                      ),
                    )}
                  </div>
                )}

                {isAnalyticsSectionsOpen && (
                  <section className="mt-5 rounded-3xl neumo-inset px-4 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-xl font-semibold text-slate-700">
                        Associated Puzzles: {selectedThemeLabel}
                      </h3>
                      <p className="text-sm text-slate-500">
                        Recently solved submissions mapped to this theme.
                      </p>
                    </div>
                    <span className="rounded-full neumo-pill px-3 py-1 text-xs font-semibold text-slate-600">
                      {selectedThemeSolvedCount} puzzle{selectedThemeSolvedCount === 1 ? '' : 's'}
                    </span>
                  </div>

                  {selectedThemeAssessments.length === 0 ? (
                    <p className="mt-4 rounded-2xl neumo-inset px-4 py-4 text-sm text-slate-500">
                      No recent solved puzzles are currently mapped to this theme. Solve more puzzles
                      and this section will update automatically.
                    </p>
                  ) : (
                    <div
                      className={`mt-4 space-y-3 ${
                        selectedThemeAssessments.length > 2 ? 'max-h-[56rem] overflow-y-auto pr-1' : ''
                      }`}
                    >
                      {selectedThemeAssessments.map(({ submission, accuracyPercent, reason }) => {
                        const submissionImageSrc =
                          typeof submission.originalPuzzleImageDataUrl === 'string' &&
                          submission.originalPuzzleImageDataUrl.startsWith('data:image/')
                            ? submission.originalPuzzleImageDataUrl
                            : null;
                        const hasSubmissionImage = Boolean(submissionImageSrc);
                        const submissionImageAlt = `Theme puzzle image for ${
                          submission.fileName || 'submission'
                        }`;

                        return (
                          <article
                            key={`${selectedThemeLabel}-${submission.id}`}
                            className="rounded-2xl neumo-surface-soft px-4 py-4 text-sm text-slate-600"
                            style={dashboardContainerStyle}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div>
                                <p className="font-semibold text-slate-700">
                                  {submission.fileName || 'Untitled puzzle'}
                                </p>
                                <p className="text-xs text-slate-500">{formatDateTime(submission.submittedAt)}</p>
                              </div>
                              <div className="text-right text-xs text-slate-500">
                                <p>
                                  Accuracy contribution:{' '}
                                  <span className="font-semibold text-slate-700">{accuracyPercent}%</span>
                                </p>
                                <p className="mt-0.5">{reason}</p>
                              </div>
                            </div>

                            {hasSubmissionImage && (
                              <div className="mt-3">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setExpandedSubmissionId((previous) =>
                                      previous === submission.id ? null : submission.id,
                                    );
                                  }}
                                  className="group inline-flex flex-col items-start gap-2 rounded-lg"
                                  aria-label={`Expand puzzle image for ${submission.fileName || 'submission'}`}
                                >
                                  <div className="relative h-24 w-24 overflow-hidden rounded-lg border border-slate-200/90 bg-slate-100 sm:h-28 sm:w-28">
                                    <Image
                                      src={submissionImageSrc!}
                                      alt={submissionImageAlt}
                                      fill
                                      sizes="(max-width: 640px) 96px, 112px"
                                      unoptimized
                                      className="object-contain p-1 transition group-hover:scale-[1.02]"
                                    />
                                  </div>
                                  <span className="text-[11px] uppercase tracking-[0.08em] text-slate-400">
                                    {expandedSubmissionId === submission.id
                                      ? 'Click image to collapse'
                                      : 'Click image to expand'}
                                  </span>
                                </button>
                              </div>
                            )}

                            {hasSubmissionImage && expandedSubmissionId === submission.id && (
                              <div
                                className="mt-3 w-full overflow-hidden rounded-xl border border-slate-200/90 bg-slate-100 p-2"
                                style={{ height: '50vh', minHeight: 220, maxHeight: 620 }}
                              >
                                <div className="relative h-full w-full">
                                  <Image
                                    src={submissionImageSrc!}
                                    alt={submissionImageAlt}
                                    fill
                                    sizes="100vw"
                                    unoptimized
                                    className="object-contain"
                                  />
                                </div>
                              </div>
                            )}

                            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                              <p>
                                <span className="text-slate-400">Expected side:</span>{' '}
                                <span className="font-medium text-slate-700">
                                  {submission.expectedSideToMove}
                                </span>
                              </p>
                              <p>
                                <span className="text-slate-400">Detected side:</span>{' '}
                                <span className="font-medium text-slate-700">
                                  {submission.positionCheck.sideToMove ?? 'Unavailable'}
                                </span>
                              </p>
                              <p>
                                <span className="text-slate-400">Solver confidence:</span>{' '}
                                <span className="font-medium text-slate-700">
                                  {formatConfidence(submission.positionCheck.confidence)}
                                </span>
                              </p>
                              <p>
                                <span className="text-slate-400">Solve time:</span>{' '}
                                <span className="font-medium text-slate-700">
                                  {typeof submission.solveTimeMs === 'number'
                                    ? formatSolveTimeMs(submission.solveTimeMs)
                                    : 'Unavailable'}
                                </span>
                              </p>
                              <p>
                                <span className="text-slate-400">Estimated Elo:</span>{' '}
                                <span className="font-medium text-slate-700">
                                  {resolveSubmissionElo(submission)}
                                </span>
                              </p>
                              <p>
                                <span className="text-slate-400">Mate status:</span>{' '}
                                <span className="font-medium text-slate-700">
                                  {formatMateStatus(submission)}
                                </span>
                              </p>
                            </div>

                            {submission.solutionLines.length > 0 && (
                              <div className="mt-3 rounded-xl bg-white/50 px-3 py-3">
                                <p className="text-xs uppercase tracking-[0.08em] text-slate-400">Solution</p>
                                <p className="mt-2 text-sm font-medium text-slate-700">
                                  {submission.solutionLines.join(' | ')}
                                </p>
                              </div>
                            )}
                          </article>
                        );
                      })}
                    </div>
                  )}
                  </section>
                )}
              </section>
            )}

            {isPuzzleLabView && (
              <PuzzleLabPanel
                panelStyle={dashboardContainerStyle}
                buttonStyle={dashboardButtonStyle}
                isDark={isDark}
                assistantConversationMode={assistantConversationMode}
              />
            )}

            {isTrainingView && (
              <TrainingPanel
                submissions={submissions}
                submissionsLoading={submissionsSyncLoading}
                submissionsError={submissionsSyncError}
                difficultyAnalytics={difficultyBucketAnalytics}
                difficultyAnalyticsLoading={difficultyBucketAnalyticsLoading}
                difficultyAnalyticsError={difficultyBucketAnalyticsError}
                panelStyle={dashboardContainerStyle}
                buttonStyle={dashboardButtonStyle}
              />
            )}

            {isSettingsView && (
              <SettingsPanel
                backendUrl={backendUrl}
                isDark={isDark}
                accentColor={accentColor}
                accentChannels={accentChannels}
                secondaryColor={secondaryColor}
                secondaryChannels={secondaryChannels}
                gradientEnabled={gradientEnabled}
                gradientDirection={gradientDirection}
                onThemeModeChange={(mode) => {
                  setTheme(mode);
                }}
                onAccentChange={(nextColor) => {
                  setThemeSavedNoticeVisible(false);
                  setAccentColor(normalizeHexColor(nextColor) ?? DEFAULT_DASHBOARD_ACCENT);
                }}
                onSecondaryColorChange={(nextColor) =>
                  {
                    setThemeSavedNoticeVisible(false);
                    setSecondaryColor(
                      normalizeHexColor(nextColor) ?? DEFAULT_DASHBOARD_SECONDARY,
                    );
                  }
                }
                onGradientEnabledChange={(enabled) => {
                  setThemeSavedNoticeVisible(false);
                  setGradientEnabled(enabled);
                }}
                onGradientDirectionChange={(direction) => {
                  setThemeSavedNoticeVisible(false);
                  setGradientDirection(direction);
                }}
                assistantConversationMode={assistantConversationMode}
                onAssistantConversationModeChange={(mode) => {
                  setAssistantConversationMode(mode);
                  writeAssistantConversationMode(settingsStorageScope, mode);
                }}
                onAccentReset={handleThemeReset}
                onSaveTheme={handleSaveTheme}
                hasUnsavedThemeChanges={hasUnsavedThemeChanges}
                themeSavedNoticeVisible={themeSavedNoticeVisible}
                sectionStyle={dashboardContainerStyle}
                buttonStyle={dashboardButtonStyle}
              />
            )}

            {isAgentView && (
              <AgentPage
                panelStyle={dashboardContainerStyle}
                assistantConversationMode={assistantConversationMode}
                submissions={submissions}
              />
            )}

            {!isDashboardView &&
              !isAnalyticsView &&
              !isTrainingView &&
              !isPuzzleLabView &&
              !isAgentView &&
              !isSettingsView && (
              <section
                className="neumo-surface-soft rounded-[26px] p-5 md:p-7"
                style={dashboardContainerStyle}
              >
                <h2 className="text-2xl font-semibold tracking-tight text-slate-700">{activeNavLabel}</h2>
                <p className="mt-1 text-sm text-slate-500">
                  This section is scaffolded in the sidebar and can be expanded next.
                </p>
              </section>
            )}
          </section>
        </div>
      </div>

      <nav className="fixed inset-x-3 bottom-3 z-40 lg:hidden" aria-label="Mobile navigation">
        <div
          className="mx-auto flex w-full max-w-xl items-center gap-2 rounded-2xl border border-slate-200/70 bg-white/70 p-2 shadow-[0_14px_34px_rgba(15,23,42,0.2)] backdrop-blur-xl dark:border-slate-500/65 dark:bg-slate-900/78"
          style={dashboardContainerStyle}
        >
          {[
            { key: 'home', label: 'Home', icon: House },
            { key: 'solve', label: 'Solve', icon: Puzzle },
            { key: 'training', label: 'Training', icon: Activity },
            { key: 'profile', label: 'Profile', icon: UserRound },
          ].map((item) => {
            const Icon = item.icon;
            const isActive = activeMobileNavKey === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => handleMobileNavSelection(item.key as MobileNavKey)}
                className={`flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-[11px] font-semibold transition ${
                  isActive
                    ? 'neumo-pill text-slate-800 dark:text-slate-100'
                    : 'text-slate-500 hover:text-slate-700 dark:text-slate-300 dark:hover:text-slate-100'
                }`}
                aria-current={isActive ? 'page' : undefined}
              >
                <Icon className="h-4 w-4" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </main>
  );
}

export default function DashboardPage() {
  return (
    <React.Suspense fallback={null}>
      <DashboardPageContent />
    </React.Suspense>
  );
}

