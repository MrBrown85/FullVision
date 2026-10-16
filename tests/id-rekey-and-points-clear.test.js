/**
 * Bug check, 2026-10-13.
 *
 * - Scores and statuses entered before a new assessment or student gets its
 *   server id move to that id and are sent; before, a write with a local id
 *   was dropped and never sent.
 * - A cleared points cell is no evidence. (Until 2026-10-16 a cleared cell
 *   was stored as 0; a 0 is now a real score.)
 * - Demo Mode student ids never reach get_student_profile.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'vm';
import { makeFakeSupabase, settle } from './helpers/fake-supabase.js';

// Production loads the outbox next to shared/data.js; so do these tests.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
runInThisContext(readFileSync(resolve(root, 'shared/offline-queue.js'), 'utf-8'), {
  filename: 'shared/offline-queue.js',
});

const CID = '11111111-1111-4111-8111-111111111111';
const ENR_Y = '22222222-2222-4222-8222-222222222222';
const STU_Y = '33333333-3333-4333-8333-333333333333';
const AID = '44444444-4444-4444-8444-444444444444';
const TAG1 = '77777777-7777-4777-8777-777777777777';

function seed(field, value) {
  _cache[field][CID] = value;
  localStorage.setItem('gb-' + _DATA_KEYS[field] + '-' + CID, JSON.stringify(value));
}

function studentY() {
  return { id: ENR_Y, personId: STU_Y, firstName: 'Yara', lastName: 'Young', designations: [], sortName: 'Young Yara' };
}

describe('local ids re-keyed to server ids', () => {
  var fake;
  var originalGetSupabase;
  var originalUseSupabase;

  beforeEach(() => {
    localStorage.clear();
    Object.keys(_cache).forEach(function (field) {
      if (_cache[field] && typeof _cache[field] === 'object' && field !== 'courses' && field !== 'config') {
        _cache[field] = {};
      }
    });
    _studentSaveQueue = {};
    _assessmentSaveQueue = {};
    _serverState = {};
    _idRekeys = {};
    fake = makeFakeSupabase();
    originalGetSupabase = globalThis.getSupabase;
    originalUseSupabase = _useSupabase;
    globalThis.getSupabase = () => fake;
    _useSupabase = true;
    _supabaseDegraded = false;
    _teacherId = 'teacher-uuid';
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
    window.v2Queue.clear();
  });

  afterEach(() => {
    globalThis.getSupabase = originalGetSupabase;
    _useSupabase = originalUseSupabase;
    window.v2Queue.clear();
  });

  it('sends a score entered before a new assessment is created', async () => {
    seed('students', [studentY()]);
    seed('assessments', []);
    seed('scores', {});
    fake.hold();

    var assessments = getAssessments(CID);
    assessments.push({ id: 'sLOCALASSESS1', title: 'Lab', type: 'summative', tagIds: [TAG1] });
    saveAssessments(CID, assessments);
    // Graded before create_assessment answers.
    var scores = getScores(CID);
    scores[ENR_Y] = [{ id: 'e1', assessmentId: 'sLOCALASSESS1', tagId: TAG1, score: 3, date: '2026-10-13' }];
    saveScores(CID, scores);
    expect(fake.count('upsert_tag_score')).toBe(0);

    await fake.release();
    await settle();

    var newId = getAssessments(CID)[0].id;
    expect(_isUuid(newId)).toBe(true);
    expect(getScores(CID)[ENR_Y][0].assessmentId).toBe(newId);
    expect(
      fake.committedCount(
        'upsert_tag_score',
        p => p.p_assessment_id === newId && p.p_tag_id === TAG1 && p.p_value === 3,
      ),
    ).toBe(1);
  });

  it('moves a score entered on a stale page after the swap', async () => {
    seed('students', [studentY()]);
    seed('assessments', []);
    seed('scores', {});

    var assessments = getAssessments(CID);
    assessments.push({ id: 'sLOCALASSESS2', title: 'Quiz', type: 'summative', tagIds: [TAG1] });
    saveAssessments(CID, assessments);
    await settle();
    var newId = getAssessments(CID)[0].id;

    // A click on markup still carrying the local id.
    var scores = getScores(CID);
    scores[ENR_Y] = [{ id: 'e2', assessmentId: 'sLOCALASSESS2', tagId: TAG1, score: 4, date: '2026-10-13' }];
    saveScores(CID, scores);
    await settle();

    expect(getScores(CID)[ENR_Y][0].assessmentId).toBe(newId);
    expect(fake.committedCount('upsert_tag_score', p => p.p_assessment_id === newId && p.p_value === 4)).toBe(1);
  });

  it('sends a score and status entered before a new student is enrolled', async () => {
    seed('students', [studentY()]);
    seed('assessments', [{ id: AID, title: 'Lab', type: 'summative', tagIds: [TAG1] }]);
    seed('scores', {});
    seed('statuses', {});
    fake.hold();

    var students = getStudents(CID);
    students.push({
      id: 'sLOCALSTUDENT',
      firstName: 'Xavier',
      lastName: 'Xu',
      designations: [],
      sortName: 'Xu Xavier',
    });
    saveStudents(CID, students);
    var scores = getScores(CID);
    scores.sLOCALSTUDENT = [{ id: 'e3', assessmentId: AID, tagId: TAG1, score: 2, date: '2026-10-13' }];
    saveScores(CID, scores);
    setAssignmentStatus(CID, 'sLOCALSTUDENT', AID, 'LATE');

    await fake.release();
    await settle();

    var enr = getStudents(CID).find(s => s.firstName === 'Xavier').id;
    expect(_isUuid(enr)).toBe(true);
    expect(getScores(CID)[enr]).toHaveLength(1);
    expect(getScores(CID).sLOCALSTUDENT).toBeUndefined();
    expect(getAssignmentStatus(CID, enr, AID)).toBe('LATE');
    expect(fake.committedCount('upsert_tag_score', p => p.p_enrollment_id === enr && p.p_value === 2)).toBe(1);
    expect(fake.committedCount('set_score_status', p => p.p_enrollment_id === enr && p.p_status === 'LATE')).toBe(1);
  });
});

describe('cleared points scores', () => {
  beforeEach(() => {
    localStorage.clear();
    _cache.assessments[CID] = [
      { id: AID, title: 'Test', type: 'summative', tagIds: [TAG1], scoreMode: 'points', maxPoints: 10 },
      { id: 'cmp', title: 'Homework', type: 'summative', tagIds: [TAG1], scoreMode: 'complete', maxPoints: 1 },
    ];
    _cache.statuses[CID] = {};
    clearProfCache();
  });

  // Since 2026-10-16 a typed 0 is a score and a cleared cell has no entry
  // (docs/grading-compliance-plan.md 1.5).
  it('counts a points score of 0 as a score of 0', () => {
    _cache.scores[CID] = { [ENR_Y]: [{ assessmentId: AID, tagId: TAG1, score: 0, date: '2026-10-13' }] };
    clearProfCache();
    expect(getTagScores(CID, ENR_Y, TAG1)[0].score).toBe(1);
    expect(getAssessmentOverallScore(CID, ENR_Y, AID)).toBe(0);
  });

  it('counts a cleared points cell as no evidence', () => {
    _cache.scores[CID] = { [ENR_Y]: [] };
    clearProfCache();
    expect(getTagScores(CID, ENR_Y, TAG1)).toEqual([]);
    expect(getAssessmentOverallScore(CID, ENR_Y, AID)).toBeNull();
  });

  it('still counts Incomplete', () => {
    _cache.scores[CID] = { [ENR_Y]: [{ assessmentId: 'cmp', tagId: TAG1, score: 0, date: '2026-10-13' }] };
    clearProfCache();
    expect(getAssessmentOverallScore(CID, ENR_Y, 'cmp')).toBe(0);
    expect(getTagScores(CID, ENR_Y, TAG1)[0].score).toBeGreaterThan(0);
  });
});

describe('Demo Mode student profile', () => {
  it('does not call the server for a local student id', async () => {
    var calls = [];
    var originalGetSupabase = globalThis.getSupabase;
    globalThis.getSupabase = () => ({
      rpc(name) {
        calls.push(name);
        return Promise.resolve({ data: null, error: null });
      },
    });
    try {
      await window.v2.getStudentProfile('st8');
    } finally {
      globalThis.getSupabase = originalGetSupabase;
    }
    expect(calls).toHaveLength(0);
  });
});
