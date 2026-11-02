/**
 * Restore Class from Backup (shared/backup-restore.js).
 *
 * A class is loaded the way get_class_bundle delivers it, downloaded with
 * Download Class Backup, and turned back into import_json_restore's payload.
 * The payload must hold what the server held, under fresh ids, so a restore
 * makes a new class and never writes over the old one
 * (migrations/20261103_import_json_restore_full_class.sql).
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const CID = 'b1000000-0000-4000-8000-000000000001';
const S1 = 'b1000000-0000-4000-8000-000000000011';
const S2 = 'b1000000-0000-4000-8000-000000000012';
const E1 = 'b1000000-0000-4000-8000-000000000021';
const E2 = 'b1000000-0000-4000-8000-000000000022';
const A1 = 'b1000000-0000-4000-8000-000000000031'; // competencies
const A2 = 'b1000000-0000-4000-8000-000000000032'; // rubric
const A3 = 'b1000000-0000-4000-8000-000000000033'; // points
const A4 = 'b1000000-0000-4000-8000-000000000034'; // no competency
const CAT = 'b1000000-0000-4000-8000-000000000041';
const MOD = 'b1000000-0000-4000-8000-000000000042';
const GRP = 'b1000000-0000-4000-8000-000000000043';
const SUBJ = 'b1000000-0000-4000-8000-000000000051';
const SEC = 'b1000000-0000-4000-8000-000000000052';
const T1 = 'b1000000-0000-4000-8000-000000000061';
const T2 = 'b1000000-0000-4000-8000-000000000062';
const R1 = 'b1000000-0000-4000-8000-000000000071';
const C1 = 'b1000000-0000-4000-8000-000000000072';
const C2 = 'b1000000-0000-4000-8000-000000000073';
const K1 = 'b1000000-0000-4000-8000-000000000074';
const OB1 = 'b1000000-0000-4000-8000-000000000081';
const COPY = 'b1000000-0000-4000-8000-000000000091';
const OLD_IDS = [CID, E1, E2, A1, A2, A3, A4, CAT, MOD, GRP, SUBJ, SEC, T1, T2, R1, C1, C2, K1, OB1, COPY];

const course = {
  id: CID,
  name: 'Science 8',
  gradeLevel: '8',
  description: 'Block B science',
  color: '#336699',
  gradingSystem: 'both',
  calcMethod: 'mostRecent',
  decayWeight: 0.65,
  timezone: 'America/Vancouver',
  lateWorkPolicy: null,
  block: 'B',
  curriculumTags: ['SCI8'],
};

function assessment(id, extra) {
  return Object.assign(
    {
      id: id,
      description: '',
      category_id: CAT,
      score_mode: 'proficiency',
      max_points: null,
      weight: 1,
      evidence_type: '',
      rubric_id: null,
      module_id: null,
      collab_mode: null,
      collab_config: {},
      has_rubric: false,
      date_assigned: '2026-09-15',
      due_date: null,
      core_competency_ids: [],
      tag_ids: [],
    },
    extra,
  );
}

function bundle() {
  return {
    bundle_schema: 2,
    version: 3,
    gradebook: {
      course: {
        id: CID,
        curriculum_tags: ['SCI8'],
        round_percent: false,
        recent_score_limit: 3,
        level_order: 'asc',
        folders_count_as_one: false,
        courses_count_equally: true,
      },
      students: [
        {
          enrollment_id: E1,
          student_id: S1,
          first_name: 'Ada',
          last_name: 'Lovelace',
          preferred_name: 'Addie',
          student_number: ' 1234567 ',
          roster_position: 1,
          designations: ['G'],
        },
        { enrollment_id: E2, student_id: S2, first_name: 'Alan', last_name: 'Turing', roster_position: 2 },
      ],
      assessments: [
        assessment(A1, {
          title: 'Lab 1',
          module_id: MOD,
          tag_ids: [T1, T2],
          core_competency_ids: ['COM', 'CT'],
          copy_group: COPY,
          collab_mode: 'pairs',
          collab_config: { pairs: [[E1, E2]] },
          due_date: '2026-09-20',
          display_order: 0,
        }),
        assessment(A2, { title: 'Design task', rubric_id: R1, has_rubric: true, display_order: 1 }),
        assessment(A3, { title: 'Quiz', score_mode: 'points', max_points: 20, display_order: 2 }),
        assessment(A4, { title: 'Exit ticket', category_id: null, display_order: 3 }),
      ],
      categories: [{ id: CAT, name: 'Labs', weight: 100, display_order: 0, calc_mode: 'percent' }],
      modules: [{ id: MOD, course_id: CID, name: 'Unit 1', color: '#123456', display_order: 0 }],
      tag_index: [T1, T2],
      criterion_index: [C1, C2],
      check_index: [K1],
      // [student, assessment, value, status, comment, modifier, report note]
      score_rows: [
        [0, 0, null, null, 'Clear question', 0, 'Strong start'],
        [1, 0, null, 'LATE', '', 0, null],
        [0, 2, 17, null, '', 0, null],
        [0, 3, 3, null, '', 1, null],
      ],
      // [student, assessment, tag, value, modifier, comment]
      tag_rows: [
        [0, 0, 0, 3, 0, 'Good questions'],
        [0, 0, 1, 2, 1],
      ],
      // [student, assessment, criterion, value, modifier, comment, beyond]
      criterion_rows: [
        [0, 1, 0, 4, 0, 'Neat'],
        [0, 1, 1, 2, 1, null, 'Extra mile'],
      ],
      check_rows: [[0, 1, 0]],
    },
    learning_map: {
      competency_groups: [{ id: GRP, name: 'Inquiry', color: '#aa3300', display_order: 0, counts_as_one: false }],
      subjects: [
        {
          id: SUBJ,
          name: 'Science',
          display_order: 0,
          sections: [
            {
              id: SEC,
              name: 'Questioning',
              display_order: 0,
              competency_group_id: GRP,
              tags: [
                {
                  id: T1,
                  code: 'Q1',
                  label: 'Ask questions',
                  i_can_text: 'I can ask questions\nI can predict',
                  i_can_statements: ['I can ask questions', 'I can predict'],
                  source_text: 'Demonstrate a sustained intellectual curiosity',
                  bank_id: 'bc.sci8.cc.1',
                  display_order: 0,
                },
                { id: T2, code: 'Q2', label: 'Plan investigations', i_can_text: '', display_order: 1 },
              ],
            },
          ],
        },
      ],
    },
    rubrics: {
      rubrics: [{ id: R1, name: 'Design rubric', style: 'advanced', copy_group: COPY, created_at: '2026-09-01' }],
      criteria: [
        {
          id: C1,
          rubric_id: R1,
          name: 'Design',
          level_4_descriptor: 'Extends',
          level_3_descriptor: 'Meets',
          level_2_descriptor: 'Developing',
          level_1_descriptor: 'Emerging',
          level_4_value: 5,
          level_3_value: 3,
          level_2_value: 2,
          level_1_value: 1,
          weight: 2,
          display_order: 0,
        },
        { id: C2, rubric_id: R1, name: 'Build', weight: 1, display_order: 1 },
      ],
      criterion_tags: [{ criterion_id: C1, tag_id: T1 }],
      criterion_checks: [{ id: K1, criterion_id: C1, level: 3, label: 'Labels parts', display_order: 0 }],
    },
    observations: {
      observations: [
        {
          id: OB1,
          body: 'Helped a classmate',
          sentiment: 'strength',
          context_type: 'lab',
          assessment_id: A1,
          created_at: '2026-10-03T10:00:00Z',
          dims: ['COL'],
          level: 3,
          enrollment_ids: [E1, E2],
          tag_ids: [T1],
        },
      ],
      total: 1,
    },
    profiles: [
      {
        student: { id: S1, first_name: 'Ada', last_name: 'Lovelace' },
        enrollment: { id: E1, roster_position: 1, designations: ['G'] },
        goals: { [SEC]: 'Ask sharper questions' },
        reflections: { [SEC]: { confidence: 3, text: 'Getting there', date: '2026-10-01' } },
        section_overrides: { [SEC]: { level: 4, reason: 'Conference', date: '2026-10-02' } },
        notes: [{ id: 'n1', body: 'Parent emailed' }],
        is_flagged: true,
      },
      {
        student: { id: S2, first_name: 'Alan', last_name: 'Turing' },
        enrollment: { id: E2, roster_position: 2, designations: [] },
        notes: [],
      },
    ],
    term_ratings: [
      {
        enrollment_id: E1,
        term: 1,
        narrative_html: '<p>A strong start.</p>',
        work_habits_rating: 3,
        participation_rating: 4,
        social_traits: ['kind'],
        habits: { completes: 4, ready: 5 },
        approved_at: '2026-10-30T12:00:00Z',
        reporting_basis: 'grade',
        strength_tags: [T1],
        growth_tags: [T2],
        mention_assessments: [A1],
        mention_observations: [OB1],
      },
    ],
    report_config: { preset: 'brief', blocks_config: { order: ['header', 'grades'] } },
    custom_tags: ['Lab safety'],
    course_config: { grading_scale: { boundaries: [50, 60] }, category_weights: { [CAT]: 100 } },
  };
}

function resetClass() {
  localStorage.clear();
  Object.keys(_DATA_KEYS).forEach(function (field) {
    _cache[field] = {};
  });
  _serverState = {};
  _localWrites = {};
  _refreshState = {};
  saveCourses({ [CID]: structuredClone(course) });
  if (typeof clearProfCache === 'function') clearProfCache();
}

/* Download Class Backup's file for CID, as parsed JSON. */
function downloadBackup() {
  var written = null;
  var originalBlob = globalThis.Blob;
  var originalUrl = URL.createObjectURL;
  var originalCreate = document.createElement;
  globalThis.Blob = function (parts) {
    written = parts.join('');
  };
  URL.createObjectURL = () => 'blob:backup';
  document.createElement = () => ({ click() {} });
  try {
    DashClassManager.handleAction('cmDownloadBackup', { dataset: { cid: CID } });
  } finally {
    globalThis.Blob = originalBlob;
    URL.createObjectURL = originalUrl;
    document.createElement = originalCreate;
  }
  return FVBackupRestore.parseBackup(written);
}

