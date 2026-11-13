/* Student work: what students sent and the settings that let them send (the read side), group work's reader, work a teacher adds,
   and the same for a signed-in teacher from the server (Add Work's uploads). Moved from shared/data.js on 2026-11-12 (S19 split, move only). */

/* ══════════════════════════════════════════════════════════════════
   Student work: the client's read side (S5-F5)
   ══════════════════════════════════════════════════════════════════
   What students have sent, and the two settings that let them send: the
   class's Send Work switch and each assessment's Students Send. Read here
   in the shapes the server sends them (migrations/local-test/
   batch-b-contract.md on the batch-b-submissions branch, coded to commit
   5cbe3657), so a screen built on these needs no change when the wiring
   PR (S5-W1) fills them from the server:

   getCourseSubmissions(cid)   list_course_submissions(p_course_id):
     { bucket, course: { send_work, keep_photos_until },
       assessments: [{ id, students_send, after_due, accept_until,
                       group_work, students_see_markup }],   every assessment
       submissions: [{ id, assessment_id, enrollment_id, version, state,
                       sent_by, on_paper, is_late, note, followed_plan,
                       created_at, sent_at,
                       files: [{ id, page, path, thumb_path, bytes,
                                 thumb_bytes, width, height, rotation,
                                 sha256 }] }],          handed in only
       uploads: [] }
   getStudentSubmission(cid, sid, aid)   one student's submission for one
     assessment (the newest version), as in `submissions`, or null.
   getAssessmentStudentWork(cid, aid)    one entry of `assessments`.
   getCourseSendWork(cid)                `course`.
   getStudentWork(cid, sid)              the student page's work(...):
     { ok, v, send_work, assessments: [{ id, students_send, open,
       closes_on, late_now, sent, sending }] }, `sent` as
     { submission_id, sent_at, sent_by, on_paper, is_late, note, pages,
       grading, can_change }.
   studentWorkGradingStarted(cid, sid, aid)   Colin's rule: the piece holds
     a draft or a returned grade (a level, points, a tick) or an Overall
     Comment for that student. A Late, Missing or Excused mark alone is not.
   studentWorkPageUrl(cid, file, which)  a Promise of an address an <img>
     can show for one page ('page') or its thumbnail ('thumb'), or null.
     Shipped sample files only; openStudentWorkPage also shows a photo
     still in the photo queue.
   addStudentWorkPages, replaceStudentWorkPages, markStudentWorkOnPaper,
   deleteStudentWork, openStudentWorkPage   work a teacher adds or deletes (below, "Work a teacher adds").

   A client student id is the server's enrollment id, so enrollment_id is
   the student's id here. Every answer is a copy: changing it changes
   nothing stored.

   Demo Mode: the sample work is shared/seed-data.js's
   (saveDemoStudentWork), kept in localStorage under
   gb-student-work-<cid>. Its pages are drawn images shipped with the app
   in assets/sample-work/, so a page's path and thumb_path there are file
   names in that folder, not storage paths. A signed-in class whose
   student page the server has on is answered from the server (below,
   "Student work for a signed-in teacher", S5-W1); any other class gets
   the empty answers (Send Work off, every assessment taking nothing,
   nothing sent), and nothing here calls the server for it.

   Kept out of class backups and Download All My Data on purpose (S8-F2):
   this is not one of the _DATA_KEYS fields. */
var STUDENT_WORK_MAX_PAGES = 30;
var _STUDENT_WORK_DEMO_DIR = '/assets/sample-work/';
var _STUDENT_WORK_DEFAULTS = {
  students_send: 'nothing',
  after_due: 'keep',
  accept_until: null,
  group_work: 'each',
  students_see_markup: true,
};
var _studentWork = {}; // cid → { raw, value }: the stored sample work (Demo Mode) as last read

function _studentWorkStored(cid) {
  // A signed-in class with its student page on: the server's (S5-W1, below).
  if (_workOnServer(cid)) return _workServerView(cid);
  if (!cid || !_isDemoSession()) return null;
  var raw = null;
  try {
    raw = localStorage.getItem('gb-student-work-' + cid);
  } catch (e) {
    raw = null;
  }
  var held = _studentWork[cid];
  if (!held || held.raw !== raw) {
    var value = null;
    try {
      value = raw == null ? null : JSON.parse(raw);
    } catch (e) {
      value = null;
    }
    held = _studentWork[cid] = { raw: raw, value: _plainObject(value) ? value : null };
  }
  return held.value;
}

