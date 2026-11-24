/**
 * Quizzes through the student-submit edge function
 * (supabase/functions/student-submit/quiz-routes.ts; the contract is
 * migrations/local-test/quizzes-contract.md, "The student's side (MQ2)" and
 * "MQ3, the returned view"),
 * with a stand-in database.
 *
 * - Each route's one statement and its parameters, the hashed address in
 *   its place.
 * - A request of the wrong shape is refused before the database is asked.
 * - A reply is rebuilt from the contract's keys: a key the database adds at
 *   any level (the answer key, a competency, another student's anything)
 *   never reaches the phone.
 * - A refusal is passed on by its code, bad_answer with its question.
 */
import { describe, expect, it } from 'vitest';
import { makeHandler as makeRealHandler } from '../supabase/functions/student-submit/handler.ts';
import { tokensAtTheDatabase } from './helpers/session-hash.js';
import { ERRORS, QUIZ_ROUTES, SENT, SQL, rawAnswer } from '../supabase/functions/student-submit/quiz-routes.ts';

// The stand-in database is handed the tokens the test sent; one sent as itself fails (2026112401).
const makeHandler = tokensAtTheDatabase(makeRealHandler);

const URL_ = 'https://x.supabase.co/functions/v1/student-submit?forceFunctionRegion=ca-central-1';
const PHONE = 's'.repeat(64);
const ME = 'e1e1e1e1-0000-4000-8000-000000000001';
const OTHER_KID = 'e9e9e9e9-0000-4000-8000-000000000009';
const QZ = 'a1a1a1a1-0000-4000-8000-000000000001';
const Q1 = '91919191-0000-4000-8000-000000000001';
const Q2 = '92929292-0000-4000-8000-000000000002';
const Q3 = '93939393-0000-4000-8000-000000000003';
const C1 = 'c1c1c1c1-0000-4000-8000-000000000001';
const C2 = 'c2c2c2c2-0000-4000-8000-000000000002';
const TAG = '7a7a7a7a-0000-4000-8000-000000000007';
const AT = '2026-11-18T16:04:11.482913+00:00';
const KEY_MARK = 'ZQX-KEY-MARKER';

function setup(answer) {
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
        calls.push([sql, params]);
        if (!Object.values(SQL).includes(sql)) throw new Error('unknown statement');
        return answer(params, sql);
      },
    },
    store: null,
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

/* An answer to quiz as the contract says the database sends it. */
const QUIZ = {
  ok: true,
  quiz: { tries: 2, tries_left: 1, closed: false, closes_on: '2026-11-28' },
  try: { number: 1, sent: false, started_at: AT, sent_at: null, reopened: false },
  sent_tries: 0,
  can_answer: true,
  can_try_again: false,
  questions: [
    {
      id: Q2,
      number: 1,
      kind: 'choice',
      prompt: 'Which is a producer?',
      points: 1,
      multiple: false,
      choices: [
        { id: C2, text: 'Hawk' },
        { id: C1, text: 'Grass' },
      ],
    },
    { id: Q1, number: 2, kind: 'number', prompt: 'Half of 7?', points: 2.5, multiple: false, choices: null },
    { id: Q3, number: 3, kind: 'text', prompt: 'Explain why.', points: 3, multiple: false, choices: null },
  ],
  answers: { [Q2]: [C1], [Q1]: 3.5, [Q3]: 'Plants need light.' },
};
const OPEN = { route: 'quiz', session: PHONE, enrollment_id: ME, assessment_id: QZ };
const SAVE = { route: 'quiz-save', session: PHONE, enrollment_id: ME, assessment_id: QZ, question_id: Q1, answer: 3.5 };
const SEND = { route: 'quiz-send', session: PHONE, enrollment_id: ME, assessment_id: QZ };

