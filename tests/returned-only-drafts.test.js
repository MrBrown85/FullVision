/**
 * Returned-only grades when some grades are drafts (student page build
 * plan 1.2 and 1.3, S0-F1), on the Demo class (Science 8, Proficiency) and
 * the eval fixture (History 12, Letter). Each case compares whole classes:
 * every student's levels, each piece's level and percent, the course level,
 * percent and letter, and the grade as shown, read through the golden
 * test's extraction (tests/helpers/golden-grades.js).
 *
 * 1. A grade never returned is not there: returned-only gives the numbers
 *    the class would have with that score deleted.
 * 2. A returned grade that was changed counts as it was returned: the
 *    numbers from before the change.
 * 3. A status counts at once in both sets, also on a piece whose grade is a
 *    draft: Late shows, Excused leaves the piece out, Missing counts.
 * 4. A returned grade that was cleared still counts as it was returned,
 *    until the clear is returned.
 *
 * The situations are the ones in tests/fixtures/grade-state-cases.json
 * (Batch A): "A new grade is a draft until it is returned", "A change to a
 * returned grade waits…", "A status on a draft shows at once; the grade
 * still waits", "A returned grade that is cleared waits as a draft, then
 * returns as no grade". The returned set comes from the reference builder
 * in tests/helpers/returned-scores.js. The clock is frozen as in the golden
 * test.
 */
import './setup.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FROZEN_AT, canonical, levelsOf, loadDemoClass, loadEvalClass, shownOf } from './helpers/golden-grades.js';
import { copyOfGrade, draftNeverReturned, draftOnReturned, installReturnedScores } from './helpers/returned-scores.js';

/* ── Reading a whole class ───────────────────────────────────── */

// Every student's grades for the year so far, in the class's own style.
function grades(cid) {
  const out = {};
  getStudents(cid).forEach(s => {
    out[s.id] = { levels: levelsOf(cid, s.id, true), shown: shownOf(cid, s.id, null) };
  });
  return canonical(out, '');
}
// Each from cold caches, since a test changes scores in place.
function allWork(cid) {
  clearProfCache();
  return grades(cid);
}
function returnedOnly(cid) {
  clearProfCache();
  return withReturnedOnly(() => grades(cid));
}

const student = (cid, first) => getStudents(cid).find(s => s.firstName === first).id;
const piece = (cid, title) => getAssessments(cid).find(a => a.title === title);
const entriesOn = (cid, sid, aid) => (getScores(cid)[sid] || []).filter(e => e.assessmentId === aid);
// Clear Score: the working copy holds nothing for the piece.
function clearGrade(cid, sid, aid) {
  const scores = getScores(cid);
  scores[sid] = (scores[sid] || []).filter(e => e.assessmentId !== aid);
}

/* One class for a group of tests: loaded once, its scores and statuses put
   back before each test, its grade_return rows emptied. */
function useClass(load) {
  const ctx = { cid: null, rows: {} };
  const rowsByClass = {};
  let installed;
  let scores;
  let statuses;
  let wasDemo;
  beforeAll(() => {
    wasDemo = window.isDemoMode;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(FROZEN_AT));
    ctx.cid = load();
    setActiveTerm(ctx.cid, null);
    scores = structuredClone(getScores(ctx.cid));
    statuses = structuredClone(getAssignmentStatuses(ctx.cid));
    installed = installReturnedScores(rowsByClass);
  });
  beforeEach(() => {
    _cache.scores[ctx.cid] = structuredClone(scores);
    _cache.statuses[ctx.cid] = structuredClone(statuses);
    ctx.rows = rowsByClass[ctx.cid] = {};
    clearProfCache();
  });
  afterAll(() => {
    installed.remove();
    vi.useRealTimers();
    window.isDemoMode = wasDemo;
    CURRICULUM_INDEX = null;
    localStorage.clear();
    clearProfCache();
  });
  return ctx;
}
const setRow = (ctx, aid, sid, row) => ((ctx.rows[aid] = ctx.rows[aid] || {})[sid] = row);

/* Science 8 is loaded first: Demo Mode only seeds its class when no other
   class is loaded. */

