/**
 * Start-up draws the saved class list first (docs/DECISIONS.md, "Start-up
 * draws the saved class list first"; Colin's ruling of 2026-11-13 on
 * decision 23 of docs/plans/handoff-review-plan.md).
 *
 * Before, three requests ran one after another before anything drew on a
 * repeat visit: the sign-in re-check (getUser), bootstrap_teacher, then
 * list_teacher_courses. Now the three are asked side by side and this
 * device's saved class list and class are drawn while they answer. The
 * ruling's conditions, each held by a test below:
 *
 *   - the server's answers are not shown, and nothing is written, until the
 *     re-check has passed;
 *   - a re-check that fails, or names another user, removes the saved data
 *     and goes to Sign In, whatever is on screen;
 *   - with no saved list, and offline, start-up is as it was.
 *
 * The real data layer, outbox and requireAuth (shared/supabase.js) run
 * against the stand-in server; each request and the re-check answer only
 * when the test lets them.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'vm';
import { settle } from './helpers/fake-supabase.js';
import { CID, TEACHER, classSettingsServer } from './helpers/class-settings-server.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = file => readFileSync(resolve(root, file), 'utf-8');
const QUEUE_SOURCE = read('shared/offline-queue.js');
const AUTH_SOURCE = read('shared/supabase.js');
const SOMEONE_ELSE = 'f0000000-0000-4000-8000-00000000000b';
const SESSION_KEY = 'sb-example-auth-token';
const OUTBOX_KEY = 'fv-sync-queue-v1';
const GATED = ['getUser', 'bootstrap_teacher', 'list_teacher_courses', 'get_class_bundle'];

vi.setConfig({ testTimeout: 30000 });

let server;
let original;
let tabs = [];
let auth; // what the Auth server and the saved session say, per test
let started; // every request, in the order it was asked
let answered; // every request, in the order its answer came back
let gates; // name → the answer waits until the test opens it
let pagehide; // handlers the page registered for its way out

const setOnline = on => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => on });
const isRead = name => /^(get|list)_/.test(name) || name === 'bootstrap_teacher' || name === 'getUser';
const writesAsked = () => started.filter(name => !isRead(name));
const savedKeys = () => Object.keys(localStorage._store).filter(k => k.startsWith('gb-') || k.startsWith('gb_'));

function gate() {
  let open;
  const promise = new Promise(r => (open = r));
  return { promise, open };
}

/* Everything a page holds in memory goes, as on a reload. localStorage (the
   saved classes, the session and the outbox) stays. As in
   stale-settings-revert.test.js. */
function forgetPage() {
  Object.keys(_cache).forEach(function (field) {
    _cache[field] = field === 'courses' || field === 'config' ? null : {};
  });
  COURSES = loadCourses();
  _classVersion = {};
  _classFresh = {};
  _refreshState = {};
  _loadError = {};
  _localWrites = {};
  _serverState = {};
  _dirtyMarked = {};
  _classLoads = {};
  _initPromise = null;
  _gradeReturnsLoadedFor = {};
  _idRekeys = {};
  _pendingSyncs = 0;
  _pendingLocalCids.clear();
  _idmapRaw = null;
  _idmapCache = null;
  _echoNeedsReload = false;
  _classBundleMissing = false;
  _useSupabase = false;
  _supabaseDegraded = false;
  _syncStatus = 'idle';
  if (_recoveryProbeTimer) clearTimeout(_recoveryProbeTimer);
  _recoveryProbeTimer = null;
  _teacherId = null;
  _signInWait = null;
  _pageLocks.switching = 0;
  _pageLocks.checking = 0;
  _outboxConfigured = false;
  if (_loadRetryTimer) clearTimeout(_loadRetryTimer);
  _loadRetryTimer = null;
  clearProfCache();
}

/* A page load: memory is empty, the outbox module and shared/supabase.js
   run again (so the re-check is asked afresh), and every request waits at
   its gate. `gateNames`: which ones wait; the rest answer at once. */
function loadPage(gateNames) {
  forgetPage();
  setOnline(false);
  runInThisContext(QUEUE_SOURCE, { filename: 'shared/offline-queue.js' });
  tabs.push(window.v2Queue);
  setOnline(true);
  location.href = '';
  delete globalThis._supabase;
  runInThisContext(AUTH_SOURCE, { filename: 'shared/supabase.js' });
  started = [];
  answered = [];
  gates = {};
  (gateNames || GATED).forEach(name => (gates[name] = gate()));
}

