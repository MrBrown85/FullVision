/**
 * Revisions on the client (S11), in Demo Mode (shared/data.js,
 * "Revisions"; shared/seed-data.js, seedDemoRevisions).
 *
 * The plan's test (docs/plans/student-page-build-plan.md, S11): the old
 * grade counts until the new one is returned, then only the new one counts,
 * in all-work and returned-only; version 1 and its grade are still
 * readable; the board's worked example holds, 2.7 · 67% before and 3.0 ·
 * 75% after, and both show on Before and After.
 *
 * A revision is graded in the same score rows as the first version, so the
 * Draft and Returned rule (shared/grade-state.js) and calc.js do this with
 * no change: these tests go through the real writers (Grader), the real
 * rule and the real returned set (getReturnedScores), never a stand-in.
 *
 * Answers have the server's shapes (batch-c-contract.md at 65d550dc, PR
 * 1043, not applied).
 */
import './setup.js';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { U, seedClass, clearClass } from './helpers/pin-save-paths.js';
import { newBankIndex } from './helpers/bc-bank-fixture.js';

const CID = U(1);
const PIECE = U(31); // 2.6 The Conscription Crisis
const OTHER = U(32); // Current Events 4, no revision
const SUPPORT = U(41); // Support and Opposition
const LETTER = U(42); // Letter to the Editor
const JORDAN = U(100);
const HANNAH = U(101);
const FIRST_SUB = 'sub-jordan-v1';
const FIX = 'Add a third reason from Bourassa to the letter.';
const NOTE = 'I added how conscription split families in Quebec as the third reason.';
const PAGES = [{ path: 'revised-letter-1.jpg', thumb_path: 'revised-letter-1-thumb.jpg' }];
let wasDemo;
let n = 0;
const key = () => 'k' + ++n;
const ask = (over = {}) => ({
  what_to_fix: FIX,
  revise_by: '2026-11-10',
  criterion_ids: [],
  keep_grade: true,
  ...over,
});

function seed({ holds = true, sendWork = true } = {}) {
  seedClass(CID, {
    students: [
      { id: JORDAN, firstName: 'Jordan', lastName: 'Reyes' },
      { id: HANNAH, firstName: 'Hannah', lastName: 'Berg' },
    ],
    learningMaps: {
      subjects: [],
      sections: [
        {
          id: U(51),
          name: 'Conscription',
          tags: [
            { id: SUPPORT, label: 'Support and Opposition', text: 'Explain who supported and opposed it' },
            { id: LETTER, label: 'Letter to the Editor', text: 'Argue a position with reasons' },
          ],
        },
      ],
      _customized: true,
      _version: 1,
      _flatVersion: 2,
    },
    assessments: [
      {
        id: PIECE,
        title: '2.6 The Conscription Crisis',
        tagIds: [SUPPORT, LETTER],
        date: '2026-10-20',
        dueDate: '2026-10-30',
      },
      { id: OTHER, title: 'Current Events 4', tagIds: [SUPPORT], date: '2026-10-21' },
    ],
    courseConfigs: holds ? { student_page_enabled: true, return_grades: 'on_return' } : { student_page_enabled: true },
  });
  // Socials 10 shows a level and its percent: "2.7 · 67%".
  COURSES[CID].gradingSystem = 'both';
  saveDemoStudentWork(CID, {
    course: { send_work: sendWork },
    assessments: [{ id: PIECE, students_send: 'photos' }],
    submissions: [
      {
        id: FIRST_SUB,
        assessment_id: PIECE,
        enrollment_id: JORDAN,
        version: 1,
        state: 'sent',
        sent_by: 'student',
        on_paper: false,
        is_late: false,
        note: 'I wasn’t sure if my headline counted as a reason.',
        sent_at: '2026-10-31T03:41:00.000Z',
        created_at: '2026-10-31T03:40:00.000Z',
        files: [{ id: 'f1', page: 1, path: 'letter-1.jpg', thumb_path: 'letter-1-thumb.jpg' }],
      },
    ],
  });
}

const at = iso => vi.setSystemTime(new Date(iso));
const piece = () => getAssessments(CID).find(a => a.id === PIECE);
// The piece's result and the course grade, as calc.js gives and words them.
function numbers(sid = JORDAN) {
  clearProfCache();
  const cell = assessmentCellValue(CID, sid, piece());
  const overall = getOverallProficiency(CID, sid);
  // A Missing or Excused piece shows its status (M, EXC), not a level.
  const shown = cell.kind === 'status' ? cell.text : formatLevel(CID, cell.value);
  return { piece: shown, overall: formatLevel(CID, overall) };
}
const allWork = sid => numbers(sid);
const returnedOnly = sid => withReturnedOnly(() => numbers(sid));
// Jordan's first version, graded and returned: Letter to the Editor Developing +, Support and Opposition Proficient.
function gradeFirstVersion() {
  at('2026-11-01T18:00:00.000Z');
  Grader.setLevel(CID, JORDAN, PIECE, SUPPORT, 3, 0);
  Grader.setLevel(CID, JORDAN, PIECE, LETTER, 2, 1);
  Grader.setLevel(CID, HANNAH, PIECE, SUPPORT, 4, 0);
  Grader.setLevel(CID, HANNAH, PIECE, LETTER, 3, 0);
  Grader.returnGrades(CID, PIECE, [JORDAN, HANNAH]);
}
async function askForRevision(over) {
  at('2026-11-02T18:00:00.000Z');
  return returnForRevision(CID, JORDAN, PIECE, ask(over), key());
}
function sendRevision(when = '2026-11-10T03:12:00.000Z') {
  at(when);
  return sendStudentRevision(CID, JORDAN, PIECE, PAGES, NOTE, JORDAN);
}
const row = () => getGradeReturn(CID, JORDAN, PIECE);
// Missing or Excused on Jordan's piece, straight onto the class's statuses.
function mark(status) {
  const st = getAssignmentStatuses(CID);
  if (status) st[JORDAN + ':' + PIECE] = status;
  else delete st[JORDAN + ':' + PIECE];
  saveAssignmentStatuses(CID, st);
  clearProfCache();
}

