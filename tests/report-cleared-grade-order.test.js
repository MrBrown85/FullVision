/**
 * A returned grade cleared since moves no piece on a report (ROADMAP 1.9).
 *
 * In a class that holds grades, a returned grade the teacher then clears
 * has no working entry left, so the returned set (GradeState.returnedScores)
 * puts its returned copy at the end of the student's entries. Re-entering
 * the score does the same to the working copy. Every grade already counts
 * the same whatever order the entries are stored in (tests/evidence-order.test.js),
 * but Progress Reports' Learning Outcomes block named each competency's
 * pieces in stored order, so a cleared grade moved its piece to the end of
 * the line on the printed report while no number moved.
 *
 * The block now names them in the order they count in (calc.js
 * inCountingOrder: by date, same-date work by the piece made later, one
 * piece's scores in the order it lists them). This file holds:
 * - the helper: it orders and changes nothing else;
 * - Demo Mode's class: clearing a returned grade, and clearing it and
 *   entering and returning it again, leave every Progress Report, Assessments
 *   list and Term Questionnaire part as it was;
 * - a shuffled score list prints the same Learning Outcomes;
 * - against the block in stored order (the old way), every Demo report
 *   prints the same words, levels and pieces; only the order of the pieces
 *   on a line can differ.
 */
import './setup.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { FROZEN_AT, loadDemoClass } from './helpers/golden-grades.js';
import { freshGenerate, surfaces } from './helpers/report-surfaces.js';

const HELD = { student_page_enabled: true, return_grades: 'on_return' };

let base = null;
function freshClass(config) {
  if (!base) {
    const cid = loadDemoClass();
    const ls = {};
    for (let i = 0; i < localStorage.length; i++) ls[localStorage.key(i)] = localStorage.getItem(localStorage.key(i));
    base = { cid, ls, cache: structuredClone(_cache) };
  }
  localStorage.clear();
  Object.keys(base.ls).forEach(k => localStorage.setItem(k, base.ls[k]));
  Object.keys(base.cache).forEach(k => (_cache[k] = structuredClone(base.cache[k])));
  _returnedSets = {};
  clearProfCache();
  if (config) saveCourseConfig(base.cid, Object.assign({}, getCourseConfig(base.cid), config));
  return base.cid;
}

const draw = (cid, sid) => {
  _returnedSets = {};
  clearProfCache();
  freshGenerate();
  return surfaces(cid, ['progress', 'quick', 'questionnaire'], { students: [sid], handout: false });
};
const moved = (a, b) => Object.keys(a).filter(k => a[k] !== b[k]);

const outcomes = (cid, st) => {
  clearProfCache();
  return ReportScores.withReportScores('progress', () =>
    ReportBlocks.renderReportBlock('section-outcomes', cid, st, { termId: 'term-1' }, {}),
  );
};
// The block with each line's pieces sorted by name: what it says, not the order it says it in.
const piecesSorted = html =>
  html.replace(/(<div class="report-outcome-evidence">)(.*?)(<\/div>)/g, (_m, open, body, close) => {
    const sep = '<span style="color:var(--text-3);margin:0 3px">·</span>';
    return open + body.split(sep).sort().join(sep) + close;
  });

/* The returned pieces of a student that share a competency with another
   piece, first stored first: clearing one sends it from the front of the
   line to the end. */
function sharedPieces(cid, sid) {
  const entries = getScores(cid)[sid] || [];
  const aids = [...new Set(entries.map(e => e.assessmentId))];
  return aids.filter(aid => {
    if (GradeState.stateOf(cid, sid, aid) !== 'returned') return false;
    const tags = (getAssessments(cid).find(a => a.id === aid) || {}).tagIds || [];
    return tags.some(t => getTagScores(cid, sid, t).some(s => s.assessmentId !== aid && s.score > 0));
  });
}

function clearCell(cid, sid, aid) {
  const a = getAssessments(cid).find(x => x.id === aid);
  const mine = (getScores(cid)[sid] || []).filter(e => e.assessmentId === aid);
  Grader.clearScore(
    cid,
    getScores(cid),
    sid,
    a,
    mine.map(e => e.tagId),
  );
  return mine;
}

