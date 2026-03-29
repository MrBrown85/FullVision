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
  courses: null,         // COURSES object (global)
  config: null,          // gb-config (global)
  students: {},          // keyed by cid
  assessments: {},       // keyed by cid
  scores: {},            // keyed by cid
  learningMaps: {},      // keyed by cid
  courseConfigs: {},      // keyed by cid
  modules: {},           // keyed by cid
  rubrics: {},           // keyed by cid
  flags: {},             // keyed by cid
  goals: {},             // keyed by cid
  reflections: {},       // keyed by cid
  overrides: {},         // keyed by cid
  statuses: {},          // keyed by cid
  observations: {},      // keyed by cid
  termRatings: {},       // keyed by cid
  customTags: {},        // keyed by cid
  notes: {},             // keyed by cid
  reportConfig: {},      // keyed by cid
};

// Mapping from cache field → localStorage key suffix (and Supabase data_key)
const _DATA_KEYS = {
  students:     'students',
  assessments:  'assessments',
  scores:       'scores',
  learningMaps: 'learningmap',
  courseConfigs: 'courseconfig',
  modules:      'modules',
  rubrics:      'rubrics',
  flags:        'flags',
  goals:        'goals',
  reflections:  'reflections',
  overrides:    'overrides',
  statuses:     'statuses',
  observations: 'quick-obs',
  termRatings:  'term-ratings',
  customTags:   'custom-tags',
  notes:        'notes',
  reportConfig: 'report-config',
};

let _useSupabase = false;
let _teacherId = null;
let _initPromise = null;  // dedup concurrent initData calls

/* ══════════════════════════════════════════════════════════════════
   Sync status tracking
   ══════════════════════════════════════════════════════════════════ */
let _syncStatus = 'idle';
let _pendingSyncs = 0;
let _lastSyncedAt = null;

function getSyncStatus() {
  return { status: _syncStatus, pending: _pendingSyncs };
}

function getLastSyncedAt() { return _lastSyncedAt; }

/** Returns a promise that resolves when all pending syncs complete (or after timeout). */
function waitForPendingSyncs(timeoutMs = 5000) {
  if (_pendingSyncs <= 0) return Promise.resolve();
  return new Promise(resolve => {
    const start = Date.now();
    const check = setInterval(() => {
      if (_pendingSyncs <= 0 || Date.now() - start > timeoutMs) {
        clearInterval(check);
        resolve();
      }
    }, 100);
  });
}

function _updateSyncIndicator() {
  const dot = document.getElementById('sync-indicator-dot');
  if (!dot) return;
  const s = getSyncStatus();
  dot.className = 'tb-sync-dot ' + s.status;
  dot.title = s.status === 'idle' ? 'All changes saved' :
              s.status === 'syncing' ? 'Syncing...' : 'Sync error — changes saved locally';
}

/* ══════════════════════════════════════════════════════════════════
   Cross-tab conflict detection
   ══════════════════════════════════════════════════════════════════ */
let _crossTabChannel = null;
let _crossTabAlerted = false;

function _initCrossTab() {
  if (_crossTabChannel) return;
  _crossTabAlerted = false;
  try {
    _crossTabChannel = new BroadcastChannel('td-data-sync');
    _crossTabChannel.onmessage = function(e) {
      if (e.data && e.data.type === 'data-changed') {
        _handleCrossTabChange(e.data.cid, e.data.field);
      }
    };
  } catch (e) {
    // BroadcastChannel not supported — fall back to storage event
  }
  // Fallback: storage event fires cross-tab when localStorage changes
  window.addEventListener('storage', function(e) {
    if (e.key && e.key.startsWith('gb-') && !_crossTabAlerted) {
      // Storage events don't carry field info — reload as fallback
      _crossTabAlerted = true;
      if (typeof showSyncToast === 'function') {
        var el = document.getElementById('sync-toast');
        if (el) el.remove();
        var toast = document.createElement('div');
        toast.className = 'sync-toast error';
        toast.id = 'sync-toast';
        toast.setAttribute('role', 'alert');
        toast.setAttribute('aria-live', 'assertive');
        toast.innerHTML = '<span>Data changed in another tab</span><button class="sync-toast-btn" data-action="reload-cross-tab">Reload</button>';
        document.body.appendChild(toast);
      }
    }
  });

  // Delegated click handler for cross-tab reload buttons (storage fallback only)
  document.addEventListener('click', function(e) {
    var btn = e.target.closest('[data-action="reload-cross-tab"]');
    if (btn) {
      _crossTabAlerted = false;
      window.location.reload();
    }
  });
}

/* Re-fetch a single field from Supabase after cross-tab change, then re-render */
async function _handleCrossTabChange(cid, field) {
  if (!cid || !field) return;

  // Re-fetch from the appropriate normalized table
  if (_useSupabase) {
    try {
      var sb = getSupabase();
      var normTable = _NORMALIZED_TABLES[field];
      if (normTable) {
        var result = await sb.from(normTable).select('*')
          .eq('teacher_id', _teacherId)
          .eq('course_id', cid);
        if (!result.error && result.data) {
          if (_getConfigTableSet().has(normTable)) {
            _cache[field][cid] = (result.data.length > 0) ? result.data[0].data : _defaultForField(field);
          } else if (_BULK_LOAD_CONVERTERS[normTable]) {
            _cache[field][cid] = _BULK_LOAD_CONVERTERS[normTable](result.data);
          } else if (field === 'scores') {
            _cache[field][cid] = _scoreRowsToBlob(result.data);
          } else if (field === 'observations') {
            _cache[field][cid] = _obsRowsToBlob(result.data);
          } else if (field === 'assessments') {
            _cache[field][cid] = _assessmentRowsToBlob(result.data);
          } else if (field === 'students') {
            _cache[field][cid] = _studentRowsToBlob(result.data).map(migrateStudent);
          }
        }
      }
    } catch (e) { /* fall through — cache stays as-is */ }
  }

  // Clear proficiency cache if relevant field changed
  if (_PROF_FIELDS.includes(field) && typeof clearProfCache === 'function') clearProfCache();

  // Clear tag/section caches if learning map changed
  if (field === 'learningMaps') { _allTagsCache = {}; _tagToSectionCache = {}; }

  // Re-render current page if it has a render() method
  var currentPage = (typeof Router !== 'undefined' && Router.getCurrentPage) ? Router.getCurrentPage() : null;
  if (currentPage && currentPage.render) {
    try { currentPage.render(); } catch (e) { /* page may not be ready */ }
  }
}

function _broadcastChange(cid, field) {
  if (_crossTabChannel) {
    try { _crossTabChannel.postMessage({ type: 'data-changed', cid: cid, field: field }); } catch (e) { /* fire-and-forget — channel may be closed */ }
  }
}

/* ══════════════════════════════════════════════════════════════════
   Supabase sync helpers (fire-and-forget with coalescing)
   ══════════════════════════════════════════════════════════════════ */
let _hadSyncError = false;
let _retryQueue = [];       // { table, key, data }
let _retryTimer = null;
let _lsQuotaWarned = false;
let _beforeUnloadBound = false;
let _retryCount = 0;
let _consecutiveFailures = 0;
const _MAX_RETRIES = 6;
const _MAX_RETRY_QUEUE = 100;
const _SYNC_TIMEOUT_MS = 10000;

/* Track in-flight and pending syncs per key to coalesce rapid saves */
const _inflightSyncs = new Map();   // syncKey → true (currently in-flight)
const _pendingWrites = new Map();   // syncKey → { table, key, data } (queued behind in-flight)

function _hasDataChanged(a, b) {
  return JSON.stringify(a) !== JSON.stringify(b);
}

// Lazily built sets for table lookups (avoids TDZ — constants declared later)
var _cidKeyedTablesCache = null;
function _getCidKeyedTables() {
  if (!_cidKeyedTablesCache) _cidKeyedTablesCache = new Set(Object.values(_NORMALIZED_TABLES));
  return _cidKeyedTablesCache;
}
var _configTableSetCache = null;
function _getConfigTableSet() {
  if (!_configTableSetCache) _configTableSetCache = new Set(Object.values(_CONFIG_TABLES));
  return _configTableSetCache;
}

function _syncKey(table, key) {
  if (table === 'scores_row') return 'scores_row:' + key.cid + ':' + key.sid + ':' + key.aid + ':' + key.tid;
  if (table === 'obs_row') return 'obs_row:' + key.cid + ':' + key.obId;
  if (table === 'obs_delete') return 'obs_delete:' + key.cid + ':' + key.obId;
  if (_getCidKeyedTables().has(table)) return table + ':' + key.cid;
  return table + ':' + key;
}

function _syncToSupabase(table, key, data) {
  const sk = _syncKey(table, key);

  // If a sync for this exact key is already in-flight, just update the pending data (latest wins)
  if (_inflightSyncs.has(sk)) {
    _pendingWrites.set(sk, { table, key, data });
    return;
  }

  _inflightSyncs.set(sk, true);
  _doSync(table, key, data).catch(err => console.error(`Sync error (${sk}):`, err)).finally(() => {
    _inflightSyncs.delete(sk);
    // If a newer write arrived while we were in-flight, send it now
    if (_pendingWrites.has(sk)) {
      const next = _pendingWrites.get(sk);
      _pendingWrites.delete(sk);
      _syncToSupabase(next.table, next.key, next.data);
    }
  });
}

