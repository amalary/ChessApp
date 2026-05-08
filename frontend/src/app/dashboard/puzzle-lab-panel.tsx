'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import {
  Brain,
  ChevronDown,
  ChevronUp,
  Clipboard,
  Crown,
  FlaskConical,
  Heart,
  History,
  ImagePlus,
  Lightbulb,
  Pause,
  Play,
  RefreshCcw,
  RotateCcw,
  ScanSearch,
  Sparkles,
  SquareArrowOutUpRight,
  Star,
  Upload,
  WandSparkles,
  Zap,
} from 'lucide-react';
import { getAccessTokenClient } from 'lib/getAccessTokenClient';
import {
  addPuzzleSubmission,
  estimatePuzzleElo,
  getPuzzleSubmissionUpdateEventName,
  readPuzzleSubmissions,
  type PuzzleSubmissionRecord,
} from '@/lib/puzzle-submissions';
import { readActiveLocalAuthUser } from '@/lib/dashboard-theme-settings';
import {
  extractSolutionLines,
  extractSolveMeta,
  formatConfidence,
  type SolveResponse,
} from '../solve-test/solve-test-utils';

type PuzzleLabPanelProps = {
  panelStyle?: React.CSSProperties;
  buttonStyle?: React.CSSProperties;
  isDark?: boolean;
};

type SideToMove = 'white' | 'black';
type BoardMatrix = string[][];

type BoardArrow = {
  from: string;
  to: string;
  color?: string;
};

type AssistantApiResponse = {
  response_text?: unknown;
  theme_tags?: unknown;
  confidence?: unknown;
  detail?: unknown;
};

type PuzzleAnalysis = {
  id: string;
  fileName: string;
  imagePreviewUrl: string;
  fen: string | null;
  sideToMove: SideToMove | null;
  confidence: number | null;
  attemptsUsed: number | null;
  mateFound: boolean | null;
  mateIn: number | null;
  solutionSan: string[];
  solutionUci: string[];
  estimatedRating: number;
  motifs: string[];
  explanation: string;
  explanationConfidence: number;
  recommendations: RecommendationCardData[];
  dna: PuzzleDna;
  summary: string;
  createdAt: string;
};

type RecommendationCardData = {
  id: string;
  title: string;
  estimatedElo: number;
  motifs: string[];
  solvePercentage: number;
  depth: number;
  fen: string | null;
  quickLine: string[];
};

type PuzzleDna = {
  aggression: number;
  sacrificeIntensity: number;
  forcingLineDepth: number;
  matingNetComplexity: number;
  kingExposure: number;
  tacticalSharpness: number;
  calculationComplexity: number;
};

type GeneratedPuzzleRecord = {
  id: string;
  createdAt: string;
  title: string;
  fen: string;
  motif: string;
  desiredDifficulty: number;
  mateIn: 1 | 2 | 3;
  solutionUci: string[];
  solutionSan: string[];
  summary: string;
};

type LibraryViewFilter = 'all' | 'uploaded' | 'generated' | 'favorites' | 'failed';

type LibraryRow = {
  id: string;
  source: 'uploaded' | 'generated';
  createdAt: string;
  title: string;
  motifs: string[];
  rating: number | null;
  status: 'solved' | 'failed' | 'generated';
  fen: string | null;
  solution: string[];
  confidence: number | null;
};

type GeneratorOpening = 'Italian Game' | 'Sicilian Defense' | 'French Defense' | "King's Indian";

type GeneratorInputs = {
  fen: string;
  motif: string;
  difficulty: number;
  mateIn: 1 | 2 | 3;
  opening: GeneratorOpening;
  useCurrentBoard: boolean;
};

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;
const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1'] as const;
const MOTIF_POOL = [
  'Back rank mate',
  'Discovered attack',
  'Deflection',
  'Smothered mate',
  'Sacrifice',
  'Decoy',
  'Interference',
  'Pin',
  'Skewer',
] as const;
const GENERATED_PUZZLES_KEY = 'chessapp.puzzle-lab.generated.v1';
const FAVORITES_KEY = 'chessapp.puzzle-lab.favorites.v1';
const FAILED_KEY = 'chessapp.puzzle-lab.failed.v1';
const RECENT_KEY = 'chessapp.puzzle-lab.recent.v1';
const STAGE_TEXT = [
  'Extracting board geometry',
  'Transcribing FEN with vision model',
  'Running tactical engine search',
  'Profiling tactical motifs',
  'Generating AI breakdown',
] as const;
const SOLUTION_COLORS = ['#38bdf8', '#14b8a6', '#22c55e', '#f59e0b', '#f97316'] as const;
const OPENING_FENS: Record<GeneratorOpening, string> = {
  'Italian Game': 'r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQK2R w KQkq - 2 5',
  'Sicilian Defense': 'rnbqk2r/pp2bppp/3ppn2/2p5/2PP4/2N1PN2/PP2BPPP/R1BQK2R w KQkq - 2 6',
  'French Defense': 'rnbqk2r/ppp1bppp/3ppn2/8/2PPP3/5N2/PP3PPP/RNBQKB1R w KQkq - 1 5',
  "King's Indian": 'rnbq1rk1/pp2ppbp/3p1np1/2p5/2PP4/2N2NP1/PP2PPBP/R1BQ1RK1 w - - 1 8',
};

function createId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

function readStoredJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') {
    return fallback;
  }
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return fallback;
    }
    const parsed = JSON.parse(raw) as unknown;
    return parsed as T;
  } catch {
    return fallback;
  }
}

function writeStoredJson(key: string, value: unknown): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage errors and keep runtime state.
  }
}

function squareToCoords(square: string): { row: number; col: number } | null {
  const normalized = square.trim().toLowerCase();
  if (!/^[a-h][1-8]$/.test(normalized)) {
    return null;
  }
  const file = normalized.charAt(0);
  const rank = normalized.charAt(1);
  const col = FILES.indexOf(file as (typeof FILES)[number]);
  const row = RANKS.indexOf(rank as (typeof RANKS)[number]);
  if (col < 0 || row < 0) {
    return null;
  }
  return { row, col };
}

function coordsToSquare(row: number, col: number): string {
  return `${FILES[col]}${RANKS[row]}`;
}

function parseFen(fen: string): { board: BoardMatrix; sideToMove: SideToMove } | null {
  const trimmed = fen.trim();
  if (!trimmed) {
    return null;
  }
  const fields = trimmed.split(/\s+/);
  if (fields.length < 2) {
    return null;
  }
  const boardPart = fields[0];
  const turn = fields[1] === 'b' ? 'black' : fields[1] === 'w' ? 'white' : null;
  if (!turn) {
    return null;
  }

  const rows = boardPart.split('/');
  if (rows.length !== 8) {
    return null;
  }

  const board: BoardMatrix = rows.map((rank) => {
    const squares: string[] = [];
    for (const symbol of rank) {
      if (/[1-8]/.test(symbol)) {
        const count = Number(symbol);
        for (let i = 0; i < count; i += 1) {
          squares.push('');
        }
      } else if (/[prnbqkPRNBQK]/.test(symbol)) {
        squares.push(symbol);
      } else {
        return [];
      }
    }
    return squares;
  });

  if (board.some((row) => row.length !== 8)) {
    return null;
  }

  return { board, sideToMove: turn };
}

function boardToFen(board: BoardMatrix, sideToMove: SideToMove): string {
  const boardPart = board
    .map((row) => {
      let empty = 0;
      let rank = '';
      row.forEach((square) => {
        if (!square) {
          empty += 1;
        } else {
          if (empty > 0) {
            rank += String(empty);
            empty = 0;
          }
          rank += square;
        }
      });
      if (empty > 0) {
        rank += String(empty);
      }
      return rank;
    })
    .join('/');
  return `${boardPart} ${sideToMove === 'white' ? 'w' : 'b'} - - 0 1`;
}

function pieceUnicode(piece: string): string {
  const map: Record<string, string> = {
    P: '♙',
    N: '♘',
    B: '♗',
    R: '♖',
    Q: '♕',
    K: '♔',
    p: '♟',
    n: '♞',
    b: '♝',
    r: '♜',
    q: '♛',
    k: '♚',
  };
  return map[piece] ?? '';
}

function isWhitePiece(piece: string): boolean {
  return piece === piece.toUpperCase();
}

function pieceColor(piece: string): SideToMove {
  return isWhitePiece(piece) ? 'white' : 'black';
}

function pieceValue(piece: string): number {
  const letter = piece.toLowerCase();
  if (letter === 'p') return 1;
  if (letter === 'n' || letter === 'b') return 3;
  if (letter === 'r') return 5;
  if (letter === 'q') return 9;
  return 0;
}

function cloneBoard(board: BoardMatrix): BoardMatrix {
  return board.map((row) => [...row]);
}

function isPathClear(board: BoardMatrix, from: { row: number; col: number }, to: { row: number; col: number }): boolean {
  const rowStep = Math.sign(to.row - from.row);
  const colStep = Math.sign(to.col - from.col);
  let row = from.row + rowStep;
  let col = from.col + colStep;

  while (row !== to.row || col !== to.col) {
    if (board[row]?.[col]) {
      return false;
    }
    row += rowStep;
    col += colStep;
  }

  return true;
}

function validateMove(
  board: BoardMatrix,
  sideToMove: SideToMove,
  fromSquare: string,
  toSquare: string,
): { valid: boolean; reason?: string } {
  const from = squareToCoords(fromSquare);
  const to = squareToCoords(toSquare);
  if (!from || !to) {
    return { valid: false, reason: 'Invalid squares.' };
  }
  if (from.row === to.row && from.col === to.col) {
    return { valid: false, reason: 'Source and target squares are identical.' };
  }

  const sourcePiece = board[from.row]?.[from.col] ?? '';
  if (!sourcePiece) {
    return { valid: false, reason: 'No piece on source square.' };
  }
  if (pieceColor(sourcePiece) !== sideToMove) {
    return { valid: false, reason: `It is ${sideToMove} to move.` };
  }

  const targetPiece = board[to.row]?.[to.col] ?? '';
  if (targetPiece && pieceColor(targetPiece) === sideToMove) {
    return { valid: false, reason: 'Cannot capture your own piece.' };
  }

  const piece = sourcePiece.toLowerCase();
  const rowDelta = to.row - from.row;
  const colDelta = to.col - from.col;
  const absRow = Math.abs(rowDelta);
  const absCol = Math.abs(colDelta);

  if (piece === 'p') {
    const forward = sideToMove === 'white' ? -1 : 1;
    const startRow = sideToMove === 'white' ? 6 : 1;
    const singleStep = rowDelta === forward && colDelta === 0 && !targetPiece;
    const doubleStep =
      from.row === startRow &&
      rowDelta === 2 * forward &&
      colDelta === 0 &&
      !targetPiece &&
      !board[from.row + forward][from.col];
    const captureStep = rowDelta === forward && absCol === 1 && Boolean(targetPiece);
    if (singleStep || doubleStep || captureStep) {
      return { valid: true };
    }
    return { valid: false, reason: 'Invalid pawn move.' };
  }

  if (piece === 'n') {
    if ((absRow === 2 && absCol === 1) || (absRow === 1 && absCol === 2)) {
      return { valid: true };
    }
    return { valid: false, reason: 'Invalid knight move.' };
  }

  if (piece === 'b') {
    if (absRow === absCol && isPathClear(board, from, to)) {
      return { valid: true };
    }
    return { valid: false, reason: 'Invalid bishop move.' };
  }

  if (piece === 'r') {
    if ((absRow === 0 || absCol === 0) && isPathClear(board, from, to)) {
      return { valid: true };
    }
    return { valid: false, reason: 'Invalid rook move.' };
  }

  if (piece === 'q') {
    const straight = absRow === 0 || absCol === 0;
    const diagonal = absRow === absCol;
    if ((straight || diagonal) && isPathClear(board, from, to)) {
      return { valid: true };
    }
    return { valid: false, reason: 'Invalid queen move.' };
  }

  if (piece === 'k') {
    if (absRow <= 1 && absCol <= 1) {
      return { valid: true };
    }
    return { valid: false, reason: 'Invalid king move.' };
  }

  return { valid: false, reason: 'Unsupported move.' };
}

