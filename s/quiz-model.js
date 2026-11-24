// @ts-check
/* A quiz on the student's page: the model (docs/plans/quizzes-plan.md, slice
   Q3b; the contract is migrations/local-test/quizzes-contract.md, "The
   student's side (MQ2)"). No page, no network and no clock of its own here:
   s/quiz.js asks the routes, s/quiz-view.js draws, and this file knows what a
   reply means, what an answer is, what is left, and how answers are saved.

   A model is the `quiz` route's answer read key by key; anything else in a
   reply is left where it is. The questions are in the student's own order
   (the server made it once and keeps it) and are never reordered here. The
   answer key is not on the device: a reply holds no hint of it, and nothing
   here asks for one.

   Saving (createSaver): each answer is saved as it changes, one `quiz-save`
   per question at a time, the latest value winning, after a short pause so a
   box being typed in is not saved on every key. A save that does not land
   (no connection, a busy server) is kept and sent again, quietly, and
   when the browser says it is online; what is waiting is also kept in this
   tab's sessionStorage, under the student's enrolment and the piece, so a
   page opened again finds it. Everything kept goes at every sign-out
   (wipeKept). Nothing is shown about a save that is waiting except the one
   quiet line the screen draws from `status`. */
var StudentQuizModel = (function () {
  'use strict';

  var KINDS = { choice: 1, true_false: 1, number: 1, text: 1 };
  var NUMBER_MAX = 1e12;
  var TEXT_MAX = 5000;
  var CHOICES_MAX = 20;
  var KEPT = 'fv-s-quiz-';
  // The server says these on a save: the quiz stopped taking answers (sent here or elsewhere, closed).
  var STOPS = { sent: 1, quiz_closed: 1, no_tries_left: 1 };
  var SESSION_OVER = { signed_out: 1, card_stopped: 1, card_expired: 1, closed: 1 };

  /** @param {unknown} v @returns {string} */
  function str(v) {
    return typeof v === 'string' ? v : '';
  }
  /** @param {any} map @param {unknown} key */
  function has(map, key) {
    return typeof key === 'string' && Object.prototype.hasOwnProperty.call(map, key);
  }
  /** @param {unknown} n */
  function whole(n) {
    return typeof n === 'number' && isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  }

  /* ── A reply ─────────────────────────────────────────────── */

  /** @param {any} raw @returns {{ id: string, number: number, kind: string, prompt: string, points: number, multiple: boolean, choices: { id: string, text: string }[] | null } | null} */
  function questionFrom(raw) {
    if (!raw || typeof raw !== 'object' || !str(raw.id) || !has(KINDS, raw.kind) || !str(raw.prompt).trim())
      return null;
    var choices = null;
    if (raw.kind === 'choice') {
      var list = (Array.isArray(raw.choices) ? raw.choices : [])
        .filter(function (/** @type {any} */ c) {
          return c && str(c.id) && typeof c.text === 'string';
        })
        .map(function (/** @type {any} */ c) {
          return { id: String(c.id), text: String(c.text) };
        })
        .slice(0, CHOICES_MAX);
      if (list.length < 2) return null;
      choices = list;
    }
    return {
      id: String(raw.id),
      number: whole(raw.number),
      kind: String(raw.kind),
      prompt: String(raw.prompt),
      points: whole(raw.points),
      multiple: raw.kind === 'choice' && raw.multiple === true,
      choices: choices,
    };
  }

  /** @param {unknown} v @param {any} q */
  function answerKept(q, v) {
    if (q.kind === 'choice') {
      if (!Array.isArray(v)) return undefined;
      var ids = (q.choices || []).map(function (/** @type {any} */ c) {
        return c.id;
      });
      var keep = v.filter(function (x, i) {
        return typeof x === 'string' && ids.indexOf(x) >= 0 && v.indexOf(x) === i;
      });
      return keep.length ? keep : undefined;
    }
    if (q.kind === 'true_false') return typeof v === 'boolean' ? v : undefined;
    if (q.kind === 'number') return typeof v === 'number' && isFinite(v) ? v : undefined;
    if (q.kind === 'text') return typeof v === 'string' && v.trim() !== '' ? v : undefined;
    return undefined;
  }

  /**
   * The `quiz` route's answer, or null when it is not one this screen can draw (it says what the
   * contract says, with every question one the page knows how to draw).
   * @param {any} res
   */
  function fromReply(res) {
    if (!res || res.ok !== true || !Array.isArray(res.questions)) return null;
    var questions = [];
    for (var i = 0; i < res.questions.length; i++) {
      var q = questionFrom(res.questions[i]);
      if (!q) return null;
      questions.push(q);
    }
    var quiz = res.quiz && typeof res.quiz === 'object' ? res.quiz : {};
    var t = res.try && typeof res.try === 'object' ? res.try : null;
    var given = res.answers && typeof res.answers === 'object' && !Array.isArray(res.answers) ? res.answers : {};
    /** @type {Record<string, any>} */
    var answers = {};
    questions.forEach(function (q) {
      var kept = has(given, q.id) ? answerKept(q, given[q.id]) : undefined;
      if (kept !== undefined) answers[q.id] = kept;
    });
    return {
      tries: whole(quiz.tries),
      triesLeft: typeof quiz.tries_left === 'number' && isFinite(quiz.tries_left) ? whole(quiz.tries_left) : null,
      closed: quiz.closed === true,
      closesOn: str(quiz.closes_on).slice(0, 10),
      tryNumber: t ? whole(t.number) : 0,
      sent: !!t && t.sent === true,
      sentAt: t ? str(t.sent_at) : '',
      startedAt: t ? str(t.started_at) : '',
      reopened: !!t && t.reopened === true,
      sentTries: whole(res.sent_tries),
      canAnswer: res.can_answer === true && !!t && t.sent !== true,
      canTryAgain: res.can_try_again === true,
      questions: questions,
      answers: answers,
    };
  }

  /* ── What is answered, what is left ──────────────────────── */

  /** @param {any} q @param {unknown} a */
  function isAnswered(q, a) {
    return answerKept(q, a) !== undefined;
  }

  /**
   * @param {{ questions: any[] }} m
   * @param {Record<string, any>} answers
   * @returns {{ total: number, done: number, left: number, next: number, unanswered: number[] }}
   */
  function counts(m, answers) {
    /** @type {number[]} */
    var unanswered = [];
    m.questions.forEach(function (q, i) {
      if (!isAnswered(q, answers[q.id])) unanswered.push(i + 1);
    });
    return {
      total: m.questions.length,
      done: m.questions.length - unanswered.length,
      left: unanswered.length,
      next: unanswered.length ? unanswered[0] : 0,
      unanswered: unanswered,
    };
  }

  /* ── What a press or a key makes of an answer ────────────── */

  /**
   * A number as typed: nothing (cleared), a number, or not a number. A comma is a decimal comma
   * when it is the only one ("3,5").
   * @param {string} text
   * @returns {{ ok: true, value: number | null } | { ok: false }}
   */
  function parseNumber(text) {
    var t = String(text == null ? '' : text).trim();
    if (t === '') return { ok: true, value: null };
    if (/^[-+]?\d+,\d+$/.test(t)) t = t.replace(',', '.');
    if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) return { ok: false };
    var n = Number(t);
    return isFinite(n) && Math.abs(n) <= NUMBER_MAX ? { ok: true, value: n } : { ok: false };
  }

  /** A text answer as it is saved: white space trimmed at both ends, nothing when that is empty. @param {string} s @returns {string | null} */
  function textValue(s) {
    var t = String(s == null ? '' : s)
      .replace(/^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$/g, '')
      .slice(0, TEXT_MAX);
    return t === '' ? null : t;
  }

  /**
   * The answer after one choice is pressed: one answer replaces, several toggle (at most 20).
   * @param {{ multiple: boolean }} q @param {unknown} current @param {string} id
   * @returns {string[] | null}
   */
  function choiceNext(q, current, id) {
    if (!q.multiple) return [id];
    var now = Array.isArray(current) ? current.filter(Boolean) : [];
    var at = now.indexOf(id);
    if (at >= 0) now.splice(at, 1);
    else if (now.length < CHOICES_MAX) now.push(id);
    return now.length ? now : null;
  }

  /** The words for an answer that is shown, not drawn as a control. @param {any} q @param {unknown} a */
  function describe(q, a) {
    var v = answerKept(q, a);
    if (v === undefined) return '';
    if (q.kind === 'choice') {
      return /** @type {string[]} */ (v)
        .map(function (id) {
          var c = (q.choices || []).filter(function (/** @type {any} */ x) {
            return x.id === id;
          })[0];
          return c ? c.text : '';
        })
        .filter(Boolean)
        .join(', ');
    }
    if (q.kind === 'true_false') return v ? 'True' : 'False';
    return String(v);
  }

  /* ── Saving as the student goes ──────────────────────────── */

  /**
   * @typedef {{ kind: 'idle' | 'saving' | 'saved' | 'offline', at: number }} SaveStatus
   * @typedef {{ send: (qid: string, answer: any) => Promise<any>, onStatus?: (s: SaveStatus) => void, onStop?: (code: string, res: any) => void, onSessionOver?: (res: any) => void, persist?: (pending: Record<string, any>) => void, set?: (fn: () => void, ms: number) => any, clear?: (id: any) => void, now?: () => number, pause?: number, pauseNow?: number }} SaverEnv
   */

  /**
   * The saver of one try's answers. `send(qid, answer)` is the route, `set`/`clear` the timers
   * (tests give their own), `persist(pending)` keeps what is waiting.
   * @param {SaverEnv} env
   */
  function createSaver(env) {
    var set =
      env.set ||
      function (fn, ms) {
        return setTimeout(fn, ms);
      };
    var clear =
      env.clear ||
      function (id) {
        clearTimeout(id);
      };
    var now =
      env.now ||
      function () {
        return Date.now();
      };
    var PAUSE = env.pause == null ? 700 : env.pause;
    var PAUSE_NOW = env.pauseNow == null ? 150 : env.pauseNow;
    /** @type {Record<string, { value: any }>} */
    var pending = {};
    /** @type {Record<string, Promise<void> | undefined>} */
    var flying = {};
    /** @type {Record<string, any>} */
    var timers = {};
    var retryTimer = null;
    var backoff = 0;
    var stopped = false;
    var lastAt = 0;
    var offline = false;
    /** @type {SaveStatus} */
    var shown = { kind: 'idle', at: 0 };

    function status() {
      /** @type {SaveStatus['kind']} */
      var kind = Object.keys(pending).length ? (offline ? 'offline' : 'saving') : lastAt ? 'saved' : 'idle';
      return { kind: kind, at: lastAt };
    }
    function tell() {
      var s = status();
      if (s.kind === shown.kind && s.at === shown.at) return;
      shown = s;
      if (env.onStatus) env.onStatus(s);
    }
    function keep() {
      if (env.persist) env.persist(JSON.parse(JSON.stringify(pending)));
    }
    /** @param {string} qid */
    function same(qid, snap) {
      return !!pending[qid] && JSON.stringify(pending[qid].value) === snap;
    }

    /** @param {string} qid @returns {Promise<void>} */
    function run(qid) {
      if (stopped || !pending[qid]) return Promise.resolve();
      var inFlight = flying[qid];
      if (inFlight) return inFlight;
      if (timers[qid]) {
        clear(timers[qid]);
        delete timers[qid];
      }
      var value = pending[qid].value;
      var snap = JSON.stringify(value);
      var p = Promise.resolve()
        .then(function () {
          return env.send(qid, value);
        })
        .then(null, function () {
          return { ok: false, error: 'network' };
        })
        .then(function (res) {
          delete flying[qid];
          if (stopped) return;
          var e = res && res.ok !== true ? String((res && res.error) || 'network') : '';
          if (!e) {
            offline = false;
            backoff = 0;
            var at = res && typeof res.saved_at === 'string' ? Date.parse(res.saved_at) : NaN;
            lastAt = isNaN(at) ? now() : at;
            if (same(qid, snap)) {
              delete pending[qid];
              keep();
            } else if (pending[qid] && !timers[qid]) {
              timers[qid] = set(function () {
                delete timers[qid];
                run(qid);
              }, PAUSE_NOW);
            }
            tell();
            return;
          }
          if (has(SESSION_OVER, e)) {
            stop();
            if (env.onSessionOver) env.onSessionOver(res);
            return;
          }
          if (has(STOPS, e)) {
            // The try is over (sent on another phone, or the quiz closed): nothing more can be saved.
            pending = {};
            keep();
            stop();
            if (env.onStop) env.onStop(e, res);
            return;
          }
          if (e === 'bad_answer' || e === 'not_found') {
            // This one answer can never be saved as it is: let it go, and tell the screen once.
            if (same(qid, snap)) delete pending[qid];
            keep();
            tell();
            if (env.onStop && e === 'not_found') env.onStop(e, res);
            return;
          }
          // No connection, a busy server, the hourly limit, a server error: kept, sent again later.
          if (e === 'network') offline = true;
          again(e === 'too_many' ? Math.min(Math.max(whole(res && res.retry_after_s), 1), 120) * 1000 : 0);
          tell();
        });
      flying[qid] = p;
      return p;
    }

    /** @param {number} wait */
    function again(wait) {
      if (retryTimer || stopped) return;
      var ms = wait || Math.min(3000 * Math.pow(2, backoff), 30000);
      backoff += 1;
      retryTimer = set(function () {
        retryTimer = null;
        Object.keys(pending).forEach(run);
      }, ms);
    }

    /** @param {string} qid @param {number} ms */
    function soon(qid, ms) {
      if (timers[qid]) clear(timers[qid]);
      timers[qid] = set(function () {
        delete timers[qid];
        run(qid);
      }, ms);
    }

    function stop() {
      stopped = true;
      Object.keys(timers).forEach(function (k) {
        clear(timers[k]);
      });
      timers = {};
      if (retryTimer) clear(retryTimer);
      retryTimer = null;
    }

    return {
      /**
       * An answer changed: `value` is what would be saved (null clears). `quick` for a press (a
       * choice), which waits less than typing does.
       * @param {string} qid @param {any} value @param {boolean} [quick]
       */
      queue: function (qid, value, quick) {
        if (stopped) return;
        pending[qid] = { value: value === undefined ? null : value };
        keep();
        if (!flying[qid]) soon(qid, quick ? PAUSE_NOW : PAUSE);
        tell();
      },
      /** What an earlier page left waiting, sent now. @param {Record<string, { value: any }>} kept */
      load: function (kept) {
        Object.keys(kept || {}).forEach(function (qid) {
          if (stopped) return;
          pending[qid] = { value: kept[qid].value };
          soon(qid, PAUSE_NOW);
        });
        keep();
        tell();
      },
      /** Everything waiting is sent now; a Promise of true when none is left waiting. @returns {Promise<boolean>} */
      flush: function () {
        /** @param {number} n @returns {Promise<boolean>} */
        function loop(n) {
          var ids = Object.keys(pending);
          if (!ids.length) return Promise.resolve(true);
          if (stopped || n > 3) return Promise.resolve(false);
          return Promise.all(ids.map(run)).then(function () {
            return Object.keys(pending).length && !offline ? loop(n + 1) : !Object.keys(pending).length;
          });
        }
        if (retryTimer) {
          clear(retryTimer);
          retryTimer = null;
        }
        return loop(0);
      },
      /** The browser is back online: what is waiting goes now. */
      online: function () {
        if (stopped) return;
        offline = false;
        if (retryTimer) {
          clear(retryTimer);
          retryTimer = null;
        }
        backoff = 0;
        Object.keys(pending).forEach(run);
        tell();
      },
      status: status,
      waiting: function () {
        return stopped ? 0 : Object.keys(pending).length;
      },
      stop: stop,
    };
  }

  /* ── What comes back (quiz-result, slice Q5b) ────────────────
     The `quiz-result` route's answer read key by key
     (migrations/local-test/quizzes-contract.md, "MQ3, the returned view"). Only
     `returned: true` with a `shows` this page knows is a result; anything else
     (a missing route, `returned: false`, a reply of another shape) is null and
     the screen shows what it did before. With `grade` no question is read even
     if one was sent; a question's right answer and "why" line are read only
     with `answers`. Nothing here is kept: s/quiz.js holds a result in memory
     and lets it go at every way out. */
  var SHOWS = { grade: 1, right: 1, answers: 1 };
  var RESULTS = { right: 1, partly: 1, wrong: 1, waiting: 1 };
  var WHY_MAX = 500;

  /** The key's answer for a question, or undefined. @param {any} q @param {unknown} v */
  function keyKept(q, v) {
    if (q.kind === 'choice') {
      if (!Array.isArray(v)) return undefined;
      var ids = (q.choices || []).map(function (/** @type {any} */ c) {
        return c.id;
      });
      var keep = v.filter(function (x, i) {
        return typeof x === 'string' && ids.indexOf(x) >= 0 && v.indexOf(x) === i;
      });
      return keep.length ? keep : undefined;
    }
    if (q.kind === 'true_false') return typeof v === 'boolean' ? v : undefined;
    if (q.kind === 'number') return typeof v === 'number' && isFinite(v) ? v : undefined;
    return undefined;
  }

  /** @param {unknown} n */
  function points(n) {
    return typeof n === 'number' && isFinite(n) && n >= 0 && n <= 1e9 ? n : null;
  }

  /**
   * @param {any} res
   * @returns {{ shows: string, total: { earned: number, possible: number } | null, questions: any[] } | null}
   */
  function resultFrom(res) {
    if (!res || typeof res !== 'object' || res.ok !== true || res.returned !== true) return null;
    var shows = typeof res.shows === 'string' && has(SHOWS, res.shows) ? res.shows : '';
    if (!shows) return null;
    /** @type {{ earned: number, possible: number } | null} */
    var total = null;
    if (res.total && typeof res.total === 'object') {
      var earned = points(res.total.earned);
      var possible = points(res.total.possible);
      if (earned !== null && possible !== null) total = { earned: earned, possible: possible };
    }
    /** @type {any[]} */
    var questions = [];
    if (shows !== 'grade') {
      if (!Array.isArray(res.questions)) return null;
      for (var i = 0; i < res.questions.length; i++) {
        var raw = res.questions[i];
        var q = questionFrom(raw);
        if (!q) return null;
        var key = shows === 'answers' ? keyKept(q, raw.answer) : undefined;
        questions.push({
          id: q.id,
          number: i + 1,
          kind: q.kind,
          prompt: q.prompt,
          points: q.points,
          multiple: q.multiple,
          choices: q.choices,
          yours: answerKept(q, raw.your_answer),
          result: typeof raw.result === 'string' && has(RESULTS, raw.result) ? raw.result : null,
          answer: key,
          why: shows === 'answers' && typeof raw.why === 'string' ? raw.why.trim().slice(0, WHY_MAX) : '',
        });
      }
    }
    return { shows: shows, total: total, questions: questions };
  }

  /** A quiz total's number as words ("7", "7.5"): as constants.js's formatPoints writes it. @param {number} n */
  function figure(n) {
    return typeof formatPoints === 'function' ? formatPoints(n) : String(n);
  }

  /* ── What is kept on this tab ────────────────────────────── */

  /** @param {string} enrollment @param {string} aid */
  function keptKey(enrollment, aid) {
    return KEPT + enrollment + '-' + aid;
  }
  /** @type {Record<string, boolean>} */
  var written = {}; // what this page wrote, so a sign-out removes it even where storage cannot be listed
  /** @param {string} enrollment @param {string} aid @param {Record<string, any>} pending */
  function keepPending(enrollment, aid, pending) {
    try {
      var k = keptKey(enrollment, aid);
      if (Object.keys(pending).length) {
        sessionStorage.setItem(k, JSON.stringify(pending));
        written[k] = true;
      } else {
        sessionStorage.removeItem(k);
        delete written[k];
      }
    } catch (e) {
      /* private mode: the answers stay on the page */
    }
  }
  /** @param {string} enrollment @param {string} aid @returns {Record<string, { value: any }>} */
  function keptPending(enrollment, aid) {
    try {
      var all = JSON.parse(sessionStorage.getItem(keptKey(enrollment, aid)) || 'null');
      return all && typeof all === 'object' && !Array.isArray(all) ? all : {};
    } catch (e) {
      return {};
    }
  }
  // Every quiz answer kept on this tab, at every sign-out and when no one is signed in.
  function wipeKept() {
    try {
      var names = [];
      for (var i = 0; i < sessionStorage.length; i++) {
        var k = sessionStorage.key(i);
        if (k && k.indexOf(KEPT) === 0) names.push(k);
      }
      Object.keys(written).forEach(function (k) {
        names.push(k);
      });
      written = {};
      names.forEach(function (k) {
        sessionStorage.removeItem(k);
      });
    } catch (e) {
      /* nothing kept */
    }
  }

  return {
    SESSION_OVER: SESSION_OVER,
    fromReply: fromReply,
    resultFrom: resultFrom,
    figure: figure,
    answerKept: answerKept,
    isAnswered: isAnswered,
    counts: counts,
    parseNumber: parseNumber,
    textValue: textValue,
    choiceNext: choiceNext,
    describe: describe,
    createSaver: createSaver,
    keepPending: keepPending,
    keptPending: keptPending,
    wipeKept: wipeKept,
  };
})();
