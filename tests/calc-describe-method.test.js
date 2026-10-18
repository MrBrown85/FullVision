/**
 * describeCalcMethod: the class's competency calculation method in plain
 * words, shown under the student page's competency tiles and in the printed
 * report. It reads the same setting getTagProficiency uses: the course
 * config first, then the course row, then "most recent".
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CID = 'course-describe';

beforeEach(() => {
  _cache.courseConfigs[CID] = {};
  COURSES[CID] = { id: CID, name: 'Science 8' };
});
afterEach(() => {
  delete _cache.courseConfigs[CID];
  delete COURSES[CID];
});

describe('describeCalcMethod', () => {
  it('defaults to most recent', () => {
    expect(describeCalcMethod(CID)).toBe('Most recent score');
  });

  it('names each method', () => {
    const expected = {
      mostRecent: 'Most recent score',
      highest: 'Highest score',
      average: 'Average of all scores',
      median: 'Median score',
      mode: 'Most common score',
    };
    Object.keys(expected).forEach(method => {
      _cache.courseConfigs[CID] = { calcMethod: method };
      expect(describeCalcMethod(CID)).toBe(expected[method]);
    });
  });

  it('gives the decay weight as a percentage', () => {
    _cache.courseConfigs[CID] = { calcMethod: 'decayingAvg', decayWeight: 0.8 };
    expect(describeCalcMethod(CID)).toBe('Decaying average: newer work counts more (80%)');
  });

  it('uses the default 65% decay weight when none is set', () => {
    _cache.courseConfigs[CID] = { calcMethod: 'decayingAvg' };
    expect(describeCalcMethod(CID)).toBe('Decaying average: newer work counts more (65%)');
  });

  it('reads the course row when the config has no method', () => {
    COURSES[CID] = { id: CID, name: 'Science 8', calcMethod: 'median' };
    expect(describeCalcMethod(CID)).toBe('Median score');
  });

  it('prefers the course config over the course row', () => {
    COURSES[CID] = { id: CID, name: 'Science 8', calcMethod: 'median' };
    _cache.courseConfigs[CID] = { calcMethod: 'highest' };
    expect(describeCalcMethod(CID)).toBe('Highest score');
  });

  it('falls back to most recent for an unknown method', () => {
    _cache.courseConfigs[CID] = { calcMethod: 'weird' };
    expect(describeCalcMethod(CID)).toBe('Most recent score');
  });

  it('is exported on window.Calc', () => {
    expect(window.Calc.describeCalcMethod).toBe(describeCalcMethod);
  });
});
