// @ts-check
/* Quizzes: the students' sent tries, as the teacher reads and assesses them
   (docs/plans/quizzes-plan.md, slice Q4; migrations/local-test/
   quizzes-contract.md, "Teacher functions").

   Server: list_quiz_tries (sent tries only, every active student),
   mark_quiz_answer (a Text answer's points and note), reopen_quiz (one more
   try for one student) and confirm_quiz (what the teacher confirmed for each
   try; it writes no score). In Demo Mode the tries are kept on this device in
   gb-quiz-tries-<cid>, in the shape list_quiz_tries answers, and the three
   writes change that copy as the server would.

   Nothing here works out a grade or writes a score: a try's marking is
   calc.js's, and scores are written by Grader.confirmQuiz
   only. Every write carries an idempotency key made on this device and goes
   through the outbox. */

var _QT_QUIET = { suppressSessionExpiredModal: true };
/** @type {Record<string, any>} */
var _qtHeld = {}; // aid → list_quiz_tries' answer as last read (signed in)

/** @param {string} cid */
function _qtOnDevice(cid) {
  return typeof _quizOnDevice === 'function' && _quizOnDevice(cid);
}
/** @param {string} cid */
function _qtKey(cid) {
  return 'gb-quiz-tries-' + cid;
}
/** @param {string} cid @returns {Record<string, Record<string, any>>} */
function _qtLoad(cid) {
  var kept = _safeParseLS(_qtKey(cid), null);
  return _plainObject(kept) ? kept : {};
}
/** @param {string} cid @param {any} all */
function _qtSave(cid, all) {
  _safeLSSet(_qtKey(cid), JSON.stringify(all));
}

/* Demo Mode's answer, as list_quiz_tries gives it: every active student in
   class-list order with their sent tries; an unsent try is only its two
   flags. */
/** @param {string} cid @param {string} aid */
function _qtDemoReply(cid, aid) {
  var one = _qtLoad(cid)[aid] || {};
  return {
    students: (getStudents(cid) || []).map(function (/** @type {any} */ st) {
      var mine = one[st.id] || { tries: [] };
      var sent = (mine.tries || []).filter(function (/** @type {any} */ t) {
        return !!t.sent_at;
      });
      var open = mine.open || null;
      return {
        enrollment_id: st.id,
        sent: sent.length,
        in_progress: !!open && open.started === true,
        reopened: !!open && open.reopened === true,
        tries: JSON.parse(JSON.stringify(sent)),
      };
    }),
  };
}

/**
 * The sent tries of one quiz as last read: { students: [...] }, or null when
 * not read on this page. Demo Mode answers from its store at once.
 * @param {string} cid @param {string} aid
 */
function getQuizTries(cid, aid) {
  if (!cid || !aid) return null;
  if (_qtOnDevice(cid)) return _qtDemoReply(cid, aid);
  var held = _qtHeld[aid];
  return held ? JSON.parse(JSON.stringify(held)) : null;
}

/**
 * Read one quiz's sent tries (list_quiz_tries). A Promise of the answer, or
 * null when it could not be read.
 * @param {string} cid @param {string} aid @returns {Promise<any>}
 */
function loadQuizTries(cid, aid) {
  if (!cid || !aid) return Promise.resolve(null);
  if (_qtOnDevice(cid)) return Promise.resolve(_qtDemoReply(cid, aid));
  if (typeof quizzesOffered !== 'function' || !quizzesOffered(cid)) return Promise.resolve(null);
  var id = _resolveKnownId('assessment', aid);
  if (!_isUuid(id)) return Promise.resolve({ students: [] });
  return Promise.resolve()
    .then(function () {
      return _callRpcWithAuthGuard('list_quiz_tries', { p_assessment_id: id }, _QT_QUIET);
    })
    .then(function (/** @type {any} */ res) {
      if (res && res.error) {
        if (!res.error.handledSessionExpired) console.warn('list_quiz_tries failed:', res.error);
        return null;
      }
      var data = _rpcObject(res && res.data);
      if (!data || !Array.isArray(data.students)) return null;
      _qtHeld[aid] = { students: data.students };
      return JSON.parse(JSON.stringify(_qtHeld[aid]));
    })
    .then(null, function (/** @type {any} */ e) {
      console.warn('list_quiz_tries failed:', e);
      return null;
    });
}

