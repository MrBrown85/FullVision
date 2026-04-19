import './setup.js';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';

const CID = '11111111-1111-1111-1111-111111111111';
const STUDENT_ID = '33333333-3333-3333-3333-333333333333';
const ENROLLMENT_ID = '22222222-2222-2222-2222-222222222222';
const OUTCOME_ID = '44444444-4444-4444-4444-444444444444';
const ASSESSMENT_ID = '55555555-5555-5555-5555-555555555555';

function buildAssessmentRows(total) {
  var rows = [];
  for (var i = 0; i < total; i++) {
    rows.push({
      assessment_id: 'aaaaaaaa-aaaa-4aaa-8aaa-' + String(i + 1).padStart(12, '0'),
      title: 'Assessment ' + (i + 1),
      assessment_kind: 'summative',
      target_outcome_ids: [OUTCOME_ID],
      weighting: 1,
      due_at: '2026-04-18T00:00:00.000Z',
    });
  }
  return rows;
}

function makeSupabaseClient(routes) {
  routes = routes || {};
  var rpcCalls = [];

  return {
    rpcCalls: rpcCalls,
    rpc(name, payload) {
      rpcCalls.push({ name: name, payload: payload || {} });
      var handler = routes[name];
      if (!handler) return Promise.resolve({ data: [], error: null });
      var result = typeof handler === 'function' ? handler(payload || {}) : handler;
      return Promise.resolve(result);
    },
  };
}

