/**
 * The phone grader's factored score (Nov 18): under the %, points work at a
 * Factor other than 1× shows the score times the Factor, "= 60 / 80" for
 * 15 / 20 at 4×, as the desktop grader shows it beside the box. Read-only:
 * the score saved is the one typed (DECISIONS, "The factored score").
 */
import './setup-mobile.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CID = 'test';
const SID = 'stu1';
const AID = 'a1';

function seed(weight) {
  localStorage.clear();
  _cache.scores[CID] = undefined;
  _cache.assessments[CID] = undefined;
  _cache.statuses[CID] = undefined;
  _cache.students[CID] = undefined;
  saveStudents(CID, [{ id: SID, firstName: 'Ava', lastName: 'Adams' }]);
  saveAssessments(CID, [
    { id: AID, title: 'Unit 1 Quiz', scoreMode: 'points', maxPoints: 20, weight: weight, tagIds: ['t1'] },
  ]);
  saveScores(CID, {});
  setPointsScore(CID, SID, AID, 15);
}

describe('the phone grader', () => {
  it('shows the factored score under the % at a Factor other than 1×', () => {
    seed(4);
    const html = MGrade.renderSwiper(CID, AID);
    expect(html).toContain('id="m-pts-fac-' + SID + '-' + AID + '"');
    expect(html).toContain('>= 60 / 80<');
  });

  it('shows none at 1×', () => {
    seed(1);
    expect(MGrade.renderSwiper(CID, AID)).not.toContain('m-pts-factored');
  });
});

describe('typing in the phone points box', () => {
  let listeners, origGetById, fac;

  beforeEach(() => {
    seed(4);
    listeners = {};
    fac = { textContent: '= 60 / 80', dataset: { factor: '4' } };
    const swiper = {
      addEventListener(type, fn) {
        listeners[type] = fn;
      },
    };
    origGetById = document.getElementById;
    document.getElementById = id =>
      id === 'm-swiper' ? swiper : id === 'm-pts-fac-' + SID + '-' + AID ? fac : origGetById(id);
    MGrade.setupSwiper(CID, AID);
  });

  afterEach(() => {
    document.getElementById = origGetById;
  });

  it('follows the box, and the score saved is the one typed', () => {
    listeners.focusout({
      target: {
        value: '18',
        dataset: { sid: SID, aid: AID, max: '20' },
        classList: { contains: c => c === 'm-pts-input' },
        setSelectionRange() {},
      },
    });
    expect(getPointsScore(CID, SID, AID)).toBe(18);
    expect(fac.textContent).toBe('= 72 / 80');
  });

  it('steps with + and −', () => {
    MGrade.adjustPointsScore(CID, SID, AID, -1, 20);
    expect(getPointsScore(CID, SID, AID)).toBe(14);
    expect(fac.textContent).toBe('= 56 / 80');
  });
});
