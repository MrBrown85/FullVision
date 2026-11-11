/**
 * The S2-F2 review's proofs, kept (student page build plan, S2-F2): the
 * Term Questionnaire, Generate and the phone copies in a class that holds
 * grades.
 *
 * U1 Every grade a draft: the questionnaire, Generate and every phone copy
 *    are what they were, and none holds a draft's words.
 * U2 Nothing kept from all-work readings (the grader's preview for every
 *    student, Print Grades) reaches them; the grader's preview still reads
 *    all work after the questionnaire was drawn.
 * U3 Grades never returned, with comments and notes: nowhere.
 * U4 A Note for the Report changed on returned work with a draft on top:
 *    no draft comment shows. (Whether the new note waits for the next
 *    Return, as Colin ruled on Nov 10, needs the returned copy to keep the
 *    note: a database change, not in this PR.)
 */
import './setup.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { FROZEN_AT, loadDemoClass } from './helpers/golden-grades.js';
import { freshGenerate, surfaceOf, surfaces } from './helpers/report-surfaces.js';

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
  const cid = base.cid;
  if (config) saveCourseConfig(cid, Object.assign({}, getCourseConfig(cid), config));
  return cid;
}
function storm(cid, every, mark, notes) {
  const students = sortStudents(getStudents(cid), 'lastName');
  getAssessments(cid).forEach((a, ai) => {
    if (isDibelsScored(a)) return;
    const rubric = a.rubricId ? getRubricById(cid, a.rubricId) : null;
    students.forEach((st, si) => {
      if (!every && (ai + si) % 3) return;
      const sid = st.id;
      const status = getAssignmentStatus(cid, sid, a.id);
      if (status === 'NS' || status === 'EXC') return;
      const tag = mark + '-' + sid + '-' + a.id;
      if (isCompletionScored(a)) {
        Grader.setMark(cid, sid, a.id, getCompletionMark(cid, sid, a.id) === 'complete' ? 'incomplete' : 'complete');
      } else if (isPointsScored(a)) {
        const p = getPointsScore(cid, sid, a.id);
        Grader.setPoints(cid, sid, a.id, p == null ? 1 : p > 0 ? p - 1 : p + 1);
      } else if (rubric) {
        (rubric.criteria || []).forEach((c, i) => {
          const entries = (getScores(cid)[sid] || []).filter(e => e.assessmentId === a.id);
          const lv = RubricPrint.criterionLevel(entries, a.id, c).level;
          Grader.setLevel(cid, sid, a.id, c.id, (lv % 4) + 1, 0);
          Grader.setCriterionComment(cid, sid, a.id, c.id, tag + '-crit' + i);
          Grader.setWentBeyond(cid, sid, a.id, c.id, tag + '-beyond' + i);
          (c.checks || []).forEach(x => {
            const on = getRubricCheckIds(cid, sid, a.id).indexOf(x.id) >= 0;
            Grader.setTick(cid, sid, a.id, x.id, !on);
          });
        });
      } else {
        (a.tagIds || []).forEach((tid, i) => {
          const e = (getScores(cid)[sid] || []).find(x => x.assessmentId === a.id && x.tagId === tid);
          Grader.setLevel(cid, sid, a.id, tid, ((e ? Number(e.score) || 0 : 0) % 4) + 1, 0);
          Grader.setCompetencyComment(cid, sid, a.id, tid, tag + '-tag' + i);
        });
      }
      Grader.setOverallComment(cid, sid, a.id, tag + '-overall');
      if (notes) Grader.setReportNote(cid, sid, a.id, tag + '-note');
    });
  });
}
const diff = (a, b, k) => {
  const x = a[k],
    y = b[k];
  let i = 0;
  while (i < x.length && x[i] === y[i]) i++;
  return (
    k + '\n  was: …' + x.slice(Math.max(0, i - 220), i + 160) + '\n  now: …' + y.slice(Math.max(0, i - 220), i + 160)
  );
};

