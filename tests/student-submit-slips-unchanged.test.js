/**
 * Deploying the student-submit function with the card's routes must leave
 * every questionnaire and phone-report slip exactly as it is (S0-W1's
 * deploy note).
 *
 * tests/fixtures/student-submit-handler-2026-11-03.ts is the function's
 * handler as it stood before the card's routes were written (commit
 * e625966d, PR 863: the last change to the function made for slips). This
 * sends the same requests through that handler and through today's and
 * compares everything a phone or the database could notice: the status,
 * every header, the body's exact text, what was asked of the database (the
 * hashed address included) and what was logged.
 *
 * The differences are listed at the end, each one checked:
 *   1. requests the old handler refused with 400 and today's serves (the
 *      card's routes), and
 *   2. an IPv6 caller's rate-limit key (PR 975).
 */
import { describe, expect, it } from 'vitest';
import { readCardKey } from '../supabase/functions/_shared/card-key.ts';
import { makeHandler as today } from '../supabase/functions/student-submit/handler.ts';
import { makeHandler as before } from './fixtures/student-submit-handler-2026-11-03.ts';
import { FAKE_KEY } from './helpers/card-key-fake.js';

const TOKEN = 'a'.repeat(64);
const URL_ = 'https://x.supabase.co/functions/v1/student-submit?forceFunctionRegion=ca-central-1';

// What the database answers, by route and by the code or token sent.
const ANSWERS = {
  open: {
    K7M4QX: {
      ok: true,
      token: TOKEN,
      student: { first_name: 'Cece' },
      course: { name: 'Science 8', block: 'B' },
      preview: [{ title: 'November Reflection', count: 3 }],
      check: 'identity',
      also_password: false,
    },
    R3P0RT: {
      ok: true,
      kind: 'report',
      token: TOKEN,
      student: { first_name: 'Cece' },
      course: { name: 'Science 8', block: 'B' },
      report: { title: 'Report 1', expires_on: '2027-01-31' },
      has_birthday: true,
    },
    USED22: { ok: false, error: 'used' },
    SOON22: { ok: false, error: 'not_open_yet', opens_on: '2026-11-20' },
    BUSY22: { ok: false, error: 'busy' },
    LOCK22: { ok: false, error: 'locked' },
  },
  verify: {
    [TOKEN]: { ok: true, parts: [{ id: 'p1', title: 'November Reflection', questions: [] }], context: { n: 1 } },
    wrong: { ok: false, error: 'wrong_identity', tries_left: 3 },
    locked: { ok: false, error: 'slip_locked' },
    expired: { ok: false, error: 'expired' },
  },
  check: {
    [TOKEN]: { ok: true, report: { name: 'Cece Okafor', overall: { text: '3.0' }, comment: ['Cece is curious.'] } },
    wrong: { ok: false, error: 'wrong_birthday', tries_left: 2 },
    none: { ok: false, error: 'no_birthday' },
  },
  submit: {
    [TOKEN]: { ok: true, submitted_at: '2026-11-04T10:00:00Z' },
    empty: { ok: false, error: 'empty' },
    invalid: { ok: false, error: 'invalid' },
  },
};

/* One handler with a database that records what it was asked. A card
   statement reaching it is recorded too, so a slip request that strayed
   into a card route would show as a difference. */
function side(make, opts) {
  const asked = [];
  const logs = [];
  const answer = (route, key) => {
    if (opts && opts.down) throw new Error('connection refused: ' + key);
    return JSON.parse(JSON.stringify(ANSWERS[route][key] || { ok: false, error: 'not_found' }));
  };
  const handle = make({
    region: opts && 'region' in opts ? opts.region : 'ca-central-1',
    ipKey: 'test-key',
    // The card key (S3-E1). No slip test gives one: a slip needs none.
    cardKey: opts && opts.cardKey,
    log: entry => logs.push(Object.assign({}, entry, { ms: 0 })),
    db: {
      open: async (code, hash) => (asked.push(['open', code, hash]), answer('open', code)),
      verify: async (token, who, hash) => (asked.push(['verify', token, who, hash]), answer('verify', token)),
      check: async (token, birthday, hash) => (asked.push(['check', token, birthday, hash]), answer('check', token)),
      submit: async (token, answers, hash) => (asked.push(['submit', token, answers, hash]), answer('submit', token)),
      call: async (sql, params) => (asked.push(['call', sql, params]), { ok: false, error: 'not_found' }),
    },
  });
  return { handle, asked, logs };
}

