/**
 * Batch C's student routes on the student-submit edge function
 * (supabase/functions/student-submit/feedback-routes.ts and
 * revision-routes.ts): feedback, markup, reflect, reply, answer-seen,
 * group-work, revise-start, revise-finish, revise-unsend and group-links.
 * Run through the whole handler with a stand-in database and the send
 * routes' stand-in bucket (tests/helpers/fake-send-world.js).
 *
 * The rules live in SQL (migrations/2026111120_markup_reflect_revise.sql).
 * This checks what the function adds: the Canada check first; the session
 * and the request's shape checked before the database is asked, so no
 * request the SQL would raise 22023 for is sent; the hashed address last;
 * each reply copied field by field; refusals passed on by their code, any
 * other as not_found; for a revision, every file read and checked before
 * it is handed in and upload or download links only for paths the
 * database named and that are this send's or this group's; the removal
 * worker after each route that can queue a file; and logs that hold
 * nothing about a student.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { makeHandler } from '../supabase/functions/student-submit/handler.ts';
import { SQL as FEEDBACK_SQL } from '../supabase/functions/student-submit/feedback-routes.ts';
import { SQL as REVISION_SQL } from '../supabase/functions/student-submit/revision-routes.ts';
import {
  C1,
  CECE,
  CECE_PHONE,
  ENDED,
  ESSAY,
  LAB,
  LIAM,
  LIAM_PHONE,
  MAP,
  OMAR,
  OMAR_PHONE,
  PAGE2_JPEG,
  PAGE_JPEG,
  THUMB2_JPEG,
  THUMB_JPEG,
  fakeWorld,
} from './helpers/fake-send-world.js';

const URL_ = 'https://x.supabase.co/functions/v1/student-submit?forceFunctionRegion=ca-central-1';
const REQ = '0f0f0f0f-0000-4000-8000-0000000000c1';
const REQ2 = '0f0f0f0f-0000-4000-8000-0000000000c2';
const LOCKED_PHONE = 'k'.repeat(64);
const HASH = /^[0-9a-f]{64}$/;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const clone = v => JSON.parse(JSON.stringify(v));

let counter = 0;
const newId = () => {
  counter += 1;
  return `77${String(counter).padStart(6, '0')}-0000-4000-8000-${String(counter).padStart(12, '0')}`;
};

function raise() {
  const e = new Error('invalid_parameter_value');
  e.name = 'PostgresError';
  e.code = '22023';
  throw e;
}

const BY_SQL = Object.fromEntries(
  [...Object.entries(FEEDBACK_SQL), ...Object.entries(REVISION_SQL)].map(([k, v]) => [v, k]),
);

/* A stand-in for Batch C's functions, beside the send world (which answers
   send_paths, work, file_links and the removal worker). Cece and Omar are a
   group on LAB in class C1; Liam is in C2. LOCKED_PHONE holds Cece's class
   on a locked card: the reads answer, the writes say card_locked. */
