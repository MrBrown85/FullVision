/**
 * The photo queue's third kind of record: a bulletin's page (slice B1f,
 * docs/plans/bulletins-plan.md). The teacher posts a photo from the phone,
 * with or without a connection; its pages wait in shared/photo-queue.js
 * under the bulletin's device key until post_bulletin names their paths,
 * then go up and are finished (finish_bulletin_file).
 *
 * The first part holds the queue alone, over a store kept in memory (as
 * tests/photo-queue.test.js does): a bulletin's pages are kept, blocked
 * until placed, sent in order through their own upload and committed once
 * through their own commit, while a student's work and a handout queued
 * beside them go exactly as before. Loading the file again over the same
 * store stands for a reload.
 *
 * The second part holds the whole flow through shared/data-bulletins.js
 * against stand-in answers for the contract
 * (migrations/local-test/bulletins-contract.md), reloading the app (the
 * outbox, the photo queue and the data layer's memory) between the steps.
 */
import './setup.js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'vm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { U, clearClass, seedClass, settle, signIn } from './helpers/pin-save-paths.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const queueSource = readFileSync(resolve(root, 'shared/photo-queue.js'), 'utf-8');
const outboxSource = readFileSync(resolve(root, 'shared/offline-queue.js'), 'utf-8');
runInThisContext(outboxSource, { filename: 'shared/offline-queue.js' });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const COURSE = '11111111-1111-4111-8111-111111111111';
const ASSESSMENT = '22222222-2222-4222-8222-222222222222';
const ENROLLMENT = '33333333-3333-4333-8333-333333333333';
const SUBMISSION = '44444444-4444-4444-8444-444444444444';
const RESOURCE = '66666666-6666-4666-8666-666666666666';
const KEY = '77777777-7777-4777-8777-777777777777';
const BFILE = '88888888-8888-4888-8888-888888888888';
const fileId = n => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;
const setOnline = on => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => on });

function page(n, bytes = 400) {
  return {
    blob: new Blob([new Uint8Array(bytes).fill(n)], { type: 'image/jpeg' }),
    thumb: new Blob([new Uint8Array(40).fill(n)], { type: 'image/jpeg' }),
    hash: String(n).repeat(64).slice(0, 64),
    width: 2000,
    height: 1500,
    name: 'page-' + n + '.jpg',
  };
}

/* The store, in memory, handing out copies as IndexedDB does. A record
   with no thumbnail (a handout's, a bulletin's) is kept as it is.
   capBytes makes the device "full". */
function memoryStore({ capBytes = Infinity } = {}) {
  const metas = new Map();
  const files = new Map();
  const copy = v => JSON.parse(JSON.stringify(v));
  const size = f => f.photo.size + (f.thumb ? f.thumb.size : 0);
  const used = () => [...files.values()].reduce((n, f) => n + size(f), 0);
  return {
    async list() {
      return [...metas.values()].map(copy);
    },
    async putAll(items) {
      const adding = items.reduce((n, i) => n + size(i), 0);
      if (used() + adding > capBytes) {
        const err = new Error('The quota has been exceeded.');
        err.name = 'QuotaExceededError';
        throw err;
      }
      items.forEach(i => {
        metas.set(i.meta.id, copy(i.meta));
        files.set(i.meta.id, { photo: i.photo, thumb: i.thumb });
      });
    },
    async update(id, patch) {
      if (metas.has(id)) metas.set(id, window.PhotoQueue.applyPatch(copy(metas.get(id)), copy(patch)));
    },
    async blobs(id) {
      return files.get(id) || null;
    },
    async remove(ids) {
      ids.forEach(id => {
        metas.delete(id);
        files.delete(id);
      });
    },
    async clear() {
      metas.clear();
      files.clear();
    },
    count: () => metas.size,
    metas: () => [...metas.values()].map(copy),
  };
}

/* ── The queue alone ───────────────────────────────────────────────────── */