/* ── Science 8, a Proficiency class ──────────────────────────── */

describe('Science 8 (Proficiency): drafts on rubric and points work', () => {
  const ctx = useClass(loadDemoClass);

  it('2. a returned grade that was changed counts as it was returned: the numbers before the change', () => {
    const cid = ctx.cid;
    const cece = student(cid, 'Cece');
    const lab = piece(cid, 'Cell Microscope Lab');
    entriesOn(cid, cece, lab.id)[0].note = 'Careful lab work.';
    const before = allWork(cid);

    // Returned as it stands; then every criterion is lowered to 1 and the
    // Overall Comment rewritten, and the change is not returned.
    setRow(ctx, lab.id, cece, draftOnReturned(copyOfGrade(cid, cece, lab.id)));
    entriesOn(cid, cece, lab.id).forEach(e => {
      e.score = 1;
      delete e.mod;
      e.note = 'Redo the data table.';
    });
    const all = allWork(cid);
    const returned = returnedOnly(cid);

    expect(returned).toEqual(before);
    expect(all[cece]).not.toEqual(before[cece]);
    expect(all[cece].levels.workLevel[lab.id]).toBe(1);
    expect(returned[cece].levels.workLevel[lab.id]).toBe(before[cece].levels.workLevel[lab.id]);
    expect(all[cece].levels.overall).toBeLessThan(before[cece].levels.overall);
    // The teacher's overall for Cece drops from 3.1 to 3.0; the family's stays 3.1.
    expect(before[cece].shown.summaryText).toBe('3.1');
    expect(all[cece].shown.summaryText).toBe('3.0');
    expect(returned[cece].shown.summaryText).toBe('3.1');
    // The comment a family reads is the returned one.
    expect(_scoreRead.comment(cid, cece, lab.id)).toBe('Redo the data table.');
    expect(withReturnedOnly(() => _scoreRead.comment(cid, cece, lab.id))).toBe('Careful lab work.');
    // Nobody else moved.
    getStudents(cid)
      .filter(s => s.id !== cece)
      .forEach(s => expect(all[s.id], s.firstName).toEqual(before[s.id]));
  });

  it('2. the same for a level with a + or −, on work with no rubric', () => {
    const cid = ctx.cid;
    const cece = student(cid, 'Cece');
    const check = piece(cid, 'Immune System Quick Check');
    entriesOn(cid, cece, check.id).forEach((e, i) => {
      e.score = 3;
      e.mod = i === 0 ? 1 : -1;
    });
    const before = allWork(cid);
    setRow(ctx, check.id, cece, draftOnReturned(copyOfGrade(cid, cece, check.id)));
    entriesOn(cid, cece, check.id).forEach(e => {
      e.score = 4;
      delete e.mod;
    });
    expect(returnedOnly(cid)).toEqual(before);
    expect(allWork(cid)[cece]).not.toEqual(before[cece]);
  });

  it('4. a returned grade that was cleared still counts as it was returned, until the clear is returned', () => {
    const cid = ctx.cid;
    const cece = student(cid, 'Cece');
    const quiz = piece(cid, 'Cell Structure Quiz');
    const before = allWork(cid);
    expect(before[cece].levels.workPercent[quiz.id]).toBe(80); // 8 out of 10

    // Returned at 8/10, then Clear Score: a draft on a returned grade.
    setRow(ctx, quiz.id, cece, draftOnReturned(copyOfGrade(cid, cece, quiz.id)));
    clearGrade(cid, cece, quiz.id);
    const cleared = allWork(cid);
    const returned = returnedOnly(cid);

    expect(returned).toEqual(before);
    expect(cleared[cece].levels.workPercent[quiz.id]).toBeNull();
    expect(cleared[cece]).not.toEqual(before[cece]);
    expect(withReturnedOnly(() => _scoreRead.pointsScore(cid, cece, quiz.id))).toBe(8);
    expect(_scoreRead.pointsScore(cid, cece, quiz.id)).toBeNull();

    // The clear is returned: no grade is returned and none is waiting.
    delete ctx.rows[quiz.id];
    expect(returnedOnly(cid)).toEqual(cleared);
  });

  it('several drafts at once, across students and kinds of work', () => {
    const cid = ctx.cid;
    const cece = student(cid, 'Cece');
    const noor = student(cid, 'Noor');
    const sam = student(cid, 'Sam');
    const lab = piece(cid, 'Cell Microscope Lab');
    const quiz = piece(cid, 'Cell Structure Quiz');
    const hunt = piece(cid, 'Periodic Table Scavenger Hunt'); // Complete/Incomplete
    const before = allWork(cid);

    // Cece: lab changed after return. Noor: quiz never returned. Sam: the
    // Complete mark changed to Incomplete after return.
    setRow(ctx, lab.id, cece, draftOnReturned(copyOfGrade(cid, cece, lab.id)));
    entriesOn(cid, cece, lab.id).forEach(e => (e.score = 4));
    setRow(ctx, quiz.id, noor, draftNeverReturned());
    setRow(ctx, hunt.id, sam, draftOnReturned(copyOfGrade(cid, sam, hunt.id)));
    entriesOn(cid, sam, hunt.id).forEach(e => (e.score = 0));
    const returned = returnedOnly(cid);

    expect(returned[cece]).toEqual(before[cece]);
    expect(returned[sam]).toEqual(before[sam]);
    expect(withReturnedOnly(() => _scoreRead.completionMark(cid, sam, hunt.id))).toBe('complete');
    expect(_scoreRead.completionMark(cid, sam, hunt.id)).toBe('incomplete');
    // Noor: as if the quiz score were deleted.
    clearGrade(cid, noor, quiz.id);
    expect(returned[noor]).toEqual(allWork(cid)[noor]);
  });
});