describe('the routes', () => {
  it('are the five the contract names, and each names one statement, typed as the SQL takes it', () => {
    expect(Object.keys(QUIZ_ROUTES).sort()).toEqual(['quiz', 'quiz-list', 'quiz-result', 'quiz-save', 'quiz-send']);
    expect(SQL).toEqual({
      quiz: 'select student_submit.quiz($1::text, $2::uuid, $3::uuid, $4::text, $5::text::boolean) as r',
      quizSave:
        'select student_submit.quiz_save($1::text, $2::uuid, $3::uuid, $4::uuid, $5::text::jsonb, $6::text) as r',
      quizSend: 'select student_submit.quiz_send($1::text, $2::uuid, $3::uuid, $4::text) as r',
      quizList: 'select student_submit.quiz_list($1::text, $2::uuid, $3::text) as r',
      quizResult: 'select student_submit.quiz_result($1::text, $2::uuid, $3::uuid, $4::text) as r',
    });
  });

  it('the allowed keys are exactly the contract’s', () => {
    expect(SENT).toEqual({
      quiz: ['ok', 'quiz', 'try', 'sent_tries', 'can_answer', 'can_try_again', 'questions', 'answers'],
      info: ['tries', 'tries_left', 'closed', 'closes_on'],
      try: ['number', 'sent', 'started_at', 'sent_at', 'reopened'],
      question: ['id', 'number', 'kind', 'prompt', 'points', 'multiple', 'choices'],
      choice: ['id', 'text'],
      save: ['ok', 'question_id', 'saved_at'],
      send: ['ok', 'try', 'sent_at', 'tries_left', 'can_try_again'],
      list: ['ok', 'quizzes'],
      listed: ['assessment_id', 'tries_left', 'can_answer', 'closed', 'has_open_try'],
      result: ['ok', 'returned', 'shows', 'total', 'questions'],
      total: ['earned', 'possible'],
      right: ['your_answer', 'result'],
      answers: ['answer', 'why'],
    });
  });

  it('the refusals each passes on are the contract’s', () => {
    const SESSION = ['signed_out', 'not_found', 'card_stopped', 'card_expired', 'closed'];
    expect(ERRORS).toEqual({
      quiz: [...SESSION, 'quiz_closed', 'no_tries_left', 'too_many'],
      'quiz-save': [...SESSION, 'quiz_closed', 'sent', 'bad_answer', 'too_many'],
      'quiz-send': [...SESSION, 'quiz_closed', 'sent', 'too_many'],
      'quiz-list': SESSION,
      'quiz-result': SESSION,
    });
  });
});

