import {
  readScopedStorageValue,
  writeScopedStorageValue,
} from '@/lib/dashboard-theme-settings';

export type AssistantConversationMode =
  | 'coach'
  | 'rival'
  | 'grandmaster'
  | 'club_friend'
  | 'minimal';

export const ASSISTANT_CONVERSATION_MODE_STORAGE_KEY =
  'chessapp.assistant.conversation.mode';
export const DEFAULT_ASSISTANT_CONVERSATION_MODE: AssistantConversationMode = 'coach';

export const ASSISTANT_CONVERSATION_MODE_OPTIONS: Array<{
  value: AssistantConversationMode;
  label: string;
  tone: string;
  sample: string;
}> = [
  {
    value: 'coach',
    label: 'Coach',
    tone: 'Supportive, educational, calm, patient',
    sample: "You're close. Look at the king's escape squares.",
  },
  {
    value: 'rival',
    label: 'Rival',
    tone: 'Competitive, sharp, energetic',
    sample: 'You saw the attack late.',
  },
  {
    value: 'grandmaster',
    label: 'Grandmaster',
    tone: 'Elite, precise, analytical',
    sample: 'Only forcing line works.',
  },
  {
    value: 'club_friend',
    label: 'Club Friend',
    tone: 'Casual, conversational, relaxed',
    sample: "Yeah this one's sneaky.",
  },
  {
    value: 'minimal',
    label: 'Minimal',
    tone: 'Ultra concise, move-focused',
    sample: 'Checks first.',
  },
];

export function normalizeAssistantConversationMode(
  value: unknown,
): AssistantConversationMode {
  if (typeof value !== 'string') {
    return DEFAULT_ASSISTANT_CONVERSATION_MODE;
  }

  switch (value.trim().toLowerCase()) {
    case 'coach':
      return 'coach';
    case 'rival':
      return 'rival';
    case 'grandmaster':
      return 'grandmaster';
    case 'club_friend':
      return 'club_friend';
    case 'minimal':
      return 'minimal';
    default:
      return DEFAULT_ASSISTANT_CONVERSATION_MODE;
  }
}

export function readAssistantConversationMode(
  scope: string | null,
): AssistantConversationMode {
  return normalizeAssistantConversationMode(
    readScopedStorageValue(ASSISTANT_CONVERSATION_MODE_STORAGE_KEY, scope),
  );
}

export function writeAssistantConversationMode(
  scope: string | null,
  mode: AssistantConversationMode,
): void {
  writeScopedStorageValue(
    ASSISTANT_CONVERSATION_MODE_STORAGE_KEY,
    scope,
    normalizeAssistantConversationMode(mode),
  );
}

export function getModeWelcomeShort(
  mode: AssistantConversationMode,
): string {
  switch (mode) {
    case 'coach':
      return "I'm Amy. Send the position and we'll work it step by step.";
    case 'rival':
      return "I'm Amy. Send the position, let's see if you spot it fast.";
    case 'grandmaster':
      return "I'm Amy. Position first, then candidate move.";
    case 'club_friend':
      return "I'm Amy. Drop the position and we'll work through it together.";
    case 'minimal':
      return "I'm Amy. Position. Candidate move.";
    default:
      return "I'm Amy. Send the position and we'll work it step by step.";
  }
}
