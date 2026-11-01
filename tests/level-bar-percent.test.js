/**
 * Level bars agree with the figure beside them (2026-11-01 math audit). A
 * bar was level ÷ 4 wide while a Letter class printed the level's Counts
 * As %, so on the BC Letter Bands a Proficient 3 printed "80%" beside a
 * three-quarter bar.
 */
import './setup.js';
import { afterEach, describe, expect, it } from 'vitest';

const CID = 'level-bar';

function seed(gradingSystem, percents) {
  COURSES[CID] = { id: CID, gradingSystem };
  _cache.courseConfigs[CID] = percents
    ? { gradingScale: { boundaries: DEFAULT_GRADING_SCALE.boundaries, percents } }
    : {};
  clearProfCache();
}

describe('levelBarPercent', () => {
  afterEach(() => delete COURSES[CID]);

  it('fills to the % a Letter or Both class prints', () => {
    seed('letter', BC_LETTER_BAND_PERCENTS);
    expect(formatLevel(CID, 3)).toBe('80%');
    expect(levelBarPercent(CID, 3)).toBe(80);
    seed('both', BC_LETTER_BAND_PERCENTS);
    expect(levelBarPercent(CID, 10 / 3)).toBeCloseTo(86, 9);
  });

  it('is level ÷ 4 in a Proficiency class, whatever Counts As says', () => {
    seed('proficiency', BC_LETTER_BAND_PERCENTS);
    expect(levelBarPercent(CID, 3)).toBe(75);
  });

  it('is empty with no level and full at 4', () => {
    seed('letter');
    expect(levelBarPercent(CID, 0)).toBe(0);
    expect(levelBarPercent(CID, null)).toBe(0);
    expect(levelBarPercent(CID, 4)).toBe(100);
  });
});
