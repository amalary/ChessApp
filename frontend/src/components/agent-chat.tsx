'use client';

import React, { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { AlertCircle, CornerDownLeft, Loader2, Send, Square } from 'lucide-react';
import { requestAgentChat } from '@/lib/agent-chat-api';
import { getRequestAuthContextClient } from 'lib/getRequestAuthContextClient';
import {
  DEFAULT_ASSISTANT_CONVERSATION_MODE,
  getModeWelcomeShort,
  type AssistantConversationMode,
} from '@/lib/assistant-conversation-mode';
import {
  buildBeatScheduleMs,
  buildConversationalBeats,
} from '@/lib/assistant-rhythm';
import { AmyIdentityMark } from '@/components/amy-identity-mark';
import { readPuzzleSubmissions, type PuzzleSubmissionRecord } from '@/lib/puzzle-submissions';
import {
  buildAdaptiveSuggestionChips,
  buildConversationalMomentumActions,
  resolveReferencedPuzzle,
  type AgentReferencedPuzzle,
} from '@/app/dashboard/agent-chat-state';
import { readActiveLocalAuthUser } from '@/lib/dashboard-theme-settings';

type AgentChatRole = 'assistant' | 'user';

type AgentChatMessage = {
  id: string;
  role: AgentChatRole;
  text: string;
  timestamp: string;
  isError?: boolean;
  referencedPuzzle?: AgentReferencedPuzzle;
};

type AgentChatHistoryTurn = {
  role: AgentChatRole;
  text: string;
};

type PersistedAgentChatSession = {
  messages: AgentChatMessage[];
  isMomentumActionsSuppressed: boolean;
  lastActivityAtMs: number;
};

type AgentChatProps = {
  panelStyle?: React.CSSProperties;
  starterPrompts?: readonly string[];
  submissions?: PuzzleSubmissionRecord[];
  backendUrl?: string;
  conversationMode?: AssistantConversationMode;
  title?: string;
  subtitle?: string;
  placeholder?: string;
};

const ROTATING_INPUT_PROMPTS = [
  'Show me the tactic.',
  'What am I missing?',
  'Analyze my idea.',
  'Why does this fail?',
  'Help me calculate.',
] as const;
const AGENT_CHAT_SESSION_STORAGE_KEY = 'chessapp.agent.chat.session.v1';
const AGENT_CHAT_INACTIVITY_TIMEOUT_MS = 2 * 60 * 1000;
const AGENT_CHAT_TIMEOUT_POLL_MS = 10 * 1000;
const DEFAULT_BACKEND_URL = 'http://127.0.0.1:8010';
const IMAGE_REFERENCE_REQUEST_PATTERN =
  /\b(show|reference|pull up|bring up|which|that|this)\b.*\b(puzzle|puzzles|submission|submissions|image|images|position|positions)\b|\b(recent|latest|previous)\s+puzzles?\b|\b(most\s+recent)\s+puzzles?\b|\b(second|third|2nd|3rd)\s+(?:to\s+)?last\b|\b(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?:puzzles?|solves?|submissions?)\s+ago\b|\b(?:go|move|scroll)\s+back\s+(?:\d+|[a-z]+)\b|\bsubmission(?:\s+number)?\s*(?:#|no\.?|num(?:ber)?)?\s*\d+\b/i;
const PUZZLE_TARGET_PATTERN =
  /\b(puzzle|submission|position|latest|recent|last|previous|prior|earlier|older|that one|this one|one before that|one before last|second to last|third to last)\b|\.png\b|\.jpe?g\b|\b\d{4}-\d{2}-\d{2}\b/i;
const SOLUTION_EXPLANATION_PATTERN =
  /\b(explain|explained|why|solution|solutions|line|lines|variation|variations|best move|best moves|analyze|analysis|review|go over|what was)\b/i;
const HISTORY_INDEX_REFERENCE_PATTERN =
  /\b(previous|prior|ago|back|second|third|before that|one before that|one before last|second to last|third to last|older|earlier|latest|most recent|recent|last)\b/i;

function buildWelcomeMessage(conversationMode: AssistantConversationMode): AgentChatMessage {
  return {
    id: 'assistant-welcome',
    role: 'assistant',
    text: getModeWelcomeShort(conversationMode),
    timestamp: formatTimestamp(new Date()),
  };
}

function buildSessionStorageKey(): string {
  const activeLocalUser = readActiveLocalAuthUser();
  const userScope =
    activeLocalUser?.id ??
    activeLocalUser?.username ??
    activeLocalUser?.email ??
    'anonymous';
  const normalizedScope = userScope.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 96) || 'anonymous';
  return `${AGENT_CHAT_SESSION_STORAGE_KEY}.${normalizedScope}`;
}

function readPersistedSession(storageKey: string): PersistedAgentChatSession | null {
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
    const candidate = parsed as Partial<PersistedAgentChatSession>;
    if (!Array.isArray(candidate.messages) || typeof candidate.lastActivityAtMs !== 'number') {
      return null;
    }
    const normalizedMessages = candidate.messages.filter((message): message is AgentChatMessage => {
      if (!message || typeof message !== 'object') {
        return false;
      }
      return (
        typeof message.id === 'string' &&
        (message.role === 'assistant' || message.role === 'user') &&
        typeof message.text === 'string' &&
        typeof message.timestamp === 'string'
      );
    });
    if (normalizedMessages.length === 0) {
      return null;
    }
    return {
      messages: normalizedMessages,
      isMomentumActionsSuppressed: candidate.isMomentumActionsSuppressed === true,
      lastActivityAtMs: candidate.lastActivityAtMs,
    };
  } catch {
    return null;
  }
}