function batchC(world) {
  const course = { [CECE]: C1, [OMAR]: C1, [LIAM]: 'c2c2c2c2-0000-4000-8000-000000000002' };
  const group = { [LAB]: [CECE, OMAR] };
  const state = { reflect_on: true, requests: { [`${CECE}/${LAB}`]: { open: true, revise_by: null } } };
  const sessionErr = (token, e, writes) => {
    if (token === LOCKED_PHONE) return e === CECE ? (writes ? { ok: false, error: 'card_locked' } : null) : nf();
    if (token === ENDED) return { ok: false, error: 'signed_out' };
    const mine = { [CECE_PHONE]: CECE, [OMAR_PHONE]: OMAR, [LIAM_PHONE]: LIAM }[token];
    if (!mine) return { ok: false, error: 'signed_out' };
    return mine === e ? null : nf();
  };
  const nf = () => ({ ok: false, error: 'not_found' });
  const files = (sub, n, e, a) =>
    Array.from({ length: n }, (_, i) => {
      const f = newId();
      const base = `${course[e]}/${a}/${e}/${sub}/${f}`;
      return { id: f, page: i + 1, path: base + '.jpg', thumb_path: base + '-thumb.jpg', added_by: 'student' };
    });
  const uploadJson = sub =>
    sub.files.map(f => ({ file_id: f.id, page: f.page, path: f.path, thumb_path: f.thumb_path }));
  const subsOf = (a, e, st) =>
    [...world.subs.values()].filter(s => s.assessment === a && s.enrollment === e && s.state === st);

  // A first send, handed in, with its files in the bucket.
  function seedSent(e, a, version = 1, pages = 1) {
    const id = newId();
    const sub = {
      id,
      course: course[e],
      assessment: a,
      enrollment: e,
      state: 'sent',
      intent: 'new',
      sent_by: 'student',
      request_id: newId(),
      note: null,
      created_at: '2026-11-10T17:00:00+00:00',
      sent_at: '2026-11-10T17:05:00+00:00',
      version,
      files: [],
    };
    sub.files = files(id, pages, e, a);
    for (const f of sub.files) {
      world.objects.set(f.path, { bytes: PAGE_JPEG, type: 'image/jpeg', cache: 'private, no-store' });
      world.objects.set(f.thumb_path, { bytes: THUMB_JPEG, type: 'image/jpeg', cache: 'private, no-store' });
    }
    world.subs.set(id, sub);
    return sub;
  }

  const fns = {
    feedback([t, e]) {
      return sessionErr(t, e) || clone(FEEDBACK_REPLY);
    },
    markup([t, e, a]) {
      if (!a) raise();
      const err = sessionErr(t, e);
      if (err) return err;
      if (a === MAP) return nf();
      return clone(MARKUP_REPLY);
    },
    reflect([t, e, a, r]) {
      if (!a) raise();
      const x = JSON.parse(r);
      if (!x || typeof x !== 'object' || Array.isArray(x)) raise();
      for (const k of Object.keys(x)) {
        if (!['makes_sense', 'question', 'plan', 'went_well'].includes(k)) raise();
        if (k !== 'makes_sense' && x[k] !== null && typeof x[k] !== 'string') raise();
      }
      if (!['yes', 'not_sure'].includes(x.makes_sense)) raise();
      const trim = v => (v == null ? null : v.replace(/^ +| +$/g, '') || null);
      const [q, plan, well] = [trim(x.question), trim(x.plan), trim(x.went_well)];
      if ([q, plan, well].some(v => v && [...v].length > 1000)) raise();
      if (x.makes_sense === 'not_sure' && !q) raise();
      if (x.makes_sense === 'yes' && !plan) raise();
      const err = sessionErr(t, e, true);
      if (err) return err;
      if (!state.reflect_on) return { ok: false, error: 'reflect_off' };
      if (a === MAP) return nf();
      if (a === ESSAY) return { ok: false, error: 'not_returned' };
      return {
        ok: true,
        reflection: {
          makes_sense: x.makes_sense,
          question: q,
          plan,
          went_well: well,
          sent_at: '2026-11-11T18:00:00+00:00',
          note: 'Only Me: talk to her mum',
        },
      };
    },
    reply([t, e, a, r]) {
      if (!a) raise();
      const x = JSON.parse(r);
      for (const k of Object.keys(x)) if (!['sense_now', 'follow_up', 'plan'].includes(k)) raise();
      if (!['yes', 'not_sure'].includes(x.sense_now)) raise();
      const trim = v => (v == null ? null : v.replace(/^ +| +$/g, '') || null);
      if (trim(x.follow_up) && (x.sense_now !== 'not_sure' || [...trim(x.follow_up)].length > 1000)) raise();
      if (trim(x.plan) && (x.sense_now !== 'yes' || [...trim(x.plan)].length > 1000)) raise();
      const err = sessionErr(t, e, true);
      if (err) return err;
      if (!state.reflect_on) return { ok: false, error: 'reflect_off' };
      if (a === ESSAY) return { ok: false, error: 'not_answered' };
      return {
        ok: true,
        reflection: {
          sense_now: x.sense_now,
          follow_up: trim(x.follow_up),
          plan: trim(x.plan),
          answer: 'Look at the second paragraph.',
          follow_up_answer: null,
          follow_up_note: 'Only Me',
        },
      };
    },
    answerSeen([t, e, ids]) {
      const err = sessionErr(t, e);
      if (err) return err;
      if (!/^\{([0-9a-f-]{36}(,[0-9a-f-]{36})*)?\}$/.test(ids)) raise();
      return { ok: true, seen: ids === '{}' ? 0 : ids.split(',').length, who: CECE };
    },
    groupWork([t, e]) {
      return (
        sessionErr(t, e) || {
          ok: true,
          assessments: [
            {
              id: LAB,
              members: 2,
              sent: true,
              pages: 3,
              you_sent: false,
              first_sent_at: '2026-11-10T17:05:00+00:00',
              names: ['Omar'],
              member_ids: [OMAR],
            },
          ],
        }
      );
    },
    revisionStart([t, e, a, pagesJson, note, req]) {
      if (!req || !a) raise();
      const p = JSON.parse(pagesJson);
      if (!Array.isArray(p) || p.length < 1 || p.length > 30) raise();
      if (note != null && [...note].length > 1000) raise();
      const err = sessionErr(t, e, true);
      if (err) return err;
      if (a === MAP) return nf();
      const mine = [...world.subs.values()].find(s => s.assessment === a && s.enrollment === e && s.request_id === req);
      if (mine) {
        return {
          ok: true,
          replayed: true,
          submission_id: mine.id,
          state: mine.state,
          version: mine.version || 1,
          bucket: 'student-photos',
          late: false,
          finish_by: mine.state === 'sending' ? '2026-11-11T19:00:00+00:00' : null,
          files: mine.state === 'sending' ? uploadJson(mine) : [],
        };
      }
      const request = state.requests[`${e}/${a}`];
      if (!request || !request.open) return { ok: false, error: 'no_revision' };
      for (const s of subsOf(a, e, 'sending')) world.subs.delete(s.id);
      const version = Math.max(1, ...subsOf(a, e, 'sent').map(s => s.version || 1)) + 1;
      const id = newId();
      const sub = {
        id,
        course: course[e],
        assessment: a,
        enrollment: e,
        state: 'sending',
        intent: 'new',
        sent_by: 'student',
        request_id: req,
        note,
        created_at: '2026-11-11T17:00:00+00:00',
        finish_by: '2026-11-11T19:00:00+00:00',
        version,
        files: [],
      };
      sub.files = files(id, p.length, e, a);
      world.subs.set(id, sub);
      return {
        ok: true,
        replayed: false,
        submission_id: id,
        state: 'sending',
        version,
        bucket: 'student-photos',
        late: false,
        finish_by: sub.finish_by,
        files: uploadJson(sub),
        card_id: 'never-sent',
      };
    },
    revisionFinish([t, e, subId, filesJson]) {
      if (!subId) raise();
      const fs = JSON.parse(filesJson);
      if (!Array.isArray(fs) || fs.length < 1 || fs.length > 30) raise();
      for (const f of fs) if (!/^[0-9a-f]{64}$/.test(f.sha256 || '')) raise();
      const err = sessionErr(t, e, true);
      if (err) return err;
      const sub = world.subs.get(subId);
      if (!sub || sub.enrollment !== e || (sub.version || 1) < 2) return nf();
      if (fs.some(f => !sub.files.some(x => x.id === f.file_id))) raise();
      if (sub.state === 'sent') {
        return {
          ok: true,
          replayed: true,
          submission_id: sub.id,
          version: sub.version,
          sent_at: sub.sent_at,
          late: false,
          pages: sub.files.length,
        };
      }
      const request = state.requests[`${e}/${sub.assessment}`];
      if (request && request.changed) {
        world.subs.delete(sub.id);
        return { ok: false, error: 'request_changed' };
      }
      sub.files = fs.map((f, i) => ({ ...sub.files.find(x => x.id === f.file_id), page: i + 1, sha256: f.sha256 }));
      sub.state = 'sent';
      sub.sent_at = '2026-11-11T17:30:00+00:00';
      return {
        ok: true,
        replayed: false,
        submission_id: sub.id,
        version: sub.version,
        sent_at: sub.sent_at,
        late: false,
        pages: sub.files.length,
      };
    },
    revisionUnsend([t, e, a]) {
      if (!a) raise();
      const err = sessionErr(t, e, true);
      if (err) return err;
      if (a === MAP) return nf();
      const rev = subsOf(a, e, 'sent').find(s => (s.version || 1) > 1);
      if (!rev) return { ok: true, unsent: false, cancelled: false, pages: 0 };
      if (rev.grading) return { ok: false, error: 'grading_started' };
      const pages = rev.files.length;
      for (const f of rev.files) {
        for (const p of [f.path, f.thumb_path])
          world.queue.push({ id: world.queue.length + 1000, bucket: 'student-photos', path: p, done: false });
      }
      world.subs.delete(rev.id);
      return { ok: true, unsent: true, cancelled: false, pages };
    },
    groupFileLinks([t, e, a]) {
      if (!a) raise();
      const err = sessionErr(t, e);
      if (err) return err;
      const members = group[a] && group[a].includes(e) ? group[a] : [e];
      const out = [...world.subs.values()]
        .filter(
          s => s.assessment === a && s.state === 'sent' && members.includes(s.enrollment) && s.course === course[e],
        )
        .flatMap(s =>
          s.files.map(f => ({
            file_id: f.id,
            submission_id: s.id,
            version: s.version || 1,
            page: f.page,
            path: f.path,
            thumb_path: f.thumb_path,
            width: 900,
            height: 1200,
            rotation: 0,
            mine: s.enrollment === e,
            enrollment_id: s.enrollment,
          })),
        );
      return { ok: true, bucket: 'student-photos', files: out };
    },
  };
  return { fns, state, seedSent };
}

