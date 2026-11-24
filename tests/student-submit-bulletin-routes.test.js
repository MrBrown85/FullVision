/**
 * Bulletins through the student-submit edge function
 * (supabase/functions/student-submit/bulletin-routes.ts; the contract is
 * migrations/local-test/bulletins-contract.md, "For B1b"), with a stand-in
 * database and Storage.
 *
 * - Each route's one statement and its parameters, the hashed address last.
 * - A request of the wrong shape is refused before the database is asked.
 * - A reply is rebuilt from the contract's keys: a key the database adds,
 *   or another student's anything, never reaches the phone.
 * - bulletin-files signs a page only after its path is checked to be this
 *   file's, in the bucket bulletin-files; anything else is a server error
 *   and nothing is signed.
 * - The removal worker deletes a queued bulletin-files page that matches
 *   the pattern, from that bucket only; any other shape stays queued, and
 *   every bucket it knew before is handled as before.
 */
import { describe, expect, it } from 'vitest';
import { makeHandler as makeRealHandler } from '../supabase/functions/student-submit/handler.ts';
import { tokensAtTheDatabase } from './helpers/session-hash.js';
import { BULLETIN_ROUTES, SENT, SQL } from '../supabase/functions/student-submit/bulletin-routes.ts';
import {
  BULLETIN_BUCKET,
  BULLETIN_PATH,
  bulletinPathParts,
  handoutFilePathParts,
  handoutPathParts,
  pathParts,
  storageRest,
} from '../supabase/functions/_shared/storage-rest.ts';
import { C1, CECE, LAB, fakeWorld } from './helpers/fake-send-world.js';

// The stand-in database is handed the tokens the test sent; one sent as itself fails (2026112401).
const makeHandler = tokensAtTheDatabase(makeRealHandler);

const URL_ = 'https://x.supabase.co/functions/v1/student-submit?forceFunctionRegion=ca-central-1';
const PHONE = 's'.repeat(64);
const ME = 'e1e1e1e1-0000-4000-8000-000000000001';
const OTHER_KID = 'e9e9e9e9-0000-4000-8000-000000000009';
const MY_OTHER_CLASS = 'e2e2e2e2-0000-4000-8000-000000000002';
const COURSE = 'c1c1c1c1-0000-4000-8000-000000000001';
const OTHER_COURSE = 'c2c2c2c2-0000-4000-8000-000000000002';
const B1 = 'b1b1b1b1-0000-4000-8000-000000000001';
const B2 = 'b2b2b2b2-0000-4000-8000-000000000002';
const F1 = 'f1f1f1f1-0000-4000-8000-000000000001';
const F2 = 'f2f2f2f2-0000-4000-8000-000000000002';
const AS = 'a1a1a1a1-0000-4000-8000-000000000001';
const AT = '2026-11-18T16:04:11.482913+00:00';
const page = (n, course = COURSE, file = F1) => `${course}/${file}/${n}.jpg`;

