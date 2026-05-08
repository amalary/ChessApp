'use client';

import React, { useMemo, useState } from 'react';
import { Bot, CornerDownLeft, Send, Sparkles } from 'lucide-react';
import { getAccessTokenClient } from 'lib/getAccessTokenClient';
import { readPuzzleSubmissions } from '@/lib/puzzle-submissions';

import {
  AGENT_STARTER_PROMPTS,
  appendAssistantMessage,
  appendUserMessage,
  applyStarterPromptToInput,
  buildAssistantPayload,
  buildSolverLineFromStoredLines,
  buildInitialAgentMessages,
  type AssistantRequestPayload,
  type AgentChatMessage,
  type PuzzleContextSnapshot,
} from './agent-chat-state';

type AgentPageProps = {
  panelStyle?: React.CSSProperties;
};

type AssistantApiResponse = {
  response_text?: unknown;
  detail?: unknown;
};

type ChatMessageBubbleProps = {
  message: AgentChatMessage;
};

function ChatMessageBubble({ message }: ChatMessageBubbleProps) {
  const isAssistant = message.role === 'assistant';

  return (
    <div className={`flex ${isAssistant ? 'justify-start' : 'justify-end'}`}>
      <div
        className={`max-w-[90%] rounded-2xl px-4 py-3 shadow-[0_14px_32px_rgba(2,6,23,0.25)] backdrop-blur-xl ${
          isAssistant
            ? 'w-full sm:max-w-[88%] border border-cyan-200/60 dark:border-cyan-300/25 bg-gradient-to-br from-cyan-50/95 via-indigo-50/95 to-violet-100/90 dark:from-indigo-600/35 dark:via-violet-500/30 dark:to-cyan-400/25 text-slate-800 dark:text-slate-100'
            : 'max-w-[72%] border border-violet-400/25 dark:border-violet-300/20 bg-gradient-to-br from-violet-500/88 to-indigo-500/88 dark:from-violet-600/45 dark:to-indigo-600/45 text-white'
        }`}
      >
        <p className="text-sm leading-relaxed">{message.text}</p>
        <p
          className={`mt-2 text-[11px] ${
            isAssistant ? 'text-slate-500 dark:text-cyan-100/80' : 'text-violet-100/90'
          }`}
        >
          {message.timestamp}
        </p>
      </div>
    </div>
  );
}

function StarterPromptChips({
  onSelect,
}: {
  onSelect: (prompt: string) => void;
}) {
  return (
    <div className="mt-5 flex flex-wrap gap-2.5">
      {AGENT_STARTER_PROMPTS.map((prompt) => (
        <button
          key={prompt}
          type="button"
          onClick={() => onSelect(prompt)}
          className="rounded-full border border-slate-300/70 bg-white/80 px-3.5 py-1.5 text-xs font-medium text-slate-700 transition-all duration-200 hover:-translate-y-[1px] hover:border-cyan-300/55 hover:bg-cyan-50/80 dark:border-cyan-200/20 dark:bg-white/10 dark:text-slate-200 dark:hover:border-cyan-200/35 dark:hover:bg-white/16"
        >
          {prompt}
        </button>
      ))}
    </div>
  );
}

function ChatPanel({
  messages,
  onStarter,
}: {
  messages: AgentChatMessage[];
  onStarter: (prompt: string) => void;
}) {
  return (
    <section className="neumo-surface-soft rounded-[28px] border border-slate-200/70 dark:border-white/10 p-4 md:p-6">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-full border border-cyan-300/40 bg-gradient-to-br from-cyan-200/80 to-violet-300/70 shadow-[0_0_22px_rgba(45,212,191,0.22)] dark:border-cyan-300/30 dark:from-cyan-400/35 dark:to-violet-500/35 dark:shadow-[0_0_22px_rgba(45,212,191,0.3)]">
          <Bot className="h-5 w-5 text-cyan-800 dark:text-cyan-100" />
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.14em] text-cyan-700 dark:text-cyan-100/75">Agent</p>
          <p className="text-base font-semibold text-slate-800 dark:text-white" style={{ color: 'rgb(var(--fg))' }}>
            Chess Tutor
          </p>
        </div>
      </div>

      <div className="space-y-3">
        {messages.map((message) => (
          <ChatMessageBubble key={message.id} message={message} />
        ))}
      </div>

      <StarterPromptChips onSelect={onStarter} />
    </section>
  );
}

