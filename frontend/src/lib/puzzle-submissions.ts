import {
  buildScopedStorageKey,
  readScopedStorageValue,
  resolveUserSettingsScope,
  writeScopedStorageValue,
} from './dashboard-theme-settings';

export type SubmissionPositionCheck = {
  sideToMove: 'white' | 'black' | null;
  confidence: number | null;
  attemptsUsed: number | null;
  mateFound: boolean | null;
  mateIn: number | null;
};

export type FirstMoveAssessmentStatus = 'correct' | 'incorrect' | 'almost_correct';

export type FirstMoveAssessmentRecord = {
  firstMove: string;
  bestMove: string | null;
  isFirstMoveCorrect: boolean;
  status: FirstMoveAssessmentStatus;
  timeToFirstMoveSeconds: number;
  puzzleId: string;
  userId: string | null;
  attemptId: string;
  createdAt: string;
  isValidForFirstMoveAccuracy: boolean;
  invalidReason: string | null;
};

export type PuzzleSubmissionRecord = {
  id: string;
  fileName: string;
  submittedAt: string;
  expectedSideToMove: 'white' | 'black';
  fen?: string | null;
  solveTimeMs?: number | null;
  puzzleElo?: number | null;
  difficultyRating?: number | null;
  estimatedDifficultyRating?: number | null;
  originalPuzzleImageDataUrl?: string | null;
  positionCheck: SubmissionPositionCheck;
  solutionLines: string[];
  firstMoveAssessment?: FirstMoveAssessmentRecord | null;
};

type NewPuzzleSubmissionRecord = Omit<PuzzleSubmissionRecord, 'id' | 'submittedAt'>;

const STORAGE_KEY = 'chessapp.puzzle-submissions.v1';
const SEEN_COUNT_STORAGE_KEY = 'chessapp.puzzle-submissions.seen-count.v1';
const UPDATE_EVENT = 'chessapp:puzzle-submissions-updated';
const MAX_STORED_SUBMISSIONS = 500;

function resolvePuzzleSubmissionStorageScope(): string | null {
  return resolveUserSettingsScope(null);
}

function removeScopedPuzzleSubmissionValue(baseKey: string): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.removeItem(
    buildScopedStorageKey(baseKey, resolvePuzzleSubmissionStorageScope()),
  );
}

function createId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

function isPositionCheck(value: unknown): value is SubmissionPositionCheck {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  const sideValid =
    candidate.sideToMove === null ||
    candidate.sideToMove === 'white' ||
    candidate.sideToMove === 'black';
  const confidenceValid =
    candidate.confidence === null || typeof candidate.confidence === 'number';
  const attemptsValid =
    candidate.attemptsUsed === null || typeof candidate.attemptsUsed === 'number';
  const mateFoundValid =
    candidate.mateFound === null || typeof candidate.mateFound === 'boolean';
  const mateInValid = candidate.mateIn === null || typeof candidate.mateIn === 'number';

  return sideValid && confidenceValid && attemptsValid && mateFoundValid && mateInValid;
}

function isSubmissionRecord(value: unknown): value is PuzzleSubmissionRecord {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.fileName === 'string' &&
    typeof candidate.submittedAt === 'string' &&
    (candidate.expectedSideToMove === 'white' || candidate.expectedSideToMove === 'black') &&
    (candidate.fen === undefined || candidate.fen === null || typeof candidate.fen === 'string') &&
    (candidate.solveTimeMs === undefined ||
      candidate.solveTimeMs === null ||
      (typeof candidate.solveTimeMs === 'number' &&
        Number.isFinite(candidate.solveTimeMs) &&
        candidate.solveTimeMs >= 0)) &&
    (candidate.puzzleElo === undefined ||
      candidate.puzzleElo === null ||
      (typeof candidate.puzzleElo === 'number' &&
        Number.isFinite(candidate.puzzleElo) &&
        candidate.puzzleElo >= 100 &&
        candidate.puzzleElo <= 4000)) &&
    (candidate.difficultyRating === undefined ||
      candidate.difficultyRating === null ||
      (typeof candidate.difficultyRating === 'number' &&
        Number.isFinite(candidate.difficultyRating) &&
        candidate.difficultyRating >= 100 &&
        candidate.difficultyRating <= 4000)) &&
    (candidate.estimatedDifficultyRating === undefined ||
      candidate.estimatedDifficultyRating === null ||
      (typeof candidate.estimatedDifficultyRating === 'number' &&
        Number.isFinite(candidate.estimatedDifficultyRating) &&
        candidate.estimatedDifficultyRating >= 100 &&
        candidate.estimatedDifficultyRating <= 4000)) &&
    (candidate.originalPuzzleImageDataUrl === undefined ||
      candidate.originalPuzzleImageDataUrl === null ||
      typeof candidate.originalPuzzleImageDataUrl === 'string') &&
    (candidate.firstMoveAssessment === undefined ||
      candidate.firstMoveAssessment === null ||
      isFirstMoveAssessmentRecord(candidate.firstMoveAssessment)) &&
    Array.isArray(candidate.solutionLines) &&
    candidate.solutionLines.every((line) => typeof line === 'string') &&
    isPositionCheck(candidate.positionCheck)
  );
}