describe('a returned grade cleared since moves no piece on a report', { timeout: 120000 }, () => {
  let wasDemo;
  beforeAll(() => {
    wasDemo = window.isDemoMode;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(FROZEN_AT));
  });
  afterAll(() => {
    vi.useRealTimers();
    window.isDemoMode = wasDemo;
    CURRICULUM_INDEX = null;
    localStorage.clear();
    clearProfCache();
  });

  it('inCountingOrder sorts a copy by date, then same-date work, and changes no entry', () => {
    const cid = freshClass();
    const sid = 'st1';
    const given = getScores(cid)[sid].slice().reverse();
    const before = JSON.stringify(given);
    const out = inCountingOrder(cid, given);
    expect(JSON.stringify(given)).toBe(before);
    expect(out).not.toBe(given);
    // The same entries, each the same object with the same score.
    expect(out.length).toBe(given.length);
    expect([...out].sort((x, y) => given.indexOf(x) - given.indexOf(y))).toEqual(given);
    for (let i = 1; i < out.length; i++) {
      const d = (out[i - 1].date || '').localeCompare(out[i].date || '');
      expect(d).toBeLessThanOrEqual(0);
      if (d === 0 && out[i - 1].assessmentId !== out[i].assessmentId) {
        expect(samePieceDateOrder(cid, out[i - 1].assessmentId, out[i].assessmentId)).toBeLessThan(0);
      }
    }
    expect(inCountingOrder(cid, null)).toEqual([]);
    expect(window.Calc.inCountingOrder).toBe(inCountingOrder);
  });

  it('clearing a returned grade, or clearing it and returning it again, leaves every report part as it was', () => {
    let cid = freshClass(HELD);
    const sids = ['st1', 'st2'];
    for (const sid of sids) {
      cid = freshClass(HELD);
      const pieces = sharedPieces(cid, sid);
      expect(pieces.length, sid + ' has returned pieces that share a competency').toBeGreaterThan(1);
      const was = draw(cid, sid);
      // The first stored piece moves furthest; the second checks a piece mid-list.
      for (const aid of pieces.slice(0, 2)) {
        cid = freshClass(HELD);
        const levels = () =>
          ReportScores.withReportScores('progress', () => [
            getOverallProficiency(cid, sid),
            ...getSections(cid).map(s => getSectionProficiency(cid, sid, s.id)),
          ]);
        clearProfCache();
        const levelsWere = levels();

        const mine = clearCell(cid, sid, aid);
        expect(GradeState.stateOf(cid, sid, aid)).toBe('draft');
        expect(moved(was, draw(cid, sid)), 'cleared ' + sid + ' ' + aid).toEqual([]);
        clearProfCache();
        expect(levels()).toEqual(levelsWere);

        // Entered again (at the end of the score list) and returned.
        const scores = getScores(cid);
        scores[sid] = (scores[sid] || []).filter(e => e.assessmentId !== aid).concat(structuredClone(mine));
        saveScores(cid, scores);
        Grader.returnGrades(cid, aid, [sid]);
        expect(GradeState.stateOf(cid, sid, aid)).toBe('returned');
        expect(moved(was, draw(cid, sid)), 'cleared and returned again ' + sid + ' ' + aid).toEqual([]);
        clearProfCache();
        expect(levels()).toEqual(levelsWere);
      }
    }
  });

  it('a shuffled score list prints the same Learning Outcomes for every Demo student', () => {
    const cid = freshClass();
    const students = sortStudents(getStudents(cid), 'lastName');
    const was = students.map(st => outcomes(cid, st));
    const scores = getScores(cid);
    let seed = 7;
    const next = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    Object.keys(scores).forEach(sid => {
      const list = scores[sid] || [];
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
      }
    });
    saveScores(cid, scores);
    expect(students.map(st => outcomes(cid, st))).toEqual(was);
  });

  it('against stored order, every Demo report says the same pieces and levels; only their order on a line moves', () => {
    const cid = freshClass();
    const students = sortStudents(getStudents(cid), 'lastName');
    const counted = students.map(st => outcomes(cid, st));
    const real = globalThis.inCountingOrder;
    let stored;
    try {
      globalThis.inCountingOrder = (_cid, entries) => (entries || []).slice();
      stored = students.map(st => outcomes(cid, st));
    } finally {
      globalThis.inCountingOrder = real;
    }
    expect(counted.map(piecesSorted)).toEqual(stored.map(piecesSorted));
    // The order does move somewhere in Demo Mode (its scores are not stored by date), so the check above is not empty.
    expect(counted).not.toEqual(stored);
  });
});
