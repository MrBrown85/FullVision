/**
 * The redrawn Inbox's queue (teacher/dash-inbox-queue.js; slice I1 of
 * docs/plans/inbox-redesign-plan.md). The sample class (Science 8) with the
 * student page and Send Work on: Light Refraction Lab has work waiting (four
 * to grade, one late, Aiden and Olivia a pair) and two grades to return.
 * Every count is GraderWork's.
 */
import './setup.js';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newBankIndex } from './helpers/bc-bank-fixture.js';

const CID = 'sci8';
const LIGHT = 'sci8a21';
let wasDemo;

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
  setStudentPageSwitch(CID, true, 'on_return');
  const work = getCourseSubmissions(CID);
  work.course.send_work = true;
  saveDemoStudentWork(CID, work);
  // Maya's and Liv's work on Light Refraction Lab, graded and held to return.
  seedDemoDrafts();
});

const ids = () => getStudents(CID).map(s => s.id);

// Three more pieces with work to grade: 11 sent, 3 sent, 1 sent late.
function moreWork() {
  const work = getCourseSubmissions(CID);
  const lab = getAssessments(CID).find(a => a.id === LIGHT);
  const roster = ids();
  const more = [
    ['xa1', '5.5 Turning Point', 11, false, 21],
    ['xa2', '2.2 Causes', 3, false, 22],
    ['xa3', '3.6 Treaty', 1, true, 23],
  ];
  saveAssessments(CID, getAssessments(CID).concat(more.map(([id, title]) => Object.assign({}, lab, { id, title }))));
  const own = work.submissions.find(s => s.assessment_id === LIGHT);
  more.forEach(([aid, , n, late, day]) => {
    work.assessments.push({ id: aid, students_send: 'photos', after_due: 'keep', accept_until: null });
    roster.slice(5, 5 + n).forEach((sid, i) => {
      work.submissions.push(
        Object.assign({}, own, {
          id: 'x-' + aid + '-' + i,
          assessment_id: aid,
          enrollment_id: sid,
          is_late: late,
          sent_by: 'student',
          // After the sample class's own work, whatever day the test runs: a later day newer, students in order.
          sent_at: new Date(Date.now() + Number(day) * 3600000 + i * 60000).toISOString(),
        }),
      );
    });
  });
  saveDemoStudentWork(CID, work);
}