const GRADE = {
  v: 1,
  value: 2,
  modifier: 1,
  comment: 'Good start.',
  draft_value: 4,
  tags: { 'b1b1b1b1-0000-4000-8000-000000000001': { value: 3, modifier: 0, comment: null, private: 'x' } },
  criteria: {},
  checks: ['c1c1c1c1-0000-4000-8000-0000000000aa', 'not-an-id'],
};
const FEEDBACK_REPLY = {
  ok: true,
  v: 1,
  reflect_on_feedback: true,
  show_my_learning: false,
  teacher_name: 'Mr. Brown',
  assessments: [
    {
      id: LAB,
      marks: { pages: 1, work_pages: 2, notes: 3, working: { marks: [] } },
      revision: {
        state: 'open',
        what_to_fix: 'Add a third reason.',
        revise_by: '2026-11-20',
        criterion_ids: ['d1d1d1d1-0000-4000-8000-000000000001', 'nope'],
        keep_grade: true,
        grade_hidden: false,
        first_version: 1,
        first_sent_at: '2026-11-10T17:05:00+00:00',
        first_grade: GRADE,
        revision_version: null,
        revision_sent_at: null,
        revision_note: null,
        revision_late: null,
        asked_at: '2026-11-11T10:00:00+00:00',
        enrollment_id: CECE,
        grade_mark: 'abc',
      },
      reflection: {
        makes_sense: 'not_sure',
        question: 'What is a cell wall?',
        plan: null,
        went_well: null,
        sent_at: '2026-11-11T11:00:00+00:00',
        answer: 'Plants have them.',
        answered_at: '2026-11-11T12:00:00+00:00',
        sense_now: null,
        follow_up: null,
        follow_up_answer: null,
        follow_up_answered_at: null,
        answer_new: true,
        note: 'Only Me: check in',
        follow_up_note: 'Only Me',
        noted_at: '2026-11-11T12:00:00+00:00',
      },
      enrollment_id: OMAR,
    },
  ],
  last_plan: { assessment_id: LAB, plan: 'Read it twice.', sent_at: '2026-11-11T11:00:00+00:00', id: 'x' },
};
const MARKUP_REPLY = {
  ok: true,
  files: [
    {
      file_id: 'f0f0f0f0-0000-4000-8000-000000000001',
      given_at: '2026-11-11T12:00:00+00:00',
      enrollment_id: OMAR,
      marks: {
        v: 1,
        working: true,
        marks: [
          {
            type: 'pen',
            points: [
              [0.1, 0.2],
              [0.3, 0.4],
            ],
            width: 0.01,
            color: 'red',
            id: 'm1',
            author: 'Mr. Brown',
          },
          { type: 'note', x: 0.5, y: 0.5, text: 'Nice.', color: 'purple' },
          { type: 'tick', x: 0.2, y: 0.9 },
          { type: 'image', x: 0, y: 0, src: 'https://evil.example/x.png' },
          { type: 'note', x: 0.5, y: 0.5 },
          { type: 'pen', points: [[0.1, 'x']] },
        ],
      },
    },
  ],
};

function setup(extra = {}) {
  const world = fakeWorld();
  const bc = batchC(world);
  // send_paths and file_links say each send's version, as the live ones do (fake-send-world.js says 1 always).
  world.override.send_paths = (params, fns) => {
    // A locked card may not send (student_submit._send_session).
    if (params[0] === LOCKED_PHONE) return { ok: false, error: 'card_locked' };
    const r = fns.send_paths(params);
    if (r.ok) r.version = world.subs.get(params[2]).version || 1;
    return clone(r);
  };
  world.override.file_links = (params, fns) => {
    const r = fns.file_links(params);
    if (r.ok) for (const f of r.files) f.version = world.subs.get(f.submission_id).version || 1;
    return clone(r);
  };
  // work says the latest version handed in, as the live one does.
  world.override.work = (params, fns) => {
    const r = fns.work(params);
    if (r.ok) {
      for (const a of r.assessments) {
        const latest = [...world.subs.values()]
          .filter(s => s.assessment === a.id && s.enrollment === params[1] && s.state === 'sent')
          .sort((x, y) => (y.version || 1) - (x.version || 1))[0];
        if (latest)
          a.sent = { ...a.sent, submission_id: latest.id, sent_at: latest.sent_at, pages: latest.files.length };
      }
    }
    return clone(r);
  };
  const logs = [];
  const db = {
    async call(sql, params) {
      const name = BY_SQL[sql];
      if (!name) return world.db.call(sql, params);
      world.calls.push([name, params]);
      if (extra.answer && extra.answer[name]) return clone(extra.answer[name](params));
      return clone(bc.fns[name](params));
    },
  };
  const handle = makeHandler({
    region: 'ca-central-1',
    ipKey: 'test-key',
    db: {
      open: async () => ({ ok: false }),
      verify: async () => ({ ok: false }),
      check: async () => ({ ok: false }),
      submit: async () => ({ ok: false }),
      call: db.call,
    },
    store: 'store' in extra ? extra.store : world.store,
    log: entry => logs.push(entry),
  });
  const send = async body => {
    const res = await handle(
      new Request(URL_, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://fullvision.ca',
          'cf-connecting-ip': '203.0.113.7',
        },
        body: JSON.stringify(body),
      }),
    );
    return { status: res.status, body: await res.json() };
  };
  return { world, bc, logs, handle, send };
}

const names = world => world.calls.map(c => c[0]);
const BASE = { session: CECE_PHONE, enrollment_id: CECE };
const PAGES = [
  { width: 900, height: 1200, bytes: PAGE_JPEG.length, thumb_bytes: THUMB_JPEG.length },
  { width: 900, height: 1200, bytes: PAGE2_JPEG.length, thumb_bytes: THUMB2_JPEG.length },
];
const ROUTES = {
  feedback: { route: 'feedback', ...BASE },
  markup: { route: 'markup', ...BASE, assessment_id: LAB },
  reflect: {
    route: 'reflect',
    ...BASE,
    assessment_id: LAB,
    reflection: { makes_sense: 'yes', plan: 'Read it twice.' },
  },
  reply: { route: 'reply', ...BASE, assessment_id: LAB, reply: { sense_now: 'yes' } },
  'answer-seen': { route: 'answer-seen', ...BASE, assessment_ids: [LAB] },
  'group-work': { route: 'group-work', ...BASE },
  'revise-start': {
    route: 'revise-start',
    ...BASE,
    assessment_id: LAB,
    request_id: REQ,
    pages: PAGES,
    note: 'Fixed it.',
  },
  'revise-finish': {
    route: 'revise-finish',
    ...BASE,
    submission_id: 'f9f9f9f9-0000-4000-8000-000000000001',
    files: ['f9f9f9f9-0000-4000-8000-000000000002'],
  },
  'revise-unsend': { route: 'revise-unsend', ...BASE, assessment_id: LAB },
  'group-links': { route: 'group-links', ...BASE, assessment_id: LAB },
};
const WRITES = ['reflect', 'reply', 'revise-start', 'revise-finish', 'revise-unsend'];