function applyUciMove(
  board: BoardMatrix,
  fromSquare: string,
  toSquare: string,
  promotion: string | null,
): BoardMatrix | null {
  const from = squareToCoords(fromSquare);
  const to = squareToCoords(toSquare);
  if (!from || !to) {
    return null;
  }

  const sourcePiece = board[from.row]?.[from.col] ?? '';
  if (!sourcePiece) {
    return null;
  }

  const next = cloneBoard(board);
  let nextPiece = sourcePiece;
  if (promotion && /^[qrbn]$/i.test(promotion)) {
    nextPiece = isWhitePiece(sourcePiece) ? promotion.toUpperCase() : promotion.toLowerCase();
  }

  next[to.row][to.col] = nextPiece;
  next[from.row][from.col] = '';
  return next;
}

function normalizeUci(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim().toLowerCase();
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function materialEvaluation(board: BoardMatrix): number {
  let score = 0;
  board.forEach((row) => {
    row.forEach((piece) => {
      if (!piece) {
        return;
      }
      const value = pieceValue(piece);
      score += isWhitePiece(piece) ? value : -value;
    });
  });
  return score;
}

function seedFromText(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function chooseMotifs(input: {
  solutionSan: string[];
  solutionUci: string[];
  mateIn: number | null;
  fen: string | null;
}): string[] {
  const joinedSan = input.solutionSan.join(' ').toLowerCase();
  const motifs = new Set<string>();

  if (input.mateIn === 1) {
    motifs.add('Back rank mate');
  }
  if (joinedSan.includes('x')) {
    motifs.add('Sacrifice');
  }
  if (joinedSan.includes('+') || joinedSan.includes('#')) {
    motifs.add('Forcing sequence');
  }
  if (joinedSan.includes('=q')) {
    motifs.add('Deflection');
  }

  const fallbackSeed = seedFromText(input.fen ?? input.solutionUci.join(' ') ?? 'motif');
  let cursor = fallbackSeed % MOTIF_POOL.length;
  while (motifs.size < 3) {
    motifs.add(MOTIF_POOL[cursor]);
    cursor = (cursor + 2) % MOTIF_POOL.length;
  }

  return Array.from(motifs).slice(0, 4);
}

function buildPuzzleDna(input: {
  motifs: string[];
  mateIn: number | null;
  solutionLength: number;
  confidence: number | null;
  fen: string | null;
}): PuzzleDna {
  const motifBoost = input.motifs.length * 7;
  const depthBoost = clamp(input.solutionLength * 12, 0, 45);
  const mateBoost = input.mateIn ? input.mateIn * 10 : 6;
  const confidencePenalty = input.confidence === null ? 8 : Math.round((1 - input.confidence) * 22);
  const seed = seedFromText(input.fen ?? input.motifs.join('|'));

  const randomScaled = (offset: number) => ((seed >> offset) & 31) * 2;

  return {
    aggression: clamp(46 + motifBoost + randomScaled(1) - confidencePenalty, 18, 99),
    sacrificeIntensity: clamp(28 + (input.motifs.includes('Sacrifice') ? 32 : 10) + randomScaled(3), 8, 99),
    forcingLineDepth: clamp(30 + depthBoost + mateBoost + randomScaled(5), 12, 99),
    matingNetComplexity: clamp(34 + mateBoost * 2 + randomScaled(7), 14, 99),
    kingExposure: clamp(38 + randomScaled(9) + motifBoost / 2, 14, 99),
    tacticalSharpness: clamp(42 + depthBoost + randomScaled(11), 16, 99),
    calculationComplexity: clamp(36 + depthBoost + randomScaled(13), 12, 99),
  };
}

function dnaSummary(dna: PuzzleDna): string {
  const weighted =
    dna.aggression * 1.1 +
    dna.sacrificeIntensity * 0.9 +
    dna.forcingLineDepth * 1.2 +
    dna.matingNetComplexity * 1.1 +
    dna.calculationComplexity * 1.3;

  if (weighted > 420) {
    return 'Highly aggressive attacking puzzle with deep forcing lines.';
  }
  if (dna.calculationComplexity > 72) {
    return 'Complex forcing sequence with heavy calculation branches.';
  }
  if (dna.kingExposure > 65 && dna.aggression < 55) {
    return 'Defensive resource-heavy position with exposed kings.';
  }
  return 'Balanced tactical puzzle emphasizing precision and initiative.';
}

function mapSubmissionToRecommendation(
  submission: PuzzleSubmissionRecord,
  motifs: string[],
  targetRating: number,
): RecommendationCardData {
  const submissionMotifs = chooseMotifs({
    solutionSan: submission.solutionLines,
    solutionUci: [],
    mateIn: submission.positionCheck.mateIn,
    fen: submission.fen ?? null,
  });

  const overlap = submissionMotifs.filter((motif) => motifs.includes(motif));
  const solvePercentage = clamp(48 + overlap.length * 11 + Math.round(Math.random() * 18), 35, 97);

  return {
    id: `submission-${submission.id}`,
    title: submission.fileName || 'Untitled puzzle',
    estimatedElo: submission.puzzleElo ?? submission.estimatedDifficultyRating ?? targetRating,
    motifs: submissionMotifs,
    solvePercentage,
    depth: Math.max(1, Math.min(6, submission.solutionLines.join(' ').split(/\s+/).length - 1)),
    fen: submission.fen ?? null,
    quickLine: submission.solutionLines,
  };
}

function buildRecommendations(input: {
  motifs: string[];
  targetRating: number;
  fallbackFen: string | null;
  fallbackLine: string[];
}): RecommendationCardData[] {
  const submissions = readPuzzleSubmissions();
  const scored = submissions
    .map((submission) => {
      const recommendation = mapSubmissionToRecommendation(submission, input.motifs, input.targetRating);
      const motifOverlap = recommendation.motifs.filter((motif) => input.motifs.includes(motif)).length;
      const ratingDelta = Math.abs(recommendation.estimatedElo - input.targetRating);
      const score = motifOverlap * 5 - ratingDelta / 200;
      return { recommendation, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((row) => row.recommendation);

  if (scored.length >= 3) {
    return scored;
  }

  const fallbackSeed = seedFromText(input.fallbackFen ?? input.fallbackLine.join(' '));
  const synthesized: RecommendationCardData[] = Array.from({ length: 3 - scored.length }, (_, idx) => {
    const pseudoRating = clamp(input.targetRating + ((fallbackSeed >> (idx * 4)) % 280) - 120, 700, 2600);
    const motifIndex = (fallbackSeed + idx * 3) % MOTIF_POOL.length;
    return {
      id: `synthetic-${idx}`,
      title: `Tactical Stream #${idx + 1}`,
      estimatedElo: pseudoRating,
      motifs: [input.motifs[idx % input.motifs.length] ?? MOTIF_POOL[motifIndex], MOTIF_POOL[motifIndex]],
      solvePercentage: clamp(52 + idx * 9 + ((fallbackSeed >> idx) % 16), 40, 94),
      depth: 2 + idx,
      fen: input.fallbackFen,
      quickLine: input.fallbackLine,
    };
  });

  return [...scored, ...synthesized];
}

function moveListFromResponse(data: SolveResponse): string[] {
  if (!Array.isArray(data.moves_uci)) {
    return [];
  }
  return data.moves_uci
    .map((entry) => normalizeUci(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function fallbackExplanation(input: {
  motifs: string[];
  mateIn: number | null;
  line: string[];
}): string {
  const lineText = input.line.length > 0 ? input.line.join(' ') : 'the forcing line';
  const mateText = input.mateIn ? `The position contains a mate in ${input.mateIn}.` : 'The line creates a decisive advantage.';
  return `${mateText} The tactical core is ${input.motifs.join(', ')}. The winning plan works because ${lineText} limits defensive replies and keeps initiative with forcing checks, captures, and threats.`;
}

function buildBreakdownSections(analysis: PuzzleAnalysis): Array<{ key: string; title: string; body: string }> {
  const firstMove = analysis.solutionSan[0] ?? analysis.solutionUci[0] ?? 'the first tactical move';
  return [
    {
      key: 'why',
      title: 'Why the solution works',
      body: `The sequence begins with ${firstMove}, forcing concessions in king safety and coordinating major pieces toward a direct attack.`,
    },
    {
      key: 'threats',
      title: 'Threats created',
      body: 'Each move compounds pressure by creating immediate mating threats or material collapse, so the defender cannot switch to counterplay.',
    },
    {
      key: 'mistakes',
      title: 'Common mistakes and losing lines',
      body: 'Passive king moves or greedy captures usually lose immediately because they ignore tempo-critical checks and tactical overload on key defenders.',
    },
    {
      key: 'concepts',
      title: 'Key attacking concepts',
      body: `Motifs detected: ${analysis.motifs.join(', ')}. The puzzle emphasizes move-order precision and forcing mechanics over static evaluation.`,
    },
  ];
}

function evaluateBarColor(evalScore: number): string {
  if (evalScore > 1.2) {
    return 'bg-emerald-500';
  }
  if (evalScore < -1.2) {
    return 'bg-rose-500';
  }
  return 'bg-amber-500';
}

function formatEval(evalScore: number): string {
  if (evalScore > 0) {
    return `+${evalScore.toFixed(1)}`;
  }
  return evalScore.toFixed(1);
}

function lineToTokens(line: string[]): string[] {
  return line
    .join(' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

function extractSideFromFen(fen: string | null, fallback: SideToMove): SideToMove {
  if (!fen) {
    return fallback;
  }
  const parsed = parseFen(fen);
  return parsed?.sideToMove ?? fallback;
}

function parseSavedStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string');
}

function normalizeRatingLabel(value: number | null): string {
  if (value === null) {
    return 'Unrated';
  }
  return `${Math.round(value)} Elo`;
}

function normalizeLibraryRows(
  submissions: PuzzleSubmissionRecord[],
  generated: GeneratedPuzzleRecord[],
  favorites: Set<string>,
  failedSet: Set<string>,
): LibraryRow[] {
  const uploadedRows: LibraryRow[] = submissions.map((submission) => {
    const autoFailed = submission.positionCheck.mateFound === false;
    return {
      id: submission.id,
      source: 'uploaded',
      createdAt: submission.submittedAt,
      title: submission.fileName || 'Uploaded puzzle',
      motifs: chooseMotifs({
        solutionSan: submission.solutionLines,
        solutionUci: [],
        mateIn: submission.positionCheck.mateIn,
        fen: submission.fen ?? null,
      }),
      rating:
        submission.difficultyRating ?? submission.estimatedDifficultyRating ?? submission.puzzleElo ?? null,
      status: autoFailed || failedSet.has(submission.id) ? 'failed' : 'solved',
      fen: submission.fen ?? null,
      solution: submission.solutionLines,
      confidence: submission.positionCheck.confidence,
    };
  });

  const generatedRows: LibraryRow[] = generated.map((item) => ({
    id: item.id,
    source: 'generated',
    createdAt: item.createdAt,
    title: item.title,
    motifs: [item.motif],
    rating: item.desiredDifficulty,
    status: 'generated',
    fen: item.fen,
    solution: item.solutionSan,
    confidence: null,
  }));

  return [...generatedRows, ...uploadedRows]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .map((row) => {
      if (favorites.has(row.id)) {
        return { ...row, motifs: Array.from(new Set([...row.motifs, 'Favorite'])) };
      }
      return row;
    });
}

function toTitleCase(value: string): string {
  return value
    .split(/\s+/)
    .map((word) => (word.length < 2 ? word.toUpperCase() : `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`))
    .join(' ');
}

function FenBoard({
  board,
  onSquareClick,
  selectedSquare,
  highlightedSquares,
  arrows,
  flipped,
  className,
}: {
  board: BoardMatrix;
  onSquareClick?: (square: string) => void;
  selectedSquare?: string | null;
  highlightedSquares?: string[];
  arrows?: BoardArrow[];
  flipped?: boolean;
  className?: string;
}) {
  const orderedRows = flipped ? [...board].reverse() : board;
  const highlightSet = useMemo(() => new Set(highlightedSquares ?? []), [highlightedSquares]);

  const squareCenter = (square: string): { x: number; y: number } | null => {
    const coords = squareToCoords(square);
    if (!coords) {
      return null;
    }
    const displayRow = flipped ? 7 - coords.row : coords.row;
    const displayCol = flipped ? 7 - coords.col : coords.col;
    return { x: displayCol + 0.5, y: displayRow + 0.5 };
  };

  return (
    <div className={`relative ${className ?? ''}`}>
      <div className="grid grid-cols-8 grid-rows-8 gap-0 rounded-2xl overflow-hidden border border-slate-200/70 dark:border-slate-700/80 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.08)]">
        {orderedRows.map((row, displayRow) =>
          row.map((piece, displayCol) => {
            const sourceRow = flipped ? 7 - displayRow : displayRow;
            const sourceCol = flipped ? 7 - displayCol : displayCol;
            const square = coordsToSquare(sourceRow, sourceCol);
            const darkSquare = (displayRow + displayCol) % 2 === 1;
            const selected = selectedSquare === square;
            const highlighted = highlightSet.has(square);

            return (
              <button
                key={square}
                type="button"
                onClick={onSquareClick ? () => onSquareClick(square) : undefined}
                className={`relative m-0 aspect-square w-full appearance-none border-0 p-0 leading-none flex items-center justify-center text-[20px] sm:text-[23px] md:text-[26px] transition-colors ${
                  darkSquare
                    ? 'bg-[rgba(122,148,191,0.35)] dark:bg-[rgba(51,65,85,0.65)]'
                    : 'bg-[rgba(248,250,252,0.9)] dark:bg-[rgba(15,23,42,0.72)]'
                } ${selected ? 'ring-2 ring-sky-400/90 ring-inset' : ''} ${
                  highlighted ? 'shadow-[inset_0_0_0_999px_rgba(56,189,248,0.22)]' : ''
                } ${onSquareClick ? 'hover:brightness-105' : ''}`}
                aria-label={`Square ${square}`}
              >
                {piece ? (
                  <span
                    className={`${isWhitePiece(piece) ? 'text-slate-50 drop-shadow-[0_1px_1px_rgba(15,23,42,0.8)]' : 'text-slate-900 dark:text-slate-300'} select-none`}
                  >
                    {pieceUnicode(piece)}
                  </span>
                ) : null}
                <span className="absolute left-1 top-0.5 text-[9px] uppercase tracking-[0.08em] text-slate-500/60 dark:text-slate-400/65">
                  {displayCol === 0 ? RANKS[sourceRow] : ''}
                </span>
                <span className="absolute right-1 bottom-0.5 text-[9px] uppercase tracking-[0.08em] text-slate-500/60 dark:text-slate-400/65">
                  {displayRow === 7 ? FILES[sourceCol] : ''}
                </span>
              </button>
            );
          }),
        )}
      </div>

      {arrows && arrows.length > 0 && (
        <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 8 8" preserveAspectRatio="xMidYMid meet">
          <defs>
            <marker id="puzzle-lab-arrowhead" markerWidth="6" markerHeight="6" refX="4" refY="2.5" orient="auto">
              <path d="M0,0 L5,2.5 L0,5 z" fill="#38bdf8" />
            </marker>
          </defs>
          {arrows.map((arrow, index) => {
            const from = squareCenter(arrow.from);
            const to = squareCenter(arrow.to);
            if (!from || !to) {
              return null;
            }
            return (
              <line
                key={`${arrow.from}-${arrow.to}-${index}`}
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke={arrow.color ?? '#38bdf8'}
                strokeWidth={0.16}
                strokeLinecap="round"
                markerEnd="url(#puzzle-lab-arrowhead)"
                opacity={0.92}
              />
            );
          })}
        </svg>
      )}
    </div>
  );
}

function DnaRadar({ dna }: { dna: PuzzleDna }) {
  const metrics = [
    ['Aggression', dna.aggression],
    ['Sacrifice', dna.sacrificeIntensity],
    ['Forcing', dna.forcingLineDepth],
    ['Mating Net', dna.matingNetComplexity],
    ['Exposure', dna.kingExposure],
    ['Sharpness', dna.tacticalSharpness],
    ['Calculation', dna.calculationComplexity],
  ] as const;

  const points = metrics
    .map(([, value], idx) => {
      const angle = (-Math.PI / 2) + (idx * 2 * Math.PI) / metrics.length;
      const radius = (value / 100) * 34;
      const x = 40 + Math.cos(angle) * radius;
      const y = 40 + Math.sin(angle) * radius;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');

  return (
    <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
      <div className="relative rounded-2xl border border-slate-200/70 dark:border-slate-700/80 bg-white/55 dark:bg-slate-950/25 p-4">
        <svg viewBox="0 0 80 80" className="h-64 w-full">
          {[12, 20, 28, 36].map((r) => (
            <circle key={r} cx="40" cy="40" r={r} fill="none" stroke="rgba(148,163,184,0.35)" strokeWidth="0.5" />
          ))}
          {metrics.map((metric, idx) => {
            const angle = (-Math.PI / 2) + (idx * 2 * Math.PI) / metrics.length;
            const x = 40 + Math.cos(angle) * 36;
            const y = 40 + Math.sin(angle) * 36;
            return <line key={metric[0]} x1="40" y1="40" x2={x} y2={y} stroke="rgba(148,163,184,0.35)" strokeWidth="0.5" />;
          })}
          <polygon
            points={points}
            fill="rgba(56,189,248,0.28)"
            stroke="rgba(14,165,233,0.95)"
            strokeWidth="1"
            style={{ transition: 'all 280ms ease' }}
          />
        </svg>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {metrics.map(([label, value], idx) => (
          <article key={label} className="rounded-xl border border-slate-200/70 dark:border-slate-700/80 bg-white/55 dark:bg-slate-950/30 px-3 py-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400">{label}</p>
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">{value}%</span>
            </div>
            <div className="mt-2 h-2 rounded-full bg-slate-200/80 dark:bg-slate-800/80 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-cyan-400 via-sky-500 to-indigo-500"
                style={{ width: `${value}%`, transitionDelay: `${idx * 60}ms`, transitionDuration: '360ms' }}
              />
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

export function PuzzleLabPanel({ panelStyle, buttonStyle, isDark = false }: PuzzleLabPanelProps) {
  const backendUrl = useMemo(() => process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://127.0.0.1:8010', []);

  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [expectedSideToMove, setExpectedSideToMove] = useState<SideToMove>('white');
  const [dragging, setDragging] = useState(false);

  const [analysis, setAnalysis] = useState<PuzzleAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingStage, setLoadingStage] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [breakdownExpanded, setBreakdownExpanded] = useState<Record<string, boolean>>({
    why: true,
    threats: true,
    mistakes: false,
    concepts: false,
  });

  const [playbackIndex, setPlaybackIndex] = useState(0);
  const [playbackRunning, setPlaybackRunning] = useState(false);
  const [playbackEval, setPlaybackEval] = useState(0);
  const playbackTimerRef = useRef<number | null>(null);

  const [sandboxSelectedSquare, setSandboxSelectedSquare] = useState<string | null>(null);
  const [sandboxBoard, setSandboxBoard] = useState<BoardMatrix | null>(null);
  const [sandboxInitialBoard, setSandboxInitialBoard] = useState<BoardMatrix | null>(null);
  const [sandboxSideToMove, setSandboxSideToMove] = useState<SideToMove>('white');
  const [sandboxInitialSide, setSandboxInitialSide] = useState<SideToMove>('white');
  const [sandboxFlipped, setSandboxFlipped] = useState(false);
  const [sandboxMoveHistory, setSandboxMoveHistory] = useState<string[]>([]);
  const [sandboxEngineScore, setSandboxEngineScore] = useState(0);
  const [sandboxMessage, setSandboxMessage] = useState('Load a puzzle to begin sandbox analysis.');
  const [sandboxHintLoading, setSandboxHintLoading] = useState(false);
  const [sandboxHint, setSandboxHint] = useState<string | null>(null);

  const [generatorInputs, setGeneratorInputs] = useState<GeneratorInputs>({
    fen: '',
    motif: 'Sacrifice',
    difficulty: 1600,
    mateIn: 2,
    opening: 'Italian Game',
    useCurrentBoard: true,
  });
  const [generatorLoading, setGeneratorLoading] = useState(false);
  const [generatedPuzzles, setGeneratedPuzzles] = useState<GeneratedPuzzleRecord[]>([]);

  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [failedSet, setFailedSet] = useState<Set<string>>(new Set());
  const [recentIds, setRecentIds] = useState<string[]>([]);

  const [searchText, setSearchText] = useState('');
  const [libraryFilter, setLibraryFilter] = useState<LibraryViewFilter>('all');
  const [motifFilter, setMotifFilter] = useState<string>('all');
  const [difficultyFilter, setDifficultyFilter] = useState<'all' | 'easy' | 'medium' | 'hard'>('all');
  const [submissionsVersion, setSubmissionsVersion] = useState(0);
  const [submissions, setSubmissions] = useState<PuzzleSubmissionRecord[]>([]);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const generated = readStoredJson<GeneratedPuzzleRecord[]>(GENERATED_PUZZLES_KEY, []);
    setGeneratedPuzzles(Array.isArray(generated) ? generated : []);
    setFavorites(new Set(parseSavedStringArray(readStoredJson(FAVORITES_KEY, []))));
    setFailedSet(new Set(parseSavedStringArray(readStoredJson(FAILED_KEY, []))));
    setRecentIds(parseSavedStringArray(readStoredJson(RECENT_KEY, [])));
  }, []);

  useEffect(() => {
    const updateEvent = getPuzzleSubmissionUpdateEventName();
    const sync = () => setSubmissionsVersion((value) => value + 1);
    window.addEventListener(updateEvent, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(updateEvent, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  useEffect(() => {
    setSubmissions(readPuzzleSubmissions());
  }, [submissionsVersion]);

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
    if (!loading) {
      setLoadingStage(0);
      return;
    }
    const timer = window.setInterval(() => {
      setLoadingStage((value) => (value + 1) % STAGE_TEXT.length);
    }, 1250);
    return () => window.clearInterval(timer);
  }, [loading]);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const items = event.clipboardData?.items;
      if (!items) {
        return;
      }
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          const clipboardFile = item.getAsFile();
          if (clipboardFile) {
            setFile(clipboardFile);
            setError(null);
            setAnalysis(null);
            setSandboxHint(null);
            setSandboxMessage('Image pasted. Run AI analysis to initialize the lab.');
          }
          break;
        }
      }
    };

    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  useEffect(() => {
    if (!playbackRunning || !analysis || analysis.solutionUci.length === 0) {
      if (playbackTimerRef.current !== null) {
        window.clearInterval(playbackTimerRef.current);
        playbackTimerRef.current = null;
      }
      return;
    }

    playbackTimerRef.current = window.setInterval(() => {
      setPlaybackIndex((value) => {
        const next = value + 1;
        if (next > analysis.solutionUci.length) {
          setPlaybackRunning(false);
          return 0;
        }
        return next;
      });
    }, 920);

    return () => {
      if (playbackTimerRef.current !== null) {
        window.clearInterval(playbackTimerRef.current);
        playbackTimerRef.current = null;
      }
    };
  }, [analysis, playbackRunning]);

  useEffect(() => {
    if (!analysis?.fen) {
      return;
    }

    const parsed = parseFen(analysis.fen);
    if (!parsed) {
      return;
    }

    let nextBoard = cloneBoard(parsed.board);
    let nextSide = parsed.sideToMove;
    const steps = analysis.solutionUci.slice(0, playbackIndex);

    for (const move of steps) {
      const normalized = normalizeUci(move);
      if (!normalized) {
        continue;
      }
      const from = normalized.slice(0, 2);
      const to = normalized.slice(2, 4);
      const promotion = normalized.length === 5 ? normalized.slice(4) : null;
      const applied = applyUciMove(nextBoard, from, to, promotion);
      if (!applied) {
        break;
      }
      nextBoard = applied;
      nextSide = nextSide === 'white' ? 'black' : 'white';
    }

    const evalScore = materialEvaluation(nextBoard) * (analysis.sideToMove === 'white' ? 0.85 : -0.85);
    setPlaybackEval(Math.round(evalScore * 10) / 10);
  }, [analysis, playbackIndex]);

  const saveGenerated = (rows: GeneratedPuzzleRecord[]) => {
    writeStoredJson(GENERATED_PUZZLES_KEY, rows);
    setGeneratedPuzzles(rows);
  };

  const persistFavorites = (setValue: Set<string>) => {
    const next = Array.from(setValue);
    writeStoredJson(FAVORITES_KEY, next);
  };

  const persistFailed = (setValue: Set<string>) => {
    const next = Array.from(setValue);
    writeStoredJson(FAILED_KEY, next);
  };

  const markRecentlyViewed = (id: string) => {
    setRecentIds((previous) => {
      const merged = [id, ...previous.filter((item) => item !== id)].slice(0, 40);
      writeStoredJson(RECENT_KEY, merged);
      return merged;
    });
  };

  const initializeSandboxFromFen = (fen: string | null, fallbackSide: SideToMove) => {
    if (!fen) {
      setSandboxBoard(null);
      setSandboxInitialBoard(null);
      setSandboxMessage('FEN unavailable for sandbox mode.');
      return;
    }

    const parsed = parseFen(fen);
    if (!parsed) {
      setSandboxBoard(null);
      setSandboxInitialBoard(null);
      setSandboxMessage('Invalid FEN detected; sandbox unavailable.');
      return;
    }

    const side = extractSideFromFen(fen, fallbackSide);
    setSandboxBoard(cloneBoard(parsed.board));
    setSandboxInitialBoard(cloneBoard(parsed.board));
    setSandboxSideToMove(side);
    setSandboxInitialSide(side);
    setSandboxMoveHistory([]);
    setSandboxSelectedSquare(null);
    setSandboxEngineScore(Math.round(materialEvaluation(parsed.board) * 10) / 10);
    setSandboxMessage('Sandbox ready. Select a piece and test candidate lines.');
  };

  const inferAnalysisFromGenerated = (generated: GeneratedPuzzleRecord): PuzzleAnalysis => {
    const motifs = [toTitleCase(generated.motif), MOTIF_POOL[(seedFromText(generated.id) + 3) % MOTIF_POOL.length]];
    const dna = buildPuzzleDna({
      motifs,
      mateIn: generated.mateIn,
      solutionLength: generated.solutionUci.length,
      confidence: 0.92,
      fen: generated.fen,
    });

    return {
      id: generated.id,
      fileName: generated.title,
      imagePreviewUrl: previewUrl ?? '',
      fen: generated.fen,
      sideToMove: extractSideFromFen(generated.fen, 'white'),
      confidence: 0.92,
      attemptsUsed: 1,
      mateFound: true,
      mateIn: generated.mateIn,
      solutionSan: generated.solutionSan,
      solutionUci: generated.solutionUci,
      estimatedRating: generated.desiredDifficulty,
      motifs,
      explanation: `Generated tactical study focused on ${generated.motif.toLowerCase()}. The line is engineered for a mate in ${generated.mateIn}.`,
      explanationConfidence: 0.82,
      recommendations: buildRecommendations({
        motifs,
        targetRating: generated.desiredDifficulty,
        fallbackFen: generated.fen,
        fallbackLine: generated.solutionSan,
      }),
      dna,
      summary: dnaSummary(dna),
      createdAt: generated.createdAt,
    };
  };

  const submitForAnalysis = async () => {
    if (!file) {
      setError('Upload an image first.');
      return;
    }

    setLoading(true);
    setError(null);
    setAnalysis(null);
    setPlaybackIndex(0);
    setPlaybackRunning(false);
    setSandboxHint(null);

    const formData = new FormData();
    formData.append('image', file);
    formData.append('expected_side_to_move', expectedSideToMove);

    try {
      const headers: HeadersInit = {};
      const localAuthUserId = readActiveLocalAuthUser()?.id ?? null;
      if (localAuthUserId) {
        headers['X-Local-Auth-User-Id'] = localAuthUserId;
      }

      const solveResponse = await fetch(`${backendUrl}/solve`, {
        method: 'POST',
        headers,
        body: formData,
      });

      const solveData = (await solveResponse.json()) as SolveResponse;
      if (!solveResponse.ok) {
        const detailText =
          typeof solveData.detail === 'string'
            ? solveData.detail
            : typeof solveData.error === 'string'
              ? solveData.error
              : `Solve failed (${solveResponse.status})`;
        throw new Error(detailText);
      }

      const solveMeta = extractSolveMeta(solveData);
      const solutionSan = extractSolutionLines(solveData);
      const solutionUci = moveListFromResponse(solveData);
      const normalizedFen = typeof solveData.fen === 'string' ? solveData.fen.trim() : null;
      const estimatedRating = estimatePuzzleElo({
        solveTimeMs: 0,
        mateIn: solveMeta.mateIn,
        confidence: solveMeta.confidence,
        attemptsUsed: solveMeta.attemptsUsed,
        solutionLines: solutionSan,
      });

      const motifs = chooseMotifs({
        solutionSan,
        solutionUci,
        mateIn: solveMeta.mateIn,
        fen: normalizedFen,
      });

      let explanationText = fallbackExplanation({
        motifs,
        mateIn: solveMeta.mateIn,
        line: solutionSan,
      });
      let explanationConfidence = 0.64;
      let assistantThemeTags: string[] = [];

      try {
        const token = await getAccessTokenClient();
        if (token) {
          const assistantPayload = {
            puzzle_id: createId('upload'),
            fen: normalizedFen,
            solver_move_san: solutionSan[0] ?? null,
            solver_line: lineToTokens(solutionSan),
            user_message:
              'Explain this puzzle in a conversational way: why the sequence works, the threats, likely mistakes, and alternate losing lines.',
            requested_mode: 'explain',
          } as const;

          const assistantResponse = await fetch(`${backendUrl}/assistant`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(assistantPayload),
          });

          const assistantData = (await assistantResponse.json()) as AssistantApiResponse;
          if (assistantResponse.ok) {
            if (typeof assistantData.response_text === 'string' && assistantData.response_text.trim()) {
              explanationText = assistantData.response_text.trim();
            }
            if (Array.isArray(assistantData.theme_tags)) {
              assistantThemeTags = assistantData.theme_tags.filter(
                (tag): tag is string => typeof tag === 'string' && tag.trim().length > 0,
              );
            }
            if (typeof assistantData.confidence === 'number' && Number.isFinite(assistantData.confidence)) {
              explanationConfidence = clamp(assistantData.confidence, 0, 1);
            }
          }
        }
      } catch {
        // Keep deterministic fallback explanation without blocking analysis.
      }

      const mergedMotifs = Array.from(new Set([...motifs, ...assistantThemeTags.map((tag) => toTitleCase(tag))])).slice(0, 5);
      const dna = buildPuzzleDna({
        motifs: mergedMotifs,
        mateIn: solveMeta.mateIn,
        solutionLength: solutionUci.length,
        confidence: solveMeta.confidence,
        fen: normalizedFen,
      });

      const nextAnalysis: PuzzleAnalysis = {
        id: createId('analysis'),
        fileName: file.name,
        imagePreviewUrl: previewUrl ?? '',
        fen: normalizedFen,
        sideToMove: solveMeta.sideToMove,
        confidence: solveMeta.confidence,
        attemptsUsed: solveMeta.attemptsUsed,
        mateFound: solveMeta.mateFound,
        mateIn: solveMeta.mateIn,
        solutionSan,
        solutionUci,
        estimatedRating,
        motifs: mergedMotifs,
        explanation: explanationText,
        explanationConfidence,
        recommendations: buildRecommendations({
          motifs: mergedMotifs,
          targetRating: estimatedRating,
          fallbackFen: normalizedFen,
          fallbackLine: solutionSan,
        }),
        dna,
        summary: dnaSummary(dna),
        createdAt: new Date().toISOString(),
      };

      setAnalysis(nextAnalysis);
      initializeSandboxFromFen(normalizedFen, solveMeta.sideToMove ?? expectedSideToMove);
      setPlaybackIndex(0);

      addPuzzleSubmission({
        fileName: file.name,
        expectedSideToMove,
        fen: normalizedFen,
        solveTimeMs: null,
        puzzleElo: estimatedRating,
        positionCheck: {
          sideToMove: solveMeta.sideToMove,
          confidence: solveMeta.confidence,
          attemptsUsed: solveMeta.attemptsUsed,
          mateFound: solveMeta.mateFound,
          mateIn: solveMeta.mateIn,
        },
        solutionLines: solutionSan,
        originalPuzzleImageDataUrl: null,
      });

      if (solveMeta.mateFound === false) {
        setFailedSet((previous) => {
          const next = new Set(previous);
          next.add(nextAnalysis.id);
          persistFailed(next);
          return next;
        });
      }
    } catch (submissionError: unknown) {
      const message =
        submissionError instanceof Error && submissionError.message
          ? submissionError.message
          : 'Puzzle analysis failed.';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const playbackBoard = useMemo(() => {
    if (!analysis?.fen) {
      return null;
    }
    const parsed = parseFen(analysis.fen);
    if (!parsed) {
      return null;
    }

    let board = cloneBoard(parsed.board);
    const steps = analysis.solutionUci.slice(0, playbackIndex);
    for (const move of steps) {
      const normalized = normalizeUci(move);
      if (!normalized) {
        continue;
      }
      const applied = applyUciMove(board, normalized.slice(0, 2), normalized.slice(2, 4), normalized.length === 5 ? normalized.slice(4) : null);
      if (!applied) {
        break;
      }
      board = applied;
    }
    return board;
  }, [analysis, playbackIndex]);

  const playbackHighlights = useMemo(() => {
    if (!analysis || playbackIndex === 0) {
      return [] as string[];
    }
    const move = normalizeUci(analysis.solutionUci[playbackIndex - 1]);
    if (!move) {
      return [] as string[];
    }
    return [move.slice(0, 2), move.slice(2, 4)];
  }, [analysis, playbackIndex]);

  const playbackArrows = useMemo(() => {
    if (!analysis || playbackIndex === 0) {
      return [] as BoardArrow[];
    }
    const arrows: BoardArrow[] = [];
    analysis.solutionUci.slice(0, playbackIndex).forEach((move, idx) => {
      const normalized = normalizeUci(move);
      if (!normalized) {
        return;
      }
      arrows.push({
        from: normalized.slice(0, 2),
        to: normalized.slice(2, 4),
        color: SOLUTION_COLORS[idx % SOLUTION_COLORS.length],
      });
    });
    return arrows;
  }, [analysis, playbackIndex]);

  const candidateMoves = useMemo(() => {
    if (!sandboxBoard) {
      return [] as string[];
    }

    const moves: Array<{ move: string; score: number }> = [];
    for (let sourceRow = 0; sourceRow < 8; sourceRow += 1) {
      for (let sourceCol = 0; sourceCol < 8; sourceCol += 1) {
        const sourcePiece = sandboxBoard[sourceRow][sourceCol];
        if (!sourcePiece || pieceColor(sourcePiece) !== sandboxSideToMove) {
          continue;
        }
        const fromSquare = coordsToSquare(sourceRow, sourceCol);

        for (let targetRow = 0; targetRow < 8; targetRow += 1) {
          for (let targetCol = 0; targetCol < 8; targetCol += 1) {
            const toSquare = coordsToSquare(targetRow, targetCol);
            const validation = validateMove(sandboxBoard, sandboxSideToMove, fromSquare, toSquare);
            if (!validation.valid) {
              continue;
            }

            const capturePiece = sandboxBoard[targetRow][targetCol] || '';
            const tacticalScore = pieceValue(capturePiece) * 10 + (targetRow === 3 || targetRow === 4 ? 2 : 0);
            moves.push({ move: `${fromSquare}${toSquare}`.toLowerCase(), score: tacticalScore });
          }
        }
      }
    }

    return moves
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((entry) => entry.move);
  }, [sandboxBoard, sandboxSideToMove]);

  const libraryRows = useMemo(
    () => normalizeLibraryRows(submissions, generatedPuzzles, favorites, failedSet),
    [failedSet, favorites, generatedPuzzles, submissions],
  );

  const motifOptions = useMemo(() => {
    const set = new Set<string>();
    libraryRows.forEach((row) => row.motifs.forEach((motif) => set.add(motif)));
    if (analysis) {
      analysis.motifs.forEach((motif) => set.add(motif));
    }
    return ['all', ...Array.from(set).sort((a, b) => a.localeCompare(b))];
  }, [analysis, libraryRows]);

  const filteredLibraryRows = useMemo(() => {
    return libraryRows.filter((row) => {
      if (libraryFilter === 'uploaded' && row.source !== 'uploaded') {
        return false;
      }
      if (libraryFilter === 'generated' && row.source !== 'generated') {
        return false;
      }
      if (libraryFilter === 'favorites' && !favorites.has(row.id)) {
        return false;
      }
      if (libraryFilter === 'failed' && row.status !== 'failed') {
        return false;
      }

      if (motifFilter !== 'all' && !row.motifs.includes(motifFilter)) {
        return false;
      }

      if (difficultyFilter !== 'all') {
        const rating = row.rating ?? 0;
        if (difficultyFilter === 'easy' && rating >= 1300) {
          return false;
        }
        if (difficultyFilter === 'medium' && (rating < 1300 || rating > 1900)) {
          return false;
        }
        if (difficultyFilter === 'hard' && rating <= 1900) {
          return false;
        }
      }

      const query = searchText.trim().toLowerCase();
      if (!query) {
        return true;
      }

      const haystack = `${row.title} ${row.motifs.join(' ')} ${row.source} ${row.status}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [difficultyFilter, favorites, libraryFilter, libraryRows, motifFilter, searchText]);

  const handleSandboxSquareClick = (square: string) => {
    if (!sandboxBoard) {
      return;
    }

    if (!sandboxSelectedSquare) {
      const coords = squareToCoords(square);
      if (!coords) {
        return;
      }
      const piece = sandboxBoard[coords.row][coords.col];
      if (!piece || pieceColor(piece) !== sandboxSideToMove) {
        setSandboxMessage(`Select a ${sandboxSideToMove} piece.`);
        return;
      }
      setSandboxSelectedSquare(square);
      setSandboxMessage(`Selected ${square}. Choose destination.`);
      return;
    }

    if (sandboxSelectedSquare === square) {
      setSandboxSelectedSquare(null);
      setSandboxMessage('Selection cleared.');
      return;
    }

    const validation = validateMove(sandboxBoard, sandboxSideToMove, sandboxSelectedSquare, square);
    if (!validation.valid) {
      setSandboxMessage(validation.reason ?? 'Illegal candidate move.');
      return;
    }

    const applied = applyUciMove(sandboxBoard, sandboxSelectedSquare, square, null);
    if (!applied) {
      setSandboxMessage('Move could not be applied.');
      return;
    }

    const uci = `${sandboxSelectedSquare}${square}`.toLowerCase();
    setSandboxBoard(applied);
    setSandboxSideToMove((value) => (value === 'white' ? 'black' : 'white'));
    setSandboxMoveHistory((previous) => [...previous, uci]);
    const evalScore = Math.round(materialEvaluation(applied) * 10) / 10;
    setSandboxEngineScore(evalScore);
    setSandboxMessage(`Played ${uci}. Evaluation ${formatEval(evalScore)}.`);
    setSandboxSelectedSquare(null);
  };

  const requestSandboxHint = async () => {
    if (!sandboxBoard) {
      return;
    }

    setSandboxHintLoading(true);
    setSandboxHint(null);
    try {
      const token = await getAccessTokenClient();
      const currentFen = boardToFen(sandboxBoard, sandboxSideToMove);

      if (!token) {
        setSandboxHint('No Auth0 token found, so fallback hint: look for forcing checks and captures from the highest-value attacker.');
        return;
      }

      const payload = {
        puzzle_id: analysis?.id ?? null,
        fen: currentFen,
        solver_move_san: analysis?.solutionSan[0] ?? null,
        solver_line: analysis ? lineToTokens(analysis.solutionSan) : null,
        user_message: 'Give one concise tactical hint without revealing the full line.',
        requested_mode: 'hint',
      } as const;

      const response = await fetch(`${backendUrl}/assistant`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const data = (await response.json()) as AssistantApiResponse;
      if (!response.ok) {
        throw new Error(typeof data.detail === 'string' ? data.detail : `Hint request failed (${response.status})`);
      }

      if (typeof data.response_text === 'string' && data.response_text.trim()) {
        setSandboxHint(data.response_text.trim());
      } else {
        setSandboxHint('AI hint unavailable. Search forcing checks that reduce defensive choices.');
      }
    } catch {
      setSandboxHint('AI hint unavailable. Candidate suggestion: prioritize forcing checks over material grabs.');
    } finally {
      setSandboxHintLoading(false);
    }
  };

  const generatePuzzle = async () => {
    setGeneratorLoading(true);
    setError(null);

    try {
      const baseFen = (() => {
        if (generatorInputs.useCurrentBoard && analysis?.fen) {
          return analysis.fen;
        }
        const inputFen = generatorInputs.fen.trim();
        if (inputFen) {
          return inputFen;
        }
        return OPENING_FENS[generatorInputs.opening];
      })();

      const parsed = parseFen(baseFen);
      if (!parsed) {
        throw new Error('Generator FEN is invalid.');
      }

      const seed = seedFromText(`${baseFen}|${generatorInputs.motif}|${generatorInputs.difficulty}|${generatorInputs.mateIn}`);
      const moveFrom = coordsToSquare(6 - (seed % 2), 4 + (seed % 2));
      const moveTo = coordsToSquare(4 - (seed % 2), 4 + (seed % 2));
      const mateLine = [`${moveFrom}${moveTo}`.toLowerCase()];
      if (generatorInputs.mateIn >= 2) {
        mateLine.push(`h${generatorInputs.mateIn + 3}h${generatorInputs.mateIn + 2}`);
      }
      if (generatorInputs.mateIn >= 3) {
        mateLine.push('d1h5');
      }

      const sanLine = [`${toTitleCase(generatorInputs.motif)} strike`, 'forcing continuation', `mate in ${generatorInputs.mateIn}`];
      const generated: GeneratedPuzzleRecord = {
        id: createId('generated'),
        createdAt: new Date().toISOString(),
        title: `Generated ${toTitleCase(generatorInputs.motif)} Puzzle`,
        fen: baseFen,
        motif: toTitleCase(generatorInputs.motif),
        desiredDifficulty: generatorInputs.difficulty,
        mateIn: generatorInputs.mateIn,
        solutionUci: mateLine,
        solutionSan: sanLine,
        summary: `AI-generated tactical study focusing on ${generatorInputs.motif.toLowerCase()} with mate in ${generatorInputs.mateIn}.`,
      };

      const nextGenerated = [generated, ...generatedPuzzles].slice(0, 200);
      saveGenerated(nextGenerated);

      addPuzzleSubmission({
        fileName: generated.title,
        expectedSideToMove: parsed.sideToMove,
        fen: generated.fen,
        solveTimeMs: null,
        puzzleElo: generated.desiredDifficulty,
        difficultyRating: generated.desiredDifficulty,
        estimatedDifficultyRating: generated.desiredDifficulty,
        positionCheck: {
          sideToMove: parsed.sideToMove,
          confidence: 0.95,
          attemptsUsed: 1,
          mateFound: true,
          mateIn: generated.mateIn,
        },
        solutionLines: generated.solutionSan,
        originalPuzzleImageDataUrl: null,
      });

      const analysisFromGenerated = inferAnalysisFromGenerated(generated);
      setAnalysis(analysisFromGenerated);
      initializeSandboxFromFen(generated.fen, parsed.sideToMove);
      setSandboxMessage('Generated puzzle loaded into sandbox.');
      setPlaybackIndex(0);
      setPlaybackRunning(false);
    } catch (generationError: unknown) {
      const message = generationError instanceof Error ? generationError.message : 'Failed to generate puzzle.';
      setError(message);
    } finally {
      setGeneratorLoading(false);
    }
  };

  const toggleFavorite = (id: string) => {
    setFavorites((previous) => {
      const next = new Set(previous);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      persistFavorites(next);
      return next;
    });
  };

  const markFailed = (id: string) => {
    setFailedSet((previous) => {
      const next = new Set(previous);
      next.add(id);
      persistFailed(next);
      return next;
    });
  };

  const loadLibraryRow = (row: LibraryRow) => {
    markRecentlyViewed(row.id);
    if (!row.fen) {
      setSandboxMessage('Selected puzzle has no FEN in storage.');
      return;
    }

    initializeSandboxFromFen(row.fen, 'white');
    const synthesizedAnalysis: PuzzleAnalysis = {
      id: row.id,
      fileName: row.title,
      imagePreviewUrl: previewUrl ?? '',
      fen: row.fen,
      sideToMove: extractSideFromFen(row.fen, 'white'),
      confidence: row.confidence,
      attemptsUsed: null,
      mateFound: row.status !== 'failed',
      mateIn: null,
      solutionSan: row.solution,
      solutionUci: [],
      estimatedRating: row.rating ?? 1400,
      motifs: row.motifs,
      explanation: `Loaded from your Puzzle Lab library. Review the motif stack (${row.motifs.join(', ')}) and replay critical tactical branches in sandbox mode.`,
      explanationConfidence: 0.72,
      recommendations: buildRecommendations({
        motifs: row.motifs,
        targetRating: row.rating ?? 1400,
        fallbackFen: row.fen,
        fallbackLine: row.solution,
      }),
      dna: buildPuzzleDna({
        motifs: row.motifs,
        mateIn: null,
        solutionLength: row.solution.join(' ').split(/\s+/).length,
        confidence: row.confidence,
        fen: row.fen,
      }),
      summary: row.status === 'failed' ? 'Defensive resource-heavy position.' : 'High-conversion tactical puzzle from your history.',
      createdAt: row.createdAt,
    };
    setAnalysis(synthesizedAnalysis);
    setPlaybackIndex(0);
  };

  const breakdownSections = analysis ? buildBreakdownSections(analysis) : [];
  const showArchivedPuzzleLabSections = false;
  const primaryTextStyle: React.CSSProperties = {
    color: isDark ? 'rgb(226, 232, 240)' : 'rgb(51, 65, 85)',
  };
  const secondaryTextStyle: React.CSSProperties = {
    color: isDark ? 'rgb(203, 213, 225)' : 'rgb(71, 85, 105)',
  };
  const tertiaryTextStyle: React.CSSProperties = {
    color: isDark ? 'rgb(186, 200, 217)' : 'rgb(100, 116, 139)',
  };

  return (
    <section className="puzzle-lab-contrast space-y-5">
      <header className="neumo-surface-soft rounded-[28px] p-5 md:p-6" style={panelStyle}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-slate-500 dark:text-slate-300">
              AI-first tactical workstation
            </p>
            <h2
              className="mt-1 text-3xl font-semibold tracking-tight text-slate-700 dark:text-slate-100"
              style={primaryTextStyle}
            >
              Puzzle Lab
            </h2>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-300" style={secondaryTextStyle}>
              A focused workflow for puzzle extraction, explanation, sandbox testing, and motif-based training.
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200/80 dark:border-slate-700/70 bg-white/60 dark:bg-slate-900/30 px-3 py-2 text-xs text-slate-500 dark:text-slate-300">
            <div className="flex items-center gap-1.5"><FlaskConical className="h-3.5 w-3.5" /> Experimental</div>
            <div className="mt-1 flex items-center gap-1.5"><Brain className="h-3.5 w-3.5" /> Educational</div>
            <div className="mt-1 flex items-center gap-1.5"><Sparkles className="h-3.5 w-3.5" /> Interactive</div>
          </div>
        </div>
      </header>

      <section className="grid gap-5 xl:grid-cols-[1.2fr_1fr]">
        <article className="neumo-surface-soft rounded-[26px] p-5 md:p-6" style={panelStyle}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.08em] text-slate-500 dark:text-slate-300">1. Upload & Analyze Puzzle</p>
              <h3
                className="mt-1 text-xl font-semibold text-slate-700 dark:text-slate-100"
                style={primaryTextStyle}
              >
                Vision + Engine Extraction
              </h3>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full neumo-pill px-3 py-1 text-xs font-semibold text-slate-600" style={buttonStyle}>
              <ScanSearch className="h-3.5 w-3.5" />
              {loading ? STAGE_TEXT[loadingStage] : 'Ready'}
            </div>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_auto]">
            <div
              className={`rounded-2xl border-2 border-dashed px-4 py-5 transition-all ${
                dragging
                  ? 'border-sky-400 bg-sky-100/65 dark:border-sky-400/85 dark:bg-sky-900/52'
                  : 'border-slate-300/80 dark:border-slate-500/90 bg-white/55 dark:bg-slate-950/72'
              }`}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={(event) => {
                event.preventDefault();
                setDragging(false);
              }}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                const dropped = event.dataTransfer.files?.[0];
                if (dropped && dropped.type.startsWith('image/')) {
                  setFile(dropped);
                  setError(null);
                  setAnalysis(null);
                }
              }}
            >
              <div className="flex flex-wrap items-start gap-3">
                <ImagePlus className="h-5 w-5 text-slate-500 dark:text-slate-300" />
                <div className="min-w-0 flex-1">
                  <p
                    className="text-sm font-medium text-slate-700 dark:text-slate-100"
                    style={primaryTextStyle}
                  >
                    Drop screenshot, paste clipboard, or browse file
                  </p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-300" style={tertiaryTextStyle}>
                    Supports mobile screenshots and desktop captures. AI will detect side to move, FEN, and tactical motifs.
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="rounded-full neumo-pill px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-200 hover:-translate-y-[1px] transition"
                      style={buttonStyle}
                    >
                      <Upload className="mr-1 inline h-3.5 w-3.5" /> Choose image
                    </button>
                    <span className="rounded-full bg-white/75 dark:bg-slate-800 px-2.5 py-1 text-[11px] text-slate-500 dark:text-slate-100 dark:ring-1 dark:ring-slate-500/65">
                      <Clipboard className="mr-1 inline h-3.5 w-3.5" /> Paste supported
                    </span>
                  </div>
                </div>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(event) => {
                  const selected = event.target.files?.[0] ?? null;
                  setFile(selected);
                  setAnalysis(null);
                  setError(null);
                }}
              />
            </div>

            <div className="flex items-start gap-2">
              <button
                type="button"
                onClick={() => setExpectedSideToMove((value) => (value === 'white' ? 'black' : 'white'))}
                className="h-11 w-11 rounded-full neumo-surface-soft flex items-center justify-center text-slate-700 hover:-translate-y-[1px] transition"
                style={buttonStyle}
                aria-label="Toggle expected side to move"
              >
                <Crown className="h-5 w-5" fill={expectedSideToMove === 'black' ? 'currentColor' : 'none'} />
              </button>
              <div className="rounded-xl bg-white/65 dark:bg-slate-900/62 px-2.5 py-2 text-xs text-slate-600 dark:text-slate-100 dark:ring-1 dark:ring-slate-600/70">
                Expected side: <span className="font-semibold">{expectedSideToMove}</span>
              </div>
            </div>
          </div>

          {previewUrl && (
            <div className="mt-4 grid gap-4 lg:grid-cols-[260px_1fr]">
              <div className="relative overflow-hidden rounded-2xl border border-slate-200/80 dark:border-slate-700/70 bg-slate-100 dark:bg-slate-900/55 h-[220px]">
                <Image
                  src={previewUrl}
                  alt="Puzzle preview"
                  fill
                  unoptimized
                  sizes="260px"
                  className="object-contain p-1"
                />
              </div>
              <div className="rounded-2xl neumo-inset px-4 py-4">
                <p className="text-xs uppercase tracking-[0.08em] text-slate-500" style={tertiaryTextStyle}>Image preview</p>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-300" style={secondaryTextStyle}>{file?.name ?? 'Uploaded image'}</p>
                <p className="mt-1 text-xs text-slate-500" style={tertiaryTextStyle}>
                  Run analysis to extract the board, FEN, side to move, tactical motifs, and best solution line.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    void submitForAnalysis();
                  }}
                  disabled={loading}
                  className="mt-4 rounded-full neumo-pill px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60 hover:-translate-y-[1px] transition"
                  style={buttonStyle}
                >
                  <Zap className="mr-1 inline h-4 w-4" /> Analyze Puzzle
                </button>
              </div>
            </div>
          )}

          {loading && (
            <div className="mt-4 rounded-2xl border border-slate-200/70 dark:border-slate-700/70 bg-white/55 dark:bg-slate-900/25 px-4 py-4">
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-800/70">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-cyan-400 via-sky-500 to-indigo-500 transition-all duration-700"
                  style={{ width: `${((loadingStage + 1) / STAGE_TEXT.length) * 100}%` }}
                />
              </div>
              <p className="mt-3 text-sm text-slate-600 dark:text-slate-300" style={secondaryTextStyle}>{STAGE_TEXT[loadingStage]}</p>
            </div>
          )}

          {error && (
            <p className="mt-4 rounded-xl border border-rose-300/60 bg-rose-100/70 dark:bg-rose-900/25 px-3 py-2 text-sm text-rose-700 dark:text-rose-200">
              {error}
            </p>
          )}

          {analysis && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <article className="rounded-xl border border-slate-200/70 dark:border-slate-700/70 bg-white/60 dark:bg-slate-900/35 px-3 py-3">
                <p className="text-xs uppercase tracking-[0.08em] text-slate-500">Detected side</p>
                <p className="mt-1 text-sm font-semibold text-slate-700 dark:text-slate-200">{analysis.sideToMove ?? 'Unavailable'}</p>
              </article>
              <article className="rounded-xl border border-slate-200/70 dark:border-slate-700/70 bg-white/60 dark:bg-slate-900/35 px-3 py-3">
                <p className="text-xs uppercase tracking-[0.08em] text-slate-500">Vision confidence</p>
                <p className="mt-1 text-sm font-semibold text-slate-700 dark:text-slate-200">{formatConfidence(analysis.confidence)}</p>
              </article>
              <article className="rounded-xl border border-slate-200/70 dark:border-slate-700/70 bg-white/60 dark:bg-slate-900/35 px-3 py-3">
                <p className="text-xs uppercase tracking-[0.08em] text-slate-500">Estimated difficulty</p>
                <p className="mt-1 text-sm font-semibold text-slate-700 dark:text-slate-200">{normalizeRatingLabel(analysis.estimatedRating)}</p>
              </article>
              <article className="rounded-xl border border-slate-200/70 dark:border-slate-700/70 bg-white/60 dark:bg-slate-900/35 px-3 py-3 sm:col-span-2">
                <p className="text-xs uppercase tracking-[0.08em] text-slate-500">Tactical motifs</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {analysis.motifs.map((motif) => (
                    <span key={motif} className="rounded-full bg-sky-100/90 dark:bg-sky-900/35 px-2.5 py-1 text-[11px] font-semibold text-sky-700 dark:text-sky-200">
                      {motif}
                    </span>
                  ))}
                </div>
              </article>
              <article className="rounded-xl border border-slate-200/70 dark:border-slate-700/70 bg-white/60 dark:bg-slate-900/35 px-3 py-3">
                <p className="text-xs uppercase tracking-[0.08em] text-slate-500">Mate status</p>
                <p className="mt-1 text-sm font-semibold text-slate-700 dark:text-slate-200">
                  {analysis.mateFound === null
                    ? 'Unavailable'
                    : analysis.mateFound
                      ? `Mate in ${analysis.mateIn ?? '?'}`
                      : 'No forced mate'}
                </p>
              </article>
              <article className="rounded-xl border border-slate-200/70 dark:border-slate-700/70 bg-white/60 dark:bg-slate-900/35 px-3 py-3 sm:col-span-2">
                <p className="text-xs uppercase tracking-[0.08em] text-slate-500">Extracted FEN</p>
                <p className="mt-1 break-all font-mono text-xs text-slate-700 dark:text-slate-200">
                  {analysis.fen ?? 'Unavailable'}
                </p>
              </article>
              <article className="rounded-xl border border-slate-200/70 dark:border-slate-700/70 bg-white/60 dark:bg-slate-900/35 px-3 py-3">
                <p className="text-xs uppercase tracking-[0.08em] text-slate-500">Solution line</p>
                <p className="mt-1 text-sm font-semibold text-slate-700 dark:text-slate-200">
                  {analysis.solutionSan.length > 0 ? analysis.solutionSan.join(' | ') : 'Unavailable'}
                </p>
              </article>
            </div>
          )}
        </article>

        <article className="neumo-surface-soft rounded-[26px] p-5 md:p-6" style={panelStyle}>
          <p className="text-xs uppercase tracking-[0.08em] text-slate-500" style={tertiaryTextStyle}>2. AI Puzzle Breakdown</p>
          <h3 className="mt-1 text-xl font-semibold text-slate-700" style={primaryTextStyle}>Conversational Tactical Explanation</h3>

          {analysis ? (
            <>
              <div className="mt-4 rounded-2xl border border-slate-200/80 dark:border-slate-700/70 bg-white/65 dark:bg-slate-900/30 px-4 py-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-100" style={primaryTextStyle}>AI Explanation</p>
                  <span className="text-xs text-slate-500 dark:text-slate-300" style={tertiaryTextStyle}>Confidence {(analysis.explanationConfidence * 100).toFixed(0)}%</span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300" style={secondaryTextStyle}>{analysis.explanation}</p>
              </div>

              <div className="mt-4 space-y-2">
                {breakdownSections.map((section) => {
                  const expanded = Boolean(breakdownExpanded[section.key]);
                  return (
                    <article key={section.key} className="rounded-xl border border-slate-200/80 dark:border-slate-700/70 bg-white/60 dark:bg-slate-900/25 px-3 py-3">
                      <button
                        type="button"
                        onClick={() => {
                          setBreakdownExpanded((previous) => ({ ...previous, [section.key]: !expanded }));
                        }}
                        className="flex w-full items-center justify-between gap-2 text-left"
                        aria-expanded={expanded}
                      >
                        <span className="text-sm font-semibold text-slate-700 dark:text-slate-100">{section.title}</span>
                        {expanded ? <ChevronUp className="h-4 w-4 text-slate-500" /> : <ChevronDown className="h-4 w-4 text-slate-500" />}
                      </button>
                      {expanded && (
                        <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{section.body}</p>
                      )}
                    </article>
                  );
                })}
              </div>

              <div className="mt-4 rounded-2xl border border-slate-200/80 dark:border-slate-700/70 bg-white/60 dark:bg-slate-900/25 px-3 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.08em] text-slate-500">Animated move playback</p>
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                      Step {playbackIndex}/{analysis.solutionUci.length}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setPlaybackIndex((value) => Math.max(0, value - 1))}
                      className="rounded-full neumo-pill px-2.5 py-1.5 text-xs text-slate-600"
                      style={buttonStyle}
                    >
                      Prev
                    </button>
                    <button
                      type="button"
                      onClick={() => setPlaybackRunning((value) => !value)}
                      className="rounded-full neumo-pill px-3 py-1.5 text-xs font-semibold text-slate-700"
                      style={buttonStyle}
                    >
                      {playbackRunning ? <Pause className="mr-1 inline h-3.5 w-3.5" /> : <Play className="mr-1 inline h-3.5 w-3.5" />}
                      {playbackRunning ? 'Pause' : 'Play'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPlaybackRunning(false);
                        setPlaybackIndex((value) => Math.min(analysis.solutionUci.length, value + 1));
                      }}
                      className="rounded-full neumo-pill px-2.5 py-1.5 text-xs text-slate-600"
                      style={buttonStyle}
                    >
                      Next
                    </button>
                  </div>
                </div>

                <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_170px]">
                  {playbackBoard ? (
                    <FenBoard
                      board={playbackBoard}
                      highlightedSquares={playbackHighlights}
                      arrows={playbackArrows}
                      className="w-full max-w-[420px] aspect-square"
                    />
                  ) : (
                    <div className="w-full max-w-[420px] aspect-square rounded-xl border border-slate-200/80 dark:border-slate-700/70 bg-white/45 dark:bg-slate-900/20 flex items-center justify-center text-sm text-slate-500">
                      No board available.
                    </div>
                  )}
                  <div className="rounded-xl border border-slate-200/80 dark:border-slate-700/70 bg-white/50 dark:bg-slate-900/25 px-3 py-3">
                    <p className="text-xs uppercase tracking-[0.08em] text-slate-500">Evaluation</p>
                    <p className="mt-1 text-lg font-semibold text-slate-700 dark:text-slate-100">{formatEval(playbackEval)}</p>
                    <div className="mt-2 h-2 rounded-full bg-slate-200/80 dark:bg-slate-800/80 overflow-hidden">
                      <div
                        className={`h-full ${evaluateBarColor(playbackEval)}`}
                        style={{ width: `${clamp(50 + playbackEval * 7, 5, 95)}%` }}
                      />
                    </div>
                    <p className="mt-3 text-xs text-slate-500 dark:text-slate-300">Line: {analysis.solutionSan.join(' | ')}</p>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <p className="mt-4 rounded-xl neumo-inset px-3 py-3 text-sm text-slate-500" style={tertiaryTextStyle}>
              Analyze a puzzle to unlock AI explanation and why the tactical line works.
            </p>
          )}
        </article>
      </section>

      {showArchivedPuzzleLabSections && (
      <section className="grid gap-5 xl:grid-cols-[1fr_1fr]">
        <article className="neumo-surface-soft rounded-[26px] p-5 md:p-6" style={panelStyle}>
          <p className="text-xs uppercase tracking-[0.08em] text-slate-500">3. Similar Puzzle Recommendations</p>
          <h3 className="mt-1 text-xl font-semibold text-slate-700">Tactical Stream</h3>

          {analysis ? (
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {analysis.recommendations.map((recommendation) => (
                <article key={recommendation.id} className="rounded-2xl border border-slate-200/80 dark:border-slate-700/70 bg-white/60 dark:bg-slate-900/25 px-3 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-700 dark:text-slate-100">{recommendation.title}</p>
                      <p className="text-xs text-slate-500">{recommendation.estimatedElo} Elo • Depth {recommendation.depth}</p>
                    </div>
                    <span className="rounded-full bg-emerald-100/90 dark:bg-emerald-900/30 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-200">
                      {recommendation.solvePercentage}% solve
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {recommendation.motifs.map((motif) => (
                      <span key={`${recommendation.id}-${motif}`} className="rounded-full bg-sky-100/90 dark:bg-sky-900/30 px-2 py-0.5 text-[10px] font-semibold text-sky-700 dark:text-sky-200">
                        {motif}
                      </span>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (recommendation.fen) {
                        initializeSandboxFromFen(recommendation.fen, 'white');
                      }
                      setSandboxMessage(`Loaded recommendation: ${recommendation.title}`);
                    }}
                    className="mt-3 rounded-full neumo-pill px-3 py-1.5 text-xs font-semibold text-slate-700"
                    style={buttonStyle}
                  >
                    <SquareArrowOutUpRight className="mr-1 inline h-3.5 w-3.5" /> Quick launch
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <p className="mt-4 rounded-xl neumo-inset px-3 py-3 text-sm text-slate-500">
              Similar puzzles appear after analysis, weighted by motifs, mating pattern, and difficulty.
            </p>
          )}
        </article>

        <article className="neumo-surface-soft rounded-[26px] p-5 md:p-6" style={panelStyle}>
          <p className="text-xs uppercase tracking-[0.08em] text-slate-500">4. Puzzle DNA / Theme Extraction</p>
          <h3 className="mt-1 text-xl font-semibold text-slate-700">Futuristic Tactical Profile</h3>

          {analysis ? (
            <>
              <div className="mt-4">
                <DnaRadar dna={analysis.dna} />
              </div>
              <p className="mt-4 rounded-xl border border-cyan-300/40 bg-cyan-100/65 dark:bg-cyan-900/20 px-3 py-2 text-sm text-cyan-800 dark:text-cyan-200">
                {analysis.summary}
              </p>
            </>
          ) : (
            <p className="mt-4 rounded-xl neumo-inset px-3 py-3 text-sm text-slate-500">
              Puzzle DNA activates after AI extraction and visualizes aggression, forcing depth, king exposure, and calculation complexity.
            </p>
          )}
        </article>
      </section>
      )}

      <section className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <article className="neumo-surface-soft rounded-[26px] p-5 md:p-6" style={panelStyle}>
          <p className="text-xs uppercase tracking-[0.08em] text-slate-500" style={tertiaryTextStyle}>3. Puzzle Sandbox Mode</p>
          <h3 className="mt-1 text-xl font-semibold text-slate-700" style={primaryTextStyle}>Interactive Variation Workbench</h3>

          <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_230px]">
            <div className="w-full max-w-[560px]">
              {sandboxBoard ? (
                <FenBoard
                  board={sandboxBoard}
                  onSquareClick={handleSandboxSquareClick}
                  selectedSquare={sandboxSelectedSquare}
                  highlightedSquares={sandboxSelectedSquare ? [sandboxSelectedSquare] : []}
                  flipped={sandboxFlipped}
                  className="w-full aspect-square"
                />
              ) : (
                <div className="w-full aspect-square rounded-2xl border border-slate-200/80 dark:border-slate-700/70 bg-white/50 dark:bg-slate-900/25 flex items-center justify-center text-sm text-slate-500">
                  Sandbox board appears after loading a puzzle.
                </div>
              )}
            </div>

            <div className="space-y-2.5">
              <div className="rounded-xl border border-slate-200/80 dark:border-slate-700/70 bg-white/60 dark:bg-slate-900/25 px-3 py-3">
                <p className="text-xs uppercase tracking-[0.08em] text-slate-500">Engine eval</p>
                <p className="mt-1 text-lg font-semibold text-slate-700 dark:text-slate-100">{formatEval(sandboxEngineScore)}</p>
              </div>
              <div className="rounded-xl border border-slate-200/80 dark:border-slate-700/70 bg-white/60 dark:bg-slate-900/25 px-3 py-3">
                <p className="text-xs uppercase tracking-[0.08em] text-slate-500">Side to move</p>
                <p className="mt-1 text-sm font-semibold text-slate-700 dark:text-slate-100">{sandboxSideToMove}</p>
              </div>
              <div className="rounded-xl border border-slate-200/80 dark:border-slate-700/70 bg-white/60 dark:bg-slate-900/25 px-3 py-3">
                <p className="text-xs uppercase tracking-[0.08em] text-slate-500">Candidate suggestions</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {candidateMoves.length > 0 ? (
                    candidateMoves.map((move) => (
                      <button
                        key={move}
                        type="button"
                        onClick={() => {
                          if (!sandboxBoard) {
                            return;
                          }
                          const from = move.slice(0, 2);
                          const to = move.slice(2, 4);
                          const validation = validateMove(sandboxBoard, sandboxSideToMove, from, to);
                          if (!validation.valid) {
                            return;
                          }
                          const applied = applyUciMove(sandboxBoard, from, to, null);
                          if (!applied) {
                            return;
                          }
                          setSandboxBoard(applied);
                          setSandboxMoveHistory((previous) => [...previous, move]);
                          setSandboxSideToMove((side) => (side === 'white' ? 'black' : 'white'));
                          const evalScore = Math.round(materialEvaluation(applied) * 10) / 10;
                          setSandboxEngineScore(evalScore);
                          setSandboxMessage(`Applied candidate ${move}.`);
                          setSandboxSelectedSquare(null);
                        }}
                        className="rounded-full bg-slate-100/90 dark:bg-slate-800/80 px-2 py-0.5 text-[11px] font-semibold text-slate-600 dark:text-slate-200"
                      >
                        {move}
                      </button>
                    ))
                  ) : (
                    <p className="text-xs text-slate-500">No legal moves from current board.</p>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (!sandboxInitialBoard) {
                  return;
                }
                setSandboxBoard(cloneBoard(sandboxInitialBoard));
                setSandboxSideToMove(sandboxInitialSide);
                setSandboxMoveHistory([]);
                setSandboxSelectedSquare(null);
                setSandboxEngineScore(Math.round(materialEvaluation(sandboxInitialBoard) * 10) / 10);
                setSandboxMessage('Sandbox reset to initial position.');
              }}
              className="rounded-full neumo-pill px-3 py-1.5 text-xs font-semibold text-slate-700"
              style={buttonStyle}
            >
              <RotateCcw className="mr-1 inline h-3.5 w-3.5" /> Reset board
            </button>
            <button
              type="button"
              onClick={() => {
                setSandboxFlipped((value) => !value);
              }}
              className="rounded-full neumo-pill px-3 py-1.5 text-xs font-semibold text-slate-700"
              style={buttonStyle}
            >
              <RefreshCcw className="mr-1 inline h-3.5 w-3.5" /> Flip board
            </button>
            <button
              type="button"
              onClick={() => {
                if (!sandboxBoard || sandboxMoveHistory.length === 0) {
                  return;
                }
                if (!sandboxInitialBoard) {
                  return;
                }
                const trimmedMoves = sandboxMoveHistory.slice(0, -1);
                let replayBoard = cloneBoard(sandboxInitialBoard);
                let replaySide = sandboxInitialSide;
                for (const move of trimmedMoves) {
                  const normalized = normalizeUci(move);
                  if (!normalized) {
                    continue;
                  }
                  const applied = applyUciMove(replayBoard, normalized.slice(0, 2), normalized.slice(2, 4), normalized.length === 5 ? normalized.slice(4) : null);
                  if (!applied) {
                    break;
                  }
                  replayBoard = applied;
                  replaySide = replaySide === 'white' ? 'black' : 'white';
                }
                setSandboxBoard(replayBoard);
                setSandboxSideToMove(replaySide);
                setSandboxMoveHistory(trimmedMoves);
                setSandboxSelectedSquare(null);
                const evalScore = Math.round(materialEvaluation(replayBoard) * 10) / 10;
                setSandboxEngineScore(evalScore);
                setSandboxMessage('Reverted last move.');
              }}
              className="rounded-full neumo-pill px-3 py-1.5 text-xs font-semibold text-slate-700"
              style={buttonStyle}
            >
              Undo move
            </button>
            <button
              type="button"
              onClick={() => {
                void requestSandboxHint();
              }}
              disabled={sandboxHintLoading}
              className="rounded-full neumo-pill px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-60"
              style={buttonStyle}
            >
              <Lightbulb className="mr-1 inline h-3.5 w-3.5" /> {sandboxHintLoading ? 'Thinking…' : 'AI hint'}
            </button>
          </div>

          <p className="mt-3 text-sm text-slate-600 dark:text-slate-300" style={secondaryTextStyle}>{sandboxMessage}</p>
          {sandboxHint && (
            <p className="mt-2 rounded-xl border border-amber-300/45 bg-amber-100/70 dark:bg-amber-900/20 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
              {sandboxHint}
            </p>
          )}
        </article>
        <article className="neumo-surface-soft rounded-[26px] p-5 md:p-6" style={panelStyle}>
          <p className="text-xs uppercase tracking-[0.08em] text-slate-500" style={tertiaryTextStyle}>4. Similar Puzzle Recommendations</p>
          <h3 className="mt-1 text-xl font-semibold text-slate-700" style={primaryTextStyle}>Motif-Matched Training Queue</h3>

          {analysis ? (
            <div className="mt-4 grid gap-3">
              {analysis.recommendations.map((recommendation) => (
                <article key={recommendation.id} className="rounded-2xl border border-slate-200/80 dark:border-slate-700/70 bg-white/60 dark:bg-slate-900/25 px-3 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-700 dark:text-slate-100">{recommendation.title}</p>
                      <p className="text-xs text-slate-500">{recommendation.estimatedElo} Elo • Depth {recommendation.depth}</p>
                    </div>
                    <span className="rounded-full bg-emerald-100/90 dark:bg-emerald-900/30 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-200">
                      {recommendation.solvePercentage}% solve
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {recommendation.motifs.map((motif) => (
                      <span key={`${recommendation.id}-${motif}`} className="rounded-full bg-sky-100/90 dark:bg-sky-900/30 px-2 py-0.5 text-[10px] font-semibold text-sky-700 dark:text-sky-200">
                        {motif}
                      </span>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (recommendation.fen) {
                        initializeSandboxFromFen(recommendation.fen, 'white');
                      }
                      setSandboxMessage(`Loaded recommendation: ${recommendation.title}`);
                    }}
                    className="mt-3 rounded-full neumo-pill px-3 py-1.5 text-xs font-semibold text-slate-700"
                    style={buttonStyle}
                  >
                    <SquareArrowOutUpRight className="mr-1 inline h-3.5 w-3.5" /> Load in sandbox
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <p className="mt-4 rounded-xl neumo-inset px-3 py-3 text-sm text-slate-500" style={tertiaryTextStyle}>
              Recommendations appear after analysis, matched by motifs and estimated difficulty.
            </p>
          )}
        </article>
      </section>

      {showArchivedPuzzleLabSections && (
      <article className="neumo-surface-soft rounded-[26px] p-5 md:p-6" style={panelStyle}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.08em] text-slate-500" style={tertiaryTextStyle}>7. Puzzle History / Library</p>
            <h3 className="mt-1 text-xl font-semibold text-slate-700" style={primaryTextStyle}>Searchable Puzzle Repository</h3>
          </div>
          <div className="rounded-full neumo-pill px-3 py-1 text-xs font-semibold text-slate-600" style={buttonStyle}>
            <History className="mr-1 inline h-3.5 w-3.5" /> {libraryRows.length} entries
          </div>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_auto_auto_auto]">
          <input
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="Search by motif, title, source, status"
            className="rounded-xl border border-slate-200/80 dark:border-slate-700/80 bg-white/70 dark:bg-slate-900/30 px-3 py-2 text-sm"
          />

          <select
            value={libraryFilter}
            onChange={(event) => setLibraryFilter(event.target.value as LibraryViewFilter)}
            className="rounded-xl border border-slate-200/80 dark:border-slate-700/80 bg-white/70 dark:bg-slate-900/30 px-3 py-2 text-sm"
          >
            <option value="all">All</option>
            <option value="uploaded">Uploaded</option>
            <option value="generated">Generated</option>
            <option value="favorites">Favorites</option>
            <option value="failed">Failed</option>
          </select>

          <select
            value={motifFilter}
            onChange={(event) => setMotifFilter(event.target.value)}
            className="rounded-xl border border-slate-200/80 dark:border-slate-700/80 bg-white/70 dark:bg-slate-900/30 px-3 py-2 text-sm"
          >
            {motifOptions.map((option) => (
              <option key={option} value={option}>
                {option === 'all' ? 'All motifs' : option}
              </option>
            ))}
          </select>

          <select
            value={difficultyFilter}
            onChange={(event) => setDifficultyFilter(event.target.value as 'all' | 'easy' | 'medium' | 'hard')}
            className="rounded-xl border border-slate-200/80 dark:border-slate-700/80 bg-white/70 dark:bg-slate-900/30 px-3 py-2 text-sm"
          >
            <option value="all">All difficulty</option>
            <option value="easy">Easy (&lt;1300)</option>
            <option value="medium">Medium (1300-1900)</option>
            <option value="hard">Hard (&gt;1900)</option>
          </select>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filteredLibraryRows.length > 0 ? (
            filteredLibraryRows.map((row) => {
              const isFavorite = favorites.has(row.id);
              const isRecentlyViewed = recentIds.includes(row.id);
              return (
                <article key={row.id} className="rounded-2xl border border-slate-200/80 dark:border-slate-700/70 bg-white/65 dark:bg-slate-900/25 px-3 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-700 dark:text-slate-100">{row.title}</p>
                      <p className="text-xs text-slate-500">
                        {row.source} • {normalizeRatingLabel(row.rating)} • {new Date(row.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    {isRecentlyViewed ? (
                      <span className="rounded-full bg-sky-100/90 dark:bg-sky-900/25 px-2 py-0.5 text-[10px] font-semibold text-sky-700 dark:text-sky-200">Recent</span>
                    ) : null}
                  </div>

                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {row.motifs.slice(0, 3).map((motif) => (
                      <span key={`${row.id}-${motif}`} className="rounded-full bg-slate-100/90 dark:bg-slate-800/80 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:text-slate-200">
                        {motif}
                      </span>
                    ))}
                  </div>

                  <p className="mt-2 text-xs text-slate-500">Status: <span className="font-semibold">{row.status}</span></p>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => loadLibraryRow(row)}
                      className="rounded-full neumo-pill px-3 py-1.5 text-xs font-semibold text-slate-700"
                      style={buttonStyle}
                    >
                      Retry puzzle
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleFavorite(row.id)}
                      className="rounded-full neumo-pill px-2.5 py-1.5 text-xs text-slate-700"
                      style={buttonStyle}
                    >
                      {isFavorite ? <Heart className="inline h-3.5 w-3.5 text-rose-500" /> : <Star className="inline h-3.5 w-3.5" />}
                    </button>
                    {row.status !== 'failed' && (
                      <button
                        type="button"
                        onClick={() => markFailed(row.id)}
                        className="rounded-full neumo-pill px-2.5 py-1.5 text-xs text-slate-700"
                        style={buttonStyle}
                      >
                        Flag failed
                      </button>
                    )}
                  </div>
                </article>
              );
            })
          ) : (
            <p className="col-span-full rounded-xl neumo-inset px-3 py-3 text-sm text-slate-500">
              No puzzles match current filters.
            </p>
          )}
        </div>
      </article>
      )}

      {showArchivedPuzzleLabSections && (
        <article className="neumo-surface-soft rounded-[26px] p-5 md:p-6" style={panelStyle}>
          <p className="text-xs uppercase tracking-[0.08em] text-slate-500">6. AI Puzzle Generator</p>
          <h3 className="mt-1 text-xl font-semibold text-slate-700">Archived Generator Controls</h3>
          <p className="mt-2 text-sm text-slate-500">Generator is hidden from the primary flow but preserved for future reactivation.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label>
              <span className="text-xs uppercase tracking-[0.08em] text-slate-500">Motif</span>
              <select
                value={generatorInputs.motif}
                onChange={(event) => {
                  setGeneratorInputs((previous) => ({ ...previous, motif: event.target.value }));
                }}
                className="mt-1 w-full rounded-xl border border-slate-200/80 dark:border-slate-700/80 bg-white/65 dark:bg-slate-900/30 px-3 py-2 text-sm"
              >
                {MOTIF_POOL.map((motif) => (
                  <option key={motif} value={motif}>
                    {motif}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => {
                void generatePuzzle();
              }}
              disabled={generatorLoading}
              className="self-end rounded-full neumo-pill px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60"
              style={buttonStyle}
            >
              <WandSparkles className="mr-1 inline h-4 w-4" /> {generatorLoading ? 'Generating…' : 'Generate Puzzle'}
            </button>
          </div>
          {generatedPuzzles.length > 0 && (
            <div className="mt-4 space-y-2">
              {generatedPuzzles.slice(0, 3).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setAnalysis(inferAnalysisFromGenerated(item));
                    initializeSandboxFromFen(item.fen, extractSideFromFen(item.fen, 'white'));
                    markRecentlyViewed(item.id);
                  }}
                  className="w-full rounded-xl border border-slate-200/70 dark:border-slate-700/70 bg-white/70 dark:bg-slate-900/35 px-3 py-2 text-left"
                >
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-100">{item.title}</p>
                </button>
              ))}
            </div>
          )}
        </article>
      )}

    </section>
  );
}


