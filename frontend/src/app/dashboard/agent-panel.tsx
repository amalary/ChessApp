'use client';

import React from 'react';
import { AgentChat } from '@/components/agent-chat';
import { AmyIdentityMark } from '@/components/amy-identity-mark';
import type { AssistantConversationMode } from '@/lib/assistant-conversation-mode';
import type { PuzzleSubmissionRecord } from '@/lib/puzzle-submissions';

type AgentPageProps = {
  panelStyle?: React.CSSProperties;
  assistantConversationMode?: AssistantConversationMode;
  submissions?: PuzzleSubmissionRecord[];
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

function inferMotifFromSubmission(submission: PuzzleSubmissionRecord): string {
  const searchable = `${submission.fileName} ${submission.solutionLines.join(' ')}`.toLowerCase();
  if (/\bmating\s+net|back[-\s]?rank|mate[-\s]?in[-\s]?[123]/.test(searchable)) {
    return 'Mating Nets';
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

function formatRelativeSubmissionTime(iso: string): string {
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) {
    return 'Solved recently';
  }
  const diffMs = Date.now() - timestamp;
  if (diffMs < 60 * 60 * 1000) {
    const minutes = Math.max(1, Math.round(diffMs / (60 * 1000)));
    return `Solved ${minutes}m ago`;
  }
  if (diffMs < 24 * 60 * 60 * 1000) {
    const hours = Math.max(1, Math.round(diffMs / (60 * 60 * 1000)));
    return `Solved ${hours}h ago`;
  }
  const days = Math.max(1, Math.round(diffMs / (24 * 60 * 60 * 1000)));
  return `Solved ${days}d ago`;
}

function RecentPuzzleContextCard({ submissions = [] }: { submissions?: PuzzleSubmissionRecord[] }) {
  const rows = submissions.slice(0, 3).map((submission) => {
    const hasAssessment = submission.firstMoveAssessment?.isValidForFirstMoveAccuracy === true;
    const accuracyLabel = hasAssessment
      ? submission.firstMoveAssessment?.isFirstMoveCorrect
        ? 'First move correct'
        : 'First move missed'
      : 'No first-move sample';

    return [
      submission.fileName || 'Uploaded puzzle',
      inferMotifFromSubmission(submission),
      formatRelativeSubmissionTime(submission.submittedAt),
      accuracyLabel,
    ] as const;
  });

  const fallbackRows = [
    ['Waiting for puzzle history', 'Theme pending', 'Solve a puzzle', 'Profile building'],
    ['Adaptive context', 'Motifs loading', 'From your submissions', 'Personalized in real-time'],
  ] as const;

  const displayRows = rows.length > 0 ? rows : fallbackRows;

  return (
    <article className="rounded-3xl border border-slate-200/80 bg-white/68 p-4 backdrop-blur-xl dark:border-slate-500/90 dark:bg-slate-950/84">
      <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Recent Puzzle Context</h3>
      <div className="mt-3 space-y-2.5">
        {displayRows.map(([title, theme, solvedAt, accuracy]) => (
          <div
            key={`${title}-${theme}-${solvedAt}`}
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

function AssistantInfoCards({ submissions }: { submissions?: PuzzleSubmissionRecord[] }) {
  return (
    <div className="space-y-4">
      <SuggestedHelpCard />
      <RecentPuzzleContextCard submissions={submissions} />
      <GuardrailsCard />
    </div>
  );
}

export function AgentPage({ panelStyle, assistantConversationMode, submissions = [] }: AgentPageProps) {
  return (
    <section className="space-y-4">
      <header
        className="amy-chat-shell rounded-[28px] border border-slate-200/75 bg-white/70 px-5 py-5 backdrop-blur-xl dark:border-white/10 dark:bg-white/6"
        style={panelStyle}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <AmyIdentityMark size="sm" />
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-zinc-800 dark:text-white" style={{ color: 'rgb(var(--fg))' }}>
                Amy
              </h2>
              <p className="mt-1 text-sm text-zinc-700 dark:text-white" style={{ color: 'rgb(var(--fg))' }}>
                Calm tactical guidance with human-level pacing and strategic clarity.
              </p>
              <p className="mt-1 text-[11px] font-medium uppercase tracking-[0.14em] text-cyan-700/75 dark:text-cyan-200/85">
                Chess coach | strategic companion
              </p>
            </div>
          </div>
          <span className="amy-presence-pill" aria-label="Amy is present">
            Amy online
          </span>
        </div>
      </header>

      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <AgentChat
          panelStyle={panelStyle}
          submissions={submissions}
          conversationMode={assistantConversationMode}
          title="Amy"
          subtitle="Progressive chess coaching with calm, clear tactical guidance."
          placeholder="Ask Amy for a hint, share a candidate move, or request the full line..."
        />

        <AssistantInfoCards submissions={submissions} />
      </div>
    </section>
  );
}
