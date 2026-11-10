/**
 * The student card's routes on the student-submit edge function
 * (supabase/functions/student-submit/card-routes.ts): card, verify for a
 * card, add-card, page, seen and done, with a stand-in database.
 *
 * The rules live in SQL (migrations/2026110904_student_sessions_page.sql,
 * tested in migrations/local-test/). This checks what the function adds:
 * each route calls its one student_submit function and nothing else, every
 * refusal the SQL can give reaches the phone as it is, the session token is
 * asked for and never logged, and a reply is copied field by field, so a
 * draft the database sent by mistake stops here.
 *
 * The four slip routes are in tests/student-submit-handler.test.js.
 */
import { describe, expect, it } from 'vitest';
import { makeHandler } from '../supabase/functions/student-submit/handler.ts';
import { CARD_ROUTES } from '../supabase/functions/student-submit/card-routes.ts';

const CODE = 'P3R-8WD';
const SLIP = 'K7M-4QX'; // a live questionnaire slip's code, typed where a card goes
const SESSION = 'a'.repeat(64); // this phone, signed in to Cece's Science 8
const OTHER_DEVICE = 'b'.repeat(64); // another phone, signed in to another student
const ENDED = 'c'.repeat(64); // a session that ended on Done or at midnight
const NEW_SESSION = 'd'.repeat(64);
const EXPIRES = '2026-11-10T08:00:00+00:00';

const CECE = '11111111-1111-4111-8111-111111111111'; // enrollment ids
const OMAR = '22222222-2222-4222-8222-222222222222';
const TAG = '33333333-3333-4333-8333-333333333333';
const RUBRIC = '44444444-4444-4444-8444-444444444444';
const CRITERION = '55555555-5555-4555-8555-555555555555';
const CHECK = '66666666-6666-4666-8666-666666666666';
const QUIZ = '77777777-7777-4777-8777-777777777777';
const LAB = '88888888-8888-4888-8888-888888888888';
const ESSAY = '99999999-9999-4999-8999-999999999999';

const CLASSES = [{ enrollment_id: CECE, student: { first_name: 'Cece' }, course: { name: 'Science 8', block: 'B' } }];

const CARD_OK = {
  ok: true,
  kind: 'card',
  student: { first_name: 'Cece' },
  course: { name: 'Science 8', block: 'B' },
  check: 'identity',
  also_password: false,
};

// A copy of a grade, as student_submit._returned_grade gives it.
const LAB_GRADE = {
  v: 1,
  value: null,
  modifier: 0,
  comment: 'Clear method.',
  tags: { [TAG]: { value: 3, modifier: 1, comment: null } },
  criteria: { [CRITERION]: { value: 3, modifier: 0, comment: 'Number the steps', beyond: null } },
  checks: [CHECK],
};
const LAB_BEFORE = {
  v: 1,
  value: null,
  modifier: 0,
  comment: null,
  tags: { [TAG]: { value: 2, modifier: 0, comment: null } },
  criteria: {},
  checks: [],
};

// The page as student_submit.page gives it: every field, nothing else.
const PAGE_OK = {
  ok: true,
  v: 1,
  expires_at: EXPIRES,
  student: { enrollment_id: CECE, first_name: 'Cece' },
  course: {
    name: 'Science 8',
    block: 'B',
    grading_system: 'proficiency',
    grading_scale: { boundaries: [1.5, 2.5, 3.5], percents: { 1: 40, 2: 62, 3: 78, 4: 93 } },
    level_order: 'desc',
    round_percent: null,
  },
  classes: CLASSES,
  tags: { [TAG]: { label: 'Ask questions', code: 'Q1' } },
  rubrics: [
    {
      id: RUBRIC,
      name: 'Lab Report',
      style: 'advanced',
      criteria: [
        {
          id: CRITERION,
          name: 'Method',
          weight: 1,
          level_1_value: 1,
          level_2_value: 2,
          level_3_value: 3,
          level_4_value: 4,
          level_1_descriptor: null,
          level_2_descriptor: null,
          level_3_descriptor: 'Lists every step',
          level_4_descriptor: null,
          checks: [{ id: CHECK, level: 3, label: 'Lists every step' }],
        },
      ],
    },
  ],
  assessments: [
    {
      id: QUIZ,
      title: 'Quiz 1',
      date: '2026-10-27',
      due_date: null,
      score_mode: 'points',
      max_points: 10,
      weight: 1,
      rubric_id: null,
      tag_ids: [],
      status: null,
      returned_at: '2026-11-03T20:15:00+00:00',
      updated_at: null,
      seen_at: null,
      grade: { v: 1, value: 7, modifier: 0, comment: 'Careful work.', tags: {}, criteria: {}, checks: [] },
      previous: null,
    },
    {
      id: LAB,
      title: 'Energy Transfer Investigation',
      date: '2026-10-28',
      due_date: '2026-10-30',
      score_mode: 'proficiency',
      max_points: null,
      weight: 1,
      rubric_id: RUBRIC,
      tag_ids: [TAG],
      status: 'LATE',
      returned_at: '2026-11-05T18:00:00+00:00',
      updated_at: '2026-11-05T18:00:00+00:00',
      seen_at: '2026-11-04T17:00:00+00:00',
      grade: LAB_GRADE,
      previous: LAB_BEFORE,
    },
    // Never returned. A draft may be waiting; nothing here says so.
    {
      id: ESSAY,
      title: 'Essay',
      date: null,
      due_date: null,
      score_mode: 'proficiency',
      max_points: null,
      weight: 1,
      rubric_id: null,
      tag_ids: [TAG],
      status: 'NS',
      returned_at: null,
      updated_at: null,
      seen_at: null,
      grade: null,
      previous: null,
    },
  ],
};

const clone = v => JSON.parse(JSON.stringify(v));

