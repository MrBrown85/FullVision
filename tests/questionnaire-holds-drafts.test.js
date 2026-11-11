/**
 * The Term Questionnaire, Generate and Sent to Phones in a class that holds
 * grades (student page build plan, S2-F2; Colin's answer 6: returned only
 * for anything a family reads).
 *
 * 1. One draft: the questionnaire's header grade and a phone copy give the
 *    returned number; the gradebook's own number is the all-work one.
 * 2. A class with drafts is drawn and every questionnaire part (the facts,
 *    At a Glance, the lists, the whole screen, the checks, what Generate
 *    drafts) and every phone copy is searched for the drafts' values: none
 *    is there until it is returned.
 * 3. A Note for the Report reaches the questionnaire only once that piece's
 *    grade is returned (ruling 11).
 * 4. The grader's preview of the Note for the Report is the teacher's own
 *    screen: it reads all work, drafts included (the S2-T1 review's point 2).
 *
 * Demo Mode's Science 8, with its student page on and Return Grades set to
 * When I Return Them, graded through the one grader.
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
  saveCourseConfig(cid, Object.assign({}, getCourseConfig(cid), config || {}));
  return cid;
}

/* A student and a piece with a level scale and no grade for them yet, and
   the key a level goes under (a status alone is taken off first). */
function ungradedCell(cid) {
  for (const st of sortStudents(getStudents(cid), 'lastName')) {
    for (const a of getAssessments(cid)) {
      if (isPointsScored(a) || isDibelsScored(a)) continue;
      if ((getScores(cid)[st.id] || []).some(e => e.assessmentId === a.id)) continue;
      const rubric = a.rubricId ? getRubricById(cid, a.rubricId) : null;
      const key = rubric ? ((rubric.criteria || [])[0] || {}).id : (a.tagIds || [])[0];
      if (!key) continue;
      if (getAssignmentStatus(cid, st.id, a.id)) Grader.setStatus(cid, st.id, a.id, null);
      return { sid: st.id, aid: a.id, key, title: a.title };
    }
  }
  return null;
}

const student = (cid, sid) => getStudents(cid).find(s => s.id === sid);
const ctx = { termId: 'term-1', termLabel: 'Report 1' };

