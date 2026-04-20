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
  v2Gradebook: {}, // keyed by cid — raw get_gradebook(cid) payload (Phase 3.4+)
};

// Mapping from cache field → localStorage key suffix (and Supabase data_key)
const _DATA_KEYS = {
  students: 'students',
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
};

let _useSupabase = false;
let _teacherId = null;
let _initPromise = null; // dedup concurrent initData calls

/* Echo guard: suppress Realtime refetches for a field+cid shortly after a local save.
   Prevents Realtime events from triggering a refetch that could see partial state
   while an UPSERT batch is still in-flight. */
const _echoGuard = {}; // key: "field:cid" → expiry timestamp
const _ECHO_GUARD_MS = 35000; // suppress echoes for 35s after save (must exceed _SYNC_TIMEOUT_MS)

function _setEchoGuard(field, cid) {
  _echoGuard[field + ':' + cid] = Date.now() + _ECHO_GUARD_MS;
}
function _isEchoGuarded(field, cid) {
  var key = field + ':' + cid;
  var expiry = _echoGuard[key];
  if (!expiry) return false;
  if (Date.now() < expiry) return true;
  delete _echoGuard[key];
  return false;
}

/* ══════════════════════════════════════════════════════════════════
   Sync status tracking
   ══════════════════════════════════════════════════════════════════ */
let _syncStatus = 'idle';
let _pendingSyncs = 0;
let _lastSyncedAt = null;

function getSyncStatus() {
  return { status: _syncStatus, pending: _pendingSyncs };
}

