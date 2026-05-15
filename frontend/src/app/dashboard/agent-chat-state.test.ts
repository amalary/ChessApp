import {
  buildAssistantPayload,
  buildAdaptiveSuggestionChips,
  buildConversationalMomentumActions,
  buildSolverLineFromStoredLines,
  deriveRequestedMode,
  appendMockAssistantTurn,
  applyStarterPromptToInput,
  buildInitialAgentMessages,
} from './agent-chat-state';
import type { PuzzleSubmissionRecord } from '@/lib/puzzle-submissions';

function buildSubmission(overrides: Partial<PuzzleSubmissionRecord> = {}): PuzzleSubmissionRecord {
  return {
    id: overrides.id ?? 'submission-1',
    fileName: overrides.fileName ?? 'Back rank mate test',
    submittedAt: overrides.submittedAt ?? new Date('2026-05-05T10:00:00Z').toISOString(),
    expectedSideToMove: overrides.expectedSideToMove ?? 'white',
    fen: overrides.fen ?? '6k1/5ppp/8/8/8/8/6PP/6K1 w - - 0 1',
    solveTimeMs: overrides.solveTimeMs ?? 34000,
    puzzleElo: overrides.puzzleElo ?? 1120,
    difficultyRating: overrides.difficultyRating ?? 1180,
    estimatedDifficultyRating: overrides.estimatedDifficultyRating ?? 1160,
    positionCheck:
      overrides.positionCheck ??
      ({
        sideToMove: 'white',
        confidence: 0.91,
        attemptsUsed: 1,
        mateFound: true,
        mateIn: 2,
      } as const),
    solutionLines: overrides.solutionLines ?? ['1. Qh8+ Kxh8 2. Rd8#'],
    firstMoveAssessment:
      overrides.firstMoveAssessment ??
      ({
        firstMove: 'Qh7+',
        bestMove: 'Qh8+',
        isFirstMoveCorrect: false,
        status: 'incorrect',
        timeToFirstMoveSeconds: 21,
        puzzleId: 'p-1',
        userId: null,
        attemptId: 'a-1',
        createdAt: new Date('2026-05-05T10:00:00Z').toISOString(),
        isValidForFirstMoveAccuracy: true,
        invalidReason: null,
      } as const),
    originalPuzzleImageDataUrl: overrides.originalPuzzleImageDataUrl ?? 'data:image/jpeg;base64,abc123',
  };
}

describe('agent chat state', () => {
  it('builds seeded starter conversation', () => {
    const messages = buildInitialAgentMessages();
    expect(messages).toHaveLength(3);
    expect(messages[0].text).toContain('stages');
    expect(messages[1].text).toBe('What is my weakest theme?');
  });

  it('builds adaptive suggestion chips from misses, uploads, and conversation context', () => {
    const chips = buildAdaptiveSuggestionChips({
      submissions: [buildSubmission()],
      messages: [
        { id: 'a1', role: 'assistant', text: 'Try to visualize forcing checks.', timestamp: '11:00 AM' },
        { id: 'u1', role: 'user', text: 'I am not seeing it.', timestamp: '11:01 AM' },
      ],
      isSending: false,
    });

    expect(chips.map((chip) => chip.label)).toContain('Why do I keep missing mating nets?');
    expect(chips.map((chip) => chip.label)).toContain('Explain why my move failed.');
    expect(chips.map((chip) => chip.label)).toContain('Show my weakest tactical theme.');
  });

  it('applies starter prompt to input', () => {
    expect(applyStarterPromptToInput('Explain my last puzzle')).toBe('Explain my last puzzle');
  });

  it('builds momentum actions after an assistant turn', () => {
    const actions = buildConversationalMomentumActions({
      submissions: [buildSubmission()],
      messages: [
        { id: 'u1', role: 'user', text: 'Can you explain this line?', timestamp: '11:00 AM' },
        { id: 'a1', role: 'assistant', text: 'The key is to force the king to the back rank.', timestamp: '11:01 AM' },
      ],
      isSending: false,
    });

    expect(actions.length).toBeGreaterThan(0);
    expect(actions.map((action) => action.label)).toContain('Give Hint');
    expect(actions.map((action) => action.label)).toContain('Explain the Idea');
  });

  it('appends user message and placeholder assistant response', () => {
    const baseMessages = buildInitialAgentMessages();
    const now = new Date('2026-05-05T10:00:00Z');
    const nextMessages = appendMockAssistantTurn(baseMessages, 'How do I use Puzzle Lab?', now);

    expect(nextMessages).toHaveLength(baseMessages.length + 2);
    expect(nextMessages.at(-2)?.role).toBe('user');
    expect(nextMessages.at(-2)?.text).toBe('How do I use Puzzle Lab?');
    expect(nextMessages.at(-1)?.role).toBe('assistant');
    expect(nextMessages.at(-1)?.text).toContain('Once the backend is connected');
  });

  it('ignores empty user messages', () => {
    const baseMessages = buildInitialAgentMessages();
    const nextMessages = appendMockAssistantTurn(baseMessages, '   ');
    expect(nextMessages).toEqual(baseMessages);
  });

  it('derives requested mode from common question patterns', () => {
    expect(deriveRequestedMode('Can I get a hint 2?')).toBe('hint');
    expect(deriveRequestedMode('Want a hint or the full line?')).toBe('hint');
    expect(deriveRequestedMode('What candidate move were you considering?')).toBe('hint');
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
      conversation_mode: 'coach',
    });
  });
});
