/**
 * The teacher-cards edge function (supabase/functions/teacher-cards/handler.ts):
 * a signed-in teacher's browser has student cards made (S3-E2).
 *
 * The function draws each code and password, hands the database their tags
 * and returns each code once. This checks what it must never get wrong:
 *
 *   - no sign-in token, or one Supabase Auth does not accept, is 401 and
 *     the database is never called;
 *   - the teacher's id comes from Auth's answer about the token, even when
 *     the body names another teacher;
 *   - the database is handed tags and never a code or a password;
 *   - a code comes back only for a student the database says was made, and
 *     it is the code whose tag the database stored;
 *   - a replay returns no code; the second candidate is used when the
 *     first is taken; 250 students at most;
 *   - no key: a server error and no database call;
 *   - the region check, the allowed origins and no-store, as student-submit
 *     has them;
 *   - no log line holds a code, a tag, the key, a password or the token.
 *
 * The database is a stand-in that stores what it is given
 * (tests/helpers/fake-card-database.js). The tags expected here are made a
 * second way, with Node's own HMAC (tests/helpers/card-key-fake.js).
 * A card made here opening through student-submit is in
 * tests/card-made-then-opened.test.js.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ALPHABET, readCardKey } from '../supabase/functions/_shared/card-key.ts';
import {
  MAX_ITEMS,
  REGION,
  allowedOrigin,
  authUser,
  bearer,
  makeHandler,
  readRequest,
} from '../supabase/functions/teacher-cards/handler.ts';
import {
  REGION as STUDENT_REGION,
  allowedOrigin as studentAllowedOrigin,
} from '../supabase/functions/student-submit/handler.ts';
import { FAKE_KEY, bytesFrom, codeTag, keyId, passwordTag } from './helpers/card-key-fake.js';
import {
  CECE,
  COURSE,
  ELSEWHERE,
  GONE,
  NOOR,
  OMAR,
  OTHER_COURSE,
  OTHER_TEACHER,
  TEACHER,
  fakeCardDatabase,
  id,
  raised,
} from './helpers/fake-card-database.js';

const KEY = await readCardKey(FAKE_KEY);
const KEY_ID = keyId();
// Made-up sign-in tokens, in the shape of real ones.
const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.' + 'dGVhY2hlcg'.repeat(4) + '.c2lnbmF0dXJlLW9uZQ';
const OTHER_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.' + 'b3RoZXI'.repeat(5) + '.c2lnbmF0dXJlLXR3bw';
const EXPIRED = 'eyJhbGciOiJIUzI1NiJ9.' + 'ZXhwaXJlZA'.repeat(4) + '.c2lnbmF0dXJlLW9sZA';
const REQUEST = id(7001);
const URL_ = 'https://x.supabase.co/functions/v1/teacher-cards?forceFunctionRegion=ca-central-1';
const CODE_SHAPE = new RegExp('^[' + ALPHABET + ']{4}-[' + ALPHABET + ']{4}$');

/* A random source that draws exactly these codes and passwords, in order:
   two codes then a password for each student. */
function draws(...values) {
  const bytes = values.flatMap(v =>
    /^\d{4}$/.test(v)
      ? [...v].map(Number).concat([0, 0, 0, 0])
      : [...v].map(ch => ALPHABET.indexOf(ch)).concat(Array(8).fill(0)),
  );
  return bytesFrom(bytes);
}

function setup(over) {
  const db = fakeCardDatabase();
  const logs = [];
  const tokens = []; // every token Auth was asked about
  const handle = makeHandler(
    Object.assign(
      {
        region: 'ca-central-1',
        cardKey: KEY,
        async whoIs(token) {
          tokens.push(token);
          return token === TOKEN ? TEACHER : token === OTHER_TOKEN ? OTHER_TEACHER : null;
        },
        db: { issue: db.issue },
        log: entry => logs.push(entry),
      },
      over,
    ),
  );
  return { handle, db, logs, tokens };
}

