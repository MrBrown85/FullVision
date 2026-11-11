/**
 * The routes a student sends work through, on the student-submit edge
 * function (supabase/functions/student-submit/send-routes.ts, S5-F4): work,
 * send-start, replace, send-finish, unsend, file-links, and the teacher's
 * sweep. Run through the whole handler with a stand-in database and a
 * stand-in bucket (tests/helpers/fake-send-world.js).
 *
 * The rules of sending live in SQL (Batch B, not applied when this was
 * written; its contract is migrations/local-test/batch-b-contract.md on the
 * batch-b branches). This checks what the function adds, the duties the
 * contract leaves to it:
 *   1  every file is read and checked before it is handed in, with the hash
 *      of what is stored, and location data cut out first;
 *   3  upload links only for the paths the database named in this request;
 *   4  download links of 300 seconds, only for paths file_links named;
 *   5  the removal worker after each route that can queue a file, and sweep;
 *   6  the Canada check before anything;
 *   7  no path from the request body, ever;
 *   8  links, not paths, to the phone;
 *   9  22023 is a plain server error, and the function never sends a shape
 *      that raises it;
 *  10  each page's sizes passed on.
 * And what every route of this function keeps: the session checked first,
 * a reply copied field by field, and logs that hold nothing about a
 * student.
 *
 * The JPEG check itself is in tests/student-submit-jpeg-check.test.js; the
 * Storage and Auth adapters in tests/student-submit-storage-rest.test.js.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { makeHandler } from '../supabase/functions/student-submit/handler.ts';
import {
  C1,
  C2,
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
  STATEMENTS,
  TEACHER_A,
  TEACHER_TOKEN,
  THUMB2_JPEG,
  THUMB_JPEG,
  fakeWorld,
} from './helpers/fake-send-world.js';

const URL_ = 'https://x.supabase.co/functions/v1/student-submit?forceFunctionRegion=ca-central-1';
const REQ = '0f0f0f0f-0000-4000-8000-000000000001';
const REQ2 = '0f0f0f0f-0000-4000-8000-000000000002';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

function setup(extra = {}) {
  const world = fakeWorld();
  const logs = [];
  const asked = [];
  const handle = makeHandler({
    region: 'ca-central-1',
    ipKey: 'test-key',
    db: {
      // The slip routes are never asked by these routes.
      open: async () => (asked.push('open'), { ok: false }),
      verify: async () => (asked.push('verify'), { ok: false }),
      check: async () => (asked.push('check'), { ok: false }),
      submit: async () => (asked.push('submit'), { ok: false }),
      call: world.db.call,
    },
    store: 'store' in extra ? extra.store : world.store,
    whoIs:
      'whoIs' in extra
        ? extra.whoIs
        : async token => {
            world.calls.push(['auth', [token === TEACHER_TOKEN ? 'teacher' : 'other']]);
            return token === TEACHER_TOKEN ? TEACHER_A : null;
          },
    log: entry => logs.push(entry),
    defer: extra.defer,
  });
  const send = async (body, headers) => {
    const res = await handle(
      new Request(URL_, {
        method: 'POST',
        headers: Object.assign(
          { 'content-type': 'application/json', origin: 'https://fullvision.ca', 'cf-connecting-ip': '203.0.113.7' },
          headers,
        ),
        body: JSON.stringify(body),
      }),
    );
    return { status: res.status, body: await res.json() };
  };
  return { world, logs, asked, handle, send };
}

const names = world => world.calls.map(c => c[0]);
const PAGES = [
  { width: 900, height: 1200, bytes: PAGE_JPEG.length, thumb_bytes: THUMB_JPEG.length },
  { width: 900, height: 1200, bytes: PAGE2_JPEG.length, thumb_bytes: THUMB2_JPEG.length },
];
const startBody = (over = {}) => ({
  route: 'send-start',
  session: CECE_PHONE,
  enrollment_id: CECE,
  assessment_id: LAB,
  request_id: REQ,
  pages: PAGES,
  note: 'I was away Thursday.',
  followed_plan: null,
  ...over,
});

/* Cece starts a send of two pages and her phone uploads every file. */
async function started(
  t,
  over = {},
  files = [
    [PAGE_JPEG, THUMB_JPEG],
    [PAGE2_JPEG, THUMB2_JPEG],
  ],
) {
  const r = await t.send(startBody(over));
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
  ...startBody(),
  route: 'send-finish',
  submission_id: s.submission_id,
  files: s.files.map(f => f.file_id),
  ...over,
});

// The hashed address the handler makes for 203.0.113.7 with 'test-key'.
async function addressHash() {
  const t = setup();
  await t.send({ route: 'work', session: CECE_PHONE, enrollment_id: CECE });
  return t.world.calls[0][1][2];
}

describe('every route: Canada first, then the session, then the database', () => {
  const ROUTES = {
    work: { route: 'work', session: CECE_PHONE, enrollment_id: CECE },
    'send-start': startBody(),
    replace: startBody({ route: 'replace' }),
    'send-finish': { ...startBody(), route: 'send-finish', submission_id: REQ2, files: [REQ2] },
    unsend: { route: 'unsend', session: CECE_PHONE, enrollment_id: CECE, assessment_id: LAB },
    'file-links': { route: 'file-links', session: CECE_PHONE, enrollment_id: CECE, assessment_id: LAB },
    sweep: { route: 'sweep', access_token: TEACHER_TOKEN },
  };

  it.each(Object.keys(ROUTES))('%s outside ca-central-1 is refused before the body is read', async route => {
    const world = fakeWorld();
    const handle = makeHandler({ region: 'us-east-1', ipKey: 'k', db: world.db, store: world.store, log: () => {} });
    const res = await handle(
      new Request(URL_, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://fullvision.ca' },
        body: JSON.stringify(ROUTES[route]),
      }),
    );
    expect(res.status).toBe(421);
    expect(await res.json()).toEqual({ ok: false, error: 'wrong_region' });
    expect(world.calls).toEqual([]);
    expect(world.storeCalls).toEqual([]);
  });

  it.each(Object.keys(ROUTES).filter(r => r !== 'sweep'))(
    '%s: no session, or one of the wrong shape, asks nothing',
    async route => {
      for (const session of [undefined, null, '', 12, 'a'.repeat(129), ['s']]) {
        const t = setup();
        const r = await t.send({ ...ROUTES[route], session });
        expect(r, String(session)).toEqual({ status: 400, body: { ok: false, error: 'bad_request' } });
        expect(t.world.calls).toEqual([]);
        expect(t.world.storeCalls).toEqual([]);
      }
    },
  );

  it.each(Object.keys(ROUTES).filter(r => r !== 'sweep'))(
    '%s: an enrollment that is not an id asks nothing',
    async route => {
      for (const enrollment_id of [undefined, 'cece', 1, CECE + 'x', `${CECE}' or 1=1`]) {
        const t = setup();
        const r = await t.send({ ...ROUTES[route], enrollment_id });
        expect(r.status).toBe(400);
        expect(t.world.calls).toEqual([]);
      }
    },
  );

  it.each(Object.keys(ROUTES).filter(r => r !== 'sweep'))(
    '%s: a session that ended is signed_out, and nothing is read or signed',
    async route => {
      const t = setup();
      const r = await t.send({ ...ROUTES[route], session: ENDED });
      expect(r).toEqual({ status: 200, body: { ok: false, error: 'signed_out' } });
      expect(t.world.storeCalls.filter(c => c[0] !== 'remove')).toEqual([]);
    },
  );

  it('the session token and the enrollment are the first two parameters of every student statement, the hashed address the last', async () => {
    const hash = await addressHash();
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    const t = setup();
    const s = await started(t);
    await t.send(finishBody(s));
    await t.send({ route: 'file-links', session: CECE_PHONE, enrollment_id: CECE, assessment_id: LAB });
    await t.send({ route: 'unsend', session: CECE_PHONE, enrollment_id: CECE, assessment_id: LAB });
    const student = t.world.calls.filter(c => !c[0].startsWith('removal_'));
    expect(new Set(student.map(c => c[0]))).toEqual(
      new Set(['send_start', 'send_paths', 'send_finish', 'file_links', 'unsend']),
    );
    for (const [, params] of student) {
      expect(params[0]).toBe(CECE_PHONE);
      expect(params[1]).toBe(CECE);
      expect(params[params.length - 1]).toBe(hash);
    }
  });

  it('none of these routes reaches a slip function or a card statement', async () => {
    const t = setup();
    for (const body of Object.values(ROUTES)) await t.send(body);
    expect(t.asked).toEqual([]);
    expect(t.world.calls.every(c => Object.keys(STATEMENTS).includes(c[0]) || c[0] === 'auth')).toBe(true);
  });

  it('without the bucket, send-start, send-finish and file-links answer a server error and ask nothing', async () => {
    for (const route of ['send-start', 'send-finish', 'file-links']) {
      const t = setup({ store: null });
      const r = await t.send(ROUTES[route]);
      expect(r, route).toEqual({ status: 500, body: { ok: false, error: 'server' } });
      expect(t.world.calls).toEqual([]);
    }
    // work and unsend need no link: they carry on (the worker waits for the bucket).
    const t = setup({ store: null });
    expect((await t.send(ROUTES.work)).body.ok).toBe(true);
    expect((await t.send(ROUTES.unsend)).body.ok).toBe(true);
    expect(names(t.world)).toEqual(['work', 'unsend']);
  });
});

