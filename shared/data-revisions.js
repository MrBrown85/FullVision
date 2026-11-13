/* Revisions: returning work for another try (Return for Revision, its edit and Take Back, the student's revision in Demo Mode, Before and After).
   Moved from shared/data.js on 2026-11-12 (S19 split, move only). */

/* ══════════════════════════════════════════════════════════════════
   Revisions: returning work for another try (S11)
   ══════════════════════════════════════════════════════════════════
   Return for Revision returns the work, then asks the student for another
   try: What to Fix, Revise By, which criteria, and whether the grade is
   kept or hidden until the new version is graded. The student's revision
   is the next version of the piece's submission (version 2, then 3);
   version 1 and its pages stay. The revision is graded in the SAME score
   rows, so the Draft and Returned rule (shared/grade-state.js) does the
   rest with no change:
   - while the new grade is a draft the student and every family output
     keep the grade they were given (the returned copy);
   - when it is returned it replaces the old one, in every number; the old
     grade is no longer in any set of scores;
   - the first version's grade is kept on the request as history
     (first_grade): "Was Developing + on the Oct 30 version", Before and
     After.
   Hide (keep_grade false) is the server's C2 (2026111121, not applied): the
   grade_return row becomes a draft never returned, so the student page and
   every report count nothing for it (a hidden grade is a draft, Q5);
   returning the new version's grade ends the hide; Take Back gives the
   grade back exactly as the student had it. Only a class that holds
   grades can hide one (hide_needs_holding).

   Shapes are the server's (migrations/local-test/batch-c-contract.md on
   batch-c-markup-reflect-revise, read at commit 65d550dc; PR 1043, not
   applied): return_for_revision, set_revision_request, cancel_revision,
   list_course_feedback.revisions, the student's feedback(...).revision,
   revision_start + revision_finish (one call here), revision_unsend. Each
   shape is made in one function (_revisionRow, _studentRevisionOf), so
   S11-W1 changes one place.

   A request's state: open (no revision in), sent (in, grading not
   started), grading (the grade changed since it came in, or the teacher's
   marks are on one of its pages), returned (a grade was returned after it
   came in), cancelled. An open request's state is read live; once closed
   (returned or cancelled) it is stored and stays closed, whatever happens
   to the work afterwards. A student's own shape says sent for grading: a
   draft is never theirs to see. Marks on a revision's pages lock it as a
   grade does: the student can no longer Unsend it or send it again.

   Behind the build switch and Send Work (revisionsOn), as the plan's S11
   says: with either off every reader here shows nothing and every writer
   answers revisions_off. DEMO MODE ONLY, in gb-student-feedback-<cid>
   (field `revisions`, by request id) and the student work's own
   submissions (gb-student-work-<cid>). A signed-in class's requests are the
   server's (_fbRevisions, from list_course_feedback with this device's
   unanswered Return for Revision, edits and Take Backs laid over them): the
   teacher's writers go to return_for_revision, set_revision_request and
   cancel_revision through the outbox. The student's own writers here are
   Demo Mode's and answer { ok: false, error: 'not_available' } signed in
   (a real student sends through the revision routes: S11-W1, student side). */
var REVISION_FIX_MAX = 2000;

/* True when the class's revisions show: Demo Mode, or a signed-in class the
   server keeps rows for, with the build switch and Send Work on. */
function revisionsOn(cid) {
  if (!cid || !(_isDemoSession() || _fbOn(cid))) return false;
  return !!getReturnSettings(cid).student_page && getCourseSendWork(cid).send_work === true;
}

function _revisionsOf(stored) {
  return stored && _plainObject(stored.revisions) ? stored.revisions : {};
}

// The working copy of one cell, as the rule keeps it (GradeState.copyOf), or null.
function _revisionWorking(cid, sid, aid) {
  var a = _assessmentById(cid, aid);
  var cell = (_gradeCells(getScores(cid), getRubricChecks(cid))[aid] || {})[sid];
  return a && cell ? GradeState.copyOf(_gradeOf(a, cell.entries, cell.checks)) : null;
}

/* How a piece is scored now, as GradeState.partInUse takes it: the same
   reading as shared/student-view.js's scoringOf (the part of a grade a
   student is given). */
function _revisionScoring(cid, a) {
  if (isPointsScored(a)) return { kind: 'points' };
  var rubricId = a.rubricId || a.rubric_id;
  if (rubricId) {
    var criteria = ((getRubricById(cid, rubricId) || {}).criteria || []).filter(Boolean);
    var checks = [];
    criteria.forEach(function (c) {
      (c.checks || []).forEach(function (k) {
        if (k && k.id) checks.push(String(k.id));
      });
    });
    return {
      kind: 'rubric',
      criteria: criteria.map(function (c) {
        return String(c.id);
      }),
      checks: checks,
    };
  }
  var tags = scoreTagIds(a, cid).filter(function (id) {
    return !isUnlinkedTag(id);
  });
  return tags.length ? { kind: 'competencies', tags: tags } : { kind: 'overall' };
}

// The handed-in submission a request's revision is, or null (none sent, unsent or deleted).
function _revisionSubmission(cid, r) {
  if (!r || !r.revision_submission_id) return null;
  return (
    _studentWorkSubmissions(cid).find(function (s) {
      return s.id === r.revision_submission_id;
    }) || null
  );
}

