/**
 * Revisions and group work from a real card (S11-W1, S12-W1; s/feedback.js
 * and s/send.js, with s/app.js's CLASS_ROUTES), against the routes as
 * phase2-routes-contract.md writes them: `feedback`'s `revision`, then
 * revise-start, each page to its link, revise-finish and revise-unsend;
 * `group-work` once `feedback` has answered, and `group-links` for a group
 * piece's pages.
 *
 * The page runs as a browser loads it against the function's real handler
 * and routes over the stand-in database and bucket
 * (tests/helpers/fake-student-submit.js with fake-send-world.js): every
 * page is read and checked by the route before it is handed in.
 *
 * - Needs Revision shows What to Fix and the first version's pages.
 * - Send My Revision uses the revise-* routes, with a request id of its
 *   own and no plan; Unsend My Revision is revise-unsend.
 * - "Your teacher changed what to fix" starts again with a new request id.
 * - A returned revision opens Before and After with both versions' pages.
 * - A group piece shows the group's counts and Add a Page; See Your Work
 *   on a group piece asks `group-links`.
 * - A class with no revision and no group piece asks nothing more and is
 *   drawn exactly as when the function has none of these routes.
 * - Nothing outlasts the session.
 */
import { describe, expect, it } from 'vitest';
import { openStudentPage } from './helpers/student-page-context.js';
import { CECE, CRITERIA, OMAR, WORK, fakeStudentSubmit, sampleCard } from './helpers/fake-student-submit.js';
import { C1, PAGE_JPEG, THUMB_JPEG } from './helpers/fake-send-world.js';

const TODAY = new Date().toISOString().slice(0, 10);
const KEY = 'fv-s-session';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const words = el => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);
const text = (page, sel) => words(page.root().querySelector(sel));
const routes = page => page.calls.map(c => c.body.route);
const bodyOf = (page, route) => page.calls.filter(c => c.body.route === route).map(c => c.body);
const piece = id => '.sp-piece[data-piece="' + id + '"]';
const viewOf = page => page.T.viewOf(page.T.state());
const pieceIn = (page, id) => viewOf(page).work.find(p => p.id === id);

function memoryStore() {
  const rows = new Map();
  return {
    rows,
    list: async () => [...rows.values()].map(r => JSON.parse(JSON.stringify(r.meta))),
    putAll: async items =>
      items.forEach(i => rows.set(i.meta.id, { meta: { ...i.meta }, photo: i.photo, thumb: i.thumb })),
    update: async (id, patch) => {
      if (rows.has(id)) Object.assign(rows.get(id).meta, patch);
    },
    blobs: async id => (rows.has(id) ? { photo: rows.get(id).photo, thumb: rows.get(id).thumb } : null),
    remove: async ids => ids.forEach(id => rows.delete(id)),
    clear: async () => rows.clear(),
  };
}
const page1 = () => ({
  blob: { size: PAGE_JPEG.length, bytes: PAGE_JPEG },
  thumb: { size: THUMB_JPEG.length, bytes: THUMB_JPEG },
  hash: 'h',
  width: 900,
  height: 1200,
});
const prepare = () => Promise.resolve({ ok: true, kind: 'jpeg', pages: [page1()] });

// A send handed in, in the send world, with its pages in the bucket: a first version, a revision or a group-mate's.
let made = 0;
function handIn(world, assessment, enrollment, version) {
  made += 1;
  const n = String(made).padStart(4, '0');
  const id = `5a${n}00-0000-4000-8000-000000000000`;
  const file = `f1${n}00-0000-4000-8000-000000000000`;
  const base = `${C1}/${assessment}/${enrollment}/${id}/${file}`;
  world.subs.set(id, {
    id,
    course: C1,
    assessment,
    enrollment,
    state: 'sent',
    intent: 'new',
    sent_by: 'student',
    request_id: `9e${n}00-0000-4000-8000-000000000000`,
    note: null,
    version,
    sent_at: '2026-11-01T19:00:00+00:00',
    files: [{ id: file, page: 1, path: base + '.jpg', thumb_path: base + '-thumb.jpg', added_by: 'student' }],
  });
  for (const p of [base + '.jpg', base + '-thumb.jpg']) {
    world.objects.set(p, { bytes: PAGE_JPEG, type: 'image/jpeg', cache: 'private' });
  }
  return id;
}