async function _doSync(table, key, data) {
  const sb = getSupabase();
  if (!sb || !_teacherId) return;

  _pendingSyncs++;
  _syncStatus = 'syncing';
  _updateSyncIndicator();

  // AbortController for request timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), _SYNC_TIMEOUT_MS);

  try {
    if (table === 'scores') {
      // Full scores sync: delete all for this course, then bulk insert
      const rows = _scoreBlobToRows(key.cid, data);
      const { error: delErr } = await sb.from('scores')
        .delete()
        .eq('teacher_id', _teacherId)
        .eq('course_id', key.cid)
        .abortSignal(controller.signal);
      if (delErr) throw delErr;
      if (rows.length > 0) {
        const { error: insErr } = await sb.from('scores')
          .insert(rows)
          .abortSignal(controller.signal);
        if (insErr) throw insErr;
      }
    } else if (table === 'observations') {
      // Full observations sync: delete all for this course, then bulk insert
      const obsRows = _obsBlobToRows(key.cid, data);
      const { error: delErr } = await sb.from('observations')
        .delete()
        .eq('teacher_id', _teacherId)
        .eq('course_id', key.cid)
        .abortSignal(controller.signal);
      if (delErr) throw delErr;
      if (obsRows.length > 0) {
        const { error: insErr } = await sb.from('observations')
          .insert(obsRows)
          .abortSignal(controller.signal);
        if (insErr) throw insErr;
      }
    } else if (table === 'obs_row') {
      // Single observation upsert
      const { error } = await sb.from('observations').upsert(data, {
        onConflict: 'teacher_id,course_id,id'
      }).abortSignal(controller.signal);
      if (error) throw error;
    } else if (table === 'obs_delete') {
      // Single observation delete
      const { error } = await sb.from('observations')
        .delete()
        .eq('teacher_id', _teacherId)
        .eq('course_id', key.cid)
        .eq('id', key.obId)
        .abortSignal(controller.signal);
      if (error) throw error;
    } else if (table === 'scores_row') {
      // Single score upsert — the efficient hot path
      const { error } = await sb.from('scores').upsert(data, {
        onConflict: 'teacher_id,course_id,student_id,assessment_id,tag_id'
      }).abortSignal(controller.signal);
      if (error) throw error;
    } else if (table === 'assessments') {
      // Full assessments sync: delete all for this course, then bulk insert
      const aRows = _assessmentsBlobToRows(key.cid, data);
      const { error: delErr } = await sb.from('assessments')
        .delete()
        .eq('teacher_id', _teacherId)
        .eq('course_id', key.cid)
        .abortSignal(controller.signal);
      if (delErr) throw delErr;
      if (aRows.length > 0) {
        const { error: insErr } = await sb.from('assessments')
          .insert(aRows)
          .abortSignal(controller.signal);
        if (insErr) throw insErr;
      }
    } else if (table === 'students_table') {
      // Full students sync: delete all for this course, then bulk insert
      const sRows = _studentsBlobToRows(key.cid, data);
      const { error: delErr } = await sb.from('students')
        .delete()
        .eq('teacher_id', _teacherId)
        .eq('course_id', key.cid)
        .abortSignal(controller.signal);
      if (delErr) throw delErr;
      if (sRows.length > 0) {
        const { error: insErr } = await sb.from('students')
          .insert(sRows)
          .abortSignal(controller.signal);
        if (insErr) throw insErr;
      }
    } else if (_BULK_SYNC_CONVERTERS[table]) {
      // Generic delete-all + bulk-insert for medium-frequency normalized tables
      const convFn = _BULK_SYNC_CONVERTERS[table];
      const tableName = table;
      const bulkRows = convFn(key.cid, data);
      const { error: delErr } = await sb.from(tableName)
        .delete()
        .eq('teacher_id', _teacherId)
        .eq('course_id', key.cid)
        .abortSignal(controller.signal);
      if (delErr) throw delErr;
      if (bulkRows.length > 0) {
        const { error: insErr } = await sb.from(tableName)
          .insert(bulkRows)
          .abortSignal(controller.signal);
        if (insErr) throw insErr;
      }
    } else if (_getConfigTableSet().has(table)) {
      // Config tables: single JSONB blob per course, upsert
      const { error } = await sb.from(table).upsert({
        teacher_id: _teacherId,
        course_id: key.cid,
        data: data,
        updated_at: new Date().toISOString()
      }, { onConflict: 'teacher_id,course_id' }).abortSignal(controller.signal);
      if (error) throw error;
    } else if (table === 'teacher_config') {
      const { error } = await sb.from('teacher_config').upsert({
        teacher_id: _teacherId,
        config_key: key,
        data: data,
        updated_at: new Date().toISOString()
      }, { onConflict: 'teacher_id,config_key' }).abortSignal(controller.signal);
      if (error) throw error;
    }
    clearTimeout(timeoutId);
    _pendingSyncs--;
    _consecutiveFailures = 0;
    if (_pendingSyncs <= 0) { _pendingSyncs = 0; _syncStatus = 'idle'; _retryCount = 0; _lastSyncedAt = new Date(); }
    _updateSyncIndicator();
    // Show recovery toast if we previously had an error
    if (_hadSyncError && _syncStatus === 'idle') {
      _hadSyncError = false;
      if (typeof showSyncToast === 'function') showSyncToast('All changes synced', 'success');
    }
  } catch (err) {
    clearTimeout(timeoutId);
    _pendingSyncs--;
    if (_pendingSyncs <= 0) _pendingSyncs = 0;
    _syncStatus = 'error';
    _consecutiveFailures++;
    _updateSyncIndicator();
    // Show error toast and queue retry
    if (!_hadSyncError) {
      _hadSyncError = true;
      if (typeof showSyncToast === 'function') showSyncToast('Sync failed \u2014 changes saved locally', 'error');
    }
    if (_consecutiveFailures >= 3) {
      if (typeof showSyncToast === 'function') showSyncToast('Server overloaded \u2014 retries paused, data safe locally', 'error');
    }
    _addToRetryQueue(table, key, data);
    // Only schedule retries if not in overload backoff
    if (!_retryTimer && _consecutiveFailures < 3) {
      var delay = Math.min(30000 * Math.pow(2, _retryCount), 300000);
      // Add jitter: ±30%
      delay = delay * (0.7 + Math.random() * 0.6);
      _retryTimer = setTimeout(_retryFailedSyncs, delay);
    }
    throw err;
  }
}

/* Deduplicated, bounded retry queue — keeps only latest data per key */
function _addToRetryQueue(table, key, data, skipPersist) {
  const sk = _syncKey(table, key);
  const idx = _retryQueue.findIndex(item => _syncKey(item.table, item.key) === sk);
  if (idx !== -1) {
    _retryQueue[idx] = { table, key, data };
  } else {
    _retryQueue.push({ table, key, data });
  }
  while (_retryQueue.length > _MAX_RETRY_QUEUE) {
    _retryQueue.shift();
  }
  if (!skipPersist) _persistRetryQueue();
}

function _persistRetryQueue() {
  _safeLSSet('gb-retry-queue', JSON.stringify(_retryQueue));
}

/* Process retry queue sequentially (not all at once) */
async function _retryFailedSyncs() {
  _retryTimer = null;
  _retryCount++;
  if (_retryCount > _MAX_RETRIES) {
    console.warn('Sync retry limit reached, dropping', _retryQueue.length, 'items');
    _retryQueue = [];
    _retryCount = 0;
    _consecutiveFailures = 0;
    localStorage.removeItem('gb-retry-queue');
    return;
  }
  // Process one at a time to avoid hammering the server
  const queue = _retryQueue.splice(0);
  if (queue.length === 0) { localStorage.removeItem('gb-retry-queue'); return; }
  for (let i = 0; i < queue.length; i++) {
    try {
      await _doSync(queue[i].table, queue[i].key, queue[i].data);
    } catch (e) {
      // _doSync already re-adds the failed item — re-add remaining unprocessed items
      for (let j = i + 1; j < queue.length; j++) {
        _addToRetryQueue(queue[j].table, queue[j].key, queue[j].data, true);
      }
      _persistRetryQueue();
      break;
    }
  }
}

function retrySyncs() {
  if (_retryQueue.length === 0) return;
  clearTimeout(_retryTimer);
  _retryCount = 0;
  _consecutiveFailures = 0;
  _retryFailedSyncs();
}

async function _deleteFromSupabase(table, key) {
  const sb = getSupabase();
  if (!sb || !_teacherId) return;
  try {
    const { error } = await sb.from(table).delete()
      .eq('teacher_id', _teacherId)
      .eq('course_id', key.cid);
    if (error) throw error;
  } catch (err) {
    console.error('Failed to delete from Supabase:', err);
  }
}

/* ══════════════════════════════════════════════════════════════════
   Initialization — call once per page load (or on course switch)
   ══════════════════════════════════════════════════════════════════ */

/** Load global data (courses + config). Call before initData(). */
async function initAllCourses() {
  // Check Supabase availability
  if (typeof getSupabase === 'function') {
    const sb = getSupabase();
    if (sb) {
      try {
        const { data: { session } } = await sb.auth.getSession();
        if (session && session.user) {
          _useSupabase = true;
          _teacherId = session.user.id;
        }
      } catch (e) {
        console.warn('Supabase session check failed, falling back to localStorage:', e);
      }
    }
  }

  if (_useSupabase) {
    const sb = getSupabase();
    // Fetch global config rows
    const { data: configRows, error } = await sb.from('teacher_config')
      .select('config_key, data')
      .eq('teacher_id', _teacherId);
    if (error) {
      console.error('Failed to load teacher_config:', error);
      _useSupabase = false;
    } else {
      const configMap = {};
      (configRows || []).forEach(r => { configMap[r.config_key] = r.data; });

      _cache.courses = configMap['courses'] || null;
      _cache.config = configMap['config'] || {};
    }
  }

  // Fall back to defaults if needed
  if (!_useSupabase || _cache.courses === null) {
    if (_useSupabase) {
      // New Supabase account — use DEFAULT_COURSES, not stale localStorage
      _cache.courses = structuredClone(DEFAULT_COURSES);
      _cache.config = {};
      _syncToSupabase('teacher_config', 'courses', _cache.courses);
      _syncToSupabase('teacher_config', 'config', _cache.config);
    } else {
      _cache.courses = _loadCoursesFromLS();
      _cache.config = _safeParseLS('gb-config', {});
    }
  }

  // Ensure COURSES global is set
  COURSES = _cache.courses;
  if (!localStorage.getItem('gb-courses') && !_useSupabase) saveCourses(COURSES);

  try {
    var savedQueue = JSON.parse(localStorage.getItem('gb-retry-queue') || '[]')
      .filter(function(item) { return item && item.table && item.key; });
    if (savedQueue.length > 0 && _useSupabase) {
      _retryQueue = savedQueue;
      setTimeout(_retryFailedSyncs, 2000);
    } else {
      localStorage.removeItem('gb-retry-queue');
    }
  } catch (e) { localStorage.removeItem('gb-retry-queue'); }

  if (!_beforeUnloadBound) {
    _beforeUnloadBound = true;
    window.addEventListener('beforeunload', function() {
      if (_retryQueue.length > 0) _persistRetryQueue();
    });
  }

  // Start cross-tab conflict detection
  _initCrossTab();

  // Subscribe to Supabase Realtime for cross-device sync (phone → laptop)
  _initRealtimeSync();

  // Re-fetch from Supabase when user returns to this tab/app
  _initVisibilityRefresh();
}

