/* The student phone page (docs/STUDENT-VOICE-PLAN.md, PR 7; canvas screens
   1–5). A student scans their slip (fullvision.ca/s/#K7M-4QX) or types the
   code, checks it's them, answers one page per part (the questionnaire,
   then its Goal Check-In), and sends. A student card's code is eight
   characters (K7M4-QX2P); a slip's is six.

   It talks only to the student-submit edge function, pinned to
   ca-central-1, with no key: the slip's code is the credential. The code
   sits after # so it never reaches a server log. Answers in progress stay
   in this tab's sessionStorage and are cleared once sent.

   A code is a slip's or a student card's, and the two look alike, so the
   server tells: the code is put to the function's `card` route first
   (app.js) and, when that says it is no card, to `open` as a slip. The
   card route does not count a slip's code as a guess; asking `open` first
   would count every card scan against the slips' limits.

   Demo Mode (#demo for the November Reflection, #demo-about for About Me)
   builds the same screens from shared/questionnaire-templates.js and never
   calls the function.

   This file is the shell: the code box, the identity check, the edge
   function, drafts, Demo Mode, and which screen shows. The questionnaire's
   screens are in questionnaire.js and the phone report's in report.js; a
   student card's are in app.js (the card, Is This You?) and assignments.js
   (the Assignments list). They load after this file and hand their screens
   to StudentPage.addScreens.

   The render functions are pure (state in, HTML out) and exposed as
   StudentPage._test for tests. */