function counterIds() {
  var n = 0;
  return function () {
    n++;
    return 'f0000000-0000-4000-8000-' + String(n).padStart(12, '0');
  };
}

function by(rows, field, value) {
  return (rows || []).filter(r => r[field] === value);
}

describe('restore class from backup', () => {
  var backup;
  var plan;
  var id;

  beforeEach(() => {
    resetClass();
    _bundleToCache(CID, bundle());
    backup = downloadBackup();
    plan = FVBackupRestore.planRestore(backup, { name: 'Science 8 (Restored)', makeId: counterIds() });
    id = old => plan.ids[old];
  });

  it('puts every record under a fresh id, so no class is written over', () => {
    expect(plan.cid).toBe(id(CID));
    expect(plan.cid).not.toBe(CID);
    var payload = JSON.stringify(plan.payload);
    var cache = JSON.stringify(plan.cache);
    OLD_IDS.forEach(old => {
      expect(payload).not.toContain(old);
      expect(cache).not.toContain(old);
    });
    // The old student records only as the server's hint for matching.
    expect(plan.payload.students.map(s => s.match_id)).toEqual([S1, S2]);
    expect(plan.payload.students.map(s => s.id)).toEqual([id(S1), id(S2)]);
  });

  it('keeps the class settings, with the new name', () => {
    expect(plan.payload.courses).toEqual([
      {
        id: plan.cid,
        name: 'Science 8 (Restored)',
        grade_level: '8',
        description: 'Block B science',
        color: '#336699',
        is_archived: false,
        grading_system: 'both',
        calc_method: 'mostRecent',
        decay_weight: 0.65,
        timezone: 'America/Vancouver',
        late_work_policy: null,
        block: 'B',
        curriculum_tags: ['SCI8'],
        grading_scale: { boundaries: [50, 60] },
        category_weights: { [id(CAT)]: 100 },
        reporting_terms: null,
        round_percent: false,
        recent_score_limit: 3,
        level_order: 'asc',
        folders_count_as_one: false,
        courses_count_equally: true,
      },
    ]);
    expect(plan.payload.report_configs).toEqual([
      { course_id: plan.cid, preset: 'brief', blocks_config: { order: ['header', 'grades'] } },
    ]);
    expect(plan.payload.categories).toEqual([
      { id: id(CAT), course_id: plan.cid, name: 'Labs', weight: 100, display_order: 0, calc_mode: 'percent' },
    ]);
    expect(plan.course.name).toBe('Science 8 (Restored)');
  });

  it('keeps competencies with their I Can statements, curriculum wording and bank ids', () => {
    expect(plan.payload.competency_groups).toEqual([
      {
        id: id(GRP),
        course_id: plan.cid,
        name: 'Inquiry',
        color: '#aa3300',
        display_order: 0,
        counts_as_one: false,
      },
    ]);
    expect(plan.payload.sections).toMatchObject([
      { id: id(SEC), subject_id: id(SUBJ), competency_group_id: id(GRP), name: 'Questioning' },
    ]);
    expect(plan.payload.tags).toEqual([
      {
        id: id(T1),
        section_id: id(SEC),
        code: 'Q1',
        label: 'Ask questions',
        i_can_text: 'I can ask questions\nI can predict',
        i_can_statements: ['I can ask questions', 'I can predict'],
        source_text: 'Demonstrate a sustained intellectual curiosity',
        bank_id: 'bc.sci8.cc.1',
        display_order: 0,
      },
      {
        id: id(T2),
        section_id: id(SEC),
        code: 'Q2',
        label: 'Plan investigations',
        i_can_text: null,
        i_can_statements: [],
        source_text: null,
        bank_id: null,
        display_order: 1,
      },
    ]);
  });

  it('keeps students and enrolments', () => {
    expect(plan.payload.students[0]).toMatchObject({
      first_name: 'Ada',
      last_name: 'Lovelace',
      preferred_name: 'Addie',
      student_number: '1234567',
    });
    expect(plan.payload.enrollments).toEqual([
      expect.objectContaining({
        id: id(E1),
        student_id: id(S1),
        course_id: plan.cid,
        designations: ['G'],
        roster_position: 1,
        is_flagged: true,
      }),
      expect.objectContaining({ id: id(E2), student_id: id(S2), roster_position: 2, is_flagged: false }),
    ]);
  });

  it('keeps assessments, without their links to copies in other classes', () => {
    var a1 = by(plan.payload.assessments, 'id', id(A1))[0];
    expect(a1).toMatchObject({
      course_id: plan.cid,
      category_id: id(CAT),
      module_id: id(MOD),
      title: 'Lab 1',
      score_mode: 'proficiency',
      date_assigned: '2026-09-15',
      due_date: '2026-09-20',
      collab_mode: 'pairs',
      collab_config: { pairs: [[id(E1), id(E2)]] },
      core_competency_ids: ['COM', 'CT'],
    });
    expect(a1).not.toHaveProperty('copy_group');
    expect(plan.cache.assessments.every(a => !a.copyGroup)).toBe(true);
    expect(by(plan.payload.assessments, 'id', id(A2))[0].rubric_id).toBe(id(R1));
    expect(by(plan.payload.assessments, 'id', id(A3))[0]).toMatchObject({ score_mode: 'points', max_points: 20 });
    expect(by(plan.payload.assessments, 'id', id(A4))[0].category_id).toBeNull();
    expect(plan.payload.assessment_tags).toEqual([
      { assessment_id: id(A1), tag_id: id(T1) },
      { assessment_id: id(A1), tag_id: id(T2) },
    ]);
  });

  it('keeps rubrics with their levels, weights and checkboxes', () => {
    expect(plan.payload.rubrics).toEqual([
      { id: id(R1), course_id: plan.cid, name: 'Design rubric', style: 'advanced' },
    ]);
    expect(plan.payload.criteria[0]).toMatchObject({
      id: id(C1),
      rubric_id: id(R1),
      name: 'Design',
      level_4_descriptor: 'Extends',
      level_1_descriptor: 'Emerging',
      level_4_value: 5,
      level_3_value: 3,
      weight: 2,
    });
    expect(plan.payload.criterion_tags).toEqual([{ criterion_id: id(C1), tag_id: id(T1) }]);
    expect(plan.payload.criterion_checks).toEqual([
      { id: id(K1), criterion_id: id(C1), level: 3, label: 'Labels parts', display_order: 0 },
    ]);
    expect(plan.payload.rubric_check_scores).toEqual([
      { enrollment_id: id(E1), assessment_id: id(A2), check_id: id(K1) },
    ]);
  });

  it('keeps every score with its + / −, comments and Note for the Report', () => {
    expect(plan.payload.tag_scores).toEqual(
      expect.arrayContaining([
        {
          enrollment_id: id(E1),
          assessment_id: id(A1),
          tag_id: id(T1),
          value: 3,
          modifier: 0,
          comment: 'Good questions',
        },
        { enrollment_id: id(E1), assessment_id: id(A1), tag_id: id(T2), value: 2, modifier: 1, comment: null },
      ]),
    );
    expect(plan.payload.tag_scores).toHaveLength(2);
    expect(plan.payload.rubric_scores).toEqual(
      expect.arrayContaining([
        {
          enrollment_id: id(E1),
          assessment_id: id(A2),
          criterion_id: id(C1),
          value: 4,
          modifier: 0,
          comment: 'Neat',
          beyond: null,
        },
        {
          enrollment_id: id(E1),
          assessment_id: id(A2),
          criterion_id: id(C2),
          value: 2,
          modifier: 1,
          comment: null,
          beyond: 'Extra mile',
        },
      ]),
    );
    expect(plan.payload.rubric_scores).toHaveLength(2);
    var score = (sid, aid) => plan.payload.scores.find(s => s.enrollment_id === id(sid) && s.assessment_id === id(aid));
    expect(score(E1, A1)).toEqual({
      enrollment_id: id(E1),
      assessment_id: id(A1),
      value: null,
      status: null,
      comment: 'Clear question',
      modifier: 0,
      report_note: 'Strong start',
    });
    expect(score(E2, A1)).toMatchObject({ value: null, status: 'LATE', comment: null });
    expect(score(E1, A3)).toMatchObject({ value: 17, modifier: 0 });
    expect(score(E1, A4)).toMatchObject({ value: 3, modifier: 1 });
    expect(plan.payload.scores).toHaveLength(4);
  });

  it('keeps notes, goals, reflections, overrides and custom tags', () => {
    expect(plan.payload.notes).toEqual([{ enrollment_id: id(E1), body: 'Parent emailed' }]);
    expect(plan.payload.goals).toEqual([{ enrollment_id: id(E1), section_id: id(SEC), body: 'Ask sharper questions' }]);
    expect(plan.payload.reflections).toEqual([
      { enrollment_id: id(E1), section_id: id(SEC), body: 'Getting there', confidence: 3 },
    ]);
    expect(plan.payload.section_overrides).toEqual([
      { enrollment_id: id(E1), section_id: id(SEC), level: 4, reason: 'Conference' },
    ]);
    expect(plan.payload.custom_tags).toEqual([{ course_id: plan.cid, label: 'Lab safety' }]);
  });

  it('keeps an observation once, with every student it names', () => {
    expect(plan.payload.observations).toEqual([
      {
        id: id(OB1),
        course_id: plan.cid,
        body: 'Helped a classmate',
        sentiment: 'strength',
        context_type: 'lab',
        assessment_id: id(A1),
        created_at: '2026-10-03T10:00:00Z',
        dims: ['COL'],
        level: 3,
        template_id: null,
        enrollment_ids: [id(E1), id(E2)],
        tag_ids: [id(T1)],
      },
    ]);
  });

  it('keeps term ratings and what they name', () => {
    expect(plan.payload.term_ratings).toEqual([
      expect.objectContaining({
        enrollment_id: id(E1),
        term: 1,
        narrative_html: '<p>A strong start.</p>',
        work_habits_rating: 3,
        participation_rating: 4,
        social_traits: ['kind'],
        habits: { completes: 4, ready: 5 },
        approved_at: '2026-10-30T12:00:00Z',
        reporting_basis: 'grade',
        strength_tag_ids: [id(T1)],
        growth_tag_ids: [id(T2)],
        mention_assessment_ids: [id(A1)],
        mention_observation_ids: [id(OB1)],
      }),
    ]);
  });

  it('leaves out rows that point at something the backup lacks', () => {
    var gone = 'b1000000-0000-4000-8000-0000000000ff';
    backup.assessments[0].tagIds = backup.assessments[0].tagIds.concat([gone]);
    backup.goals[E1][gone] = 'A goal on a removed competency';
    var again = FVBackupRestore.planRestore(backup, { makeId: counterIds() });
    expect(again.payload.assessment_tags).toHaveLength(2);
    expect(again.payload.goals).toHaveLength(1);
  });

  it('names a backup from before Nov 2026 as given, with default settings', () => {
    delete backup.courseInfo;
    var old = FVBackupRestore.planRestore(backup, { name: '', makeId: counterIds() });
    expect(old.course).toMatchObject({ name: 'Restored Class', gradingSystem: 'proficiency', gradeLevel: '' });
    expect(old.payload.courses[0]).toMatchObject({ name: 'Restored Class', grading_system: 'proficiency' });
    // Its settings from the class config still come back.
    expect(old.payload.courses[0].level_order).toBe('asc');
  });

  it('refuses a file that is not a class backup', () => {
    expect(() => FVBackupRestore.parseBackup('not json')).toThrow(/isn't a class backup/);
    expect(() => FVBackupRestore.parseBackup('{"students": []}')).toThrow(/isn't a class backup/);
  });
});

describe('restoreClassFromBackup', () => {
  var backup;
  var originals;

  beforeEach(() => {
    resetClass();
    _bundleToCache(CID, bundle());
    backup = downloadBackup();
    originals = {
      _writeRpc: globalThis._writeRpc,
      _writesEnabled: globalThis._writesEnabled,
      _isDemoSession: globalThis._isDemoSession,
    };
  });

  afterEach(() => {
    Object.assign(globalThis, originals);
  });

  it('in Demo Mode makes the class on this device only, grading as the original did', async () => {
    globalThis._isDemoSession = () => true;
    globalThis._writeRpc = vi.fn();
    var restored = FVBackupRestore.restoreClassFromBackup(backup, { name: 'Science 8 Copy' });
    await expect(restored.sent).resolves.toBeNull();
    expect(_writeRpc).not.toHaveBeenCalled();
    var cid = restored.cid;
    expect(COURSES[cid].name).toBe('Science 8 Copy');
    expect(COURSES[CID].name).toBe('Science 8');
    expect(getStudents(cid).map(s => s.firstName)).toEqual(['Ada', 'Alan']);
    expect(getAssessments(cid)).toHaveLength(4);
    expect(getAllTags(cid).map(t => t.bank_id)).toEqual(['bc.sci8.cc.1', null]);
    var newE1 = getStudents(cid)[0].id;
    clearProfCache();
    expect(getOverallProficiency(cid, newE1)).toBe(getOverallProficiency(CID, E1));
    expect(getOverallProficiency(cid, newE1)).toBeGreaterThan(0);
  });

  it('signed in sends one import_json_restore through the outbox', async () => {
    globalThis._isDemoSession = () => false;
    globalThis._writesEnabled = () => true;
    globalThis._writeRpc = vi.fn(() => Promise.resolve({ data: { courses: 1 }, error: null }));
    var restored = FVBackupRestore.restoreClassFromBackup(backup, { name: 'Science 8' });
    await expect(restored.sent).resolves.toEqual({ courses: 1 });
    expect(_writeRpc).toHaveBeenCalledTimes(1);
    var [name, params] = _writeRpc.mock.calls[0];
    expect(name).toBe('import_json_restore');
    expect(params.p_payload.courses[0].id).toBe(restored.cid);
    expect(FV_IDEMPOTENT_RPCS.import_json_restore).toBe(true);
  });

  it('takes the class off this device again when the server refuses it', async () => {
    globalThis._isDemoSession = () => false;
    globalThis._writesEnabled = () => true;
    globalThis._writeRpc = vi.fn(() => Promise.resolve({ data: null, error: { message: 'violates check' } }));
    var restored = FVBackupRestore.restoreClassFromBackup(backup, { name: 'Science 8' });
    expect(COURSES[restored.cid]).toBeTruthy();
    await expect(restored.sent).rejects.toEqual({ message: 'violates check' });
    expect(COURSES[restored.cid]).toBeUndefined();
    expect(localStorage.getItem('gb-students-' + restored.cid)).toBeNull();
    expect(COURSES[CID]).toBeTruthy();
  });
});
