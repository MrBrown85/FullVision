/**
 * The student-submit edge function with a stand-in database, for the tests
 * of the student's card path (S0-W1): tests/student-card-wired.test.js and
 * e2e/student-card-wired.spec.js.
 *
 * The handler and its routes are the real ones
 * (supabase/functions/student-submit/handler.ts and card-routes.ts), with a
 * made-up card key: the request's shape is checked, a card's code is turned
 * into its tag, the reply is copied field by field, and a refusal is passed
 * on or turned into not_found exactly as when deployed. Only Postgres is
 * replaced. The stand-in answers each student_submit function the way the
 * SQL does after S3-M1: a card is found by the tag of its code, five wrong
 * answers in a row lock it, a replaced card answers card_stopped, a right
 * answer from the start screen starts a new session and ends the one sent,
 * a session ends at its time or on Done, and page() is refused once the
 * card or the class can no longer open.
 *
 * A card's code is eight characters (P3R8-WDK4). The database is handed a
 * tag of the code and never the code, and a typed card password as a tag
 * too; the stand-in refuses anything else, so a code or a password that
 * ever reached the database would fail the test that sent it. A code that
 * is not eight characters is not_found without the database being asked,
 * so a card here cannot be given any other length.
 *
 * Nothing here reaches a real database or a real function.
 */
import { readCardKey } from '../../supabase/functions/_shared/card-key.ts';
import { makeHandler } from '../../supabase/functions/student-submit/handler.ts';
import { FAKE_KEY, codeTag, passwordTag } from './card-key-fake.js';
import { C1, fakeWorld } from './fake-send-world.js';