/* A stand-in for the database. It takes the statement and its parameters,
   as index.ts hands them to Postgres, and answers as the SQL would for one
   live card and two signed-in phones. `answers` replaces a function's reply. */
function setup(answers, overrides) {
  const calls = [];
  const logs = [];
  const slip = [];
  const sessions = { [SESSION]: [CECE], [OTHER_DEVICE]: [OMAR] };
  const inSession = (token, enrollment) =>
    !sessions[token] ? 'signed_out' : sessions[token].includes(enrollment) ? null : 'not_found';
  const sql = Object.assign(
    {
      card: code => (code === CODE ? clone(CARD_OK) : { ok: false, error: 'not_found' }),
      // `add` is p_add, read from the statement: it is not a parameter.
      verify_card(code, birthday, number, password, session, hash, add) {
        if (code !== CODE) return { ok: false, error: 'not_found' };
        if (birthday !== '2012-05-15' && number !== '0123456' && password !== '4821') {
          return { ok: false, error: 'wrong_identity', tries_left: 4 };
        }
        // From the start screen: whoever was signed in on the device is signed out.
        if (sessions[session] && !add) delete sessions[session];
        const joined = !!sessions[session];
        const token = joined ? session : NEW_SESSION;
        sessions[token] = [...new Set([...(sessions[token] || []), CECE])];
        return {
          ok: true,
          session_token: joined ? null : NEW_SESSION,
          expires_at: EXPIRES,
          enrollment_id: CECE,
          classes: clone(CLASSES),
        };
      },
      page(session, enrollment) {
        const why = inSession(session, enrollment);
        return why ? { ok: false, error: why } : clone(PAGE_OK);
      },
      seen(session, enrollment, ids) {
        const why = inSession(session, enrollment);
        return why ? { ok: false, error: why } : { ok: true, seen: ids.slice(1, -1).split(',').filter(Boolean).length };
      },
      done: () => ({ ok: true }),
    },
    answers,
  );
  const untouched = name => async () => {
    slip.push(name);
    return { ok: true, parts: [] };
  };
  const handle = makeHandler(
    Object.assign(
      {
        region: 'ca-central-1',
        ipKey: 'test-key',
        log: entry => logs.push(entry),
        db: {
          open: untouched('open'),
          verify: untouched('verify'),
          check: untouched('check'),
          submit: untouched('submit'),
          async call(text, params) {
            calls.push({ sql: text, params });
            const fn = /^select student_submit\.(\w+)\(/.exec(text)[1];
            const add = /, p_add => (true|false)\) as r$/.exec(text);
            return sql[fn](...params, add ? add[1] === 'true' : undefined);
          },
        },
      },
      overrides,
    ),
  );
  return { handle, calls, logs, slip };
}

