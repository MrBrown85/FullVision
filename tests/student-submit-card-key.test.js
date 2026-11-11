/**
 * The student-submit function and the card key (S3-E1).
 *
 * The database cannot read a card's code. The function tidies the code the
 * phone sent, makes its tag with STUDENT_CARD_KEY and hands the database
 * the tag; a card's own four-digit password goes the same way. This checks
 * what that must never get wrong:
 *
 *   - the database is handed the tag, and never the code or the password
 *     as typed, on card, verify and add-card;
 *   - no log line holds a code, a tag, the key, a password or a token;
 *   - with the key missing, short or not hex, those three routes answer a
 *     plain server error and ask the database nothing, while the four slip
 *     routes, page, seen and done are exactly as they are with a key;
 *   - a code that is not eight characters is no card's: not_found, and the
 *     database is not asked;
 *   - a replaced card answers card_stopped.
 *
 * The tags expected here are made a second way, with Node's own HMAC
 * (tests/helpers/card-key-fake.js), and the known answers themselves are in
 * tests/card-key.test.js.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readCardKey } from '../supabase/functions/_shared/card-key.ts';
import { makeHandler } from '../supabase/functions/student-submit/handler.ts';
import { CARD_ROUTES } from '../supabase/functions/student-submit/card-routes.ts';
import { FAKE_KEY, codeTag, keyId, passwordTag } from './helpers/card-key-fake.js';
import { CECE, fakeStudentSubmit, sampleCard } from './helpers/fake-student-submit.js';

const CODE = 'P3R8WD4K';
const TAG = codeTag(CODE);
const KEY = await readCardKey(FAKE_KEY);
const KEY_ID = keyId();
const SESSION = 'a'.repeat(64);
const NEW_SESSION = 'd'.repeat(64);
const ENROLLMENT = '11111111-1111-4111-8111-111111111111';
const WORK = '77777777-7777-4777-8777-777777777777';
const HASH = expect.stringMatching(/^[0-9a-f]{64}$/);

// Keys that are no key: each is read exactly as the function reads the secret.
const NO_KEY = {
  'not set': undefined,
  empty: '',
  'one character short': FAKE_KEY.slice(0, 63),
  'one character long': FAKE_KEY + '0',
  'not hex': 'z' + FAKE_KEY.slice(1),
  'a newline after it': FAKE_KEY + '\n',
};

const CARD_OK = {
  ok: true,
  kind: 'card',
  student: { first_name: 'Cece' },
  course: { name: 'Science 8', block: 'B' },
  check: 'identity',
  also_password: true,
};
const VERIFIED = {
  ok: true,
  session_token: NEW_SESSION,
  expires_at: '2026-11-11T08:00:00+00:00',
  enrollment_id: ENROLLMENT,
  classes: [{ enrollment_id: ENROLLMENT, student: { first_name: 'Cece' }, course: { name: 'Science 8', block: 'B' } }],
};

/* A handler over a database that records everything it is handed and
   answers yes. `cardKey` is what readCardKey made of the secret. */
