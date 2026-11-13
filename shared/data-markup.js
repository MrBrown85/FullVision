/* Mark Up: the teacher's marks on a page of student work, as Demo Mode keeps them, the readers both kinds of class share, and Return with the marks (returnWork).
   Moved from shared/data.js on 2026-11-12 (S19 split, move only). */

/* ══════════════════════════════════════════════════════════════════
   Mark Up: marks on a page of student work (S9)
   ══════════════════════════════════════════════════════════════════
   Marks are drawing data over a page, never burned in: the stored photo
   (its path, bytes and sha256) never changes. Each handed-in page has two
   copies of its marks:
   - the teacher's working copy (`marks`, with `rev` and `saved_at`), which
     every save replaces whole and which is never shown to a student;
   - the copy the student was last given (`given`, with `given_rev` and
     `given_at`). In a class that holds grades (its student page on and
     When I Return Them) it is set only by a Return (returnWork). In any
     other class it is set at each save, as grades are. A mark made and
     erased before Return never reaches it.

   Shapes are the server's (migrations/local-test/batch-c-contract.md on
   batch-c-markup-reflect-revise, PR 1043, not applied): save_markup,
   list_assessment_markup, return_work, and the student's markup(...) and
   feedback(...).marks. Each server shape is made in one function here
   (_markupRow, _markupSaved, _studentMarkupFiles), so the wiring PR
   (S9-W1) changes one place when a name moves.

   A mark: an object whose `type` is pen, highlight, note, tick or cross; a
   note has a `text` of 1 to 500 characters. Everything else on it is kept
   as sent. Demo Mode's sample (seed-data.js) places marks by fractions of
   the page (x and y from 0 to 1, from the top left), so they stay put at
   any size. A page's marks: { v: 1, marks: [...] }, 500 marks and 256 KB
   at most. The Eraser removes marks from the list; it is not a mark.

   Demo Mode keeps them in localStorage under gb-student-feedback-<cid>
   (field `markup`, by file id). A signed-in class's are the server's (the
   block above, "Mark Up and Reflect on Feedback for a signed-in teacher"):
   the same readers and writers answer from it. Kept out of class backups
   and Download All My Data, as the photos are. */
var MARKUP_MAX_MARKS = 500;
var MARKUP_MAX_BYTES = 256 * 1024;
var MARKUP_NOTE_MAX = 500;
var _MARKUP_TYPES = ['pen', 'highlight', 'note', 'tick', 'cross'];
var _IDEM_KEPT = 200; // remembered answers per class, newest kept
var _studentFeedback = {}; // cid → { raw, value }: the stored feedback (Demo Mode) as last read

function _studentFeedbackStored(cid) {
  if (!cid || !_isDemoSession()) return null;
  var raw = null;
  try {
    raw = localStorage.getItem('gb-student-feedback-' + cid);
  } catch (e) {
    raw = null;
  }
  var held = _studentFeedback[cid];
  if (!held || held.raw !== raw) {
    var value = null;
    try {
      value = raw == null ? null : JSON.parse(raw);
    } catch (e) {
      value = null;
    }
    held = _studentFeedback[cid] = { raw: raw, value: _plainObject(value) ? value : null };
  }
  return held.value;
}

// A copy of the class's stored feedback to change, or an empty one.
function _studentFeedbackDraft(cid) {
  var stored = _studentWorkCopy(_studentFeedbackStored(cid));
  if (!_plainObject(stored)) stored = {};
  return {
    markup: _plainObject(stored.markup) ? stored.markup : {},
    reflections: _plainObject(stored.reflections) ? stored.reflections : {},
    // Revisions (S11): requests by id.
    revisions: _plainObject(stored.revisions) ? stored.revisions : {},
    idem: _plainObject(stored.idem) ? stored.idem : {},
    idem_order: Array.isArray(stored.idem_order) ? stored.idem_order : [],
  };
}

function _studentFeedbackWrite(cid, draft) {
  var raw = JSON.stringify(draft);
  _safeLSSet('gb-student-feedback-' + cid, raw);
  _studentFeedback[cid] = { raw: raw, value: draft };
}

/* A remembered answer for `key` (what the server keeps under
   p_idempotency_key), or undefined. `what` keeps one function's keys from
   answering for another's. */