/* What teacher/router.js boot() does up to its first draw. Resolves when
   the router would draw; `page` then says what it would draw from. */
function boot() {
  const page = { drawn: false, redraws: 0 };
  page.done = (async function () {
    await initAllCourses({
      signInCheck: requireAuth(),
      onChange: function () {
        page.redraws += 1;
      },
    });
    const cid = getActiveCourse();
    await initData(cid);
    if (getActiveCourse() !== cid) await initData(getActiveCourse());
    page.drawn = true;
    page.classes = Object.keys(COURSES).map(id => COURSES[id].name);
    page.students = getStudents(getActiveCourse()).length;
    page.answeredAtDraw = answered.slice();
    page.lockedAtDraw = _pageLocks.checking > 0;
  })();
  return page;
}

/* Until nothing is left to send or load. */
async function quiet() {
  const giveUp = Date.now() + 20000;
  while (Date.now() < giveUp) {
    await settle();
    const refresh = _refreshState[CID];
    if (!(refresh && refresh.running) && !_hasUnsentWrites()) return;
    await new Promise(r => setTimeout(r, 25));
  }
  throw new Error('the page never went quiet');
}

/* An earlier visit: the teacher signed in, the class loaded, and all of it
   was saved on this device. */
async function firstVisit() {
  loadPage([]);
  const page = boot();
  await page.done;
  await quiet();
  expect(localStorage.getItem('gb-owner')).toBe(TEACHER);
  expect(JSON.parse(localStorage.getItem('gb-courses'))[CID].name).toBe('History 12');
  expect(_savedCopyUsable(CID)).toBe(true);
}

/* A change made on that visit with no connection: it waits in the outbox. */
async function leaveAWriteWaiting() {
  setOnline(false);
  server.reachable = false;
  saveConfig(Object.assign({}, getConfig(), { viewMode: 'compact' }));
  await settle();
  expect(window.v2Queue.queued('save_teacher_preferences')).toHaveLength(1);
  server.reachable = true;
  setOnline(true);
}

const signedOut = { data: { user: null }, error: { name: 'AuthApiError', status: 403, message: 'invalid JWT' } };
const passes = () => ({ data: { user: { id: TEACHER } }, error: null });

beforeEach(() => {
  original = {
    getSupabase: globalThis.getSupabase,
    requireAuth: globalThis.requireAuth,
    isDemoMode: globalThis.isDemoMode,
    createClient: globalThis.supabase,
    env: globalThis.__ENV,
    addEventListener: globalThis.addEventListener,
    quiet: _REFRESH_QUIET_MS,
    bundle: globalThis.__FV_CLASS_BUNDLE,
    queue: window.v2Queue,
    store: localStorage._store,
    href: location.href,
  };
  tabs = [];
  pagehide = [];
  _REFRESH_QUIET_MS = 0;
  globalThis.__FV_CLASS_BUNDLE = true;
  localStorage._store = {};
  server = classSettingsServer();
  auth = {
    session: { access_token: 't', user: { id: TEACHER, email: 'teacher@example.test', user_metadata: {} } },
    getUser: passes,
  };
  // The session a signed-in device holds, as supabase-js keeps it.
  localStorage.setItem(SESSION_KEY, JSON.stringify(auth.session));

  const asked = function (name, send) {
    started.push(name);
    const answer = () =>
      Promise.resolve(send()).then(res => {
        answered.push(name);
        return res;
      });
    return gates[name] ? gates[name].promise.then(answer) : answer();
  };
  const rpc = server.fake.rpc;
  // shared/supabase.js makes its client from this; the app's getSupabase()
  // then hands it out.
  globalThis.__ENV = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_KEY: 'sbp_example_key' };
  globalThis.supabase = {
    createClient: () => ({
      rpc: (name, params) => asked(name, () => rpc(name, params)),
      auth: {
        getSession: () =>
          Promise.resolve({
            data: { session: localStorage.getItem(SESSION_KEY) ? auth.session : null },
            error: auth.sessionError || null,
          }),
        // As supabase-js does: with no session saved it asks the server
        // nothing and says the session is missing.
        getUser: () =>
          localStorage.getItem(SESSION_KEY)
            ? asked('getUser', () => auth.getUser())
            : Promise.resolve({
                data: { user: null },
                error: { name: 'AuthSessionMissingError', status: 400, message: 'Auth session missing!' },
              }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      },
    }),
  };
  globalThis.addEventListener = function (type, fn) {
    if (type === 'pagehide') pagehide.push(fn);
  };
});