function setup(cardKey, answers) {
  const asked = []; // every value that reached the database, by function
  const logs = [];
  const answer = Object.assign(
    {
      card: () => CARD_OK,
      verify_card: () => VERIFIED,
      page: () => ({ ok: true, v: 1, expires_at: VERIFIED.expires_at, tags: {}, rubrics: [] }),
      seen: () => ({ ok: true, seen: 1 }),
      done: () => ({ ok: true }),
      // A slip's open and verify, with tags since plan S3-S1 (slip-routes.ts).
      open: () => ({ ok: true, parts: [], slip: 'open' }),
      verify: () => ({ ok: true, parts: [], slip: 'verify' }),
    },
    answers,
  );
  const slip = name => async (first, second, third) => {
    asked.push({ fn: name, params: [first, second, third] });
    return { ok: true, parts: [], slip: name };
  };
  const handle = makeHandler({
    region: 'ca-central-1',
    ipKey: 'test-key',
    cardKey,
    log: entry => logs.push(entry),
    db: {
      open: slip('open'),
      verify: slip('verify'),
      check: slip('check'),
      submit: slip('submit'),
      async call(text, params) {
        const fn = /^select student_submit\.(\w+)\(/.exec(text)[1];
        asked.push({ fn, sql: text, params });
        return JSON.parse(JSON.stringify(answer[fn](...params)));
      },
    },
  });
  return { handle, asked, logs };
}

const post = (body, headers) =>
  new Request('https://x.supabase.co/functions/v1/student-submit?forceFunctionRegion=ca-central-1', {
    method: 'POST',
    headers: Object.assign(
      { 'content-type': 'application/json', origin: 'https://fullvision.ca', 'cf-connecting-ip': '203.0.113.7' },
      headers,
    ),
    body: JSON.stringify(body),
  });
const send = async (h, body) => {
  const res = await h.handle(post(body));
  return { status: res.status, body: await res.json() };
};

// The three routes that take a card's code, and the rest.
const CODE_ROUTES = {
  card: { route: 'card', code: CODE },
  verify: { route: 'verify', code: CODE, password: '4821' },
  'add-card': { route: 'add-card', code: CODE, password: '4821', session: SESSION },
};
// A slip's open needs the key since plan S3-S1: it is tested on its own below.
const OTHER_ROUTES = {
  'verify (a slip’s)': { route: 'verify', token: SESSION, student_number: '0123456' },
  check: { route: 'check', token: SESSION, birthday: '2012-05-15' },
  submit: { route: 'submit', token: SESSION, answers: { q1: 'a' } },
  page: { route: 'page', session: SESSION, enrollment_id: ENROLLMENT },
  seen: { route: 'seen', session: SESSION, enrollment_id: ENROLLMENT, assessment_ids: [WORK] },
  done: { route: 'done', session: SESSION },
};

describe('student-submit: the database is handed a tag, never the code or the typed password', () => {
  // The same card, typed and scanned every way a student might.
  const TYPED = ['P3R8WD4K', 'P3R8-WD4K', 'p3r8-wd4k', ' p3r8 wd4k ', 'P3R8–WD4K', '#P3R8-WD4K', 'P-3-R-8-W-D-4-K'];

  it.each(TYPED)('card: "%s" reaches the database as the one tag', async typed => {
    const h = setup(KEY);
    expect(await send(h, { route: 'card', code: typed })).toEqual({ status: 200, body: CARD_OK });
    expect(h.asked).toEqual([
      { fn: 'card', sql: 'select student_submit.card($1::text, $2::text, $3::text) as r', params: [TAG, KEY_ID, HASH] },
    ]);
  });

  it.each(['verify', 'add-card'])('%s: the code and the password each reach the database as a tag', async route => {
    for (const typed of TYPED) {
      for (const password of ['4821', ' 4821 ', '48-21', '48 21']) {
        const h = setup(KEY);
        const res = await send(h, { ...CODE_ROUTES[route], code: typed, password });
        expect(res.body.ok).toBe(true);
        expect(h.asked).toHaveLength(1);
        expect(h.asked[0].sql).toBe(CARD_ROUTES[route].sql);
        expect(h.asked[0].params).toEqual([
          TAG,
          KEY_ID,
          null,
          null,
          passwordTag(CODE, '4821'),
          route === 'add-card' ? SESSION : null,
          HASH,
        ]);
      }
    }
  });

  it('nothing handed to the database holds the code or the typed password, in any form', async () => {
    const h = setup(KEY);
    for (const body of Object.values(CODE_ROUTES)) await send(h, body);
    await send(h, { route: 'verify', code: 'p3r8-wd4k', password: '4821', birthday: '2012-05-15', session: SESSION });
    await send(h, { route: 'verify', code: CODE, password: 'hunter2' });
    expect(h.asked).toHaveLength(5);
    const handed = JSON.stringify(h.asked).toUpperCase();
    for (const secret of [CODE, 'P3R8', 'WD4K', 'P3R8-WD4K', '4821', 'HUNTER2', FAKE_KEY.toUpperCase()]) {
      expect(handed, secret).not.toContain(secret);
    }
    // Every parameter is a tag, the key id, the birthday, the session token, the hashed address, or nothing.
    const known = new Set([
      TAG,
      KEY_ID,
      passwordTag(CODE, '4821'),
      passwordTag(CODE, 'HUNTER2'),
      '2012-05-15',
      SESSION,
      null,
    ]);
    for (const call of h.asked) {
      const params = call.params.slice(0, -1);
      for (const p of params) expect(known.has(p), String(p)).toBe(true);
      expect(call.params.at(-1)).toMatch(/^[0-9a-f]{64}$/);
      // And none of it is in the statement.
      expect(call.sql).toMatch(
        /^select student_submit\.(card|verify_card)\((\$\d::text(, )?)+(p_add => (true|false))?\) as r$/,
      );
    }
  });

  it('a tag is 64 lower-case hex and the key id 8, as the database insists', async () => {
    const h = setup(KEY);
    await send(h, CODE_ROUTES.verify);
    const [tag, id, , , password] = h.asked[0].params;
    expect(tag).toMatch(/^[0-9a-f]{64}$/);
    expect(id).toMatch(/^[0-9a-f]{8}$/);
    expect(password).toMatch(/^[0-9a-f]{64}$/);
    expect(password).not.toBe(tag);
  });

  it('no password typed is no tag: the database is handed nothing in its place', async () => {
    for (const body of [
      { route: 'verify', code: CODE, birthday: '2012-05-15' },
      { route: 'verify', code: CODE, student_number: '0123456', password: '' },
      { route: 'verify', code: CODE, student_number: '0123456', password: null },
    ]) {
      const h = setup(KEY);
      await send(h, body);
      expect(h.asked[0].params[4], JSON.stringify(body)).toBeNull();
    }
  });

  it('a typed password that is not four digits is still only a tag, and matches no card', async () => {
    for (const password of ['abcd', '48211', '482', '४८२१', '--', 'p_add => true', "'; drop"]) {
      const h = setup(KEY);
      const res = await send(h, { route: 'verify', code: CODE, password });
      expect(res.status, password).toBe(200);
      const handed = h.asked[0].params[4];
      expect(handed, password).toMatch(/^[0-9a-f]{64}$/);
      expect(handed, password).not.toBe(passwordTag(CODE, '4821'));
      expect(JSON.stringify(h.asked), password).not.toContain(password);
    }
  });

  it('a student number and a birthday go to the database as typed: they are checked there, where they live', async () => {
    const h = setup(KEY);
    await send(h, { route: 'verify', code: CODE, birthday: '2012-05-15', student_number: '0123456' });
    expect(h.asked[0].params).toEqual([TAG, KEY_ID, '2012-05-15', '0123456', null, null, HASH]);
  });

  it('another key makes another tag for the same card, and says which key it is', async () => {
    const other = 'ab'.repeat(32);
    const h = setup(await readCardKey(other));
    await send(h, CODE_ROUTES.verify);
    expect(h.asked[0].params.slice(0, 2)).toEqual([codeTag(CODE, other), keyId(other)]);
    expect(h.asked[0].params[4]).toBe(passwordTag(CODE, '4821', other));
    expect(h.asked[0].params[0]).not.toBe(TAG);
  });

  it('the statements do not fit the database from before S3-M1, so old and new can never half-work together', () => {
    // Before S3-E1 card took two values (the code, the address) and verify_card six. Now they take three and
    // seven. The function from before cannot call the database after S3-M1, nor this one the database before
    // it: either way the call fails and nothing opens.
    const values = sql => sql.match(/\$\d/g).length;
    expect(values(CARD_ROUTES.card.sql)).toBe(3);
    expect(values(CARD_ROUTES.verify.sql)).toBe(7);
    expect(values(CARD_ROUTES['add-card'].sql)).toBe(7);
    // page, seen and done are called as they were before S3-E1.
    expect(CARD_ROUTES.page.sql).toBe('select student_submit.page($1::text, $2::uuid, $3::text) as r');
    expect(CARD_ROUTES.seen.sql).toBe('select student_submit.seen($1::text, $2::uuid, $3::uuid[], $4::text) as r');
    expect(CARD_ROUTES.done.sql).toBe('select student_submit.done($1::text, $2::text) as r');
  });
});

describe('student-submit: a code that is not eight characters is no card', () => {
  // Six (a slip), seven, nine, one, and four that tidy to nothing or to too few.
  const NOT_A_CARD = [
    'K7M4QX',
    'K7M-4QX',
    'k7m 4qx',
    'P3R8WD4',
    'P3R8WD4K2',
    'P',
    '--------',
    '!!!',
    'ÀÉÎÕÜÇÑß',
    'P3R8 WD4 ',
  ];

  it.each(Object.keys(CODE_ROUTES))('%s: not_found, and the database is not asked', async route => {
    const h = setup(KEY);
    for (const code of NOT_A_CARD) {
      const res = await send(h, { ...CODE_ROUTES[route], code });
      expect(res, code).toEqual({ status: 200, body: { ok: false, error: 'not_found' } });
    }
    expect(h.asked).toEqual([]);
    // The function's own log says what it answered and nothing of the code.
    expect(h.logs).toHaveLength(NOT_A_CARD.length);
    for (const line of h.logs) expect(line).toEqual({ route, outcome: 'not_found', ms: expect.any(Number) });
  });

  it('is answered the same with no key: knowing a code is no card needs no key', async () => {
    for (const value of Object.values(NO_KEY)) {
      const h = setup(await readCardKey(value));
      for (const route of Object.keys(CODE_ROUTES)) {
        const res = await send(h, { ...CODE_ROUTES[route], code: 'K7M-4QX' });
        expect(res).toEqual({ status: 200, body: { ok: false, error: 'not_found' } });
      }
      expect(h.asked).toEqual([]);
    }
  });

  it('eight characters that no card could hold are still asked of the database, and counted there as a guess', async () => {
    // I, L, O, S, 0, 1 and 5 are not in the alphabet. The function tells cards from slips by length alone.
    const h = setup(KEY, { card: () => ({ ok: false, error: 'not_found' }) });
    const res = await send(h, { route: 'card', code: 'OIL5-0015' });
    expect(res.body).toEqual({ ok: false, error: 'not_found' });
    expect(h.asked).toHaveLength(1);
    expect(h.asked[0].params[0]).toBe(codeTag('OIL50015'));
  });

  it('a request of the wrong shape is still a bad request, before any of this', async () => {
    const h = setup(KEY);
    for (const body of [
      { route: 'card' },
      { route: 'card', code: '' },
      { route: 'card', code: 12345678 },
      { route: 'card', code: 'P'.repeat(33) },
      { route: 'verify', code: CODE },
      { route: 'add-card', code: CODE, password: '4821' },
    ]) {
      expect((await send(h, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(h.asked).toEqual([]);
  });
});

describe('student-submit: with no card key', () => {
  it.each(Object.keys(NO_KEY))('%s: reads as no key', async name => {
    expect(await readCardKey(NO_KEY[name])).toBeNull();
  });

  it.each(Object.keys(NO_KEY))(
    '%s: card, verify and add-card answer a plain server error and ask nothing',
    async name => {
      const h = setup(await readCardKey(NO_KEY[name]));
      for (const [route, body] of Object.entries(CODE_ROUTES)) {
        const res = await h.handle(post(body));
        expect(res.status, route).toBe(500);
        expect(await res.json(), route).toEqual({ ok: false, error: 'server' });
        expect(res.headers.get('cache-control')).toBe('no-store');
      }
      expect(h.asked).toEqual([]);
      expect(h.logs).toEqual(
        Object.keys(CODE_ROUTES).map(route => ({ route, outcome: 'no_card_key', ms: expect.any(Number) })),
      );
    },
  );

  it('a slip’s open answers a plain server error too (its code goes as a tag since plan S3-S1), and asks nothing', async () => {
    for (const [name, value] of Object.entries(NO_KEY)) {
      const h = setup(await readCardKey(value));
      expect(await send(h, { route: 'open', code: 'K7M4QX' }), name).toEqual({
        status: 500,
        body: { ok: false, error: 'server' },
      });
      expect(h.asked, name).toEqual([]);
      expect(
        h.logs.map(l => [l.route, l.outcome]),
        name,
      ).toEqual([['open', 'no_card_key']]);
    }
  });

  it.each(Object.keys(OTHER_ROUTES))('%s carries on exactly as it does with a key', async route => {
    const withKey = setup(KEY);
    const expected = await send(withKey, OTHER_ROUTES[route]);
    expect(expected.status).toBe(200);
    expect(expected.body.ok).toBe(true);
    expect(withKey.asked).toHaveLength(1);
    for (const [name, value] of Object.entries(NO_KEY)) {
      const h = setup(await readCardKey(value));
      expect(await send(h, OTHER_ROUTES[route]), name).toEqual(expected);
      expect(h.asked, name).toEqual(withKey.asked);
      expect(
        h.logs.map(l => [l.route, l.outcome]),
        name,
      ).toEqual(withKey.logs.map(l => [l.route, l.outcome]));
    }
  });

  it('an option left out is no key, not a default one', async () => {
    const calls = [];
    const handle = makeHandler({
      region: 'ca-central-1',
      ipKey: 'test-key',
      log: () => {},
      db: { call: async (...args) => (calls.push(args), CARD_OK) },
    });
    expect((await handle(post(CODE_ROUTES.card))).status).toBe(500);
    expect(calls).toEqual([]);
  });

  it('the address-hash key is never used in its place', async () => {
    // ipKey is another secret. A function with one and not the other makes no tag from it.
    const calls = [];
    const handle = makeHandler({
      region: 'ca-central-1',
      ipKey: FAKE_KEY,
      cardKey: null,
      log: () => {},
      db: { call: async (...args) => (calls.push(args), CARD_OK) },
    });
    expect((await handle(post(CODE_ROUTES.verify))).status).toBe(500);
    expect(calls).toEqual([]);
  });
});

describe('student-submit: a replaced card', () => {
  it.each(Object.keys(CODE_ROUTES))('%s passes card_stopped on, with nothing else', async route => {
    const stopped = () => ({ ok: false, error: 'card_stopped', card_id: WORK, student: { first_name: 'Cece' } });
    const h = setup(KEY, { card: stopped, verify_card: stopped });
    expect(await send(h, CODE_ROUTES[route])).toEqual({ status: 200, body: { ok: false, error: 'card_stopped' } });
    expect(h.logs).toEqual([{ route, outcome: 'card_stopped', ms: expect.any(Number) }]);
  });
});

describe('student-submit: no log line holds a secret', () => {
  const BIRTHDAY = '2012-05-15';
  const NUMBER = '0123456';

  /* Every outcome a card request can have: a yes, each refusal, a wrong
     try, a code that is no card's, no key, a reply that makes no sense and
     a database error that quotes what it was handed. */
  async function everything() {
    const logs = [];
    const run = async (cardKey, answers, bodies) => {
      const h = setup(cardKey, answers);
      for (const body of bodies) await send(h, body);
      logs.push(...h.logs);
      return h;
    };
    const all = [
      ...Object.values(CODE_ROUTES),
      { route: 'verify', code: 'p3r8-wd4k', birthday: BIRTHDAY, student_number: NUMBER, password: '4821' },
      { route: 'add-card', code: CODE, birthday: BIRTHDAY, session: SESSION },
      ...Object.values(OTHER_ROUTES),
    ];
    await run(KEY, null, all);
    for (const error of ['not_found', 'card_stopped', 'closed', 'card_locked', 'card_expired', 'reprint', 'locked']) {
      const no = () => ({ ok: false, error });
      await run(KEY, { card: no, verify_card: no }, Object.values(CODE_ROUTES));
    }
    await run(KEY, { verify_card: () => ({ ok: false, error: 'wrong_identity', tries_left: 3 }) }, all);
    await run(KEY, null, [
      { route: 'card', code: 'K7M-4QX' },
      { route: 'verify', code: 'K7M4QX', password: '4821' },
    ]);
    await run(null, null, all);
    await run(KEY, { card: () => null, verify_card: () => ({ ok: 'yes' }) }, Object.values(CODE_ROUTES));
    const quoting = (...params) => {
      throw new Error(`function student_submit.card(${params.join(', ')}) does not exist: ${CODE} 4821 ${FAKE_KEY}`);
    };
    await run(KEY, { card: quoting, verify_card: quoting, page: quoting }, all);
    return logs;
  }

  it('across every outcome: route, outcome, time, and the kind of an error', async () => {
    const logs = await everything();
    expect(logs.length).toBeGreaterThan(60);
    const text = JSON.stringify(logs);
    for (const secret of [
      CODE,
      'P3R8',
      'WD4K',
      'p3r8',
      'K7M',
      TAG,
      TAG.slice(0, 10),
      TAG.slice(-10),
      passwordTag(CODE, '4821'),
      passwordTag(CODE, '4821').slice(0, 10),
      FAKE_KEY,
      FAKE_KEY.slice(0, 10),
      KEY_ID,
      '4821',
      SESSION,
      'aaaaaaaa',
      NEW_SESSION,
      BIRTHDAY,
      '2012',
      NUMBER,
      'Cece',
      'Science',
      ENROLLMENT,
      '203.0.113',
      'does not exist',
    ]) {
      expect(text, secret).not.toContain(secret);
    }
    // Nothing in a log line is long enough to be a tag, a key or a token, or shaped like a code.
    for (const line of logs) {
      expect(Object.keys(line).every(k => ['route', 'outcome', 'ms', 'kind'].includes(k))).toBe(true);
      for (const value of Object.values(line)) {
        expect(String(value)).not.toMatch(/[0-9a-f]{8}/);
        expect(String(value).length).toBeLessThan(20);
      }
    }
    expect(new Set(logs.map(l => l.outcome))).toEqual(
      new Set([
        'ok',
        'not_found',
        'card_stopped',
        'closed',
        'card_locked',
        'card_expired',
        'reprint',
        'locked',
        'wrong_identity',
        'no_card_key',
        'error',
      ]),
    );
  });

  it('a reply never holds the key, a tag or the key id', async () => {
    const h = setup(KEY, {
      // A database that echoed what it was handed: the reply's copy still names its fields one by one.
      card: (tag, id) => ({ ...CARD_OK, tag, key_id: id, code_hmac: tag }),
      verify_card: (tag, id, b, n, pw) => ({ ...VERIFIED, code_hmac: tag, pw_hmac: pw, key_id: id }),
    });
    let text = '';
    for (const body of Object.values(CODE_ROUTES)) text += JSON.stringify((await send(h, body)).body);
    for (const secret of [TAG, passwordTag(CODE, '4821'), KEY_ID, FAKE_KEY, 'hmac', 'key_id']) {
      expect(text, secret).not.toContain(secret);
    }
  });
});

describe('student-submit: where the key comes from (index.ts)', () => {
  const index = readFileSync(new URL('../supabase/functions/student-submit/index.ts', import.meta.url), 'utf8');
  const code = index.replace(/^\s*\/\/.*$/gm, '');

  it('reads STUDENT_CARD_KEY once, inside loadCardKey, with no fallback, and keeps its text under no name', () => {
    expect(code.match(/STUDENT_CARD_KEY/g)).toHaveLength(1);
    expect(code).toContain(
      "const cardKey = await loadCardKey('student-submit', () => Deno.env.get('STUDENT_CARD_KEY'));",
    );
    expect(code).toMatch(/makeHandler\(\{\s*region: Deno\.env\.get\('SB_REGION'\),\s*cardKey,/);
  });

  it('logs nothing itself: the one line at start is loadCardKey’s', () => {
    expect(code.match(/console\.\w+\(/g)).toBeNull();
  });

  it('hands the key to nothing but the handler: it is in no statement', () => {
    for (const line of code.split('\n').filter(l => /sql`|sql\.unsafe|sql\.json/.test(l))) {
      expect(line).not.toMatch(/cardKey/);
    }
  });

  it('still falls back to the database address for the address-hash key (to be removed in a later change)', () => {
    expect(code).toContain("ipKey: Deno.env.get('STUDENT_SUBMIT_IP_KEY') || Deno.env.get('SUPABASE_DB_URL')!,");
  });
});

describe('the stand-in function the student page’s tests use (tests/helpers/fake-student-submit.js)', () => {
  const TODAY = '2026-11-10';
  const card8 = more => sampleCard(TODAY, { code: 'P3R8WD4K', ...more });

  it('is the function in the repo: the card opens by its tag', async () => {
    const fn = fakeStudentSubmit({ cards: [card8()] });
    expect(await fn.handle({ route: 'card', code: 'p3r8-wd4k' })).toMatchObject({ ok: true, kind: 'card' });
    const verified = await fn.handle({ route: 'verify', code: 'P3R8-WD4K', birthday: '2012-05-15' });
    expect(verified).toMatchObject({ ok: true, enrollment_id: CECE });
    const page = await fn.handle({ route: 'page', session: verified.session_token, enrollment_id: CECE });
    expect(page.ok).toBe(true);
    // What reached the stand-in database: tags and the key id, never the code.
    expect(fn.sql.slice(0, 2).map(q => q.params.slice(0, 2))).toEqual([
      [TAG, KEY_ID],
      [TAG, KEY_ID],
    ]);
    expect(JSON.stringify(fn.sql)).not.toContain('P3R8WD4K');
    expect(JSON.stringify(fn.logs)).not.toContain('P3R8');
  });

  it('a card’s own password opens it by its tag, and a wrong one is a wrong try', async () => {
    const fn = fakeStudentSubmit({ cards: [card8({ birthday: null, number: null, password: '4821' })] });
    expect(await fn.handle({ route: 'card', code: CODE })).toMatchObject({ check: 'password' });
    expect(await fn.handle({ route: 'verify', code: CODE, password: '4822' })).toEqual({
      ok: false,
      error: 'wrong_identity',
      tries_left: 4,
    });
    expect((await fn.handle({ route: 'verify', code: CODE, password: ' 48-21 ' })).ok).toBe(true);
    expect(JSON.stringify(fn.sql)).not.toContain('4821');
  });

  it('a replaced card says so, a six-character code is no card, and an unknown one is not found', async () => {
    const fn = fakeStudentSubmit({ cards: [card8()], slips: { K7M4QX: { ok: true, token: 't' } } });
    expect(await fn.handle({ route: 'card', code: 'K7M-4QX' })).toEqual({ ok: false, error: 'not_found' });
    expect(fn.sql).toEqual([]);
    expect((await fn.handle({ route: 'open', code: 'K7M-4QX' })).ok).toBe(true);
    expect(await fn.handle({ route: 'card', code: 'ZZZZ-ZZZZ' })).toEqual({ ok: false, error: 'not_found' });
    fn.state.cards.P3R8WD4K.stopped = true;
    expect(await fn.handle({ route: 'card', code: CODE })).toEqual({ ok: false, error: 'card_stopped' });
    expect(await fn.handle({ route: 'verify', code: CODE, birthday: '2012-05-15' })).toEqual({
      ok: false,
      error: 'card_stopped',
    });
  });

  it('with no key the card routes fail, and since plan S3-S1 so does a slip’s open; with it a slip opens', async () => {
    for (const cardKey of [null, 'not a key']) {
      const fn = fakeStudentSubmit({ cards: [card8()], slips: { K7M4QX: { ok: true, token: 't' } }, cardKey });
      expect(await fn.respond({ route: 'card', code: CODE })).toEqual({
        status: 500,
        json: { ok: false, error: 'server' },
      });
      expect(await fn.respond({ route: 'open', code: 'K7M4QX' })).toEqual({
        status: 500,
        json: { ok: false, error: 'server' },
      });
      expect(fn.sql).toEqual([]);
    }
    const fn = fakeStudentSubmit({ cards: [card8()], slips: { K7M4QX: { ok: true, token: 't' } } });
    expect((await fn.handle({ route: 'open', code: 'K7M4QX' })).ok).toBe(true);
    expect(fn.sql.map(q => q.fn)).toEqual(['open']);
  });

  it('its sample card is eight characters, and it holds no card of any other length', async () => {
    const fn = fakeStudentSubmit({ cards: [sampleCard(TODAY)] });
    expect(Object.keys(fn.state.cards)).toEqual(['P3R8WDK4']);
    expect(await fn.handle({ route: 'card', code: 'P3R8-WDK4' })).toMatchObject({ ok: true, kind: 'card' });
    for (const code of ['P3R8WD', 'P3R8WD4', 'P3R8WDK42']) {
      expect(() => fakeStudentSubmit({ cards: [sampleCard(TODAY, { code })] }), code).toThrow('eight characters');
    }
  });

  it('runs no handler but the one in the repo', () => {
    const helper = readFileSync(new URL('./helpers/fake-student-submit.js', import.meta.url), 'utf8');
    const imports = helper.match(/^import .*$/gm).filter(line => /handler|card-routes|fixtures/.test(line));
    expect(imports).toEqual(["import { makeHandler } from '../../supabase/functions/student-submit/handler.ts';"]);
  });
});
