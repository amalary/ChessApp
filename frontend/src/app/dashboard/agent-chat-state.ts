export type AgentChatRole = 'assistant' | 'user';
export type AssistantMode = 'hint' | 'explain' | 'theme' | 'followup';

export type AgentChatMessage = {
  id: string;
  role: AgentChatRole;
  text: string;
  timestamp: string;
};

export type PuzzleContextSnapshot = {
  puzzleId: string | null;
  fen: string | null;
  solverMoveSan: string | null;
  solverLine: string[] | null;
};

export type AssistantRequestPayload = {
  puzzle_id: string | null;
  fen: string | null;
  solver_move_san: string | null;
  solver_line: string[] | null;
  user_message: string;
  requested_mode: AssistantMode;
};

export const AGENT_STARTER_PROMPTS = [
  'Explain my last puzzle',
  'What is my weakest theme?',
  'How do I improve first-move accuracy?',
  'How do I use Puzzle Lab?',
] as const;

export function buildInitialAgentMessages(): AgentChatMessage[] {
  return [
    {
      id: 'assistant-welcome',
      role: 'assistant',
      text: "Hi, I'm your chess assistant. I can explain puzzle themes, help you understand your analytics, and guide you through the app. What would you like to know?",
      timestamp: '11:02 AM',
    },
    {
      id: 'user-seed',
      role: 'user',
      text: 'What is my weakest theme?',
      timestamp: '11:04 AM',
    },
    {
      id: 'assistant-seed',
      role: 'assistant',
      text: "Based on your recent activity, your weakest theme is Sacrifices. You've solved 89% of Sacrifice puzzles, which is lower than your other themes. Would you like some recommended puzzles to improve?",
      timestamp: '11:05 AM',
    },
  ];
}

export function formatAgentTimestamp(date: Date): string {
  return date.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function appendUserMessage(
  messages: AgentChatMessage[],
  userMessage: string,
  now: Date = new Date(),
): AgentChatMessage[] {
  const trimmed = userMessage.trim();
  if (!trimmed) {
    return messages;
  }

  return [
    ...messages,
    {
      id: `user-${now.getTime()}`,
      role: 'user',
      text: trimmed,
      timestamp: formatAgentTimestamp(now),
    },
  ];
}

export function appendAssistantMessage(
  messages: AgentChatMessage[],
  assistantMessage: string,
  now: Date = new Date(),
): AgentChatMessage[] {
  const trimmed = assistantMessage.trim();
  if (!trimmed) {
    return messages;
  }

  return [
    ...messages,
    {
      id: `assistant-${now.getTime()}`,
      role: 'assistant',
      text: trimmed,
      timestamp: formatAgentTimestamp(now),
    },
  ];
}

export function appendMockAssistantTurn(
  messages: AgentChatMessage[],
  userMessage: string,
  now: Date = new Date(),
): AgentChatMessage[] {
  const trimmed = userMessage.trim();
  if (!trimmed) {
    return messages;
  }

  return appendAssistantMessage(
    appendUserMessage(messages, trimmed, now),
    "I can help with that. Once connected to the backend agent, I'll use your puzzle history and app documentation to answer accurately.",
    now,
  );
}

export function applyStarterPromptToInput(prompt: string): string {
  return prompt;
}

function tokenizeSolverLine(rawLine: string): string[] {
  return rawLine
    .replace(/\d+\.(?:\.\.)?/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(
      (token) =>
        token.length > 0 &&
        token !== '1-0' &&
        token !== '0-1' &&
        token !== '1/2-1/2' &&
        token !== '*',
    );
}

export function deriveRequestedMode(userMessage: string): AssistantMode {
  const lowered = userMessage.toLowerCase();
  if (lowered.includes('hint')) {
    return 'hint';
  }
  if (
    lowered.includes('theme') ||
    lowered.includes('tactic') ||
    lowered.includes('fork') ||
    lowered.includes('pin') ||
    lowered.includes('sacrifice')
  ) {
    return 'theme';
  }
  if (
    lowered.includes('explain') ||
    lowered.includes('why') ||
    lowered.includes('checkmate') ||
    lowered.includes('mate')
  ) {
    return 'explain';
  }
  return 'followup';
}

export function buildSolverLineFromStoredLines(solutionLines: string[]): string[] | null {
  const merged = solutionLines.flatMap((line) => tokenizeSolverLine(line));
  if (merged.length === 0) {
    return null;
  }
  return merged;
}

export function buildAssistantPayload(
  userMessage: string,
  context: PuzzleContextSnapshot,
): AssistantRequestPayload {
  const requestedMode = deriveRequestedMode(userMessage);
  return {
    puzzle_id: context.puzzleId,
    fen: context.fen,
    solver_move_san: context.solverMoveSan,
    solver_line: context.solverLine,
    user_message: userMessage.trim(),
    requested_mode: requestedMode,
  };
}