function _feedbackRemembered(cid, what, key) {
  var stored = _studentFeedbackStored(cid);
  var hit = stored && _plainObject(stored.idem) ? stored.idem[what + ':' + key] : undefined;
  return hit === undefined ? undefined : _studentWorkCopy(hit);
}
function _feedbackRemember(draft, what, key, answer) {
  var k = what + ':' + key;
  draft.idem[k] = _studentWorkCopy(answer);
  draft.idem_order = draft.idem_order.filter(function (x) {
    return x !== k;
  });
  draft.idem_order.push(k);
  while (draft.idem_order.length > _IDEM_KEPT) delete draft.idem[draft.idem_order.shift()];
}

function _idemKeyOk(key) {
  return typeof key === 'string' && key.length > 0 && key.length <= 100;
}

function _markupBytes(s) {
  return typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(s).length : s.length;
}

/* True when `marks` is a page's marks as save_markup takes them. */
function _markupValid(marks) {
  if (!_plainObject(marks) || marks.v !== 1 || !Array.isArray(marks.marks)) return false;
  if (marks.marks.length > MARKUP_MAX_MARKS) return false;
  var ok = marks.marks.every(function (m) {
    if (!_plainObject(m) || _MARKUP_TYPES.indexOf(m.type) < 0) return false;
    if (m.type !== 'note') return true;
    return typeof m.text === 'string' && m.text.length >= 1 && m.text.length <= MARKUP_NOTE_MAX;
  });
  return ok && _markupBytes(JSON.stringify(marks)) <= MARKUP_MAX_BYTES;
}

/* The handed-in page `fileId` in the class: { file, submission }, or null
   (a page not handed in, unsent, deleted, or of a deleted piece). */
function _markupPage(cid, fileId) {
  if (!fileId) return null;
  // A signed-in class's page still uploading has a local id and no marks.
  if (_fbOn(cid) && !_isUuid(fileId)) return null;
  var subs = _studentWorkSubmissions(cid);
  for (var i = 0; i < subs.length; i++) {
    var files = subs[i].files || [];
    for (var j = 0; j < files.length; j++) {
      if (files[j] && files[j].id === fileId) return { file: files[j], submission: subs[i] };
    }
  }
  return null;
}

/* A class whose marks wait for a Return, as its grades do. */
function _markupHeld(cid) {
  return typeof GradeState !== 'undefined' && GradeState.holds(getReturnSettings(cid));
}

/* Every page's marks of the class by file id: Demo Mode's own, or a
   signed-in class's from the server (_fbMarkupKept). */
function _markupKeptMap(cid) {
  if (_fbOn(cid)) return _fbMarkupKept(cid);
  var stored = _studentFeedbackStored(cid);
  return stored && _plainObject(stored.markup) ? stored.markup : {};
}

// list_assessment_markup's row for one page.
function _markupRow(fileId, enrollmentId, kept) {
  var k = kept || {};
  var rev = k.rev || 0;
  return {
    file_id: fileId,
    enrollment_id: enrollmentId,
    rev: rev,
    marks: _studentWorkCopy(k.marks) || { v: 1, marks: [] },
    saved_at: k.saved_at || null,
    given: k.given ? _studentWorkCopy(k.given) : null,
    given_rev: k.given_rev == null ? null : k.given_rev,
    given_at: k.given_at || null,
    // The server's own word on it for a signed-in class (_fbWaiting).
    waiting: typeof k.waiting === 'boolean' ? k.waiting : rev > 0 && k.given_rev !== rev,
  };
}

/* One page's marks for the teacher: list_assessment_markup's row, both
   copies. A handed-in page with no marks yet has rev 0 and no marks; a page
   not handed in (or signed in, for now) is null. */
function getPageMarkup(cid, fileId) {
  var page = _markupPage(cid, fileId);
  if (!page) return null;
  return _markupRow(fileId, page.submission.enrollment_id, _markupKeptMap(cid)[fileId] || null);
}

/* list_assessment_markup: a row for every handed-in page of `aid` that
   has been marked, in the order of the students' work, each page in order. */
function getAssessmentMarkup(cid, aid) {
  var kept = _markupKeptMap(cid);
  var out = [];
  _studentWorkSubmissions(cid).forEach(function (s) {
    if (s.assessment_id !== aid) return;
    (s.files || []).forEach(function (f) {
      if (f && kept[f.id]) out.push(_markupRow(f.id, s.enrollment_id, kept[f.id]));
    });
  });
  return out;
}