beforeEach(() => {
  wasDemo = window.isDemoMode;
  window.isDemoMode = () => true;
  vi.useFakeTimers({ toFake: ['Date'] });
  localStorage.clear();
  seed();
});
afterEach(() => {
  vi.useRealTimers();
  clearClass(CID);
  localStorage.clear();
  window.isDemoMode = wasDemo;
  clearProfCache();
});

describe('the board’s worked example: 2.7 · 67% before, 3.0 · 75% after, both on Before and After', () => {
  it('Developing + and Proficient is 2.7 · 67%; the revision’s Proficient and Proficient is 3.0 · 75%; Before and After shows both', async () => {
    gradeFirstVersion();
    expect(allWork()).toEqual({ piece: '2.7 · 67%', overall: '2.7 · 67%' });
    expect(returnedOnly()).toEqual({ piece: '2.7 · 67%', overall: '2.7 · 67%' });

    const made = await askForRevision();
    expect(made.result).toBe('made');
    expect(made.hidden).toBe(false);
    expect(made.request.first_grade.tags[LETTER]).toEqual({ value: 2, modifier: 1, comment: null });
    expect(made.request.first_grade.tags[SUPPORT]).toEqual({ value: 3, modifier: 0, comment: null });

    expect(sendRevision()).toEqual({ ok: true, submission_id: expect.any(String), version: 2, late: false });
    at('2026-11-10T16:00:00.000Z');
    Grader.setLevel(CID, JORDAN, PIECE, LETTER, 3, 0);
    // Not returned yet: the student and every family number still have 2.7 · 67%.
    expect(returnedOnly()).toEqual({ piece: '2.7 · 67%', overall: '2.7 · 67%' });
    Grader.returnGrades(CID, PIECE, [JORDAN]);

    expect(allWork()).toEqual({ piece: '3.0 · 75%', overall: '3.0 · 75%' });
    expect(returnedOnly()).toEqual({ piece: '3.0 · 75%', overall: '3.0 · 75%' });
    // Before and After: the first version's result beside the new one.
    const before = getRevisionFirstCell(CID, JORDAN, PIECE, true);
    expect(formatLevel(CID, before.value)).toBe('2.7 · 67%');
    const after = withReturnedOnly(() => assessmentCellValue(CID, JORDAN, piece()));
    expect(formatLevel(CID, after.value)).toBe('3.0 · 75%');
    // Reading the first version's result leaves every number as it was.
    expect(returnedOnly()).toEqual({ piece: '3.0 · 75%', overall: '3.0 · 75%' });
    expect(allWork()).toEqual({ piece: '3.0 · 75%', overall: '3.0 · 75%' });
    // "Was Developing + on the Oct 30 version" and the student's own copy.
    const mine = getStudentRevision(CID, JORDAN, PIECE);
    expect(mine.state).toBe('returned');
    expect(mine.first_grade.tags[LETTER]).toEqual({ value: 2, modifier: 1, comment: null });
    expect(mine.what_to_fix).toBe(FIX);
    expect(mine.revision_note).toBe(NOTE);
    // Hannah, who was not asked, did not move.
    expect(returnedOnly(HANNAH)).toEqual({ piece: '3.5 · 88%', overall: '3.5 · 88%' });
  });
});

describe('which grade counts', () => {
  it('returned-only: the old grade counts until the new one is returned, then only the new one', async () => {
    gradeFirstVersion();
    await askForRevision();
    expect(returnedOnly().piece).toBe('2.7 · 67%');
    sendRevision();
    expect(returnedOnly().piece).toBe('2.7 · 67%');
    Grader.setLevel(CID, JORDAN, PIECE, LETTER, 3, 0);
    expect(returnedOnly().piece).toBe('2.7 · 67%');
    expect(row().returned_copy.tags[LETTER]).toEqual({ value: 2, modifier: 1, comment: null });
    Grader.returnGrades(CID, PIECE, [JORDAN]);
    expect(returnedOnly().piece).toBe('3.0 · 75%');
    // Only the new grade is in the set: one entry per competency, the first version's in none.
    const entries = getReturnedScores(CID)[JORDAN].filter(e => e.assessmentId === PIECE);
    expect(entries.map(e => [e.tagId, e.score, e.mod || 0]).sort()).toEqual(
      [
        [LETTER, 3, 0],
        [SUPPORT, 3, 0],
      ].sort(),
    );
  });

  it('all work: the old grade counts until the teacher regrades; the regrade is a draft, marked; once returned only the new one counts', async () => {
    gradeFirstVersion();
    await askForRevision();
    sendRevision();
    expect(allWork().piece).toBe('2.7 · 67%');
    Grader.setLevel(CID, JORDAN, PIECE, LETTER, 3, 0);
    // The teacher's own views count drafts, marked Draft (DECISIONS, answers 6).
    expect(GradeState.stateOf(CID, JORDAN, PIECE)).toBe('draft');
    expect(allWork().piece).toBe('3.0 · 75%');
    Grader.returnGrades(CID, PIECE, [JORDAN]);
    expect(GradeState.stateOf(CID, JORDAN, PIECE)).toBe('returned');
    expect(allWork().piece).toBe('3.0 · 75%');
    const entries = getScores(CID)[JORDAN].filter(e => e.assessmentId === PIECE);
    expect(entries).toHaveLength(2);
  });

  it('in a class that returns as soon as it saves, the regrade counts at once in both', async () => {
    localStorage.clear();
    seed({ holds: false });
    gradeFirstVersion();
    await askForRevision();
    sendRevision();
    expect(getRevisionRequest(CID, JORDAN, PIECE).state).toBe('sent');
    at('2026-11-10T16:00:00.000Z');
    Grader.setLevel(CID, JORDAN, PIECE, LETTER, 3, 0);
    expect(getRevisionRequest(CID, JORDAN, PIECE).state).toBe('returned');
    expect(returnedOnly().piece).toBe('3.0 · 75%');
    expect(allWork().piece).toBe('3.0 · 75%');
  });

  it('when no grade is a draft, returned-only and all-work agree at every step', async () => {
    gradeFirstVersion();
    expect(returnedOnly()).toEqual(allWork());
    await askForRevision();
    expect(returnedOnly()).toEqual(allWork());
    sendRevision();
    expect(returnedOnly()).toEqual(allWork());
    Grader.setLevel(CID, JORDAN, PIECE, LETTER, 3, 0);
    Grader.returnGrades(CID, PIECE, [JORDAN]);
    expect(returnedOnly()).toEqual(allWork());
  });
});

