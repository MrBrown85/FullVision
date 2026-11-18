/**
 * Bulletins' data layer (shared/data-bulletins.js, slice B1c).
 *
 * Demo Mode keeps bulletins on the device and never calls the server. A
 * signed-in class is tested against stand-in answers for the functions in
 * migrations/local-test/bulletins-contract.md (the database does not have
 * them yet): a post that waits with no connection and lands once, a refusal,
 * a server without the function, a late answer for another class, and a file's
 * upload, finish, missing pages and gone upload.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'vm';
import { U, clearClass, seedClass, settle, signIn } from './helpers/pin-save-paths.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
for (const file of ['shared/offline-queue.js', 'shared/build-flags.js']) {
  runInThisContext(readFileSync(resolve(root, file), 'utf-8'), { filename: file });
}

const REAL = U(901);
const STUDENTS = ['s1', 's2', 's3', 's4', 's5'].map((id, i) => ({
  id,
  firstName: ['Ana', 'Ben', 'Cy', 'Dee', 'Eli'][i],
  lastName: 'Test',
}));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ON = { student_page_enabled: true, return_grades: 'on_return' };

/* tests/setup.js's document is a stub with no events: a small one here. */
const heard = {};
document.addEventListener = (type, fn) => (heard[type] = (heard[type] || []).concat(fn));
document.removeEventListener = (type, fn) => (heard[type] = (heard[type] || []).filter(f => f !== fn));
document.dispatchEvent = e => (heard[e.type] || []).slice().forEach(fn => fn(e));

const setOnline = on => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => on });
async function quiet() {
  for (let i = 0; i < 4; i++) {
    await settle(5);
    await window.v2Queue.flush();
  }
  await settle(5);
}

function row(n, over = {}) {
  return {
    id: U(1000 + n),
    kind: 'announcement',
    body: 'Words ' + n,
    link_url: null,
    link_title: null,
    pinned: false,
    pinned_until: null,
    assessment_id: null,
    reactions_on: false,
    visible: true,
    posted_at: '2026-11-17T1' + n + ':00:00Z',
    shown_again_at: null,
    edited_at: null,
    created_at: '2026-11-17T1' + n + ':00:00Z',
    updated_at: '2026-11-17T1' + n + ':00:00Z',
    idempotency_key: null,
    files: [],
    seen: 0,
    can_see: 5,
    reactions: { got_it: 0, done: 0, question: 0 },
    ...over,
  };
}
const listAnswer = (bulletins, over = {}) => ({
  data: { bulletins, more: false, can_see: 5, no_card: 1, paused: 0, page_on: true, ...over },
  error: null,
});

