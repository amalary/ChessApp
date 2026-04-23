'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Activity,
  ArrowLeft,
  BarChart3,
  Download,
  LayoutDashboard,
  Puzzle,
  Settings,
} from 'lucide-react';
import {
  getPuzzleSubmissionUpdateEventName,
  estimatePuzzleElo,
  markPuzzleSubmissionNotificationsSeen,
  readPuzzleSubmissions,
  type PuzzleSubmissionRecord,
} from '@/lib/puzzle-submissions';

type NavItem = {
  label: string;
  icon: React.ElementType;
};

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', icon: LayoutDashboard },
  { label: 'Analytics', icon: BarChart3 },
  { label: 'Puzzle Lab', icon: Puzzle },
  { label: 'Training', icon: Activity },
  { label: 'Settings', icon: Settings },
];

const RANGE_TABS = ['Today', 'Week', 'Month', 'Year'] as const;
const DAY_MS = 86400000;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const DEFAULT_DASHBOARD_ACCENT = '#7A94BF';
const DEFAULT_DASHBOARD_SECONDARY = '#A58EB4';
const DASHBOARD_ACCENT_STORAGE_KEY = 'chessapp.dashboard.accent';
const DASHBOARD_SECONDARY_STORAGE_KEY = 'chessapp.dashboard.secondary';
const DASHBOARD_GRADIENT_ENABLED_STORAGE_KEY = 'chessapp.dashboard.gradient.enabled';
const DASHBOARD_GRADIENT_DIRECTION_STORAGE_KEY = 'chessapp.dashboard.gradient.direction';
const NEUMORPHIC_SWATCH_COLORS = [
  '#7A94BF',
  '#7EA7A5',
  '#9AA67A',
  '#B89A7A',
  '#A58EB4',
  '#7FA1C3',
] as const;
const GRADIENT_DIRECTIONS = [
  { value: 'top-to-bottom', label: 'Top to bottom' },
  { value: 'diagonal', label: 'Diagonal' },
  { value: 'bottom-to-top', label: 'Bottom to top' },
] as const;

type ActivityRange = (typeof RANGE_TABS)[number];
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

type GradientDirection = (typeof GRADIENT_DIRECTIONS)[number]['value'];

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