describe('the first version’s result on points work', () => {
  it('7 / 10 before, 9 / 10 after; reading the first leaves the returned number as it is, cache and all', async () => {
    Object.assign(piece(), { scoreMode: 'points', maxPoints: 10 });
    at('2026-11-01T18:00:00.000Z');
    Grader.setPoints(CID, JORDAN, PIECE, 7);
    Grader.returnGrades(CID, PIECE, [JORDAN]);
    await askForRevision();
    sendRevision();
    at('2026-11-10T16:00:00.000Z');
    Grader.setPoints(CID, JORDAN, PIECE, 9);
    Grader.returnGrades(CID, PIECE, [JORDAN]);
    clearProfCache();
    const now = () => withReturnedOnly(() => assessmentCellValue(CID, JORDAN, piece()).value);
    expect(now()).toBe(9);
    expect(getRevisionFirstCell(CID, JORDAN, PIECE, true).value).toBe(7);
    // No clearProfCache here: whatever calc.js kept while reading the first version is gone.
    expect(now()).toBe(9);
    expect(withReturnedOnly(() => getAssessmentOverallScore(CID, JORDAN, PIECE))).toBe(
      getAssessmentOverallScore(CID, JORDAN, PIECE),
    );
  });
});

describe('version 1 and its grade stay readable', () => {
  it('both versions are listed; the newest is getStudentSubmission’s; the first grade is on the request', async () => {
    gradeFirstVersion();
    await askForRevision();
    sendRevision();
    Grader.setLevel(CID, JORDAN, PIECE, LETTER, 3, 0);
    Grader.returnGrades(CID, PIECE, [JORDAN]);
    const versions = getSubmissionVersions(CID, JORDAN, PIECE);
    expect(versions.map(s => s.version)).toEqual([1, 2]);
    expect(versions[0].id).toBe(FIRST_SUB);
    expect(versions[0].files.map(f => f.path)).toEqual(['letter-1.jpg']);
    expect(versions[1].files.map(f => f.path)).toEqual(['revised-letter-1.jpg']);
    expect(versions[1].note).toBe(NOTE);
    expect(getStudentSubmission(CID, JORDAN, PIECE).version).toBe(2);
    const req = getRevisionRequest(CID, JORDAN, PIECE);
    expect(req.first_submission_id).toBe(FIRST_SUB);
    expect(req.first_version).toBe(1);
    expect(req.first_returned_at).toBe('2026-11-01T18:00:00.000Z');
    expect(req.first_grade.tags[LETTER]).toEqual({ value: 2, modifier: 1, comment: null });
    expect(req.revision_version).toBe(2);
    expect(getStudentRevision(CID, JORDAN, PIECE).first_sent_at).toBe('2026-10-31T03:41:00.000Z');
    // The teacher's "Was …" is the first version's own result.
    expect(formatLevel(CID, getRevisionFirstCell(CID, JORDAN, PIECE).value)).toBe('2.7 · 67%');
  });
});

describe('the states, and what the counts must ask', () => {
  it('open, sent, grading, returned; revising, revised, grading, then nothing', async () => {
    gradeFirstVersion();
    expect(revisionWorkState(CID, JORDAN, PIECE)).toBeNull();
    await askForRevision();
    expect(getRevisionRequest(CID, JORDAN, PIECE).state).toBe('open');
    expect(revisionWorkState(CID, JORDAN, PIECE)).toBe('revising');
    sendRevision();
    expect(getRevisionRequest(CID, JORDAN, PIECE).state).toBe('sent');
    expect(revisionWorkState(CID, JORDAN, PIECE)).toBe('revised');
    Grader.setLevel(CID, JORDAN, PIECE, LETTER, 3, 0);
    expect(getRevisionRequest(CID, JORDAN, PIECE).state).toBe('grading');
    expect(revisionWorkState(CID, JORDAN, PIECE)).toBe('grading');
    // Put back as it was, the grading has not started.
    Grader.setLevel(CID, JORDAN, PIECE, LETTER, 2, 1);
    expect(revisionWorkState(CID, JORDAN, PIECE)).toBe('revised');
    Grader.setLevel(CID, JORDAN, PIECE, LETTER, 3, 0);
    at('2026-11-10T16:00:00.000Z');
    Grader.returnGrades(CID, PIECE, [JORDAN]);
    const req = getRevisionRequest(CID, JORDAN, PIECE);
    expect(req.state).toBe('returned');
    expect(req.closed_at).toBe('2026-11-10T16:00:00.000Z');
    expect(revisionWorkState(CID, JORDAN, PIECE)).toBeNull();
    expect(revisionWorkState(CID, HANNAH, PIECE)).toBeNull();
  });

  it('one open request at a time; a new one once the last is returned', async () => {
    gradeFirstVersion();
    const first = await askForRevision();
    const again = await returnForRevision(CID, JORDAN, PIECE, ask(), key());
    expect(again).toEqual({ result: 'already_open', request: first.request });
    sendRevision();
    Grader.setLevel(CID, JORDAN, PIECE, LETTER, 3, 0);
    Grader.returnGrades(CID, PIECE, [JORDAN]);
    at('2026-11-11T18:00:00.000Z');
    const second = await returnForRevision(CID, JORDAN, PIECE, ask({ what_to_fix: 'One more source.' }), key());
    expect(second.result).toBe('made');
    expect(second.request.first_version).toBe(2);
    expect(second.request.first_grade.tags[LETTER].value).toBe(3);
    expect(getCourseFeedback(CID).revisions.map(r => r.state)).toEqual(['returned', 'open']);
  });

  it('list_course_feedback’s revisions are the teacher’s shape, in full', async () => {
    gradeFirstVersion();
    await askForRevision();
    const [r] = getCourseFeedback(CID).revisions;
    expect(Object.keys(r).sort()).toEqual(
      [
        'assessment_id',
        'closed_at',
        'created_at',
        'criterion_ids',
        'enrollment_id',
        'first_grade',
        'first_returned_at',
        'first_submission_id',
        'first_version',
        'grade_hidden',
        'id',
        'keep_grade',
        'revise_by',
        'revision_late',
        'revision_note',
        'revision_sent_at',
        'revision_sent_by',
        'revision_submission_id',
        'revision_version',
        'state',
        'updated_at',
        'what_to_fix',
      ].sort(),
    );
    expect(r).toMatchObject({
      assessment_id: PIECE,
      enrollment_id: JORDAN,
      what_to_fix: FIX,
      revise_by: '2026-11-10',
      keep_grade: true,
      grade_hidden: false,
      state: 'open',
      revision_version: null,
      closed_at: null,
    });
  });

  it('the work is returned first, as returnWork returns it', async () => {
    at('2026-11-01T18:00:00.000Z');
    Grader.setLevel(CID, JORDAN, PIECE, SUPPORT, 3, 0);
    Grader.setLevel(CID, JORDAN, PIECE, LETTER, 2, 1);
    expect(GradeState.stateOf(CID, JORDAN, PIECE)).toBe('draft');
    const made = await askForRevision();
    expect(made.returned).toMatchObject({ returned: 1, enrollment_ids: [JORDAN], marks_given: 0 });
    expect(GradeState.stateOf(CID, JORDAN, PIECE)).toBe('returned');
    expect(returnedOnly().piece).toBe('2.7 · 67%');
  });
});