describe('the pure helpers', () => {
  it('a link is http or https with a host, or nothing', () => {
    expect(bulletinLinkOk(' https://example.com/a?b=1 ')).toBe('https://example.com/a?b=1');
    expect(bulletinLinkOk('http://example.com')).toBe('http://example.com');
    expect(bulletinLinkOk('HTTPS://EXAMPLE.COM')).toBe('HTTPS://EXAMPLE.COM');
    [
      'javascript:alert(1)',
      'ftp://example.com',
      'example.com',
      'https://',
      'https:// bad',
      '',
      null,
      'data:text/html,x',
    ].forEach(v => expect(bulletinLinkOk(v), String(v)).toBe(''));
    expect(bulletinLinkOk('https://example.com/' + 'a'.repeat(2000))).toBe('');
    expect(bulletinLinkHost('https://www.youtube.com/watch?v=1')).toBe('youtube.com');
  });

  it('the facts line has three forms, and the reactions line follows the switch', () => {
    expect(bulletinSeenText(18, 26)).toBe('Seen by 18 of 26 · 8 Not Seen');
    expect(bulletinSeenText(26, 26)).toBe('Seen by All 26');
    expect(bulletinSeenText(0, 26)).toBe('Not Seen Yet');
    expect(bulletinSeenText(0, 0)).toBe('Not Seen Yet');
    expect(bulletinReactionText({ reactions_on: true, reactions: { got_it: 14, done: 0, question: 2 } })).toBe(
      '14 Got It · 2 Have a Question',
    );
    expect(bulletinReactionText({ reactions_on: false, reactions: { got_it: 14, done: 0, question: 2 } })).toBe('');
    expect(bulletinReactionText({ reactions_on: true, reactions: { got_it: 0, done: 0, question: 0 } })).toBe('');
  });

  it('a draft is checked: words, link, name, pages, date', () => {
    const ok = { kind: 'announcement', body: 'Hi', files: [] };
    expect(bulletinDraftProblem(ok)).toBe('');
    expect(bulletinDraftProblem({ ...ok, body: '  ' })).toMatch(/Write something/);
    expect(bulletinDraftProblem({ ...ok, body: 'x'.repeat(2001) })).toMatch(/2000/);
    expect(bulletinDraftProblem({ ...ok, body: 'x'.repeat(2000) })).toBe('');
    expect(bulletinDraftProblem({ ...ok, link_url: 'ftp://x.org' })).toMatch(/http/);
    expect(bulletinDraftProblem({ kind: 'announcement', body: '', link_url: 'https://x.org' })).toBe('');
    expect(bulletinDraftProblem({ ...ok, link_title: 'n'.repeat(201), link_url: 'https://x.org' })).toMatch(/200/);
    expect(bulletinDraftProblem({ kind: 'announcement', body: '', files: [{ pages: 20 }] })).toBe('');
    expect(bulletinDraftProblem({ kind: 'announcement', body: '', files: [{ pages: 12 }, { pages: 9 }] })).toMatch(
      /20 pages/,
    );
    expect(bulletinDraftProblem({ ...ok, pinned_until: '2099-01-01' })).toMatch(/reminder/);
    expect(bulletinDraftProblem({ ...ok, kind: 'reminder', pinned_until: '2099-01-01' })).toBe('');
    expect(bulletinDraftProblem({ ...ok, kind: 'reminder', pinned_until: '2001-01-01' })).toMatch(/before today/);
    expect(bulletinDraftProblem({ ...ok, kind: 'poll' })).toMatch(/Announcement or Reminder/);
  });

  it('the payload carries only what means something; a reminder is pinned', () => {
    expect(bulletinPayload({ kind: 'announcement', body: ' Hi ', link_url: '', reactions_on: false })).toEqual({
      kind: 'announcement',
      body: 'Hi',
      reactions_on: false,
    });
    expect(
      bulletinPayload({
        kind: 'reminder',
        body: 'x',
        link_url: ' https://a.org ',
        link_title: ' Site ',
        pinned_until: '2026-11-20',
        assessment_id: 'a1',
        reactions_on: true,
      }),
    ).toEqual({
      kind: 'reminder',
      body: 'x',
      link_url: 'https://a.org',
      link_title: 'Site',
      pinned: true,
      pinned_until: '2026-11-20',
      assessment_id: 'a1',
      reactions_on: true,
    });
  });

  it('bulletins sort pinned first, then newest first', () => {
    const a = { id: 'a', pinned: false, posted_at: '2026-11-17T10:00:00Z' };
    const b = { id: 'b', pinned: true, posted_at: '2026-11-10T10:00:00Z' };
    const c = { id: 'c', pinned: false, posted_at: '2026-11-17T12:00:00Z' };
    expect(bulletinsSorted([a, b, c]).map(x => x.id)).toEqual(['b', 'c', 'a']);
  });
});