function rgbaFromChannels(channels: [number, number, number], alpha: number): string {
  return `rgba(${channels[0]}, ${channels[1]}, ${channels[2]}, ${alpha})`;
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
        className={`neumo-surface-soft rounded-3xl px-5 py-4 text-left transition ${
          active ? 'ring-2 ring-slate-300/80' : 'hover:-translate-y-[1px]'
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

function resolveSubmissionElo(submission: PuzzleSubmissionRecord): number {
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

function AreaChart({
  title,
  subtitle,
  values,
  axisLabels,
  sectionStyle,
  buttonStyle,
}: {
  title: string;
  subtitle: string;
  values: number[];
  axisLabels?: string[];
  sectionStyle?: React.CSSProperties;
  buttonStyle?: React.CSSProperties;
}) {
  const { areaPath, linePath } = useMemo(() => buildChartPaths(values, 860, 190), [values]);
  const chartId = title.toLowerCase().replace(/\s+/g, '-');
  const labels = axisLabels ?? ['9:00 AM', '12:00 PM', '3:00 PM', '6:00 PM', '9:00 PM', 'Now'];

  return (
    <section className="neumo-surface-soft rounded-[26px] p-5 md:p-7" style={sectionStyle}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-3xl font-semibold tracking-tight text-slate-700">{title}</h2>
          <p className="text-sm text-slate-500">{subtitle}</p>
        </div>
        <button
          type="button"
          className="neumo-pill px-4 py-2 text-xs font-semibold text-slate-500 flex items-center gap-2"
          style={buttonStyle}
        >
          <Download className="h-4 w-4" />
          download svg
        </button>
      </div>

      <div className="mt-5">
        <svg
          viewBox="0 0 860 190"
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

          <g stroke="rgba(148,163,184,0.22)" strokeWidth="1">
            <line x1="0" y1="36" x2="860" y2="36" />
            <line x1="0" y1="92" x2="860" y2="92" />
            <line x1="0" y1="148" x2="860" y2="148" />
          </g>

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
          wheelRef.current?.setPointerCapture(event.pointerId);
          setIsDragging(true);
          applyPointerColor(event.clientX, event.clientY);
        }}
        onPointerMove={(event) => {
          if (!isDragging) {
            return;
          }
          applyPointerColor(event.clientX, event.clientY);
        }}
        onPointerUp={(event) => {
          if (wheelRef.current?.hasPointerCapture(event.pointerId)) {
            wheelRef.current.releasePointerCapture(event.pointerId);
          }
          setIsDragging(false);
        }}
        onPointerCancel={(event) => {
          if (wheelRef.current?.hasPointerCapture(event.pointerId)) {
            wheelRef.current.releasePointerCapture(event.pointerId);
          }
          setIsDragging(false);
        }}
      >
        <div className="h-full w-full rounded-full bg-[radial-gradient(circle,#ffffff_0%,#f1f5f9_65%,#cbd5e1_100%)]" />
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
  accentColor,
  accentChannels,
  secondaryColor,
  secondaryChannels,
  gradientEnabled,
  gradientDirection,
  onAccentChange,
  onSecondaryColorChange,
  onGradientEnabledChange,
  onGradientDirectionChange,
  onAccentReset,
  sectionStyle,
  buttonStyle,
}: {
  accentColor: string;
  accentChannels: [number, number, number];
  secondaryColor: string;
  secondaryChannels: [number, number, number];
  gradientEnabled: boolean;
  gradientDirection: GradientDirection;
  onAccentChange: (nextColor: string) => void;
  onSecondaryColorChange: (nextColor: string) => void;
  onGradientEnabledChange: (enabled: boolean) => void;
  onGradientDirectionChange: (direction: GradientDirection) => void;
  onAccentReset: () => void;
  sectionStyle?: React.CSSProperties;
  buttonStyle?: React.CSSProperties;
}) {
  const swatchColors = NEUMORPHIC_SWATCH_COLORS;

  return (
    <div className="space-y-4">
      <section className="neumo-surface-soft rounded-[26px] p-5 md:p-7" style={sectionStyle}>
        <h2 className="text-2xl font-semibold tracking-tight text-slate-700">1. Account &amp; Profile</h2>
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
                  defaultValue="player@chessapp.com"
                  className="mt-1 w-full rounded-xl border border-slate-200/70 bg-white/80 px-3 py-2 text-sm text-slate-700 outline-none focus:border-slate-400"
                />
              </label>
              <label className="block">
                <span className="text-xs text-slate-500">Username</span>
                <input
                  type="text"
                  defaultValue="ChessTactician"
                  className="mt-1 w-full rounded-xl border border-slate-200/70 bg-white/80 px-3 py-2 text-sm text-slate-700 outline-none focus:border-slate-400"
                />
              </label>
              <button
                type="button"
                className="neumo-pill mt-1 px-4 py-2 text-sm font-semibold text-slate-600"
                style={buttonStyle}
              >
                Save profile
              </button>
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
                  className="mt-1 w-full rounded-xl border border-slate-200/70 bg-white/80 px-3 py-2 text-sm text-slate-700 outline-none focus:border-slate-400"
                />
              </label>
              <label className="block">
                <span className="text-xs text-slate-500">New password</span>
                <input
                  type="password"
                  className="mt-1 w-full rounded-xl border border-slate-200/70 bg-white/80 px-3 py-2 text-sm text-slate-700 outline-none focus:border-slate-400"
                />
              </label>
              <label className="block">
                <span className="text-xs text-slate-500">Confirm password</span>
                <input
                  type="password"
                  className="mt-1 w-full rounded-xl border border-slate-200/70 bg-white/80 px-3 py-2 text-sm text-slate-700 outline-none focus:border-slate-400"
                />
              </label>
              <button
                type="button"
                className="neumo-pill mt-1 px-4 py-2 text-sm font-semibold text-slate-600"
                style={buttonStyle}
              >
                Update password
              </button>
            </div>
          </article>
        </div>

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
        <h2 className="text-2xl font-semibold tracking-tight text-slate-700">2. Theme &amp; UI</h2>
        <p className="mt-1 text-sm text-slate-500">
          Drag the hockey puck to recolor the dashboard background in real time while keeping the
          classic Chess App neumorphic surface style.
        </p>

        <div className="mt-5 rounded-2xl neumo-inset px-4 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Theme mode</p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => onGradientEnabledChange(false)}
              className={`px-4 py-2 text-sm font-semibold rounded-full transition ${
                !gradientEnabled ? 'neumo-pill text-slate-700' : 'neumo-inset text-slate-500'
              }`}
              style={buttonStyle}
            >
              Solid
            </button>
            <button
              type="button"
              onClick={() => onGradientEnabledChange(true)}
              className={`px-4 py-2 text-sm font-semibold rounded-full transition ${
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
                  className={`px-4 py-2 text-sm font-semibold rounded-full transition ${
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
                  className="neumo-pill px-4 py-2 text-sm font-semibold text-slate-600"
                  style={buttonStyle}
                >
                  Reset default
                </button>
              </div>
            </div>

            <div className="rounded-2xl neumo-inset px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                Quick color swatches
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {swatchColors.map((color) => (
                  <button
                    key={`${color}-${gradientEnabled ? 'gradient' : 'solid'}`}
                    type="button"
                    onClick={() =>
                      gradientEnabled ? onSecondaryColorChange(color) : onAccentChange(color)
                    }
                    aria-label={`Set ${gradientEnabled ? 'secondary' : 'accent'} color ${color}`}
                    className={`h-9 w-9 rounded-full border-2 border-white shadow-sm transition hover:scale-105 ${
                      color === (gradientEnabled ? secondaryColor : accentColor)
                        ? 'ring-2 ring-slate-400/70'
                        : ''
                    }`}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
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

export default function DashboardPage() {
  const router = useRouter();
  const [activeNavLabel, setActiveNavLabel] = useState<string>('Dashboard');
  const [activeRange, setActiveRange] = useState<(typeof RANGE_TABS)[number]>('Today');
  const [isTransitioningToChessApp, setIsTransitioningToChessApp] = useState(false);
  const [showSubmissionHistory, setShowSubmissionHistory] = useState(false);
  const [submissions, setSubmissions] = useState<PuzzleSubmissionRecord[]>([]);
  const [expandedSubmissionId, setExpandedSubmissionId] = useState<string | null>(null);
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
    const normalizedAccent = toNeumorphicHexColor(accentColor) ?? DEFAULT_DASHBOARD_ACCENT;
    const normalizedSecondary =
      toNeumorphicHexColor(secondaryColor) ?? DEFAULT_DASHBOARD_SECONDARY;

    window.localStorage.setItem(DASHBOARD_ACCENT_STORAGE_KEY, normalizedAccent);
    window.localStorage.setItem(DASHBOARD_SECONDARY_STORAGE_KEY, normalizedSecondary);
    window.localStorage.setItem(
      DASHBOARD_GRADIENT_ENABLED_STORAGE_KEY,
      gradientEnabled ? '1' : '0',
    );
    window.localStorage.setItem(DASHBOARD_GRADIENT_DIRECTION_STORAGE_KEY, gradientDirection);
    document.documentElement.style.setProperty('--chess-app-accent', normalizedAccent);
    document.documentElement.style.setProperty('--chess-app-accent-secondary', normalizedSecondary);
  }, [accentColor, gradientDirection, gradientEnabled, secondaryColor]);

  const handleBackToChessApp = () => {
    if (isTransitioningToChessApp) {
      return;
    }
    setIsTransitioningToChessApp(true);
    window.setTimeout(() => {
      router.push('/solve-test');
    }, 280);
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
  const eloTrendData = useMemo(
    () => buildEloTrendData(activeRange, submissions),
    [activeRange, submissions],
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
  const dashboardPanelGradient = useMemo(
    () =>
      buildPanelGradientBackground(
        accentChannels,
        secondaryChannels,
        gradientEnabled,
        gradientDirection,
      ),
    [accentChannels, gradientDirection, gradientEnabled, secondaryChannels],
  );
  const dashboardPanelStyle = dashboardPanelGradient
    ? ({
        background: dashboardPanelGradient,
      } as React.CSSProperties)
    : undefined;
  const isDashboardView = activeNavLabel === 'Dashboard';
  const isSettingsView = activeNavLabel === 'Settings';
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

  return (
    <main className="min-h-screen p-4 md:p-8" style={{ background: pageBackground }}>
      <div
        className={`mx-auto w-full max-w-[1380px] neumo-surface rounded-[36px] p-3 md:p-5 transition-all duration-300 ${
          isTransitioningToChessApp
            ? 'opacity-0 scale-[0.98] translate-y-1'
            : 'opacity-100 scale-100 translate-y-0'
        }`}
        style={dashboardContainerStyle}
      >
        <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
          <aside className="neumo-surface-soft rounded-[26px] p-6 md:p-7" style={dashboardContainerStyle}>
            <div className="flex items-center gap-3">
              <div className="relative h-10 w-10">
                <span
                  className="absolute left-0 top-1 h-7 w-7 rounded-full shadow-md"
                  style={{
                    background: `linear-gradient(135deg, ${rgbaFromChannels(accentChannels, 0.35)} 0%, ${rgbaFromChannels(accentChannels, 0.9)} 100%)`,
                  }}
                />
                <span
                  className="absolute left-3 top-4 h-7 w-7 rounded-full shadow-md"
                  style={{
                    background: `linear-gradient(135deg, ${rgbaFromChannels(accentChannels, 0.7)} 0%, ${rgbaFromChannels(secondaryChannels, 0.95)} 100%)`,
                  }}
                />
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.14em] font-semibold" style={brandTextStyle}>
                  Chess App
                </p>
                <p className="text-lg font-semibold text-slate-700">Dashboard</p>
              </div>
            </div>

            <nav className="mt-10 space-y-3">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = item.label === activeNavLabel;
                return (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => setActiveNavLabel(item.label)}
                    className={`flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition ${
                      active
                        ? 'neumo-pill text-slate-700'
                        : 'text-slate-500 hover:text-slate-700 hover:bg-white/30'
                    }`}
                    style={
                      active
                        ? {
                            ...(dashboardButtonStyle ?? {}),
                            color: rgbaFromChannels(accentChannels, 0.95),
                            background: `linear-gradient(135deg, ${rgbaFromChannels(accentChannels, 0.18)} 0%, rgba(255, 255, 255, 0.68) 100%)`,
                          }
                        : dashboardButtonStyle
                    }
                  >
                    <span className="h-8 w-8 rounded-xl neumo-inset flex items-center justify-center">
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="text-sm font-medium">{item.label}</span>
                  </button>
                );
              })}
            </nav>

            <button
              type="button"
              onClick={handleBackToChessApp}
              disabled={isTransitioningToChessApp}
              className="mt-8 w-full neumo-pill px-4 py-2.5 text-sm font-semibold text-slate-600 flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
              style={dashboardButtonStyle}
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Chess App
            </button>
          </aside>

          <section
            className="neumo-surface-soft rounded-[26px] p-4 md:p-5 space-y-4"
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
                    className="neumo-pill px-4 py-2 text-xs font-semibold text-slate-500"
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
                  <div className="mt-4 space-y-3">
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
                                  <img
                                    src={submissionImageSrc!}
                                    alt={submissionImageAlt}
                                    className="h-full w-full object-contain p-1 transition group-hover:scale-[1.02]"
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
                              <img
                                src={submissionImageSrc!}
                                alt={submissionImageAlt}
                                className="h-full w-full object-contain"
                              />
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
                              <span className="text-slate-400">Vision confidence:</span>{' '}
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
                      className={`px-5 py-2 text-sm font-medium rounded-full transition ${
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
                  sectionStyle={dashboardContainerStyle}
                  buttonStyle={dashboardButtonStyle}
                />
                <AreaChart
                  title="Elo Trend"
                  subtitle={eloTrendData.subtitle}
                  values={eloTrendData.values}
                  axisLabels={eloTrendData.axisLabels}
                  sectionStyle={dashboardContainerStyle}
                  buttonStyle={dashboardButtonStyle}
                />
              </>
            )}

            {isSettingsView && (
              <SettingsPanel
                accentColor={accentColor}
                accentChannels={accentChannels}
                secondaryColor={secondaryColor}
                secondaryChannels={secondaryChannels}
                gradientEnabled={gradientEnabled}
                gradientDirection={gradientDirection}
                onAccentChange={(nextColor) =>
                  setAccentColor(toNeumorphicHexColor(nextColor) ?? DEFAULT_DASHBOARD_ACCENT)
                }
                onSecondaryColorChange={(nextColor) =>
                  setSecondaryColor(
                    toNeumorphicHexColor(nextColor) ?? DEFAULT_DASHBOARD_SECONDARY,
                  )
                }
                onGradientEnabledChange={setGradientEnabled}
                onGradientDirectionChange={setGradientDirection}
                onAccentReset={() => {
                  setAccentColor(DEFAULT_DASHBOARD_ACCENT);
                  setSecondaryColor(DEFAULT_DASHBOARD_SECONDARY);
                  setGradientEnabled(false);
                  setGradientDirection('top-to-bottom');
                }}
                sectionStyle={dashboardContainerStyle}
                buttonStyle={dashboardButtonStyle}
              />
            )}

            {!isDashboardView && !isSettingsView && (
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
    </main>
  );
}
