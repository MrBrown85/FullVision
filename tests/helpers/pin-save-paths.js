/* Shared by the tests/pin-*.test.js files (S0-P1, pin the save paths;
   docs/plans/student-page-build-plan.md).

   A pin records what a save path does today: what lands in the data.js
   cache and localStorage, and which RPCs go out, with which params, in
   which order. It is there so the tidying PRs that move every grade write
   onto shared/grader.js cannot change behaviour unnoticed. A pin that
   fails after a tidying PR means the behaviour moved: change the pin only
   when the change is meant.

   signIn() turns writes on with a recording client. These tests load no
   outbox (shared/offline-queue.js), so _writeRpc hands each write straight
   to the client as it is made: `sent()` is the order the screen asked for
   the writes, before the outbox merges writes to one cell. */
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';
import { makeFakeSupabase, settle } from './fake-supabase.js';
import { mount, unmount, click, fire, key } from './gradebook-dom.js';

export { settle, click, fire, key };

/* Server-shaped ids: a write is only sent for ids the server knows. */
export const U = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function signIn() {
  const fake = makeFakeSupabase();
  const was = { getSupabase: globalThis.getSupabase, useSupabase: _useSupabase };
  globalThis.getSupabase = () => fake;
  _useSupabase = true;
  let from = 0;
  const rows = calls =>
    calls.map(c => {
      const params = { ...c.params };
      // A new key for each write: that it is there is the pin, not its value.
      if (UUID.test(String(params.p_idempotency_key || ''))) params.p_idempotency_key = '<key>';
      return [c.name, params];
    });
  return {
    fake,
    /* Every RPC so far, oldest first, as [name, params]. */
    sent: () => rows(fake.calls),
    /* The RPCs since the last call to since(). */
    since() {
      const out = rows(fake.calls.slice(from));
      from = fake.calls.length;
      return out;
    },
    signOut() {
      globalThis.getSupabase = was.getSupabase;
      _useSupabase = was.useSupabase;
    },
  };
}

/* A class in the cache and in localStorage, as a loaded class is. Fields
   left out start empty. It also tells data.js the server holds these
   scores and statuses, as a load does (_persistLoadedField), so a later
   whole-list save sends only what changed, and that the saved text of the
   scores and statuses is this tab's own copy (_keepText), as a load does:
   a score click then runs the Draft and Returned rule as it does for a
   teacher, on the cell it changed.

   And it tells data.js the class is loaded (_classLoads), as a load does.
   teacher/router.js, which tests/setup.js loads, starts loading the
   teacher's other classes 1.5 s later (preloadClasses). A pin's class is
   often not the one data.js calls open, and signIn()'s recording client
   holds no classes. So when that timer came due inside a pin that was
   waiting (on a slow or busy machine), the class was fetched from the
   client and emptied, and the pin failed now and then.
   tests/pin-helper-seeded-class-is-loaded.test.js holds this. */
export function seedClass(cid, data) {
  const fields = {
    students: [],
    assessments: [],
    scores: {},
    statuses: {},
    rubrics: [],
    rubricChecks: {},
    courseConfigs: {},
    ...data,
  };
  COURSES[cid] = { id: cid, name: 'Science 8', gradingSystem: 'proficiency', gradeLevel: '8' };
  Object.keys(fields).forEach(field => {
    _cache[field][cid] = structuredClone(fields[field]);
    const dataKey = _DATA_KEYS[field];
    if (!dataKey) return;
    const text = JSON.stringify(fields[field]);
    localStorage.setItem('gb-' + dataKey + '-' + cid, text);
    _keepText('gb-' + dataKey + '-' + cid, text);
  });
  _rememberServerState('scores', cid, fields.scores);
  _rememberServerState('statuses', cid, fields.statuses);
  _classLoads[cid] = true;
  if (typeof clearProfCache === 'function') clearProfCache();
}

export function clearClass(cid) {
  Object.keys(_cache).forEach(field => {
    if (_cache[field] && typeof _cache[field] === 'object' && cid in _cache[field]) delete _cache[field][cid];
  });
  delete COURSES[cid];
  delete _classLoads[cid];
}

/* A signed-in teacher's class has its student page on only when the server
   has said so (shared/data.js _serverSaysStudentPage): the two settings in
   a seeded class's courseConfigs are, on their own, a value this device
   merely holds. This says the class's row came from the server with the
   switch on, as a class load does. It outlives clearClass and a cleared
   localStorage (it is the app's memory of what the server said), so a test
   that sets it takes it back: serverSaysStudentPageOn(cid, false). */
