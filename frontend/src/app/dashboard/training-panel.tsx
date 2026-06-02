'use client';

import React, { useMemo, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import {
  Activity,
  AlertTriangle,
  Brain,
  CheckCircle2,
  Circle,
  Flame,
  Gauge,
  Minus,
  Play,
  RotateCcw,
  Target,
  Timer,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { estimatePuzzleElo, type PuzzleSubmissionRecord } from '@/lib/puzzle-submissions';

const TRAINING_PLAN_PROGRESS_STORAGE_KEY = 'chessapp.training.plan.progress.v1';
const TRAINING_DAILY_STATUS_STORAGE_KEY = 'chessapp.training.daily.status.v1';
const DAY_MS = 86400000;

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

type TrainingSessionState = {
  status: 'idle' | 'active' | 'completed';
  source: 'daily' | 'weakness' | 'review';
  focusId: string | null;
  startedAt: string | null;
  completedUnits: number;
  totalUnits: number;
};

type DailyTrainingItem = {
  id: string;
  label: string;
  count: number;
  estimatedMinutes: number;
  detail: string;
};

type WeaknessRecommendation = {
  id: string;
  weaknessName: string;
  reason: string;
  recommendedDrill: string;
  difficultyRange: string;
};

type AdaptiveDifficultyStatus = {
  currentLevel: number;
  targetDifficultyRange: string;
  direction: 'up' | 'down' | 'steady';
  reason: string;
  progressToNextLevel: number;
};

type ReviewQueueEntry = {
  id: string;
  submissionId: string;
  puzzleId: string;
  puzzleTitle: string;
  motifTag: string;
  difficulty: number;
  reasonForReview: string;
  lastAttemptedDate: string;
  reviewDueDate: string;
  originalPuzzleImageDataUrl: string | null;
};

type TrainingPanelProps = {
  submissions: PuzzleSubmissionRecord[];
  submissionsLoading: boolean;
  submissionsError: string | null;
  difficultyAnalytics: DifficultyBucketAnalyticsData | null;
  difficultyAnalyticsLoading: boolean;
  difficultyAnalyticsError: string | null;
  panelStyle?: React.CSSProperties;
  buttonStyle?: React.CSSProperties;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parseDayKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatLastAttempt(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return 'Unknown';
  }
  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatDateLabel(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return 'Soon';
  }
  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function resolveSubmissionDifficulty(submission: PuzzleSubmissionRecord): number {
  if (typeof submission.difficultyRating === 'number' && Number.isFinite(submission.difficultyRating)) {
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

function resolveDifficultyRangeFromLevel(level: number): string {
  const start = 700 + (level - 1) * 140;
  const end = start + 239;
  return `${start}-${end}`;
}

function inferMotifTag(submission: PuzzleSubmissionRecord): string {
  const searchable = `${submission.fileName} ${submission.solutionLines.join(' ')}`.toLowerCase();
  if (/\bdiscover(ed|y)? attack/.test(searchable)) {
    return 'Discovered Attack';
  }
  if (/\bback[-\s]?rank/.test(searchable)) {
    return 'Back-Rank Defense';
  }
  if (/\bmate[-\s]?in[-\s]?2/.test(searchable)) {
    return 'Mate-in-2';
  }
  if (/\bfork/.test(searchable)) {
    return 'Forks';
  }
  if (/\bpin/.test(searchable)) {
    return 'Pins';
  }
  if (/\bskewer|x[-\s]?ray/.test(searchable)) {
    return 'Skewers';
  }
  return 'Calculation';
}

function countConsecutiveDays(dayKeys: string[]): number {
  if (dayKeys.length === 0) {
    return 0;
  }

  const daySet = new Set(dayKeys);
  const todayKey = parseDayKey(new Date());
  const yesterdayKey = parseDayKey(new Date(Date.now() - DAY_MS));
  let cursor = daySet.has(todayKey) ? new Date() : daySet.has(yesterdayKey) ? new Date(Date.now() - DAY_MS) : null;
  if (!cursor) {
    return 0;
  }

  let streak = 0;
  while (cursor) {
    const key = parseDayKey(cursor);
    if (!daySet.has(key)) {
      break;
    }
    streak += 1;
    cursor = new Date(cursor.getTime() - DAY_MS);
  }
  return streak;
}

function resolveWeakDifficultyLabel(
  analytics: DifficultyBucketAnalyticsData | null,
): DifficultyBucketAnalyticsBucket | null {
  if (!analytics || analytics.totalValidAttempts < 4) {
    return null;
  }
  const candidates = analytics.difficultyBuckets.filter((bucket) => bucket.totalAttempts >= 2);
  if (candidates.length === 0) {
    return null;
  }
  return candidates.reduce((weakest, bucket) =>
    bucket.accuracyPercentage < weakest.accuracyPercentage ? bucket : weakest,
  );
}

function formatDifficultyBucketLabel(label: string): string {
  return label.includes('+') ? label : label.replace('-', '-');
}

function determineAdaptiveDifficulty(
  submissions: PuzzleSubmissionRecord[],
  streakDays: number,
): AdaptiveDifficultyStatus {
  if (submissions.length === 0) {
    return {
      currentLevel: 1,
      targetDifficultyRange: resolveDifficultyRangeFromLevel(1),
      direction: 'steady',
      reason: 'No history yet. Starting with foundational puzzles.',
      progressToNextLevel: 12,
    };
  }

  const recent = submissions.slice(0, 12);
  const validFirstMove = recent
    .map((entry) => entry.firstMoveAssessment)
    .filter(
      (assessment): assessment is NonNullable<PuzzleSubmissionRecord['firstMoveAssessment']> =>
        assessment !== null && assessment !== undefined && assessment.isValidForFirstMoveAccuracy,
    );
  const firstMoveAccuracy =
    validFirstMove.length > 0
      ? validFirstMove.filter((assessment) => assessment.isFirstMoveCorrect).length / validFirstMove.length
      : null;
  const timed = recent
    .map((entry) => entry.solveTimeMs)
    .filter((solveTimeMs): solveTimeMs is number => typeof solveTimeMs === 'number' && Number.isFinite(solveTimeMs));
  const avgSolveSeconds =
    timed.length > 0 ? timed.reduce((sum, solveTimeMs) => sum + solveTimeMs, 0) / timed.length / 1000 : null;
  const retryRate =
    recent.filter((entry) => (entry.positionCheck.attemptsUsed ?? 1) > 1).length / Math.max(1, recent.length);
  const avgDifficulty =
    recent.reduce((sum, entry) => sum + resolveSubmissionDifficulty(entry), 0) / Math.max(1, recent.length);
  const baseLevel = clamp(Math.round((avgDifficulty - 650) / 180) + 1, 1, 10);

  let direction: AdaptiveDifficultyStatus['direction'] = 'steady';
  if (
    (firstMoveAccuracy !== null && firstMoveAccuracy >= 0.78 && retryRate < 0.2 && (avgSolveSeconds ?? 0) <= 55) ||
    streakDays >= 5
  ) {
    direction = 'up';
  } else if (
    (firstMoveAccuracy !== null && firstMoveAccuracy < 0.58) ||
    retryRate >= 0.35 ||
    (avgSolveSeconds !== null && avgSolveSeconds > 90)
  ) {
    direction = 'down';
  }

  const levelAdjustment = direction === 'up' ? 1 : direction === 'down' ? -1 : 0;
  const currentLevel = clamp(baseLevel + levelAdjustment, 1, 10);
  const progressScore =
    clamp(
      Math.round(
        ((firstMoveAccuracy ?? 0.62) * 62 +
          (avgSolveSeconds !== null ? clamp((95 - avgSolveSeconds) / 95, 0, 1) * 28 : 10) +
          (1 - retryRate) * 18 +
          Math.min(streakDays, 6)),
      ),
      0,
      100,
    ) || 0;

  let reason = 'Recent performance is stable, so the current range stays in place.';
  if (direction === 'up') {
    reason = 'You are solving accurately with fewer retries, so difficulty is stepping up slightly.';
  } else if (direction === 'down') {
    if (firstMoveAccuracy !== null && firstMoveAccuracy < 0.58) {
      reason = 'First-move misses are elevated, so easier pattern-recognition reps are prioritized.';
    } else if (avgSolveSeconds !== null && avgSolveSeconds > 90) {
      reason = 'Solve times are trending high, so calculation-building drills are being introduced.';
    } else {
      reason = 'Recent struggle signals triggered a short reset to reinforce fundamentals.';
    }
  }

  return {
    currentLevel,
    targetDifficultyRange: resolveDifficultyRangeFromLevel(currentLevel),
    direction,
    reason,
    progressToNextLevel: progressScore,
  };
}

function buildReviewQueue(
  submissions: PuzzleSubmissionRecord[],
): ReviewQueueEntry[] {
  if (submissions.length === 0) {
    return [];
  }

  const grouped = new Map<string, PuzzleSubmissionRecord[]>();
  submissions.forEach((submission) => {
    const key =
      submission.firstMoveAssessment?.puzzleId ||
      (typeof submission.fen === 'string' && submission.fen.trim().length > 0 ? submission.fen.trim() : submission.id);
    const bucket = grouped.get(key);
    if (bucket) {
      bucket.push(submission);
    } else {
      grouped.set(key, [submission]);
    }
  });

  const queue: Array<ReviewQueueEntry & { dueTimestamp: number; priority: number }> = [];
  const nowMs = Date.now();

  grouped.forEach((records, key) => {
    const sorted = records
      .slice()
      .sort((a, b) => Date.parse(b.submittedAt) - Date.parse(a.submittedAt));
    const latest = sorted[0];
    if (!latest) {
      return;
    }

    const latestAssessment = latest.firstMoveAssessment;
    const incorrectAttempts = sorted.filter(
      (entry) => entry.firstMoveAssessment && entry.firstMoveAssessment.isValidForFirstMoveAccuracy && !entry.firstMoveAssessment.isFirstMoveCorrect,
    );
    if (incorrectAttempts.length === 0) {
      return;
    }

    const latestIsStrongRepeat =
      latestAssessment?.isValidForFirstMoveAccuracy === true &&
      latestAssessment.isFirstMoveCorrect &&
      (latest.positionCheck.attemptsUsed ?? 1) <= 1;
    if (latestIsStrongRepeat) {
      return;
    }

    const reason =
      incorrectAttempts.length > 1
        ? 'Repeated first-move misses on this puzzle.'
        : 'You missed the first move on this puzzle.';
    const priority = 4;

    const failureCount = Math.max(1, incorrectAttempts.length);
    const intervalHours = Math.min(72, 4 * Math.pow(2, Math.max(0, failureCount - 1)));
    const lastAttemptMs = Date.parse(latest.submittedAt);
    const dueTimestamp = (Number.isFinite(lastAttemptMs) ? lastAttemptMs : nowMs) + intervalHours * 3600 * 1000;
    const dueDate = new Date(dueTimestamp).toISOString();

    queue.push({
      id: `${key}-${latest.id}`,
      submissionId: latest.id,
      puzzleId: key,
      puzzleTitle: latest.fileName || 'Puzzle review',
      motifTag: inferMotifTag(latest),
      difficulty: resolveSubmissionDifficulty(latest),
      reasonForReview: reason,
      lastAttemptedDate: latest.submittedAt,
      reviewDueDate: dueDate,
      originalPuzzleImageDataUrl:
        typeof latest.originalPuzzleImageDataUrl === 'string' &&
        latest.originalPuzzleImageDataUrl.startsWith('data:image/')
          ? latest.originalPuzzleImageDataUrl
          : null,
      dueTimestamp,
      priority,
    });
  });

  return queue
    .sort((a, b) => {
      const aLastAttempt = Date.parse(a.lastAttemptedDate);
      const bLastAttempt = Date.parse(b.lastAttemptedDate);
      if (Number.isFinite(aLastAttempt) && Number.isFinite(bLastAttempt) && bLastAttempt !== aLastAttempt) {
        return bLastAttempt - aLastAttempt;
      }
      return b.priority - a.priority || a.dueTimestamp - b.dueTimestamp;
    })
    .slice(0, 8)
    .map((entry) => ({
      id: entry.id,
      submissionId: entry.submissionId,
      puzzleId: entry.puzzleId,
      puzzleTitle: entry.puzzleTitle,
      motifTag: entry.motifTag,
      difficulty: entry.difficulty,
      reasonForReview: entry.reasonForReview,
      lastAttemptedDate: entry.lastAttemptedDate,
      reviewDueDate: entry.reviewDueDate,
      originalPuzzleImageDataUrl: entry.originalPuzzleImageDataUrl,
    }));
}

function buildWeaknessRecommendations(
  submissions: PuzzleSubmissionRecord[],
  reviewQueue: ReviewQueueEntry[],
  adaptive: AdaptiveDifficultyStatus,
  analytics: DifficultyBucketAnalyticsData | null,
): WeaknessRecommendation[] {
  if (submissions.length === 0) {
    return [
      {
        id: 'starter-patterns',
        weaknessName: 'Pattern Recognition Foundations',
        reason: 'No puzzle history yet.',
        recommendedDrill: 'Practice discovered attacks and basic forks.',
        difficultyRange: '700-900',
      },
      {
        id: 'starter-mate-two',
        weaknessName: 'Mate-in-2 Calculation',
        reason: 'Build short tactical calculation habits from day one.',
        recommendedDrill: 'Solve mate-in-2 puzzles without hints.',
        difficultyRange: '800-1000',
      },
      {
        id: 'starter-defense',
        weaknessName: 'Back-Rank Defense',
        reason: 'Common tactical blind spot for early learners.',
        recommendedDrill: 'Review back-rank defense motifs and prophylactic moves.',
        difficultyRange: '800-1100',
      },
    ];
  }

  const recommendations: WeaknessRecommendation[] = [];
  const recent = submissions.slice(0, 40);
  const validFirstMove = recent
    .map((entry) => entry.firstMoveAssessment)
    .filter(
      (assessment): assessment is NonNullable<PuzzleSubmissionRecord['firstMoveAssessment']> =>
        assessment !== null && assessment !== undefined && assessment.isValidForFirstMoveAccuracy,
    );
  const firstMoveAccuracyPercent =
    validFirstMove.length > 0
      ? Math.round(
          (validFirstMove.filter((assessment) => assessment.isFirstMoveCorrect).length / validFirstMove.length) *
            100,
        )
      : null;
  const retryRate = recent.filter((entry) => (entry.positionCheck.attemptsUsed ?? 1) > 1).length / Math.max(1, recent.length);
  const timedValues = recent
    .map((entry) => entry.solveTimeMs)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const averageSolveSeconds =
    timedValues.length > 0 ? Math.round((timedValues.reduce((sum, value) => sum + value, 0) / timedValues.length) / 1000) : null;
  const motifMissMap = new Map<string, number>();
  recent.forEach((entry) => {
    const motif = inferMotifTag(entry);
    const missedFirstMove =
      entry.firstMoveAssessment?.isValidForFirstMoveAccuracy &&
      entry.firstMoveAssessment.isFirstMoveCorrect === false;
    if (!missedFirstMove) {
      return;
    }
    motifMissMap.set(motif, (motifMissMap.get(motif) ?? 0) + 1);
  });

  if (firstMoveAccuracyPercent !== null && firstMoveAccuracyPercent < 68) {
    recommendations.push({
      id: 'low-first-move',
      weaknessName: 'Low First-Move Accuracy',
      reason: `First-move accuracy is ${firstMoveAccuracyPercent}% in recent attempts.`,
      recommendedDrill: 'Run 10 quick pattern-recognition puzzles before full calculation lines.',
      difficultyRange: adaptive.direction === 'down' ? resolveDifficultyRangeFromLevel(Math.max(1, adaptive.currentLevel - 1)) : adaptive.targetDifficultyRange,
    });
  }

  const topMotif = Array.from(motifMissMap.entries()).sort((a, b) => b[1] - a[1])[0];
  if (topMotif && topMotif[1] >= 2) {
    recommendations.push({
      id: `motif-${topMotif[0].toLowerCase().replace(/\s+/g, '-')}`,
      weaknessName: `Practice ${topMotif[0]}`,
      reason: `${topMotif[1]} recent first-move misses were tagged as ${topMotif[0]}.`,
      recommendedDrill: `Solve a focused ${topMotif[0].toLowerCase()} set with strict first-move discipline.`,
      difficultyRange: adaptive.targetDifficultyRange,
    });
  }

  const weakBucket = resolveWeakDifficultyLabel(analytics);
  if (weakBucket && weakBucket.accuracyPercentage < 72) {
    recommendations.push({
      id: `bucket-${weakBucket.label}`,
      weaknessName: `Train ${formatDifficultyBucketLabel(weakBucket.label)} Puzzles`,
      reason: `Accuracy in this bucket is ${Math.round(weakBucket.accuracyPercentage)}%.`,
      recommendedDrill: 'Do short cycles of 6 puzzles with no hints and immediate review after misses.',
      difficultyRange: weakBucket.label,
    });
  }

  if (averageSolveSeconds !== null && averageSolveSeconds > 80) {
    recommendations.push({
      id: 'slow-solve',
      weaknessName: 'Slow Solve Time',
      reason: `Average solve time is ${averageSolveSeconds}s, above your target pace.`,
      recommendedDrill: 'Alternate 5 timed tactical reps with 2 deeper calculation puzzles.',
      difficultyRange: adaptive.direction === 'down' ? resolveDifficultyRangeFromLevel(Math.max(1, adaptive.currentLevel - 1)) : adaptive.targetDifficultyRange,
    });
  }

  if (retryRate > 0.3) {
    recommendations.push({
      id: 'high-retries',
      weaknessName: 'High Retry Frequency',
      reason: `${Math.round(retryRate * 100)}% of recent solves needed retries.`,
      recommendedDrill: 'Play each first move once, then evaluate before re-attempting.',
      difficultyRange: resolveDifficultyRangeFromLevel(Math.max(1, adaptive.currentLevel - 1)),
    });
  }

  if (recommendations.length === 0 && reviewQueue.length > 0) {
    recommendations.push({
      id: 'review-focus',
      weaknessName: 'Review Queue Reinforcement',
      reason: `${reviewQueue.length} puzzle${reviewQueue.length === 1 ? '' : 's'} are due for review.`,
      recommendedDrill: 'Clear due review puzzles before starting new difficult sets.',
      difficultyRange: adaptive.targetDifficultyRange,
    });
  }

  return recommendations.slice(0, 4);
}

function buildDailyPlan(
  hasHistory: boolean,
  adaptive: AdaptiveDifficultyStatus,
  reviewQueueCount: number,
  weaknessCount: number,
): DailyTrainingItem[] {
  if (!hasHistory) {
    return [
      {
        id: 'warmups',
        label: 'Tactical warmups',
        count: 5,
        estimatedMinutes: 10,
        detail: 'Fast recognition reps to activate tactical vision.',
      },
      {
        id: 'motif-focus',
        label: 'Motif-focused puzzles',
        count: 3,
        estimatedMinutes: 12,
        detail: 'Starter motifs: discovered attacks, forks, and pins.',
      },
      {
        id: 'calculation',
        label: 'Harder calculation puzzles',
        count: 2,
        estimatedMinutes: 14,
        detail: 'Short calculation trees with no hints.',
      },
      {
        id: 'review',
        label: 'Review puzzle from mistakes',
        count: 1,
        estimatedMinutes: 5,
        detail: 'Reinforce one puzzle from your future review queue.',
      },
    ];
  }

  const warmups = clamp(3 + (adaptive.direction === 'down' ? 1 : 0), 3, 6);
  const motifCount = clamp(3 + (weaknessCount > 2 ? 1 : 0), 3, 5);
  const calculationCount = adaptive.direction === 'up' ? 3 : adaptive.direction === 'down' ? 1 : 2;
  const reviewCount = clamp(Math.max(1, Math.min(reviewQueueCount, 3)), 1, 3);

  return [
    {
      id: 'warmups',
      label: 'Tactical warmups',
      count: warmups,
      estimatedMinutes: warmups * 2,
      detail: 'Quick confidence builders before harder sets.',
    },
    {
      id: 'motif-focus',
      label: 'Motif-focused puzzles',
      count: motifCount,
      estimatedMinutes: motifCount * 4,
      detail: 'Focused reps on your weakest tactical themes.',
    },
    {
      id: 'calculation',
      label: 'Harder calculation puzzles',
      count: calculationCount,
      estimatedMinutes: calculationCount * 7,
      detail: `Target range ${adaptive.targetDifficultyRange}.`,
    },
    {
      id: 'review',
      label: 'Review puzzle from previous mistakes',
      count: reviewCount,
      estimatedMinutes: reviewCount * 5,
      detail: 'Spaced repetition from puzzles with incorrect first moves.',
    },
  ];
}

function TrainingPlanCard({
  dateKey,
  items,
  completedIds,
  onToggleItem,
  estimatedMinutes,
  streakDays,
  onStart,
  onOpenSolver,
  session,
  panelStyle,
  buttonStyle,
}: {
  dateKey: string;
  items: DailyTrainingItem[];
  completedIds: Set<string>;
  onToggleItem: (itemId: string) => void;
  estimatedMinutes: number;
  streakDays: number;
  onStart: () => void;
  onOpenSolver: () => void;
  session: TrainingSessionState;
  panelStyle?: React.CSSProperties;
  buttonStyle?: React.CSSProperties;
}) {
  const completedCount = items.filter((item) => completedIds.has(item.id)).length;
  const progressPercent = Math.round((completedCount / Math.max(1, items.length)) * 100);
  const isComplete = completedCount === items.length && items.length > 0;

  return (
    <article className="neumo-surface-soft rounded-[26px] p-5 md:p-7" style={panelStyle}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.08em] text-slate-500">Today&apos;s Training</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-700 dark:text-slate-100">
            Focused Daily Plan
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-300">
            {isComplete ? 'Completed for today. Keep the streak alive tomorrow.' : 'Structured tactical work for a repeatable daily session.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full neumo-pill px-3 py-1 text-xs font-semibold text-slate-600 dark:text-slate-200">
            <Flame className="mr-1 inline h-3.5 w-3.5" />
            {streakDays}d streak
          </span>
          <span className="rounded-full neumo-pill px-3 py-1 text-xs font-semibold text-slate-600 dark:text-slate-200">
            <Timer className="mr-1 inline h-3.5 w-3.5" />
            ~{estimatedMinutes} min
          </span>
          <span className="rounded-full neumo-pill px-3 py-1 text-xs font-semibold text-slate-600 dark:text-slate-200">
            {completedCount}/{items.length} steps
          </span>
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-full neumo-inset">
        <div
          className="h-2.5 rounded-full bg-gradient-to-r from-sky-500 to-emerald-500 transition-[width] duration-300"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      <div className="mt-4 grid gap-3">
        {items.map((item) => {
          const completed = completedIds.has(item.id);
          return (
            <button
              key={`${dateKey}-${item.id}`}
              type="button"
              onClick={() => onToggleItem(item.id)}
              className={`w-full rounded-2xl px-4 py-3 text-left transition-all duration-200 ${
                completed ? 'neumo-pill' : 'neumo-inset hover:bg-white/35 dark:hover:bg-white/10'
              }`}
              style={buttonStyle}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  {completed ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" />
                  ) : (
                    <Circle className="mt-0.5 h-4 w-4 text-slate-400" />
                  )}
                  <div>
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-100">
                      {item.count} {item.label}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-300">{item.detail}</p>
                  </div>
                </div>
                <span className="rounded-full neumo-pill px-2.5 py-1 text-[11px] font-semibold text-slate-600 dark:text-slate-200">
                  {item.estimatedMinutes}m
                </span>
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onStart}
          className="inline-flex items-center gap-2 rounded-full neumo-pill px-4 py-2 text-sm font-semibold text-slate-700 transition-all duration-200 hover:-translate-y-[1px] hover:shadow-[0_8px_16px_rgba(15,23,42,0.12)] dark:text-slate-100"
          style={buttonStyle}
        >
          <Play className="h-4 w-4" />
          {session.status === 'active' && session.source === 'daily' ? 'Continue session' : 'Start training'}
        </button>
        <button
          type="button"
          onClick={onOpenSolver}
          className="inline-flex items-center gap-2 rounded-full neumo-pill px-4 py-2 text-sm font-semibold text-slate-600 transition-all duration-200 hover:-translate-y-[1px] hover:text-slate-700 hover:shadow-[0_8px_16px_rgba(15,23,42,0.12)] dark:text-slate-200 dark:hover:text-slate-100"
          style={buttonStyle}
        >
          <Activity className="h-4 w-4" />
          Open solver
        </button>
      </div>
    </article>
  );
}

function WeaknessCard({
  recommendation,
  onStart,
  buttonStyle,
}: {
  recommendation: WeaknessRecommendation;
  onStart: () => void;
  buttonStyle?: React.CSSProperties;
}) {
  return (
    <article className="neumo-surface-soft rounded-3xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-100">{recommendation.weaknessName}</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-300">{recommendation.reason}</p>
        </div>
        <Target className="h-4 w-4 text-slate-400" />
      </div>
      <div className="mt-3 space-y-1.5">
        <p className="text-xs font-semibold uppercase tracking-[0.06em] text-slate-500 dark:text-slate-300">Recommended drill</p>
        <p className="text-sm text-slate-700 dark:text-slate-100">{recommendation.recommendedDrill}</p>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="rounded-full neumo-pill px-2.5 py-1 text-[11px] font-semibold text-slate-600 dark:text-slate-200">
          {recommendation.difficultyRange}
        </span>
        <button
          type="button"
          onClick={onStart}
          className="inline-flex items-center gap-1.5 rounded-full neumo-pill px-3 py-1.5 text-xs font-semibold text-slate-700 transition-all duration-200 hover:-translate-y-[1px] hover:shadow-[0_6px_14px_rgba(15,23,42,0.12)] dark:text-slate-100"
          style={buttonStyle}
        >
          <Play className="h-3.5 w-3.5" />
          Start
        </button>
      </div>
    </article>
  );
}

function AdaptiveDifficultyCard({
  status,
  buttonStyle,
}: {
  status: AdaptiveDifficultyStatus;
  buttonStyle?: React.CSSProperties;
}) {
  const directionIcon =
    status.direction === 'up' ? (
      <TrendingUp className="h-4 w-4 text-emerald-600" />
    ) : status.direction === 'down' ? (
      <TrendingDown className="h-4 w-4 text-amber-600" />
    ) : (
      <Minus className="h-4 w-4 text-slate-400" />
    );

  return (
    <article className="neumo-surface-soft rounded-3xl p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.08em] text-slate-500">Adaptive Difficulty</p>
          <h3 className="mt-1 text-xl font-semibold text-slate-700 dark:text-slate-100">Current Level {status.currentLevel}</h3>
        </div>
        <span className="rounded-full neumo-pill px-2.5 py-1 text-xs font-semibold text-slate-600 dark:text-slate-200 inline-flex items-center gap-1.5">
          <Gauge className="h-3.5 w-3.5" />
          {status.targetDifficultyRange}
        </span>
      </div>

      <div className="mt-3 rounded-2xl neumo-inset px-3 py-3">
        <div className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-100">
          {directionIcon}
          <p>{status.reason}</p>
        </div>
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-300">
          <span>Progress to next level</span>
          <span>{status.progressToNextLevel}%</span>
        </div>
        <div className="mt-2 overflow-hidden rounded-full neumo-inset">
          <div
            className="h-2 rounded-full bg-gradient-to-r from-sky-500 to-indigo-500 transition-[width] duration-300"
            style={{ width: `${status.progressToNextLevel}%` }}
          />
        </div>
      </div>

      <button
        type="button"
        className="mt-4 inline-flex items-center gap-2 rounded-full neumo-pill px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-200"
        style={buttonStyle}
      >
        <Brain className="h-3.5 w-3.5" />
        Target range {status.targetDifficultyRange}
      </button>
    </article>
  );
}

function ReviewQueueItem({
  entry,
  onRetry,
  expandedReviewQueueId,
  onToggleImage,
  buttonStyle,
}: {
  entry: ReviewQueueEntry;
  onRetry: () => void;
  expandedReviewQueueId: string | null;
  onToggleImage: (entryId: string) => void;
  buttonStyle?: React.CSSProperties;
}) {
  const submissionImageSrc =
    typeof entry.originalPuzzleImageDataUrl === 'string' &&
    entry.originalPuzzleImageDataUrl.startsWith('data:image/')
      ? entry.originalPuzzleImageDataUrl
      : null;
  const hasSubmissionImage = Boolean(submissionImageSrc);
  const isExpanded = expandedReviewQueueId === entry.id;
  const submissionImageAlt = `Review puzzle image for ${entry.puzzleTitle || 'puzzle'}`;

  return (
    <article className="rounded-2xl neumo-surface-soft px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-100">{entry.puzzleTitle}</p>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-300">{entry.reasonForReview}</p>
        </div>
        <span className="rounded-full neumo-pill px-2.5 py-1 text-[11px] font-semibold text-slate-600 dark:text-slate-200">
          {entry.difficulty}
        </span>
      </div>

      {hasSubmissionImage && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => onToggleImage(entry.id)}
            className="group inline-flex flex-col items-start gap-2 rounded-lg"
            aria-label={`Expand puzzle image for ${entry.puzzleTitle || 'review puzzle'}`}
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
              {isExpanded ? 'Click image to collapse' : 'Click image to expand'}
            </span>
          </button>
        </div>
      )}

      {hasSubmissionImage && isExpanded && (
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

      <div className="mt-3 grid gap-2 text-xs text-slate-600 dark:text-slate-200 sm:grid-cols-2 lg:grid-cols-4">
        <p>
          <span className="text-slate-400">Motif:</span> {entry.motifTag}
        </p>
        <p>
          <span className="text-slate-400">Last attempted:</span> {formatLastAttempt(entry.lastAttemptedDate)}
        </p>
        <p>
          <span className="text-slate-400">Due:</span> {formatDateLabel(entry.reviewDueDate)}
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center justify-center gap-1.5 rounded-full neumo-pill px-3 py-1.5 text-xs font-semibold text-slate-700 transition-all duration-200 hover:-translate-y-[1px] hover:shadow-[0_6px_14px_rgba(15,23,42,0.12)] dark:text-slate-100"
          style={buttonStyle}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Retry
        </button>
      </div>
    </article>
  );
}

export function TrainingPanel({
  submissions,
  submissionsLoading,
  submissionsError,
  difficultyAnalytics,
  difficultyAnalyticsLoading,
  difficultyAnalyticsError,
  panelStyle,
  buttonStyle,
}: TrainingPanelProps) {
  const router = useRouter();
  const todayKey = useMemo(() => parseDayKey(new Date()), []);
  const [completedByDate, setCompletedByDate] = useState<Record<string, string[]>>(() => {
    if (typeof window === 'undefined') {
      return {};
    }
    try {
      const rawProgress = window.localStorage.getItem(TRAINING_PLAN_PROGRESS_STORAGE_KEY);
      if (!rawProgress) {
        return {};
      }
      const parsed = JSON.parse(rawProgress) as Record<string, unknown>;
      const normalized: Record<string, string[]> = {};
      Object.entries(parsed).forEach(([key, value]) => {
        if (Array.isArray(value)) {
          normalized[key] = value.filter((item): item is string => typeof item === 'string');
        }
      });
      return normalized;
    } catch {
      return {};
    }
  });
  const [dailyStatus, setDailyStatus] = useState<Record<string, boolean>>(() => {
    if (typeof window === 'undefined') {
      return {};
    }
    try {
      const rawStatus = window.localStorage.getItem(TRAINING_DAILY_STATUS_STORAGE_KEY);
      if (!rawStatus) {
        return {};
      }
      const parsed = JSON.parse(rawStatus) as Record<string, unknown>;
      const normalized: Record<string, boolean> = {};
      Object.entries(parsed).forEach(([key, value]) => {
        if (typeof value === 'boolean') {
          normalized[key] = value;
        }
      });
      return normalized;
    } catch {
      return {};
    }
  });
  const [session, setSession] = useState<TrainingSessionState>({
    status: 'idle',
    source: 'daily',
    focusId: null,
    startedAt: null,
    completedUnits: 0,
    totalUnits: 0,
  });
  const [expandedReviewQueueId, setExpandedReviewQueueId] = useState<string | null>(null);

  const trainingStreakDays = useMemo(() => {
    const completedDays = Object.entries(dailyStatus)
      .filter(([, complete]) => complete)
      .map(([day]) => day);
    return countConsecutiveDays(completedDays);
  }, [dailyStatus]);

  const adaptiveStatus = useMemo(
    () => determineAdaptiveDifficulty(submissions, trainingStreakDays),
    [submissions, trainingStreakDays],
  );
  const reviewQueue = useMemo(() => buildReviewQueue(submissions), [submissions]);
  const weaknessRecommendations = useMemo(
    () => buildWeaknessRecommendations(submissions, reviewQueue, adaptiveStatus, difficultyAnalytics),
    [adaptiveStatus, difficultyAnalytics, reviewQueue, submissions],
  );
  const dailyPlan = useMemo(
    () => buildDailyPlan(submissions.length > 0, adaptiveStatus, reviewQueue.length, weaknessRecommendations.length),
    [adaptiveStatus, reviewQueue.length, submissions.length, weaknessRecommendations.length],
  );
  const completedToday = useMemo(
    () => new Set(completedByDate[todayKey] ?? []),
    [completedByDate, todayKey],
  );
  const estimatedMinutes = useMemo(
    () => dailyPlan.reduce((sum, item) => sum + item.estimatedMinutes, 0),
    [dailyPlan],
  );

  const togglePlanItem = (itemId: string) => {
    setCompletedByDate((previous) => {
      const todayItems = new Set(previous[todayKey] ?? []);
      if (todayItems.has(itemId)) {
        todayItems.delete(itemId);
      } else {
        todayItems.add(itemId);
      }
      const next = {
        ...previous,
        [todayKey]: Array.from(todayItems),
      };
      try {
        window.localStorage.setItem(TRAINING_PLAN_PROGRESS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Ignore local storage persistence failures.
      }
      const completedTodayIds = next[todayKey] ?? [];
      const isCompleteNow =
        dailyPlan.length > 0 && dailyPlan.every((item) => completedTodayIds.includes(item.id));
      setDailyStatus((previousStatus) => {
        if (previousStatus[todayKey] === isCompleteNow) {
          return previousStatus;
        }
        const nextStatus = {
          ...previousStatus,
          [todayKey]: isCompleteNow,
        };
        try {
          window.localStorage.setItem(TRAINING_DAILY_STATUS_STORAGE_KEY, JSON.stringify(nextStatus));
        } catch {
          // Ignore local storage persistence failures.
        }
        return nextStatus;
      });
      return next;
    });
  };

  const beginSession = (source: TrainingSessionState['source'], focusId: string | null, totalUnits: number) => {
    setSession({
      status: 'active',
      source,
      focusId,
      startedAt: new Date().toISOString(),
      completedUnits: 0,
      totalUnits: Math.max(1, totalUnits),
    });
  };

  const handleStartDailyPlan = () => {
    beginSession(
      'daily',
      'today-plan',
      dailyPlan.reduce((sum, item) => sum + item.count, 0),
    );
  };

  const handleStartWeakness = (recommendation: WeaknessRecommendation) => {
    beginSession('weakness', recommendation.id, 6);
  };

  const handleRetryReviewItem = (entry: ReviewQueueEntry) => {
    beginSession('review', entry.id, 1);
    if (entry.submissionId) {
      router.push(`/solve-test?retrySubmissionId=${encodeURIComponent(entry.submissionId)}`);
      return;
    }
    router.push('/solve-test');
  };

  const openSolver = () => {
    router.push('/solve-test');
  };

  const hasHistory = submissions.length > 0;

  return (
    <div className="space-y-4">
      <TrainingPlanCard
        dateKey={todayKey}
        items={dailyPlan}
        completedIds={completedToday}
        onToggleItem={togglePlanItem}
        estimatedMinutes={estimatedMinutes}
        streakDays={trainingStreakDays}
        onStart={handleStartDailyPlan}
        onOpenSolver={openSolver}
        session={session}
        panelStyle={panelStyle}
        buttonStyle={buttonStyle}
      />

      {(submissionsLoading || difficultyAnalyticsLoading) && (
        <section className="neumo-surface-soft rounded-[26px] p-5 md:p-7" style={panelStyle}>
          <div className="space-y-3 animate-pulse">
            <div className="h-5 w-56 rounded bg-slate-200/80 dark:bg-slate-700/60" />
            <div className="h-4 w-full rounded bg-slate-200/70 dark:bg-slate-700/50" />
            <div className="h-4 w-5/6 rounded bg-slate-200/70 dark:bg-slate-700/50" />
          </div>
        </section>
      )}

      {!submissionsLoading && (
        <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
          <section className="neumo-surface-soft rounded-[26px] p-5 md:p-7" style={panelStyle}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.08em] text-slate-500">Weakness-Based Training</p>
                <h3 className="mt-1 text-xl font-semibold text-slate-700 dark:text-slate-100">
                  Recommended Focus Areas
                </h3>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-300">
                  Personalized drills based on first-move accuracy, retries, speed, motifs, and difficulty buckets.
                </p>
              </div>
            </div>

            {submissionsError && (
              <p className="mt-3 rounded-xl neumo-inset px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                Could not sync latest puzzle history. Showing local training data.
              </p>
            )}

            {difficultyAnalyticsError && (
              <p className="mt-3 rounded-xl neumo-inset px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                Difficulty analytics unavailable right now. Recommendations are using recent solves.
              </p>
            )}

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {weaknessRecommendations.map((recommendation) => (
                <WeaknessCard
                  key={recommendation.id}
                  recommendation={recommendation}
                  onStart={() => handleStartWeakness(recommendation)}
                  buttonStyle={buttonStyle}
                />
              ))}
            </div>
          </section>

          <AdaptiveDifficultyCard status={adaptiveStatus} buttonStyle={buttonStyle} />
        </div>
      )}

      <section className="neumo-surface-soft rounded-[26px] p-5 md:p-7" style={panelStyle}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.08em] text-slate-500">Puzzle Review Queue</p>
            <h3 className="mt-1 text-xl font-semibold text-slate-700 dark:text-slate-100">Revisit and Reinforce</h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-300">
              Queue includes only puzzles where your first move was incorrect, so you can retrain pattern recognition.
            </p>
          </div>
          <span className="rounded-full neumo-pill px-3 py-1 text-xs font-semibold text-slate-600 dark:text-slate-200">
            {reviewQueue.length} due
          </span>
        </div>

        {reviewQueue.length === 0 ? (
          <div className="mt-4 rounded-2xl neumo-inset px-4 py-4 text-sm text-slate-500 dark:text-slate-300">
            {hasHistory
              ? 'No puzzles currently need review. Keep solving and this queue will refill as needed.'
              : 'Solve your first puzzle to start a spaced review queue.'}
          </div>
        ) : (
          <div
            className={`mt-4 space-y-3 ${
              reviewQueue.length > 4 ? 'max-h-[33rem] overflow-y-auto pr-1 scrollbar-auto-hide' : ''
            }`}
          >
            {reviewQueue.map((entry) => (
              <ReviewQueueItem
                key={entry.id}
                entry={entry}
                onRetry={() => handleRetryReviewItem(entry)}
                expandedReviewQueueId={expandedReviewQueueId}
                onToggleImage={(entryId) =>
                  setExpandedReviewQueueId((previous) => (previous === entryId ? null : entryId))
                }
                buttonStyle={buttonStyle}
              />
            ))}
          </div>
        )}
      </section>

      {session.status === 'active' && (
        <section className="rounded-2xl neumo-inset px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm text-slate-700 dark:text-slate-100">
              <span className="font-semibold">Training session active:</span>{' '}
              {session.source === 'daily'
                ? "Today's plan"
                : session.source === 'weakness'
                ? 'Weakness drill'
                : 'Review queue retry'}
            </div>
            <button
              type="button"
              onClick={openSolver}
              className="inline-flex items-center gap-1.5 rounded-full neumo-pill px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-100"
              style={buttonStyle}
            >
              <Play className="h-3.5 w-3.5" />
              Continue in solver
            </button>
          </div>
        </section>
      )}

      {!hasHistory && !submissionsLoading && (
        <section className="rounded-2xl neumo-inset px-4 py-3 text-sm text-slate-600 dark:text-slate-200">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 text-slate-400" />
            <p>
              Starter mode is active because no puzzle attempts were found. Once you solve puzzles, this tab will
              automatically personalize daily plans, weaknesses, adaptive level, and the review queue.
            </p>
          </div>
        </section>
      )}
    </div>
  );
}