function SuggestedHelpCard() {
  const items = [
    {
      title: 'Explain a puzzle',
      subtitle: 'Get a step-by-step explanation',
    },
    {
      title: 'Navigate the app',
      subtitle: 'Learn features and workflows',
    },
    {
      title: 'Training recommendations',
      subtitle: 'Personalized improvement tips',
    },
    {
      title: 'Understand analytics',
      subtitle: 'Learn what your stats mean',
    },
  ];

  return (
    <article className="rounded-3xl border border-slate-200/80 bg-white/68 p-4 backdrop-blur-xl dark:border-slate-500/90 dark:bg-slate-950/84">
      <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Suggested Help</h3>
      <div className="mt-3 space-y-3">
        {items.map((item) => (
          <div
            key={item.title}
            className="rounded-2xl border border-slate-200/80 bg-white/88 px-3 py-2.5 dark:border-slate-500/80 dark:bg-slate-900/84"
          >
            <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{item.title}</p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-100">{item.subtitle}</p>
          </div>
        ))}
      </div>
    </article>
  );
}

function RecentPuzzleContextCard() {
  const rows = [
    ['Fork in the Road', 'Forks', 'Solved 2h ago', '92% accuracy'],
    ['Sacrifice on h7', 'Sacrifices', 'Solved 4h ago', '71% accuracy'],
    ['Back Rank Pressure', 'Back-Rank Mates', 'Solved 1d ago', '95% accuracy'],
  ] as const;

  return (
    <article className="rounded-3xl border border-slate-200/80 bg-white/68 p-4 backdrop-blur-xl dark:border-slate-500/90 dark:bg-slate-950/84">
      <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Recent Puzzle Context</h3>
      <div className="mt-3 space-y-2.5">
        {rows.map(([title, theme, solvedAt, accuracy]) => (
          <div
            key={title}
            className="rounded-2xl border border-slate-200/80 bg-white/88 px-3 py-2.5 dark:border-slate-500/80 dark:bg-slate-900/84"
          >
            <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{title}</p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-100">{theme}</p>
            <p className="mt-1 text-xs text-slate-500/90 dark:text-slate-200">{solvedAt}</p>
            <p className="mt-1 text-xs font-semibold text-cyan-700 dark:text-cyan-200">{accuracy}</p>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="mt-3 rounded-full border border-cyan-400/45 bg-gradient-to-r from-indigo-500/80 to-cyan-500/80 px-3.5 py-1.5 text-xs font-semibold text-white transition-all duration-200 hover:-translate-y-[1px] dark:border-cyan-300/35 dark:from-indigo-500/35 dark:to-cyan-500/35 dark:text-cyan-100"
      >
        View all
      </button>
    </article>
  );
}

function GuardrailsCard() {
  const items = [
    'Prompt injection protection',
    'App-documentation grounded',
    'Puzzle-data only context',
    'No hallucinated chess claims',
  ];

  return (
    <article className="rounded-3xl border border-emerald-300/45 bg-emerald-100/65 p-4 backdrop-blur-xl dark:border-emerald-300/25 dark:bg-emerald-500/10">
      <h3 className="text-sm font-semibold text-emerald-800 dark:text-emerald-100">Guardrails Active</h3>
      <div className="mt-3 space-y-2.5">
        {items.map((item) => (
          <div key={item} className="flex items-center gap-2 text-xs text-emerald-800/90 dark:text-emerald-100/90">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-300 shadow-[0_0_10px_rgba(110,231,183,0.8)]" />
            <span>{item}</span>
          </div>
        ))}
      </div>
    </article>
  );
}

function AssistantInfoCards() {
  return (
    <div className="space-y-4">
      <SuggestedHelpCard />
      <RecentPuzzleContextCard />
      <GuardrailsCard />
    </div>
  );
}

export function AgentPage({ panelStyle }: AgentPageProps) {
  const [messages, setMessages] = useState<AgentChatMessage[]>(() => buildInitialAgentMessages());
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);

  const canSend = useMemo(() => input.trim().length > 0 && !isSending, [input, isSending]);
  const backendUrl = useMemo(
    () => process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://127.0.0.1:8010',
    [],
  );

  const readLatestPuzzleContext = (): PuzzleContextSnapshot => {
    const submissions = readPuzzleSubmissions();
    const latest = submissions[0];
    if (!latest) {
      return {
        puzzleId: null,
        fen: null,
        solverMoveSan: null,
        solverLine: null,
      };
    }

    const solverLine = buildSolverLineFromStoredLines(latest.solutionLines);
    const normalizedFen =
      typeof latest.fen === 'string' && latest.fen.trim().length > 0 ? latest.fen.trim() : null;
    return {
      puzzleId: latest.firstMoveAssessment?.puzzleId ?? null,
      fen: normalizedFen,
      solverMoveSan: solverLine?.[0] ?? null,
      solverLine,
    };
  };

  const sendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }

    setMessages((previous) => appendUserMessage(previous, trimmed));
    setInput('');
    setIsSending(true);

    try {
      const token = await getAccessTokenClient();
      if (!token) {
        throw new Error('Missing Auth0 access token. Please sign in again.');
      }

      const payload: AssistantRequestPayload = buildAssistantPayload(
        trimmed,
        readLatestPuzzleContext(),
      );
      const response = await fetch(`${backendUrl}/assistant`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      let data: AssistantApiResponse = {};
      try {
        data = (await response.json()) as AssistantApiResponse;
      } catch {
        data = {};
      }

      if (!response.ok) {
        const detail =
          typeof data.detail === 'string' && data.detail.trim()
            ? data.detail.trim()
            : `Assistant error (${response.status})`;
        setMessages((previous) => appendAssistantMessage(previous, detail));
        return;
      }

      const responseText =
        typeof data.response_text === 'string' && data.response_text.trim()
          ? data.response_text.trim()
          : "I can help with that. Once connected to the backend agent, I'll use your puzzle history and app documentation to answer accurately.";
      setMessages((previous) => appendAssistantMessage(previous, responseText));
    } catch (error: unknown) {
      const message =
        error instanceof Error && error.message.trim()
          ? error.message
          : "I can help with that. Once connected to the backend agent, I'll use your puzzle history and app documentation to answer accurately.";
      setMessages((previous) => appendAssistantMessage(previous, message));
    } finally {
      setIsSending(false);
    }
  };

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void sendMessage(input);
  };

  return (
    <section className="space-y-4">
      <header
        className="rounded-[28px] border border-slate-200/75 bg-white/70 px-5 py-5 backdrop-blur-xl dark:border-white/10 dark:bg-white/6"
        style={panelStyle}
      >
        <div className="flex items-center gap-2">
          <h2 className="text-2xl font-semibold tracking-tight text-slate-800 dark:text-white" style={{ color: 'rgb(var(--fg))' }}>
            Chess Assistant
          </h2>
          <Sparkles className="h-5 w-5 text-cyan-700 dark:text-cyan-200" />
        </div>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          Ask questions about your puzzles, progress, and how to use the app.
        </p>
      </header>

      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <ChatPanel
            messages={messages}
            onStarter={(prompt) => {
              const next = applyStarterPromptToInput(prompt);
              setInput(next);
              void sendMessage(next);
            }}
          />

          <form
            onSubmit={onSubmit}
            className="rounded-[28px] border border-slate-200/75 bg-white/70 p-4 shadow-[0_18px_42px_rgba(2,6,23,0.16)] backdrop-blur-xl dark:border-white/10 dark:bg-white/7 dark:shadow-[0_18px_42px_rgba(2,6,23,0.28)]"
            style={panelStyle}
          >
            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="Ask about a puzzle, theme, or app feature..."
                disabled={isSending}
                className="h-11 w-full rounded-2xl border border-slate-300/70 bg-white/92 px-4 text-sm text-[rgb(51,65,85)] placeholder:text-slate-500 outline-none transition-all duration-200 focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-300/30 dark:border-slate-300/70 dark:bg-white/92 dark:text-[rgb(15,23,42)] dark:placeholder:text-slate-600 dark:focus:border-cyan-400/60 dark:focus:ring-cyan-300/30"
              />
              <button
                type="submit"
                disabled={!canSend}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-cyan-300/35 bg-gradient-to-r from-violet-500/65 to-cyan-500/65 px-4 text-sm font-semibold text-white transition-all duration-200 hover:-translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Send className="h-4 w-4" />
                {isSending ? 'Sending...' : 'Send'}
              </button>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                <CornerDownLeft className="h-3.5 w-3.5" />
                Press Enter to send
              </span>
              <span className="text-slate-500 dark:text-slate-400">
                Assistant can make mistakes. Please verify important information.
              </span>
            </div>
          </form>
        </div>

        <AssistantInfoCards />
      </div>
    </section>
  );
}
