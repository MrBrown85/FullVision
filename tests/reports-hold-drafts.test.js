/**
 * Progress Reports and the rubric handout in a class that holds grades
 * (student page build plan, S2-F1): "A family never sees a draft, and the
 * teacher is asked, not surprised."
 *
 * 1. The plan's test: a class with one draft prints the returned number on
 *    a report and the all-work number on the grade sheet.
 * 2. A class with drafts is printed and every report output is searched
 *    for the drafts' values: none is there until it is returned, and the
 *    teacher's own Print Grades and Export still hold them.
 * 3. What Print asks about (teacher/drafts-before-print.js): the count and
 *    the names equal what Return Them returns, a pair's partner included;
 *    nothing is asked in a class that does not hold grades.
 *
 * Demo Mode's Science 8, with its student page on and Return Grades set to
 * When I Return Them, graded through the one grader like a teacher would.
 */
import './setup.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FROZEN_AT, loadDemoClass } from './helpers/golden-grades.js';
import { freshGenerate, surfaceOf, surfaces } from './helpers/report-surfaces.js';
import { seedClass, clearClass } from './helpers/pin-save-paths.js';

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

/* A student and a piece of work with a level scale and no grade for them
   yet, and the key a level goes under. Every Demo cell has a grade or a
   status, so one with only a status has it taken off first. */
function ungradedCell(cid, not) {
  for (const st of sortStudents(getStudents(cid), 'lastName')) {
    for (const a of getAssessments(cid)) {
      if (isPointsScored(a) || isDibelsScored(a) || (not && not.sid === st.id && not.aid === a.id)) continue;
      if ((getScores(cid)[st.id] || []).some(e => e.assessmentId === a.id)) continue;
      const rubric = a.rubricId ? getRubricById(cid, a.rubricId) : null;
      const key = rubric ? ((rubric.criteria || [])[0] || {}).id : (a.tagIds || [])[0];
      if (!key) continue;
      if (getAssignmentStatus(cid, st.id, a.id)) Grader.setStatus(cid, st.id, a.id, null);
      return { sid: st.id, aid: a.id, key };
    }
  }
  return null;
}

// The ticks a rubric handout prints, as Print Rubrics draws it (inside its own surface).
const handoutTicks = (cid, aid, sid) =>
  ReportScores.withReportScores('handout', () => RubricPrint.sheetData(cid, aid, sid).ticked);