function getLastSyncedAt() {
  return _lastSyncedAt;
}

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
  dot.title =
    s.status === 'idle'
      ? 'All changes saved'
      : s.status === 'syncing'
        ? 'Syncing...'
        : 'Sync error — changes saved locally';
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
    _crossTabChannel.onmessage = function (e) {
      if (e.data && e.data.type === 'data-changed') {
        _handleCrossTabChange(e.data.cid, e.data.field);
      }
    };
  } catch (e) {
    // BroadcastChannel not supported — fall back to storage event
  }
  // Fallback: storage event fires cross-tab when localStorage changes
  window.addEventListener('storage', function (e) {
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
        toast.innerHTML =
          '<span>Data changed in another tab</span><button class="sync-toast-btn" data-action="reload-cross-tab">Reload</button>';
        document.body.appendChild(toast);
      }
    }
  });

  // Delegated click handler for cross-tab reload buttons (storage fallback only)
  document.addEventListener('click', function (e) {
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

  // CANONICAL-RPC TRANSITION: skip the remote refetch (legacy tables don't exist).
  // Cross-tab still sees the localStorage update via the BroadcastChannel listener.
  return;
  // eslint-disable-next-line no-unreachable
  // Re-fetch from the appropriate normalized table
  if (_useSupabase) {
    try {
      var sb = getSupabase();
      var normTable = _NORMALIZED_TABLES[field];
      if (normTable) {
        var result = await _selectCourseTable(sb, normTable, _teacherId, cid);
        if (!result.error && result.data) {
          if (_getConfigTableSet().has(normTable)) {
            _cache[field][cid] = result.data.length > 0 ? result.data[0].data : _defaultForField(field);
          } else if (_BULK_LOAD_CONVERTERS[normTable]) {
            _cache[field][cid] = _BULK_LOAD_CONVERTERS[normTable](result.data);
          } else if (field === 'scores') {
            var newScores = _scoreRowsToBlob(result.data);
            if (_shouldSkipEntryShrink(field, _cache[field][cid], newScores, 'Cross-tab refetch')) return;
            _cache[field][cid] = newScores;
          } else if (field === 'observations') {
            var newObs = _obsRowsToBlob(result.data);
            if (_shouldSkipEntryShrink(field, _cache[field][cid], newObs, 'Cross-tab refetch')) return;
            _cache[field][cid] = newObs;
          } else if (field === 'assessments') {
            _cache[field][cid] = _assessmentRowsToBlob(result.data);
          } else if (field === 'students') {
            var newStudents = _studentRowsToBlob(result.data).map(migrateStudent);
            var curStudents = _cache[field][cid];
            // Never-shrink guard
            if (Array.isArray(curStudents) && curStudents.length > 0 && newStudents.length < curStudents.length * 0.5) {
              console.warn(
                'Cross-tab students refetch returned',
                newStudents.length,
                'vs',
                curStudents.length,
                'in cache — skipping',
              );
            } else {
              _cache[field][cid] = newStudents;
            }
          }
        }
      }
    } catch (e) {
      /* fall through — cache stays as-is */
    }
  }

  // Clear proficiency cache if relevant field changed
  if (_PROF_FIELDS.includes(field) && typeof clearProfCache === 'function') clearProfCache();

  // Clear tag/section caches if learning map changed
  if (field === 'learningMaps') {
    _allTagsCache = {};
    _tagToSectionCache = {};
  }

  // Re-render current page if it has a render() method
  var currentPage = typeof Router !== 'undefined' && Router.getCurrentPage ? Router.getCurrentPage() : null;
  if (currentPage && currentPage.render) {
    try {
      currentPage.render();
    } catch (e) {
      /* page may not be ready */
    }
  }
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

/* ══════════════════════════════════════════════════════════════════
   Supabase sync helpers (fire-and-forget with coalescing)
   ══════════════════════════════════════════════════════════════════ */
let _hadSyncError = false;
let _retryQueue = []; // { table, key, data }
let _retryTimer = null;
let _lsQuotaWarned = false;
let _beforeUnloadBound = false;
let _retryCount = 0;
let _consecutiveFailures = 0;
const _MAX_RETRIES = 6;
const _MAX_RETRY_QUEUE = 100;
const _SYNC_TIMEOUT_MS = 30000; // 30s — bulk upserts of 2000+ rows need headroom on mobile

/* Track in-flight and pending syncs per key to coalesce rapid saves */
const _inflightSyncs = new Map(); // syncKey → true (currently in-flight)
const _pendingWrites = new Map(); // syncKey → { table, key, data } (queued behind in-flight)

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
  // Snapshot data so later in-place mutations can't corrupt the queued write
  if (_inflightSyncs.has(sk)) {
    var pendingSnapshot =
      typeof structuredClone === 'function' ? structuredClone(data) : JSON.parse(JSON.stringify(data));
    _pendingWrites.set(sk, { table, key, data: pendingSnapshot });
    return;
  }

  _inflightSyncs.set(sk, true);
  _doSync(table, key, data)
    .catch(err => console.error(`Sync error (${sk}):`, err))
    .finally(() => {
      _inflightSyncs.delete(sk);
      // If a newer write arrived while we were in-flight, send it now
      if (_pendingWrites.has(sk)) {
        const next = _pendingWrites.get(sk);
        _pendingWrites.delete(sk);
        // Refresh echo guard so the queued sync's Realtime echoes are suppressed
        if (next.key && next.key.cid) {
          for (var _f in _NORMALIZED_TABLES) {
            if (_NORMALIZED_TABLES[_f] === next.table) {
              _setEchoGuard(_f, next.key.cid);
              break;
            }
          }
        }
        _syncToSupabase(next.table, next.key, next.data);
      }
    });
}

async function _doSync(table, key, data) {
  const sb = getSupabase();
  if (!sb || !_teacherId) return;

  // CANONICAL-RPC TRANSITION: the legacy public-schema tables this function writes to
  // (scores, observations, assessments, students, teacher_config, config_*, etc.) were
  // dropped by the April 3 canonical_schema_foundation migration. Until each table's
  // sync path is rewritten to call its canonical RPC (save_course_score,
  // create_observation, save_course_policy, save_learning_map, save_report_config, ...),
  // run as localStorage-only and surface the offline state. localStorage writes happen
  // separately in _saveCourseField — this only suppresses the failing remote writes.
  _syncStatus = 'offline';
  _updateSyncIndicator();
  return;

  _pendingSyncs++;
  _syncStatus = 'syncing';
  _updateSyncIndicator();

  // AbortController for request timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), _SYNC_TIMEOUT_MS);

  try {
    if (table === 'scores') {
      // Safe sync: UPSERT all current rows + DELETE only removed rows.
      // Never delete-all — a failed INSERT after delete-all loses all grades.
      const rows = _scoreBlobToRows(key.cid, data);
      const currentKeys = new Set(rows.map(r => r.student_id + ':' + r.assessment_id + ':' + r.tag_id));

      // 1. Fetch existing row keys from DB to find what to delete
      const { data: existing, error: fetchErr } = await sb
        .from('scores')
        .select('student_id,assessment_id,tag_id')
        .eq('teacher_id', _teacherId)
        .eq('course_id', key.cid)
        .abortSignal(controller.signal);
      if (fetchErr) throw fetchErr;

      // 2. UPSERT all current rows (safe — inserts or updates, never deletes)
      if (rows.length > 0) {
        // Batch in chunks of 500 to stay within Supabase payload limits
        for (let i = 0; i < rows.length; i += 500) {
          const chunk = rows.slice(i, i + 500);
          const { error: upsertErr } = await sb
            .from('scores')
            .upsert(chunk, {
              onConflict: 'teacher_id,course_id,student_id,assessment_id,tag_id',
            })
            .abortSignal(controller.signal);
          if (upsertErr) throw upsertErr;
        }
      }

      // 3. DELETE only rows that were removed — batch by (assessment_id, tag_id) to minimize requests
      const toDelete = (existing || []).filter(
        r => !currentKeys.has(r.student_id + ':' + r.assessment_id + ':' + r.tag_id),
      );
      if (toDelete.length > 0) {
        const deleteGroups = new Map();
        for (const d of toDelete) {
          const gk = d.assessment_id + ':' + d.tag_id;
          if (!deleteGroups.has(gk))
            deleteGroups.set(gk, { assessment_id: d.assessment_id, tag_id: d.tag_id, student_ids: [] });
          deleteGroups.get(gk).student_ids.push(d.student_id);
        }
        for (const g of deleteGroups.values()) {
          for (let i = 0; i < g.student_ids.length; i += 500) {
            const chunk = g.student_ids.slice(i, i + 500);
            const { error: delErr } = await sb
              .from('scores')
              .delete()
              .eq('teacher_id', _teacherId)
              .eq('course_id', key.cid)
              .eq('assessment_id', g.assessment_id)
              .eq('tag_id', g.tag_id)
              .in('student_id', chunk)
              .abortSignal(controller.signal);
            if (delErr) throw delErr;
          }
        }
      }
    } else if (table === 'observations') {
      // Safe sync: UPSERT + targeted DELETE (same pattern as scores)
      const obsRows = _obsBlobToRows(key.cid, data);
      const currentIds = new Set(obsRows.map(r => r.id));

      const { data: existingObs, error: fetchErr } = await sb
        .from('observations')
        .select('id')
        .eq('teacher_id', _teacherId)
        .eq('course_id', key.cid)
        .abortSignal(controller.signal);
      if (fetchErr) throw fetchErr;

      if (obsRows.length > 0) {
        for (let i = 0; i < obsRows.length; i += 500) {
          const chunk = obsRows.slice(i, i + 500);
          const { error: upsertErr } = await sb
            .from('observations')
            .upsert(chunk, {
              onConflict: 'teacher_id,course_id,id',
            })
            .abortSignal(controller.signal);
          if (upsertErr) throw upsertErr;
        }
      }

      const obsToDelete = (existingObs || []).filter(r => !currentIds.has(r.id));
      for (let i = 0; i < obsToDelete.length; i += 500) {
        const chunk = obsToDelete.slice(i, i + 500).map(r => r.id);
        const { error: delErr } = await sb
          .from('observations')
          .delete()
          .eq('teacher_id', _teacherId)
          .eq('course_id', key.cid)
          .in('id', chunk)
          .abortSignal(controller.signal);
        if (delErr) throw delErr;
      }
    } else if (table === 'obs_row') {
      // Single observation upsert
      const { error } = await sb
        .from('observations')
        .upsert(data, {
          onConflict: 'teacher_id,course_id,id',
        })
        .abortSignal(controller.signal);
      if (error) throw error;
    } else if (table === 'obs_delete') {
      // Single observation delete
      const { error } = await sb
        .from('observations')
        .delete()
        .eq('teacher_id', _teacherId)
        .eq('course_id', key.cid)
        .eq('id', key.obId)
        .abortSignal(controller.signal);
      if (error) throw error;
    } else if (table === 'scores_row') {
      // Single score upsert — the efficient hot path
      const { error } = await sb
        .from('scores')
        .upsert(data, {
          onConflict: 'teacher_id,course_id,student_id,assessment_id,tag_id',
        })
        .abortSignal(controller.signal);
      if (error) throw error;
    } else if (table === 'assessments') {
      // Safe sync: UPSERT + targeted DELETE
      const aRows = _assessmentsBlobToRows(key.cid, data);
      const currentIds = new Set(aRows.map(r => r.id));

      const { data: existingA, error: fetchErr } = await sb
        .from('assessments')
        .select('id')
        .eq('teacher_id', _teacherId)
        .eq('course_id', key.cid)
        .abortSignal(controller.signal);
      if (fetchErr) throw fetchErr;

      if (aRows.length > 0) {
        for (let i = 0; i < aRows.length; i += 500) {
          const chunk = aRows.slice(i, i + 500);
          const { error: upsertErr } = await sb
            .from('assessments')
            .upsert(chunk, {
              onConflict: 'teacher_id,course_id,id',
            })
            .abortSignal(controller.signal);
          if (upsertErr) throw upsertErr;
        }
      }

      const aToDelete = (existingA || []).filter(r => !currentIds.has(r.id));
      for (let i = 0; i < aToDelete.length; i++) {
        const { error: delErr } = await sb
          .from('assessments')
          .delete()
          .eq('teacher_id', _teacherId)
          .eq('course_id', key.cid)
          .eq('id', aToDelete[i].id)
          .abortSignal(controller.signal);
        if (delErr) throw delErr;
      }
    } else if (table === 'students') {
      // Safe sync: UPSERT + targeted DELETE
      const sRows = _studentsBlobToRows(key.cid, data);
      const currentIds = new Set(sRows.map(r => r.id));

      const { data: existingS, error: fetchErr } = await sb
        .from('students')
        .select('id')
        .eq('teacher_id', _teacherId)
        .eq('course_id', key.cid)
        .abortSignal(controller.signal);
      if (fetchErr) throw fetchErr;

      if (sRows.length > 0) {
        for (let i = 0; i < sRows.length; i += 500) {
          const chunk = sRows.slice(i, i + 500);
          const { error: upsertErr } = await sb
            .from('students')
            .upsert(chunk, {
              onConflict: 'teacher_id,course_id,id',
            })
            .abortSignal(controller.signal);
          if (upsertErr) throw upsertErr;
        }
      }

      const sToDelete = (existingS || []).filter(r => !currentIds.has(r.id));
      for (let i = 0; i < sToDelete.length; i++) {
        const { error: delErr } = await sb
          .from('students')
          .delete()
          .eq('teacher_id', _teacherId)
          .eq('course_id', key.cid)
          .eq('id', sToDelete[i].id)
          .abortSignal(controller.signal);
        if (delErr) throw delErr;
      }
    } else if (_BULK_SYNC_CONVERTERS[table]) {
      // Safe sync: UPSERT + targeted DELETE for medium-frequency tables
      const convFn = _BULK_SYNC_CONVERTERS[table];
      const bulkRows = convFn(key.cid, data);

      // Determine the primary key column(s) for this table
      const pkMap = {
        goals: {
          pk: 'student_id,tag_id',
          keyCols: ['student_id', 'tag_id'],
          keyFn: r => r.student_id + ':' + r.tag_id,
        },
        reflections: {
          pk: 'student_id,tag_id',
          keyCols: ['student_id', 'tag_id'],
          keyFn: r => r.student_id + ':' + r.tag_id,
        },
        overrides: {
          pk: 'student_id,tag_id',
          keyCols: ['student_id', 'tag_id'],
          keyFn: r => r.student_id + ':' + r.tag_id,
        },
        statuses: {
          pk: 'student_id,assessment_id',
          keyCols: ['student_id', 'assessment_id'],
          keyFn: r => r.student_id + ':' + r.assessment_id,
        },
        student_notes: { pk: 'student_id', keyCols: ['student_id'], keyFn: r => r.student_id },
        student_flags: { pk: 'student_id', keyCols: ['student_id'], keyFn: r => r.student_id },
        term_ratings: {
          pk: 'student_id,term_id',
          keyCols: ['student_id', 'term_id'],
          keyFn: r => r.student_id + ':' + r.term_id,
        },
      };
      const info = pkMap[table];
      if (info) {
        const currentKeys = new Set(bulkRows.map(info.keyFn));
        const selectCols = info.keyCols.join(',');
        const { data: existingRows, error: fetchErr } = await sb
          .from(table)
          .select(selectCols)
          .eq('teacher_id', _teacherId)
          .eq('course_id', key.cid)
          .abortSignal(controller.signal);
        if (fetchErr) throw fetchErr;

        if (bulkRows.length > 0) {
          for (let i = 0; i < bulkRows.length; i += 500) {
            const chunk = bulkRows.slice(i, i + 500);
            const { error: upsertErr } = await sb
              .from(table)
              .upsert(chunk, {
                onConflict: 'teacher_id,course_id,' + info.pk,
              })
              .abortSignal(controller.signal);
            if (upsertErr) throw upsertErr;
          }
        }

        const rowsToDelete = (existingRows || []).filter(r => !currentKeys.has(info.keyFn(r)));
        for (let i = 0; i < rowsToDelete.length; i++) {
          const d = rowsToDelete[i];
          let q = sb.from(table).delete().eq('teacher_id', _teacherId).eq('course_id', key.cid);
          info.keyCols.forEach(col => {
            q = q.eq(col, d[col]);
          });
          const { error: delErr } = await q.abortSignal(controller.signal);
          if (delErr) throw delErr;
        }
      } else {
        // Fallback for unknown tables: upsert all (no delete)
        if (bulkRows.length > 0) {
          for (let i = 0; i < bulkRows.length; i += 500) {
            const chunk = bulkRows.slice(i, i + 500);
            const { error: insErr } = await sb.from(table).upsert(chunk).abortSignal(controller.signal);
            if (insErr) throw insErr;
          }
        }
      }
    } else if (_getConfigTableSet().has(table)) {
      // Config tables: single JSONB blob per course, upsert
      const { error } = await sb
        .from(table)
        .upsert(
          {
            teacher_id: _teacherId,
            course_id: key.cid,
            data: data,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'teacher_id,course_id' },
        )
        .abortSignal(controller.signal);
      if (error) throw error;
    } else if (table === 'teacher_config') {
      const { error } = await sb
        .from('teacher_config')
        .upsert(
          {
            teacher_id: _teacherId,
            config_key: key,
            data: data,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'teacher_id,config_key' },
        )
        .abortSignal(controller.signal);
      if (error) throw error;
    }
    clearTimeout(timeoutId);
    _pendingSyncs--;
    _consecutiveFailures = 0;
    if (_pendingSyncs <= 0) {
      _pendingSyncs = 0;
      _syncStatus = 'idle';
      _retryCount = 0;
      _lastSyncedAt = new Date();
    }
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
      if (typeof showSyncToast === 'function')
        showSyncToast('Server overloaded \u2014 retries paused, data safe locally', 'error');
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
    // Don't drop the queue — keep it in localStorage so it can be retried
    // on next page load or manual retry. Only reset counters.
    console.error(
      '[GUARD] Sync retry limit reached.',
      _retryQueue.length,
      'items preserved in localStorage for recovery. Call retrySyncs() to retry.',
    );
    _retryCount = 0;
    _consecutiveFailures = 0;
    if (typeof showSyncToast === 'function')
      showSyncToast('Sync retries exhausted — data safe locally, will retry on reload', 'error');
    return;
  }
  // Process one at a time to avoid hammering the server
  const queue = _retryQueue.splice(0);
  if (queue.length === 0) {
    localStorage.removeItem('gb-retry-queue');
    return;
  }
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
  // CANONICAL-RPC TRANSITION: legacy tables this would delete from don't exist.
  // Course deletion is handled locally; canonical equivalent (when added) will
  // call delete_course() / withdraw_enrollment() / delete_assessment() etc.
  return;
}

/* ══════════════════════════════════════════════════════════════════
   Initialization — call once per page load (or on course switch)
   ══════════════════════════════════════════════════════════════════ */

/** Load global data (courses + config). Call before initData(). */
async function initAllCourses() {
  // Demo mode: hard-skip Supabase, force local-only, ensure seed data exists.
  // Set by the "Try Demo Mode" button on the login page.
  var _demoMode = localStorage.getItem('gb-demo-mode') === '1';
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
  //     Creates teacher + teacher_preference + Welcome Class on first sign-in;
  //     returns existing rows on subsequent sign-ins.
  //   list_teacher_courses() → [{ id, name, grade_level, description, color,
  //     is_archived, display_order, grading_system, calc_method, decay_weight,
  //     timezone, late_work_policy, created_at, updated_at }, ...]
  // On any failure fall back to localStorage so the app still loads offline.
  if (_useSupabase) {
    const sb = getSupabase();
    try {
      const {
        data: { session },
      } = await sb.auth.getSession();
      const email = (session && session.user && session.user.email) || '';
      const displayName = (session && session.user && session.user.user_metadata && session.user.user_metadata.display_name) || null;

      const bootRes = await sb.rpc('bootstrap_teacher', {
        p_email: email,
        p_display_name: displayName,
      });
      if (bootRes.error) throw bootRes.error;
      const teacher = bootRes.data || {};
      const prefs = teacher.preferences || {};
      _teacherId = teacher.id || _teacherId;

      const coursesRes = await sb.rpc('list_teacher_courses');
      if (coursesRes.error) throw coursesRes.error;

      _cache.courses = _canonicalCoursesToBlob(coursesRes.data || []);
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
      _syncStatus = 'idle';
      _updateSyncIndicator();
    } catch (e) {
      console.warn('v2 course load failed, falling back to localStorage:', e);
      _useSupabase = false;
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

  try {
    // v2 TRANSITION (Phase 3.3): any queued retries are aimed at dropped
    // legacy tables (scores/observations/assessments/students/teacher_config).
    // Draining them would spam errors against v2. Discard until write paths
    // are ported (Phases 3.5 + 4.x), at which point a fresh queue will form
    // from live user actions.
    if (!window.__V2_WRITE_PATHS_READY) {
      localStorage.removeItem('gb-retry-queue');
    } else {
      var savedQueue = JSON.parse(localStorage.getItem('gb-retry-queue') || '[]').filter(function (item) {
        return item && item.table && item.key;
      });
      if (savedQueue.length > 0 && _useSupabase) {
        _retryQueue = savedQueue;
        setTimeout(_retryFailedSyncs, 2000);
      } else {
        localStorage.removeItem('gb-retry-queue');
      }
    }
  } catch (e) {
    localStorage.removeItem('gb-retry-queue');
  }

  if (!_beforeUnloadBound) {
    _beforeUnloadBound = true;
    window.addEventListener('beforeunload', function () {
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
  // CANONICAL-RPC TRANSITION: supabase_realtime publication was emptied by the
  // April 17 zero_data_publication migration — none of the legacy public tables
  // this function subscribed to (scores, observations, assessments, students,
  // and the medium-frequency / config tables) emit postgres_changes events any
  // more (they don't exist). Cross-device sync is out of scope until the
  // canonical schema gets its own publication strategy. Cross-tab sync via
  // BroadcastChannel still works (see _initCrossTab).
  return;
  // eslint-disable-next-line no-unreachable
  if (_realtimeChannel || !_useSupabase || !_teacherId) return;
  var sb = getSupabase();
  if (!sb) return;

  /* Debounced re-fetch for high-frequency tables.
     Instead of processing individual DELETE/INSERT events (which is fragile
     with the delete-all + insert-all sync pattern), we re-fetch the full
     table from Supabase on any change — same safe approach used by
     medium-frequency tables. Debounced so a flood of WAL events from a
     bulk sync only triggers one re-fetch. */
  var _realtimeRefetchTimers = {};
  function _debouncedRefetch(field, supabaseTable, cid, converter) {
    // Skip echoes from our own delete-all + insert-all sync
    if (_isEchoGuarded(field, cid)) return;
    var key = field + ':' + cid;
    if (_realtimeRefetchTimers[key]) clearTimeout(_realtimeRefetchTimers[key]);
    _realtimeRefetchTimers[key] = setTimeout(function () {
      delete _realtimeRefetchTimers[key];
      // Re-check guard (may have been set while debounce waited)
      if (_isEchoGuarded(field, cid)) return;
      var sb2 = getSupabase();
      if (!sb2) return;
      _selectCourseTable(sb2, supabaseTable, _teacherId, cid).then(function (res) {
        if (res.error || !res.data) return;
        var newData = converter(res.data);
        if (!_hasDataChanged(newData, _cache[field][cid])) return;
        // Never-shrink guard: if the remote result is smaller than the local
        // cache, it may have caught the DB mid-sync. Skip to avoid data loss.
        // Applies to both array-shaped (students, assessments) and object-shaped (scores) data.
        var existing = _cache[field][cid];
        if (Array.isArray(existing) && Array.isArray(newData)) {
          if (existing.length > 0 && newData.length < existing.length * 0.8) {
            console.warn(
              '[GUARD] Realtime refetch for',
              field,
              'returned',
              newData.length,
              'items vs',
              existing.length,
              'in cache — skipping (likely mid-sync snapshot)',
            );
            return;
          }
        }
        if (_shouldSkipEntryShrink(field, existing, newData, 'Realtime refetch')) return;
        if (field === 'students' || field === 'scores') {
          console.warn(
            '[DIAG] Realtime refetch replacing cache.' + field + '[' + cid + ']',
            'old=' + _countFieldItems(field, existing),
            'new=' + _countFieldItems(field, newData),
          );
        }
        _cache[field][cid] = newData;
        _invalidateAndRerender();
      });
    }, 500);
  }

  try {
    _realtimeChannel = sb
      .channel('course-data-sync')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'observations',
          filter: 'teacher_id=eq.' + _teacherId,
        },
        function (payload) {
          var row = payload.new || payload.old;
          if (!row || !row.course_id) return;
          _debouncedRefetch('observations', 'observations', row.course_id, _obsRowsToBlob);
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'scores',
          filter: 'teacher_id=eq.' + _teacherId,
        },
        function (payload) {
          var row = payload.new || payload.old;
          if (!row || !row.course_id) return;
          _debouncedRefetch('scores', 'scores', row.course_id, _scoreRowsToBlob);
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'assessments',
          filter: 'teacher_id=eq.' + _teacherId,
        },
        function (payload) {
          var row = payload.new || payload.old;
          if (!row || !row.course_id) return;
          _debouncedRefetch('assessments', 'assessments', row.course_id, _assessmentRowsToBlob);
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'students',
          filter: 'teacher_id=eq.' + _teacherId,
        },
        function (payload) {
          var row = payload.new || payload.old;
          if (!row || !row.course_id) return;
          _debouncedRefetch('students', 'students', row.course_id, function (rows) {
            return _studentRowsToBlob(rows).map(migrateStudent);
          });
        },
      );

    // Medium-frequency tables: on any change, re-fetch full table for course
    var _medTables = Object.values(_MEDIUM_FREQ_TABLES);
    _medTables.forEach(function (tblName) {
      _realtimeChannel = _realtimeChannel.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: tblName,
          filter: 'teacher_id=eq.' + _teacherId,
        },
        function (payload) {
          var row = payload.new || payload.old;
          if (!row || !row.course_id) return;
          var cid = row.course_id;
          // Find the cache field for this table
          var cacheField = null;
          for (var f in _MEDIUM_FREQ_TABLES) {
            if (_MEDIUM_FREQ_TABLES[f] === tblName) {
              cacheField = f;
              break;
            }
          }
          if (!cacheField) return;
          // Re-fetch entire table for this course (medium-freq = small data, simple approach)
          var sb2 = getSupabase();
          if (!sb2) return;
          _selectCourseTable(sb2, tblName, _teacherId, cid).then(function (res) {
            if (res.error || !res.data) return;
            var conv = _BULK_LOAD_CONVERTERS[tblName];
            if (!conv) return;
            var newBlob = conv(res.data);
            if (!_hasDataChanged(newBlob, _cache[cacheField][cid])) return;
            _cache[cacheField][cid] = newBlob;
            _invalidateAndRerender();
          });
        },
      );
    });

    // Config tables: on any change, update cache from JSONB data column
    Object.keys(_CONFIG_TABLES).forEach(function (cfgField) {
      var cfgTblName = _CONFIG_TABLES[cfgField];
      _realtimeChannel = _realtimeChannel.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: cfgTblName,
          filter: 'teacher_id=eq.' + _teacherId,
        },
        function (payload) {
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
        },
      );
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
var _VISIBILITY_DEBOUNCE = 3000; // Don't re-fetch more than once per 3 seconds

function _initVisibilityRefresh() {
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible') return;
    var now = Date.now();
    if (now - _lastVisibilityRefresh < _VISIBILITY_DEBOUNCE) return;
    _lastVisibilityRefresh = now;
    // _refreshFromSupabase handles re-establishing lost connections internally
    _refreshFromSupabase();
  });
}

async function _refreshFromSupabase() {
  // CANONICAL-RPC TRANSITION: visibility-refresh path queries dropped legacy tables.
  // Until the per-RPC reads land we no-op here; cache stays as last loaded from
  // localStorage. Cross-device sync resumes once each canonical read RPC is wired up.
  return;
  // eslint-disable-next-line no-unreachable
  var cid = null;
  try {
    cid = getActiveCourse();
  } catch (e) {
    return;
  }
  if (!cid) return;

  var sb = getSupabase();
  if (!sb) return;

  // Re-establish Supabase connection if it was lost (e.g. transient error during boot)
  if (!_teacherId || !_useSupabase) {
    try {
      var sess = await sb.auth.getSession();
      if (sess && sess.data && sess.data.session && sess.data.session.user) {
        _teacherId = sess.data.session.user.id;
        _useSupabase = true;
        _initRealtimeSync(); // start live updates if skipped during boot
      } else {
        return; // No valid session — can't refresh
      }
    } catch (e) {
      return;
    }
  }

  try {
    var changed = false;
    var profChanged = false;
    var tagsChanged = false;

    // Refresh all normalized tables in parallel
    var since = _lastSyncedAt ? new Date(_lastSyncedAt.getTime() - 30000).toISOString() : null;
    function _rq(tbl, tsCol) {
      return _selectCourseTable(sb, tbl, _teacherId, cid, since ? { gtColumn: tsCol, gtValue: since } : null);
    }
    var [
      scoreResult,
      obsResult,
      assessResult,
      studResult,
      goalsRefRes,
      reflRefRes,
      overRefRes,
      statusRefRes,
      notesRefRes,
      flagsRefRes,
      trRefRes,
      cfgLmRefRes,
      cfgCourseRefRes,
      cfgModRefRes,
      cfgRubRefRes,
      cfgTagRefRes,
      cfgRepRefRes,
    ] = await Promise.all([
      _rq('scores', 'updated_at'),
      _rq('observations', 'modified_at'),
      _rq('assessments', 'updated_at'),
      _rq('students', 'updated_at'),
      _rq('goals', 'updated_at'),
      _rq('reflections', 'updated_at'),
      _rq('overrides', 'updated_at'),
      _rq('statuses', 'updated_at'),
      _rq('student_notes', 'updated_at'),
      _rq('student_flags', 'updated_at'),
      _rq('term_ratings', 'updated_at'),
      _rq('config_learning_maps', 'updated_at'),
      _rq('config_course', 'updated_at'),
      _rq('config_modules', 'updated_at'),
      _rq('config_rubrics', 'updated_at'),
      _rq('config_custom_tags', 'updated_at'),
      _rq('config_report', 'updated_at'),
    ]);

    if (!scoreResult.error && scoreResult.data && scoreResult.data.length > 0) {
      var blob = _cache.scores[cid] || {};
      scoreResult.data.forEach(function (r) {
        if (!blob[r.student_id]) blob[r.student_id] = [];
        var arr = blob[r.student_id];
        var idx = arr.findIndex(function (e) {
          return e.assessmentId === r.assessment_id && e.tagId === r.tag_id;
        });
        var entry = {
          id: r.student_id + ':' + r.assessment_id + ':' + r.tag_id,
          assessmentId: r.assessment_id,
          tagId: r.tag_id,
          score: r.score,
          date: r.date,
          type: r.type || 'summative',
          note: r.note || '',
          created: r.created_at || new Date().toISOString(),
        };
        if (idx !== -1) {
          arr[idx] = entry;
        } else {
          arr.push(entry);
        }
      });
      _cache.scores[cid] = blob;
      changed = true;
      profChanged = true;
    }

    if (!obsResult.error && obsResult.data && obsResult.data.length > 0) {
      var obsBlob = _cache.observations[cid] || {};
      obsResult.data.forEach(function (r) {
        if (!obsBlob[r.student_id]) obsBlob[r.student_id] = [];
        var arr = obsBlob[r.student_id];
        var idx = arr.findIndex(function (o) {
          return o.id === r.id;
        });
        var entry = { id: r.id, text: r.text || '', dims: r.dims || [], created: r.created_at, date: r.date };
        if (r.sentiment) entry.sentiment = r.sentiment;
        if (r.context) entry.context = r.context;
        if (r.assignment_context) entry.assignmentContext = r.assignment_context;
        if (r.modified_at) entry.modified = r.modified_at;
        if (idx !== -1) {
          arr[idx] = entry;
        } else {
          arr.push(entry);
        }
      });
      _cache.observations[cid] = obsBlob;
      changed = true;
    }

    if (!assessResult.error && assessResult.data && assessResult.data.length > 0) {
      var currentAssess = _cache.assessments[cid] || [];
      assessResult.data.forEach(function (r) {
        var idx = currentAssess.findIndex(function (a) {
          return a.id === r.id;
        });
        var entry = _assessmentRowsToBlob([r])[0];
        if (idx !== -1) {
          currentAssess[idx] = entry;
        } else {
          currentAssess.push(entry);
        }
      });
      _cache.assessments[cid] = currentAssess;
      changed = true;
      profChanged = true;
    }

    if (!studResult.error && studResult.data && studResult.data.length > 0) {
      var currentStudents = _cache.students[cid] || [];
      studResult.data.forEach(function (r) {
        var idx = currentStudents.findIndex(function (s) {
          return s.id === r.id;
        });
        var entry = _studentRowsToBlob([r])[0];
        if (idx !== -1) {
          currentStudents[idx] = entry;
        } else {
          currentStudents.push(migrateStudent(entry));
        }
      });
      _cache.students[cid] = currentStudents;
      changed = true;
    }

    // Refresh medium-frequency normalized tables (full replace on visibility change)
    var _medRefResults = {
      goals: goalsRefRes,
      reflections: reflRefRes,
      overrides: overRefRes,
      statuses: statusRefRes,
      notes: notesRefRes,
      flags: flagsRefRes,
      termRatings: trRefRes,
    };
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
    var _cfgRefResults = {
      learningMaps: cfgLmRefRes,
      courseConfigs: cfgCourseRefRes,
      modules: cfgModRefRes,
      rubrics: cfgRubRefRes,
      customTags: cfgTagRefRes,
      reportConfig: cfgRepRefRes,
    };
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
      if (tagsChanged) {
        _allTagsCache = {};
        _tagToSectionCache = {};
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
  try {
    await p;
  } finally {
    if (_initPromise === p) _initPromise = null;
  }
}

/* Fetch all course rows for a table, paginating past PostgREST's 1000-row default cap. */
async function _selectCourseTable(sb, tbl, teacherId, cid, opts) {
  opts = opts || {};
  var columns = opts.columns || '*';
  var pageSize = opts.pageSize || 1000;
  var gtColumn = opts.gtColumn;
  var gtValue = opts.gtValue;
  var signal = opts.signal;
  var allRows = [];
  var offset = 0;
  while (true) {
    var q = sb.from(tbl).select(columns).eq('teacher_id', teacherId).eq('course_id', cid);
    if (gtColumn && gtValue && typeof q.gt === 'function') q = q.gt(gtColumn, gtValue);
    var supportsRange = typeof q.range === 'function';
    if (supportsRange) q = q.range(offset, offset + pageSize - 1);
    if (signal && typeof q.abortSignal === 'function') q = q.abortSignal(signal);
    var res;
    try {
      res = await q;
    } catch (error) {
      return { data: null, error: error };
    }
    if (res.error) return { data: null, error: res.error };
    var batch = res.data || [];
    allRows = allRows.concat(batch);
    if (!supportsRange || batch.length < pageSize) break;
    offset += pageSize;
  }
  return { data: allRows, error: null };
}

async function _pagedSelect(sb, tbl, teacherId, cid, opts) {
  var result = await _selectCourseTable(sb, tbl, teacherId, cid, opts);
  if (result.error) throw result.error;
  return result.data || [];
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

async function _rpcPagedArray(sb, fn, payload, opts) {
  opts = opts || {};
  var pageSize = opts.pageSize || 1000;
  var offset = 0;
  var allRows = [];
  var tryPaging = opts.tryPaging !== false;

  while (true) {
    var rpcPayload = Object.assign({}, payload || {});
    if (tryPaging) {
      rpcPayload.p_limit = pageSize;
      rpcPayload.p_offset = offset;
    }

    var res = await sb.rpc(fn, rpcPayload);
    if (res.error && tryPaging && offset === 0) {
      tryPaging = false;
      continue;
    }
    if (res.error) return { data: null, error: res.error };

    var batch = _rpcRows(res.data);
    allRows = allRows.concat(batch);
    if (!tryPaging || batch.length < pageSize) break;
    offset += pageSize;
  }

  return { data: allRows, error: null };
}

function _persistLoadedField(cid, field, value) {
  _cache[field][cid] = value;
  var key = _DATA_KEYS[field];
  if (key) _safeLSSet('gb-' + key + '-' + cid, JSON.stringify(value));
}

function _personToEnrollmentId(studentId, enrollmentByStudentId) {
  return (enrollmentByStudentId && studentId && enrollmentByStudentId[studentId]) || studentId || null;
}

function _canonicalRosterRowsToStudents(rows) {
  return (rows || [])
    .map(function (r) {
      return {
        id: r.enrollment_id || r.enrollmentId || r.id || r.student_id || r.studentId,
        personId: r.student_id || r.studentId || r.person_id || r.personId || null,
        firstName: r.first_name || r.firstName || '',
        lastName: r.last_name || r.lastName || '',
        preferred: r.preferred || r.preferred_first_name || r.preferredFirstName || '',
        pronouns: r.pronouns || '',
        studentNumber: r.student_number || r.local_student_number || r.studentNumber || '',
        email: r.email || '',
        dateOfBirth: r.date_of_birth || r.dateOfBirth || '',
        designations: r.designations || r.designation_codes || [],
        enrolledDate: _dateOnly(r.enrolled_on || r.enrolled_date || r.enrolledDate),
        attendance: r.attendance || [],
        sortName: r.sort_name || '',
        rosterPosition: Number(r.roster_position || r.rosterPosition || 0),
      };
    })
    .sort(function (a, b) {
      if (a.rosterPosition && b.rosterPosition && a.rosterPosition !== b.rosterPosition) {
        return a.rosterPosition - b.rosterPosition;
      }
      return fullName(a).localeCompare(fullName(b));
    });
}

function _canonicalScoreRowsToBlob(rows, enrollmentByStudentId) {
  return _scoreRowsToBlob(
    (rows || [])
      .map(function (r) {
        return {
          student_id:
            r.enrollment_id ||
            r.enrollmentId ||
            _personToEnrollmentId(r.student_id || r.studentId, enrollmentByStudentId),
          assessment_id: r.assessment_id || r.assessmentId,
          tag_id: r.course_outcome_id || r.outcome_id || r.tag_id || r.tagId,
          score:
            r.raw_numeric_score !== undefined && r.raw_numeric_score !== null
              ? Number(r.raw_numeric_score)
              : r.normalized_level !== undefined && r.normalized_level !== null
                ? Number(r.normalized_level)
                : r.score,
          date: _dateOnly(r.entered_at || r.date),
          type: r.type || 'summative',
          note: r.comment_text || r.comment || r.note || '',
          created_at: r.created_at || r.entered_at,
        };
      })
      .filter(function (r) {
        return r.student_id && r.assessment_id && r.tag_id;
      }),
  );
}

function _canonicalObservationRowsToBlob(rows, enrollmentByStudentId) {
  return _obsRowsToBlob(
    (rows || [])
      .map(function (r) {
        return {
          id: r.observation_id || r.id,
          student_id:
            r.enrollment_id ||
            r.enrollmentId ||
            _personToEnrollmentId(r.student_id || r.studentId, enrollmentByStudentId),
          text: r.text || '',
          dims: r.dims || [],
          sentiment: r.sentiment || null,
          context: r.context || null,
          assignment_context: r.assignment_context || null,
          date: _dateOnly(r.observed_at || r.date),
          created_at: r.created_at || r.observed_at,
          modified_at: r.updated_at || r.modified_at,
        };
      })
      .filter(function (r) {
        return r.id && r.student_id;
      }),
  );
}

function _canonicalAssessmentRowsToBlob(rows) {
  return _assessmentRowsToBlob(
    (rows || [])
      .map(function (r) {
        return {
          id: r.assessment_id || r.id,
          title: r.title || '',
          date: _dateOnly(r.due_at || r.date),
          type: r.assessment_kind || r.type || 'summative',
          tag_ids: r.target_outcome_ids || r.tag_ids || r.tagIds || [],
          score_mode: r.score_mode || r.scoreMode || '',
          collaboration: r.collaboration_mode || r.collaboration || 'individual',
          max_points:
            r.points_possible !== undefined && r.points_possible !== null ? Number(r.points_possible) : r.max_points,
          weight: r.weighting !== undefined && r.weighting !== null ? Number(r.weighting) : r.weight,
          notes: r.notes || '',
          rubric_id: r.rubric_id || '',
          module_id: r.module_id || '',
          due_date: _dateOnly(r.due_at || r.due_date),
          assigned_at: _dateOnly(r.assigned_at || r.date_assigned),
        };
      })
      .filter(function (r) {
        return r.id;
      }),
  );
}

function _canonicalCoursePolicyToConfig(data) {
  var row = _rpcObject(data);
  if (!row) return {};
  if (_plainObject(row.policy)) row = row.policy;
  if (_plainObject(row.config)) row = row.config;
  var out = {};
  if (row.grading_system !== undefined || row.gradingSystem !== undefined) {
    out.gradingSystem = row.grading_system !== undefined ? row.grading_system : row.gradingSystem;
  }
  if (row.calculation_method !== undefined || row.calcMethod !== undefined || row.calculationMethod !== undefined) {
    out.calcMethod =
      row.calculation_method !== undefined
        ? row.calculation_method
        : row.calcMethod !== undefined
          ? row.calcMethod
          : row.calculationMethod;
  }
  if (row.decay_weight !== undefined || row.decayWeight !== undefined) {
    out.decayWeight = Number(row.decay_weight !== undefined ? row.decay_weight : row.decayWeight);
  }
  if (row.category_weights !== undefined || row.categoryWeights !== undefined) {
    out.categoryWeights = row.category_weights !== undefined ? row.category_weights : row.categoryWeights;
  }
  if (row.grading_scale !== undefined || row.gradingScale !== undefined) {
    out.gradingScale = row.grading_scale !== undefined ? row.grading_scale : row.gradingScale;
  }
  if (row.report_as_percentage !== undefined || row.reportAsPercentage !== undefined) {
    out.reportAsPercentage = !!(row.report_as_percentage !== undefined
      ? row.report_as_percentage
      : row.reportAsPercentage);
  }
  if (row.late_work_policy !== undefined || row.lateWorkPolicy !== undefined) {
    out.lateWorkPolicy = row.late_work_policy !== undefined ? row.late_work_policy : row.lateWorkPolicy;
  }
  return out;
}

function _canonicalReportConfig(data) {
  var row = _rpcObject(data);
  if (!row) return null;
  if (_plainObject(row.config)) return row.config;
  return row;
}

function _canonicalOutcomesToLearningMap(cid, rows) {
  var course = COURSES[cid] || {};
  var subjectId = course.subjectCode || course.id || cid;
  var sections = [];
  var seenSubjects = {};

  (rows || []).forEach(function (r, idx) {
    var outcomeId = r.course_outcome_id || r.outcomeId || r.id;
    if (!outcomeId) return;
    var color = r.color || SUBJECT_COLOURS[course.subjectCode] || '#6366f1';
    var sectionName = r.section_name || r.sectionName || r.short_label || r.outcome_code || 'Standard';
    var shortName = (sectionName || 'Standard').replace(/\s*\(.*?\)\s*/g, '').trim();
    if (shortName.length > 20) shortName = shortName.slice(0, 18) + '\u2026';
    var tagLabel = r.short_label || r.outcome_code || shortName || 'Standard';
    var tag = {
      id: outcomeId,
      label: tagLabel,
      text: r.body || r.text || '',
      color: color,
      subject: subjectId,
      name: sectionName,
      shortName: shortName,
      sortOrder: Number(r.sort_order || idx),
      sourceKind: r.source_kind || r.sourceKind || 'curriculum',
    };
    sections.push({
      id: outcomeId,
      subject: subjectId,
      name: sectionName,
      shortName: shortName,
      color: color,
      tags: [tag],
      sortOrder: tag.sortOrder,
      outcome: tag,
    });
    seenSubjects[subjectId] = color;
  });

  sections.sort(function (a, b) {
    return Number(a.sortOrder || 0) - Number(b.sortOrder || 0);
  });

  var subjects = Object.keys(seenSubjects).map(function (id) {
    return {
      id: id,
      name: course.name || 'Learning Outcomes',
      color: seenSubjects[id],
    };
  });

  return {
    subjects: subjects,
    sections: sections,
    outcomes: sections.map(function (section) {
      return section.outcome;
    }),
    _customized: true,
    _version: 1,
    _flatVersion: 2,
  };
}

function _canonicalStudentGoalsToMap(data) {
  var rows = _rpcRows(data);
  var out = {};
  if (rows.length > 0) {
    rows.forEach(function (r) {
      var key = r.course_outcome_id || r.outcome_id || r.tag_id || r.tagId || r.id;
      if (key) out[key] = r.text || r.goal_text || r.value || '';
    });
    return out;
  }
  var obj = _rpcObject(data);
  if (!obj) return out;
  if (_plainObject(obj.goals)) obj = obj.goals;
  Object.keys(obj).forEach(function (key) {
    var value = obj[key];
    out[key] = typeof value === 'string' ? value : value && typeof value.text === 'string' ? value.text : '';
  });
  return out;
}

function _canonicalStudentReflectionsToMap(data) {
  var rows = _rpcRows(data);
  var out = {};
  if (rows.length > 0) {
    rows.forEach(function (r) {
      var key = r.course_outcome_id || r.outcome_id || r.tag_id || r.tagId || r.id;
      if (!key) return;
      out[key] = {
        confidence: Number(r.confidence || 0),
        text: r.text || r.reflection_text || '',
        date: _dateOnly(r.date || r.reflection_date),
      };
    });
    return out;
  }
  var obj = _rpcObject(data);
  if (!obj) return out;
  if (_plainObject(obj.reflections)) obj = obj.reflections;
  Object.keys(obj).forEach(function (key) {
    var value = obj[key] || {};
    out[key] = {
      confidence: Number(value.confidence || 0),
      text: value.text || '',
      date: _dateOnly(value.date),
    };
  });
  return out;
}

function _canonicalStudentOverridesToMap(data) {
  var rows = _rpcRows(data);
  var out = {};
  if (rows.length > 0) {
    rows.forEach(function (r) {
      var key = r.course_outcome_id || r.outcome_id || r.tag_id || r.tagId || r.id;
      if (!key) return;
      var entry = {
        level:
          r.level !== undefined && r.level !== null
            ? Number(r.level)
            : r.override_level !== undefined && r.override_level !== null
              ? Number(r.override_level)
              : 0,
        reason: r.reason || r.comment || '',
      };
      if (r.date || r.override_date) entry.date = _dateOnly(r.date || r.override_date);
      if (r.calculated !== undefined || r.calculated_level !== undefined) {
        entry.calculated = Number(r.calculated !== undefined ? r.calculated : r.calculated_level);
      }
      out[key] = entry;
    });
    return out;
  }
  var obj = _rpcObject(data);
  if (!obj) return out;
  if (_plainObject(obj.overrides)) obj = obj.overrides;
  Object.keys(obj).forEach(function (key) {
    var value = obj[key] || {};
    out[key] = {
      level: Number(value.level || 0),
      reason: value.reason || '',
      date: _dateOnly(value.date),
      calculated: Number(value.calculated || 0),
    };
  });
  return out;
}

function _canonicalStatusesToBlob(rows, enrollmentByStudentId) {
  return _statusesRowsToBlob(
    (rows || [])
      .map(function (r) {
        return {
          student_id: _personToEnrollmentId(r.student_id || r.studentId, enrollmentByStudentId),
          assessment_id: r.assessment_id || r.assessmentId,
          status: r.status || '',
        };
      })
      .filter(function (r) {
        return r.student_id && r.assessment_id;
      }),
  );
}

function _canonicalTermRatingsToBlob(rows, enrollmentByStudentId) {
  return _termRatingsRowsToBlob(
    (rows || [])
      .map(function (r) {
        return {
          student_id: _personToEnrollmentId(r.student_id || r.studentId, enrollmentByStudentId),
          term_id: r.term_id || r.termId,
          dims: r.dims || {},
          narrative: r.narrative || '',
          work_habits: r.work_habits,
          participation: r.participation,
          social_traits: r.social_traits || r.socialTraits,
          strengths: r.strengths,
          growth_areas: r.growth_areas || r.growthAreas,
          mention_assessments: r.mention_assessments || r.mentionAssessments,
          mention_obs: r.mention_obs || r.mentionObs,
          include_course_summary: r.include_course_summary || r.includeCourseSummary,
          created_at: r.created_at || r.created,
          modified_at: r.updated_at || r.modified_at || r.modified,
        };
      })
      .filter(function (r) {
        return r.student_id && r.term_id;
      }),
  );
}

function _canonicalFlagsToBlob(rows, enrollmentByStudentId) {
  var blob = {};
  (rows || []).forEach(function (r) {
    var sid =
      r.enrollment_id || r.enrollmentId || _personToEnrollmentId(r.student_id || r.studentId, enrollmentByStudentId);
    if (!sid) return;
    if (!blob[sid]) blob[sid] = { active: true, tags: [] };
    blob[sid].tags.push({
      id: r.flag_tag_id || r.flagTagId || r.student_flag_id || r.studentFlagId,
      label: r.label || '',
      color: r.color || '',
      note: r.note || '',
      preset: !!(r.is_preset || r.isPreset),
      sortOrder: Number(r.sort_order || r.sortOrder || 0),
    });
    if (r.note) blob[sid].note = r.note;
  });
  return blob;
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
  var students = (payload.students || []).map(function (s) {
    return migrateStudent({
      id: s.enrollment_id,
      personId: s.student_id,
      firstName: s.first_name || '',
      lastName: s.last_name || '',
      preferred: '',
      pronouns: '',
      studentNumber: '',
      email: '',
      dateOfBirth: '',
      designations: [],
      attendance: [],
      sortName: ((s.last_name || '') + ' ' + (s.first_name || '')).trim(),
      rosterPosition: Number(s.roster_position || 0),
      isFlagged: !!s.is_flagged,
    });
  });

  var assessments = (payload.assessments || []).map(function (a) {
    return {
      id: a.id,
      title: a.title || '',
      date: _dateOnly(a.date_assigned),
      type: 'summative',
      tag_ids: [],
      score_mode: a.score_mode || 'proficiency',
      max_points: a.max_points != null ? Number(a.max_points) : null,
      has_rubric: !!a.has_rubric,
      category_id: a.category_id || null,
      due_date: _dateOnly(a.due_date),
      assigned_at: _dateOnly(a.date_assigned),
      display_order: Number(a.display_order || 0),
    };
  });

  _persistLoadedField(cid, 'students', students);
  _persistLoadedField(cid, 'assessments', assessments);
  _cache.v2Gradebook[cid] = payload;

  // The remaining cache fields stay empty until their port lands:
  //   scores       — Phase 4.3 (tag-level TagScore + RubricScore reads)
  //   observations — Phase 4.4 (get_observations read)
  //   learningMaps — Phase 4.5 (get_learning_map read)
  //   termRatings  — Phase 4.7
  //   reportConfig — Phase 3.x / 4.8 report preview
  //   goals, reflections, overrides, flags — Phase 4.6 (get_student_profile)
  // Per-cell overall values are preserved on _cache.v2Gradebook[cid].cells
  // for whichever rendering pass picks them up first.
  _persistLoadedField(cid, 'scores', {});
  _persistLoadedField(cid, 'observations', {});
  _persistLoadedField(cid, 'courseConfigs', {});
  _persistLoadedField(cid, 'reportConfig', null);
  _persistLoadedField(cid, 'learningMaps',
    (typeof LEARNING_MAP !== 'undefined' && LEARNING_MAP[cid]) || { subjects: [], sections: [] });
  _persistLoadedField(cid, 'statuses', {});
  _persistLoadedField(cid, 'termRatings', {});
  _persistLoadedField(cid, 'flags', {});
  _persistLoadedField(cid, 'goals', {});
  _persistLoadedField(cid, 'reflections', {});
  _persistLoadedField(cid, 'overrides', {});

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
      _v2GradebookToCache(cid, { students: [], assessments: [], cells: {}, row_summaries: {} });
      return;
    }

    try {
      var gbRes = await sb.rpc('get_gradebook', { p_course_id: cid });
      if (gbRes.error) throw gbRes.error;
      _v2GradebookToCache(cid, gbRes.data || {});
      return;
    } catch (e) {
      console.warn('get_gradebook failed for ' + cid + '; falling back to empty cache:', e);
      _v2GradebookToCache(cid, { students: [], assessments: [], cells: {}, row_summaries: {} });
      return;
    }

    // (Legacy per-course RPC fan-out removed — get_gradebook above is the v2
    // boot read. Phase 4.x will add purpose-built v2 RPCs for scoring,
    // observations, learning map, etc. as each UI path is ported.)
    return;

    // eslint-disable-next-line no-unreachable
    try {
      var rosterRes = await _rpcPagedArray(sb, 'list_course_roster', { p_course_offering_id: cid });
      if (rosterRes.error) throw rosterRes.error;

      var students = _canonicalRosterRowsToStudents(rosterRes.data).map(migrateStudent);
      var enrollmentByStudentId = {};
      students.forEach(function (student) {
        if (student.personId) enrollmentByStudentId[student.personId] = student.id;
      });

      var studentReads = students
        .filter(function (student) {
          return _isUuid(student.personId);
        })
        .map(async function (student) {
          var payload = { p_course_offering_id: cid, p_student_id: student.personId };
          var [goalsRes, reflectionsRes, overridesRes] = await Promise.all([
            sb.rpc('get_student_goals', payload),
            sb.rpc('list_student_reflections', payload),
            sb.rpc('list_section_overrides', payload),
          ]);
          return {
            sid: student.id,
            goals: goalsRes,
            reflections: reflectionsRes,
            overrides: overridesRes,
          };
        });

      var [
        scoreRes,
        obsRes,
        assessRes,
        policyRes,
        reportRes,
        outcomesRes,
        statusRes,
        termRatingsRes,
        flagsRes,
        studentDetails,
      ] = await Promise.all([
        _rpcPagedArray(sb, 'list_course_scores', { p_course_offering_id: cid }),
        _rpcPagedArray(sb, 'list_course_observations', { p_course_offering_id: cid }),
        _rpcPagedArray(sb, 'list_course_assessments', { p_course_offering_id: cid }),
        sb.rpc('get_course_policy', { p_course_offering_id: cid }),
        sb.rpc('get_report_config', { p_course_offering_id: cid }),
        _rpcPagedArray(sb, 'list_course_outcomes', { p_course_offering_id: cid }),
        sb.rpc('list_assignment_statuses', { p_course_offering_id: cid }),
        sb.rpc('list_term_ratings_for_course', { p_course_offering_id: cid }),
        sb.rpc('projection.list_student_flags', { p_course_offering_id: cid }),
        Promise.all(studentReads),
      ]);

      _persistLoadedField(cid, 'students', students);
      _persistLoadedField(cid, 'assessments', assessRes.error ? [] : _canonicalAssessmentRowsToBlob(assessRes.data));
      _persistLoadedField(
        cid,
        'scores',
        scoreRes.error ? {} : _canonicalScoreRowsToBlob(scoreRes.data, enrollmentByStudentId),
      );
      _persistLoadedField(
        cid,
        'observations',
        obsRes.error ? {} : _canonicalObservationRowsToBlob(obsRes.data, enrollmentByStudentId),
      );
      _persistLoadedField(cid, 'courseConfigs', policyRes.error ? {} : _canonicalCoursePolicyToConfig(policyRes.data));
      _persistLoadedField(cid, 'reportConfig', reportRes.error ? null : _canonicalReportConfig(reportRes.data));
      _persistLoadedField(
        cid,
        'learningMaps',
        outcomesRes.error
          ? LEARNING_MAP[cid] || { subjects: [], sections: [] }
          : _canonicalOutcomesToLearningMap(cid, outcomesRes.data),
      );
      _persistLoadedField(
        cid,
        'statuses',
        statusRes.error ? {} : _canonicalStatusesToBlob(_rpcRows(statusRes.data), enrollmentByStudentId),
      );
      _persistLoadedField(
        cid,
        'termRatings',
        termRatingsRes.error ? {} : _canonicalTermRatingsToBlob(_rpcRows(termRatingsRes.data), enrollmentByStudentId),
      );
      _persistLoadedField(
        cid,
        'flags',
        flagsRes.error ? {} : _canonicalFlagsToBlob(_rpcRows(flagsRes.data), enrollmentByStudentId),
      );

      var goalsBlob = {};
      var reflectionsBlob = {};
      var overridesBlob = {};
      studentDetails.forEach(function (result) {
        goalsBlob[result.sid] =
          result.goals && !result.goals.error ? _canonicalStudentGoalsToMap(result.goals.data) : {};
        reflectionsBlob[result.sid] =
          result.reflections && !result.reflections.error
            ? _canonicalStudentReflectionsToMap(result.reflections.data)
            : {};
        overridesBlob[result.sid] =
          result.overrides && !result.overrides.error ? _canonicalStudentOverridesToMap(result.overrides.data) : {};
      });
      _persistLoadedField(cid, 'goals', goalsBlob);
      _persistLoadedField(cid, 'reflections', reflectionsBlob);
      _persistLoadedField(cid, 'overrides', overridesBlob);

      // Client-only fields stay on their local cache for now.
      _cache.notes[cid] = _safeParseLS('gb-notes-' + cid, {});
      _cache.modules[cid] = _safeParseLS('gb-modules-' + cid, _safeParseLS('gb-units-' + cid, [])) || [];
      _cache.rubrics[cid] = _safeParseLS('gb-rubrics-' + cid, []);
      _cache.customTags[cid] = _safeParseLS('gb-custom-tags-' + cid, []);

      _healFromLocalBackup(cid, 'students', 'students');
      _healFromLocalBackup(cid, 'assessments', 'assessments');
      _healFromLocalBackup(cid, 'scores', 'scores');
      _healFromLocalBackup(cid, 'observations', 'quick-obs');
      return;
    } catch (error) {
      console.error('Failed to load canonical data for', cid, error);
      // Fall through to localStorage
    }
  }

  // localStorage path
  _loadCourseFromLS(cid);
}

/* If Supabase returned dramatically fewer items than localStorage for a field,
   a prior non-transactional DELETE+INSERT sync probably failed mid-way.
   Restore the richer dataset from localStorage and re-sync to heal Supabase. */
function _healFromLocalBackup(cid, field, lsKey) {
  var supaData = _cache[field][cid];
  var lsRaw = _safeParseLS('gb-' + lsKey + '-' + cid, null);
  if (!lsRaw) return; // no local backup

  var supaCount = _countFieldItems(field, supaData);
  var lsCount = _countFieldItems(field, lsRaw);

  var healThreshold = field === 'scores' || field === 'observations' ? 0.8 : 0.5;
  if (lsCount > 0 && supaCount < lsCount * healThreshold) {
    console.warn(
      'Healing ' + field + ' from localStorage: Supabase had',
      supaCount,
      'items vs',
      lsCount,
      'locally — restoring and re-syncing',
    );
    // Restore cache from localStorage
    if (field === 'students') {
      _cache[field][cid] = (Array.isArray(lsRaw) ? lsRaw : []).map(migrateStudent);
    } else {
      _cache[field][cid] = lsRaw;
    }
    // Re-sync to heal Supabase
    _setEchoGuard(field, cid);
    _syncToSupabase(_NORMALIZED_TABLES[field], { cid: cid }, _cache[field][cid]);
  }
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

function _countFieldItems(field, data) {
  if (!data) return 0;
  if (Array.isArray(data)) return data.length;
  if (field === 'scores' || field === 'observations') {
    return Object.keys(data).reduce(function (total, sid) {
      return total + ((data[sid] || []).length || 0);
    }, 0);
  }
  return Object.keys(data).length;
}

function _shouldSkipEntryShrink(field, existing, incoming, source) {
  if (field !== 'scores' && field !== 'observations') return false;
  var existingCount = _countFieldItems(field, existing);
  var incomingCount = _countFieldItems(field, incoming);
  if (existingCount > 0 && incomingCount < existingCount * 0.8) {
    console.warn(
      '[GUARD]',
      source,
      'for',
      field,
      'returned',
      incomingCount,
      'entries vs',
      existingCount,
      'in cache — skipping (likely partial snapshot)',
    );
    return true;
  }
  return false;
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
  } catch (e) {
    console.warn('Courses parse error:', e);
  }
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
  // Always persist to localStorage as a safety net — the non-transactional
  // DELETE+INSERT Supabase sync can lose data if INSERT fails after DELETE.
  var dataKey = _DATA_KEYS[field];
  if (dataKey) _safeLSSet('gb-' + dataKey + '-' + cid, JSON.stringify(value));
  if (_useSupabase) {
    _setEchoGuard(field, cid);
    // Deep-clone so in-flight sync is immune to later in-place mutations
    var snapshot = typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
    _syncToSupabase(_NORMALIZED_TABLES[field], { cid }, snapshot);
  }
  _broadcastChange(cid, field);
}

/* Convert scores blob { sid: [...entries] } → flat array of table rows */
function _scoreBlobToRows(cid, scoresObj) {
  const rows = [];
  for (const sid in scoresObj) {
    (scoresObj[sid] || []).forEach(function (e) {
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
        updated_at: new Date().toISOString(),
      });
    });
  }
  return rows;
}

/* Convert flat score rows → blob format { sid: [...entries] } */
function _scoreRowsToBlob(rows) {
  const blob = {};
  (rows || []).forEach(function (r) {
    if (!blob[r.student_id]) blob[r.student_id] = [];
    blob[r.student_id].push({
      id: r.student_id + ':' + r.assessment_id + ':' + r.tag_id,
      assessmentId: r.assessment_id,
      tagId: r.tag_id,
      score: r.score,
      date: r.date,
      type: r.type || 'summative',
      note: r.note || '',
      created: r.created_at || new Date().toISOString(),
    });
  });
  return blob;
}

/* Convert observations blob { sid: [...entries] } → flat array of table rows */
function _obsBlobToRows(cid, obsObj) {
  const rows = [];
  for (const sid in obsObj) {
    (obsObj[sid] || []).forEach(function (e) {
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
        modified_at: e.modified || null,
      });
    });
  }
  return rows;
}