function post(body, headers) {
  return new Request('https://x.supabase.co/functions/v1/student-submit', {
    method: 'POST',
    headers: Object.assign(
      { 'content-type': 'application/json', origin: 'https://fullvision.ca', 'cf-connecting-ip': '203.0.113.7' },
      headers,
    ),
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

// One good request per route.
const GOOD = {
  card: { route: 'card', code: CODE },
  verify: { route: 'verify', code: CODE, birthday: '2012-05-15' },
  'add-card': { route: 'add-card', code: CODE, student_number: '0123456', session: SESSION },
  page: { route: 'page', session: SESSION, enrollment_id: CECE },
  seen: { route: 'seen', session: SESSION, enrollment_id: CECE, assessment_ids: [QUIZ, LAB] },
  done: { route: 'done', session: SESSION },
};
// The card's identity check: one statement for the start screen, one for Add Another Card.
const VERIFY = CARD_ROUTES.verify.sql;
const ADD_CARD = CARD_ROUTES['add-card'].sql;
// The one student_submit function each route calls.
const FUNCTION = {
  card: 'card',
  verify: 'verify_card',
  'add-card': 'verify_card',
  page: 'page',
  seen: 'seen',
  done: 'done',
};

describe('student-submit: the card route', () => {
  it('takes a code and answers with the first name, the class and which check to ask for', async () => {
    const { handle, calls } = setup();
    const res = await handle(post(GOOD.card));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(CARD_OK);
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toBe('select student_submit.card($1::text, $2::text) as r');
    expect(calls[0].params).toEqual([CODE, expect.stringMatching(/^[0-9a-f]{64}$/)]);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://fullvision.ca');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('offers the card password too when the database says it still works', async () => {
    const { handle } = setup({ card: () => ({ ...CARD_OK, check: 'identity', also_password: true }) });
    expect(await (await handle(post(GOOD.card))).json()).toMatchObject({ check: 'identity', also_password: true });
    const pw = setup({ card: () => ({ ...CARD_OK, check: 'password' }) });
    expect(await (await pw.handle(post(GOOD.card))).json()).toMatchObject({ check: 'password', also_password: false });
  });

  it('gives the phone the named fields only', async () => {
    const { handle } = setup({
      card: () => ({
        ...clone(CARD_OK),
        token: 'e'.repeat(64),
        enrollment_id: CECE,
        card_id: CHECK,
        student: { first_name: 'Cece', last_name: 'Liu', date_of_birth: '2012-05-15', slip_password: '4821' },
        course: { name: 'Science 8', block: 'B', id: RUBRIC, teacher_id: QUIZ },
      }),
    });
    const res = await handle(post(GOOD.card));
    expect(await res.json()).toEqual(CARD_OK);
  });

  it("answers a slip's code as not_found, like any guess, and says nothing about slips", async () => {
    const { handle, calls, logs, slip } = setup();
    const guess = await (await handle(post({ route: 'card', code: 'ZZZ-ZZZ' }))).json();
    const res = await handle(post({ route: 'card', code: SLIP }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(guess);
    expect(guess).toEqual({ ok: false, error: 'not_found' });
    expect(logs.map(l => l.outcome)).toEqual(['not_found', 'not_found']);
    // The function does not try open itself: one statement each, and open is the page's next request.
    expect(calls).toHaveLength(2);
    expect(slip).toEqual([]);

    // Whatever else the database put beside the refusal stays behind.
    const dirty = setup({ card: () => ({ ok: false, error: 'not_found', kind: 'slip', questionnaire_id: QUIZ }) });
    expect(await (await dirty.handle(post({ route: 'card', code: SLIP }))).json()).toEqual(guess);
  });

  it.each(['not_found', 'closed', 'card_locked', 'card_expired', 'reprint', 'locked'])(
    'answers %s as the database said it, with nothing else',
    async error => {
      const { handle, logs } = setup({ card: () => ({ ok: false, error, card_id: CHECK, course_id: RUBRIC }) });
      const res = await handle(post(GOOD.card));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: false, error });
      expect(logs.map(l => l.outcome)).toEqual([error]);
    },
  );

  it('answers a locked card, an expired card and a class with the page off the way it answers a guess', async () => {
    const answer = async (code, reply) => {
      const { handle } = setup(reply && { card: () => reply });
      const res = await handle(post({ route: 'card', code }));
      const body = await res.json();
      return { status: res.status, keys: Object.keys(body), ok: body.ok, headers: [...res.headers.keys()].sort() };
    };
    const guess = await answer('ZZZ-ZZZ');
    expect(guess).toMatchObject({ status: 200, keys: ['ok', 'error'], ok: false });
    for (const error of ['card_locked', 'card_expired', 'closed', 'reprint']) {
      expect(await answer(CODE, { ok: false, error, student: { first_name: 'Cece' } }), error).toEqual(guess);
    }
  });

  it('answers a code it does not know as not_found, and logs it as that', async () => {
    // busy is a slip's: there is no everyone-is-busy stop on a card's routes.
    for (const error of [
      'busy',
      'card_stopped',
      'no_identity',
      'ambiguous',
      'relation "student_card" does not exist',
    ]) {
      const { handle, logs } = setup({ card: () => ({ ok: false, error }) });
      const res = await handle(post(GOOD.card));
      expect(res.status, error).toBe(200);
      expect(await res.json(), error).toEqual({ ok: false, error: 'not_found' });
      expect(logs).toEqual([{ route: 'card', outcome: 'not_found', ms: expect.any(Number) }]);
    }
  });

  it('refuses a missing or overlong code without calling the database', async () => {
    const { handle, calls } = setup();
    for (const body of [
      { route: 'card' },
      { route: 'card', code: '' },
      { route: 'card', code: 734982 },
      { route: 'card', code: 'x'.repeat(33) },
    ]) {
      expect((await handle(post(body))).status, JSON.stringify(body)).toBe(400);
    }
    expect(calls).toEqual([]);
  });
});

describe('student-submit: verify for a card', () => {
  it('checks the birthday, student number or card password and starts the device session', async () => {
    const { handle, calls, slip } = setup();
    const hash = expect.stringMatching(/^[0-9a-f]{64}$/);
    const ok = { ok: true, session_token: NEW_SESSION, expires_at: EXPIRES, enrollment_id: CECE, classes: CLASSES };

    let res = await handle(post({ route: 'verify', code: CODE, birthday: '2012-05-15' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(ok);
    res = await handle(post({ route: 'verify', code: CODE, student_number: '0123456' }));
    expect(await res.json()).toEqual(ok);
    res = await handle(post({ route: 'verify', code: CODE, password: '4821', session: null }));
    expect(await res.json()).toEqual(ok);

    for (const c of calls) expect(c.sql).toBe(VERIFY);
    expect(calls.map(c => c.params)).toEqual([
      [CODE, '2012-05-15', null, null, null, hash],
      [CODE, null, '0123456', null, null, hash],
      [CODE, null, null, '4821', null, hash],
    ]);
    // The slip's verify is a different function and is not called.
    expect(slip).toEqual([]);
  });

  it('from the start screen always starts a new session, and ends the one the device sent', async () => {
    const { handle, calls } = setup();
    // A shared Chromebook: Omar is still signed in when Cece scans her card.
    const res = await handle(post({ route: 'verify', code: CODE, birthday: '2012-05-15', session: OTHER_DEVICE }));
    expect(await res.json()).toEqual({
      ok: true,
      session_token: NEW_SESSION,
      expires_at: EXPIRES,
      enrollment_id: CECE,
      classes: CLASSES,
    });
    expect(calls[0].sql).toBe(VERIFY);
    // The token is sent, so the database can end that session.
    expect(calls[0].params[4]).toBe(OTHER_DEVICE);
    const old = await handle(post({ route: 'page', session: OTHER_DEVICE, enrollment_id: OMAR }));
    expect(await old.json()).toEqual({ ok: false, error: 'signed_out' });
    const fresh = await handle(post({ route: 'page', session: NEW_SESSION, enrollment_id: CECE }));
    expect((await fresh.json()).ok).toBe(true);
    // Omar's class did not come along.
    const omar = await handle(post({ route: 'page', session: NEW_SESSION, enrollment_id: OMAR }));
    expect(await omar.json()).toEqual({ ok: false, error: 'not_found' });
  });

  it('cannot be turned into an add by anything in the request', async () => {
    for (const extra of [
      { add: true },
      { p_add: true },
      { p_add: 'true', add: 'true', join: true },
      { route: 'verify', mode: 'add-card' },
      { session: SESSION, student_number: 'p_add => true' },
      { session: SESSION, password: 'true) as r' },
    ]) {
      const { handle, calls } = setup();
      const body = { route: 'verify', code: CODE, birthday: '2012-05-15', session: SESSION, ...extra };
      const res = await handle(post(body));
      // A new session, never the one sent.
      expect((await res.json()).session_token, JSON.stringify(extra)).toBe(NEW_SESSION);
      expect(calls).toHaveLength(1);
      expect(calls[0].sql).toBe(VERIFY);
      expect(calls[0].sql).toMatch(/, p_add => false\) as r$/);
      // Six parameters: the code, what was typed, the token and the hashed address. p_add is not one.
      expect(calls[0].params).toHaveLength(6);
      expect(calls[0].params).not.toContain(true);
    }
  });

  it('gives the phone the named fields only', async () => {
    const { handle } = setup({
      verify_card: () => ({
        ok: true,
        session_token: NEW_SESSION,
        token_hash: 'f'.repeat(64),
        session_id: RUBRIC,
        card_id: CHECK,
        expires_at: EXPIRES,
        enrollment_id: CECE,
        classes: [{ ...CLASSES[0], card_id: CHECK, student: { first_name: 'Cece', last_name: 'Liu' } }],
      }),
    });
    const res = await handle(post(GOOD.verify));
    expect(await res.json()).toEqual({
      ok: true,
      session_token: NEW_SESSION,
      expires_at: EXPIRES,
      enrollment_id: CECE,
      classes: CLASSES,
    });
  });

  it('counts down the tries after a wrong answer, then says the card is locked', async () => {
    let wrong = 0;
    const { handle, logs } = setup({
      verify_card: () =>
        ++wrong >= 5
          ? { ok: false, error: 'card_locked' }
          : { ok: false, error: 'wrong_identity', tries_left: 5 - wrong, wrong_tries: wrong },
    });
    const replies = [];
    for (let i = 0; i < 5; i++) {
      const res = await handle(post({ route: 'verify', code: CODE, birthday: '2012-05-16' }));
      expect(res.status).toBe(200);
      replies.push(await res.json());
    }
    expect(replies).toEqual([
      { ok: false, error: 'wrong_identity', tries_left: 4 },
      { ok: false, error: 'wrong_identity', tries_left: 3 },
      { ok: false, error: 'wrong_identity', tries_left: 2 },
      { ok: false, error: 'wrong_identity', tries_left: 1 },
      { ok: false, error: 'card_locked' },
    ]);
    expect(logs.map(l => l.outcome)).toEqual([
      'wrong_identity',
      'wrong_identity',
      'wrong_identity',
      'wrong_identity',
      'card_locked',
    ]);
  });

  it('passes on the tries left as the database counts them, by whichever lock is nearer', async () => {
    // Fourteen wrong tries this week already: the slow lock is one try away, on a card with none in a row.
    const replies = [
      { ok: false, error: 'wrong_identity', tries_left: 1, wrong_tries: 1, wrong_tries_7d: 14 },
      { ok: false, error: 'card_locked', wrong_tries_7d: 15 },
    ];
    const { handle } = setup({ verify_card: () => replies.shift() });
    const wrong = { route: 'verify', code: CODE, birthday: '2012-05-16' };
    expect(await (await handle(post(wrong))).json()).toEqual({ ok: false, error: 'wrong_identity', tries_left: 1 });
    expect(await (await handle(post(wrong))).json()).toEqual({ ok: false, error: 'card_locked' });
  });

  it.each(['not_found', 'closed', 'card_locked', 'card_expired', 'reprint', 'locked'])(
    'answers %s as the database said it, with nothing else',
    async error => {
      const { handle } = setup({ verify_card: () => ({ ok: false, error, tries_left: 2, card_id: CHECK }) });
      const res = await handle(post(GOOD.verify));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: false, error });
    },
  );

  it('answers a code it does not know as not_found', async () => {
    for (const error of ['card_stopped', 'busy', 'slip']) {
      const { handle } = setup({ verify_card: () => ({ ok: false, error }) });
      expect(await (await handle(post(GOOD.verify))).json(), error).toEqual({ ok: false, error: 'not_found' });
    }
  });

  it("answers a slip's code as not_found: only a card is verified here", async () => {
    const { handle } = setup();
    const res = await handle(post({ route: 'verify', code: SLIP, birthday: '2012-05-15' }));
    expect(await res.json()).toEqual({ ok: false, error: 'not_found' });
  });

  it("still passes busy on from a slip's open", async () => {
    const { handle } = setup(null, { db: { open: async () => ({ ok: false, error: 'busy' }) } });
    const res = await handle(post({ route: 'open', code: SLIP }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, error: 'busy' });
  });

  it('refuses a verify with nothing to check, or a field of the wrong shape', async () => {
    const { handle, calls, slip } = setup();
    for (const body of [
      { route: 'verify', code: CODE },
      { route: 'verify', code: CODE, birthday: '', student_number: '', password: '' },
      { route: 'verify', code: CODE, birthday: '15/05/2012' },
      { route: 'verify', code: CODE, student_number: 'x'.repeat(33) },
      { route: 'verify', code: CODE, password: 4821 },
      { route: 'verify', code: 'x'.repeat(33), birthday: '2012-05-15' },
      { route: 'verify', code: 734982, birthday: '2012-05-15' },
      { route: 'verify', code: CODE, birthday: '2012-05-15', session: 12 },
      { route: 'verify', code: CODE, birthday: '2012-05-15', session: 'a'.repeat(129) },
      { route: 'verify', code: CODE, birthday: '2012-05-15', session: { token: SESSION } },
    ]) {
      expect((await handle(post(body))).status, JSON.stringify(body)).toBe(400);
    }
    expect(calls).toEqual([]);
    expect(slip).toEqual([]);
  });

  it("leaves a slip's verify as it was: a token goes to student_submit.verify, whatever else is sent", async () => {
    const { handle, calls, slip } = setup();
    const token = 'e'.repeat(64);
    let res = await handle(post({ route: 'verify', token, student_number: '0123456' }));
    expect(await res.json()).toEqual({ ok: true, parts: [] });
    res = await handle(post({ route: 'verify', token, code: CODE, birthday: '2012-05-15', session: SESSION }));
    expect(await res.json()).toEqual({ ok: true, parts: [] });
    // A token of the wrong shape is a bad slip request, not a card's.
    res = await handle(post({ route: 'verify', token: 12, code: CODE, birthday: '2012-05-15' }));
    expect(res.status).toBe(400);
    expect(slip).toEqual(['verify', 'verify']);
    expect(calls).toEqual([]);
    // No token at all, with a code, is a card's.
    res = await handle(post({ route: 'verify', token: null, code: CODE, birthday: '2012-05-15' }));
    expect((await res.json()).session_token).toBe(NEW_SESSION);
    expect(slip).toEqual(['verify', 'verify']);
    expect(calls).toHaveLength(1);
  });
});

describe('student-submit: add-card', () => {
  it('runs the same check and joins the session the device has', async () => {
    const { handle, calls } = setup();
    // Omar's phone adds Cece's card: both classes are then in his session.
    const res = await handle(post({ ...GOOD['add-card'], session: OTHER_DEVICE }));
    expect(await res.json()).toEqual({
      ok: true,
      session_token: null,
      expires_at: EXPIRES,
      enrollment_id: CECE,
      classes: CLASSES,
    });
    expect(calls[0].sql).toBe(ADD_CARD);
    expect(calls[0].sql).toMatch(/, p_add => true\) as r$/);
    expect(calls[0].params).toEqual([
      CODE,
      null,
      '0123456',
      null,
      OTHER_DEVICE,
      expect.stringMatching(/^[0-9a-f]{64}$/),
    ]);
    for (const enrollment_id of [OMAR, CECE]) {
      const page = await handle(post({ route: 'page', session: OTHER_DEVICE, enrollment_id }));
      expect((await page.json()).ok, enrollment_id).toBe(true);
    }
  });

  it('differs from verify only in p_add, which neither takes from the request', () => {
    expect(VERIFY).toBe(
      'select student_submit.verify_card($1::text, $2::text, $3::text, $4::text, $5::text, $6::text, p_add => false) as r',
    );
    expect(ADD_CARD).toBe(VERIFY.replace('p_add => false', 'p_add => true'));
    expect(CARD_ROUTES.verify.sql).toBe(VERIFY);
    expect(CARD_ROUTES['add-card'].sql).toBe(ADD_CARD);
  });

  it('starts a new session when the one sent is no longer live, as the database says', async () => {
    const { handle } = setup();
    const res = await handle(post({ ...GOOD['add-card'], session: ENDED }));
    expect((await res.json()).session_token).toBe(NEW_SESSION);
  });

  it('needs the session', async () => {
    const { handle, calls } = setup();
    for (const session of [undefined, null, '', 12]) {
      const res = await handle(post({ route: 'add-card', code: CODE, birthday: '2012-05-15', session }));
      expect(res.status, String(session)).toBe(400);
    }
    expect(calls).toEqual([]);
  });

  it('passes on a wrong answer and a locked card', async () => {
    const { handle } = setup();
    const res = await handle(post({ ...GOOD['add-card'], student_number: '999' }));
    expect(await res.json()).toEqual({ ok: false, error: 'wrong_identity', tries_left: 4 });
  });
});

describe('student-submit: the page route', () => {
  it("answers with the student's page for one class in the session, as the database gave it", async () => {
    const { handle, calls } = setup();
    const res = await handle(post(GOOD.page));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(PAGE_OK);
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toBe('select student_submit.page($1::text, $2::uuid, $3::text) as r');
    expect(calls[0].params).toEqual([SESSION, CECE, expect.stringMatching(/^[0-9a-f]{64}$/)]);
  });

  it('hands on a returned grade untouched: the same names, the same values, nothing worked out', async () => {
    const { handle } = setup();
    const page = await (await handle(post(GOOD.page))).json();
    const lab = page.assessments.find(a => a.id === LAB);
    expect(lab.grade).toEqual(LAB_GRADE);
    expect(lab.previous).toEqual(LAB_BEFORE);
    expect(lab.status).toBe('LATE');
    expect(Object.keys(lab.grade).sort()).toEqual(['checks', 'comment', 'criteria', 'modifier', 'tags', 'v', 'value']);
    // No level word, letter, percent or overall is added on the way through.
    expect(Object.keys(lab).sort()).toEqual(Object.keys(PAGE_OK.assessments[1]).sort());
    expect(page.course.grading_scale).toEqual(PAGE_OK.course.grading_scale);
  });

  it('needs the session token and a class', async () => {
    const { handle, calls } = setup();
    for (const body of [
      { route: 'page', enrollment_id: CECE },
      { route: 'page', session: null, enrollment_id: CECE },
      { route: 'page', session: '', enrollment_id: CECE },
      { route: 'page', session: 12, enrollment_id: CECE },
      { route: 'page', session: [SESSION], enrollment_id: CECE },
      { route: 'page', session: 'a'.repeat(129), enrollment_id: CECE },
      { route: 'page', session: SESSION },
      { route: 'page', session: SESSION, enrollment_id: 'c1abcd' },
      { route: 'page', session: SESSION, enrollment_id: CECE + "' or true --" },
      // A slip's token or a card's code does not open a page.
      { route: 'page', token: SESSION, enrollment_id: CECE },
      { route: 'page', code: CODE, enrollment_id: CECE },
    ]) {
      expect((await handle(post(body))).status, JSON.stringify(body)).toBe(400);
    }
    expect(calls).toEqual([]);
  });

  it("refuses another device's token, an ended session and a token nobody was given", async () => {
    const { handle, logs } = setup();
    // Another phone is signed in, but not to Cece's class.
    let res = await handle(post({ route: 'page', session: OTHER_DEVICE, enrollment_id: CECE }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, error: 'not_found' });
    for (const session of [ENDED, 'f'.repeat(64), 'not-a-token']) {
      res = await handle(post({ route: 'page', session, enrollment_id: CECE }));
      expect(res.status).toBe(200);
      expect(await res.json(), session).toEqual({ ok: false, error: 'signed_out' });
    }
    expect(logs.map(l => l.outcome)).toEqual(['not_found', 'signed_out', 'signed_out', 'signed_out']);
  });

  it.each(['signed_out', 'not_found', 'card_stopped', 'card_expired', 'closed'])(
    'answers %s as the database said it, with nothing else',
    async error => {
      const { handle } = setup({
        page: () => ({ ok: false, error, assessments: PAGE_OK.assessments, card_id: CHECK }),
      });
      const res = await handle(post(GOOD.page));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: false, error });
    },
  );

  it('answers a code it does not know as not_found', async () => {
    const { handle } = setup({ page: () => ({ ok: false, error: 'card_locked' }) });
    expect(await (await handle(post(GOOD.page))).json()).toEqual({ ok: false, error: 'not_found' });
  });

  it('never forwards a field it was not told about: a draft the database sent by mistake stops here', async () => {
    const DRAFT = { v: 1, value: 4, modifier: 0, comment: 'DRAFT-ONLY', tags: {}, criteria: {}, checks: [] };
    const dirty = clone(PAGE_OK);
    Object.assign(dirty, { is_draft: true, draft: DRAFT, returned_copy: DRAFT, drafts: 2, session_id: RUBRIC });
    Object.assign(dirty.student, { last_name: 'Liu', date_of_birth: '2012-05-15', student_number: '0123456' });
    Object.assign(dirty.course, { id: RUBRIC, teacher_id: QUIZ, return_grades: 'on_return', is_draft: true });
    Object.assign(dirty.classes[0], { card_id: CHECK, is_draft: true });
    Object.assign(dirty.tags[TAG], { draft: 4, is_draft: true });
    dirty.tags.is_draft = { label: 'DRAFT-ONLY', code: 'X' };
    Object.assign(dirty.rubrics[0], { draft: DRAFT });
    Object.assign(dirty.rubrics[0].criteria[0], { is_draft: true, draft: 4 });
    Object.assign(dirty.rubrics[0].criteria[0].checks[0], { draft: true });
    for (const a of dirty.assessments) {
      Object.assign(a, {
        is_draft: true,
        draft: DRAFT,
        returned_copy: DRAFT,
        previous_copy: DRAFT,
        working_copy: DRAFT,
        report_note: 'DRAFT-ONLY',
        has_draft: true,
      });
    }
    const lab = dirty.assessments[1];
    Object.assign(lab.grade, { is_draft: true, draft: DRAFT, returned_copy: DRAFT, report_note: 'DRAFT-ONLY' });
    Object.assign(lab.grade.tags[TAG], { draft: 4, is_draft: true });
    lab.grade.tags.draft = { value: 4, modifier: 0, comment: 'DRAFT-ONLY' };
    Object.assign(lab.grade.criteria[CRITERION], { draft: 4, returned_copy: DRAFT });
    lab.grade.criteria.is_draft = { value: 4, modifier: 0, comment: null, beyond: 'DRAFT-ONLY' };
    lab.grade.checks.push('draft', { is_draft: true });
    // A plain field holding an object is not copied either.
    lab.grade.comment = { is_draft: true, text: 'DRAFT-ONLY' };

    const { handle } = setup({ page: () => dirty });
    const res = await handle(post(GOOD.page));
    const text = await res.text();
    for (const leak of ['is_draft', 'returned_copy', 'draft', 'DRAFT-ONLY', 'report_note', 'previous_copy', 'Liu']) {
      expect(text, leak).not.toContain(leak);
    }
    const clean = clone(PAGE_OK);
    clean.assessments[1].grade.comment = null;
    expect(JSON.parse(text)).toEqual(clean);
  });

  it('gives no grade for a piece with no return date, whatever the database sent', async () => {
    const dirty = clone(PAGE_OK);
    const essay = dirty.assessments[2];
    essay.grade = clone(LAB_GRADE);
    essay.previous = clone(LAB_BEFORE);
    const { handle } = setup({ page: () => dirty });
    const page = await (await handle(post(GOOD.page))).json();
    expect(page.assessments[2]).toEqual(PAGE_OK.assessments[2]);
    // A piece with a draft and no earlier return reads exactly as a piece never graded.
    expect(page.assessments[2]).toMatchObject({ returned_at: null, grade: null, previous: null, status: 'NS' });
  });

  it('hands on a Missing or Excused piece with no grade, though it was returned', async () => {
    const sent = clone(PAGE_OK);
    // Missing wins at once: the database sends no grade while the mark is on, and still says when it came back.
    Object.assign(sent.assessments[0], { status: 'NS', grade: null, previous: null });
    Object.assign(sent.assessments[1], { status: 'EXC', grade: null, previous: null });
    const { handle } = setup({ page: () => clone(sent) });
    const page = await (await handle(post(GOOD.page))).json();
    expect(page).toEqual(sent);
    expect(page.assessments[0]).toMatchObject({ status: 'NS', returned_at: '2026-11-03T20:15:00+00:00', grade: null });
    expect(page.assessments[1]).toMatchObject({ status: 'EXC', returned_at: '2026-11-05T18:00:00+00:00', grade: null });
  });

  it('hands on only the competencies and criteria the database sent, and adds none back', async () => {
    const OLD_TAG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; // removed from the class since the return
    const sent = clone(PAGE_OK);
    const lab = sent.assessments[1];
    // The database left the removed competency out of tags, tag_ids and the copies.
    lab.grade.criteria = {};
    lab.grade.checks = [];
    lab.previous.tags = {};
    // A returned piece with nothing left in use: no grade, and the return date stays.
    Object.assign(sent.assessments[0], { grade: null });
    const { handle } = setup({ page: () => clone(sent) });
    const page = await (await handle(post(GOOD.page))).json();
    expect(page).toEqual(sent);
    expect(JSON.stringify(page)).not.toContain(OLD_TAG);
    expect(page.assessments[0]).toMatchObject({ returned_at: '2026-11-03T20:15:00+00:00', grade: null });
    expect(page.assessments[1].grade).toEqual({ ...LAB_GRADE, criteria: {}, checks: [] });
  });

  /* S0-M4b makes page() send when each piece was made, so two pieces with
     one date are listed with the one made later counting later. */
  it('hands on created_at when the database sends it, where the database put it', async () => {
    const sent = clone(PAGE_OK);
    const made = ['2026-10-27T16:04:11.482913+00:00', '2026-10-27T16:04:11.482914+00:00', '2026-10-20T09:00:00+00:00'];
    sent.assessments.forEach((a, i) => (a.created_at = made[i]));
    const { handle } = setup({ page: () => clone(sent) });
    const page = await (await handle(post(GOOD.page))).json();
    expect(page).toEqual(sent);
    expect(page.assessments.map(a => a.created_at)).toEqual(made);
    // To the microsecond, as text: nothing is parsed or rounded on the way.
    expect(JSON.stringify(page)).toContain('"created_at":"2026-10-27T16:04:11.482913+00:00"');
  });

  it('sends no created_at until the database does, and none it was not told about', async () => {
    const { handle } = setup();
    const before = await (await handle(post(GOOD.page))).json();
    expect(before.assessments.every(a => !('created_at' in a))).toBe(true);
    expect(before).toEqual(PAGE_OK);

    // Only a plain value under that name is copied, and only on an assessment.
    const dirty = clone(PAGE_OK);
    dirty.assessments[0].created_at = { is_draft: true };
    dirty.assessments[1].created_by = 'DRAFT-ONLY';
    dirty.assessments[1].updated_by = 'DRAFT-ONLY';
    dirty.created_at = '2026-10-27T16:04:11+00:00';
    dirty.course.created_at = '2026-09-02T16:00:00+00:00';
    dirty.student.created_at = '2026-09-02T16:00:00+00:00';
    dirty.rubrics[0].created_at = '2026-09-02T16:00:00+00:00';
    const { handle: second } = setup({ page: () => dirty });
    const text = await (await second(post(GOOD.page))).text();
    const clean = clone(PAGE_OK);
    clean.assessments[0].created_at = null;
    expect(JSON.parse(text)).toEqual(clean);
    expect(text).not.toContain('DRAFT-ONLY');
    expect(text).not.toContain('2026-09-02');
  });

  it('answers an empty class with an empty page', async () => {
    const { handle } = setup({ page: () => ({ ok: true, v: 1, expires_at: EXPIRES, tags: {}, rubrics: [] }) });
    const page = await (await handle(post(GOOD.page))).json();
    expect(page).toEqual({
      ok: true,
      v: 1,
      expires_at: EXPIRES,
      student: {},
      course: { grading_scale: null },
      classes: [],
      tags: {},
      rubrics: [],
      assessments: [],
    });
  });
});

