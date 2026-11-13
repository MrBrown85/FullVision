// @ts-check
/* Mark Up and Reflect on Feedback for a signed-in teacher: the server's marks, reflections and revision requests, and Return with its marks.
   Moved from shared/data.js on 2026-11-12 (S19 split, move only). */

/* ══════════════════════════════════════════════════════════════════
   Mark Up and Reflect on Feedback for a signed-in teacher (S9-W1, S10-W1)
   ══════════════════════════════════════════════════════════════════
   The same readers and writers as the two Demo Mode blocks below, answered
   from the server (migrations/2026111120_markup_reflect_revise.sql:
   save_markup, list_assessment_markup, return_work, set_course_feedback_options,
   answer_reflection, list_course_feedback). Only for a class the server keeps
   student-page rows for (_workOnServer, as Send Work's wiring above): any
   other class is answered exactly as before and sent nothing new. Return
   for Revision, its edit and Take Back are here (S7-W1, "Revisions" below);
   a student's own revision (revision_start, revision_finish, revision_unsend)
   and group work are not (Phase 3).

   What is read: list_course_feedback (the class's switches, a line for
   every marked page, every reflection) when the class loads with Send Work
   or Reflect on Feedback on, and whenever Send Work's own read runs
   (refreshStudentWork); and, for each piece with marked pages,
   list_assessment_markup, when that line changed. Mark Up reads its piece
   again itself before it draws (loadAssessmentMarkup). Kept in memory only:
   nothing about a student is stored on the device beyond the outbox's own
   queued writes, which Sign Out clears.

   What is shown is that answer with this device's writes not yet answered
   laid over it, so a mark made or an answer sent shows at once and a
   reload keeps it: the outbox's queued save_markup, return_work and
   answer_reflection, and set_course_feedback_options.

   Every write goes through the outbox with its own idempotency key. A save
   or a Return for one student takes that student's cell key
   (cell:<student>:<piece>, shared/offline-queue.js), so the marks a Return
   gives are the ones saved before it, and two saves in a row go as one.
   A page whose id is local (still uploading from the photo queue) has no
   marks: Mark Up is not offered on it (getPageMarkup answers null).

   Sync problems show on the sync dot only: a refused write is the outbox's
   own dead letter. Nothing here shows a banner or a toast. */
var _MARKUP_SAVE_WAIT_MS = 5000; // how long a save waits for the server's answer before the screen goes on
var _FB_REFRESH_MS = 30000; // refreshCourseFeedback's wait between reads, unless forced
var _fbCourseRow = {}; // cid → { reflect_on_feedback, show_my_learning }, as the server last said
var _fbCourseHere = {}; // cid → a change of the two on its way: { patch }
/** @type {Record<string, { markup?: unknown; revisions?: { id?: string }[]; reflections?: { id?: string }[] }>} */
var _fbServer = {}; // cid → list_course_feedback's answer, as last read
/** @type {Record<string, Record<string, Record<string, { enrollment_id?: string; rev?: unknown; marks?: unknown; saved_at?: string | null; given?: unknown; given_rev?: unknown; given_at?: string | null; waiting?: boolean }>>>} */
var _fbRows = {}; // cid → { assessment id → { file id → list_assessment_markup's row } }
var _fbRead = {}; // cid → { running, again, at }
/** @type {Record<string, number>} */
var _fbWrites = {}; // cid → how many of this device's feedback writes have landed
var _fbMemo = {}; // cid → { name → this turn's view }
var _fbMemoClearing = false;
var _FB_ENDPOINTS = {
  set_course_feedback_options: true,
  save_markup: true,
  return_work: true,
  answer_reflection: true,
  // Revisions (S7-W1): Return for Revision, its edit and Take Back.
  return_for_revision: true,
  set_revision_request: true,
  cancel_revision: true,
};

/* True when class `cid`'s marks and reflections are the server's (a
   signed-in class with the build switch on). */