describe('Hide: a hidden grade is a draft (Q5)', () => {
  it('never reaches the student or a family output until the new grade is returned', async () => {
    gradeFirstVersion();
    const made = await askForRevision({ keep_grade: false });
    expect(made.result).toBe('made');
    expect(made.hidden).toBe(true);
    expect(made.request.grade_hidden).toBe(true);
    // The teacher sees a draft; the student and every report, nothing.
    expect(GradeState.stateOf(CID, JORDAN, PIECE)).toBe('draft');
    expect(allWork().piece).toBe('2.7 · 67%');
    expect(returnedOnly()).toEqual({ piece: '—', overall: '—' });
    expect(getReturnedScores(CID)[JORDAN].filter(e => e.assessmentId === PIECE)).toEqual([]);
    const page = StudentView.reply(CID, JORDAN).assessments.find(a => a.id === PIECE);
    expect(page.grade).toBeNull();
    expect(page.previous).toBeNull();
    const mine = getStudentRevision(CID, JORDAN, PIECE);
    expect(mine.grade_hidden).toBe(true);
    expect(mine.first_grade).toBeNull();
    expect(getRevisionFirstCell(CID, JORDAN, PIECE, true)).toBeNull();
    expect(getStudentFeedback(CID, JORDAN).assessments.find(a => a.id === PIECE).revision.first_grade).toBeNull();
    // Still hidden while the revision is graded as a draft.
    sendRevision();
    Grader.setLevel(CID, JORDAN, PIECE, LETTER, 3, 0);
    expect(returnedOnly()).toEqual({ piece: '—', overall: '—' });
    expect(StudentView.reply(CID, JORDAN).assessments.find(a => a.id === PIECE).grade).toBeNull();
    // Returning the new version's grade ends the hide.
    Grader.returnGrades(CID, PIECE, [JORDAN]);
    expect(returnedOnly()).toEqual({ piece: '3.0 · 75%', overall: '3.0 · 75%' });
    expect(getRevisionRequest(CID, JORDAN, PIECE).grade_hidden).toBe(false);
    expect(getStudentRevision(CID, JORDAN, PIECE).first_grade.tags[LETTER].value).toBe(2);
    expect(formatLevel(CID, getRevisionFirstCell(CID, JORDAN, PIECE, true).value)).toBe('2.7 · 67%');
  });

  it('needs a class that holds grades; nothing changes when it does not', async () => {
    localStorage.clear();
    seed({ holds: false });
    gradeFirstVersion();
    const was = JSON.stringify(getGradeReturns(CID));
    expect(await askForRevision({ keep_grade: false })).toEqual({ result: 'hide_needs_holding' });
    expect(JSON.stringify(getGradeReturns(CID))).toBe(was);
    expect(getRevisionRequest(CID, JORDAN, PIECE)).toBeNull();
  });

  it('Take Back gives the grade back exactly as the student had it', async () => {
    gradeFirstVersion();
    const before = structuredClone(row());
    const made = await askForRevision({ keep_grade: false });
    const back = await cancelRevision(CID, made.request.id, key());
    expect(back.result).toBe('cancelled');
    expect(back.unhidden).toBe(true);
    expect(back.request.state).toBe('cancelled');
    expect(row()).toEqual(before);
    expect(returnedOnly().piece).toBe('2.7 · 67%');
    expect(getStudentRevision(CID, JORDAN, PIECE)).toBeNull();
    expect(revisionWorkState(CID, JORDAN, PIECE)).toBeNull();
    expect(await cancelRevision(CID, made.request.id, key())).toEqual({ result: 'not_open' });
  });

  it('Take Back after a change: the change waits as a draft on the grade given back', async () => {
    gradeFirstVersion();
    const made = await askForRevision({ keep_grade: false });
    Grader.setLevel(CID, JORDAN, PIECE, LETTER, 3, 0);
    await cancelRevision(CID, made.request.id, key());
    expect(GradeState.stateOf(CID, JORDAN, PIECE)).toBe('draft');
    expect(row().returned_copy.tags[LETTER]).toEqual({ value: 2, modifier: 1, comment: null });
    expect(returnedOnly().piece).toBe('2.7 · 67%');
    expect(allWork().piece).toBe('3.0 · 75%');
  });

  it('a class leaving When I Return Them returns a hidden grade, as any draft', async () => {
    gradeFirstVersion();
    await askForRevision({ keep_grade: false });
    setStudentPageSwitch(CID, true, 'on_save');
    expect(returnedOnly().piece).toBe('2.7 · 67%');
  });
});