/* ── History 12, a Letter class ──────────────────────────────── */

describe('History 12 (Letter): drafts and statuses', () => {
  const ctx = useClass(loadEvalClass);

  it('1. a grade never returned is left out: the numbers with that score deleted', () => {
    const cid = ctx.cid;
    const priya = student(cid, 'Priya');
    const debate = piece(cid, 'Lesson 4: Treaty Debate');
    // Priya's 3 on the Treaty Debate is a draft that was never returned.
    setRow(ctx, debate.id, priya, draftNeverReturned());
    const withDraft = allWork(cid);
    const returned = returnedOnly(cid);

    // What the class would be with that score deleted.
    clearGrade(cid, priya, debate.id);
    const deleted = allWork(cid);

    expect(returned).toEqual(deleted);
    expect(returned[priya].levels.workLevel[debate.id]).toBeNull();
    // All work still counts the draft: C 61% for the teacher, C- 58% for the family.
    expect(withDraft[priya].shown.summaryText).toBe('C 61%');
    expect(returned[priya].shown.summaryText).toBe('C- 58%');
    // Nobody else moved.
    getStudents(cid)
      .filter(s => s.id !== priya)
      .forEach(s => expect(returned[s.id], s.firstName).toEqual(withDraft[s.id]));
  });

  it('3a. Late on a draft shows at once in both sets; the grade still waits', () => {
    const cid = ctx.cid;
    const lena = student(cid, 'Lena');
    const week3 = piece(cid, 'Current Events: Week 3');
    setRow(ctx, week3.id, lena, draftNeverReturned());
    getAssignmentStatuses(cid)[lena + ':' + week3.id] = 'LATE';

    const cell = () => assessmentCellValue(cid, lena, week3);
    clearProfCache();
    expect(cell()).toMatchObject({ kind: 'level', value: 2, late: true, status: 'LATE' });
    expect(withReturnedOnly(cell)).toMatchObject({ kind: 'none', late: true, status: 'LATE' });

    const returned = returnedOnly(cid);
    clearGrade(cid, lena, week3.id);
    expect(returned).toEqual(allWork(cid));
  });

  it('3b. Excused on a piece with a draft leaves the piece out at once, in both sets', () => {
    const cid = ctx.cid;
    const owen = student(cid, 'Owen');
    const sources = piece(cid, 'Primary Source Analysis');
    // Returned at 4, changed to 1 (a draft), then marked Excused.
    setRow(ctx, sources.id, owen, draftOnReturned(copyOfGrade(cid, owen, sources.id)));
    entriesOn(cid, owen, sources.id).forEach(e => (e.score = 1));
    const beforeExcused = { all: allWork(cid), returned: returnedOnly(cid) };
    expect(beforeExcused.returned[owen]).not.toEqual(beforeExcused.all[owen]);

    getAssignmentStatuses(cid)[owen + ':' + sources.id] = 'EXC';
    const all = allWork(cid);
    const returned = returnedOnly(cid);
    expect(returned).toEqual(all);
    expect(returned[owen].levels.workLevel[sources.id]).toBeNull();
    expect(returned[owen]).not.toEqual(beforeExcused.returned[owen]);
  });

  it('3c. Missing counts at once in both sets', () => {
    const cid = ctx.cid;
    const noor = student(cid, 'Noor');
    const poster = piece(cid, 'What Does the Poster Show, and What Does It Hide?');
    const before = allWork(cid);
    // Nothing handed in: the score is cleared and the piece marked Missing.
    // The clear of a never-returned grade leaves nothing waiting.
    clearGrade(cid, noor, poster.id);
    getAssignmentStatuses(cid)[noor + ':' + poster.id] = 'NS';
    const all = allWork(cid);
    const returned = returnedOnly(cid);
    expect(returned).toEqual(all);
    // A Letter class counts Missing as 0: A 93% becomes B 82% for both.
    expect(before[noor].shown.summaryText).toBe('A 93%');
    expect(returned[noor].shown.summaryText).toBe('B 82%');
    expect(returned[noor].levels.workPercent[poster.id]).toBe(0);
  });

  it('4. a returned grade that was cleared still counts as it was returned (a level, in a Letter class)', () => {
    const cid = ctx.cid;
    const owen = student(cid, 'Owen');
    const sources = piece(cid, 'Primary Source Analysis');
    const before = allWork(cid);
    // Returned at 4, then Clear Score, not returned.
    setRow(ctx, sources.id, owen, draftOnReturned(copyOfGrade(cid, owen, sources.id)));
    clearGrade(cid, owen, sources.id);
    const cleared = allWork(cid);
    const returned = returnedOnly(cid);

    expect(returned).toEqual(before);
    // The teacher sees C 63% without the piece; the family still has C+ 68%.
    expect(cleared[owen].shown.summaryText).toBe('C 63%');
    expect(returned[owen].shown.summaryText).toBe('C+ 68%');
    // The clear is returned: gone for both.
    delete ctx.rows[sources.id];
    expect(returnedOnly(cid)).toEqual(cleared);
  });

  it('Missing after a returned grade was cleared: Missing wins at once in every number, in both sets (Colin, 2026-11-09)', () => {
    const cid = ctx.cid;
    const noor = student(cid, 'Noor');
    const poster = piece(cid, 'What Does the Poster Show, and What Does It Hide?');
    const before = allWork(cid);
    // Returned at 3; then cleared (a draft on a returned grade) and marked Missing.
    setRow(ctx, poster.id, noor, draftOnReturned(copyOfGrade(cid, noor, poster.id)));
    clearGrade(cid, noor, poster.id);
    getAssignmentStatuses(cid)[noor + ':' + poster.id] = 'NS';
    const all = allWork(cid);
    const returned = returnedOnly(cid);

    // The course % and letter: Missing wins in both sets.
    expect(returned[noor].shown.percent).toBe(all[noor].shown.percent);
    expect(returned[noor].shown.letter).toBe(all[noor].shown.letter);
    expect(returned[noor].levels.workPercent[poster.id]).toBe(0);
    // Competency levels: the returned 3 stopped counting when the piece was
    // marked Missing, so returned-only has what all-work has. (Before S0-F1d
    // returned-only kept the levels from before the clear.)
    expect(all[noor].levels.competencies).not.toEqual(before[noor].levels.competencies);
    expect(returned[noor].levels.competencies).toEqual(all[noor].levels.competencies);
    expect(returned[noor].levels.overall).toBe(all[noor].levels.overall);
  });
});