var StudentPage = (function () {
  'use strict';

  // A slip's code is six characters, a card's eight (Colin, Nov 10), from
  // the same alphabet. Only the server says which a code is.
  var CODE_RE = /^[ABCDEFGHJKMNPQRTUVWXYZ2346789]{6}(?:[ABCDEFGHJKMNPQRTUVWXYZ2346789]{2})?$/;

  var MESSAGES = {
    not_found:
      "That code didn't work. Check the letters and numbers on your slip. If you have a newer slip, use that one. If not, ask your teacher for a new slip.",
    used: 'This slip has already been used. Ask your teacher for a new slip if you need to change something.',
    closed: 'These questions are closed now. Ask your teacher if you still need to answer.',
    not_open_yet: 'These questions are not open yet.',
    locked: 'Too many tries. Wait 15 minutes and try again.',
    busy: 'FullVision is busy right now. Wait a minute and try again.',
    invalid: "Part of your answer couldn't be saved. Check your answers and try again.",
    empty: 'Answer at least one question before you send.',
    network: "Couldn't reach FullVision. Check your internet and try again. Your answers are still here.",
    report_closed: 'This report link has closed. Your official report card is in MyEd.',
    no_birthday: "Your teacher hasn't added your birthday yet, so this report can't open. Ask your teacher.",
    wrong_birthday: "That birthday doesn't match. Check the month, day and year.",
    wrong_identity: "That doesn't match. Check your birthday or student number.",
    wrong_password: "That password doesn't match. Check the password on your slip.",
    slip_locked: 'This slip is locked after too many wrong tries. Ask your teacher for a new slip.',
    reprint: 'This slip needs to be printed again. Ask your teacher for a new slip.',
    // A student card (app.js). A teacher unlocks a card; a slip is replaced.
    card_not_found: "That code didn't work. Check the letters and numbers on your card.",
    wrong_card_password: "That password doesn't match. Check the password on your card.",
    card_locked: 'This card is locked after too many wrong tries. Ask your teacher to unlock it.',
    // A card that won't open says why (Colin, Nov 9).
    card_closed: 'The student page is turned off for this class. Ask your teacher.',
    card_expired: "This card's last day has passed. Ask your teacher for a new card.",
    card_reprint: 'This card needs to be printed again. Ask your teacher for a new card.',
    card_stopped: 'This card has been replaced. Ask your teacher for your new card.',
    card_gone: "Your page for this class can't be opened any more. Ask your teacher.",
    card_network: "Couldn't reach FullVision. Check your internet and try again.",
    signed_out: 'You are signed out. Scan or type your card to open your page again.',
  };
  var MONTHS = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];

  var S = null;

  function freshState() {
    return {
      screen: 'start', // start | loading | confirm | notme | part | sent; reports: rcheck | report
      code: '',
      typed: '',
      data: null, // {token, student, course, parts, context}
      part: 0,
      answers: {},
      message: '',
      sending: false,
      demo: false,
      // Sending work (s/send.js): Demo Mode's Send Work switch, the send under way, what the sample has
      // in (by piece), and the question over a card (Unsend Your Work?, Replace Your Photos?).
      demoSend: false,
      send: null,
      demoSent: {},
      // Reflect on Feedback (s/reflect.js, S10): Demo Mode's switch, what the sample has sent (s/feedback.js), the screen.
      demoReflect: false,
      demoReflections: null,
      reflect: null,
      sendAsk: null,
      ident: null, // what matched on a questionnaire slip, kept to open again if the session runs out
      number: '', // the student number or slip password as typed
      bday: { m: '', d: '', y: '' }, // the pickers as chosen
      report: null, // the report as the teacher sent it
      page: null, // a card's page for one class, as student-data.js reads it
      heading: '', // the loading screen's title when it is not a slip's: a card's page, or a code not yet known
      again: false, // a card's page couldn't be reached: offer Try Again
      from: '', // 'card' when the code was typed on one of the card's screens
      sheet: false, // a card's page: Your Classes is open over it (app.js)
      reply: null, // a card's page: the server's `page` reply, which student-view.js draws from
      tab: 'assignments', // a card's page: assignments | learning | questionnaires | reports
      segment: 'todo', // the Assignments tab: todo | sent | back
      all: false, // the Assignments tab: All Assignments is showing
      pick: '', // the Assignments tab: the card showing
      search: '', // All Assignments: the search words
      filter: 'all', // All Assignments: all | todo | sent | back
      feedback: '', // the Assignments tab: the piece Your Feedback is open on
      whole: false, // the Assignments tab: The Whole Rubric is showing for that piece
      levels: false, // Your Feedback: What the Levels Mean is open
      work: '', // Your Feedback: See Your Work is open on this piece (s/feedback.js, S9-F3)
      workPage: 0, // See Your Work: the page showing, from 0
      marksOff: false, // See Your Work: Show Marks is off
      workPages: null, // See Your Work: the pages fetched, { id, state, pages } (s/feedback.js)
      form: '', // Questionnaires and My Reports: the one picked on a Chromebook
      back: '', // a questionnaire or report opened from a card's page: the tab to go back to
    };
  }

  /* ── Small helpers ─────────────────────────────────────────── */

  function cleanCode(s) {
    return String(s || '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
  }

  /* "Science 8 · Block B", as the class list shows it. */
  function className(course) {
    var name = (course && course.name) || '';
    var b = String((course && course.block) || '').trim();
    if (!b) return name;
    var label = /^[A-Za-z0-9]{1,2}$/.test(b) ? 'Block ' + b.toUpperCase() : b;
    return name.toLowerCase().indexOf(label.toLowerCase()) >= 0 ? name : name + ' \u00b7 ' + label;
  }

  /* As it is printed: a slip's K7M-4QX, a card's K7M4-QX2P. Anything
     else is shown as typed. */
  function prettyCode(c) {
    var half = c.length === 6 || c.length === 8 ? c.length / 2 : 0;
    return half ? c.slice(0, half) + '-' + c.slice(half) : c;
  }

  function fmtDate(iso, opts) {
    if (!iso) return '';
    var t = new Date(String(iso).length === 10 ? iso + 'T12:00:00' : iso);
    return isNaN(t) ? '' : t.toLocaleDateString('en-CA', opts || { month: 'long', day: 'numeric' });
  }

  /* ── Rendering ─────────────────────────────────────────────── */

  function header(title, sub, progress) {
    return (
      '<header class="sp-head"><div class="sp-head-row"><div class="sp-head-title">' +
      esc(title) +
      '</div>' +
      (progress ? '<div class="sp-head-sub">' + esc(sub) + '</div>' : '') +
      '</div>' +
      (progress ? progress : '<div class="sp-head-sub">' + esc(sub) + '</div>') +
      '</header>'
    );
  }

  /* `form` names the form for a screen file that opens the code itself
     (addScreens' submit); without it the shell opens the code as a slip. */
  function codeBox(state, label, top, form) {
    return (
      '<form class="sp-code-box' +
      (top ? ' sp-code-box-top' : '') +
      '" data-form="' +
      (form || 'code') +
      '" novalidate>' +
      '<label for="sp-code">' +
      esc(label) +
      '</label><div class="sp-code-row">' +
      '<input id="sp-code" class="sp-input" inputmode="text" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="9" value="' +
      esc(state.typed) +
      '"><button type="submit" class="sp-btn sp-btn-quiet sp-btn-small">Open</button></div>' +
      (state.message && (state.screen === 'start' || (state.screen === 'confirm' && !(state.data && state.data.check)))
        ? '<p class="sp-msg" role="alert">' + esc(state.message) + '</p>'
        : '') +
      '</form>'
    );
  }

  function renderStart(state) {
    return (
      header('Student Questions', 'FullVision') +
      '<main class="sp-main sp-main-center">' +
      '<section class="sp-card sp-hello"><h1 class="sp-big">Answer Your Teacher\u2019s Questions</h1>' +
      '<p class="sp-lead">Scan the QR code on your slip with your phone camera, or type the code below.</p></section>' +
      codeBox(state, 'Type the code on your slip', true) +
      '</main>'
    );
  }

  // The desktop's loading screen with lines for students
  // (shared/loading-screen.js); paint() starts the lines turning.
  // The page's name while it does not know whose page it is opening.
  var NEITHER = 'FullVision';

  function renderLoading(state) {
    var heading = (state && state.heading) || '';
    var body = window.FVLoading
      ? window.FVLoading.html('student', 'Opening your page', true)
      : '<p class="sp-lead sp-msg-calm" role="status">Opening your page\u2026</p>';
    return (
      header(heading || 'Student Questions', heading === NEITHER ? '' : 'FullVision') +
      '<main class="sp-main sp-main-center sp-main-middle">' +
      body +
      '</main>'
    );
  }

  /* A scanned or typed code could not be looked up, so the page does not
     know yet whether it is a card's or a slip's, and speaks as neither: no
     "slip", no "card", no code box that names one. */
  function renderUnreached(state) {
    return (
      header(NEITHER, '') +
      '<main class="sp-main sp-main-center">' +
      '<section class="sp-card sp-hello"><p class="sp-lead" role="alert">' +
      esc(state.message || MESSAGES.card_network) +
      '</p></section>' +
      '<button type="button" class="sp-btn sp-btn-primary" data-act="code-retry"' +
      (state.sending ? ' disabled' : '') +
      '>' +
      (state.sending ? 'Loading\u2026' : 'Try Again') +
      '</button>' +
      '</main>'
    );
  }

  function partCount(p) {
    return (p.questions || []).filter(function (q) {
      return !q.teacher_only;
    }).length;
  }

  /* Before the check the slip shows only what the questions are called and
     how many there are (open's preview); after it, the questions. */
  function slipParts(d) {
    if (d.parts) {
      return d.parts.map(function (p) {
        return { title: p.title, count: partCount(p) };
      });
    }
    return d.preview || [];
  }

  /* What the student is holding: a card (app.js) or a slip. */
  function paperOf(data) {
    return data && data.kind === 'card' ? 'card' : 'slip';
  }

  /* Who are you? A birthday or student number, or the slip's or card's
     password. */
  function identityFields(state) {
    var by = state.data.check;
    var paper = paperOf(state.data);
    var msg = state.message ? '<p class="sp-msg" role="alert" id="sp-check-msg">' + esc(state.message) + '</p>' : '';
    // With a message up, each field says it is the one the message is about.
    var told = state.message ? ' aria-describedby="sp-check-msg" aria-invalid="true"' : '';
    if (by === 'password') {
      return (
        '<p class="sp-lead">To make sure it\u2019s you, type the password printed on your ' +
        paper +
        '.</p>' +
        '<label class="sp-sub-label" for="sp-ident">Password</label>' +
        '<input id="sp-ident" class="sp-input" inputmode="numeric" autocomplete="off" maxlength="16"' +
        told +
        ' value="' +
        esc(state.number) +
        '">' +
        msg
      );
    }
    // A password printed before the teacher added a birthday or number still
    // works: the same box takes it.
    var pw = !!state.data.also_password;
    return (
      '<p class="sp-lead">To make sure it\u2019s you, enter your birthday or your student number' +
      (pw ? ', or the password on your ' + paper : '') +
      '.</p>' +
      birthdayPickers(state, told) +
      '<div class="sp-or" aria-hidden="true">or</div>' +
      '<label class="sp-sub-label" for="sp-ident">' +
      (pw ? 'Student Number or Password' : 'Student Number') +
      '</label>' +
      '<input id="sp-ident" class="sp-input" inputmode="numeric" autocomplete="off" maxlength="32"' +
      told +
      ' value="' +
      esc(state.number) +
      '">' +
      msg
    );
  }

  // `told` is extra attributes for each picker (identityFields' pointer at its message).
  function birthdayPickers(state, told) {
    var b = state.bday || {};
    var now = new Date().getFullYear();
    var years = [];
    for (var y = now - 5; y >= now - 25; y--) years.push(y);
    var opt = function (v, label, cur) {
      return '<option value="' + v + '"' + (String(cur) === String(v) ? ' selected' : '') + '>' + label + '</option>';
    };
    var sel = function (id, label, opts) {
      return (
        '<div class="sp-bday-f"><label class="sp-sub-label" for="' +
        id +
        '">' +
        label +
        '</label><select class="sp-input sp-select" id="' +
        id +
        '"' +
        (told || '') +
        '><option value=""></option>' +
        opts +
        '</select></div>'
      );
    };
    var days = '';
    for (var d = 1; d <= 31; d++) days += opt(d, d, b.d);
    return (
      '<div class="sp-bday">' +
      sel(
        'sp-bm',
        'Month',
        MONTHS.map(function (m, i) {
          return opt(i + 1, m, b.m);
        }).join(''),
      ) +
      sel('sp-bd', 'Day', days) +
      sel(
        'sp-by',
        'Year',
        years
          .map(function (y) {
            return opt(y, y, b.y);
          })
          .join(''),
      ) +
      '</div>'
    );
  }

  function renderNotMe(state) {
    return (
      header('Student Questions', (state.data && state.data.course.name) || 'FullVision') +
      '<main class="sp-main sp-main-center sp-main-middle">' +
      '<section class="sp-card sp-hello"><h1 class="sp-big">Give This Slip Back</h1>' +
      '<p class="sp-lead">This slip is for someone else. Give it back to your teacher and ask for your own.</p></section>' +
      '<button type="button" class="sp-btn sp-btn-line" data-act="restart">Type a Different Code</button>' +
      '</main>'
    );
  }

  function renderMessage(state) {
    return (
      header('Student Questions', 'FullVision') +
      '<main class="sp-main sp-main-center">' +
      '<section class="sp-card sp-hello"><p class="sp-lead" role="alert">' +
      esc(state.message) +
      '</p></section>' +
      codeBox(Object.assign({}, state, { message: '' }), 'Type the code on your slip', true) +
      '</main>'
    );
  }

  /* ── The screen files ──────────────────────────────────────── */

  /* questionnaire.js, report.js, app.js and assignments.js each hand over
       {file, render: {screen name: function}, click, input, submit, start,
        share, test}.
     render joins the screens below. click(act, el), input(el) and
     submit(name, form) get what this file's own handlers don't take.
     start(hash) is asked first when the page opens and returns true when
     the address is its own (a demo address). A screen file keeps its own S
     and root, the same objects as the ones here: share(S, root) hands them
     over again each time either is replaced. test adds to
     StudentPage._test. */
  var SCREENS = { loading: renderLoading, notme: renderNotMe, message: renderMessage, unreached: renderUnreached };
  var files = [];

  function addScreens(f) {
    files.push(f);
    Object.assign(SCREENS, f.render);
    Object.assign(api._test, f.test);
    f.share(S, root);
  }

  function share() {
    files.forEach(function (f) {
      f.share(S, root);
    });
  }

  function render(state) {
    return (SCREENS[state.screen] || renderStart)(state);
  }

  /* ── The edge function ─────────────────────────────────────── */

  function endpoint() {
    var base = ((window.__ENV && window.__ENV.SUPABASE_URL) || '').replace(/\/$/, '');
    return base + '/functions/v1/student-submit?forceFunctionRegion=ca-central-1';
  }

  /* Replies are applied only for the code or session that asked. The turn
     moves on whenever what the page is opening changes: the page starts
     over (a new address), a new code is typed, the state is reset (Type a
     Different Code, Done, signed out), or a screen file says so. A reply
     that lands after that belongs to something no longer on the page, and
     is dropped: its promise never settles, so nothing that waited on it
     runs. This is the one place that is decided, for a slip, a card and
     Demo Mode alike: `call` goes through it, and so does app.js's `ask`. */
  var turn = 0;
  function newTurn() {
    turn += 1;
  }
  function whileCurrent(promise) {
    var mine = turn;
    return new Promise(function (resolve) {
      Promise.resolve(promise).then(function (value) {
        if (mine === turn) resolve(value);
      });
    });
  }

  function call(body) {
    return whileCurrent(send(body));
  }

  function send(body) {
    return fetch(endpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
    })
      .then(function (res) {
        return res.json().catch(function () {
          return { ok: false, error: 'network' };
        });
      })
      .catch(function () {
        return { ok: false, error: 'network' };
      });
  }

  function messageFor(res) {
    var e = (res && res.error) || 'network';
    if (e === 'not_open_yet' && res.opens_on) return 'These questions open on ' + fmtDate(res.opens_on) + '.';
    return MESSAGES[e] || MESSAGES.network;
  }

  /* ── Drafts (this tab only) ────────────────────────────────── */

  function draftKey() {
    return 'fv-s-draft-' + S.code;
  }
  function saveDraft() {
    if (!S || S.demo || !S.code) return;
    try {
      sessionStorage.setItem(draftKey(), JSON.stringify({ answers: S.answers, part: S.part }));
    } catch (e) {
      /* private mode: the answers stay on the page */
    }
  }
  function loadDraft() {
    try {
      var d = JSON.parse(sessionStorage.getItem(draftKey()) || 'null');
      if (d && d.answers) S.answers = d.answers;
    } catch (e) {
      /* nothing saved */
    }
  }
  function clearDraft() {
    try {
      sessionStorage.removeItem(draftKey());
    } catch (e) {
      /* nothing to clear */
    }
  }

  /* ── Demo Mode ─────────────────────────────────────────────── */

  function demoData(which) {
    var tpls = typeof QUESTIONNAIRE_TEMPLATES !== 'undefined' ? QUESTIONNAIRE_TEMPLATES : [];
    function part(id, extra) {
      var t = tpls.find(function (x) {
        return x.id === id;
      });
      if (!t) return null;
      return Object.assign(
        {
          id: 'demo-' + id,
          kind: t.kind,
          title: t.title,
          theme: t.theme,
          grade: t.grade,
          questions: t.questions.map(function (q, i) {
            return Object.assign({ id: 'demo-' + id + '-' + i, core_ids: [], options: {} }, q);
          }),
        },
        extra || {},
      );
    }
    var parts =
      which === 'about' ? [part('about-me')] : [part('core-8-1'), part('goal-checkin', { title: 'Goal Check-In' })];
    return {
      ok: true,
      token: 'demo',
      student: { first_name: 'Cece' },
      course: { name: 'Science 8', block: 'B' },
      parts: parts.filter(Boolean),
      context:
        which === 'about'
          ? {}
          : {
              course_goal: {
                text: 'Hand in labs on time by finishing my data table in class.',
                at: new Date().getFullYear() + '-09-15T12:00:00Z',
              },
            },
    };
  }

  /* Demo Mode's phone report: Cece's Report 1, as a teacher would send it. */
  function demoReport() {
    return {
      v: 1,
      name: 'Cece Adeyemi',
      initials: 'CA',
      first: 'Cece',
      course: 'Science 8',
      report: 'Report 1',
      issued: new Date().toISOString(),
      overall: { mode: 'proficiency', text: '3.0', level: 3, word: 'Proficient' },
      skills: [
        { name: 'Questioning and Predicting', line: 'I can ask questions I can test.', word: 'Proficient', level: 3 },
        { name: 'Planning and Conducting', line: 'I can plan a fair investigation.', word: 'Proficient', level: 3 },
        { name: 'Processing and Analyzing Data', line: 'I can make sense of data.', word: 'Extending', level: 4 },
        { name: 'Communicating', line: 'I can share ideas and results.', word: 'Developing', level: 2 },
      ],
      comment: [
        'Cece is working at a proficient level in Science 8, and her data work went further: her Energy Transfer Investigation was extending.',
        'Her next step is handing in labs on time, a goal she set herself. You can help by asking her each week how her goal is going.',
      ],
      goal: {
        text: 'Hand in labs on time by finishing my data table in class.',
        status: 'Working On It',
        at: new Date().toISOString(),
      },
      self: {
        at: new Date().toISOString(),
        items: [
          { name: 'Personal Awareness & Responsibility', step: 2, why: 'I set goals but I forget to check on them.' },
          { name: 'Personal & Cultural Identity', step: 3, why: 'My family and my culture matter a lot to me.' },
        ],
      },
      attendance: { absent: 3, late: 2 },
    };
  }

  function loadDemoTemplates(done) {
    if (typeof QUESTIONNAIRE_TEMPLATES !== 'undefined') return done();
    var s = document.createElement('script');
    s.src = '../shared/questionnaire-templates.js';
    s.onload = done;
    s.onerror = done;
    document.head.appendChild(s);
  }

  /* ── Flow ──────────────────────────────────────────────────── */

  var root = null;

  function paint(focusSel) {
    if (!root) return;
    // html-safe: the page's render (the name is shared), over this file's screens and the ones questionnaire.js, report.js, app.js and assignments.js add: every screen escapes server and typed text with esc; q.id is a question uuid; PhoneReportView.html escapes the report; a result on the Assignments list is calc.js's text, escaped.
    root.innerHTML = render(S);
    if (S.screen === 'loading' && window.FVLoading) window.FVLoading.start(root, 'student');
    root.querySelectorAll('textarea.sp-text').forEach(grow);
    rovingRadios(root);
    // A screen file's own step once its screen is drawn (assignments.js: the cards follow the swipe).
    files.forEach(function (f) {
      if (f.drawn) f.drawn(root, S);
    });
    var f = focusSel ? root.querySelector(focusSel) : null;
    if (f && f.focus) f.focus({ preventScroll: false });
  }

  /* Each set of choices is one Tab stop, as a radio group is: the chosen
     one, or the first; the arrow keys move inside it. */
  function rovingRadios(el) {
    el.querySelectorAll('[role="radiogroup"]').forEach(function (g) {
      var radios = Array.prototype.slice.call(g.querySelectorAll('[role="radio"]'));
      if (!radios.length) return;
      var on = radios.filter(function (r) {
        return r.getAttribute('aria-checked') === 'true';
      })[0];
      radios.forEach(function (r) {
        r.setAttribute('tabindex', r === (on || radios[0]) ? '0' : '-1');
      });
    });
  }

  function grow(el) {
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 2 + 'px';
  }

  /* A slip that locked on this phone stays locked when the page is opened
     again (the server says so only after another try). */
  function lockKey(code) {
    return 'fv-s-locked-' + code;
  }
  function slipLockedHere(code) {
    try {
      return !!localStorage.getItem(lockKey(code));
    } catch (e) {
      return false;
    }
  }
  function markSlipLocked(code) {
    try {
      localStorage.setItem(lockKey(code), '1');
    } catch (e) {
      /* private mode: the server still refuses it */
    }
  }

  /* "2 tries left." and, before the last, what happens after it. */
  function triesLeftText(n, paper) {
    if (n == null) return '';
    if (n === 1 && paper === 'card')
      return ' 1 try left. One more wrong try locks this card, and your teacher will need to unlock it.';
    if (n === 1)
      return ' 1 try left. One more wrong try locks this slip, and you will need a new one from your teacher.';
    return ' ' + n + ' tries left.';
  }

  /* A typed or scanned code. It is put to the card's screens first
     (app.js's `card`, which asks the function's `card` route), and then,
     unless that said it is a card, to the slip route, as it always was.
     `card(code)` gives a promise of
       true         a card: its screen is drawn;
       false        not a card: the function said so (or is the one deployed
                    before cards, which does not know the question);
       'locked'     this address has made too many wrong tries on cards;
       'unreached'  no answer the page can use (no internet, a server
                    error, a timeout).
     A slip opens whenever the slip route is healthy, whatever the card
     route does: after 'locked' and 'unreached' the slip route is still
     asked. What differs is what "nothing opened" then means. After false,
     the code is no card and no slip: "That code didn't work." After the
     other two it is not known what the code is, so the page speaks as
     neither (`unreached`).
     `from` is 'card' when the code was typed on one of the card's screens:
     a code that opens nothing is then answered there (app.js's `refused`). */
  function openCode(code, from) {
    var c = cleanCode(code);
    S.typed = prettyCode(c);
    if (!CODE_RE.test(c)) {
      S.message = MESSAGES.not_found;
      S.screen = S.screen === 'confirm' ? 'confirm' : 'start';
      paint('#sp-code');
      return Promise.resolve();
    }
    newTurn();
    S.code = c;
    S.from = from || '';
    S.message = '';
    S.sending = false;
    // Not known yet whose page this is: the loading screen says neither.
    if (!S.demo) S.heading = NEITHER;
    S.screen = 'loading';
    paint();
    var cards = files.filter(function (f) {
      return !!f.card;
    })[0];
    var onCard = from === 'card' ? cards : null;
    return (cards ? cards.card(c) : Promise.resolve(false)).then(function (said) {
      if (said === true) return undefined;
      return openSlip(c, said, onCard);
    });
  }

  /* Nothing opened, and it is not known whether the code is a card's or a
     slip's. Typed on a card's screen, that screen says so; scanned, or
     typed anywhere else, the neutral screen does, with Try Again. `why` is
     'locked' or 'busy' when the function said so, else the code could not
     be looked up. */
  function unreached(cards, why) {
    var e = why === 'locked' || why === 'busy' ? why : 'network';
    if (cards && cards.refused({ ok: false, error: e })) return;
    S.message = e === 'network' ? '' : MESSAGES[e];
    S.screen = 'unreached';
    paint('[data-act="code-retry"]');
  }

  // What the slip route says only of a slip: it is one, whatever the card route said.
  var A_SLIP = { used: 1, closed: 1, not_open_yet: 1 };

  /* `cardSaid` is false, 'locked' or 'unreached' (openCode). */
  function openSlip(c, cardSaid, cards) {
    return call({ route: 'open', code: c }).then(function (res) {
      var e = res && res.ok ? '' : (res && res.error) || 'network';
      if (cardSaid !== false && e && !Object.prototype.hasOwnProperty.call(A_SLIP, e)) {
        // The card route did not say what the code is and the slip route has not opened it.
        unreached(cards, cardSaid === 'locked' && e === 'not_found' ? 'locked' : e);
        return;
      }
      // Typed on a card's screen and it opened nothing: that screen answers.
      if (cards && e && cards.refused(res)) return;
      // A slip typed on a card's screen: the tab is named for the slip's page again.
      if (cards && typeof document !== 'undefined') document.title = 'Student Questions — FullVision';
      if (res && res.ok && res.kind === 'report') {
        S.data = res;
        S.screen = 'rcheck';
        S.message = '';
        paint();
      } else if (res && res.ok && res.check && slipLockedHere(c)) {
        // Locked on this phone already: say so now, not after another try.
        S.message = MESSAGES.slip_locked;
        S.screen = 'message';
        paint();
      } else if (res && res.ok) {
        S.data = res;
        S.part = 0;
        S.answers = {};
        if (res.parts) loadDraft();
        S.screen = 'confirm';
        S.message = '';
        paint();
      } else {
        S.message = messageFor(res);
        S.screen = 'message';
        paint();
      }
    });
  }

  /* The focus has gone back to a box that holds the answer that was wrong.
     Its text is selected, so typing the right one replaces it: typed after
     it, "0123456" on "999" would be a second wrong try, and five lock the
     card. A birthday picker needs nothing: choosing replaces its choice. */
  function selectAnswer(sel) {
    var el = sel && root ? root.querySelector(sel) : null;
    if (el && el.tagName === 'INPUT' && typeof el.select === 'function') el.select();
  }

  /* A questionnaire slip: the birthday, student number or slip password
     hands over the questions. A session that ran out opens again from the
     code, once.

     A student card (app.js) reads the same fields and gets the same
     messages, and does its own asking and its own next step:
       card = { send(ident) → a promise of the reply, ok(reply),
                messageScreen: the screen a refusal shows on,
                message(reply) → the card's words for a refusal,
                stops(reply) → whether that refusal ends the check }. */
  function verifyIdentity(card) {
    var by = S.data.check;
    var paper = paperOf(S.data);
    var typed = ((root.querySelector('#sp-ident') || {}).value || '').trim();
    var m = (root.querySelector('#sp-bm') || {}).value || '';
    var dd = (root.querySelector('#sp-bd') || {}).value || '';
    var y = (root.querySelector('#sp-by') || {}).value || '';
    S.number = typed;
    S.bday = { m: m, d: dd, y: y };
    var ident = { birthday: null, student_number: null, password: null };
    /* On a card, a message leaves the focus on the field it is about: the
       one typed in, or the first. The screen was drawn again, so without
       this the focus is on nothing. A slip's check is as it was. */
    var back = card ? (by === 'password' || typed ? '#sp-ident' : '#sp-bm') : undefined;
    if (by === 'password') {
      if (!typed) {
        S.message = 'Type the password printed on your ' + paper + '.';
        paint('#sp-ident');
        return Promise.resolve();
      }
      ident.password = typed;
    } else {
      var some = m || dd || y;
      if (some && !(m && dd && y)) {
        S.message = 'Choose the month, day and year you were born.';
        paint(card ? '#sp-bm' : undefined);
        return Promise.resolve();
      }
      if (some) ident.birthday = y + '-' + String(m).padStart(2, '0') + '-' + String(dd).padStart(2, '0');
      if (typed) ident.student_number = typed;
      if (typed && S.data.also_password && typed.length <= 16) ident.password = typed;
      if (!some && !typed) {
        S.message = 'Choose your birthday or type your student number.';
        paint(back);
        return Promise.resolve();
      }
    }
    S.message = '';
    var done = function (res) {
      S.sending = false;
      if (res && res.ok && card) return card.ok(res);
      if (res && res.ok) {
        S.ident = ident;
        S.data.parts = res.parts || [];
        S.data.context = res.context || {};
        S.data.check = null;
        S.part = 0;
        S.answers = {};
        loadDraft();
        S.screen = 'part';
        paint();
        window.scrollTo(0, 0);
        return;
      }
      var e = res && res.error;
      if (e === 'slip_locked' && !S.demo) markSlipLocked(S.code);
      if (e === 'wrong_identity') {
        var wrong = by !== 'password' ? 'wrong_identity' : card ? 'wrong_card_password' : 'wrong_password';
        S.message = MESSAGES[wrong] + triesLeftText(res.tries_left, paper);
      } else if (card && card.message) {
        // A card's refusals have the card's own words. One the function
        // gave stops the check; a call that never arrived can be tried again.
        S.message = card.message(res);
        if (card.stops(res)) S.screen = card.messageScreen;
      } else {
        S.message = messageFor(res);
        if (e !== 'network' && e !== 'busy') S.screen = card ? card.messageScreen : 'message';
      }
      paint(back);
      selectAnswer(back);
    };
    if (card) {
      S.sending = true;
      paint();
      return card.send(ident).then(done);
    }
    if (S.demo) {
      return Promise.resolve(done({ ok: true, parts: S.demoParts, context: S.demoContext }));
    }
    S.sending = true;
    paint();
    return call(Object.assign({ route: 'verify', token: S.data.token }, ident))
      .then(function (res) {
        if (res && res.error === 'expired') {
          return call({ route: 'open', code: S.code }).then(function (again) {
            if (!again || !again.ok) return again;
            S.data.token = again.token;
            return call(Object.assign({ route: 'verify', token: again.token }, ident));
          });
        }
        return res;
      })
      .then(done);
  }

  /* A clean state, handed to every screen file. */
  function reset() {
    newTurn();
    S = freshState();
    share();
    return S;
  }

  function onClick(e) {
    var el = e.target.closest('[data-act]');
    if (!el || !root.contains(el)) return;
    var act = el.dataset.act;
    if (act === 'notme') {
      S.screen = 'notme';
      paint();
    } else if (act === 'code-retry') {
      openCode(S.code, S.from);
    } else if (act === 'restart') {
      reset();
      try {
        history.replaceState(null, '', location.pathname);
      } catch (err) {
        /* fine */
      }
      paint('#sp-code');
    } else {
      files.forEach(function (f) {
        if (f.click) f.click(act, el);
      });
    }
  }

  function onInput(e) {
    var el = e.target;
    if (el.id === 'sp-code') {
      S.typed = el.value;
      return;
    }
    if (el.id === 'sp-ident') {
      S.number = el.value;
      return;
    }
    files.forEach(function (f) {
      if (f.input) f.input(el);
    });
  }

  // A file chosen (s/send.js's camera and file buttons).
  function onChange(e) {
    var el = e.target;
    files.forEach(function (f) {
      if (f.change) f.change(el);
    });
  }

  function onSubmit(e) {
    var form = e.target.closest('[data-form]');
    if (!form) return;
    e.preventDefault();
    var name = form.getAttribute('data-form');
    if (name !== 'code') {
      files.forEach(function (f) {
        if (f.submit) f.submit(name, form);
      });
      return;
    }
    var input = form.querySelector('#sp-code');
    openCode(input ? input.value : '');
  }

  var ARROWS = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
  function onKeydown(e) {
    // Arrow keys, Home and End choose within a set of choices.
    var t = e.target;
    var group = t && t.getAttribute && t.getAttribute('role') === 'radio' && t.closest('[role="radiogroup"]');
    if (group && (ARROWS[e.key] || e.key === 'Home' || e.key === 'End')) {
      var radios = Array.prototype.slice.call(group.querySelectorAll('[role="radio"]'));
      var i = radios.indexOf(t);
      var n =
        e.key === 'Home'
          ? 0
          : e.key === 'End'
            ? radios.length - 1
            : (i + ARROWS[e.key] + radios.length) % radios.length;
      e.preventDefault();
      if (radios[n]) radios[n].click();
      return;
    }
    // Enter in "Another" adds it instead of submitting anything.
    if (e.key === 'Enter' && e.target && /-other$/.test(e.target.id || '')) {
      e.preventDefault();
      var add = e.target.parentNode.querySelector('[data-act="other-add"]');
      if (add) add.click();
    }
    // Enter in a card's Is This You? box answers it, as Yes, That's Me does.
    if (e.key === 'Enter' && e.target && e.target.id === 'sp-ident') {
      var yes = root.querySelector('[data-act="card-yes"]');
      if (yes && !yes.disabled) {
        e.preventDefault();
        yes.click();
      }
    }
  }

  function start(el, hash) {
    newTurn();
    root = el;
    S = freshState();
    share();
    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
    root.addEventListener('submit', onSubmit);
    root.addEventListener('change', onChange);
    root.addEventListener('keydown', onKeydown);
    var h = String(hash || '').replace(/^#/, '');
    // A screen file's own address (app.js: #demo-card).
    var theirs = files.some(function (f) {
      return !!(f.start && f.start(h));
    });
    if (theirs) return;
    if (/^demo-report$/i.test(h)) {
      S.demo = true;
      var until = new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10);
      S.data = {
        ok: true,
        kind: 'report',
        token: 'demo',
        student: { first_name: 'Cece' },
        course: { name: 'Science 8', block: 'B' },
        report: { title: 'Report 1', expires_on: until },
        has_birthday: true,
      };
      S.screen = 'rcheck';
      paint();
      return;
    }
    if (/^demo(-about)?$/i.test(h)) {
      S.demo = true;
      S.screen = 'loading';
      paint();
      loadDemoTemplates(function () {
        S.data = demoData(/about/i.test(h) ? 'about' : 'reflection');
        // The reflection asks who you are, as a real slip does (any answer
        // passes in Demo Mode); About Me shows the screen after the check.
        if (!/about/i.test(h) && S.data.parts.length) {
          S.demoParts = S.data.parts;
          S.demoContext = S.data.context;
          S.data.preview = slipParts(S.data);
          delete S.data.parts;
          delete S.data.context;
          S.data.check = 'identity';
        }
        S.screen = S.data.parts || S.data.check ? 'confirm' : 'start';
        paint();
      });
      return;
    }
    if (h) {
      openCode(decodeURIComponent(h));
      return;
    }
    paint();
  }

  /* The screen files load after this file, so the page starts once its
     scripts are read. A copy of index.html from before the split names only
     this file, and one from before student cards leaves out app.js and
     assignments.js: a screen file that hasn't joined is fetched here. */
  function whenScreensAreIn(done) {
    function fetchMissing() {
      var missing = ['questionnaire', 'report', 'app', 'assignments'].filter(function (name) {
        return !files.some(function (f) {
          return f.file === name;
        });
      });
      var left = missing.length;
      if (!left) return done();
      missing.forEach(function (name) {
        var s = document.createElement('script');
        s.src = name + '.js';
        s.onload = s.onerror = function () {
          left -= 1;
          if (!left) done();
        };
        document.head.appendChild(s);
      });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fetchMissing);
    else fetchMissing();
  }

  var app = typeof document !== 'undefined' && document.getElementById ? document.getElementById('app') : null;
  if (app && typeof app.addEventListener === 'function' && typeof location !== 'undefined') {
    whenScreensAreIn(function () {
      start(app, location.hash);
      window.addEventListener('hashchange', function () {
        var h = location.hash.replace(/^#/, '');
        if (h && cleanCode(h) !== S.code) {
          root.replaceWith((root = root.cloneNode(false)));
          start(root, location.hash);
        }
      });
    });
  }

  var api = {
    addScreens: addScreens,
    // What the screen files use.
    MESSAGES: MESSAGES,
    className: className,
    fmtDate: fmtDate,
    header: header,
    codeBox: codeBox,
    cleanCode: cleanCode,
    prettyCode: prettyCode,
    isCode: function (c) {
      return CODE_RE.test(c);
    },
    reset: reset,
    newTurn: newTurn,
    whileCurrent: whileCurrent,
    openCode: openCode,
    slipParts: slipParts,
    identityFields: identityFields,
    birthdayPickers: birthdayPickers,
    verifyIdentity: verifyIdentity,
    call: call,
    messageFor: messageFor,
    saveDraft: saveDraft,
    clearDraft: clearDraft,
    demoReport: demoReport,
    demoData: demoData,
    loadDemoTemplates: loadDemoTemplates,
    paint: paint,
    grow: grow,
    _test: {
      freshState: freshState,
      render: render,
      demoData: demoData,
      cleanCode: cleanCode,
      start: start,
      state: function () {
        return S;
      },
    },
  };
  return api;
})();