/* A request's state: open, sent, grading, returned or cancelled. A closed
   request (taken back, or its revision's grade returned) is kept closed,
   as the server keeps state 'done' and closed_at: whatever happens to the
   work afterwards (Delete Work, Replace Them), it never opens again. An
   open one is read live from the submissions, the grade_return row and
   the teacher's marks. */
function _revisionState(cid, r) {
  // A signed-in class's request: the server's own reading of it (_revision_state).
  if (r._live) return r.state;
  if (r.cancelled_at) return 'cancelled';
  if (r.closed_at) return 'returned';
  var sub = _revisionSubmission(cid, r);
  if (!sub) return 'open';
  if (_revisionReturnedSince(cid, r)) return 'returned';
  var now = _revisionWorking(cid, r.enrollment_id, r.assessment_id);
  if (!GradeState.sameCopy(now, r.revision_grade_at_send)) return 'grading';
  // The teacher's marks on one of the revision's pages: grading has started.
  return _teacherMarksOnWork(cid, r.enrollment_id, r.assessment_id, sub.id) ? 'grading' : 'sent';
}
// A grade was returned at or after the revision came in (a save in the same instant counts).
function _revisionReturnedSince(cid, r) {
  if (!r.revision_sent_at) return false;
  var row = getGradeReturn(cid, r.enrollment_id, r.assessment_id);
  return !!row && !!row.returned_at && String(row.returned_at) >= String(r.revision_sent_at);
}
function _revisionIsOpen(state) {
  return state === 'open' || state === 'sent' || state === 'grading';
}

/* The grade is hidden now: Hide was chosen, the request is not taken back,
   and no Return has ended the hide. Only a Return ends it: whatever else
   the teacher does to the score (a regrade, Clear Score, which takes the
   never-returned row away), the grade stays hidden and Take Back gives the
   student back what the request kept (hidden_row, first_grade). */
function _revisionHidden(cid, r) {
  if (r._live) return false; // Hide is not built: the grade is always kept
  if (!r.hidden || r.cancelled_at || r.hide_ended_at) return false;
  var row = getGradeReturn(cid, r.enrollment_id, r.assessment_id);
  return !row || !row.returned_at;
}

// When a request closed: Take Back, or the return of the revision's grade.
function _revisionClosedAt(cid, r, state) {
  if (r._live) return r.closed_at || null;
  if (state === 'cancelled') return r.cancelled_at;
  if (state !== 'returned') return null;
  if (r.closed_at) return r.closed_at;
  var row = getGradeReturn(cid, r.enrollment_id, r.assessment_id);
  return (row && row.returned_at) || null;
}

/* After any grade_return row is saved (_saveGradeReturns), in Demo Mode:
   each request whose revision's grade has now been returned is closed for
   good (closed_at, as the server's state 'done'), and each hide a Return
   has ended is ended for good (hide_ended_at). Stored, so nothing done to
   the work or the score afterwards opens a request or hides a grade
   again. A request taken back is passed over (Take Back closes it first). */
function _revisionsAfterRowSave(cid) {
  if (!cid || !_isDemoSession()) return;
  var all = _revisionsOf(_studentFeedbackStored(cid));
  var changes = {};
  Object.keys(all).forEach(function (id) {
    var r = all[id];
    if (!_plainObject(r) || r.cancelled_at) return;
    var row = getGradeReturn(cid, r.enrollment_id, r.assessment_id);
    if (!row || !row.returned_at) return;
    var patch = {};
    if (r.hidden && !r.hide_ended_at) patch.hide_ended_at = row.returned_at;
    if (!r.closed_at && _revisionSubmission(cid, r) && _revisionReturnedSince(cid, r))
      patch.closed_at = row.returned_at;
    if (Object.keys(patch).length) changes[id] = patch;
  });
  var ids = Object.keys(changes);
  if (!ids.length) return;
  var draft = _studentFeedbackDraft(cid);
  ids.forEach(function (id) {
    if (draft.revisions[id]) Object.assign(draft.revisions[id], changes[id]);
  });
  _studentFeedbackWrite(cid, draft);
}

/* Every request of the class on a student and a piece still in it, oldest
   first. [] while revisionsOn is false. */
function _classRevisions(cid) {
  if (!revisionsOn(cid)) return [];
  var all = _revisionsOf(_studentFeedbackStored(cid));
  var students = {};
  (getStudents(cid) || []).forEach(function (s) {
    if (s && s.id) students[s.id] = true;
  });
  return (
    _isDemoSession()
      ? Object.keys(all).map(function (id) {
          return all[id];
        })
      : _fbRevisions(cid)
  )
    .filter(function (r) {
      return _plainObject(r) && students[r.enrollment_id] && _assessmentById(cid, r.assessment_id);
    })
    .sort(function (x, y) {
      return String(x.created_at) < String(y.created_at) ? -1 : String(x.created_at) > String(y.created_at) ? 1 : 0;
    });
}