function post(body, headers) {
  return new Request(URL_, {
    method: 'POST',
    headers: Object.assign(
      { 'content-type': 'application/json', origin: 'https://fullvision.ca', authorization: 'Bearer ' + TOKEN },
      headers,
    ),
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}
const send = async (h, body, headers) => {
  const res = await h.handle(post(body, headers));
  return { status: res.status, body: await res.json() };
};
const ask = (items, more) => ({ course_id: COURSE, items, request_id: REQUEST, ...more });
const first = enrollment_id => ({ enrollment_id, replaces: null });
const bare = code => code.replace('-', '');

describe('teacher-cards: making cards', () => {
  it('makes a card for each student and returns each code once', async () => {
    const h = setup();
    const res = await h.handle(post(ask([first(CECE), first(OMAR), first(NOOR)])));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(['replayed', 'results']);
    expect(body.replayed).toBe(false);
    // In the order asked.
    expect(body.results.map(r => r.enrollment_id)).toEqual([CECE, OMAR, NOOR]);
    for (const r of body.results) {
      expect(r).toMatchObject({ result: 'made', seq: 1, works_until: '2027-01-29' });
      expect(r.card_id).toBe(h.db.live(r.enrollment_id).id);
      expect(r.code).toMatch(CODE_SHAPE);
    }
    expect(new Set(body.results.map(r => r.code)).size).toBe(3);
    // Only Omar has no birthday and no student number: only his card carries a password.
    expect(body.results.map(r => Object.keys(r).sort())).toEqual([
      ['card_id', 'code', 'enrollment_id', 'result', 'seq', 'works_until'],
      ['card_id', 'code', 'enrollment_id', 'password', 'result', 'seq', 'works_until'],
      ['card_id', 'code', 'enrollment_id', 'result', 'seq', 'works_until'],
    ]);
    expect(body.results[1].password).toMatch(/^\d{4}$/);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(h.logs).toEqual([{ route: 'issue', outcome: 'ok', cards: 3, ms: expect.any(Number) }]);
  });

  it('the code returned is the one whose tag the database stored', async () => {
    const h = setup();
    const { body } = await send(h, ask([first(CECE), first(OMAR), first(NOOR)]));
    for (const r of body.results) {
      const card = h.db.live(r.enrollment_id);
      expect(card.code_hmac, r.enrollment_id).toBe(codeTag(r.code));
      expect(card.key_id).toBe(KEY_ID);
    }
    // Omar's password is stored as a tag bound to his card's code; the others' are not stored at all.
    const omar = body.results[1];
    expect(h.db.live(OMAR).pw_hmac).toBe(passwordTag(omar.code, omar.password));
    expect(h.db.live(CECE).pw_hmac).toBeNull();
    expect(h.db.live(NOOR).pw_hmac).toBeNull();
  });

  it('hands the database tags and ids, and never a code or a password', async () => {
    const h = setup({ random: draws('AAAAAAAA', 'BBBBBBBB', '4821', 'CCCCCCCC', 'DDDDDDDD', '6204') });
    const { body } = await send(h, ask([first(CECE), first(OMAR)]));
    expect(body.results.map(r => [r.code, r.password])).toEqual([
      ['AAAA-AAAA', undefined],
      ['CCCC-CCCC', '6204'],
    ]);
    expect(h.db.state.handed).toEqual([
      {
        fn: 'issue_cards',
        teacherId: TEACHER,
        courseId: COURSE,
        keyId: KEY_ID,
        requestId: REQUEST,
        items: [
          {
            enrollment_id: CECE,
            replaces: null,
            candidates: [
              { code_hmac: codeTag('AAAAAAAA'), pw_hmac: passwordTag('AAAAAAAA', '4821') },
              { code_hmac: codeTag('BBBBBBBB'), pw_hmac: passwordTag('BBBBBBBB', '4821') },
            ],
          },
          {
            enrollment_id: OMAR,
            replaces: null,
            candidates: [
              { code_hmac: codeTag('CCCCCCCC'), pw_hmac: passwordTag('CCCCCCCC', '6204') },
              { code_hmac: codeTag('DDDDDDDD'), pw_hmac: passwordTag('DDDDDDDD', '6204') },
            ],
          },
        ],
      },
    ]);
    const handed = JSON.stringify(h.db.state.handed);
    for (const secret of [
      'AAAAAAAA',
      'AAAA-AAAA',
      'BBBBBBBB',
      'CCCCCCCC',
      'DDDDDDDD',
      '4821',
      '6204',
      FAKE_KEY,
      TOKEN,
    ]) {
      expect(handed, secret).not.toContain(secret);
    }
  });

  it('with real random draws: every tag is 64 lower-case hex, and no two in a request are the same', async () => {
    const h = setup();
    const { body } = await send(h, ask([first(CECE), first(OMAR), first(NOOR)]));
    const items = h.db.state.handed[0].items;
    const tags = items.flatMap(it => it.candidates.flatMap(c => [c.code_hmac, c.pw_hmac]));
    expect(items.every(it => it.candidates.length === 2)).toBe(true);
    for (const tag of tags) expect(tag).toMatch(/^[0-9a-f]{64}$/);
    expect(new Set(tags).size).toBe(12);
    const handed = JSON.stringify(h.db.state.handed).toUpperCase();
    for (const r of body.results) {
      expect(handed).not.toContain(r.code);
      expect(handed).not.toContain(bare(r.code));
    }
  });

  it('draws again when the random source repeats a code, so no tag is sent twice', async () => {
    // Omar's first draw repeats Cece's first code, and his next repeats her second.
    const random = draws('AAAAAAAA', 'BBBBBBBB', '1111', 'AAAAAAAA', 'BBBBBBBB', 'CCCCCCCC', 'DDDDDDDD', '2222');
    const h = setup({ random });
    const { status, body } = await send(h, ask([first(CECE), first(OMAR)]));
    expect(status).toBe(200);
    expect(body.results.map(r => r.code)).toEqual(['AAAA-AAAA', 'CCCC-CCCC']);
    const tags = h.db.state.handed[0].items.flatMap(it => it.candidates.map(c => c.code_hmac));
    expect(tags).toEqual(['AAAAAAAA', 'BBBBBBBB', 'CCCCCCCC', 'DDDDDDDD'].map(c => codeTag(c)));
    // A student's two candidates are never the same code.
    const twice = setup({ random: draws('AAAAAAAA', 'AAAAAAAA', 'BBBBBBBB', '1111') });
    await send(twice, ask([first(CECE)]));
    expect(twice.db.state.handed[0].items[0].candidates.map(c => c.code_hmac)).toEqual([
      codeTag('AAAAAAAA'),
      codeTag('BBBBBBBB'),
    ]);
  });

  it('a random source that only ever repeats itself is a server error, and nothing is made', async () => {
    const h = setup({ random: into => into.fill(0) });
    const res = await send(h, ask([first(CECE)]));
    expect(res).toEqual({ status: 500, body: { ok: false, error: 'server' } });
    expect(h.db.state.handed).toEqual([]);
  });

  it('uses the second candidate when the first code is already some card’s, and returns that one', async () => {
    const h = setup({ random: draws('AAAAAAAA', 'BBBBBBBB', '4821') });
    // A card made long ago, since replaced, had this code: a tag is unlike every card ever made.
    h.db.state.cards.push({ id: id(55), enrollment_id: NOOR, code_hmac: codeTag('AAAAAAAA'), seq: 1, stopped: true });
    const { body } = await send(h, ask([first(OMAR)]));
    expect(body.results[0]).toMatchObject({ result: 'made', code: 'BBBB-BBBB', password: '4821' });
    expect(h.db.live(OMAR).code_hmac).toBe(codeTag('BBBBBBBB'));
    // The password's tag is the one bound to the second code.
    expect(h.db.live(OMAR).pw_hmac).toBe(passwordTag('BBBBBBBB', '4821'));
    expect(JSON.stringify(body)).not.toContain('AAAA');
  });

  it('both candidates taken: failed, no code, and the teacher presses again', async () => {
    const h = setup({ random: draws('AAAAAAAA', 'BBBBBBBB', '4821') });
    for (const code of ['AAAAAAAA', 'BBBBBBBB']) {
      h.db.state.cards.push({ id: id(60), enrollment_id: NOOR, code_hmac: codeTag(code), seq: 1, stopped: true });
    }
    const { body } = await send(h, ask([first(OMAR)]));
    expect(body).toEqual({ replayed: false, results: [{ enrollment_id: OMAR, result: 'failed' }] });
    expect(h.logs[0]).toMatchObject({ outcome: 'ok', cards: 0 });
  });

  it('returns a code only for a student the database says was made', async () => {
    const h = setup();
    await send(h, ask([first(NOOR)], { request_id: id(7000) }));
    const noorsCard = h.db.live(NOOR).id;
    const { body } = await send(
      h,
      ask([
        first(CECE), // made
        first(GONE), // withdrawn
        first(ELSEWHERE), // another teacher's class
        first(NOOR), // she has a card already: the browser's list was stale
        { enrollment_id: OMAR, replaces: id(999) }, // names a card he does not have
        first(id(4242)), // nobody
      ]),
    );
    expect(body.results).toEqual([
      {
        enrollment_id: CECE,
        result: 'made',
        card_id: h.db.live(CECE).id,
        seq: 1,
        works_until: '2027-01-29',
        code: expect.stringMatching(CODE_SHAPE),
      },
      { enrollment_id: GONE, result: 'not_found' },
      { enrollment_id: ELSEWHERE, result: 'not_found' },
      { enrollment_id: NOOR, result: 'changed' },
      { enrollment_id: OMAR, result: 'changed' },
      { enrollment_id: id(4242), result: 'not_found' },
    ]);
    expect(JSON.stringify(body).match(/"code"/g)).toHaveLength(1);
    expect(JSON.stringify(body)).not.toContain('password');
    // Noor's card is the one she had.
    expect(h.db.live(NOOR).id).toBe(noorsCard);
    expect(h.db.live(OMAR)).toBeUndefined();
  });

  it('Print New Card: names the live card, which stops; the new card is number 2', async () => {
    const h = setup();
    const made = (await send(h, ask([first(OMAR)], { request_id: id(7000) }))).body.results[0];
    const again = (await send(h, ask([{ enrollment_id: OMAR, replaces: made.card_id }]))).body.results[0];
    expect(again).toMatchObject({ result: 'made', seq: 2 });
    expect(again.card_id).not.toBe(made.card_id);
    expect(again.code).not.toBe(made.code);
    expect(h.db.state.cards.map(k => [k.seq, k.stopped])).toEqual([
      [1, true],
      [2, false],
    ]);
    expect(h.db.live(OMAR).code_hmac).toBe(codeTag(again.code));
  });

  it('no students: nothing made, nothing returned', async () => {
    const h = setup();
    expect(await send(h, ask([]))).toEqual({ status: 200, body: { replayed: false, results: [] } });
  });
});

describe('teacher-cards: a replay returns no code', () => {
  it('the same request sent again makes nothing and returns each result with no code', async () => {
    const h = setup();
    const once = (await send(h, ask([first(CECE), first(OMAR)]))).body;
    const twice = await send(h, ask([first(CECE), first(OMAR)]));
    expect(twice.status).toBe(200);
    expect(twice.body).toEqual({
      replayed: true,
      results: once.results.map(r => ({
        enrollment_id: r.enrollment_id,
        result: 'made',
        card_id: r.card_id,
        seq: 1,
        works_until: '2027-01-29',
      })),
    });
    expect(JSON.stringify(twice.body)).not.toMatch(/code|password/);
    expect(h.db.state.cards).toHaveLength(2);
    // The codes drawn for the replay were stored nowhere: the first ones are still the cards'.
    expect(h.db.live(CECE).code_hmac).toBe(codeTag(once.results[0].code));
    expect(h.logs.map(l => [l.outcome, l.cards])).toEqual([
      ['ok', 2],
      ['replayed', 2],
    ]);
  });

  it('even if the database named a candidate on a replay, no code is returned', async () => {
    const h = setup({
      db: {
        issue: async (t, c, items) => ({
          replayed: true,
          results: items.map(it => ({
            enrollment_id: it.enrollment_id,
            result: 'made',
            card_id: id(1),
            seq: 1,
            works_until: '2027-01-29',
            candidate: 0,
            has_password: true,
          })),
        }),
      },
    });
    const { body } = await send(h, ask([first(CECE)]));
    expect(body.results).toEqual([
      { enrollment_id: CECE, result: 'made', card_id: id(1), seq: 1, works_until: '2027-01-29' },
    ]);
  });

  it('another teacher using the same request id is not a replay of this one', async () => {
    const h = setup();
    await send(h, ask([first(CECE)]));
    const other = await send(
      h,
      { course_id: OTHER_COURSE, items: [first(ELSEWHERE)], request_id: REQUEST },
      { authorization: 'Bearer ' + OTHER_TOKEN },
    );
    expect(other.body.replayed).toBe(false);
    expect(other.body.results[0]).toMatchObject({ enrollment_id: ELSEWHERE, result: 'made' });
  });
});

describe('teacher-cards: who is asking', () => {
  it.each([
    ['no Authorization header', { authorization: '' }],
    ['not a bearer token', { authorization: 'Basic dGVhY2hlcjpwYXNzd29yZA==' }],
    ['the word alone', { authorization: 'Bearer ' }],
    ['a token too short to be one', { authorization: 'Bearer abc' }],
    ['two tokens', { authorization: 'Bearer ' + TOKEN + ' ' + TOKEN }],
    ['a token with a line break', { authorization: 'Bearer ' + TOKEN.slice(0, 30) + '\t' + TOKEN.slice(30) }],
    ['a token of 5,000 characters', { authorization: 'Bearer ' + 'a'.repeat(5000) }],
    ['the token in a cookie', { authorization: '', cookie: 'sb-access-token=' + TOKEN }],
    ['the anon key in apikey only', { authorization: '', apikey: TOKEN }],
  ])('%s: 401, and neither Auth nor the database is asked', async (name, headers) => {
    const h = setup();
    const res = await h.handle(post(ask([first(CECE)]), headers));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: 'unauthorized' });
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(h.tokens).toEqual([]);
    expect(h.db.state.handed).toEqual([]);
  });

  it('a token Auth does not accept: 401, and the database is not called', async () => {
    const h = setup();
    const res = await send(h, ask([first(CECE)]), { authorization: 'Bearer ' + EXPIRED });
    expect(res).toEqual({ status: 401, body: { ok: false, error: 'unauthorized' } });
    expect(h.tokens).toEqual([EXPIRED]);
    expect(h.db.state.handed).toEqual([]);
    expect(h.logs).toEqual([{ route: 'issue', outcome: 'unauthorized', ms: expect.any(Number) }]);
  });

  it('an answer from Auth that is not a user id: 401, and the database is not called', async () => {
    for (const answer of [null, undefined, '', 'teacher', 42, { id: TEACHER }, TEACHER + "' or true --", [TEACHER]]) {
      const h = setup({ whoIs: async () => answer });
      const res = await send(h, ask([first(CECE)]));
      expect(res.status, JSON.stringify(answer)).toBe(401);
      expect(h.db.state.handed).toEqual([]);
    }
  });

  it('Auth cannot be asked: a server error, not a 401, and the database is not called', async () => {
    const h = setup({
      whoIs: async token => {
        throw new Error('fetch failed for ' + token);
      },
    });
    const res = await send(h, ask([first(CECE)]));
    expect(res).toEqual({ status: 500, body: { ok: false, error: 'server' } });
    expect(h.db.state.handed).toEqual([]);
    expect(JSON.stringify(h.logs)).not.toContain(TOKEN.slice(0, 12));
    expect(h.logs).toEqual([{ route: 'issue', outcome: 'auth_error', kind: 'Error', ms: expect.any(Number) }]);
  });

  it('the teacher id is the one Auth gave, even when the body names another', async () => {
    const h = setup();
    const body = {
      ...ask([first(CECE)]),
      teacher_id: OTHER_TEACHER,
      p_teacher_id: OTHER_TEACHER,
      user_id: OTHER_TEACHER,
      user: { id: OTHER_TEACHER },
      sub: OTHER_TEACHER,
    };
    const res = await send(h, body, { 'x-teacher-id': OTHER_TEACHER, 'x-user-id': OTHER_TEACHER });
    expect(res.status).toBe(200);
    expect(h.db.state.handed[0].teacherId).toBe(TEACHER);
    expect(JSON.stringify(h.db.state.handed)).not.toContain(OTHER_TEACHER);
    // And the other way: the other teacher's token is the other teacher, whatever the body says.
    const other = setup();
    await send(other, { ...ask([first(CECE)]), teacher_id: TEACHER }, { authorization: 'Bearer ' + OTHER_TOKEN });
    expect(other.db.state.handed[0].teacherId).toBe(OTHER_TEACHER);
  });

  it('another teacher’s class: not found, and nothing is made', async () => {
    const h = setup();
    const res = await send(h, ask([first(CECE)]), { authorization: 'Bearer ' + OTHER_TOKEN });
    expect(res).toEqual({ status: 404, body: { ok: false, error: 'not_found' } });
    expect(h.db.state.cards).toEqual([]);
    expect(h.logs).toEqual([{ route: 'issue', outcome: 'not_found', ms: expect.any(Number) }]);
  });

  it('signed in, but no teacher (the database says so): 401', async () => {
    const stranger = id(950);
    const h = setup({ whoIs: async () => stranger });
    const res = await send(h, ask([first(CECE)]));
    expect(res).toEqual({ status: 401, body: { ok: false, error: 'unauthorized' } });
    expect(h.db.state.handed[0].teacherId).toBe(stranger);
    expect(h.db.state.cards).toEqual([]);
    expect(h.logs[0].outcome).toBe('not_a_teacher');
  });

  it('reads the token only from "Authorization: Bearer"', () => {
    const req = headers => new Request(URL_, { method: 'POST', headers });
    expect(bearer(req({ authorization: 'Bearer ' + TOKEN }))).toBe(TOKEN);
    expect(bearer(req({ authorization: 'bearer ' + TOKEN }))).toBeNull();
    expect(bearer(req({ authorization: TOKEN }))).toBeNull();
    expect(bearer(req({}))).toBeNull();
  });
});