/* A signed-in write through the outbox, keyed to the piece so it goes after
   the piece's own saves. A Promise of { ok, data, error }. */
/** @param {string} name @param {Record<string, any>} params @param {string} aid */
function _qtWrite(name, params, aid) {
  var key = _newEntryId();
  var done = Promise.resolve()
    .then(function () {
      return _writeRpc(name, Object.assign({}, params, { p_idempotency_key: key }), { entryId: key, key: 'id:' + aid });
    })
    .then(function (/** @type {any} */ res) {
      if (res && res.error) {
        if (!res.error.handledSessionExpired) console.warn(name + ' failed:', res.error);
        return { ok: false, error: res.error };
      }
      return { ok: true, data: _rpcObject(res && res.data) };
    })
    .then(null, function (/** @type {any} */ e) {
      console.warn(name + ' failed:', e);
      return { ok: false, error: e };
    });
  _trackPendingSync(done);
  return done;
}

/* The held copy's try, for a change made here before the server answers. */
/** @param {any} reply @param {string} attemptId */
function _qtFindTry(reply, attemptId) {
  /** @type {any} */
  var hit = null;
  ((reply && reply.students) || []).forEach(function (/** @type {any} */ s) {
    (s.tries || []).forEach(function (/** @type {any} */ t) {
      if (t.attempt_id === attemptId) hit = { student: s, attempt: t };
    });
  });
  return /** @type {{ student: any, attempt: any } | null} */ (hit);
}

/* Demo Mode's store, changed as the server changes its rows. */
/** @param {string} cid @param {string} aid @param {(one: Record<string, any>) => any} change */
function _qtDemoChange(cid, aid, change) {
  var all = _qtLoad(cid);
  var one = all[aid] || (all[aid] = {});
  var out = change(one);
  _qtSave(cid, all);
  return out;
}

/**
 * The teacher's points for one Text answer, and a note (mark_quiz_answer).
 * points null takes them away (the answer waits again). Changes no score.
 * A Promise of { ok }.
 * @param {string} cid @param {string} aid @param {string} attemptId @param {string} questionId
 * @param {number | null} points @param {string | null} note
 */
function markQuizAnswer(cid, aid, attemptId, questionId, points, note) {
  var text = typeof quizTrim === 'function' ? quizTrim(note || '') : String(note || '').trim();
  var given = points == null ? null : Number(points);
  /** @param {any} reply */
  var apply = function (reply) {
    var hit = _qtFindTry(reply, attemptId);
    var ans = hit
      ? (hit.attempt.answers || []).find(function (/** @type {any} */ a) {
          return a.question_id === questionId;
        })
      : null;
    if (!ans) return false;
    ans.given_points = given;
    ans.note = text || null;
    return true;
  };
  if (_qtOnDevice(cid)) {
    var ok = _qtDemoChange(cid, aid, function (one) {
      var reply = { students: Object.keys(one).map(sid => Object.assign({ enrollment_id: sid }, one[sid])) };
      return apply(reply);
    });
    return Promise.resolve({ ok: ok });
  }
  if (_qtHeld[aid]) apply(_qtHeld[aid]);
  return _qtWrite(
    'mark_quiz_answer',
    { p_attempt_id: attemptId, p_question_id: questionId, p_points: given, p_note: text || null },
    aid,
  );
}

/**
 * Reopen for One Student (reopen_quiz): one more try, answerable even after
 * the quiz closes, open until the student sends it. A Promise of { ok }.
 * @param {string} cid @param {string} aid @param {string} sid
 */
function reopenQuiz(cid, aid, sid) {
  if (_qtOnDevice(cid)) {
    _qtDemoChange(cid, aid, function (one) {
      var mine = one[sid] || (one[sid] = { tries: [] });
      if (mine.open) mine.open.reopened = true;
      else {
        var top = (mine.tries || []).reduce((n, /** @type {any} */ t) => Math.max(n, t.try), 0);
        mine.open = { try: top + 1, reopened: true, started: false };
      }
    });
    return Promise.resolve({ ok: true });
  }
  var held = _qtHeld[aid];
  ((held && held.students) || []).forEach(function (/** @type {any} */ s) {
    if (s.enrollment_id === sid) s.reopened = true;
  });
  return _qtWrite('reopen_quiz', { p_assessment_id: aid, p_enrollment_id: _resolveKnownId('student', sid) }, aid);
}