describe('quiz', () => {
  it('asks student_submit.quiz with the session, the enrolment, the piece, the hashed address and new_try false', async () => {
    const t = setup(() => QUIZ);
    const r = await t.send(OPEN);
    expect(r).toEqual({ status: 200, body: QUIZ });
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0][0]).toBe(SQL.quiz);
    expect(t.calls[0][1].slice(0, 3)).toEqual([PHONE, ME, QZ]);
    expect(t.calls[0][1][3]).toMatch(/^[0-9a-f]{64}$/);
    expect(t.calls[0][1][4]).toBe('false');
    expect(t.calls[0][1]).toHaveLength(5);
    // The log line holds no id, word or address.
    expect(JSON.stringify(t.logs)).not.toMatch(/[0-9a-f]{8}-0000|producer|203\.0/i);
    expect(t.logs).toEqual([{ route: 'quiz', outcome: 'ok', ms: expect.any(Number) }]);
  });

  it('new_try true is sent as true; an id in capitals in lower case', async () => {
    const t = setup(() => QUIZ);
    await t.send({ ...OPEN, new_try: true, assessment_id: QZ.toUpperCase() });
    expect(t.calls[0][1][2]).toBe(QZ);
    expect(t.calls[0][1][4]).toBe('true');
  });

  it('a request of the wrong shape is bad_request and the database is not asked', async () => {
    for (const body of [
      { ...OPEN, session: undefined },
      { ...OPEN, session: 'x'.repeat(129) },
      { ...OPEN, enrollment_id: 'me' },
      { ...OPEN, assessment_id: undefined },
      { ...OPEN, assessment_id: 12 },
      { ...OPEN, new_try: 'yes' },
      { ...OPEN, new_try: null },
      { ...OPEN, new_try: 1 },
    ]) {
      const t = setup(() => QUIZ);
      expect(await t.send(body)).toEqual({ status: 400, body: { ok: false, error: 'bad_request' } });
      expect(t.calls).toEqual([]);
    }
  });

  it('with no try: try null, no questions, no answers', async () => {
    const none = {
      ...QUIZ,
      try: null,
      questions: [],
      answers: {},
      can_answer: false,
      quiz: { ...QUIZ.quiz, closed: true },
    };
    const t = setup(() => none);
    expect((await t.send(OPEN)).body).toEqual(none);
  });

  it('unlimited tries: tries 0 and tries_left null pass on', async () => {
    const u = { ...QUIZ, quiz: { tries: 0, tries_left: null, closed: false, closes_on: null } };
    expect((await setup(() => u).send(OPEN)).body).toEqual(u);
  });

  it('the key, a competency and any key the database might add, at any level, never reach the phone', async () => {
    const leaky = {
      ...QUIZ,
      key: { answer: [C1], why: KEY_MARK },
      tag_ids: [TAG],
      quiz: { ...QUIZ.quiz, shows: 'answers', counts: 'best', add_total: true },
      try: { ...QUIZ.try, marked: { earned: 7, possible: 10 }, attempt_id: OTHER_KID },
      questions: QUIZ.questions.map(q => ({
        ...q,
        tag_id: TAG,
        position: 4,
        key: { answer: [C1], tolerance: 0.1, why: KEY_MARK },
        why: KEY_MARK,
        tolerance: 0.25,
        archived_at: null,
        answered: true,
        choices: q.choices && q.choices.map(c => ({ ...c, right: c.id === C1, correct: true, order: 1 })),
      })),
      answers: { ...QUIZ.answers, [OTHER_KID]: 'not shown', given_points: 3 },
      others: [{ enrollment_id: OTHER_KID }],
    };
    const r = await setup(() => leaky).send(OPEN);
    expect(r.body).toEqual(QUIZ);
    expect(JSON.stringify(r.body)).not.toMatch(
      /ZQX|tag_id|position|tolerance|"why"|right|correct|marked|7a7a7a7a|e9e9e9e9|given/,
    );
  });

  it('every key at every level is one of the contract’s, in its order', async () => {
    const r = (await setup(() => QUIZ).send(OPEN)).body;
    expect(Object.keys(r)).toEqual(SENT.quiz);
    expect(Object.keys(r.quiz)).toEqual(SENT.info);
    expect(Object.keys(r.try)).toEqual(SENT.try);
    for (const q of r.questions) expect(Object.keys(q)).toEqual(SENT.question);
    for (const c of r.questions[0].choices) expect(Object.keys(c)).toEqual(SENT.choice);
  });

  it('values are copied only as their kind', async () => {
    const odd = {
      ...QUIZ,
      quiz: { tries: 7, tries_left: -1, closed: 'yes', closes_on: 'tomorrow' },
      try: { number: 1, sent: 'no', started_at: { x: 1 }, sent_at: null, reopened: 1 },
      sent_tries: 'many',
      can_answer: 'true',
      can_try_again: 1,
      questions: [{ ...QUIZ.questions[1], prompt: { html: '<b>' }, points: 'two', multiple: 'yes' }],
      answers: { [Q1]: { nested: true }, [Q2]: [C1] },
    };
    const r = (await setup(() => odd).send(OPEN)).body;
    expect(r).toEqual({
      ok: true,
      quiz: { tries: null, tries_left: null, closed: false, closes_on: null },
      try: { number: 1, sent: false, started_at: null, sent_at: null, reopened: false },
      sent_tries: 0,
      can_answer: false,
      can_try_again: false,
      questions: [{ id: Q1, number: 2, kind: 'number', prompt: null, points: null, multiple: false, choices: null }],
      // Q2 is not a question shown; Q1's answer is not an answer's shape.
      answers: {},
    });
  });

  it('a question with no id, an unknown kind or a choice with no id is a server error, not a broken page', async () => {
    for (const bad of [
      { ...QUIZ.questions[1], id: 'x' },
      { ...QUIZ.questions[1], kind: 'essay' },
      { ...QUIZ.questions[1], number: 0 },
      { ...QUIZ.questions[0], choices: [{ id: 'nope', text: 'Grass' }] },
    ]) {
      const r = await setup(() => ({ ...QUIZ, questions: [bad] })).send(OPEN);
      expect(r).toEqual({ status: 500, body: { ok: false, error: 'server' } });
    }
    const many = Array.from({ length: 101 }, (_, i) => ({ ...QUIZ.questions[1], number: i + 1 }));
    expect((await setup(() => ({ ...QUIZ, questions: many })).send(OPEN)).status).toBe(500);
  });

  it('a refusal passes on by its code alone; one the route does not name is not_found', async () => {
    for (const [error, said] of [
      ['signed_out', 'signed_out'],
      ['not_found', 'not_found'],
      ['closed', 'closed'],
      ['card_stopped', 'card_stopped'],
      ['card_expired', 'card_expired'],
      ['quiz_closed', 'quiz_closed'],
      ['no_tries_left', 'no_tries_left'],
      ['sent', 'not_found'],
      ['bad_answer', 'not_found'],
      ['not_yours', 'not_found'],
    ]) {
      const r = await setup(() => ({ ok: false, error, extra: OTHER_KID, question_id: Q1 })).send(OPEN);
      expect(r.body).toEqual({ ok: false, error: said });
    }
    const r = await setup(() => ({ ok: false, error: 'too_many', retry_after_s: 120, extra: 1 })).send(OPEN);
    expect(r.body).toEqual({ ok: false, error: 'too_many', retry_after_s: 120 });
  });
});