describe('work', () => {
  it('copies what the page shows about sending, field by field', async () => {
    const t = setup();
    t.world.override.work = () => ({
      ok: true,
      v: 1,
      send_work: true,
      draft_level: 3,
      assessments: [
        {
          id: LAB,
          students_send: 'photos',
          open: true,
          closes_on: '2026-11-13',
          late_now: false,
          path: `${C1}/${LAB}/${CECE}/x/y.jpg`,
          sent: {
            submission_id: REQ2,
            sent_at: '2026-11-05T17:41:09+00:00',
            sent_by: 'student',
            on_paper: false,
            is_late: false,
            note: 'I was away Thursday.',
            pages: 2,
            grading: false,
            can_change: true,
            files: [{ path: 'x' }],
          },
          sending: null,
        },
      ],
    });
    const r = await t.send({ route: 'work', session: CECE_PHONE, enrollment_id: CECE });
    expect(r.body).toEqual({
      ok: true,
      v: 1,
      send_work: true,
      assessments: [
        {
          id: LAB,
          students_send: 'photos',
          open: true,
          closes_on: '2026-11-13',
          late_now: false,
          sent: {
            submission_id: REQ2,
            sent_at: '2026-11-05T17:41:09+00:00',
            sent_by: 'student',
            on_paper: false,
            is_late: false,
            note: 'I was away Thursday.',
            pages: 2,
            grading: false,
            can_change: true,
          },
          sending: null,
        },
      ],
    });
  });

  it('a plain field is copied only as text, a number, true or false: an object or a list in its place is null', async () => {
    const t = setup();
    t.world.override.work = () => ({
      ok: true,
      v: { html: '<b>' },
      send_work: ['yes'],
      assessments: [
        {
          id: LAB,
          students_send: { x: 1 },
          open: true,
          closes_on: null,
          late_now: NaN,
          sent: null,
          sending: { submission_id: REQ2, intent: 'new', started_at: 'a', finish_by: 'b', pages: [1, 2] },
        },
      ],
    });
    const r = await t.send({ route: 'work', session: CECE_PHONE, enrollment_id: CECE });
    expect(r.body).toEqual({
      ok: true,
      v: null,
      send_work: null,
      assessments: [
        {
          id: LAB,
          students_send: null,
          open: true,
          closes_on: null,
          late_now: null,
          sent: null,
          sending: { submission_id: REQ2, intent: 'new', started_at: 'a', finish_by: 'b', pages: null },
        },
      ],
    });
  });

  it('another student’s class, through this session, is the database’s not_found', async () => {
    const t = setup();
    const r = await t.send({ route: 'work', session: CECE_PHONE, enrollment_id: OMAR });
    expect(r.body).toEqual({ ok: false, error: 'not_found' });
    expect(t.world.calls).toEqual([['work', [CECE_PHONE, OMAR, expect.any(String)]]]);
  });
});

describe('send-start and replace', () => {
  it('asks send_start with the checked request, and gives a link for each path the database named', async () => {
    const t = setup();
    const r = await t.send(
      startBody({ path: 'C/A/E/S/F.jpg', paths: ['x'], course_id: C2, bucket: 'public', teacher_id: TEACHER_A }),
    );
    expect(r.status).toBe(200);
    const [name, params] = t.world.calls[0];
    expect(name).toBe('send_start');
    // The phone's extra fields go nowhere: only these eight parameters, each from the checked body.
    expect(params).toEqual([
      CECE_PHONE,
      CECE,
      LAB,
      JSON.stringify(PAGES),
      'I was away Thursday.',
      null,
      REQ,
      expect.stringMatching(/^[0-9a-f]{64}$/),
    ]);
    const sub = t.world.subs.get(r.body.submission_id);
    const dbPaths = sub.files.flatMap(f => [f.path, f.thumb_path]);
    expect(
      t.world.storeCalls
        .filter(c => c[0] === 'signUpload')
        .map(c => c[1])
        .sort(),
    ).toEqual(dbPaths.sort());
    expect(r.body).toEqual({
      ok: true,
      replayed: false,
      submission_id: sub.id,
      state: 'sending',
      late: false,
      finish_by: '2026-11-11T19:00:00+00:00',
      files: sub.files.map((f, i) => ({
        file_id: f.id,
        page: i + 1,
        upload_url: expect.stringContaining(f.path + '?token='),
        thumb_upload_url: expect.stringContaining(f.thumb_path + '?token='),
      })),
    });
    // Links, not paths: no path or bucket field in the reply.
    expect(JSON.stringify(Object.keys(r.body.files[0]))).not.toMatch(/path|bucket/);
  });

  it('a page is copied with its four sizes and nothing else; a wrong page never reaches the database', async () => {
    const t = setup();
    await t.send(
      startBody({
        pages: [{ width: 900, height: 1200, bytes: 4, thumb_bytes: 5, sha256: 'f'.repeat(64), path: 'x' }, {}],
      }),
    );
    expect(t.world.calls[0][1][3]).toBe('[{"width":900,"height":1200,"bytes":4,"thumb_bytes":5},{}]');
    const wrong = [
      [],
      Array(31).fill({}),
      'pages',
      [null],
      [[]],
      [{ width: 0 }],
      [{ height: 20001 }],
      [{ bytes: 2097153 }],
      [{ thumb_bytes: 1.5 }],
      [{ width: '900' }],
      [{ bytes: -1 }],
      [{ width: Number.MAX_SAFE_INTEGER + 2 }],
    ];
    for (const pages of wrong) {
      const u = setup();
      expect((await u.send(startBody({ pages }))).status, JSON.stringify(pages)).toBe(400);
      expect(u.world.calls).toEqual([]);
    }
  });

  it('the note, the plan, the piece and the request id are checked before the database is asked', async () => {
    for (const over of [
      { note: 'x'.repeat(1001) },
      { note: 'a\u0000b' },
      { note: 5 },
      { followed_plan: 'maybe' },
      { assessment_id: 'lab' },
      { assessment_id: undefined },
      { request_id: undefined },
      { request_id: 'again' },
    ]) {
      const t = setup();
      expect((await t.send(startBody(over))).status, JSON.stringify(over)).toBe(400);
      expect(t.world.calls).toEqual([]);
    }
    // 1,000 characters as Postgres counts them: an emoji is one.
    const t = setup();
    expect((await t.send(startBody({ note: '😀'.repeat(1000) }))).body.ok).toBe(true);
    // An empty note and plan go as nothing.
    const u = setup();
    await u.send(startBody({ note: '', followed_plan: '' }));
    expect(u.world.calls[0][1].slice(4, 6)).toEqual([null, null]);
  });

  it('a link writes its own path, once, and only a JPEG of 2 MB or less (the bucket’s limits)', async () => {
    const t = setup();
    const s = await started(t, {}, []);
    const f = s.files[0];
    expect(t.world.phoneUpload(f.upload_url, new Uint8Array(2097153))).toBe(413);
    expect(t.world.phoneUpload(f.upload_url, PAGE_JPEG, 'image/png')).toBe(415);
    expect(t.world.phoneUpload(f.upload_url, PAGE_JPEG)).toBe(200);
    expect(t.world.phoneUpload(f.upload_url, PAGE2_JPEG)).toBe(409);
    expect(t.world.objects.get(t.world.subs.get(s.submission_id).files[0].path).bytes).toBe(PAGE_JPEG);
  });

  it('the same request again: the same send and paths, new links, nothing new made', async () => {
    const t = setup();
    const first = await started(t, {}, []);
    const again = await t.send(startBody());
    expect(again.body.replayed).toBe(true);
    expect(again.body.submission_id).toBe(first.submission_id);
    expect(again.body.files.map(f => f.file_id)).toEqual(first.files.map(f => f.file_id));
    expect(again.body.finish_by).toBe(first.finish_by);
    expect(t.world.subs.size).toBe(1);
  });

  it('a replay after the work was handed in gives no link', async () => {
    const t = setup();
    const s = await started(t);
    await t.send(finishBody(s));
    const before = t.world.storeCalls.filter(c => c[0] === 'signUpload').length;
    const r = await t.send(startBody());
    expect(r.body).toMatchObject({ ok: true, replayed: true, state: 'sent', files: [] });
    expect(t.world.storeCalls.filter(c => c[0] === 'signUpload').length).toBe(before);
  });

  it('replace asks replace, and the database decides it is a replace', async () => {
    const t = setup();
    const s = await started(t);
    await t.send(finishBody(s));
    const r = await t.send(startBody({ route: 'replace', request_id: REQ2 }));
    expect(r.body.ok).toBe(true);
    expect(names(t.world)).toContain('replace');
    expect(t.world.subs.get(r.body.submission_id).intent).toBe('replace');
  });

  describe('a path the database names is checked before any link is made', () => {
    const cases = {
      'another student': p => p.replace(`/${CECE}/`, `/${OMAR}/`),
      'another piece': p => p.replace(`/${LAB}/`, `/${ESSAY}/`),
      'another send': p => p.replace(/\/([0-9a-f-]{36})\/([0-9a-f-]{36})(-thumb)?\.jpg$/, `/${REQ2}/$2$3.jpg`),
      'another file': p => p.replace(/\/([0-9a-f-]{36})(-thumb)?\.jpg$/, `/${REQ2}$2.jpg`),
      'a climb out of the folder': p => p.replace(`${C1}/`, `${C1}/../`),
      'another layout': p => p.replace('.jpg', '.png'),
      'upper case': p => p.toUpperCase(),
      'a query': p => p + '?x=1',
    };
    it.each(Object.keys(cases))('%s: no link at all, and a plain server error', async which => {
      const t = setup();
      t.world.override.send_start = (params, fns) => {
        const r = JSON.parse(JSON.stringify(fns.send_start(params)));
        r.files[1].thumb_path = cases[which](r.files[1].thumb_path);
        return r;
      };
      const r = await t.send(startBody());
      expect(r).toEqual({ status: 500, body: { ok: false, error: 'server' } });
      expect(t.world.storeCalls.filter(c => c[0] === 'signUpload')).toEqual([]);
    });

    it('a thumbnail in another class’s folder, or a page named as a thumbnail, is refused', async () => {
      for (const change of [
        f => (f.thumb_path = f.thumb_path.replace(C1, C2)),
        f => (f.path = f.thumb_path),
        f => (f.thumb_path = f.path),
      ]) {
        const t = setup();
        t.world.override.send_start = (params, fns) => {
          const r = JSON.parse(JSON.stringify(fns.send_start(params)));
          change(r.files[0]);
          return r;
        };
        expect((await t.send(startBody())).status).toBe(500);
        expect(t.world.storeCalls.filter(c => c[0] === 'signUpload')).toEqual([]);
      }
    });

    it('a page number that is not 1 to 30 is refused', async () => {
      for (const page of [0, 31, '1', null]) {
        const t = setup();
        t.world.override.send_start = (params, fns) => {
          const r = JSON.parse(JSON.stringify(fns.send_start(params)));
          r.files[1].page = page;
          return r;
        };
        expect((await t.send(startBody())).status, String(page)).toBe(500);
        expect(t.world.storeCalls.filter(c => c[0] === 'signUpload')).toEqual([]);
      }
    });

    it('another bucket is refused', async () => {
      const t = setup();
      t.world.override.send_start = (params, fns) => ({ ...fns.send_start(params), bucket: 'public-bucket' });
      expect((await t.send(startBody())).status).toBe(500);
      expect(t.world.storeCalls).toEqual([]);
    });
  });

  describe('every refusal the contract lists reaches the phone as it is, with its one extra field', () => {
    const START = {
      send_off: {},
      not_found: {},
      not_taking_work: {},
      expired: {},
      work_closed: { closed_on: '2026-11-13' },
      already_sent: {},
      too_many: { retry_after_s: 1200 },
      class_full: {},
      signed_out: {},
      card_stopped: {},
      card_expired: {},
      closed: {},
      card_locked: {},
    };
    const REPLACE = {
      ...START,
      nothing_sent: {},
      cannot_change: {},
      grading_started: {},
      too_many_pages: { room: 4 },
    };
    delete REPLACE.already_sent;
    for (const [route, list] of [
      ['send-start', START],
      ['replace', REPLACE],
    ]) {
      it.each(Object.keys(list))(`${route}: %s`, async error => {
        const t = setup();
        const fn = route === 'replace' ? 'replace' : 'send_start';
        t.world.override[fn] = () => ({
          ok: false,
          error,
          ...list[error],
          path: 'x',
          submission_id: REQ2,
          max_pages: 9,
        });
        const r = await t.send(startBody({ route }));
        expect(r).toEqual({ status: 200, body: { ok: false, error, ...list[error] } });
        expect(t.world.storeCalls.filter(c => c[0] === 'signUpload')).toEqual([]);
      });
    }
    it('a code the route does not list is not_found; an extra field of the wrong type is left out', async () => {
      const t = setup();
      t.world.override.send_start = () => ({ ok: false, error: 'nothing_sent' });
      expect((await t.send(startBody())).body).toEqual({ ok: false, error: 'not_found' });
      t.world.override.send_start = () => ({ ok: false, error: 'too_many', retry_after_s: 'soon' });
      expect((await t.send(startBody())).body).toEqual({ ok: false, error: 'too_many' });
      t.world.override.send_start = () => ({ ok: false, error: 'work_closed', closed_on: { day: 1 } });
      expect((await t.send(startBody())).body).toEqual({ ok: false, error: 'work_closed', closed_on: null });
    });
  });
});