describe('a draft regrade of a revision changes nothing a student sees', () => {
  it('the page, the feedback, the revision and every returned number are the same before and after', async () => {
    gradeFirstVersion();
    await askForRevision();
    sendRevision();
    const seen = () => ({
      page: StudentView.reply(CID, JORDAN),
      feedback: getStudentFeedback(CID, JORDAN),
      revision: getStudentRevision(CID, JORDAN, PIECE),
      first: getRevisionFirstCell(CID, JORDAN, PIECE, true),
      numbers: returnedOnly(),
    });
    const before = seen();
    Grader.setLevel(CID, JORDAN, PIECE, LETTER, 4, 0);
    Grader.setOverallComment(CID, JORDAN, PIECE, 'Now the letter has three reasons.');
    expect(getRevisionRequest(CID, JORDAN, PIECE).state).toBe('grading');
    expect(seen()).toEqual(before);
    expect(before.revision.state).toBe('sent');
  });
});

describe('Missing, Excused and Late', () => {
  it('Missing wins at once: no level counts in either set, and the student is given no first grade', async () => {
    gradeFirstVersion();
    await askForRevision();
    // A grade on the piece: set as Missing reaches a returned grade (the
    // grader refuses Missing on scored work, so the mark is put on directly).
    mark('NS');
    expect(allWork()).toEqual({ piece: 'M', overall: '—' });
    // A level leaves Missing work out; Jordan has no other work.
    expect(returnedOnly()).toEqual({ piece: 'M', overall: '—' });
    expect(getStudentRevision(CID, JORDAN, PIECE).first_grade).toBeNull();
    expect(getRevisionFirstCell(CID, JORDAN, PIECE)).toBeNull();
    expect(revisionWorkState(CID, JORDAN, PIECE)).toBeNull();
    // Taken off before any Return, the grade is back.
    mark(null);
    expect(returnedOnly().piece).toBe('2.7 · 67%');
    expect(revisionWorkState(CID, JORDAN, PIECE)).toBe('revising');
  });

  it('Excused leaves the work out of every number and hides the first grade', async () => {
    gradeFirstVersion();
    await askForRevision();
    sendRevision();
    mark('EXC');
    expect(returnedOnly()).toEqual({ piece: 'EXC', overall: '—' });
    expect(allWork()).toEqual({ piece: 'EXC', overall: '—' });
    expect(getStudentRevision(CID, JORDAN, PIECE).first_grade).toBeNull();
    expect(revisionWorkState(CID, JORDAN, PIECE)).toBeNull();
  });

  it('Late is a label: a revision after Revise By is late, and no number moves', async () => {
    gradeFirstVersion();
    await askForRevision();
    const before = { all: allWork(), returned: returnedOnly() };
    const sent = sendRevision('2026-11-12T19:00:00.000Z');
    expect(sent.late).toBe(true);
    expect(getRevisionRequest(CID, JORDAN, PIECE).revision_late).toBe(true);
    expect(getStudentRevision(CID, JORDAN, PIECE).revision_late).toBe(true);
    expect(getStudentSubmission(CID, JORDAN, PIECE).is_late).toBe(true);
    Grader.setStatus(CID, JORDAN, PIECE, 'LATE');
    expect({ all: allWork(), returned: returnedOnly() }).toEqual(before);
    // Revise By does not close it, and a late revision is graded as any.
    Grader.setLevel(CID, JORDAN, PIECE, LETTER, 3, 0);
    Grader.returnGrades(CID, PIECE, [JORDAN]);
    expect(returnedOnly().piece).toBe('3.0 · 75%');
  });
});