var _realtimeChannel = null;
function _initRealtimeSync() {
  if (_realtimeChannel || !_useSupabase || !_teacherId) return;
  var sb = getSupabase();
  if (!sb) return;

  try {
    _realtimeChannel = sb.channel('course-data-sync')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'observations',
        filter: 'teacher_id=eq.' + _teacherId
      }, function(payload) {
        var row = payload.new || payload.old;
        if (!row) return;
        var cid = row.course_id;
        if (!cid) return;
        if (!_cache.observations[cid]) _cache.observations[cid] = {};

        var sid = row.student_id;
        var obId = row.id;

        if (payload.eventType === 'DELETE') {
          if (_cache.observations[cid][sid]) {
            _cache.observations[cid][sid] = _cache.observations[cid][sid].filter(function(o) { return o.id !== obId; });
          }
        } else {
          var r = payload.new;
          if (!_cache.observations[cid][sid]) _cache.observations[cid][sid] = [];
          var arr = _cache.observations[cid][sid];
          var idx = arr.findIndex(function(o) { return o.id === obId; });
          var entry = { id: r.id, text: r.text || '', dims: r.dims || [], created: r.created_at, date: r.date };
          if (r.sentiment) entry.sentiment = r.sentiment;
          if (r.context) entry.context = r.context;
          if (r.assignment_context) entry.assignmentContext = r.assignment_context;
          if (r.modified_at) entry.modified = r.modified_at;

          // Self-echo check
          if (idx !== -1 && arr[idx].text === entry.text && arr[idx].modified === entry.modified) return;

          if (idx !== -1) { arr[idx] = entry; } else { arr.push(entry); }
        }
        _invalidateAndRerender();
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'scores',
        filter: 'teacher_id=eq.' + _teacherId
      }, function(payload) {
        var row = payload.new || payload.old;
        if (!row) return;
        var cid = row.course_id;
        if (!cid || !_cache.scores[cid]) return;

        var sid = row.student_id;
        var aid = row.assessment_id;
        var tid = row.tag_id;

        if (payload.eventType === 'DELETE') {
          // Remove from cache blob
          if (_cache.scores[cid][sid]) {
            _cache.scores[cid][sid] = _cache.scores[cid][sid].filter(function(e) {
              return !(e.assessmentId === aid && e.tagId === tid);
            });
          }
        } else {
          // INSERT or UPDATE — upsert into cache blob
          var r = payload.new;
          if (!_cache.scores[cid][sid]) _cache.scores[cid][sid] = [];
          var arr = _cache.scores[cid][sid];
          var idx = arr.findIndex(function(e) { return e.assessmentId === aid && e.tagId === tid; });
          var entry = {
            id: sid + ':' + aid + ':' + tid,
            assessmentId: aid, tagId: tid,
            score: r.score, date: r.date,
            type: r.type || 'summative', note: r.note || '',
            created: r.created_at || new Date().toISOString()
          };

          // Skip if data matches (self-echo)
          if (idx !== -1 && arr[idx].score === entry.score && arr[idx].date === entry.date && arr[idx].note === entry.note) return;

          if (idx !== -1) { arr[idx] = entry; } else { arr.push(entry); }
        }

        _invalidateAndRerender();
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'assessments',
        filter: 'teacher_id=eq.' + _teacherId
      }, function(payload) {
        var row = payload.new || payload.old;
        if (!row) return;
        var cid = row.course_id;
        if (!cid) return;
        if (!_cache.assessments[cid]) _cache.assessments[cid] = [];

        if (payload.eventType === 'DELETE') {
          _cache.assessments[cid] = _cache.assessments[cid].filter(function(a) { return a.id !== row.id; });
        } else {
          var r = payload.new;
          var arr = _cache.assessments[cid];
          var idx = arr.findIndex(function(a) { return a.id === r.id; });
          var entry = _assessmentRowsToBlob([r])[0];

          // Self-echo check
          if (idx !== -1 && arr[idx].title === entry.title && arr[idx].date === entry.date
              && JSON.stringify(arr[idx].tagIds) === JSON.stringify(entry.tagIds)) return;

          if (idx !== -1) { arr[idx] = entry; } else { arr.push(entry); }
        }
        _invalidateAndRerender();
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'students',
        filter: 'teacher_id=eq.' + _teacherId
      }, function(payload) {
        var row = payload.new || payload.old;
        if (!row) return;
        var cid = row.course_id;
        if (!cid) return;
        if (!_cache.students[cid]) _cache.students[cid] = [];

        if (payload.eventType === 'DELETE') {
          _cache.students[cid] = _cache.students[cid].filter(function(s) { return s.id !== row.id; });
        } else {
          var r = payload.new;
          var arr = _cache.students[cid];
          var idx = arr.findIndex(function(s) { return s.id === r.id; });
          var entry = _studentRowsToBlob([r])[0];

          // Self-echo check
          if (idx !== -1 && arr[idx].firstName === entry.firstName && arr[idx].lastName === entry.lastName) return;

          if (idx !== -1) { arr[idx] = entry; } else { arr.push(migrateStudent(entry)); }
        }
        _invalidateAndRerender();
      });

    // Medium-frequency tables: on any change, re-fetch full table for course
    var _medTables = Object.values(_MEDIUM_FREQ_TABLES);
    _medTables.forEach(function(tblName) {
      _realtimeChannel = _realtimeChannel.on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: tblName,
        filter: 'teacher_id=eq.' + _teacherId
      }, function(payload) {
        var row = payload.new || payload.old;
        if (!row || !row.course_id) return;
        var cid = row.course_id;
        // Find the cache field for this table
        var cacheField = null;
        for (var f in _MEDIUM_FREQ_TABLES) {
          if (_MEDIUM_FREQ_TABLES[f] === tblName) { cacheField = f; break; }
        }
        if (!cacheField) return;
        // Re-fetch entire table for this course (medium-freq = small data, simple approach)
        var sb2 = getSupabase();
        if (!sb2) return;
        sb2.from(tblName).select('*').eq('teacher_id', _teacherId).eq('course_id', cid).then(function(res) {
          if (res.error || !res.data) return;
          var conv = _BULK_LOAD_CONVERTERS[tblName];
          if (!conv) return;
          var newBlob = conv(res.data);
          if (!_hasDataChanged(newBlob, _cache[cacheField][cid])) return;
          _cache[cacheField][cid] = newBlob;
          _invalidateAndRerender();
        });
      });
    });

    // Config tables: on any change, update cache from JSONB data column
    Object.keys(_CONFIG_TABLES).forEach(function(cfgField) {
      var cfgTblName = _CONFIG_TABLES[cfgField];
      _realtimeChannel = _realtimeChannel.on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: cfgTblName,
        filter: 'teacher_id=eq.' + _teacherId
      }, function(payload) {
        var row = payload.new || payload.old;
        if (!row || !row.course_id) return;
        var cid = row.course_id;
        if (payload.eventType === 'DELETE') {
          _cache[cfgField][cid] = _defaultForField(cfgField);
        } else {
          var newData = payload.new.data;
          if (!_hasDataChanged(newData, _cache[cfgField][cid])) return;
          _cache[cfgField][cid] = newData;
        }
        _invalidateAndRerender();
      });
    });

    _realtimeChannel.subscribe();
  } catch (e) {
    console.warn('Realtime sync not available:', e);
  }
}

/** Shared cache invalidation + re-render for both Realtime and visibility refresh */
function _invalidateAndRerender() {
  if (typeof clearProfCache === 'function') clearProfCache();
  _allTagsCache = {};
  _tagToSectionCache = {};
  // Re-render current page (desktop)
  var currentPage = (typeof Router !== 'undefined' && Router.getCurrentPage) ? Router.getCurrentPage() : null;
  if (currentPage && currentPage.render) {
    try { currentPage.render(); } catch (e) { /* page may not be ready */ }
  }
  // Re-render current tab (mobile)
  if (window.__MOBILE && typeof _mobileRerender === 'function') {
    try { _mobileRerender(); } catch (e) { /* mobile may not be ready */ }
  }
}

/* ══════════════════════════════════════════════════════════════════
   Visibility-change refresh — re-fetch from Supabase when user returns
   to this tab/app (phone → desktop, tab switch, wake from sleep).
   This is the most reliable cross-device sync mechanism.
   ══════════════════════════════════════════════════════════════════ */
var _lastVisibilityRefresh = 0;
var _VISIBILITY_DEBOUNCE = 3000; // Don't re-fetch more than once per 3 seconds

function _initVisibilityRefresh() {
  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState !== 'visible') return;
    if (!_useSupabase || !_teacherId) return;
    var now = Date.now();
    if (now - _lastVisibilityRefresh < _VISIBILITY_DEBOUNCE) return;
    _lastVisibilityRefresh = now;
    _refreshFromSupabase();
  });
}

