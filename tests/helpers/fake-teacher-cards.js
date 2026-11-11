/**
 * The teacher-cards edge function with a stand-in database, for the tests
 * of the teacher's side of student cards (S3-W1): tests/student-cards.test.js
 * and the browser tests through e2e/student-card-fake.js.
 *
 * The handler is the real one (supabase/functions/teacher-cards/handler.ts)
 * with a made-up key (tests/helpers/card-key-fake.js) over the stand-in for
 * the database after S3-M1 (tests/helpers/fake-card-database.js), which
 * stores tags and never a code. Only Supabase Auth is replaced: the token
 * the app sends stands for the one teacher, and a well-shaped stand-in
 * token is handed on to the handler in its place.
 *
 * `cardsListed()` is list_student_cards as it answers after S3-M1: no
 * code, no password; seq, has_password and needs_new. `markPrinted(ids)`
 * is mark_student_cards_printed.
 *
 * Nothing here reaches a real database or a real function.
 */
import { readCardKey } from '../../supabase/functions/_shared/card-key.ts';
import { makeHandler } from '../../supabase/functions/teacher-cards/handler.ts';
import { FAKE_KEY } from './card-key-fake.js';
import { TEACHER, fakeCardDatabase } from './fake-card-database.js';

// A made-up sign-in token in the shape of a real one: what the handler is handed for an accepted token.
const STAND_IN = 'eyJhbGciOiJIUzI1NiJ9.' + 'dGVhY2hlcg'.repeat(4) + '.c3RhbmQtaW4tdG9rZW4';
const REFUSED = 'eyJhbGciOiJIUzI1NiJ9.' + 'cmVmdXNlZA'.repeat(4) + '.c3RhbmQtaW4tdG9rZW4';

/* `course`: the class's id, owned by the teacher. `students`: [{ id,
   first, birthday, number, withdrawn }], enrolled in it. `tokens`: the
   sign-in tokens the stand-in Auth accepts (any, when left out). */
export async function fakeTeacherCards({ course, students, tokens } = {}) {
  const db = fakeCardDatabase();
  if (course) db.state.courses[course] = TEACHER;
  (students || []).forEach(s => {
    db.state.students[s.id] = {
      course,
      first: s.first || 'Student',
      birthday: s.birthday || null,
      number: s.number || null,
      withdrawn: !!s.withdrawn,
    };
  });
  const key = await readCardKey(FAKE_KEY);
  const logs = [];
  const handle = makeHandler({
    region: 'ca-central-1',
    cardKey: key,
    whoIs: async token => (token === STAND_IN ? TEACHER : null),
    db: { issue: (...args) => db.issue(...args) },
    log: entry => logs.push(entry),
  });
  const posts = []; // every request the app made: { url, headers, body }
  const accepts = auth => {
    const m = /^Bearer (.+)$/.exec(auth || '');
    return !!m && (!tokens || tokens.includes(m[1]));
  };

  /* Answer one request as the deployed function would: { status, json }. */
  async function respond({ url, method, headers, body }) {
    const h = {};
    Object.keys(headers || {}).forEach(k => (h[k.toLowerCase()] = headers[k]));
    let parsed = null;
    try {
      parsed = JSON.parse(body || 'null');
    } catch {
      parsed = null;
    }
    posts.push({ url, headers: h, body: parsed });
    const req = new Request(url, {
      method: method || 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer ' + (accepts(h.authorization) ? STAND_IN : REFUSED),
      },
      body: method === 'GET' ? undefined : body,
    });
    const res = await handle(req);
    return { status: res.status, json: await res.json(), cacheControl: res.headers.get('cache-control') };
  }

  const made = {}; // card id → when it was first listed
  const printed = {}; // card id → when it was marked printed
  function cardsListed() {
    const now = new Date().toISOString();
    return db.state.cards
      .filter(k => !k.stopped && db.state.students[k.enrollment_id])
      .map(k => {
        made[k.id] = made[k.id] || now;
        const st = db.state.students[k.enrollment_id];
        return {
          id: k.id,
          enrollment_id: k.enrollment_id,
          seq: k.seq,
          created_at: made[k.id],
          printed_at: printed[k.id] || null,
          last_opened_at: null,
          locked_at: null,
          wrong_tries: 0,
          wrong_tries_7d: 0,
          works_until: db.state.worksUntil,
          check: st.birthday || st.number ? 'identity' : 'password',
          has_password: !!k.pw_hmac,
          needs_new: false,
        };
      });
  }
  function markPrinted(ids) {
    const at = new Date().toISOString();
    let n = 0;
    (ids || []).forEach(cardId => {
      if (!db.state.cards.some(k => k.id === cardId)) return;
      printed[cardId] = at;
      n += 1;
    });
    return { printed: n };
  }

  return {
    db,
    posts,
    logs,
    respond,
    cardsListed,
    markPrinted,
    live: enrollment => db.live(enrollment),
  };
}

/* A stand-in for window.fetch that answers teacher-cards from `fake` and
   nothing else. `lose(post, n)` returning true lets the request reach the
   function and then loses its reply (the n-th request, from 1); `fail(post,
   n)` returning true loses the request before it arrives. */
export function fetchFrom(fake, opts = {}) {
  let n = 0;
  const fetcher = async (url, init = {}) => {
    if (!/\/functions\/v1\/teacher-cards\?forceFunctionRegion=ca-central-1$/.test(String(url))) {
      throw new TypeError('Failed to fetch: not the teacher-cards function');
    }
    n += 1;
    const post = { url: String(url), headers: init.headers || {}, body: JSON.parse(init.body || 'null') };
    if (opts.hold) await opts.hold(post, n);
    if (opts.fail && opts.fail(post, n)) throw new TypeError('Failed to fetch');
    const answer =
      (opts.answer && opts.answer(post, n)) || (await fake.respond({ ...post, method: init.method, body: init.body }));
    if (opts.lose && opts.lose(post, n)) throw new TypeError('Failed to fetch');
    return new Response(JSON.stringify(answer.json), {
      status: answer.status,
      headers: { 'content-type': 'application/json' },
    });
  };
  fetcher.count = () => n;
  return fetcher;
}
