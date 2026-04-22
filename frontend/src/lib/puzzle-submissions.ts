export type SubmissionPositionCheck = {
  sideToMove: 'white' | 'black' | null;
  confidence: number | null;
  attemptsUsed: number | null;
  mateFound: boolean | null;
  mateIn: number | null;
};

export type PuzzleSubmissionRecord = {
  id: string;
  fileName: string;
  submittedAt: string;
  expectedSideToMove: 'white' | 'black';
  solveTimeMs?: number | null;
  puzzleElo?: number | null;
  positionCheck: SubmissionPositionCheck;
  solutionLines: string[];
};

type NewPuzzleSubmissionRecord = Omit<PuzzleSubmissionRecord, 'id' | 'submittedAt'>;

const STORAGE_KEY = 'chessapp.puzzle-submissions.v1';
const SEEN_COUNT_STORAGE_KEY = 'chessapp.puzzle-submissions.seen-count.v1';
const UPDATE_EVENT = 'chessapp:puzzle-submissions-updated';
const MAX_STORED_SUBMISSIONS = 500;

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
    Array.isArray(candidate.solutionLines) &&
    candidate.solutionLines.every((line) => typeof line === 'string') &&
    isPositionCheck(candidate.positionCheck)
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

  const raw = window.localStorage.getItem(STORAGE_KEY);
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

  const raw = window.localStorage.getItem(SEEN_COUNT_STORAGE_KEY);
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

  window.localStorage.setItem(SEEN_COUNT_STORAGE_KEY, String(normalizedTotal));
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
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  emitUpdateEvent();
  return next;
}