async function _refreshFromSupabase() {
  var cid = null;
  try { cid = getActiveCourse(); } catch (e) { return; }
  if (!cid) return;

  var sb = getSupabase();
  if (!sb) return;

  try {
    var changed = false;
    var profChanged = false;
    var tagsChanged = false;

    // Refresh all normalized tables in parallel
    var since = _lastSyncedAt ? new Date(_lastSyncedAt.getTime() - 30000).toISOString() : null;
    function _rq(tbl, tsCol) {
      var q = sb.from(tbl).select('*').eq('teacher_id', _teacherId).eq('course_id', cid);
      if (since) q = q.gt(tsCol, since);
      return q;
    }
    var [scoreResult, obsResult, assessResult, studResult,
         goalsRefRes, reflRefRes, overRefRes, statusRefRes, notesRefRes, flagsRefRes, trRefRes,
         cfgLmRefRes, cfgCourseRefRes, cfgModRefRes, cfgRubRefRes, cfgTagRefRes, cfgRepRefRes] = await Promise.all([
      _rq('scores', 'updated_at'), _rq('observations', 'modified_at'),
      _rq('assessments', 'updated_at'), _rq('students', 'updated_at'),
      _rq('goals', 'updated_at'), _rq('reflections', 'updated_at'),
      _rq('overrides', 'updated_at'), _rq('statuses', 'updated_at'),
      _rq('student_notes', 'updated_at'), _rq('student_flags', 'updated_at'),
      _rq('term_ratings', 'updated_at'),
      _rq('config_learning_maps', 'updated_at'), _rq('config_course', 'updated_at'),
      _rq('config_modules', 'updated_at'), _rq('config_rubrics', 'updated_at'),
      _rq('config_custom_tags', 'updated_at'), _rq('config_report', 'updated_at')
    ]);

    if (!scoreResult.error && scoreResult.data && scoreResult.data.length > 0) {
      var blob = _cache.scores[cid] || {};
      scoreResult.data.forEach(function(r) {
        if (!blob[r.student_id]) blob[r.student_id] = [];
        var arr = blob[r.student_id];
        var idx = arr.findIndex(function(e) { return e.assessmentId === r.assessment_id && e.tagId === r.tag_id; });
        var entry = {
          id: r.student_id + ':' + r.assessment_id + ':' + r.tag_id,
          assessmentId: r.assessment_id, tagId: r.tag_id,
          score: r.score, date: r.date,
          type: r.type || 'summative', note: r.note || '',
          created: r.created_at || new Date().toISOString()
        };
        if (idx !== -1) { arr[idx] = entry; } else { arr.push(entry); }
      });
      _cache.scores[cid] = blob;
      changed = true;
      profChanged = true;
    }

    if (!obsResult.error && obsResult.data && obsResult.data.length > 0) {
      var obsBlob = _cache.observations[cid] || {};
      obsResult.data.forEach(function(r) {
        if (!obsBlob[r.student_id]) obsBlob[r.student_id] = [];
        var arr = obsBlob[r.student_id];
        var idx = arr.findIndex(function(o) { return o.id === r.id; });
        var entry = { id: r.id, text: r.text || '', dims: r.dims || [], created: r.created_at, date: r.date };
        if (r.sentiment) entry.sentiment = r.sentiment;
        if (r.context) entry.context = r.context;
        if (r.assignment_context) entry.assignmentContext = r.assignment_context;
        if (r.modified_at) entry.modified = r.modified_at;
        if (idx !== -1) { arr[idx] = entry; } else { arr.push(entry); }
      });
      _cache.observations[cid] = obsBlob;
      changed = true;
    }

    if (!assessResult.error && assessResult.data && assessResult.data.length > 0) {
      var currentAssess = _cache.assessments[cid] || [];
      assessResult.data.forEach(function(r) {
        var idx = currentAssess.findIndex(function(a) { return a.id === r.id; });
        var entry = _assessmentRowsToBlob([r])[0];
        if (idx !== -1) { currentAssess[idx] = entry; } else { currentAssess.push(entry); }
      });
      _cache.assessments[cid] = currentAssess;
      changed = true;
      profChanged = true;
    }

    if (!studResult.error && studResult.data && studResult.data.length > 0) {
      var currentStudents = _cache.students[cid] || [];
      studResult.data.forEach(function(r) {
        var idx = currentStudents.findIndex(function(s) { return s.id === r.id; });
        var entry = _studentRowsToBlob([r])[0];
        if (idx !== -1) { currentStudents[idx] = entry; } else { currentStudents.push(migrateStudent(entry)); }
      });
      _cache.students[cid] = currentStudents;
      changed = true;
    }

    // Refresh medium-frequency normalized tables (full replace on visibility change)
    var _medRefResults = { goals: goalsRefRes, reflections: reflRefRes, overrides: overRefRes, statuses: statusRefRes, notes: notesRefRes, flags: flagsRefRes, termRatings: trRefRes };
    for (var _mrf in _MEDIUM_FREQ_TABLES) {
      var _mrTbl = _MEDIUM_FREQ_TABLES[_mrf];
      var _mrRes = _medRefResults[_mrf];
      if (!_mrRes.error && _mrRes.data && _mrRes.data.length > 0) {
        var newBlob = _BULK_LOAD_CONVERTERS[_mrTbl](_mrRes.data);
        if (_hasDataChanged(newBlob, _cache[_mrf][cid])) {
          _cache[_mrf][cid] = newBlob;
          changed = true;
          if (_PROF_FIELDS.includes(_mrf)) profChanged = true;
        }
      }
    }

    // Refresh config tables
    var _cfgRefResults = { learningMaps: cfgLmRefRes, courseConfigs: cfgCourseRefRes, modules: cfgModRefRes, rubrics: cfgRubRefRes, customTags: cfgTagRefRes, reportConfig: cfgRepRefRes };
    for (var _crf in _CONFIG_TABLES) {
      var _crRes = _cfgRefResults[_crf];
      if (!_crRes.error && _crRes.data && _crRes.data.length > 0) {
        var newCfg = _crRes.data[0].data;
        if (_hasDataChanged(newCfg, _cache[_crf][cid])) {
          _cache[_crf][cid] = newCfg;
          changed = true;
          if (_PROF_FIELDS.includes(_crf)) profChanged = true;
          if (_crf === 'learningMaps' || _crf === 'customTags') tagsChanged = true;
        }
      }
    }

    if (changed) {
      if (profChanged && typeof clearProfCache === 'function') clearProfCache();
      if (tagsChanged) { _allTagsCache = {}; _tagToSectionCache = {}; }
      // Re-render current page (desktop)
      var currentPage = (typeof Router !== 'undefined' && Router.getCurrentPage) ? Router.getCurrentPage() : null;
      if (currentPage && currentPage.render) {
        try { currentPage.render(); } catch (e) { /* page may not be ready */ }
      }
      // Re-render current tab (mobile)
      if (window.__MOBILE && typeof _mobileRerender === 'function') {
        try { _mobileRerender(); } catch (e) { /* mobile may not be ready */ }
      }
    }
    _lastSyncedAt = new Date();
  } catch (e) {
    console.warn('Visibility refresh failed:', e);
  }
}

/** Load all data for a specific course into the cache. */
async function initData(cid) {
  if (!cid) return;
  // Avoid duplicate concurrent loads for same course
  const key = '_init_' + cid;
  if (_initPromise && _initPromise._cid === cid) return _initPromise;

  const p = _doInitData(cid);
  p._cid = cid;
  _initPromise = p;
  try { await p; } finally { if (_initPromise === p) _initPromise = null; }
}

async function _doInitData(cid) {
  if (_useSupabase) {
    const sb = getSupabase();

    try {
      // Load all normalized tables in parallel
      const _q = (tbl) => sb.from(tbl).select('*').eq('teacher_id', _teacherId).eq('course_id', cid);
      const [scoreRes, obsRes, assessRes, studentRes,
             goalsRes, reflRes, overRes, statusRes, notesRes, flagsRes, trRes,
             cfgLmRes, cfgCourseRes, cfgModRes, cfgRubRes, cfgTagRes, cfgRepRes] = await Promise.all([
        _q('scores'), _q('observations'), _q('assessments'), _q('students'),
        _q('goals'), _q('reflections'), _q('overrides'), _q('statuses'),
        _q('student_notes'), _q('student_flags'), _q('term_ratings'),
        _q('config_learning_maps'), _q('config_course'), _q('config_modules'),
        _q('config_rubrics'), _q('config_custom_tags'), _q('config_report')
      ]);

      _cache.scores[cid] = scoreRes.error
        ? (console.warn('Failed to load scores for', cid, scoreRes.error), {})
        : _scoreRowsToBlob(scoreRes.data);
      _cache.observations[cid] = obsRes.error
        ? (console.warn('Failed to load observations for', cid, obsRes.error), {})
        : _obsRowsToBlob(obsRes.data);
      _cache.assessments[cid] = assessRes.error
        ? (console.warn('Failed to load assessments for', cid, assessRes.error), [])
        : _assessmentRowsToBlob(assessRes.data);
      _cache.students[cid] = studentRes.error
        ? (console.warn('Failed to load students for', cid, studentRes.error), [])
        : _studentRowsToBlob(studentRes.data).map(migrateStudent);

      // Medium-frequency tables
      var _medResults = { goals: goalsRes, reflections: reflRes, overrides: overRes, statuses: statusRes, notes: notesRes, flags: flagsRes, termRatings: trRes };
      for (var _mf in _MEDIUM_FREQ_TABLES) {
        var _tbl = _MEDIUM_FREQ_TABLES[_mf];
        var _res = _medResults[_mf];
        if (_res.error) {
          console.warn('Failed to load ' + _tbl + ' for', cid, _res.error);
          _cache[_mf][cid] = _defaultForField(_mf);
        } else {
          _cache[_mf][cid] = _BULK_LOAD_CONVERTERS[_tbl](_res.data);
        }
      }

      // Config tables: single JSONB blob per course
      var _cfgResults = { learningMaps: cfgLmRes, courseConfigs: cfgCourseRes, modules: cfgModRes, rubrics: cfgRubRes, customTags: cfgTagRes, reportConfig: cfgRepRes };
      for (var _cf in _CONFIG_TABLES) {
        var _cfTbl = _CONFIG_TABLES[_cf];
        var _cfRes = _cfgResults[_cf];
        if (_cfRes.error) {
          console.warn('Failed to load ' + _cfTbl + ' for', cid, _cfRes.error);
          _cache[_cf][cid] = _defaultForField(_cf);
        } else {
          _cache[_cf][cid] = (_cfRes.data && _cfRes.data.length > 0) ? _cfRes.data[0].data : _defaultForField(_cf);
        }
      }

      // Fall back to built-in learning map if none stored
      const lm = _cache.learningMaps[cid];
      if (!lm || (!lm._customized && (!lm.sections || lm.sections.length === 0))) {
        _cache.learningMaps[cid] = LEARNING_MAP[cid] || { subjects: [], sections: [] };
      }

      // Migration: if Supabase returned all-empty but localStorage has data,
      // this is a post-normalization first load. Populate Supabase from localStorage.
      var supabaseEmpty = [scoreRes, obsRes, assessRes, studentRes,
        goalsRes, reflRes, overRes, statusRes, notesRes, flagsRes, trRes,
        cfgLmRes, cfgCourseRes, cfgModRes, cfgRubRes, cfgTagRes, cfgRepRes].every(function(r) {
        return !r.data || r.data.length === 0;
      });
      if (supabaseEmpty && _safeParseLS('gb-students-' + cid, []).length > 0) {
        console.info('Migration: Supabase tables empty, uploading localStorage data for', cid);
        _loadCourseFromLS(cid);
        _seedCourseToSupabase(cid);
      }

      return;
    } catch (error) {
      console.error('Failed to load data for', cid, error);
      // Fall through to localStorage
    }
  }

  // localStorage path
  _loadCourseFromLS(cid);
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

function _seedCourseToSupabase(cid) {
  for (const [field, normTable] of Object.entries(_NORMALIZED_TABLES)) {
    const val = _cache[field][cid];
    if (val === undefined || val === null) continue;
    _syncToSupabase(normTable, { cid }, val);
  }
}

function _defaultForField(field) {
  const arrayFields = ['students', 'assessments', 'modules', 'rubrics', 'customTags'];
  return arrayFields.includes(field) ? [] : {};
}

function _safeParseLS(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch (e) { console.warn('LS read fallback:', e); return fallback; }
}

function _safeLSSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    console.warn('localStorage write failed (' + key + '):', e);
    if (e.name === 'QuotaExceededError' && !_lsQuotaWarned) {
      _lsQuotaWarned = true;
      if (typeof showSyncToast === 'function') {
        showSyncToast('Local storage full \u2014 ensure you have internet for data safety', 'error');
      }
    }
  }
}

function _loadCoursesFromLS() {
  try {
    const stored = JSON.parse(localStorage.getItem('gb-courses'));
    if (stored && Object.keys(stored).length > 0) return stored;
  } catch (e) { console.warn('Courses parse error:', e); }
  return structuredClone(DEFAULT_COURSES);
}

