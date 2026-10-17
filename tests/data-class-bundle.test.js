/**
 * One request per class (docs/class-loading-plan.md, Phase 3).
 *
 * get_class_bundle replaces get_gradebook, get_learning_map, get_observations,
 * the rubric table reads, get_assessment_detail per assessment and
 * list_course_student_profiles. The same class loaded both ways must leave
 * the same cache behind, and calc.js must grade it the same.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CID = 'c0000000-0000-4000-8000-000000000001';
const S1 = 'c0000000-0000-4000-8000-000000000011';
const S2 = 'c0000000-0000-4000-8000-000000000012';
const E1 = 'c0000000-0000-4000-8000-000000000021';
const E2 = 'c0000000-0000-4000-8000-000000000022';
const A1 = 'c0000000-0000-4000-8000-000000000031';
const A2 = 'c0000000-0000-4000-8000-000000000032';
const CAT = 'c0000000-0000-4000-8000-000000000041';
const MOD = 'c0000000-0000-4000-8000-000000000042';
const SUBJ = 'c0000000-0000-4000-8000-000000000051';
const SEC = 'c0000000-0000-4000-8000-000000000052';
const T1 = 'c0000000-0000-4000-8000-000000000061';
const T2 = 'c0000000-0000-4000-8000-000000000062';
const R1 = 'c0000000-0000-4000-8000-000000000071';
const C1 = 'c0000000-0000-4000-8000-000000000072';
const OB1 = 'c0000000-0000-4000-8000-000000000081';

const students = [
  { enrollment_id: E1, student_id: S1, first_name: 'Ada', last_name: 'Lovelace', roster_position: 1, designations: [] },
  {
    enrollment_id: E2,
    student_id: S2,
    first_name: 'Alan',
    last_name: 'Turing',
    roster_position: 2,
    designations: ['G'],
  },
];
const assessmentRow = {
  [A1]: {
    id: A1,
    title: 'Lab 1',
    description: 'First lab',
    category_id: CAT,
    score_mode: 'proficiency',
    max_points: null,
    weight: 1,
    evidence_type: '',
    rubric_id: null,
    module_id: MOD,
    collab_mode: null,
    collab_config: {},
    has_rubric: false,
    date_assigned: '2026-09-15',
    due_date: '2026-09-20',
    display_order: 0,
    tag_ids: [T1, T2],
  },
  [A2]: {
    id: A2,
    title: 'Design task',
    description: '',
    category_id: CAT,
    score_mode: 'proficiency',
    max_points: null,
    weight: 1,
    evidence_type: '',
    rubric_id: R1,
    module_id: null,
    collab_mode: null,
    collab_config: {},
    has_rubric: true,
    date_assigned: '2026-09-22',
    due_date: null,
    display_order: 1,
    tag_ids: [],
  },
};
const categories = [{ id: CAT, name: 'Labs', weight: 100, display_order: 0 }];
const modules = [{ id: MOD, course_id: CID, name: 'Unit 1', color: '#123456', display_order: 0 }];
const learningMap = {
  competency_groups: [],
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
          competency_group_id: null,
          tags: [
            { id: T1, code: 'Q1', label: 'Ask questions', i_can_text: '', display_order: 0 },
            { id: T2, code: 'Q2', label: 'Plan investigations', i_can_text: '', display_order: 1 },
          ],
        },
      ],
    },
  ],
};
const rubricRows = {
  rubric: [{ id: R1, name: 'Design rubric', created_at: '2026-09-01T00:00:00Z' }],
  criterion: [
    {
      id: C1,
      rubric_id: R1,
      name: 'Design',
      level_4_descriptor: 'Extends',
      level_3_descriptor: 'Meets',
      level_2_descriptor: 'Developing',
      level_1_descriptor: 'Emerging',
      level_4_value: 4,
      level_3_value: 3,
      level_2_value: 2,
      level_1_value: 1,
      weight: 1,
      display_order: 0,
    },
  ],
  criterion_tag: [{ criterion_id: C1, tag_id: T1 }],
};
const e1a1 = {
  score: { value: 3, status: null, comment: 'Clear question' },
  tag_scores: [
    { tag_id: T1, value: 3, modifier: 0 },
    { tag_id: T2, value: 2, modifier: 1 },
  ],
  rubric_scores: [],
};
const e1a2 = { score: null, tag_scores: [], rubric_scores: [{ criterion_id: C1, value: 4, modifier: 0 }] };
const e2a1 = { score: { value: null, status: 'late', comment: '' }, tag_scores: [], rubric_scores: [] };
const emptyCell = { score: null, tag_scores: [], rubric_scores: [] };
const observations = {
  observations: [
    {
      id: OB1,
      body: 'Helped a classmate',
      sentiment: 'positive',
      context_type: 'class',
      assessment_id: null,
      created_at: '2026-10-03T10:00:00Z',
      enrollment_ids: [E1],
      tag_ids: [],
      custom_tag_ids: [],
    },
  ],
  total: 1,
};
function profile(enrollmentId, studentId, first, last, extra) {
  return Object.assign(
    {
      student: { id: studentId, first_name: first, last_name: last },
      enrollment: { id: enrollmentId, roster_position: enrollmentId === E1 ? 1 : 2, designations: [] },
      goals: {},
      reflections: {},
      section_overrides: {},
      is_flagged: false,
      recent_observations: [],
    },
    extra,
  );
}
const profileExtras = {
  goals: { [SEC]: 'Ask sharper questions' },
  reflections: { [SEC]: { confidence: 3, text: 'Getting there', date: '2026-10-01' } },
  is_flagged: true,
};

function legacyServer() {
  var rows = rubricRows;
  return {
    rpc(name, payload) {
      payload = payload || {};
      var data = null;
      if (name === 'get_gradebook') {
        data = {
          course: { id: CID },
          students: students,
          assessments: [assessmentRow[A1], assessmentRow[A2]],
          categories: categories,
          modules: modules,
          cells: { [E1]: { [A1]: e1a1, [A2]: e1a2 }, [E2]: { [A1]: e2a1, [A2]: emptyCell } },
          row_summaries: {},
        };
      } else if (name === 'get_learning_map') {
        data = learningMap;
      } else if (name === 'get_observations') {
        data = observations;
      } else if (name === 'get_assessment_detail') {
        var a = assessmentRow[payload.p_assessment_id];
        var cellsFor = payload.p_assessment_id === A1 ? [e1a1, e2a1] : [e1a2, emptyCell];
        data = {
          assessment: Object.assign({ course_id: CID, created_at: '2026-09-01T00:00:00Z' }, a),
          linked_tags: a.tag_ids.map(function (id) {
            return { id: id };
          }),
          cells: [Object.assign({ enrollment_id: E1 }, cellsFor[0]), Object.assign({ enrollment_id: E2 }, cellsFor[1])],
        };
      } else if (name === 'list_course_student_profiles') {
        data = [
          profile(
            E1,
            S1,
            'Ada',
            'Lovelace',
            Object.assign({}, profileExtras, {
              overall_proficiency: 3,
              letter: null,
              counts: {},
              section_overrides: { [SEC]: { level: 4, reason: 'Conference', date: '2026-10-02', calculated: 2.9 } },
            }),
          ),
          profile(E2, S2, 'Alan', 'Turing', { overall_proficiency: null, letter: null, counts: {} }),
        ];
      }
      return Promise.resolve({ data: data, error: null });
    },
    from(table) {
      var chain = {
        select() {
          return chain;
        },
        eq() {
          return chain;
        },
        in() {
          return chain;
        },
        then(resolve) {
          return resolve({ data: rows[table] || [], error: null });
        },
      };
      return chain;
    },
  };
}

function bundleServer() {
  return {
    rpc(name) {
      if (name !== 'get_class_bundle') return Promise.resolve({ data: null, error: null });
      return Promise.resolve({
        error: null,
        data: {
          bundle_schema: 2,
          version: 7,
          gradebook: {
            course: { id: CID },
            students: students,
            assessments: [assessmentRow[A1], assessmentRow[A2]],
            categories: categories,
            modules: modules,
            tag_index: [T1, T2],
            criterion_index: [C1],
            score_rows: [
              [1, 0, null, 'late', ''],
              [0, 0, 3, null, 'Clear question'],
            ],
            tag_rows: [
              [0, 0, 1, 2, 1],
              [0, 0, 0, 3, 0],
            ],
            criterion_rows: [[0, 1, 0, 4, 0]],
          },
          learning_map: learningMap,
          rubrics: {
            rubrics: rubricRows.rubric,
            criteria: rubricRows.criterion,
            criterion_tags: rubricRows.criterion_tag,
          },
          observations: observations,
          profiles: [
            profile(
              E1,
              S1,
              'Ada',
              'Lovelace',
              Object.assign({}, profileExtras, {
                section_overrides: { [SEC]: { level: 4, reason: 'Conference', date: '2026-10-02' } },
                notes: [],
              }),
            ),
            profile(E2, S2, 'Alan', 'Turing', { notes: [] }),
          ],
          term_ratings: [],
          report_config: null,
          custom_tags: [],
        },
      });
    },
  };
}

function resetClass() {
  localStorage.clear();
  Object.keys(_DATA_KEYS).forEach(function (field) {
    delete _cache[field][CID];
  });
  _serverState = {};
  _localWrites = {};
  _refreshState = {};
  saveCourses({ [CID]: { id: CID, name: 'Science 8', gradingSystem: 'proficiency', calcMethod: 'mostRecent' } });
  if (typeof clearProfCache === 'function') clearProfCache();
}

function sortedScores(scores) {
  var out = {};
  Object.keys(scores || {})
    .sort()
    .forEach(function (sid) {
      out[sid] = (scores[sid] || [])
        .map(function (e) {
          return { assessmentId: e.assessmentId, tagId: e.tagId, score: e.score, mod: e.mod || 0, note: e.note };
        })
        .sort(function (a, b) {
          return (a.assessmentId + a.tagId).localeCompare(b.assessmentId + b.tagId);
        });
    });
  return out;
}

function overridesWithoutCalculated(overrides) {
  return JSON.parse(JSON.stringify(overrides || {}), function (key, value) {
    return key === 'calculated' ? undefined : value;
  });
}

function snapshot() {
  if (typeof clearProfCache === 'function') clearProfCache();
  return {
    students: getStudents(CID).map(function (s) {
      return [s.id, s.personId, s.firstName, s.lastName, s.isFlagged, (s.designations || []).join()];
    }),
    assessments: getAssessments(CID),
    categories: getCategories(CID),
    modules: getModules(CID),
    scores: sortedScores(getScores(CID)),
    statuses: getAssignmentStatuses(CID),
    learningMap: getLearningMap(CID),
    rubrics: getRubrics(CID),
    observations: getQuickObs(CID),
    goals: getGoals(CID),
    reflections: getReflections(CID),
    flags: getFlags(CID),
    overrides: overridesWithoutCalculated(getOverrides(CID)),
    overall: [E1, E2].map(function (sid) {
      return getOverallProficiency(CID, sid);
    }),
    tagProficiency: [E1, E2].map(function (sid) {
      return [T1, T2].map(function (tid) {
        return getTagProficiency(CID, sid, tid);
      });
    }),
  };
}

describe('get_class_bundle', () => {
  var originalGetSupabase;
  var originalUseSupabase;

  beforeEach(() => {
    originalGetSupabase = getSupabase;
    originalUseSupabase = _useSupabase;
    _useSupabase = true;
  });

  afterEach(() => {
    globalThis.getSupabase = originalGetSupabase;
    _useSupabase = originalUseSupabase;
    globalThis.__FV_CLASS_BUNDLE = false;
    _classBundleMissing = false;
  });

  it('leaves the same cache and grades as the separate reads', async () => {
    resetClass();
    globalThis.__FV_CLASS_BUNDLE = false;
    globalThis.getSupabase = legacyServer;
    // Twice: on a device's first load the separate reads map rubric scores
    // before the rubrics arrive and key one by its criterion id. The second
    // load is their steady state.
    await initData(CID);
    await initData(CID);
    var legacy = snapshot();

    resetClass();
    globalThis.__FV_CLASS_BUNDLE = true;
    globalThis.getSupabase = bundleServer;
    await initData(CID);
    var bundled = snapshot();

    expect(bundled.students).toEqual(legacy.students);
    expect(bundled.assessments).toEqual(legacy.assessments);
    expect(bundled.categories).toEqual(legacy.categories);
    expect(bundled.modules).toEqual(legacy.modules);
    expect(bundled.scores).toEqual(legacy.scores);
    expect(bundled.statuses).toEqual(legacy.statuses);
    expect(bundled.learningMap).toEqual(legacy.learningMap);
    expect(bundled.rubrics).toEqual(legacy.rubrics);
    expect(bundled.observations).toEqual(legacy.observations);
    expect(bundled.goals).toEqual(legacy.goals);
    expect(bundled.reflections).toEqual(legacy.reflections);
    expect(bundled.flags).toEqual(legacy.flags);
    expect(bundled.overrides).toEqual(legacy.overrides);
    expect(bundled.overall).toEqual(legacy.overall);
    expect(bundled.tagProficiency).toEqual(legacy.tagProficiency);
  });

  it('maps rubric scores through the rubrics on the very first load', async () => {
    resetClass();
    globalThis.__FV_CLASS_BUNDLE = true;
    globalThis.getSupabase = bundleServer;
    await initData(CID);
    var keys = (getScores(CID)[E1] || []).map(function (e) {
      return e.tagId;
    });
    expect(keys).toContain(T1);
    expect(keys).not.toContain(C1);
  });

  it('loads a class in one request and records its version', async () => {
    resetClass();
    globalThis.__FV_CLASS_BUNDLE = true;
    var calls = [];
    globalThis.getSupabase = function () {
      var server = bundleServer();
      return {
        rpc(name, payload) {
          calls.push(name);
          return server.rpc(name, payload);
        },
      };
    };
    await initData(CID);
    expect(calls).toEqual(['get_class_bundle']);
    expect(_classVersion[CID]).toBe(7);
  });

  it('adds the observations older than the bundle carries', async () => {
    resetClass();
    globalThis.__FV_CLASS_BUNDLE = true;
    var OB2 = 'c0000000-0000-4000-8000-000000000082';
    var OB3 = 'c0000000-0000-4000-8000-000000000083';
    function older(id, day) {
      return Object.assign({}, observations.observations[0], { id: id, created_at: '2026-09-' + day + 'T10:00:00Z' });
    }
    var pages = [];
    globalThis.getSupabase = function () {
      var server = bundleServer();
      return {
        rpc(name, payload) {
          if (name === 'get_class_bundle') {
            return server.rpc(name, payload).then(function (res) {
              // The newest one is in the bundle; the class has three.
              res.data.observations = Object.assign({}, observations, { total: 3 });
              return res;
            });
          }
          if (name === 'get_observations') {
            pages.push(payload.p_page);
            var rows = [observations.observations[0], older(OB2, '20'), older(OB3, '10')];
            return Promise.resolve({ data: { observations: rows, total: 3, has_more: false }, error: null });
          }
          return server.rpc(name, payload);
        },
      };
    };
    await initData(CID);
    await _olderObservationsLoading[CID];

    expect(pages).toEqual([1]);
    var ids = getQuickObs(CID)[E1].map(function (o) {
      return o.id;
    });
    expect(ids.sort()).toEqual([OB1, OB2, OB3].sort());
  });

  it('works out the calculated level shown beside an override', async () => {
    resetClass();
    globalThis.__FV_CLASS_BUNDLE = true;
    globalThis.getSupabase = bundleServer;
    await initData(CID);
    expect(typeof getOverrides(CID)[E1][SEC].calculated).toBe('number');
  });

  it('sends a rating this device has and the server lacks', async () => {
    resetClass();
    saveTermRatings(CID, { [E1]: { 'term-1': { narrative: '<p>Curious and kind.</p>', dims: {} } } });
    _cache.termRatings[CID] = undefined;
    globalThis.__FV_CLASS_BUNDLE = true;
    var saves = [];
    globalThis.getSupabase = function () {
      var server = bundleServer();
      return {
        rpc(name, payload) {
          if (name === 'save_term_rating') saves.push(payload);
          return server.rpc(name, payload);
        },
      };
    };
    await initData(CID);
    await Promise.resolve();

    expect(getTermRatings(CID)[E1]['term-1'].narrative).toBe('<p>Curious and kind.</p>');
    expect(saves).toHaveLength(1);
    expect(saves[0].p_term).toBe(1);
    expect(saves[0].p_payload.narrative_html).toBe('<p>Curious and kind.</p>');
  });

  it('falls back to the separate reads when the server lacks the function', async () => {
    resetClass();
    globalThis.__FV_CLASS_BUNDLE = true;
    var calls = [];
    globalThis.getSupabase = function () {
      var legacy = legacyServer();
      return {
        rpc(name, payload) {
          calls.push(name);
          if (name === 'get_class_bundle') {
            return Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
          }
          return legacy.rpc(name, payload);
        },
        from: legacy.from,
      };
    };
    await initData(CID);
    expect(calls).toContain('get_gradebook');
    expect(getStudents(CID)).toHaveLength(2);
  });
});