describe('teacher-cards: asking Supabase Auth who a token belongs to (authUser)', () => {
  const fetcher = (status, body) => {
    const calls = [];
    const fn = async (url, init) => {
      calls.push({ url, init });
      return new Response(body === undefined ? null : JSON.stringify(body), { status });
    };
    fn.calls = calls;
    return fn;
  };

  it('asks GET /auth/v1/user with the token, and gives back the user’s id', async () => {
    const fn = fetcher(200, { id: TEACHER.toUpperCase(), email: 'teacher@example.com', role: 'authenticated' });
    const whoIs = authUser(fn, 'https://x.supabase.co/', 'anon-key');
    expect(await whoIs(TOKEN)).toBe(TEACHER);
    expect(fn.calls).toEqual([
      {
        url: 'https://x.supabase.co/auth/v1/user',
        init: { method: 'GET', headers: { Authorization: 'Bearer ' + TOKEN, apikey: 'anon-key' } },
      },
    ]);
  });

  it.each([400, 401, 403, 404, 422])('a %i from Auth is no user', async status => {
    const whoIs = authUser(fetcher(status, { code: status, msg: 'invalid JWT' }), 'https://x.supabase.co', 'anon-key');
    expect(await whoIs(EXPIRED)).toBeNull();
  });

  it.each([429, 500, 502, 503, 204, 301])('a %i from Auth is an error, never a yes and never a 401', async status => {
    const whoIs = authUser(fetcher(status, status === 204 ? undefined : { id: TEACHER }), 'https://x.supabase.co', 'k');
    await expect(whoIs(TOKEN)).rejects.toThrow('auth');
  });

  it('a 200 that names no user is no user', async () => {
    for (const body of [{}, { id: null }, { id: 'me' }, { user: { id: TEACHER } }, [TEACHER], 'ok', null]) {
      const whoIs = authUser(fetcher(200, body), 'https://x.supabase.co', 'anon-key');
      expect(await whoIs(TOKEN), JSON.stringify(body)).toBeNull();
    }
  });

  it('Auth unreachable is an error', async () => {
    const whoIs = authUser(
      async () => {
        throw new TypeError('fetch failed');
      },
      'https://x.supabase.co',
      'anon-key',
    );
    await expect(whoIs(TOKEN)).rejects.toThrow('fetch failed');
  });

  it('the handler never decodes a token itself', () => {
    const source = readFileSync(new URL('../supabase/functions/teacher-cards/handler.ts', import.meta.url), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/atob|jwt|decode|\.split\('\.'\)/i);
    // The only places a teacher id is set: from whoIs.
    expect(code.match(/teacherId = /g)).toEqual(['teacherId = ']);
    expect(code).toContain('teacherId = uuid(await opts.whoIs(token));');
    expect(code).not.toMatch(/body\.(teacher|user|sub)/);
  });
});