describe('send-finish', () => {
  it('reads every page and thumbnail, hands in the hashes of what is stored, and copies the answer', async () => {
    const t = setup();
    const s = await started(t);
    const r = await t.send(finishBody(s));
    expect(r.body).toEqual({
      ok: true,
      replayed: false,
      submission_id: s.submission_id,
      sent_at: '2026-11-11T17:30:00+00:00',
      late: false,
      pages: 2,
    });
    const sub = t.world.subs.get(s.submission_id);
    // Read: each page and each thumbnail, at most 2,000,000 bytes, and nothing else.
    const reads = t.world.storeCalls.filter(c => c[0] === 'read');
    expect(reads.map(c => c[1]).sort()).toEqual(sub.files.flatMap(f => [f.path, f.thumb_path]).sort());
    expect(reads.every(c => c[2] === 2_000_000)).toBe(true);
    // The order: the start, then at the finish send_paths and send_finish (then the worker).
    expect(names(t.world).filter(n => !n.startsWith('removal_'))).toEqual(['send_start', 'send_paths', 'send_finish']);
    const [, params] = t.world.calls.find(c => c[0] === 'send_finish');
    expect(params.slice(0, 3)).toEqual([CECE_PHONE, CECE, s.submission_id]);
    // The hashes are of the files as stored: the pages had nothing to cut, so the bytes the phone sent.
    expect(JSON.parse(params[3])).toEqual([
      { file_id: s.files[0].file_id, sha256: sha(PAGE_JPEG) },
      { file_id: s.files[1].file_id, sha256: sha(PAGE2_JPEG) },
    ]);
  });

  describe('the paths come from send_paths, read-only: the start is never sent again (review M1)', () => {
    const sendsOf = t => [...t.world.subs.values()].filter(x => x.state === 'sending');

    it('asks send_paths with the session, the enrollment, the send and the hashed address, then send_finish', async () => {
      const hash = await addressHash();
      const t = setup();
      const s = await started(t);
      const before = t.world.calls.length;
      expect((await t.send(finishBody(s))).body.ok).toBe(true);
      const mine = t.world.calls.slice(before).filter(c => !c[0].startsWith('removal_'));
      expect(mine.map(c => c[0])).toEqual(['send_paths', 'send_finish']);
      expect(mine[0][1]).toEqual([CECE_PHONE, CECE, s.submission_id, hash]);
    });

    it('a wrong request id at the finish is not read: the open send is kept, nothing is started, it is handed in', async () => {
      const t = setup();
      const s = await started(t);
      const r = await t.send(finishBody(s, { request_id: REQ2, pages: 'anything', assessment_id: ESSAY }));
      expect(r.body).toMatchObject({ ok: true, submission_id: s.submission_id, pages: 2 });
      expect(t.world.calls.filter(c => c[0] === 'send_start' || c[0] === 'replace').length).toBe(1);
      expect([...t.world.subs.values()].filter(x => x.request_id === REQ2)).toEqual([]);
      expect(t.world.queue).toEqual([]);
    });

    it('an Unsend from another tab while the finish is under way never brings the send back', async () => {
      const t = setup();
      const s = await started(t);
      // The other tab's Unsend lands right after the finish's first question to the database, whichever it is.
      for (const name of ['work', 'send_paths']) {
        t.world.override[name] = (params, fns) => {
          const r = JSON.parse(JSON.stringify(fns[name](params)));
          t.world.override.work = t.world.override.send_paths = null;
          fns.unsend([CECE_PHONE, CECE, LAB]);
          return r;
        };
      }
      const r = await t.send(finishBody(s));
      expect(r.body).toEqual({ ok: false, error: 'not_found' });
      expect(sendsOf(t)).toEqual([]);
      expect(t.world.calls.filter(c => c[0] === 'send_start').length).toBe(1);
    });

    it('a stale send (a newer start took its place), an unsent one, another student’s or another class’s: not_found, nothing read, signed or made', async () => {
      const t = setup();
      const omar = await t.send({ ...startBody(), session: OMAR_PHONE, enrollment_id: OMAR, request_id: REQ2 });
      const liam = await t.send({
        ...startBody(),
        session: LIAM_PHONE,
        enrollment_id: LIAM,
        assessment_id: MAP,
        request_id: REQ2,
      });
      const old = await started(t);
      const newer = await started(t, { request_id: REQ2 });
      await t.send({ ...startBody({ assessment_id: ESSAY, request_id: REQ }) });
      const essay = [...t.world.subs.values()].find(x => x.assessment === ESSAY);
      await t.send({ route: 'unsend', session: CECE_PHONE, enrollment_id: CECE, assessment_id: ESSAY });
      const UNKNOWN = '0e0e0e0e-0000-4000-8000-000000000009';
      for (const id of [old.submission_id, essay.id, omar.body.submission_id, liam.body.submission_id, UNKNOWN]) {
        const subs = JSON.stringify([...t.world.subs.values()]);
        const before = t.world.calls.length;
        const storeBefore = t.world.storeCalls.length;
        const r = await t.send(finishBody(newer, { submission_id: id }));
        expect(r.body, id).toEqual({ ok: false, error: 'not_found' });
        expect(t.world.calls.slice(before).map(c => c[0])).toEqual(['send_paths', 'work']);
        expect(t.world.storeCalls.slice(storeBefore)).toEqual([]);
        expect(JSON.stringify([...t.world.subs.values()])).toBe(subs);
      }
    });

    it('until send_paths is on the database: a plain server error, and nothing read, started or handed in', async () => {
      const t = setup();
      const s = await started(t);
      t.world.override.send_paths = () => {
        const e = new Error('function student_submit.send_paths does not exist');
        e.name = 'PostgresError';
        e.code = '42883';
        throw e;
      };
      const before = t.world.calls.length;
      const storeBefore = t.world.storeCalls.length;
      const r = await t.send(finishBody(s));
      expect(r).toEqual({ status: 500, body: { ok: false, error: 'server' } });
      expect(t.world.calls.slice(before).map(c => c[0])).toEqual(['send_paths']);
      expect(t.world.storeCalls.slice(storeBefore)).toEqual([]);
      expect(t.world.subs.get(s.submission_id).state).toBe('sending');
    });

    it('a send_paths answer that is not this send’s: a server error, nothing read', async () => {
      const OTHER = '0e0e0e0e-0000-4000-8000-000000000009';
      for (const change of [
        r => ({ ...r, submission_id: OTHER }),
        r => ({ ...r, assessment_id: ESSAY }),
        r => ({ ...r, assessment_id: 'lab' }),
        r => ({ ...r, bucket: 'other' }),
        r => ({ ...r, files: r.files.map(f => ({ ...f, path: f.path.replace(LAB, ESSAY) })) }),
        r => ({ ...r, files: r.files.map(f => ({ ...f, thumb_path: f.thumb_path.replace(CECE, OMAR) })) }),
      ]) {
        const t = setup();
        const s = await started(t);
        t.world.override.send_paths = (params, fns) => change(fns.send_paths(params));
        const r = await t.send(finishBody(s));
        expect(r.status).toBe(500);
        expect(t.world.storeCalls.filter(c => c[0] === 'read')).toEqual([]);
        expect(names(t.world)).not.toContain('send_finish');
      }
    });

    it.each(['card_locked', 'closed', 'signed_out', 'card_stopped', 'card_expired'])(
      'send_paths answers %s: passed on, nothing read',
      async error => {
        const t = setup();
        const s = await started(t);
        t.world.override.send_paths = () => ({ ok: false, error });
        expect((await t.send(finishBody(s))).body).toEqual({ ok: false, error });
        expect(t.world.storeCalls.filter(c => c[0] === 'read')).toEqual([]);
        expect(names(t.world)).not.toContain('send_finish');
      },
    );

    it('ruling 106: work() says the piece is no longer open, the send is still under sending, the finish is taken, Late', async () => {
      const t = setup();
      const s = await started(t);
      t.world.assessments[LAB].open = false;
      const w = await t.send({ route: 'work', session: CECE_PHONE, enrollment_id: CECE });
      const lab = w.body.assessments.find(a => a.id === LAB);
      expect(lab.open).toBe(false);
      expect(lab.sending.submission_id).toBe(s.submission_id);
      const r = await t.send(finishBody(s));
      expect(r.body).toMatchObject({ ok: true, late: true, submission_id: s.submission_id });
      // The teacher moved the last day to before the day it started: the database refuses, and the route passes it on.
      const t2 = setup();
      const s2 = await started(t2);
      t2.world.assessments[LAB].open = false;
      t2.world.assessments[LAB].closed_before_start = true;
      expect((await t2.send(finishBody(s2))).body).toEqual({
        ok: false,
        error: 'work_closed',
        closed_on: '2026-11-10',
      });
    });
  });

  it('the hash the phone sends is never used', async () => {
    const t = setup();
    const s = await started(t);
    await t.send(finishBody(s, { files: s.files.map(f => f.file_id), sha256: ['0'.repeat(64)], hashes: { a: 1 } }));
    const [, params] = t.world.calls.find(c => c[0] === 'send_finish');
    expect(params[3]).not.toContain('0'.repeat(64));
  });

  it('location data is cut out and the file stored without it, before it is hashed', async () => {
    const t = setup();
    // The sample thumbnails carry an EXIF and a Photoshop segment. A page with a GPS block and bytes after its end:
    const exif = Uint8Array.from([
      0xff, 0xe1, 0x00, 0x10, 0x45, 0x78, 0x69, 0x66, 0, 0, 0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8,
    ]);
    exif[3] = exif.length - 2;
    const withGps = new Uint8Array([...PAGE_JPEG.slice(0, 2), ...exif, ...PAGE_JPEG.slice(2), 0x47, 0x50, 0x53]);
    const s = await started(t, {}, [
      [withGps, THUMB_JPEG],
      [PAGE2_JPEG, THUMB2_JPEG],
    ]);
    const r = await t.send(finishBody(s));
    expect(r.body.ok).toBe(true);
    const sub = t.world.subs.get(s.submission_id);
    const stored = t.world.objects.get(sub.files[0].path).bytes;
    expect(stored).toEqual(PAGE_JPEG);
    // Every file is stored again as checked (review M3); three of the four had something to cut.
    const written = t.world.storeCalls.filter(c => c[0] === 'overwrite').map(c => c[1]);
    expect(written.sort()).toEqual(sub.files.flatMap(f => [f.path, f.thumb_path]).sort());
    expect(t.world.objects.get(sub.files[1].path).bytes).toEqual(PAGE2_JPEG);
    for (const f of sub.files) {
      const thumb = t.world.objects.get(f.thumb_path).bytes;
      expect(Buffer.from(thumb).includes(Buffer.from('Exif'))).toBe(false);
      expect(Buffer.from(thumb).includes(Buffer.from('ICC_PROFILE'))).toBe(true);
    }
    const [, params] = t.world.calls.find(c => c[0] === 'send_finish');
    expect(JSON.parse(params[3])[0].sha256).toBe(sha(stored));
    expect(t.logs).toContainEqual({ route: 'send-finish', stripped: 3 });
  });

  it('every page and thumbnail handed in is stored again as checked, private, no-store, whatever the phone chose (review M3)', async () => {
    const t = setup();
    const r0 = await t.send(startBody());
    const files = [
      [PAGE_JPEG, THUMB_JPEG],
      [PAGE2_JPEG, THUMB2_JPEG],
    ];
    r0.body.files.forEach((f, i) => {
      expect(t.world.phoneUpload(f.upload_url, files[i][0], 'image/jpeg', 'public, max-age=31536000')).toBe(200);
      expect(t.world.phoneUpload(f.thumb_upload_url, files[i][1], 'image/jpeg', 'public, max-age=31536000')).toBe(200);
    });
    const r = await t.send(finishBody(r0.body));
    expect(r.body.ok).toBe(true);
    const sub = t.world.subs.get(r0.body.submission_id);
    const paths = sub.files.flatMap(f => [f.path, f.thumb_path]);
    expect(
      t.world.storeCalls
        .filter(c => c[0] === 'overwrite')
        .map(c => c[1])
        .sort(),
    ).toEqual([...paths].sort());
    for (const p of paths) expect(t.world.objects.get(p).cache, p).toBe('private, no-store');
    // The hash handed in is of the page as stored.
    const [, params] = t.world.calls.find(c => c[0] === 'send_finish');
    JSON.parse(params[3]).forEach((h, i) => expect(h.sha256).toBe(sha(t.world.objects.get(sub.files[i].path).bytes)));
    // Each is written after its check: never a file that failed it, never before it was read.
    const order = t.world.storeCalls.filter(c => c[0] === 'read' || c[0] === 'overwrite').map(c => c[0] + ' ' + c[1]);
    for (const p of paths) expect(order.indexOf('read ' + p)).toBeLessThan(order.indexOf('overwrite ' + p));
  });

  it('a file that fails its check is never stored again', async () => {
    const t = setup();
    const s = await started(t, {}, [[PAGE_JPEG, PAGE_JPEG]]);
    t.world.objects.delete(t.world.subs.get(s.submission_id).files[1].path);
    expect((await t.send(finishBody(s, { files: [s.files[0].file_id] }))).body.error).toBe('bad_file');
    expect(t.world.storeCalls.filter(c => c[0] === 'overwrite')).toEqual([]);
  });

  it('Remove the Page: only the pages named are read and handed in, in the order named', async () => {
    const t = setup();
    const s = await started(t);
    const r = await t.send(finishBody(s, { files: [s.files[1].file_id] }));
    expect(r.body).toMatchObject({ ok: true, pages: 1 });
    const sub = t.world.subs.get(s.submission_id);
    expect(sub.files.map(f => f.id)).toEqual([s.files[1].file_id]);
    const reads = t.world.storeCalls.filter(c => c[0] === 'read').map(c => c[1]);
    expect(reads.every(p => p.includes(s.files[1].file_id))).toBe(true);
    // The page left out was queued by the database and deleted by the worker.
    expect([...t.world.objects.keys()].some(p => p.includes(s.files[0].file_id))).toBe(false);
  });

  describe('a file that is not what it claims: bad_file, and send_finish is never asked', () => {
    const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const cases = {
      'a PNG typed as a JPEG': [PNG, THUMB_JPEG],
      'a page cut short': [PAGE_JPEG.slice(0, PAGE_JPEG.length - 400), THUMB_JPEG],
      'a page over 2,000,000 bytes': [
        new Uint8Array([...PAGE_JPEG, ...new Uint8Array(2_000_001 - PAGE_JPEG.length)]),
        THUMB_JPEG,
      ],
      'a thumbnail larger than the phone makes one': [PAGE_JPEG, PAGE_JPEG],
      'a thumbnail that is text': [PAGE_JPEG, new TextEncoder().encode('<html><script>alert(1)</script>')],
      'an empty page': [new Uint8Array(0), THUMB_JPEG],
    };
    it.each(Object.keys(cases))('%s', async which => {
      const t = setup();
      const s = await started(t, {}, [cases[which], [PAGE2_JPEG, THUMB2_JPEG]]);
      const r = await t.send(finishBody(s));
      expect(r.body).toEqual({ ok: false, error: 'bad_file', files: [s.files[0].file_id] });
      expect(names(t.world)).not.toContain('send_finish');
      expect(t.world.subs.get(s.submission_id).state).toBe('sending');
      expect(t.logs).toContainEqual({ route: 'send-finish', refused: 1, reasons: expect.any(Array) });
    });

    it('a page over 4,096 pixels a side (the phone makes 2,000), however small the file (review L1)', async () => {
      const seg = (m, body) => [0xff, m, ((body.length + 2) >> 8) & 255, (body.length + 2) & 255, ...body];
      const page = (w, h) =>
        Uint8Array.from([
          0xff,
          0xd8,
          ...seg(0xe0, [0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
          ...seg(0xdb, [0, ...Array(64).fill(1)]),
          ...seg(0xc0, [8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0]),
          ...seg(0xc4, [0, ...Array(16).fill(0)]),
          ...seg(0xda, [1, 1, 0, 0, 63, 0]),
          0x12,
          0x34,
          0xff,
          0xd9,
        ]);
      for (const [w, h, ok] of [
        [4096, 4096, true],
        [4097, 10, false],
        [10, 4097, false],
        [20000, 20000, false],
      ]) {
        const t = setup();
        const s = await started(t, {}, [[page(w, h), THUMB_JPEG]]);
        const r = await t.send(finishBody(s, { files: [s.files[0].file_id] }));
        expect(r.body.ok ? true : r.body, `${w}x${h}`).toEqual(
          ok ? true : { ok: false, error: 'bad_file', files: [s.files[0].file_id] },
        );
      }
    });

    it('the stored file over 2,000,000 bytes is never read whole', async () => {
      const t = setup();
      const s = await started(t, {}, [cases['a page over 2,000,000 bytes'], [PAGE2_JPEG, THUMB2_JPEG]]);
      await t.send(finishBody(s));
      expect(t.world.storeCalls.filter(c => c[0] === 'read').every(c => c[2] === 2_000_000)).toBe(true);
    });
  });

  it('a page or a thumbnail not in storage yet: missing_pages, nothing read is handed in', async () => {
    const t = setup();
    const s = await started(t, {}, [[PAGE_JPEG, THUMB_JPEG]]);
    // The second page is not up; the first page's thumbnail goes missing too.
    const r = await t.send(finishBody(s));
    expect(r.body).toEqual({ ok: false, error: 'missing_pages', missing: [s.files[1].file_id] });
    expect(names(t.world)).not.toContain('send_finish');
    // Once it is up, the same finish goes through.
    t.world.phoneUpload(s.files[1].upload_url, PAGE2_JPEG);
    t.world.phoneUpload(s.files[1].thumb_upload_url, THUMB2_JPEG);
    expect((await t.send(finishBody(s))).body.ok).toBe(true);
  });

  it('a file of another student’s send is refused before anything is read, and send_finish never sees its id', async () => {
    const t = setup();
    const omar = await t.send({ ...startBody(), session: OMAR_PHONE, enrollment_id: OMAR, request_id: REQ2 });
    const s = await started(t);
    const theirs = omar.body.files[0].file_id;
    const before = t.world.storeCalls.length;
    const r = await t.send(finishBody(s, { files: [s.files[0].file_id, theirs] }));
    expect(r.status).toBe(400);
    expect(t.world.storeCalls.slice(before).filter(c => c[0] === 'read')).toEqual([]);
    expect(JSON.stringify(t.world.calls)).not.toContain(`${theirs}"`.slice(0, 36) + '","sha256');
    expect(names(t.world)).not.toContain('send_finish');
  });

  it('another student’s send, or another class’s, through this session: not_found, nothing read, no start sent', async () => {
    const t = setup();
    const omar = await t.send({ ...startBody(), session: OMAR_PHONE, enrollment_id: OMAR, request_id: REQ2 });
    const liam = await t.send({
      ...startBody(),
      session: LIAM_PHONE,
      enrollment_id: LIAM,
      assessment_id: MAP,
      request_id: REQ2,
    });
    await started(t);
    for (const other of [omar.body, liam.body]) {
      const before = t.world.calls.length;
      const storeBefore = t.world.storeCalls.length;
      const r = await t.send(finishBody(other));
      expect(r.body).toEqual({ ok: false, error: 'not_found' });
      expect(t.world.calls.slice(before).map(c => c[0])).toEqual(['send_paths', 'work']);
      expect(t.world.storeCalls.slice(storeBefore)).toEqual([]);
    }
    // Naming Omar's class with Cece's session: the database's not_found.
    const r = await t.send(finishBody(omar.body, { enrollment_id: OMAR }));
    expect(r.body).toEqual({ ok: false, error: 'not_found' });
  });

  it('the same finish again is answered from work, with nothing read', async () => {
    const t = setup();
    const s = await started(t);
    const first = await t.send(finishBody(s));
    const before = t.world.calls.length;
    const storeBefore = t.world.storeCalls.length;
    const again = await t.send(finishBody(s));
    expect(again.body).toEqual({ ...first.body, replayed: true });
    expect(t.world.calls.slice(before).map(c => c[0])).toEqual(['send_paths', 'work']);
    expect(t.world.storeCalls.slice(storeBefore)).toEqual([]);
  });

  it('the same finish again after the work became the teacher’s (an Unsend that kept their pages): not_found', async () => {
    const t = setup();
    const s = await started(t);
    await t.send(finishBody(s));
    t.world.subs.get(s.submission_id).sent_by = 'teacher';
    expect((await t.send(finishBody(s))).body).toEqual({ ok: false, error: 'not_found' });
  });

  it('a send that lost its place: send_paths answers expired, and so does the route, with nothing read', async () => {
    const t = setup();
    const s = await started(t);
    t.world.subs.get(s.submission_id).expired = true;
    const r = await t.send(finishBody(s));
    expect(r.body).toEqual({ ok: false, error: 'expired' });
    expect(names(t.world)).not.toContain('send_finish');
    expect(t.world.storeCalls.filter(c => c[0] === 'read')).toEqual([]);
  });

  it('the files list is checked: 1 to 30 ids, each once', async () => {
    const t = setup();
    const s = await started(t);
    for (const files of [
      [],
      [s.files[0].file_id, s.files[0].file_id],
      ['x'],
      'all',
      Array(31).fill(REQ),
      [{ file_id: REQ }],
    ]) {
      const before = t.world.calls.length;
      expect((await t.send(finishBody(s, { files }))).status).toBe(400);
      expect(t.world.calls.length).toBe(before);
    }
    expect((await t.send(finishBody(s, { submission_id: 'x' }))).status).toBe(400);
  });

  describe('every refusal of send_finish reaches the phone as it is', () => {
    const LIST = {
      expired: {},
      not_found: {},
      send_off: {},
      not_taking_work: {},
      work_closed: { closed_on: '2026-11-13' },
      missing_pages: { missing: [REQ2] },
      bad_file: { files: [REQ2] },
      already_sent: {},
      grading_started: {},
      too_many_pages: { room: 0 },
      signed_out: {},
      card_locked: {},
    };
    it.each(Object.keys(LIST))('%s', async error => {
      const t = setup();
      const s = await started(t);
      t.world.override.send_finish = () => ({ ok: false, error, ...LIST[error], path: 'x' });
      expect((await t.send(finishBody(s))).body).toEqual({ ok: false, error, ...LIST[error] });
    });
  });
});

describe('how much one call may read or sign (review M2)', () => {
  const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const THIRTY = Array.from({ length: 30 }, () => PAGES[0]);
  const reads = (t, from = 0) => t.storeCalls.slice(from).filter(c => c[0] === 'read');
  // n distinct files in the folder of the answer's first file, each well formed.
  const many = (f, n) =>
    Array.from({ length: n }, (_, i) => {
      const id = `0d0d0d0d-0000-4000-8000-${String(i + 1).padStart(12, '0')}`;
      const folder = f.path.slice(0, f.path.lastIndexOf('/'));
      return {
        ...f,
        file_id: id,
        page: (i % 30) + 1,
        path: `${folder}/${id}.jpg`,
        thumb_path: `${folder}/${id}-thumb.jpg`,
      };
    });

  it('send-finish stops at the first bad file: no read starts after it', async () => {
    for (const first of [
      [PNG, THUMB_JPEG],
      [PAGE_JPEG, PAGE_JPEG],
    ]) {
      const t = setup();
      const s = await started(t, { pages: THIRTY }, [first, ...Array(29).fill([PAGE_JPEG, THUMB_JPEG])]);
      const before = t.world.storeCalls.length;
      const r = await t.send(finishBody(s));
      expect(r.body).toEqual({ ok: false, error: 'bad_file', files: [s.files[0].file_id] });
      // Four files are read at once; once the first is bad, no read starts. Thirty pages would otherwise be sixty.
      expect(reads(t.world, before).length).toBeLessThanOrEqual(8);
    }
  });

  it('a send kept failing on its first thumbnail is not read whole again on every call', async () => {
    const t = setup();
    const s = await started(t, { pages: THIRTY }, [[PAGE_JPEG, PAGE_JPEG], ...Array(29).fill([PAGE_JPEG, THUMB_JPEG])]);
    let n = 0;
    for (let i = 0; i < 10; i++) {
      const before = t.world.storeCalls.length;
      expect((await t.send(finishBody(s))).body.error).toBe('bad_file');
      n += reads(t.world, before).length;
    }
    expect(n).toBeLessThanOrEqual(10 * 8);
  });

  it('each file is read at most once in a call, whatever it holds', async () => {
    const exif = Uint8Array.from([0xff, 0xe1, 0x00, 0x08, 0x45, 0x78, 0x69, 0x66, 0, 0]);
    const withExif = new Uint8Array([...PAGE_JPEG.slice(0, 2), ...exif, ...PAGE_JPEG.slice(2)]);
    for (const files of [
      [
        [withExif, THUMB_JPEG],
        [PAGE2_JPEG, THUMB2_JPEG],
      ],
      [[PAGE_JPEG, THUMB_JPEG]],
      [
        [PNG, THUMB_JPEG],
        [PAGE2_JPEG, THUMB2_JPEG],
      ],
    ]) {
      const t = setup();
      const s = await started(t, {}, files);
      const before = t.world.storeCalls.length;
      await t.send(finishBody(s));
      const paths = reads(t.world, before).map(c => c[1]);
      expect(new Set(paths).size).toBe(paths.length);
    }
  });

  it('after a page is found missing, the rest are only looked for, not read', async () => {
    const t = setup();
    const s = await started(t, { pages: THIRTY }, [[PAGE_JPEG, THUMB_JPEG]]);
    const before = t.world.storeCalls.length;
    const r = await t.send(finishBody(s));
    expect(r.body.error).toBe('missing_pages');
    expect(r.body.missing).toEqual(s.files.slice(1).map(f => f.file_id));
    // Every missing page is named, and no page is asked for more than a look once one is missing.
    const full = reads(t.world, before).filter(c => c[2] > 0);
    expect(full.length).toBeLessThanOrEqual(8);
  });

  it('send-start: a database answer of more than 30 pages, or a page named twice, signs nothing', async () => {
    for (const change of [
      r => ({ ...r, files: many(r.files[0], 31) }),
      r => ({ ...r, files: [r.files[0], r.files[0]] }),
    ]) {
      const t = setup();
      t.world.override.send_start = (params, fns) => change(fns.send_start(params));
      const r = await t.send(startBody());
      expect(r.status).toBe(500);
      expect(t.world.storeCalls.filter(c => c[0] === 'signUpload')).toEqual([]);
    }
  });

  it('send-finish: a send_paths answer of more than 30 pages, or a page named twice, reads nothing', async () => {
    for (const change of [
      r => ({ ...r, files: many(r.files[0], 31) }),
      r => ({ ...r, files: [r.files[0], r.files[0], r.files[1]] }),
    ]) {
      const t = setup();
      const s = await started(t);
      t.world.override.send_paths = (params, fns) => change(fns.send_paths(params));
      const r = await t.send(finishBody(s));
      expect(r.status).toBe(500);
      expect(t.world.storeCalls.filter(c => c[0] === 'read')).toEqual([]);
    }
  });

  it('file-links: more than 30 pages of one handed-in send, or a file named twice, signs nothing', async () => {
    for (const change of [
      r => ({ ...r, files: many(r.files[0], 31) }),
      r => ({ ...r, files: [r.files[0], r.files[0]] }),
    ]) {
      const t = setup();
      const s = await started(t);
      await t.send(finishBody(s));
      t.world.override.file_links = (params, fns) => change(fns.file_links(params));
      const before = t.world.storeCalls.length;
      const r = await t.send({ route: 'file-links', session: CECE_PHONE, enrollment_id: CECE, assessment_id: LAB });
      expect(r.status).toBe(500);
      expect(t.world.storeCalls.slice(before).filter(c => c[0] === 'signDownloads')).toEqual([]);
    }
  });

  it('file-links: two handed-in versions of 30 pages each are both linked (a revision, Batch C)', async () => {
    const t = setup();
    const s = await started(t, { pages: THIRTY }, Array(30).fill([PAGE_JPEG, THUMB_JPEG]));
    expect((await t.send(finishBody(s))).body.ok).toBe(true);
    t.world.override.file_links = (params, fns) => {
      const r = fns.file_links(params);
      const v2 = r.files.map(f => ({
        ...f,
        submission_id: REQ2,
        version: 2,
        file_id: f.file_id.replace(/^99/, '77'),
        path: f.path.replace(/\/99([0-9]{6}-[^/]*)\.jpg$/, '/77$1.jpg'),
        thumb_path: f.thumb_path.replace(/\/99([0-9]{6}-[^/]*)-thumb\.jpg$/, '/77$1-thumb.jpg'),
      }));
      return { ...r, files: [...r.files, ...v2] };
    };
    const r = await t.send({ route: 'file-links', session: CECE_PHONE, enrollment_id: CECE, assessment_id: LAB });
    expect(r.status).toBe(200);
    expect(r.body.files.length).toBe(60);
  });
});

describe('replace, start to finish', () => {
  it('the old pages are deleted from storage by the worker once the new ones are in', async () => {
    const t = setup();
    const s = await started(t);
    await t.send(finishBody(s));
    const oldPaths = t.world.subs.get(s.submission_id).files.flatMap(f => [f.path, f.thumb_path]);
    const n = await started(t, { route: 'replace', request_id: REQ2 }, [[PAGE2_JPEG, THUMB2_JPEG]]);
    // Until the new pages are in, the old work is whole.
    expect(oldPaths.every(p => t.world.objects.has(p))).toBe(true);
    const r = await t.send({ ...finishBody(n, { request_id: REQ2, files: [n.files[0].file_id] }) });
    expect(r.body).toMatchObject({ ok: true, pages: 1 });
    expect(t.world.calls.filter(c => c[0] === 'replace').length).toBe(1);
    expect(oldPaths.some(p => t.world.objects.has(p))).toBe(false);
    expect(t.world.queue.every(q => q.done)).toBe(true);
  });
});

describe('unsend', () => {
  it('asks unsend, copies the answer, and the worker deletes the photos', async () => {
    const t = setup();
    const s = await started(t);
    await t.send(finishBody(s));
    const paths = t.world.subs.get(s.submission_id).files.flatMap(f => [f.path, f.thumb_path]);
    const r = await t.send({
      route: 'unsend',
      session: CECE_PHONE,
      enrollment_id: CECE,
      assessment_id: LAB,
      path: paths[0],
    });
    expect(r.body).toEqual({ ok: true, unsent: true, cancelled: false, pages: 2, kept: 0 });
    const call = t.world.calls.find(c => c[0] === 'unsend');
    expect(call[1]).toEqual([CECE_PHONE, CECE, LAB, expect.stringMatching(/^[0-9a-f]{64}$/)]);
    expect(paths.some(p => t.world.objects.has(p))).toBe(false);
    // The removal is by the paths the queue named, and nobody can get a link to them now.
    const links = await t.send({ route: 'file-links', session: CECE_PHONE, enrollment_id: CECE, assessment_id: LAB });
    expect(links.body).toEqual({ ok: true, files: [] });
  });

  it('twice: the second is read as done', async () => {
    const t = setup();
    const s = await started(t);
    await t.send(finishBody(s));
    const body = { route: 'unsend', session: CECE_PHONE, enrollment_id: CECE, assessment_id: LAB };
    await t.send(body);
    expect((await t.send(body)).body).toEqual({ ok: true, unsent: false, cancelled: false, pages: 0, kept: 0 });
  });

  it.each(['not_found', 'cannot_change', 'send_off', 'not_taking_work', 'grading_started', 'card_locked', 'closed'])(
    'refused %s',
    async error => {
      const t = setup();
      t.world.override.unsend = () => ({ ok: false, error, pages: 2 });
      const r = await t.send({ route: 'unsend', session: CECE_PHONE, enrollment_id: CECE, assessment_id: LAB });
      expect(r.body).toEqual({ ok: false, error });
    },
  );

  it('work_closed carries its date', async () => {
    const t = setup();
    t.world.override.unsend = () => ({ ok: false, error: 'work_closed', closed_on: '2026-11-13' });
    const r = await t.send({ route: 'unsend', session: CECE_PHONE, enrollment_id: CECE, assessment_id: LAB });
    expect(r.body).toEqual({ ok: false, error: 'work_closed', closed_on: '2026-11-13' });
  });
});

describe('file-links', () => {
  it('a 300-second link for each path file_links named, and for no other', async () => {
    const t = setup();
    const s = await started(t);
    await t.send(finishBody(s));
    const r = await t.send({
      route: 'file-links',
      session: CECE_PHONE,
      enrollment_id: CECE,
      assessment_id: LAB,
      paths: [`${C1}/${LAB}/${OMAR}/x/y.jpg`],
      file_id: REQ2,
    });
    const sub = t.world.subs.get(s.submission_id);
    const signed = t.world.storeCalls.filter(c => c[0] === 'signDownloads');
    expect(signed).toEqual([['signDownloads', sub.files.flatMap(f => [f.path, f.thumb_path]), 300]]);
    expect(r.body).toEqual({
      ok: true,
      files: sub.files.map((f, i) => ({
        file_id: f.id,
        submission_id: sub.id,
        version: 1,
        page: i + 1,
        width: 900,
        height: 1200,
        rotation: 0,
        url: expect.stringContaining(f.path),
        thumb_url: expect.stringContaining(f.thumb_path),
      })),
    });
  });

  it('nothing handed in: an empty list, and Storage is not asked', async () => {
    const t = setup();
    await started(t);
    const r = await t.send({ route: 'file-links', session: CECE_PHONE, enrollment_id: CECE, assessment_id: LAB });
    expect(r.body).toEqual({ ok: true, files: [] });
    expect(t.world.storeCalls.filter(c => c[0] === 'signDownloads')).toEqual([]);
  });

  it('another student’s piece through this session is the database’s not_found, and nothing is signed', async () => {
    const t = setup();
    const omar = await started(t, { session: OMAR_PHONE, enrollment_id: OMAR, request_id: REQ2 });
    await t.send(finishBody(omar, { session: OMAR_PHONE, enrollment_id: OMAR, request_id: REQ2 }));
    const r = await t.send({ route: 'file-links', session: CECE_PHONE, enrollment_id: OMAR, assessment_id: LAB });
    expect(r.body).toEqual({ ok: false, error: 'not_found' });
    expect(t.world.storeCalls.filter(c => c[0] === 'signDownloads')).toEqual([]);
  });

  it.each([
    ['another student', p => p.replace(`/${CECE}/`, `/${OMAR}/`)],
    ['another piece', p => p.replace(`/${LAB}/`, `/${ESSAY}/`)],
    ['another file', p => p.replace(/\/([0-9a-f-]{36})(-thumb)?\.jpg$/, `/${REQ2}$2.jpg`)],
    ['another class', p => p.replace(C1, C2)],
    ['not the layout', p => p + '/../x.jpg'],
  ])('a path of %s in the answer: no link at all', async (_, change) => {
    const t = setup();
    const s = await started(t);
    await t.send(finishBody(s));
    t.world.override.file_links = (params, fns) => {
      const r = JSON.parse(JSON.stringify(fns.file_links(params)));
      r.files[1].thumb_path = change(r.files[1].thumb_path);
      return r;
    };
    const r = await t.send({ route: 'file-links', session: CECE_PHONE, enrollment_id: CECE, assessment_id: LAB });
    expect(r).toEqual({ status: 500, body: { ok: false, error: 'server' } });
    expect(t.world.storeCalls.filter(c => c[0] === 'signDownloads')).toEqual([]);
  });

  it('a page named as a thumbnail, or the other way round: no link at all', async () => {
    for (const change of [f => (f.path = f.thumb_path), f => (f.thumb_path = f.path)]) {
      const t = setup();
      const s = await started(t);
      await t.send(finishBody(s));
      t.world.override.file_links = (params, fns) => {
        const r = JSON.parse(JSON.stringify(fns.file_links(params)));
        change(r.files[0]);
        return r;
      };
      const r = await t.send({ route: 'file-links', session: CECE_PHONE, enrollment_id: CECE, assessment_id: LAB });
      expect(r.status).toBe(500);
      expect(t.world.storeCalls.filter(c => c[0] === 'signDownloads')).toEqual([]);
    }
  });

  it('another bucket in the answer: no link at all', async () => {
    const t = setup();
    const s = await started(t);
    await t.send(finishBody(s));
    t.world.override.file_links = (params, fns) => ({ ...fns.file_links(params), bucket: 'public-bucket' });
    const r = await t.send({ route: 'file-links', session: CECE_PHONE, enrollment_id: CECE, assessment_id: LAB });
    expect(r.status).toBe(500);
    expect(t.world.storeCalls.filter(c => c[0] === 'signDownloads')).toEqual([]);
  });

  it('a page kept through a Replace keeps its first folder: still linked', async () => {
    const t = setup();
    const s = await started(t);
    await t.send(finishBody(s));
    t.world.override.file_links = (params, fns) => {
      const r = JSON.parse(JSON.stringify(fns.file_links(params)));
      r.files[0].submission_id = REQ2;
      return r;
    };
    const r = await t.send({ route: 'file-links', session: CECE_PHONE, enrollment_id: CECE, assessment_id: LAB });
    expect(r.body.files.length).toBe(2);
  });
});

describe('the removal worker and sweep', () => {
  it('runs after send-start, replace, send-finish and unsend, and not after work or file-links', async () => {
    for (const [body, runs] of [
      [startBody(), true],
      [startBody({ route: 'replace' }), true],
      [{ route: 'unsend', session: CECE_PHONE, enrollment_id: CECE, assessment_id: LAB }, true],
      [{ route: 'work', session: CECE_PHONE, enrollment_id: CECE }, false],
      [{ route: 'file-links', session: CECE_PHONE, enrollment_id: CECE, assessment_id: LAB }, false],
    ]) {
      const t = setup();
      await t.send(body);
      expect(names(t.world).includes('removal_batch'), body.route).toBe(runs);
    }
    const t = setup();
    const s = await started(t);
    const before = t.world.calls.length;
    await t.send(finishBody(s));
    expect(t.world.calls.slice(before).map(c => c[0])).toEqual(['send_paths', 'send_finish', 'removal_batch']);
  });

  it('deletes exactly the queued paths, then reports them done; asks for 200 at a time', async () => {
    const t = setup();
    const s = await started(t);
    // A newer send of the same piece drops this one: its four files are queued.
    await t.send(startBody({ request_id: REQ2 }));
    const sub = [...t.world.subs.values()][0];
    expect(sub.request_id).toBe(REQ2);
    const removed = t.world.storeCalls.filter(c => c[0] === 'remove').flatMap(c => c[1]);
    expect(removed.length).toBe(4);
    expect(removed.every(p => s.files.some(f => p.includes(f.file_id)))).toBe(true);
    expect(t.world.calls.find(c => c[0] === 'removal_batch')[1]).toEqual(['200']);
    expect(t.world.calls.find(c => c[0] === 'removal_done')[1][0]).toMatch(/^\{\d+(,\d+)*\}$/);
    expect(t.world.queue.every(q => q.done)).toBe(true);
  });

  it('an item that is not this bucket’s, or not its layout, is neither deleted nor reported', async () => {
    const t = setup();
    t.world.override.removal_batch = () => ({
      ok: true,
      items: [
        { id: 7, bucket: 'other', path: `${C1}/${LAB}/${CECE}/${REQ}/${REQ2}.jpg` },
        { id: 8, bucket: 'student-photos', path: `${C1}/../../etc/passwd` },
        { id: '9; drop', bucket: 'student-photos', path: `${C1}/${LAB}/${CECE}/${REQ}/${REQ2}.jpg` },
        { id: 10, bucket: 'student-photos', path: `${C1}/${LAB}/${CECE}/${REQ}/${REQ2}-thumb.jpg` },
      ],
      left: 0,
    });
    await t.send({ route: 'sweep', access_token: TEACHER_TOKEN });
    expect(t.world.storeCalls.filter(c => c[0] === 'remove')).toEqual([
      ['remove', [`${C1}/${LAB}/${CECE}/${REQ}/${REQ2}-thumb.jpg`]],
    ]);
    expect(t.world.calls.find(c => c[0] === 'removal_done')[1]).toEqual(['{10}']);
    expect(t.logs).toContainEqual({ route: 'sweep', worker: 'ran', removed: 0, skipped: 3, left: 0 });
  });

  it('a failed removal is logged, never reaches the answer, and nothing is reported done', async () => {
    const t = setup();
    const s = await started(t, {}, []);
    t.world.store.remove = async () => {
      throw Object.assign(new Error('storage remove 503'), { name: 'StorageError' });
    };
    const r = await t.send(startBody({ request_id: REQ2 }));
    expect(r.body.ok).toBe(true);
    expect(names(t.world)).not.toContain('removal_done');
    expect(t.logs).toContainEqual({
      route: 'send-start',
      worker: 'error',
      kind: 'StorageError',
      removed: 0,
      skipped: 0,
    });
    expect(s.files.length).toBe(2);
  });

  it('keeps going while some are left and there is time, and stops at its rounds', async () => {
    const t = setup();
    let rounds = 0;
    t.world.override.removal_batch = () => {
      rounds++;
      return {
        ok: true,
        items: [{ id: rounds, bucket: 'student-photos', path: `${C1}/${LAB}/${CECE}/${REQ}/${REQ2}.jpg` }],
        left: 5,
      };
    };
    t.world.override.removal_done = () => ({ ok: true, gone: 1, still_there: [] });
    await t.send({ route: 'sweep', access_token: TEACHER_TOKEN });
    expect(rounds).toBe(10);
    rounds = 0;
    await t.send({ route: 'unsend', session: CECE_PHONE, enrollment_id: CECE, assessment_id: LAB });
    expect(rounds).toBe(2);
  });

  it('sweep: a signed-in teacher only. It answers ok and nothing else, whatever it removed', async () => {
    const t = setup();
    const s = await started(t, {}, []);
    t.world.fns.unsend([CECE_PHONE, CECE, LAB]);
    expect(t.world.queue.length).toBe(4);
    const r = await t.send({ route: 'sweep', access_token: TEACHER_TOKEN, course_id: C2, paths: ['x'] });
    expect(r).toEqual({ status: 200, body: { ok: true } });
    expect(t.world.queue.every(q => q.done)).toBe(true);
    expect(names(t.world).filter(n => !['send_start', 'removal_batch', 'removal_done'].includes(n))).toEqual(['auth']);
    expect(s.submission_id).toBeTruthy();
  });

  it('sweep refuses a student’s session, no token, a token Auth does not know, and asks the database nothing', async () => {
    for (const body of [
      { route: 'sweep' },
      { route: 'sweep', session: CECE_PHONE },
      { route: 'sweep', access_token: CECE_PHONE.slice(0, 10) },
      { route: 'sweep', access_token: 'not a token at all' },
      { route: 'sweep', access_token: 'eyJhbGciOiJIUzI1NiJ9.someone.else' },
      { route: 'sweep', access_token: ['x'] },
    ]) {
      const t = setup();
      const r = await t.send(body);
      expect(r, JSON.stringify(body)).toEqual({ status: 401, body: { ok: false, error: 'unauthorized' } });
      expect(names(t.world).filter(n => n !== 'auth')).toEqual([]);
      // Only something shaped like a sign-in token is sent to Auth at all.
      const shaped = typeof body.access_token === 'string' && body.access_token.startsWith('eyJ');
      expect(names(t.world).includes('auth'), JSON.stringify(body)).toBe(shaped);
    }
  });

  it('sweep with Auth down is a server error, never "signed in"; without Auth or the bucket, the same', async () => {
    for (const extra of [{ whoIs: async () => Promise.reject(new Error('auth')) }, { whoIs: null }, { store: null }]) {
      const t = setup(extra);
      const r = await t.send({ route: 'sweep', access_token: TEACHER_TOKEN });
      expect(r).toEqual({ status: 500, body: { ok: false, error: 'server' } });
      expect(t.world.calls.filter(c => c[0] !== 'auth')).toEqual([]);
    }
  });

  it('two at once in one instance: one runs the worker, the other leaves the queue to it', async () => {
    const t = setup();
    let release;
    const gate = new Promise(r => (release = r));
    let batches = 0;
    t.world.override.removal_batch = async () => {
      batches++;
      await gate;
      return { ok: true, items: [], left: 0 };
    };
    const a = t.send({ route: 'sweep', access_token: TEACHER_TOKEN });
    await new Promise(r => setTimeout(r, 5));
    const b = await t.send({ route: 'sweep', access_token: TEACHER_TOKEN });
    expect(b.body).toEqual({ ok: true });
    release();
    await a;
    expect(batches).toBe(1);
  });
});

describe('what goes wrong in the database', () => {
  it('22023 is a plain server error, logged by its class only', async () => {
    for (const body of [
      startBody(),
      { route: 'unsend', session: CECE_PHONE, enrollment_id: CECE, assessment_id: LAB },
    ]) {
      const t = setup();
      const fn = body.route === 'unsend' ? 'unsend' : 'send_start';
      t.world.override[fn] = () => {
        const e = new Error(`invalid input for ${CECE}`);
        e.name = 'PostgresError';
        e.code = '22023';
        throw e;
      };
      const r = await t.send(body);
      expect(r).toEqual({ status: 500, body: { ok: false, error: 'server' } });
      expect(t.logs).toEqual([{ route: body.route, outcome: 'error', kind: 'PostgresError', ms: expect.any(Number) }]);
    }
  });

  it('an answer that is neither a good one nor a refusal is a server error', async () => {
    for (const weird of [null, 'ok', [], { ok: 'yes' }, { error: 7 }]) {
      const t = setup();
      t.world.override.unsend = () => weird;
      expect(
        (await t.send({ route: 'unsend', session: CECE_PHONE, enrollment_id: CECE, assessment_id: LAB })).status,
      ).toBe(500);
    }
  });

  it('every request in these tests is one the database accepts: the stand-in raises 22023 for any other', async () => {
    // The stand-in raises 22023 exactly where Batch B does. A full send, a Remove the Page, a replace and an
    // unsend went through above without one; here every page size at its limits does too.
    const t = setup();
    const pages = [
      { width: 1, height: 20000, bytes: 1, thumb_bytes: 2097152 },
      { width: null, bytes: null },
    ];
    expect((await t.send(startBody({ pages }))).body.ok).toBe(true);
    expect(t.world.calls[0][1][3]).toBe('[{"width":1,"height":20000,"bytes":1,"thumb_bytes":2097152},{}]');
  });
});

describe('logs', () => {
  it('a whole send, a replace, an unsend, links and a sweep log no token, id, path, link, hash or byte', async () => {
    const t = setup();
    const s = await started(t);
    await t.send(finishBody(s));
    await t.send({ route: 'file-links', session: CECE_PHONE, enrollment_id: CECE, assessment_id: LAB });
    const n = await started(t, { route: 'replace', request_id: REQ2 });
    await t.send(finishBody(n, { request_id: REQ2 }));
    await t.send({ route: 'unsend', session: CECE_PHONE, enrollment_id: CECE, assessment_id: LAB });
    await t.send({ route: 'sweep', access_token: TEACHER_TOKEN });
    await t.send(finishBody(s, { request_id: REQ2 }));
    const text = JSON.stringify(t.logs);
    const secrets = [
      CECE_PHONE,
      TEACHER_TOKEN,
      TEACHER_A,
      CECE,
      OMAR,
      LAB,
      C1,
      REQ,
      REQ2,
      s.submission_id,
      n.submission_id,
      ...s.files.map(f => f.file_id),
      sha(PAGE_JPEG),
      'student-photos',
      'https://',
      'token=',
      '.jpg',
      'I was away',
    ];
    for (const v of secrets) expect(text, v).not.toContain(v);
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
    // Each line is the route with an outcome, a worker's counts, or a count of files.
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

describe('a Storage call that does not answer in time (review L4)', () => {
  const timeout = () => {
    const e = new Error('storage read-timeout 0');
    e.name = 'StorageError';
    return e;
  };
  // The bucket, with one call made to time out the n-th time it is asked.
  const flaky = (t, method, n) => {
    const real = t.world.store[method];
    let asked = 0;
    t.world.store[method] = async (...args) => {
      asked++;
      if (asked === n) throw timeout();
      return real(...args);
    };
  };

  it('send-start: a plain server error; the same request again gives the links, and only one send is made', async () => {
    const t = setup();
    flaky(t, 'signUpload', 3);
    const r = await t.send(startBody());
    expect(r).toEqual({ status: 500, body: { ok: false, error: 'server' } });
    expect(t.logs).toContainEqual(expect.objectContaining({ outcome: 'error', kind: 'StorageError' }));
    const again = await t.send(startBody());
    expect(again.body).toMatchObject({ ok: true, replayed: true });
    expect(again.body.files.length).toBe(2);
    expect(t.world.subs.size).toBe(1);
  });

  it('send-finish, reading: a plain server error, nothing handed in; the same finish again goes through', async () => {
    const t = setup();
    const s = await started(t);
    flaky(t, 'read', 2);
    expect((await t.send(finishBody(s))).status).toBe(500);
    expect(names(t.world)).not.toContain('send_finish');
    expect((await t.send(finishBody(s))).body).toMatchObject({ ok: true, pages: 2 });
  });

  it('send-finish, storing again: nothing handed in, every stored file still passes, and the finish again goes through', async () => {
    const t = setup();
    const s = await started(t);
    flaky(t, 'overwrite', 3);
    expect((await t.send(finishBody(s))).status).toBe(500);
    expect(names(t.world)).not.toContain('send_finish');
    const sub = t.world.subs.get(s.submission_id);
    const { inspectJpeg } = await import('../supabase/functions/_shared/jpeg-check.ts');
    for (const f of sub.files) {
      expect(inspectJpeg(t.world.objects.get(f.path).bytes, { maxBytes: 2e6, maxSide: 4096 }).ok).toBe(true);
      expect(inspectJpeg(t.world.objects.get(f.thumb_path).bytes, { maxBytes: 2e6, maxSide: 400 }).ok).toBe(true);
    }
    const r = await t.send(finishBody(s));
    expect(r.body).toMatchObject({ ok: true, pages: 2 });
    const [, params] = t.world.calls.find(c => c[0] === 'send_finish');
    JSON.parse(params[3]).forEach((h, i) => expect(h.sha256).toBe(sha(t.world.objects.get(sub.files[i].path).bytes)));
  });

  it('file-links: a plain server error, no link', async () => {
    const t = setup();
    const s = await started(t);
    await t.send(finishBody(s));
    flaky(t, 'signDownloads', 1);
    const r = await t.send({ route: 'file-links', session: CECE_PHONE, enrollment_id: CECE, assessment_id: LAB });
    expect(r).toEqual({ status: 500, body: { ok: false, error: 'server' } });
  });

  it('the worker: logged, never in the answer, nothing reported done, and the next run takes the queue', async () => {
    const t = setup();
    const s = await started(t);
    await t.send(finishBody(s));
    flaky(t, 'remove', 1);
    const unsend = { route: 'unsend', session: CECE_PHONE, enrollment_id: CECE, assessment_id: LAB };
    expect((await t.send(unsend)).body).toMatchObject({ ok: true, unsent: true });
    expect(t.logs).toContainEqual(expect.objectContaining({ route: 'unsend', worker: 'error', kind: 'StorageError' }));
    expect(t.world.queue.length).toBe(4);
    expect(t.world.queue.every(q => !q.done)).toBe(true);
    await t.send(unsend);
    expect(t.world.queue.every(q => q.done)).toBe(true);
  });
});

describe('the worker runs after the answer where the runtime allows it (review L4)', () => {
  it('with EdgeRuntime.waitUntil: the answer does not wait for the worker, and the runtime is handed it', async () => {
    const later = [];
    const t = setup({ defer: p => later.push(p) });
    const s = await started(t);
    await t.send(finishBody(s));
    await Promise.all(later.splice(0));
    // Storage's queue is slow now: the worker waits on it.
    let release;
    const gate = new Promise(r => (release = r));
    t.world.override.removal_batch = async (params, fns) => (await gate, fns.removal_batch(params));
    const unsend = t.send({ route: 'unsend', session: CECE_PHONE, enrollment_id: CECE, assessment_id: LAB });
    const first = await Promise.race([unsend, new Promise(r => setTimeout(() => r('waited'), 200))]);
    expect(first).not.toBe('waited');
    expect(first.body).toMatchObject({ ok: true, unsent: true });
    expect(later.length).toBe(1);
    expect(t.world.queue.some(q => !q.done)).toBe(true);
    release();
    await Promise.all(later);
    expect(t.world.queue.every(q => q.done)).toBe(true);
  });

  it('without it, the worker runs before the answer, as before', async () => {
    const t = setup();
    const s = await started(t);
    await t.send(finishBody(s));
    let release;
    const gate = new Promise(r => (release = r));
    t.world.override.removal_batch = async (params, fns) => (await gate, fns.removal_batch(params));
    const unsend = t.send({ route: 'unsend', session: CECE_PHONE, enrollment_id: CECE, assessment_id: LAB });
    expect(await Promise.race([unsend, new Promise(r => setTimeout(() => r('waited'), 100))])).toBe('waited');
    release();
    expect((await unsend).body).toMatchObject({ ok: true, unsent: true });
    expect(t.world.queue.every(q => q.done)).toBe(true);
  });

  it('sweep is the worker itself: it runs before sweep answers', async () => {
    const later = [];
    const t = setup({ defer: p => later.push(p) });
    await t.send({ route: 'sweep', access_token: TEACHER_TOKEN });
    expect(names(t.world)).toContain('removal_batch');
    expect(later).toEqual([]);
  });

  it('index.ts hands the worker to EdgeRuntime.waitUntil when there is one', async () => {
    const src = (await import('node:fs')).readFileSync('supabase/functions/student-submit/index.ts', 'utf8');
    expect(src).toMatch(/EdgeRuntime/);
    expect(src).toMatch(/waitUntil/);
    expect(src).toMatch(/defer:/);
  });
});