// The newest request for one student and piece, cancelled or not, or null.
function _revisionNewest(cid, sid, aid) {
  var mine = _classRevisions(cid).filter(function (r) {
    return r.enrollment_id === sid && r.assessment_id === aid;
  });
  return mine[mine.length - 1] || null;
}
// The open request for one student and piece, or null.
function _revisionOpen(cid, sid, aid) {
  var r = _revisionNewest(cid, sid, aid);
  return r && _revisionIsOpen(_revisionState(cid, r)) ? r : null;
}

/* The teacher's shape of a request: return_for_revision's `request` and
   each item of list_course_feedback.revisions. first_grade is the raw copy
   ("Was Developing + on the Oct 30 version"). */
function _revisionRow(cid, r) {
  var state = _revisionState(cid, r);
  if (r._live) {
    var kept = Object.assign({}, _studentWorkCopy(r));
    delete kept._live;
    return kept;
  }
  return {
    id: r.id,
    assessment_id: r.assessment_id,
    enrollment_id: r.enrollment_id,
    what_to_fix: r.what_to_fix,
    revise_by: r.revise_by || null,
    criterion_ids: (r.criterion_ids || []).slice(),
    keep_grade: r.keep_grade !== false,
    grade_hidden: _revisionHidden(cid, r),
    first_submission_id: r.first_submission_id || null,
    first_version: r.first_version || 1,
    first_grade: _studentWorkCopy(r.first_grade) || null,
    first_returned_at: r.first_returned_at || null,
    created_at: r.created_at,
    updated_at: r.updated_at,
    closed_at: _revisionClosedAt(cid, r, state),
    state: state,
    revision_submission_id: state === 'open' || state === 'cancelled' ? null : r.revision_submission_id,
    revision_version: state === 'open' || state === 'cancelled' ? null : r.revision_version,
    revision_sent_at: state === 'open' || state === 'cancelled' ? null : r.revision_sent_at,
    revision_note: state === 'open' || state === 'cancelled' ? null : r.revision_note || null,
    revision_late: state === 'open' || state === 'cancelled' ? null : !!r.revision_late,
    revision_sent_by: state === 'open' || state === 'cancelled' ? null : r.revision_sent_by || 'student',
  };
}

/* The request on one student's piece, for the teacher's screens (the
   grader's Revision card, "Was … on the Oct 30 version", Take Back): the
   newest one, cancelled or not, as _revisionRow, or null. */
function getRevisionRequest(cid, sid, aid) {
  var r = _revisionNewest(cid, sid, aid);
  return r ? _revisionRow(cid, r) : null;
}

/* What the gradebook cell, the counts and the dashboard ask of one
   student's piece: 'revising' (returned for revision, nothing in yet: the
   cell's Revising), 'revised' (the revision is in and grading has not
   started: To Grade, and the dashboard's "1 Revised"), 'grading' (the new
   grade is a draft: To Return), or null (no open request, revisionsOn
   false, or Missing or Excused on the piece, which show their status). */
function revisionWorkState(cid, sid, aid) {
  var r = _revisionOpen(cid, sid, aid);
  if (!r) return null;
  var status = getAssignmentStatus(cid, sid, aid);
  if (status === 'NS' || status === 'EXC') return null;
  var state = _revisionState(cid, r);
  return state === 'open' ? 'revising' : state === 'sent' ? 'revised' : 'grading';
}

/* The student's shape of their request (feedback(...).revision), or null
   when there is none or it was taken back. first_grade is the first
   version's grade as the student had it, cut to what the work is scored by
   now; null while the grade is hidden, or Missing or Excused is on the
   piece. The new grade is the returned set's. */
function _studentRevisionOf(cid, sid, a) {
  var r = _revisionNewest(cid, sid, a.id);
  if (!r) return null;
  var state = _revisionState(cid, r);
  if (state === 'cancelled') return null;
  var status = getAssignmentStatus(cid, sid, a.id);
  var hidden = _revisionHidden(cid, r);
  var firstSub = r.first_submission_id
    ? _studentWorkSubmissions(cid).find(function (s) {
        return s.id === r.first_submission_id;
      })
    : null;
  var inNow = state !== 'open';
  return {
    // A draft is not the student's to see: grading reads as sent.
    state: state === 'grading' ? 'sent' : state,
    what_to_fix: r.what_to_fix,
    revise_by: r.revise_by || null,
    criterion_ids: (r.criterion_ids || []).slice(),
    keep_grade: r.keep_grade !== false,
    grade_hidden: hidden,
    first_version: r.first_version || 1,
    first_sent_at: (firstSub && firstSub.sent_at) || null,
    first_grade:
      hidden || status === 'NS' || status === 'EXC'
        ? null
        : GradeState.partInUse(r.first_grade, _revisionScoring(cid, a)),
    revision_version: inNow ? r.revision_version : null,
    revision_sent_at: inNow ? r.revision_sent_at : null,
    revision_note: inNow ? r.revision_note || null : null,
    revision_late: inNow ? !!r.revision_late : null,
    asked_at: r.created_at,
  };
}

/* One student's own revision on one piece (Needs Revision, Send My
   Revision, Before and After), in the student's shape, or null. */
function getStudentRevision(cid, sid, aid) {
  var a = _assessmentById(cid, aid);
  return a ? _studentRevisionOf(cid, sid, a) : null;
}

/* Every handed-in version of one student's work on a piece, oldest first
   (version 1, then the revisions): the grader's New and First pages side
   by side, and Before and After's two photos. Each as getStudentSubmission
   gives one. getStudentSubmission is still the newest. */
