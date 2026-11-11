/* gb-data.js — Data access layer for FullVision
   Cache-through pattern: Supabase persistence with synchronous in-memory reads.
   - initData(cid) fetches all data from Supabase (or localStorage) into _cache
   - get*() functions read from _cache (synchronous)
   - save*() functions update _cache AND fire background Supabase writes
   - Falls back to localStorage when Supabase is unavailable (file:// or offline)
*/

/**
 * @typedef {Object} Student
 * @property {string} id - Unique student identifier
 * @property {string} firstName
 * @property {string} lastName
 * @property {string} [preferred] - Preferred/nickname
 * @property {string} [pronouns] - e.g. 'she/her', 'they/them'
 * @property {string} [studentNumber]
 * @property {string} [email]
 * @property {string} [dateOfBirth] - YYYY-MM-DD
 * @property {string[]} designations - Special education designation codes
 * @property {string} [enrolledDate] - ISO date
 * @property {Array} [attendance] - Attendance records
 * @property {string} sortName - 'LastName FirstName' for sorting
 */

/**
 * @typedef {Object} Assessment
 * @property {string} id - Unique assessment identifier
 * @property {string} title - Display title
 * @property {string} date - ISO date string (YYYY-MM-DD)
 * @property {'summative'|'formative'} type
 * @property {string[]} tagIds - Linked learning tag IDs
 * @property {number} [maxPoints] - Max points (points grading mode)
 * @property {number} [weight] - Assessment weight (default 1)
 * @property {string} [rubricId] - Linked rubric ID
 * @property {'individual'|'pairs'|'groups'} [collaboration]
 * @property {string} [moduleId] - Parent module ID
 * @property {string} [notes] - Teacher notes
 * @property {string[]} [coreCompetencyIds] - Linked core competency IDs
 */

/**
 * @typedef {Object} Observation
 * @property {string} id - Unique observation identifier
 * @property {string} studentId
 * @property {string} text - Observation note text
 * @property {Object} [dims] - Dimension ratings (e.g. { engagement: 'strength' })
 * @property {'strength'|'growth'|'concern'|'note'} [sentiment]
 * @property {string} [context] - e.g. 'whole-class', 'small-group', 'independent'
 * @property {string} created - ISO timestamp
 */

/**
 * @typedef {Object} TermRating
 * @property {string} studentId
 * @property {string} termId
 * @property {Object} [dims] - Dimension proficiency ratings
 * @property {string} [narrative] - Teacher narrative (may contain safe HTML)
 */

/* ══════════════════════════════════════════════════════════════════
   In-memory cache — populated by initData(), read by get*(), updated by save*()
   ══════════════════════════════════════════════════════════════════ */
const _cache = {
  courses: null, // COURSES object (global)
  config: null, // gb-config (global)
  students: {}, // keyed by cid
  categories: {}, // keyed by cid
  assessments: {}, // keyed by cid
  scores: {}, // keyed by cid
  learningMaps: {}, // keyed by cid
  courseConfigs: {}, // keyed by cid
  modules: {}, // keyed by cid
  rubrics: {}, // keyed by cid
  rubricChecks: {}, // keyed by cid — ticked Advanced Rubric checkboxes { 'sid:aid': [checkId, …] }
  rubricPrints: {}, // keyed by cid — printed rubric handouts { 'sid:aid': { at: ISO, hash } }
  // keyed by cid — Draft and Returned rows { aid: { sid: row } } (getGradeReturns).
  // Never assign a class's rows here: _saveGradeReturns (a change on this
  // device) and _loadGradeReturns (rows from the server) are the only ways
  // in. Both drop the returned set and calc.js's cached numbers.
  gradeReturns: {},
  dibels: {}, // keyed by cid — DIBELS raw scores { 'sid:aid': { boy|moy|eoy: { orfWrc, orfErrors, mazeCorrect, mazeIncorrect } } }
  flags: {}, // keyed by cid
  goals: {}, // keyed by cid
  goalDates: {}, // keyed by cid — when each goal was set { sid: { secId: ISO } }
  coreSelf: {}, // keyed by cid — Core Competency self-assessments { sid: { termKey: { coreId: entry } } }
  reflections: {}, // keyed by cid
  overrides: {}, // keyed by cid
  statuses: {}, // keyed by cid
  observations: {}, // keyed by cid
  termRatings: {}, // keyed by cid
  customTags: {}, // keyed by cid
  observationTemplates: {}, // keyed by cid — sentence starters
  notes: {}, // keyed by cid
  reportConfig: {}, // keyed by cid
  studentProfileSummaries: {}, // keyed by cid
  withdrawn: {}, // keyed by cid — withdrawn students and their records
  v2Gradebook: {}, // keyed by cid — raw get_gradebook(cid) payload (Phase 3.4+)
};

// Mapping from cache field → localStorage key suffix (and Supabase data_key)
const _DATA_KEYS = {
  students: 'students',
  categories: 'categories',
  assessments: 'assessments',
  scores: 'scores',
  learningMaps: 'learningmap',
  courseConfigs: 'courseconfig',
  modules: 'modules',
  rubrics: 'rubrics',
  rubricChecks: 'rubric-checks',
  rubricPrints: 'rubric-prints',
  gradeReturns: 'grade-returns',
  dibels: 'dibels',
  flags: 'flags',
  goals: 'goals',
  reflections: 'reflections',
  overrides: 'overrides',
  statuses: 'statuses',
  observations: 'quick-obs',
  termRatings: 'term-ratings',
  customTags: 'custom-tags',
  observationTemplates: 'obs-templates',
  notes: 'notes',
  reportConfig: 'report-config',
  studentProfileSummaries: 'student-profile-summaries',
  withdrawn: 'withdrawn',
};

let _useSupabase = false;
let _teacherId = null;
let _initPromise = null; // dedup concurrent initData calls
/* A save this device couldn't keep: localStorage keys that failed for lack
   of room, and whether the outbox has refused a write since its last
   accepted one. Shown only on the sync dot (getSaveProblem), never as a
   message. */
const _storageFullKeys = new Set();
let _outboxRefused = false;

/* The sync dot's explanation while a save problem lasts, or null. */
function getSaveProblem() {
  if (!_storageFullKeys.size && !_outboxRefused) return null;
  return "This device's storage is full, so recent changes may not be saved";
}
window.getSaveProblem = getSaveProblem;

function _saveProblemChanged() {
  if (typeof refreshSyncStatusUI === 'function') refreshSyncStatusUI();
  else _updateSyncIndicator();
}

/* Degraded-mode state (P6.1).
   _supabaseDegraded is set when initial bootstrap fails after retry. While
   degraded, _useSupabase is false but writes still go to the outbox
   (_writesEnabled), which holds them while paused. The recovery probe re-runs
   bootstrap_teacher periodically; on success it flips back to live mode and
   the outbox sends everything saved in the meantime. */
let _supabaseDegraded = false;
let _degradedReason = null;
let _recoveryProbeTimer = null;
let _recoveryProbeInFlight = false;
const _BOOTSTRAP_RETRY_DELAYS_MS = [1000, 2000, 4000];
const _RECOVERY_PROBE_INTERVAL_MS = 30000;

/* Pending-canonical-course-id state (P6.2).
   createCourse mints a local id (e.g. 'cabc123') synchronously and fires
   create_course async. Any persist call against the local id during the
   in-flight window writes to LS under the local id, then short-circuits at
   the !_isUuid(cid) gate. When the canonical UUID arrives, we (a) migrate
   every gb-{kind}-{localId} LS key + in-memory cache entry to the canonical
   id, (b) replay each entity through its diff-based save so the canonical
   store catches up. Without this, all writes during the create_course
   round-trip were silently dropped. */
const _pendingLocalCids = new Set();

/* Local-write tracking (docs/write-path-plan.md, Phase 4).
   Every local edit bumps a per-course, per-field counter. A realtime refresh
   waits until the course's writes have landed and the teacher has paused,
   records the counters, and refuses to overwrite any field whose counter
   moved while it was fetching; it runs again later instead. This replaces an
   8-second echo guard, which let a refresh overwrite a write slower than 8s
   and blocked other devices' changes for 8s after every local edit. */
var _localWrites = {}; // cid → { at: ms of last local edit, fields: { field: count } }
var _REFRESH_QUIET_MS = 2000;

function _markLocalWrite(field, cid) {
  if (!cid) return;
  var w = _localWrites[cid] || (_localWrites[cid] = { at: 0, fields: {} });
  w.at = Date.now();
  w.fields[field] = (w.fields[field] || 0) + 1;
  _markSavedCopyDirty(cid);
}

function _localWriteCount(cid, field) {
  var w = _localWrites[cid];
  return (w && w.fields[field]) || 0;
}

/* ══════════════════════════════════════════════════════════════════
   Sync status tracking
   ══════════════════════════════════════════════════════════════════ */
let _syncStatus = 'idle';
let _pendingSyncs = 0;
let _lastSyncedAt = null;
let _longFormAuthContext = null;
let _longFormSessionExpired = false;

function getSyncStatus() {
  return { status: _syncStatus, pending: _pendingSyncs };
}

function getLastSyncedAt() {
  return _lastSyncedAt;
}

function getLongFormAuthContext() {
  return _longFormAuthContext;
}

function isLongFormAuthContextActive() {
  return !!(_longFormAuthContext && _longFormAuthContext.active !== false);
}

function setLongFormAuthContext(ctx) {
  if (!ctx) {
    _longFormAuthContext = null;
    _longFormSessionExpired = false;
    return null;
  }
  _longFormAuthContext = {
    active: ctx.active !== false,
    kind: ctx.kind || 'long-form',
    getDraftText: typeof ctx.getDraftText === 'function' ? ctx.getDraftText : null,
  };
  return _longFormAuthContext;
}

function clearLongFormAuthContext(kind) {
  if (!_longFormAuthContext) return;
  if (!kind || _longFormAuthContext.kind === kind) {
    _longFormAuthContext = null;
    _longFormSessionExpired = false;
  }
}

function markLongFormSessionExpired() {
  if (!isLongFormAuthContextActive()) return false;
  _longFormSessionExpired = true;
  return true;
}

function consumeLongFormSessionExpired() {
  if (!_longFormSessionExpired || !isLongFormAuthContextActive()) return false;
  _longFormSessionExpired = false;
  return true;
}

window.getLongFormAuthContext = getLongFormAuthContext;
window.isLongFormAuthContextActive = isLongFormAuthContextActive;
window.setLongFormAuthContext = setLongFormAuthContext;
window.clearLongFormAuthContext = clearLongFormAuthContext;
window.markLongFormSessionExpired = markLongFormSessionExpired;

/** Returns a promise that resolves when all pending syncs complete.
    Passing a numeric timeout preserves the old bounded-wait behavior for tests
    or diagnostics; sign-out intentionally calls this without a ceiling. */
function waitForPendingSyncs(timeoutMs) {
  if (_pendingSyncs <= 0) return Promise.resolve();
  return new Promise(resolve => {
    const start = Date.now();
    let warned = false;
    const check = setInterval(() => {
      const elapsed = Date.now() - start;
      if (!warned && elapsed > 10000) {
        warned = true;
        console.warn('Still waiting for pending Supabase writes before sign-out:', _pendingSyncs);
        if (typeof showSyncToast === 'function') {
          showSyncToast('Still saving changes before sign-out...', 'info');
        }
      }
      if (_pendingSyncs <= 0 || (typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && elapsed > timeoutMs)) {
        clearInterval(check);
        resolve();
      }
    }, 100);
  });
}

/* A class just loaded from the server is in step with it: the phone's
   Settings says when, not "Not yet synced this session", even before the
   first change is saved. Writes still in flight keep their own time. */
function _markLoadSynced() {
  if (_pendingSyncs === 0) _lastSyncedAt = new Date().toISOString();
}

function _trackPendingSync(promise) {
  if (!promise || typeof promise.finally !== 'function') return promise;
  _pendingSyncs += 1;
  _syncStatus = 'syncing';
  _updateSyncIndicator();
  return promise.finally(function () {
    _pendingSyncs = Math.max(0, _pendingSyncs - 1);
    if (_pendingSyncs === 0) {
      _syncStatus = 'idle';
      _lastSyncedAt = new Date().toISOString();
    }
    _updateSyncIndicator();
  });
}

function _trackWriteSync(name, promise) {
  if (/^(get|list)_/i.test(name || '')) return promise;
  return _trackPendingSync(promise);
}

/* Wrap a promise so it rejects-as-error-result if it doesn't settle within
   `ms`. Used on per-row hydration calls where one slow / hung row should
   not block the whole sign-in. The timeout result has the same shape as
   the .catch() error wrapper used by the same call site, so existing
   error-handling forEach loops degrade gracefully (treat as missing row). */
function _withTimeout(promise, ms, label) {
  var timer;
  var timeout = new Promise(function (resolve) {
    timer = setTimeout(function () {
      resolve({ error: new Error((label || 'request') + ' timed out after ' + ms + 'ms') });
    }, ms);
  });
  return Promise.race([promise, timeout]).then(
    function (res) {
      clearTimeout(timer);
      return res;
    },
    function (err) {
      clearTimeout(timer);
      return { error: err };
    },
  );
}

/* The sync dot's state: the one place sync shows (DECISIONS, "Product
   shape"), with no count of changes. Desktop and phone both draw the dot from
   here. With the outbox loaded, its queue (shared by every tab) is the whole
   story: a change is saving while it is queued, and saved once it leaves.
   Counting this tab's own pending promises as well left the dot on
   "Syncing..." with an empty queue when one never settled, and a second
   painter flipped it to "All changes saved" with changes still queued. */
function getSyncDotState() {
  var problem = getSaveProblem();
  if (problem) return { status: 'error', title: problem };
  if (_syncStatus === 'degraded') return { status: 'error', title: 'Cloud sync paused — saving on this device' };
  var loadProblem = _loadProblem();
  if (loadProblem) return { status: 'error', title: loadProblem };
  var photos = _workUploadDotState() || _photoQueueDotState();
  if (photos && photos.status === 'error') return photos;
  var q = typeof window !== 'undefined' ? window.v2Queue : null;
  if (q && typeof q.stats === 'function') {
    var stats = q.stats() || {};
    var queued = Number(stats.queued || 0);
    var online = stats.online !== false && !(typeof navigator !== 'undefined' && navigator.onLine === false);
    if (Number(stats.deadLettered || 0) > 0) return { status: 'error', title: "Some changes couldn't be saved" };
    if (stats.signedOut && queued > 0)
      return { status: 'error', title: 'Signed out — changes are waiting until you sign in' };
    if (!online && queued > 0) return { status: 'error', title: 'Offline — changes are saved on this device' };
    if (queued > 0) return { status: 'syncing', title: 'Syncing...' };
    if (photos) return photos;
    return { status: 'idle', title: 'All changes saved' };
  }
  if (_pendingSyncs > 0) return { status: 'syncing', title: 'Syncing...' };
  if (photos) return photos;
  return { status: 'idle', title: 'All changes saved' };
}
window.getSyncDotState = getSyncDotState;

/* Photos of student work a signed-in teacher added that have not gone up
   yet (shared/photo-queue.js), as the sync dot says it, or null when none
   wait. Only once this page has wired the queue to send (_wireWorkQueue). */
function _photoQueueDotState() {
  var pq = typeof window !== 'undefined' ? window.PhotoQueue : null;
  if (!_workQueueWired || !pq || typeof pq.stats !== 'function') return null;
  var st;
  try {
    st = pq.stats() || {};
  } catch (e) {
    return null;
  }
  if (st.demo) return null;
  if (Number(st.failed || 0) > 0) return { status: 'error', title: "Some photos couldn't be sent" };
  if (st.storageFull) return { status: 'error', title: 'This device is full — some photos are not saved' };
  if (!(Number(st.queued || 0) > 0)) return null;
  if (st.online === false) return { status: 'error', title: 'Offline — photos are saved on this device' };
  return { status: 'syncing', title: 'Syncing...' };
}

/* Add Work's uploads the server refused after the screen had said sent
   (_workUploadStarted): one held to try again (the class was full), or
   photos that could not go in as asked and were let go. The sync dot is
   the only place this shows (CLAUDE.md rule 5). */
function _workUploadDotState() {
  if (typeof _workUploads !== 'function' || _isDemoSession()) return null;
  var all = _workUploads();
  var held = Object.keys(all).some(function (k) {
    return all[k] && all[k].held;
  });
  if (held) return { status: 'error', title: "Some photos couldn't be sent" };
  var dropped = _safeParseLS(_WORK_DROPPED_KEY, null);
  var at = dropped && Date.parse(dropped.at);
  if (at && Date.now() - at < _WORK_DROPPED_MS) return { status: 'error', title: "Some photos couldn't be added" };
  return null;
}

function _updateSyncIndicator() {
  if (typeof document === 'undefined' || !document.getElementById) return;
  // The phone keeps one dot per open screen (the Grade list stays mounted,
  // hidden, under the grading screen), so every copy is kept current.
  const first = document.getElementById('sync-indicator-dot');
  if (!first) return;
  const dots =
    typeof document.querySelectorAll === 'function'
      ? Array.from(document.querySelectorAll('[id="sync-indicator-dot"]'))
      : [];
  if (dots.indexOf(first) < 0) dots.unshift(first);
  var state = getSyncDotState();
  dots.forEach(function (dot) {
    dot.className = 'tb-sync-dot ' + state.status;
    dot.title = state.title;
    if (typeof dot.setAttribute === 'function') dot.setAttribute('aria-label', state.title);
  });
}

function isSupabaseDegraded() {
  return _supabaseDegraded;
}

/* Run one bootstrap_teacher + list_teacher_courses cycle.
   Throws on any error so the caller can decide whether to retry or degrade.
   Returns the data the cache hydration step needs. */
async function _attemptInitialBootstrap(sb) {
  const {
    data: { session },
  } = await sb.auth.getSession();
  const email = (session && session.user && session.user.email) || '';
  const displayName =
    (session && session.user && session.user.user_metadata && session.user.user_metadata.display_name) || null;

  const bootRes = await sb.rpc('bootstrap_teacher', {
    p_email: email,
    p_display_name: displayName,
  });
  if (bootRes.error) throw bootRes.error;
  const teacher = bootRes.data || {};

  const coursesRes = await sb.rpc('list_teacher_courses');
  if (coursesRes.error) throw coursesRes.error;

  return { teacher, courseRows: coursesRes.data || [] };
}

/* Wrap _attemptInitialBootstrap with retry-with-backoff. 1 initial attempt
   plus retries at 1s/2s/4s. On final failure, throws the last error. */
async function _bootstrapWithRetry(sb) {
  var lastErr = null;
  var attempts = 1 + _BOOTSTRAP_RETRY_DELAYS_MS.length;
  for (var i = 0; i < attempts; i++) {
    try {
      return await _attemptInitialBootstrap(sb);
    } catch (e) {
      lastErr = e;
      if (i < _BOOTSTRAP_RETRY_DELAYS_MS.length) {
        await new Promise(function (r) {
          setTimeout(r, _BOOTSTRAP_RETRY_DELAYS_MS[i]);
        });
      }
    }
  }
  throw lastErr || new Error('bootstrap failed');
}

function _enterDegradedMode(reason) {
  _useSupabase = false;
  _supabaseDegraded = true;
  _degradedReason = reason;
  _syncStatus = 'degraded';
  // Shown only on the sync dot (CLAUDE.md rule 5); the probe keeps retrying.
  _updateSyncIndicator();
  _scheduleRecoveryProbe();
}

function _scheduleRecoveryProbe() {
  if (!_supabaseDegraded) return;
  if (_recoveryProbeTimer) return;
  _recoveryProbeTimer = setTimeout(function () {
    _recoveryProbeTimer = null;
    _attemptRecoveryProbe();
  }, _RECOVERY_PROBE_INTERVAL_MS);
}

async function _attemptRecoveryProbe() {
  if (!_supabaseDegraded || _recoveryProbeInFlight) return;
  _recoveryProbeInFlight = true;
  try {
    const sb = typeof getSupabase === 'function' ? getSupabase() : null;
    if (!sb) {
      _scheduleRecoveryProbe();
      return;
    }
    const data = await _attemptInitialBootstrap(sb);
    _exitDegradedMode(data);
  } catch (e) {
    console.warn('Supabase recovery probe failed; will retry:', e);
    _scheduleRecoveryProbe();
  } finally {
    _recoveryProbeInFlight = false;
  }
}

/* Manual retry — a click on the sync dot while sync is paused. Cancels the
   pending timer and probes immediately. */
function retrySupabaseRecovery() {
  if (!_supabaseDegraded) return Promise.resolve();
  if (_recoveryProbeTimer) {
    clearTimeout(_recoveryProbeTimer);
    _recoveryProbeTimer = null;
  }
  return _attemptRecoveryProbe();
}

function _exitDegradedMode(bootstrapData) {
  _supabaseDegraded = false;
  _degradedReason = null;
  _useSupabase = true;
  _syncStatus = 'idle';
  if (_recoveryProbeTimer) {
    clearTimeout(_recoveryProbeTimer);
    _recoveryProbeTimer = null;
  }
  // Refresh global cache from the recovery bootstrap so subsequent diffs
  // compare against canonical state, not the pre-degraded snapshot.
  if (bootstrapData) {
    var teacher = bootstrapData.teacher || {};
    var prefs = teacher.preferences || {};
    _teacherId = teacher.id || _teacherId;
    var prevCourses = _coursesBeforeBoot();
    _cache.courses = _canonicalCoursesToBlob(bootstrapData.courseRows || [], prevCourses);
    _sendUpCurriculumTags(bootstrapData.courseRows, prevCourses);
    _cache.config = {
      activeCourse: prefs.active_course_id || null,
      viewMode: prefs.view_mode || null,
      mobileViewMode: prefs.mobile_view_mode || null,
      mobileSortMode: prefs.mobile_sort_mode || null,
      cardWidgetConfig: prefs.card_widget_config || null,
      dashboardPrefs: prefs.dashboard_prefs || null,
      displayName: teacher.display_name || null,
      email: teacher.email || null,
      accountDeletedAt: teacher.deleted_at || null,
    };
    COURSES = _cache.courses;
    _safeLSSet('gb-courses', JSON.stringify(_cache.courses));
    _safeLSSet('gb-config', JSON.stringify(_cache.config));
    _releaseDiscardsByClassList(bootstrapData.courseRows);
  }
  var outbox = _outbox();
  if (outbox) outbox.flush();
  _updateSyncIndicator();
}

/* Migrate course-scoped data from a local placeholder cid to the canonical
   UUID returned by create_course (P6.2). The save-function diff path
   compares "what's persisted under this cid" (prev) vs. "what's being
   written" (next); if we migrated LS straight across, prev would equal next
   and the diff would dispatch nothing. So we (a) capture the user's edits
   into a snapshot, (b) clear LS + cache for both ids, (c) re-call each save
   with the snapshot — the diff now sees empty→edits and dispatches full
   inserts to the canonical store. */
function _migrateCourseDataLocalToCanonical(localId, canonicalId) {
  if (!localId || !canonicalId || localId === canonicalId) return;
  // Draft and Returned: the saves replayed below are the class's own data
  // moving, not grading. The rule stands aside; the rows move as they are.
  _movingClass = true;
  try {
    _moveCourseDataLocalToCanonical(localId, canonicalId);
  } finally {
    _movingClass = false;
  }
}
function _moveCourseDataLocalToCanonical(localId, canonicalId) {
  // 1. Snapshot the user's edits from LS (preferred) or cache for each field.
  var userEdits = {};
  Object.keys(_DATA_KEYS).forEach(function (field) {
    var dataKey = _DATA_KEYS[field];
    if (!dataKey) return;
    var srcKey = 'gb-' + dataKey + '-' + localId;
    var raw = localStorage.getItem(srcKey);
    if (raw != null) {
      try {
        userEdits[field] = JSON.parse(raw);
      } catch (e) {
        /* skip un-parseable */
      }
      try {
        localStorage.removeItem(srcKey);
      } catch (e) {
        /* ignore */
      }
    } else if (_cache[field] && Object.prototype.hasOwnProperty.call(_cache[field], localId)) {
      userEdits[field] = _cache[field][localId];
    }
  });
  // 2. Clear cache for BOTH the local id (no longer valid) and the canonical
  //    id (so the next save's prev-snapshot lookup falls through to empty).
  //    courses and config are global, not keyed by course id: courses is
  //    COURSES itself, so clearing it here deleted the class just created.
  Object.keys(_cache).forEach(function (field) {
    if (field === 'courses' || field === 'config') return;
    var bucket = _cache[field];
    if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) return;
    delete bucket[localId];
    delete bucket[canonicalId];
  });
  _forgetServerState(localId);
  _forgetServerState(canonicalId);
  // 3. Replay each entity that had user edits. Each save function diffs
  //    prev=empty (LS cleared above, cache cleared) vs. next=user-edits and
  //    dispatches a full insert through the canonical persist path.
  if (userEdits.students) {
    try {
      saveStudents(canonicalId, userEdits.students);
    } catch (e) {
      console.warn('Pending-cid replay saveStudents failed', e);
    }
  }
  if (userEdits.assessments) {
    try {
      saveAssessments(canonicalId, userEdits.assessments);
    } catch (e) {
      console.warn('Pending-cid replay saveAssessments failed', e);
    }
  }
  if (userEdits.scores) {
    try {
      saveScores(canonicalId, userEdits.scores);
    } catch (e) {
      console.warn('Pending-cid replay saveScores failed', e);
    }
  }
  if (userEdits.statuses) {
    try {
      saveAssignmentStatuses(canonicalId, userEdits.statuses);
    } catch (e) {
      console.warn('Pending-cid replay saveAssignmentStatuses failed', e);
    }
  }
  if (userEdits.categories && typeof saveCategories === 'function') {
    try {
      saveCategories(canonicalId, userEdits.categories);
    } catch (e) {
      console.warn('Pending-cid replay saveCategories failed', e);
    }
  }
  if (userEdits.modules) {
    try {
      saveModules(canonicalId, userEdits.modules);
    } catch (e) {
      console.warn('Pending-cid replay saveModules failed', e);
    }
  }
  if (userEdits.rubrics) {
    try {
      saveRubrics(canonicalId, userEdits.rubrics);
    } catch (e) {
      console.warn('Pending-cid replay saveRubrics failed', e);
    }
  }
  if (userEdits.learningMaps) {
    try {
      saveLearningMap(canonicalId, userEdits.learningMaps);
    } catch (e) {
      console.warn('Pending-cid replay saveLearningMap failed', e);
    }
  }
  // courseConfigs is captured (and cleared) by step 1 like every other keyed
  // field, so without a replay the policy blob written during the in-flight
  // window — the class wizard's calc method and decay weight — is dropped.
  if (userEdits.courseConfigs) {
    try {
      saveCourseConfig(canonicalId, userEdits.courseConfigs);
      // A class made on this device goes up with the Return Grades choice
      // it was made with (Duplicate Class copies the original's): the one
      // time the choice is sent that is not a click on it. Never the
      // switch: a new class's student page is off.
      if (Object.prototype.hasOwnProperty.call(userEdits.courseConfigs, 'return_grades') && _writesEnabled()) {
        saveReturnSettings(canonicalId, { return_grades: userEdits.courseConfigs.return_grades });
      }
    } catch (e) {
      console.warn('Pending-cid replay saveCourseConfig failed', e);
    }
  }
  if (userEdits.notes) {
    try {
      saveNotes(canonicalId, userEdits.notes);
    } catch (e) {
      console.warn('Pending-cid replay saveNotes failed', e);
    }
  }
  if (userEdits.customTags) {
    try {
      saveCustomTags(canonicalId, userEdits.customTags);
    } catch (e) {
      console.warn('Pending-cid replay saveCustomTags failed', e);
    }
  }
  // Goals/reflections/observations/flags currently have LS-only bulk saves
  // (per audit P6.6/P6.7). Their per-action UI paths fire RPCs directly, so
  // anything written via the bulk save during the pending window stays local
  // until P6.6 wires those bulk fallbacks. Migrate cache+LS for parity even
  // though no canonical dispatch fires today.
  [
    'goals',
    'reflections',
    'observations',
    'flags',
    'overrides',
    'termRatings',
    'reportConfig',
    'withdrawn',
    'gradeReturns',
  ].forEach(function (field) {
    if (userEdits[field] !== undefined && _cache[field]) {
      _cache[field][canonicalId] = userEdits[field];
      var dataKey = _DATA_KEYS[field];
      if (dataKey) _safeLSSet('gb-' + dataKey + '-' + canonicalId, JSON.stringify(userEdits[field]));
    }
  });
  // 4. gb-config's active-course pointer is keyed by course id as well. If it
  //    still holds the placeholder, move it across — otherwise it survives the
  //    re-key permanently and every later saveConfig re-sends a non-uuid to
  //    save_teacher_preferences. This save also lets the server-side pointer
  //    catch up now that a canonical id exists.
  try {
    var cfg = getConfig();
    if (cfg && cfg.activeCourse === localId) {
      saveConfig(Object.assign({}, cfg, { activeCourse: canonicalId }));
    }
  } catch (e) {
    console.warn('Active-course pointer migration failed', e);
  }
}

/* ══════════════════════════════════════════════════════════════════
   Cross-tab conflict detection
   ══════════════════════════════════════════════════════════════════ */
let _crossTabChannel = null;
let _crossTabAlerted = false;
let _courseSyncChannel = null;
let _courseSyncCourseId = null;
let _courseSyncState = {};

function _isGradebookField(field) {
  return ['students', 'categories', 'assessments', 'scores', 'withdrawn', 'gradeReturns'].indexOf(field) >= 0;
}

function _isStudentRecordField(field) {
  return (
    [
      'flags',
      'goals',
      'reflections',
      'overrides',
      'observations',
      'statuses',
      'termRatings',
      'reportConfig',
      'studentProfileSummaries',
    ].indexOf(field) >= 0
  );
}

var _refreshState = {}; // cid → { kind, running, snapshot, skipped }

/* A course changed on the server (another device, another tab, or our own
   writes landing). Refresh it once it's safe: see _localWrites above. */
function _handleExternalCourseUpdate(cid, kind) {
  if (!cid) return Promise.resolve();
  var st = _refreshState[cid] || (_refreshState[cid] = {});
  st.kind = st.kind === 'gradebook' || kind === 'gradebook' ? 'gradebook' : 'student-records';
  if (!st.running) st.running = _runCourseRefresh(cid, st);
  return st.running;
}

async function _runCourseRefresh(cid, st) {
  try {
    // Runs until a pass applies everything. A field skipped because of a
    // newer local edit is fetched again, after the next pause: each pass
    // waits for quiet first, so a teacher who keeps typing costs one fetch
    // per pause, not a busy loop. This used to stop after three passes and
    // leave the class stale until another server change arrived.
    while (st.kind) {
      await _waitForQuietCourse(cid);
      var kind = st.kind;
      st.kind = null;
      st.snapshot = Object.assign({}, (_localWrites[cid] && _localWrites[cid].fields) || {});
      st.skipped = false;
      // The outbox has drained, so what this fetch brings back includes
      // everything sent so far.
      _echoNeedsReload = false;
      var versionBefore = _classVersion[cid];
      try {
        if (kind === 'student-records' && !_classBundleEnabled()) {
          // Observations bump the same timestamp, so reload them too.
          await Promise.all([loadStudentProfileSummaries(cid), _hydrateObservations(cid)]);
        } else await initData(cid);
      } catch (e) {
        console.warn('Realtime refresh failed for ' + cid + ':', e);
      } finally {
        st.snapshot = null;
      }
      // A check that found nothing new leaves the page as it is: re-rendering
      // would reset scroll position and open menus for no reason.
      var changed = !_classBundleEnabled() || _classVersion[cid] !== versionBefore || st.skipped;
      if (changed) _invalidateAndRerender();
      if (st.skipped && !st.kind) st.kind = kind;
    }
  } finally {
    st.running = null;
  }
}

/* Resolves once nothing is waiting to be sent and the course has had no
   local edit for _REFRESH_QUIET_MS. */
async function _waitForQuietCourse(cid) {
  while (true) {
    if (_hasUnsentWrites()) {
      await new Promise(function (resolve) {
        setTimeout(resolve, 250);
      });
      continue;
    }
    var last = (_localWrites[cid] && _localWrites[cid].at) || 0;
    var wait = last + _REFRESH_QUIET_MS - Date.now();
    if (wait <= 0) return;
    await new Promise(function (resolve) {
      setTimeout(resolve, wait);
    });
  }
}

/* True when a running refresh must not overwrite this field: the teacher
   edited it after the refresh started. */
function _refreshMustSkip(cid, field) {
  var st = _refreshState[cid];
  if (!st || !st.snapshot) return false;
  if (_localWriteCount(cid, field) === (st.snapshot[field] || 0)) return false;
  st.skipped = true;
  return true;
}

/* Realtime reports this page's own changes too. Downloading the whole class
   again for each one (after every burst of grading) is wasted: this page
   already holds the change. A version is this page's own echo when the
   database recorded this page's client id (x-fv-client, shared/supabase.js)
   on exactly the next version, and nothing this page sent since the last
   load comes back changed by the server: a create gets a server id and
   position, a delete cascades, and a write relayed from another tab isn't
   in this page's copy. Anything else reloads as before. */
var _ECHO_SAFE_RPCS = {
  upsert_score: true,
  upsert_tag_score: true,
  upsert_rubric_score: true,
  set_rubric_check: true,
  set_rubric_printed: true,
  upsert_dibels_score: true,
  set_score_status: true,
  save_score_comment: true,
  save_score_report_note: true,
  clear_score: true,
  update_assessment: true,
  save_collab: true,
  save_assessment_tags: true,
  update_student: true,
  update_enrollment: true,
  update_observation: true,
  delete_observation: true,
  upsert_goal: true,
  upsert_reflection: true,
  upsert_section_override: true,
  clear_section_override: true,
  save_term_rating: true,
  save_report_config: true,
  update_course: true,
  archive_course: true,
  // Return changes only which grades are returned, which the class load does
  // not carry: the rows are read on their own (_refreshGradeReturnsSoon).
  return_grades: true,
  // Marks and reflections are not in the class load either (S9-W1, S10-W1);
  // Return with Mark Up is Return, and gives the marks.
  return_work: true,
  save_markup: true,
  answer_reflection: true,
  return_for_revision: true,
  set_revision_request: true,
  cancel_revision: true,
};
var _echoNeedsReload = false;

function _noteOutboxSend(info) {
  if (!info || !info.fromThisTab || !_ECHO_SAFE_RPCS[info.endpoint]) _echoNeedsReload = true;
}

function _isOwnChangeEcho(cid, row, version) {
  var me = typeof window !== 'undefined' ? window.__fvClientId : null;
  if (!me || !row || row.last_client !== me) return false;
  if (_echoNeedsReload || _classVersion[cid] == null) return false;
  return version === _classVersion[cid] + 1;
}

function _unsubscribeCourseSyncCursor() {
  var sb = getSupabase();
  if (sb && _courseSyncChannel) {
    try {
      sb.removeChannel(_courseSyncChannel);
    } catch (e) {
      /* ignore channel cleanup failures */
    }
  }
  _courseSyncChannel = null;
  _courseSyncCourseId = null;
}

function _updateCourseSyncState(cid, row) {
  if (!cid) return;
  row = row || {};
  _courseSyncState[cid] = {
    gradebookUpdatedAt: row.gradebook_updated_at || row.gradebookUpdatedAt || null,
    studentRecordsUpdatedAt: row.student_records_updated_at || row.studentRecordsUpdatedAt || null,
  };
}

async function _subscribeCourseSyncCursor(cid) {
  if (!_useSupabase || !_isUuid(cid)) return;
  if (_courseSyncCourseId === cid && _courseSyncChannel) return;
  _unsubscribeCourseSyncCursor();

  var sb = getSupabase();
  if (!sb) return;
  if (typeof sb.channel !== 'function') return;

  if (typeof sb.from === 'function') {
    try {
      var baseline = await sb
        .from('course_sync_cursor')
        .select('course_id,gradebook_updated_at,student_records_updated_at')
        .eq('course_id', cid)
        .maybeSingle();
      if (!baseline.error) _updateCourseSyncState(cid, baseline.data);
    } catch (e) {
      console.warn('course_sync_cursor baseline read failed:', e);
    }
  }

  _courseSyncCourseId = cid;
  var joined = false;
  _courseSyncChannel = sb
    .channel('course-sync-' + cid)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'course_sync_cursor',
        filter: 'course_id=eq.' + cid,
      },
      function (payload) {
        var next = (payload && payload.new) || {};
        var prev = _courseSyncState[cid] || {};
        _updateCourseSyncState(cid, next);
        // The version moves on every change to the class; the timestamps are
        // for clients from before it existed.
        if (next.version != null && _classBundleEnabled()) {
          var version = Number(next.version);
          if (version === _classVersion[cid]) return;
          if (_isOwnChangeEcho(cid, next, version)) {
            _classVersion[cid] = version;
            return;
          }
          _handleExternalCourseUpdate(cid, 'gradebook');
          return;
        }
        if (next.gradebook_updated_at && next.gradebook_updated_at !== prev.gradebookUpdatedAt) {
          _handleExternalCourseUpdate(cid, 'gradebook');
          return;
        }
        if (next.student_records_updated_at && next.student_records_updated_at !== prev.studentRecordsUpdatedAt) {
          _handleExternalCourseUpdate(cid, 'student-records');
        }
      },
    )
    .subscribe(function (status) {
      if (status === 'CHANNEL_ERROR') {
        console.warn('course_sync_cursor subscription failed for', cid);
      }
      // Events sent while the channel was down are not replayed, so check
      // the class again when it reconnects.
      if (status === 'SUBSCRIBED') {
        if (joined) _revalidateActiveClass();
        joined = true;
      }
    });
}

function _initCrossTab() {
  if (_crossTabChannel) return;
  _crossTabAlerted = false;
  try {
    _crossTabChannel = new BroadcastChannel('td-data-sync');
    _crossTabChannel.onmessage = function (event) {
      var msg = event && event.data;
      if (msg && msg.type === 'rekey') return _applyRemoteRekey(msg);
      if (!msg || !msg.cid || msg.cid !== getActiveCourse()) return;
      if (_isGradebookField(msg.field)) {
        _handleExternalCourseUpdate(msg.cid, 'gradebook');
      } else if (_isStudentRecordField(msg.field)) {
        _handleExternalCourseUpdate(msg.cid, 'student-records');
      }
    };
  } catch (e) {
    // BroadcastChannel not supported — fall back to storage event
  }
  // Fallback for browsers without BroadcastChannel: the storage event fires
  // when another tab writes localStorage. Only the open class's keys count.
  // With both listeners, every load in one tab (which writes localStorage)
  // made the other tab reload, and that reload made the first one reload.
  if (_crossTabChannel) return;
  window.addEventListener('storage', function (e) {
    var cid = getActiveCourse();
    if (e.key && cid && e.key.startsWith('gb-') && e.key.endsWith('-' + cid) && !_crossTabAlerted) {
      _crossTabAlerted = true;
      _handleExternalCourseUpdate(cid, 'gradebook').finally(function () {
        _crossTabAlerted = false;
      });
    }
  });
}

function _broadcastChange(cid, field) {
  if (_crossTabChannel) {
    try {
      _crossTabChannel.postMessage({ type: 'data-changed', cid: cid, field: field });
    } catch (e) {
      /* fire-and-forget — channel may be closed */
    }
  }
}

/* A create landed here and its local id became a server id. The outbox is
   shared, so the tab that queued the create is often not the one that sent
   it; every tab holding the local id in memory needs the new one. */
function _broadcastRekey(cid, kind, localId, serverId, extra) {
  if (!_crossTabChannel) return;
  try {
    _crossTabChannel.postMessage({
      type: 'rekey',
      cid: cid,
      kind: kind,
      localId: localId,
      serverId: serverId,
      extra: extra || null,
    });
  } catch (e) {
    /* fire-and-forget */
  }
}

/* The other tab already rewrote the shared gb-* copy, the outbox and the
   server; this tab only brings its memory in line (_applyingRemoteRekey
   keeps _rekeyField off localStorage). A course moves in COURSES only: the
   wizard's replay (_migrateCourseDataLocalToCanonical) ran in the other tab. */
var _applyingRemoteRekey = false;
function _applyRemoteRekey(msg) {
  if (!msg || !msg.cid || !msg.kind || !msg.localId || !msg.serverId) return;
  if (msg.kind === 'course') {
    var saved = _safeParseLS('gb-courses', null);
    if (saved && typeof saved === 'object') {
      COURSES = saved;
      _cache.courses = COURSES;
    }
    _pendingLocalCids.delete(msg.localId);
    return;
  }
  _applyingRemoteRekey = true;
  try {
    _rekey(msg.cid, msg.kind, msg.localId, msg.serverId, Object.assign({}, msg.extra || {}, { remote: true }));
  } finally {
    _applyingRemoteRekey = false;
  }
}

/* ══════════════════════════════════════════════════════════════════
   Supabase sync helpers — removed in Phase 6.1 of the reconciliation plan.
   The legacy bridge (_syncToSupabase / _doSync / _initRealtimeSync /
   _refreshFromSupabase / _handleCrossTabChange / _deleteFromSupabase) wrote
   to public-schema tables that were dropped by the v2 schema. Writes now
   route through v2 RPC dispatch (window.v2.*) directly from the save paths;
   offline queuing lives in window.v2Queue (shared/offline-queue.js).
   ══════════════════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════════════════════════════
   Initialization — call once per page load (or on course switch)
   ══════════════════════════════════════════════════════════════════ */

/* One-time LocalStorage migration: convert assignment-status values from the
 * legacy long form ('notSubmitted' / 'excused' / 'late' — what desktop used
 * to write before 2026-04-23) to the short form ('NS' / 'EXC' / 'LATE' — the
 * server's CHECK constraint and the only form `shared/calc.js` now
 * recognizes).
 *
 * Background: the desktop client silently failed every `set_score_status`
 * RPC call because the server rejects long-form strings; statuses only
 * persisted to LocalStorage. The mobile client wrote the correct short
 * form to both LS and server, but `calc.js` only recognized the long form
 * — so mobile-set flags were visually present but mathematically a no-op.
 * Standardizing everything on the short form fixes both directions; this
 * migration rewrites teachers' historical LS data so their existing
 * statuses start counting correctly.
 *
 * Idempotent: only touches values that need rewriting, backs up the raw
 * pre-migration JSON to `gb-mig-bak-statuses-<cid>` on the first rewrite,
 * safe to run every boot. */
function _migrateAssignmentStatusFormat() {
  var MAP = { notSubmitted: 'NS', excused: 'EXC', late: 'LATE' };
  // Snapshot matching keys first — mutating localStorage while iterating
  // by index can skip entries.
  var keys = [];
  for (var i = 0; i < localStorage.length; i++) {
    var k = localStorage.key(i);
    if (k && k.indexOf('gb-statuses-') === 0) keys.push(k);
  }
  keys.forEach(function (key) {
    var raw = localStorage.getItem(key);
    if (!raw) return;
    var obj;
    try {
      obj = JSON.parse(raw);
    } catch (e) {
      return;
    }
    if (!obj || typeof obj !== 'object') return;
    var changed = false;
    for (var k in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, k) && MAP[obj[k]]) {
        obj[k] = MAP[obj[k]];
        changed = true;
      }
    }
    if (changed) {
      var cid = key.slice('gb-statuses-'.length);
      // Back up the raw pre-migration JSON (not the migrated form) so
      // anything goes wrong we can hand-restore. Mirrors the
      // _backupBeforeMigration pattern used by the student-schema
      // migrations above, but reads from LS rather than the in-memory
      // cache (which hasn't been populated yet at this boot stage).
      _safeLSSet('gb-mig-bak-statuses-' + cid, JSON.stringify({ data: raw, ts: Date.now() }));
      try {
        localStorage.setItem(key, JSON.stringify(obj));
      } catch (e) {
        console.warn('[status-migration] write failed for', key, e);
      }
    }
  });
}

/** Load global data (courses + config). Call before initData(). */
/* Saved class data belongs to one teacher. If someone else signed in on
   this browser last (a shared computer whose previous user's session
   expired without signing out), their saved classes are removed before
   anything reads them. The outbox (fv-*) is left alone: its entries carry
   their own owner and are filtered by v2Queue. */
function _scopeLocalDataToTeacher(uid) {
  if (!uid) return;
  var owner = null;
  try {
    owner = localStorage.getItem('gb-owner');
  } catch (e) {
    return;
  }
  if (owner && owner !== uid) {
    _removeLocalKeys(function (key) {
      return key.startsWith('gb-') || key.startsWith('gb_');
    });
    Object.keys(_DATA_KEYS).forEach(function (field) {
      _cache[field] = {};
    });
  }
  _safeLSSet('gb-owner', uid);
}

/* Remove saved data for classes the server no longer lists, e.g. a class
   deleted on another device. */
function _purgeUnlistedCourseData(courses) {
  var listed = courses || {};
  _removeLocalKeys(function (key) {
    var m = key.match(/^gb-.+-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
    return !!m && !listed[m[1]];
  });
}

/* The server's class list has just been read (`rows`). A save discarded
   for a class keeps the sync dot red until that class has been read again
   (_discardWrite). Two classes never are: one gone from the server (deleted
   on another device, or no longer this teacher's), and an archived one,
   which is not preloaded. For those the list itself is the server's word:
   a class gone from it ends the red dot now; an archived class's ends at
   the next app open, so it lasts through the sitting the save was
   discarded in. A live class waits to be read, as before. */
function _releaseDiscardsByClassList(rows) {
  var q = typeof window !== 'undefined' ? window.v2Queue : null;
  if (!q || typeof q.deadLetter !== 'function' || typeof q.releaseDiscarded !== 'function') return;
  try {
    var listed = {};
    (rows || []).forEach(function (r) {
      if (r && r.id) listed[r.id] = r;
    });
    var seen = {};
    var released = 0;
    q.deadLetter().forEach(function (e) {
      var cid = e && e.until_reload;
      if (!cid || seen[cid]) return;
      seen[cid] = true;
      if (!listed[cid]) released += q.releaseDiscarded(cid);
      else if (listed[cid].is_archived) released += q.releaseDiscarded(cid, { earlierPage: true });
    });
    if (released) _updateSyncIndicator();
  } catch (e) {
    /* the dot stays red; the next list read tries again */
  }
}

function _removeLocalKeys(test) {
  try {
    var keys = [];
    for (var i = 0; i < localStorage.length; i++) {
      var key = localStorage.key(i);
      if (key && test(key)) keys.push(key);
    }
    keys.forEach(function (key) {
      localStorage.removeItem(key);
    });
  } catch (e) {
    console.warn('Could not clear saved class data:', e);
  }
}

async function initAllCourses() {
  // Run one-time LS format migrations before any read of cached data.
  _migrateAssignmentStatusFormat();
  // A student delete the old client held for its Undo toast can't be sent.
  dropHeldStudentDeletes();

  // Demo mode: hard-skip Supabase, force local-only, ensure seed data exists.
  // Set by the "Try Demo Mode" button on the login page. Gated on the
  // companion token set by login-auth.js so a lone gb-demo-mode='1' written
  // in DevTools after sign-out cannot reactivate demo mode (see
  // isDemoMode() in shared/supabase.js).
  var _demoMode = typeof isDemoMode === 'function' && isDemoMode();
  if (_demoMode) {
    _useSupabase = false;
    _teacherId = 'demo-user';
    // The demo class (DEFAULT_COURSES) is in seed-data.js: have it before
    // the classes are read, so a first visit opens on it as it always has.
    await _loadSeedScript();
  }

  // Check Supabase availability
  if (!_demoMode && typeof getSupabase === 'function') {
    const sb = getSupabase();
    if (sb) {
      try {
        const {
          data: { session },
        } = await sb.auth.getSession();
        if (session && session.user) {
          _useSupabase = true;
          _teacherId = session.user.id;
          _scopeLocalDataToTeacher(session.user.id);
        }
      } catch (e) {
        console.warn('Supabase session check failed, falling back to localStorage:', e);
      }
    }
  }

  // Load global state from v2 RPCs:
  //   bootstrap_teacher(email, display_name) → { id, email, display_name,
  //     created_at, deleted_at, preferences: { active_course_id, view_mode,
  //     mobile_view_mode, mobile_sort_mode, card_widget_config, dashboard_prefs } }
  //     Creates teacher + teacher_preference on first sign-in;
  //     returns existing rows on subsequent sign-ins.
  //   list_teacher_courses() → [{ id, name, grade_level, description, color,
  //     is_archived, display_order, grading_system, calc_method, decay_weight,
  //     timezone, late_work_policy, created_at, updated_at, block,
  //     curriculum_tags }, ...]
  // On any failure fall back to localStorage so the app still loads offline.
  if (_useSupabase) {
    const sb = getSupabase();
    try {
      const data = await _bootstrapWithRetry(sb);
      const teacher = data.teacher || {};
      const prefs = teacher.preferences || {};
      _teacherId = teacher.id || _teacherId;

      const prevCourses = _coursesBeforeBoot();
      _cache.courses = _canonicalCoursesToBlob(data.courseRows || [], prevCourses);
      _sendUpCurriculumTags(data.courseRows, prevCourses);
      _cache.config = {
        activeCourse: prefs.active_course_id || null,
        viewMode: prefs.view_mode || null,
        mobileViewMode: prefs.mobile_view_mode || null,
        mobileSortMode: prefs.mobile_sort_mode || null,
        cardWidgetConfig: prefs.card_widget_config || null,
        dashboardPrefs: prefs.dashboard_prefs || null,
        displayName: teacher.display_name || null,
        email: teacher.email || null,
        // deleted_at non-null ⇒ pending soft-delete; Pass C §5 prompts restore.
        accountDeletedAt: teacher.deleted_at || null,
      };
      // Mirror to localStorage so offline reloads (or transient Supabase failures)
      // can boot from cache instead of starting empty.
      _safeLSSet('gb-courses', JSON.stringify(_cache.courses));
      _safeLSSet('gb-config', JSON.stringify(_cache.config));
      _purgeUnlistedCourseData(_cache.courses);
      _purgeStaleSavedCopies();
      _releaseDiscardsByClassList(data.courseRows);
      _syncStatus = 'idle';
      _updateSyncIndicator();
    } catch (e) {
      console.warn('v2 course load failed after retry; entering degraded mode:', e);
      _enterDegradedMode(e);
    }
  }

  // Fall back to localStorage when Supabase is unavailable or the RPC load failed.
  if (!_useSupabase || _cache.courses === null) {
    _cache.courses = _loadCoursesFromLS();
    _cache.config = _safeParseLS('gb-config', {});
  }

  // Ensure COURSES global is set
  COURSES = _cache.courses;
  if (!localStorage.getItem('gb-courses') && !_useSupabase) saveCourses(COURSES);

  // v2: the legacy gb-retry-queue (targeted dropped public-schema tables) is
  // permanently discarded — replaced by window.v2Queue in Phase 4.10.
  try {
    localStorage.removeItem('gb-retry-queue');
  } catch (e) {
    /* ignore */
  }

  // Start cross-tab conflict detection
  _initCrossTab();
  // Wire the outbox now, not at the first write: whichever tab owns the
  // sending must send through the auth guard and re-key the creates it lands.
  _outbox();

  // v2: Realtime / cross-device sync removed with the legacy public-schema
  // tables. The canonical v2 schema has its own publication strategy to be
  // designed (tracked in the post-reconciliation backlog).

  // Re-fetch from Supabase when user returns to this tab/app
  _initVisibilityRefresh();
}

/* True while the teacher is typing in a field on the page. Re-rendering then
   replaces the field mid-entry: Chrome fires blur on the removed input, its
   handler saves the half-typed value ("1" of "16"), and the new input shows
   that value, so the number appears to jump around. */
function _isEditingField() {
  var el = typeof document !== 'undefined' ? document.activeElement : null;
  if (!el || el === document.body) return false;
  return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
}

var _rerenderDeferred = false;

/* A press on a button is what usually moves focus out of a field. A redraw
   between its pointerdown and the click swaps the button out from under the
   pointer and the click is lost: Save Categories or Late took a second
   click after typing (Nov 3 sweep). So a redraw that comes during a press
   (often the one that waited for the field) waits for it to finish. */
var _pointerPressed = false;
var _pressDeferred = false;
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener(
    'pointerdown',
    function () {
      _pointerPressed = true;
    },
    true,
  );
  ['pointerup', 'pointercancel'].forEach(function (type) {
    document.addEventListener(
      type,
      function () {
        _pointerPressed = false;
      },
      true,
    );
  });
}
function _afterPress(fn) {
  if (!_pointerPressed) return fn();
  var done = false;
  var run = function () {
    if (done) return;
    done = true;
    document.removeEventListener('pointerup', onEnd, true);
    document.removeEventListener('pointercancel', onEnd, true);
    clearTimeout(guard);
    // The click is dispatched after pointerup in the same task.
    setTimeout(fn, 0);
  };
  var onEnd = function () {
    run();
  };
  document.addEventListener('pointerup', onEnd, true);
  document.addEventListener('pointercancel', onEnd, true);
  // A press that never reports its end (released outside the window).
  var guard = setTimeout(run, 2000);
}

/* Scrolling over a focused number box changes its value in Chrome, one step
   per scroll tick: a teacher who typed 6 and then moved a trackpad or Magic
   Mouse saw it run to 1 or 9, and that number was saved when she left the
   box. Leave the box instead, keeping the typed value, and let the page
   scroll. */
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener(
    'wheel',
    function (e) {
      var el = e.target;
      if (el && el.tagName === 'INPUT' && el.type === 'number' && el === document.activeElement) el.blur();
    },
    { passive: true, capture: true },
  );
}

/** Shared cache invalidation + re-render for both Realtime and visibility refresh */
function _invalidateAndRerender() {
  if (typeof clearProfCache === 'function') clearProfCache();
  _allTagsCache = {};
  _tagToSectionCache = {};
  // Wait until the teacher leaves the field, and check again a tick later:
  // Enter or Tab moves focus straight into the next field.
  if (_isEditingField()) {
    if (!_rerenderDeferred) {
      _rerenderDeferred = true;
      document.addEventListener(
        'focusout',
        function () {
          setTimeout(function () {
            _rerenderDeferred = false;
            _invalidateAndRerender();
          }, 0);
        },
        { once: true },
      );
    }
    return;
  }
  if (_pointerPressed) {
    if (!_pressDeferred) {
      _pressDeferred = true;
      _afterPress(function () {
        _pressDeferred = false;
        _invalidateAndRerender();
      });
    }
    return;
  }
  // Re-render current page (desktop)
  var currentPage = typeof Router !== 'undefined' && Router.getCurrentPage ? Router.getCurrentPage() : null;
  if (currentPage && currentPage.render) {
    try {
      currentPage.render();
    } catch (e) {
      /* page may not be ready */
    }
  }
  // Re-render current tab (mobile)
  if (window.__MOBILE && typeof _mobileRerender === 'function') {
    try {
      _mobileRerender();
    } catch (e) {
      /* mobile may not be ready */
    }
  }
}

/* ══════════════════════════════════════════════════════════════════
   Visibility-change refresh — re-fetch from Supabase when user returns
   to this tab/app (phone → desktop, tab switch, wake from sleep).
   This is the most reliable cross-device sync mechanism.
   ══════════════════════════════════════════════════════════════════ */
var _lastVisibilityRefresh = 0;
var _VISIBILITY_DEBOUNCE = 30000;

/* Coming back to the tab, or back online, checks the open class: realtime
   events can be missed while a laptop sleeps. At most once per 30 seconds;
   an unchanged class costs one small request. */
var _visibilityBound = false;
function _initVisibilityRefresh() {
  if (_visibilityBound || typeof document === 'undefined' || !document.addEventListener) return;
  _visibilityBound = true;
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible') return;
    if (Date.now() - _lastVisibilityRefresh < _VISIBILITY_DEBOUNCE) return;
    _revalidateActiveClass();
  });
  if (typeof window.addEventListener === 'function') {
    window.addEventListener('online', _revalidateActiveClass);
  }
}

function _revalidateActiveClass() {
  if (!_useSupabase || !_classBundleEnabled()) return;
  var cid = getActiveCourse();
  if (!cid || !_isUuid(cid)) return;
  _lastVisibilityRefresh = Date.now();
  _handleExternalCourseUpdate(cid, 'gradebook');
}

/** Load all data for a specific course into the cache. */
/* ── Every class, loaded ──────────────────────────────────────
   Boot loads the class the teacher opens with; preloadClasses then loads the
   rest in the background, one at a time, so a class's roster, settings and
   competencies are on the page before the teacher opens it (the class
   picker, Class Settings, copying between classes). loadClass shares one
   load per class, so a class picked while it is preloading waits for that
   same load. In Demo Mode and local-only use every class is already on this
   device. */
var _classLoads = {}; // cid → promise while loading, true once loaded

function isClassLoaded(cid) {
  if (!cid || !_useSupabase) return true;
  return _classLoads[cid] === true;
}

function loadClass(cid) {
  if (isClassLoaded(cid)) return Promise.resolve();
  if (_classLoads[cid]) return _classLoads[cid];
  var p = Promise.resolve()
    .then(function () {
      return initData(cid);
    })
    .catch(function (e) {
      // initData keeps this device's saved copy when a load fails.
      console.warn('Could not load class:', cid, e);
    })
    .then(function () {
      _classLoads[cid] = true;
    });
  _classLoads[cid] = p;
  return p;
}

/* The classes still to load, in the order they are loaded. The open class
   is the page's own load. */
function classesToPreload() {
  var open = getActiveCourse();
  return Object.keys(COURSES || {}).filter(function (cid) {
    return cid !== open && !isCourseArchived(cid) && !isClassLoaded(cid);
  });
}

var _preloadRun = null;
function preloadClasses() {
  if (_preloadRun) return _preloadRun;
  _preloadRun = classesToPreload()
    .reduce(function (chain, cid) {
      return chain.then(function () {
        return loadClass(cid);
      });
    }, Promise.resolve())
    .then(function () {
      _preloadRun = null;
    });
  return _preloadRun;
}

async function initData(cid) {
  if (!cid) return;
  try {
    return await _initClassData(cid);
  } finally {
    _classLoads[cid] = true;
  }
}

async function _initClassData(cid) {
  // Avoid duplicate concurrent loads for same course
  if (_initPromise && _initPromise._cid === cid) return _initPromise;

  // Saved copy first: show the copy this device has, then ask the server
  // whether it changed. Not while a refresh is running: that is the check.
  var refreshing = !!(_refreshState[cid] && _refreshState[cid].snapshot);
  if (!refreshing && _useSupabase && _cacheFirstEnabled() && _classBundleEnabled() && _isUuid(cid)) {
    var inMemory = _cache.students[cid] !== undefined && _classVersion[cid] != null;
    if (inMemory || _savedCopyUsable(cid)) {
      if (!inMemory) _loadSavedCopy(cid);
      // A class loaded in the background hasn't been opened.
      if (cid === getActiveCourse()) _saveClassMeta(cid, { lastOpenedAt: Date.now() });
      _startClassCheck(cid);
      if (cid === getActiveCourse()) _subscribeCourseSyncCursor(cid);
      return;
    }
  }

  // Writes still waiting to be sent aren't in the server's copy yet, so
  // applying it now would show the class without them. Keep the copy this
  // device has and refresh once the writes have landed.
  if (_hasUnsentWrites() && _hasLocalCopy(cid) && !(_refreshState[cid] && _refreshState[cid].snapshot)) {
    if (_cache.students[cid] === undefined) _loadCourseFromLS(cid);
    _handleExternalCourseUpdate(cid, 'gradebook');
    if (cid === getActiveCourse()) await _subscribeCourseSyncCursor(cid);
    return;
  }

  // Every load, not only realtime refreshes, must leave alone a field the
  // teacher edits while it is fetching (see _refreshMustSkip).
  var st = _refreshState[cid] || (_refreshState[cid] = {});
  var ownSnapshot = !st.snapshot;
  if (ownSnapshot) {
    st.snapshot = Object.assign({}, (_localWrites[cid] && _localWrites[cid].fields) || {});
    st.skipped = false;
  }

  const p = _doInitData(cid);
  p._cid = cid;
  _initPromise = p;
  try {
    await p;
    // A slower load for a class the teacher has already left must not take
    // the realtime channel from the class on screen.
    if (cid === getActiveCourse()) await _subscribeCourseSyncCursor(cid);
  } finally {
    if (_initPromise === p) _initPromise = null;
    if (ownSnapshot) {
      var skipped = st.skipped;
      st.snapshot = null;
      if (skipped) _handleExternalCourseUpdate(cid, 'gradebook');
    }
  }
}

/* Writes made this session that haven't finished, or entries left in the
   outbox by an earlier session. Writes the server rejected don't count:
   nothing would ever clear them, so every refresh would wait for good. The
   outbox tries each of them once more on the next page load and then drops
   it with a Sentry report; until then the sync dot shows the failure. */
function _hasUnsentWrites() {
  if (_pendingSyncs > 0) return true;
  var q = window.v2Queue;
  if (!q || typeof q.stats !== 'function') return false;
  try {
    return (q.stats().queued || 0) > 0;
  } catch (e) {
    return false;
  }
}

function _hasLocalCopy(cid) {
  if (_cache.students[cid] !== undefined) return true;
  try {
    return localStorage.getItem('gb-students-' + cid) !== null;
  } catch (e) {
    return false;
  }
}

function _dateOnly(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.slice(0, 10);
  try {
    return new Date(value).toISOString().slice(0, 10);
  } catch (e) {
    return '';
  }
}

/* The local calendar day of a server timestamp. created_at is UTC, so
 * slicing it gives tomorrow's date for anything written after 5 pm
 * Pacific; observations created on this device get getTodayStr() (local),
 * and hydrated rows must agree. A date-only string passes through as is. */
function _localDayOf(value) {
  if (!value) return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  var d = new Date(value);
  if (isNaN(d)) return '';
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/* Returns today's date in YYYY-MM-DD format, computed in the course's
 * timezone (not the browser's). This matters for reports: a Vancouver
 * teacher grading at 11 pm PST would see UTC midnight fall on the next
 * calendar day if we used `new Date().toISOString().slice(0, 10)`, so the
 * score would appear on reports under tomorrow's date.
 *
 * Courses store their timezone in course.timezone (column added with
 * T-UI-03 default 'America/Vancouver'). Callers pass the course id; we
 * look up the timezone, fall back to the course default, fall back again
 * to UTC. Intl.DateTimeFormat is used because it handles DST correctly. */
function courseToday(cid) {
  var tz = 'America/Vancouver';
  try {
    var c = (typeof COURSES !== 'undefined' && cid && COURSES[cid]) || null;
    if (c && typeof c.timezone === 'string' && c.timezone) tz = c.timezone;
  } catch (e) {
    // COURSES not yet initialized — use the default.
  }
  try {
    // 'en-CA' produces YYYY-MM-DD directly when using numeric/2-digit parts.
    var parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    var y = '',
      m = '',
      d = '';
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (p.type === 'year') y = p.value;
      else if (p.type === 'month') m = p.value;
      else if (p.type === 'day') d = p.value;
    }
    if (y && m && d) return y + '-' + m + '-' + d;
  } catch (e) {
    // Fall through to UTC fallback.
  }
  return new Date().toISOString().slice(0, 10);
}

function _plainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function _rpcRows(data) {
  if (data == null) return [];
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch (e) {
      return [];
    }
  }
  if (Array.isArray(data)) return data;
  if (_plainObject(data)) {
    if (Array.isArray(data.items)) return data.items;
    if (Array.isArray(data.rows)) return data.rows;
    if (Array.isArray(data.data)) return data.data;
  }
  return [];
}

function _rpcObject(data) {
  if (data == null) return null;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch (e) {
      return null;
    }
  }
  if (Array.isArray(data)) return data[0] || null;
  if (_plainObject(data) && _plainObject(data.data)) return data.data;
  return _plainObject(data) ? data : null;
}

/* Fill a course field from this device's saved copy, or a default, without
   writing localStorage or the server baseline. */
function _keepOrDefaultField(cid, field, fallback) {
  if (_cache[field][cid] !== undefined) return;
  var key = _DATA_KEYS[field];
  _cache[field][cid] = key ? _safeParseLS('gb-' + key + '-' + cid, fallback) : fallback;
  if (field === 'courseConfigs') _noteSettingsRead(cid);
}

/* The class's settings as this page read them from this device's storage:
   { of: the cached object, copy: a clone of it then }. saveCourseConfig
   sends what differs from the copy the page started from, and until the
   class has loaded from the server (no connection, or sync paused) that is
   this one. Not the storage as it is at the time of the save: another tab
   writes its own changes there, and this page's older values would look
   like changes. Good only while the cache still holds that same object. */
var _settingsRead = {}; // cid → { of, copy }
function _noteSettingsRead(cid) {
  var value = _cache.courseConfigs[cid];
  if (_plainObject(value)) _settingsRead[cid] = { of: value, copy: _cloneValue(value) };
  else delete _settingsRead[cid];
}

function _persistLoadedField(cid, field, value) {
  if (_refreshMustSkip(cid, field)) return;
  _cache[field][cid] = value;
  if (field === 'scores') _gradeScoresLoaded(cid); // Draft and Returned: the rows are from before this load
  if (field === 'rubrics') _noteRubricsSet(cid);
  var key = _DATA_KEYS[field];
  if (key) {
    // Unchanged data isn't rewritten, so a reload that changed nothing
    // doesn't look like an edit to other tabs or cost a quota write.
    var lsKey = 'gb-' + key + '-' + cid;
    var json = JSON.stringify(value);
    var same = false;
    try {
      same = localStorage.getItem(lsKey) === json;
    } catch (e) {
      same = false;
    }
    if (!same) _safeLSSet(lsKey, json);
  }
  if (_SERVER_STATE_FIELDS[field]) _rememberServerState(field, cid, value);
}

/* ── Server-state baseline (docs/write-path-plan.md, Phase 2) ──────────────
   What the server is believed to hold for a course field, in client shape.
   Saves diff the current cache against this, not against the localStorage
   copy taken when save() was called. That copy goes stale as soon as an
   earlier save re-keys a local id, and the next save then re-creates the row.

   Set when a field is loaded from the server, and advanced to the cache's
   value each time a save's diff is dispatched — the outbox keeps retrying
   until the server has it. If the server rejects the write instead, or the
   outbox has no room for it, the row goes back (see _baselineUndo below).
   Re-keys patch it alongside the cache. Before the first load (or while
   degraded, loading from localStorage) there is no baseline and saves fall
   back to the call-time localStorage copy. */
var _SERVER_STATE_FIELDS = {
  students: true,
  assessments: true,
  categories: true,
  modules: true,
  learningMaps: true,
  notes: true,
  customTags: true,
  observationTemplates: true,
  scores: true,
  statuses: true,
  rubrics: true,
  // The class's settings: saveCourseConfig sends only what differs from it.
  courseConfigs: true,
};
var _serverState = {}; // field → cid → value

function _cloneValue(value) {
  if (value === undefined) return undefined;
  try {
    return structuredClone(value);
  } catch (e) {
    return JSON.parse(JSON.stringify(value));
  }
}

function _rememberServerState(field, cid, value) {
  if (!cid) return;
  if (!_serverState[field]) _serverState[field] = {};
  _serverState[field][cid] = _cloneValue(value);
}

function _hasServerState(field, cid) {
  return !!(_serverState[field] && _serverState[field][cid] !== undefined);
}

function _serverStateOr(field, cid, fallback) {
  return _hasServerState(field, cid) ? _serverState[field][cid] : fallback;
}

/* Drop every baseline for a course whose local data is being wiped, so the
   next save starts from the fallback (empty) copy. */
function _forgetServerState(cid) {
  Object.keys(_serverState).forEach(function (field) {
    delete _serverState[field][cid];
  });
}

/* ── Rejected writes and the baseline (write-path audit §3, §5) ───────────
   A save advances the baseline as it dispatches its diff, so a write the
   server rejects (dead letter) or the outbox refuses (full) would never be
   diffed again. Each write therefore remembers the baseline row it was
   diffed against, and a rejection puts that row back: the next save of the
   field sends it again. Rows of students, assessments, scores and statuses;
   categories go up as one list and handle it in their own save. Other
   fields rely on the outbox's one retry on the next page load. In memory
   only: after a reload the baseline comes from the server again. */
var _baselineUndo = {}; // outbox entry id → { field, cid, match?, prev }

/* A score write this page sent that the server rejected stays in the dead
   letter, and the next page load sends it once more. If the teacher then
   puts the cell back to what the server holds (a clear rejected, the same 17
   typed again), the save sends nothing for it, and that retry would undo the
   retyped score. A save that leaves such a cell as the server has it
   dismisses the rejected write. */
var _rejectedScoreWrites = {}; // dead-letter entry id → { cid, row: its payload }

/* Every field a score write sets: the diff's fields and the Note for the
   Report, which save_score_report_note sends on its own. */
function _sameOnServer(a, b) {
  return !_scoreEntryRemoteChanged(a, b) && (a.reportNote || '') === (b.reportNote || '');
}

function _dismissOverriddenScoreWrites(cid, baseline, next) {
  var q = window.v2Queue;
  if (!q || typeof q.dismissDeadLetter !== 'function') return;
  Object.keys(_rejectedScoreWrites).forEach(function (id) {
    var w = _rejectedScoreWrites[id];
    if (w.cid !== cid) return;
    var sid = w.row.p_enrollment_id;
    var aid = w.row.p_assessment_id;
    var cell = function (blob) {
      var out = {};
      ((blob && blob[sid]) || []).forEach(function (e) {
        if (e && e.assessmentId === aid) out[_scoreEntryKey(sid, e)] = e;
      });
      return out;
    };
    var was = cell(baseline);
    var now = cell(next);
    var keys = Object.keys(was);
    var same =
      keys.length === Object.keys(now).length &&
      keys.every(function (k) {
        return now[k] && _sameOnServer(was[k], now[k]);
      });
    if (!same) return;
    delete _rejectedScoreWrites[id];
    q.dismissDeadLetter(id);
  });
}

/* A Missing, Excused or Late mark this page sent that the server rejected
   stays in the dead letter, and the next page load sends it once more. If
   the teacher then puts the cell back to what the server holds (Missing
   rejected, then taken off again), the save sends nothing for it, and that
   retry would put the mark back. A save that leaves such a cell as the
   server has it dismisses the rejected write. */
var _rejectedStatusWrites = {}; // dead-letter entry id → { cid, row: its payload }

function _dismissOverriddenStatusWrites(cid, baseline, next) {
  var q = window.v2Queue;
  if (!q || typeof q.dismissDeadLetter !== 'function') return;
  Object.keys(_rejectedStatusWrites).forEach(function (id) {
    var w = _rejectedStatusWrites[id];
    if (w.cid !== cid) return;
    var key = w.row.p_enrollment_id + ':' + w.row.p_assessment_id;
    if (((baseline || {})[key] || null) !== ((next || {})[key] || null)) return;
    delete _rejectedStatusWrites[id];
    q.dismissDeadLetter(id);
  });
}

/* Which baseline row a write sets, from its RPC name and params. */
function _baselineRowOf(name, params) {
  params = params || {};
  switch (name) {
    case 'update_assessment':
    case 'save_assessment_tags':
    case 'save_collab':
    case 'delete_assessment':
      return { field: 'assessments', match: 'id', id: params.p_id };
    case 'update_enrollment':
      return { field: 'students', match: 'id', id: params.p_id };
    case 'withdraw_student':
      return { field: 'students', match: 'id', id: params.p_enrollment_id };
    case 'update_student':
      return { field: 'students', match: 'personId', id: params.p_id };
    case 'upsert_score':
    case 'upsert_tag_score':
    case 'upsert_rubric_score':
    case 'save_score_comment':
    case 'save_score_report_note':
    case 'clear_score':
      return { field: 'scores', sid: params.p_enrollment_id, aid: params.p_assessment_id };
    case 'set_score_status':
      return { field: 'statuses', sid: params.p_enrollment_id, aid: params.p_assessment_id };
  }
  return null;
}

/* The course whose baseline holds that row. Score and status writes carry
   no course id, so the course is the one whose assessments include it. */
function _baselineCidOf(row) {
  var byCid = _serverState[row.field] || {};
  var cids = Object.keys(byCid);
  for (var i = 0; i < cids.length; i++) {
    var value = byCid[cids[i]];
    if (row.match) {
      if (Array.isArray(value) && value.some(r => r && r[row.match] === row.id)) return cids[i];
    } else if (_assessmentById(cids[i], row.aid) || (value && value[row.sid])) {
      return cids[i];
    }
  }
  return null;
}

/* What the baseline holds for the row now, before the save advances it. */
function _snapshotBaselineRow(name, params) {
  var row = _baselineRowOf(name, params);
  if (!row || (row.match ? !row.id : !row.sid || !row.aid)) return null;
  var cid = _baselineCidOf(row);
  if (!cid) return null;
  var value = _serverState[row.field][cid];
  var prev;
  if (row.match) {
    prev = _cloneValue(value.find(r => r && r[row.match] === row.id));
  } else if (row.field === 'scores') {
    prev = _cloneValue((value[row.sid] || []).filter(e => e && e.assessmentId === row.aid));
  } else {
    prev = value[row.sid + ':' + row.aid];
  }
  return { field: row.field, cid: cid, match: row.match, prev: prev };
}

/* Put a rejected write's row back as it was before the write was diffed.
   The ids come from the entry as it is now, so a re-key since the snapshot
   is kept. */
function _revertBaselineRow(undo, name, params) {
  if (!undo || !_hasServerState(undo.field, undo.cid)) return;
  var row = _baselineRowOf(name, params);
  if (!row) return;
  var value = _serverState[undo.field][undo.cid];
  if (undo.match) {
    if (!Array.isArray(value) || !row.id) return;
    var at = value.findIndex(r => r && r[undo.match] === row.id);
    if (undo.prev === undefined) return;
    var prev = _cloneValue(undo.prev);
    prev[undo.match] = row.id;
    if (at >= 0) value[at] = prev;
    else value.push(prev);
    return;
  }
  if (undo.field === 'scores') {
    var entries = (value[row.sid] || []).filter(e => e && e.assessmentId !== row.aid);
    (undo.prev || []).forEach(function (e) {
      entries.push(Object.assign(_cloneValue(e), { assessmentId: row.aid }));
    });
    if (entries.length) value[row.sid] = entries;
    else delete value[row.sid];
    return;
  }
  var key = row.sid + ':' + row.aid;
  if (undo.prev === undefined) delete value[key];
  else value[key] = undo.prev;
}

/* Pushes the outbox refused, counted so a save can tell its own write was
   refused (it happens synchronously, inside the save). */
var _writeRefusals = 0;

function _onWriteRefused(name, params, undo, reason, entryId) {
  _writeRefusals++;
  console.warn(name + ' not queued (' + reason + '): the outbox has no room');
  // A refused create is forgotten, and its row leaves the baseline, so the
  // next save of the field creates it again.
  var creates = _pendingCreatesByEntry(entryId);
  if (creates.length) _onCreateAbandoned(entryId, false);
  // After the save that dispatched it has advanced the baseline.
  Promise.resolve().then(function () {
    _revertBaselineRow(undo, name, params);
    creates.forEach(function (rec) {
      var field = rec.kind === 'student' ? 'students' : rec.kind === 'assessment' ? 'assessments' : null;
      if (!field || !_hasServerState(field, rec.cid)) return;
      _serverState[field][rec.cid] = _serverState[field][rec.cid].filter(r => !r || r.id !== rec.localId);
    });
  });
  if (!_outboxRefused) {
    _outboxRefused = true;
    _saveProblemChanged();
  }
}

/* Local → server id swaps made this session, per course. Scores and statuses
   entered before a new assessment or student got its server id still carry
   the local id, and a write with a local id is never sent. Every score and
   status save moves them onto the server id first, so they are sent then;
   that also catches a click on a page rendered before the swap. */
var _idRekeys = {}; // cid → { localId: serverId }

function _applyIdRekeysToScores(cid, scores) {
  var map = _idRekeys[cid];
  if (!map || !scores) return false;
  var changed = false;
  Object.keys(scores).forEach(function (sid) {
    var entries = scores[sid];
    if (!Array.isArray(entries)) return;
    entries.forEach(function (e) {
      if (e && map[e.assessmentId]) {
        e.assessmentId = map[e.assessmentId];
        changed = true;
      }
    });
    if (map[sid]) {
      scores[map[sid]] = (scores[map[sid]] || []).concat(entries);
      delete scores[sid];
      changed = true;
    }
  });
  return changed;
}

function _applyIdRekeysToStatuses(cid, statuses) {
  var map = _idRekeys[cid];
  if (!map || !statuses) return false;
  var changed = false;
  Object.keys(statuses).forEach(function (key) {
    var i = key.indexOf(':');
    if (i < 0) return;
    var sid = key.slice(0, i);
    var aid = key.slice(i + 1);
    var next = (map[sid] || sid) + ':' + (map[aid] || aid);
    if (next === key) return;
    if (statuses[next] === undefined) statuses[next] = statuses[key];
    delete statuses[key];
    changed = true;
  });
  return changed;
}

/* ── Pending creates and re-keys (docs/write-path-audit-2026-10.md §1, 6, 7, 11)

   A row the teacher adds gets a local id until its create_* / upsert_* lands
   and the server names it. Until then every write that mentions the row
   (a score on a new assessment, a note on a new student, a tag under a new
   section) is queued in the outbox with the local id in its payload and
   blocked_on that id, so it waits behind the create and survives a reload.

   fv-idmap-v1 remembers which outbox entry creates which local id:
     { [cid]: { "<kind>:<localId>": { entryId, endpoint, kind, localId, cid,
                                      queued, at, index?, parent?, row? } } }
   Keys carry the kind because the flat learning map gives a section and its
   tag the same local id. It is read through on every access, so two tabs and
   a reloaded page see the same map.

   When the entry succeeds (the outbox's flush:success, which fires after a
   reload too), _onCreateLanded reads the server id from the result and
   _rekey rewrites the cache, the gb-* copy, the server baseline and the
   queued payloads, then the held writes go out. The creates' own .then
   callbacks call the same function, for the direct-send path without the
   outbox; the second caller finds nothing left to do. */
var _IDMAP_KEY = 'fv-idmap-v1';
var _idmapRaw = null;
var _idmapCache = null;

function _idmap() {
  var raw = null;
  try {
    raw = localStorage.getItem(_IDMAP_KEY);
  } catch (e) {
    raw = null;
  }
  if (raw !== _idmapRaw || !_idmapCache) {
    _idmapRaw = raw;
    try {
      _idmapCache = (raw && JSON.parse(raw)) || {};
    } catch (e) {
      _idmapCache = {};
    }
    if (!_idmapCache || typeof _idmapCache !== 'object' || Array.isArray(_idmapCache)) _idmapCache = {};
  }
  return _idmapCache;
}

function _writeIdmap(map) {
  var raw = JSON.stringify(map);
  _idmapCache = map;
  _idmapRaw = raw;
  if (raw === '{}') {
    try {
      localStorage.removeItem(_IDMAP_KEY);
    } catch (e) {
      /* ignore */
    }
    _idmapRaw = null;
    return;
  }
  _safeLSSet(_IDMAP_KEY, raw);
}

function _newEntryId() {
  var key = _idempotencyKey();
  if (key) return key;
  // RFC 4122 v4 from Math.random: the server wants a uuid, and an entry id
  // doubles as the idempotency key.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    var r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function _pendingKey(kind, localId) {
  return kind + ':' + localId;
}

/* Remember that `localId` (of `kind`, in course `cid`) is created by the
   outbox entry the record names. Returns the existing record when there
   already is one. extra: { index } for a row inside save_categories,
   { parent, index } for a criterion inside upsert_rubric, { row } for a
   course (so the class can be put back after a reload). */
function _registerPendingCreate(cid, kind, localId, endpoint, extra) {
  if (!cid || !kind || !localId || _isUuid(localId)) return null;
  var map = _idmap();
  var course = map[cid] || (map[cid] = {});
  var key = _pendingKey(kind, localId);
  if (course[key]) return course[key];
  var rec = {
    entryId: (extra && extra.entryId) || _newEntryId(),
    cid: cid,
    kind: kind,
    localId: localId,
    endpoint: endpoint || null,
    queued: false,
    at: Date.now(),
  };
  if (extra) {
    Object.keys(extra).forEach(function (k) {
      if (k !== 'entryId' && extra[k] !== undefined) rec[k] = extra[k];
    });
  }
  course[key] = rec;
  _writeIdmap(map);
  return rec;
}

function _unregisterPendingCreate(rec) {
  if (!rec) return;
  var map = _idmap();
  var course = map[rec.cid];
  if (!course || !course[_pendingKey(rec.kind, rec.localId)]) return;
  delete course[_pendingKey(rec.kind, rec.localId)];
  if (Object.keys(course).length === 0) delete map[rec.cid];
  _writeIdmap(map);
}

function _markPendingQueued(entryId) {
  if (!entryId) return;
  var map = _idmap();
  var changed = false;
  Object.keys(map).forEach(function (cid) {
    Object.keys(map[cid]).forEach(function (key) {
      var rec = map[cid][key];
      if (rec.entryId === entryId && !rec.queued) {
        rec.queued = true;
        changed = true;
      }
    });
  });
  if (changed) _writeIdmap(map);
}

function _pendingCreateFor(kind, localId) {
  if (!localId || _isUuid(localId)) return null;
  var map = _idmap();
  var key = _pendingKey(kind, localId);
  var cids = Object.keys(map);
  for (var i = 0; i < cids.length; i++) {
    if (map[cids[i]][key]) return map[cids[i]][key];
  }
  return null;
}

function _pendingCreatesByEntry(entryId) {
  var out = [];
  if (!entryId) return out;
  var map = _idmap();
  Object.keys(map).forEach(function (cid) {
    Object.keys(map[cid]).forEach(function (key) {
      if (map[cid][key].entryId === entryId) out.push(map[cid][key]);
    });
  });
  return out;
}

/* Pending local ids of every kind but course: a write under a local course
   id is replayed by _migrateCourseDataLocalToCanonical, not re-keyed. */
function _isPendingLocalId(id) {
  if (!id || typeof id !== 'string' || _isUuid(id)) return false;
  var map = _idmap();
  var cids = Object.keys(map);
  for (var i = 0; i < cids.length; i++) {
    var course = map[cids[i]];
    var keys = Object.keys(course);
    for (var j = 0; j < keys.length; j++) {
      if (course[keys[j]].localId === id && course[keys[j]].kind !== 'course') return true;
    }
  }
  return false;
}

/* An id a write may carry: the server's, or a local one whose create is
   queued (the write waits behind it and is re-keyed when it lands). */
function _isSendableId(id) {
  return _isUuid(id) || _isPendingLocalId(id);
}

/* Which record kind each id-bearing RPC parameter names. p_id depends on
   the endpoint (_P_ID_KINDS). p_course_id is left out on purpose. */
var _ID_PARAM_KINDS = {
  p_enrollment_id: 'student',
  p_enrollment_ids: 'student',
  p_assessment_id: 'assessment',
  p_tag_id: 'tag',
  p_tag_ids: 'tag',
  p_section_id: 'section',
  p_subject_id: 'subject',
  p_competency_group_id: 'group',
  p_rubric_id: 'rubric',
  p_criterion_id: 'criterion',
  p_check_id: 'check',
  p_module_id: 'module',
  p_category_id: 'category',
};
var _P_ID_KINDS = {
  update_assessment: 'assessment',
  delete_assessment: 'assessment',
  save_collab: 'assessment',
  save_assessment_tags: 'assessment',
  update_enrollment: 'student',
  upsert_subject: 'subject',
  delete_subject: 'subject',
  upsert_competency_group: 'group',
  delete_competency_group: 'group',
  upsert_section: 'section',
  delete_section: 'section',
  upsert_tag: 'tag',
  delete_tag: 'tag',
  upsert_rubric: 'rubric',
  delete_rubric: 'rubric',
  upsert_module: 'module',
  delete_module: 'module',
  upsert_category: 'category',
  delete_category: 'category',
  update_observation: 'observation',
  delete_observation: 'observation',
  upsert_observation_template: 'observationTemplate',
  delete_observation_template: 'observationTemplate',
};
var _LEARNING_MAP_KINDS = { subject: true, group: true, section: true, tag: true };

function _paramKind(endpoint, name) {
  return name === 'p_id' ? _P_ID_KINDS[endpoint] || null : _ID_PARAM_KINDS[name] || null;
}

/* Walk a payload's id parameters: visit(kind, value) returns the value to
   keep. Returns the (possibly new) payload and whether anything changed. */
function _mapIdParams(endpoint, params, visit) {
  var changed = false;
  var next = {};
  Object.keys(params || {}).forEach(function (name) {
    var value = params[name];
    var kind = _paramKind(endpoint, name);
    if (kind) {
      if (Array.isArray(value)) {
        var arr = value.map(function (v) {
          var out = typeof v === 'string' ? visit(kind, v) : v;
          if (out !== v) changed = true;
          return out;
        });
        value = arr;
      } else if (typeof value === 'string') {
        var out = visit(kind, value);
        if (out !== value) changed = true;
        value = out;
      }
    }
    next[name] = value;
  });
  return { payload: next, changed: changed };
}

/* Local ids in this payload whose create is still pending. */
function _blockedLocalIds(endpoint, params) {
  var ids = [];
  _mapIdParams(endpoint, params, function (kind, value) {
    if (!_isUuid(value) && _pendingCreateFor(kind, value) && ids.indexOf(value) < 0) ids.push(value);
    return value;
  });
  return ids;
}

/* A swap this page already knows for an id of this kind, or the id. Pages
   rendered before the swap still send the old id. */
function _resolveKnownId(kind, id) {
  if (!id || _isUuid(id)) return id;
  var cids, i;
  if (_LEARNING_MAP_KINDS[kind]) {
    cids = Object.keys(_learningMapIdRemap);
    for (i = 0; i < cids.length; i++) {
      var known = _learningMapIdRemap[cids[i]];
      if (known && known[kind] && known[kind][id]) return known[kind][id];
    }
    return id;
  }
  cids = Object.keys(_idRekeys);
  for (i = 0; i < cids.length; i++) {
    if (_idRekeys[cids[i]] && _idRekeys[cids[i]][id]) return _idRekeys[cids[i]][id];
  }
  return id;
}

function _applyKnownRekeys(endpoint, params) {
  var mapped = _mapIdParams(endpoint, params, _resolveKnownId);
  if (mapped.changed) {
    Object.keys(mapped.payload).forEach(function (name) {
      params[name] = mapped.payload[name];
    });
  }
  return params;
}

/* Put the server id into every queued payload still naming the local id, and
   release the entries that were waiting only on it. */
function _rewriteQueuedIds(kind, localId, serverId) {
  var q = window.v2Queue;
  if (!q || typeof q.rewrite !== 'function') return;
  q.rewrite(function (entry) {
    var mapped = _mapIdParams(entry.endpoint, entry.payload, function (k, value) {
      return k === kind && value === localId ? serverId : value;
    });
    var waiting = Array.isArray(entry.blocked_on) && entry.blocked_on.indexOf(localId) >= 0;
    if (!mapped.changed && !waiting) return null;
    return { payload: mapped.payload, blockedOn: _blockedLocalIds(entry.endpoint, mapped.payload) };
  });
}

/* ── Rewriting the local copies ─────────────────────────────────────────── */

function _readFieldForRekey(field, cid) {
  if (_cache[field] && _cache[field][cid] !== undefined) return _cache[field][cid];
  var dataKey = _DATA_KEYS[field];
  if (!dataKey) return undefined;
  var raw = _safeParseLS('gb-' + dataKey + '-' + cid, undefined);
  return raw === null ? undefined : raw;
}

/* Apply transform(value) → changed to a field's cache + gb-* copy and to its
   server baseline. Nothing is diffed or sent: writes that mention the row
   are already in the outbox and are re-keyed there. */
function _rekeyField(field, cid, transform) {
  var value = _readFieldForRekey(field, cid);
  if (value !== undefined && transform(value)) {
    _cache[field][cid] = value;
    if (field === 'rubrics') _noteRubricsSet(cid);
    var dataKey = _DATA_KEYS[field];
    // A re-key from another tab: it wrote the shared copy already.
    if (dataKey && !_applyingRemoteRekey) _safeLSSet('gb-' + dataKey + '-' + cid, JSON.stringify(value));
    if (!_applyingRemoteRekey) {
      _markLocalWrite(field, cid);
      _broadcastChange(cid, field);
    }
  }
  if (_hasServerState(field, cid)) transform(_serverState[field][cid]);
  if (field === 'statuses' || _WITHDRAWN_RECORD_FIELDS[field]) _rekeyWithdrawnRecords(field, cid, transform);
}

/* A withdrawn student's records (getWithdrawnStudents) hold the same values
   as the class's maps, for one student. Each is re-keyed by the transform
   the map got, as a one-student map; statuses are keyed 'sid:aid' already. */
function _rekeyWithdrawnRecords(field, cid, transform) {
  _rekeyField('withdrawn', cid, function (list) {
    var changed = false;
    (Array.isArray(list) ? list : []).forEach(function (w) {
      var records = w && w.records;
      if (!records || records[field] === undefined) return;
      if (field === 'statuses') {
        if (transform(records.statuses)) changed = true;
        return;
      }
      var one = {};
      one[w.student && w.student.id] = records[field];
      if (!transform(one)) return;
      records[field] = one[Object.keys(one)[0]];
      changed = true;
    });
    return changed;
  });
}

function _rekeyRowId(rows, localId, serverId, patch) {
  var changed = false;
  (Array.isArray(rows) ? rows : []).forEach(function (row) {
    if (row && row.id === localId) {
      row.id = serverId;
      if (patch) Object.assign(row, patch);
      changed = true;
    }
  });
  return changed;
}

/* Move obj[localId] to obj[serverId]. Two lists are joined; otherwise the
   server-keyed value wins. */
function _rekeyObjectKey(obj, localId, serverId) {
  if (!obj || typeof obj !== 'object' || obj[localId] === undefined) return false;
  var moving = obj[localId];
  delete obj[localId];
  if (obj[serverId] === undefined) obj[serverId] = moving;
  else if (Array.isArray(obj[serverId]) && Array.isArray(moving)) obj[serverId] = obj[serverId].concat(moving);
  return true;
}

function _rekeyStatusKeys(statuses, localId, serverId) {
  if (!statuses) return false;
  var changed = false;
  Object.keys(statuses).forEach(function (key) {
    var i = key.indexOf(':');
    if (i < 0) return;
    var sid = key.slice(0, i);
    var aid = key.slice(i + 1);
    var next = (sid === localId ? serverId : sid) + ':' + (aid === localId ? serverId : aid);
    if (next === key) return;
    if (statuses[next] === undefined) statuses[next] = statuses[key];
    delete statuses[key];
    changed = true;
  });
  return changed;
}

function _rekeyScoreEntries(scores, prop, localId, serverId) {
  var changed = false;
  Object.keys(scores || {}).forEach(function (sid) {
    (Array.isArray(scores[sid]) ? scores[sid] : []).forEach(function (e) {
      if (e && e[prop] === localId) {
        e[prop] = serverId;
        changed = true;
      }
    });
  });
  return changed;
}

/* goals / reflections / overrides are { sid: { sectionId: … } }. */
function _rekeyInnerKeys(obj, localId, serverId) {
  var changed = false;
  Object.keys(obj || {}).forEach(function (sid) {
    if (_rekeyObjectKey(obj[sid], localId, serverId)) changed = true;
  });
  return changed;
}

function _rekeyStudentRefs(cid, localId, serverId) {
  ['scores', 'observations', 'notes', 'flags', 'termRatings', 'goals', 'reflections', 'overrides'].forEach(
    function (field) {
      _rekeyField(field, cid, function (obj) {
        return _rekeyObjectKey(obj, localId, serverId);
      });
    },
  );
  _rekeyField('studentProfileSummaries', cid, function (obj) {
    if (!_rekeyObjectKey(obj, localId, serverId)) return false;
    var row = obj[serverId];
    if (row && typeof row === 'object') {
      row.id = serverId;
      if (row.student) row.student.id = serverId;
      if (row.enrollment) row.enrollment.id = serverId;
    }
    return true;
  });
  _rekeyField('statuses', cid, function (statuses) {
    return _rekeyStatusKeys(statuses, localId, serverId);
  });
  // Ticked checkboxes, printed rubrics and DIBELS scores are keyed 'sid:aid'
  // like statuses.
  _rekeyField('rubricChecks', cid, function (checks) {
    return _rekeyStatusKeys(checks, localId, serverId);
  });
  _rekeyField('rubricPrints', cid, function (prints) {
    return _rekeyStatusKeys(prints, localId, serverId);
  });
  _rekeyField('dibels', cid, function (dibels) {
    return _rekeyStatusKeys(dibels, localId, serverId);
  });
}

function _rekeyAssessmentRefs(cid, localId, serverId) {
  _rekeyField('scores', cid, function (scores) {
    return _rekeyScoreEntries(scores, 'assessmentId', localId, serverId);
  });
  _rekeyField('statuses', cid, function (statuses) {
    return _rekeyStatusKeys(statuses, localId, serverId);
  });
  _rekeyField('rubricChecks', cid, function (checks) {
    return _rekeyStatusKeys(checks, localId, serverId);
  });
  _rekeyField('rubricPrints', cid, function (prints) {
    return _rekeyStatusKeys(prints, localId, serverId);
  });
  _rekeyField('dibels', cid, function (dibels) {
    return _rekeyStatusKeys(dibels, localId, serverId);
  });
  _rekeyField('observations', cid, function (obs) {
    var changed = false;
    Object.keys(obs || {}).forEach(function (sid) {
      (Array.isArray(obs[sid]) ? obs[sid] : []).forEach(function (o) {
        if (o && o.assignmentContext && o.assignmentContext.assessmentId === localId) {
          o.assignmentContext.assessmentId = serverId;
          changed = true;
        }
      });
    });
    return changed;
  });
}

/* Fields on assessments that point at other rows. The cache is patched and
   saveAssessments runs, so rows the server already has get an
   update_assessment with the new reference; the baseline keeps the old one
   until that diff is dispatched. */
function _rekeyAssessmentReference(cid, kind, localId, serverId) {
  var assessments = structuredClone(getAssessments(cid) || []);
  var changed = false;
  assessments.forEach(function (a) {
    if (!a) return;
    if (kind === 'tag' && Array.isArray(a.tagIds) && a.tagIds.indexOf(localId) >= 0) {
      a.tagIds = a.tagIds.map(function (id) {
        return id === localId ? serverId : id;
      });
      a.tag_ids = a.tagIds;
      changed = true;
    }
    if (kind === 'rubric' && a.rubricId === localId) {
      a.rubricId = serverId;
      changed = true;
    }
    if (kind === 'module' && a.moduleId === localId) {
      a.moduleId = serverId;
      changed = true;
    }
    if (kind === 'category' && (a.categoryId === localId || a.category_id === localId)) {
      a.categoryId = serverId;
      a.category_id = serverId;
      changed = true;
    }
  });
  if (changed) saveAssessments(cid, assessments);
}

/* The one re-key. Rewrites every local copy that names the row, the queued
   writes that were waiting on it, and tells pages holding the old id. */
function _rekey(cid, kind, localId, serverId, extra) {
  if (!cid || !kind || !localId || !serverId || localId === serverId) return;
  extra = extra || {};
  if (_LEARNING_MAP_KINDS[kind]) {
    if (!_learningMapIdRemap[cid]) _learningMapIdRemap[cid] = { subject: {}, group: {}, section: {}, tag: {} };
    _learningMapIdRemap[cid][kind][localId] = serverId;
  } else {
    (_idRekeys[cid] = _idRekeys[cid] || {})[localId] = serverId;
  }

  if (kind === 'student') {
    var patch = { rosterPosition: extra.rosterPosition };
    if (_isUuid(extra.personId)) patch.personId = extra.personId;
    if (patch.rosterPosition === undefined) delete patch.rosterPosition;
    _rekeyField('students', cid, function (rows) {
      return _rekeyRowId(rows, localId, serverId, patch);
    });
    _rekeyField('withdrawn', cid, function (list) {
      return _rekeyRowId(
        (Array.isArray(list) ? list : []).map(function (w) {
          return w && w.student;
        }),
        localId,
        serverId,
        _isUuid(patch.personId) ? { personId: patch.personId } : null,
      );
    });
    _rekeyStudentRefs(cid, localId, serverId);
  } else if (kind === 'assessment') {
    _rekeyField('assessments', cid, function (rows) {
      return _rekeyRowId(rows, localId, serverId);
    });
    _rekeyAssessmentRefs(cid, localId, serverId);
  } else if (_LEARNING_MAP_KINDS[kind]) {
    _rekeyField('learningMaps', cid, function (map) {
      return _patchLearningMapEntityId(map, kind, localId, serverId);
    });
    delete _allTagsCache[cid];
    delete _tagToSectionCache[cid];
    if (kind === 'section') {
      ['goals', 'reflections', 'overrides'].forEach(function (field) {
        _rekeyField(field, cid, function (obj) {
          return _rekeyInnerKeys(obj, localId, serverId);
        });
      });
    }
    if (kind === 'tag') {
      _rekeyField('scores', cid, function (scores) {
        return _rekeyScoreEntries(scores, 'tagId', localId, serverId);
      });
      var rubricLinksMoved = false;
      _rekeyField('rubrics', cid, function (rubrics) {
        var changed = false;
        (rubrics || []).forEach(function (r) {
          // The whole rubric's competencies, then each criterion's.
          if (r && Array.isArray(r.tagIds) && r.tagIds.indexOf(localId) >= 0) {
            r.tagIds = r.tagIds.map(function (id) {
              return id === localId ? serverId : id;
            });
            changed = true;
          }
          ((r && r.criteria) || []).forEach(function (c) {
            if (c && Array.isArray(c.tagIds) && c.tagIds.indexOf(localId) >= 0) {
              c.tagIds = c.tagIds.map(function (id) {
                return id === localId ? serverId : id;
              });
              changed = true;
            }
          });
        });
        if (changed) rubricLinksMoved = true;
        return changed;
      });
      // upsert_rubric drops a competency link whose id is still local, so a
      // rubric saved before its competencies landed (a duplicated class, or
      // a rubric built right after adding competencies) reached the server
      // without them. Send the rubric again now the link has an id.
      if (rubricLinksMoved && !(extra && extra.remote)) _resendRubricLinks(cid);
      _rekeyAssessmentReference(cid, 'tag', localId, serverId);
      _rekeyField('observations', cid, function (obs) {
        var changed = false;
        Object.keys(obs || {}).forEach(function (sid) {
          (Array.isArray(obs[sid]) ? obs[sid] : []).forEach(function (o) {
            if (o && o.competencyId === localId) {
              o.competencyId = serverId;
              changed = true;
            }
          });
        });
        return changed;
      });
    }
  } else if (kind === 'rubric') {
    _rekeyField('rubrics', cid, function (rows) {
      return _rekeyRowId(rows, localId, serverId);
    });
    _rekeyAssessmentReference(cid, 'rubric', localId, serverId);
  } else if (kind === 'criterion') {
    _rekeyField('rubrics', cid, function (rubrics) {
      var changed = false;
      (rubrics || []).forEach(function (r) {
        if (_rekeyRowId(r && r.criteria, localId, serverId)) changed = true;
      });
      return changed;
    });
    _rekeyField('scores', cid, function (scores) {
      return _rekeyScoreEntries(scores, 'tagId', localId, serverId);
    });
  } else if (kind === 'check') {
    // An Advanced Rubric checkbox: in its criterion's list and in the ticks.
    _rekeyField('rubrics', cid, function (rubrics) {
      var changed = false;
      (rubrics || []).forEach(function (r) {
        (r && r.criteria ? r.criteria : []).forEach(function (c) {
          if (_rekeyRowId(c && c.checks, localId, serverId)) changed = true;
        });
      });
      return changed;
    });
    _rekeyField('rubricChecks', cid, function (checks) {
      var changed = false;
      Object.keys(checks || {}).forEach(function (key) {
        var list = checks[key];
        if (!Array.isArray(list)) return;
        var i = list.indexOf(localId);
        if (i < 0) return;
        if (list.indexOf(serverId) >= 0) list.splice(i, 1);
        else list[i] = serverId;
        changed = true;
      });
      return changed;
    });
  } else if (kind === 'module') {
    _rekeyField('modules', cid, function (rows) {
      return _rekeyRowId(rows, localId, serverId);
    });
    _rekeyAssessmentReference(cid, 'module', localId, serverId);
  } else if (kind === 'category') {
    _rekeyField('categories', cid, function (rows) {
      return _rekeyRowId(rows, localId, serverId);
    });
    _rekeyAssessmentReference(cid, 'category', localId, serverId);
  } else if (kind === 'observation') {
    _rekeyField('observations', cid, function (obs) {
      var changed = false;
      Object.keys(obs || {}).forEach(function (sid) {
        if (_rekeyRowId(obs[sid], localId, serverId)) changed = true;
      });
      return changed;
    });
  } else if (kind === 'observationTemplate') {
    _rekeyField('observationTemplates', cid, function (rows) {
      return _rekeyRowId(rows, localId, serverId);
    });
  }
  _rekeyGradeReturns(cid, localId, serverId);
  if (typeof clearProfCache === 'function') clearProfCache();

  _rewriteQueuedIds(kind, localId, serverId);
  if (!extra.remote) _broadcastRekey(cid, kind, localId, serverId, extra);

  // Pages hold the old id in their state and markup; swap it and render
  // again, but only when the old id is on screen, so typing isn't disturbed.
  if (typeof document === 'undefined') return;
  if (typeof document.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
    document.dispatchEvent(
      new CustomEvent('fv:id-rekeyed', { detail: { cid: cid, kind: kind, from: localId, to: serverId } }),
    );
  }
  var esc = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(localId) : localId;
  if (document.querySelector('[data-aid="' + esc + '"], [data-sid="' + esc + '"]')) _invalidateAndRerender();
}

/* ── Landing a create ───────────────────────────────────────────────────── */

function _serverIdFrom(rec, data) {
  if (data == null) return null;
  if (rec.endpoint === 'create_student_and_enroll') return (data && data.enrollment_id) || null;
  if (rec.index != null && Array.isArray(data)) return data[rec.index] || null;
  if (typeof data === 'string') return data;
  if (data && typeof data === 'object' && typeof data.id === 'string') return data.id;
  return null;
}

/* The outbox entry `entryId` succeeded with `data`: re-key every local id it
   created. Safe to call twice; the second call finds no record. */
function _onCreateLanded(entryId, data) {
  var recs = _pendingCreatesByEntry(entryId);
  if (!recs.length) return;
  var rubricIds = {};
  recs.forEach(function (rec) {
    if (rec.kind === 'criterion' || rec.kind === 'check') return; // resolved once its rubric is known
    var serverId = _serverIdFrom(rec, data);
    if (!serverId || serverId === rec.localId) {
      _unregisterPendingCreate(rec);
      return;
    }
    if (rec.kind === 'course') {
      _onCourseCreated(rec, serverId);
      return;
    }
    _unregisterPendingCreate(rec);
    var extra = null;
    if (rec.kind === 'student') extra = { personId: data && data.student_id, rosterPosition: rec.rosterPosition };
    _rekey(rec.cid, rec.kind, rec.localId, serverId, extra);
    if (rec.kind === 'rubric') rubricIds[rec.localId] = serverId;
  });
  recs.forEach(function (rec) {
    if (rec.kind !== 'criterion' && rec.kind !== 'check') return;
    var serverRubricId = rubricIds[rec.parent] || _resolveKnownId('rubric', rec.parent);
    if (!_isUuid(serverRubricId)) {
      _unregisterPendingCreate(rec);
      return;
    }
    rec._serverRubricId = serverRubricId;
  });
  var criteria = recs.filter(function (rec) {
    return (rec.kind === 'criterion' || rec.kind === 'check') && rec._serverRubricId;
  });
  return criteria.length ? _resolveRubricCriteria(criteria) : undefined;
}

/* The checkbox at `index` among a criterion's checks for `level`, in the
   order the server returns them (display order, then id). */
function _rubricCheckAt(crit, level, index) {
  var list = ((crit && crit.checks) || []).filter(function (check) {
    return check && Number(check.level) === Number(level);
  });
  return list[index] || null;
}

/* upsert_rubric answers with the rubric id only; the criteria ids come from
   the rubric tables. Pair the local criteria with the server's by position
   (display order), the order the upsert sent them in. An Advanced Rubric's
   checkboxes pair the same way, by position within their criterion's level. */
function _resolveRubricCriteria(recs) {
  var cid = recs[0].cid;
  var serverRubricId = recs[0]._serverRubricId;
  function giveUp(reason) {
    recs.forEach(function (rec) {
      _unregisterPendingCreate(rec);
      var q = window.v2Queue;
      if (q && typeof q.dropBlockedOn === 'function') q.dropBlockedOn(rec.localId, { deadLetter: true, error: reason });
    });
  }
  return Promise.resolve()
    .then(function () {
      return _loadCanonicalRubrics(cid);
    })
    .then(function (canonical) {
      var rubric = (canonical || []).find(function (r) {
        return r && r.id === serverRubricId;
      });
      if (!rubric) return giveUp('rubric criteria could not be read back');
      recs.forEach(function (rec) {
        var isCheck = rec.kind === 'check';
        var crit = (rubric.criteria || [])[isCheck ? rec.critIndex : rec.index];
        var row = isCheck ? _rubricCheckAt(crit, rec.level, rec.index) : crit;
        _unregisterPendingCreate(rec);
        if (row && _isUuid(row.id)) _rekey(cid, rec.kind, rec.localId, row.id);
        else {
          var q = window.v2Queue;
          if (q && typeof q.dropBlockedOn === 'function') {
            q.dropBlockedOn(rec.localId, {
              deadLetter: true,
              error: isCheck ? 'rubric checkbox was not created' : 'rubric criterion was not created',
            });
          }
        }
      });
    })
    .catch(function (err) {
      console.warn('Could not read back rubric criteria:', err);
      giveUp('rubric criteria could not be read back');
    });
}

/* create_course landed: the class moves to its server id and everything the
   wizard saved under the local id is replayed (P6.2). After a reload COURSES
   no longer holds the local row, so the record keeps a copy. */
function _onCourseCreated(rec, canonicalId) {
  var localId = rec.localId;
  var course = Object.assign({}, COURSES[localId] || rec.row || { name: 'Untitled Class' }, { id: canonicalId });
  if (!course.__pendingLocalId) course.__pendingLocalId = localId;
  delete COURSES[localId];
  COURSES[canonicalId] = course;
  _cache.courses = COURSES;
  _safeLSSet('gb-courses', JSON.stringify(COURSES));
  _unregisterPendingCreate(rec);
  _migrateCourseDataLocalToCanonical(localId, canonicalId);
  _pendingLocalCids.delete(localId);
  _broadcastRekey(localId, 'course', localId, canonicalId);
}

/* A create that will never land: forget it, and drop the writes waiting on
   it. `failed` dead-letters them so the loss is visible. */
function _onCreateAbandoned(entryId, failed, error) {
  var q = window.v2Queue;
  _pendingCreatesByEntry(entryId).forEach(function (rec) {
    _unregisterPendingCreate(rec);
    if (rec.kind === 'course') {
      _pendingLocalCids.delete(rec.localId);
      return;
    }
    if (q && typeof q.dropBlockedOn === 'function') {
      q.dropBlockedOn(rec.localId, failed ? { deadLetter: true, error: error || 'its record was not created' } : {});
    }
  });
}

function _onOutboxEvent(evt) {
  // The phone has no other listener on the queue; keep its dot current.
  _updateSyncIndicator();
  var meta = evt && evt.meta;
  if (!meta) return;
  if (evt.kind === 'coalesce') {
    // The replaced write was diffed against the older baseline row; keep it.
    if (_baselineUndo[meta.from]) _baselineUndo[meta.to] = _baselineUndo[meta.from];
    delete _baselineUndo[meta.from];
    return;
  }
  if (!meta.id) return;
  if (evt.kind === 'flush:success') {
    delete _baselineUndo[meta.id];
    _onCreateLanded(meta.id, meta.data);
    if (meta.endpoint === 'import_json_restore') _onRestoreLanded(meta.payload, meta.data);
    if (_WORK_ENDPOINTS[meta.endpoint]) _onWorkWriteEvent(evt.kind, meta.endpoint, meta.payload, meta.data);
    if (_FB_ENDPOINTS[meta.endpoint]) _onFeedbackWriteEvent(evt.kind, meta.endpoint, meta.payload, meta.data);
  } else if (evt.kind === 'flush:dead-letter') {
    if (_WORK_ENDPOINTS[meta.endpoint]) _onWorkWriteEvent(evt.kind, meta.endpoint, meta.payload, meta.data);
    if (_FB_ENDPOINTS[meta.endpoint]) _onFeedbackWriteEvent(evt.kind, meta.endpoint, meta.payload, meta.data);
    var undo = _baselineUndo[meta.id];
    _revertBaselineRow(undo, meta.endpoint, meta.payload);
    delete _baselineUndo[meta.id];
    if (undo && undo.field === 'scores') _rejectedScoreWrites[meta.id] = { cid: undo.cid, row: meta.payload };
    if (undo && undo.field === 'statuses') _rejectedStatusWrites[meta.id] = { cid: undo.cid, row: meta.payload };
    _onCreateAbandoned(meta.id, true, meta.error);
    _onReturnWriteRefused(meta.endpoint, meta.payload); // Draft and Returned
  } else if (evt.kind === 'dead-letter:dismiss') {
    delete _rejectedScoreWrites[meta.id];
    delete _rejectedStatusWrites[meta.id];
  } else if (evt.kind === 'remove') {
    delete _baselineUndo[meta.id];
    _onCreateAbandoned(meta.id, false);
  }
}

/* A class restore landed (shared/backup-restore.js). The server keeps one
   record per student (DECISIONS "Class backups" 3): a matched student keeps
   the record they had, not the fresh id this device gave them, and
   student_ids maps each sent id to the one used. Point the cached students,
   and queued writes still naming a fresh id, at it. Runs from the outbox's
   own event, so in every tab and after a reload, before the next entry goes. */
function _onRestoreLanded(payload, data) {
  var studentIds = (data && data.student_ids) || {};
  var courses = payload && payload.p_payload && payload.p_payload.courses;
  var cid = Array.isArray(courses) && courses[0] ? courses[0].id : null;
  var map = {};
  Object.keys(studentIds).forEach(function (sent) {
    var used = studentIds[sent];
    if (_isUuid(used) && used !== sent) map[sent] = used;
  });
  if (!cid || !Object.keys(map).length) return;
  _rekeyField('students', cid, function (rows) {
    var changed = false;
    (Array.isArray(rows) ? rows : []).forEach(function (s) {
      if (s && map[s.personId]) {
        s.personId = map[s.personId];
        changed = true;
      }
    });
    return changed;
  });
  var q = window.v2Queue;
  if (!q || typeof q.rewrite !== 'function') return;
  q.rewrite(function (entry) {
    var changed = false;
    var next = Object.assign({}, entry.payload);
    Object.keys(next).forEach(function (name) {
      var value = next[name];
      if (typeof value === 'string' && map[value]) {
        next[name] = map[value];
        changed = true;
      } else if (
        Array.isArray(value) &&
        value.some(function (v) {
          return map[v];
        })
      ) {
        next[name] = value.map(function (v) {
          return map[v] || v;
        });
        changed = true;
      }
    });
    return changed ? { payload: next, blockedOn: entry.blocked_on } : null;
  });
}

/* Once per page: forget records whose entry is gone (sent, dead-lettered or
   cleared by an earlier session before it could re-key) and records a
   chain never got to push, then let the queue re-check what is blocked. */
function _prunePendingCreates(q) {
  var map = _idmap();
  var now = Date.now();
  var changed = false;
  Object.keys(map).forEach(function (cid) {
    Object.keys(map[cid]).forEach(function (key) {
      var rec = map[cid][key];
      var stale = rec.queued ? !q.has(rec.entryId) : now - (rec.at || 0) > 5 * 60 * 1000;
      if (!stale) return;
      delete map[cid][key];
      changed = true;
    });
    if (Object.keys(map[cid]).length === 0) delete map[cid];
  });
  if (changed) _writeIdmap(map);
  if (typeof q.rewrite === 'function') {
    q.rewrite(function (entry) {
      if (!Array.isArray(entry.blocked_on) || !entry.blocked_on.length) return null;
      return { payload: entry.payload, blockedOn: _blockedLocalIds(entry.endpoint, entry.payload) };
    });
  }
}

/* Rows in a saved array that still have local ids and no pending create get
   one now, before the save's chain runs, so a write made in the same tick
   already waits on them. */
function _registerLocalRows(cid, kind, rows, endpoint) {
  if (!_isUuid(cid)) return;
  (rows || []).forEach(function (row, idx) {
    if (!row || !row.id || _isUuid(row.id)) return;
    if (_resolveKnownId(kind, row.id) !== row.id) return;
    _registerPendingCreate(cid, kind, row.id, endpoint, kind === 'student' ? { rosterPosition: idx } : null);
  });
}

function _registerLearningMapRows(cid, map) {
  if (!_isUuid(cid) || !map) return;
  _registerLocalRows(cid, 'group', map.competencyGroups, 'upsert_competency_group');
  _registerLocalRows(cid, 'subject', map.subjects, 'upsert_subject');
  _registerLocalRows(cid, 'section', map.sections, 'upsert_section');
  _registerLocalRows(
    cid,
    'tag',
    _learningMapTags(map).map(function (entry) {
      return entry.tag;
    }),
    'upsert_tag',
  );
}

function _registerRubricRows(cid, rubrics) {
  if (!_isUuid(cid)) return;
  (rubrics || []).forEach(function (rubric) {
    if (!rubric || !rubric.id) return;
    var rec = null;
    if (!_isUuid(rubric.id) && _resolveKnownId('rubric', rubric.id) === rubric.id) {
      rec = _registerPendingCreate(cid, 'rubric', rubric.id, 'upsert_rubric');
    }
    // A criterion is created inside its rubric's upsert, new rubric or not;
    // a new rubric's criteria share its entry, an existing rubric's get one.
    var entryId = rec ? rec.entryId : null;
    (rubric.criteria || []).forEach(function (crit, idx) {
      if (!crit || !crit.id) return;
      if (!_isUuid(crit.id) && _resolveKnownId('criterion', crit.id) === crit.id) {
        var critRec = _registerPendingCreate(cid, 'criterion', crit.id, 'upsert_rubric', {
          entryId: entryId,
          parent: rubric.id,
          index: idx,
        });
        if (!entryId && critRec) entryId = critRec.entryId;
      }
      // An Advanced Rubric's checkboxes are created with their criterion and
      // read back by position within their level (critIndex, level, index).
      var perLevel = {};
      (crit.checks || []).forEach(function (check) {
        if (!check || !check.id) return;
        var level = Number(check.level);
        var at = perLevel[level] || 0;
        perLevel[level] = at + 1;
        if (_isUuid(check.id) || _resolveKnownId('check', check.id) !== check.id) return;
        var checkRec = _registerPendingCreate(cid, 'check', check.id, 'upsert_rubric', {
          entryId: entryId,
          parent: rubric.id,
          critIndex: idx,
          level: level,
          index: at,
        });
        if (!entryId && checkRec) entryId = checkRec.entryId;
      });
    });
  });
}

function _getAssessmentCategoryId(assessment) {
  return (assessment && (assessment.categoryId || assessment.category_id)) || null;
}

function getAssessmentCategoryId(assessment) {
  return _getAssessmentCategoryId(assessment);
}

/* Whether an assessment's category badge shows: always when it has a
   category, and "No Category" only in a class that has categories, where
   it is something to fix. A class with none shows no badge at all. */
function showsCategoryBadge(cid, assessment) {
  return !!_getAssessmentCategoryId(assessment) || (getCategories(cid) || []).length > 0;
}

function getAssessmentCategoryName(cid, assessment) {
  var categoryId = _getAssessmentCategoryId(assessment);
  if (!categoryId) return 'No Category';
  var category = getCategoryById(cid, categoryId);
  return category && category.name ? category.name : 'Unknown Category';
}

/* A class with categories needs one on every scored assessment, as Teams
   does once categories are on (docs/DECISIONS.md, "A category on every
   assessment"). DIBELS work counts toward no grade, so it may have none. */
function categoryRequired(cid, assessment) {
  return (getCategories(cid) || []).length > 0 && !isDibelsScored(assessment);
}

// Work that should have a category and has none, or one that's gone.
function assessmentNeedsCategory(cid, assessment) {
  return (
    !!assessment && categoryRequired(cid, assessment) && !getCategoryById(cid, _getAssessmentCategoryId(assessment))
  );
}

function _normalizeProfileObservations(observations) {
  return (observations || [])
    .map(function (ob) {
      return {
        id: ob.id || ob.observation_id || uid(),
        text: ob.text || '',
        dims: ob.dims || [],
        sentiment: ob.sentiment || null,
        context: ob.context || null,
        created: ob.created || ob.created_at || ob.observed_at || new Date().toISOString(),
        date: _localDayOf(ob.date || ob.observed_at || ob.created || ob.created_at),
      };
    })
    .filter(function (ob) {
      return !!ob.text;
    });
}

function _normalizeStudentProfileSummary(row) {
  row = row || {};
  var student = row.student || {};
  var enrollment = row.enrollment || {};
  var enrollmentId =
    enrollment.id ||
    enrollment.enrollment_id ||
    row.enrollment_id ||
    student.id ||
    student.enrollment_id ||
    row.id ||
    null;
  var personId = student.student_id || student.id || row.student_id || null;
  return {
    id: enrollmentId,
    student: {
      id: enrollmentId,
      personId: personId,
      firstName: student.first_name || student.firstName || '',
      lastName: student.last_name || student.lastName || '',
      preferred:
        student.preferred_name || student.preferred || student.preferred_first_name || student.preferredFirstName || '',
      pronouns: student.pronouns || '',
      studentNumber: student.student_number || student.studentNumber || '',
      email: student.email || '',
      dateOfBirth: student.date_of_birth || student.dateOfBirth || '',
      designations: student.designations || enrollment.designations || [],
      sortName:
        student.sort_name ||
        ((student.last_name || student.lastName || '') + ' ' + (student.first_name || student.firstName || '')).trim(),
    },
    enrollment: {
      id: enrollmentId,
      rosterPosition: Number(enrollment.roster_position || enrollment.rosterPosition || 0),
      isFlagged: !!(row.is_flagged ?? row.isFlagged ?? enrollment.is_flagged ?? enrollment.isFlagged),
    },
    overallProficiency:
      row.overall_proficiency != null
        ? Number(row.overall_proficiency)
        : row.overallProficiency != null
          ? Number(row.overallProficiency)
          : null,
    letter: row.letter || null,
    counts: row.counts || {},
    goals: row.goals || {},
    reflections: row.reflections || {},
    sectionOverrides: row.section_overrides || row.sectionOverrides || {},
    notes: row.notes || [],
    isFlagged: !!(row.is_flagged ?? row.isFlagged ?? enrollment.is_flagged ?? enrollment.isFlagged),
    recentObservations: _normalizeProfileObservations(row.recent_observations || row.recentObservations),
  };
}

function _applyStudentProfileSummaries(cid, rows) {
  var summaries = {};
  var flags = {};
  var goals = {};
  var reflections = {};
  var overrides = {};
  var notes = {};
  var noteIds = null;

  (rows || []).forEach(function (row) {
    var summary = _normalizeStudentProfileSummary(row);
    if (!summary.id) return;
    // get_student_profile returns note rows with ids; list_course_student_profiles
    // has no notes at all and must not wipe ids learned earlier.
    if (row && row.notes !== undefined) {
      if (!noteIds) noteIds = {};
      noteIds[summary.id] = (summary.notes || [])
        .map(function (note) {
          return note && note.id;
        })
        .filter(_isUuid);
    }
    summaries[summary.id] = summary;
    if (summary.isFlagged) flags[summary.id] = true;
    if (summary.goals && Object.keys(summary.goals).length > 0) goals[summary.id] = summary.goals;
    if (summary.reflections && Object.keys(summary.reflections).length > 0)
      reflections[summary.id] = summary.reflections;
    if (summary.sectionOverrides && Object.keys(summary.sectionOverrides).length > 0) {
      overrides[summary.id] = summary.sectionOverrides;
    }
    if (Array.isArray(summary.notes) && summary.notes.length > 0) {
      notes[summary.id] = summary.notes
        .map(function (note) {
          return note.body || note.text || '';
        })
        .filter(Boolean)
        .join('\n\n');
    }
  });

  var students = (_cache.students[cid] || []).map(function (student) {
    var summary = summaries[student.id];
    if (!summary || !summary.student) return student;
    return Object.assign({}, student, {
      personId: summary.student.personId || student.personId || null,
      firstName: summary.student.firstName || student.firstName || '',
      lastName: summary.student.lastName || student.lastName || '',
      preferred: summary.student.preferred || student.preferred || '',
      pronouns: summary.student.pronouns || student.pronouns || '',
      studentNumber: summary.student.studentNumber || student.studentNumber || '',
      email: summary.student.email || student.email || '',
      dateOfBirth: summary.student.dateOfBirth || student.dateOfBirth || '',
      designations: summary.student.designations || student.designations || [],
      sortName: summary.student.sortName || student.sortName || '',
      rosterPosition:
        summary.enrollment && summary.enrollment.rosterPosition != null
          ? summary.enrollment.rosterPosition
          : student.rosterPosition,
      isFlagged: summary.isFlagged,
    });
  });
  if (students.length > 0) _persistLoadedField(cid, 'students', students);
  _persistLoadedField(cid, 'studentProfileSummaries', summaries);
  _persistLoadedField(cid, 'flags', flags);
  _persistLoadedField(cid, 'goals', goals);
  _persistLoadedField(cid, 'reflections', reflections);
  _persistLoadedField(cid, 'overrides', overrides);
  if (Object.keys(notes).length > 0) _persistLoadedField(cid, 'notes', notes);
  if (noteIds) _noteIds[cid] = Object.assign(_noteIds[cid] || {}, noteIds);
  return summaries;
}

function getStudentProfileSummaries(cid) {
  if (_cache.studentProfileSummaries[cid] !== undefined) return _cache.studentProfileSummaries[cid];
  try {
    return JSON.parse(localStorage.getItem('gb-student-profile-summaries-' + cid)) || {};
  } catch (e) {
    console.warn('Student profile summaries parse fallback:', e);
    return {};
  }
}

function _isMissingRpcError(error) {
  var msg = '';
  if (error && error.code) msg += error.code + ' ';
  if (error && error.message) msg += error.message + ' ';
  if (error && error.details) msg += error.details + ' ';
  return /PGRST202|function .*not found|could not find the function|schema cache/i.test(msg);
}

function _goalRowsToSummaryMap(rows) {
  var out = {};
  (rows || []).forEach(function (row) {
    var sectionId = row.section_id || row.sectionId;
    if (sectionId) out[sectionId] = row.body || row.text || '';
  });
  return out;
}

function _reflectionRowsToSummaryMap(rows) {
  var out = {};
  (rows || []).forEach(function (row) {
    var sectionId = row.section_id || row.sectionId;
    if (!sectionId) return;
    out[sectionId] = {
      confidence: row.confidence || 0,
      text: row.body || row.text || '',
      date: row.updated_at || row.date || '',
    };
  });
  return out;
}

function _overrideMapFromCompetencyTree(tree) {
  var out = {};
  ((tree && tree.subjects) || []).forEach(function (subject) {
    (subject.sections || []).forEach(function (section) {
      var override = section.override;
      if (!override || !section.id) return;
      out[section.id] = {
        level: override.level || 0,
        reason: override.reason || '',
        date: override.updated_at || override.date || '',
        // Worked out on the client (_fillOverrideCalculated); the server no
        // longer calculates levels.
        calculated: null,
      };
    });
  });
  return out;
}

function _studentProfileToSummaryRow(profile) {
  profile = _rpcObject(profile) || profile || {};
  var enrollment = profile.enrollment || {};
  return {
    student: profile.student || {},
    enrollment: enrollment,
    overall_proficiency: profile.overall_proficiency,
    letter: profile.letter,
    counts: profile.counts || {},
    goals: _goalRowsToSummaryMap(profile.goals),
    reflections: _reflectionRowsToSummaryMap(profile.reflections),
    section_overrides: _overrideMapFromCompetencyTree(profile.competency_tree),
    notes: profile.notes || [],
    is_flagged: !!(enrollment.is_flagged || enrollment.isFlagged),
    recent_observations: profile.recent_observations || [],
  };
}

async function _loadStudentProfileSummariesIndividually(cid) {
  var students = _cache.students[cid] || [];
  var rows = [];
  var batchSize = 6;
  // Each per-student fetch is bounded by a 30s timeout so a single hung
  // get_student_profile call cannot stall sign-in indefinitely. Timed-out
  // entries surface as { error: ... } below, same as the .catch() branch.
  var perCallTimeoutMs = 30_000;
  for (var i = 0; i < students.length; i += batchSize) {
    var batch = students.slice(i, i + batchSize);
    var results = await Promise.all(
      batch.map(function (student) {
        if (!student || !_isUuid(student.id) || !window.v2 || typeof window.v2.getStudentProfile !== 'function') {
          return Promise.resolve(null);
        }
        return _withTimeout(
          window.v2.getStudentProfile(student.id).catch(function (e) {
            return { error: e };
          }),
          perCallTimeoutMs,
          'get_student_profile(' + student.id + ')',
        );
      }),
    );
    results.forEach(function (res) {
      if (!res || res.error) {
        if (res && res.error && !_isMissingRpcError(res.error)) console.warn('get_student_profile failed:', res.error);
        return;
      }
      rows.push(_studentProfileToSummaryRow(res.data !== undefined ? res.data : res));
    });
  }
  return _applyStudentProfileSummaries(cid, rows);
}

async function loadStudentProfileSummaries(cid) {
  if (!cid) return {};
  if (!_useSupabase) {
    var localSummaries = _safeParseLS('gb-student-profile-summaries-' + cid, {});
    _cache.studentProfileSummaries[cid] = localSummaries || {};
    return _cache.studentProfileSummaries[cid];
  }
  // Goal dates and Core Competency self-assessments load beside the
  // profiles; the student page draws without them until they arrive.
  _loadGoalDates(cid);
  _loadCoreSelf(cid);
  try {
    var res = await window.v2.listCourseStudentProfiles(cid);
    if (res && res.error) throw res.error;
    var rows = _rpcRows(res && res.data !== undefined ? res.data : res);
    return _applyStudentProfileSummaries(cid, rows);
  } catch (e) {
    if (_isMissingRpcError(e)) {
      return _loadStudentProfileSummariesIndividually(cid);
    }
    console.warn('list_course_student_profiles failed for ' + cid + '; keeping existing summaries:', e);
    if (_cache.studentProfileSummaries[cid] === undefined) _persistLoadedField(cid, 'studentProfileSummaries', {});
    return _cache.studentProfileSummaries[cid] || {};
  }
}

function _canonicalRosterRowsToStudents(rows) {
  return (rows || [])
    .map(function (r) {
      return {
        id: r.enrollment_id || r.enrollmentId || r.id || r.student_id || r.studentId,
        personId: r.student_id || r.studentId || r.person_id || r.personId || null,
        firstName: r.first_name || r.firstName || '',
        lastName: r.last_name || r.lastName || '',
        preferred: r.preferred_name || r.preferred || r.preferred_first_name || r.preferredFirstName || '',
        pronouns: r.pronouns || '',
        studentNumber: r.student_number || r.local_student_number || r.studentNumber || '',
        email: r.email || '',
        dateOfBirth: r.date_of_birth || r.dateOfBirth || '',
        designations: r.designations || r.designation_codes || [],
        enrolledDate: _dateOnly(r.enrolled_at || r.enrolled_on || r.enrolled_date || r.enrolledDate),
        attendance: r.attendance || [],
        sortName: r.sort_name || '',
        rosterPosition: Number(r.roster_position || r.rosterPosition || 0),
        isFlagged: !!(r.is_flagged ?? r.isFlagged),
      };
    })
    .sort(function (a, b) {
      if (a.rosterPosition && b.rosterPosition && a.rosterPosition !== b.rosterPosition) {
        return a.rosterPosition - b.rosterPosition;
      }
      return fullName(a).localeCompare(fullName(b));
    });
}

function _canonicalLearningMapToCache(cid, payload) {
  payload = _rpcObject(payload) || payload || {};
  var course = COURSES[cid] || {};
  var groups = (payload.competency_groups || payload.competencyGroups || []).map(function (g, idx) {
    return {
      id: g.id,
      name: g.name || '',
      color: g.color || '#6366f1',
      sortOrder: Number(g.display_order ?? g.displayOrder ?? idx),
      displayOrder: Number(g.display_order ?? g.displayOrder ?? idx),
      countsAsOne: (g.counts_as_one ?? g.countsAsOne) !== false,
    };
  });
  var subjects = [];
  var sections = [];

  (payload.subjects || []).forEach(function (subject, subjectIdx) {
    if (!subject || !subject.id) return;
    var subjectColor = subject.color || SUBJECT_COLOURS[course.subjectCode] || '#6366f1';
    subjects.push({
      id: subject.id,
      name: subject.name || course.name || 'Learning Outcomes',
      color: subjectColor,
      sortOrder: Number(subject.display_order ?? subject.displayOrder ?? subjectIdx),
      displayOrder: Number(subject.display_order ?? subject.displayOrder ?? subjectIdx),
    });

    (subject.sections || []).forEach(function (section, sectionIdx) {
      if (!section || !section.id) return;
      var sectionName = section.name || 'Standard';
      var shortName = section.short_name || section.shortName || sectionName.replace(/\s*\(.*?\)\s*/g, '').trim();
      if (shortName.length > 20) shortName = shortName.slice(0, 18) + '\u2026';
      var sectionColor = section.color || subjectColor;
      var tags = (section.tags || []).map(function (tag, tagIdx) {
        var label = tag.label || tag.code || sectionName;
        return {
          id: tag.id,
          code: tag.code || '',
          label: label,
          text: tag.i_can_text || tag.iCanText || tag.text || '',
          i_can_statements: tag.i_can_statements || tag.iCanStatements || [],
          source_text: tag.source_text || null,
          bank_id: tag.bank_id || null,
          color: tag.color || sectionColor,
          subject: subject.id,
          name: sectionName,
          shortName: shortName,
          displayOrder: Number(tag.display_order ?? tag.displayOrder ?? tagIdx),
          sortOrder: Number(tag.display_order ?? tag.displayOrder ?? tagIdx),
          classAvg: tag.class_avg ?? tag.classAvg ?? null,
          coverageCount: Number(tag.coverage_count ?? tag.coverageCount ?? 0),
        };
      });
      sections.push({
        id: section.id,
        subject: subject.id,
        name: sectionName,
        shortName: shortName,
        color: sectionColor,
        groupId: section.competency_group_id || section.competencyGroupId || null,
        competencyGroupId: section.competency_group_id || section.competencyGroupId || null,
        tags: tags,
        sortOrder: Number(section.display_order ?? section.displayOrder ?? sectionIdx),
        displayOrder: Number(section.display_order ?? section.displayOrder ?? sectionIdx),
        outcome: tags[0] || null,
      });
    });
  });

  subjects.sort(function (a, b) {
    return Number(a.sortOrder || 0) - Number(b.sortOrder || 0);
  });
  sections.sort(function (a, b) {
    return Number(a.sortOrder || 0) - Number(b.sortOrder || 0);
  });

  return {
    subjects: subjects,
    competencyGroups: groups,
    sections: sections,
    outcomes: sections
      .map(function (section) {
        return section.outcome;
      })
      .filter(Boolean),
    _customized: true,
    _version: 1,
    _flatVersion: 2,
  };
}

function _assessmentFromDetail(existing, detail) {
  existing = existing || {};
  var a = (detail && detail.assessment) || {};
  var linkedTags =
    detail && Array.isArray(detail.linked_tags)
      ? detail.linked_tags
      : detail && Array.isArray(detail.linkedTags)
        ? detail.linkedTags
        : [];
  var tagIds = linkedTags
    .map(function (tag) {
      return tag && tag.id;
    })
    .filter(Boolean);
  var next = Object.assign({}, existing);
  if (a.id) next.id = a.id;
  if (a.title !== undefined) next.title = a.title || '';
  if (a.description !== undefined) next.description = a.description || '';
  if (a.category_id !== undefined) {
    next.categoryId = a.category_id || null;
    next.category_id = a.category_id || null;
  }
  if (a.score_mode !== undefined) {
    next.scoreMode = a.score_mode || 'proficiency';
    next.score_mode = a.score_mode || 'proficiency';
  }
  if (a.max_points !== undefined) {
    next.maxPoints = a.max_points != null ? Number(a.max_points) : null;
    next.max_points = next.maxPoints;
  }
  if (a.weight !== undefined) next.weight = a.weight != null ? Number(a.weight) : 1;
  if (a.date_assigned !== undefined) {
    next.date = _dateOnly(a.date_assigned);
    next.assigned_at = _dateOnly(a.date_assigned);
  }
  if (a.due_date !== undefined) {
    next.dueDate = _dateOnly(a.due_date);
    next.due_date = _dateOnly(a.due_date);
  }
  if (a.rubric_id !== undefined) next.rubricId = a.rubric_id || '';
  if (a.module_id !== undefined) next.moduleId = a.module_id || '';
  if (a.copy_group !== undefined) next.copyGroup = a.copy_group || null;
  if (a.core_competency_ids !== undefined) next.coreCompetencyIds = _coreCompetencyIdsOf(a.core_competency_ids);
  if (a.evidence_type !== undefined) next.evidenceType = a.evidence_type || '';
  if (a.collab_mode !== undefined) next.collaboration = _localCollabModeFromCanonical(a.collab_mode || 'individual');
  if (a.collab_config !== undefined && a.collab_config) {
    if (a.collab_config.pairs) next.pairs = a.collab_config.pairs;
    if (a.collab_config.groups) next.groups = a.collab_config.groups;
    if (a.collab_config.excludedStudents) next.excludedStudents = a.collab_config.excludedStudents;
    if (a.collab_config.groupCount) next.groupCount = a.collab_config.groupCount;
    if (a.collab_config.gradedSeparately) next.gradedSeparately = a.collab_config.gradedSeparately;
    if (a.collab_config.groupGradeAside) next.groupGradeAside = a.collab_config.groupGradeAside;
    else delete next.groupGradeAside;
  }
  // The server's list is the truth, empty included: an assessment whose last
  // competency was unlinked has none.
  var sentTags = detail && (Array.isArray(detail.linked_tags) || Array.isArray(detail.linkedTags));
  if (tagIds.length || sentTags || !Array.isArray(next.tagIds)) {
    next.tagIds = tagIds;
    next.tag_ids = tagIds;
  }
  next.has_rubric = !!(a.rubric_id || detail.rubric);
  return next;
}

function _pushHydratedScore(scores, sid, entry) {
  if (!sid || !entry || !entry.assessmentId) return;
  if (!scores[sid]) scores[sid] = [];
  var keyTag = entry.tagId || '';
  var existing = scores[sid].find(function (candidate) {
    return candidate.assessmentId === entry.assessmentId && (candidate.tagId || '') === keyTag;
  });
  if (existing) {
    // A criterion note the server no longer has is gone here too.
    if (!entry.critNote) delete existing.critNote;
    if (!entry.critBeyond) delete existing.critBeyond;
    Object.assign(existing, entry);
  } else scores[sid].push(entry);
}

function _scoreEntryFromCanonical(
  cid,
  assessment,
  tagId,
  value,
  comment,
  modifier,
  criterionComment,
  criterionBeyond,
  reportNote,
) {
  var entry = {
    // Deterministic, so loading the same server data twice writes the same
    // localStorage string: a changing value here made every load look like an
    // edit to other tabs, which then reloaded too.
    id: [assessment.id, tagId || 'overall'].join(':'),
    assessmentId: assessment.id,
    tagId: tagId || '',
    // No value on points or Complete/Incomplete work is no score (a 0 there
    // is a score); on proficiency work 0 is unscored.
    score: value == null || value === '' ? (isPointsScored(assessment) ? null : 0) : Number(value),
    date: assessment.date || assessment.assigned_at || courseToday(cid),
    type: scoreTypeFor(assessment),
    note: comment || '',
    created: assessment.date || assessment.assigned_at || '',
  };
  var mod = normalizeScoreMod(entry.score, modifier);
  if (mod) entry.mod = mod;
  // The teacher's note on a rubric criterion (set on every score key the
  // criterion fans out to) or on a competency, printed on the rubric handout.
  if (criterionComment) entry.critNote = String(criterionComment);
  // A single-point rubric's Went Beyond note (rubric_score.beyond).
  if (criterionBeyond) entry.critBeyond = String(criterionBeyond);
  // The Note for the Report on the whole piece (score.report_note), set on
  // every score entry of the cell, like the overall comment.
  if (reportNote) entry.reportNote = String(reportNote);
  return entry;
}

function _assessmentById(cid, aid) {
  var gb = _cache.v2Gradebook && _cache.v2Gradebook[cid];
  var fromGradebook =
    gb &&
    (gb.assessments || []).find(function (assessment) {
      return assessment && assessment.id === aid;
    });
  if (fromGradebook) return fromGradebook;
  return (
    (getAssessments(cid) || []).find(function (assessment) {
      return assessment && assessment.id === aid;
    }) || null
  );
}

function _rubricForAssessment(cid, assessment) {
  if (!assessment) return null;
  var rubricId = assessment.rubricId || assessment.rubric_id;
  if (!rubricId) return null;
  return getRubricById(cid, rubricId) || null;
}

function _rubricCriterionById(cid, assessment, criterionId) {
  var rubric = _rubricForAssessment(cid, assessment);
  if (!rubric || !criterionId) return null;
  return (
    (rubric.criteria || []).find(function (criterion) {
      return criterion && criterion.id === criterionId;
    }) || null
  );
}

/* The key an unscored entry carrying only the overall comment (or Note for
   the Report) sits under. Rubric work keys entries by criterion, and an
   entry under a competency there is moved onto its criteria
   (_migrateRubricScoreKeys), so it takes the first criterion. */
function _noteOnlyScoreKey(cid, assessment) {
  var rubric = _rubricForAssessment(cid, assessment);
  var first = rubric && (rubric.criteria || [])[0];
  if (first && first.id) return first.id;
  return scoreTagIds(assessment)[0] || '';
}

// A server rubric_score row is kept under its criterion's own id.
function _rubricCriterionTagIds(cid, assessment, criterionId) {
  return [criterionId];
}

/* What a score key names, for column headers and grading rows: a
   competency, a rubric criterion with no competency, or the one overall
   score. `tag` is set only for a competency. */
function scoreKeyInfo(cid, assessment, key) {
  var tag = getTagById(cid, key);
  if (tag) return { id: key, label: tag.label, text: tag.text, tag: tag };
  if (isUnlinkedTag(key)) return { id: key, label: 'Overall', text: 'Not linked to a competency' };
  var criterion = _rubricCriterionById(cid, assessment, key);
  if (criterion) {
    var name = criterion.name || 'Criterion';
    var codes = (criterion.tagIds || [])
      .map(function (tid) {
        var t = getTagById(cid, tid);
        return t ? t.code || t.label || '' : '';
      })
      .filter(Boolean);
    return {
      id: key,
      label: name,
      text: codes.length ? name + ' \u00b7 ' + codes.join(', ') : name + ': counts toward the overall grade only',
    };
  }
  return null;
}

async function _hydrateAssessmentDetails(cid) {
  if (!window.v2 || typeof window.v2.getAssessmentDetail !== 'function') return;
  var assessments = getAssessments(cid).slice();
  if (assessments.length === 0) {
    _persistLoadedField(cid, 'scores', {});
    _persistLoadedField(cid, 'statuses', {});
    return;
  }

  var byId = {};
  assessments.forEach(function (assessment) {
    if (assessment && assessment.id) byId[assessment.id] = assessment;
  });
  var scores = structuredClone(getScores(cid) || {});
  var statuses = structuredClone(getAssignmentStatuses(cid) || {});
  var batchSize = 4;

  for (var i = 0; i < assessments.length; i += batchSize) {
    var batch = assessments.slice(i, i + batchSize);
    var results = await Promise.all(
      batch.map(function (assessment) {
        if (!assessment || !_isUuid(assessment.id)) return Promise.resolve(null);
        return window.v2.getAssessmentDetail(assessment.id).catch(function (e) {
          return { error: e };
        });
      }),
    );

    results.forEach(function (res, idx) {
      if (!res || res.error) {
        if (res && res.error) console.warn('get_assessment_detail failed:', res.error);
        return;
      }
      var detail = _rpcObject(res.data !== undefined ? res.data : res);
      if (!detail || !detail.assessment || !detail.assessment.id) return;
      var merged = _assessmentFromDetail(batch[idx], detail);
      byId[merged.id] = merged;

      (detail.cells || []).forEach(function (cell) {
        var sid = cell.enrollment_id || cell.enrollmentId;
        if (!sid) return;
        var comment = (cell.score && cell.score.comment) || '';
        var status = cell.score && cell.score.status;
        if (status) statuses[sid + ':' + merged.id] = status;

        var tagScores = isPointsScored(merged) ? [] : cell.tag_scores || cell.tagScores || [];
        (tagScores || []).forEach(function (tagScore) {
          var tagId = tagScore && (tagScore.tag_id || tagScore.tagId);
          if (!tagId) return;
          _pushHydratedScore(
            scores,
            sid,
            _scoreEntryFromCanonical(cid, merged, tagId, tagScore.value, comment, tagScore.modifier, tagScore.comment),
          );
        });
        var rubricScores = cell.rubric_scores || cell.rubricScores || [];
        (rubricScores || []).forEach(function (rubricScore) {
          var criterionId = rubricScore && (rubricScore.criterion_id || rubricScore.criterionId);
          if (!criterionId) return;
          _rubricCriterionTagIds(cid, merged, criterionId).forEach(function (tagId) {
            _pushHydratedScore(
              scores,
              sid,
              _scoreEntryFromCanonical(
                cid,
                merged,
                tagId,
                rubricScore.value,
                comment,
                rubricScore.modifier,
                rubricScore.comment,
                rubricScore.beyond,
              ),
            );
          });
        });
        // Rubric work's level lives in its rubric_scores, never under a tag.
        // A comment saved before any level (value null) keeps its entry too.
        if (
          cell.score &&
          (cell.score.value != null || (comment && tagScores.length === 0 && rubricScores.length === 0)) &&
          ((tagScores.length === 0 && rubricScores.length === 0) || isPointsScored(merged))
        ) {
          var fallbackTag = cell.score.value == null ? _noteOnlyScoreKey(cid, merged) : scoreTagIds(merged)[0];
          _pushHydratedScore(
            scores,
            sid,
            _scoreEntryFromCanonical(cid, merged, fallbackTag, cell.score.value, comment),
          );
        }
      });
    });
  }

  _persistLoadedField(
    cid,
    'assessments',
    assessments.map(function (assessment) {
      return byId[assessment.id] || assessment;
    }),
  );
  _persistLoadedField(cid, 'scores', scores);
  _persistLoadedField(cid, 'statuses', statuses);
}

async function _hydrateLearningMap(cid) {
  if (!window.v2 || typeof window.v2.getLearningMap !== 'function') return;
  try {
    var res = await window.v2.getLearningMap(cid);
    if (res && res.error) throw res.error;
    var map = _canonicalLearningMapToCache(cid, res && res.data !== undefined ? res.data : res);
    var empty = !(map.subjects && map.subjects.length) && !(map.sections && map.sections.length);
    if (empty) map = (typeof LEARNING_MAP !== 'undefined' && LEARNING_MAP[cid]) || map;
    _persistLoadedField(cid, 'learningMaps', map);
  } catch (e) {
    console.warn('get_learning_map failed for ' + cid + '; keeping existing learning map:', e);
  }
}

/* An observation's `dims` are plain string keys: a disposition code
   ('engagement'), a Core Competency ('cc:<id>') or a custom tag
   ('tag:<label>'). They travel to and from the server as observation.dims
   (text[]), so keep only non-empty strings, once each, in order. */
function _observationDims(dims) {
  var out = [];
  (Array.isArray(dims) ? dims : []).forEach(function (d) {
    if (typeof d === 'string' && d && out.indexOf(d) === -1) out.push(d);
  });
  return out;
}

/* An observation's optional level on its linked competency: 1-4 (Emerging,
   Developing, Proficient, Extending) or null. It is evidence only; no grade
   reads it (docs/DECISIONS.md, "Observations (2026-10-18)"). */
function _observationLevel(v) {
  var n = typeof v === 'string' && v !== '' ? Number(v) : v;
  return typeof n === 'number' && n >= 1 && n <= 4 && Math.floor(n) === n ? n : null;
}

/* The competency (one learning-map tag id) an observation links to, as the
   p_tag_ids array: empty when there is none or the id is neither the
   server's nor a local one whose create is queued (rule 6). */
function _observationTagIds(competencyId) {
  return competencyId && _isSendableId(competencyId) ? [competencyId] : [];
}

/* The server stores only an observation's assessment_id. The title the
   badge shows comes from the course's assessments, so it is filled in here;
   an assessment that is gone or not loaded leaves the title empty. */
function _observationAssessmentTitles(cid) {
  var titles = {};
  if (!cid) return titles;
  var list = [];
  try {
    list = getAssessments(cid) || [];
  } catch (e) {
    list = [];
  }
  list.forEach(function (a) {
    if (a && a.id) titles[a.id] = a.title || '';
  });
  return titles;
}

function _observationsPayloadToBlob(payload, cid) {
  payload = _rpcObject(payload) || payload || {};
  var blob = {};
  var titles = null;
  // A withdrawn student's observations stay on the server, out of the class.
  var withdrawn = cid ? _withdrawnIds(cid) : {};
  (payload.observations || []).forEach(function (ob) {
    var enrollmentIds = ob.enrollment_ids || ob.enrollmentIds || [];
    enrollmentIds.forEach(function (sid) {
      if (!sid || withdrawn[sid]) return;
      if (!blob[sid]) blob[sid] = [];
      var entry = {
        id: ob.id,
        text: ob.body || ob.text || '',
        dims: _observationDims(ob.dims),
        sentiment: ob.sentiment || null,
        context: ob.context_type || ob.context || null,
        created: ob.created_at || ob.created || new Date().toISOString(),
        date: _localDayOf(ob.observed_at || ob.created_at || ob.created),
      };
      var tagIds = ob.tag_ids || ob.tagIds || [];
      if (tagIds.length && tagIds[0]) entry.competencyId = tagIds[0];
      var level = _observationLevel(ob.level);
      if (level) entry.level = level;
      if (ob.assessment_id) {
        if (!titles) titles = _observationAssessmentTitles(cid);
        entry.assignmentContext = { assessmentId: ob.assessment_id, assessmentTitle: titles[ob.assessment_id] || '' };
      }
      blob[sid].push(entry);
    });
  });
  return blob;
}

/* get_observations returns at most 200 a page, newest first, and says
   whether more follow. Asking for a bigger page still gets 200. */
var _OBSERVATION_PAGE = 200;
async function _fetchObservationPages(cid, firstPage) {
  var rows = [];
  for (var page = firstPage; page < firstPage + 500; page++) {
    var res = await window.v2.getObservations(cid, { filters: {}, page: page, pageSize: _OBSERVATION_PAGE });
    if (res && res.error) throw res.error;
    var data = _rpcObject(res && res.data !== undefined ? res.data : res) || {};
    rows = rows.concat(data.observations || []);
    if (!data.has_more) break;
  }
  return rows;
}

async function _hydrateObservations(cid) {
  if (!window.v2 || typeof window.v2.getObservations !== 'function') return;
  try {
    var rows = await _fetchObservationPages(cid, 1);
    _persistLoadedField(cid, 'observations', _observationsPayloadToBlob({ observations: rows }, cid));
  } catch (e) {
    console.warn('get_observations failed for ' + cid + '; keeping existing observations:', e);
  }
}

/* The class bundle carries the newest 500 observations and the total. The
   older ones are fetched after the class is on screen and added to what is
   there, so an observation written in the meantime is kept. */
var _olderObservationsLoading = {};
function _loadOlderObservations(cid, loadedCount) {
  if (_olderObservationsLoading[cid] || !window.v2 || typeof window.v2.getObservations !== 'function') return;
  var firstPage = Math.floor(loadedCount / _OBSERVATION_PAGE) + 1;
  _olderObservationsLoading[cid] = _fetchObservationPages(cid, firstPage)
    .then(function (rows) {
      var current = _cloneValue(getQuickObs(cid) || {}) || {};
      var have = {};
      Object.keys(current).forEach(function (sid) {
        (current[sid] || []).forEach(function (ob) {
          if (ob && ob.id) have[sid + '|' + ob.id] = true;
        });
      });
      var older = _observationsPayloadToBlob({ observations: rows }, cid);
      var added = false;
      Object.keys(older).forEach(function (sid) {
        older[sid].forEach(function (ob) {
          if (have[sid + '|' + ob.id]) return;
          (current[sid] = current[sid] || []).push(ob);
          added = true;
        });
      });
      if (!added) return;
      _persistLoadedField(cid, 'observations', current);
      if (cid === getActiveCourse()) _invalidateAndRerender();
    })
    .catch(function (e) {
      console.warn('Older observations failed to load for ' + cid + ':', e);
    })
    .finally(function () {
      delete _olderObservationsLoading[cid];
    });
}

async function _hydrateCanonicalDetails(cid) {
  await Promise.all([_hydrateLearningMap(cid), _hydrateObservations(cid)]);
  try {
    var canonicalRubrics = await _loadCanonicalRubrics(cid);
    _persistLoadedField(cid, 'rubrics', canonicalRubrics || []);
  } catch (e) {
    console.warn('Rubric read failed for ' + cid + '; keeping existing rubrics:', e);
  }
  await _hydrateAssessmentDetails(cid);
}

function _gradebookCellsToScoreCache(cid, assessments, cells) {
  var byAssessment = {};
  (assessments || []).forEach(function (assessment) {
    if (assessment && assessment.id) byAssessment[assessment.id] = assessment;
  });
  var scores = {};
  var statuses = {};
  Object.keys(cells || {}).forEach(function (sid) {
    var studentCells = cells[sid] || {};
    Object.keys(studentCells).forEach(function (aid) {
      var cell = studentCells[aid] || {};
      var assessment = byAssessment[aid] || { id: aid, tagIds: [] };
      var comment = (cell.score && cell.score.comment) || '';
      var reportNote = (cell.score && cell.score.report_note) || '';
      if (cell.score && cell.score.status) statuses[sid + ':' + aid] = cell.score.status;
      (cell.tag_scores || cell.tagScores || []).forEach(function (tagScore) {
        var tagId = tagScore && (tagScore.tag_id || tagScore.tagId);
        if (!tagId) return;
        _pushHydratedScore(
          scores,
          sid,
          _scoreEntryFromCanonical(
            cid,
            assessment,
            tagId,
            tagScore.value,
            comment,
            tagScore.modifier,
            tagScore.comment,
            null,
            reportNote,
          ),
        );
      });
      (cell.rubric_scores || cell.rubricScores || []).forEach(function (rubricScore) {
        var criterionId = rubricScore && (rubricScore.criterion_id || rubricScore.criterionId);
        if (!criterionId) return;
        _rubricCriterionTagIds(cid, assessment, criterionId).forEach(function (tagId) {
          _pushHydratedScore(
            scores,
            sid,
            _scoreEntryFromCanonical(
              cid,
              assessment,
              tagId,
              rubricScore.value,
              comment,
              rubricScore.modifier,
              rubricScore.comment,
              rubricScore.beyond,
              reportNote,
            ),
          );
        });
      });
      var hasAssessmentEntry =
        scores[sid] &&
        scores[sid].some(function (entry) {
          return entry.assessmentId === aid;
        });
      // A comment or Note for the Report saved before any level is a score
      // row with no value: it still needs an entry to carry it (score null
      // on points and Complete/Incomplete work, where a 0 is a score).
      var noteOnly = !!(comment || reportNote);
      if (cell.score && (cell.score.value != null || noteOnly) && !hasAssessmentEntry) {
        _pushHydratedScore(
          scores,
          sid,
          _scoreEntryFromCanonical(
            cid,
            assessment,
            cell.score.value == null ? _noteOnlyScoreKey(cid, assessment) : scoreTagIds(assessment)[0],
            cell.score.value,
            comment,
            isPointsScored(assessment) ? 0 : cell.score.modifier,
            null,
            null,
            reportNote,
          ),
        );
      }
    });
  });
  return { scores: scores, statuses: statuses };
}

/* Convert v2 get_gradebook(cid) payload → per-course cache blobs.
   Payload shape (read-paths.sql §2.1):
     { course, students:[{enrollment_id, student_id, first_name, last_name,
                          roster_position, is_flagged}],
       assessments:[{id, title, category_id, score_mode, max_points,
                     has_rubric, date_assigned, due_date, display_order}],
       cells: { enrollment_id → { assessment_id → {kind, value,
                                                   score:{value,status,comment}} } },
       row_summaries: { enrollment_id → {letter, overall_proficiency, counts} } } */
function _v2GradebookToCache(cid, payload) {
  payload = payload || {};
  var categories = (payload.categories || [])
    .map(function (c) {
      return {
        id: c.id,
        name: c.name || '',
        weight: Number(c.weight || 0),
        displayOrder: Number(c.display_order || c.displayOrder || 0),
        calcMode: categoryCalcMode(c),
      };
    })
    .sort(function (a, b) {
      return a.displayOrder - b.displayOrder;
    });
  var students = _canonicalRosterRowsToStudents(payload.students || []).map(function (student) {
    return migrateStudent(Object.assign({}, student, { isFlagged: !!student.isFlagged }));
  });

  var assessments = (payload.assessments || []).map(function (a) {
    var categoryId = a.category_id || null;
    var maxPts = a.max_points != null ? Number(a.max_points) : null;
    var sMode = a.score_mode || 'proficiency';
    var tIds = a.tag_ids || a.tagIds || [];
    var assessment = {
      id: a.id,
      title: a.title || '',
      description: a.description || '',
      date: _dateOnly(a.date_assigned),
      type: a.assessment_kind || (categoryId ? 'summative' : 'formative'),
      categoryId: categoryId,
      category_id: categoryId,
      tagIds: tIds,
      tag_ids: tIds,
      scoreMode: sMode,
      score_mode: sMode,
      maxPoints: sMode === 'complete' ? COMPLETE_MAX_POINTS : maxPts,
      max_points: sMode === 'complete' ? COMPLETE_MAX_POINTS : maxPts,
      weight: a.weight != null ? Number(a.weight) : 1,
      evidenceType: a.evidence_type || '',
      rubricId: a.rubric_id || '',
      moduleId: a.module_id || '',
      copyGroup: a.copy_group || null,
      coreCompetencyIds: _coreCompetencyIdsOf(a.core_competency_ids),
      has_rubric: !!a.has_rubric,
      due_date: _dateOnly(a.due_date),
      assigned_at: _dateOnly(a.date_assigned),
      display_order: Number(a.display_order || 0),
      created_at: a.created_at || undefined, // when the piece was made (calc.js _pieceMadeAt); sent once the bundle has it
    };
    var collabMode = a.collab_mode || a.collabMode;
    var collabConfig = a.collab_config || a.collabConfig || {};
    if (collabMode) assessment.collaboration = _localCollabModeFromCanonical(collabMode);
    if (collabConfig.pairs) assessment.pairs = collabConfig.pairs;
    if (collabConfig.groups) assessment.groups = collabConfig.groups;
    if (collabConfig.excludedStudents) assessment.excludedStudents = collabConfig.excludedStudents;
    if (collabConfig.groupCount) assessment.groupCount = collabConfig.groupCount;
    if (collabConfig.gradedSeparately) assessment.gradedSeparately = collabConfig.gradedSeparately;
    if (collabConfig.groupGradeAside) assessment.groupGradeAside = collabConfig.groupGradeAside;
    return assessment;
  });

  _persistLoadedField(cid, 'categories', categories);
  _persistLoadedField(cid, 'students', students);
  _persistLoadedField(cid, 'assessments', assessments);

  // Modules: hydrate from payload when the server returned them. If the server
  // omits the field (older migration not yet deployed), preserve whatever's
  // already in cache/localStorage so we don't blank a populated module list
  // during a client/server version skew.
  if (Array.isArray(payload.modules)) {
    var modules = payload.modules.map(function (m) {
      return {
        id: m.id,
        name: m.name || '',
        color: m.color || null,
        sortOrder: Number(m.display_order != null ? m.display_order : m.sortOrder || 0),
        created: m.created_at || m.created || null,
      };
    });
    _persistLoadedField(cid, 'modules', modules);
  }

  _cache.v2Gradebook[cid] = payload;
  var cellCache = _gradebookCellsToScoreCache(cid, assessments, payload.cells || {});
  _persistLoadedField(cid, 'scores', cellCache.scores);
  _persistLoadedField(cid, 'statuses', cellCache.statuses);

  // These fields come from follow-up reads in _doInitData(), and term ratings,
  // report config and course config aren't read from the server at all yet.
  // Keep what this device already has and default only what it doesn't:
  // blanking them here erased local report-card work on every load, and left
  // fields empty whenever a follow-up read failed.
  _keepOrDefaultField(cid, 'observations', {});
  _keepOrDefaultField(cid, 'courseConfigs', {});
  _keepOrDefaultField(cid, 'reportConfig', null);
  _keepOrDefaultField(
    cid,
    'learningMaps',
    (typeof LEARNING_MAP !== 'undefined' && LEARNING_MAP[cid]) || { subjects: [], sections: [] },
  );
  _keepOrDefaultField(cid, 'termRatings', {});
  _keepOrDefaultField(cid, 'flags', {});
  _keepOrDefaultField(cid, 'goals', {});
  _keepOrDefaultField(cid, 'reflections', {});
  _keepOrDefaultField(cid, 'overrides', {});
  _keepOrDefaultField(cid, 'studentProfileSummaries', {});

  _cache.notes[cid] = _safeParseLS('gb-notes-' + cid, {});
  _cache.modules[cid] = _safeParseLS('gb-modules-' + cid, _safeParseLS('gb-units-' + cid, [])) || [];
  _cache.rubrics[cid] = _safeParseLS('gb-rubrics-' + cid, []);
  _noteRubricsSet(cid);
  _cache.customTags[cid] = _safeParseLS('gb-custom-tags-' + cid, []);
}

async function _doInitData(cid) {
  if (_useSupabase) {
    const sb = getSupabase();

    // v2 TRANSITION (Phases 3.3 → 3.4):
    //   3.3 empty-shell short-circuit kept here for the not-ready fallback path
    //       (e.g. window.__V2_GRADEBOOK_READY explicitly turned off for testing).
    //   3.4 default ON: call get_gradebook(cid) and hydrate students + assessments
    //       + _cache.v2Gradebook. Scores/observations/learningMaps/etc. stay empty
    //       until their own phases port the corresponding reads.
    if (window.__V2_GRADEBOOK_READY === false) {
      _v2GradebookToCache(cid, { categories: [], students: [], assessments: [], cells: {}, row_summaries: {} });
      return;
    }

    if (_classBundleEnabled()) {
      var bundleRes;
      try {
        // Only a class already in memory can be "not modified".
        var knownVersion = _cache.students[cid] !== undefined && _classVersion[cid] != null ? _classVersion[cid] : null;
        bundleRes = await _callRpcWithAuthGuard(
          'get_class_bundle',
          { p_course_id: cid, p_if_version: knownVersion },
          { suppressSessionExpiredModal: true },
        );
      } catch (e) {
        bundleRes = { error: e };
      }
      if (bundleRes && bundleRes.error && _isMissingRpcError(bundleRes.error)) {
        // Server without the migration yet: use the separate reads below.
        _classBundleMissing = true;
      } else if (!bundleRes || bundleRes.error) {
        _courseLoadFailed(cid, bundleRes && bundleRes.error);
        return;
      } else {
        var bundle = _rpcObject(bundleRes.data) || {};
        if (bundle.not_modified) {
          if (!_serverKeepsRows(cid)) {
            _clearLoadError(cid);
            _classFresh[cid] = true;
            _markLoadSynced();
            return;
          }
          // Draft and Returned: the class's rows too, if this session has
          // not read them. The load has worked only when they have: until
          // then a load that failed stays failed, so its retries keep
          // backing off (15 s, 30 s, 1 min, then every 2 min).
          _classFresh[cid] = true;
          if ((await _loadServerGradeReturns(cid, false)) !== false) {
            _clearLoadError(cid);
            _markLoadSynced();
          }
          return;
        }
        var rowsToo = false;
        try {
          _bundleToCache(cid, bundle);
          rowsToo = _serverKeepsRows(cid);
          if (!rowsToo) {
            _clearLoadError(cid);
            _markLoadSynced();
          }
        } catch (e) {
          // A payload this code can't read must not leave the class half
          // applied with no word to the teacher.
          console.error('get_class_bundle could not be applied for ' + cid + ':', e);
          if (window.Sentry && typeof window.Sentry.captureException === 'function') window.Sentry.captureException(e);
          _courseLoadFailed(cid, e);
          return;
        }
        // Draft and Returned: the rows that go with the scores just loaded.
        // After the scores, never before: rows older than the scores could
        // read a draft as returned. The load has worked when they are in.
        if (rowsToo && (await _loadServerGradeReturns(cid, true)) !== false) {
          _clearLoadError(cid);
          _markLoadSynced();
        }
        return;
      }
    }

    var gbRes;
    try {
      gbRes = await _callRpcWithAuthGuard('get_gradebook', { p_course_id: cid }, { suppressSessionExpiredModal: true });
    } catch (e) {
      gbRes = { error: e };
    }
    if (!gbRes || gbRes.error) {
      _courseLoadFailed(cid, gbRes && gbRes.error);
      return;
    }
    _clearLoadError(cid);
    _v2GradebookToCache(cid, gbRes.data || {});
    // The class's settings too: get_gradebook's `course` is the whole course
    // row, as the bundle's is. This load used to take none of them.
    var olderRow = (_rpcObject(gbRes.data) || {}).course;
    if (_plainObject(olderRow)) {
      _applyBundleCourseConfig(cid, {}, olderRow);
      _applyBundleCourseRow(cid, olderRow);
      var olderLoad = _refreshState[cid];
      if (!(olderLoad && olderLoad.skipped)) _classReadFromServer(cid);
    }
    await _hydrateCanonicalDetails(cid);
    await loadStudentProfileSummaries(cid);
    if (_serverKeepsRows(cid)) await _loadServerGradeReturns(cid, true);
    return;
  }

  // localStorage path
  _loadCourseFromLS(cid);
}

/* ── One request per class (docs/class-loading-plan.md, Phase 3) ──────────
   get_class_bundle returns what the separate reads above returned, in one
   response. Each section keeps the shape of the call it replaces and goes
   through the same converter. window.__FV_CLASS_BUNDLE = false switches back
   to the separate reads. */
var _classBundleMissing = false;
var _classVersion = {}; // cid → version of the data in the cache

function _classBundleEnabled() {
  return window.__FV_CLASS_BUNDLE !== false && !_classBundleMissing;
}

/* Scores arrive as compact rows that point into the roster, assessment, tag
   and criterion lists by position. Rebuild get_gradebook's cells from them,
   sorted so the same data always produces the same cache. */
function _bundleCells(gb) {
  var students = gb.students || [];
  var assessments = gb.assessments || [];
  var tags = gb.tag_index || [];
  var criteria = gb.criterion_index || [];
  var cells = {};
  function cellFor(si, ai) {
    var sid = students[si] && students[si].enrollment_id;
    var aid = assessments[ai] && assessments[ai].id;
    if (!sid || !aid) return null;
    var row = cells[sid] || (cells[sid] = {});
    return row[aid] || (row[aid] = { score: null, tag_scores: [], rubric_scores: [] });
  }
  function sorted(rows) {
    return (rows || []).slice().sort(function (a, b) {
      return a[0] - b[0] || a[1] - b[1] || (a[2] || 0) - (b[2] || 0);
    });
  }
  sorted(gb.score_rows).forEach(function (r) {
    var cell = cellFor(r[0], r[1]);
    // A sixth value, the + / −, from migrations/20261022_score_modifier.sql;
    // a seventh, the Note for the Report, from
    // migrations/20261031_score_report_note.sql (a six-value row has none).
    if (cell) cell.score = { value: r[2], status: r[3], comment: r[4], modifier: r[5] || 0, report_note: r[6] || null };
  });
  sorted(gb.tag_rows).forEach(function (r) {
    var cell = cellFor(r[0], r[1]);
    // A sixth value, the competency's comment, from migrations/20261027_score_comments.sql.
    if (cell && tags[r[2]])
      cell.tag_scores.push({ tag_id: tags[r[2]], value: r[3], modifier: r[4], comment: r[5] || null });
  });
  sorted(gb.criterion_rows).forEach(function (r) {
    var cell = cellFor(r[0], r[1]);
    if (cell && criteria[r[2]])
      // A seventh value, Went Beyond, from migrations/20261027_single_point_rubric.sql.
      cell.rubric_scores.push({
        criterion_id: criteria[r[2]],
        value: r[3],
        modifier: r[4],
        comment: r[5] || null,
        beyond: r[6] || null,
      });
  });
  // A points-scored assessment is scored as a whole; get_assessment_detail
  // ignored any competency scores left on it, and so does this.
  assessments.forEach(function (a) {
    if (!a || a.score_mode !== 'points') return;
    Object.keys(cells).forEach(function (sid) {
      if (cells[sid][a.id]) cells[sid][a.id].tag_scores = [];
    });
  });
  return cells;
}

/* check_rows → { 'sid:aid': [checkId, …] }, each list in index order so the
   same data always produces the same cache. */
function _bundleRubricChecks(gb) {
  var students = gb.students || [];
  var assessments = gb.assessments || [];
  var checks = gb.check_index || [];
  var out = {};
  (gb.check_rows || [])
    .slice()
    .sort(function (a, b) {
      return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
    })
    .forEach(function (r) {
      var sid = students[r[0]] && students[r[0]].enrollment_id;
      var aid = assessments[r[1]] && assessments[r[1]].id;
      var checkId = checks[r[2]];
      if (!sid || !aid || !checkId) return;
      var key = sid + ':' + aid;
      if (!out[key]) out[key] = [];
      if (out[key].indexOf(checkId) < 0) out[key].push(checkId);
    });
  return out;
}

/* print_rows → { 'sid:aid': { at, hash } }: the completed rubrics printed
   (migrations/20261102_rubric_print.sql). Keys are written in row order so
   the same data always produces the same cache. */
function _bundleRubricPrints(gb) {
  var students = gb.students || [];
  var assessments = gb.assessments || [];
  var out = {};
  (gb.print_rows || [])
    .slice()
    .sort(function (a, b) {
      return a[0] - b[0] || a[1] - b[1];
    })
    .forEach(function (r) {
      var sid = students[r[0]] && students[r[0]].enrollment_id;
      var aid = assessments[r[1]] && assessments[r[1]].id;
      if (!sid || !aid || !r[2] || !r[3]) return;
      out[sid + ':' + aid] = { at: String(r[2]), hash: String(r[3]) };
    });
  return out;
}

function _bundleToCache(cid, bundle) {
  var gb = bundle.gradebook || {};

  // Rubrics first: rubric scores are mapped to competencies through them.
  var rb = bundle.rubrics || {};
  _persistLoadedField(
    cid,
    'rubrics',
    _canonicalRubricRowsToCache(rb.rubrics, rb.criteria, rb.criterion_tags, rb.criterion_checks, rb.rubric_tags),
  );
  // Ticked Advanced Rubric checkboxes: [student, assessment, check] rows
  // pointing into the roster, assessment and check lists. A bundle from
  // before the checks has none; the class then has no ticks.
  _persistLoadedField(cid, 'rubricChecks', _bundleRubricChecks(gb));
  // Printed rubrics: [student, assessment, printed_at, hash] rows. A bundle
  // from before them has none; nothing in the class shows as printed.
  _persistLoadedField(cid, 'rubricPrints', _bundleRubricPrints(gb));

  var map = _canonicalLearningMapToCache(cid, bundle.learning_map || {});
  var emptyMap = !(map.subjects && map.subjects.length) && !(map.sections && map.sections.length);
  if (emptyMap) map = (typeof LEARNING_MAP !== 'undefined' && LEARNING_MAP[cid]) || map;
  _persistLoadedField(cid, 'learningMaps', map);

  _v2GradebookToCache(cid, Object.assign({}, gb, { cells: _bundleCells(gb) }));
  // Before observations and term ratings, which name withdrawn students too.
  _applyBundleWithdrawn(cid, bundle.withdrawn_students);
  // The fields get_assessment_detail used to add (due date, collaboration).
  var rawById = {};
  (gb.assessments || []).forEach(function (a) {
    if (a && a.id) rawById[a.id] = a;
  });
  _persistLoadedField(
    cid,
    'assessments',
    (_cache.assessments[cid] || []).map(function (assessment) {
      var raw = rawById[assessment.id];
      if (!raw) return assessment;
      var tagIds = raw.tag_ids || [];
      return _assessmentFromDetail(assessment, {
        assessment: raw,
        linked_tags: tagIds.map(function (id) {
          return { id: id };
        }),
      });
    }),
  );

  var observationPayload = bundle.observations || {};
  _persistLoadedField(cid, 'observations', _observationsPayloadToBlob(observationPayload, cid));
  var observationsLoaded = (observationPayload.observations || []).length;
  if (Number(observationPayload.total) > observationsLoaded) _loadOlderObservations(cid, observationsLoaded);
  _applyStudentProfileSummaries(cid, bundle.profiles || []);
  _applyBundleTermRatings(cid, bundle.term_ratings || []);
  // A course's report_config row exists from creation with no blocks; only
  // a saved layout replaces the default one the Reports page builds.
  var rc = bundle.report_config;
  if (rc && rc.blocks_config && typeof rc.blocks_config === 'object' && Object.keys(rc.blocks_config).length > 0) {
    _persistLoadedField(
      cid,
      'reportConfig',
      Object.assign({}, rc.blocks_config, rc.preset ? { _preset: rc.preset } : {}),
    );
  }
  if (Array.isArray(bundle.custom_tags)) _persistLoadedField(cid, 'customTags', bundle.custom_tags.slice());
  // A server without the starters bank sends no list; keep this device's.
  if (Array.isArray(bundle.observation_templates)) {
    _persistLoadedField(
      _STARTER_SCOPE,
      'observationTemplates',
      _observationTemplatesFromServer(bundle.observation_templates),
    );
  }
  _applyBundleCourseConfig(cid, bundle.course_config, bundle.gradebook && bundle.gradebook.course);
  _applyBundleCourseRow(cid, bundle.gradebook && bundle.gradebook.course);
  _applyBundleCurriculumTags(cid, bundle.gradebook && bundle.gradebook.course);
  // After the class settings: it works out and caches levels, and on a first
  // load this device has none of the settings yet.
  _fillOverrideCalculated(cid);

  // A field skipped because the teacher edited it mid-load is fetched again;
  // until then the cache isn't the server's version, so don't claim it is.
  var st = _refreshState[cid];
  if (!(st && st.skipped) && bundle.version != null) {
    _classVersion[cid] = Number(bundle.version);
    _classFresh[cid] = true;
    _dirtyMarked[cid] = false;
    var now = Date.now();
    _saveClassMeta(cid, {
      version: _classVersion[cid],
      savedAt: now,
      lastOpenedAt: now,
      owner: _teacherId,
      schema: _BUNDLE_SCHEMA,
      dirty: false,
      settings: _SAVED_SETTINGS,
    });
    _classReadFromServer(cid);
  }
}

/* ── Saved copy first (docs/class-loading-plan.md, Phase 4) ───────────────
   A class this device has saved opens from that copy at once; a request
   carrying its version then asks whether anything changed, and only a
   changed class is downloaded. gb-bundle-meta-<cid> records the copy's
   version, owner and age. FV_CACHE_FIRST (constants.js) or
   window.__FV_CACHE_FIRST = false turns this off. */
// 4 (2026-10-29): rubric scores are keyed by criterion. A schema 3 copy is
// still used unless it keeps rubric scores under competencies
// (_savedCopyUsable), so only those classes are downloaded again in full.
// 5 (2026-11-03): rubrics carry tagIds, the competencies the whole rubric
// scores. A schema 4 copy is still used: none existed before.
// 6 (2026-11-10): assessments carry created_at, when the piece was made,
// which orders same-date work (calc.js _sameDatePieceOrder). No older copy
// is used as it is: the server answers "not modified" for a class that has
// not changed, so an older copy would never get the times, and its
// same-date work would sit in another order than on a device that fetched
// the class fresh. Each class is downloaded in full once instead.
var _BUNDLE_SCHEMA = 6;
/* Whose settings a saved copy holds. 1 (2026-11-10): every class setting in
   it was taken from the server when it was saved, the calculation method
   and decay weight included. A copy saved before that kept this device's
   own method and weight whatever the server held, and the server answers
   "not modified" for a class that has not changed since, so such a copy
   would go on grading with them. It is still shown at once, but not taken
   as the server's: the class is downloaded in full once (_loadSavedCopy). */
var _SAVED_SETTINGS = 1;
var _SAVED_COPY_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
var _classFresh = {}; // cid → the server confirmed or replaced this copy since it was shown
var _dirtyMarked = {}; // cid → the saved copy has been flagged as holding local edits

function _cacheFirstEnabled() {
  if (window.__FV_CACHE_FIRST === false) return false;
  return typeof FV_CACHE_FIRST === 'undefined' || !!FV_CACHE_FIRST;
}

function _classMeta(cid) {
  return _safeParseLS('gb-bundle-meta-' + cid, null);
}

function _saveClassMeta(cid, patch) {
  var meta = Object.assign({}, _classMeta(cid) || {}, patch);
  _safeLSSet('gb-bundle-meta-' + cid, JSON.stringify(meta));
  return meta;
}

/* A saved copy is used only for the teacher who saved it, in the shape this
   code reads, and within 14 days of last being opened. */
function _savedCopyUsable(cid) {
  var meta = _classMeta(cid);
  if (!meta || !meta.owner || meta.owner !== _teacherId) return false;
  // Only a copy this code saved (see _BUNDLE_SCHEMA). An older one stays in
  // the browser: it is what shows if the download fails, and what is kept
  // while writes wait to be sent (_initClassData).
  if (meta.schema !== _BUNDLE_SCHEMA) return false;
  if (Date.now() - (meta.lastOpenedAt || meta.savedAt || 0) > _SAVED_COPY_MAX_AGE_MS) return false;
  return _hasLocalCopy(cid);
}

// A saved copy that still keeps rubric scores under competencies.
function _savedCopyHasLegacyRubricKeys(cid) {
  var scores = _safeParseLS('gb-scores-' + cid, {});
  var assessments = _safeParseLS('gb-assessments-' + cid, []);
  var rubricById = {};
  _safeParseLS('gb-rubrics-' + cid, []).forEach(function (r) {
    if (r && r.id) rubricById[r.id] = r;
  });
  var legacyTags = {};
  (assessments || []).forEach(function (a) {
    var rubric = a && !isPointsScored(a) && rubricById[a.rubricId || a.rubric_id];
    if (!rubric) return;
    var tags = {};
    (rubric.criteria || []).forEach(function (c) {
      ((c && c.tagIds) || []).forEach(function (t) {
        tags[t] = true;
      });
    });
    legacyTags[a.id] = tags;
  });
  return _hasLegacyRubricKeys(scores || {}, legacyTags);
}

/* The copy becomes the server baseline only when it holds no local edits:
   with edits it isn't what the server has, and diffing against it would
   hide them. Without a baseline (or a version) the check downloads the
   class again instead of answering "not modified". */
function _loadSavedCopy(cid) {
  var meta = _classMeta(cid) || {};
  _loadCourseFromLS(cid);
  _cache.categories[cid] = _safeParseLS('gb-categories-' + cid, []);
  if (meta.dirty || meta.settings !== _SAVED_SETTINGS) return;
  Object.keys(_SERVER_STATE_FIELDS).forEach(function (field) {
    if (_cache[field][cid] !== undefined) _rememberServerState(field, cid, _cache[field][cid]);
  });
  if (meta.version != null) _classVersion[cid] = Number(meta.version);
}

function _markSavedCopyDirty(cid) {
  if (_dirtyMarked[cid]) return;
  _dirtyMarked[cid] = true;
  if (_classMeta(cid)) _saveClassMeta(cid, { dirty: true });
}

/* Ask the server whether the class on screen changed. Editing waits for the
   answer (usually 100-200 ms) so nothing is typed into data another device
   has replaced; after 3 seconds, or offline, it unlocks anyway and the
   saved copy stays on screen. The "Checking for updates…" note (after
   400 ms) stays until the answer comes, not just while editing is locked:
   when it went at 3 seconds, a class switch showed a score saved on the
   phone as blank for several more seconds, then changed with no word. It
   goes after 30 seconds at most, so a check stuck behind unsent changes
   (offline) doesn't leave it up. */
function _startClassCheck(cid) {
  _classFresh[cid] = false;
  // Only the class on screen holds the page while it is checked; another
  // class checked in the background (preloadClasses) leaves the page alone.
  var offline = (typeof navigator !== 'undefined' && navigator.onLine === false) || cid !== getActiveCourse();
  if (!offline) setPageLock('checking', true);
  var body = typeof document !== 'undefined' ? document.body : null;
  var answered = false;
  function hideNote() {
    if (body && body.classList) body.classList.remove('fv-checking-slow');
  }
  var noteTimer = setTimeout(function () {
    if (!answered && !offline && body && body.classList) body.classList.add('fv-checking-slow');
  }, 400);
  var noteCap = setTimeout(hideNote, 30000);
  var unlocked = false;
  function unlock() {
    if (unlocked || offline) return;
    unlocked = true;
    setPageLock('checking', false);
  }
  var timer = setTimeout(unlock, 3000);
  return _handleExternalCourseUpdate(cid, 'gradebook').finally(function () {
    answered = true;
    clearTimeout(timer);
    clearTimeout(noteTimer);
    clearTimeout(noteCap);
    hideNote();
    unlock();
  });
}

/* Print and export use the server's current data: wait for the check, and
   report whether the class is known to be current. */
function ensureClassFresh(cid) {
  if (!cid || !_useSupabase || !_classBundleEnabled() || _classFresh[cid]) return Promise.resolve(true);
  return _handleExternalCourseUpdate(cid, 'gradebook').then(function () {
    return !!_classFresh[cid];
  });
}

/* Page locks. "switching" covers a class loading with nothing to show yet
   (the old class stays on screen); "checking" covers a saved copy waiting
   for the server's answer. While either holds, #main is inert, which blocks
   the keyboard as well as the mouse. */
var _pageLocks = { switching: 0, checking: 0 };
function setPageLock(kind, on) {
  _pageLocks[kind] = Math.max(0, (_pageLocks[kind] || 0) + (on ? 1 : -1));
  var body = typeof document !== 'undefined' ? document.body : null;
  if (!body || !body.classList) return;
  var cls = kind === 'switching' ? 'fv-switching-course' : 'fv-checking-class';
  if (_pageLocks[kind] > 0) body.classList.add(cls);
  else body.classList.remove(cls);
  var locked = _pageLocks.switching > 0 || _pageLocks.checking > 0;
  if (body.setAttribute) {
    if (locked) body.setAttribute('aria-busy', 'true');
    else body.removeAttribute('aria-busy');
  }
  var main = document.getElementById && document.getElementById('main');
  if (main) main.inert = locked;
}

/* Saved copies not opened for 14 days are removed at sign-in. */
function _purgeStaleSavedCopies() {
  var stale = {};
  try {
    for (var i = 0; i < localStorage.length; i++) {
      var key = localStorage.key(i);
      var m = key && key.match(/^gb-bundle-meta-(.+)$/);
      if (!m) continue;
      var meta = _safeParseLS(key, null) || {};
      if (Date.now() - (meta.lastOpenedAt || meta.savedAt || 0) > _SAVED_COPY_MAX_AGE_MS) stale[m[1]] = true;
    }
  } catch (e) {
    return;
  }
  _removeLocalKeys(function (key) {
    var m = key.match(/^gb-.+-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
    return !!m && !!stale[m[1]];
  });
}

/* Browser storage is full: remove the saved copy opened longest ago, never
   the open class, and never while writes wait in the outbox (it shares the
   same storage). Returns true when something was removed. */
function _evictOldestSavedCopy(keepCid) {
  if (_hasUnsentWrites()) return false;
  var oldest = null;
  var oldestAt = Infinity;
  try {
    for (var i = 0; i < localStorage.length; i++) {
      var key = localStorage.key(i);
      var m = key && key.match(/^gb-bundle-meta-(.+)$/);
      if (!m || m[1] === keepCid || m[1] === getActiveCourse()) continue;
      var meta = _safeParseLS(key, null) || {};
      var at = meta.lastOpenedAt || meta.savedAt || 0;
      if (at < oldestAt) {
        oldestAt = at;
        oldest = m[1];
      }
    }
  } catch (e) {
    return false;
  }
  if (!oldest) return false;
  _removeLocalKeys(function (key) {
    return key.startsWith('gb-') && key.endsWith('-' + oldest);
  });
  delete _classVersion[oldest];
  return true;
}

/* get_class_bundle doesn't compute grades, including the "calculated" level
   shown beside a teacher override. Work it out here, as setting an override
   does (calc.js). */
function _fillOverrideCalculated(cid) {
  var overrides = _cache.overrides[cid];
  if (!overrides || typeof getSectionProficiencyRaw !== 'function' || !COURSES[cid]) return;
  if (typeof clearProfCache === 'function') clearProfCache();
  var changed = false;
  Object.keys(overrides).forEach(function (sid) {
    Object.keys(overrides[sid] || {}).forEach(function (sectionId) {
      var o = overrides[sid][sectionId];
      if (!o || o.calculated != null) return;
      try {
        // As calc.js saves it (setSectionOverride): the printed figure.
        o.calculated = printedLevel(getSectionProficiencyRaw(cid, sid, sectionId));
        changed = true;
      } catch (e) {
        console.warn('Could not work out the calculated level for an override:', e);
      }
    });
  });
  if (changed) _persistLoadedField(cid, 'overrides', overrides);
}

/* Term ratings from the server, merged into this device's copy. The server's
   fields win; the nine "dims" the old questionnaire rated were never stored
   on the server, so this device keeps its own (read by old reports only).
   The six habits and the approval are on the server since Oct 28 2026; the
   reporting basis and the IE deadline since Oct 31 2026, and what an
   approved comment was built from (draft_meta) after it (a server without
   those columns sends none, and this device's copy is kept). A
   rating this device has and the server doesn't was written while saves
   never reached the server (term ids read as NaN until Oct 2026): it is sent
   now, once. */
function _applyBundleTermRatings(cid, rows) {
  var local = _cloneValue(getTermRatings(cid) || {}) || {};
  var onServer = {};
  var withdrawn = _withdrawnIds(cid);
  Object.keys(withdrawn).forEach(function (sid) {
    delete local[sid];
  });
  rows.forEach(function (r) {
    if (!r || !r.enrollment_id || !r.term || withdrawn[r.enrollment_id]) return;
    var termId = 'term-' + r.term;
    onServer[r.enrollment_id + '|' + termId] = true;
    if (!local[r.enrollment_id]) local[r.enrollment_id] = {};
    var prev = local[r.enrollment_id][termId] || {};
    local[r.enrollment_id][termId] = Object.assign({}, prev, {
      narrative: r.narrative_html || '',
      habits: r.habits && typeof r.habits === 'object' ? r.habits : {},
      approvedAt: r.approved_at || null,
      reportingBasis: 'reporting_basis' in r ? r.reporting_basis || 'grade' : prev.reportingBasis || 'grade',
      ieDeadline:
        'ie_deadline' in r ? (r.ie_deadline ? String(r.ie_deadline).slice(0, 10) : null) : prev.ieDeadline || null,
      draftMeta:
        'draft_meta' in r
          ? r.draft_meta && typeof r.draft_meta === 'object'
            ? r.draft_meta
            : null
          : prev.draftMeta || null,
      workHabits: r.work_habits_rating || 0,
      participation: r.participation_rating || 0,
      socialTraits: r.social_traits || [],
      strengths: r.strength_tags || [],
      growthAreas: r.growth_tags || [],
      mentionAssessments: r.mention_assessments || [],
      mentionObs: r.mention_observations || [],
      created: r.created_at || prev.created,
      modified: r.updated_at || prev.modified,
    });
  });
  _persistLoadedField(cid, 'termRatings', local);

  if (!_writesEnabled() || !window.v2 || typeof window.v2.saveTermRating !== 'function') return;
  Object.keys(local).forEach(function (sid) {
    if (!_isUuid(sid)) return;
    Object.keys(local[sid] || {}).forEach(function (termId) {
      if (onServer[sid + '|' + termId]) return;
      var t = _termNumber(termId);
      var payload = _termRatingPatch(local[sid][termId]);
      var hasContent = Object.keys(payload).some(function (k) {
        var v = payload[k];
        if (Array.isArray(v)) return v.length > 0;
        if (v && typeof v === 'object') return Object.keys(v).length > 0;
        return !!v;
      });
      if (t >= 1 && t <= 6 && hasContent) window.v2.saveTermRating(sid, t, payload);
    });
  });
}

/* The grading scale and category weights saved on the server replace this
   device's. One only this device has was saved before the server stored
   them, so it is sent up rather than dropped: a reset elsewhere saves the
   default scale, never null, so a null on the server always means "never
   saved". get_class_bundle's course_config carries only the scale and the
   weights; the reporting terms come on the course row (gradebook.course),
   so each field is read from course_config, else the course row. Reading
   course_config alone lost a class's terms on every fresh sign-in. */
var _COURSE_CONFIG_COLUMNS = {
  gradingScale: 'grading_scale',
  categoryWeights: 'category_weights',
  reportingTerms: 'reporting_terms',
};
/* The class's BC Curriculum Link from the bundle's course row. Null there
   means never saved on the server: this device's link stays, and the next
   boot sends it up (_sendUpCurriculumTags). */
function _applyBundleCurriculumTags(cid, courseRow) {
  if (!courseRow || !Array.isArray(courseRow.curriculum_tags) || !COURSES[cid]) return;
  COURSES[cid].curriculumTags = courseRow.curriculum_tags.slice();
  _safeLSSet('gb-courses', JSON.stringify(COURSES));
}

/* What this device has changed on a class's row and the server has not
   yet taken: the patches of its queued update_course writes, later over
   earlier. A load lays them back over the server's row, so a change made
   here is never shown undone by a load that ran before it was sent. Only
   writes that say they carry what the teacher changed and nothing else
   (FV_SETTINGS_CHANGED_ONLY): not a whole copy an earlier build queued, and
   not the student page's two settings, which have their own rules. */
function _unsentCourseChanges(cid) {
  return (cid && _unsentCourseChangesByClass()[cid]) || {};
}
// The same for every class at once: cid → patch.
function _unsentCourseChangesByClass() {
  var byClass = {};
  var q = typeof window !== 'undefined' ? window.v2Queue : null;
  if (!q || typeof q.queued !== 'function') return byClass;
  var entries;
  try {
    entries = q.queued('update_course') || [];
  } catch (e) {
    return byClass;
  }
  entries.forEach(function (entry) {
    var p = (entry && entry.payload) || {};
    if (!p.p_course_id || !_plainObject(p.p_patch) || !p.p_patch[FV_SETTINGS_CHANGED_ONLY]) return;
    var out = byClass[p.p_course_id] || (byClass[p.p_course_id] = {});
    Object.keys(p.p_patch).forEach(function (col) {
      // Only the server's word turns the student page on or sets Return Grades.
      if (col === FV_SETTINGS_CHANGED_ONLY || col === 'student_page_enabled' || col === 'return_grades') return;
      out[col] = p.p_patch[col];
    });
  });
  return byClass;
}

/* Has this class's row never been updated since it was made? True only
   when the server says so itself: both times there, and the same. */
function _courseRowNeverUpdated(row) {
  return (
    _plainObject(row) &&
    typeof row.created_at === 'string' &&
    !!row.created_at &&
    typeof row.updated_at === 'string' &&
    row.updated_at === row.created_at
  );
}

// Does a settings save from an older build still wait in the outbox for this class?
function _oldSettingsSaveWaits(cid) {
  var q = typeof window !== 'undefined' ? window.v2Queue : null;
  if (!cid || !q || typeof q.queued !== 'function') return false;
  try {
    return (q.queued('update_course') || []).some(function (entry) {
      var p = (entry && entry.payload) || {};
      return p.p_course_id === cid && _isOldSettingsPatch(p.p_patch);
    });
  } catch (e) {
    return false;
  }
}

// What updateCourse counts its edits under (_localWrites): the class's own row.
var _COURSE_ROW_FIELD = 'courseRow';
/* The class's own row into the class list (COURSES), as list_teacher_courses
   fills it when the app opens (_canonicalCoursesToBlob). A class load used
   to leave these as they were, so a grading style, late work policy, name
   or method changed on another device showed only after the app was closed
   and opened again. */
function _applyBundleCourseRow(cid, courseRow) {
  if (!_plainObject(courseRow) || !COURSES || !COURSES[cid]) return;
  // Changed here while this load was on its way (updateCourse): the row is
  // from before that change, so it is left and the load runs again.
  if (_refreshMustSkip(cid, _COURSE_ROW_FIELD)) return;
  var row = Object.assign({}, courseRow, _unsentCourseChanges(cid));
  var course = COURSES[cid];
  var before = JSON.stringify(course);
  if ('name' in row) course.name = row.name || 'Untitled Class';
  if ('description' in row) course.description = row.description || '';
  if ('grade_level' in row) course.gradeLevel = row.grade_level || '';
  if ('color' in row) course.color = row.color || '';
  if ('grading_system' in row) course.gradingSystem = row.grading_system || null;
  if ('calc_method' in row) course.calcMethod = row.calc_method || null;
  if ('decay_weight' in row) course.decayWeight = row.decay_weight;
  if ('timezone' in row) course.timezone = row.timezone || null;
  if ('late_work_policy' in row) course.lateWorkPolicy = row.late_work_policy || null;
  if ('block' in row) course.block = row.block || '';
  if (JSON.stringify(course) === before) return;
  _safeLSSet('gb-courses', JSON.stringify(COURSES));
  if (typeof clearProfCache === 'function') clearProfCache();
}

/* The class's settings from the server replace this device's copy: the
   server's is the one true copy, and this one a working cache. Every
   setting the course row carries is taken from it, the calculation method
   and decay weight included: those two used to stay as this device last
   had them, so it went on grading with its own (shared/calc.js reads the
   settings copy first) and put them back on the server with its next save.
   A change this device has queued and not yet sent is laid over the row
   first (_unsentCourseChanges); one made while the load runs is kept by
   _persistLoadedField, and the load runs again. */
function _applyBundleCourseConfig(cid, row, courseRow) {
  // Cards Work Until is the student cards' own (getCardsWorkUntil), never a setting this device sends up.
  _noteCardsWorkUntil(cid, courseRow);
  // Send Work and Keep Photos Until, the server's (S5-W1): read from here, never sent from here.
  _noteCourseSendWork(cid, courseRow);
  // Reflect on Feedback and Show My Learning, the same (S10-W1).
  _noteCourseFeedbackOptions(cid, courseRow);
  if (!row || typeof row !== 'object') return;
  var config = Object.assign({}, getCourseConfig(cid) || {});
  var missing = {};
  var hasCourseRow = !!courseRow && typeof courseRow === 'object';
  var unsent = _unsentCourseChanges(cid);
  var serverRow = courseRow; // as the server sent it, before this device's unsent changes
  if (hasCourseRow) courseRow = Object.assign({}, courseRow, unsent);
  // A setting only this device has is sent up, unless a save of this
  // class's settings was discarded (or an older one still waits to be
  // weighed): then nothing of that save may reach the server, and the
  // server's "never set" stands here too.
  var sendUp = !(_classMeta(cid) || {}).noSendUp && !_oldSettingsSaveWaits(cid);
  Object.keys(_COURSE_CONFIG_COLUMNS).forEach(function (field) {
    var column = _COURSE_CONFIG_COLUMNS[field];
    var onServer = column in unsent ? unsent[column] : row[column];
    if (onServer == null && hasCourseRow) onServer = courseRow[column];
    if (onServer && typeof onServer === 'object') config[field] = _cloneValue(onServer);
    else if (config[field] != null) {
      if (sendUp) missing[column] = config[field];
      else delete config[field];
    }
  });
  // The calculation method and decay weight come on the course row. The
  // server never holds null for the method; a null weight is the default.
  //
  // One case keeps this device's instead and sends it up, once: the row
  // has never been updated since it was made (updated_at is created_at).
  // Then no computer has ever changed a setting of this class on the
  // server, so a method this device holds that differs from the row's is
  // not an old copy of something changed elsewhere: it is one the server
  // never got. That is a class restored from a backup by the build before
  // this fix, which sent the server Average 65% whatever the backup's
  // settings said (shared/backup-restore.js restoredCourse) and counted on
  // the next settings save to put it right. Any update of the row since
  // (by any computer, of any setting) ends this: the server's then wins.
  var neverUpdated = _courseRowNeverUpdated(serverRow) && sendUp;
  if (hasCourseRow && 'calc_method' in courseRow) {
    var rowMethod = typeof courseRow.calc_method === 'string' && courseRow.calc_method ? courseRow.calc_method : null;
    if (neverUpdated && typeof config.calcMethod === 'string' && config.calcMethod && config.calcMethod !== rowMethod) {
      missing.calc_method = config.calcMethod;
    } else if (rowMethod) config.calcMethod = rowMethod;
    else delete config.calcMethod;
  }
  if (hasCourseRow && 'decay_weight' in courseRow) {
    var rowDecay =
      courseRow.decay_weight != null && isFinite(Number(courseRow.decay_weight))
        ? Number(courseRow.decay_weight)
        : null;
    var myDecay =
      config.decayWeight != null && isFinite(Number(config.decayWeight)) ? Number(config.decayWeight) : null;
    if (neverUpdated && myDecay != null && myDecay !== rowDecay) missing.decay_weight = myDecay;
    else if (rowDecay != null) config.decayWeight = rowDecay;
    else delete config.decayWeight;
  }
  // "Round to a whole %" comes on the course row. Null there means the class
  // never chose, so it follows its grade level.
  if (courseRow && typeof courseRow === 'object' && 'round_percent' in courseRow) {
    if (typeof courseRow.round_percent === 'boolean') config.roundPercent = courseRow.round_percent;
    else if (typeof config.roundPercent === 'boolean') {
      if (sendUp) missing.round_percent = config.roundPercent;
      else delete config.roundPercent;
    }
  }
  // "Count Only the Most Recent N" comes on the course row too. Null there is
  // All Scores, a choice, so the server's value always wins.
  if (courseRow && typeof courseRow === 'object' && 'recent_score_limit' in courseRow) {
    if (Number(courseRow.recent_score_limit) >= 1) config.recentScoreLimit = Number(courseRow.recent_score_limit);
    else delete config.recentScoreLimit;
  }
  // Rubric Levels (level_order) comes on the course row. The server never
  // holds null there, so its value always wins; a bundle from before the
  // column reads as Extending first.
  if (courseRow && typeof courseRow === 'object' && 'level_order' in courseRow) {
    config.levelOrder = courseRow.level_order === 'asc' ? 'asc' : 'desc';
  }
  // Folders Count as One comes on the course row. The server never holds
  // null there; a bundle from before the column reads as on.
  if (courseRow && typeof courseRow === 'object' && 'folders_count_as_one' in courseRow) {
    if (courseRow.folders_count_as_one === false) config.foldersCountAsOne = false;
    else delete config.foldersCountAsOne;
  }
  // Each Course Counts Equally, the same way; a bundle from before the
  // column reads as off.
  if (courseRow && typeof courseRow === 'object' && 'courses_count_equally' in courseRow) {
    if (courseRow.courses_count_equally === true) config.coursesCountEqually = true;
    else delete config.coursesCountEqually;
  }
  // The student page's build switch and Return Grades come on the course row
  // (migrations/2026110902_grade_return.sql). The server never holds null
  // for the switch; a bundle from before the column reads as off. Return
  // Grades is 'on_return', 'on_save' or null for no choice made: the key is
  // always written, null included, so a class whose settings came from the
  // server can be told from one whose saved copy is from before the column
  // (saveCourseConfig sends Return Grades only when it knows it).
  var hasSwitch = !!courseRow && typeof courseRow === 'object' && 'student_page_enabled' in courseRow;
  if (hasSwitch) {
    if (courseRow.student_page_enabled === true) config.student_page_enabled = true;
    else delete config.student_page_enabled;
  }
  if (courseRow && typeof courseRow === 'object' && 'return_grades' in courseRow) {
    var returnChoice = courseRow.return_grades;
    config.return_grades = returnChoice === 'on_return' || returnChoice === 'on_save' ? returnChoice : null;
  }
  _persistLoadedField(cid, 'courseConfigs', config);
  // The server's word on the switch, kept apart from the settings object
  // (_serverSaysStudentPage). Only when these settings were taken: a load
  // that left them alone for a newer change here is run again.
  if (hasSwitch && _cache.courseConfigs[cid] === config) {
    _setServerStudentPage(cid, courseRow.student_page_enabled === true);
  }
  // The server's settings are this device's now: the lock a discarded save
  // left comes off.
  if (_cache.courseConfigs[cid] === config && (_classMeta(cid) || {}).noSendUp) {
    _saveClassMeta(cid, { noSendUp: false });
  }

  if (!Object.keys(missing).length || !_writesEnabled() || !_isUuid(cid)) return;
  missing[FV_SETTINGS_CHANGED_ONLY] = true;
  _trackPendingSync(
    _writeRpc('update_course', { p_course_id: cid, p_patch: missing }).then(function (res) {
      if (res.error) console.warn('update_course (course config upload) failed:', res.error);
    }),
  );
}

/* A class load failed. Nothing is written: the copy this device already has
   (memory, else localStorage) stays on screen. The sync dot turns red and
   says so (CLAUDE.md rule 5: no toast, which covered Save buttons and Undo
   toasts and outlasted class changes), and the load is tried again on its
   own; a click on the dot tries at once.
   This used to write an empty class over localStorage and the server
   baseline, so one failed request blanked the class and the next save
   diffed against "the server has nothing". */
var _loadError = {}; // cid → { at, message }
function _courseLoadFailed(cid, error) {
  var message = (error && (error.message || error.details)) || String(error || 'unknown error');
  // A class deleted on another device is removed when the class list loads,
  // not here: an unauthenticated call also reads as "not found".
  // The class bundle (get_class_bundle) or, where it is missing, get_gradebook.
  console.warn('The class load failed for ' + cid + '; keeping the saved copy:', error);
  _loadError[cid] = { at: Date.now(), message: message };
  if (_cache.students[cid] === undefined) _loadCourseFromLS(cid);
  // The dot must never be what breaks a load. A class loaded in the
  // background shows nothing: the dot speaks for the class that is open.
  try {
    _updateSyncIndicator();
  } catch (e) {
    console.warn('Could not show the load problem on the sync dot:', e);
  }
  _scheduleLoadRetry(cid);
}

/* Tries a failed load again after 15 s, 30 s, 1 minute, then every
   2 minutes, while that class stays open and the problem lasts. */
var _LOAD_RETRY_DELAYS_MS = [15000, 30000, 60000, 120000];
var _loadRetryTimer = null;
var _loadRetryCount = 0;
function _scheduleLoadRetry(cid) {
  if (_loadRetryTimer || cid !== getActiveCourse()) return;
  var delay = _LOAD_RETRY_DELAYS_MS[Math.min(_loadRetryCount, _LOAD_RETRY_DELAYS_MS.length - 1)];
  _loadRetryCount += 1;
  _loadRetryTimer = setTimeout(function () {
    _loadRetryTimer = null;
    if (!_loadError[cid] || cid !== getActiveCourse()) return;
    _handleExternalCourseUpdate(cid, 'gradebook');
  }, delay);
}

function _clearLoadError(cid) {
  if (!_loadError[cid]) return;
  delete _loadError[cid];
  if (cid === getActiveCourse()) {
    _loadRetryCount = 0;
    if (_loadRetryTimer) {
      clearTimeout(_loadRetryTimer);
      _loadRetryTimer = null;
    }
  }
  _updateSyncIndicator();
}

/* The sync dot's words while the open class couldn't load, or null. */
function _loadProblem() {
  var cid = typeof getActiveCourse === 'function' ? getActiveCourse() : null;
  if (!cid || !_loadError[cid]) return null;
  var text = "Couldn't load the latest data for this class. " + _savedCopyDescription(cid);
  return window.__MOBILE ? text + ' Pull down to try again.' : text + ' Click the dot to try again.';
}

function _savedCopyDescription(cid) {
  var meta = typeof _classMeta === 'function' ? _classMeta(cid) : null;
  if (!meta || !meta.savedAt) return 'Showing your saved copy.';
  var saved = new Date(meta.savedAt);
  var sameDay = saved.toDateString() === new Date().toDateString();
  var when = sameDay
    ? saved.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : saved.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return 'Showing your copy saved ' + (sameDay ? 'at ' : 'on ') + when + '.';
}

function retryActiveCourseLoad() {
  var cid = getActiveCourse();
  if (cid) return _handleExternalCourseUpdate(cid, 'gradebook');
  return Promise.resolve();
}
window.retryActiveCourseLoad = retryActiveCourseLoad;

function courseLoadFailed(cid) {
  return !!(cid && _loadError[cid]);
}

function _loadCourseFromLS(cid) {
  _cache.students[cid] = _safeParseLS('gb-students-' + cid, []).map(migrateStudent);
  _cache.assessments[cid] = _safeParseLS('gb-assessments-' + cid, []);
  _cache.scores[cid] = _safeParseLS('gb-scores-' + cid, {});
  _cache.overrides[cid] = _safeParseLS('gb-overrides-' + cid, {});
  _cache.notes[cid] = _safeParseLS('gb-notes-' + cid, {});
  _cache.flags[cid] = _safeParseLS('gb-flags-' + cid, {});
  _cache.goals[cid] = _safeParseLS('gb-goals-' + cid, {});
  _cache.reflections[cid] = _safeParseLS('gb-reflections-' + cid, {});
  _cache.statuses[cid] = _safeParseLS('gb-statuses-' + cid, {});
  _cache.observations[cid] = _safeParseLS('gb-quick-obs-' + cid, {});
  _cache.termRatings[cid] = _safeParseLS('gb-term-ratings-' + cid, {});
  _cache.customTags[cid] = _safeParseLS('gb-custom-tags-' + cid, []);
  _cache.courseConfigs[cid] = _safeParseLS('gb-courseconfig-' + cid, {});
  _noteSettingsRead(cid);
  _cache.reportConfig[cid] = _safeParseLS('gb-report-config-' + cid, null);
  _cache.studentProfileSummaries[cid] = _safeParseLS('gb-student-profile-summaries-' + cid, {});
  _cache.withdrawn[cid] = _safeParseLS('gb-withdrawn-' + cid, []);
  _cache.rubrics[cid] = _safeParseLS('gb-rubrics-' + cid, []);
  _noteRubricsSet(cid);
  _cache.rubricChecks[cid] = _safeParseLS('gb-rubric-checks-' + cid, {});
  _cache.rubricPrints[cid] = _safeParseLS('gb-rubric-prints-' + cid, {});
  delete _cache.gradeReturns[cid]; // read again when asked for (getGradeReturns)
  delete _serverStudentPage[cid]; // and the server's word on its student page (_serverSaysStudentPage)

  // Learning map: check localStorage first, then fall back to LEARNING_MAP constant
  const lmRaw = _safeParseLS('gb-learningmap-' + cid, null);
  if (lmRaw && lmRaw._customized) {
    _cache.learningMaps[cid] = lmRaw;
  } else {
    _cache.learningMaps[cid] = _builtInLearningMap(cid);
  }

  // Modules: try new key, fall back to legacy 'gb-units-' key
  let modData = _safeParseLS('gb-modules-' + cid, null);
  if (!modData) {
    modData = _safeParseLS('gb-units-' + cid, null);
    if (modData) {
      _safeLSSet('gb-modules-' + cid, JSON.stringify(modData));
      localStorage.removeItem('gb-units-' + cid);
    }
  }
  _cache.modules[cid] = modData || [];
}

function _safeParseLS(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    console.warn('LS read fallback:', e);
    return fallback;
  }
}

function _safeLSSet(key, value) {
  try {
    localStorage.setItem(key, value);
    _storageSaved(key);
    return true;
  } catch (e) {
    var keyClass = /^gb-/.test(key) && key.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
    if (e.name === 'QuotaExceededError' && /^gb-/.test(key) && _evictOldestSavedCopy(keyClass ? keyClass[1] : null)) {
      try {
        localStorage.setItem(key, value);
        _storageSaved(key);
        return true;
      } catch (retryError) {
        e = retryError;
      }
    }
    console.warn('localStorage write failed (' + key + '):', e);
    // Every quota failure counts until that key saves again; the sync dot
    // says so (getSaveProblem).
    if (e.name === 'QuotaExceededError' && !_storageFullKeys.has(key)) {
      _storageFullKeys.add(key);
      _saveProblemChanged();
    }
    return false;
  }
}

function _storageSaved(key) {
  if (_storageFullKeys.delete(key)) _saveProblemChanged();
}

function _loadCoursesFromLS() {
  try {
    const stored = JSON.parse(localStorage.getItem('gb-courses'));
    if (stored && Object.keys(stored).length > 0) return stored;
  } catch (e) {
    console.warn('Courses parse error:', e);
  }
  // Demo Mode's class is in shared/seed-data.js, loaded only in Demo Mode:
  // anywhere else nothing stored means no classes.
  return typeof DEFAULT_COURSES !== 'undefined' ? structuredClone(DEFAULT_COURSES) : {};
}

// Demo Mode's built-in learning map for its class (LEARNING_MAP, in
// shared/seed-data.js), else an empty map.
function _builtInLearningMap(cid) {
  return (typeof LEARNING_MAP !== 'undefined' && LEARNING_MAP[cid]) || { subjects: [], sections: [] };
}

/* Fields that affect proficiency calculations */
const _PROF_FIELDS = [
  'scores',
  'categories',
  'assessments',
  'overrides',
  'statuses',
  'courseConfigs',
  'learningMaps',
  'rubrics',
];

/* Blob→rows converters for generic bulk sync (delete-all + insert pattern) */
const _BULK_SYNC_CONVERTERS = {
  goals: _goalsBlobToRows,
  reflections: _reflectionsBlobToRows,
  overrides: _overridesBlobToRows,
  statuses: _statusesBlobToRows,
  student_notes: _notesBlobToRows,
  student_flags: _flagsBlobToRows,
  term_ratings: _termRatingsBlobToRows,
};

/* Rows→blob converters for loading from normalized tables */
const _BULK_LOAD_CONVERTERS = {
  goals: _goalsRowsToBlob,
  reflections: _reflectionsRowsToBlob,
  overrides: _overridesRowsToBlob,
  statuses: _statusesRowsToBlob,
  student_notes: _notesRowsToBlob,
  student_flags: _flagsRowsToBlob,
  term_ratings: _termRatingsRowsToBlob,
};

/* Cache field → table name for medium-frequency normalized tables */
const _MEDIUM_FREQ_TABLES = {
  goals: 'goals',
  reflections: 'reflections',
  overrides: 'overrides',
  statuses: 'statuses',
  notes: 'student_notes',
  flags: 'student_flags',
  termRatings: 'term_ratings',
};

/* Config tables: single JSONB blob per course, teacher_id in PK */
const _CONFIG_TABLES = {
  learningMaps: 'config_learning_maps',
  courseConfigs: 'config_course',
  modules: 'config_modules',
  rubrics: 'config_rubrics',
  customTags: 'config_custom_tags',
  reportConfig: 'config_report',
};

/* Fields stored in their own normalized tables */
const _NORMALIZED_TABLES = {
  scores: 'scores',
  observations: 'observations',
  assessments: 'assessments',
  students: 'students',
  goals: 'goals',
  reflections: 'reflections',
  overrides: 'overrides',
  statuses: 'statuses',
  notes: 'student_notes',
  flags: 'student_flags',
  termRatings: 'term_ratings',
  learningMaps: 'config_learning_maps',
  courseConfigs: 'config_course',
  modules: 'config_modules',
  rubrics: 'config_rubrics',
  customTags: 'config_custom_tags',
  reportConfig: 'config_report',
};

/* Helper: write to cache + sync */
function _saveCourseField(field, cid, value) {
  _cache[field][cid] = value;
  if (field === 'rubrics') _noteRubricsSet(cid);
  if (_PROF_FIELDS.includes(field) && typeof clearProfCache === 'function') clearProfCache();
  delete _returnedSets[cid]; // Draft and Returned: the returned set is built again
  _markLocalWrite(field, cid);
  // Persist to localStorage (primary store in v2; remote writes happen through
  // the dispatcher functions at each save site, not via this field-save path).
  var dataKey = _DATA_KEYS[field];
  var lsOk = true;
  if (dataKey) lsOk = _safeLSSet('gb-' + dataKey + '-' + cid, JSON.stringify(value));
  _broadcastChange(cid, field);
  return lsOk;
}

function _loadPersistedCourseFieldSnapshot(field, cid, fallbackValue) {
  var dataKey = _DATA_KEYS[field];
  if (dataKey) {
    try {
      var raw = localStorage.getItem('gb-' + dataKey + '-' + cid);
      if (raw) return JSON.parse(raw);
    } catch (e) {
      /* fall through to clone fallback */
    }
  }
  try {
    return structuredClone(fallbackValue);
  } catch (e) {
    if (Array.isArray(fallbackValue)) {
      return fallbackValue.map(function (item) {
        return item && typeof item === 'object' ? Object.assign({}, item) : item;
      });
    }
    return Object.assign({}, fallbackValue || {});
  }
}

/* Convert v2 list_teacher_courses() response → COURSES blob shape.
   v2 row:       { id, name, grade_level, description, color, is_archived,
                   display_order, grading_system, calc_method, decay_weight,
                   timezone, late_work_policy, created_at, updated_at }
   App shape:    { [id]: { id, name, gradeLevel, description, color, archived,
                           displayOrder, gradingSystem, calcMethod, decayWeight,
                           timezone, lateWorkPolicy } }
   Policy fields (gradingSystem/calcMethod/decayWeight/lateWorkPolicy/timezone)
   are populated here; legacy get_course_policy() is retired in v2.
   curriculumTags (the BC Curriculum Link, e.g. ['HIST12']) is the server's
   curriculum_tags (migrations/20261102_course_curriculum_tags.sql). Null
   there means the link was never saved on the server, so a link this device
   kept from before (`prev`) stays, and _sendUpCurriculumTags saves it. */
function _canonicalCoursesToBlob(rows, prev) {
  var out = {};
  var unsent = _unsentCourseChangesByClass();
  (rows || []).forEach(function (r) {
    if (!r || !r.id) return;
    var mine = prev && prev[r.id] && Array.isArray(prev[r.id].curriculumTags) ? prev[r.id].curriculumTags : [];
    // A change made on this device and not yet sent (a name or grading
    // style changed offline) stays: the server's row is from before it.
    r = Object.assign({}, r, unsent[r.id]);
    out[r.id] = {
      id: r.id,
      name: r.name || 'Untitled Class',
      description: r.description || '',
      gradeLevel: r.grade_level || '',
      color: r.color || '',
      archived: !!r.is_archived,
      displayOrder: r.display_order != null ? r.display_order : 0,
      gradingSystem: r.grading_system || null,
      calcMethod: r.calc_method || null,
      decayWeight: r.decay_weight,
      timezone: r.timezone || null,
      lateWorkPolicy: r.late_work_policy || null,
      block: r.block || '',
      curriculumTags: Array.isArray(r.curriculum_tags) ? r.curriculum_tags.slice() : mine.slice(),
    };
  });
  return out;
}

/* A link only this device holds (saved before the server stored it) goes
   up once, so the class shows it on every device. */
function _sendUpCurriculumTags(rows, prev) {
  if (!_writesEnabled()) return;
  (rows || []).forEach(function (r) {
    if (!r || !_isUuid(r.id) || Array.isArray(r.curriculum_tags)) return;
    var mine = prev && prev[r.id] && prev[r.id].curriculumTags;
    if (!Array.isArray(mine) || !mine.length) return;
    _trackPendingSync(
      _writeRpc('update_course', { p_course_id: r.id, p_patch: { curriculum_tags: mine.slice() } }).then(
        function (res) {
          if (res.error) console.warn('update_course (curriculum link upload) failed:', res.error);
        },
      ),
    );
  });
}

function _coursesBeforeBoot() {
  if (_cache.courses && Object.keys(_cache.courses).length) return _cache.courses;
  try {
    return JSON.parse(localStorage.getItem('gb-courses') || '{}') || {};
  } catch (e) {
    return {};
  }
}

/* ── Phase 4 converters: medium-frequency tables ── */

/* goals blob { sid: { tagId: "text" } } ↔ rows */
function _goalsBlobToRows(cid, obj) {
  var rows = [];
  for (var sid in obj) {
    for (var tagId in obj[sid]) {
      rows.push({
        teacher_id: _teacherId,
        course_id: cid,
        student_id: sid,
        tag_id: tagId,
        text: obj[sid][tagId] || '',
        updated_at: new Date().toISOString(),
      });
    }
  }
  return rows;
}
function _goalsRowsToBlob(rows) {
  var blob = {};
  (rows || []).forEach(function (r) {
    if (!blob[r.student_id]) blob[r.student_id] = {};
    blob[r.student_id][r.tag_id] = r.text || '';
  });
  return blob;
}

/* reflections blob { sid: { tagId: { confidence, text, date } } } ↔ rows */
function _reflectionsBlobToRows(cid, obj) {
  var rows = [];
  for (var sid in obj) {
    for (var tagId in obj[sid]) {
      var v = obj[sid][tagId] || {};
      rows.push({
        teacher_id: _teacherId,
        course_id: cid,
        student_id: sid,
        tag_id: tagId,
        confidence: v.confidence || 0,
        text: v.text || '',
        date: v.date || '',
        updated_at: new Date().toISOString(),
      });
    }
  }
  return rows;
}
function _reflectionsRowsToBlob(rows) {
  var blob = {};
  (rows || []).forEach(function (r) {
    if (!blob[r.student_id]) blob[r.student_id] = {};
    blob[r.student_id][r.tag_id] = { confidence: r.confidence || 0, text: r.text || '', date: r.date || '' };
  });
  return blob;
}

/* overrides blob { sid: { tagId: { level, reason, date, calculated } } } ↔ rows */
function _overridesBlobToRows(cid, obj) {
  var rows = [];
  for (var sid in obj) {
    for (var tagId in obj[sid]) {
      var v = obj[sid][tagId] || {};
      rows.push({
        teacher_id: _teacherId,
        course_id: cid,
        student_id: sid,
        tag_id: tagId,
        level: v.level || 0,
        reason: v.reason || '',
        date: v.date || '',
        calculated: v.calculated || 0,
        updated_at: new Date().toISOString(),
      });
    }
  }
  return rows;
}
function _overridesRowsToBlob(rows) {
  var blob = {};
  (rows || []).forEach(function (r) {
    if (!blob[r.student_id]) blob[r.student_id] = {};
    var entry = { level: r.level || 0, reason: r.reason || '' };
    if (r.date) entry.date = r.date;
    if (r.calculated) entry.calculated = r.calculated;
    blob[r.student_id][r.tag_id] = entry;
  });
  return blob;
}

/* statuses blob { "sid:aid": "status" } ↔ rows */
function _statusesBlobToRows(cid, obj) {
  var rows = [];
  for (var compositeKey in obj) {
    var parts = compositeKey.split(':');
    if (parts.length < 2) continue;
    rows.push({
      teacher_id: _teacherId,
      course_id: cid,
      student_id: parts[0],
      assessment_id: parts.slice(1).join(':'),
      status: obj[compositeKey] || '',
      updated_at: new Date().toISOString(),
    });
  }
  return rows;
}
function _statusesRowsToBlob(rows) {
  var blob = {};
  (rows || []).forEach(function (r) {
    blob[r.student_id + ':' + r.assessment_id] = r.status || '';
  });
  return blob;
}

/* notes blob { sid: "text" } ↔ rows */
function _notesBlobToRows(cid, obj) {
  var rows = [];
  for (var sid in obj) {
    rows.push({
      teacher_id: _teacherId,
      course_id: cid,
      student_id: sid,
      text: obj[sid] || '',
      updated_at: new Date().toISOString(),
    });
  }
  return rows;
}
function _notesRowsToBlob(rows) {
  var blob = {};
  (rows || []).forEach(function (r) {
    blob[r.student_id] = r.text || '';
  });
  return blob;
}

/* flags blob { sid: true } ↔ rows */
function _flagsBlobToRows(cid, obj) {
  var rows = [];
  for (var sid in obj) {
    if (obj[sid])
      rows.push({ teacher_id: _teacherId, course_id: cid, student_id: sid, updated_at: new Date().toISOString() });
  }
  return rows;
}
function _flagsRowsToBlob(rows) {
  var blob = {};
  (rows || []).forEach(function (r) {
    blob[r.student_id] = true;
  });
  return blob;
}

/* termRatings blob { sid: { termId: { dims, narrative, created, modified } } } ↔ rows */
function _termRatingsBlobToRows(cid, obj) {
  var rows = [];
  for (var sid in obj) {
    for (var termId in obj[sid]) {
      var v = obj[sid][termId] || {};
      rows.push({
        teacher_id: _teacherId,
        course_id: cid,
        student_id: sid,
        term_id: termId,
        dims: v.dims || {},
        narrative: v.narrative || '',
        created_at: v.created || new Date().toISOString(),
        modified_at: v.modified || null,
        updated_at: new Date().toISOString(),
      });
    }
  }
  return rows;
}
function _termRatingsRowsToBlob(rows) {
  var blob = {};
  (rows || []).forEach(function (r) {
    if (!blob[r.student_id]) blob[r.student_id] = {};
    var entry = { dims: r.dims || {}, narrative: r.narrative || '', created: r.created_at || new Date().toISOString() };
    if (r.modified_at) entry.modified = r.modified_at;
    blob[r.student_id][r.term_id] = entry;
  });
  return blob;
}

/* Efficient single-score write — upserts one row to scores table + updates cache */
/* `mod` is the level's + or − (1 or −1). Leaving it out means none, so
   picking a level clears a + or − it had before. */
/* The type a new score is saved with. It follows the assessment the way
   calc.js buckets a score (getTagProficiency): work in a category counts
   as summative; otherwise the assessment's own type, formative when it has
   none. Desktop and phone both save through this, so a score saved on one
   reads the same on the other and after a reload. */
function scoreTypeFor(assessment) {
  if (!assessment) return 'summative';
  if (getAssessmentCategoryId(assessment)) return 'summative';
  return assessment.type || 'formative';
}

function _upsertScoreOne(cid, sid, aid, tid, scoreVal, date, type, note, mod) {
  var nextMod = normalizeScoreMod(scoreVal, mod);
  // Update cache blob
  const scores = getScores(cid);
  if (!scores[sid]) scores[sid] = [];
  const existing = scores[sid].find(function (e) {
    return e.assessmentId === aid && e.tagId === tid;
  });
  if (existing) {
    if (existing.score === scoreVal && (existing.mod || 0) === nextMod) return true; // no change
    existing.score = scoreVal;
    if (nextMod) existing.mod = nextMod;
    else delete existing.mod;
    if (date) existing.date = date;
    // Callers pass '' for "no comment given"; picking a level keeps the
    // overall comment (saveScoreComment is how it changes or clears).
    if (note) existing.note = note;
  } else {
    var entry = {
      id: sid + ':' + aid + ':' + tid,
      assessmentId: aid,
      tagId: tid,
      score: scoreVal,
      date: date || courseToday(cid),
      type: type || 'summative',
      note: note || '',
      created: new Date().toISOString(),
    };
    if (nextMod) entry.mod = nextMod;
    scores[sid].push(entry);
  }
  _cache.scores[cid] = scores;
  if (typeof clearProfCache === 'function') clearProfCache();
  var gradesWere = _gradeBefore(cid, 'scores');
  var lsOk = _safeLSSet('gb-scores-' + cid, JSON.stringify(scores));
  _gradeAfter(cid, gradesWere, scores);
  // A realtime refresh that started before this edit must not overwrite it.
  _markLocalWrite('scores', cid);

  var refusals = _writeRefusals;
  if (_writesEnabled()) {
    _persistScoreToCanonical(cid, sid, aid, tid, scoreVal, note, nextMod);
    // The outbox had no room: the server won't get this score, so the
    // baseline mustn't say it has, and the caller hears it didn't save.
    if (_writeRefusals !== refusals) return false;
    _rememberScoreCell(cid, sid, aid, tid, scores);
  }
  _broadcastChange(cid, 'scores');
  return lsOk;
}

/* Advance the scores baseline for one cell only. Taking the whole cache
   would also mark as sent any other cell whose write was rejected. */
function _rememberScoreCell(cid, sid, aid, tid, scores) {
  if (!_hasServerState('scores', cid)) return;
  var base = _serverState.scores[cid];
  var entries = (base[sid] || []).filter(function (e) {
    return !(e && e.assessmentId === aid && e.tagId === tid);
  });
  (scores[sid] || []).forEach(function (e) {
    if (e && e.assessmentId === aid && e.tagId === tid) entries.push(_cloneValue(e));
  });
  if (entries.length) base[sid] = entries;
  else delete base[sid];
}

/* A toast here confused teachers more than it helped (Oct 2026); failed
   writes stay in the outbox and the console. */
function _reportScoreWriteFailure(rpc, error) {
  console.warn(rpc + ' failed:', error);
}

/* v2 per-cell / per-tag / per-criterion score write. Rubric work is scored
   by criterion id (rubric_score); a competency key on rubric work is a stale
   entry from before 2026-10-29 and sends nothing, so it can never reach a
   criterion the teacher didn't touch.

   P6.4 audit (2026-05-01): every UI call site to upsertScore was traced and
   confirmed to pass (a) a truthy tid sourced from a tag column / data-tid /
   tagIds array, and (b) a numeric scoreVal (0 for clear, 1-4 for proficiency,
   integer ≥0 for points). The `_isUuid(tid)` and `intVal != null` checks
   below are therefore defensive: when tid is non-UUID we can't link a tag
   score to a non-existent canonical tag row anyway (skipping is correct);
   when intVal is null (only reachable from non-UI callers with explicit
   nulls, e.g. test fixtures) there's no value to write. Both conditions
   together represent "skip dispatch, but cache + LS still wrote correctly". */
function _persistScoreToCanonical(cid, sid, aid, tid, scoreVal, note, mod) {
  // A local id whose create is queued is sent too: the write waits behind
  // the create in the outbox and is re-keyed when it lands.
  if (!_isSendableId(sid) || !_isSendableId(aid)) return;
  var sb = getSupabase();
  if (!sb) return;
  var intVal = scoreVal === '' || scoreVal == null ? null : Number(scoreVal);

  if ((_isSendableId(tid) || isUnlinkedTag(tid)) && intVal != null) {
    var assessment = _assessmentById(cid, aid);
    var criterion = _rubricCriterionById(cid, assessment, tid);
    var assessmentTagIds = (assessment && (assessment.tagIds || assessment.tag_ids)) || [];
    var isAssessmentTag = assessmentTagIds.indexOf(tid) >= 0;
    var isPoints = isPointsScored(assessment);
    var isRubric = !isPoints && !!(assessment && (assessment.rubricId || assessment.rubric_id));
    var ops = [];
    var modifier = normalizeScoreMod(intVal, mod);
    // A criterion comment typed before the level was chosen waits in the
    // cache; it goes up with the level. Null leaves the server's comment.
    var criterionComment = _rubricCriterionCommentFor(cid, sid, aid, tid) || null;
    var criterionBeyond = _rubricCriterionNoteFor(cid, sid, aid, tid, 'critBeyond') || null;
    if (criterion) {
      ops.push({
        rpc: 'upsert_rubric_score',
        params: {
          p_enrollment_id: sid,
          p_assessment_id: aid,
          p_criterion_id: tid,
          p_value: intVal,
          p_modifier: modifier,
          p_comment: criterionComment,
          p_beyond: criterionBeyond,
        },
      });
    } else if (isRubric) {
      // A competency key on rubric work is a stale entry: nothing to send.
      // Any other key is a criterion this device can't match yet (the
      // rubric still loading, or attached in another tab): it goes up as
      // one, and the server checks it belongs to the assessment's rubric.
      if (isAssessmentTag || getTagById(cid, tid)) return;
      ops.push({
        rpc: 'upsert_rubric_score',
        params: {
          p_enrollment_id: sid,
          p_assessment_id: aid,
          p_criterion_id: tid,
          p_value: intVal,
          p_modifier: modifier,
          p_comment: criterionComment,
          p_beyond: criterionBeyond,
        },
      });
    } else if (isPoints || isUnlinkedTag(tid) || (assessment && !isAssessmentTag)) {
      // An unlinked assessment's single score. On proficiency work 0 clears
      // it; on points and Complete/Incomplete work 0 is a score.
      var cellValue = isUnlinkedTag(tid) && intVal === 0 && !isPointsScored(assessment) ? null : intVal;
      // A proficiency score as a whole takes + / − like a competency's
      // (score.modifier). Points work has none, so it sends none.
      var scoreParams = { p_enrollment_id: sid, p_assessment_id: aid, p_value: cellValue };
      if (!isPoints && cellValue != null) scoreParams.p_modifier = modifier;
      ops.push({ rpc: 'upsert_score', params: scoreParams });
    } else {
      ops.push({
        rpc: 'upsert_tag_score',
        params: {
          p_enrollment_id: sid,
          p_assessment_id: aid,
          p_tag_id: tid,
          p_value: intVal,
          p_modifier: modifier,
          p_comment: criterionComment,
        },
      });
    }
    ops.forEach(function (op) {
      _trackPendingSync(
        _writeRpc(op.rpc, op.params).then(function (res) {
          if (res.error) _reportScoreWriteFailure(op.rpc, res.error);
        }),
      );
    });
  }

  // Comment-only updates: route to save_score_comment (no value change). The
  // legacy per-tag comment is collapsed onto the parent score row in v2 —
  // comments live on Score, not on TagScore/RubricScore.
  if (note != null && note !== '') {
    _trackPendingSync(
      _writeRpc('save_score_comment', {
        p_enrollment_id: sid,
        p_assessment_id: aid,
        p_comment: note,
      }).then(function (res) {
        if (res.error) console.warn('save_score_comment failed:', res.error);
      }),
    );
  }
}

/* ── Rubric criterion notes ────────────────────────────────────────────
   Two notes on one criterion of a rubric assessment, printed under that
   row on the rubric handout (teacher/rubric-print.js):
   - the comment ("Work On" on a single-point rubric): rubric_score.comment,
     cached as `critNote`;
   - Went Beyond, single-point rubrics only: rubric_score.beyond, cached as
     `critBeyond`.
   Each is set on every score key the criterion fans out to. */
var _CRITERION_NOTE_PARAMS = { critNote: 'p_comment', critBeyond: 'p_beyond' };

/* The cached note (`field`) for the criterion holding score key `tid`. */
function _rubricCriterionNoteFor(cid, sid, aid, tid, field) {
  var entries = getScores(cid)[sid] || [];
  var entry = entries.find(function (e) {
    return e && e.assessmentId === aid && e.tagId === tid;
  });
  return entry && entry[field] ? entry[field] : '';
}
function _rubricCriterionCommentFor(cid, sid, aid, tid) {
  return _rubricCriterionNoteFor(cid, sid, aid, tid, 'critNote');
}

/* The criterion's note, from whichever of its keys holds one. */
function _getRubricCriterionNote(cid, sid, aid, criterion, field) {
  var keys = rubricCriterionScoreKeys(criterion);
  for (var i = 0; i < keys.length; i++) {
    var note = _rubricCriterionNoteFor(cid, sid, aid, keys[i], field);
    if (note) return note;
  }
  return '';
}
function getRubricCriterionComment(cid, sid, aid, criterion) {
  return _getRubricCriterionNote(cid, sid, aid, criterion, 'critNote');
}
function getRubricCriterionBeyond(cid, sid, aid, criterion) {
  return _getRubricCriterionNote(cid, sid, aid, criterion, 'critBeyond');
}

/* Save (or clear, with '') one note on one criterion. The cache changes at
   once and the server row follows; with no level yet the row holds only
   its notes (rubric_score.value null, migrations/20261027_score_comments.sql).
   The other note goes too, from the cache, as a level change sends both: the
   outbox keeps only the newest write to a criterion, so a Work On sent alone
   was lost behind a Went Beyond saved before it went. With none cached it is
   sent as null, which keeps the server's. */
function _saveRubricCriterionNote(cid, sid, aid, criterionId, text, field) {
  var assessment = _assessmentById(cid, aid);
  var criterion = _rubricCriterionById(cid, assessment, criterionId);
  if (!criterion) return false;
  var note = (text == null ? '' : String(text)).trim();
  var scores = getScores(cid);
  if (!scores[sid]) scores[sid] = [];
  var level = 0;
  var mod = 0;
  var changed = false;
  rubricCriterionScoreKeys(criterion).forEach(function (tid) {
    var entry = scores[sid].find(function (e) {
      return e && e.assessmentId === aid && e.tagId === tid;
    });
    if (!entry) {
      if (!note) return;
      entry = {
        id: sid + ':' + aid + ':' + tid,
        assessmentId: aid,
        tagId: tid,
        score: 0,
        date: (assessment && assessment.date) || courseToday(cid),
        type: scoreTypeFor(assessment),
        note: '',
        created: new Date().toISOString(),
      };
      scores[sid].push(entry);
    }
    if ((entry[field] || '') !== note) changed = true;
    if (note) entry[field] = note;
    else delete entry[field];
    if (Number(entry.score) > 0 && !level) {
      level = Number(entry.score);
      mod = normalizeScoreMod(level, entry.mod);
    }
  });
  if (!changed) return true;
  _cache.scores[cid] = scores;
  var gradesWere = _gradeBefore(cid, 'scores');
  var lsOk = _safeLSSet('gb-scores-' + cid, JSON.stringify(scores));
  _gradeAfter(cid, gradesWere, scores);
  _markLocalWrite('scores', cid);
  if (_writesEnabled() && _isSendableId(sid) && _isSendableId(aid) && _isSendableId(criterionId)) {
    var params = {
      p_enrollment_id: sid,
      p_assessment_id: aid,
      p_criterion_id: criterionId,
      p_value: level || null,
      p_modifier: mod,
    };
    Object.keys(_CRITERION_NOTE_PARAMS).forEach(function (f) {
      params[_CRITERION_NOTE_PARAMS[f]] =
        f === field ? note : _getRubricCriterionNote(cid, sid, aid, criterion, f) || null;
    });
    _trackPendingSync(
      _writeRpc('upsert_rubric_score', params).then(function (res) {
        if (res.error) _reportScoreWriteFailure('upsert_rubric_score', res.error);
      }),
    );
    rubricCriterionScoreKeys(criterion).forEach(function (tid) {
      _rememberScoreCell(cid, sid, aid, tid, scores);
    });
  }
  _broadcastChange(cid, 'scores');
  return lsOk;
}
function _saveRubricCriterionCommentOne(cid, sid, aid, criterionId, text) {
  return _saveRubricCriterionNote(cid, sid, aid, criterionId, text, 'critNote');
}
function _saveRubricCriterionBeyondOne(cid, sid, aid, criterionId, text) {
  return _saveRubricCriterionNote(cid, sid, aid, criterionId, text, 'critBeyond');
}

/* ── Competency comments ───────────────────────────────────────────────
   Feedback on one competency of work scored by competency levels (no
   rubric). It lives on tag_score.comment and, in the cache, as `critNote`
   on that competency's score entry, like a criterion's comment. */
function getTagComment(cid, sid, aid, tagId) {
  return _rubricCriterionCommentFor(cid, sid, aid, tagId);
}

/* Save (or clear, with '') a competency's comment. With no level yet the
   server row holds only the comment (tag_score.value null). */
function _saveTagCommentOne(cid, sid, aid, tagId, text) {
  var assessment = _assessmentById(cid, aid);
  var note = (text == null ? '' : String(text)).trim();
  var scores = getScores(cid);
  if (!scores[sid]) scores[sid] = [];
  var entry = scores[sid].find(function (e) {
    return e && e.assessmentId === aid && e.tagId === tagId;
  });
  if ((entry && entry.critNote ? entry.critNote : '') === note) return true;
  if (!entry) {
    entry = {
      id: sid + ':' + aid + ':' + tagId,
      assessmentId: aid,
      tagId: tagId,
      score: 0,
      date: (assessment && assessment.date) || courseToday(cid),
      type: scoreTypeFor(assessment),
      note: '',
      created: new Date().toISOString(),
    };
    scores[sid].push(entry);
  }
  if (note) entry.critNote = note;
  else delete entry.critNote;
  var level = Number(entry.score) > 0 ? Number(entry.score) : 0;
  _cache.scores[cid] = scores;
  var gradesWere = _gradeBefore(cid, 'scores');
  var lsOk = _safeLSSet('gb-scores-' + cid, JSON.stringify(scores));
  _gradeAfter(cid, gradesWere, scores);
  _markLocalWrite('scores', cid);
  if (_writesEnabled() && _isSendableId(sid) && _isSendableId(aid) && _isSendableId(tagId)) {
    _trackPendingSync(
      _writeRpc('upsert_tag_score', {
        p_enrollment_id: sid,
        p_assessment_id: aid,
        p_tag_id: tagId,
        p_value: level || null,
        p_modifier: level ? normalizeScoreMod(level, entry.mod) : 0,
        p_comment: note,
      }).then(function (res) {
        if (res.error) _reportScoreWriteFailure('upsert_tag_score', res.error);
      }),
    );
    _rememberScoreCell(cid, sid, aid, tagId, scores);
  }
  _broadcastChange(cid, 'scores');
  return lsOk;
}

/* ── Overall comment ───────────────────────────────────────────────────
   The teacher's comment on a whole piece of work: score.comment on the
   server and, in the cache, the `note` every score entry of that student
   and assessment carries. The rubric handout prints it. */
function getScoreComment(cid, sid, aid) {
  var entry = (getScores(cid)[sid] || []).find(function (e) {
    return e && e.assessmentId === aid && e.note;
  });
  return entry ? String(entry.note) : '';
}

/* Change (or clear, with '') an overall comment. Work with no level or
   score yet gets an entry to carry it, under the key the loader gives a
   score row with no levels (_noteOnlyScoreKey); the server's
   save_score_comment makes the score row (value null) when there is none.
   On points and Complete/Incomplete work the entry's score is null, since
   a 0 there is a score. */
function _saveScoreCommentOne(cid, sid, aid, text) {
  var note = (text == null ? '' : String(text)).trim();
  var scores = getScores(cid);
  var entries = (scores[sid] || []).filter(function (e) {
    return e && e.assessmentId === aid;
  });
  if (!entries.length) {
    if (!note) return true;
    var assessment = _assessmentById(cid, aid);
    if (!assessment) return false;
    var key = _noteOnlyScoreKey(cid, assessment);
    var entry = {
      id: sid + ':' + aid + ':' + key,
      assessmentId: aid,
      tagId: key,
      score: isPointsScored(assessment) ? null : 0,
      date: assessment.date || courseToday(cid),
      type: scoreTypeFor(assessment),
      note: '',
      created: new Date().toISOString(),
    };
    if (!scores[sid]) scores[sid] = [];
    scores[sid].push(entry);
    entries = [entry];
  }
  if (getScoreComment(cid, sid, aid) === note) return true;
  entries.forEach(function (e) {
    e.note = note;
  });
  _cache.scores[cid] = scores;
  var gradesWere = _gradeBefore(cid, 'scores');
  var lsOk = _safeLSSet('gb-scores-' + cid, JSON.stringify(scores));
  _gradeAfter(cid, gradesWere, scores);
  _markLocalWrite('scores', cid);
  if (_writesEnabled() && _isSendableId(sid) && _isSendableId(aid)) {
    _trackPendingSync(
      _writeRpc('save_score_comment', {
        p_enrollment_id: sid,
        p_assessment_id: aid,
        p_comment: note,
      }).then(function (res) {
        if (res.error) _reportScoreWriteFailure('save_score_comment', res.error);
      }),
    );
    entries.forEach(function (e) {
      _rememberScoreCell(cid, sid, aid, e.tagId, scores);
    });
  }
  _broadcastChange(cid, 'scores');
  return lsOk;
}

/* ── Note for the Report ───────────────────────────────────────────────
   One line about what the student did on a piece of work, written about
   them ("linked the poster to the Act"), for the comment's best-piece
   sentence: score.report_note on the server and, in the cache, the
   `reportNote` every score entry of that student and assessment carries.
   Never printed on the rubric handout. At most 300 characters. */
var REPORT_NOTE_MAX = 300;

function getScoreReportNote(cid, sid, aid) {
  var entry = (getScores(cid)[sid] || []).find(function (e) {
    return e && e.assessmentId === aid && e.reportNote;
  });
  return entry ? String(entry.reportNote) : '';
}

/* Change (or clear, with '') the note on work the student has a score
   entry for. With no entry there is nothing to write it on. */
function saveScoreReportNote(cid, sid, aid, text) {
  var note = (text == null ? '' : String(text)).replace(/\s+/g, ' ').trim().slice(0, REPORT_NOTE_MAX).trim();
  var scores = getScores(cid);
  var entries = (scores[sid] || []).filter(function (e) {
    return e && e.assessmentId === aid;
  });
  if (!entries.length) return false;
  if (getScoreReportNote(cid, sid, aid) === note) return true;
  entries.forEach(function (e) {
    if (note) e.reportNote = note;
    else delete e.reportNote;
  });
  _cache.scores[cid] = scores;
  delete _returnedSets[cid];
  var lsOk = _safeLSSet('gb-scores-' + cid, JSON.stringify(scores));
  _markLocalWrite('scores', cid);
  if (_writesEnabled() && _isSendableId(sid) && _isSendableId(aid)) {
    _trackPendingSync(
      _writeRpc('save_score_report_note', {
        p_enrollment_id: sid,
        p_assessment_id: aid,
        p_note: note || null,
      }).then(function (res) {
        if (res.error) _reportScoreWriteFailure('save_score_report_note', res.error);
      }),
    );
    entries.forEach(function (e) {
      _rememberScoreCell(cid, sid, aid, e.tagId, scores);
    });
  }
  _broadcastChange(cid, 'scores');
  return lsOk;
}

/* Clear Score: take `sid`'s entries under `keys` off `scores` (not saved).
   The Overall Comment and Note for the Report aren't the score, so they
   stay, on an entry with no score under the first key, as the server's
   clear_score keeps them on the score row. */
function clearScoreEntries(cid, scores, sid, assessment, keys) {
  var aid = assessment.id;
  var note = getScoreComment(cid, sid, aid);
  var reportNote = getScoreReportNote(cid, sid, aid);
  scores[sid] = (scores[sid] || []).filter(function (e) {
    return !(e && e.assessmentId === aid && keys.indexOf(e.tagId) >= 0);
  });
  var left = scores[sid].some(function (e) {
    return e && e.assessmentId === aid;
  });
  if ((note || reportNote) && !left) {
    var entry = {
      id: sid + ':' + aid + ':' + keys[0],
      assessmentId: aid,
      tagId: keys[0],
      score: isPointsScored(assessment) ? null : 0,
      date: assessment.date || courseToday(cid),
      type: scoreTypeFor(assessment),
      note: note,
      created: new Date().toISOString(),
    };
    if (reportNote) entry.reportNote = reportNote;
    scores[sid].push(entry);
  }
  return scores;
}

function _scoreEntryKey(sid, entry) {
  if (!sid || !entry || !entry.assessmentId) return null;
  return [sid, entry.assessmentId, entry.tagId || ''].join(':');
}

function _scoreEntryRemoteChanged(a, b) {
  if (!a || !b) return true;
  return (
    (a.score || 0) !== (b.score || 0) ||
    (a.mod || 0) !== (b.mod || 0) ||
    (a.note || '') !== (b.note || '') ||
    (a.critNote || '') !== (b.critNote || '') ||
    (a.critBeyond || '') !== (b.critBeyond || '')
  );
}

function _scoreEntriesByKey(blob) {
  var out = {};
  Object.keys(blob || {}).forEach(function (sid) {
    (blob[sid] || []).forEach(function (entry) {
      var key = _scoreEntryKey(sid, entry);
      if (key) out[key] = { sid: sid, entry: entry };
    });
  });
  return out;
}

function persistScoreDiffToCanonical(cid, prevBlob, nextBlob) {
  if (!_writesEnabled()) return;
  var prevByKey = _scoreEntriesByKey(prevBlob || {});
  var nextByKey = _scoreEntriesByKey(nextBlob || {});
  // A points assessment stores one value per cell, mirrored onto every tag
  // entry locally. Send it once per cell, not once per tag.
  var pointsCellsSent = {};
  function firstForPointsCell(sid, aid) {
    var a = _assessmentById(cid, aid);
    if (!isPointsScored(a)) return true;
    var cell = sid + ':' + aid;
    if (pointsCellsSent[cell]) return false;
    pointsCellsSent[cell] = true;
    return true;
  }

  Object.keys(nextByKey).forEach(function (key) {
    var next = nextByKey[key];
    var prev = prevByKey[key];
    if (prev && !_scoreEntryRemoteChanged(prev.entry, next.entry)) return;
    if (!firstForPointsCell(next.sid, next.entry.assessmentId)) return;
    _persistScoreToCanonical(
      cid,
      next.sid,
      next.entry.assessmentId,
      next.entry.tagId,
      next.entry.score,
      next.entry.note || '',
      next.entry.mod,
    );
  });

  Object.keys(prevByKey).forEach(function (key) {
    if (nextByKey[key]) return;
    var prev = prevByKey[key];
    if (!firstForPointsCell(prev.sid, prev.entry.assessmentId)) return;
    // On points and Complete/Incomplete work 0 is a score (Incomplete is
    // 0), so a removed score clears the value instead.
    if (isPointsScored(_assessmentById(cid, prev.entry.assessmentId))) {
      window.upsertCellScore(cid, prev.sid, prev.entry.assessmentId, null);
      return;
    }
    _persistScoreToCanonical(cid, prev.sid, prev.entry.assessmentId, prev.entry.tagId, 0, '');
  });
}

/* Overall per-cell score — writes to score.value (Phase 3.5 HANDOFF target).
   Used by UI paths that enter a top-level proficiency/points value for a
   (student, assessment) cell, independent of tag/criterion breakdown. */
window.upsertCellScore = function (cid, enrollmentId, assessmentId, value) {
  if (!_isSendableId(enrollmentId) || !_isSendableId(assessmentId)) return Promise.resolve();
  var sb = getSupabase();
  if (!sb) return Promise.resolve();
  var v = value === '' || value == null ? null : Number(value);
  return _trackPendingSync(
    _writeRpc('upsert_score', {
      p_enrollment_id: enrollmentId,
      p_assessment_id: assessmentId,
      p_value: v,
    }).then(function (res) {
      if (res.error) _reportScoreWriteFailure('upsert_score', res.error);
      return res;
    }),
  );
};

/* Fill every criterion of a rubric assessment with one level value (§9.6).
   Returns the number of criteria updated. */
window.fillRubric = function (enrollmentId, assessmentId, value) {
  if (!_isUuid(enrollmentId) || !_isUuid(assessmentId)) return Promise.resolve();
  var sb = getSupabase();
  if (!sb) return Promise.resolve();
  var v = value == null ? null : Number(value);
  return _trackPendingSync(
    _writeRpc('fill_rubric', {
      p_enrollment_id: enrollmentId,
      p_assessment_id: assessmentId,
      p_value: v,
    }).then(function (res) {
      if (res.error) console.warn('fill_rubric failed:', res.error);
      return res;
    }),
  );
};

/* Clear a single cell's score: the server clears score.value and removes
   the RubricScore and TagScore rows. The score row stays while it holds a
   status, an Overall Comment or a Note for the Report
   (migrations/20261103_clear_score_keeps_comment.sql). */
window.clearScore = function (enrollmentId, assessmentId) {
  if (!_isUuid(enrollmentId) || !_isUuid(assessmentId)) return Promise.resolve();
  var sb = getSupabase();
  if (!sb) return Promise.resolve();
  return _trackPendingSync(
    _writeRpc('clear_score', {
      p_enrollment_id: enrollmentId,
      p_assessment_id: assessmentId,
    }).then(function (res) {
      if (res.error) console.warn('clear_score failed:', res.error);
      return res;
    }),
  );
};

/* Clear every score this student has in the course — the "remove all of this
   student's grades" action. Returns audit-row count. */
window.clearRowScores = function (enrollmentId, courseId) {
  if (!_isUuid(enrollmentId) || !_isUuid(courseId)) return Promise.resolve();
  var sb = getSupabase();
  if (!sb) return Promise.resolve();
  return _trackPendingSync(
    _writeRpc('clear_row_scores', {
      p_enrollment_id: enrollmentId,
      p_course_id: courseId,
    }).then(function (res) {
      if (res.error) console.warn('clear_row_scores failed:', res.error);
      return res;
    }),
  );
};

/* Clear every student's score on a single assessment — the "reset this column"
   action. Returns audit-row count. */
window.clearColumnScores = function (assessmentId) {
  if (!_isUuid(assessmentId)) return Promise.resolve();
  var sb = getSupabase();
  if (!sb) return Promise.resolve();
  return _trackPendingSync(
    _writeRpc('clear_column_scores', { p_assessment_id: assessmentId }).then(function (res) {
      if (res.error) console.warn('clear_column_scores failed:', res.error);
      return res;
    }),
  );
};

/* Status pills (NS / EXC / LATE / null). Uses set_score_status RPC per §9.3. */
window.setCellStatus = function (enrollmentId, assessmentId, status) {
  if (!_isUuid(enrollmentId) || !_isUuid(assessmentId)) return Promise.resolve();
  var sb = getSupabase();
  if (!sb) return Promise.resolve();
  return _trackPendingSync(
    _writeRpc('set_score_status', {
      p_enrollment_id: enrollmentId,
      p_assessment_id: assessmentId,
      p_status: status || null,
    }).then(function (res) {
      if (res.error) console.warn('set_score_status failed:', res.error);
      return res;
    }),
  );
};

/* ══════════════════════════════════════════════════════════════════
   Utilities (unchanged)
   ══════════════════════════════════════════════════════════════════ */
// esc (text into HTML) lives in shared/html.js, which every page loads first.

/* Returns a safe CSS color value for inline-style interpolation, or a
 * neutral fallback if the input doesn't match one of the accepted shapes.
 *
 * This is defence-in-depth: color values reach the client via user-editable
 * fields (subject/section/module/course), and the server validates them
 * against a hex-format CHECK constraint. But if a bypass ever lands a bad
 * value in the cache (stale LocalStorage, a future non-picker UI, etc.),
 * wrapping interpolations with cssColor() prevents the bad value from
 * breaking out of the style context into DOM injection.
 *
 * Accepted: #rgb / #rgba / #rrggbb / #rrggbbaa hex, rgb()/rgba()/hsl()/hsla()
 * with numeric components only, and var(--token) custom-property refs.
 * Anything with ;, {, }, /*, newlines, url(, javascript:, etc. falls back
 * to var(--text-3). */
var _CSS_COLOR_RE =
  /^(?:#[0-9a-fA-F]{3,8}|rgb\(\s*\d{1,3}(?:\s*,\s*\d{1,3}){2}\s*\)|rgba\(\s*\d{1,3}(?:\s*,\s*\d{1,3}){2}\s*,\s*(?:0|1|0?\.\d+)\s*\)|hsl\(\s*\d{1,3}(?:\s*,\s*\d{1,3}%?){2}\s*\)|hsla\(\s*\d{1,3}(?:\s*,\s*\d{1,3}%?){2}\s*,\s*(?:0|1|0?\.\d+)\s*\)|var\(--[a-zA-Z0-9_-]+\))$/;
function cssColor(c) {
  if (typeof c !== 'string' || c.length > 64) return 'var(--text-3)';
  return _CSS_COLOR_RE.test(c) ? c : 'var(--text-3)';
}
function initials(st) {
  if (!st) return '??';
  if (typeof st === 'string') {
    const p = (st || '').trim().split(/\s+/);
    if (p.length >= 2) return (p[0][0] + p[p.length - 1][0]).toUpperCase();
    return (p[0] || '?').slice(0, 2).toUpperCase();
  }
  // From the name shown on screen, so "Teddy Okafor" is TO.
  const f = (st.preferred || st.firstName || '').trim(),
    l = (st.lastName || '').trim();
  if (f && l) return (f[0] + l[0]).toUpperCase();
  return (f || l || '?').slice(0, 2).toUpperCase();
}

/* ── Student Display Helpers ───────────────────────────────── */
function pronounsSelect(id, selected, attrs) {
  return (
    '<select id="' +
    id +
    '" class="cm-input cm-pronoun-select" ' +
    (attrs || '') +
    '>' +
    '<option value="">—</option>' +
    PRONOUNS_OPTIONS.map(function (p) {
      return '<option' + (p === selected ? ' selected' : '') + '>' + esc(p) + '</option>';
    }).join('') +
    '</select>'
  );
}
function fullName(st) {
  return ((st.firstName || '') + ' ' + (st.lastName || '')).trim();
}
/* The name shown on screen for a student, everywhere: the preferred name
   (the first name when there is none), then the last name ("Teddy Okafor"
   for Theodore Okafor). fullName stays the legal name for the roster's
   fields, sorting, import matching and exports. */
function displayName(st) {
  return displayNameWithLast(st) || fullName(st);
}
function displayNameFirst(st) {
  return st.preferred || st.firstName || st.lastName || '';
}
/* The name a teacher calls the student by, then the last name: "Cece Adeyemi".
   Keeps a preferred name ("Bobby Smith" for Robert Smith). */
function displayNameWithLast(st) {
  return ((st.preferred || st.firstName || '') + ' ' + (st.lastName || '')).trim();
}
/* The name printed on a report card or rubric: the preferred name (the
   first name when there is none), or the first name when `style` is
   'first', then always the last name. A preferred name that already ends
   in the last name keeps it once ("Bobby Smith"). */
function printedStudentName(st, style) {
  st = st || {};
  var first = String((style === 'first' ? st.firstName || st.preferred : st.preferred || st.firstName) || '').trim();
  var last = String(st.lastName || '').trim();
  if (!last) return first || displayName(st);
  var lower = first.toLowerCase();
  if (lower === last.toLowerCase() || lower.slice(-(last.length + 1)) === ' ' + last.toLowerCase()) return first;
  return (first + ' ' + last).trim();
}

function sortStudents(arr, mode, cid) {
  var c = arr.slice();
  if (mode === 'firstName') {
    return c.sort(function (a, b) {
      return (a.firstName || '').localeCompare(b.firstName || '') || (a.lastName || '').localeCompare(b.lastName || '');
    });
  }
  if (mode === 'proficiency' && cid) {
    var profMap = {};
    c.forEach(function (st) {
      profMap[st.id] = getOverallProficiency(cid, st.id) || 0;
    });
    return c.sort(function (a, b) {
      return profMap[b.id] - profMap[a.id];
    });
  }
  if (mode === 'missing' && cid) {
    var statuses = getAssignmentStatuses(cid);
    var assessments = getAssessments(cid);
    var missingMap = {};
    c.forEach(function (st) {
      missingMap[st.id] = assessments.filter(function (a) {
        return statuses[st.id + ':' + a.id] === 'NS';
      }).length;
    });
    return c.sort(function (a, b) {
      return missingMap[b.id] - missingMap[a.id];
    });
  }
  // Lowest grade first, as the class is set to grade: percent for a Letter
  // class, proficiency otherwise. Students with no grade yet go last.
  if (mode === 'gradeLow' && cid) {
    var letter = courseGradeMode(cid) === 'letter';
    var gradeMap = {};
    c.forEach(function (st) {
      var v = letter ? getCourseLetterData(cid, st.id).R : getOverallProficiency(cid, st.id);
      gradeMap[st.id] = v > 0 ? v : null;
    });
    return c.sort(function (a, b) {
      var va = gradeMap[a.id];
      var vb = gradeMap[b.id];
      if (va === null || vb === null) return (va === null) - (vb === null);
      return va - vb;
    });
  }
  if (mode === 'flagged' && cid) {
    var flags = getFlags(cid);
    return c.sort(function (a, b) {
      return (flags[b.id] ? 1 : 0) - (flags[a.id] ? 1 : 0);
    });
  }
  if (mode === 'lastObserved' && cid) {
    var lastObsMap = {};
    c.forEach(function (st) {
      var obs = getStudentQuickObs(cid, st.id);
      lastObsMap[st.id] = obs.length ? obs[0].created : '';
    });
    return c.sort(function (a, b) {
      return (lastObsMap[b.id] || '').localeCompare(lastObsMap[a.id] || '');
    });
  }
  return c.sort(function (a, b) {
    return (a.lastName || '').localeCompare(b.lastName || '') || (a.firstName || '').localeCompare(b.firstName || '');
  });
}

function anonymizeStudents(students) {
  var shuffled = students.slice();
  for (var i = shuffled.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = shuffled[i];
    shuffled[i] = shuffled[j];
    shuffled[j] = tmp;
  }
  return shuffled.map(function (st, idx) {
    return Object.assign({}, st, { _anonLabel: 'Student ' + String(idx + 1).padStart(3, '0') });
  });
}

/* ── Learning Map Migration — flatten section/tag hierarchy ── */
function _backupBeforeMigration(cid, field) {
  var current = _cache[field] && _cache[field][cid];
  if (current) {
    _safeLSSet('gb-mig-bak-' + field + '-' + cid, JSON.stringify({ data: current, ts: Date.now() }));
  }
}

function migrateLearningMap(map) {
  if (!map || !map.sections || map._flatVersion >= 2) return map;
  // Build sectionId → tagId mapping for override/goal/reflection migration
  var sectionToTag = {};
  map.sections.forEach(function (sec) {
    if (!sec.tags || sec.tags.length === 0) return;
    var tag = sec.tags[0];
    // Promote section properties onto the tag
    tag.color = sec.color;
    tag.subject = sec.subject;
    tag.shortName = sec.shortName;
    tag.name = sec.name;
    tag._legacySectionId = sec.id;
    // Record mapping before changing section ID
    sectionToTag[sec.id] = tag.id;
    // Section ID becomes tag ID
    sec.id = tag.id;
  });
  map._flatVersion = 2;
  map._sectionToTagMap = sectionToTag;
  return map;
}

function migrateOverridesForFlatMap(cid, sectionToTag) {
  if (!sectionToTag || Object.keys(sectionToTag).length === 0) return;
  var overrides = getOverrides(cid);
  var changed = false;
  Object.keys(overrides).forEach(function (studentId) {
    var studentOverrides = overrides[studentId];
    if (!studentOverrides) return;
    Object.keys(studentOverrides).forEach(function (key) {
      if (sectionToTag[key] && key !== sectionToTag[key]) {
        studentOverrides[sectionToTag[key]] = studentOverrides[key];
        delete studentOverrides[key];
        changed = true;
      }
    });
  });
  if (changed) saveOverrides(cid, overrides);
}

function migrateGoalsForFlatMap(cid, sectionToTag) {
  if (!sectionToTag || Object.keys(sectionToTag).length === 0) return;
  var goals = getGoals(cid);
  var changed = false;
  Object.keys(goals).forEach(function (studentId) {
    var studentGoals = goals[studentId];
    if (!studentGoals || typeof studentGoals !== 'object') return;
    Object.keys(studentGoals).forEach(function (key) {
      if (sectionToTag[key] && key !== sectionToTag[key]) {
        studentGoals[sectionToTag[key]] = studentGoals[key];
        delete studentGoals[key];
        changed = true;
      }
    });
  });
  if (changed) saveGoals(cid, goals);
}

function migrateReflectionsForFlatMap(cid, sectionToTag) {
  if (!sectionToTag || Object.keys(sectionToTag).length === 0) return;
  var reflections = getReflections(cid);
  var changed = false;
  Object.keys(reflections).forEach(function (studentId) {
    var studentRefs = reflections[studentId];
    if (!studentRefs || typeof studentRefs !== 'object') return;
    Object.keys(studentRefs).forEach(function (key) {
      if (sectionToTag[key] && key !== sectionToTag[key]) {
        studentRefs[sectionToTag[key]] = studentRefs[key];
        delete studentRefs[key];
        changed = true;
      }
    });
  });
  if (changed) saveReflections(cid, reflections);
}

/* ── Student Migration ─────────────────────────────────────── */
function migrateStudent(st) {
  if (typeof st.designation === 'string' && st.designation) {
    st.designations = [st.designation];
    delete st.designation;
  }
  st.designations = st.designations || [];
  if (st.firstName !== undefined) return st;
  var parts = (st.name || '').trim().split(/\s+/);
  st.firstName = parts[0] || '';
  st.lastName = parts.slice(1).join(' ') || '';
  st.sortName = (st.lastName + ' ' + st.firstName).trim();
  st.studentNumber = st.studentNumber || '';
  st.dateOfBirth = st.dateOfBirth || '';
  st.email = st.email || '';
  st.attendance = st.attendance || [];
  delete st.name;
  return st;
}
function migrateAllStudents() {
  Object.keys(COURSES).forEach(function (cid) {
    var students = getStudents(cid);
    if (
      students.length &&
      students.some(function (s) {
        return s.firstName === undefined;
      })
    ) {
      _backupBeforeMigration(cid, 'students');
      saveStudents(cid, students.map(migrateStudent));
    }
  });
}
function formatTs(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return (
    d.toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' }) +
    ' at ' +
    d.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' })
  );
}
/* Parse a date-only 'YYYY-MM-DD' string as a local calendar date.
   new Date('YYYY-MM-DD') is read as UTC midnight, which lands on the
   previous day in Pacific time. Anything else goes to new Date as-is. */
function parseLocalDate(v) {
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const p = v.split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }
  return new Date(v);
}
function formatDate(ts) {
  if (!ts) return '';
  return parseLocalDate(ts).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
}
/* Short date for gradebook column headers: "Apr 25" in the current school
   year, "Apr 25, 2025" otherwise. A school year runs August to July, the
   same boundary as reportingSchoolYear. `today` is for tests. */
function formatShortDate(ts, today) {
  if (!ts) return '';
  const d = parseLocalDate(ts);
  if (isNaN(d.getTime())) return '';
  const now = today ? parseLocalDate(today) : new Date();
  const schoolYear = x => (x.getMonth() >= 7 ? x.getFullYear() : x.getFullYear() - 1);
  const opts = { month: 'short', day: 'numeric' };
  if (schoolYear(d) !== schoolYear(now)) opts.year = 'numeric';
  return d.toLocaleDateString('en-CA', opts);
}
function uid() {
  return 's' + Date.now() + Math.random().toString(36).slice(2, 10);
}

/* Mint an idempotency key for a mutating RPC. The v2 write paths accept an
   optional p_idempotency_key uuid and cache the result per
   (key, teacher, endpoint) via fv_idem_check / fv_idem_store, so a retry of a
   call that committed server-side but whose response never reached the client
   returns the original row instead of inserting a duplicate. One key per
   logical user action — reusing it across distinct actions would suppress a
   write the teacher actually asked for.

   Returns null when crypto.randomUUID is unavailable; a null key makes
   fv_idem_check a no-op, which is exactly the pre-existing behaviour. */
function _idempotencyKey() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch (e) {
    /* fall through — dedup is an optimisation, never a hard requirement */
  }
  return null;
}

/* Stamp an idempotency key onto an RPC's params, in place and only once.

   Mutating the caller's object is deliberate. _callRpcWithAuthGuard retries the
   same params twice over — once straight after a token refresh, and again from
   the session-expired queue once the teacher re-authenticates — and both reuse
   the object they were handed. A key minted inside the retry would be a fresh
   key each attempt and would dedup nothing; stamped here, every attempt at the
   same logical write carries the same key, which is the whole point.

   One key per logical write, so distinct writes never share one: two
   deliberate creates, or two successive edits of the same note, each get their
   own key and both land. Only endpoints in FV_IDEMPOTENT_RPCS are stamped —
   PostgREST resolves overloads by argument name, so sending the parameter to an
   RPC that lacks it would fail the call outright. */
function _stampIdempotencyKey(name, params) {
  if (!params || typeof params !== 'object') return params;
  var accepts = typeof FV_IDEMPOTENT_RPCS !== 'undefined' && FV_IDEMPOTENT_RPCS[name];
  if (!accepts) return params;
  if (Object.prototype.hasOwnProperty.call(params, 'p_idempotency_key')) return params;
  var key = _idempotencyKey();
  // A null key leaves fv_idem_check a no-op; don't send the parameter at all
  // rather than pass an explicit null on every write.
  if (key) params.p_idempotency_key = key;
  return params;
}

function getParam(key) {
  return new URLSearchParams(window.location.search).get(key);
}

function getTodayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/* ══════════════════════════════════════════════════════════════════
   Courses — cache-through
   ══════════════════════════════════════════════════════════════════ */
function loadCourses() {
  // If cache is populated (initAllCourses was called), use it
  if (_cache.courses) return _cache.courses;
  // Otherwise fall back to localStorage (pre-init or file:// mode)
  return _loadCoursesFromLS();
}
function saveCourses(obj) {
  _cache.courses = obj;
  COURSES = obj;
  // v2: localStorage is the local mirror; remote course writes go through
  // window.v2 helpers (createCourse / update_course / etc.) at each save site.
  _safeLSSet('gb-courses', JSON.stringify(obj));
}

let COURSES = loadCourses();
if (!localStorage.getItem('gb-courses') && !_useSupabase) saveCourses(COURSES);

/* Canonical create: mints a real course_offering UUID server-side and inserts a
   default course_policy row. Falls back to a local-only stub if Supabase is
   unavailable so offline-mode teachers can still scaffold a course. */
function createCourse(data) {
  const localId = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const course = {
    id: localId,
    // Marker that survives the create_course RPC rekey (see line ~2666
    // below). The curriculum wizard reads this on the migrated record so
    // it can find the canonical course id before dispatching subjects /
    // sections / tags to V2.
    __pendingLocalId: localId,
    name: data.name || 'Untitled Class',
    gradingSystem: data.gradingSystem || 'proficiency',
    calcMethod: data.calcMethod || 'average',
    decayWeight: data.decayWeight || 0.65,
    description: data.description || '',
    gradeLevel: data.gradeLevel || '',
    timezone: data.timezone || 'America/Vancouver',
    lateWorkPolicy: data.lateWorkPolicy || null,
    block: normalizeCourseBlock(data.block),
  };
  COURSES[localId] = course;
  _safeLSSet('gb-courses', JSON.stringify(COURSES));
  saveLearningMap(localId, { subjects: [], sections: [], _customized: true, _version: 1 });

  if (_useSupabase) {
    const sb = getSupabase();
    if (sb) {
      // v2 create_course(p_name, p_grade_level, p_description, p_color,
      //                   p_grading_system, p_calc_method, p_decay_weight,
      //                   p_timezone, p_late_work_policy, p_subjects text[])
      // → uuid.  Policy fields (grading_system / calc_method / decay_weight)
      // live on the course row directly — save_course_policy was merged
      // into the course table per ERD "Merged CoursePolicy into Course".
      // Mark this id as pending so any course-level edits made during the
      // create_course round-trip can be migrated + replayed when the
      // canonical UUID arrives (P6.2). The record outlives this page: a
      // create that lands after a reload still re-keys and replays
      // (_onCourseCreated, driven from the outbox's success event).
      _pendingLocalCids.add(localId);
      var rec = _registerPendingCreate(localId, 'course', localId, 'create_course', { row: course });
      var createPromise = _writeRpc(
        'create_course',
        {
          p_name: course.name,
          p_grade_level: course.gradeLevel || null,
          p_description: course.description || null,
          p_grading_system: course.gradingSystem || 'proficiency',
          p_calc_method: course.calcMethod || 'average',
          p_decay_weight: course.decayWeight != null ? Number(course.decayWeight) : null,
          p_timezone: course.timezone,
          p_late_work_policy: course.lateWorkPolicy || null,
          p_block: course.block || null,
        },
        { entryId: rec ? rec.entryId : undefined },
      )
        .then(function (res) {
          if (res.error) {
            if (!res.error.cancelled) console.warn('create_course RPC failed:', res.error);
            _onCreateAbandoned(rec && rec.entryId, false);
            _pendingLocalCids.delete(localId);
            return;
          }
          // Usually already done from the outbox event; a no-op then.
          _onCreateLanded(rec && rec.entryId, res.data);
          _pendingLocalCids.delete(localId);
        })
        .catch(function (err) {
          console.warn('create_course threw:', err);
          _onCreateAbandoned(rec && rec.entryId, false);
          _pendingLocalCids.delete(localId);
        });
      _trackPendingSync(createPromise);
    }
  }
  return course;
}

function updateCourse(id, updates) {
  if (!COURSES[id]) return;
  Object.assign(COURSES[id], updates);
  _safeLSSet('gb-courses', JSON.stringify(COURSES));
  // A class load on its way must not put the older row back over this
  // (_applyBundleCourseRow). The counter only: the class list is not part
  // of the class's saved copy, so that copy is not marked as edited.
  var edits = _localWrites[id] || (_localWrites[id] = { at: 0, fields: {} });
  edits.fields[_COURSE_ROW_FIELD] = (edits.fields[_COURSE_ROW_FIELD] || 0) + 1;
  // The grade level sets the course %'s rounding (whole for 10–12), and the
  // method and grading style are read from the course too: no cached grade
  // may outlive them.
  if (typeof clearProfCache === 'function') clearProfCache();

  if (_useSupabase) {
    const sb = getSupabase();
    if (sb) {
      // v2 update_course(p_id, p_patch jsonb). Policy fields (grading_system,
      // calc_method, decay_weight, timezone, late_work_policy) are columns on
      // the course row so one jsonb patch covers the full surface.
      const patch = {};
      if (updates.name !== undefined) patch.name = updates.name;
      if (updates.description !== undefined) patch.description = updates.description;
      if (updates.gradeLevel !== undefined) patch.grade_level = updates.gradeLevel;
      if (updates.color !== undefined) patch.color = updates.color;
      if (updates.gradingSystem !== undefined) patch.grading_system = updates.gradingSystem;
      if (updates.calcMethod !== undefined) patch.calc_method = updates.calcMethod;
      if (updates.decayWeight !== undefined) patch.decay_weight = updates.decayWeight;
      if (updates.timezone !== undefined) patch.timezone = updates.timezone;
      if (updates.lateWorkPolicy !== undefined) patch.late_work_policy = updates.lateWorkPolicy;
      if (updates.block !== undefined) patch.block = updates.block || null;
      if (updates.curriculumTags !== undefined)
        patch.curriculum_tags = Array.isArray(updates.curriculumTags) ? updates.curriculumTags.slice() : null;
      if (Object.keys(patch).length > 0 && _isUuid(id)) {
        _trackPendingSync(
          _writeRpc('update_course', { p_course_id: id, p_patch: _changedOnly(patch) }).then(function (res) {
            if (res.error) console.warn('update_course RPC failed:', res.error);
          }),
        );
      }
      // archive toggle goes through archive_course (dedicated RPC).
      if (updates.archived !== undefined && _isUuid(id)) {
        _trackPendingSync(
          _writeRpc('archive_course', { p_course_id: id, p_archived: !!updates.archived }).then(function (res) {
            if (res.error) console.warn('archive_course RPC failed:', res.error);
          }),
        );
      }
    }
  }
}

function _nextVisibleCourseId() {
  var ids = Object.keys(COURSES || {});
  var firstActive = ids.find(function (cid) {
    return !isCourseArchived(cid);
  });
  return firstActive || (ids.length > 0 ? ids[0] : null);
}

function _clearCourseLocalState(id) {
  if (!id) return;

  // Clear localStorage
  [
    'students',
    'assessments',
    'scores',
    'overrides',
    'courseconfig',
    'learningmap',
    'modules',
    'rubrics',
    'rubric-checks',
    'rubric-prints',
    'grade-returns',
    'category-draft',
    'student-cards',
    'student-work',
    'student-feedback',
    'statuses',
    'quick-obs',
    'term-ratings',
    'notes',
    'flags',
    'goals',
    'reflections',
    'custom-tags',
    'obs-templates',
    'report-config',
    'categories',
    'student-profile-summaries',
    'withdrawn',
    'bundle-meta',
  ].forEach(k => localStorage.removeItem('gb-' + k + '-' + id));
  _forgetServerState(id);
  delete _classVersion[id];
  delete _serverStudentPage[id];
  delete _gradeReturnsStale[id];
  delete _studentWork[id];
  delete _studentFeedback[id];

  // Clear cache
  for (const field of Object.keys(_DATA_KEYS)) {
    delete _cache[field][id];
  }

  delete COURSES[id];
  saveCourses(COURSES);

  var cfg = Object.assign({}, getConfig() || {});
  if (cfg.activeCourse === id) {
    cfg.activeCourse = _nextVisibleCourseId();
    saveConfig(cfg);
  }
}

async function deleteCourseData(id) {
  // Soft-delete in Supabase before clearing local state so a failed delete
  // never leaves the class hidden locally while still visible remotely.
  if (_useSupabase && _isUuid(id)) {
    const sb = getSupabase();
    if (sb) {
      const res = await _writeRpc('delete_course', { p_course_id: id });
      if (res.error) throw res.error;
    }
  }

  _clearCourseLocalState(id);
}

/* ── Grading Scale ─────────────────────────────────────────── */
function getGradingScale(cid) {
  const cc = getCourseConfig(cid);
  return cc.gradingScale || DEFAULT_GRADING_SCALE;
}

/* ── Reporting terms ───────────────────────────────────────────
   Up to six per class, stored on the course row as reporting_terms and
   carried in the course config blob with the server's keys:
   { ordinal: 1..6, label, starts_on: 'YYYY-MM-DD', ends_on: 'YYYY-MM-DD' }.
   docs/DECISIONS.md, "Reporting periods". */
var REPORTING_TERMS_MAX = 6;
var _DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The class's reporting terms, sorted by ordinal. Empty when it has none. */
function getReportingTerms(cid) {
  var cc = getCourseConfig(cid) || {};
  var terms = Array.isArray(cc.reportingTerms) ? cc.reportingTerms : [];
  return terms
    .map(function (t) {
      return {
        ordinal: Number(t.ordinal),
        label: String(t.label || ''),
        starts_on: String(t.starts_on || t.startsOn || ''),
        ends_on: String(t.ends_on || t.endsOn || ''),
      };
    })
    .sort(function (a, b) {
      return a.ordinal - b.ordinal;
    });
}

/** Why a list of terms can't be saved, or null when it can. The server's
 * check constraint enforces the same rules except overlap. */
function reportingTermsError(terms) {
  if (!Array.isArray(terms)) return 'Terms must be a list.';
  if (terms.length > REPORTING_TERMS_MAX) return 'A class can have up to ' + REPORTING_TERMS_MAX + ' terms.';
  var seen = {};
  for (var i = 0; i < terms.length; i++) {
    var t = terms[i] || {};
    var n = Number(t.ordinal);
    if (!Number.isInteger(n) || n < 1 || n > REPORTING_TERMS_MAX) return 'Each term needs a number from 1 to 6.';
    if (seen[n]) return 'Two terms have the same number.';
    seen[n] = true;
    if (!String(t.label || '').trim()) return 'Every term needs a name.';
    if (!_DATE_ONLY_RE.test(t.starts_on || '') || !_DATE_ONLY_RE.test(t.ends_on || ''))
      return 'Every term needs a start date and an end date.';
    if (t.starts_on > t.ends_on) return (t.label || 'A term') + ' ends before it starts.';
  }
  var sorted = terms.slice().sort(function (a, b) {
    return a.starts_on < b.starts_on ? -1 : a.starts_on > b.starts_on ? 1 : 0;
  });
  for (var j = 1; j < sorted.length; j++) {
    if (sorted[j].starts_on <= sorted[j - 1].ends_on)
      return (sorted[j - 1].label || 'A term') + ' and ' + (sorted[j].label || 'the next term') + ' overlap.';
  }
  return null;
}

/** Number a list of terms in start-date order. Terms keep the numbers they
 * have when those rise with the dates, so a Semester 2 class keeps the
 * school's Terms 3 and 4 (DECISIONS, Reporting periods 9); a term without one
 * takes the next number. Numbers out of date order, or past 6, give 1..n. */
function normalizeTermOrdinals(terms) {
  var rows = (terms || []).map(function (t) {
    return {
      ordinal: Number(t.ordinal),
      label: String(t.label || '').trim(),
      starts_on: String(t.starts_on || ''),
      ends_on: String(t.ends_on || ''),
    };
  });
  rows.sort(function (a, b) {
    return a.starts_on < b.starts_on ? -1 : a.starts_on > b.starts_on ? 1 : 0;
  });
  // Numbers already given must rise with the dates; if they don't, they are
  // stale and every term is renumbered 1..n.
  var given = rows
    .map(function (t) {
      return t.ordinal;
    })
    .filter(function (n) {
      return Number.isInteger(n) && n >= 1;
    });
  var keep = given.every(function (n, i) {
    return i === 0 || n > given[i - 1];
  });
  var prev = 0;
  rows.forEach(function (t) {
    t.ordinal = keep && Number.isInteger(t.ordinal) && t.ordinal > prev ? t.ordinal : prev + 1;
    prev = t.ordinal;
  });
  if (prev > REPORTING_TERMS_MAX)
    rows.forEach(function (t, i) {
      t.ordinal = i + 1;
    });
  return rows;
}

/* ── Which part of the year a class runs ────────────────────────
   Full year, Semester 1 or Semester 2. Not stored: it is read off the
   terms the class carries, split at the day Semester 2 starts. */
var TERM_SPANS = [
  { value: 'full', label: 'Full Year' },
  { value: 's1', label: 'Semester 1' },
  { value: 's2', label: 'Semester 2' },
];

/** The day Semester 2 starts for a set of terms: Term 3's start when they are
 * a Surrey school's preset terms, else Feb 1 of their school year. */
function semesterTwoStart(terms, fallbackDate) {
  var match = typeof reportingTermsSchoolMatch === 'function' ? reportingTermsSchoolMatch(terms) : null;
  if (match && match.school.terms[2]) return match.school.terms[2].starts_on;
  var first = (terms || [])
    .map(function (t) {
      return t.starts_on;
    })
    .filter(Boolean)
    .sort()[0];
  var d = String(first || fallbackDate || '');
  var y = parseInt(d.slice(0, 4), 10);
  var m = parseInt(d.slice(5, 7), 10);
  if (!y || !m) return null;
  return (m >= 8 ? y + 1 : y) + '-02-01';
}

/** The terms of `rows` that fall in a span: Semester 1 is every term that
 * ends before `sem2Start`, Semester 2 every term that starts on or after it.
 * A term that runs across the turnaround belongs to neither. */
function termsInSpan(rows, span, sem2Start) {
  if (span !== 's1' && span !== 's2') return (rows || []).slice();
  if (!sem2Start) return (rows || []).slice();
  return (rows || []).filter(function (r) {
    return span === 's1' ? r.ends_on < sem2Start : r.starts_on >= sem2Start;
  });
}

/** 'full', 's1' or 's2' for the terms a class carries. No terms is full. */
function termSpanOf(terms, sem2Start) {
  var list = terms || [];
  if (!list.length || !sem2Start) return 'full';
  var inS1 = termsInSpan(list, 's1', sem2Start).length;
  var inS2 = termsInSpan(list, 's2', sem2Start).length;
  if (inS1 === list.length) return 's1';
  if (inS2 === list.length) return 's2';
  return 'full';
}

/** Save the class's terms, numbered by normalizeTermOrdinals. Returns the
 * error text if the list is invalid; nothing is saved then. */
function saveReportingTerms(cid, terms) {
  var clean = normalizeTermOrdinals(terms);
  var err = reportingTermsError(clean);
  if (err) return err;
  var cc = Object.assign({}, getCourseConfig(cid) || {});
  cc.reportingTerms = clean;
  saveCourseConfig(cid, cc);
  if (typeof clearProfCache === 'function') clearProfCache();
  return null;
}

/** The term whose dates contain a date (default today in the class's timezone), or null. */
function reportingTermOn(cid, date) {
  var d = date || courseToday(cid);
  return (
    getReportingTerms(cid).find(function (t) {
      return d >= t.starts_on && d <= t.ends_on;
    }) || null
  );
}

/* ══════════════════════════════════════════════════════════════════
   BC Curriculum Index Loader (unchanged — not persisted data)
   ══════════════════════════════════════════════════════════════════ */
let CURRICULUM_INDEX = null;

async function loadCurriculumIndex() {
  if (CURRICULUM_INDEX) return CURRICULUM_INDEX;
  if (window._CURRICULUM_DATA) {
    CURRICULUM_INDEX = window._CURRICULUM_DATA;
    return CURRICULUM_INDEX;
  }
  try {
    const resp = await fetch('/curriculum_by_course.json');
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    CURRICULUM_INDEX = await resp.json();
    return CURRICULUM_INDEX;
  } catch (e) {
    try {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = '/curriculum_data.js';
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });
      if (window._CURRICULUM_DATA) {
        CURRICULUM_INDEX = window._CURRICULUM_DATA;
        return CURRICULUM_INDEX;
      }
      throw new Error('Script loaded but no data');
    } catch (e2) {
      console.error('Failed to load curriculum index:', e, e2);
      return null;
    }
  }
}

function getCoursesByGrade(grade) {
  if (!CURRICULUM_INDEX) return [];
  const results = [];
  for (const [shortTag, course] of Object.entries(CURRICULUM_INDEX)) {
    if (course.grade === grade) {
      let competencyCount = 0;
      for (const cat of course.categories || []) {
        competencyCount += (cat.competencies || []).length;
      }
      results.push({
        short_tag: shortTag,
        course_name: course.course_name,
        subject: course.subject,
        competencyCount: competencyCount,
        categoryCount: (course.categories || []).length,
        statementCount: competencyCount,
      });
    }
  }
  return results.sort((a, b) => a.course_name.localeCompare(b.course_name));
}

function getSubjectsByGrade(grade) {
  if (!CURRICULUM_INDEX) return [];
  const subjects = new Set();
  for (const course of Object.values(CURRICULUM_INDEX)) {
    if (course.grade === grade) subjects.add(course.subject);
  }
  return [...subjects].sort();
}

/* The class's learning map from the BC curriculum courses it links to.
   One section per competency, named from the bank's short_label (one name
   per competency). A category marked folder: true becomes a folder holding
   its competencies; other categories (Social Studies, one-competency
   headings, every category of the old bank) leave theirs ungrouped. The
   order is the Ministry's: folders take the place of their first
   competency. A competency keeps the bank's id (tag.bank_id) when it has a
   stable one ("bc.…"). In a combined class, a folder name two courses share
   is prefixed with the course name, and a code two courses share gets a
   course mark ("C" + "CP1"), so no two columns read the same.
   options.skip: competencies the teacher unticked in the wizard, by
   curriculumCompKey. */
function buildLearningMapFromTags(shortTags, options) {
  if (!CURRICULUM_INDEX)
    return { subjects: [], sections: [], competencyGroups: [], _customized: true, _version: 1, _flatVersion: 2 };
  const skip = new Set((options && options.skip) || []);
  const courses = shortTags
    .map(courseTag => ({ courseTag, course: CURRICULUM_INDEX[courseTag] }))
    .filter(x => x.course && x.course.categories && x.course.categories.length);
  const isHybrid = courses.length > 1;
  const kept = (courseTag, cat) =>
    (cat.competencies || []).filter(comp => !skip.has(curriculumCompKey(courseTag, comp)));

  // Folder names and codes more than one course uses.
  const folderCourses = {};
  const codeCourses = {};
  courses.forEach(({ courseTag, course }) => {
    course.categories.forEach(cat => {
      const comps = kept(courseTag, cat);
      if (!comps.length) return;
      if (cat.folder === true) (folderCourses[cat.name] = folderCourses[cat.name] || new Set()).add(courseTag);
      comps.forEach(comp => {
        if (comp.tag) (codeCourses[comp.tag] = codeCourses[comp.tag] || new Set()).add(courseTag);
      });
    });
  });
  const marks = _curriculumCourseMarks(courses.map(x => x.courseTag));

  const subjects = [];
  const sections = [];
  const competencyGroups = [];
  const seenCategoryNames = {};
  const usedCodes = {};

  for (const { courseTag, course } of courses) {
    const colour = SUBJECT_COLOURS[course.subject] || '#6366f1';
    let addedSections = false;
    const usedTagIds = {};

    for (const category of course.categories) {
      const comps = kept(courseTag, category);
      if (!comps.length) continue;

      let group = null;
      if (category.folder === true) {
        const shared = isHybrid && folderCourses[category.name].size > 1;
        group = {
          id: 'grp_' + courseTag + '_' + competencyGroups.length,
          name: shared ? _curriculumFolderPrefix(courseTag, courses) + ': ' + category.name : category.name,
          color: colour,
          sortOrder: competencyGroups.length,
          displayOrder: competencyGroups.length,
        };
        competencyGroups.push(group);
      }

      // Old bank: a category is a heading shared by its competencies, and
      // a name two courses share is prefixed with the course key.
      let sectionName = category.name;
      if (isHybrid && !group) {
        if (seenCategoryNames[category.name] && seenCategoryNames[category.name] !== courseTag) {
          sectionName = courseTag + ': ' + category.name;
          sections
            .filter(s => s.name === category.name && s._category)
            .forEach(s => {
              s.name = seenCategoryNames[category.name] + ': ' + category.name;
              s.tags[0].name = s.name;
            });
        }
        seenCategoryNames[category.name] = seenCategoryNames[category.name] || courseTag;
      }

      for (const comp of comps) {
        const fromBank = typeof comp.id === 'string' && comp.id.indexOf('bc.') === 0;
        // New bank: each competency is named from its own short_label.
        const name = fromBank || group ? comp.short_label || sectionName : sectionName;
        let code = comp.tag;
        if (isHybrid && code && codeCourses[code] && codeCourses[code].size > 1) code = marks[courseTag] + code;
        if (code && usedCodes[code]) console.warn('Curriculum import: code ' + code + ' repeats in this class.');
        if (code) usedCodes[code] = true;

        let baseId = isHybrid ? courseTag + '_' + comp.tag : comp.tag;
        if (usedTagIds[baseId]) {
          usedTagIds[baseId]++;
          baseId = baseId + usedTagIds[baseId];
        } else {
          usedTagIds[baseId] = 1;
        }
        const shortName = fromBank || group ? _curriculumShortName(name) : _curriculumCategoryShortName(category.name);
        const tag = {
          id: baseId,
          code: code,
          label: comp.short_label,
          text: comp.raw,
          source_text: comp.raw,
          i_can_statements: comp.i_can_statements || [],
          bank_id: fromBank ? comp.id : null,
          color: colour,
          subject: courseTag,
          name: name,
          shortName: shortName,
        };
        const sec = {
          id: baseId,
          subject: courseTag,
          name: name,
          shortName: shortName,
          color: colour,
          tags: [tag],
        };
        if (group) sec.groupId = group.id;
        if (!fromBank && !group) Object.defineProperty(sec, '_category', { value: true });
        sections.push(sec);
        addedSections = true;
      }
    }
    if (addedSections) {
      // `family` is the BC subject area ("Physical and Health Education"),
      // which the Term Questionnaire's Comment Bank reads to offer wording
      // for that kind of class.
      subjects.push({ id: courseTag, name: course.course_name, color: colour, family: course.subject });
    }
  }

  sections.forEach((sec, i) => {
    sec.sortOrder = i;
    sec.displayOrder = i;
  });
  return { subjects, sections, competencyGroups, _customized: true, _version: 1, _flatVersion: 2 };
}

/* How the wizard names one competency of a course: its bank id, or, in the
   old bank, whose ids can repeat within a course, the course and the
   competency's place in it. */
function curriculumCompKey(courseTag, comp) {
  if (typeof comp.id === 'string' && comp.id.indexOf('bc.') === 0) return comp.id;
  const course = CURRICULUM_INDEX && CURRICULUM_INDEX[courseTag];
  const all = course ? (course.categories || []).flatMap(cat => cat.competencies || []) : [];
  const at = all.indexOf(comp);
  return courseTag + ':' + (at >= 0 ? at : comp.id || comp.tag);
}

/* What a folder name two courses share is prefixed with: the course name,
   or, when another course in the class has the same name (English First
   Peoples Literary Studies 10 and Literary Studies 10), the name and key. */
function _curriculumFolderPrefix(courseTag, courses) {
  const name = CURRICULUM_INDEX[courseTag].course_name;
  const twin = courses.some(x => x.courseTag !== courseTag && x.course.course_name === name);
  return twin ? name + ' (' + courseTag + ')' : name;
}

/* The grading switches a new curriculum class starts with: one course,
   Folders Count as One on; two or more, Each Course Counts Equally on and
   Folders Count as One off (curriculum bank decision 10). */
function curriculumGradingDefaults(shortTags) {
  const n = (shortTags || []).filter(t => CURRICULUM_INDEX && CURRICULUM_INDEX[t]).length;
  return n > 1
    ? { foldersCountAsOne: false, coursesCountEqually: true }
    : { foldersCountAsOne: true, coursesCountEqually: false };
}

/* A short mark per course for codes two courses share, at most two
   characters so a marked code stays within six: the key's first letter, or,
   when another course in the class starts with the same letter, that letter
   and the first character where their keys (less the grade) differ
   (COMP10 + LS10 → C, L; COMP10 + CW10 → CO, CW; ECOM12 + ECONBUS12 → EM,
   EN; SA2D10 + SA3D10 → S2, S3; WEX12A + WEX12B → WA, WB). */
function _curriculumCourseMarks(courseTags) {
  const keys = courseTags.map(t =>
    String(t)
      .toUpperCase()
      .replace(/\d{1,2}([A-Z]?)$/, '$1')
      .replace(/[^A-Z0-9]/g, ''),
  );
  const marks = {};
  courseTags.forEach((t, i) => {
    const own = keys[i] || String(t).toUpperCase();
    const rivals = keys.filter((k, j) => j !== i && k[0] === own[0]);
    if (!rivals.length) return (marks[t] = own[0]);
    // The first position where every key sharing this letter differs.
    const group = [own].concat(rivals);
    let at = 1;
    while (at < own.length && new Set(group.map(k => k[at] || '')).size < group.length) at++;
    marks[t] = own[0] + (own[at] || String(i));
  });
  return marks;
}

/* A competency's short name: its own name, kept whole up to 20 characters. */
function _curriculumShortName(name) {
  name = String(name || '');
  return name.length > 20 ? name.slice(0, 18) + '\u2026' : name;
}

/* The old bank's short name for a category heading. */
function _curriculumCategoryShortName(name) {
  const short = String(name || '')
    .replace(/\s*\(.*?\)\s*/g, '')
    .split(/\s+and\s+/i)[0]
    .trim();
  return _curriculumShortName(short);
}

/* ══════════════════════════════════════════════════════════════════
   Learning Map — cache-through
   ══════════════════════════════════════════════════════════════════ */
function getLearningMap(cid) {
  if (_cache.learningMaps[cid]) return _cache.learningMaps[cid];
  // Not yet loaded into cache — read from localStorage as fallback
  var map;
  try {
    const custom = JSON.parse(localStorage.getItem('gb-learningmap-' + cid));
    if (custom && custom._customized) map = custom;
  } catch (e) {
    console.warn('LearningMap parse error:', e);
  }
  if (!map) map = structuredClone(_builtInLearningMap(cid));
  // Migrate old nested section/tag format to flat format
  if (!map._flatVersion || map._flatVersion < 2) {
    var sectionToTag = {};
    if (map.sections) {
      map.sections.forEach(function (sec) {
        if (sec.tags && sec.tags.length > 0) sectionToTag[sec.id] = sec.tags[0].id;
      });
    }
    if (!map._flatVersion || map._flatVersion < 2) _backupBeforeMigration(cid, 'learningMaps');
    migrateLearningMap(map);
    _cache.learningMaps[cid] = map;
    if (map._customized) saveLearningMap(cid, map);
    // Migrate overrides, goals, reflections keyed by old section IDs
    if (Object.keys(sectionToTag).length > 0) {
      migrateOverridesForFlatMap(cid, sectionToTag);
      migrateGoalsForFlatMap(cid, sectionToTag);
      migrateReflectionsForFlatMap(cid, sectionToTag);
    }
  }
  return map;
}
function saveLearningMap(cid, map) {
  var prev = _loadPersistedCourseFieldSnapshot(
    'learningMaps',
    cid,
    (_cache.learningMaps && _cache.learningMaps[cid]) || { subjects: [], sections: [] },
  );
  map._customized = true;
  map._version = (map._version || 0) + 1;
  _saveCourseField('learningMaps', cid, map);
  // The derived tag and section caches key on the map object, and a map
  // edited in place (removeCompetencies) is the same object, so drop them:
  // otherwise counts kept a removed competency.
  delete _allTagsCache[cid];
  delete _tagToSectionCache[cid];
  if (!_writesEnabled() || !_isUuid(cid)) return Promise.resolve(true);
  _registerLearningMapRows(cid, map);
  return _persistLearningMapToCanonical(cid, prev, map);
}
/* A copy of a learning map with every subject, group, section and tag given a
   new local id (references follow), so saving it inserts new rows instead of
   updating the original's. Used when duplicating a class. */
function withFreshLearningMapIds(map) {
  var copy = structuredClone(map || { subjects: [], sections: [] });
  var fresh = { subject: {}, group: {}, section: {}, tag: {} };
  function next(kind, id) {
    if (!id) return id;
    if (!fresh[kind][id]) fresh[kind][id] = uid();
    return fresh[kind][id];
  }
  (copy.subjects || []).forEach(function (sub) {
    sub.id = next('subject', sub.id);
  });
  (copy.competencyGroups || []).forEach(function (g) {
    g.id = next('group', g.id);
  });
  (copy.sections || []).forEach(function (sec) {
    sec.id = next('section', sec.id);
    if (sec.subject) sec.subject = next('subject', sec.subject);
    if (sec.groupId) sec.groupId = next('group', sec.groupId);
    if (sec.competencyGroupId) sec.competencyGroupId = next('group', sec.competencyGroupId);
    (sec.tags || []).forEach(function (tag) {
      tag.id = next('tag', tag.id);
      if (tag.subject) tag.subject = next('subject', tag.subject);
    });
    if (sec.outcome && sec.outcome.id) sec.outcome.id = next('tag', sec.outcome.id);
  });
  return copy;
}

function resetLearningMap(cid) {
  _cache.learningMaps[cid] = _builtInLearningMap(cid); // ref change auto-busts tag/section caches
  // v2: local-only reset. The legacy config_learning_maps table was dropped;
  // the structural learning-map RPCs (upsert_subject / delete_section / etc.)
  // now live under window.v2.* and are called from the UI directly.
  localStorage.removeItem('gb-learningmap-' + cid);
}
function ensureCustomLearningMap(cid) {
  // getLearningMap handles migration, so use it as the source
  var map = getLearningMap(cid);
  if (map._customized) return map;
  const clone = structuredClone(map);
  clone._customized = true;
  clone._version = 1;
  migrateLearningMap(clone);
  _saveCourseField('learningMaps', cid, clone);
  return clone;
}

/* ── Removed competencies ───────────────────────────────────
   Removing a competency takes its section out of the learning map but keeps
   it, and every score tied to it, on the server (section.removed_at). This
   device keeps the removed sections it knows of, so Re-link can say "you
   removed this earlier" and put one back; listRemovedSections fills in the
   ones removed on another device.
   [{ section, removedAt }], newest first. */
function getRemovedSections(cid) {
  var list = _safeParseLS('gb-removed-sections-' + cid, []);
  return Array.isArray(list) ? list : [];
}

function _saveRemovedSections(cid, list) {
  try {
    localStorage.setItem('gb-removed-sections-' + cid, JSON.stringify(list || []));
  } catch (e) {
    /* storage full: the server still has them */
  }
}

/* Merge the server's removed sections into this device's list. */
function mergeRemovedSectionsFromServer(cid, rows) {
  if (!Array.isArray(rows)) return getRemovedSections(cid);
  var list = getRemovedSections(cid);
  var have = {};
  list.forEach(function (r) {
    if (r && r.section) have[r.section.id] = true;
  });
  rows.forEach(function (r) {
    if (!r || have[r.id]) return;
    list.push({
      section: {
        id: r.id,
        name: r.name,
        subject: r.subject_id,
        groupId: r.competency_group_id || null,
        tags: (r.tags || []).map(function (t) {
          return {
            id: t.id,
            code: t.code,
            label: t.label,
            text: t.i_can_text || '',
            i_can_statements: t.i_can_statements || [],
            source_text: t.source_text || null,
            bank_id: t.bank_id || null,
          };
        }),
      },
      removedAt: r.removed_at,
    });
  });
  _saveRemovedSections(cid, list);
  return list;
}

/* Remove competencies (section ids) from the class. Their scores stay. */
function removeCompetencies(cid, sectionIds) {
  var ids = {};
  (sectionIds || []).forEach(function (id) {
    ids[resolveLearningMapId(cid, 'section', id)] = true;
  });
  var map = ensureCustomLearningMap(cid);
  var all = map.sections || [];
  var taken = all.filter(function (s) {
    return ids[s.id];
  });
  if (!taken.length) return 0;
  // Where each one sat: the competencies that came after it (removed with
  // it or not) and its index, so putting it back returns it to its place.
  var place = {};
  all.forEach(function (s, i) {
    if (!ids[s.id]) return;
    place[s.id] = {
      index: i,
      beforeIds: all.slice(i + 1, i + 31).map(function (x) {
        return x.id;
      }),
    };
  });
  map.sections = all.filter(function (s) {
    return !ids[s.id];
  });
  var now = new Date().toISOString();
  var list = getRemovedSections(cid).filter(function (r) {
    return !(r && r.section && ids[r.section.id]);
  });
  _saveRemovedSections(
    cid,
    taken
      .map(function (s) {
        return {
          section: structuredClone(s),
          removedAt: now,
          index: place[s.id].index,
          beforeIds: place[s.id].beforeIds,
        };
      })
      .concat(list),
  );
  saveLearningMap(cid, map);
  return taken.length;
}

/* Put a removed competency back, with its scores. */
function restoreCompetency(cid, sectionId) {
  var list = getRemovedSections(cid);
  var entry = list.find(function (r) {
    return r && r.section && r.section.id === sectionId;
  });
  if (!entry) return false;
  var map = ensureCustomLearningMap(cid);
  var secs = map.sections || [];
  if (
    !secs.some(function (s) {
      return s.id === sectionId;
    })
  ) {
    // Back in its place: before the first competency that followed it and
    // is still there, else at its old position, else at the end (removed
    // before places were kept).
    var at = -1;
    (entry.beforeIds || []).some(function (id) {
      var before = resolveLearningMapId(cid, 'section', id);
      at = secs.findIndex(function (s) {
        return s.id === before;
      });
      return at >= 0;
    });
    if (at < 0 && typeof entry.index === 'number') at = Math.min(entry.index, secs.length);
    if (at < 0) at = secs.length;
    map.sections = secs.slice(0, at).concat([structuredClone(entry.section)], secs.slice(at));
  }
  _saveRemovedSections(
    cid,
    list.filter(function (r) {
      return r !== entry;
    }),
  );
  if (_writesEnabled() && _isUuid(sectionId) && window.v2 && window.v2.restoreSection)
    window.v2.restoreSection(sectionId);
  saveLearningMap(cid, map);
  return true;
}

/* ── Modules (formerly Units) ───────────────────────────────── */
function getModules(cid) {
  if (_cache.modules[cid] !== undefined) return _cache.modules[cid];
  // Pre-init fallback
  try {
    let data = JSON.parse(localStorage.getItem('gb-modules-' + cid));
    if (!data) {
      data = JSON.parse(localStorage.getItem('gb-units-' + cid));
      if (data) {
        _safeLSSet('gb-modules-' + cid, JSON.stringify(data));
        localStorage.removeItem('gb-units-' + cid);
      }
    }
    return data || [];
  } catch (e) {
    console.warn('Modules parse fallback:', e);
    return [];
  }
}
function saveModules(cid, arr) {
  var prev = _loadPersistedCourseFieldSnapshot('modules', cid, (_cache.modules && _cache.modules[cid]) || []);
  _saveCourseField('modules', cid, arr);
  if (!_writesEnabled() || !_isUuid(cid)) return;
  if (!cid || !arr) return;
  _registerLocalRows(cid, 'module', arr, 'upsert_module');
  _persistModulesToCanonical(cid, prev, arr);
}

/* Per-course save lock — same pattern as students / assessments. */
var _moduleSaveQueue = {};

function _moduleChanged(before, after, beforeIdx, afterOrder) {
  var beforeOrder = before.sortOrder != null ? Number(before.sortOrder) : beforeIdx;
  return (
    (before.name || '') !== (after.name || '') ||
    (before.color || null) !== (after.color || null) ||
    beforeOrder !== afterOrder
  );
}

function _persistModulesToCanonical(cid, prev, arr) {
  var sb = getSupabase();
  if (!sb || !window.v2 || !window.v2.upsertModule) return;
  var tail = _moduleSaveQueue[cid] || Promise.resolve();
  var next = tail.then(async function () {
    var hasBaseline = _hasServerState('modules', cid);
    prev = _serverStateOr('modules', cid, prev);
    arr = _cache.modules[cid] || arr;
    var prevById = {};
    prev.forEach(function (m) {
      if (m && m.id) prevById[m.id] = m;
    });
    var arrById = {};
    arr.forEach(function (m) {
      if (m && m.id) arrById[m.id] = m;
    });
    var ops = [];
    // Adds + updates (idempotent — upsert_module handles both)
    arr.forEach(function (m, idx) {
      if (!m || !m.id) return;
      var p = prevById[m.id];
      var displayOrder = m.sortOrder != null ? Number(m.sortOrder) : idx;
      // Against a confirmed baseline, an unchanged module needs no write.
      if (hasBaseline && p && _isUuid(m.id) && !_moduleChanged(p, m, prev.indexOf(p), displayOrder)) return;
      var rec = _isUuid(m.id) ? null : _registerPendingCreate(cid, 'module', m.id, 'upsert_module');
      ops.push(
        window.v2
          .upsertModule(
            {
              id: _isUuid(m.id) ? m.id : null,
              courseId: cid,
              name: m.name || '',
              color: m.color || null,
              displayOrder: displayOrder,
            },
            { entryId: rec ? rec.entryId : undefined },
          )
          .then(function (res) {
            if (res && res.error) {
              if (!res.error.cancelled) console.warn('upsert_module failed:', res.error, m);
              return;
            }
            // An insert re-keys the module and the assessments that point
            // at it (already done when the outbox reported success).
            if (rec) _onCreateLanded(rec.entryId, res && res.data);
          }),
      );
    });
    // Deletes — anything in prev with a canonical id that's missing from arr
    prev.forEach(function (m) {
      if (m && m.id && !arrById[m.id] && _isUuid(m.id) && window.v2.deleteModule) {
        ops.push(
          window.v2.deleteModule(m.id).then(function (res) {
            if (res && res.error) console.warn('delete_module failed:', res.error, m.id);
          }),
        );
      }
    });
    _rememberServerState('modules', cid, arr);
    return Promise.all(ops).catch(function (err) {
      console.warn('Module sync to canonical RPCs failed for one or more rows:', err);
    });
  });
  _moduleSaveQueue[cid] = _trackPendingSync(next);
  return _moduleSaveQueue[cid];
}

function getModuleById(cid, moduleId) {
  return getModules(cid).find(u => u.id === moduleId);
}

var _learningMapSaveQueue = {};
// Local id -> server UUID re-keys learned by earlier learning-map saves, per
// course. A save queued before an earlier one resolved still holds the local
// ids; without applying these it inserts a second copy of every row.
var _learningMapIdRemap = {};

/* The current id of a learning-map row the page may still know by its local
   id: the class manager renders a new subject, group or standard before its
   server id comes back, and its inputs keep the old id until the next render. */
function resolveLearningMapId(cid, kind, id) {
  var known = _learningMapIdRemap[cid];
  return (known && known[kind] && known[kind][id]) || id;
}

function _mapItemsById(items) {
  var out = {};
  (items || []).forEach(function (item) {
    if (item && item.id) out[item.id] = item;
  });
  return out;
}

function _learningMapTags(map) {
  var out = [];
  (map && map.sections ? map.sections : []).forEach(function (section) {
    (section.tags || (section.outcome ? [section.outcome] : [])).forEach(function (tag, idx) {
      if (!tag) return;
      out.push({ tag: tag, section: section, displayOrder: idx });
    });
  });
  return out;
}

/* Swap one id of one kind inside a learning map. Returns whether anything
   changed. Kind matters: in the flat map a section and its tag share an id. */
function _patchLearningMapEntityId(map, kind, oldId, newId) {
  if (!map || !oldId || !newId || oldId === newId) return false;
  var changed = false;
  function swap(obj, prop) {
    if (obj && obj[prop] === oldId) {
      obj[prop] = newId;
      changed = true;
    }
  }
  if (kind === 'subject') {
    (map.subjects || []).forEach(function (subject) {
      swap(subject, 'id');
    });
    (map.sections || []).forEach(function (section) {
      swap(section, 'subject');
      (section.tags || []).forEach(function (tag) {
        swap(tag, 'subject');
      });
    });
  } else if (kind === 'group') {
    (map.competencyGroups || []).forEach(function (group) {
      swap(group, 'id');
    });
    (map.sections || []).forEach(function (section) {
      swap(section, 'groupId');
      swap(section, 'competencyGroupId');
    });
  } else if (kind === 'section') {
    (map.sections || []).forEach(function (section) {
      swap(section, 'id');
    });
  } else if (kind === 'tag') {
    (map.sections || []).forEach(function (section) {
      swap(section.outcome, 'id');
      (section.tags || []).forEach(function (tag) {
        swap(tag, 'id');
      });
    });
  }
  return changed;
}

/* A competency's I Can statements as a clean list: trimmed, no blanks. */
function _iCanStatementsOf(tag) {
  var list = (tag && (tag.i_can_statements || tag.iCanStatements)) || [];
  return Array.isArray(list)
    ? list
        .map(function (s) {
          return String(s || '').trim();
        })
        .filter(Boolean)
    : [];
}

function _stringifyICanText(tag) {
  if (!tag) return '';
  if (typeof tag.text === 'string') return tag.text;
  if (typeof tag.iCanText === 'string') return tag.iCanText;
  if (typeof tag.i_can_text === 'string') return tag.i_can_text;
  if (Array.isArray(tag.i_can_statements)) return tag.i_can_statements.join('\n');
  if (Array.isArray(tag.iCanStatements)) return tag.iCanStatements.join('\n');
  return '';
}

/* The fields each learning-map row is saved with, as sent to the upsert RPCs,
   keyed by row id. Two maps with the same signature for a row need no write. */
function _learningMapSignatures(map) {
  var out = { group: {}, subject: {}, section: {}, tag: {} };
  if (!map) return out;
  (map.competencyGroups || []).forEach(function (g, gi) {
    if (!g) return;
    out.group[g.id] = JSON.stringify([
      g.name || '',
      g.color || null,
      g.displayOrder != null ? Number(g.displayOrder) : gi,
      g.countsAsOne !== false,
    ]);
  });
  (map.subjects || []).forEach(function (sub, si) {
    if (!sub) return;
    out.subject[sub.id] = JSON.stringify([
      sub.name || '',
      sub.color || null,
      sub.displayOrder != null ? Number(sub.displayOrder) : Number(sub.sortOrder || si),
    ]);
  });
  (map.sections || []).forEach(function (sec, xi) {
    if (!sec) return;
    out.section[sec.id] = JSON.stringify([
      sec.subject,
      sec.name || sec.shortName || '',
      sec.color || null,
      sec.groupId || sec.competencyGroupId || null,
      sec.displayOrder != null ? Number(sec.displayOrder) : Number(sec.sortOrder || xi),
    ]);
    (sec.tags || (sec.outcome ? [sec.outcome] : [])).forEach(function (tag, ti) {
      if (!tag) return;
      out.tag[tag.id] = JSON.stringify([
        sec.id,
        tag.label || tag.name || sec.name || '',
        tag.code || tag.shortName || '',
        _stringifyICanText(tag),
        _iCanStatementsOf(tag),
        tag.source_text || null,
        tag.bank_id || null,
        tag.displayOrder != null ? Number(tag.displayOrder) : Number(tag.sortOrder || ti),
      ]);
    });
  });
  return out;
}

function _persistLearningMapToCanonical(cid, prevMap, nextMap) {
  if (!window.v2 || !window.v2.upsertSubject || !window.v2.upsertSection || !window.v2.upsertTag) return;
  var tail = _learningMapSaveQueue[cid] || Promise.resolve();
  var next = tail.then(async function () {
    var map = structuredClone(nextMap || { subjects: [], sections: [] });
    // Against a confirmed baseline, rows whose saved fields haven't changed
    // are skipped; without one, every row is sent as before.
    var hasBaseline = _hasServerState('learningMaps', cid);
    var baseline = _serverStateOr('learningMaps', cid, prevMap);
    var sent = hasBaseline ? _learningMapSignatures(baseline) : null;
    var current = hasBaseline ? _learningMapSignatures(map) : null;
    function unchanged(kind, id) {
      return !!(sent && _isUuid(id) && sent[kind][id] !== undefined && sent[kind][id] === current[kind][id]);
    }
    if (!_learningMapIdRemap[cid]) _learningMapIdRemap[cid] = { subject: {}, group: {}, section: {}, tag: {} };
    var known = _learningMapIdRemap[cid];
    function applyKnown(target) {
      ['group', 'subject', 'section', 'tag'].forEach(function (kind) {
        Object.keys(known[kind]).forEach(function (oldId) {
          _patchLearningMapEntityId(target, kind, oldId, known[kind][oldId]);
        });
      });
    }
    applyKnown(map);
    // Every row is pushed before any is awaited, so an offline save leaves
    // the whole map in the outbox, not just its first row. A row that names
    // a parent still on a local id (a section under a new subject, a tag
    // under a new section) waits in the outbox behind that parent's insert
    // and is re-keyed when it lands; nothing here threads ids by hand.
    var ops = [];
    function upsert(kind, localId, send) {
      var rec = _isUuid(localId) ? null : _pendingCreateFor(kind, localId);
      ops.push(
        send({ entryId: rec ? rec.entryId : undefined }).then(function (res) {
          if (res && res.error) {
            if (res.error.cancelled) return;
            throw res.error;
          }
          if (rec) _onCreateLanded(rec.entryId, res && res.data);
        }),
      );
    }

    var groups = map.competencyGroups || [];
    if (window.v2.upsertCompetencyGroup) {
      groups.forEach(function (group, gi) {
        if (!group || unchanged('group', group.id)) return;
        upsert('group', group.id, function (options) {
          return window.v2.upsertCompetencyGroup(
            {
              id: _isUuid(group.id) ? group.id : null,
              courseId: cid,
              name: group.name || '',
              color: group.color || null,
              displayOrder: group.displayOrder != null ? Number(group.displayOrder) : gi,
              countsAsOne: group.countsAsOne !== false,
            },
            options,
          );
        });
      });
    }

    (map.subjects || []).forEach(function (subject, si) {
      if (!subject || unchanged('subject', subject.id)) return;
      upsert('subject', subject.id, function (options) {
        return window.v2.upsertSubject(
          {
            id: _isUuid(subject.id) ? subject.id : null,
            courseId: cid,
            name: subject.name || '',
            color: subject.color || null,
            displayOrder: subject.displayOrder != null ? Number(subject.displayOrder) : Number(subject.sortOrder || si),
          },
          options,
        );
      });
    });

    (map.sections || []).forEach(function (section, xi) {
      if (!section) return;
      if (!unchanged('section', section.id)) {
        upsert('section', section.id, function (options) {
          return window.v2.upsertSection(
            {
              id: _isUuid(section.id) ? section.id : null,
              subjectId: section.subject,
              name: section.name || section.shortName || '',
              color: section.color || null,
              competencyGroupId: section.groupId || section.competencyGroupId || null,
              displayOrder:
                section.displayOrder != null ? Number(section.displayOrder) : Number(section.sortOrder || xi),
            },
            options,
          );
        });
      }
      var tags = section.tags || (section.outcome ? [section.outcome] : []);
      tags.forEach(function (tag, ti) {
        if (!tag || unchanged('tag', tag.id)) return;
        upsert('tag', tag.id, function (options) {
          return window.v2.upsertTag(
            {
              id: _isUuid(tag.id) ? tag.id : null,
              sectionId: section.id,
              label: tag.label || tag.name || section.name || '',
              code: tag.code || tag.shortName || '',
              iCanText: _stringifyICanText(tag),
              iCanStatements: _iCanStatementsOf(tag),
              sourceText: tag.source_text || null,
              bankId: tag.bank_id || null,
              displayOrder: tag.displayOrder != null ? Number(tag.displayOrder) : Number(tag.sortOrder || ti),
            },
            options,
          );
        });
      });
    });

    var opsToDelete = [];
    var nextSubjects = _mapItemsById(map.subjects || []);
    var nextGroups = _mapItemsById(map.competencyGroups || []);
    var nextSections = _mapItemsById(map.sections || []);
    var nextTags = _mapItemsById(
      _learningMapTags(map).map(function (entry) {
        return entry.tag;
      }),
    );
    var prevSubjects = _mapItemsById((baseline && baseline.subjects) || []);
    var prevGroups = _mapItemsById((baseline && baseline.competencyGroups) || []);
    var prevSections = _mapItemsById((baseline && baseline.sections) || []);
    var prevTags = _mapItemsById(
      _learningMapTags(baseline || {}).map(function (entry) {
        return entry.tag;
      }),
    );

    // A removed competency (getRemovedSections) is kept on the server with
    // its scores: its section is marked removed, and its tags stay.
    var softRemoved = {};
    getRemovedSections(cid).forEach(function (r) {
      if (r && r.section) softRemoved[r.section.id] = true;
    });
    var keptTags = {};
    ((baseline && baseline.sections) || []).forEach(function (sec) {
      if (!softRemoved[sec.id]) return;
      (sec.tags || []).forEach(function (t) {
        if (t) keptTags[t.id] = true;
      });
    });
    // A row removed while its insert is still queued is simply not inserted;
    // one whose insert was sent is deleted by its server id.
    [
      ['tag', prevTags, nextTags, window.v2.deleteTag],
      ['section', prevSections, nextSections, window.v2.deleteSection],
      ['group', prevGroups, nextGroups, window.v2.deleteCompetencyGroup],
      ['subject', prevSubjects, nextSubjects, window.v2.deleteSubject],
    ].forEach(function (pair) {
      Object.keys(pair[1]).forEach(function (id) {
        if (pair[2][id]) return;
        if (pair[0] === 'tag' && keptTags[id]) return;
        var gone = _cancelPendingCreateOrResolve(cid, pair[0], id);
        if (!gone) return;
        if (pair[0] === 'section' && softRemoved[id]) {
          if (window.v2.removeSection) opsToDelete.push(window.v2.removeSection(gone));
          return;
        }
        if (pair[3]) opsToDelete.push(pair[3](gone));
      });
    });
    opsToDelete.forEach(function (op) {
      ops.push(
        op.then(function (res) {
          if (res && res.error) throw res.error;
        }),
      );
    });
    await Promise.all(ops);

    // Inserts re-keyed the live map as they landed (_rekey). The baseline is
    // this save's copy with those ids, not the live map: replacing it with
    // the live one would hide anything edited while the sync was running.
    applyKnown(map);
    _rememberServerState('learningMaps', cid, map);
    return true;
  });
  // Resolves true once the map reached the server, false if it failed.
  _learningMapSaveQueue[cid] = _trackPendingSync(
    next.catch(function (err) {
      console.warn('Learning map sync to canonical RPCs failed:', err);
      if (typeof showSyncToast === 'function') {
        showSyncToast('Learning map saved locally. Cloud sync needs attention.', 'error');
      }
      return false;
    }),
  );
  return _learningMapSaveQueue[cid];
}

var _categorySaveQueue = {};

function _categoryChanged(a, b, idx) {
  return (
    !a ||
    (a.name || '') !== (b.name || '') ||
    Number(a.weight || 0) !== Number(b.weight || 0) ||
    categoryCalcMode(a) !== categoryCalcMode(b) ||
    Number(a.displayOrder ?? a.display_order ?? idx) !== Number(b.displayOrder ?? b.display_order ?? idx)
  );
}

/* Categories go up as one list (save_categories): weights must total 100,
   which a row-at-a-time save can't keep while weights change. */
function _persistCategoriesToCanonical(cid, prev, arr, copy) {
  if (!window.v2 || !window.v2.saveCategories) return;
  var tail = _categorySaveQueue[cid] || Promise.resolve();
  var next = tail.then(function () {
    prev = _serverStateOr('categories', cid, prev);
    arr = (_cache.categories[cid] || arr || []).filter(Boolean);
    var prevById = {};
    (prev || []).forEach(function (category) {
      if (category && category.id) prevById[category.id] = category;
    });
    var prevIds = (prev || [])
      .filter(Boolean)
      .map(function (category) {
        return category.id;
      })
      .join(',');
    var nextIds = arr
      .map(function (category) {
        return category.id;
      })
      .join(',');
    var changed =
      prevIds !== nextIds ||
      arr.some(function (category, idx) {
        return _categoryChanged(prevById[category.id], category, idx);
      });
    if (!changed) return;
    var before = _cloneValue(prev);
    _rememberServerState('categories', cid, arr);
    // One save creates every new row; the server answers with the ids in
    // list order, so each new row's record remembers its position.
    var entryId = null;
    arr.forEach(function (category, idx) {
      if (_isUuid(category.id) || _resolveKnownId('category', category.id) !== category.id) return;
      var rec = _registerPendingCreate(cid, 'category', category.id, 'save_categories', {
        entryId: entryId,
        index: idx,
      });
      if (rec && !entryId) entryId = rec.entryId;
    });
    // Kept with the queued save: the list it was made over. If it has to
    // wait, it is sent only over that list (_guardCategorySave).
    var guard = { expected: _categoryListKept(before) };
    if (_plainObject(copy)) guard.copy = { from: String(copy.from || ''), rest: !!copy.rest };
    var options = {
      entryId: entryId || undefined,
      guard: guard,
      categoriesMadeAt: Date.now(),
    };
    return window.v2.saveCategories(cid, arr, options).then(function (res) {
      // Rejected or refused: the server still has the old list, so the
      // next save sends the whole list again.
      if (res && res.error && !res.error.cancelled) _rememberServerState('categories', cid, before);
      if (res && res.error) throw res.error;
      // Re-keys the rows and the assessments that point at them (already
      // done when the outbox reported success).
      if (entryId) _onCreateLanded(entryId, res && res.data);
      // The server holds this list now: a "not copied" line for the class
      // would no longer be true.
      _clearCategoriesNotCopied(cid);
    });
  });
  _categorySaveQueue[cid] = _trackPendingSync(
    next.catch(function (err) {
      console.warn('Category sync to canonical RPCs failed:', err);
    }),
  );
  return _categorySaveQueue[cid];
}

function _persistStatusDiffToCanonical(prev, next) {
  var sb = getSupabase();
  if (!sb) return;
  var keys = {};
  Object.keys(prev || {}).forEach(function (key) {
    keys[key] = true;
  });
  Object.keys(next || {}).forEach(function (key) {
    keys[key] = true;
  });
  Object.keys(keys).forEach(function (key) {
    var before = (prev || {})[key] || null;
    var after = (next || {})[key] || null;
    if (before === after) return;
    var parts = key.split(':');
    if (parts.length < 2) return;
    var enrollmentId = parts[0];
    var assessmentId = parts.slice(1).join(':');
    if (!_isSendableId(enrollmentId) || !_isSendableId(assessmentId)) return;
    _trackPendingSync(
      _writeRpc('set_score_status', {
        p_enrollment_id: enrollmentId,
        p_assessment_id: assessmentId,
        p_status: after || null,
      }).then(function (res) {
        if (res.error) console.warn('set_score_status RPC failed:', res.error);
      }),
    );
  });
}

/* ── Assignment Statuses (excused / not-submitted) ─────────── */
function getAssignmentStatuses(cid) {
  if (_cache.statuses[cid] !== undefined) return _cache.statuses[cid];
  try {
    return JSON.parse(localStorage.getItem('gb-statuses-' + cid)) || {};
  } catch (e) {
    console.warn('Statuses parse fallback:', e);
    return {};
  }
}
function saveAssignmentStatuses(cid, obj) {
  _applyIdRekeysToStatuses(cid, obj);
  var prev = _loadPersistedCourseFieldSnapshot('statuses', cid, (_cache.statuses && _cache.statuses[cid]) || {});
  var next = obj || {};
  _saveCourseField('statuses', cid, next);
  // Missing or Excused on a linked group member clears their copy of the
  // group grade; taking it off copies it back (Group grading).
  if (!_groupWriteDepth) _syncGroupStatuses(cid, prev, next);
  if (!_writesEnabled() || !_isUuid(cid)) return true;
  var refusals = _writeRefusals;
  var baseline = _serverStateOr('statuses', cid, prev);
  _persistStatusDiffToCanonical(baseline, next);
  _dismissOverriddenStatusWrites(cid, baseline, next);
  _rememberServerState('statuses', cid, next);
  // A refused write's cell goes back in the baseline (_onWriteRefused).
  return _writeRefusals === refusals;
}
function getAssignmentStatus(cid, sid, aid) {
  return getAssignmentStatuses(cid)[sid + ':' + aid] || null;
}
/* Missing and Excused are for work that wasn't handed in. Neither is ever
   set on work that has a score or feedback: a level, points, a Complete or
   Incomplete mark, a DIBELS number, a criterion note or the Overall
   Comment. An observation linked to the work is not feedback on it
   (Assignment feedback, DECISIONS). Late is for work that was handed in, so
   it is always allowed, and a status already on a cell can always be taken
   off. */
function hasScoreOrFeedback(cid, sid, aid) {
  var assess = _assessmentById(cid, aid);
  var entered = (getScores(cid)[sid] || []).some(function (e) {
    return e && e.assessmentId === aid && (isScoreEntered(assess, e) || !!e.note || !!e.critNote || !!e.critBeyond);
  });
  if (entered) return true;
  var dibels = getDibelsScores(cid)[sid + ':' + aid];
  return !!dibels && Object.keys(dibels).length > 0;
}
function canSetAssignmentStatus(cid, sid, aid, status) {
  if (status !== 'NS' && status !== 'EXC') return true;
  if (getAssignmentStatus(cid, sid, aid) === status) return true;
  // A linked group member's score is the group's copy; Missing or Excused
  // sets it aside (setAssignmentStatus, Group grading). A grade of their own
  // is held to the rule like anyone's.
  if (isLinkedGroupMember(cid, aid, sid) && _holdsGroupCopy(cid, aid, sid)) return true;
  return !hasScoreOrFeedback(cid, sid, aid);
}
/* The other half of the rule: Missing or Excused work takes no score. A
   level, points or a Complete/Incomplete mark on it is refused by the score
   writers (upsertScore, setPointsScore, setCompletionMark), so a key, a
   typed number and a click all obey it; clearing a score always works.
   Taking the status off is how the work is scored. */
function isScoreLocked(cid, sid, aid) {
  var status = getAssignmentStatus(cid, sid, aid);
  return status === 'NS' || status === 'EXC';
}
function setAssignmentStatus(cid, sid, aid, status) {
  if (!canSetAssignmentStatus(cid, sid, aid, status)) return false;
  const st = getAssignmentStatuses(cid);
  const key = sid + ':' + aid;
  if (status) st[key] = status;
  else delete st[key];
  // saveAssignmentStatuses' diff sends the one set_score_status for this cell.
  return saveAssignmentStatuses(cid, st);
}
// Sets a cell's status the way a teacher means it: NS also clears the
// proficiency levels (0 deletes a tag score). On points and
// Complete/Incomplete work 0 is a real score that would outlive the NS, and
// calc.js already counts NS as 0, so the score is left alone. Returns true
// when the NS cleared scores, so callers can reset their score controls.
// Missing or Excused on work with a score or feedback is refused (false).
function applyAssignmentStatus(cid, sid, aid, status) {
  if (!canSetAssignmentStatus(cid, sid, aid, status)) return false;
  setAssignmentStatus(cid, sid, aid, status);
  var assess = getAssessments(cid).find(function (a) {
    return a.id === aid;
  });
  if (status !== 'NS' || !assess || isPointsScored(assess)) return false;
  scoreTagIds(assess, cid).forEach(function (tagId) {
    upsertScore(cid, sid, aid, tagId, 0, assess.date || '', scoreTypeFor(assess), '');
  });
  return true;
}

/* ── Rubrics ───────────────────────────────────────────────── */
function getRubrics(cid) {
  if (_cache.rubrics[cid] !== undefined) return _cache.rubrics[cid];
  try {
    return JSON.parse(localStorage.getItem('gb-rubrics-' + cid)) || [];
  } catch (e) {
    console.warn('Rubrics parse fallback:', e);
    return [];
  }
}
var _rubricSaveQueue = {};
function _rubricName(rubric) {
  return (rubric && (rubric.name || rubric.title)) || '';
}
function _rubricCriteriaPayload(rubric) {
  return (rubric && rubric.criteria ? rubric.criteria : []).map(function (crit, idx) {
    var levels = crit && crit.levels ? crit.levels : {};
    var levelValues = crit && crit.levelValues ? crit.levelValues : {};
    var payload = {
      name: (crit && (crit.name || crit.label)) || '',
      level4Descriptor: levels[4] || levels['4'] || '',
      level3Descriptor: levels[3] || levels['3'] || '',
      level2Descriptor: levels[2] || levels['2'] || '',
      level1Descriptor: levels[1] || levels['1'] || '',
      weight: crit && crit.weight != null && !isNaN(Number(crit.weight)) ? Number(crit.weight) : 1,
      displayOrder:
        crit && crit.displayOrder != null && !isNaN(Number(crit.displayOrder)) ? Number(crit.displayOrder) : idx,
      linkedTagIds: crit && crit.tagIds ? crit.tagIds : [],
    };
    if (levelValues[4] != null || levelValues['4'] != null)
      payload.level4Value = Number(levelValues[4] != null ? levelValues[4] : levelValues['4']);
    if (levelValues[3] != null || levelValues['3'] != null)
      payload.level3Value = Number(levelValues[3] != null ? levelValues[3] : levelValues['3']);
    if (levelValues[2] != null || levelValues['2'] != null)
      payload.level2Value = Number(levelValues[2] != null ? levelValues[2] : levelValues['2']);
    if (levelValues[1] != null || levelValues['1'] != null)
      payload.level1Value = Number(levelValues[1] != null ? levelValues[1] : levelValues['1']);
    if (crit && _isUuid(crit.id)) payload.id = crit.id;
    // Advanced Rubrics: the checkboxes in each level cell, ordered within
    // their level. A Standard rubric sends an empty list, which clears any
    // checkboxes it had.
    var perLevel = {};
    payload.checks = (crit && crit.checks ? crit.checks : [])
      .filter(function (check) {
        return check && Number(check.level) >= 1 && Number(check.level) <= 4;
      })
      .map(function (check) {
        var level = Number(check.level);
        var at = perLevel[level] || 0;
        perLevel[level] = at + 1;
        var row = { level: level, label: String(check.label == null ? '' : check.label), displayOrder: at };
        if (_isUuid(check.id)) row.id = check.id;
        return row;
      });
    return payload;
  });
}
/* 'advanced' or 'single_point' when the rubric says so; anything else, a
   missing field included, is a Standard rubric. */
var RUBRIC_STYLES = ['standard', 'advanced', 'single_point'];
function rubricStyle(rubric) {
  return rubric && RUBRIC_STYLES.indexOf(rubric.style) > 0 ? rubric.style : 'standard';
}
async function _loadCanonicalRubrics(cid) {
  var sb = getSupabase();
  if (!sb || !_isUuid(cid) || typeof sb.from !== 'function') return [];

  var rubricsQuery = sb.from('rubric').select('id,name,created_at,copy_group,style');
  if (typeof rubricsQuery.eq === 'function') rubricsQuery = rubricsQuery.eq('course_id', cid);
  var rubricsRes = await rubricsQuery;
  if (rubricsRes.error) throw rubricsRes.error;

  var rubricRows = (rubricsRes.data || []).slice().sort(function (a, b) {
    var aKey = a.created_at || a.id || '';
    var bKey = b.created_at || b.id || '';
    return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
  });
  if (rubricRows.length === 0) return [];

  var rubricIds = rubricRows.map(function (r) {
    return r.id;
  });
  var criteriaQuery = sb
    .from('criterion')
    .select(
      'id,rubric_id,name,level_4_descriptor,level_3_descriptor,level_2_descriptor,level_1_descriptor,' +
        'level_4_value,level_3_value,level_2_value,level_1_value,weight,display_order',
    );
  if (typeof criteriaQuery.in === 'function') criteriaQuery = criteriaQuery.in('rubric_id', rubricIds);
  var criteriaRes = await criteriaQuery;
  if (criteriaRes.error) throw criteriaRes.error;

  var criterionRows = (criteriaRes.data || []).slice().sort(function (a, b) {
    var ao = Number(a.display_order || 0);
    var bo = Number(b.display_order || 0);
    if (ao !== bo) return ao - bo;
    return (a.id || '') < (b.id || '') ? -1 : 1;
  });
  var criterionIds = criterionRows.map(function (c) {
    return c.id;
  });

  var criterionTagRows = [];
  var criterionCheckRows = [];
  if (criterionIds.length > 0) {
    var tagsQuery = sb.from('criterion_tag').select('criterion_id,tag_id');
    if (typeof tagsQuery.in === 'function') tagsQuery = tagsQuery.in('criterion_id', criterionIds);
    var tagsRes = await tagsQuery;
    if (tagsRes.error) throw tagsRes.error;
    criterionTagRows = tagsRes.data || [];

    var checksQuery = sb.from('criterion_check').select('id,criterion_id,level,label,display_order');
    if (typeof checksQuery.in === 'function') checksQuery = checksQuery.in('criterion_id', criterionIds);
    var checksRes = await checksQuery;
    if (checksRes.error) throw checksRes.error;
    criterionCheckRows = checksRes.data || [];
  }

  // Competencies the whole rubric scores.
  var rubricTagQuery = sb.from('rubric_tag').select('rubric_id,tag_id');
  if (typeof rubricTagQuery.in === 'function') rubricTagQuery = rubricTagQuery.in('rubric_id', rubricIds);
  var rubricTagRes = await rubricTagQuery;
  if (rubricTagRes.error) throw rubricTagRes.error;

  return _canonicalRubricRowsToCache(
    rubricRows,
    criterionRows,
    criterionTagRows,
    criterionCheckRows,
    rubricTagRes.data || [],
  );
}

/* rubric, criterion, criterion_tag, criterion_check and rubric_tag rows →
   the client's rubric list. Used by the table reads above and by
   get_class_bundle. A rubric row without `style` (a bundle from before
   Advanced Rubrics) is Standard. rubric_tag rows are the competencies the
   whole rubric scores (`tagIds`); a bundle from before them has none. */
function _canonicalRubricRowsToCache(rubricRows, criterionRows, criterionTagRows, criterionCheckRows, rubricTagRows) {
  rubricRows = (rubricRows || []).slice().sort(function (a, b) {
    var aKey = a.created_at || a.id || '';
    var bKey = b.created_at || b.id || '';
    return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
  });
  criterionRows = (criterionRows || []).slice().sort(function (a, b) {
    var ao = Number(a.display_order || 0);
    var bo = Number(b.display_order || 0);
    if (ao !== bo) return ao - bo;
    return (a.id || '') < (b.id || '') ? -1 : 1;
  });
  criterionTagRows = criterionTagRows || [];
  var tagsByCriterion = {};
  criterionTagRows.forEach(function (row) {
    if (!row || !row.criterion_id || !row.tag_id) return;
    if (!tagsByCriterion[row.criterion_id]) tagsByCriterion[row.criterion_id] = [];
    tagsByCriterion[row.criterion_id].push(row.tag_id);
  });
  // Checkboxes in display order within their level, then by id, the order
  // _resolveRubricCriteria pairs new ones by.
  var checksByCriterion = {};
  (criterionCheckRows || [])
    .slice()
    .sort(function (a, b) {
      var ao = Number(a.display_order || 0);
      var bo = Number(b.display_order || 0);
      if (ao !== bo) return ao - bo;
      return (a.id || '') < (b.id || '') ? -1 : 1;
    })
    .forEach(function (row) {
      if (!row || !row.criterion_id || !row.id) return;
      if (!checksByCriterion[row.criterion_id]) checksByCriterion[row.criterion_id] = [];
      checksByCriterion[row.criterion_id].push({
        id: row.id,
        level: Number(row.level),
        label: row.label || '',
        displayOrder: Number(row.display_order || 0),
      });
    });

  var tagsByRubric = {};
  (rubricTagRows || []).forEach(function (row) {
    if (!row || !row.rubric_id || !row.tag_id) return;
    if (!tagsByRubric[row.rubric_id]) tagsByRubric[row.rubric_id] = [];
    tagsByRubric[row.rubric_id].push(row.tag_id);
  });

  var criteriaByRubric = {};
  criterionRows.forEach(function (row) {
    if (!row || !row.rubric_id) return;
    var levelValues = {};
    var level4Value = Number(row.level_4_value);
    var level3Value = Number(row.level_3_value);
    var level2Value = Number(row.level_2_value);
    var level1Value = Number(row.level_1_value);
    if (!isNaN(level4Value) && level4Value !== 4) levelValues[4] = level4Value;
    if (!isNaN(level3Value) && level3Value !== 3) levelValues[3] = level3Value;
    if (!isNaN(level2Value) && level2Value !== 2) levelValues[2] = level2Value;
    if (!isNaN(level1Value) && level1Value !== 1) levelValues[1] = level1Value;
    if (!criteriaByRubric[row.rubric_id]) criteriaByRubric[row.rubric_id] = [];
    criteriaByRubric[row.rubric_id].push({
      id: row.id,
      name: row.name || '',
      label: row.name || '',
      tagIds: (tagsByCriterion[row.id] || []).slice(),
      levels: {
        4: row.level_4_descriptor || '',
        3: row.level_3_descriptor || '',
        2: row.level_2_descriptor || '',
        1: row.level_1_descriptor || '',
      },
      weight: row.weight != null && !isNaN(Number(row.weight)) ? Number(row.weight) : 1,
      displayOrder: Number(row.display_order || 0),
      levelValues: Object.keys(levelValues).length ? levelValues : null,
      checks: checksByCriterion[row.id] || [],
    });
  });

  return rubricRows.map(function (row) {
    var rubric = {
      id: row.id,
      name: row.name || '',
      title: row.name || '',
      style: rubricStyle(row),
      tagIds: (tagsByRubric[row.id] || []).slice(),
      criteria: criteriaByRubric[row.id] || [],
    };
    if (row.copy_group) rubric.copyGroup = row.copy_group;
    return rubric;
  });
}

function _reconcileCanonicalRubrics(localArr, canonicalArr, idMap) {
  localArr = localArr || [];
  canonicalArr = canonicalArr || [];
  idMap = idMap || {};
  var canonicalById = {};
  canonicalArr.forEach(function (rubric) {
    if (rubric && rubric.id) canonicalById[rubric.id] = rubric;
  });
  var used = {};
  var merged = [];

  localArr.forEach(function (rubric) {
    if (!rubric) return;
    var canonicalId = idMap[rubric.id] || (_isUuid(rubric.id) ? rubric.id : null);
    var canonical = canonicalId ? canonicalById[canonicalId] : null;
    if (!canonical) {
      var matches = canonicalArr.filter(function (candidate) {
        return (
          candidate &&
          !used[candidate.id] &&
          _rubricName(candidate) === _rubricName(rubric) &&
          (candidate.criteria || []).length === (rubric.criteria || []).length
        );
      });
      if (matches.length === 1) canonical = matches[0];
    }
    if (canonical) {
      used[canonical.id] = true;
      merged.push(canonical);
    } else {
      merged.push(rubric);
    }
  });

  canonicalArr.forEach(function (rubric) {
    if (rubric && !used[rubric.id]) merged.push(rubric);
  });
  return merged;
}
/* The fields a rubric is saved with; equal signatures need no write. */
function _rubricSignature(rubric) {
  return JSON.stringify([
    _rubricName(rubric),
    _rubricCriteriaPayload(rubric),
    (rubric && rubric.copyGroup) || null,
    rubricStyle(rubric),
    _rubricWholeTagIds(rubric),
  ]);
}
/* The competencies a whole rubric scores, as saved: server ids only. */
function _rubricWholeTagIds(rubric) {
  return ((rubric && rubric.tagIds) || []).filter(_isUuid);
}
/* What the teacher typed, ids left out: a save in progress re-keys ids. */
function _rubricsContentSignature(rubrics) {
  return JSON.stringify(
    (rubrics || []).map(function (rubric) {
      return [
        _rubricName(rubric),
        _rubricCriteriaPayload(rubric).map(function (c) {
          var copy = Object.assign({}, c);
          delete copy.id;
          return copy;
        }),
      ];
    }),
  );
}

function _persistRubricsToCanonical(cid, prev, arr) {
  var tail = _rubricSaveQueue[cid] || Promise.resolve({ rubrics: arr || [], idMap: {} });
  var next = tail
    .then(async function () {
      var target = Array.isArray(arr) ? arr : [];
      // Against a confirmed baseline only changed rubrics are sent; without
      // one, every rubric is sent as before.
      var hasBaseline = _hasServerState('rubrics', cid);
      var previous = _serverStateOr('rubrics', cid, Array.isArray(prev) ? prev : []) || [];
      var sentById = {};
      previous.forEach(function (r) {
        if (r && _isUuid(r.id)) sentById[r.id] = _rubricSignature(r);
      });
      var startedWith = _rubricsContentSignature(target);
      var idMap = {};
      var keptCanonicalIds = {};
      var insertedRows = false;
      // Every upsert is pushed before any is awaited, so an offline save
      // leaves them all in the outbox.
      var ops = [];
      var landed = [];

      target.forEach(function (rubric) {
        if (!rubric) return;
        if (_isUuid(rubric.id)) keptCanonicalIds[rubric.id] = true;
        if (hasBaseline && _isUuid(rubric.id) && sentById[rubric.id] === _rubricSignature(rubric)) return;
        if (
          !_isUuid(rubric.id) ||
          (rubric.criteria || []).some(function (c) {
            return (
              !(c && _isUuid(c.id)) ||
              (c.checks || []).some(function (check) {
                return !(check && _isUuid(check.id));
              })
            );
          })
        ) {
          insertedRows = true;
        }
        // The rubric's own record, or a new criterion's or checkbox's inside
        // an existing rubric: any of them names the entry this upsert is.
        var rec = _isUuid(rubric.id) ? null : _pendingCreateFor('rubric', rubric.id);
        if (!rec) {
          (rubric.criteria || []).some(function (c) {
            if (!c) return false;
            rec = !_isUuid(c.id) ? _pendingCreateFor('criterion', c.id) : null;
            if (!rec) {
              (c.checks || []).some(function (check) {
                rec = check && !_isUuid(check.id) ? _pendingCreateFor('check', check.id) : null;
                return !!rec;
              });
            }
            return !!rec;
          });
        }
        ops.push(
          window.v2
            .upsertRubric(
              {
                id: rubric.id,
                courseId: cid,
                name: _rubricName(rubric),
                style: rubricStyle(rubric),
                criteria: _rubricCriteriaPayload(rubric),
                copyGroup: rubric.copyGroup || null,
                // null when this copy never loaded them: the server keeps its own.
                linkedTagIds: rubric && Array.isArray(rubric.tagIds) ? _rubricWholeTagIds(rubric) : null,
              },
              { entryId: rec ? rec.entryId : undefined },
            )
            .then(function (res) {
              if (res && res.error) {
                if (res.error.cancelled) return;
                throw res.error;
              }
              var canonicalId = res && res.data ? res.data : _isUuid(rubric.id) ? rubric.id : null;
              if (canonicalId) {
                keptCanonicalIds[canonicalId] = true;
                if (rubric.id && rubric.id !== canonicalId) idMap[rubric.id] = canonicalId;
              }
              // Re-keys the rubric, then reads the criteria ids back
              // (already done when the outbox reported success).
              if (rec) landed.push(_onCreateLanded(rec.entryId, res && res.data));
            }),
        );
      });

      // A rubric removed while its insert is still queued is simply not
      // inserted; one whose insert was sent is deleted by its server id.
      previous.forEach(function (oldRubric) {
        if (!oldRubric || !oldRubric.id || keptCanonicalIds[oldRubric.id]) return;
        var gone = _cancelPendingCreateOrResolve(cid, 'rubric', oldRubric.id);
        if (!gone) return;
        ops.push(
          window.v2.deleteRubric(gone).then(function (res) {
            if (res && res.error) throw res.error;
          }),
        );
      });
      await Promise.all(ops);
      await Promise.all(landed);

      if (!insertedRows) {
        // Nothing new was created, so every id the cache holds is already the
        // server's: no reload needed.
        _rememberServerState('rubrics', cid, target);
        return { rubrics: target, idMap: idMap };
      }

      var canonicalArr = await _loadCanonicalRubrics(cid);
      var reconciled = _reconcileCanonicalRubrics(target, canonicalArr, idMap);
      _rememberServerState('rubrics', cid, reconciled);
      // Only adopt the server's copy if nothing was edited while this ran; a
      // newer edit has its own save queued, which reconciles after it.
      // _rekey already swapped the new ids into the live copy, so compare
      // with those applied.
      var live = _cache.rubrics[cid];
      if (live === target && _rubricsContentSignature(live) === startedWith) {
        _saveCourseField('rubrics', cid, reconciled);
      }
      return { rubrics: reconciled, idMap: idMap };
    })
    .catch(function (err) {
      console.warn('Rubric sync to canonical RPCs failed:', err);
      if (typeof showSyncToast === 'function') {
        showSyncToast('Rubric saved locally. Cloud sync needs attention.', 'error');
      }
      return { rubrics: arr || [], idMap: {} };
    });
  _rubricSaveQueue[cid] = _trackPendingSync(next);
  return _rubricSaveQueue[cid];
}
/* Re-send a class's rubrics once, after the competencies they link to get
   their server ids (see the 'tag' re-key). Several competencies landing
   together send one save. */
var _rubricLinkResend = {};
function _resendRubricLinks(cid) {
  if (_rubricLinkResend[cid]) return;
  _rubricLinkResend[cid] = setTimeout(function () {
    delete _rubricLinkResend[cid];
    if (_isUuid(cid)) saveRubrics(cid, getRubrics(cid));
  }, 0);
}
function saveRubrics(cid, arr) {
  var nextArr = Array.isArray(arr) ? arr : [];
  var prev = _safeParseLS('gb-rubrics-' + cid, []);
  _saveCourseField('rubrics', cid, nextArr);
  if (!_writesEnabled() || !_isUuid(cid)) {
    return Promise.resolve({ rubrics: nextArr, idMap: {} });
  }
  _registerRubricRows(cid, nextArr);
  return _persistRubricsToCanonical(cid, prev, nextArr);
}
function getRubricById(cid, rubricId) {
  return getRubrics(cid).find(r => r.id === rubricId);
}

/* ── Advanced Rubric checkboxes (migrations/20261022_advanced_rubric_checks.sql)
   A tick is a rubric_check_score row: (enrollment, assessment, check). In
   the cache they are { 'sid:aid': [checkId, …] }, in localStorage under
   gb-rubric-checks-<cid>, written through the outbox with set_rubric_check
   so a tick made offline lands later. The level a tick suggests is the
   client's business (shared/rubric-checks.js); nothing here changes a score. */
function getRubricChecks(cid) {
  if (_cache.rubricChecks[cid] !== undefined) return _cache.rubricChecks[cid];
  var stored = _safeParseLS('gb-rubric-checks-' + cid, {});
  _cache.rubricChecks[cid] = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
  return _cache.rubricChecks[cid];
}
/* Replace every tick in a class at once, cache and localStorage only.
   Demo Mode's seed uses it; nothing is sent to the server. */
function saveRubricChecks(cid, checks) {
  checks = checks && typeof checks === 'object' && !Array.isArray(checks) ? checks : {};
  var gradesWere = _gradeBefore(cid, 'rubricChecks');
  _saveCourseField('rubricChecks', cid, checks);
  _gradeAfter(cid, gradesWere, checks);
}
/* Edit a Copy on scored work (assessment form redesign PR 10): the copy's
   criteria and checkboxes have new ids, so this assessment's rubric scores
   (with their ± and comments) and ticked checkboxes move to them. On this
   device at once, in the cache and its saved copy, so a later save sends
   nothing for the move; on the server in one transaction
   (move_rubric_scores, migrations/20261102_move_rubric_scores.sql, which checks every target is on the copied rubric
   and that rubric is in the assessment's class). Other assessments are
   untouched. maps: { rubricId, criteria: { old: new }, checks: { old: new } } */
function moveRubricScores(cid, aid, maps) {
  var crit = (maps && maps.criteria) || {};
  var chk = (maps && maps.checks) || {};
  if (!aid || !Object.keys(crit).length) return Promise.resolve({ data: 0, error: null });
  var scores = getScores(cid) || {};
  var next = {};
  Object.keys(scores).forEach(function (sid) {
    var list = scores[sid];
    next[sid] = Array.isArray(list)
      ? list.map(function (e) {
          if (!e || e.assessmentId !== aid || !crit[e.tagId]) return e;
          var to = crit[e.tagId];
          return Object.assign({}, e, { tagId: to, id: aid + ':' + to });
        })
      : list;
  });
  _saveCourseField('scores', cid, next);
  var checks = Object.assign({}, getRubricChecks(cid));
  Object.keys(checks).forEach(function (key) {
    if (key.split(':')[1] !== aid || !Array.isArray(checks[key])) return;
    checks[key] = checks[key].map(function (id) {
      return chk[id] || id;
    });
  });
  _saveCourseField('rubricChecks', cid, checks);
  _repointGradeReturns(cid, aid, crit, chk);
  if (typeof clearProfCache === 'function') clearProfCache();
  return _writeRpc('move_rubric_scores', {
    p_assessment_id: aid,
    p_rubric_id: maps.rubricId || null,
    p_criterion_map: crit,
    p_check_map: chk,
  });
}
/* The ids of the checkboxes ticked for one student on one assessment. */
function getRubricCheckIds(cid, sid, aid) {
  var list = getRubricChecks(cid)[sid + ':' + aid];
  return Array.isArray(list) ? list.slice() : [];
}
function isRubricCheckOn(cid, sid, aid, checkId) {
  return getRubricCheckIds(cid, sid, aid).indexOf(checkId) >= 0;
}
/* Tick (on) or clear (off) one checkbox. The cache changes at once; the
   server row follows when both ids can be sent. Returns the ticked ids. */
function _setRubricCheckOne(cid, sid, aid, checkId, on) {
  if (!cid || !sid || !aid || !checkId) return getRubricCheckIds(cid, sid, aid);
  var checks = getRubricChecks(cid);
  var key = sid + ':' + aid;
  var list = Array.isArray(checks[key]) ? checks[key].slice() : [];
  var i = list.indexOf(checkId);
  var changed = false;
  if (on && i < 0) {
    list.push(checkId);
    changed = true;
  } else if (!on && i >= 0) {
    list.splice(i, 1);
    changed = true;
  }
  if (!changed) return list;
  if (list.length) checks[key] = list;
  else delete checks[key];
  var gradesWere = _gradeBefore(cid, 'rubricChecks');
  _saveCourseField('rubricChecks', cid, checks);
  _gradeAfter(cid, gradesWere, checks);
  if (_writesEnabled() && _isSendableId(sid) && _isSendableId(aid) && _isSendableId(checkId)) {
    _trackPendingSync(
      _writeRpc('set_rubric_check', {
        p_enrollment_id: sid,
        p_assessment_id: aid,
        p_check_id: checkId,
        p_on: !!on,
      }).then(function (res) {
        if (res && res.error) _reportScoreWriteFailure('set_rubric_check', res.error);
      }),
    );
  }
  return list;
}

/* ── Printed rubrics (migrations/20261102_rubric_print.sql) ──────────────
   Print Rubrics records each scored student it prints: a rubric_print row
   (enrollment, assessment) with the time and a fingerprint of what the sheet
   showed (RubricPrint.fingerprint in teacher/rubric-print.js). In the cache
   they are { 'sid:aid': { at, hash } }, in localStorage under
   gb-rubric-prints-<cid>, written through the outbox with set_rubric_printed
   so a print made offline is recorded later. Nothing here changes a score. */
function getRubricPrints(cid) {
  if (_cache.rubricPrints[cid] !== undefined) return _cache.rubricPrints[cid];
  var stored = _safeParseLS('gb-rubric-prints-' + cid, {});
  _cache.rubricPrints[cid] = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
  return _cache.rubricPrints[cid];
}
/* One student's print of one assessment's rubric, or null. */
function getRubricPrint(cid, sid, aid) {
  var p = getRubricPrints(cid)[sid + ':' + aid];
  return p && p.at && p.hash ? { at: String(p.at), hash: String(p.hash) } : null;
}
/* Record prints, or clear them, for several students at once. `marks` is
   [{ sid, hash, at? }]; a mark with no hash clears that student's print.
   The cache changes at once; each row goes up as its own write. */
function setRubricPrints(cid, aid, marks) {
  if (!cid || !aid || !Array.isArray(marks) || !marks.length) return;
  var prints = getRubricPrints(cid);
  var sent = [];
  marks.forEach(function (m) {
    if (!m || !m.sid) return;
    var key = m.sid + ':' + aid;
    var hash = m.hash ? String(m.hash).slice(0, 64) : '';
    if (hash) {
      var at = m.at || new Date().toISOString();
      var prev = prints[key];
      if (prev && prev.at === at && prev.hash === hash) return;
      prints[key] = { at: at, hash: hash };
      sent.push({ sid: m.sid, hash: hash, at: at });
    } else {
      if (!prints[key]) return;
      delete prints[key];
      sent.push({ sid: m.sid, hash: null, at: null });
    }
  });
  if (!sent.length) return;
  _saveCourseField('rubricPrints', cid, prints);
  if (!_writesEnabled() || !_isSendableId(aid)) return;
  sent.forEach(function (m) {
    if (!_isSendableId(m.sid)) return;
    _trackPendingSync(
      _writeRpc('set_rubric_printed', {
        p_enrollment_id: m.sid,
        p_assessment_id: aid,
        p_hash: m.hash,
        p_printed_at: m.at,
      }).then(function (res) {
        if (res && res.error) _reportScoreWriteFailure('set_rubric_printed', res.error);
      }),
    );
  });
}

/* ── Competency descriptors (one teacher's own wording) ──────────────
   { competencyKey: { 1: text, 2: text, 3: text, 4: text } }, the start of a
   "From competency" draft (RubricDraft.competencyKey makes the keys). Per
   teacher, not per class: loaded once a session, kept in localStorage so
   it works offline and in Demo Mode, written through the outbox. */
var _competencyDescriptors = null;
var _competencyDescriptorsLoad = null;
function getCompetencyDescriptors() {
  if (!_competencyDescriptors) {
    var stored = _safeParseLS('gb-competency-descriptors', {});
    _competencyDescriptors = stored && typeof stored === 'object' ? stored : {};
  }
  return _competencyDescriptors;
}
function getCompetencyDescriptor(key) {
  return (key && getCompetencyDescriptors()[key]) || null;
}
/* entries: [{ key, level, text }]; an empty text forgets that level. Only
   real changes are kept and sent. */
function saveCompetencyDescriptors(entries) {
  var bank = getCompetencyDescriptors();
  var sent = [];
  (entries || []).forEach(function (e) {
    var level = e ? Number(e.level) : 0;
    if (!e || !e.key || !(level >= 1 && level <= 4)) return;
    var text = String(e.text == null ? '' : e.text)
      .trim()
      .slice(0, 2000);
    var row = bank[e.key] || {};
    if ((row[level] || '') === text) return;
    if (text) row[level] = text;
    else delete row[level];
    if (Object.keys(row).length) bank[e.key] = row;
    else delete bank[e.key];
    sent.push({ key: e.key, level: level, text: text });
  });
  if (!sent.length) return Promise.resolve({ data: 0, error: null });
  _safeLSSet('gb-competency-descriptors', JSON.stringify(bank));
  if (!_writesEnabled()) return Promise.resolve({ data: sent.length, error: null });
  return _writeRpc('save_competency_descriptors', { p_entries: sent });
}
/* The texts in saves still waiting in the outbox, which a load must not
   overwrite with the server's older copy. */
function _pendingCompetencyDescriptors() {
  var out = {};
  try {
    var q = JSON.parse(localStorage.getItem('fv-sync-queue-v1') || '{}');
    (q.entries || []).forEach(function (entry) {
      if (!entry || entry.endpoint !== 'save_competency_descriptors') return;
      ((entry.payload && entry.payload.p_entries) || []).forEach(function (e) {
        if (e && e.key) out[e.key + '|' + e.level] = e;
      });
    });
  } catch (err) {
    /* an unreadable queue only means nothing is known to be pending */
  }
  return out;
}
/* Fetch the signed-in teacher's descriptors once a session. Resolves to the
   bank either way; offline or in Demo Mode it is the stored copy. */
function loadCompetencyDescriptors() {
  if (_competencyDescriptorsLoad) return _competencyDescriptorsLoad;
  if (!_writesEnabled() || typeof getSupabase !== 'function' || !getSupabase()) {
    _competencyDescriptorsLoad = Promise.resolve(getCompetencyDescriptors());
    return _competencyDescriptorsLoad;
  }
  _competencyDescriptorsLoad = _rpcOrNoop('list_competency_descriptors', {}).then(function (res) {
    if (!res || res.error || !Array.isArray(res.data)) {
      _competencyDescriptorsLoad = null; // try again next time
      return getCompetencyDescriptors();
    }
    var bank = {};
    res.data.forEach(function (r) {
      if (!r || !r.competency_key || !r.text) return;
      if (!bank[r.competency_key]) bank[r.competency_key] = {};
      bank[r.competency_key][Number(r.level)] = r.text;
    });
    var pending = _pendingCompetencyDescriptors();
    Object.keys(pending).forEach(function (k) {
      var e = pending[k];
      var row = bank[e.key] || {};
      if (e.text) row[e.level] = e.text;
      else delete row[e.level];
      if (Object.keys(row).length) bank[e.key] = row;
      else delete bank[e.key];
    });
    _competencyDescriptors = bank;
    _safeLSSet('gb-competency-descriptors', JSON.stringify(bank));
    return bank;
  });
  return _competencyDescriptorsLoad;
}
function deleteRubric(cid, rubricId) {
  var savePromise = saveRubrics(
    cid,
    getRubrics(cid).filter(r => r.id !== rubricId),
  );
  const assessments = structuredClone(getAssessments(cid) || []);
  let changed = false;
  assessments.forEach(a => {
    if (a.rubricId === rubricId) {
      delete a.rubricId;
      changed = true;
    }
  });
  if (changed) saveAssessments(cid, assessments);
  return savePromise;
}

/* ── Competency Groups ─────────────────────────────────────── */
function getCompetencyGroups(cid) {
  return getLearningMap(cid).competencyGroups || [];
}
function saveCompetencyGroups(cid, groups) {
  var map = ensureCustomLearningMap(cid);
  map.competencyGroups = groups;
  saveLearningMap(cid, map);
}
function getCompetencyGroupById(cid, gid) {
  return getCompetencyGroups(cid).find(g => g.id === gid);
}
function setSectionGroup(cid, sectionId, groupId) {
  var map = ensureCustomLearningMap(cid);
  var sec = (map.sections || []).find(s => s.id === sectionId);
  if (!sec) return;
  if (groupId) sec.groupId = groupId;
  else delete sec.groupId;
  saveLearningMap(cid, map);
}
function getGroupedSections(cid) {
  var groups = getCompetencyGroups(cid)
    .slice()
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  var sections = getSections(cid);
  var groupMap = {};
  groups.forEach(g => {
    groupMap[g.id] = { group: g, sections: [] };
  });
  var ungrouped = [];
  sections.forEach(sec => {
    if (sec.groupId && groupMap[sec.groupId]) groupMap[sec.groupId].sections.push(sec);
    else ungrouped.push(sec);
  });
  return { groups: groups.map(g => groupMap[g.id]), ungrouped: ungrouped };
}
function addCustomSection(cid, opts) {
  var map = ensureCustomLearningMap(cid);
  var id = 'custom_' + uid();
  var sub = map.subjects && map.subjects[0] ? map.subjects[0].id : '';
  var color = map.subjects && map.subjects[0] ? map.subjects[0].color : '#6366f1';
  var sec = {
    id: id,
    subject: opts.subject || sub,
    name: opts.label || 'Custom Standard',
    shortName: opts.label || 'Custom',
    color: opts.color || color,
    _custom: true,
    tags: [
      {
        id: id,
        label: opts.label || 'Custom Standard',
        text: opts.text || '',
        color: opts.color || color,
        subject: opts.subject || sub,
        name: opts.label || 'Custom Standard',
        shortName: opts.label || 'Custom',
        i_can_statements: opts.i_can_statements || [],
      },
    ],
  };
  if (opts.groupId) sec.groupId = opts.groupId;
  if (!map.sections) map.sections = [];
  map.sections.push(sec);
  saveLearningMap(cid, map);
  return sec;
}
function removeSection(cid, sectionId) {
  var map = ensureCustomLearningMap(cid);
  var sec = (map.sections || []).find(s => s.id === sectionId);
  if (!sec || !sec._custom) return false;
  map.sections = map.sections.filter(s => s.id !== sectionId);
  saveLearningMap(cid, map);
  return true;
}

/* ── Helpers: get sections/tags for a course ─────────────────── */
function getSections(cid) {
  var map = getLearningMap(cid);
  if (map.sections && map.sections.length) return map.sections;
  if (map.outcomes && map.outcomes.length) {
    return map.outcomes.map(function (tag) {
      return {
        id: tag.id,
        subject: tag.subject,
        name: tag.name || tag.label || tag.id,
        shortName: tag.shortName || tag.label || tag.id,
        color: tag.color,
        tags: [tag],
        outcome: tag,
      };
    });
  }
  return [];
}
function getSubjects(cid) {
  var map = getLearningMap(cid);
  return map.subjects || [];
}

// Cached flat tag list — keyed by learning map object reference so any direct
// write to _cache.learningMaps[cid] (including test setup) naturally busts the cache.
var _allTagsCache = {}; // cid → { mapRef, tags }
function getAllTags(cid) {
  const map = getLearningMap(cid);
  const c = _allTagsCache[cid];
  if (c && c.mapRef === map) return c.tags;
  const sections = getSections(cid);
  const tags = sections.flatMap(function (s) {
    return s.tags || (s.outcome ? [s.outcome] : []);
  });
  _allTagsCache[cid] = { mapRef: map, tags };
  return tags;
}
function getTagById(cid, tagId) {
  return getAllTags(cid).find(t => t.id === tagId);
}

// Cached tag→section index — O(1) lookup vs O(sections × tags) find() per call.
// getFocusAreas() calls this once per tag; without the index it was O(tags² × sections).
// Same reference-based invalidation as _allTagsCache.
var _tagToSectionCache = {}; // cid → { mapRef, index: { tagId: section } }
function getSectionForTag(cid, tagId) {
  const map = getLearningMap(cid);
  const c = _tagToSectionCache[cid];
  if (!c || c.mapRef !== map) {
    const index = {};
    getSections(cid).forEach(function (s) {
      (s.tags || (s.outcome ? [s.outcome] : [])).forEach(function (t) {
        index[t.id] = s;
      });
    });
    _tagToSectionCache[cid] = { mapRef: map, index };
  }
  return _tagToSectionCache[cid].index[tagId];
}

/* ══════════════════════════════════════════════════════════════════
   Core data accessors — cache-through
   ══════════════════════════════════════════════════════════════════ */
function getConfig() {
  if (_cache.config !== null) return _cache.config;
  try {
    return JSON.parse(localStorage.getItem('gb-config')) || {};
  } catch (e) {
    console.warn('Config parse fallback:', e);
    return {};
  }
}
/* Resolve a course id that may still be a client-side placeholder.

   createCourse() returns synchronously with a local id ("c{ts}{rand}") and
   re-keys COURSES to the server's uuid when create_course resolves. The
   re-keyed record keeps __pendingLocalId, so the placeholder stays traceable
   after the swap. Returns the canonical uuid, or null while the create is
   still in flight and no uuid exists yet. */
function _resolveCanonicalCourseId(cid) {
  if (!cid) return null;
  if (_isUuid(cid)) return cid;
  var keys = Object.keys(COURSES || {});
  for (var i = 0; i < keys.length; i++) {
    // Before the re-key the pending record is still filed under the
    // placeholder itself, so a match only counts once the key is a uuid.
    if (_isUuid(keys[i]) && COURSES[keys[i]] && COURSES[keys[i]].__pendingLocalId === cid) return keys[i];
  }
  return null;
}

function _teacherPrefsPatchFromConfig(obj) {
  var patch = {};
  if (!obj) return patch;
  if (Object.prototype.hasOwnProperty.call(obj, 'activeCourse')) {
    // save_teacher_preferences casts this straight to uuid, so a placeholder
    // id fails the whole RPC with 22P02 and the teacher's preferences never
    // save. Resolve it, and when it can't be resolved omit the key entirely:
    // the RPC's on-conflict branch leaves active_course_id untouched when the
    // key is absent, and create_course has already pointed it at the new
    // course server-side. An explicit empty value still clears the pointer.
    if (!obj.activeCourse) {
      patch.active_course_id = null;
    } else {
      var canonicalActive = _resolveCanonicalCourseId(obj.activeCourse);
      if (canonicalActive) patch.active_course_id = canonicalActive;
    }
  }
  if (Object.prototype.hasOwnProperty.call(obj, 'viewMode')) {
    patch.view_mode = obj.viewMode || null;
  }
  if (Object.prototype.hasOwnProperty.call(obj, 'mobileViewMode')) {
    patch.mobile_view_mode = obj.mobileViewMode || null;
  }
  if (Object.prototype.hasOwnProperty.call(obj, 'mobileSortMode')) {
    patch.mobile_sort_mode = obj.mobileSortMode || null;
  }
  if (Object.prototype.hasOwnProperty.call(obj, 'cardWidgetConfig')) {
    patch.card_widget_config = obj.cardWidgetConfig || null;
  }
  if (Object.prototype.hasOwnProperty.call(obj, 'dashboardPrefs')) {
    patch.dashboard_prefs = obj.dashboardPrefs || null;
  }
  return patch;
}
function saveConfig(obj) {
  _cache.config = obj;
  _safeLSSet('gb-config', JSON.stringify(obj));
  if (_writesEnabled()) {
    const sb = getSupabase();
    if (sb) {
      const patch = _teacherPrefsPatchFromConfig(obj);
      _trackPendingSync(
        _writeRpc('save_teacher_preferences', { p_patch: patch }).then(function (res) {
          if (res.error) console.warn('save_teacher_preferences RPC failed:', res.error);
        }),
      );
    }
  }
}
function getCourseConfig(cid) {
  if (_cache.courseConfigs[cid] !== undefined) return _cache.courseConfigs[cid];
  try {
    return JSON.parse(localStorage.getItem('gb-courseconfig-' + cid)) || {};
  } catch (e) {
    console.warn('CourseConfig parse fallback:', e);
    return {};
  }
}
/* A class's settings as update_course takes them: the patch a copy of the
   settings would send. Never the student page's switch or Return Grades
   (saveReturnSettings is their one writer). */
function _courseSettingsPatch(obj) {
  const patch = {};
  if (!obj || typeof obj !== 'object') return patch;
  if (obj.gradingSystem != null) patch.grading_system = obj.gradingSystem;
  if (obj.calcMethod != null) patch.calc_method = obj.calcMethod;
  if (obj.decayWeight != null) patch.decay_weight = obj.decayWeight;
  if (obj.timezone != null) patch.timezone = obj.timezone;
  if (obj.lateWorkPolicy != null) patch.late_work_policy = obj.lateWorkPolicy;
  if (obj.gradingScale != null) patch.grading_scale = obj.gradingScale;
  if (obj.categoryWeights != null) patch.category_weights = obj.categoryWeights;
  if (typeof obj.roundPercent === 'boolean') patch.round_percent = obj.roundPercent;
  // Null is a choice here (All Scores), so it is sent too.
  if (obj.recentScoreLimit !== undefined) patch.recent_score_limit = obj.recentScoreLimit || null;
  if (obj.levelOrder === 'asc' || obj.levelOrder === 'desc') patch.level_order = obj.levelOrder;
  if (typeof obj.foldersCountAsOne === 'boolean') patch.folders_count_as_one = obj.foldersCountAsOne;
  if (typeof obj.coursesCountEqually === 'boolean') patch.courses_count_equally = obj.coursesCountEqually;
  if (Array.isArray(obj.reportingTerms)) patch.reporting_terms = obj.reportingTerms;
  return patch;
}
/* Which setting each of those columns is in the settings copy. */
var _COURSE_SETTING_FIELDS = {
  grading_system: 'gradingSystem',
  calc_method: 'calcMethod',
  decay_weight: 'decayWeight',
  timezone: 'timezone',
  late_work_policy: 'lateWorkPolicy',
  grading_scale: 'gradingScale',
  category_weights: 'categoryWeights',
  round_percent: 'roundPercent',
  recent_score_limit: 'recentScoreLimit',
  level_order: 'levelOrder',
  folders_count_as_one: 'foldersCountAsOne',
  courses_count_equally: 'coursesCountEqually',
  reporting_terms: 'reportingTerms',
};
/* The columns only a whole copy of the settings ever carried: updateCourse
   never sends them. An update_course naming one of them without
   FV_SETTINGS_CHANGED_ONLY was queued by a build from before a save sent
   only what changed (_oldSettingsWrite). */
var _WHOLE_COPY_ONLY_COLUMNS = [
  'grading_scale',
  'category_weights',
  'round_percent',
  'recent_score_limit',
  'level_order',
  'folders_count_as_one',
  'courses_count_equally',
  'reporting_terms',
];
/* Set in the patch of every settings write this build queues: "these keys
   are the ones the teacher changed, and nothing else". It stays with the
   queued write, so it is known after a reload, and is taken out as the
   write is sent (_sendableCoursePatch). The server reads only the columns
   it knows, so one that slipped through would change nothing. */
var FV_SETTINGS_CHANGED_ONLY = '_changed_only';
function _changedOnly(patch) {
  patch[FV_SETTINGS_CHANGED_ONLY] = true;
  return patch;
}

/* What a setting is when this device's copy does not name it: how the app
   reads it then (getFoldersCountAsOne and the rest), and what a class load
   leaves out of the copy when the server holds it. A save that sets one of
   these to the same thing has changed nothing. */
var _SETTING_WHEN_ABSENT = {
  folders_count_as_one: true,
  courses_count_equally: false,
  recent_score_limit: null,
  level_order: 'desc',
};

// The same value, whatever order an object's keys are in (jsonb reorders
// them), and whether a number came as a number or as text.
function _sameSetting(a, b) {
  var numberAndText =
    (typeof a === 'number' && typeof b === 'string') || (typeof a === 'string' && typeof b === 'number');
  if (numberAndText && a !== '' && b !== '' && isFinite(Number(a)) && isFinite(Number(b))) {
    return Number(a) === Number(b);
  }
  return _settingText(a) === _settingText(b);
}
function _settingText(v) {
  if (v === undefined) return 'undefined';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(_settingText).join(',') + ']';
  return (
    '{' +
    Object.keys(v)
      .filter(function (k) {
        return v[k] !== undefined;
      })
      .sort()
      .map(function (k) {
        return JSON.stringify(k) + ':' + _settingText(v[k]);
      })
      .join(',') +
    '}'
  );
}

/* Save a class's settings. The server's copy is the one true copy; this
   device's is a working cache that gives way to it on every load
   (_applyBundleCourseConfig). So a save sends ONLY what this save changed:
   the settings that differ from the copy this page loaded or last saved
   (a clone, since callers change the cached object in place): the copy
   read from this device's storage while the class has not loaded from the
   server (_settingsRead), else the server-state baseline; for a class this
   page has not touched at all, the copy saved in localStorage.
   It used to send the device's whole copy, and a device that had loaded the
   class before a change made elsewhere put the old values back. A save that
   changes nothing sends nothing. */
function saveCourseConfig(cid, obj) {
  // Draft and Returned: the student page's switch and Return Grades are not
  // this function's to change or send for a signed-in teacher
  // (saveReturnSettings is their one writer). They stay as the class holds
  // them, whatever copy of the settings the caller has.
  if (_writesEnabled()) obj = _keepReturnSettings(cid, obj);
  var held = _returnSettingsBefore(cid); // did the class hold grades before this save (Demo Mode)
  var read = _settingsRead[cid];
  var before =
    read && read.of === _cache.courseConfigs[cid]
      ? read.copy
      : _hasServerState('courseConfigs', cid)
        ? _serverState.courseConfigs[cid]
        : _safeParseLS('gb-courseconfig-' + cid, null);
  _saveCourseField('courseConfigs', cid, obj);
  if (_writesEnabled() && _isUuid(cid)) {
    // v2: policy fields live on the course row. save_course_policy is gone;
    // remap the legacy courseConfig blob onto a update_course jsonb patch.
    const sb = getSupabase();
    if (sb && obj) {
      const all = _courseSettingsPatch(obj);
      const was = _courseSettingsPatch(before);
      if (_plainObject(before)) {
        Object.keys(_SETTING_WHEN_ABSENT).forEach(function (col) {
          if (!(col in was)) was[col] = _SETTING_WHEN_ABSENT[col];
        });
      }
      const patch = {};
      Object.keys(all).forEach(function (col) {
        if (!(col in was) || !_sameSetting(all[col], was[col])) patch[col] = all[col];
      });
      // From here this page takes the server to have what it was just sent.
      _rememberServerState('courseConfigs', cid, obj);
      delete _settingsRead[cid];
      const sent = Object.keys(patch);
      if (sent.length > 0) {
        patch[FV_SETTINGS_CHANGED_ONLY] = true;
        _trackPendingSync(
          _writeRpc('update_course', { p_course_id: cid, p_patch: patch }).then(function (res) {
            if (!res.error) return;
            console.warn('update_course (saveCourseConfig) failed:', res.error);
            // Never queued (the outbox had no room): the server does not
            // have these, so the next save of the class's settings sends
            // them again. A write the server itself rejects is not sent
            // again with every later save: the outbox tries it once more on
            // the next page load, and the next class load shows what the
            // server holds.
            if (res.error.refused) _settingsNotSent(cid, sent, before);
          }),
        );
      }
    }
  }
  _returnSettingsSaved(cid, held);
}
/* An update_course on its way out. Answers { params } to send, or
   { answer } when nothing is to be sent and the caller hears that instead.

   A write this build queued carries FV_SETTINGS_CHANGED_ONLY: the mark is
   taken out and the rest goes as it is.

   One without the mark that names a whole-copy-only column was queued by a
   build that sent a device's whole copy of the settings with every save.
   Which of its keys the teacher meant to change was never recorded, so it
   is compared with the class's row on the server now (_oldSettingsWrite). */
function _sendableCoursePatch(params, options) {
  var patch = params && params.p_patch;
  if (!_plainObject(patch)) return { params: params };
  if (patch[FV_SETTINGS_CHANGED_ONLY]) {
    var clean = Object.assign({}, patch);
    delete clean[FV_SETTINGS_CHANGED_ONLY];
    return { params: Object.assign({}, params, { p_patch: clean }) };
  }
  return _isOldSettingsPatch(patch) ? _oldSettingsWrite(params, options || {}) : { params: params };
}
function _isOldSettingsPatch(patch) {
  return (
    _plainObject(patch) &&
    !patch[FV_SETTINGS_CHANGED_ONLY] &&
    _WHOLE_COPY_ONLY_COLUMNS.some(function (col) {
      return col in patch;
    })
  );
}

/* A save that waited is not to be sent, and never will be: it was made by
   an older build that could not say what the teacher changed, or for a
   list that is no longer the server's. Sending it could put an old value
   back over a change made on another computer, with no sign.

   - Sentry is told (the kind of write only: never its content).
   - The class is read again from the server, so the screen shows what the
     server holds and the teacher can make the change again.
   - Nothing of the save may reach the server by another route: a class
     load sends up a setting only this device has, and until this class has
     loaded once more it must not (noSendUp, _applyBundleCourseConfig).
   - The answer is not a network error, so the outbox does not retry it: it
     goes to the failed list, which turns the sync dot red (rule 5: the dot
     only). noRetry: it gets no last try. untilReload: no later write and
     no page load clears it until this class has been read again
     (_classReadFromServer), so the dot is red for as long as the screen
     may still show the change that was not saved. A class that is gone,
     or archived, is ended by the class list (_releaseDiscardsByClassList). */
var _WRITE_DISCARDED = 'FV409';
function _discardWrite(cid, what) {
  console.warn(what);
  try {
    if (window.Sentry && typeof window.Sentry.captureMessage === 'function') {
      window.Sentry.captureMessage(what, 'warning');
    }
  } catch (e) {
    /* reporting is best effort */
  }
  try {
    if (_isUuid(cid)) _saveClassMeta(cid, { noSendUp: true });
  } catch (e) {
    /* the flag is a second lock: the class is read again either way */
  }
  _convergeOnServer(cid);
  return {
    data: null,
    error: {
      message: 'an older save that could not be checked was not sent',
      code: _WRITE_DISCARDED,
      noRetry: true,
      untilReload: cid || undefined,
    },
  };
}
/* The class has been read from the server and what it sent is on screen:
   the saves discarded for it may leave the failed list with the next page
   load (the outbox's markReloaded). */
function _classReadFromServer(cid) {
  var q = typeof window !== 'undefined' ? window.v2Queue : null;
  if (!cid || !q || typeof q.markReloaded !== 'function') return;
  try {
    if (q.markReloaded(cid)) _updateSyncIndicator();
  } catch (e) {
    /* the next load says it again */
  }
}

// update_course leaves these columns alone when the patch gives them null.
var _NULL_CHANGES_NOTHING = {
  name: true,
  grade_level: true,
  grading_system: true,
  calc_method: true,
  timezone: true,
  level_order: true,
};
var OLD_SETTINGS_NOT_SENT = 'An older settings save that could not be checked was not sent';
/* A whole-copy settings write from an earlier build, weighed before it
   goes (Colin, 2026-11-10: discard on any difference). Every key it names
   is compared with the class's row on the server:
   - nothing differs: there is nothing to send, and it is dropped;
   - anything differs: it is never sent (_discardWrite). One key differing
     could be the teacher's own change, or an old value this device kept
     while another computer changed it: the two cannot be told apart, and
     the second would revert that change with no sign. So a change made
     offline on the older app and still waiting when this build opens is
     lost; the setting shows as the server has it and the teacher sets it
     again.
   If the class cannot be read (offline), the write waits and is weighed
   when it can be. */
async function _oldSettingsWrite(params) {
  var cid = params.p_course_id;
  var patch = params.p_patch;
  var res;
  try {
    res = await _callRpcWithAuthGuard(
      'get_class_bundle',
      { p_course_id: cid, p_if_version: null },
      { suppressSessionExpiredModal: true },
    );
  } catch (e) {
    res = { data: null, error: { message: 'network: the class could not be read' } };
  }
  if (!res || res.error) {
    return { answer: { data: null, error: (res && res.error) || { message: 'network: the class could not be read' } } };
  }
  var bundle = _rpcObject(res.data) || {};
  var row = bundle.gradebook && bundle.gradebook.course;
  var differs =
    !_plainObject(row) ||
    Object.keys(patch).some(function (col) {
      if (patch[col] == null && _NULL_CHANGES_NOTHING[col]) return false;
      return !(col in row) || !_sameSetting(patch[col], row[col]);
    });
  if (!differs) return { answer: { data: null, error: null } };
  return { answer: _discardWrite(cid, OLD_SETTINGS_NOT_SENT) };
}

/* These columns of a settings save never left this device: the baseline
   says again what it said before the save, so they still count as changed. */
function _settingsNotSent(cid, columns, before) {
  if (!_hasServerState('courseConfigs', cid)) return;
  var base = _serverState.courseConfigs[cid];
  if (!_plainObject(base)) return;
  columns.forEach(function (col) {
    var field = _COURSE_SETTING_FIELDS[col];
    if (!field) return;
    if (_plainObject(before) && field in before) base[field] = _cloneValue(before[field]);
    else delete base[field];
  });
}
function getStudents(cid) {
  if (_cache.students[cid] !== undefined) return _cache.students[cid];
  try {
    return (JSON.parse(localStorage.getItem('gb-students-' + cid)) || []).map(migrateStudent);
  } catch (e) {
    console.warn('Students parse fallback:', e);
    return [];
  }
}
function saveStudents(cid, arr) {
  var prev = _loadPersistedCourseFieldSnapshot('students', cid, _cache.students[cid] || []).map(migrateStudent);
  _saveCourseField('students', cid, arr);
  // Demo mode and offline both stay local-only. A class that has no server
  // id yet is replayed by _migrateCourseDataLocalToCanonical when it gets one.
  if (!_writesEnabled() || !_isUuid(cid)) return;
  if (!cid || !arr) return;
  // New rows get their pending-create record now, so a score or note
  // entered before the enrol is even pushed already waits on it.
  _registerLocalRows(cid, 'student', arr, 'create_student_and_enroll');
  return _persistStudentsToCanonical(cid, prev, arr);
}

/* UUID detection — distinguishes canonical enrollment_ids from local uid()s */
var _UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function _isUuid(v) {
  return typeof v === 'string' && _UUID_RE.test(v);
}

/* Per-course save lock so rapid saves don't double-enroll the same student.
   A save's diff waits only for the earlier save's diff to be dispatched, not
   for the server's answer: the baseline is advanced at dispatch, and a new
   row's pending-create record keeps the next diff from creating it again.
   Waiting for the answer stranded every later save behind one that could not
   be sent offline, so a row removed before its create landed came back after
   a reload. _studentSaveQueue still settles when every save so far has
   landed, for callers that need the server to have them. */
var _studentSaveQueue = {}; // cid → Promise of every save so far landing
var _studentDispatchQueue = {}; // cid → Promise of the last diff being dispatched

/* Diff arr vs prev and translate to canonical RPC calls.
   - student.id matching UUID → already enrolled → update_enrollment + update_student
   - student.id local (uid) → new → enroll_student → patches local cache id to canonical
   - prev student missing from arr → withdraw_student (Class Settings
     withdraws through withdrawStudent, which keeps the baseline in step) */
function _persistStudentsToCanonical(cid, prev, arr) {
  var sb = getSupabase();
  if (!sb) return;
  var tail = _studentDispatchQueue[cid] || Promise.resolve();
  var landed = null;
  var dispatched = tail.then(function () {
    var before = _serverStateOr('students', cid, prev);
    var after = _cache.students[cid] || arr;
    var prevById = {};
    before.forEach(function (s) {
      if (s && s.id) prevById[s.id] = s;
    });
    var arrById = {};
    after.forEach(function (s) {
      if (s && s.id) arrById[s.id] = s;
    });

    var ops = [];

    // Adds (any id not in prev)
    after.forEach(function (s, idx) {
      if (s && s.id && !prevById[s.id]) {
        ops.push(_canonicalEnrollStudent(sb, cid, s, idx));
      } else if (s && s.id) _dropUnqueuedPending('student', s.id);
    });
    // Withdrawals (in prev, not in arr). A row whose enrol is still queued
    // is simply not created; one already sent is withdrawn by its server id
    // once that is known.
    before.forEach(function (s) {
      if (!s || !s.id || arrById[s.id]) return;
      var target = _cancelPendingCreateOrResolve(cid, 'student', s.id);
      if (target) ops.push(_canonicalWithdrawEnrollment(sb, target));
    });
    // Updates (in both, with field changes). A row whose enrol is still
    // queued gets its patch queued behind it; identity edits need the
    // person id, which only the enrol returns. Each patch holds only the
    // fields that differ from the server baseline, so a stale copy can't
    // revert another device's edits; without a baseline, the whole row.
    var hasBase = _hasServerState('students', cid);
    after.forEach(function (s, idx) {
      var p = s && s.id ? prevById[s.id] : null;
      if (!p || !_isSendableId(s.id)) return;
      var moved = _studentRosterPositionChanged(idx, before, p, s);
      if (moved || Object.keys(_changedPatch(_enrollmentPatchOf(s, idx), _enrollmentPatchOf(p, idx))).length) {
        ops.push(_canonicalUpdateEnrollment(sb, s.id, s, idx, hasBase ? p : null, moved));
      }
      if (_isUuid(s.personId) && Object.keys(_changedPatch(_studentPatchOf(s), _studentPatchOf(p))).length) {
        ops.push(_canonicalUpdateStudent(sb, s.personId, s, hasBase ? p : null));
      }
    });

    _rememberServerState('students', cid, after);
    landed = Promise.all(ops).catch(function (err) {
      console.warn('Student sync to canonical RPCs failed for one or more rows:', err);
    });
  });
  _studentDispatchQueue[cid] = dispatched;
  var earlier = _studentSaveQueue[cid] || Promise.resolve();
  _studentSaveQueue[cid] = _trackPendingSync(
    Promise.all([
      earlier,
      dispatched.then(function () {
        return landed;
      }),
    ]).then(function () {}),
  );
  return _studentSaveQueue[cid];
}

function _studentRosterPositionChanged(idx, prevArr, prevStudent, newStudent) {
  // Detect a real reorder: prev index of this student differs from new index
  var prevIdx = prevArr.findIndex(function (p) {
    return p && p.id === newStudent.id;
  });
  return prevIdx !== -1 && prevIdx !== idx;
}

/* v2 create_student_and_enroll(p_course_id, p_first_name, p_last_name,
   p_preferred_name, p_pronouns, p_student_number, p_email, p_date_of_birth,
   p_designations, p_existing_student_id) → { student_id, enrollment_id } */
function _canonicalEnrollStudent(sb, cid, s, idx) {
  var localId = s.id;
  var existingStudentId = _isUuid(s.personId) ? s.personId : null;
  var rec = _registerPendingCreate(cid, 'student', localId, 'create_student_and_enroll', { rosterPosition: idx });
  return _writeRpc(
    'create_student_and_enroll',
    {
      p_course_id: cid,
      p_first_name: s.firstName || '',
      p_last_name: s.lastName || null,
      p_preferred_name: s.preferred || null,
      p_pronouns: s.pronouns || null,
      p_student_number: s.studentNumber || null,
      p_email: s.email || null,
      p_date_of_birth: s.dateOfBirth || null,
      p_designations: s.designations || [],
      p_existing_student_id: existingStudentId,
    },
    { entryId: rec ? rec.entryId : undefined },
  ).then(function (res) {
    if (res.error) {
      if (!res.error.cancelled) console.warn('create_student_and_enroll failed:', res.error, s);
      return;
    }
    // Re-keys cache, gb-students, baseline, scores, notes… and sends what
    // waited on the local id. Already done when the outbox reported success.
    if (rec) _onCreateLanded(rec.entryId, res.data);
  });
}

/* A save registered this local row, but the diff found it already in the
   baseline, so no create goes out: the row is a leftover from before the
   id map. Forget the record, or writes on the row would wait forever. */
function _dropUnqueuedPending(kind, localId) {
  if (_isUuid(localId)) return;
  var rec = _pendingCreateFor(kind, localId);
  if (rec && !rec.queued) _onCreateAbandoned(rec.entryId, false);
}

/* A removed row still has a local id. If its create is still queued, cancel
   it (and the writes waiting on it) and return null: nothing to delete. If
   the create was sent, return the id to delete by: the server id when
   known, else the local id, which the outbox re-keys when the create lands. */
function _cancelPendingCreateOrResolve(cid, kind, localId) {
  if (_isUuid(localId)) return localId;
  var known = _resolveKnownId(kind, localId);
  if (known !== localId) return known;
  var rec = _pendingCreateFor(kind, localId);
  if (!rec) return null;
  var q = window.v2Queue;
  if (!rec.queued || !q || typeof q.remove !== 'function') {
    _onCreateAbandoned(rec.entryId, false);
    return null;
  }
  // remove() tells _onOutboxEvent, which drops the record and the dependents.
  if (q.remove(rec.entryId)) return null;
  return localId;
}

/* v2 update_enrollment(p_id, p_patch jsonb) — jsonb patch.
   Accepted keys: designations (text[]), is_flagged, roster_position, withdrawn_at.
   The server leaves alone every key left out. With `base` (the server
   baseline row) only the keys that differ from it are sent, plus
   roster_position when `moved`. Without `base`, all of them. */
function _canonicalUpdateEnrollment(sb, enrollmentId, s, idx, base, moved) {
  var patch = _enrollmentPatchOf(s, idx);
  if (base) {
    // Both sides take idx, so roster_position never differs here.
    patch = _changedPatch(patch, _enrollmentPatchOf(base, idx));
    if (moved) patch.roster_position = idx;
    if (!Object.keys(patch).length) return Promise.resolve();
  }
  return _writeRpc('update_enrollment', { p_id: enrollmentId, p_patch: patch }).then(function (res) {
    if (res.error) console.warn('update_enrollment failed:', res.error, enrollmentId);
  });
}

function _enrollmentPatchOf(s, idx) {
  var patch = {
    designations: s.designations || [],
    roster_position: idx,
  };
  if (typeof s.isFlagged === 'boolean') patch.is_flagged = s.isFlagged;
  return patch;
}

/* v2 update_student(p_id, p_patch jsonb).
   Accepted keys: first_name, last_name, preferred_name, pronouns,
   student_number, email, date_of_birth. The server leaves alone every key
   left out. With `base` (the server baseline row) only the keys that differ
   from it are sent; without it, all of them. */
function _canonicalUpdateStudent(sb, studentId, s, base) {
  var patch = _studentPatchOf(s);
  if (base) {
    patch = _changedPatch(patch, _studentPatchOf(base));
    if (!Object.keys(patch).length) return Promise.resolve();
  }
  return _writeRpc('update_student', { p_id: studentId, p_patch: patch }).then(function (res) {
    if (res.error) console.warn('update_student failed:', res.error, studentId);
  });
}

function _studentPatchOf(s) {
  return {
    first_name: s.firstName || '',
    last_name: s.lastName || null,
    preferred_name: s.preferred || null,
    pronouns: s.pronouns || null,
    student_number: s.studentNumber || null,
    email: s.email || null,
    date_of_birth: s.dateOfBirth || null,
  };
}

/* v2 withdraw_student(p_enrollment_id) — sets withdrawn_at; nothing is deleted. */
function _canonicalWithdrawEnrollment(sb, enrollmentId) {
  return _writeRpc('withdraw_student', { p_enrollment_id: enrollmentId }).then(function (res) {
    if (res.error) console.warn('withdraw_student failed:', res.error, enrollmentId);
  });
}

/* ── Public v2 student/enrollment helpers (Phase 4.1) ─────────────────── */

/* Bulk reorder the active roster. Accepts an ordered array of enrollment_ids. */
window.reorderRoster = function (enrollmentIds) {
  var sb = getSupabase();
  if (!sb) return Promise.resolve();
  var ids = (enrollmentIds || []).filter(_isUuid);
  if (ids.length === 0) return Promise.resolve();
  return _writeRpc('reorder_roster', { p_ids: ids }).then(function (res) {
    if (res.error) console.warn('reorder_roster failed:', res.error);
    return res;
  });
};

/* Apply one pronoun string to N students. */
window.bulkApplyPronouns = function (studentIds, pronouns) {
  var sb = getSupabase();
  if (!sb) return Promise.resolve();
  var ids = (studentIds || []).filter(_isUuid);
  if (ids.length === 0) return Promise.resolve();
  return _writeRpc('bulk_apply_pronouns', { p_student_ids: ids, p_pronouns: pronouns || null }).then(function (res) {
    if (res.error) console.warn('bulk_apply_pronouns failed:', res.error);
    return res;
  });
};

/* CSV import — rows are objects mirroring the RPC's expected keys:
   { first_name, last_name, preferred_name?, pronouns?, student_number?,
     email?, date_of_birth?, designations?: string[] } */
window.importRosterCsv = function (cid, rows) {
  var sb = getSupabase();
  if (!sb) return Promise.resolve();
  if (!_isUuid(cid)) return Promise.resolve();
  return _writeRpc(
    'import_roster_csv',
    _stampIdempotencyKey('import_roster_csv', { p_course_id: cid, p_rows: rows || [] }),
  ).then(function (res) {
    if (res.error) console.warn('import_roster_csv failed:', res.error);
    return res;
  });
};

/* Single-enrollment flag toggle — v2 enrollment.is_flagged column. */
window.setEnrollmentFlag = function (enrollmentId, flagged) {
  var sb = getSupabase();
  if (!sb) return Promise.resolve();
  if (!_isSendableId(enrollmentId)) return Promise.resolve();
  return _writeRpc('update_enrollment', {
    p_id: enrollmentId,
    p_patch: { is_flagged: !!flagged },
  }).then(function (res) {
    if (res.error) console.warn('update_enrollment (flag) failed:', res.error);
    return res;
  });
};
function getAssessments(cid) {
  if (_cache.assessments[cid] !== undefined) return _cache.assessments[cid];
  try {
    return JSON.parse(localStorage.getItem('gb-assessments-' + cid)) || [];
  } catch (e) {
    console.warn('Assessments parse fallback:', e);
    return [];
  }
}
function getCategories(cid) {
  if (_cache.categories[cid] !== undefined) return _cache.categories[cid];
  try {
    return JSON.parse(localStorage.getItem('gb-categories-' + cid)) || [];
  } catch (e) {
    console.warn('Categories parse fallback:', e);
    return [];
  }
}
/* `options.copy`: { from, rest } when the list is Copy Grading Setup's,
   copied from the class named `from` (`rest`: other groups were copied
   too). If the save has to wait and is then not sent, the class says so
   when next opened (noteCategoriesNotCopied). */
function saveCategories(cid, arr, options) {
  var prev = _loadPersistedCourseFieldSnapshot('categories', cid, (_cache.categories && _cache.categories[cid]) || []);
  var next = arr || [];
  _saveCourseField('categories', cid, next);
  if (!_writesEnabled() || !_isUuid(cid)) return;
  _persistCategoriesToCanonical(cid, prev, next, options && options.copy);
}
/* The class manager writes categories itself (save_categories,
   reorder_categories) and hands the resulting rows here.
   Cache, localStorage and the server baseline take them without sending
   anything a second time. */
/* A category's Calculation (category.calc_mode): 'percent' averages each
   assessment's percent, 'points' (the default, and anything unset) pools
   points earned and possible. Takes a cache row (calcMode) or a server or
   Class Settings row (calc_mode). */
function categoryCalcMode(category) {
  var mode = category && (category.calcMode || category.calc_mode);
  return mode === 'percent' ? 'percent' : 'points';
}
function adoptCategoriesFromServer(cid, rows) {
  _persistLoadedField(cid, 'categories', rows || []);
  if (typeof clearProfCache === 'function') clearProfCache();
}
/* A list of categories as rows to compare: id, name, weight and
   Calculation, in the order a read returns them (display_order; rows that
   tie there, by id, so the order does not hang on how the server breaks a
   tie). Takes cache rows (displayOrder, calcMode) or server and Class
   Settings rows (display_order, calc_mode). */
function _categoryRowsInOrder(rows) {
  var list = (rows || []).filter(Boolean).map(function (r, i) {
    var order = r.displayOrder != null ? r.displayOrder : r.display_order;
    return {
      id: r.id || null,
      name: String(r.name || '').trim(),
      weight: Number(r.weight) || 0,
      mode: categoryCalcMode(r),
      at: i,
      order: order != null && isFinite(Number(order)) ? Number(order) : i,
    };
  });
  list.sort(function (a, b) {
    if (a.order !== b.order) return a.order - b.order;
    if (a.id && b.id && a.id !== b.id) return a.id < b.id ? -1 : 1;
    return a.at - b.at;
  });
  return list;
}
/* Is the server's list the one wanted? A wanted row with no server id yet
   (a new row in a list this device sent) matches whatever id it was given. */
function _categoryListsMatch(serverRows, wanted) {
  var a = _categoryRowsInOrder(serverRows);
  var b = _categoryRowsInOrder(wanted);
  if (a.length !== b.length) return false;
  return b.every(function (w, i) {
    return (
      (!_isUuid(w.id) || w.id === a[i].id) && w.name === a[i].name && w.weight === a[i].weight && w.mode === a[i].mode
    );
  });
}
// A list as kept with a queued save: the least that _categoryListsMatch reads.
function _categoryListKept(rows) {
  return (rows || []).filter(Boolean).map(function (r, i) {
    var order = r.displayOrder != null ? r.displayOrder : r.display_order;
    return {
      id: r.id || null,
      name: String(r.name || '').trim(),
      weight: Number(r.weight) || 0,
      displayOrder: order != null && isFinite(Number(order)) ? Number(order) : i,
      calcMode: categoryCalcMode(r),
    };
  });
}
/* The class's categories as the server holds them now, in cache shape and
   read order; null when they could not be read. Never throws. */
async function _readServerCategories(cid) {
  try {
    if (!window.v2 || typeof window.v2.listCategories !== 'function') return null;
    var res = await window.v2.listCategories(cid);
    if (!res || res.error || !Array.isArray(res.data)) return null;
    return res.data
      .map(function (r, i) {
        return {
          id: r.id,
          name: r.name || '',
          weight: Number(r.weight) || 0,
          displayOrder: r.display_order != null ? Number(r.display_order) : i,
          calcMode: categoryCalcMode(r),
        };
      })
      .map(function (r, i) {
        return { r: r, i: i };
      })
      .sort(function (a, b) {
        return a.r.displayOrder - b.r.displayOrder || a.i - b.i;
      })
      .map(function (x) {
        return x.r;
      });
  } catch (e) {
    console.warn('The categories could not be read:', e);
    return null;
  }
}

/* Before a whole list of categories is saved over a class the server has:
   is the server's list still the one this screen was opened with?
   save_categories replaces the class's list, so a list opened before a
   change made on another device would delete a category added there and
   put old weights back. Copy Grading Setup asks this before it copies;
   Class Settings asks and saves in one step (saveCategoriesNow).

   `opened` is the list the screen was filled from. Answers a promise of
     { ok: true }                          the same list: save
     { ok: true, local: true }             no server holds this class (Demo
                                           Mode, a class not created yet)
     { ok: false, why: 'changed', rows }   it changed on another device;
                                           rows is the server's list now
     { ok: false, why: 'offline' }         it could not be read: do not save
   On 'changed' the cache takes the server's list, so grades follow it at
   once. Never throws. */
function categoriesStillCurrent(cid, opened) {
  if (!cid || !_writesEnabled() || !_isUuid(cid)) return Promise.resolve({ ok: true, local: true });
  var check = (async function () {
    try {
      if (_isOffline()) return { ok: false, why: 'offline' };
      // A list this device is still sending is part of what it opened with.
      await _categorySaveQueue[cid];
      if (_isOffline()) return { ok: false, why: 'offline' };
      var rows = await _readServerCategories(cid);
      if (!rows) return { ok: false, why: 'offline' };
      if (_categoryListsMatch(rows, opened)) return { ok: true };
      adoptCategoriesFromServer(cid, rows);
      return { ok: false, why: 'changed', rows: rows };
    } catch (e) {
      console.warn('The categories could not be checked before saving:', e);
      return { ok: false, why: 'offline' };
    }
  })();
  // Part of a save: the sync dot and sign-out wait for it.
  return _trackPendingSync(check);
}

var CATEGORY_WRITE_WAIT_MS = 8000; // how long a category save waits for this device's other writes to go first
var CATEGORY_WRITE_ASK_MS = 15000; // how long it waits for the server's answer
var CATEGORY_SAME_MOMENT_MS = 10000; // a queued list sent within this of being made is sent as made

/* Class Settings' Save Categories and its drag to reorder: the server's
   list is read, compared with the list the form was opened with, and the
   save sent, in one online moment or not at all. The save is asked of the
   server directly, never left in the outbox: a list that waited there
   would go out later over whatever another device had done meanwhile.

   `tried` is a list this form sent before and never heard back about (the
   connection went as it left). If that is what the server holds now, it
   landed: nothing is sent again.

   Answers a promise of
     { ok: true, ids }                     saved; the rows' ids, in order
     { ok: true, landed: true, rows }      the earlier try had landed
     { ok: false, why: 'changed', rows }   changed on another device; rows
                                           is the server's list (the cache
                                           has taken it)
     { ok: false, why: 'offline' }         not saved: no connection.
                                           `unknown`: it was sent and no
                                           answer came.
     { ok: false, why: 'waiting' }         not saved: online, but this
                                           device's other changes did not go
                                           first
     { ok: false, why: 'refused', error }  the server said no
   A class no server holds (Demo Mode, one not created yet) saves as it
   always did. Never throws. */
function saveCategoriesNow(cid, rows, opened, tried) {
  if (!cid || !_writesEnabled() || !_isUuid(cid)) {
    return Promise.resolve(window.v2.saveCategories(cid, rows)).then(function (res) {
      if (res && res.error) return { ok: false, why: 'refused', error: res.error };
      return { ok: true, local: true, ids: (res && Array.isArray(res.data) && res.data) || [] };
    });
  }
  return _categoryWriteNow(cid, 'save_categories', _saveCategoriesParams(cid, rows), opened, tried);
}
function reorderCategoriesNow(cid, ids, opened) {
  if (!cid || !_writesEnabled() || !_isUuid(cid)) {
    return Promise.resolve(window.v2.reorderCategories(ids)).then(function (res) {
      if (res && res.error) return { ok: false, why: 'refused', error: res.error };
      return { ok: true, local: true };
    });
  }
  return _categoryWriteNow(cid, 'reorder_categories', { p_ids: (ids || []).filter(_isUuid) }, opened, null);
}
async function _categoryWriteNow(cid, name, params, opened, tried) {
  var noAnswer = { ok: false, why: 'offline' };
  try {
    if (_isOffline()) return noAnswer;
    // Work moved out of a category must reach the server before the list
    // that deletes it, and nothing this device still has to send may land
    // after the list it was made over.
    var gone = await _unsentWritesGone(CATEGORY_WRITE_WAIT_MS);
    if (_isOffline()) return noAnswer;
    // Online, and this device's other writes are still waiting to go.
    if (!gone) return { ok: false, why: 'waiting' };
  } catch (e) {
    return noAnswer;
  }
  // From here it is a save: the sync dot and sign-out wait for it.
  return _trackPendingSync(
    (async function () {
      try {
        var rows = await _readServerCategories(cid);
        if (!rows) return noAnswer;
        if (!_categoryListsMatch(rows, opened)) {
          adoptCategoriesFromServer(cid, rows);
          if (tried && _categoryListsMatch(rows, tried)) return { ok: true, landed: true, rows: rows };
          return { ok: false, why: 'changed', rows: rows };
        }
        // Not this page's own echo: the class is read when realtime says so.
        _echoNeedsReload = true;
        var res = await _withTimeout(
          _callRpcWithAuthGuard(name, params, { suppressSessionExpiredModal: true }),
          CATEGORY_WRITE_ASK_MS,
          'the category save',
        );
        if (res && !res.error) {
          if (name === 'save_categories') _clearCategoriesNotCopied(cid);
          return { ok: true, ids: Array.isArray(res.data) ? res.data : [] };
        }
        if (_noAnswerFromServer(res)) return { ok: false, why: 'offline', unknown: true };
        return { ok: false, why: 'refused', error: res.error };
      } catch (e) {
        console.warn('The category save failed:', e);
        return { ok: false, why: 'offline', unknown: true };
      }
    })(),
  );
}
// No answer, or none that says what the server did: a dropped connection, a
// timeout, a server error, a session that ran out.
function _noAnswerFromServer(res) {
  if (!res || !res.error) return !res;
  var err = res.error;
  var status = Number(res.status || err.status || err.statusCode || 0);
  if (status >= 500 || status === 401 || status === 408 || status === 429 || err.handledSessionExpired) return true;
  var text = [err.code, err.message, err.name, typeof err === 'string' ? err : ''].join(' ');
  return /network|fetch|failed to connect|ECONNREFUSED|timed? ?out|load failed|no_supabase|jwt expired|PGRST301/i.test(
    text,
  );
}

var OLD_CATEGORY_SAVE_NOT_SENT = 'An older category save that could not be checked was not sent';
var WAITED_CATEGORY_SAVE_NOT_SENT = 'A category save that waited was not sent: the list had changed';
/* A save_categories the outbox is about to send. Null to send it as it is;
   else a promise of { answer }: what the outbox hears instead.

   A list sent at once, in the page that made it, goes as made: its maker
   had just checked (Copy Grading Setup) or the class is new. One that
   waited (a retry, a later page, a connection that went) is never sent
   blind. The server's list is read first:
   - it is already this list: there is nothing to send;
   - it is the list this save was made over (kept with the entry as its
     guard): send;
   - anything else: never sent (_discardWrite). That is also every save an
     older build left waiting: it kept no word of what its device had
     loaded, so it goes only when the server already holds its list. */
function _guardCategorySave(params, options) {
  if (!options.viaOutbox || !params || !_isUuid(params.p_course_id)) return null;
  var guard = options.guard;
  var made = Number(options.categoriesMadeAt) || 0;
  var sameMoment = made > 0 && Date.now() - made < CATEGORY_SAME_MOMENT_MS && !options.attempts && !options.lastTry;
  if (sameMoment) return null;
  var cid = params.p_course_id;
  return (async function () {
    var rows = await _readServerCategories(cid);
    if (!rows) {
      return { answer: { data: null, error: { message: 'network: the categories could not be read' } } };
    }
    var mine = (Array.isArray(params.p_categories) ? params.p_categories : []).map(function (c, i) {
      return Object.assign({}, c, { display_order: i });
    });
    if (_categoryListsMatch(rows, mine)) {
      return {
        answer: {
          data: rows.map(function (r) {
            return r.id;
          }),
          error: null,
        },
      };
    }
    if (guard && Array.isArray(guard.expected) && _categoryListsMatch(rows, guard.expected)) return null;
    adoptCategoriesFromServer(cid, rows);
    // Copy Grading Setup's list: its message said "copied", so the class
    // says it was not, above its categories, when next opened.
    if (guard && _plainObject(guard.copy)) {
      noteCategoriesNotCopied(cid, { why: 'changed', from: guard.copy.from, rest: guard.copy.rest });
    }
    return { answer: _discardWrite(cid, guard ? WAITED_CATEGORY_SAVE_NOT_SENT : OLD_CATEGORY_SAVE_NOT_SENT) };
  })();
}

/* What Class Settings keeps on this device for a class's categories when a
   save was not made (gb-category-draft-<cid>), so nothing the teacher typed
   is lost with the tab:
     rows, opened   the edits that could not be saved (no connection), and
                    the list they were made over
     typed          what the teacher had typed when the list turned out to
                    have changed on another device: shown beside the
                    current list to copy from
     tried          a list this computer sent whose answer never came: if
                    the server holds it, it was this computer's own save
                    that landed, not a change made on another device
     note           { why, from, rest }: Copy Grading Setup left this
                    class's categories alone, and why
   Not class data: never sent, not in a backup, gone with the class. */
function getCategoryDraft(cid) {
  var draft = cid ? _safeParseLS('gb-category-draft-' + cid, null) : null;
  return _plainObject(draft) ? draft : null;
}
function saveCategoryDraft(cid, draft) {
  if (!cid) return;
  var keep = {};
  if (_plainObject(draft)) {
    ['rows', 'opened', 'typed', 'tried'].forEach(function (k) {
      if (Array.isArray(draft[k])) keep[k] = draft[k];
    });
    if (_plainObject(draft.note)) keep.note = draft.note;
  }
  try {
    if (Object.keys(keep).length) _safeLSSet('gb-category-draft-' + cid, JSON.stringify(keep));
    else localStorage.removeItem('gb-category-draft-' + cid);
  } catch (e) {
    /* storage full or closed: the form still holds it while it is open */
  }
}
/* Copy Grading Setup did not copy this class's categories: say so when the
   class is next opened in Class Settings. */
/* A list of categories reached the server for this class: the note above
   says nothing true any more. */
function _clearCategoriesNotCopied(cid) {
  var draft = getCategoryDraft(cid);
  if (!draft || !draft.note) return;
  delete draft.note;
  saveCategoryDraft(cid, draft);
}
function noteCategoriesNotCopied(cid, note) {
  var draft = getCategoryDraft(cid) || {};
  draft.note = {
    why: note && note.why === 'changed' ? 'changed' : 'offline',
    from: (note && note.from) || '',
    rest: !!(note && note.rest),
  };
  saveCategoryDraft(cid, draft);
}
function getCategoryById(cid, categoryId) {
  if (!categoryId) return null;
  return (
    getCategories(cid).find(function (c) {
      return c.id === categoryId;
    }) || null
  );
}
function saveAssessments(cid, arr) {
  var prev = _loadPersistedCourseFieldSnapshot(
    'assessments',
    cid,
    (_cache.assessments && _cache.assessments[cid]) || [],
  );
  _saveCourseField('assessments', cid, arr);
  if (_writesEnabled() && _isUuid(cid)) _registerLocalRows(cid, 'assessment', arr, 'create_assessment');
  if (arr.length < prev.length) _cleanOrphanedScores(cid, arr);
  // A class that has no server id yet is replayed by
  // _migrateCourseDataLocalToCanonical when it gets one.
  if (!_writesEnabled() || !_isUuid(cid)) return;
  if (!cid || !arr) return;
  _persistAssessmentsToCanonical(cid, prev, arr);
  // Draft and Returned: a change to a piece of work can change its rows on
  // the server with no grade saved (its scoring moved to or from DIBELS,
  // which has no Draft or Returned; the work deleted). Read them once the
  // change has landed. Nothing for a class whose student page is off.
  if (_serverKeepsRows(cid)) _refreshGradeReturnsSoon(cid);
}

/* Per-course save lock for assessments; see _studentSaveQueue for why the
   diff waits for the earlier dispatch, not the earlier answer. */
var _assessmentSaveQueue = {}; // cid → Promise of every save so far landing
var _assessmentDispatchQueue = {}; // cid → Promise of the last diff being dispatched

function _persistAssessmentsToCanonical(cid, prev, arr) {
  var sb = getSupabase();
  if (!sb) return;
  var tail = _assessmentDispatchQueue[cid] || Promise.resolve();
  var landed = null;
  var dispatched = tail.then(function () {
    var before = _serverStateOr('assessments', cid, prev);
    var after = _cache.assessments[cid] || arr;
    var prevById = {};
    before.forEach(function (a) {
      if (a && a.id) prevById[a.id] = a;
    });
    var arrById = {};
    after.forEach(function (a) {
      if (a && a.id) arrById[a.id] = a;
    });

    var ops = [];

    // Adds
    after.forEach(function (a) {
      if (a && a.id && !prevById[a.id]) {
        ops.push(_canonicalCreateAssessment(sb, cid, a));
      } else if (a && a.id) _dropUnqueuedPending('assessment', a.id);
    });
    // Deletes. A row whose create is still queued is simply not created; one
    // already sent is deleted by its server id once that is known.
    before.forEach(function (a) {
      if (!a || !a.id || arrById[a.id]) return;
      var target = _cancelPendingCreateOrResolve(cid, 'assessment', a.id);
      if (target) ops.push(_canonicalDeleteAssessment(sb, cid, target));
    });
    // Updates. An edit to a row whose create is still queued waits behind it.
    // Against a server baseline only the changed fields go, so a stale copy
    // can't revert another device's edits; without one, the whole row.
    var hasBase = _hasServerState('assessments', cid);
    after.forEach(function (a) {
      var p = a && a.id ? prevById[a.id] : null;
      if (!p || !_isSendableId(a.id)) return;
      if (_assessmentChanged(p, a)) {
        ops.push(_canonicalUpdateAssessment(sb, cid, a.id, a, hasBase ? p : null));
      }
    });

    _rememberServerState('assessments', cid, after);
    landed = Promise.all(ops).catch(function (err) {
      console.warn('Assessment sync to canonical RPCs failed for one or more rows:', err);
    });
  });
  _assessmentDispatchQueue[cid] = dispatched;
  var earlier = _assessmentSaveQueue[cid] || Promise.resolve();
  _assessmentSaveQueue[cid] = _trackPendingSync(
    Promise.all([
      earlier,
      dispatched.then(function () {
        return landed;
      }),
    ]).then(function () {}),
  );
  return _assessmentSaveQueue[cid];
}

function _assessmentChanged(a, b) {
  return (
    (a.title || '') !== (b.title || '') ||
    (a.date || '') !== (b.date || '') ||
    (a.dateAssigned || '') !== (b.dateAssigned || '') ||
    (a.dueDate || '') !== (b.dueDate || '') ||
    (a.description || '') !== (b.description || '') ||
    (a.type || '') !== (b.type || '') ||
    (a.categoryId || a.category_id || '') !== (b.categoryId || b.category_id || '') ||
    (a.scoreMode || '') !== (b.scoreMode || '') ||
    (a.collaboration || '') !== (b.collaboration || '') ||
    JSON.stringify(a.pairs || []) !== JSON.stringify(b.pairs || []) ||
    JSON.stringify(a.groups || []) !== JSON.stringify(b.groups || []) ||
    JSON.stringify(a.excludedStudents || []) !== JSON.stringify(b.excludedStudents || []) ||
    (a.groupCount || 0) !== (b.groupCount || 0) ||
    JSON.stringify(a.gradedSeparately || []) !== JSON.stringify(b.gradedSeparately || []) ||
    JSON.stringify(a.groupGradeAside || {}) !== JSON.stringify(b.groupGradeAside || {}) ||
    (a.maxPoints || 0) !== (b.maxPoints || 0) ||
    (a.weight || 1) !== (b.weight || 1) ||
    (a.evidenceType || '') !== (b.evidenceType || '') ||
    (a.notes || '') !== (b.notes || '') ||
    (a.rubricId || '') !== (b.rubricId || '') ||
    (a.moduleId || '') !== (b.moduleId || '') ||
    (a.copyGroup || '') !== (b.copyGroup || '') ||
    _coreCompetencyIdsOf(a.coreCompetencyIds).join() !== _coreCompetencyIdsOf(b.coreCompetencyIds).join() ||
    Number(a.display_order || 0) !== Number(b.display_order || 0) ||
    JSON.stringify(a.tagIds || []) !== JSON.stringify(b.tagIds || [])
  );
}

function _localCollabModeFromCanonical(mode) {
  if (mode === 'pairs') return 'pair';
  if (mode === 'groups') return 'group';
  if (mode === 'none') return 'individual';
  return mode || 'individual';
}

function _canonicalCollabModeFromAssessment(a) {
  var mode = a && (a.collaboration || a.collabMode);
  if (mode === 'pair' || mode === 'pairs') return 'pairs';
  if (mode === 'group' || mode === 'groups') return 'groups';
  return 'none';
}

function _collabConfigFromAssessment(a) {
  var config = {};
  if (a && Array.isArray(a.pairs) && a.pairs.length) config.pairs = a.pairs;
  if (a && Array.isArray(a.groups) && a.groups.length) config.groups = a.groups;
  if (a && Array.isArray(a.excludedStudents) && a.excludedStudents.length) {
    config.excludedStudents = a.excludedStudents;
  }
  // The group panel's Number of Groups, kept even before any groups are made.
  if (_canonicalCollabModeFromAssessment(a) === 'groups' && a.groupCount > 0) config.groupCount = a.groupCount;
  if (a && Array.isArray(a.gradedSeparately) && a.gradedSeparately.length) {
    config.gradedSeparately = a.gradedSeparately;
  }
  // The group's grade, kept while every member is Missing or Excused.
  if (a && a.groupGradeAside && Object.keys(a.groupGradeAside).length) config.groupGradeAside = a.groupGradeAside;
  return Object.keys(config).length ? config : null;
}

function _persistAssessmentCollab(sb, assessmentId, a) {
  if (!sb || !_isSendableId(assessmentId)) return Promise.resolve();
  var mode = _canonicalCollabModeFromAssessment(a);
  var config = mode === 'none' ? null : _collabConfigFromAssessment(a);
  return _writeRpc('save_collab', { p_id: assessmentId, p_mode: mode, p_config: config }).then(function (res) {
    if (res.error) console.warn('save_collab failed:', res.error, assessmentId);
    return res;
  });
}

/* v2 create_assessment — explicit positional params.  tagIds passed as uuid[].
   Returns the new assessment id; client patches its cached row to swap in the
   canonical uuid so subsequent saves hit update_assessment, not re-create. */
function _canonicalCreateAssessment(sb, cid, a) {
  var localId = a.id;
  var tagIds = (a.tagIds || []).filter(_isUuid);
  var params = {
    p_course_id: cid,
    p_title: a.title || '',
    p_category_id: _isUuid(a.categoryId) ? a.categoryId : null,
    p_description: a.description || null,
    p_date_assigned: a.dateAssigned || a.date || null,
    p_due_date: a.dueDate || null,
    p_score_mode: a.scoreMode || 'proficiency',
    p_max_points: a.maxPoints != null ? Number(a.maxPoints) : null,
    p_weight: a.weight != null ? Number(a.weight) : 1.0,
    p_evidence_type: a.evidenceType || null,
    p_rubric_id: _isUuid(a.rubricId) ? a.rubricId : null,
    p_module_id: _isUuid(a.moduleId) ? a.moduleId : null,
    p_tag_ids: tagIds,
  };
  // Only sent when set, so a page from before copies existed (and the
  // function before migration 20261018) keeps working unchanged.
  if (_isUuid(a.copyGroup)) params.p_copy_group = a.copyGroup;
  // Likewise only when ticked (migration 20261027).
  var coreIds = _coreCompetencyIdsOf(a.coreCompetencyIds);
  if (coreIds.length) params.p_core_competency_ids = coreIds;
  var rec = _registerPendingCreate(cid, 'assessment', localId, 'create_assessment');
  var created = _writeRpc('create_assessment', params, { entryId: rec ? rec.entryId : undefined }).then(function (res) {
    if (res.error) {
      if (!res.error.cancelled) console.warn('create_assessment failed:', res.error, a);
      return;
    }
    // Re-keys cache, gb-assessments, baseline, scores, statuses… and sends
    // what waited on the local id. Already done when the outbox reported
    // success.
    if (rec) _onCreateLanded(rec.entryId, res.data);
  });
  // Collaboration settings go right behind the create, re-keyed when it
  // lands, so they are not lost with this page. create_assessment defaults
  // to no collaboration, so only a real mode is sent.
  if (_canonicalCollabModeFromAssessment(a) !== 'none' && rec) {
    return Promise.all([created, _persistAssessmentCollab(sb, localId, a)]);
  }
  return created;
}

/* The keys of `patch` whose value differs from `basePatch`'s. */
function _changedPatch(patch, basePatch) {
  var out = {};
  Object.keys(patch).forEach(function (k) {
    if (JSON.stringify(patch[k]) !== JSON.stringify(basePatch[k])) out[k] = patch[k];
  });
  return out;
}

/* v2 update_assessment(p_id, p_patch jsonb, p_tag_ids uuid[]).
   The server leaves alone every patch key left out, and the tag set when
   p_tag_ids is left out. With `base` (the server baseline row) only what
   differs from it is sent: changed patch keys, the tag list if it changed,
   and save_collab if collaboration changed. Nothing changed, nothing sent.
   Without `base`, everything. */
function _canonicalUpdateAssessment(sb, cid, assessmentId, a, base) {
  var tagIds = (a.tagIds || []).filter(_isUuid);
  var patch = _assessmentPatchOf(a);
  var sendTags = true;
  var sendCollab = true;
  if (base) {
    patch = _changedPatch(patch, _assessmentPatchOf(base));
    sendTags = JSON.stringify(tagIds) !== JSON.stringify((base.tagIds || []).filter(_isUuid));
    sendCollab =
      _canonicalCollabModeFromAssessment(a) !== _canonicalCollabModeFromAssessment(base) ||
      JSON.stringify(_collabConfigFromAssessment(a)) !== JSON.stringify(_collabConfigFromAssessment(base));
  }
  var ops = [];
  if (Object.keys(patch).length || sendTags) {
    var params = { p_id: assessmentId, p_patch: patch };
    if (sendTags) params.p_tag_ids = tagIds;
    var updated = _writeRpc('update_assessment', params).then(function (res) {
      if (res.error) console.warn('update_assessment failed:', res.error, assessmentId);
      return res;
    });
    ops.push(updated);
  }
  // Sent alongside, not after the update lands: it sets other columns, and a
  // reload before the update landed would lose it.
  if (sendCollab) ops.push(_persistAssessmentCollab(sb, assessmentId, a));
  return Promise.all(ops);
}

function _assessmentPatchOf(a) {
  var patch = _assessmentFieldsPatchOf(a);
  // Never sent as null: a stale copy of a row from before it was linked
  // must not unlink it.
  if (_isUuid(a.copyGroup)) patch.copy_group = a.copyGroup;
  return patch;
}

function _assessmentFieldsPatchOf(a) {
  return {
    title: a.title || '',
    description: a.description || '',
    category_id: _isUuid(a.categoryId) ? a.categoryId : null,
    date_assigned: a.dateAssigned || a.date || null,
    due_date: a.dueDate || null,
    score_mode: a.scoreMode || 'proficiency',
    max_points: a.maxPoints != null ? String(a.maxPoints) : null,
    weight: a.weight != null ? String(a.weight) : '1',
    evidence_type: a.evidenceType || null,
    rubric_id: _isUuid(a.rubricId) ? a.rubricId : null,
    module_id: _isUuid(a.moduleId) ? a.moduleId : null,
    display_order: Number(a.display_order || 0),
    core_competency_ids: _coreCompetencyIdsOf(a.coreCompetencyIds),
  };
}

/* An assessment's Core Competency codes in CORE_COMPETENCIES order, each
   once, unknown codes dropped. The server refuses an unknown code. */
function _coreCompetencyIdsOf(ids) {
  if (!Array.isArray(ids) || !ids.length) return [];
  return CORE_COMPETENCIES.map(function (cc) {
    return cc.id;
  }).filter(function (id) {
    return ids.indexOf(id) >= 0;
  });
}

/* v2 delete_assessment(p_id).  FK cascade handles scores/rubric_scores/
   tag_scores/assessment_tag/term_rating_assessment; observation.assessment_id
   is ON DELETE SET NULL so observations survive. */
function _canonicalDeleteAssessment(sb, cid, assessmentId) {
  return _writeRpc('delete_assessment', { p_id: assessmentId }).then(function (res) {
    if (res.error) console.warn('delete_assessment failed:', res.error, assessmentId);
  });
}

/* ── Public v2 assessment helpers (Phase 4.2) ─────────────────── */

window.duplicateAssessment = function (srcAssessmentId) {
  var sb = getSupabase();
  if (!sb) return Promise.resolve();
  if (!_isUuid(srcAssessmentId)) return Promise.resolve();
  return _writeRpc(
    'duplicate_assessment',
    _stampIdempotencyKey('duplicate_assessment', { p_src_id: srcAssessmentId }),
  ).then(function (res) {
    if (res.error) console.warn('duplicate_assessment failed:', res.error);
    return res;
  });
};

window.saveAssessmentTags = function (assessmentId, tagIds) {
  var sb = getSupabase();
  if (!sb) return Promise.resolve();
  if (!_isUuid(assessmentId)) return Promise.resolve();
  var ids = (tagIds || []).filter(_isUuid);
  return _writeRpc('save_assessment_tags', { p_id: assessmentId, p_tag_ids: ids }).then(function (res) {
    if (res.error) console.warn('save_assessment_tags failed:', res.error);
    return res;
  });
};

/* Collaboration panel save (§8.5). mode ∈ {none, pairs, groups}; config is
   a client-computed jsonb blob (excluded ids, random pairs, manual groups,
   etc.) — server stores it verbatim, nulled when mode='none'. */
window.saveCollab = function (assessmentId, mode, config) {
  var sb = getSupabase();
  if (!sb) return Promise.resolve();
  if (!_isUuid(assessmentId)) return Promise.resolve();
  var canonicalMode = _canonicalCollabModeFromAssessment({ collaboration: mode });
  return _writeRpc('save_collab', {
    p_id: assessmentId,
    p_mode: canonicalMode,
    p_config: canonicalMode === 'none' ? null : config || null,
  }).then(function (res) {
    if (res.error) console.warn('save_collab failed:', res.error);
    return res;
  });
};

/* Drop the scores and statuses of assessments that are gone. The server
   removes them with the assessment (delete_assessment cascades), so nothing
   is sent: one clear per student would only race the delete and fail on the
   foreign key. The local copy and the baseline both lose the rows, so the
   next save sees no difference. */
function _cleanOrphanedScores(cid, validArr) {
  var validIds = new Set(
    validArr.map(function (a) {
      return a.id;
    }),
  );
  function dropScores(blob) {
    var changed = false;
    Object.keys(blob || {}).forEach(function (sid) {
      if (!Array.isArray(blob[sid])) return;
      var before = blob[sid].length;
      blob[sid] = blob[sid].filter(function (e) {
        return validIds.has(e.assessmentId);
      });
      if (blob[sid].length !== before) changed = true;
    });
    return changed;
  }
  function dropStatuses(blob) {
    var changed = false;
    Object.keys(blob || {}).forEach(function (key) {
      var aid = key.split(':').slice(1).join(':');
      if (aid && !validIds.has(aid)) {
        delete blob[key];
        changed = true;
      }
    });
    return changed;
  }
  var scores = getScores(cid);
  if (dropScores(scores)) _saveCourseField('scores', cid, scores);
  var statuses = getAssignmentStatuses(cid);
  if (dropStatuses(statuses)) _saveCourseField('statuses', cid, statuses);
  // Ticked checkboxes and printed rubrics are keyed 'sid:aid' like statuses.
  var checks = getRubricChecks(cid);
  if (dropStatuses(checks)) _saveCourseField('rubricChecks', cid, checks);
  var prints = getRubricPrints(cid);
  if (dropStatuses(prints)) _saveCourseField('rubricPrints', cid, prints);
  var dibels = getDibelsScores(cid);
  if (dropStatuses(dibels)) _saveCourseField('dibels', cid, dibels);
  _dropGradeReturnsNotIn(cid, validIds);
  if (_hasServerState('scores', cid)) dropScores(_serverState.scores[cid]);
  if (_hasServerState('statuses', cid)) dropStatuses(_serverState.statuses[cid]);
}
function getOverrides(cid) {
  if (_cache.overrides[cid] !== undefined) return _cache.overrides[cid];
  try {
    return JSON.parse(localStorage.getItem('gb-overrides-' + cid)) || {};
  } catch (e) {
    console.warn('Overrides parse fallback:', e);
    return {};
  }
}
function saveOverrides(cid, obj) {
  _saveCourseField('overrides', cid, obj);
}
function getNotes(cid) {
  if (_cache.notes[cid] !== undefined) return _cache.notes[cid];
  try {
    return JSON.parse(localStorage.getItem('gb-notes-' + cid)) || {};
  } catch (e) {
    console.warn('Notes parse fallback:', e);
    return {};
  }
}
/* Per-course note ids: enrollmentId → [note uuid, …]. The client keeps one
   note body per student, but the server stores note rows (schema-immutable;
   "edit" = delete + insert). Ids come from get_student_profile at load time
   and from upsert_note responses, so editing a note loaded in an earlier
   session replaces its rows instead of adding another. */
var _noteIds = {};
var _noteSaveQueue = {};

function saveNotes(cid, obj) {
  var prev = _loadPersistedCourseFieldSnapshot('notes', cid, (_cache.notes && _cache.notes[cid]) || {});
  _saveCourseField('notes', cid, obj);
  if (!_writesEnabled() || !_isUuid(cid)) return;
  if (!obj) return;
  _persistNotesToCanonical(cid, prev, obj);
}

function _persistNotesToCanonical(cid, prev, obj) {
  var sb = getSupabase();
  if (!sb || !window.v2 || !window.v2.addNote) return;
  var tail = _noteSaveQueue[cid] || Promise.resolve();
  var next = tail.then(function () {
    var before = _serverStateOr('notes', cid, prev) || {};
    var after = _cache.notes[cid] || obj;
    _rememberServerState('notes', cid, after);
    if (!_noteIds[cid]) _noteIds[cid] = {};
    var ids = _noteIds[cid];

    function removeExisting(eid) {
      var existing = (ids[eid] || []).filter(_isUuid);
      delete ids[eid];
      return Promise.all(
        existing.map(function (id) {
          return window.v2.deleteNote(id);
        }),
      );
    }

    var ops = [];
    var eids = {};
    Object.keys(before).forEach(function (eid) {
      eids[eid] = true;
    });
    Object.keys(after || {}).forEach(function (eid) {
      eids[eid] = true;
    });
    Object.keys(eids).forEach(function (eid) {
      // A note on a student whose enrol is still queued waits behind it.
      if (!_isSendableId(eid)) return;
      var body = (after || {})[eid];
      if (body === before[eid]) return; // unchanged
      // The delete and the insert touch different rows, so both are pushed
      // now; awaiting the delete first left the insert out of the outbox.
      var op = removeExisting(eid);
      if (body && body.trim()) {
        op = Promise.all([
          op,
          window.v2.addNote(eid, body).then(function (res) {
            var id = res && res.data;
            if (id) ids[eid] = [id];
          }),
        ]);
      }
      ops.push(
        op.catch(function (err) {
          console.warn('Note sync failed for enrollment', eid, ':', err);
        }),
      );
    });

    return Promise.all(ops);
  });
  _noteSaveQueue[cid] = _trackPendingSync(next);
  return _noteSaveQueue[cid];
}

/*
  Score storage: gb-scores-{courseId}
  { studentId: [ { id, assessmentId, tagId, score(1-4), date, type, note, created } ] }
  Each score entry = one score for one student, one assessment, one tag.
  An assessment with 4 tags produces 4 score entries per student.
*/
/* Rubric criterion scores were once kept under the criterion's competencies,
   one slot shared by every criterion on that competency; each now sits
   under its own criterion id (docs/DECISIONS.md, "Rubric criteria score on
   their own"). Scores from an older save are moved once: each criterion
   takes the entry under its first competency, and rubric work's
   competency-keyed entries are dropped. It runs again when the class's
   rubrics change, so a rubric loaded later still moves its scores. */
var _rubricKeyedScores = new WeakMap();
// Counts up each time a class's rubrics are set (cache, save, load, re-key),
// so a scores object moved under one set of rubrics is looked at again under
// the next, and never otherwise.
var _rubricsRev = {};
function _noteRubricsSet(cid) {
  _rubricsRev[cid] = (_rubricsRev[cid] || 0) + 1;
}
/* Rubric work whose criteria feed competencies: { assessmentId: criteria }
   and, per assessment, the competency ids an old entry would sit under. */
function _rubricLegacyKeyIndex(cid) {
  var byAssessment = {};
  var legacyTags = {};
  (getAssessments(cid) || []).forEach(function (a) {
    var rubricId = a && (a.rubricId || a.rubric_id);
    if (!rubricId || isPointsScored(a)) return;
    var rubric = getRubricById(cid, rubricId);
    var criteria = ((rubric && rubric.criteria) || []).filter(function (c) {
      return c && c.id && c.tagIds && c.tagIds.length;
    });
    if (!criteria.length) return;
    byAssessment[a.id] = criteria;
    var tags = {};
    criteria.forEach(function (c) {
      c.tagIds.forEach(function (t) {
        tags[t] = true;
      });
    });
    legacyTags[a.id] = tags;
  });
  return { byAssessment: byAssessment, legacyTags: legacyTags };
}
// Whether any entry still sits under a competency on rubric work.
function _hasLegacyRubricKeys(scores, legacyTags) {
  return Object.keys(scores).some(function (sid) {
    var entries = scores[sid];
    return (
      Array.isArray(entries) &&
      entries.some(function (e) {
        return e && legacyTags[e.assessmentId] && legacyTags[e.assessmentId][e.tagId];
      })
    );
  });
}
function _migrateRubricScoreKeys(cid, scores) {
  if (!scores || typeof scores !== 'object') return scores;
  var sig = _rubricsRev[cid] || 0;
  if (_rubricKeyedScores.get(scores) === sig) return scores;
  var index = _rubricLegacyKeyIndex(cid);
  var byAssessment = index.byAssessment;
  // Nearly always: nothing old to move, found in one pass over the entries.
  if (!_hasLegacyRubricKeys(scores, index.legacyTags)) {
    _rubricKeyedScores.set(scores, sig);
    return scores;
  }
  Object.keys(scores).forEach(function (sid) {
    var entries = scores[sid];
    if (!Array.isArray(entries) || !entries.length) return;
    var added = [];
    var drop = [];
    Object.keys(byAssessment).forEach(function (aid) {
      var own = entries.filter(function (e) {
        return e && e.assessmentId === aid;
      });
      if (!own.length) return;
      var tagOwned = {};
      byAssessment[aid].forEach(function (c) {
        c.tagIds.forEach(function (t) {
          tagOwned[t] = true;
        });
        var has = own.find(function (e) {
          return e.tagId === c.id;
        });
        var legacy = null;
        for (var i = 0; i < c.tagIds.length && !legacy; i++) {
          legacy =
            own.find(function (e) {
              return e.tagId === c.tagIds[i];
            }) || null;
        }
        if (!legacy) return;
        if (!has) {
          added.push(Object.assign({}, legacy, { id: aid + ':' + c.id, tagId: c.id }));
          return;
        }
        // The criterion's own entry wins; a note only the old entry holds moves.
        ['critNote', 'critBeyond'].forEach(function (field) {
          if (legacy[field] && !has[field]) has[field] = legacy[field];
        });
      });
      own.forEach(function (e) {
        if (tagOwned[e.tagId]) drop.push(e);
      });
    });
    if (!added.length && !drop.length) return;
    for (var i = entries.length - 1; i >= 0; i--) if (drop.indexOf(entries[i]) >= 0) entries.splice(i, 1);
    added.forEach(function (e) {
      entries.push(e);
    });
  });
  _rubricKeyedScores.set(scores, sig);
  return scores;
}
function getScores(cid) {
  if (_cache.scores[cid] !== undefined) return _migrateRubricScoreKeys(cid, _cache.scores[cid]);
  try {
    return _migrateRubricScoreKeys(cid, JSON.parse(localStorage.getItem('gb-scores-' + cid)) || {});
  } catch (e) {
    console.warn('Scores parse fallback:', e);
    return {};
  }
}
// fillUndone: how many entries restoreScoreCells took out because the fill
// it undoes added them. Only those may take the entry count past the guard.
function saveScores(cid, obj, fillUndone) {
  _applyIdRekeysToScores(cid, obj);
  // The baseline is read in the same key space as the scores, or a copy
  // saved with rubric scores under competencies would make every criterion
  // look new and every competency key look removed (a clear on the server).
  var prev = _migrateRubricScoreKeys(
    cid,
    _loadPersistedCourseFieldSnapshot('scores', cid, (_cache.scores && _cache.scores[cid]) || {}),
  );
  var prevCount = prev ? Object.keys(prev).length : 0;
  var newCount = obj ? Object.keys(obj).length : 0;
  // Group work: which linked members' grades this save changes (Group grading).
  var groupBefore = _groupWriteDepth ? null : _groupGradesIn(cid, prev);
  // Block catastrophic saves: if student-count drops >50%, refuse to save.
  // This prevents empty/partial objects from wiping all grades.
  if (prevCount > 2 && newCount < prevCount * 0.5) {
    console.error(
      '[GUARD] BLOCKED scores save — student-count dropped from',
      prevCount,
      'to',
      newCount,
      '(>50% loss). This likely indicates a bug or corrupted state. Stack:',
      new Error().stack,
    );
    if (typeof showSyncToast === 'function') showSyncToast('Score save blocked — data loss prevented', 'error');
    return false;
  }
  // Also count total score entries for a more granular check
  var prevEntries = 0,
    newEntries = 0;
  if (prev) for (var _ps in prev) prevEntries += (prev[_ps] || []).length;
  if (obj) for (var _ns in obj) newEntries += (obj[_ns] || []).length;
  if (prevEntries > 10 && newEntries + (fillUndone || 0) < prevEntries * 0.3) {
    console.error(
      '[GUARD] BLOCKED scores save — entry-count dropped from',
      prevEntries,
      'to',
      newEntries,
      '(>70% loss). Stack:',
      new Error().stack,
    );
    if (typeof showSyncToast === 'function') showSyncToast('Score save blocked — data loss prevented', 'error');
    return false;
  }
  var gradesWere = _gradeBefore(cid, 'scores');
  var lsOk = _saveCourseField('scores', cid, obj);
  _gradeAfter(cid, gradesWere, obj);
  var refused = false;
  if (_writesEnabled()) {
    var refusals = _writeRefusals;
    var baseline = _migrateRubricScoreKeys(cid, _serverStateOr('scores', cid, prev));
    persistScoreDiffToCanonical(cid, baseline, obj || {});
    _dismissOverriddenScoreWrites(cid, baseline, obj || {});
    _rememberServerState('scores', cid, obj || {});
    // A refused write's cell goes back in the baseline (_onWriteRefused).
    refused = _writeRefusals !== refusals;
  }
  if (groupBefore) _syncChangedGroups(cid, groupBefore, obj || {});
  return refused ? false : lsOk;
}

/* Undo for a fill: put back only the cells it changed (`before` against
   `after`, both copies of the class's scores) that still hold what it
   wrote. Anything scored since, on this work or any other, stays.
   A cell is compared by its score and +/− only: a refresh from the server
   a few seconds after the fill rebuilds every entry with the server's id
   and dates, and the cell still holds what the fill wrote. A proficiency 0
   and no entry are the same unscored cell (the server deletes a 0). */
function restoreScoreCells(cid, before, after) {
  var now = getScores(cid);
  var next = structuredClone(now);
  var was = _scoreEntriesByKey(before);
  var made = _scoreEntriesByKey(after);
  var cur = _scoreEntriesByKey(next);
  var value = function (x) {
    if (!x || !isScoreEntered(_assessmentById(cid, x.entry.assessmentId), x.entry)) return '';
    return String(Number(x.entry.score)) + ':' + (x.entry.mod || 0);
  };
  var removed = 0;
  var same = function (x, y) {
    return value(x) === value(y);
  };
  Object.keys(Object.assign({}, was, made)).forEach(function (key) {
    if (same(was[key], made[key]) || !same(cur[key], made[key])) return;
    var sid = (was[key] || made[key]).sid;
    var list = next[sid] || (next[sid] = []);
    var at = cur[key] ? list.indexOf(cur[key].entry) : -1;
    if (at < 0) {
      if (was[key]) list.push(structuredClone(was[key].entry));
      return;
    }
    var entry = list[at];
    // Proficiency work the fill scored goes back to 0, unscored, as a click
    // that clears a level leaves it. On points and Complete/Incomplete work
    // 0 is a score, so an entry the fill added goes, and saveScores is told
    // how many so its data-loss guard allows that drop and no more.
    if (!was[key] && isPointsScored(_assessmentById(cid, entry.assessmentId))) {
      list.splice(at, 1);
      removed++;
    } else {
      entry.score = was[key] ? was[key].entry.score : 0;
      if (was[key] && was[key].entry.mod) entry.mod = was[key].entry.mod;
      else delete entry.mod;
    }
  });
  saveScores(cid, next, removed);
  if (getScores(cid) === next) persistScoreDiffToCanonical(cid, now, next);
}

/* ── Draft and Returned (S0-F2) ──────────────────────────────────────────
   Every grade is Draft or Returned (docs/plans/student-page-build-plan.md
   1.2). The rule is shared/grade-state.js; this block keeps its rows beside
   the scores and runs it on every score write, so any screen's save follows
   it, in Demo Mode and offline too.

   The rows: { assessmentId: { studentId: row } } in the cache
   (gradeReturns) and in localStorage under gb-grade-returns-<cid>. A row is
   the server's grade_return row with nulls left out: { is_draft,
   returned_at, returned_copy, previous_copy, updated_at, seen_at }, the
   shape the server's list of a class's rows will come in.

   Rows are kept only while the class's student page is on (the build
   switch, courseConfig.student_page_enabled). With it off nothing is kept:
   a grade is Returned as soon as it is saved, as it always was.

   Every score writer calls _gradeBefore before it saves and _gradeAfter
   once the save is done: the one-cell writers that save the scores
   themselves (_upsertScoreOne, _saveRubricCriterionNote,
   _saveTagCommentOne, _saveScoreCommentOne), saveScores (fills, clears,
   undo, group copies), and the two tick writers. _gradeBefore reads the
   grades as they were from the saved copy; _gradeAfter compares cell by
   cell and runs the rule on each cell that changed. Neither can stop or
   reorder a save: both read the switch from the class's settings before
   anything else, touch GradeState only when it is on, and catch and report
   a failure (_gradeStateFailed). Loads, re-keys, withdrawing a student and
   moveRubricScores do not grade, and do not run the rule.

   THE SERVER (S0-W1). The database keeps the same rows by triggers
   (migrations/2026110902_grade_return.sql). For a signed-in teacher:
   1. The two settings are the server's. They come on the course row with
      the class (_applyBundleCourseConfig), and the switch counts only once
      the server has said it is on (_serverSaysStudentPage): a value this
      device merely holds (a restored backup, a copied class, an old saved
      copy's settings object) shows nothing and sends nothing.
   2. They are sent ONLY by the actions that change them, through
      saveReturnSettings: the Return Grades choice, the build switch, and a
      class made on this device going up with the choice it was made with
      (Duplicate Class). saveCourseConfig never sends either, and cannot
      change either for a class the server has: any other settings save
      from a device holding an old copy would otherwise put the old choice
      back, and the server returns every waiting draft when a class stops
      holding. An update_course that carries either beside another setting
      has them taken out as it is sent (_onlyOwnReturnSettings).
   3. A change that STARTS a class holding grades (the switch turned on,
      When I Return Them chosen) is made on the server first, with the
      teacher waiting, and on this device only when the server has
      answered: a grade can then never be saved as a draft here and
      returned there. A change that stops it is made here at once and
      queued: both sides return what waits (the server by a trigger in that
      update_course, this device in _returnSettingsSaved) and no return is
      sent.
   4. The rows are the server's too: list_course_grade_returns, read when
      the class loads, after a change from another device (both in
      _doInitData) and once this device's own grade writes, Return or
      setting change have landed (_refreshGradeReturnsSoon). The read is
      made only for a class whose student page is on.
   5. Between a save here and that read, the row is the one the rule in
      shared/grade-state.js gives (_gradeRule): the same rule the triggers
      keep, held to them by one file of cases. Rows read from the server
      are never put over a newer change made here (_fetchGradeReturns).
   6. Return is queued for the server (_sendReturns), a call for each
      student, under the cell's outbox key so it follows that cell's score
      writes; the outbox also holds it behind any queued write to the whole
      student or the whole piece of work (shared/offline-queue.js).
   7. A write of any of these that the server refuses leaves this device
      and the server apart: the class's settings and rows are read again,
      and that read is retried until it works (_convergeOnServer). The same
      after an ask of the server that fails or is not answered (a change
      that starts holding, the count of drafts): the server may have made
      the change and only the answer been lost.
   A signed-in class that holds grades has rows that are NOT LOADED until
   _loadGradeReturns has run for it this session, which is not the same as
   none: getReturnedScores throws, so no draft is ever counted as returned.
   The class move (_migrateCourseDataLocalToCanonical) replays saveScores
   and must not run the rule while it does (_movingClass). */
var _returnedSets = {}; // cid → { working, slot, set }: the returned set for one working copy and one set of rows
var _gradeReturnsLoadedFor = {}; // cid → true once _loadGradeReturns has run for the class
// cid → true once the class's rows have been read from the server in this session (or since its
// student page was turned on): a load that is not the first is redrawn by its own caller.
var _gradeReturnsReadThisSession = {};
var _gradeReturnsStale = {}; // cid → true when the rows must be read again whatever the class's version says
var _movingClass = false; // a class is being moved to its server id: its scores are replayed, not graded
var _serverStudentPage = {}; // cid → what the server last said of the class's switch (see _serverSaysStudentPage)
var START_HOLDING_WAIT_MS = 3000; // how long a change that needs the server waits for unsent writes to go first
var RETURN_SETTINGS_ASK_MS = 15000; // how long an ask of the server (a change that starts holding, the count) waits for its answer

/* Whether the server has said this class's student page is on. Kept apart
   from the class's settings object, which backups, Duplicate Class and any
   caller of saveCourseConfig can copy: the class's saved-copy record
   (gb-bundle-meta-<cid>) holds it, written only when the class's row comes
   from the server and when the server answers a change of the switch. */
function _serverSaysStudentPage(cid) {
  if (!cid) return false;
  if (_serverStudentPage[cid] === undefined) {
    _serverStudentPage[cid] = (_classMeta(cid) || {}).studentPage === true;
  }
  return _serverStudentPage[cid];
}
function _setServerStudentPage(cid, on) {
  if (!cid) return;
  _serverStudentPage[cid] = on === true;
  if ((_classMeta(cid) || {}).studentPage !== (on === true)) _saveClassMeta(cid, { studentPage: on === true });
  delete _returnedSets[cid];
}

/* The class's two settings, as the rule reads them: { student_page,
   return_grades }. return_grades is 'on_return' (When I Return Them),
   'on_save' (As Soon As I Save) or null for no choice made, which works as
   on_save. `saved` reads them from a copy of the class's settings in place
   of the ones in the cache. For a signed-in teacher the switch is on only
   when the server has said so as well. */
function getReturnSettings(cid, saved) {
  var cfg = saved || getCourseConfig(cid) || {};
  var choice = cfg.return_grades;
  return {
    student_page: cfg.student_page_enabled === true && (!_writesEnabled() || _serverSaysStudentPage(cid)),
    return_grades: choice === 'on_return' || choice === 'on_save' ? choice : null,
  };
}
// True when rows are kept for the class: the switch alone, nothing else read.
function _gradesKept(cid) {
  return (
    (getCourseConfig(cid) || {}).student_page_enabled === true && (!_writesEnabled() || _serverSaysStudentPage(cid))
  );
}
/* True when the class's rows are read from the server: a signed-in
   teacher's class, with its server id, whose student page is on. Every
   call this build adds for a class asks this first, so a class with the
   switch off is sent nothing new. */
function _serverKeepsRows(cid) {
  return _useSupabase && _writesEnabled() && _isUuid(cid) && _gradesKept(cid);
}
/* The rule failed. The save it followed is done; the failure goes to the
   error channel, never to the teacher (no banner, no toast). */
function _gradeStateFailed(doing, e) {
  console.error('Draft and Returned: ' + doing + ' failed.', e);
  try {
    if (window.Sentry && typeof window.Sentry.captureException === 'function') window.Sentry.captureException(e);
  } catch (ignored) {
    /* reporting is best effort */
  }
}

/* The build switch, from the console (Class Settings turns it with its
   hidden Student Page switch, teacher/cm-student-page.js):
     setStudentPageSwitch(getActiveCourse(), true)             on
     setStudentPageSwitch(getActiveCourse(), true, 'on_save')  on, As Soon As I Save
     setStudentPageSwitch(getActiveCourse(), false)            off again
   A class kept on this device (Demo Mode): done at once, and answers true.
   Turned on with no choice given it keeps its choice, or starts on When I
   Return Them. Turning it off returns every waiting draft.
   A signed-in teacher's class: answers saveReturnSettings' promise. Turned
   on, it keeps the choice the server holds for it, unless one is given. */
function setStudentPageSwitch(cid, on, returnGrades) {
  if (!cid) return false;
  var chosen = returnGrades === 'on_return' || returnGrades === 'on_save';
  if (_writesEnabled()) {
    var change = { student_page_enabled: !!on };
    if (on && chosen) change.return_grades = returnGrades;
    return saveReturnSettings(cid, change);
  }
  var cfg = Object.assign({}, getCourseConfig(cid));
  if (on) {
    cfg.student_page_enabled = true;
    if (chosen) cfg.return_grades = returnGrades;
    else if (cfg.return_grades !== 'on_save') cfg.return_grades = 'on_return';
  } else delete cfg.student_page_enabled;
  saveCourseConfig(cid, cfg);
  return true;
}

/* saveCourseConfig, for a signed-in teacher: the settings to save, with the
   two that are not this function's to change put back as the class holds
   them (the saved copy; a caller may have changed the cached object in
   place). A class the server does not have yet (one being made on this
   device) keeps the Return Grades choice it is handed, which goes up when
   the class does, and never the switch. Never throws. */
function _keepReturnSettings(cid, obj) {
  try {
    if (!obj || typeof obj !== 'object') return obj;
    var has = function (o, key) {
      return !!o && Object.prototype.hasOwnProperty.call(o, key);
    };
    var held = _safeParseLS('gb-courseconfig-' + cid, null);
    if (!_plainObject(held)) held = null;
    var out = Object.assign({}, obj);
    if (held && held.student_page_enabled === true && _serverSaysStudentPage(cid)) out.student_page_enabled = true;
    else delete out.student_page_enabled;
    if (held || _isUuid(cid)) {
      if (has(held, 'return_grades')) out.return_grades = held.return_grades;
      else delete out.return_grades;
    }
    // The caller's own object when it already says the same.
    var same =
      has(out, 'student_page_enabled') === has(obj, 'student_page_enabled') &&
      out.student_page_enabled === obj.student_page_enabled &&
      has(out, 'return_grades') === has(obj, 'return_grades') &&
      out.return_grades === obj.return_grades;
    return same ? obj : out;
  } catch (e) {
    _gradeStateFailed('keeping the class settings as they are', e);
    return obj;
  }
}

/* An update_course on its way out: when its patch carries the switch or
   Return Grades beside any other setting, the two are taken out. Only a
   patch of nothing but them is a change of them (saveReturnSettings). This
   is what stops a write queued by an earlier build, or by a caller this
   file does not know, from carrying a device's old copy of them. */
function _onlyOwnReturnSettings(name, params) {
  if (name !== 'update_course' || !params || !_plainObject(params.p_patch)) return params;
  var patch = params.p_patch;
  var theirs = 'student_page_enabled' in patch || 'return_grades' in patch;
  var others = Object.keys(patch).some(function (k) {
    return k !== 'student_page_enabled' && k !== 'return_grades';
  });
  if (!theirs || !others) return params;
  var clean = Object.assign({}, patch);
  delete clean.student_page_enabled;
  delete clean.return_grades;
  return Object.assign({}, params, { p_patch: clean });
}

// A promise that is already settled, with its answer on it as `now`.
function _settledNow(answer) {
  var p = Promise.resolve(answer);
  p.now = answer;
  return p;
}
// Resolves true once nothing waits to be sent, false if `ms` pass first.
async function _unsentWritesGone(ms) {
  var until = Date.now() + ms;
  var q = window.v2Queue;
  while (_hasUnsentWrites()) {
    if (Date.now() >= until) return false;
    try {
      if (q && typeof q.flush === 'function') await q.flush();
    } catch (e) {
      /* the wait below tries again */
    }
    if (!_hasUnsentWrites()) return true;
    await new Promise(function (resolve) {
      setTimeout(resolve, 100);
    });
  }
  return true;
}
function _isOffline() {
  return _supabaseDegraded || (typeof navigator !== 'undefined' && navigator.onLine === false);
}

/* The one writer of a class's switch and Return Grades choice. `change` is
   { student_page_enabled?: boolean, return_grades?: 'on_return' | 'on_save'
   | null }: only what the action changes. Answers a promise of { ok }, or
   { ok: false, error } when the change could not be made, in which case
   nothing on this device has changed. A change made at once carries its
   answer as `.now` too, so a screen can redraw without waiting.

   - A class kept on this device (Demo Mode): saved at once.
   - A signed-in teacher's class, a change that starts it holding grades
     (the switch turned on; When I Return Them chosen while it is on): the
     server is asked first, directly, after every write this device still
     has to send has gone. Offline, with writes that will not go, or
     refused: not made. Made: the device changes, and the class and its
     rows are read again.
   - Any other change (As Soon As I Save or no choice; the switch off): made
     here at once, the waiting drafts returned here, and queued for the
     server, which returns them itself.
   What is sent is the changed key or keys and nothing else: never this
   device's copy of the other one. */
function saveReturnSettings(cid, change) {
  change = change || {};
  var patch = {};
  if (change.student_page_enabled === true || change.student_page_enabled === false) {
    patch.student_page_enabled = change.student_page_enabled;
  }
  if (Object.prototype.hasOwnProperty.call(change, 'return_grades')) {
    patch.return_grades =
      change.return_grades === 'on_return' || change.return_grades === 'on_save' ? change.return_grades : null;
  }
  if (!cid || !Object.keys(patch).length) return _settledNow({ ok: false, error: { message: 'nothing to change' } });

  if (!_writesEnabled()) {
    var cfg = Object.assign({}, getCourseConfig(cid));
    if (patch.student_page_enabled === true) cfg.student_page_enabled = true;
    else if (patch.student_page_enabled === false) delete cfg.student_page_enabled;
    if ('return_grades' in patch) cfg.return_grades = patch.return_grades;
    saveCourseConfig(cid, cfg);
    return _settledNow({ ok: true });
  }

  // A class the server does not have yet cannot have its student page on,
  // and goes up with its Return Grades choice when it does.
  if (!_useSupabase || !_isUuid(cid)) {
    return _settledNow({ ok: false, error: { message: 'this class is not on the server yet' } });
  }
  var was = getReturnSettings(cid);
  var will = {
    student_page: 'student_page_enabled' in patch ? patch.student_page_enabled : was.student_page,
    return_grades: 'return_grades' in patch ? patch.return_grades : was.return_grades,
  };
  var turningOn = will.student_page && !was.student_page;
  if (turningOn || (GradeState.holds(will) && !GradeState.holds(was))) {
    // Not counted as a write still to send: it waits for those itself.
    return _startHolding(cid, patch, turningOn);
  }

  _applyReturnSettingsHere(cid, patch);
  _trackPendingSync(
    Promise.resolve(_writeRpc('update_course', { p_course_id: cid, p_patch: patch })).then(function (res) {
      if (res && res.error) {
        if (!res.error.handledSessionExpired) console.warn('update_course (Return Grades) failed:', res.error);
        // Refused, by the server or by an outbox with no room: this device
        // has stopped holding and the server has not. (The outbox's own
        // event says the same of a server's refusal, also after a reload.)
        _convergeOnServer(cid);
        return;
      }
      _refreshGradeReturnsSoon(cid);
    }),
  );
  return _settledNow({ ok: true });
}
async function _startHolding(cid, patch, turningOn) {
  var asked = false;
  try {
    if (_isOffline()) return { ok: false, error: { message: 'offline' } };
    // A grade saved before this must not reach the server after it.
    if (!(await _unsentWritesGone(START_HOLDING_WAIT_MS))) {
      return { ok: false, error: { message: 'changes are still waiting to be sent' } };
    }
    if (_isOffline()) return { ok: false, error: { message: 'offline' } };
    /* From here the server may make the change whatever this device hears
       back: an answer can be lost on the way, or never come. So:
       - realtime's word of the change is not this page's own echo (the
         change is not made here yet): it has the class read;
       - an answer that is an error, or does not come in time, is not taken
         as "nothing happened": the class is read again from the server,
         settings and rows, and that read is retried until it works
         (_convergeOnServer). The device ends where the server is. */
    asked = true;
    _echoNeedsReload = true;
    var res = await _withTimeout(
      _callRpcWithAuthGuard(
        'update_course',
        { p_course_id: cid, p_patch: patch },
        { suppressSessionExpiredModal: true },
      ),
      RETURN_SETTINGS_ASK_MS,
      'the change of the class’s setting',
    );
    if (!res || res.error) {
      _convergeOnServer(cid);
      return { ok: false, error: (res && res.error) || { message: 'no answer' } };
    }
    // getSupabase() gone or a Demo session answers with no error and no call.
    if (!_useSupabase || !_writesEnabled()) return { ok: false, error: { message: 'signed out' } };
    // The server holds the class's grades from here. So does this device.
    if (turningOn) _forgetGradeReturns(cid);
    _applyReturnSettingsHere(cid, patch);
    // The class again, whole: the server's own Return Grades choice (this
    // device's copy of it was not sent and may be old), then its rows.
    _gradeReturnsStale[cid] = true;
    if (turningOn) delete _classVersion[cid];
    _handleExternalCourseUpdate(cid, 'gradebook');
    return { ok: true };
  } catch (e) {
    _gradeStateFailed('asking the server to hold the class’s grades', e);
    if (asked) _convergeOnServer(cid);
    return { ok: false, error: e };
  }
}
/* The change, on this device: the settings saved, the server's word on the
   switch kept, and every waiting draft returned if the class stopped
   holding. Nothing is sent. */
function _applyReturnSettingsHere(cid, patch) {
  var held = _returnSettingsBefore(cid);
  var cfg = Object.assign({}, getCourseConfig(cid));
  if (patch.student_page_enabled === true) cfg.student_page_enabled = true;
  else if (patch.student_page_enabled === false) delete cfg.student_page_enabled;
  if ('return_grades' in patch) cfg.return_grades = patch.return_grades;
  if ('student_page_enabled' in patch) _setServerStudentPage(cid, patch.student_page_enabled);
  _saveCourseField('courseConfigs', cid, cfg);
  _returnSettingsSaved(cid, held);
}

/* How many grades in the class wait as drafts: the number the screens ask
   about before a class stops holding them. Answers a promise of { count },
   null when it cannot be known (then the change is not offered). A class
   kept on this device counts its own rows, at once (`.now`). A signed-in
   teacher's class asks the server (course_draft_count), which counts every
   draft it would return: this device's rows leave out a withdrawn
   student's and one under Missing or Excused, and know nothing at all of a
   class it has not loaded this session. Writes still to be sent go first,
   so a draft made a moment ago is counted. */
function draftsWaitingToReturn(cid) {
  if (!_writesEnabled()) {
    var holds = !!cid && GradeState.holds(getReturnSettings(cid));
    return _settledNow({ count: holds ? GradeState.draftsWaiting(cid) : 0 });
  }
  if (!cid || !_useSupabase || !_isUuid(cid) || _isOffline()) return _settledNow({ count: null });
  return (async function () {
    try {
      if (!(await _unsentWritesGone(START_HOLDING_WAIT_MS)) || _isOffline()) return { count: null };
      var res = await _withTimeout(
        _callRpcWithAuthGuard('course_draft_count', { p_course_id: cid }, { suppressSessionExpiredModal: true }),
        RETURN_SETTINGS_ASK_MS,
        'the count of drafts',
      );
      var n = res && !res.error && res.data != null ? Number(res.data) : NaN;
      if (isFinite(n) && n >= 0) return { count: Math.floor(n) };
      // Asked, and no number came back: something is wrong between this
      // device and the server. The class is read again, as after any failed
      // ask, so what the screen shows next is the server's.
      _convergeOnServer(cid);
      return { count: null };
    } catch (e) {
      _convergeOnServer(cid);
      return { count: null };
    }
  })();
}

/* A write of Draft and Returned state or of the two settings was refused
   (by the server, or by an outbox with no room): what this device shows
   and what the server holds may now differ. The class is read again whole,
   its settings and its rows, and the read is retried like any failed class
   load until it works. If the class is not in memory its saved copy is
   marked so that the next time it opens it is downloaded, not trusted. */
function _convergeOnServer(cid) {
  try {
    if (!cid || !_useSupabase || !_writesEnabled() || !_isUuid(cid)) return;
    _gradeReturnsStale[cid] = true;
    delete _classVersion[cid];
    _markSavedCopyDirty(cid);
    if (_classMeta(cid)) _saveClassMeta(cid, { dirty: true });
    if (_cache.students[cid] !== undefined) _handleExternalCourseUpdate(cid, 'gradebook');
  } catch (e) {
    _gradeStateFailed('reading the class again after a refused write', e);
  }
}
// The class an assessment in memory belongs to, or null.
function _classOfAssessment(aid) {
  var cids = Object.keys(_cache.assessments);
  for (var i = 0; i < cids.length; i++) {
    var list = _cache.assessments[cids[i]];
    if (
      Array.isArray(list) &&
      list.some(function (a) {
        return a && a.id === aid;
      })
    )
      return cids[i];
  }
  return null;
}
/* The outbox says the server refused a write (_onOutboxEvent). A refused
   Return puts the row back to the draft it was at once, then both kinds
   have the class read again. */
function _onReturnWriteRefused(endpoint, payload) {
  try {
    payload = payload || {};
    if (endpoint === 'return_grades' || endpoint === 'return_work') {
      var cid = _classOfAssessment(payload.p_assessment_id);
      if (!cid) return;
      var back = false;
      (payload.p_enrollment_ids || []).forEach(function (sid) {
        if (_unreturn(cid, payload.p_assessment_id, sid)) back = true;
      });
      if (back) _invalidateAndRerender();
      _convergeOnServer(cid);
    } else if (endpoint === 'update_course') {
      var patch = payload.p_patch || {};
      if ('student_page_enabled' in patch || 'return_grades' in patch) _convergeOnServer(payload.p_course_id);
    }
  } catch (e) {
    _gradeStateFailed('putting right a refused write', e);
  }
}

/* saveCourseConfig, before it saves: how the class returned grades, from
   the saved copy (a caller may have changed the cached settings in place).
   null unless it held them. Never throws. */
function _returnSettingsBefore(cid) {
  try {
    var was = getReturnSettings(cid, _safeParseLS('gb-courseconfig-' + cid, null));
    return was.student_page && was.return_grades === 'on_return' ? was : null;
  } catch (e) {
    _gradeStateFailed('reading the class settings', e);
    return null;
  }
}
/* saveCourseConfig, once the settings are saved and sent. A class that
   stops holding grades (As Soon As I Save is chosen, or the student page
   is turned off) returns every waiting draft as part of the change. */
function _returnSettingsSaved(cid, was) {
  if (!was) return;
  try {
    var rows = getGradeReturns(cid);
    var cells = _gradeCells(getScores(cid), getRubricChecks(cid));
    var out = GradeState.afterSettingChange(
      was,
      getReturnSettings(cid),
      rows,
      function (sid, aid) {
        var a = _assessmentById(cid, aid);
        var cell = (cells[aid] || {})[sid];
        return a && cell ? _gradeOf(a, cell.entries, cell.checks) : null;
      },
      new Date().toISOString(),
    );
    // On the server the same returns are made by a trigger, in the
    // update_course that carries the setting: no return is sent.
    if (out !== rows) _saveGradeReturns(cid, out);
  } catch (e) {
    _gradeStateFailed('returning the waiting drafts', e);
  }
}

/* A class's rows. A class with none saved has none: nothing is put in the
   cache or in localStorage for it. */
function getGradeReturns(cid) {
  if (_cache.gradeReturns[cid] !== undefined) return _cache.gradeReturns[cid];
  var stored = _safeParseLS('gb-grade-returns-' + cid, null);
  if (!_plainObject(stored)) return {};
  _cache.gradeReturns[cid] = stored;
  return stored;
}
// One student's row on one assessment, or null.
function getGradeReturn(cid, sid, aid) {
  return (getGradeReturns(cid)[aid] || {})[sid] || null;
}
function _saveGradeReturns(cid, rows) {
  _saveCourseField('gradeReturns', cid, rows);
  // Returned-only numbers follow the rows.
  if (typeof clearProfCache === 'function') clearProfCache();
  // Revisions (S11, Demo Mode): a Return closes a request, or ends a hide, for good.
  _revisionsAfterRowSave(cid);
}
/* A signed-in class's rows, as loaded from the server
   (_fetchGradeReturns). The only way they get in: it marks the class
   loaded, drops the returned set built from the rows before, and has
   returned-only numbers worked out again. */
function _loadGradeReturns(cid, rows) {
  _cache.gradeReturns[cid] = _plainObject(rows) ? rows : {};
  _gradeReturnsLoadedFor[cid] = true;
  _safeLSSet('gb-grade-returns-' + cid, JSON.stringify(_cache.gradeReturns[cid]));
  delete _returnedSets[cid];
  if (typeof clearProfCache === 'function') clearProfCache();
}
/* A signed-in class's student page was just turned on: the rows this
   device kept from an earlier time it was on are dropped, and the class's
   rows are not loaded until the server's have been read. */
function _forgetGradeReturns(cid) {
  delete _gradeReturnsReadThisSession[cid];
  delete _gradeReturnsLoadedFor[cid];
  delete _returnedSets[cid];
  _cache.gradeReturns[cid] = {};
  try {
    localStorage.removeItem('gb-grade-returns-' + cid);
  } catch (e) {
    /* nothing kept is nothing to remove */
  }
  if (typeof clearProfCache === 'function') clearProfCache();
}

/* ── The server's rows (S0-W1) ─────────────────────────────────────────── */

/* The server's list as this device keeps rows: each row with its nulls left
   out and its fields in the order the rule writes them, each kept copy in
   its one written form (the server leaves a copy's null fields out too;
   GradeState.copyOf puts them back). */
function _serverGradeRows(list) {
  var out = {};
  Object.keys(_plainObject(list) ? list : {}).forEach(function (aid) {
    var of = {};
    Object.keys(_plainObject(list[aid]) ? list[aid] : {}).forEach(function (sid) {
      var r = list[aid][sid];
      if (!_plainObject(r)) return;
      var row = { is_draft: r.is_draft === true };
      if (r.returned_at != null) row.returned_at = r.returned_at;
      ['returned_copy', 'previous_copy'].forEach(function (f) {
        var copy = GradeState.copyOf(r[f]);
        if (copy) row[f] = copy;
      });
      if (r.updated_at != null) row.updated_at = r.updated_at;
      if (r.seen_at != null) row.seen_at = r.seen_at;
      of[sid] = row;
    });
    if (Object.keys(of).length) out[aid] = of;
  });
  return out;
}
/* What a teacher's screen can show of a class's rows, as one string: the
   same for two sets that would draw the same, whatever order their work,
   students and fields are in. The times are days, since a Return made here
   is timed by this device's clock and the server's own time for it is a
   moment later. When a student opened a piece is on no teacher's screen. */
function _gradeRowsLook(rows) {
  var day = function (iso) {
    return iso ? _localDayOf(iso) : null;
  };
  var copy = function (c) {
    return c ? JSON.stringify(GradeState.copyOf(c)) : null;
  };
  rows = rows || {};
  return JSON.stringify(
    Object.keys(rows)
      .sort()
      .map(function (aid) {
        var of = rows[aid] || {};
        return [
          aid,
          Object.keys(of)
            .sort()
            .map(function (sid) {
              var r = of[sid] || {};
              return [
                sid,
                !!r.is_draft,
                day(r.returned_at),
                copy(r.returned_copy),
                copy(r.previous_copy),
                day(r.updated_at),
              ];
            }),
        ];
      }),
  );
}
// How many changes this device has made to what a class's rows follow.
function _gradeWritesSeen(cid) {
  return ['scores', 'rubricChecks', 'gradeReturns', 'courseConfigs', 'assessments']
    .map(function (field) {
      return _localWriteCount(cid, field);
    })
    .join(':');
}
/* Read a class's rows from the server and keep them. Answers { error }
   when the read failed, { skipped: true } when this device changed a grade,
   a setting or a piece of work while it was out, or still has a change to
   send (the rows read are from before it: they are left out, and the caller
   reads again), else { changed } saying whether a screen would look
   different. Only ever called for a class the server keeps rows for. */
async function _fetchGradeReturns(cid) {
  var seen = _gradeWritesSeen(cid);
  var res;
  try {
    res = await _callRpcWithAuthGuard(
      'list_course_grade_returns',
      { p_course_id: cid },
      { suppressSessionExpiredModal: true },
    );
  } catch (e) {
    res = { error: e };
  }
  if (!res || res.error) return { error: (res && res.error) || { message: 'no answer' } };
  // The server always answers with an object, an empty one for no rows.
  var list = _rpcObject(res.data);
  if (!list) return { error: { message: 'list_course_grade_returns sent no rows' } };
  if (!_serverKeepsRows(cid)) return { skipped: true };
  if (_gradeWritesSeen(cid) !== seen || _hasUnsentWrites()) return { skipped: true };
  var was = _gradeRowsLook(getGradeReturns(cid));
  var wasLoaded = _gradeReturnsLoadedFor[cid] === true;
  _loadGradeReturns(cid, _serverGradeRows(list));
  delete _gradeReturnsStale[cid];
  var first = !_gradeReturnsReadThisSession[cid];
  _gradeReturnsReadThisSession[cid] = true;
  return { changed: !wasLoaded || was !== _gradeRowsLook(getGradeReturns(cid)), first: first };
}
/* The class has just been read from the server (_doInitData): read its
   rows too. `fresh` is false when the server answered that the class has
   not changed: its rows are then read only if this session has not read
   them yet. A failed read is a failed load: the saved copy stays, the sync
   dot says so and the load is tried again; it answers false then. Rows
   left out because of a change made here have the refresh run again
   (_refreshMustSkip's way). */
async function _loadServerGradeReturns(cid, fresh) {
  if (!_serverKeepsRows(cid)) return;
  _loadServerStudentWork(cid, fresh);
  _loadServerFeedback(cid);
  if (!fresh && _gradeReturnsLoadedFor[cid] === true && !_gradeReturnsStale[cid]) return;
  var got = await _fetchGradeReturns(cid);
  if (got.error) {
    _courseLoadFailed(cid, got.error);
    return false;
  }
  var st = _refreshState[cid];
  if (got.skipped) {
    if (st && st.snapshot) st.skipped = true;
    else _refreshGradeReturnsSoon(cid);
  } else if (got.changed && (!fresh || got.first)) {
    // An unchanged class is not redrawn by the load; its rows just changed.
    // And the first time a class's rows are in this session, every page
    // that waited for them (ReportScores.ready) is drawn.
    _invalidateAndRerender();
  }
}
/* This device changed a grade, returned one or changed how the class
   returns them. Once those writes have landed and the teacher has paused
   (_waitForQuietCourse), the rows are read again, so what this device
   worked out by the rule gives way to what the server holds: its times, a
   grade marked Updated because the student had opened it, and anything
   another writer did. One read for a burst of grading, however long. A
   read that fails is a class load that failed: the rows are marked to be
   read again, the sync dot says the class could not be loaded, and the
   load is retried until it works (_courseLoadFailed). */
var _gradeReturnsRefresh = {}; // cid → { again, running }
function _refreshGradeReturnsSoon(cid) {
  if (!_serverKeepsRows(cid)) return Promise.resolve();
  var st = _gradeReturnsRefresh[cid] || (_gradeReturnsRefresh[cid] = {});
  st.again = true;
  if (!st.running) {
    st.running = (async function () {
      try {
        while (st.again) {
          await _waitForQuietCourse(cid);
          // Everything asked for up to here is answered by this one read.
          st.again = false;
          if (!_serverKeepsRows(cid)) return;
          var got = await _fetchGradeReturns(cid);
          if (got.error) {
            _gradeReturnsStale[cid] = true;
            _courseLoadFailed(cid, got.error);
          } else if (got.skipped && _serverKeepsRows(cid)) st.again = true;
          else if (got.changed) _invalidateAndRerender();
        }
      } catch (e) {
        _gradeStateFailed('reading which grades are returned', e);
      } finally {
        st.running = null;
      }
    })();
  }
  return st.running;
}
/* The class's scores were just replaced by a load from the server (a
   refresh, or a full download after a saved copy was refused as an older
   shape). The rows this device holds are from before that load, so they
   are not "loaded" again until _loadGradeReturns runs for it: a class that
   holds grades fails closed in between rather than read old rows against
   new scores. The rows themselves are left where they are. A class kept on
   this device only is never loaded from a server, and keeps its rows. */
function _gradeScoresLoaded(cid) {
  delete _gradeReturnsLoadedFor[cid];
  delete _returnedSets[cid];
}
/* True when the class's rows are known. A class kept on this device only
   (Demo Mode) keeps them in localStorage, which is always there to read:
   no key means no rows. A signed-in class's rows are known only once
   _loadGradeReturns has run for it: a row saved or read on this device
   before that says nothing about the drafts it has not heard of. */
function _gradeReturnsLoaded(cid) {
  return !_writesEnabled() || _gradeReturnsLoadedFor[cid] === true;
}

/* One student's grade on one assessment, from their score entries and
   ticks, in the parts of a copy (GradeState.copyOf tidies it). Points and
   Complete/Incomplete work keeps one score however many entries carry it. */
function _gradeOf(a, entries, checks) {
  var grade = { value: null, modifier: 0, comment: null, tags: {}, criteria: {}, checks: checks || [] };
  var points = isPointsScored(a);
  var onRubric = !points && !!(a.rubricId || a.rubric_id);
  (entries || []).forEach(function (e) {
    if (e.note && !grade.comment) grade.comment = String(e.note);
    var level = Number(e.score) > 0 ? Number(e.score) : null;
    var part = { value: level, modifier: level ? e.mod || 0 : 0, comment: e.critNote || null };
    if (points) {
      if (grade.value == null && e.score != null && e.score !== '') grade.value = Number(e.score);
    } else if (isUnlinkedTag(e.tagId)) {
      grade.value = part.value;
      grade.modifier = part.modifier;
    } else if (onRubric) {
      part.beyond = e.critBeyond || null;
      grade.criteria[e.tagId] = part;
    } else grade.tags[e.tagId] = part;
  });
  return grade;
}

// Every cell of a class: { aid: { sid: { entries, checks } } }.
function _gradeCells(scores, checks) {
  var cells = {};
  var cell = function (aid, sid) {
    var of = cells[aid] || (cells[aid] = {});
    return of[sid] || (of[sid] = { entries: [], checks: [] });
  };
  Object.keys(scores || {}).forEach(function (sid) {
    (Array.isArray(scores[sid]) ? scores[sid] : []).forEach(function (e) {
      if (e && e.assessmentId) cell(e.assessmentId, sid).entries.push(e);
    });
  });
  Object.keys(checks || {}).forEach(function (key) {
    var i = key.indexOf(':');
    if (i > 0 && Array.isArray(checks[key])) cell(key.slice(i + 1), key.slice(0, i)).checks = checks[key];
  });
  return cells;
}

/* A score writer, before it saves the class's scores or ticks (`field`):
   the grades as they were, from the saved copy. null when no rows are kept
   for the class, which is all the switch-off path does. Never throws. */
function _gradeBefore(cid, field) {
  try {
    if (!_gradesKept(cid) || _movingClass) return null;
    return field === 'scores'
      ? { scores: _migrateRubricScoreKeys(cid, _safeParseLS('gb-scores-' + cid, {})) }
      : { checks: _safeParseLS('gb-rubric-checks-' + cid, {}) };
  } catch (e) {
    _gradeStateFailed('reading the grades before a save', e);
    return null;
  }
}
/* The same writer, once its save is done: `was` is what _gradeBefore gave,
   `next` the scores or ticks just saved. Never throws. */
function _gradeAfter(cid, was, next) {
  delete _returnedSets[cid];
  if (!was) return;
  try {
    _gradeRule(cid, was, next || {});
  } catch (e) {
    _gradeStateFailed('keeping which grades are returned', e);
  }
}
function _gradeRule(cid, was, next) {
  var klass = getReturnSettings(cid);
  var scores = was.scores ? next : getScores(cid);
  var checks = was.checks ? next : getRubricChecks(cid);
  var now = _gradeCells(scores, checks);
  var before = _gradeCells(was.scores || scores, was.checks || checks);
  var rows = getGradeReturns(cid);
  var out = Object.assign({}, rows);
  var at = new Date().toISOString();
  var changed = false;
  Object.keys(Object.assign({}, before, now)).forEach(function (aid) {
    var a = _assessmentById(cid, aid);
    // A DIBELS benchmark is a reading record, not a grade that is returned:
    // nothing saved on it, its Overall Comment included, makes or changes a row.
    if (!a || isDibelsScored(a)) return;
    Object.keys(Object.assign({}, before[aid], now[aid])).forEach(function (sid) {
      var b = (before[aid] || {})[sid];
      var n = (now[aid] || {})[sid];
      var copyWas = b ? _gradeOf(a, b.entries, b.checks) : null;
      var copyNow = n ? _gradeOf(a, n.entries, n.checks) : null;
      if (GradeState.sameCopy(copyWas, copyNow)) return;
      var kept = GradeState.afterWrite(klass, (out[aid] || {})[sid] || null, copyWas, copyNow, at);
      out[aid] = Object.assign({}, out[aid]);
      if (kept) out[aid][sid] = kept;
      else delete out[aid][sid];
      if (!Object.keys(out[aid]).length) delete out[aid];
      changed = true;
    });
  });
  if (changed) {
    _saveGradeReturns(cid, out);
    // The server's triggers keep the same rows as the writes land; read them then.
    _refreshGradeReturnsSoon(cid);
  }
}
/* Return: `studentIds` (one id or a list) are given their grade on `aid`.
   Only drafts are returned; the rest are skipped. A class that does not
   hold grades has none to return. Answers as the server's return will:
   { returned, enrollment_ids, returned_at }. If the rule fails, the failure
   is reported and the answer is that nothing was returned. `withMarks`
   (returnWork's, for a signed-in class) sends each student's Return as
   return_work, which gives the marks on their pages too, in place of
   return_grades. */
function returnGrades(cid, aid, studentIds, withMarks) {
  var nothing = { returned: 0, enrollment_ids: [], returned_at: null };
  try {
    return _returnGrades(cid, aid, studentIds, withMarks === true) || nothing;
  } catch (e) {
    // Like the other hooks: reported, never thrown at a screen. Nothing was returned.
    _gradeStateFailed('returning grades', e);
    return nothing;
  }
}
function _returnGrades(cid, aid, studentIds, withMarks) {
  var ids = Array.isArray(studentIds) ? studentIds : studentIds ? [studentIds] : [];
  var done = [];
  var at = new Date().toISOString();
  var a = _assessmentById(cid, aid);
  var klass = getReturnSettings(cid);
  if (a && !isDibelsScored(a) && klass.student_page && GradeState.holds(klass)) {
    var rows = getGradeReturns(cid);
    var of = Object.assign({}, rows[aid]);
    var cells = _gradeCells(getScores(cid), getRubricChecks(cid))[aid] || {};
    ids.forEach(function (sid) {
      var row = of[sid];
      if (!row || !row.is_draft || done.indexOf(sid) >= 0) return;
      var kept = GradeState.afterReturn(
        row,
        cells[sid] ? _gradeOf(a, cells[sid].entries, cells[sid].checks) : null,
        at,
      );
      if (kept) of[sid] = kept;
      else delete of[sid];
      done.push(sid);
    });
    if (done.length) {
      var out = Object.assign({}, rows);
      if (Object.keys(of).length) out[aid] = of;
      else delete out[aid];
      _saveGradeReturns(cid, out);
      _sendReturns(cid, aid, done, rows[aid] || {}, of, withMarks);
    }
  }
  return { returned: done.length, enrollment_ids: done, returned_at: done.length ? at : null };
}
/* A signed-in teacher's Return, sent to the server: return_grades, one
   call for each student returned on this device. One student to a call so
   the outbox files it under that cell (cell:<student>:<assessment>,
   shared/offline-queue.js): it goes after the score writes already queued
   for the cell, a later save to the cell goes after it, and it is never
   merged away with one. Each call carries its own idempotency key, so a
   retry returns nothing twice. An id made on this device waits in the
   outbox for its server id, as any write does; one the server will never
   know is not sent.
   The device has already returned them (`now` holds each row as it is now,
   `was` as it was). Nothing waits on the answer: a call the outbox has no
   room for puts the row back, and one the server refuses is put right by
   the next read of the rows. Either shows on the sync dot only. */
function _sendReturns(cid, aid, sids, was, now, withMarks) {
  if (!_writesEnabled() || !_isSendableId(aid)) return;
  var endpoint = withMarks ? 'return_work' : 'return_grades'; // named in the calls below, as the drift check reads them
  sids.forEach(function (sid) {
    if (!_isSendableId(sid)) return;
    if (was[sid]) _returnedHere[cid + ':' + aid + ':' + sid] = { was: was[sid], now: now[sid] || null };
    var body = { p_assessment_id: aid, p_enrollment_ids: [sid], p_idempotency_key: _newEntryId() };
    var sent = withMarks ? _writeRpc('return_work', body) : _writeRpc('return_grades', body);
    // No room in the outbox: nothing was sent, so the grade is still a draft.
    if (sent && sent.refused) {
      _unreturn(cid, aid, sid);
      _convergeOnServer(cid);
    }
    _trackPendingSync(
      Promise.resolve(sent).then(function (res) {
        if (res && res.error && !res.error.refused && !res.error.handledSessionExpired) {
          console.warn(endpoint + ' failed:', res.error);
        }
        // A refusal by the server is put right from the outbox's own event
        // (_onReturnWriteRefused), which also runs after a reload.
        if (!(res && res.error)) delete _returnedHere[cid + ':' + aid + ':' + sid];
        _refreshGradeReturnsSoon(cid);
      }),
    );
  });
}
/* Each Return this device has made and not yet heard back about: the row as
   it was (a draft) and as the Return left it. In memory only: after a
   reload the class's rows are read from the server, which is the truth. */
var _returnedHere = {}; // 'cid:aid:sid' → { was, now }
/* A Return was not made (the outbox had no room, or the server refused
   it): the row goes back to the draft it was, unless something has changed
   it since. With no record of the Return (a reload came between) the row is
   left for the read of the server's rows to put right. */
function _unreturn(cid, aid, sid) {
  try {
    var key = cid + ':' + aid + ':' + sid;
    var made = _returnedHere[key];
    delete _returnedHere[key];
    if (!made) return;
    var rows = getGradeReturns(cid);
    var at = (rows[aid] || {})[sid] || null;
    if (JSON.stringify(at) !== JSON.stringify(made.now)) return;
    var out = Object.assign({}, rows);
    out[aid] = Object.assign({}, out[aid]);
    out[aid][sid] = made.was;
    _saveGradeReturns(cid, out);
    return true;
  } catch (e) {
    _gradeStateFailed('putting back a grade that could not be returned', e);
  }
}

/* A returned copy as the score entries this class would hold for it: read
   the way a grade loaded from the server is, then fitted to the student's
   working entries (`own`): an entry the change did not touch is the
   working entry itself; a changed one is the working entry with the
   returned level, + or − and comments, so it keeps its date. Points work
   keeps one score; a class carries it once per competency (a score typed
   on this device) or once (a loaded class), and the returned grade is
   carried the way the class's other entries are.
   The copy is read whole, as the working copy is: calc.js applies what a
   piece measures now the same way in both sets. */
function _gradeCopyEntries(cid, sid, aid, copy, own, working) {
  var a = _assessmentById(cid, aid);
  if (!a || !copy) return [];
  var cells = {};
  cells[sid] = {};
  cells[sid][aid] = {
    score: { value: copy.value, modifier: copy.modifier, comment: copy.comment },
    tag_scores: Object.keys(copy.tags || {}).map(function (id) {
      return Object.assign({ tag_id: id }, copy.tags[id]);
    }),
    rubric_scores: Object.keys(copy.criteria || {}).map(function (id) {
      return Object.assign({ criterion_id: id }, copy.criteria[id]);
    }),
  };
  var built = _gradebookCellsToScoreCache(cid, getAssessments(cid), cells).scores[sid] || [];
  own = own || [];
  var keys = own.map(function (e) {
    return e.tagId;
  });
  if (isPointsScored(a) && built.length === 1) {
    var carried = _pointsScoreKeys(a, keys, working, built[0].tagId);
    built = carried.map(function (tid) {
      return Object.assign({}, built[0], { tagId: tid, id: aid + ':' + (tid || 'overall') });
    });
  }
  var comment = (
    own.find(function (e) {
      return e.note;
    }) || {}
  ).note;
  var sameComment = (comment || '') === (copy.comment || '');
  // In the working entries' order, so a changed grade reads back entry for entry.
  var at = function (e) {
    var i = keys.indexOf(e.tagId);
    return i < 0 ? keys.length : i;
  };
  built = built.slice().sort(function (x, y) {
    return at(x) - at(y);
  });
  return built.map(function (e) {
    var mine = own[keys.indexOf(e.tagId)];
    if (!mine) return e;
    var same =
      sameComment &&
      (mine.score == null || mine.score === '' ? null : Number(mine.score)) === e.score &&
      (mine.mod || 0) === (e.mod || 0) &&
      (mine.critNote || '') === (e.critNote || '') &&
      (mine.critBeyond || '') === (e.critBeyond || '');
    if (same) return mine;
    var out = Object.assign({}, mine, { score: e.score });
    if (!sameComment) out.note = e.note;
    ['mod', 'critNote', 'critBeyond'].forEach(function (f) {
      if (e[f]) out[f] = e[f];
      else delete out[f];
    });
    return out;
  });
}
/* The keys a points score is carried under for this class: the student's
   own working entries', else another student's on the same work, else
   every competency for a class kept on this device (as _setPointsScoreOne
   writes it) and the one key a loaded class has. */
function _pointsScoreKeys(a, own, working, loadedKey) {
  var distinct = function (ids) {
    return ids.filter(function (id, i) {
      return ids.indexOf(id) === i;
    });
  };
  if (own.length) return distinct(own);
  var sids = Object.keys(working || {});
  for (var i = 0; i < sids.length; i++) {
    var theirs = (Array.isArray(working[sids[i]]) ? working[sids[i]] : [])
      .filter(function (e) {
        return e && e.assessmentId === a.id;
      })
      .map(function (e) {
        return e.tagId;
      });
    if (theirs.length) return distinct(theirs);
  }
  var all = scoreTagIds(a);
  return !_writesEnabled() && all.length ? all : [loadedKey];
}

/* The class's scores as students have been given them, in the shape of
   getScores: the working entries where nothing is a draft, the returned
   grade where a draft sits on a returned grade, nothing where a grade was
   never returned (GradeState.returnedScores). That is all it decides:
   calc.js reads both sets by one set of rules (what a piece measures now,
   Missing and Excused, same-date order), and statuses are not here.
   A class that does not hold grades (the student page off, or As Soon As I
   Save) has no draft by rule: this is getScores' own object. So it is in a
   class that holds grades with no draft waiting. A class that holds grades
   whose rows are not loaded throws: "not loaded" must never read as "every
   grade returned" (calc.js then works out no grade).
   Always a plain object with a list for every student in it, an empty one
   when nothing of theirs is returned: calc.js takes nothing else, and
   fails closed for the whole class on anything else.
   Built once for each working copy and each set of rows; any save of the
   class's data has it built again. Checklist ticks are not in it
   (getScores holds none); the returned ticks are kept in each row's
   returned_copy for a reader to come (S2).
   It is set on window, not declared: calc.js looks for it by name and
   fails closed when it is not there, and its tests take it away (and put
   their own in its place) to prove that. A declared function could be
   neither removed nor told from one that never loaded. */
/* The code on the error getReturnedScores throws when a class that holds
   grades has not loaded its Draft and Returned rows: the one refusal a page
   waits out (ReportScores.ready). Any other error is a fault. */
var RETURNED_NOT_LOADED = 'RETURNED_NOT_LOADED';
window.getReturnedScores = function getReturnedScores(cid) {
  // Revisions (S11): inside getRevisionFirstCell only, one student's piece
  // is read as its first version's grade. Never kept; every other call is
  // as below.
  var first = _firstVersionScope;
  if (first && first.cid === cid) {
    _firstVersionScope = null;
    var base;
    try {
      base = getReturnedScores(cid);
    } finally {
      _firstVersionScope = first;
    }
    var scoped = Object.assign({}, base);
    scoped[first.sid] = (base[first.sid] || [])
      .filter(function (e) {
        return !(e && e.assessmentId === first.aid);
      })
      .concat(first.entries);
    return scoped;
  }
  var working = getScores(cid) || {};
  var kept = _returnedSets[cid];
  if (kept && kept.working === working && kept.slot === _cache.gradeReturns[cid]) return kept.set;
  var set = working;
  var klass = getReturnSettings(cid);
  if (klass.student_page && GradeState.holds(klass)) {
    if (!_gradeReturnsLoaded(cid)) {
      // Marked (code RETURNED_NOT_LOADED) so a page can tell this refusal from a fault: ReportScores.ready.
      var notLoaded = new Error(
        'This class holds grades until they are returned, and which of its grades are returned has not loaded. ' +
          'No returned grade was worked out, so no draft is shown.',
      );
      notLoaded.code = RETURNED_NOT_LOADED;
      throw notLoaded;
    }
    // A DIBELS benchmark has no returned grade: any row for one is passed
    // over, so its entries are the working copy's.
    var rows = {};
    var every = getGradeReturns(cid);
    Object.keys(every).forEach(function (aid) {
      if (!isDibelsScored(_assessmentById(cid, aid))) rows[aid] = every[aid];
    });
    var anyDraft = Object.keys(rows).some(function (aid) {
      return Object.keys(rows[aid] || {}).some(function (sid) {
        return rows[aid][sid] && rows[aid][sid].is_draft;
      });
    });
    if (anyDraft) {
      set = GradeState.returnedScores(working, rows, function (sid, aid, copy, own) {
        return _gradeCopyEntries(cid, sid, aid, copy, own, working);
      });
    }
  }
  // A working copy that is not a plain object of lists (a damaged saved
  // copy) is given as one: a student with no list has no grades.
  var plain = _plainObject(set) && Object.getPrototypeOf(set) === Object.prototype;
  var lists =
    plain &&
    Object.keys(set).every(function (sid) {
      return Array.isArray(set[sid]);
    });
  if (!lists) {
    var tidy = {};
    Object.keys(_plainObject(set) ? set : {}).forEach(function (sid) {
      tidy[sid] = Array.isArray(set[sid]) ? set[sid] : [];
    });
    set = tidy;
  }
  _returnedSets[cid] = { working: working, slot: _cache.gradeReturns[cid], set: set };
  return set;
};

/* The Advanced Rubric ticks one student has been given on one piece: the
   returned set's ticks, which getReturnedScores leaves out (getScores holds
   none). The rule is GradeState.returnedCheckIds. A class that holds
   grades whose rows have not loaded throws, as getReturnedScores does; a
   DIBELS benchmark has no ticks to hold, so it gives the working ones; in
   any other class this is getRubricCheckIds. Set on window for the same
   reason as getReturnedScores. (S2-F1) */
window.getReturnedRubricCheckIds = function getReturnedRubricCheckIds(cid, sid, aid) {
  getReturnedScores(cid);
  var working = getRubricCheckIds(cid, sid, aid);
  if (isDibelsScored(_assessmentById(cid, aid))) return working;
  var klass = getReturnSettings(cid);
  var holds = klass.student_page && GradeState.holds(klass);
  return GradeState.returnedCheckIds(holds ? getGradeReturn(cid, sid, aid) : null, working, holds);
};

/* A local id became a server id (_rekey): the rows move with it, whether it
   named an assessment, a student, or a competency, criterion or checkbox
   inside a kept copy. */
function _rekeyGradeReturns(cid, localId, serverId) {
  delete _returnedSets[cid];
  var map = {};
  map[localId] = serverId;
  _rekeyField('gradeReturns', cid, function (rows) {
    var changed = _rekeyObjectKey(rows, localId, serverId);
    Object.keys(rows || {}).forEach(function (aid) {
      if (_rekeyObjectKey(rows[aid], localId, serverId)) changed = true;
      Object.keys(rows[aid] || {}).forEach(function (sid) {
        var moved = GradeState.afterMove(rows[aid][sid], map, map, map);
        if (moved === rows[aid][sid]) return;
        rows[aid][sid] = moved;
        changed = true;
      });
    });
    return changed;
  });
}
/* moveRubricScores: an assessment's scores followed it to a copy of its
   rubric. Each grade keeps its state; the criteria and checkboxes inside
   its kept copies take their new ids (GradeState.afterMove). */
function _repointGradeReturns(cid, aid, criteria, checks) {
  delete _returnedSets[cid];
  if (!getGradeReturns(cid)[aid]) return;
  var rows = Object.assign({}, getGradeReturns(cid));
  var of = (rows[aid] = Object.assign({}, rows[aid]));
  var changed = false;
  Object.keys(of).forEach(function (sid) {
    var moved = GradeState.afterMove(of[sid], criteria, checks);
    if (moved === of[sid]) return;
    of[sid] = moved;
    changed = true;
  });
  if (changed) _saveGradeReturns(cid, rows);
}

// Assessments were deleted: their rows go with their scores.
function _dropGradeReturnsNotIn(cid, validIds) {
  var rows = getGradeReturns(cid);
  var gone = Object.keys(rows).filter(function (aid) {
    return !validIds.has(aid);
  });
  if (!gone.length) return;
  var out = Object.assign({}, rows);
  gone.forEach(function (aid) {
    delete out[aid];
  });
  _saveGradeReturns(cid, out);
}
// A withdrawn student was deleted for good: their rows go too.
function _dropGradeReturnsOf(cid, sid) {
  var rows = getGradeReturns(cid);
  var out = null;
  Object.keys(rows).forEach(function (aid) {
    if (!rows[aid] || rows[aid][sid] === undefined) return;
    out = out || Object.assign({}, rows);
    out[aid] = Object.assign({}, rows[aid]);
    delete out[aid][sid];
    if (!Object.keys(out[aid]).length) delete out[aid];
  });
  if (out) _saveGradeReturns(cid, out);
}
/* ── end Draft and Returned (S0-F2) ── */

/* ── Student cards (S0-W1, S3-W1; docs/plans/student-page-build-plan.md 1.5) ──
   One card for each student in a class: a printed code that opens the
   student's page. The database cannot read a card's code (DECISIONS,
   ruling 63): it keeps a keyed fingerprint of it, and the code exists only
   in the one reply that made the card.

   A card, as this file hands it out and as it is ever kept:
     { id, enrollment_id, seq, created_at, printed_at, last_opened_at,
       locked_at, wrong_tries, wrong_tries_7d, works_until, check,
       has_password, needs_new }
   Never a code and never a password. `seq` is the card number (Card 2);
   the server's list before the S3-M1 migration has none, and still
   carries the old readable code and password: both are dropped here, as
   they arrive, and so is a code an older build saved in Demo Mode.

   Making cards (makeStudentCards) asks the teacher-cards edge function,
   online, with the teacher's own sign-in, and never through the outbox. Its
   reply's codes and passwords are handed to the caller and go nowhere
   else: not localStorage, sessionStorage, IndexedDB, the outbox, a log or
   any cache. teacher/student-cards.js prints them and holds them for Print
   Again only.

   Only a class whose student page is on has cards (the build switch): for
   any other class each function here answers with no data and calls
   nothing. Each answers a promise of { data, error }. In Demo Mode the
   cards are made and kept on this device (gb-student-cards-<cid>), by the
   same rules, and nothing is sent. */
var _CARD_CODE_LETTERS = 'ABCDEFGHJKMNPQRTUVWXYZ2346789'; // the slip alphabet (teacher/questionnaires.js)
var _CARD_FIELDS = [
  'id',
  'enrollment_id',
  'seq',
  'created_at',
  'printed_at',
  'last_opened_at',
  'locked_at',
  'wrong_tries',
  'wrong_tries_7d',
  'works_until',
  'check',
  'has_password',
  'needs_new',
];

function _cardsAnswer(data, error) {
  return Promise.resolve({ data: data == null ? null : data, error: error || null });
}
/* A card with only the fields above: whatever else a reply or an older
   build's copy carries (a code, a password) is left behind. */
function _cardWithoutCode(c) {
  var out = {};
  if (!c || typeof c !== 'object') return null;
  _CARD_FIELDS.forEach(function (k) {
    if (c[k] !== undefined) out[k] = c[k];
  });
  if (out.seq != null && !(Number(out.seq) > 0)) delete out.seq;
  return out;
}
function _demoStudentCards(cid) {
  var kept = _safeParseLS('gb-student-cards-' + cid, []);
  if (!Array.isArray(kept)) return [];
  // A card an older build saved still carries its code and password: kept without them from now on.
  var old = kept.some(function (c) {
    return c && (c.code !== undefined || c.password !== undefined);
  });
  kept = kept.map(_cardWithoutCode).filter(Boolean);
  if (old) _saveDemoStudentCards(cid, kept);
  return kept;
}
function _saveDemoStudentCards(cid, cards) {
  _safeLSSet('gb-student-cards-' + cid, JSON.stringify(cards.map(_cardWithoutCode).filter(Boolean)));
}
/* When the app starts: every class's cards an older build saved on this
   device with their codes and passwords are kept without them, at once,
   not only when that class's list is next read. */
function _dropOldCardCodes() {
  try {
    var keys = [];
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && k.indexOf('gb-student-cards-') === 0) keys.push(k);
    }
    keys.forEach(function (k) {
      _demoStudentCards(k.slice('gb-student-cards-'.length));
    });
  } catch (e) {
    /* nothing readable, nothing to drop */
  }
}
_dropOldCardCodes();

/* Cards this browser has sent to the printer: card id → { at, cid }. Ids,
   class ids and times only. Kept on this device (gb-cards-printed-here,
   wiped at sign-out with every gb- key) until the server's list shows the
   card printed, or a list read that began after the note was made no longer
   shows the card (it was replaced).

   A list read from the server is overlaid with these and with every mark
   still waiting in the outbox, so a read never erases a write still on its
   way: a card printed here never shows Not Printed, never counts toward
   Make and Print, and is never replaced without the teacher asking.

   It is kept on the device, not only in this page, for a mark that never
   reaches the server (refused for good, or dropped on its last try after a
   reload): the cards went to the printer, so after a reload they still
   show Printed here, and Print New Card asks before replacing one. Such a
   mark is sent once more, through the outbox, the first time this page
   reads a list that still shows the card Not Printed.

   Every tab of the app shares the one stored copy: each change reads it,
   changes it and writes it back at once (_changePrintedHere), so one
   tab's notes never overwrite another's. */
var _CARDS_PRINTED_KEY = 'gb-cards-printed-here';
var _cardsPrintSending = {}; // card id → true while its mark is on its way from this page
var _cardsPrintResent = {}; // card id → true once its mark has been sent again from this page
// The stored notes, read fresh.
function _printedHere() {
  var kept = _safeParseLS(_CARDS_PRINTED_KEY, {});
  var out = {};
  if (kept && typeof kept === 'object' && !Array.isArray(kept)) {
    Object.keys(kept).forEach(function (id) {
      var e = kept[id];
      if (_isUuid(id) && e && typeof e.at === 'string' && typeof e.cid === 'string') out[id] = { at: e.at, cid: e.cid };
    });
  }
  return out;
}
// Read the stored notes, let `change` change them (it answers true when it did), and write them back at once.
function _changePrintedHere(change) {
  var here = _printedHere();
  if (!change(here)) return;
  if (Object.keys(here).length) {
    _safeLSSet(_CARDS_PRINTED_KEY, JSON.stringify(here));
    return;
  }
  try {
    localStorage.removeItem(_CARDS_PRINTED_KEY);
  } catch (e) {
    /* nothing kept, nothing to remove */
  }
}
// The outbox's waiting entries for one endpoint.
function _queuedCardWrites(endpoint) {
  try {
    var q = JSON.parse(localStorage.getItem('fv-sync-queue-v1') || '{}');
    return (q.entries || []).filter(function (entry) {
      return entry && entry.endpoint === endpoint && entry.payload;
    });
  } catch (err) {
    return []; // an unreadable queue only means nothing is known to be pending
  }
}
function _cardsPrintedQueued() {
  var out = {};
  _queuedCardWrites('mark_student_cards_printed').forEach(function (entry) {
    (entry.payload.p_card_ids || []).forEach(function (id) {
      if (!out[id]) out[id] = entry.created_at || new Date().toISOString();
    });
  });
  return out;
}
// Tests: forget this device's marks and unlocks, as a fresh page on a fresh device would.
function _forgetCardsPrintedHere() {
  _reloadCardsPrintedHere();
  try {
    localStorage.removeItem(_CARDS_PRINTED_KEY);
  } catch (e) {
    /* nothing kept */
  }
}
// Tests: a reload. What the page held goes; what the device keeps stays.
function _reloadCardsPrintedHere() {
  _cardsPrintSending = {};
  _cardsPrintResent = {};
  _cardsUnlockedHere = {};
  _cardsUnlockedAllHere = {};
  _cardsWorkUntilHere = {};
  _cardsWorkUntilServer = {};
}
function _sendCardsPrinted(ids) {
  ids.forEach(function (id) {
    _cardsPrintSending[id] = true;
  });
  return _trackPendingSync(
    Promise.resolve(
      _writeRpc('mark_student_cards_printed', { p_card_ids: ids, p_idempotency_key: _newEntryId() }),
    ).then(function (res) {
      ids.forEach(function (id) {
        delete _cardsPrintSending[id];
      });
      if (res && res.error && !res.error.handledSessionExpired) {
        console.warn('mark_student_cards_printed failed:', res.error);
      }
      return res;
    }),
  );
}
/* `asked` is when the read began (ISO time): a note made after that is
   newer than the list, so the list not showing its card says nothing. */
function _withPendingPrints(cid, cards, asked) {
  var here = _printedHere();
  var queued = _cardsPrintedQueued();
  var listed = {};
  var gone = [];
  var again = [];
  var out = cards.map(function (c) {
    listed[c.id] = true;
    if (c.printed_at) {
      if (here[c.id]) gone.push(c.id);
      return c;
    }
    var mine = here[c.id];
    var at = queued[c.id] || (mine && mine.at);
    if (at) c.printed_at = at;
    // A mark this device made that is no longer on its way: sent once more from this page.
    if (mine && !queued[c.id] && !_cardsPrintSending[c.id] && !_cardsPrintResent[c.id]) again.push(c.id);
    return c;
  });
  // A card printed here that its class no longer lists, in a read begun after the note, was replaced.
  Object.keys(here).forEach(function (id) {
    if (here[id].cid === cid && !listed[id] && asked && here[id].at < asked) gone.push(id);
  });
  if (gone.length) {
    _changePrintedHere(function (now) {
      var changed = false;
      gone.forEach(function (id) {
        // Only the note this read judged: one another tab has written since is left alone.
        if (now[id] && here[id] && now[id].at === here[id].at) {
          delete now[id];
          changed = true;
        }
      });
      return changed;
    });
  }
  if (again.length) {
    again.forEach(function (id) {
      _cardsPrintResent[id] = true;
    });
    _sendCardsPrinted(again);
  }
  return out;
}

/* Cards unlocked from this page whose unlock the server has not answered
   yet: card id → true (Unlock), and class id → true (Unlock All). While
   one is on its way, here or still waiting in the outbox, a list read shows
   the card unlocked, whatever the server's list says: the server has not
   heard yet. Once the server has answered, the list shows what it has:
   no comparison of this computer's clock with the server's. An unlock the
   server refuses is forgotten at once. */
var _cardsUnlockedHere = {};
var _cardsUnlockedAllHere = {};
function _withPendingUnlocks(cid, cards) {
  var one = {};
  Object.keys(_cardsUnlockedHere).forEach(function (id) {
    one[id] = true;
  });
  _queuedCardWrites('unlock_student_card').forEach(function (entry) {
    if (entry.payload.p_card_id) one[entry.payload.p_card_id] = true;
  });
  var all = !!_cardsUnlockedAllHere[cid];
  _queuedCardWrites('unlock_all_student_cards').forEach(function (entry) {
    if (entry.payload.p_course_id === cid) all = true;
  });
  return cards.map(function (c) {
    if (c.locked_at && (all || one[c.id])) {
      c.locked_at = null;
      c.wrong_tries = 0;
      c.wrong_tries_7d = 0;
    }
    return c;
  });
}

/* The class's last reporting date when that is still ahead, else the next
   June 30: the day a card made on this device works until, as the server
   works it out for its own. */
function _demoCardsWorkUntil(cid) {
  var today = courseToday(cid);
  var last = '';
  (getReportingTerms(cid) || []).forEach(function (t) {
    if (t && /^\d{4}-\d{2}-\d{2}$/.test(t.ends_on) && t.ends_on > last) last = t.ends_on;
  });
  if (last && last >= today) return last;
  var year = Number(today.slice(0, 4));
  return (today <= year + '-06-30' ? year : year + 1) + '-06-30';
}
// A whole number from 0 to n - 1, for n up to 256.
function _cardRandom(n) {
  if (typeof crypto !== 'undefined' && crypto && typeof crypto.getRandomValues === 'function') {
    // Rejection sampling: every value below n equally likely.
    var limit = 256 - (256 % n);
    var b = new Uint8Array(1);
    do crypto.getRandomValues(b);
    while (b[0] >= limit);
    return b[0] % n;
  }
  return Math.floor(Math.random() * n);
}
// Eight characters, shown K7M4-QX2P, as a card made by teacher-cards.
function _demoCardCode(taken) {
  var code;
  do {
    code = '';
    for (var i = 0; i < 8; i++) code += _CARD_CODE_LETTERS.charAt(_cardRandom(_CARD_CODE_LETTERS.length));
    code = code.slice(0, 4) + '-' + code.slice(4);
  } while (taken[code]);
  taken[code] = true;
  return code;
}
// The cards of students still in the class, in roster order.
function _demoCardsListed(cid) {
  var order = {};
  getStudents(cid).forEach(function (st, i) {
    order[st.id] = i + 1;
  });
  return _demoStudentCards(cid)
    .filter(function (c) {
      return c && order[c.enrollment_id];
    })
    .sort(function (a, b) {
      return order[a.enrollment_id] - order[b.enrollment_id];
    });
}

/* The class's cards: [card], one for each student who has one. */
function listStudentCards(cid) {
  if (!cid || !_gradesKept(cid)) return _cardsAnswer(null);
  if (!_writesEnabled()) return _cardsAnswer(_demoCardsListed(cid));
  if (!_useSupabase || !_isUuid(cid)) return _cardsAnswer(null);
  // When this read began: a printed note made after it is newer than the list (_withPendingPrints).
  var asked = new Date().toISOString();
  return _callRpcWithAuthGuard('list_student_cards', { p_course_id: cid }, { suppressSessionExpiredModal: true }).then(
    function (res) {
      if (res && res.error && !res.error.handledSessionExpired) console.warn('list_student_cards failed:', res.error);
      var ok = res && !res.error && res.data != null;
      return {
        data: ok
          ? _withPendingWorkUntil(
              cid,
              _withPendingUnlocks(
                cid,
                _withPendingPrints(cid, _rpcRows(res.data).map(_cardWithoutCode).filter(Boolean), asked),
              ),
            )
          : null,
        error: (res && res.error) || null,
      };
    },
  );
}

/* Demo Mode's teacher-cards: the same request and the same reply, on this
   device. The saved card keeps no code or password; the reply carries
   them once. A student whose live card is not the one named is
   `changed`, as the server answers a second tab. */
function _demoMakeCards(cid, items) {
  var kept = _demoStudentCards(cid);
  var students = {};
  getStudents(cid).forEach(function (st) {
    students[st.id] = st;
  });
  var until = getCardsWorkUntil(cid).date;
  var taken = {};
  var results = items.map(function (it) {
    var st = students[it.enrollment_id];
    if (!st) return { enrollment_id: it.enrollment_id, result: 'not_found' };
    var at = -1;
    kept.forEach(function (c, i) {
      if (c.enrollment_id === it.enrollment_id) at = i;
    });
    var live = at >= 0 ? kept[at] : null;
    if ((live ? live.id : null) !== (it.replaces || null))
      return { enrollment_id: it.enrollment_id, result: 'changed' };
    var hasPassword = !(st.dateOfBirth || st.studentNumber);
    var card = {
      id: uid(),
      enrollment_id: st.id,
      seq: (live && Number(live.seq) > 0 ? Number(live.seq) : live ? 1 : 0) + 1,
      created_at: new Date().toISOString(),
      printed_at: null,
      last_opened_at: null,
      locked_at: null,
      wrong_tries: 0,
      wrong_tries_7d: 0,
      works_until: until,
      check: hasPassword ? 'password' : 'identity',
      has_password: hasPassword,
      needs_new: false,
    };
    if (at >= 0) kept[at] = card;
    else kept.push(card);
    var out = {
      enrollment_id: st.id,
      result: 'made',
      card_id: card.id,
      seq: card.seq,
      works_until: until,
      code: _demoCardCode(taken),
    };
    if (hasPassword) {
      out.password = '';
      for (var d = 0; d < 4; d++) out.password += String(_cardRandom(10));
    }
    return out;
  });
  _saveDemoStudentCards(cid, kept);
  return { replayed: false, results: results };
}

function _teacherCardsUrl() {
  var base = ((window.__ENV && window.__ENV.SUPABASE_URL) || '').replace(/\/$/, '');
  return base ? base + '/functions/v1/teacher-cards?forceFunctionRegion=ca-central-1' : '';
}
async function _teacherToken() {
  var sb = getSupabase();
  if (!sb || !sb.auth || typeof sb.auth.getSession !== 'function') return null;
  try {
    var got = await sb.auth.getSession();
    var session = got && got.data && got.data.session;
    return (session && session.access_token) || null;
  } catch (e) {
    return null;
  }
}
/* One POST to teacher-cards. Answers { status, body }, or { status: 0 }
   when no reply came (the network, or a reply that is not JSON). Nothing
   about the reply is logged: it holds codes. */
async function _askTeacherCards(url, token, body) {
  try {
    var res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        apikey: (window.__ENV && window.__ENV.SUPABASE_KEY) || '',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      cache: 'no-store',
      credentials: 'omit',
    });
    var json = null;
    try {
      json = await res.json();
    } catch (e) {
      json = null;
    }
    return { status: res.status, body: json };
  } catch (e) {
    return { status: 0, body: null };
  }
}
/* One request to teacher-cards, under one request_id. A reply that never
   came is asked once more with the same id, so the server makes nothing
   twice; a sign-in that ran out is renewed once and asked again, the same
   way. */
async function _teacherCardsRequest(cid, items) {
  var url = _teacherCardsUrl();
  var token = await _teacherToken();
  if (!url || !token) return { data: null, error: { status: 401, error: 'unauthorized' } };
  var body = { course_id: cid, items: items, request_id: _newEntryId() };
  var got = await _askTeacherCards(url, token, body);
  if (got.status === 0) got = await _askTeacherCards(url, token, body);
  if (got.status === 401 && typeof refreshSupabaseSession === 'function') {
    var renewed = null;
    try {
      renewed = await refreshSupabaseSession();
    } catch (e) {
      renewed = null;
    }
    var fresh = renewed && renewed.session && renewed.session.access_token;
    if (fresh) got = await _askTeacherCards(url, fresh, body);
    else if (typeof showSessionExpiredToast === 'function') showSessionExpiredToast();
  }
  var out = got.body;
  if (got.status === 200 && out && typeof out.replayed === 'boolean' && Array.isArray(out.results)) {
    return { data: { replayed: out.replayed, results: out.results }, error: null };
  }
  var error = got.status === 0 ? 'network' : (out && typeof out.error === 'string' && out.error) || 'server';
  console.warn('teacher-cards failed:', got.status, error);
  return { data: null, error: { status: got.status, error: error } };
}

/* Make a card for each of `items`: [{ enrollment_id, replaces }], where
   `replaces` is the id of the card the caller believes is the student's
   live one, or null for a student with none. The server stops that card
   and makes the new one together, or answers `changed` when the student's
   live card is another (a second tab got there first).

   Answers { data: { results }, error }, each result
     { enrollment_id, result: 'made' | 'changed' | 'not_found' | 'failed',
       card_id, seq, works_until, code, password }
   with card_id, seq and works_until for a card that was made, its code
   (K7M4-QX2P) when it could be had, and its password only for a student
   with no birthday or student number on file. The codes are the caller's
   alone: nothing here keeps them.

   A reply lost on the way back (the card-codes design, section 7): the
   retry under the same request_id comes back `replayed`, with the new
   cards' ids and no codes, since nothing ever kept them. Those cards are
   then asked for again, each naming itself as the card to replace, and
   their fresh codes are the answer. If that fails too, the card is
   answered made with no code: it exists, unprinted, and the next Make and
   Print replaces it. */
function makeStudentCards(cid, items) {
  if (!cid || !_gradesKept(cid)) return _cardsAnswer(null);
  var asked = (Array.isArray(items) ? items : [])
    .filter(function (it) {
      return it && it.enrollment_id;
    })
    .map(function (it) {
      return { enrollment_id: it.enrollment_id, replaces: it.replaces || null };
    });
  if (!asked.length) return _cardsAnswer(null);
  if (!_writesEnabled()) return _cardsAnswer(_demoMakeCards(cid, asked));
  if (!_useSupabase || !_isUuid(cid)) return _cardsAnswer(null);
  asked = asked.filter(function (it) {
    return _isUuid(it.enrollment_id) && (it.replaces === null || _isUuid(it.replaces));
  });
  if (!asked.length) return _cardsAnswer(null);
  return _trackPendingSync(
    (async function () {
      var first = await _teacherCardsRequest(cid, asked);
      if (!first.data) return { data: null, error: first.error };
      var results = first.data.results.slice();
      var lost = results.filter(function (r) {
        return r && r.result === 'made' && !r.code && _isUuid(r.card_id);
      });
      if (lost.length) {
        var again = await _teacherCardsRequest(
          cid,
          lost.map(function (r) {
            return { enrollment_id: r.enrollment_id, replaces: r.card_id };
          }),
        );
        var fresh = {};
        ((again.data && again.data.results) || []).forEach(function (r) {
          if (r && r.result === 'made' && r.code) fresh[r.enrollment_id] = r;
        });
        results = results.map(function (r) {
          return r && fresh[r.enrollment_id] && r.result === 'made' && !r.code ? fresh[r.enrollment_id] : r;
        });
      }
      return { data: { results: results }, error: null };
    })(),
  );
}

/* These cards were printed. Answers { printed, printed_at } with the time
   this device gave them; a signed-in teacher's go up through the outbox,
   so a failure shows on the sync dot and nowhere else. */
function markStudentCardsPrinted(cid, cardIds) {
  var ids = (Array.isArray(cardIds) ? cardIds : []).filter(Boolean);
  if (!cid || !ids.length || !_gradesKept(cid)) return _cardsAnswer(null);
  var at = new Date().toISOString();
  if (!_writesEnabled()) {
    var kept = _demoStudentCards(cid);
    var n = 0;
    kept.forEach(function (c) {
      if (ids.indexOf(c.id) < 0) return;
      c.printed_at = at;
      n++;
    });
    if (n) _saveDemoStudentCards(cid, kept);
    return _cardsAnswer({ printed: n, printed_at: at });
  }
  ids = ids.filter(_isUuid);
  if (!_useSupabase || !_isUuid(cid) || !ids.length) return _cardsAnswer(null);
  _changePrintedHere(function (here) {
    ids.forEach(function (id) {
      here[id] = { at: at, cid: cid };
    });
    return true;
  });
  _sendCardsPrinted(ids);
  return _cardsAnswer({ printed: ids.length, printed_at: at });
}

/* Unlock one card, or every locked card in the class (Unlock All): the
   lock and the wrong-try count are cleared. Ids only. Answers at once with
   { unlocked, unlocked_at }; a signed-in teacher's goes up through the
   outbox, so a failure shows on the sync dot and nowhere else. `onFailed`,
   if given, is called when the server refuses it for good, after this
   page has forgotten it: the caller reads the list again. */
/* `sent` is the write (each RPC is named at its own call, so the database
   drift check sees it). Once the server has answered, either way, this
   page forgets the unlock: the server's list is the truth from then on. */
function _unlockSent(name, sent, forget, onFailed) {
  _trackPendingSync(
    Promise.resolve(sent).then(function (res) {
      forget();
      if (!res || !res.error) return;
      if (!res.error.handledSessionExpired) console.warn(name + ' failed:', res.error);
      if (typeof onFailed === 'function') onFailed(res.error);
    }),
  );
}
function unlockStudentCard(cid, cardId, onFailed) {
  if (!cid || !cardId || !_gradesKept(cid)) return _cardsAnswer(null);
  var at = new Date().toISOString();
  if (!_writesEnabled()) {
    var kept = _demoStudentCards(cid);
    var n = 0;
    kept.forEach(function (c) {
      if (c.id !== cardId) return;
      c.locked_at = null;
      c.wrong_tries = 0;
      c.wrong_tries_7d = 0;
      n++;
    });
    if (n) _saveDemoStudentCards(cid, kept);
    return _cardsAnswer({ unlocked: n, unlocked_at: at });
  }
  if (!_useSupabase || !_isUuid(cid) || !_isUuid(cardId)) return _cardsAnswer(null);
  _cardsUnlockedHere[cardId] = at;
  _unlockSent(
    'unlock_student_card',
    _writeRpc('unlock_student_card', { p_card_id: cardId, p_idempotency_key: _newEntryId() }),
    function () {
      if (_cardsUnlockedHere[cardId] === at) delete _cardsUnlockedHere[cardId];
    },
    onFailed,
  );
  return _cardsAnswer({ unlocked: 1, unlocked_at: at });
}
function unlockAllStudentCards(cid, onFailed) {
  if (!cid || !_gradesKept(cid)) return _cardsAnswer(null);
  var at = new Date().toISOString();
  if (!_writesEnabled()) {
    var kept = _demoStudentCards(cid);
    var n = 0;
    kept.forEach(function (c) {
      if (!c.locked_at) return;
      c.locked_at = null;
      c.wrong_tries = 0;
      c.wrong_tries_7d = 0;
      n++;
    });
    if (n) _saveDemoStudentCards(cid, kept);
    return _cardsAnswer({ unlocked: n, unlocked_at: at });
  }
  if (!_useSupabase || !_isUuid(cid)) return _cardsAnswer(null);
  _cardsUnlockedAllHere[cid] = at;
  _unlockSent(
    'unlock_all_student_cards',
    _writeRpc('unlock_all_student_cards', { p_course_id: cid, p_idempotency_key: _newEntryId() }),
    function () {
      if (_cardsUnlockedAllHere[cid] === at) delete _cardsUnlockedAllHere[cid];
    },
    onFailed,
  );
  return _cardsAnswer({ unlocked: null, unlocked_at: at });
}

/* Cards Work Until: the last day a class's cards open. The class's own
   choice (course.cards_work_until), or none, which means the default: the
   class's last reporting date while it is still ahead, else the next June
   30 (_demoCardsWorkUntil, the server's rule). The choice is written on
   every live card in the class when it is set (set_cards_work_until), and
   on each card when it is made.

   A signed-in class's choice comes on its course row with the class
   (get_class_bundle): _noteCardsWorkUntil keeps it, here in this page
   only. A change made here is laid over it, and over the cards of a list
   read before the server has it, as a printed mark is; a change the server
   refuses is forgotten and `onFailed` is called. Demo Mode keeps the
   choice on the device (gb-cards-work-until-<cid>) and writes it on the
   saved cards at once. */
var _cardsWorkUntilServer = {}; // cid → 'YYYY-MM-DD' or null, as the class's course row said
var _cardsWorkUntilHere = {}; // cid → { date, at }: set from this page, not yet known to have landed
function _isDay(d) {
  return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d + 'T12:00:00Z'));
}
function _noteCardsWorkUntil(cid, courseRow) {
  if (!cid || !courseRow || typeof courseRow !== 'object' || !('cards_work_until' in courseRow)) return;
  var d = courseRow.cards_work_until;
  _cardsWorkUntilServer[cid] = _isDay(String(d || '').slice(0, 10)) ? String(d).slice(0, 10) : null;
}
// A change to Cards Work Until on its way to the server: { date, at }, or null.
function _cardsWorkUntilPending(cid) {
  var out = _cardsWorkUntilHere[cid] || null;
  _queuedCardWrites('set_cards_work_until').forEach(function (entry) {
    if (entry.payload.p_course_id !== cid) return;
    var at = entry.created_at || '';
    if (!out || at > out.at) out = { date: entry.payload.p_date || null, at: at };
  });
  return out;
}
/* The class's Cards Work Until: { chosen, date, known, reporting }.
   chosen is the day the teacher chose, or null for the default; date is
   the day it works out to; known is false for a signed-in class whose
   choice has not come from the server yet (date is then the default);
   reporting is true when the default is the class's last reporting date
   (false: the next June 30). */
function getCardsWorkUntil(cid) {
  if (!cid) return { chosen: null, date: '', known: false, reporting: false };
  var fallback = _demoCardsWorkUntil(cid);
  var reporting =
    !/-06-30$/.test(fallback) ||
    (getReportingTerms(cid) || []).some(function (t) {
      return t && t.ends_on === fallback;
    });
  var out = function (chosen, known) {
    return { chosen: chosen, date: chosen || fallback, known: known, reporting: reporting };
  };
  if (!_writesEnabled()) {
    var kept = _safeParseLS('gb-cards-work-until-' + cid, null);
    return out(kept && _isDay(kept.date) ? kept.date : null, true);
  }
  var pending = _cardsWorkUntilPending(cid);
  if (pending) return out(pending.date, true);
  if (!(cid in _cardsWorkUntilServer)) return out(null, false);
  return out(_cardsWorkUntilServer[cid], true);
}
function _withPendingWorkUntil(cid, cards) {
  var pending = _cardsWorkUntilPending(cid);
  if (!pending) return cards;
  var date = pending.date || _demoCardsWorkUntil(cid);
  return cards.map(function (c) {
    c.works_until = date;
    return c;
  });
}
/* Set the class's Cards Work Until to `date` ('YYYY-MM-DD'), or back to
   the default with null. Answers at once with { works_until }, the day it
   works out to; a signed-in teacher's goes up through the outbox. */
function setCardsWorkUntil(cid, date, onFailed) {
  if (!cid || !_gradesKept(cid)) return _cardsAnswer(null);
  if (date !== null && !_isDay(date)) return _cardsAnswer(null);
  var until = date || _demoCardsWorkUntil(cid);
  if (!_writesEnabled()) {
    if (date) _safeLSSet('gb-cards-work-until-' + cid, JSON.stringify({ date: date }));
    else {
      try {
        localStorage.removeItem('gb-cards-work-until-' + cid);
      } catch (e) {
        /* nothing kept */
      }
    }
    var kept = _demoStudentCards(cid);
    kept.forEach(function (c) {
      c.works_until = until;
    });
    if (kept.length) _saveDemoStudentCards(cid, kept);
    return _cardsAnswer({ works_until: until });
  }
  if (!_useSupabase || !_isUuid(cid)) return _cardsAnswer(null);
  var mine = { date: date, at: new Date().toISOString() };
  _cardsWorkUntilHere[cid] = mine;
  _trackPendingSync(
    Promise.resolve(
      _writeRpc('set_cards_work_until', { p_course_id: cid, p_date: date, p_idempotency_key: _newEntryId() }),
    ).then(function (res) {
      var still = _cardsWorkUntilHere[cid] === mine;
      if (res && !res.error) {
        if (still) {
          delete _cardsWorkUntilHere[cid];
          _cardsWorkUntilServer[cid] = date;
        }
        return;
      }
      if (res && res.error && !res.error.handledSessionExpired) console.warn('set_cards_work_until failed:', res.error);
      if (still) delete _cardsWorkUntilHere[cid];
      if (typeof onFailed === 'function') onFailed(res && res.error);
    }),
  );
  return _cardsAnswer({ works_until: until });
}
/* ── end Student cards ── */

/* ── Points-mode helpers: one score → all tags ──────────────── */
// A cell's points, or null when it has no score. A 0 is a score.
function getPointsScore(cid, sid, aid) {
  const scores = getScores(cid);
  const entries = scores[sid] || [];
  const entry = entries.find(e => e.assessmentId === aid && e.score != null && e.score !== '');
  return entry ? Number(entry.score) : null;
}
/* Complete/Incomplete marks: 'complete', 'incomplete', or null when unmarked. */
function getCompletionMark(cid, sid, aid) {
  const entry = (getScores(cid)[sid] || []).find(e => e.assessmentId === aid);
  if (!entry || entry.score == null) return null;
  return Number(entry.score) > 0 ? 'complete' : 'incomplete';
}
function _setCompletionMarkOne(cid, sid, aid, mark) {
  if (mark === 'complete') return setPointsScore(cid, sid, aid, COMPLETE_MAX_POINTS);
  if (mark === 'incomplete') return setPointsScore(cid, sid, aid, 0);
  const scores = getScores(cid);
  const before = (scores[sid] || []).length;
  scores[sid] = (scores[sid] || []).filter(e => e.assessmentId !== aid);
  if (scores[sid].length !== before) saveScores(cid, scores);
  return scores;
}
// rawScore null clears the cell; 0 is a score of 0.
function _setPointsScoreOne(cid, sid, aid, rawScore) {
  const assess = getAssessments(cid).find(a => a.id === aid);
  if (!assess) return;
  const tagIds = scoreTagIds(assess);
  const scores = getScores(cid);
  if (!scores[sid]) scores[sid] = [];
  if (rawScore == null || rawScore === '') {
    const kept = scores[sid].filter(e => e.assessmentId !== aid);
    if (kept.length === scores[sid].length) return scores;
    scores[sid] = kept;
    saveScores(cid, scores);
    return scores;
  }
  let changed = false;
  tagIds.forEach(tid => {
    const entry = scores[sid].find(e => e.assessmentId === aid && e.tagId === tid);
    if (entry) {
      if (entry.score !== rawScore) {
        entry.score = rawScore;
        changed = true;
      }
    } else if (rawScore >= 0) {
      scores[sid].push({
        id: uid(),
        assessmentId: aid,
        tagId: tid,
        score: rawScore,
        date: assess.date || courseToday(cid),
        type: scoreTypeFor(assess),
        note: '',
        created: new Date().toISOString(),
      });
      changed = true;
    }
  });
  // saveScores' diff sends the one upsert_score for this cell.
  if (changed) saveScores(cid, scores);
  return scores;
}

/* ── Group grading ──────────────────────────────────────────────
   Pair and Group work is graded once per group, the Teams way: a level,
   + / −, points or mark, criterion comment, checkbox or Overall Comment
   saved for one member is copied to every other member still graded with
   the group. Each member keeps real score rows, so grades, reports and the
   gradebook read them like anyone's.
   - Grade Separately takes a member out (assessment.gradedSeparately, in
     collab_config): they keep their copy and changes stop reaching them.
     Back to Group Grade puts them back and copies the group's grade again.
   - A member whose grade already differs from the group's (graded before
     the groups were made, or moved from another group) is never written
     over: the first group edit moves them to Graded Separately instead.
   - Missing, Excused and Late stay per student. A member who is Missing or
     Excused gets no group grade, and marking them clears their copy; taking
     the status off copies the group's grade back. When the last member
     holding the grade is marked, it is set aside on the assessment
     (groupGradeAside, in collab_config) and comes back with the first status
     taken off. A member whose grade is their own can't be marked.
   - The Note for the Report and DIBELS stay per student; DIBELS work is
     never graded by group. */

/* The pair or group `sid` is in on assessment `a`: { kind, index, members },
   or null for individual work, DIBELS and students in no group. */
function getCollabGroupOf(a, sid) {
  if (!a || !sid || isDibelsScored(a)) return null;
  var kind = a.collaboration === 'pair' ? 'pair' : a.collaboration === 'group' ? 'group' : null;
  if (!kind) return null;
  var list = (kind === 'pair' ? a.pairs : a.groups) || [];
  for (var i = 0; i < list.length; i++) {
    if (Array.isArray(list[i]) && list[i].indexOf(sid) >= 0) return { kind: kind, index: i, members: list[i] };
  }
  return null;
}
function collabGroupLabel(group) {
  return (group.kind === 'pair' ? 'Pair ' : 'Group ') + (group.index + 1);
}
function isGradedSeparately(a, sid) {
  return !!a && Array.isArray(a.gradedSeparately) && a.gradedSeparately.indexOf(sid) >= 0;
}
/* True when `sid` takes the group grade on `aid`: in a pair or group and
   not graded separately. A Missing or Excused member is still linked; they
   just get no grade while the status is on. */
function isLinkedGroupMember(cid, aid, sid) {
  var a = _assessmentById(cid, aid);
  return !!getCollabGroupOf(a, sid) && !isGradedSeparately(a, sid);
}
function isGroupWithheld(cid, sid, aid) {
  var status = getAssignmentStatus(cid, sid, aid);
  return status === 'NS' || status === 'EXC';
}
/* The other members of `sid`'s group still graded with it. */
function _linkedGroupPeers(cid, a, sid) {
  var group = getCollabGroupOf(a, sid);
  if (!group) return [];
  return group.members.filter(function (m) {
    return m !== sid && !isGradedSeparately(a, m);
  });
}

/* How Pair or Group work is graded, step by step, for every grading view:
   a unit per group ({ group, members, linked, source }: the members on the
   roster, those still graded with it, and the one its grade is drawn from,
   the first linked member who isn't Missing or Excused), each followed by
   its members graded separately ({ sid, separateFrom }), then everyone in
   no group ({ sid }). `order` is the roster's ids in the view's order. Null
   when `a` isn't graded by group. */
function groupGradingUnits(cid, a, order) {
  var kind =
    a && !isDibelsScored(a)
      ? a.collaboration === 'pair'
        ? 'pairs'
        : a.collaboration === 'group'
          ? 'groups'
          : null
      : null;
  var lists = (kind && a[kind]) || [];
  if (!lists.length) return null;
  var known = {};
  order.forEach(function (id) {
    known[id] = true;
  });
  var units = [];
  var placed = {};
  lists.forEach(function (list, index) {
    var members = (list || []).filter(function (m) {
      return known[m];
    });
    members.forEach(function (m) {
      placed[m] = true;
    });
    var group = { kind: kind === 'pairs' ? 'pair' : 'group', index: index, members: members };
    var linked = members.filter(function (m) {
      return !isGradedSeparately(a, m);
    });
    if (linked.length) {
      var source =
        linked.find(function (m) {
          return !isGroupWithheld(cid, m, a.id);
        }) || linked[0];
      units.push({ group: group, members: members, linked: linked, source: source });
    }
    members.forEach(function (m) {
      if (isGradedSeparately(a, m)) units.push({ sid: m, separateFrom: group });
    });
  });
  order.forEach(function (id) {
    if (!placed[id]) units.push({ sid: id });
  });
  return units;
}

/* The member Back to Group Grade would copy `sid`'s grade from, or null
   when nothing would be copied (no other member still graded with the
   group who isn't Missing or Excused, or `sid` is Missing or Excused). */
function backToGroupGradeSource(cid, aid, sid) {
  if (isGroupWithheld(cid, sid, aid)) return null;
  return _groupGradeHolder(cid, aid, sid);
}
/* The other linked member who isn't Missing or Excused that `sid`'s group
   grade is drawn from: one with a grade first. Null when there is none. */
function _groupGradeHolder(cid, aid, sid) {
  var a = _assessmentById(cid, aid);
  var scores = getScores(cid);
  var peers = _linkedGroupPeers(cid, a, sid).filter(function (m) {
    return !isGroupWithheld(cid, m, aid);
  });
  return (
    peers.find(function (m) {
      return !_groupGradeEmpty(scores, a, m);
    }) ||
    peers[0] ||
    null
  );
}
/* True when `sid`'s grade on `aid` is the group's copy: the same as the
   member it is drawn from, or there is nobody else to draw it from. */
function _holdsGroupCopy(cid, aid, sid) {
  var from = _groupGradeHolder(cid, aid, sid);
  if (!from) return true;
  var scores = getScores(cid);
  return _groupGradeKey(scores, sid, aid) === _groupGradeKey(scores, from, aid);
}

var _groupWriteDepth = 0;

/* What a member's grade on `aid` is, for telling whether it changed. */
function _groupGradeKey(scores, sid, aid) {
  return JSON.stringify(
    (scores[sid] || [])
      .filter(function (e) {
        return e && e.assessmentId === aid;
      })
      .map(function (e) {
        return [e.tagId, e.score, e.mod || 0, e.note || '', e.critNote || '', e.critBeyond || ''];
      })
      .sort(),
  );
}
/* True when `sid` has nothing on `aid`: no score, mark or comment. */
function _groupGradeEmpty(scores, a, sid) {
  return !(scores[sid] || []).some(function (e) {
    return e && e.assessmentId === a.id && (isScoreEntered(a, e) || !!e.note || !!e.critNote || !!e.critBeyond);
  });
}

/* Copy `sid`'s grade on `aid` to the other linked members who aren't
   Missing or Excused (or only to `onlyTo`). With `prior`, `sid`'s grade
   before this write, a member whose grade matched neither it nor nothing
   had a grade of their own: they move to Graded Separately instead of
   being written over. Nothing is copied from a member who is graded
   separately, Missing or Excused. */
function _syncGroupFrom(cid, aid, sid, prior, onlyTo) {
  var a = _assessmentById(cid, aid);
  if (!a || !isLinkedGroupMember(cid, aid, sid) || isGroupWithheld(cid, sid, aid)) return;
  var targets = _linkedGroupPeers(cid, a, sid).filter(function (m) {
    return (!onlyTo || m === onlyTo) && !isGroupWithheld(cid, m, aid);
  });
  if (!targets.length) return;
  _groupWriteDepth++;
  try {
    var scores = getScores(cid);
    var sourceKey = _groupGradeKey(scores, sid, aid);
    if (prior != null) {
      var own = targets.filter(function (m) {
        var key = _groupGradeKey(scores, m, aid);
        return key !== sourceKey && key !== prior && !_groupGradeEmpty(scores, a, m);
      });
      if (own.length) {
        var assessments = getAssessments(cid);
        var stored = assessments.find(function (x) {
          return x.id === aid;
        });
        stored.gradedSeparately = (stored.gradedSeparately || []).concat(own);
        saveAssessments(cid, assessments);
        a = _assessmentById(cid, aid);
        targets = targets.filter(function (m) {
          return own.indexOf(m) < 0;
        });
      }
    }
    var source = (scores[sid] || []).filter(function (e) {
      return e && e.assessmentId === aid;
    });
    var bySourceTag = {};
    source.forEach(function (e) {
      bySourceTag[e.tagId] = e;
    });
    var changed = false;
    targets.forEach(function (m) {
      if (_groupGradeKey(scores, m, aid) === sourceKey) return;
      // The diff save sends values and new comments but not cleared ones,
      // so a comment the source no longer has is cleared first.
      if (getScoreComment(cid, m, aid) && !getScoreComment(cid, sid, aid)) saveScoreComment(cid, m, aid, '');
      (scores[m] || []).forEach(function (e) {
        if (!e || e.assessmentId !== aid) return;
        var src = bySourceTag[e.tagId] || {};
        ['critNote', 'critBeyond'].forEach(function (field) {
          if (!e[field] || src[field]) return;
          if (_rubricCriterionById(cid, a, e.tagId)) _saveRubricCriterionNote(cid, m, aid, e.tagId, '', field);
          else if (field === 'critNote') saveTagComment(cid, m, aid, e.tagId, '');
        });
      });
      scores = getScores(cid);
      _replaceGroupEntries(cid, scores, a, m, source);
      changed = true;
    });
    if (changed) saveScores(cid, scores);
    var checks = getRubricCheckIds(cid, sid, aid);
    targets.forEach(function (m) {
      var mine = getRubricCheckIds(cid, m, aid);
      checks.forEach(function (id) {
        if (mine.indexOf(id) < 0) setRubricCheck(cid, m, aid, id, true);
      });
      mine.forEach(function (id) {
        if (checks.indexOf(id) < 0) setRubricCheck(cid, m, aid, id, false);
      });
    });
    if (changed) _broadcastChange(cid, 'scores');
  } finally {
    _groupWriteDepth--;
  }
}

/* Copy the group's grade onto `sid` alone: from a member holding it, else
   the grade set aside when every member was Missing or Excused. With
   nothing to copy, `sid` keeps what they have. */
function _copyGroupGradeTo(cid, aid, sid) {
  var from = backToGroupGradeSource(cid, aid, sid);
  var a = _assessmentById(cid, aid);
  if ((!from || _groupGradeEmpty(getScores(cid), a, from)) && _restoreGroupGradeAside(cid, aid, sid)) return;
  if (from) _syncGroupFrom(cid, aid, from, null, sid);
}

/* The stored assessment and its group's linked members, for the grade set
   aside. */
function _groupAsideOf(cid, aid, sid) {
  var assessments = getAssessments(cid);
  var stored = assessments.find(function (x) {
    return x.id === aid;
  });
  if (!stored || !isLinkedGroupMember(cid, aid, sid)) return null;
  return { assessments: assessments, stored: stored, members: [sid].concat(_linkedGroupPeers(cid, stored, sid)) };
}
/* Keep `saved` ({ entries, checks }) as the group's grade under `sid`, or
   with null drop what the group has set aside. */
function _setGroupGradeAside(cid, aid, sid, saved) {
  var at = _groupAsideOf(cid, aid, sid);
  if (!at) return;
  var aside = Object.assign({}, at.stored.groupGradeAside);
  var before = JSON.stringify(aside);
  at.members.forEach(function (m) {
    delete aside[m];
  });
  if (saved) aside[sid] = saved;
  if (JSON.stringify(aside) === before) return;
  if (Object.keys(aside).length) at.stored.groupGradeAside = aside;
  else delete at.stored.groupGradeAside;
  saveAssessments(cid, at.assessments);
}
/* Put the group's grade set aside back on `sid`, when they have none and
   aren't Missing or Excused. True when it was put back. */
function _restoreGroupGradeAside(cid, aid, sid) {
  var at = _groupAsideOf(cid, aid, sid);
  if (!at || !at.stored.groupGradeAside || isGroupWithheld(cid, sid, aid)) return false;
  var holder = at.members.find(function (m) {
    return at.stored.groupGradeAside[m];
  });
  var a = _assessmentById(cid, aid);
  var scores = getScores(cid);
  if (!holder || !_groupGradeEmpty(scores, a, sid)) return false;
  var saved = at.stored.groupGradeAside[holder];
  _groupWriteDepth++;
  try {
    _replaceGroupEntries(cid, scores, a, sid, saved.entries || []);
    saveScores(cid, scores);
    (saved.checks || []).forEach(function (id) {
      setRubricCheck(cid, sid, aid, id, true);
    });
  } finally {
    _groupWriteDepth--;
  }
  _setGroupGradeAside(cid, aid, sid, null);
  _broadcastChange(cid, 'scores');
  return true;
}

/* `m`'s entries for `aid` become `entries`. A Note for the Report stays on
   them, or on an empty entry when there are none. */
function _replaceGroupEntries(cid, scores, a, m, entries) {
  var aid = a.id;
  var reportNote = getScoreReportNote(cid, m, aid);
  var next = entries.map(function (e) {
    var copy = _cloneValue(e);
    copy.id = m + ':' + aid + ':' + e.tagId;
    if (reportNote) copy.reportNote = reportNote;
    else delete copy.reportNote;
    return copy;
  });
  if (!next.length && reportNote) {
    var key = _noteOnlyScoreKey(cid, a);
    next.push({
      id: m + ':' + aid + ':' + key,
      assessmentId: aid,
      tagId: key,
      score: isPointsScored(a) ? null : 0,
      date: a.date || courseToday(cid),
      type: scoreTypeFor(a),
      note: '',
      reportNote: reportNote,
      created: new Date().toISOString(),
    });
  }
  scores[m] = (scores[m] || [])
    .filter(function (e) {
      return !(e && e.assessmentId === aid);
    })
    .concat(next);
}

/* Remove `sid`'s copy of the group grade on `aid`. When nobody else holds
   it, it is set aside first. */
function _clearGroupCopy(cid, aid, sid) {
  var a = _assessmentById(cid, aid);
  if (!a) return;
  var checks = getRubricCheckIds(cid, sid, aid);
  var from = _groupGradeHolder(cid, aid, sid);
  var held = getScores(cid);
  if ((!from || _groupGradeEmpty(held, a, from)) && (!_groupGradeEmpty(held, a, sid) || checks.length)) {
    var entries = (held[sid] || [])
      .filter(function (e) {
        return e && e.assessmentId === aid;
      })
      .map(function (e) {
        var copy = _cloneValue(e);
        delete copy.id;
        delete copy.reportNote;
        return copy;
      });
    _setGroupGradeAside(cid, aid, sid, { entries: entries, checks: checks });
  }
  _groupWriteDepth++;
  try {
    if (getScoreComment(cid, sid, aid)) saveScoreComment(cid, sid, aid, '');
    var scores = getScores(cid);
    if (_groupGradeKey(scores, sid, aid) !== '[]') {
      _replaceGroupEntries(cid, scores, a, sid, []);
      saveScores(cid, scores);
    }
    getRubricCheckIds(cid, sid, aid).forEach(function (id) {
      setRubricCheck(cid, sid, aid, id, false);
    });
  } finally {
    _groupWriteDepth--;
  }
}

/* Grade Separately (on) or Back to Group Grade (off). */
function setGradedSeparately(cid, aid, sid, on) {
  var assessments = getAssessments(cid);
  var a = assessments.find(function (x) {
    return x.id === aid;
  });
  if (!a || !getCollabGroupOf(a, sid) || isGradedSeparately(a, sid) === !!on) return false;
  var list = (a.gradedSeparately || []).filter(function (id) {
    return id !== sid;
  });
  if (on) list.push(sid);
  if (list.length) a.gradedSeparately = list;
  else delete a.gradedSeparately;
  saveAssessments(cid, assessments);
  if (!on) _copyGroupGradeTo(cid, aid, sid);
  return true;
}

/* A grade write for one student: `write` runs, then (outermost write only)
   the student's grade is copied to the rest of their group. */
function _groupWrite(cid, sid, aid, write, args) {
  var outer = _groupWriteDepth === 0;
  var prior = outer && isLinkedGroupMember(cid, aid, sid) ? _groupGradeKey(getScores(cid), sid, aid) : null;
  _groupWriteDepth++;
  var out;
  try {
    out = write.apply(null, args);
  } finally {
    _groupWriteDepth--;
  }
  if (prior != null) _syncGroupFrom(cid, aid, sid, prior);
  return out;
}
// Missing and Excused work takes no score (isScoreLocked): refused (false).
function upsertScore(cid, sid, aid, tid, scoreVal, date, type, note, mod) {
  if (isScoreLocked(cid, sid, aid) && isScoreEntered(_assessmentById(cid, aid), { score: scoreVal })) return false;
  return _groupWrite(cid, sid, aid, _upsertScoreOne, arguments);
}
function setPointsScore(cid, sid, aid, rawScore) {
  if (isScoreLocked(cid, sid, aid) && rawScore != null && rawScore !== '') return false;
  return _groupWrite(cid, sid, aid, _setPointsScoreOne, arguments);
}
function setCompletionMark(cid, sid, aid, mark) {
  if (isScoreLocked(cid, sid, aid) && mark) return false;
  return _groupWrite(cid, sid, aid, _setCompletionMarkOne, arguments);
}
function saveScoreComment(cid, sid, aid, text) {
  return _groupWrite(cid, sid, aid, _saveScoreCommentOne, arguments);
}
function saveRubricCriterionComment(cid, sid, aid, criterionId, text) {
  return _groupWrite(cid, sid, aid, _saveRubricCriterionCommentOne, arguments);
}
function saveRubricCriterionBeyond(cid, sid, aid, criterionId, text) {
  return _groupWrite(cid, sid, aid, _saveRubricCriterionBeyondOne, arguments);
}
function saveTagComment(cid, sid, aid, tagId, text) {
  return _groupWrite(cid, sid, aid, _saveTagCommentOne, arguments);
}
function setRubricCheck(cid, sid, aid, checkId, on) {
  return _groupWrite(cid, sid, aid, _setRubricCheckOne, arguments);
}

/* Every linked member's grade in `scores`, for saveScores to tell which a
   whole-blob save (clearing a cell, an undo) changed. Null when the class
   has no group work. */
function _groupGradesIn(cid, scores) {
  var linked = [];
  getAssessments(cid).forEach(function (a) {
    if (!a || isDibelsScored(a) || (a.collaboration !== 'pair' && a.collaboration !== 'group')) return;
    ((a.collaboration === 'pair' ? a.pairs : a.groups) || []).forEach(function (members) {
      (members || []).forEach(function (sid) {
        if (!isGradedSeparately(a, sid))
          linked.push({ aid: a.id, sid: sid, group: members, key: _groupGradeKey(scores || {}, sid, a.id) });
      });
    });
  });
  return linked.length ? linked : null;
}
/* After a whole-blob save, copy each changed group from its first changed
   member. */
function _syncChangedGroups(cid, before, scores) {
  var synced = [];
  before.forEach(function (l) {
    if (synced.indexOf(l.group) >= 0 || isGroupWithheld(cid, l.sid, l.aid)) return;
    if (_groupGradeKey(scores, l.sid, l.aid) === l.key) return;
    synced.push(l.group);
    _syncGroupFrom(cid, l.aid, l.sid, l.key);
  });
}

/* After a status save, clear the copy of a linked member who became
   Missing or Excused and copy the group's grade back to one who stopped
   being either. */
function _syncGroupStatuses(cid, prev, next) {
  var withheld = function (v) {
    return v === 'NS' || v === 'EXC';
  };
  var keys = {};
  Object.keys(prev || {}).forEach(function (k) {
    keys[k] = true;
  });
  Object.keys(next || {}).forEach(function (k) {
    keys[k] = true;
  });
  Object.keys(keys).forEach(function (key) {
    var was = withheld((prev || {})[key]);
    var now = withheld((next || {})[key]);
    if (was === now) return;
    var cut = key.indexOf(':');
    var sid = key.slice(0, cut);
    var aid = key.slice(cut + 1);
    if (!isLinkedGroupMember(cid, aid, sid)) return;
    if (now) _clearGroupCopy(cid, aid, sid);
    else _copyGroupGradeTo(cid, aid, sid);
  });
}

/* ── Active Course ──────────────────────────────────────────── */
function getActiveCourse() {
  const cfg = getConfig();
  if (cfg.activeCourse && COURSES[cfg.activeCourse] && !isCourseArchived(cfg.activeCourse)) return cfg.activeCourse;
  const ids = Object.keys(COURSES);
  const firstActive = ids.find(function (cid) {
    return !isCourseArchived(cid);
  });
  return firstActive || (ids.length > 0 ? ids[0] : null);
}
function setActiveCourse(cid) {
  // Prefer the canonical uuid once the re-key has landed so the persisted
  // pointer never keeps a placeholder alive. While create_course is still in
  // flight the placeholder is kept — it is a valid local COURSES key, so the
  // UI still resolves the new course — and _migrateCourseDataLocalToCanonical
  // rewrites it when the uuid arrives. Either way the id is sanitized again
  // in _teacherPrefsPatchFromConfig before it reaches the server.
  saveConfig({ ...getConfig(), activeCourse: _resolveCanonicalCourseId(cid) || cid || null });
}

/* Every class picker switches through here. A generation number makes the
   last switch win: when the teacher picks A then B, A's slower load must not
   render after B's. Resolves true when this switch is still the current one
   and the page should render. */
var _switchGeneration = 0;
async function switchActiveCourse(cid) {
  var gen = ++_switchGeneration;
  var started = _perfNow();
  setActiveCourse(cid);
  var load = function () {
    return initData(cid);
  };
  setPageLock('switching', true);
  try {
    await load();
  } finally {
    setPageLock('switching', false);
  }
  recordLoadTiming('class.switch', cid, _perfNow() - started);
  return gen === _switchGeneration;
}

/* Class load timings, kept so changes to the load path can be measured on a
   real device. window.__fvPerf holds the last 50; set localStorage
   'fv-perf' to '1' to also log each one. */
function _perfNow() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}
function recordLoadTiming(name, cid, ms) {
  var entry = { name: name, cid: cid, ms: Math.round(ms), at: new Date().toISOString() };
  var buf = (window.__fvPerf = window.__fvPerf || []);
  buf.push(entry);
  if (buf.length > 50) buf.shift();
  try {
    if (localStorage.getItem('fv-perf') === '1') console.info('[fv-perf] ' + name + ' ' + entry.ms + ' ms');
  } catch (e) {
    /* storage blocked */
  }
  return entry;
}

function isCourseArchived(cid) {
  return !!(cid && COURSES && COURSES[cid] && COURSES[cid].archived);
}

/* The classes a class menu lists: every class that isn't archived, plus the
   open one even if it is, so the menu always names the class on screen.
   Archived copies used to appear beside the real class under the same name,
   and picking one opened an empty class. */
/* ── Blocks ─────────────────────────────────────────────────────
   A class can name its block: one of a school's lettered blocks ("A"–"E"),
   an X block, or a short label for anything else ("Lunch club"). Two
   sections of one course then read differently in every class picker.
   Stored on the course row (migrations/20261020_course_block.sql). */
var COURSE_BLOCK_CHOICES = ['A', 'B', 'C', 'D', 'E', 'X'];
var COURSE_BLOCK_MAX = 24;

/** Trimmed block text, letters/digits of one or two characters upper-cased. */
function normalizeCourseBlock(value) {
  var b = String(value == null ? '' : value)
    .trim()
    .slice(0, COURSE_BLOCK_MAX);
  return /^[a-z0-9]{1,2}$/i.test(b) ? b.toUpperCase() : b;
}

/** "Block A" for a short code, the text itself for a longer label, '' for none. */
function courseBlockLabel(course) {
  var b = normalizeCourseBlock(course && course.block);
  if (!b) return '';
  return /^[A-Z0-9]{1,2}$/.test(b) ? 'Block ' + b : b;
}

/** The class as menus show it: "Block A · Philosophy 12". The name alone when
 * there is no block or the name already says it. */
function courseDisplayName(course) {
  var name = (course && course.name) || '';
  var label = courseBlockLabel(course);
  if (!label || name.toLowerCase().indexOf(label.toLowerCase()) >= 0) return name;
  return label + ' \u00B7 ' + name;
}

/** The class as the class pickers show it: "A · Philosophy 12", the block
 * code alone since the menu is a list of blocks. A longer label, or a name
 * that already says its block, reads as courseDisplayName does. */
function coursePickerName(course) {
  var b = normalizeCourseBlock(course && course.block);
  if (!/^[A-Z0-9]{1,2}$/.test(b)) return courseDisplayName(course);
  var name = (course && course.name) || '';
  if (name.toLowerCase().indexOf(courseBlockLabel(course).toLowerCase()) >= 0) return name;
  return b + ' \u00B7 ' + name;
}

/** Sort key: lettered and numbered blocks in order, then labels, then none. */
function _courseBlockRank(course) {
  var b = normalizeCourseBlock(course && course.block);
  if (!b) return '3';
  if (/^[A-Z0-9]{1,2}$/.test(b)) return '1' + (b.length === 1 ? ' ' + b : b);
  return '2' + b.toLowerCase();
}

/** Classes in block order; classes without a block keep their own order after. */
function sortCoursesByBlock(courses) {
  return (courses || [])
    .map(function (c, i) {
      return { c: c, i: i, k: _courseBlockRank(c) };
    })
    .sort(function (a, b) {
      return a.k < b.k ? -1 : a.k > b.k ? 1 : a.i - b.i;
    })
    .map(function (x) {
      return x.c;
    });
}

function getPickerCourses(activeCid) {
  var list = Object.keys(COURSES || {})
    .filter(function (cid) {
      return !isCourseArchived(cid) || cid === activeCid;
    })
    .map(function (cid) {
      return Object.assign({}, COURSES[cid], { id: cid });
    });
  return sortCoursesByBlock(list).map(function (c) {
    return { id: c.id, name: coursePickerName(c) };
  });
}

/* ── Flags ──────────────────────────────────────────────────── */
function getFlags(cid) {
  if (_cache.flags[cid] !== undefined) return _cache.flags[cid];
  try {
    return JSON.parse(localStorage.getItem('gb-flags-' + cid)) || {};
  } catch (e) {
    console.warn('Flags parse fallback:', e);
    return {};
  }
}
function saveFlags(cid, obj) {
  _saveCourseField('flags', cid, obj);
}
function isStudentFlagged(cid, sid) {
  return !!getFlags(cid)[sid];
}
function toggleFlag(cid, sid) {
  const flags = getFlags(cid);
  var nextFlagged = !flags[sid];
  if (nextFlagged) flags[sid] = true;
  else delete flags[sid];
  saveFlags(cid, flags);
  var summaries = getStudentProfileSummaries(cid);
  if (summaries[sid]) {
    summaries[sid].isFlagged = nextFlagged;
    if (summaries[sid].enrollment) summaries[sid].enrollment.isFlagged = nextFlagged;
    _persistLoadedField(cid, 'studentProfileSummaries', summaries);
  }
  _markLocalWrite('studentProfileSummaries', cid);
  if (_writesEnabled() && _isSendableId(sid)) {
    return window.setEnrollmentFlag(sid, nextFlagged).then(function (res) {
      if (res && res.error) console.warn('setEnrollmentFlag failed:', res.error);
      return nextFlagged;
    });
  }
  return Promise.resolve(nextFlagged);
}

/* ── Goals & Reflections Storage ───────────────────────────── */
function getGoals(cid) {
  if (_cache.goals[cid] !== undefined) return _cache.goals[cid];
  try {
    return JSON.parse(localStorage.getItem('gb-goals-' + cid)) || {};
  } catch (e) {
    console.warn('Goals parse fallback:', e);
    return {};
  }
}
function saveGoals(cid, obj) {
  _saveCourseField('goals', cid, obj);
}

/* When each goal was set (last saved): { sid: { sectionId: ISO date } }.
   Signed in, the server's dates fill it as the class loads; a goal saved here
   dates itself at once, and in Demo Mode that is the only source. */
function getGoalDates(cid) {
  if (_cache.goalDates[cid] !== undefined) return _cache.goalDates[cid];
  return _safeParseLS('gb-goal-dates-' + cid, {}) || {};
}
function setGoalDate(cid, sid, sectionId, date) {
  var all = Object.assign({}, getGoalDates(cid));
  var mine = Object.assign({}, all[sid] || {});
  if (date) mine[sectionId] = date;
  else delete mine[sectionId];
  all[sid] = mine;
  _cache.goalDates[cid] = all;
  _safeLSSet('gb-goal-dates-' + cid, JSON.stringify(all));
}
async function _loadGoalDates(cid) {
  if (!_useSupabase || !window.v2 || !window.v2.listCourseGoalDates) return;
  try {
    var res = await window.v2.listCourseGoalDates(cid);
    // A server without the read: the dates stay as this device saved them.
    if (!res || res.error) return;
    var data = _rpcObject(res.data !== undefined ? res.data : res) || {};
    _cache.goalDates[cid] = data;
    _safeLSSet('gb-goal-dates-' + cid, JSON.stringify(data));
  } catch (e) {
    console.warn('list_course_goal_dates failed for ' + cid + ':', e);
  }
}

/* Students' self-assessments of the Core Competencies, by reporting term:
   { sid: { termKey: { coreId: { level 1–4, text, goal, date } } } }.
   termKey is 'T' + the term's ordinal, or '' for a class without terms. The
   student's own words, entered by the teacher; never a teacher's grade. */
function getCoreSelf(cid) {
  if (_cache.coreSelf[cid] !== undefined) return _cache.coreSelf[cid];
  return _safeParseLS('gb-core-self-' + cid, {}) || {};
}
/* Saves one self-assessment (entry null, or with nothing in it, removes it). */
function saveCoreSelfAssessment(cid, sid, termKey, coreId, entry) {
  var level = entry && entry.level >= 1 && entry.level <= 4 ? Number(entry.level) : null;
  var text = entry && entry.text ? String(entry.text).trim() : '';
  var goal = entry && entry.goal ? String(entry.goal).trim() : '';
  var all = Object.assign({}, getCoreSelf(cid));
  var mine = Object.assign({}, all[sid] || {});
  var term = Object.assign({}, mine[termKey || ''] || {});
  if (level || text || goal) term[coreId] = { level: level, text: text, goal: goal, date: new Date().toISOString() };
  else delete term[coreId];
  mine[termKey || ''] = term;
  all[sid] = mine;
  _cache.coreSelf[cid] = all;
  _safeLSSet('gb-core-self-' + cid, JSON.stringify(all));
  if (_writesEnabled() && _isUuid(sid) && window.v2 && window.v2.saveCoreSelfAssessment) {
    window.v2.saveCoreSelfAssessment(sid, coreId, termKey || '', level, text, goal);
  }
}
async function _loadCoreSelf(cid) {
  if (!_useSupabase || !window.v2 || !window.v2.listCourseCoreSelfAssessments) return;
  try {
    var res = await window.v2.listCourseCoreSelfAssessments(cid);
    // A server without the read: what this device saved stays.
    if (!res || res.error) return;
    var data = _rpcObject(res.data !== undefined ? res.data : res) || {};
    _cache.coreSelf[cid] = data;
    _safeLSSet('gb-core-self-' + cid, JSON.stringify(data));
  } catch (e) {
    console.warn('list_course_core_self_assessments failed for ' + cid + ':', e);
  }
}

function getReflections(cid) {
  if (_cache.reflections[cid] !== undefined) return _cache.reflections[cid];
  try {
    return JSON.parse(localStorage.getItem('gb-reflections-' + cid)) || {};
  } catch (e) {
    console.warn('Reflections parse fallback:', e);
    return {};
  }
}
function saveReflections(cid, obj) {
  _saveCourseField('reflections', cid, obj);
}

/* ── Quick Observations — in-the-moment capture ─────────── */
function getQuickObs(cid) {
  if (_cache.observations[cid] !== undefined) return _cache.observations[cid];
  try {
    return JSON.parse(localStorage.getItem('gb-quick-obs-' + cid)) || {};
  } catch (e) {
    console.warn('Observations parse fallback:', e);
    return {};
  }
}
function saveQuickObs(cid, obj) {
  _saveCourseField('observations', cid, obj);
}

function getStudentQuickObs(cid, sid) {
  const all = getQuickObs(cid);
  return (all[sid] || []).sort((a, b) => (b.created || '').localeCompare(a.created || ''));
}

function getAllQuickObs(cid) {
  const all = getQuickObs(cid);
  const flat = [];
  for (const sid of Object.keys(all)) {
    (all[sid] || []).forEach(ob => flat.push({ ...ob, studentId: sid }));
  }
  return flat.sort((a, b) => (b.created || '').localeCompare(a.created || ''));
}

/* link: optional { competencyId, level } — one learning-map tag id and a
   1-4 level on it. */
/* templateId: the sentence starter it was written from, if any. */
function addQuickOb(cid, sid, text, dims, sentiment, context, assignmentContext, link, templateId) {
  const all = getQuickObs(cid);
  if (!all[sid]) all[sid] = [];
  const entry = {
    id: 'qo_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    text: text.trim(),
    dims: dims || [],
    created: new Date().toISOString(),
    date: getTodayStr(),
  };
  if (sentiment) entry.sentiment = sentiment;
  if (context) entry.context = context;
  if (assignmentContext) entry.assignmentContext = assignmentContext;
  if (link && link.competencyId) {
    entry.competencyId = link.competencyId;
    var level = _observationLevel(link.level);
    if (level) entry.level = level;
  }
  if (templateId) entry.templateId = templateId;
  all[sid].push(entry);
  _cache.observations[cid] = all;
  var lsOk = _safeLSSet('gb-quick-obs-' + cid, JSON.stringify(all));
  _markLocalWrite('observations', cid);
  if (_writesEnabled()) {
    _persistObservationCreate(cid, sid, entry);
  }
  if (templateId) noteObservationTemplateUse(templateId);
  _broadcastChange(cid, 'observations');
  return lsOk;
}

/* The current id of an observation a page may still hold by its local id
   (the create may have landed and re-keyed it since). */
function resolveObservationId(cid, id) {
  return _resolveKnownId('observation', id);
}

function deleteQuickOb(cid, sid, obId) {
  const all = getQuickObs(cid);
  if (!all[sid]) return;
  all[sid] = all[sid].filter(o => o.id !== obId);
  _cache.observations[cid] = all;
  _safeLSSet('gb-quick-obs-' + cid, JSON.stringify(all));
  _markLocalWrite('observations', cid);
  if (_writesEnabled()) {
    _persistObservationDelete(cid, obId);
  }
  _broadcastChange(cid, 'observations');
}

/* Delete every observation linked to an assessment via assignmentContext.
   Used by the assignment-delete UI flows in both page-assignments.js (full
   inline editor) and page-gradebook.js (context menu). Returns the number
   of removed observations.

   Why this exists: observations reference assessments through a JSON
   `assignmentContext` field (not a real FK), so DB-level FK cascade from
   `assessment` does not reach them. Without this helper, a deleted
   assessment leaves orphaned observation rows on the server with a stale
   assessmentId that reappear on reload (P6.5 audit, 2026-05-01). */
function deleteAssessmentObservations(cid, aid) {
  if (!cid || !aid) return 0;
  const all = getQuickObs(cid);
  const removedIds = [];
  let touched = false;
  Object.keys(all).forEach(function (sid) {
    const before = (all[sid] || []).length;
    all[sid] = (all[sid] || []).filter(function (o) {
      const matches = o && o.assignmentContext && o.assignmentContext.assessmentId === aid;
      if (matches && o.id) removedIds.push(o.id);
      return !matches;
    });
    if (all[sid].length !== before) touched = true;
  });
  if (!touched) return 0;
  // Persist the trimmed blob to LS + cache.
  saveQuickObs(cid, all);
  // Dispatch delete_observation for each removed observation that has a
  // canonical UUID. Locally-created observations not yet synced have local
  // string ids; _persistObservationDelete skips those.
  if (_writesEnabled()) {
    removedIds.forEach(function (obId) {
      _persistObservationDelete(cid, obId);
    });
  }
  return removedIds.length;
}

function updateQuickOb(cid, sid, obId, updates) {
  const all = getQuickObs(cid);
  if (!all[sid]) return false;
  const ob = all[sid].find(o => o.id === obId);
  if (!ob) return false;
  if (updates.text !== undefined) ob.text = updates.text.trim();
  if (updates.dims !== undefined) ob.dims = updates.dims;
  if (updates.sentiment !== undefined) ob.sentiment = updates.sentiment || null;
  // An observation from a reflection keeps that context for good: it is
  // what keeps the student's words out of every report (ruling 110,
  // isReflectionObservation in shared/constants.js). No screen can lift it.
  if (updates.context !== undefined && !isReflectionObservation(ob)) ob.context = updates.context || null;
  var competencyChanged = false;
  if (updates.competencyId !== undefined) {
    var nextComp = updates.competencyId || null;
    competencyChanged = nextComp !== (ob.competencyId || null);
    if (nextComp) ob.competencyId = nextComp;
    else delete ob.competencyId;
  }
  if (updates.level !== undefined) {
    var nextLevel = _observationLevel(updates.level);
    if (nextLevel) ob.level = nextLevel;
    else delete ob.level;
  }
  // A level belongs to a competency.
  if (!ob.competencyId) delete ob.level;
  ob.modified = new Date().toISOString();
  _cache.observations[cid] = all;
  var lsOk = _safeLSSet('gb-quick-obs-' + cid, JSON.stringify(all));
  _markLocalWrite('observations', cid);
  if (_writesEnabled()) {
    _persistObservationUpdate(cid, ob, { competencyChanged: competencyChanged });
  }
  _broadcastChange(cid, 'observations');
  return lsOk;
}

/* v2 create_observation(p_course_id, p_body, p_sentiment, p_context_type,
   p_assessment_id, p_enrollment_ids uuid[], p_tag_ids uuid[],
   p_custom_tag_ids uuid[], p_idempotency_key, p_dims text[],
   p_level smallint, p_template_id uuid) → uuid */
function _persistObservationCreate(cid, sid, entry) {
  if (!_isUuid(cid) || !_isSendableId(sid)) return;
  // The observation's own local id is re-keyed when the create lands, so an
  // edit or delete made before then waits for it instead of being dropped.
  var rec = _registerPendingCreate(cid, 'observation', entry.id, 'create_observation');
  var ctxAsmt =
    entry.assignmentContext && _isUuid(entry.assignmentContext.assessmentId)
      ? entry.assignmentContext.assessmentId
      : null;
  // entry.dims are string keys, not learning-map tag ids, so they go in
  // p_dims (observation.dims). The linked competency is a learning-map tag
  // and goes in p_tag_ids (observation_tag).
  var tagIds = _observationTagIds(entry.competencyId);
  var params = {
    p_course_id: cid,
    p_body: entry.text || '',
    p_sentiment: entry.sentiment || null,
    p_context_type: entry.context || null,
    p_assessment_id: ctxAsmt,
    p_enrollment_ids: [sid],
    p_tag_ids: tagIds,
    p_custom_tag_ids: [],
    p_dims: _observationDims(entry.dims),
    p_level: tagIds.length ? _observationLevel(entry.level) : null,
  };
  // The starter counts toward Times Used once it has a server id; one still
  // waiting for its own create is left out.
  var tplId = entry.templateId ? _resolveKnownId('observationTemplate', entry.templateId) : null;
  if (_isUuid(tplId)) params.p_template_id = tplId;
  _trackPendingSync(
    _writeRpc('create_observation', params, {
      retryKey: 'create_observation:' + entry.id,
      entryId: rec ? rec.entryId : undefined,
    }).then(function (res) {
      if (res.error) {
        if (res.error.handledSessionExpired || res.error.cancelled) return;
        console.warn('create_observation failed:', res.error);
        return;
      }
      if (rec) _onCreateLanded(rec.entryId, res.data);
    }),
  );
}

/* v2 update_observation(p_id, p_patch jsonb, p_enrollment_ids, p_tag_ids,
   p_custom_tag_ids). Null join-array params leave that set alone; empty
   array wipes it. Here we always pass null so we don't disturb membership
   unless the caller explicitly wants to. The dims and level always go in
   the patch, so removing the last tag clears them on the server too. The
   competency (p_tag_ids) is sent only when it changed, so a learning-map
   link made elsewhere is left alone otherwise. */
function _persistObservationUpdate(cid, ob, opts) {
  if (!_isSendableId(ob.id)) return;
  var tagIds = _observationTagIds(ob.competencyId);
  var patch = {
    body: ob.text || '',
    sentiment: ob.sentiment || null,
    context_type: ob.context || null,
    dims: _observationDims(ob.dims),
    level: tagIds.length ? _observationLevel(ob.level) : null,
  };
  if (ob.assignmentContext && _isUuid(ob.assignmentContext.assessmentId)) {
    patch.assessment_id = ob.assignmentContext.assessmentId;
  }
  _trackPendingSync(
    _writeRpc(
      'update_observation',
      {
        p_id: ob.id,
        p_patch: patch,
        p_enrollment_ids: null,
        p_tag_ids: opts && opts.competencyChanged ? tagIds : null,
        p_custom_tag_ids: null,
      },
      {
        retryKey: 'update_observation:' + ob.id,
      },
    ).then(function (res) {
      if (res.error && !res.error.handledSessionExpired) console.warn('update_observation failed:', res.error);
    }),
  );
}

/* v2 delete_observation(p_id). FK cascade handles observation_student /
   observation_tag / observation_custom_tag / term_rating_observation. */
function _persistObservationDelete(cid, obId) {
  if (!_isSendableId(obId)) return;
  var sb = getSupabase();
  if (!sb) return;
  _trackPendingSync(
    _writeRpc('delete_observation', { p_id: obId }).then(function (res) {
      if (res.error) console.warn('delete_observation failed:', res.error);
    }),
  );
}

/* ── Public v2 observation helpers (Phase 4.4) ─────────────────── */

/* Richer create that accepts multi-student targeting + tag + custom-tag
   membership, mirroring the Pass B §10.1 capture-bar payload. */
window.createObservationRich = function (params) {
  params = params || {};
  if (!_isUuid(params.courseId)) return Promise.resolve();
  return _trackPendingSync(
    _writeRpc(
      'create_observation',
      {
        p_course_id: params.courseId,
        p_body: params.body || '',
        p_sentiment: params.sentiment || null,
        p_context_type: params.contextType || null,
        p_assessment_id: _isUuid(params.assessmentId) ? params.assessmentId : null,
        p_enrollment_ids: (params.enrollmentIds || []).filter(_isUuid),
        p_tag_ids: (params.tagIds || []).filter(_isUuid),
        p_custom_tag_ids: (params.customTagIds || []).filter(_isUuid),
      },
      {
        retryKey:
          'create_observation:' +
          ((params.localId || params.body || '') + ':' + (params.enrollmentIds || []).join(',')),
      },
    ).then(function (res) {
      if (res.error && !res.error.handledSessionExpired) console.warn('create_observation failed:', res.error);
      return res;
    }),
  );
};

window.updateObservationRich = function (obId, patch, joins) {
  if (!_isUuid(obId)) return Promise.resolve();
  joins = joins || {};
  return _trackPendingSync(
    _writeRpc(
      'update_observation',
      {
        p_id: obId,
        p_patch: patch || {},
        p_enrollment_ids: joins.enrollmentIds ? joins.enrollmentIds.filter(_isUuid) : null,
        p_tag_ids: joins.tagIds ? joins.tagIds.filter(_isUuid) : null,
        p_custom_tag_ids: joins.customTagIds ? joins.customTagIds.filter(_isUuid) : null,
      },
      {
        retryKey: 'update_observation:' + obId,
      },
    ).then(function (res) {
      if (res.error && !res.error.handledSessionExpired) console.warn('update_observation failed:', res.error);
      return res;
    }),
  );
};

/* ── Sentence starters (observation_template) ─────────────────────────────
   The teacher's one list of starters, used in every class: the capture
   strip's "/" menu and "+ Starter" chip, the phone's quick menu, and My
   Sentence Starters (migrations/20261022_teacher_sentence_starters.sql). A
   row is { id, text, sentiment, context, dims, uses }; the list order is the
   order on My Sentence Starters, and the menus sort by uses (Times Used,
   every class). The list loads with any class bundle and saves like modules:
   it is diffed against the server baseline and each changed row goes out
   through the outbox. A new row has a local id ('ot…') until its upsert
   lands. It is kept under one scope, not a class: the cid arguments below
   are only for callers that still pass one. */
var _TEMPLATE_SENTIMENTS = { strength: true, growth: true, concern: true, note: true };
var _STARTER_SCOPE = 'teacher';

function _cleanObservationTemplate(row) {
  row = row || {};
  var dims = [];
  (Array.isArray(row.dims) ? row.dims : []).forEach(function (k) {
    if (k && typeof k === 'string' && dims.indexOf(k) < 0) dims.push(k);
  });
  return {
    id: row.id,
    text: String(row.text || '').trim(),
    sentiment: _TEMPLATE_SENTIMENTS[row.sentiment] ? row.sentiment : null,
    context: row.context || null,
    dims: dims,
    uses: Math.max(0, Number(row.uses) || 0),
  };
}

/* A class's custom tags ('tag:<label>') don't exist in the teacher's other
   classes, so a starter doesn't keep them. */
function _starterDims(dims) {
  return (dims || []).filter(function (k) {
    return !/^tag:/.test(k);
  });
}

function _observationTemplatesFromServer(rows) {
  return (rows || [])
    .filter(function (r) {
      return r && r.id;
    })
    .map(function (r) {
      return _cleanObservationTemplate({
        id: r.id,
        text: r.body,
        sentiment: r.default_sentiment,
        context: r.default_context_type,
        dims: r.default_dims,
        uses: r.use_count,
      });
    });
}

/* This device's list. Before starters belonged to the teacher, each class
   kept its own (gb-obs-templates-<cid>); the first read folds those into
   one, one row per wording, without custom tags. A signed-in teacher's list
   then comes from the server with the next class bundle. */
function _foldClassStarters() {
  var out = [];
  var seen = {};
  try {
    for (var i = 0; i < localStorage.length; i++) {
      var key = localStorage.key(i);
      if (!key || key.indexOf('gb-obs-templates-') !== 0 || key === 'gb-obs-templates-' + _STARTER_SCOPE) continue;
      (_safeParseLS(key, []) || []).forEach(function (t) {
        var norm = String((t && t.text) || '')
          .trim()
          .toLowerCase();
        if (!norm || seen[norm]) return;
        seen[norm] = true;
        out.push(_cleanObservationTemplate(Object.assign({}, t, { dims: _starterDims(t.dims) })));
      });
    }
  } catch (e) {
    /* storage unavailable: start empty */
  }
  return out;
}

function getObservationTemplates() {
  var scope = _STARTER_SCOPE;
  if (_cache.observationTemplates[scope] !== undefined) return _cache.observationTemplates[scope] || [];
  var list = _safeParseLS('gb-obs-templates-' + scope, null);
  if (!Array.isArray(list)) {
    list = _foldClassStarters();
    if (list.length) _safeLSSet('gb-obs-templates-' + scope, JSON.stringify(list));
  }
  _cache.observationTemplates[scope] = list;
  return list;
}

/* Returns false when this device's storage refused the list. */
function saveObservationTemplates(cid, arr) {
  var scope = _STARTER_SCOPE;
  arr = (arr || []).map(function (t) {
    return _cleanObservationTemplate(Object.assign({}, t, { dims: _starterDims(t && t.dims) }));
  });
  var prev = _loadPersistedCourseFieldSnapshot(
    'observationTemplates',
    scope,
    (_cache.observationTemplates && _cache.observationTemplates[scope]) || [],
  );
  var lsOk = _saveCourseField('observationTemplates', scope, arr);
  if (!_writesEnabled()) return lsOk;
  arr.forEach(function (t) {
    if (!t.id || _isUuid(t.id) || _resolveKnownId('observationTemplate', t.id) !== t.id) return;
    _registerPendingCreate(scope, 'observationTemplate', t.id, 'upsert_observation_template');
  });
  _persistObservationTemplatesToCanonical(scope, prev, arr);
  return lsOk;
}

/* An observation was written from this starter: count it here until the
   next bundle brings the server's count (observation.template_id). */
function noteObservationTemplateUse(id) {
  var list = getObservationTemplates();
  var i = _templateIndex(list, null, id);
  if (i < 0) return;
  list = list.slice();
  list[i] = Object.assign({}, list[i], { uses: (list[i].uses || 0) + 1 });
  _saveCourseField('observationTemplates', _STARTER_SCOPE, list);
  if (_hasServerState('observationTemplates', _STARTER_SCOPE)) {
    var base = _serverStateOr('observationTemplates', _STARTER_SCOPE, []).slice();
    var bi = _templateIndex(base, null, id);
    if (bi >= 0) base[bi] = Object.assign({}, base[bi], { uses: list[i].uses });
    _rememberServerState('observationTemplates', _STARTER_SCOPE, base);
  }
}

/* The menus' order: most used first, then the list order. */
function getObservationTemplatesByUse() {
  return getObservationTemplates()
    .map(function (t, i) {
      return { t: t, i: i };
    })
    .sort(function (a, b) {
      return (b.t.uses || 0) - (a.t.uses || 0) || a.i - b.i;
    })
    .map(function (x) {
      return x.t;
    });
}

var _templateSaveQueue = {};

function _observationTemplateChanged(before, after, beforeIdx, afterIdx) {
  return (
    (before.text || '') !== (after.text || '') ||
    (before.sentiment || null) !== (after.sentiment || null) ||
    (before.context || null) !== (after.context || null) ||
    JSON.stringify(before.dims || []) !== JSON.stringify(after.dims || []) ||
    beforeIdx !== afterIdx
  );
}

function _persistObservationTemplatesToCanonical(cid, prev, arr) {
  if (!getSupabase()) return;
  var tail = _templateSaveQueue[cid] || Promise.resolve();
  var next = tail.then(function () {
    var hasBaseline = _hasServerState('observationTemplates', cid);
    prev = _serverStateOr('observationTemplates', cid, prev) || [];
    arr = _cache.observationTemplates[cid] || arr;
    var prevIdx = {};
    prev.forEach(function (t, i) {
      if (t && t.id) prevIdx[_resolveKnownId('observationTemplate', t.id)] = i;
    });
    var kept = {};
    var ops = [];
    arr.forEach(function (t, idx) {
      if (!t || !t.id) return;
      var id = _resolveKnownId('observationTemplate', t.id);
      kept[id] = true;
      var pi = prevIdx[id];
      var p = pi != null ? prev[pi] : null;
      var rec = _isUuid(id)
        ? null
        : _registerPendingCreate(cid, 'observationTemplate', id, 'upsert_observation_template');
      var landedOrQueued = !rec || rec.queued;
      // Against a confirmed baseline, an unchanged starter needs no write.
      if (hasBaseline && p && landedOrQueued && !_observationTemplateChanged(p, t, pi, idx)) return;
      var payload = {
        id: id,
        body: t.text,
        defaultSentiment: t.sentiment,
        defaultContextType: t.context,
        defaultDims: t.dims || [],
        displayOrder: idx,
      };
      if (rec && !rec.queued) {
        // The create. Edits made before it lands go out as updates naming the
        // local id; they wait behind it and are re-keyed when it lands.
        payload.id = null;
        ops.push(
          window.upsertObservationTemplate(cid, payload, { entryId: rec.entryId }).then(function (res) {
            if (res && !res.error) _onCreateLanded(rec.entryId, res.data);
          }),
        );
      } else {
        ops.push(window.upsertObservationTemplate(cid, payload));
      }
    });
    prev.forEach(function (t) {
      if (!t || !t.id) return;
      var id = _resolveKnownId('observationTemplate', t.id);
      if (kept[id]) return;
      if (_isUuid(id)) {
        ops.push(window.deleteObservationTemplate(id));
        return;
      }
      var rec = _pendingCreateFor('observationTemplate', id);
      if (rec && rec.queued) ops.push(window.deleteObservationTemplate(id));
    });
    // A starter removed before its create was sent: nothing to undo on the
    // server, so forget its local id.
    var pending = _idmap()[cid] || {};
    Object.keys(pending).forEach(function (key) {
      var rec = pending[key];
      if (rec && rec.kind === 'observationTemplate' && !rec.queued && !kept[rec.localId]) _unregisterPendingCreate(rec);
    });
    _rememberServerState('observationTemplates', cid, arr);
    return Promise.all(ops).catch(function (err) {
      console.warn('Sentence starter sync failed for one or more rows:', err);
    });
  });
  _templateSaveQueue[cid] = _trackPendingSync(next);
  return _templateSaveQueue[cid];
}

function _newObservationTemplateId() {
  return 'ot' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/* Add starters at the end of the class's list. rows: [{ text, sentiment,
   context, dims }]. Returns the new rows, or null when storage refused. */
function addObservationTemplates(cid, rows) {
  var added = (rows || [])
    .map(function (r) {
      return _cleanObservationTemplate(Object.assign({}, r, { id: _newObservationTemplateId() }));
    })
    .filter(function (t) {
      return t.text;
    });
  if (!added.length) return [];
  var ok = saveObservationTemplates(cid, getObservationTemplates(cid).concat(added));
  return ok === false ? null : added;
}

function addObservationTemplate(cid, row) {
  var added = addObservationTemplates(cid, [row]);
  return added && added.length ? added[0] : null;
}

function _templateIndex(list, cid, id) {
  var want = _resolveKnownId('observationTemplate', id);
  for (var i = 0; i < list.length; i++) {
    if (list[i].id === id || list[i].id === want || _resolveKnownId('observationTemplate', list[i].id) === want)
      return i;
  }
  return -1;
}

function updateObservationTemplate(cid, id, patch) {
  var list = getObservationTemplates(cid).slice();
  var i = _templateIndex(list, cid, id);
  if (i < 0) return false;
  list[i] = _cleanObservationTemplate(Object.assign({}, list[i], patch || {}, { id: list[i].id }));
  return saveObservationTemplates(cid, list);
}

function removeObservationTemplate(cid, id) {
  var list = getObservationTemplates(cid).slice();
  var i = _templateIndex(list, cid, id);
  if (i < 0) return false;
  list.splice(i, 1);
  return saveObservationTemplates(cid, list);
}

/* dir -1 moves the starter up one place, +1 down. */
function moveObservationTemplate(cid, id, dir) {
  var list = getObservationTemplates(cid).slice();
  var i = _templateIndex(list, cid, id);
  var j = i + (dir < 0 ? -1 : 1);
  if (i < 0 || j < 0 || j >= list.length) return false;
  var t = list[i];
  list[i] = list[j];
  list[j] = t;
  return saveObservationTemplates(cid, list);
}

/* The current id of a starter a page may still hold by its local id. */
function resolveObservationTemplateId(cid, id) {
  return _resolveKnownId('observationTemplate', id);
}

/* The RPCs. p_default_dims null leaves a starter's tags alone on update. */
/* p_course_id is unused by the server since starters became the teacher's. */
window.upsertObservationTemplate = function (cid, payload, options) {
  var sb = getSupabase();
  if (!sb) return Promise.resolve();
  payload = payload || {};
  return _writeRpc(
    'upsert_observation_template',
    _stampIdempotencyKey('upsert_observation_template', {
      p_id: _isSendableId(payload.id) ? payload.id : null,
      p_course_id: _isUuid(cid) ? cid : null,
      p_body: payload.body || '',
      p_default_sentiment: payload.defaultSentiment || null,
      p_default_context_type: payload.defaultContextType || null,
      p_display_order: payload.displayOrder != null ? Number(payload.displayOrder) : null,
      p_default_dims: Array.isArray(payload.defaultDims) ? payload.defaultDims.slice() : null,
    }),
    options,
  ).then(function (res) {
    if (res && res.error && !res.error.handledSessionExpired)
      console.warn('upsert_observation_template failed:', res.error);
    return res;
  });
};

window.deleteObservationTemplate = function (tplId) {
  var sb = getSupabase();
  if (!sb) return Promise.resolve();
  if (!_isSendableId(tplId)) return Promise.resolve();
  return _writeRpc('delete_observation_template', { p_id: tplId }).then(function (res) {
    if (res && res.error && !res.error.handledSessionExpired)
      console.warn('delete_observation_template failed:', res.error);
    return res;
  });
};

/* ── v2 learning-map + structural helpers (Phase 4.5) ───────────────────
   Namespaced under window.v2 to avoid colliding with the existing
   blob-based local client functions (saveLearningMap, deleteRubric, etc.).
   New UI code calls v2.<name>() directly; the legacy blob save machinery
   stays as a localStorage cache until the UI is rewritten to drive these
   RPCs per-entity. */
window.v2 = window.v2 || {};

function _isSessionExpiredRpcError(err) {
  var status = Number(err && (err.status || err.statusCode || err.code || 0));
  if (status === 401) return true;
  var msg = '';
  if (err && err.message) msg += err.message + ' ';
  if (err && err.details) msg += err.details + ' ';
  if (err && err.hint) msg += err.hint + ' ';
  return /jwt.*expired|session.*expired|refresh.*token|not authenticated|unauthorized|invalid jwt|auth session missing|401/i.test(
    msg,
  );
}

function _handledSessionExpiredError(sourceError) {
  return {
    message: 'session_expired',
    status: 401,
    handledSessionExpired: true,
    sourceError: sourceError || null,
  };
}

function _buildLongFormRetryKey(name, options) {
  options = options || {};
  return options.retryKey || [name, options.retryId || ''].filter(Boolean).join(':');
}

/* A write from the outbox stays queued while the session is expired (the
   outbox pauses), so signing in again resumes the outbox rather than sending
   the write a second time beside it. */
function _queueLongFormSessionRetry(name, params, options, sourceError) {
  var ctx = getLongFormAuthContext();
  if (!ctx || !window.UI || typeof window.UI.queueSessionExpiredRetry !== 'function') {
    return Promise.resolve({ data: null, error: sourceError || null });
  }
  window.UI.queueSessionExpiredRetry({
    key: _buildLongFormRetryKey(name, options),
    getDraftText: ctx.getDraftText,
    retry: function () {
      var q = window.v2Queue;
      if (options && options.viaOutbox && q && typeof q.resume === 'function') {
        return q.resume().then(function () {
          return { data: null, error: null };
        });
      }
      return _callRpcWithAuthGuard(name, params, Object.assign({}, options, { suppressSessionExpiredModal: true }));
    },
  });
  return Promise.resolve({ data: null, error: _handledSessionExpiredError(sourceError) });
}

async function _callRpcWithAuthGuard(name, params, options) {
  options = options || {};
  var sb = getSupabase();
  if (!sb || _isDemoSession()) return { data: null, error: null };

  // Draft and Returned: no update_course carries the student page's switch
  // or Return Grades beside another setting, whoever queued it.
  params = _onlyOwnReturnSettings(name, params);
  // Class settings: a write from this build goes as it is; one a build from
  // before it queued (a device's whole copy) is checked against the server
  // first, and may be cut down or not sent at all.
  // Only the check of an old write waits (it reads the class): a write from
  // this build goes out in the same turn it always did.
  if (name === 'update_course') {
    var checked = _sendableCoursePatch(params, options);
    if (checked && typeof checked.then === 'function') checked = await checked;
    if (checked.answer) return checked.answer;
    params = checked.params;
  }

  // A list of categories that waited in the outbox is sent only over the
  // list it was made for, or not at all.
  if (name === 'save_categories') {
    var guarded = _guardCategorySave(params, options);
    if (guarded) {
      guarded = await guarded;
      if (guarded && guarded.answer) return guarded.answer;
    }
  }

  // Before either retry below can fire, so every attempt at this write carries
  // the same key and the server returns the first result instead of inserting
  // a second row.
  _stampIdempotencyKey(name, params);

  if (!options.suppressSessionExpiredModal && consumeLongFormSessionExpired()) {
    return _queueLongFormSessionRetry(name, params, options, { message: 'idle_timeout', status: 401 });
  }

  async function execRpc() {
    try {
      return await sb.rpc(name, params);
    } catch (err) {
      return { data: null, error: err };
    }
  }

  var res = await execRpc();
  if (res && res.error && _isSessionExpiredRpcError(res.error)) {
    var refreshed = false;
    if (typeof refreshSupabaseSession === 'function') {
      try {
        var refreshedSession = await refreshSupabaseSession();
        refreshed = !!(refreshedSession && refreshedSession.session);
      } catch (e) {
        refreshed = false;
      }
    }
    if (refreshed) {
      res = await execRpc();
    }
    if (res && res.error && _isSessionExpiredRpcError(res.error)) {
      if (!options.suppressSessionExpiredModal && isLongFormAuthContextActive()) {
        return _queueLongFormSessionRetry(name, params, options, res.error);
      }
      if (typeof showSessionExpiredToast === 'function') showSessionExpiredToast();
    }
  }
  if (res && !res.error && typeof options.onSuccess === 'function') {
    options.onSuccess(res);
  }
  return res;
}

/* A write RPC the server doesn't have means a migration never reached
   production, and every call to it is silently lost. Report it once per name
   so it shows up in Sentry instead of hiding. */
var _reportedMissingRpcs = {};
function _reportMissingRpc(name, error) {
  if (_reportedMissingRpcs[name]) return;
  _reportedMissingRpcs[name] = true;
  console.error('Server is missing RPC ' + name + ' — this write was not saved:', error);
  if (window.Sentry && typeof window.Sentry.captureMessage === 'function') {
    window.Sentry.captureMessage('Missing RPC: ' + name, 'error');
  }
}

function _isReadRpc(name) {
  return /^(get|list)_/i.test(name || '');
}

/* Can writes be queued? True when signed in to Supabase, including while
   cloud sync is paused (degraded): those writes wait in the outbox and go out
   on recovery. False in demo mode and local-only dev. */
function _writesEnabled() {
  return (_useSupabase || _supabaseDegraded) && localStorage.getItem('gb-demo-mode') !== '1';
}

/* Demo Mode stays on this computer: no RPC reaches Supabase and nothing
   waits in the outbox. The anon client still exists there, so a
   getSupabase() check alone lets calls through (and they fail as anon). */
function _isDemoSession() {
  return typeof isDemoMode === 'function' && isDemoMode();
}

var _outboxConfigured = false;
var _outboxUnsubscribe = null;
function _outbox() {
  var q = window.v2Queue;
  if (!q || typeof q.push !== 'function') return null;
  if (!_outboxConfigured) {
    _outboxConfigured = true;
    q.configure({
      send: function (name, params, options) {
        if (!getSupabase()) return { data: null, error: { message: 'no_supabase' } };
        return _callRpcWithAuthGuard(name, params, Object.assign({}, options, { viaOutbox: true }));
      },
      isPaused: function () {
        return _supabaseDegraded;
      },
      onSend: _noteOutboxSend,
    });
    // Creates are re-keyed from the outbox's own events, so a create that
    // lands after a reload (no .then waiting for it) still re-keys.
    if (typeof _outboxUnsubscribe === 'function') _outboxUnsubscribe();
    _outboxUnsubscribe = typeof q.subscribe === 'function' ? q.subscribe(_onOutboxEvent) : null;
    if (typeof q.has === 'function') _prunePendingCreates(q);
  }
  return q;
}

/* Every write RPC goes through here and on to the outbox
   (shared/offline-queue.js), which keeps writes to one record in order and
   retries network failures until the server accepts them. Resolves with the
   final { data, error }. Without the outbox (unit tests that don't load it)
   the write is sent directly.

   options.entryId names the outbox entry (a pending create's record uses
   it; for idempotent endpoints it is the idempotency key too). A payload
   naming a local id whose create is still queued is held behind that
   create and re-keyed when it lands; without the outbox such a write has
   nothing to wait in, so it is dropped with a warning.

   Every entry remembers the baseline row its write was diffed against, so
   a rejection can put it back (_baselineUndo). A write the outbox refuses
   (full) resolves { error: { refused } } and counts in _writeRefusals. */
function _writeRpc(name, params, options) {
  if (_isDemoSession()) return Promise.resolve({ data: null, error: null });
  params = params || {};
  options = options || {};
  if (options.entryId && typeof FV_IDEMPOTENT_RPCS !== 'undefined' && FV_IDEMPOTENT_RPCS[name]) {
    params.p_idempotency_key = options.entryId;
  }
  _stampIdempotencyKey(name, params);
  _applyKnownRekeys(name, params);
  var blockedOn = _blockedLocalIds(name, params);
  var outbox = _outbox();
  if (outbox) {
    var entryId = options.entryId || params.p_idempotency_key || _idempotencyKey() || uid();
    var undo = _snapshotBaselineRow(name, params);
    var pushed = outbox.push(name, params, {
      id: entryId,
      key: options.key,
      blockedOn: blockedOn,
      sendOptions: options,
      guard: options.guard,
    });
    if (pushed && pushed.refused) {
      _onWriteRefused(name, params, undo, pushed.refused, options.entryId);
      return pushed;
    }
    if (_outboxRefused) {
      _outboxRefused = false;
      _saveProblemChanged();
    }
    // A cell write that replaced a queued one already holds the older row.
    if (undo && !_baselineUndo[entryId]) _baselineUndo[entryId] = undo;
    if (options.entryId) _markPendingQueued(options.entryId);
    return pushed;
  }
  if (blockedOn.length) {
    console.warn(name + ' not sent: waits on a record with no server id yet (' + blockedOn.join(', ') + ')');
    return Promise.resolve({ data: null, error: { message: 'blocked on local id', blocked: true } });
  }
  var sb = getSupabase();
  if (!sb) return Promise.resolve({ data: null, error: null });
  if (options.entryId) _markPendingQueued(options.entryId);
  return _callRpcWithAuthGuard(name, params, options);
}

function _rpcOrNoop(name, params, options) {
  var sb = getSupabase();
  if (!sb || _isDemoSession()) return Promise.resolve({ data: null, error: null });
  var call = _isReadRpc(name) ? _callRpcWithAuthGuard(name, params, options) : _writeRpc(name, params, options);
  return _trackWriteSync(
    name,
    call.then(function (res) {
      if (res.error && !res.error.handledSessionExpired) {
        if (_isMissingRpcError(res.error)) _reportMissingRpc(name, res.error);
        else console.warn(name + ' failed:', res.error);
      }
      return res;
    }),
  );
}

/* Subject: upsert (p_id null for new), delete, reorder. */
window.v2.upsertSubject = function (params, options) {
  params = params || {};
  return _rpcOrNoop(
    'upsert_subject',
    {
      p_id: _isUuid(params.id) ? params.id : null,
      p_course_id: params.courseId,
      p_name: params.name || '',
      p_color: params.color || null,
      p_display_order: params.displayOrder != null ? Number(params.displayOrder) : null,
    },
    options,
  );
};
window.v2.deleteSubject = function (id) {
  return _rpcOrNoop('delete_subject', { p_id: id });
};
window.v2.reorderSubjects = function (ids) {
  return _rpcOrNoop('reorder_subjects', { p_ids: (ids || []).filter(_isUuid) });
};

/* CompetencyGroup. */
window.v2.upsertCompetencyGroup = function (params, options) {
  params = params || {};
  return _rpcOrNoop(
    'upsert_competency_group',
    {
      p_id: _isUuid(params.id) ? params.id : null,
      p_course_id: params.courseId,
      p_name: params.name || '',
      p_color: params.color || null,
      p_display_order: params.displayOrder != null ? Number(params.displayOrder) : null,
      // Null keeps the folder's saved value.
      p_counts_as_one: typeof params.countsAsOne === 'boolean' ? params.countsAsOne : null,
    },
    options,
  );
};
window.v2.deleteCompetencyGroup = function (id) {
  return _rpcOrNoop('delete_competency_group', { p_id: id });
};
window.v2.reorderCompetencyGroups = function (ids) {
  return _rpcOrNoop('reorder_competency_groups', { p_ids: (ids || []).filter(_isUuid) });
};

/* Section — course_id is auto-inferred from the owning subject. */
window.v2.upsertSection = function (params, options) {
  params = params || {};
  return _rpcOrNoop(
    'upsert_section',
    {
      p_id: _isUuid(params.id) ? params.id : null,
      p_subject_id: params.subjectId,
      p_name: params.name || '',
      p_color: params.color || null,
      p_competency_group_id: _isSendableId(params.competencyGroupId) ? params.competencyGroupId : null,
      p_display_order: params.displayOrder != null ? Number(params.displayOrder) : null,
    },
    options,
  );
};
window.v2.deleteSection = function (id) {
  return _rpcOrNoop('delete_section', { p_id: id });
};
/* Remove a competency from a class but keep its scores (section.removed_at),
   put one back, and list the removed ones (migrations/20261022_soft_remove_competency.sql). */
window.v2.removeSection = function (id) {
  return _rpcOrNoop('remove_section', { p_id: id });
};
window.v2.restoreSection = function (id) {
  return _rpcOrNoop('restore_section', { p_id: id });
};
window.v2.listRemovedSections = function (courseId) {
  if (!_isUuid(courseId)) return Promise.resolve({ data: null, error: null });
  return _rpcOrNoop('list_removed_sections', { p_course_id: courseId });
};
window.v2.reorderSections = function (ids) {
  return _rpcOrNoop('reorder_sections', { p_ids: (ids || []).filter(_isUuid) });
};

/* Tag. */
window.v2.upsertTag = function (params, options) {
  params = params || {};
  return _rpcOrNoop(
    'upsert_tag',
    {
      p_id: _isUuid(params.id) ? params.id : null,
      p_section_id: params.sectionId,
      p_label: params.label || '',
      p_code: params.code || null,
      p_i_can_text: params.iCanText || null,
      p_display_order: params.displayOrder != null ? Number(params.displayOrder) : null,
      p_i_can_statements: Array.isArray(params.iCanStatements) ? params.iCanStatements : null,
      p_source_text: params.sourceText || null,
      p_bank_id: params.bankId || null,
    },
    options,
  );
};
window.v2.deleteTag = function (id) {
  return _rpcOrNoop('delete_tag', { p_id: id });
};
window.v2.reorderTags = function (ids) {
  return _rpcOrNoop('reorder_tags', { p_ids: (ids || []).filter(_isUuid) });
};

/* Module. */
window.v2.upsertModule = function (params, options) {
  params = params || {};
  return _rpcOrNoop(
    'upsert_module',
    {
      p_id: _isUuid(params.id) ? params.id : null,
      p_course_id: params.courseId,
      p_name: params.name || '',
      p_color: params.color || null,
      p_display_order: params.displayOrder != null ? Number(params.displayOrder) : null,
    },
    options,
  );
};
window.v2.deleteModule = function (id) {
  return _rpcOrNoop('delete_module', { p_id: id });
};
window.v2.reorderModules = function (ids) {
  return _rpcOrNoop('reorder_modules', { p_ids: (ids || []).filter(_isUuid) });
};

/* Category — assessment weighting bucket. Weights must total 100; the
   server checks at commit, so save the whole list with saveCategories.
   upsertCategory is kept for renames that leave weights alone. */
window.v2.upsertCategory = function (params) {
  params = params || {};
  return _rpcOrNoop('upsert_category', {
    p_id: _isUuid(params.id) ? params.id : null,
    p_course_id: params.courseId,
    p_name: params.name || '',
    p_weight: params.weight != null ? Number(params.weight) : 0,
    p_display_order: params.displayOrder != null ? Number(params.displayOrder) : null,
  });
};
window.v2.deleteCategory = function (id) {
  return _rpcOrNoop('delete_category', { p_id: id });
};
window.v2.listCategories = function (courseId) {
  return _rpcOrNoop('list_categories', { p_course_id: courseId });
};
/* The copies of one assessment across the teacher's live classes:
   [{ assessment_id, course_id, course_name, title }]. */
window.v2.listAssessmentCopies = function (copyGroup) {
  if (!_isUuid(copyGroup)) return Promise.resolve({ data: [], error: null });
  return _rpcOrNoop('list_assessment_copies', { p_copy_group: copyGroup });
};
window.v2.reorderCategories = function (ids) {
  return _rpcOrNoop('reorder_categories', { p_ids: (ids || []).filter(_isUuid) });
};
/* rows: [{ id?, name, weight }] in display order. Rows without a uuid are
   created; the class's other categories are deleted. Resolves with the ids
   in the same order. */
window.v2.saveCategories = function (courseId, rows, options) {
  return _rpcOrNoop('save_categories', _saveCategoriesParams(courseId, rows), options);
};
function _saveCategoriesParams(courseId, rows) {
  return {
    p_course_id: courseId,
    p_categories: (rows || []).map(function (r) {
      var row = {
        name: (r.name || '').trim(),
        weight: r.weight != null ? Number(r.weight) : 0,
        calc_mode: categoryCalcMode(r),
      };
      if (_isUuid(r.id)) row.id = r.id;
      return row;
    }),
  };
}

/* Rubric — composite save: rubric row + criteria diff + criterion_tag replace
   + criterion_check replace, all in one transaction.  criteria payload:
     [{ id?: uuid, name, level_{1..4}_descriptor, level_{1..4}_value?,
        weight?, display_order?, linked_tag_ids?: uuid[],
        checks?: [{ id?: uuid, level 1..4, label, display_order }] }, …]
   Criteria present in the array are upserted; criteria absent are deleted
   (cascades criterion_tag, criterion_check + rubric_score). A criterion's
   checks are replaced the same way (migrations/20261022_advanced_rubric_checks.sql). */
window.v2.upsertRubric = function (params, options) {
  params = params || {};
  var criteria = (params.criteria || []).map(function (c) {
    var payload = {
      name: c.name || '',
      level_4_descriptor: c.level4Descriptor || null,
      level_3_descriptor: c.level3Descriptor || null,
      level_2_descriptor: c.level2Descriptor || null,
      level_1_descriptor: c.level1Descriptor || null,
      weight: c.weight != null ? Number(c.weight) : 1.0,
      display_order: c.displayOrder != null ? Number(c.displayOrder) : 0,
      linked_tag_ids: (c.linkedTagIds || []).filter(_isUuid),
      checks: (c.checks || []).map(function (check) {
        var row = {
          level: Number(check.level),
          label: check.label == null ? '' : String(check.label),
          display_order: check.displayOrder != null ? Number(check.displayOrder) : 0,
        };
        if (_isUuid(check.id)) row.id = check.id;
        return row;
      }),
    };
    if (c.level4Value != null) payload.level_4_value = Number(c.level4Value);
    if (c.level3Value != null) payload.level_3_value = Number(c.level3Value);
    if (c.level2Value != null) payload.level_2_value = Number(c.level2Value);
    if (c.level1Value != null) payload.level_1_value = Number(c.level1Value);
    if (_isUuid(c.id)) payload.id = c.id;
    return payload;
  });
  return _rpcOrNoop(
    'upsert_rubric',
    {
      p_id: _isUuid(params.id) ? params.id : null,
      p_course_id: params.courseId,
      p_name: params.name || '',
      p_criteria: criteria,
      p_copy_group: _isUuid(params.copyGroup) ? params.copyGroup : null,
      p_style: rubricStyle({ style: params.style }),
      // The competencies the whole rubric scores; [] clears them, null keeps them.
      p_linked_tag_ids: Array.isArray(params.linkedTagIds) ? params.linkedTagIds.filter(_isUuid) : null,
    },
    options,
  );
};
window.v2.listRubricCopies = function (copyGroup) {
  if (!_isUuid(copyGroup)) return Promise.resolve({ data: [], error: null });
  return _rpcOrNoop('list_rubric_copies', { p_copy_group: copyGroup });
};
window.v2.deleteRubric = function (id) {
  return _rpcOrNoop('delete_rubric', { p_id: id });
};

/* ── v2 student-profile read + student-record writes ─────────────────────
   Reader: get_student_profile(p_enrollment_id) returns enrollment + student +
   course rows, overall proficiency, letter grade, status counts, notes /
   goals / reflections, and a competency_tree (subjects → sections → tags
   with per-section proficiency and per-tag latest_value + coverage_count). */
window.v2.getStudentProfile = function (enrollmentId) {
  // Demo Mode and not-yet-saved students have local ids the server can't read.
  if (!_isUuid(enrollmentId)) return Promise.resolve({ data: null, error: null });
  return _rpcOrNoop('get_student_profile', { p_enrollment_id: enrollmentId });
};

window.v2.listCourseStudentProfiles = function (courseId) {
  return _rpcOrNoop('list_course_student_profiles', { p_course_id: courseId });
};

/* Notes: immutable add + delete (per ERD). Note body cannot be edited;
   corrections mean delete + add. */
window.v2.addNote = function (enrollmentId, body) {
  return _rpcOrNoop('upsert_note', {
    p_enrollment_id: enrollmentId,
    p_body: body || '',
  });
};
window.v2.deleteNote = function (noteId) {
  return _rpcOrNoop('delete_note', { p_id: noteId });
};

/* Goal: one per (enrollment, section). Upsert replaces body. */
window.v2.saveGoal = function (enrollmentId, sectionId, body) {
  return _rpcOrNoop('upsert_goal', {
    p_enrollment_id: enrollmentId,
    p_section_id: sectionId,
    p_body: body || '',
  });
};

/* When each goal in a class was last saved: {enrollment_id: {section_id: ISO}}. */
window.v2.listCourseGoalDates = function (courseId) {
  return _rpcOrNoop('list_course_goal_dates', { p_course_id: courseId });
};

/* Attendance totals to date on each report (term_rating.absences / lates). */
window.v2.listCourseTermAttendance = function (courseId) {
  return _rpcOrNoop('list_course_term_attendance', { p_course_id: courseId });
};
window.v2.saveTermAttendance = function (enrollmentId, term, absences, lates) {
  return _rpcOrNoop('save_term_attendance', {
    p_enrollment_id: enrollmentId,
    p_term: term,
    p_absences: absences,
    p_lates: lates,
  });
};

/* Core Competency self-assessments: one per (enrollment, competency, term). */
window.v2.listCourseCoreSelfAssessments = function (courseId) {
  return _rpcOrNoop('list_course_core_self_assessments', { p_course_id: courseId });
};
window.v2.saveCoreSelfAssessment = function (enrollmentId, coreId, termKey, level, text, goal) {
  return _rpcOrNoop('upsert_core_self_assessment', {
    p_enrollment_id: enrollmentId,
    p_core_id: coreId,
    p_term_key: termKey || '',
    p_level: level != null ? Number(level) : null,
    p_body: text || null,
    p_goal: goal || null,
  });
};

/* Reflection: one per (enrollment, section). confidence ∈ 1..5 or null. */
window.v2.saveReflection = function (enrollmentId, sectionId, body, confidence) {
  return _rpcOrNoop('upsert_reflection', {
    p_enrollment_id: enrollmentId,
    p_section_id: sectionId,
    p_body: body || '',
    p_confidence: confidence != null ? Number(confidence) : null,
  });
};

/* SectionOverride: teacher-judgment level override per (enrollment, section).
   level ∈ 1..4; reason is optional free text. */
window.v2.saveSectionOverride = function (enrollmentId, sectionId, level, reason) {
  return _rpcOrNoop('upsert_section_override', {
    p_enrollment_id: enrollmentId,
    p_section_id: sectionId,
    p_level: Number(level),
    p_reason: reason || null,
  });
};
window.v2.clearSectionOverride = function (enrollmentId, sectionId) {
  return _rpcOrNoop('clear_section_override', {
    p_enrollment_id: enrollmentId,
    p_section_id: sectionId,
  });
};

/* Bulk attendance: apply one status to many students on one date. Status is
   free text (matches client "Present"/"Absent"/"Late" convention). */
window.v2.bulkAttendance = function (enrollmentIds, date, status) {
  return _rpcOrNoop('bulk_attendance', {
    p_enrollment_ids: (enrollmentIds || []).filter(_isUuid),
    p_date: date,
    p_status: status || '',
  });
};

/* ── v2 term rating composite save (Phase 4.7) ──────────────────────────
   Mirrors the §13 capture form: one RPC saves the TermRating row plus all
   five dependent sets (dimensions, strength/growth tag memberships,
   assessment mentions, observation mentions), with per-field audit rows
   written inside the same transaction (Q28).

   payload (camelCase client → snake_case wire): any key may be omitted to
   leave that field / set alone. Passing empty [] for a set wipes it.
     narrativeHtml        → narrative_html
     workHabitsRating     → work_habits_rating    (1..4 or null)
     participationRating  → participation_rating  (1..4 or null)
     socialTraits         → social_traits         (string[])
     dimensions           → dimensions: [{ sectionId, rating 1..4 }]
     strengthTagIds       → strength_tags[]
     growthTagIds         → growth_tags[]
     mentionAssessmentIds → mention_assessments[]
     mentionObservationIds→ mention_observations[] */
/* ── v2 ReportConfig + TeacherPreference (Phase 4.8 + 1.11 wire-up) ──── */

window.v2.applyReportPreset = function (courseId, preset) {
  return _rpcOrNoop('apply_report_preset', {
    p_course_id: courseId,
    p_preset: preset, // 'brief' | 'standard' | 'detailed'
  });
};

/* Full replace. If blocks_config diverges from a named preset's defaults,
   pass p_preset='custom' (or leave preset null — RPC defaults to 'custom'). */
window.v2.saveReportConfig = function (courseId, blocksConfig, preset) {
  return _rpcOrNoop('save_report_config', {
    p_course_id: courseId,
    p_blocks_config: blocksConfig || {},
    p_preset: preset || null,
  });
};

/* Flip a single block; server auto-sets preset='custom'. */
window.v2.toggleReportBlock = function (courseId, blockKey, enabled) {
  return _rpcOrNoop('toggle_report_block', {
    p_course_id: courseId,
    p_block_key: blockKey,
    p_enabled: !!enabled,
  });
};

/* ── Report forms: the library, issued copies and guardians ─────────────
   migrations/20261020_report_template.sql, 20261020_report_issue.sql,
   20261020_guardian.sql; docs/report-forms-plan.md. Every write is
   idempotent (shared/constants.js FV_IDEMPOTENT_RPCS). The library and
   Issue Reports still keep their device copies (gb-report-templates,
   IndexedDB fv-report-issues); these are the server calls they move to. */

/* A list read's { data, error }: data is the rows, or null when nothing was
   read (Demo Mode, signed out, or an error), so a caller keeps its device
   copy rather than mistaking "no server" for "no rows". */
function _listResult(res) {
  var error = (res && res.error) || null;
  var data = res && res.data != null && !error ? _rpcRows(res.data) : null;
  return { data: data, error: error };
}

/* A saved form: { id?, name, form }. Same name (case-insensitive) updates
   that row; an id renames. Resolves with the row as the server has it. */
window.v2.saveReportTemplate = function (params, options) {
  params = params || {};
  return _rpcOrNoop(
    'save_report_template',
    {
      p_name: String(params.name == null ? '' : params.name).trim(),
      p_form: params.form && typeof params.form === 'object' ? params.form : {},
      p_id: _isUuid(params.id) ? params.id : null,
    },
    options,
  );
};
/* A withdrawn student's scores and observations from the server, for the
   copy offered before a permanent delete. Read-only; null in Demo Mode. */
window.v2.getWithdrawnStudentRecords = function (enrollmentId) {
  if (!_isUuid(enrollmentId)) return Promise.resolve({ data: null, error: null });
  return _rpcOrNoop('get_withdrawn_student_records', { p_enrollment_id: enrollmentId });
};
window.v2.listReportTemplates = function () {
  return _rpcOrNoop('list_report_templates', {}).then(_listResult);
};
window.v2.deleteReportTemplate = function (id) {
  if (!_isUuid(id)) return Promise.resolve({ data: null, error: null });
  return _rpcOrNoop('delete_report_template', { p_id: id });
};

/* ── The personal comment bank (migrations/20261031_comment_template.sql) ──
   A teacher's own comment sentences, kept from "Suggested for Your Bank"
   (teacher/comment-personal.js, plan PR 10). Saves and deletes go through
   the outbox with an idempotency key; the list is one small read on the
   Term Questionnaire. In Demo Mode, signed out, offline or before the
   table exists, the list comes back null and the device copy stands. */
window.v2.saveCommentTemplate = function (params, options) {
  params = params || {};
  return _rpcOrNoop(
    'save_comment_template',
    {
      p_text: String(params.text == null ? '' : params.text).trim(),
      p_slots: Array.isArray(params.slots) ? params.slots : [],
      p_condition: params.condition && typeof params.condition === 'object' ? params.condition : {},
      p_id: _isUuid(params.id) ? params.id : null,
      p_uses: params.uses != null && Number(params.uses) >= 0 ? Math.floor(Number(params.uses)) : null,
    },
    options,
  );
};
window.v2.listCommentTemplates = function () {
  return _rpcOrNoop('list_comment_templates', {}).then(_listResult);
};
window.v2.deleteCommentTemplate = function (id) {
  if (!_isUuid(id)) return Promise.resolve({ data: null, error: null });
  return _rpcOrNoop('delete_comment_template', { p_id: id });
};

/* One Issue: { courseId, term, termLabel, paper, form, students } where
   students is [{ enrollmentId, sheets, hash, html }]. The HTML of a whole
   class can run past the outbox's 5 MB cap, so this goes straight to the
   server rather than through the queue; the Issue dialog reports a failure
   and keeps its own copy. Only students with a server id are sent. */
window.v2.createReportIssue = function (params) {
  params = params || {};
  var students = (params.students || [])
    .filter(function (s) {
      return s && _isUuid(s.enrollmentId);
    })
    .map(function (s) {
      return {
        enrollment_id: s.enrollmentId,
        sheets: Math.max(1, Math.min(20, Number(s.sheets) || 1)),
        hash: String(s.hash == null ? '' : s.hash),
        html: String(s.html == null ? '' : s.html),
      };
    });
  var rpcParams = {
    p_course_id: params.courseId,
    p_term: Number(params.term) || 1,
    p_term_label: params.termLabel || null,
    p_paper: params.paper === 'legal' ? 'legal' : 'letter',
    p_form: params.form && typeof params.form === 'object' ? params.form : null,
    p_students: students,
  };
  if (!_isUuid(params.courseId) || !students.length) {
    return Promise.resolve({ data: null, error: { message: 'nothing to issue', blocked: true } });
  }
  var sb = getSupabase();
  if (!sb || _isDemoSession()) return Promise.resolve({ data: null, error: null });
  _stampIdempotencyKey('create_report_issue', rpcParams);
  return _trackWriteSync(
    'create_report_issue',
    _callRpcWithAuthGuard('create_report_issue', rpcParams).then(function (res) {
      if (res && res.error && !res.error.handledSessionExpired) {
        if (_isMissingRpcError(res.error)) _reportMissingRpc('create_report_issue', res.error);
        else console.warn('create_report_issue failed:', res.error);
      }
      return { data: _rpcObject(res && res.data), error: (res && res.error) || null };
    }),
  );
};
/* Issues for a class (one term, or every term when term is null), newest
   first, each with hashes { enrollmentId: hash } and no HTML. */
window.v2.listReportIssues = function (courseId, term) {
  var params = { p_course_id: courseId };
  if (term != null) params.p_term = Number(term);
  return _rpcOrNoop('list_report_issues', params).then(_listResult);
};
/* One issue with every student's HTML, in roster order. */
window.v2.getReportIssue = function (issueId) {
  return _rpcOrNoop('get_report_issue', { p_issue_id: issueId }).then(function (res) {
    return { data: _rpcObject(res && res.data), error: (res && res.error) || null };
  });
};
window.v2.deleteReportIssue = function (issueId) {
  if (!_isUuid(issueId)) return Promise.resolve({ data: null, error: null });
  return _rpcOrNoop('delete_report_issue', { p_issue_id: issueId });
};

/* A guardian: { id?, studentId, name, relationship, email, phone, language,
   consentAt, consentSource }. Consent is sent only when both consentAt and
   consentSource are given; the server refuses one without the other.
   The Students tab stores parent emails here; nothing sends to them until
   the district's position on teacher-to-family email is known. */
window.v2.upsertGuardian = function (params, options) {
  params = params || {};
  var consent = params.consentAt && params.consentSource;
  return _rpcOrNoop(
    'upsert_guardian',
    {
      p_student_id: params.studentId,
      p_name: String(params.name == null ? '' : params.name).trim(),
      p_relationship: params.relationship || null,
      p_email: params.email || null,
      p_phone: params.phone || null,
      p_language: params.language || 'en',
      p_consent_at: consent ? params.consentAt : null,
      p_consent_source: consent ? params.consentSource : null,
      p_id: _isUuid(params.id) ? params.id : null,
    },
    options,
  );
};
window.v2.deleteGuardian = function (id) {
  if (!_isUuid(id)) return Promise.resolve({ data: null, error: null });
  return _rpcOrNoop('delete_guardian', { p_id: id });
};
/* Every guardian of every enrolled student, each row carrying enrollment_id. */
window.v2.listCourseGuardians = function (courseId) {
  return _rpcOrNoop('list_course_guardians', { p_course_id: courseId }).then(_listResult);
};

/* ── Student questionnaires ─────────────────────────────────────────────
   migrations/20261025_questionnaires_tables_and_functions.sql;
   docs/STUDENT-VOICE-PLAN.md. Reads return { data, error } with data null
   when nothing was read (Demo Mode, signed out, an error). */
window.v2.listQuestionnaireTemplates = function () {
  return _rpcOrNoop('list_questionnaire_templates', {}).then(_listResult);
};
window.v2.listCourseQuestionnaires = function (courseId) {
  if (!_isUuid(courseId)) return Promise.resolve({ data: null, error: null });
  return _rpcOrNoop('list_course_questionnaires', { p_course_id: courseId }).then(_listResult);
};
/* { questionnaire_id: { enrollment_id: [{ id, submitted_at, via, answers }] } } */
window.v2.listCourseResponses = function (courseId) {
  if (!_isUuid(courseId)) return Promise.resolve({ data: null, error: null });
  return _rpcOrNoop('list_course_responses', { p_course_id: courseId }).then(function (res) {
    var error = (res && res.error) || null;
    return { data: res && res.data && !error ? res.data : null, error: error };
  });
};
/* A questionnaire: { id?, courseId, kind, title, templateId, theme,
   reportPeriod, parentId, opensOn, closesOn, isOn, myedComment, questions }.
   questions is the whole list in order, or null to keep them (or, for a new
   one from a template, to copy the template's). */
window.v2.upsertQuestionnaire = function (params, options) {
  params = params || {};
  return _rpcOrNoop(
    'upsert_questionnaire',
    {
      p_course_id: params.courseId,
      p_kind: params.kind,
      p_title: String(params.title == null ? '' : params.title).trim(),
      p_template_id: params.templateId || null,
      p_theme: params.theme || null,
      p_report_period: params.reportPeriod == null ? null : Number(params.reportPeriod),
      p_parent_id: _isUuid(params.parentId) ? params.parentId : null,
      p_opens_on: params.opensOn || null,
      p_closes_on: params.closesOn || null,
      p_is_on: params.isOn !== false,
      p_myed_comment: params.myedComment || null,
      p_questions: Array.isArray(params.questions) ? params.questions : null,
      p_id: _isUuid(params.id) ? params.id : null,
    },
    options,
  );
};
window.v2.setQuestionnaireOn = function (id, isOn) {
  if (!_isUuid(id)) return Promise.resolve({ data: null, error: null });
  return _rpcOrNoop('set_questionnaire_on', { p_id: id, p_is_on: !!isOn });
};
window.v2.deleteQuestionnaire = function (id) {
  if (!_isUuid(id)) return Promise.resolve({ data: null, error: null });
  return _rpcOrNoop('delete_questionnaire', { p_id: id });
};
/* New slip codes: [{ enrollment_id, code }], every enrolled student when
   enrollmentIds is empty. Online only and never through the outbox: the
   plain codes come back once and a replay returns none, so a failed call is
   simply issued again. */
window.v2.issueAccessCodes = function (questionnaireId, enrollmentIds) {
  if (!_isUuid(questionnaireId)) return Promise.resolve({ data: null, error: null });
  var sb = getSupabase();
  if (!sb || _isDemoSession()) return Promise.resolve({ data: null, error: null });
  var ids = (enrollmentIds || []).filter(_isUuid);
  var rpcParams = { p_questionnaire_id: questionnaireId, p_enrollment_ids: ids.length ? ids : null };
  _stampIdempotencyKey('issue_access_codes', rpcParams);
  return _trackWriteSync(
    'issue_access_codes',
    _callRpcWithAuthGuard('issue_access_codes', rpcParams).then(function (res) {
      if (res.error && !res.error.handledSessionExpired) console.warn('issue_access_codes failed:', res.error);
      var rows = res && Array.isArray(res.data) ? res.data : null;
      return { data: rows, error: res.error || null };
    }),
  );
};

/* Reports on students' phones (migrations/20261025_phone_reports.sql).
   Every write is online only and never queued: the teacher is waiting on
   the result (the new report, the slip codes), and a failed call is simply
   made again. Each carries an idempotency key. */
function _phoneReportCall(name, params, shape) {
  var sb = getSupabase();
  if (!sb || _isDemoSession()) return Promise.resolve({ data: null, error: null });
  _stampIdempotencyKey(name, params);
  return _trackWriteSync(
    name,
    _callRpcWithAuthGuard(name, params).then(function (res) {
      if (res.error && !res.error.handledSessionExpired) console.warn(name + ' failed:', res.error);
      return { data: res && !res.error ? shape(res.data) : null, error: res.error || null };
    }),
  );
}
function _phoneReportObject(d) {
  return d && typeof d === 'object' && !Array.isArray(d) ? d : null;
}
/* students: [{ enrollment_id, data }] */
window.v2.createPhoneReport = function (courseId, term, termLabel, expiresOn, students) {
  if (!_isUuid(courseId)) return Promise.resolve({ data: null, error: null });
  return _phoneReportCall(
    'create_phone_report',
    {
      p_course_id: courseId,
      p_term: term,
      p_term_label: termLabel || null,
      p_expires_on: expiresOn,
      p_students: (students || []).filter(function (s) {
        return _isUuid(s.enrollment_id);
      }),
    },
    _phoneReportObject,
  );
};
window.v2.updatePhoneReport = function (reportId, students, expiresOn) {
  if (!_isUuid(reportId)) return Promise.resolve({ data: null, error: null });
  return _phoneReportCall(
    'update_phone_report',
    {
      p_id: reportId,
      p_students: (students || []).filter(function (s) {
        return _isUuid(s.enrollment_id);
      }),
      p_expires_on: expiresOn || null,
    },
    _phoneReportObject,
  );
};
window.v2.closePhoneReport = function (reportId) {
  if (!_isUuid(reportId)) return Promise.resolve({ data: null, error: null });
  return _phoneReportCall('close_phone_report', { p_id: reportId }, _phoneReportObject);
};
/* [{ enrollment_id, code }]: the plain codes come back once. */
window.v2.issueReportCodes = function (reportId, enrollmentIds) {
  if (!_isUuid(reportId)) return Promise.resolve({ data: null, error: null });
  var ids = (enrollmentIds || []).filter(_isUuid);
  return _phoneReportCall(
    'issue_report_codes',
    { p_report_id: reportId, p_enrollment_ids: ids.length ? ids : null },
    function (d) {
      return Array.isArray(d) ? d : null;
    },
  );
};
window.v2.listPhoneReports = function (courseId) {
  if (!_isUuid(courseId)) return Promise.resolve({ data: null, error: null });
  return _rpcOrNoop('list_phone_reports', { p_course_id: courseId }).then(_listResult);
};

/* Teacher preferences — jsonb patch; omitted keys unchanged. */
window.v2.saveTeacherPreferences = function (patch) {
  return _rpcOrNoop('save_teacher_preferences', { p_patch: patch || {} });
};

/* Soft-delete / restore for account-level lifecycle (Pass C §5). */
window.v2.softDeleteTeacher = function () {
  return _rpcOrNoop('soft_delete_teacher', {});
};
window.v2.restoreTeacher = function () {
  return _rpcOrNoop('restore_teacher', {});
};

/* ── v2 Imports (Phase 4.9) ───────────────────────────────────────────
   Three flows share this surface; each returns per-section row counts. */

/* CSV roster — alias the Phase 4.1 helper under v2 for naming consistency. */
window.v2.importRosterCsv = function (courseId, rows) {
  return _rpcOrNoop('import_roster_csv', {
    p_course_id: courseId,
    p_rows: rows || [],
  });
};

/* JSON full-data restore (§15.3). Replays every entity in FK-safe
   topological order; UPSERT semantics mean re-importing the same payload
   is idempotent. Payload sections are all optional:
     courses, report_configs, subjects, competency_groups, sections, tags,
     modules, rubrics, criteria, criterion_tags, students, enrollments,
     assessments, assessment_tags, scores, rubric_scores, tag_scores,
     notes, goals, reflections.
   Returns per-section row counts. */
window.v2.importJsonRestore = function (payload) {
  return _rpcOrNoop('import_json_restore', { p_payload: payload || {} });
};

/* ── v2 read RPCs from Phase 5.4 ──────────────────────────────────────── */

window.v2.getLearningMap = function (courseId) {
  return _rpcOrNoop('get_learning_map', { p_course_id: courseId });
};

window.v2.getObservations = function (courseId, opts) {
  opts = opts || {};
  return _rpcOrNoop('get_observations', {
    p_course_id: courseId,
    p_filters: opts.filters || {},
    p_page: opts.page || 1,
    p_page_size: opts.pageSize || 50,
  });
};

window.v2.getAssessmentDetail = function (assessmentId) {
  return _rpcOrNoop('get_assessment_detail', { p_assessment_id: assessmentId });
};

/* ── Withdrawn students (docs/DECISIONS.md: "Students are removed by
   withdrawal, not deletion") ─────────────────────────────────────────────
   Removing a student from a class withdraws them. On the server the
   enrollment keeps every score, observation and report and only gets
   withdrawn_at (withdraw_student); get_class_bundle leaves it out of the
   roster, scores and profiles and lists it under withdrawn_students.

   On this device the student leaves the roster and every per-student
   record moves out of the class's maps into their entry here, so nothing
   that reads the roster or the maps (grades, class averages, the
   dashboard, observations, the phone app, reports) can see them.
   Re-enrol puts it all back. In Demo Mode this list is the only copy.

   _cache.withdrawn[cid] = [{ student, withdrawnAt, index, records }]
     student   the roster row, as it was
     index     where it sat in the roster, so re-enrol puts it back there
     records   { scores, goals, reflections, notes, flags, observations,
                 termRatings, overrides, studentProfileSummaries } values
               for this student, and statuses { 'sid:aid': status }.
               Missing after a reload that came from the server: the
               server still has them, and the refresh that follows a
               re-enrol brings them back.

   Permanent delete (delete_withdrawn_student) is the second step and only
   takes a withdrawn student. */
var _WITHDRAWN_RECORD_FIELDS = {
  scores: getScores,
  goals: getGoals,
  reflections: getReflections,
  notes: getNotes,
  flags: getFlags,
  observations: getQuickObs,
  termRatings: getTermRatings,
  overrides: getOverrides,
  studentProfileSummaries: getStudentProfileSummaries,
};

function getWithdrawnStudents(cid) {
  if (_cache.withdrawn[cid] !== undefined) return _cache.withdrawn[cid];
  var list = _safeParseLS('gb-withdrawn-' + cid, []);
  return Array.isArray(list) ? list : [];
}

function _saveWithdrawn(cid, list) {
  _saveCourseField('withdrawn', cid, list);
}

function _withdrawnIds(cid) {
  var ids = {};
  getWithdrawnStudents(cid).forEach(function (w) {
    if (w && w.student && w.student.id) ids[w.student.id] = true;
  });
  return ids;
}

/* Take one student's records out of the class's maps and return them.
   Local copy and the server baselines only: nothing is sent. Dropping the
   baselines keeps a later save from clearing their scores on the server. */
function _takeStudentRecords(cid, sid) {
  var records = {};
  Object.keys(_WITHDRAWN_RECORD_FIELDS).forEach(function (field) {
    var all = _WITHDRAWN_RECORD_FIELDS[field](cid) || {};
    if (all[sid] === undefined) return;
    records[field] = _cloneValue(all[sid]);
    delete all[sid];
    _saveCourseField(field, cid, all);
  });
  var statuses = getAssignmentStatuses(cid) || {};
  var taken = {};
  Object.keys(statuses).forEach(function (key) {
    if (key.indexOf(sid + ':') !== 0) return;
    taken[key] = statuses[key];
    delete statuses[key];
  });
  if (Object.keys(taken).length) {
    records.statuses = taken;
    _saveCourseField('statuses', cid, statuses);
  }
  forgetStudentServerState(cid, sid);
  return records;
}

/* Put records back. A value the class already has (a refresh brought it
   from the server) wins over the saved copy. The server has these rows,
   so the baselines get them too. */
function _putStudentRecords(cid, sid, records) {
  records = records || {};
  Object.keys(_WITHDRAWN_RECORD_FIELDS).forEach(function (field) {
    if (records[field] === undefined) return;
    var all = _WITHDRAWN_RECORD_FIELDS[field](cid) || {};
    if (all[sid] !== undefined) return;
    all[sid] = records[field];
    _saveCourseField(field, cid, all);
  });
  if (records.statuses) {
    var statuses = getAssignmentStatuses(cid) || {};
    Object.keys(records.statuses).forEach(function (key) {
      if (statuses[key] === undefined) statuses[key] = records.statuses[key];
    });
    _saveCourseField('statuses', cid, statuses);
  }
  var baseScores = _serverStateOr('scores', cid, null);
  if (baseScores && records.scores && records.scores.length && !baseScores[sid]) {
    baseScores[sid] = _cloneValue(records.scores);
  }
  var baseNotes = _serverStateOr('notes', cid, null);
  if (baseNotes && records.notes !== undefined && baseNotes[sid] === undefined) {
    baseNotes[sid] = _cloneValue(records.notes);
  }
  var baseStatuses = _serverStateOr('statuses', cid, null);
  if (baseStatuses && records.statuses) {
    Object.keys(records.statuses).forEach(function (key) {
      if (baseStatuses[key] === undefined) baseStatuses[key] = records.statuses[key];
    });
  }
}

/* The id a write about this student can carry: the server's, or a local
   one whose enrol is queued (the write waits behind it). Null when the
   student was never sent (a class not on the server yet). */
function _studentWriteId(cid, sid) {
  if (_isUuid(sid)) return sid;
  var known = _resolveKnownId('student', sid);
  if (_isUuid(known)) return known;
  return _isPendingLocalId(sid) ? sid : null;
}

/* Withdraw: the remove action in Class Settings. Returns the entry (for
   Undo), or null when the student isn't on the roster. */
function withdrawStudent(cid, sid) {
  var students = getStudents(cid);
  var index = students.findIndex(function (s) {
    return s && s.id === sid;
  });
  if (index < 0) return null;
  var student = students[index];
  var records = _takeStudentRecords(cid, sid);
  _saveCourseField(
    'students',
    cid,
    students.filter(function (s) {
      return s && s.id !== sid;
    }),
  );
  var entry = { student: student, withdrawnAt: new Date().toISOString(), index: index, records: records };
  var list = getWithdrawnStudents(cid).filter(function (w) {
    return w && w.student && w.student.id !== sid;
  });
  list.unshift(entry);
  _saveWithdrawn(cid, list);

  var writeId = _writesEnabled() && _isUuid(cid) ? _studentWriteId(cid, sid) : null;
  if (writeId) _rpcOrNoop('withdraw_student', { p_enrollment_id: writeId });
  return entry;
}

/* Re-enrol a withdrawn student: back on the roster where they were, with
   everything they had. Returns false when they aren't in the list. */
function reenrolStudent(cid, sid) {
  var list = getWithdrawnStudents(cid);
  var entry = list.find(function (w) {
    return w && w.student && w.student.id === sid;
  });
  if (!entry) return false;
  _saveWithdrawn(
    cid,
    list.filter(function (w) {
      return w !== entry;
    }),
  );
  var student = Object.assign({}, entry.student);
  var students = getStudents(cid).filter(function (s) {
    return s && s.id !== sid;
  });
  var at = entry.index >= 0 && entry.index <= students.length ? entry.index : students.length;
  students.splice(at, 0, student);
  _putStudentRecords(cid, sid, entry.records);

  var live = _writesEnabled() && _isUuid(cid);
  var writeId = live ? _studentWriteId(cid, sid) : null;
  if (live && !writeId) {
    // Never reached the server: the roster save enrols them now.
    saveStudents(cid, students);
    saveScores(cid, getScores(cid));
    return true;
  }
  _saveCourseField('students', cid, students);
  var baseStudents = _serverStateOr('students', cid, null);
  if (writeId && Array.isArray(baseStudents) && !baseStudents.some(s => s && s.id === sid)) {
    baseStudents.splice(Math.min(at, baseStudents.length), 0, _cloneValue(student));
  }
  if (writeId) _rpcOrNoop('reenrol_student', { p_enrollment_id: writeId });
  return true;
}

/* The second step: delete a withdrawn student for good, with every score,
   observation and report they had in this class. The person goes too
   when this was their only class. Cannot be undone. */
function deleteWithdrawnStudent(cid, sid) {
  var list = getWithdrawnStudents(cid);
  var entry = list.find(function (w) {
    return w && w.student && w.student.id === sid;
  });
  if (!entry) return false;
  _saveWithdrawn(
    cid,
    list.filter(function (w) {
      return w !== entry;
    }),
  );
  // Pairs, groups and exclusions live on the assessment rows, which the
  // delete doesn't reach.
  var assessments = getAssessments(cid);
  var named = l => Array.isArray(l) && l.some(item => (Array.isArray(item) ? item : [item]).includes(sid));
  var changed = false;
  assessments.forEach(function (a) {
    if (!named(a.excludedStudents) && !named(a.pairs) && !named(a.groups) && !named(a.gradedSeparately)) return;
    changed = true;
    if (a.excludedStudents) {
      a.excludedStudents = a.excludedStudents.filter(id => id !== sid);
      if (a.excludedStudents.length === 0) delete a.excludedStudents;
    }
    if (a.pairs) {
      a.pairs = a.pairs.map(p => p.filter(id => id !== sid)).filter(p => p.length > 0);
      if (a.pairs.length === 0) delete a.pairs;
    }
    if (a.groups) {
      a.groups = a.groups.map(g => g.filter(id => id !== sid)).filter(g => g.length > 0);
      if (a.groups.length === 0) delete a.groups;
    }
    if (a.gradedSeparately) {
      a.gradedSeparately = a.gradedSeparately.filter(id => id !== sid);
      if (a.gradedSeparately.length === 0) delete a.gradedSeparately;
    }
  });
  if (changed) saveAssessments(cid, assessments);
  _dropGradeReturnsOf(cid, sid);

  if (!_writesEnabled() || !_isUuid(cid)) return true;
  // An enrol still queued is simply not sent (with the withdraw behind it).
  var target = _isUuid(sid) ? sid : _cancelPendingCreateOrResolve(cid, 'student', sid);
  if (target) _rpcOrNoop('delete_withdrawn_student', { p_enrollment_id: target });
  return true;
}

/* get_class_bundle's withdrawn_students. The server's list wins; an entry
   this device already had keeps its records and roster index. A student
   withdrawn before they ever reached the server stays as it is. */
function _applyBundleWithdrawn(cid, rows) {
  if (!Array.isArray(rows)) return;
  var at = {};
  rows.forEach(function (r) {
    if (r && r.enrollment_id) at[r.enrollment_id] = r.withdrawn_at || null;
  });
  var saved = _safeParseLS('gb-withdrawn-' + cid, null);
  var local = Array.isArray(saved) ? saved : getWithdrawnStudents(cid);
  var localById = {};
  local.forEach(function (w) {
    if (w && w.student && w.student.id) localById[w.student.id] = w;
  });
  var list = _canonicalRosterRowsToStudents(rows)
    .map(function (student) {
      var prev = localById[student.id];
      var entry = { student: migrateStudent(student), withdrawnAt: at[student.id], index: student.rosterPosition };
      if (prev) {
        if (prev.index != null) entry.index = prev.index;
        if (prev.records) entry.records = prev.records;
      }
      return entry;
    })
    .sort(function (a, b) {
      return String(b.withdrawnAt || '').localeCompare(String(a.withdrawnAt || ''));
    });
  local.forEach(function (w) {
    if (w && w.student && !_isUuid(w.student.id)) list.push(w);
  });
  _persistLoadedField(cid, 'withdrawn', list);
}

/* A withdrawn student leaves the server baselines as well as the local
   copy: withdraw_student keeps their rows on the server, so a later roster
   or score save must not withdraw the enrollment again or clear their
   scores. */
function forgetStudentServerState(cid, sid) {
  if (Array.isArray(_serverStateOr('students', cid, null))) {
    _serverState.students[cid] = _serverState.students[cid].filter(function (s) {
      return !s || s.id !== sid;
    });
  }
  ['scores', 'notes'].forEach(function (field) {
    var base = _serverStateOr(field, cid, null);
    if (base) delete base[sid];
  });
  var statuses = _serverStateOr('statuses', cid, null);
  if (statuses) {
    Object.keys(statuses).forEach(function (key) {
      if (key.indexOf(sid + ':') === 0) delete statuses[key];
    });
  }
}

/* Clients before withdrawal held a student's hard delete (delete_student)
   in the outbox until its Undo toast closed. That RPC is gone
   (20261020_drop_old_student_delete), so one still waiting from that client
   is dropped: the student stays on the roster, and withdrawing them is the
   way to remove them now. Left alone it would wait forever and keep the
   outbox busy. */
function dropHeldStudentDeletes() {
  var q = window.v2Queue;
  if (!q || typeof q.dropBlockedOn !== 'function') return;
  q.dropBlockedOn('undo-window');
}

/* ── v2 write RPCs from Phase 5.5 ─────────────────────────────────────── */

window.v2.saveTermRating = function (enrollmentId, term, payload) {
  payload = payload || {};
  var wire = {};
  if ('narrativeHtml' in payload) wire.narrative_html = payload.narrativeHtml;
  if ('workHabitsRating' in payload) wire.work_habits_rating = payload.workHabitsRating;
  if ('participationRating' in payload) wire.participation_rating = payload.participationRating;
  if ('socialTraits' in payload) wire.social_traits = payload.socialTraits || [];
  if (payload.habits && typeof payload.habits === 'object') wire.habits = _habitsWire(payload.habits);
  if ('approved' in payload) wire.approved = !!payload.approved;
  // What the report prints for the grade, and the IE's deadline
  // (20261031_term_rating_reporting_basis). A server without the columns
  // ignores both keys.
  if ('reportingBasis' in payload) wire.reporting_basis = payload.reportingBasis || 'grade';
  if ('ieDeadline' in payload) wire.ie_deadline = payload.ieDeadline || null;
  // What an approved comment was built from (20261031_term_rating_draft_meta),
  // for the marks-changed check. A server without the column ignores it.
  if ('draftMeta' in payload) {
    wire.draft_meta = payload.draftMeta && typeof payload.draftMeta === 'object' ? payload.draftMeta : null;
  }
  if (Array.isArray(payload.dimensions)) {
    wire.dimensions = payload.dimensions.map(function (d) {
      return { section_id: d.sectionId, rating: Number(d.rating) };
    });
  }
  if (Array.isArray(payload.strengthTagIds)) {
    wire.strength_tags = payload.strengthTagIds.filter(_isUuid);
  }
  if (Array.isArray(payload.growthTagIds)) {
    wire.growth_tags = payload.growthTagIds.filter(_isUuid);
  }
  if (Array.isArray(payload.mentionAssessmentIds)) {
    wire.mention_assessments = payload.mentionAssessmentIds.filter(_isUuid);
  }
  if (Array.isArray(payload.mentionObservationIds)) {
    wire.mention_observations = payload.mentionObservationIds.filter(_isUuid);
  }
  return _trackPendingSync(
    _writeRpc(
      'save_term_rating',
      {
        p_enrollment_id: enrollmentId,
        p_term: Number(term),
        p_payload: wire,
      },
      {
        retryKey: 'save_term_rating:' + enrollmentId + ':' + Number(term),
      },
    ).then(function (res) {
      if (res.error && !res.error.handledSessionExpired) console.warn('save_term_rating failed:', res.error);
      return res;
    }),
  );
};

/* Custom tag direct RPC wrappers. Used by addCustomTag/removeCustomTag-driven
   flows via _persistCustomTagsToCanonical, and exposed for direct callers. */
window.createCustomTag = function (cid, label) {
  var sb = getSupabase();
  if (!sb) return Promise.resolve();
  if (!_isUuid(cid)) return Promise.resolve();
  return _writeRpc(
    'create_custom_tag',
    _stampIdempotencyKey('create_custom_tag', { p_course_id: cid, p_label: label || '' }),
  ).then(function (res) {
    if (res.error) console.warn('create_custom_tag failed:', res.error);
    var id = res && res.data;
    if (id && label) {
      if (!_customTagIds[cid]) _customTagIds[cid] = {};
      _customTagIds[cid][label] = id;
    }
    return res;
  });
};

window.v2 = window.v2 || {};

function getQuickObsByDim(cid, sid, dim) {
  return getStudentQuickObs(cid, sid).filter(o => (o.dims || []).includes(dim));
}

function getAssignmentObs(cid, sid, assessId) {
  return getStudentQuickObs(cid, sid).filter(o => o.assignmentContext && o.assignmentContext.assessmentId === assessId);
}
function getStudentAssignmentFeedback(cid, sid) {
  return getStudentQuickObs(cid, sid).filter(o => !!o.assignmentContext);
}
function hasAssignmentFeedback(cid, sid, assessId) {
  return getAssignmentObs(cid, sid, assessId).length > 0;
}

/* ── Custom Tags — user-defined observation tags ─────────── */
function getCustomTags(cid) {
  if (_cache.customTags[cid] !== undefined) return _cache.customTags[cid];
  try {
    return JSON.parse(localStorage.getItem('gb-custom-tags-' + cid)) || [];
  } catch (e) {
    console.warn('CustomTags parse fallback:', e);
    return [];
  }
}
var _customTagSaveQueue = {};
/* Per-course label→uuid cache, populated from create_custom_tag responses.
   Lets removeCustomTag dispatch a delete_custom_tag(p_id) for tags created
   in the current session. Tags that pre-existed (loaded from server) won't
   have an entry here; those fall through to delete_custom_tag_by_label. */
var _customTagIds = {};

function saveCustomTags(cid, arr) {
  var prev = _loadPersistedCourseFieldSnapshot('customTags', cid, (_cache.customTags && _cache.customTags[cid]) || []);
  _saveCourseField('customTags', cid, arr);
  if (!_writesEnabled() || !_isUuid(cid)) return;
  if (!arr) return;
  _persistCustomTagsToCanonical(cid, prev, arr);
}

function _persistCustomTagsToCanonical(cid, prev, arr) {
  var sb = getSupabase();
  if (!sb) return;
  var tail = _customTagSaveQueue[cid] || Promise.resolve();
  var next = tail.then(function () {
    prev = _serverStateOr('customTags', cid, prev);
    arr = _cache.customTags[cid] || arr;
    _rememberServerState('customTags', cid, arr);
    var prevSet = {};
    (prev || []).forEach(function (l) {
      prevSet[l] = true;
    });
    var nextSet = {};
    (arr || []).forEach(function (l) {
      nextSet[l] = true;
    });
    var ops = [];
    // Adds — labels in next that weren't in prev.
    (arr || []).forEach(function (label) {
      if (!label || prevSet[label]) return;
      ops.push(
        _writeRpc('create_custom_tag', _stampIdempotencyKey('create_custom_tag', { p_course_id: cid, p_label: label }))
          .then(function (res) {
            if (res.error) {
              console.warn('create_custom_tag failed:', res.error);
              return;
            }
            // Cache the canonical uuid so a later remove can dispatch a
            // by-id delete rather than the label-fallback variant.
            var id = res && res.data;
            if (id) {
              if (!_customTagIds[cid]) _customTagIds[cid] = {};
              _customTagIds[cid][label] = id;
            }
          })
          .catch(function (err) {
            console.warn('Custom tag sync failed for label', label, ':', err);
          }),
      );
    });
    // Deletes — labels in prev that aren't in next.
    (prev || []).forEach(function (label) {
      if (!label || nextSet[label]) return;
      var knownId = _customTagIds[cid] && _customTagIds[cid][label];
      if (knownId && _isUuid(knownId)) {
        ops.push(
          _writeRpc('delete_custom_tag', { p_id: knownId })
            .then(function (res) {
              if (res.error) console.warn('delete_custom_tag failed:', res.error);
              else if (_customTagIds[cid]) delete _customTagIds[cid][label];
            })
            .catch(function (err) {
              console.warn('Custom tag delete sync failed for label', label, ':', err);
            }),
        );
      } else {
        // Cross-session delete: uuid not cached locally. Use the label
        // fallback so the canonical row is still removed.
        ops.push(
          _writeRpc('delete_custom_tag_by_label', { p_course_id: cid, p_label: label })
            .then(function (res) {
              if (res.error) console.warn('delete_custom_tag_by_label failed:', res.error);
            })
            .catch(function (err) {
              console.warn('Custom tag label-delete sync failed for label', label, ':', err);
            }),
        );
      }
    });
    return Promise.all(ops);
  });
  _customTagSaveQueue[cid] = _trackPendingSync(next);
  return _customTagSaveQueue[cid];
}
function addCustomTag(cid, label) {
  const tags = getCustomTags(cid);
  const norm = label.trim();
  if (!norm || tags.includes(norm)) return norm;
  tags.push(norm);
  tags.sort((a, b) => a.localeCompare(b));
  saveCustomTags(cid, tags);
  return norm;
}
function removeCustomTag(cid, label) {
  saveCustomTags(
    cid,
    getCustomTags(cid).filter(t => t !== label),
  );
}

/* ── Tag resolver — unified display info for any tag type ── */
function resolveTag(tagStr) {
  if (tagStr.startsWith('cc:')) {
    const cc = getCoreCompetency(tagStr.slice(3));
    if (cc) return { key: tagStr, label: cc.label, group: cc.group, color: cc.color, type: 'cc' };
    return { key: tagStr, label: tagStr.slice(3), group: '', color: 'var(--text-3)', type: 'cc' };
  }
  if (tagStr.startsWith('tag:')) {
    return { key: tagStr, label: tagStr.slice(4), group: 'Custom', color: '#8b5cf6', type: 'custom' };
  }
  if (OBS_LABELS[tagStr]) {
    return { key: tagStr, label: OBS_LABELS[tagStr], color: 'var(--text-2)', type: 'dim' };
  }
  return { key: tagStr, label: tagStr, group: '', color: 'var(--text-3)', type: 'unknown' };
}

/* ── Term Ratings — end-of-term learner profile ─────────── */
function getTermRatings(cid) {
  if (_cache.termRatings[cid] !== undefined) return _cache.termRatings[cid];
  try {
    return JSON.parse(localStorage.getItem('gb-term-ratings-' + cid)) || {};
  } catch (e) {
    console.warn('TermRatings parse fallback:', e);
    return {};
  }
}
function saveTermRatings(cid, obj) {
  _saveCourseField('termRatings', cid, obj);
}

function getStudentTermRating(cid, sid, termId) {
  const all = getTermRatings(cid);
  return (all[sid] && all[sid][termId]) || null;
}

/* A changed comment needs a new approval: the server clears approved_at when
   narrative_html changes without an `approved` key, and this copy does the
   same. */
function upsertTermRating(cid, sid, termId, data) {
  const all = getTermRatings(cid);
  if (!all[sid]) all[sid] = {};
  const now = new Date().toISOString();
  const prev = all[sid][termId];
  if (prev && 'narrative' in data && !('approvedAt' in data) && (data.narrative || '') !== (prev.narrative || '')) {
    data = Object.assign({}, data, { approvedAt: null });
  }
  if (prev) {
    Object.assign(prev, data);
    prev.modified = now;
  } else {
    all[sid][termId] = {
      narrative: '',
      created: now,
      modified: now,
      ...data,
    };
  }
  saveTermRatings(cid, all);
  // v2 save_term_rating(p_enrollment_id, p_term, p_payload). In v2 mode
  // `sid` IS the enrollment_id (see _canonicalRosterRowsToStudents); the
  // window.v2.saveTermRating helper handles the camelCase → snake_case
  // payload translation.
  if (_writesEnabled() && _isSendableId(sid) && window.v2 && window.v2.saveTermRating) {
    var t = _termNumber(termId);
    var payload = _termRatingPatch(data);
    if (t >= 1 && t <= 6 && Object.keys(payload).length > 0) window.v2.saveTermRating(sid, t, payload);
  }
}

/* ── Attendance on the Term Questionnaire ──────────────────
   Teachers take attendance in MyEd BC (or on paper), so FullVision keeps
   only what the report card prints: at each report, the classes absent and
   times late so far this year, copied from MyEd. Every report's numbers are
   totals to date; "this term" is worked out against the last report that
   has them, so no teacher subtracts (Colin, 2026-10-24). */
function _attendanceCount(v) {
  if (v === '' || v == null) return null;
  // A whole number from 0 to 200 only: a decimal is never rounded, and a
  // number no class could have (99999999, 1e+21) is never kept or printed.
  var n = typeof v === 'number' ? v : /^\s*\d+\s*$/.test(String(v)) ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 0 && n <= 200 ? n : null;
}

/* Saves one report's totals to date; null (or '') clears a number. */
function saveTermAttendance(cid, sid, termId, absences, lates) {
  var a = _attendanceCount(absences);
  var l = _attendanceCount(lates);
  upsertTermRating(cid, sid, termId, { absences: a, lates: l });
  if (_writesEnabled() && _isSendableId(sid) && window.v2 && window.v2.saveTermAttendance) {
    var t = _termNumber(termId);
    if (t >= 1 && t <= 6) window.v2.saveTermAttendance(sid, t, a, l);
  }
}

/* A report's attendance: its totals to date, the last earlier report's
   totals (each number from the latest earlier report that has it), and
   the change since then. With no earlier report, this term's change is
   the total itself. When there is an earlier report (a reporting term
   before this one, or with none set, Report 2 or later) but its number is
   blank, this term's share is unknown: that ThisTerm is null and
   termUnknown is true, so the report states the year total (Colin,
   2026-11-03). Nulls where nothing is entered. */
function getTermAttendance(cid, sid, termId) {
  var mine = (getTermRatings(cid) || {})[sid] || {};
  var n = _termNumber(termId);
  var terms = getReportingTerms(cid);
  var hadReport = terms.length
    ? terms.some(function (t) {
        return t.ordinal < n;
      })
    : n > 1;
  var cur = mine[termId] || {};
  var earlier = Object.keys(mine)
    .filter(function (k) {
      return _termNumber(k) < n;
    })
    .sort(function (x, y) {
      return _termNumber(y) - _termNumber(x);
    });
  var out = { absences: _attendanceCount(cur.absences), lates: _attendanceCount(cur.lates), termUnknown: false };
  ['absences', 'lates'].forEach(function (f) {
    var prevKey = earlier.find(function (k) {
      return _attendanceCount(mine[k][f]) != null;
    });
    var prev = prevKey ? _attendanceCount(mine[prevKey][f]) : null;
    var unknown = out[f] != null && prev == null && hadReport;
    if (unknown) out.termUnknown = true;
    out['prev' + f[0].toUpperCase() + f.slice(1)] = prev;
    out[f + 'PrevTerm'] = prevKey || null;
    out[f + 'ThisTerm'] = out[f] == null || unknown ? null : prev == null ? out[f] : out[f] - prev;
  });
  return out;
}

/* The saved totals from the server, laid over this device's copy. Read
   when the Reports page opens, so a class still loads in one request.
   Resolves true when it changed anything on this device. */
async function loadTermAttendance(cid) {
  if (!_useSupabase || !window.v2 || !window.v2.listCourseTermAttendance) return false;
  try {
    var res = await window.v2.listCourseTermAttendance(cid);
    if (!res || res.error) return;
    var data = _rpcObject(res.data !== undefined ? res.data : res) || {};
    var all = _cloneValue(getTermRatings(cid) || {}) || {};
    var changed = false;
    Object.keys(data).forEach(function (sid) {
      Object.keys(data[sid] || {}).forEach(function (t) {
        var termId = 'term-' + t;
        var row = data[sid][t] || {};
        if (!all[sid]) all[sid] = {};
        var prev = all[sid][termId] || {};
        var a = _attendanceCount(row.absences);
        var l = _attendanceCount(row.lates);
        if (_attendanceCount(prev.absences) === a && _attendanceCount(prev.lates) === l) return;
        changed = true;
        all[sid][termId] = Object.assign({}, prev, {
          absences: a,
          lates: l,
        });
      });
    });
    if (changed) _persistLoadedField(cid, 'termRatings', all);
    return changed;
  } catch (e) {
    console.warn('list_course_term_attendance failed for ' + cid + ':', e);
    return false;
  }
}

/* ── DIBELS 8 benchmark scores ─────────────────────────────
   Raw scores for one student on one DIBELS assessment, in up to three
   windows (Beginning, Middle and End of Year): oral reading fluency words
   read correctly and errors, and Maze correct and incorrect. Kept on
   dibels_score (migrations/20261027_dibels_scores.sql) and here keyed
   'sid:aid' like statuses. Accuracy, the adjusted Maze score and the
   benchmark levels are worked out from these, never stored. */
var DIBELS_PERIODS = ['boy', 'moy', 'eoy'];
var _DIBELS_FIELDS = [
  ['orfWrc', 'orf_wrc'],
  ['orfErrors', 'orf_errors'],
  ['mazeCorrect', 'maze_correct'],
  ['mazeIncorrect', 'maze_incorrect'],
];
function _dibelsCount(v) {
  if (v === '' || v == null) return null;
  var n = Math.floor(Number(v));
  return isFinite(n) && n >= 0 ? n : null;
}
function getDibelsScores(cid) {
  if (_cache.dibels[cid] !== undefined) return _cache.dibels[cid];
  var stored = _safeParseLS('gb-dibels-' + cid, {});
  _cache.dibels[cid] = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
  return _cache.dibels[cid];
}
/* One window's four numbers (nulls where not entered), or null when none. */
function getDibelsScore(cid, sid, aid, period) {
  var row = (getDibelsScores(cid)[sid + ':' + aid] || {})[period];
  return row ? Object.assign({}, row) : null;
}
/* Saves one window's numbers; blanks are null, all blank clears the window. */
function saveDibelsScore(cid, sid, aid, period, values) {
  if (!cid || !sid || !aid || DIBELS_PERIODS.indexOf(period) < 0) return false;
  var row = {};
  var any = false;
  _DIBELS_FIELDS.forEach(function (f) {
    row[f[0]] = _dibelsCount(values && values[f[0]]);
    if (row[f[0]] != null) any = true;
  });
  var all = getDibelsScores(cid);
  var key = sid + ':' + aid;
  var prev = (all[key] || {})[period] || null;
  var same =
    prev &&
    _DIBELS_FIELDS.every(function (f) {
      return prev[f[0]] === row[f[0]];
    });
  if ((!any && !prev) || (any && same)) return true;
  if (!all[key]) all[key] = {};
  if (any) all[key][period] = row;
  else delete all[key][period];
  if (!Object.keys(all[key]).length) delete all[key];
  var lsOk = _saveCourseField('dibels', cid, all);
  if (_writesEnabled() && _isSendableId(sid) && _isSendableId(aid)) {
    var params = { p_enrollment_id: sid, p_assessment_id: aid, p_period: period };
    _DIBELS_FIELDS.forEach(function (f) {
      params['p_' + f[1]] = row[f[0]];
    });
    _trackPendingSync(
      _writeRpc('upsert_dibels_score', params).then(function (res) {
        if (res && res.error) _reportScoreWriteFailure('upsert_dibels_score', res.error);
      }),
    );
  }
  return lsOk;
}
/* The class's saved DIBELS scores from the server, laid over this device's
   copy. Read when a page that shows them opens, so a class still loads in
   one request. Resolves true when it changed anything here. */
async function loadDibelsScores(cid) {
  if (!_useSupabase || !_isUuid(cid)) return false;
  var sb = getSupabase();
  if (!sb) return false;
  try {
    var res = await sb.rpc('list_course_dibels', { p_course_id: cid });
    if (!res || res.error) return false;
    var rows = Array.isArray(res.data) ? res.data : [];
    var next = {};
    rows.forEach(function (r) {
      if (!r || DIBELS_PERIODS.indexOf(r.period) < 0) return;
      var key = r.enrollment_id + ':' + r.assessment_id;
      if (!next[key]) next[key] = {};
      var row = {};
      _DIBELS_FIELDS.forEach(function (f) {
        row[f[0]] = _dibelsCount(r[f[1]]);
      });
      next[key][r.period] = row;
    });
    if (JSON.stringify(next) === JSON.stringify(getDibelsScores(cid))) return false;
    _persistLoadedField(cid, 'dibels', next);
    return true;
  } catch (e) {
    console.warn('list_course_dibels failed for ' + cid + ':', e);
    return false;
  }
}

/* save_term_rating treats every key it receives as "set this field", so only
   the fields the caller changed are sent. Sending the whole local blob erased
   the saved narrative and social traits whenever the blob was incomplete,
   which it always is after a reload: term ratings aren't read back yet. A
   rating of 0 means "cleared", which the server stores as null. */
// The Reports page names terms 'term-1'…'term-6'; the server stores 1…6.
// Number('term-1') is NaN, so until this mapping every questionnaire save
// stayed in the browser.
function _termNumber(termId) {
  if (typeof termId === 'number') return termId;
  var m = String(termId || '').match(/(\d+)$/);
  return m ? Number(m[1]) : NaN;
}

var _TERM_RATING_WIRE = {
  narrative: 'narrativeHtml',
  workHabits: 'workHabitsRating',
  participation: 'participationRating',
  socialTraits: 'socialTraits',
  dimensions: 'dimensions',
  strengths: 'strengthTagIds',
  growthAreas: 'growthTagIds',
  mentionAssessments: 'mentionAssessmentIds',
  mentionObs: 'mentionObservationIds',
  habits: 'habits',
  approvedAt: 'approved',
  reportingBasis: 'reportingBasis',
  ieDeadline: 'ieDeadline',
  draftMeta: 'draftMeta',
};
function _termRatingPatch(data) {
  var payload = {};
  Object.keys(data || {}).forEach(function (key) {
    var wireKey = _TERM_RATING_WIRE[key];
    if (!wireKey) return;
    var value = data[key];
    if ((key === 'workHabits' || key === 'participation') && !value) value = null;
    if (key === 'approvedAt') value = !!value;
    payload[wireKey] = value;
  });
  // The reporting basis and the IE deadline go together. The server refuses
  // an IE without a deadline, so until the teacher picks a date the choice
  // stays on this device (term_rating_ie_needs_deadline).
  if ('reportingBasis' in payload || 'ieDeadline' in payload) {
    if (payload.reportingBasis === 'ie' && !payload.ieDeadline) {
      delete payload.reportingBasis;
      delete payload.ieDeadline;
    }
  }
  return payload;
}

/* The six work habits, 1 Rarely … 4 Consistently, 5 Not Seen; anything else
   (0, null, an unknown key) means not rated and is left out, as the server
   accepts only those keys and values. */
var HABIT_KEYS = ['completes', 'ready', 'others', 'part', 'feedback', 'devices'];
function _habitsWire(habits) {
  var out = {};
  HABIT_KEYS.forEach(function (k) {
    var v = Number(habits[k]);
    if (v >= 1 && v <= 5 && Math.floor(v) === v) out[k] = v;
  });
  return out;
}

/* ── Report Config ─────────────────────────────────────────── */
function getReportConfig(cid) {
  if (_cache.reportConfig[cid] !== undefined) return _cache.reportConfig[cid];
  try {
    return JSON.parse(localStorage.getItem('gb-report-config-' + cid)) || null;
  } catch (e) {
    console.warn('ReportConfig parse fallback:', e);
    return null;
  }
}
function saveReportConfig(cid, config) {
  _saveCourseField('reportConfig', cid, config);
  if (_writesEnabled() && _isUuid(cid)) {
    // v2 save_report_config(p_course_id, p_blocks_config jsonb, p_preset).
    // Legacy signature was (p_course_offering_id, p_config) — no preset split.
    // The v2 RPC stores blocks_config verbatim + records the preset; caller
    // can pass preset explicitly via config._preset, else it defaults to
    // 'custom' server-side (which matches the "teacher mutated blocks
    // manually" semantics of the legacy single-blob save).
    const sb = getSupabase();
    if (sb) {
      var preset = (config && config._preset) || null;
      var blocks = Object.assign({}, config || {});
      delete blocks._preset;
      _trackPendingSync(
        _writeRpc('save_report_config', {
          p_course_id: cid,
          p_blocks_config: blocks,
          p_preset: preset,
        }).then(function (res) {
          if (res.error) console.warn('save_report_config RPC failed:', res.error);
        }),
      );
    }
  }
}

/* ── Card Widget Config ───────────────────────────────────── */
function _defaultWidgetConfig() {
  var order = [];
  var disabled = [];
  WIDGET_REGISTRY.forEach(function (w) {
    if (w.defaultOn) order.push(w.key);
    else disabled.push(w.key);
  });
  return { order: order, disabled: disabled };
}

function getCardWidgetConfigFromRaw(raw) {
  if (!raw || !Array.isArray(raw.order)) return _defaultWidgetConfig();

  var validKeys = new Set(WIDGET_KEYS);
  var order = raw.order.filter(function (k) {
    return validKeys.has(k);
  });
  var disabled = Array.isArray(raw.disabled)
    ? raw.disabled.filter(function (k) {
        return validKeys.has(k);
      })
    : [];

  /* A widget the saved config does not name was added after the teacher
     saved it (a save names every widget). One on by default goes into the
     order after the nearest widget before it in the registry that is shown
     (first when none is); one off by default is off. A widget the teacher
     turned off is in `disabled` and stays off. */
  var present = new Set(order.concat(disabled));
  WIDGET_REGISTRY.forEach(function (w, i) {
    var k = w.key;
    if (present.has(k)) return;
    if (!w.defaultOn) {
      disabled.push(k);
      return;
    }
    var at = 0;
    for (var j = i - 1; j >= 0; j--) {
      var before = order.indexOf(WIDGET_REGISTRY[j].key);
      if (before >= 0) {
        at = before + 1;
        break;
      }
    }
    order.splice(at, 0, k);
  });

  return { order: order, disabled: disabled };
}

function getCardWidgetConfig() {
  var raw = _safeParseLS('m-card-widgets', null);
  var cfg = _cache.config || getConfig();
  if (!raw && cfg && cfg.cardWidgetConfig) {
    raw = cfg.cardWidgetConfig;
    if (!_cache.config) _cache.config = cfg;
    _safeLSSet('m-card-widgets', JSON.stringify(raw));
  }
  return getCardWidgetConfigFromRaw(raw);
}

function saveCardWidgetConfig(config) {
  var normalized = getCardWidgetConfigFromRaw(config);
  _safeLSSet('m-card-widgets', JSON.stringify(normalized));
  var cfg = Object.assign({}, getConfig() || {}, { cardWidgetConfig: normalized });
  _cache.config = cfg;
  _safeLSSet('gb-config', JSON.stringify(cfg));
  if (_writesEnabled() && window.v2 && window.v2.saveTeacherPreferences) {
    window.v2.saveTeacherPreferences({ card_widget_config: normalized });
  }
}

/* The settings that follow the teacher to any device:
   { studentView: 'cards' | 'grid', helpRule: { below, min },
     closedModules: { [courseId]: [moduleId] } (closed module folders on
   the Assignments page), view: { [key]: string } (getViewPref) }. Empty
   until one is changed. */
function getDashboardPrefs() {
  var cfg = _cache.config || getConfig();
  return (cfg && cfg.dashboardPrefs) || {};
}

/* Change some of them; the rest stay. Saved with the teacher's preferences. */
function saveDashboardPrefs(change) {
  var prefs = Object.assign({}, getDashboardPrefs(), change || {});
  var cfg = Object.assign({}, getConfig() || {}, { dashboardPrefs: prefs });
  _cache.config = cfg;
  _safeLSSet('gb-config', JSON.stringify(cfg));
  if (_writesEnabled() && window.v2 && window.v2.saveTeacherPreferences) {
    window.v2.saveTeacherPreferences({ dashboard_prefs: prefs });
  }
  return prefs;
}

/* A page's view choice (the roster's Sort and Show, Newest First, the
   Gradebook's header height and rubric columns, the hidden sidebar), kept
   with the teacher's preferences so it survives signing out, which wipes
   this computer's storage (supabase.js, _clearDeviceData). Each is a string
   under its old localStorage key; a choice made before it moved here is
   still read from that key until it is next changed. */
function getViewPref(key) {
  var view = getDashboardPrefs().view || {};
  if (Object.prototype.hasOwnProperty.call(view, key)) return view[key];
  try {
    return localStorage.getItem(key);
  } catch (e) {
    return null;
  }
}
function saveViewPref(key, value) {
  var view = Object.assign({}, getDashboardPrefs().view || {});
  view[key] = value == null ? null : String(value);
  saveDashboardPrefs({ view: view });
}

function clearCardWidgetConfig() {
  try {
    localStorage.removeItem('m-card-widgets');
  } catch (e) {
    /* storage error */
  }
  var cfg = Object.assign({}, getConfig() || {}, { cardWidgetConfig: null });
  _cache.config = cfg;
  _safeLSSet('gb-config', JSON.stringify(cfg));
  if (_writesEnabled() && window.v2 && window.v2.saveTeacherPreferences) {
    window.v2.saveTeacherPreferences({ card_widget_config: null });
  }
}

/* ══════════════════════════════════════════════════════════════════
   Student work: the client's read side (S5-F5)
   ══════════════════════════════════════════════════════════════════
   What students have sent, and the two settings that let them send: the
   class's Send Work switch and each assessment's Students Send. Read here
   in the shapes the server sends them (migrations/local-test/
   batch-b-contract.md on the batch-b-submissions branch, coded to commit
   5cbe3657), so a screen built on these needs no change when the wiring
   PR (S5-W1) fills them from the server:

   getCourseSubmissions(cid)   list_course_submissions(p_course_id):
     { bucket, course: { send_work, keep_photos_until },
       assessments: [{ id, students_send, after_due, accept_until,
                       group_work, students_see_markup }],   every assessment
       submissions: [{ id, assessment_id, enrollment_id, version, state,
                       sent_by, on_paper, is_late, note, followed_plan,
                       created_at, sent_at,
                       files: [{ id, page, path, thumb_path, bytes,
                                 thumb_bytes, width, height, rotation,
                                 sha256 }] }],          handed in only
       uploads: [] }
   getStudentSubmission(cid, sid, aid)   one student's submission for one
     assessment (the newest version), as in `submissions`, or null.
   getAssessmentStudentWork(cid, aid)    one entry of `assessments`.
   getCourseSendWork(cid)                `course`.
   getStudentWork(cid, sid)              the student page's work(...):
     { ok, v, send_work, assessments: [{ id, students_send, open,
       closes_on, late_now, sent, sending }] }, `sent` as
     { submission_id, sent_at, sent_by, on_paper, is_late, note, pages,
       grading, can_change }.
   studentWorkGradingStarted(cid, sid, aid)   Colin's rule: the piece holds
     a draft or a returned grade (a level, points, a tick) or an Overall
     Comment for that student. A Late, Missing or Excused mark alone is not.
   studentWorkPageUrl(cid, file, which)  a Promise of an address an <img>
     can show for one page ('page') or its thumbnail ('thumb'), or null.
     Shipped sample files only; openStudentWorkPage also shows a photo
     still in the photo queue.
   addStudentWorkPages, replaceStudentWorkPages, markStudentWorkOnPaper,
   deleteStudentWork, openStudentWorkPage   work a teacher adds or deletes (below, "Work a teacher adds").

   A client student id is the server's enrollment id, so enrollment_id is
   the student's id here. Every answer is a copy: changing it changes
   nothing stored.

   Demo Mode: the sample work is shared/seed-data.js's
   (saveDemoStudentWork), kept in localStorage under
   gb-student-work-<cid>. Its pages are drawn images shipped with the app
   in assets/sample-work/, so a page's path and thumb_path there are file
   names in that folder, not storage paths. A signed-in class whose
   student page the server has on is answered from the server (below,
   "Student work for a signed-in teacher", S5-W1); any other class gets
   the empty answers (Send Work off, every assessment taking nothing,
   nothing sent), and nothing here calls the server for it.

   Kept out of class backups and Download All My Data on purpose (S8-F2):
   this is not one of the _DATA_KEYS fields. */
var STUDENT_WORK_MAX_PAGES = 30;
var _STUDENT_WORK_DEMO_DIR = '/assets/sample-work/';
var _STUDENT_WORK_DEFAULTS = {
  students_send: 'nothing',
  after_due: 'keep',
  accept_until: null,
  group_work: 'each',
  students_see_markup: true,
};
var _studentWork = {}; // cid → { raw, value }: the stored sample work (Demo Mode) as last read

function _studentWorkStored(cid) {
  // A signed-in class with its student page on: the server's (S5-W1, below).
  if (_workOnServer(cid)) return _workServerView(cid);
  if (!cid || !_isDemoSession()) return null;
  var raw = null;
  try {
    raw = localStorage.getItem('gb-student-work-' + cid);
  } catch (e) {
    raw = null;
  }
  var held = _studentWork[cid];
  if (!held || held.raw !== raw) {
    var value = null;
    try {
      value = raw == null ? null : JSON.parse(raw);
    } catch (e) {
      value = null;
    }
    held = _studentWork[cid] = { raw: raw, value: _plainObject(value) ? value : null };
  }
  return held.value;
}

function _studentWorkCopy(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

/* Demo Mode's sample work for a class (seed-data.js), in the shape
   getCourseSubmissions answers; bucket and uploads are left out. Refused
   (false) outside Demo Mode and for a submission of more than 30 pages. */
function saveDemoStudentWork(cid, work) {
  if (!cid || !_isDemoSession() || !_plainObject(work)) return false;
  var subs = Array.isArray(work.submissions) ? work.submissions : [];
  var tooMany = subs.some(function (s) {
    return !s || (Array.isArray(s.files) && s.files.length > STUDENT_WORK_MAX_PAGES);
  });
  if (tooMany) return false;
  var stored = {
    course: Object.assign({ send_work: false, keep_photos_until: 'end_of_year' }, _studentWorkCopy(work.course) || {}),
    assessments: _studentWorkCopy(Array.isArray(work.assessments) ? work.assessments : []),
    submissions: _studentWorkCopy(subs),
  };
  var raw = JSON.stringify(stored);
  _safeLSSet('gb-student-work-' + cid, raw);
  _studentWork[cid] = { raw: raw, value: stored };
  return true;
}

function getCourseSendWork(cid) {
  var stored = _studentWorkStored(cid);
  var course = stored && stored.course;
  return {
    send_work: !!(course && course.send_work === true),
    keep_photos_until: course && course.keep_photos_until === 'end_of_term' ? 'end_of_term' : 'end_of_year',
  };
}

function getAssessmentStudentWork(cid, aid) {
  var stored = _studentWorkStored(cid);
  var own =
    stored &&
    (stored.assessments || []).find(function (a) {
      return a && a.id === aid;
    });
  var out = Object.assign({ id: aid }, _STUDENT_WORK_DEFAULTS, own ? _studentWorkCopy(own) : {});
  out.id = aid;
  if (out.after_due !== 'until') out.accept_until = null;
  return out;
}

function _studentWorkSubmissions(cid) {
  var stored = _studentWorkStored(cid);
  if (!stored) return [];
  var aids = {};
  (getAssessments(cid) || []).forEach(function (a) {
    if (a && a.id) aids[a.id] = true;
  });
  // The server takes an assessment's work with it when it is deleted.
  return (stored.submissions || [])
    .filter(function (s) {
      return s && s.state === 'sent' && aids[s.assessment_id];
    })
    .map(function (s) {
      var out = _studentWorkCopy(s);
      out.files = (Array.isArray(out.files) ? out.files : []).slice().sort(function (x, y) {
        return (x.page || 0) - (y.page || 0);
      });
      // Who added each page (the contract's added_by); the sample's pages
      // were all added by whoever sent the work.
      out.files.forEach(function (f) {
        if (f && f.added_by !== 'teacher' && f.added_by !== 'student') {
          f.added_by = out.sent_by === 'teacher' ? 'teacher' : 'student';
        }
      });
      return out;
    });
}

function getCourseSubmissions(cid) {
  return {
    bucket: 'student-photos',
    course: getCourseSendWork(cid),
    assessments: (getAssessments(cid) || [])
      .filter(function (a) {
        return a && a.id;
      })
      .map(function (a) {
        return getAssessmentStudentWork(cid, a.id);
      }),
    submissions: _studentWorkSubmissions(cid),
    uploads: [],
  };
}

function getStudentSubmission(cid, sid, aid) {
  return _newestSubmissionsOf(cid, [sid], aid)[0] || null;
}

function studentWorkGradingStarted(cid, sid, aid) {
  var row = typeof getGradeReturn === 'function' ? getGradeReturn(cid, sid, aid) : null;
  if (row && row.is_draft) return true;
  if (hasScoreOrFeedback(cid, sid, aid)) return true;
  return getRubricCheckIds(cid, sid, aid).length > 0;
}

/* The window for sending, by the class's own date, as the server's
   _work_window works it out: an assessment's `date` is its date_assigned
   and `dueDate` its due_date. */
function _studentWorkWindow(cid, a, settings) {
  var today = courseToday(cid);
  var due = a.dueDate || a.due_date ? String(a.dueDate || a.due_date).slice(0, 10) : null;
  var closes = settings.after_due === 'until' ? settings.accept_until : settings.after_due === 'stop' ? due : null;
  var open =
    settings.after_due === 'until'
      ? !!closes && today <= closes
      : settings.after_due === 'stop'
        ? !due || today <= due
        : true;
  return {
    listed: !a.date || String(a.date).slice(0, 10) <= today,
    closes_on: closes || null,
    open: open,
    late: !!due && today > due,
  };
}

function getStudentWork(cid, sid) {
  var send = getCourseSendWork(cid).send_work;
  var listed = (getAssessments(cid) || [])
    .map(function (a, i) {
      return { a: a, i: i };
    })
    .filter(function (x) {
      return x.a && x.a.id;
    })
    // Undated first, then oldest first; the class's own order within a day.
    .sort(function (x, y) {
      var p = x.a.date ? String(x.a.date).slice(0, 10) : '';
      var q = y.a.date ? String(y.a.date).slice(0, 10) : '';
      if (p !== q) return p < q ? -1 : 1;
      return x.i - y.i;
    });
  var out = [];
  listed.forEach(function (x) {
    var a = x.a;
    var settings = getAssessmentStudentWork(cid, a.id);
    var w = _studentWorkWindow(cid, a, settings);
    var s = getStudentSubmission(cid, sid, a.id);
    if (!w.listed || (settings.students_send === 'nothing' && !s)) return;
    var takes = send && settings.students_send !== 'nothing' && w.open;
    // Grading has started for the student once the teacher's marks are on a
    // page of their work too (Colin, Nov 11): they can no longer change it.
    var started = !!s && (studentWorkGradingStarted(cid, sid, a.id) || _teacherMarksOnWork(cid, sid, a.id));
    out.push({
      id: a.id,
      students_send: settings.students_send,
      open: takes,
      closes_on: w.closes_on,
      late_now: w.late,
      sent: s
        ? {
            submission_id: s.id,
            sent_at: s.sent_at,
            sent_by: s.sent_by,
            on_paper: !!s.on_paper,
            is_late: !!s.is_late,
            note: s.note == null ? null : s.note,
            pages: (s.files || []).length,
            grading: started,
            can_change: s.sent_by === 'student' && !started && takes,
          }
        : null,
      // A send that is not finished: there is none in Demo Mode's sample.
      sending: null,
    });
  });
  return { ok: true, v: 1, send_work: send, assessments: out };
}

function studentWorkPageUrl(cid, file, which) {
  var name = file && (which === 'thumb' ? file.thumb_path : file.path);
  // Demo Mode's sample pages only: a live class's are opened (openStudentWorkPage).
  if (!name || !_isDemoSession() || !_studentWorkStored(cid)) return Promise.resolve(null);
  // A sample page is a file name in assets/sample-work, nothing more.
  if (!/^[a-z0-9-]+\.jpg$/.test(name)) return Promise.resolve(null);
  return Promise.resolve(_STUDENT_WORK_DEMO_DIR + name);
}

/* ── Group work: the reader takes a group (S12-T1) ──────────────────────
   On a piece set to One per Group (Students Send's group_work 'group'),
   the group is the pair or group the teacher made on the assessment
   (collaboration Pairs or Groups, getCollabGroupOf). Each member who sends
   makes their own submission; the group's work is all of them together,
   and every member sees it (batch-c-contract.md, "Group work"). A member
   Graded Separately is still in the group's work: only their grade is
   their own. Everywhere else (Each Student, individual work, a student in
   no group, DIBELS) the group is the student alone, and these answer
   exactly what getStudentSubmission and getStudentWork answer for them.

   Shapes: getStudentGroupWork is the student's group_work(...),
   getGroupWorkFiles the files group_file_links(...) makes links for.
   No answer here carries a group-mate's name. Demo Mode, and a signed-in
   class the server keeps rows for (each member's own submission comes from
   list_course_submissions); any other class answers empty. */

/* The group `sid` sends with on `aid`: { kind: 'pair' | 'group', index,
   members, separate } (members on the roster, in the group's order;
   separate: `sid` is Graded Separately), or null when the student sends
   alone. */
function getStudentWorkGroup(cid, sid, aid) {
  // Demo Mode, or a signed-in class the server keeps rows for (S12-W1): the groups are the teacher's own.
  if (!_isDemoSession() && !_fbOn(cid)) return null;
  // The class's own copy of the piece (pairs and groups as the teacher made them), not the server's raw row.
  var a = (getAssessments(cid) || []).find(function (x) {
    return x && x.id === aid;
  });
  if (!a || getAssessmentStudentWork(cid, aid).group_work !== 'group') return null;
  var group = getCollabGroupOf(a, sid);
  if (!group) return null;
  var roster = {};
  (getStudents(cid) || []).forEach(function (s) {
    if (s && s.id) roster[s.id] = true;
  });
  var members = group.members.filter(function (m) {
    return roster[m];
  });
  if (members.length < 2) return null;
  return { kind: group.kind, index: group.index, members: members, separate: isGradedSeparately(a, sid) };
}

// The newest handed-in submission of each of `sids` on `aid`, in that order.
function _newestSubmissionsOf(cid, sids, aid) {
  var subs = _studentWorkSubmissions(cid);
  var out = [];
  sids.forEach(function (sid) {
    var mine = subs
      .filter(function (s) {
        return s.enrollment_id === sid && s.assessment_id === aid;
      })
      .sort(function (x, y) {
        return (y.version || 1) - (x.version || 1);
      });
    if (mine.length) out.push(mine[0]);
  });
  return out;
}

/* The work in for `sid`'s group on `aid`: each member's newest handed-in
   submission, members in the group's order (the student's own first when
   they send alone, so a single student gets [their submission] or []). */
function getGroupSubmissions(cid, sid, aid) {
  var group = getStudentWorkGroup(cid, sid, aid);
  return _newestSubmissionsOf(cid, group ? group.members : [sid], aid);
}

/* True when work is in for `sid` on `aid`: their own, or on a One per
   Group piece a group-mate's. What To Grade and Not In should ask in place
   of getStudentSubmission (see GraderWork.workStateOf). */
function groupWorkIn(cid, sid, aid) {
  return getGroupSubmissions(cid, sid, aid).length > 0;
}

/* Every page of the group's work, as group_file_links lists them: each
   page of getGroupSubmissions' submissions, with enrollment_id (who sent
   it: an id, never a name), submission_id and mine (sent in `sid`'s own
   submission). Members in order, each one's pages in order. */
function getGroupWorkFiles(cid, sid, aid) {
  var out = [];
  getGroupSubmissions(cid, sid, aid).forEach(function (s) {
    (s.files || []).forEach(function (f) {
      out.push(
        Object.assign({}, f, { enrollment_id: s.enrollment_id, submission_id: s.id, mine: s.enrollment_id === sid }),
      );
    });
  });
  return out;
}

/* The student page's group_work(...): { ok, assessments: [{ id, members,
   sent, pages, you_sent, first_sent_at }] } for each One per Group piece
   the student's group is on: how many are in the group, whether any work
   is in, its pages, whether the student sent some, and when the first came
   in. No names. In the page's order (getStudentWork's). */
function getStudentGroupWork(cid, sid) {
  var out = [];
  (getStudentWork(cid, sid).assessments || []).forEach(function (w) {
    var group = getStudentWorkGroup(cid, sid, w.id);
    if (!group) return;
    var subs = _newestSubmissionsOf(cid, group.members, w.id);
    var first = null;
    var pages = 0;
    subs.forEach(function (s) {
      pages += (s.files || []).length;
      var at = s.sent_at || s.created_at;
      if (at && (!first || at < first)) first = at;
    });
    out.push({
      id: w.id,
      members: group.members.length,
      sent: subs.length > 0,
      pages: pages,
      you_sent: subs.some(function (s) {
        return s.enrollment_id === sid;
      }),
      first_sent_at: first,
    });
  });
  return { ok: true, assessments: out };
}

/* ── Work a teacher adds (S6-F2, S7-F3) ─────────────────────────────────
   Add Work, Add as More Pages, Replace Them and Handed In on Paper, in the
   shapes of the contract's start_work_upload + finish_work_upload and
   mark_handed_in_paper, so the wiring PR (S5-W1/S6-W1/S7-W1) can point
   them at the server without a screen changing.

   pages are PhotoShrink.prepare's, in order: [{ blob, thumb, hash, width,
   height, … }]. Each page waits in the photo queue (shared/photo-queue.js,
   IndexedDB) under its own local id. In Demo Mode it stays there for good:
   the queue never sends in Demo Mode, and the work is recorded on this
   device as handed in. A page still in the queue has the path
   "photo-queue:<id>" (its thumbnail "photo-queue:<id>:thumb"), which only
   openStudentWorkPage turns into an address.

   A signed-in class with its student page on goes to the server (below,
   _serverTeacherWork, S5-W1); any other signed-in class answers
   { result: 'not_available' } and calls nothing. Every answer is a
   Promise; none rejects. */
var _STUDENT_WORK_QUEUE_PATH = /^photo-queue:(p[a-z0-9]+)(:thumb)?$/;
var _teacherWorkChain = {}; // cid → the last teacher-work write's promise, so two never interleave

function _teacherWorkId() {
  return 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function _studentWorkWrite(cid, stored) {
  var raw = JSON.stringify(stored);
  _safeLSSet('gb-student-work-' + cid, raw);
  _studentWork[cid] = { raw: raw, value: stored };
}

// A copy of the class's stored work to change, or an empty one.
function _studentWorkDraft(cid) {
  var stored = _studentWorkCopy(_studentWorkStored(cid));
  if (!_plainObject(stored)) stored = {};
  return {
    course: Object.assign({ send_work: false, keep_photos_until: 'end_of_year' }, stored.course || {}),
    assessments: Array.isArray(stored.assessments) ? stored.assessments : [],
    submissions: Array.isArray(stored.submissions) ? stored.submissions : [],
  };
}

function _teacherWorkInClass(cid, sid, aid) {
  var hasPiece = (getAssessments(cid) || []).some(function (a) {
    return a && a.id === aid;
  });
  var hasStudent = (getStudents(cid) || []).some(function (s) {
    return s && s.id === sid;
  });
  return hasPiece && hasStudent;
}

// The newest handed-in submission for one student and piece in a draft.
function _teacherWorkSent(draft, sid, aid) {
  var found = draft.submissions
    .filter(function (s) {
      return s && s.state === 'sent' && s.enrollment_id === sid && s.assessment_id === aid;
    })
    .sort(function (x, y) {
      return (y.version || 1) - (x.version || 1);
    });
  return found[0] || null;
}

function _teacherWorkPagesOk(pages) {
  return (
    Array.isArray(pages) &&
    pages.length > 0 &&
    pages.every(function (p) {
      return p && p.blob && p.thumb && p.blob.size > 0 && p.thumb.size > 0;
    })
  );
}

// One write at a time per class: each waits for the one before it.
function _teacherWorkQueued(cid, work) {
  var before = _teacherWorkChain[cid] || Promise.resolve();
  var run = before.then(work, work).then(null, function () {
    return { result: 'store_failed' };
  });
  _teacherWorkChain[cid] = run;
  return run;
}

function _queuePagesOf(sub) {
  return ((sub && sub.files) || [])
    .map(function (f) {
      var m = f && typeof f.path === 'string' ? _STUDENT_WORK_QUEUE_PATH.exec(f.path) : null;
      return m && !m[2] ? m[1] : null;
    })
    .filter(Boolean);
}

/* Put pages in the photo queue for one submission. → { ok, ids } or the
   queue's refusal as an answer. */
function _teacherWorkQueuePages(cid, sid, aid, subId, pages) {
  var q = window.PhotoQueue;
  if (!q || typeof q.add !== 'function') return Promise.resolve({ ok: false, answer: { result: 'no_photo_store' } });
  return q.add({ course: cid, assessment: aid, enrollment: sid, submission: subId }, pages).then(function (res) {
    if (res && res.ok) return res;
    var reason = res && (res.reason === 'storage_full' || res.reason === 'invalid') ? res.reason : 'store_failed';
    return { ok: false, answer: { result: reason } };
  });
}

function _teacherWorkForget(ids) {
  var q = window.PhotoQueue;
  if (!q || typeof q.remove !== 'function' || !ids.length) return Promise.resolve();
  return Promise.all(
    ids.map(function (id) {
      return q.remove(id).then(null, function () {});
    }),
  );
}

function _teacherWorkFiles(queued, pages, firstPage) {
  return queued.map(function (qid, i) {
    var p = pages[i];
    return {
      id: qid,
      page: firstPage + i,
      path: 'photo-queue:' + qid,
      thumb_path: 'photo-queue:' + qid + ':thumb',
      bytes: p.blob.size,
      thumb_bytes: p.thumb.size,
      width: p.width || null,
      height: p.height || null,
      rotation: 0,
      sha256: p.hash || null,
      added_by: 'teacher',
    };
  });
}

/* What a teacher's Add Work would be answered, before or after the photos
   are kept (another write may have changed the piece meanwhile). null: go. */
function _teacherWorkCheck(cid, sid, aid, pages, mode) {
  if (!_teacherWorkInClass(cid, sid, aid)) return { result: 'not_found' };
  var sent = _teacherWorkSent(_studentWorkDraft(cid), sid, aid);
  if (mode === 'new' && sent) return { result: 'already_sent', submission: getStudentSubmission(cid, sid, aid) };
  if (mode !== 'new' && !sent) return { result: 'nothing_sent' };
  if (mode === 'add' && sent.on_paper) return { result: 'on_paper', submission: getStudentSubmission(cid, sid, aid) };
  var have = mode === 'add' ? (sent.files || []).length : 0;
  if (have + pages.length > STUDENT_WORK_MAX_PAGES)
    return { result: 'too_many_pages', room: STUDENT_WORK_MAX_PAGES - have };
  return null;
}

function _teacherWork(cid, sid, aid, pages, mode) {
  if (_workOnServer(cid)) return _serverTeacherWork(cid, sid, aid, pages, mode);
  if (!cid || !_isDemoSession()) return Promise.resolve({ result: 'not_available' });
  if (!_teacherWorkPagesOk(pages)) return Promise.resolve({ result: 'invalid' });
  return _teacherWorkQueued(cid, function () {
    var refused = _teacherWorkCheck(cid, sid, aid, pages, mode);
    if (refused) return refused;
    var target = _teacherWorkSent(_studentWorkDraft(cid), sid, aid);
    var subId = mode === 'add' ? target.id : _teacherWorkId();
    return _teacherWorkQueuePages(cid, sid, aid, subId, pages).then(function (kept) {
      if (!kept.ok) return kept.answer;
      // Asked again now the photos are kept: the piece may have changed.
      var late = _teacherWorkCheck(cid, sid, aid, pages, mode);
      var draft = _studentWorkDraft(cid);
      var now = _teacherWorkSent(draft, sid, aid);
      if (!late && mode !== 'new' && (!now || now.id !== target.id)) late = { result: 'nothing_sent' };
      if (late || !_isDemoSession()) {
        return _teacherWorkForget(kept.ids).then(function () {
          return late || { result: 'not_available' };
        });
      }
      var stamp = new Date().toISOString();
      var dropped = [];
      if (mode === 'add') {
        var last = (now.files || []).reduce(function (n, f) {
          return Math.max(n, (f && f.page) || 0);
        }, 0);
        now.files = (now.files || []).concat(_teacherWorkFiles(kept.ids, pages, last + 1));
        now.updated_at = stamp;
      } else {
        // Replace Them: every page of what is in goes, the student's among them.
        if (now) {
          dropped = _queuePagesOf(now);
          draft.submissions = draft.submissions.filter(function (s) {
            return s !== now;
          });
        }
        draft.submissions.push({
          id: subId,
          assessment_id: aid,
          enrollment_id: sid,
          version: (now && now.version) || 1,
          state: 'sent',
          sent_by: 'teacher',
          on_paper: false,
          is_late: false,
          note: null,
          followed_plan: null,
          created_at: stamp,
          sent_at: stamp,
          files: _teacherWorkFiles(kept.ids, pages, 1),
        });
      }
      _studentWorkWrite(cid, draft);
      return _teacherWorkForget(dropped).then(function () {
        return { result: 'sent', submission: getStudentSubmission(cid, sid, aid) };
      });
    });
  });
}

/* Add Work for one student with nothing in (mode 'new', the default), or
   Add as More Pages to what is in (mode 'add'). See the block above. */
function addStudentWorkPages(cid, sid, aid, pages, opts) {
  var mode = opts && opts.mode === 'add' ? 'add' : 'new';
  return _teacherWork(cid, sid, aid, pages, mode);
}

/* Replace Them: the new pages take the place of every page that is in. */
function replaceStudentWorkPages(cid, sid, aid, pages) {
  return _teacherWork(cid, sid, aid, pages, 'replace');
}

/* Handed In on Paper for these students. A student who already has work
   in, or is not in the class, is passed over. */
function markStudentWorkOnPaper(cid, aid, sids) {
  if (_workOnServer(cid)) return _serverMarkOnPaper(cid, aid, sids);
  if (!cid || !_isDemoSession()) return Promise.resolve({ result: 'not_available', marked: 0, submissions: [] });
  return _teacherWorkQueued(cid, function () {
    var draft = _studentWorkDraft(cid);
    var made = [];
    (Array.isArray(sids) ? sids : []).forEach(function (sid) {
      // A student named twice has work in by the second time.
      if (typeof sid !== 'string' || !_teacherWorkInClass(cid, sid, aid) || _teacherWorkSent(draft, sid, aid)) return;
      var stamp = new Date().toISOString();
      var sub = {
        id: _teacherWorkId(),
        assessment_id: aid,
        enrollment_id: sid,
        version: 1,
        state: 'sent',
        sent_by: 'teacher',
        on_paper: true,
        is_late: false,
        note: null,
        followed_plan: null,
        created_at: stamp,
        sent_at: stamp,
        files: [],
      };
      draft.submissions.push(sub);
      made.push(sid);
    });
    if (made.length) _studentWorkWrite(cid, draft);
    return {
      result: 'sent',
      marked: made.length,
      submissions: made.map(function (sid) {
        return getStudentSubmission(cid, sid, aid);
      }),
    };
  });
}

/* Delete Work (Colin's ruling 87): one student's newest handed-in work on
   a piece, every page with it, the teacher's included; the student can
   send again. Grades and comments stay. Photos of it still in the photo
   queue are deleted from the device. Answers { result: 'deleted', pages }
   (pages: how many went), { result: 'nothing_sent' }, { result:
   'not_found' }, or signed in { result: 'not_available' } (the server's
   delete is in Batch B, not applied). */
function deleteStudentWork(cid, sid, aid) {
  if (_workOnServer(cid)) return _serverDeleteWork(cid, sid, aid);
  if (!cid || !_isDemoSession()) return Promise.resolve({ result: 'not_available' });
  return _teacherWorkQueued(cid, function () {
    if (!_teacherWorkInClass(cid, sid, aid)) return { result: 'not_found' };
    var draft = _studentWorkDraft(cid);
    var sent = _teacherWorkSent(draft, sid, aid);
    if (!sent) return { result: 'nothing_sent' };
    draft.submissions = draft.submissions.filter(function (s) {
      return s !== sent;
    });
    _studentWorkWrite(cid, draft);
    return _teacherWorkForget(_queuePagesOf(sent)).then(function () {
      return { result: 'deleted', pages: (sent.files || []).length };
    });
  });
}

/* An address an <img> can show for one page ('page') or its thumbnail
   ('thumb'), whether it is a shipped sample file or a photo still in the
   photo queue: a Promise of { url, release } or null. Call release() when
   the picture leaves the screen (a queued photo's address holds its bytes
   in memory until then); calling it twice is harmless. A caller whose
   screen changed before the answer came should release it unused. */
function openStudentWorkPage(cid, file, which) {
  var name = file && (which === 'thumb' ? file.thumb_path : file.path);
  if (!name || typeof name !== 'string' || !_studentWorkStored(cid)) return Promise.resolve(null);
  var m = _STUDENT_WORK_QUEUE_PATH.exec(name);
  if (!m && _workOnServer(cid)) return _openServerWorkPage(cid, name);
  if (!m) {
    return studentWorkPageUrl(cid, file, which).then(function (url) {
      return url ? { url: url, release: function () {} } : null;
    });
  }
  if ((which === 'thumb') !== !!m[2]) return Promise.resolve(null);
  var q = window.PhotoQueue;
  if (!q || typeof q.blobs !== 'function' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return Promise.resolve(null);
  }
  return Promise.resolve()
    .then(function () {
      return q.blobs(m[1]);
    })
    .then(
      function (found) {
        var blob = found && (m[2] ? found.thumb : found.photo);
        if (!blob) return null;
        var url = URL.createObjectURL(blob);
        var released = false;
        return {
          url: url,
          release: function () {
            if (released) return;
            released = true;
            URL.revokeObjectURL(url);
          },
        };
      },
      function () {
        return null;
      },
    );
}

/* A student or assessment made offline gets its server id: the photos
   waiting for it take the new id too, so they upload to its real folder
   (kanban f2). The queue refuses anything that is not a server id. */
function _studentWorkRekeyed(e) {
  var d = e && e.detail;
  var q = window.PhotoQueue;
  // A live class's uploads on their way name the piece and the student too.
  if (d && (d.kind === 'assessment' || d.kind === 'student') && _isUuid(d.to)) {
    var uploads = _workUploads();
    var field = d.kind === 'assessment' ? 'aid' : 'sid';
    var moved = false;
    Object.keys(uploads).forEach(function (k) {
      if (uploads[k] && uploads[k][field] === d.from) {
        uploads[k][field] = d.to;
        moved = true;
      }
    });
    if (moved) _workUploadsSave(uploads);
    if (d.kind === 'assessment' && _workAssessHere[d.from]) {
      _workAssessHere[d.to] = _workAssessHere[d.from];
      delete _workAssessHere[d.from];
    }
  }
  if (!d || (d.kind !== 'assessment' && d.kind !== 'student') || !q || typeof q.rekey !== 'function') {
    return Promise.resolve(null);
  }
  return Promise.resolve()
    .then(function () {
      return q.rekey(d.from, d.to);
    })
    .then(null, function () {
      return null;
    });
}
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('fv:id-rekeyed', _studentWorkRekeyed);
}

/* ══════════════════════════════════════════════════════════════════
   Student work for a signed-in teacher (S5-W1, S6-W1)
   ══════════════════════════════════════════════════════════════════
   The same readers and writers as above, answered from the server
   (Batch B: migrations/2026111101_student_work_submissions.sql and
   2026111102_student_work_storage.sql; the shapes are in
   migrations/local-test/batch-b-contract.md). Only for a class the server
   keeps student-page rows for (_serverKeepsRows: signed in, a server id,
   the build switch on as the server says): any other class is answered
   exactly as before, and sent nothing new.

   What is read: list_course_submissions, when the class loads with Send
   Work on (or its Send Work is not known yet this session), when the
   grader or the Assignments page opens (refreshStudentWork, at most every
   30 seconds unless asked), and after this device's own writes land.
   Send Work and Keep Photos Until also come on the course row with the
   class. Kept in memory only (_workServer).

   What is shown is that answer with this device's writes not yet answered
   laid over it (_workServerView), so a change shows at once and a reload
   keeps it: the outbox's queued set_course_send_work,
   set_assessment_student_work, delete_submission and mark_handed_in_paper,
   and the teacher's uploads still on their way (gb-work-uploads).

   Add Work (start_work_upload, then finish_work_upload): the pages go into
   the photo queue (shared/photo-queue.js, IndexedDB) under local ids, and
   start_work_upload goes through the outbox. When it answers, the queue's
   records take the server's submission and file ids and the pages upload
   to the paths the server named, with the teacher's own sign-in; once
   every page and thumbnail is up the queue's commit hands them in with
   finish_work_upload under the batch's key. Offline the pages wait in the
   queue and the start in the outbox; both go when the device is back.
   Until then the work shows from the queue ("photo-queue:<id>" paths).

   Pages are shown through a signed link (300 seconds) that is fetched
   and shown from a blob: address, never put in an <img> as is (the
   Content Security Policy allows blob: and not the storage host).

   After a write that can queue files for deletion (delete_submission,
   start_work_upload, finish_work_upload) the edge function's sweep route
   runs the removal worker, as the contract asks. Best effort: if it does
   not answer, the files wait in the removal queue, unreadable.

   Sync problems show on the sync dot only (getSyncDotState): a refused
   write through the outbox's own dead letters, a page that will not send
   through the photo queue's failed count. Mark Up, reflections, revisions
   and group work stay Demo Mode's (Phase 2 and 3). */
var STUDENT_WORK_LINK_SECONDS = 300;
var _WORK_REFRESH_MS = 30000; // refreshStudentWork's wait between reads, unless forced
var _WORK_START_WAIT_MS = 8000; // how long Add Work waits for start_work_upload's answer before it answers itself
var _WORK_UPLOADS_KEY = 'gb-work-uploads'; // the teacher's uploads on their way, by start key
var _WORK_DROPPED_KEY = 'gb-work-dropped'; // { at }: photos refused after the screen said sent
var _WORK_DROPPED_MS = 24 * 60 * 60 * 1000; // how long the sync dot says so, unless clicked
var _workAwaited = {}; // start key → true while Add Work's screen still waits for the answer
var _workServer = {}; // cid → list_course_submissions' answer, as last read
var _workCourseRow = {}; // cid → { send_work, keep_photos_until }, as the server last said
var _workCourseHere = {}; // cid → a change of the two on its way: { patch, at }
var _workAssessHere = {}; // aid → a change of an assessment's settings on its way
var _workRead = {}; // cid → { running, at, writes }
var _workWrites = {}; // cid → how many of this device's work writes have landed
var _workViewMemo = {}; // cid → this turn's view (cleared at the end of the turn)
var _workViewClearing = false;
var _workQueueWired = false;
var _workSweepTimer = null;

function _workOnServer(cid) {
  return !!cid && !_isDemoSession() && _serverKeepsRows(cid);
}
/* True when class `cid`'s student work is the server's (a signed-in class
   with the build switch on). The screens ask it beside Demo Mode. */
function studentWorkLive(cid) {
  return _workOnServer(cid);
}

function _workChanged(cid) {
  delete _workViewMemo[cid];
}

function _workUploads() {
  var all = _safeParseLS(_WORK_UPLOADS_KEY, null);
  return _plainObject(all) ? all : {};
}
function _workUploadsSave(all) {
  if (!Object.keys(all).length) {
    try {
      localStorage.removeItem(_WORK_UPLOADS_KEY);
    } catch (e) {
      /* nothing kept */
    }
  } else _safeLSSet(_WORK_UPLOADS_KEY, JSON.stringify(all));
  Object.keys(_workViewMemo).forEach(_workChanged);
}
function _workUploadPut(rec) {
  var all = _workUploads();
  all[rec.key] = rec;
  _workUploadsSave(all);
}
function _workUploadDrop(key) {
  var all = _workUploads();
  if (!all[key]) return null;
  var rec = all[key];
  delete all[key];
  _workUploadsSave(all);
  return rec;
}
function _workUploadByBatch(batch) {
  var all = _workUploads();
  var key = Object.keys(all).find(function (k) {
    return all[k] && all[k].batch === batch;
  });
  return key ? all[key] : null;
}

// The class's queued writes to `endpoint`, oldest first (this teacher's).
function _workQueued(endpoint, match) {
  var q = window.v2Queue;
  var entries = [];
  try {
    entries = q && typeof q.queued === 'function' ? q.queued(endpoint) || [] : _queuedCardWrites(endpoint);
  } catch (e) {
    entries = [];
  }
  return entries.filter(function (e) {
    return e && e.payload && match(e.payload);
  });
}

function _workAssessmentOfClass(cid, aid) {
  return (getAssessments(cid) || []).some(function (a) {
    return a && a.id === aid;
  });
}

/* What the screens read for a signed-in class: the shape
   saveDemoStudentWork keeps ({ course, assessments, submissions }), from
   the server's last answer with this device's unanswered writes laid over
   it. Worked out once a turn. */
function _workServerView(cid) {
  if (_workViewMemo[cid]) return _workViewMemo[cid];
  var srv = _workServer[cid] || null;
  var course = Object.assign({ send_work: false, keep_photos_until: 'end_of_year' }, _workCourseRow[cid] || {});
  _workQueued('set_course_send_work', function (p) {
    return p.p_course_id === cid;
  }).forEach(function (e) {
    if (_plainObject(e.payload.p_patch)) Object.assign(course, e.payload.p_patch);
  });
  if (_workCourseHere[cid]) Object.assign(course, _workCourseHere[cid].patch);

  var byId = {};
  ((srv && srv.assessments) || []).forEach(function (a) {
    if (a && a.id) byId[a.id] = _studentWorkCopy(a);
  });
  _workQueued('set_assessment_student_work', function (p) {
    return _workAssessmentOfClass(cid, p.p_assessment_id);
  }).forEach(function (e) {
    var aid = e.payload.p_assessment_id;
    byId[aid] = Object.assign(byId[aid] || { id: aid }, e.payload.p_patch || {});
  });
  Object.keys(_workAssessHere).forEach(function (aid) {
    if (_workAssessmentOfClass(cid, aid)) byId[aid] = Object.assign(byId[aid] || { id: aid }, _workAssessHere[aid]);
  });

  var subs = _studentWorkCopy((srv && srv.submissions) || []);
  // Deleted here, not answered yet.
  var deleted = {};
  _workQueued('delete_submission', function () {
    return true;
  }).forEach(function (e) {
    deleted[e.payload.p_submission_id] = true;
  });
  subs = subs.filter(function (s) {
    return s && !deleted[s.id];
  });
  var sentFor = function (sid, aid) {
    return subs.find(function (s) {
      return s.state === 'sent' && s.enrollment_id === sid && s.assessment_id === aid;
    });
  };
  var stamp = function (at) {
    return at || new Date().toISOString();
  };
  // Handed In on Paper, not answered yet.
  _workQueued('mark_handed_in_paper', function (p) {
    return _workAssessmentOfClass(cid, p.p_assessment_id);
  }).forEach(function (e) {
    var aid = e.payload.p_assessment_id;
    (e.payload.p_enrollment_ids || []).forEach(function (sid) {
      if (sentFor(sid, aid)) return;
      subs.push({
        id: 'paper:' + e.id + ':' + sid,
        assessment_id: aid,
        enrollment_id: sid,
        version: 1,
        state: 'sent',
        sent_by: 'teacher',
        on_paper: true,
        is_late: false,
        note: null,
        followed_plan: null,
        created_at: stamp(e.created_at),
        sent_at: stamp(e.created_at),
        files: [],
      });
    });
  });
  // The teacher's uploads on their way: shown from the photo queue.
  var uploads = _workUploads();
  Object.keys(uploads)
    .map(function (k) {
      return uploads[k];
    })
    .filter(function (u) {
      return u && u.cid === cid;
    })
    .sort(function (x, y) {
      return String(x.at).localeCompare(String(y.at));
    })
    .forEach(function (u) {
      var now = sentFor(u.sid, u.aid);
      var files = function (first) {
        return (u.ids || []).map(function (qid, i) {
          var p = (u.pages || [])[i] || {};
          return {
            id: qid,
            page: first + i,
            path: 'photo-queue:' + qid,
            thumb_path: 'photo-queue:' + qid + ':thumb',
            bytes: p.bytes || null,
            thumb_bytes: p.thumb_bytes || null,
            width: p.width || null,
            height: p.height || null,
            rotation: 0,
            sha256: p.hash || null,
            added_by: 'teacher',
          };
        });
      };
      if (u.mode === 'add') {
        if (!now) return;
        var last = (now.files || []).reduce(function (n, f) {
          return Math.max(n, (f && f.page) || 0);
        }, 0);
        now.files = (now.files || []).concat(files(last + 1));
        return;
      }
      if (u.mode === 'new' && now) return; // the student's (or another device's) came first
      if (now)
        subs = subs.filter(function (s) {
          return s !== now;
        });
      subs.push({
        id: (u.server && u.server.submission_id) || u.sub,
        assessment_id: u.aid,
        enrollment_id: u.sid,
        version: (now && now.version) || 1,
        state: 'sent',
        sent_by: 'teacher',
        on_paper: false,
        is_late: false,
        note: null,
        followed_plan: null,
        created_at: u.at,
        sent_at: u.at,
        files: files(1),
      });
    });

  var view = {
    course: course,
    assessments: Object.keys(byId).map(function (k) {
      return byId[k];
    }),
    submissions: subs,
  };
  _workViewMemo[cid] = view;
  if (!_workViewClearing) {
    _workViewClearing = true;
    Promise.resolve().then(function () {
      _workViewClearing = false;
      _workViewMemo = {};
    });
  }
  return view;
}

/* ── Reading ── */

// The course row's two settings, when the class loads (_applyBundleCourseConfig).
function _noteCourseSendWork(cid, courseRow) {
  if (!cid || !_plainObject(courseRow) || !('send_work' in courseRow)) return;
  _workCourseRow[cid] = {
    send_work: courseRow.send_work === true,
    keep_photos_until: courseRow.keep_photos_until === 'end_of_term' ? 'end_of_term' : 'end_of_year',
  };
  _workChanged(cid);
}

/* Whether the class's work is worth reading. Every screen that shows it
   asks for Send Work on (GraderWork.workOnInClass), so with it off there
   is nothing to draw and nothing is read (S6-W1 review, should-fix 4).
   Read anyway when Send Work is not known yet (the read tells), while a
   change to it is on its way (the view already says on), or when the
   last answer held work (a class just turned off stays current). */
function _workReadWanted(cid) {
  if (!_workCourseRow[cid]) return true;
  if (_workServerView(cid).course.send_work === true) return true;
  var srv = _workServer[cid];
  return !!(srv && Array.isArray(srv.submissions) && srv.submissions.length);
}

function _workLook(cid) {
  return JSON.stringify(_workServerView(cid));
}

/* Read the class's work from the server, unless it was read in the last
   30 seconds (opts.force reads it anyway; a read under way is joined). A
   Promise of { changed } or { error }; never rejects. A screen that
   changes is redrawn. Nothing for any class but a live one, and nothing
   while its Send Work is off (_workReadWanted) unless opts.anyway. */
function refreshStudentWork(cid, opts) {
  // The class's marks and reflections are read with its work (S9-W1, S10-W1); not waited for.
  refreshCourseFeedback(cid, opts);
  if (!_workOnServer(cid)) return Promise.resolve({ changed: false });
  if (!(opts && opts.anyway) && !_workReadWanted(cid)) return Promise.resolve({ changed: false });
  var st = _workRead[cid] || (_workRead[cid] = {});
  if (st.running) {
    if (opts && opts.force) st.again = true;
    return st.running;
  }
  if (!(opts && opts.force) && st.at && Date.now() - st.at < _WORK_REFRESH_MS) {
    return Promise.resolve({ changed: false });
  }
  st.running = (async function () {
    var out = { changed: false };
    try {
      do {
        st.again = false;
        out = await _fetchStudentWork(cid);
      } while (st.again || out.skipped);
    } catch (e) {
      out = { error: e };
    } finally {
      st.running = null;
    }
    if (out.changed) _invalidateAndRerender();
    return out;
  })();
  return st.running;
}

async function _fetchStudentWork(cid) {
  var writes = _workWrites[cid] || 0;
  var res;
  try {
    res = await _callRpcWithAuthGuard(
      'list_course_submissions',
      { p_course_id: cid },
      { suppressSessionExpiredModal: true },
    );
  } catch (e) {
    res = { error: e };
  }
  var data = res && !res.error ? _rpcObject(res.data) : null;
  if (!data || !Array.isArray(data.submissions)) {
    // A read that failed changes nothing: the next one tries again.
    if (res && res.error && !res.error.handledSessionExpired)
      console.warn('list_course_submissions failed:', res.error);
    return { error: (res && res.error) || { message: 'no answer' } };
  }
  if (!_workOnServer(cid)) return { changed: false };
  // One of this device's writes landed while the read was out: it is from before that write.
  if ((_workWrites[cid] || 0) !== writes) return { skipped: true };
  var was = _workLook(cid);
  _workServer[cid] = data;
  if (_plainObject(data.course)) _noteCourseSendWork(cid, Object.assign({ send_work: false }, data.course));
  (_workRead[cid] || (_workRead[cid] = {})).at = Date.now();
  _workChanged(cid);
  return { changed: was !== _workLook(cid) };
}

/* Before a delete warning says whether photos go too (S8-F1): the
   class's work, read from the server once this session if it has not
   been (with Send Work off nothing else reads it, and photos sent before
   it was turned off are still deleted). null when nothing needs reading
   (Demo Mode, a class whose work is not the server's, or read already):
   the readers answer now. Else a Promise of { known: true } once the
   readers (getCourseSubmissions, CmStudentPage.studentsWithPhotos) answer
   for the server, or { known: false } when the read failed: the warning
   then says photos go rather than miss them. Never rejects. */
function readStudentWorkForDelete(cid) {
  if (!_workOnServer(cid)) return null;
  var st = _workRead[cid];
  if (st && st.at && !st.running) return null;
  return refreshStudentWork(cid, { force: true, anyway: true }).then(
    function (out) {
      return { known: !(out && out.error) && !!(_workRead[cid] && _workRead[cid].at) };
    },
    function () {
      return { known: false };
    },
  );
}

/* The class has just loaded from the server with its student page on
   (_loadServerGradeReturns): its work too, when Send Work is on or not
   known yet. Never waited for, never a failed load. */
function _loadServerStudentWork(cid, fresh) {
  if (!_workOnServer(cid)) return;
  var known = _workCourseRow[cid];
  var readBefore = !!(_workRead[cid] && _workRead[cid].at);
  if (known ? known.send_work !== true : readBefore || fresh) return;
  refreshStudentWork(cid, { force: true });
}

// A write of this device's landed: reads begun before it are dropped, and the class read again soon.
function _workWriteLanded(cid) {
  _workWrites[cid] = (_workWrites[cid] || 0) + 1;
  _workChanged(cid);
  setTimeout(function () {
    refreshStudentWork(cid, { force: true });
  }, 0);
}

/* ── The two class settings and an assessment's ── */

/* Send Work and Keep Photos Until: `patch` names what changes, any of
   { send_work: boolean, keep_photos_until: 'end_of_year' | 'end_of_term' }.
   Answers { ok } at once. Demo Mode keeps it with its sample work; a live
   class sends set_course_send_work through the outbox. */
function setCourseSendWork(cid, patch) {
  var clean = {};
  if (patch && (patch.send_work === true || patch.send_work === false)) clean.send_work = patch.send_work;
  if (patch && (patch.keep_photos_until === 'end_of_year' || patch.keep_photos_until === 'end_of_term')) {
    clean.keep_photos_until = patch.keep_photos_until;
  }
  if (!cid || !Object.keys(clean).length) return { ok: false };
  if (_isDemoSession()) {
    var work = getCourseSubmissions(cid);
    work.course = Object.assign({}, work.course, clean);
    return { ok: saveDemoStudentWork(cid, work) };
  }
  if (!_workOnServer(cid)) return { ok: false };
  var mine = { patch: Object.assign({}, (_workCourseHere[cid] || {}).patch, clean) };
  _workCourseHere[cid] = mine;
  _workChanged(cid);
  _trackPendingSync(
    Promise.resolve(
      _writeRpc('set_course_send_work', { p_course_id: cid, p_patch: clean, p_idempotency_key: _newEntryId() }),
    ).then(function (res) {
      var still = _workCourseHere[cid] === mine;
      if (still) delete _workCourseHere[cid];
      var data = res && !res.error ? _rpcObject(res.data) : null;
      if (data && still) _noteCourseSendWork(cid, data);
      if (res && res.error && !res.error.handledSessionExpired) console.warn('set_course_send_work failed:', res.error);
      _workWriteLanded(cid);
    }),
  );
  return { ok: true };
}

/* An assessment's Student Work card, as the form saves it: only what
   differs from what the class holds is sent (set_assessment_student_work).
   `w` is { students_send, after_due, accept_until, group_work,
   students_see_markup }. Answers { ok } at once. */
function saveAssessmentStudentWork(cid, aid, w) {
  if (!cid || !aid || !_plainObject(w)) return { ok: false };
  var now = getAssessmentStudentWork(cid, aid);
  var row = {
    students_send: w.students_send,
    after_due: w.after_due,
    accept_until: w.after_due === 'until' ? w.accept_until || null : null,
    group_work: w.group_work,
    students_see_markup: w.students_see_markup !== false,
  };
  if (_isDemoSession()) {
    var work = getCourseSubmissions(cid);
    work.assessments = (work.assessments || [])
      .filter(function (x) {
        return x && x.id !== aid;
      })
      .concat([Object.assign({ id: aid }, row)]);
    return { ok: saveDemoStudentWork(cid, work) };
  }
  if (!_workOnServer(cid)) return { ok: false };
  var patch = {};
  Object.keys(row).forEach(function (k) {
    if (row[k] !== now[k]) patch[k] = row[k];
  });
  // The server keeps a date only with Until, and needs one with it.
  if ('after_due' in patch && row.after_due === 'until') patch.accept_until = row.accept_until;
  if ('accept_until' in patch && row.after_due !== 'until') delete patch.accept_until;
  if (row.after_due === 'until' && !row.accept_until) return { ok: false };
  if (!Object.keys(patch).length) return { ok: true };
  var mine = Object.assign({}, patch);
  _workAssessHere[aid] = Object.assign({}, _workAssessHere[aid], mine);
  var held = _workAssessHere[aid];
  _workChanged(cid);
  _trackPendingSync(
    Promise.resolve(
      _writeRpc('set_assessment_student_work', {
        p_assessment_id: aid,
        p_patch: patch,
        p_idempotency_key: _newEntryId(),
      }),
    ).then(function (res) {
      var data = res && !res.error ? _rpcObject(res.data) : null;
      var id = (data && data.id) || aid;
      if (_workAssessHere[aid] === held) delete _workAssessHere[aid];
      if (data && _workServer[cid]) {
        var list = (_workServer[cid].assessments || []).filter(function (a) {
          return a && a.id !== id;
        });
        list.push(data);
        _workServer[cid].assessments = list;
      }
      if (res && res.error && !res.error.handledSessionExpired) {
        console.warn('set_assessment_student_work failed:', res.error);
      }
      _workWriteLanded(cid);
    }),
  );
  return { ok: true };
}

/* ── Showing a page ── */

var _WORK_STORAGE_PATH =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}){4}(-thumb)?\.jpg$/;

/* One page or thumbnail of a live class, from storage: a link signed for
   300 seconds, fetched, and shown from a blob: address. { url, release }
   or null. Only a path in this class's own folder. */
function _openServerWorkPage(cid, name) {
  if (!_WORK_STORAGE_PATH.test(name) || name.indexOf(String(cid).toLowerCase() + '/') !== 0) {
    return Promise.resolve(null);
  }
  var sb = getSupabase();
  if (!sb || !sb.storage || typeof fetch !== 'function' || typeof URL.createObjectURL !== 'function') {
    return Promise.resolve(null);
  }
  var bucket = (_workServer[cid] && _workServer[cid].bucket) || 'student-photos';
  return Promise.resolve()
    .then(function () {
      return sb.storage.from(bucket).createSignedUrl(name, STUDENT_WORK_LINK_SECONDS);
    })
    .then(function (res) {
      var link = res && !res.error && res.data && res.data.signedUrl;
      if (!link) return null;
      return fetch(link, { credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' }).then(function (r) {
        return r && r.ok ? r.blob() : null;
      });
    })
    .then(function (blob) {
      if (!blob) return null;
      // Always a picture: what storage hands back is shown in an <img> and nothing else.
      var url = URL.createObjectURL(new Blob([blob], { type: 'image/jpeg' }));
      var released = false;
      return {
        url: url,
        release: function () {
          if (released) return;
          released = true;
          URL.revokeObjectURL(url);
        },
      };
    })
    .then(null, function () {
      return null;
    });
}

/* ── Add Work ── */

// The photo queue, told how a signed-in teacher's pages go up and are handed in.
function _wireWorkQueue() {
  var q = window.PhotoQueue;
  if (!q || typeof q.configure !== 'function' || _isDemoSession() || !_writesEnabled()) return null;
  if (!_workQueueWired) {
    _workQueueWired = true;
    q.configure({
      upload: _workUploadFile,
      commit: _workCommit,
      owner: function () {
        return _teacherId || null;
      },
    });
    if (typeof q.subscribe === 'function') q.subscribe(_updateSyncIndicator);
  }
  return q;
}

function _workUploadFile(path, blob) {
  var sb = getSupabase();
  if (!sb || !sb.storage) return Promise.resolve({ error: { message: 'offline: no client', status: 503 } });
  return Promise.resolve(
    sb.storage.from('student-photos').upload(path, blob, { contentType: 'image/jpeg', upsert: false }),
  ).then(function (res) {
    return { error: (res && res.error) || null };
  });
}

function _workPagesJson(rec) {
  return (rec.pages || []).map(function (p) {
    var out = {};
    ['width', 'height', 'bytes', 'thumb_bytes'].forEach(function (k) {
      var n = Number(p[k]);
      if (isFinite(n) && n >= 1 && Math.floor(n) === n) out[k] = n;
    });
    return out;
  });
}

function _workStart(rec) {
  return _writeRpc('start_work_upload', {
    p_assessment_id: rec.aid,
    p_enrollment_id: rec.sid,
    p_pages: _workPagesJson(rec),
    p_mode: rec.mode,
    p_idempotency_key: rec.key,
  });
}

// Give up an upload: its photos leave the device and the screens forget it.
function _workUploadAbandon(key) {
  var rec = _workUploadDrop(key);
  if (!rec) return Promise.resolve(null);
  return _teacherWorkForget(rec.ids || []).then(function () {
    return rec;
  });
}

/* start_work_upload answered (from the call itself, or from the outbox's
   own event after a reload). `ready`: the waiting pages take the server's
   ids and go up. Anything else, while Add Work's screen still waits for
   the answer: the photos are dropped, the class read again, and the
   screen says why. Once the screen has said sent (the wait ran out, or
   the page was reloaded) the photos are not dropped without a word: see
   _workRefusedAfterSent. Returns the answer as the screens take it. Runs
   once per answer; a second call for the same start does nothing. */
function _workUploadStarted(key, data) {
  var all = _workUploads();
  var rec = all[key];
  var res = _rpcObject(data);
  var told = !_workAwaited[key];
  if (!rec) return Promise.resolve(res || { result: 'store_failed' });
  if (rec.server && rec.restartKey !== key) return Promise.resolve({ result: 'sent' });
  if (!res || res.result !== 'ready') {
    if (told && _workRefusedAfterSent(rec, res)) return Promise.resolve({ result: 'sent', queued: true });
    return _workUploadAbandon(key).then(function () {
      if (told) _workNoteDropped();
      _workWriteLanded(rec.cid);
      _sweepWorkRemovals();
      if (res && res.result === 'already_sent') {
        if (res.submission && _workServer[rec.cid]) _workServerTake(rec.cid, res.submission);
        return { result: 'already_sent', submission: getStudentSubmission(rec.cid, rec.sid, rec.aid) };
      }
      return res && res.result ? res : { result: 'store_failed' };
    });
  }
  var files = (res.files || []).slice().sort(function (x, y) {
    return (x.page || 0) - (y.page || 0);
  });
  var q = _wireWorkQueue();
  if (!q || files.length !== (rec.ids || []).length) {
    return _workUploadAbandon(key).then(function () {
      if (told) _workNoteDropped();
      return { result: 'store_failed' };
    });
  }
  return Promise.resolve(q.ready && q.ready())
    .then(function () {
      var pages = typeof q.pages === 'function' ? q.pages() : [];
      var map = {};
      var bad = false;
      rec.ids.forEach(function (qid, i) {
        var meta = pages.find(function (p) {
          return p.id === qid;
        });
        if (!meta) return (bad = true);
        var ids = Object.assign({}, meta.ids, { submission: res.submission_id, file: files[i].file_id });
        // Where the queue will put it is where the server said, or nothing goes.
        try {
          if (q.pathFor(ids) !== String(files[i].path).toLowerCase()) bad = true;
        } catch (e) {
          bad = true;
        }
        map[meta.ids.submission] = res.submission_id;
        map[meta.ids.file] = files[i].file_id;
      });
      if (bad) return { bad: true };
      return Promise.resolve(q.rekey(map)).then(function (out) {
        return out && out.ok ? { ok: true } : { bad: true };
      });
    })
    .then(function (done) {
      if (done.bad) {
        return _workUploadAbandon(key).then(function () {
          if (told) _workNoteDropped();
          return { result: 'store_failed' };
        });
      }
      var now = _workUploads();
      var held = now[rec.key];
      if (held) {
        held.server = { submission_id: res.submission_id, files: files, finish_by: res.finish_by || null };
        delete held.restartKey;
        delete held.restarting;
        delete held.held;
        _workUploadsSave(now);
      }
      // A restart sends every page again, to its new path.
      var again = rec.restartKey === key;
      return Promise.all(
        again
          ? rec.ids.map(function (qid) {
              return Promise.resolve(q.retry(qid, { again: true })).then(null, function () {});
            })
          : [],
      ).then(function () {
        _sweepWorkRemovals(); // an earlier upload for the piece was dropped
        q.send();
        return { result: 'sent', submission: getStudentSubmission(rec.cid, rec.sid, rec.aid) };
      });
    });
}

/* A start refused after Add Work's screen had already said sent (offline,
   or past the 8-second wait), so no screen is there to say why. True when
   the photos are kept:
   - nothing_sent: the work they were to add to or replace went, so they
     are started again as new work;
   - class_full, or no answer at all: held on the device, shown on the sync
     dot, and tried again when a page opens or the sync dot is clicked
     (retryHeldStudentWork).
   False for the rest (already_sent, on_paper, too_many_pages: they cannot
   go in as asked); the caller lets them go and the sync dot says so. */
function _workRefusedAfterSent(rec, res) {
  var result = res && res.result;
  if (result && result !== 'nothing_sent' && result !== 'class_full') return false;
  var all = _workUploads();
  var held = all[rec.key];
  if (!held) return false;
  delete held.restarting; // this answer may be a restart's own
  if (result === 'nothing_sent') {
    _workUploadsSave(all);
    _workRestart(held, 'new');
    return true;
  }
  held.held = result || 'no_answer';
  _workUploadsSave(all);
  _workWriteLanded(rec.cid);
  _updateSyncIndicator();
  return true;
}

// Photos let go after the screen said sent: the sync dot says so for a day, or until it is clicked.
function _workNoteDropped() {
  _safeLSSet(_WORK_DROPPED_KEY, JSON.stringify({ at: new Date().toISOString() }));
  _updateSyncIndicator();
}

/* The sync dot was clicked, or a page opened: held uploads are started
   again, and the note of photos let go is cleared. */
function retryHeldStudentWork() {
  try {
    localStorage.removeItem(_WORK_DROPPED_KEY);
  } catch (e) {
    /* nothing kept */
  }
  if (_isDemoSession() || !_writesEnabled()) return _updateSyncIndicator();
  var all = _workUploads();
  Object.keys(all).forEach(function (k) {
    if (all[k] && all[k].held) _workRestart(all[k]);
  });
  _updateSyncIndicator();
}

// A submission as the server now has it, in place of the class's copy of it.
function _workServerTake(cid, sub) {
  var srv = _workServer[cid];
  if (!srv || !_plainObject(sub) || !sub.id) return;
  srv.submissions = (srv.submissions || []).filter(function (s) {
    return (
      s &&
      s.id !== sub.id &&
      !(s.enrollment_id === sub.enrollment_id && s.assessment_id === sub.assessment_id && s.state === 'sent')
    );
  });
  if (sub.state === 'sent') srv.submissions.push(_studentWorkCopy(sub));
  _workChanged(cid);
}

/* The photo queue's commit: every page and thumbnail of one upload is in
   storage; finish_work_upload hands them in, in order, under the batch's
   key. Answers { error } as the queue reads it: none once handed in (or
   dropped because the student's came first), a passing one while pages are
   still missing or the upload is being started again, and a lasting one
   for what storage holds that it should not. */
async function _workCommit(batch) {
  var rec = _workUploadByBatch(batch.key);
  var files = (batch.files || [])
    .slice()
    .sort(function (x, y) {
      return (x.order || 0) - (y.order || 0);
    })
    .map(function (f) {
      return { file_id: f.id, sha256: f.hash };
    });
  if (
    !files.every(function (f) {
      return _isUuid(f.file_id) && /^[0-9a-f]{64}$/.test(String(f.sha256 || ''));
    })
  ) {
    return { error: { message: 'a page has no fingerprint', status: 422 } };
  }
  if (rec && rec.restarting) return { error: { message: 'starting again', status: 503 } };
  var res = await _callRpcWithAuthGuard(
    'finish_work_upload',
    { p_submission_id: batch.ids.submission, p_files: files, p_idempotency_key: batch.key },
    { suppressSessionExpiredModal: true },
  );
  if (!res || res.error) return { error: (res && res.error) || { message: 'no answer', status: 503 } };
  var data = _rpcObject(res.data) || {};
  var cid = (rec && rec.cid) || batch.ids.course;
  if (data.result === 'sent' || data.result === 'already_sent') {
    if (data.result === 'sent' && data.submission) _workServerTake(cid, data.submission);
    if (rec) _workUploadDrop(rec.key);
    _workWriteLanded(cid);
    _sweepWorkRemovals(); // Replace Them queues the old photos; already_sent drops this upload's
    _invalidateAndRerender();
    return { error: null };
  }
  if (data.result === 'missing_pages') {
    var q = window.PhotoQueue;
    var pages = q && typeof q.pages === 'function' ? q.pages() : [];
    await Promise.all(
      (data.missing || []).map(function (fileId) {
        var meta = pages.find(function (p) {
          return p.ids && p.ids.file === fileId;
        });
        return meta ? Promise.resolve(q.retry(meta.id, { again: true })).then(null, function () {}) : null;
      }),
    );
    return { error: { message: 'missing_pages', status: 503 } };
  }
  if (data.result === 'gone' && rec) {
    // Dropped (two hours passed, or the work it was for went): it is started again.
    _workRestart(rec);
    return { error: { message: 'starting again', status: 503 } };
  }
  return { error: { message: String(data.result || 'refused'), status: 409 } };
}

/* An upload the server no longer holds is started again with a new key:
   as the same choice when the work it was for is still in, else as new
   (or as `mode`, when the caller knows). Its pages go up again to the new
   paths (_workUploadStarted). */
function _workRestart(rec, mode) {
  var all = _workUploads();
  var held = all[rec.key];
  if (!held || held.restarting) return;
  var newKey = _newEntryId();
  held.restarting = true;
  delete held.server;
  delete held.held;
  if (mode) held.mode = mode;
  else if (held.mode !== 'new' && !getStudentSubmission(held.cid, held.sid, held.aid)) held.mode = 'new';
  if (held.mode === 'new') held.target = null;
  // Kept under its new key, so the outbox's answer finds it.
  delete all[rec.key];
  held.key = newKey;
  held.restartKey = newKey;
  all[newKey] = held;
  _workUploadsSave(all);
  Promise.resolve(_workStart(held)).then(function (res) {
    if (res && res.error) {
      if (!res.error.handledSessionExpired) console.warn('start_work_upload (again) failed:', res.error);
      return;
    }
    _workUploadStarted(newKey, res && res.data);
  });
}

/* Add Work, Add as More Pages and Replace Them for a live class: the
   answers _teacherWork gives in Demo Mode, from what the class holds.
   Waits up to _WORK_START_WAIT_MS for the server's start; past that (or
   offline) it answers 'sent' and the work shows from the queue until it
   is in. */
function _serverTeacherWork(cid, sid, aid, pages, mode) {
  if (!_teacherWorkPagesOk(pages)) return Promise.resolve({ result: 'invalid' });
  return _teacherWorkQueued(cid, function () {
    if (!_teacherWorkInClass(cid, sid, aid)) return { result: 'not_found' };
    var sent = getStudentSubmission(cid, sid, aid);
    if (mode === 'new' && sent) return { result: 'already_sent', submission: sent };
    if (mode !== 'new' && !sent) return { result: 'nothing_sent' };
    if (mode === 'add' && sent.on_paper) return { result: 'on_paper', submission: sent };
    var have = mode === 'add' ? (sent.files || []).length : 0;
    if (have + pages.length > STUDENT_WORK_MAX_PAGES) {
      return { result: 'too_many_pages', room: STUDENT_WORK_MAX_PAGES - have };
    }
    // Work that is itself still on its way can be added to once it is in.
    if (mode !== 'new' && !_isUuid(sent.id)) return { result: 'uploading' };
    var q = _wireWorkQueue();
    if (!q) return { result: 'no_photo_store' };
    var sub = _teacherWorkId();
    return _teacherWorkQueuePages(cid, sid, aid, sub, pages).then(function (kept) {
      if (!kept.ok) return kept.answer;
      var rec = {
        key: _newEntryId(),
        cid: cid,
        aid: aid,
        sid: sid,
        mode: mode,
        sub: sub,
        target: mode === 'new' ? null : sent.id,
        batch: kept.batch,
        ids: kept.ids,
        pages: pages.map(function (p) {
          return {
            hash: p.hash || null,
            bytes: p.blob.size,
            thumb_bytes: p.thumb.size,
            width: p.width || null,
            height: p.height || null,
          };
        }),
        at: new Date().toISOString(),
        server: null,
      };
      _workUploadPut(rec);
      // Until the wait runs out, a refusal is this screen's to say (_workUploadStarted).
      _workAwaited[rec.key] = true;
      var started = Promise.resolve(_workStart(rec)).then(function (res) {
        if (res && res.error) {
          if (!res.error.handledSessionExpired) console.warn('start_work_upload failed:', res.error);
          // Refused (the outbox's dead letter says so on the sync dot): the photos go.
          return _workUploadAbandon(rec.key).then(function () {
            return { result: 'store_failed' };
          });
        }
        return _workUploadStarted(rec.key, res && res.data);
      });
      started.then(function () {
        delete _workAwaited[rec.key];
      });
      _trackPendingSync(started);
      var waited = new Promise(function (resolve) {
        setTimeout(function () {
          delete _workAwaited[rec.key];
          resolve({ result: 'sent', queued: true });
        }, _WORK_START_WAIT_MS);
      });
      return Promise.race([started, waited]);
    });
  });
}

/* Delete Work for a live class: delete_submission for work that is in;
   an upload of this device's still on its way is given up as well. */
function _serverDeleteWork(cid, sid, aid) {
  return _teacherWorkQueued(cid, function () {
    if (!_teacherWorkInClass(cid, sid, aid)) return { result: 'not_found' };
    var sent = getStudentSubmission(cid, sid, aid);
    if (!sent) return { result: 'nothing_sent' };
    var pages = (sent.files || []).length;
    var uploads = _workUploads();
    var mine = Object.keys(uploads).filter(function (k) {
      var u = uploads[k];
      return u && u.cid === cid && u.sid === sid && u.aid === aid;
    });
    var ids = [];
    mine.forEach(function (k) {
      var u = uploads[k];
      if (u.server && u.server.submission_id) ids.push(u.server.submission_id);
      if (u.target) ids.push(u.target);
    });
    // Handed In on Paper not answered yet has no id to delete by.
    if (!_isUuid(sent.id) && !mine.length) return { result: 'uploading' };
    if (_isUuid(sent.id)) ids.push(sent.id);
    return Promise.all(mine.map(_workUploadAbandon)).then(function () {
      ids
        .filter(function (id, i) {
          return _isUuid(id) && ids.indexOf(id) === i;
        })
        .forEach(function (id) {
          _trackPendingSync(
            Promise.resolve(
              _writeRpc('delete_submission', { p_submission_id: id, p_idempotency_key: _newEntryId() }),
            ).then(function (res) {
              if (res && !res.error) {
                var srv = _workServer[cid];
                if (srv) {
                  srv.submissions = (srv.submissions || []).filter(function (s) {
                    return s && s.id !== id;
                  });
                }
              } else if (res && res.error && !res.error.handledSessionExpired) {
                console.warn('delete_submission failed:', res.error);
              }
              _workWriteLanded(cid);
              _sweepWorkRemovals();
            }),
          );
        });
      _workChanged(cid);
      return { result: 'deleted', pages: pages };
    });
  });
}

/* Handed In on Paper for a live class (mark_handed_in_paper): shown at
   once, sent through the outbox. */
function _serverMarkOnPaper(cid, aid, sids) {
  return _teacherWorkQueued(cid, function () {
    var who = [];
    (Array.isArray(sids) ? sids : []).forEach(function (sid) {
      if (typeof sid !== 'string' || who.indexOf(sid) >= 0) return;
      if (!_teacherWorkInClass(cid, sid, aid) || getStudentSubmission(cid, sid, aid)) return;
      who.push(sid);
    });
    if (!who.length) return { result: 'sent', marked: 0, submissions: [] };
    _trackPendingSync(
      Promise.resolve(
        _writeRpc('mark_handed_in_paper', {
          p_assessment_id: aid,
          p_enrollment_ids: who,
          p_idempotency_key: _newEntryId(),
        }),
      ).then(function (res) {
        var data = res && !res.error ? _rpcObject(res.data) : null;
        ((data && data.submissions) || []).forEach(function (s) {
          _workServerTake(cid, s);
        });
        if (res && res.error && !res.error.handledSessionExpired)
          console.warn('mark_handed_in_paper failed:', res.error);
        _workWriteLanded(cid);
      }),
    );
    _workChanged(cid);
    return {
      result: 'sent',
      marked: who.length,
      submissions: who.map(function (sid) {
        return getStudentSubmission(cid, sid, aid);
      }),
    };
  });
}

/* The edge function's sweep route: the removal worker, once things have
   settled (two seconds after the last call). Best effort; nothing waits
   on it and nothing shows if it fails. */
function _sweepWorkRemovals() {
  if (_isDemoSession() || typeof fetch !== 'function') return;
  if (_workSweepTimer) clearTimeout(_workSweepTimer);
  _workSweepTimer = setTimeout(function () {
    _workSweepTimer = null;
    var sb = getSupabase();
    var base = ((window.__ENV && window.__ENV.SUPABASE_URL) || '').replace(/\/$/, '');
    if (!sb || !sb.auth || !base) return;
    Promise.resolve(sb.auth.getSession())
      .then(function (r) {
        var token = r && r.data && r.data.session && r.data.session.access_token;
        if (!token) return null;
        return fetch(base + '/functions/v1/student-submit?forceFunctionRegion=ca-central-1', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ route: 'sweep', access_token: token }),
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
          cache: 'no-store',
        });
      })
      .then(null, function () {
        /* the files wait in the removal queue for the next run */
      });
  }, 2000);
}

/* The outbox's word on a work write (_onOutboxEvent): a start that landed
   after a reload is followed up here; a refused one drops its photos; any
   refused work write has the class read again. */
function _onWorkWriteEvent(kind, endpoint, payload, data) {
  try {
    if (endpoint === 'start_work_upload' && payload && payload.p_idempotency_key) {
      if (kind === 'flush:success') _workUploadStarted(payload.p_idempotency_key, data);
      else _workUploadAbandon(payload.p_idempotency_key);
    }
    if (kind !== 'flush:dead-letter') return;
    var cid =
      endpoint === 'set_course_send_work'
        ? payload && payload.p_course_id
        : _classOfAssessment(payload && payload.p_assessment_id);
    if (cid) _workWriteLanded(cid);
    else
      Object.keys(_workServer).forEach(function (c) {
        _workWriteLanded(c);
      });
  } catch (e) {
    console.warn('student work: following up a write failed:', e);
  }
}
var _WORK_ENDPOINTS = {
  set_course_send_work: true,
  set_assessment_student_work: true,
  start_work_upload: true,
  delete_submission: true,
  mark_handed_in_paper: true,
};

/* A signed-in page opening: the queue learns how to send, and pages left
   waiting by an earlier visit go (an upload whose start has no answer
   waits for the outbox). */
function _resumeWorkUploads() {
  if (_isDemoSession() || !_writesEnabled() || !Object.keys(_workUploads()).length) return;
  var q = _wireWorkQueue();
  var all = _workUploads();
  Object.keys(all).forEach(function (k) {
    if (all[k] && all[k].held) _workRestart(all[k]); // refused after the screen said sent: tried again
  });
  if (q && typeof q.send === 'function') q.send();
}
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('load', function () {
    setTimeout(_resumeWorkUploads, 0);
  });
}

/* ══════════════════════════════════════════════════════════════════
   Mark Up and Reflect on Feedback for a signed-in teacher (S9-W1, S10-W1)
   ══════════════════════════════════════════════════════════════════
   The same readers and writers as the two Demo Mode blocks below, answered
   from the server (migrations/2026111120_markup_reflect_revise.sql:
   save_markup, list_assessment_markup, return_work, set_course_feedback_options,
   answer_reflection, list_course_feedback). Only for a class the server keeps
   student-page rows for (_workOnServer, as Send Work's wiring above): any
   other class is answered exactly as before and sent nothing new. Return
   for Revision, its edit and Take Back are here (S7-W1, "Revisions" below);
   a student's own revision (revision_start, revision_finish, revision_unsend)
   and group work are not (Phase 3).

   What is read: list_course_feedback (the class's switches, a line for
   every marked page, every reflection) when the class loads with Send Work
   or Reflect on Feedback on, and whenever Send Work's own read runs
   (refreshStudentWork); and, for each piece with marked pages,
   list_assessment_markup, when that line changed. Mark Up reads its piece
   again itself before it draws (loadAssessmentMarkup). Kept in memory only:
   nothing about a student is stored on the device beyond the outbox's own
   queued writes, which Sign Out clears.

   What is shown is that answer with this device's writes not yet answered
   laid over it, so a mark made or an answer sent shows at once and a
   reload keeps it: the outbox's queued save_markup, return_work and
   answer_reflection, and set_course_feedback_options.

   Every write goes through the outbox with its own idempotency key. A save
   or a Return for one student takes that student's cell key
   (cell:<student>:<piece>, shared/offline-queue.js), so the marks a Return
   gives are the ones saved before it, and two saves in a row go as one.
   A page whose id is local (still uploading from the photo queue) has no
   marks: Mark Up is not offered on it (getPageMarkup answers null).

   Sync problems show on the sync dot only: a refused write is the outbox's
   own dead letter. Nothing here shows a banner or a toast. */
var _MARKUP_SAVE_WAIT_MS = 5000; // how long a save waits for the server's answer before the screen goes on
var _FB_REFRESH_MS = 30000; // refreshCourseFeedback's wait between reads, unless forced
var _fbCourseRow = {}; // cid → { reflect_on_feedback, show_my_learning }, as the server last said
var _fbCourseHere = {}; // cid → a change of the two on its way: { patch }
var _fbServer = {}; // cid → list_course_feedback's answer, as last read
var _fbRows = {}; // cid → { assessment id → { file id → list_assessment_markup's row } }
var _fbRead = {}; // cid → { running, again, at }
var _fbWrites = {}; // cid → how many of this device's feedback writes have landed
var _fbMemo = {}; // cid → { name → this turn's view }
var _fbMemoClearing = false;
var _FB_ENDPOINTS = {
  set_course_feedback_options: true,
  save_markup: true,
  return_work: true,
  answer_reflection: true,
  // Revisions (S7-W1): Return for Revision, its edit and Take Back.
  return_for_revision: true,
  set_revision_request: true,
  cancel_revision: true,
};

/* True when class `cid`'s marks and reflections are the server's (a
   signed-in class with the build switch on). */
function _fbOn(cid) {
  return _workOnServer(cid);
}
// Demo Mode, or a class the server keeps rows for: where the readers answer.
function _fbReads(cid) {
  return !!cid && (_isDemoSession() || _fbOn(cid));
}

function _fbChanged(cid) {
  delete _fbMemo[cid];
}
function _fbMemoized(cid, name, build) {
  var held = _fbMemo[cid] || (_fbMemo[cid] = {});
  if (name in held) return held[name];
  held[name] = build();
  if (!_fbMemoClearing) {
    _fbMemoClearing = true;
    Promise.resolve().then(function () {
      _fbMemoClearing = false;
      _fbMemo = {};
    });
  }
  return held[name];
}

// The course row's two switches, when the class loads (_applyBundleCourseConfig) or list_course_feedback is read.
function _noteCourseFeedbackOptions(cid, courseRow) {
  if (!cid || !_plainObject(courseRow)) return;
  if (!('reflect_on_feedback' in courseRow) && !('show_my_learning' in courseRow)) return;
  _fbCourseRow[cid] = {
    reflect_on_feedback: courseRow.reflect_on_feedback === true,
    show_my_learning: courseRow.show_my_learning === true,
  };
  _fbChanged(cid);
}

// The two switches as the screens read them: the server's, with this device's unanswered change laid over.
function _fbCourseOptions(cid) {
  return _fbMemoized(cid, 'course', function () {
    var out = Object.assign({ reflect_on_feedback: false, show_my_learning: false }, _fbCourseRow[cid] || {});
    var lay = function (patch) {
      if (!_plainObject(patch)) return;
      ['reflect_on_feedback', 'show_my_learning'].forEach(function (k) {
        if (typeof patch[k] === 'boolean') out[k] = patch[k];
      });
    };
    _workQueued('set_course_feedback_options', function (p) {
      return p.p_course_id === cid;
    }).forEach(function (e) {
      lay(e.payload.p_patch);
    });
    if (_fbCourseHere[cid]) lay(_fbCourseHere[cid].patch);
    return out;
  });
}

/* True when reading the class's feedback is worth a request: Reflect on
   Feedback is on, or Send Work is (Mark Up lives on it). A class with both
   off is sent nothing. */
function _fbWanted(cid) {
  if (!_fbOn(cid)) return false;
  if (_fbCourseOptions(cid).reflect_on_feedback) return true;
  return _workServerView(cid).course.send_work === true;
}

// This device's unanswered writes among `endpoints`, oldest first.
function _fbQueuedWrites(endpoints) {
  var all = [];
  endpoints.forEach(function (endpoint, order) {
    _workQueued(endpoint, function () {
      return true;
    }).forEach(function (e, i) {
      all.push({ endpoint: endpoint, payload: e.payload, at: String(e.created_at || ''), order: order, i: i });
    });
  });
  return all.sort(function (x, y) {
    if (x.at !== y.at) return x.at < y.at ? -1 : 1;
    return x.order !== y.order ? x.order - y.order : x.i - y.i;
  });
}

function _fbMarksEmpty(marks) {
  return !marks || !Array.isArray(marks.marks) || !marks.marks.length;
}

/* A page's marks as the screens read them (the shape the Demo block
   keeps): { rev, marks, saved_at, given, given_rev, given_at, waiting }.
   waiting: the student would be given a change at the next Return, as
   list_assessment_markup says it; a page never given whose marks were all
   erased is not waiting. */
function _fbWaiting(cid, aid, k) {
  if (k.rev === k.given_rev) return false;
  if (k.given == null && _fbMarksEmpty(k.marks)) return false;
  return getAssessmentStudentWork(cid, aid).students_see_markup !== false;
}

/* Every marked page of the class by file id, from the server's rows with
   this device's unanswered saves and Returns laid over them, in the order
   they were made. */
function _fbMarkupKept(cid) {
  return _fbMemoized(cid, 'markup', function () {
    var out = {};
    var byAssessment = _fbRows[cid] || {};
    Object.keys(byAssessment).forEach(function (aid) {
      Object.keys(byAssessment[aid]).forEach(function (fid) {
        var r = byAssessment[aid][fid];
        out[fid] = {
          aid: aid,
          sid: r.enrollment_id,
          rev: r.rev || 0,
          marks: _studentWorkCopy(r.marks) || { v: 1, marks: [] },
          saved_at: r.saved_at || null,
          given: r.given ? _studentWorkCopy(r.given) : null,
          given_rev: r.given_rev == null ? null : r.given_rev,
          given_at: r.given_at || null,
          waiting: r.waiting === true,
        };
      });
    });
    var held = _markupHeld(cid);
    _fbQueuedWrites(['save_markup', 'return_work']).forEach(function (w) {
      var p = w.payload;
      if (w.endpoint === 'save_markup') {
        var page = _markupPage(cid, p.p_file_id);
        if (!page) return;
        var was = out[p.p_file_id];
        var rev = (p.p_base_rev != null ? p.p_base_rev : was ? was.rev : 0) + 1;
        var next = {
          aid: page.submission.assessment_id,
          sid: page.submission.enrollment_id,
          rev: rev,
          marks: _studentWorkCopy(p.p_marks),
          saved_at: w.at || null,
          given: was ? was.given : null,
          given_rev: was ? was.given_rev : null,
          given_at: was ? was.given_at : null,
        };
        // A class that does not hold grades gives the marks as they are saved.
        if (!held) {
          next.given = _studentWorkCopy(p.p_marks);
          next.given_rev = rev;
          next.given_at = w.at || null;
        }
        next.waiting = _fbWaiting(cid, next.aid, next);
        out[p.p_file_id] = next;
        return;
      }
      var listed = {};
      (Array.isArray(p.p_enrollment_ids) ? p.p_enrollment_ids : []).forEach(function (sid) {
        listed[sid] = true;
      });
      Object.keys(out).forEach(function (fid) {
        var k = out[fid];
        if (k.aid !== p.p_assessment_id || !listed[k.sid] || !k.waiting) return;
        k.given = _studentWorkCopy(k.marks);
        k.given_rev = k.rev;
        k.given_at = w.at || null;
        k.waiting = false;
      });
    });
    return out;
  });
}

/* ── Reflections ── */

// What the server does with an answer (answer_reflection) on a copy of the reflection: false when there is nothing to answer.
function _fbApplyAnswer(r, text, onlyMe, at) {
  var t = String(text).trim();
  var followUpOpen = r.follow_up != null && r.follow_up_answer == null;
  if (r.answer == null && onlyMe) {
    r.note = t;
    r.noted_at = at;
  } else if (r.answer == null) {
    r.answer = t;
    r.answered_at = at;
  } else if (followUpOpen && onlyMe) {
    r.follow_up_note = t;
    r.follow_up_noted_at = at;
  } else if (followUpOpen) {
    r.follow_up_answer = t;
    r.follow_up_answered_at = at;
  } else return false;
  r.waiting =
    (r.question != null && r.answer == null && (r.noted_at == null || r.noted_at < r.sent_at)) ||
    (r.follow_up != null && r.follow_up_answer == null && r.follow_up_note == null);
  return true;
}

// The class's reflections as the server listed them, with this device's unanswered answers laid over them.
function _fbReflections(cid) {
  return _fbMemoized(cid, 'reflections', function () {
    var list = _studentWorkCopy((_fbServer[cid] || {}).reflections) || [];
    _fbQueuedWrites(['answer_reflection']).forEach(function (w) {
      var r = list.find(function (x) {
        return x && x.id === w.payload.p_reflection_id;
      });
      if (r && typeof w.payload.p_answer === 'string') {
        _fbApplyAnswer(r, w.payload.p_answer, w.payload.p_only_me === true, w.at || new Date().toISOString());
      }
    });
    return list;
  });
}

/* ── Revisions ── */

// What the server does with a request's edit (set_revision_request) on a copy of the request.
function _fbApplyPatch(r, patch) {
  if (!_plainObject(patch)) return;
  ['what_to_fix', 'revise_by', 'criterion_ids'].forEach(function (k) {
    if (k in patch) r[k] = Array.isArray(patch[k]) ? patch[k].slice() : patch[k];
  });
}

/* The class's revision requests as the server listed them, with this
   device's unanswered Return for Revision, edits and Take Backs laid over
   them. A request made here and not answered yet is shown open under a
   made-up id (pending-rv:<key>): it can be neither edited nor taken back
   until the server has answered. Each carries _live so the readers below
   take the server's own state. */
function _fbRevisions(cid) {
  return _fbMemoized(cid, 'revisions', function () {
    var list = (_studentWorkCopy((_fbServer[cid] || {}).revisions) || []).map(function (r) {
      return Object.assign(r, { _live: true });
    });
    _fbQueuedWrites(['return_for_revision', 'set_revision_request', 'cancel_revision']).forEach(function (w) {
      var p = w.payload;
      var at = w.at || new Date().toISOString();
      if (w.endpoint === 'return_for_revision') {
        var req = _plainObject(p.p_request) ? p.p_request : {};
        list.push({
          _live: true,
          id: 'pending-rv:' + p.p_idempotency_key,
          assessment_id: p.p_assessment_id,
          enrollment_id: p.p_enrollment_id,
          what_to_fix: req.what_to_fix || '',
          revise_by: req.revise_by || null,
          criterion_ids: Array.isArray(req.criterion_ids) ? req.criterion_ids.slice() : [],
          keep_grade: true,
          grade_hidden: false,
          first_submission_id: null,
          first_version: 1,
          first_grade: null,
          first_returned_at: null,
          created_at: at,
          updated_at: at,
          closed_at: null,
          state: 'open',
          revision_submission_id: null,
          revision_version: null,
          revision_sent_at: null,
          revision_note: null,
          revision_late: null,
          revision_sent_by: null,
        });
        return;
      }
      var r = list.find(function (x) {
        return x.id === p.p_request_id;
      });
      if (!r || r.state === 'cancelled' || r.state === 'returned') return;
      if (w.endpoint === 'set_revision_request') {
        _fbApplyPatch(r, p.p_patch);
        r.updated_at = at;
      } else {
        r.state = 'cancelled';
        r.closed_at = at;
        r.updated_at = at;
        r.revision_submission_id = r.revision_version = r.revision_sent_at = r.revision_note = null;
        r.revision_late = r.revision_sent_by = null;
      }
    });
    return list;
  });
}

/* ── Reading ── */

// A signature of the marked pages of one piece, from list_course_feedback's lines or list_assessment_markup's rows.
function _fbSignature(rows) {
  return rows
    .map(function (m) {
      return m.file_id + ':' + m.rev + ':' + m.given_rev;
    })
    .sort()
    .join(',');
}

function _fbLook(cid) {
  return JSON.stringify([_fbCourseOptions(cid), _fbMarkupKept(cid), _fbReflections(cid), _fbRevisions(cid)]);
}

// list_assessment_markup for one piece: { file id → row }, or null when the read failed.
async function _fetchAssessmentMarkup(aid) {
  var res;
  try {
    res = await _callRpcWithAuthGuard(
      'list_assessment_markup',
      { p_assessment_id: aid },
      { suppressSessionExpiredModal: true },
    );
  } catch (e) {
    res = { error: e };
  }
  var rows = res && !res.error ? _rpcRows(res.data) : null;
  if (!rows) {
    if (res && res.error && !res.error.handledSessionExpired) console.warn('list_assessment_markup failed:', res.error);
    return null;
  }
  var out = {};
  rows.forEach(function (r) {
    if (r && _isUuid(r.file_id)) out[r.file_id] = r;
  });
  return out;
}

/* Read the class's feedback from the server: the switches, the marked
   pages, the reflections. Not more than every 30 seconds unless opts.force
   (a read under way is joined). A Promise of { changed } or { error };
   never rejects. A screen that changes is redrawn. Nothing for a class that
   is not live or has Send Work and Reflect on Feedback both off. */
function refreshCourseFeedback(cid, opts) {
  if (!_fbWanted(cid)) return Promise.resolve({ changed: false });
  var st = _fbRead[cid] || (_fbRead[cid] = {});
  if (st.running) {
    if (opts && opts.force) st.again = true;
    return st.running;
  }
  if (!(opts && opts.force) && st.at && Date.now() - st.at < _FB_REFRESH_MS) {
    return Promise.resolve({ changed: false });
  }
  st.running = (async function () {
    var out = { changed: false };
    try {
      var tries = 0;
      do {
        st.again = false;
        out = await _fetchCourseFeedback(cid);
        tries++;
      } while ((st.again || out.skipped) && tries < 4);
    } catch (e) {
      out = { error: e };
    } finally {
      st.running = null;
    }
    if (out.changed) _invalidateAndRerender();
    return out;
  })();
  return st.running;
}

async function _fetchCourseFeedback(cid) {
  var writes = _fbWrites[cid] || 0;
  var res;
  try {
    res = await _callRpcWithAuthGuard(
      'list_course_feedback',
      { p_course_id: cid },
      { suppressSessionExpiredModal: true },
    );
  } catch (e) {
    res = { error: e };
  }
  var data = res && !res.error ? _rpcObject(res.data) : null;
  if (!data || !Array.isArray(data.markup) || !Array.isArray(data.reflections)) {
    // A read that failed changes nothing: the next one tries again.
    if (res && res.error && !res.error.handledSessionExpired) console.warn('list_course_feedback failed:', res.error);
    return { error: (res && res.error) || { message: 'no answer' } };
  }
  // The pieces whose marked pages are not what was read before.
  var lines = {};
  data.markup.forEach(function (m) {
    if (m && m.assessment_id) (lines[m.assessment_id] = lines[m.assessment_id] || []).push(m);
  });
  var have = _fbRows[cid] || {};
  var fresh = {};
  var aids = Object.keys(lines).filter(function (aid) {
    var held = have[aid]
      ? _fbSignature(
          Object.keys(have[aid]).map(function (f) {
            return have[aid][f];
          }),
        )
      : null;
    return held !== _fbSignature(lines[aid]);
  });
  if (aids.length) {
    var got = await Promise.all(
      aids.map(function (aid) {
        return _fetchAssessmentMarkup(aid);
      }),
    );
    if (
      got.some(function (g) {
        return !g;
      })
    ) {
      return { error: { message: 'the marks could not be read' } };
    }
    aids.forEach(function (aid, i) {
      fresh[aid] = got[i];
    });
  }
  if (!_fbOn(cid)) return { changed: false };
  // One of this device's writes landed while the read was out: it is from before that write.
  if ((_fbWrites[cid] || 0) !== writes) return { skipped: true };
  var was = _fbLook(cid);
  _fbServer[cid] = {
    markup: data.markup,
    reflections: data.reflections,
    revisions: Array.isArray(data.revisions) ? data.revisions : [],
  };
  if (_plainObject(data.course)) _noteCourseFeedbackOptions(cid, data.course);
  var rows = {};
  Object.keys(lines).forEach(function (aid) {
    rows[aid] = fresh[aid] || have[aid] || {};
  });
  _fbRows[cid] = rows;
  (_fbRead[cid] || (_fbRead[cid] = {})).at = Date.now();
  _fbChanged(cid);
  return { changed: was !== _fbLook(cid) };
}

/* Mark Up's own read of a piece before it draws: every page's marks, both
   copies, so a page marked on another device shows what is there. A Promise
   of true when read; false when it could not be (offline: Mark Up goes on
   from what this device has). Nothing for a class that is not live. */
function loadAssessmentMarkup(cid, aid) {
  if (!_fbOn(cid) || !_isUuid(aid)) return Promise.resolve(false);
  var writes = _fbWrites[cid] || 0;
  return _fetchAssessmentMarkup(aid).then(function (rows) {
    if (!rows || !_fbOn(cid)) return false;
    // A save of this device's landed meanwhile: the read is from before it.
    if ((_fbWrites[cid] || 0) !== writes) return true;
    var all = _fbRows[cid] || (_fbRows[cid] = {});
    if (Object.keys(rows).length) all[aid] = rows;
    else delete all[aid];
    _fbChanged(cid);
    return true;
  });
}

/* The class has just loaded from the server with its student page on
   (_loadServerGradeReturns): its feedback too, when it is wanted and its
   work is not being read (Send Work off, Reflect on Feedback on). Never
   waited for, never a failed load. */
function _loadServerFeedback(cid) {
  // A class with Send Work on (or not known yet) has it read with its work (refreshStudentWork).
  var known = _workCourseRow[cid];
  if (known && known.send_work !== true && _fbWanted(cid)) refreshCourseFeedback(cid, { force: true });
}

// A write of this device's landed: reads begun before it are dropped, and the class read again soon.
function _fbWriteLanded(cid) {
  if (!cid) return;
  _fbWrites[cid] = (_fbWrites[cid] || 0) + 1;
  _fbChanged(cid);
  setTimeout(function () {
    refreshCourseFeedback(cid, { force: true });
  }, 0);
}

/* The class a Mark Up page or a reflection belongs to, from what is in memory. */
function _fbClassOfFile(fileId) {
  var found = null;
  Object.keys(_workServer).some(function (cid) {
    var subs = (_workServer[cid] && _workServer[cid].submissions) || [];
    var hit = subs.some(function (s) {
      return (s.files || []).some(function (f) {
        return f && f.id === fileId;
      });
    });
    if (hit) found = cid;
    return hit;
  });
  return found;
}
function _fbClassOfRevision(id) {
  return (
    Object.keys(_fbServer).find(function (cid) {
      return ((_fbServer[cid] && _fbServer[cid].revisions) || []).some(function (r) {
        return r && r.id === id;
      });
    }) || null
  );
}
function _fbClassOfReflection(id) {
  return (
    Object.keys(_fbServer).find(function (cid) {
      return (_fbServer[cid].reflections || []).some(function (r) {
        return r && r.id === id;
      });
    }) || null
  );
}

// Put a page's row into the cache as the server now has it.
function _fbPutRow(cid, aid, fileId, row) {
  var all = _fbRows[cid] || (_fbRows[cid] = {});
  (all[aid] = all[aid] || {})[fileId] = row;
}

/* The outbox's word on a feedback write (_onOutboxEvent). What landed is
   put in the cache as the server answered, so the screen does not fall
   back to what was read before; a refused write has the class read again.
   Runs from the outbox's own event, so after a reload and in every tab. */
function _onFeedbackWriteEvent(kind, endpoint, payload, data) {
  try {
    payload = payload || {};
    var cid = null;
    if (endpoint === 'set_course_feedback_options') cid = payload.p_course_id;
    else if (endpoint === 'save_markup') cid = _fbClassOfFile(payload.p_file_id);
    else if (endpoint === 'return_work') cid = _classOfAssessment(payload.p_assessment_id);
    else if (endpoint === 'answer_reflection') cid = _fbClassOfReflection(payload.p_reflection_id);
    else if (endpoint === 'return_for_revision') cid = _classOfAssessment(payload.p_assessment_id);
    else if (endpoint === 'set_revision_request' || endpoint === 'cancel_revision') {
      cid = _fbClassOfRevision(payload.p_request_id);
    }
    if (kind !== 'flush:success') {
      if (cid) _fbWriteLanded(cid);
      else
        Object.keys(_fbServer).forEach(function (c) {
          _fbWriteLanded(c);
        });
      return;
    }
    if (!cid) return;
    data = _rpcObject(data) || {};
    if (endpoint === 'set_course_feedback_options') {
      _noteCourseFeedbackOptions(cid, data);
    } else if (endpoint === 'save_markup') {
      var page = _markupPage(cid, payload.p_file_id);
      var aid = page && page.submission.assessment_id;
      if (aid && data.result === 'saved') {
        var was = (_fbRows[cid] && _fbRows[cid][aid] && _fbRows[cid][aid][payload.p_file_id]) || {};
        var given = data.given_rev != null && data.given_rev === data.rev;
        _fbPutRow(cid, aid, payload.p_file_id, {
          file_id: payload.p_file_id,
          enrollment_id: page.submission.enrollment_id,
          rev: data.rev,
          marks: payload.p_marks,
          saved_at: new Date().toISOString(),
          given: given ? payload.p_marks : was.given || null,
          given_rev: data.given_rev == null ? null : data.given_rev,
          given_at: given ? new Date().toISOString() : was.given_at || null,
          waiting: data.waiting === true,
        });
      } else if (aid && data.result === 'changed' && _plainObject(data.marks)) {
        // Another device saved first: its marks are the page's (the teacher's own are not applied).
        var earlier = (_fbRows[cid] && _fbRows[cid][aid] && _fbRows[cid][aid][payload.p_file_id]) || {};
        _fbPutRow(cid, aid, payload.p_file_id, {
          file_id: payload.p_file_id,
          enrollment_id: page.submission.enrollment_id,
          rev: data.rev,
          marks: data.marks,
          saved_at: earlier.saved_at || null,
          given: earlier.given || null,
          given_rev: earlier.given_rev == null ? null : earlier.given_rev,
          given_at: earlier.given_at || null,
          waiting: true,
        });
        _fbWrites[cid] = (_fbWrites[cid] || 0) + 1;
        _fbChanged(cid);
        _invalidateAndRerender();
        return;
      }
    } else if (endpoint === 'return_work') {
      // Every page of these students on this piece that was waiting is theirs now.
      var listed = {};
      (Array.isArray(payload.p_enrollment_ids) ? payload.p_enrollment_ids : []).forEach(function (sid) {
        listed[sid] = true;
      });
      var rows = (_fbRows[cid] || {})[payload.p_assessment_id] || {};
      Object.keys(rows).forEach(function (fid) {
        var r = rows[fid];
        if (!listed[r.enrollment_id] || r.waiting !== true) return;
        r.given = r.marks;
        r.given_rev = r.rev;
        r.given_at = new Date().toISOString();
        r.waiting = false;
      });
    } else if (
      endpoint === 'return_for_revision' ||
      endpoint === 'set_revision_request' ||
      endpoint === 'cancel_revision'
    ) {
      // The request as the server now has it (a Return for Revision also returned the work: the rows are read again).
      var all = (_fbServer[cid] && _fbServer[cid].revisions) || [];
      if (_plainObject(data.request) && data.request.id) {
        var found = all.findIndex(function (r) {
          return r && r.id === data.request.id;
        });
        if (found >= 0) all[found] = data.request;
        else all.push(data.request);
        if (_fbServer[cid]) _fbServer[cid].revisions = all;
      }
      if (endpoint === 'return_for_revision') _refreshGradeReturnsSoon(cid);
    } else if (endpoint === 'answer_reflection') {
      var list = (_fbServer[cid] && _fbServer[cid].reflections) || [];
      var at = list.findIndex(function (r) {
        return r && r.id === payload.p_reflection_id;
      });
      if (at >= 0 && _plainObject(data.reflection)) list[at] = data.reflection;
    }
    _fbWrites[cid] = (_fbWrites[cid] || 0) + 1;
    _fbChanged(cid);
  } catch (e) {
    console.warn('feedback: following up a write failed:', e);
  }
}

/* A save of Mark Up for a live class (saveMarkup). The save goes through
   the outbox, one at a time for a student's piece and in order. The screen
   waits for the server's answer a few seconds (it needs the new rev, or
   to hear that another device saved first); when there is none (offline,
   slow) it goes on as if saved, and the outbox sends the marks when it
   can. A save that landed after the screen moved on is put in the cache by
   _onFeedbackWriteEvent either way. */
function _saveMarkupLive(cid, fileId, marks, baseRev, key) {
  var page = _isUuid(fileId) ? _markupPage(cid, fileId) : null;
  var sub = page && page.submission;
  if (!sub || !_isUuid(sub.assessment_id) || !_isUuid(sub.enrollment_id))
    return Promise.resolve({ result: 'not_found' });
  var before = (_fbMarkupKept(cid)[fileId] || {}).rev || 0;
  var base = baseRev == null ? null : baseRev;
  var sent = _writeRpc(
    'save_markup',
    {
      p_file_id: fileId,
      p_marks: _studentWorkCopy(marks),
      p_base_rev: base,
      p_idempotency_key: _isUuid(key) ? key : _newEntryId(),
    },
    { key: 'cell:' + sub.enrollment_id + ':' + sub.assessment_id },
  );
  if (sent && sent.refused) return Promise.resolve({ result: 'failed' });
  _fbChanged(cid);
  _trackPendingSync(Promise.resolve(sent));
  var late = new Promise(function (resolve) {
    setTimeout(resolve, _MARKUP_SAVE_WAIT_MS, null);
  });
  return Promise.race([Promise.resolve(sent), late]).then(function (res) {
    if (!res) {
      // No answer yet: the marks are queued and shown; the rev is the one the save will make.
      var rev = (base != null ? base : before) + 1;
      return { result: 'saved', file_id: fileId, rev: rev, given: !_markupHeld(cid) };
    }
    var data = res.error ? null : _rpcObject(res.data);
    if (data && data.result === 'saved') {
      return {
        result: 'saved',
        file_id: fileId,
        rev: data.rev,
        given: data.given_rev != null && data.given_rev === data.rev,
      };
    }
    if (data && data.result === 'changed') {
      return {
        result: 'changed',
        file_id: fileId,
        rev: data.rev || 0,
        marks: _studentWorkCopy(data.marks) || { v: 1, marks: [] },
      };
    }
    var code = res.error && (res.error.code || res.error.message || '');
    if (/P0002|page not found/i.test(String(code))) return { result: 'not_found' };
    return { result: 'failed' };
  });
}

/* Return with the marks for a live class (return_work): returnGrades'
   drafts, each returned with its marks in one call (return_grades is
   return_work's first step), and, for a student whose grade is already
   back but whose marks are waiting, a call of its own. One student to a call,
   each with its own key, so a retry returns nothing twice. Synchronous, as
   returnGrades is; the marks show as given at once (_fbMarkupKept lays the
   queued call over them). */
function _returnWorkLive(cid, aid, ids) {
  var listed = {};
  ids.forEach(function (sid) {
    if (typeof sid === 'string') listed[sid] = true;
  });
  var waiting = getAssessmentMarkup(cid, aid).filter(function (r) {
    return listed[r.enrollment_id] && r.waiting;
  });
  var out = Object.assign({}, returnGrades(cid, aid, ids, true), { marks_given: 0, marks_enrollment_ids: [] });
  waiting.forEach(function (r) {
    out.marks_given++;
    if (out.marks_enrollment_ids.indexOf(r.enrollment_id) < 0) out.marks_enrollment_ids.push(r.enrollment_id);
  });
  // A student returned above went with their marks. The rest have only marks to give.
  out.marks_enrollment_ids.forEach(function (sid) {
    if (out.enrollment_ids.indexOf(sid) >= 0) return;
    if (!_writesEnabled() || !_isSendableId(aid) || !_isSendableId(sid)) return;
    var sent = _writeRpc('return_work', {
      p_assessment_id: aid,
      p_enrollment_ids: [sid],
      p_idempotency_key: _newEntryId(),
    });
    _fbChanged(cid);
    _trackPendingSync(Promise.resolve(sent));
  });
  return out;
}

/* ══════════════════════════════════════════════════════════════════
   Mark Up: marks on a page of student work (S9)
   ══════════════════════════════════════════════════════════════════
   Marks are drawing data over a page, never burned in: the stored photo
   (its path, bytes and sha256) never changes. Each handed-in page has two
   copies of its marks:
   - the teacher's working copy (`marks`, with `rev` and `saved_at`), which
     every save replaces whole and which is never shown to a student;
   - the copy the student was last given (`given`, with `given_rev` and
     `given_at`). In a class that holds grades (its student page on and
     When I Return Them) it is set only by a Return (returnWork). In any
     other class it is set at each save, as grades are. A mark made and
     erased before Return never reaches it.

   Shapes are the server's (migrations/local-test/batch-c-contract.md on
   batch-c-markup-reflect-revise, PR 1043, not applied): save_markup,
   list_assessment_markup, return_work, and the student's markup(...) and
   feedback(...).marks. Each server shape is made in one function here
   (_markupRow, _markupSaved, _studentMarkupFiles), so the wiring PR
   (S9-W1) changes one place when a name moves.

   A mark: an object whose `type` is pen, highlight, note, tick or cross; a
   note has a `text` of 1 to 500 characters. Everything else on it is kept
   as sent. Demo Mode's sample (seed-data.js) places marks by fractions of
   the page (x and y from 0 to 1, from the top left), so they stay put at
   any size. A page's marks: { v: 1, marks: [...] }, 500 marks and 256 KB
   at most. The Eraser removes marks from the list; it is not a mark.

   Demo Mode keeps them in localStorage under gb-student-feedback-<cid>
   (field `markup`, by file id). A signed-in class's are the server's (the
   block above, "Mark Up and Reflect on Feedback for a signed-in teacher"):
   the same readers and writers answer from it. Kept out of class backups
   and Download All My Data, as the photos are. */
var MARKUP_MAX_MARKS = 500;
var MARKUP_MAX_BYTES = 256 * 1024;
var MARKUP_NOTE_MAX = 500;
var _MARKUP_TYPES = ['pen', 'highlight', 'note', 'tick', 'cross'];
var _IDEM_KEPT = 200; // remembered answers per class, newest kept
var _studentFeedback = {}; // cid → { raw, value }: the stored feedback (Demo Mode) as last read

function _studentFeedbackStored(cid) {
  if (!cid || !_isDemoSession()) return null;
  var raw = null;
  try {
    raw = localStorage.getItem('gb-student-feedback-' + cid);
  } catch (e) {
    raw = null;
  }
  var held = _studentFeedback[cid];
  if (!held || held.raw !== raw) {
    var value = null;
    try {
      value = raw == null ? null : JSON.parse(raw);
    } catch (e) {
      value = null;
    }
    held = _studentFeedback[cid] = { raw: raw, value: _plainObject(value) ? value : null };
  }
  return held.value;
}

// A copy of the class's stored feedback to change, or an empty one.
function _studentFeedbackDraft(cid) {
  var stored = _studentWorkCopy(_studentFeedbackStored(cid));
  if (!_plainObject(stored)) stored = {};
  return {
    markup: _plainObject(stored.markup) ? stored.markup : {},
    reflections: _plainObject(stored.reflections) ? stored.reflections : {},
    // Revisions (S11): requests by id.
    revisions: _plainObject(stored.revisions) ? stored.revisions : {},
    idem: _plainObject(stored.idem) ? stored.idem : {},
    idem_order: Array.isArray(stored.idem_order) ? stored.idem_order : [],
  };
}

function _studentFeedbackWrite(cid, draft) {
  var raw = JSON.stringify(draft);
  _safeLSSet('gb-student-feedback-' + cid, raw);
  _studentFeedback[cid] = { raw: raw, value: draft };
}

/* A remembered answer for `key` (what the server keeps under
   p_idempotency_key), or undefined. `what` keeps one function's keys from
   answering for another's. */
function _feedbackRemembered(cid, what, key) {
  var stored = _studentFeedbackStored(cid);
  var hit = stored && _plainObject(stored.idem) ? stored.idem[what + ':' + key] : undefined;
  return hit === undefined ? undefined : _studentWorkCopy(hit);
}
function _feedbackRemember(draft, what, key, answer) {
  var k = what + ':' + key;
  draft.idem[k] = _studentWorkCopy(answer);
  draft.idem_order = draft.idem_order.filter(function (x) {
    return x !== k;
  });
  draft.idem_order.push(k);
  while (draft.idem_order.length > _IDEM_KEPT) delete draft.idem[draft.idem_order.shift()];
}

function _idemKeyOk(key) {
  return typeof key === 'string' && key.length > 0 && key.length <= 100;
}

function _markupBytes(s) {
  return typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(s).length : s.length;
}

/* True when `marks` is a page's marks as save_markup takes them. */
function _markupValid(marks) {
  if (!_plainObject(marks) || marks.v !== 1 || !Array.isArray(marks.marks)) return false;
  if (marks.marks.length > MARKUP_MAX_MARKS) return false;
  var ok = marks.marks.every(function (m) {
    if (!_plainObject(m) || _MARKUP_TYPES.indexOf(m.type) < 0) return false;
    if (m.type !== 'note') return true;
    return typeof m.text === 'string' && m.text.length >= 1 && m.text.length <= MARKUP_NOTE_MAX;
  });
  return ok && _markupBytes(JSON.stringify(marks)) <= MARKUP_MAX_BYTES;
}

/* The handed-in page `fileId` in the class: { file, submission }, or null
   (a page not handed in, unsent, deleted, or of a deleted piece). */
function _markupPage(cid, fileId) {
  if (!fileId) return null;
  // A signed-in class's page still uploading has a local id and no marks.
  if (_fbOn(cid) && !_isUuid(fileId)) return null;
  var subs = _studentWorkSubmissions(cid);
  for (var i = 0; i < subs.length; i++) {
    var files = subs[i].files || [];
    for (var j = 0; j < files.length; j++) {
      if (files[j] && files[j].id === fileId) return { file: files[j], submission: subs[i] };
    }
  }
  return null;
}

/* A class whose marks wait for a Return, as its grades do. */
function _markupHeld(cid) {
  return typeof GradeState !== 'undefined' && GradeState.holds(getReturnSettings(cid));
}

/* Every page's marks of the class by file id: Demo Mode's own, or a
   signed-in class's from the server (_fbMarkupKept). */
function _markupKeptMap(cid) {
  if (_fbOn(cid)) return _fbMarkupKept(cid);
  var stored = _studentFeedbackStored(cid);
  return stored && _plainObject(stored.markup) ? stored.markup : {};
}

// list_assessment_markup's row for one page.
function _markupRow(fileId, enrollmentId, kept) {
  var k = kept || {};
  var rev = k.rev || 0;
  return {
    file_id: fileId,
    enrollment_id: enrollmentId,
    rev: rev,
    marks: _studentWorkCopy(k.marks) || { v: 1, marks: [] },
    saved_at: k.saved_at || null,
    given: k.given ? _studentWorkCopy(k.given) : null,
    given_rev: k.given_rev == null ? null : k.given_rev,
    given_at: k.given_at || null,
    // The server's own word on it for a signed-in class (_fbWaiting).
    waiting: typeof k.waiting === 'boolean' ? k.waiting : rev > 0 && k.given_rev !== rev,
  };
}

/* One page's marks for the teacher: list_assessment_markup's row, both
   copies. A handed-in page with no marks yet has rev 0 and no marks; a page
   not handed in (or signed in, for now) is null. */
function getPageMarkup(cid, fileId) {
  var page = _markupPage(cid, fileId);
  if (!page) return null;
  return _markupRow(fileId, page.submission.enrollment_id, _markupKeptMap(cid)[fileId] || null);
}

/* list_assessment_markup: a row for every handed-in page of `aid` that
   has been marked, in the order of the students' work, each page in order. */
function getAssessmentMarkup(cid, aid) {
  var kept = _markupKeptMap(cid);
  var out = [];
  _studentWorkSubmissions(cid).forEach(function (s) {
    if (s.assessment_id !== aid) return;
    (s.files || []).forEach(function (f) {
      if (f && kept[f.id]) out.push(_markupRow(f.id, s.enrollment_id, kept[f.id]));
    });
  });
  return out;
}

// save_markup's answers.
function _markupSaved(fileId, kept) {
  return { result: 'saved', file_id: fileId, rev: kept.rev, given: kept.given_rev === kept.rev };
}
function _markupChanged(fileId, kept) {
  var k = kept || {};
  return {
    result: 'changed',
    file_id: fileId,
    rev: k.rev || 0,
    marks: _studentWorkCopy(k.marks) || { v: 1, marks: [] },
  };
}

/* Save the whole set of working marks for one page (save_markup). `marks`
   is { v: 1, marks: [...] }; `baseRev` the rev the screen last read (0 for
   none) or null to skip the check; `key` an idempotency key the screen makes
   once per save and sends again on a retry. A Promise, never rejected, of:
   { result: 'saved', file_id, rev, given }  (given: the student already has
     these marks, in a class that does not hold grades);
   { result: 'changed', file_id, rev, marks }  another save came first;
     nothing written;
   { result: 'invalid' }  marks of the wrong shape, or no key;
   { result: 'not_found' }  the page is not handed in;
   { result: 'failed' }  signed in: the save could not be queued or the
     server refused it;
   { result: 'not_available' }  a class that keeps no student-page rows.
   Signed in it is save_markup through the outbox (_saveMarkupLive). */
function saveMarkup(cid, fileId, marks, baseRev, key) {
  if (!cid || !(_isDemoSession() || _fbOn(cid))) return Promise.resolve({ result: 'not_available' });
  if (!_markupValid(marks) || !_idemKeyOk(key)) return Promise.resolve({ result: 'invalid' });
  if (baseRev != null && !(typeof baseRev === 'number' && baseRev >= 0 && Math.floor(baseRev) === baseRev)) {
    return Promise.resolve({ result: 'invalid' });
  }
  if (!_isDemoSession()) return _saveMarkupLive(cid, fileId, marks, baseRev, key);
  var again = _feedbackRemembered(cid, 'markup-save', key);
  if (again !== undefined) return Promise.resolve(again);
  if (!_markupPage(cid, fileId)) return Promise.resolve({ result: 'not_found' });
  var draft = _studentFeedbackDraft(cid);
  var kept = draft.markup[fileId] || null;
  var rev = (kept && kept.rev) || 0;
  if (baseRev != null && baseRev !== rev) return Promise.resolve(_markupChanged(fileId, kept));
  var now = new Date().toISOString();
  var next = Object.assign({}, kept || {}, {
    rev: rev + 1,
    marks: _studentWorkCopy(marks),
    saved_at: now,
  });
  // Not held: the student has them at once, as a grade saved is returned.
  if (!_markupHeld(cid)) {
    next.given = _studentWorkCopy(marks);
    next.given_rev = next.rev;
    next.given_at = now;
  }
  draft.markup[fileId] = next;
  var answer = _markupSaved(fileId, next);
  _feedbackRemember(draft, 'markup-save', key, answer);
  _studentFeedbackWrite(cid, draft);
  return Promise.resolve(answer);
}

/* True when one of the student's pages of `aid` has marks the student has
   not been given (list_assessment_markup's waiting): what To Return should
   count beside drafts. */
function studentMarkupWaiting(cid, sid, aid) {
  return getAssessmentMarkup(cid, aid).some(function (r) {
    return r.enrollment_id === sid && r.waiting;
  });
}

/* True when a page of the student's OWN work on `aid` (one submission
   only, with `submissionId`) carries at least one of the teacher's marks,
   given to the student or not: the server's _grading_started (C1, section
   2b; Colin, Nov 11). A page whose marks were all erased does not count;
   a group-mate's pages do not count for this student. Signed in there are
   no marks here (getAssessmentMarkup reads none). */
function _teacherMarksOnWork(cid, sid, aid, submissionId) {
  return getAssessmentMarkup(cid, aid).some(function (r) {
    if (r.enrollment_id !== sid || !r.marks || !Array.isArray(r.marks.marks) || !r.marks.marks.length) return false;
    if (!submissionId) return true;
    var page = _markupPage(cid, r.file_id);
    return !!page && page.submission.id === submissionId;
  });
}

/* Return, with the marks (return_work): returnGrades unchanged, then each
   listed student of the class is given the working marks on their pages of
   `aid`. Use it in place of returnGrades wherever Mark Up can be on screen.
   Synchronous, as returnGrades is. Answers returnGrades' { returned,
   enrollment_ids, returned_at } plus marks_given (pages) and
   marks_enrollment_ids. Signed in it is return_work: each student's grade
   and marks in one call (_returnWorkLive). */
function returnWork(cid, aid, studentIds) {
  var ids = Array.isArray(studentIds) ? studentIds : studentIds ? [studentIds] : [];
  if (!_isDemoSession() && _fbOn(cid)) return _returnWorkLive(cid, aid, ids);
  var out = Object.assign({}, returnGrades(cid, aid, ids), { marks_given: 0, marks_enrollment_ids: [] });
  // Signed in there are no marks to give (getAssessmentMarkup reads none).
  var listed = {};
  ids.forEach(function (sid) {
    if (typeof sid === 'string') listed[sid] = true;
  });
  var rows = getAssessmentMarkup(cid, aid).filter(function (r) {
    return listed[r.enrollment_id] && r.waiting;
  });
  if (!rows.length) return out;
  var draft = _studentFeedbackDraft(cid);
  var now = new Date().toISOString();
  rows.forEach(function (r) {
    var kept = draft.markup[r.file_id];
    kept.given = _studentWorkCopy(kept.marks);
    kept.given_rev = kept.rev;
    kept.given_at = now;
    out.marks_given++;
    if (out.marks_enrollment_ids.indexOf(r.enrollment_id) < 0) out.marks_enrollment_ids.push(r.enrollment_id);
  });
  _studentFeedbackWrite(cid, draft);
  return out;
}

/* The given marks on one student's pages of `aid`, or [] when the student
   sees none: the piece is set not to show them (Students See Your Mark
   Up off) or Missing or Excused is on it. null for a piece not in the class. */
function _studentMarkupFiles(cid, sid, aid) {
  if (!_assessmentById(cid, aid)) return null;
  if (getAssessmentStudentWork(cid, aid).students_see_markup === false) return [];
  var status = getAssignmentStatus(cid, sid, aid);
  if (status === 'NS' || status === 'EXC') return [];
  var kept = _markupKeptMap(cid);
  var out = [];
  _studentWorkSubmissions(cid).forEach(function (s) {
    if (s.assessment_id !== aid || s.enrollment_id !== sid) return;
    (s.files || []).forEach(function (f) {
      var k = f && kept[f.id];
      if (k && k.given) out.push({ file_id: f.id, marks: _studentWorkCopy(k.given), given_at: k.given_at || null });
    });
  });
  return out;
}

/* What the student sees on their pages of `aid` (the student's
   markup(...)): { ok: true, files: [{ file_id, marks, given_at }] }, the
   given copy only. { ok: false, error: 'not_found' } for a piece not in
   the class. A class that keeps no student-page rows: { ok: true, files: [] }. */
function getStudentMarkup(cid, sid, aid) {
  if (!_fbReads(cid)) return { ok: true, files: [] };
  var files = _studentMarkupFiles(cid, sid, aid);
  return files ? { ok: true, files: files } : { ok: false, error: 'not_found' };
}

/* "3 notes on your work": feedback(...).marks for one student and piece,
   { pages, notes } over the given marks the student sees, or null when
   there are none (not yet returned with marks, hidden). */
function getStudentMarkCounts(cid, sid, aid) {
  if (!_fbReads(cid)) return null;
  var files = (_studentMarkupFiles(cid, sid, aid) || []).filter(function (f) {
    return f.marks && Array.isArray(f.marks.marks) && f.marks.marks.length > 0;
  });
  if (!files.length) return null;
  var notes = 0;
  files.forEach(function (f) {
    f.marks.marks.forEach(function (m) {
      if (m && m.type === 'note') notes++;
    });
  });
  return { pages: files.length, notes: notes };
}

/* Demo Mode's sample marks (seed-data.js): { file_id: { v: 1, marks } },
   saved as the teacher's working copy and given to the student, as a class
   that does not hold grades gives them. Refused (false) outside Demo Mode,
   for a page not handed in, or for marks of the wrong shape. */
function saveDemoMarkup(cid, pages) {
  if (!cid || !_isDemoSession() || !_plainObject(pages)) return false;
  var ids = Object.keys(pages);
  var ok = ids.every(function (id) {
    return _markupPage(cid, id) && _markupValid(pages[id]);
  });
  if (!ok) return false;
  var draft = _studentFeedbackDraft(cid);
  var now = new Date().toISOString();
  ids.forEach(function (id) {
    var marks = _studentWorkCopy(pages[id]);
    draft.markup[id] = {
      rev: 1,
      marks: marks,
      saved_at: now,
      given: _studentWorkCopy(marks),
      given_rev: 1,
      given_at: now,
    };
  });
  _studentFeedbackWrite(cid, draft);
  return true;
}

/* ══════════════════════════════════════════════════════════════════
   Reflect on Feedback: a student's reflection on returned work (S10)
   ══════════════════════════════════════════════════════════════════
   After a piece comes back, the student says whether the feedback makes
   sense (yes, or not sure with a question), makes a plan and may say what
   went well; the teacher answers; the student says whether it makes sense
   now, with one follow-up question. The student's words are theirs: no
   teacher function changes them. Only the teacher reads them ("Only Mr.
   Brown sees this"): a student reads only their own, and nothing a family
   reads (reports, phone reports, the Term Questionnaire) reads them.

   Behind the class's Reflect on Feedback switch (courseConfig
   .reflect_on_feedback, off by default) and the build switch: with either
   off, every reader here shows no reflection and a student's send answers
   reflect_off. The plan comes back on the student's next piece as Your
   Plan From Last Time, and "Did You Do It?" (yes, partly, no for Not This
   Time) is kept on that piece's submission (Batch B's followed_plan).

   Shapes are the server's (batch-c-contract.md, PR 1043, not applied):
   set_course_feedback_options, list_course_feedback, answer_reflection,
   and the student's feedback(...), reflect(...) and reply(...). Each is
   made in one function here (_reflectionRow, _studentReflection,
   _courseFeedbackOptions), so S10-W1 changes one place.

   Demo Mode keeps them in gb-student-feedback-<cid> (field `reflections`,
   by assessment then student). A signed-in class's are the server's (the
   block above): the teacher's readers and Send Answer answer from it. The
   student's own writers here (sendStudentReflection, sendStudentReply) are
   Demo Mode's: a real student sends through the student-submit routes and
   they answer { ok: false, error: 'not_available' } signed in. */
var REFLECTION_TEXT_MAX = 1000;
var ANSWER_TEXT_MAX = 2000;

function _courseFeedbackOptions(cid) {
  if (_fbOn(cid) && !_isDemoSession()) return Object.assign({}, _fbCourseOptions(cid));
  var cfg = getCourseConfig(cid) || {};
  return { reflect_on_feedback: cfg.reflect_on_feedback === true, show_my_learning: cfg.show_my_learning === true };
}

/* The class's two switches, { reflect_on_feedback, show_my_learning }, as
   the screens read them: Demo Mode's settings, or a signed-in class's
   from the server (with a change not yet answered laid over it). Both off
   for a class that keeps no student-page rows. */
function getCourseFeedbackOptions(cid) {
  if (!_fbReads(cid)) return { reflect_on_feedback: false, show_my_learning: false };
  return _courseFeedbackOptions(cid);
}

/* True when the class's reflections show: Demo Mode or a signed-in class
   the server keeps rows for, the build switch and Reflect on Feedback on. */
function getReflectOnFeedback(cid) {
  if (!_fbReads(cid)) return false;
  if (!_isDemoSession()) return _courseFeedbackOptions(cid).reflect_on_feedback;
  return !!getReturnSettings(cid).student_page && _courseFeedbackOptions(cid).reflect_on_feedback;
}

/* Turn Reflect on Feedback (and Show My Learning) on or off:
   set_course_feedback_options. `patch` names either or both, true or
   false; only what it names is written. A Promise of { reflect_on_feedback,
   show_my_learning } as saved, or { result: 'invalid' } (a wrong patch or no
   key), { result: 'failed' } (signed in: the server refused it), or
   { result: 'not_available' } (a class that keeps no student-page rows).
   Signed in it is set_course_feedback_options through the outbox, and shows
   at once. */
function setCourseFeedbackOptions(cid, patch, key) {
  if (!cid || !_fbReads(cid)) return Promise.resolve({ result: 'not_available' });
  if (!_plainObject(patch) || !_idemKeyOk(key)) return Promise.resolve({ result: 'invalid' });
  var names = Object.keys(patch);
  var ok =
    names.length > 0 &&
    names.every(function (k) {
      return (k === 'reflect_on_feedback' || k === 'show_my_learning') && typeof patch[k] === 'boolean';
    });
  if (!ok) return Promise.resolve({ result: 'invalid' });
  if (!_isDemoSession()) return _setCourseFeedbackLive(cid, patch, key);
  saveCourseConfig(cid, Object.assign({}, getCourseConfig(cid) || {}, patch));
  return Promise.resolve(_courseFeedbackOptions(cid));
}

// set_course_feedback_options for a live class: shown at once, sent through the outbox, as Send Work's two switches are.
function _setCourseFeedbackLive(cid, patch, key) {
  var mine = { patch: Object.assign({}, (_fbCourseHere[cid] || {}).patch, patch) };
  _fbCourseHere[cid] = mine;
  _fbChanged(cid);
  var sent = _writeRpc('set_course_feedback_options', {
    p_course_id: cid,
    p_patch: Object.assign({}, patch),
    p_idempotency_key: _isUuid(key) ? key : _newEntryId(),
  });
  var done = Promise.resolve(sent).then(function (res) {
    var still = _fbCourseHere[cid] === mine;
    if (still) delete _fbCourseHere[cid];
    var data = res && !res.error ? _rpcObject(res.data) : null;
    if (data && still) _noteCourseFeedbackOptions(cid, data);
    if (res && res.error && !res.error.handledSessionExpired && !res.error.refused) {
      console.warn('set_course_feedback_options failed:', res.error);
    }
    _fbWriteLanded(cid);
    return data ? _courseFeedbackOptions(cid) : { result: 'failed' };
  });
  _trackPendingSync(done);
  return done;
}

// A non-blank string of at most `max` characters, or null when blank or missing.
function _reflectionText(v, max) {
  if (v == null) return { ok: true, value: null };
  if (typeof v !== 'string' || v.length > max) return { ok: false };
  return { ok: true, value: v.trim() ? v : null };
}

/* A piece the student has been given a grade on: returned, or a draft over
   a grade returned before (the student still has that one). */
function _feedbackReturned(cid, sid, aid) {
  var row = getGradeReturn(cid, sid, aid);
  if (row && row.returned_at) return true;
  // A draft never returned is not back (stateOf says Draft).
  return GradeState.stateOf(cid, sid, aid) === GradeState.RETURNED;
}

function _reflectionsOf(stored) {
  return stored && _plainObject(stored.reflections) ? stored.reflections : {};
}

function _reflectionKept(cid, sid, aid) {
  if (_fbOn(cid) && !_isDemoSession()) {
    return (
      _fbReflections(cid).find(function (r) {
        return r && r.assessment_id === aid && r.enrollment_id === sid;
      }) || null
    );
  }
  var of = _reflectionsOf(_studentFeedbackStored(cid))[aid];
  return (of && of[sid]) || null;
}

// What is waiting for the teacher: a question (or, with none, the reflection), then a follow-up.
function _reflectionWaiting(r) {
  if (r.follow_up && !r.follow_up_answer) return true;
  return !!r.question && !r.answer;
}

// list_course_feedback's reflection.
function _reflectionRow(r) {
  return {
    id: r.id,
    assessment_id: r.assessment_id,
    enrollment_id: r.enrollment_id,
    makes_sense: r.makes_sense,
    question: r.question || null,
    plan: r.plan || null,
    went_well: r.went_well || null,
    sent_at: r.sent_at,
    answer: r.answer || null,
    answered_at: r.answered_at || null,
    sense_now: r.sense_now || null,
    sense_now_at: r.sense_now_at || null,
    follow_up: r.follow_up || null,
    follow_up_answer: r.follow_up_answer || null,
    follow_up_answered_at: r.follow_up_answered_at || null,
    // The server's own word on it for a signed-in class (it counts a note kept Only Me).
    waiting: typeof r.waiting === 'boolean' ? r.waiting : _reflectionWaiting(r),
  };
}

// The student's feedback(...).reflection: their own words and the answers, no ids.
function _studentReflection(r) {
  return {
    makes_sense: r.makes_sense,
    question: r.question || null,
    plan: r.plan || null,
    went_well: r.went_well || null,
    sent_at: r.sent_at,
    answer: r.answer || null,
    answered_at: r.answered_at || null,
    sense_now: r.sense_now || null,
    follow_up: r.follow_up || null,
    follow_up_answer: r.follow_up_answer || null,
    follow_up_answered_at: r.follow_up_answered_at || null,
  };
}

/* Every reflection of the class that shows, on a piece and a student still
   in the class, oldest first. [] while Reflect on Feedback is off. */
function _classReflections(cid) {
  if (!getReflectOnFeedback(cid)) return [];
  var students = {};
  (getStudents(cid) || []).forEach(function (s) {
    if (s && s.id) students[s.id] = true;
  });
  var out = [];
  if (!_isDemoSession()) {
    // The server's list, on a piece and a student still in the class.
    var pieces = {};
    (getAssessments(cid) || []).forEach(function (a) {
      if (a && a.id) pieces[a.id] = true;
    });
    out = _fbReflections(cid).filter(function (r) {
      return r && pieces[r.assessment_id] && students[r.enrollment_id];
    });
  } else {
    var all = _reflectionsOf(_studentFeedbackStored(cid));
    (getAssessments(cid) || []).forEach(function (a) {
      var of = a && all[a.id];
      if (!_plainObject(of)) return;
      Object.keys(of).forEach(function (sid) {
        if (students[sid] && of[sid]) out.push(of[sid]);
      });
    });
  }
  return out.sort(function (x, y) {
    return String(x.sent_at) < String(y.sent_at) ? -1 : String(x.sent_at) > String(y.sent_at) ? 1 : 0;
  });
}

/* list_course_feedback: { course, markup, revisions, reflections }.
   markup: every marked page of the class ({ file_id, assessment_id,
   enrollment_id, rev, given_rev, given_at, waiting }); revisions: every
   revision request of the class as _revisionRow, oldest first, [] while
   revisionsOn is false (S11);
   reflections: as _reflectionRow, [] while Reflect on Feedback is off.
   A class that keeps no student-page rows: everything empty and both
   switches off. */
function getCourseFeedback(cid) {
  var demo = _fbReads(cid);
  var markup = [];
  if (demo) {
    (getAssessments(cid) || []).forEach(function (a) {
      if (!a || !a.id) return;
      getAssessmentMarkup(cid, a.id).forEach(function (r) {
        markup.push({
          file_id: r.file_id,
          assessment_id: a.id,
          enrollment_id: r.enrollment_id,
          rev: r.rev,
          given_rev: r.given_rev,
          given_at: r.given_at,
          waiting: r.waiting,
        });
      });
    });
  }
  return {
    course: demo ? _courseFeedbackOptions(cid) : { reflect_on_feedback: false, show_my_learning: false },
    markup: markup,
    revisions: _classRevisions(cid).map(function (r) {
      return _revisionRow(cid, r);
    }),
    reflections: _classReflections(cid).map(_reflectionRow),
  };
}

/* Questions From Students: the reflections with a question or follow-up
   not answered, oldest first, for the class or (with `sid`) one student.
   What the dashboard's card, the gradebook's mark and the Learner
   Profile's mark count; one answer clears all three. */
function getQuestionsWaiting(cid, sid) {
  return _classReflections(cid)
    .filter(function (r) {
      return _reflectionWaiting(r) && (!sid || r.enrollment_id === sid);
    })
    .map(_reflectionRow);
}

/* One student's reflections, newest first, each with `next`: the next
   piece of the class the student sent work for after reflecting, and their
   "Did You Do It?" on it ({ assessment_id, followed_plan }, followed_plan
   yes, partly, no or null), or null when none is in yet. For the Learner
   Profile's Reflections on Feedback and "2 of 3 plans followed". */
function getStudentReflections(cid, sid) {
  var subs = _studentWorkSubmissions(cid).filter(function (s) {
    return s.enrollment_id === sid && s.sent_at;
  });
  return _classReflections(cid)
    .filter(function (r) {
      return r.enrollment_id === sid;
    })
    .reverse()
    .map(function (r) {
      var row = _reflectionRow(r);
      var after = subs
        .filter(function (s) {
          return s.assessment_id !== r.assessment_id && String(s.sent_at) > String(r.sent_at);
        })
        .sort(function (x, y) {
          return String(x.sent_at) < String(y.sent_at) ? -1 : 1;
        })[0];
      row.next = after ? { assessment_id: after.assessment_id, followed_plan: after.followed_plan || null } : null;
      return row;
    });
}

/* Your Plan From Last Time (feedback(...).last_plan): the student's newest
   plan in the class, { assessment_id, plan, sent_at }, or null. */
function getStudentLastPlan(cid, sid) {
  var withPlan = _classReflections(cid).filter(function (r) {
    return r.enrollment_id === sid && r.plan;
  });
  var last = withPlan[withPlan.length - 1];
  return last ? { assessment_id: last.assessment_id, plan: last.plan, sent_at: last.sent_at } : null;
}

/* Send Answer (answer_reflection): answers what is waiting, the question
   (or, with none, the reflection), then the follow-up. `answer` 1 to 2000
   characters. A Promise of { result: 'answered', reflection } (as
   _reflectionRow), { result: 'already_answered' }, { result: 'not_found' },
   { result: 'invalid' } (no answer, too long, or no key), { result:
   'failed' } (signed in: the server refused it), or { result:
   'not_available' } (a class that keeps no student-page rows). The same key
   again answers the same. Signed in it is answer_reflection through the
   outbox (_answerReflectionLive). */
function answerReflection(cid, reflectionId, answer, key) {
  if (!cid || !_fbReads(cid)) return Promise.resolve({ result: 'not_available' });
  if (typeof answer !== 'string' || !answer.trim() || answer.length > ANSWER_TEXT_MAX || !_idemKeyOk(key)) {
    return Promise.resolve({ result: 'invalid' });
  }
  if (!_isDemoSession()) return _answerReflectionLive(cid, reflectionId, answer, key);
  var again = _feedbackRemembered(cid, 'reflection-answer', key);
  if (again !== undefined) return Promise.resolve(again);
  var found = _classReflections(cid).find(function (r) {
    return r.id === reflectionId;
  });
  if (!found) return Promise.resolve({ result: 'not_found' });
  var draft = _studentFeedbackDraft(cid);
  var r = draft.reflections[found.assessment_id][found.enrollment_id];
  var now = new Date().toISOString();
  if (!r.answer) {
    r.answer = answer;
    r.answered_at = now;
  } else if (r.follow_up && !r.follow_up_answer) {
    r.follow_up_answer = answer;
    r.follow_up_answered_at = now;
  } else {
    return Promise.resolve({ result: 'already_answered' });
  }
  var out = { result: 'answered', reflection: _reflectionRow(r) };
  _feedbackRemember(draft, 'reflection-answer', key, out);
  _studentFeedbackWrite(cid, draft);
  return Promise.resolve(out);
}

/* Send Answer for a live class: shown at once (the queued answer is laid
   over the list), sent through the outbox under its own key. The screen
   waits for the server's answer a few seconds and goes on as if sent when
   there is none (offline). */
function _answerReflectionLive(cid, reflectionId, answer, key) {
  var found = _isUuid(reflectionId)
    ? _classReflections(cid).find(function (r) {
        return r.id === reflectionId;
      })
    : null;
  if (!found) return Promise.resolve({ result: 'not_found' });
  var test = _studentWorkCopy(found);
  var now = new Date().toISOString();
  if (!_fbApplyAnswer(test, answer, false, now)) {
    return Promise.resolve({ result: 'already_answered', reflection: _reflectionRow(found) });
  }
  var sent = _writeRpc('answer_reflection', {
    p_reflection_id: reflectionId,
    p_answer: answer.trim(),
    p_idempotency_key: _isUuid(key) ? key : _newEntryId(),
    p_only_me: false,
  });
  if (sent && sent.refused) return Promise.resolve({ result: 'failed' });
  _fbChanged(cid);
  _trackPendingSync(Promise.resolve(sent));
  var late = new Promise(function (resolve) {
    setTimeout(resolve, _MARKUP_SAVE_WAIT_MS, null);
  });
  return Promise.race([Promise.resolve(sent), late]).then(function (res) {
    if (!res) return { result: 'answered', reflection: _reflectionRow(test) };
    var data = res.error ? null : _rpcObject(res.data);
    if (data && (data.result === 'answered' || data.result === 'already_answered') && _plainObject(data.reflection)) {
      return { result: data.result, reflection: _reflectionRow(data.reflection) };
    }
    if (res.error && /P0002|not found/i.test(String(res.error.code || res.error.message || ''))) {
      return { result: 'not_found' };
    }
    return { result: 'failed' };
  });
}

/* The student `from` (the one signed in on the page) acting on their own
   piece: an error code, or null to go on. The server answers not_found
   for an enrollment the session does not hold. */
function _studentFeedbackCheck(cid, sid, aid, from) {
  if (!cid || !_isDemoSession()) return 'not_available';
  if (!sid || from !== sid) return 'not_found';
  var inClass = (getStudents(cid) || []).some(function (s) {
    return s && s.id === sid;
  });
  if (!inClass || !_assessmentById(cid, aid)) return 'not_found';
  if (!getReflectOnFeedback(cid)) return 'reflect_off';
  return null;
}

/* A student's reflection (reflect): `reflection` is { makes_sense: 'yes' |
   'not_sure', question, plan, went_well }, each 1000 characters at most;
   not_sure needs a question, yes a plan. `from` is the student signed in
   on the page: only they reflect on their own work. Sent again before the
   teacher answers, it takes the place of the first. Answers { ok: true,
   reflection } (as the student sees it) or { ok: false, error }:
   reflect_off, not_found, not_returned (the student has no grade back on
   the piece), already_answered, invalid (a wrong shape), not_available
   (signed in). */
function sendStudentReflection(cid, sid, aid, reflection, from) {
  var refused = _studentFeedbackCheck(cid, sid, aid, from);
  if (refused) return { ok: false, error: refused };
  if (!_plainObject(reflection)) return { ok: false, error: 'invalid' };
  var sense = reflection.makes_sense;
  var q = _reflectionText(reflection.question, REFLECTION_TEXT_MAX);
  var p = _reflectionText(reflection.plan, REFLECTION_TEXT_MAX);
  var w = _reflectionText(reflection.went_well, REFLECTION_TEXT_MAX);
  if ((sense !== 'yes' && sense !== 'not_sure') || !q.ok || !p.ok || !w.ok) return { ok: false, error: 'invalid' };
  if ((sense === 'not_sure' && !q.value) || (sense === 'yes' && !p.value)) return { ok: false, error: 'invalid' };
  if (!_feedbackReturned(cid, sid, aid)) return { ok: false, error: 'not_returned' };
  var kept = _reflectionKept(cid, sid, aid);
  if (kept && kept.answer) return { ok: false, error: 'already_answered' };
  var words = { makes_sense: sense, question: q.value, plan: p.value, went_well: w.value };
  // The same reflection twice is the same.
  if (
    kept &&
    ['makes_sense', 'question', 'plan', 'went_well'].every(function (k) {
      return (kept[k] || null) === words[k];
    })
  ) {
    return { ok: true, reflection: _studentReflection(kept) };
  }
  var draft = _studentFeedbackDraft(cid);
  var of = (draft.reflections[aid] = _plainObject(draft.reflections[aid]) ? draft.reflections[aid] : {});
  of[sid] = Object.assign(
    {
      id: (kept && kept.id) || 'rf' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      assessment_id: aid,
      enrollment_id: sid,
      sent_at: new Date().toISOString(),
    },
    words,
  );
  _studentFeedbackWrite(cid, draft);
  return { ok: true, reflection: _studentReflection(of[sid]) };
}

/* Does It Make Sense Now? (reply): `reply` is { sense_now: 'yes' |
   'not_sure', follow_up } (follow_up only with not_sure, once, 1000
   characters at most). Answers { ok: true, reflection } or { ok: false,
   error }: reflect_off, not_found (no reflection), not_answered (no answer
   yet), already_asked (a follow-up is in), invalid, not_available. */
function sendStudentReply(cid, sid, aid, reply, from) {
  var refused = _studentFeedbackCheck(cid, sid, aid, from);
  if (refused) return { ok: false, error: refused };
  if (!_plainObject(reply) || (reply.sense_now !== 'yes' && reply.sense_now !== 'not_sure')) {
    return { ok: false, error: 'invalid' };
  }
  var f = _reflectionText(reply.follow_up, REFLECTION_TEXT_MAX);
  if (!f.ok || (f.value && reply.sense_now !== 'not_sure')) return { ok: false, error: 'invalid' };
  var kept = _reflectionKept(cid, sid, aid);
  if (!kept) return { ok: false, error: 'not_found' };
  if (!kept.answer) return { ok: false, error: 'not_answered' };
  if (kept.follow_up) return { ok: false, error: 'already_asked' };
  var draft = _studentFeedbackDraft(cid);
  var r = draft.reflections[aid][sid];
  r.sense_now = reply.sense_now;
  r.sense_now_at = new Date().toISOString();
  if (f.value) r.follow_up = f.value;
  _studentFeedbackWrite(cid, draft);
  return { ok: true, reflection: _studentReflection(r) };
}

/* What the student's page reads beside their work (feedback): { ok, v,
   reflect_on_feedback, show_my_learning, assessments: [{ id, marks,
   revision, reflection }], last_plan }, for the student `sid` only. A piece
   is listed when it has marks given (getStudentMarkCounts), a revision
   asked (getStudentRevision, S11) or a reflection. Reflections and
   last_plan only while Reflect on Feedback is on; revisions only while
   revisionsOn. Signed in: the switches off and nothing listed. */
function getStudentFeedback(cid, sid) {
  var demo = _fbReads(cid);
  var on = getReflectOnFeedback(cid);
  var out = {
    ok: true,
    v: 1,
    reflect_on_feedback: on,
    show_my_learning: demo && _courseFeedbackOptions(cid).show_my_learning,
    assessments: [],
    last_plan: on ? getStudentLastPlan(cid, sid) : null,
  };
  if (!demo) return out;
  (getAssessments(cid) || []).forEach(function (a) {
    if (!a || !a.id) return;
    var marks = getStudentMarkCounts(cid, sid, a.id);
    var kept = on ? _reflectionKept(cid, sid, a.id) : null;
    var revision = getStudentRevision(cid, sid, a.id);
    if (!marks && !kept && !revision) return;
    out.assessments.push({
      id: a.id,
      marks: marks,
      revision: revision,
      reflection: kept ? _studentReflection(kept) : null,
    });
  });
  return out;
}

/* "Did You Do It?" on the piece sent after a plan: `value` 'yes', 'partly'
   or 'no' (Not This Time), or null, kept on the student's submission for
   `aid` as Batch B's followed_plan (send_start's p_followed_plan). A
   Promise of { result: 'saved', submission }, { result: 'nothing_sent' },
   { result: 'not_found' }, { result: 'invalid' }, or signed in { result:
   'not_available' }. Demo Mode's own way in: the student's real send passes
   it with the work. */
function setStudentFollowedPlan(cid, sid, aid, value) {
  if (!cid || !_isDemoSession()) return Promise.resolve({ result: 'not_available' });
  if (value !== null && value !== 'yes' && value !== 'partly' && value !== 'no') {
    return Promise.resolve({ result: 'invalid' });
  }
  return _teacherWorkQueued(cid, function () {
    if (!_teacherWorkInClass(cid, sid, aid)) return { result: 'not_found' };
    var draft = _studentWorkDraft(cid);
    var sent = _teacherWorkSent(draft, sid, aid);
    if (!sent) return { result: 'nothing_sent' };
    sent.followed_plan = value;
    _studentWorkWrite(cid, draft);
    return { result: 'saved', submission: getStudentSubmission(cid, sid, aid) };
  });
}

/* Demo Mode's sample reflections (seed-data.js): [{ assessment_id,
   enrollment_id, sent_at, makes_sense, question, plan, went_well, answer,
   answered_at, sense_now, sense_now_at }], kept as sent whatever the
   switch says (the readers show them only while it is on). false outside
   Demo Mode, or for a student or piece not in the class. */
function saveDemoReflections(cid, list) {
  if (!cid || !_isDemoSession() || !Array.isArray(list)) return false;
  var students = {};
  (getStudents(cid) || []).forEach(function (s) {
    if (s && s.id) students[s.id] = true;
  });
  var ok = list.every(function (r) {
    return _plainObject(r) && students[r.enrollment_id] && _assessmentById(cid, r.assessment_id) && r.sent_at;
  });
  if (!ok) return false;
  var draft = _studentFeedbackDraft(cid);
  list.forEach(function (r) {
    var of = (draft.reflections[r.assessment_id] = _plainObject(draft.reflections[r.assessment_id])
      ? draft.reflections[r.assessment_id]
      : {});
    of[r.enrollment_id] = Object.assign(
      { id: 'demo-rf-' + r.enrollment_id + '-' + r.assessment_id },
      _studentWorkCopy(r),
    );
  });
  _studentFeedbackWrite(cid, draft);
  return true;
}

/* ══════════════════════════════════════════════════════════════════
   Revisions: returning work for another try (S11)
   ══════════════════════════════════════════════════════════════════
   Return for Revision returns the work, then asks the student for another
   try: What to Fix, Revise By, which criteria, and whether the grade is
   kept or hidden until the new version is graded. The student's revision
   is the next version of the piece's submission (version 2, then 3);
   version 1 and its pages stay. The revision is graded in the SAME score
   rows, so the Draft and Returned rule (shared/grade-state.js) does the
   rest with no change:
   - while the new grade is a draft the student and every family output
     keep the grade they were given (the returned copy);
   - when it is returned it replaces the old one, in every number; the old
     grade is no longer in any set of scores;
   - the first version's grade is kept on the request as history
     (first_grade): "Was Developing + on the Oct 30 version", Before and
     After.
   Hide (keep_grade false) is the server's C2 (2026111121, not applied): the
   grade_return row becomes a draft never returned, so the student page and
   every report count nothing for it (a hidden grade is a draft, Q5);
   returning the new version's grade ends the hide; Take Back gives the
   grade back exactly as the student had it. Only a class that holds
   grades can hide one (hide_needs_holding).

   Shapes are the server's (migrations/local-test/batch-c-contract.md on
   batch-c-markup-reflect-revise, read at commit 65d550dc; PR 1043, not
   applied): return_for_revision, set_revision_request, cancel_revision,
   list_course_feedback.revisions, the student's feedback(...).revision,
   revision_start + revision_finish (one call here), revision_unsend. Each
   shape is made in one function (_revisionRow, _studentRevisionOf), so
   S11-W1 changes one place.

   A request's state: open (no revision in), sent (in, grading not
   started), grading (the grade changed since it came in, or the teacher's
   marks are on one of its pages), returned (a grade was returned after it
   came in), cancelled. An open request's state is read live; once closed
   (returned or cancelled) it is stored and stays closed, whatever happens
   to the work afterwards. A student's own shape says sent for grading: a
   draft is never theirs to see. Marks on a revision's pages lock it as a
   grade does: the student can no longer Unsend it or send it again.

   Behind the build switch and Send Work (revisionsOn), as the plan's S11
   says: with either off every reader here shows nothing and every writer
   answers revisions_off. DEMO MODE ONLY, in gb-student-feedback-<cid>
   (field `revisions`, by request id) and the student work's own
   submissions (gb-student-work-<cid>). A signed-in class's requests are the
   server's (_fbRevisions, from list_course_feedback with this device's
   unanswered Return for Revision, edits and Take Backs laid over them): the
   teacher's writers go to return_for_revision, set_revision_request and
   cancel_revision through the outbox. The student's own writers here are
   Demo Mode's and answer { ok: false, error: 'not_available' } signed in
   (a real student sends through the revision routes: S11-W1, student side). */
var REVISION_FIX_MAX = 2000;
var _firstVersionScope = null; // { cid, sid, aid, entries } while getRevisionFirstCell reads

/* True when the class's revisions show: Demo Mode, or a signed-in class the
   server keeps rows for, with the build switch and Send Work on. */
function revisionsOn(cid) {
  if (!cid || !(_isDemoSession() || _fbOn(cid))) return false;
  return !!getReturnSettings(cid).student_page && getCourseSendWork(cid).send_work === true;
}

function _revisionsOf(stored) {
  return stored && _plainObject(stored.revisions) ? stored.revisions : {};
}

// The working copy of one cell, as the rule keeps it (GradeState.copyOf), or null.
function _revisionWorking(cid, sid, aid) {
  var a = _assessmentById(cid, aid);
  var cell = (_gradeCells(getScores(cid), getRubricChecks(cid))[aid] || {})[sid];
  return a && cell ? GradeState.copyOf(_gradeOf(a, cell.entries, cell.checks)) : null;
}

/* How a piece is scored now, as GradeState.partInUse takes it: the same
   reading as shared/student-view.js's scoringOf (the part of a grade a
   student is given). */
function _revisionScoring(cid, a) {
  if (isPointsScored(a)) return { kind: 'points' };
  var rubricId = a.rubricId || a.rubric_id;
  if (rubricId) {
    var criteria = ((getRubricById(cid, rubricId) || {}).criteria || []).filter(Boolean);
    var checks = [];
    criteria.forEach(function (c) {
      (c.checks || []).forEach(function (k) {
        if (k && k.id) checks.push(String(k.id));
      });
    });
    return {
      kind: 'rubric',
      criteria: criteria.map(function (c) {
        return String(c.id);
      }),
      checks: checks,
    };
  }
  var tags = scoreTagIds(a, cid).filter(function (id) {
    return !isUnlinkedTag(id);
  });
  return tags.length ? { kind: 'competencies', tags: tags } : { kind: 'overall' };
}

// The handed-in submission a request's revision is, or null (none sent, unsent or deleted).
function _revisionSubmission(cid, r) {
  if (!r || !r.revision_submission_id) return null;
  return (
    _studentWorkSubmissions(cid).find(function (s) {
      return s.id === r.revision_submission_id;
    }) || null
  );
}

/* A request's state: open, sent, grading, returned or cancelled. A closed
   request (taken back, or its revision's grade returned) is kept closed,
   as the server keeps state 'done' and closed_at: whatever happens to the
   work afterwards (Delete Work, Replace Them), it never opens again. An
   open one is read live from the submissions, the grade_return row and
   the teacher's marks. */
function _revisionState(cid, r) {
  // A signed-in class's request: the server's own reading of it (_revision_state).
  if (r._live) return r.state;
  if (r.cancelled_at) return 'cancelled';
  if (r.closed_at) return 'returned';
  var sub = _revisionSubmission(cid, r);
  if (!sub) return 'open';
  if (_revisionReturnedSince(cid, r)) return 'returned';
  var now = _revisionWorking(cid, r.enrollment_id, r.assessment_id);
  if (!GradeState.sameCopy(now, r.revision_grade_at_send)) return 'grading';
  // The teacher's marks on one of the revision's pages: grading has started.
  return _teacherMarksOnWork(cid, r.enrollment_id, r.assessment_id, sub.id) ? 'grading' : 'sent';
}
// A grade was returned at or after the revision came in (a save in the same instant counts).
function _revisionReturnedSince(cid, r) {
  if (!r.revision_sent_at) return false;
  var row = getGradeReturn(cid, r.enrollment_id, r.assessment_id);
  return !!row && !!row.returned_at && String(row.returned_at) >= String(r.revision_sent_at);
}
function _revisionIsOpen(state) {
  return state === 'open' || state === 'sent' || state === 'grading';
}

/* The grade is hidden now: Hide was chosen, the request is not taken back,
   and no Return has ended the hide. Only a Return ends it: whatever else
   the teacher does to the score (a regrade, Clear Score, which takes the
   never-returned row away), the grade stays hidden and Take Back gives the
   student back what the request kept (hidden_row, first_grade). */
function _revisionHidden(cid, r) {
  if (r._live) return false; // Hide is not built: the grade is always kept
  if (!r.hidden || r.cancelled_at || r.hide_ended_at) return false;
  var row = getGradeReturn(cid, r.enrollment_id, r.assessment_id);
  return !row || !row.returned_at;
}

// When a request closed: Take Back, or the return of the revision's grade.
function _revisionClosedAt(cid, r, state) {
  if (r._live) return r.closed_at || null;
  if (state === 'cancelled') return r.cancelled_at;
  if (state !== 'returned') return null;
  if (r.closed_at) return r.closed_at;
  var row = getGradeReturn(cid, r.enrollment_id, r.assessment_id);
  return (row && row.returned_at) || null;
}

/* After any grade_return row is saved (_saveGradeReturns), in Demo Mode:
   each request whose revision's grade has now been returned is closed for
   good (closed_at, as the server's state 'done'), and each hide a Return
   has ended is ended for good (hide_ended_at). Stored, so nothing done to
   the work or the score afterwards opens a request or hides a grade
   again. A request taken back is passed over (Take Back closes it first). */
function _revisionsAfterRowSave(cid) {
  if (!cid || !_isDemoSession()) return;
  var all = _revisionsOf(_studentFeedbackStored(cid));
  var changes = {};
  Object.keys(all).forEach(function (id) {
    var r = all[id];
    if (!_plainObject(r) || r.cancelled_at) return;
    var row = getGradeReturn(cid, r.enrollment_id, r.assessment_id);
    if (!row || !row.returned_at) return;
    var patch = {};
    if (r.hidden && !r.hide_ended_at) patch.hide_ended_at = row.returned_at;
    if (!r.closed_at && _revisionSubmission(cid, r) && _revisionReturnedSince(cid, r))
      patch.closed_at = row.returned_at;
    if (Object.keys(patch).length) changes[id] = patch;
  });
  var ids = Object.keys(changes);
  if (!ids.length) return;
  var draft = _studentFeedbackDraft(cid);
  ids.forEach(function (id) {
    if (draft.revisions[id]) Object.assign(draft.revisions[id], changes[id]);
  });
  _studentFeedbackWrite(cid, draft);
}

/* Every request of the class on a student and a piece still in it, oldest
   first. [] while revisionsOn is false. */
function _classRevisions(cid) {
  if (!revisionsOn(cid)) return [];
  var all = _revisionsOf(_studentFeedbackStored(cid));
  var students = {};
  (getStudents(cid) || []).forEach(function (s) {
    if (s && s.id) students[s.id] = true;
  });
  return (
    _isDemoSession()
      ? Object.keys(all).map(function (id) {
          return all[id];
        })
      : _fbRevisions(cid)
  )
    .filter(function (r) {
      return _plainObject(r) && students[r.enrollment_id] && _assessmentById(cid, r.assessment_id);
    })
    .sort(function (x, y) {
      return String(x.created_at) < String(y.created_at) ? -1 : String(x.created_at) > String(y.created_at) ? 1 : 0;
    });
}

// The newest request for one student and piece, cancelled or not, or null.
function _revisionNewest(cid, sid, aid) {
  var mine = _classRevisions(cid).filter(function (r) {
    return r.enrollment_id === sid && r.assessment_id === aid;
  });
  return mine[mine.length - 1] || null;
}
// The open request for one student and piece, or null.
function _revisionOpen(cid, sid, aid) {
  var r = _revisionNewest(cid, sid, aid);
  return r && _revisionIsOpen(_revisionState(cid, r)) ? r : null;
}

/* The teacher's shape of a request: return_for_revision's `request` and
   each item of list_course_feedback.revisions. first_grade is the raw copy
   ("Was Developing + on the Oct 30 version"). */
function _revisionRow(cid, r) {
  var state = _revisionState(cid, r);
  if (r._live) {
    var kept = Object.assign({}, _studentWorkCopy(r));
    delete kept._live;
    return kept;
  }
  return {
    id: r.id,
    assessment_id: r.assessment_id,
    enrollment_id: r.enrollment_id,
    what_to_fix: r.what_to_fix,
    revise_by: r.revise_by || null,
    criterion_ids: (r.criterion_ids || []).slice(),
    keep_grade: r.keep_grade !== false,
    grade_hidden: _revisionHidden(cid, r),
    first_submission_id: r.first_submission_id || null,
    first_version: r.first_version || 1,
    first_grade: _studentWorkCopy(r.first_grade) || null,
    first_returned_at: r.first_returned_at || null,
    created_at: r.created_at,
    updated_at: r.updated_at,
    closed_at: _revisionClosedAt(cid, r, state),
    state: state,
    revision_submission_id: state === 'open' || state === 'cancelled' ? null : r.revision_submission_id,
    revision_version: state === 'open' || state === 'cancelled' ? null : r.revision_version,
    revision_sent_at: state === 'open' || state === 'cancelled' ? null : r.revision_sent_at,
    revision_note: state === 'open' || state === 'cancelled' ? null : r.revision_note || null,
    revision_late: state === 'open' || state === 'cancelled' ? null : !!r.revision_late,
    revision_sent_by: state === 'open' || state === 'cancelled' ? null : r.revision_sent_by || 'student',
  };
}

/* The request on one student's piece, for the teacher's screens (the
   grader's Revision card, "Was … on the Oct 30 version", Take Back): the
   newest one, cancelled or not, as _revisionRow, or null. */
function getRevisionRequest(cid, sid, aid) {
  var r = _revisionNewest(cid, sid, aid);
  return r ? _revisionRow(cid, r) : null;
}

/* What the gradebook cell, the counts and the dashboard ask of one
   student's piece: 'revising' (returned for revision, nothing in yet: the
   cell's Revising), 'revised' (the revision is in and grading has not
   started: To Grade, and the dashboard's "1 Revised"), 'grading' (the new
   grade is a draft: To Return), or null (no open request, revisionsOn
   false, or Missing or Excused on the piece, which show their status). */
function revisionWorkState(cid, sid, aid) {
  var r = _revisionOpen(cid, sid, aid);
  if (!r) return null;
  var status = getAssignmentStatus(cid, sid, aid);
  if (status === 'NS' || status === 'EXC') return null;
  var state = _revisionState(cid, r);
  return state === 'open' ? 'revising' : state === 'sent' ? 'revised' : 'grading';
}

/* The student's shape of their request (feedback(...).revision), or null
   when there is none or it was taken back. first_grade is the first
   version's grade as the student had it, cut to what the work is scored by
   now; null while the grade is hidden, or Missing or Excused is on the
   piece. The new grade is the returned set's. */
function _studentRevisionOf(cid, sid, a) {
  var r = _revisionNewest(cid, sid, a.id);
  if (!r) return null;
  var state = _revisionState(cid, r);
  if (state === 'cancelled') return null;
  var status = getAssignmentStatus(cid, sid, a.id);
  var hidden = _revisionHidden(cid, r);
  var firstSub = r.first_submission_id
    ? _studentWorkSubmissions(cid).find(function (s) {
        return s.id === r.first_submission_id;
      })
    : null;
  var inNow = state !== 'open';
  return {
    // A draft is not the student's to see: grading reads as sent.
    state: state === 'grading' ? 'sent' : state,
    what_to_fix: r.what_to_fix,
    revise_by: r.revise_by || null,
    criterion_ids: (r.criterion_ids || []).slice(),
    keep_grade: r.keep_grade !== false,
    grade_hidden: hidden,
    first_version: r.first_version || 1,
    first_sent_at: (firstSub && firstSub.sent_at) || null,
    first_grade:
      hidden || status === 'NS' || status === 'EXC'
        ? null
        : GradeState.partInUse(r.first_grade, _revisionScoring(cid, a)),
    revision_version: inNow ? r.revision_version : null,
    revision_sent_at: inNow ? r.revision_sent_at : null,
    revision_note: inNow ? r.revision_note || null : null,
    revision_late: inNow ? !!r.revision_late : null,
    asked_at: r.created_at,
  };
}

/* One student's own revision on one piece (Needs Revision, Send My
   Revision, Before and After), in the student's shape, or null. */
function getStudentRevision(cid, sid, aid) {
  var a = _assessmentById(cid, aid);
  return a ? _studentRevisionOf(cid, sid, a) : null;
}

/* Every handed-in version of one student's work on a piece, oldest first
   (version 1, then the revisions): the grader's New and First pages side
   by side, and Before and After's two photos. Each as getStudentSubmission
   gives one. getStudentSubmission is still the newest. */
function getSubmissionVersions(cid, sid, aid) {
  return _studentWorkSubmissions(cid)
    .filter(function (s) {
      return s.enrollment_id === sid && s.assessment_id === aid;
    })
    .sort(function (x, y) {
      return (x.version || 1) - (y.version || 1);
    });
}

/* The first version's result, worked out by calc.js as the student page
   works out any result (assessmentCellValue on returned grades), with this
   one piece read as the request's first_grade: Before and After's "2.7 ·
   67%". `forStudent`: null while the grade is hidden. null with no request
   or no first grade, and while Missing or Excused is on the piece (the
   cell would show the status). Nothing is kept: every grade outside this
   call is as before. */
function getRevisionFirstCell(cid, sid, aid, forStudent) {
  var r = _revisionNewest(cid, sid, aid);
  var a = _assessmentById(cid, aid);
  if (!r || !a || !r.first_grade || r.cancelled_at) return null;
  if (forStudent && _revisionHidden(cid, r)) return null;
  var status = getAssignmentStatus(cid, sid, aid);
  if (status === 'NS' || status === 'EXC') return null;
  var copy = GradeState.partInUse(r.first_grade, _revisionScoring(cid, a));
  if (!copy) return null;
  var working = getScores(cid) || {};
  var own = (Array.isArray(working[sid]) ? working[sid] : []).filter(function (e) {
    return e && e.assessmentId === aid;
  });
  _firstVersionScope = { cid: cid, sid: sid, aid: aid, entries: _gradeCopyEntries(cid, sid, aid, copy, own, working) };
  clearProfCache();
  try {
    return withReturnedOnly(function () {
      return assessmentCellValue(cid, sid, a);
    });
  } finally {
    _firstVersionScope = null;
    clearProfCache();
  }
}

/* A request as return_for_revision takes it: { what_to_fix, revise_by,
   criterion_ids, keep_grade }, tidied, or null when it is not one.
   `patch`: set_revision_request's, any of the first three. */
function _revisionRequestOk(cid, a, req, patch) {
  if (!_plainObject(req)) return null;
  var names = Object.keys(req);
  var allowed = patch ? ['what_to_fix', 'revise_by', 'criterion_ids'] : null;
  if (
    allowed &&
    (!names.length ||
      names.some(function (k) {
        return allowed.indexOf(k) < 0;
      }))
  ) {
    return null;
  }
  var out = {};
  if (!patch || 'what_to_fix' in req) {
    var fix = req.what_to_fix;
    if (typeof fix !== 'string' || !fix.trim() || fix.length > REVISION_FIX_MAX) return null;
    out.what_to_fix = fix;
  }
  if (!patch || 'revise_by' in req) {
    var by = req.revise_by == null ? null : req.revise_by;
    if (by !== null && (typeof by !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(by) || isNaN(Date.parse(by)))) {
      return null;
    }
    out.revise_by = by;
  }
  if (!patch || 'criterion_ids' in req) {
    var ids = req.criterion_ids == null ? [] : req.criterion_ids;
    if (!Array.isArray(ids)) return null;
    // Criteria of the piece's rubric, and nothing on work with none.
    var rubricId = a.rubricId || a.rubric_id;
    var on = ((rubricId && getRubricById(cid, rubricId)) || {}).criteria || [];
    var known = on.filter(Boolean).map(function (c) {
      return String(c.id);
    });
    var ok = ids.every(function (id) {
      return typeof id === 'string' && known.indexOf(id) >= 0;
    });
    if (!ok) return null;
    out.criterion_ids = ids.filter(function (id, i) {
      return ids.indexOf(id) === i;
    });
  }
  if (!patch) {
    if (typeof req.keep_grade !== 'boolean') return null;
    out.keep_grade = req.keep_grade;
  }
  return out;
}

// A row with its nulls left out, or null when it says nothing (as the rule keeps rows).
function _revisionRowKept(row) {
  if (!row) return null;
  var out = { is_draft: !!row.is_draft };
  ['returned_at', 'returned_copy', 'previous_copy', 'updated_at', 'seen_at'].forEach(function (f) {
    if (row[f] != null) out[f] = row[f];
  });
  return out.is_draft || Object.keys(out).length > 1 ? out : null;
}
function _revisionSetRow(cid, sid, aid, row) {
  var rows = getGradeReturns(cid);
  var out = Object.assign({}, rows);
  out[aid] = Object.assign({}, out[aid]);
  var kept = _revisionRowKept(row);
  if (kept) out[aid][sid] = kept;
  else delete out[aid][sid];
  if (!Object.keys(out[aid]).length) delete out[aid];
  _saveGradeReturns(cid, out);
}

/* The server's answer to a revision write, a few seconds at most: null when
   there is none (offline, slow), and the screen goes on as if it landed. */
function _fbWaitAnswer(sent) {
  var late = new Promise(function (resolve) {
    setTimeout(resolve, _MARKUP_SAVE_WAIT_MS, null);
  });
  return Promise.race([Promise.resolve(sent), late]);
}
function _fbRefused(res) {
  return !!(res && res.error && /P0002|not found/i.test(String(res.error.code || res.error.message || '')));
}

/* Return for Revision for a live class: the work is returned as Return
   returns it (returnWork: the grade and the marks, one call), then
   return_for_revision, which returns it again (nothing left to return) and
   makes the request; both in the student's cell order. The request shows
   open at once. The Promise answers as the Demo writer's does. */
function _returnForRevisionLive(cid, sid, aid, req, key) {
  if (!_isUuid(sid) || !_isUuid(aid)) return Promise.resolve({ result: 'not_found' });
  var returned = returnWork(cid, aid, [sid]);
  var sent = _writeRpc('return_for_revision', {
    p_assessment_id: aid,
    p_enrollment_id: sid,
    p_request: {
      what_to_fix: req.what_to_fix,
      revise_by: req.revise_by,
      criterion_ids: req.criterion_ids,
      keep_grade: true,
    },
    p_idempotency_key: _isUuid(key) ? key : _newEntryId(),
  });
  if (sent && sent.refused) return Promise.resolve({ result: 'failed' });
  _fbChanged(cid);
  _trackPendingSync(Promise.resolve(sent));
  return _fbWaitAnswer(sent).then(function (res) {
    var data = res && !res.error ? _rpcObject(res.data) : null;
    if (!res) {
      // No answer yet: the request is shown open and goes when the device can send it.
      var shown = _revisionOpen(cid, sid, aid);
      return { result: 'made', request: shown ? _revisionRow(cid, shown) : null, returned: returned, hidden: false };
    }
    if (data && data.result === 'made') {
      return { result: 'made', request: _fbLiveRow(data.request), returned: returned, hidden: false };
    }
    if (data && data.result === 'already_open') return { result: 'already_open', request: _fbLiveRow(data.request) };
    if (data && data.result === 'not_for_dibels') return { result: 'not_for_dibels' };
    if (data && data.result === 'hide_not_available') return { result: 'hide_needs_holding' };
    return _fbRefused(res) ? { result: 'not_found' } : { result: 'failed' };
  });
}

// A request as the server sent it, for the screens.
function _fbLiveRow(r) {
  return _plainObject(r) ? _studentWorkCopy(r) : null;
}

/* set_revision_request and cancel_revision for a live class, through the
   outbox under their own keys. A request made here and not answered yet has
   no server id to name: that answers failed and the teacher presses again. */
function _reviseLive(endpoint, cid, found, extra, key) {
  if (!_isUuid(found.id)) return Promise.resolve({ result: 'failed' });
  var body = Object.assign({ p_request_id: found.id }, extra, {
    p_idempotency_key: _isUuid(key) ? key : _newEntryId(),
  });
  var sent =
    endpoint === 'cancel_revision' ? _writeRpc('cancel_revision', body) : _writeRpc('set_revision_request', body);
  if (sent && sent.refused) return Promise.resolve({ result: 'failed' });
  _fbChanged(cid);
  _trackPendingSync(Promise.resolve(sent));
  return _fbWaitAnswer(sent).then(function (res) {
    var data = res && !res.error ? _rpcObject(res.data) : null;
    if (!res) {
      var now = _classRevisions(cid).find(function (r) {
        return r.id === found.id;
      });
      var row = now ? _revisionRow(cid, now) : null;
      return endpoint === 'cancel_revision'
        ? { result: 'cancelled', unhidden: false, request: row }
        : { result: 'saved', request: row };
    }
    if (data && (data.result === 'saved' || data.result === 'cancelled')) {
      return Object.assign(
        { result: data.result, request: _fbLiveRow(data.request) },
        data.result === 'cancelled' ? { unhidden: false } : {},
      );
    }
    if (data && data.result === 'not_open') return { result: 'not_open' };
    return _fbRefused(res) ? { result: 'not_found' } : { result: 'failed' };
  });
}

/* Return for Revision (return_for_revision), for one student and piece.
   `request`: { what_to_fix (1 to 2000 characters), revise_by ('YYYY-MM-DD'
   or null), criterion_ids (criteria of the piece's rubric; [] on work with
   none), keep_grade (true: Keep this grade, the new version replaces it;
   false: Hide the grade until then) }. `key`: an idempotency key made once
   per press. The work is returned first, exactly as returnWork returns it
   (the grade and the marks); then the request is made.
   A Promise, never rejected, of:
   { result: 'made', request, returned, hidden }  (returned: returnWork's
     answer; hidden: the grade was hidden);
   { result: 'already_open', request }  an open request exists;
   { result: 'hide_needs_holding' }  Hide in a class that does not hold
     grades; nothing changed;
   { result: 'not_for_dibels' }; { result: 'not_found' } (a student or piece
   not in the class); { result: 'invalid' } (a wrong request, or no key);
   { result: 'revisions_off' } (revisionsOn false); signed in
   { result: 'not_available' }. The same key again answers the same. */
function returnForRevision(cid, sid, aid, request, key) {
  if (!cid || !(_isDemoSession() || _fbOn(cid))) return Promise.resolve({ result: 'not_available' });
  if (!_idemKeyOk(key)) return Promise.resolve({ result: 'invalid' });
  var again = _feedbackRemembered(cid, 'revision-make', key);
  if (again !== undefined) return Promise.resolve(again);
  if (!revisionsOn(cid)) return Promise.resolve({ result: 'revisions_off' });
  var a = _assessmentById(cid, aid);
  if (!a || !_teacherWorkInClass(cid, sid, aid)) return Promise.resolve({ result: 'not_found' });
  if (isDibelsScored(a)) return Promise.resolve({ result: 'not_for_dibels' });
  var req = _revisionRequestOk(cid, a, request, false);
  if (!req) return Promise.resolve({ result: 'invalid' });
  var open = _revisionOpen(cid, sid, aid);
  if (open) return Promise.resolve({ result: 'already_open', request: _revisionRow(cid, open) });
  if (!req.keep_grade && !GradeState.holds(getReturnSettings(cid))) {
    return Promise.resolve({ result: 'hide_needs_holding' });
  }
  if (!_isDemoSession()) return _returnForRevisionLive(cid, sid, aid, req, key);
  var returned = returnWork(cid, aid, [sid]);
  var first = _revisionWorking(cid, sid, aid);
  var before = getGradeReturn(cid, sid, aid);
  var firstSub = getStudentSubmission(cid, sid, aid);
  var now = new Date().toISOString();
  // Hide: the row becomes a draft never returned (C2). Nothing to hide with no grade.
  var hide = !req.keep_grade && !!first;
  if (hide) _revisionSetRow(cid, sid, aid, { is_draft: true, seen_at: before && before.seen_at });
  var draft = _studentFeedbackDraft(cid);
  var id = 'rv' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  draft.revisions[id] = {
    id: id,
    assessment_id: aid,
    enrollment_id: sid,
    what_to_fix: req.what_to_fix,
    revise_by: req.revise_by,
    criterion_ids: req.criterion_ids,
    keep_grade: req.keep_grade,
    hidden: hide,
    // The row as it was before Hide, so Take Back gives the grade back as the student had it.
    hidden_row: hide ? _studentWorkCopy(before) : null,
    first_submission_id: firstSub ? firstSub.id : null,
    first_version: firstSub ? firstSub.version || 1 : 1,
    first_grade: first,
    first_returned_at: (before && before.returned_at) || null,
    created_at: now,
    updated_at: now,
    cancelled_at: null,
  };
  var answer = { result: 'made', request: _revisionRow(cid, draft.revisions[id]), returned: returned, hidden: hide };
  _feedbackRemember(draft, 'revision-make', key, answer);
  _studentFeedbackWrite(cid, draft);
  return Promise.resolve(answer);
}

/* Change What to Fix, Revise By or the criteria of an open request
   (set_revision_request). Keep or Hide is not changed here. A Promise of
   { result: 'saved', request }, { result: 'not_open' }, { result:
   'not_found' }, { result: 'invalid' }, { result: 'revisions_off' }, or
   signed in { result: 'not_available' }. The same key again answers the same. */
function setRevisionRequest(cid, requestId, patch, key) {
  if (!cid || !(_isDemoSession() || _fbOn(cid))) return Promise.resolve({ result: 'not_available' });
  if (!_idemKeyOk(key)) return Promise.resolve({ result: 'invalid' });
  var again = _feedbackRemembered(cid, 'revision-set', key);
  if (again !== undefined) return Promise.resolve(again);
  if (!revisionsOn(cid)) return Promise.resolve({ result: 'revisions_off' });
  var found = _classRevisions(cid).find(function (r) {
    return r.id === requestId;
  });
  if (!found) return Promise.resolve({ result: 'not_found' });
  var ok = _revisionRequestOk(cid, _assessmentById(cid, found.assessment_id), patch, true);
  if (!ok) return Promise.resolve({ result: 'invalid' });
  if (!_revisionIsOpen(_revisionState(cid, found))) return Promise.resolve({ result: 'not_open' });
  if (!_isDemoSession()) return _reviseLive('set_revision_request', cid, found, { p_patch: ok }, key);
  var draft = _studentFeedbackDraft(cid);
  var r = draft.revisions[found.id];
  Object.assign(r, ok, { updated_at: new Date().toISOString() });
  var answer = { result: 'saved', request: _revisionRow(cid, r) };
  _feedbackRemember(draft, 'revision-set', key, answer);
  _studentFeedbackWrite(cid, draft);
  return Promise.resolve(answer);
}

/* Take Back (cancel_revision). A revision already sent stays as a later
   version. A hidden grade is given back exactly as the student had it; a
   change the teacher made since waits as a draft on it. A Promise of
   { result: 'cancelled', unhidden, request }, { result: 'not_open' },
   { result: 'not_found' }, { result: 'invalid' } (no key), { result:
   'revisions_off' }, or signed in { result: 'not_available' }. */
function cancelRevision(cid, requestId, key) {
  if (!cid || !(_isDemoSession() || _fbOn(cid))) return Promise.resolve({ result: 'not_available' });
  if (!_idemKeyOk(key)) return Promise.resolve({ result: 'invalid' });
  var again = _feedbackRemembered(cid, 'revision-cancel', key);
  if (again !== undefined) return Promise.resolve(again);
  if (!revisionsOn(cid)) return Promise.resolve({ result: 'revisions_off' });
  var found = _classRevisions(cid).find(function (r) {
    return r.id === requestId;
  });
  if (!found) return Promise.resolve({ result: 'not_found' });
  if (!_revisionIsOpen(_revisionState(cid, found))) return Promise.resolve({ result: 'not_open' });
  if (!_isDemoSession()) return _reviseLive('cancel_revision', cid, found, {}, key);
  var unhide = _revisionHidden(cid, found);
  var now = new Date().toISOString();
  // Closed first, so the row given back below is not read as a Return that ends anything.
  var closing = _studentFeedbackDraft(cid);
  Object.assign(closing.revisions[found.id], { cancelled_at: now, updated_at: now });
  _studentFeedbackWrite(cid, closing);
  if (unhide) {
    var sid = found.enrollment_id;
    var aid = found.assessment_id;
    // What the request kept of the row before Hide: the student is given exactly that back,
    // even when the row has gone since (Clear Score takes a never-returned row away).
    var was = found.hidden_row || (found.first_returned_at ? { returned_at: found.first_returned_at } : null);
    var row = Object.assign({}, was || {}, { is_draft: false, returned_copy: null });
    var seen = (getGradeReturn(cid, sid, aid) || {}).seen_at;
    if (seen) row.seen_at = seen;
    // A change made since the hide (a regrade, a Clear) waits as a draft on the grade given back.
    if (!GradeState.sameCopy(_revisionWorking(cid, sid, aid), found.first_grade)) {
      row.is_draft = true;
      row.returned_copy = _studentWorkCopy(found.first_grade);
    }
    _revisionSetRow(cid, sid, aid, row);
  }
  var draft = _studentFeedbackDraft(cid);
  var r = draft.revisions[found.id];
  var answer = { result: 'cancelled', unhidden: unhide, request: _revisionRow(cid, r) };
  _feedbackRemember(draft, 'revision-cancel', key, answer);
  _studentFeedbackWrite(cid, draft);
  return Promise.resolve(answer);
}

/* The student `from` (signed in on the page) acting on their own piece:
   an error code, or null to go on. */
function _studentRevisionCheck(cid, sid, aid, from) {
  if (!cid || !_isDemoSession()) return 'not_available';
  if (!sid || from !== sid || !_teacherWorkInClass(cid, sid, aid)) return 'not_found';
  if (!revisionsOn(cid)) return 'send_off';
  return null;
}

// A page as Demo Mode keeps it: a shipped sample file, or a photo in the photo queue.
var _REVISION_PAGE = /^([a-z0-9-]+\.jpg|photo-queue:p[a-z0-9]+)$/;
var _REVISION_THUMB = /^([a-z0-9-]+\.jpg|photo-queue:p[a-z0-9]+:thumb)$/;
function _revisionFilesOk(files) {
  return (
    Array.isArray(files) &&
    files.length > 0 &&
    files.length <= STUDENT_WORK_MAX_PAGES &&
    files.every(function (f) {
      return (
        _plainObject(f) &&
        typeof f.path === 'string' &&
        _REVISION_PAGE.test(f.path) &&
        typeof f.thumb_path === 'string' &&
        _REVISION_THUMB.test(f.thumb_path)
      );
    })
  );
}

/* Send My Revision: revision_start and revision_finish in one call, Demo
   Mode's stand-in (nothing uploads). `files`: the pages, in order, each
   { path, thumb_path, bytes?, thumb_bytes?, width?, height?, sha256? } with
   a path Demo Mode can show (a sample file name, or a photo-queue path from
   PhotoQueue.add). `note`: the student's note, 1000 characters at most, or
   null. `from`: the student signed in on the page. The revision is the
   next version of the submission; sent again before grading starts it
   takes the place of the one in. Sent after Revise By it is late (a label:
   it changes no number). Answers { ok: true, submission_id, version, late }
   or { ok: false, error }: not_available (signed in), not_found, send_off
   (revisionsOn false), not_taking_work (Students Send is Nothing),
   no_revision (no open request), grading_started (the revision in is being
   graded, carries the teacher's marks, or was returned), invalid. */
function sendStudentRevision(cid, sid, aid, files, note, from) {
  var refused = _studentRevisionCheck(cid, sid, aid, from);
  if (refused) return { ok: false, error: refused };
  if (getAssessmentStudentWork(cid, aid).students_send === 'nothing') return { ok: false, error: 'not_taking_work' };
  if (!_revisionFilesOk(files)) return { ok: false, error: 'invalid' };
  if (note != null && (typeof note !== 'string' || note.length > 1000)) return { ok: false, error: 'invalid' };
  var r = _revisionOpen(cid, sid, aid);
  if (!r) return { ok: false, error: 'no_revision' };
  var state = _revisionState(cid, r);
  if (state !== 'open' && state !== 'sent') return { ok: false, error: 'grading_started' };
  var work = _studentWorkDraft(cid);
  // Sent again before grading starts: the revision in goes, its pages with it.
  if (state === 'sent') {
    work.submissions = work.submissions.filter(function (s) {
      return !(s && s.id === r.revision_submission_id);
    });
  }
  var version = work.submissions.reduce(function (n, s) {
    return s && s.state === 'sent' && s.enrollment_id === sid && s.assessment_id === aid
      ? Math.max(n, s.version || 1)
      : n;
  }, 0);
  version = Math.max(version, r.first_version || 1) + 1;
  var stamp = new Date().toISOString();
  var late = !!r.revise_by && courseToday(cid) > r.revise_by;
  var subId = 'rs' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  var text = note == null || !String(note).trim() ? null : String(note);
  work.submissions.push({
    id: subId,
    assessment_id: aid,
    enrollment_id: sid,
    version: version,
    state: 'sent',
    sent_by: 'student',
    on_paper: false,
    is_late: late,
    note: text,
    followed_plan: null,
    created_at: stamp,
    sent_at: stamp,
    files: files.map(function (f, i) {
      return {
        id: subId + '-p' + (i + 1),
        page: i + 1,
        path: f.path,
        thumb_path: f.thumb_path,
        bytes: f.bytes == null ? null : f.bytes,
        thumb_bytes: f.thumb_bytes == null ? null : f.thumb_bytes,
        width: f.width == null ? null : f.width,
        height: f.height == null ? null : f.height,
        rotation: 0,
        sha256: f.sha256 == null ? null : f.sha256,
        added_by: 'student',
      };
    }),
  });
  _studentWorkWrite(cid, work);
  var draft = _studentFeedbackDraft(cid);
  Object.assign(draft.revisions[r.id], {
    revision_submission_id: subId,
    revision_version: version,
    revision_sent_at: stamp,
    revision_note: text,
    revision_late: late,
    revision_sent_by: 'student',
    // The grade as it stood when the revision came in: what "grading started" is measured from.
    revision_grade_at_send: _revisionWorking(cid, sid, aid),
    updated_at: stamp,
  });
  _studentFeedbackWrite(cid, draft);
  return { ok: true, submission_id: subId, version: version, late: late };
}

/* Unsend My Revision (revision_unsend): the revision in goes, with its
   pages, and the request is open again. Answers { ok: true, unsent, cancelled:
   false, pages } (unsent false and pages 0 with nothing in) or { ok: false,
   error }: not_available, not_found, send_off, no_revision (no open
   request), grading_started. */
function unsendStudentRevision(cid, sid, aid, from) {
  var refused = _studentRevisionCheck(cid, sid, aid, from);
  if (refused) return { ok: false, error: refused };
  var r = _revisionOpen(cid, sid, aid);
  if (!r) return { ok: false, error: 'no_revision' };
  var state = _revisionState(cid, r);
  if (state === 'open') return { ok: true, unsent: false, cancelled: false, pages: 0 };
  if (state !== 'sent') return { ok: false, error: 'grading_started' };
  var sub = _revisionSubmission(cid, r);
  var work = _studentWorkDraft(cid);
  work.submissions = work.submissions.filter(function (s) {
    return !(s && s.id === r.revision_submission_id);
  });
  _studentWorkWrite(cid, work);
  var draft = _studentFeedbackDraft(cid);
  Object.assign(draft.revisions[r.id], {
    revision_submission_id: null,
    revision_version: null,
    revision_sent_at: null,
    revision_note: null,
    revision_late: null,
    revision_sent_by: null,
    revision_grade_at_send: null,
    updated_at: new Date().toISOString(),
  });
  _studentFeedbackWrite(cid, draft);
  return { ok: true, unsent: true, cancelled: false, pages: ((sub && sub.files) || []).length };
}

/* Demo Mode's sample requests (seed-data.js): [{ assessment_id,
   enrollment_id, what_to_fix, revise_by, criterion_ids, created_at }],
   each kept with the grade as it stands (Keep this grade: the sample hides
   none and returns nothing, so no grade changes), whatever the switches
   say. false outside Demo Mode, or for a student or piece not in the class. */
function saveDemoRevisions(cid, list) {
  if (!cid || !_isDemoSession() || !Array.isArray(list)) return false;
  var ok = list.every(function (r) {
    var a = _plainObject(r) ? _assessmentById(cid, r.assessment_id) : null;
    return (
      a &&
      _teacherWorkInClass(cid, r.enrollment_id, r.assessment_id) &&
      r.created_at &&
      !!_revisionRequestOk(
        cid,
        a,
        { what_to_fix: r.what_to_fix, revise_by: r.revise_by, criterion_ids: r.criterion_ids, keep_grade: true },
        false,
      )
    );
  });
  if (!ok) return false;
  var draft = _studentFeedbackDraft(cid);
  list.forEach(function (r) {
    var id = 'demo-rv-' + r.enrollment_id + '-' + r.assessment_id;
    var sub = getStudentSubmission(cid, r.enrollment_id, r.assessment_id);
    var row = getGradeReturn(cid, r.enrollment_id, r.assessment_id);
    draft.revisions[id] = {
      id: id,
      assessment_id: r.assessment_id,
      enrollment_id: r.enrollment_id,
      what_to_fix: r.what_to_fix,
      revise_by: r.revise_by || null,
      criterion_ids: (r.criterion_ids || []).slice(),
      keep_grade: true,
      hidden: false,
      hidden_row: null,
      first_submission_id: sub ? sub.id : null,
      first_version: sub ? sub.version || 1 : 1,
      first_grade: _revisionWorking(cid, r.enrollment_id, r.assessment_id),
      first_returned_at: (row && row.returned_at) || null,
      created_at: r.created_at,
      updated_at: r.created_at,
      cancelled_at: null,
    };
  });
  _studentFeedbackWrite(cid, draft);
  return true;
}

/* ── Namespace ──────────────────────────────────────────────── */
var _mobileRerender = null;

function hasPendingLocalCid(cid) {
  return !!cid && (_pendingLocalCids.has(cid) || !!_pendingCreateFor('course', cid));
}

window.GB = {
  getSyncStatus,
  isSupabaseDegraded,
  retrySupabaseRecovery,
  hasPendingLocalCid,
  getLastSyncedAt,
  // retrySyncs + refreshFromSupabase removed in Phase 6.1; v2 offline path
  // exposes `window.v2Queue.flush()` as the retry entry point.
  registerMobileRerender: function (fn) {
    _mobileRerender = fn;
  },
  initAllCourses,
  initData,
  isClassLoaded,
  loadClass,
  preloadClasses,
  esc,
  initials,
  pronounsSelect,
  fullName,
  displayName,
  displayNameFirst,
  sortStudents,
  anonymizeStudents,
  migrateLearningMap,
  migrateOverridesForFlatMap,
  migrateGoalsForFlatMap,
  migrateReflectionsForFlatMap,
  migrateStudent,
  migrateAllStudents,
  formatTs,
  formatDate,
  uid,
  getParam,
  getTodayStr,
  loadCourses,
  saveCourses,
  createCourse,
  updateCourse,
  deleteCourseData,
  getGradingScale,
  getReportingTerms,
  reportingTermsError,
  saveReportingTerms,
  reportingTermOn,
  loadCurriculumIndex,
  getCoursesByGrade,
  getSubjectsByGrade,
  buildLearningMapFromTags,
  getLearningMap,
  saveLearningMap,
  resetLearningMap,
  ensureCustomLearningMap,
  getRemovedSections,
  mergeRemovedSectionsFromServer,
  removeCompetencies,
  restoreCompetency,
  getModules,
  saveModules,
  getModuleById,
  getCompetencyGroups,
  saveCompetencyGroups,
  getCompetencyGroupById,
  setSectionGroup,
  getGroupedSections,
  addCustomSection,
  removeSection,
  getAssignmentStatuses,
  saveAssignmentStatuses,
  getAssignmentStatus,
  setAssignmentStatus,
  hasScoreOrFeedback,
  canSetAssignmentStatus,
  isScoreLocked,
  applyAssignmentStatus,
  getRubrics,
  saveRubrics,
  getRubricById,
  deleteRubric,
  getSections,
  getSubjects,
  getAllTags,
  getTagById,
  getSectionForTag,
  getConfig,
  saveConfig,
  getCourseConfig,
  saveCourseConfig,
  getStudents,
  saveStudents,
  getCategories,
  saveCategories,
  getCategoryById,
  getAssessmentCategoryId,
  getAssessmentCategoryName,
  showsCategoryBadge,
  categoryRequired,
  assessmentNeedsCategory,
  getAssessments,
  saveAssessments,
  getOverrides,
  saveOverrides,
  getNotes,
  saveNotes,
  getScores,
  saveScores,
  getReturnSettings,
  setStudentPageSwitch,
  saveReturnSettings,
  draftsWaitingToReturn,
  getGradeReturns,
  getGradeReturn,
  getReturnedScores,
  getCourseSubmissions,
  getStudentSubmission,
  getStudentWorkGroup,
  getGroupSubmissions,
  groupWorkIn,
  getGroupWorkFiles,
  getStudentGroupWork,
  getAssessmentStudentWork,
  getCourseSendWork,
  getStudentWork,
  studentWorkGradingStarted,
  studentWorkPageUrl,
  saveDemoStudentWork,
  studentWorkLive,
  refreshStudentWork,
  refreshCourseFeedback,
  loadAssessmentMarkup,
  getCourseFeedbackOptions,
  readStudentWorkForDelete,
  retryHeldStudentWork,
  setCourseSendWork,
  saveAssessmentStudentWork,
  addStudentWorkPages,
  replaceStudentWorkPages,
  markStudentWorkOnPaper,
  deleteStudentWork,
  openStudentWorkPage,
  getPageMarkup,
  getAssessmentMarkup,
  saveMarkup,
  studentMarkupWaiting,
  returnWork,
  getStudentMarkup,
  getStudentMarkCounts,
  saveDemoMarkup,
  getReflectOnFeedback,
  setCourseFeedbackOptions,
  getCourseFeedback,
  getQuestionsWaiting,
  getStudentReflections,
  getStudentLastPlan,
  answerReflection,
  sendStudentReflection,
  sendStudentReply,
  getStudentFeedback,
  setStudentFollowedPlan,
  saveDemoReflections,
  revisionsOn,
  getRevisionRequest,
  revisionWorkState,
  getStudentRevision,
  getSubmissionVersions,
  getRevisionFirstCell,
  returnForRevision,
  setRevisionRequest,
  cancelRevision,
  sendStudentRevision,
  unsendStudentRevision,
  saveDemoRevisions,
  returnGrades,
  listStudentCards,
  makeStudentCards,
  markStudentCardsPrinted,
  unlockStudentCard,
  unlockAllStudentCards,
  getCardsWorkUntil,
  setCardsWorkUntil,
  upsertScore,
  persistScoreDiffToCanonical,
  getPointsScore,
  setPointsScore,
  getCompletionMark,
  setCompletionMark,
  getActiveCourse,
  setActiveCourse,
  switchActiveCourse,
  getFlags,
  saveFlags,
  isStudentFlagged,
  toggleFlag,
  getGoals,
  saveGoals,
  getGoalDates,
  setGoalDate,
  getCoreSelf,
  saveCoreSelfAssessment,
  getReflections,
  saveReflections,
  getQuickObs,
  saveQuickObs,
  getStudentQuickObs,
  getAllQuickObs,
  addQuickOb,
  deleteQuickOb,
  deleteAssessmentObservations,
  updateQuickOb,
  getQuickObsByDim,
  getAssignmentObs,
  getScoreComment,
  saveScoreComment,
  getScoreReportNote,
  saveScoreReportNote,
  clearScoreEntries,
  getStudentAssignmentFeedback,
  hasAssignmentFeedback,
  getCustomTags,
  saveCustomTags,
  addCustomTag,
  removeCustomTag,
  resolveTag,
  getTermRatings,
  saveTermRatings,
  getStudentTermRating,
  saveTermAttendance,
  getTermAttendance,
  loadTermAttendance,
  getDibelsScores,
  getDibelsScore,
  saveDibelsScore,
  loadDibelsScores,
  upsertTermRating,
  getReportConfig,
  saveReportConfig,
  getStudentProfileSummaries,
  loadStudentProfileSummaries,
  getCardWidgetConfig,
  saveCardWidgetConfig,
  clearCardWidgetConfig,
  getDashboardPrefs,
  saveDashboardPrefs,
  getViewPref,
  saveViewPref,
};

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
  var bank =
    typeof loadCurriculumIndex === 'function' ? loadCurriculumIndex().catch(function () {}) : Promise.resolve();
  if (typeof seedIfNeeded === 'function') {
    return bank.then(function () {
      seedIfNeeded();
    });
  }
  // User deliberately wiped all data — never auto-seed
  if (localStorage.getItem('gb-data-wiped') === '1') return Promise.resolve();
  // Lazy-load the script, then seed
  return Promise.all([_loadSeedScript(), bank]).then(function () {
    if (typeof seedIfNeeded === 'function') seedIfNeeded();
  });
};

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

/* Report a Problem (teacher/ui.js): one report to submit_support_report
   (migrations/20261105_support_report.sql). It goes through the outbox like
   every write (and counts on the sync dot until it lands), so a report
   written offline is sent when the device is back online. The fields are the teacher's text and what the form shows as
   attached: the page's name, the build and the browser. Never student data. */
window.submitSupportReport = function (report) {
  report = report || {};
  return _rpcOrNoop('submit_support_report', {
    p_page: String(report.page || '').slice(0, 200),
    p_message: String(report.message || '').slice(0, 5000),
    p_browser: report.browser ? String(report.browser).slice(0, 300) : null,
    p_app_version: report.appVersion ? String(report.appVersion).slice(0, 100) : null,
  });
};