describe('the Term Questionnaire and Sent to Phones in a class that holds grades', { timeout: 120000 }, () => {
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

  it('one draft: the questionnaire and a phone copy give the returned grade; the teacher’s own views all work', () => {
    const cid = freshClass(HELD);
    // The student's whole course moves with one piece: their Extending lab drops to Emerging.
    const lab = getAssessments(cid).find(a => a.id === 'sci8a4');
    const crits = getRubricById(cid, lab.rubricId).criteria;
    const sid = sortStudents(getStudents(cid), 'lastName').find(s =>
      crits.every(c =>
        (getScores(cid)[s.id] || []).some(e => e.assessmentId === lab.id && e.tagId === c.id && e.score >= 3),
      ),
    ).id;
    const st = student(cid, sid);
    const before = {
      overall: getOverallProficiency(cid, sid),
      phone: PhoneReports.snapshot(cid, st, ctx).overall.text,
      facts: JSON.stringify(CommentBank.facts(cid, st, ctx.termId)),
    };
    crits.forEach(c => Grader.setLevel(cid, sid, lab.id, c.id, 1, 0));
    expect(GradeState.stateOf(cid, sid, lab.id)).toBe('draft');
    clearProfCache();
    freshGenerate();
    // The teacher's own number moved.
    expect(getOverallProficiency(cid, sid)).not.toBe(before.overall);
    // What a family reads did not.
    expect(PhoneReports.snapshot(cid, st, ctx).overall.text).toBe(before.phone);
    expect(JSON.stringify(CommentBank.facts(cid, st, ctx.termId))).toBe(before.facts);
    // Returned, it moves there too.
    Grader.returnGrades(cid, lab.id, [sid]);
    clearProfCache();
    freshGenerate();
    expect(JSON.stringify(CommentBank.facts(cid, st, ctx.termId))).not.toBe(before.facts);
    expect(PhoneReports.snapshot(cid, st, ctx).overall.text).not.toBe(before.phone);
  });

  it('a class with drafts: no questionnaire part, Generate draft or phone copy holds a draft’s value until it is returned', () => {
    const cid = freshClass(HELD);
    const cell = ungradedCell(cid);
    expect(cell, 'a piece a student has no grade on').toBeTruthy();
    Grader.setLevel(cid, cell.sid, cell.aid, cell.key, 4, 0);
    Grader.setOverallComment(cid, cell.sid, cell.aid, 'ZZDRAFT new piece comment');
    Grader.setReportNote(cid, cell.sid, cell.aid, 'ZZDRAFT linked the piece to the Act');
    // A returned piece changed since, with a new comment and note.
    const other = sortStudents(getStudents(cid), 'lastName').find(s => s.id !== cell.sid);
    const piece = getAssessments(cid).find(
      a =>
        !isPointsScored(a) &&
        a.id !== cell.aid &&
        (getScores(cid)[other.id] || []).some(e => e.assessmentId === a.id && e.score > 0),
    );
    Grader.setOverallComment(cid, other.id, piece.id, 'ZZDRAFT changed comment');
    expect(GradeState.draftsWaiting(cid)).toBe(2);

    const draw = () => {
      clearProfCache();
      freshGenerate();
      return surfaces(cid, ['questionnaire', 'phones', 'export']);
    };
    const holding = (drawn, names, needle) =>
      Object.keys(drawn).filter(k => names.indexOf(surfaceOf(k)) >= 0 && drawn[k].indexOf(needle) >= 0);

    const held = draw();
    expect(holding(held, ['questionnaire', 'phones'], 'ZZDRAFT')).toEqual([]);
    // The piece itself is not in the student's facts: its grade was never returned.
    const facts = CommentBank.facts(cid, student(cid, cell.sid), ctx.termId);
    expect((facts.work || []).some(w => w.id === cell.aid)).toBe(false);
    // The teacher's own record keeps them.
    expect(holding(held, ['export'], 'ZZDRAFT linked the piece to the Act').length).toBe(1);

    Grader.returnGrades(cid, cell.aid, [cell.sid]);
    Grader.returnGrades(cid, piece.id, [other.id]);
    const given = draw();
    expect(holding(given, ['questionnaire'], 'ZZDRAFT linked the piece to the Act').length).toBeGreaterThan(0);
    const after = CommentBank.facts(cid, student(cid, cell.sid), ctx.termId);
    expect((after.work || []).some(w => w.id === cell.aid)).toBe(true);
  });

  it('a Note for the Report is in the questionnaire’s facts only once that piece’s grade is returned (ruling 11)', () => {
    const cid = freshClass(HELD);
    const cell = ungradedCell(cid);
    const st = student(cid, cell.sid);
    Grader.setLevel(cid, cell.sid, cell.aid, cell.key, 4, 0);
    Grader.setReportNote(cid, cell.sid, cell.aid, 'ZZNOTE built a working model');
    const notes = () => JSON.stringify(CommentBank.facts(cid, st, ctx.termId)).indexOf('ZZNOTE') >= 0;
    clearProfCache();
    expect(notes()).toBe(false);
    Grader.returnGrades(cid, cell.aid, [cell.sid]);
    clearProfCache();
    expect(notes()).toBe(true);
  });

  it('the grader’s preview of the Note for the Report reads all work, drafts included', () => {
    const cid = freshClass(HELD);
    const cell = ungradedCell(cid);
    const st = student(cid, cell.sid);
    Grader.setLevel(cid, cell.sid, cell.aid, cell.key, 4, 0);
    clearProfCache();
    const inGrader = ReportScores.withReportScores('grader', () => CommentBank.facts(cid, st));
    const inQuestionnaire = CommentBank.facts(cid, st);
    expect((inGrader.work || []).some(w => w.id === cell.aid)).toBe(true);
    expect((inQuestionnaire.work || []).some(w => w.id === cell.aid)).toBe(false);
  });

  it('in a class that does not hold grades the questionnaire and the phone copies read all work', () => {
    const cid = freshClass({ student_page_enabled: true, return_grades: 'on_save' });
    const cell = ungradedCell(cid);
    const st = student(cid, cell.sid);
    Grader.setLevel(cid, cell.sid, cell.aid, cell.key, 4, 0);
    clearProfCache();
    expect((CommentBank.facts(cid, st).work || []).some(w => w.id === cell.aid)).toBe(true);
    expect(GradeState.draftsWaiting(cid)).toBe(0);
  });
});
