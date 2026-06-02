import { ASSISTANT_PERSONA_COPY } from '@/lib/assistant-persona';
import type { AssistantConversationMode } from '@/lib/assistant-conversation-mode';
import { formatConversationalText } from '@/lib/assistant-rhythm';
import type { PuzzleSubmissionRecord } from '@/lib/puzzle-submissions';

export type AgentChatRole = 'assistant' | 'user';
export type AssistantMode = 'hint' | 'explain' | 'theme' | 'followup';

export type AgentChatMessage = {
  id: string;
  role: AgentChatRole;
  text: string;
  timestamp: string;
};

export type AgentReferencedPuzzle = {
  id: string;
  fileName: string;
  submittedAt: string;
  fen: string | null;
  imageDataUrl: string;
};

export type PuzzleContextSnapshot = {
  puzzleId: string | null;
  fen: string | null;
  solverMoveSan: string | null;
  solverLine: string[] | null;
};

export type AssistantRequestPayload = {
  puzzle_id: string | null;
  fen: string | null;
  solver_move_san: string | null;
  solver_line: string[] | null;
  user_message: string;
  requested_mode: AssistantMode;
  conversation_mode: AssistantConversationMode;
};

type AgentSuggestionChip = {
  id: string;
  label: string;
  prompt: string;
};

type ConversationalMomentumAction = {
  id: string;
  label: string;
  prompt: string;
};

type AdaptiveSuggestionsInput = {
  submissions: PuzzleSubmissionRecord[];
  messages: AgentChatMessage[];
  isSending?: boolean;
};

type SubmissionInsight = {
  firstMoveAccuracyPercent: number | null;
  weakestTheme: string | null;
  trend: 'improving' | 'declining' | 'steady' | 'insufficient';
  hasUploadedPosition: boolean;
  latestFailureHasMatePattern: boolean;
  latestFailedMove: string | null;
};

const AGENT_FALLBACK_PROMPTS: AgentSuggestionChip[] = [
  {
    id: 'fallback-hint-instead',
    label: 'Give me a hint instead.',
    prompt: 'Give me a hint instead.',
  },
  {
    id: 'fallback-weak-theme',
    label: 'Show my weakest tactical theme.',
    prompt: 'Show my weakest tactical theme and one focused drill.',
  },
  {
    id: 'fallback-explain-fail',
    label: 'Explain why my move failed.',
    prompt: 'Explain why my move failed and what tactical cue I missed.',
  },
  {
    id: 'fallback-train-pattern',
    label: 'Train this pattern.',
    prompt: 'Train this pattern with three short puzzles and no full line first.',
  },
];

const PUZZLE_REFERENCE_PATTERN =
  /\b(puzzle|puzzles|position|positions|board|fen|uploaded|upload|latest|recent|last|previous|prior|ago|back|older|earlier|solve|solves|submission|submissions)\b/i;
const RECENT_REFERENCE_PATTERN = /\b(latest|most recent|recent|last)\b/i;
const PREVIOUS_PREVIOUS_PATTERN =
  /\b(previous|prior)\s+(previous|prior)\b|\b(two|2)\s+puzzles?\s+ago\b|\bthird\s+(latest|most recent|recent|last)\b|\b(the\s+)?one\s+before\s+that\b/i;
const PREVIOUS_PATTERN =
  /\b(previous|prior)\b|\b(one|1)\s+puzzle\s+ago\b|\bbefore\s+last\b|\bsecond\s+(latest|most recent|recent|last)\b|\bone\s+back\b/i;
const PUZZLES_AGO_PATTERN =
  /\b(?<count>\d+|[a-z]+)\s+(?:puzzles?|solves?)\s+ago\b/i;
const ORDINAL_RECENT_PATTERN =
  /\b(?<ordinal>\d+(?:st|nd|rd|th)?|first|second|third|fourth|fifth)\s+(?:most\s+recent|latest|newest|last)\s+(?:puzzle|solve)?\b/i;