function _fbOn(cid) {
  return _workOnServer(cid);
}
// Demo Mode, or a class the server keeps rows for: where the readers answer.
function _fbReads(cid) {
  return !!cid && (_isDemoSession() || _fbOn(cid));
}

function _fbChanged(cid) {
  delete _fbMemo[cid];
}
function _fbMemoized(cid, name, build) {
  var held = _fbMemo[cid] || (_fbMemo[cid] = {});
  if (name in held) return held[name];
  held[name] = build();
  if (!_fbMemoClearing) {
    _fbMemoClearing = true;
    Promise.resolve().then(function () {
      _fbMemoClearing = false;
      _fbMemo = {};
    });
  }
  return held[name];
}

// The course row's two switches, when the class loads (_applyBundleCourseConfig) or list_course_feedback is read.
function _noteCourseFeedbackOptions(cid, courseRow) {
  if (!cid || !_plainObject(courseRow)) return;
  if (!('reflect_on_feedback' in courseRow) && !('show_my_learning' in courseRow)) return;
  _fbCourseRow[cid] = {
    reflect_on_feedback: courseRow.reflect_on_feedback === true,
    show_my_learning: courseRow.show_my_learning === true,
  };
  _fbChanged(cid);
}

// The two switches as the screens read them: the server's, with this device's unanswered change laid over.
function _fbCourseOptions(cid) {
  return _fbMemoized(cid, 'course', function () {
    var out = Object.assign({ reflect_on_feedback: false, show_my_learning: false }, _fbCourseRow[cid] || {});
    var lay = function (patch) {
      if (!_plainObject(patch)) return;
      ['reflect_on_feedback', 'show_my_learning'].forEach(function (k) {
        if (typeof patch[k] === 'boolean') out[k] = patch[k];
      });
    };
    _workQueued('set_course_feedback_options', function (p) {
      return p.p_course_id === cid;
    }).forEach(function (e) {
      lay(e.payload.p_patch);
    });
    if (_fbCourseHere[cid]) lay(_fbCourseHere[cid].patch);
    return out;
  });
}

/* True when reading the class's feedback is worth a request: Reflect on
   Feedback is on, or Send Work is (Mark Up lives on it). A class with both
   off is sent nothing. */
function _fbWanted(cid) {
  if (!_fbOn(cid)) return false;
  if (_fbCourseOptions(cid).reflect_on_feedback) return true;
  return _workServerView(cid).course.send_work === true;
}

// This device's unanswered writes among `endpoints`, oldest first.
function _fbQueuedWrites(endpoints) {
  var all = [];
  endpoints.forEach(function (endpoint, order) {
    _workQueued(endpoint, function () {
      return true;
    }).forEach(function (e, i) {
      all.push({ endpoint: endpoint, payload: e.payload, at: String(e.created_at || ''), order: order, i: i });
    });
  });
  return all.sort(function (x, y) {
    if (x.at !== y.at) return x.at < y.at ? -1 : 1;
    return x.order !== y.order ? x.order - y.order : x.i - y.i;
  });
}

function _fbMarksEmpty(marks) {
  return !marks || !Array.isArray(marks.marks) || !marks.marks.length;
}

/* A page's marks as the screens read them (the shape the Demo block
   keeps): { rev, marks, saved_at, given, given_rev, given_at, waiting }.
   waiting: the student would be given a change at the next Return, as
   list_assessment_markup says it; a page never given whose marks were all
   erased is not waiting. */
function _fbWaiting(cid, aid, k) {
  if (k.rev === k.given_rev) return false;
  if (k.given == null && _fbMarksEmpty(k.marks)) return false;
  return getAssessmentStudentWork(cid, aid).students_see_markup !== false;
}

/* Every marked page of the class by file id, from the server's rows with
   this device's unanswered saves and Returns laid over them, in the order
   they were made. */
