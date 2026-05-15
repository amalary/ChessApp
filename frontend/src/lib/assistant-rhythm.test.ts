import { describe, expect, it } from 'vitest';

import {
  buildBeatScheduleMs,
  buildConversationalBeats,
  formatConversationalText,
} from './assistant-rhythm';

describe('assistant rhythm', () => {
  it('splits long text into conversational beats', () => {
    const beats = buildConversationalBeats(
      'At first this position looks safe for Black, but the king has no stable square and the queen cannot keep both threats defended.',
      { intent: 'explain', maxBeats: 4 },
    );
    expect(beats.length).toBeGreaterThan(1);
    expect(beats.length).toBeLessThanOrEqual(4);
  });

  it('strengthens weak confidence language', () => {
    const beats = buildConversationalBeats('One possible move is Qh7#.', { intent: 'hint' });
    expect(beats[0]).toContain('This is the move');
  });

  it('formats output with newline pacing', () => {
    const formatted = formatConversationalText(
      'This feels safe for Black. It is not. The position collapses after one check.',
      { intent: 'chat', maxBeats: 5 },
    );
    expect(formatted).toContain('\n');
  });

  it('builds increasing schedule delays for beat playback', () => {
    const schedule = buildBeatScheduleMs(['Wait.', 'Do you see it?', 'That is the key.'], 'hint');
    expect(schedule).toHaveLength(3);
    expect(schedule[0]).toBeGreaterThan(0);
    expect(schedule[1]).toBeGreaterThan(schedule[0]);
    expect(schedule[2]).toBeGreaterThan(schedule[1]);
  });
});
