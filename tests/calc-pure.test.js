/**
 * Pure calculation tests — gb-calc.js core math functions.
 * These need no mocking — they take arguments and return results.
 */

// Helper: build a score object
function s(score, date, opts) {
  return {
    score,
    date: date || '2025-01-01',
    type: 'summative',
    tagId: 't1',
    assessmentId: 'a1',
    ...(opts || {}),
  };
}

/* ── pointsToProf ─────────────────────────────────────────── */
describe('pointsToProf', () => {
  it('returns 4 for 86% and above', () => {
    expect(pointsToProf(86, 100)).toBe(4);
    expect(pointsToProf(90, 100)).toBe(4);
    expect(pointsToProf(100, 100)).toBe(4);
  });

  it('returns 3 for 73-85%', () => {
    expect(pointsToProf(85, 100)).toBe(3);
    expect(pointsToProf(73, 100)).toBe(3);
  });

  it('returns 2 for 50-72%', () => {
    expect(pointsToProf(72, 100)).toBe(2);
    expect(pointsToProf(50, 100)).toBe(2);
  });

  it('returns 1 for below 50%', () => {
    expect(pointsToProf(49, 100)).toBe(1);
    expect(pointsToProf(0, 100)).toBe(1);
  });

  it('returns 0 for zero or negative maxPoints', () => {
    expect(pointsToProf(50, 0)).toBe(0);
    expect(pointsToProf(50, -10)).toBe(0);
    expect(pointsToProf(0, 0)).toBe(0);
  });

  it('works with non-100 maxPoints', () => {
    expect(pointsToProf(9, 10)).toBe(4); // 90%
    expect(pointsToProf(7, 10)).toBe(2); // 70%
    expect(pointsToProf(43, 50)).toBe(4); // 86%
    expect(pointsToProf(5, 10)).toBe(2); // 50%
  });

  it('supports custom grading scale', () => {
    const custom = {
      boundaries: [
        { min: 90, proficiency: 4 },
        { min: 70, proficiency: 3 },
        { min: 40, proficiency: 2 },
        { min: 0, proficiency: 1 },
      ],
    };
    expect(pointsToProf(85, 100, custom)).toBe(3);
    expect(pointsToProf(95, 100, custom)).toBe(4);
    expect(pointsToProf(39, 100, custom)).toBe(1);
  });
});