// save_markup's answers.
function _markupSaved(fileId, kept) {
  return { result: 'saved', file_id: fileId, rev: kept.rev, given: kept.given_rev === kept.rev };
}
function _markupChanged(fileId, kept) {
  var k = kept || {};
  return {
    result: 'changed',
    file_id: fileId,
    rev: k.rev || 0,
    marks: _studentWorkCopy(k.marks) || { v: 1, marks: [] },
  };
}

/* Save the whole set of working marks for one page (save_markup). `marks`
   is { v: 1, marks: [...] }; `baseRev` the rev the screen last read (0 for
   none) or null to skip the check; `key` an idempotency key the screen makes
   once per save and sends again on a retry. A Promise, never rejected, of:
   { result: 'saved', file_id, rev, given }  (given: the student already has
     these marks, in a class that does not hold grades);
   { result: 'changed', file_id, rev, marks }  another save came first;
     nothing written;
   { result: 'invalid' }  marks of the wrong shape, or no key;
   { result: 'not_found' }  the page is not handed in;
   { result: 'failed' }  signed in: the save could not be queued or the
     server refused it;
   { result: 'not_available' }  a class that keeps no student-page rows.
   Signed in it is save_markup through the outbox (_saveMarkupLive). */
function saveMarkup(cid, fileId, marks, baseRev, key) {
  if (!cid || !(_isDemoSession() || _fbOn(cid))) return Promise.resolve({ result: 'not_available' });
  if (!_markupValid(marks) || !_idemKeyOk(key)) return Promise.resolve({ result: 'invalid' });
  if (baseRev != null && !(typeof baseRev === 'number' && baseRev >= 0 && Math.floor(baseRev) === baseRev)) {
    return Promise.resolve({ result: 'invalid' });
  }
  if (!_isDemoSession()) return _saveMarkupLive(cid, fileId, marks, baseRev, key);
  var again = _feedbackRemembered(cid, 'markup-save', key);
  if (again !== undefined) return Promise.resolve(again);
  if (!_markupPage(cid, fileId)) return Promise.resolve({ result: 'not_found' });
  var draft = _studentFeedbackDraft(cid);
  var kept = draft.markup[fileId] || null;
  var rev = (kept && kept.rev) || 0;
  if (baseRev != null && baseRev !== rev) return Promise.resolve(_markupChanged(fileId, kept));
  var now = new Date().toISOString();
  var next = Object.assign({}, kept || {}, {
    rev: rev + 1,
    marks: _studentWorkCopy(marks),
    saved_at: now,
  });
  // Not held: the student has them at once, as a grade saved is returned.
  if (!_markupHeld(cid)) {
    next.given = _studentWorkCopy(marks);
    next.given_rev = next.rev;
    next.given_at = now;
  }
  draft.markup[fileId] = next;
  var answer = _markupSaved(fileId, next);
  _feedbackRemember(draft, 'markup-save', key, answer);
  _studentFeedbackWrite(cid, draft);
  return Promise.resolve(answer);
}

/* True when one of the student's pages of `aid` has marks the student has
   not been given (list_assessment_markup's waiting): what To Return should
   count beside drafts. */
function studentMarkupWaiting(cid, sid, aid) {
  return getAssessmentMarkup(cid, aid).some(function (r) {
    return r.enrollment_id === sid && r.waiting;
  });
}

/* True when a page of the student's OWN work on `aid` (one submission
   only, with `submissionId`) carries at least one of the teacher's marks,
   given to the student or not: the server's _grading_started (C1, section
   2b; Colin, Nov 11). A page whose marks were all erased does not count;
   a group-mate's pages do not count for this student. Signed in there are
   no marks here (getAssessmentMarkup reads none). */
function _teacherMarksOnWork(cid, sid, aid, submissionId) {
  return getAssessmentMarkup(cid, aid).some(function (r) {
    if (r.enrollment_id !== sid || !r.marks || !Array.isArray(r.marks.marks) || !r.marks.marks.length) return false;
    if (!submissionId) return true;
    var page = _markupPage(cid, r.file_id);
    return !!page && page.submission.id === submissionId;
  });
}

/* Return, with the marks (return_work): returnGrades unchanged, then each
   listed student of the class is given the working marks on their pages of
   `aid`. Use it in place of returnGrades wherever Mark Up can be on screen.
   Synchronous, as returnGrades is. Answers returnGrades' { returned,
   enrollment_ids, returned_at } plus marks_given (pages) and
   marks_enrollment_ids. Signed in it is return_work: each student's grade
   and marks in one call (_returnWorkLive). */
