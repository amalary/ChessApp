export type AgentChatResponse = {
  query: string;
  answer: string;
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
  signal,
  backendUrl,
}: AgentChatRequest): Promise<AgentChatResponse> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    throw new Error('Message cannot be empty.');
  }

  const rootUrl = backendUrl ?? process.env.NEXT_PUBLIC_BACKEND_URL ?? DEFAULT_BACKEND_URL;
  let response: Response;
  try {
    response = await fetch(`${rootUrl}/agent/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: normalizedQuery, limit }),
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
