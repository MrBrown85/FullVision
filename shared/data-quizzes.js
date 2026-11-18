// @ts-check
/* Quizzes: the teacher's side of a quiz, read and saved (docs/plans/
   quizzes-plan.md, slice Q2b). One quiz per assessment, kept apart from the
   assessment: `assessment.students_send` stays 'nothing' for a quiz piece.

   Server (migrations/local-test/quizzes-contract.md on the Q1 branch):
   list_quiz(p_assessment_id) and save_quiz(p_assessment_id, p_quiz,
   p_idempotency_key), for the signed-in teacher's own class. Not on the live
   database until MQ1 is applied: a server whose list_quiz answers "no such
   function" is offered nothing and sent nothing (quizzesOffered).

   The answer key never leaves the teacher's side. Signed in, it is saved by
   save_quiz and read by list_quiz only. In Demo Mode the questions are kept in
   gb-quizzes-<cid> and the key apart in gb-quiz-keys-<cid>; nothing the
   student page or Preview as Student reads (shared/student-view.js, s/)
   opens either.

   A save goes through the outbox with a key made on this device. An
   assessment still waiting for its own create has a local id: the save waits
   behind that create and is re-keyed when it lands (_writeRpc). Until the
   server answers, the quiz as saved is kept on this device
   (gb-quiz-unsent-<cid>), so a refused or lost save keeps the teacher's
   questions for the next time the form opens. Trouble shows on the sync dot
   only; the Quiz card says why a refused save was refused when it opens.

   Nothing here works out a grade or writes a score. */

var QUIZ_MAX_QUESTIONS = 100;
var QUIZ_PROMPT_MAX = 1000;
var QUIZ_CHOICE_MAX = 300;
var QUIZ_CHOICES_MIN = 2;
var QUIZ_CHOICES_MAX = 20;
var QUIZ_WHY_MAX = 500;
var QUIZ_POINTS_MAX = 100;
var QUIZ_NUMBER_MAX = 1e12;
// An id no assessment has: list_quiz answers "not found" when the function is there.
var _QUIZ_PROBE_ID = '00000000-0000-4000-8000-000000000000';
var _QUIZ_QUIET = { suppressSessionExpiredModal: true };
var _QUIZ_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** @typedef {{ answer: any, tolerance: number | null, why: string | null }} QuizKey */
/** @typedef {{ id: string, position: number | null, kind: string, prompt: string, choices: { id: string, text: string }[] | null, multiple: boolean, points: number, tag_id: string | null, answered: boolean, archived_at: string | null, key: QuizKey }} QuizQuestion */
/** @typedef {{ quiz: Record<string, any> | null, questions: QuizQuestion[], archived: QuizQuestion[] }} QuizReply */

/** @type {Record<string, { state: string, loading: Promise<boolean> | null }>} */
var _quizProbe = {}; // cid → 'ok', 'missing' (no such function yet), 'failed', or '' before the first answer
/** @type {Record<string, QuizReply>} */
var _quizHeld = {}; // aid → the quiz as the server last answered it (signed in)

/* The settings a new quiz starts with (the contract's defaults). */
function quizDefaults() {
  return {
    shuffle_questions: true,
    shuffle_choices: true,
    tries: 1,
    counts: 'best',
    shows: 'answers',
    add_total: false,
    after_due: 'keep',
    accept_until: null,
  };
}

/* ── Where a class's quizzes are kept ───────────────────────────────────── */

/** Demo Mode with the class's student page on. @param {string} cid */
function _quizOnDevice(cid) {
  return !!cid && _isDemoSession() && _gradesKept(cid);
}
/** A signed-in class with its server id and its student page on. @param {string} cid */
function _quizOnServer(cid) {
  return !!cid && !_isDemoSession() && _serverKeepsRows(cid);
}