describe('reports in a class that holds grades', { timeout: 120000 }, () => {
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

  // A student with a returned points score on a quiz (not Complete/Incomplete).
  const pointsCell = cid => {
    for (const a of getAssessments(cid).filter(x => isPointsScored(x) && !isCompletionScored(x))) {
      const st = sortStudents(getStudents(cid), 'lastName').find(s => getPointsScore(cid, s.id, a.id) > 1);
      if (st) return [st.id, a.id];
    }
    return [];
  };
  const rowOn = (cid, sid, aid) =>
    GradeReport.rows(
      cid,
      getStudents(cid).find(s => s.id === sid),
      GradeReport.options({ ungraded: true }),
    ).find(r => r.id === aid);
  const sheetCell = (cid, sid, aid) => {
    const col = { id: aid, assessment: getAssessments(cid).find(a => a.id === aid), outOf: null };
    return GradesPrint.cellText(cid, sid, col, { scoresAs: 'points' }).text;
  };

  it('one draft: the report prints the returned number, the grade sheet the all-work number', () => {
    const cid = freshClass(HELD);
    const [SAM, QUIZ] = pointsCell(cid);
    const was = getPointsScore(cid, SAM, QUIZ);
    expect(was, 'Sam has a returned quiz score').not.toBe(null);
    const before = rowOn(cid, SAM, QUIZ).score;
    const now = was > 1 ? was - 1 : was + 1;
    Grader.setPoints(cid, SAM, QUIZ, now);
    expect(GradeState.stateOf(cid, SAM, QUIZ)).toBe('draft');
    expect(GradeState.draftsWaiting(cid)).toBe(1);

    // The report: what Sam was given.
    expect(rowOn(cid, SAM, QUIZ).score).toBe(before);
    expect(rowOn(cid, SAM, QUIZ).score).toContain(String(was));
    // The teacher's grade sheet: the working copy.
    expect(sheetCell(cid, SAM, QUIZ)).toContain(String(now));
    expect(sheetCell(cid, SAM, QUIZ)).not.toContain(String(was));
    // The class's numbers differ only by that draft: Sam's overall on the report is the returned one.
    const overall = () => getOverallProficiency(cid, SAM);
    const allWork = overall();
    const onReport = ReportScores.withReportScores('progress', overall);
    clearProfCache();
    const returnedOnly = withReturnedOnly(overall);
    expect(onReport).toBe(returnedOnly);

    // Returned, the two agree.
    Grader.returnGrades(cid, QUIZ, [SAM]);
    expect(rowOn(cid, SAM, QUIZ).score).toContain(String(now));
    expect(ReportScores.withReportScores('progress', overall)).toBe(allWork);
  });

  it('a class with drafts: no report output holds a draft’s value until it is returned', () => {
    const cid = freshClass(HELD);
    const students = getStudents(cid);
    const [SAM, QUIZ] = pointsCell(cid);
    // A changed returned grade: Sam's quiz, with a new Overall Comment.
    Grader.setOverallComment(cid, SAM, QUIZ, 'ZZDRAFT changed comment');
    // A piece never returned: a level, an Overall Comment and a Note for the Report.
    const fresh = ungradedCell(cid);
    expect(fresh, 'a piece a student has no grade on').toBeTruthy();
    Grader.setLevel(cid, fresh.sid, fresh.aid, fresh.key, 4, 0);
    Grader.setOverallComment(cid, fresh.sid, fresh.aid, 'ZZDRAFT new piece comment');
    Grader.setReportNote(cid, fresh.sid, fresh.aid, 'ZZDRAFT note for the report');
    // A tick added to a returned Advanced Rubric grade.
    const lab = 'sci8a1';
    const rubric = getRubricById(cid, getAssessments(cid).find(a => a.id === lab).rubricId);
    const every = (rubric.criteria || []).flatMap(c => (c.checks || []).map(x => x.id));
    const cece = 'st1';
    const ticked = getRubricCheckIds(cid, cece, lab);
    const added = every.find(id => ticked.indexOf(id) < 0);
    expect(added, 'a box Cece has not ticked').toBeTruthy();
    Grader.setTick(cid, cece, lab, added, true);
    expect(GradeState.draftsWaiting(cid)).toBe(3);

    const draw = () => {
      clearProfCache();
      freshGenerate();
      return surfaces(cid, ['progress', 'quick', 'printGrades', 'export']);
    };
    const holding = (drawn, names, needle) =>
      Object.keys(drawn).filter(k => names.indexOf(surfaceOf(k)) >= 0 && drawn[k].indexOf(needle) >= 0);

    const held = draw();
    // Progress Reports, the Quick Report, its Feedback Pages and the rubric handout: nothing of a draft.
    expect(holding(held, ['progress', 'quick'], 'ZZDRAFT')).toEqual([]);
    expect(handoutTicks(cid, lab, cece)).not.toContain(added);
    expect(getRubricCheckIds(cid, cece, lab)).toContain(added);
    // The teacher's own record keeps every draft.
    expect(holding(held, ['export'], 'ZZDRAFT changed comment').length).toBe(1);
    expect(holding(held, ['export'], 'ZZDRAFT new piece comment').length).toBe(1);
    expect(holding(held, ['export'], 'ZZDRAFT note for the report').length).toBe(1);

    // Returned, as Return Them does it: each one is on the reports.
    const found = DraftsBeforePrint.find(
      cid,
      getAssessments(cid).map(a => a.id),
      students.map(s => s.id),
    );
    expect(found.total).toBe(3);
    expect(DraftsBeforePrint.returnAll(found)).toEqual({ all: true, left: 0 });
    expect(GradeState.draftsWaiting(cid)).toBe(0);
    const given = draw();
    expect(holding(given, ['quick'], 'ZZDRAFT changed comment').length).toBeGreaterThan(0);
    expect(holding(given, ['quick'], 'ZZDRAFT new piece comment').length).toBeGreaterThan(0);
    expect(handoutTicks(cid, lab, cece)).toContain(added);
    // And the teacher's own record is as it was.
    holding(given, ['printGrades', 'export'], '').forEach(k => expect(given[k], k).toBe(held[k]));
  });

  it('a Note for the Report is given to a report only once that piece’s grade has been returned (ruling 11)', () => {
    const cid = freshClass(HELD);
    const cell = ungradedCell(cid);
    const note = () =>
      ReportScores.withReportScores('progress', () => ReportScores.getScoreReportNote(cid, cell.sid, cell.aid));
    // Graded and noted: a draft, so the note is not on a report.
    Grader.setLevel(cid, cell.sid, cell.aid, cell.key, 3, 0);
    Grader.setReportNote(cid, cell.sid, cell.aid, 'ZZNOTE linked the poster to the Act');
    expect(GradeState.stateOf(cid, cell.sid, cell.aid)).toBe('draft');
    expect(note()).toBe('');
    // Returned: it is.
    Grader.returnGrades(cid, cell.aid, [cell.sid]);
    expect(note()).toBe('ZZNOTE linked the poster to the Act');
    // The teacher's own reader always had it.
    expect(getScoreReportNote(cid, cell.sid, cell.aid)).toBe('ZZNOTE linked the poster to the Act');
  });

  it('a note changed while a regrade is open waits with its grade: reports keep the returned one until the Return (E3)', () => {
    const cid = freshClass(HELD);
    const cell = ungradedCell(cid);
    const note = () =>
      ReportScores.withReportScores('progress', () => ReportScores.getScoreReportNote(cid, cell.sid, cell.aid));
    Grader.setLevel(cid, cell.sid, cell.aid, cell.key, 2, 0);
    Grader.setReportNote(cid, cell.sid, cell.aid, 'ZZOLD explains the cycle');
    Grader.returnGrades(cid, cell.aid, [cell.sid]);
    expect(note()).toBe('ZZOLD explains the cycle');
    // A note changed with no regrade open is not a draft: it prints at once.
    Grader.setReportNote(cid, cell.sid, cell.aid, 'ZZOLD explains the cycle well');
    expect(note()).toBe('ZZOLD explains the cycle well');
    // A regrade, then the note changed twice: reports keep the note the returned grade went out with.
    Grader.setLevel(cid, cell.sid, cell.aid, cell.key, 3, 0);
    expect(GradeState.stateOf(cid, cell.sid, cell.aid)).toBe('draft');
    Grader.setReportNote(cid, cell.sid, cell.aid, 'ZZNEW now names the stages');
    Grader.setReportNote(cid, cell.sid, cell.aid, 'ZZNEW now names every stage');
    expect(note()).toBe('ZZOLD explains the cycle well');
    expect(getScoreReportNote(cid, cell.sid, cell.aid)).toBe('ZZNEW now names every stage');
    // Returned: the new note prints.
    Grader.returnGrades(cid, cell.aid, [cell.sid]);
    expect(note()).toBe('ZZNEW now names every stage');
    // The next regrade keeps its own returned note, not the old hold.
    Grader.setLevel(cid, cell.sid, cell.aid, cell.key, 4, 0);
    expect(note()).toBe('ZZNEW now names every stage');
    Grader.setReportNote(cid, cell.sid, cell.aid, '');
    expect(note()).toBe('ZZNEW now names every stage');
  });

  it('GradeState.heldNote counts a held note only for the returned date it was kept with (E3)', () => {
    const at = '2026-11-01T10:00:00Z';
    const draft = { is_draft: true, returned_at: at, returned_copy: { v: 1, value: 2 } };
    expect(GradeState.heldNote(draft)).toEqual({ held: false });
    const held = GradeState.afterNote(draft, 'Kept');
    expect(GradeState.heldNote(held)).toEqual({ held: true, note: 'Kept' });
    expect(GradeState.afterNote(held, 'Newer')).toBe(held);
    expect(GradeState.heldNote(GradeState.afterNote(draft, ''))).toEqual({ held: true, note: '' });
    expect(GradeState.heldNote(Object.assign({}, held, { returned_at: '2026-11-02T10:00:00Z' }))).toEqual({
      held: false,
    });
    expect(GradeState.heldNote(Object.assign({}, held, { is_draft: false }))).toEqual({ held: false });
    expect(GradeState.afterNote({ is_draft: false, returned_at: at }, 'x')).toEqual({
      is_draft: false,
      returned_at: at,
    });
  });
});

