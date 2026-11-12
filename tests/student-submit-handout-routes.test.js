/**
 * Handouts and Links through the student-submit edge function
 * (supabase/functions/student-submit/handout-routes.ts and card-routes.ts),
 * with a stand-in database and Storage.
 *
 * - handout-links: the session and the request's shape first, the hashed
 *   address last; student_submit.handout_links names the page paths and
 *   each is signed for 60 seconds, only after its parts are checked to be
 *   this handout's (the handouts folder, this resource, pages 1 to 20, each
 *   once, one class); a refusal passes on by its code.
 * - page: assessments[].resources is copied only where the database sent
 *   it, and only as the contract types it: a link is an http(s) address.
 */
import { describe, expect, it } from 'vitest';
import { makeHandler } from '../supabase/functions/student-submit/handler.ts';
import { SQL } from '../supabase/functions/student-submit/handout-routes.ts';
import { CARD_ROUTES, cardReply } from '../supabase/functions/student-submit/card-routes.ts';

const URL_ = 'https://x.supabase.co/functions/v1/student-submit?forceFunctionRegion=ca-central-1';
const PHONE = 's'.repeat(64);
const CECE = 'e1e1e1e1-0000-4000-8000-000000000001';
const COURSE = 'c1c1c1c1-0000-4000-8000-000000000001';
const OTHER = 'c2c2c2c2-0000-4000-8000-000000000002';
const RES = 'a1a1a1a1-0000-4000-8000-000000000001';
const RES2 = 'a2a2a2a2-0000-4000-8000-000000000002';
const LAB = 'b1b1b1b1-0000-4000-8000-000000000001';
const path = (n, course = COURSE, res = RES) => `${course}/handouts/${res}/${n}.jpg`;

