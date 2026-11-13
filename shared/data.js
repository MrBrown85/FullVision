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

// Mapping from cache field → localStorage key suffix
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
  if (_isDemoSession()) return null;
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

  // Realtime refresh: _subscribeCourseSyncCursor listens on the
  // course_sync_cursor channel and reloads a class when another device
  // changes it.

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

/* courseDayOf(cid, when): the calendar date of `when` (a Date or an ISO
 * timestamp) in the course's timezone, YYYY-MM-DD; '' for no valid time.
 * courseToday(cid) is the same for now.
 *
 * Returns the date in YYYY-MM-DD format, computed in the course's
 * timezone (not the browser's). This matters for reports: a Vancouver
 * teacher grading at 11 pm PST would see UTC midnight fall on the next
 * calendar day if we used `new Date().toISOString().slice(0, 10)`, so the
 * score would appear on reports under tomorrow's date.
 *
 * Courses store their timezone in course.timezone (column added with
 * T-UI-03 default 'America/Vancouver'). Callers pass the course id; we
 * look up the timezone, fall back to the course default, fall back again
 * to UTC. Intl.DateTimeFormat is used because it handles DST correctly. */
function courseDayOf(cid, when) {
  var at = when instanceof Date ? when : new Date(when);
  if (isNaN(at.getTime())) return '';
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
    }).formatToParts(at);
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
  return at.toISOString().slice(0, 10);
}

/* Today, in the course's timezone. */
function courseToday(cid) {
  return courseDayOf(cid, new Date());
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
    else _keepText(lsKey, json);
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
  delete _keptText['gb-scores-' + cid];
  delete _keptText['gb-statuses-' + cid];
}

/* This tab's own copy of a class's scores and of its statuses: the text of
   this tab's memory of each when it last read it from storage or wrote it
   there (docs/plans/one-mark-save-design.md, step 4). With no baseline, a
   whole-list save works out what this tab changed against it, not against
   the saved copy as another tab may have left it; the group check starts
   from it too. The save guard still reads the saved copy. Forgotten with
   the baseline. In memory only. */
var _keptText = {}; // 'gb-scores-<cid>' or 'gb-statuses-<cid>' → text

function _keepText(key, text) {
  if (key.indexOf('gb-scores-') !== 0 && key.indexOf('gb-statuses-') !== 0) return;
  if (typeof text === 'string') _keptText[key] = text;
  else delete _keptText[key];
}

