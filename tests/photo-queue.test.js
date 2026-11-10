/**
 * shared/photo-queue.js: photos waiting to send.
 *
 * The queue is written against a small store (list, putAll, update, blobs,
 * remove, clear). These tests give it one kept in memory; loading the file
 * again over the same store stands for a reload, and loading it twice for
 * two tabs. The real IndexedDB store is exercised in a browser by
 * e2e/photo-modules.spec.js.
 *
 * Every upload in every test here goes through one check (afterEach): the
 * path's five parts must all be server ids by shared/data.js's own test
 * (_isUuid). A local id in a storage path fails the test it happened in.
 */
import { readFileSync } from 'node:fs';
import { runInThisContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const source = readFileSync(new URL('../shared/photo-queue.js', import.meta.url), 'utf-8');

const COURSE = '11111111-1111-4111-8111-111111111111';
const ASSESSMENT = '22222222-2222-4222-8222-222222222222';
const ENROLLMENT = '33333333-3333-4333-8333-333333333333';
const SUBMISSION = '44444444-4444-4444-8444-444444444444';
const SUBMISSION_2 = '55555555-5555-4555-8555-555555555555';
const fileId = n => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;
// Ids as the app mints them before the server answers (CLAUDE.md rule 6).
const LOCAL_SUBMISSION = 'sm' + (1731200000000).toString(36) + 'k3x';
const LOCAL_ASSESSMENT = 'a' + (1731200000001).toString(36) + '9qd';

const SERVER_REF = { course: COURSE, assessment: ASSESSMENT, enrollment: ENROLLMENT, submission: SUBMISSION };
const LOCAL_REF = { ...SERVER_REF, submission: LOCAL_SUBMISSION };

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

function deferred() {
  let resolve;
  const promise = new Promise(r => (resolve = r));
  return { promise, resolve };
}

function setOnline(value) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => value });
}

function page(n, bytes = 400) {
  return {
    blob: new Blob([new Uint8Array(bytes).fill(n)], { type: 'image/jpeg' }),
    thumb: new Blob([new Uint8Array(40).fill(n)], { type: 'image/jpeg' }),
    hash: 'hash-' + n,
    width: 2000,
    height: 1500,
    name: 'page-' + n + '.jpg',
  };
}

/* The store, in memory. It hands out copies, as IndexedDB does, so nothing
   is saved unless the queue saves it. capBytes makes the device "full". */
