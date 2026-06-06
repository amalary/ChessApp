export type AssistantRhythmIntent = 'chat' | 'hint' | 'explain' | 'status';

type RhythmOptions = {
  intent?: AssistantRhythmIntent;
  maxBeats?: number;
  pacingProfile?: AssistantPacingProfile;
  variantSeed?: number | string;
};

type AssistantPacingProfile = 'steady' | 'compact' | 'mixed' | 'texty';

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

function hashSeed(value: number | string | undefined): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.abs(Math.floor(value));
  }
  if (typeof value !== 'string' || value.length === 0) {
    return 0;
  }
  let hash = 2166136261;
  for (let idx = 0; idx < value.length; idx += 1) {
    hash ^= value.charCodeAt(idx);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function resolvePacingProfile(
  intent: AssistantRhythmIntent,
  options: RhythmOptions,
): AssistantPacingProfile {
  if (options.pacingProfile) {
    return options.pacingProfile;
  }
  if (intent === 'status' || options.variantSeed === undefined) {
    return 'steady';
  }

  const bucket = hashSeed(options.variantSeed) % 10;
  if (bucket <= 2) {
    return 'compact';
  }
  if (bucket <= 6) {
    return 'mixed';
  }
  return 'texty';
}

function countWords(beat: string): number {
  return beat.split(/\s+/).filter(Boolean).length;
}

function groupBeatsEvenly(beats: string[], groupCount: number): string[] {
  const safeGroupCount = Math.max(1, Math.min(groupCount, beats.length));
  if (safeGroupCount === beats.length) {
    return beats;
  }

  const totalWords = beats.reduce((sum, beat) => sum + countWords(beat), 0);
  const targetWords = Math.max(1, Math.ceil(totalWords / safeGroupCount));
  const groups: string[] = [];
  let current: string[] = [];
  let currentWords = 0;

  beats.forEach((beat) => {
    const remainingGroups = safeGroupCount - groups.length;
    const remainingBeats = beats.length - groups.length - current.length;
    const shouldClose =
      current.length > 0 &&
      currentWords + countWords(beat) > targetWords &&
      remainingGroups > 1 &&
      remainingBeats >= remainingGroups;

    if (shouldClose) {
      groups.push(current.join(' '));
      current = [];
      currentWords = 0;
    }
    current.push(beat);
    currentWords += countWords(beat);
  });

  if (current.length > 0) {
    groups.push(current.join(' '));
  }
  return groups;
}

function applyPacingProfile(
  beats: string[],
  maxBeats: number,
  profile: AssistantPacingProfile,
  seed: number,
): string[] {
  if (beats.length <= 1 || profile === 'steady' || profile === 'texty') {
    return beats;
  }

  if (profile === 'compact') {
    const totalWords = beats.reduce((sum, beat) => sum + countWords(beat), 0);
    const groupCount = totalWords <= 52 || maxBeats <= 2 ? 1 : 2;
    return groupBeatsEvenly(beats, groupCount);
  }

  const grouped: string[] = [];
  let idx = 0;
  const keepFirstShort = seed % 2 === 0 && countWords(beats[0]) <= 14;
  if (keepFirstShort) {
    grouped.push(beats[0]);
    idx = 1;
  }

  while (idx < beats.length) {
    const take = (idx + seed) % 3 === 0 ? 1 : 2;
    grouped.push(beats.slice(idx, idx + take).join(' '));
    idx += take;
  }
  return grouped;
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
  const seed = hashSeed(options.variantSeed);
  const profile = resolvePacingProfile(intent, options);
  const pacedBeats = applyPacingProfile(beats, maxBeats, profile, seed);

  if (pacedBeats.length <= maxBeats) {
    return pacedBeats;
  }

  const head = pacedBeats.slice(0, maxBeats - 1);
  const tail = pacedBeats.slice(maxBeats - 1).join(' ');
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
  options: Pick<RhythmOptions, 'pacingProfile' | 'variantSeed'> = {},
): number[] {
  if (beats.length === 0) {
    return [];
  }
  const seed = hashSeed(options.variantSeed);
  const profile = resolvePacingProfile(intent, options);
  const firstDelay = 90 + (seed % 80);
  const profileDelayOffset =
    profile === 'compact' ? 80 : profile === 'texty' ? -35 : profile === 'mixed' ? 20 : 0;
  const baseDelay = (intent === 'hint' || intent === 'status' ? 190 : 240) + profileDelayOffset;
  const schedule: number[] = [];
  let elapsed = 0;

  beats.forEach((beat, idx) => {
    if (idx === 0) {
      elapsed += firstDelay;
    } else {
      const words = countWords(beat);
      const jitter = options.variantSeed === undefined ? 0 : ((seed + idx * 37) % 90) - 30;
      elapsed += Math.min(1050, Math.max(baseDelay, 140 + words * 28 + jitter));
    }
    schedule.push(elapsed);
  });

  return schedule;
}