function getSubmissionVersions(cid, sid, aid) {
  return _studentWorkSubmissions(cid)
    .filter(function (s) {
      return s.enrollment_id === sid && s.assessment_id === aid;
    })
    .sort(function (x, y) {
      return (x.version || 1) - (y.version || 1);
    });
}

/* The first version's result, worked out by calc.js as the student page
   works out any result (assessmentCellValue on returned grades), with this
   one piece read as the request's first_grade: Before and After's "2.7 ·
   67%". `forStudent`: null while the grade is hidden. null with no request
   or no first grade, and while Missing or Excused is on the piece (the
   cell would show the status). Nothing is kept: every grade outside this
   call is as before. */
function getRevisionFirstCell(cid, sid, aid, forStudent) {
  var r = _revisionNewest(cid, sid, aid);
  var a = _assessmentById(cid, aid);
  if (!r || !a || !r.first_grade || r.cancelled_at) return null;
  if (forStudent && _revisionHidden(cid, r)) return null;
  var status = getAssignmentStatus(cid, sid, aid);
  if (status === 'NS' || status === 'EXC') return null;
  var copy = GradeState.partInUse(r.first_grade, _revisionScoring(cid, a));
  if (!copy) return null;
  var working = getScores(cid) || {};
  var own = (Array.isArray(working[sid]) ? working[sid] : []).filter(function (e) {
    return e && e.assessmentId === aid;
  });
  _firstVersionScope = { cid: cid, sid: sid, aid: aid, entries: _gradeCopyEntries(cid, sid, aid, copy, own, working) };
  clearProfCache();
  try {
    return withReturnedOnly(function () {
      return assessmentCellValue(cid, sid, a);
    });
  } finally {
    _firstVersionScope = null;
    clearProfCache();
  }
}

/* A request as return_for_revision takes it: { what_to_fix, revise_by,
   criterion_ids, keep_grade }, tidied, or null when it is not one.
   `patch`: set_revision_request's, any of the first three. */
function _revisionRequestOk(cid, a, req, patch) {
  if (!_plainObject(req)) return null;
  var names = Object.keys(req);
  var allowed = patch ? ['what_to_fix', 'revise_by', 'criterion_ids'] : null;
  if (
    allowed &&
    (!names.length ||
      names.some(function (k) {
        return allowed.indexOf(k) < 0;
      }))
  ) {
    return null;
  }
  var out = {};
  if (!patch || 'what_to_fix' in req) {
    var fix = req.what_to_fix;
    if (typeof fix !== 'string' || !fix.trim() || fix.length > REVISION_FIX_MAX) return null;
    out.what_to_fix = fix;
  }
  if (!patch || 'revise_by' in req) {
    var by = req.revise_by == null ? null : req.revise_by;
    if (by !== null && (typeof by !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(by) || isNaN(Date.parse(by)))) {
      return null;
    }
    out.revise_by = by;
  }
  if (!patch || 'criterion_ids' in req) {
    var ids = req.criterion_ids == null ? [] : req.criterion_ids;
    if (!Array.isArray(ids)) return null;
    // Criteria of the piece's rubric, and nothing on work with none.
    var rubricId = a.rubricId || a.rubric_id;
    var on = ((rubricId && getRubricById(cid, rubricId)) || {}).criteria || [];
    var known = on.filter(Boolean).map(function (c) {
      return String(c.id);
    });
    var ok = ids.every(function (id) {
      return typeof id === 'string' && known.indexOf(id) >= 0;
    });
    if (!ok) return null;
    out.criterion_ids = ids.filter(function (id, i) {
      return ids.indexOf(id) === i;
    });
  }
  if (!patch) {
    if (typeof req.keep_grade !== 'boolean') return null;
    out.keep_grade = req.keep_grade;
  }
  return out;
}

// A row with its nulls left out, or null when it says nothing (as the rule keeps rows).
function _revisionRowKept(row) {
  if (!row) return null;
  var out = { is_draft: !!row.is_draft };
  ['returned_at', 'returned_copy', 'previous_copy', 'updated_at', 'seen_at'].forEach(function (f) {
    if (row[f] != null) out[f] = row[f];
  });
  return out.is_draft || Object.keys(out).length > 1 ? out : null;
}
function _revisionSetRow(cid, sid, aid, row) {
  var rows = getGradeReturns(cid);
  var out = Object.assign({}, rows);
  out[aid] = Object.assign({}, out[aid]);
  var kept = _revisionRowKept(row);
  if (kept) out[aid][sid] = kept;
  else delete out[aid][sid];
  if (!Object.keys(out[aid]).length) delete out[aid];
  _saveGradeReturns(cid, out);
}

/* The server's answer to a revision write, a few seconds at most: null when
   there is none (offline, slow), and the screen goes on as if it landed. */
function _fbWaitAnswer(sent) {
  var late = new Promise(function (resolve) {
    setTimeout(resolve, _MARKUP_SAVE_WAIT_MS, null);
  });
  return Promise.race([Promise.resolve(sent), late]);
}
function _fbRefused(res) {
  return !!(res && res.error && /P0002|not found/i.test(String(res.error.code || res.error.message || '')));
}