const request = r =>
  new Request(URL_, {
    method: r.method || 'POST',
    headers: Object.assign(
      { 'content-type': 'application/json', origin: 'https://fullvision.ca', 'cf-connecting-ip': '203.0.113.7' },
      r.headers,
    ),
    body: r.method === 'GET' || r.method === 'OPTIONS' ? undefined : r.raw != null ? r.raw : JSON.stringify(r.body),
  });

async function seenBy(make, r, opts) {
  const s = side(make, opts);
  const res = await s.handle(request(r));
  return {
    status: res.status,
    headers: [...res.headers.entries()].sort(),
    text: await res.text(),
    asked: s.asked,
    logs: s.logs,
  };
}

const post = (body, headers) => ({ body, headers });

// Every request a slip page sends, and every way one can be wrong.
const SLIP_REQUESTS = {
  'open: a questionnaire slip': post({ route: 'open', code: 'K7M4QX' }),
  'open: a report slip': post({ route: 'open', code: 'R3P0RT' }),
  'open: with a dash and lower case, as typed': post({ route: 'open', code: 'k7m-4qx' }),
  'open: a code nobody holds': post({ route: 'open', code: 'ABC234' }),
  'open: used': post({ route: 'open', code: 'USED22' }),
  'open: not open yet': post({ route: 'open', code: 'SOON22' }),
  'open: busy': post({ route: 'open', code: 'BUSY22' }),
  'open: locked': post({ route: 'open', code: 'LOCK22' }),
  'open: no code': post({ route: 'open' }),
  'open: a code that is not text': post({ route: 'open', code: 123456 }),
  'open: a code too long': post({ route: 'open', code: 'K'.repeat(33) }),
  'open: an empty code': post({ route: 'open', code: '' }),
  'open: with fields a card would send': post({ route: 'open', code: 'K7M4QX', session: TOKEN, enrollment_id: 'x' }),
  'verify: student number': post({
    route: 'verify',
    token: TOKEN,
    birthday: null,
    student_number: '0123456',
    password: null,
  }),
  'verify: birthday': post({
    route: 'verify',
    token: TOKEN,
    birthday: '2012-05-15',
    student_number: null,
    password: null,
  }),
  'verify: password': post({ route: 'verify', token: TOKEN, birthday: null, student_number: null, password: '4821' }),
  'verify: number and password together': post({
    route: 'verify',
    token: TOKEN,
    student_number: '4821',
    password: '4821',
  }),
  'verify: wrong': post({ route: 'verify', token: 'wrong', student_number: '1' }),
  'verify: locked': post({ route: 'verify', token: 'locked', student_number: '1' }),
  'verify: expired': post({ route: 'verify', token: 'expired', student_number: '1' }),
  'verify: nothing to check': post({ route: 'verify', token: TOKEN }),
  'verify: a birthday of the wrong shape': post({ route: 'verify', token: TOKEN, birthday: '15/05/2012' }),
  'verify: a number too long': post({ route: 'verify', token: TOKEN, student_number: '1'.repeat(33) }),
  'verify: a token too long': post({ route: 'verify', token: 'a'.repeat(129), student_number: '1' }),
  'verify: a token that is not text': post({ route: 'verify', token: 12, student_number: '1' }),
  'verify: no token and no code': post({ route: 'verify', student_number: '1' }),
  // A token makes it a slip's, whatever else rides along.
  'verify: a token and a code': post({ route: 'verify', token: TOKEN, code: 'P3R8WD', student_number: '0123456' }),
  'verify: a token and a session': post({
    route: 'verify',
    token: TOKEN,
    session: 'b'.repeat(64),
    student_number: '1',
  }),
  'check: a birthday': post({ route: 'check', token: TOKEN, birthday: '2012-05-15' }),
  'check: wrong': post({ route: 'check', token: 'wrong', birthday: '2012-05-16' }),
  'check: none on file': post({ route: 'check', token: 'none', birthday: '2012-05-15' }),
  'check: no birthday': post({ route: 'check', token: TOKEN }),
  'check: a birthday of the wrong shape': post({ route: 'check', token: TOKEN, birthday: 'May 15' }),
  'check: no token': post({ route: 'check', birthday: '2012-05-15' }),
  'submit: answers': post({
    route: 'submit',
    token: TOKEN,
    answers: { q1: 'COL', q2: ['a', 'b'], q3: { levels: { PAR: 2 } } },
  }),
  'submit: empty': post({ route: 'submit', token: 'empty', answers: {} }),
  'submit: invalid': post({ route: 'submit', token: 'invalid', answers: { q1: 1 } }),
  'submit: no answers': post({ route: 'submit', token: TOKEN }),
  'submit: no token': post({ route: 'submit', answers: {} }),
  'a route nobody has': post({ route: 'grades', code: 'K7M4QX' }),
  'an inherited name for a route': post({ route: 'constructor' }),
  'no route': post({ code: 'K7M4QX' }),
  'a route that is not text': post({ route: ['open'], code: 'K7M4QX' }),
  'not JSON': { raw: '{route:' },
  'a list': { raw: '[]' },
  null: { raw: 'null' },
  'a body too large': { raw: JSON.stringify({ route: 'submit', token: TOKEN, answers: 'x'.repeat(130_000) }) },
  GET: { method: 'GET' },
  'OPTIONS from the site': { method: 'OPTIONS' },
  'OPTIONS from elsewhere': { method: 'OPTIONS', headers: { origin: 'https://evil.example' } },
  'from a deploy preview': post(
    { route: 'open', code: 'K7M4QX' },
    { origin: 'https://deploy-preview-12--fullvision.netlify.app' },
  ),
  'from local dev': post({ route: 'open', code: 'K7M4QX' }, { origin: 'http://localhost:8347' }),
  'from another site': post({ route: 'open', code: 'K7M4QX' }, { origin: 'https://evil.example' }),
  'with no origin': post({ route: 'open', code: 'K7M4QX' }, { origin: '' }),
  'a made-up X-Forwarded-For beside the real address': post(
    { route: 'open', code: 'ABC234' },
    { 'x-forwarded-for': '198.51.100.9, 203.0.113.7' },
  ),
  'no cf-connecting-ip: the last forwarded address': post(
    { route: 'open', code: 'ABC234' },
    { 'cf-connecting-ip': '', 'x-forwarded-for': '198.51.100.9, 192.0.2.44' },
  ),
  'no address at all': post({ route: 'open', code: 'ABC234' }, { 'cf-connecting-ip': '' }),
};

