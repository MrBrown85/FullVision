/**
 * Scores left behind, stored in any order (S0-F1d, rule C, after the
 * independent review).
 *
 * A copy of the Demo class is given the scores a class is left with when
 * pieces change: a rubric lab switched to points and scored again (its
 * criterion levels stay), a competency taken off a piece (its levels stay),
 * a rubric piece switched to Complete/Incomplete and marked, and a quiz
 * moved from one competency to another (its score stays under the old one).
 * The Demo seed is not changed.
 *
 * Then every student's score list is shuffled, four ways. Every level,
 * piece, gradebook cell and course grade must come out the same, in all
 * work and through returned-only: which entry holds a piece's score never
 * depends on where it is stored. (Before the review's fix, a lab like this
 * one read 3 or 7 by which entry came first.)
 *
 * The Demo class has no two pieces on one date, so the order of same-date
 * work, which is its own ruling and its own PR, does not come into it.
 */
import './setup.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { FROZEN_AT, canonical, levelsOf, loadDemoClass, shownOf } from './helpers/golden-grades.js';

describe('Science 8 (a copy) with scores left behind: no number depends on the order they are stored in', () => {
  let cid;
  let wasDemo;
  let original;

  // A seeded shuffle (mulberry32, Fisher–Yates), so a failure can be run again.
  function shuffler(seed) {
    let a = seed >>> 0;
    const random = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return list => {
      const out = list.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    };
  }
  const everyGrade = () => {
    clearProfCache();
    const out = {};
    getStudents(cid).forEach(st => {
      out[st.id] = {
        levels: levelsOf(cid, st.id, true),
        shown: shownOf(cid, st.id, null),
        cells: Object.fromEntries(getAssessments(cid).map(a => [a.id, assessmentCellValue(cid, st.id, a).text])),
      };
    });
    return canonical(out, '');
  };

  beforeAll(() => {
    wasDemo = window.isDemoMode;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(FROZEN_AT));
    cid = loadDemoClass();
    setActiveTerm(cid, null);
    const piece = title => getAssessments(cid).find(a => a.title === title);
    const scores = getScores(cid);
    const sids = getStudents(cid).map(st => st.id);
    // 1. A rubric lab switched to points out of 10, then scored 7: its
    //    criterion levels are left behind.
    const lab = piece('Cell Microscope Lab');
    Object.assign(lab, { scoreMode: 'points', maxPoints: 10, rubricId: '' });
    sids.forEach(sid =>
      lab.tagIds.forEach(t => scores[sid].push({ assessmentId: lab.id, tagId: t, score: 7, date: lab.date })),
    );
    // 2. A competency taken off a piece: its levels are left behind.
    piece('Immune System Quick Check').tagIds = ['PA5'];
    // 3. A rubric piece switched to Complete/Incomplete, marked Complete.
    const essay = piece('Ecosystem Connections Essay');
    Object.assign(essay, { scoreMode: 'complete', maxPoints: 1, rubricId: '', tagIds: [] });
    sids.forEach(sid => scores[sid].push({ assessmentId: essay.id, tagId: 'overall', score: 1, date: essay.date }));
    // 4. A quiz moved from one competency to another, its score kept under the old one.
    piece('Cell Structure Quiz').tagIds = ['PA3'];
    original = scores;
  });
  afterAll(() => {
    vi.useRealTimers();
    window.isDemoMode = wasDemo;
    CURRICULUM_INDEX = null;
    localStorage.clear();
    clearProfCache();
  });

  it('every student’s levels, pieces, cells and course grade are the same in four shuffles', () => {
    const want = everyGrade();
    const cece = getStudents(cid).find(st => st.firstName === 'Cece').id;
    const at = title => getAssessments(cid).find(a => a.title === title).id;
    // The left-over scores are in the data, and none is read.
    expect(want[cece].cells[at('Cell Microscope Lab')]).toBe('7');
    expect(want[cece].cells[at('Ecosystem Connections Essay')]).toBe('\u2713');
    expect(want[cece].cells[at('Cell Structure Quiz')]).toBe('8');
    [1, 7, 20261109, 4242].forEach(seed => {
      const shuffle = shuffler(seed);
      const mixed = {};
      Object.keys(original).forEach(sid => (mixed[sid] = shuffle(original[sid])));
      expect(
        Object.keys(original).filter(sid => original[sid].some((e, i) => mixed[sid][i] !== e)).length,
      ).toBeGreaterThan(20);
      _cache.scores[cid] = mixed;
      expect(everyGrade(), 'all work, seed ' + seed).toEqual(want);
      // Returned only: the working copy as it was, the returned set shuffled.
      _cache.scores[cid] = original;
      globalThis.getReturnedScores = () => mixed;
      try {
        expect(withReturnedOnly(everyGrade), 'returned only, seed ' + seed).toEqual(want);
      } finally {
        delete globalThis.getReturnedScores;
      }
    });
    _cache.scores[cid] = original;
    clearProfCache();
  });
});