afterEach(() => {
  tabs.forEach(q => q.release());
  forgetPage();
  globalThis.getSupabase = original.getSupabase;
  globalThis.requireAuth = original.requireAuth;
  globalThis.isDemoMode = original.isDemoMode;
  globalThis.supabase = original.createClient;
  globalThis.__ENV = original.env;
  globalThis.addEventListener = original.addEventListener;
  delete globalThis._supabase;
  _REFRESH_QUIET_MS = original.quiet;
  globalThis.__FV_CLASS_BUNDLE = original.bundle;
  window.v2Queue = original.queue;
  localStorage._store = original.store;
  location.href = original.href;
  setOnline(true);
});

describe('a repeat visit, with this teacher’s class list saved on the device', () => {
  it('asks the re-check, bootstrap_teacher and list_teacher_courses without one waiting on another', async () => {
    await firstVisit();
    loadPage();
    boot();
    await settle();

    // All three have been asked, and none has answered.
    expect(started.slice(0, 3).sort()).toEqual(['bootstrap_teacher', 'getUser', 'list_teacher_courses']);
    expect(answered).toEqual([]);
    // The class's own check is asked beside them.
    expect(started).toContain('get_class_bundle');

    // Any one may answer first: here the last asked answers first.
    gates.list_teacher_courses.open();
    await settle();
    expect(answered).toEqual(['list_teacher_courses']);
    gates.bootstrap_teacher.open();
    gates.get_class_bundle.open();
    await settle();
    gates.getUser.open();
    await quiet();
    expect(answered.slice().sort()).toEqual(GATED.slice().sort());
  });

  it('draws the saved class list and class before any of them answers, locked', async () => {
    await firstVisit();
    loadPage();
    const page = boot();
    await page.done;

    expect(page.answeredAtDraw).toEqual([]);
    expect(page.classes).toEqual(['History 12']);
    expect(page.students).toBeGreaterThan(0);
    expect(page.lockedAtDraw).toBe(true);
  });

  it('unlocks only when both the re-check and the class’s own check have answered', async () => {
    await firstVisit();
    loadPage();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const page = boot();
      await page.done;
      expect(_pageLocks.checking).toBe(2); // the re-check's hold and the class check's

      // The class check answers and its own three-second cap passes: the
      // re-check has not answered, so the page stays locked.
      gates.get_class_bundle.open();
      await settle();
      await vi.advanceTimersByTimeAsync(3500);
      expect(_pageLocks.checking).toBe(1);

      gates.getUser.open();
      await settle();
      await vi.advanceTimersByTimeAsync(50);
      await settle();
      expect(_pageLocks.checking).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stays locked after the re-check passes until the class’s own check answers', async () => {
    await firstVisit();
    loadPage();
    const page = boot();
    await page.done;

    gates.getUser.open();
    gates.bootstrap_teacher.open();
    gates.list_teacher_courses.open();
    await settle();
    expect(_pageLocks.checking).toBe(1);

    gates.get_class_bundle.open();
    await quiet();
    expect(_pageLocks.checking).toBe(0);
  });

  it('shows nothing from the server until the re-check has passed', async () => {
    await firstVisit();
    // Another device renames the class and adds to it; the server's version moves.
    server.fromAnotherDevice('update_course', { p_course_id: CID, p_patch: { name: 'History 12 (Block C)' } });
    loadPage();
    const page = boot();
    await page.done;

    // Every request has answered but the re-check.
    gates.bootstrap_teacher.open();
    gates.list_teacher_courses.open();
    gates.get_class_bundle.open();
    await settle();
    expect(answered.slice().sort()).toEqual(['bootstrap_teacher', 'get_class_bundle', 'list_teacher_courses']);
    expect(COURSES[CID].name).toBe('History 12');
    expect(JSON.parse(localStorage.getItem('gb-courses'))[CID].name).toBe('History 12');
    expect(_classFresh[CID]).toBe(false);
    expect(page.redraws).toBe(0);

    // It passes: the server's list is taken and the page is drawn again.
    gates.getUser.open();
    await quiet();
    expect(COURSES[CID].name).toBe('History 12 (Block C)');
    expect(_classFresh[CID]).toBe(true);
    expect(page.redraws).toBe(1);
  });

  it('writes nothing until the re-check has passed, then sends what waited', async () => {
    await firstVisit();
    await leaveAWriteWaiting();
    loadPage();
    const page = boot();
    await page.done;

    // The outbox is asked to send, the page saves a setting, and a write is
    // sent past the outbox: none of it leaves.
    const flushed = await window.v2Queue.flush();
    expect(flushed.note).toBe('paused');
    saveConfig(Object.assign({}, getConfig(), { viewMode: 'wide' }));
    _callRpcWithAuthGuard('create_report_issue', { p_course_id: CID });
    gates.bootstrap_teacher.open();
    gates.list_teacher_courses.open();
    gates.get_class_bundle.open();
    await settle();
    expect(writesAsked()).toEqual([]);
    expect(server.fake.committed.filter(c => !isRead(c.name))).toEqual([]);

    gates.getUser.open();
    await quiet();
    expect(writesAsked()).toContain('save_teacher_preferences');
    expect(writesAsked()).toContain('create_report_issue');
    expect(window.v2Queue.stats().queued).toBe(0);
  });

  it('photos left waiting by an earlier visit do not go up until the re-check has passed', async () => {
    await firstVisit();
    localStorage.setItem('gb-work-uploads', JSON.stringify({ a: { ids: ['p1'] } }));
    localStorage.setItem('gb-handout-uploads', JSON.stringify({ b: { ids: ['p2'] } }));
    const photos = window.PhotoQueue;
    const calls = [];
    window.PhotoQueue = {
      configure: () => calls.push('configure'),
      subscribe: () => {},
      stats: () => ({}),
      send: () => calls.push('send'),
    };
    _workQueueWired = false;
    try {
      loadPage();
      const page = boot();
      await page.done;
      // What the page's load listener calls (shared/data.js).
      _resumeWorkUploads();
      _resumeHandoutUploads();
      await settle();
      expect(calls).toEqual([]);

      GATED.forEach(name => gates[name].open());
      await quiet();
      expect(calls).toEqual(['configure', 'send', 'send']);
    } finally {
      window.PhotoQueue = photos;
      _workQueueWired = false;
    }
  });

  it('keeps the class on screen open when the server’s settings name another class', async () => {
    const OTHER = 'e0000000-0000-4000-8000-000000000002';
    const rows = () => [CID, OTHER].map((id, i) => Object.assign({}, server.course, { id, display_order: i }));
    let serverOpens = CID;
    server.fake.on('list_teacher_courses', () => ({ data: rows(), error: null }));
    server.fake.on('bootstrap_teacher', () => ({
      data: { id: TEACHER, email: 'teacher@example.test', preferences: { active_course_id: serverOpens } },
      error: null,
    }));
    await firstVisit();
    expect(getActiveCourse()).toBe(CID);

    // The teacher opened the other class on another device since.
    serverOpens = OTHER;
    loadPage([]);
    const page = boot();
    await page.done;
    await quiet();
    expect(getActiveCourse()).toBe(CID);
    expect(page.redraws).toBe(0);
    expect(JSON.parse(localStorage.getItem('gb-config')).activeCourse).toBe(CID);
  });

  it('draws again without a class another device deleted, once the re-check has passed', async () => {
    await firstVisit();
    server.fake.on('list_teacher_courses', () => ({ data: [], error: null }));
    loadPage();
    const page = boot();
    await page.done;
    expect(page.classes).toEqual(['History 12']);

    GATED.forEach(name => gates[name].open());
    await quiet();
    expect(Object.keys(COURSES)).toEqual([]);
    expect(page.redraws).toBe(1);
    expect(localStorage.getItem('gb-students-' + CID)).toBeNull();
  });

  it('leaves the page as it is when the server’s list is the saved one', async () => {
    await firstVisit();
    loadPage([]);
    const page = boot();
    await page.done;
    await quiet();
    expect(page.redraws).toBe(0);
    expect(_pageLocks.checking).toBe(0);
    expect(isSupabaseDegraded()).toBe(false);
  });
});

