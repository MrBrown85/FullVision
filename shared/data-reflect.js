// @ts-check
/* Reflect on Feedback: a student's reflection on returned work, the class's two feedback switches (Reflect on Feedback, Show My Learning) and Send Answer.
   Moved from shared/data.js on 2026-11-12 (S19 split, move only). */

/* ══════════════════════════════════════════════════════════════════
   Reflect on Feedback: a student's reflection on returned work (S10)
   ══════════════════════════════════════════════════════════════════
   After a piece comes back, the student says whether the feedback makes
   sense (yes, or not sure with a question), makes a plan and may say what
   went well; the teacher answers; the student says whether it makes sense
   now, with one follow-up question. The student's words are theirs: no
   teacher function changes them. Only the teacher reads them ("Only Mr.
   Brown sees this"): a student reads only their own, and nothing a family
   reads (reports, phone reports, the Term Questionnaire) reads them.

   Behind the class's Reflect on Feedback switch (courseConfig
   .reflect_on_feedback, off by default) and the build switch: with either
   off, every reader here shows no reflection and a student's send answers
   reflect_off. The plan comes back on the student's next piece as Your
   Plan From Last Time, and "Did You Do It?" (yes, partly, no for Not This
   Time) is kept on that piece's submission (Batch B's followed_plan).

   Shapes are the server's (batch-c-contract.md, PR 1043, not applied):
   set_course_feedback_options, list_course_feedback, answer_reflection,
   and the student's feedback(...), reflect(...) and reply(...). Each is
   made in one function here (_reflectionRow, _studentReflection,
   _courseFeedbackOptions), so S10-W1 changes one place.

   Demo Mode keeps them in gb-student-feedback-<cid> (field `reflections`,
   by assessment then student). A signed-in class's are the server's (the
   block above): the teacher's readers and Send Answer answer from it. The
   student's own writers here (sendStudentReflection, sendStudentReply) are
   Demo Mode's: a real student sends through the student-submit routes and
   they answer { ok: false, error: 'not_available' } signed in. */
var REFLECTION_TEXT_MAX = 1000;
var ANSWER_TEXT_MAX = 2000;

function _courseFeedbackOptions(cid) {
  if (_fbOn(cid) && !_isDemoSession()) return Object.assign({}, _fbCourseOptions(cid));
  var cfg = getCourseConfig(cid) || {};
  return { reflect_on_feedback: cfg.reflect_on_feedback === true, show_my_learning: cfg.show_my_learning === true };
}

/* The class's two switches, { reflect_on_feedback, show_my_learning }, as
   the screens read them: Demo Mode's settings, or a signed-in class's
   from the server (with a change not yet answered laid over it). Both off
   for a class that keeps no student-page rows. */
function getCourseFeedbackOptions(cid) {
  if (!_fbReads(cid)) return { reflect_on_feedback: false, show_my_learning: false };
  return _courseFeedbackOptions(cid);
}

/* True when the class's reflections show: Demo Mode or a signed-in class
   the server keeps rows for, the build switch and Reflect on Feedback on. */
function getReflectOnFeedback(cid) {
  if (!_fbReads(cid)) return false;
  if (!_isDemoSession()) return _courseFeedbackOptions(cid).reflect_on_feedback;
  return !!getReturnSettings(cid).student_page && _courseFeedbackOptions(cid).reflect_on_feedback;
}

/* Turn Reflect on Feedback (and Show My Learning) on or off:
   set_course_feedback_options. `patch` names either or both, true or
   false; only what it names is written. A Promise of { reflect_on_feedback,
   show_my_learning } as saved, or { result: 'invalid' } (a wrong patch or no
   key), { result: 'failed' } (signed in: the server refused it), or
   { result: 'not_available' } (a class that keeps no student-page rows).
   Signed in it is set_course_feedback_options through the outbox, and shows
   at once. */
function setCourseFeedbackOptions(cid, patch, key) {
  if (!cid || !_fbReads(cid)) return Promise.resolve({ result: 'not_available' });
  if (!_plainObject(patch) || !_idemKeyOk(key)) return Promise.resolve({ result: 'invalid' });
  var names = Object.keys(patch);
  var ok =
    names.length > 0 &&
    names.every(function (k) {
      return (k === 'reflect_on_feedback' || k === 'show_my_learning') && typeof patch[k] === 'boolean';
    });
  if (!ok) return Promise.resolve({ result: 'invalid' });
  if (!_isDemoSession()) return _setCourseFeedbackLive(cid, patch, key);
  saveCourseConfig(cid, Object.assign({}, getCourseConfig(cid) || {}, patch));
  return Promise.resolve(_courseFeedbackOptions(cid));
}

