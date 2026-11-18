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
/** @type {Record<string, Promise<void>>} */
var _quizChain = {}; // aid → this page's save of it still on its way
/** @type {Record<string, string | null>} */
var _quizAnswered = {}; // aid → the updated_at this page's last save of it was answered

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

/* White space the server trims from both ends of a prompt, a choice, a "why"
   line and a note: ASCII only (space, tab, newline, carriage return, form
   feed, vertical tab). A no-break space is kept, as there. */
var _QUIZ_TRIM = /^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$/g;
/** @param {unknown} v */
function quizTrim(v) {
  return typeof v === 'string' ? v.replace(_QUIZ_TRIM, '') : '';
}
/** @param {unknown} v */
function _quizText(v) {
  return quizTrim(v);
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
  if (!_plainObject(p)) return bad('The quiz must have exactly its settings, updated_at and questions.');
  var keys = [
    'updated_at',
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
  if (extra.length) return bad('The quiz must have exactly its settings, updated_at and questions.');
  for (var k = 0; k < keys.length; k++) {
    if (!(keys[k] in p)) return bad('The quiz must have exactly its settings, updated_at and questions.');
  }
  if (p.updated_at !== null && typeof p.updated_at !== 'string') {
    return bad("updated_at must be the quiz's updated_at as last read, or null for a new quiz.");
  }
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
    var at = 'Question ' + (i + 1) + ': ';
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
 * @returns {{ ok: boolean, error?: { message: string, detail: string, code?: string }, quiz?: QuizReply }}
 */
function _quizDemoSave(cid, aid, payload, tagIds) {
  var store = _quizDemoLoad(cid);
  var keys = _quizKeysLoad(cid);
  var before = store.quizzes[aid];
  (before && Array.isArray(before.questions) ? before.questions : []).forEach(function (/** @type {any} */ q) {
    delete keys[q.id];
  });
  var storedAt = before && before.quiz ? before.quiz.updated_at || null : null;
  if (payload === null) {
    delete store.quizzes[aid];
  } else {
    var problem = quizPayloadProblem(payload, tagIds);
    if (problem) return { ok: false, error: problem };
    // Saved in another tab since this one read it: refused, and the teacher's questions kept.
    if (payload.updated_at !== storedAt) {
      var stale = { code: '22023', message: 'stale', detail: QUIZ_STALE_DETAIL };
      _quizKeepUnsent(cid, aid, payload, stale);
      return { ok: false, error: stale };
    }
    var settings = Object.assign({}, payload);
    delete settings.questions;
    store.quizzes[aid] = {
      quiz: Object.assign(settings, { updated_at: _quizNextStamp(storedAt) }),
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
  quizDropUnsent(cid, aid);
  return { ok: true, quiz: _quizDemoReply(cid, aid) };
}

/* A new updated_at, never the one before it (two saves in one millisecond). */
/** @param {string | null} before */
function _quizNextStamp(before) {
  var now = new Date().toISOString();
  if (before && now <= before) now = new Date(Date.parse(before) + 1).toISOString();
  return now;
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
  if (!_quizDemoSave(cid, aid, Object.assign({}, payload, { updated_at: null }), tagIds).ok) return false;
  var after = _quizDemoLoad(cid);
  after.seeded = true;
  _safeLSSet(_quizDemoKey(cid), JSON.stringify(after));
  return true;
}

/* ── A save not yet answered ────────────────────────────────────────────── */

/* Each save of a quiz is kept on this device under its own idempotency key
   (which is also its outbox entry's id) until the server has answered it,
   with the updated_at it was based on (its payload's). The outbox's own
   answer clears it (_quizListen), whichever page load sends it. */

/** @param {string} cid */
function _quizUnsentKey(cid) {
  return 'gb-quiz-unsent-' + cid;
}
/** @typedef {{ aid: string, payload: any, message: string, at: string, stale?: boolean, held?: boolean }} QuizUnsent */
/** @param {string} cid @returns {Record<string, QuizUnsent>} */
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
/** @param {QuizUnsent} e @param {string} aid */
function _quizSamePiece(e, aid) {
  return !!e && (e.aid === aid || _resolveKnownId('assessment', e.aid) === _resolveKnownId('assessment', aid));
}
/* The outbox's dead letter for a save, or null. */
/** @param {string} id */
function _quizDeadFor(id) {
  var q = typeof window !== 'undefined' ? /** @type {any} */ (window).v2Queue : null;
  if (!q || typeof q.deadLetter !== 'function') return null;
  return (
    q.deadLetter().find(function (/** @type {any} */ e) {
      return e && e.id === id;
    }) || null
  );
}
/* Whether the outbox still holds a save: null when there is no outbox to ask. */
/** @param {string} id */
function _quizQueued(id) {
  var q = typeof window !== 'undefined' ? /** @type {any} */ (window).v2Queue : null;
  return q && typeof q.has === 'function' ? !!q.has(id) : null;
}

/**
 * The newest save of this assessment's quiz this device still holds, as the
 * form must show it, or null:
 * { payload, message, stale, waiting }. waiting: not answered yet (in the
 * outbox, or held here). A save the outbox no longer holds and did not refuse
 * was answered: it is let go here. serverAt: the updated_at the server
 * answered just now (undefined when it could not be read). A save based on
 * another updated_at is stale: it would be refused, and it is never sent
 * with an updated_at it was not based on.
 * @param {string} cid @param {string} aid @param {string | null} [serverAt]
 */
function quizUnsent(cid, aid, serverAt) {
  _quizListen();
  var all = _quizUnsentLoad(cid);
  var n = Object.keys(all).length;
  /** @type {QuizUnsent | null} */
  var best = null;
  var bestKey = '';
  var keys = Object.keys(all);
  for (var i = 0; i < keys.length; i++) {
    var e = all[keys[i]];
    if (!e || !_quizSamePiece(e, aid)) continue;
    // The outbox sent it and the server answered it: nothing is kept.
    if (!e.message && !e.held && _quizQueued(keys[i]) === false) {
      var dead = _quizDeadFor(keys[i]);
      if (!dead) {
        delete all[keys[i]];
        continue;
      }
      e.message = quizRefusalText(dead.last_error || dead.error || {});
      e.stale = _quizIsStale(dead.last_error || dead.error || {});
    }
    if (!best || String(e.at) > String(best.at)) {
      best = e;
      bestKey = keys[i];
    }
  }
  if (Object.keys(all).length !== n || best) _quizUnsentSave(cid, all);
  if (!best) return null;
  var waiting = !best.message && (best.held === true || _quizQueued(bestKey) !== false);
  var stale = best.stale === true;
  var message = best.message || '';
  if (!stale && best.payload !== null && serverAt !== undefined && best.payload.updated_at !== serverAt) {
    stale = true;
    message = QUIZ_STALE;
  }
  return { payload: best.payload, message: message, stale: stale, waiting: waiting && !stale };
}

/**
 * Forget what this device kept of an assessment's quiz, and take any save of
 * it still waiting out of the outbox: the teacher chose Keep Mine or Use the
 * Other One, the server refused it, or the piece was deleted.
 * @param {string} cid @param {string} aid
 */
function quizDropUnsent(cid, aid) {
  var all = _quizUnsentLoad(cid);
  var n = Object.keys(all).length;
  var q = typeof window !== 'undefined' ? /** @type {any} */ (window).v2Queue : null;
  Object.keys(all).forEach(function (k) {
    if (!_quizSamePiece(all[k], aid)) return;
    if (q && typeof q.has === 'function' && q.has(k) && typeof q.remove === 'function') q.remove(k);
    delete all[k];
  });
  if (Object.keys(all).length !== n) _quizUnsentSave(cid, all);
}

/* A refused save kept for the next time the form opens. */
/** @param {string} cid @param {string} aid @param {any} payload @param {any} error */
function _quizKeepUnsent(cid, aid, payload, error) {
  var all = _quizUnsentLoad(cid);
  all[_newEntryId()] = {
    aid: aid,
    payload: payload,
    message: quizRefusalText(error),
    at: new Date().toISOString(),
    stale: _quizIsStale(error),
  };
  _quizUnsentSave(cid, all);
}

/** @param {any} error */
function _quizIsStale(error) {
  return !!error && String(error.code || '') === '22023' && String(error.message || '').trim() === 'stale';
}

/* Every class's kept saves, to find one by its key. */
/** @param {string} id @returns {{ cid: string, all: Record<string, QuizUnsent> } | null} */
function _quizUnsentFind(id) {
  var prefix = 'gb-quiz-unsent-';
  for (var i = 0; i < localStorage.length; i++) {
    var k = localStorage.key(i);
    if (!k || k.indexOf(prefix) !== 0) continue;
    var cid = k.slice(prefix.length);
    var all = _quizUnsentLoad(cid);
    if (all[id]) return { cid: cid, all: all };
  }
  return null;
}

/* The outbox's answer to a save, whichever page load sent it. */
var _quizListening = null;
function _quizListen() {
  var q = typeof window !== 'undefined' ? /** @type {any} */ (window).v2Queue : null;
  if (!q || typeof q.subscribe !== 'function' || _quizListening === q) return;
  _quizListening = q;
  q.subscribe(function (/** @type {any} */ evt) {
    var kind = evt && evt.kind;
    var info = evt && evt.meta;
    if (!info || info.endpoint !== 'save_quiz') {
      if (kind === 'flush:success' || kind === 'rewrite') _quizTagsMoved();
      return;
    }
    if (kind === 'flush:success') _quizLanded(info.id, info.payload, info.data);
    else if (kind === 'flush:dead-letter') _quizRefused(info.id, info.error);
  });
}

/** @param {string} id @param {any} params @param {any} answer */
function _quizLanded(id, params, answer) {
  var found = _quizUnsentFind(id);
  var aid = params && params.p_assessment_id;
  if (found) {
    var kept = found.all;
    var mine = kept[id];
    Object.keys(kept).forEach(function (k) {
      var e = kept[k];
      if (_quizSamePiece(e, mine.aid) && String(e.at) <= String(mine.at) && !e.held) delete kept[k];
    });
    _quizUnsentSave(found.cid, kept);
  }
  var data = _rpcObject(answer);
  if (aid && data && Array.isArray(data.questions)) {
    var reply = {
      quiz: _plainObject(data.quiz) ? data.quiz : null,
      questions: data.questions,
      archived: data.archived || [],
    };
    _quizHeld[aid] = reply;
    // Kept exactly as answered: never read into a Date.
    _quizAnswered[aid] = reply.quiz ? reply.quiz.updated_at || null : null;
  }
}

/** @param {string} id @param {any} error */
function _quizRefused(id, error) {
  var found = _quizUnsentFind(id);
  if (!found) return;
  found.all[id].message = quizRefusalText(error || {});
  found.all[id].stale = _quizIsStale(error);
  _quizUnsentSave(found.cid, found.all);
}

/* ── Competencies still waiting for their server id ── */

/** @type {(() => void)[]} */
var _quizTagWaiters = [];
function _quizTagsMoved() {
  var waiting = _quizTagWaiters.splice(0);
  waiting.forEach(function (go) {
    go();
  });
}
/* The payload's competencies as the server knows them, or null while one still has an id made on this device. */
/** @param {any} payload */
function _quizWire(payload) {
  var out = JSON.parse(JSON.stringify(payload));
  var ready = true;
  out.questions.forEach(function (/** @type {any} */ q) {
    if (q.tag_id == null) return;
    var tag = _resolveKnownId('tag', q.tag_id);
    if (_isUuid(tag)) q.tag_id = tag;
    else ready = false;
  });
  return ready ? out : null;
}
/* Resolves with the wire payload once every competency it names has a server id. */
/** @param {any} payload @returns {Promise<any>} */
function _quizWhenTagsReady(payload) {
  return new Promise(function (resolve) {
    var check = function () {
      var wire = _quizWire(payload);
      if (wire) resolve(wire);
      else _quizTagWaiters.push(check);
    };
    check();
  });
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
 * The plain sentence the teacher sees for a refused save_quiz or list_quiz,
 * matched on the code and the word of the contract's one refusal table
 * ("Teacher functions"). A detail that names a question ("Question 3: …",
 * "Question 3 has answers, …") gives its number. Anything else gets
 * QUIZ_GENERAL; the server's own words are never shown.
 * @param {any} error
 */
function quizRefusalText(error) {
  var code = error && error.code ? String(error.code) : '';
  var text = error && error.message ? String(error.message).trim() : '';
  var detail = error && (error.detail || error.details) ? String(error.detail || error.details) : '';
  var place = /^Question (\d+)\b/.exec(detail);
  var n = place ? place[1] : '';
  if (code === 'PT401' && text === 'not authenticated')
    return 'You were signed out. Sign in again, then save the quiz.';
  if (code === 'P0002' && text === 'not found')
    return 'This assessment is no longer there, so its quiz could not be saved.';
  if (code !== '22023') return QUIZ_GENERAL;
  switch (text) {
    case 'stale':
      return QUIZ_STALE;
    case 'bad_quiz':
      return n
        ? 'Question ' +
            n +
            ' could not be saved as written. Check its words, choices, right answer and points, then save again.'
        : "This quiz's settings could not be saved as they are. Check them, then save again.";
    case 'kind_locked':
      return (
        (n ? 'Students have answered Question ' + n : 'Students have answered a question here') +
        ', so its type and Multiple Answers cannot change.'
      );
    case 'choices_locked':
      return (
        (n ? 'Students have answered Question ' + n : 'Students have answered a question here') +
        ', so its choices can be reworded or reordered but not added or removed.'
      );
    case 'has_tries':
      return 'A student has started this quiz, so it cannot be turned off.';
    case 'not_offered':
      return 'A quiz cannot go on a pair or group assessment, or on a DIBELS one.';
    case 'too_many_questions':
      return 'A quiz can have up to 100 questions.';
  }
  return QUIZ_GENERAL;
}
var QUIZ_GENERAL = 'This quiz was not saved. Your questions are kept here; save again to send them.';
var QUIZ_STALE =
  'This quiz was changed somewhere else, in another tab or on another device, so your changes below were not saved.';
var QUIZ_STALE_DETAIL = 'This quiz was changed somewhere else. Open it again before saving.';

/**
 * Save one assessment's quiz whole (save_quiz). payload: p_quiz as the
 * contract sets it, or null to take the quiz off the piece. tagIds: the
 * piece's competencies as saved with it. Answers { ok } at once; Demo Mode
 * answers with the server's refusal word when it refuses, and the quiz as
 * saved when it does not.
 *
 * Signed in, the save goes through the outbox keyed to the assessment
 * ('id:' + aid), so it goes after the form's own save of the piece, and
 * waits behind the piece's create (a local id) and behind any competency it
 * names that has no server id yet. One new idempotency key per save; a retry
 * of that save reuses it.
 * @param {string} cid @param {string} aid @param {any} payload @param {string[]} tagIds
 * @returns {{ ok: boolean, error?: { message: string, detail: string, code?: string }, quiz?: QuizReply }}
 */
function saveQuiz(cid, aid, payload, tagIds) {
  if (!cid || !aid) return { ok: false };
  if (_quizOnDevice(cid)) return _quizDemoSave(cid, aid, payload, tagIds || []);
  if (!quizzesOffered(cid)) return { ok: false };
  _quizListen();
  var key = _newEntryId();
  var all = _quizUnsentLoad(cid);
  all[key] = { aid: aid, payload: payload, message: '', at: new Date().toISOString(), held: true };
  _quizUnsentSave(cid, all);
  var id = _resolveKnownId('assessment', aid);
  // A local id with no create waiting for it would reach the server as it is: it is held here instead.
  if (!_isUuid(id) && !_pendingCreateFor('assessment', aid)) {
    console.warn('save_quiz not sent: the assessment has no server id yet (' + aid + ')');
    return { ok: true };
  }
  // A save made while this page's last save of the piece was still on its way
  // goes after it, with the updated_at that save answered (the form it was
  // made on already held that save's questions).
  var chain = _quizChain[aid];
  var after = !!chain;
  var done = Promise.resolve(chain)
    .then(function () {
      return payload === null ? null : _quizWhenTagsReady(payload);
    })
    .then(function (wire) {
      if (wire && after && _quizAnswered[aid] !== undefined) wire.updated_at = _quizAnswered[aid];
      var kept = _quizUnsentLoad(cid);
      if (!kept[key]) return null; // let go meanwhile (Use the Other One, Keep Mine)
      delete kept[key].held;
      _quizUnsentSave(cid, kept);
      return _writeRpc(
        'save_quiz',
        { p_assessment_id: aid, p_quiz: wire, p_idempotency_key: key },
        { entryId: key, key: 'id:' + aid },
      );
    })
    .then(function (res) {
      if (!res) return;
      if (res.error) {
        if (res.error.handledSessionExpired) return;
        if (_isMissingRpcError(res.error)) _reportMissingRpc('save_quiz', res.error);
        else console.warn('save_quiz failed:', res.error);
        // Without an outbox (or before it said so) the refusal is kept here too.
        _quizRefused(key, res.error);
        // Changed somewhere else: read what the server has, for the teacher to choose. Never sent again by itself.
        if (_quizIsStale(res.error)) return loadQuiz(cid, aid);
        return;
      }
      _quizLanded(key, { p_assessment_id: aid }, res.data);
      _quizHeld[_resolveKnownId('assessment', aid)] = _quizHeld[aid];
    })
    .then(null, function (e) {
      console.warn('save_quiz failed:', e);
    })
    .then(function () {
      if (_quizChain[aid] === done) delete _quizChain[aid];
    });
  _quizChain[aid] = done;
  _trackPendingSync(done);
  return { ok: true };
}

/**
 * Whether this device knows the class's scores and its students' work, so
 * "no scores and no work on this piece" can be trusted: Demo Mode keeps both
 * here; signed in, the class's copy came from (or was confirmed by) the
 * server this session and, where its work is the server's, the work has been
 * read at least once. Fails closed: after a failed load, not known.
 * @param {string} cid
 */
function quizFactsKnown(cid) {
  if (!cid) return false;
  if (_isDemoSession()) return true;
  // Loaded is not enough: a failed load keeps this device's saved copy and still counts as loaded
  // (isClassLoaded). Only a copy the server confirmed or replaced this session
  // (_classFresh, shared/data.js) tells that a piece has no scores.
  if (typeof isClassLoaded !== 'function' || !isClassLoaded(cid)) return false;
  if (typeof _classFresh === 'undefined' || _classFresh[cid] !== true) return false;
  if (typeof _workOnServer === 'function' && _workOnServer(cid)) {
    return !!(typeof _workRead !== 'undefined' && _workRead[cid] && _workRead[cid].at);
  }
  return true;
}

/**
 * Ask for what quizFactsKnown waits on: the class's load and its work's read.
 * A Promise that resolves (never rejects) once both have answered.
 * @param {string} cid @returns {Promise<boolean>}
 */
function quizLoadFacts(cid) {
  var loads = [];
  if (typeof loadClass === 'function') loads.push(Promise.resolve(loadClass(cid)));
  if (typeof refreshStudentWork === 'function') loads.push(Promise.resolve(refreshStudentWork(cid, { anyway: true })));
  return Promise.all(loads).then(
    function () {
      return quizFactsKnown(cid);
    },
    function () {
      return quizFactsKnown(cid);
    },
  );
}

/**
 * An assessment deleted: in Demo Mode its quiz and answer key go with it; on
 * any device, what was kept of an unsent save. (Signed in, the server takes
 * the quiz with the assessment.)
 * @param {string} cid @param {string} aid
 */
function forgetQuiz(cid, aid) {
  if (!cid || !aid) return;
  quizDropUnsent(cid, aid);
  if (!_isDemoSession()) return;
  var store = _quizDemoLoad(cid);
  var one = store.quizzes[aid];
  if (!one) return;
  var keys = _quizKeysLoad(cid);
  (Array.isArray(one.questions) ? one.questions : []).forEach(function (/** @type {any} */ q) {
    delete keys[q.id];
  });
  delete store.quizzes[aid];
  _safeLSSet(_quizDemoKey(cid), JSON.stringify(store));
  _safeLSSet(_quizKeysKey(cid), JSON.stringify(keys));
}

if (typeof window !== 'undefined') {
  /** @type {any} */ (window).QuizData = {
    offered: quizzesOffered,
    probe: probeQuizzes,
    get: getQuiz,
    load: loadQuiz,
    save: saveQuiz,
    forget: forgetQuiz,
    factsKnown: quizFactsKnown,
    loadFacts: quizLoadFacts,
    unsent: quizUnsent,
    dropUnsent: quizDropUnsent,
    trim: quizTrim,
    defaults: quizDefaults,
    problem: quizPayloadProblem,
    refusalText: quizRefusalText,
    newId: quizNewId,
    STALE: QUIZ_STALE,
    NOT_SAVED_YET: 'These questions are kept on this computer and are not saved yet.',
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