/**
 * Store what the teacher confirmed (confirm_quiz): marks is
 * [{ attempt_id, marked }], marked null to take a try's away (an Undo).
 * With a marked, every other try of that student loses its own. Writes no
 * score: Grader.confirmQuiz writes those, and is the only caller. A Promise of
 * { ok }.
 * @param {string} cid @param {string} aid @param {{ attempt_id: string, marked: any }[]} marks
 */
function confirmQuizMarks(cid, aid, marks) {
  if (!marks || !marks.length) return Promise.resolve({ ok: true });
  var at = new Date().toISOString();
  /** @param {any[]} students */
  var apply = function (students) {
    marks.forEach(function (m) {
      students.forEach(function (/** @type {any} */ s) {
        var tries = s.tries || [];
        var mine = tries.some(function (/** @type {any} */ t) {
          return t.attempt_id === m.attempt_id;
        });
        if (!mine) return;
        tries.forEach(function (/** @type {any} */ t) {
          if (t.attempt_id === m.attempt_id) {
            t.marked = m.marked ? JSON.parse(JSON.stringify(m.marked)) : null;
            t.marked_at = m.marked ? at : null;
          } else if (m.marked) {
            t.marked = null;
            t.marked_at = null;
          }
        });
      });
    });
  };
  if (_qtOnDevice(cid)) {
    _qtDemoChange(cid, aid, function (one) {
      apply(Object.keys(one).map(sid => one[sid]));
    });
    return Promise.resolve({ ok: true });
  }
  if (_qtHeld[aid]) apply(_qtHeld[aid].students || []);
  return _qtWrite('confirm_quiz', { p_assessment_id: aid, p_marks: marks }, aid);
}

/* What Confirm wrote, cell by cell, so a later Confirm of the same quiz can
   tell its own score (which it may replace) from one the teacher set or
   changed by hand (which it never does). Kept on this device in
   gb-quiz-written-<cid>: { aid: { "sid|competency id" or "sid|points":
   { score, mod } } }. A device without the record treats every score as the
   teacher's, so the worst it does is keep one. Signed in and in Demo Mode
   alike; it holds no answer and no key. */
/** @param {string} cid */
function _qwKey(cid) {
  return 'gb-quiz-written-' + cid;
}
/** @param {string} cid @param {string} aid @returns {Record<string, { score: number, mod: number }>} */
function quizWritten(cid, aid) {
  var all = _safeParseLS(_qwKey(cid), null);
  var one = _plainObject(all) ? all[aid] : null;
  return _plainObject(one) ? JSON.parse(JSON.stringify(one)) : {};
}
/** @param {string} cid @param {string} aid @param {Record<string, any>} cells */
function setQuizWritten(cid, aid, cells) {
  var all = _safeParseLS(_qwKey(cid), null);
  var next = _plainObject(all) ? all : {};
  var some = !!cells && Object.keys(cells).length > 0;
  // Nothing kept and nothing to keep: nothing is written (a class with no quiz gets no key).
  if (!some && !(aid in next)) return;
  if (some) next[aid] = cells;
  else delete next[aid];
  _safeLSSet(_qwKey(cid), JSON.stringify(next));
}

/**
 * Demo Mode's sample tries (shared/seed-data.js): written once, never over
 * tries already kept. tries: { sid: { tries: [...], open } }.
 * @param {string} cid @param {string} aid @param {Record<string, any>} tries
 */
function saveDemoQuizTriesSeed(cid, aid, tries) {
  if (!cid || !aid || !_isDemoSession()) return false;
  var all = _qtLoad(cid);
  if (all[aid]) return false;
  all[aid] = tries;
  _qtSave(cid, all);
  return true;
}

if (typeof window !== 'undefined') {
  /** @type {any} */ (window).QuizTries = {
    get: getQuizTries,
    load: loadQuizTries,
    mark: markQuizAnswer,
    reopen: reopenQuiz,
    confirm: confirmQuizMarks,
    written: quizWritten,
    setWritten: setQuizWritten,
  };
}
