import type { AssistantConversationMode } from '@/lib/assistant-conversation-mode';
import { getRequestAuthContextClient } from 'lib/getRequestAuthContextClient';

export type AgentChatResponse = {
  query: string;
  answer: string;
  referencedPuzzleId: string | null;
  referencedPuzzleSubmittedAt: string | null;
  referencedPuzzleFileName: string | null;
};

type AgentChatErrorPayload = {
  error?: {
    code?: unknown;
    message?: unknown;
  };
  detail?: unknown;
};

type AgentChatRequest = {
  query: string;
  limit?: number;
  conversationHistory?: Array<{ role: 'assistant' | 'user'; text: string }>;
  clientPuzzleHistory?: Array<Record<string, unknown>>;
  activeReferencedPuzzleId?: string | null;
  conversationMode?: AssistantConversationMode;
  signal?: AbortSignal;
  backendUrl?: string;
};

const DEFAULT_BACKEND_URL = 'http://127.0.0.1:8010';

function parseAgentChatResponse(payload: unknown): AgentChatResponse {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid response from assistant service.');
  }

  const candidate = payload as Record<string, unknown>;
  if (typeof candidate.query !== 'string' || typeof candidate.answer !== 'string') {
    throw new Error('Invalid response from assistant service.');
  }

  return {
    query: candidate.query,
    answer: candidate.answer.trim(),
    referencedPuzzleId:
      typeof candidate.referenced_puzzle_id === 'string' && candidate.referenced_puzzle_id.trim().length > 0
        ? candidate.referenced_puzzle_id
        : null,
    referencedPuzzleSubmittedAt:
      typeof candidate.referenced_puzzle_submitted_at === 'string' &&
      candidate.referenced_puzzle_submitted_at.trim().length > 0
        ? candidate.referenced_puzzle_submitted_at
        : null,
    referencedPuzzleFileName:
      typeof candidate.referenced_puzzle_file_name === 'string' &&
      candidate.referenced_puzzle_file_name.trim().length > 0
        ? candidate.referenced_puzzle_file_name
        : null,
  };
}

function parseErrorMessage(payload: AgentChatErrorPayload, fallback: string): string {
  if (payload.error && typeof payload.error.message === 'string' && payload.error.message.trim()) {
    return payload.error.message.trim();
  }

  if (payload.detail && typeof payload.detail === 'string' && payload.detail.trim()) {
    return payload.detail.trim();
  }

  if (payload.detail && typeof payload.detail === 'object') {
    const detailRecord = payload.detail as Record<string, unknown>;
    if (typeof detailRecord.message === 'string' && detailRecord.message.trim()) {
      return detailRecord.message.trim();
    }
  }

  return fallback;
}

export async function requestAgentChat({
  query,
  limit = 5,
  conversationHistory,
  clientPuzzleHistory,
  activeReferencedPuzzleId,
  conversationMode,
  signal,
  backendUrl,
}: AgentChatRequest): Promise<AgentChatResponse> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    throw new Error('Message cannot be empty.');
  }

  const rootUrl = backendUrl ?? process.env.NEXT_PUBLIC_BACKEND_URL ?? DEFAULT_BACKEND_URL;
  const auth = await getRequestAuthContextClient({ includeJsonContentType: true });
  if (!auth.hasAnyAuth) {
    throw new Error('Authentication is required.');
  }
  let response: Response;
  try {
    response = await fetch(`${rootUrl}/agent/chat`, {
      method: 'POST',
      headers: auth.headers,
      body: JSON.stringify({
        query: normalizedQuery,
        limit,
        conversation_history: conversationHistory ?? null,
        client_puzzle_history: clientPuzzleHistory ?? null,
        active_referenced_puzzle_id: activeReferencedPuzzleId ?? null,
        conversation_mode: conversationMode ?? 'coach',
      }),
      signal,
    });
  } catch (error: unknown) {
    const networkMessage =
      `Cannot reach assistant backend at ${rootUrl}. ` +
      `Start backend and verify ${rootUrl}/health returns {"status":"ok"}.`;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    throw new Error(networkMessage);
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const fallbackMessage = `Assistant request failed (${response.status}).`;
    const message = parseErrorMessage((payload ?? {}) as AgentChatErrorPayload, fallbackMessage);
    throw new Error(message);
  }

  return parseAgentChatResponse(payload);
}