function _fbMarkupKept(cid) {
  return _fbMemoized(cid, 'markup', function () {
    var out = {};
    var byAssessment = _fbRows[cid] || {};
    Object.keys(byAssessment).forEach(function (aid) {
      Object.keys(byAssessment[aid]).forEach(function (fid) {
        var r = byAssessment[aid][fid];
        out[fid] = {
          aid: aid,
          sid: r.enrollment_id,
          rev: r.rev || 0,
          marks: _studentWorkCopy(r.marks) || { v: 1, marks: [] },
          saved_at: r.saved_at || null,
          given: r.given ? _studentWorkCopy(r.given) : null,
          given_rev: r.given_rev == null ? null : r.given_rev,
          given_at: r.given_at || null,
          waiting: r.waiting === true,
        };
      });
    });
    var held = _markupHeld(cid);
    _fbQueuedWrites(['save_markup', 'return_work']).forEach(function (w) {
      var p = w.payload;
      if (w.endpoint === 'save_markup') {
        var page = _markupPage(cid, p.p_file_id);
        if (!page) return;
        var was = out[p.p_file_id];
        var rev = (p.p_base_rev != null ? p.p_base_rev : was ? was.rev : 0) + 1;
        var next = {
          aid: page.submission.assessment_id,
          sid: page.submission.enrollment_id,
          rev: rev,
          marks: _studentWorkCopy(p.p_marks),
          saved_at: w.at || null,
          given: was ? was.given : null,
          given_rev: was ? was.given_rev : null,
          given_at: was ? was.given_at : null,
        };
        // A class that does not hold grades gives the marks as they are saved.
        if (!held) {
          next.given = _studentWorkCopy(p.p_marks);
          next.given_rev = rev;
          next.given_at = w.at || null;
        }
        next.waiting = _fbWaiting(cid, next.aid, next);
        out[p.p_file_id] = next;
        return;
      }
      var listed = {};
      (Array.isArray(p.p_enrollment_ids) ? p.p_enrollment_ids : []).forEach(function (sid) {
        listed[sid] = true;
      });
      Object.keys(out).forEach(function (fid) {
        var k = out[fid];
        if (k.aid !== p.p_assessment_id || !listed[k.sid] || !k.waiting) return;
        k.given = _studentWorkCopy(k.marks);
        k.given_rev = k.rev;
        k.given_at = w.at || null;
        k.waiting = false;
      });
    });
    return out;
  });
}

/* ── Reflections ── */

// What the server does with an answer (answer_reflection) on a copy of the reflection: false when there is nothing to answer.
function _fbApplyAnswer(r, text, onlyMe, at) {
  var t = String(text).trim();
  var followUpOpen = r.follow_up != null && r.follow_up_answer == null;
  if (r.answer == null && onlyMe) {
    r.note = t;
    r.noted_at = at;
  } else if (r.answer == null) {
    r.answer = t;
    r.answered_at = at;
  } else if (followUpOpen && onlyMe) {
    r.follow_up_note = t;
    r.follow_up_noted_at = at;
  } else if (followUpOpen) {
    r.follow_up_answer = t;
    r.follow_up_answered_at = at;
  } else return false;
  r.waiting =
    (r.question != null && r.answer == null && (r.noted_at == null || r.noted_at < r.sent_at)) ||
    (r.follow_up != null && r.follow_up_answer == null && r.follow_up_note == null);
  return true;
}

// The class's reflections as the server listed them, with this device's unanswered answers laid over them.
function _fbReflections(cid) {
  return _fbMemoized(cid, 'reflections', function () {
    var list = _studentWorkCopy((_fbServer[cid] || {}).reflections) || [];
    _fbQueuedWrites(['answer_reflection']).forEach(function (w) {
      var r = list.find(function (x) {
        return x && x.id === w.payload.p_reflection_id;
      });
      if (r && typeof w.payload.p_answer === 'string') {
        _fbApplyAnswer(r, w.payload.p_answer, w.payload.p_only_me === true, w.at || new Date().toISOString());
      }
    });
    return list;
  });
}

/* ── Revisions ── */