const clone = v => JSON.parse(JSON.stringify(v));
const no = (error, more) => Object.assign({ ok: false, error }, more);
const norm = code =>
  String(code || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

/** A made-up id in the shape of a real one: id(7) is 00000007-0000-4000-8000-000000000000. */
export const id = n => ('0000000' + n).slice(-8) + '-0000-4000-8000-000000000000';

export const CECE = id(1); // enrollment ids
export const OMAR = id(2);
export const TAGS = { questions: id(11), plan: id(12), data: id(13), share: id(14) };
export const RUBRIC = id(20);
export const CRITERIA = { method: id(21), drawing: id(22) };
export const WORK = {
  fair: id(31),
  poster: id(32),
  quick: id(33),
  energy: id(34),
  quiz: id(35),
  lab: id(36),
  essay: id(37),
  kmt: id(38),
  contract: id(39),
  field: id(40),
};

const day = (today, offset) => {
  const t = new Date(today + 'T12:00:00Z');
  t.setUTCDate(t.getUTCDate() + offset);
  return t.toISOString().slice(0, 10);
};
const at = (today, offset) => day(today, offset) + 'T20:15:00+00:00';
const copy = part =>
  Object.assign({ v: 1, value: null, modifier: 0, comment: null, tags: {}, criteria: {}, checks: [] }, part);
const level = (value, modifier) => ({ value, modifier: modifier || 0, comment: null });

/**
 * Cece's page for Science 8 as student_submit.page sends it: the sample
 * class Demo Mode shows, with real-shaped ids. Returned grades only: the
 * poster holds a draft that was never returned and the essay a draft over
 * a returned grade, and neither draft is anywhere in it.
 * `today` is YYYY-MM-DD.
 */
export function samplePage(today, system) {
  const work = (key, title, date, due, more) =>
    Object.assign(
      {
        id: WORK[key],
        title,
        date: day(today, date),
        due_date: due == null ? null : day(today, due),
        // When the teacher made it (sent since S0-M4b): the morning of its date.
        created_at: day(today, date) + 'T16:04:11.482913+00:00',
        score_mode: 'proficiency',
        max_points: null,
        weight: 1,
        rubric_id: null,
        tag_ids: [],
        status: null,
        returned_at: null,
        updated_at: null,
        seen_at: null,
        grade: null,
        previous: null,
      },
      more,
    );
  return {
    ok: true,
    v: 1,
    expires_at: null, // the session's, filled in by page()
    student: { enrollment_id: CECE, first_name: 'Cece' },
    course: {
      name: 'Science 8',
      block: 'B',
      grading_system: system || 'proficiency',
      grading_scale: null,
      level_order: 'desc',
      round_percent: null,
    },
    classes: [],
    tags: {
      [TAGS.questions]: { label: 'Questioning and Predicting', code: 'QP' },
      [TAGS.plan]: { label: 'Planning and Conducting', code: 'PC' },
      [TAGS.data]: { label: 'Processing and Analyzing Data', code: 'PA' },
      [TAGS.share]: { label: 'Communicating', code: 'COM' },
    },
    rubrics: [
      {
        id: RUBRIC,
        name: 'Lab Report',
        style: 'simple',
        criteria: ['method', 'drawing'].map((key, i) => ({
          id: CRITERIA[key],
          name: ['Method', 'Labelled Drawing'][i],
          weight: 1,
          level_1_value: 1,
          level_2_value: 2,
          level_3_value: 3,
          level_4_value: 4,
          level_1_descriptor: null,
          level_2_descriptor: null,
          level_3_descriptor: null,
          level_4_descriptor: null,
          checks: [],
        })),
      },
    ],
    assessments: [
      work('fair', 'Science Fair Proposal', -1, 4, { tag_ids: [TAGS.questions, TAGS.plan] }),
      // A draft, never returned: sent exactly as work that was never graded.
      work('poster', 'Disease Research Poster', -9, -2, { tag_ids: [TAGS.data, TAGS.share] }),
      work('quick', 'Immune System Quick Check', -7, -5, { score_mode: 'points', max_points: 12, status: 'NS' }),
      work('energy', 'Energy Transfer Investigation', -13, -8, {
        tag_ids: [TAGS.data],
        returned_at: at(today, -6),
        grade: copy({ comment: 'Your data table shows every transfer. Well done.', tags: { [TAGS.data]: level(4) } }),
      }),
      work('quiz', 'Cell Structure Quiz', -11, -11, {
        score_mode: 'points',
        max_points: 10,
        returned_at: at(today, -9),
        grade: copy({ value: 8 }),
      }),
      work('lab', 'Cell Microscope Lab', -18, -14, {
        rubric_id: RUBRIC,
        tag_ids: [TAGS.questions, TAGS.plan],
        returned_at: at(today, -10),
        grade: copy({
          comment: 'Careful focusing. Label the nucleus next time.',
          criteria: {
            [CRITERIA.method]: Object.assign(level(3), { beyond: null }),
            [CRITERIA.drawing]: Object.assign(level(2, 1), { beyond: null }),
          },
        }),
      }),
      // Returned, then changed: the change waits as a draft, and what is sent is the grade that was returned.
      work('essay', 'Ecosystem Connections Essay', -24, -17, {
        tag_ids: [TAGS.share],
        returned_at: at(today, -14),
        grade: copy({
          comment: 'Explain how the food web changes when one species goes.',
          tags: { [TAGS.share]: level(2) },
        }),
      }),
      work('kmt', 'KMT & States of Matter Lab', -27, -22, {
        tag_ids: [TAGS.plan],
        status: 'LATE',
        returned_at: at(today, -19),
        grade: copy({ tags: { [TAGS.plan]: level(3) } }),
      }),
      // Returned as Incomplete, opened, then changed and returned again.
      work('contract', 'Lab Safety Contract', -32, -30, {
        score_mode: 'complete',
        returned_at: at(today, -3),
        updated_at: at(today, -3),
        seen_at: at(today, -20),
        grade: copy({ value: 1 }),
        previous: copy({ value: 0 }),
      }),
    ],
  };
}

/** A card for the stand-in database. */
export function sampleCard(today, more) {
  return Object.assign(
    {
      code: 'P3R8WDK4', // printed P3R8-WDK4
      enrollment: CECE,
      first: 'Cece',
      course: { name: 'Science 8', block: 'B' },
      birthday: '2012-05-15',
      number: '0123456',
      password: null,
      wrong: 0,
      locked: false,
      stopped: false, // reissued
      withdrawn: false,
      closed: false, // the class's student page is off
      expired: false, // past Cards Work Until
      page: samplePage(today),
    },
    more,
  );
}

/**
 * The function and its stand-in database.
 *   cards     the live cards, each as sampleCard() gives one
 *   slips     { code: what student_submit.open answers }
 *   now       () => milliseconds; the database's clock
 *   lasts     how long a new session lasts, in milliseconds (default 6 hours)
 *   cardKey   what STUDENT_CARD_KEY is set to. Left out, a made-up key.
 *             null is no key; a string that is not 64 hex characters is a
 *             malformed one.
 *   sendWork  the class has Send Work on, and these pieces take work:
 *             { [assessment id]: { students_send, open } }. Batch B's
 *             student functions and the bucket are then
 *             tests/helpers/fake-send-world.js's, over this stand-in's
 *             sessions, with links on `storeBase`. Left out, Send Work is
 *             off and `work` says so, as for every class.
 * Returns { handle(body, headers) → the reply's JSON, respond(body) →
 * { status, json }, state, sql, logs, world }. `state` can be changed between
 * calls: state.cards.P3R8WDK4.locked = true, state.addressLocked = true,
 * state.down = true (the database is unreachable). A card is added the same
 * way: state.cards.K7M4QX2P = sampleCard(today, { code: 'K7M4QX2P' }).
 */
export function fakeStudentSubmit(opts = {}) {
  const now = opts.now || (() => Date.now());
  for (const k of opts.cards || []) {
    if (norm(k.code).length !== 8) throw new Error('fakeStudentSubmit: a card’s code is eight characters');
  }
  const state = {
    cards: {},
    slips: Object.assign({}, opts.slips),
    sessions: {}, // token → { expires, cards: { enrollment: code } }
    seen: {}, // 'enrollment:assessment' → when
    addressLocked: false,
    down: false,
    dirty: null, // a function that changes page()'s reply before it is sent
    // What a slip's verify, check and submit answer.
    slipAnswers: {
      verify: {
        ok: true,
        parts: [
          {
            id: 'p1',
            kind: 'core_reflection',
            title: 'November Reflection',
            questions: [{ id: 'q1', kind: 'text', prompt: 'How did it go?', options: {}, core_ids: [] }],
          },
        ],
        context: {},
      },
      check: { ok: true, report: {} },
      submit: { ok: true, submitted_at: '2026-11-04T10:00:00Z' },
    },
  };
  (opts.cards || []).forEach(k => (state.cards[norm(k.code)] = k));
  const sql = []; // every statement the function ran: { fn, params }
  const logs = [];
  let made = 0;

  const live = token => {
    const s = state.sessions[token];
    return s && Date.parse(s.expires) > now() ? s : null;
  };
  const refusal = k =>
    k.stopped ? 'card_stopped' : k.withdrawn ? 'not_found' : k.closed ? 'closed' : k.expired ? 'card_expired' : null;
  const isTag = v => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
  /* `tag` is the tag of a code. The stand-in knows the made-up key, so it
     can tell which card a tag names (the real database cannot; it compares
     the tag with the one it stored). Anything that is not a tag is refused,
     as the real functions refuse it, so a code that reached the database
     would fail the test that sent it. */
  const lookup = tag => {
    if (!isTag(tag)) throw new Error('the database was handed something that is not a tag');
    if (state.addressLocked) return { error: 'locked' };
    const k = Object.values(state.cards).find(c => codeTag(c.code) === tag);
    if (!k) return { error: 'not_found' };
    // A replaced card says so (Colin, Nov 10).
    return refusal(k) ? { error: refusal(k) } : k.locked ? { error: 'card_locked' } : { card: k };
  };
  // The card's own password, as a tag bound to the card. No password typed is nothing at all.
  const passwordRight = (k, tag) => {
    if (tag != null && !isTag(tag)) throw new Error('the database was handed a password that is not a tag');
    return !!k.password && tag === passwordTag(k.code, norm(k.password));
  };
  const classes = s =>
    Object.keys(s.cards)
      .map(e => state.cards[s.cards[e]])
      .filter(k => !refusal(k))
      .map(k => ({ enrollment_id: k.enrollment, student: { first_name: k.first }, course: clone(k.course) }));
  const inSession = (token, enrollment) => {
    const s = live(token);
    if (!s) return { error: 'signed_out' };
    const k = state.cards[s.cards[enrollment]];
    if (!k) return { error: 'not_found' };
    return refusal(k) ? { error: refusal(k) } : { session: s, card: k };
  };

  /* Each function takes the parameters its statement sends, in order, less
     the key id (taken off below): card and verify_card take the code's tag
     first. */
  const fns = {
    card(tag) {
      const found = lookup(tag);
      if (found.error) return no(found.error);
      const k = found.card;
      if (!k.birthday && !k.number && !k.password) return no('reprint');
      const identity = !!(k.birthday || k.number);
      return {
        ok: true,
        kind: 'card',
        student: { first_name: k.first },
        course: clone(k.course),
        check: identity ? 'identity' : 'password',
        also_password: identity && !!k.password,
      };
    },
    verify_card(tag, birthday, number, password, token, hash, add) {
      const found = lookup(tag);
      if (found.error) return no(found.error);
      const k = found.card;
      if (!k.birthday && !k.number && !k.password) return no('reprint');
      const right =
        (k.birthday && birthday === k.birthday) ||
        (k.number && norm(number) === norm(k.number)) ||
        passwordRight(k, password);
      if (!right) {
        k.wrong += 1;
        if (k.wrong >= 5) {
          k.locked = true;
          return no('card_locked');
        }
        return no('wrong_identity', { tries_left: 5 - k.wrong });
      }
      // From the start screen: whoever was signed in on the device is signed out.
      if (live(token) && !add) delete state.sessions[token];
      let s = live(token);
      let fresh = null;
      if (!s) {
        made += 1;
        fresh = (('0' + made).slice(-2) + 'ab'.repeat(31)).slice(0, 64);
        s = state.sessions[fresh] = { expires: new Date(now() + (opts.lasts || 6 * 3600e3)).toISOString(), cards: {} };
      }
      s.cards[k.enrollment] = norm(k.code);
      k.wrong = 0;
      return {
        ok: true,
        session_token: fresh,
        expires_at: s.expires,
        enrollment_id: k.enrollment,
        classes: classes(s),
      };
    },
    page(token, enrollment) {
      const found = inSession(token, enrollment);
      if (found.error) return no(found.error);
      const reply = clone(found.card.page);
      reply.expires_at = found.session.expires;
      reply.classes = classes(found.session);
      reply.assessments.forEach(a => {
        const opened = state.seen[enrollment + ':' + a.id];
        if (opened) a.seen_at = opened;
      });
      return state.dirty ? state.dirty(reply) || reply : reply;
    },
    seen(token, enrollment, ids) {
      const found = inSession(token, enrollment);
      if (found.error) return no(found.error);
      const mine = found.card.page.assessments.map(a => a.id);
      const opened = ids
        .slice(1, -1)
        .split(',')
        .filter(a => mine.includes(a));
      opened.forEach(a => (state.seen[enrollment + ':' + a] = new Date(now()).toISOString()));
      return { ok: true, seen: opened.length };
    },
    done(token) {
      delete state.sessions[token];
      return { ok: true };
    },
    // Send Work off: what the class takes, as student_submit.work answers it then.
    work(token, enrollment) {
      const found = inSession(token, enrollment);
      return found.error ? no(found.error) : { ok: true, v: 1, send_work: false, assessments: [] };
    },
  };
  const world = opts.sendWork
    ? fakeWorld({
        enrollments: Object.fromEntries((opts.cards || []).map(k => [k.enrollment, { course: C1 }])),
        assessments: Object.fromEntries(Object.entries(opts.sendWork).map(([a, take]) => [a, { course: C1, ...take }])),
        sessionError: (token, enrollment) => {
          const found = inSession(token, enrollment);
          return found.error ? no(found.error) : null;
        },
        storeBase: opts.storeBase,
        now,
      })
    : null;
  const SEND_FNS = ['work', 'send_start', 'replace', 'send_paths', 'send_finish', 'unsend', 'file_links'];
  const WORKER_FNS = ['removal_batch', 'removal_done'];

  const slip = name => async code => {
    if (state.down) throw new Error('down');
    sql.push({ fn: name, params: [code] });
    if (name !== 'open') return clone(state.slipAnswers[name]);
    return state.slips[norm(code)] ? clone(state.slips[norm(code)]) : no('not_found');
  };
  const options = {
    region: 'ca-central-1',
    ipKey: 'test-key',
    log: entry => logs.push(entry),
    db: {
      open: slip('open'),
      verify: slip('verify'),
      check: slip('check'),
      submit: slip('submit'),
      async call(text, params) {
        if (state.down) throw new Error('down');
        const fn = /^select student_submit\.(\w+)\(/.exec(text)[1];
        const add = /, p_add => (true|false)\) as r$/.exec(text);
        if (world && WORKER_FNS.includes(fn)) return world.db.call(text, params);
        sql.push({ fn, params: params.slice(0, -1), add: add ? add[1] === 'true' : undefined });
        if (world && SEND_FNS.includes(fn)) return world.db.call(text, params);
        // Batch C's `feedback`: what state.feedback holds, else a class with no marks and Reflect on Feedback off.
        if (fn === 'feedback') {
          return clone(
            state.feedback || {
              ok: true,
              v: 1,
              reflect_on_feedback: false,
              show_my_learning: false,
              assessments: [],
              last_plan: null,
            },
          );
        }
        // `reflect`: a reflection kept as sent, and given back by `feedback` after (state.feedback must be set).
        if (fn === 'reflect') {
          const kept = typeof params[3] === 'string' ? JSON.parse(params[3]) : params[3];
          const reflection = {
            makes_sense: kept.makes_sense,
            question: kept.question || null,
            plan: kept.plan || null,
            went_well: kept.went_well || null,
            sent_at: new Date(now()).toISOString(),
          };
          const row = { id: params[2], marks: null, revision: null, reflection };
          state.feedback.assessments = state.feedback.assessments.filter(a => a.id !== params[2]).concat([row]);
          return { ok: true, reflection };
        }
        const args = [...params, add ? add[1] === 'true' : undefined];
        // card and verify_card take the key id second. The stand-in only checks it is one.
        if (fn === 'card' || fn === 'verify_card') {
          if (!/^[0-9a-f]{8}$/.test(String(args[1]))) throw new Error('the database was handed no key id');
          args.splice(1, 1);
        }
        return fns[fn](...args);
      },
    },
  };
  // Reading the key is not instant, so the handler is ready a moment after the fake is made.
  const handler = readCardKey(opts.cardKey === undefined ? FAKE_KEY : opts.cardKey).then(cardKey =>
    makeHandler({ ...options, cardKey, store: world ? world.store : null }),
  );

  const respond = async (body, headers) => {
    const res = await (
      await handler
    )(
      new Request('https://x.supabase.co/functions/v1/student-submit?forceFunctionRegion=ca-central-1', {
        method: 'POST',
        headers: Object.assign(
          { 'content-type': 'application/json', origin: 'https://fullvision.ca', 'cf-connecting-ip': '203.0.113.7' },
          headers,
        ),
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }),
    );
    return { status: res.status, json: await res.json() };
  };
  return { respond, handle: async (body, headers) => (await respond(body, headers)).json, state, sql, logs, world };
}
