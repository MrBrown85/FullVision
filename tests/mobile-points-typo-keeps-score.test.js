/**
 * Phone points box: a typo leaves the saved score (Nov 3 bug sweep, Step 4,
 * group 1). Typing "abc" over 17 and pressing Done cleared the score on the
 * phone and the server. The desktop boxes keep the saved score on a typo
 * (#860); the phone now does the same, through parsePointsInput's `saved`.
 * Only a box the teacher empties clears.
 */
import './setup-mobile.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CID = 'test';
const SID = 'stu1';
const AID = 'a1';

describe('typing in the phone points box', () => {
  let listeners, origGetById;

  function input(value) {
    return {
      value: value,
      dataset: { sid: SID, aid: AID, max: '20' },
      classList: { contains: c => c === 'm-pts-input' },
      setSelectionRange() {},
    };
  }

  // Type into the box and leave it (Done, or tapping away).
  function typeAndLeave(value) {
    const inp = input(value);
    listeners.focusout({ target: inp });
    return inp;
  }

  beforeEach(() => {
    localStorage.clear();
    _cache.scores[CID] = undefined;
    _cache.assessments[CID] = undefined;
    _cache.statuses[CID] = undefined;
    saveAssessments(CID, [{ id: AID, title: 'Unit 1 Quiz', scoreMode: 'points', maxPoints: 20, tagIds: ['t1'] }]);
    saveScores(CID, {});
    setPointsScore(CID, SID, AID, 17);

    listeners = {};
    const swiper = {
      addEventListener(type, fn) {
        listeners[type] = fn;
      },
    };
    origGetById = document.getElementById;
    document.getElementById = id => (id === 'm-swiper' ? swiper : origGetById(id));
    MGrade.setupSwiper(CID, AID);
  });

  afterEach(() => {
    document.getElementById = origGetById;
  });

  it.each(['abc', 'x', '-'])('keeps the saved score after the typo %j', typo => {
    const inp = typeAndLeave(typo);
    expect(getPointsScore(CID, SID, AID)).toBe(17);
    expect(inp.value).toBe('17');
  });

  it('clears the score when the box is emptied', () => {
    const inp = typeAndLeave('');
    expect(getPointsScore(CID, SID, AID)).toBe(null);
    expect(inp.value).toBe('');
  });

  it('saves a typed number, and a typed 0 is a score', () => {
    typeAndLeave('18');
    expect(getPointsScore(CID, SID, AID)).toBe(18);
    typeAndLeave('0');
    expect(getPointsScore(CID, SID, AID)).toBe(0);
  });
});