function isSessionExpired(lastActivityAtMs: number): boolean {
  return Date.now() - lastActivityAtMs > AGENT_CHAT_INACTIVITY_TIMEOUT_MS;
}

function writePersistedSession(storageKey: string, payload: PersistedAgentChatSession): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(storageKey, JSON.stringify(payload));
}

function clearPersistedSession(storageKey: string): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.removeItem(storageKey);
}

function persistSessionMessage(
  storageKey: string,
  message: AgentChatMessage,
  options?: {
    isMomentumActionsSuppressed?: boolean;
    lastActivityAtMs?: number;
  },
): void {
  const existing = readPersistedSession(storageKey);
  const existingMessages = existing?.messages ?? [];
  const alreadyPresent = existingMessages.some((item) => item.id === message.id);
  const nextMessages = alreadyPresent ? existingMessages : [...existingMessages, message];
  writePersistedSession(storageKey, {
    messages: nextMessages,
    isMomentumActionsSuppressed:
      options?.isMomentumActionsSuppressed ?? existing?.isMomentumActionsSuppressed ?? false,
    lastActivityAtMs: options?.lastActivityAtMs ?? Date.now(),
  });
}

function formatTimestamp(date: Date): string {
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function buildId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

function buildConversationHistory(
  messages: AgentChatMessage[],
  maxTurns: number = 12,
): AgentChatHistoryTurn[] {
  const normalized = messages
    .filter((message) => message.role === 'assistant' || message.role === 'user')
    .filter((message) => message.id !== 'assistant-welcome')
    .map((message) => ({
      role: message.role,
      text: message.text.trim(),
    }))
    .filter((message) => message.text.length > 0);

  if (normalized.length <= maxTurns) {
    return normalized;
  }
  return normalized.slice(-maxTurns);
}

function resolveActiveReferencedPuzzleId(messages: AgentChatMessage[]): string | null {
  for (let idx = messages.length - 1; idx >= 0; idx -= 1) {
    const message = messages[idx];
    if (message.role !== 'assistant') {
      continue;
    }
    const candidateId = message.referencedPuzzle?.id;
    if (typeof candidateId === 'string' && candidateId.trim().length > 0) {
      return candidateId;
    }
  }
  return null;
}

function buildClientPuzzleHistory(
  submissions: PuzzleSubmissionRecord[],
  maxItems: number = 500,
): Array<Record<string, unknown>> {
  return submissions.slice(0, maxItems).map((submission) => ({
    id: submission.id,
    fileName: submission.fileName,
    submittedAt: submission.submittedAt,
    fen: submission.fen ?? null,
    solveTimeMs: submission.solveTimeMs ?? null,
    puzzleElo: submission.puzzleElo ?? null,
    difficultyRating: submission.difficultyRating ?? null,
    estimatedDifficultyRating: submission.estimatedDifficultyRating ?? null,
    mateIn: submission.positionCheck?.mateIn ?? null,
    visionConfidence: submission.positionCheck?.confidence ?? null,
    attemptsUsed: submission.positionCheck?.attemptsUsed ?? null,
    firstMoveCorrect: submission.firstMoveAssessment?.isFirstMoveCorrect ?? null,
    firstMoveStatus: submission.firstMoveAssessment?.status ?? null,
    timeToFirstMoveSeconds: submission.firstMoveAssessment?.timeToFirstMoveSeconds ?? null,
    puzzleId: submission.firstMoveAssessment?.puzzleId ?? null,
    hasPuzzleImage:
      typeof submission.originalPuzzleImageDataUrl === 'string' &&
      submission.originalPuzzleImageDataUrl.startsWith('data:image/'),
    solutionLines: submission.solutionLines ?? [],
  }));
}

function resolveReferencedPuzzleById(
  submissions: PuzzleSubmissionRecord[],
  referencedPuzzleId: string | null,
): AgentReferencedPuzzle | null {
  if (!referencedPuzzleId) {
    return null;
  }
  const matched = submissions.find(
    (submission) =>
      submission.id === referencedPuzzleId &&
      typeof submission.originalPuzzleImageDataUrl === 'string' &&
      submission.originalPuzzleImageDataUrl.startsWith('data:image/'),
  );
  if (!matched || typeof matched.originalPuzzleImageDataUrl !== 'string') {
    return null;
  }
  return {
    id: matched.id,
    fileName: matched.fileName || 'Uploaded puzzle',
    submittedAt: matched.submittedAt,
    fen: matched.fen ?? null,
    imageDataUrl: matched.originalPuzzleImageDataUrl,
  };
}

function resolveReferencedPuzzleBySelectors(
  submissions: PuzzleSubmissionRecord[],
  selectors: {
    referencedPuzzleSubmittedAt: string | null;
    referencedPuzzleFileName: string | null;
  },
): AgentReferencedPuzzle | null {
  const submittedAt = selectors.referencedPuzzleSubmittedAt;
  const fileName = selectors.referencedPuzzleFileName;
  if (!submittedAt && !fileName) {
    return null;
  }

  const matched = submissions.find((submission) => {
    const hasImage =
      typeof submission.originalPuzzleImageDataUrl === 'string' &&
      submission.originalPuzzleImageDataUrl.startsWith('data:image/');
    if (!hasImage) {
      return false;
    }
    const sameTime = submittedAt ? submission.submittedAt === submittedAt : true;
    const sameName = fileName ? submission.fileName === fileName : true;
    return sameTime && sameName;
  });

  if (!matched || typeof matched.originalPuzzleImageDataUrl !== 'string') {
    return null;
  }
  return {
    id: matched.id,
    fileName: matched.fileName || 'Uploaded puzzle',
    submittedAt: matched.submittedAt,
    fen: matched.fen ?? null,
    imageDataUrl: matched.originalPuzzleImageDataUrl,
  };
}

function isExplicitImageReferenceRequest(userMessage: string): boolean {
  const text = userMessage.trim();
  if (!text) {
    return false;
  }
  return IMAGE_REFERENCE_REQUEST_PATTERN.test(text);
}

function shouldRenderPuzzleReferenceForRequest(userMessage: string): boolean {
  const text = userMessage.trim();
  if (!text) {
    return false;
  }
  if (isExplicitImageReferenceRequest(text)) {
    return true;
  }
  return PUZZLE_TARGET_PATTERN.test(text) && SOLUTION_EXPLANATION_PATTERN.test(text);
}

async function fetchPuzzleSubmissionsFromBackend(
  backendUrl?: string,
): Promise<PuzzleSubmissionRecord[] | null> {
  const auth = await getRequestAuthContextClient();
  if (!auth.hasAnyAuth) {
    return null;
  }

  const rootUrl = backendUrl ?? process.env.NEXT_PUBLIC_BACKEND_URL ?? DEFAULT_BACKEND_URL;
  let response: Response;
  try {
    response = await fetch(`${rootUrl}/puzzles/submissions?limit=500`, {
      method: 'GET',
      headers: auth.headers,
    });
  } catch {
    return null;
  }

  if (!response.ok) {
    return null;
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return null;
  }

  if (!Array.isArray(payload)) {
    return null;
  }

  return payload
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map((item) => {
      const positionCheck =
        item.positionCheck && typeof item.positionCheck === 'object'
          ? (item.positionCheck as Record<string, unknown>)
          : {};
      const firstMoveAssessment =
        item.firstMoveAssessment && typeof item.firstMoveAssessment === 'object'
          ? (item.firstMoveAssessment as Record<string, unknown>)
          : null;
      return {
        id: typeof item.id === 'string' ? item.id : '',
        fileName: typeof item.fileName === 'string' ? item.fileName : '',
        submittedAt: typeof item.submittedAt === 'string' ? item.submittedAt : '',
        expectedSideToMove:
          item.expectedSideToMove === 'black' ? 'black' : 'white',
        fen: typeof item.fen === 'string' ? item.fen : null,
        solveTimeMs:
          typeof item.solveTimeMs === 'number' && Number.isFinite(item.solveTimeMs)
            ? item.solveTimeMs
            : null,
        puzzleElo:
          typeof item.puzzleElo === 'number' && Number.isFinite(item.puzzleElo)
            ? item.puzzleElo
            : null,
        difficultyRating:
          typeof item.difficultyRating === 'number' && Number.isFinite(item.difficultyRating)
            ? item.difficultyRating
            : null,
        estimatedDifficultyRating:
          typeof item.estimatedDifficultyRating === 'number' &&
          Number.isFinite(item.estimatedDifficultyRating)
            ? item.estimatedDifficultyRating
            : null,
        originalPuzzleImageDataUrl:
          typeof item.originalPuzzleImageDataUrl === 'string'
            ? item.originalPuzzleImageDataUrl
            : null,
        positionCheck: {
          sideToMove:
            positionCheck.sideToMove === 'white' || positionCheck.sideToMove === 'black'
              ? positionCheck.sideToMove
              : null,
          confidence:
            typeof positionCheck.confidence === 'number' && Number.isFinite(positionCheck.confidence)
              ? positionCheck.confidence
              : null,
          attemptsUsed:
            typeof positionCheck.attemptsUsed === 'number' &&
            Number.isFinite(positionCheck.attemptsUsed)
              ? positionCheck.attemptsUsed
              : null,
          mateFound: typeof positionCheck.mateFound === 'boolean' ? positionCheck.mateFound : null,
          mateIn:
            typeof positionCheck.mateIn === 'number' && Number.isFinite(positionCheck.mateIn)
              ? positionCheck.mateIn
              : null,
        },
        solutionLines: Array.isArray(item.solutionLines)
          ? item.solutionLines.filter((line): line is string => typeof line === 'string')
          : [],
        firstMoveAssessment:
          firstMoveAssessment &&
          typeof firstMoveAssessment.firstMove === 'string' &&
          typeof firstMoveAssessment.isFirstMoveCorrect === 'boolean' &&
          typeof firstMoveAssessment.status === 'string' &&
          typeof firstMoveAssessment.timeToFirstMoveSeconds === 'number' &&
          typeof firstMoveAssessment.puzzleId === 'string' &&
          typeof firstMoveAssessment.attemptId === 'string' &&
          typeof firstMoveAssessment.createdAt === 'string' &&
          typeof firstMoveAssessment.isValidForFirstMoveAccuracy === 'boolean'
            ? {
                firstMove: firstMoveAssessment.firstMove,
                bestMove:
                  typeof firstMoveAssessment.bestMove === 'string'
                    ? firstMoveAssessment.bestMove
                    : null,
                isFirstMoveCorrect: firstMoveAssessment.isFirstMoveCorrect,
                status:
                  firstMoveAssessment.status === 'correct' ||
                  firstMoveAssessment.status === 'incorrect' ||
                  firstMoveAssessment.status === 'almost_correct'
                    ? firstMoveAssessment.status
                    : 'incorrect',
                timeToFirstMoveSeconds: firstMoveAssessment.timeToFirstMoveSeconds,
                puzzleId: firstMoveAssessment.puzzleId,
                userId:
                  typeof firstMoveAssessment.userId === 'string'
                    ? firstMoveAssessment.userId
                    : null,
                attemptId: firstMoveAssessment.attemptId,
                createdAt: firstMoveAssessment.createdAt,
                isValidForFirstMoveAccuracy: firstMoveAssessment.isValidForFirstMoveAccuracy,
                invalidReason:
                  typeof firstMoveAssessment.invalidReason === 'string'
                    ? firstMoveAssessment.invalidReason
                    : null,
              }
            : null,
      } satisfies PuzzleSubmissionRecord;
    })
    .filter((item) => item.id.length > 0 && item.submittedAt.length > 0);
}

async function fetchReferencedPuzzleByIdFromBackend(
  referencedPuzzleId: string | null,
  backendUrl?: string,
): Promise<AgentReferencedPuzzle | null> {
  if (!referencedPuzzleId) {
    return null;
  }

  const submissions = await fetchPuzzleSubmissionsFromBackend(backendUrl);
  if (!submissions) {
    return null;
  }

  return resolveReferencedPuzzleById(submissions, referencedPuzzleId);
}

function MessageBubble({ message }: { message: AgentChatMessage }) {
  const isAssistant = message.role === 'assistant';
  const bubbleToneClass = isAssistant
    ? message.isError
      ? 'amy-chat-bubble--error'
      : 'amy-chat-bubble--assistant'
    : 'amy-chat-bubble--user';

  return (
    <article className={`chess-stream-item flex ${isAssistant ? 'justify-start' : 'justify-end'}`}>
      <div className={`amy-chat-bubble ${bubbleToneClass} max-w-[94%] rounded-2xl px-4 py-3 sm:max-w-[86%]`}>
        {isAssistant && !message.isError && (
          <p className="amy-chat-bubble__speaker mb-2 text-[10px] font-semibold uppercase tracking-[0.18em]">
            Amy
          </p>
        )}
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.text}</p>
        {isAssistant && !message.isError && message.referencedPuzzle && (
          <div className="mt-3 rounded-xl border border-slate-200/85 bg-white/90 p-2.5 dark:border-slate-500/70 dark:bg-slate-900/80">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-300">
              Referenced Puzzle
            </p>
            <div className="mt-2 overflow-hidden rounded-lg border border-slate-200/85 bg-slate-100 dark:border-slate-500/65 dark:bg-slate-800/70">
              <Image
                src={message.referencedPuzzle.imageDataUrl}
                alt="Referenced puzzle image"
                width={640}
                height={360}
                sizes="(max-width: 640px) 100vw, 640px"
                unoptimized
                className="h-auto max-h-56 w-full object-contain"
                loading="lazy"
              />
            </div>
          </div>
        )}

        <p className="amy-chat-bubble__time mt-2 text-[11px]">
          {message.timestamp}
        </p>
      </div>
    </article>
  );
}