/* Cece starts a revision of two pages and her phone uploads every file. */
async function revising(
  t,
  over = {},
  files = [
    [PAGE_JPEG, THUMB_JPEG],
    [PAGE2_JPEG, THUMB2_JPEG],
  ],
) {
  const r = await t.send({ ...ROUTES['revise-start'], ...over });
  expect(r.status).toBe(200);
  expect(r.body.ok).toBe(true);
  r.body.files.forEach((f, i) => {
    if (!files[i]) return;
    expect(t.world.phoneUpload(f.upload_url, files[i][0])).toBe(200);
    expect(t.world.phoneUpload(f.thumb_upload_url, files[i][1])).toBe(200);
  });
  return r.body;
}
const finishBody = (s, over = {}) => ({
  route: 'revise-finish',
  ...BASE,
  submission_id: s.submission_id,
  files: s.files.map(f => f.file_id),
  ...over,
});

describe('every Batch C route', () => {
  it.each(Object.keys(ROUTES))('%s outside ca-central-1 is refused before anything is asked', async route => {
    const world = fakeWorld();
    const handle = makeHandler({ region: 'us-east-1', ipKey: 'k', db: world.db, store: world.store, log: () => {} });
    const res = await handle(
      new Request(URL_, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(ROUTES[route]),
      }),
    );
    expect(res.status).toBe(421);
    expect(world.calls).toEqual([]);
    expect(world.storeCalls).toEqual([]);
  });

  it.each(Object.keys(ROUTES))(
    '%s: no session, or one of the wrong shape, or no enrollment id, asks nothing',
    async route => {
      const bad = [
        ...[undefined, null, '', 12, 'a'.repeat(129), ['s']].map(session => ({ session })),
        ...[undefined, null, 'CECE', 12, CECE + 'x'].map(enrollment_id => ({ enrollment_id })),
      ];
      for (const over of bad) {
        const t = setup();
        const r = await t.send({ ...ROUTES[route], ...over });
        expect(r, JSON.stringify(over)).toEqual({ status: 400, body: { ok: false, error: 'bad_request' } });
        expect(t.world.calls).toEqual([]);
        expect(t.world.storeCalls).toEqual([]);
      }
    },
  );

  it.each(Object.keys(ROUTES))('%s: an ended session is signed_out, and another student is not_found', async route => {
    const t = setup();
    expect((await t.send({ ...ROUTES[route], session: ENDED })).body).toEqual({ ok: false, error: 'signed_out' });
    // Omar's phone asking about Cece: the database answers not_found, and nothing is signed or read.
    expect((await t.send({ ...ROUTES[route], session: OMAR_PHONE })).body).toEqual({ ok: false, error: 'not_found' });
    expect(t.world.storeCalls.filter(c => c[0] !== 'remove')).toEqual([]);
  });

  it.each(Object.keys(ROUTES))('%s: the hashed address goes last, never the address itself', async route => {
    const t = setup();
    await t.send(ROUTES[route]);
    const first = t.world.calls[0];
    expect(first[1][0]).toBe(CECE_PHONE);
    expect(first[1][1]).toBe(CECE);
    expect(first[1][first[1].length - 1]).toMatch(HASH);
    expect(JSON.stringify(t.world.calls)).not.toContain('203.0.113.7');
  });

  it.each(WRITES)('%s: a locked card is card_locked', async route => {
    const t = setup();
    const r = await t.send({ ...ROUTES[route], session: LOCKED_PHONE });
    expect(r.body).toEqual({ ok: false, error: 'card_locked' });
  });

  it.each(['feedback', 'markup', 'answer-seen', 'group-work', 'group-links'])(
    '%s: a locked card may still read',
    async route => {
      const t = setup();
      const r = await t.send({ ...ROUTES[route], session: LOCKED_PHONE });
      expect(r.body.ok).toBe(true);
    },
  );

  it.each(Object.keys(ROUTES))('%s: a refusal the route does not list is not_found, with nothing else', async route => {
    const name = {
      feedback: 'feedback',
      markup: 'markup',
      reflect: 'reflect',
      reply: 'reply',
      'answer-seen': 'answerSeen',
      'group-work': 'groupWork',
      'revise-start': 'revisionStart',
      'revise-unsend': 'revisionUnsend',
      'group-links': 'groupFileLinks',
    }[route];
    if (!name) return; // revise-finish: its first call is send_paths, covered below
    const t = setup({
      answer: { [name]: () => ({ ok: false, error: 'teacher_is_mr_brown', teacher_name: 'Mr. Brown' }) },
    });
    expect((await t.send(ROUTES[route])).body).toEqual({ ok: false, error: 'not_found' });
  });

  it.each(Object.keys(ROUTES))('%s: 22023 from the database is a plain server error', async route => {
    const fail = () => raise();
    const t = setup({
      answer: Object.fromEntries(
        [
          'feedback',
          'markup',
          'reflect',
          'reply',
          'answerSeen',
          'groupWork',
          'revisionStart',
          'revisionUnsend',
          'groupFileLinks',
        ].map(n => [n, fail]),
      ),
    });
    t.world.override.send_paths = () => raise();
    const r = await t.send(ROUTES[route]);
    expect(r).toEqual({ status: 500, body: { ok: false, error: 'server' } });
    expect(JSON.stringify(t.logs)).not.toContain('invalid_parameter_value');
  });

  it('the send routes still answer as before beside these', async () => {
    const t = setup();
    const r = await t.send({ route: 'work', ...BASE });
    expect(r.body.ok).toBe(true);
    expect(names(t.world)).toEqual(['work']);
  });
});