function revision(extra) {
  return Object.assign(
    {
      state: 'open',
      what_to_fix: 'Write the magnification beside each drawing, then send it again.',
      revise_by: TODAY,
      criterion_ids: [CRITERIA.drawing],
      keep_grade: true,
      grade_hidden: false,
      first_version: 1,
      first_sent_at: '2026-11-01T19:00:00+00:00',
      first_grade: null,
      revision_version: null,
      revision_sent_at: null,
      revision_note: null,
      revision_late: null,
      asked_at: '2026-11-10T18:00:00+00:00',
    },
    extra,
  );
}
const feedbackWith = assessments => ({
  ok: true,
  v: 1,
  reflect_on_feedback: false,
  show_my_learning: false,
  assessments,
  last_plan: null,
});

function school(more) {
  const fn = fakeStudentSubmit({
    cards: [sampleCard(TODAY)],
    sendWork: {
      [WORK.fair]: { students_send: 'photos', open: true },
      [WORK.lab]: { students_send: 'photos', open: true },
      [WORK.energy]: { students_send: 'photos', open: true },
    },
    ...more,
  });
  const dev = { fn, store: {}, kept: memoryStore(), answer: null };
  dev.open = async hash => {
    const page = openStudentPage({ store: dev.store, objectUrls: true });
    page.server = body => (dev.answer && dev.answer(body)) || fn.handle(body);
    page.storage = async (url, init) => {
      if (init.method === 'PUT')
        return { status: fn.world.phoneUpload(url, init.body.bytes, init.headers['Content-Type']) };
      const got = fn.world.phoneDownload(url);
      return { status: got.status, blob: got.bytes && { size: got.bytes.length } };
    };
    page.T.setSendStore(dev.kept);
    page.T.setPrepare(prepare);
    await page.start(hash);
    return page;
  };
  return dev;
}
async function signIn(dev) {
  const page = await dev.open('#P3R8-WDK4');
  page.type('#sp-ident', '0123456');
  await page.click('[data-act="card-yes"]');
  await page.settle();
  return page;
}
async function sendOne(page, act, id, note) {
  await page.click(piece(id) + ' [data-act="' + act + '"]');
  await page.T.sendFiles([{}], -1);
  await page.settle();
  if (note) page.type('#sp-send-note', note);
  await page.click('[data-act="send-go"]');
  await page.settle();
}

describe('nothing to show: no new read, and the page as it was drawn', () => {
  it('no revision and no group piece asks nothing past `group-work`, drawn as with a function from before these routes', async () => {
    const none = school();
    const page = await signIn(none);
    expect(routes(page)).toEqual(['card', 'verify', 'page', 'work', 'forms', 'feedback', 'group-work']);
    expect(page.storageCalls).toEqual([]);

    const old = school();
    old.answer = body => (['feedback', 'group-work'].includes(body.route) ? { ok: false, error: 'bad_request' } : null);
    const before = await signIn(old);
    // A function without Batch C's routes is asked `feedback` once and nothing more.
    expect(routes(before)).toEqual(['card', 'verify', 'page', 'work', 'forms', 'feedback']);
    expect(before.root().innerHTML).toBe(page.root().innerHTML);
    expect(page.T.groupOf(page.T.state())).toBeNull();
  });
});

