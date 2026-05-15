export type AssistantRhythmIntent = 'chat' | 'hint' | 'explain' | 'status';

type RhythmOptions = {
  intent?: AssistantRhythmIntent;
  maxBeats?: number;
};

const CONFIDENCE_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\b(?:one|a) possible move is\b/gi, 'This is the move:'],
  [/\b(?:one|a) possible move\b/gi, 'This is the move'],
  [/\bit might be\b/gi, 'It is'],
  [/\bit could be\b/gi, 'It is'],
  [/\bmaybe\b/gi, 'Focus here'],
  [/\bperhaps\b/gi, 'Focus here'],
];

function normalizeWhitespace(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function splitToSentences(text: string): string[] {
  return text
    .split(/\n+/)
    .flatMap((chunk) => chunk.split(/(?<=[.!?…])\s+/))
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

function applyConfidenceLanguage(text: string): string {
  return CONFIDENCE_REPLACEMENTS.reduce(
    (next, [pattern, replacement]) => next.replace(pattern, replacement),
    text,
  );
}

function splitLongBeat(beat: string, maxWords: number): string[] {
  const words = beat.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) {
    return [beat];
  }

  const connectorSplit = beat
    .split(/\s+(?:but|until|because|while|then|and)\s+/i)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (connectorSplit.length > 1) {
    return connectorSplit;
  }

  const punctuationSplit = beat
    .split(/[,:;]\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (punctuationSplit.length > 1) {
    return punctuationSplit;
  }

  const pivot = Math.max(1, Math.min(words.length - 1, Math.ceil(words.length / 2)));
  return [words.slice(0, pivot).join(' '), words.slice(pivot).join(' ')];
}

function wordsPerBeat(intent: AssistantRhythmIntent): number {
  switch (intent) {
    case 'hint':
      return 9;
    case 'status':
      return 10;
    case 'chat':
      return 13;
    case 'explain':
    default:
      return 15;
  }
}

function defaultMaxBeats(intent: AssistantRhythmIntent): number {
  switch (intent) {
    case 'hint':
      return 4;
    case 'status':
      return 3;
    case 'chat':
      return 5;
    case 'explain':
    default:
      return 6;
  }
}

function punctuate(beat: string): string {
  if (/[.!?…]$/.test(beat)) {
    return beat;
  }
  return `${beat}.`;
}

export function buildConversationalBeats(
  text: string,
  options: RhythmOptions = {},
): string[] {
  const intent = options.intent ?? 'chat';
  const maxBeats = Math.max(1, options.maxBeats ?? defaultMaxBeats(intent));
  const normalized = normalizeWhitespace(text);
  if (!normalized) {
    return [];
  }

  const confidenceBoosted = applyConfidenceLanguage(normalized);
  const maxWords = wordsPerBeat(intent);
  const expanded = splitToSentences(confidenceBoosted).flatMap((beat) =>
    splitLongBeat(beat, maxWords),
  );

  const beats = expanded.map((beat) => punctuate(beat.trim())).filter(Boolean);
  if (beats.length <= maxBeats) {
    return beats;
  }

  const head = beats.slice(0, maxBeats - 1);
  const tail = beats.slice(maxBeats - 1).join(' ');
  return [...head, tail];
}

export function formatConversationalText(
  text: string,
  options: RhythmOptions = {},
): string {
  return buildConversationalBeats(text, options).join('\n');
}

export function buildBeatScheduleMs(
  beats: string[],
  intent: AssistantRhythmIntent = 'chat',
): number[] {
  if (beats.length === 0) {
    return [];
  }
  const firstDelay = 120;
  const baseDelay = intent === 'hint' || intent === 'status' ? 190 : 240;
  const schedule: number[] = [];
  let elapsed = 0;

  beats.forEach((beat, idx) => {
    if (idx === 0) {
      elapsed += firstDelay;
    } else {
      const words = beat.split(/\s+/).filter(Boolean).length;
      elapsed += Math.min(900, Math.max(baseDelay, 140 + words * 28));
    }
    schedule.push(elapsed);
  });

  return schedule;
}