describe('Demo Mode keeps bulletins on the device and calls no server', () => {
  const CID = 'c-bd';
  let fake;
  let was;
  beforeEach(() => {
    was = { demo: window.isDemoMode, get: globalThis.getSupabase };
    window.isDemoMode = () => true;
    fake = { calls: [], rpc: (...a) => (fake.calls.push(a), Promise.resolve({ data: null, error: null })) };
    globalThis.getSupabase = () => fake;
    clearClass(CID);
    seedClass(CID, { students: STUDENTS, courseConfigs: ON });
    COURSES[CID].name = 'Science 8';
    localStorage.removeItem('gb-bulletins-' + CID);
  });
  afterEach(() => {
    window.isDemoMode = was.demo;
    globalThis.getSupabase = was.get;
    localStorage.removeItem('gb-bulletins-' + CID);
    localStorage.removeItem('gb-student-page-options-' + CID);
    clearClass(CID);
  });

  it('posts, reads back, edits, pins, shows again and deletes', async () => {
    expect(bulletinsOffered(CID)).toBe(true);
    const events = [];
    const on = e => events.push(e.detail.cid);
    document.addEventListener('fv:bulletins-changed', on);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-17T09:00:00'));
    const made = await postBulletin(CID, { kind: 'announcement', body: ' First ', reactions_on: true });
    expect(made.ok).toBe(true);
    vi.setSystemTime(new Date('2026-11-17T09:05:00'));
    await postBulletin(CID, { kind: 'reminder', body: 'Second', pinned_until: '2099-02-03', assessment_id: 'a1' });
    vi.setSystemTime(new Date('2026-11-17T09:10:00'));
    await postBulletin(CID, { kind: 'announcement', body: '', link_url: 'https://example.com/x', link_title: 'Site' });
    vi.useRealTimers();
    document.removeEventListener('fv:bulletins-changed', on);
    expect(events.length).toBeGreaterThan(2);
    const list = getBulletins(CID);
    expect(list.map(b => b.body)).toEqual(['Second', '', 'First']); // the reminder is pinned
    expect(list[0]).toMatchObject({ kind: 'reminder', pinned: true, pinned_until: '2099-02-03', assessment_id: 'a1' });
    expect(list[1].link_url).toBe('https://example.com/x');
    expect(list[2]).toMatchObject({ body: 'First', reactions_on: true, seen: 0, can_see: 5, waiting: false });
    expect(getBulletinsMeta(CID)).toMatchObject({ can_see: 5, no_card: 0, paused: 0, page_on: true });

    const id = list[2].id;
    expect(id).toMatch(UUID);
    expect((await editBulletin(CID, id, { body: 'First, edited' })).ok).toBe(true);
    expect(getBulletins(CID).find(b => b.id === id)).toMatchObject({ body: 'First, edited' });
    expect(getBulletins(CID).find(b => b.id === id).edited_at).toBeTruthy();
    expect((await setBulletinPinned(CID, id, true)).ok).toBe(true);
    expect(getBulletins(CID).map(b => b.pinned)).toEqual([true, true, false]);
    expect((await setBulletinPinned(CID, id, false)).ok).toBe(true);
    expect(getBulletins(CID).find(b => b.id === id).pinned).toBe(false);
    // Taking the words away from a bulletin with nothing else is refused.
    expect((await editBulletin(CID, id, { body: '' })).ok).toBe(false);
    expect((await editBulletin(CID, id, { link_url: 'ftp://nope' })).message).toMatch(/http/);
    expect((await showBulletinAgain(CID, id)).ok).toBe(true);
    expect(getBulletins(CID).find(b => b.id === id).shown_again_at).toBeTruthy();
    expect((await deleteBulletin(CID, id)).ok).toBe(true);
    expect(getBulletins(CID).map(b => b.id)).not.toContain(id);
    expect((await deleteBulletin(CID, id)).ok).toBe(false);
    expect(fake.calls).toEqual([]);
  });

  it('a pinned reminder past its last day is no longer pinned', async () => {
    saveDemoBulletinsSeed(CID, [
      { ...row(1), kind: 'reminder', pinned: true, pinned_until: '2001-01-01', seen: ['s1'] },
    ]);
    await refreshBulletins(CID);
    expect(getBulletins(CID)[0].pinned).toBe(false);
  });

  it('counts who has seen it from the class list, and a paused student leaves the count', async () => {
    saveDemoBulletinsSeed(CID, [
      {
        ...row(1),
        reactions_on: true,
        seen: ['s1', 's2', 's3'],
        reactions: { got_it: ['s1'], question: ['s2', 's5'] },
      },
    ]);
    await refreshBulletins(CID);
    const b = getBulletins(CID)[0];
    expect([b.seen, b.can_see]).toEqual([3, 5]);
    expect(b.reactions).toEqual({ got_it: 1, done: 0, question: 2 });
    let who = await getBulletinSeen(CID, b.id);
    expect(who).toMatchObject({
      ok: true,
      not_seen: ['s4', 's5'],
      seen: ['s1', 's2', 's3'],
      paused: [],
      no_card: [],
    });
    expect(who.reactions).toEqual({ got_it: ['s1'], done: [], question: ['s2', 's5'] });

    await setStudentPageOptions(CID, ['s2'], { paused: true }, crypto.randomUUID());
    await refreshBulletins(CID);
    const after = getBulletins(CID)[0];
    expect([after.seen, after.can_see]).toEqual([2, 4]);
    who = await getBulletinSeen(CID, b.id);
    expect(who.paused).toEqual(['s2']);
    expect(who.seen).toEqual(['s1', 's3']);
    expect(after.reactions).toEqual({ got_it: 1, done: 0, question: 1 });
    expect(getBulletinsMeta(CID)).toMatchObject({ can_see: 4, paused: 1 });
  });

  it('a student with no card is named apart once the class has cards', async () => {
    localStorage.setItem(
      'gb-student-cards-' + CID,
      JSON.stringify([
        { id: 'k1', enrollment_id: 's1' },
        { id: 'k2', enrollment_id: 's2' },
      ]),
    );
    saveDemoBulletinsSeed(CID, [{ ...row(1), seen: ['s1'] }]);
    await refreshBulletins(CID);
    const who = await getBulletinSeen(CID, getBulletins(CID)[0].id);
    expect(who.no_card).toEqual(['s3', 's4', 's5']);
    expect(who.not_seen).toEqual(['s2']);
    expect(getBulletinsMeta(CID)).toMatchObject({ can_see: 2, no_card: 3 });
    localStorage.removeItem('gb-student-cards-' + CID);
  });

  it('a file added in Demo Mode keeps its small pictures on the device', async () => {
    const blob = new Blob(['x'], { type: 'image/jpeg' });
    const out = await postBulletin(CID, { kind: 'announcement', body: '' }, [
      {
        kind: 'pdf',
        title: 'Reading',
        pages: [
          { blob, thumb: blob },
          { blob, thumb: blob },
        ],
      },
    ]);
    expect(out.ok).toBe(true);
    const f = getBulletins(CID)[0].files[0];
    expect(f).toMatchObject({ kind: 'pdf', title: 'Reading', page_count: 2, status: 'ready' });
    expect(f.paths.length).toBe(2);
    expect(f.paths[0]).toMatch(/^data:/);
    expect((await getBulletinPage(CID, f, 0)).url).toBe(f.paths[0]);
    expect(fake.calls).toEqual([]);
  });

  it('Reset Demo Data and deleting a class clear the class’s bulletins and its waiting ones', async () => {
    await postBulletin(CID, { kind: 'announcement', body: 'Gone soon' });
    localStorage.setItem('gb-bulletins-pending-' + CID, '[]');
    expect(localStorage.getItem('gb-bulletins-' + CID)).toBeTruthy();
    _clearCourseLocalState(CID);
    expect(localStorage.getItem('gb-bulletins-' + CID)).toBe(null);
    expect(localStorage.getItem('gb-bulletins-pending-' + CID)).toBe(null);
  });

  it('the sample bulletins are written once', () => {
    const rows = [{ ...row(1), seen: ['s1'] }];
    expect(saveDemoBulletinsSeed(CID, rows)).toBe(true);
    expect(saveDemoBulletinsSeed(CID, rows)).toBe(false);
  });
});

