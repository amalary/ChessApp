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
            ? 'w-full sm:max-w-[88%] border border-cyan-300/25 bg-gradient-to-br from-indigo-600/35 via-violet-500/30 to-cyan-400/25 text-slate-100'
            : 'max-w-[72%] border border-violet-300/20 bg-gradient-to-br from-violet-600/45 to-indigo-600/45 text-white'
        }`}
      >
        <p className="text-sm leading-relaxed">{message.text}</p>
        <p className={`mt-2 text-[11px] ${isAssistant ? 'text-cyan-100/80' : 'text-violet-100/80'}`}>
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
          className="rounded-full border border-cyan-200/20 bg-white/10 px-3.5 py-1.5 text-xs font-medium text-slate-200 transition-all duration-200 hover:-translate-y-[1px] hover:border-cyan-200/35 hover:bg-white/16"
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
    <section className="neumo-surface-soft rounded-[28px] border border-white/10 p-4 md:p-6">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-full border border-cyan-300/30 bg-gradient-to-br from-cyan-400/35 to-violet-500/35 shadow-[0_0_22px_rgba(45,212,191,0.3)]">
          <Bot className="h-5 w-5 text-cyan-100" />
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.14em] text-cyan-100/75">Agent</p>
          <p className="text-base font-semibold text-slate-100">Chess Tutor</p>
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
    <article className="rounded-3xl border border-white/10 bg-white/8 p-4 backdrop-blur-xl">
      <h3 className="text-sm font-semibold text-slate-100">Suggested Help</h3>
      <div className="mt-3 space-y-3">
        {items.map((item) => (
          <div key={item.title} className="rounded-2xl border border-white/8 bg-white/6 px-3 py-2.5">
            <p className="text-sm font-medium text-slate-100">{item.title}</p>
            <p className="mt-1 text-xs text-slate-300">{item.subtitle}</p>
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
    <article className="rounded-3xl border border-white/10 bg-white/8 p-4 backdrop-blur-xl">
      <h3 className="text-sm font-semibold text-slate-100">Recent Puzzle Context</h3>
      <div className="mt-3 space-y-2.5">
        {rows.map(([title, theme, solvedAt, accuracy]) => (
          <div key={title} className="rounded-2xl border border-white/8 bg-white/6 px-3 py-2.5">
            <p className="text-sm font-medium text-slate-100">{title}</p>
            <p className="mt-1 text-xs text-slate-300">{theme}</p>
            <p className="mt-1 text-xs text-slate-400">{solvedAt}</p>
            <p className="mt-1 text-xs font-semibold text-cyan-200">{accuracy}</p>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="mt-3 rounded-full border border-cyan-300/35 bg-gradient-to-r from-indigo-500/35 to-cyan-500/35 px-3.5 py-1.5 text-xs font-semibold text-cyan-100 transition-all duration-200 hover:-translate-y-[1px]"
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
    <article className="rounded-3xl border border-emerald-300/25 bg-emerald-500/10 p-4 backdrop-blur-xl">
      <h3 className="text-sm font-semibold text-emerald-100">Guardrails Active</h3>
      <div className="mt-3 space-y-2.5">
        {items.map((item) => (
          <div key={item} className="flex items-center gap-2 text-xs text-emerald-100/90">
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
      <header className="rounded-[28px] border border-white/10 bg-white/6 px-5 py-5 backdrop-blur-xl" style={panelStyle}>
        <div className="flex items-center gap-2">
          <h2 className="text-2xl font-semibold tracking-tight text-slate-100">Chess Assistant</h2>
          <Sparkles className="h-5 w-5 text-cyan-200" />
        </div>
        <p className="mt-1 text-sm text-slate-300">
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
            className="rounded-[28px] border border-white/10 bg-white/7 p-4 shadow-[0_18px_42px_rgba(2,6,23,0.28)] backdrop-blur-xl"
            style={panelStyle}
          >
            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="Ask about a puzzle, theme, or app feature..."
                disabled={isSending}
                className="h-11 w-full rounded-2xl border border-white/15 bg-black/20 px-4 text-sm text-slate-100 placeholder:text-slate-400 outline-none transition-all duration-200 focus:border-cyan-300/45 focus:ring-2 focus:ring-cyan-300/20"
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
              <span className="inline-flex items-center gap-1.5 text-slate-300">
                <CornerDownLeft className="h-3.5 w-3.5" />
                Press Enter to send
              </span>
              <span className="text-slate-400">
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