describe('a re-check that fails after the saved class was drawn', () => {
  async function drawnThenChecked(answer) {
    await firstVisit();
    await leaveAWriteWaiting();
    localStorage.setItem('gb_ui_pref', 'x');
    loadPage();
    const page = boot();
    await page.done;
    expect(page.classes).toEqual(['History 12']);
    await window.v2Queue.flush();
    saveConfig(Object.assign({}, getConfig(), { viewMode: 'wide' }));
    await settle();

    auth.getUser = () => answer;
    gates.getUser.open();
    await settle();
    return page;
  }

  it('removes the saved data and goes to Sign In, with nothing written or sent before it', async () => {
    const page = await drawnThenChecked(signedOut);

    expect(location.href).toBe('/login.html');
    expect(savedKeys()).toEqual([]);
    expect(writesAsked()).toEqual([]);
    // The outbox always stays; so does the session, which supabase-js
    // removes itself when the server says it is gone.
    expect(localStorage.getItem(OUTBOX_KEY)).not.toBeNull();

    // The server's answers come in late: none is taken, shown or saved.
    gates.bootstrap_teacher.open();
    gates.list_teacher_courses.open();
    gates.get_class_bundle.open();
    await settle();
    await new Promise(r => setTimeout(r, 50));
    await settle();
    expect(savedKeys()).toEqual([]);
    expect(writesAsked()).toEqual([]);
    expect(_classFresh[CID]).toBe(false);
    expect(page.redraws).toBe(0);
    expect(_pageLocks.checking).toBeGreaterThan(0);
    expect(window.v2Queue.stats().queued).toBeGreaterThan(0);
  });

  it('removes again whatever the page saves on its way out', async () => {
    await drawnThenChecked(signedOut);
    expect(pagehide.length).toBeGreaterThan(0);
    // A page's own pagehide save, after the wipe.
    saveCourses(COURSES);
    expect(savedKeys()).toEqual(['gb-courses']);
    pagehide.forEach(fn => fn());
    expect(savedKeys()).toEqual([]);
  });

  it('does the same, and removes the saved sign-in, when the server names another user', async () => {
    await drawnThenChecked({ data: { user: { id: SOMEONE_ELSE } }, error: null });

    expect(location.href).toBe('/login.html');
    expect(savedKeys()).toEqual([]);
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();
    expect(localStorage.getItem(OUTBOX_KEY)).not.toBeNull();
    expect(writesAsked()).toEqual([]);

    gates.bootstrap_teacher.open();
    gates.list_teacher_courses.open();
    gates.get_class_bundle.open();
    await settle();
    expect(savedKeys()).toEqual([]);
    expect(writesAsked()).toEqual([]);
    expect(_pageLocks.checking).toBeGreaterThan(0);
  });
});