export function AgentChat({
  panelStyle,
  starterPrompts = [],
  submissions = [],
  backendUrl,
  conversationMode = DEFAULT_ASSISTANT_CONVERSATION_MODE,
  title = 'Amy',
  subtitle = 'Calm, strategic coaching with progressive chess guidance.',
  placeholder = 'Ask Amy for a hint, candidate-move check, or full line...',
}: AgentChatProps) {
  const sessionStorageKeyRef = useRef<string>(buildSessionStorageKey());
  const hasLoadedSessionRef = useRef<boolean>(false);
  const isComponentMountedRef = useRef<boolean>(true);
  const [messages, setMessages] = useState<AgentChatMessage[]>(() => [buildWelcomeMessage(conversationMode)]);
  const [input, setInput] = useState('');
  const [inputPromptIndex, setInputPromptIndex] = useState(0);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isMomentumActionsSuppressed, setIsMomentumActionsSuppressed] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [sessionStatusMessage, setSessionStatusMessage] = useState<string | null>(null);
  const [lastActivityAtMs, setLastActivityAtMs] = useState<number>(() => Date.now());
  const endRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const activeRequestRef = useRef<AbortController | null>(null);
  const assistantBeatTimersRef = useRef<number[]>([]);

  const canSend = input.trim().length > 0 && !isSending;
  const rotatingPlaceholder = ROTATING_INPUT_PROMPTS[inputPromptIndex] ?? placeholder;
  const adaptiveSuggestions = React.useMemo(() => {
    const adaptive = buildAdaptiveSuggestionChips({
      submissions,
      messages,
      isSending,
    });
    if (adaptive.length > 0) {
      return adaptive;
    }

    return starterPrompts.slice(0, 5).map((prompt, index) => ({
      id: `legacy-${index}-${prompt}`,
      label: prompt,
      prompt,
    }));
  }, [isSending, messages, starterPrompts, submissions]);
  const momentumActions = React.useMemo(
    () =>
      buildConversationalMomentumActions({
        submissions,
        messages,
        isSending,
      }),
    [isSending, messages, submissions],
  );
  const shouldShowMomentumActions = momentumActions.length > 0 && !isMomentumActionsSuppressed;
  const hasConversationStarted = messages.some((message) => message.role === 'user');

  const stopActiveRequest = React.useCallback(() => {
    const controller = activeRequestRef.current;
    if (!controller) {
      return;
    }
    controller.abort();
  }, []);

  const resetConversation = React.useCallback(
    (reason: 'manual' | 'inactive') => {
      stopActiveRequest();
      setIsSending(false);
      setInput('');
      setErrorMessage(null);
      setIsMomentumActionsSuppressed(false);
      setMessages([buildWelcomeMessage(conversationMode)]);
      const now = Date.now();
      setLastActivityAtMs(now);
      clearPersistedSession(sessionStorageKeyRef.current);
      setSessionStatusMessage(
        reason === 'manual'
          ? 'Conversation ended. Start a new chat any time.'
          : 'Conversation ended after 2 minutes of inactivity.',
      );
    },
    [conversationMode, stopActiveRequest],
  );

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, isSending]);

  useEffect(() => {
    const latestMessage = messages[messages.length - 1];
    const hasUserTurn = messages.some((message) => message.role === 'user');
    if (latestMessage?.role === 'assistant' && hasUserTurn) {
      setIsMomentumActionsSuppressed(false);
    }
  }, [messages]);

  useEffect(() => {
    isComponentMountedRef.current = true;
    return () => {
      isComponentMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (isInputFocused || input.trim().length > 0 || isSending) {
      return;
    }
    const timer = window.setInterval(() => {
      setInputPromptIndex((previous) => (previous + 1) % ROTATING_INPUT_PROMPTS.length);
    }, 2600);
    return () => window.clearInterval(timer);
  }, [input, isInputFocused, isSending]);

  useEffect(() => {
    if (hasLoadedSessionRef.current) {
      return;
    }
    const storageKey = buildSessionStorageKey();
    sessionStorageKeyRef.current = storageKey;
    const persisted = readPersistedSession(storageKey);
    if (persisted && !isSessionExpired(persisted.lastActivityAtMs)) {
      setMessages(persisted.messages);
      setIsMomentumActionsSuppressed(persisted.isMomentumActionsSuppressed);
      setLastActivityAtMs(persisted.lastActivityAtMs);
      setSessionStatusMessage('Conversation restored.');
      hasLoadedSessionRef.current = true;
      return;
    }

    clearPersistedSession(storageKey);
    setMessages([buildWelcomeMessage(conversationMode)]);
    const now = Date.now();
    setLastActivityAtMs(now);
    if (persisted && isSessionExpired(persisted.lastActivityAtMs)) {
      setSessionStatusMessage('Previous conversation expired after inactivity.');
    } else {
      setSessionStatusMessage(null);
    }
    hasLoadedSessionRef.current = true;
  }, [conversationMode]);

  useEffect(() => {
    if (!hasLoadedSessionRef.current) {
      return;
    }
    writePersistedSession(sessionStorageKeyRef.current, {
      messages,
      isMomentumActionsSuppressed,
      lastActivityAtMs,
    });
  }, [isMomentumActionsSuppressed, lastActivityAtMs, messages]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (isSending) {
        return;
      }
      if (!messages.some((message) => message.role === 'user')) {
        return;
      }
      if (isSessionExpired(lastActivityAtMs)) {
        resetConversation('inactive');
      }
    }, AGENT_CHAT_TIMEOUT_POLL_MS);
    return () => window.clearInterval(timer);
  }, [isSending, lastActivityAtMs, messages, resetConversation]);

  const appendAssistantBeats = async (
    rawText: string,
    userMessage: string,
    signal: AbortSignal,
    isError = false,
    referencedPuzzle: AgentReferencedPuzzle | null = null,
  ) => {
    const beats = buildConversationalBeats(rawText, {
      intent: isError ? 'status' : 'chat',
    });
    if (beats.length === 0 || signal.aborted) {
      return;
    }

    const schedule = buildBeatScheduleMs(beats, isError ? 'status' : 'chat');
    const shouldUseReferenceRevealPrompt =
      !isError &&
      referencedPuzzle !== null &&
      isExplicitImageReferenceRequest(userMessage);
    assistantBeatTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    assistantBeatTimersRef.current = [];

    await new Promise<void>((resolve) => {
      let settled = false;
      const handleAbort = () => {
        assistantBeatTimersRef.current.forEach((timer) => window.clearTimeout(timer));
        assistantBeatTimersRef.current = [];
        settle();
      };
      const settle = () => {
        if (!settled) {
          settled = true;
          signal.removeEventListener('abort', handleAbort);
          resolve();
        }
      };
      signal.addEventListener('abort', handleAbort, { once: true });

      beats.forEach((beat, idx) => {
        const timer = window.setTimeout(() => {
          if (signal.aborted || !isComponentMountedRef.current) {
            if (!signal.aborted) {
              settle();
            }
            return;
          }
          setMessages((previous) => [
            ...previous,
            {
              id: buildId(isError ? 'assistant-error' : 'assistant'),
              role: 'assistant',
              text: beat,
              timestamp: formatTimestamp(new Date()),
              isError: isError || undefined,
              referencedPuzzle:
                !isError &&
                referencedPuzzle !== null &&
                !shouldUseReferenceRevealPrompt &&
                idx === beats.length - 1
                  ? referencedPuzzle
                  : undefined,
            },
          ]);
          setLastActivityAtMs(Date.now());
          if (idx === beats.length - 1) {
            settle();
          }
        }, schedule[idx]);
        assistantBeatTimersRef.current.push(timer);
      });
    });

    if (!signal.aborted && shouldUseReferenceRevealPrompt && isComponentMountedRef.current) {
      setMessages((previous) => [
        ...previous,
        {
          id: buildId('assistant'),
          role: 'assistant',
          text: 'Oh this one?',
          timestamp: formatTimestamp(new Date()),
          referencedPuzzle: referencedPuzzle ?? undefined,
        },
      ]);
      setLastActivityAtMs(Date.now());
    }
  };

  const submitMessage = async (rawMessage: string) => {
    const trimmed = rawMessage.trim();
    if (!trimmed || isSending) {
      return;
    }

    const now = new Date();
    const userMessage: AgentChatMessage = {
      id: buildId('user'),
      role: 'user',
      text: trimmed,
      timestamp: formatTimestamp(now),
    };
    setErrorMessage(null);
    setSessionStatusMessage(null);
    setInput('');
    setIsMomentumActionsSuppressed(true);
    setLastActivityAtMs(Date.now());
    setMessages((previous) => [
      ...previous,
      userMessage,
    ]);
    persistSessionMessage(sessionStorageKeyRef.current, userMessage, {
      isMomentumActionsSuppressed: true,
      lastActivityAtMs: Date.now(),
    });

    const controller = new AbortController();
    activeRequestRef.current = controller;
    setIsSending(true);
    assistantBeatTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    assistantBeatTimersRef.current = [];

    try {
      const effectiveSubmissions =
        submissions.length > 0 ? submissions : readPuzzleSubmissions();
      const activeReferencedPuzzleId = resolveActiveReferencedPuzzleId(messages);
      const result = await requestAgentChat({
        query: trimmed,
        limit: 5,
        conversationHistory: buildConversationHistory(messages),
        clientPuzzleHistory: buildClientPuzzleHistory(effectiveSubmissions),
        activeReferencedPuzzleId,
        conversationMode,
        signal: controller.signal,
        backendUrl,
      });
      const answerText = result.answer.trim() || 'No answer returned.';
      const shouldRenderReferenceCard = shouldRenderPuzzleReferenceForRequest(trimmed);
      let referencedPuzzle: AgentReferencedPuzzle | null = null;
      if (shouldRenderReferenceCard) {
        const backendScopedSubmissions = await fetchPuzzleSubmissionsFromBackend(backendUrl);
        if (backendScopedSubmissions) {
          referencedPuzzle =
            resolveReferencedPuzzleById(backendScopedSubmissions, result.referencedPuzzleId) ??
            resolveReferencedPuzzleBySelectors(backendScopedSubmissions, {
              referencedPuzzleSubmittedAt: result.referencedPuzzleSubmittedAt,
              referencedPuzzleFileName: result.referencedPuzzleFileName,
            });
          if (!referencedPuzzle) {
            referencedPuzzle =
              resolveReferencedPuzzleById(effectiveSubmissions, result.referencedPuzzleId) ??
              resolveReferencedPuzzleBySelectors(effectiveSubmissions, {
                referencedPuzzleSubmittedAt: result.referencedPuzzleSubmittedAt,
                referencedPuzzleFileName: result.referencedPuzzleFileName,
              });
          }
        } else {
          referencedPuzzle =
            resolveReferencedPuzzleById(effectiveSubmissions, result.referencedPuzzleId) ??
            resolveReferencedPuzzleBySelectors(effectiveSubmissions, {
              referencedPuzzleSubmittedAt: result.referencedPuzzleSubmittedAt,
              referencedPuzzleFileName: result.referencedPuzzleFileName,
            });
          if (!referencedPuzzle && result.referencedPuzzleId) {
            referencedPuzzle = await fetchReferencedPuzzleByIdFromBackend(
              result.referencedPuzzleId,
              backendUrl,
            );
          }
        }
        if (!referencedPuzzle) {
          referencedPuzzle = resolveReferencedPuzzle({
            submissions: effectiveSubmissions,
            userMessage: trimmed,
            assistantMessage: answerText,
          });
        } else if (
          isExplicitImageReferenceRequest(trimmed) &&
          HISTORY_INDEX_REFERENCE_PATTERN.test(trimmed)
        ) {
          const inferredReferencedPuzzle = resolveReferencedPuzzle({
            submissions: effectiveSubmissions,
            userMessage: trimmed,
            assistantMessage: answerText,
          });
          if (inferredReferencedPuzzle) {
            referencedPuzzle = inferredReferencedPuzzle;
          }
        }
      }
      if (!isComponentMountedRef.current) {
        persistSessionMessage(
          sessionStorageKeyRef.current,
          {
            id: buildId('assistant'),
            role: 'assistant',
            text: answerText,
            timestamp: formatTimestamp(new Date()),
            referencedPuzzle: referencedPuzzle ?? undefined,
          },
          {
            isMomentumActionsSuppressed: false,
            lastActivityAtMs: Date.now(),
          },
        );
      } else {
        await appendAssistantBeats(answerText, trimmed, controller.signal, false, referencedPuzzle);
      }
    } catch (error: unknown) {
      if (controller.signal.aborted) {
        return;
      }
      const message =
        error instanceof Error && error.message.trim()
          ? error.message
          : 'Assistant request failed. Please try again.';
      if (!isComponentMountedRef.current) {
        persistSessionMessage(
          sessionStorageKeyRef.current,
          {
            id: buildId('assistant-error'),
            role: 'assistant',
            text: message,
            timestamp: formatTimestamp(new Date()),
            isError: true,
          },
          {
            isMomentumActionsSuppressed: false,
            lastActivityAtMs: Date.now(),
          },
        );
      } else {
        setErrorMessage(message);
        await appendAssistantBeats(message, trimmed, controller.signal, true);
      }
    } finally {
      if (activeRequestRef.current === controller) {
        activeRequestRef.current = null;
      }
      if (isComponentMountedRef.current) {
        setIsSending(false);
        inputRef.current?.focus();
      }
    }
  };

  useEffect(() => {
    setMessages((previous) => {
      if (previous.length === 0) {
        return previous;
      }
      const [first, ...rest] = previous;
      if (first.id !== 'assistant-welcome') {
        return previous;
      }
      return [
        {
          ...first,
          text: getModeWelcomeShort(conversationMode),
        },
        ...rest,
      ];
    });
  }, [conversationMode]);

  return (
    <section
      className="amy-chat-shell rounded-[28px] border border-slate-200/75 bg-white/70 p-4 shadow-[0_18px_44px_rgba(2,6,23,0.16)] backdrop-blur-xl dark:border-slate-500/55 dark:bg-slate-950/72 dark:shadow-[0_18px_44px_rgba(2,6,23,0.42)] md:p-6"
      style={panelStyle}
    >
      <header className="amy-chat-header mb-4 flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <AmyIdentityMark size="md" />
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-zinc-800 dark:text-white" style={{ color: 'rgb(var(--fg))' }}>
              {title}
            </h2>
            <p className="mt-1 text-sm text-zinc-700 dark:text-white" style={{ color: 'rgb(var(--fg))' }}>
              {subtitle}
            </p>
            <p className="mt-1 text-[11px] font-medium uppercase tracking-[0.14em] text-cyan-700/75 dark:text-cyan-200/85">
              Strategic companion | emotionally aware | modern coach
            </p>
          </div>
        </div>
        <div>
          <span className="amy-presence-pill" aria-label="Amy is present">
            Amy online
          </span>
          {hasConversationStarted && (
            <button
              type="button"
              onClick={() => resetConversation('manual')}
              disabled={isSending}
              className="mt-2 inline-flex w-auto items-center justify-center self-start rounded-xl border border-rose-700/80 bg-[crimson] px-3 py-1.5 text-xs font-semibold text-white transition-all duration-200 hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              End conversation
            </button>
          )}
        </div>
      </header>
      {sessionStatusMessage && (
        <div className="mb-3 rounded-xl border border-slate-300/70 bg-white/72 px-3 py-2 text-xs text-zinc-700 dark:border-slate-500/65 dark:bg-slate-900/72 dark:text-zinc-200">
          {sessionStatusMessage}
        </div>
      )}

      <div className="amy-chat-stage neumo-inset relative overflow-hidden rounded-2xl border border-slate-200/70 px-3 py-3 dark:border-slate-500/60 dark:bg-slate-950/58 md:px-4">
        <div className="amy-chat-stage__gradient" aria-hidden="true" />
        <div className="amy-chat-stage__veil" aria-hidden="true" />
        <div className="amy-chat-stage__haze" aria-hidden="true" />
        <div className="amy-chat-stage__glow amy-chat-stage__glow--a" aria-hidden="true" />
        <div className="amy-chat-stage__glow amy-chat-stage__glow--b" aria-hidden="true" />
        <div className="amy-chat-stage__grain" aria-hidden="true" />
        <div className="amy-chat-stage__silhouette amy-chat-stage__silhouette--queen" aria-hidden="true" />
        <div className="amy-chat-stage__silhouette amy-chat-stage__silhouette--knight" aria-hidden="true" />
        <div className="amy-chat-stage__particles" aria-hidden="true" />
        <div
          className="relative z-10 max-h-[54vh] min-h-[280px] space-y-3 overflow-y-auto pr-1 sm:min-h-[320px]"
          aria-live="polite"
          aria-label="Assistant chat message history"
        >
          {messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))}

          {isSending && (
            <article className="flex justify-start">
              <div className="amy-chat-bubble amy-chat-bubble--assistant inline-flex items-center gap-2 rounded-2xl px-3 py-2 text-xs">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                Amy is thinking...
              </div>
            </article>
          )}
          {shouldShowMomentumActions && (
            <article className="flex justify-start">
              <div className="amy-chat-continue w-full rounded-2xl border border-slate-200/70 bg-white/70 px-3 py-2 backdrop-blur-lg dark:border-slate-400/70 dark:bg-slate-200/90">
                <p className="amy-chat-continue__title mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-600 dark:text-zinc-900">
                  Continue With Amy
                </p>
                <div className="flex flex-wrap gap-2">
                  {momentumActions.map((action) => (
                    <button
                      key={action.id}
                      type="button"
                      onClick={() => {
                        setIsMomentumActionsSuppressed(true);
                        void submitMessage(action.prompt);
                      }}
                      disabled={isSending}
                      className="amy-chat-continue__action rounded-full border border-cyan-300/35 bg-gradient-to-r from-white/90 to-cyan-50/80 px-3 py-1.5 text-xs font-semibold text-zinc-700 transition-all duration-200 hover:-translate-y-[1px] hover:border-cyan-300/55 hover:shadow-[0_8px_18px_rgba(2,6,23,0.1)] disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-500/70 dark:from-slate-100 dark:to-slate-200 dark:text-zinc-900 dark:hover:border-slate-600 dark:hover:shadow-[0_8px_18px_rgba(2,6,23,0.18)]"
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              </div>
            </article>
          )}
          <div ref={endRef} />
        </div>
      </div>

      {adaptiveSuggestions.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {adaptiveSuggestions.map((chip) => (
            <button
              key={chip.id}
              type="button"
              onClick={() => {
                void submitMessage(chip.prompt);
              }}
              disabled={isSending}
              className="rounded-full border border-slate-300/70 bg-white/82 px-3.5 py-1.5 text-xs font-medium text-zinc-700 transition-all duration-200 hover:-translate-y-[1px] hover:border-cyan-300/55 hover:bg-cyan-50/80 disabled:cursor-not-allowed disabled:opacity-60 dark:border-cyan-200/35 dark:bg-slate-900/72 dark:text-zinc-100 dark:hover:border-cyan-200/55 dark:hover:bg-slate-800/80"
            >
              {chip.label}
            </button>
          ))}
        </div>
      )}

      {errorMessage && (
        <div
          className="mt-4 flex items-start gap-2 rounded-xl border border-rose-400/40 bg-rose-50/90 px-3 py-2 text-sm text-rose-900 dark:border-rose-300/35 dark:bg-rose-600/20 dark:text-rose-100"
          role="alert"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>{errorMessage}</p>
        </div>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submitMessage(input);
        }}
        className="amy-chat-input-shell mt-4 rounded-2xl p-3"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="amy-chat-input-wrap">
            <input
              ref={inputRef}
              value={input}
              onChange={(event) => {
                const nextInput = event.target.value;
                if (nextInput.trim().length > 0) {
                  setIsMomentumActionsSuppressed(true);
                }
                setInput(nextInput);
                setLastActivityAtMs(Date.now());
              }}
              onFocus={() => setIsInputFocused(true)}
              onBlur={() => setIsInputFocused(false)}
              disabled={isSending}
              placeholder={rotatingPlaceholder}
              className="amy-chat-input h-11 w-full rounded-2xl px-4 text-sm outline-none"
              aria-label="Ask Amy"
            />
          </div>
          <button
            type={isSending ? 'button' : 'submit'}
            onClick={
              isSending
                ? () => {
                    stopActiveRequest();
                  }
                : undefined
            }
            disabled={!isSending && !canSend}
            className={`amy-chat-send-btn inline-flex h-11 min-w-[112px] items-center justify-center gap-2 rounded-2xl px-4 text-sm font-semibold ${
              !isSending && canSend ? 'amy-chat-send-btn--ready' : ''
            }`}
            aria-label={isSending ? 'Stop assistant response' : 'Send message'}
          >
            {isSending ? <Square className="h-4 w-4" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
            <span className="hidden sm:inline">{isSending ? 'Stop' : 'Send'}</span>
          </button>
        </div>
        <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-100">
          <CornerDownLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Press Enter to send
        </p>
      </form>
    </section>
  );
}
