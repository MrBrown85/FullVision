/* Student records kept beside the marks: flags, goals and goal dates, Core Competency self-assessments,
   reflections and notes; and the class's modules. Moved from shared/data.js on 2026-11-12 (S19 split, move only). */

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