describe('teacher-cards: with no card key', () => {
  it.each([
    ['not set', undefined],
    ['empty', ''],
    ['one character short', FAKE_KEY.slice(0, 63)],
    ['one character long', FAKE_KEY + 'a'],
    ['not hex', 'x' + FAKE_KEY.slice(1)],
  ])('%s: a server error, nothing drawn and the database not called', async (name, value) => {
    let drew = 0;
    const h = setup({ cardKey: await readCardKey(value), random: into => (drew++, into.fill(1)) });
    const res = await h.handle(post(ask([first(CECE)])));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: 'server' });
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(h.db.state.handed).toEqual([]);
    expect(drew).toBe(0);
    expect(h.logs).toEqual([{ route: 'issue', outcome: 'no_card_key', ms: expect.any(Number) }]);
  });

  it('an option left out is no key', async () => {
    const h = setup({ cardKey: undefined });
    expect((await send(h, ask([first(CECE)]))).status).toBe(500);
    expect(h.db.state.handed).toEqual([]);
  });

  it('someone not signed in is told 401 and learns nothing about the key', async () => {
    const h = setup({ cardKey: null });
    expect((await send(h, ask([first(CECE)]), { authorization: '' })).status).toBe(401);
    expect((await send(h, ask([first(CECE)]), { authorization: 'Bearer ' + EXPIRED })).status).toBe(401);
  });
});

