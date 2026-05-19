'use client';

import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, CornerDownLeft, Loader2, Send, Square } from 'lucide-react';
import { requestAgentChat } from '@/lib/agent-chat-api';
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
import type { PuzzleSubmissionRecord } from '@/lib/puzzle-submissions';
import {
  buildAdaptiveSuggestionChips,
  buildConversationalMomentumActions,
  resolveReferencedPuzzle,
  type AgentReferencedPuzzle,
} from '@/app/dashboard/agent-chat-state';

type AgentChatRole = 'assistant' | 'user';

type AgentChatMessage = {
  id: string;
  role: AgentChatRole;
  text: string;
  timestamp: string;
  isError?: boolean;
  referencedPuzzle?: AgentReferencedPuzzle;
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
            <p className="mt-1 text-xs font-medium text-slate-700 dark:text-slate-100">
              {message.referencedPuzzle.fileName}
            </p>
            <div className="mt-2 overflow-hidden rounded-lg border border-slate-200/85 bg-slate-100 dark:border-slate-500/65 dark:bg-slate-800/70">
              <img
                src={message.referencedPuzzle.imageDataUrl}
                alt={`Referenced puzzle ${message.referencedPuzzle.fileName}`}
                className="h-full max-h-56 w-full object-contain"
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
  const [messages, setMessages] = useState<AgentChatMessage[]>([
    {
      id: 'assistant-welcome',
      role: 'assistant',
      text: getModeWelcomeShort(conversationMode),
      timestamp: formatTimestamp(new Date()),
    },
  ]);
  const [input, setInput] = useState('');
  const [inputPromptIndex, setInputPromptIndex] = useState(0);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isMomentumActionsSuppressed, setIsMomentumActionsSuppressed] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
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
    return () => {
      activeRequestRef.current?.abort();
      assistantBeatTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      assistantBeatTimersRef.current = [];
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

  const appendAssistantBeats = async (
    rawText: string,
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
          if (signal.aborted) {
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
              referencedPuzzle: !isError && idx === 0 ? referencedPuzzle ?? undefined : undefined,
            },
          ]);
          if (idx === beats.length - 1) {
            settle();
          }
        }, schedule[idx]);
        assistantBeatTimersRef.current.push(timer);
      });
    });
  };

  const stopActiveRequest = () => {
    const controller = activeRequestRef.current;
    if (!controller) {
      return;
    }
    controller.abort();
  };

  const submitMessage = async (rawMessage: string) => {
    const trimmed = rawMessage.trim();
    if (!trimmed || isSending) {
      return;
    }

    const now = new Date();
    setErrorMessage(null);
    setInput('');
    setIsMomentumActionsSuppressed(true);
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
    assistantBeatTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    assistantBeatTimersRef.current = [];

    try {
      const result = await requestAgentChat({
        query: trimmed,
        limit: 5,
        conversationMode,
        signal: controller.signal,
        backendUrl,
      });
      const answerText = result.answer.trim() || 'No answer returned.';
      const referencedPuzzle = resolveReferencedPuzzle({
        submissions,
        userMessage: trimmed,
        assistantMessage: answerText,
      });
      await appendAssistantBeats(answerText, controller.signal, false, referencedPuzzle);
    } catch (error: unknown) {
      if (controller.signal.aborted) {
        return;
      }
      const message =
        error instanceof Error && error.message.trim()
          ? error.message
          : 'Assistant request failed. Please try again.';
      setErrorMessage(message);
      await appendAssistantBeats(message, controller.signal, true);
    } finally {
      if (activeRequestRef.current === controller) {
        activeRequestRef.current = null;
      }
      setIsSending(false);
      inputRef.current?.focus();
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
        </div>
      </header>

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
