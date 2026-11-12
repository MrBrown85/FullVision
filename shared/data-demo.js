/* Demo Mode's data code: the sample class's script, the student features switch, Reset Demo Data and Leave Demo Mode.
   Moved from shared/data.js on 2026-11-12 (S19 split, move only). */

/* seed-data.js, fetched once, in Demo Mode only. It holds the demo class
   (DEFAULT_COURSES), read when the classes are, and seedIfNeeded. Resolves
   at once where it has already run; a failed fetch resolves too. */
var _seedScript = null;
function _loadSeedScript() {
  if (typeof DEFAULT_COURSES !== 'undefined') return Promise.resolve();
  if (!_seedScript) {
    _seedScript = new Promise(function (resolve) {
      var s = document.createElement('script');
      s.src = '/shared/seed-data.js?v=46';
      s.onload = resolve;
      s.onerror = function () {
        _seedScript = null;
        resolve();
      };
      document.head.appendChild(s);
    });
  }
  return _seedScript;
}

/**
 * Lazily loads seed-data.js and calls seedIfNeeded() — only fetches the 113KB
 * script when actually needed (new accounts, or after explicit data reset).
 * Existing teachers with data already in localStorage never trigger the fetch.
 * Safe to call from any portal — seed-data.js has its own internal guards.
 */
window.loadSeedIfNeeded = function () {
  // Sample data is for Demo Mode only. A signed-in teacher with no classes
  // gets the empty class manager, never a fake class.
  if (typeof isDemoMode !== 'function' || !isDemoMode()) return Promise.resolve();
  // Already loaded this session — call directly (handles re-seed after data reset)
  // The demo class is built from the curriculum bank, so it loads first; a
  // failed load seeds the old built-in map instead.
  var bank = loadCurriculumIndex().catch(function () {});
  if (typeof seedIfNeeded === 'function') {
    return bank.then(function () {
      seedIfNeeded();
      applyDemoStudentPage();
    });
  }
  // User deliberately wiped all data — never auto-seed
  if (localStorage.getItem('gb-data-wiped') === '1') return Promise.resolve();
  // Lazy-load the script, then seed
  return Promise.all([_loadSeedScript(), bank]).then(function () {
    if (typeof seedIfNeeded === 'function') seedIfNeeded();
    applyDemoStudentPage();
  });
};

/* The front page's Try Demo Mode link starts Demo Mode with the student
   features showing (login-auth.js sets DEMO_STUDENT_KEY to 'pending'). Once
   the sample class is there, this turns on for it, through the same writers
   Class Settings uses: the Student Page switch, Return Grades set to When I
   Return Them, Send Work, Reflect on Feedback and Show My Learning. It does
   this once; the key then reads 'on', so a visitor's own changes stick, and
   Class Settings keeps offering the Student Page tab (cm-student-page.js).
   Any other way into Demo Mode never sets the key and nothing changes. */
var DEMO_STUDENT_KEY = 'gb-demo-student-page';
var DEMO_STUDENT_CLASS = 'sci8';
function applyDemoStudentPage() {
  if (!_isDemoSession()) return false;
  var mark = null;
  try {
    mark = localStorage.getItem(DEMO_STUDENT_KEY);
  } catch (e) {
    return false;
  }
  if (mark !== 'pending' || !COURSES[DEMO_STUDENT_CLASS]) return false;
  var cid = DEMO_STUDENT_CLASS;
  saveReturnSettings(cid, { student_page_enabled: true });
  saveReturnSettings(cid, { return_grades: 'on_return' });
  setCourseSendWork(cid, { send_work: true });
  setCourseFeedbackOptions(cid, { reflect_on_feedback: true }, _newEntryId());
  setCourseFeedbackOptions(cid, { show_my_learning: true }, _newEntryId());
  try {
    localStorage.setItem(DEMO_STUDENT_KEY, 'on');
  } catch (e) {
    /* storage blocked: it applies again next load, harmlessly */
  }
  return true;
}

/* Whether this Demo Mode began at the front page's Try Demo Mode link, so
   Class Settings offers the Student Page tab (cm-student-page.js asks here
   rather than reading storage itself). */
function demoShowsStudentPage() {
  if (!_isDemoSession()) return false;
  try {
    var mark = localStorage.getItem(DEMO_STUDENT_KEY);
    return mark === 'pending' || mark === 'on';
  } catch (e) {
    return false;
  }
}

/* Reset Demo Data: every class goes back to the sample Science 8 class.
   Demo Mode only, since it deletes every class before reseeding. The
   desktop account menu, the desktop Demo Mode pill and the phone's Demo
   Mode sheet all run this. */
window.resetDemoData = async function () {
  if (typeof isDemoMode !== 'function' || !isDemoMode()) return;
  await Promise.all(
    Object.keys(COURSES).map(function (cid) {
      return deleteCourseData(cid);
    }),
  );
  Object.keys(COURSES).forEach(function (cid) {
    delete COURSES[cid];
  });
  // seed-data.js has run by now (Demo Mode loads it at start); if it has
  // not, seedIfNeeded puts the class back itself.
  if (typeof DEFAULT_COURSES !== 'undefined') Object.assign(COURSES, structuredClone(DEFAULT_COURSES));
  saveCourses(COURSES);
  // Photos added in Demo Mode wait in the photo queue (IndexedDB), not in
  // the class data: they go too.
  var q = window.PhotoQueue;
  if (q && typeof q.wipe === 'function') {
    try {
      await q.wipe();
    } catch (e) {
      console.warn('Could not clear waiting photos:', e);
    }
  }
  // A demo that began with the student features showing gets them back.
  try {
    if (localStorage.getItem(DEMO_STUDENT_KEY) === 'on') localStorage.setItem(DEMO_STUDENT_KEY, 'pending');
  } catch (e) {
    /* storage blocked */
  }
  await window.loadSeedIfNeeded();
};

/* Leave Demo Mode for the sign-in page (href: /login.html, or
   /login.html#signup for Create an Account). A teacher can enter Demo Mode
   while signed in (the zero-class screen's Open Demo Mode), and the sign-in
   page sends a live session straight back into the app, still in Demo Mode.
   So this always goes through signOut(): it ends any session, wipes the
   device as Sign Out does (demo data, flags, outbox, report copies), tells
   other tabs, and opens href. Resolves { unsent } when signOut's check for
   unsent changes stops it; repeat calls while one runs do nothing. */
var _leavingDemo = false;
window.leaveDemoMode = async function (href, opts) {
  opts = opts || {};
  if (_leavingDemo) return;
  var sb = typeof getSupabase === 'function' ? getSupabase() : null;
  if (!sb || typeof signOut !== 'function') {
    // Local development with no Supabase: only demo data is on the device.
    try {
      Object.keys(localStorage)
        .filter(function (k) {
          return k.indexOf('gb-') === 0;
        })
        .forEach(function (k) {
          localStorage.removeItem(k);
        });
    } catch (e) {
      /* nothing stored */
    }
    window.location.href = href;
    return;
  }
  _leavingDemo = true;
  try {
    var res = await signOut({ force: !!opts.force, redirect: href });
    return res;
  } finally {
    _leavingDemo = false;
  }
};

/* The words for signOut's unsent-changes stop when leaving Demo Mode. */
window.leaveDemoUnsentText = function (n) {
  return n === 1
    ? '1 change has not reached the server. Leaving Demo Mode signs out and deletes it.'
    : n + ' changes have not reached the server. Leaving Demo Mode signs out and deletes them.';
};
