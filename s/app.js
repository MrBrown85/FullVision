/* A student card on the student page (docs/plans/student-page-build-plan.md,
   S0-F3; the artboard's "Scan or Type Your Card", "Is This You? Birthday or
   Student Number" and "Is This You? Card Password"): the card's code, the
   identity check, then the student's page for one class, which opens on the
   Assignments list (assignments.js).

   A card is not a slip. A slip opens one questionnaire or one report; a card
   opens the student's page for the course. The boards draw both codes as six
   characters, so the page does not guess from the shape: the server tells
   (`kind: 'card'`).

   The card path asks the student-submit edge function five things, each
   one route (supabase/functions/student-submit/card-routes.ts):
     card    a code in; whose card, which class and which check out
     verify  the code again with what the student typed; a session out
     page    the student's page for one class of the session
     seen    the returned pieces the student has opened
     done    Done: the session ends
   `ask` is the one place they are asked. Demo Mode (#demo-card;
   #demo-card-password for the card's password; #demo-card-letter and
   #demo-card-both for a class graded by letter or both) answers all five
   on the device in the shapes the function uses, and calls nothing; every
   screen and every step after `ask` is the same code for both.

   The session. A right answer to Is This You? starts one; the function
   gives back a token, and that token is the only thing this page keeps on
   the device (localStorage, with the time it ends and the id of the class
   it opens: no name, code, birthday or grade). It lasts until midnight
   where the class is, or until Done. While it lasts, opening the page
   again opens the student's page without the card. A card scanned or typed
   from the start signs the last student out first (Colin, Nov 9: "start
   fresh"), so two students on one Chromebook never share a session. The
   card's code leaves the address as soon as the card is recognised.

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
      (state.message
        ? state.calm
          ? '<p class="sp-msg sp-msg-calm" role="status">' + esc(state.message) + '</p>'
          : '<p class="sp-msg" role="alert">' + esc(state.message) + '</p>'
        : '') +
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
      (state.again
        ? '<button type="button" class="sp-btn sp-btn-primary" data-act="page-retry"' +
          (state.sending ? ' disabled' : '') +
          '>' +
          (state.sending ? 'Loading…' : 'Try Again') +
          '</button>'
        : '') +
      '<button type="button" class="sp-btn sp-btn-line" data-act="card-restart">Type a Different Code</button>' +
      '</main>'
    );
  }

  /* ── The student's page for one class ──────────────────────── */

  /* The frame every tab of the page sits in: the class and Done, which
     stay in reach as the page scrolls, then the tab's own body.
     assignments.js draws the first tab. */
  function pageFrame(state, body) {
    var course = (state.page && state.page.course) || {};
    return (
      '<header class="sp-head sp-head-page"><div class="sp-head-words"><div class="sp-head-title">' +
      esc(className(course)) +
      '</div><div class="sp-head-sub">' +
      esc(TITLE) +
      '</div></div>' +
      '<button type="button" class="sp-btn sp-btn-quiet sp-btn-small sp-done" data-act="card-done">Done</button>' +
      '</header>' +
      '<main class="sp-main sp-page">' +
      body +
      demoNote(state, 'This is Demo Mode. Cece and her results are samples.') +
      '</main>'
    );
  }

  /* ── Demo Mode: the three answers, built on the device ─────── */

  var DEMO = { code: 'P3R8WD', number: '1234567', password: '4821', tries: 5 };
  // Which demo is running: { hash, check, system, wrong, seen }. Null outside Demo Mode.
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
          name: 'Lab Report',
          style: 'simple',
          criteria: [
            { id: 'demo-crit-method', name: 'Method', weight: 1, checks: [] },
            { id: 'demo-crit-drawing', name: 'Labelled Drawing', weight: 1, checks: [] },
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
          // Returned as Incomplete, then changed and returned again: Updated,
          // until the student has opened it.
          id: 'demo-contract',
          title: 'Lab Safety Contract',
          date: isoDay(-32),
          due_date: isoDay(-30),
          score_mode: 'complete',
          working: { score: { value: 1, comment: '' } },
          ret: {
            is_draft: false,
            returned_at: at(-3),
            returned_copy: null,
            previous_copy: { score: { value: 0, comment: '' } },
            updated_at: at(-3),
            seen_at: at(-20),
          },
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
    return demoRows(grade);
  }

  /* A grade's rows as the copy the server sends (migrations/
     2026110902_grade_return.sql, 3): the score, its + or −, the Overall
     Comment, a level per competency, a level per criterion, the ticks. */
  function copyOf(rows) {
    if (!rows) return null;
    var score = rows.score || {};
    function level(r, criterion) {
      var out = { value: r.value, modifier: r.modifier || 0, comment: r.comment || null };
      if (criterion) out.beyond = r.beyond || null;
      return out;
    }
    var copy = {
      v: 1,
      value: score.value == null ? null : score.value,
      modifier: score.value == null ? 0 : score.modifier || 0,
      comment: score.comment || null,
      tags: {},
      criteria: {},
      checks: [],
    };
    (rows.tag_scores || []).forEach(function (r) {
      copy.tags[r.tag_id] = level(r, false);
    });
    (rows.rubric_scores || []).forEach(function (r) {
      copy.criteria[r.criterion_id] = level(r, true);
    });
    return copy;
  }

  function demoRows(grade) {
    return {
      score: grade.score || { value: null, comment: '' },
      tag_scores: grade.tag_scores || [],
      rubric_scores: grade.rubric_scores || [],
    };
  }

  function demoKlass(cls) {
    return {
      enrollment_id: cls.student.enrollment_id,
      student: { first_name: cls.student.first_name },
      course: { name: cls.course.name, block: cls.course.block },
    };
  }

  // The next midnight on this device: when a session ends.
  function nextMidnight() {
    var t = new Date();
    t.setHours(24, 0, 0, 0);
    return t.toISOString();
  }

  /* The `page` reply for the sample class, in the server's shape
     (student_submit.page). A draft is in none of it. `system`:
     proficiency, letter or both. The one thing here the server does not
     send is the class's id; the page needs none and gives a real class a
     key of its own. */
  function demoPage(system) {
    var cls = demoClass();
    var seen = (demo && demo.seen) || {};
    return {
      ok: true,
      v: 1,
      expires_at: nextMidnight(),
      student: cls.student,
      course: Object.assign({}, cls.course, {
        grading_system: system || 'proficiency',
        level_order: 'desc',
        round_percent: null,
      }),
      classes: [demoKlass(cls)],
      tags: {},
      rubrics: cls.rubrics,
      assessments: cls.work.map(function (w) {
        var rows = returnedGrade(w);
        // Missing and Excused win at once: no grade is sent under either.
        var hidden = w.status === 'NS' || w.status === 'EXC';
        var back = rows ? w.ret : null;
        return {
          id: w.id,
          title: w.title,
          date: w.date,
          due_date: w.due_date || null,
          score_mode: w.score_mode || 'proficiency',
          max_points: w.max_points || null,
          weight: 1,
          rubric_id: w.rubric_id || null,
          tag_ids: w.tag_ids || [],
          // Missing, Excused and Late are never drafts: they show at once.
          status: w.status || null,
          returned_at: back ? back.returned_at : null,
          updated_at: (back && back.updated_at) || null,
          seen_at: seen[w.id] || (back && back.seen_at) || null,
          grade: hidden ? null : copyOf(rows),
          previous: hidden || !back || !back.previous_copy ? null : copyOf(demoRows(back.previous_copy)),
        };
      }),
    };
  }

  function demoCard() {
    if (demo.wrong >= DEMO.tries) return { ok: false, error: 'card_locked' };
    return {
      ok: true,
      kind: 'card',
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
    if (right) {
      var cls = demoClass();
      return {
        ok: true,
        session_token: 'demo',
        expires_at: nextMidnight(),
        enrollment_id: cls.student.enrollment_id,
        classes: [demoKlass(cls)],
      };
    }
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
    seen: function (body) {
      var ids = body.assessment_ids || [];
      ids.forEach(function (id) {
        demo.seen[id] = new Date().toISOString();
      });
      return { ok: true, seen: ids.length };
    },
    done: function () {
      return { ok: true };
    },
  };

  /* ── Asking ────────────────────────────────────────────────── */

  /* The card path's five questions (the top of this file). Demo Mode
     answers on the device and nothing is sent; a real card asks the edge
     function, the way a slip does (student.js's `call`: pinned to
     ca-central-1, no key, nothing in the address). A failed call comes back
     as { ok: false, error: 'network' }. */
  function ask(route, body) {
    if (S.demo) {
      var answer = demo ? DEMO_ANSWERS[route] : null;
      return Promise.resolve(answer ? answer(body || {}) : { ok: false, error: 'not_found' });
    }
    return StudentPage.call(Object.assign({ route: route }, body));
  }

  /* A refusal's words. A card that won't open says why (Colin, Nov 9). A
     call that never arrived, or an answer this page has no words for, says
     to check the internet and try again. */
  var CARD_WORDS = {
    not_found: 'card_not_found',
    closed: 'card_closed',
    card_locked: 'card_locked',
    card_expired: 'card_expired',
    reprint: 'card_reprint',
    card_stopped: 'card_stopped',
    locked: 'locked',
    signed_out: 'signed_out',
  };
  function cardMessage(res) {
    var e = res && !res.ok ? res.error : '';
    return MESSAGES[(Object.prototype.hasOwnProperty.call(CARD_WORDS, e) && CARD_WORDS[e]) || 'card_network'];
  }
  // Whether the function itself refused (true), or the call never arrived.
  function refusedByFunction(res) {
    return !!(res && !res.ok && Object.prototype.hasOwnProperty.call(CARD_WORDS, res.error));
  }

  function setTitle() {
    if (typeof document !== 'undefined') document.title = TITLE + ' — FullVision';
  }

  /* ── The session on this device ────────────────────────────── */

  /* { token, expires, enrollment, kept }: the session this tab is showing.
     `kept` is true once it is in localStorage, where the next visit and the
     device's other tabs read it. Nothing else of the card path is stored. */
  var SESSION_KEY = 'fv-s-session';
  var session = null;
  // The last student's token: sent with the next check, so the server ends it.
  var ending = '';
  var timer = 0;

  function readStored() {
    try {
      var v = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      if (!v || !/^[0-9a-f]{64}$/.test(String(v.t || '')) || typeof v.e !== 'string' || !v.e) return null;
      var stored = { token: v.t, expires: String(v.x || ''), enrollment: v.e, kept: true };
      return endsAt(stored) == null ? null : stored;
    } catch (e) {
      return null; // no storage (a private window): the session lasts while this tab is open
    }
  }

  // When a session ends (its midnight), in milliseconds, or null if unreadable.
  function endsAt(s) {
    var t = Date.parse(String(s.expires).replace(/(\.\d{3})\d+/, '$1'));
    return isFinite(t) ? t : null;
  }

  function isOver(s, now) {
    var t = endsAt(s);
    return t != null && t <= (now == null ? Date.now() : now);
  }

  // Kept only with an end this page can read, so nothing stays past its midnight.
  function keep(s) {
    s.kept = false;
    if (endsAt(s) == null || isOver(s)) return;
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({ t: s.token, x: s.expires, e: s.enrollment }));
      s.kept = !!readStored();
    } catch (e) {
      /* a private window: this tab only */
    }
  }

  // `stored` false leaves another student's session, kept by another tab, where it is.
  function forget(stored) {
    session = null;
    if (timer && typeof clearInterval === 'function') clearInterval(timer);
    timer = 0;
    if (stored === false) return;
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch (e) {
      /* nothing kept */
    }
  }

  // Done on the server: the session's row is deleted. Nothing waits on it.
  function endOnServer(token) {
    if (token) ask('done', { session: token });
  }

  /* A card was recognised: whoever was signed in on this device is signed
     out now, before Is This You? is drawn, so nothing of theirs can be
     opened again from this device whether or not the check is passed. The
     token also goes with the check, in case this Done never arrived. */
  function leaveLast() {
    if (S.demo) return;
    var shown = session;
    var stored = readStored();
    if (!shown && !stored) return;
    ending = (stored || shown).token;
    endOnServer(ending);
    if (shown && shown.token !== ending) endOnServer(shown.token);
    forget();
    if (typeof StudentData !== 'undefined') StudentData.use(null);
    S.page = null;
  }

  /* Signed out: the session is forgotten, the page's data is dropped and
     the card's first screen is drawn, with `message` if the student did not
     ask for it. Demo Mode starts the sample again. */
  function leave(message, stored) {
    var hash = demo && demo.hash;
    // Demo Mode keeps nothing, and leaves a real session on the device alone.
    forget(S.demo ? false : stored);
    StudentPage.reset();
    if (typeof StudentData !== 'undefined') StudentData.use(null);
    if (hash && startDemo(hash)) return;
    S.screen = 'cardstart';
    S.message = message || '';
    S.calm = !!message;
    setTitle();
    paint('#sp-code');
  }

  /* Is the session this tab shows still the device's? Asked every few
     seconds while a page is open, and when the tab is shown again (a laptop
     opened after midnight, the Back button, another tab's Done). */
  function checkSession(now) {
    if (!session || S.demo) return;
    if (isOver(session, now)) {
      leave(MESSAGES.signed_out);
      return;
    }
    if (!session.kept) return;
    var stored = readStored();
    // Done in another tab, or another student signed in there.
    if (!stored) leave(MESSAGES.signed_out);
    else if (stored.token !== session.token) leave(MESSAGES.signed_out, false);
  }

  function watch() {
    if (timer || S.demo || typeof setInterval !== 'function') return;
    timer = setInterval(checkSession, 20000);
  }

  /* ── Flow ──────────────────────────────────────────────────── */

  /* What `card` said about a code: true when it is a card and its screen is
     drawn (Is This You?, or why the card won't open), false when it is not
     a card, 'locked' when this address has made too many wrong tries. */
  function cardSaid(res) {
    if (res && res.ok && res.kind === 'card') {
      leaveLast();
      S.data = res;
      S.number = '';
      S.bday = { m: '', d: '', y: '' };
      S.typed = '';
      S.message = '';
      S.again = false;
      S.screen = 'cardcheck';
    } else {
      var e = res && !res.ok ? res.error : '';
      if (e === 'locked') return 'locked';
      if (e !== 'closed' && e !== 'card_locked' && e !== 'card_expired' && e !== 'reprint') return false;
      S.message = cardMessage(res);
      S.again = false;
      S.screen = 'cardmessage';
    }
    // The code leaves the address: it is not left in the bar or for Back.
    if (!S.demo) {
      try {
        history.replaceState(null, '', location.pathname);
      } catch (err) {
        /* fine */
      }
    }
    setTitle();
    paint();
    return true;
  }

  /* student.js asks this of every typed or scanned code before it opens it
     as a slip. Demo Mode's questionnaire and report pages ask nothing. */
  function card(code) {
    if (S.demo) return Promise.resolve(false);
    return ask('card', { code: code }).then(cardSaid);
  }

  /* A code typed on a card's screen that opened nothing, card or slip:
     said here, in the card's words. A slip's own answer (used, closed, not
     open yet) is left to the slip's screen. */
  function refused(res) {
    var e = (res && !res.ok && res.error) || 'network';
    if (e !== 'not_found' && e !== 'locked' && e !== 'network' && MESSAGES[e]) return false;
    S.message = cardMessage({ ok: false, error: e });
    S.calm = false;
    S.screen = 'cardstart';
    setTitle();
    paint('#sp-code');
    return true;
  }

  // The code typed on a card's screen.
  function openCard(typed) {
    var c = cleanCode(typed);
    S.typed = prettyCode(c);
    if (!isCode(c)) {
      S.message = MESSAGES.card_not_found;
      S.calm = false;
      S.screen = 'cardstart';
      paint('#sp-code');
      return Promise.resolve();
    }
    S.message = '';
    // A real code may be a slip's: student.js asks `card`, then `open`.
    if (!S.demo) return StudentPage.openCode(c, 'card');
    S.code = c;
    return ask('card', { code: c }).then(function (res) {
      if (cardSaid(res) !== true) refused(res);
    });
  }

  /* shared/constants.js and shared/calc.js work out and word a result. They
     are fetched here, when a screen that shows a grade is about to open, so
     a questionnaire or report slip never loads them (plan, section 5: the
     page stays light on a school Chromebook). A file already in is not
     fetched again; one that failed is tried again on the next call.
     student-data.js comes with the page; it is fetched here only for a copy
     of index.html from before student cards. */
  var GRADE_FILES = [
    [
      'student-data.js',
      function () {
        return typeof StudentData !== 'undefined';
      },
    ],
    [
      '../shared/constants.js',
      function () {
        return typeof PROF_LABELS !== 'undefined';
      },
    ],
    [
      '../shared/calc.js',
      function () {
        return typeof assessmentCellValue === 'function';
      },
    ],
  ];
  var fetching = null;

  function whenGradesAreIn() {
    if (fetching) return fetching;
    var need = GRADE_FILES.filter(function (f) {
      return !f[1]();
    });
    if (!need.length || typeof document === 'undefined') return Promise.resolve();
    fetching = new Promise(function (done) {
      var left = need.length;
      need.forEach(function (f) {
        var s = document.createElement('script');
        s.src = f[0];
        s.async = false; // run in this order
        s.onload = s.onerror = function () {
          left -= 1;
          if (left) return;
          fetching = null;
          done();
        };
        document.head.appendChild(s);
      });
    });
    return fetching;
  }

  /* The pieces whose result the list has just drawn, told to the server
     once each (assignments.js's `opened`): what marks a grade Updated the
     next time it changes. A session that has ended signs this tab out. */
  function tellSeen() {
    var page = S.page;
    var ids = page && session && StudentPage.opened ? StudentPage.opened(page).slice(0, 500) : [];
    if (!ids.length) return Promise.resolve();
    return ask('seen', { session: session.token, enrollment_id: session.enrollment, assessment_ids: ids }).then(
      function (res) {
        if (res && res.ok) {
          page.assessments.forEach(function (a) {
            if (ids.indexOf(a.id) >= 0) a.unseen = false;
          });
        } else if (res && res.error === 'signed_out' && S.page === page) {
          leave(MESSAGES.signed_out);
        }
      },
    );
  }

  /* `page` would not open. A session that has ended goes back to the card's
     first screen; a card or class that can no longer open says why, and the
     session is dropped; a call that never arrived keeps the session and
     offers Try Again. */
  var PAGE_WORDS = {
    not_found: 'card_gone',
    card_stopped: 'card_stopped',
    card_expired: 'card_expired',
    closed: 'card_closed',
  };
  function pageRefused(res) {
    var e = res && !res.ok ? res.error : '';
    if (e === 'signed_out') {
      leave(MESSAGES.signed_out);
      return;
    }
    var words = Object.prototype.hasOwnProperty.call(PAGE_WORDS, e) ? PAGE_WORDS[e] : '';
    if (words && session) {
      endOnServer(session.token);
      forget();
    }
    S.page = null;
    if (typeof StudentData !== 'undefined') StudentData.use(null);
    S.message = MESSAGES[words || 'card_network'];
    S.again = !words;
    S.screen = 'cardmessage';
    paint();
  }

  /* The student's page for the session's class. The screen that asked stays
     up (Is This You? with its button reading Checking, or the loading
     screen) until the page's data and calc.js are both in, so the list is
     drawn once, with its results. If calc.js can't be fetched the list
     still opens, without results (assignments.js says so and offers Try
     Again). */
  function openPage() {
    if (!session) {
      leave('');
      return Promise.resolve();
    }
    var mine = session;
    S.sending = true;
    S.message = '';
    paint();
    return Promise.all([whenGradesAreIn(), ask('page', { session: mine.token, enrollment_id: mine.enrollment })]).then(
      function (both) {
        var res = both[1];
        S.sending = false;
        // Signed out, or another card scanned, while this was on its way.
        if (session !== mine) return;
        if (!(res && res.ok && typeof StudentData !== 'undefined')) {
          pageRefused(res && res.ok ? { ok: false, error: 'network' } : res);
          return;
        }
        // The session's end as the server has it now.
        if (res.expires_at && String(res.expires_at) !== mine.expires) {
          mine.expires = String(res.expires_at);
          if (mine.kept) keep(mine);
        }
        S.page = StudentData.fromServer(res);
        StudentData.use(S.page);
        // What the student typed to get in is not kept once they are in.
        S.number = '';
        S.bday = { m: '', d: '', y: '' };
        S.again = false;
        S.screen = 'assignments';
        setTitle();
        paint('.sp-page-title');
        window.scrollTo(0, 0);
        watch();
        tellSeen();
      },
    );
  }

  // Try Again on a list whose results didn't load.
  function fetchGradesAgain() {
    S.sending = true;
    paint();
    return whenGradesAreIn().then(function () {
      S.sending = false;
      paint();
      tellSeen();
    });
  }

  /* The check passed: the function has started a session for this device
     and ended the last one. Its token is kept, then the page opens. */
  function signedIn(res) {
    ending = '';
    session = {
      token: String(res.session_token || ''),
      expires: String(res.expires_at || ''),
      enrollment: String(res.enrollment_id || ''),
      kept: false,
    };
    if (!session.token || !session.enrollment) {
      session = null;
      pageRefused({ ok: false, error: 'network' });
      return Promise.resolve();
    }
    if (!S.demo) keep(session);
    return openPage();
  }

  /* Is This You? The code goes again with what the student typed; there is
     no token between `card` and `verify`. */
  function checkCard() {
    var code = S.code;
    return verifyIdentity({
      send: function (ident) {
        var body = Object.assign({ code: code }, ident);
        if (ending) body.session = ending;
        return ask('verify', body);
      },
      ok: signedIn,
      messageScreen: 'cardmessage',
      message: cardMessage,
      stops: refusedByFunction,
    });
  }

  // Done: signed out here at once, with or without the internet.
  function done() {
    if (session) endOnServer(session.token);
    leave('');
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
      seen: {},
    };
    S.demo = true;
    S.typed = prettyCode(DEMO.code);
    S.screen = 'cardstart';
    setTitle();
    paint();
    return true;
  }

  /* The page opened with no code in its address. A device that is signed
     in opens the student's page again; one whose session ran out at
     midnight says so on the card's first screen. Anything else is left to
     student.js (the slip's first screen). */
  function resume() {
    var stored = readStored();
    if (!stored) return false;
    setTitle();
    if (isOver(stored)) {
      leave(MESSAGES.signed_out);
      return true;
    }
    session = stored;
    S.heading = TITLE;
    S.screen = 'loading';
    openPage();
    return true;
  }

  // Back to the card's code, with nothing kept from the last student.
  function restartCard() {
    var hash = demo && demo.hash;
    StudentPage.reset();
    if (typeof StudentData !== 'undefined') StudentData.use(null);
    if (hash && startDemo(hash)) return;
    S.screen = 'cardstart';
    setTitle();
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
    } else if (act === 'card-done') {
      done();
    } else if (act === 'page-retry') {
      openPage();
    } else if (act === 'grades-retry') {
      fetchGradesAgain();
    }
  }

  function onSubmit(name, form) {
    if (name !== 'card') return;
    var input = form.querySelector('#sp-code');
    openCard(input ? input.value : '');
  }

  /* A tab shown again may be showing a session that has since ended: after
     midnight, after Done in another tab, or brought back by the Back
     button. */
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    ['pageshow', 'focus', 'storage'].forEach(function (name) {
      window.addEventListener(name, function () {
        checkSession();
      });
    });
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', function () {
        checkSession();
      });
    }
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
      if (startDemo(hash)) return true;
      // A demo address, or a code to open, is student.js's.
      return hash ? false : resume();
    },
    card: card,
    refused: refused,
    share: function (state) {
      S = state;
    },
    test: {
      demoClass: demoClass,
      demoPage: demoPage,
      demoBirthday: demoBirthday,
      returnedGrade: returnedGrade,
      whenGradesAreIn: whenGradesAreIn,
      openCard: openCard,
      checkCard: checkCard,
      checkSession: checkSession,
      SESSION_KEY: SESSION_KEY,
      DEMO: DEMO,
    },
  });
})();
