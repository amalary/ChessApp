export type SolveResponse = {
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

export type SolveMeta = {
  sideToMove: 'white' | 'black' | null;
  confidence: number | null;
  attemptsUsed: number | null;
  mateFound: boolean | null;
  mateIn: number | null;
};

export type GradientDirection = 'top-to-bottom' | 'diagonal' | 'bottom-to-top';

export const DEFAULT_DASHBOARD_ACCENT = '#7A94BF';
export const DEFAULT_DASHBOARD_SECONDARY = '#A58EB4';
export const DEFAULT_DASHBOARD_ACCENT_CHANNELS: [number, number, number] = [122, 148, 191];

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

export function normalizeHexColor(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(normalized)) {
    return null;
  }

  return normalized.toUpperCase();
}

export function hexToRgbChannels(hexColor: string): [number, number, number] | null {
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

export function buildDashboardBackground(
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

export function buildPanelGradientBackground(
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

export function extractSolveMeta(data: SolveResponse): SolveMeta {
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

export function formatConfidence(confidence: number | null): string {
  if (confidence === null) {
    return 'Unavailable';
  }
  return `${(confidence * 100).toFixed(1)}%`;
}

export function extractSolutionLines(data: SolveResponse): string[] {
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

export function isSuccessfulSolve(data: SolveResponse): boolean {
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