describe('feedback', () => {
  it('copies only the listed fields: no Only Me note, no teacher name, no other student', async () => {
    const t = setup();
    const r = await t.send(ROUTES.feedback);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      ok: true,
      v: 1,
      reflect_on_feedback: true,
      show_my_learning: false,
      assessments: [
        {
          id: LAB,
          marks: { pages: 1, work_pages: 2, notes: 3 },
          revision: {
            state: 'open',
            what_to_fix: 'Add a third reason.',
            revise_by: '2026-11-20',
            keep_grade: true,
            grade_hidden: false,
            first_version: 1,
            first_sent_at: '2026-11-10T17:05:00+00:00',
            revision_version: null,
            revision_sent_at: null,
            revision_note: null,
            revision_late: null,
            asked_at: '2026-11-11T10:00:00+00:00',
            criterion_ids: ['d1d1d1d1-0000-4000-8000-000000000001'],
            first_grade: {
              v: 1,
              value: 2,
              modifier: 1,
              comment: 'Good start.',
              tags: { 'b1b1b1b1-0000-4000-8000-000000000001': { value: 3, modifier: 0, comment: null } },
              criteria: {},
              checks: ['c1c1c1c1-0000-4000-8000-0000000000aa'],
            },
          },
          reflection: {
            makes_sense: 'not_sure',
            question: 'What is a cell wall?',
            plan: null,
            went_well: null,
            sent_at: '2026-11-11T11:00:00+00:00',
            answer: 'Plants have them.',
            answered_at: '2026-11-11T12:00:00+00:00',
            sense_now: null,
            follow_up: null,
            follow_up_answer: null,
            follow_up_answered_at: null,
            answer_new: true,
          },
        },
      ],
      last_plan: { assessment_id: LAB, plan: 'Read it twice.', sent_at: '2026-11-11T11:00:00+00:00' },
    });
    expect(JSON.stringify(r.body)).not.toMatch(/Only Me|Mr\. Brown|draft|working|grade_mark/);
    expect(JSON.stringify(r.body)).not.toContain(OMAR);
  });

  it('a piece with nothing is null in each part, and an object in a plain field is not copied', async () => {
    const t = setup({
      answer: {
        feedback: () => ({
          ok: true,
          v: 1,
          reflect_on_feedback: { on: true },
          show_my_learning: false,
          assessments: [{ id: LAB, marks: null, revision: null, reflection: null }],
          last_plan: null,
        }),
      },
    });
    const r = await t.send(ROUTES.feedback);
    expect(r.body).toEqual({
      ok: true,
      v: 1,
      reflect_on_feedback: null,
      show_my_learning: false,
      assessments: [{ id: LAB, marks: null, revision: null, reflection: null }],
      last_plan: null,
    });
  });
});

describe('markup', () => {
  it('copies each mark by its type, and drops a mark of another type or missing what it needs', async () => {
    const t = setup();
    const r = await t.send(ROUTES.markup);
    expect(r.body).toEqual({
      ok: true,
      files: [
        {
          file_id: 'f0f0f0f0-0000-4000-8000-000000000001',
          given_at: '2026-11-11T12:00:00+00:00',
          marks: {
            v: 1,
            marks: [
              {
                type: 'pen',
                points: [
                  [0.1, 0.2],
                  [0.3, 0.4],
                ],
                width: 0.01,
                color: 'red',
                id: 'm1',
              },
              { type: 'note', x: 0.5, y: 0.5, text: 'Nice.' },
              { type: 'tick', x: 0.2, y: 0.9 },
            ],
          },
        },
      ],
    });
    expect(names(t.world)).toEqual(['markup']);
    expect(t.world.calls[0][1].slice(0, 3)).toEqual([CECE_PHONE, CECE, LAB]);
  });

  it("another class's piece is not_found; no assessment id is bad_request", async () => {
    const t = setup();
    expect((await t.send({ ...ROUTES.markup, assessment_id: MAP })).body).toEqual({ ok: false, error: 'not_found' });
    expect((await t.send({ ...ROUTES.markup, assessment_id: 'LAB' })).status).toBe(400);
    expect(names(t.world)).toEqual(['markup']);
  });
});

describe('reflect', () => {
  it('passes the reflection on, rebuilt from its own four fields, and copies the answer', async () => {
    const t = setup();
    const r = await t.send({
      ...ROUTES.reflect,
      reflection: { makes_sense: 'not_sure', question: ' What is a cell wall? ', went_well: null },
      teacher_id: 'x',
    });
    expect(r.body).toEqual({
      ok: true,
      reflection: {
        makes_sense: 'not_sure',
        question: 'What is a cell wall?',
        plan: null,
        went_well: null,
        sent_at: '2026-11-11T18:00:00+00:00',
      },
    });
    const params = t.world.calls[0][1];
    expect(params.slice(0, 3)).toEqual([CECE_PHONE, CECE, LAB]);
    expect(JSON.parse(params[3])).toEqual({
      makes_sense: 'not_sure',
      question: ' What is a cell wall? ',
      went_well: null,
    });
  });

  it('refuses every shape the SQL would raise for, and asks nothing', async () => {
    const long = 'a'.repeat(1001);
    const bads = [
      undefined,
      null,
      'yes',
      [],
      {},
      { makes_sense: 'maybe', plan: 'x' },
      { makes_sense: true, plan: 'x' },
      { makes_sense: 'yes' },
      { makes_sense: 'yes', plan: '   ' },
      { makes_sense: 'not_sure', plan: 'x' },
      { makes_sense: 'not_sure', question: '' },
      { makes_sense: 'yes', plan: 'x', mood: 'happy' },
      { makes_sense: 'yes', plan: 'x', __proto__x: 1 },
      { makes_sense: 'yes', plan: 12 },
      { makes_sense: 'yes', plan: ['x'] },
      { makes_sense: 'yes', plan: long },
      { makes_sense: 'yes', plan: 'x', went_well: long },
      { makes_sense: 'yes', plan: 'a\u0000b' },
      { makes_sense: 'yes', plan: 'a\ud800b' },
    ];
    for (const reflection of bads) {
      const t = setup();
      const r = await t.send({ ...ROUTES.reflect, reflection });
      expect(r, JSON.stringify(reflection)).toEqual({ status: 400, body: { ok: false, error: 'bad_request' } });
      expect(t.world.calls).toEqual([]);
    }
  });

  it('counts as the SQL counts: 1,000 characters once spaces are trimmed, emoji as one each', async () => {
    for (const plan of ['a'.repeat(1000), '  ' + 'a'.repeat(1000) + '  ', '😀'.repeat(1000)]) {
      const t = setup();
      const r = await t.send({ ...ROUTES.reflect, reflection: { makes_sense: 'yes', plan } });
      expect(r.body.ok, plan.length).toBe(true);
    }
  });

  it('passes on reflect_off, not_returned and already_answered', async () => {
    const t = setup();
    expect((await t.send({ ...ROUTES.reflect, assessment_id: ESSAY })).body).toEqual({
      ok: false,
      error: 'not_returned',
    });
    t.bc.state.reflect_on = false;
    expect((await t.send(ROUTES.reflect)).body).toEqual({ ok: false, error: 'reflect_off' });
    const u = setup({ answer: { reflect: () => ({ ok: false, error: 'already_answered' }) } });
    expect((await u.send(ROUTES.reflect)).body).toEqual({ ok: false, error: 'already_answered' });
  });
});