// What the server does with a request's edit (set_revision_request) on a copy of the request.
function _fbApplyPatch(r, patch) {
  if (!_plainObject(patch)) return;
  ['what_to_fix', 'revise_by', 'criterion_ids'].forEach(function (k) {
    if (k in patch) r[k] = Array.isArray(patch[k]) ? patch[k].slice() : patch[k];
  });
}

/* The class's revision requests as the server listed them, with this
   device's unanswered Return for Revision, edits and Take Backs laid over
   them. A request made here and not answered yet is shown open under a
   made-up id (pending-rv:<key>): it can be neither edited nor taken back
   until the server has answered. Each carries _live so the readers below
   take the server's own state. */
function _fbRevisions(cid) {
  return _fbMemoized(cid, 'revisions', function () {
    var list = (_studentWorkCopy((_fbServer[cid] || {}).revisions) || []).map(function (r) {
      return Object.assign(r, { _live: true });
    });
    _fbQueuedWrites(['return_for_revision', 'set_revision_request', 'cancel_revision']).forEach(function (w) {
      var p = w.payload;
      var at = w.at || new Date().toISOString();
      if (w.endpoint === 'return_for_revision') {
        var req = _plainObject(p.p_request) ? p.p_request : {};
        list.push({
          _live: true,
          id: 'pending-rv:' + p.p_idempotency_key,
          assessment_id: p.p_assessment_id,
          enrollment_id: p.p_enrollment_id,
          what_to_fix: req.what_to_fix || '',
          revise_by: req.revise_by || null,
          criterion_ids: Array.isArray(req.criterion_ids) ? req.criterion_ids.slice() : [],
          keep_grade: true,
          grade_hidden: false,
          first_submission_id: null,
          first_version: 1,
          first_grade: null,
          first_returned_at: null,
          created_at: at,
          updated_at: at,
          closed_at: null,
          state: 'open',
          revision_submission_id: null,
          revision_version: null,
          revision_sent_at: null,
          revision_note: null,
          revision_late: null,
          revision_sent_by: null,
        });
        return;
      }
      var r = list.find(function (x) {
        return x.id === p.p_request_id;
      });
      if (!r || r.state === 'cancelled' || r.state === 'returned') return;
      if (w.endpoint === 'set_revision_request') {
        _fbApplyPatch(r, p.p_patch);
        r.updated_at = at;
      } else {
        r.state = 'cancelled';
        r.closed_at = at;
        r.updated_at = at;
        r.revision_submission_id = r.revision_version = r.revision_sent_at = r.revision_note = null;
        r.revision_late = r.revision_sent_by = null;
      }
    });
    return list;
  });
}

/* ── Reading ── */

// A signature of the marked pages of one piece, from list_course_feedback's lines or list_assessment_markup's rows.
function _fbSignature(rows) {
  return rows
    .map(function (m) {
      return m.file_id + ':' + m.rev + ':' + m.given_rev;
    })
    .sort()
    .join(',');
}

function _fbLook(cid) {
  return JSON.stringify([_fbCourseOptions(cid), _fbMarkupKept(cid), _fbReflections(cid), _fbRevisions(cid)]);
}

// list_assessment_markup for one piece: { file id → row }, or null when the read failed.
async function _fetchAssessmentMarkup(aid) {
  var res;
  try {
    res = await _callRpcWithAuthGuard(
      'list_assessment_markup',
      { p_assessment_id: aid },
      { suppressSessionExpiredModal: true },
    );
  } catch (e) {
    res = { error: e };
  }
  var rows = res && !res.error ? _rpcRows(res.data) : null;
  if (!rows) {
    if (res && res.error && !res.error.handledSessionExpired) console.warn('list_assessment_markup failed:', res.error);
    return null;
  }
  var out = {};
  rows.forEach(function (r) {
    if (r && _isUuid(r.file_id)) out[r.file_id] = r;
  });
  return out;
}

/* Read the class's feedback from the server: the switches, the marked
   pages, the reflections. Not more than every 30 seconds unless opts.force
   (a read under way is joined). A Promise of { changed } or { error };
   never rejects. A screen that changes is redrawn. Nothing for a class that
   is not live or has Send Work and Reflect on Feedback both off. */