describe('teacher-cards: the request', () => {
  it('takes up to 250 students and refuses 251 whole', async () => {
    expect(MAX_ITEMS).toBe(250);
    const many = n => Array.from({ length: n }, (_, i) => first(id(10000 + i)));
    const h = setup();
    const ok = await send(h, ask(many(250)));
    expect(ok.status).toBe(200);
    expect(ok.body.results).toHaveLength(250);
    expect(h.db.state.handed[0].items).toHaveLength(250);
    expect(new Set(h.db.state.handed[0].items.flatMap(it => it.candidates.map(c => c.code_hmac))).size).toBe(500);

    const over = setup();
    const res = await send(over, ask([first(CECE), ...many(250)]));
    expect(res).toEqual({ status: 400, body: { ok: false, error: 'bad_request' } });
    expect(over.db.state.handed).toEqual([]);
    expect(over.db.state.cards).toEqual([]);
  });

  it.each([
    ['not JSON', '{course_id:'],
    ['a list', '[]'],
    ['null', 'null'],
    ['no class', { items: [first(CECE)], request_id: REQUEST }],
    ['a class that is no id', ask([first(CECE)], { course_id: 'c1abcd' })],
    ['no request id', { course_id: COURSE, items: [first(CECE)] }],
    ['a request id that is no id', ask([first(CECE)], { request_id: 'again' })],
    ['no items', { course_id: COURSE, request_id: REQUEST }],
    ['items that are not a list', ask({ 0: first(CECE) })],
    ['an item that is not an object', ask([CECE])],
    ['a student that is no id', ask([{ enrollment_id: 'e1', replaces: null }])],
    ['a student with SQL after the id', ask([{ enrollment_id: CECE + "'; --", replaces: null }])],
    ['a card to replace that is no id', ask([{ enrollment_id: CECE, replaces: 'card-2' }])],
    ['a card to replace that is a number', ask([{ enrollment_id: CECE, replaces: 2 }])],
    ['the same student twice', ask([first(CECE), first(OMAR), first(CECE)])],
    ['the same student twice, in another case', ask([first(CECE), first(CECE.toUpperCase())])],
  ])('%s: a bad request, and the database is not called', async (name, body) => {
    const h = setup();
    const res = await send(h, body);
    expect(res).toEqual({ status: 400, body: { ok: false, error: 'bad_request' } });
    expect(h.db.state.handed).toEqual([]);
  });

  it('ignores tags or codes a browser sends: the function draws its own', async () => {
    const h = setup();
    const planted = { code_hmac: 'f'.repeat(64), pw_hmac: 'e'.repeat(64) };
    const body = ask([{ enrollment_id: OMAR, replaces: null, candidates: [planted, planted], code: 'AAAAAAAA' }], {
      key_id: 'ffffffff',
    });
    const res = await send(h, body);
    expect(res.status).toBe(200);
    const handed = JSON.stringify(h.db.state.handed);
    expect(handed).not.toContain('f'.repeat(64));
    expect(handed).not.toContain('ffffffff');
    expect(res.body.results[0].code).not.toBe('AAAA-AAAA');
    expect(h.db.state.handed[0].keyId).toBe(KEY_ID);
  });

  it('reads a request into a class, a request id and its students', () => {
    expect(
      readRequest(ask([first(CECE), { enrollment_id: OMAR.toUpperCase(), replaces: id(7).toUpperCase() }])),
    ).toEqual({
      courseId: COURSE,
      requestId: REQUEST,
      items: [
        { enrollment_id: CECE, replaces: null },
        { enrollment_id: OMAR, replaces: id(7) },
      ],
    });
    // A missing `replaces` is none.
    expect(readRequest(ask([{ enrollment_id: CECE }])).items).toEqual([{ enrollment_id: CECE, replaces: null }]);
  });

  it('refuses a body too large before reading it into a request', async () => {
    const h = setup();
    const res = await send(h, ask([first(CECE)], { padding: 'y'.repeat(70_000) }));
    expect(res).toEqual({ status: 413, body: { ok: false, error: 'too_large' } });
    expect(h.db.state.handed).toEqual([]);
  });
});