describe('reply', () => {
  it('passes the reply on and copies the answer, never an Only Me note', async () => {
    const t = setup();
    const r = await t.send({
      ...ROUTES.reply,
      reply: { sense_now: 'not_sure', follow_up: 'Which paragraph?', plan: null },
    });
    expect(r.body).toEqual({
      ok: true,
      reflection: {
        sense_now: 'not_sure',
        follow_up: 'Which paragraph?',
        plan: null,
        answer: 'Look at the second paragraph.',
        follow_up_answer: null,
      },
    });
    expect(JSON.parse(t.world.calls[0][1][3])).toEqual({
      sense_now: 'not_sure',
      follow_up: 'Which paragraph?',
      plan: null,
    });
  });

  it('Make My Plan goes with yes', async () => {
    const t = setup();
    const r = await t.send({ ...ROUTES.reply, reply: { sense_now: 'yes', plan: 'Use two sources.', follow_up: '' } });
    expect(r.body.reflection.plan).toBe('Use two sources.');
  });

  it('refuses every shape the SQL would raise for, and asks nothing', async () => {
    const bads = [
      undefined,
      {},
      { sense_now: 'maybe' },
      { sense_now: 'yes', follow_up: 'Why?' },
      { sense_now: 'not_sure', plan: 'Read it.' },
      { sense_now: 'yes', extra: 1 },
      { sense_now: 'not_sure', follow_up: 3 },
      { sense_now: 'not_sure', follow_up: 'a'.repeat(1001) },
      { sense_now: 'yes', plan: 'a\u0000' },
    ];
    for (const reply of bads) {
      const t = setup();
      const r = await t.send({ ...ROUTES.reply, reply });
      expect(r, JSON.stringify(reply)).toEqual({ status: 400, body: { ok: false, error: 'bad_request' } });
      expect(t.world.calls).toEqual([]);
    }
  });

  it('passes on not_answered, already_asked and reflect_off', async () => {
    const t = setup();
    expect((await t.send({ ...ROUTES.reply, assessment_id: ESSAY })).body).toEqual({
      ok: false,
      error: 'not_answered',
    });
    t.bc.state.reflect_on = false;
    expect((await t.send(ROUTES.reply)).body).toEqual({ ok: false, error: 'reflect_off' });
    const u = setup({ answer: { reply: () => ({ ok: false, error: 'already_asked' }) } });
    expect((await u.send(ROUTES.reply)).body).toEqual({ ok: false, error: 'already_asked' });
  });
});

describe('answer-seen', () => {
  it('sends the ids as a Postgres array and copies only the count', async () => {
    const t = setup();
    const r = await t.send({ ...ROUTES['answer-seen'], assessment_ids: [LAB, ESSAY.toUpperCase()] });
    expect(r.body).toEqual({ ok: true, seen: 2 });
    expect(t.world.calls[0][1].slice(0, 3)).toEqual([CECE_PHONE, CECE, `{${LAB},${ESSAY}}`]);
  });

  it('an empty list is fine; more than 500, or anything not an id, asks nothing', async () => {
    const t = setup();
    expect((await t.send({ ...ROUTES['answer-seen'], assessment_ids: [] })).body).toEqual({ ok: true, seen: 0 });
    for (const assessment_ids of [undefined, LAB, [LAB, 'x'], [LAB, null], Array(501).fill(LAB), [`${LAB}}`]]) {
      const u = setup();
      expect((await u.send({ ...ROUTES['answer-seen'], assessment_ids })).status).toBe(400);
      expect(u.world.calls).toEqual([]);
    }
  });
});

describe('group-work', () => {
  it("copies counts only: no group-mate's name or id", async () => {
    const t = setup();
    const r = await t.send(ROUTES['group-work']);
    expect(r.body).toEqual({
      ok: true,
      assessments: [
        { id: LAB, members: 2, sent: true, pages: 3, you_sent: false, first_sent_at: '2026-11-10T17:05:00+00:00' },
      ],
    });
    expect(JSON.stringify(r.body)).not.toMatch(/Omar|e2e2e2e2/);
  });
});

describe('revise-start', () => {
  it('makes upload links for the paths the database named, and nothing else is sent', async () => {
    const t = setup();
    t.bc.seedSent(CECE, LAB);
    const r = await t.send({ ...ROUTES['revise-start'], followed_plan: 'yes', path: '../x', course_id: C1 });
    expect(r.status).toBe(200);
    const sub = t.world.subs.get(r.body.submission_id);
    expect(r.body).toEqual({
      ok: true,
      replayed: false,
      submission_id: sub.id,
      state: 'sending',
      version: 2,
      late: false,
      finish_by: '2026-11-11T19:00:00+00:00',
      files: sub.files.map((f, i) => ({
        file_id: f.id,
        page: i + 1,
        upload_url: expect.stringContaining('/object/upload/sign/student-photos/'),
        thumb_upload_url: expect.stringContaining('/object/upload/sign/student-photos/'),
      })),
    });
    expect(
      t.world.storeCalls
        .filter(c => c[0] === 'signUpload')
        .map(c => c[1])
        .sort(),
    ).toEqual(sub.files.flatMap(f => [f.path, f.thumb_path]).sort());
    expect(JSON.stringify(r.body)).not.toContain('.jpg"');
    expect(JSON.stringify(r.body)).not.toContain('card_id');
    // The parameters: session, enrollment, piece, the pages' four sizes only, the note, the request id, the hash.
    const params = t.world.calls.find(c => c[0] === 'revisionStart')[1];
    expect(params.slice(0, 3)).toEqual([CECE_PHONE, CECE, LAB]);
    expect(JSON.parse(params[3])).toEqual(PAGES);
    expect(params[4]).toBe('Fixed it.');
    expect(params[5]).toBe(REQ);
    expect(params).toHaveLength(7);
    expect(JSON.stringify(params)).not.toContain('yes');
    // The removal worker ran after.
    expect(names(t.world)).toEqual(['revisionStart', 'removal_batch']);
  });

  it('refuses a wrong request id, pages or note before asking', async () => {
    const bads = [
      { request_id: undefined },
      { request_id: 'x' },
      { assessment_id: undefined },
      { pages: [] },
      { pages: Array(31).fill({}) },
      { pages: [{ width: 0 }] },
      { pages: [{ width: 20001 }] },
      { pages: [{ bytes: 2097153 }] },
      { pages: ['x'] },
      { note: 'a'.repeat(1001) },
      { note: 'a\u0000' },
      { note: 5 },
    ];
    for (const over of bads) {
      const t = setup();
      const r = await t.send({ ...ROUTES['revise-start'], ...over });
      expect(r, JSON.stringify(over).slice(0, 80)).toEqual({ status: 400, body: { ok: false, error: 'bad_request' } });
      expect(t.world.calls).toEqual([]);
    }
  });

  it('a replay while sending gets fresh links to the same paths; after the finish, none', async () => {
    const t = setup();
    t.bc.seedSent(CECE, LAB);
    const s = await revising(t);
    const again = await t.send(ROUTES['revise-start']);
    expect(again.body.replayed).toBe(true);
    expect(again.body.files.map(f => f.file_id)).toEqual(s.files.map(f => f.file_id));
    await t.send(finishBody(s));
    const after = await t.send(ROUTES['revise-start']);
    expect(after.body).toMatchObject({ ok: true, replayed: true, state: 'sent', version: 2, files: [] });
  });

  it("a first send's request id is not_found, with no link made", async () => {
    const t = setup();
    const first = t.bc.seedSent(CECE, LAB);
    t.world.calls.length = 0;
    const r = await t.send({ ...ROUTES['revise-start'], request_id: first.request_id });
    expect(r.body).toEqual({ ok: false, error: 'not_found' });
    expect(t.world.storeCalls.filter(c => c[0] === 'signUpload')).toEqual([]);
  });

  it('passes on no_revision, grading_started, class_full, and too_many with its wait', async () => {
    const t = setup();
    t.bc.state.requests = {};
    expect((await t.send(ROUTES['revise-start'])).body).toEqual({ ok: false, error: 'no_revision' });
    for (const [answer, body] of [
      [
        { ok: false, error: 'grading_started' },
        { ok: false, error: 'grading_started' },
      ],
      [
        { ok: false, error: 'class_full' },
        { ok: false, error: 'class_full' },
      ],
      [
        { ok: false, error: 'too_many', retry_after_s: 120, card_id: 'x' },
        { ok: false, error: 'too_many', retry_after_s: 120 },
      ],
      [
        { ok: false, error: 'too_many', retry_after_s: 'soon' },
        { ok: false, error: 'too_many' },
      ],
    ]) {
      const u = setup({ answer: { revisionStart: () => answer } });
      expect((await u.send(ROUTES['revise-start'])).body).toEqual(body);
    }
  });

  it("a path that is not this send's, or a bucket not the bucket, is a server error and no link is made", async () => {
    const other = `${C1}/${LAB}/${OMAR}/f8f8f8f8-0000-4000-8000-000000000001/f8f8f8f8-0000-4000-8000-000000000002`;
    for (const tamper of [
      r => (r.files[0].path = other + '.jpg'),
      r => (r.files[0].thumb_path = r.files[0].path),
      r => (r.bucket = 'other-bucket'),
      r => (r.version = '2'),
    ]) {
      const t = setup();
      t.bc.seedSent(CECE, LAB);
      const real = t.bc.fns.revisionStart;
      t.bc.fns.revisionStart = p => {
        const r = real(p);
        tamper(r);
        return r;
      };
      const r = await t.send(ROUTES['revise-start']);
      expect(r).toEqual({ status: 500, body: { ok: false, error: 'server' } });
      expect(t.world.storeCalls.filter(c => c[0] === 'signUpload')).toEqual([]);
    }
  });

  it('with no bucket set up, it is a server error and the database is not asked', async () => {
    const t = setup({ store: null });
    expect((await t.send(ROUTES['revise-start'])).status).toBe(500);
    expect(t.world.calls).toEqual([]);
  });
});