function refreshCourseFeedback(cid, opts) {
  if (!_fbWanted(cid)) return Promise.resolve({ changed: false });
  var st = _fbRead[cid] || (_fbRead[cid] = {});
  if (st.running) {
    if (opts && opts.force) st.again = true;
    return st.running;
  }
  if (!(opts && opts.force) && st.at && Date.now() - st.at < _FB_REFRESH_MS) {
    return Promise.resolve({ changed: false });
  }
  st.running = (async function () {
    /** @type {{ changed?: boolean; error?: unknown; skipped?: unknown }} */
    var out = { changed: false };
    try {
      var tries = 0;
      do {
        st.again = false;
        out = await _fetchCourseFeedback(cid);
        tries++;
      } while ((st.again || out.skipped) && tries < 4);
    } catch (e) {
      out = { error: e };
    } finally {
      st.running = null;
    }
    if (out.changed) _invalidateAndRerender();
    return out;
  })();
  return st.running;
}

async function _fetchCourseFeedback(cid) {
  var writes = _fbWrites[cid] || 0;
  var res;
  try {
    res = await _callRpcWithAuthGuard(
      'list_course_feedback',
      { p_course_id: cid },
      { suppressSessionExpiredModal: true },
    );
  } catch (e) {
    res = { error: e };
  }
  var data = res && !res.error ? _rpcObject(res.data) : null;
  if (!data || !Array.isArray(data.markup) || !Array.isArray(data.reflections)) {
    // A read that failed changes nothing: the next one tries again.
    if (res && res.error && !res.error.handledSessionExpired) console.warn('list_course_feedback failed:', res.error);
    return { error: (res && res.error) || { message: 'no answer' } };
  }
  // The pieces whose marked pages are not what was read before.
  var lines = {};
  data.markup.forEach(function (m) {
    if (m && m.assessment_id) (lines[m.assessment_id] = lines[m.assessment_id] || []).push(m);
  });
  var have = _fbRows[cid] || {};
  var fresh = {};
  var aids = Object.keys(lines).filter(function (aid) {
    var held = have[aid]
      ? _fbSignature(
          Object.keys(have[aid]).map(function (f) {
            return have[aid][f];
          }),
        )
      : null;
    return held !== _fbSignature(lines[aid]);
  });
  if (aids.length) {
    var got = await Promise.all(
      aids.map(function (aid) {
        return _fetchAssessmentMarkup(aid);
      }),
    );
    if (
      got.some(function (g) {
        return !g;
      })
    ) {
      return { error: { message: 'the marks could not be read' } };
    }
    aids.forEach(function (aid, i) {
      fresh[aid] = got[i];
    });
  }
  if (!_fbOn(cid)) return { changed: false };
  // One of this device's writes landed while the read was out: it is from before that write.
  if ((_fbWrites[cid] || 0) !== writes) return { skipped: true };
  var was = _fbLook(cid);
  _fbServer[cid] = {
    markup: data.markup,
    reflections: data.reflections,
    revisions: Array.isArray(data.revisions) ? data.revisions : [],
  };
  if (_plainObject(data.course)) _noteCourseFeedbackOptions(cid, data.course);
  var rows = {};
  Object.keys(lines).forEach(function (aid) {
    rows[aid] = fresh[aid] || have[aid] || {};
  });
  _fbRows[cid] = rows;
  (_fbRead[cid] || (_fbRead[cid] = {})).at = Date.now();
  _fbChanged(cid);
  return { changed: was !== _fbLook(cid) };
}

/* Mark Up's own read of a piece before it draws: every page's marks, both
   copies, so a page marked on another device shows what is there. A Promise
   of true when read; false when it could not be (offline: Mark Up goes on
   from what this device has). Nothing for a class that is not live. */