describe('DashInboxQueue.build', () => {
  it("counts as GraderWork does: the stacks' to grade add up to the class's", () => {
    moreWork();
    const q = DashInboxQueue.build(CID, {});
    const cc = GraderWork.classWorkCounts(CID, ids());
    expect(q.on).toBe(true);
    expect(q.toGrade).toBe(cc.tograde);
    expect(q.stacks.reduce((n, s) => n + s.tograde, 0)).toBe(cc.tograde);
    q.stacks.forEach(s => {
      const c = GraderWork.workCounts(CID, s.aid, ids());
      expect(s.tograde, s.aid).toBe(c.tograde);
      expect(s.notin, s.aid).toBe(c.notin);
    });
    expect(q.caughtUp).toBe(false);
  });

  it("uses the draw's one count of the class when it is given", () => {
    let asked = 0;
    const q = DashInboxQueue.build(CID, {
      classCounts: (cid, studentIds) => (asked++, GraderWork.classWorkCounts(cid, studentIds)),
    });
    expect(asked).toBe(1);
    expect(q.toGrade).toBe(GraderWork.classWorkCounts(CID, ids()).tograde);
  });

  it('puts the stack with the newest work first, and says Late for the piece with late work', () => {
    moreWork();
    const q = DashInboxQueue.build(CID, {});
    expect(q.stacks.map(s => s.aid)).toEqual(['xa3', 'xa2', 'xa1', LIGHT]);
    expect(q.stacks.map(s => s.late)).toEqual([true, false, false, true]);
    expect(q.stacks[3].title).toBe('Light Refraction Lab');
    expect(q.stacks[3].top.name).toBe('Marcus Lee');
    expect(q.stacks[3].top.file.thumb_path).toBeTruthy();
  });

  it('counts a pair or group once', () => {
    const light = DashInboxQueue.build(CID, {}).stacks.find(s => s.aid === LIGHT);
    const c = GraderWork.workCounts(CID, LIGHT, ids());
    expect(c.ids.tograde.length).toBeGreaterThan(c.tograde);
    expect(light.tograde).toBe(c.tograde);
    const open = DashInboxQueue.open(CID, LIGHT);
    expect(open.items).toHaveLength(c.tograde);
    expect(open.items.some(i => i.members.length === 2)).toBe(true);
  });

  it('marks a stack new only for a student send after the kept time that is still to grade', () => {
    const isNew = seen => DashInboxQueue.build(CID, { seen }).stacks.find(s => s.aid === LIGHT).isNew;
    expect(isNew(undefined)).toBe(false);
    expect(isNew(null)).toBe(false);
    expect(isNew('2026-11-01T00:00:00Z')).toBe(true);
    expect(isNew('2099-01-01T00:00:00Z')).toBe(false);
  });

  it('lists graded work to return only in a class that holds grades until Return', () => {
    let q = DashInboxQueue.build(CID, {});
    expect(q.holds).toBe(true);
    expect(q.returns).toEqual([{ aid: LIGHT, title: 'Light Refraction Lab', toreturn: 2 }]);
    expect(q.toReturn).toBe(2);
    setStudentPageSwitch(CID, true, 'on_save');
    q = DashInboxQueue.build(CID, {});
    expect(q.holds).toBe(false);
    expect(q.returns).toEqual([]);
    expect(q.toReturn).toBe(0);
  });

  it('has nothing in a class whose Send Work is off', () => {
    const work = getCourseSubmissions(CID);
    work.course.send_work = false;
    saveDemoStudentWork(CID, work);
    const q = DashInboxQueue.build(CID, {});
    expect(q.on).toBe(false);
    expect(q.stacks).toEqual([]);
    expect(q.returns).toEqual([]);
  });

  it('is caught up when nothing waits, and lists the pieces still taking work', () => {
    const work = getCourseSubmissions(CID);
    work.submissions = work.submissions.filter(s => s.assessment_id !== LIGHT);
    saveDemoStudentWork(CID, work);
    const q = DashInboxQueue.build(CID, {});
    expect(q.caughtUp).toBe(true);
    expect(q.stacks).toEqual([]);
    q.taking.forEach(t => {
      expect(Object.keys(t).sort()).toEqual(['aid', 'notin', 'title']);
      expect(t.notin).toBeGreaterThan(0);
    });
  });
});

describe('DashInboxQueue.open', () => {
  it('gives the students to grade oldest send first, then who is not in in class-list order', () => {
    const o = DashInboxQueue.open(CID, LIGHT);
    expect(o.aid).toBe(LIGHT);
    expect(o.title).toBe('Light Refraction Lab');
    const times = o.items.map(i => Date.parse(i.at));
    expect(times).toEqual(times.slice().sort((a, b) => a - b));
    const c = GraderWork.workCounts(CID, LIGHT, ids());
    expect(o.notIn).toHaveLength(c.notin);
    expect(o.notIn.map(n => n.sid).sort()).toEqual(c.ids.notin.slice().sort());
    expect(o.notIn[0]).toEqual({ sid: expect.any(String), name: expect.any(String) });
    // Marcus's send was late.
    expect(o.items.find(i => i.name === 'Marcus Lee').late).toBe(true);
  });

  it('is empty for a piece that is not there', () => {
    expect(DashInboxQueue.open(CID, 'nope')).toEqual({ aid: 'nope', title: '', items: [], notIn: [] });
  });
});

describe('DashInboxQueue.order', () => {
  it("is the stacks in the order shown, each with DashInboxModel's grade order", () => {
    moreWork();
    const order = DashInboxQueue.order(CID);
    expect(order.map(o => o.aid)).toEqual(DashInboxQueue.build(CID, {}).stacks.map(s => s.aid));
    order.forEach(o => {
      expect(Object.keys(o).sort()).toEqual(['aid', 'studentIds']);
      expect(o.studentIds).toEqual(DashInboxModel.gradeOrder(CID, o.aid));
    });
    expect(order[order.length - 1].studentIds.length).toBeGreaterThan(0);
  });
});