describe('a revision asked for (S11-W1)', () => {
  it('Needs Revision shows What to Fix, the criterion, and the first version from file-links', async () => {
    const dev = school();
    handIn(dev.fn.world, WORK.lab, CECE, 1);
    dev.fn.state.feedback = feedbackWith([{ id: WORK.lab, marks: null, revision: revision(), reflection: null }]);
    const page = await signIn(dev);
    expect(routes(page)).toEqual(['card', 'verify', 'page', 'work', 'forms', 'feedback', 'group-work', 'file-links']);
    expect(bodyOf(page, 'file-links')[0]).toMatchObject({ enrollment_id: CECE, assessment_id: WORK.lab });
    expect(pieceIn(page, WORK.lab).kind).toBe('revise');
    const card = piece(WORK.lab);
    expect(text(page, card + ' .sp-revise-fix')).toBe(
      'Write the magnification beside each drawing, then send it again.',
    );
    expect(text(page, card + ' .sp-revise-crit-name')).toBe('Labelled Drawing');
    expect(
      page
        .root()
        .querySelector(card + ' .sp-send-thumb')
        .getAttribute('src'),
    ).toMatch(/^blob:/);
    expect(page.root().querySelector(card + ' [data-act="revise-open"]')).toBeTruthy();
  });

  it('Send My Revision: revise-start with its own request id and no plan, the uploads, revise-finish; then Unsend', async () => {
    const dev = school();
    handIn(dev.fn.world, WORK.lab, CECE, 1);
    dev.fn.state.feedback = feedbackWith([{ id: WORK.lab, marks: null, revision: revision(), reflection: null }]);
    const page = await signIn(dev);
    const token = JSON.parse(dev.store[KEY]).t;
    await sendOne(page, 'revise-open', WORK.lab, 'I added the magnification.');
    expect(text(page, '#sp-send-title')).toBe('Sent to Your Teacher');

    const [start] = bodyOf(page, 'revise-start');
    expect(start).toEqual({
      route: 'revise-start',
      assessment_id: WORK.lab,
      request_id: expect.stringMatching(UUID),
      pages: [{ width: 900, height: 1200, bytes: PAGE_JPEG.length, thumb_bytes: THUMB_JPEG.length }],
      note: 'I added the magnification.',
      session: token,
      enrollment_id: CECE,
    });
    expect(bodyOf(page, 'send-start')).toEqual([]);
    const sub = [...dev.fn.world.subs.values()].find(s => s.version === 2);
    expect(sub).toMatchObject({ state: 'sent', note: 'I added the magnification.', request_id: start.request_id });
    expect(bodyOf(page, 'revise-finish')).toEqual([
      {
        route: 'revise-finish',
        submission_id: sub.id,
        files: sub.files.map(f => f.id),
        session: token,
        enrollment_id: CECE,
      },
    ]);
    expect(routes(page).slice(routes(page).indexOf('revise-start'))).toEqual([
      'revise-start',
      'revise-finish',
      'work',
      'feedback',
      'file-links',
    ]);
    expect(dev.kept.rows.size).toBe(0);

    await page.click('[data-act="send-done"]');
    await page.settle();
    expect(pieceIn(page, WORK.lab).kind).toBe('sent');
    expect(pieceIn(page, WORK.lab).revision).toMatchObject({ state: 'sent', note: 'I added the magnification.' });
    await page.click('[data-segment="sent"]');
    expect(
      page
        .root()
        .querySelector(piece(WORK.lab) + ' .sp-send-thumb')
        .getAttribute('src'),
    ).toMatch(/^blob:/);

    await page.click(piece(WORK.lab) + ' [data-act="send-unsend"]');
    await page.click('[data-act="send-ask-yes"]');
    await page.settle();
    expect(bodyOf(page, 'revise-unsend')).toEqual([
      { route: 'revise-unsend', assessment_id: WORK.lab, session: token, enrollment_id: CECE },
    ]);
    expect(bodyOf(page, 'unsend')).toEqual([]);
    expect([...dev.fn.world.subs.values()].filter(s => s.version === 2)).toEqual([]);
    expect(pieceIn(page, WORK.lab).kind).toBe('revise');
  });

  it('the teacher changed what to fix while the pages went up: the words say so, and the next press is a new request', async () => {
    const dev = school();
    handIn(dev.fn.world, WORK.lab, CECE, 1);
    dev.fn.state.feedback = feedbackWith([{ id: WORK.lab, marks: null, revision: revision(), reflection: null }]);
    dev.fn.state.refuse = { revision_finish: 'request_changed' };
    const page = await signIn(dev);
    await sendOne(page, 'revise-open', WORK.lab);
    expect(text(page, '.sp-send-msg')).toBe(
      'Your teacher changed what to fix. Read it again, then send your revision.',
    );
    // The pages were dropped by the server: `feedback` is asked again for what to fix now.
    expect(routes(page).filter(r => r === 'feedback')).toHaveLength(2);
    dev.fn.state.refuse = null;
    await page.click('[data-act="send-go"]');
    await page.settle();
    expect(text(page, '#sp-send-title')).toBe('Sent to Your Teacher');
    const [first, second] = bodyOf(page, 'revise-start');
    expect(second.request_id).not.toBe(first.request_id);
  });

  it('a returned revision opens Before and After with both versions’ pages', async () => {
    const dev = school();
    handIn(dev.fn.world, WORK.lab, CECE, 1);
    handIn(dev.fn.world, WORK.lab, CECE, 2);
    const firstGrade = {
      v: 1,
      value: null,
      modifier: 0,
      comment: null,
      tags: {},
      criteria: {
        [CRITERIA.method]: { value: 3, modifier: 0, comment: null, beyond: null },
        [CRITERIA.drawing]: { value: 2, modifier: 0, comment: null, beyond: null },
      },
      checks: [],
    };
    dev.fn.state.feedback = feedbackWith([
      {
        id: WORK.lab,
        marks: null,
        reflection: null,
        revision: revision({
          state: 'returned',
          first_grade: firstGrade,
          revision_version: 2,
          revision_sent_at: '2026-11-08T19:00:00+00:00',
          revision_note: 'I added the magnification.',
          revision_late: false,
        }),
      },
    ]);
    const page = await signIn(dev);
    await page.click('[data-segment="back"]');
    await page.click(piece(WORK.lab) + ' [data-act="compare"]');
    expect(text(page, '.sp-ba-title')).toBe('Before and After');
    const photos = [...page.root().querySelectorAll('.sp-ba-photo')].map(img => img.getAttribute('src'));
    expect(photos).toHaveLength(2);
    photos.forEach(src => expect(src).toMatch(/^blob:/));
    expect(photos[0]).not.toBe(photos[1]);
    expect(text(page, '.sp-ba-did .sp-ba-words')).toBe('I added the magnification.');
  });
});