/* Fields that affect proficiency calculations */
const _PROF_FIELDS = ['scores', 'assessments', 'overrides', 'statuses', 'courseConfigs', 'learningMaps'];

/* Blob→rows converters for generic bulk sync (delete-all + insert pattern) */
const _BULK_SYNC_CONVERTERS = {
  goals: _goalsBlobToRows,
  reflections: _reflectionsBlobToRows,
  overrides: _overridesBlobToRows,
  statuses: _statusesBlobToRows,
  student_notes: _notesBlobToRows,
  student_flags: _flagsBlobToRows,
  term_ratings: _termRatingsBlobToRows
};

/* Rows→blob converters for loading from normalized tables */
const _BULK_LOAD_CONVERTERS = {
  goals: _goalsRowsToBlob,
  reflections: _reflectionsRowsToBlob,
  overrides: _overridesRowsToBlob,
  statuses: _statusesRowsToBlob,
  student_notes: _notesRowsToBlob,
  student_flags: _flagsRowsToBlob,
  term_ratings: _termRatingsRowsToBlob
};

/* Cache field → table name for medium-frequency normalized tables */
const _MEDIUM_FREQ_TABLES = {
  goals: 'goals',
  reflections: 'reflections',
  overrides: 'overrides',
  statuses: 'statuses',
  notes: 'student_notes',
  flags: 'student_flags',
  termRatings: 'term_ratings'
};

/* Config tables: single JSONB blob per course, teacher_id in PK */
const _CONFIG_TABLES = {
  learningMaps: 'config_learning_maps',
  courseConfigs: 'config_course',
  modules: 'config_modules',
  rubrics: 'config_rubrics',
  customTags: 'config_custom_tags',
  reportConfig: 'config_report'
};

/* Fields stored in their own normalized tables */
const _NORMALIZED_TABLES = {
  scores: 'scores',
  observations: 'observations',
  assessments: 'assessments',
  students: 'students_table',
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
  reportConfig: 'config_report'
};

/* Helper: write to cache + sync */
function _saveCourseField(field, cid, value) {
  _cache[field][cid] = value;
  if (_PROF_FIELDS.includes(field) && typeof clearProfCache === 'function') clearProfCache();
  if (_useSupabase) {
    _syncToSupabase(_NORMALIZED_TABLES[field], { cid }, value);
  } else {
    const dataKey = _DATA_KEYS[field];
    _safeLSSet('gb-' + dataKey + '-' + cid, JSON.stringify(value));
  }
  _broadcastChange(cid, field);
}

/* Convert scores blob { sid: [...entries] } → flat array of table rows */
function _scoreBlobToRows(cid, scoresObj) {
  const rows = [];
  for (const sid in scoresObj) {
    (scoresObj[sid] || []).forEach(function(e) {
      rows.push({
        teacher_id: _teacherId,
        course_id: cid,
        student_id: sid,
        assessment_id: e.assessmentId,
        tag_id: e.tagId,
        score: e.score,
        date: e.date || null,
        type: e.type || 'summative',
        note: e.note || '',
        updated_at: new Date().toISOString()
      });
    });
  }
  return rows;
}

/* Convert flat score rows → blob format { sid: [...entries] } */
function _scoreRowsToBlob(rows) {
  const blob = {};
  (rows || []).forEach(function(r) {
    if (!blob[r.student_id]) blob[r.student_id] = [];
    blob[r.student_id].push({
      id: r.student_id + ':' + r.assessment_id + ':' + r.tag_id,
      assessmentId: r.assessment_id,
      tagId: r.tag_id,
      score: r.score,
      date: r.date,
      type: r.type || 'summative',
      note: r.note || '',
      created: r.created_at || new Date().toISOString()
    });
  });
  return blob;
}

/* Convert observations blob { sid: [...entries] } → flat array of table rows */
function _obsBlobToRows(cid, obsObj) {
  const rows = [];
  for (const sid in obsObj) {
    (obsObj[sid] || []).forEach(function(e) {
      rows.push({
        teacher_id: _teacherId,
        course_id: cid,
        student_id: sid,
        id: e.id,
        text: e.text || '',
        dims: e.dims || [],
        sentiment: e.sentiment || null,
        context: e.context || null,
        assignment_context: e.assignmentContext || null,
        date: e.date || null,
        created_at: e.created || new Date().toISOString(),
        modified_at: e.modified || null
      });
    });
  }
  return rows;
}

/* Convert flat observation rows → blob format { sid: [...entries] } */
function _obsRowsToBlob(rows) {
  const blob = {};
  (rows || []).forEach(function(r) {
    if (!blob[r.student_id]) blob[r.student_id] = [];
    var entry = {
      id: r.id,
      text: r.text || '',
      dims: r.dims || [],
      created: r.created_at || new Date().toISOString(),
      date: r.date
    };
    if (r.sentiment) entry.sentiment = r.sentiment;
    if (r.context) entry.context = r.context;
    if (r.assignment_context) entry.assignmentContext = r.assignment_context;
    if (r.modified_at) entry.modified = r.modified_at;
    blob[r.student_id].push(entry);
  });
  return blob;
}

/* Convert assessments array → flat array of table rows */
function _assessmentsBlobToRows(cid, arr) {
  return (arr || []).map(function(a) {
    return {
      teacher_id: _teacherId,
      course_id: cid,
      id: a.id,
      title: a.title || '',
      date: a.date || '',
      type: a.type || 'summative',
      tag_ids: a.tagIds || [],
      evidence_type: a.evidenceType || '',
      notes: a.notes || '',
      core_competency_ids: a.coreCompetencyIds || [],
      rubric_id: a.rubricId || '',
      score_mode: a.scoreMode || '',
      max_points: a.maxPoints || 0,
      weight: a.weight !== undefined ? a.weight : 1,
      due_date: a.dueDate || '',
      collaboration: a.collaboration || 'individual',
      module_id: a.moduleId || '',
      pairs: a.pairs || [],
      groups: a.groups || [],
      excluded_students: a.excludedStudents || [],
      updated_at: new Date().toISOString()
    };
  });
}

/* Convert flat assessment rows → app array format */
function _assessmentRowsToBlob(rows) {
  return (rows || []).map(function(r) {
    var a = {
      id: r.id,
      title: r.title || '',
      date: r.date || '',
      type: r.type || 'summative',
      tagIds: r.tag_ids || [],
      weight: r.weight !== undefined ? r.weight : 1,
      collaboration: r.collaboration || 'individual'
    };
    if (r.evidence_type) a.evidenceType = r.evidence_type;
    if (r.notes) a.notes = r.notes;
    if (r.core_competency_ids && r.core_competency_ids.length) a.coreCompetencyIds = r.core_competency_ids;
    if (r.rubric_id) a.rubricId = r.rubric_id;
    if (r.score_mode) a.scoreMode = r.score_mode;
    if (r.max_points) a.maxPoints = r.max_points;
    if (r.due_date) a.dueDate = r.due_date;
    if (r.module_id) a.moduleId = r.module_id;
    if (r.pairs && r.pairs.length) a.pairs = r.pairs;
    if (r.groups && r.groups.length) a.groups = r.groups;
    if (r.excluded_students && r.excluded_students.length) a.excludedStudents = r.excluded_students;
    return a;
  });
}

/* Convert students array → flat array of table rows */
function _studentsBlobToRows(cid, arr) {
  return (arr || []).map(function(s) {
    return {
      teacher_id: _teacherId,
      course_id: cid,
      id: s.id,
      first_name: s.firstName || '',
      last_name: s.lastName || '',
      preferred: s.preferred || '',
      pronouns: s.pronouns || '',
      student_number: s.studentNumber || '',
      email: s.email || '',
      date_of_birth: s.dateOfBirth || '',
      designations: s.designations || [],
      enrolled_date: s.enrolledDate || '',
      attendance: s.attendance || [],
      sort_name: s.sortName || '',
      updated_at: new Date().toISOString()
    };
  });
}

/* Convert flat student rows → app array format */
function _studentRowsToBlob(rows) {
  return (rows || []).map(function(r) {
    return {
      id: r.id,
      firstName: r.first_name || '',
      lastName: r.last_name || '',
      preferred: r.preferred || '',
      pronouns: r.pronouns || '',
      studentNumber: r.student_number || '',
      email: r.email || '',
      dateOfBirth: r.date_of_birth || '',
      designations: r.designations || [],
      enrolledDate: r.enrolled_date || '',
      attendance: r.attendance || [],
      sortName: r.sort_name || ''
    };
  });
}

/* ── Phase 4 converters: medium-frequency tables ── */

