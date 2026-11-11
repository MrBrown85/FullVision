/**
 * Student questionnaire server calls in shared/data.js
 * (migrations/20261025_questionnaires_tables_and_functions.sql):
 *
 *   listQuestionnaireTemplates / listCourseQuestionnaires / listCourseResponses
 *   upsertQuestionnaire / setQuestionnaireOn / deleteQuestionnaire
 *   issueAccessCodes
 *
 * Each sends the RPC the migration defines with the parameters it expects,
 * every write carries an idempotency key, lists come back as arrays, and
 * slip codes come from teacher-cards (plan S3-S1), never through the outbox.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { signedIn, slipsFetch } from './helpers/teacher-cards-slips-fetch.js';

const CID = '11111111-1111-4111-8111-111111111111';
const QID = '22222222-2222-4222-8222-222222222222';
const ENR = '33333333-3333-4333-8333-333333333333';

function makeRecordingClient(answers) {
  var calls = [];
  return {
    calls: calls,
    rpc(name, payload) {
      calls.push({ name: name, payload: payload || {} });
      var data = answers && Object.prototype.hasOwnProperty.call(answers, name) ? answers[name] : null;
      return Promise.resolve({ data: data, error: null });
    },
  };
}

describe('questionnaires v2 dispatch', () => {
  var originalGetSupabase;
  var originalUseSupabase;
  var client;

  function use(answers) {
    client = makeRecordingClient(answers);
    globalThis.getSupabase = () => client;
  }

  beforeEach(() => {
    localStorage.clear();
    originalGetSupabase = getSupabase;
    originalUseSupabase = _useSupabase;
    _useSupabase = true;
    _teacherId = 'teacher-uuid';
    use();
  });

  afterEach(() => {
    globalThis.getSupabase = originalGetSupabase;
    _useSupabase = originalUseSupabase;
  });

  it('upsertQuestionnaire sends every field, a key, and null questions to copy a template', async () => {
    await window.v2.upsertQuestionnaire({
      courseId: CID,
      kind: 'core_reflection',
      title: '  November Reflection ',
      templateId: 'core-8-1',
      reportPeriod: '1',
      opensOn: '2026-11-03',
      closesOn: '2026-11-14',
    });
    var call = client.calls.find(c => c.name === 'upsert_questionnaire');
    expect(call.payload).toMatchObject({
      p_course_id: CID,
      p_kind: 'core_reflection',
      p_title: 'November Reflection',
      p_template_id: 'core-8-1',
      p_report_period: 1,
      p_opens_on: '2026-11-03',
      p_closes_on: '2026-11-14',
      p_is_on: true,
      p_questions: null,
      p_id: null,
    });
    expect(call.payload.p_idempotency_key).toBeTruthy();
  });

  it('setQuestionnaireOn and deleteQuestionnaire carry keys; a local id goes nowhere', async () => {
    await window.v2.setQuestionnaireOn(QID, false);
    await window.v2.deleteQuestionnaire(QID);
    await window.v2.deleteQuestionnaire('local-id');
    expect(client.calls.map(c => c.name)).toEqual(['set_questionnaire_on', 'delete_questionnaire']);
    expect(client.calls[0].payload).toMatchObject({ p_id: QID, p_is_on: false });
    client.calls.forEach(c => expect(c.payload.p_idempotency_key).toBeTruthy());
  });

  it('lists come back as arrays and responses as an object', async () => {
    use({
      list_questionnaire_templates: [{ id: 'about-me' }],
      list_course_questionnaires: [{ id: QID, questions: [] }],
      list_course_responses: { [QID]: { [ENR]: [] } },
    });
    expect((await window.v2.listQuestionnaireTemplates()).data).toEqual([{ id: 'about-me' }]);
    expect((await window.v2.listCourseQuestionnaires(CID)).data).toEqual([{ id: QID, questions: [] }]);
    expect((await window.v2.listCourseResponses(CID)).data).toEqual({ [QID]: { [ENR]: [] } });
  });

  // Since plan S3-S1 slips are made by teacher-cards: the database keeps only their tags.
  it('issueAccessCodes asks teacher-cards for the named students, with only server ids, and nothing is queued', async () => {
    const fake = slipsFetch({ passwords: { [ENR]: '4821' } });
    globalThis.getSupabase = () => signedIn(client);
    try {
      var res = await window.v2.issueAccessCodes(QID, [ENR, 'local-id']);
      expect(res.data).toEqual([{ enrollment_id: ENR, code: 'K7M-4QX', password: '4821' }]);
      expect(fake.bodies).toHaveLength(1);
      expect(fake.bodies[0].url).toContain('/functions/v1/teacher-cards?forceFunctionRegion=ca-central-1');
      expect(fake.bodies[0].body).toMatchObject({
        route: 'slips',
        kind: 'questionnaire',
        id: QID,
        enrollment_ids: [ENR],
      });
      expect(fake.bodies[0].body.request_id).toBeTruthy();
      expect(client.calls).toEqual([]);
      var queued = localStorage.getItem('fv-outbox') || '';
      expect(queued).not.toContain('K7M');
    } finally {
      fake.restore();
    }
  });

  it('issueAccessCodes asks for every student when none are named, and asks again after a lost reply', async () => {
    const fake = slipsFetch({ roster: [ENR], replayFirst: true });
    globalThis.getSupabase = () => signedIn(client);
    try {
      var res = await window.v2.issueAccessCodes(QID);
      expect(fake.bodies[0].body.enrollment_ids).toBeNull();
      expect(fake.bodies).toHaveLength(2);
      expect(fake.bodies[1].body.request_id).not.toBe(fake.bodies[0].body.request_id);
      expect(res.data).toEqual([{ enrollment_id: ENR, code: 'K7M-4QX' }]);
    } finally {
      fake.restore();
    }
  });
});