export function serverSaysStudentPageOn(cid, on) {
  if (on === false) {
    delete _serverStudentPage[cid];
    localStorage.removeItem('gb-bundle-meta-' + cid);
    return;
  }
  _setServerStudentPage(cid, true);
}

/* One student's score entries (on one assessment when `aid` is given),
   without `created`, which is the clock. */
export function entries(cid, sid, aid) {
  return (getScores(cid)[sid] || [])
    .filter(e => e && (!aid || e.assessmentId === aid))
    .map(e => {
      const copy = { ...e };
      delete copy.created;
      return copy;
    });
}

/* A short form of the same, for pins that only care what each key holds:
   { key: score }, a level with a + or − written "3+" or "3-". */
export function levels(cid, sid, aid) {
  const out = {};
  entries(cid, sid, aid).forEach(e => {
    out[e.tagId] = e.mod ? String(e.score) + (e.mod > 0 ? '+' : '-') : e.score;
  });
  return out;
}

/* What localStorage holds for a field, parsed. */
export function stored(field, cid) {
  const raw = localStorage.getItem('gb-' + _DATA_KEYS[field] + '-' + cid);
  return raw == null ? null : JSON.parse(raw);
}

/* True when localStorage holds exactly what the cache does. */
export function storedMatchesCache(field, cid) {
  return JSON.stringify(stored(field, cid)) === JSON.stringify(_cache[field][cid]);
}

/* ── The desktop pages on a linkedom document ───────────────────────────
   tests/helpers/gradebook-dom.js draws the gradebook on a linkedom page and
   gives it focus events; the real teacher/page-assignments.js is loaded on
   top of it, as teacher/app.html does. linkedom keeps no `checked`
   property, so tick() sets the attribute the page's selectors read too. */
let realPage = null;

function loadAssignmentsPage() {
  realPage = window.PageAssignments;
  runInThisContext(readFileSync('teacher/page-assignments.js', 'utf-8'), { filename: 'teacher/page-assignments.js' });
}

/* The grader dialog over the gradebook, open on one student. */
export function openGrader(seed, cid, aid, sid) {
  mount(seed, { course: cid });
  loadAssignmentsPage();
  window.PageAssignments.openGrader(cid, aid, sid);
  return document.getElementById('grader-overlay');
}

/* The Assignments page itself. */
export function openAssignments(seed, cid, params) {
  const doc = mount(seed, { course: cid });
  PageGradebook.destroy();
  const toolbar = doc.createElement('div');
  toolbar.id = 'page-toolbar-mount';
  doc.body.insertBefore(toolbar, doc.body.firstChild);
  loadAssignmentsPage();
  window.PageAssignments.init({ course: cid, ...params });
  return doc;
}

export function closePages() {
  if (realPage) {
    if (window.PageAssignments.graderOpen()) window.PageAssignments.closeGrader();
    window.PageAssignments.destroy();
  }
  unmount();
  if (realPage) window.PageAssignments = realPage;
  realPage = null;
}

/* Tick or clear a checkbox the way a click does. */
export function tick(box, on) {
  box.checked = !!on;
  if (on) box.setAttribute('checked', '');
  else box.removeAttribute('checked');
  click(box);
  fire(box, 'change');
}

/* Take the focus off a field, as clicking away does. gradebook-dom.js puts
   its focus tracking on Element.prototype, where linkedom's own
   HTMLElement.blur() hides its blur(); this calls the tracked one, which
   sends blur and focusout up to the page's document listeners. */
export function leave(field) {
  let proto = Object.getPrototypeOf(field);
  while (proto && !Object.prototype.hasOwnProperty.call(proto, 'focus')) proto = Object.getPrototypeOf(proto);
  proto.blur.call(field);
}

/* Type into a field and leave it: the pages save on blur. */
export function typeAndLeave(field, text) {
  field.focus();
  field.value = text;
  fire(field, 'input');
  leave(field);
}

/* Press the OK button of the confirm dialog that is up (teacher/ui.js). */
export function confirmOk() {
  const ok = document.getElementById('confirm-ok-btn');
  if (!ok) throw new Error('no confirm dialog is open');
  ok.onclick();
}

/* The Undo toast's text, or null when none is up. */
export function toastText() {
  const t = document.querySelector('#undo-toast span');
  return t ? t.textContent : null;
}
