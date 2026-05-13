'use client';

import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, Bot, CornerDownLeft, Loader2, Send } from 'lucide-react';
import { requestAgentChat } from '@/lib/agent-chat-api';

type AgentChatRole = 'assistant' | 'user';

type AgentChatMessage = {
  id: string;
  role: AgentChatRole;
  text: string;
  timestamp: string;
  isError?: boolean;
};

type AgentChatProps = {
  panelStyle?: React.CSSProperties;
  starterPrompts?: readonly string[];
  backendUrl?: string;
  title?: string;
  subtitle?: string;
  placeholder?: string;
};

function formatTimestamp(date: Date): string {
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function buildId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

function MessageBubble({ message }: { message: AgentChatMessage }) {
  const isAssistant = message.role === 'assistant';

  return (
    <article className={`chess-stream-item flex ${isAssistant ? 'justify-start' : 'justify-end'}`}>
      <div
        className={`max-w-[94%] rounded-2xl px-4 py-3 shadow-[0_14px_28px_rgba(2,6,23,0.2)] backdrop-blur-xl sm:max-w-[86%] ${
          isAssistant
            ? message.isError
              ? 'border border-rose-400/35 bg-rose-50/85 text-rose-900 dark:border-rose-300/35 dark:bg-rose-600/20 dark:text-rose-100'
              : 'border border-cyan-200/65 bg-gradient-to-br from-white/90 via-cyan-50/75 to-indigo-50/80 text-zinc-800 dark:border-cyan-300/30 dark:from-slate-900/95 dark:via-slate-800/92 dark:to-indigo-900/72 dark:text-zinc-50'
            : 'border border-violet-400/30 bg-gradient-to-br from-violet-500/85 to-indigo-500/85 text-white dark:border-violet-300/20 dark:from-violet-500/45 dark:to-indigo-500/45'
        }`}
      >
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.text}</p>

        <p
          className={`mt-2 text-[11px] ${
            isAssistant ? 'text-zinc-600 dark:text-cyan-100/95' : 'text-violet-100/90'
          }`}
        >
          {message.timestamp}
        </p>
      </div>
    </article>
  );
}