describe('revise-finish', () => {
  it('reads and checks every page, stores what passed, and hands in the hashes of what is stored', async () => {
    const t = setup();
    t.bc.seedSent(CECE, LAB);
    const s = await revising(t);
    t.world.calls.length = 0;
    t.world.storeCalls.length = 0;
    const r = await t.send(finishBody(s, { files: [s.files[1].file_id, s.files[0].file_id] }));
    expect(r.body).toEqual({
      ok: true,
      replayed: false,
      submission_id: s.submission_id,
      version: 2,
      sent_at: '2026-11-11T17:30:00+00:00',
      late: false,
      pages: 2,
    });
    const sub = t.world.subs.get(s.submission_id);
    expect(
      t.world.storeCalls
        .filter(c => c[0] === 'read')
        .map(c => c[1])
        .sort(),
    ).toEqual(sub.files.flatMap(f => [f.path, f.thumb_path]).sort());
    expect(t.world.storeCalls.filter(c => c[0] === 'overwrite')).toHaveLength(4);
    expect(names(t.world)).toEqual(['send_paths', 'revisionFinish', 'removal_batch']);
    const handed = JSON.parse(t.world.calls[1][1][3]);
    expect(handed.map(h => h.file_id)).toEqual([s.files[1].file_id, s.files[0].file_id]);
    handed.forEach(h => {
      const f = sub.files.find(x => x.id === h.file_id);
      expect(h.sha256).toBe(sha(t.world.objects.get(f.path).bytes));
    });
  });

  it('a bad file is bad_file and a missing one missing_pages; revision_finish is not asked', async () => {
    const t = setup();
    t.bc.seedSent(CECE, LAB);
    const s = await revising(t, {}, [
      [new Uint8Array([1, 2, 3]), THUMB_JPEG],
      [PAGE2_JPEG, THUMB2_JPEG],
    ]);
    const r = await t.send(finishBody(s));
    expect(r.body).toEqual({ ok: false, error: 'bad_file', files: [s.files[0].file_id] });
    const u = setup();
    u.bc.seedSent(CECE, LAB);
    const m = await revising(u, {}, [[PAGE_JPEG, THUMB_JPEG]]);
    const r2 = await u.send(finishBody(m));
    expect(r2.body).toEqual({ ok: false, error: 'missing_pages', missing: [m.files[1].file_id] });
    for (const w of [t, u]) expect(names(w.world)).not.toContain('revisionFinish');
  });

  it("a file that is not one of this send's is bad_request, with nothing read", async () => {
    const t = setup();
    t.bc.seedSent(CECE, LAB);
    const s = await revising(t);
    t.world.storeCalls.length = 0;
    const r = await t.send(finishBody(s, { files: [s.files[0].file_id, 'f7f7f7f7-0000-4000-8000-000000000001'] }));
    expect(r.status).toBe(400);
    expect(t.world.storeCalls).toEqual([]);
    expect(names(t.world)).not.toContain('revisionFinish');
  });

  it("a first send's id is not_found, with nothing read: it goes through send-finish", async () => {
    const t = setup();
    const start = await t.send({
      route: 'send-start',
      ...BASE,
      assessment_id: ESSAY,
      request_id: REQ2,
      pages: PAGES.slice(0, 1),
    });
    t.world.storeCalls.length = 0;
    const r = await t.send(finishBody(start.body));
    expect(r.body).toEqual({ ok: false, error: 'not_found' });
    expect(t.world.storeCalls.filter(c => c[0] === 'read')).toEqual([]);
    expect(names(t.world)).not.toContain('revisionFinish');
  });

  it('the same finish again is answered replayed, with its version, and nothing read', async () => {
    const t = setup();
    t.bc.seedSent(CECE, LAB);
    const s = await revising(t);
    const first = await t.send(finishBody(s));
    t.world.storeCalls.length = 0;
    t.world.calls.length = 0;
    const again = await t.send(finishBody(s));
    expect(again.body).toEqual({ ...first.body, replayed: true });
    expect(names(t.world)).toEqual(['send_paths', 'work', 'file_links']);
    expect(t.world.storeCalls).toEqual([]);
  });

  it("another student's revision, or a first version handed in, is not_found with nothing read", async () => {
    const t = setup();
    const v1 = t.bc.seedSent(CECE, LAB);
    t.bc.seedSent(OMAR, LAB);
    const s = await revising(t);
    await t.send(finishBody(s));
    t.world.storeCalls.length = 0;
    // Omar sends Cece's revision id; Cece sends her first version's id.
    expect((await t.send({ ...finishBody(s), session: OMAR_PHONE, enrollment_id: OMAR })).body).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(
      (await t.send(finishBody({ submission_id: v1.id, files: v1.files.map(f => ({ file_id: f.id })) }))).body,
    ).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(t.world.storeCalls).toEqual([]);
  });

  it("passes on request_changed, and send_paths' expired", async () => {
    const t = setup();
    t.bc.seedSent(CECE, LAB);
    const s = await revising(t);
    t.bc.state.requests[`${CECE}/${LAB}`].changed = true;
    expect((await t.send(finishBody(s))).body).toEqual({ ok: false, error: 'request_changed' });
    const u = setup();
    u.bc.seedSent(CECE, LAB);
    const e = await revising(u);
    u.world.subs.get(e.submission_id).expired = true;
    expect((await u.send(finishBody(e))).body).toEqual({ ok: false, error: 'expired' });
  });
});