describe('the request’s words, and sending', () => {
  it('refuses a wrong request, a missing key, a student or piece not in the class', async () => {
    gradeFirstVersion();
    const bad = [
      null,
      ask({ what_to_fix: '' }),
      ask({ what_to_fix: '   ' }),
      ask({ what_to_fix: 'x'.repeat(2001) }),
      ask({ revise_by: 'Tue, Nov 10' }),
      ask({ revise_by: '2026-13-45' }),
      ask({ criterion_ids: 'all' }),
      ask({ criterion_ids: [LETTER] }), // a competency, not a rubric criterion
      ask({ keep_grade: 'yes' }),
      { what_to_fix: FIX },
    ];
    for (const b of bad)
      expect(await returnForRevision(CID, JORDAN, PIECE, b, key()), JSON.stringify(b)).toEqual({ result: 'invalid' });
    expect(await returnForRevision(CID, JORDAN, PIECE, ask())).toEqual({ result: 'invalid' });
    expect(await returnForRevision(CID, 'nobody', PIECE, ask(), key())).toEqual({ result: 'not_found' });
    expect(await returnForRevision(CID, JORDAN, 'nothing', ask(), key())).toEqual({ result: 'not_found' });
    expect(getRevisionRequest(CID, JORDAN, PIECE)).toBeNull();
    expect(
      (await returnForRevision(CID, JORDAN, PIECE, ask({ what_to_fix: 'x'.repeat(2000), revise_by: null }), key()))
        .result,
    ).toBe('made');
  });

  it('takes rubric criteria on rubric work', async () => {
    _cache.rubrics[CID] = [
      {
        id: 'rub',
        name: 'Letter',
        criteria: [{ id: 'c1', name: 'Letter to the Editor', tagIds: [LETTER], levels: {} }],
      },
    ];
    piece().rubricId = 'rub';
    gradeFirstVersion();
    const made = await askForRevision({ criterion_ids: ['c1', 'c1'] });
    expect(made.request.criterion_ids).toEqual(['c1']);
    expect((await returnForRevision(CID, HANNAH, PIECE, ask({ criterion_ids: ['c9'] }), key())).result).toBe('invalid');
  });

  it('a DIBELS benchmark is not returned for revision', async () => {
    piece().scoreMode = 'dibels';
    expect(await askForRevision()).toEqual({ result: 'not_for_dibels' });
  });

  it('the same key answers the same and makes nothing more', async () => {
    gradeFirstVersion();
    const k = key();
    const one = await returnForRevision(CID, JORDAN, PIECE, ask(), k);
    const two = await returnForRevision(CID, JORDAN, PIECE, ask(), k);
    expect(two).toEqual(one);
    expect(getCourseFeedback(CID).revisions).toHaveLength(1);
  });

  it('set_revision_request changes What to Fix, Revise By and criteria, only while open', async () => {
    gradeFirstVersion();
    const made = await askForRevision();
    const saved = await setRevisionRequest(CID, made.request.id, { revise_by: '2026-11-12' }, key());
    expect(saved.result).toBe('saved');
    expect(saved.request.revise_by).toBe('2026-11-12');
    expect(saved.request.what_to_fix).toBe(FIX);
    for (const bad of [{}, { keep_grade: false }, { what_to_fix: '' }, null]) {
      expect(await setRevisionRequest(CID, made.request.id, bad, key())).toEqual({ result: 'invalid' });
    }
    expect(await setRevisionRequest(CID, 'nope', { revise_by: null }, key())).toEqual({ result: 'not_found' });
    sendRevision();
    Grader.setLevel(CID, JORDAN, PIECE, LETTER, 3, 0);
    Grader.returnGrades(CID, PIECE, [JORDAN]);
    expect(await setRevisionRequest(CID, made.request.id, { revise_by: null }, key())).toEqual({ result: 'not_open' });
  });

  it('a student sends only their own revision, on an open request, and not once grading has started', async () => {
    gradeFirstVersion();
    expect(sendStudentRevision(CID, JORDAN, PIECE, PAGES, NOTE, JORDAN)).toEqual({ ok: false, error: 'no_revision' });
    await askForRevision();
    expect(sendStudentRevision(CID, JORDAN, PIECE, PAGES, NOTE, HANNAH)).toEqual({ ok: false, error: 'not_found' });
    expect(sendStudentRevision(CID, JORDAN, PIECE, [], NOTE, JORDAN)).toEqual({ ok: false, error: 'invalid' });
    expect(sendStudentRevision(CID, JORDAN, PIECE, [{ path: '../x.jpg', thumb_path: 'x.jpg' }], NOTE, JORDAN)).toEqual({
      ok: false,
      error: 'invalid',
    });
    expect(sendStudentRevision(CID, JORDAN, PIECE, PAGES, 'x'.repeat(1001), JORDAN)).toEqual({
      ok: false,
      error: 'invalid',
    });
    // Sent again before grading starts, it takes the place of the one in.
    const one = sendRevision();
    const two = sendStudentRevision(CID, JORDAN, PIECE, PAGES.concat(PAGES), null, JORDAN);
    expect(two.version).toBe(2);
    expect(getSubmissionVersions(CID, JORDAN, PIECE).map(s => s.id)).toEqual([FIRST_SUB, two.submission_id]);
    expect(two.submission_id).not.toBe(one.submission_id);
    Grader.setLevel(CID, JORDAN, PIECE, LETTER, 3, 0);
    expect(sendStudentRevision(CID, JORDAN, PIECE, PAGES, NOTE, JORDAN)).toEqual({
      ok: false,
      error: 'grading_started',
    });
    expect(unsendStudentRevision(CID, JORDAN, PIECE, JORDAN)).toEqual({ ok: false, error: 'grading_started' });
  });

  it('Unsend takes the revision back, pages and all, and the request is open again', async () => {
    gradeFirstVersion();
    await askForRevision();
    expect(unsendStudentRevision(CID, JORDAN, PIECE, JORDAN)).toEqual({
      ok: true,
      unsent: false,
      cancelled: false,
      pages: 0,
    });
    sendRevision();
    expect(unsendStudentRevision(CID, JORDAN, PIECE, JORDAN)).toEqual({
      ok: true,
      unsent: true,
      cancelled: false,
      pages: 1,
    });
    expect(getSubmissionVersions(CID, JORDAN, PIECE).map(s => s.version)).toEqual([1]);
    expect(revisionWorkState(CID, JORDAN, PIECE)).toBe('revising');
  });

  it('a piece that takes no work takes no revision', async () => {
    gradeFirstVersion();
    await askForRevision();
    saveDemoStudentWork(
      CID,
      Object.assign({}, getCourseSubmissions(CID), { assessments: [{ id: PIECE, students_send: 'nothing' }] }),
    );
    expect(sendRevision()).toEqual({ ok: false, error: 'not_taking_work' });
  });
});

describe('review fixes: a hidden grade is never lost', () => {
  const clear = () => Grader.clearScore(CID, getScores(CID), JORDAN, piece(), [SUPPORT, LETTER]);

  it('Hide, then Clear Score: the grade stays hidden, and Take Back gives the student exactly what they had', async () => {
    gradeFirstVersion();
    const before = structuredClone(row());
    const made = await askForRevision({ keep_grade: false });
    clear();
    // Clear takes the never-returned row away; the hide is not lost with it.
    expect(getRevisionRequest(CID, JORDAN, PIECE).grade_hidden).toBe(true);
    expect(getStudentRevision(CID, JORDAN, PIECE).grade_hidden).toBe(true);
    expect(returnedOnly()).toEqual({ piece: '—', overall: '—' });
    const back = await cancelRevision(CID, made.request.id, key());
    expect(back).toMatchObject({ result: 'cancelled', unhidden: true });
    // The student has their grade again; the Clear waits as a draft on it.
    expect(returnedOnly()).toEqual({ piece: '2.7 · 67%', overall: '2.7 · 67%' });
    expect(StudentView.reply(CID, JORDAN).assessments.find(a => a.id === PIECE).grade).not.toBeNull();
    expect(row()).toMatchObject({ is_draft: true, returned_at: before.returned_at });
    expect(row().returned_copy.tags[LETTER]).toEqual({ value: 2, modifier: 1, comment: null });
    expect(allWork().piece).toBe('—');
  });

  it('Hide, Clear, then a regrade: Take Back still gives back the first grade, the regrade a draft on it', async () => {
    gradeFirstVersion();
    const made = await askForRevision({ keep_grade: false });
    clear();
    Grader.setLevel(CID, JORDAN, PIECE, SUPPORT, 4, 0);
    Grader.setLevel(CID, JORDAN, PIECE, LETTER, 4, 0);
    expect(getRevisionRequest(CID, JORDAN, PIECE).grade_hidden).toBe(true);
    expect((await cancelRevision(CID, made.request.id, key())).unhidden).toBe(true);
    expect(returnedOnly().piece).toBe('2.7 · 67%');
    expect(allWork().piece).toBe('4.0 · 100%');
  });

  it('only a Return ends a hide, and once ended a Clear does not bring it back', async () => {
    gradeFirstVersion();
    await askForRevision({ keep_grade: false });
    sendRevision();
    at('2026-11-10T16:00:00.000Z');
    Grader.setLevel(CID, JORDAN, PIECE, LETTER, 3, 0);
    Grader.returnGrades(CID, PIECE, [JORDAN]);
    expect(getRevisionRequest(CID, JORDAN, PIECE).grade_hidden).toBe(false);
    clear();
    expect(getRevisionRequest(CID, JORDAN, PIECE).grade_hidden).toBe(false);
    expect(returnedOnly().piece).toBe('3.0 · 75%');
  });
});