describe('the questionnaire and phone copies in a class full of drafts', { timeout: 600000 }, () => {
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
  const draw = cid => {
    clearProfCache();
    freshGenerate();
    return surfaces(cid, ['questionnaire', 'phones']);
  };

  it('U1 every grade a draft (no notes): the questionnaire, Generate and the phone copies are what they were', () => {
    const cid = freshClass(HELD);
    const before = draw(cid);
    storm(cid, true, 'ZZSTORM', false);
    const after = draw(cid);
    const moved = Object.keys(before).filter(k => before[k] !== after[k]);
    const leaks = Object.keys(after).filter(k => after[k].indexOf('ZZSTORM') >= 0);
    moved.slice(0, 4).forEach(k => console.log('MOVED', diff(before, after, k)));
    expect(GradeState.draftsWaiting(cid)).toBeGreaterThan(500);
    expect(leaks).toEqual([]);
    expect(moved).toEqual([]);
  });

  it('U2 nothing kept from all-work readings (the grader’s preview for every student, Print Grades) reaches them', () => {
    const cid = freshClass(HELD);
    const before = draw(cid);
    storm(cid, false, 'ZZSOME', false);
    // No cache is cleared by the test from here on.
    getStudents(cid).forEach(st => {
      ReportScores.withReportScores('grader', () => CommentBank.facts(cid, st));
      ReportScores.withReportScores('grader', () => CommentBank.facts(cid, st, 'term-1'));
      ReportScores.withReportScores('grader', () => CommentBank.facts(cid, st, 'term-2'));
    });
    surfaces(cid, ['printGrades']);
    freshGenerate();
    const after = surfaces(cid, ['questionnaire', 'phones']);
    const moved = Object.keys(before).filter(k => before[k] !== after[k]);
    moved.slice(0, 3).forEach(k => console.log('MOVED', diff(before, after, k)));
    expect(moved).toEqual([]);
    // And the other way: the grader's preview still reads all work after the questionnaire was drawn.
    const st = getStudents(cid)[0];
    const all = JSON.stringify(ReportScores.withReportScores('grader', () => CommentBank.facts(cid, st)));
    const ret = JSON.stringify(CommentBank.facts(cid, st));
    expect(all).not.toBe(ret);
  });

  it('U3 grades never returned, with comments and notes: nowhere', () => {
    const cid = freshClass(null);
    const pieces = [
      getAssessments(cid).find(a => a.rubricId && !isPointsScored(a)),
      getAssessments(cid).find(a => isPointsScored(a) && !isCompletionScored(a)),
      getAssessments(cid).find(a => !a.rubricId && !isPointsScored(a) && !isDibelsScored(a)),
    ];
    const kept = structuredClone(getScores(cid));
    const scores = getScores(cid);
    Object.keys(scores).forEach(sid => {
      scores[sid] = scores[sid].filter(e => !pieces.some(p => p.id === e.assessmentId));
    });
    saveScores(cid, scores);
    saveCourseConfig(cid, Object.assign({}, getCourseConfig(cid), HELD));
    const before = draw(cid);
    let n = 0;
    getStudents(cid).forEach(st => {
      pieces.forEach(p => {
        const status = getAssignmentStatus(cid, st.id, p.id);
        if (status === 'NS' || status === 'EXC') return;
        (kept[st.id] || [])
          .filter(e => e.assessmentId === p.id && Number(e.score) > 0)
          .forEach(e => {
            if (isPointsScored(p)) Grader.setPoints(cid, st.id, p.id, Number(e.score));
            else Grader.setLevel(cid, st.id, p.id, e.tagId, Number(e.score), 0);
            n++;
          });
        Grader.setOverallComment(cid, st.id, p.id, 'ZZNEVER comment ' + st.id);
        Grader.setReportNote(cid, st.id, p.id, 'ZZNEVER note ' + st.id);
      });
    });
    const after = draw(cid);
    const moved = Object.keys(before).filter(k => before[k] !== after[k]);
    const leaks = Object.keys(after).filter(k => after[k].indexOf('ZZNEVER') >= 0);
    moved.slice(0, 3).forEach(k => console.log('MOVED', diff(before, after, k)));
    expect(leaks).toEqual([]);
    expect(moved).toEqual([]);
  });

  it('U4 a Note for the Report changed on a piece whose grade was returned, a draft on top', () => {
    const cid = freshClass(HELD);
    const before = draw(cid);
    storm(cid, false, 'ZZNOTED', true);
    const after = draw(cid);
    const holdNote = Object.keys(after).filter(k => after[k].indexOf('-note') >= 0 && after[k].indexOf('ZZNOTED') >= 0);
    const holdOther = Object.keys(after).filter(k => /ZZNOTED-[^"\\]*-(overall|crit|tag|beyond)/.test(after[k]));
    expect(holdOther).toEqual([]);
  });
});