// The kept text read back, or `fallback` when nothing was kept or it can't
// be read: then a save starts from the saved copy, as before.
function _keptValue(text, fallback) {
  if (typeof text !== 'string') return fallback;
  try {
    var value = JSON.parse(text);
    return value && typeof value === 'object' ? value : fallback;
  } catch (e) {
    return fallback;
  }
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
  _warnWriteRefused(name, reason);
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

/* ── Pending creates and re-keys (write-path audit, 2026-10-16, §1, 6, 7, 11)

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
  p_resource_id: 'resource',
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
  var dataKey = _DATA_KEYS[field];
  var wrote = false;
  if (value !== undefined && transform(value)) {
    _cache[field][cid] = value;
    if (field === 'rubrics') _noteRubricsSet(cid);
    // A re-key from another tab: it wrote the shared copy already.
    if (dataKey && !_applyingRemoteRekey) wrote = _safeLSSet('gb-' + dataKey + '-' + cid, JSON.stringify(value));
    if (!_applyingRemoteRekey) {
      _markLocalWrite(field, cid);
      _broadcastChange(cid, field);
    }
  }
  if (_hasServerState(field, cid)) transform(_serverState[field][cid]);
  // This tab's own copy gets the change the baseline gets, unless the
  // write above just kept the new text.
  var kept = dataKey && !wrote && _keptValue(_keptText['gb-' + dataKey + '-' + cid], null);
  if (kept && transform(kept)) _keepText('gb-' + dataKey + '-' + cid, JSON.stringify(kept));
  if (field === 'statuses' || _withdrawnRecordFields()[field]) _rekeyWithdrawnRecords(field, cid, transform);
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
  } else if (kind === 'resource') {
    // A handout or link (Handouts and Links).
    _rekeyResource(cid, localId, serverId);
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
    if (_RES_ENDPOINTS[meta.endpoint]) _onResourceWriteEvent(evt.kind, meta.endpoint, meta.payload, meta.data);
  } else if (evt.kind === 'flush:dead-letter') {
    if (_WORK_ENDPOINTS[meta.endpoint]) _onWorkWriteEvent(evt.kind, meta.endpoint, meta.payload, meta.data);
    if (_FB_ENDPOINTS[meta.endpoint]) _onFeedbackWriteEvent(evt.kind, meta.endpoint, meta.payload, meta.data);
    if (_RES_ENDPOINTS[meta.endpoint]) _onResourceWriteEvent(evt.kind, meta.endpoint, meta.payload, meta.data);
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

/* Categories (getCategories, saveCategories, getCategoryById, _persistCategoriesToCanonical, _guardCategorySave, getCategoryDraft)
   are in shared/data-categories.js, which loads just after this file. */

/* Student profile summaries (getStudentProfileSummaries, loadStudentProfileSummaries, _applyStudentProfileSummaries) are in
   shared/data-profile-summaries.js, which loads just after this file. _isMissingRpcError stays here: other code uses it. */

function _isMissingRpcError(error) {
  var msg = '';
  if (error && error.code) msg += error.code + ' ';
  if (error && error.message) msg += error.message + ' ';
  if (error && error.details) msg += error.details + ' ';
  return /PGRST202|function .*not found|could not find the function|schema cache/i.test(msg);
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

/* A piece of work as this page holds it (getAssessments), the copy every
   screen draws from, so a grade is saved for the piece as the teacher sees
   it: its competencies, scoring, rubric and groups as they are now. The
   row the class load sent (_cache.v2Gradebook) is read only for a piece
   this page does not hold. Reading the load's row first sent a competency
   added since the load, and every competency of work switched from points,
   as the piece's overall score, and filled no group-mates: that row has
   collab_mode and collab_config, not collaboration and groups. */
function _assessmentById(cid, aid) {
  var mine = (getAssessments(cid) || []).find(function (assessment) {
    return assessment && assessment.id === aid;
  });
  if (mine) return mine;
  var gb = _cache.v2Gradebook && _cache.v2Gradebook[cid];
  return (
    (gb &&
      (gb.assessments || []).find(function (assessment) {
        return assessment && assessment.id === aid;
      })) ||
    null
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
  if (_olderObservationsLoading[cid]) return;
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

/* Saved copies not opened for 14 days are removed at sign-in; an unsaved category draft stays. */
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
    return !!m && !!stale[m[1]] && key.indexOf('gb-category-draft-') !== 0;
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

/* The teacher's hand-set levels (getOverrides, saveOverrides, _fillOverrideCalculated) are in shared/data-overrides.js,
   which loads just after this file. */

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
  var cid = getActiveCourse();
  if (!cid || !_loadError[cid]) return null;
  var text = "Couldn't load the latest data for this class. " + _savedCopyDescription(cid);
  return window.__MOBILE ? text + ' Pull down to try again.' : text + ' Click the dot to try again.';
}

function _savedCopyDescription(cid) {
  var meta = _classMeta(cid);
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
  // A copy saved before every save made its snake_case fields agree.
  _cache.assessments[cid] = _assessmentFieldsAgree(_safeParseLS('gb-assessments-' + cid, []));
  _cache.scores[cid] = _safeParseLS('gb-scores-' + cid, {}, true);
  _cache.overrides[cid] = _safeParseLS('gb-overrides-' + cid, {});
  _cache.notes[cid] = _safeParseLS('gb-notes-' + cid, {});
  _cache.flags[cid] = _safeParseLS('gb-flags-' + cid, {});
  _cache.goals[cid] = _safeParseLS('gb-goals-' + cid, {});
  _cache.reflections[cid] = _safeParseLS('gb-reflections-' + cid, {});
  _cache.statuses[cid] = _safeParseLS('gb-statuses-' + cid, {}, true);
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

// keep: the text read is this tab's own copy (_keepText).
function _safeParseLS(key, fallback, keep) {
  try {
    const raw = localStorage.getItem(key);
    if (keep) _keepText(key, raw);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    if (keep) _keepText(key, null);
    console.warn('LS read fallback:', e);
    return fallback;
  }
}

function _safeLSSet(key, value) {
  try {
    localStorage.setItem(key, value);
    _storageSaved(key);
    _keepText(key, value);
    return true;
  } catch (e) {
    var keyClass = /^gb-/.test(key) && key.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
    if (e.name === 'QuotaExceededError' && /^gb-/.test(key) && _evictOldestSavedCopy(keyClass ? keyClass[1] : null)) {
      try {
        localStorage.setItem(key, value);
        _storageSaved(key);
        _keepText(key, value);
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
  // Batch E, E3: a regrade of a returned grade is open: the note it went out with is kept first.
  var gradeRow = getGradeReturn(cid, sid, aid);
  var heldRow = gradeRow ? GradeState.afterNote(gradeRow, getScoreReportNote(cid, sid, aid)) : null;
  if (heldRow && heldRow !== gradeRow) {
    var rows = Object.assign({}, getGradeReturns(cid));
    rows[aid] = Object.assign({}, rows[aid]);
    rows[aid][sid] = heldRow;
    _saveGradeReturns(cid, rows);
  }
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

/* The small shared helpers (cssColor, displayName, formatDate, uid, _rpcRows, _isUuid and the rest)
   are in shared/data-utilities.js, which loads just before this file. */

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

/* Classes and reporting terms (createCourse, updateCourse, deleteCourseData, getReportingTerms, setActiveCourse, switchActiveCourse, getPickerCourses) are in
   shared/data-courses-terms.js, which loads just after this file. What runs while this file loads stays here: COURSES, loadCourses, saveCourses, getActiveCourse, isCourseArchived. */

/* The BC curriculum index (CURRICULUM_INDEX, buildLearningMapFromTags) is in shared/data-curriculum-index.js. */

/* The learning map (getLearningMap, saveLearningMap, _persistLearningMapToCanonical, competency groups, sections and tags)
   is in shared/data-learning-map.js, which loads just after this file. */

/* Modules (getModules, saveModules, getModuleById) are in shared/data-student-records.js, which loads just after this file. */

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
  var seen = _studentsTodayScope;
  if (seen && seen.cid === cid) {
    _studentsTodayScope = null;
    var all;
    try {
      all = getAssignmentStatuses(cid) || {};
    } finally {
      _studentsTodayScope = seen;
    }
    var shown = {};
    Object.keys(all).forEach(function (key) {
      var aid = key.slice(key.indexOf(':') + 1);
      if (!seen.later[aid]) shown[key] = all[key];
    });
    return shown;
  }
  if (_cache.statuses[cid] !== undefined) return _cache.statuses[cid];
  try {
    return JSON.parse(localStorage.getItem('gb-statuses-' + cid)) || {};
  } catch (e) {
    console.warn('Statuses parse fallback:', e);
    return {};
  }
}
function saveAssignmentStatuses(cid, obj) {
  var kept = _keptText['gb-statuses-' + cid];
  _applyIdRekeysToStatuses(cid, obj);
  var prev = _loadPersistedCourseFieldSnapshot('statuses', cid, (_cache.statuses && _cache.statuses[cid]) || {});
  // This tab's own copy, not the saved copy another tab may have written.
  var before = _keptValue(kept, prev);
  if (before !== prev) _applyIdRekeysToStatuses(cid, before);
  var next = obj || {};
  _saveCourseField('statuses', cid, next);
  // Missing or Excused on a linked group member clears their copy of the
  // group grade; taking it off copies it back (Group grading).
  if (!_groupWriteDepth) _syncGroupStatuses(cid, before, next);
  if (!_writesEnabled() || !_isUuid(cid)) return true;
  var refusals = _writeRefusals;
  var baseline = _serverStateOr('statuses', cid, before);
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

/* Rubrics (getRubrics, saveRubrics, _persistRubricsToCanonical, getRubricChecks, moveRubricScores, setRubricPrints, competency descriptors, deleteRubric)
   are in shared/data-rubrics.js, which loads just after this file. _noteRubricsSet stays here, beside the scores it serves. */

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
/* Class settings (saveConfig, getCourseConfig, saveCourseConfig, _sendableCoursePatch, _discardWrite) are in shared/data-config-settings.js, which loads
   just after this file. getConfig stays here: saveCourses(COURSES) runs while this file loads and can reach it (getActiveCourse). */

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

/* The class list (getStudents, saveStudents, _persistStudentsToCanonical, window.reorderRoster, window.importRosterCsv)
   is in shared/data-roster.js, which loads just after this file. */
/* Assessments (getAssessments, saveAssessments, _persistAssessmentsToCanonical, window.duplicateAssessment, window.saveCollab, _cleanOrphanedScores)
   are in shared/data-assessments.js, which loads just after this file. */
/* Notes (getNotes, saveNotes) are in shared/data-student-records.js, which loads just after this file. */

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
   rubrics change, so a rubric loaded later still moves its scores, and
   when a piece of work gains, changes or loses its rubric, so marks given
   by competency move as soon as the work is given a rubric, as a reload
   moves them. */
var _rubricKeyedScores = new WeakMap();
// Counts up each time a class's rubrics are set (cache, save, load, re-key),
// so a scores object moved under one set of rubrics is looked at again under
// the next, and never otherwise.
var _rubricsRev = {};
function _noteRubricsSet(cid) {
  _rubricsRev[cid] = (_rubricsRev[cid] || 0) + 1;
}
/* What a scores object was moved under: the class's rubrics, and which work
   is scored on which rubric (as _rubricLegacyKeyIndex picks it). Read from
   the list itself, so a rubric given to work in any way (the assessment
   form, a linked copy's edit, another tab, a load) is seen. */
function _rubricKeySig(cid) {
  var sig = String(_rubricsRev[cid] || 0);
  (getAssessments(cid) || []).forEach(function (a) {
    var rubricId = a && (a.rubricId || a.rubric_id);
    if (rubricId && !isPointsScored(a)) sig += '|' + a.id + '=' + rubricId;
  });
  return sig;
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
  var sig = _rubricKeySig(cid);
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
/* The data-loss guard's rule, as saveScores applies it below: saving `next`
   over `prev` (the saved copy) drops more than half the students or more
   than 70% of the entries. */
function _scoreGuardDrop(prev, next, fillUndone) {
  var prevCount = prev ? Object.keys(prev).length : 0;
  var newCount = next ? Object.keys(next).length : 0;
  if (prevCount > 2 && newCount < prevCount * 0.5) return true;
  var prevEntries = 0,
    newEntries = 0;
  if (prev) for (var _ps in prev) prevEntries += (prev[_ps] || []).length;
  if (next) for (var _ns in next) newEntries += (next[_ns] || []).length;
  return prevEntries > 10 && newEntries + (fillUndone || 0) < prevEntries * 0.3;
}

/* The saved copy without the marks of work and students that are gone: on
   neither this tab's list nor the saved list. Delete Assessment takes them
   out of the saved copy, but that write can fail (storage full). Null while
   either list is empty or not loaded: then nothing counts as gone. */
function _scoresOfLiveRows(cid, prev) {
  function ids(field) {
    var mine = _cache[field][cid];
    var saved = _safeParseLS('gb-' + _DATA_KEYS[field] + '-' + cid, null);
    if (!Array.isArray(mine) || !mine.length || !Array.isArray(saved) || !saved.length) return null;
    var out = {};
    mine.concat(saved).forEach(function (row) {
      if (row && row.id) out[row.id] = true;
    });
    return out;
  }
  var work = ids('assessments');
  var roster = ids('students');
  if (!work || !roster) return null;
  var out = {};
  Object.keys(prev).forEach(function (sid) {
    if (!roster[sid]) return;
    out[sid] = (prev[sid] || []).filter(function (e) {
      return e && work[e.assessmentId];
    });
  });
  return out;
}

// fillUndone: how many entries restoreScoreCells took out because the fill
// it undoes added them. Only those may take the entry count past the guard.
function saveScores(cid, obj, fillUndone) {
  var kept = _keptText['gb-scores-' + cid];
  _applyIdRekeysToScores(cid, obj);
  // The baseline is read in the same key space as the scores, or a copy
  // saved with rubric scores under competencies would make every criterion
  // look new and every competency key look removed (a clear on the server).
  var prev = _migrateRubricScoreKeys(
    cid,
    _loadPersistedCourseFieldSnapshot('scores', cid, (_cache.scores && _cache.scores[cid]) || {}),
  );
  // Delete Assessment and Withdraw take their marks out of the saved copy,
  // but that write can fail (storage full). Marks of work and students that
  // are gone then do not count toward the guard, and are not sent as clears.
  var gone = _scoreGuardDrop(prev, obj, fillUndone) && _scoresOfLiveRows(cid, prev);
  if (gone && !_scoreGuardDrop(gone, obj, fillUndone)) prev = gone;
  else gone = null;
  var prevCount = prev ? Object.keys(prev).length : 0;
  var newCount = obj ? Object.keys(obj).length : 0;
  // What this tab had before this save: its own copy, in the same key space,
  // not the saved copy another tab may have written. The guard uses `prev`.
  var before = _keptValue(kept, prev);
  if (before !== prev) {
    _applyIdRekeysToScores(cid, before);
    before = _migrateRubricScoreKeys(cid, before);
  }
  // Group work: which linked members' grades this save changes (Group grading).
  var groupBefore = _groupWriteDepth ? null : _groupGradesIn(cid, before);
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
    var baseline = _migrateRubricScoreKeys(cid, _serverStateOr('scores', cid, before));
    if (gone) baseline = _scoresOfLiveRows(cid, baseline) || baseline;
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
      // Batch E, E3: the Note for the Report the returned grade went out with, while a regrade is open.
      if (typeof r.held_note_at === 'string') {
        row.held_note_at = r.held_note_at;
        if (typeof r.held_note === 'string' && r.held_note) row.held_note = r.held_note;
      }
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
                // Batch E, E3: a report prints the held note while it counts.
                GradeState.heldNote(r).held ? GradeState.heldNote(r).note : null,
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
  // Preview as Student only (withStudentsToday): work dated after the class's today is left out.
  var seen = _studentsTodayScope;
  if (seen && seen.cid === cid) {
    _studentsTodayScope = null;
    var all;
    try {
      all = getReturnedScores(cid);
    } finally {
      _studentsTodayScope = seen;
    }
    var shown = {};
    Object.keys(all).forEach(function (sid) {
      shown[sid] = (all[sid] || []).filter(function (e) {
        return !(e && seen.later[e.assessmentId]);
      });
    });
    return shown;
  }
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

/* Student cards (listStudentCards, makeStudentCards, Cards Work Until) are in shared/data-student-cards.js, which loads just after this file. */

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
/* Whether `sid` is on the class's roster. A withdrawn student is not
   (withdrawStudent takes them off getStudents and puts their marks aside),
   and no group write may touch them: their marks stay as they were until
   they are re-enrolled. */
function _onRoster(cid, sid) {
  return (getStudents(cid) || []).some(function (s) {
    return s && s.id === sid;
  });
}
/* The other members of `sid`'s group still graded with it, on the roster.
   Every group write (the fill, Back to Group Grade, the Missing or Excused
   clear and copy-back, the grade set aside) lists its members here. */
function _linkedGroupPeers(cid, a, sid) {
  var group = getCollabGroupOf(a, sid);
  if (!group) return [];
  return group.members.filter(function (m) {
    return m !== sid && !isGradedSeparately(a, m) && _onRoster(cid, m);
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
  if (!a || !isLinkedGroupMember(cid, aid, sid) || isGroupWithheld(cid, sid, aid) || !_onRoster(cid, sid)) return;
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
        if (!isGradedSeparately(a, sid) && _onRoster(cid, sid))
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

function isCourseArchived(cid) {
  return !!(cid && COURSES && COURSES[cid] && COURSES[cid].archived);
}

/* Flags, goals, goal dates, Core Competency self-assessments and reflections are in shared/data-student-records.js. */

/* Quick observations and sentence starters (getQuickObs, addQuickOb, getObservationTemplates, window.createObservationRich) are in shared/data-observations.js, which loads just after this file. */

/* ── v2 learning-map + structural helpers (Phase 4.5) ───────────────────
   Namespaced under window.v2 to avoid colliding with the existing
   blob-based local client functions (saveLearningMap, deleteRubric, etc.).
   New UI code calls v2.<name>() directly; the legacy blob saves stay (write-path
   plan, Phase 5): each save diffs against the server baseline and sends only
   the rows that changed. */
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

/* The v2 server-call wrappers (window.v2.upsertSubject through window.v2.getAssessmentDetail) are in
   shared/data-rpc-wrappers.js, which loads just after this file. */

/* Withdrawn students (withdrawStudent, reenrolStudent, getWithdrawnStudents, deleteWithdrawnStudent, _takeStudentRecords, forgetStudentServerState)
   are in shared/data-withdrawn.js, which loads just after this file. */

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

/* Custom tags, the tag resolver and the assignment feedback readers (window.createCustomTag, getCustomTags, resolveTag, getAssignmentObs) are in shared/data-observations.js. */

/* Term ratings and attendance (getTermRatings, upsertTermRating, getTermAttendance) are in shared/data-term-ratings.js, which loads just after this file. */

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

/* The term rating save helpers (_termNumber, _termRatingPatch, HABIT_KEYS), the report setup and the teacher's card, dashboard and view settings are in shared/data-term-ratings.js. */

/* Student work (getCourseSubmissions, getStudentSubmission, getStudentWork, Add Work and their server side) is in shared/data-student-work.js, which loads after this file.
   Its fv:id-rekeyed listener (_studentWorkRekeyed) and its window load listener stay here, so every listener keeps its place in the order. */

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

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('load', function () {
    setTimeout(_resumeWorkUploads, 0);
  });
}

/* Mark Up and Reflect on Feedback for a signed-in teacher (_FB_ENDPOINTS, _onFeedbackWriteEvent, refreshCourseFeedback, _returnWorkLive)
   is in shared/data-feedback-live.js, which loads after this file. */

/* Mark Up (getPageMarkup, saveMarkup, returnWork, getStudentMarkCounts, the Demo Mode feedback store _studentFeedbackDraft)
   is in shared/data-markup.js, which loads after this file. */

/* Reflect on Feedback (getCourseFeedbackOptions, setCourseFeedbackOptions, getReflectOnFeedback, answerReflection, getStudentFeedback, saveDemoReflections)
   is in shared/data-reflect.js, which loads after this file. */

/* Revisions (revisionsOn, returnForRevision, setRevisionRequest, cancelRevision, getRevisionRequest, saveDemoRevisions) are in shared/data-revisions.js,
   which loads after this file. _firstVersionScope (getReturnedScores reads it) and withStudentsToday stay here. */
var _firstVersionScope = null; // { cid, sid, aid, entries } while getRevisionFirstCell reads

/* Preview as Student shows what the student's page shows. The page lists,
   and the server sends, only work whose date has come in the class's time
   zone, or that has no date (student_submit.page: date_assigned is null or
   on or before today). So while Preview works a student's grades out
   (shared/student-view.js fromCache), a returned grade or a status on work
   dated after today is not read: getReturnedScores and getAssignmentStatuses
   leave it out for that class, and only inside `fn`. calc.js's caches are
   cleared before and after, so nothing worked out inside is kept for the
   teacher's own screens, and nothing of theirs is read inside. `fn` must
   finish at once. */
var _studentsTodayScope = null; // { cid, later: { aid: true } } while Preview as Student works grades out
function withStudentsToday(cid, fn) {
  var today = courseToday(cid);
  var later = {};
  (getAssessments(cid) || []).forEach(function (a) {
    var d = a && a.date ? String(a.date).slice(0, 10) : '';
    if (a && a.id && d && d > today) later[a.id] = true;
  });
  if (!Object.keys(later).length) return fn();
  var was = _studentsTodayScope;
  _studentsTodayScope = { cid: cid, later: later };
  if (typeof clearProfCache === 'function') clearProfCache();
  try {
    return fn();
  } finally {
    _studentsTodayScope = was;
    if (typeof clearProfCache === 'function') clearProfCache();
  }
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
  esc,
};

/* Demo Mode (loadSeedIfNeeded, applyDemoStudentPage, resetDemoData, leaveDemoMode and the rest)
   is in shared/data-demo.js, which loads just after this file. */

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

/* ══════════════════════════════════════════════════════════════════
   Handouts and Links (the assessment form's Handouts and Links; the
   student page's For This Assignment)
   ══════════════════════════════════════════════════════════════════
   A teacher adds to an assessment a handout (a PDF, turned into JPEG pages
   on this device by shared/photo-shrink.js and shared/photo-readers.js, 20
   pages at most) and links (any http:// or https:// address, with an
   optional name students see). Students see them on the assignment's card.
   The contract: start_handout_upload, finish_handout_upload,
   add_assessment_link, remove_assessment_resource and list_course_resources
   (public, each write idempotent through p_idempotency_key);
   student_submit.page's assessments[].resources and student_submit.
   handout_links through the student-submit edge function.

   Kept on this device as gb-assessment-resources-<cid>:
     { rows: [ { id, assessment_id, kind: 'pdf' | 'link', title, url,
                 page_count, status: 'uploading' | 'ready', position,
                 created_at, pages: [ path ] | null } ],
       gone: [ id ] }  removed here, the removal not yet landed
   A page still on this device has the path "photo-queue:<id>" (the photo
   queue, IndexedDB), which openAssessmentHandoutPage turns into an
   address. In Demo Mode everything stays there: the queue never sends.

   A signed-in class whose student page is on (_serverKeepsRows) goes to
   the server, the way Add Work does: the pages wait in the photo queue
   under a local resource id, start_handout_upload goes through the outbox
   (the id is re-keyed when it lands, _rekey 'resource'), each page uploads
   to the path the server named, and the queue's commit hands them in with
   finish_handout_upload under the batch's key. Offline, both wait. Any
   other signed-in class is offered none of this.

   A link or a handout added to a new assessment waits behind its
   create_assessment in the outbox (p_assessment_id is held on a local id
   like any write). Sync problems show on the sync dot only: a refused
   write through the outbox's dead letters, a page that will not send
   through the photo queue's failed count. */
var RESOURCE_MAX_PAGES = 20;
var RESOURCE_TITLE_MAX = 200;
var RESOURCE_URL_MAX = 2000;
var _RES_KEY_PREFIX = 'gb-assessment-resources-';
var _HANDOUT_UPLOADS_KEY = 'gb-handout-uploads';
var _RES_REFRESH_MS = 30000;
var _resMemo = {}; // cid → { raw, value }
var _resReadAt = {}; // cid → when list_course_resources last answered
var _resReading = {}; // cid → the read under way
var _resMissing = false; // the server has no list_course_resources yet: nothing is offered
var _RES_ENDPOINTS = {
  add_assessment_link: true,
  start_handout_upload: true,
  remove_assessment_resource: true,
};

function _resStored(cid) {
  var raw = null;
  try {
    raw = localStorage.getItem(_RES_KEY_PREFIX + cid);
  } catch (e) {
    raw = null;
  }
  var memo = _resMemo[cid];
  if (memo && memo.raw === raw) return memo.value;
  var value = null;
  try {
    value = raw ? JSON.parse(raw) : null;
  } catch (e) {
    value = null;
  }
  if (!_plainObject(value)) value = {};
  value = {
    rows: Array.isArray(value.rows) ? value.rows.filter(_plainObject) : [],
    gone: Array.isArray(value.gone)
      ? value.gone.filter(function (id) {
          return typeof id === 'string';
        })
      : [],
  };
  _resMemo[cid] = { raw: raw, value: value };
  return value;
}

function _resWrite(cid, value) {
  var raw = JSON.stringify(value);
  _safeLSSet(_RES_KEY_PREFIX + cid, raw);
  _resMemo[cid] = { raw: raw, value: value };
}

// A copy of the class's store to change.
function _resDraft(cid) {
  var s = _resStored(cid);
  return {
    rows: s.rows.map(function (r) {
      return Object.assign({}, r, { pages: Array.isArray(r.pages) ? r.pages.slice() : null });
    }),
    gone: s.gone.slice(),
  };
}

/* An address as a link keeps it: http:// or https:// only (one typed with
   no scheme gets https://), at most 2,000 characters, with a host that has
   a dot in it or is localhost. → { ok: true, url, host } or { ok: false,
   reason: 'empty' | 'not_web' | 'too_long' }. */
function assessmentLinkCheck(address) {
  var s = String(address == null ? '' : address).trim();
  if (!s) return { ok: false, reason: 'empty' };
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s) || /^[a-z0-9.-]+:\d+(\/|$)/i.test(s)) s = 'https://' + s.replace(/^\/+/, '');
  if (s.length > RESOURCE_URL_MAX) return { ok: false, reason: 'too_long' };
  var u = null;
  try {
    u = new URL(s);
  } catch (e) {
    u = null;
  }
  if (!u || (u.protocol !== 'http:' && u.protocol !== 'https:') || u.username || u.password) {
    return { ok: false, reason: 'not_web' };
  }
  var host = u.hostname.toLowerCase();
  if (!host || (host.indexOf('.') < 0 && host !== 'localhost') || /\.$/.test(host)) {
    return { ok: false, reason: 'not_web' };
  }
  var url = u.href;
  if (url.length > RESOURCE_URL_MAX) return { ok: false, reason: 'too_long' };
  return { ok: true, url: url, host: resourceHost(url) };
}

/* The site a link goes to, as a student reads it: its host without www.
   (britannica.com). '' for anything that is not an http(s) address. */
function resourceHost(url) {
  try {
    var u = new URL(String(url || ''));
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.hostname.toLowerCase().replace(/^www\./, '');
  } catch (e) {
    return '';
  }
}

/* The name a link with none is given: its address without https:// and
   www. (britannica.com/science/density), at most 200 characters. */
function _resLinkTitle(url) {
  var s = String(url || '')
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/$/, '');
  return s.length > RESOURCE_TITLE_MAX ? s.slice(0, RESOURCE_TITLE_MAX - 1) + '…' : s;
}

function _resTitle(title, fallback) {
  var t = String(title == null ? '' : title)
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) t = fallback || '';
  return t.length > RESOURCE_TITLE_MAX ? t.slice(0, RESOURCE_TITLE_MAX) : t;
}

function _resLocalId() {
  return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function _resLive(cid) {
  return !!cid && !_isDemoSession() && _serverKeepsRows(cid);
}

/* Can class `cid` have handouts and links? Demo Mode, or a signed-in class
   the server keeps student-page rows for, once the server has the calls.
   The form shows the field only where the student page is on as well. */
function assessmentResourcesOffered(cid) {
  if (!cid) return false;
  if (_isDemoSession()) return true;
  return _resLive(cid) && !_resMissing;
}

function _resRowOut(r) {
  var kind = r.kind === 'pdf' ? 'pdf' : 'link';
  var pages = Array.isArray(r.pages) ? r.pages : null;
  return {
    id: String(r.id),
    assessmentId: String(r.assessment_id),
    kind: kind,
    title: String(r.title || ''),
    url: kind === 'link' ? String(r.url || '') : null,
    host: kind === 'link' ? resourceHost(r.url) : '',
    pageCount: kind === 'pdf' ? Math.max(0, Number(r.page_count) || (pages ? pages.length : 0)) : 0,
    status: r.status === 'uploading' ? 'uploading' : 'ready',
    position: Number(r.position) || 0,
  };
}

function _resSorted(rows) {
  return rows.slice().sort(function (x, y) {
    return (
      (Number(x.position) || 0) - (Number(y.position) || 0) ||
      String(x.created_at || '').localeCompare(String(y.created_at || ''))
    );
  });
}

/* The handouts and links of assessment `aid`, in the order they were
   added: [ { id, assessmentId, kind, title, url, host, pageCount, status,
   position } ]. opts.ready: only those students can open (a handout still
   uploading is left out). */
function getAssessmentResources(cid, aid, opts) {
  if (!cid || !aid) return [];
  var ready = !!(opts && opts.ready);
  return _resSorted(
    _resStored(cid).rows.filter(function (r) {
      return r && String(r.assessment_id) === String(aid) && (!ready || r.status !== 'uploading');
    }),
  ).map(_resRowOut);
}

function _resNextPosition(rows, aid) {
  var top = 0;
  rows.forEach(function (r) {
    if (r && String(r.assessment_id) === String(aid)) top = Math.max(top, Number(r.position) || 0);
  });
  return top + 1;
}

function _resFind(cid, rid) {
  return (
    _resStored(cid).rows.filter(function (r) {
      return r && r.id === rid;
    })[0] || null
  );
}

// Screens that show handouts and links draw again.
function _resChanged(cid) {
  if (typeof document === 'undefined') return;
  if (typeof document.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
    document.dispatchEvent(new CustomEvent('fv:resources-changed', { detail: { cid: cid } }));
  }
}

// A row the server sent, as it is kept here, or null.
function _resFromServer(row) {
  if (!_plainObject(row) || !_isUuid(row.id) || !_isUuid(row.assessment_id)) return null;
  var kind = row.kind === 'pdf' ? 'pdf' : row.kind === 'link' ? 'link' : null;
  if (!kind) return null;
  var out = {
    id: String(row.id).toLowerCase(),
    assessment_id: String(row.assessment_id).toLowerCase(),
    kind: kind,
    title: String(row.title || ''),
    url: kind === 'link' ? String(row.url || '') : null,
    page_count: kind === 'pdf' ? Number(row.page_count) || 0 : null,
    status: row.status === 'uploading' ? 'uploading' : 'ready',
    position: Number(row.position) || 0,
    created_at: row.created_at || null,
    pages: null,
  };
  if (kind === 'pdf' && Array.isArray(row.paths)) {
    out.pages = row.paths.filter(function (p) {
      return typeof p === 'string';
    });
  }
  return out;
}

/* ── Adding and removing ── */

/* Add a link to assessment `aid`. `title` is the name students see; with
   none they see the address. → Promise of { ok: true, resource } or { ok:
   false, reason } (the reasons of assessmentLinkCheck, or 'not_available'). */
function addAssessmentLink(cid, aid, address, title) {
  var check = assessmentLinkCheck(address);
  if (!check.ok) return Promise.resolve(check);
  if (!assessmentResourcesOffered(cid) || !aid) return Promise.resolve({ ok: false, reason: 'not_available' });
  var draft = _resDraft(cid);
  var row = {
    id: _resLocalId(),
    assessment_id: aid,
    kind: 'link',
    title: _resTitle(title, _resLinkTitle(check.url)),
    url: check.url,
    page_count: null,
    status: 'ready',
    position: _resNextPosition(draft.rows, aid),
    created_at: new Date().toISOString(),
    pages: null,
  };
  draft.rows.push(row);
  _resWrite(cid, draft);
  if (_resLive(cid)) {
    var key = _newEntryId();
    _registerPendingCreate(cid, 'resource', row.id, 'add_assessment_link', { entryId: key });
    _rpcOrNoop(
      'add_assessment_link',
      { p_assessment_id: aid, p_url: row.url, p_title: row.title, p_idempotency_key: key },
      { entryId: key },
    );
  }
  _resChanged(cid);
  return Promise.resolve({ ok: true, resource: _resRowOut(row) });
}

/* Add a handout to assessment `aid`: `pages` are PhotoShrink.prepare's, in
   order, 1 to 20. `title` is the name students see (the file's name).
   → Promise of { ok: true, resource } or { ok: false, reason:
   'too_many_pages' | 'no_pages' | 'storage_full' | 'store_failed' |
   'no_photo_store' | 'not_available' }. */
function addAssessmentHandout(cid, aid, title, pages) {
  if (!Array.isArray(pages) || !pages.length) return Promise.resolve({ ok: false, reason: 'no_pages' });
  if (pages.length > RESOURCE_MAX_PAGES) return Promise.resolve({ ok: false, reason: 'too_many_pages' });
  if (!assessmentResourcesOffered(cid) || !aid) return Promise.resolve({ ok: false, reason: 'not_available' });
  var live = _resLive(cid);
  var q = live ? _wireWorkQueue() : window.PhotoQueue;
  if (!q || typeof q.addHandout !== 'function') return Promise.resolve({ ok: false, reason: 'no_photo_store' });
  var rid = _resLocalId();
  var name = _resTitle(title, 'Handout');
  return Promise.resolve(q.addHandout({ course: cid, assessment: aid, resource: rid }, pages))
    .then(function (res) {
      if (!res || !res.ok)
        return { ok: false, reason: res && res.reason === 'storage_full' ? 'storage_full' : 'store_failed' };
      var draft = _resDraft(cid);
      var row = {
        id: rid,
        assessment_id: aid,
        kind: 'pdf',
        title: name,
        url: null,
        page_count: pages.length,
        status: live ? 'uploading' : 'ready',
        position: _resNextPosition(draft.rows, aid),
        created_at: new Date().toISOString(),
        pages: res.ids.map(function (id) {
          return 'photo-queue:' + id;
        }),
      };
      draft.rows.push(row);
      _resWrite(cid, draft);
      if (live) _handoutStart(cid, aid, rid, name, res);
      _resChanged(cid);
      return { ok: true, resource: _resRowOut(row) };
    })
    .then(null, function () {
      return { ok: false, reason: 'store_failed' };
    });
}

function _resQueueIds(row) {
  return ((row && row.pages) || [])
    .map(function (p) {
      var m = typeof p === 'string' ? _STUDENT_WORK_QUEUE_PATH.exec(p) : null;
      return m && !m[2] ? m[1] : null;
    })
    .filter(Boolean);
}

/* Take a handout or link off its assessment. Its pages still on this
   device go too. → Promise of { ok }. */
function removeAssessmentResource(cid, rid) {
  var row = _resFind(cid, rid);
  if (!row) return Promise.resolve({ ok: false, reason: 'not_found' });
  var draft = _resDraft(cid);
  draft.rows = draft.rows.filter(function (r) {
    return r.id !== rid;
  });
  var live = _resLive(cid);
  if (live && draft.gone.indexOf(rid) < 0) draft.gone.push(rid);
  _resWrite(cid, draft);
  // An upload on its way is given up: its start, if it lands, finds nothing to send.
  var uploads = _handoutUploads();
  Object.keys(uploads).forEach(function (k) {
    if (uploads[k] && uploads[k].rid === rid) delete uploads[k];
  });
  _handoutUploadsSave(uploads);
  if (live) _rpcOrNoop('remove_assessment_resource', { p_resource_id: rid, p_idempotency_key: _newEntryId() });
  _resChanged(cid);
  return _teacherWorkForget(_resQueueIds(row)).then(function () {
    return { ok: true };
  });
}

/* ── Reading the server's ── */

/* Read class `cid`'s handouts and links again (list_course_resources), at
   most once in 30 seconds unless `force`. A signed-in class only; Demo
   Mode's are all here. Rows this device added that have not landed, and
   rows removed here whose removal has not, are kept as this device has
   them. Resolves when done; never rejects. */
function refreshAssessmentResources(cid, force) {
  if (!_resLive(cid) || _resMissing) return Promise.resolve();
  if (_resReading[cid]) return _resReading[cid];
  if (!force && _resReadAt[cid] && Date.now() - _resReadAt[cid] < _RES_REFRESH_MS) return Promise.resolve();
  var run = Promise.resolve()
    .then(function () {
      return _callRpcWithAuthGuard(
        'list_course_resources',
        { p_course_id: cid },
        { suppressSessionExpiredModal: true },
      );
    })
    .then(function (res) {
      if (!res || res.error) {
        if (res && res.error && _isMissingRpcError(res.error)) {
          _resMissing = true;
          _resChanged(cid);
        }
        return;
      }
      _resReadAt[cid] = Date.now();
      var data = res.data;
      var list = _plainObject(data) && Array.isArray(data.resources) ? data.resources : _rpcRows(data);
      _resTakeServer(cid, list.map(_resFromServer).filter(Boolean));
    })
    .then(null, function (e) {
      console.warn('list_course_resources failed:', e);
    })
    .then(function () {
      delete _resReading[cid];
    });
  _resReading[cid] = run;
  return run;
}

function _resTakeServer(cid, serverRows) {
  var before = _resStored(cid);
  var gone = before.gone.filter(function (id) {
    // Still waiting to land: kept out of what the server says.
    return _isPendingLocalId(id) || _resRemovalQueued(id);
  });
  var uploads = _handoutUploads();
  var mine = {}; // rows with an upload on this device keep their pages here
  Object.keys(uploads).forEach(function (k) {
    if (uploads[k] && uploads[k].cid === cid) mine[uploads[k].rid] = true;
  });
  var byId = {};
  before.rows.forEach(function (r) {
    byId[r.id] = r;
  });
  var onServer = {};
  var rows = serverRows
    .filter(function (r) {
      onServer[r.id] = true;
      return gone.indexOf(r.id) < 0;
    })
    .map(function (r) {
      var had = byId[r.id];
      if (had && mine[r.id]) return Object.assign({}, r, { pages: had.pages, status: had.status });
      if (had && !r.pages && had.pages && had.status === 'ready') return Object.assign({}, r, { pages: had.pages });
      return r;
    });
  before.rows.forEach(function (r) {
    // Not on the server yet: added here, waiting in the outbox.
    if (!onServer[r.id] && (!_isUuid(r.id) || mine[r.id])) rows.push(r);
  });
  var next = { rows: rows, gone: gone };
  if (JSON.stringify(next) === JSON.stringify(before)) return;
  _resWrite(cid, next);
  _resChanged(cid);
}

function _resRemovalQueued(rid) {
  var q = window.v2Queue;
  if (!q || typeof q.queued !== 'function') return false;
  try {
    return q.queued('remove_assessment_resource').some(function (e) {
      return e && e.payload && e.payload.p_resource_id === rid;
    });
  } catch (e) {
    return false;
  }
}

/* ── A handout's upload (signed in) ── */

function _handoutUploads() {
  var all = _safeParseLS(_HANDOUT_UPLOADS_KEY, null);
  return _plainObject(all) ? all : {};
}
function _handoutUploadsSave(all) {
  if (!Object.keys(all).length) {
    try {
      localStorage.removeItem(_HANDOUT_UPLOADS_KEY);
    } catch (e) {
      /* nothing kept */
    }
    return;
  }
  _safeLSSet(_HANDOUT_UPLOADS_KEY, JSON.stringify(all));
}

// start_handout_upload through the outbox, keyed so a retry is the same start.
function _handoutStart(cid, aid, rid, title, queued) {
  var key = _newEntryId();
  var all = _handoutUploads();
  all[key] = {
    key: key,
    cid: cid,
    aid: aid,
    rid: rid,
    local: rid,
    title: title,
    n: queued.ids.length,
    ids: queued.ids,
    batch: queued.batch,
  };
  _handoutUploadsSave(all);
  _registerPendingCreate(cid, 'resource', rid, 'start_handout_upload', { entryId: key });
  _rpcOrNoop(
    'start_handout_upload',
    { p_assessment_id: aid, p_title: title, p_page_count: queued.ids.length, p_idempotency_key: key },
    { entryId: key },
  ).then(function (res) {
    if (res && !res.error && res.data != null) _handoutStarted(key, res.data);
  });
}

/* start_handout_upload answered (from the call, or from the outbox's own
   event after a reload): { id, paths }. Each waiting page takes the
   server's resource id and the path named for it, in page order, and
   goes up. A path that is not this class's and this handout's, or a count
   that does not match, gives the upload up. Runs once per start. */
function _handoutStarted(key, data) {
  var rec = _handoutUploads()[key];
  if (!rec || rec.placed) return Promise.resolve(null);
  var res = _rpcObject(data) || {};
  var id = _isUuid(res.id) ? String(res.id).toLowerCase() : null;
  var paths = Array.isArray(res.paths) ? res.paths.map(String) : [];
  var q = _wireWorkQueue();
  if (!id || !q || typeof q.placeHandout !== 'function' || paths.length !== rec.ids.length) {
    return _handoutGiveUp(rec, true);
  }
  // In page order: by the number in each path's name.
  var numbered = paths.slice().sort(function (x, y) {
    return Number((/\/(\d+)\.jpg$/.exec(x) || [])[1]) - Number((/\/(\d+)\.jpg$/.exec(y) || [])[1]);
  });
  return Promise.resolve(q.ready && q.ready())
    .then(function () {
      // By the local id the pages were queued under: the class's own re-key may already have run.
      var local = rec.local || rec.rid;
      return local !== id ? q.rekey(local, id) : { ok: true };
    })
    .then(function (out) {
      if (!out || !out.ok) return { ok: false };
      var map = {};
      rec.ids.forEach(function (qid, i) {
        map[qid] = numbered[i];
      });
      return q.placeHandout(map);
    })
    .then(function (placed) {
      if (!placed || !placed.ok) return _handoutGiveUp(rec, true);
      var now = _handoutUploads();
      if (now[key]) {
        now[key].placed = true;
        now[key].rid = id;
        _handoutUploadsSave(now);
      }
      q.send();
      return null;
    })
    .then(null, function (e) {
      console.warn('A handout upload could not start:', e);
      return null;
    });
}

/* The upload is given up: its pages leave the device and the handout is
   taken off the assessment here. `refused`: the server said no after the
   form had closed, so the sync dot says photos were dropped. */
function _handoutGiveUp(rec, refused) {
  var all = _handoutUploads();
  delete all[rec.key];
  _handoutUploadsSave(all);
  var draft = _resDraft(rec.cid);
  draft.rows = draft.rows.filter(function (r) {
    return r.id !== rec.rid;
  });
  _resWrite(rec.cid, draft);
  if (refused) _workNoteDropped();
  _resChanged(rec.cid);
  return _teacherWorkForget(rec.ids || []).then(function () {
    return null;
  });
}

function _handoutUploadByBatch(batch) {
  var all = _handoutUploads();
  var keys = Object.keys(all);
  for (var i = 0; i < keys.length; i++) if (all[keys[i]] && all[keys[i]].batch === batch) return all[keys[i]];
  return null;
}

/* The photo queue's commit for a handout: every page is in storage;
   finish_handout_upload marks it ready under the batch's key. Answers {
   error } as the queue reads it: none once it is ready (or the handout is
   gone, so its pages are let go), a passing one while the server still
   misses a page (each is sent again), a lasting one for anything else. */
async function _handoutCommit(batch) {
  var rid = batch && batch.ids && batch.ids.resource;
  if (!_isUuid(rid)) return { error: { message: 'no resource id', status: 422 } };
  var rec = _handoutUploadByBatch(batch.key);
  var res = await _callRpcWithAuthGuard(
    'finish_handout_upload',
    { p_resource_id: rid, p_idempotency_key: batch.key },
    { suppressSessionExpiredModal: true },
  );
  if (!res || res.error) return { error: (res && res.error) || { message: 'no answer', status: 503 } };
  var row = _rpcObject(res.data) || {};
  var cid = (rec && rec.cid) || batch.ids.course;
  if (row.status === 'ready') {
    var draft = _resDraft(cid);
    draft.rows.forEach(function (r) {
      if (r.id !== rid) return;
      r.status = 'ready';
      r.pages = (batch.files || [])
        .slice()
        .sort(function (x, y) {
          return (x.order || 0) - (y.order || 0);
        })
        .map(function (f) {
          return f.path;
        });
    });
    _resWrite(cid, draft);
    if (rec) {
      var all = _handoutUploads();
      delete all[rec.key];
      _handoutUploadsSave(all);
    }
    _resChanged(cid);
    _resReadAfterWrite({ p_course_id: cid });
    return { error: null };
  }
  /* A page the server refused (row.bad) cannot be sent again: no teacher
     may replace a file in storage. The handout is removed here and on the
     server, and the sync dot says pages were dropped (independent review,
     Nov 11). */
  if (row.status === 'uploading' && Array.isArray(row.bad) && row.bad.length) {
    if (cid) removeAssessmentResource(cid, rid);
    if (rec) await _handoutGiveUp(rec, true);
    return { error: null };
  }
  if (row.status === 'uploading') {
    // Still missing a page (row.missing names them by number): those go again.
    var q = window.PhotoQueue;
    var missing = Array.isArray(row.missing) ? row.missing.map(Number) : null;
    var pages = q && typeof q.pages === 'function' ? q.pages() : [];
    await Promise.all(
      pages
        .filter(function (p) {
          return p.batch === batch.key && (!missing || missing.indexOf((p.order || 0) + 1) >= 0 || !missing.length);
        })
        .map(function (p) {
          return Promise.resolve(q.retry(p.id, { again: true })).then(null, function () {});
        }),
    );
    return { error: { message: 'missing_pages', status: 503 } };
  }
  /* Gone: removed, its assessment deleted, or its two hours to upload ran
     out. Nothing to hand in; its pages are let go, and when the teacher did
     not remove it the sync dot says the pages were dropped. */
  if (row.status === 'gone' || row.error === 'not_found' || row.result === 'not_found') {
    if (rec) await _handoutGiveUp(rec, true);
    return { error: null };
  }
  return { error: { message: String(row.error || row.result || 'refused'), status: 409 } };
}

/* The outbox's word on a handouts-and-links write (_onOutboxEvent). */
function _onResourceWriteEvent(kind, endpoint, payload, data) {
  // Adding or removing one does not move the class's sync version: the class is read again after each write lands.
  if (kind === 'flush:success') _resReadAfterWrite(payload);
  try {
    var key = payload && payload.p_idempotency_key;
    if (endpoint === 'start_handout_upload' && key) {
      if (kind === 'flush:success') _handoutStarted(key, data);
      else {
        var rec = _handoutUploads()[key];
        if (rec) _handoutGiveUp(rec, true);
      }
      return;
    }
    if (endpoint === 'add_assessment_link' && kind === 'flush:success') {
      var row = _resFromServer(_rpcObject(data));
      var cid = row ? _classOfAssessment(row.assessment_id) : null;
      if (!row || !cid) return;
      var draft = _resDraft(cid);
      var changed = false;
      draft.rows = draft.rows.map(function (r) {
        if (r.id !== row.id) return r;
        changed = true;
        return Object.assign({}, r, { title: row.title, url: row.url, position: row.position, status: 'ready' });
      });
      if (changed) _resWrite(cid, draft);
      return;
    }
    if (endpoint === 'add_assessment_link' && kind === 'flush:dead-letter' && key) {
      // Refused: the link this device added (still under its local id) goes.
      _pendingCreatesByEntry(key).forEach(function (p) {
        if (p.kind !== 'resource') return;
        var d = _resDraft(p.cid);
        d.rows = d.rows.filter(function (r) {
          return r.id !== p.localId;
        });
        _resWrite(p.cid, d);
        _resChanged(p.cid);
      });
    }
    if (endpoint === 'remove_assessment_resource' && payload && payload.p_resource_id) {
      var rid = payload.p_resource_id;
      Object.keys(_resMemo).forEach(function (c) {
        if (_resStored(c).gone.indexOf(rid) < 0) return;
        var d = _resDraft(c);
        d.gone = d.gone.filter(function (x) {
          return x !== rid;
        });
        _resWrite(c, d);
      });
    }
    if (kind === 'flush:dead-letter') {
      // A refused add or removal: the class is read again, so the screens show what the server has.
      Object.keys(_resReadAt).forEach(function (c) {
        refreshAssessmentResources(c, true);
      });
    }
  } catch (e) {
    console.warn('Handouts and links: following up a write failed:', e);
  }
}

/* After one of this device's writes landed: the class it was in is read
   again (list_course_resources), a tick later so the write's own follow-up
   is in first. A removal names no class: each class read before is. */
function _resReadAfterWrite(payload) {
  var cid =
    (payload && payload.p_course_id) ||
    (payload && payload.p_assessment_id ? _classOfAssessment(payload.p_assessment_id) : null);
  var cids = cid ? [cid] : Object.keys(_resReadAt);
  setTimeout(function () {
    cids.forEach(function (c) {
      refreshAssessmentResources(c, true);
    });
  }, 0);
}

/* A resource's local id became the server's (_rekey 'resource'): the row,
   the removal list, the upload on its way and its waiting pages take it. */
function _rekeyResource(cid, localId, serverId) {
  var s = _resStored(cid);
  var hit =
    s.gone.indexOf(localId) >= 0 ||
    s.rows.some(function (r) {
      return r.id === localId;
    });
  if (hit) {
    var d = _resDraft(cid);
    d.rows.forEach(function (r) {
      if (r.id === localId) r.id = serverId;
    });
    d.gone = d.gone.map(function (x) {
      return x === localId ? serverId : x;
    });
    _resWrite(cid, d);
  }
  var all = _handoutUploads();
  var moved = false;
  Object.keys(all).forEach(function (k) {
    if (all[k] && all[k].rid === localId) {
      all[k].rid = serverId;
      moved = true;
    }
  });
  if (moved) _handoutUploadsSave(all);
  var q = window.PhotoQueue;
  if (q && typeof q.rekey === 'function') Promise.resolve(q.rekey(localId, serverId)).then(null, function () {});
}

// A new assessment's id became the server's: its handouts and links follow it.
function _resAssessmentRekeyed(e) {
  var d = e && e.detail;
  if (!d || d.kind !== 'assessment' || !d.cid || !_isUuid(d.to)) return;
  var hit = _resStored(d.cid).rows.some(function (r) {
    return r.assessment_id === d.from;
  });
  if (hit) {
    var draft = _resDraft(d.cid);
    draft.rows.forEach(function (r) {
      if (r.assessment_id === d.from) r.assessment_id = d.to;
    });
    _resWrite(d.cid, draft);
  }
  var all = _handoutUploads();
  var moved = false;
  Object.keys(all).forEach(function (k) {
    if (all[k] && all[k].aid === d.from) {
      all[k].aid = d.to;
      moved = true;
    }
  });
  if (moved) _handoutUploadsSave(all);
}
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('fv:id-rekeyed', _resAssessmentRekeyed);
}

/* A signed-in page opening: handout pages left waiting by an earlier visit go. */
function _resumeHandoutUploads() {
  if (_isDemoSession() || !_writesEnabled() || !Object.keys(_handoutUploads()).length) return;
  var q = _wireWorkQueue();
  if (q && typeof q.send === 'function') q.send();
}
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('load', function () {
    setTimeout(_resumeHandoutUploads, 0);
  });
}

/* ── Showing a handout's page ── */

var _HANDOUT_STORAGE_PATH =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/handouts\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/([1-9]|1[0-9]|20)\.jpg$/;

/* Page `i` (from 0) of handout `rid` in class `cid`: { url, release } or
   null. A page still on this device comes from the photo queue; one on
   the server through a link signed for 300 seconds, fetched, and shown
   from a blob: address. Only a path in this class's own handouts folder,
   under this handout. */
function openAssessmentHandoutPage(cid, rid, i) {
  var row = _resFind(cid, rid);
  var n = Number(i);
  if (!row || row.kind !== 'pdf' || !(n >= 0) || Math.floor(n) !== n) return Promise.resolve(null);
  var name = row.pages && row.pages[n];
  // The contract's layout, <course>/handouts/<resource>/<n>.jpg, when the server sent no paths.
  if (!name && _isUuid(rid) && n < (Number(row.page_count) || 0)) {
    name = String(cid).toLowerCase() + '/handouts/' + String(rid).toLowerCase() + '/' + (n + 1) + '.jpg';
  }
  if (!name) return Promise.resolve(null);
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return Promise.resolve(null);
  var m = _STUDENT_WORK_QUEUE_PATH.exec(name);
  if (m) {
    var q = window.PhotoQueue;
    if (m[2] || !q || typeof q.blobs !== 'function') return Promise.resolve(null);
    return Promise.resolve()
      .then(function () {
        return q.blobs(m[1]);
      })
      .then(
        function (found) {
          return found && found.photo ? _resPicture(found.photo) : null;
        },
        function () {
          return null;
        },
      );
  }
  var prefix = String(cid).toLowerCase() + '/handouts/' + String(rid).toLowerCase() + '/';
  if (_isDemoSession() || !_HANDOUT_STORAGE_PATH.test(name) || name.indexOf(prefix) !== 0) return Promise.resolve(null);
  var sb = getSupabase();
  if (!sb || !sb.storage || typeof fetch !== 'function') return Promise.resolve(null);
  return Promise.resolve()
    .then(function () {
      return sb.storage.from('student-photos').createSignedUrl(name, STUDENT_WORK_LINK_SECONDS);
    })
    .then(function (res) {
      var link = res && !res.error && res.data && res.data.signedUrl;
      if (!link) return null;
      return fetch(link, { credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' }).then(function (r) {
        return r && r.ok ? r.blob() : null;
      });
    })
    .then(function (blob) {
      return blob ? _resPicture(blob) : null;
    })
    .then(null, function () {
      return null;
    });
}

// A picture shown from a blob: address, with the way to let it go.
function _resPicture(blob) {
  // Always a picture: what is handed back is shown in an <img> and nothing else.
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
}