describe('group work (S12-W1)', () => {
  const group = (id, more) => ({
    ok: true,
    assessments: [
      Object.assign(
        { id, members: 3, sent: true, pages: 1, you_sent: false, first_sent_at: '2026-11-10T19:00:00+00:00' },
        more,
      ),
    ],
  });

  it('`group-work` names the student; the group card shows the counts and Add a Page, which sends and asks again', async () => {
    const dev = school();
    handIn(dev.fn.world, WORK.fair, OMAR, 1);
    dev.fn.state.groupWork = group(WORK.fair);
    const page = await signIn(dev);
    const token = JSON.parse(dev.store[KEY]).t;
    expect(bodyOf(page, 'group-work')).toEqual([{ route: 'group-work', session: token, enrollment_id: CECE }]);
    await page.click('[data-segment="sent"]');
    const card = piece(WORK.fair);
    expect(text(page, card + ' .sp-group-line')).toBe('3 in your group. Someone in your group sent it.');
    expect(page.root().querySelector(card + ' [data-act="send-open"]').textContent).toBe('Add a Page');

    dev.fn.state.groupWork = group(WORK.fair, { pages: 2, you_sent: true });
    await sendOne(page, 'send-open', WORK.fair);
    expect(text(page, '#sp-send-title')).toBe('Sent to Your Teacher');
    expect(bodyOf(page, 'send-start')).toHaveLength(1);
    expect(bodyOf(page, 'group-work')).toHaveLength(2);
    await page.click('[data-act="send-done"]');
    await page.settle();
    expect(pieceIn(page, WORK.fair).group).toMatchObject({ pages: 2, youSent: true });
  });

  it('See Your Work on a group piece shows the group’s pages through `group-links`', async () => {
    const dev = school();
    handIn(dev.fn.world, WORK.energy, OMAR, 1);
    dev.fn.state.groupWork = group(WORK.energy);
    dev.fn.state.feedback = feedbackWith([
      { id: WORK.energy, marks: { pages: 1, notes: 0 }, revision: null, reflection: null },
    ]);
    const page = await signIn(dev);
    await page.click('[data-segment="back"]');
    await page.click(piece(WORK.energy) + ' [data-act="feedback"]');
    await page.click('[data-act="work"]');
    await page.settle();
    expect(bodyOf(page, 'group-links')).toEqual([
      expect.objectContaining({ route: 'group-links', assessment_id: WORK.energy, enrollment_id: CECE }),
    ]);
    expect(bodyOf(page, 'file-links')).toEqual([]);
    expect(page.T.state().workPages).toMatchObject({ id: WORK.energy, state: 'ready' });
    expect(page.T.state().workPages.pages).toHaveLength(1);
  });
});

describe('nothing outlasts the session', () => {
  it('Done drops the group counts and the revision’s pages', async () => {
    const dev = school();
    handIn(dev.fn.world, WORK.lab, CECE, 1);
    dev.fn.state.feedback = feedbackWith([{ id: WORK.lab, marks: null, revision: revision(), reflection: null }]);
    dev.fn.state.groupWork = notSentYet();
    const page = await signIn(dev);
    expect(page.T.groupOf(page.T.state())).not.toBeNull();
    expect(page.T.state().realRevisionPages).not.toBeNull();
    await page.click('[data-act="card-done"]');
    const s = page.T.state();
    expect(s.realGroups || null).toBeNull();
    expect(s.realRevisionPages || null).toBeNull();
    expect(page.T.groupOf(s)).toBeNull();
    expect(page.T.feedbackOf(s)).toBeNull();
  });
});

function notSentYet() {
  return {
    ok: true,
    assessments: [{ id: WORK.fair, members: 2, sent: false, pages: 0, you_sent: false, first_sent_at: null }],
  };
}