/* ── What Print asks about ───────────────────────────────────── */

const CID = 'c-print-drafts';
const STUDENTS = ['s1', 's2', 's3'].map((id, i) => ({
  id,
  firstName: ['Jordan', 'Avery', 'Noor'][i],
  lastName: 'Test',
}));
const ESSAY = { id: 'essay', title: 'Essay', date: '2026-10-10', type: 'summative', tagIds: ['t1'] };
const TALK = {
  id: 'talk',
  title: 'Talk',
  date: '2026-10-15',
  type: 'summative',
  tagIds: ['t1'],
  collaboration: 'pair',
  pairs: [['s1', 's2']],
};

describe('DraftsBeforePrint', () => {
  function seed(config) {
    localStorage.clear();
    clearClass(CID);
    seedClass(CID, {
      students: STUDENTS,
      assessments: [structuredClone(ESSAY), structuredClone(TALK)],
      courseConfigs: config,
    });
  }
  beforeEach(() => seed(HELD));

  it('counts and names exactly what Return Them returns, a pair partner outside the print included', () => {
    Grader.setLevel(CID, 's1', 'essay', 't1', 3, 0);
    Grader.setLevel(CID, 's3', 'essay', 't1', 2, 0);
    Grader.setLevel(CID, 's1', 'talk', 't1', 4, 0);
    // The pair's grade went to both.
    expect(GradeState.stateOf(CID, 's2', 'talk')).toBe('draft');
    // Only Jordan is in the print.
    const found = DraftsBeforePrint.find(CID, ['essay', 'talk'], ['s1']);
    expect(found.total).toBe(3);
    expect(found.pieces.map(p => [p.title, p.sids.slice().sort()])).toEqual([
      ['Essay', ['s1']],
      ['Talk', ['s1', 's2']],
    ]);
    expect(GradeState.draftsSentence(CID, found.pieces[1].sids)).toBe('2 drafts: Avery and Jordan can’t see them yet.');
    expect(DraftsBeforePrint.returnAll(found)).toEqual({ all: true, left: 0 });
    // Noor was not in the print: hers still waits.
    expect(GradeState.stateOf(CID, 's3', 'essay')).toBe('draft');
    expect(GradeState.draftsWaiting(CID)).toBe(1);
    expect(DraftsBeforePrint.find(CID, ['essay', 'talk'], ['s1'])).toBe(null);
  });

  it('asks nothing in a class that does not hold grades', () => {
    [
      {},
      { return_grades: 'on_return' },
      { student_page_enabled: true, return_grades: 'on_save' },
      { student_page_enabled: true },
    ].forEach(config => {
      seed(config);
      Grader.setLevel(CID, 's1', 'essay', 't1', 3, 0);
      expect(DraftsBeforePrint.holds(CID), JSON.stringify(config)).toBe(false);
      expect(DraftsBeforePrint.find(CID, ['essay'], ['s1', 's2', 's3'])).toBe(null);
    });
  });

  it('a piece marked Missing is never a draft, so it is never asked about', () => {
    Grader.setLevel(CID, 's1', 'essay', 't1', 3, 0);
    Grader.returnGrades(CID, 'essay', ['s1']);
    Grader.setLevel(CID, 's1', 'essay', 't1', 4, 0);
    expect(DraftsBeforePrint.find(CID, ['essay'], ['s1']).total).toBe(1);
    // As a status saved on another device lands (this one refuses Missing on scored work).
    _cache.statuses[CID] = Object.assign({}, _cache.statuses[CID], { 's1:essay': 'NS' });
    expect(getAssignmentStatus(CID, 's1', 'essay')).toBe('NS');
    expect(DraftsBeforePrint.find(CID, ['essay'], ['s1'])).toBe(null);
  });

  it('a class that does not hold grades is asked nothing, even with a draft row left in it', () => {
    seed({ student_page_enabled: true, return_grades: 'on_save' });
    Grader.setLevel(CID, 's1', 'essay', 't1', 3, 0);
    _cache.gradeReturns[CID] = { essay: { s1: { is_draft: true } } };
    // The rule itself would call it a draft; the class does not hold grades, so Print asks nothing.
    expect(GradeState.draftsIn(CID, 'essay', ['s1'])).toEqual(['s1']);
    expect(DraftsBeforePrint.find(CID, ['essay'], ['s1'])).toBe(null);
  });

  it('a Return that does not return every draft it named says so, and nothing is said to have worked', () => {
    Grader.setLevel(CID, 's1', 'essay', 't1', 3, 0);
    Grader.setLevel(CID, 's3', 'essay', 't1', 2, 0);
    const found = DraftsBeforePrint.find(CID, ['essay'], ['s1', 's3']);
    expect(found.total).toBe(2);
    const real = GradeState.afterReturn;
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    GradeState.afterReturn = () => {
      throw new Error('the rule failed');
    };
    try {
      expect(DraftsBeforePrint.returnAll(found)).toEqual({ all: false, left: 2 });
    } finally {
      GradeState.afterReturn = real;
      quiet.mockRestore();
    }
    expect(GradeState.draftsWaiting(CID)).toBe(2);
    expect(DraftsBeforePrint.returnAll(found)).toEqual({ all: true, left: 0 });
  });

  it('the title says how many grades', () => {
    expect(DraftsBeforePrint.title(1)).toBe('1 Grade Isn’t Returned Yet');
    expect(DraftsBeforePrint.title(4)).toBe('4 Grades Aren’t Returned Yet');
  });
});