/* Return for Revision for a live class: the work is returned as Return
   returns it (returnWork: the grade and the marks, one call), then
   return_for_revision, which returns it again (nothing left to return) and
   makes the request; both in the student's cell order. The request shows
   open at once. The Promise answers as the Demo writer's does. */
function _returnForRevisionLive(cid, sid, aid, req, key) {
  if (!_isUuid(sid) || !_isUuid(aid)) return Promise.resolve({ result: 'not_found' });
  var returned = returnWork(cid, aid, [sid]);
  var sent = _writeRpc('return_for_revision', {
    p_assessment_id: aid,
    p_enrollment_id: sid,
    p_request: {
      what_to_fix: req.what_to_fix,
      revise_by: req.revise_by,
      criterion_ids: req.criterion_ids,
      keep_grade: true,
    },
    p_idempotency_key: _isUuid(key) ? key : _newEntryId(),
  });
  if (sent && sent.refused) return Promise.resolve({ result: 'failed' });
  _fbChanged(cid);
  _trackPendingSync(Promise.resolve(sent));
  return _fbWaitAnswer(sent).then(function (res) {
    var data = res && !res.error ? _rpcObject(res.data) : null;
    if (!res) {
      // No answer yet: the request is shown open and goes when the device can send it.
      var shown = _revisionOpen(cid, sid, aid);
      return { result: 'made', request: shown ? _revisionRow(cid, shown) : null, returned: returned, hidden: false };
    }
    if (data && data.result === 'made') {
      return { result: 'made', request: _fbLiveRow(data.request), returned: returned, hidden: false };
    }
    if (data && data.result === 'already_open') return { result: 'already_open', request: _fbLiveRow(data.request) };
    if (data && data.result === 'not_for_dibels') return { result: 'not_for_dibels' };
    if (data && data.result === 'hide_not_available') return { result: 'hide_needs_holding' };
    return _fbRefused(res) ? { result: 'not_found' } : { result: 'failed' };
  });
}

// A request as the server sent it, for the screens.
function _fbLiveRow(r) {
  return _plainObject(r) ? _studentWorkCopy(r) : null;
}

/* set_revision_request and cancel_revision for a live class, through the
   outbox under their own keys. A request made here and not answered yet has
   no server id to name: that answers failed and the teacher presses again. */
function _reviseLive(endpoint, cid, found, extra, key) {
  if (!_isUuid(found.id)) return Promise.resolve({ result: 'failed' });
  var body = Object.assign({ p_request_id: found.id }, extra, {
    p_idempotency_key: _isUuid(key) ? key : _newEntryId(),
  });
  var sent =
    endpoint === 'cancel_revision' ? _writeRpc('cancel_revision', body) : _writeRpc('set_revision_request', body);
  if (sent && sent.refused) return Promise.resolve({ result: 'failed' });
  _fbChanged(cid);
  _trackPendingSync(Promise.resolve(sent));
  return _fbWaitAnswer(sent).then(function (res) {
    var data = res && !res.error ? _rpcObject(res.data) : null;
    if (!res) {
      var now = _classRevisions(cid).find(function (r) {
        return r.id === found.id;
      });
      var row = now ? _revisionRow(cid, now) : null;
      return endpoint === 'cancel_revision'
        ? { result: 'cancelled', unhidden: false, request: row }
        : { result: 'saved', request: row };
    }
    if (data && (data.result === 'saved' || data.result === 'cancelled')) {
      return Object.assign(
        { result: data.result, request: _fbLiveRow(data.request) },
        data.result === 'cancelled' ? { unhidden: false } : {},
      );
    }
    if (data && data.result === 'not_open') return { result: 'not_open' };
    return _fbRefused(res) ? { result: 'not_found' } : { result: 'failed' };
  });
}

/* Return for Revision (return_for_revision), for one student and piece.
   `request`: { what_to_fix (1 to 2000 characters), revise_by ('YYYY-MM-DD'
   or null), criterion_ids (criteria of the piece's rubric; [] on work with
   none), keep_grade (true: Keep this grade, the new version replaces it;
   false: Hide the grade until then) }. `key`: an idempotency key made once
   per press. The work is returned first, exactly as returnWork returns it
   (the grade and the marks); then the request is made.
   A Promise, never rejected, of:
   { result: 'made', request, returned, hidden }  (returned: returnWork's
     answer; hidden: the grade was hidden);
   { result: 'already_open', request }  an open request exists;
   { result: 'hide_needs_holding' }  Hide in a class that does not hold
     grades; nothing changed;
   { result: 'not_for_dibels' }; { result: 'not_found' } (a student or piece
   not in the class); { result: 'invalid' } (a wrong request, or no key);
   { result: 'revisions_off' } (revisionsOn false); signed in
   { result: 'not_available' }. The same key again answers the same. */
