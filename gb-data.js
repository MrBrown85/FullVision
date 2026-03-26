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

function getSyncStatus() {
  return { status: _syncStatus, pending: _pendingSyncs };
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
      if (e.data && e.data.type === 'data-changed' && !_crossTabAlerted) {
        _crossTabAlerted = true;
        if (typeof showSyncToast === 'function') {
          // Dismiss after showing — we'll use a custom element so it doesn't auto-dismiss
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
    };
  } catch (e) {
    // BroadcastChannel not supported — fall back to storage event
  }
  // Fallback: storage event fires cross-tab when localStorage changes
  window.addEventListener('storage', function(e) {
    if (e.key && e.key.startsWith('gb-') && !_crossTabAlerted) {
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

  // Delegated click handler for cross-tab reload buttons
  document.addEventListener('click', function(e) {
    var btn = e.target.closest('[data-action="reload-cross-tab"]');
    if (btn) {
      _crossTabAlerted = false;
      window.location.reload();
    }
  });
}

function _broadcastChange(cid, field) {
  if (_crossTabChannel) {
    try { _crossTabChannel.postMessage({ type: 'data-changed', cid: cid, field: field }); } catch (e) {}
  }
}

/* ══════════════════════════════════════════════════════════════════
   Supabase sync helpers (fire-and-forget)
   ══════════════════════════════════════════════════════════════════ */
let _hadSyncError = false;
let _retryQueue = [];
let _retryTimer = null;
let _retryCount = 0;
const _MAX_RETRIES = 6;

function _syncToSupabase(table, key, data) {
  _doSync(table, key, data).catch(err => console.error(`Sync error (${table}/${key}):`, err));
}

async function _doSync(table, key, data) {
  const sb = getSupabase();
  if (!sb || !_teacherId) return;

  _pendingSyncs++;
  _syncStatus = 'syncing';
  _updateSyncIndicator();

  try {
    if (table === 'course_data') {
      const { error } = await sb.from('course_data').upsert({
        teacher_id: _teacherId,
        course_id: key.cid,
        data_key: key.dataKey,
        data: data,
        updated_at: new Date().toISOString()
      }, { onConflict: 'teacher_id,course_id,data_key' });
      if (error) throw error;
    } else if (table === 'teacher_config') {
      const { error } = await sb.from('teacher_config').upsert({
        teacher_id: _teacherId,
        config_key: key,
        data: data,
        updated_at: new Date().toISOString()
      }, { onConflict: 'teacher_id,config_key' });
      if (error) throw error;
    }
    _pendingSyncs--;
    if (_pendingSyncs <= 0) { _pendingSyncs = 0; _syncStatus = 'idle'; _retryCount = 0; }
    _updateSyncIndicator();
    // Show recovery toast if we previously had an error
    if (_hadSyncError && _syncStatus === 'idle') {
      _hadSyncError = false;
      if (typeof showSyncToast === 'function') showSyncToast('All changes synced', 'success');
    }
  } catch (err) {
    _pendingSyncs--;
    if (_pendingSyncs <= 0) _pendingSyncs = 0;
    _syncStatus = 'error';
    _updateSyncIndicator();
    // Show error toast and queue retry
    if (!_hadSyncError) {
      _hadSyncError = true;
      if (typeof showSyncToast === 'function') showSyncToast('Sync failed \u2014 changes saved locally', 'error');
    }
    _retryQueue.push({ table, key, data });
    if (!_retryTimer) {
      var delay = Math.min(10000 * Math.pow(2, _retryCount), 300000);
      _retryTimer = setTimeout(_retryFailedSyncs, delay);
    }
    throw err;
  }
}

function _retryFailedSyncs() {
  _retryTimer = null;
  _retryCount++;
  if (_retryCount > _MAX_RETRIES) {
    console.warn('Sync retry limit reached, dropping', _retryQueue.length, 'items');
    _retryQueue = [];
    _retryCount = 0;
    return;
  }
  const queue = _retryQueue.splice(0);
  queue.forEach(item => _syncToSupabase(item.table, item.key, item.data));
}

function retrySyncs() {
  clearTimeout(_retryTimer);
  _retryCount = 0;
  _retryFailedSyncs();
}

async function _deleteFromSupabase(table, key) {
  const sb = getSupabase();
  if (!sb || !_teacherId) return;
  try {
    if (table === 'course_data') {
      const { error } = await sb.from('course_data').delete()
        .eq('teacher_id', _teacherId)
        .eq('course_id', key.cid)
        .eq('data_key', key.dataKey);
      if (error) throw error;
    }
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

  // Start cross-tab conflict detection
  _initCrossTab();
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
    const { data: rows, error } = await sb.from('course_data')
      .select('data_key, data')
      .eq('teacher_id', _teacherId)
      .eq('course_id', cid);

    if (error) {
      console.error('Failed to load course_data for', cid, error);
      // Fall through to localStorage
    } else {
      const byKey = {};
      (rows || []).forEach(r => { byKey[r.data_key] = r.data; });

      // Populate cache from Supabase rows
      for (const [field, dataKey] of Object.entries(_DATA_KEYS)) {
        _cache[field][cid] = byKey[dataKey] !== undefined ? byKey[dataKey] : _defaultForField(field);
      }

      // If Supabase had no data for this course, use empty defaults
      // (seedIfNeeded will populate demo data if appropriate)
      if (!rows || rows.length === 0) {
        for (const [field] of Object.entries(_DATA_KEYS)) {
          _cache[field][cid] = _defaultForField(field);
        }
      }
      // Fall back to built-in learning map if none stored
      const lm = _cache.learningMaps[cid];
      if (!lm || (!lm._customized && (!lm.sections || lm.sections.length === 0))) {
        _cache.learningMaps[cid] = LEARNING_MAP[cid] || { subjects: [], sections: [] };
      }
      return;
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
  // Push all cached course data to Supabase in background
  for (const [field, dataKey] of Object.entries(_DATA_KEYS)) {
    const val = _cache[field][cid];
    if (val !== undefined && val !== null) {
      _syncToSupabase('course_data', { cid, dataKey }, val);
    }
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
    _safeLSSet(key, value);
  } catch (e) {
    console.warn('localStorage write failed (' + key + '):', e);
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

/* Helper: write to cache + sync */
function _saveCourseField(field, cid, value) {
  _cache[field][cid] = value;
  if (_PROF_FIELDS.includes(field) && typeof clearProfCache === 'function') clearProfCache();
  const dataKey = _DATA_KEYS[field];
  if (_useSupabase) {
    _syncToSupabase('course_data', { cid, dataKey }, value);
  } else {
    _safeLSSet('gb-' + dataKey + '-' + cid, JSON.stringify(value));
  }
  _broadcastChange(cid, field);
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

function sortStudents(arr, mode) {
  var c = arr.slice();
  if (mode === 'firstName') return c.sort(function(a,b){ return (a.firstName||'').localeCompare(b.firstName||'') || (a.lastName||'').localeCompare(b.lastName||''); });
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
function uid() { return 's' + Date.now() + Math.random().toString(36).slice(2,6); }
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

function deleteCourseData(id) {
  // Clear localStorage
  ['students','assessments','scores','overrides','courseconfig','learningmap',
   'modules','rubrics','statuses','quick-obs','term-ratings','notes',
   'flags','goals','reflections','custom-tags','report-config']
    .forEach(k => localStorage.removeItem('gb-'+k+'-'+id));

  // Clear cache
  for (const field of Object.keys(_DATA_KEYS)) {
    delete _cache[field][id];
  }

  // Delete from Supabase
  if (_useSupabase) {
    const sb = getSupabase();
    if (sb) {
      sb.from('course_data').delete()
        .eq('teacher_id', _teacherId)
        .eq('course_id', id)
        .then(({ error }) => { if (error) console.error('Failed to delete course_data for', id, error); });
    }
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
    const resp = await fetch('curriculum_by_course.json');
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
  _saveCourseField('learningMaps', cid, map);
}
function resetLearningMap(cid) {
  _cache.learningMaps[cid] = LEARNING_MAP[cid] || { subjects: [], sections: [] };
  if (_useSupabase) {
    _deleteFromSupabase('course_data', { cid, dataKey: 'learningmap' });
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
function getAllTags(cid) { return getSections(cid).flatMap(s => s.tags); }
function getTagById(cid, tagId) { return getAllTags(cid).find(t => t.id === tagId); }
function getSectionForTag(cid, tagId) { return getSections(cid).find(s => s.tags.some(t => t.id === tagId)); }

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
function saveAssessments(cid, arr) { _saveCourseField('assessments', cid, arr); }
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
  tagIds.forEach(tid => {
    const entry = scores[sid].find(e => e.assessmentId === aid && e.tagId === tid);
    if (entry) { entry.score = rawScore; }
    else if (rawScore > 0) {
      scores[sid].push({ id: uid(), assessmentId: aid, tagId: tid, score: rawScore, date: assess.date || new Date().toISOString().slice(0,10), type: assess.type || 'summative', note: '', created: new Date().toISOString() });
    }
  });
  saveScores(cid, scores);
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
  saveQuickObs(cid, all);
}

function deleteQuickOb(cid, sid, obId) {
  const all = getQuickObs(cid);
  if (!all[sid]) return;
  all[sid] = all[sid].filter(o => o.id !== obId);
  saveQuickObs(cid, all);
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
window.GB = {
  getSyncStatus,
  retrySyncs,
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
