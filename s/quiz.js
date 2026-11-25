// @ts-check
/* A quiz on the student's page (docs/plans/quizzes-plan.md, slice Q3b; the
   board's "Taking It on a Phone"). The model is s/quiz-model.js, the drawing
   s/quiz-view.js (shared with Preview as Student); this file asks the three
   routes, keeps the screen's state, and saves each answer as it changes.
   Everything here is behind the build switch `quizzes`
   (shared/build-flags.js): with it off nothing here draws or asks anything.

   The routes (supabase/functions/student-submit/quiz-routes.ts; the contract
   is migrations/local-test/quizzes-contract.md, "The student's side (MQ2)"),
   each through StudentPage.askClass, which adds the device's session:
     quiz       { assessment_id, new_try? }   the questions in this student's
                order, their saved answers, the tries left
     quiz-save  { assessment_id, question_id, answer }   one answer; null clears
     quiz-send  { assessment_id }   closes the try
     quiz-result  { assessment_id }   only for a piece the page knows is returned (below, "When it comes back")
   Only the keys the model names are read from an answer.

   Which pieces are quizzes: `quiz-list`, asked once beside `page` (below).
   A piece it does not name gets no button, and a server without the route
   gets none at all, so until the server has the routes the page offers
   nothing (plan, rule 7).

   Saving: s/quiz-model.js's saver. An answer that does not land waits on the
   phone, is sent again, and "Saved on this phone. It'll send when you're back
   online." says so; Send is refused while any save is waiting, and says why.
   Nothing about a save is ever a banner or a failed-item list.

   The key is not on the device and nothing here knows a right answer.

   What is kept on the device, and the one exception to "nothing of a
   student's answers stays": a real student's answers still waiting to be
   saved are in this tab's sessionStorage (`fv-s-quiz-<enrolment>-<piece>`), as
   the questionnaire drafts are (s/student.js, CARD_DRAFTS): they last only for
   the tab, go when the save lands, and go at every sign-out
   (StudentQuizModel.wipeKept). A quiz answered in Demo Mode is the sample's,
   never sent anywhere, and kept in localStorage under `gb-student-quiz-demo`,
   so a reload keeps it; Log Out, Reset Demo Data and leaving Demo Mode clear
   it. The teacher's Demo Mode answer key is not read by anything on the
   student's page.

   When it comes back (slice Q5b; the board's "When It Comes Back"): for a piece
   whose grade is back (kind 'back') that `quiz-list` says can no longer be
   answered, the page asks `quiz-result` once per class open (at most 12 pieces,
   never on a timer, never with the switch off). Only `returned: true` with a
   `shows` the page knows is kept (M.resultFrom), in memory: nothing from it goes
   in localStorage or sessionStorage on a real sign-in, and it is let go with
   the answers (letGo, which every sign-out and class switch calls) and with a
   new page state. A missing route, a 404, a 500 or `returned: false` leaves the
   page as it was, with nothing said. A piece with a result gets See Your Quiz on
   its card and on Your Feedback, which opens the returned view: the page's own
   Your Result and comment on top (s/page-view.js quizTopHtml, calc.js's words),
   then each question in the student's own numbering as the quiz's `shows` allows.
   In Demo Mode the sample comes back when the demo teacher closes, confirms and
   returns it (demoReturn): the sample's own confirmed try, kept on the device with the rest
   of the sample's progress, answered by demoResult under the same `shows`.

   An answer still waiting is never lost silently: the Log Out sheet says so
   and offers Wait (StudentPage.quizWaiting), and closing the tab asks first
   (beforeunload), only while a save is waiting. */