describe('revise-unsend', () => {
  it('takes the revision back, passes on the counts, and runs the worker', async () => {
    const t = setup();
    t.bc.seedSent(CECE, LAB);
    const s = await revising(t);
    await t.send(finishBody(s));
    t.world.calls.length = 0;
    const r = await t.send(ROUTES['revise-unsend']);
    expect(r.body).toEqual({ ok: true, unsent: true, cancelled: false, pages: 2 });
    expect(names(t.world)).toEqual(['revisionUnsend', 'removal_batch', 'removal_done']);
    expect(t.world.storeCalls.filter(c => c[0] === 'remove').flatMap(c => c[1])).toHaveLength(4);
  });

  it('passes on grading_started and cannot_change', async () => {
    for (const error of ['grading_started', 'cannot_change']) {
      const t = setup({ answer: { revisionUnsend: () => ({ ok: false, error, pages: 2 }) } });
      expect((await t.send(ROUTES['revise-unsend'])).body).toEqual({ ok: false, error });
    }
  });
});

describe('group-links', () => {
  it("makes 300-second links for the group's pages, says which are mine, and sends no path or id of a student", async () => {
    const t = setup();
    const mine = t.bc.seedSent(CECE, LAB);
    const theirs = t.bc.seedSent(OMAR, LAB, 1, 2);
    const r = await t.send(ROUTES['group-links']);
    expect(r.body.ok).toBe(true);
    expect(r.body.files.map(f => [f.file_id, f.mine])).toEqual([
      [mine.files[0].id, true],
      [theirs.files[0].id, false],
      [theirs.files[1].id, false],
    ]);
    expect(Object.keys(r.body.files[0]).sort()).toEqual(
      ['file_id', 'submission_id', 'version', 'page', 'width', 'height', 'rotation', 'mine', 'url', 'thumb_url'].sort(),
    );
    const signed = t.world.storeCalls.filter(c => c[0] === 'signDownloads');
    expect(signed).toHaveLength(1);
    expect(signed[0][2]).toBe(300);
    expect(JSON.stringify(r.body)).not.toContain('enrollment_id');
    expect(JSON.stringify(r.body)).not.toContain('"path"');
  });

  it('a piece with no pages is an empty list and no link is asked for', async () => {
    const t = setup();
    expect((await t.send(ROUTES['group-links'])).body).toEqual({ ok: true, files: [] });
    expect(t.world.storeCalls).toEqual([]);
  });

  it('a path that is not as the database must name it is a server error, and no link is made', async () => {
    const tampers = [
      (r, e) => (r.files[0].mine = !r.files[0].mine), // mine, but another student's folder (or the reverse)
      r => (r.files[0].mine = 'true'),
      r => (r.files[0].path = r.files[0].path.replace(LAB, ESSAY)), // another piece
      r => (r.files[1].path = r.files[1].path.replace(C1, 'c3c3c3c3-0000-4000-8000-000000000003')), // another class
      r => (r.files[0].thumb_path = r.files[1].thumb_path), // another file's thumbnail
      r => (r.files[0].path = r.files[0].thumb_path),
      r => (r.files[1].file_id = r.files[0].file_id),
      r => (r.bucket = 'other'),
      r => (r.files[0].path = '../' + r.files[0].path),
    ];
    for (const tamper of tampers) {
      const t = setup();
      t.bc.seedSent(CECE, LAB);
      t.bc.seedSent(OMAR, LAB);
      const real = t.bc.fns.groupFileLinks;
      t.bc.fns.groupFileLinks = p => {
        const r = real(p);
        tamper(r);
        return r;
      };
      const r = await t.send(ROUTES['group-links']);
      expect(r, tamper.toString()).toEqual({ status: 500, body: { ok: false, error: 'server' } });
      expect(t.world.storeCalls.filter(c => c[0] === 'signDownloads')).toEqual([]);
    }
  });

  it('more than 30 pages for one send is a server error', async () => {
    const t = setup();
    t.bc.seedSent(OMAR, LAB, 1, 31);
    expect((await t.send(ROUTES['group-links'])).status).toBe(500);
    expect(t.world.storeCalls.filter(c => c[0] === 'signDownloads')).toEqual([]);
  });
});

describe('the logs', () => {
  it('a whole run of every route logs no token, id, path, link, hash, byte or word a student wrote', async () => {
    const t = setup();
    t.bc.seedSent(CECE, LAB);
    t.bc.seedSent(OMAR, LAB);
    for (const route of ['feedback', 'markup', 'reflect', 'reply', 'answer-seen', 'group-work', 'group-links']) {
      await t.send(ROUTES[route]);
    }
    const s = await revising(t);
    await t.send(finishBody(s));
    await t.send(finishBody(s));
    await t.send(ROUTES['revise-unsend']);
    await t.send({ ...ROUTES.reflect, session: ENDED });
    const text = JSON.stringify(t.logs);
    for (const v of [
      CECE_PHONE,
      CECE,
      OMAR,
      LAB,
      C1,
      REQ,
      s.submission_id,
      'student-photos',
      'https://',
      'token=',
      '.jpg',
      'Read it twice',
      'Fixed it',
    ]) {
      expect(text, v).not.toContain(v);
    }
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
    expect(text).not.toMatch(/[0-9a-f]{64}/);
    for (const line of t.logs) {
      expect(
        Object.keys(line).every(k =>
          [
            'route',
            'outcome',
            'ms',
            'worker',
            'removed',
            'skipped',
            'left',
            'kind',
            'stripped',
            'refused',
            'reasons',
          ].includes(k),
        ),
      ).toBe(true);
    }
  });
});