// set_course_feedback_options for a live class: shown at once, sent through the outbox, as Send Work's two switches are.
function _setCourseFeedbackLive(cid, patch, key) {
  var mine = { patch: Object.assign({}, (_fbCourseHere[cid] || {}).patch, patch) };
  _fbCourseHere[cid] = mine;
  _fbChanged(cid);
  var sent = _writeRpc('set_course_feedback_options', {
    p_course_id: cid,
    p_patch: Object.assign({}, patch),
    p_idempotency_key: _isUuid(key) ? key : _newEntryId(),
  });
  var done = Promise.resolve(sent).then(function (res) {
    var still = _fbCourseHere[cid] === mine;
    if (still) delete _fbCourseHere[cid];
    var data = res && !res.error ? _rpcObject(res.data) : null;
    if (data && still) _noteCourseFeedbackOptions(cid, data);
    if (res && res.error && !res.error.handledSessionExpired && !res.error.refused) {
      console.warn('set_course_feedback_options failed:', res.error);
    }
    _fbWriteLanded(cid);
    return data ? _courseFeedbackOptions(cid) : { result: 'failed' };
  });
  _trackPendingSync(done);
  return done;
}

// A non-blank string of at most `max` characters, or null when blank or missing.
function _reflectionText(v, max) {
  if (v == null) return { ok: true, value: null };
  if (typeof v !== 'string' || v.length > max) return { ok: false };
  return { ok: true, value: v.trim() ? v : null };
}

/* A piece the student has been given a grade on: returned, or a draft over
   a grade returned before (the student still has that one). */
function _feedbackReturned(cid, sid, aid) {
  var row = getGradeReturn(cid, sid, aid);
  if (row && row.returned_at) return true;
  // A draft never returned is not back (stateOf says Draft).
  return GradeState.stateOf(cid, sid, aid) === GradeState.RETURNED;
}

function _reflectionsOf(stored) {
  return stored && _plainObject(stored.reflections) ? stored.reflections : {};
}

function _reflectionKept(cid, sid, aid) {
  if (_fbOn(cid) && !_isDemoSession()) {
    return (
      _fbReflections(cid).find(function (r) {
        return r && r.assessment_id === aid && r.enrollment_id === sid;
      }) || null
    );
  }
  var of = _reflectionsOf(_studentFeedbackStored(cid))[aid];
  return (of && of[sid]) || null;
}

// What is waiting for the teacher: a question (or, with none, the reflection), then a follow-up.
function _reflectionWaiting(r) {
  if (r.follow_up && !r.follow_up_answer) return true;
  return !!r.question && !r.answer;
}

// list_course_feedback's reflection.
function _reflectionRow(r) {
  return {
    id: r.id,
    assessment_id: r.assessment_id,
    enrollment_id: r.enrollment_id,
    makes_sense: r.makes_sense,
    question: r.question || null,
    plan: r.plan || null,
    went_well: r.went_well || null,
    sent_at: r.sent_at,
    answer: r.answer || null,
    answered_at: r.answered_at || null,
    sense_now: r.sense_now || null,
    sense_now_at: r.sense_now_at || null,
    follow_up: r.follow_up || null,
    follow_up_answer: r.follow_up_answer || null,
    follow_up_answered_at: r.follow_up_answered_at || null,
    // The server's own word on it for a signed-in class (it counts a note kept Only Me).
    waiting: typeof r.waiting === 'boolean' ? r.waiting : _reflectionWaiting(r),
  };
}

// The student's feedback(...).reflection: their own words and the answers, no ids.
function _studentReflection(r) {
  return {
    makes_sense: r.makes_sense,
    question: r.question || null,
    plan: r.plan || null,
    went_well: r.went_well || null,
    sent_at: r.sent_at,
    answer: r.answer || null,
    answered_at: r.answered_at || null,
    sense_now: r.sense_now || null,
    follow_up: r.follow_up || null,
    follow_up_answer: r.follow_up_answer || null,
    follow_up_answered_at: r.follow_up_answered_at || null,
  };
}

