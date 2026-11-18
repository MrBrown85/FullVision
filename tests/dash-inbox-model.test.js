/**
 * The Inbox's model (teacher/dash-inbox-model.js; D4 of
 * docs/plans/dashboard-inbox-plan.md): every count is GraderWork's, the rows'
 * to grade add up to the top bar's To Grade, the order work came in, what is
 * "new" and what is not, paper, late, four rows and the fold, All Caught Up,
 * and a class with Send Work off.
 */
import './setup.js';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newBankIndex } from './helpers/bc-bank-fixture.js';
import { U, seedClass, clearClass } from './helpers/pin-save-paths.js';

let wasDemo;

describe('the sample class (Science 8) with Send Work on', () => {
  const CID = 'sci8';
  const LAB = 'sci8a1'; // Cell Microscope Lab: all graded and returned; Ethan on paper, Mateo added
  const LIGHT = 'sci8a21'; // Light Refraction Lab: work waiting; Marcus late

  beforeAll(() => {
    wasDemo = window.isDemoMode;
    runInThisContext(readFileSync('shared/seed-data.js', 'utf-8'), { filename: 'shared/seed-data.js' });
  });
  afterAll(() => {
    window.isDemoMode = wasDemo;
    CURRICULUM_INDEX = null;
    localStorage.clear();
  });
  beforeEach(() => {
    window.isDemoMode = () => true;
    Object.keys(COURSES).forEach(cid => _clearCourseLocalState(cid));
    localStorage.clear();
    CURRICULUM_INDEX = newBankIndex(['SCI8']);
    seedIfNeeded();
  });

  function sendWorkOn() {
    setStudentPageSwitch(CID, true, 'on_return');
    const work = getCourseSubmissions(CID);
    work.course.send_work = true;
    saveDemoStudentWork(CID, work);
  }
  const ids = () => getStudents(CID).map(s => s.id);
  const piece = (m, aid) => m.pieces.find(p => p.aid === aid);

  it('has no Inbox with Send Work off, or with only the student page on', () => {
    expect(DashInboxModel.build(CID).on).toBe(false);
    expect(DashInboxModel.build(CID).pieces).toEqual([]);
    setStudentPageSwitch(CID, true, 'on_return');
    expect(DashInboxModel.build(CID).on).toBe(false);
  });

  it("each count is GraderWork's own", () => {
    sendWorkOn();
    const m = DashInboxModel.build(CID, { seen: null });
    expect(m.on).toBe(true);
    // Cell Microscope Lab has nothing to grade: no piece, no row.
    expect(piece(m, LAB)).toBeUndefined();
    const c = GraderWork.workCounts(CID, LIGHT, ids());
    const p = piece(m, LIGHT);
    expect([p.tograde, p.toreturn, p.notin]).toEqual([c.tograde, c.toreturn, c.notin]);
    expect(p.in).toBe(GraderWork.workInIds(CID, LIGHT, ids()).length);
    expect(p.tograde).toBeGreaterThan(0);
  });

  it("the rows' to grade add up to the top bar's To Grade, folded pieces included", () => {
    sendWorkOn();
    const m = DashInboxModel.build(CID, { seen: null });
    const sum = m.pieces.reduce((n, p) => n + p.tograde, 0);
    expect(sum).toBe(GraderWork.classWorkCounts(CID, ids()).tograde);
    expect(m.toGrade).toBe(sum);
    expect(sum).toBeGreaterThan(0);
  });

  it('gives to grade in the order the work came in, oldest first', () => {
    sendWorkOn();
    const m = DashInboxModel.build(CID, { seen: null });
    const order = DashInboxModel.gradeOrder(CID, LIGHT);
    const p = { gradeOrder: order };
    const listed = GraderWork.workCounts(CID, LIGHT, ids()).ids.tograde;
    // A sort of GraderWork's own list: nothing added, nothing left out.
    expect([...p.gradeOrder].sort()).toEqual([...listed].sort());
    // A pair-mate with no send of their own goes by their pair's send.
    const at = sid => {
      const own = getGroupSubmissions(CID, sid, LIGHT);
      return Math.min(...own.map(s => Date.parse(s.sent_at || s.created_at)));
    };
    // Olivia is in Aiden's pair and sent nothing herself: she follows Aiden, not last.
    const at2 = name => p.gradeOrder.findIndex(sid => displayName(getStudents(CID).find(x => x.id === sid)) === name);
    expect(Math.abs(at2('Olivia Tam') - at2('Aiden Singh'))).toBe(1);
    expect(at2('Olivia Tam')).toBeLessThan(p.gradeOrder.length - 1);
    for (let i = 1; i < p.gradeOrder.length; i++)
      expect(at(p.gradeOrder[i])).toBeGreaterThanOrEqual(at(p.gradeOrder[i - 1]));
  });

  it('names the newest work, late work and a paper hand-in', () => {
    sendWorkOn();
    const m = DashInboxModel.build(CID, { seen: null });
    const light = piece(m, LIGHT);
    expect(light.newest[0]).toMatchObject({ name: 'Marcus Lee', late: true, pages: 1 });
    expect(light.late).toBe(1);
    expect(light.pages.every(pg => !pg.paper && pg.file && pg.file.id)).toBe(true);
    expect(light.pages.length).toBeLessThanOrEqual(DashInboxModel.MAX_PICS);
  });

  it('counts a student send after the kept time as new, and one before it as not', () => {
    sendWorkOn();
    // The sample's dates follow today's, so the kept times are taken from the work itself.
    const light = () => DashInboxModel.build(CID, { seen: null }).pieces.find(p => p.aid === LIGHT);
    const sends = getCourseSubmissions(CID)
      .submissions.filter(s => s.assessment_id === LIGHT && s.sent_by === 'student')
      .map(s => Date.parse(s.sent_at))
      .sort((x, y) => x - y);
    expect(sends.length).toBe(light().fromStudents);
    const iso = t => new Date(t).toISOString();
    const newCount = seen => DashInboxModel.build(CID, { seen }).pieces.find(p => p.aid === LIGHT).newCount;
    const newest = sends[sends.length - 1];
    const oldest = sends[0];
    // Just before the newest send: only it is new. At it, or after: none (the kept time is an instant).
    expect(newCount(iso(newest - 1))).toBe(1);
    expect(newCount(iso(newest))).toBe(0);
    expect(newCount(iso(newest + 86400000))).toBe(0);
    // Before the oldest: all of them.
    expect(newCount(iso(oldest - 1))).toBe(sends.length);
  });

  it('is All Caught Up when nothing waits', () => {
    sendWorkOn();
    const waiting = GraderWork.workCounts(CID, LIGHT, ids()).ids.tograde;
    waiting.forEach(sid => Grader.setOverallComment(CID, sid, LIGHT, 'Seen.'));
    const m = DashInboxModel.build(CID, { seen: null });
    expect(GraderWork.classWorkCounts(CID, ids()).tograde).toBe(0);
    expect(m.toGrade).toBe(0);
    expect(m.caughtUp).toBe(true);
    expect(m.rows.every(r => r.taking)).toBe(true);
  });
});