describe('quiz-save', () => {
  it('asks quiz_save with the ids, the answer as JSON and the hashed address last', async () => {
    const t = setup(() => ({ ok: true, question_id: Q1, saved_at: AT }));
    const r = await t.send(SAVE);
    expect(r).toEqual({ status: 200, body: { ok: true, question_id: Q1, saved_at: AT } });
    expect(t.calls[0][0]).toBe(SQL.quizSave);
    expect(t.calls[0][1].slice(0, 5)).toEqual([PHONE, ME, QZ, Q1, '3.5']);
    expect(t.calls[0][1][5]).toMatch(/^[0-9a-f]{64}$/);
    expect(t.logs).toEqual([{ route: 'quiz-save', outcome: 'ok', ms: expect.any(Number) }]);
    expect(JSON.stringify(t.logs)).not.toMatch(/3\.5|[0-9a-f]{8}-0000/);
  });

  it('each shape of answer goes as its JSON; null goes as no answer (it clears)', async () => {
    for (const [answer, sent] of [
      [null, null],
      [true, 'true'],
      [false, 'false'],
      [-1e12, '-1000000000000'],
      ['  Plants need light.  ', JSON.stringify('Plants need light.')],
      [[C1.toUpperCase(), C2], JSON.stringify([C1, C2])],
      [[], '[]'],
      ['', '""'],
    ]) {
      const t = setup(() => ({ ok: true, question_id: Q1, saved_at: AT }));
      expect((await t.send({ ...SAVE, answer })).status).toBe(200);
      expect(t.calls[0][1][4]).toBe(sent);
    }
  });

  it('a request of the wrong shape is bad_request and the database is not asked', async () => {
    const { answer: _gone, ...noAnswer } = SAVE;
    for (const body of [
      noAnswer,
      { ...SAVE, question_id: undefined },
      { ...SAVE, question_id: 'q1' },
      { ...SAVE, assessment_id: null },
      { ...SAVE, answer: { id: C1 } },
      { ...SAVE, answer: [C1, 'grass'] },
      { ...SAVE, answer: [[C1]] },
      { ...SAVE, answer: Array.from({ length: 21 }, () => C1) },
      { ...SAVE, answer: 'x'.repeat(20_001) },
      { ...SAVE, answer: 'a\u0000b' },
      { ...SAVE, answer: 'a\ud800b' },
      { ...SAVE, answer: 'b\udc00' },
    ]) {
      const t = setup(() => ({ ok: true, question_id: Q1, saved_at: AT }));
      expect(await t.send(body)).toEqual({ status: 400, body: { ok: false, error: 'bad_request' } });
      expect(t.calls).toEqual([]);
    }
  });

  it('a whole emoji is taken; NaN is not an answer', () => {
    expect(rawAnswer('Light 🌱')).toBe('Light 🌱');
    expect(rawAnswer(Number.NaN)).toBe(undefined);
  });

  it('a text answer is trimmed of ASCII white space as the database trims it, then refused over 5,000 characters', async () => {
    const pad = ' \t\n\v\f\r';
    // 5,000 after trimming, with white space either side: taken, and sent trimmed.
    expect(rawAnswer(pad + 'x'.repeat(5000) + pad)).toBe('x'.repeat(5000));
    expect(rawAnswer('x'.repeat(5001))).toBe(undefined);
    expect(rawAnswer(pad + 'x'.repeat(5001) + pad)).toBe(undefined);
    // Counted as PostgreSQL counts characters: one emoji is one.
    expect(rawAnswer('🌱'.repeat(5000))).toBe('🌱'.repeat(5000));
    expect(rawAnswer('🌱'.repeat(5001))).toBe(undefined);
    // A no-break space is not white space to the database: kept, and counted.
    const nbsp = String.fromCharCode(160);
    expect(rawAnswer(nbsp + 'x'.repeat(4999))).toBe(nbsp + 'x'.repeat(4999));
    expect(rawAnswer(nbsp + 'x'.repeat(5000))).toBe(undefined);
    // Blank after trimming goes on, for the database to answer bad_answer.
    expect(rawAnswer('   ')).toBe('');
    for (const [answer, status] of [
      [' ' + 'x'.repeat(5000) + '\n', 200],
      ['x'.repeat(5001), 400],
      ['  ' + 'x'.repeat(5001) + '  ', 400],
      ['🌱'.repeat(5001), 400],
    ]) {
      const t = setup(() => ({ ok: true, question_id: Q3, saved_at: AT }));
      const r = await t.send({ ...SAVE, question_id: Q3, answer });
      expect(r.status).toBe(status);
      if (status === 400) {
        expect(r.body).toEqual({ ok: false, error: 'bad_request' });
        expect(t.calls).toEqual([]);
      } else {
        expect(t.calls[0][1][4]).toBe(JSON.stringify('x'.repeat(5000)));
      }
    }
  });

  it('bad_answer passes on with its question; the other refusals by their code', async () => {
    let r = await setup(() => ({ ok: false, error: 'bad_answer', question_id: Q1, why: KEY_MARK })).send(SAVE);
    expect(r.body).toEqual({ ok: false, error: 'bad_answer', question_id: Q1 });
    r = await setup(() => ({ ok: false, error: 'too_many', retry_after_s: 60 })).send(SAVE);
    expect(r.body).toEqual({ ok: false, error: 'too_many', retry_after_s: 60 });
    for (const error of ['sent', 'quiz_closed', 'signed_out', 'closed', 'card_expired']) {
      r = await setup(() => ({ ok: false, error, question_id: Q1 })).send(SAVE);
      expect(r.body).toEqual({ ok: false, error });
    }
    r = await setup(() => ({ ok: false, error: 'no_tries_left' })).send(SAVE);
    expect(r.body).toEqual({ ok: false, error: 'not_found' });
  });

  it('a reply for another question is a server error; a key it adds is left behind', async () => {
    let r = await setup(() => ({ ok: true, question_id: Q2, saved_at: AT })).send(SAVE);
    expect(r.status).toBe(500);
    r = await setup(() => ({ ok: true, question_id: Q1, saved_at: AT, answer: 3.5, right: true })).send(SAVE);
    expect(r.body).toEqual({ ok: true, question_id: Q1, saved_at: AT });
    expect(Object.keys(r.body)).toEqual(SENT.save);
  });
});