describe('a slip’s requests get the same answer from the function with and without the card’s routes', () => {
  it.each(Object.keys(SLIP_REQUESTS))('%s', async name => {
    const r = SLIP_REQUESTS[name];
    const was = await seenBy(before, r);
    const is = await seenBy(today, r);
    expect(is.status).toBe(was.status);
    expect(is.headers).toEqual(was.headers);
    expect(is.text).toBe(was.text);
    expect(is.asked).toEqual(was.asked);
    expect(is.logs).toEqual(was.logs);
    // And never by way of a card's statement.
    expect(is.asked.some(a => a[0] === 'call')).toBe(false);
  });

  it('the list above reaches all four slip routes, their good answers and their refusals', async () => {
    const reached = new Set();
    const said = new Set();
    for (const r of Object.values(SLIP_REQUESTS)) {
      const is = await seenBy(today, r);
      is.asked.forEach(a => reached.add(a[0]));
      said.add(is.status + ' ' + is.text.replace(/^.*"error":"(\w+)".*$/, '$1').replace(/^\{"ok":true.*$/, 'ok'));
    }
    expect([...reached].sort()).toEqual(['check', 'open', 'submit', 'verify']);
    for (const outcome of [
      '200 ok',
      '200 not_found',
      '200 used',
      '200 not_open_yet',
      '200 busy',
      '200 locked',
      '200 wrong_identity',
      '200 slip_locked',
      '200 expired',
      '200 wrong_birthday',
      '200 no_birthday',
      '200 empty',
      '200 invalid',
      '400 bad_request',
      '405 method',
      '413 too_large',
    ]) {
      expect([...said], outcome).toContain(outcome);
    }
  });

  it.each(['open', 'verify', 'check', 'submit'])('%s outside ca-central-1, and with the database down', async route => {
    const body = { route, code: 'K7M4QX', token: TOKEN, birthday: '2012-05-15', answers: { q1: 'a' } };
    for (const opts of [{ region: 'us-east-1' }, { region: undefined }, { down: true }]) {
      const was = await seenBy(before, post(body), opts);
      const is = await seenBy(today, post(body), opts);
      expect(is).toEqual(was);
      expect(is.status).toBe(opts.down ? 500 : 421);
    }
  });
});

describe('what deploying does change, and nothing else', () => {
  it('requests the function refused before and serves now: the card’s routes', async () => {
    // Since S3-E1 a card's code is eight characters and is checked with the card key.
    const cardKey = await readCardKey(FAKE_KEY);
    const CARD_REQUESTS = [
      { route: 'card', code: 'P3R8WD4K' },
      { route: 'verify', code: 'P3R8WD4K', student_number: '0123456' },
      { route: 'add-card', code: 'P3R8WD4K', student_number: '0123456', session: TOKEN },
      { route: 'page', session: TOKEN, enrollment_id: '11111111-1111-4111-8111-111111111111' },
      { route: 'seen', session: TOKEN, enrollment_id: '11111111-1111-4111-8111-111111111111', assessment_ids: [] },
      { route: 'done', session: TOKEN },
    ];
    for (const body of CARD_REQUESTS) {
      const was = await seenBy(before, post(body), { cardKey });
      const is = await seenBy(today, post(body), { cardKey });
      // Before: a bad request, the database never asked. This is what the page meets until the function is deployed.
      expect(was.status, body.route).toBe(400);
      expect(was.text).toBe('{"ok":false,"error":"bad_request"}');
      expect(was.asked).toEqual([]);
      // Now: one card statement, and no slip function.
      expect(is.status, body.route).toBe(200);
      expect(is.asked.map(a => a[0])).toEqual(['call']);
    }
  });

  it('an IPv4 caller’s rate-limit key is the same; an IPv6 caller is now counted by network', async () => {
    const hashOf = async (make, address) =>
      (await seenBy(make, post({ route: 'open', code: 'ABC234' }, address))).asked[0][2];
    for (const address of ['203.0.113.7', '10.0.0.1', ' 198.51.100.20 ']) {
      const headers = { 'cf-connecting-ip': address };
      expect(await hashOf(today, headers), address).toBe(await hashOf(before, headers));
    }
    // Two devices on one IPv6 network: two keys before, one now (PR 975).
    const a = { 'cf-connecting-ip': '2001:db8:1:2:aaaa::1' };
    const b = { 'cf-connecting-ip': '2001:db8:1:2:bbbb::2' };
    expect(await hashOf(before, a)).not.toBe(await hashOf(before, b));
    expect(await hashOf(today, a)).toBe(await hashOf(today, b));
    expect(await hashOf(today, a)).not.toBe(await hashOf(before, a));
    // The reply itself is the same either way.
    const was = await seenBy(before, post({ route: 'open', code: 'K7M4QX' }, a));
    const is = await seenBy(today, post({ route: 'open', code: 'K7M4QX' }, a));
    expect([is.status, is.headers, is.text, is.logs]).toEqual([was.status, was.headers, was.text, was.logs]);
  });
});