/* ── _calcGroup ───────────────────────────────────────────── */
describe('_calcGroup', () => {
  describe('mostRecent', () => {
    it('returns the last score by date', () => {
      expect(_calcGroup([s(2, '2025-01-01'), s(3, '2025-02-01'), s(4, '2025-03-01')], 'mostRecent', 0.65)).toBe(4);
    });

    it('sorts unsorted input and returns most recent', () => {
      expect(_calcGroup([s(4, '2025-03-01'), s(2, '2025-01-01')], 'mostRecent', 0.65)).toBe(4);
    });

    it('handles a single score', () => {
      expect(_calcGroup([s(3, '2025-01-01')], 'mostRecent', 0.65)).toBe(3);
    });
  });

  describe('highest', () => {
    it('returns the max score', () => {
      expect(_calcGroup([s(2), s(4), s(1)], 'highest', 0.65)).toBe(4);
    });

    it('handles a single score', () => {
      expect(_calcGroup([s(1)], 'highest', 0.65)).toBe(1);
    });
  });

  describe('mode', () => {
    it('returns the most frequent score', () => {
      expect(_calcGroup([s(3, '2025-01-01'), s(3, '2025-02-01'), s(2, '2025-03-01')], 'mode', 0.65)).toBe(3);
    });

    it('breaks ties with the most recent score', () => {
      // 2 and 3 each appear twice — 3 is more recent
      expect(
        _calcGroup([s(2, '2025-01-01'), s(3, '2025-02-01'), s(2, '2025-03-01'), s(3, '2025-04-01')], 'mode', 0.65),
      ).toBe(3);
    });

    it('breaks ties with most recent (reversed)', () => {
      // 2 and 3 each appear twice — 2 is more recent
      expect(
        _calcGroup([s(3, '2025-01-01'), s(2, '2025-02-01'), s(3, '2025-03-01'), s(2, '2025-04-01')], 'mode', 0.65),
      ).toBe(2);
    });

    it('respects assessment weights', () => {
      // Score 2 with weight 3 vs two score 3s with weight 1 each
      const scores = [
        s(2, '2025-01-01', { assessmentId: 'heavy' }),
        s(3, '2025-02-01', { assessmentId: 'light' }),
        s(3, '2025-03-01', { assessmentId: 'light2' }),
      ];
      const weights = { heavy: 3, light: 1, light2: 1 };
      expect(_calcGroup(scores, 'mode', 0.65, weights)).toBe(2);
    });
  });

  describe('average', () => {
    it('returns the unweighted mean, rounded', () => {
      // 2 + 3 + 4 = 9 / 3 = 3
      expect(_calcGroup([s(2), s(3), s(4)], 'average', 0.65)).toBe(3);
    });

    it('returns the single score for one entry', () => {
      expect(_calcGroup([s(4)], 'average', 0.65)).toBe(4);
    });

    it('rounds .5 to nearest integer', () => {
      // (2+3) / 2 = 2.5 → rounds to 3 (JS Math.round)
      expect(_calcGroup([s(2), s(3)], 'average', 0.65)).toBe(3);
    });

    it('respects per-assessment weights', () => {
      // (2*3 + 4*1) / 4 = 10/4 = 2.5 → rounds to 3
      const scores = [
        { score: 2, date: '2025-01-01', assessmentId: 'heavy' },
        { score: 4, date: '2025-02-01', assessmentId: 'light' },
      ];
      expect(_calcGroup(scores, 'average', 0.65, { heavy: 3, light: 1 })).toBe(3);
    });
  });

  describe('median', () => {
    it('returns the middle value for an odd-length list', () => {
      expect(_calcGroup([s(1), s(3), s(4)], 'median', 0.65)).toBe(3);
    });

    it('averages the two middle values for an even-length list', () => {
      // (2+4)/2 = 3
      expect(_calcGroup([s(1), s(2), s(4), s(4)], 'median', 0.65)).toBe(3);
    });

    it('is insensitive to an unusually low outlier', () => {
      // Mean of [1, 3, 4] = 2.67 but median = 3 (rewards typical performance)
      expect(_calcGroup([s(1), s(3), s(4)], 'median', 0.65)).toBe(3);
    });

    it('returns the single score for one entry', () => {
      expect(_calcGroup([s(2)], 'median', 0.65)).toBe(2);
    });
  });

  describe('decayingAvg', () => {
    it('returns the score for a single entry', () => {
      expect(_calcGroup([s(3)], 'decayingAvg', 0.65)).toBe(3);
    });

    it('weights recent scores higher', () => {
      // avg = 2*0.35 + 4*0.65 = 0.7 + 2.6 = 3.3 → rounds to 3
      expect(_calcGroup([s(2, '2025-01-01'), s(4, '2025-02-01')], 'decayingAvg', 0.65)).toBe(3);
    });

    it('uses high decay weight correctly', () => {
      // avg = 1*0.1 + 4*0.9 = 0.1 + 3.6 = 3.7 → rounds to 4
      expect(_calcGroup([s(1, '2025-01-01'), s(4, '2025-02-01')], 'decayingAvg', 0.9)).toBe(4);
    });

    it('penalizes declining performance', () => {
      // avg = 4*0.35 + 1*0.65 = 1.4 + 0.65 = 2.05 → rounds to 2
      expect(_calcGroup([s(4, '2025-01-01'), s(1, '2025-02-01')], 'decayingAvg', 0.65)).toBe(2);
    });
  });

  describe('edge cases', () => {
    it('returns 0 for empty array', () => {
      expect(_calcGroup([], 'mostRecent', 0.65)).toBe(0);
    });

    it('returns 0 when all scores are zero (filtered out)', () => {
      expect(_calcGroup([s(0, '2025-01-01'), s(0, '2025-02-01')], 'mostRecent', 0.65)).toBe(0);
    });

    it('defaults to mostRecent for unknown method', () => {
      expect(_calcGroup([s(2, '2025-01-01'), s(3, '2025-02-01')], 'bogus', 0.65)).toBe(3);
    });

    it('handles null dates', () => {
      expect(_calcGroup([s(2, null), s(4, null)], 'highest', 0.65)).toBe(4);
    });
  });
});