function setup(answer, extra = {}) {
  const calls = [];
  const storeCalls = [];
  const logs = [];
  const handle = makeHandler({
    region: 'ca-central-1',
    ipKey: 'k',
    db: {
      check: async () => ({}),
      submit: async () => ({}),
      call: async (sql, params) => {
        calls.push([sql, params]);
        if (!Object.values(SQL).includes(sql)) throw new Error('unknown statement');
        return answer(params, sql);
      },
    },
    store:
      'store' in extra
        ? extra.store
        : {
            signUpload: async () => 'x',
            read: async () => 'missing',
            remove: async () => {},
            overwrite: async () => {},
            signDownloads: async (paths, seconds, bucket) => {
              storeCalls.push(['signDownloads', paths, seconds, ...(bucket ? [bucket] : [])]);
              return Object.fromEntries(paths.map(p => [p, 'https://x.supabase.co/sign/' + p + '?token=t']));
            },
          },
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
  return { send, calls, storeCalls, logs };
}

/* A bulletin as the contract says the database sends it. */
const BULLETIN = {
  id: B1,
  kind: 'announcement',
  body: 'Bring your lab book tomorrow.',
  link_url: 'https://www.example.ca/lab',
  link_title: 'Lab Notes',
  pinned: true,
  pinned_until: null,
  assessment_id: AS,
  reactions_on: true,
  posted_at: AT,
  edited_at: null,
  files: [{ id: F1, kind: 'photo', title: 'Photo', page_count: 1, position: 1 }],
  seen_at: AT,
  reaction: 'got_it',
};
const FEED = {
  ok: true,
  bulletins: [BULLETIN, { ...BULLETIN, id: B2, files: [], seen_at: null, reaction: null, assessment_id: null }],
  new: [
    { enrollment_id: ME, count: 1 },
    { enrollment_id: MY_OTHER_CLASS, count: 3 },
  ],
};

describe('the routes', () => {
  it('are the four the contract names, and each names one statement, typed as the SQL takes it', () => {
    expect(Object.keys(BULLETIN_ROUTES).sort()).toEqual([
      'bulletin-files',
      'bulletin-react',
      'bulletin-seen',
      'bulletins',
    ]);
    expect(SQL).toEqual({
      bulletins: 'select student_submit.bulletins($1::text, $2::uuid, $3::text) as r',
      bulletinSeen: 'select student_submit.bulletin_seen($1::text, $2::uuid, $3::uuid[], $4::text) as r',
      bulletinReact: 'select student_submit.bulletin_react($1::text, $2::uuid, $3::uuid, $4::text, $5::text) as r',
      bulletinFiles: 'select student_submit.bulletin_file_links($1::text, $2::uuid, $3::uuid, $4::text) as r',
    });
  });
});

describe('bulletins', () => {
  const ASK = { route: 'bulletins', session: PHONE, enrollment_id: ME };

  it('asks student_submit.bulletins with the session, the enrolment and the hashed address, and passes the feed on', async () => {
    const t = setup(() => FEED);
    const r = await t.send(ASK);
    expect(r).toEqual({ status: 200, body: FEED });
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0][0]).toBe(SQL.bulletins);
    expect(t.calls[0][1].slice(0, 2)).toEqual([PHONE, ME]);
    expect(t.calls[0][1][2]).toMatch(/^[0-9a-f]{64}$/);
    expect(t.calls[0][1]).toHaveLength(3);
    // The log line holds no id, word or address.
    expect(JSON.stringify(t.logs)).not.toMatch(/[0-9a-f]{8}-0000|lab|203\.0/i);
    expect(t.logs).toEqual([{ route: 'bulletins', outcome: 'ok', ms: expect.any(Number) }]);
  });

  it('an empty class answers an empty feed', async () => {
    const t = setup(() => ({ ok: true, bulletins: [], new: [] }));
    expect((await t.send(ASK)).body).toEqual({ ok: true, bulletins: [], new: [] });
  });

  it('a key the database adds at any level, and anything of another student’s, is left behind', async () => {
    const leaky = {
      ...FEED,
      made_up: 'LEAK',
      seen: 18,
      can_see: 26,
      reactions: { got_it: 9 },
      bulletins: FEED.bulletins.map(b => ({
        ...b,
        made_up: 'LEAK',
        // What the teacher's functions answer and a student must never be sent.
        seen: 18,
        can_see: 26,
        reactions: { got_it: 9, done: 3, question: 1 },
        not_seen: [OTHER_KID],
        names: ['Omar'],
        bytes: 812345,
        idempotency_key: B2,
        created_at: AT,
        updated_at: AT,
        shown_again_at: AT,
        visible: true,
        course_id: COURSE,
        files: b.files.map(f => ({ ...f, bytes: 812345, status: 'ready', paths: [page(1)], made_up: 'LEAK' })),
      })),
      new: FEED.new.map(n => ({ ...n, made_up: 'LEAK', others: [OTHER_KID] })),
    };
    const t = setup(() => leaky);
    const r = await t.send(ASK);
    expect(r.body).toEqual(FEED);
    const text = JSON.stringify(r.body);
    for (const gone of ['LEAK', 'made_up', OTHER_KID, 'Omar', 'can_see', '812345', 'shown_again_at', COURSE]) {
      expect(text).not.toContain(gone);
    }
  });

  it('every key at every level is one of the contract’s, in its order', async () => {
    const t = setup(() => FEED);
    const r = await t.send(ASK);
    expect(Object.keys(r.body)).toEqual(SENT.bulletins);
    for (const b of r.body.bulletins) {
      expect(Object.keys(b)).toEqual(SENT.bulletin);
      for (const f of b.files) expect(Object.keys(f).sort()).toEqual([...SENT.file].sort());
    }
    for (const n of r.body.new) expect(Object.keys(n)).toEqual(SENT.fresh);
  });

  it('values are copied only as their kind: an id as an id, a reaction as one of the three words, no object in a scalar', async () => {
    const t = setup(() => ({
      ok: true,
      bulletins: [
        {
          ...BULLETIN,
          id: 'not-an-id',
          assessment_id: { id: AS },
          body: { html: '<b>x</b>' },
          reaction: 'lol',
          files: [{ id: '../x', kind: 'photo', title: ['x'], page_count: 1, position: 1 }, 'a string'],
        },
      ],
      new: [{ enrollment_id: 'x', count: -1 }, { enrollment_id: ME, count: 2.5 }, 'x'],
    }));
    const b = (await t.send(ASK)).body;
    expect(b.bulletins[0]).toMatchObject({ id: null, assessment_id: null, body: null, reaction: null });
    expect(b.bulletins[0].files).toEqual([
      { kind: 'photo', title: null, page_count: 1, position: 1, id: null },
      { id: null },
    ]);
    expect(b.new).toEqual([
      { enrollment_id: null, count: 0 },
      { enrollment_id: ME, count: 0 },
      { enrollment_id: null, count: 0 },
    ]);
  });

  it('more than 100 bulletins is a server error (the database sends the newest 100)', async () => {
    const t = setup(() => ({ ok: true, bulletins: Array.from({ length: 101 }, () => BULLETIN), new: [] }));
    expect(await t.send(ASK)).toEqual({ status: 500, body: { ok: false, error: 'server' } });
  });

  it.each([
    ['no session', { session: undefined }],
    ['a session of the wrong shape', { session: 'a'.repeat(129) }],
    ['a session that is not text', { session: 5 }],
    ['no enrollment id', { enrollment_id: undefined }],
    ['an enrollment id that is not one', { enrollment_id: 'CECE' }],
  ])('%s asks nothing', async (_name, over) => {
    const t = setup(() => FEED);
    expect(await t.send({ ...ASK, ...over })).toEqual({ status: 400, body: { ok: false, error: 'bad_request' } });
    expect(t.calls).toEqual([]);
  });

  it('a refusal passes on by its code alone; one the route does not name is not_found', async () => {
    for (const [error, said] of [
      ['signed_out', 'signed_out'],
      ['not_found', 'not_found'],
      ['closed', 'closed'],
      ['card_stopped', 'card_stopped'],
      ['card_expired', 'card_expired'],
      ['reactions_off', 'not_found'],
      ['not_yours', 'not_found'],
    ]) {
      const t = setup(() => ({ ok: false, error, extra: OTHER_KID }));
      expect((await t.send(ASK)).body).toEqual({ ok: false, error: said });
    }
  });

  it('needs no Storage: with none set up it still answers', async () => {
    const t = setup(() => FEED, { store: null });
    expect((await t.send(ASK)).body).toEqual(FEED);
  });
});

