/**
 * The reader of sent work takes a group (S12-T1; shared/data.js, "Student
 * work" › "Group work").
 *
 * First a pin: what single students get from the readers and the counts on
 * Demo Mode's class, as main answered before the group reader existed.
 * These must never change for a class with no group pieces.
 */
import './setup.js';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newBankIndex } from './helpers/bc-bank-fixture.js';

const CID = 'sci8';
const LAB = 'sci8a1';
const SENT = ['st1', 'st2', 'st3', 'st4', 'st5', 'st6', 'st7', 'st8', 'st9', 'st10'];
let wasDemo;

function seedDemo() {
  window.isDemoMode = () => true;
  Object.keys(COURSES).forEach(cid => _clearCourseLocalState(cid));
  localStorage.clear();
  CURRICULUM_INDEX = newBankIndex(['SCI8']);
  seedIfNeeded();
}

// The build switch and Send Work on, so To Grade and Not In count.
function workOn() {
  saveCourseConfig(CID, Object.assign({}, getCourseConfig(CID) || {}, { student_page_enabled: true }));
  const work = getCourseSubmissions(CID);
  work.course = Object.assign({}, work.course, { send_work: true });
  saveDemoStudentWork(CID, work);
}

// Clear one student's grade on the lab, ticks too, so their work is to grade.
function ungrade(sid) {
  const scores = getScores(CID);
  scores[sid] = (scores[sid] || []).filter(e => e.assessmentId !== LAB);
  saveScores(CID, scores);
  const checks = Object.assign({}, getRubricChecks(CID));
  delete checks[sid + ':' + LAB];
  saveRubricChecks(CID, checks);
}

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
  seedDemo();
  workOn();
});

describe('single students: the answers as they were (pin)', () => {
  it('getStudentSubmission: each student’s own work, or null', () => {
    getStudents(CID).forEach(s => {
      const sub = getStudentSubmission(CID, s.id, LAB);
      if (SENT.includes(s.id)) expect(sub && sub.id).toBe('demo-sub-' + s.id + '-sci8a1');
      else expect(sub).toBeNull();
    });
  });

  it('getStudentSubmission: the newest version', () => {
    const work = getCourseSubmissions(CID);
    const v1 = work.submissions.find(s => s.enrollment_id === 'st1');
    work.submissions.push(Object.assign({}, v1, { id: 'v2-st1', version: 2 }));
    saveDemoStudentWork(CID, work);
    expect(getStudentSubmission(CID, 'st1', LAB).id).toBe('v2-st1');
    expect(getGroupSubmissions(CID, 'st1', LAB).map(s => s.id)).toEqual(['v2-st1']);
  });

  it('getStudentWork: the lab’s row for a student who sent and one who did not', () => {
    const row = getStudentWork(CID, 'st2').assessments.find(a => a.id === LAB);
    expect(row.sent).toMatchObject({ submission_id: 'demo-sub-st2-sci8a1', pages: 2, note: 'Page 2 has my answers.' });
    expect(getStudentWork(CID, 'st11').assessments.find(a => a.id === LAB).sent).toBeNull();
  });

  it('the counts: every sample piece graded, so all 27 returned, nothing to grade, none not in', () => {
    const c = GraderWork.workCounts(CID, LAB);
    expect([c.tograde, c.toreturn, c.returned, c.notin, c.all, c.groups]).toEqual([0, 0, 27, 0, 27, 0]);
  });

  it('the counts: ungraded, one with work in is to grade and one without is not in', () => {
    ungrade('st1');
    ungrade('st11');
    const c = GraderWork.workCounts(CID, LAB);
    expect([c.tograde, c.notin, c.groups]).toEqual([1, 1, 0]);
    expect(c.ids.tograde).toEqual(['st1']);
    expect(c.ids.notin).toEqual(['st11']);
    const all = GraderWork.classWorkCounts(CID);
    expect([all.tograde, all.notin, all.groups]).toEqual([1, 2, 0]);
    expect(all.pieces).toEqual([
      { aid: LAB, tograde: 1, toreturn: 0, notin: 1 },
      { aid: 'sci8a4', tograde: 0, toreturn: 0, notin: 1 },
    ]);
  });
});