describe('with no class list saved for this teacher, start-up is as it was', () => {
  it('asks nothing and draws nothing until the re-check has answered', async () => {
    loadPage();
    const page = boot();
    await settle();
    expect(started).toEqual(['getUser']);
    expect(page.drawn).toBe(false);
    expect(_signInWait).toBeNull();
    expect(_useSupabase).toBe(false);

    gates.getUser.open();
    await settle();
    expect(started.slice(0, 3)).toEqual(['getUser', 'bootstrap_teacher', 'list_teacher_courses']);
    expect(page.drawn).toBe(false);

    gates.bootstrap_teacher.open();
    gates.list_teacher_courses.open();
    gates.get_class_bundle.open();
    await page.done;
    await quiet();
    expect(page.classes).toEqual(['History 12']);
    expect(page.answeredAtDraw).toEqual(expect.arrayContaining(GATED));
    expect(_pageLocks.checking).toBe(0);
  });

  it('asks the server for nothing when the re-check fails', async () => {
    auth.getUser = () => signedOut;
    loadPage([]);
    const page = boot();
    await settle();
    expect(location.href).toBe('/login.html');
    expect(started).toEqual(['getUser']);
    expect(page.drawn).toBe(false);
  });

  it('goes to Sign In without asking the server when no session is saved at all', async () => {
    await firstVisit();
    localStorage.removeItem(SESSION_KEY);
    loadPage([]);
    const page = boot();
    await settle();
    expect(location.href).toBe('/login.html');
    expect(started).toEqual([]);
    expect(savedKeys()).toEqual([]);
    expect(page.drawn).toBe(false);
  });

  it('does not draw another teacher’s saved list: it is removed, and the re-check comes first', async () => {
    await firstVisit();
    // Someone else signs in on this computer.
    auth.session = { access_token: 't2', user: { id: SOMEONE_ELSE, email: 'other@example.test', user_metadata: {} } };
    auth.getUser = () => ({ data: { user: { id: SOMEONE_ELSE } }, error: null });
    loadPage();
    const page = boot();
    await settle();
    expect(started).toEqual(['getUser']);
    expect(page.drawn).toBe(false);

    gates.getUser.open();
    await settle();
    expect(localStorage.getItem('gb-owner')).toBe(SOMEONE_ELSE);
    expect(localStorage.getItem('gb-students-' + CID)).toBeNull();
  });

  it('a brand-new teacher with no classes still starts, and bootstrap_teacher waits for the re-check', async () => {
    server.fake.on('list_teacher_courses', () => ({ data: [], error: null }));
    server.fake.on('bootstrap_teacher', () => ({
      data: { id: TEACHER, email: 'teacher@example.test', preferences: {} },
      error: null,
    }));
    loadPage(['getUser']);
    const page = boot();
    await settle();
    // bootstrap_teacher makes a new teacher's rows: not before the re-check.
    expect(started).toEqual(['getUser']);

    gates.getUser.open();
    await page.done;
    await settle();
    expect(page.classes).toEqual([]);
    expect(getActiveCourse()).toBeNull();
    expect(isSupabaseDegraded()).toBe(false);
    expect(_useSupabase).toBe(true);

    // The next visit: an empty saved list is no list, so the same order.
    loadPage(['getUser']);
    const again = boot();
    await settle();
    expect(started).toEqual(['getUser']);
    gates.getUser.open();
    await again.done;
    expect(again.classes).toEqual([]);
  });

  it('the kill switch (FV_CACHE_FIRST off) puts the re-check first again', async () => {
    await firstVisit();
    window.__FV_CACHE_FIRST = false;
    try {
      loadPage();
      const page = boot();
      await settle();
      expect(started).toEqual(['getUser']);
      expect(page.drawn).toBe(false);
    } finally {
      delete window.__FV_CACHE_FIRST;
    }
  });
});

