/* Term ratings and report preferences: the Term Questionnaire's ratings, comments and attendance, the report setup,
   and the teacher's card, dashboard and view settings. Moved from shared/data.js on 2026-11-12 (S19 split, move only). */

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