describe('review fixes: a closed request stays closed', () => {
  it('Delete Work after the revision’s grade is returned does not open the request again', async () => {
    gradeFirstVersion();
    await askForRevision();
    sendRevision();
    at('2026-11-10T16:00:00.000Z');
    Grader.setLevel(CID, JORDAN, PIECE, LETTER, 3, 0);
    Grader.returnGrades(CID, PIECE, [JORDAN]);
    at('2026-11-11T16:00:00.000Z');
    expect((await deleteStudentWork(CID, JORDAN, PIECE)).result).toBe('deleted');
    const req = getRevisionRequest(CID, JORDAN, PIECE);
    expect(req.state).toBe('returned');
    expect(req.closed_at).toBe('2026-11-10T16:00:00.000Z');
    expect(revisionWorkState(CID, JORDAN, PIECE)).toBeNull();
    expect(getStudentRevision(CID, JORDAN, PIECE).state).toBe('returned');
    expect(sendRevision()).toEqual({ ok: false, error: 'no_revision' });
    expect(await cancelRevision(CID, req.id, key())).toEqual({ result: 'not_open' });
    expect(returnedOnly().piece).toBe('3.0 · 75%');
  });

  it('a request taken back stays taken back after Delete Work', async () => {
    gradeFirstVersion();
    const made = await askForRevision();
    sendRevision();
    await cancelRevision(CID, made.request.id, key());
    await deleteStudentWork(CID, JORDAN, PIECE);
    expect(getRevisionRequest(CID, JORDAN, PIECE).state).toBe('cancelled');
    expect(revisionWorkState(CID, JORDAN, PIECE)).toBeNull();
  });
});

describe('review fixes: the teacher’s marks count as grading started', () => {
  const marks = (n = 1) => ({
    v: 1,
    marks: Array.from({ length: n }, () => ({ type: 'note', x: 0.1, y: 0.1, text: 'good' })),
  });
  const pageOf = sid => getStudentSubmission(CID, sid, PIECE).files[0].id;

  it('marks on a revision’s page lock it: no Unsend, no sending again, and the marks stay', async () => {
    gradeFirstVersion();
    await askForRevision();
    sendRevision();
    expect((await saveMarkup(CID, pageOf(JORDAN), marks(), 0, key())).result).toBe('saved');
    expect(getRevisionRequest(CID, JORDAN, PIECE).state).toBe('grading');
    expect(revisionWorkState(CID, JORDAN, PIECE)).toBe('grading');
    // The student is never shown a draft: their shape still says sent.
    expect(getStudentRevision(CID, JORDAN, PIECE).state).toBe('sent');
    expect(unsendStudentRevision(CID, JORDAN, PIECE, JORDAN)).toEqual({ ok: false, error: 'grading_started' });
    expect(sendRevision()).toEqual({ ok: false, error: 'grading_started' });
    expect(getAssessmentMarkup(CID, PIECE).filter(r => r.enrollment_id === JORDAN)).toHaveLength(1);
    expect(getSubmissionVersions(CID, JORDAN, PIECE).map(s => s.version)).toEqual([1, 2]);
  });

  it('a page whose marks were all erased does not count', async () => {
    gradeFirstVersion();
    await askForRevision();
    sendRevision();
    const page = pageOf(JORDAN);
    await saveMarkup(CID, page, marks(), 0, key());
    await saveMarkup(CID, page, marks(0), 1, key());
    expect(getRevisionRequest(CID, JORDAN, PIECE).state).toBe('sent');
    expect(unsendStudentRevision(CID, JORDAN, PIECE, JORDAN).ok).toBe(true);
  });

  it('marks on the first version’s pages do not lock the revision', async () => {
    gradeFirstVersion();
    await saveMarkup(CID, 'f1', marks(), 0, key());
    await askForRevision();
    sendRevision();
    expect(getRevisionRequest(CID, JORDAN, PIECE).state).toBe('sent');
    expect(unsendStudentRevision(CID, JORDAN, PIECE, JORDAN).ok).toBe(true);
  });

  it('first version: marks on the student’s own page lock it; another student’s marked page does not', async () => {
    const work = getCourseSubmissions(CID);
    saveDemoStudentWork(
      CID,
      Object.assign({}, work, {
        submissions: work.submissions.concat({
          id: 'sub-hannah-v1',
          assessment_id: PIECE,
          enrollment_id: HANNAH,
          version: 1,
          state: 'sent',
          sent_by: 'student',
          on_paper: false,
          is_late: false,
          note: null,
          sent_at: '2026-10-31T04:00:00.000Z',
          created_at: '2026-10-31T04:00:00.000Z',
          files: [{ id: 'fh1', page: 1, path: 'letter-2.jpg', thumb_path: 'letter-2-thumb.jpg' }],
        }),
      }),
    );
    at('2026-10-31T12:00:00.000Z');
    const sentOf = sid => getStudentWork(CID, sid).assessments.find(a => a.id === PIECE).sent;
    expect(sentOf(JORDAN)).toMatchObject({ grading: false, can_change: true });
    await saveMarkup(CID, 'fh1', marks(), 0, key());
    expect(sentOf(HANNAH)).toMatchObject({ grading: true, can_change: false });
    expect(sentOf(JORDAN)).toMatchObject({ grading: false, can_change: true });
    await saveMarkup(CID, 'fh1', marks(0), 1, key());
    expect(sentOf(HANNAH)).toMatchObject({ grading: false, can_change: true });
  });
});