/**
 * True where a quiz can be made for a class: the quizzes build switch on, and
 * Demo Mode with the class's student page on, or a signed-in class whose
 * server answered list_quiz.
 * @param {string} cid
 */
function quizzesOffered(cid) {
  if (typeof BuildFlags === 'undefined' || !BuildFlags.on('quizzes')) return false;
  if (_quizOnDevice(cid)) return true;
  return _quizOnServer(cid) && !!_quizProbe[cid] && _quizProbe[cid].state === 'ok';
}

/**
 * Ask a signed-in class's server once whether it has list_quiz. A Promise of
 * true when it does. A server without it answers false and is not asked again
 * on this page. Demo Mode asks nothing.
 * @param {string} cid
 * @returns {Promise<boolean>}
 */
function probeQuizzes(cid) {
  if (typeof BuildFlags === 'undefined' || !BuildFlags.on('quizzes')) return Promise.resolve(false);
  if (_quizOnDevice(cid)) return Promise.resolve(true);
  if (!_quizOnServer(cid)) return Promise.resolve(false);
  var read = _quizProbe[cid] || (_quizProbe[cid] = { state: '', loading: null });
  if (read.state === 'ok') return Promise.resolve(true);
  if (read.state === 'missing') return Promise.resolve(false);
  if (read.loading) return read.loading;
  read.loading = Promise.resolve()
    .then(function () {
      // @ts-expect-error list_quiz is not in types/database.d.ts until MQ1 is applied and the types are regenerated.
      return _callRpcWithAuthGuard('list_quiz', { p_assessment_id: _QUIZ_PROBE_ID }, _QUIZ_QUIET);
    })
    .then(function (res) {
      var err = res && res.error;
      // The migration comes first: nothing offered, nothing sent, no report.
      if (err && _isMissingRpcError(err)) read.state = 'missing';
      else if (!err || String(err.code || '') === 'P0002') read.state = 'ok';
      else read.state = 'failed';
      return read.state === 'ok';
    })
    .then(null, function () {
      read.state = 'failed';
      return false;
    })
    .then(function (ok) {
      read.loading = null;
      return ok;
    });
  return read.loading;
}

/* ── Pure helpers ───────────────────────────────────────────────────────── */

