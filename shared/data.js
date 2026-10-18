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
 * @property {'strength'|'growth'|'concern'} [sentiment]
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
  flags: {}, // keyed by cid
  goals: {}, // keyed by cid
  reflections: {}, // keyed by cid
  overrides: {}, // keyed by cid
  statuses: {}, // keyed by cid
  observations: {}, // keyed by cid
  termRatings: {}, // keyed by cid
  customTags: {}, // keyed by cid
  notes: {}, // keyed by cid
  reportConfig: {}, // keyed by cid
  studentProfileSummaries: {}, // keyed by cid
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
  flags: 'flags',
  goals: 'goals',
  reflections: 'reflections',
  overrides: 'overrides',
  statuses: 'statuses',
  observations: 'quick-obs',
  termRatings: 'term-ratings',
  customTags: 'custom-tags',
  notes: 'notes',
  reportConfig: 'report-config',
  studentProfileSummaries: 'student-profile-summaries',
};

let _useSupabase = false;
let _teacherId = null;
let _initPromise = null; // dedup concurrent initData calls
let _lsQuotaWarned = false; // show the "storage full" toast at most once per session

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

function _updateSyncIndicator() {
  const dot = document.getElementById('sync-indicator-dot');
  if (!dot) return;
  const s = getSyncStatus();
  // Degraded mode reuses the 'error' visual but conveys a different message.
  var visual = s.status === 'degraded' ? 'error' : s.status;
  dot.className = 'tb-sync-dot ' + visual;
  dot.title =
    s.status === 'idle'
      ? 'All changes saved'
      : s.status === 'syncing'
        ? 'Syncing...'
        : s.status === 'degraded'
          ? 'Cloud sync paused — saving locally'
          : 'Sync error — changes saved locally';
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
  _updateSyncIndicator();
  if (typeof showSyncToast === 'function') {
    showSyncToast('Saving locally — cloud sync paused.', 'degraded');
  }
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

/* Manual retry — wired to the "Retry now" button in the degraded toast.
   Cancels the pending timer and probes immediately. */
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
    _cache.courses = _canonicalCoursesToBlob(bootstrapData.courseRows || []);
    _cache.config = {
      activeCourse: prefs.active_course_id || null,
      viewMode: prefs.view_mode || null,
      mobileViewMode: prefs.mobile_view_mode || null,
      mobileSortMode: prefs.mobile_sort_mode || null,
      cardWidgetConfig: prefs.card_widget_config || null,
      displayName: teacher.display_name || null,
      email: teacher.email || null,
      accountDeletedAt: teacher.deleted_at || null,
    };
    COURSES = _cache.courses;
    _safeLSSet('gb-courses', JSON.stringify(_cache.courses));
    _safeLSSet('gb-config', JSON.stringify(_cache.config));
  }
  var outbox = _outbox();
  if (outbox) outbox.flush();
  _updateSyncIndicator();
  if (typeof dismissSyncToast === 'function') dismissSyncToast();
  if (typeof showSyncToast === 'function') {
    showSyncToast('Cloud sync restored. Catching up…', 'success');
  }
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
  ['goals', 'reflections', 'observations', 'flags', 'overrides', 'termRatings', 'reportConfig'].forEach(
    function (field) {
      if (userEdits[field] !== undefined && _cache[field]) {
        _cache[field][canonicalId] = userEdits[field];
        var dataKey = _DATA_KEYS[field];
        if (dataKey) _safeLSSet('gb-' + dataKey + '-' + canonicalId, JSON.stringify(userEdits[field]));
      }
    },
  );
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
  return ['students', 'categories', 'assessments', 'scores'].indexOf(field) >= 0;
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
  set_score_status: true,
  save_score_comment: true,
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
  // A student delete held for an undo toast on a page that has since closed:
  // that toast is gone, so the delete goes.
  releaseHeldStudentDeletes();

  // Demo mode: hard-skip Supabase, force local-only, ensure seed data exists.
  // Set by the "Try Demo Mode" button on the login page. Gated on the
  // companion token set by login-auth.js so a lone gb-demo-mode='1' written
  // in DevTools after sign-out cannot reactivate demo mode (see
  // isDemoMode() in shared/supabase.js).
  var _demoMode = typeof isDemoMode === 'function' && isDemoMode();
  if (_demoMode) {
    _useSupabase = false;
    _teacherId = 'demo-user';
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
  //     mobile_view_mode, mobile_sort_mode, card_widget_config } }
  //     Creates teacher + teacher_preference on first sign-in;
  //     returns existing rows on subsequent sign-ins.
  //   list_teacher_courses() → [{ id, name, grade_level, description, color,
  //     is_archived, display_order, grading_system, calc_method, decay_weight,
  //     timezone, late_work_policy, created_at, updated_at }, ...]
  // On any failure fall back to localStorage so the app still loads offline.
  if (_useSupabase) {
    const sb = getSupabase();
    try {
      const data = await _bootstrapWithRetry(sb);
      const teacher = data.teacher || {};
      const prefs = teacher.preferences || {};
      _teacherId = teacher.id || _teacherId;

      _cache.courses = _canonicalCoursesToBlob(data.courseRows || []);
      _cache.config = {
        activeCourse: prefs.active_course_id || null,
        viewMode: prefs.view_mode || null,
        mobileViewMode: prefs.mobile_view_mode || null,
        mobileSortMode: prefs.mobile_sort_mode || null,
        cardWidgetConfig: prefs.card_widget_config || null,
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
    // A student delete waiting out its undo toast goes when the page does.
    window.addEventListener('pagehide', function () {
      releaseHeldStudentDeletes();
    });
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
async function initData(cid) {
  if (!cid) return;
  // Avoid duplicate concurrent loads for same course
  if (_initPromise && _initPromise._cid === cid) return _initPromise;

  // Saved copy first: show the copy this device has, then ask the server
  // whether it changed. Not while a refresh is running: that is the check.
  var refreshing = !!(_refreshState[cid] && _refreshState[cid].snapshot);
  if (!refreshing && _useSupabase && _cacheFirstEnabled() && _classBundleEnabled() && _isUuid(cid)) {
    var inMemory = _cache.students[cid] !== undefined && _classVersion[cid] != null;
    if (inMemory || _savedCopyUsable(cid)) {
      if (!inMemory) _loadSavedCopy(cid);
      _saveClassMeta(cid, { lastOpenedAt: Date.now() });
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
}

function _persistLoadedField(cid, field, value) {
  if (_refreshMustSkip(cid, field)) return;
  _cache[field][cid] = value;
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
  scores: true,
  statuses: true,
  rubrics: true,
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
    case 'withdraw_enrollment':
      return { field: 'students', match: 'id', id: params.p_id };
    case 'update_student':
      return { field: 'students', match: 'personId', id: params.p_id };
    case 'upsert_score':
    case 'upsert_tag_score':
    case 'upsert_rubric_score':
    case 'save_score_comment':
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
var _refusalToastAt = 0;

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
  if (Date.now() - _refusalToastAt > 5000 && typeof showSyncToast === 'function') {
    _refusalToastAt = Date.now();
    showSyncToast('Local storage full \u2014 your changes may not save offline', 'error');
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
  p_module_id: 'module',
  p_category_id: 'category',
};
var _P_ID_KINDS = {
  update_assessment: 'assessment',
  delete_assessment: 'assessment',
  save_collab: 'assessment',
  save_assessment_tags: 'assessment',
  update_enrollment: 'student',
  withdraw_enrollment: 'student',
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
    var dataKey = _DATA_KEYS[field];
    // A re-key from another tab: it wrote the shared copy already.
    if (dataKey && !_applyingRemoteRekey) _safeLSSet('gb-' + dataKey + '-' + cid, JSON.stringify(value));
    if (!_applyingRemoteRekey) {
      _markLocalWrite(field, cid);
      _broadcastChange(cid, field);
    }
  }
  if (_hasServerState(field, cid)) transform(_serverState[field][cid]);
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
}

function _rekeyAssessmentRefs(cid, localId, serverId) {
  _rekeyField('scores', cid, function (scores) {
    return _rekeyScoreEntries(scores, 'assessmentId', localId, serverId);
  });
  _rekeyField('statuses', cid, function (statuses) {
    return _rekeyStatusKeys(statuses, localId, serverId);
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
      _rekeyField('rubrics', cid, function (rubrics) {
        var changed = false;
        (rubrics || []).forEach(function (r) {
          ((r && r.criteria) || []).forEach(function (c) {
            if (c && Array.isArray(c.tagIds) && c.tagIds.indexOf(localId) >= 0) {
              c.tagIds = c.tagIds.map(function (id) {
                return id === localId ? serverId : id;
              });
              changed = true;
            }
          });
        });
        return changed;
      });
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
  }
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
    if (rec.kind === 'criterion') return; // resolved once its rubric is known
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
    if (rec.kind !== 'criterion') return;
    var serverRubricId = rubricIds[rec.parent] || _resolveKnownId('rubric', rec.parent);
    if (!_isUuid(serverRubricId)) {
      _unregisterPendingCreate(rec);
      return;
    }
    rec._serverRubricId = serverRubricId;
  });
  var criteria = recs.filter(function (rec) {
    return rec.kind === 'criterion' && rec._serverRubricId;
  });
  return criteria.length ? _resolveRubricCriteria(criteria) : undefined;
}

/* upsert_rubric answers with the rubric id only; the criteria ids come from
   the rubric tables. Pair the local criteria with the server's by position
   (display order), the order the upsert sent them in. */
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
        var crit = (rubric.criteria || [])[rec.index];
        _unregisterPendingCreate(rec);
        if (crit && _isUuid(crit.id)) _rekey(cid, 'criterion', rec.localId, crit.id);
        else {
          var q = window.v2Queue;
          if (q && typeof q.dropBlockedOn === 'function') {
            q.dropBlockedOn(rec.localId, { deadLetter: true, error: 'rubric criterion was not created' });
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
  } else if (evt.kind === 'flush:dead-letter') {
    _revertBaselineRow(_baselineUndo[meta.id], meta.endpoint, meta.payload);
    delete _baselineUndo[meta.id];
    _onCreateAbandoned(meta.id, true, meta.error);
  } else if (evt.kind === 'remove') {
    delete _baselineUndo[meta.id];
    _onCreateAbandoned(meta.id, false);
  }
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
      if (!crit || !crit.id || _isUuid(crit.id)) return;
      if (_resolveKnownId('criterion', crit.id) !== crit.id) return;
      var critRec = _registerPendingCreate(cid, 'criterion', crit.id, 'upsert_rubric', {
        entryId: entryId,
        parent: rubric.id,
        index: idx,
      });
      if (!entryId && critRec) entryId = critRec.entryId;
    });
  });
}

function _getAssessmentCategoryId(assessment) {
  return (assessment && (assessment.categoryId || assessment.category_id)) || null;
}

function getAssessmentCategoryId(assessment) {
  return _getAssessmentCategoryId(assessment);
}

function getAssessmentCategoryName(cid, assessment) {
  var categoryId = _getAssessmentCategoryId(assessment);
  if (!categoryId) return 'No Category';
  var category = getCategoryById(cid, categoryId);
  return category && category.name ? category.name : 'Unknown Category';
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
        date: _dateOnly(ob.date || ob.observed_at || ob.created || ob.created_at),
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
  if (a.evidence_type !== undefined) next.evidenceType = a.evidence_type || '';
  if (a.collab_mode !== undefined) next.collaboration = _localCollabModeFromCanonical(a.collab_mode || 'individual');
  if (a.collab_config !== undefined && a.collab_config) {
    if (a.collab_config.pairs) next.pairs = a.collab_config.pairs;
    if (a.collab_config.groups) next.groups = a.collab_config.groups;
    if (a.collab_config.excludedStudents) next.excludedStudents = a.collab_config.excludedStudents;
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
    // A criterion comment the server no longer has is gone here too.
    if (!entry.critNote) delete existing.critNote;
    Object.assign(existing, entry);
  } else scores[sid].push(entry);
}

function _scoreEntryFromCanonical(cid, assessment, tagId, value, comment, modifier, criterionComment) {
  var entry = {
    // Deterministic, so loading the same server data twice writes the same
    // localStorage string: a changing value here made every load look like an
    // edit to other tabs, which then reloaded too.
    id: [assessment.id, tagId || 'overall'].join(':'),
    assessmentId: assessment.id,
    tagId: tagId || '',
    score: value == null || value === '' ? 0 : Number(value),
    date: assessment.date || assessment.assigned_at || courseToday(cid),
    type: assessment.type || 'summative',
    note: comment || '',
    created: assessment.date || assessment.assigned_at || '',
  };
  var mod = normalizeScoreMod(entry.score, modifier);
  if (mod) entry.mod = mod;
  // The teacher's note on a rubric criterion, printed on the rubric handout.
  // It is set on every score key the criterion fans out to.
  if (criterionComment) entry.critNote = String(criterionComment);
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

function _rubricCriterionForTag(cid, assessment, tagId) {
  var rubric = _rubricForAssessment(cid, assessment);
  if (!rubric || !tagId) return null;
  var matches = (rubric.criteria || []).filter(function (criterion) {
    return criterion && (criterion.tagIds || []).indexOf(tagId) >= 0;
  });
  return matches.length === 1 ? matches[0] : null;
}

function _rubricCriterionTagIds(cid, assessment, criterionId) {
  var criterion = _rubricCriterionById(cid, assessment, criterionId);
  return criterion ? rubricCriterionScoreKeys(criterion) : [criterionId];
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
    return { id: key, label: name, text: name + ': counts toward the overall grade only' };
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
            _scoreEntryFromCanonical(cid, merged, tagId, tagScore.value, comment, tagScore.modifier),
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
              ),
            );
          });
        });
        if (cell.score && cell.score.value != null && (tagScores.length === 0 || isPointsScored(merged))) {
          var fallbackTag = scoreTagIds(merged)[0];
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
  (payload.observations || []).forEach(function (ob) {
    var enrollmentIds = ob.enrollment_ids || ob.enrollmentIds || [];
    enrollmentIds.forEach(function (sid) {
      if (!sid) return;
      if (!blob[sid]) blob[sid] = [];
      var entry = {
        id: ob.id,
        text: ob.body || ob.text || '',
        dims: _observationDims(ob.dims),
        sentiment: ob.sentiment || null,
        context: ob.context_type || ob.context || null,
        created: ob.created_at || ob.created || new Date().toISOString(),
        date: _dateOnly(ob.observed_at || ob.created_at || ob.created),
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
      if (cell.score && cell.score.status) statuses[sid + ':' + aid] = cell.score.status;
      (cell.tag_scores || cell.tagScores || []).forEach(function (tagScore) {
        var tagId = tagScore && (tagScore.tag_id || tagScore.tagId);
        if (!tagId) return;
        _pushHydratedScore(
          scores,
          sid,
          _scoreEntryFromCanonical(cid, assessment, tagId, tagScore.value, comment, tagScore.modifier),
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
            ),
          );
        });
      });
      var hasAssessmentEntry =
        scores[sid] &&
        scores[sid].some(function (entry) {
          return entry.assessmentId === aid;
        });
      if (cell.score && cell.score.value != null && !hasAssessmentEntry) {
        _pushHydratedScore(
          scores,
          sid,
          _scoreEntryFromCanonical(cid, assessment, scoreTagIds(assessment)[0], cell.score.value, comment),
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
      has_rubric: !!a.has_rubric,
      due_date: _dateOnly(a.due_date),
      assigned_at: _dateOnly(a.date_assigned),
      display_order: Number(a.display_order || 0),
    };
    var collabMode = a.collab_mode || a.collabMode;
    var collabConfig = a.collab_config || a.collabConfig || {};
    if (collabMode) assessment.collaboration = _localCollabModeFromCanonical(collabMode);
    if (collabConfig.pairs) assessment.pairs = collabConfig.pairs;
    if (collabConfig.groups) assessment.groups = collabConfig.groups;
    if (collabConfig.excludedStudents) assessment.excludedStudents = collabConfig.excludedStudents;
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
          delete _loadError[cid];
          _classFresh[cid] = true;
          return;
        }
        try {
          _bundleToCache(cid, bundle);
          delete _loadError[cid];
        } catch (e) {
          // A payload this code can't read must not leave the class half
          // applied with no word to the teacher.
          console.error('get_class_bundle could not be applied for ' + cid + ':', e);
          if (window.Sentry && typeof window.Sentry.captureException === 'function') window.Sentry.captureException(e);
          _courseLoadFailed(cid, e);
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
    delete _loadError[cid];
    _v2GradebookToCache(cid, gbRes.data || {});
    await _hydrateCanonicalDetails(cid);
    await loadStudentProfileSummaries(cid);
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
    if (cell) cell.score = { value: r[2], status: r[3], comment: r[4] };
  });
  sorted(gb.tag_rows).forEach(function (r) {
    var cell = cellFor(r[0], r[1]);
    if (cell && tags[r[2]]) cell.tag_scores.push({ tag_id: tags[r[2]], value: r[3], modifier: r[4] });
  });
  sorted(gb.criterion_rows).forEach(function (r) {
    var cell = cellFor(r[0], r[1]);
    if (cell && criteria[r[2]])
      cell.rubric_scores.push({ criterion_id: criteria[r[2]], value: r[3], modifier: r[4], comment: r[5] || null });
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

function _bundleToCache(cid, bundle) {
  var gb = bundle.gradebook || {};

  // Rubrics first: rubric scores are mapped to competencies through them.
  var rb = bundle.rubrics || {};
  _persistLoadedField(cid, 'rubrics', _canonicalRubricRowsToCache(rb.rubrics, rb.criteria, rb.criterion_tags));

  var map = _canonicalLearningMapToCache(cid, bundle.learning_map || {});
  var emptyMap = !(map.subjects && map.subjects.length) && !(map.sections && map.sections.length);
  if (emptyMap) map = (typeof LEARNING_MAP !== 'undefined' && LEARNING_MAP[cid]) || map;
  _persistLoadedField(cid, 'learningMaps', map);

  _v2GradebookToCache(cid, Object.assign({}, gb, { cells: _bundleCells(gb) }));
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
  _fillOverrideCalculated(cid);
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
  _applyBundleCourseConfig(cid, bundle.course_config, bundle.gradebook && bundle.gradebook.course);

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
    });
  }
}

/* ── Saved copy first (docs/class-loading-plan.md, Phase 4) ───────────────
   A class this device has saved opens from that copy at once; a request
   carrying its version then asks whether anything changed, and only a
   changed class is downloaded. gb-bundle-meta-<cid> records the copy's
   version, owner and age. FV_CACHE_FIRST (constants.js) or
   window.__FV_CACHE_FIRST = false turns this off. */
var _BUNDLE_SCHEMA = 3;
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
  if (!meta || meta.schema !== _BUNDLE_SCHEMA || !meta.owner || meta.owner !== _teacherId) return false;
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
  if (meta.dirty) return;
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
   saved copy stays on screen. */
function _startClassCheck(cid) {
  _classFresh[cid] = false;
  var offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  if (!offline) setPageLock('checking', true);
  var body = typeof document !== 'undefined' ? document.body : null;
  var noteTimer = setTimeout(function () {
    if (!released && !offline && body && body.classList) body.classList.add('fv-checking-slow');
  }, 400);
  var released = false;
  function release() {
    clearTimeout(noteTimer);
    if (body && body.classList) body.classList.remove('fv-checking-slow');
    if (released || offline) return;
    released = true;
    setPageLock('checking', false);
  }
  var timer = setTimeout(release, 3000);
  return _handleExternalCourseUpdate(cid, 'gradebook').finally(function () {
    clearTimeout(timer);
    release();
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
        o.calculated = Math.round(getSectionProficiencyRaw(cid, sid, sectionId) * 10) / 10;
        changed = true;
      } catch (e) {
        console.warn('Could not work out the calculated level for an override:', e);
      }
    });
  });
  if (changed) _persistLoadedField(cid, 'overrides', overrides);
}