function loadAssessmentMarkup(cid, aid) {
  if (!_fbOn(cid) || !_isUuid(aid)) return Promise.resolve(false);
  var writes = _fbWrites[cid] || 0;
  return _fetchAssessmentMarkup(aid).then(function (rows) {
    if (!rows || !_fbOn(cid)) return false;
    // A save of this device's landed meanwhile: the read is from before it.
    if ((_fbWrites[cid] || 0) !== writes) return true;
    var all = _fbRows[cid] || (_fbRows[cid] = {});
    if (Object.keys(rows).length) all[aid] = rows;
    else delete all[aid];
    _fbChanged(cid);
    return true;
  });
}

/* The class has just loaded from the server with its student page on
   (_loadServerGradeReturns): its feedback too, when it is wanted and its
   work is not being read (Send Work off, Reflect on Feedback on). Never
   waited for, never a failed load. */
function _loadServerFeedback(cid) {
  // A class with Send Work on (or not known yet) has it read with its work (refreshStudentWork).
  var known = _workCourseRow[cid];
  if (known && known.send_work !== true && _fbWanted(cid)) refreshCourseFeedback(cid, { force: true });
}

// A write of this device's landed: reads begun before it are dropped, and the class read again soon.
function _fbWriteLanded(cid) {
  if (!cid) return;
  _fbWrites[cid] = (_fbWrites[cid] || 0) + 1;
  _fbChanged(cid);
  setTimeout(function () {
    refreshCourseFeedback(cid, { force: true });
  }, 0);
}

/* The class a Mark Up page or a reflection belongs to, from what is in memory. */
function _fbClassOfFile(fileId) {
  /** @type {string | null} */
  var found = null;
  Object.keys(_workServer).some(function (cid) {
    var subs = (_workServer[cid] && _workServer[cid].submissions) || [];
    var hit = subs.some(function (s) {
      return (s.files || []).some(function (f) {
        return f && f.id === fileId;
      });
    });
    if (hit) found = cid;
    return hit;
  });
  return found;
}
function _fbClassOfRevision(id) {
  return (
    Object.keys(_fbServer).find(function (cid) {
      return ((_fbServer[cid] && _fbServer[cid].revisions) || []).some(function (r) {
        return r && r.id === id;
      });
    }) || null
  );
}
function _fbClassOfReflection(id) {
  return (
    Object.keys(_fbServer).find(function (cid) {
      return (_fbServer[cid].reflections || []).some(function (r) {
        return r && r.id === id;
      });
    }) || null
  );
}

// Put a page's row into the cache as the server now has it.
function _fbPutRow(cid, aid, fileId, row) {
  var all = _fbRows[cid] || (_fbRows[cid] = {});
  (all[aid] = all[aid] || {})[fileId] = row;
}

/* The outbox's word on a feedback write (_onOutboxEvent). What landed is
   put in the cache as the server answered, so the screen does not fall
   back to what was read before; a refused write has the class read again.
   Runs from the outbox's own event, so after a reload and in every tab. */
