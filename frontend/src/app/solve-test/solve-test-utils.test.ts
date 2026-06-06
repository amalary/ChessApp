import { describe, expect, it } from 'vitest';

import {
  buildDashboardBackground,
  buildPanelGradientBackground,
  extractSolutionLines,
  extractSolveMeta,
  formatConfidence,
  isSuccessfulSolve,
  normalizeHexColor,
} from './solve-test-utils';

describe('solve-test utils', () => {
  it('normalizes valid hex colors and rejects invalid values', () => {
    expect(normalizeHexColor('#a1b2c3')).toBe('#A1B2C3');
    expect(normalizeHexColor('  #00ff00  ')).toBe('#00FF00');
    expect(normalizeHexColor('#abc')).toBeNull();
    expect(normalizeHexColor('not-a-color')).toBeNull();
  });

  it('extracts solve metadata with numeric normalization', () => {
    const meta = extractSolveMeta({
      vision_side_to_move: 'W',
      vision_confidence: '82',
      solver_confidence: 0.91,
      solver_confidence_label: 'high',
      vision_attempts_used: '2',
      vision_consensus_votes: '2',
      vision_unique_fen_count: 1,
      mate_found: true,
      mate_in: 3,
    });
    expect(meta).toEqual({
      sideToMove: 'white',
      confidence: 0.91,
      rawVisionConfidence: 0.82,
      confidenceLabel: 'high',
      attemptsUsed: 2,
      consensusVotes: 2,
      uniqueFenCount: 1,
      mateFound: true,
      mateIn: 3,
    });
  });

  it('filters invalid solve metadata values', () => {
    const meta = extractSolveMeta({
      vision_side_to_move: 'unknown',
      vision_confidence: 'bad',
      vision_attempts_used: 0,
      mate_found: 'yes',
      mate_in: 0,
    });
    expect(meta).toEqual({
      sideToMove: null,
      confidence: null,
      rawVisionConfidence: null,
      confidenceLabel: null,
      attemptsUsed: null,
      consensusVotes: null,
      uniqueFenCount: null,
      mateFound: null,
      mateIn: null,
    });
  });

  it('falls back to raw vision confidence when solver confidence is absent', () => {
    const meta = extractSolveMeta({
      vision_confidence: 0.77,
    });
    expect(meta.confidence).toBe(0.77);
    expect(meta.rawVisionConfidence).toBe(0.77);
  });

  it('extracts solution lines with fallback precedence', () => {
    expect(extractSolutionLines({ solution_line: ' Qh7# ' })).toEqual(['Qh7#']);
    expect(extractSolutionLines({ moves_san: ['Qh7#', 'Kg8'] })).toEqual(['Qh7# Kg8']);
    expect(extractSolutionLines({ mate_found: false })).toEqual([
      'No forced mate found in the search range.',
    ]);
    expect(extractSolutionLines({ detail: 'Engine unavailable' })).toEqual(['Engine unavailable']);
    expect(extractSolutionLines({})).toEqual(['No mate solution returned.']);
  });

  it('detects successful solve responses', () => {
    expect(isSuccessfulSolve({ mate_found: true })).toBe(true);
    expect(isSuccessfulSolve({ solution_line: 'Qh7#' })).toBe(true);
    expect(isSuccessfulSolve({ moves_san: ['Qh7#'] })).toBe(true);
    expect(isSuccessfulSolve({ moves_san: ['   '] })).toBe(false);
    expect(isSuccessfulSolve({})).toBe(false);
  });

  it('formats confidence values consistently', () => {
    expect(formatConfidence(0.756)).toBe('75.6%');
    expect(formatConfidence(null)).toBe('Unavailable');
  });

  it('builds expected gradient variants for dashboard background', () => {
    const dark = buildDashboardBackground([122, 148, 191], [165, 142, 180], true, 'diagonal', true);
    const light = buildDashboardBackground([122, 148, 191], [165, 142, 180], false, 'diagonal', false);
    expect(dark).toContain('linear-gradient(135deg');
    expect(light).toContain('#dfe6f1');
  });

  it('omits panel gradient for default light non-gradient style', () => {
    expect(
      buildPanelGradientBackground([122, 148, 191], [165, 142, 180], false, 'top-to-bottom', false),
    ).toBeUndefined();
  });
});