describe('offline, start-up is as it was', () => {
  it('waits for the re-check, then opens from the saved copy with sync paused and nothing locked', async () => {
    await firstVisit();
    const offline = { name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' };
    auth.getUser = () => ({ data: { user: null }, error: offline });
    loadPage([]);
    setOnline(false);
    server.reachable = false;
    // No retries of the first request: they only take time.
    const delays = _BOOTSTRAP_RETRY_DELAYS_MS.splice(0);
    let page;
    try {
      page = boot();
      await settle();
      // The saved list is not drawn ahead of the re-check: the old order.
      expect(started[0]).toBe('getUser');
      expect(answered[0]).toBe('getUser');
      expect(_signInWait).toBeNull();
      await page.done;
    } finally {
      _BOOTSTRAP_RETRY_DELAYS_MS.push(...delays);
    }

    expect(location.href).toBe('');
    expect(isSupabaseDegraded()).toBe(true);
    expect(page.classes).toEqual(['History 12']);
    expect(page.students).toBeGreaterThan(0);
    expect(page.lockedAtDraw).toBe(false);
    expect(started.indexOf('bootstrap_teacher')).toBeGreaterThan(answered.indexOf('getUser'));

    // A change made offline waits in the outbox, as before.
    saveConfig(Object.assign({}, getConfig(), { viewMode: 'compact' }));
    await settle();
    expect(window.v2Queue.queued('save_teacher_preferences')).toHaveLength(1);
    expect(writesAsked()).toEqual([]);
  });
});

describe('bootstrap_teacher and list_teacher_courses', () => {
  it('are asked side by side wherever the class list is read (the phone’s start-up too)', async () => {
    loadPage(['bootstrap_teacher', 'list_teacher_courses']);
    // The phone: no re-check is handed in.
    const done = initAllCourses();
    await settle();
    expect(started).toEqual(['bootstrap_teacher', 'list_teacher_courses']);
    expect(answered).toEqual([]);
    gates.list_teacher_courses.open();
    gates.bootstrap_teacher.open();
    await done;
    expect(Object.keys(COURSES)).toEqual([CID]);
    expect(_signInWait).toBeNull();
  });
});

describe('teacher/router.js', () => {
  it('hands the re-check to initAllCourses instead of waiting for it', () => {
    const src = read('teacher/router.js');
    expect(src).not.toMatch(/await\s+requireAuth\(\)/);
    expect(src).toMatch(/await initAllCourses\(\{\s*signInCheck: requireAuth\(\),/);
  });
});
