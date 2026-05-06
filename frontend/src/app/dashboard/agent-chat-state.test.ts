import {
  AGENT_STARTER_PROMPTS,
  buildAssistantPayload,
  buildSolverLineFromStoredLines,
  deriveRequestedMode,
  appendMockAssistantTurn,
  applyStarterPromptToInput,
  buildInitialAgentMessages,
} from './agent-chat-state';

describe('agent chat state', () => {
  it('builds seeded starter conversation', () => {
    const messages = buildInitialAgentMessages();
    expect(messages).toHaveLength(3);
    expect(messages[0].text).toContain("Hi, I'm your chess assistant");
    expect(messages[1].text).toBe('What is my weakest theme?');
  });

  it('exposes required starter chips', () => {
    expect(AGENT_STARTER_PROMPTS).toEqual([
      'Explain my last puzzle',
      'What is my weakest theme?',
      'How do I improve first-move accuracy?',
      'How do I use Puzzle Lab?',
    ]);
  });

  it('applies starter prompt to input', () => {
    expect(applyStarterPromptToInput('Explain my last puzzle')).toBe('Explain my last puzzle');
  });

  it('appends user message and placeholder assistant response', () => {
    const baseMessages = buildInitialAgentMessages();
    const now = new Date('2026-05-05T10:00:00Z');
    const nextMessages = appendMockAssistantTurn(baseMessages, 'How do I use Puzzle Lab?', now);

    expect(nextMessages).toHaveLength(baseMessages.length + 2);
    expect(nextMessages.at(-2)?.role).toBe('user');
    expect(nextMessages.at(-2)?.text).toBe('How do I use Puzzle Lab?');
    expect(nextMessages.at(-1)?.role).toBe('assistant');
    expect(nextMessages.at(-1)?.text).toContain('Once connected to the backend agent');
  });

  it('ignores empty user messages', () => {
    const baseMessages = buildInitialAgentMessages();
    const nextMessages = appendMockAssistantTurn(baseMessages, '   ');
    expect(nextMessages).toEqual(baseMessages);
  });

  it('derives requested mode from common question patterns', () => {
    expect(deriveRequestedMode('Can I get a hint 2?')).toBe('hint');
    expect(deriveRequestedMode('What is the tactical theme here?')).toBe('theme');
    expect(deriveRequestedMode('Explain why this is mate')).toBe('explain');
    expect(deriveRequestedMode('How do I use Puzzle Lab?')).toBe('followup');
  });

  it('tokenizes stored solution lines for solver context', () => {
    expect(buildSolverLineFromStoredLines(['1. Qh4#'])).toEqual(['Qh4#']);
    expect(buildSolverLineFromStoredLines(['Qh4# Kg8'])).toEqual(['Qh4#', 'Kg8']);
    expect(buildSolverLineFromStoredLines(['   '])).toBeNull();
  });

  it('builds assistant payload with normalized mode and context', () => {
    const payload = buildAssistantPayload('Explain my last puzzle', {
      puzzleId: 'puzzle-123',
      fen: null,
      solverMoveSan: 'Qh4#',
      solverLine: ['Qh4#'],
    });

    expect(payload).toEqual({
      puzzle_id: 'puzzle-123',
      fen: null,
      solver_move_san: 'Qh4#',
      solver_line: ['Qh4#'],
      user_message: 'Explain my last puzzle',
      requested_mode: 'explain',
    });
  });
});
