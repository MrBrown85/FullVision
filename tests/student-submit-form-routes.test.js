/**
 * Questionnaires and phone reports from the student's card (Batch E, E2;
 * supabase/functions/student-submit/forms-routes.ts): forms, form, answer
 * and report, through the whole handler with a stand-in database. The rules
 * are in SQL (migrations/2026111150_student_page_last_changes.sql, proved
 * by migrations/local-test/batch_e.py). This checks what the function
 * adds: the session and the request's shape first, the hashed address
 * last, each reply copied field by field, refusals by their code with only
 * the field the SQL gives them, and logs with nothing about the student.
 */
import { describe, expect, it } from 'vitest';
import { makeHandler } from '../supabase/functions/student-submit/handler.ts';
import { SQL } from '../supabase/functions/student-submit/forms-routes.ts';

const URL_ = 'https://x.supabase.co/functions/v1/student-submit?forceFunctionRegion=ca-central-1';
const PHONE = 's'.repeat(64);
const CECE = 'e1e1e1e1-0000-4000-8000-000000000001';
const Q = 'b1b1b1b1-0000-4000-8000-000000000001';
const Q2 = 'b2b2b2b2-0000-4000-8000-000000000002';
const QUESTION = 'c1c1c1c1-0000-4000-8000-000000000001';
const REPORT = 'd1d1d1d1-0000-4000-8000-000000000001';
const BY_SQL = Object.fromEntries(Object.entries(SQL).map(([k, v]) => [v, k]));

const FORMS = {
  ok: true,
  v: 1,
  teacher_name: 'Mr. Brown',
  questionnaires: [
    {
      id: Q,
      title: 'November Reflection',
      description: 'Core Competencies',
      minutes: null,
      state: 'open',
      opens_on: '2026-11-01',
      closes_on: '2026-11-20',
      sent_at: null,
      template_id: 'core-8-1',
    },
  ],
  reports: [
    {
      id: REPORT,
      title: 'Report 1',
      issued_at: '2026-11-10T20:00:00Z',
      expires_on: '2026-12-10',
      opened_at: null,
      overall: { word: 'Proficient', text: 'Steady.', level: 3, draft: 4 },
      comment: ['Keep reading.', 7],
      data: { name: 'Cece Learner' },
    },
  ],
};
const FORM = {
  ok: true,
  parts: [
    {
      id: Q,
      kind: 'core_reflection',
      title: 'November Reflection',
      theme: 'x',
      closes_on: '2026-11-20',
      grade: 8,
      course_id: 'secret',
      questions: [
        {
          id: QUESTION,
          prompt: 'What went well?',
          prompt_translations: { fr: 'Quoi?', bad: 3 },
          kind: 'text',
          options: { labels: ['A'] },
          core_ids: ['CT', 4],
          teacher_only: false,
          archived: false,
        },
      ],
    },
  ],
  context: { course_goal: { text: 'Read more', at: '2026-10-01T00:00:00Z', response_id: 'x' } },
};

function setup(answers = {}) {
  const calls = [];
  const logs = [];
  const handle = makeHandler({
    region: 'ca-central-1',
    ipKey: 'k',
    db: {
      open: async () => ({}),
      verify: async () => ({}),
      check: async () => ({}),
      submit: async () => ({}),
      call: async (sql, params) => {
        const name = BY_SQL[sql];
        calls.push([name || sql, params]);
        if (!name) throw new Error('unknown statement');
        if (answers[name]) return answers[name](params);
        return {
          forms: FORMS,
          form: FORM,
          answer: { ok: true, submitted_at: 'now' },
          report: { ok: true, report: { overall: { word: 'Proficient' } } },
        }[name];
      },
    },
    log: e => logs.push(e),
  });
  const send = async body => {
    const res = await handle(
      new Request(URL_, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7' },
        body: JSON.stringify(body),
      }),
    );
    return { status: res.status, body: await res.json() };
  };
  return { send, calls, logs };
}

const BASE = { session: PHONE, enrollment_id: CECE };
const ROUTES = {
  forms: { route: 'forms', ...BASE },
  form: { route: 'form', ...BASE, questionnaire_id: Q },
  answer: { route: 'answer', ...BASE, questionnaire_id: Q, answers: { [QUESTION]: 'I listened more.' } },
  report: { route: 'report', ...BASE, report_id: REPORT },
};

