/* Withdrawn students: withdrawStudent, reenrolStudent, the Withdrawn list (getWithdrawnStudents), permanent delete (deleteWithdrawnStudent),
   putting a withdrawn student's records aside and back, and forgetStudentServerState. Moved from shared/data.js on 2026-11-12 (S19 split, move only). */

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
   takes a withdrawn student.

   The table is built when it is read, not while this file loads, so a
   getter can live in a file that loads later. */
function _withdrawnRecordFields() {
  return {
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
}

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
  var fields = _withdrawnRecordFields();
  Object.keys(fields).forEach(function (field) {
    var all = fields[field](cid) || {};
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
  var fields = _withdrawnRecordFields();
  Object.keys(fields).forEach(function (field) {
    if (records[field] === undefined) return;
    var all = fields[field](cid) || {};
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
