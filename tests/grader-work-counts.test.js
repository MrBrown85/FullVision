/**
 * The To Grade, To Return, Returned and Not In counts come from one place
 * (shared/grader.js, GraderWork.workCounts and classWorkCounts; S6-F3), and
 * the grader dialog's Show bar says the same numbers.
 *
 * The plan's test (docs/plans/student-page-build-plan.md, S6, "Done
 * when"): the artboard's worked example, a class of 28 on one piece with
 * 7 to grade, 3 to return, 14 returned and 4 not in, reads 6, 3, 15, 4
 * after one more is graded and returned. A pair or group counts once in
 * To Grade. With the build switch or Send Work off, or on a piece that
 * takes no work, there is no To Grade and no Not In.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { U, seedClass, clearClass, openGrader, closePages } from './helpers/pin-save-paths.js';

const CID = U(1);
const PIECE = U(31); // 2.6 The Conscription Crisis: Students Send Photos
const PAPER = U(32); // takes no work
const TALK = U(33); // group work, Students Send Photos
const Q = U(41);
const IDS = Array.from({ length: 28 }, (_, i) => U(100 + i));
const SENT_UNGRADED = IDS.slice(0, 7);
const SENT_DRAFT = IDS.slice(7, 10);
const SENT_RETURNED = IDS.slice(10, 24);
const NOTHING = IDS.slice(24);
let wasDemo;

function page(n, hash) {
  return { id: 'f' + n, page: 1, path: 'lab-p1.jpg', thumb_path: 'lab-p1-t.jpg', sha256: hash || 'h' + n };
}
function sub(sid, aid, n, extra) {
  return Object.assign(
    {
      id: 'w' + sid.slice(-4) + aid.slice(-2),
      assessment_id: aid,
      enrollment_id: sid,
      version: 1,
      state: 'sent',
      sent_by: 'student',
      on_paper: false,
      is_late: false,
      note: null,
      sent_at: '2026-10-30T20:41:00Z',
      created_at: '2026-10-30T20:41:00Z',
      files: [page(n)],
    },
    extra || {},
  );
}

function seed({ sendWork = true, studentPage = true } = {}) {
  seedClass(CID, {
    students: IDS.map((id, i) => ({
      id,
      firstName: 'S' + String(i).padStart(2, '0'),
      lastName: 'L' + String(i).padStart(2, '0'),
    })),
    learningMaps: {
      subjects: [],
      sections: [{ id: U(51), name: 'Question', tags: [{ id: Q, label: 'Question', text: 'Ask questions' }] }],
      _customized: true,
      _version: 1,
      _flatVersion: 2,
    },
    assessments: [
      { id: PIECE, title: '2.6 The Conscription Crisis', tagIds: [Q], date: '2026-10-20', dueDate: '2026-10-30' },
      { id: PAPER, title: 'Quiz', tagIds: [Q], date: '2026-10-21' },
      {
        id: TALK,
        title: 'Group Talk',
        tagIds: [Q],
        date: '2026-10-22',
        collaboration: 'group',
        groups: [IDS.slice(0, 3)],
      },
    ],
    courseConfigs: studentPage ? { student_page_enabled: true, return_grades: 'on_return' } : {},
  });
  const submissions = []
    .concat(SENT_UNGRADED, SENT_DRAFT, SENT_RETURNED)
    .map((sid, i) => sub(sid, PIECE, i))
    .concat(IDS.slice(0, 4).map((sid, i) => sub(sid, TALK, 100 + i)));
  saveDemoStudentWork(CID, {
    course: { send_work: sendWork },
    assessments: [
      { id: PIECE, students_send: 'photos' },
      { id: TALK, students_send: 'photos' },
    ],
    submissions,
  });
  SENT_DRAFT.concat(SENT_RETURNED).forEach(sid => Grader.setLevel(CID, sid, PIECE, Q, 3, 0));
  Grader.returnGrades(CID, PIECE, SENT_RETURNED);
}

const four = c => [c.tograde, c.toreturn, c.returned, c.notin];

beforeEach(() => {
  wasDemo = window.isDemoMode;
  window.isDemoMode = () => true;
  localStorage.clear();
});
afterEach(() => {
  closePages();
  clearClass(CID);
  localStorage.clear();
  window.isDemoMode = wasDemo;
});

describe('GraderWork.workCounts: the artboard’s worked example', () => {
  it('7 to grade, 3 to return, 14 returned, 4 not in, of 28', () => {
    seed();
    const c = GraderWork.workCounts(CID, PIECE);
    expect(four(c)).toEqual([7, 3, 14, 4]);
    expect(c.all).toBe(28);
    expect(c.ids.tograde).toEqual(SENT_UNGRADED);
    expect(c.ids.notin).toEqual(NOTHING);
  });

  it('6, 3, 15, 4 after one more is graded and returned', () => {
    seed();
    const sid = SENT_UNGRADED[0];
    Grader.setLevel(CID, sid, PIECE, Q, 2, 0);
    // Graded, waiting to return: it moves from To Grade to To Return.
    expect(four(GraderWork.workCounts(CID, PIECE))).toEqual([6, 4, 14, 4]);
    Grader.returnGrades(CID, PIECE, [sid]);
    expect(four(GraderWork.workCounts(CID, PIECE))).toEqual([6, 3, 15, 4]);
  });

  it('an Overall Comment starts the grading; a Late mark does not', () => {
    seed();
    Grader.setStatus(CID, SENT_UNGRADED[0], PIECE, 'LATE');
    expect(GraderWork.workStateOf(CID, PIECE, SENT_UNGRADED[0])).toBe('tograde');
    Grader.setOverallComment(CID, SENT_UNGRADED[1], PIECE, 'Good start.');
    expect(GraderWork.workStateOf(CID, PIECE, SENT_UNGRADED[1])).not.toBe('tograde');
    expect(GraderWork.workCounts(CID, PIECE).tograde).toBe(6);
  });

  it('an Excused student with nothing in is not Not In; a Missing one is', () => {
    seed();
    Grader.setStatus(CID, NOTHING[0], PIECE, 'EXC');
    Grader.setStatus(CID, NOTHING[1], PIECE, 'NS');
    const c = GraderWork.workCounts(CID, PIECE);
    expect(c.notin).toBe(3);
    expect(c.ids.notin).not.toContain(NOTHING[0]);
    expect(c.ids.notin).toContain(NOTHING[1]);
  });

  it('counts only the students it is given, in their order', () => {
    seed();
    const some = [NOTHING[0], SENT_UNGRADED[1], SENT_DRAFT[0]];
    const c = GraderWork.workCounts(CID, PIECE, some);
    expect(four(c)).toEqual([1, 1, 0, 1]);
    expect(c.all).toBe(3);
  });
});

describe('a pair or group counts once in To Grade', () => {
  it('three members of one group to grade count 1; a student in no group counts 1', () => {
    seed();
    const c = GraderWork.workCounts(CID, TALK);
    // IDS 0-2 are one group, IDS 3 sent alone: two pieces of work to grade.
    expect(c.tograde).toBe(2);
    expect(c.ids.tograde).toEqual(IDS.slice(0, 4));
    // Every other student owes it.
    expect(c.notin).toBe(24);
  });

  it('a member graded separately counts on their own', () => {
    seed();
    Grader.gradeSeparately(CID, TALK, IDS[2]);
    expect(GraderWork.workCounts(CID, TALK).tograde).toBe(3);
  });
});

describe('classWorkCounts: the class’s totals, for the gradebook and the dashboard', () => {
  it('adds every piece’s counts and names the pieces with any', () => {
    seed();
    const c = GraderWork.classWorkCounts(CID);
    expect(c.tograde).toBe(7 + 2);
    expect(c.toreturn).toBe(3);
    expect(c.pieces.map(p => p.aid)).toEqual([PIECE, TALK]);
    const per = GraderWork.workCounts(CID, PIECE);
    expect(c.pieces[0]).toEqual({ aid: PIECE, tograde: per.tograde, toreturn: per.toreturn, notin: per.notin });
  });
});

describe('no work, no To Grade and no Not In', () => {
  it('a piece that takes no work', () => {
    seed();
    expect(
      GraderWork.workOn(
        CID,
        getAssessments(CID).find(a => a.id === PAPER),
      ),
    ).toBe(false);
    const c = GraderWork.workCounts(CID, PAPER);
    expect([c.tograde, c.notin]).toEqual([0, 0]);
  });

  it('Send Work off', () => {
    seed({ sendWork: false });
    const c = GraderWork.workCounts(CID, PIECE);
    expect(four(c)).toEqual([0, 3, 14, 0]);
    expect(GraderWork.classWorkCounts(CID).tograde).toBe(0);
  });

  it('the build switch off', () => {
    seed({ studentPage: false });
    const c = GraderWork.workCounts(CID, PIECE);
    expect([c.tograde, c.notin]).toEqual([0, 0]);
  });
});

describe('Same photo as: an exact match only', () => {
  it('names the other students whose work holds the same page, byte for byte', () => {
    seed();
    const work = getCourseSubmissions(CID);
    work.submissions.find(s => s.enrollment_id === IDS[5] && s.assessment_id === PIECE).files[0].sha256 = 'h1';
    saveDemoStudentWork(CID, work);
    expect(GraderWork.samePhotoAs(CID, PIECE, IDS[1])).toEqual([IDS[5]]);
    expect(GraderWork.samePhotoAs(CID, PIECE, IDS[5])).toEqual([IDS[1]]);
    expect(GraderWork.samePhotoAs(CID, PIECE, IDS[2])).toEqual([]);
    expect(GraderWork.samePhotoAs(CID, PIECE, NOTHING[0])).toEqual([]);
  });
});

describe('the grader dialog says the same numbers', () => {
  const showBar = overlay =>
    Object.fromEntries(
      Array.from(overlay.querySelectorAll('.grader-show [data-show]')).map(b => [
        b.dataset.show,
        parseInt(b.querySelector('.grader-show-n').textContent, 10),
      ]),
    );

  it('To Grade 7, To Return 3, Returned 14, Not In 4, All 28', () => {
    const overlay = openGrader(seed, CID, PIECE, IDS[0]);
    const c = GraderWork.workCounts(CID, PIECE);
    expect(showBar(overlay)).toEqual({ tograde: 7, toreturn: 3, returned: 14, notin: 4, all: 28 });
    expect(showBar(overlay)).toEqual({
      tograde: c.tograde,
      toreturn: c.toreturn,
      returned: c.returned,
      notin: c.notin,
      all: c.all,
    });
    const labels = Array.from(overlay.querySelectorAll('.grader-show [data-show]')).map(b =>
      b.textContent.replace(/\s+/g, ' ').trim(),
    );
    expect(labels).toEqual(['To Grade 7', 'To Return 3', 'Returned 14', 'Not In 4', 'All 28']);
  });

  it('a piece that takes no work keeps the bar it had', () => {
    const overlay = openGrader(seed, CID, PAPER, IDS[0]);
    expect(Array.from(overlay.querySelectorAll('.grader-show [data-show]')).map(b => b.dataset.show)).toEqual([
      'toreturn',
      'returned',
      'all',
    ]);
  });

  it('Not In steps through the students with nothing in', () => {
    const overlay = openGrader(seed, CID, PIECE, IDS[0]);
    overlay.querySelector('.grader-show [data-show="notin"]').click();
    expect(overlay.querySelector('.grader-student').textContent).toBe('S24 L24');
    overlay.querySelector('[data-grader="next"]').click();
    expect(overlay.querySelector('.grader-student').textContent).toBe('S25 L25');
    overlay.querySelector('.grader-show [data-show="tograde"]').click();
    expect(overlay.querySelector('.grader-student').textContent).toBe('S00 L00');
  });
});