function returnWork(cid, aid, studentIds) {
  var ids = Array.isArray(studentIds) ? studentIds : studentIds ? [studentIds] : [];
  if (!_isDemoSession() && _fbOn(cid)) return _returnWorkLive(cid, aid, ids);
  var out = Object.assign({}, returnGrades(cid, aid, ids), { marks_given: 0, marks_enrollment_ids: [] });
  // Signed in there are no marks to give (getAssessmentMarkup reads none).
  var listed = {};
  ids.forEach(function (sid) {
    if (typeof sid === 'string') listed[sid] = true;
  });
  var rows = getAssessmentMarkup(cid, aid).filter(function (r) {
    return listed[r.enrollment_id] && r.waiting;
  });
  if (!rows.length) return out;
  var draft = _studentFeedbackDraft(cid);
  var now = new Date().toISOString();
  rows.forEach(function (r) {
    var kept = draft.markup[r.file_id];
    kept.given = _studentWorkCopy(kept.marks);
    kept.given_rev = kept.rev;
    kept.given_at = now;
    out.marks_given++;
    if (out.marks_enrollment_ids.indexOf(r.enrollment_id) < 0) out.marks_enrollment_ids.push(r.enrollment_id);
  });
  _studentFeedbackWrite(cid, draft);
  return out;
}

/* The given marks on one student's pages of `aid`, or [] when the student
   sees none: the piece is set not to show them (Students See Your Mark
   Up off) or Missing or Excused is on it. null for a piece not in the class. */
function _studentMarkupFiles(cid, sid, aid) {
  if (!_assessmentById(cid, aid)) return null;
  if (getAssessmentStudentWork(cid, aid).students_see_markup === false) return [];
  var status = getAssignmentStatus(cid, sid, aid);
  if (status === 'NS' || status === 'EXC') return [];
  var kept = _markupKeptMap(cid);
  var out = [];
  _studentWorkSubmissions(cid).forEach(function (s) {
    if (s.assessment_id !== aid || s.enrollment_id !== sid) return;
    (s.files || []).forEach(function (f) {
      var k = f && kept[f.id];
      if (k && k.given) out.push({ file_id: f.id, marks: _studentWorkCopy(k.given), given_at: k.given_at || null });
    });
  });
  return out;
}

/* What the student sees on their pages of `aid` (the student's
   markup(...)): { ok: true, files: [{ file_id, marks, given_at }] }, the
   given copy only. { ok: false, error: 'not_found' } for a piece not in
   the class. A class that keeps no student-page rows: { ok: true, files: [] }. */
function getStudentMarkup(cid, sid, aid) {
  if (!_fbReads(cid)) return { ok: true, files: [] };
  var files = _studentMarkupFiles(cid, sid, aid);
  return files ? { ok: true, files: files } : { ok: false, error: 'not_found' };
}

/* "3 notes on your work": feedback(...).marks for one student and piece,
   { pages, notes } over the given marks the student sees, or null when
   there are none (not yet returned with marks, hidden). */
function getStudentMarkCounts(cid, sid, aid) {
  if (!_fbReads(cid)) return null;
  var files = (_studentMarkupFiles(cid, sid, aid) || []).filter(function (f) {
    return f.marks && Array.isArray(f.marks.marks) && f.marks.marks.length > 0;
  });
  if (!files.length) return null;
  var notes = 0;
  files.forEach(function (f) {
    f.marks.marks.forEach(function (m) {
      if (m && m.type === 'note') notes++;
    });
  });
  return { pages: files.length, notes: notes };
}

/* Demo Mode's sample marks (seed-data.js): { file_id: { v: 1, marks } },
   saved as the teacher's working copy and given to the student, as a class
   that does not hold grades gives them. Refused (false) outside Demo Mode,
   for a page not handed in, or for marks of the wrong shape. */
function saveDemoMarkup(cid, pages) {
  if (!cid || !_isDemoSession() || !_plainObject(pages)) return false;
  var ids = Object.keys(pages);
  var ok = ids.every(function (id) {
    return _markupPage(cid, id) && _markupValid(pages[id]);
  });
  if (!ok) return false;
  var draft = _studentFeedbackDraft(cid);
  var now = new Date().toISOString();
  ids.forEach(function (id) {
    var marks = _studentWorkCopy(pages[id]);
    draft.markup[id] = {
      rev: 1,
      marks: marks,
      saved_at: now,
      given: _studentWorkCopy(marks),
      given_rev: 1,
      given_at: now,
    };
  });
  _studentFeedbackWrite(cid, draft);
  return true;
}
