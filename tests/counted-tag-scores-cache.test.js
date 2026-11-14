/**
 * getCountedTagScores is kept, like the other grade lookups in calc.js.
 *
 * The Dashboard's student cards ask it for every competency of every
 * student on each draw (dash-student-cards.js), and it used to look the
 * category up for every score (countsTowardGrades → getCategoryById, a
 * linear find): about 5,000 lookups a draw on a class of 30. It now reads
 * the categories once per call, keeps what it made until clearProfCache or
 * a new category list, and gives the same entries it always did.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CID = 'course-counted-cache';
const TAGS = ['t1', 't2', 't3', 't4'];
const STUDENTS = Array.from({ length: 30 }, (_, i) => 'st' + i);
const CATS = ['cat-sum', 'cat-form', 'cat-zero'];

function seed() {
  saveCourses({ [CID]: { id: CID, name: 'Science 8', calcMethod: 'average', gradingSystem: 'proficiency' } });
  _cache.courseConfigs[CID] = { calcMethod: 'average' };
  _cache.categories[CID] = [
    { id: 'cat-sum', name: 'Summative', weight: 80 },
    { id: 'cat-form', name: 'Formative', weight: 20 },
    { id: 'cat-zero', name: 'Practice', weight: 0 },
  ];
  _cache.learningMaps[CID] = {
    subjects: [],
    sections: TAGS.map(t => ({ id: 'sec-' + t, name: t, tags: [{ id: t, label: t }] })),
    _customized: true,
    _version: 1,
  };
  _cache.assessments[CID] = Array.from({ length: 12 }, (_, i) => ({
    id: 'a' + i,
    title: 'Piece ' + i,
    categoryId: i % 4 === 3 ? '' : CATS[i % 3],
    tagIds: TAGS,
    date: '2026-10-' + String(i + 1).padStart(2, '0'),
  }));
  _cache.scores[CID] = {};
  STUDENTS.forEach((sid, s) => {
    _cache.scores[CID][sid] = [];
    _cache.assessments[CID].forEach((a, i) =>
      TAGS.forEach((t, k) =>
        _cache.scores[CID][sid].push({
          assessmentId: a.id,
          tagId: t,
          score: 1 + ((s + i + k) % 4),
          date: a.date,
          type: 'summative',
        }),
      ),
    );
  });
  _cache.statuses[CID] = {};
  clearProfCache();
}

// What getCountedTagScores gave before it was kept: getTagScores with the
// work that counts toward nothing taken out, one category lookup per score.
function reference(sid, tid) {
  const assessMap = new Map(getAssessments(CID).map(a => [a.id, a]));
  return getTagScores(CID, sid, tid).filter(s => {
    const a = assessMap.get(s.assessmentId);
    return !a || countsTowardGrades(CID, a);
  });
}

// One draw of the student cards' evidence: every competency of every student.
const draw = () => STUDENTS.map(sid => TAGS.map(tid => getCountedTagScores(CID, sid, tid)));

describe('getCountedTagScores is kept', () => {
  let realById;
  let lookups;
  beforeEach(() => {
    localStorage.clear();
    seed();
    realById = globalThis.getCategoryById;
    lookups = 0;
    globalThis.getCategoryById = function () {
      lookups++;
      return realById.apply(this, arguments);
    };
  });
  afterEach(() => {
    globalThis.getCategoryById = realById;
  });

  it('looks no category up per score on a draw of the cards', () => {
    draw();
    draw();
    expect(lookups).toBe(0);
  });

  it('gives back what it made on the next draw', () => {
    const first = draw();
    const second = draw();
    second.forEach((row, s) => row.forEach((list, t) => expect(list).toBe(first[s][t])));
  });

  it('gives the same entries as before, 0% work left out', () => {
    const got = draw();
    globalThis.getCategoryById = realById;
    STUDENTS.forEach((sid, s) => TAGS.forEach((tid, t) => expect(got[s][t]).toEqual(reference(sid, tid))));
    // Some work is left out (the 0% category), some kept with no category.
    expect(got[0][0].length).toBeLessThan(getTagScores(CID, 'st0', 't1').length);
    expect(got[0][0].some(e => e.assessmentId === 'a3')).toBe(true);
  });

  it('is made again when the categories change', () => {
    const before = getCountedTagScores(CID, 'st0', 't1');
    saveCategories(
      CID,
      getCategories(CID).map(c => (c.id === 'cat-zero' ? { ...c, weight: 10 } : c)),
    );
    const after = getCountedTagScores(CID, 'st0', 't1');
    expect(after).not.toBe(before);
    expect(after).toEqual(getTagScores(CID, 'st0', 't1'));
  });

  it('is made again when a new category list is put in place without a clear', () => {
    getCountedTagScores(CID, 'st0', 't1');
    _cache.categories[CID] = getCategories(CID).map(c => ({ ...c, weight: 50 }));
    expect(getCountedTagScores(CID, 'st0', 't1')).toEqual(getTagScores(CID, 'st0', 't1'));
  });

  it('is made again after clearProfCache', () => {
    const before = getCountedTagScores(CID, 'st0', 't1');
    _cache.scores[CID].st0 = _cache.scores[CID].st0.filter(e => e.assessmentId !== 'a0');
    clearProfCache();
    const after = getCountedTagScores(CID, 'st0', 't1');
    expect(after).not.toBe(before);
    expect(after.some(e => e.assessmentId === 'a0')).toBe(false);
    globalThis.getCategoryById = realById;
    expect(after).toEqual(reference('st0', 't1'));
  });
});