describe('bulletin-seen', () => {
  const ASK = { route: 'bulletin-seen', session: PHONE, enrollment_id: ME, bulletin_ids: [B1, B2] };

  it('sends the ids as one array, the address last; passes on how many were added', async () => {
    const t = setup(() => ({ ok: true, seen: 2, made_up: 'LEAK', others: [OTHER_KID] }));
    const r = await t.send(ASK);
    expect(r).toEqual({ status: 200, body: { ok: true, seen: 2 } });
    expect(t.calls[0][0]).toBe(SQL.bulletinSeen);
    expect(t.calls[0][1].slice(0, 3)).toEqual([PHONE, ME, `{${B1},${B2}}`]);
    expect(t.calls[0][1][3]).toMatch(/^[0-9a-f]{64}$/);
  });

  it('an id in capitals is sent in lower case; an empty list is sent as an empty array; 100 ids are taken', async () => {
    const t = setup(() => ({ ok: true, seen: 0 }));
    await t.send({ ...ASK, bulletin_ids: [B1.toUpperCase()] });
    await t.send({ ...ASK, bulletin_ids: [] });
    const hundred = Array.from({ length: 100 }, (_, i) => `b1b1b1b1-0000-4000-8000-${String(i).padStart(12, '0')}`);
    await t.send({ ...ASK, bulletin_ids: hundred });
    expect(t.calls.map(c => c[1][2])).toEqual([`{${B1}}`, '{}', '{' + hundred.join(',') + '}']);
  });

  it.each([
    ['no list', { bulletin_ids: undefined }],
    ['a list of 101', { bulletin_ids: Array.from({ length: 101 }, () => B1) }],
    ['an id that is not one', { bulletin_ids: [B1, 'x'] }],
    ['a null in the list', { bulletin_ids: [null] }],
    ['an id with a brace', { bulletin_ids: [B1 + '}'] }],
    ['one id, not a list', { bulletin_ids: B1 }],
    ['no session', { session: undefined }],
    ['no enrollment id', { enrollment_id: undefined }],
  ])('%s asks nothing', async (_name, over) => {
    const t = setup(() => ({ ok: true, seen: 0 }));
    expect(await t.send({ ...ASK, ...over })).toEqual({ status: 400, body: { ok: false, error: 'bad_request' } });
    expect(t.calls).toEqual([]);
  });

  it('too_many passes on with its wait; the other refusals by their code', async () => {
    const t = setup(() => ({ ok: false, error: 'too_many', retry_after_s: 1200, card_id: OTHER_KID }));
    expect((await t.send(ASK)).body).toEqual({ ok: false, error: 'too_many', retry_after_s: 1200 });
    for (const [error, said] of [
      ['closed', 'closed'],
      ['signed_out', 'signed_out'],
      ['bad_request', 'bad_request'],
      ['reactions_off', 'not_found'],
    ]) {
      const u = setup(() => ({ ok: false, error }));
      expect((await u.send(ASK)).body).toEqual({ ok: false, error: said });
    }
  });

  it('a count that is not 0 to 100 is sent as 0', async () => {
    const t = setup(() => ({ ok: true, seen: 101 }));
    expect((await t.send(ASK)).body).toEqual({ ok: true, seen: 0 });
  });
});