/* goals blob { sid: { tagId: "text" } } ↔ rows */
function _goalsBlobToRows(cid, obj) {
  var rows = [];
  for (var sid in obj) {
    for (var tagId in obj[sid]) {
      rows.push({ teacher_id: _teacherId, course_id: cid, student_id: sid, tag_id: tagId, text: obj[sid][tagId] || '', updated_at: new Date().toISOString() });
    }
  }
  return rows;
}
function _goalsRowsToBlob(rows) {
  var blob = {};
  (rows || []).forEach(function(r) {
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
      rows.push({ teacher_id: _teacherId, course_id: cid, student_id: sid, tag_id: tagId, confidence: v.confidence || 0, text: v.text || '', date: v.date || '', updated_at: new Date().toISOString() });
    }
  }
  return rows;
}
function _reflectionsRowsToBlob(rows) {
  var blob = {};
  (rows || []).forEach(function(r) {
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
      rows.push({ teacher_id: _teacherId, course_id: cid, student_id: sid, tag_id: tagId, level: v.level || 0, reason: v.reason || '', date: v.date || '', calculated: v.calculated || 0, updated_at: new Date().toISOString() });
    }
  }
  return rows;
}
function _overridesRowsToBlob(rows) {
  var blob = {};
  (rows || []).forEach(function(r) {
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
    rows.push({ teacher_id: _teacherId, course_id: cid, student_id: parts[0], assessment_id: parts.slice(1).join(':'), status: obj[compositeKey] || '', updated_at: new Date().toISOString() });
  }
  return rows;
}
function _statusesRowsToBlob(rows) {
  var blob = {};
  (rows || []).forEach(function(r) {
    blob[r.student_id + ':' + r.assessment_id] = r.status || '';
  });
  return blob;
}

/* notes blob { sid: "text" } ↔ rows */
function _notesBlobToRows(cid, obj) {
  var rows = [];
  for (var sid in obj) {
    rows.push({ teacher_id: _teacherId, course_id: cid, student_id: sid, text: obj[sid] || '', updated_at: new Date().toISOString() });
  }
  return rows;
}
function _notesRowsToBlob(rows) {
  var blob = {};
  (rows || []).forEach(function(r) { blob[r.student_id] = r.text || ''; });
  return blob;
}

/* flags blob { sid: true } ↔ rows */
function _flagsBlobToRows(cid, obj) {
  var rows = [];
  for (var sid in obj) {
    if (obj[sid]) rows.push({ teacher_id: _teacherId, course_id: cid, student_id: sid, updated_at: new Date().toISOString() });
  }
  return rows;
}
function _flagsRowsToBlob(rows) {
  var blob = {};
  (rows || []).forEach(function(r) { blob[r.student_id] = true; });
  return blob;
}

/* termRatings blob { sid: { termId: { dims, narrative, created, modified } } } ↔ rows */
function _termRatingsBlobToRows(cid, obj) {
  var rows = [];
  for (var sid in obj) {
    for (var termId in obj[sid]) {
      var v = obj[sid][termId] || {};
      rows.push({ teacher_id: _teacherId, course_id: cid, student_id: sid, term_id: termId, dims: v.dims || {}, narrative: v.narrative || '', created_at: v.created || new Date().toISOString(), modified_at: v.modified || null, updated_at: new Date().toISOString() });
    }
  }
  return rows;
}
function _termRatingsRowsToBlob(rows) {
  var blob = {};
  (rows || []).forEach(function(r) {
    if (!blob[r.student_id]) blob[r.student_id] = {};
    var entry = { dims: r.dims || {}, narrative: r.narrative || '', created: r.created_at || new Date().toISOString() };
    if (r.modified_at) entry.modified = r.modified_at;
    blob[r.student_id][r.term_id] = entry;
  });
  return blob;
}

/* Efficient single-score write — upserts one row to scores table + updates cache */
function upsertScore(cid, sid, aid, tid, scoreVal, date, type, note) {
  // Update cache blob
  const scores = getScores(cid);
  if (!scores[sid]) scores[sid] = [];
  const existing = scores[sid].find(function(e) { return e.assessmentId === aid && e.tagId === tid; });
  if (existing) {
    if (existing.score === scoreVal) return; // no change
    existing.score = scoreVal;
    if (date) existing.date = date;
    if (note !== undefined) existing.note = note;
  } else {
    scores[sid].push({
      id: sid + ':' + aid + ':' + tid,
      assessmentId: aid, tagId: tid, score: scoreVal,
      date: date || new Date().toISOString().slice(0, 10),
      type: type || 'summative', note: note || '',
      created: new Date().toISOString()
    });
  }
  _cache.scores[cid] = scores;
  if (typeof clearProfCache === 'function') clearProfCache();

  if (_useSupabase) {
    _syncToSupabase('scores_row', { cid, sid, aid, tid }, {
      teacher_id: _teacherId, course_id: cid, student_id: sid,
      assessment_id: aid, tag_id: tid, score: scoreVal,
      date: date || new Date().toISOString().slice(0, 10),
      type: type || 'summative', note: note || '',
      updated_at: new Date().toISOString()
    });
  } else {
    _safeLSSet('gb-scores-' + cid, JSON.stringify(scores));
  }
  _broadcastChange(cid, 'scores');
}

/* ══════════════════════════════════════════════════════════════════
   Utilities (unchanged)
   ══════════════════════════════════════════════════════════════════ */
function esc(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function escJs(s) { return (s||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/"/g,'\\"'); }
function initials(st) {
  if (!st) return '??';
  if (typeof st === 'string') {
    const p = (st||'').trim().split(/\s+/);
    if (p.length >= 2) return (p[0][0] + p[p.length-1][0]).toUpperCase();
    return (p[0]||'?').slice(0,2).toUpperCase();
  }
  const f = (st.firstName||'').trim(), l = (st.lastName||'').trim();
  if (f && l) return (f[0] + l[0]).toUpperCase();
  return (f||l||'?').slice(0,2).toUpperCase();
}

/* ── Student Display Helpers ───────────────────────────────── */
function pronounsSelect(id, selected, attrs) {
  return '<select id="'+id+'" class="cm-input cm-pronoun-select" '+(attrs||'')+'>'+
    '<option value="">—</option>'+
    PRONOUNS_OPTIONS.map(function(p){ return '<option'+(p===selected?' selected':'')+'>'+esc(p)+'</option>'; }).join('')+
    '</select>';
}
function fullName(st) { return ((st.firstName||'') + ' ' + (st.lastName||'')).trim(); }
function displayName(st) { return st.preferred || fullName(st); }
function displayNameFirst(st) { return st.preferred || st.firstName || st.lastName || ''; }

function sortStudents(arr, mode, cid) {
  var c = arr.slice();
  if (mode === 'firstName') {
    return c.sort(function(a,b){ return (a.firstName||'').localeCompare(b.firstName||'') || (a.lastName||'').localeCompare(b.lastName||''); });
  }
  if (mode === 'proficiency' && cid) {
    var profMap = {};
    c.forEach(function(st) { profMap[st.id] = getOverallProficiency(cid, st.id) || 0; });
    return c.sort(function(a,b){ return profMap[b.id] - profMap[a.id]; });
  }
  if (mode === 'missing' && cid) {
    var statuses = getAssignmentStatuses(cid);
    var assessments = getAssessments(cid);
    var missingMap = {};
    c.forEach(function(st) {
      missingMap[st.id] = assessments.filter(function(a){ return statuses[st.id + ':' + a.id] === 'NS'; }).length;
    });
    return c.sort(function(a,b){ return missingMap[b.id] - missingMap[a.id]; });
  }
  if (mode === 'lastObserved' && cid) {
    var lastObsMap = {};
    c.forEach(function(st) {
      var obs = getStudentQuickObs(cid, st.id);
      lastObsMap[st.id] = obs.length ? obs[0].created : '';
    });
    return c.sort(function(a,b){ return (lastObsMap[b.id]||'').localeCompare(lastObsMap[a.id]||''); });
  }
  return c.sort(function(a,b){ return (a.lastName||'').localeCompare(b.lastName||'') || (a.firstName||'').localeCompare(b.firstName||''); });
}

function anonymizeStudents(students) {
  var shuffled = students.slice();
  for (var i = shuffled.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = shuffled[i]; shuffled[i] = shuffled[j]; shuffled[j] = tmp;
  }
  return shuffled.map(function(st, idx) {
    return Object.assign({}, st, { _anonLabel: 'Student ' + String(idx+1).padStart(3,'0') });
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
  map.sections.forEach(function(sec) {
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
  Object.keys(overrides).forEach(function(studentId) {
    var studentOverrides = overrides[studentId];
    if (!studentOverrides) return;
    Object.keys(studentOverrides).forEach(function(key) {
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
  Object.keys(goals).forEach(function(studentId) {
    var studentGoals = goals[studentId];
    if (!studentGoals || typeof studentGoals !== 'object') return;
    Object.keys(studentGoals).forEach(function(key) {
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
  Object.keys(reflections).forEach(function(studentId) {
    var studentRefs = reflections[studentId];
    if (!studentRefs || typeof studentRefs !== 'object') return;
    Object.keys(studentRefs).forEach(function(key) {
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
  Object.keys(COURSES).forEach(function(cid) {
    var students = getStudents(cid);
    if (students.length && students.some(function(s){ return s.firstName === undefined; })) {
      _backupBeforeMigration(cid, 'students');
      saveStudents(cid, students.map(migrateStudent));
    }
  });
}
function formatTs(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleDateString('en-CA', { weekday:'short', month:'short', day:'numeric' })
    + ' at ' + d.toLocaleTimeString('en-CA', { hour:'numeric', minute:'2-digit' });
}
function formatDate(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString('en-CA', { month:'short', day:'numeric', year:'numeric' });
}
function uid() { return 's' + Date.now() + Math.random().toString(36).slice(2,10); }
function getParam(key) { return new URLSearchParams(window.location.search).get(key); }

function getTodayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
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
  if (_useSupabase) {
    _syncToSupabase('teacher_config', 'courses', obj);
  } else {
    _safeLSSet('gb-courses', JSON.stringify(obj));
  }
}

let COURSES = loadCourses();
if (!localStorage.getItem('gb-courses') && !_useSupabase) saveCourses(COURSES);

function createCourse(data) {
  const id = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2,5);
  const course = { id, name: data.name || 'Untitled Class', gradingSystem: data.gradingSystem || 'proficiency',
    calcMethod: data.calcMethod || 'mostRecent', decayWeight: data.decayWeight || 0.65,
    description: data.description || '', gradeLevel: data.gradeLevel || '' };
  COURSES[id] = course;
  saveCourses(COURSES);
  saveLearningMap(id, { subjects:[], sections:[], _customized:true, _version:1 });
  // Seed all course data to Supabase so it persists across sessions
  if (_useSupabase) _seedCourseToSupabase(id);
  return course;
}

function updateCourse(id, updates) {
  if (!COURSES[id]) return;
  Object.assign(COURSES[id], updates);
  saveCourses(COURSES);
}

async function deleteCourseData(id) {
  // Delete from Supabase before clearing local state so a failed delete
  // doesn't leave the course gone locally but still alive in the database.
  if (_useSupabase) {
    const sb = getSupabase();
    if (sb) {
      const tables = Object.values(_NORMALIZED_TABLES);
      await Promise.all(tables.map(tbl =>
        sb.from(tbl).delete().eq('teacher_id', _teacherId).eq('course_id', id)
      )).catch(err => console.error('Failed to delete course data from Supabase:', err));
    }
  }

  // Clear localStorage
  ['students','assessments','scores','overrides','courseconfig','learningmap',
   'modules','rubrics','statuses','quick-obs','term-ratings','notes',
   'flags','goals','reflections','custom-tags','report-config']
    .forEach(k => localStorage.removeItem('gb-'+k+'-'+id));

  // Clear cache
  for (const field of Object.keys(_DATA_KEYS)) {
    delete _cache[field][id];
  }

  delete COURSES[id];
  saveCourses(COURSES);
}

/* ── Grading Scale ─────────────────────────────────────────── */
function getGradingScale(cid) {
  const cc = getCourseConfig(cid);
  return cc.gradingScale || DEFAULT_GRADING_SCALE;
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
        script.src = 'curriculum_data.js';
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
      for (const cat of (course.categories || [])) {
        competencyCount += (cat.competencies || []).length;
      }
      results.push({
        short_tag: shortTag,
        course_name: course.course_name,
        subject: course.subject,
        competencyCount: competencyCount,
        categoryCount: (course.categories || []).length,
        statementCount: competencyCount
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

      const shortName = category.name.replace(/\s*\(.*?\)\s*/g, '').split(/\s+and\s+/i)[0].trim();
      const truncShortName = shortName.length > 20 ? shortName.slice(0, 18) + '\u2026' : shortName;

      // Flat format: one section per competency (1:1 section-to-tag)
      for (const comp of category.competencies) {
        let baseId = isHybrid ? (courseTag + '_' + comp.tag) : comp.tag;
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
          shortName: truncShortName
        };
        sections.push({
          id: baseId,
          subject: courseTag,
          name: sectionName,
          shortName: truncShortName,
          color: colour,
          tags: [tag]
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
  } catch (e) { console.warn('LearningMap parse error:', e); }
  if (!map) map = structuredClone(LEARNING_MAP[cid] || { subjects: [], sections: [] });
  // Migrate old nested section/tag format to flat format
  if (!map._flatVersion || map._flatVersion < 2) {
    var sectionToTag = {};
    if (map.sections) {
      map.sections.forEach(function(sec) {
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
  map._customized = true;
  map._version = (map._version || 0) + 1;
  _saveCourseField('learningMaps', cid, map); // derived tag/section caches auto-invalidate via mapRef check
}
function resetLearningMap(cid) {
  _cache.learningMaps[cid] = LEARNING_MAP[cid] || { subjects: [], sections: [] }; // ref change auto-busts tag/section caches
  if (_useSupabase) {
    _deleteFromSupabase('config_learning_maps', { cid });
  } else {
    localStorage.removeItem('gb-learningmap-' + cid);
  }
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
      if (data) { _safeLSSet('gb-modules-' + cid, JSON.stringify(data)); localStorage.removeItem('gb-units-' + cid); }
    }
    return data || [];
  } catch (e) { console.warn('Modules parse fallback:', e); return []; }
}
function saveModules(cid, arr) { _saveCourseField('modules', cid, arr); }
function getModuleById(cid, moduleId) { return getModules(cid).find(u => u.id === moduleId); }

/* ── Assignment Statuses (excused / not-submitted) ─────────── */
function getAssignmentStatuses(cid) {
  if (_cache.statuses[cid] !== undefined) return _cache.statuses[cid];
  try { return JSON.parse(localStorage.getItem('gb-statuses-' + cid)) || {}; } catch (e) { console.warn('Statuses parse fallback:', e); return {}; }
}
function saveAssignmentStatuses(cid, obj) { _saveCourseField('statuses', cid, obj); }
function getAssignmentStatus(cid, sid, aid) { return getAssignmentStatuses(cid)[sid + ':' + aid] || null; }
function setAssignmentStatus(cid, sid, aid, status) {
  const st = getAssignmentStatuses(cid);
  const key = sid + ':' + aid;
  if (status) st[key] = status; else delete st[key];
  saveAssignmentStatuses(cid, st);
}

/* ── Rubrics ───────────────────────────────────────────────── */
function getRubrics(cid) {
  if (_cache.rubrics[cid] !== undefined) return _cache.rubrics[cid];
  try { return JSON.parse(localStorage.getItem('gb-rubrics-' + cid)) || []; } catch (e) { console.warn('Rubrics parse fallback:', e); return []; }
}
function saveRubrics(cid, arr) { _saveCourseField('rubrics', cid, arr); }
function getRubricById(cid, rubricId) { return getRubrics(cid).find(r => r.id === rubricId); }
function deleteRubric(cid, rubricId) {
  saveRubrics(cid, getRubrics(cid).filter(r => r.id !== rubricId));
  const assessments = getAssessments(cid);
  let changed = false;
  assessments.forEach(a => { if (a.rubricId === rubricId) { delete a.rubricId; changed = true; } });
  if (changed) saveAssessments(cid, assessments);
}

/* ── Competency Groups ─────────────────────────────────────── */
function getCompetencyGroups(cid) { return getLearningMap(cid).competencyGroups || []; }
function saveCompetencyGroups(cid, groups) {
  var map = ensureCustomLearningMap(cid);
  map.competencyGroups = groups;
  saveLearningMap(cid, map);
}
function getCompetencyGroupById(cid, gid) { return getCompetencyGroups(cid).find(g => g.id === gid); }
function setSectionGroup(cid, sectionId, groupId) {
  var map = ensureCustomLearningMap(cid);
  var sec = (map.sections || []).find(s => s.id === sectionId);
  if (!sec) return;
  if (groupId) sec.groupId = groupId; else delete sec.groupId;
  saveLearningMap(cid, map);
}
function getGroupedSections(cid) {
  var groups = getCompetencyGroups(cid).slice().sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  var sections = getSections(cid);
  var groupMap = {};
  groups.forEach(g => { groupMap[g.id] = { group: g, sections: [] }; });
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
  var sub = (map.subjects && map.subjects[0]) ? map.subjects[0].id : '';
  var color = (map.subjects && map.subjects[0]) ? map.subjects[0].color : '#6366f1';
  var sec = {
    id: id, subject: opts.subject || sub, name: opts.label || 'Custom Standard',
    shortName: opts.label || 'Custom', color: opts.color || color,
    _custom: true, tags: [{
      id: id, label: opts.label || 'Custom Standard', text: opts.text || '',
      color: opts.color || color, subject: opts.subject || sub,
      name: opts.label || 'Custom Standard', shortName: opts.label || 'Custom',
      i_can_statements: opts.i_can_statements || []
    }]
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
function getSections(cid) { return getLearningMap(cid).sections || []; }
function getSubjects(cid) { return getLearningMap(cid).subjects || []; }

// Cached flat tag list — keyed by learning map object reference so any direct
// write to _cache.learningMaps[cid] (including test setup) naturally busts the cache.
var _allTagsCache = {};    // cid → { mapRef, tags }
function getAllTags(cid) {
  const map = getLearningMap(cid);
  const c = _allTagsCache[cid];
  if (c && c.mapRef === map) return c.tags;
  const tags = (map.sections || []).flatMap(s => s.tags);
  _allTagsCache[cid] = { mapRef: map, tags };
  return tags;
}
function getTagById(cid, tagId) { return getAllTags(cid).find(t => t.id === tagId); }

// Cached tag→section index — O(1) lookup vs O(sections × tags) find() per call.
// getFocusAreas() calls this once per tag; without the index it was O(tags² × sections).
// Same reference-based invalidation as _allTagsCache.
var _tagToSectionCache = {};  // cid → { mapRef, index: { tagId: section } }
function getSectionForTag(cid, tagId) {
  const map = getLearningMap(cid);
  const c = _tagToSectionCache[cid];
  if (!c || c.mapRef !== map) {
    const index = {};
    (map.sections || []).forEach(function(s) {
      s.tags.forEach(function(t) { index[t.id] = s; });
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
  try { return JSON.parse(localStorage.getItem('gb-config'))||{}; } catch (e) { console.warn('Config parse fallback:', e); return {}; }
}
function saveConfig(obj) {
  _cache.config = obj;
  if (_useSupabase) {
    _syncToSupabase('teacher_config', 'config', obj);
  } else {
    _safeLSSet('gb-config', JSON.stringify(obj));
  }
}
function getCourseConfig(cid) {
  if (_cache.courseConfigs[cid] !== undefined) return _cache.courseConfigs[cid];
  try { return JSON.parse(localStorage.getItem('gb-courseconfig-'+cid))||{}; } catch (e) { console.warn('CourseConfig parse fallback:', e); return {}; }
}
function saveCourseConfig(cid, obj) { _saveCourseField('courseConfigs', cid, obj); }
function getStudents(cid) {
  if (_cache.students[cid] !== undefined) return _cache.students[cid];
  try { return (JSON.parse(localStorage.getItem('gb-students-'+cid))||[]).map(migrateStudent); } catch (e) { console.warn('Students parse fallback:', e); return []; }
}
function saveStudents(cid, arr) { _saveCourseField('students', cid, arr); }
function getAssessments(cid) {
  if (_cache.assessments[cid] !== undefined) return _cache.assessments[cid];
  try { return JSON.parse(localStorage.getItem('gb-assessments-'+cid))||[]; } catch (e) { console.warn('Assessments parse fallback:', e); return []; }
}
function saveAssessments(cid, arr) {
  var prev = (_cache.assessments && _cache.assessments[cid]) || [];
  _saveCourseField('assessments', cid, arr);
  if (arr.length < prev.length) _cleanOrphanedScores(cid, arr);
}

function _cleanOrphanedScores(cid, validArr) {
  var validIds = new Set(validArr.map(function(a) { return a.id; }));
  var scores = getScores(cid);
  var changed = false;
  Object.keys(scores).forEach(function(sid) {
    if (!Array.isArray(scores[sid])) return;
    var before = scores[sid].length;
    scores[sid] = scores[sid].filter(function(e) { return validIds.has(e.assessmentId); });
    if (scores[sid].length !== before) changed = true;
  });
  if (changed) saveScores(cid, scores);
}
function getOverrides(cid) {
  if (_cache.overrides[cid] !== undefined) return _cache.overrides[cid];
  try { return JSON.parse(localStorage.getItem('gb-overrides-'+cid))||{}; } catch (e) { console.warn('Overrides parse fallback:', e); return {}; }
}
function saveOverrides(cid, obj) { _saveCourseField('overrides', cid, obj); }
function getNotes(cid) {
  if (_cache.notes[cid] !== undefined) return _cache.notes[cid];
  try { return JSON.parse(localStorage.getItem('gb-notes-'+cid))||{}; } catch (e) { console.warn('Notes parse fallback:', e); return {}; }
}
function saveNotes(cid, obj) { _saveCourseField('notes', cid, obj); }

/*
  Score storage: gb-scores-{courseId}
  { studentId: [ { id, assessmentId, tagId, score(1-4), date, type, note, created } ] }
  Each score entry = one score for one student, one assessment, one tag.
  An assessment with 4 tags produces 4 score entries per student.
*/
function getScores(cid) {
  if (_cache.scores[cid] !== undefined) return _cache.scores[cid];
  try { return JSON.parse(localStorage.getItem('gb-scores-'+cid))||{}; } catch (e) { console.warn('Scores parse fallback:', e); return {}; }
}
function saveScores(cid, obj) { _saveCourseField('scores', cid, obj); }

/* ── Points-mode helpers: one score → all tags ──────────────── */
function getPointsScore(cid, sid, aid) {
  const scores = getScores(cid);
  const entries = scores[sid] || [];
  const entry = entries.find(e => e.assessmentId === aid && e.score > 0);
  return entry ? entry.score : 0;
}
function setPointsScore(cid, sid, aid, rawScore) {
  const assess = getAssessments(cid).find(a => a.id === aid);
  if (!assess) return;
  const tagIds = assess.tagIds || [];
  const scores = getScores(cid);
  if (!scores[sid]) scores[sid] = [];
  let changed = false;
  tagIds.forEach(tid => {
    const entry = scores[sid].find(e => e.assessmentId === aid && e.tagId === tid);
    if (entry) {
      if (entry.score !== rawScore) { entry.score = rawScore; changed = true; }
    } else if (rawScore >= 0) {
      scores[sid].push({ id: uid(), assessmentId: aid, tagId: tid, score: rawScore, date: assess.date || new Date().toISOString().slice(0,10), type: assess.type || 'summative', note: '', created: new Date().toISOString() });
      changed = true;
    }
  });
  if (changed) saveScores(cid, scores);
  return scores;
}

/* ── Active Course ──────────────────────────────────────────── */
function getActiveCourse() {
  const cfg = getConfig();
  if (cfg.activeCourse && COURSES[cfg.activeCourse]) return cfg.activeCourse;
  const ids = Object.keys(COURSES);
  return ids.length > 0 ? ids[0] : null;
}
function setActiveCourse(cid) { saveConfig({ ...getConfig(), activeCourse: cid }); }

/* ── Flags ──────────────────────────────────────────────────── */
function getFlags(cid) {
  if (_cache.flags[cid] !== undefined) return _cache.flags[cid];
  try { return JSON.parse(localStorage.getItem('gb-flags-'+cid))||{}; } catch (e) { console.warn('Flags parse fallback:', e); return {}; }
}
function saveFlags(cid, obj) { _saveCourseField('flags', cid, obj); }
function isStudentFlagged(cid, sid) { return !!getFlags(cid)[sid]; }
function toggleFlag(cid, sid) {
  const flags = getFlags(cid);
  if (flags[sid]) delete flags[sid]; else flags[sid] = true;
  saveFlags(cid, flags);
}

/* ── Goals & Reflections Storage ───────────────────────────── */
function getGoals(cid) {
  if (_cache.goals[cid] !== undefined) return _cache.goals[cid];
  try { return JSON.parse(localStorage.getItem('gb-goals-'+cid))||{}; } catch (e) { console.warn('Goals parse fallback:', e); return {}; }
}
function saveGoals(cid, obj) { _saveCourseField('goals', cid, obj); }

function getReflections(cid) {
  if (_cache.reflections[cid] !== undefined) return _cache.reflections[cid];
  try { return JSON.parse(localStorage.getItem('gb-reflections-'+cid))||{}; } catch (e) { console.warn('Reflections parse fallback:', e); return {}; }
}
function saveReflections(cid, obj) { _saveCourseField('reflections', cid, obj); }

/* ── Quick Observations — in-the-moment capture ─────────── */
function getQuickObs(cid) {
  if (_cache.observations[cid] !== undefined) return _cache.observations[cid];
  try { return JSON.parse(localStorage.getItem('gb-quick-obs-'+cid))||{}; } catch (e) { console.warn('Observations parse fallback:', e); return {}; }
}
function saveQuickObs(cid, obj) { _saveCourseField('observations', cid, obj); }

function getStudentQuickObs(cid, sid) {
  const all = getQuickObs(cid);
  return (all[sid] || []).sort((a,b) => (b.created||'').localeCompare(a.created||''));
}

function getAllQuickObs(cid) {
  const all = getQuickObs(cid);
  const flat = [];
  for (const sid of Object.keys(all)) {
    (all[sid] || []).forEach(ob => flat.push({ ...ob, studentId: sid }));
  }
  return flat.sort((a,b) => (b.created||'').localeCompare(a.created||''));
}

function addQuickOb(cid, sid, text, dims, sentiment, context, assignmentContext) {
  const all = getQuickObs(cid);
  if (!all[sid]) all[sid] = [];
  const entry = {
    id: 'qo_' + Date.now().toString(36) + Math.random().toString(36).slice(2,5),
    text: text.trim(),
    dims: dims || [],
    created: new Date().toISOString(),
    date: getTodayStr()
  };
  if (sentiment) entry.sentiment = sentiment;
  if (context) entry.context = context;
  if (assignmentContext) entry.assignmentContext = assignmentContext;
  all[sid].push(entry);
  _cache.observations[cid] = all;
  if (_useSupabase) {
    _syncToSupabase('obs_row', { cid, obId: entry.id }, {
      teacher_id: _teacherId, course_id: cid, student_id: sid,
      id: entry.id, text: entry.text, dims: entry.dims,
      sentiment: entry.sentiment || null, context: entry.context || null,
      assignment_context: entry.assignmentContext || null,
      date: entry.date, created_at: entry.created
    });
  } else {
    _safeLSSet('gb-quick-obs-' + cid, JSON.stringify(all));
  }
  _broadcastChange(cid, 'observations');
}

function deleteQuickOb(cid, sid, obId) {
  const all = getQuickObs(cid);
  if (!all[sid]) return;
  all[sid] = all[sid].filter(o => o.id !== obId);
  _cache.observations[cid] = all;
  if (_useSupabase) {
    _syncToSupabase('obs_delete', { cid, obId }, null);
  } else {
    _safeLSSet('gb-quick-obs-' + cid, JSON.stringify(all));
  }
  _broadcastChange(cid, 'observations');
}

function updateQuickOb(cid, sid, obId, updates) {
  const all = getQuickObs(cid);
  if (!all[sid]) return;
  const ob = all[sid].find(o => o.id === obId);
  if (!ob) return;
  if (updates.text !== undefined) ob.text = updates.text.trim();
  if (updates.dims !== undefined) ob.dims = updates.dims;
  if (updates.sentiment !== undefined) ob.sentiment = updates.sentiment || null;
  if (updates.context !== undefined) ob.context = updates.context || null;
  ob.modified = new Date().toISOString();
  _cache.observations[cid] = all;
  if (_useSupabase) {
    _syncToSupabase('obs_row', { cid, obId: ob.id }, {
      teacher_id: _teacherId, course_id: cid, student_id: sid,
      id: ob.id, text: ob.text, dims: ob.dims,
      sentiment: ob.sentiment || null, context: ob.context || null,
      assignment_context: ob.assignmentContext || null,
      date: ob.date, created_at: ob.created,
      modified_at: ob.modified
    });
  } else {
    _safeLSSet('gb-quick-obs-' + cid, JSON.stringify(all));
  }
  _broadcastChange(cid, 'observations');
}

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
  try { return JSON.parse(localStorage.getItem('gb-custom-tags-'+cid))||[]; } catch (e) { console.warn('CustomTags parse fallback:', e); return []; }
}
function saveCustomTags(cid, arr) { _saveCourseField('customTags', cid, arr); }
function addCustomTag(cid, label) {
  const tags = getCustomTags(cid);
  const norm = label.trim();
  if (!norm || tags.includes(norm)) return norm;
  tags.push(norm);
  tags.sort((a,b) => a.localeCompare(b));
  saveCustomTags(cid, tags);
  return norm;
}
function removeCustomTag(cid, label) {
  saveCustomTags(cid, getCustomTags(cid).filter(t => t !== label));
}

/* ── Tag resolver — unified display info for any tag type ── */
function resolveTag(tagStr) {
  if (tagStr.startsWith('cc:')) {
    const cc = getCoreCompetency(tagStr.slice(3));
    if (cc) return { key:tagStr, label:cc.label, group:cc.group, color:cc.color, type:'cc' };
    return { key:tagStr, label:tagStr.slice(3), group:'', color:'var(--text-3)', type:'cc' };
  }
  if (tagStr.startsWith('tag:')) {
    return { key:tagStr, label:tagStr.slice(4), group:'Custom', color:'#8b5cf6', type:'custom' };
  }
  if (OBS_LABELS[tagStr]) {
    return { key:tagStr, label:OBS_LABELS[tagStr], icon:OBS_ICONS[tagStr], color:'var(--text-2)', type:'dim' };
  }
  return { key:tagStr, label:tagStr, group:'', color:'var(--text-3)', type:'unknown' };
}

/* ── Term Ratings — end-of-term learner profile ─────────── */
function getTermRatings(cid) {
  if (_cache.termRatings[cid] !== undefined) return _cache.termRatings[cid];
  try { return JSON.parse(localStorage.getItem('gb-term-ratings-'+cid))||{}; } catch (e) { console.warn('TermRatings parse fallback:', e); return {}; }
}
function saveTermRatings(cid, obj) { _saveCourseField('termRatings', cid, obj); }

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
      dims: { engagement:0, collaboration:0, selfRegulation:0, resilience:0, curiosity:0, respect:0 },
      narrative: '',
      created: now,
      modified: now,
      ...data
    };
  }
  saveTermRatings(cid, all);
}

/* ── Report Config ─────────────────────────────────────────── */
function getReportConfig(cid) {
  if (_cache.reportConfig[cid] !== undefined) return _cache.reportConfig[cid];
  try { return JSON.parse(localStorage.getItem('gb-report-config-'+cid)) || null; } catch (e) { console.warn('ReportConfig parse fallback:', e); return null; }
}
function saveReportConfig(cid, config) { _saveCourseField('reportConfig', cid, config); }

/* ── Namespace ──────────────────────────────────────────────── */
var _mobileRerender = null;

window.GB = {
  getSyncStatus,
  getLastSyncedAt,
  retrySyncs,
  refreshFromSupabase: _refreshFromSupabase,
  registerMobileRerender: function(fn) { _mobileRerender = fn; },
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
  getAssessments,
  saveAssessments,
  getOverrides,
  saveOverrides,
  getNotes,
  saveNotes,
  getScores,
  saveScores, upsertScore,
  getPointsScore,
  setPointsScore,
  getActiveCourse,
  setActiveCourse,
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
};

/**
 * Lazily loads seed-data.js and calls seedIfNeeded() — only fetches the 113KB
 * script when actually needed (new accounts, or after explicit data reset).
 * Existing teachers with data already in localStorage never trigger the fetch.
 * Safe to call from any portal — seed-data.js has its own internal guards.
 */
window.loadSeedIfNeeded = function() {
  // Already loaded this session — call directly (handles re-seed after data reset)
  if (typeof seedIfNeeded === 'function') { seedIfNeeded(); return Promise.resolve(); }
  // User deliberately wiped all data — never auto-seed
  if (localStorage.getItem('gb-data-wiped') === '1') return Promise.resolve();
  // Lazy-load the script, then seed
  return new Promise(function(resolve) {
    var s = document.createElement('script');
    s.src = '/shared/seed-data.js';
    s.onload = function() { if (typeof seedIfNeeded === 'function') seedIfNeeded(); resolve(); };
    s.onerror = resolve;
    document.head.appendChild(s);
  });
};
