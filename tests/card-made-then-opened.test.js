/**
 * One test across both edge functions: a card teacher-cards just made opens
 * through student-submit (S3-E2).
 *
 * The two functions never talk to each other. All they share is the key and
 * the database, and the database holds only tags. So this is the one place
 * that shows the two make the same tag from the same code: the teacher's
 * function draws a code, tags it and hands the tag over; the student's
 * function is handed the code from the printed card, tags it and asks for
 * that tag. If the two ever disagreed (a label, the tidy-up, the hex), every
 * card would be made and none would open.
 *
 * Both handlers are the real ones. The database between them is a stand-in
 * that has no key, makes no tag and stores exactly what it is given
 * (tests/helpers/fake-card-database.js).
 */
import { describe, expect, it } from 'vitest';
import { readCardKey } from '../supabase/functions/_shared/card-key.ts';
import { makeHandler as studentSubmit } from '../supabase/functions/student-submit/handler.ts';
import { makeHandler as teacherCards } from '../supabase/functions/teacher-cards/handler.ts';
import { FAKE_KEY } from './helpers/card-key-fake.js';
import { CECE, COURSE, NOOR, OMAR, TEACHER, fakeCardDatabase, id } from './helpers/fake-card-database.js';

const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.' + 'dGVhY2hlcg'.repeat(4) + '.c2lnbmF0dXJlLW9uZQ';
const OTHER_KEY = 'c0ffee'.repeat(10) + 'c0ff';

/* A school: one database, the teacher's function and the student's, each
   with the key it was started with. */
async function school(keys = {}) {
  const db = fakeCardDatabase();
  const logs = [];
  const log = entry => logs.push(entry);
  const teacher = teacherCards({
    region: 'ca-central-1',
    cardKey: await readCardKey('teacher' in keys ? keys.teacher : FAKE_KEY),
    whoIs: async token => (token === TOKEN ? TEACHER : null),
    db: { issue: db.issue },
    log,
  });
  const noSlip = async () => ({ ok: false, error: 'not_found' });
  const student = studentSubmit({
    region: 'ca-central-1',
    ipKey: 'address-key',
    cardKey: await readCardKey('student' in keys ? keys.student : FAKE_KEY),
    db: { open: noSlip, verify: noSlip, check: noSlip, submit: noSlip, call: db.call },
    log,
  });
  let requests = 0;
  // The teacher presses a button: the cards the browser is given back.
  const make = async items => {
    const res = await teacher(
      new Request('https://x.supabase.co/functions/v1/teacher-cards', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer ' + TOKEN,
          origin: 'https://fullvision.ca',
        },
        body: JSON.stringify({ course_id: COURSE, items, request_id: id(7000 + ++requests) }),
      }),
    );
    expect(res.status).toBe(200);
    return (await res.json()).results;
  };
  // A student's phone, with what is printed on the card.
  const phone = async body => {
    const res = await student(
      new Request('https://x.supabase.co/functions/v1/student-submit', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'cf-connecting-ip': '203.0.113.7',
          origin: 'https://fullvision.ca',
        },
        body: JSON.stringify(body),
      }),
    );
    return { status: res.status, ...(await res.json()) };
  };
  return { db, logs, make, phone };
}

const first = enrollment_id => ({ enrollment_id, replaces: null });

