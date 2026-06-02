export type ParsedResponse<T = unknown> = {
  payload: T | null;
  text: string;
};

export async function readResponsePayload<T = unknown>(
  response: Response,
): Promise<ParsedResponse<T>> {
  const text = await response.text();
  if (!text.trim()) {
    return { payload: null, text };
  }

  try {
    return { payload: JSON.parse(text) as T, text };
  } catch {
    return { payload: null, text };
  }
}

export function responseErrorMessage(
  payload: unknown,
  fallback: string,
  rawText?: string,
): string {
  if (payload && typeof payload === 'object') {
    const candidate = payload as {
      detail?: unknown;
      error?: { message?: unknown } | unknown;
      message?: unknown;
    };

    if (
      candidate.error &&
      typeof candidate.error === 'object' &&
      typeof (candidate.error as { message?: unknown }).message === 'string' &&
      (candidate.error as { message: string }).message.trim()
    ) {
      return (candidate.error as { message: string }).message.trim();
    }
    if (typeof candidate.detail === 'string' && candidate.detail.trim()) {
      return candidate.detail.trim();
    }
    if (candidate.detail && typeof candidate.detail === 'object') {
      const detail = candidate.detail as { message?: unknown };
      if (typeof detail.message === 'string' && detail.message.trim()) {
        return detail.message.trim();
      }
    }
    if (typeof candidate.error === 'string' && candidate.error.trim()) {
      return candidate.error.trim();
    }
    if (typeof candidate.message === 'string' && candidate.message.trim()) {
      return candidate.message.trim();
    }
  }

  const trimmedText = rawText?.trim();
  if (trimmedText && !trimmedText.startsWith('<')) {
    return trimmedText.slice(0, 300);
  }

  return fallback;
}