describe('teacher-cards: what the database says, and what the browser is given', () => {
  const answering = said => setup({ db: { issue: async () => said }, random: draws('AAAAAAAA', 'BBBBBBBB', '4821') });
  const made = more => ({
    enrollment_id: CECE,
    result: 'made',
    card_id: id(1001),
    seq: 3,
    works_until: '2027-01-29',
    candidate: 1,
    has_password: true,
    ...more,
  });

  it('copies a result field by field: nothing else the database sent reaches the browser', async () => {
    const h = answering({
      replayed: false,
      teacher_id: TEACHER,
      results: [
        made({ code_hmac: 'a'.repeat(64), pw_hmac: 'b'.repeat(64), key_id: KEY_ID, student: { first_name: 'Cece' } }),
      ],
    });
    const { body } = await send(h, ask([first(CECE)]));
    expect(body).toEqual({
      replayed: false,
      results: [
        {
          enrollment_id: CECE,
          result: 'made',
          card_id: id(1001),
          seq: 3,
          works_until: '2027-01-29',
          code: 'BBBB-BBBB',
          password: '4821',
        },
      ],
    });
  });

  it('gives no password unless the database kept one for the card', async () => {
    for (const has_password of [false, undefined, null, 'true', 1]) {
      const h = answering({ replayed: false, results: [made({ has_password })] });
      const { body } = await send(h, ask([first(CECE)]));
      expect(body.results[0].code, String(has_password)).toBe('BBBB-BBBB');
      expect('password' in body.results[0], String(has_password)).toBe(false);
    }
  });

  it('gives no code when the database does not say which candidate it stored', async () => {
    for (const candidate of [undefined, null, 2, -1, '0', '1', true, 0.5]) {
      const h = answering({ replayed: false, results: [made({ candidate })] });
      const { status, body } = await send(h, ask([first(CECE)]));
      expect(status).toBe(200);
      expect(body.results, String(candidate)).toEqual([
        { enrollment_id: CECE, result: 'made', card_id: id(1001), seq: 3, works_until: '2027-01-29' },
      ]);
    }
  });

  it('gives no code or card for a result that is not "made", whatever rode along', async () => {
    for (const result of ['changed', 'not_found', 'failed']) {
      const h = answering({ replayed: false, results: [made({ result })] });
      const { body } = await send(h, ask([first(CECE)]));
      expect(body.results).toEqual([{ enrollment_id: CECE, result }]);
    }
  });

  it('leaves out a student the request did not name, and a second answer for the same student', async () => {
    const h = answering({
      replayed: false,
      results: [made({ enrollment_id: OMAR, candidate: 0 }), made({ candidate: 0 }), made({ candidate: 1 })],
    });
    const { body } = await send(h, ask([first(CECE)]));
    expect(body.results).toHaveLength(1);
    expect(body.results[0]).toMatchObject({ enrollment_id: CECE, code: 'AAAA-AAAA' });
    expect(JSON.stringify(body)).not.toContain('BBBB');
    expect(JSON.stringify(body)).not.toContain(OMAR);
  });

  it.each([
    ['nothing', null],
    ['text', 'ok'],
    ['a list', []],
    ['no replayed', { results: [] }],
    ['replayed that is not yes or no', { replayed: 'false', results: [] }],
    ['no results', { replayed: false }],
    ['a result that is not an object', { replayed: false, results: ['made'] }],
    ['a result nobody knows', { replayed: false, results: [{ enrollment_id: CECE, result: 'ok' }] }],
    ['an old-style refusal', { ok: false, error: 'not_found' }],
  ])('an answer that makes no sense (%s) is a plain server error, with no code in it', async (name, said) => {
    const h = answering(said);
    const res = await send(h, ask([first(CECE)]));
    expect(res).toEqual({ status: 500, body: { ok: false, error: 'server' } });
    expect(h.logs[0]).toMatchObject({ outcome: 'error', kind: 'TypeError' });
  });

  it('the database down: a plain server error, with nothing from the error in the reply or the log', async () => {
    const h = setup({ random: draws('AAAAAAAA', 'BBBBBBBB', '4821') });
    h.db.state.down = true;
    const res = await send(h, ask([first(OMAR)]));
    expect(res).toEqual({ status: 500, body: { ok: false, error: 'server' } });
    expect(h.logs).toEqual([{ route: 'issue', outcome: 'error', kind: 'Error', ms: expect.any(Number) }]);
  });

  it('a refusal the database raises: its SQLSTATE decides the answer and its message is never read', async () => {
    const quoting = state => async (t, c, items) => {
      throw raised(state, `refused ${JSON.stringify(items)} for ${t}`);
    };
    const cases = [
      ['PT401', 401, 'unauthorized', { route: 'issue', outcome: 'not_a_teacher' }],
      ['P0002', 404, 'not_found', { route: 'issue', outcome: 'not_found' }],
      ['22023', 500, 'server', { route: 'issue', outcome: 'error', kind: 'PostgresError', sqlstate: '22023' }],
      ['40001', 500, 'server', { route: 'issue', outcome: 'error', kind: 'PostgresError', sqlstate: '40001' }],
      ['57014', 500, 'server', { route: 'issue', outcome: 'error', kind: 'PostgresError', sqlstate: '57014' }],
      ['not a state; drop', 500, 'server', { route: 'issue', outcome: 'error', kind: 'PostgresError' }],
    ];
    for (const [state, status, error, line] of cases) {
      const h = setup({ db: { issue: quoting(state) } });
      const res = await send(h, ask([first(CECE)]));
      expect(res, state).toEqual({ status, body: { ok: false, error } });
      expect(h.logs, state).toEqual([{ ...line, ms: expect.any(Number) }]);
    }
  });
});