describe('quiz-send', () => {
  it('asks quiz_send with the ids and the hashed address; passes on the try, its time and what is left', async () => {
    const t = setup(() => ({
      ok: true,
      try: 2,
      sent_at: AT,
      tries_left: 0,
      can_try_again: false,
      marked: { earned: 1 },
    }));
    const r = await t.send(SEND);
    expect(r.body).toEqual({ ok: true, try: 2, sent_at: AT, tries_left: 0, can_try_again: false });
    expect(Object.keys(r.body)).toEqual(SENT.send);
    expect(t.calls[0][0]).toBe(SQL.quizSend);
    expect(t.calls[0][1].slice(0, 3)).toEqual([PHONE, ME, QZ]);
    expect(t.calls[0][1]).toHaveLength(4);
  });

  it('unlimited: tries_left null', async () => {
    const r = await setup(() => ({ ok: true, try: 5, sent_at: AT, tries_left: null, can_try_again: true })).send(SEND);
    expect(r.body).toEqual({ ok: true, try: 5, sent_at: AT, tries_left: null, can_try_again: true });
  });

  it('a request of the wrong shape is bad_request', async () => {
    for (const body of [
      { ...SEND, session: 7 },
      { ...SEND, enrollment_id: undefined },
      { ...SEND, assessment_id: 'x' },
    ]) {
      const t = setup(() => ({ ok: true }));
      expect(await t.send(body)).toEqual({ status: 400, body: { ok: false, error: 'bad_request' } });
      expect(t.calls).toEqual([]);
    }
  });

  it('refusals pass on by their code', async () => {
    for (const [error, said] of [
      ['sent', 'sent'],
      ['quiz_closed', 'quiz_closed'],
      ['not_found', 'not_found'],
      ['bad_answer', 'not_found'],
      ['no_tries_left', 'not_found'],
    ]) {
      expect((await setup(() => ({ ok: false, error })).send(SEND)).body).toEqual({ ok: false, error: said });
    }
  });

  it('a database error is a server error, logged by its class only', async () => {
    const t = setup(() => {
      throw new Error('duplicate key value violates "quiz_attempt_one_open_idx" for ' + ME);
    });
    expect(await t.send(SEND)).toEqual({ status: 500, body: { ok: false, error: 'server' } });
    expect(JSON.stringify(t.logs)).not.toMatch(/duplicate|e1e1/);
  });
});