/* ── calcProficiency ──────────────────────────────────────── */
describe('calcProficiency', () => {
  it('calculates summative-only by default', () => {
    const scores = [s(3, '2025-01-01'), s(4, '2025-02-01')];
    expect(calcProficiency(scores, 'mostRecent', 0.65, {})).toBe(4);
  });

  it('ignores formative when formative weight is 0', () => {
    const scores = [s(3, '2025-01-01', { type: 'summative' }), s(1, '2025-02-01', { type: 'formative' })];
    expect(
      calcProficiency(scores, 'mostRecent', 0.65, {
        categoryWeights: { summative: 1.0, formative: 0 },
      }),
    ).toBe(3);
  });

  it('blends summative and formative with weights', () => {
    const scores = [s(4, '2025-01-01', { type: 'summative' }), s(2, '2025-02-01', { type: 'formative' })];
    // 4*0.7 + 2*0.3 = 2.8 + 0.6 = 3.4 → rounds to 3
    expect(
      calcProficiency(scores, 'mostRecent', 0.65, {
        categoryWeights: { summative: 0.7, formative: 0.3 },
      }),
    ).toBe(3);
  });

  it('uses only formative when no summative evidence', () => {
    const scores = [s(3, '2025-01-01', { type: 'formative' })];
    expect(
      calcProficiency(scores, 'mostRecent', 0.65, {
        categoryWeights: { summative: 0.7, formative: 0.3 },
      }),
    ).toBe(3);
  });

  it('uses only summative when no formative evidence', () => {
    const scores = [s(4, '2025-01-01', { type: 'summative' })];
    expect(
      calcProficiency(scores, 'mostRecent', 0.65, {
        categoryWeights: { summative: 0.7, formative: 0.3 },
      }),
    ).toBe(4);
  });

  it('returns 0 for empty scores', () => {
    expect(calcProficiency([], 'mostRecent', 0.65, {})).toBe(0);
  });
});

/* ── calcLetterGrade ──────────────────────────────────────── */
describe('calcLetterGrade', () => {
  it('returns A for 3.50+', () => {
    expect(calcLetterGrade(3.5)).toEqual({ letter: 'A', pct: 89 });
    expect(calcLetterGrade(4.0).letter).toBe('A');
    expect(calcLetterGrade(4.0).pct).toBe(96);
  });

  it('returns B for 3.00-3.49', () => {
    expect(calcLetterGrade(3.0)).toEqual({ letter: 'B', pct: 82 });
    expect(calcLetterGrade(3.25).letter).toBe('B');
  });

  it('returns C+ for 2.00-2.99', () => {
    expect(calcLetterGrade(2.0)).toEqual({ letter: 'C+', pct: 68 });
    expect(calcLetterGrade(2.25).letter).toBe('C+');
  });

  it('returns C- for 1.25-1.99', () => {
    expect(calcLetterGrade(1.25)).toEqual({ letter: 'C-', pct: 58.3 });
  });

  it('returns F for below 1.25', () => {
    expect(calcLetterGrade(0)).toEqual({ letter: 'F', pct: 0 });
    expect(calcLetterGrade(0.5).letter).toBe('F');
  });

  it('percentage increases monotonically with proficiency', () => {
    const levels = [0, 0.5, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0, 3.25, 3.5, 3.75, 4.0];
    for (let i = 1; i < levels.length; i++) {
      expect(calcLetterGrade(levels[i]).pct).toBeGreaterThanOrEqual(calcLetterGrade(levels[i - 1]).pct);
    }
  });

  it('never exceeds 100%', () => {
    expect(calcLetterGrade(4.0).pct).toBeLessThanOrEqual(100);
    expect(calcLetterGrade(5.0).pct).toBeLessThanOrEqual(100);
  });
});