function returnForRevision(cid, sid, aid, request, key) {
  if (!cid || !(_isDemoSession() || _fbOn(cid))) return Promise.resolve({ result: 'not_available' });
  if (!_idemKeyOk(key)) return Promise.resolve({ result: 'invalid' });
  var again = _feedbackRemembered(cid, 'revision-make', key);
  if (again !== undefined) return Promise.resolve(again);
  if (!revisionsOn(cid)) return Promise.resolve({ result: 'revisions_off' });
  var a = _assessmentById(cid, aid);
  if (!a || !_teacherWorkInClass(cid, sid, aid)) return Promise.resolve({ result: 'not_found' });
  if (isDibelsScored(a)) return Promise.resolve({ result: 'not_for_dibels' });
  var req = _revisionRequestOk(cid, a, request, false);
  if (!req) return Promise.resolve({ result: 'invalid' });
  var open = _revisionOpen(cid, sid, aid);
  if (open) return Promise.resolve({ result: 'already_open', request: _revisionRow(cid, open) });
  if (!req.keep_grade && !GradeState.holds(getReturnSettings(cid))) {
    return Promise.resolve({ result: 'hide_needs_holding' });
  }
  if (!_isDemoSession()) return _returnForRevisionLive(cid, sid, aid, req, key);
  var returned = returnWork(cid, aid, [sid]);
  var first = _revisionWorking(cid, sid, aid);
  var before = getGradeReturn(cid, sid, aid);
  var firstSub = getStudentSubmission(cid, sid, aid);
  var now = new Date().toISOString();
  // Hide: the row becomes a draft never returned (C2). Nothing to hide with no grade.
  var hide = !req.keep_grade && !!first;
  if (hide) _revisionSetRow(cid, sid, aid, { is_draft: true, seen_at: before && before.seen_at });
  var draft = _studentFeedbackDraft(cid);
  var id = 'rv' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  draft.revisions[id] = {
    id: id,
    assessment_id: aid,
    enrollment_id: sid,
    what_to_fix: req.what_to_fix,
    revise_by: req.revise_by,
    criterion_ids: req.criterion_ids,
    keep_grade: req.keep_grade,
    hidden: hide,
    // The row as it was before Hide, so Take Back gives the grade back as the student had it.
    hidden_row: hide ? _studentWorkCopy(before) : null,
    first_submission_id: firstSub ? firstSub.id : null,
    first_version: firstSub ? firstSub.version || 1 : 1,
    first_grade: first,
    first_returned_at: (before && before.returned_at) || null,
    created_at: now,
    updated_at: now,
    cancelled_at: null,
  };
  var answer = { result: 'made', request: _revisionRow(cid, draft.revisions[id]), returned: returned, hidden: hide };
  _feedbackRemember(draft, 'revision-make', key, answer);
  _studentFeedbackWrite(cid, draft);
  return Promise.resolve(answer);
}

/* Change What to Fix, Revise By or the criteria of an open request
   (set_revision_request). Keep or Hide is not changed here. A Promise of
   { result: 'saved', request }, { result: 'not_open' }, { result:
   'not_found' }, { result: 'invalid' }, { result: 'revisions_off' }, or
   signed in { result: 'not_available' }. The same key again answers the same. */
function setRevisionRequest(cid, requestId, patch, key) {
  if (!cid || !(_isDemoSession() || _fbOn(cid))) return Promise.resolve({ result: 'not_available' });
  if (!_idemKeyOk(key)) return Promise.resolve({ result: 'invalid' });
  var again = _feedbackRemembered(cid, 'revision-set', key);
  if (again !== undefined) return Promise.resolve(again);
  if (!revisionsOn(cid)) return Promise.resolve({ result: 'revisions_off' });
  var found = _classRevisions(cid).find(function (r) {
    return r.id === requestId;
  });
  if (!found) return Promise.resolve({ result: 'not_found' });
  var ok = _revisionRequestOk(cid, _assessmentById(cid, found.assessment_id), patch, true);
  if (!ok) return Promise.resolve({ result: 'invalid' });
  if (!_revisionIsOpen(_revisionState(cid, found))) return Promise.resolve({ result: 'not_open' });
  if (!_isDemoSession()) return _reviseLive('set_revision_request', cid, found, { p_patch: ok }, key);
  var draft = _studentFeedbackDraft(cid);
  var r = draft.revisions[found.id];
  Object.assign(r, ok, { updated_at: new Date().toISOString() });
  var answer = { result: 'saved', request: _revisionRow(cid, r) };
  _feedbackRemember(draft, 'revision-set', key, answer);
  _studentFeedbackWrite(cid, draft);
  return Promise.resolve(answer);
}

/* Take Back (cancel_revision). A revision already sent stays as a later
   version. A hidden grade is given back exactly as the student had it; a
   change the teacher made since waits as a draft on it. A Promise of
   { result: 'cancelled', unhidden, request }, { result: 'not_open' },
   { result: 'not_found' }, { result: 'invalid' } (no key), { result:
   'revisions_off' }, or signed in { result: 'not_available' }. */