/* Every reflection of the class that shows, on a piece and a student still
   in the class, oldest first. [] while Reflect on Feedback is off. */
function _classReflections(cid) {
  if (!getReflectOnFeedback(cid)) return [];
  var students = {};
  (getStudents(cid) || []).forEach(function (s) {
    if (s && s.id) students[s.id] = true;
  });
  var out = [];
  if (!_isDemoSession()) {
    // The server's list, on a piece and a student still in the class.
    var pieces = {};
    (getAssessments(cid) || []).forEach(function (a) {
      if (a && a.id) pieces[a.id] = true;
    });
    out = _fbReflections(cid).filter(function (r) {
      return r && pieces[r.assessment_id] && students[r.enrollment_id];
    });
  } else {
    var all = _reflectionsOf(_studentFeedbackStored(cid));
    (getAssessments(cid) || []).forEach(function (a) {
      var of = a && all[a.id];
      if (!_plainObject(of)) return;
      Object.keys(of).forEach(function (sid) {
        if (students[sid] && of[sid]) out.push(of[sid]);
      });
    });
  }
  return out.sort(function (x, y) {
    return String(x.sent_at) < String(y.sent_at) ? -1 : String(x.sent_at) > String(y.sent_at) ? 1 : 0;
  });
}

/* list_course_feedback: { course, markup, revisions, reflections }.
   markup: every marked page of the class ({ file_id, assessment_id,
   enrollment_id, rev, given_rev, given_at, waiting }); revisions: every
   revision request of the class as _revisionRow, oldest first, [] while
   revisionsOn is false (S11);
   reflections: as _reflectionRow, [] while Reflect on Feedback is off.
   A class that keeps no student-page rows: everything empty and both
   switches off. */
function getCourseFeedback(cid) {
  var demo = _fbReads(cid);
  var markup = [];
  if (demo) {
    (getAssessments(cid) || []).forEach(function (a) {
      if (!a || !a.id) return;
      getAssessmentMarkup(cid, a.id).forEach(function (r) {
        markup.push({
          file_id: r.file_id,
          assessment_id: a.id,
          enrollment_id: r.enrollment_id,
          rev: r.rev,
          given_rev: r.given_rev,
          given_at: r.given_at,
          waiting: r.waiting,
        });
      });
    });
  }
  return {
    course: demo ? _courseFeedbackOptions(cid) : { reflect_on_feedback: false, show_my_learning: false },
    markup: markup,
    revisions: _classRevisions(cid).map(function (r) {
      return _revisionRow(cid, r);
    }),
    reflections: _classReflections(cid).map(_reflectionRow),
  };
}

/* Questions From Students: the reflections with a question or follow-up
   not answered, oldest first, for the class or (with `sid`) one student.
   What the dashboard's card, the gradebook's mark and the Learner
   Profile's mark count; one answer clears all three. */
function getQuestionsWaiting(cid, sid) {
  return _classReflections(cid)
    .filter(function (r) {
      return _reflectionWaiting(r) && (!sid || r.enrollment_id === sid);
    })
    .map(_reflectionRow);
}

/* One student's reflections, newest first, each with `next`: the next
   piece of the class the student sent work for after reflecting, and their
   "Did You Do It?" on it ({ assessment_id, followed_plan }, followed_plan
   yes, partly, no or null), or null when none is in yet. For the Learner
   Profile's Reflections on Feedback and "2 of 3 plans followed". */
function getStudentReflections(cid, sid) {
  var subs = _studentWorkSubmissions(cid).filter(function (s) {
    return s.enrollment_id === sid && s.sent_at;
  });
  return _classReflections(cid)
    .filter(function (r) {
      return r.enrollment_id === sid;
    })
    .reverse()
    .map(function (r) {
      var row = _reflectionRow(r);
      var after = subs
        .filter(function (s) {
          return s.assessment_id !== r.assessment_id && String(s.sent_at) > String(r.sent_at);
        })
        .sort(function (x, y) {
          return String(x.sent_at) < String(y.sent_at) ? -1 : 1;
        })[0];
      row.next = after ? { assessment_id: after.assessment_id, followed_plan: after.followed_plan || null } : null;
      return row;
    });
}

/* Your Plan From Last Time (feedback(...).last_plan): the student's newest
   plan in the class, { assessment_id, plan, sent_at }, or null. */