export function AgentChat({
  panelStyle,
  starterPrompts = [],
  backendUrl,
  title = 'Chess Assistant',
  subtitle = 'Ask about your puzzles, app workflows, or training plan.',
  placeholder = 'Ask a question...',
}: AgentChatProps) {
  const [messages, setMessages] = useState<AgentChatMessage[]>([
    {
      id: 'assistant-welcome',
      role: 'assistant',
      text: "Hi, I'm your chess assistant. Ask anything about your puzzle work and app usage.",
      timestamp: formatTimestamp(new Date()),
    },
  ]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const activeRequestRef = useRef<AbortController | null>(null);

  const canSend = input.trim().length > 0 && !isSending;

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, isSending]);

  useEffect(() => {
    return () => {
      activeRequestRef.current?.abort();
    };
  }, []);

  const submitMessage = async (rawMessage: string) => {
    const trimmed = rawMessage.trim();
    if (!trimmed || isSending) {
      return;
    }

    const now = new Date();
    setErrorMessage(null);
    setInput('');
    setMessages((previous) => [
      ...previous,
      {
        id: buildId('user'),
        role: 'user',
        text: trimmed,
        timestamp: formatTimestamp(now),
      },
    ]);

    const controller = new AbortController();
    activeRequestRef.current = controller;
    setIsSending(true);

    try {
      const result = await requestAgentChat({
        query: trimmed,
        limit: 5,
        signal: controller.signal,
        backendUrl,
      });
      const answerText = result.answer.trim() || 'No answer returned.';
      setMessages((previous) => [
        ...previous,
        {
          id: buildId('assistant'),
          role: 'assistant',
          text: answerText,
          timestamp: formatTimestamp(new Date()),
        },
      ]);
    } catch (error: unknown) {
      if (controller.signal.aborted) {
        return;
      }
      const message =
        error instanceof Error && error.message.trim()
          ? error.message
          : 'Assistant request failed. Please try again.';
      setErrorMessage(message);
      setMessages((previous) => [
        ...previous,
        {
          id: buildId('assistant-error'),
          role: 'assistant',
          text: message,
          timestamp: formatTimestamp(new Date()),
          isError: true,
        },
      ]);
    } finally {
      if (activeRequestRef.current === controller) {
        activeRequestRef.current = null;
      }
      setIsSending(false);
      inputRef.current?.focus();
    }
  };

  return (
    <section
      className="rounded-[28px] border border-slate-200/75 bg-white/70 p-4 shadow-[0_18px_44px_rgba(2,6,23,0.16)] backdrop-blur-xl dark:border-slate-500/55 dark:bg-slate-950/72 dark:shadow-[0_18px_44px_rgba(2,6,23,0.42)] md:p-6"
      style={panelStyle}
    >
      <header className="mb-4 flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-cyan-300/40 bg-gradient-to-br from-cyan-200/80 to-violet-300/70 shadow-[0_0_18px_rgba(45,212,191,0.26)] dark:border-cyan-300/35 dark:from-cyan-400/35 dark:to-violet-500/35">
          <Bot className="h-5 w-5 text-cyan-800 dark:text-cyan-100" aria-hidden="true" />
        </div>
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-zinc-800 dark:text-zinc-50">{title}</h2>
          <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-100">{subtitle}</p>
        </div>
      </header>

      <div className="neumo-inset rounded-2xl border border-slate-200/70 px-3 py-3 dark:border-slate-500/60 dark:bg-slate-950/58 md:px-4">
        <div
          className="max-h-[54vh] min-h-[280px] space-y-3 overflow-y-auto pr-1 sm:min-h-[320px]"
          aria-live="polite"
          aria-label="Assistant chat message history"
        >
          {messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))}

          {isSending && (
            <article className="flex justify-start">
              <div className="inline-flex items-center gap-2 rounded-2xl border border-cyan-200/65 bg-white/86 px-3 py-2 text-xs text-zinc-700 shadow-[0_8px_18px_rgba(2,6,23,0.12)] dark:border-cyan-300/45 dark:bg-slate-900/88 dark:text-zinc-50">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                Assistant is thinking...
              </div>
            </article>
          )}
          <div ref={endRef} />
        </div>
      </div>

      {starterPrompts.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {starterPrompts.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => {
                void submitMessage(prompt);
              }}
              disabled={isSending}
              className="rounded-full border border-slate-300/70 bg-white/82 px-3.5 py-1.5 text-xs font-medium text-zinc-700 transition-all duration-200 hover:-translate-y-[1px] hover:border-cyan-300/55 hover:bg-cyan-50/80 disabled:cursor-not-allowed disabled:opacity-60 dark:border-cyan-200/35 dark:bg-slate-900/72 dark:text-zinc-100 dark:hover:border-cyan-200/55 dark:hover:bg-slate-800/80"
            >
              {prompt}
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
        className="mt-4 rounded-2xl border border-slate-200/75 bg-white/75 p-3 backdrop-blur-xl dark:border-slate-500/55 dark:bg-slate-900/78"
      >
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            ref={inputRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            disabled={isSending}
            placeholder={placeholder}
            className="h-11 w-full rounded-2xl border border-slate-300/80 bg-white/95 px-4 text-sm text-zinc-800 outline-none transition-all duration-200 placeholder:text-zinc-500 focus-visible:ring-2 focus-visible:ring-cyan-400/40 dark:border-slate-400/80 dark:bg-slate-950/92 dark:text-zinc-50 dark:placeholder:text-zinc-300 dark:focus-visible:ring-cyan-300/45"
            aria-label="Ask assistant"
          />
          <button
            type="submit"
            disabled={!canSend}
            className="inline-flex h-11 min-w-[112px] items-center justify-center gap-2 rounded-2xl border border-cyan-300/35 bg-gradient-to-r from-violet-500/75 to-cyan-500/75 px-4 text-sm font-semibold text-white transition-all duration-200 hover:-translate-y-[1px] focus-visible:ring-2 focus-visible:ring-cyan-300/50 disabled:cursor-not-allowed disabled:opacity-55"
          >
            {isSending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
            {isSending ? 'Sending...' : 'Send'}
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