/* Term ratings from the server, merged into this device's copy. The server's
   fields win; "dims" isn't stored on the server, so this device keeps its
   own. A rating this device has and the server doesn't was written while
   saves never reached the server (term ids read as NaN until Oct 2026): it
   is sent now, once. */
function _applyBundleTermRatings(cid, rows) {
  var local = _cloneValue(getTermRatings(cid) || {}) || {};
  var onServer = {};
  rows.forEach(function (r) {
    if (!r || !r.enrollment_id || !r.term) return;
    var termId = 'term-' + r.term;
    onServer[r.enrollment_id + '|' + termId] = true;
    if (!local[r.enrollment_id]) local[r.enrollment_id] = {};
    var prev = local[r.enrollment_id][termId] || { dims: Object.fromEntries(OBS_DIMS.map(d => [d, 0])) };
    local[r.enrollment_id][termId] = Object.assign({}, prev, {
      narrative: r.narrative_html || '',
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
        return Array.isArray(v) ? v.length > 0 : !!v;
      });
      if (t >= 1 && t <= 6 && hasContent) window.v2.saveTermRating(sid, t, payload);
    });
  });
}

/* The grading scale and category weights saved on the server replace this
   device's. One only this device has was saved before the server stored
   them, so it is sent up rather than dropped: a reset elsewhere saves the
   default scale, never null, so a null on the server always means "never
   saved". */