(function () {
  'use strict';

  /** @type {any} */
  var w = window;
  var SP = w.StudentPage;
  var M = w.StudentQuizModel;
  var V = w.StudentQuizView;
  if (!SP || !SP.addScreens || !M || !V) return;

  var NETWORK = 'Couldn’t reach FullVision. Check your internet and try again.';
  var DEMO_TRIES = 2;
  var DEMO_AID = 'demo-quiz-check';
  // Demo Mode's progress: a gb- key, so Log Out, Reset Demo Data and leaving Demo Mode all clear it.
  var DEMO_KEY = 'gb-student-quiz-demo';
  /** @type {Record<string, any> | null} */
  var list = null; // quiz-list's answer for the student on screen: { student, items: { assessment id: item } }

  /** @type {any} */
  var S = null; // the page's state (student.js)
  /** @type {any} */
  var Q = null; // the quiz open (or last open); see open()
  /** @type {any[]} */
  var savers = []; // every saver that may still hold an answer: a quiz left for Assignments keeps saving
  /** @type {Record<string, string>} */
  var known = {}; // aid -> 'part' or 'sent', as far as this tab has seen: the card's button words
  /* What came back (slice Q5b): `quiz-result`'s answer for each returned quiz piece of the class on screen, read by
     M.resultFrom, kept in memory only and let go at every way out (letGo, and a new page state). Asked once for a piece
     per class open, only for a piece the page knows is returned (its grade is back) and the list says can no longer be
     answered; a missing route, a 404, a 500 or `returned: false` leaves it out and nothing is said. */
  /** @type {Record<string, any>} */
  var back = {};
  /** @type {Record<string, boolean>} */
  var backAsked = {};
  var backCount = 0;
  var BACK_MAX = 12; // the newest returned quizzes of a class; a page never asks for more
  /** @type {any} */
  var demoStore = null; // Demo Mode's tries, kept on this device (DEMO_KEY) like the rest of Demo Mode

  function on() {
    return typeof BuildFlags !== 'undefined' && BuildFlags.on('quizzes');
  }
  /** @param {string} id */
  function cssId(id) {
    return String(id).replace(/["\\]/g, '');
  }
  function appRoot() {
    return typeof document !== 'undefined' ? document.getElementById('app') : null;
  }

  /* ── Demo Mode's sample quiz ───────────────────────────────
     The student's reply shape, with no key: the page never knows an answer. */
  function choice(/** @type {string} */ id, /** @type {string[]} */ texts) {
    return texts.map(function (t, i) {
      return { id: id + '-' + String.fromCharCode(97 + i), text: t };
    });
  }
  var DEMO_QUESTIONS = [
    {
      id: 'dq1',
      kind: 'choice',
      prompt: 'A student measures a plant every week for 4 weeks. Which graph best shows how its height changes?',
      points: 1,
      multiple: false,
      choices: choice('dq1', ['A line graph', 'A pie chart', 'A list of names']),
    },
    {
      id: 'dq2',
      kind: 'choice',
      prompt: 'Which of these do plants need to grow?',
      points: 2,
      multiple: true,
      choices: choice('dq2', ['Light', 'Water', 'Video games', 'Air']),
    },
    {
      id: 'dq3',
      kind: 'true_false',
      prompt: 'A pattern in the data always proves that one thing caused the other.',
      points: 1,
      multiple: false,
      choices: null,
    },
    {
      id: 'dq4',
      kind: 'number',
      prompt: 'Three plants grew 2.5 cm, 3.5 cm and 4 cm. How many centimetres did they grow in all?',
      points: 2,
      multiple: false,
      choices: null,
    },
    {
      id: 'dq5',
      kind: 'text',
      prompt: 'In one or two sentences, describe a pattern you can see in the plant growth data.',
      points: 3,
      multiple: false,
      choices: null,
    },
    {
      id: 'dq6',
      kind: 'choice',
      prompt: 'Which unit is plant height measured in?',
      points: 1,
      multiple: false,
      choices: choice('dq6', ['Centimetres', 'Grams', 'Litres']),
    },
  ];

  /* The sample's right answers. They are read in one place only: the sample coming back (demoReturn, which marks the
     try, and demoResult, which sends what the quiz's `shows` allows), as the real key is read only by `quiz-result`. */
  var DEMO_ANSWERS = {
    dq1: { answer: ['dq1-a'], tolerance: null, why: 'A line graph shows how something changes over time.' },
    dq2: { answer: ['dq2-a', 'dq2-b', 'dq2-d'], tolerance: null, why: 'Plants need light, water and air to grow.' },
    dq3: {
      answer: false,
      tolerance: null,
      why: 'A pattern shows two things happen together. It does not prove one caused the other.',
    },
    dq4: { answer: 10, tolerance: 0, why: 'Add 2.5, 3.5 and 4.' },
    dq5: { answer: null, tolerance: null, why: null },
    dq6: { answer: ['dq6-a'], tolerance: null, why: null },
  };
  var DEMO_COMMENT =
    'Your pattern is clear and you explained it well. Look again at the question about cause and effect.';

  /** The sample's piece in the sample class's work (s/app.js demoClass), with the switch on only. @param {(n: number) => string} isoDay */
  SP.demoQuiz = function (isoDay) {
    if (!on()) return [];
    /** @type {any} */
    var piece = {
      id: DEMO_AID,
      title: 'Data Patterns Quick Check',
      date: isoDay(-1),
      due_date: isoDay(0),
      tag_ids: ['demo-pa'],
      unit: 'Unit 1: Cells',
      category: 'Quizzes',
      about: 'Answer each question. Your answers save as you go, and you can send them when you are done.',
    };
    // Once the demo teacher has confirmed and returned it (demoReturn): a returned grade, as the sample class's others are.
    var st = demoLoad();
    if (st.returned) {
      piece.working = {
        score: { value: null, comment: DEMO_COMMENT },
        tag_scores: [{ tag_id: 'demo-pa', value: st.returned.level, modifier: 0, comment: null }],
      };
      piece.ret = { is_draft: false, returned_at: st.returned.at, returned_copy: null };
    }
    return [piece];
  };

  /** @param {any[]} list */
  function shuffled(list) {
    var out = list.slice();
    for (var i = out.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = out[i];
      out[i] = out[j];
      out[j] = t;
    }
    return out;
  }

  /** @param {any} st */
  function demoReply(st) {
    var last = st.attempts[st.attempts.length - 1];
    var left = DEMO_TRIES - st.attempts.length;
    var sent = !!last.sentAt;
    return {
      ok: true,
      quiz: { tries: DEMO_TRIES, tries_left: left, closed: !!st.closed, closes_on: null },
      try: {
        number: last.number,
        sent: sent,
        started_at: last.at,
        sent_at: last.sentAt || null,
        reopened: false,
      },
      sent_tries: st.attempts.filter(function (/** @type {any} */ a) {
        return !!a.sentAt;
      }).length,
      can_answer: !sent && !st.closed,
      can_try_again: sent && left > 0 && !st.closed,
      questions: last.order.map(function (/** @type {string} */ id, /** @type {number} */ i) {
        var q = DEMO_QUESTIONS.filter(function (x) {
          return x.id === id;
        })[0];
        return Object.assign({}, q, { number: i + 1 });
      }),
      answers: JSON.parse(JSON.stringify(last.answers)),
    };
  }

  /** What the three routes would answer, from this tab's memory. @param {string} route @param {any} body */
  function demoAsk(route, body) {
    var st = demoLoad();
    try {
      return demoStep(st, route, body);
    } finally {
      demoKeep();
    }
  }

  function demoLoad() {
    if (demoStore) return demoStore;
    demoStore = { attempts: [] };
    try {
      var kept = JSON.parse(localStorage.getItem(DEMO_KEY) || 'null');
      if (kept && Array.isArray(kept.attempts)) demoStore = kept;
    } catch (e) {
      /* nothing kept: a first try */
    }
    return demoStore;
  }
  function demoKeep() {
    try {
      if (demoStore && demoStore.attempts.length) localStorage.setItem(DEMO_KEY, JSON.stringify(demoStore));
    } catch (e) {
      /* storage blocked: the page keeps it for now */
    }
  }
  // Demo Mode: an answer is on the device the moment it changes, as a real one is on the tab, so a reload loses none.
  /** @param {Record<string, { value: any }>} pending */
  function demoTake(pending) {
    var st = demoLoad();
    var last = st.attempts[st.attempts.length - 1];
    if (!last || last.sentAt) return;
    Object.keys(pending).forEach(function (qid) {
      var v = pending[qid].value;
      if (v == null) delete last.answers[qid];
      else last.answers[qid] = v;
    });
    demoKeep();
  }
  function demoWipe() {
    demoStore = null;
    try {
      localStorage.removeItem(DEMO_KEY);
    } catch (e) {
      /* nothing kept */
    }
  }

  /** What `quiz-list` would answer for the sample quiz. */
  function demoItem() {
    var st = demoLoad();
    var last = st.attempts[st.attempts.length - 1];
    var open = !!last && !last.sentAt;
    return {
      assessment_id: DEMO_AID,
      tries_left: DEMO_TRIES - st.attempts.length,
      can_answer: !st.closed,
      closed: !!st.closed,
      has_open_try: open && !st.closed,
    };
  }

  /* The demo teacher closes the sample, confirms a try and returns it (Demo Mode has no teacher on this page, so a test
     or a tour calls this once a try is sent). What the teacher confirmed is the sample's own record, as the sample
     class's other returned grades are: Cece's try with these answers, marked as below, 6 of 10, Developing. Nothing here
     works out a grade (right and wrong are decided in calc.js, which the student page never names for a quiz). The try keeps
     the order the student's own last sent try was shown in. Kept on the device with the rest of the sample's progress.
     @param {{ shows?: string, addTotal?: boolean }} [opts] */
  var DEMO_TRY = {
    answers: {
      dq1: ['dq1-a'],
      dq2: ['dq2-a', 'dq2-b'],
      dq3: true,
      dq4: 10,
      dq5: 'The plants with more light grew taller each week.',
      dq6: ['dq6-a'],
    },
    earned: 6,
    possible: 10,
    level: 2,
    questions: {
      dq1: { earned: 1, result: 'right' },
      dq2: { earned: 0, result: 'wrong' },
      dq3: { earned: 0, result: 'wrong' },
      dq4: { earned: 2, result: 'right' },
      dq5: { earned: 2, result: 'partly' },
      dq6: { earned: 1, result: 'right' },
    },
  };
  function demoReturn(opts) {
    var o = opts || {};
    if (!on() || !(S && S.demo)) return false;
    var st = demoLoad();
    var sent = st.attempts.filter(function (/** @type {any} */ a) {
      return !!a.sentAt;
    });
    if (!sent.length) return false;
    var counted = sent[sent.length - 1];
    counted.answers = JSON.parse(JSON.stringify(DEMO_TRY.answers));
    st.closed = true;
    st.returned = {
      shows: o.shows === 'grade' || o.shows === 'right' ? o.shows : 'answers',
      add_total: o.addTotal === true,
      level: DEMO_TRY.level,
      marked: { earned: DEMO_TRY.earned, possible: DEMO_TRY.possible, questions: DEMO_TRY.questions },
      counted_try: counted.number,
      at: new Date().toISOString(),
    };
    demoKeep();
    return true;
  }

  /** What `quiz-result` would answer for the returned sample: only what its `shows` allows is read from the answers. @param {any} st */
  function demoResult(st) {
    var r = st.returned;
    if (!r) return { ok: true, returned: false };
    var tried =
      st.attempts.filter(function (/** @type {any} */ a) {
        return a.number === r.counted_try;
      })[0] || st.attempts[st.attempts.length - 1];
    /** @type {any} */
    var out = { ok: true, returned: true, shows: r.shows };
    if (r.add_total) out.total = { earned: r.marked.earned, possible: r.marked.possible };
    if (r.shows === 'grade') return out;
    out.questions = tried.order.map(function (/** @type {string} */ id, /** @type {number} */ i) {
      var q = DEMO_QUESTIONS.filter(function (x) {
        return x.id === id;
      })[0];
      var mark = r.marked.questions[id];
      /** @type {any} */
      var item = {
        id: q.id,
        number: i + 1,
        kind: q.kind,
        prompt: q.prompt,
        points: q.points,
        multiple: q.multiple,
        choices: q.choices,
        your_answer: has(tried.answers, id) ? tried.answers[id] : null,
        result: mark ? mark.result : null,
      };
      if (r.shows === 'answers') {
        item.answer = DEMO_ANSWERS[id].answer;
        item.why = DEMO_ANSWERS[id].why;
      }
      return item;
    });
    return out;
  }
  /** @param {any} map @param {string} key */
  function has(map, key) {
    return !!map && Object.prototype.hasOwnProperty.call(map, key);
  }

  /** @param {any} st @param {string} route @param {any} body */
  function demoStep(st, route, body) {
    var iso = new Date().toISOString();
    var last = st.attempts[st.attempts.length - 1];
    function fresh() {
      st.attempts.push({
        number: st.attempts.length + 1,
        order: shuffled(DEMO_QUESTIONS).map(function (q) {
          return q.id;
        }),
        answers: {},
        at: iso,
        sentAt: '',
      });
    }
    if (route === 'quiz') {
      if (!last) fresh();
      else if (body.new_try === true && st.closed) return { ok: false, error: 'quiz_closed' };
      else if (body.new_try === true && last.sentAt && st.attempts.length < DEMO_TRIES) fresh();
      else if (body.new_try === true && last.sentAt) return { ok: false, error: 'no_tries_left' };
      return demoReply(st);
    }
    if (route === 'quiz-result') return demoResult(st);
    if (!last) return { ok: false, error: 'not_found' };
    if (last.sentAt) return { ok: false, error: 'sent' };
    if (route === 'quiz-save') {
      if (body.answer == null) delete last.answers[body.question_id];
      else last.answers[body.question_id] = body.answer;
      return { ok: true, question_id: body.question_id, saved_at: iso };
    }
    if (route === 'quiz-send') {
      last.sentAt = iso;
      var left = DEMO_TRIES - st.attempts.length;
      return { ok: true, try: last.number, sent_at: iso, tries_left: left, can_try_again: left > 0 };
    }
    return { ok: false, error: 'not_found' };
  }

  /** @param {string} route @param {any} body @param {string} [student] */
  function ask(route, body, student) {
    if (S && S.demo) return SP.whileCurrent(Promise.resolve(demoAsk(route, body)));
    // Named for its student: a save never reaches another class if the page has moved to one.
    return Promise.resolve(SP.askClass(route, body, student)).then(
      function (/** @type {any} */ res) {
        return res && res.error === 'other_student' ? { ok: false, error: 'not_found' } : res;
      },
      function () {
        return { ok: false, error: 'network' };
      },
    );
  }

  /* ── The piece, and what the card says ─────────────────── */

  function view() {
    return S && typeof SP.viewOf === 'function' ? SP.viewOf(S) : null;
  }
  /** @param {string} aid */
  function pieceOf(aid) {
    var v = view();
    return (
      (v &&
        v.work.filter(function (/** @type {any} */ p) {
          return p.id === aid;
        })[0]) ||
      null
    );
  }

  /* ── Which pieces are quizzes ──────────────────────────────
     `quiz-list` (the student's own class): { ok, quizzes: [ { assessment_id,
     tries_left, can_answer, closed, has_open_try } ] }. Asked once beside `page`
     when a class opens (s/app.js openPage, quizzesWith), only with the quizzes
     switch on, never on a timer; its answer is waited for a second at most,
     and a later one draws the cards when it comes. A route the server lacks,
     a 404, a 500 or no answer means no quiz buttons and nothing said. A card
     says what the list says: Start the Quiz, Carry On with the Quiz (a try is
     open), Try Again (a try was sent here and tries are left), See Your Quiz,
     or Closed. What this tab does to a quiz after that updates its entry
     (touch); the server is not asked again. */
  var WAIT_MS = 1000;

  /** @param {any} res @returns {Record<string, any> | null} */
  function itemsFrom(res) {
    if (!res || res.ok !== true || !Array.isArray(res.quizzes)) return null;
    /** @type {Record<string, any>} */
    var items = {};
    res.quizzes.forEach(function (/** @type {any} */ r) {
      if (!r || typeof r.assessment_id !== 'string' || !r.assessment_id) return;
      items[r.assessment_id] = {
        assessment_id: r.assessment_id,
        tries_left: typeof r.tries_left === 'number' && isFinite(r.tries_left) ? r.tries_left : null,
        can_answer: r.can_answer === true,
        closed: r.closed === true,
        has_open_try: r.has_open_try === true,
      };
    });
    return items;
  }

  /** @param {any} mine the session being opened (s/app.js) @param {Promise<any>} pageAsked */
  SP.quizzesWith = function (mine, pageAsked) {
    if (!on() || !mine || !mine.enrollment) return pageAsked;
    var student = String(mine.enrollment);
    forgetBack();
    if (S && S.demo) {
      list = { student: student, items: {} };
      list.items[DEMO_AID] = demoItem();
      return pageAsked;
    }
    /** @type {{ student: string, items: Record<string, any> | null }} */
    var mineList = { student: student, items: null };
    list = mineList;
    var got = Promise.resolve(SP.askClass('quiz-list', {}, student)).then(
      function (/** @type {any} */ res) {
        if (list !== mineList) return;
        if (res && M.SESSION_OVER[String(res.error)]) {
          if (typeof SP.sessionRefused === 'function') SP.sessionRefused({ ok: false, error: String(res.error) });
          return;
        }
        mineList.items = itemsFrom(res);
        // An answer after the first draw: the cards are drawn again where the student is.
        if (mineList.items)
          SP.whenFree(function () {
            if (S && S.screen === 'assignments' && S.page && S.page.student.id === student) paint();
          });
      },
      function () {
        /* no answer: no quiz buttons */
      },
    );
    return SP.whileCurrent(
      Promise.resolve(pageAsked).then(function (res) {
        return new Promise(function (done) {
          var t = setTimeout(function () {
            done(res);
          }, WAIT_MS);
          got.then(function () {
            clearTimeout(t);
            done(res);
          });
        });
      }),
    );
  };

  /* The cards' quiz buttons, from the list (assignments.js hands the view over). */
  SP.quizMarks = function (/** @type {any} */ v, /** @type {any} */ state) {
    if (!on() || !v || !Array.isArray(v.work) || !list || !list.items) return;
    if (!state || !state.page || !state.page.student || list.student !== state.page.student.id) return;
    var items = list.items;
    var student = list.student;
    v.work.forEach(function (/** @type {any} */ p) {
      var it = items[p.id];
      if (it && p.kind === 'back') {
        // A returned quiz: See Your Quiz, only once `quiz-result` has said it is back.
        if (back[p.id]) p.quizReturned = true;
        else askBack(p, it, student, state);
        return;
      }
      if (!it || (p.kind !== 'due' && p.kind !== 'missing')) return;
      p.quiz = true;
      var more = it.tries_left == null || it.tries_left > 0;
      // Closed before it was sent (a try is open and cannot be answered), or closed with none started.
      /* Closed with something of the student's to see (a try sent or left open) reads See Your Quiz, its closed date
         inside; "Closed" alone is for a quiz this tab has opened and found nothing of theirs in. */
      if (!it.can_answer && (it.closed || it.has_open_try))
        p.quizWord = known[p.id] === 'none' ? 'Closed' : 'See Your Quiz';
      else if (it.has_open_try) p.quizWord = 'Carry On with the Quiz';
      else if (!it.can_answer) p.quizWord = 'See Your Quiz';
      else if (known[p.id] === 'sent') p.quizWord = more ? 'Try Again' : 'See Your Quiz';
    });
  };

  /** Every returned result let go. */
  function forgetBack() {
    back = {};
    backAsked = {};
    backCount = 0;
    // The screen open on a result goes with it (Switch Class, a sign-out).
    if (Q) Q.back = null;
  }

  /** `quiz-result` for one returned piece of this class, once. The first 12 are asked at class open; one past that is asked when its Your Feedback opens. @param {any} p @param {any} it its quiz-list entry @param {string} student @param {any} state */
  function askBack(p, it, student, state) {
    // The page knows the grade is back; the list says nothing more can be answered. Anything else is not asked.
    if (backAsked[p.id] || it.can_answer || it.has_open_try) return;
    if (backCount >= BACK_MAX && !(state && state.feedback === p.id)) return;
    backAsked[p.id] = true;
    backCount += 1;
    var mine = back;
    ask('quiz-result', { assessment_id: p.id }, student).then(function (/** @type {any} */ res) {
      // Another class or sign-out since: nothing of this answer is kept.
      if (mine !== back || !list || list.student !== student) return;
      if (res && M.SESSION_OVER[String(res.error)]) {
        if (typeof SP.sessionRefused === 'function') SP.sessionRefused({ ok: false, error: String(res.error) });
        return;
      }
      var got = M.resultFrom(res);
      if (!got) return;
      back[p.id] = got;
      // The cards are drawn again where the student is, now with See Your Quiz.
      SP.whenFree(function () {
        if (S && S.screen === 'assignments' && (S.demo || (S.page && S.page.student.id === student))) paint();
      });
    });
  }

  /** What this tab has seen of a quiz, and its entry in the list brought up to date. @param {any} q */
  function remember(q) {
    if (!q.m) return;
    var n = M.counts(q.m, q.answers);
    known[q.aid] = q.m.sent ? 'sent' : n.done ? 'part' : q.m.tryNumber === 0 && q.m.closed ? 'none' : '';
    var it = list && list.items ? list.items[q.aid] : null;
    if (!it) return;
    it.has_open_try = !q.m.sent && q.m.tryNumber > 0;
    it.tries_left = q.m.triesLeft;
    it.closed = q.m.closed;
    it.can_answer = q.m.canAnswer || q.m.canTryAgain;
  }

  /* ── The open quiz ─────────────────────────────────────── */

  // Is this quiz still the one on screen, for the student on screen?
  /** @param {any} q */
  function live(q) {
    return (
      !!S &&
      Q === q &&
      S.screen === 'quiz' &&
      (S.demo || (!!S.page && !!S.page.student && S.page.student.id === q.student))
    );
  }

  /** @param {any} q */
  function ctx(q) {
    return {
      mode: q.mode,
      course: q.course,
      title: q.title,
      due: q.due,
      m: q.m,
      answers: q.answers,
      status: q.status,
      message: q.message,
      busy: q.busy,
      noRetry: q.noRetry,
      demo: !!(S && S.demo),
      back: q.back || null,
      top: q.mode === 'returned' ? topOf(q.aid) : '',
    };
  }
  // "Returned Nov 24", read as Your Feedback reads it.
  /** @param {any} p */
  function returnedWords(p) {
    return typeof w.StudentPageView === 'object' && w.StudentPageView.returnedOn ? w.StudentPageView.returnedOn(p) : '';
  }
  // The piece's Your Result and the teacher's comment, as the page's Your Feedback draws them (calc.js's words).
  /** @param {string} aid */
  function topOf(aid) {
    var p = pieceOf(aid);
    return p && typeof w.StudentPageView === 'object' && w.StudentPageView.quizTopHtml
      ? w.StudentPageView.quizTopHtml(p)
      : '';
  }
  /** @param {any} state */
  function renderQuiz(state) {
    if (!Q) return '<div class="sp-quiz"><p class="sp-quiz-line" role="status">Opening your quiz…</p></div>';
    return V.html(Object.assign(ctx(Q), { demo: !!state.demo }));
  }
  /** @param {string} [focus] */
  function paint(focus) {
    SP.paint(focus);
  }
  /** @param {any} q */
  function refreshNow(q) {
    var r = appRoot();
    if (r && live(q)) V.refresh(r, ctx(q));
  }

  /** @param {number} pos */
  function scrollToQuestion(pos) {
    var r = appRoot();
    var card = r ? r.querySelector('[data-pos="' + pos + '"]') : null;
    if (!card) return;
    if (typeof card.scrollIntoView === 'function') card.scrollIntoView({ block: 'start', behavior: 'auto' });
    /** @type {any} */
    var first = card.querySelector('input, textarea, [role="radio"][tabindex="0"], [role="checkbox"]');
    if (first && typeof first.focus === 'function') first.focus({ preventScroll: true });
  }

  /** Look Again: the question scrolled to and focused. @param {number} pos */
  function lookAt(pos) {
    var r = appRoot();
    var row = r ? r.querySelector('.sp-quiz-ra[data-pos="' + pos + '"]') : null;
    if (!row) return;
    if (typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'start', behavior: 'auto' });
    /** @type {any} */ (row).focus({ preventScroll: true });
  }

  /** @param {any} q @param {string} code */
  function stopped(q, code) {
    q.note =
      code === 'sent'
        ? 'This quiz was sent on another phone.'
        : code === 'quiz_closed'
          ? 'This quiz closed while you were answering. Your answers are saved.'
          : code === 'no_tries_left'
            ? 'You have no tries left.'
            : 'This quiz changed. Your answers are saved.';
    load(q, false, false);
  }

  /** @param {any} q */
  function startSaver(q) {
    q.saver = M.createSaver({
      send: function (/** @type {string} */ qid, /** @type {any} */ answer) {
        return ask('quiz-save', { assessment_id: q.aid, question_id: qid, answer: answer }, q.student);
      },
      persist: function (/** @type {Record<string, any>} */ pending) {
        if (S && S.demo) demoTake(pending);
        else M.keepPending(q.student, q.aid, pending);
      },
      onStatus: function (/** @type {any} */ s) {
        q.status = s;
        if (q.mode === 'take') refreshNow(q);
        sheetWords();
      },
      onStop: function (/** @type {string} */ code) {
        if (live(q)) stopped(q, code);
      },
      onSessionOver: function (/** @type {any} */ res) {
        if (typeof SP.sessionRefused === 'function') SP.sessionRefused(res);
      },
    });
    savers.push(q.saver);
    // What an earlier page of this tab left waiting (no connection, a closed tab): sent again now.
    if (S && S.demo) return;
    var kept = M.keptPending(q.student, q.aid);
    /** @type {Record<string, { value: any }>} */
    var mine = {};
    q.m.questions.forEach(function (/** @type {any} */ qu) {
      var k = kept[qu.id];
      if (!k || typeof k !== 'object') return;
      var v = k.value == null ? undefined : M.answerKept(qu, k.value);
      if (k.value != null && v === undefined) return;
      if (v === undefined) delete q.answers[qu.id];
      else q.answers[qu.id] = v;
      mine[qu.id] = { value: v === undefined ? null : v };
    });
    if (Object.keys(mine).length) {
      q.status = { kind: 'saving', at: 0 };
      q.saver.load(mine);
    }
  }

  /** @param {any} q @param {any} res @param {boolean} first */
  function adopt(q, res, first) {
    var m = M.fromReply(res);
    if (!m) return refuse(q, { ok: false, error: 'not_found' });
    if (q.saver) q.saver.stop();
    q.saver = null;
    q.m = m;
    q.answers = Object.assign({}, m.answers);
    q.message = q.note || '';
    q.note = '';
    q.noRetry = false;
    q.status = { kind: 'idle', at: 0 };
    if (m.canAnswer) {
      startSaver(q);
    } else if (!(S && S.demo)) {
      M.keepPending(q.student, q.aid, {});
    }
    var n = M.counts(m, q.answers);
    q.mode = m.sent ? 'sent' : m.canAnswer ? 'take' : 'closed';
    if (q.mode === 'take' && first && n.left > 0 && n.done > 0) q.mode = 'resume';
    if (q.mode === 'take' && n.done > 0) q.status = { kind: q.status.kind === 'saving' ? 'saving' : 'saved', at: 0 };
    remember(q);
    paint('#sp-quiz-title');
    if (typeof window.scrollTo === 'function') window.scrollTo(0, 0);
  }

  /** @param {any} q @param {any} res */
  function refuse(q, res) {
    var e = String((res && res.error) || 'network');
    if (M.SESSION_OVER[e]) {
      if (typeof SP.sessionRefused === 'function') SP.sessionRefused({ ok: false, error: e });
      return;
    }
    var words =
      e === 'quiz_closed'
        ? 'This quiz closed, so you can’t start another try.'
        : e === 'no_tries_left'
          ? 'You have no tries left on this quiz.'
          : e === 'too_many'
            ? 'FullVision is busy right now. Wait a minute and try again.'
            : e === 'not_found' || e === 'bad_request'
              ? 'This quiz can’t open right now. Ask your teacher.'
              : NETWORK;
    q.message = words;
    // Try Again is not offered again after a refusal that will not change: it would only be refused again.
    var final = e === 'not_found' || e === 'bad_request' || e === 'quiz_closed' || e === 'no_tries_left';
    if (!q.m) {
      q.mode = 'failed';
      q.noRetry = final;
    } else if (final) {
      q.m.canTryAgain = false;
    }
    paint('#sp-quiz-msg');
  }

  /** @param {any} q @param {boolean} again @param {boolean} first */
  function load(q, again, first) {
    q.busy = again;
    if (again) paint();
    /** @type {any} */
    var body = { assessment_id: q.aid };
    if (again) body.new_try = true;
    return ask('quiz', body, q.student).then(function (/** @type {any} */ res) {
      if (!live(q)) return;
      q.busy = false;
      if (res && res.ok === true) return adopt(q, res, first);
      refuse(q, res);
    });
  }

  /** @param {string} aid */
  function open(aid) {
    var p = pieceOf(aid);
    var returned = !!p && p.kind === 'back' && p.quizReturned === true && !!back[aid];
    if (!on() || !p || (p.quiz !== true && !returned) || !S) return;
    var v = view();
    var course = (v && v.course) || {};
    var block = String(course.block || '').trim();
    var due = p.dueDate ? V.dayOf(p.dueDate) : '';
    var dueWords = due ? 'Due ' + due : '';
    if (returned) dueWords = returnedWords(p);
    var old = Q;
    var q = {
      aid: aid,
      student: S.demo ? 'demo' : S.page && S.page.student ? S.page.student.id : '',
      title: p.title,
      course:
        String(course.name || '') +
        (block ? ' · ' + (/^[A-Za-z0-9]{1,2}$/.test(block) ? 'Block ' + block.toUpperCase() : block) : ''),
      due: dueWords,
      mode: returned ? 'returned' : 'loading',
      m: null,
      answers: {},
      status: { kind: 'idle', at: 0 },
      message: '',
      note: '',
      busy: false,
      noRetry: false,
      saver: null,
      scroll: 0,
      back: returned ? back[aid] : null,
    };
    Q = q;
    S.screen = 'quiz';
    paint('#sp-quiz-title');
    if (typeof window.scrollTo === 'function') window.scrollTo(0, 0);
    // A returned quiz is shown from what `quiz-result` said: nothing more is asked.
    if (returned) return;
    // What the last visit left waiting goes first, so this answer never comes back older than it was.
    var wait = old && old.aid === aid && old.saver ? old.saver.flush() : Promise.resolve(true);
    wait.then(function () {
      if (live(q)) load(q, false, true);
    });
  }

  function leave() {
    var q = Q;
    if (!S || !q) return;
    remember(q);
    S.screen = 'assignments';
    paint('[data-act="quiz-open"][data-piece="' + cssId(q.aid) + '"]');
  }

  /** @param {any} q */
  function sendNow(q) {
    if (q.busy || !q.saver) return;
    q.busy = true;
    q.message = '';
    paint();
    q.saver.flush().then(function (/** @type {boolean} */ ok) {
      if (!live(q)) return;
      if (!ok) {
        q.busy = false;
        q.message =
          'Your answers are saved on this phone, but they haven’t reached FullVision yet. Check your internet, then press Send again.';
        paint('#sp-quiz-msg');
        return;
      }
      return ask('quiz-send', { assessment_id: q.aid }, q.student).then(function (/** @type {any} */ res) {
        if (!live(q)) {
          if (res && res.ok === true) known[q.aid] = 'sent';
          return;
        }
        q.busy = false;
        if (res && res.ok === true) {
          q.m.sent = true;
          q.m.canAnswer = false;
          q.m.sentAt = String(res.sent_at || '');
          q.m.triesLeft = typeof res.tries_left === 'number' ? res.tries_left : null;
          q.m.canTryAgain = res.can_try_again === true;
          q.m.sentTries += 1;
          q.saver.stop();
          q.saver = null;
          M.keepPending(q.student, q.aid, {});
          q.mode = 'sent';
          remember(q);
          paint('#sp-quiz-sent');
          if (typeof window.scrollTo === 'function') window.scrollTo(0, 0);
          return;
        }
        var e = String((res && res.error) || 'network');
        if (e === 'sent' || e === 'quiz_closed') return stopped(q, e);
        if (M.SESSION_OVER[e]) return refuse(q, res);
        q.message =
          e === 'too_many'
            ? 'FullVision is busy right now. Wait a minute, then press Send again.'
            : 'Couldn’t reach FullVision. Your answers are saved. Check your internet, then press Send again.';
        paint('#sp-quiz-msg');
      });
    });
  }

  /* ── Presses and typing ────────────────────────────────── */

  /** @param {any} q @param {any} qu @param {any} value @param {boolean} quick */
  function changed(q, qu, value, quick) {
    if (value === null || value === undefined) delete q.answers[qu.id];
    else q.answers[qu.id] = value;
    if (q.saver) q.saver.queue(qu.id, value === undefined ? null : value, quick);
    remember(q);
    refreshNow(q);
  }

  /** @param {string} act @param {any} el */
  function onClick(act, el) {
    if (!S) return;
    var attr = function (/** @type {string} */ n) {
      return (el && el.getAttribute && el.getAttribute(n)) || '';
    };
    if (act === 'quiz-open') return open(attr('data-piece'));
    if (act === 'class-hold-cancel') {
      S.classHold = '';
      return paint('.sp-gear');
    }
    var q = Q;
    if (S.screen !== 'quiz' || !q) return;
    if (act === 'quiz-back') return leave();
    if (act === 'quiz-look' && q.mode === 'returned') return lookAt(Number(attr('data-pos')) || 1);
    if (act === 'quiz-retry') return load(q, false, true);
    if (act === 'quiz-pick' && q.mode === 'take' && q.m) {
      var hit = V.pressed(q.m, q.answers, el);
      if (!hit) return;
      V.setChoices(appRoot(), hit.q, hit.value);
      return changed(q, hit.q, hit.value, true);
    }
    if (act === 'quiz-next' && q.m) {
      var n = M.counts(q.m, q.answers);
      if (n.next) scrollToQuestion(n.next);
      return;
    }
    if (act === 'quiz-send-ask' && q.mode === 'take') {
      q.scroll = typeof window.scrollY === 'number' ? window.scrollY : 0;
      q.mode = 'check';
      q.message = '';
      paint('#sp-quiz-title');
      if (typeof window.scrollTo === 'function') window.scrollTo(0, 0);
      return;
    }
    if ((act === 'quiz-back-to-questions' || act === 'quiz-jump') && q.mode === 'check') {
      q.mode = 'take';
      q.message = '';
      paint();
      if (act === 'quiz-jump') return scrollToQuestion(Number(attr('data-pos')) || 1);
      if (typeof window.scrollTo === 'function') window.scrollTo(0, q.scroll || 0);
      return;
    }
    if (act === 'quiz-send' && q.mode === 'check') return sendNow(q);
    if (act === 'quiz-again' && q.mode === 'sent' && q.m && q.m.canTryAgain && !q.busy) return load(q, true, false);
    if (act === 'quiz-carry-on' && q.mode === 'resume' && q.m) {
      q.mode = 'take';
      paint();
      var left = M.counts(q.m, q.answers).next;
      if (left) scrollToQuestion(left);
    }
  }

  /** Typing keeps the focus: the answer is kept and the count follows it, with no redraw. @param {any} el */
  function onInput(el) {
    var q = Q;
    if (!S || S.screen !== 'quiz' || !q || q.mode !== 'take' || !q.m || !el || !el.getAttribute) return;
    var kind = el.getAttribute('data-kind');
    if (kind !== 'text' && kind !== 'number') return;
    var hit = V.typed(q.m, el);
    if (!hit) return;
    if (hit.q.kind === 'number' && typeof document !== 'undefined') {
      var hint = document.getElementById('q-' + hit.q.id + '-hint');
      if (hint) hint.textContent = hit.hint;
    }
    changed(q, hit.q, hit.value, false);
  }

  /* ── An answer still waiting is never lost silently ─────── */

  /** How many answers are waiting to be saved, on every quiz this tab has open. */
  function waiting() {
    savers = savers.filter(function (s) {
      return s.waiting() > 0 || s === (Q && Q.saver);
    });
    return savers.reduce(function (n, s) {
      return n + s.waiting();
    }, 0);
  }
  // The Log Out sheet (s/assignments.js): how many answers have not reached the teacher yet.
  /* The Log Out and Switch Class sheets say an answer is still waiting, and their words are drawn when they open:
     drawn again whenever the number waiting changes, so they never go on warning after the save has landed. */
  var shown = 0;
  function sheetWords() {
    var n = SP.quizWaiting();
    if (n === shown) return;
    shown = n;
    if (!S || !(S.logout || S.classHold)) return;
    if (!n) S.classHold = '';
    paint(S.classHold || S.logout ? '.sp-logout .sp-btn-tint' : '.sp-gear');
  }
  // Demo Mode sends nothing to any teacher, so it never says an answer is on its way to one.
  SP.quizWaiting = function () {
    return on() && !(S && S.demo) ? waiting() : 0;
  };

  /* Switch Class (s/app.js openClass): with an answer waiting the page asks first, in a sheet (Wait, or Switch
     Class Anyway); the answer is let go only when the student chooses to. True while the sheet asks. */
  SP.quizHeld = function (/** @type {string} */ enrollment) {
    if (!on() || !S || S.demo || !waiting()) return false;
    if (S.classHold === enrollment) {
      S.classHold = '';
      letGo();
      return false;
    }
    S.classHold = enrollment;
    paint('.sp-logout .sp-btn-tint');
    return true;
  };
  // Every answer waiting on this tab is let go, and what the tab kept of it.
  function letGo() {
    savers.forEach(function (s) {
      s.stop();
    });
    savers = [];
    M.wipeKept();
    // What came back is let go too, and the screen open on it.
    forgetBack();
  }

  SP.quizLetGo = letGo;

  function asksBeforeClosing() {
    return on() && !(S && S.demo) && waiting() > 0;
  }

  // Closing the tab asks first, only while a save is waiting.
  if (typeof window.addEventListener === 'function') {
    window.addEventListener('beforeunload', function (/** @type {any} */ e) {
      if (!asksBeforeClosing()) return;
      e.preventDefault();
      e.returnValue = '';
    });
  }

  // The browser is back online: what is waiting goes now.
  if (typeof window.addEventListener === 'function') {
    window.addEventListener('online', function () {
      if (Q && Q.saver) Q.saver.online();
    });
  }
  // No one is signed in on this tab: nothing of anyone's answers is left on it.
  try {
    if (!localStorage.getItem('fv-s-session')) M.wipeKept();
  } catch (e) {
    /* private mode: nothing kept either */
  }

  SP.addScreens({
    file: 'quiz',
    render: { quiz: renderQuiz },
    click: onClick,
    input: onInput,
    share: function (/** @type {any} */ state) {
      // A new state is a sign-out (StudentPage.reset): the last student's answers go with it.
      if (S && state !== S) {
        savers.forEach(function (s) {
          s.stop();
        });
        if (Q && Q.saver) Q.saver.stop();
        Q = null;
        known = {};
        savers = [];
        list = null;
        forgetBack();
        demoWipe();
        M.wipeKept();
      }
      S = state;
    },
    test: {
      quizOpen: open,
      quizAsksBeforeClosing: asksBeforeClosing,
      quizSendNow: function () {
        if (Q) sendNow(Q);
      },
      quizOf: function () {
        return Q;
      },
      quizBack: function () {
        return back;
      },
      quizDemoReturn: demoReturn,
    },
  });
})();