function _onFeedbackWriteEvent(kind, endpoint, payload, data) {
  try {
    payload = payload || {};
    /** @type {string | null} */
    var cid = null;
    if (endpoint === 'set_course_feedback_options') cid = payload.p_course_id;
    else if (endpoint === 'save_markup') cid = _fbClassOfFile(payload.p_file_id);
    else if (endpoint === 'return_work') cid = _classOfAssessment(payload.p_assessment_id);
    else if (endpoint === 'answer_reflection') cid = _fbClassOfReflection(payload.p_reflection_id);
    else if (endpoint === 'return_for_revision') cid = _classOfAssessment(payload.p_assessment_id);
    else if (endpoint === 'set_revision_request' || endpoint === 'cancel_revision') {
      cid = _fbClassOfRevision(payload.p_request_id);
    }
    if (kind !== 'flush:success') {
      if (cid) _fbWriteLanded(cid);
      else
        Object.keys(_fbServer).forEach(function (c) {
          _fbWriteLanded(c);
        });
      return;
    }
    if (!cid) return;
    data = _rpcObject(data) || {};
    if (endpoint === 'set_course_feedback_options') {
      _noteCourseFeedbackOptions(cid, data);
    } else if (endpoint === 'save_markup') {
      var page = _markupPage(cid, payload.p_file_id);
      var aid = page && page.submission.assessment_id;
      if (aid && data.result === 'saved') {
        var was = (_fbRows[cid] && _fbRows[cid][aid] && _fbRows[cid][aid][payload.p_file_id]) || {};
        var given = data.given_rev != null && data.given_rev === data.rev;
        _fbPutRow(cid, aid, payload.p_file_id, {
          file_id: payload.p_file_id,
          enrollment_id: /** @type {NonNullable<typeof page>} */ (page).submission.enrollment_id,
          rev: data.rev,
          marks: payload.p_marks,
          saved_at: new Date().toISOString(),
          given: given ? payload.p_marks : was.given || null,
          given_rev: data.given_rev == null ? null : data.given_rev,
          given_at: given ? new Date().toISOString() : was.given_at || null,
          waiting: data.waiting === true,
        });
      } else if (aid && data.result === 'changed' && _plainObject(data.marks)) {
        // Another device saved first: its marks are the page's (the teacher's own are not applied).
        var earlier = (_fbRows[cid] && _fbRows[cid][aid] && _fbRows[cid][aid][payload.p_file_id]) || {};
        _fbPutRow(cid, aid, payload.p_file_id, {
          file_id: payload.p_file_id,
          enrollment_id: /** @type {NonNullable<typeof page>} */ (page).submission.enrollment_id,
          rev: data.rev,
          marks: data.marks,
          saved_at: earlier.saved_at || null,
          given: earlier.given || null,
          given_rev: earlier.given_rev == null ? null : earlier.given_rev,
          given_at: earlier.given_at || null,
          waiting: true,
        });
        _fbWrites[cid] = (_fbWrites[cid] || 0) + 1;
        _fbChanged(cid);
        _invalidateAndRerender();
        return;
      }
    } else if (endpoint === 'return_work') {
      // Every page of these students on this piece that was waiting is theirs now.
      var listed = {};
      (Array.isArray(payload.p_enrollment_ids) ? payload.p_enrollment_ids : []).forEach(function (sid) {
        listed[sid] = true;
      });
      var rows = (_fbRows[cid] || {})[payload.p_assessment_id] || {};
      Object.keys(rows).forEach(function (fid) {
        var r = rows[fid];
        if (!listed[r.enrollment_id] || r.waiting !== true) return;
        r.given = r.marks;
        r.given_rev = r.rev;
        r.given_at = new Date().toISOString();
        r.waiting = false;
      });
    } else if (
      endpoint === 'return_for_revision' ||
      endpoint === 'set_revision_request' ||
      endpoint === 'cancel_revision'
    ) {
      // The request as the server now has it (a Return for Revision also returned the work: the rows are read again).
      var all = (_fbServer[cid] && _fbServer[cid].revisions) || [];
      if (_plainObject(data.request) && data.request.id) {
        var found = all.findIndex(function (r) {
          return r && r.id === data.request.id;
        });
        if (found >= 0) all[found] = data.request;
        else all.push(data.request);
        if (_fbServer[cid]) _fbServer[cid].revisions = all;
      }
      if (endpoint === 'return_for_revision') _refreshGradeReturnsSoon(cid);
    } else if (endpoint === 'answer_reflection') {
      var list = (_fbServer[cid] && _fbServer[cid].reflections) || [];
      var at = list.findIndex(function (r) {
        return r && r.id === payload.p_reflection_id;
      });
      if (at >= 0 && _plainObject(data.reflection)) list[at] = data.reflection;
    }
    _fbWrites[cid] = (_fbWrites[cid] || 0) + 1;
    _fbChanged(cid);
  } catch (e) {
    console.warn('feedback: following up a write failed:', e);
  }
}

/* A save of Mark Up for a live class (saveMarkup). The save goes through
   the outbox, one at a time for a student's piece and in order. The screen
   waits for the server's answer a few seconds (it needs the new rev, or
   to hear that another device saved first); when there is none (offline,
   slow) it goes on as if saved, and the outbox sends the marks when it
   can. A save that landed after the screen moved on is put in the cache by
   _onFeedbackWriteEvent either way. */