describe('every route', () => {
  it.each(Object.keys(ROUTES))(
    '%s: no session, a session of the wrong shape, or no enrollment id asks nothing',
    async route => {
      for (const over of [
        { session: undefined },
        { session: 'a'.repeat(129) },
        { enrollment_id: 'CECE' },
        { enrollment_id: undefined },
      ]) {
        const t = setup();
        expect(await t.send({ ...ROUTES[route], ...over })).toEqual({
          status: 400,
          body: { ok: false, error: 'bad_request' },
        });
        expect(t.calls).toEqual([]);
      }
    },
  );

  it.each(Object.keys(ROUTES))('%s: the session and enrollment first, the hashed address last', async route => {
    const t = setup();
    await t.send(ROUTES[route]);
    const [, params] = t.calls[0];
    expect(params.slice(0, 2)).toEqual([PHONE, CECE]);
    expect(params[params.length - 1]).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(t.calls)).not.toContain('203.0.113.7');
  });

  it.each(Object.keys(ROUTES))(
    '%s: a session refusal is passed on, and one the route does not list is not_found',
    async route => {
      const t = setup({ [route]: () => ({ ok: false, error: 'signed_out' }) });
      expect((await t.send(ROUTES[route])).body).toEqual({ ok: false, error: 'signed_out' });
      const u = setup({ [route]: () => ({ ok: false, error: 'teacher_said_no', teacher_name: 'Mr. Brown' }) });
      expect((await u.send(ROUTES[route])).body).toEqual({ ok: false, error: 'not_found' });
    },
  );

  it.each(Object.keys(ROUTES))('%s: 22023 from the database is a plain server error', async route => {
    const raise = () => {
      const e = new Error('invalid_parameter_value');
      e.code = '22023';
      throw e;
    };
    const t = setup({ [route]: raise });
    expect(await t.send(ROUTES[route])).toEqual({ status: 500, body: { ok: false, error: 'server' } });
  });
});

describe('forms', () => {
  it('copies the two lists field by field: no teacher name, no other field of the report', async () => {
    const t = setup();
    const r = await t.send(ROUTES.forms);
    expect(r.body).toEqual({
      ok: true,
      v: 1,
      questionnaires: [
        {
          id: Q,
          title: 'November Reflection',
          description: 'Core Competencies',
          minutes: null,
          state: 'open',
          opens_on: '2026-11-01',
          closes_on: '2026-11-20',
          sent_at: null,
        },
      ],
      reports: [
        {
          id: REPORT,
          title: 'Report 1',
          issued_at: '2026-11-10T20:00:00Z',
          expires_on: '2026-12-10',
          opened_at: null,
          overall: { word: 'Proficient', text: 'Steady.', level: 3 },
          comment: ['Keep reading.'],
        },
      ],
    });
  });
});

describe('form', () => {
  it('copies the parts and questions as the slip screens read them; a question id is the only id sent', async () => {
    const t = setup();
    const r = await t.send(ROUTES.form);
    expect(r.body).toEqual({
      ok: true,
      parts: [
        {
          id: Q,
          kind: 'core_reflection',
          title: 'November Reflection',
          theme: 'x',
          closes_on: '2026-11-20',
          grade: 8,
          questions: [
            {
              id: QUESTION,
              prompt: 'What went well?',
              kind: 'text',
              teacher_only: false,
              prompt_translations: { fr: 'Quoi?' },
              options: { labels: ['A'] },
              core_ids: ['CT'],
            },
          ],
        },
      ],
      context: { course_goal: { text: 'Read more', at: '2026-10-01T00:00:00Z' } },
    });
    expect(t.calls[0][1].slice(0, 3)).toEqual([PHONE, CECE, Q]);
  });

  it('passes on already_sent, closed, card_locked, and not_open_yet with its date only', async () => {
    for (const [said, sent] of [
      [
        { ok: false, error: 'already_sent' },
        { ok: false, error: 'already_sent' },
      ],
      [
        { ok: false, error: 'closed' },
        { ok: false, error: 'closed' },
      ],
      [
        { ok: false, error: 'card_locked' },
        { ok: false, error: 'card_locked' },
      ],
      [
        { ok: false, error: 'not_open_yet', opens_on: '2026-12-01', x: 1 },
        { ok: false, error: 'not_open_yet', opens_on: '2026-12-01' },
      ],
      [
        { ok: false, error: 'not_open_yet', opens_on: 'soon' },
        { ok: false, error: 'not_open_yet', opens_on: null },
      ],
    ]) {
      const t = setup({ form: () => said });
      expect((await t.send(ROUTES.form)).body).toEqual(sent);
    }
  });

  it('no questionnaire id, or one of the wrong shape, asks nothing', async () => {
    for (const questionnaire_id of [undefined, null, 'Q', 5]) {
      const t = setup();
      expect((await t.send({ ...ROUTES.form, questionnaire_id })).status).toBe(400);
      expect(t.calls).toEqual([]);
    }
  });
});