/** A lower-case version-4 UUID, made on this device (a choice's id). */
function quizNewId() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID().toLowerCase();
    }
  } catch (e) {
    /* fall through */
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    var r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** @param {unknown} v */
function _quizText(v) {
  return typeof v === 'string' ? v.trim() : '';
}
/** @param {unknown} v */
function _quizNum(v) {
  return typeof v === 'number' && isFinite(v);
}
/** @param {unknown} v */
function _quizBool(v) {
  return v === true || v === false;
}
/** Byte order, as collation "C" sorts. @param {string[]} ids */
function _quizSorted(ids) {
  return ids.slice().sort(function (a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

/**
 * What save_quiz would refuse in p_quiz, as the contract writes its rules:
 * { message, detail } with the server's word, or null. tagIds: the
 * piece's competencies. Demo Mode refuses by it, so Demo Mode never keeps a
 * quiz the server would not.
 * @param {any} p @param {string[]} tagIds
 * @returns {{ message: string, detail: string } | null}
 */
function quizPayloadProblem(p, tagIds) {
  /** @param {string} d */
  var bad = function (d) {
    return { message: 'bad_quiz', detail: d };
  };
  if (!_plainObject(p)) return bad('the quiz is an object');
  var keys = [
    'shuffle_questions',
    'shuffle_choices',
    'tries',
    'counts',
    'shows',
    'add_total',
    'after_due',
    'accept_until',
    'questions',
  ];
  var extra = Object.keys(p).filter(function (k) {
    return keys.indexOf(k) < 0;
  });
  if (extra.length) return bad('unknown key ' + extra[0]);
  for (var k = 0; k < keys.length; k++) if (!(keys[k] in p)) return bad('missing ' + keys[k]);
  if (!_quizBool(p.shuffle_questions) || !_quizBool(p.shuffle_choices) || !_quizBool(p.add_total)) {
    return bad('a switch is true or false');
  }
  if ([0, 1, 2].indexOf(p.tries) < 0) return bad('tries');
  if (p.counts !== 'best' && p.counts !== 'latest') return bad('counts');
  if (['grade', 'right', 'answers'].indexOf(p.shows) < 0) return bad('shows');
  if (['keep', 'stop', 'until'].indexOf(p.after_due) < 0) return bad('after_due');
  var dated = typeof p.accept_until === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.accept_until);
  if (p.after_due === 'until' ? !dated : p.accept_until !== null) return bad('accept_until');
  if (!Array.isArray(p.questions)) return bad('questions');
  if (p.questions.length > QUIZ_MAX_QUESTIONS) return { message: 'too_many_questions', detail: '' };
  /** @type {Record<string, true>} */
  var seen = {};
  for (var i = 0; i < p.questions.length; i++) {
    var q = p.questions[i];
    var at = 'question ' + (i + 1) + ': ';
    if (!_plainObject(q)) return bad(at + 'an object');
    var allowed = ['id', 'kind', 'prompt', 'choices', 'multiple', 'points', 'tag_id', 'key'];
    var more = Object.keys(q).filter(function (x) {
      return allowed.indexOf(x) < 0;
    });
    if (more.length) return bad(at + more[0]);
    if (q.id != null) {
      if (typeof q.id !== 'string' || seen[q.id]) return bad(at + 'id');
      seen[q.id] = true;
    }
    if (['choice', 'true_false', 'number', 'text'].indexOf(q.kind) < 0) return bad(at + 'kind');
    var prompt = _quizText(q.prompt);
    if (typeof q.prompt !== 'string' || !prompt || prompt.length > QUIZ_PROMPT_MAX) return bad(at + 'prompt');
    if (q.multiple != null && !_quizBool(q.multiple)) return bad(at + 'multiple');
    if (q.multiple === true && q.kind !== 'choice') return bad(at + 'multiple');
    if (!_quizNum(q.points) || q.points < 0 || q.points > QUIZ_POINTS_MAX) return bad(at + 'points');
    if (!('tag_id' in q)) return bad(at + 'tag_id');
    if (q.tag_id !== null && (typeof q.tag_id !== 'string' || tagIds.indexOf(q.tag_id) < 0)) {
      return bad(at + 'tag_id');
    }
    /** @type {string[]} */
    var ids = [];
    if (q.kind === 'choice') {
      if (!Array.isArray(q.choices) || q.choices.length < QUIZ_CHOICES_MIN || q.choices.length > QUIZ_CHOICES_MAX) {
        return bad(at + 'choices');
      }
      for (var c = 0; c < q.choices.length; c++) {
        var ch = q.choices[c];
        if (!_plainObject(ch) || Object.keys(ch).length !== 2 || !('id' in ch) || !('text' in ch)) {
          return bad(at + 'choices');
        }
        var text = _quizText(ch.text);
        if (typeof ch.id !== 'string' || !_QUIZ_V4.test(ch.id) || ids.indexOf(ch.id) >= 0) return bad(at + 'choices');
        if (typeof ch.text !== 'string' || !text || text.length > QUIZ_CHOICE_MAX) return bad(at + 'choices');
        ids.push(ch.id);
      }
    } else if (q.choices != null) return bad(at + 'choices');
    var key = q.key;
    if (!_plainObject(key)) return bad(at + 'key');
    var keyMore = Object.keys(key).filter(function (x) {
      return ['answer', 'tolerance', 'why'].indexOf(x) < 0;
    });
    if (keyMore.length || !('answer' in key)) return bad(at + 'key');
    if (key.why != null && (typeof key.why !== 'string' || _quizText(key.why).length > QUIZ_WHY_MAX)) {
      return bad(at + 'why');
    }
    var tol = key.tolerance;
    if (q.kind === 'number') {
      if (!_quizNum(key.answer) || Math.abs(key.answer) > QUIZ_NUMBER_MAX) return bad(at + 'answer');
      if (tol != null && (!_quizNum(tol) || tol < 0 || tol > QUIZ_NUMBER_MAX)) return bad(at + 'tolerance');
    } else if (tol != null) return bad(at + 'tolerance');
    if (q.kind === 'true_false' && !_quizBool(key.answer)) return bad(at + 'answer');
    if (q.kind === 'text' && key.answer != null) return bad(at + 'answer');
    if (q.kind === 'choice') {
      var ans = key.answer;
      if (!Array.isArray(ans) || !ans.length || (!q.multiple && ans.length !== 1)) return bad(at + 'answer');
      var distinct = ans.filter(function (/** @type {unknown} */ a, /** @type {number} */ j) {
        return typeof a === 'string' && ids.indexOf(a) >= 0 && ans.indexOf(a) === j;
      });
      if (distinct.length !== ans.length) return bad(at + 'answer');
    }
  }
  return null;
}

/* ── Demo Mode's store ──────────────────────────────────────────────────── */

/** @param {string} cid */
function _quizDemoKey(cid) {
  return 'gb-quizzes-' + cid;
}
/** @param {string} cid */
function _quizKeysKey(cid) {
  return 'gb-quiz-keys-' + cid;
}
/** @param {string} cid @returns {{ seeded?: boolean, quizzes: Record<string, any> }} */
function _quizDemoLoad(cid) {
  var kept = _safeParseLS(_quizDemoKey(cid), null);
  if (!_plainObject(kept) || !_plainObject(kept.quizzes)) return { quizzes: {} };
  return kept;
}
/** @param {string} cid @returns {Record<string, QuizKey>} */
function _quizKeysLoad(cid) {
  var kept = _safeParseLS(_quizKeysKey(cid), null);
  return _plainObject(kept) ? kept : {};
}

/**
 * The quiz in the shape list_quiz answers, from Demo Mode's store.
 * @param {string} cid @param {string} aid @returns {QuizReply}
 */
function _quizDemoReply(cid, aid) {
  var one = _quizDemoLoad(cid).quizzes[aid];
  if (!one || !_plainObject(one.quiz)) return { quiz: null, questions: [], archived: [] };
  var keys = _quizKeysLoad(cid);
  var questions = (Array.isArray(one.questions) ? one.questions : []).map(
    function (/** @type {any} */ q, /** @type {number} */ i) {
      var key = keys[q.id] || { answer: null, tolerance: null, why: null };
      return Object.assign({}, JSON.parse(JSON.stringify(q)), {
        position: i + 1,
        answered: false,
        archived_at: null,
        key: { answer: key.answer, tolerance: key.tolerance == null ? null : key.tolerance, why: key.why || null },
      });
    },
  );
  return { quiz: Object.assign({ assessment_id: aid }, one.quiz), questions: questions, archived: [] };
}

/**
 * Demo Mode's save: refused as the server refuses; the questions in one key
 * and the answer key in another.
 * @param {string} cid @param {string} aid @param {any} payload @param {string[]} tagIds
 * @returns {{ ok: boolean, error?: { message: string, detail: string } }}
 */
function _quizDemoSave(cid, aid, payload, tagIds) {
  var store = _quizDemoLoad(cid);
  var keys = _quizKeysLoad(cid);
  var before = store.quizzes[aid];
  (before && Array.isArray(before.questions) ? before.questions : []).forEach(function (/** @type {any} */ q) {
    delete keys[q.id];
  });
  if (payload === null) {
    delete store.quizzes[aid];
  } else {
    var problem = quizPayloadProblem(payload, tagIds);
    if (problem) return { ok: false, error: problem };
    var settings = Object.assign({}, payload);
    delete settings.questions;
    store.quizzes[aid] = {
      quiz: Object.assign(settings, { updated_at: new Date().toISOString() }),
      questions: payload.questions.map(function (/** @type {any} */ q) {
        var id = typeof q.id === 'string' && q.id ? q.id : quizNewId();
        keys[id] = {
          answer: q.key.answer == null ? null : q.key.answer,
          tolerance: q.kind === 'number' && q.key.tolerance != null ? q.key.tolerance : null,
          why: _quizText(q.key.why) || null,
        };
        return {
          id: id,
          kind: q.kind,
          prompt: _quizText(q.prompt),
          choices:
            q.kind === 'choice'
              ? q.choices.map(function (/** @type {any} */ c) {
                  return { id: c.id, text: _quizText(c.text) };
                })
              : null,
          multiple: q.multiple === true,
          points: q.points,
          tag_id: q.tag_id,
        };
      }),
    };
  }
  _safeLSSet(_quizDemoKey(cid), JSON.stringify(store));
  _safeLSSet(_quizKeysKey(cid), JSON.stringify(keys));
  return { ok: true };
}

/**
 * Demo Mode's sample quiz (shared/seed-data.js): written once, never over a
 * class whose quizzes were written before. False when it was not written.
 * @param {string} cid @param {string} aid @param {any} payload @param {string[]} tagIds
 */
function saveDemoQuizSeed(cid, aid, payload, tagIds) {
  if (!_isDemoSession() || !cid || !aid) return false;
  var store = _quizDemoLoad(cid);
  if (store.seeded || Object.keys(store.quizzes).length) return false;
  if (!_quizDemoSave(cid, aid, payload, tagIds).ok) return false;
  var after = _quizDemoLoad(cid);
  after.seeded = true;
  _safeLSSet(_quizDemoKey(cid), JSON.stringify(after));
  return true;
}

/* ── A save not yet answered ────────────────────────────────────────────── */

/** @param {string} cid */
function _quizUnsentKey(cid) {
  return 'gb-quiz-unsent-' + cid;
}
/** @param {string} cid @returns {Record<string, { aid: string, payload: any, message: string, at: string }>} */
function _quizUnsentLoad(cid) {
  var kept = _safeParseLS(_quizUnsentKey(cid), null);
  return _plainObject(kept) ? kept : {};
}
/** @param {string} cid @param {Record<string, any>} all */
function _quizUnsentSave(cid, all) {
  if (!Object.keys(all).length) {
    try {
      localStorage.removeItem(_quizUnsentKey(cid));
    } catch (e) {
      /* nothing kept */
    }
  } else _safeLSSet(_quizUnsentKey(cid), JSON.stringify(all));
}
/**
 * The newest save of this assessment's quiz not yet accepted by the server:
 * { payload, message } (message: why it was refused, or '' while it waits), or
 * null. A save made while the assessment had a local id is found by its
 * server id once the create has landed.
 * @param {string} cid @param {string} aid
 */
function quizUnsent(cid, aid) {
  var all = _quizUnsentLoad(cid);
  /** @type {{ aid: string, payload: any, message: string, at: string } | null} */
  var best = null;
  var keys = Object.keys(all);
  for (var i = 0; i < keys.length; i++) {
    var e = all[keys[i]];
    if (!e) continue;
    var same = e.aid === aid || _resolveKnownId('assessment', e.aid) === aid;
    if (same && (!best || String(e.at) > String(best.at))) best = e;
  }
  return best ? { payload: best.payload, message: best.message || '' } : null;
}

/* ── Reading and saving ─────────────────────────────────────────────────── */

/**
 * The quiz of one assessment as the last read answered it, or null when it
 * has not been read on this page. Demo Mode answers from its store at once.
 * @param {string} cid @param {string} aid @returns {QuizReply | null}
 */
function getQuiz(cid, aid) {
  if (!cid || !aid) return null;
  if (_quizOnDevice(cid)) return _quizDemoReply(cid, aid);
  var held = _quizHeld[aid];
  return held ? JSON.parse(JSON.stringify(held)) : null;
}

/**
 * Read one assessment's quiz (list_quiz). A Promise of the reply, or null
 * when it could not be read. An assessment with a local id has no quiz on the
 * server yet: { quiz: null }.
 * @param {string} cid @param {string} aid @returns {Promise<QuizReply | null>}
 */
function loadQuiz(cid, aid) {
  if (!cid || !aid) return Promise.resolve(null);
  if (_quizOnDevice(cid)) return Promise.resolve(_quizDemoReply(cid, aid));
  if (!quizzesOffered(cid)) return Promise.resolve(null);
  var id = _resolveKnownId('assessment', aid);
  if (!_isUuid(id)) return Promise.resolve({ quiz: null, questions: [], archived: [] });
  return Promise.resolve()
    .then(function () {
      // @ts-expect-error list_quiz is not in types/database.d.ts until MQ1 is applied and the types are regenerated.
      return _callRpcWithAuthGuard('list_quiz', { p_assessment_id: id }, _QUIZ_QUIET);
    })
    .then(function (res) {
      if (res && res.error) {
        if (!res.error.handledSessionExpired) console.warn('list_quiz failed:', res.error);
        return null;
      }
      var data = _rpcObject(res && res.data);
      if (!data || !Array.isArray(data.questions)) return null;
      var reply = /** @type {QuizReply} */ ({
        quiz: _plainObject(data.quiz) ? data.quiz : null,
        questions: data.questions,
        archived: Array.isArray(data.archived) ? data.archived : [],
      });
      _quizHeld[aid] = reply;
      if (id !== aid) _quizHeld[id] = reply;
      return JSON.parse(JSON.stringify(reply));
    })
    .then(null, function (e) {
      console.warn('list_quiz failed:', e);
      return null;
    });
}

/**
 * The plain sentence the teacher sees for a refused save_quiz or list_quiz.
 * Matched on the contract's exact words (its "Refusals" table); anything
 * else gets QUIZ_GENERAL. detail may name a question by its place.
 * @param {any} error
 */
function quizRefusalText(error) {
  var code = error && error.code ? String(error.code) : '';
  var text = error && error.message ? String(error.message).trim() : '';
  var detail = error && (error.detail || error.details) ? String(error.detail || error.details) : '';
  var place = /question (\d+)/i.exec(detail);
  if (code === 'PT401' || text === 'not authenticated')
    return 'You were signed out. Sign in again, then save the quiz.';
  if (text === 'not found') return 'This assessment is no longer there, so its quiz could not be saved.';
  var said = QUIZ_REFUSALS[text];
  if (said)
    return text === 'bad_quiz' && place ? 'Question ' + place[1] + ' could not be saved as written. ' + said : said;
  return QUIZ_GENERAL;
}
var QUIZ_GENERAL = 'This quiz was not saved. Your questions are kept here; save again to send them.';
/** @type {Record<string, string>} */
var QUIZ_REFUSALS = {
  bad_quiz: 'Check its words, choices, right answer and points, then save again.',
  not_offered: 'A quiz cannot go on a pair or group assessment, or on a DIBELS one.',
  too_many_questions: 'A quiz can have up to 100 questions.',
  kind_locked: 'Students have answered a question here, so its type and Multiple Answers cannot change.',
  choices_locked:
    'Students have answered a question here, so its choices can be reworded or reordered but not added or removed.',
  has_tries: 'Students have started this quiz, so it cannot be turned off.',
};

/**
 * Save one assessment's quiz whole (save_quiz). payload: p_quiz as the
 * contract sets it, or null to take the quiz off the piece. tagIds: the
 * piece's competencies as saved with it. Answers { ok } at once; Demo Mode
 * answers with the server's refusal word when it refuses.
 * @param {string} cid @param {string} aid @param {any} payload @param {string[]} tagIds
 * @returns {{ ok: boolean, error?: { message: string, detail: string } }}
 */
function saveQuiz(cid, aid, payload, tagIds) {
  if (!cid || !aid) return { ok: false };
  if (_quizOnDevice(cid)) return _quizDemoSave(cid, aid, payload, tagIds || []);
  if (!quizzesOffered(cid)) return { ok: false };
  var wire = payload === null ? null : _quizWire(payload);
  var key = _newEntryId();
  var held = _quizUnsentLoad(cid);
  held[key] = { aid: aid, payload: payload, message: '', at: new Date().toISOString() };
  _quizUnsentSave(cid, held);
  var params = { p_assessment_id: aid, p_quiz: wire, p_idempotency_key: key };
  var id = _resolveKnownId('assessment', aid);
  // A local id with no create waiting for it would reach the server as it is: it is held here instead.
  if (!_isUuid(id) && !_pendingCreateFor('assessment', aid)) {
    console.warn('save_quiz not sent: the assessment has no server id yet (' + aid + ')');
    return { ok: true };
  }
  _trackPendingSync(
    Promise.resolve(_writeRpc('save_quiz', params, { entryId: key })).then(function (res) {
      var all = _quizUnsentLoad(cid);
      if (res && res.error) {
        if (res.error.handledSessionExpired) return;
        if (_isMissingRpcError(res.error)) _reportMissingRpc('save_quiz', res.error);
        else console.warn('save_quiz failed:', res.error);
        if (all[key]) {
          all[key].message = quizRefusalText(res.error);
          _quizUnsentSave(cid, all);
        }
        return;
      }
      // This save landed: it and every older one for the same piece go.
      var at = all[key] ? all[key].at : '';
      Object.keys(all).forEach(function (k) {
        var e = all[k];
        var same = e && (e.aid === aid || _resolveKnownId('assessment', e.aid) === _resolveKnownId('assessment', aid));
        if (same && String(e.at) <= String(at)) delete all[k];
      });
      _quizUnsentSave(cid, all);
      var data = _rpcObject(res && res.data);
      if (data && Array.isArray(data.questions)) {
        var reply = {
          quiz: _plainObject(data.quiz) ? data.quiz : null,
          questions: data.questions,
          archived: data.archived || [],
        };
        _quizHeld[aid] = reply;
        _quizHeld[_resolveKnownId('assessment', aid)] = reply;
      }
    }),
  );
  return { ok: true };
}

/* Tags named inside p_quiz are not re-keyed by the outbox: a competency
   still waiting for its server id counts toward none until it has one. */
/** @param {any} payload */
function _quizWire(payload) {
  var out = JSON.parse(JSON.stringify(payload));
  out.questions.forEach(function (/** @type {any} */ q) {
    if (q.tag_id == null) return;
    var tag = _resolveKnownId('tag', q.tag_id);
    q.tag_id = _isUuid(tag) ? tag : null;
  });
  return out;
}

if (typeof window !== 'undefined') {
  /** @type {any} */ (window).QuizData = {
    offered: quizzesOffered,
    probe: probeQuizzes,
    get: getQuiz,
    load: loadQuiz,
    save: saveQuiz,
    unsent: quizUnsent,
    defaults: quizDefaults,
    problem: quizPayloadProblem,
    refusalText: quizRefusalText,
    newId: quizNewId,
    LIMITS: {
      questions: QUIZ_MAX_QUESTIONS,
      prompt: QUIZ_PROMPT_MAX,
      choice: QUIZ_CHOICE_MAX,
      choicesMin: QUIZ_CHOICES_MIN,
      choicesMax: QUIZ_CHOICES_MAX,
      why: QUIZ_WHY_MAX,
      points: QUIZ_POINTS_MAX,
      number: QUIZ_NUMBER_MAX,
    },
  };
}