function _saveMarkupLive(cid, fileId, marks, baseRev, key) {
  var page = _isUuid(fileId) ? _markupPage(cid, fileId) : null;
  var sub = page && page.submission;
  if (!sub || !_isUuid(sub.assessment_id) || !_isUuid(sub.enrollment_id))
    return Promise.resolve({ result: 'not_found' });
  var before = (_fbMarkupKept(cid)[fileId] || {}).rev || 0;
  var base = baseRev == null ? null : baseRev;
  var sent = _writeRpc(
    'save_markup',
    {
      p_file_id: fileId,
      p_marks: _studentWorkCopy(marks),
      p_base_rev: base,
      p_idempotency_key: _isUuid(key) ? key : _newEntryId(),
    },
    { key: 'cell:' + sub.enrollment_id + ':' + sub.assessment_id },
  );
  if (sent && sent.refused) return Promise.resolve({ result: 'failed' });
  _fbChanged(cid);
  _trackPendingSync(Promise.resolve(sent));
  var late = new Promise(function (resolve) {
    setTimeout(resolve, _MARKUP_SAVE_WAIT_MS, null);
  });
  return Promise.race([Promise.resolve(sent), late]).then(function (res) {
    if (!res) {
      // No answer yet: the marks are queued and shown; the rev is the one the save will make.
      var rev = (base != null ? base : before) + 1;
      return { result: 'saved', file_id: fileId, rev: rev, given: !_markupHeld(cid) };
    }
    var data = res.error ? null : _rpcObject(res.data);
    if (data && data.result === 'saved') {
      return {
        result: 'saved',
        file_id: fileId,
        rev: data.rev,
        given: data.given_rev != null && data.given_rev === data.rev,
      };
    }
    if (data && data.result === 'changed') {
      return {
        result: 'changed',
        file_id: fileId,
        rev: data.rev || 0,
        marks: _studentWorkCopy(data.marks) || { v: 1, marks: [] },
      };
    }
    var code = res.error && (res.error.code || res.error.message || '');
    if (/P0002|page not found/i.test(String(code))) return { result: 'not_found' };
    return { result: 'failed' };
  });
}

/* Return with the marks for a live class (return_work): returnGrades'
   drafts, each returned with its marks in one call (return_grades is
   return_work's first step), and, for a student whose grade is already
   back but whose marks are waiting, a call of its own. One student to a call,
   each with its own key, so a retry returns nothing twice. Synchronous, as
   returnGrades is; the marks show as given at once (_fbMarkupKept lays the
   queued call over them). */
function _returnWorkLive(cid, aid, ids) {
  var listed = {};
  ids.forEach(function (sid) {
    if (typeof sid === 'string') listed[sid] = true;
  });
  var waiting = getAssessmentMarkup(cid, aid).filter(function (r) {
    return listed[r.enrollment_id] && r.waiting;
  });
  var out = Object.assign({}, returnGrades(cid, aid, ids, true), {
    marks_given: 0,
    marks_enrollment_ids: /** @type {string[]} */ ([]),
  });
  waiting.forEach(function (r) {
    out.marks_given++;
    if (out.marks_enrollment_ids.indexOf(r.enrollment_id) < 0) out.marks_enrollment_ids.push(r.enrollment_id);
  });
  // A student returned above went with their marks. The rest have only marks to give.
  out.marks_enrollment_ids.forEach(function (sid) {
    if (out.enrollment_ids.indexOf(sid) >= 0) return;
    if (!_writesEnabled() || !_isSendableId(aid) || !_isSendableId(sid)) return;
    var sent = _writeRpc('return_work', {
      p_assessment_id: aid,
      p_enrollment_ids: [sid],
      p_idempotency_key: _newEntryId(),
    });
    _fbChanged(cid);
    _trackPendingSync(Promise.resolve(sent));
  });
  return out;
}