describe('student-submit: seen and done', () => {
  it('records the pieces the student opened', async () => {
    const { handle, calls } = setup();
    const res = await handle(post(GOOD.seen));
    expect(await res.json()).toEqual({ ok: true, seen: 2 });
    expect(calls[0].sql).toBe('select student_submit.seen($1::text, $2::uuid, $3::uuid[], $4::text) as r');
    expect(calls[0].params.slice(0, 3)).toEqual([SESSION, CECE, `{${QUIZ},${LAB}}`]);
    const none = await handle(post({ ...GOOD.seen, assessment_ids: [] }));
    expect(await none.json()).toEqual({ ok: true, seen: 0 });
    expect(calls[1].params[2]).toBe('{}');
  });

  it('refuses a seen with no session, no class, or anything that is not an assessment id', async () => {
    const { handle, calls } = setup();
    for (const patch of [
      { session: undefined },
      { enrollment_id: 'nope' },
      { assessment_ids: undefined },
      { assessment_ids: QUIZ },
      { assessment_ids: [QUIZ, 'c1abcd'] },
      { assessment_ids: [QUIZ, '},{'] },
      { assessment_ids: [QUIZ, null] },
      { assessment_ids: Array(501).fill(QUIZ) },
    ]) {
      const res = await handle(post({ ...GOOD.seen, ...patch }));
      expect(res.status, JSON.stringify(patch).slice(0, 80)).toBe(400);
    }
    expect(calls).toEqual([]);
  });

  it.each(['signed_out', 'not_found', 'card_stopped', 'card_expired', 'closed'])(
    'seen answers %s as the database said it',
    async error => {
      const { handle } = setup({ seen: () => ({ ok: false, error }) });
      expect(await (await handle(post(GOOD.seen))).json()).toEqual({ ok: false, error });
    },
  );

  it("refuses a seen with another device's token or an ended session", async () => {
    const { handle } = setup();
    let res = await handle(post({ ...GOOD.seen, session: OTHER_DEVICE }));
    expect(await res.json()).toEqual({ ok: false, error: 'not_found' });
    res = await handle(post({ ...GOOD.seen, session: ENDED }));
    expect(await res.json()).toEqual({ ok: false, error: 'signed_out' });
  });

  it('ends the session on Done, and says only that', async () => {
    const { handle, calls } = setup({ done: () => ({ ok: true, ended: 1, session_id: RUBRIC }) });
    const res = await handle(post(GOOD.done));
    expect(await res.json()).toEqual({ ok: true });
    expect(calls[0].sql).toBe('select student_submit.done($1::text, $2::text) as r');
    expect(calls[0].params[0]).toBe(SESSION);
    expect((await handle(post({ route: 'done' }))).status).toBe(400);
    expect(calls).toHaveLength(1);
  });
});