/* Convert flat observation rows → blob format { sid: [...entries] } */
function _obsRowsToBlob(rows) {
  const blob = {};
  (rows || []).forEach(function (r) {
    if (!blob[r.student_id]) blob[r.student_id] = [];
    var entry = {
      id: r.id,
      text: r.text || '',
      dims: r.dims || [],
      created: r.created_at || new Date().toISOString(),
      date: r.date,
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
  return (arr || []).map(function (a) {
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
      updated_at: new Date().toISOString(),
    };
  });
}

/* Convert flat assessment rows → app array format */
function _assessmentRowsToBlob(rows) {
  return (rows || []).map(function (r) {
    var a = {
      id: r.id,
      title: r.title || '',
      date: r.date || '',
      type: r.type || 'summative',
      tagIds: r.tag_ids || [],
      weight: r.weight !== undefined ? r.weight : 1,
      collaboration: r.collaboration || 'individual',
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

/* Convert students array → flat array of table rows */
function _studentsBlobToRows(cid, arr) {
  return (arr || []).map(function (s) {
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
      updated_at: new Date().toISOString(),
    };
  });
}

/* Convert flat student rows → app array format */
function _studentRowsToBlob(rows) {
  return (rows || []).map(function (r) {
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
      sortName: r.sort_name || '',
    };
  });
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
function upsertScore(cid, sid, aid, tid, scoreVal, date, type, note) {
  // Update cache blob
  const scores = getScores(cid);
  if (!scores[sid]) scores[sid] = [];
  const existing = scores[sid].find(function (e) {
    return e.assessmentId === aid && e.tagId === tid;
  });
  if (existing) {
    if (existing.score === scoreVal) return; // no change
    existing.score = scoreVal;
    if (date) existing.date = date;
    if (note !== undefined) existing.note = note;
  } else {
    scores[sid].push({
      id: sid + ':' + aid + ':' + tid,
      assessmentId: aid,
      tagId: tid,
      score: scoreVal,
      date: date || new Date().toISOString().slice(0, 10),
      type: type || 'summative',
      note: note || '',
      created: new Date().toISOString(),
    });
  }
  _cache.scores[cid] = scores;
  if (typeof clearProfCache === 'function') clearProfCache();
  _safeLSSet('gb-scores-' + cid, JSON.stringify(scores));

  if (_useSupabase && localStorage.getItem('gb-demo-mode') !== '1') {
    _persistScoreToCanonical(cid, sid, aid, tid, scoreVal, note);
  }
  _broadcastChange(cid, 'scores');
}

/* v2 per-cell / per-tag / per-criterion score write.
   Dispatches to the right RPC:
     • overall cell (no tid)            → upsert_score
     • tag-scoped, non-rubric assessment → upsert_tag_score
     • tag-scoped, rubric assessment     → upsert_rubric_score (tid treated as criterion_id)
   Requires canonical UUIDs. If tid is present but the assessment's has_rubric
   flag is unknown (v2Gradebook payload missing), we default to tag_score — it
   will raise on the server for rubric assessments and land in console.warn.
   The localStorage write still happens in upsertScore so the score isn't lost. */
function _persistScoreToCanonical(cid, sid, aid, tid, scoreVal, note) {
  if (!_isUuid(sid) || !_isUuid(aid)) return;
  var sb = getSupabase();
  if (!sb) return;
  var intVal = scoreVal === '' || scoreVal == null ? null : Number(scoreVal);

  if (_isUuid(tid) && intVal != null) {
    // Tag- or criterion-scoped write.
    var gb = _cache.v2Gradebook && _cache.v2Gradebook[cid];
    var aRow = gb && (gb.assessments || []).find(function (x) { return x.id === aid; });
    var useRubric = !!(aRow && aRow.has_rubric);
    var rpc = useRubric ? 'upsert_rubric_score' : 'upsert_tag_score';
    var params = useRubric
      ? { p_enrollment_id: sid, p_assessment_id: aid, p_criterion_id: tid, p_value: intVal }
      : { p_enrollment_id: sid, p_assessment_id: aid, p_tag_id: tid, p_value: intVal };
    sb.rpc(rpc, params).then(function (res) {
      if (res.error) console.warn(rpc + ' failed:', res.error);
    });
  }

  // Comment-only updates: route to save_score_comment (no value change). The
  // legacy per-tag comment is collapsed onto the parent score row in v2 —
  // comments live on Score, not on TagScore/RubricScore.
  if (note != null && note !== '') {
    sb.rpc('save_score_comment', {
      p_enrollment_id: sid,
      p_assessment_id: aid,
      p_comment: note,
    }).then(function (res) {
      if (res.error) console.warn('save_score_comment failed:', res.error);
    });
  }
}

/* Overall per-cell score — writes to score.value (Phase 3.5 HANDOFF target).
   Used by UI paths that enter a top-level proficiency/points value for a
   (student, assessment) cell, independent of tag/criterion breakdown. */
window.upsertCellScore = function (cid, enrollmentId, assessmentId, value) {
  if (!_isUuid(enrollmentId) || !_isUuid(assessmentId)) return Promise.resolve();
  var sb = getSupabase();
  if (!sb) return Promise.resolve();
  var v = value === '' || value == null ? null : Number(value);
  return sb.rpc('upsert_score', {
    p_enrollment_id: enrollmentId,
    p_assessment_id: assessmentId,
    p_value: v,
  }).then(function (res) {
    if (res.error) console.warn('upsert_score failed:', res.error);
    return res;
  });
};

/* Fill every criterion of a rubric assessment with one level value (§9.6).
   Returns the number of criteria updated. */
window.fillRubric = function (enrollmentId, assessmentId, value) {
  if (!_isUuid(enrollmentId) || !_isUuid(assessmentId)) return Promise.resolve();
  var sb = getSupabase();
  if (!sb) return Promise.resolve();
  var v = value == null ? null : Number(value);
  return sb
    .rpc('fill_rubric', {
      p_enrollment_id: enrollmentId,
      p_assessment_id: assessmentId,
      p_value: v,
    })
    .then(function (res) {
      if (res.error) console.warn('fill_rubric failed:', res.error);
      return res;
    });
};

/* Clear a single cell — removes Score, RubricScore, and TagScore rows for
   the (enrollment, assessment) tuple.  Final value/status are captured as a
   deletion audit row before the delete cascades. */
window.clearScore = function (enrollmentId, assessmentId) {
  if (!_isUuid(enrollmentId) || !_isUuid(assessmentId)) return Promise.resolve();
  var sb = getSupabase();
  if (!sb) return Promise.resolve();
  return sb
    .rpc('clear_score', {
      p_enrollment_id: enrollmentId,
      p_assessment_id: assessmentId,
    })
    .then(function (res) {
      if (res.error) console.warn('clear_score failed:', res.error);
      return res;
    });
};

/* Clear every score this student has in the course — the "remove all of this
   student's grades" action. Returns audit-row count. */
window.clearRowScores = function (enrollmentId, courseId) {
  if (!_isUuid(enrollmentId) || !_isUuid(courseId)) return Promise.resolve();
  var sb = getSupabase();
  if (!sb) return Promise.resolve();
  return sb
    .rpc('clear_row_scores', {
      p_enrollment_id: enrollmentId,
      p_course_id: courseId,
    })
    .then(function (res) {
      if (res.error) console.warn('clear_row_scores failed:', res.error);
      return res;
    });
};

/* Clear every student's score on a single assessment — the "reset this column"
   action. Returns audit-row count. */
window.clearColumnScores = function (assessmentId) {
  if (!_isUuid(assessmentId)) return Promise.resolve();
  var sb = getSupabase();
  if (!sb) return Promise.resolve();
  return sb
    .rpc('clear_column_scores', { p_assessment_id: assessmentId })
    .then(function (res) {
      if (res.error) console.warn('clear_column_scores failed:', res.error);
      return res;
    });
};

/* Status pills (NS / EXC / LATE / null). Uses set_score_status RPC per §9.3. */
window.setCellStatus = function (enrollmentId, assessmentId, status) {
  if (!_isUuid(enrollmentId) || !_isUuid(assessmentId)) return Promise.resolve();
  var sb = getSupabase();
  if (!sb) return Promise.resolve();
  return sb.rpc('set_score_status', {
    p_enrollment_id: enrollmentId,
    p_assessment_id: assessmentId,
    p_status: status || null,
  }).then(function (res) {
    if (res.error) console.warn('set_score_status failed:', res.error);
    return res;
  });
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
function formatDate(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
}
function uid() {
  return 's' + Date.now() + Math.random().toString(36).slice(2, 10);
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
  if (_useSupabase) {
    _syncToSupabase('teacher_config', 'courses', obj);
  } else {
    _safeLSSet('gb-courses', JSON.stringify(obj));
  }
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
    name: data.name || 'Untitled Class',
    gradingSystem: data.gradingSystem || 'proficiency',
    calcMethod: data.calcMethod || 'mostRecent',
    decayWeight: data.decayWeight || 0.65,
    description: data.description || '',
    gradeLevel: data.gradeLevel || '',
  };
  COURSES[localId] = course;
  _safeLSSet('gb-courses', JSON.stringify(COURSES));
  saveLearningMap(localId, { subjects: [], sections: [], _customized: true, _version: 1 });

  if (_useSupabase) {
    const sb = getSupabase();
    if (sb) {
      sb.rpc('create_course', {
        p_payload: {
          name: course.name,
          description: course.description,
          gradeLevel: course.gradeLevel,
        },
      }).then(function (res) {
        if (res.error) {
          console.warn('create_course RPC failed:', res.error);
          return;
        }
        const row = res.data || {};
        const canonicalId = row.course_offering_id;
        if (!canonicalId || canonicalId === localId) return;
        // Re-key under the canonical UUID and migrate any per-course localStorage.
        const migrated = Object.assign({}, course, {
          id: canonicalId,
          name: row.title || course.name,
          gradeLevel: row.grade_band || course.gradeLevel,
          description: row.description || course.description,
          subjectCode: row.subject_code || '',
          schoolYear: row.school_year || '',
          termCode: row.term_code || '',
          archived: row.status === 'archived',
        });
        delete COURSES[localId];
        COURSES[canonicalId] = migrated;
        _cache.courses = COURSES;
        _safeLSSet('gb-courses', JSON.stringify(COURSES));
        // Persist policy with the user's chosen defaults.
        sb.rpc('save_course_policy', {
          p_course_offering_id: canonicalId,
          p_payload: {
            gradingSystem: course.gradingSystem,
            calcMethod: course.calcMethod,
            decayWeight: course.decayWeight,
          },
        }).then(function (pr) {
          if (pr.error) console.warn('save_course_policy RPC failed:', pr.error);
        });
      });
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
      // Only push fields the canonical schema knows about; ignore unknown locals.
      const payload = {};
      if (updates.name !== undefined) payload.name = updates.name;
      if (updates.description !== undefined) payload.description = updates.description;
      if (updates.gradeLevel !== undefined) payload.gradeLevel = updates.gradeLevel;
      if (updates.subjectCode !== undefined) payload.subjectCode = updates.subjectCode;
      if (updates.schoolYear !== undefined) payload.schoolYear = updates.schoolYear;
      if (updates.termCode !== undefined) payload.termCode = updates.termCode;
      if (updates.archived !== undefined) payload.archived = !!updates.archived;
      if (Object.keys(payload).length > 0) {
        sb.rpc('update_course', { p_course_offering_id: id, p_payload: payload }).then(function (res) {
          if (res.error) console.warn('update_course RPC failed:', res.error);
        });
      }
      // Policy fields write through save_course_policy.
      const policyKeys = ['gradingSystem', 'calcMethod', 'decayWeight'];
      const policyPatch = {};
      policyKeys.forEach(function (k) {
        if (updates[k] !== undefined) policyPatch[k] = updates[k];
      });
      if (Object.keys(policyPatch).length > 0) {
        const merged = Object.assign({}, getCourseConfig(id), policyPatch);
        sb.rpc('save_course_policy', { p_course_offering_id: id, p_payload: merged }).then(function (res) {
          if (res.error) console.warn('save_course_policy RPC failed:', res.error);
        });
      }
    }
  }
}

async function deleteCourseData(id) {
  // Delete from Supabase before clearing local state so a failed delete
  // doesn't leave the course gone locally but still alive in the database.
  if (_useSupabase) {
    const sb = getSupabase();
    if (sb) {
      const tables = Object.values(_NORMALIZED_TABLES);
      await Promise.all(
        tables.map(tbl => sb.from(tbl).delete().eq('teacher_id', _teacherId).eq('course_id', id)),
      ).catch(err => console.error('Failed to delete course data from Supabase:', err));
    }
  }

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
  ].forEach(k => localStorage.removeItem('gb-' + k + '-' + id));

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
  _saveCourseField('modules', cid, arr);
}
function getModuleById(cid, moduleId) {
  return getModules(cid).find(u => u.id === moduleId);
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
  _saveCourseField('statuses', cid, obj);
}
function getAssignmentStatus(cid, sid, aid) {
  return getAssignmentStatuses(cid)[sid + ':' + aid] || null;
}
function setAssignmentStatus(cid, sid, aid, status) {
  const st = getAssignmentStatuses(cid);
  const key = sid + ':' + aid;
  if (status) st[key] = status;
  else delete st[key];
  saveAssignmentStatuses(cid, st);
  if (_useSupabase && localStorage.getItem('gb-demo-mode') !== '1') {
    var sb = getSupabase();
    if (sb) {
      sb.rpc('save_assignment_status', {
        p_course_offering_id: cid,
        p_student_id: sid,
        p_assessment_id: aid,
        p_status: status || null,
      }).then(function (res) {
        if (res.error) console.warn('save_assignment_status RPC failed:', res.error);
      });
    }
  }
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
function saveRubrics(cid, arr) {
  _saveCourseField('rubrics', cid, arr);
}
function getRubricById(cid, rubricId) {
  return getRubrics(cid).find(r => r.id === rubricId);
}
function deleteRubric(cid, rubricId) {
  saveRubrics(
    cid,
    getRubrics(cid).filter(r => r.id !== rubricId),
  );
  const assessments = getAssessments(cid);
  let changed = false;
  assessments.forEach(a => {
    if (a.rubricId === rubricId) {
      delete a.rubricId;
      changed = true;
    }
  });
  if (changed) saveAssessments(cid, assessments);
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
function saveConfig(obj) {
  _cache.config = obj;
  _safeLSSet('gb-config', JSON.stringify(obj));
  if (_useSupabase) {
    const sb = getSupabase();
    if (sb) {
      // Split: activeCourse → first arg (must be a UUID or null); the rest is uiPrefs.
      const activeCourse = obj && obj.activeCourse ? obj.activeCourse : null;
      const uiPrefs = Object.assign({}, obj || {});
      delete uiPrefs.activeCourse;
      sb.rpc('save_teacher_preferences', {
        p_active_course_offering_id: activeCourse,
        p_ui_prefs: uiPrefs,
      }).then(function (res) {
        if (res.error) console.warn('save_teacher_preferences RPC failed:', res.error);
      });
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
  if (_useSupabase && cid) {
    const sb = getSupabase();
    if (sb) {
      sb.rpc('save_course_policy', { p_course_offering_id: cid, p_payload: obj || {} }).then(function (res) {
        if (res.error) console.warn('save_course_policy RPC failed:', res.error);
      });
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
  var prev = (_cache.students[cid] || []).slice();
  _saveCourseField('students', cid, arr);
  // Demo mode and offline both stay local-only.
  if (localStorage.getItem('gb-demo-mode') === '1' || !_useSupabase) return;
  if (!cid || !arr) return;
  _persistStudentsToCanonical(cid, prev, arr);
}

/* UUID detection — distinguishes canonical enrollment_ids from local uid()s */
var _UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function _isUuid(v) {
  return typeof v === 'string' && _UUID_RE.test(v);
}

/* Per-course save lock so rapid saves don't double-enroll the same student */
var _studentSaveQueue = {}; // cid → Promise tail

/* Diff arr vs prev and translate to canonical RPC calls.
   - student.id matching UUID → already enrolled → update_enrollment + update_student
   - student.id local (uid) → new → enroll_student → patches local cache id to canonical
   - prev student missing from arr → withdraw_enrollment */
function _persistStudentsToCanonical(cid, prev, arr) {
  var sb = getSupabase();
  if (!sb) return;
  var tail = _studentSaveQueue[cid] || Promise.resolve();
  var next = tail.then(function () {
    var prevById = {};
    prev.forEach(function (s) {
      if (s && s.id) prevById[s.id] = s;
    });
    var arrById = {};
    arr.forEach(function (s) {
      if (s && s.id) arrById[s.id] = s;
    });

    var ops = [];

    // Adds (any id not in prev)
    arr.forEach(function (s, idx) {
      if (s && s.id && !prevById[s.id]) {
        ops.push(_canonicalEnrollStudent(sb, cid, s, idx));
      }
    });
    // Withdrawals (in prev, not in arr) — only if we have a canonical enrollment id
    prev.forEach(function (s) {
      if (s && s.id && !arrById[s.id] && _isUuid(s.id)) {
        ops.push(_canonicalWithdrawEnrollment(sb, s.id));
      }
    });
    // Updates (in both, with field changes)
    arr.forEach(function (s, idx) {
      var p = s && s.id ? prevById[s.id] : null;
      if (!p || !_isUuid(s.id)) return;
      if (_studentEnrollmentChanged(p, s) || _studentRosterPositionChanged(idx, prev, p, s)) {
        ops.push(_canonicalUpdateEnrollment(sb, s.id, s, idx));
      }
      if (_studentIdentityChanged(p, s) && _isUuid(s.personId)) {
        ops.push(_canonicalUpdateStudent(sb, s.personId, s));
      }
    });

    return Promise.all(ops).catch(function (err) {
      console.warn('Student sync to canonical RPCs failed for one or more rows:', err);
    });
  });
  _studentSaveQueue[cid] = next;
}

function _studentEnrollmentChanged(a, b) {
  return (
    (a.studentNumber || '') !== (b.studentNumber || '') ||
    (a.enrolledDate || '') !== (b.enrolledDate || '') ||
    JSON.stringify(a.designations || []) !== JSON.stringify(b.designations || [])
  );
}
function _studentRosterPositionChanged(idx, prevArr, prevStudent, newStudent) {
  // Detect a real reorder: prev index of this student differs from new index
  var prevIdx = prevArr.findIndex(function (p) {
    return p && p.id === newStudent.id;
  });
  return prevIdx !== -1 && prevIdx !== idx;
}
function _studentIdentityChanged(a, b) {
  return (
    (a.firstName || '') !== (b.firstName || '') ||
    (a.lastName || '') !== (b.lastName || '') ||
    (a.preferred || '') !== (b.preferred || '') ||
    (a.pronouns || '') !== (b.pronouns || '') ||
    (a.email || '') !== (b.email || '') ||
    (a.dateOfBirth || '') !== (b.dateOfBirth || '')
  );
}

/* v2 create_student_and_enroll(p_course_id, p_first_name, p_last_name,
   p_preferred_name, p_pronouns, p_student_number, p_email, p_date_of_birth,
   p_designations, p_existing_student_id) → { student_id, enrollment_id } */
function _canonicalEnrollStudent(sb, cid, s, idx) {
  var existingStudentId = _isUuid(s.personId) ? s.personId : null;
  return sb
    .rpc('create_student_and_enroll', {
      p_course_id:            cid,
      p_first_name:           s.firstName || '',
      p_last_name:            s.lastName || null,
      p_preferred_name:       s.preferred || null,
      p_pronouns:             s.pronouns || null,
      p_student_number:       s.studentNumber || null,
      p_email:                s.email || null,
      p_date_of_birth:        s.dateOfBirth || null,
      p_designations:         s.designations || [],
      p_existing_student_id:  existingStudentId,
    })
    .then(function (res) {
      if (res.error) {
        console.warn('create_student_and_enroll failed:', res.error, s);
        return;
      }
      var row = res.data || {};
      var cached = (_cache.students[cid] || []).find(function (c) {
        return c.id === s.id;
      });
      if (cached && row.enrollment_id) {
        cached.id = row.enrollment_id;
        cached.personId = row.student_id;
        cached.rosterPosition = idx;
      }
      if (_cache.students[cid]) {
        _safeLSSet('gb-students-' + cid, JSON.stringify(_cache.students[cid]));
      }
    });
}

/* v2 update_enrollment(p_id, p_patch jsonb) — jsonb patch.
   Accepted keys: designations (text[]), is_flagged, roster_position, withdrawn_at. */
function _canonicalUpdateEnrollment(sb, enrollmentId, s, idx) {
  var patch = {
    designations: s.designations || [],
    roster_position: idx,
  };
  if (typeof s.isFlagged === 'boolean') patch.is_flagged = s.isFlagged;
  return sb
    .rpc('update_enrollment', { p_id: enrollmentId, p_patch: patch })
    .then(function (res) {
      if (res.error) console.warn('update_enrollment failed:', res.error, enrollmentId);
    });
}

/* v2 update_student(p_id, p_patch jsonb).
   Accepted keys: first_name, last_name, preferred_name, pronouns,
   student_number, email, date_of_birth. */
function _canonicalUpdateStudent(sb, studentId, s) {
  var patch = {
    first_name:     s.firstName || '',
    last_name:      s.lastName || null,
    preferred_name: s.preferred || null,
    pronouns:       s.pronouns || null,
    student_number: s.studentNumber || null,
    email:          s.email || null,
    date_of_birth:  s.dateOfBirth || null,
  };
  return sb
    .rpc('update_student', { p_id: studentId, p_patch: patch })
    .then(function (res) {
      if (res.error) console.warn('update_student failed:', res.error, studentId);
    });
}

/* v2 withdraw_enrollment(p_id) — sets withdrawn_at = now(). */
function _canonicalWithdrawEnrollment(sb, enrollmentId) {
  return sb
    .rpc('withdraw_enrollment', { p_id: enrollmentId })
    .then(function (res) {
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
  return sb.rpc('reorder_roster', { p_ids: ids }).then(function (res) {
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
  return sb
    .rpc('bulk_apply_pronouns', { p_student_ids: ids, p_pronouns: pronouns || null })
    .then(function (res) {
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
  return sb
    .rpc('import_roster_csv', { p_course_id: cid, p_rows: rows || [] })
    .then(function (res) {
      if (res.error) console.warn('import_roster_csv failed:', res.error);
      return res;
    });
};

/* Single-enrollment flag toggle — v2 enrollment.is_flagged column. */
window.setEnrollmentFlag = function (enrollmentId, flagged) {
  var sb = getSupabase();
  if (!sb) return Promise.resolve();
  if (!_isUuid(enrollmentId)) return Promise.resolve();
  return sb
    .rpc('update_enrollment', {
      p_id: enrollmentId,
      p_patch: { is_flagged: !!flagged },
    })
    .then(function (res) {
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
function saveAssessments(cid, arr) {
  var prev = ((_cache.assessments && _cache.assessments[cid]) || []).slice();
  _saveCourseField('assessments', cid, arr);
  if (arr.length < prev.length) _cleanOrphanedScores(cid, arr);
  if (localStorage.getItem('gb-demo-mode') === '1' || !_useSupabase) return;
  if (!cid || !arr) return;
  _persistAssessmentsToCanonical(cid, prev, arr);
}

/* Per-course save lock for assessments */
var _assessmentSaveQueue = {};

function _persistAssessmentsToCanonical(cid, prev, arr) {
  var sb = getSupabase();
  if (!sb) return;
  var tail = _assessmentSaveQueue[cid] || Promise.resolve();
  var next = tail.then(function () {
    var prevById = {};
    prev.forEach(function (a) {
      if (a && a.id) prevById[a.id] = a;
    });
    var arrById = {};
    arr.forEach(function (a) {
      if (a && a.id) arrById[a.id] = a;
    });

    var ops = [];

    // Adds
    arr.forEach(function (a) {
      if (a && a.id && !prevById[a.id]) {
        ops.push(_canonicalCreateAssessment(sb, cid, a));
      }
    });
    // Deletes (canonical-id removals only)
    prev.forEach(function (a) {
      if (a && a.id && !arrById[a.id] && _isUuid(a.id)) {
        ops.push(_canonicalDeleteAssessment(sb, cid, a.id));
      }
    });
    // Updates
    arr.forEach(function (a) {
      var p = a && a.id ? prevById[a.id] : null;
      if (!p || !_isUuid(a.id)) return;
      if (_assessmentChanged(p, a)) {
        ops.push(_canonicalUpdateAssessment(sb, cid, a.id, a));
      }
    });

    return Promise.all(ops).catch(function (err) {
      console.warn('Assessment sync to canonical RPCs failed for one or more rows:', err);
    });
  });
  _assessmentSaveQueue[cid] = next;
}

function _assessmentChanged(a, b) {
  return (
    (a.title || '') !== (b.title || '') ||
    (a.date || '') !== (b.date || '') ||
    (a.type || '') !== (b.type || '') ||
    (a.scoreMode || '') !== (b.scoreMode || '') ||
    (a.collaboration || '') !== (b.collaboration || '') ||
    (a.maxPoints || 0) !== (b.maxPoints || 0) ||
    (a.weight || 1) !== (b.weight || 1) ||
    (a.notes || '') !== (b.notes || '') ||
    (a.rubricId || '') !== (b.rubricId || '') ||
    (a.moduleId || '') !== (b.moduleId || '') ||
    JSON.stringify(a.tagIds || []) !== JSON.stringify(b.tagIds || [])
  );
}

function _assessmentPayload(a) {
  // tagIds passed through only when they look like UUIDs — demo mode uses text codes
  // ('QAP', 'PI') that would fail the canonical UUID cast.
  var tagIds = (a.tagIds || []).filter(_isUuid);
  return {
    title: a.title || '',
    description: a.description || '',
    type: a.type || 'summative',
    scoreMode: a.scoreMode || 'proficiency',
    collaboration: a.collaboration || 'individual',
    maxPoints: a.maxPoints != null ? String(a.maxPoints) : '',
    weight: a.weight != null ? String(a.weight) : '',
    notes: a.notes || '',
    rubricId: a.rubricId || '',
    moduleId: a.moduleId || '',
    date: a.date || '',
    dateAssigned: a.dateAssigned || '',
    tagIds: tagIds,
  };
}

/* v2 create_assessment — explicit positional params.  tagIds passed as uuid[].
   Returns the new assessment id; client patches its cached row to swap in the
   canonical uuid so subsequent saves hit update_assessment, not re-create. */
function _canonicalCreateAssessment(sb, cid, a) {
  var tagIds = (a.tagIds || []).filter(_isUuid);
  var params = {
    p_course_id:     cid,
    p_title:         a.title || '',
    p_category_id:   _isUuid(a.categoryId) ? a.categoryId : null,
    p_description:   a.description || null,
    p_date_assigned: a.dateAssigned || a.date || null,
    p_due_date:      a.dueDate || null,
    p_score_mode:    a.scoreMode || 'proficiency',
    p_max_points:    a.maxPoints != null ? Number(a.maxPoints) : null,
    p_weight:        a.weight != null ? Number(a.weight) : 1.0,
    p_evidence_type: a.evidenceType || null,
    p_rubric_id:     _isUuid(a.rubricId) ? a.rubricId : null,
    p_module_id:     _isUuid(a.moduleId) ? a.moduleId : null,
    p_tag_ids:       tagIds,
  };
  return sb.rpc('create_assessment', params).then(function (res) {
    if (res.error) {
      console.warn('create_assessment failed:', res.error, a);
      return;
    }
    var newId = res.data;
    var cached = (_cache.assessments[cid] || []).find(function (c) {
      return c.id === a.id;
    });
    if (cached && newId) cached.id = newId;
    if (_cache.assessments[cid]) {
      _safeLSSet('gb-assessments-' + cid, JSON.stringify(_cache.assessments[cid]));
    }
  });
}

/* v2 update_assessment(p_id, p_patch jsonb, p_tag_ids uuid[]).
   Full field replace via jsonb patch; when tag_ids is passed, fully replaces
   the assessment_tag join set. */
function _canonicalUpdateAssessment(sb, cid, assessmentId, a) {
  var tagIds = (a.tagIds || []).filter(_isUuid);
  var patch = {
    title:         a.title || '',
    description:   a.description || '',
    category_id:   _isUuid(a.categoryId) ? a.categoryId : null,
    date_assigned: a.dateAssigned || a.date || null,
    due_date:      a.dueDate || null,
    score_mode:    a.scoreMode || 'proficiency',
    max_points:    a.maxPoints != null ? String(a.maxPoints) : null,
    weight:        a.weight != null ? String(a.weight) : '1',
    evidence_type: a.evidenceType || null,
    rubric_id:     _isUuid(a.rubricId) ? a.rubricId : null,
    module_id:     _isUuid(a.moduleId) ? a.moduleId : null,
  };
  return sb
    .rpc('update_assessment', { p_id: assessmentId, p_patch: patch, p_tag_ids: tagIds })
    .then(function (res) {
      if (res.error) console.warn('update_assessment failed:', res.error, assessmentId);
    });
}

/* v2 delete_assessment(p_id).  FK cascade handles scores/rubric_scores/
   tag_scores/assessment_tag/term_rating_assessment; observation.assessment_id
   is ON DELETE SET NULL so observations survive. */
function _canonicalDeleteAssessment(sb, cid, assessmentId) {
  return sb.rpc('delete_assessment', { p_id: assessmentId }).then(function (res) {
    if (res.error) console.warn('delete_assessment failed:', res.error, assessmentId);
  });
}

/* ── Public v2 assessment helpers (Phase 4.2) ─────────────────── */

window.duplicateAssessment = function (srcAssessmentId) {
  var sb = getSupabase();
  if (!sb) return Promise.resolve();
  if (!_isUuid(srcAssessmentId)) return Promise.resolve();
  return sb
    .rpc('duplicate_assessment', { p_src_id: srcAssessmentId })
    .then(function (res) {
      if (res.error) console.warn('duplicate_assessment failed:', res.error);
      return res;
    });
};

window.saveAssessmentTags = function (assessmentId, tagIds) {
  var sb = getSupabase();
  if (!sb) return Promise.resolve();
  if (!_isUuid(assessmentId)) return Promise.resolve();
  var ids = (tagIds || []).filter(_isUuid);
  return sb
    .rpc('save_assessment_tags', { p_id: assessmentId, p_tag_ids: ids })
    .then(function (res) {
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
  return sb
    .rpc('save_collab', {
      p_id: assessmentId,
      p_mode: mode || 'none',
      p_config: mode === 'none' ? null : (config || null),
    })
    .then(function (res) {
      if (res.error) console.warn('save_collab failed:', res.error);
      return res;
    });
};

function _cleanOrphanedScores(cid, validArr) {
  var validIds = new Set(
    validArr.map(function (a) {
      return a.id;
    }),
  );
  var scores = getScores(cid);
  var changed = false;
  Object.keys(scores).forEach(function (sid) {
    if (!Array.isArray(scores[sid])) return;
    var before = scores[sid].length;
    scores[sid] = scores[sid].filter(function (e) {
      return validIds.has(e.assessmentId);
    });
    if (scores[sid].length !== before) changed = true;
  });
  if (changed) saveScores(cid, scores);
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
function saveNotes(cid, obj) {
  _saveCourseField('notes', cid, obj);
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
  var prev = _cache.scores[cid];
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
    return;
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
    return;
  }
  _saveCourseField('scores', cid, obj);
}

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
        date: assess.date || new Date().toISOString().slice(0, 10),
        type: assess.type || 'summative',
        note: '',
        created: new Date().toISOString(),
      });
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
function setActiveCourse(cid) {
  saveConfig({ ...getConfig(), activeCourse: cid });
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
  if (flags[sid]) delete flags[sid];
  else flags[sid] = true;
  saveFlags(cid, flags);
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

function addQuickOb(cid, sid, text, dims, sentiment, context, assignmentContext) {
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
  all[sid].push(entry);
  _cache.observations[cid] = all;
  _safeLSSet('gb-quick-obs-' + cid, JSON.stringify(all));
  if (_useSupabase && localStorage.getItem('gb-demo-mode') !== '1') {
    _persistObservationCreate(cid, sid, entry);
  }
  _broadcastChange(cid, 'observations');
}

function deleteQuickOb(cid, sid, obId) {
  const all = getQuickObs(cid);
  if (!all[sid]) return;
  all[sid] = all[sid].filter(o => o.id !== obId);
  _cache.observations[cid] = all;
  _safeLSSet('gb-quick-obs-' + cid, JSON.stringify(all));
  if (_useSupabase && localStorage.getItem('gb-demo-mode') !== '1') {
    _persistObservationDelete(cid, obId);
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
  _safeLSSet('gb-quick-obs-' + cid, JSON.stringify(all));
  if (_useSupabase && localStorage.getItem('gb-demo-mode') !== '1') {
    _persistObservationUpdate(cid, ob);
  }
  _broadcastChange(cid, 'observations');
}

/* v2 create_observation(p_course_id, p_body, p_sentiment, p_context_type,
   p_assessment_id, p_enrollment_ids uuid[], p_tag_ids uuid[],
   p_custom_tag_ids uuid[]) → uuid */
function _persistObservationCreate(cid, sid, entry) {
  if (!_isUuid(cid) || !_isUuid(sid)) return;
  var sb = getSupabase();
  if (!sb) return;
  var ctxAsmt =
    entry.assignmentContext && _isUuid(entry.assignmentContext.assessmentId)
      ? entry.assignmentContext.assessmentId
      : null;
  // entry.dims is an array of dimension codes (text labels) — not UUIDs in the
  // legacy store. Passing [] here; tag linkage lands in Phase 4.5 once the
  // learning map port carries real tag ids through to observation capture.
  sb.rpc('create_observation', {
    p_course_id:       cid,
    p_body:            entry.text || '',
    p_sentiment:       entry.sentiment || null,
    p_context_type:    entry.context || null,
    p_assessment_id:   ctxAsmt,
    p_enrollment_ids:  [sid],
    p_tag_ids:         [],
    p_custom_tag_ids:  [],
  }).then(function (res) {
    if (res.error) {
      console.warn('create_observation failed:', res.error);
      return;
    }
    var newId = res.data;
    var arr = (_cache.observations[cid] || {})[sid];
    if (Array.isArray(arr)) {
      var cached = arr.find(function (o) {
        return o.id === entry.id;
      });
      if (cached && newId) {
        cached.id = newId;
        _safeLSSet('gb-quick-obs-' + cid, JSON.stringify(_cache.observations[cid]));
      }
    }
  });
}

/* v2 update_observation(p_id, p_patch jsonb, p_enrollment_ids, p_tag_ids,
   p_custom_tag_ids). Null join-array params leave that set alone; empty
   array wipes it. Here we always pass null so we don't disturb membership
   unless the caller explicitly wants to. */
function _persistObservationUpdate(cid, ob) {
  if (!_isUuid(ob.id)) return;
  var sb = getSupabase();
  if (!sb) return;
  var patch = {
    body:         ob.text || '',
    sentiment:    ob.sentiment || null,
    context_type: ob.context || null,
  };
  if (ob.assignmentContext && _isUuid(ob.assignmentContext.assessmentId)) {
    patch.assessment_id = ob.assignmentContext.assessmentId;
  }
  sb.rpc('update_observation', {
    p_id: ob.id,
    p_patch: patch,
    p_enrollment_ids: null,
    p_tag_ids: null,
    p_custom_tag_ids: null,
  }).then(function (res) {
    if (res.error) console.warn('update_observation failed:', res.error);
  });
}

/* v2 delete_observation(p_id). FK cascade handles observation_student /
   observation_tag / observation_custom_tag / term_rating_observation. */
function _persistObservationDelete(cid, obId) {
  if (!_isUuid(obId)) return;
  var sb = getSupabase();
  if (!sb) return;
  sb.rpc('delete_observation', { p_id: obId }).then(function (res) {
    if (res.error) console.warn('delete_observation failed:', res.error);
  });
}

/* ── Public v2 observation helpers (Phase 4.4) ─────────────────── */

/* Richer create that accepts multi-student targeting + tag + custom-tag
   membership, mirroring the Pass B §10.1 capture-bar payload. */
window.createObservationRich = function (params) {
  var sb = getSupabase();
  if (!sb) return Promise.resolve();
  params = params || {};
  if (!_isUuid(params.courseId)) return Promise.resolve();
  return sb
    .rpc('create_observation', {
      p_course_id:      params.courseId,
      p_body:           params.body || '',
      p_sentiment:      params.sentiment || null,
      p_context_type:   params.contextType || null,
      p_assessment_id:  _isUuid(params.assessmentId) ? params.assessmentId : null,
      p_enrollment_ids: (params.enrollmentIds || []).filter(_isUuid),
      p_tag_ids:        (params.tagIds || []).filter(_isUuid),
      p_custom_tag_ids: (params.customTagIds || []).filter(_isUuid),
    })
    .then(function (res) {
      if (res.error) console.warn('create_observation failed:', res.error);
      return res;
    });
};

window.updateObservationRich = function (obId, patch, joins) {
  var sb = getSupabase();
  if (!sb) return Promise.resolve();
  if (!_isUuid(obId)) return Promise.resolve();
  joins = joins || {};
  return sb
    .rpc('update_observation', {
      p_id:             obId,
      p_patch:          patch || {},
      p_enrollment_ids: joins.enrollmentIds ? joins.enrollmentIds.filter(_isUuid) : null,
      p_tag_ids:        joins.tagIds        ? joins.tagIds.filter(_isUuid)        : null,
      p_custom_tag_ids: joins.customTagIds  ? joins.customTagIds.filter(_isUuid)  : null,
    })
    .then(function (res) {
      if (res.error) console.warn('update_observation failed:', res.error);
      return res;
    });
};

/* Observation templates — seeds (is_seed=true) are immutable; these helpers
   only touch teacher-owned custom templates (Q4). */
window.upsertObservationTemplate = function (cid, payload) {
  var sb = getSupabase();
  if (!sb) return Promise.resolve();
  if (!_isUuid(cid)) return Promise.resolve();
  payload = payload || {};
  return sb
    .rpc('upsert_observation_template', {
      p_id:                   _isUuid(payload.id) ? payload.id : null,
      p_course_id:            cid,
      p_body:                 payload.body || '',
      p_default_sentiment:    payload.defaultSentiment || null,
      p_default_context_type: payload.defaultContextType || null,
      p_display_order:        payload.displayOrder != null ? Number(payload.displayOrder) : null,
    })
    .then(function (res) {
      if (res.error) console.warn('upsert_observation_template failed:', res.error);
      return res;
    });
};

window.deleteObservationTemplate = function (tplId) {
  var sb = getSupabase();
  if (!sb) return Promise.resolve();
  if (!_isUuid(tplId)) return Promise.resolve();
  return sb
    .rpc('delete_observation_template', { p_id: tplId })
    .then(function (res) {
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

function _rpcOrNoop(name, params) {
  var sb = getSupabase();
  if (!sb) return Promise.resolve({ data: null, error: null });
  return sb.rpc(name, params).then(function (res) {
    if (res.error) console.warn(name + ' failed:', res.error);
    return res;
  });
}

/* Subject: upsert (p_id null for new), delete, reorder. */
window.v2.upsertSubject = function (params) {
  params = params || {};
  return _rpcOrNoop('upsert_subject', {
    p_id: _isUuid(params.id) ? params.id : null,
    p_course_id: params.courseId,
    p_name: params.name || '',
    p_display_order: params.displayOrder != null ? Number(params.displayOrder) : null,
  });
};
window.v2.deleteSubject = function (id) { return _rpcOrNoop('delete_subject', { p_id: id }); };
window.v2.reorderSubjects = function (ids) {
  return _rpcOrNoop('reorder_subjects', { p_ids: (ids || []).filter(_isUuid) });
};

/* CompetencyGroup. */
window.v2.upsertCompetencyGroup = function (params) {
  params = params || {};
  return _rpcOrNoop('upsert_competency_group', {
    p_id: _isUuid(params.id) ? params.id : null,
    p_course_id: params.courseId,
    p_name: params.name || '',
    p_color: params.color || null,
    p_display_order: params.displayOrder != null ? Number(params.displayOrder) : null,
  });
};
window.v2.deleteCompetencyGroup = function (id) { return _rpcOrNoop('delete_competency_group', { p_id: id }); };
window.v2.reorderCompetencyGroups = function (ids) {
  return _rpcOrNoop('reorder_competency_groups', { p_ids: (ids || []).filter(_isUuid) });
};

/* Section — course_id is auto-inferred from the owning subject. */
window.v2.upsertSection = function (params) {
  params = params || {};
  return _rpcOrNoop('upsert_section', {
    p_id: _isUuid(params.id) ? params.id : null,
    p_subject_id: params.subjectId,
    p_name: params.name || '',
    p_competency_group_id: _isUuid(params.competencyGroupId) ? params.competencyGroupId : null,
    p_display_order: params.displayOrder != null ? Number(params.displayOrder) : null,
  });
};
window.v2.deleteSection = function (id) { return _rpcOrNoop('delete_section', { p_id: id }); };
window.v2.reorderSections = function (ids) {
  return _rpcOrNoop('reorder_sections', { p_ids: (ids || []).filter(_isUuid) });
};

/* Tag. */
window.v2.upsertTag = function (params) {
  params = params || {};
  return _rpcOrNoop('upsert_tag', {
    p_id: _isUuid(params.id) ? params.id : null,
    p_section_id: params.sectionId,
    p_label: params.label || '',
    p_code: params.code || null,
    p_i_can_text: params.iCanText || null,
    p_display_order: params.displayOrder != null ? Number(params.displayOrder) : null,
  });
};
window.v2.deleteTag = function (id) { return _rpcOrNoop('delete_tag', { p_id: id }); };
window.v2.reorderTags = function (ids) {
  return _rpcOrNoop('reorder_tags', { p_ids: (ids || []).filter(_isUuid) });
};

/* Module. */
window.v2.upsertModule = function (params) {
  params = params || {};
  return _rpcOrNoop('upsert_module', {
    p_id: _isUuid(params.id) ? params.id : null,
    p_course_id: params.courseId,
    p_name: params.name || '',
    p_color: params.color || null,
    p_display_order: params.displayOrder != null ? Number(params.displayOrder) : null,
  });
};
window.v2.deleteModule = function (id) { return _rpcOrNoop('delete_module', { p_id: id }); };
window.v2.reorderModules = function (ids) {
  return _rpcOrNoop('reorder_modules', { p_ids: (ids || []).filter(_isUuid) });
};

/* Category — assessment weighting bucket (weight-cap trigger enforces ≤100). */
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
window.v2.deleteCategory = function (id) { return _rpcOrNoop('delete_category', { p_id: id }); };

/* Rubric — composite save: rubric row + criteria diff + criterion_tag replace,
   all in one transaction.  criteria payload:
     [{ id?: uuid, name, level_{1..4}_descriptor, level_{1..4}_value?,
        weight?, display_order?, linked_tag_ids?: uuid[] }, …]
   Criteria present in the array are upserted; criteria absent are deleted
   (cascades criterion_tag + rubric_score). */
window.v2.upsertRubric = function (params) {
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
  return _rpcOrNoop('upsert_rubric', {
    p_id: _isUuid(params.id) ? params.id : null,
    p_course_id: params.courseId,
    p_name: params.name || '',
    p_criteria: criteria,
  });
};
window.v2.deleteRubric = function (id) { return _rpcOrNoop('delete_rubric', { p_id: id }); };

/* ── v2 student-profile read + student-record writes (Phase 4.6) ─────────
   Reader: get_student_profile(p_enrollment_id) returns a composite jsonb
   payload with the enrollment + student + course rows, overall proficiency,
   letter grade, status counts, and arrays of notes / goals / reflections.
   Competency tree is left null by the deployed RPC — it will be filled in
   during Phase 4.5 learning-map composition work. */
window.v2.getStudentProfile = function (enrollmentId) {
  return _rpcOrNoop('get_student_profile', { p_enrollment_id: enrollmentId });
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
    p_section_id:    sectionId,
    p_body:          body || '',
  });
};

/* Reflection: one per (enrollment, section). confidence ∈ 1..5 or null. */
window.v2.saveReflection = function (enrollmentId, sectionId, body, confidence) {
  return _rpcOrNoop('upsert_reflection', {
    p_enrollment_id: enrollmentId,
    p_section_id:    sectionId,
    p_body:          body || '',
    p_confidence:    confidence != null ? Number(confidence) : null,
  });
};

/* SectionOverride: teacher-judgment level override per (enrollment, section).
   level ∈ 1..4; reason is optional free text. */
window.v2.saveSectionOverride = function (enrollmentId, sectionId, level, reason) {
  return _rpcOrNoop('upsert_section_override', {
    p_enrollment_id: enrollmentId,
    p_section_id:    sectionId,
    p_level:         Number(level),
    p_reason:        reason || null,
  });
};
window.v2.clearSectionOverride = function (enrollmentId, sectionId) {
  return _rpcOrNoop('clear_section_override', {
    p_enrollment_id: enrollmentId,
    p_section_id:    sectionId,
  });
};

/* Bulk attendance: apply one status to many students on one date. Status is
   free text (matches client "Present"/"Absent"/"Late" convention). */
window.v2.bulkAttendance = function (enrollmentIds, date, status) {
  return _rpcOrNoop('bulk_attendance', {
    p_enrollment_ids: (enrollmentIds || []).filter(_isUuid),
    p_date:           date,
    p_status:         status || '',
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
    p_preset:    preset,  // 'brief' | 'standard' | 'detailed'
  });
};

/* Full replace. If blocks_config diverges from a named preset's defaults,
   pass p_preset='custom' (or leave preset null — RPC defaults to 'custom'). */
window.v2.saveReportConfig = function (courseId, blocksConfig, preset) {
  return _rpcOrNoop('save_report_config', {
    p_course_id:     courseId,
    p_blocks_config: blocksConfig || {},
    p_preset:        preset || null,
  });
};

/* Flip a single block; server auto-sets preset='custom'. */
window.v2.toggleReportBlock = function (courseId, blockKey, enabled) {
  return _rpcOrNoop('toggle_report_block', {
    p_course_id: courseId,
    p_block_key: blockKey,
    p_enabled:   !!enabled,
  });
};

/* Teacher preferences — jsonb patch; omitted keys unchanged. */
window.v2.saveTeacherPreferences = function (patch) {
  return _rpcOrNoop('save_teacher_preferences', { p_patch: patch || {} });
};

/* Soft-delete / restore for account-level lifecycle (Pass C §5). */
window.v2.softDeleteTeacher = function () { return _rpcOrNoop('soft_delete_teacher', {}); };
window.v2.restoreTeacher    = function () { return _rpcOrNoop('restore_teacher',    {}); };

/* ── v2 Imports (Phase 4.9) ───────────────────────────────────────────
   Three flows share this surface; each returns per-section row counts. */

/* CSV roster — alias the Phase 4.1 helper under v2 for naming consistency. */
window.v2.importRosterCsv = function (courseId, rows) {
  return _rpcOrNoop('import_roster_csv', {
    p_course_id: courseId,
    p_rows:      rows || [],
  });
};

/* Teams (§15.2). Creates Course + ReportConfig + Students + Enrollments +
   Assessments from a parsed Microsoft Teams export. Scores are not imported
   — Teams files don't carry score data in this flow.

   payload: { class_name, grade_level?, timezone?,
              students:[{first_name, last_name?, preferred_name?, pronouns?,
                         student_number?, email?, date_of_birth?}],
              assignments:[{title, description?, date_assigned?, due_date?,
                            score_mode?, max_points?, weight?}] } */
window.v2.importTeamsClass = function (payload) {
  return _rpcOrNoop('import_teams_class', { p_payload: payload || {} });
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

window.v2.saveTermRating = function (enrollmentId, term, payload) {
  payload = payload || {};
  var wire = {};
  if ('narrativeHtml' in payload)        wire.narrative_html       = payload.narrativeHtml;
  if ('workHabitsRating' in payload)     wire.work_habits_rating   = payload.workHabitsRating;
  if ('participationRating' in payload)  wire.participation_rating = payload.participationRating;
  if ('socialTraits' in payload)         wire.social_traits        = payload.socialTraits || [];
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
  return _rpcOrNoop('save_term_rating', {
    p_enrollment_id: enrollmentId,
    p_term:          Number(term),
    p_payload:       wire,
  });
};

/* Custom tag — per §12, create-only path (no edit/delete inventoried). */
window.createCustomTag = function (cid, label) {
  var sb = getSupabase();
  if (!sb) return Promise.resolve();
  if (!_isUuid(cid)) return Promise.resolve();
  return sb
    .rpc('create_custom_tag', { p_course_id: cid, p_label: label || '' })
    .then(function (res) {
      if (res.error) console.warn('create_custom_tag failed:', res.error);
      return res;
    });
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
function saveCustomTags(cid, arr) {
  _saveCourseField('customTags', cid, arr);
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
  if (_useSupabase && localStorage.getItem('gb-demo-mode') !== '1' && _isUuid(cid)) {
    var student = getStudents(cid).find(function (s) {
      return s.id === sid;
    });
    var canonicalStudentId = student && _isUuid(student.personId) ? student.personId : null;
    if (canonicalStudentId) {
      var sb = getSupabase();
      if (sb) {
        sb.rpc('upsert_term_rating', {
          p_course_offering_id: cid,
          p_student_id: canonicalStudentId,
          p_term_id: termId,
          p_patch: all[sid][termId],
        }).then(function (res) {
          if (res.error) console.warn('upsert_term_rating RPC failed:', res.error);
        });
      }
    }
  }
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
  if (_useSupabase && cid) {
    const sb = getSupabase();
    if (sb) {
      sb.rpc('save_report_config', { p_course_offering_id: cid, p_config: config || {} }).then(function (res) {
        if (res.error) console.warn('save_report_config RPC failed:', res.error);
      });
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

function getCardWidgetConfig() {
  var raw = _safeParseLS('m-card-widgets', null);
  if (!raw || !Array.isArray(raw.order)) return _defaultWidgetConfig();

  // Filter out unknown keys
  var validKeys = new Set(WIDGET_KEYS);
  var order = raw.order.filter(function (k) {
    return validKeys.has(k);
  });
  var disabled = Array.isArray(raw.disabled)
    ? raw.disabled.filter(function (k) {
        return validKeys.has(k);
      })
    : [];

  // Find any registry keys missing from both arrays (future-proofing)
  var present = new Set(order.concat(disabled));
  WIDGET_KEYS.forEach(function (k) {
    if (!present.has(k)) disabled.push(k);
  });

  return { order: order, disabled: disabled };
}

function saveCardWidgetConfig(config) {
  _safeLSSet('m-card-widgets', JSON.stringify(config));
}

function clearCardWidgetConfig() {
  try {
    localStorage.removeItem('m-card-widgets');
  } catch (e) {
    /* storage error */
  }
}

/* ── Namespace ──────────────────────────────────────────────── */
var _mobileRerender = null;

window.GB = {
  getSyncStatus,
  getLastSyncedAt,
  retrySyncs,
  refreshFromSupabase: _refreshFromSupabase,
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
  saveScores,
  upsertScore,
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
    s.src = '/shared/seed-data.js';
    s.onload = function () {
      if (typeof seedIfNeeded === 'function') seedIfNeeded();
      resolve();
    };
    s.onerror = resolve;
    document.head.appendChild(s);
  });
};