var _COURSE_CONFIG_COLUMNS = {
  gradingScale: 'grading_scale',
  categoryWeights: 'category_weights',
  reportingTerms: 'reporting_terms',
};
function _applyBundleCourseConfig(cid, row, courseRow) {
  if (!row || typeof row !== 'object') return;
  var config = Object.assign({}, getCourseConfig(cid) || {});
  var missing = {};
  Object.keys(_COURSE_CONFIG_COLUMNS).forEach(function (field) {
    var column = _COURSE_CONFIG_COLUMNS[field];
    var onServer = row[column];
    if (onServer && typeof onServer === 'object') config[field] = _cloneValue(onServer);
    else if (config[field] != null) missing[column] = config[field];
  });
  // "Round to a whole %" comes on the course row. Null there means the class
  // never chose, so it follows its grade level.
  if (courseRow && typeof courseRow === 'object' && 'round_percent' in courseRow) {
    if (typeof courseRow.round_percent === 'boolean') config.roundPercent = courseRow.round_percent;
    else if (typeof config.roundPercent === 'boolean') missing.round_percent = config.roundPercent;
  }
  _persistLoadedField(cid, 'courseConfigs', config);

  if (!Object.keys(missing).length || !_writesEnabled() || !_isUuid(cid)) return;
  _trackPendingSync(
    _writeRpc('update_course', { p_course_id: cid, p_patch: missing }).then(function (res) {
      if (res.error) console.warn('update_course (course config upload) failed:', res.error);
    }),
  );
}