const SECOND_TO_LAST_PATTERN = /\b(second|2nd)\s+(?:to\s+)?last\b/i;
const THIRD_TO_LAST_PATTERN = /\b(third|3rd)\s+(?:to\s+)?last\b/i;
const EARLIER_REFERENCE_PATTERN =
  /\b(earlier|older|before)\b.*\b(one|puzzle|solve)\b|\b(one|puzzle|solve)\b.*\b(earlier|older)\b/i;
const GO_BACK_PATTERN =
  /\b(?:go|scroll|move)\s+back\s+(?<count>\d+|[a-z]+)\b(?:\s+(?:puzzles?|solves?))?/i;
const BACK_COUNT_PATTERN = /\b(?<count>\d+|[a-z]+)\s+back\b(?:\s+(?:puzzles?|solves?))?/i;
const NTH_RECENT_PATTERN =
  /\b(?<ordinal>\d+(?:st|nd|rd|th)?|[a-z]+)\s+(?:most\s+recent|latest|newest|recent|last)\b(?:\s+(?:puzzle|solve))?/i;
const NTH_PUZZLE_PATTERN = /\b(?:puzzle|solve)\s*(?:#|number\s+)?(?<ordinal>\d+)\b/i;
const SUBMISSION_NUMBER_PATTERN =
  /\bsubmission(?:\s+number)?\s*(?:#|no\.?|num(?:ber)?)?\s*(?<ordinal>\d{1,4})\b/i;
const FILE_NAME_TOKEN_PATTERN = /[a-z0-9]{3,}/gi;
const MOVE_TOKEN_PATTERN =
  /\b(?:O-O(?:-O)?[+#]?|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?)\b/g;
const NUMBER_WORD_TO_INT: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  sixth: 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
  tenth: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  eleventh: 11,
  twelfth: 12,
  thirteenth: 13,
  fourteenth: 14,
  fifteenth: 15,
  sixteenth: 16,
  seventeenth: 17,
  eighteenth: 18,
  nineteenth: 19,
  twentieth: 20,
};

function isImageDataUrl(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.startsWith('data:image/');
}

function toSubmissionTimestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function scoreFileNameMatch(fileName: string, query: string): number {
  const tokens = fileName.toLowerCase().match(FILE_NAME_TOKEN_PATTERN) ?? [];
  if (tokens.length === 0) {
    return 0;
  }
  let score = 0;
  for (const token of tokens) {
    if (query.includes(token)) {
      score += token.length;
    }
  }
  return score;
}

function resolveRequestedHistoryIndex(userText: string): number | null {
  const parseIndexToken = (
    token: string,
    options: { offsetFromRecent: boolean },
  ): number | null => {
    const normalized = token.trim().toLowerCase();
    if (!normalized) {
      return null;
    }
    if (/^\d+$/.test(normalized)) {
      const value = Number.parseInt(normalized, 10);
      return options.offsetFromRecent ? Math.max(0, value - 1) : Math.max(0, value);
    }
    const numericPart = normalized.replace(/(st|nd|rd|th)$/i, '');
    if (/^\d+$/.test(numericPart)) {
      const value = Number.parseInt(numericPart, 10);
      return options.offsetFromRecent ? Math.max(0, value - 1) : Math.max(0, value);
    }
    const parsed = NUMBER_WORD_TO_INT[normalized];
    if (typeof parsed !== 'number') {
      return null;
    }
    return options.offsetFromRecent ? Math.max(0, parsed - 1) : Math.max(0, parsed);
  };

  const agoMatch = userText.match(PUZZLES_AGO_PATTERN);
  const agoRawCount = agoMatch?.groups?.count?.trim() ?? '';
  if (agoRawCount.length > 0) {
    const parsedAgo = parseIndexToken(agoRawCount, { offsetFromRecent: false });
    if (parsedAgo !== null) {
      return parsedAgo;
    }
  }

  const goBackMatch = userText.match(GO_BACK_PATTERN);
  const goBackRawCount = goBackMatch?.groups?.count?.trim() ?? '';
  if (goBackRawCount.length > 0) {
    const parsedGoBack = parseIndexToken(goBackRawCount, { offsetFromRecent: false });
    if (parsedGoBack !== null) {
      return parsedGoBack;
    }
  }

  const backCountMatch = userText.match(BACK_COUNT_PATTERN);
  const backCountRaw = backCountMatch?.groups?.count?.trim() ?? '';
  if (backCountRaw.length > 0) {
    const parsedBackCount = parseIndexToken(backCountRaw, { offsetFromRecent: false });
    if (parsedBackCount !== null) {
      return parsedBackCount;
    }
  }

  const ordinalMatch = userText.match(ORDINAL_RECENT_PATTERN);
  const rawOrdinal = ordinalMatch?.groups?.ordinal?.trim() ?? '';
  if (rawOrdinal.length > 0) {
    const parsedOrdinal = parseIndexToken(rawOrdinal, { offsetFromRecent: true });
    if (parsedOrdinal !== null) {
      return parsedOrdinal;
    }
  }

  const nthRecentMatch = userText.match(NTH_RECENT_PATTERN);
  const rawNthRecent = nthRecentMatch?.groups?.ordinal?.trim() ?? '';
  if (rawNthRecent.length > 0) {
    const parsedNthRecent = parseIndexToken(rawNthRecent, { offsetFromRecent: true });
    if (parsedNthRecent !== null) {
      return parsedNthRecent;
    }
  }

  const nthPuzzleMatch = userText.match(NTH_PUZZLE_PATTERN);
  const rawNthPuzzle = nthPuzzleMatch?.groups?.ordinal?.trim() ?? '';
  if (rawNthPuzzle.length > 0) {
    const parsedNthPuzzle = parseIndexToken(rawNthPuzzle, { offsetFromRecent: true });
    if (parsedNthPuzzle !== null) {
      return parsedNthPuzzle;
    }
  }

  const submissionNumberMatch = userText.match(SUBMISSION_NUMBER_PATTERN);
  const rawSubmissionOrdinal = submissionNumberMatch?.groups?.ordinal?.trim() ?? '';
  if (rawSubmissionOrdinal.length > 0) {
    const parsedSubmissionOrdinal = parseIndexToken(rawSubmissionOrdinal, {
      offsetFromRecent: true,
    });
    if (parsedSubmissionOrdinal !== null) {
      return parsedSubmissionOrdinal;
    }
  }

  if (THIRD_TO_LAST_PATTERN.test(userText)) {
    return 2;
  }
  if (SECOND_TO_LAST_PATTERN.test(userText)) {
    return 1;
  }
  if (PREVIOUS_PREVIOUS_PATTERN.test(userText)) {
    return 2;
  }
  if (PREVIOUS_PATTERN.test(userText)) {
    return 1;
  }
  if (RECENT_REFERENCE_PATTERN.test(userText)) {
    return 0;
  }
  if (EARLIER_REFERENCE_PATTERN.test(userText)) {
    return 1;
  }
  return null;
}

function extractMoveTokens(text: string): Set<string> {
  const tokens = text.match(MOVE_TOKEN_PATTERN) ?? [];
  return new Set(tokens.map((token) => token.trim()).filter((token) => token.length > 0));
}

function scoreSolutionAlignment(
  submission: PuzzleSubmissionRecord,
  assistantMoveTokens: Set<string>,
): number {
  if (assistantMoveTokens.size === 0) {
    return 0;
  }
  const solverLineTokens = buildSolverLineFromStoredLines(submission.solutionLines) ?? [];
  if (solverLineTokens.length === 0) {
    return 0;
  }

  let score = 0;
  const firstToken = solverLineTokens[0];
  if (assistantMoveTokens.has(firstToken)) {
    score += 12;
  }
  for (const token of solverLineTokens.slice(0, 8)) {
    if (assistantMoveTokens.has(token)) {
      score += 2;
    }
  }
  return score;
}

export function resolveReferencedPuzzle(input: {
  submissions: PuzzleSubmissionRecord[];
  userMessage: string;
  assistantMessage?: string;
}): AgentReferencedPuzzle | null {
  const available = input.submissions
    .filter((submission) => isImageDataUrl(submission.originalPuzzleImageDataUrl))
    .sort((left, right) => toSubmissionTimestamp(right.submittedAt) - toSubmissionTimestamp(left.submittedAt));
  if (available.length === 0) {
    return null;
  }

  const userText = input.userMessage.trim().toLowerCase();
  const assistantText = (input.assistantMessage ?? '').trim().toLowerCase();
  const combinedText = `${userText} ${assistantText}`.trim();
  if (!PUZZLE_REFERENCE_PATTERN.test(combinedText)) {
    return null;
  }
  const requestedHistoryIndex = resolveRequestedHistoryIndex(userText);

  const assistantMoveTokens = extractMoveTokens(input.assistantMessage ?? '');
  let bestAligned: PuzzleSubmissionRecord | null = null;
  let bestAlignmentScore = 0;
  for (const submission of available) {
    const alignmentScore = scoreSolutionAlignment(submission, assistantMoveTokens);
    if (alignmentScore > bestAlignmentScore) {
      bestAlignmentScore = alignmentScore;
      bestAligned = submission;
    }
  }

  if (bestAligned !== null && bestAlignmentScore > 0) {
    return {
      id: bestAligned.id,
      fileName: bestAligned.fileName || 'Uploaded puzzle',
      submittedAt: bestAligned.submittedAt,
      fen: bestAligned.fen ?? null,
      imageDataUrl: bestAligned.originalPuzzleImageDataUrl!,
    };
  }

  if (requestedHistoryIndex !== null) {
    const selectedByHistoryIndex = available[Math.min(requestedHistoryIndex, available.length - 1)];
    return {
      id: selectedByHistoryIndex.id,
      fileName: selectedByHistoryIndex.fileName || 'Uploaded puzzle',
      submittedAt: selectedByHistoryIndex.submittedAt,
      fen: selectedByHistoryIndex.fen ?? null,
      imageDataUrl: selectedByHistoryIndex.originalPuzzleImageDataUrl!,
    };
  }

  let bestMatch: PuzzleSubmissionRecord | null = null;
  let bestScore = 0;
  for (const submission of available) {
    const score = scoreFileNameMatch(submission.fileName, combinedText);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = submission;
    }
  }

  const selected = bestMatch ?? available[0];
  return {
    id: selected.id,
    fileName: selected.fileName || 'Uploaded puzzle',
    submittedAt: selected.submittedAt,
    fen: selected.fen ?? null,
    imageDataUrl: selected.originalPuzzleImageDataUrl!,
  };
}

function inferMotifTag(submission: PuzzleSubmissionRecord): string {
  const searchable = `${submission.fileName} ${submission.solutionLines.join(' ')}`.toLowerCase();
  if (/\bmating\s+net|back[-\s]?rank|mate[-\s]?in[-\s]?[123]/.test(searchable)) {
    return 'Mating Nets';
  }
  if (/\bdiscover(ed|y)? attack/.test(searchable)) {
    return 'Discovered Attack';
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
  if (/\bsacrifice|sac\b/.test(searchable)) {
    return 'Sacrifices';
  }
  return 'Calculation';
}

function summarizeSubmissionInsights(submissions: PuzzleSubmissionRecord[]): SubmissionInsight {
  const recent = submissions.slice(0, 24);
  const validAssessments = recent
    .map((entry) => entry.firstMoveAssessment ?? null)
    .filter(
      (assessment): assessment is NonNullable<PuzzleSubmissionRecord['firstMoveAssessment']> =>
        assessment !== null && assessment.isValidForFirstMoveAccuracy,
    );
  const correctCount = validAssessments.filter((assessment) => assessment.isFirstMoveCorrect).length;
  const firstMoveAccuracyPercent =
    validAssessments.length > 0 ? Math.round((correctCount / validAssessments.length) * 100) : null;

  let trend: SubmissionInsight['trend'] = 'insufficient';
  if (validAssessments.length >= 6) {
    const midpoint = Math.floor(validAssessments.length / 2);
    const recentHalf = validAssessments.slice(0, midpoint);
    const olderHalf = validAssessments.slice(midpoint);
    const recentAccuracy =
      recentHalf.filter((assessment) => assessment.isFirstMoveCorrect).length / Math.max(1, recentHalf.length);
    const olderAccuracy =
      olderHalf.filter((assessment) => assessment.isFirstMoveCorrect).length / Math.max(1, olderHalf.length);
    const delta = recentAccuracy - olderAccuracy;
    if (delta >= 0.15) {
      trend = 'improving';
    } else if (delta <= -0.15) {
      trend = 'declining';
    } else {
      trend = 'steady';
    }
  }

  const missedThemeCounts = new Map<string, number>();
  recent.forEach((submission) => {
    const missedMove =
      submission.firstMoveAssessment?.isValidForFirstMoveAccuracy === true &&
      submission.firstMoveAssessment.isFirstMoveCorrect === false;
    if (!missedMove) {
      return;
    }
    const motif = inferMotifTag(submission);
    missedThemeCounts.set(motif, (missedThemeCounts.get(motif) ?? 0) + 1);
  });
  const weakestTheme =
    Array.from(missedThemeCounts.entries()).sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;

  const hasUploadedPosition = recent.some(
    (submission) =>
      (typeof submission.fen === 'string' && submission.fen.trim().length > 0) ||
      (typeof submission.originalPuzzleImageDataUrl === 'string' &&
        submission.originalPuzzleImageDataUrl.startsWith('data:image/')),
  );
  const latestFailure = recent.find(
    (submission) =>
      submission.firstMoveAssessment?.isValidForFirstMoveAccuracy === true &&
      submission.firstMoveAssessment.isFirstMoveCorrect === false,
  );
  const latestFailureHasMatePattern =
    latestFailure !== undefined && inferMotifTag(latestFailure) === 'Mating Nets';

  return {
    firstMoveAccuracyPercent,
    weakestTheme,
    trend,
    hasUploadedPosition,
    latestFailureHasMatePattern,
    latestFailedMove: latestFailure?.firstMoveAssessment?.firstMove ?? null,
  };
}

function uniqueById<T extends { id: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const deduped: T[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) {
      continue;
    }
    seen.add(row.id);
    deduped.push(row);
  }
  return deduped;
}

export function buildAdaptiveSuggestionChips(input: AdaptiveSuggestionsInput): AgentSuggestionChip[] {
  if (input.isSending) {
    return [];
  }

  const insights = summarizeSubmissionInsights(input.submissions);
  const latestUserMessage = [...input.messages].reverse().find((message) => message.role === 'user')?.text ?? '';
  const latestAssistantMessage =
    [...input.messages].reverse().find((message) => message.role === 'assistant')?.text ?? '';
  const hasConversation = input.messages.some((message) => message.role === 'user');

  const chips: AgentSuggestionChip[] = [];

  if (insights.latestFailureHasMatePattern) {
    chips.push({
      id: 'missed-mating-net',
      label: 'Why do I keep missing mating nets?',
      prompt: 'Why do I keep missing mating nets? Show me the tactical trigger I should see earlier.',
    });
  }

  if (insights.latestFailedMove) {
    chips.push({
      id: 'explain-failed-move',
      label: 'Explain why my move failed.',
      prompt: `Explain why my move ${insights.latestFailedMove} failed and what better first move I should prioritize.`,
    });
  }

  if (insights.weakestTheme) {
    chips.push({
      id: 'weakest-theme',
      label: 'Show my weakest tactical theme.',
      prompt: `Show my weakest tactical theme and build a short drill around ${insights.weakestTheme}.`,
    });
    chips.push({
      id: 'train-this-theme',
      label: 'Train this pattern.',
      prompt: `Train this pattern with focused ${insights.weakestTheme} reps and no full line at first.`,
    });
  }

  if (insights.hasUploadedPosition) {
    chips.push({
      id: 'uploaded-position',
      label: 'Train this pattern.',
      prompt: 'Use my uploaded positions to train this pattern with one guided rep and one challenge rep.',
    });
  }

  if (hasConversation && !/hint/i.test(latestUserMessage)) {
    chips.push({
      id: 'hint-instead',
      label: 'Give me a hint instead.',
      prompt: 'Give me a hint instead. Keep it concise and do not reveal the full line yet.',
    });
  }

  if (insights.firstMoveAccuracyPercent !== null) {
    if (insights.trend === 'declining') {
      chips.push({
        id: 'trend-declining',
        label: 'I’m slipping. Stabilize me.',
        prompt: `My first-move accuracy is ${insights.firstMoveAccuracyPercent}%. Give me one stabilizing routine for this week.`,
      });
    } else if (insights.trend === 'improving') {
      chips.push({
        id: 'trend-improving',
        label: 'What am I improving at?',
        prompt: `My first-move accuracy is ${insights.firstMoveAccuracyPercent}%. Show what improved and what still leaks.`,
      });
    }
  }

  if (!hasConversation && !/mate|hint|line|theme/i.test(latestAssistantMessage)) {
    chips.push({
      id: 'conversation-open',
      label: 'Show my weakest tactical theme.',
      prompt: 'Show my weakest tactical theme and where it appeared in my recent puzzles.',
    });
  }

  const resolved = uniqueById(chips).slice(0, 5);
  if (resolved.length > 0) {
    return resolved;
  }
  return AGENT_FALLBACK_PROMPTS;
}

export function buildConversationalMomentumActions(
  input: AdaptiveSuggestionsInput,
): ConversationalMomentumAction[] {
  if (input.isSending) {
    return [];
  }

  const hasUserTurn = input.messages.some((message) => message.role === 'user');
  if (!hasUserTurn) {
    return [];
  }

  const latestMessage = input.messages[input.messages.length - 1];
  if (!latestMessage || latestMessage.role !== 'assistant') {
    return [];
  }

  const insights = summarizeSubmissionInsights(input.submissions);
  const latestUserMessage = [...input.messages].reverse().find((message) => message.role === 'user')?.text ?? '';

  const actions: ConversationalMomentumAction[] = [];
  const userAskedForHint = /hint/i.test(latestUserMessage);
  const userAskedForLine = /full line|variation|line/i.test(latestUserMessage);

  if (!userAskedForHint) {
    actions.push({
      id: 'action-give-hint',
      label: 'Give Hint',
      prompt: 'Give me one concrete hint without showing the full line.',
    });
  }

  if (!userAskedForLine) {
    actions.push({
      id: 'action-show-line',
      label: 'Show Full Line',
      prompt: 'Show the full line now with move order and key forcing points.',
    });
  }

  actions.push({
    id: 'action-explain-idea',
    label: 'Explain the Idea',
    prompt: 'Explain the core tactical idea in plain language and what cue should trigger it.',
  });

  if (insights.weakestTheme) {
    actions.push({
      id: 'action-train-theme',
      label: 'Train This Theme',
      prompt: `Train this theme (${insights.weakestTheme}) with three short reps and one tougher follow-up.`,
    });
    actions.push({
      id: 'action-save-weakness',
      label: 'Save Weakness',
      prompt: `Save ${insights.weakestTheme} as my active weakness focus and suggest a 10-minute daily plan.`,
    });
  }

  if (insights.trend === 'improving' || insights.firstMoveAccuracyPercent === null) {
    actions.push({
      id: 'action-challenge-friend',
      label: 'Challenge Friend',
      prompt: 'Give me a challenge puzzle prompt I can share with a friend, plus one spoiler-safe hint.',
    });
  }

  return uniqueById(actions).slice(0, 4);
}

export function buildInitialAgentMessages(): AgentChatMessage[] {
  return [
    {
      id: 'assistant-welcome',
      role: 'assistant',
      text: ASSISTANT_PERSONA_COPY.welcomeLong,
      timestamp: '11:02 AM',
    },
    {
      id: 'user-seed',
      role: 'user',
      text: 'What is my weakest theme?',
      timestamp: '11:04 AM',
    },
    {
      id: 'assistant-seed',
      role: 'assistant',
      text: ASSISTANT_PERSONA_COPY.seededAnalysis,
      timestamp: '11:05 AM',
    },
  ];
}

export function formatAgentTimestamp(date: Date): string {
  return date.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function appendUserMessage(
  messages: AgentChatMessage[],
  userMessage: string,
  now: Date = new Date(),
): AgentChatMessage[] {
  const trimmed = userMessage.trim();
  if (!trimmed) {
    return messages;
  }

  return [
    ...messages,
    {
      id: `user-${now.getTime()}`,
      role: 'user',
      text: trimmed,
      timestamp: formatAgentTimestamp(now),
    },
  ];
}

export function appendAssistantMessage(
  messages: AgentChatMessage[],
  assistantMessage: string,
  now: Date = new Date(),
): AgentChatMessage[] {
  const trimmed = assistantMessage.trim();
  if (!trimmed) {
    return messages;
  }
  const conversational = formatConversationalText(trimmed, {
    intent: 'chat',
    maxBeats: 5,
  });

  return [
    ...messages,
    {
      id: `assistant-${now.getTime()}`,
      role: 'assistant',
      text: conversational,
      timestamp: formatAgentTimestamp(now),
    },
  ];
}

export function appendMockAssistantTurn(
  messages: AgentChatMessage[],
  userMessage: string,
  now: Date = new Date(),
): AgentChatMessage[] {
  const trimmed = userMessage.trim();
  if (!trimmed) {
    return messages;
  }

  return appendAssistantMessage(
    appendUserMessage(messages, trimmed, now),
    ASSISTANT_PERSONA_COPY.mockBackendReply,
    now,
  );
}

export function applyStarterPromptToInput(prompt: string): string {
  return prompt;
}

function tokenizeSolverLine(rawLine: string): string[] {
  return rawLine
    .replace(/\d+\.(?:\.\.)?/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(
      (token) =>
        token.length > 0 &&
        token !== '1-0' &&
        token !== '0-1' &&
        token !== '1/2-1/2' &&
        token !== '*',
    );
}

export function deriveRequestedMode(userMessage: string): AssistantMode {
  const lowered = userMessage.toLowerCase();
  if (
    lowered.includes('hint') ||
    lowered.includes('full line') ||
    lowered.includes('candidate move') ||
    lowered.includes('forcing move') ||
    lowered.includes('overloaded')
  ) {
    return 'hint';
  }
  if (
    lowered.includes('theme') ||
    lowered.includes('tactic') ||
    lowered.includes('fork') ||
    lowered.includes('pin') ||
    lowered.includes('sacrifice')
  ) {
    return 'theme';
  }
  if (
    lowered.includes('explain') ||
    lowered.includes('why') ||
    lowered.includes('checkmate') ||
    lowered.includes('mate')
  ) {
    return 'explain';
  }
  return 'followup';
}

export function buildSolverLineFromStoredLines(solutionLines: string[]): string[] | null {
  const merged = solutionLines.flatMap((line) => tokenizeSolverLine(line));
  if (merged.length === 0) {
    return null;
  }
  return merged;
}

export function buildAssistantPayload(
  userMessage: string,
  context: PuzzleContextSnapshot,
  conversationMode: AssistantConversationMode = 'coach',
): AssistantRequestPayload {
  const requestedMode = deriveRequestedMode(userMessage);
  return {
    puzzle_id: context.puzzleId,
    fen: context.fen,
    solver_move_san: context.solverMoveSan,
    solver_line: context.solverLine,
    user_message: userMessage.trim(),
    requested_mode: requestedMode,
    conversation_mode: conversationMode,
  };
}