describe('bulletin-react', () => {
  const ASK = { route: 'bulletin-react', session: PHONE, enrollment_id: ME, bulletin_id: B1, word: 'done' };

  it.each(['got_it', 'done', 'question', null])('word %s: sent as it is, the address last', async word => {
    const t = setup(() => ({ ok: true, reaction: word, made_up: 'LEAK', counts: { done: 3 } }));
    const r = await t.send({ ...ASK, word });
    expect(r).toEqual({ status: 200, body: { ok: true, reaction: word } });
    expect(t.calls[0][0]).toBe(SQL.bulletinReact);
    expect(t.calls[0][1].slice(0, 4)).toEqual([PHONE, ME, B1, word]);
    expect(t.calls[0][1][4]).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([
    ['no word at all (taking back is asked for, never assumed)', { word: undefined }],
    ['another word', { word: 'love' }],
    ['a word in capitals', { word: 'DONE' }],
    ['an empty word', { word: '' }],
    ['a list', { word: ['done'] }],
    ['a number', { word: 1 }],
    ['no bulletin id', { bulletin_id: undefined }],
    ['a bulletin id that is not one', { bulletin_id: 'B1' }],
    ['no session', { session: undefined }],
  ])('%s asks nothing', async (_name, over) => {
    const t = setup(() => ({ ok: true, reaction: null }));
    const body = { ...ASK, ...over };
    if (over.word === undefined && 'word' in over) delete body.word;
    expect(await t.send(body)).toEqual({ status: 400, body: { ok: false, error: 'bad_request' } });
    expect(t.calls).toEqual([]);
  });

  it('reactions_off and too_many pass on; not_found for a bulletin the student may not see', async () => {
    for (const [said, want] of [
      [
        { ok: false, error: 'reactions_off' },
        { ok: false, error: 'reactions_off' },
      ],
      [
        { ok: false, error: 'too_many', retry_after_s: 30 },
        { ok: false, error: 'too_many', retry_after_s: 30 },
      ],
      [
        { ok: false, error: 'not_found' },
        { ok: false, error: 'not_found' },
      ],
      [
        { ok: false, error: 'closed' },
        { ok: false, error: 'closed' },
      ],
      [
        { ok: false, error: 'something_else' },
        { ok: false, error: 'not_found' },
      ],
    ]) {
      const t = setup(() => said);
      expect((await t.send(ASK)).body).toEqual(want);
    }
  });

  it('a reaction the database answers that is not one of the three is sent as null', async () => {
    const t = setup(() => ({ ok: true, reaction: '<b>' }));
    expect((await t.send(ASK)).body).toEqual({ ok: true, reaction: null });
  });
});

describe('bulletin-files', () => {
  const ASK = { route: 'bulletin-files', session: PHONE, enrollment_id: ME, bulletin_file_id: F1 };
  const pdf = (over = {}) => ({
    ok: true,
    bucket: 'bulletin-files',
    file_id: F1,
    bulletin_id: B1,
    kind: 'pdf',
    title: 'Field Trip Form',
    page_count: 3,
    pages: [
      { page: 2, path: page(2) },
      { page: 1, path: page(1) },
      { page: 3, path: page(3) },
    ],
    ...over,
  });

  it('asks bulletin_file_links, then signs each page for 60 seconds in bulletin-files, in page order', async () => {
    const t = setup(() => ({ ...pdf(), made_up: 'LEAK', course_id: COURSE }));
    const r = await t.send(ASK);
    expect(r).toEqual({
      status: 200,
      body: {
        ok: true,
        file_id: F1,
        bulletin_id: B1,
        kind: 'pdf',
        title: 'Field Trip Form',
        page_count: 3,
        pages: [1, 2, 3].map(n => ({ page: n, url: 'https://x.supabase.co/sign/' + page(n) + '?token=t' })),
      },
    });
    expect(Object.keys(r.body)).toEqual(SENT.fileLinks);
    expect(t.calls[0][0]).toBe(SQL.bulletinFiles);
    expect(t.calls[0][1].slice(0, 3)).toEqual([PHONE, ME, F1]);
    expect(t.calls[0][1][3]).toMatch(/^[0-9a-f]{64}$/);
    expect(t.storeCalls).toEqual([['signDownloads', [page(1), page(2), page(3)], 60, 'bulletin-files']]);
    // The phone is given links, never the bucket or a path; the log holds neither.
    expect(JSON.stringify(r.body)).not.toMatch(/"path"|"bucket"|LEAK/);
    expect(JSON.stringify(t.logs)).not.toMatch(/\.jpg|[0-9a-f]{8}-0000/);
  });

  it('a photo: one page', async () => {
    const t = setup(() => pdf({ kind: 'photo', title: 'Photo', page_count: 1, pages: [{ page: 1, path: page(1) }] }));
    expect((await t.send(ASK)).body.pages).toEqual([
      { page: 1, url: 'https://x.supabase.co/sign/' + page(1) + '?token=t' },
    ]);
  });

  it.each([
    ['another file’s page', pdf({ pages: [{ page: 1, path: page(1, COURSE, F2) }], page_count: 1 })],
    ['a file id that is not the one asked for', pdf({ file_id: F2 })],
    [
      'pages of two classes',
      pdf({
        page_count: 2,
        pages: [
          { page: 1, path: page(1) },
          { page: 2, path: page(2, OTHER_COURSE) },
        ],
      }),
    ],
    [
      'a page twice',
      pdf({
        page_count: 2,
        pages: [
          { page: 1, path: page(1) },
          { page: 1, path: page(1) },
        ],
      }),
    ],
    ['a page number that is not its path’s', pdf({ page_count: 1, pages: [{ page: 2, path: page(1) }] })],
    ['a page past the page count', pdf({ page_count: 1, pages: [{ page: 2, path: page(2) }] })],
    ['fewer pages than the page count', pdf({ pages: [{ page: 1, path: page(1) }] })],
    ['page 0', pdf({ page_count: 1, pages: [{ page: 0, path: page(0) }] })],
    ['page 01', pdf({ page_count: 1, pages: [{ page: 1, path: `${COURSE}/${F1}/01.jpg` }] })],
    ['page 21', pdf({ page_count: 21, pages: [{ page: 21, path: page(21) }] })],
    ['a page count of 0', pdf({ page_count: 0, pages: [] })],
    ['a handout page', pdf({ page_count: 1, pages: [{ page: 1, path: `${COURSE}/handouts/${F1}/1.jpg` }] })],
    ['a student’s photo', pdf({ page_count: 1, pages: [{ page: 1, path: `${C1}/${LAB}/${CECE}/${B1}/${F1}.jpg` }] })],
    ['a path out of the folder', pdf({ page_count: 1, pages: [{ page: 1, path: '../' + page(1) }] })],
    ['a path with a query', pdf({ page_count: 1, pages: [{ page: 1, path: page(1) + '?x' }] })],
    ['an upper-case path', pdf({ page_count: 1, pages: [{ page: 1, path: page(1).toUpperCase() }] })],
    ['a png', pdf({ page_count: 1, pages: [{ page: 1, path: page(1).replace('.jpg', '.png') }] })],
    ['the photos bucket', pdf({ bucket: 'student-photos' })],
    ['the handout files bucket', pdf({ bucket: 'handout-files' })],
    ['no bucket', pdf({ bucket: undefined })],
  ])('%s is a server error, and nothing is signed', async (_name, answer) => {
    const t = setup(() => answer);
    expect(await t.send(ASK)).toEqual({ status: 500, body: { ok: false, error: 'server' } });
    expect(t.storeCalls).toEqual([]);
  });

  it.each([
    ['no file id', { bulletin_file_id: undefined }],
    ['a file id that is not one', { bulletin_file_id: '../1.jpg' }],
    ['the file id under another name', { bulletin_file_id: undefined, file_id: F1 }],
    ['no session', { session: undefined }],
    ['no enrollment id', { enrollment_id: undefined }],
  ])('%s asks nothing', async (_name, over) => {
    const t = setup(() => pdf());
    expect(await t.send({ ...ASK, ...over })).toEqual({ status: 400, body: { ok: false, error: 'bad_request' } });
    expect(t.calls).toEqual([]);
  });

  it('a refusal passes on by its code; nothing is signed', async () => {
    for (const [error, said] of [
      ['signed_out', 'signed_out'],
      ['not_found', 'not_found'],
      ['card_expired', 'card_expired'],
      ['too_many', 'not_found'],
    ]) {
      const t = setup(() => ({ ok: false, error, path: page(1) }));
      expect((await t.send(ASK)).body).toEqual({ ok: false, error: said });
      expect(t.storeCalls).toEqual([]);
    }
  });

  it('with no Storage set up, it answers a server error and asks the database nothing', async () => {
    const t = setup(() => pdf(), { store: null });
    expect(await t.send(ASK)).toEqual({ status: 500, body: { ok: false, error: 'server' } });
    expect(t.calls).toEqual([]);
  });
});

describe('the bulletin page path', () => {
  it('is <course>/<file>/<n>.jpg, lower-case ids, n 1 to 20 with no leading zero, and nothing else', () => {
    expect(BULLETIN_BUCKET).toBe('bulletin-files');
    expect(bulletinPathParts(page(1))).toEqual({ course: COURSE, file: F1, page: 1 });
    expect(bulletinPathParts(page(20))).toEqual({ course: COURSE, file: F1, page: 20 });
    for (const n of [10, 11, 19]) expect(bulletinPathParts(page(n))).toMatchObject({ page: n });
    for (const bad of [
      page(0),
      page(21),
      page(100),
      `${COURSE}/${F1}/01.jpg`,
      `${COURSE}/${F1}/1.jpeg`,
      `${COURSE}/${F1}/1.JPG`,
      `${COURSE}/${F1}/1-thumb.jpg`,
      `${COURSE}/${F1}.jpg`,
      `${COURSE}/handouts/${F1}/1.jpg`,
      `${COURSE}/${F1}/x/1.jpg`,
      `${COURSE}/../${F1}/1.jpg`,
      `/${page(1)}`,
      page(1).toUpperCase(),
      page(1) + '?download',
      page(1) + '\n',
      `${C1}/${LAB}/${CECE}/${B1}/${F1}.jpg`,
      `${COURSE}/${F1}.html`,
      null,
      42,
    ]) {
      expect(bulletinPathParts(bad), String(bad)).toBe(null);
    }
    expect(BULLETIN_PATH.source.startsWith('^')).toBe(true);
    // No bulletin page is any other bucket's shape.
    expect(pathParts(page(1))).toBe(null);
    expect(handoutPathParts(page(1))).toBe(null);
    expect(handoutFilePathParts(page(1))).toBe(null);
  });

  const json = (status, body) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fake = answer => {
    const sent = [];
    return {
      sent,
      fetcher: async (url, init) => (sent.push({ url, method: init.method, body: init.body }), answer(url, init)),
    };
  };

  it('signDownloads and remove take one in bulletin-files, by that bucket’s address', async () => {
    const f = fake((url, init) =>
      init.method === 'POST' && /object\/sign\/bulletin-files$/.test(url)
        ? json(
            200,
            JSON.parse(init.body).paths.map(p => ({ path: p, signedURL: `/object/sign/bulletin-files/${p}?t=1` })),
          )
        : json(200, []),
    );
    const store = storageRest(f.fetcher, 'https://proj.supabase.co/', 'k');
    expect(await store.signDownloads([page(1)], 60, BULLETIN_BUCKET)).toEqual({
      [page(1)]: `https://proj.supabase.co/storage/v1/object/sign/bulletin-files/${page(1)}?t=1`,
    });
    expect(f.sent[0]).toMatchObject({
      url: 'https://proj.supabase.co/storage/v1/object/sign/bulletin-files',
      body: JSON.stringify({ expiresIn: 60, paths: [page(1)] }),
    });
    await store.remove([page(1), page(2)], BULLETIN_BUCKET);
    expect(f.sent[1]).toMatchObject({
      url: 'https://proj.supabase.co/storage/v1/object/bulletin-files',
      method: 'DELETE',
      body: JSON.stringify({ prefixes: [page(1), page(2)] }),
    });
  });

  it('a bulletin page is never taken in another bucket, and another bucket’s shape never in bulletin-files', async () => {
    const f = fake(() => json(200, []));
    const store = storageRest(f.fetcher, 'https://proj.supabase.co/', 'k');
    for (const step of [
      () => store.signDownloads([page(1)], 60),
      () => store.remove([page(1)]),
      () => store.signDownloads([page(1)], 60, 'handout-files'),
      () => store.remove([page(1)], 'handout-files'),
      () => store.signDownloads([`${C1}/${LAB}/${CECE}/${B1}/${F1}.jpg`], 60, BULLETIN_BUCKET),
      () => store.remove([`${COURSE}/handouts/${F1}/1.jpg`], BULLETIN_BUCKET),
      () => store.remove([`${COURSE}/${F1}.html`], BULLETIN_BUCKET),
      () => store.remove([page(21)], BULLETIN_BUCKET),
      () => store.signUpload(page(1)),
      () => store.read(page(1), 10),
      () => store.overwrite(page(1), new Uint8Array(1)),
    ]) {
      await expect(step()).rejects.toThrow('storage path');
    }
    expect(f.sent).toEqual([]);
  });
});

describe('the removal worker and bulletin-files', () => {
  const SECRET = '5e'.repeat(32); // a test value
  const R = 'a2a2a2a2-0000-4000-8000-000000000002';
  const REQ = '0f0f0f0f-0000-4000-8000-000000000001';
  const PHOTO = `${C1}/${LAB}/${CECE}/${REQ}/${F1}.jpg`;
  const HANDOUT = `${C1}/handouts/${R}/1.jpg`;
  const HFILE = `${C1}/${R}.epub`;

  function sweep(items) {
    const world = fakeWorld();
    const logs = [];
    world.override.removal_batch = () => ({ ok: true, items, left: 0 });
    const handle = makeHandler({
      region: 'ca-central-1',
      ipKey: 'test-key',
      db: {
        check: async () => ({}),
        submit: async () => ({}),
        call: world.db.call,
      },
      store: world.store,
      whoIs: null,
      log: e => logs.push(e),
      sweepSecret: SECRET,
    });
    return handle(
      new Request(URL_, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ route: 'scheduled-sweep', secret: SECRET }),
      }),
    ).then(() => ({ world, logs }));
  }
  const removes = world => world.storeCalls.filter(c => c[0] === 'remove');
  const dones = world => world.calls.filter(c => c[0] === 'removal_done').map(c => c[1]);

  it('deletes a matching bulletin page from bulletin-files, after the other two buckets, and reports it done', async () => {
    const { world, logs } = await sweep([
      { id: 1, bucket: 'student-photos', path: PHOTO },
      { id: 2, bucket: 'bulletin-files', path: page(1) },
      { id: 3, bucket: 'handout-files', path: HFILE },
      { id: 4, bucket: 'bulletin-files', path: page(20, OTHER_COURSE, F2) },
      { id: 5, bucket: 'student-photos', path: HANDOUT },
    ]);
    expect(removes(world)).toEqual([
      ['remove', [PHOTO, HANDOUT]],
      ['remove', [HFILE], 'handout-files'],
      ['remove', [page(1), page(20, OTHER_COURSE, F2)], 'bulletin-files'],
    ]);
    expect(dones(world)).toEqual([['{1,5}'], ['{3}'], ['{2,4}']]);
    expect(logs).toContainEqual(expect.objectContaining({ route: 'scheduled-sweep', worker: 'ran', skipped: 0 }));
  });

  it('a path that does not match, or a bulletin page in another bucket, is not deleted and stays queued (skipped)', async () => {
    const { world, logs } = await sweep([
      { id: 1, bucket: 'bulletin-files', path: page(21) },
      { id: 2, bucket: 'bulletin-files', path: `${COURSE}/${F1}/01.jpg` },
      { id: 3, bucket: 'bulletin-files', path: `${COURSE}/../${F1}/1.jpg` },
      { id: 4, bucket: 'bulletin-files', path: PHOTO },
      { id: 5, bucket: 'bulletin-files', path: HANDOUT },
      { id: 6, bucket: 'bulletin-files', path: HFILE },
      { id: 7, bucket: 'student-photos', path: page(1) },
      { id: 8, bucket: 'handout-files', path: page(1) },
      { id: 9, bucket: 'Bulletin-Files', path: page(1) },
      { id: '10; drop', bucket: 'bulletin-files', path: page(2) },
      { id: 11, bucket: 'bulletin-files', path: null },
    ]);
    expect(removes(world)).toEqual([]);
    expect(dones(world)).toEqual([]);
    expect(logs).toContainEqual({ route: 'scheduled-sweep', worker: 'ran', removed: 0, skipped: 11, left: 0 });
  });

  it('a failure in bulletin-files strands none of the photos or handout files already deleted', async () => {
    const world = fakeWorld();
    world.override.removal_batch = () => ({
      ok: true,
      items: [
        { id: 1, bucket: 'student-photos', path: PHOTO },
        { id: 2, bucket: 'handout-files', path: HFILE },
        { id: 3, bucket: 'bulletin-files', path: page(1) },
      ],
      left: 0,
    });
    const remove = world.store.remove;
    world.store.remove = async (paths, bucket) => {
      if (bucket === 'bulletin-files') throw Object.assign(new Error('storage remove 503'), { name: 'StorageError' });
      return remove(paths, bucket);
    };
    const logs = [];
    const handle = makeHandler({
      region: 'ca-central-1',
      ipKey: 'test-key',
      db: {
        check: async () => ({}),
        submit: async () => ({}),
        call: world.db.call,
      },
      store: world.store,
      log: e => logs.push(e),
      sweepSecret: SECRET,
    });
    await handle(
      new Request(URL_, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ route: 'scheduled-sweep', secret: SECRET }),
      }),
    );
    expect(dones(world)).toEqual([['{1}'], ['{2}']]);
    expect(logs).toContainEqual(expect.objectContaining({ worker: 'error', kind: 'StorageError' }));
  });

  it('with no bulletin page queued, every other bucket and path is handled exactly as before', async () => {
    const { world, logs } = await sweep([
      { id: 11, bucket: 'student-photos', path: PHOTO },
      { id: 12, bucket: 'handout-files', path: HFILE },
      { id: 13, bucket: 'student-photos', path: HFILE },
      { id: 14, bucket: 'handout-files', path: PHOTO },
      { id: 15, bucket: 'handout-files', path: `${C1}/${R}.exe` },
      { id: 16, bucket: 'other', path: PHOTO },
    ]);
    expect(removes(world)).toEqual([
      ['remove', [PHOTO]],
      ['remove', [HFILE], 'handout-files'],
    ]);
    expect(dones(world)).toEqual([['{11}'], ['{12}']]);
    expect(logs).toContainEqual(expect.objectContaining({ worker: 'ran', skipped: 4 }));
  });
});
