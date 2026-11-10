/* A student card on the student page (docs/plans/student-page-build-plan.md,
   S0-F3; the artboard's "Scan or Type Your Card", "Is This You? Birthday or
   Student Number" and "Is This You? Card Password"): the card's code, the
   identity check, then the student's page for one class, which opens on the
   Assignments list (assignments.js).

   A card is not a slip. A slip opens one questionnaire or one report; a card
   opens the student's page for the course. The boards draw both codes as six
   characters, so the page does not guess from the shape: the server tells
   (`kind: 'card'`).

   Demo Mode only so far (#demo-card; #demo-card-password for the card's
   password; #demo-card-letter and #demo-card-both for a class graded by
   letter or both). The card path asks three things, `card`, `verify` and
   `page`, and Demo Mode answers all three on the device in the shapes the
   edge function will use. Nothing here calls the edge function: a real
   code never reaches these screens until the routes exist and S0-W1 fills
   in `ask`.

   student.js holds the code box, the identity fields and check, and the
   lock messages, and loads first. This file adds its screens with
   StudentPage.addScreens. */
(function () {
  'use strict';

  if (typeof StudentPage === 'undefined' || !StudentPage.addScreens) return;

  var MESSAGES = StudentPage.MESSAGES;
  var className = StudentPage.className;
  var fmtDate = StudentPage.fmtDate;
  var header = StudentPage.header;
  var codeBox = StudentPage.codeBox;
  var cleanCode = StudentPage.cleanCode;
  var prettyCode = StudentPage.prettyCode;
  var isCode = StudentPage.isCode;
  var identityFields = StudentPage.identityFields;
  var verifyIdentity = StudentPage.verifyIdentity;
  var messageFor = StudentPage.messageFor;
  var paint = StudentPage.paint;

  // The page's state: student.js's own, handed over by share.
  var S = null;

  var TITLE = 'Student Page';

  /* ── Scan or Type Your Card ────────────────────────────────── */

  // A picture of a code in a camera's frame. The phone's own camera does
  // the scanning; this page has no camera.
  var SCAN_PICTURE =
    '<svg class="sp-scan" viewBox="0 0 120 120" aria-hidden="true" focusable="false">' +
    '<rect width="120" height="120" rx="14" fill="#2c2c2e"/>' +
    '<rect x="30" y="30" width="60" height="60" rx="4" fill="#fff"/>' +
    '<path fill="#1d1d1f" d="M36 36h10v10H36zM48 36h10v10H48zM74 36h10v10H74zM36 48h10v10H36zM62 48h10v10H62zM48 60h10v10H48zM74 60h10v10H74zM36 74h10v10H36zM62 74h10v10H62zM74 74h10v10H74z"/>' +
    '<path fill="none" stroke="#ffd60a" stroke-width="3" stroke-linecap="round" d="M12 26V16a4 4 0 0 1 4-4h10M94 12h10a4 4 0 0 1 4 4v10M108 94v10a4 4 0 0 1-4 4H94M26 108H16a4 4 0 0 1-4-4V94"/>' +
    '</svg>';

  function demoNote(state, text) {
    return state.demo && text ? '<p class="sp-fine sp-demo-note">' + esc(text) + '</p>' : '';
  }

  function renderCardStart(state) {
    return (
      '<main class="sp-main sp-main-center sp-card-start">' +
      '<div class="sp-brand">FullVision</div>' +
      '<h1 class="sp-big"><span class="sp-narrow">Scan the code on your card</span>' +
      '<span class="sp-wide">Type the code on your card</span></h1>' +
      '<div class="sp-narrow">' +
      SCAN_PICTURE +
      '</div>' +
      '<form class="sp-card-form" data-form="card" novalidate>' +
      '<div class="sp-or sp-narrow">or type it</div>' +
      '<label class="sp-sub-label sp-card-label" for="sp-code">Card Code</label>' +
      '<input id="sp-code" class="sp-input sp-card-code" inputmode="text" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="9" value="' +
      esc(state.typed) +
      '">' +
      (state.message ? '<p class="sp-msg" role="alert">' + esc(state.message) + '</p>' : '') +
      demoNote(state, 'This is Demo Mode. Any code opens the sample card.') +
      '<button type="submit" class="sp-btn sp-btn-primary">Continue</button>' +
      '</form>' +
      '</main>'
    );
  }

  /* ── Is This You? ──────────────────────────────────────────── */

  function demoHint(state) {
    if (!state.demo || !demo) return '';
    if (state.data.check === 'password')
      return 'This is Demo Mode. The password on the sample card is ' + DEMO.password + '.';
    return (
      'This is Demo Mode. Cece’s birthday is ' +
      fmtDate(demoBirthday(), { month: 'long', day: 'numeric', year: 'numeric' }) +
      ' and her student number is ' +
      DEMO.number +
      '.'
    );
  }

  function renderCardCheck(state) {
    var d = state.data;
    var first = (d.student && d.student.first_name) || '';
    return (
      header(className(d.course), TITLE) +
      '<main class="sp-main sp-main-center">' +
      '<section class="sp-card sp-hello">' +
      '<div class="sp-avatar" aria-hidden="true">' +
      esc(first.charAt(0).toUpperCase()) +
      '</div>' +
      '<h1 class="sp-big">' +
      esc('Is this you, ' + first + '?') +
      '</h1>' +
      '<p class="sp-lead">This page is just for you.</p>' +
      (d.check ? '<div class="sp-ident sp-ident-card">' + identityFields(state) + '</div>' : '') +
      '</section>' +
      '<button type="button" class="sp-btn sp-btn-primary" data-act="card-yes"' +
      (state.sending ? ' disabled' : '') +
      '>' +
      (state.sending ? 'Checking…' : 'Yes, That’s Me') +
      '</button>' +
      '<button type="button" class="sp-btn sp-btn-line" data-act="card-notme">No, That’s Not Me</button>' +
      demoNote(state, demoHint(state)) +
      codeBox(state, 'No camera? Type the code on your card', false, 'card') +
      '</main>'
    );
  }

  function renderCardNotMe(state) {
    return (
      header((state.data && className(state.data.course)) || TITLE, state.data ? TITLE : 'FullVision') +
      '<main class="sp-main sp-main-center sp-main-middle">' +
      '<section class="sp-card sp-hello"><h1 class="sp-big">Give This Card Back</h1>' +
      '<p class="sp-lead">This card is for someone else. Give it back to your teacher and ask for your own.</p></section>' +
      '<button type="button" class="sp-btn sp-btn-line" data-act="card-restart">Type a Different Code</button>' +
      '</main>'
    );
  }

  function renderCardMessage(state) {
    return (
      header(TITLE, 'FullVision') +
      '<main class="sp-main sp-main-center">' +
      '<section class="sp-card sp-hello"><p class="sp-lead" role="alert">' +
      esc(state.message) +
      '</p></section>' +
      '<button type="button" class="sp-btn sp-btn-line" data-act="card-restart">Type a Different Code</button>' +
      '</main>'
    );
  }

  /* ── The student's page for one class ──────────────────────── */

  /* The frame every tab of the page sits in: the class, then the tab's own
     body. assignments.js draws the first tab. */
  function pageFrame(state, body) {
    var course = (state.page && state.page.course) || {};
    return (
      header(className(course), TITLE) +
      '<main class="sp-main sp-page">' +
      body +
      demoNote(state, 'This is Demo Mode. Cece and her results are samples.') +
      '</main>'
    );
  }

  /* ── Demo Mode: the three answers, built on the device ─────── */

  var DEMO = { code: 'P3R8WD', number: '1234567', password: '4821', tries: 5 };
  // Which demo is running: { hash, check, system, wrong }. Null outside Demo Mode.
  var demo = null;

  function isoDay(offset) {
    var t = new Date();
    t.setDate(t.getDate() + offset);
    return (
      t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0')
    );
  }

  // Cece is in Grade 8.
  function demoBirthday() {
    return new Date().getFullYear() - 13 + '-03-14';
  }

  /* The sample class as the server holds it: each piece of work with the
     teacher's working copy and its Draft or Returned record (grade_return,
     plan 1.2). Some work is returned, some is a draft, one returned grade
     has a newer draft over it, and some is not graded. */
  function demoClass() {
    function level(tagId, value, modifier) {
      return { tag_id: tagId, value: value, modifier: modifier || 0, comment: null };
    }
    function criterion(id, value, modifier) {
      return { criterion_id: id, value: value, modifier: modifier || 0, comment: null };
    }
    function at(offset) {
      return isoDay(offset) + 'T20:15:00Z';
    }
    return {
      student: { enrollment_id: 'demo-cece', first_name: 'Cece' },
      course: { id: 'demo-science-8', name: 'Science 8', block: 'B', grading_scale: null },
      rubrics: [
        {
          id: 'demo-rubric-lab',
          criteria: [
            { id: 'demo-crit-method', name: 'Method', weight: 1 },
            { id: 'demo-crit-drawing', name: 'Labelled Drawing', weight: 1 },
          ],
        },
      ],
      work: [
        {
          id: 'demo-fair',
          title: 'Science Fair Proposal',
          date: isoDay(-1),
          due_date: isoDay(4),
          tag_ids: ['demo-qp', 'demo-pc'],
        },
        {
          // A draft, never returned: the student sees the piece and its date only.
          id: 'demo-poster',
          title: 'Disease Research Poster',
          date: isoDay(-9),
          due_date: isoDay(-2),
          tag_ids: ['demo-pa', 'demo-com'],
          working: {
            score: { value: null, comment: 'Draft: two of your sources are missing.' },
            tag_scores: [level('demo-pa', 1), level('demo-com', 1)],
          },
          ret: { is_draft: true, returned_at: null, returned_copy: null },
        },
        {
          id: 'demo-quick',
          title: 'Immune System Quick Check',
          date: isoDay(-7),
          due_date: isoDay(-5),
          score_mode: 'points',
          max_points: 12,
          status: 'NS',
        },
        {
          id: 'demo-energy',
          title: 'Energy Transfer Investigation',
          date: isoDay(-13),
          due_date: isoDay(-8),
          tag_ids: ['demo-pa'],
          working: {
            score: { value: null, comment: 'Your data table shows every transfer. Well done.' },
            tag_scores: [level('demo-pa', 4)],
          },
          ret: { is_draft: false, returned_at: at(-6), returned_copy: null },
        },
        {
          id: 'demo-quiz',
          title: 'Cell Structure Quiz',
          date: isoDay(-11),
          due_date: isoDay(-11),
          score_mode: 'points',
          max_points: 10,
          working: { score: { value: 8, comment: '' } },
          ret: { is_draft: false, returned_at: at(-9), returned_copy: null },
        },
        {
          id: 'demo-lab',
          title: 'Cell Microscope Lab',
          date: isoDay(-18),
          due_date: isoDay(-14),
          rubric_id: 'demo-rubric-lab',
          tag_ids: ['demo-qp', 'demo-pc'],
          working: {
            score: { value: null, comment: 'Careful focusing. Label the nucleus next time.' },
            rubric_scores: [criterion('demo-crit-method', 3), criterion('demo-crit-drawing', 2, 1)],
          },
          ret: { is_draft: false, returned_at: at(-10), returned_copy: null },
        },
        {
          // Returned, then changed: the change waits as a draft and the
          // student keeps the grade that was returned.
          id: 'demo-essay',
          title: 'Ecosystem Connections Essay',
          date: isoDay(-24),
          due_date: isoDay(-17),
          tag_ids: ['demo-com'],
          working: {
            score: { value: null, comment: 'Draft: much clearer after your rewrite.' },
            tag_scores: [level('demo-com', 3, 1)],
          },
          ret: {
            is_draft: true,
            returned_at: at(-14),
            returned_copy: {
              score: { value: null, comment: 'Explain how the food web changes when one species goes.' },
              tag_scores: [level('demo-com', 2)],
            },
          },
        },
        {
          id: 'demo-kmt',
          title: 'KMT & States of Matter Lab',
          date: isoDay(-27),
          due_date: isoDay(-22),
          tag_ids: ['demo-pc'],
          status: 'LATE',
          working: { score: { value: null, comment: '' }, tag_scores: [level('demo-pc', 3)] },
          ret: { is_draft: false, returned_at: at(-19), returned_copy: null },
        },
        {
          id: 'demo-contract',
          title: 'Lab Safety Contract',
          date: isoDay(-32),
          due_date: isoDay(-30),
          score_mode: 'complete',
          working: { score: { value: 1, comment: '' } },
          ret: { is_draft: false, returned_at: at(-29), returned_copy: null },
        },
      ],
    };
  }

  /* Demo Mode's stand-in for the server's one reader of a student's grade
     (student_submit._returned_grade, plan 1.2): nothing for a grade never
     returned, the returned copy while a newer draft waits, the working copy
     otherwise. */
  function returnedGrade(work) {
    var ret = work.ret;
    if (!ret || !ret.returned_at || !work.working) return null;
    var grade = ret.is_draft ? ret.returned_copy : work.working;
    if (!grade) return null;
    return {
      score: grade.score || { value: null, comment: '' },
      tag_scores: grade.tag_scores || [],
      rubric_scores: grade.rubric_scores || [],
    };
  }

  /* The `page` reply for the sample class, in the server's shape. A draft is
     in none of it. `system`: proficiency, letter or both. */
  function demoPage(system) {
    var cls = demoClass();
    return {
      ok: true,
      v: 1,
      student: cls.student,
      course: Object.assign({}, cls.course, { grading_system: system || 'proficiency' }),
      rubrics: cls.rubrics,
      assessments: cls.work.map(function (w) {
        var grade = returnedGrade(w);
        return {
          id: w.id,
          title: w.title,
          date: w.date,
          due_date: w.due_date || null,
          score_mode: w.score_mode || 'proficiency',
          max_points: w.max_points || null,
          weight: 1,
          tag_ids: w.tag_ids || [],
          rubric_id: w.rubric_id || null,
          // Missing, Excused and Late are never drafts: they show at once.
          status: w.status || null,
          returned_at: grade ? w.ret.returned_at : null,
          grade: grade,
        };
      }),
    };
  }

  function demoCard() {
    if (demo.wrong >= DEMO.tries) return { ok: false, error: 'card_locked' };
    return {
      ok: true,
      kind: 'card',
      token: 'demo',
      student: { first_name: 'Cece' },
      course: { name: 'Science 8', block: 'B' },
      check: demo.check,
      also_password: false,
    };
  }

  // Five wrong tries lock the card, as the server does.
  function demoVerify(body) {
    var right =
      demo.check === 'password'
        ? body.password === DEMO.password
        : body.birthday === demoBirthday() || body.student_number === DEMO.number;
    if (right) return { ok: true };
    demo.wrong += 1;
    if (demo.wrong >= DEMO.tries) return { ok: false, error: 'card_locked' };
    return { ok: false, error: 'wrong_identity', tries_left: DEMO.tries - demo.wrong };
  }

  var DEMO_ANSWERS = {
    card: demoCard,
    verify: demoVerify,
    page: function () {
      return demoPage(demo.system);
    },
  };

  /* ── Flow ──────────────────────────────────────────────────── */

  /* The card path's three questions: `card` (a code in; whose card, which
     class and which check out), `verify` (the identity check) and `page`
     (the student's page for one class). Demo Mode answers on the device.
     S0-W1 sends the rest to the edge function; until then nothing but Demo
     Mode reaches a screen that asks. */
  function ask(route, body) {
    var answer = S.demo && demo ? DEMO_ANSWERS[route] : null;
    return Promise.resolve(answer ? answer(body || {}) : { ok: false, error: 'not_found' });
  }

  function cardMessage(res) {
    return res && res.error === 'not_found' ? MESSAGES.card_not_found : messageFor(res);
  }

  function setTitle() {
    if (typeof document !== 'undefined') document.title = TITLE + ' — FullVision';
  }

  function openCard(typed) {
    var c = cleanCode(typed);
    S.typed = prettyCode(c);
    if (!isCode(c)) {
      S.message = MESSAGES.card_not_found;
      S.screen = 'cardstart';
      paint('#sp-code');
      return Promise.resolve();
    }
    S.message = '';
    if (!S.demo) {
      S.screen = 'loading';
      paint();
    }
    return ask('card', { code: c }).then(function (res) {
      if (res && res.ok && res.kind === 'card') {
        S.data = res;
        S.number = '';
        S.bday = { m: '', d: '', y: '' };
        S.typed = '';
        S.screen = 'cardcheck';
      } else {
        S.message = cardMessage(res);
        S.screen = res && res.error === 'card_locked' ? 'cardmessage' : 'cardstart';
      }
      paint();
    });
  }

  /* calc.js and what it reads, for a copy of index.html from before student
     cards, which names none of them. */
  function whenGradesAreIn() {
    var need = [];
    if (typeof PROF_LABELS === 'undefined') need.push('../shared/constants.js');
    if (typeof assessmentCellValue !== 'function') need.push('../shared/calc.js');
    if (typeof StudentData === 'undefined') need.push('student-data.js');
    if (!need.length || typeof document === 'undefined') return Promise.resolve();
    return new Promise(function (done) {
      var left = need.length;
      need.forEach(function (src) {
        var s = document.createElement('script');
        s.src = src;
        s.async = false; // in this order
        s.onload = s.onerror = function () {
          left -= 1;
          if (!left) done();
        };
        document.head.appendChild(s);
      });
    });
  }

  function gradesAreIn() {
    return typeof assessmentCellValue === 'function' && typeof StudentData !== 'undefined';
  }

  /* After the check: the student's page for the card's class. */
  function openPage() {
    if (!S.demo) {
      S.screen = 'loading';
      paint();
    }
    return whenGradesAreIn()
      .then(function () {
        return gradesAreIn() ? ask('page', {}) : { ok: false, error: 'network' };
      })
      .then(function (res) {
        if (res && res.ok) {
          S.page = StudentData.fromServer(res);
          StudentData.use(S.page);
          S.message = '';
          S.screen = 'assignments';
        } else {
          S.message = cardMessage(res);
          S.screen = 'cardmessage';
        }
        paint();
        window.scrollTo(0, 0);
      });
  }

  function checkCard() {
    var token = S.data.token;
    return verifyIdentity({
      send: function (ident) {
        return ask('verify', Object.assign({ token: token }, ident));
      },
      ok: openPage,
      messageScreen: 'cardmessage',
    });
  }

  function startDemo(hash) {
    var m = /^demo-card(?:-(password|letter|both))?$/i.exec(hash || '');
    if (!m) return false;
    var kind = (m[1] || '').toLowerCase();
    demo = {
      hash: hash,
      check: kind === 'password' ? 'password' : 'identity',
      system: kind === 'letter' || kind === 'both' ? kind : 'proficiency',
      wrong: 0,
    };
    S.demo = true;
    S.typed = prettyCode(DEMO.code);
    S.screen = 'cardstart';
    setTitle();
    paint();
    return true;
  }

  // Back to the card's code, with nothing kept from the last student.
  function restartCard() {
    var hash = demo && demo.hash;
    StudentPage.reset();
    if (typeof StudentData !== 'undefined') StudentData.use(null);
    if (hash && startDemo(hash)) return;
    S.screen = 'cardstart';
    paint('#sp-code');
  }

  function onClick(act) {
    if (act === 'card-yes') {
      checkCard();
    } else if (act === 'card-notme') {
      S.message = '';
      S.screen = 'cardnotme';
      paint();
    } else if (act === 'card-restart') {
      restartCard();
    }
  }

  function onSubmit(name, form) {
    if (name !== 'card') return;
    var input = form.querySelector('#sp-code');
    openCard(input ? input.value : '');
  }

  StudentPage.pageFrame = pageFrame;

  StudentPage.addScreens({
    file: 'app',
    render: {
      cardstart: renderCardStart,
      cardcheck: renderCardCheck,
      cardnotme: renderCardNotMe,
      cardmessage: renderCardMessage,
    },
    click: onClick,
    submit: onSubmit,
    start: function (hash) {
      demo = null;
      return startDemo(hash);
    },
    share: function (state) {
      S = state;
    },
    test: {
      demoClass: demoClass,
      demoPage: demoPage,
      demoBirthday: demoBirthday,
      returnedGrade: returnedGrade,
      openCard: openCard,
      checkCard: checkCard,
      DEMO: DEMO,
    },
  });
})();