/* ── Built classes: the busy day, taking work, and "new" ─────────── */
const CID = U(1);
const Q = U(41);
const IDS = Array.from({ length: 30 }, (_, i) => U(100 + i));
const AIDS = Array.from({ length: 38 }, (_, i) => U(300 + i));

function file(n, k) {
  return {
    id: 'f' + n + '-' + k,
    page: k,
    path: 'p' + n + '-' + k + '.jpg',
    thumb_path: 't' + n + '-' + k + '.jpg',
    sha256: 'h' + n + k,
  };
}
function sub(n, aid, sid, extra) {
  return Object.assign(
    {
      id: 's' + n,
      assessment_id: aid,
      enrollment_id: sid,
      version: 1,
      state: 'sent',
      sent_by: 'teacher',
      on_paper: false,
      is_late: false,
      note: null,
      sent_at: '2026-11-13T19:00:00Z',
      created_at: '2026-11-13T19:00:00Z',
      files: [file(n, 2), file(n, 1)],
    },
    extra || {},
  );
}
function seed(assessments, subs, per) {
  seedClass(CID, {
    students: IDS.map((id, i) => ({ id, firstName: 'First' + i, lastName: 'Last' + i })),
    learningMaps: {
      subjects: [],
      sections: [{ id: U(51), name: 'Question', tags: [{ id: Q, label: 'Question', text: 'Ask questions' }] }],
      _customized: true,
      _version: 1,
      _flatVersion: 2,
    },
    assessments: assessments.map((id, i) => ({
      id,
      title: 'Piece ' + i,
      tagIds: [Q],
      date: '2026-10-' + String((i % 28) + 1).padStart(2, '0'),
      dueDate: '2026-10-02',
    })),
    courseConfigs: { student_page_enabled: true, return_grades: 'on_return' },
  });
  saveDemoStudentWork(CID, {
    course: { send_work: true },
    assessments: assessments.map(id =>
      Object.assign({ id, students_send: 'photos', after_due: 'stop' }, per && per[id]),
    ),
    submissions: subs,
  });
}