function getStudentLastPlan(cid, sid) {
  var withPlan = _classReflections(cid).filter(function (r) {
    return r.enrollment_id === sid && r.plan;
  });
  var last = withPlan[withPlan.length - 1];
  return last ? { assessment_id: last.assessment_id, plan: last.plan, sent_at: last.sent_at } : null;
}

/* Send Answer (answer_reflection): answers what is waiting, the question
   (or, with none, the reflection), then the follow-up. `answer` 1 to 2000
   characters. A Promise of { result: 'answered', reflection } (as
   _reflectionRow), { result: 'already_answered' }, { result: 'not_found' },
   { result: 'invalid' } (no answer, too long, or no key), { result:
   'failed' } (signed in: the server refused it), or { result:
   'not_available' } (a class that keeps no student-page rows). The same key
   again answers the same. Signed in it is answer_reflection through the
   outbox (_answerReflectionLive). */
function answerReflection(cid, reflectionId, answer, key) {
  if (!cid || !_fbReads(cid)) return Promise.resolve({ result: 'not_available' });
  if (typeof answer !== 'string' || !answer.trim() || answer.length > ANSWER_TEXT_MAX || !_idemKeyOk(key)) {
    return Promise.resolve({ result: 'invalid' });
  }
  if (!_isDemoSession()) return _answerReflectionLive(cid, reflectionId, answer, key);
  var again = _feedbackRemembered(cid, 'reflection-answer', key);
  if (again !== undefined) return Promise.resolve(again);
  var found = _classReflections(cid).find(function (r) {
    return r.id === reflectionId;
  });
  if (!found) return Promise.resolve({ result: 'not_found' });
  var draft = _studentFeedbackDraft(cid);
  var r = draft.reflections[found.assessment_id][found.enrollment_id];
  var now = new Date().toISOString();
  if (!r.answer) {
    r.answer = answer;
    r.answered_at = now;
  } else if (r.follow_up && !r.follow_up_answer) {
    r.follow_up_answer = answer;
    r.follow_up_answered_at = now;
  } else {
    return Promise.resolve({ result: 'already_answered' });
  }
  var out = { result: 'answered', reflection: _reflectionRow(r) };
  _feedbackRemember(draft, 'reflection-answer', key, out);
  _studentFeedbackWrite(cid, draft);
  return Promise.resolve(out);
}

/* Send Answer for a live class: shown at once (the queued answer is laid
   over the list), sent through the outbox under its own key. The screen
   waits for the server's answer a few seconds and goes on as if sent when
   there is none (offline). */
function _answerReflectionLive(cid, reflectionId, answer, key) {
  var found = _isUuid(reflectionId)
    ? _classReflections(cid).find(function (r) {
        return r.id === reflectionId;
      })
    : null;
  if (!found) return Promise.resolve({ result: 'not_found' });
  var test = _studentWorkCopy(found);
  var now = new Date().toISOString();
  if (!_fbApplyAnswer(test, answer, false, now)) {
    return Promise.resolve({ result: 'already_answered', reflection: _reflectionRow(found) });
  }
  var sent = _writeRpc('answer_reflection', {
    p_reflection_id: reflectionId,
    p_answer: answer.trim(),
    p_idempotency_key: _isUuid(key) ? key : _newEntryId(),
    p_only_me: false,
  });
  if (sent && sent.refused) return Promise.resolve({ result: 'failed' });
  _fbChanged(cid);
  _trackPendingSync(Promise.resolve(sent));
  var late = new Promise(function (resolve) {
    setTimeout(resolve, _MARKUP_SAVE_WAIT_MS, null);
  });
  return Promise.race([Promise.resolve(sent), late]).then(function (res) {
    if (!res) return { result: 'answered', reflection: _reflectionRow(test) };
    var data = res.error ? null : _rpcObject(res.data);
    if (data && (data.result === 'answered' || data.result === 'already_answered') && _plainObject(data.reflection)) {
      return { result: data.result, reflection: _reflectionRow(data.reflection) };
    }
    if (res.error && /P0002|not found/i.test(String(res.error.code || res.error.message || ''))) {
      return { result: 'not_found' };
    }
    return { result: 'failed' };
  });
}

/* The student `from` (the one signed in on the page) acting on their own
   piece: an error code, or null to go on. The server answers not_found
   for an enrollment the session does not hold. */