describe('the photo queue keeps a bulletin’s pages as a third kind of record', () => {
  let store;
  let Q;
  let calls;

  /* The app loads the queue (again: a reload) and wires it, as the phone does. */
  function open(opts = {}) {
    if (window.PhotoQueue && window.PhotoQueue.release) window.PhotoQueue.release();
    runInThisContext(queueSource, { filename: 'shared/photo-queue.js' });
    Q = window.PhotoQueue;
    Q.configure({
      store,
      isDemo: () => false,
      upload: async (path, blob, info) => {
        calls.push({ to: 'work', path, part: info.part, size: blob.size });
        return { error: null };
      },
      commit: async batch => {
        calls.push({ to: 'commit', batch });
        return { error: null };
      },
      ...opts,
    });
    return Q;
  }
  const bulletinUpload = (answer = () => null) =>
    async function (path, blob, info) {
      calls.push({ to: 'bulletin', path, part: info.part, size: blob.size, order: info.order });
      return answer(path) || { error: null };
    };
  const bulletinCommit =
    (answer = () => null) =>
    async batch => {
      calls.push({ to: 'bulletin-commit', batch });
      return answer(batch) || { error: null };
    };
  const paths = n => Array.from({ length: n }, (_, i) => `${COURSE}/${BFILE}/${i + 1}.jpg`);
  async function place(tab, n) {
    const ids = tab
      .pages()
      .filter(p => p.kind === 'bulletin')
      .map(p => p.id);
    const map = {};
    ids.forEach((id, i) => (map[id] = paths(n)[i]));
    return tab.placeBulletin(map);
  }

  beforeEach(() => {
    store = memoryStore();
    calls = [];
    localStorage.clear();
    setOnline(true);
  });
  afterEach(() => {
    if (Q) Q.release();
    setOnline(true);
  });

  it('keeps every page under the device key, with no thumbnail, all or none', async () => {
    open();
    const res = await Q.addBulletin({ course: COURSE, key: KEY }, [page(1), page(2)]);
    expect(res.ok).toBe(true);
    expect(store.count()).toBe(2);
    const rows = Q.pages();
    expect(rows.map(r => [r.kind, r.order, r.state])).toEqual([
      ['bulletin', 0, 'blocked'],
      ['bulletin', 1, 'blocked'],
    ]);
    expect(rows[0].ids).toEqual({ course: COURSE, key: KEY, file: res.ids[0] });
    expect(Q.isLocalId(rows[0].ids.file)).toBe(true);
    const kept = await Q.blobs(res.ids[0]);
    expect(kept.photo.size).toBe(400);
    expect(kept.thumb).toBe(null);
    expect(Q.stats()).toMatchObject({ queued: 2, blocked: 2 });
  });

  it('refuses a class or a key that is not a server-shaped id: no local bulletin id is ever made', async () => {
    open();
    const local = 'b' + Date.now().toString(36);
    expect(await Q.addBulletin({ course: COURSE, key: local }, [page(1)])).toEqual({ ok: false, reason: 'invalid' });
    expect(await Q.addBulletin({ course: 'c' + Date.now().toString(36), key: KEY }, [page(1)])).toEqual({
      ok: false,
      reason: 'invalid',
    });
    expect(await Q.addBulletin({ course: COURSE, key: KEY }, [])).toEqual({ ok: false, reason: 'invalid' });
    expect(await Q.addBulletin({ course: COURSE, key: KEY }, [{ blob: new Blob([]) }])).toEqual({
      ok: false,
      reason: 'invalid',
    });
    expect(store.count()).toBe(0);
  });

  it('is blocked until placed, and until its own upload and commit are wired; never sent by the work upload', async () => {
    open();
    await Q.addBulletin({ course: COURSE, key: KEY }, [page(1), page(2)]);
    await Q.send();
    expect(calls).toEqual([]);
    await place(Q, 2);
    expect(Q.pages().map(p => p.path)).toEqual(paths(2));
    // Placed, but no bulletin upload wired: still blocked, and the work upload never sees it.
    await Q.send();
    expect(calls).toEqual([]);
    expect(Q.stats().blocked).toBe(2);
    Q.configure({ bulletinUpload: bulletinUpload(), bulletinCommit: bulletinCommit() });
    await Q.send();
    expect(calls.map(c => c.to)).toEqual(['bulletin', 'bulletin', 'bulletin-commit']);
    expect(calls.filter(c => c.to === 'bulletin').map(c => [c.path, c.part])).toEqual([
      [paths(2)[0], 'photo'],
      [paths(2)[1], 'photo'],
    ]);
    const commit = calls[2].batch;
    expect(Object.keys(commit).sort()).toEqual(['batch', 'files', 'ids', 'key', 'kind']);
    expect(commit).toMatchObject({ kind: 'bulletin', key: KEY, ids: { course: COURSE } });
    expect(commit.files.map(f => [f.path, f.file, f.page])).toEqual([
      [paths(2)[0], BFILE, 1],
      [paths(2)[1], BFILE, 2],
    ]);
    expect(store.count()).toBe(0);
    await Q.send();
    expect(calls.filter(c => c.to === 'bulletin-commit').length).toBe(1);
  });

  it('takes only a path in its own class’s folder of bulletin-files, and only for a bulletin page', async () => {
    open();
    const added = await Q.addBulletin({ course: COURSE, key: KEY }, [page(1)]);
    const handout = await Q.addHandout({ course: COURSE, assessment: ASSESSMENT, resource: RESOURCE }, [page(3)]);
    const other = '99999999-9999-4999-8999-999999999999';
    expect(await Q.placeBulletin({ [added.ids[0]]: `${other}/${BFILE}/1.jpg` })).toMatchObject({ reason: 'bad_path' });
    expect(await Q.placeBulletin({ [added.ids[0]]: `${COURSE}/${BFILE}/21.jpg` })).toMatchObject({
      reason: 'bad_path',
    });
    expect(await Q.placeBulletin({ [added.ids[0]]: `${COURSE}/handouts/${RESOURCE}/1.jpg` })).toMatchObject({
      reason: 'bad_path',
    });
    expect(await Q.placeBulletin({ [handout.ids[0]]: `${COURSE}/${BFILE}/1.jpg` })).toMatchObject({
      reason: 'bad_path',
    });
    expect(await Q.placeBulletin({ nope: `${COURSE}/${BFILE}/1.jpg` })).toMatchObject({ reason: 'not_found' });
    expect(Q.pages().every(p => p.path === null)).toBe(true);
    expect(Q.bulletinPathOk(`${COURSE}/${BFILE}/1.jpg`, COURSE)).toBe(true);
    expect(Q.bulletinPathOk(`${COURSE}/${BFILE}/1.jpg`, 'c123')).toBe(false);
  });

  it('a student’s work and a handout queued beside it go exactly as before', async () => {
    open({ bulletinUpload: bulletinUpload(), bulletinCommit: bulletinCommit() });
    const ids = { course: COURSE, assessment: ASSESSMENT, enrollment: ENROLLMENT, submission: SUBMISSION };
    const work = await Q.add(ids, [page(1)]);
    await Q.rekey({ [work.ids[0]]: fileId(1) });
    const handout = await Q.addHandout({ course: COURSE, assessment: ASSESSMENT, resource: RESOURCE }, [page(2)]);
    await Q.placeHandout({ [handout.ids[0]]: `${COURSE}/handouts/${RESOURCE}/1.jpg` });
    await Q.addBulletin({ course: COURSE, key: KEY }, [page(3)]);
    await place(Q, 1);
    await Q.send();
    // The work's photo and thumbnail and the handout's page by the work upload; the bulletin's by its own.
    const byWork = calls.filter(c => c.to === 'work');
    expect(byWork.filter(c => c.path.includes(SUBMISSION)).map(c => [c.path, c.part])).toEqual([
      [`${COURSE}/${ASSESSMENT}/${ENROLLMENT}/${SUBMISSION}/${fileId(1)}.jpg`, 'photo'],
      [`${COURSE}/${ASSESSMENT}/${ENROLLMENT}/${SUBMISSION}/${fileId(1)}-thumb.jpg`, 'thumb'],
    ]);
    expect(byWork.filter(c => !c.path.includes(SUBMISSION)).map(c => [c.path, c.part])).toEqual([
      [`${COURSE}/handouts/${RESOURCE}/1.jpg`, 'photo'],
    ]);
    expect(calls.filter(c => c.to === 'bulletin').map(c => c.path)).toEqual([`${COURSE}/${BFILE}/1.jpg`]);
    const commits = calls
      .filter(c => c.to === 'commit')
      .map(c => c.batch)
      .sort((x, y) => (x.kind ? 1 : 0) - (y.kind ? 1 : 0));
    expect(commits.length).toBe(2);
    expect(Object.keys(commits[0]).sort()).toEqual(['files', 'ids', 'key']);
    expect(commits[0].ids).toEqual(ids);
    expect(Object.keys(commits[0].files[0]).sort()).toEqual(
      ['bytes', 'hash', 'height', 'id', 'order', 'path', 'thumbBytes', 'thumbPath', 'width'].sort(),
    );
    expect(Object.keys(commits[1]).sort()).toEqual(['files', 'ids', 'key', 'kind']);
    expect(commits[1]).toMatchObject({
      kind: 'handout',
      ids: { course: COURSE, assessment: ASSESSMENT, resource: RESOURCE },
    });
    const bc = calls.filter(c => c.to === 'bulletin-commit');
    expect(bc.length).toBe(1);
    expect(bc[0].batch.kind).toBe('bulletin');
    expect(store.count()).toBe(0);
  });

  it('with no work commit wired, a work page is confirmed by its upload as before, and the bulletin still commits', async () => {
    open({ commit: null, bulletinUpload: bulletinUpload(), bulletinCommit: bulletinCommit() });
    const ids = { course: COURSE, assessment: ASSESSMENT, enrollment: ENROLLMENT, submission: SUBMISSION };
    const work = await Q.add(ids, [page(1)]);
    await Q.rekey({ [work.ids[0]]: fileId(1) });
    await Q.addBulletin({ course: COURSE, key: KEY }, [page(2)]);
    await place(Q, 1);
    await Q.send();
    // Pages queued in the same moment go in either order; each kind's own order is the point.
    expect(calls.filter(c => c.to === 'work').map(c => c.part)).toEqual(['photo', 'thumb']);
    expect(calls.filter(c => c.to !== 'work').map(c => c.to)).toEqual(['bulletin', 'bulletin-commit']);
    expect(store.count()).toBe(0);
  });

  it('survives a reload at each step: kept, placed, half sent, uploaded', async () => {
    open();
    await Q.addBulletin({ course: COURSE, key: KEY }, [page(1), page(2)]);
    open();
    expect((await Q.ready(), Q.pages()).map(p => p.state)).toEqual(['blocked', 'blocked']);
    await place(Q, 2);
    // The first page lands, the second fails on the network.
    open({
      bulletinUpload: bulletinUpload(path =>
        path.endsWith('/2.jpg') ? { error: { message: 'network: failed to fetch' } } : null,
      ),
      bulletinCommit: bulletinCommit(),
    });
    await Q.send({ force: true });
    expect(calls.filter(c => c.to === 'bulletin').map(c => c.path)).toEqual(paths(2));
    expect(Q.pages().map(p => p.state)).toEqual(['uploaded', 'retrying']);
    calls = [];
    open({ bulletinUpload: bulletinUpload(), bulletinCommit: bulletinCommit() });
    await Q.ready();
    await Q.send({ force: true });
    // Only the page that did not land goes again; the batch commits once.
    expect(calls.map(c => [c.to, c.path || ''])).toEqual([
      ['bulletin', paths(2)[1]],
      ['bulletin-commit', ''],
    ]);
    expect(store.count()).toBe(0);
  });

  it('a page the server says is missing goes again from retry(), with nothing but the page', async () => {
    let first = true;
    open({
      bulletinUpload: bulletinUpload(),
      bulletinCommit: bulletinCommit(batch => {
        if (!first) return null;
        first = false;
        return Q.retry(batch.files[1].id, { again: true }).then(() => ({ error: { message: 'missing', status: 503 } }));
      }),
    });
    await Q.addBulletin({ course: COURSE, key: KEY }, [page(1), page(2)]);
    await place(Q, 2);
    await Q.send({ force: true });
    await Q.send({ force: true });
    expect(calls.map(c => [c.to, c.path || ''])).toEqual([
      ['bulletin', paths(2)[0]],
      ['bulletin', paths(2)[1]],
      ['bulletin-commit', ''],
      ['bulletin', paths(2)[1]],
      ['bulletin-commit', ''],
    ]);
    expect(store.count()).toBe(0);
  });

  it('a tab that cannot send or commit a bulletin page does not wake for it: no send loop', async () => {
    open({
      bulletinUpload: bulletinUpload(),
      bulletinCommit: bulletinCommit(() => ({ error: { message: 'busy', status: 503 } })),
    });
    await Q.addBulletin({ course: COURSE, key: KEY }, [page(1)]);
    await place(Q, 1);
    await Q.send({ force: true });
    // Uploaded, its commit put off: a tab without the bulletin functions (the desktop) opens on it.
    expect(Q.pages()[0].state).toBe('uploaded');
    const meta = store.metas()[0];
    await store.update(meta.id, { next_at: Date.now() - 1000 });
    open();
    let passes = 0;
    Q.subscribe(e => {
      if (e.kind === 'send:end') passes++;
    });
    await Q.ready();
    await Q.send();
    await new Promise(r => setTimeout(r, 300));
    expect(passes).toBeLessThanOrEqual(1);
    expect(calls.filter(c => c.to === 'work')).toEqual([]);
  });

  it('a bulletin page never reaches the work upload, even when its own upload is unwired mid-pass', async () => {
    let unwire = null;
    open({
      bulletinUpload: async (path, blob, info) => {
        calls.push({ to: 'bulletin', path });
        if (unwire) unwire();
        return { error: null };
      },
      bulletinCommit: bulletinCommit(),
    });
    unwire = () => Q.configure({ bulletinUpload: null });
    await Q.addBulletin({ course: COURSE, key: KEY }, [page(1), page(2)]);
    await place(Q, 2);
    await Q.send({ force: true });
    await Q.send({ force: true });
    expect(calls.filter(c => c.to === 'work')).toEqual([]);
    expect(calls.filter(c => c.to === 'bulletin').length).toBe(1);
    expect(Q.pages().map(p => p.state)).toEqual(['uploaded', 'blocked']);
  });

  it('a full device is reported as the other kinds report it', async () => {
    store = memoryStore({ capBytes: 1000 });
    open();
    const events = [];
    Q.subscribe(e => events.push(e.kind));
    expect((await Q.addBulletin({ course: COURSE, key: KEY }, [page(1)])).ok).toBe(true);
    const full = await Q.addBulletin({ course: COURSE, key: fileId(2) }, [page(2, 900)]);
    expect(full).toMatchObject({ ok: false, reason: 'storage_full' });
    expect(store.count()).toBe(1);
    expect(Q.stats().storageFull).toBe(true);
    expect(events).toContain('storage-full');
  });

  it('Sign Out’s wipe deletes a bulletin’s pages with everything else', async () => {
    open();
    await Q.addBulletin({ course: COURSE, key: KEY }, [page(1)]);
    await Q.add({ course: COURSE, assessment: ASSESSMENT, enrollment: ENROLLMENT, submission: SUBMISSION }, [page(2)]);
    expect((await Q.wipe()).ok).toBe(true);
    expect(store.count()).toBe(0);
    expect(Q.stats().queued).toBe(0);
    // shared/supabase.js signs out through PhotoQueue.wipe(), and its own wipe takes every gb- key (the waiting bulletins).
    const supa = readFileSync(resolve(root, 'shared/supabase.js'), 'utf-8');
    expect(supa).toMatch(/q\.wipe\(\)/);
    expect(supa).toContain("key.startsWith('gb-')");
  });
});