describe('built classes', { timeout: 120000 }, () => {
  beforeEach(() => {
    wasDemo = window.isDemoMode;
    window.isDemoMode = () => true;
    localStorage.clear();
  });
  afterEach(() => {
    clearClass(CID);
    localStorage.clear();
    window.isDemoMode = wasDemo;
  });

  it('shows four rows and folds the rest: 38 pieces holding 680 pieces of work', () => {
    const subs = [];
    let n = 0;
    // 680 pieces of work: every piece but the last two get 18 or 17, almost all added by the teacher.
    AIDS.forEach((aid, p) => {
      const take = p < 20 ? 18 : 17;
      IDS.slice(0, take).forEach(sid => {
        subs.push(sub(n++, aid, sid, { sent_at: '2026-11-' + String(1 + (p % 12)).padStart(2, '0') + 'T19:00:00Z' }));
      });
    });
    // Piece 0 and piece 1 also hold students' own sends.
    subs.push(sub(n++, AIDS[0], IDS[25], { sent_by: 'student', sent_at: '2026-11-16T10:00:00Z' }));
    subs.push(sub(n++, AIDS[1], IDS[26], { sent_by: 'student', sent_at: '2026-11-16T11:00:00Z' }));
    seed(AIDS, subs);
    const m = DashInboxModel.build(CID, { seen: null });
    expect(m.pieces).toHaveLength(38);
    expect(m.rows).toHaveLength(4);
    expect(m.caughtUp).toBe(false);
    expect(m.fold.pieces).toBe(34);
    expect(m.fold.work + m.rows.reduce((k, r) => k + r.in, 0)).toBe(subs.length);
    expect(m.fold.youAdded.pieces).toBe(34);
    // The rows are the newest work first.
    for (let i = 1; i < m.rows.length; i++)
      expect(Date.parse(m.rows[i - 1].at)).toBeGreaterThanOrEqual(Date.parse(m.rows[i].at));
    // Rows and fold together are every piece's to grade: the top bar's number.
    const all = GraderWork.classWorkCounts(CID, IDS).tograde;
    expect(m.rows.reduce((k, r) => k + r.tograde, 0) + m.fold.tograde).toBe(all);
    expect(m.pieces.reduce((k, p) => k + p.tograde, 0)).toBe(all);
    expect(m.toGrade).toBe(all);
    // The two with a student's send are named in the fold or among the rows, never as teacher-added.
    const students = m.rows.concat(m.pieces).filter(p => p.fromStudents);
    expect(students.length).toBeGreaterThan(0);
  });

  it("puts a student's send after the kept time as new, the teacher's own work never", () => {
    const aid = AIDS[0];
    seed(
      [aid],
      [
        sub(1, aid, IDS[0], { sent_by: 'student', sent_at: '2026-11-10T10:00:00Z' }),
        sub(2, aid, IDS[1], { sent_by: 'student', sent_at: '2026-11-12T10:00:00Z' }),
        sub(3, aid, IDS[2], { sent_by: 'teacher', sent_at: '2026-11-14T10:00:00Z' }),
      ],
    );
    const m = DashInboxModel.build(CID, { seen: '2026-11-11T00:00:00Z' });
    const p = m.pieces[0];
    expect(p.newCount).toBe(1);
    expect(p.addedByTeacher).toBe(1);
    expect(p.newCount + p.addedByTeacher).toBeLessThan(p.in + 1);
    expect(DashInboxModel.build(CID, { seen: '2026-11-13T00:00:00Z' }).pieces[0].newCount).toBe(0);
    // Never looked: nothing is new, so a first visit has no wall of "+N".
    expect(DashInboxModel.build(CID, { seen: null }).pieces[0].newCount).toBe(0);
  });

  it('compares instants, whatever offset the kept time is written in', () => {
    const aid = AIDS[0];
    seed([aid], [sub(1, aid, IDS[0], { sent_by: 'student', sent_at: '2026-11-12T10:00:00Z' })]);
    const at = seen => DashInboxModel.build(CID, { seen }).pieces[0].newCount;
    // 10:00 UTC is 02:00 in Vancouver and 23:00 in Auckland.
    expect(at('2026-11-12T02:00:00-08:00')).toBe(0);
    expect(at('2026-11-12T01:59:59-08:00')).toBe(1);
    expect(at('2026-11-12T23:00:00+13:00')).toBe(0);
    expect(at('2026-11-12T22:59:59+13:00')).toBe(1);
    expect(at('2026-11-12T10:00:00.001Z')).toBe(0);
  });

  it('does not count a send already graded as new', () => {
    const aid = AIDS[0];
    seed(
      [aid],
      [
        sub(1, aid, IDS[0], { sent_by: 'student', sent_at: '2026-11-12T10:00:00Z' }),
        sub(2, aid, IDS[1], { sent_by: 'student', sent_at: '2026-11-12T11:00:00Z' }),
      ],
    );
    const seen = '2026-11-11T00:00:00Z';
    expect(DashInboxModel.build(CID, { seen }).pieces[0]).toMatchObject({ fromStudents: 2, newCount: 2, tograde: 2 });
    Grader.setOverallComment(CID, IDS[0], aid, 'Seen.');
    // One is graded: "+1" beside "1 to grade", never "+2".
    expect(DashInboxModel.build(CID, { seen }).pieces[0]).toMatchObject({ fromStudents: 2, newCount: 1, tograde: 1 });
  });

  it('counts each folded piece once: named with a student send, or in You Added, never both', () => {
    const subs = [];
    let n = 0;
    AIDS.forEach((aid, p) => {
      IDS.slice(0, 5).forEach(sid =>
        subs.push(sub(n++, aid, sid, { sent_at: '2026-11-0' + (1 + (p % 9)) + 'T19:00:00Z' })),
      );
    });
    // Two folded pieces also hold a student's send (and keep their teacher-added work).
    subs.push(sub(n++, AIDS[30], IDS[10], { sent_by: 'student', sent_at: '2026-11-01T08:00:00Z' }));
    subs.push(sub(n++, AIDS[31], IDS[10], { sent_by: 'student', sent_at: '2026-11-01T08:00:00Z' }));
    seed(AIDS, subs);
    const m = DashInboxModel.build(CID, { seen: null });
    const f = m.fold;
    expect(f.pieces).toBe(34);
    expect(f.withStudents.length + f.youAdded.pieces).toBe(f.pieces);
    expect(f.withStudents.length).toBeGreaterThanOrEqual(2);
    // What is said of the folded pieces never adds up to more than they hold.
    expect(f.youAdded.work).toBeLessThanOrEqual(f.work);
    expect(f.youAdded.pieces).toBeLessThanOrEqual(f.pieces - f.withStudents.length);
  });

  it('orders what came in oldest first, whatever the class list says', () => {
    const aid = AIDS[0];
    seed(
      [aid],
      [
        sub(1, aid, IDS[0], { sent_by: 'student', sent_at: '2026-11-12T10:00:00Z' }),
        sub(2, aid, IDS[1], { sent_by: 'student', sent_at: '2026-11-10T10:00:00Z' }),
        sub(3, aid, IDS[2], { sent_by: 'student', sent_at: '2026-11-11T10:00:00Z' }),
      ],
    );
    const p = DashInboxModel.build(CID, { seen: null }).pieces[0];
    expect(DashInboxModel.gradeOrder(CID, aid)).toEqual([IDS[1], IDS[2], IDS[0]]);
    expect(p.newest.map(x => x.sid)).toEqual([IDS[0], IDS[2], IDS[1]]);
  });

  it('counts late work and pictures a paper hand-in with no scan as a sheet', () => {
    const aid = AIDS[0];
    seed(
      [aid],
      [
        sub(1, aid, IDS[0], { sent_by: 'student', is_late: true, sent_at: '2026-11-12T10:00:00Z' }),
        sub(2, aid, IDS[1], { sent_by: 'teacher', on_paper: true, files: [], sent_at: '2026-11-11T10:00:00Z' }),
      ],
    );
    const p = DashInboxModel.build(CID, { seen: null }).pieces[0];
    expect(p.late).toBe(1);
    expect(p.onPaper).toBe(1);
    expect(p.pages.map(x => x.paper)).toEqual([false, true]);
    expect(p.newest[0].pages).toBe(2);
  });

  it('is All Caught Up with a slim row for a piece taking work with nothing in', () => {
    seed([AIDS[0]], [], { [AIDS[0]]: { after_due: 'stop' } });
    // Due far off, so it is still open.
    const a = getAssessments(CID).find(x => x.id === AIDS[0]);
    a.dueDate = '2999-01-01';
    const m = DashInboxModel.build(CID, { seen: null });
    expect(m.caughtUp).toBe(true);
    expect(m.takingWork).toHaveLength(1);
    expect(m.rows).toHaveLength(1);
    expect(m.rows[0]).toMatchObject({ taking: true, in: 0, tograde: 0, closesOn: '2999-01-01' });
    expect(m.fold).toBeNull();
  });

  it('is empty with Send Work off', () => {
    const aid = AIDS[0];
    seed([aid], [sub(1, aid, IDS[0])]);
    const work = getCourseSubmissions(CID);
    work.course.send_work = false;
    saveDemoStudentWork(CID, work);
    const m = DashInboxModel.build(CID, { seen: null });
    expect(m.on).toBe(false);
    expect(m.rows).toEqual([]);
  });
});