describe('a One per Group piece', () => {
  // Cece (st1) sent for group 1; Noor (st2) and Sam (st3) both sent for group 2, Sam Graded Separately.
  function groupLab(groupWork = 'group', collab = 'group') {
    const list = getAssessments(CID).map(a =>
      a.id === LAB
        ? Object.assign({}, a, {
            collaboration: collab,
            groups: [
              ['st1', 'st11', 'st12'],
              ['st2', 'st3'],
            ],
            gradedSeparately: ['st3'],
          })
        : a,
    );
    saveAssessments(CID, list);
    const work = getCourseSubmissions(CID);
    work.assessments = work.assessments.map(a => (a.id === LAB ? Object.assign({}, a, { group_work: groupWork }) : a));
    saveDemoStudentWork(CID, work);
  }

  it('the group is the teacher’s group on the assessment', () => {
    groupLab();
    expect(getStudentWorkGroup(CID, 'st11', LAB)).toEqual({
      kind: 'group',
      index: 0,
      members: ['st1', 'st11', 'st12'],
      separate: false,
    });
    expect(getStudentWorkGroup(CID, 'st3', LAB)).toMatchObject({ index: 1, separate: true });
    expect(getStudentWorkGroup(CID, 'st13', LAB)).toBeNull();
  });

  it('is the student alone on Each Student, on individual work, or with no group-mate left on the roster', () => {
    groupLab('each');
    expect(getStudentWorkGroup(CID, 'st11', LAB)).toBeNull();
    expect(getGroupSubmissions(CID, 'st11', LAB)).toEqual([]);
    expect(getGroupSubmissions(CID, 'st1', LAB).map(s => s.id)).toEqual(['demo-sub-st1-sci8a1']);
    groupLab('group', null);
    expect(getStudentWorkGroup(CID, 'st11', LAB)).toBeNull();
    groupLab();
    saveStudents(
      CID,
      getStudents(CID).filter(s => s.id !== 'st3'),
    );
    expect(getStudentWorkGroup(CID, 'st2', LAB)).toBeNull();
  });

  it('one submission for the group: every member sees it, and their own answers do not change', () => {
    groupLab();
    ['st1', 'st11', 'st12'].forEach(sid => {
      expect(getGroupSubmissions(CID, sid, LAB).map(s => s.id)).toEqual(['demo-sub-st1-sci8a1']);
      expect(groupWorkIn(CID, sid, LAB)).toBe(true);
    });
    expect(getStudentSubmission(CID, 'st11', LAB)).toBeNull();
    expect(groupWorkIn(CID, 'st13', LAB)).toBe(false);
    const files = getGroupWorkFiles(CID, 'st11', LAB);
    expect(files.map(f => [f.id, f.enrollment_id, f.submission_id, f.mine])).toEqual([
      ['demo-sub-st1-sci8a1-p1', 'st1', 'demo-sub-st1-sci8a1', false],
    ]);
    expect(getGroupWorkFiles(CID, 'st1', LAB)[0].mine).toBe(true);
  });

  it('a member Graded Separately is still in the group’s work', () => {
    groupLab();
    expect(getGroupSubmissions(CID, 'st3', LAB).map(s => s.enrollment_id)).toEqual(['st2', 'st3']);
    expect(getGroupWorkFiles(CID, 'st2', LAB).map(f => f.mine)).toEqual([true, true, false]);
  });

  it('the student page’s group_work: counts, never names', () => {
    groupLab();
    const out = getStudentGroupWork(CID, 'st11');
    expect(out.ok).toBe(true);
    const row = out.assessments.find(a => a.id === LAB);
    expect(row).toEqual({
      id: LAB,
      members: 3,
      sent: true,
      pages: 1,
      you_sent: false,
      first_sent_at: getStudentSubmission(CID, 'st1', LAB).sent_at,
    });
    expect(getStudentGroupWork(CID, 'st2').assessments.find(a => a.id === LAB)).toMatchObject({
      members: 2,
      pages: 3,
      you_sent: true,
      // Noor's came in first, Sam's three days later.
      first_sent_at: getStudentSubmission(CID, 'st2', LAB).sent_at,
    });
    const text = JSON.stringify(out);
    getStudents(CID).forEach(s => {
      if (s.firstName) expect(text).not.toContain(s.firstName);
      if (s.lastName) expect(text).not.toContain(s.lastName);
    });
    expect(getStudentGroupWork(CID, 'st13').assessments).toEqual([]);
  });

  it('signed in: nothing', () => {
    groupLab();
    window.isDemoMode = () => false;
    expect(getGroupSubmissions(CID, 'st11', LAB)).toEqual([]);
    expect(groupWorkIn(CID, 'st11', LAB)).toBe(false);
    expect(getGroupWorkFiles(CID, 'st11', LAB)).toEqual([]);
    expect(getStudentGroupWork(CID, 'st11')).toEqual({ ok: true, assessments: [] });
    window.isDemoMode = () => true;
  });
});