function isFirstMoveAssessmentRecord(value: unknown): value is FirstMoveAssessmentRecord {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  const statusValid =
    candidate.status === 'correct' ||
    candidate.status === 'incorrect' ||
    candidate.status === 'almost_correct';

  return (
    typeof candidate.firstMove === 'string' &&
    (candidate.bestMove === null || typeof candidate.bestMove === 'string') &&
    typeof candidate.isFirstMoveCorrect === 'boolean' &&
    statusValid &&
    typeof candidate.timeToFirstMoveSeconds === 'number' &&
    Number.isFinite(candidate.timeToFirstMoveSeconds) &&
    candidate.timeToFirstMoveSeconds >= 0 &&
    typeof candidate.puzzleId === 'string' &&
    (candidate.userId === null || typeof candidate.userId === 'string') &&
    typeof candidate.attemptId === 'string' &&
    typeof candidate.createdAt === 'string' &&
    typeof candidate.isValidForFirstMoveAccuracy === 'boolean' &&
    (candidate.invalidReason === null || typeof candidate.invalidReason === 'string')
  );
}

function tokenizeMoves(solutionLines: string[]): number {
  return solutionLines
    .join(' ')
    .split(/\s+/)
    .filter((token) => token.trim().length > 0).length;
}

export function estimatePuzzleElo(input: {
  solveTimeMs?: number | null;
  mateIn?: number | null;
  confidence?: number | null;
  attemptsUsed?: number | null;
  solutionLines: string[];
}): number {
  let elo = 900;

  const moveTokens = tokenizeMoves(input.solutionLines);
  const extraMoveComplexity = Math.max(0, moveTokens - 2);
  elo += Math.min(420, extraMoveComplexity * 55);

  if (typeof input.mateIn === 'number' && Number.isFinite(input.mateIn)) {
    elo += Math.max(0, input.mateIn - 1) * 150;
  }

  if (typeof input.solveTimeMs === 'number' && Number.isFinite(input.solveTimeMs)) {
    const solveSeconds = input.solveTimeMs / 1000;
    const timeFactor = Math.max(0, solveSeconds - 15);
    elo += Math.min(500, Math.round(timeFactor * 2.8));
  }

  if (typeof input.attemptsUsed === 'number' && Number.isFinite(input.attemptsUsed)) {
    elo += Math.max(0, input.attemptsUsed - 1) * 35;
  }

  if (typeof input.confidence === 'number' && Number.isFinite(input.confidence)) {
    const normalized = Math.max(0, Math.min(1, input.confidence));
    elo += Math.round((1 - normalized) * 120);
  }

  const clamped = Math.max(600, Math.min(2600, elo));
  return Math.round(clamped / 10) * 10;
}

function emitUpdateEvent() {
  if (typeof window === 'undefined') {
    return;
  }
  window.dispatchEvent(new Event(UPDATE_EVENT));
}

export function getPuzzleSubmissionUpdateEventName() {
  return UPDATE_EVENT;
}

export function readPuzzleSubmissions(): PuzzleSubmissionRecord[] {
  if (typeof window === 'undefined') {
    return [];
  }

  const raw = readScopedStorageValue(STORAGE_KEY, resolvePuzzleSubmissionStorageScope());
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isSubmissionRecord);
  } catch {
    return [];
  }
}

export function getSeenPuzzleSubmissionCount(): number {
  if (typeof window === 'undefined') {
    return 0;
  }

  const raw = readScopedStorageValue(
    SEEN_COUNT_STORAGE_KEY,
    resolvePuzzleSubmissionStorageScope(),
  );
  if (!raw) {
    return 0;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }

  return Math.floor(parsed);
}

export function getUnseenPuzzleSubmissionCount(): number {
  const total = readPuzzleSubmissions().length;
  const seen = getSeenPuzzleSubmissionCount();
  return Math.max(0, total - seen);
}

export function markPuzzleSubmissionNotificationsSeen(totalSubmissionCount: number): number {
  if (typeof window === 'undefined') {
    return 0;
  }

  const normalizedTotal = Math.max(0, Math.floor(totalSubmissionCount));
  const currentSeen = getSeenPuzzleSubmissionCount();
  if (currentSeen === normalizedTotal) {
    return 0;
  }

  writeScopedStorageValue(
    SEEN_COUNT_STORAGE_KEY,
    resolvePuzzleSubmissionStorageScope(),
    String(normalizedTotal),
  );
  emitUpdateEvent();
  return Math.max(0, normalizedTotal - currentSeen);
}

