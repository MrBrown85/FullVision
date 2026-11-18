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
   Only the keys the model names are read from an answer.

   Which pieces are quizzes: `quiz-list`, asked once beside `page` (below).
   A piece it does not name gets no button, and a server without the route
   gets none at all, so until the server has the routes the page offers
   nothing (plan, rule 7).

   Saving: s/quiz-model.js's saver. An answer that does not land waits on the
   phone, is sent again, and "Saved on this phone. It'll send when you're back
   online." says so; Send is refused while any save is waiting, and says why.
   Nothing about a save is ever a banner or a failed-item list.

   The key is not on the device and nothing here knows a right answer. A quiz
   answered in Demo Mode is the sample's, kept in this tab's memory only and
   never sent anywhere; the teacher's Demo Mode answer key
   is not read by anything on the student's page.
   Whatever a real student's answers left on this tab is wiped at every
   sign-out (StudentQuizModel.wipeKept). */
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
  /** @type {Record<string, string>} */
  var known = {}; // aid -> 'part' or 'sent', as far as this tab has seen: the card's button words
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

  /** The sample's piece in the sample class's work (s/app.js demoClass), with the switch on only. @param {(n: number) => string} isoDay */
  SP.demoQuiz = function (isoDay) {
    if (!on()) return [];
    return [
      {
        id: DEMO_AID,
        title: 'Data Patterns Quick Check',
        date: isoDay(-1),
        due_date: isoDay(0),
        tag_ids: ['demo-pa'],
        unit: 'Unit 1: Cells',
        category: 'Quizzes',
        about: 'Answer each question. Your answers save as you go, and you can send them when you are done.',
      },
    ];
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
      quiz: { tries: DEMO_TRIES, tries_left: left, closed: false, closes_on: null },
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
      can_answer: !sent,
      can_try_again: sent && left > 0,
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
      can_answer: true,
      closed: false,
      has_open_try: open,
    };
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
      else if (body.new_try === true && last.sentAt && st.attempts.length < DEMO_TRIES) fresh();
      else if (body.new_try === true && last.sentAt) return { ok: false, error: 'no_tries_left' };
      return demoReply(st);
    }
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

  /** @param {string} route @param {any} body */
  function ask(route, body) {
    if (S && S.demo) return SP.whileCurrent(Promise.resolve(demoAsk(route, body)));
    return Promise.resolve(SP.askClass(route, body)).then(null, function () {
      return { ok: false, error: 'network' };
    });
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
        if (mineList.items && S && S.screen === 'assignments' && S.page && S.page.student.id === student) paint();
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
    v.work.forEach(function (/** @type {any} */ p) {
      var it = items[p.id];
      if (!it || (p.kind !== 'due' && p.kind !== 'missing')) return;
      p.quiz = true;
      var more = it.tries_left == null || it.tries_left > 0;
      // Closed before it was sent (a try is open and cannot be answered), or closed with none started.
      if (!it.can_answer && (it.closed || it.has_open_try)) p.quizWord = 'Closed';
      else if (it.has_open_try) p.quizWord = 'Carry On with the Quiz';
      else if (!it.can_answer) p.quizWord = 'See Your Quiz';
      else if (known[p.id] === 'sent') p.quizWord = more ? 'Try Again' : 'See Your Quiz';
    });
  };

  /** What this tab has seen of a quiz, and its entry in the list brought up to date. @param {any} q */
  function remember(q) {
    if (!q.m) return;
    var n = M.counts(q.m, q.answers);
    known[q.aid] = q.m.sent ? 'sent' : n.done ? 'part' : '';
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
    };
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
        return ask('quiz-save', { assessment_id: q.aid, question_id: qid, answer: answer });
      },
      persist: function (/** @type {Record<string, any>} */ pending) {
        if (S && S.demo) demoTake(pending);
        else M.keepPending(q.student, q.aid, pending);
      },
      onStatus: function (/** @type {any} */ s) {
        q.status = s;
        if (q.mode === 'take') refreshNow(q);
      },
      onStop: function (/** @type {string} */ code) {
        if (live(q)) stopped(q, code);
      },
      onSessionOver: function (/** @type {any} */ res) {
        if (typeof SP.sessionRefused === 'function') SP.sessionRefused(res);
      },
    });
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
        ? 'This quiz is closed.'
        : e === 'no_tries_left'
          ? 'You have no tries left on this quiz.'
          : e === 'too_many'
            ? 'FullVision is busy right now. Wait a minute and try again.'
            : e === 'not_found' || e === 'bad_request'
              ? 'This quiz can’t open right now. Ask your teacher.'
              : NETWORK;
    q.message = words;
    if (!q.m) {
      q.mode = 'failed';
      q.noRetry = e === 'not_found' || e === 'bad_request';
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
    return ask('quiz', body).then(function (/** @type {any} */ res) {
      if (!live(q)) return;
      q.busy = false;
      if (res && res.ok === true) return adopt(q, res, first);
      refuse(q, res);
    });
  }

  /** @param {string} aid */
  function open(aid) {
    var p = pieceOf(aid);
    if (!on() || !p || p.quiz !== true || !S) return;
    var v = view();
    var course = (v && v.course) || {};
    var block = String(course.block || '').trim();
    var due = p.dueDate ? V.dayOf(p.dueDate) : '';
    var old = Q;
    var q = {
      aid: aid,
      student: S.demo ? 'demo' : S.page && S.page.student ? S.page.student.id : '',
      title: p.title,
      course:
        String(course.name || '') +
        (block ? ' · ' + (/^[A-Za-z0-9]{1,2}$/.test(block) ? 'Block ' + block.toUpperCase() : block) : ''),
      due: due ? 'Due ' + due : '',
      mode: 'loading',
      m: null,
      answers: {},
      status: { kind: 'idle', at: 0 },
      message: '',
      note: '',
      busy: false,
      noRetry: false,
      saver: null,
      scroll: 0,
    };
    Q = q;
    S.screen = 'quiz';
    paint('#sp-quiz-title');
    if (typeof window.scrollTo === 'function') window.scrollTo(0, 0);
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
      return ask('quiz-send', { assessment_id: q.aid }).then(function (/** @type {any} */ res) {
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
    var q = Q;
    if (S.screen !== 'quiz' || !q) return;
    if (act === 'quiz-back') return leave();
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
        if (Q && Q.saver) Q.saver.stop();
        Q = null;
        known = {};
        list = null;
        demoWipe();
        M.wipeKept();
      }
      S = state;
    },
    test: {
      quizOpen: open,
      quizSendNow: function () {
        if (Q) sendNow(Q);
      },
      quizOf: function () {
        return Q;
      },
    },
  });
})();