describe('teacher-cards: the region, the origins and the cache, as student-submit has them', () => {
  it('refuses to run outside ca-central-1, before Auth or the database is asked', async () => {
    for (const region of ['us-east-1', 'ca-central-2', undefined]) {
      const h = setup({ region });
      const res = await h.handle(post(ask([first(CECE)])));
      expect(res.status).toBe(421);
      expect(await res.json()).toEqual({ ok: false, error: 'wrong_region' });
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(h.tokens).toEqual([]);
      expect(h.db.state.handed).toEqual([]);
    }
  });

  it('takes POST only', async () => {
    const h = setup();
    for (const method of ['GET', 'PUT', 'DELETE', 'PATCH']) {
      const res = await h.handle(new Request(URL_, { method, headers: { authorization: 'Bearer ' + TOKEN } }));
      expect(res.status, method).toBe(405);
    }
    expect(h.tokens).toEqual([]);
    expect(h.db.state.handed).toEqual([]);
  });

  const ORIGINS = [
    'https://fullvision.ca',
    'https://www.fullvision.ca',
    'https://deploy-preview-12--fullvision.netlify.app',
    'http://localhost:8347',
    'http://127.0.0.1:8347',
    'http://localhost',
    'https://evil.example',
    'https://fullvision.ca.evil.example',
    'https://evilfullvision.ca',
    'http://fullvision.ca',
    'https://deploy-preview-12--other.netlify.app',
    'https://deploy-preview-x--fullvision.netlify.app',
    'https://localhost:8347',
    'http://localhost.evil.example',
    'null',
    '',
    null,
  ];

  it('allows the same origins as student-submit, and the same region', () => {
    expect(REGION).toBe(STUDENT_REGION);
    for (const origin of ORIGINS) {
      expect(allowedOrigin(origin), String(origin)).toBe(studentAllowedOrigin(origin));
    }
    expect(ORIGINS.filter(o => allowedOrigin(o))).toHaveLength(6);
  });

  it('answers a preflight from the site, and lets the sign-in token through', async () => {
    const h = setup();
    const options = origin => h.handle(new Request(URL_, { method: 'OPTIONS', headers: origin ? { origin } : {} }));
    const ok = await options('https://fullvision.ca');
    expect(ok.status).toBe(204);
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://fullvision.ca');
    expect(ok.headers.get('access-control-allow-methods')).toBe('POST, OPTIONS');
    expect(ok.headers.get('access-control-allow-headers').split(', ')).toEqual(
      expect.arrayContaining(['authorization', 'content-type']),
    );
    expect(ok.headers.get('vary')).toBe('Origin');
    // No cookies: the token is in a header, so credentials are never allowed.
    expect(ok.headers.get('access-control-allow-credentials')).toBeNull();
    for (const origin of ['https://evil.example', undefined]) {
      const no = await options(origin);
      expect(no.status).toBe(403);
      expect(no.headers.get('access-control-allow-origin')).toBeNull();
    }
    expect(h.tokens).toEqual([]);
  });

  it('every reply is no-store and names only an allowed origin', async () => {
    const replies = [];
    const h = setup();
    replies.push(await h.handle(post(ask([first(CECE)]))));
    replies.push(await h.handle(post(ask([first(CECE)])))); // replayed
    replies.push(await h.handle(post(ask([first(CECE)]), { authorization: '' }))); // 401
    replies.push(await h.handle(post('{'))); // 400
    replies.push(await h.handle(new Request(URL_, { method: 'GET', headers: { origin: 'https://fullvision.ca' } })));
    replies.push(await setup({ cardKey: null }).handle(post(ask([first(CECE)])))); // 500
    replies.push(await setup({ region: 'us-east-1' }).handle(post(ask([first(CECE)])))); // 421
    expect(replies.map(r => r.status)).toEqual([200, 200, 401, 400, 405, 500, 421]);
    for (const res of replies) {
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('content-type')).toBe('application/json');
      expect(res.headers.get('access-control-allow-origin')).toBe('https://fullvision.ca');
    }
    const elsewhere = await h.handle(
      post(ask([first(OMAR)], { request_id: id(7002) }), { origin: 'https://evil.example' }),
    );
    expect(elsewhere.headers.get('access-control-allow-origin')).toBeNull();
    expect(elsewhere.headers.get('cache-control')).toBe('no-store');
  });
});

