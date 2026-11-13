/* Classes and reporting terms: createCourse, updateCourse, deleteCourseData, the grading scale, reporting terms and term spans, switching class,
   load timings and blocks. Moved from shared/data.js on 2026-11-12 (S19 split, move only). loadCourses, saveCourses, COURSES, getActiveCourse and isCourseArchived stayed. */

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
    'assessment-resources',
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