function cancelRevision(cid, requestId, key) {
  if (!cid || !(_isDemoSession() || _fbOn(cid))) return Promise.resolve({ result: 'not_available' });
  if (!_idemKeyOk(key)) return Promise.resolve({ result: 'invalid' });
  var again = _feedbackRemembered(cid, 'revision-cancel', key);
  if (again !== undefined) return Promise.resolve(again);
  if (!revisionsOn(cid)) return Promise.resolve({ result: 'revisions_off' });
  var found = _classRevisions(cid).find(function (r) {
    return r.id === requestId;
  });
  if (!found) return Promise.resolve({ result: 'not_found' });
  if (!_revisionIsOpen(_revisionState(cid, found))) return Promise.resolve({ result: 'not_open' });
  if (!_isDemoSession()) return _reviseLive('cancel_revision', cid, found, {}, key);
  var unhide = _revisionHidden(cid, found);
  var now = new Date().toISOString();
  // Closed first, so the row given back below is not read as a Return that ends anything.
  var closing = _studentFeedbackDraft(cid);
  Object.assign(closing.revisions[found.id], { cancelled_at: now, updated_at: now });
  _studentFeedbackWrite(cid, closing);
  if (unhide) {
    var sid = found.enrollment_id;
    var aid = found.assessment_id;
    // What the request kept of the row before Hide: the student is given exactly that back,
    // even when the row has gone since (Clear Score takes a never-returned row away).
    var was = found.hidden_row || (found.first_returned_at ? { returned_at: found.first_returned_at } : null);
    var row = Object.assign({}, was || {}, { is_draft: false, returned_copy: null });
    var seen = (getGradeReturn(cid, sid, aid) || {}).seen_at;
    if (seen) row.seen_at = seen;
    // A change made since the hide (a regrade, a Clear) waits as a draft on the grade given back.
    if (!GradeState.sameCopy(_revisionWorking(cid, sid, aid), found.first_grade)) {
      row.is_draft = true;
      row.returned_copy = _studentWorkCopy(found.first_grade);
    }
    _revisionSetRow(cid, sid, aid, row);
  }
  var draft = _studentFeedbackDraft(cid);
  var r = draft.revisions[found.id];
  var answer = { result: 'cancelled', unhidden: unhide, request: _revisionRow(cid, r) };
  _feedbackRemember(draft, 'revision-cancel', key, answer);
  _studentFeedbackWrite(cid, draft);
  return Promise.resolve(answer);
}

/* The student `from` (signed in on the page) acting on their own piece:
   an error code, or null to go on. */
function _studentRevisionCheck(cid, sid, aid, from) {
  if (!cid || !_isDemoSession()) return 'not_available';
  if (!sid || from !== sid || !_teacherWorkInClass(cid, sid, aid)) return 'not_found';
  if (!revisionsOn(cid)) return 'send_off';
  return null;
}

// A page as Demo Mode keeps it: a shipped sample file, or a photo in the photo queue.
var _REVISION_PAGE = /^([a-z0-9-]+\.jpg|photo-queue:p[a-z0-9]+)$/;
var _REVISION_THUMB = /^([a-z0-9-]+\.jpg|photo-queue:p[a-z0-9]+:thumb)$/;
function _revisionFilesOk(files) {
  return (
    Array.isArray(files) &&
    files.length > 0 &&
    files.length <= STUDENT_WORK_MAX_PAGES &&
    files.every(function (f) {
      return (
        _plainObject(f) &&
        typeof f.path === 'string' &&
        _REVISION_PAGE.test(f.path) &&
        typeof f.thumb_path === 'string' &&
        _REVISION_THUMB.test(f.thumb_path)
      );
    })
  );
}

/* Send My Revision: revision_start and revision_finish in one call, Demo
   Mode's stand-in (nothing uploads). `files`: the pages, in order, each
   { path, thumb_path, bytes?, thumb_bytes?, width?, height?, sha256? } with
   a path Demo Mode can show (a sample file name, or a photo-queue path from
   PhotoQueue.add). `note`: the student's note, 1000 characters at most, or
   null. `from`: the student signed in on the page. The revision is the
   next version of the submission; sent again before grading starts it
   takes the place of the one in. Sent after Revise By it is late (a label:
   it changes no number). Answers { ok: true, submission_id, version, late }
   or { ok: false, error }: not_available (signed in), not_found, send_off
   (revisionsOn false), not_taking_work (Students Send is Nothing),
   no_revision (no open request), grading_started (the revision in is being
   graded, carries the teacher's marks, or was returned), invalid. */