describe('canonical initData pagination + shape bridge', () => {
  var originalGetSupabase;
  var originalUseSupabase;

  beforeEach(() => {
    originalGetSupabase = getSupabase;
    originalUseSupabase = _useSupabase;
    _useSupabase = true;
    localStorage.clear();

    [
      'students',
      'assessments',
      'scores',
      'courseConfigs',
      'learningMaps',
      'reportConfig',
      'statuses',
      'goals',
      'reflections',
      'overrides',
      'termRatings',
      'flags',
      'observations',
    ].forEach(function (field) {
      _cache[field][CID] = undefined;
    });

    COURSES[CID] = {
      id: CID,
      name: 'Science 8',
      subjectCode: 'SCI8',
    };
  });

  afterEach(() => {
    globalThis.getSupabase = originalGetSupabase;
    _useSupabase = originalUseSupabase;
  });

  it('paginates canonical assessment reads and maps canonical rows into the UI cache shape', async () => {
    var assessmentRows = buildAssessmentRows(1500);
    var client = makeSupabaseClient({
      list_course_roster() {
        return {
          data: [
            {
              enrollment_id: ENROLLMENT_ID,
              student_id: STUDENT_ID,
              first_name: 'Ada',
              last_name: 'Lovelace',
              roster_position: 1,
              local_student_number: '42',
            },
          ],
          error: null,
        };
      },
      list_course_assessments(payload) {
        var start = payload.p_offset || 0;
        var limit = payload.p_limit || 1000;
        return {
          data: assessmentRows.slice(start, start + limit),
          error: null,
        };
      },
      list_course_scores() {
        return {
          data: [
            {
              enrollment_id: ENROLLMENT_ID,
              assessment_id: ASSESSMENT_ID,
              course_outcome_id: OUTCOME_ID,
              raw_numeric_score: 3,
              comment_text: 'solid',
              entered_at: '2026-04-18T12:00:00.000Z',
            },
          ],
          error: null,
        };
      },
      list_course_observations() {
        return {
          data: [
            {
              observation_id: '66666666-6666-4666-8666-666666666666',
              enrollment_id: ENROLLMENT_ID,
              text: 'Observed strong reasoning',
              dims: ['curiosity'],
              sentiment: 'strength',
              observed_at: '2026-04-18T09:00:00.000Z',
            },
          ],
          error: null,
        };
      },
      get_course_policy() {
        return {
          data: {
            grading_system: 'proficiency',
            calculation_method: 'mostRecent',
            decay_weight: 0.65,
          },
          error: null,
        };
      },
      get_report_config() {
        return {
          data: { config: { includeSummary: true } },
          error: null,
        };
      },
      list_course_outcomes() {
        return {
          data: [
            {
              course_outcome_id: OUTCOME_ID,
              section_name: 'Questioning and Predicting',
              short_label: 'Question and Predict',
              body: 'Ask questions and make predictions.',
              color: '#0891b2',
              sort_order: 1,
            },
          ],
          error: null,
        };
      },
      list_assignment_statuses() {
        return {
          data: [{ student_id: ENROLLMENT_ID, assessment_id: ASSESSMENT_ID, status: 'late' }],
          error: null,
        };
      },
      get_student_goals() {
        return {
          data: [{ course_outcome_id: OUTCOME_ID, text: 'Ask stronger questions' }],
          error: null,
        };
      },
      list_student_reflections() {
        return {
          data: [{ course_outcome_id: OUTCOME_ID, confidence: 3, text: 'I can explain my thinking', date: '2026-04-18' }],
          error: null,
        };
      },
      list_section_overrides() {
        return {
          data: [{ course_outcome_id: OUTCOME_ID, level: 4, reason: 'Recent conference', date: '2026-04-18' }],
          error: null,
        };
      },
      list_term_ratings_for_course() {
        return {
          data: [{ student_id: STUDENT_ID, term_id: 'term1', dims: { engagement: 4 }, narrative: 'Excellent term' }],
          error: null,
        };
      },
      'projection.list_student_flags'() {
        return {
          data: [{ enrollment_id: ENROLLMENT_ID, label: 'General', color: 'red' }],
          error: null,
        };
      },
    });
    globalThis.getSupabase = function () {
      return client;
    };

    await initData(CID);

    var assessmentCalls = client.rpcCalls.filter(function (call) {
      return call.name === 'list_course_assessments';
    });

    expect(assessmentCalls).toHaveLength(2);
    expect(assessmentCalls[0].payload.p_limit).toBe(1000);
    expect(assessmentCalls[0].payload.p_offset).toBe(0);
    expect(assessmentCalls[1].payload.p_offset).toBe(1000);

    expect(getStudents(CID)).toEqual([
      expect.objectContaining({
        id: ENROLLMENT_ID,
        personId: STUDENT_ID,
        firstName: 'Ada',
        studentNumber: '42',
      }),
    ]);

    expect(getAssessments(CID)).toHaveLength(1500);
    expect(getAssessments(CID)[0]).toEqual(
      expect.objectContaining({
        id: assessmentRows[0].assessment_id,
        tagIds: [OUTCOME_ID],
      }),
    );

    expect(getScores(CID)[ENROLLMENT_ID][0]).toEqual(
      expect.objectContaining({
        assessmentId: ASSESSMENT_ID,
        tagId: OUTCOME_ID,
        score: 3,
        note: 'solid',
      }),
    );

    expect(getStudentQuickObs(CID, ENROLLMENT_ID)[0]).toEqual(
      expect.objectContaining({
        text: 'Observed strong reasoning',
        sentiment: 'strength',
      }),
    );

    expect(getCourseConfig(CID)).toEqual(
      expect.objectContaining({
        gradingSystem: 'proficiency',
        calcMethod: 'mostRecent',
        decayWeight: 0.65,
      }),
    );

    expect(getReportConfig(CID)).toEqual({ includeSummary: true });
    expect(getSections(CID)[0]).toEqual(
      expect.objectContaining({
        id: OUTCOME_ID,
        name: 'Questioning and Predicting',
      }),
    );
    expect(getAllTags(CID)[0]).toEqual(
      expect.objectContaining({
        id: OUTCOME_ID,
        label: 'Question and Predict',
      }),
    );
    expect(getAssignmentStatus(CID, ENROLLMENT_ID, ASSESSMENT_ID)).toBe('late');
    expect(getGoals(CID)[ENROLLMENT_ID][OUTCOME_ID]).toBe('Ask stronger questions');
    expect(getReflections(CID)[ENROLLMENT_ID][OUTCOME_ID].confidence).toBe(3);
    expect(getOverrides(CID)[ENROLLMENT_ID][OUTCOME_ID].level).toBe(4);
    expect(getStudentTermRating(CID, ENROLLMENT_ID, 'term1')).toEqual(
      expect.objectContaining({
        narrative: 'Excellent term',
      }),
    );
    expect(isStudentFlagged(CID, ENROLLMENT_ID)).toBe(true);
  });

  it('falls back cleanly when a read RPC is unavailable', async () => {
    localStorage.setItem(
      'gb-students-' + CID,
      JSON.stringify([{ id: 'local-stu', firstName: 'Local', lastName: 'Only' }]),
    );

    var client = makeSupabaseClient({
      list_course_roster() {
        return { data: null, error: { message: 'missing function' } };
      },
    });
    globalThis.getSupabase = function () {
      return client;
    };

    await initData(CID);

    expect(getStudents(CID)).toEqual([
      expect.objectContaining({
        id: 'local-stu',
        firstName: 'Local',
      }),
    ]);
  });
});
