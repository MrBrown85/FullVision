/* Class settings: saveConfig, getCourseConfig and saveCourseConfig, the changed-only settings patch and the old-settings write guard.
   Moved from shared/data.js on 2026-11-12 (S19 split, move only). getConfig stayed in shared/data.js. */

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