describe('teacher-cards: no log line holds a secret', () => {
  it('across every outcome: route, outcome, how many cards, time, and the kind of an error', async () => {
    const logs = [];
    const secrets = new Set([FAKE_KEY, FAKE_KEY.slice(0, 12), KEY_ID, TOKEN, TOKEN.slice(0, 16), TOKEN.slice(-12)]);
    const run = async (over, body, headers) => {
      const h = setup(over);
      const res = await send(h, body || ask([first(CECE), first(OMAR), first(NOOR), first(GONE)]), headers);
      logs.push(...h.logs);
      for (const r of (res.body && res.body.results) || []) {
        if (r.code) [r.code, bare(r.code), r.code.slice(0, 4)].forEach(s => secrets.add(s));
        if (r.password) secrets.add(r.password);
      }
      for (const call of h.db.state.handed) {
        for (const it of call.items || []) {
          for (const c of it.candidates)
            [c.code_hmac, c.pw_hmac, c.code_hmac.slice(0, 12)].forEach(s => secrets.add(s));
        }
      }
      return h;
    };
    // Known draws, so every secret this test looks for is known: four students, then four more for the replay.
    const rep = ch => ch.repeat(8);
    const known = ['E', 'F', '9358', 'G', 'H', '6204', 'J', 'K', '7716', 'M', 'N', '8493'];
    const again = ['P', 'Q', '2222', 'R', 'T', '3333', 'U', 'V', '4444', 'W', 'X', '6666'];
    const h = await run({ random: draws(...[...known, ...again].map(v => (v.length === 1 ? rep(v) : v))) });
    for (const v of [...known, ...again])
      secrets.add(v.length === 1 ? rep(v) : v).add(v.length === 1 ? v.repeat(4) : v);
    // The same request again, on the same database: a replay.
    await send(h, ask([first(CECE), first(OMAR), first(NOOR), first(GONE)]));
    logs.push(h.logs.at(-1));
    await run({ random: draws('AAAAAAAA', 'BBBBBBBB', '4821') }, ask([first(OMAR)]));
    ['AAAAAAAA', 'AAAA', 'BBBB', '4821'].forEach(s => secrets.add(s));
    await run(null, null, { authorization: '' });
    await run(null, null, { authorization: 'Bearer ' + EXPIRED });
    await run(null, null, { authorization: 'Bearer ' + OTHER_TOKEN });
    await run({ whoIs: async () => id(950) });
    await run({
      whoIs: async token => {
        throw new Error('no route to auth for ' + token);
      },
    });
    await run({ cardKey: null });
    await run({ region: 'us-east-1' });
    await run(null, '{');
    await run(null, ask([first(CECE)], { padding: 'y'.repeat(70_000) }));
    await run({
      db: {
        issue: async (t, c, items) => {
          throw raised('22023', `${FAKE_KEY} ${TOKEN} ${JSON.stringify(items)}`);
        },
      },
    });
    await run({ db: { issue: async () => ({ replayed: false, results: ['?'] }) } });

    expect(new Set(logs.map(l => l.outcome))).toEqual(
      new Set([
        'ok',
        'replayed',
        'unauthorized',
        'not_found',
        'not_a_teacher',
        'auth_error',
        'no_card_key',
        'wrong_region',
        'bad_request',
        'too_large',
        'error',
      ]),
    );
    expect(secrets.size).toBeGreaterThan(30);
    const text = JSON.stringify(logs);
    for (const secret of secrets) expect(text, secret).not.toContain(secret);
    for (const other of [
      EXPIRED,
      OTHER_TOKEN,
      TEACHER,
      OTHER_TEACHER,
      CECE,
      OMAR,
      COURSE,
      REQUEST,
      'Cece',
      'refused',
    ]) {
      expect(text, other).not.toContain(other);
    }
    for (const line of logs) {
      expect(
        Object.keys(line).every(k => ['route', 'outcome', 'cards', 'ms', 'kind', 'sqlstate', 'region'].includes(k)),
      ).toBe(true);
      for (const value of Object.values(line)) {
        expect(String(value).length).toBeLessThan(20);
        expect(String(value)).not.toMatch(/[0-9a-f]{8}/);
      }
    }
  });
});

describe('teacher-cards: where the key, Auth and the database come from (index.ts)', () => {
  const index = readFileSync(new URL('../supabase/functions/teacher-cards/index.ts', import.meta.url), 'utf8');
  const code = index.replace(/^\s*\/\/.*$/gm, '');

  it('reads STUDENT_CARD_KEY once, through readCardKey, with no fallback', () => {
    expect(code.match(/STUDENT_CARD_KEY/g)).toHaveLength(1);
    expect(code).toContain(
      "const cardKey = await loadCardKey('teacher-cards', () => Deno.env.get('STUDENT_CARD_KEY'));",
    );
    // It logs nothing itself: the one line at start is loadCardKey's.
    expect(code.match(/console\.\w+\(/g)).toBeNull();
  });

  it('asks the project’s own Supabase Auth who a token belongs to', () => {
    expect(code).toContain(
      "whoIs: authUser(fetch, Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!),",
    );
    // The service key is never used here: Auth is asked as the teacher, with the teacher's own token.
    expect(code).not.toMatch(/SERVICE_ROLE/);
  });

  it('runs one statement: issue_cards, with every value a parameter', () => {
    const statements = code.match(/sql`[^`]*`/g);
    expect(statements).toHaveLength(1);
    const text = statements[0].replace(/\s+/g, ' ');
    expect(text).toBe(
      'sql` select student_submit.issue_cards( ${teacherId}::uuid, ${courseId}::uuid, ${sql.json(items)}::jsonb, ${keyId}::text, ${requestId}::uuid) as r`',
    );
    expect(code).not.toMatch(/sql\.unsafe/);
    expect(code).not.toMatch(/cardKey[^,V\n]*\$\{|\$\{[^}]*cardKey/);
  });
});
