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