function _studentFeedbackCheck(cid, sid, aid, from) {
  if (!cid || !_isDemoSession()) return 'not_available';
  if (!sid || from !== sid) return 'not_found';
  var inClass = (getStudents(cid) || []).some(function (s) {
    return s && s.id === sid;
  });
  if (!inClass || !_assessmentById(cid, aid)) return 'not_found';
  if (!getReflectOnFeedback(cid)) return 'reflect_off';
  return null;
}

/* A student's reflection (reflect): `reflection` is { makes_sense: 'yes' |
   'not_sure', question, plan, went_well }, each 1000 characters at most;
   not_sure needs a question, yes a plan. `from` is the student signed in
   on the page: only they reflect on their own work. Sent again before the
   teacher answers, it takes the place of the first. Answers { ok: true,
   reflection } (as the student sees it) or { ok: false, error }:
   reflect_off, not_found, not_returned (the student has no grade back on
   the piece), already_answered, invalid (a wrong shape), not_available
   (signed in). */
function sendStudentReflection(cid, sid, aid, reflection, from) {
  var refused = _studentFeedbackCheck(cid, sid, aid, from);
  if (refused) return { ok: false, error: refused };
  if (!_plainObject(reflection)) return { ok: false, error: 'invalid' };
  var sense = reflection.makes_sense;
  var q = _reflectionText(reflection.question, REFLECTION_TEXT_MAX);
  var p = _reflectionText(reflection.plan, REFLECTION_TEXT_MAX);
  var w = _reflectionText(reflection.went_well, REFLECTION_TEXT_MAX);
  if ((sense !== 'yes' && sense !== 'not_sure') || !q.ok || !p.ok || !w.ok) return { ok: false, error: 'invalid' };
  if ((sense === 'not_sure' && !q.value) || (sense === 'yes' && !p.value)) return { ok: false, error: 'invalid' };
  if (!_feedbackReturned(cid, sid, aid)) return { ok: false, error: 'not_returned' };
  var kept = _reflectionKept(cid, sid, aid);
  if (kept && kept.answer) return { ok: false, error: 'already_answered' };
  var words = { makes_sense: sense, question: q.value, plan: p.value, went_well: w.value };
  // The same reflection twice is the same.
  if (
    kept &&
    ['makes_sense', 'question', 'plan', 'went_well'].every(function (k) {
      return (kept[k] || null) === words[k];
    })
  ) {
    return { ok: true, reflection: _studentReflection(kept) };
  }
  var draft = _studentFeedbackDraft(cid);
  var of = (draft.reflections[aid] = _plainObject(draft.reflections[aid]) ? draft.reflections[aid] : {});
  of[sid] = Object.assign(
    {
      id: (kept && kept.id) || 'rf' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      assessment_id: aid,
      enrollment_id: sid,
      sent_at: new Date().toISOString(),
    },
    words,
  );
  _studentFeedbackWrite(cid, draft);
  return { ok: true, reflection: _studentReflection(of[sid]) };
}

/* Does It Make Sense Now? (reply): `reply` is { sense_now: 'yes' |
   'not_sure', follow_up } (follow_up only with not_sure, once, 1000
   characters at most). Answers { ok: true, reflection } or { ok: false,
   error }: reflect_off, not_found (no reflection), not_answered (no answer
   yet), already_asked (a follow-up is in), invalid, not_available. */
function sendStudentReply(cid, sid, aid, reply, from) {
  var refused = _studentFeedbackCheck(cid, sid, aid, from);
  if (refused) return { ok: false, error: refused };
  if (!_plainObject(reply) || (reply.sense_now !== 'yes' && reply.sense_now !== 'not_sure')) {
    return { ok: false, error: 'invalid' };
  }
  var f = _reflectionText(reply.follow_up, REFLECTION_TEXT_MAX);
  if (!f.ok || (f.value && reply.sense_now !== 'not_sure')) return { ok: false, error: 'invalid' };
  var kept = _reflectionKept(cid, sid, aid);
  if (!kept) return { ok: false, error: 'not_found' };
  if (!kept.answer) return { ok: false, error: 'not_answered' };
  if (kept.follow_up) return { ok: false, error: 'already_asked' };
  var draft = _studentFeedbackDraft(cid);
  var r = draft.reflections[aid][sid];
  r.sense_now = reply.sense_now;
  r.sense_now_at = new Date().toISOString();
  if (f.value) r.follow_up = f.value;
  _studentFeedbackWrite(cid, draft);
  return { ok: true, reflection: _studentReflection(r) };
}