/* A class load failed. Nothing is written: the copy this device already has
   (memory, else localStorage) stays on screen, with a message and a retry.
   This used to write an empty class over localStorage and the server
   baseline, so one failed request blanked the class and the next save
   diffed against "the server has nothing". */
var _loadError = {}; // cid → { at, message }
function _courseLoadFailed(cid, error) {
  var message = (error && (error.message || error.details)) || String(error || 'unknown error');
  // A class deleted on another device is removed when the class list loads,
  // not here: an unauthenticated call also reads as "not found".
  console.warn('get_gradebook failed for ' + cid + '; keeping the saved copy:', error);
  _loadError[cid] = { at: Date.now(), message: message };
  if (_cache.students[cid] === undefined) _loadCourseFromLS(cid);
  // The message must never be what breaks a load.
  try {
    if (typeof showSyncToast === 'function') {
      showSyncToast("Couldn't load the latest data for this class. " + _savedCopyDescription(cid), 'load-failed');
    }
  } catch (e) {
    console.warn('Could not show the load-failed message:', e);
  }
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
  _cache.reportConfig[cid] = _safeParseLS('gb-report-config-' + cid, null);
  _cache.studentProfileSummaries[cid] = _safeParseLS('gb-student-profile-summaries-' + cid, {});
  _cache.rubrics[cid] = _safeParseLS('gb-rubrics-' + cid, []);

  // Learning map: check localStorage first, then fall back to LEARNING_MAP constant
  const lmRaw = _safeParseLS('gb-learningmap-' + cid, null);
  if (lmRaw && lmRaw._customized) {
    _cache.learningMaps[cid] = lmRaw;
  } else {
    _cache.learningMaps[cid] = LEARNING_MAP[cid] || { subjects: [], sections: [] };
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
    return true;
  } catch (e) {
    var keyClass = /^gb-/.test(key) && key.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
    if (e.name === 'QuotaExceededError' && /^gb-/.test(key) && _evictOldestSavedCopy(keyClass ? keyClass[1] : null)) {
      try {
        localStorage.setItem(key, value);
        return true;
      } catch (retryError) {
        e = retryError;
      }
    }
    console.warn('localStorage write failed (' + key + '):', e);
    if (e.name === 'QuotaExceededError') {
      // P7.1: surface every quota event, not just the first \u2014 teacher needs to
      // know each subsequent write also failed to persist locally.
      _lsQuotaWarned = true;
      if (typeof showSyncToast === 'function') {
        showSyncToast('Local storage full \u2014 your changes may not save offline', 'error');
      }
    }
    return false;
  }
}

