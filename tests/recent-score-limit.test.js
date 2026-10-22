/**
 * "Count Only the Most Recent N" (course.recent_score_limit): a class can
 * count only each competency's last N scored entries. It changes the
 * proficiency for every method but Most Recent Score, the Grading tab's
 * examples and plain-words description follow it, and changing it asks
 * first, like a new method. migrations/20261022_course_recent_score_limit.sql.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CID = 'e0000000-0000-4000-8000-00000000r3c7';
const TAG = 'tag-1';

function entry(id, score, day, extra) {
  return Object.assign({ assessmentId: id, tagId: TAG, score: score, date: '2026-10-0' + day }, extra || {});
}

// Oldest first: 1, 2, 2, 3, 4 on five dates.
const SCORES = [entry('a', 1, 1), entry('b', 2, 2), entry('c', 2, 3), entry('d', 3, 4), entry('e', 4, 5)];

describe('calcProficiency with a recent limit', () => {
  it('counts only the last N scored entries for every method but Most Recent', () => {
    expect(calcProficiency(SCORES, 'average', 0.65, {})).toBeCloseTo(2.4);
    expect(calcProficiency(SCORES, 'average', 0.65, { recentLimit: 3 })).toBeCloseTo(3);
    expect(calcProficiency(SCORES, 'median', 0.65, { recentLimit: 3 })).toBe(3);
    expect(calcProficiency(SCORES, 'mode', 0.65, { recentLimit: 2 })).toBe(4);
    expect(calcProficiency(SCORES, 'highest', 0.65, { recentLimit: 2 })).toBe(4);
    expect(calcProficiency(SCORES, 'mostRecent', 0.65, { recentLimit: 3 })).toBe(4);
  });

  it('skips unscored entries and sorts by date before taking the last N', () => {
    const mixed = [entry('e', 4, 5), entry('x', 0, 6), entry('a', 1, 1), entry('d', 3, 4)];
    expect(calcProficiency(mixed, 'average', 0.65, { recentLimit: 2 })).toBeCloseTo(3.5);
  });

  it('a limit larger than the scores counts them all', () => {
    expect(calcProficiency(SCORES, 'average', 0.65, { recentLimit: 20 })).toBeCloseTo(2.4);
  });
});

describe('the class setting', () => {
  beforeEach(() => {
    localStorage.clear();
    saveCourses({ [CID]: { id: CID, name: 'Science 8', gradingSystem: 'proficiency', calcMethod: 'average' } });
    _cache.courseConfigs[CID] = { calcMethod: 'average' };
    saveStudents(CID, [{ id: 's1', firstName: 'Amara', lastName: 'Osei', enrolledDate: '2026-09-01' }]);
    _cache.learningMaps[CID] = {
      subjects: [],
      sections: [{ id: 'sec', name: 'Inquiry', tags: [{ id: TAG, label: 'Inquiry' }] }],
    };
    _cache.categories[CID] = [];
    _cache.assessments[CID] = SCORES.map(function (s) {
      return {
        id: s.assessmentId,
        title: 'Lab ' + s.assessmentId,
        scoreMode: 'proficiency',
        tagIds: [TAG],
        type: 'summative',
        date: s.date,
      };
    });
    _cache.scores[CID] = { s1: SCORES.slice() };
    _cache.statuses[CID] = {};
    clearProfCache();
  });

  it('reads the saved limit and leaves it out when unset', () => {
    expect(getRecentScoreLimit(CID)).toBeNull();
    expect(getTagProficiency(CID, 's1', TAG)).toBeCloseTo(2.4);
    _cache.courseConfigs[CID].recentScoreLimit = 3;
    clearProfCache();
    expect(getRecentScoreLimit(CID)).toBe(3);
    expect(getTagProficiency(CID, 's1', TAG)).toBeCloseTo(3);
    expect(describeCalcMethod(CID)).toBe('Average of the last 3 scores');
  });

  it('previews a new limit and puts the saved one back', () => {
    const preview = previewCalcMethodChange(CID, 'average', undefined, 3);
    expect(preview).toMatchObject({ changed: 1, total: 1 });
    expect(getRecentScoreLimit(CID)).toBeNull();
    expect(getTagProficiency(CID, 's1', TAG)).toBeCloseTo(2.4);
  });

  it('takes the server value from the class bundle, null meaning All Scores', () => {
    _applyBundleCourseConfig(CID, {}, { recent_score_limit: 5 });
    expect(getRecentScoreLimit(CID)).toBe(5);
    _applyBundleCourseConfig(CID, {}, { recent_score_limit: null });
    expect(getRecentScoreLimit(CID)).toBeNull();
    // A server without the column leaves this device's choice alone.
    _cache.courseConfigs[CID].recentScoreLimit = 3;
    _applyBundleCourseConfig(CID, {}, {});
    expect(getRecentScoreLimit(CID)).toBe(3);
  });

  it('the Grading tab examples follow the limit', () => {
    expect(calcMethodExample([1, 2, 2, 3, 4], 'average', 0.65, 3)).toBeCloseTo(3);
    expect(calcMethodExample([1, 2, 2, 3, 4], 'average', 0.65, null)).toBeCloseTo(2.4);
  });

  describe('on the Grading tab', () => {
    var confirms;
    var originalConfirm;
    var originalGetElementById;
    var main;
    beforeEach(() => {
      confirms = [];
      originalConfirm = globalThis.showConfirm;
      globalThis.showConfirm = function (title, message, okLabel, okStyle, onConfirm) {
        confirms.push({ title, message, run: onConfirm });
      };
      main = { innerHTML: '' };
      originalGetElementById = document.getElementById;
      document.getElementById = function (id) {
        return id === 'main' ? main : originalGetElementById(id);
      };
      DashClassManager.resetState();
      DashClassManager.configure({ activeCourse: CID, onRender() {}, onCourseChange() {} });
      DashClassManager.openClassManager();
      DashClassManager.handleAction('cmSetTab', { dataset: { tab: 'grading' } });
    });
    afterEach(() => {
      globalThis.showConfirm = originalConfirm;
      document.getElementById = originalGetElementById;
    });

    it('offers All Scores, 3 Scores and 5 Scores, and asks before changing grades', () => {
      expect(main.innerHTML).toContain('Count Only the Most Recent');
      expect(main.innerHTML).toContain('Older scores beyond this number are left out.');
      expect(main.innerHTML).toContain('<option value="" selected>All Scores</option>');
      DashClassManager.handleChange({ dataset: { actionChange: 'cmRecentLimit' }, value: '3' });
      expect(confirms).toHaveLength(1);
      expect(confirms[0].title).toBe('Count Only the Most Recent 3 Scores?');
      expect(confirms[0].message).toContain('1 of your 1 students');
      expect(getRecentScoreLimit(CID)).toBeNull();
      confirms[0].run();
      expect(getRecentScoreLimit(CID)).toBe(3);
      expect(main.innerHTML).toContain('Only the most recent 3 scores count.');
      expect(main.innerHTML).toContain('<option value="3" selected>3 Scores</option>');
    });

    it('is off with Most Recent Score', () => {
      _cache.courseConfigs[CID].calcMethod = 'mostRecent';
      DashClassManager.handleAction('cmSetTab', { dataset: { tab: 'grading' } });
      expect(main.innerHTML).toContain('Not used with Most Recent Score.');
      expect(main.innerHTML).toMatch(/id="cm-recent-limit"[^>]* disabled/);
    });
  });
});