/* ── The whole flow, through the data layer ────────────────────────────── */

describe('a photo posted from the phone, through shared/data-bulletins.js', () => {
  const CID = U(901);
  let session;
  let fake;
  let store;
  let server; // the stand-in database
  let uploads;
  let finishAnswers;
  let original;

  const calls = name => fake.calls.filter(c => c.name === name).map(c => c.params);
  const pending = () => JSON.parse(localStorage.getItem('gb-bulletins-pending-' + CID) || 'null');
  const shrunk = n => Array.from({ length: n }, (_, i) => page(i + 1));
  const PHOTO = () => [{ kind: 'photo', title: 'Board', pages: shrunk(1) }];
  const PDF = () => [{ kind: 'pdf', title: 'Reading', pages: shrunk(2) }];

  /* The app closes and opens again: the device keeps localStorage and the
     photo store; the outbox, the queue and the data layer start from them. */
  function reload() {
    if (window.PhotoQueue) window.PhotoQueue.release();
    runInThisContext(queueSource, { filename: 'shared/photo-queue.js' });
    window.PhotoQueue.configure({ store, isDemo: () => false });
    runInThisContext(outboxSource, { filename: 'shared/offline-queue.js' });
    _outboxConfigured = false;
    _workQueueWired = false;
    _bltQueueWired = false;
    _bltListening = false;
    _bltPlacing = {};
    _bltCommitting = {};
    _bltFlows = {};
    for (const k of Object.keys(_bltMem)) delete _bltMem[k];
  }
  async function quiet() {
    for (let i = 0; i < 6; i++) {
      await window.v2Queue.flush();
      await settle(5);
      await window.PhotoQueue.send({ force: true });
      await settle(5);
    }
  }

  /* The stand-in server keeps bulletins by key: the same key answers the first reply (fv_idem_check). */
  function standIn() {
    // finishIn: how long the server gives an upload (its finish_by); negative stands for one already run out.
    server = { byKey: new Map(), rows: new Map(), seq: 0, finishIn: 2 * 3600 * 1000 };
    uploads = [];
    finishAnswers = [];
    fake.on('list_bulletins', () => ({
      data: {
        bulletins: [...server.rows.values()]
          .filter(r => !r.dropped)
          .map(r => ({ ...r, files: r.files.map(f => ({ ...f })) })),
        more: false,
        can_see: 5,
        no_card: 0,
        paused: 0,
        page_on: true,
      },
      error: null,
    }));
    fake.on('post_bulletin', p => {
      if (server.byKey.has(p.p_idempotency_key)) return server.byKey.get(p.p_idempotency_key);
      const id = U(5000 + ++server.seq);
      const files = (p.p_files || []).map((f, i) => {
        const fid = U(6000 + server.seq * 10 + i);
        return {
          id: fid,
          kind: f.kind,
          title: f.title,
          page_count: f.pages,
          status: 'uploading',
          position: i + 1,
          bytes: null,
          // The server's own clock (the phone's may be faked ahead or behind).
          finish_by: new Date(performance.timeOrigin + performance.now() + server.finishIn).toISOString(),
          paths: Array.from({ length: f.pages }, (_, n) => `${CID}/${fid}/${n + 1}.jpg`),
        };
      });
      const row = {
        id,
        kind: p.p_bulletin.kind,
        body: p.p_bulletin.body || '',
        visible: !files.length,
        posted_at: files.length ? null : '2026-11-17T17:00:00Z',
        created_at: '2026-11-17T17:00:00Z',
        idempotency_key: p.p_idempotency_key,
        files,
        seen: 0,
        can_see: 5,
        reactions: { got_it: 0, done: 0, question: 0 },
      };
      server.rows.set(id, row);
      const answer = { data: { bucket: 'bulletin-files', bulletin: JSON.parse(JSON.stringify(row)) }, error: null };
      server.byKey.set(p.p_idempotency_key, answer);
      return answer;
    });
    fake.on('finish_bulletin_file', p => {
      if (finishAnswers.length) return { data: finishAnswers.shift()(p), error: null };
      const row = [...server.rows.values()].find(r => r.files.some(f => f.id === p.p_bulletin_file_id));
      if (!row || row.dropped) return { data: { file_id: p.p_bulletin_file_id, status: 'gone' }, error: null };
      const f = row.files.find(x => x.id === p.p_bulletin_file_id);
      const missing = f.paths.map((x, i) => (uploads.some(u => u[1] === x) ? 0 : i + 1)).filter(Boolean);
      if (missing.length) return { data: { file_id: f.id, bulletin: row, missing, bad: [] }, error: null };
      f.status = 'ready';
      if (row.files.every(x => x.status === 'ready')) {
        row.visible = true;
        row.posted_at = '2026-11-17T17:05:00Z';
      }
      return { data: { file_id: f.id, bulletin: JSON.parse(JSON.stringify(row)) }, error: null };
    });
    fake.on('delete_bulletin', p => {
      server.rows.delete(p.p_bulletin_id);
      return { data: { deleted: true, id: p.p_bulletin_id }, error: null };
    });
    standInStorage();
  }
  function standInStorage() {
    fake.storage = {
      from: bucket => ({
        upload: async (path, blob, opts) => {
          uploads.push([bucket, path, opts.contentType, opts.upsert]);
          return { data: { path }, error: null };
        },
      }),
    };
  }

  beforeEach(() => {
    original = { teacher: _teacherId, url: URL.createObjectURL, revoke: URL.revokeObjectURL };
    localStorage.clear();
    session = signIn();
    fake = session.fake;
    _teacherId = 'teacher-a';
    URL.createObjectURL = () => 'blob:device-photo';
    URL.revokeObjectURL = () => {};
    setOnline(true);
    store = memoryStore();
    reload();
    window.v2Queue.clear();
    clearClass(CID);
    seedClass(CID, { students: [], courseConfigs: { student_page_enabled: true } });
    standIn();
  });
  afterEach(async () => {
    setOnline(true);
    window.v2Queue.clear();
    window.PhotoQueue.release();
    session.signOut();
    clearClass(CID);
    _teacherId = original.teacher;
    URL.createObjectURL = original.url;
    URL.revokeObjectURL = original.revoke;
    localStorage.clear();
  });

  it('posted with no connection: kept on the phone as Not Sent Yet with its photo; posted once when back, then shown', async () => {
    setOnline(false);
    const out = await postBulletin(CID, { kind: 'announcement', body: 'Tonight’s board' }, PHOTO(), { queue: true });
    expect(out).toMatchObject({ ok: true, waiting: true });
    expect(out.key).toMatch(UUID);
    await settle(5);
    expect(calls('post_bulletin')).toEqual([]);
    expect(store.count()).toBe(1);
    const [waiting] = getBulletins(CID);
    expect(waiting).toMatchObject({ waiting: true, key: out.key, id: 'waiting:' + out.key, body: 'Tonight’s board' });
    expect(waiting.files.map(f => f.kind)).toEqual(['photo']);
    expect((await getBulletinWaitingPicture(out.key)).url).toBe('blob:device-photo');
    expect(window.PhotoQueue.stats()).toMatchObject({ queued: 1, blocked: 1 });
    expect(bulletinCanTakeBack(CID, out.key)).toBe(true);

    reload();
    setOnline(true);
    resumeBulletinUploads();
    await quiet();
    const posts = calls('post_bulletin');
    expect(posts.length).toBe(1);
    expect(posts[0]).toMatchObject({
      p_course_id: CID,
      p_bulletin: { kind: 'announcement', body: 'Tonight’s board' },
      p_files: [{ kind: 'photo', title: 'Board', pages: 1 }],
      p_idempotency_key: out.key,
    });
    const row = [...server.rows.values()][0];
    expect(uploads).toEqual([['bulletin-files', row.files[0].paths[0], 'image/jpeg', false]]);
    expect(calls('finish_bulletin_file')).toEqual([
      { p_bulletin_file_id: row.files[0].id, p_idempotency_key: row.files[0].id },
    ]);
    expect(row.visible).toBe(true);
    expect(store.count()).toBe(0);
    expect(pending()).toBe(null);
    await refreshBulletins(CID, { force: true });
    expect(getBulletins(CID).map(b => [b.id, b.waiting])).toEqual([[row.id, false]]);
  });

  it('the pages of a PDF go up in order, and each file is finished once', async () => {
    await postBulletin(CID, { kind: 'announcement', body: '' }, [...PDF(), ...PHOTO()], { queue: true });
    await quiet();
    const row = [...server.rows.values()][0];
    expect(uploads.map(u => u[1])).toEqual([...row.files[0].paths, ...row.files[1].paths]);
    expect(calls('finish_bulletin_file').map(c => c.p_bulletin_file_id)).toEqual([row.files[0].id, row.files[1].id]);
    expect(row.visible).toBe(true);
    expect(store.count()).toBe(0);
  });

  it('the app closed after the server answered and before the pages were placed: a list read places them', async () => {
    setOnline(false);
    const out = await postBulletin(CID, { kind: 'announcement', body: 'Lost answer' }, PHOTO(), { queue: true });
    // The server took it and its answer was lost with the page.
    fake.calls.length = 0;
    await fake.rpc('post_bulletin', {
      p_course_id: CID,
      p_bulletin: pending()[0].bulletin,
      p_files: pending()[0].files,
      p_idempotency_key: out.key,
    });
    // The page closes with the post on its way out: the outbox keeps no entry, and nothing answers it.
    localStorage.removeItem('fv-sync-queue-v1');
    reload();
    setOnline(true);
    expect(uploads).toEqual([]);
    await refreshBulletins(CID, { force: true });
    // Still shown from the device, with its photo, until students can see it.
    expect(getBulletins(CID).map(b => [b.id, b.waiting])).toEqual([['waiting:' + out.key, true]]);
    await quiet();
    expect(uploads.length).toBe(1);
    expect([...server.rows.values()][0].visible).toBe(true);
    expect(pending()).toBe(null);
    expect(store.count()).toBe(0);
  });

  it('the outbox retrying with the same key posts once, even when the first answer was lost', async () => {
    // The server makes it, then its first answer is lost on the network.
    let tries = 0;
    const rpc = fake.rpc.bind(fake);
    fake.rpc = (name, params) => {
      if (name === 'post_bulletin' && ++tries === 1) {
        return rpc(name, params).then(() => ({ data: null, error: { message: 'network: failed to fetch' } }));
      }
      return rpc(name, params);
    };
    const out = await postBulletin(CID, { kind: 'announcement', body: 'Once' }, PHOTO(), { queue: true });
    await quiet();
    reload();
    resumeBulletinUploads();
    await quiet();
    const keys = calls('post_bulletin').map(c => c.p_idempotency_key);
    expect(keys.length).toBeGreaterThanOrEqual(2);
    expect(new Set(keys)).toEqual(new Set([out.key]));
    expect(server.rows.size).toBe(1);
    expect([...server.rows.values()][0].visible).toBe(true);
    expect(uploads.length).toBe(1);
  });

  it('a page the server says is missing is uploaded again, and the file finished again', async () => {
    finishAnswers.push(p => ({ file_id: p.p_bulletin_file_id, missing: [2], bad: [] }));
    await postBulletin(CID, { kind: 'announcement', body: '' }, PDF(), { queue: true });
    await quiet();
    const row = [...server.rows.values()][0];
    expect(uploads.map(u => u[1])).toEqual([...row.files[0].paths, row.files[0].paths[1]]);
    expect(calls('finish_bulletin_file').length).toBe(2);
    expect(row.visible).toBe(true);
    expect(store.count()).toBe(0);
  });

  const returned = () => getReturnedBulletins(CID).map(e => ({ body: e.bulletin.body, message: e.message }));
  const noDesk = () => ({ from: () => ({ upload: async () => ({ error: { message: 'network: failed to fetch' } }) }) });

  const NOT_POSTED_PHOTO =
    'This bulletin was not posted. Its words are here to post again; its photo needs taking again.';

  /* One post, ever, per press of Post: whatever the server says later, the
     phone never posts a bulletin again by itself (review 2, must-fix 1). */
  describe('a file the server no longer has (gone): let go, never posted again', () => {
    const gone = p => ({ file_id: p.p_bulletin_file_id, status: 'gone' });
    afterEach(() => vi.useRealTimers());

    for (const [name, shift] of [
      ['the phone’s clock a day ahead', 24 * 3600 * 1000],
      ['the phone’s clock a day behind', -24 * 3600 * 1000],
      ['the clocks agreeing', 0],
    ]) {
      it(name + ': one post, its pages gone, its words back once', async () => {
        finishAnswers.push(gone);
        if (shift) {
          vi.useFakeTimers({ toFake: ['Date'] });
          vi.setSystemTime(new Date(Date.now() + shift));
        }
        const out = await postBulletin(CID, { kind: 'announcement', body: 'Once' }, PHOTO(), { queue: true });
        await quiet();
        await refreshBulletins(CID, { force: true });
        await quiet();
        expect(calls('post_bulletin').map(c => c.p_idempotency_key)).toEqual([out.key]);
        expect(pending()).toBe(null);
        expect(store.count()).toBe(0);
        expect(returned()).toEqual([{ body: 'Once', message: NOT_POSTED_PHOTO }]);
      });
    }

    it('with no finish_by in the server’s answer: one post, let go', async () => {
      const post = fake.rpc.bind(fake);
      fake.rpc = (n, params) =>
        post(n, params).then(res => {
          if (n === 'post_bulletin' && res && res.data) res.data.bulletin.files.forEach(f => delete f.finish_by);
          return res;
        });
      finishAnswers.push(gone);
      await postBulletin(CID, { kind: 'announcement', body: 'No finish_by' }, PHOTO(), { queue: true });
      await quiet();
      expect(calls('post_bulletin').length).toBe(1);
      expect(pending()).toBe(null);
      expect(returned().map(r => r.body)).toEqual(['No finish_by']);
    });

    it('a reload at each step: still one post, and let go once', async () => {
      setOnline(false);
      await postBulletin(CID, { kind: 'reminder', body: 'Reloads' }, PHOTO(), { queue: true });
      reload();
      setOnline(true);
      resumeBulletinUploads();
      fake.storage = noDesk();
      await window.v2Queue.flush();
      await settle(10);
      expect(pending()[0].server).toBeTruthy();
      reload();
      server.rows.clear();
      fake.storage = undefined;
      standInStorage();
      resumeBulletinUploads();
      await quiet();
      reload();
      resumeBulletinUploads();
      await refreshBulletins(CID, { force: true });
      await quiet();
      expect(calls('post_bulletin').length).toBe(1);
      expect(pending()).toBe(null);
      expect(store.count()).toBe(0);
      expect(returned()).toEqual([{ body: 'Reloads', message: NOT_POSTED_PHOTO }]);
    });

    it('a photo with no words: the teacher is still told it was not posted', async () => {
      finishAnswers.push(gone);
      await postBulletin(CID, { kind: 'announcement', body: '' }, PHOTO(), { queue: true });
      await quiet();
      expect(returned()).toEqual([{ body: '', message: NOT_POSTED_PHOTO }]);
    });
  });

  /* Must-fix 2's probe (review 1): the desktop deleted it while its photo was on its way. */
  it('deleted on the desktop while its photo was on its way: let go, never posted again, words back once', async () => {
    let fail = true;
    fake.storage = {
      from: bucket => ({
        upload: async (path, blob, opts) => {
          if (fail) return { error: { message: 'network: failed to fetch' } };
          uploads.push([bucket, path, opts.contentType, opts.upsert]);
          return { data: { path }, error: null };
        },
      }),
    };
    await postBulletin(CID, { kind: 'announcement', body: 'Wrong photo' }, PHOTO(), { queue: true });
    await quiet();
    expect(calls('post_bulletin').length).toBe(1);
    server.rows.clear(); // Delete on the desktop
    fail = false;
    await quiet();
    expect(calls('post_bulletin').length).toBe(1);
    expect(server.rows.size).toBe(0);
    expect(pending()).toBe(null);
    expect(store.count()).toBe(0);
    expect(returned()).toEqual([{ body: 'Wrong photo', message: NOT_POSTED_PHOTO }]);
    await refreshBulletins(CID, { force: true });
    await quiet();
    expect(calls('post_bulletin').length).toBe(1);
  });

  it('deleted on the desktop, seen by a list read: let go, never posted again', async () => {
    fake.storage = noDesk();
    await postBulletin(CID, { kind: 'announcement', body: 'Gone from the desk' }, PHOTO(), { queue: true });
    await window.v2Queue.flush();
    await settle(10);
    expect(pending()[0].server).toBeTruthy();
    server.rows.clear();
    await refreshBulletins(CID, { force: true });
    await settle(10);
    expect(pending()).toBe(null);
    expect(store.count()).toBe(0);
    expect(calls('post_bulletin').length).toBe(1);
  });

  it('an upload refused (403) because the desktop deleted it: let go, never posted again', async () => {
    let deleted = false;
    fake.storage = {
      from: () => ({
        upload: async () =>
          deleted
            ? { error: { message: 'new row violates row-level security policy', statusCode: '403' } }
            : { error: { message: 'network: failed to fetch' } },
      }),
    };
    await postBulletin(CID, { kind: 'announcement', body: 'Refused upload' }, PHOTO(), { queue: true });
    await quiet();
    server.rows.clear();
    deleted = true;
    await quiet();
    expect(calls('post_bulletin').length).toBe(1);
    expect(pending()).toBe(null);
    expect(store.count()).toBe(0);
    expect(returned().map(r => r.body)).toEqual(['Refused upload']);
  });

  /* Must-fix 1's probe: a list answer made before the post landed arrives after it. */
  it('a list read begun before the post landed does not post it again, three hours after Post was pressed', async () => {
    setOnline(false);
    const out = await postBulletin(CID, { kind: 'announcement', body: 'Once only' }, PHOTO(), { queue: true });
    await settle(5);
    const list = pending();
    list[0].at = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
    localStorage.setItem('gb-bulletins-pending-' + CID, JSON.stringify(list));
    setOnline(true);
    // The list read starts now (no bulletin yet) and answers only after the post has landed.
    let release;
    const held = new Promise(r => (release = r));
    const empty = {
      data: { bulletins: [], more: false, can_see: 5, no_card: 0, paused: 0, page_on: true },
      error: null,
    };
    fake.on('list_bulletins', () => held.then(() => empty));
    const reading = refreshBulletins(CID, { force: true });
    const desk = fake.storage;
    fake.storage = noDesk(); // its photo is still on its way when the old list answers
    await window.v2Queue.flush();
    await settle(10);
    expect(pending()[0].server).toBeTruthy();
    release();
    await reading;
    await settle(10);
    fake.storage = desk;
    await quiet();
    const keys = calls('post_bulletin').map(c => c.p_idempotency_key);
    expect(new Set(keys)).toEqual(new Set([out.key]));
    expect([...server.rows.values()].filter(r => r.visible).length).toBe(1);
    expect(server.rows.size).toBe(1);
  });

  it('a list without the row while its commit is in flight, past finish_by, does not post it again', async () => {
    let finishing;
    const finished = new Promise(r => (finishing = r));
    const out = await postBulletin(CID, { kind: 'announcement', body: 'In flight' }, PHOTO(), { queue: true });
    const rpc = fake.rpc.bind(fake);
    let inFlight = false;
    fake.rpc = (name, params) => {
      if (name !== 'finish_bulletin_file') return rpc(name, params);
      inFlight = true;
      return finished.then(() => rpc(name, params));
    };
    const sending = quiet();
    for (let i = 0; i < 100 && !inFlight; i++) await settle(2);
    expect(inFlight).toBe(true);
    // A list that does not show it, while the finish is in flight, with the two hours run out.
    fake.on('list_bulletins', () => ({
      data: { bulletins: [], more: false, can_see: 5, no_card: 0, paused: 0, page_on: true },
      error: null,
    }));
    const list = pending();
    list[0].server.finish_by = new Date(Date.now() - 1000).toISOString();
    localStorage.setItem('gb-bulletins-pending-' + CID, JSON.stringify(list));
    await refreshBulletins(CID, { force: true });
    finishing();
    await sending;
    await quiet();
    expect(new Set(calls('post_bulletin').map(c => c.p_idempotency_key))).toEqual(new Set([out.key]));
    expect([...server.rows.values()].filter(r => r.visible).length).toBe(1);
  });

  it('gone with the pages no longer held: the bulletin leaves the waiting list', async () => {
    setOnline(false);
    const out = await postBulletin(CID, { kind: 'announcement', body: 'Old' }, PHOTO(), { queue: true });
    await settle(5);
    // Answered long ago, then the pages left the device, and the server dropped the upload after two hours.
    const list = pending();
    list[0].server = {
      id: U(5999),
      finish_by: '2026-11-17T12:00:00.000Z',
      files: [{ id: U(6999), paths: [`${CID}/${U(6999)}/1.jpg`] }],
    };
    list[0].placed = true;
    localStorage.setItem('gb-bulletins-pending-' + CID, JSON.stringify(list));
    localStorage.removeItem('fv-sync-queue-v1');
    await window.PhotoQueue.wipe();
    reload();
    setOnline(true);
    await refreshBulletins(CID, { force: true });
    await settle(10);
    expect(pending()).toBe(null);
    expect(getBulletins(CID).some(b => b.key === out.key)).toBe(false);
    expect(store.count()).toBe(0);
    expect(returned().map(r => r.body)).toEqual(['Old']);
    expect(calls('post_bulletin')).toEqual([]);
  });

  it('a post the server refuses (22023): the waiting bulletin and its pages go, its words come back once, and the refusal is not tried again', async () => {
    fake.on('post_bulletin', () => ({
      data: null,
      error: { code: '22023', message: 'the date to stay pinned until has passed' },
    }));
    await postBulletin(CID, { kind: 'announcement', body: 'Refused words' }, PHOTO(), { queue: true });
    await quiet();
    expect(calls('post_bulletin').length).toBe(1);
    expect(pending()).toBe(null);
    expect(store.count()).toBe(0);
    expect(getBulletins(CID)).toEqual([]);
    expect(returned()).toEqual([{ body: 'Refused words', message: 'Stays Pinned Until cannot be before today.' }]);
    expect(window.v2Queue.deadLetter().filter(e => e.endpoint === 'post_bulletin')).toEqual([]);
    reload();
    resumeBulletinUploads();
    await quiet();
    expect(calls('post_bulletin').length).toBe(1);
    expect(uploads).toEqual([]);
  });

  it('words only, on the phone: a refusal that arrives after a reload gives the words back', async () => {
    setOnline(false);
    postBulletin(CID, { kind: 'announcement', body: 'Words after a reload' }, [], { queue: true });
    await settle(5);
    reload();
    resumeBulletinUploads();
    fake.on('post_bulletin', () => ({
      data: null,
      error: { code: '22023', message: "a bulletin's words can be 2000 characters at most" },
    }));
    setOnline(true);
    await quiet();
    await refreshBulletins(CID, { force: true });
    expect(returned()).toEqual([{ body: 'Words after a reload', message: 'Words can be up to 2,000 characters.' }]);
    expect(pending()).toBe(null);
  });

  it('the device out of room for the waiting entry: nothing is queued or sent, and the composer is told', async () => {
    const set = localStorage.setItem;
    localStorage.setItem = (k, v) => {
      if (String(k).startsWith('gb-bulletins-pending-')) {
        const e = new Error('full');
        e.name = 'QuotaExceededError';
        throw e;
      }
      return set.call(localStorage, k, v);
    };
    try {
      const out = await postBulletin(CID, { kind: 'announcement', body: 'No room' }, PHOTO(), { queue: true });
      expect(out).toEqual({
        ok: false,
        message: 'This phone is out of room, so the bulletin was not kept. Free some space, then post again.',
      });
    } finally {
      localStorage.setItem = set;
    }
    expect(store.count()).toBe(0);
    await quiet();
    expect(calls('post_bulletin')).toEqual([]);
  });

  it('a page a tab without bulletin uploads marked failed is tried once more at the next start', async () => {
    fake.storage = noDesk();
    await postBulletin(CID, { kind: 'announcement', body: 'Marked failed' }, PHOTO(), { queue: true });
    await window.v2Queue.flush();
    await settle(10);
    // The released queue file (no bulletin kind) refused the page and marked it failed.
    const [meta] = store.metas();
    await store.update(meta.id, { state: 'failed', attempts: 1, last_error: 'refused' });
    fake.storage = undefined;
    standIn();
    const row = (
      await fake.rpc('post_bulletin', {
        p_course_id: CID,
        p_bulletin: pending()[0].bulletin,
        p_files: pending()[0].files,
        p_idempotency_key: pending()[0].key,
      })
    ).data.bulletin;
    reload();
    resumeBulletinUploads();
    await quiet();
    expect(uploads.map(u => u[1])).toEqual(row.files[0].paths);
    expect(store.count()).toBe(0);
    expect(pending()).toBe(null);
  });

  it('a bulletin page no waiting entry holds is removed at start; one queued in the last five minutes is left', async () => {
    await window.PhotoQueue.ready();
    const old = await window.PhotoQueue.addBulletin({ course: CID, key: crypto.randomUUID() }, [page(1)]);
    await store.update(old.ids[0], { queued_at: Date.now() - 6 * 60 * 1000 });
    const fresh = await window.PhotoQueue.addBulletin({ course: CID, key: crypto.randomUUID() }, [page(2)]);
    reload();
    resumeBulletinUploads();
    await settle(20);
    expect(store.metas().map(m => m.id)).toEqual(fresh.ids);
  });

  it('the sweep does nothing in a pass that cannot read the waiting entries', async () => {
    await window.PhotoQueue.ready();
    const old = await window.PhotoQueue.addBulletin({ course: CID, key: crypto.randomUUID() }, [page(1)]);
    await store.update(old.ids[0], { queued_at: Date.now() - 6 * 60 * 1000 });
    const get = localStorage.getItem;
    localStorage.setItem('gb-bulletins-pending-' + CID, '[]');
    localStorage.getItem = k => {
      if (String(k).startsWith('gb-bulletins-pending-')) throw new Error('storage blocked');
      return get.call(localStorage, k);
    };
    try {
      await _bltSweepOrphans();
    } finally {
      localStorage.getItem = get;
    }
    expect(store.count()).toBe(1);
  });

  /* Review 2, must-fix 2: the post held, a list read took the server's row meanwhile, the photo went up
     and was finished, and the waiting entry was gone by the time OK was tapped. */
  it('Take It Back once it has reached students: it is deleted through the outbox, and the state says so', async () => {
    let answer;
    const slow = new Promise(r => (answer = r));
    const rpc = fake.rpc.bind(fake);
    fake.rpc = (name, params) => {
      if (name !== 'post_bulletin') return rpc(name, params);
      // The server makes it at once; its answer to the phone comes later.
      const made = rpc(name, params);
      return slow.then(() => made);
    };
    const out = await postBulletin(CID, { kind: 'announcement', body: 'Too late' }, PHOTO(), { queue: true });
    const flushing = window.v2Queue.flush();
    await settle(5);
    expect(bulletinTakeBackState(CID, out.key)).toBe('waiting');
    await refreshBulletins(CID, { force: true }); // the list read takes the server's row
    for (let i = 0; i < 4; i++) {
      await settle(5);
      await window.PhotoQueue.send({ force: true });
    }
    expect(pending()).toBe(null); // its photo went up and was finished while the post was in flight
    answer();
    await flushing;
    await quiet();
    await refreshBulletins(CID, { force: true });
    expect(pending()).toBe(null);
    expect([...server.rows.values()][0].visible).toBe(true);
    expect(bulletinTakeBackState(CID, out.key)).toBe('sent');
    expect(takeBackBulletin(CID, out.key)).toBe(true);
    await quiet();
    expect(calls('delete_bulletin').length).toBe(1);
    expect(calls('delete_bulletin')[0].p_idempotency_key).toMatch(UUID);
    expect(server.rows.size).toBe(0);
    expect(getBulletins(CID)).toEqual([]);
  });

  it('taken back while its post is in flight: the card goes at once, nothing uploads, and the bulletin the server made is deleted', async () => {
    let answer;
    const slow = new Promise(r => (answer = r));
    const rpc = fake.rpc.bind(fake);
    fake.rpc = (name, params) => (name === 'post_bulletin' ? slow.then(() => rpc(name, params)) : rpc(name, params));
    const out = await postBulletin(CID, { kind: 'announcement', body: 'Not this one' }, PHOTO(), { queue: true });
    const flushing = window.v2Queue.flush();
    await settle(5);
    expect(window.v2Queue.has(out.key)).toBe(true); // in flight: the outbox cannot take it out
    expect(takeBackBulletin(CID, out.key)).toBe(true);
    expect(getBulletins(CID)).toEqual([]);
    await settle(10);
    expect(store.count()).toBe(0);
    answer();
    await flushing;
    await quiet();
    const row = [...server.rows.values()];
    expect(row).toEqual([]);
    expect(calls('delete_bulletin').length).toBe(1);
    expect(calls('delete_bulletin')[0].p_idempotency_key).toMatch(UUID);
    expect(uploads).toEqual([]);
    expect(calls('finish_bulletin_file')).toEqual([]);
    expect(pending()).toBe(null);
    await refreshBulletins(CID, { force: true });
    expect(getBulletins(CID)).toEqual([]);
  });

  it('taken back in flight, then the app closed before the answer: the next start deletes it, and it never shows', async () => {
    let answer;
    const slow = new Promise(r => (answer = r));
    const rpc = fake.rpc.bind(fake);
    fake.rpc = (name, params) => (name === 'post_bulletin' ? slow.then(() => rpc(name, params)) : rpc(name, params));
    const out = await postBulletin(CID, { kind: 'announcement', body: 'Closed mid-way' }, PHOTO(), { queue: true });
    window.v2Queue.flush();
    await settle(5);
    expect(takeBackBulletin(CID, out.key)).toBe(true);
    expect(pending()[0].takenBack).toBe(true);
    // The server makes it, and the page is gone before the answer arrives.
    answer();
    await settle(5);
    localStorage.removeItem('fv-sync-queue-v1');
    fake.rpc = rpc;
    reload();
    expect(getBulletins(CID)).toEqual([]);
    resumeBulletinUploads();
    await quiet();
    expect(server.rows.size).toBe(0);
    expect(uploads).toEqual([]);
    expect(pending()).toBe(null);
  });

  it('a delete of a taken-back bulletin that fails is tried again through the outbox', async () => {
    fake.storage = noDesk();
    const out = await postBulletin(CID, { kind: 'announcement', body: 'Try again' }, PHOTO(), { queue: true });
    await window.v2Queue.flush();
    await settle(10);
    let first = true;
    fake.on('delete_bulletin', p => {
      if (first) {
        first = false;
        return { data: null, error: { message: 'network: failed to fetch' } };
      }
      server.rows.delete(p.p_bulletin_id);
      return { data: { deleted: true, id: p.p_bulletin_id }, error: null };
    });
    expect(takeBackBulletin(CID, out.key)).toBe(true);
    await quiet();
    await new Promise(r => setTimeout(r, 1100));
    await quiet();
    expect(server.rows.size).toBe(0);
    const keys = calls('delete_bulletin').map(c => c.p_idempotency_key);
    expect(keys.length).toBeGreaterThanOrEqual(1);
    expect(new Set(keys).size).toBe(1);
    expect(pending()).toBe(null);
  });

  describe('on a page without shared/data-bulletins-queue.js (the desktop)', () => {
    const hooks = ['_bltQueuedPost', '_bltQueuedView', '_bltQueuedSeenAll', '_bltQueuedEvent', '_bltQueuedTakeBack'];
    let saved;
    beforeEach(() => {
      saved = hooks.map(h => globalThis[h]);
      hooks.forEach(h => (globalThis[h] = undefined));
    });
    afterEach(() => hooks.forEach((h, i) => (globalThis[h] = saved[i])));

    it('a post with { queue: true } goes the desktop’s online way, and a queued entry from the phone is left alone', async () => {
      const list = [
        {
          key: crypto.randomUUID(),
          at: new Date().toISOString(),
          bulletin: { kind: 'announcement', body: 'From the phone' },
          files: [{ kind: 'photo', title: 'Board', pages: 1 }],
          queued: true,
        },
      ];
      localStorage.setItem('gb-bulletins-pending-' + CID, JSON.stringify(list));
      await refreshBulletins(CID, { force: true });
      expect(pending().length).toBe(1);
      expect(getBulletins(CID).map(b => b.body)).toEqual(['From the phone']);
      expect(takeBackBulletin(CID, list[0].key)).toBe(false);
      const out = await postBulletin(CID, { kind: 'announcement', body: 'Desk' }, PHOTO(), { queue: true });
      expect(out.ok).toBe(true);
      expect(store.count()).toBe(0);
      expect(uploads.length).toBe(1);
    });
  });

  it('taken back before it went: out of the outbox, its pages off the phone, nothing ever sent', async () => {
    setOnline(false);
    const out = await postBulletin(CID, { kind: 'announcement', body: 'Oops' }, PHOTO(), { queue: true });
    await settle(5);
    expect(takeBackBulletin(CID, out.key)).toBe(true);
    await settle(5);
    expect(window.v2Queue.has(out.key)).toBe(false);
    expect(pending()).toBe(null);
    expect(store.count()).toBe(0);
    setOnline(true);
    await quiet();
    expect(calls('post_bulletin')).toEqual([]);
    expect(uploads).toEqual([]);
  });

  it('taken back after the post landed and before its photo went up: deleted on the server, pages gone', async () => {
    fake.storage = { from: () => ({ upload: async () => ({ error: { message: 'network: failed to fetch' } }) }) };
    const out = await postBulletin(CID, { kind: 'announcement', body: 'Half' }, PHOTO(), { queue: true });
    await window.v2Queue.flush();
    await settle(10);
    const row = [...server.rows.values()][0];
    expect(pending()[0].server.id).toBe(row.id);
    expect(bulletinCanTakeBack(CID, out.key)).toBe(true);
    expect(takeBackBulletin(CID, out.key)).toBe(true);
    await quiet();
    expect(calls('delete_bulletin').map(c => c.p_bulletin_id)).toEqual([row.id]);
    expect(store.count()).toBe(0);
    expect(pending()).toBe(null);
    expect(calls('finish_bulletin_file')).toEqual([]);
  });

  it('a full phone: nothing is kept or sent, and the teacher is told on the screen that asked', async () => {
    store = memoryStore({ capBytes: 100 });
    reload();
    const out = await postBulletin(CID, { kind: 'announcement', body: 'Big' }, PHOTO(), { queue: true });
    expect(out).toEqual({ ok: false, message: 'This phone is full. Free some space, then try again.' });
    expect(window.PhotoQueue.stats().storageFull).toBe(true);
    expect(pending()).toBe(null);
    await quiet();
    expect(calls('post_bulletin')).toEqual([]);
  });

  it('a bulletin with no file still goes the B1c way, through the outbox only', async () => {
    const out = await postBulletin(CID, { kind: 'announcement', body: 'Words only' }, [], { queue: true });
    expect(out.ok).toBe(true);
    expect(store.count()).toBe(0);
    expect(calls('post_bulletin').length).toBe(1);
  });
});