function sendStudentRevision(cid, sid, aid, files, note, from) {
  var refused = _studentRevisionCheck(cid, sid, aid, from);
  if (refused) return { ok: false, error: refused };
  if (getAssessmentStudentWork(cid, aid).students_send === 'nothing') return { ok: false, error: 'not_taking_work' };
  if (!_revisionFilesOk(files)) return { ok: false, error: 'invalid' };
  if (note != null && (typeof note !== 'string' || note.length > 1000)) return { ok: false, error: 'invalid' };
  var r = _revisionOpen(cid, sid, aid);
  if (!r) return { ok: false, error: 'no_revision' };
  var state = _revisionState(cid, r);
  if (state !== 'open' && state !== 'sent') return { ok: false, error: 'grading_started' };
  var work = _studentWorkDraft(cid);
  // Sent again before grading starts: the revision in goes, its pages with it.
  if (state === 'sent') {
    work.submissions = work.submissions.filter(function (s) {
      return !(s && s.id === r.revision_submission_id);
    });
  }
  var version = work.submissions.reduce(function (n, s) {
    return s && s.state === 'sent' && s.enrollment_id === sid && s.assessment_id === aid
      ? Math.max(n, s.version || 1)
      : n;
  }, 0);
  version = Math.max(version, r.first_version || 1) + 1;
  var stamp = new Date().toISOString();
  var late = !!r.revise_by && courseToday(cid) > r.revise_by;
  var subId = 'rs' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  var text = note == null || !String(note).trim() ? null : String(note);
  work.submissions.push({
    id: subId,
    assessment_id: aid,
    enrollment_id: sid,
    version: version,
    state: 'sent',
    sent_by: 'student',
    on_paper: false,
    is_late: late,
    note: text,
    followed_plan: null,
    created_at: stamp,
    sent_at: stamp,
    files: files.map(function (f, i) {
      return {
        id: subId + '-p' + (i + 1),
        page: i + 1,
        path: f.path,
        thumb_path: f.thumb_path,
        bytes: f.bytes == null ? null : f.bytes,
        thumb_bytes: f.thumb_bytes == null ? null : f.thumb_bytes,
        width: f.width == null ? null : f.width,
        height: f.height == null ? null : f.height,
        rotation: 0,
        sha256: f.sha256 == null ? null : f.sha256,
        added_by: 'student',
      };
    }),
  });
  _studentWorkWrite(cid, work);
  var draft = _studentFeedbackDraft(cid);
  Object.assign(draft.revisions[r.id], {
    revision_submission_id: subId,
    revision_version: version,
    revision_sent_at: stamp,
    revision_note: text,
    revision_late: late,
    revision_sent_by: 'student',
    // The grade as it stood when the revision came in: what "grading started" is measured from.
    revision_grade_at_send: _revisionWorking(cid, sid, aid),
    updated_at: stamp,
  });
  _studentFeedbackWrite(cid, draft);
  return { ok: true, submission_id: subId, version: version, late: late };
}

/* Unsend My Revision (revision_unsend): the revision in goes, with its
   pages, and the request is open again. Answers { ok: true, unsent, cancelled:
   false, pages } (unsent false and pages 0 with nothing in) or { ok: false,
   error }: not_available, not_found, send_off, no_revision (no open
   request), grading_started. */
function unsendStudentRevision(cid, sid, aid, from) {
  var refused = _studentRevisionCheck(cid, sid, aid, from);
  if (refused) return { ok: false, error: refused };
  var r = _revisionOpen(cid, sid, aid);
  if (!r) return { ok: false, error: 'no_revision' };
  var state = _revisionState(cid, r);
  if (state === 'open') return { ok: true, unsent: false, cancelled: false, pages: 0 };
  if (state !== 'sent') return { ok: false, error: 'grading_started' };
  var sub = _revisionSubmission(cid, r);
  var work = _studentWorkDraft(cid);
  work.submissions = work.submissions.filter(function (s) {
    return !(s && s.id === r.revision_submission_id);
  });
  _studentWorkWrite(cid, work);
  var draft = _studentFeedbackDraft(cid);
  Object.assign(draft.revisions[r.id], {
    revision_submission_id: null,
    revision_version: null,
    revision_sent_at: null,
    revision_note: null,
    revision_late: null,
    revision_sent_by: null,
    revision_grade_at_send: null,
    updated_at: new Date().toISOString(),
  });
  _studentFeedbackWrite(cid, draft);
  return { ok: true, unsent: true, cancelled: false, pages: ((sub && sub.files) || []).length };
}

/* Demo Mode's sample requests (seed-data.js): [{ assessment_id,
   enrollment_id, what_to_fix, revise_by, criterion_ids, created_at }],
   each kept with the grade as it stands (Keep this grade: the sample hides
   none and returns nothing, so no grade changes), whatever the switches
   say. false outside Demo Mode, or for a student or piece not in the class. */
function saveDemoRevisions(cid, list) {
  if (!cid || !_isDemoSession() || !Array.isArray(list)) return false;
  var ok = list.every(function (r) {
    var a = _plainObject(r) ? _assessmentById(cid, r.assessment_id) : null;
    return (
      a &&
      _teacherWorkInClass(cid, r.enrollment_id, r.assessment_id) &&
      r.created_at &&
      !!_revisionRequestOk(
        cid,
        a,
        { what_to_fix: r.what_to_fix, revise_by: r.revise_by, criterion_ids: r.criterion_ids, keep_grade: true },
        false,
      )
    );
  });
  if (!ok) return false;
  var draft = _studentFeedbackDraft(cid);
  list.forEach(function (r) {
    var id = 'demo-rv-' + r.enrollment_id + '-' + r.assessment_id;
    var sub = getStudentSubmission(cid, r.enrollment_id, r.assessment_id);
    var row = getGradeReturn(cid, r.enrollment_id, r.assessment_id);
    draft.revisions[id] = {
      id: id,
      assessment_id: r.assessment_id,
      enrollment_id: r.enrollment_id,
      what_to_fix: r.what_to_fix,
      revise_by: r.revise_by || null,
      criterion_ids: (r.criterion_ids || []).slice(),
      keep_grade: true,
      hidden: false,
      hidden_row: null,
      first_submission_id: sub ? sub.id : null,
      first_version: sub ? sub.version || 1 : 1,
      first_grade: _revisionWorking(cid, r.enrollment_id, r.assessment_id),
      first_returned_at: (row && row.returned_at) || null,
      created_at: r.created_at,
      updated_at: r.created_at,
      cancelled_at: null,
    };
  });
  _studentFeedbackWrite(cid, draft);
  return true;
}
