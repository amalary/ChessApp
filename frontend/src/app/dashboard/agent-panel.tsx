'use client';

import React from 'react';
import { Sparkles } from 'lucide-react';
import { AgentChat } from '@/components/agent-chat';
import { AGENT_STARTER_PROMPTS } from './agent-chat-state';

type AgentPageProps = {
  panelStyle?: React.CSSProperties;
};

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
      <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Suggested Help</h3>
      <div className="mt-3 space-y-3">
        {items.map((item) => (
          <div
            key={item.title}
            className="rounded-2xl border border-slate-200/80 bg-white/88 px-3 py-2.5 dark:border-slate-500/80 dark:bg-slate-900/84"
          >
            <p className="text-sm font-medium text-zinc-800 dark:text-zinc-100">{item.title}</p>
            <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-100">{item.subtitle}</p>
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
      <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Recent Puzzle Context</h3>
      <div className="mt-3 space-y-2.5">
        {rows.map(([title, theme, solvedAt, accuracy]) => (
          <div
            key={title}
            className="rounded-2xl border border-slate-200/80 bg-white/88 px-3 py-2.5 dark:border-slate-500/80 dark:bg-slate-900/84"
          >
            <p className="text-sm font-medium text-zinc-800 dark:text-zinc-100">{title}</p>
            <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-100">{theme}</p>
            <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-200">{solvedAt}</p>
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
  return (
    <section className="space-y-4">
      <header
        className="rounded-[28px] border border-slate-200/75 bg-white/70 px-5 py-5 backdrop-blur-xl dark:border-white/10 dark:bg-white/6"
        style={panelStyle}
      >
        <div className="flex items-center gap-2">
          <h2 className="text-2xl font-semibold tracking-tight text-zinc-800 dark:text-white" style={{ color: 'rgb(var(--fg))' }}>
            Chess Assistant
          </h2>
          <Sparkles className="h-5 w-5 text-cyan-700 dark:text-cyan-200" />
        </div>
        <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-100">
          Ask questions about your puzzles, progress, and how to use the app.
        </p>
      </header>

      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <AgentChat
          panelStyle={panelStyle}
          starterPrompts={AGENT_STARTER_PROMPTS}
          title="Chess Tutor"
          subtitle="Grounded responses from your docs and assistant knowledge base."
          placeholder="Ask about a puzzle, analytics trend, or app feature..."
        />

        <AssistantInfoCards />
      </div>
    </section>
  );
}