describe('answer', () => {
  it('passes the answers on as JSON and copies only when it was sent', async () => {
    const t = setup({ answer: () => ({ ok: true, submitted_at: '2026-11-11T20:00:00Z', response_id: 'x' }) });
    const r = await t.send(ROUTES.answer);
    expect(r.body).toEqual({ ok: true, submitted_at: '2026-11-11T20:00:00Z' });
    const params = t.calls[0][1];
    expect(params.slice(0, 3)).toEqual([PHONE, CECE, Q]);
    expect(JSON.parse(params[3])).toEqual({ [QUESTION]: 'I listened more.' });
  });

  it('refuses answers the SQL could not take, before asking', async () => {
    const many = Object.fromEntries(Array.from({ length: 81 }, (_, i) => ['k' + i, 'x']));
    for (const answers of [
      undefined,
      null,
      'text',
      [QUESTION],
      many,
      { [QUESTION]: 'x'.repeat(100_001) },
      { [QUESTION]: 'a\u0000b' },
      { [QUESTION]: 'a\ud800b' },
    ]) {
      const t = setup();
      const r = await t.send({ ...ROUTES.answer, answers });
      expect(r.status, String(JSON.stringify(answers)).slice(0, 40)).toBe(400);
      expect(t.calls).toEqual([]);
    }
  });

  it('passes on already_sent, invalid with its question, empty and too_many with its wait', async () => {
    for (const [said, sent] of [
      [
        { ok: false, error: 'already_sent' },
        { ok: false, error: 'already_sent' },
      ],
      [
        { ok: false, error: 'invalid', question_id: QUESTION },
        { ok: false, error: 'invalid', question_id: QUESTION },
      ],
      [
        { ok: false, error: 'invalid', question_id: 'not-an-id' },
        { ok: false, error: 'invalid' },
      ],
      [
        { ok: false, error: 'empty' },
        { ok: false, error: 'empty' },
      ],
      [
        { ok: false, error: 'too_many', retry_after_s: 600 },
        { ok: false, error: 'too_many', retry_after_s: 600 },
      ],
    ]) {
      const t = setup({ answer: () => said });
      expect((await t.send(ROUTES.answer)).body).toEqual(sent);
    }
  });
});

describe('report', () => {
  it("passes the student's report on whole, as the slip's check does", async () => {
    const data = {
      name: 'Cece Learner',
      overall: { word: 'Proficient', text: 'Steady.', level: 3 },
      comment: ['Keep reading.'],
    };
    const t = setup({ report: () => ({ ok: true, report: data, enrollment_id: CECE }) });
    expect((await t.send(ROUTES.report)).body).toEqual({ ok: true, report: data });
    expect(t.calls[0][1].slice(0, 3)).toEqual([PHONE, CECE, REPORT]);
  });

  it('passes on report_closed; a report id of the wrong shape asks nothing', async () => {
    const t = setup({ report: () => ({ ok: false, error: 'report_closed' }) });
    expect((await t.send(ROUTES.report)).body).toEqual({ ok: false, error: 'report_closed' });
    const u = setup();
    expect((await u.send({ ...ROUTES.report, report_id: 'R1' })).status).toBe(400);
    expect(u.calls).toEqual([]);
  });
});

describe('the logs', () => {
  it('a run of every route logs no token, id, word a student wrote, or report', async () => {
    const t = setup();
    for (const body of Object.values(ROUTES)) await t.send(body);
    await t.send({ ...ROUTES.form, questionnaire_id: Q2 });
    const text = JSON.stringify(t.logs);
    for (const v of [PHONE, CECE, Q, Q2, QUESTION, REPORT, 'listened', 'Proficient', 'Reflection'])
      expect(text, v).not.toContain(v);
    expect(t.logs.every(l => Object.keys(l).every(k => ['route', 'outcome', 'ms', 'kind'].includes(k)))).toBe(true);
  });
});