describe('a card teacher-cards just made opens through student-submit', () => {
  it('the code on the new card opens that student’s card, typed any way a student might', async () => {
    const s = await school();
    const [cece, omar, noor] = await s.make([first(CECE), first(OMAR), first(NOOR)]);

    // Scanned (the QR holds the code), typed with the dash, typed in lower case with a space.
    for (const typed of [cece.code, cece.code.replace('-', ''), cece.code.toLowerCase().replace('-', ' ')]) {
      expect(await s.phone({ route: 'card', code: typed }), typed).toEqual({
        status: 200,
        ok: true,
        kind: 'card',
        student: { first_name: 'Cece' },
        course: { name: 'Science 8', block: 'B' },
        check: 'identity',
        also_password: false,
      });
    }
    // Each card is its own student's.
    expect((await s.phone({ route: 'card', code: omar.code })).student).toEqual({ first_name: 'Omar' });
    expect((await s.phone({ route: 'card', code: noor.code })).student).toEqual({ first_name: 'Noor' });

    // Is This You? answered: the page opens.
    const verified = await s.phone({ route: 'verify', code: cece.code, birthday: '2012-05-15' });
    expect(verified).toMatchObject({ status: 200, ok: true, enrollment_id: CECE });
    expect(verified.session_token).toMatch(/^[0-9a-f]{64}$/);
    expect(s.db.state.sessions[verified.session_token]).toBe(CECE);
  });

  it('the password printed on a card opens it, and only that card', async () => {
    const s = await school();
    const [omar] = await s.make([first(OMAR)]);
    expect(omar.password).toMatch(/^\d{4}$/);
    expect(await s.phone({ route: 'card', code: omar.code })).toMatchObject({
      check: 'password',
      also_password: false,
    });

    const wrong = String((Number(omar.password) + 1) % 10000).padStart(4, '0');
    expect(await s.phone({ route: 'verify', code: omar.code, password: wrong })).toMatchObject({
      ok: false,
      error: 'wrong_identity',
    });
    expect(await s.phone({ route: 'verify', code: omar.code, password: ' ' + omar.password + ' ' })).toMatchObject({
      ok: true,
      enrollment_id: OMAR,
    });

    // A second card for Omar gets a password of its own tag: the old card's password with the new code is
    // the new card's only if the digits happen to match, and the old code no longer opens.
    const [again] = await s.make([{ enrollment_id: OMAR, replaces: omar.card_id }]);
    expect(again.seq).toBe(2);
    expect(await s.phone({ route: 'card', code: omar.code })).toEqual({
      status: 200,
      ok: false,
      error: 'card_stopped',
    });
    expect(await s.phone({ route: 'verify', code: omar.code, password: omar.password })).toEqual({
      status: 200,
      ok: false,
      error: 'card_stopped',
    });
    expect(await s.phone({ route: 'verify', code: again.code, password: again.password })).toMatchObject({ ok: true });
  });

  it('when the first code was taken, the code returned is still the one that opens', async () => {
    const s = await school();
    // Every tag the database is handed as a first candidate is already some old card's.
    const issue = s.db.issue;
    const real = s.db.state.cards;
    let taken = 0;
    const collide = async (teacherId, courseId, items, keyId, requestId) => {
      for (const it of items) {
        real.push({
          id: id(500 + ++taken),
          enrollment_id: NOOR,
          code_hmac: it.candidates[0].code_hmac,
          seq: 1,
          stopped: true,
        });
      }
      return issue(teacherId, courseId, items, keyId, requestId);
    };
    const teacher = teacherCards({
      region: 'ca-central-1',
      cardKey: await readCardKey(FAKE_KEY),
      whoIs: async () => TEACHER,
      db: { issue: collide },
      log: () => {},
    });
    const res = await teacher(
      new Request('https://x.supabase.co/functions/v1/teacher-cards', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + TOKEN },
        body: JSON.stringify({ course_id: COURSE, items: [first(CECE), first(OMAR)], request_id: id(7100) }),
      }),
    );
    const results = (await res.json()).results;
    expect(results.map(r => r.result)).toEqual(['made', 'made']);
    expect(taken).toBe(2);
    expect((await s.phone({ route: 'card', code: results[0].code })).student).toEqual({ first_name: 'Cece' });
    expect((await s.phone({ route: 'card', code: results[1].code })).student).toEqual({ first_name: 'Omar' });
    expect(await s.phone({ route: 'verify', code: results[1].code, password: results[1].password })).toMatchObject({
      ok: true,
      enrollment_id: OMAR,
    });
  });

  it('a code nobody was given does not open, and a card’s code opens nobody else’s', async () => {
    const s = await school();
    const [cece] = await s.make([first(CECE)]);
    const other = cece.code.slice(0, 8) + (cece.code.endsWith('A') ? 'B' : 'A');
    expect(await s.phone({ route: 'card', code: other })).toEqual({ status: 200, ok: false, error: 'not_found' });
    expect(await s.phone({ route: 'verify', code: other, birthday: '2012-05-15' })).toEqual({
      status: 200,
      ok: false,
      error: 'not_found',
    });
    // Cece's code with Omar's nothing: her birthday is the only thing that opens it.
    expect(await s.phone({ route: 'verify', code: cece.code, birthday: '2012-05-16' })).toMatchObject({
      error: 'wrong_identity',
    });
  });

  it('after the key is changed, cards made under the old key stop opening and new ones open', async () => {
    const before = await school();
    const [old] = await before.make([first(CECE)]);
    expect((await before.phone({ route: 'card', code: old.code })).ok).toBe(true);

    // The same database, both functions restarted with a new key.
    const db = before.db;
    const key = await readCardKey(OTHER_KEY);
    const student = studentSubmit({
      region: 'ca-central-1',
      ipKey: 'address-key',
      cardKey: key,
      db: { call: db.call },
      log: () => {},
    });
    const phone = async body =>
      (
        await student(
          new Request('https://x.supabase.co/functions/v1/student-submit', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          }),
        )
      ).json();
    expect(await phone({ route: 'card', code: old.code })).toEqual({ ok: false, error: 'not_found' });

    const teacher = teacherCards({
      region: 'ca-central-1',
      cardKey: key,
      whoIs: async () => TEACHER,
      db: { issue: db.issue },
      log: () => {},
    });
    const res = await teacher(
      new Request('https://x.supabase.co/functions/v1/teacher-cards', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + TOKEN },
        body: JSON.stringify({
          course_id: COURSE,
          items: [{ enrollment_id: CECE, replaces: old.card_id }],
          request_id: id(7200),
        }),
      }),
    );
    const [fresh] = (await res.json()).results;
    expect(fresh).toMatchObject({ result: 'made', seq: 2 });
    expect(await phone({ route: 'card', code: fresh.code })).toMatchObject({
      ok: true,
      student: { first_name: 'Cece' },
    });
    // The two cards were stored under different key ids, which is how the list knows which need a new card.
    expect(new Set(db.state.cards.map(k => k.key_id)).size).toBe(2);
  });

  it('the two functions started with different keys: the card is made and does not open', async () => {
    const s = await school({ student: OTHER_KEY });
    const [cece] = await s.make([first(CECE)]);
    expect(cece.result).toBe('made');
    expect(await s.phone({ route: 'card', code: cece.code })).toEqual({ status: 200, ok: false, error: 'not_found' });
  });

  it('through all of it the database was handed no code and no password, and nothing was logged', async () => {
    const s = await school();
    const made = await s.make([first(CECE), first(OMAR), first(NOOR)]);
    for (const r of made) {
      await s.phone({ route: 'card', code: r.code });
      await s.phone({ route: 'verify', code: r.code, birthday: '2012-05-15', password: r.password || '0000' });
    }
    expect(s.db.state.handed).toHaveLength(7);
    // A code is capitals and digits and a tag is lower-case hex, so the two are compared as they are.
    const handed = JSON.stringify(s.db.state.handed);
    const logged = JSON.stringify(s.logs);
    for (const r of made) {
      for (const secret of [
        r.code,
        r.code.replace('-', ''),
        r.code.toLowerCase(),
        r.code.toLowerCase().replace('-', ''),
      ]) {
        expect(handed, secret).not.toContain(secret);
        expect(logged, secret).not.toContain(secret);
      }
      // Not even half a code is in a log line.
      expect(logged).not.toContain(r.code.slice(0, 4));
      expect(logged).not.toContain(r.code.slice(5));
    }
    expect(handed).not.toContain(FAKE_KEY);
    expect(logged).not.toContain(FAKE_KEY);
    expect(new Set(s.logs.flatMap(l => Object.keys(l)))).toEqual(new Set(['route', 'outcome', 'cards', 'ms']));
    // Every card the database holds is two tags at most, a key id and ids.
    for (const card of s.db.state.cards) {
      expect(card.code_hmac).toMatch(/^[0-9a-f]{64}$/);
      expect(card.pw_hmac === null || /^[0-9a-f]{64}$/.test(card.pw_hmac)).toBe(true);
      expect(Object.keys(card).sort()).toEqual([
        'code_hmac',
        'enrollment_id',
        'id',
        'key_id',
        'pw_hmac',
        'seq',
        'stopped',
      ]);
    }
  });
});