describe('quiz-list', () => {
  const ASK = { route: 'quiz-list', session: PHONE, enrollment_id: ME };
  const QZ2 = 'a2a2a2a2-0000-4000-8000-000000000002';
  const LISTED = {
    ok: true,
    quizzes: [
      { assessment_id: QZ, tries_left: 0, can_answer: true, closed: false, has_open_try: true },
      { assessment_id: QZ2, tries_left: null, can_answer: false, closed: true, has_open_try: false },
    ],
  };

  it('asks student_submit.quiz_list with the session, the enrolment and the hashed address, and passes the list on', async () => {
    const t = setup(() => LISTED);
    const r = await t.send(ASK);
    expect(r).toEqual({ status: 200, body: LISTED });
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0][0]).toBe(SQL.quizList);
    expect(t.calls[0][1].slice(0, 2)).toEqual([PHONE, ME]);
    expect(t.calls[0][1][2]).toMatch(/^[0-9a-f]{64}$/);
    expect(t.calls[0][1]).toHaveLength(3);
    expect(t.logs).toEqual([{ route: 'quiz-list', outcome: 'ok', ms: expect.any(Number) }]);
    expect(JSON.stringify(t.logs)).not.toMatch(/[0-9a-f]{8}-0000/);
    expect(Object.keys(r.body)).toEqual(SENT.list);
    for (const q of r.body.quizzes) expect(Object.keys(q)).toEqual(SENT.listed);
  });

  it('an assessment_id it does not need is not sent, and an empty class answers an empty list', async () => {
    const t = setup(() => ({ ok: true, quizzes: [] }));
    expect((await t.send({ ...ASK, assessment_id: QZ })).body).toEqual({ ok: true, quizzes: [] });
    expect(t.calls[0][1]).toHaveLength(3);
  });

  it('a request of the wrong shape is bad_request and the database is not asked', async () => {
    for (const body of [
      { ...ASK, session: undefined },
      { ...ASK, session: 'x'.repeat(129) },
      { ...ASK, enrollment_id: 'me' },
    ]) {
      const t = setup(() => LISTED);
      expect(await t.send(body)).toEqual({ status: 400, body: { ok: false, error: 'bad_request' } });
      expect(t.calls).toEqual([]);
    }
  });

  it('the key, a competency, another student or any key the database might add never reaches the phone', async () => {
    const leaky = {
      ...LISTED,
      key: KEY_MARK,
      enrollment_ids: [OTHER_KID],
      quizzes: LISTED.quizzes.map(q => ({
        ...q,
        why: KEY_MARK,
        tag_id: TAG,
        questions: [Q1],
        marked: { earned: 1 },
        attempt_id: OTHER_KID,
      })),
    };
    const r = await setup(() => leaky).send(ASK);
    expect(r.body).toEqual(LISTED);
    expect(JSON.stringify(r.body)).not.toMatch(/ZQX|tag_id|questions|marked|7a7a7a7a|e9e9e9e9|91919191/);
  });

  it('values are copied only as their kind; an entry with no id is a server error', async () => {
    const odd = {
      ok: true,
      quizzes: [{ assessment_id: QZ.toUpperCase(), tries_left: -1, can_answer: 'yes', closed: 1, has_open_try: null }],
    };
    expect((await setup(() => odd).send(ASK)).body).toEqual({
      ok: true,
      quizzes: [{ assessment_id: QZ, tries_left: null, can_answer: false, closed: false, has_open_try: false }],
    });
    expect((await setup(() => ({ ok: true, quizzes: [{ tries_left: 1 }] })).send(ASK)).status).toBe(500);
    const many = Array.from({ length: 1001 }, () => LISTED.quizzes[0]);
    expect((await setup(() => ({ ok: true, quizzes: many })).send(ASK)).status).toBe(500);
  });

  it('the session refusals pass on by their code; any other is not_found', async () => {
    for (const [error, said] of [
      ['signed_out', 'signed_out'],
      ['not_found', 'not_found'],
      ['closed', 'closed'],
      ['card_stopped', 'card_stopped'],
      ['card_expired', 'card_expired'],
      ['quiz_closed', 'not_found'],
      ['too_many', 'not_found'],
    ]) {
      expect((await setup(() => ({ ok: false, error, retry_after_s: 5 })).send(ASK)).body).toEqual({
        ok: false,
        error: said,
      });
    }
  });
});