describe('the switches', () => {
  it('with the build switch or Send Work off, nothing shows and nothing can be made', async () => {
    for (const off of [{ sendWork: false }, { holds: true, sendWork: true, noPage: true }]) {
      localStorage.clear();
      seed(off);
      if (off.noPage) saveCourseConfig(CID, {});
      gradeFirstVersion();
      expect(revisionsOn(CID)).toBe(false);
      expect(await askForRevision()).toEqual({ result: 'revisions_off' });
      expect(getCourseFeedback(CID).revisions).toEqual([]);
      expect(getRevisionRequest(CID, JORDAN, PIECE)).toBeNull();
      expect(getStudentRevision(CID, JORDAN, PIECE)).toBeNull();
      expect(revisionWorkState(CID, JORDAN, PIECE)).toBeNull();
      expect(sendRevision()).toEqual({ ok: false, error: 'send_off' });
    }
  });
});

describe('signed in: nothing yet', () => {
  it('reads nothing, answers not_available, stores nothing and calls nothing', async () => {
    gradeFirstVersion();
    const made = await askForRevision();
    window.isDemoMode = () => false;
    const rpc = vi.fn();
    globalThis.getSupabase = rpc;
    const before = localStorage.getItem('gb-student-feedback-' + CID);
    const rows = JSON.stringify(getGradeReturns(CID));
    expect(revisionsOn(CID)).toBe(false);
    expect(getCourseFeedback(CID).revisions).toEqual([]);
    expect(getRevisionRequest(CID, JORDAN, PIECE)).toBeNull();
    expect(getStudentRevision(CID, JORDAN, PIECE)).toBeNull();
    expect(getRevisionFirstCell(CID, JORDAN, PIECE)).toBeNull();
    expect(revisionWorkState(CID, JORDAN, PIECE)).toBeNull();
    expect(getStudentFeedback(CID, JORDAN).assessments).toEqual([]);
    expect(await returnForRevision(CID, HANNAH, PIECE, ask(), key())).toEqual({ result: 'not_available' });
    expect(await setRevisionRequest(CID, made.request.id, { revise_by: null }, key())).toEqual({
      result: 'not_available',
    });
    expect(await cancelRevision(CID, made.request.id, key())).toEqual({ result: 'not_available' });
    expect(sendRevision()).toEqual({ ok: false, error: 'not_available' });
    expect(unsendStudentRevision(CID, JORDAN, PIECE, JORDAN)).toEqual({ ok: false, error: 'not_available' });
    expect(saveDemoRevisions(CID, [])).toBe(false);
    expect(localStorage.getItem('gb-student-feedback-' + CID)).toBe(before);
    expect(JSON.stringify(getGradeReturns(CID))).toBe(rows);
    expect(rpc).not.toHaveBeenCalled();
    delete globalThis.getSupabase;
  });

  it('data.js names the teacher’s revision functions at call sites the drift check can read, and none of the student’s (S7-W1)', () => {
    const src = readFileSync('shared/data.js', 'utf-8');
    expect(src.match(/_writeRpc\(\s*'return_for_revision'/g).length).toBe(1);
    expect(src.match(/_writeRpc\(\s*'set_revision_request'/g).length).toBe(1);
    expect(src.match(/_writeRpc\(\s*'cancel_revision'/g).length).toBe(1);
    // A student's own revision goes through the function's routes, not through this file.
    expect(src).not.toMatch(/['"`](revision_start|revision_finish|revision_unsend)['"`]/);
  });

  it('no family-facing file reads the teacher’s requests', () => {
    const family = [
      'teacher/report-blocks.js',
      'teacher/report-questionnaire.js',
      'teacher/page-reports.js',
      'teacher/myed-input.js',
      'shared/student-view.js',
    ];
    family.forEach(f => {
      let src = '';
      try {
        src = readFileSync(f, 'utf-8');
      } catch {
        return;
      }
      expect(src, f).not.toMatch(/\b(getRevisionRequest|getRevisionFirstCell\([^)]*\)\s*[;,)]|returnForRevision)\b/);
    });
  });
});

describe('Demo Mode’s sample', () => {
  const SCI = 'sci8';
  beforeAll(() => {
    runInThisContext(readFileSync('shared/seed-data.js', 'utf-8'), { filename: 'shared/seed-data.js' });
  });
  afterAll(() => {
    CURRICULUM_INDEX = null;
  });

  it('one open request on Jas’s Cell Microscope Lab, the grade kept, no grade changed, shown only with the switches on', () => {
    vi.useRealTimers();
    Object.keys(COURSES).forEach(cid => _clearCourseLocalState(cid));
    localStorage.clear();
    CURRICULUM_INDEX = newBankIndex(['SCI8']);
    seedIfNeeded();
    expect(getCourseFeedback(SCI).revisions).toEqual([]);
    const scores = JSON.stringify(getScores(SCI));
    const rows = JSON.stringify(getGradeReturns(SCI));
    saveCourseConfig(SCI, Object.assign({}, getCourseConfig(SCI) || {}, { student_page_enabled: true }));
    saveDemoStudentWork(SCI, Object.assign({}, getCourseSubmissions(SCI), { course: { send_work: true } }));
    const [r] = getCourseFeedback(SCI).revisions;
    expect(r).toMatchObject({
      assessment_id: 'sci8a1',
      enrollment_id: 'st7',
      state: 'open',
      keep_grade: true,
      grade_hidden: false,
      first_submission_id: 'demo-sub-st7-sci8a1',
    });
    expect(r.first_grade).not.toBeNull();
    expect(revisionWorkState(SCI, 'st7', 'sci8a1')).toBe('revising');
    // Revise By is ahead of today, as a real request would be: the sample is not overdue.
    expect(r.revise_by > courseToday(SCI)).toBe(true);
    expect(JSON.stringify(getScores(SCI))).toBe(scores);
    expect(JSON.stringify(getGradeReturns(SCI))).toBe(rows);
    // Seeded once.
    expect(seedDemoRevisions()).toBe(false);
  });
});