function _loadCoursesFromLS() {
  try {
    const stored = JSON.parse(localStorage.getItem('gb-courses'));
    if (stored && Object.keys(stored).length > 0) return stored;
  } catch (e) {
    console.warn('Courses parse error:', e);
  }
  return structuredClone(DEFAULT_COURSES);
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
  if (_PROF_FIELDS.includes(field) && typeof clearProfCache === 'function') clearProfCache();
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
   are populated here; legacy get_course_policy() is retired in v2. */
function _canonicalCoursesToBlob(rows) {
  var out = {};
  (rows || []).forEach(function (r) {
    if (!r || !r.id) return;
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
    };
  });
  return out;
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
/* The assessment last scored in each class this session, with the day, so
   the observation capture strip can pre-fill it (teacher/obs-capture.js). */
var _lastScored = {};
function getLastScoredAssessment(cid) {
  var rec = _lastScored[cid];
  return rec && rec.day === courseToday(cid) ? rec.aid : null;
}

function upsertScore(cid, sid, aid, tid, scoreVal, date, type, note, mod) {
  var nextMod = normalizeScoreMod(scoreVal, mod);
  if (aid) _lastScored[cid] = { aid: aid, day: courseToday(cid) };
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
    if (note !== undefined) existing.note = note;
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
  var lsOk = _safeLSSet('gb-scores-' + cid, JSON.stringify(scores));
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

/* v2 per-cell / per-tag / per-criterion score write. Rubric grading UI writes
   linked competency tag ids, while rubric_score requires criterion ids. Keep
   tag writes authoritative for UI hydration and mirror to rubric_score only
   when the tag has exactly one criterion owner.

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
    var criterionForTag = criterion ? null : _rubricCriterionForTag(cid, assessment, tid);
    var assessmentTagIds = (assessment && (assessment.tagIds || assessment.tag_ids)) || [];
    var isAssessmentTag = assessmentTagIds.indexOf(tid) >= 0;
    var isPoints = isPointsScored(assessment);
    var ops = [];
    var modifier = normalizeScoreMod(intVal, mod);
    // A criterion comment typed before the level was chosen waits in the
    // cache; it goes up with the level. Null leaves the server's comment.
    var criterionComment = _rubricCriterionCommentFor(cid, sid, aid, tid) || null;
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
        },
      });
    } else if (isPoints || isUnlinkedTag(tid) || (assessment && !isAssessmentTag && !criterionForTag)) {
      // An unlinked assessment's single score. On proficiency work 0 clears
      // it; on points and Complete/Incomplete work 0 is a score.
      var cellValue = isUnlinkedTag(tid) && intVal === 0 && !isPointsScored(assessment) ? null : intVal;
      ops.push({
        rpc: 'upsert_score',
        params: { p_enrollment_id: sid, p_assessment_id: aid, p_value: cellValue },
      });
    } else {
      // The server rejects tag_score on rubric assessments; the rubric_score
      // mirror below carries the value.
      var isRubric = !!(assessment && (assessment.rubricId || assessment.rubric_id));
      if (!isRubric) {
        ops.push({
          rpc: 'upsert_tag_score',
          params: { p_enrollment_id: sid, p_assessment_id: aid, p_tag_id: tid, p_value: intVal, p_modifier: modifier },
        });
      }
      if (criterionForTag && _isSendableId(criterionForTag.id)) {
        ops.push({
          rpc: 'upsert_rubric_score',
          params: {
            p_enrollment_id: sid,
            p_assessment_id: aid,
            p_criterion_id: criterionForTag.id,
            p_value: intVal,
            p_modifier: modifier,
            p_comment: criterionComment,
          },
        });
      }
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

/* ── Rubric criterion comments ─────────────────────────────────────────
   A short note on one criterion of a rubric assessment, printed under that
   row on the rubric handout (teacher/rubric-print.js). It lives on
   rubric_score.comment and, in the cache, as `critNote` on each score key
   the criterion fans out to. */

/* The cached comment for the criterion holding score key `tid`. */
function _rubricCriterionCommentFor(cid, sid, aid, tid) {
  var entries = getScores(cid)[sid] || [];
  var entry = entries.find(function (e) {
    return e && e.assessmentId === aid && e.tagId === tid;
  });
  return entry && entry.critNote ? entry.critNote : '';
}

/* The criterion's comment, from whichever of its keys holds one. */
function getRubricCriterionComment(cid, sid, aid, criterion) {
  var keys = rubricCriterionScoreKeys(criterion);
  for (var i = 0; i < keys.length; i++) {
    var note = _rubricCriterionCommentFor(cid, sid, aid, keys[i]);
    if (note) return note;
  }
  return '';
}

/* Save (or clear, with '') the comment on one criterion. The cache changes
   at once; the server row is updated when the criterion has a level, and
   otherwise the comment goes up with the level when one is chosen (a
   rubric_score row cannot exist without a value). */
function saveRubricCriterionComment(cid, sid, aid, criterionId, text) {
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
        type: (assessment && assessment.type) || 'summative',
        note: '',
        created: new Date().toISOString(),
      };
      scores[sid].push(entry);
    }
    if ((entry.critNote || '') !== note) changed = true;
    if (note) entry.critNote = note;
    else delete entry.critNote;
    if (Number(entry.score) > 0 && !level) {
      level = Number(entry.score);
      mod = normalizeScoreMod(level, entry.mod);
    }
  });
  if (!changed) return true;
  _cache.scores[cid] = scores;
  var lsOk = _safeLSSet('gb-scores-' + cid, JSON.stringify(scores));
  _markLocalWrite('scores', cid);
  if (_writesEnabled() && level > 0 && _isSendableId(sid) && _isSendableId(aid) && _isSendableId(criterionId)) {
    _trackPendingSync(
      _writeRpc('upsert_rubric_score', {
        p_enrollment_id: sid,
        p_assessment_id: aid,
        p_criterion_id: criterionId,
        p_value: level,
        p_modifier: mod,
        p_comment: note,
      }).then(function (res) {
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
    (a.critNote || '') !== (b.critNote || '')
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

/* Clear a single cell — removes Score, RubricScore, and TagScore rows for
   the (enrollment, assessment) tuple.  Final value/status are captured as a
   deletion audit row before the delete cascades. */
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
function esc(s) {
  return (s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function escJs(s) {
  return (s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"');
}

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
  const f = (st.firstName || '').trim(),
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
function displayName(st) {
  return st.preferred || fullName(st);
}
function displayNameFirst(st) {
  return st.preferred || st.firstName || st.lastName || '';
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
    calcMethod: data.calcMethod || 'mostRecent',
    decayWeight: data.decayWeight || 0.65,
    description: data.description || '',
    gradeLevel: data.gradeLevel || '',
    timezone: data.timezone || 'America/Vancouver',
    lateWorkPolicy: data.lateWorkPolicy || null,
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
      if (Object.keys(patch).length > 0 && _isUuid(id)) {
        _trackPendingSync(
          _writeRpc('update_course', { p_course_id: id, p_patch: patch }).then(function (res) {
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
    'statuses',
    'quick-obs',
    'term-ratings',
    'notes',
    'flags',
    'goals',
    'reflections',
    'custom-tags',
    'report-config',
    'categories',
    'student-profile-summaries',
    'bundle-meta',
  ].forEach(k => localStorage.removeItem('gb-' + k + '-' + id));
  _forgetServerState(id);
  delete _classVersion[id];

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

/** Save the class's terms. Ordinals are assigned 1..n by start date.
 * Returns the error text if the list is invalid; nothing is saved then. */
function saveReportingTerms(cid, terms) {
  var clean = (terms || []).map(function (t) {
    return {
      ordinal: Number(t.ordinal),
      label: String(t.label || '').trim(),
      starts_on: String(t.starts_on || ''),
      ends_on: String(t.ends_on || ''),
    };
  });
  clean.sort(function (a, b) {
    return a.starts_on < b.starts_on ? -1 : a.starts_on > b.starts_on ? 1 : 0;
  });
  clean.forEach(function (t, i) {
    t.ordinal = i + 1;
  });
  var err = reportingTermsError(clean);
  if (err) return err;
  var cc = Object.assign({}, getCourseConfig(cid) || {});
  cc.reportingTerms = clean;
  saveCourseConfig(cid, cc);
  // A chosen term that no longer exists falls back to all time.
  var chosen = getSelectedTermOrdinal(cid);
  if (chosen != null && chosen > clean.length) setSelectedTermOrdinal(cid, null);
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

/* The term the teacher chose to view a class in, per device. Null is all
   time, the default. gb- keys are wiped at sign-out. */
function getSelectedTermOrdinal(cid) {
  try {
    var raw = localStorage.getItem('gb-term-' + cid);
    if (raw == null || raw === '') return null;
    var n = Number(raw);
    if (!Number.isInteger(n)) return null;
    return getReportingTerms(cid).some(function (t) {
      return t.ordinal === n;
    })
      ? n
      : null;
  } catch (e) {
    return null;
  }
}
function setSelectedTermOrdinal(cid, ordinal) {
  try {
    if (ordinal == null || ordinal === '' || ordinal === 'all') localStorage.removeItem('gb-term-' + cid);
    else localStorage.setItem('gb-term-' + cid, String(Number(ordinal)));
  } catch (e) {
    // localStorage unavailable: the choice lasts for this page only.
  }
  if (typeof setActiveTerm === 'function') setActiveTerm(cid, ordinal);
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

function buildLearningMapFromTags(shortTags) {
  if (!CURRICULUM_INDEX) return { subjects: [], sections: [], _customized: true, _version: 1, _flatVersion: 2 };
  const subjects = [];
  const sections = [];
  const seenCategoryNames = {};
  const isHybrid = shortTags.length > 1;

  for (const courseTag of shortTags) {
    const course = CURRICULUM_INDEX[courseTag];
    if (!course || !course.categories || course.categories.length === 0) continue;

    const colour = SUBJECT_COLOURS[course.subject] || '#6366f1';
    let addedSections = false;
    const usedTagIds = {};

    for (const category of course.categories) {
      if (!category.competencies || category.competencies.length === 0) continue;

      let sectionName = category.name;
      if (isHybrid) {
        if (seenCategoryNames[category.name]) {
          sectionName = courseTag + ': ' + category.name;
          const firstSection = sections.find(s => s.name === category.name);
          if (firstSection) firstSection.name = seenCategoryNames[category.name] + ': ' + category.name;
        }
        seenCategoryNames[category.name] = courseTag;
      }

      const shortName = category.name
        .replace(/\s*\(.*?\)\s*/g, '')
        .split(/\s+and\s+/i)[0]
        .trim();
      const truncShortName = shortName.length > 20 ? shortName.slice(0, 18) + '\u2026' : shortName;

      // Flat format: one section per competency (1:1 section-to-tag)
      for (const comp of category.competencies) {
        let baseId = isHybrid ? courseTag + '_' + comp.tag : comp.tag;
        if (usedTagIds[baseId]) {
          usedTagIds[baseId]++;
          baseId = baseId + usedTagIds[baseId];
        } else {
          usedTagIds[baseId] = 1;
        }
        const tag = {
          id: baseId,
          label: comp.short_label,
          text: comp.raw,
          i_can_statements: comp.i_can_statements || [],
          color: colour,
          subject: courseTag,
          name: sectionName,
          shortName: truncShortName,
        };
        sections.push({
          id: baseId,
          subject: courseTag,
          name: sectionName,
          shortName: truncShortName,
          color: colour,
          tags: [tag],
        });
        addedSections = true;
      }
    }
    if (addedSections) {
      subjects.push({ id: courseTag, name: course.course_name, color: colour });
    }
  }

  return { subjects, sections, _customized: true, _version: 1, _flatVersion: 2 };
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
  if (!map) map = structuredClone(LEARNING_MAP[cid] || { subjects: [], sections: [] });
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
  _saveCourseField('learningMaps', cid, map); // derived tag/section caches auto-invalidate via mapRef check
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
  _cache.learningMaps[cid] = LEARNING_MAP[cid] || { subjects: [], sections: [] }; // ref change auto-busts tag/section caches
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

function _patchObjectKeys(obj, idMap) {
  if (!obj || !idMap) return false;
  var changed = false;
  Object.keys(idMap).forEach(function (oldId) {
    var newId = idMap[oldId];
    if (!newId || obj[oldId] === undefined) return;
    if (obj[newId] === undefined) obj[newId] = obj[oldId];
    delete obj[oldId];
    changed = true;
  });
  return changed;
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
        var gone = _cancelPendingCreateOrResolve(cid, pair[0], id);
        if (gone && pair[3]) opsToDelete.push(pair[3](gone));
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
    Number(a.displayOrder ?? a.display_order ?? idx) !== Number(b.displayOrder ?? b.display_order ?? idx)
  );
}

/* Categories go up as one list (save_categories): weights must total 100,
   which a row-at-a-time save can't keep while weights change. */
function _persistCategoriesToCanonical(cid, prev, arr) {
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
    return window.v2.saveCategories(cid, arr, { entryId: entryId || undefined }).then(function (res) {
      // Rejected or refused: the server still has the old list, so the
      // next save sends the whole list again.
      if (res && res.error && !res.error.cancelled) _rememberServerState('categories', cid, before);
      if (res && res.error) throw res.error;
      // Re-keys the rows and the assessments that point at them (already
      // done when the outbox reported success).
      if (entryId) _onCreateLanded(entryId, res && res.data);
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
  if (!_writesEnabled() || !_isUuid(cid)) return true;
  var refusals = _writeRefusals;
  _persistStatusDiffToCanonical(_serverStateOr('statuses', cid, prev), next);
  _rememberServerState('statuses', cid, next);
  // A refused write's cell goes back in the baseline (_onWriteRefused).
  return _writeRefusals === refusals;
}
function getAssignmentStatus(cid, sid, aid) {
  return getAssignmentStatuses(cid)[sid + ':' + aid] || null;
}
function setAssignmentStatus(cid, sid, aid, status) {
  const st = getAssignmentStatuses(cid);
  const key = sid + ':' + aid;
  if (status) st[key] = status;
  else delete st[key];
  // saveAssignmentStatuses' diff sends the one set_score_status for this cell.
  return saveAssignmentStatuses(cid, st);
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
    return payload;
  });
}
async function _loadCanonicalRubrics(cid) {
  var sb = getSupabase();
  if (!sb || !_isUuid(cid) || typeof sb.from !== 'function') return [];

  var rubricsQuery = sb.from('rubric').select('id,name,created_at');
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
  if (criterionIds.length > 0) {
    var tagsQuery = sb.from('criterion_tag').select('criterion_id,tag_id');
    if (typeof tagsQuery.in === 'function') tagsQuery = tagsQuery.in('criterion_id', criterionIds);
    var tagsRes = await tagsQuery;
    if (tagsRes.error) throw tagsRes.error;
    criterionTagRows = tagsRes.data || [];
  }

  return _canonicalRubricRowsToCache(rubricRows, criterionRows, criterionTagRows);
}

/* rubric, criterion and criterion_tag rows → the client's rubric list. Used
   by the table reads above and by get_class_bundle. */
function _canonicalRubricRowsToCache(rubricRows, criterionRows, criterionTagRows) {
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
    });
  });

  return rubricRows.map(function (row) {
    var rubric = {
      id: row.id,
      name: row.name || '',
      title: row.name || '',
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
  return JSON.stringify([_rubricName(rubric), _rubricCriteriaPayload(rubric), (rubric && rubric.copyGroup) || null]);
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
            return !(c && _isUuid(c.id));
          })
        ) {
          insertedRows = true;
        }
        // The rubric's own record, or a new criterion's inside an existing
        // rubric: either names the entry this upsert is.
        var rec = _isUuid(rubric.id) ? null : _pendingCreateFor('rubric', rubric.id);
        if (!rec) {
          (rubric.criteria || []).some(function (c) {
            rec = c && !_isUuid(c.id) ? _pendingCreateFor('criterion', c.id) : null;
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
                criteria: _rubricCriteriaPayload(rubric),
                copyGroup: rubric.copyGroup || null,
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
function saveCourseConfig(cid, obj) {
  _saveCourseField('courseConfigs', cid, obj);
  if (_writesEnabled() && _isUuid(cid)) {
    // v2: policy fields live on the course row. save_course_policy is gone;
    // remap the legacy courseConfig blob onto a update_course jsonb patch.
    const sb = getSupabase();
    if (sb && obj) {
      const patch = {};
      if (obj.gradingSystem != null) patch.grading_system = obj.gradingSystem;
      if (obj.calcMethod != null) patch.calc_method = obj.calcMethod;
      if (obj.decayWeight != null) patch.decay_weight = obj.decayWeight;
      if (obj.timezone != null) patch.timezone = obj.timezone;
      if (obj.lateWorkPolicy != null) patch.late_work_policy = obj.lateWorkPolicy;
      if (obj.gradingScale != null) patch.grading_scale = obj.gradingScale;
      if (obj.categoryWeights != null) patch.category_weights = obj.categoryWeights;
      if (typeof obj.roundPercent === 'boolean') patch.round_percent = obj.roundPercent;
      if (Array.isArray(obj.reportingTerms)) patch.reporting_terms = obj.reportingTerms;
      if (Object.keys(patch).length > 0) {
        _trackPendingSync(
          _writeRpc('update_course', { p_course_id: cid, p_patch: patch }).then(function (res) {
            if (res.error) console.warn('update_course (saveCourseConfig) failed:', res.error);
          }),
        );
      }
    }
  }
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
   - prev student missing from arr → withdraw_enrollment */
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
        // Undo of a delete still held in the outbox: the server never lost
        // the enrollment.
        if (cancelHeldStudentDelete(s.id)) return;
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

/* v2 withdraw_enrollment(p_id) — sets withdrawn_at = now(). */
function _canonicalWithdrawEnrollment(sb, enrollmentId) {
  return _writeRpc('withdraw_enrollment', { p_id: enrollmentId }).then(function (res) {
    if (res.error) console.warn('withdraw_enrollment failed:', res.error, enrollmentId);
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
function saveCategories(cid, arr) {
  var prev = _loadPersistedCourseFieldSnapshot('categories', cid, (_cache.categories && _cache.categories[cid]) || []);
  var next = arr || [];
  _saveCourseField('categories', cid, next);
  if (!_writesEnabled() || !_isUuid(cid)) return;
  _persistCategoriesToCanonical(cid, prev, next);
}
/* The class manager writes categories itself (save_categories,
   reorder_categories) and hands the resulting rows here.
   Cache, localStorage and the server baseline take them without sending
   anything a second time. */
function adoptCategoriesFromServer(cid, rows) {
  _persistLoadedField(cid, 'categories', rows || []);
  if (typeof clearProfCache === 'function') clearProfCache();
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
    (a.maxPoints || 0) !== (b.maxPoints || 0) ||
    (a.weight || 1) !== (b.weight || 1) ||
    (a.evidenceType || '') !== (b.evidenceType || '') ||
    (a.notes || '') !== (b.notes || '') ||
    (a.rubricId || '') !== (b.rubricId || '') ||
    (a.moduleId || '') !== (b.moduleId || '') ||
    (a.copyGroup || '') !== (b.copyGroup || '') ||
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
  };
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
function getScores(cid) {
  if (_cache.scores[cid] !== undefined) return _cache.scores[cid];
  try {
    return JSON.parse(localStorage.getItem('gb-scores-' + cid)) || {};
  } catch (e) {
    console.warn('Scores parse fallback:', e);
    return {};
  }
}
function saveScores(cid, obj) {
  _applyIdRekeysToScores(cid, obj);
  var prev = _loadPersistedCourseFieldSnapshot('scores', cid, (_cache.scores && _cache.scores[cid]) || {});
  var prevCount = prev ? Object.keys(prev).length : 0;
  var newCount = obj ? Object.keys(obj).length : 0;
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
  if (prevEntries > 10 && newEntries < prevEntries * 0.3) {
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
  var lsOk = _saveCourseField('scores', cid, obj);
  if (_writesEnabled()) {
    var refusals = _writeRefusals;
    persistScoreDiffToCanonical(cid, _serverStateOr('scores', cid, prev), obj || {});
    _rememberServerState('scores', cid, obj || {});
    // A refused write's cell goes back in the baseline (_onWriteRefused).
    if (_writeRefusals !== refusals) return false;
  }
  return lsOk;
}

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
function setCompletionMark(cid, sid, aid, mark) {
  if (mark === 'complete') return setPointsScore(cid, sid, aid, COMPLETE_MAX_POINTS);
  if (mark === 'incomplete') return setPointsScore(cid, sid, aid, 0);
  const scores = getScores(cid);
  const before = (scores[sid] || []).length;
  scores[sid] = (scores[sid] || []).filter(e => e.assessmentId !== aid);
  if (scores[sid].length !== before) saveScores(cid, scores);
  return scores;
}
// rawScore null clears the cell; 0 is a score of 0.
function setPointsScore(cid, sid, aid, rawScore) {
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
        type: assess.type || 'summative',
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
function getPickerCourses(activeCid) {
  return Object.keys(COURSES || {})
    .filter(function (cid) {
      return !isCourseArchived(cid) || cid === activeCid;
    })
    .map(function (cid) {
      return { id: cid, name: COURSES[cid].name || '' };
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
function addQuickOb(cid, sid, text, dims, sentiment, context, assignmentContext, link) {
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
  all[sid].push(entry);
  _cache.observations[cid] = all;
  var lsOk = _safeLSSet('gb-quick-obs-' + cid, JSON.stringify(all));
  _markLocalWrite('observations', cid);
  if (_writesEnabled()) {
    _persistObservationCreate(cid, sid, entry);
  }
  _broadcastChange(cid, 'observations');
  return lsOk;
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
  if (updates.context !== undefined) ob.context = updates.context || null;
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
   p_level smallint) → uuid */
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
  _trackPendingSync(
    _writeRpc(
      'create_observation',
      {
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
      },
      {
        retryKey: 'create_observation:' + entry.id,
        entryId: rec ? rec.entryId : undefined,
      },
    ).then(function (res) {
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

/* Observation templates — seeds (is_seed=true) are immutable; these helpers
   only touch teacher-owned custom templates (Q4). */
window.upsertObservationTemplate = function (cid, payload) {
  var sb = getSupabase();
  if (!sb) return Promise.resolve();
  if (!_isUuid(cid)) return Promise.resolve();
  payload = payload || {};
  return _writeRpc(
    'upsert_observation_template',
    _stampIdempotencyKey('upsert_observation_template', {
      p_id: _isUuid(payload.id) ? payload.id : null,
      p_course_id: cid,
      p_body: payload.body || '',
      p_default_sentiment: payload.defaultSentiment || null,
      p_default_context_type: payload.defaultContextType || null,
      p_display_order: payload.displayOrder != null ? Number(payload.displayOrder) : null,
    }),
  ).then(function (res) {
    if (res.error) console.warn('upsert_observation_template failed:', res.error);
    return res;
  });
};

window.deleteObservationTemplate = function (tplId) {
  var sb = getSupabase();
  if (!sb) return Promise.resolve();
  if (!_isUuid(tplId)) return Promise.resolve();
  return _writeRpc('delete_observation_template', { p_id: tplId }).then(function (res) {
    if (res.error) console.warn('delete_observation_template failed:', res.error);
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
    if (options.holdForUndo) blockedOn.push(_HELD_FOR_UNDO);
    var pushed = outbox.push(name, params, { id: entryId, blockedOn: blockedOn, sendOptions: options });
    if (pushed && pushed.refused) {
      _onWriteRefused(name, params, undo, pushed.refused, options.entryId);
      return pushed;
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
  return _rpcOrNoop(
    'save_categories',
    {
      p_course_id: courseId,
      p_categories: (rows || []).map(function (r) {
        var row = { name: (r.name || '').trim(), weight: r.weight != null ? Number(r.weight) : 0 };
        if (_isUuid(r.id)) row.id = r.id;
        return row;
      }),
    },
    options,
  );
};

/* Rubric — composite save: rubric row + criteria diff + criterion_tag replace,
   all in one transaction.  criteria payload:
     [{ id?: uuid, name, level_{1..4}_descriptor, level_{1..4}_value?,
        weight?, display_order?, linked_tag_ids?: uuid[] }, …]
   Criteria present in the array are upserted; criteria absent are deleted
   (cascades criterion_tag + rubric_score). */
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

window.v2.getClassDashboard = function (courseId) {
  return _rpcOrNoop('get_class_dashboard', { p_course_id: courseId });
};

window.v2.getTermRating = function (enrollmentId, term) {
  return _rpcOrNoop('get_term_rating', {
    p_enrollment_id: enrollmentId,
    p_term: Number(term),
  });
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

window.v2.getReport = function (enrollmentId, term) {
  var params = { p_enrollment_id: enrollmentId };
  if (term != null) params.p_term = Number(term);
  return _rpcOrNoop('get_report', params);
};

/* ── v2 write RPCs from Phase 5.5 ─────────────────────────────────────── */

/* §4.5 — full cascade delete of a student (all their enrollments + scores +
   notes + goals + reflections + overrides + attendance + term ratings).
   Courses survive untouched. */
window.v2.deleteStudent = function (studentId) {
  // A student whose enrol is still queued (the roster passes the enrollment
  // id then) is simply not created.
  if (!_isUuid(studentId) && _pendingCreateFor('student', studentId)) {
    var rec = _pendingCreateFor('student', studentId);
    _cancelPendingCreateOrResolve(rec.cid, 'student', studentId);
    return Promise.resolve({ data: null, error: null });
  }
  return _rpcOrNoop('delete_student', { p_id: studentId });
};

/* Deleting a student waits out the undo toast (audit finding 4).
   delete_student is a hard delete, so it is queued held: stored in the
   outbox, which keeps it across a reload, but not sent. Closing the toast,
   leaving the page, signing out or the next page load releases it; Undo
   takes it back out. Without the outbox it is sent at once. */
var _HELD_FOR_UNDO = 'undo-window';
var _heldStudentDeletes = {}; // enrollment id → outbox entry id, this page only

function holdStudentDelete(enrollmentId, studentId) {
  if (!_outbox() || !_isUuid(studentId)) return window.v2.deleteStudent(studentId);
  var entryId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : uid();
  _heldStudentDeletes[enrollmentId] = entryId;
  return _writeRpc('delete_student', { p_id: studentId }, { entryId: entryId, holdForUndo: true }).then(function (res) {
    if (_heldStudentDeletes[enrollmentId] === entryId) delete _heldStudentDeletes[enrollmentId];
    return res;
  });
}

function isStudentDeleteHeld(enrollmentId) {
  return !!_heldStudentDeletes[enrollmentId];
}

/* Undo: true when the delete had not gone yet, so the server still has the
   student and everything they had. */
function cancelHeldStudentDelete(enrollmentId) {
  var entryId = _heldStudentDeletes[enrollmentId];
  var q = window.v2Queue;
  if (!entryId || !q || typeof q.remove !== 'function') return false;
  delete _heldStudentDeletes[enrollmentId];
  return q.remove(entryId);
}

/* Sends one student's held delete (their toast closed), or every held
   delete when no enrollment id is given (the page is going away). */
function releaseHeldStudentDeletes(enrollmentId) {
  var entryId = enrollmentId ? _heldStudentDeletes[enrollmentId] : null;
  if (enrollmentId && !entryId) return;
  if (enrollmentId) delete _heldStudentDeletes[enrollmentId];
  else _heldStudentDeletes = {};
  var q = window.v2Queue;
  if (!q || typeof q.rewrite !== 'function') return;
  q.rewrite(function (entry) {
    var held = Array.isArray(entry.blocked_on) ? entry.blocked_on : [];
    if (held.indexOf(_HELD_FOR_UNDO) < 0 || (entryId && entry.id !== entryId)) return null;
    return {
      payload: entry.payload,
      blockedOn: held.filter(function (id) {
        return id !== _HELD_FOR_UNDO;
      }),
    };
  });
}

/* deleteStudent takes the student out of the server baselines as well as
   the local copy: delete_student removes them on the server, so a later
   roster or score save must not withdraw the enrollment or clear their
   scores itself. */
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

/* Undo for deleteStudent (teacher/ui.js). When the held delete is taken
   back, the server still has the student and everything they had, so the
   local copy and the baselines are put back and nothing is sent. Returns
   false when the delete had already gone. */
function restoreDeletedStudent(cid, snapshot) {
  var sid = snapshot && snapshot.student && snapshot.student.id;
  if (!sid || !cancelHeldStudentDelete(sid)) return false;
  var students = getStudents(cid).filter(function (s) {
    return s.id !== sid;
  });
  var at = snapshot.index >= 0 && snapshot.index <= students.length ? snapshot.index : students.length;
  students.splice(at, 0, snapshot.student);
  _saveCourseField('students', cid, students);
  [
    ['scores', getScores, snapshot.scores],
    ['goals', getGoals, snapshot.goals],
    ['reflections', getReflections, snapshot.reflections],
    ['notes', getNotes, snapshot.notes],
    ['flags', getFlags, snapshot.flagged ? true : undefined],
    ['observations', getQuickObs, snapshot.quickObs],
    ['termRatings', getTermRatings, snapshot.termRatings],
  ].forEach(function (f) {
    if (f[2] === undefined) return;
    var all = f[1](cid);
    all[sid] = f[2];
    _saveCourseField(f[0], cid, all);
  });
  var statuses = getAssignmentStatuses(cid);
  Object.assign(statuses, snapshot.statuses || {});
  _saveCourseField('statuses', cid, statuses);

  var baseStudents = _serverStateOr('students', cid, null);
  if (Array.isArray(baseStudents) && !baseStudents.some(s => s && s.id === sid)) {
    baseStudents.splice(Math.min(at, baseStudents.length), 0, _cloneValue(snapshot.student));
  }
  var baseScores = _serverStateOr('scores', cid, null);
  if (baseScores && snapshot.scores && snapshot.scores.length) baseScores[sid] = _cloneValue(snapshot.scores);
  var baseNotes = _serverStateOr('notes', cid, null);
  if (baseNotes && snapshot.notes !== undefined) baseNotes[sid] = _cloneValue(snapshot.notes);
  var baseStatuses = _serverStateOr('statuses', cid, null);
  if (baseStatuses) Object.assign(baseStatuses, snapshot.statuses || {});
  return true;
}

/* §15.4 — post-import reconciliation: merge a duplicate "ghost" student
   into a canonical record. Same-course enrollments merge (designations
   unioned, withdrawn_at cleared if either was active); cross-course
   enrollments move. Ghost student is deleted. Returns
   { enrollments_moved, enrollments_merged, deleted_student }. */
window.v2.relinkStudent = function (ghostStudentId, canonicalStudentId) {
  return _rpcOrNoop('relink_student', {
    p_ghost_student_id: ghostStudentId,
    p_canonical_student_id: canonicalStudentId,
  });
};

/* §16.2 — self-service "Clear all my data" from Settings. Removes every
   course + student owned by the teacher; Teacher row + TeacherPreference
   are kept (active_course_id reset to null). Returns
   { courses, students } counts. */
window.v2.clearData = function () {
  return _rpcOrNoop('clear_data', {});
};

window.v2.saveTermRating = function (enrollmentId, term, payload) {
  payload = payload || {};
  var wire = {};
  if ('narrativeHtml' in payload) wire.narrative_html = payload.narrativeHtml;
  if ('workHabitsRating' in payload) wire.work_habits_rating = payload.workHabitsRating;
  if ('participationRating' in payload) wire.participation_rating = payload.participationRating;
  if ('socialTraits' in payload) wire.social_traits = payload.socialTraits || [];
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
window.v2.deleteCustomTag = function (id) {
  return _rpcOrNoop('delete_custom_tag', { p_id: id });
};
window.v2.deleteCustomTagByLabel = function (cid, label) {
  return _rpcOrNoop('delete_custom_tag_by_label', { p_course_id: cid, p_label: label });
};

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
    return { key: tagStr, label: OBS_LABELS[tagStr], icon: OBS_ICONS[tagStr], color: 'var(--text-2)', type: 'dim' };
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

function upsertTermRating(cid, sid, termId, data) {
  const all = getTermRatings(cid);
  if (!all[sid]) all[sid] = {};
  const now = new Date().toISOString();
  if (all[sid][termId]) {
    Object.assign(all[sid][termId], data);
    all[sid][termId].modified = now;
  } else {
    all[sid][termId] = {
      dims: Object.fromEntries(OBS_DIMS.map(d => [d, 0])),
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
};
function _termRatingPatch(data) {
  var payload = {};
  Object.keys(data || {}).forEach(function (key) {
    var wireKey = _TERM_RATING_WIRE[key];
    if (!wireKey) return;
    var value = data[key];
    if ((key === 'workHabits' || key === 'participation') && !value) value = null;
    payload[wireKey] = value;
  });
  return payload;
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

  var present = new Set(order.concat(disabled));
  WIDGET_KEYS.forEach(function (k) {
    if (!present.has(k)) disabled.push(k);
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
  esc,
  escJs,
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
  getSelectedTermOrdinal,
  setSelectedTermOrdinal,
  loadCurriculumIndex,
  getCoursesByGrade,
  getSubjectsByGrade,
  buildLearningMapFromTags,
  getLearningMap,
  saveLearningMap,
  resetLearningMap,
  ensureCustomLearningMap,
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
  getAssessments,
  saveAssessments,
  getOverrides,
  saveOverrides,
  getNotes,
  saveNotes,
  getScores,
  saveScores,
  upsertScore,
  getLastScoredAssessment,
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
  upsertTermRating,
  getReportConfig,
  saveReportConfig,
  getStudentProfileSummaries,
  loadStudentProfileSummaries,
  getCardWidgetConfig,
  saveCardWidgetConfig,
  clearCardWidgetConfig,
};

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
  if (typeof seedIfNeeded === 'function') {
    seedIfNeeded();
    return Promise.resolve();
  }
  // User deliberately wiped all data — never auto-seed
  if (localStorage.getItem('gb-data-wiped') === '1') return Promise.resolve();
  // Lazy-load the script, then seed
  return new Promise(function (resolve) {
    var s = document.createElement('script');
    s.src = '/shared/seed-data.js?v=42';
    s.onload = function () {
      if (typeof seedIfNeeded === 'function') seedIfNeeded();
      resolve();
    };
    s.onerror = resolve;
    document.head.appendChild(s);
  });
};