function _studentWorkCopy(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

/* Demo Mode's sample work for a class (seed-data.js), in the shape
   getCourseSubmissions answers; bucket and uploads are left out. Refused
   (false) outside Demo Mode and for a submission of more than 30 pages. */
function saveDemoStudentWork(cid, work) {
  if (!cid || !_isDemoSession() || !_plainObject(work)) return false;
  var subs = Array.isArray(work.submissions) ? work.submissions : [];
  var tooMany = subs.some(function (s) {
    return !s || (Array.isArray(s.files) && s.files.length > STUDENT_WORK_MAX_PAGES);
  });
  if (tooMany) return false;
  var stored = {
    course: Object.assign({ send_work: false, keep_photos_until: 'end_of_year' }, _studentWorkCopy(work.course) || {}),
    assessments: _studentWorkCopy(Array.isArray(work.assessments) ? work.assessments : []),
    submissions: _studentWorkCopy(subs),
  };
  var raw = JSON.stringify(stored);
  _safeLSSet('gb-student-work-' + cid, raw);
  _studentWork[cid] = { raw: raw, value: stored };
  return true;
}

function getCourseSendWork(cid) {
  var stored = _studentWorkStored(cid);
  var course = stored && stored.course;
  return {
    send_work: !!(course && course.send_work === true),
    keep_photos_until: course && course.keep_photos_until === 'end_of_term' ? 'end_of_term' : 'end_of_year',
  };
}

function getAssessmentStudentWork(cid, aid) {
  var stored = _studentWorkStored(cid);
  var own =
    stored &&
    (stored.assessments || []).find(function (a) {
      return a && a.id === aid;
    });
  var out = Object.assign({ id: aid }, _STUDENT_WORK_DEFAULTS, own ? _studentWorkCopy(own) : {});
  out.id = aid;
  if (out.after_due !== 'until') out.accept_until = null;
  return out;
}

function _studentWorkSubmissions(cid) {
  var stored = _studentWorkStored(cid);
  if (!stored) return [];
  var aids = {};
  (getAssessments(cid) || []).forEach(function (a) {
    if (a && a.id) aids[a.id] = true;
  });
  // The server takes an assessment's work with it when it is deleted.
  return (stored.submissions || [])
    .filter(function (s) {
      return s && s.state === 'sent' && aids[s.assessment_id];
    })
    .map(function (s) {
      return _studentWorkReadable(s);
    });
}
// One stored submission as the readers give it: a copy, its pages in order.
function _studentWorkReadable(s) {
  var out = _studentWorkCopy(s);
  out.files = (Array.isArray(out.files) ? out.files : []).slice().sort(function (x, y) {
    return (x.page || 0) - (y.page || 0);
  });
  // Who added each page (the contract's added_by); the sample's pages
  // were all added by whoever sent the work.
  out.files.forEach(function (f) {
    if (f && f.added_by !== 'teacher' && f.added_by !== 'student') {
      f.added_by = out.sent_by === 'teacher' ? 'teacher' : 'student';
    }
  });
  return out;
}

function getCourseSubmissions(cid) {
  return {
    bucket: 'student-photos',
    course: getCourseSendWork(cid),
    assessments: (getAssessments(cid) || [])
      .filter(function (a) {
        return a && a.id;
      })
      .map(function (a) {
        return getAssessmentStudentWork(cid, a.id);
      }),
    submissions: _studentWorkSubmissions(cid),
    uploads: [],
  };
}

function getStudentSubmission(cid, sid, aid) {
  return _newestSubmissionsOf(cid, [sid], aid)[0] || null;
}
// The class's stored work, not copied: only for looking (GraderWork.workShown).
function peekStudentWork(cid) {
  return _studentWorkStored(cid);
}

function studentWorkGradingStarted(cid, sid, aid) {
  var row = getGradeReturn(cid, sid, aid);
  if (row && row.is_draft) return true;
  if (hasScoreOrFeedback(cid, sid, aid)) return true;
  return getRubricCheckIds(cid, sid, aid).length > 0;
}

/* The window for sending, by the class's own date, as the server's
   _work_window works it out: an assessment's `date` is its date_assigned
   and `dueDate` its due_date. */
function _studentWorkWindow(cid, a, settings) {
  var today = courseToday(cid);
  var due = a.dueDate || a.due_date ? String(a.dueDate || a.due_date).slice(0, 10) : null;
  var closes = settings.after_due === 'until' ? settings.accept_until : settings.after_due === 'stop' ? due : null;
  var open =
    settings.after_due === 'until'
      ? !!closes && today <= closes
      : settings.after_due === 'stop'
        ? !due || today <= due
        : true;
  return {
    listed: !a.date || String(a.date).slice(0, 10) <= today,
    closes_on: closes || null,
    open: open,
    late: !!due && today > due,
  };
}

function getStudentWork(cid, sid) {
  var send = getCourseSendWork(cid).send_work;
  var listed = (getAssessments(cid) || [])
    .map(function (a, i) {
      return { a: a, i: i };
    })
    .filter(function (x) {
      return x.a && x.a.id;
    })
    // Undated first, then oldest first; the class's own order within a day.
    .sort(function (x, y) {
      var p = x.a.date ? String(x.a.date).slice(0, 10) : '';
      var q = y.a.date ? String(y.a.date).slice(0, 10) : '';
      if (p !== q) return p < q ? -1 : 1;
      return x.i - y.i;
    });
  var out = [];
  listed.forEach(function (x) {
    var a = x.a;
    var settings = getAssessmentStudentWork(cid, a.id);
    var w = _studentWorkWindow(cid, a, settings);
    var s = getStudentSubmission(cid, sid, a.id);
    if (!w.listed || (settings.students_send === 'nothing' && !s)) return;
    var takes = send && settings.students_send !== 'nothing' && w.open;
    // Grading has started for the student once the teacher's marks are on a
    // page of their work too (Colin, Nov 11): they can no longer change it.
    var started = !!s && (studentWorkGradingStarted(cid, sid, a.id) || _teacherMarksOnWork(cid, sid, a.id));
    out.push({
      id: a.id,
      students_send: settings.students_send,
      open: takes,
      closes_on: w.closes_on,
      late_now: w.late,
      sent: s
        ? {
            submission_id: s.id,
            sent_at: s.sent_at,
            sent_by: s.sent_by,
            on_paper: !!s.on_paper,
            is_late: !!s.is_late,
            note: s.note == null ? null : s.note,
            pages: (s.files || []).length,
            grading: started,
            can_change: s.sent_by === 'student' && !started && takes,
          }
        : null,
      // A send that is not finished: there is none in Demo Mode's sample.
      sending: null,
    });
  });
  return { ok: true, v: 1, send_work: send, assessments: out };
}

function studentWorkPageUrl(cid, file, which) {
  var name = file && (which === 'thumb' ? file.thumb_path : file.path);
  // Demo Mode's sample pages only: a live class's are opened (openStudentWorkPage).
  if (!name || !_isDemoSession() || !_studentWorkStored(cid)) return Promise.resolve(null);
  // A sample page is a file name in assets/sample-work, nothing more.
  if (!/^[a-z0-9-]+\.jpg$/.test(name)) return Promise.resolve(null);
  return Promise.resolve(_STUDENT_WORK_DEMO_DIR + name);
}

/* ── Group work: the reader takes a group (S12-T1) ──────────────────────
   On a piece set to One per Group (Students Send's group_work 'group'),
   the group is the pair or group the teacher made on the assessment
   (collaboration Pairs or Groups, getCollabGroupOf). Each member who sends
   makes their own submission; the group's work is all of them together,
   and every member sees it (batch-c-contract.md, "Group work"). A member
   Graded Separately is still in the group's work: only their grade is
   their own. Everywhere else (Each Student, individual work, a student in
   no group, DIBELS) the group is the student alone, and these answer
   exactly what getStudentSubmission and getStudentWork answer for them.

   Shapes: getStudentGroupWork is the student's group_work(...),
   getGroupWorkFiles the files group_file_links(...) makes links for.
   No answer here carries a group-mate's name. Demo Mode, and a signed-in
   class the server keeps rows for (each member's own submission comes from
   list_course_submissions); any other class answers empty. */

/* The group `sid` sends with on `aid`: { kind: 'pair' | 'group', index,
   members, separate } (members on the roster, in the group's order;
   separate: `sid` is Graded Separately), or null when the student sends
   alone. */
function getStudentWorkGroup(cid, sid, aid) {
  // Demo Mode, or a signed-in class the server keeps rows for (S12-W1): the groups are the teacher's own.
  if (!_isDemoSession() && !_fbOn(cid)) return null;
  // The class's own copy of the piece (pairs and groups as the teacher made them), not the server's raw row.
  var a = (getAssessments(cid) || []).find(function (x) {
    return x && x.id === aid;
  });
  if (!a || getAssessmentStudentWork(cid, aid).group_work !== 'group') return null;
  var group = getCollabGroupOf(a, sid);
  if (!group) return null;
  var roster = {};
  (getStudents(cid) || []).forEach(function (s) {
    if (s && s.id) roster[s.id] = true;
  });
  var members = group.members.filter(function (m) {
    return roster[m];
  });
  if (members.length < 2) return null;
  return { kind: group.kind, index: group.index, members: members, separate: isGradedSeparately(a, sid) };
}

/* The newest handed-in submission of each of `sids` on `aid`, in that
   order. Every screen asks this for one student and one piece at a time,
   hundreds of times a draw, so the class's work is sorted by piece and
   student once for each stored copy of it, and only the submission asked
   for is copied. (Copying the whole class's work for each ask took
   seconds a draw in a class with 600 pieces of work in.) */
var _workByPiece = { cid: null, stored: null, by: {} };
function _newestSubmissionsOf(cid, sids, aid) {
  var stored = _studentWorkStored(cid);
  // The server takes an assessment's work with it when it is deleted.
  var there = (getAssessments(cid) || []).some(function (a) {
    return a && a.id === aid;
  });
  if (!stored || !there) return [];
  if (_workByPiece.cid !== cid || _workByPiece.stored !== stored) {
    var by = {};
    (stored.submissions || []).forEach(function (s) {
      if (!s || s.state !== 'sent') return;
      var key = s.assessment_id + '|' + s.enrollment_id;
      // The newest version; of two alike, the one stored first.
      if (!by[key] || (s.version || 1) > (by[key].version || 1)) by[key] = s;
    });
    _workByPiece = { cid: cid, stored: stored, by: by };
  }
  var out = [];
  sids.forEach(function (sid) {
    var mine = _workByPiece.by[aid + '|' + sid];
    if (mine) out.push(_studentWorkReadable(mine));
  });
  return out;
}

/* The work in for `sid`'s group on `aid`: each member's newest handed-in
   submission, members in the group's order (the student's own first when
   they send alone, so a single student gets [their submission] or []). */
function getGroupSubmissions(cid, sid, aid) {
  var group = getStudentWorkGroup(cid, sid, aid);
  return _newestSubmissionsOf(cid, group ? group.members : [sid], aid);
}

/* True when work is in for `sid` on `aid`: their own, or on a One per
   Group piece a group-mate's. What To Grade and Not In should ask in place
   of getStudentSubmission (see GraderWork.workStateOf). */
function groupWorkIn(cid, sid, aid) {
  return getGroupSubmissions(cid, sid, aid).length > 0;
}

/* Every page of the group's work, as group_file_links lists them: each
   page of getGroupSubmissions' submissions, with enrollment_id (who sent
   it: an id, never a name), submission_id and mine (sent in `sid`'s own
   submission). Members in order, each one's pages in order. */
function getGroupWorkFiles(cid, sid, aid) {
  var out = [];
  getGroupSubmissions(cid, sid, aid).forEach(function (s) {
    (s.files || []).forEach(function (f) {
      out.push(
        Object.assign({}, f, { enrollment_id: s.enrollment_id, submission_id: s.id, mine: s.enrollment_id === sid }),
      );
    });
  });
  return out;
}

/* The student page's group_work(...): { ok, assessments: [{ id, members,
   sent, pages, you_sent, first_sent_at }] } for each One per Group piece
   the student's group is on: how many are in the group, whether any work
   is in, its pages, whether the student sent some, and when the first came
   in. No names. In the page's order (getStudentWork's). */
function getStudentGroupWork(cid, sid) {
  var out = [];
  (getStudentWork(cid, sid).assessments || []).forEach(function (w) {
    var group = getStudentWorkGroup(cid, sid, w.id);
    if (!group) return;
    var subs = _newestSubmissionsOf(cid, group.members, w.id);
    var first = null;
    var pages = 0;
    subs.forEach(function (s) {
      pages += (s.files || []).length;
      var at = s.sent_at || s.created_at;
      if (at && (!first || at < first)) first = at;
    });
    out.push({
      id: w.id,
      members: group.members.length,
      sent: subs.length > 0,
      pages: pages,
      you_sent: subs.some(function (s) {
        return s.enrollment_id === sid;
      }),
      first_sent_at: first,
    });
  });
  return { ok: true, assessments: out };
}

/* ── Work a teacher adds (S6-F2, S7-F3) ─────────────────────────────────
   Add Work, Add as More Pages, Replace Them and Handed In on Paper, in the
   shapes of the contract's start_work_upload + finish_work_upload and
   mark_handed_in_paper, so the wiring PR (S5-W1/S6-W1/S7-W1) can point
   them at the server without a screen changing.

   pages are PhotoShrink.prepare's, in order: [{ blob, thumb, hash, width,
   height, … }]. Each page waits in the photo queue (shared/photo-queue.js,
   IndexedDB) under its own local id. In Demo Mode it stays there for good:
   the queue never sends in Demo Mode, and the work is recorded on this
   device as handed in. A page still in the queue has the path
   "photo-queue:<id>" (its thumbnail "photo-queue:<id>:thumb"), which only
   openStudentWorkPage turns into an address.

   A signed-in class with its student page on goes to the server (below,
   _serverTeacherWork, S5-W1); any other signed-in class answers
   { result: 'not_available' } and calls nothing. Every answer is a
   Promise; none rejects. */
var _STUDENT_WORK_QUEUE_PATH = /^photo-queue:(p[a-z0-9]+)(:thumb)?$/;
var _teacherWorkChain = {}; // cid → the last teacher-work write's promise, so two never interleave

function _teacherWorkId() {
  return 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function _studentWorkWrite(cid, stored) {
  var raw = JSON.stringify(stored);
  _safeLSSet('gb-student-work-' + cid, raw);
  _studentWork[cid] = { raw: raw, value: stored };
}

// A copy of the class's stored work to change, or an empty one.
function _studentWorkDraft(cid) {
  var stored = _studentWorkCopy(_studentWorkStored(cid));
  if (!_plainObject(stored)) stored = {};
  return {
    course: Object.assign({ send_work: false, keep_photos_until: 'end_of_year' }, stored.course || {}),
    assessments: Array.isArray(stored.assessments) ? stored.assessments : [],
    submissions: Array.isArray(stored.submissions) ? stored.submissions : [],
  };
}

function _teacherWorkInClass(cid, sid, aid) {
  var hasPiece = (getAssessments(cid) || []).some(function (a) {
    return a && a.id === aid;
  });
  var hasStudent = (getStudents(cid) || []).some(function (s) {
    return s && s.id === sid;
  });
  return hasPiece && hasStudent;
}

// The newest handed-in submission for one student and piece in a draft.
function _teacherWorkSent(draft, sid, aid) {
  var found = draft.submissions
    .filter(function (s) {
      return s && s.state === 'sent' && s.enrollment_id === sid && s.assessment_id === aid;
    })
    .sort(function (x, y) {
      return (y.version || 1) - (x.version || 1);
    });
  return found[0] || null;
}

function _teacherWorkPagesOk(pages) {
  return (
    Array.isArray(pages) &&
    pages.length > 0 &&
    pages.every(function (p) {
      return p && p.blob && p.thumb && p.blob.size > 0 && p.thumb.size > 0;
    })
  );
}

// One write at a time per class: each waits for the one before it.
function _teacherWorkQueued(cid, work) {
  var before = _teacherWorkChain[cid] || Promise.resolve();
  var run = before.then(work, work).then(null, function () {
    return { result: 'store_failed' };
  });
  _teacherWorkChain[cid] = run;
  return run;
}

function _queuePagesOf(sub) {
  return ((sub && sub.files) || [])
    .map(function (f) {
      var m = f && typeof f.path === 'string' ? _STUDENT_WORK_QUEUE_PATH.exec(f.path) : null;
      return m && !m[2] ? m[1] : null;
    })
    .filter(Boolean);
}

/* Put pages in the photo queue for one submission. → { ok, ids } or the
   queue's refusal as an answer. */
function _teacherWorkQueuePages(cid, sid, aid, subId, pages) {
  var q = window.PhotoQueue;
  if (!q || typeof q.add !== 'function') return Promise.resolve({ ok: false, answer: { result: 'no_photo_store' } });
  return q.add({ course: cid, assessment: aid, enrollment: sid, submission: subId }, pages).then(function (res) {
    if (res && res.ok) return res;
    var reason = res && (res.reason === 'storage_full' || res.reason === 'invalid') ? res.reason : 'store_failed';
    return { ok: false, answer: { result: reason } };
  });
}

function _teacherWorkForget(ids) {
  var q = window.PhotoQueue;
  if (!q || typeof q.remove !== 'function' || !ids.length) return Promise.resolve();
  return Promise.all(
    ids.map(function (id) {
      return q.remove(id).then(null, function () {});
    }),
  );
}

function _teacherWorkFiles(queued, pages, firstPage) {
  return queued.map(function (qid, i) {
    var p = pages[i];
    return {
      id: qid,
      page: firstPage + i,
      path: 'photo-queue:' + qid,
      thumb_path: 'photo-queue:' + qid + ':thumb',
      bytes: p.blob.size,
      thumb_bytes: p.thumb.size,
      width: p.width || null,
      height: p.height || null,
      rotation: 0,
      sha256: p.hash || null,
      added_by: 'teacher',
    };
  });
}

/* What a teacher's Add Work would be answered, before or after the photos
   are kept (another write may have changed the piece meanwhile). null: go. */
function _teacherWorkCheck(cid, sid, aid, pages, mode) {
  if (!_teacherWorkInClass(cid, sid, aid)) return { result: 'not_found' };
  var sent = _teacherWorkSent(_studentWorkDraft(cid), sid, aid);
  if (mode === 'new' && sent) return { result: 'already_sent', submission: getStudentSubmission(cid, sid, aid) };
  if (mode !== 'new' && !sent) return { result: 'nothing_sent' };
  if (mode === 'add' && sent.on_paper) return { result: 'on_paper', submission: getStudentSubmission(cid, sid, aid) };
  var have = mode === 'add' ? (sent.files || []).length : 0;
  if (have + pages.length > STUDENT_WORK_MAX_PAGES)
    return { result: 'too_many_pages', room: STUDENT_WORK_MAX_PAGES - have };
  return null;
}

function _teacherWork(cid, sid, aid, pages, mode) {
  if (_workOnServer(cid)) return _serverTeacherWork(cid, sid, aid, pages, mode);
  if (!cid || !_isDemoSession()) return Promise.resolve({ result: 'not_available' });
  if (!_teacherWorkPagesOk(pages)) return Promise.resolve({ result: 'invalid' });
  return _teacherWorkQueued(cid, function () {
    var refused = _teacherWorkCheck(cid, sid, aid, pages, mode);
    if (refused) return refused;
    var target = _teacherWorkSent(_studentWorkDraft(cid), sid, aid);
    var subId = mode === 'add' ? target.id : _teacherWorkId();
    return _teacherWorkQueuePages(cid, sid, aid, subId, pages).then(function (kept) {
      if (!kept.ok) return kept.answer;
      // Asked again now the photos are kept: the piece may have changed.
      var late = _teacherWorkCheck(cid, sid, aid, pages, mode);
      var draft = _studentWorkDraft(cid);
      var now = _teacherWorkSent(draft, sid, aid);
      if (!late && mode !== 'new' && (!now || now.id !== target.id)) late = { result: 'nothing_sent' };
      if (late || !_isDemoSession()) {
        return _teacherWorkForget(kept.ids).then(function () {
          return late || { result: 'not_available' };
        });
      }
      var stamp = new Date().toISOString();
      var dropped = [];
      if (mode === 'add') {
        var last = (now.files || []).reduce(function (n, f) {
          return Math.max(n, (f && f.page) || 0);
        }, 0);
        now.files = (now.files || []).concat(_teacherWorkFiles(kept.ids, pages, last + 1));
        now.updated_at = stamp;
      } else {
        // Replace Them: every page of what is in goes, the student's among them.
        if (now) {
          dropped = _queuePagesOf(now);
          draft.submissions = draft.submissions.filter(function (s) {
            return s !== now;
          });
        }
        draft.submissions.push({
          id: subId,
          assessment_id: aid,
          enrollment_id: sid,
          version: (now && now.version) || 1,
          state: 'sent',
          sent_by: 'teacher',
          on_paper: false,
          is_late: false,
          note: null,
          followed_plan: null,
          created_at: stamp,
          sent_at: stamp,
          files: _teacherWorkFiles(kept.ids, pages, 1),
        });
      }
      _studentWorkWrite(cid, draft);
      return _teacherWorkForget(dropped).then(function () {
        return { result: 'sent', submission: getStudentSubmission(cid, sid, aid) };
      });
    });
  });
}

/* Add Work for one student with nothing in (mode 'new', the default), or
   Add as More Pages to what is in (mode 'add'). See the block above. */
function addStudentWorkPages(cid, sid, aid, pages, opts) {
  var mode = opts && opts.mode === 'add' ? 'add' : 'new';
  return _teacherWork(cid, sid, aid, pages, mode);
}

/* Replace Them: the new pages take the place of every page that is in. */
function replaceStudentWorkPages(cid, sid, aid, pages) {
  return _teacherWork(cid, sid, aid, pages, 'replace');
}

/* Handed In on Paper for these students. A student who already has work
   in, or is not in the class, is passed over. */
function markStudentWorkOnPaper(cid, aid, sids) {
  if (_workOnServer(cid)) return _serverMarkOnPaper(cid, aid, sids);
  if (!cid || !_isDemoSession()) return Promise.resolve({ result: 'not_available', marked: 0, submissions: [] });
  return _teacherWorkQueued(cid, function () {
    var draft = _studentWorkDraft(cid);
    var made = [];
    (Array.isArray(sids) ? sids : []).forEach(function (sid) {
      // A student named twice has work in by the second time.
      if (typeof sid !== 'string' || !_teacherWorkInClass(cid, sid, aid) || _teacherWorkSent(draft, sid, aid)) return;
      var stamp = new Date().toISOString();
      var sub = {
        id: _teacherWorkId(),
        assessment_id: aid,
        enrollment_id: sid,
        version: 1,
        state: 'sent',
        sent_by: 'teacher',
        on_paper: true,
        is_late: false,
        note: null,
        followed_plan: null,
        created_at: stamp,
        sent_at: stamp,
        files: [],
      };
      draft.submissions.push(sub);
      made.push(sid);
    });
    if (made.length) _studentWorkWrite(cid, draft);
    return {
      result: 'sent',
      marked: made.length,
      submissions: made.map(function (sid) {
        return getStudentSubmission(cid, sid, aid);
      }),
    };
  });
}

/* Delete Work (Colin's ruling 87): one student's newest handed-in work on
   a piece, every page with it, the teacher's included; the student can
   send again. Grades and comments stay. Photos of it still in the photo
   queue are deleted from the device. Answers { result: 'deleted', pages }
   (pages: how many went), { result: 'nothing_sent' }, { result:
   'not_found' }, or signed in { result: 'not_available' } (the server's
   delete is in Batch B, not applied). */
function deleteStudentWork(cid, sid, aid) {
  if (_workOnServer(cid)) return _serverDeleteWork(cid, sid, aid);
  if (!cid || !_isDemoSession()) return Promise.resolve({ result: 'not_available' });
  return _teacherWorkQueued(cid, function () {
    if (!_teacherWorkInClass(cid, sid, aid)) return { result: 'not_found' };
    var draft = _studentWorkDraft(cid);
    var sent = _teacherWorkSent(draft, sid, aid);
    if (!sent) return { result: 'nothing_sent' };
    draft.submissions = draft.submissions.filter(function (s) {
      return s !== sent;
    });
    _studentWorkWrite(cid, draft);
    return _teacherWorkForget(_queuePagesOf(sent)).then(function () {
      return { result: 'deleted', pages: (sent.files || []).length };
    });
  });
}

/* An address an <img> can show for one page ('page') or its thumbnail
   ('thumb'), whether it is a shipped sample file or a photo still in the
   photo queue: a Promise of { url, release } or null. Call release() when
   the picture leaves the screen (a queued photo's address holds its bytes
   in memory until then); calling it twice is harmless. A caller whose
   screen changed before the answer came should release it unused. */
function openStudentWorkPage(cid, file, which) {
  var name = file && (which === 'thumb' ? file.thumb_path : file.path);
  if (!name || typeof name !== 'string' || !_studentWorkStored(cid)) return Promise.resolve(null);
  var m = _STUDENT_WORK_QUEUE_PATH.exec(name);
  if (!m && _workOnServer(cid)) return _openServerWorkPage(cid, name);
  if (!m) {
    return studentWorkPageUrl(cid, file, which).then(function (url) {
      return url ? { url: url, release: function () {} } : null;
    });
  }
  if ((which === 'thumb') !== !!m[2]) return Promise.resolve(null);
  var q = window.PhotoQueue;
  if (!q || typeof q.blobs !== 'function' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return Promise.resolve(null);
  }
  return Promise.resolve()
    .then(function () {
      return q.blobs(m[1]);
    })
    .then(
      function (found) {
        var blob = found && (m[2] ? found.thumb : found.photo);
        if (!blob) return null;
        var url = URL.createObjectURL(blob);
        var released = false;
        return {
          url: url,
          release: function () {
            if (released) return;
            released = true;
            URL.revokeObjectURL(url);
          },
        };
      },
      function () {
        return null;
      },
    );
}

/* ══════════════════════════════════════════════════════════════════
   Student work for a signed-in teacher (S5-W1, S6-W1)
   ══════════════════════════════════════════════════════════════════
   The same readers and writers as above, answered from the server
   (Batch B: migrations/2026111101_student_work_submissions.sql and
   2026111102_student_work_storage.sql; the shapes are in
   migrations/local-test/batch-b-contract.md). Only for a class the server
   keeps student-page rows for (_serverKeepsRows: signed in, a server id,
   the build switch on as the server says): any other class is answered
   exactly as before, and sent nothing new.

   What is read: list_course_submissions, when the class loads with Send
   Work on (or its Send Work is not known yet this session), when the
   grader or the Assignments page opens (refreshStudentWork, at most every
   30 seconds unless asked), and after this device's own writes land.
   Send Work and Keep Photos Until also come on the course row with the
   class. Kept in memory only (_workServer).

   What is shown is that answer with this device's writes not yet answered
   laid over it (_workServerView), so a change shows at once and a reload
   keeps it: the outbox's queued set_course_send_work,
   set_assessment_student_work, delete_submission and mark_handed_in_paper,
   and the teacher's uploads still on their way (gb-work-uploads).

   Add Work (start_work_upload, then finish_work_upload): the pages go into
   the photo queue (shared/photo-queue.js, IndexedDB) under local ids, and
   start_work_upload goes through the outbox. When it answers, the queue's
   records take the server's submission and file ids and the pages upload
   to the paths the server named, with the teacher's own sign-in; once
   every page and thumbnail is up the queue's commit hands them in with
   finish_work_upload under the batch's key. Offline the pages wait in the
   queue and the start in the outbox; both go when the device is back.
   Until then the work shows from the queue ("photo-queue:<id>" paths).

   Pages are shown through a signed link (300 seconds) that is fetched
   and shown from a blob: address, never put in an <img> as is (the
   Content Security Policy allows blob: and not the storage host).

   After a write that can queue files for deletion (delete_submission,
   start_work_upload, finish_work_upload) the edge function's sweep route
   runs the removal worker, as the contract asks. Best effort: if it does
   not answer, the files wait in the removal queue, unreadable.

   Sync problems show on the sync dot only (getSyncDotState): a refused
   write through the outbox's own dead letters, a page that will not send
   through the photo queue's failed count. Mark Up, reflections, revisions
   and group work stay Demo Mode's (Phase 2 and 3). */
var STUDENT_WORK_LINK_SECONDS = 300;
var _WORK_REFRESH_MS = 30000; // refreshStudentWork's wait between reads, unless forced
var _WORK_START_WAIT_MS = 8000; // how long Add Work waits for start_work_upload's answer before it answers itself
var _WORK_UPLOADS_KEY = 'gb-work-uploads'; // the teacher's uploads on their way, by start key
var _WORK_DROPPED_KEY = 'gb-work-dropped'; // { at }: photos refused after the screen said sent
var _WORK_DROPPED_MS = 24 * 60 * 60 * 1000; // how long the sync dot says so, unless clicked
var _workAwaited = {}; // start key → true while Add Work's screen still waits for the answer
var _workServer = {}; // cid → list_course_submissions' answer, as last read
var _workCourseRow = {}; // cid → { send_work, keep_photos_until }, as the server last said
var _workCourseHere = {}; // cid → a change of the two on its way: { patch, at }
var _workAssessHere = {}; // aid → a change of an assessment's settings on its way
var _workRead = {}; // cid → { running, at, writes }
var _workWrites = {}; // cid → how many of this device's work writes have landed
var _workViewMemo = {}; // cid → this turn's view (cleared at the end of the turn)
var _workViewClearing = false;
var _workQueueWired = false;
var _workSweepTimer = null;

/* A signed-in class's work is the server's, student page on or off: the
   server takes a teacher's Add Work whatever the switches say. */
function _workOnServer(cid) {
  return !!cid && !_isDemoSession() && _useSupabase && _writesEnabled() && _isUuid(cid);
}
/* True when class `cid`'s student-page rows are the server's (a signed-in
   class with the build switch on). The screens ask it beside Demo Mode. */
function studentWorkLive(cid) {
  return _workRowsOnServer(cid);
}
function _workRowsOnServer(cid) {
  return !!cid && !_isDemoSession() && _serverKeepsRows(cid);
}

function _workChanged(cid) {
  delete _workViewMemo[cid];
}

function _workUploads() {
  var all = _safeParseLS(_WORK_UPLOADS_KEY, null);
  return _plainObject(all) ? all : {};
}
function _workUploadsSave(all) {
  if (!Object.keys(all).length) {
    try {
      localStorage.removeItem(_WORK_UPLOADS_KEY);
    } catch (e) {
      /* nothing kept */
    }
  } else _safeLSSet(_WORK_UPLOADS_KEY, JSON.stringify(all));
  Object.keys(_workViewMemo).forEach(_workChanged);
}
function _workUploadPut(rec) {
  var all = _workUploads();
  all[rec.key] = rec;
  _workUploadsSave(all);
}
function _workUploadDrop(key) {
  var all = _workUploads();
  if (!all[key]) return null;
  var rec = all[key];
  delete all[key];
  _workUploadsSave(all);
  return rec;
}
function _workUploadByBatch(batch) {
  var all = _workUploads();
  var key = Object.keys(all).find(function (k) {
    return all[k] && all[k].batch === batch;
  });
  return key ? all[key] : null;
}

// The class's queued writes to `endpoint`, oldest first (this teacher's).
function _workQueued(endpoint, match) {
  var q = window.v2Queue;
  var entries = [];
  try {
    entries = q && typeof q.queued === 'function' ? q.queued(endpoint) || [] : _queuedCardWrites(endpoint);
  } catch (e) {
    entries = [];
  }
  return entries.filter(function (e) {
    return e && e.payload && match(e.payload);
  });
}

function _workAssessmentOfClass(cid, aid) {
  return (getAssessments(cid) || []).some(function (a) {
    return a && a.id === aid;
  });
}

/* What the screens read for a signed-in class: the shape
   saveDemoStudentWork keeps ({ course, assessments, submissions }), from
   the server's last answer with this device's unanswered writes laid over
   it. Worked out once a turn. */
function _workServerView(cid) {
  if (_workViewMemo[cid]) return _workViewMemo[cid];
  var srv = _workServer[cid] || null;
  var course = Object.assign({ send_work: false, keep_photos_until: 'end_of_year' }, _workCourseRow[cid] || {});
  _workQueued('set_course_send_work', function (p) {
    return p.p_course_id === cid;
  }).forEach(function (e) {
    if (_plainObject(e.payload.p_patch)) Object.assign(course, e.payload.p_patch);
  });
  if (_workCourseHere[cid]) Object.assign(course, _workCourseHere[cid].patch);

  var byId = {};
  ((srv && srv.assessments) || []).forEach(function (a) {
    if (a && a.id) byId[a.id] = _studentWorkCopy(a);
  });
  _workQueued('set_assessment_student_work', function (p) {
    return _workAssessmentOfClass(cid, p.p_assessment_id);
  }).forEach(function (e) {
    var aid = e.payload.p_assessment_id;
    byId[aid] = Object.assign(byId[aid] || { id: aid }, e.payload.p_patch || {});
  });
  Object.keys(_workAssessHere).forEach(function (aid) {
    if (_workAssessmentOfClass(cid, aid)) byId[aid] = Object.assign(byId[aid] || { id: aid }, _workAssessHere[aid]);
  });

  var subs = _studentWorkCopy((srv && srv.submissions) || []);
  // Deleted here, not answered yet.
  var deleted = {};
  _workQueued('delete_submission', function () {
    return true;
  }).forEach(function (e) {
    deleted[e.payload.p_submission_id] = true;
  });
  subs = subs.filter(function (s) {
    return s && !deleted[s.id];
  });
  var sentFor = function (sid, aid) {
    return subs.find(function (s) {
      return s.state === 'sent' && s.enrollment_id === sid && s.assessment_id === aid;
    });
  };
  var stamp = function (at) {
    return at || new Date().toISOString();
  };
  // Handed In on Paper, not answered yet.
  _workQueued('mark_handed_in_paper', function (p) {
    return _workAssessmentOfClass(cid, p.p_assessment_id);
  }).forEach(function (e) {
    var aid = e.payload.p_assessment_id;
    (e.payload.p_enrollment_ids || []).forEach(function (sid) {
      if (sentFor(sid, aid)) return;
      subs.push({
        id: 'paper:' + e.id + ':' + sid,
        assessment_id: aid,
        enrollment_id: sid,
        version: 1,
        state: 'sent',
        sent_by: 'teacher',
        on_paper: true,
        is_late: false,
        note: null,
        followed_plan: null,
        created_at: stamp(e.created_at),
        sent_at: stamp(e.created_at),
        files: [],
      });
    });
  });
  // The teacher's uploads on their way: shown from the photo queue.
  var uploads = _workUploads();
  Object.keys(uploads)
    .map(function (k) {
      return uploads[k];
    })
    .filter(function (u) {
      return u && u.cid === cid;
    })
    .sort(function (x, y) {
      return String(x.at).localeCompare(String(y.at));
    })
    .forEach(function (u) {
      var now = sentFor(u.sid, u.aid);
      var files = function (first) {
        return (u.ids || []).map(function (qid, i) {
          var p = (u.pages || [])[i] || {};
          return {
            id: qid,
            page: first + i,
            path: 'photo-queue:' + qid,
            thumb_path: 'photo-queue:' + qid + ':thumb',
            bytes: p.bytes || null,
            thumb_bytes: p.thumb_bytes || null,
            width: p.width || null,
            height: p.height || null,
            rotation: 0,
            sha256: p.hash || null,
            added_by: 'teacher',
          };
        });
      };
      if (u.mode === 'add') {
        if (!now) return;
        var last = (now.files || []).reduce(function (n, f) {
          return Math.max(n, (f && f.page) || 0);
        }, 0);
        now.files = (now.files || []).concat(files(last + 1));
        return;
      }
      if (u.mode === 'new' && now) return; // the student's (or another device's) came first
      if (now)
        subs = subs.filter(function (s) {
          return s !== now;
        });
      subs.push({
        id: (u.server && u.server.submission_id) || u.sub,
        assessment_id: u.aid,
        enrollment_id: u.sid,
        version: (now && now.version) || 1,
        state: 'sent',
        sent_by: 'teacher',
        on_paper: false,
        is_late: false,
        note: null,
        followed_plan: null,
        created_at: u.at,
        sent_at: u.at,
        files: files(1),
      });
    });

  var view = {
    course: course,
    assessments: Object.keys(byId).map(function (k) {
      return byId[k];
    }),
    submissions: subs,
  };
  _workViewMemo[cid] = view;
  if (!_workViewClearing) {
    _workViewClearing = true;
    Promise.resolve().then(function () {
      _workViewClearing = false;
      _workViewMemo = {};
    });
  }
  return view;
}

/* ── Reading ── */

// The course row's two settings, when the class loads (_applyBundleCourseConfig).
function _noteCourseSendWork(cid, courseRow) {
  if (!cid || !_plainObject(courseRow) || !('send_work' in courseRow)) return;
  _workCourseRow[cid] = {
    send_work: courseRow.send_work === true,
    keep_photos_until: courseRow.keep_photos_until === 'end_of_term' ? 'end_of_term' : 'end_of_year',
  };
  _workChanged(cid);
}

/* Whether the class's work is worth reading. With Send Work off there is
   nothing to draw and nothing is read (S6-W1 review, should-fix 4).
   Read anyway when Send Work is not known yet (the read tells; only with
   the student page on, so a class with it off and Send Work off is sent
   nothing new), while a change to it is on its way (the view already says
   on), or when the last answer held work (a class just turned off stays
   current). */
function _workReadWanted(cid) {
  if (!_workCourseRow[cid]) return _workRowsOnServer(cid);
  if (_workServerView(cid).course.send_work === true) return true;
  var srv = _workServer[cid];
  return !!(srv && Array.isArray(srv.submissions) && srv.submissions.length);
}

function _workLook(cid) {
  return JSON.stringify(_workServerView(cid));
}

/* Read the class's work from the server, unless it was read in the last
   30 seconds (opts.force reads it anyway; a read under way is joined). A
   Promise of { changed } or { error }; never rejects. A screen that
   changes is redrawn. Nothing for any class but a live one, and nothing
   while its Send Work is off (_workReadWanted) unless opts.anyway. */
function refreshStudentWork(cid, opts) {
  // The class's marks and reflections are read with its work (S9-W1, S10-W1); not waited for.
  refreshCourseFeedback(cid, opts);
  if (!_workOnServer(cid)) return Promise.resolve({ changed: false });
  if (!(opts && opts.anyway) && !_workReadWanted(cid)) return Promise.resolve({ changed: false });
  var st = _workRead[cid] || (_workRead[cid] = {});
  if (st.running) {
    if (opts && opts.force) st.again = true;
    return st.running;
  }
  if (!(opts && opts.force) && st.at && Date.now() - st.at < _WORK_REFRESH_MS) {
    return Promise.resolve({ changed: false });
  }
  st.running = (async function () {
    var out = { changed: false };
    try {
      do {
        st.again = false;
        out = await _fetchStudentWork(cid);
      } while (st.again || out.skipped);
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

async function _fetchStudentWork(cid) {
  var writes = _workWrites[cid] || 0;
  var res;
  try {
    res = await _callRpcWithAuthGuard(
      'list_course_submissions',
      { p_course_id: cid },
      { suppressSessionExpiredModal: true },
    );
  } catch (e) {
    res = { error: e };
  }
  var data = res && !res.error ? _rpcObject(res.data) : null;
  if (!data || !Array.isArray(data.submissions)) {
    // A read that failed changes nothing: the next one tries again.
    if (res && res.error && !res.error.handledSessionExpired)
      console.warn('list_course_submissions failed:', res.error);
    return { error: (res && res.error) || { message: 'no answer' } };
  }
  if (!_workOnServer(cid)) return { changed: false };
  // One of this device's writes landed while the read was out: it is from before that write.
  if ((_workWrites[cid] || 0) !== writes) return { skipped: true };
  var was = _workLook(cid);
  _workServer[cid] = data;
  if (_plainObject(data.course)) _noteCourseSendWork(cid, Object.assign({ send_work: false }, data.course));
  (_workRead[cid] || (_workRead[cid] = {})).at = Date.now();
  _workChanged(cid);
  return { changed: was !== _workLook(cid) };
}

/* Before a delete warning says whether photos go too (S8-F1): the
   class's work, read from the server once this session if it has not
   been (with Send Work off nothing else reads it, and photos sent before
   it was turned off are still deleted). null when nothing needs reading
   (Demo Mode, a class whose work is not the server's, or read already):
   the readers answer now. Else a Promise of { known: true } once the
   readers (getCourseSubmissions, CmStudentPage.studentsWithPhotos) answer
   for the server, or { known: false } when the read failed: the warning
   then says photos go rather than miss them. Never rejects. */
function readStudentWorkForDelete(cid) {
  if (!_workOnServer(cid) || (!_workRowsOnServer(cid) && !_workReadWanted(cid))) return null;
  var st = _workRead[cid];
  if (st && st.at && !st.running) return null;
  return refreshStudentWork(cid, { force: true, anyway: true }).then(
    function (out) {
      return { known: !(out && out.error) && !!(_workRead[cid] && _workRead[cid].at) };
    },
    function () {
      return { known: false };
    },
  );
}

/* The class has just loaded from the server with its student page on
   (_loadServerGradeReturns): its work too, when Send Work is on or not
   known yet. Never waited for, never a failed load. */
function _loadServerStudentWork(cid, fresh) {
  if (!_workOnServer(cid)) return;
  var known = _workCourseRow[cid];
  var readBefore = !!(_workRead[cid] && _workRead[cid].at);
  if (known ? known.send_work !== true : readBefore || fresh) return;
  refreshStudentWork(cid, { force: true });
}

// A write of this device's landed: reads begun before it are dropped, and the class read again soon.
function _workWriteLanded(cid) {
  _workWrites[cid] = (_workWrites[cid] || 0) + 1;
  _workChanged(cid);
  setTimeout(function () {
    refreshStudentWork(cid, { force: true });
  }, 0);
}

/* ── The two class settings and an assessment's ── */

/* Send Work and Keep Photos Until: `patch` names what changes, any of
   { send_work: boolean, keep_photos_until: 'end_of_year' | 'end_of_term' }.
   Answers { ok } at once. Demo Mode keeps it with its sample work; a live
   class sends set_course_send_work through the outbox. */
function setCourseSendWork(cid, patch) {
  var clean = {};
  if (patch && (patch.send_work === true || patch.send_work === false)) clean.send_work = patch.send_work;
  if (patch && (patch.keep_photos_until === 'end_of_year' || patch.keep_photos_until === 'end_of_term')) {
    clean.keep_photos_until = patch.keep_photos_until;
  }
  if (!cid || !Object.keys(clean).length) return { ok: false };
  if (_isDemoSession()) {
    var work = getCourseSubmissions(cid);
    work.course = Object.assign({}, work.course, clean);
    return { ok: saveDemoStudentWork(cid, work) };
  }
  if (!_workRowsOnServer(cid)) return { ok: false };
  var mine = { patch: Object.assign({}, (_workCourseHere[cid] || {}).patch, clean) };
  _workCourseHere[cid] = mine;
  _workChanged(cid);
  _trackPendingSync(
    Promise.resolve(
      _writeRpc('set_course_send_work', { p_course_id: cid, p_patch: clean, p_idempotency_key: _newEntryId() }),
    ).then(function (res) {
      var still = _workCourseHere[cid] === mine;
      if (still) delete _workCourseHere[cid];
      var data = res && !res.error ? _rpcObject(res.data) : null;
      if (data && still) _noteCourseSendWork(cid, data);
      if (res && res.error && !res.error.handledSessionExpired) console.warn('set_course_send_work failed:', res.error);
      _workWriteLanded(cid);
    }),
  );
  return { ok: true };
}

/* An assessment's Student Work card, as the form saves it: only what
   differs from what the class holds is sent (set_assessment_student_work).
   `w` is { students_send, after_due, accept_until, group_work,
   students_see_markup }. Answers { ok } at once. */
function saveAssessmentStudentWork(cid, aid, w) {
  if (!cid || !aid || !_plainObject(w)) return { ok: false };
  var now = getAssessmentStudentWork(cid, aid);
  var row = {
    students_send: w.students_send,
    after_due: w.after_due,
    accept_until: w.after_due === 'until' ? w.accept_until || null : null,
    group_work: w.group_work,
    students_see_markup: w.students_see_markup !== false,
  };
  if (_isDemoSession()) {
    var work = getCourseSubmissions(cid);
    work.assessments = (work.assessments || [])
      .filter(function (x) {
        return x && x.id !== aid;
      })
      .concat([Object.assign({ id: aid }, row)]);
    return { ok: saveDemoStudentWork(cid, work) };
  }
  if (!_workRowsOnServer(cid)) return { ok: false };
  var patch = {};
  Object.keys(row).forEach(function (k) {
    if (row[k] !== now[k]) patch[k] = row[k];
  });
  // The server keeps a date only with Until, and needs one with it.
  if ('after_due' in patch && row.after_due === 'until') patch.accept_until = row.accept_until;
  if ('accept_until' in patch && row.after_due !== 'until') delete patch.accept_until;
  if (row.after_due === 'until' && !row.accept_until) return { ok: false };
  if (!Object.keys(patch).length) return { ok: true };
  var mine = Object.assign({}, patch);
  _workAssessHere[aid] = Object.assign({}, _workAssessHere[aid], mine);
  var held = _workAssessHere[aid];
  _workChanged(cid);
  _trackPendingSync(
    Promise.resolve(
      _writeRpc('set_assessment_student_work', {
        p_assessment_id: aid,
        p_patch: patch,
        p_idempotency_key: _newEntryId(),
      }),
    ).then(function (res) {
      var data = res && !res.error ? _rpcObject(res.data) : null;
      var id = (data && data.id) || aid;
      if (_workAssessHere[aid] === held) delete _workAssessHere[aid];
      if (data && _workServer[cid]) {
        var list = (_workServer[cid].assessments || []).filter(function (a) {
          return a && a.id !== id;
        });
        list.push(data);
        _workServer[cid].assessments = list;
      }
      if (res && res.error && !res.error.handledSessionExpired) {
        console.warn('set_assessment_student_work failed:', res.error);
      }
      _workWriteLanded(cid);
    }),
  );
  return { ok: true };
}

/* ── Showing a page ── */

var _WORK_STORAGE_PATH =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}){4}(-thumb)?\.jpg$/;

/* One page or thumbnail of a live class, from storage: a link signed for
   300 seconds, fetched, and shown from a blob: address. { url, release }
   or null. Only a path in this class's own folder. */
function _openServerWorkPage(cid, name) {
  if (!_WORK_STORAGE_PATH.test(name) || name.indexOf(String(cid).toLowerCase() + '/') !== 0) {
    return Promise.resolve(null);
  }
  var sb = getSupabase();
  if (!sb || !sb.storage || typeof fetch !== 'function' || typeof URL.createObjectURL !== 'function') {
    return Promise.resolve(null);
  }
  var bucket = (_workServer[cid] && _workServer[cid].bucket) || 'student-photos';
  return Promise.resolve()
    .then(function () {
      return sb.storage.from(bucket).createSignedUrl(name, STUDENT_WORK_LINK_SECONDS);
    })
    .then(function (res) {
      var link = res && !res.error && res.data && res.data.signedUrl;
      if (!link) return null;
      return fetch(link, { credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' }).then(function (r) {
        return r && r.ok ? r.blob() : null;
      });
    })
    .then(function (blob) {
      if (!blob) return null;
      // Always a picture: what storage hands back is shown in an <img> and nothing else.
      var url = URL.createObjectURL(new Blob([blob], { type: 'image/jpeg' }));
      var released = false;
      return {
        url: url,
        release: function () {
          if (released) return;
          released = true;
          URL.revokeObjectURL(url);
        },
      };
    })
    .then(null, function () {
      return null;
    });
}

/* ── Add Work ── */

// The photo queue, told how a signed-in teacher's pages go up and are handed in.
function _wireWorkQueue() {
  var q = window.PhotoQueue;
  if (!q || typeof q.configure !== 'function' || _isDemoSession() || !_writesEnabled()) return null;
  if (!_workQueueWired) {
    _workQueueWired = true;
    q.configure({
      upload: _workUploadFile,
      commit: _workCommit,
      owner: function () {
        return _teacherId || null;
      },
    });
    if (typeof q.subscribe === 'function') q.subscribe(_updateSyncIndicator);
  }
  return q;
}

function _workUploadFile(path, blob) {
  var sb = getSupabase();
  if (!sb || !sb.storage) return Promise.resolve({ error: { message: 'offline: no client', status: 503 } });
  return Promise.resolve(
    sb.storage.from('student-photos').upload(path, blob, { contentType: 'image/jpeg', upsert: false }),
  ).then(function (res) {
    return { error: (res && res.error) || null };
  });
}

function _workPagesJson(rec) {
  return (rec.pages || []).map(function (p) {
    var out = {};
    ['width', 'height', 'bytes', 'thumb_bytes'].forEach(function (k) {
      var n = Number(p[k]);
      if (isFinite(n) && n >= 1 && Math.floor(n) === n) out[k] = n;
    });
    return out;
  });
}

function _workStart(rec) {
  return _writeRpc('start_work_upload', {
    p_assessment_id: rec.aid,
    p_enrollment_id: rec.sid,
    p_pages: _workPagesJson(rec),
    p_mode: rec.mode,
    p_idempotency_key: rec.key,
  });
}

// Give up an upload: its photos leave the device and the screens forget it.
function _workUploadAbandon(key) {
  var rec = _workUploadDrop(key);
  if (!rec) return Promise.resolve(null);
  return _teacherWorkForget(rec.ids || []).then(function () {
    return rec;
  });
}

/* start_work_upload answered (from the call itself, or from the outbox's
   own event after a reload). `ready`: the waiting pages take the server's
   ids and go up. Anything else, while Add Work's screen still waits for
   the answer: the photos are dropped, the class read again, and the
   screen says why. Once the screen has said sent (the wait ran out, or
   the page was reloaded) the photos are not dropped without a word: see
   _workRefusedAfterSent. Returns the answer as the screens take it. Runs
   once per answer; a second call for the same start does nothing. */
function _workUploadStarted(key, data) {
  var all = _workUploads();
  var rec = all[key];
  var res = _rpcObject(data);
  var told = !_workAwaited[key];
  if (!rec) return Promise.resolve(res || { result: 'store_failed' });
  if (rec.server && rec.restartKey !== key) return Promise.resolve({ result: 'sent' });
  if (!res || res.result !== 'ready') {
    if (told && _workRefusedAfterSent(rec, res)) return Promise.resolve({ result: 'sent', queued: true });
    return _workUploadAbandon(key).then(function () {
      if (told) _workNoteDropped();
      _workWriteLanded(rec.cid);
      _sweepWorkRemovals();
      if (res && res.result === 'already_sent') {
        if (res.submission && _workServer[rec.cid]) _workServerTake(rec.cid, res.submission);
        return { result: 'already_sent', submission: getStudentSubmission(rec.cid, rec.sid, rec.aid) };
      }
      return res && res.result ? res : { result: 'store_failed' };
    });
  }
  var files = (res.files || []).slice().sort(function (x, y) {
    return (x.page || 0) - (y.page || 0);
  });
  var q = _wireWorkQueue();
  if (!q || files.length !== (rec.ids || []).length) {
    return _workUploadAbandon(key).then(function () {
      if (told) _workNoteDropped();
      return { result: 'store_failed' };
    });
  }
  return Promise.resolve(q.ready && q.ready())
    .then(function () {
      var pages = typeof q.pages === 'function' ? q.pages() : [];
      var map = {};
      var bad = false;
      rec.ids.forEach(function (qid, i) {
        var meta = pages.find(function (p) {
          return p.id === qid;
        });
        if (!meta) return (bad = true);
        var ids = Object.assign({}, meta.ids, { submission: res.submission_id, file: files[i].file_id });
        // Where the queue will put it is where the server said, or nothing goes.
        try {
          if (q.pathFor(ids) !== String(files[i].path).toLowerCase()) bad = true;
        } catch (e) {
          bad = true;
        }
        map[meta.ids.submission] = res.submission_id;
        map[meta.ids.file] = files[i].file_id;
      });
      if (bad) return { bad: true };
      return Promise.resolve(q.rekey(map)).then(function (out) {
        return out && out.ok ? { ok: true } : { bad: true };
      });
    })
    .then(function (done) {
      if (done.bad) {
        return _workUploadAbandon(key).then(function () {
          if (told) _workNoteDropped();
          return { result: 'store_failed' };
        });
      }
      var now = _workUploads();
      var held = now[rec.key];
      if (held) {
        held.server = { submission_id: res.submission_id, files: files, finish_by: res.finish_by || null };
        delete held.restartKey;
        delete held.restarting;
        delete held.held;
        _workUploadsSave(now);
      }
      // A restart sends every page again, to its new path.
      var again = rec.restartKey === key;
      return Promise.all(
        again
          ? rec.ids.map(function (qid) {
              return Promise.resolve(q.retry(qid, { again: true })).then(null, function () {});
            })
          : [],
      ).then(function () {
        _sweepWorkRemovals(); // an earlier upload for the piece was dropped
        q.send();
        return { result: 'sent', submission: getStudentSubmission(rec.cid, rec.sid, rec.aid) };
      });
    });
}

/* A start refused after Add Work's screen had already said sent (offline,
   or past the 8-second wait), so no screen is there to say why. True when
   the photos are kept:
   - nothing_sent: the work they were to add to or replace went, so they
     are started again as new work;
   - class_full, or no answer at all: held on the device, shown on the sync
     dot, and tried again when a page opens or the sync dot is clicked
     (retryHeldStudentWork).
   False for the rest (already_sent, on_paper, too_many_pages: they cannot
   go in as asked); the caller lets them go and the sync dot says so. */
function _workRefusedAfterSent(rec, res) {
  var result = res && res.result;
  if (result && result !== 'nothing_sent' && result !== 'class_full') return false;
  var all = _workUploads();
  var held = all[rec.key];
  if (!held) return false;
  delete held.restarting; // this answer may be a restart's own
  if (result === 'nothing_sent') {
    _workUploadsSave(all);
    _workRestart(held, 'new');
    return true;
  }
  held.held = result || 'no_answer';
  _workUploadsSave(all);
  _workWriteLanded(rec.cid);
  _updateSyncIndicator();
  return true;
}

// Photos let go after the screen said sent: the sync dot says so for a day, or until it is clicked.
function _workNoteDropped() {
  _safeLSSet(_WORK_DROPPED_KEY, JSON.stringify({ at: new Date().toISOString() }));
  _updateSyncIndicator();
}

/* The sync dot was clicked, or a page opened: held uploads are started
   again, and the note of photos let go is cleared. */
function retryHeldStudentWork() {
  try {
    localStorage.removeItem(_WORK_DROPPED_KEY);
  } catch (e) {
    /* nothing kept */
  }
  if (_isDemoSession() || !_writesEnabled()) return _updateSyncIndicator();
  var all = _workUploads();
  Object.keys(all).forEach(function (k) {
    if (all[k] && all[k].held) _workRestart(all[k]);
  });
  _updateSyncIndicator();
}

// A submission as the server now has it, in place of the class's copy of it.
function _workServerTake(cid, sub) {
  var srv = _workServer[cid];
  if (!srv || !_plainObject(sub) || !sub.id) return;
  srv.submissions = (srv.submissions || []).filter(function (s) {
    return (
      s &&
      s.id !== sub.id &&
      !(s.enrollment_id === sub.enrollment_id && s.assessment_id === sub.assessment_id && s.state === 'sent')
    );
  });
  if (sub.state === 'sent') srv.submissions.push(_studentWorkCopy(sub));
  _workChanged(cid);
}

/* The photo queue's commit: every page and thumbnail of one upload is in
   storage; finish_work_upload hands them in, in order, under the batch's
   key. Answers { error } as the queue reads it: none once handed in (or
   dropped because the student's came first), a passing one while pages are
   still missing or the upload is being started again, and a lasting one
   for what storage holds that it should not. */
async function _workCommit(batch) {
  // A handout's pages (Handouts and Links) are handed in their own way.
  if (batch && batch.kind === 'handout') return _handoutCommit(batch);
  var rec = _workUploadByBatch(batch.key);
  var files = (batch.files || [])
    .slice()
    .sort(function (x, y) {
      return (x.order || 0) - (y.order || 0);
    })
    .map(function (f) {
      return { file_id: f.id, sha256: f.hash };
    });
  if (
    !files.every(function (f) {
      return _isUuid(f.file_id) && /^[0-9a-f]{64}$/.test(String(f.sha256 || ''));
    })
  ) {
    return { error: { message: 'a page has no fingerprint', status: 422 } };
  }
  if (rec && rec.restarting) return { error: { message: 'starting again', status: 503 } };
  var res = await _callRpcWithAuthGuard(
    'finish_work_upload',
    { p_submission_id: batch.ids.submission, p_files: files, p_idempotency_key: batch.key },
    { suppressSessionExpiredModal: true },
  );
  if (!res || res.error) return { error: (res && res.error) || { message: 'no answer', status: 503 } };
  var data = _rpcObject(res.data) || {};
  var cid = (rec && rec.cid) || batch.ids.course;
  if (data.result === 'sent' || data.result === 'already_sent') {
    if (data.result === 'sent' && data.submission) _workServerTake(cid, data.submission);
    if (rec) _workUploadDrop(rec.key);
    _workWriteLanded(cid);
    _sweepWorkRemovals(); // Replace Them queues the old photos; already_sent drops this upload's
    _invalidateAndRerender();
    return { error: null };
  }
  if (data.result === 'missing_pages') {
    var q = window.PhotoQueue;
    var pages = q && typeof q.pages === 'function' ? q.pages() : [];
    await Promise.all(
      (data.missing || []).map(function (fileId) {
        var meta = pages.find(function (p) {
          return p.ids && p.ids.file === fileId;
        });
        return meta ? Promise.resolve(q.retry(meta.id, { again: true })).then(null, function () {}) : null;
      }),
    );
    return { error: { message: 'missing_pages', status: 503 } };
  }
  if (data.result === 'gone' && rec) {
    // Dropped (two hours passed, or the work it was for went): it is started again.
    _workRestart(rec);
    return { error: { message: 'starting again', status: 503 } };
  }
  return { error: { message: String(data.result || 'refused'), status: 409 } };
}

/* An upload the server no longer holds is started again with a new key:
   as the same choice when the work it was for is still in, else as new
   (or as `mode`, when the caller knows). Its pages go up again to the new
   paths (_workUploadStarted). */
function _workRestart(rec, mode) {
  var all = _workUploads();
  var held = all[rec.key];
  if (!held || held.restarting) return;
  var newKey = _newEntryId();
  held.restarting = true;
  delete held.server;
  delete held.held;
  if (mode) held.mode = mode;
  else if (held.mode !== 'new' && !getStudentSubmission(held.cid, held.sid, held.aid)) held.mode = 'new';
  if (held.mode === 'new') held.target = null;
  // Kept under its new key, so the outbox's answer finds it.
  delete all[rec.key];
  held.key = newKey;
  held.restartKey = newKey;
  all[newKey] = held;
  _workUploadsSave(all);
  Promise.resolve(_workStart(held)).then(function (res) {
    if (res && res.error) {
      if (!res.error.handledSessionExpired) console.warn('start_work_upload (again) failed:', res.error);
      return;
    }
    _workUploadStarted(newKey, res && res.data);
  });
}

/* Add Work, Add as More Pages and Replace Them for a live class: the
   answers _teacherWork gives in Demo Mode, from what the class holds.
   Waits up to _WORK_START_WAIT_MS for the server's start; past that (or
   offline) it answers 'sent' and the work shows from the queue until it
   is in. */
function _serverTeacherWork(cid, sid, aid, pages, mode) {
  if (!_teacherWorkPagesOk(pages)) return Promise.resolve({ result: 'invalid' });
  return _teacherWorkQueued(cid, function () {
    if (!_teacherWorkInClass(cid, sid, aid)) return { result: 'not_found' };
    var sent = getStudentSubmission(cid, sid, aid);
    if (mode === 'new' && sent) return { result: 'already_sent', submission: sent };
    if (mode !== 'new' && !sent) return { result: 'nothing_sent' };
    if (mode === 'add' && sent.on_paper) return { result: 'on_paper', submission: sent };
    var have = mode === 'add' ? (sent.files || []).length : 0;
    if (have + pages.length > STUDENT_WORK_MAX_PAGES) {
      return { result: 'too_many_pages', room: STUDENT_WORK_MAX_PAGES - have };
    }
    // Work that is itself still on its way can be added to once it is in.
    if (mode !== 'new' && !_isUuid(sent.id)) return { result: 'uploading' };
    var q = _wireWorkQueue();
    if (!q) return { result: 'no_photo_store' };
    var sub = _teacherWorkId();
    return _teacherWorkQueuePages(cid, sid, aid, sub, pages).then(function (kept) {
      if (!kept.ok) return kept.answer;
      var rec = {
        key: _newEntryId(),
        cid: cid,
        aid: aid,
        sid: sid,
        mode: mode,
        sub: sub,
        target: mode === 'new' ? null : sent.id,
        batch: kept.batch,
        ids: kept.ids,
        pages: pages.map(function (p) {
          return {
            hash: p.hash || null,
            bytes: p.blob.size,
            thumb_bytes: p.thumb.size,
            width: p.width || null,
            height: p.height || null,
          };
        }),
        at: new Date().toISOString(),
        server: null,
      };
      _workUploadPut(rec);
      // Until the wait runs out, a refusal is this screen's to say (_workUploadStarted).
      _workAwaited[rec.key] = true;
      var started = Promise.resolve(_workStart(rec)).then(function (res) {
        if (res && res.error) {
          if (!res.error.handledSessionExpired) console.warn('start_work_upload failed:', res.error);
          // Refused (the outbox's dead letter says so on the sync dot): the photos go.
          return _workUploadAbandon(rec.key).then(function () {
            return { result: 'store_failed' };
          });
        }
        return _workUploadStarted(rec.key, res && res.data);
      });
      started.then(function () {
        delete _workAwaited[rec.key];
      });
      _trackPendingSync(started);
      var waited = new Promise(function (resolve) {
        setTimeout(function () {
          delete _workAwaited[rec.key];
          resolve({ result: 'sent', queued: true });
        }, _WORK_START_WAIT_MS);
      });
      return Promise.race([started, waited]);
    });
  });
}

/* Delete Work for a live class: delete_submission for work that is in;
   an upload of this device's still on its way is given up as well. */
function _serverDeleteWork(cid, sid, aid) {
  return _teacherWorkQueued(cid, function () {
    if (!_teacherWorkInClass(cid, sid, aid)) return { result: 'not_found' };
    var sent = getStudentSubmission(cid, sid, aid);
    if (!sent) return { result: 'nothing_sent' };
    var pages = (sent.files || []).length;
    var uploads = _workUploads();
    var mine = Object.keys(uploads).filter(function (k) {
      var u = uploads[k];
      return u && u.cid === cid && u.sid === sid && u.aid === aid;
    });
    var ids = [];
    mine.forEach(function (k) {
      var u = uploads[k];
      if (u.server && u.server.submission_id) ids.push(u.server.submission_id);
      if (u.target) ids.push(u.target);
    });
    // Handed In on Paper not answered yet has no id to delete by.
    if (!_isUuid(sent.id) && !mine.length) return { result: 'uploading' };
    if (_isUuid(sent.id)) ids.push(sent.id);
    return Promise.all(mine.map(_workUploadAbandon)).then(function () {
      ids
        .filter(function (id, i) {
          return _isUuid(id) && ids.indexOf(id) === i;
        })
        .forEach(function (id) {
          _trackPendingSync(
            Promise.resolve(
              _writeRpc('delete_submission', { p_submission_id: id, p_idempotency_key: _newEntryId() }),
            ).then(function (res) {
              if (res && !res.error) {
                var srv = _workServer[cid];
                if (srv) {
                  srv.submissions = (srv.submissions || []).filter(function (s) {
                    return s && s.id !== id;
                  });
                }
              } else if (res && res.error && !res.error.handledSessionExpired) {
                console.warn('delete_submission failed:', res.error);
              }
              _workWriteLanded(cid);
              _sweepWorkRemovals();
            }),
          );
        });
      _workChanged(cid);
      return { result: 'deleted', pages: pages };
    });
  });
}

/* Handed In on Paper for a live class (mark_handed_in_paper): shown at
   once, sent through the outbox. */
function _serverMarkOnPaper(cid, aid, sids) {
  return _teacherWorkQueued(cid, function () {
    var who = [];
    (Array.isArray(sids) ? sids : []).forEach(function (sid) {
      if (typeof sid !== 'string' || who.indexOf(sid) >= 0) return;
      if (!_teacherWorkInClass(cid, sid, aid) || getStudentSubmission(cid, sid, aid)) return;
      who.push(sid);
    });
    if (!who.length) return { result: 'sent', marked: 0, submissions: [] };
    _trackPendingSync(
      Promise.resolve(
        _writeRpc('mark_handed_in_paper', {
          p_assessment_id: aid,
          p_enrollment_ids: who,
          p_idempotency_key: _newEntryId(),
        }),
      ).then(function (res) {
        var data = res && !res.error ? _rpcObject(res.data) : null;
        ((data && data.submissions) || []).forEach(function (s) {
          _workServerTake(cid, s);
        });
        if (res && res.error && !res.error.handledSessionExpired)
          console.warn('mark_handed_in_paper failed:', res.error);
        _workWriteLanded(cid);
      }),
    );
    _workChanged(cid);
    return {
      result: 'sent',
      marked: who.length,
      submissions: who.map(function (sid) {
        return getStudentSubmission(cid, sid, aid);
      }),
    };
  });
}

/* The edge function's sweep route: the removal worker, once things have
   settled (two seconds after the last call). Best effort; nothing waits
   on it and nothing shows if it fails. */
function _sweepWorkRemovals() {
  if (_isDemoSession() || typeof fetch !== 'function') return;
  if (_workSweepTimer) clearTimeout(_workSweepTimer);
  _workSweepTimer = setTimeout(function () {
    _workSweepTimer = null;
    var sb = getSupabase();
    var base = ((window.__ENV && window.__ENV.SUPABASE_URL) || '').replace(/\/$/, '');
    if (!sb || !sb.auth || !base) return;
    Promise.resolve(sb.auth.getSession())
      .then(function (r) {
        var token = r && r.data && r.data.session && r.data.session.access_token;
        if (!token) return null;
        return fetch(base + '/functions/v1/student-submit?forceFunctionRegion=ca-central-1', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ route: 'sweep', access_token: token }),
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
          cache: 'no-store',
        });
      })
      .then(null, function () {
        /* the files wait in the removal queue for the next run */
      });
  }, 2000);
}

/* The outbox's word on a work write (_onOutboxEvent): a start that landed
   after a reload is followed up here; a refused one drops its photos; any
   refused work write has the class read again. */
function _onWorkWriteEvent(kind, endpoint, payload, data) {
  try {
    if (endpoint === 'start_work_upload' && payload && payload.p_idempotency_key) {
      if (kind === 'flush:success') _workUploadStarted(payload.p_idempotency_key, data);
      else _workUploadAbandon(payload.p_idempotency_key);
    }
    if (kind !== 'flush:dead-letter') return;
    var cid =
      endpoint === 'set_course_send_work'
        ? payload && payload.p_course_id
        : _classOfAssessment(payload && payload.p_assessment_id);
    if (cid) _workWriteLanded(cid);
    else
      Object.keys(_workServer).forEach(function (c) {
        _workWriteLanded(c);
      });
  } catch (e) {
    console.warn('student work: following up a write failed:', e);
  }
}
var _WORK_ENDPOINTS = {
  set_course_send_work: true,
  set_assessment_student_work: true,
  start_work_upload: true,
  delete_submission: true,
  mark_handed_in_paper: true,
};

/* A signed-in page opening: the queue learns how to send, and pages left
   waiting by an earlier visit go (an upload whose start has no answer
   waits for the outbox). */
function _resumeWorkUploads() {
  if (_isDemoSession() || !_writesEnabled() || !Object.keys(_workUploads()).length) return;
  var q = _wireWorkQueue();
  var all = _workUploads();
  Object.keys(all).forEach(function (k) {
    if (all[k] && all[k].held) _workRestart(all[k]); // refused after the screen said sent: tried again
  });
  if (q && typeof q.send === 'function') q.send();
}