describe('signed in, against stand-in answers', () => {
  let session;
  let fake;
  let events;
  const on = e => events.push(e.detail.cid);
  const sent = name => session.sent().filter(c => c[0] === name);

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-17T17:00:00'));
    session = signIn();
    fake = session.fake;
    setOnline(true);
    window.v2Queue.clear();
    clearClass(REAL);
    seedClass(REAL, { students: STUDENTS, courseConfigs: ON });
    for (const k of Object.keys(_bltMem)) delete _bltMem[k];
    localStorage.removeItem('gb-bulletins-pending-' + REAL);
    events = [];
    document.addEventListener('fv:bulletins-changed', on);
  });
  afterEach(async () => {
    document.removeEventListener('fv:bulletins-changed', on);
    await quiet();
    window.v2Queue.clear();
    setOnline(true);
    session.signOut();
    clearClass(REAL);
    localStorage.removeItem('gb-bulletins-pending-' + REAL);
    vi.useRealTimers();
  });

  it('reads the class once, tells the page, and not again within 15 seconds unless forced', async () => {
    fake.on('list_bulletins', () => listAnswer([row(1), row(2, { pinned: true }), row(3)], { paused: 1, no_card: 4 }));
    expect(bulletinsOffered(REAL)).toBe(false);
    expect(await refreshBulletins(REAL)).toBe(true);
    expect(bulletinsOffered(REAL)).toBe(true);
    expect(events).toEqual([REAL]);
    expect(getBulletins(REAL).map(b => b.body)).toEqual(['Words 2', 'Words 3', 'Words 1']);
    expect(getBulletinsMeta(REAL)).toMatchObject({ can_see: 5, no_card: 4, paused: 1, page_on: true });
    await refreshBulletins(REAL);
    expect(sent('list_bulletins')).toEqual([['list_bulletins', { p_course_id: REAL }]]);
    vi.setSystemTime(new Date('2026-11-17T17:00:16'));
    await refreshBulletins(REAL);
    expect(sent('list_bulletins').length).toBe(2);
    await refreshBulletins(REAL, { force: true });
    expect(sent('list_bulletins').length).toBe(3);
  });

  it('a server without list_bulletins: nothing offered, nothing sent, and not asked again', async () => {
    fake.on('list_bulletins', () => ({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find the function public.list_bulletins' },
    }));
    expect(await refreshBulletins(REAL)).toBe(false);
    expect(bulletinsOffered(REAL)).toBe(false);
    expect(bulletinsState(REAL)).toBe('missing');
    expect(await refreshBulletins(REAL, { force: true })).toBe(false);
    const out = await postBulletin(REAL, { kind: 'announcement', body: 'Hi' });
    expect(out).toMatchObject({ ok: false });
    expect(out.message).toMatch(/not available/);
    expect(session.sent().map(c => c[0])).toEqual(['list_bulletins']);
  });

  it('an answer for a class no longer on screen is dropped', async () => {
    fake.on('list_bulletins', () => listAnswer([row(1)]));
    expect(await refreshBulletins(REAL, { stillShown: () => false })).toBe(false);
    expect(getBulletins(REAL)).toEqual([]);
    expect(bulletinsState(REAL)).toBe('');
    expect(events).toEqual([]);
  });

  it('a post waits as Not Sent Yet with no connection, then lands exactly once and the waiting entry goes', async () => {
    fake.on('list_bulletins', () => listAnswer([]));
    fake.on('post_bulletin', params => ({
      data: {
        bucket: 'bulletin-files',
        bulletin: row(7, { body: params.p_bulletin.body, idempotency_key: params.p_idempotency_key }),
      },
      error: null,
    }));
    await refreshBulletins(REAL);
    setOnline(false);
    const posting = postBulletin(REAL, { kind: 'announcement', body: 'From the bus' });
    await settle(5);
    expect(sent('post_bulletin')).toEqual([]);
    const waiting = getBulletins(REAL);
    expect(waiting.length).toBe(1);
    expect(waiting[0]).toMatchObject({ waiting: true, body: 'From the bus', visible: false });
    expect(waiting[0].key).toMatch(UUID);
    expect(waiting[0].id).toBe('waiting:' + waiting[0].key); // never a server-shaped id
    const pending = JSON.parse(localStorage.getItem('gb-bulletins-pending-' + REAL));
    expect(pending.length).toBe(1);
    expect(pending[0].key).toBe(waiting[0].key);
    expect(bulletinCanTakeBack(REAL, waiting[0].key)).toBe(true);

    setOnline(true);
    await quiet();
    const out = await posting;
    expect(out.ok).toBe(true);
    expect(fake.calls.filter(c => c.name === 'post_bulletin').length).toBe(1);
    expect(fake.calls.find(c => c.name === 'post_bulletin').params).toMatchObject({
      p_course_id: REAL,
      p_bulletin: { kind: 'announcement', body: 'From the bus', reactions_on: false },
      p_files: null,
      p_idempotency_key: waiting[0].key,
    });
    expect(localStorage.getItem('gb-bulletins-pending-' + REAL)).toBe(null);
    const now = getBulletins(REAL);
    expect(now.length).toBe(1);
    expect(now[0]).toMatchObject({ waiting: false, id: U(1007), body: 'From the bus' });
  });

  it('the server’s row with the waiting key takes its place, and a lost one is let go', async () => {
    const key = crypto.randomUUID();
    localStorage.setItem(
      'gb-bulletins-pending-' + REAL,
      JSON.stringify([
        { key, at: '2026-11-17T16:00:00.000Z', bulletin: { kind: 'announcement', body: 'Landed' }, files: [] },
        {
          key: crypto.randomUUID(),
          at: '2026-11-17T16:00:00.000Z',
          bulletin: { kind: 'announcement', body: 'Lost' },
          files: [],
        },
      ]),
    );
    expect(getBulletins(REAL).filter(b => b.waiting).length).toBe(2);
    fake.on('list_bulletins', () => listAnswer([row(5, { idempotency_key: key, body: 'Landed' })]));
    await refreshBulletins(REAL);
    const list = getBulletins(REAL);
    expect(list.map(b => [b.body, b.waiting])).toEqual([['Landed', false]]);
    expect(localStorage.getItem('gb-bulletins-pending-' + REAL)).toBe(null);
  });

  it('a waiting bulletin can be taken back: it leaves the device and the outbox, and is never sent', async () => {
    fake.on('list_bulletins', () => listAnswer([]));
    await refreshBulletins(REAL);
    setOnline(false);
    const posting = postBulletin(REAL, { kind: 'announcement', body: 'Oops' });
    await settle(5);
    const key = getBulletins(REAL)[0].key;
    expect(window.v2Queue.has(key)).toBe(true);
    expect(takeBackBulletin(REAL, key)).toBe(true);
    expect(window.v2Queue.has(key)).toBe(false);
    expect(getBulletins(REAL)).toEqual([]);
    expect(localStorage.getItem('gb-bulletins-pending-' + REAL)).toBe(null);
    expect(await posting).toEqual({ ok: false });
    setOnline(true);
    await quiet();
    expect(sent('post_bulletin')).toEqual([]);
    expect(takeBackBulletin(REAL, key)).toBe(false);
  });

  it('a post the server refuses (22023) gives the sentence back and leaves nothing waiting', async () => {
    fake.on('list_bulletins', () => listAnswer([]));
    await refreshBulletins(REAL);
    fake.on('post_bulletin', () => ({
      data: null,
      error: { code: '22023', message: 'A link must start with http:// or https://.' },
    }));
    const out = await postBulletin(REAL, { kind: 'announcement', body: 'Hi' });
    expect(out).toEqual({ ok: false, message: 'A link must start with http:// or https://.' });
    expect(getBulletins(REAL)).toEqual([]);
    expect(localStorage.getItem('gb-bulletins-pending-' + REAL)).toBe(null);
    expect(sent('post_bulletin').length).toBe(1);
  });

  it('a bad draft is refused before anything is sent', async () => {
    fake.on('list_bulletins', () => listAnswer([]));
    await refreshBulletins(REAL);
    const out = await postBulletin(REAL, { kind: 'announcement', body: 'x'.repeat(2001) });
    expect(out.ok).toBe(false);
    expect(sent('post_bulletin')).toEqual([]);
  });

  describe('a file', () => {
    const page = () => ({ blob: new Blob(['jpeg'], { type: 'image/jpeg' }) });
    const FILE_ID = U(2001);
    const paths = n => Array.from({ length: n }, (_, i) => `${REAL}/${FILE_ID}/${i + 1}.jpg`);
    let uploads;
    let finishAnswers;
    beforeEach(async () => {
      uploads = [];
      finishAnswers = [];
      fake.storage = {
        from: bucket => ({
          upload: (path, blob, opts) => {
            uploads.push([bucket, path, opts]);
            return Promise.resolve({ error: null });
          },
        }),
      };
      fake.on('list_bulletins', () => listAnswer([]));
      fake.on('post_bulletin', params => ({
        data: {
          bucket: 'bulletin-files',
          bulletin: row(8, {
            visible: false,
            posted_at: null,
            idempotency_key: params.p_idempotency_key,
            files: params.p_files.map((f, i) => ({
              id: FILE_ID,
              kind: f.kind,
              title: f.title,
              page_count: f.pages,
              status: 'uploading',
              position: i + 1,
              paths: paths(f.pages),
            })),
          }),
        },
        error: null,
      }));
      fake.on('finish_bulletin_file', () => ({ data: finishAnswers.shift(), error: null }));
      await refreshBulletins(REAL);
    });
    const ready = () => ({
      file_id: FILE_ID,
      bulletin: row(8, {
        body: '',
        files: [
          { id: FILE_ID, kind: 'pdf', title: 'Reading', page_count: 2, status: 'ready', position: 1, paths: paths(2) },
        ],
      }),
    });

    it('uploads each page to the path post_bulletin gave, then finishes the file', async () => {
      finishAnswers.push(ready());
      fake.on('list_bulletins', () => listAnswer([ready().bulletin]));
      const out = await postBulletin(REAL, { kind: 'announcement', body: '' }, [
        { kind: 'pdf', title: 'Reading', pages: [page(), page()] },
      ]);
      await settle();
      expect(out.ok).toBe(true);
      expect(sent('post_bulletin')[0][1]).toMatchObject({ p_files: [{ kind: 'pdf', title: 'Reading', pages: 2 }] });
      expect(uploads).toEqual([
        ['bulletin-files', paths(2)[0], { contentType: 'image/jpeg', upsert: false }],
        ['bulletin-files', paths(2)[1], { contentType: 'image/jpeg', upsert: false }],
      ]);
      expect(sent('finish_bulletin_file').length).toBe(1);
      expect(sent('finish_bulletin_file')[0][1].p_bulletin_file_id).toBe(FILE_ID);
      expect(getBulletins(REAL)[0]).toMatchObject({ waiting: false, visible: true });
      expect(localStorage.getItem('gb-bulletins-pending-' + REAL)).toBe(null);
    });

    it('a page the server says is missing is uploaded again, then the file is finished again', async () => {
      finishAnswers.push({ file_id: FILE_ID, bulletin: ready().bulletin, missing: [2], bad: [] }, ready());
      const out = await postBulletin(REAL, { kind: 'announcement', body: '' }, [
        { kind: 'pdf', title: 'Reading', pages: [page(), page()] },
      ]);
      expect(out.ok).toBe(true);
      expect(uploads.map(u => u[1])).toEqual([paths(2)[0], paths(2)[1], paths(2)[1]]);
      const finishes = sent('finish_bulletin_file');
      expect(finishes.length).toBe(2);
      const keys = fake.calls.filter(c => c.name === 'finish_bulletin_file').map(c => c.params.p_idempotency_key);
      expect(keys[0]).not.toBe(keys[1]);
    });

    it('a file the server says is gone makes the post again, with a new key, from the pages still held', async () => {
      finishAnswers.push({ file_id: FILE_ID, status: 'gone' }, ready());
      const out = await postBulletin(REAL, { kind: 'announcement', body: '' }, [
        { kind: 'pdf', title: 'Reading', pages: [page(), page()] },
      ]);
      expect(out.ok).toBe(true);
      const posts = sent('post_bulletin');
      expect(posts.length).toBe(2);
      const keys = fake.calls.filter(c => c.name === 'post_bulletin').map(c => c.params.p_idempotency_key);
      expect(keys[0]).toMatch(UUID);
      expect(keys[0]).not.toBe(keys[1]);
      expect(uploads.length).toBe(4);
    });

    it('a page that will not upload leaves the draft with the teacher and deletes the half-made bulletin', async () => {
      fake.storage = {
        from: () => ({ upload: () => Promise.resolve({ error: { message: 'offline' } }) }),
      };
      const out = await postBulletin(REAL, { kind: 'announcement', body: '' }, [
        { kind: 'photo', title: 'Board', pages: [page()] },
      ]);
      expect(out.ok).toBe(false);
      expect(out.message).toMatch(/did not go up/);
      expect(sent('delete_bulletin').length).toBe(1);
      expect(localStorage.getItem('gb-bulletins-pending-' + REAL)).toBe(null);
    });

    it('with no connection a file is refused up front, nothing queued, the draft kept', async () => {
      setOnline(false);
      const out = await postBulletin(REAL, { kind: 'announcement', body: 'Look' }, [
        { kind: 'photo', title: 'Board', pages: [page()] },
      ]);
      expect(out).toMatchObject({ ok: false, offline: true });
      expect(out.message).toMatch(/needs a connection/);
      expect(sent('post_bulletin')).toEqual([]);
      expect(window.v2Queue.stats().queued).toBe(0);
      expect(localStorage.getItem('gb-bulletins-pending-' + REAL)).toBe(null);
    });
  });

  describe('changes to a bulletin the server has', () => {
    let rows;
    beforeEach(async () => {
      rows = [row(1), row(2)];
      fake.on('list_bulletins', () => listAnswer(rows));
      await refreshBulletins(REAL);
    });

    it('edit, pin, show again and delete send the real id with a key made here', async () => {
      fake.on('edit_bulletin', params => ({
        data: { bulletin: { ...row(1, params.p_patch), id: params.p_bulletin_id } },
        error: null,
      }));
      expect((await editBulletin(REAL, U(1001), { body: 'New words' })).ok).toBe(true);
      expect(sent('edit_bulletin')[0][1]).toMatchObject({
        p_bulletin_id: U(1001),
        p_patch: { body: 'New words' },
      });
      expect(fake.calls.find(c => c.name === 'edit_bulletin').params.p_idempotency_key).toMatch(UUID);
      expect((await setBulletinPinned(REAL, U(1002), true)).ok).toBe(true);
      expect((await setBulletinPinned(REAL, U(1002), false)).ok).toBe(true);
      expect(sent('edit_bulletin').map(c => c[1].p_patch)).toEqual([
        { body: 'New words' },
        { pinned: true },
        { pinned: false },
      ]);
      fake.on('show_bulletin_again', () => ({ data: { bulletin: row(2, { shown_again_at: 'x' }) }, error: null }));
      expect((await showBulletinAgain(REAL, U(1002))).ok).toBe(true);
      fake.on('delete_bulletin', params => {
        rows = rows.filter(r => r.id !== params.p_bulletin_id);
        return { data: { deleted: true, id: params.p_bulletin_id }, error: null };
      });
      expect((await deleteBulletin(REAL, U(1002))).ok).toBe(true);
      await settle();
      expect(getBulletins(REAL).map(b => b.id)).toEqual([U(1001)]);
    });

    it('a refused edit puts back what was shown and says why', async () => {
      fake.on('edit_bulletin', () => ({ data: null, error: { code: '22023', message: 'Words are too long.' } }));
      const out = await editBulletin(REAL, U(1001), { body: 'x' });
      expect(out).toEqual({ ok: false, message: 'Words are too long.' });
      expect(getBulletins(REAL).find(b => b.id === U(1001)).body).toBe('Words 1');
    });

    it('a waiting bulletin or a made-up id is never named in a write', async () => {
      expect((await editBulletin(REAL, 'waiting:' + crypto.randomUUID(), { body: 'x' })).ok).toBe(false);
      expect((await deleteBulletin(REAL, 'c1abc')).ok).toBe(false);
      expect((await showBulletinAgain(REAL, 'c1abc')).ok).toBe(false);
      expect(sent('edit_bulletin').concat(sent('delete_bulletin'), sent('show_bulletin_again'))).toEqual([]);
    });

    it('who has seen it is read from the server as ids', async () => {
      fake.on('list_bulletin_seen', () => ({
        data: {
          bulletin_id: U(1001),
          not_seen: ['s4'],
          seen: ['s1', 's2'],
          reactions: { got_it: ['s1'], done: [], question: ['s2'] },
          paused: ['s3'],
          no_card: ['s5'],
        },
        error: null,
      }));
      expect(await getBulletinSeen(REAL, U(1001))).toEqual({
        ok: true,
        not_seen: ['s4'],
        seen: ['s1', 's2'],
        reactions: { got_it: ['s1'], done: [], question: ['s2'] },
        paused: ['s3'],
        no_card: ['s5'],
      });
      expect(sent('list_bulletin_seen')).toEqual([['list_bulletin_seen', { p_bulletin_id: U(1001) }]]);
      fake.on('list_bulletin_seen', () => ({ data: null, error: { message: 'x' } }));
      expect((await getBulletinSeen(REAL, U(1001))).ok).toBe(false);
    });
  });
});

describe('the Bulletins tab', () => {
  const tabs = () => [...renderDock('dashboard').matchAll(/tb-seg-link[^>]*>([^<]+)</g)].map(m => m[1]);
  afterEach(() => localStorage.removeItem('fv-build-bulletins'));

  it('is not in the top bar with the switch off', () => {
    expect(tabs()).toEqual(['Dashboard', 'Assignments', 'Observations', 'Gradebook', 'Reporting']);
    expect(TB_PAGES.map(p => p.label)).toContain('Bulletins');
    expect(Router.isRoute('/bulletins')).toBe(false);
  });

  it('is after Assignments with the switch on', () => {
    localStorage.setItem('fv-build-bulletins', '1');
    expect(tabs()).toEqual(['Dashboard', 'Assignments', 'Bulletins', 'Observations', 'Gradebook', 'Reporting']);
    expect(Router.isRoute('/bulletins')).toBe(true);
  });
});