function memoryStore({ capBytes = Infinity } = {}) {
  const metas = new Map();
  const files = new Map();
  const copy = v => JSON.parse(JSON.stringify(v));
  const used = () => [...files.values()].reduce((n, f) => n + f.photo.size + f.thumb.size, 0);
  const store = {
    capBytes,
    failWith: null,
    updates: [],
    async list() {
      if (store.failWith) throw store.failWith;
      return [...metas.values()].map(copy);
    },
    async putAll(items) {
      if (store.failWith) throw store.failWith;
      const size = items.reduce((n, i) => n + i.photo.size + i.thumb.size, 0);
      if (used() + size > store.capBytes) {
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
      store.updates.push({ id, patch: copy(patch) });
      if (metas.has(id)) metas.set(id, window.PhotoQueue.applyPatch(copy(metas.get(id)), copy(patch)));
    },
    async blobs(id) {
      const f = files.get(id);
      return f ? { photo: f.photo, thumb: f.thumb } : null;
    },
    async remove(ids) {
      ids.forEach(id => {
        metas.delete(id);
        files.delete(id);
      });
    },
    async clear() {
      if (store.failWith) throw store.failWith;
      metas.clear();
      files.clear();
    },
    // For the tests to look inside.
    count: () => metas.size,
    has: id => files.has(id),
    peek: id => (metas.has(id) ? copy(metas.get(id)) : null),
  };
  return store;
}

describe('PhotoQueue', () => {
  let tabs;
  let violations;
  let store;
  let realLocks;

  /* Load the file as a page would. keep: the tab already open stays open
     (a second tab); otherwise the old one is let go (a reload). */
  function openTab({ keep = false } = {}) {
    if (keep) window.PhotoQueue = undefined;
    runInThisContext(source, { filename: 'shared/photo-queue.js' });
    tabs.push(window.PhotoQueue);
    return window.PhotoQueue;
  }

  /* An uploader that records what it was given. answer(call) may return an
     error or a promise. Every path is checked for local ids. */
  function uploader(answer) {
    const calls = [];
    const fn = async (path, blob, info) => {
      const parts = path.replace(/(-thumb)?\.jpg$/, '').split('/');
      if (parts.length !== 5 || !parts.every(p => _isUuid(p))) violations.push(path);
      const call = { path, size: blob.size, part: info.part, id: info.id, order: info.order, n: calls.length + 1 };
      calls.push(call);
      return (answer && (await answer(call))) || { error: null };
    };
    fn.calls = calls;
    return fn;
  }

  /* Give every waiting page of a tab its server file id, as the submission's
     answer from the server would. */
  async function serverFileIds(tab, from = 1) {
    const map = {};
    tab.pages().forEach((p, i) => {
      if (tab.isLocalId(p.ids.file)) map[p.ids.file] = fileId(from + i);
    });
    return tab.rekey(map);
  }

  beforeEach(() => {
    tabs = [];
    violations = [];
    store = memoryStore();
    realLocks = navigator.locks;
    localStorage.clear();
    setOnline(true);
    globalThis.isDemoMode = () => false;
  });

  afterEach(() => {
    tabs.forEach(tab => tab.release());
    window.PhotoQueue = undefined;
    Object.defineProperty(navigator, 'locks', { value: realLocks, configurable: true, writable: true });
    vi.restoreAllMocks();
    vi.useRealTimers();
    // No upload, in any test, went to a path holding a local id.
    expect(violations).toEqual([]);
  });

  /* ── Paths and ids ──────────────────────────────────────────────────── */

  describe('storage paths', () => {
    it('are <course>/<assessment>/<enrollment>/<submission>/<file>.jpg, the thumbnail beside it', () => {
      const Q = openTab();
      const ids = { ...SERVER_REF, file: fileId(1) };
      expect(Q.pathFor(ids)).toBe(`${COURSE}/${ASSESSMENT}/${ENROLLMENT}/${SUBMISSION}/${fileId(1)}.jpg`);
      expect(Q.thumbPathFor(ids)).toBe(`${COURSE}/${ASSESSMENT}/${ENROLLMENT}/${SUBMISSION}/${fileId(1)}-thumb.jpg`);
    });

    it('cannot be built while any id is local or missing', () => {
      const Q = openTab();
      const ids = { ...SERVER_REF, file: fileId(1) };
      ['course', 'assessment', 'enrollment', 'submission', 'file'].forEach(key => {
        expect(() => Q.pathFor({ ...ids, [key]: LOCAL_SUBMISSION })).toThrow(/server id/);
        expect(() => Q.thumbPathFor({ ...ids, [key]: Q.newLocalId() })).toThrow(/server id/);
        expect(() => Q.pathFor({ ...ids, [key]: undefined })).toThrow(/server id/);
        expect(() => Q.pathFor({ ...ids, [key]: '../' + COURSE })).toThrow(/server id/);
      });
    });

    it("tells server ids from local ones the way shared/data.js's _isUuid does", () => {
      const Q = openTab();
      const samples = [COURSE, fileId(7), COURSE.toUpperCase(), LOCAL_SUBMISSION, LOCAL_ASSESSMENT, Q.newLocalId()];
      samples.push('c' + Date.now().toString(36) + 'ab1', 's1731200000000k3x9', '', COURSE + '0', COURSE.slice(1));
      samples.forEach(id => {
        expect(Q.isServerId(id)).toBe(_isUuid(id));
        expect(Q.isLocalId(id)).toBe(!!id && !_isUuid(id));
      });
      expect(Q.isServerId(null)).toBe(false);
      expect(Q.isLocalId(null)).toBe(false);
      expect(Q.newLocalId()).toMatch(/^p[0-9a-z]+$/);
    });
  });

  /* ── Adding ─────────────────────────────────────────────────────────── */

  describe('adding pages', () => {
    it('keeps each page under a local id, with what it belongs to and its place in order', async () => {
      const Q = openTab();
      Q.configure({ store });
      const res = await Q.add(LOCAL_REF, [page(1), page(2)]);
      expect(res.ok).toBe(true);
      expect(res.ids).toHaveLength(2);
      res.ids.forEach(id => expect(Q.isLocalId(id)).toBe(true));
      expect(store.count()).toBe(2);

      const rows = Q.pages(LOCAL_SUBMISSION);
      expect(rows.map(r => r.id)).toEqual(res.ids);
      expect(rows.map(r => r.order)).toEqual([0, 1]);
      expect(rows.map(r => r.name)).toEqual(['page-1.jpg', 'page-2.jpg']);
      expect(rows.map(r => r.hash)).toEqual(['hash-1', 'hash-2']);
      expect(rows[0].ids).toEqual({ ...LOCAL_REF, file: res.ids[0] });
      expect(rows[0]).toMatchObject({ batch: res.batch, bytes: 400, width: 2000, height: 1500, state: 'blocked' });
      expect(Q.pages('some-other-submission')).toEqual([]);
      expect(Q.stats()).toMatchObject({ queued: 2, blocked: 2, failed: 0, storageFull: false });

      const kept = await Q.blobs(res.ids[1]);
      expect(kept.photo.size).toBe(400);
      expect(kept.thumb.size).toBe(40);
      expect(new Uint8Array(await kept.photo.arrayBuffer())[0]).toBe(2);
      expect(await Q.blobs('nope')).toBe(null);
    });

    it('numbers added pages after the ones already there when told where to start', async () => {
      const Q = openTab();
      Q.configure({ store });
      await Q.add({ ...LOCAL_REF, firstOrder: 3 }, [page(1), { ...page(2), order: 9 }]);
      expect(Q.pages().map(r => r.order)).toEqual([3, 9]);
    });

    it('refuses what is not a set of pages for a submission', async () => {
      const Q = openTab();
      Q.configure({ store });
      expect(await Q.add(null, [page(1)])).toEqual({ ok: false, reason: 'invalid' });
      expect(await Q.add({ ...LOCAL_REF, submission: '' }, [page(1)])).toEqual({ ok: false, reason: 'invalid' });
      expect(await Q.add(LOCAL_REF, [])).toEqual({ ok: false, reason: 'invalid' });
      expect(await Q.add(LOCAL_REF, [{ blob: page(1).blob }])).toEqual({ ok: false, reason: 'invalid' });
      expect(await Q.add(LOCAL_REF, [{ ...page(1), blob: new Blob([]) }])).toEqual({ ok: false, reason: 'invalid' });
      expect(store.count()).toBe(0);
    });

    it('reports a full device: nothing half-kept, storage_full answered, and the state says so', async () => {
      store = memoryStore({ capBytes: 1000 });
      const Q = openTab();
      Q.configure({ store });
      const events = [];
      Q.subscribe(e => events.push(e));
      expect((await Q.add(LOCAL_REF, [page(1)])).ok).toBe(true);

      // Two more pages do not fit. Neither is kept.
      const res = await Q.add(LOCAL_REF, [page(2), page(3)]);
      expect(res).toMatchObject({ ok: false, reason: 'storage_full' });
      expect(res.error).toMatch(/quota/i);
      expect(store.count()).toBe(1);
      expect(Q.stats()).toMatchObject({ queued: 1, storageFull: true });
      const told = events.filter(e => e.kind === 'storage-full');
      expect(told).toHaveLength(1);
      expect(told[0].stats.storageFull).toBe(true);

      // Space freed: the next page fits and the flag clears.
      store.capBytes = Infinity;
      expect((await Q.add(LOCAL_REF, [page(2)])).ok).toBe(true);
      expect(Q.stats().storageFull).toBe(false);
    });

    it('reports a store that fails for another reason', async () => {
      const Q = openTab();
      Q.configure({ store });
      await Q.ready();
      store.failWith = new Error('The database is closing');
      const res = await Q.add(LOCAL_REF, [page(1)]);
      expect(res).toEqual({ ok: false, reason: 'store_failed', error: 'The database is closing' });
      expect(Q.stats().storeError).toBe('The database is closing');
    });

    it('says so where there is no IndexedDB at all', async () => {
      expect(typeof indexedDB).toBe('undefined');
      const Q = openTab();
      await expect(Q.indexedDbStore().list()).rejects.toThrow(/nowhere to keep photos/);
      const res = await Q.add(LOCAL_REF, [page(1)]);
      expect(res).toMatchObject({ ok: false, reason: 'store_failed' });
      expect(Q.stats().storeError).toMatch(/nowhere to keep photos/);
    });
  });

  /* ── Server ids first ───────────────────────────────────────────────── */

  describe('a page uploads only after its record has server ids', () => {
    it('waits while the submission has a local id, then goes to a path built from server ids', async () => {
      const Q = openTab();
      const upload = uploader();
      Q.configure({ store, upload });
      const { ids } = await Q.add(LOCAL_REF, [page(1)]);

      expect(await Q.send()).toMatchObject({ sent: 0, failed: 0, note: null });
      expect(upload.calls).toEqual([]);
      expect(Q.pages()[0].state).toBe('blocked');

      // The submission came back from the server; the file row has not.
      expect(await Q.rekey(LOCAL_SUBMISSION, SUBMISSION)).toEqual({ ok: true, changed: 1 });
      await Q.send();
      expect(upload.calls).toEqual([]);
      expect(Q.pages(SUBMISSION)[0].state).toBe('blocked');

      // Now the file has its server id too.
      await Q.rekey(ids[0], fileId(1));
      expect(Q.pages()[0].state).toBe('waiting');
      expect(await Q.send()).toMatchObject({ sent: 1, failed: 0 });
      const folder = `${COURSE}/${ASSESSMENT}/${ENROLLMENT}/${SUBMISSION}`;
      expect(upload.calls.map(c => c.path)).toEqual([`${folder}/${fileId(1)}.jpg`, `${folder}/${fileId(1)}-thumb.jpg`]);
      expect(upload.calls.map(c => c.size)).toEqual([400, 40]);
      expect(upload.calls.map(c => c.part)).toEqual(['photo', 'thumb']);
    });

    it('waits for every id: a class or assessment made offline blocks its photos too', async () => {
      const Q = openTab();
      const upload = uploader();
      Q.configure({ store, upload });
      await Q.add({ ...SERVER_REF, assessment: LOCAL_ASSESSMENT }, [page(1), page(2)]);
      await serverFileIds(Q);
      await Q.send();
      expect(upload.calls).toEqual([]);
      expect(Q.stats()).toMatchObject({ queued: 2, blocked: 2 });

      expect(await Q.rekey({ [LOCAL_ASSESSMENT]: ASSESSMENT })).toEqual({ ok: true, changed: 2 });
      expect(await Q.send()).toMatchObject({ sent: 2 });
      expect(upload.calls).toHaveLength(4);
    });

    it('never takes a local-shaped id as a server id', async () => {
      const Q = openTab();
      const upload = uploader();
      Q.configure({ store, upload });
      const { ids } = await Q.add(LOCAL_REF, [page(1)]);
      const stillLocal = 'c' + Date.now().toString(36) + 'x7q';
      expect(await Q.rekey(LOCAL_SUBMISSION, stillLocal)).toEqual({
        ok: false,
        reason: 'not_a_server_id',
        id: LOCAL_SUBMISSION,
      });
      expect(await Q.rekey({ [ids[0]]: fileId(1), [LOCAL_SUBMISSION]: undefined })).toMatchObject({ ok: false });
      await Q.send({ force: true });
      expect(upload.calls).toEqual([]);
      expect(store.peek(ids[0]).ids).toEqual({ ...LOCAL_REF, file: ids[0] });
    });

    it('fails this file if an upload path ever holds a local id', async () => {
      // The check itself: a path with a local part is caught by the uploader every test uses.
      const upload = uploader();
      await upload(`${COURSE}/${ASSESSMENT}/${ENROLLMENT}/${LOCAL_SUBMISSION}/${fileId(1)}.jpg`, page(1).blob, {});
      await upload(
        `${COURSE}/${ASSESSMENT}/${ENROLLMENT}/${SUBMISSION}/p${Date.now().toString(36)}.jpg`,
        page(1).blob,
        {},
      );
      await upload(`${COURSE}/${ASSESSMENT}/${ENROLLMENT}/${SUBMISSION}/${fileId(1)}-thumb.jpg`, page(1).blob, {});
      expect(violations).toHaveLength(2);
      violations.length = 0;
    });
  });

  /* ── Sending ────────────────────────────────────────────────────────── */

  describe('sending', () => {
    it('sends in order: the oldest send first, its pages first to last, each page then its thumbnail', async () => {
      const Q = openTab();
      const upload = uploader();
      Q.configure({ store, upload });
      let now = 1000;
      vi.spyOn(Date, 'now').mockImplementation(() => now);
      // Given out of order on purpose: order decides, not the list.
      await Q.add(SERVER_REF, [
        { ...page(3), order: 2 },
        { ...page(1), order: 0 },
        { ...page(2), order: 1 },
      ]);
      now = 2000;
      await Q.add({ ...SERVER_REF, submission: SUBMISSION_2 }, [page(4), page(5)]);
      await serverFileIds(Q);

      expect(await Q.send()).toMatchObject({ sent: 5, failed: 0 });
      const seen = upload.calls.map(c => [c.path.split('/')[3], c.order, c.part]);
      expect(seen).toEqual([
        [SUBMISSION, 0, 'photo'],
        [SUBMISSION, 0, 'thumb'],
        [SUBMISSION, 1, 'photo'],
        [SUBMISSION, 1, 'thumb'],
        [SUBMISSION, 2, 'photo'],
        [SUBMISSION, 2, 'thumb'],
        [SUBMISSION_2, 0, 'photo'],
        [SUBMISSION_2, 0, 'thumb'],
        [SUBMISSION_2, 1, 'photo'],
        [SUBMISSION_2, 1, 'thumb'],
      ]);
    });

    it('deletes a page from the device only after the server has it', async () => {
      const Q = openTab();
      const held = deferred();
      const upload = uploader(call => (call.part === 'thumb' ? held.promise : null));
      Q.configure({ store, upload });
      const { ids } = await Q.add(SERVER_REF, [page(1)]);
      await serverFileIds(Q);

      const sending = Q.send();
      await settle();
      // The page is up, its thumbnail is on its way: still on the device.
      expect(upload.calls.map(c => c.part)).toEqual(['photo', 'thumb']);
      expect(store.has(ids[0])).toBe(true);
      expect(Q.pages()[0].state).toBe('sending');
      expect(Q.stats()).toMatchObject({ queued: 1, sending: 1, flushing: true });

      held.resolve({ error: null });
      expect(await sending).toMatchObject({ sent: 1 });
      expect(store.has(ids[0])).toBe(false);
      expect(store.count()).toBe(0);
      expect(Q.stats()).toMatchObject({ queued: 0, sending: 0, flushing: false });
    });

    it('counts "already there" as sent: an earlier try landed and its answer was lost', async () => {
      const Q = openTab();
      const upload = uploader(call =>
        call.part === 'photo'
          ? { error: { message: 'The resource already exists', statusCode: '409' } }
          : { error: { message: 'Duplicate' } },
      );
      Q.configure({ store, upload });
      await Q.add(SERVER_REF, [page(1)]);
      await serverFileIds(Q);
      expect(await Q.send()).toMatchObject({ sent: 1, failed: 0 });
      expect(store.count()).toBe(0);
    });

    it('does nothing without an uploader, and nothing offline', async () => {
      const Q = openTab();
      Q.configure({ store });
      await Q.add(SERVER_REF, [page(1)]);
      await serverFileIds(Q);
      expect(await Q.send()).toMatchObject({ sent: 0, note: 'not_configured' });

      const upload = uploader();
      Q.configure({ upload });
      setOnline(false);
      expect(await Q.send()).toMatchObject({ sent: 0, note: 'offline' });
      expect(upload.calls).toEqual([]);
      expect(Q.stats()).toMatchObject({ queued: 1, online: false });

      setOnline(true);
      expect(await Q.send()).toMatchObject({ sent: 1, note: null });
    });

    it('stops a pass when the connection drops, and keeps what is left', async () => {
      const Q = openTab();
      const upload = uploader(call => {
        if (call.n === 2) setOnline(false);
        return null;
      });
      Q.configure({ store, upload });
      await Q.add(SERVER_REF, [page(1), page(2), page(3)]);
      await serverFileIds(Q);
      expect(await Q.send()).toMatchObject({ sent: 1 });
      expect(store.count()).toBe(2);
    });

    it('two send() calls at once in one tab upload each file once', async () => {
      const Q = openTab();
      const upload = uploader();
      Q.configure({ store, upload });
      await Q.add(SERVER_REF, [page(1), page(2)]);
      await serverFileIds(Q);
      await Promise.all([Q.send(), Q.send(), Q.send()]);
      expect(upload.calls.map(c => c.path).sort()).toEqual([...new Set(upload.calls.map(c => c.path))].sort());
      expect(upload.calls).toHaveLength(4);
      expect(store.count()).toBe(0);
    });

    it('pages added while a pass is finishing go out in a pass of their own', async () => {
      const Q = openTab();
      const upload = uploader();
      const held = deferred();
      let commits = 0;
      const commit = async () => (++commits === 1 ? held.promise : { error: null });
      Q.configure({ store, upload, commit });
      await Q.add(SERVER_REF, [page(1)]);
      await serverFileIds(Q, 1);
      const first = Q.send();
      await settle();
      await settle();
      // The pass has taken its last look at the queue and is committing.
      expect(commits).toBe(1);

      await Q.add({ ...SERVER_REF, submission: SUBMISSION_2 }, [page(2)]);
      await serverFileIds(Q, 2);
      const second = Q.send();
      held.resolve({ error: null });
      const [a, b] = await Promise.all([first, second]);
      expect(a).toBe(b);
      expect(a).toMatchObject({ sent: 2, committed: 2 });
      expect(upload.calls).toHaveLength(4);
      expect(store.count()).toBe(0);
    });

    it('tells subscribers as things change, with the same counts stats() gives', async () => {
      const Q = openTab();
      Q.configure({ store, upload: uploader() });
      const events = [];
      const stop = Q.subscribe(e => events.push(e));
      expect(Q.subscribe('not a function')).toBeTypeOf('function');
      await Q.add(SERVER_REF, [page(1)]);
      await serverFileIds(Q);
      await Q.send();
      expect(events.map(e => e.kind)).toEqual(['add', 'rekey', 'send:start', 'sent', 'send:end']);
      expect(events[0].stats).toMatchObject({ queued: 1, blocked: 1 });
      expect(events[2].stats).toMatchObject({ queued: 1, sending: 1 });
      expect(events[3].stats).toMatchObject({ queued: 0, sending: 0 });
      expect(events[4].meta).toMatchObject({ sent: 1 });

      stop();
      await Q.add(SERVER_REF, [page(2)]);
      expect(events).toHaveLength(5);
    });
  });

  /* ── A failed page ──────────────────────────────────────────────────── */

  describe('a page that fails', () => {
    it('is kept and retried, and the other pages still go', async () => {
      const Q = openTab();
      let down = true;
      const upload = uploader(call =>
        down && call.order === 1 ? { error: { message: 'TypeError: Failed to fetch' } } : null,
      );
      Q.configure({ store, upload });
      let now = 50000;
      vi.spyOn(Date, 'now').mockImplementation(() => now);
      const { ids } = await Q.add(SERVER_REF, [page(1), page(2), page(3)]);
      await serverFileIds(Q);

      expect(await Q.send()).toMatchObject({ sent: 2, failed: 1 });
      // One Page Didn't Send: page 2 is still here, with its bytes, and says why.
      expect(store.count()).toBe(1);
      expect(store.has(ids[1])).toBe(true);
      const rows = Q.pages(SUBMISSION);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: ids[1], order: 1, state: 'retrying', attempts: 1, slow: false });
      expect(rows[0].error).toMatch(/Failed to fetch/);
      expect(Q.stats()).toMatchObject({ queued: 1, retrying: 1, failed: 0, slow: 0 });

      // Too soon: the backoff has not ended.
      down = false;
      const before = upload.calls.length;
      now += 999;
      expect(await Q.send()).toMatchObject({ sent: 0, failed: 0 });
      expect(upload.calls).toHaveLength(before);

      now += 1;
      expect(await Q.send()).toMatchObject({ sent: 1, failed: 0 });
      expect(store.count()).toBe(0);
      expect(Q.pages(SUBMISSION)).toEqual([]);
    });

    it('backs off 1 s, 5 s, 30 s, then 60 s for as long as it takes, and counts as slow after five tries', async () => {
      const Q = openTab();
      const upload = uploader(() => ({ error: { message: 'Service unavailable', status: 503 } }));
      Q.configure({ store, upload });
      let now = 1000000;
      vi.spyOn(Date, 'now').mockImplementation(() => now);
      const { ids } = await Q.add(SERVER_REF, [page(1)]);
      await serverFileIds(Q);
      expect(Q.BACKOFF_MS).toEqual([1000, 5000, 30000, 60000]);

      const waits = [];
      for (let attempt = 1; attempt <= 6; attempt++) {
        await Q.send();
        const meta = store.peek(ids[0]);
        expect(meta.attempts).toBe(attempt);
        expect(meta.state).toBe('waiting');
        waits.push(meta.next_at - now);
        expect(Q.pages()[0].slow).toBe(attempt >= Q.SLOW_AFTER);
        now = meta.next_at;
      }
      expect(waits).toEqual([1000, 5000, 30000, 60000, 60000, 60000]);
      expect(Q.stats()).toMatchObject({ queued: 1, retrying: 1, slow: 1, failed: 0 });
      expect(store.has(ids[0])).toBe(true);
    });

    it('tries again by itself when the backoff ends', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
      const Q = openTab();
      let down = true;
      const upload = uploader(() => (down ? { error: { message: 'network error' } } : null));
      Q.configure({ store, upload });
      await Q.add(SERVER_REF, [page(1)]);
      await serverFileIds(Q);
      expect(await Q.send()).toMatchObject({ failed: 1 });
      down = false;

      await vi.advanceTimersByTimeAsync(900);
      expect(store.count()).toBe(1);
      await vi.advanceTimersByTimeAsync(200);
      expect(store.count()).toBe(0);
      expect(Q.stats().queued).toBe(0);
    });

    it('treats an uploader that throws as a failed try, not a crash', async () => {
      const Q = openTab();
      let calls = 0;
      Q.configure({
        store,
        upload: () => {
          calls++;
          throw new Error('Load failed');
        },
      });
      const { ids } = await Q.add(SERVER_REF, [page(1)]);
      await serverFileIds(Q);
      expect(await Q.send()).toMatchObject({ sent: 0, failed: 1 });
      expect(calls).toBe(1);
      expect(store.has(ids[0])).toBe(true);
      expect(Q.pages()[0]).toMatchObject({ state: 'retrying', error: 'Load failed' });
    });

    it('is marked failed when the server refuses it, kept, and sent again on retry()', async () => {
      const Q = openTab();
      let refuse = true;
      const upload = uploader(call =>
        refuse && call.order === 0 ? { error: { message: 'new row violates row-level security', status: 403 } } : null,
      );
      Q.configure({ store, upload });
      const { ids } = await Q.add(SERVER_REF, [page(1), page(2)]);
      await serverFileIds(Q);

      expect(await Q.send()).toMatchObject({ sent: 1, failed: 1 });
      expect(store.has(ids[0])).toBe(true);
      expect(Q.pages()).toHaveLength(1);
      expect(Q.pages()[0]).toMatchObject({ id: ids[0], state: 'failed', attempts: 1, code: 403 });
      expect(Q.pages()[0].error).toMatch(/row-level security/);
      expect(Q.stats()).toMatchObject({ queued: 1, failed: 1, retrying: 0 });

      // A refused page is not sent again on its own, even when forced.
      const before = upload.calls.length;
      await Q.send({ force: true });
      expect(upload.calls).toHaveLength(before);
      expect(store.has(ids[0])).toBe(true);

      refuse = false;
      expect(await Q.retry(ids[0])).toEqual({ ok: true });
      expect(Q.pages()[0]).toMatchObject({ state: 'waiting', attempts: 0, error: null });
      expect(await Q.send()).toMatchObject({ sent: 1, failed: 0 });
      expect(store.count()).toBe(0);
      expect(await Q.retry(ids[0])).toEqual({ ok: false, reason: 'not_found' });
    });

    it('does not send the page again when only its thumbnail failed', async () => {
      const Q = openTab();
      let down = true;
      const upload = uploader(call => (down && call.part === 'thumb' ? { error: { message: 'timed out' } } : null));
      Q.configure({ store, upload });
      const { ids } = await Q.add(SERVER_REF, [page(1)]);
      await serverFileIds(Q);
      await Q.send();
      expect(store.peek(ids[0]).sent).toEqual({ photo: true, thumb: false });

      down = false;
      await Q.send({ force: true });
      expect(upload.calls.map(c => c.part)).toEqual(['photo', 'thumb', 'thumb']);
      expect(store.count()).toBe(0);
    });

    it('retry({ again: true }) sends both files again', async () => {
      const Q = openTab();
      let down = true;
      const upload = uploader(call => (down && call.part === 'thumb' ? { error: { message: 'timed out' } } : null));
      Q.configure({ store, upload });
      const { ids } = await Q.add(SERVER_REF, [page(1)]);
      await serverFileIds(Q);
      await Q.send();
      down = false;
      await Q.retry(ids[0], { again: true });
      await Q.send();
      expect(upload.calls.map(c => c.part)).toEqual(['photo', 'thumb', 'photo', 'thumb']);
    });

    it('can be given up with remove()', async () => {
      const Q = openTab();
      const upload = uploader(() => ({ error: { message: 'Payload too large', status: 413 } }));
      Q.configure({ store, upload });
      const { ids } = await Q.add(SERVER_REF, [page(1)]);
      await serverFileIds(Q);
      await Q.send();
      expect(Q.stats().failed).toBe(1);
      expect(await Q.remove(ids[0])).toEqual({ ok: true });
      expect(store.count()).toBe(0);
      expect(Q.stats()).toMatchObject({ queued: 0, failed: 0 });
      expect(await Q.remove(ids[0])).toEqual({ ok: false, reason: 'not_found' });
    });
  });

  /* ── Confirming ─────────────────────────────────────────────────────── */

  describe('with a commit step', () => {
    function committer(answer) {
      const calls = [];
      const fn = async batch => {
        calls.push(batch);
        return (answer && (await answer(batch, calls.length))) || { error: null };
      };
      fn.calls = calls;
      return fn;
    }

    it('keeps every page until the server commits the send, then deletes them', async () => {
      const Q = openTab();
      const upload = uploader();
      const held = deferred();
      const commit = committer(() => held.promise);
      Q.configure({ store, upload, commit });
      const { ids, batch } = await Q.add(SERVER_REF, [page(1), page(2)]);
      await serverFileIds(Q);

      const sending = Q.send();
      await settle();
      await settle();
      // Both pages are up and the commit is in flight: still on the device.
      expect(upload.calls).toHaveLength(4);
      expect(commit.calls).toHaveLength(1);
      expect(store.count()).toBe(2);
      expect(store.has(ids[0]) && store.has(ids[1])).toBe(true);
      expect(Q.pages().map(p => p.state)).toEqual(['uploaded', 'uploaded']);
      expect(Q.stats()).toMatchObject({ queued: 2, uploaded: 2 });

      held.resolve({ error: null });
      expect(await sending).toMatchObject({ sent: 2, committed: 1, commitFailed: 0 });
      expect(store.count()).toBe(0);

      const folder = `${COURSE}/${ASSESSMENT}/${ENROLLMENT}/${SUBMISSION}`;
      expect(commit.calls[0]).toEqual({
        key: batch,
        ids: SERVER_REF,
        files: [1, 2].map(n => ({
          id: fileId(n),
          order: n - 1,
          path: `${folder}/${fileId(n)}.jpg`,
          thumbPath: `${folder}/${fileId(n)}-thumb.jpg`,
          hash: 'hash-' + n,
          bytes: 400,
          thumbBytes: 40,
          width: 2000,
          height: 1500,
        })),
      });
      expect(_isUuid(batch)).toBe(true);
    });

    it('does not commit a send while one of its pages has not gone', async () => {
      const Q = openTab();
      let refuse = true;
      const upload = uploader(call =>
        refuse && call.order === 1 ? { error: { message: 'nope', status: 400 } } : null,
      );
      const commit = committer();
      Q.configure({ store, upload, commit });
      const { ids } = await Q.add(SERVER_REF, [page(1), page(2)]);
      await serverFileIds(Q);

      expect(await Q.send()).toMatchObject({ sent: 1, failed: 1, committed: 0 });
      expect(commit.calls).toEqual([]);
      expect(Q.pages().map(p => p.state)).toEqual(['uploaded', 'failed']);
      expect(store.count()).toBe(2);

      refuse = false;
      await Q.retry(ids[1]);
      expect(await Q.send()).toMatchObject({ sent: 1, committed: 1 });
      expect(commit.calls).toHaveLength(1);
      expect(commit.calls[0].files).toHaveLength(2);
      expect(store.count()).toBe(0);
    });

    it('commits again with the same key after a lost answer, so a second commit is harmless', async () => {
      const Q = openTab();
      const upload = uploader();
      const commit = committer((batch, n) => (n === 1 ? { error: { message: 'Failed to fetch' } } : null));
      Q.configure({ store, upload, commit });
      let now = 7000;
      vi.spyOn(Date, 'now').mockImplementation(() => now);
      await Q.add(SERVER_REF, [page(1)]);
      await serverFileIds(Q);

      expect(await Q.send()).toMatchObject({ sent: 1, committed: 0, commitFailed: 1 });
      expect(store.count()).toBe(1);
      expect(Q.pages()[0]).toMatchObject({ state: 'uploaded', attempts: 1 });

      now += 1000;
      expect(await Q.send()).toMatchObject({ sent: 0, committed: 1 });
      expect(store.count()).toBe(0);
      expect(commit.calls).toHaveLength(2);
      expect(commit.calls[1]).toEqual(commit.calls[0]);
      // The files went up once.
      expect(upload.calls).toHaveLength(2);
    });

    it('keeps the pages when the server refuses the commit, and commits again on retry without re-uploading', async () => {
      const Q = openTab();
      const upload = uploader();
      let refuse = true;
      const commit = committer(() => (refuse ? { error: { message: 'submission is closed', status: 422 } } : null));
      Q.configure({ store, upload, commit });
      const { ids } = await Q.add(SERVER_REF, [page(1), page(2)]);
      await serverFileIds(Q);

      expect(await Q.send()).toMatchObject({ sent: 2, committed: 0, commitFailed: 1 });
      expect(store.count()).toBe(2);
      expect(Q.pages().map(p => p.state)).toEqual(['failed', 'failed']);
      expect(Q.pages()[0].error).toMatch(/submission is closed/);

      refuse = false;
      await Q.retry(ids[0]);
      await Q.retry(ids[1]);
      expect(await Q.send()).toMatchObject({ committed: 1 });
      expect(upload.calls).toHaveLength(4);
      expect(store.count()).toBe(0);
    });

    it('a committer that throws is a failed try', async () => {
      const Q = openTab();
      Q.configure({
        store,
        upload: uploader(),
        commit: () => {
          throw new Error('network down');
        },
      });
      await Q.add(SERVER_REF, [page(1)]);
      await serverFileIds(Q);
      expect(await Q.send()).toMatchObject({ commitFailed: 1 });
      expect(store.count()).toBe(1);
      expect(Q.pages()[0].state).toBe('uploaded');
    });
  });

  /* ── Reload ─────────────────────────────────────────────────────────── */

  describe('a reload', () => {
    it('loses nothing: the pages, their order and their server ids are still there, and they send', async () => {
      let Q = openTab();
      Q.configure({ store });
      const { ids } = await Q.add(LOCAL_REF, [page(1), page(2), page(3)]);
      await Q.rekey(LOCAL_SUBMISSION, SUBMISSION);

      Q = openTab(); // the page reloads
      const upload = uploader();
      Q.configure({ store, upload });
      await Q.ready();
      expect(Q.pages(SUBMISSION).map(p => p.id)).toEqual(ids);
      expect(Q.stats()).toMatchObject({ queued: 3, blocked: 3 });
      expect((await Q.blobs(ids[2])).photo.size).toBe(400);

      await serverFileIds(Q);
      expect(await Q.send()).toMatchObject({ sent: 3 });
      expect(upload.calls.map(c => c.order)).toEqual([0, 0, 1, 1, 2, 2]);
      expect(store.count()).toBe(0);
    });

    it('in the middle of a send keeps the photo, and the new page sends it', async () => {
      const old = openTab();
      const held = deferred();
      const oldUpload = uploader(() => held.promise);
      old.configure({ store, upload: oldUpload });
      const { ids } = await old.add(SERVER_REF, [page(1)]);
      await serverFileIds(old);
      const dying = old.send();
      await settle();
      expect(oldUpload.calls).toHaveLength(1);

      const Q = openTab(); // reload: the old page is gone mid-upload
      const upload = uploader();
      Q.configure({ store, upload });
      await Q.ready();
      expect(Q.pages().map(p => p.id)).toEqual(ids);
      const sending = Q.send();
      await settle();

      // Whatever became of the old page's request, it deletes nothing now.
      held.resolve({ error: null });
      await dying;
      const done = await sending;
      expect(done).toMatchObject({ sent: 1 });
      expect(upload.calls.map(c => c.part)).toEqual(['photo', 'thumb']);
      expect(upload.calls[0].path).toBe(oldUpload.calls[0].path);
      expect(store.count()).toBe(0);
    });

    it('keeps a failed page failed, with its reason', async () => {
      let Q = openTab();
      Q.configure({ store, upload: uploader(() => ({ error: { message: 'Bucket not found', status: 404 } })) });
      await Q.add(SERVER_REF, [page(1)]);
      await serverFileIds(Q);
      await Q.send();

      Q = openTab();
      Q.configure({ store, upload: uploader() });
      await Q.ready();
      expect(Q.pages()[0]).toMatchObject({ state: 'failed', error: 'Bucket not found', code: 404 });
      expect(Q.stats().failed).toBe(1);
    });
  });

  /* ── Two tabs ───────────────────────────────────────────────────────── */

  describe('two tabs', () => {
    it('never send the same photo: the second waits for the lock, then finds it gone', async () => {
      const one = openTab();
      const two = openTab({ keep: true });
      const held = deferred();
      const uploadOne = uploader(call => (call.n === 1 ? held.promise : null));
      const uploadTwo = uploader();
      one.configure({ store, upload: uploadOne });
      two.configure({ store, upload: uploadTwo });
      await one.add(SERVER_REF, [page(1), page(2)]);
      await serverFileIds(one);
      await two.ready();

      const a = one.send();
      await settle();
      const b = two.send();
      await settle();
      expect(uploadTwo.calls).toEqual([]);
      held.resolve({ error: null });
      const [first, second] = await Promise.all([a, b]);

      expect(first.sent + second.sent).toBe(2);
      const all = [...uploadOne.calls, ...uploadTwo.calls].map(c => c.path);
      expect(all).toHaveLength(4);
      expect(new Set(all).size).toBe(4);
      expect(store.count()).toBe(0);
    });

    it('save only the field they changed, so one tab never undoes what another saved to the same page', async () => {
      const one = openTab();
      const two = openTab({ keep: true });
      const held = deferred();
      one.configure({ store, upload: uploader(call => (call.part === 'thumb' ? held.promise : null)) });
      two.configure({ store });
      const { ids } = await one.add({ ...SERVER_REF, assessment: LOCAL_ASSESSMENT }, [page(1)]);
      await one.rekey(ids[0], fileId(1));
      expect(store.updates).toEqual([{ id: ids[0], patch: { ids: { file: fileId(1) } } }]);
      await two.ready();

      // Tab two learns the assessment's server id while tab one is not looking.
      await two.rekey(LOCAL_ASSESSMENT, ASSESSMENT);
      expect(store.updates[1]).toEqual({ id: ids[0], patch: { ids: { assessment: ASSESSMENT } } });
      expect(store.peek(ids[0]).ids).toEqual({ ...SERVER_REF, file: fileId(1) });

      // Tab one sends: the page lands, the thumbnail is on its way.
      const sending = one.send();
      await settle();
      expect(store.updates[2]).toEqual({ id: ids[0], patch: { sent: { photo: true } } });
      // Tab two saves something else to the same page meanwhile.
      await two.retry(ids[0]);
      expect(store.peek(ids[0]).sent).toEqual({ photo: true, thumb: false });
      held.resolve({ error: null });
      expect(await sending).toMatchObject({ sent: 1 });
    });

    it('applyPatch changes one id or one part at a time and replaces everything else', () => {
      const Q = openTab();
      const meta = {
        id: 'p1',
        ids: { course: 'a', file: 'p1' },
        sent: { photo: true, thumb: false },
        state: 'waiting',
      };
      Q.applyPatch(meta, { ids: { file: 'f' }, state: 'failed', attempts: 2 });
      Q.applyPatch(meta, { sent: { thumb: true } });
      expect(meta).toEqual({
        id: 'p1',
        ids: { course: 'a', file: 'f' },
        sent: { photo: true, thumb: true },
        state: 'failed',
        attempts: 2,
      });
      expect(Q.applyPatch(meta, null)).toBe(meta);
    });

    it('share one queue: a page added in one tab shows in the other', async () => {
      const one = openTab();
      const two = openTab({ keep: true });
      one.configure({ store });
      two.configure({ store });
      await two.ready();
      const heard = [];
      two.subscribe(e => heard.push(e.kind));
      await one.add(LOCAL_REF, [page(1)]);
      await settle();
      expect(two.stats().queued).toBe(1);
      expect(heard).toEqual(['remote']);
    });

    it('where Web Locks are missing, a lease stops the second tab', async () => {
      Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true, writable: true });
      const one = openTab();
      const two = openTab({ keep: true });
      const held = deferred();
      const uploadOne = uploader(call => (call.n === 1 ? held.promise : null));
      const uploadTwo = uploader();
      one.configure({ store, upload: uploadOne });
      two.configure({ store, upload: uploadTwo });
      await one.add(SERVER_REF, [page(1)]);
      await serverFileIds(one);
      await two.ready();

      const a = one.send();
      await settle();
      expect(JSON.parse(localStorage.getItem('fv-photo-queue-owner-v1'))).toMatchObject({ tab: expect.any(String) });
      expect(await two.send()).toMatchObject({ sent: 0, note: 'busy' });
      expect(uploadTwo.calls).toEqual([]);

      held.resolve({ error: null });
      expect(await a).toMatchObject({ sent: 1 });
      expect(localStorage.getItem('fv-photo-queue-owner-v1')).toBe(null);

      // The lease is free again: the second tab can send.
      await two.add(SERVER_REF, [page(2)]);
      await serverFileIds(two, 2);
      expect(await two.send()).toMatchObject({ sent: 1, note: null });
      expect(uploadTwo.calls).toHaveLength(2);
    });

    it('takes over a lease left by a tab that is gone', async () => {
      Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true, writable: true });
      const Q = openTab();
      const upload = uploader();
      Q.configure({ store, upload });
      await Q.add(SERVER_REF, [page(1)]);
      await serverFileIds(Q);

      localStorage.setItem('fv-photo-queue-owner-v1', JSON.stringify({ tab: 'another-tab', at: Date.now() - 1000 }));
      expect(await Q.send()).toMatchObject({ note: 'busy' });
      localStorage.setItem('fv-photo-queue-owner-v1', JSON.stringify({ tab: 'another-tab', at: Date.now() - 20000 }));
      expect(await Q.send()).toMatchObject({ sent: 1, note: null });
    });
  });

  /* ── Sign Out ───────────────────────────────────────────────────────── */

  describe('wipe() for Sign Out', () => {
    it('empties the queue', async () => {
      const Q = openTab();
      Q.configure({ store, upload: uploader(() => ({ error: { message: 'no', status: 400 } })) });
      await Q.add(SERVER_REF, [page(1), page(2)]);
      await Q.add(LOCAL_REF, [page(3)]);
      await serverFileIds(Q);
      await Q.send();
      expect(store.count()).toBe(3);
      const kinds = [];
      Q.subscribe(e => kinds.push(e.kind));

      expect(await Q.wipe()).toEqual({ ok: true, error: null });
      expect(store.count()).toBe(0);
      expect(Q.pages()).toEqual([]);
      expect(Q.stats()).toMatchObject({ queued: 0, blocked: 0, failed: 0, storageFull: false });
      expect(kinds).toEqual(['wipe']);

      // The same after a reload: nothing comes back.
      const next = openTab();
      next.configure({ store });
      await next.ready();
      expect(next.stats().queued).toBe(0);
    });

    it('in the middle of a send leaves nothing behind when the upload answers', async () => {
      const Q = openTab();
      const held = deferred();
      const upload = uploader(() => held.promise);
      Q.configure({ store, upload });
      await Q.add(SERVER_REF, [page(1), page(2)]);
      await serverFileIds(Q);
      const sending = Q.send();
      await settle();

      await Q.wipe();
      held.resolve({ error: { message: 'Failed to fetch' } });
      await sending;
      await settle();
      expect(store.count()).toBe(0);
      expect(Q.stats().queued).toBe(0);
      // The pass stopped: the second page was never tried.
      expect(upload.calls).toHaveLength(1);
    });

    it("clears the other tab's view too, and stops its send", async () => {
      const one = openTab();
      const two = openTab({ keep: true });
      one.configure({ store });
      two.configure({ store });
      await one.add(LOCAL_REF, [page(1)]);
      await settle();
      expect(two.stats().queued).toBe(1);
      const heard = [];
      two.subscribe(e => heard.push(e.kind));

      await one.wipe();
      await settle();
      expect(two.stats().queued).toBe(0);
      expect(two.pages()).toEqual([]);
      expect(heard).toContain('wipe');
    });

    it('always answers, even when the store fails, so Sign Out is never stuck', async () => {
      const Q = openTab();
      Q.configure({ store });
      await Q.add(LOCAL_REF, [page(1)]);
      store.failWith = new Error('blocked');
      expect(await Q.wipe()).toEqual({ ok: false, error: 'blocked' });
      expect(Q.stats().queued).toBe(0);
    });
  });

  /* ── Demo Mode ──────────────────────────────────────────────────────── */

  describe('Demo Mode', () => {
    it('keeps photos on the device and hands nothing to the uploader', async () => {
      const Q = openTab();
      const upload = uploader();
      let commits = 0;
      Q.configure({ store, upload, commit: async () => (commits++, { error: null }), isDemo: () => true });
      const { ids } = await Q.add(SERVER_REF, [page(1), page(2)]);
      await serverFileIds(Q);

      expect(await Q.send()).toMatchObject({ sent: 0, note: 'demo' });
      expect(await Q.send({ force: true })).toMatchObject({ sent: 0, note: 'demo' });
      expect(upload.calls).toEqual([]);
      expect(commits).toBe(0);
      expect(store.count()).toBe(2);
      expect(Q.stats()).toMatchObject({ queued: 2, demo: true });
      expect((await Q.blobs(ids[0])).photo.size).toBe(400);
    });

    it("follows the page's own isDemoMode() when not told otherwise", async () => {
      const Q = openTab();
      const upload = uploader();
      Q.configure({ store, upload });
      await Q.add(SERVER_REF, [page(1)]);
      await serverFileIds(Q);
      globalThis.isDemoMode = () => true;
      expect(await Q.send()).toMatchObject({ note: 'demo' });
      expect(upload.calls).toEqual([]);
      globalThis.isDemoMode = () => false;
      expect(await Q.send()).toMatchObject({ sent: 1 });
    });

    it('makes no network call of its own, in Demo Mode or out of it', async () => {
      const network = [];
      const originals = {
        fetch: globalThis.fetch,
        XMLHttpRequest: globalThis.XMLHttpRequest,
        getSupabase: globalThis.getSupabase,
        WebSocket: globalThis.WebSocket,
      };
      globalThis.fetch = (...args) => (network.push(['fetch', ...args]), Promise.reject(new Error('no network')));
      globalThis.XMLHttpRequest = function () {
        network.push(['xhr']);
      };
      globalThis.WebSocket = function () {
        network.push(['ws']);
      };
      globalThis.getSupabase = () => (network.push(['supabase']), {});
      navigator.sendBeacon = (...args) => network.push(['beacon', ...args]);
      try {
        for (const demo of [true, false]) {
          const Q = openTab();
          Q.configure({
            store,
            upload: uploader(c => (c.order === 1 ? { error: { message: 'x', status: 400 } } : null)),
            commit: async () => ({ error: null }),
            isDemo: () => demo,
            owner: () => 'teacher-1',
          });
          const { ids } = await Q.add(LOCAL_REF, [page(1), page(2)]);
          await Q.rekey(LOCAL_SUBMISSION, SUBMISSION);
          await serverFileIds(Q);
          await Q.send();
          await Q.retry(ids[1]);
          await Q.send({ force: true });
          await Q.blobs(ids[0]);
          await Q.remove(ids[1]);
          Q.stats();
          Q.pages();
          await Q.wipe();
        }
      } finally {
        Object.assign(globalThis, originals);
        delete navigator.sendBeacon;
      }
      expect(network).toEqual([]);
    });

    it('has no network code in it at all', () => {
      expect(source).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|getSupabase|\.rpc\(/);
      expect(source).not.toMatch(/importScripts|\.storage\b|supabase\.co/);
      expect(source).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
      expect(source.match(/window\.[A-Za-z]+ =(?!=)/g)).toEqual(['window.PhotoQueue =']);
    });
  });

  /* ── Owner ──────────────────────────────────────────────────────────── */

  describe('on a shared computer', () => {
    it("one teacher's waiting photos are not sent, counted or listed under another", async () => {
      let who = 'teacher-1';
      let Q = openTab();
      Q.configure({ store, owner: () => who });
      await Q.add(SERVER_REF, [page(1)]);
      await serverFileIds(Q);

      who = 'teacher-2';
      Q = openTab();
      const upload = uploader();
      const commits = [];
      Q.configure({ store, upload, commit: async b => (commits.push(b), { error: null }), owner: () => who });
      await Q.ready();
      expect(Q.stats().queued).toBe(0);
      expect(Q.pages()).toEqual([]);
      expect(await Q.send({ force: true })).toMatchObject({ sent: 0, committed: 0 });
      expect(upload.calls).toEqual([]);
      expect(commits).toEqual([]);
      expect(store.count()).toBe(1);

      who = 'teacher-1';
      expect(Q.stats().queued).toBe(1);
      expect(await Q.send()).toMatchObject({ sent: 1, committed: 1 });
      expect(store.count()).toBe(0);
    });
  });
});