describe('quiz-result', () => {
  const ASK = { route: 'quiz-result', session: PHONE, enrollment_id: ME, assessment_id: QZ };
  const Q4 = '94949494-0000-4000-8000-000000000004';
  /* A returned view, as the contract says the database sends it with shows answers and Add a Total. */
  const VIEW = {
    ok: true,
    returned: true,
    shows: 'answers',
    total: { earned: 4.5, possible: 9 },
    questions: [
      { ...QUIZ.questions[0], your_answer: [C2], result: 'wrong', answer: [C1], why: 'Because ' + KEY_MARK },
      { ...QUIZ.questions[1], your_answer: 3, result: 'wrong', answer: 31415.9265, why: null },
      { ...QUIZ.questions[2], your_answer: 'Plants need light.', result: 'partly', answer: null, why: KEY_MARK },
      {
        id: Q4,
        number: 4,
        kind: 'true_false',
        prompt: 'Plants make food.',
        points: 1,
        multiple: false,
        choices: null,
        your_answer: null,
        result: null,
        answer: true,
        why: null,
      },
    ],
  };
  const right = v => ({
    ...v,
    shows: 'right',
    questions: v.questions.map(({ answer: _a, why: _w, ...q }) => q),
  });

  it('asks student_submit.quiz_result with the session, the enrolment, the piece and the hashed address', async () => {
    const t = setup(() => VIEW);
    const r = await t.send(ASK);
    expect(r).toEqual({ status: 200, body: VIEW });
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0][0]).toBe(SQL.quizResult);
    expect(t.calls[0][1].slice(0, 3)).toEqual([PHONE, ME, QZ]);
    expect(t.calls[0][1][3]).toMatch(/^[0-9a-f]{64}$/);
    expect(t.calls[0][1]).toHaveLength(4);
    expect(t.logs).toEqual([{ route: 'quiz-result', outcome: 'ok', ms: expect.any(Number) }]);
    // The log line holds no id, word, answer or address.
    expect(JSON.stringify(t.logs)).not.toMatch(/[0-9a-f]{8}-0000|ZQX|producer|31415|203\.0/i);
  });

  it('every key at every level is one of the contract’s, in its order', async () => {
    const r = (await setup(() => VIEW).send(ASK)).body;
    expect(Object.keys(r)).toEqual(SENT.result);
    expect(Object.keys(r.total)).toEqual(SENT.total);
    for (const q of r.questions) expect(Object.keys(q)).toEqual([...SENT.question, ...SENT.right, ...SENT.answers]);
    for (const c of r.questions[0].choices) expect(Object.keys(c)).toEqual(SENT.choice);
  });

  it('not returned is exactly ok and returned false, whatever else the database sends', async () => {
    for (const said of [
      { ok: true, returned: false },
      { ok: true, returned: false, shows: 'answers', total: VIEW.total, questions: VIEW.questions, key: KEY_MARK },
      { ok: true, shows: 'answers', questions: VIEW.questions },
      { ok: true, returned: 'true', shows: 'answers', questions: VIEW.questions },
    ]) {
      const r = await setup(() => said).send(ASK);
      expect(r).toEqual({ status: 200, body: { ok: true, returned: false } });
      expect(JSON.stringify(r.body)).not.toMatch(/ZQX|31415|questions|total/);
    }
  });

  it('shows right: each question with your_answer and result, never the key’s answer or why', async () => {
    const r = await setup(() => ({ ...VIEW, shows: 'right' })).send(ASK);
    expect(r.body).toEqual(right(VIEW));
    for (const q of r.body.questions) expect(Object.keys(q)).toEqual([...SENT.question, ...SENT.right]);
    expect(JSON.stringify(r.body)).not.toMatch(/ZQX|31415|"answer"|"why"/);
  });

  it('shows grade: no questions at all, even when the database sends them', async () => {
    const r = await setup(() => ({ ...VIEW, shows: 'grade' })).send(ASK);
    expect(r.body).toEqual({ ok: true, returned: true, shows: 'grade', total: VIEW.total });
    expect(JSON.stringify(r.body)).not.toMatch(/ZQX|31415|questions|your_answer|result/);
    const { total: _t, ...noTotal } = VIEW;
    const g = await setup(() => ({ ...noTotal, shows: 'grade' })).send(ASK);
    expect(g.body).toEqual({ ok: true, returned: true, shows: 'grade' });
  });

  it('no total without Add a Total', async () => {
    const { total: _t, ...noTotal } = VIEW;
    const r = await setup(() => noTotal).send(ASK);
    expect(r.body).toEqual(noTotal);
    expect(Object.keys(r.body)).toEqual(['ok', 'returned', 'shows', 'questions']);
  });

  it('a key the database might add, at any level, never reaches the phone', async () => {
    const leaky = {
      ...VIEW,
      grade: { level: 3 },
      marked: { earned: 4.5 },
      attempt_id: OTHER_KID,
      total: { ...VIEW.total, questions: { [Q1]: { earned: 0 } } },
      questions: VIEW.questions.map(q => ({
        ...q,
        tolerance: 0.0271828,
        tag_id: TAG,
        position: 3,
        given_points: 2,
        note: 'ZQX-NOTE',
        earned: 1,
        choices: q.choices && q.choices.map(c => ({ ...c, right: c.id === C1, order: 1 })),
      })),
      others: [{ enrollment_id: OTHER_KID }],
    };
    const r = await setup(() => leaky).send(ASK);
    expect(r.body).toEqual(VIEW);
    expect(JSON.stringify(r.body)).not.toMatch(
      /0\.0271828|tag_id|position|given_points|NOTE|marked|"earned":1,|7a7a7a7a|e9e9e9e9|"grade"/,
    );
  });

  it('values are copied only as their kind', async () => {
    const odd = {
      ...VIEW,
      total: { earned: '4.5', possible: null },
      questions: [
        {
          ...VIEW.questions[1],
          your_answer: { nested: true },
          result: 'excellent',
          answer: 'the answer in words',
          why: { html: '<b>' },
        },
        { ...VIEW.questions[3], your_answer: [Q1, 'x'], result: 7, answer: [C1] },
      ],
    };
    const r = (await setup(() => odd).send(ASK)).body;
    expect(r).toEqual({
      ok: true,
      returned: true,
      shows: 'answers',
      total: { earned: null, possible: null },
      questions: [
        { ...QUIZ.questions[1], your_answer: null, result: null, answer: null, why: null },
        { ...VIEW.questions[3], your_answer: null, result: null, answer: [C1], why: null },
      ],
    });
  });

  it('an unknown shows, a question with no id or an unknown kind is a server error, not a broken page', async () => {
    for (const said of [
      { ...VIEW, shows: 'everything' },
      { ...VIEW, shows: null },
      { ...VIEW, questions: [{ ...VIEW.questions[0], id: 'x' }] },
      { ...VIEW, questions: [{ ...VIEW.questions[0], kind: 'essay' }] },
      { ...VIEW, questions: Array.from({ length: 101 }, (_, i) => ({ ...VIEW.questions[3], number: i + 1 })) },
    ]) {
      expect(await setup(() => said).send(ASK)).toEqual({ status: 500, body: { ok: false, error: 'server' } });
    }
  });

  it('a request of the wrong shape is bad_request and the database is not asked', async () => {
    for (const body of [
      { ...ASK, session: undefined },
      { ...ASK, session: 'x'.repeat(129) },
      { ...ASK, enrollment_id: 'me' },
      { ...ASK, assessment_id: undefined },
      { ...ASK, assessment_id: 12 },
    ]) {
      const t = setup(() => VIEW);
      expect(await t.send(body)).toEqual({ status: 400, body: { ok: false, error: 'bad_request' } });
      expect(t.calls).toEqual([]);
    }
  });

  it('a refusal passes on by its code alone; one the route does not name is not_found', async () => {
    for (const [error, said] of [
      ['signed_out', 'signed_out'],
      ['not_found', 'not_found'],
      ['closed', 'closed'],
      ['card_stopped', 'card_stopped'],
      ['card_expired', 'card_expired'],
      ['quiz_closed', 'not_found'],
      ['too_many', 'not_found'],
      ['not_returned', 'not_found'],
    ]) {
      const r = await setup(() => ({ ok: false, error, questions: VIEW.questions, retry_after_s: 5 })).send(ASK);
      expect(r.body).toEqual({ ok: false, error: said });
    }
  });
});