function setup(answer) {
  const calls = [];
  const storeCalls = [];
  const logs = [];
  const handle = makeHandler({
    region: 'ca-central-1',
    ipKey: 'k',
    db: {
      open: async () => ({}),
      verify: async () => ({}),
      check: async () => ({}),
      submit: async () => ({}),
      call: async (sql, params) => {
        calls.push([sql, params]);
        if (sql !== SQL.handoutLinks) throw new Error('unknown statement');
        return answer(params);
      },
    },
    store: {
      signUpload: async () => 'x',
      read: async () => 'missing',
      remove: async () => {},
      signDownloads: async (paths, seconds) => {
        storeCalls.push(['signDownloads', paths, seconds]);
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

const ASK = { route: 'handout-links', session: PHONE, enrollment_id: CECE, resource_id: RES };
const three = () => ({
  ok: true,
  bucket: 'student-photos',
  pages: [
    { page: 2, path: path(2) },
    { page: 1, path: path(1) },
    { page: 3, path: path(3) },
  ],
});

describe('handout-links', () => {
  it('signs each page the database named for 60 seconds, in page order, with the address hashed last', async () => {
    const t = setup(three);
    const r = await t.send(ASK);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      ok: true,
      pages: [1, 2, 3].map(n => ({ page: n, url: 'https://x.supabase.co/sign/' + path(n) + '?token=t' })),
    });
    expect(t.calls).toHaveLength(1);
    const [, params] = t.calls[0];
    expect(params.slice(0, 3)).toEqual([PHONE, CECE, RES]);
    expect(params[3]).toMatch(/^[0-9a-f]{64}$/);
    expect(t.storeCalls).toEqual([['signDownloads', [path(1), path(2), path(3)], 60]]);
    // The log line holds no id, path or link.
    expect(JSON.stringify(t.logs)).not.toMatch(/handouts|[0-9a-f]{8}-0000/);
  });

  it.each([
    ['no session', { session: undefined }],
    ['a session of the wrong shape', { session: 'a'.repeat(129) }],
    ['no enrollment id', { enrollment_id: undefined }],
    ['an enrollment id that is not one', { enrollment_id: 'CECE' }],
    ['no resource id', { resource_id: undefined }],
    ['a resource id that is not one', { resource_id: '../1.jpg' }],
  ])('%s asks nothing', async (_name, over) => {
    const t = setup(three);
    const r = await t.send({ ...ASK, ...over });
    expect(r).toEqual({ status: 400, body: { ok: false, error: 'bad_request' } });
    expect(t.calls).toEqual([]);
  });

  it('a refusal passes on by its code; one the route does not name is not_found; nothing is signed', async () => {
    for (const [error, said] of [
      ['signed_out', 'signed_out'],
      ['card_expired', 'card_expired'],
      ['not_found', 'not_found'],
      ['not_yours', 'not_found'],
    ]) {
      const t = setup(() => ({ ok: false, error, extra: 'x' }));
      expect((await t.send(ASK)).body).toEqual({ ok: false, error: said });
      expect(t.storeCalls).toEqual([]);
    }
  });

  it('a handout with no pages ready signs nothing', async () => {
    const t = setup(() => ({ ok: true, pages: [] }));
    expect((await t.send(ASK)).body).toEqual({ ok: true, pages: [] });
    expect(t.storeCalls).toEqual([]);
  });

  it.each([
    ['another handout', () => ({ ok: true, pages: [{ page: 1, path: path(1, COURSE, RES2) }] })],
    [
      'two classes',
      () => ({
        ok: true,
        pages: [
          { page: 1, path: path(1) },
          { page: 2, path: path(2, OTHER) },
        ],
      }),
    ],
    [
      'a page twice',
      () => ({
        ok: true,
        pages: [
          { page: 1, path: path(1) },
          { page: 1, path: path(1) },
        ],
      }),
    ],
    ['a page number that is not its path’s', () => ({ ok: true, pages: [{ page: 2, path: path(1) }] })],
    [
      'a student’s photo',
      () => ({ ok: true, pages: [{ page: 1, path: [COURSE, LAB, CECE, RES, RES2].join('/') + '.jpg' }] }),
    ],
    ['a path out of the folder', () => ({ ok: true, pages: [{ page: 1, path: '../' + path(1) }] })],
    ['page 21', () => ({ ok: true, pages: [{ page: 21, path: path(21) }] })],
    ['another bucket', () => ({ ...three(), bucket: 'public' })],
    [
      'more than 20 pages',
      () => ({
        ok: true,
        pages: Array.from({ length: 21 }, (_, i) => ({ path: path(i + 1).replace('21.jpg', '0.jpg') })),
      }),
    ],
  ])('%s is a server error, and nothing is signed', async (_name, answer) => {
    const t = setup(answer);
    const r = await t.send(ASK);
    expect(r).toEqual({ status: 500, body: { ok: false, error: 'server' } });
    expect(t.storeCalls).toEqual([]);
  });

  it('with no Storage set up, it answers a server error and asks the database nothing', async () => {
    const calls = [];
    const handle = makeHandler({
      region: 'ca-central-1',
      ipKey: 'k',
      db: {
        call: async (sql, params) => {
          calls.push(params);
          return three();
        },
      },
      log: () => {},
    });
    const res = await handle(
      new Request(URL_, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(ASK) }),
    );
    expect(res.status).toBe(500);
    expect(calls).toEqual([]);
  });
});

describe('the page’s assessments[].resources', () => {
  const A = {
    id: LAB,
    title: 'Density Lab Write-Up',
    date: '2026-11-11',
    due_date: '2026-11-18',
    tag_ids: [],
    status: null,
    returned_at: null,
  };
  const page = assessments => ({
    ok: true,
    v: 1,
    student: { enrollment_id: CECE, first_name: 'Cece' },
    course: { name: 'Science 8', block: 'A', grading_system: 'proficiency' },
    classes: [],
    tags: {},
    rubrics: [],
    assessments,
  });

  it('is left out where the database does not send it', () => {
    const out = cardReply(CARD_ROUTES.page, page([A]));
    expect('resources' in out.assessments[0]).toBe(false);
  });

  it('copies a handout and links as the contract types them, and nothing else', () => {
    const out = cardReply(
      CARD_ROUTES.page,
      page([
        {
          ...A,
          resources: [
            {
              id: RES,
              kind: 'pdf',
              title: 'Density Lab Instructions',
              url: null,
              page_count: 3,
              path: 'x',
              status: 'ready',
            },
            {
              id: RES2,
              kind: 'link',
              title: 'Density',
              url: 'https://www.britannica.com/science/density',
              page_count: null,
            },
            { id: 'a3a3a3a3-0000-4000-8000-000000000003', kind: 'link', title: 'Bad', url: 'javascript:alert(1)' },
            { id: 'a4a4a4a4-0000-4000-8000-000000000004', kind: 'link', title: 'Bad', url: 'https://x.ca/"><b>' },
            { id: 'a5a5a5a5-0000-4000-8000-000000000005', kind: 'pdf', title: 'Long', page_count: 21 },
            { id: 'not-an-id', kind: 'link', title: 'Bad', url: 'https://x.ca' },
            { id: 'a6a6a6a6-0000-4000-8000-000000000006', kind: 'video', title: 'Bad', url: 'https://x.ca' },
            { id: 'a7a7a7a7-0000-4000-8000-000000000007', kind: 'link', title: '', url: 'https://x.ca' },
            'a string',
          ],
        },
      ]),
    );
    expect(out.assessments[0].resources).toEqual([
      { id: RES, kind: 'pdf', title: 'Density Lab Instructions', url: null, page_count: 3 },
      { id: RES2, kind: 'link', title: 'Density', url: 'https://www.britannica.com/science/density', page_count: null },
    ]);
  });

  it('a value that is not a list is sent as none', () => {
    const out = cardReply(CARD_ROUTES.page, page([{ ...A, resources: { id: RES } }]));
    expect(out.assessments[0].resources).toEqual([]);
  });
});
