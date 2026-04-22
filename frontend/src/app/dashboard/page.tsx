'use client';

import React, { useEffect, useMemo, useState } from 'react';
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
}: {
  label: string;
  value: string;
  meta: string;
  onClick?: () => void;
  active?: boolean;
  cardClassName?: string;
  valueClassName?: string;
  metaClassName?: string;
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
      >
        {content}
      </button>
    );
  }

  return (
    <article className={`neumo-surface-soft rounded-3xl px-5 py-4 ${cardClassName}`}>{content}</article>
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
}: {
  title: string;
  subtitle: string;
  values: number[];
  axisLabels?: string[];
}) {
  const { areaPath, linePath } = useMemo(() => buildChartPaths(values, 860, 190), [values]);
  const chartId = title.toLowerCase().replace(/\s+/g, '-');
  const labels = axisLabels ?? ['9:00 AM', '12:00 PM', '3:00 PM', '6:00 PM', '9:00 PM', 'Now'];

  return (
    <section className="neumo-surface-soft rounded-[26px] p-5 md:p-7">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-3xl font-semibold tracking-tight text-slate-700">{title}</h2>
          <p className="text-sm text-slate-500">{subtitle}</p>
        </div>
        <button
          type="button"
          className="neumo-pill px-4 py-2 text-xs font-semibold text-slate-500 flex items-center gap-2"
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

export default function DashboardPage() {
  const router = useRouter();
  const [activeRange, setActiveRange] = useState<(typeof RANGE_TABS)[number]>('Today');
  const [isTransitioningToChessApp, setIsTransitioningToChessApp] = useState(false);
  const [showSubmissionHistory, setShowSubmissionHistory] = useState(false);
  const [submissions, setSubmissions] = useState<PuzzleSubmissionRecord[]>([]);

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

  return (
    <main
      className="min-h-screen p-4 md:p-8"
      style={{
        background:
          'radial-gradient(1200px circle at 18% 18%, rgba(255,255,255,0.85), rgba(237,242,250,0) 60%), linear-gradient(180deg, #dfe6f1 0%, #d9e2ef 100%)',
      }}
    >
      <div
        className={`mx-auto w-full max-w-[1380px] neumo-surface rounded-[36px] p-3 md:p-5 transition-all duration-300 ${
          isTransitioningToChessApp
            ? 'opacity-0 scale-[0.98] translate-y-1'
            : 'opacity-100 scale-100 translate-y-0'
        }`}
      >
        <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
          <aside className="neumo-surface-soft rounded-[26px] p-6 md:p-7">
            <div className="flex items-center gap-3">
              <div className="relative h-10 w-10">
                <span className="absolute left-0 top-1 h-7 w-7 rounded-full bg-gradient-to-br from-violet-300 to-violet-500 shadow-md" />
                <span className="absolute left-3 top-4 h-7 w-7 rounded-full bg-gradient-to-br from-pink-400 to-fuchsia-500 shadow-md" />
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Chess App</p>
                <p className="text-lg font-semibold text-slate-700">Dashboard</p>
              </div>
            </div>

            <nav className="mt-10 space-y-3">
              {NAV_ITEMS.map((item, idx) => {
                const Icon = item.icon;
                const active = idx === 0;
                return (
                  <button
                    key={item.label}
                    type="button"
                    className={`flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition ${
                      active
                        ? 'neumo-pill text-slate-700'
                        : 'text-slate-500 hover:text-slate-700 hover:bg-white/30'
                    }`}
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
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Chess App
            </button>
          </aside>

          <section className="space-y-4">
            <header className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <StatCard
                label="Puzzles solved"
                value={String(solvedCount)}
                meta={solvedMeta}
                onClick={() => setShowSubmissionHistory((prev) => !prev)}
                active={showSubmissionHistory}
              />
              <StatCard label="Accuracy" value={accuracyValue} meta={accuracyMeta} />
              <StatCard
                label="Best streak"
                value={streakValue}
                meta={streakMeta}
                cardClassName={streakCardClassName}
                valueClassName={streakValueClassName}
                metaClassName={streakMetaClassName}
              />
              <StatCard
                label="Avg solve time"
                value={averageSolveTimeValue}
                meta={averageSolveTimeMeta}
              />
              <StatCard label="Elo" value={averageEloValue} meta={averageEloMeta} />
            </header>

            {showSubmissionHistory && (
              <section className="neumo-surface-soft rounded-[26px] p-5 md:p-7">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-2xl font-semibold tracking-tight text-slate-700">
                      Solved Puzzle Submissions
                    </h2>
                    <p className="text-sm text-slate-500">
                      Each successful solve with timestamp and position check details
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowSubmissionHistory(false)}
                    className="neumo-pill px-4 py-2 text-xs font-semibold text-slate-500"
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
                    {submissions.map((submission, index) => (
                      <article
                        key={submission.id}
                        className="rounded-2xl neumo-inset px-4 py-4 text-sm text-slate-600"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="font-semibold text-slate-700">Submission {index + 1}</p>
                            <p className="text-xs text-slate-500">
                              {submission.fileName || 'Untitled puzzle'}
                            </p>
                          </div>
                          <p className="text-xs text-slate-500">
                            {formatDateTime(submission.submittedAt)}
                          </p>
                        </div>
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
                          <div className="mt-3 rounded-xl bg-white/50 px-3 py-2">
                            <p className="text-xs uppercase tracking-[0.08em] text-slate-400">
                              Solution
                            </p>
                            <p className="mt-1 text-sm font-medium text-slate-700">
                              {submission.solutionLines.join(' | ')}
                            </p>
                          </div>
                        )}
                      </article>
                    ))}
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
            />
            <AreaChart
              title="Elo Trend"
              subtitle={eloTrendData.subtitle}
              values={eloTrendData.values}
              axisLabels={eloTrendData.axisLabels}
            />
          </section>
        </div>
      </div>
    </main>
  );
}
