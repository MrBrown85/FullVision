/**
 * What the Inbox keeps of its first model (teacher/dash-inbox-model.js): the
 * order a student's work is graded in, oldest send first, a pair by the
 * mate's send. And, on built classes (the busy day, taking work, "new"),
 * DashInboxQueue's stacks: the old model's cases that are still true of the
 * tile, moved here when the By Assessment view went (slice I5 of
 * docs/plans/inbox-redesign-plan.md).
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

  it('gives to grade in the order the work came in, oldest first', () => {
    sendWorkOn();
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

  it("has stacks whose to grade are GraderWork's, and add up to the class's", () => {
    sendWorkOn();
    const q = DashInboxQueue.build(CID, { seen: null });
    const c = GraderWork.workCounts(CID, LIGHT, ids());
    expect(q.stacks.find(s => s.aid === LAB)).toBeUndefined();
    expect(q.stacks.find(s => s.aid === LIGHT).tograde).toBe(c.tograde);
    expect(q.stacks.reduce((n, p) => n + p.tograde, 0)).toBe(GraderWork.classWorkCounts(CID, ids()).tograde);
  });

  it('has nothing with Send Work off, or with only the student page on', () => {
    expect(DashInboxQueue.build(CID).on).toBe(false);
    setStudentPageSwitch(CID, true, 'on_return');
    expect(DashInboxQueue.build(CID).on).toBe(false);
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

  it('draws a stack for every piece with work to grade: 38 pieces holding 680 pieces of work', () => {
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
    const q = DashInboxQueue.build(CID, { seen: null });
    expect(q.stacks).toHaveLength(38);
    expect(q.caughtUp).toBe(false);
    // The stacks are the newest work first.
    for (let i = 1; i < q.stacks.length; i++)
      expect(Date.parse(q.stacks[i - 1].at)).toBeGreaterThanOrEqual(Date.parse(q.stacks[i].at));
    // Together they are every piece's to grade: the top bar's number.
    const all = GraderWork.classWorkCounts(CID, IDS).tograde;
    expect(q.stacks.reduce((k, r) => k + r.tograde, 0)).toBe(all);
    expect(q.toGrade).toBe(all);
  });

  const isNew = seen => DashInboxQueue.build(CID, { seen }).stacks[0].isNew;

  it("puts a student's send after the kept time as new, the teacher's own work never", () => {
    const aid = AIDS[0];
    seed(
      [aid],
      [
        sub(1, aid, IDS[0], { sent_by: 'student', sent_at: '2026-11-10T10:00:00Z' }),
        sub(3, aid, IDS[2], { sent_by: 'teacher', sent_at: '2026-11-14T10:00:00Z' }),
      ],
    );
    expect(isNew('2026-11-09T00:00:00Z')).toBe(true);
    // The student's send is older than the kept time; the teacher's, newer, is not a send to see.
    expect(isNew('2026-11-11T00:00:00Z')).toBe(false);
    // Never looked: nothing is new, so a first visit has no wall of dots.
    expect(isNew(null)).toBe(false);
  });

  it('compares instants, whatever offset the kept time is written in', () => {
    const aid = AIDS[0];
    seed([aid], [sub(1, aid, IDS[0], { sent_by: 'student', sent_at: '2026-11-12T10:00:00Z' })]);
    // 10:00 UTC is 02:00 in Vancouver and 23:00 in Auckland.
    expect(isNew('2026-11-12T02:00:00-08:00')).toBe(false);
    expect(isNew('2026-11-12T01:59:59-08:00')).toBe(true);
    expect(isNew('2026-11-12T23:00:00+13:00')).toBe(false);
    expect(isNew('2026-11-12T22:59:59+13:00')).toBe(true);
    expect(isNew('2026-11-12T10:00:00.001Z')).toBe(false);
  });

  it('does not count a send already graded as new', () => {
    const aid = AIDS[0];
    seed([aid], [sub(1, aid, IDS[0], { sent_by: 'student', sent_at: '2026-11-12T10:00:00Z' })]);
    const seen = '2026-11-11T00:00:00Z';
    expect(isNew(seen)).toBe(true);
    Grader.setOverallComment(CID, IDS[0], aid, 'Seen.');
    expect(DashInboxQueue.build(CID, { seen }).stacks).toHaveLength(0);
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
    expect(DashInboxModel.gradeOrder(CID, aid)).toEqual([IDS[1], IDS[2], IDS[0]]);
    // The stack's top page is the newest send.
    expect(DashInboxQueue.build(CID, { seen: null }).stacks[0].top.sid).toBe(IDS[0]);
  });

  it('puts a send with no time at all after the timed ones, keeping the class order among them', () => {
    const aid = AIDS[0];
    seed(
      [aid],
      [
        sub(1, aid, IDS[0], { sent_by: 'student', sent_at: null, created_at: null }),
        sub(2, aid, IDS[1], { sent_by: 'student', sent_at: '2026-11-12T10:00:00Z' }),
        sub(3, aid, IDS[2], { sent_by: 'student', sent_at: undefined, created_at: '' }),
        sub(4, aid, IDS[3], { sent_by: 'student', sent_at: '2026-11-10T10:00:00Z' }),
        sub(5, aid, IDS[4], { sent_by: 'student', sent_at: 'not a time', created_at: undefined }),
      ],
    );
    const order = DashInboxModel.gradeOrder(CID, aid);
    expect(order).toEqual([IDS[3], IDS[1], IDS[0], IDS[2], IDS[4]]);
    // The same answer however often it is asked: the sort is consistent.
    expect(DashInboxModel.gradeOrder(CID, aid)).toEqual(order);
  });

  it('puts a send with no time at all after the timed ones, keeping the class order among them', () => {
    const aid = AIDS[0];
    seed(
      [aid],
      [
        sub(1, aid, IDS[0], { sent_by: 'student', sent_at: null, created_at: null }),
        sub(2, aid, IDS[1], { sent_by: 'student', sent_at: '2026-11-12T10:00:00Z' }),
        sub(3, aid, IDS[2], { sent_by: 'student', sent_at: undefined, created_at: '' }),
        sub(4, aid, IDS[3], { sent_by: 'student', sent_at: '2026-11-10T10:00:00Z' }),
        sub(5, aid, IDS[4], { sent_by: 'student', sent_at: 'not a time', created_at: undefined }),
      ],
    );
    const order = DashInboxModel.gradeOrder(CID, aid);
    expect(order).toEqual([IDS[3], IDS[1], IDS[0], IDS[2], IDS[4]]);
    // The same answer however often it is asked: the sort is consistent.
    expect(DashInboxModel.gradeOrder(CID, aid)).toEqual(order);
  });

  it('says Late for a piece with late work, and a paper hand-in is a stack top with no scan', () => {
    const aid = AIDS[0];
    seed(
      [aid],
      [
        sub(1, aid, IDS[0], { sent_by: 'student', is_late: true, sent_at: '2026-11-10T10:00:00Z' }),
        sub(2, aid, IDS[1], { sent_by: 'teacher', on_paper: true, files: [], sent_at: '2026-11-11T10:00:00Z' }),
      ],
    );
    const st = DashInboxQueue.build(CID, { seen: null }).stacks[0];
    expect(st.late).toBe(true);
    expect(st.tograde).toBe(2);
    expect(st.top).toMatchObject({ sid: IDS[1], paper: true });
  });

  it('lists a piece taking work with nothing in as still taking work, and is caught up', () => {
    seed([AIDS[0]], [], { [AIDS[0]]: { after_due: 'stop' } });
    // Due far off, so it is still open.
    const a = getAssessments(CID).find(x => x.id === AIDS[0]);
    a.dueDate = '2999-01-01';
    const q = DashInboxQueue.build(CID, { seen: null });
    expect(q.caughtUp).toBe(true);
    expect(q.stacks).toHaveLength(0);
    expect(q.taking).toHaveLength(1);
    expect(q.taking[0].aid).toBe(AIDS[0]);
  });

  it('is empty with Send Work off', () => {
    const aid = AIDS[0];
    seed([aid], [sub(1, aid, IDS[0])]);
    const work = getCourseSubmissions(CID);
    work.course.send_work = false;
    saveDemoStudentWork(CID, work);
    const q = DashInboxQueue.build(CID, { seen: null });
    expect(q.on).toBe(false);
    expect(q.stacks).toEqual([]);
  });
});