export function addPuzzleSubmission(
  submission: NewPuzzleSubmissionRecord,
): PuzzleSubmissionRecord[] {
  if (typeof window === 'undefined') {
    return [];
  }

  const existing = readPuzzleSubmissions();
  const nextRecord: PuzzleSubmissionRecord = {
    ...submission,
    id: createId(),
    submittedAt: new Date().toISOString(),
  };

  const next = [nextRecord, ...existing].slice(0, MAX_STORED_SUBMISSIONS);
  let persisted = next;

  while (persisted.length > 0) {
    try {
      writeScopedStorageValue(
        STORAGE_KEY,
        resolvePuzzleSubmissionStorageScope(),
        JSON.stringify(persisted),
      );
      emitUpdateEvent();
      return persisted;
    } catch {
      const oldestIndex = persisted.length - 1;
      const oldest = persisted[oldestIndex];
      if (oldest?.originalPuzzleImageDataUrl) {
        persisted = [
          ...persisted.slice(0, oldestIndex),
          { ...oldest, originalPuzzleImageDataUrl: null },
        ];
        continue;
      }
      persisted = persisted.slice(0, oldestIndex);
    }
  }

  try {
    removeScopedPuzzleSubmissionValue(STORAGE_KEY);
  } catch {
    // Ignore storage failures; submissions will be rebuilt from new solves.
  }
  emitUpdateEvent();
  return [];
}

export function replacePuzzleSubmissions(
  submissions: PuzzleSubmissionRecord[],
): PuzzleSubmissionRecord[] {
  if (typeof window === 'undefined') {
    return [];
  }

  const existing = readPuzzleSubmissions();
  const existingImageById = new Map<string, string>();
  const existingImageByAttemptId = new Map<string, string>();
  const existingImageByFingerprint = new Map<string, string>();

  const getSubmissionImageDataUrl = (value: PuzzleSubmissionRecord): string | null => {
    if (
      typeof value.originalPuzzleImageDataUrl === 'string' &&
      value.originalPuzzleImageDataUrl.startsWith('data:image/')
    ) {
      return value.originalPuzzleImageDataUrl;
    }
    return null;
  };

  const getSubmissionAttemptId = (value: PuzzleSubmissionRecord): string | null => {
    const candidate = value.firstMoveAssessment?.attemptId;
    return typeof candidate === 'string' && candidate.trim().length > 0 ? candidate.trim() : null;
  };

  const buildSubmissionFingerprint = (value: PuzzleSubmissionRecord): string => {
    const solveTimeSegment =
      typeof value.solveTimeMs === 'number' && Number.isFinite(value.solveTimeMs)
        ? String(Math.round(value.solveTimeMs))
        : '';
    const linesSegment = Array.isArray(value.solutionLines) ? value.solutionLines.join('|') : '';
    return [
      value.fileName.trim().toLowerCase(),
      value.expectedSideToMove,
      (value.fen ?? '').trim(),
      solveTimeSegment,
      linesSegment,
    ].join('::');
  };

  for (const submission of existing) {
    const imageDataUrl = getSubmissionImageDataUrl(submission);
    if (!imageDataUrl) {
      continue;
    }

    existingImageById.set(submission.id, imageDataUrl);

    const attemptId = getSubmissionAttemptId(submission);
    if (attemptId) {
      existingImageByAttemptId.set(attemptId, imageDataUrl);
    }

    const fingerprint = buildSubmissionFingerprint(submission);
    if (!existingImageByFingerprint.has(fingerprint)) {
      existingImageByFingerprint.set(fingerprint, imageDataUrl);
    }
  }

  const normalized = submissions
    .filter(isSubmissionRecord)
    .map((submission) => {
      const incomingImage = getSubmissionImageDataUrl(submission);
      if (incomingImage) {
        return submission;
      }

      const attemptId = getSubmissionAttemptId(submission);
      const mergedImage =
        existingImageById.get(submission.id) ??
        (attemptId ? existingImageByAttemptId.get(attemptId) : undefined) ??
        existingImageByFingerprint.get(buildSubmissionFingerprint(submission));

      if (!mergedImage) {
        return submission;
      }

      return {
        ...submission,
        originalPuzzleImageDataUrl: mergedImage,
      };
    })
    .sort((a, b) => {
      const left = Date.parse(a.submittedAt);
      const right = Date.parse(b.submittedAt);
      return Number.isFinite(right - left) ? right - left : 0;
    })
    .slice(0, MAX_STORED_SUBMISSIONS);

  try {
    writeScopedStorageValue(
      STORAGE_KEY,
      resolvePuzzleSubmissionStorageScope(),
      JSON.stringify(normalized),
    );
  } catch {
    // Keep local history untouched if storage is unavailable.
    return readPuzzleSubmissions();
  }

  emitUpdateEvent();
  return normalized;
}