/* What the student's page reads beside their work (feedback): { ok, v,
   reflect_on_feedback, show_my_learning, assessments: [{ id, marks,
   revision, reflection }], last_plan }, for the student `sid` only. A piece
   is listed when it has marks given (getStudentMarkCounts), a revision
   asked (getStudentRevision, S11) or a reflection. Reflections and
   last_plan only while Reflect on Feedback is on; revisions only while
   revisionsOn. Signed in: the switches off and nothing listed. */
function getStudentFeedback(cid, sid) {
  var demo = _fbReads(cid);
  var on = getReflectOnFeedback(cid);
  var out = {
    ok: true,
    v: 1,
    reflect_on_feedback: on,
    show_my_learning: demo && _courseFeedbackOptions(cid).show_my_learning,
    assessments: /** @type {unknown[]} */ ([]),
    last_plan: on ? getStudentLastPlan(cid, sid) : null,
  };
  if (!demo) return out;
  (getAssessments(cid) || []).forEach(function (a) {
    if (!a || !a.id) return;
    var marks = getStudentMarkCounts(cid, sid, a.id);
    var kept = on ? _reflectionKept(cid, sid, a.id) : null;
    var revision = getStudentRevision(cid, sid, a.id);
    if (!marks && !kept && !revision) return;
    out.assessments.push({
      id: a.id,
      marks: marks,
      revision: revision,
      reflection: kept ? _studentReflection(kept) : null,
    });
  });
  return out;
}

/* "Did You Do It?" on the piece sent after a plan: `value` 'yes', 'partly'
   or 'no' (Not This Time), or null, kept on the student's submission for
   `aid` as Batch B's followed_plan (send_start's p_followed_plan). A
   Promise of { result: 'saved', submission }, { result: 'nothing_sent' },
   { result: 'not_found' }, { result: 'invalid' }, or signed in { result:
   'not_available' }. Demo Mode's own way in: the student's real send passes
   it with the work. */
function setStudentFollowedPlan(cid, sid, aid, value) {
  if (!cid || !_isDemoSession()) return Promise.resolve({ result: 'not_available' });
  if (value !== null && value !== 'yes' && value !== 'partly' && value !== 'no') {
    return Promise.resolve({ result: 'invalid' });
  }
  return _teacherWorkQueued(cid, function () {
    if (!_teacherWorkInClass(cid, sid, aid)) return { result: 'not_found' };
    var draft = _studentWorkDraft(cid);
    var sent = _teacherWorkSent(draft, sid, aid);
    if (!sent) return { result: 'nothing_sent' };
    sent.followed_plan = value;
    _studentWorkWrite(cid, draft);
    return { result: 'saved', submission: getStudentSubmission(cid, sid, aid) };
  });
}

/* Demo Mode's sample reflections (seed-data.js): [{ assessment_id,
   enrollment_id, sent_at, makes_sense, question, plan, went_well, answer,
   answered_at, sense_now, sense_now_at }], kept as sent whatever the
   switch says (the readers show them only while it is on). false outside
   Demo Mode, or for a student or piece not in the class. */
function saveDemoReflections(cid, list) {
  if (!cid || !_isDemoSession() || !Array.isArray(list)) return false;
  var students = {};
  (getStudents(cid) || []).forEach(function (s) {
    if (s && s.id) students[s.id] = true;
  });
  var ok = list.every(function (r) {
    return _plainObject(r) && students[r.enrollment_id] && _assessmentById(cid, r.assessment_id) && r.sent_at;
  });
  if (!ok) return false;
  var draft = _studentFeedbackDraft(cid);
  list.forEach(function (r) {
    var of = (draft.reflections[r.assessment_id] = _plainObject(draft.reflections[r.assessment_id])
      ? draft.reflections[r.assessment_id]
      : {});
    of[r.enrollment_id] = Object.assign(
      { id: 'demo-rf-' + r.enrollment_id + '-' + r.assessment_id },
      _studentWorkCopy(r),
    );
  });
  _studentFeedbackWrite(cid, draft);
  return true;
}