describe('student-submit: every card route', () => {
  const routes = Object.keys(GOOD);

  it('is one of the six, each with one statement', () => {
    expect(Object.keys(CARD_ROUTES).sort()).toEqual([...routes].sort());
  });

  it.each(routes)('%s calls its one student_submit function and nothing else', async route => {
    const { handle, calls, slip } = setup();
    const res = await handle(post(GOOD[route]));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    expect(calls).toHaveLength(1);
    const text = calls[0].sql;
    expect(text).toBe(CARD_ROUTES[route].sql);
    // One statement, one function, and only placeholders inside it.
    expect(text).toMatch(
      new RegExp(
        `^select student_submit\\.${FUNCTION[route]}\\((\\$\\d::(text|uuid|uuid\\[\\])(, )?)+(p_add => (true|false))?\\) as r$`,
      ),
    );
    expect(text.match(/student_submit\./g)).toHaveLength(1);
    expect(text).not.toMatch(/;|--|\bfrom\b|\bpublic\b/i);
    // No route reads a score table or a grade's copies: only student_submit._returned_grade may.
    expect(text).not.toMatch(/score|tag_score|rubric_score|rubric_check_score/i);
    expect(text).not.toMatch(/grade_return|returned_copy|previous_copy|_grade_copy|_returned_grade/i);
    // What the student typed travels as a parameter, never in the statement.
    for (const value of Object.values(GOOD[route]).flat()) {
      if (value !== route) expect(text).not.toContain(String(value));
    }
    // The caller's hashed address is the last parameter, for the rate limits in SQL.
    expect(calls[0].params).toHaveLength(text.match(/\$\d/g).length);
    expect(calls[0].params.at(-1)).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(calls)).not.toContain('203.0.113.7');
    expect(slip).toEqual([]);
  });

  it.each(routes)('%s refuses to run outside ca-central-1, before touching the database', async route => {
    for (const region of ['us-east-1', 'ca-central-2', undefined]) {
      const { handle, calls } = setup(null, { region });
      const res = await handle(post(GOOD[route]));
      expect(res.status).toBe(421);
      expect(await res.json()).toEqual({ ok: false, error: 'wrong_region' });
      expect(calls).toEqual([]);
    }
  });

  it.each(routes)('%s keeps the body limit and the origin rules', async route => {
    const { handle, calls } = setup();
    const big = await handle(post({ ...GOOD[route], padding: 'y'.repeat(130000) }));
    expect(big.status).toBe(413);
    expect(calls).toEqual([]);
    const elsewhere = await handle(post(GOOD[route], { origin: 'https://evil.example' }));
    expect(elsewhere.headers.get('access-control-allow-origin')).toBeNull();
    const get = await handle(
      new Request('https://x.supabase.co/functions/v1/student-submit?route=' + route + '&session=' + SESSION),
    );
    expect(get.status).toBe(405);
    expect(calls).toHaveLength(1); // the request from elsewhere; a browser there cannot read its reply
  });

  it.each(routes)('%s logs route, outcome and time only', async route => {
    const { handle, logs } = setup();
    await handle(post(GOOD[route]));
    expect(logs).toEqual([{ route, outcome: 'ok', ms: expect.any(Number) }]);
  });

  it('never logs the code, the session token, what the student typed or a name', async () => {
    const { handle, logs } = setup();
    for (const route of routes) await handle(post(GOOD[route]));
    await handle(post({ route: 'verify', code: CODE, password: '4821' }));
    await handle(post({ route: 'verify', code: CODE, birthday: '2012-05-16' }));
    await handle(post({ route: 'page', session: OTHER_DEVICE, enrollment_id: CECE }));
    await handle(post({ route: 'page', session: ENDED, enrollment_id: CECE }));
    expect(logs).toHaveLength(routes.length + 4);
    const text = JSON.stringify(logs);
    for (const secret of [
      CODE,
      'P3R',
      SESSION,
      NEW_SESSION,
      OTHER_DEVICE,
      ENDED,
      'aaaa',
      'dddd',
      '2012',
      '0123456',
      '4821',
      'Cece',
      'Science',
      CECE,
      QUIZ,
      '203.0.113',
    ]) {
      expect(text, secret).not.toContain(secret);
    }
    expect(Object.keys(Object.assign({}, ...logs)).sort()).toEqual(['ms', 'outcome', 'route']);
  });

  it.each(routes)(
    '%s: a database failure is a plain server error, with nothing from the error in the log',
    async route => {
      const { handle, logs } = setup(null, {
        db: {
          async call() {
            throw new Error(`function student_submit.${FUNCTION[route]}(text) does not exist (${SESSION}, ${CODE})`);
          },
        },
      });
      const res = await handle(post(GOOD[route]));
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ ok: false, error: 'server' });
      const text = JSON.stringify(logs);
      for (const leak of [SESSION, CODE, 'does not exist']) expect(text).not.toContain(leak);
    },
  );

  it.each(routes)('%s: a reply that is neither a yes nor a refusal is a plain server error', async route => {
    for (const reply of [
      null,
      undefined,
      'ok',
      [],
      {},
      { ok: false },
      { ok: 'true', student: { first_name: 'Cece' } },
    ]) {
      const { handle } = setup({ [FUNCTION[route]]: () => reply });
      const res = await handle(post(GOOD[route]));
      expect(res.status, JSON.stringify(reply)).toBe(500);
      expect(await res.json()).toEqual({ ok: false, error: 'server' });
    }
  });

  it('is not reached by a made-up route or an inherited name', async () => {
    const { handle, calls } = setup();
    for (const route of ['constructor', '__proto__', 'toString', 'pages', 'Card', 'return_grades', 7, null]) {
      const res = await handle(post({ route, code: CODE, session: SESSION, enrollment_id: CECE }));
      expect(res.status, String(route)).toBe(400);
    }
    expect(calls).toEqual([]);
  });
});
