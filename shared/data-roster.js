/* The class list: getStudents and saveStudents, the save to the server (_persistStudentsToCanonical: enrol, update, withdraw),
   and the roster helpers (window.reorderRoster, bulkApplyPronouns, importRosterCsv, setEnrollmentFlag). Moved from shared/data.js on 2026-11-12 (S19 split, move only). */

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
   - prev student missing from arr → withdraw_student (Class Settings
     withdraws through withdrawStudent, which keeps the baseline in step) */
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

/* v2 withdraw_student(p_enrollment_id) — sets withdrawn_at; nothing is deleted. */
function _canonicalWithdrawEnrollment(sb, enrollmentId) {
  return _writeRpc('withdraw_student', { p_enrollment_id: enrollmentId }).then(function (res) {
    if (res.error) console.warn('withdraw_student failed:', res.error, enrollmentId);
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
