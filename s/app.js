/* A student card on the student page (docs/plans/student-page-build-plan.md,
   S0-F3; the artboard's "Scan or Type Your Card", "Is This You? Birthday or
   Student Number" and "Is This You? Card Password"): the card's code, the
   identity check, then the student's page for one class, which opens on the
   Assignments list (assignments.js).

   A card is not a slip. A slip opens one questionnaire or one report; a card
   opens the student's page for the course. A card's code is eight
   characters and a slip's six (Colin, Nov 10), but the page does not guess
   from the shape: the server tells (`kind: 'card'`).

   The card path asks the student-submit edge function six things, each
   one route (supabase/functions/student-submit/card-routes.ts):
     card      a code in; whose card, which class and which check out
     verify    the code again with what the student typed; a session out
     add-card  the same check from Add Another Card: the class joins the
               session this device has (Switching Classes)
     page      the student's page for one class of the session
     seen      the returned pieces the student has opened
     done      Done: the session ends
   `ask` is the one place they are asked. Demo Mode (#demo-card;
   #demo-card-password for the card's password; #demo-card-letter and
   #demo-card-both for a class graded by letter or both) answers all six
   on the device in the shapes the function uses, and calls nothing; every
   screen and every step after `ask` is the same code for both.

   S3-F3 adds the rest of the sign-in boards: After Done, Switching Classes
   (Your Classes and Add Another Card), and on a Chromebook Is This You? as
   one card and Scan the Code With the Camera. The locks (five wrong in a
   row, fifteen in seven days, too many wrong codes from one address) are
   the server's; this page says what the server answers.

   The session. A right answer to Is This You? starts one; the function
   gives back a token, and that token is the only thing this page keeps on
   the device (localStorage, with the time it ends, the id of the class it
   opens and the time the student last touched the page: no name, code,
   birthday or grade). It lasts until midnight where the class is, until
   Done, or until fifteen minutes pass with no activity (Colin, Nov 10).
   While it lasts, opening the page again opens the student's page without
   the card. Any card recognised on the device signs the last student out
   first (Colin, Nov 9: "start fresh"), so two students on one Chromebook
   never share a session. The card's code leaves the address as soon as
   the card is recognised.

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

  /* The card's first screen, and Add Another Card (Switching Classes),
     which is the same screen for a student who is signed in. Adding, the
     phone's own camera is not offered: a code it scans opens the page from
     the start, which signs the student out first (Colin, Nov 9). So the
     code is typed, or on a Chromebook scanned with this page's camera. */
  function renderCardStart(state) {
    var add = !!adding;
    return (
      '<main class="sp-main sp-main-center sp-card-start' +
      (add ? ' sp-card-add' : '') +
      '">' +
      '<div class="sp-brand">FullVision</div>' +
      (add
        ? '<h1 class="sp-big" tabindex="-1">Add Another Card</h1>' +
          '<p class="sp-lead">Type the code on the card for your other class.</p>'
        : '<h1 class="sp-big"><span class="sp-narrow">Scan the code on your card</span>' +
          '<span class="sp-wide">Type the code on your card</span></h1>' +
          '<div class="sp-narrow">' +
          SCAN_PICTURE +
          '</div>') +
      '<form class="sp-card-form" data-form="card" novalidate>' +
      (add ? '' : '<div class="sp-or sp-narrow">or type it</div>') +
      '<label class="sp-sub-label sp-card-label" for="sp-code">Card Code</label>' +
      '<input id="sp-code" class="sp-input sp-card-code" inputmode="text" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="9" value="' +
      esc(state.typed) +
      '">' +
      (state.message
        ? state.calm
          ? '<p class="sp-msg sp-msg-calm" role="status">' + esc(state.message) + '</p>'
          : '<p class="sp-msg" role="alert">' + esc(state.message) + '</p>'
        : '') +
      demoNote(
        state,
        add
          ? 'This is Demo Mode. Any code adds a second sample class.'
          : 'This is Demo Mode. Any code opens the sample card.',
      ) +
      '<button type="submit" class="sp-btn sp-btn-primary">Continue</button>' +
      '</form>' +
      (canScan()
        ? '<div class="sp-or-line sp-wide-block" aria-hidden="true">or</div>' +
          '<button type="button" class="sp-btn sp-btn-tint sp-wide-block" data-act="card-camera">Scan the Code With the Camera</button>'
        : '') +
      (add ? '<button type="button" class="sp-btn sp-btn-line" data-act="card-back">Back to Your Page</button>' : '') +
      '</main>'
    );
  }

  /* ── Scan the Code With the Camera (a Chromebook) ──────────── */

  /* A phone scans a card with its own camera app, which opens this page at
     the card's address. A Chromebook has a camera but no such app, so on a
     wide screen this page offers its own: the camera's picture, read for a
     QR code by the browser's own reader (BarcodeDetector, which Chrome has
     on a Chromebook). A browser without that reader is not offered it. The
     picture never leaves the device: it is read in the browser and nothing
     of it is kept or sent. */
  function canScan() {
    return (
      typeof BarcodeDetector === 'function' &&
      typeof navigator !== 'undefined' &&
      !!navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === 'function'
    );
  }

  function renderCardScan() {
    return (
      '<main class="sp-main sp-main-center sp-card-start sp-card-scan">' +
      '<div class="sp-brand">FullVision</div>' +
      '<h1 class="sp-big" tabindex="-1">Scan the code on your card</h1>' +
      '<p class="sp-lead">Hold your card up to the camera.</p>' +
      '<div class="sp-scan-frame"><video class="sp-scan-video" autoplay muted playsinline aria-hidden="true"></video></div>' +
      '<button type="button" class="sp-btn sp-btn-line" data-act="card-type">Type the Code Instead</button>' +
      '</main>'
    );
  }

  var CAMERA_FAILED = 'The camera didn’t open. Type the code on your card instead.';
  var SCAN_EVERY_MS = 250;
  // The camera that is on: { stream, timer }. Null when it is off.
  var scanning = null;

  function stopCamera() {
    var s = scanning;
    scanning = null;
    if (!s) return;
    if (s.timer) clearTimeout(s.timer);
    if (s.stream && typeof s.stream.getTracks === 'function') {
      s.stream.getTracks().forEach(function (t) {
        t.stop();
      });
    }
  }

  // Back to the code box, saying `message` if there is one.
  function cameraOff(message) {
    stopCamera();
    S.screen = 'cardstart';
    S.message = message || '';
    S.calm = false;
    paint('#sp-code');
  }

  /* A code from what the camera read: a card's address
     (fullvision.ca/s/#P3R8WDK4) or the code alone. */
  function codeFrom(raw) {
    var text = String(raw || '');
    var at = text.indexOf('#');
    var c = cleanCode(at >= 0 ? decodeURIComponent(text.slice(at + 1)) : text);
    return isCode(c) ? c : '';
  }

  /* The camera starts. Every answer from it (the camera opening, a frame
     read) checks that this is still the camera on screen before it does
     anything: Type the Code Instead, a hidden tab or a new screen turns it
     off, and whatever arrives after that is dropped. */
  function startCamera() {
    stopCamera();
    var mine = { stream: null, timer: 0 };
    scanning = mine;
    S.message = '';
    S.screen = 'cardscan';
    paint('.sp-big');
    var detector;
    try {
      detector = new BarcodeDetector({ formats: ['qr_code'] });
    } catch (e) {
      cameraOff(CAMERA_FAILED);
      return Promise.resolve();
    }
    return navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false }).then(
      function (stream) {
        if (scanning !== mine || S.screen !== 'cardscan') {
          stream.getTracks().forEach(function (t) {
            t.stop();
          });
          return;
        }
        mine.stream = stream;
        var video = typeof document !== 'undefined' ? document.querySelector('.sp-scan-video') : null;
        if (!video) return cameraOff(CAMERA_FAILED);
        video.srcObject = stream;
        if (typeof video.play === 'function') {
          var played = video.play();
          if (played && typeof played.catch === 'function') played.catch(function () {});
        }
        read(mine, detector, video);
      },
      function () {
        if (scanning === mine) cameraOff(CAMERA_FAILED);
      },
    );
  }

  // One look at the picture, then the next, until a code is found.
  function read(mine, detector, video) {
    mine.timer = setTimeout(function () {
      mine.timer = 0;
      if (scanning !== mine) return;
      Promise.resolve()
        .then(function () {
          return detector.detect(video);
        })
        .then(
          function (found) {
            if (scanning !== mine || S.screen !== 'cardscan') return;
            var c = '';
            (found || []).some(function (b) {
              c = codeFrom(b && b.rawValue);
              return !!c;
            });
            if (!c) return read(mine, detector, video);
            stopCamera();
            return openCard(c);
          },
          function () {
            // The picture was not ready yet: look again.
            if (scanning === mine) read(mine, detector, video);
          },
        );
    }, SCAN_EVERY_MS);
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

  /* Is This You? On a phone, as the phone board draws it: the class at the
     top, the student's card, the two buttons under it. On a Chromebook, as
     the Chromebook board's step 2: one card in the middle holding the
     class, the student, the check and both buttons. The code box under it
     is the phone's ("No camera?"); a Chromebook typed its code already. */
  function renderCardCheck(state) {
    var d = state.data;
    var first = (d.student && d.student.first_name) || '';
    return (
      '<div class="sp-narrow-block">' +
      header(className(d.course), TITLE) +
      '</div>' +
      '<main class="sp-main sp-main-center sp-card-check">' +
      '<div class="sp-check-box">' +
      '<p class="sp-check-class sp-wide-block">' +
      esc(className(d.course)) +
      '</p>' +
      '<section class="sp-card sp-hello">' +
      '<div class="sp-hello-who">' +
      '<div class="sp-avatar" aria-hidden="true">' +
      esc(first.charAt(0).toUpperCase()) +
      '</div>' +
      '<h1 class="sp-big">' +
      esc('Is this you, ' + first + '?') +
      '</h1>' +
      '</div>' +
      '<p class="sp-lead">This page is just for you.</p>' +
      (d.check ? '<div class="sp-ident sp-ident-card">' + identityFields(state) + '</div>' : '') +
      '</section>' +
      '<button type="button" class="sp-btn sp-btn-primary" data-act="card-yes"' +
      (state.sending ? ' disabled' : '') +
      '>' +
      (state.sending ? 'Checking…' : 'Yes, That’s Me') +
      '</button>' +
      '<button type="button" class="sp-btn sp-btn-line" data-act="card-notme">No, That’s Not Me</button>' +
      '</div>' +
      demoNote(state, demoHint(state)) +
      (adding
        ? '<button type="button" class="sp-btn sp-btn-line" data-act="card-back">Back to Your Page</button>'
        : '<div class="sp-narrow-block">' +
          codeBox(state, 'No camera? Type the code on your card', false, 'card') +
          '</div>') +
      '</main>'
    );
  }

  /* A screen's way out. Adding a card, the student is still signed in, so
     a different code goes back to Add Another Card and the page is one
     press away; from the start screen, back to the start. */
  function wayOut() {
    return adding
      ? '<button type="button" class="sp-btn sp-btn-line" data-act="card-add">Type a Different Code</button>' +
          '<button type="button" class="sp-btn sp-btn-line" data-act="card-back">Back to Your Page</button>'
      : '<button type="button" class="sp-btn sp-btn-line" data-act="card-restart">Type a Different Code</button>';
  }

  function renderCardNotMe(state) {
    return (
      header((state.data && className(state.data.course)) || TITLE, state.data ? TITLE : 'FullVision') +
      '<main class="sp-main sp-main-center sp-main-middle">' +
      '<section class="sp-card sp-hello"><h1 class="sp-big">Give This Card Back</h1>' +
      '<p class="sp-lead">This card is for someone else. Give it back to your teacher and ask for your own.</p></section>' +
      wayOut() +
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
      wayOut() +
      '</main>'
    );
  }

  /* After Done (the artboard's "After Done"). Nothing of the student is on
     it. A phone and a Chromebook each say what they are. */
  var CHECK_MARK =
    '<svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

  function renderSignedOut() {
    return (
      '<main class="sp-main sp-main-center sp-main-middle sp-signed-out">' +
      '<span class="sp-out-mark">' +
      CHECK_MARK +
      '</span>' +
      '<h1 class="sp-big" tabindex="-1">You’re signed out</h1>' +
      '<p class="sp-lead"><span class="sp-narrow">This phone no longer has your card.</span>' +
      '<span class="sp-wide">This computer no longer has your card.</span></p>' +
      '<button type="button" class="sp-btn sp-btn-primary" data-act="card-restart">Scan a Card</button>' +
      '</main>'
    );
  }

  /* ── The student's page for one class ──────────────────────── */

  /* The frame every tab of the page sits in: the class and Done, which
     stay in reach as the page scrolls, then the tab's own body.
     assignments.js draws the first tab. */
  var PLUS =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M12 5v14M5 12h14"/></svg>';

  /* Your Classes (the artboard's "Switching Classes"): the classes this
     device's session has opened, the one showing ticked, then Add Another
     Card. The server sends the list with the page; it holds each class's
     name and block, the student's first name and, since S4-M1, how many
     pieces wait there (to_do), nothing else. */
  function classesSheet(page) {
    var here = page && page.student ? page.student.id : '';
    var list = (page && page.classes) || [];
    return (
      '<button type="button" class="sp-sheet-back" data-act="classes-close" aria-label="Close" tabindex="-1"></button>' +
      '<div class="sp-sheet" role="dialog" aria-modal="true" aria-labelledby="sp-classes-title">' +
      '<span class="sp-sheet-grip" aria-hidden="true"></span>' +
      '<h2 class="sp-sheet-title" id="sp-classes-title" tabindex="-1">Your Classes</h2>' +
      '<ul class="sp-classes">' +
      list
        .map(function (c) {
          var on = c.enrollmentId === here;
          return (
            '<li><button type="button" class="sp-class' +
            (on ? ' sp-class-on' : '') +
            '" data-act="class-open" data-enrollment="' +
            esc(c.enrollmentId) +
            '"' +
            (on ? ' aria-current="true"' : '') +
            '><span class="sp-class-words"><span class="sp-class-name">' +
            esc(c.name) +
            '</span>' +
            (c.block ? '<span class="sp-class-sub">' + esc(blockLabel(c.block)) + '</span>' : '') +
            '</span>' +
            // How many pieces wait there ("3 to do"), once the server says; nothing at 0 or when it does not.
            (c.toDo > 0 ? '<span class="sp-class-todo">' + esc(c.toDo + ' to do') + '</span>' : '') +
            (on ? '<span class="sp-class-tick">' + CHECK_MARK + '</span>' : '') +
            '</button></li>'
          );
        })
        .join('') +
      '</ul>' +
      '<button type="button" class="sp-btn sp-btn-tint" data-act="card-add">' +
      PLUS +
      'Add Another Card</button>' +
      '</div>'
    );
  }

  // "Block A", as the class's name shows it.
  function blockLabel(block) {
    var b = String(block || '').trim();
    return /^[A-Za-z0-9]{1,2}$/.test(b) ? 'Block ' + b.toUpperCase() : b;
  }

  /* ── Demo Mode: the three answers, built on the device ─────── */

  // The sample card's code is a card's eight characters, shown P3R8-WDK4.
  var DEMO = { code: 'P3R8WDK4', number: '1234567', password: '4821', tries: 5 };
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
    var cls = demoScience();
    // #demo-card-group: one more piece, sent by Cece's group (S12-F1); every other demo is as it was.
    if (demo && demo.group) {
      cls.work.unshift({
        id: 'demo-cell-model',
        title: 'Cell Model Project',
        date: isoDay(-3),
        due_date: isoDay(5),
        tag_ids: ['demo-com'],
        unit: 'Unit 1: Cells',
        category: 'Projects',
        about: 'With your group, build a model of a plant or animal cell. Label every part.',
      });
    }
    /* #demo-card-revise (S11-F2): one more piece, whose revision has come
       back: its first version was Developing + and Proficient, the revision
       is Proficient and Proficient (s/feedback.js keeps the request and the
       first version's grade). The Cell Microscope Lab is returned for
       revision there too. */
    if (demo && demo.revise) {
      cls.work.unshift({
        id: 'demo-vaccine',
        title: 'How Vaccines Work',
        date: isoDay(-15),
        due_date: isoDay(-10),
        tag_ids: ['demo-com', 'demo-qp'],
        unit: 'Unit 2: Body Systems',
        category: 'Projects',
        working: {
          score: { value: null, comment: 'Your third example makes the explainer complete.' },
          tag_scores: [
            { tag_id: 'demo-com', value: 3, modifier: 0, comment: null },
            { tag_id: 'demo-qp', value: 3, modifier: 0, comment: null },
          ],
        },
        ret: { is_draft: false, returned_at: isoDay(-2) + 'T20:15:00Z', returned_copy: null },
      });
    }
    return cls;
  }
  function demoScience() {
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
      // teacher_name as the server may send it: the page never shows it (Colin's ruling 112).
      course: { id: 'demo-science-8', name: 'Science 8', block: 'B', grading_scale: null, teacher_name: 'Ms. Rivera' },
      // The class's categories and what each weighs (category_percent is worked out from them as the server does).
      categories: [
        { name: 'Labs and Investigations', weight: 50 },
        { name: 'Quizzes', weight: 30 },
        { name: 'Projects', weight: 20 },
        { name: 'Practice', weight: 0 },
      ],
      rubrics: [
        {
          id: 'demo-rubric-lab',
          name: 'Lab Report',
          style: 'simple',
          // What each level asks, as the teacher wrote it: Your Feedback and The Whole Rubric show it.
          criteria: [
            demoCriterion(
              'demo-crit-method',
              'Method',
              ['demo-pc'],
              [
                'Lists a few of the steps.',
                'Lists the steps, with some out of order.',
                'Lists every step in order, so someone else could repeat it.',
                'Lists every step in order and says why each one matters.',
              ],
            ),
            demoCriterion(
              'demo-crit-drawing',
              'Labelled Drawing',
              ['demo-com'],
              [
                'Draws the cell.',
                'Draws the cell and labels some of its parts.',
                'Draws the cell and labels every part.',
                'Draws the cell to scale and labels every part.',
              ],
            ),
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
          unit: 'Unit 2: Body Systems',
          category: 'Projects',
          about:
            'Choose a question you can test. Write your question, what you predict, and the steps you will follow.',
          core: ['CT', 'CRT'],
        },
        {
          // A draft, never returned: the student sees the piece and its date only.
          id: 'demo-poster',
          title: 'Disease Research Poster',
          date: isoDay(-9),
          due_date: isoDay(-2),
          tag_ids: ['demo-pa', 'demo-com'],
          unit: 'Unit 2: Body Systems',
          category: 'Projects',
          about: 'Make a poster about one disease: what causes it, how it spreads, and how the body fights it.',
          core: ['COM', 'CRT'],
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
          unit: 'Unit 2: Body Systems',
          category: 'Quizzes',
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
          unit: 'Unit 1: Cells',
          category: 'Labs and Investigations',
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
          unit: 'Unit 1: Cells',
          category: 'Quizzes',
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
          unit: 'Unit 1: Cells',
          category: 'Labs and Investigations',
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
          category: 'Projects',
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
          category: 'Labs and Investigations',
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
          category: 'Practice',
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

  // One criterion of a sample rubric, in the server's shape, with what each of its four levels asks.
  function demoCriterion(id, name, tagIds, words) {
    var c = { id: id, name: name, weight: 1, tag_ids: tagIds, checks: [] };
    words.forEach(function (w, i) {
      c['level_' + (i + 1) + '_value'] = i + 1;
      c['level_' + (i + 1) + '_descriptor'] = w;
    });
    return c;
  }

  var DEMO_TAGS = {
    'demo-qp': {
      label: 'Questioning and Predicting',
      code: 'QP',
      i_can: ['I can ask a question that can be tested and say what I expect to happen.'],
    },
    'demo-pc': {
      label: 'Planning and Conducting',
      code: 'PC',
      i_can: ['I can plan a fair test and carry it out safely.'],
    },
    'demo-pa': {
      label: 'Processing and Analyzing Data',
      code: 'PA',
      i_can: ['I can find patterns in my data and explain what they show.'],
    },
    'demo-com': { label: 'Communicating', code: 'COM', i_can: ['I can share what I found in words and diagrams.'] },
    'demo-hum-evidence': {
      label: 'Evidence',
      code: 'EV',
      i_can: ['I can use evidence from sources to back up what I say.'],
    },
  };

  // The Core Competencies by the names the server sends (shared/constants.js's labels, in its order).
  var DEMO_CORE = [
    ['COM', 'Communicating'],
    ['COL', 'Collaborating'],
    ['CT', 'Creative Thinking'],
    ['CRT', 'Critical & Reflective Thinking'],
    ['PPI', 'Personal & Cultural Identity'],
    ['PAR', 'Personal Awareness & Responsibility'],
    ['SAR', 'Social Awareness & Responsibility'],
  ];
  function demoCore(ids) {
    return DEMO_CORE.filter(function (c) {
      return (ids || []).indexOf(c[0]) >= 0;
    }).map(function (c) {
      return { id: c[0], name: c[1] };
    });
  }

  /* What a sample piece's category counts, by the server's rule
     (migrations/local-test/s4-m1-contract.md, "category_percent"). */
  function demoPercent(cls, w, system) {
    var cats = cls.categories || [];
    var k = cats.filter(function (c) {
      return c.name === w.category;
    })[0];
    if (!k || w.score_mode === 'dibels') return null;
    if (k.weight === 0) return 0;
    var total = cats.reduce(function (sum, c) {
      return sum + c.weight;
    }, 0);
    return system !== 'proficiency' && total === 100 ? k.weight : null;
  }

  /* How many pieces wait for the student in a sample class, by the
     server's rule (to_do): not a reading benchmark, and Missing, or not
     Excused and never returned. */
  function demoToDo(cls) {
    return cls.work.filter(function (w) {
      if (w.score_mode === 'dibels') return false;
      return w.status === 'NS' || (w.status !== 'EXC' && !returnedGrade(w));
    }).length;
  }

  /* The second sample class, for Add Another Card (Switching Classes): one
     piece returned, one a draft, one not graded yet. */
  var DEMO_SECOND = 'demo-cece-hum';
  function demoSecondClass() {
    return {
      student: { enrollment_id: DEMO_SECOND, first_name: 'Cece' },
      course: {
        id: 'demo-humanities-8',
        name: 'Humanities 8',
        block: 'A',
        grading_scale: null,
        teacher_name: 'Mr. Okafor',
      },
      rubrics: [],
      work: [
        {
          id: 'demo-hum-worldview',
          title: 'Thinking It Through: A Changing Worldview',
          date: isoDay(-2),
          due_date: isoDay(3),
          tag_ids: ['demo-hum-evidence'],
          unit: 'Unit 1: Medieval Europe',
        },
        {
          // A draft, never returned: the date only.
          id: 'demo-hum-feudal',
          title: 'Feudalism Paragraph',
          date: isoDay(-8),
          due_date: isoDay(-4),
          tag_ids: ['demo-hum-evidence'],
          working: {
            score: { value: null, comment: 'Draft: add one more piece of evidence.' },
            tag_scores: [{ tag_id: 'demo-hum-evidence', value: 2, modifier: 0, comment: null }],
          },
          ret: { is_draft: true, returned_at: null, returned_copy: null },
        },
        {
          id: 'demo-hum-map',
          title: 'Medieval Europe Map',
          date: isoDay(-15),
          due_date: isoDay(-12),
          tag_ids: ['demo-hum-evidence'],
          working: {
            score: { value: null, comment: 'Clear labels and a careful key.' },
            tag_scores: [{ tag_id: 'demo-hum-evidence', value: 3, modifier: 0, comment: null }],
          },
          ret: { is_draft: false, returned_at: isoDay(-10) + 'T20:15:00Z', returned_copy: null },
        },
      ],
    };
  }

  // The sample class an enrollment opens.
  function demoClassFor(enrollment) {
    return enrollment === DEMO_SECOND ? demoSecondClass() : demoClass();
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
      to_do: demoToDo(cls),
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
  function demoPage(system, enrollment) {
    var cls = demoClassFor(enrollment);
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
      classes: demoClasses(),
      // The sample classes' competencies, by the names a card shows beside each level.
      tags: DEMO_TAGS,
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
          // When the teacher made it: the morning of its date.
          created_at: w.date + 'T16:00:00+00:00',
          score_mode: w.score_mode || 'proficiency',
          max_points: w.max_points || null,
          weight: 1,
          rubric_id: w.rubric_id || null,
          tag_ids: w.tag_ids || [],
          description: w.about || null,
          module_name: w.unit || null,
          category_name: w.category || null,
          category_percent: demoPercent(cls, w, system || 'proficiency'),
          core_competencies: demoCore(w.core),
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

  // The classes the sample session has opened, as the server lists them.
  function demoClasses() {
    var opened = demo && demo.classes && demo.classes.length ? demo.classes : [demoClass().student.enrollment_id];
    return opened.map(function (e) {
      return demoKlass(demoClassFor(e));
    });
  }

  /* The sample card, or, while a card is being added, the second sample
     class's card: any code opens it. */
  function demoCard() {
    if (demo.wrong >= DEMO.tries) return { ok: false, error: 'card_locked' };
    var cls = adding ? demoSecondClass() : demoClass();
    return {
      ok: true,
      kind: 'card',
      student: { first_name: 'Cece' },
      course: { name: cls.course.name, block: cls.course.block },
      check: demo.check,
      also_password: false,
    };
  }

  /* Five wrong tries lock the card, as the server does. From the start
     screen a right answer starts a new session; Add Another Card (`add`)
     joins the one sent and gives back no new token. */
  function demoVerify(body, add) {
    var right =
      demo.check === 'password'
        ? body.password === DEMO.password
        : body.birthday === demoBirthday() || body.student_number === DEMO.number;
    if (right) {
      var cls = add ? demoSecondClass() : demoClass();
      var e = cls.student.enrollment_id;
      if (!add) demo.classes = [];
      if (demo.classes.indexOf(e) < 0) demo.classes.push(e);
      return {
        ok: true,
        session_token: add ? null : 'demo',
        expires_at: nextMidnight(),
        enrollment_id: e,
        classes: demoClasses(),
      };
    }
    demo.wrong += 1;
    if (demo.wrong >= DEMO.tries) return { ok: false, error: 'card_locked' };
    return { ok: false, error: 'wrong_identity', tries_left: DEMO.tries - demo.wrong };
  }

  var DEMO_ANSWERS = {
    card: demoCard,
    verify: function (body) {
      return demoVerify(body, false);
    },
    'add-card': function (body) {
      return demoVerify(body, true);
    },
    page: function (body) {
      // Only a class the sample session has opened, as the server answers.
      if (demo.classes.indexOf(body.enrollment_id) < 0) return { ok: false, error: 'not_found' };
      return demoPage(demo.system, body.enrollment_id);
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
     as { ok: false, error: 'network' }.
     The page's reply comes back once calc.js is in, so the list is drawn
     once, with its results.
     Every answer, Demo Mode's too, goes through student.js's one guard
     (`whileCurrent`): an answer that lands after the page has moved on to
     another code or session is dropped, and nothing below sees it. */
  function ask(route, body) {
    var reply = fromFunction(route, body);
    if (route === 'page') {
      reply = Promise.all([reply, whenGradesAreIn()]).then(function (both) {
        return both[0];
      });
    }
    return StudentPage.whileCurrent(reply);
  }

  function fromFunction(route, body) {
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
  function has(map, key) {
    return typeof key === 'string' && Object.prototype.hasOwnProperty.call(map, key);
  }
  function cardMessage(res) {
    var e = res && !res.ok ? res.error : '';
    return MESSAGES[has(CARD_WORDS, e) ? CARD_WORDS[e] : 'card_network'];
  }
  // Whether the function itself refused (true), or the call never arrived.
  function refusedByFunction(res) {
    return !!(res && !res.ok && has(CARD_WORDS, res.error));
  }

  function setTitle() {
    if (typeof document !== 'undefined') document.title = TITLE + ' — FullVision';
  }

  /* ── The session on this device ────────────────────────────── */

  /* { token, expires, enrollment, active, kept }: the session this tab is
     showing. `active` is when the student last touched the page. `kept` is
     true once it is in localStorage, where the next visit and the device's
     other tabs read it. Nothing else of the card path is stored. */
  var SESSION_KEY = 'fv-s-session';
  // No touch, key, pointer or scroll for this long ends the session, as Done does (Colin, Nov 10).
  var IDLE_MS = 15 * 60 * 1000;
  var session = null;
  // The last student's token: sent with the next check, so the server ends it.
  var ending = '';
  /* Add Another Card is under way (Switching Classes): the student is
     signed in and is typing another card's code. Null otherwise. While it
     is set, a card that is recognised signs nobody out, and its check
     joins this session (`add-card`) instead of starting a new one. */
  var adding = null;
  var timer = 0;
  /* A timer counts time the device was awake. A Chromebook that slept with
     the list open wakes with its timer still far from done, and nothing
     tells the page it slept. So beside the timer there is a tick: once a
     second, while a card's page is up, the real time is compared with the
     session's end and with the last activity, and the list comes down the
     moment either has passed, with nobody touching anything. */
  var TICK_MS = 1000;
  var tick = 0;
  // When this tab last wrote the time of the last activity.
  var wrote = 0;

  function clock(now) {
    return now == null ? Date.now() : now;
  }

  function readStored() {
    try {
      var v = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      if (!v || !/^[0-9a-f]{64}$/.test(String(v.t || '')) || typeof v.e !== 'string' || !v.e) return null;
      var stored = { token: v.t, expires: String(v.x || ''), enrollment: v.e, active: Number(v.a) || 0, kept: true };
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

  /* When the student last touched the page: in this tab, or in another tab
     on this device showing the same session. */
  function lastActive(s, now) {
    var stored = s.kept ? readStored() : null;
    // A time ahead of the clock (the clock was set back, or the entry was
    // edited) is not believed: it counts as no activity at all.
    function believed(t) {
      return t > clock(now) + 60 * 1000 ? 0 : t || 0;
    }
    return Math.max(believed(s.active), stored && stored.token === s.token ? believed(stored.active) : 0);
  }

  /* Why a session is over at `now`: 'ended' (its midnight has come), 'idle'
     (fifteen minutes with no activity), or '' while it is live. The one
     place that decides it: the timer, the page being shown again and the
     page being opened again all ask here. */
  function over(s, now) {
    var end = endsAt(s);
    if (end != null && end <= clock(now)) return 'ended';
    return clock(now) - lastActive(s, now) >= IDLE_MS ? 'idle' : '';
  }

  // Kept only with an end this page can read, so nothing stays past its midnight.
  function keep(s) {
    var end = endsAt(s);
    s.kept = false;
    if (end == null || end <= Date.now()) return;
    try {
      write(s);
      s.kept = !!readStored();
    } catch (e) {
      /* a private window: this tab only */
    }
  }

  // The one thing this page writes to the device, and the one place it does.
  function write(s) {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ t: s.token, x: s.expires, e: s.enrollment, a: s.active }));
    wrote = s.active || 0;
  }

  // `stored` false leaves another student's session, kept by another tab, where it is.
  function forget(stored) {
    session = null;
    adding = null;
    stopCamera();
    stopClocks();
    stopWatchingRows();
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

  /* Done on the server, told once however many tabs have the page open.
     Two tabs that go idle do so at the same moment, and each would tell the
     server. The browser's own lock decides between them: the first tab to
     ask for the session's lock tells the server and keeps the lock, and
     the others, finding it taken, say nothing. A browser without locks
     tells the server from each tab, which the server takes as one. */
  function endOnce(token) {
    var locks = !S.demo && typeof navigator !== 'undefined' && navigator.locks;
    if (!token || !locks || typeof locks.request !== 'function') {
      endOnServer(token);
      return;
    }
    // Named by a part of the token, not the token: a lock's name can be read by this site's pages.
    locks.request('fv-s-done-' + token.slice(0, 16), { ifAvailable: true }, function (lock) {
      if (!lock) return undefined;
      endOnServer(token);
      // Kept for as long as this tab lives.
      return new Promise(function () {});
    });
  }

  /* A card was recognised: whoever was signed in on this device is signed
     out now, on the server and on the device, before anything about the
     card is drawn. It makes no difference whether the card will open: one
     that is locked, past its date, turned off or in need of reprinting is
     still someone else's card in someone else's hand (Colin, Nov 9: a card
     scanned from the start screen signs the last student out).
     A code that is no card (a slip, a mistyped code) does not do this: a
     student signed in who opens their own questionnaire slip keeps their
     page, and a typing mistake says nothing about who holds the device.
     The token also goes with the check, in case this Done never arrived. */
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
    S.reply = null;
  }

  /* Signed out: the session is forgotten, the page's data is dropped and
     the card's first screen is drawn, with `message` if the student did not
     ask for it. Demo Mode starts the sample again. `done` (the student
     pressed Done) draws After Done instead, in Demo Mode too. */
  function leave(message, stored, done) {
    var hash = demo && demo.hash;
    // Demo Mode keeps nothing, and leaves a real session on the device alone.
    forget(S.demo ? false : stored);
    StudentPage.reset();
    if (typeof StudentData !== 'undefined') StudentData.use(null);
    if (done) {
      S.screen = 'signedout';
      setTitle();
      paint('.sp-big');
      return;
    }
    if (hash && startDemo(hash)) return;
    S.screen = 'cardstart';
    S.message = message || '';
    S.calm = !!message;
    setTitle();
    paint('#sp-code');
  }

  /* The session ends here, as Done ends it: the server is told, then the
     device forgets. Done and fifteen idle minutes both come this way. With
     the page open in two tabs, the tab that still finds the token on the
     device is the one that tells the server, so it is told once. */
  function signOut(message, done) {
    var s = session;
    var stored = s && s.kept ? readStored() : null;
    var others = !!(stored && stored.token !== s.token);
    if (s && (!s.kept || (stored && !others))) endOnce(s.token);
    leave(message, others ? false : undefined, done);
  }

  /* The card's own screens that show, or are opening, the session's page.
     The session is watched only while one of them is up: a questionnaire or
     a report opened in the same tab is never taken down for it. Adding a
     card, every screen of it is the signed-in student's. */
  function showing() {
    return (
      S.screen === 'assignments' ||
      (S.screen === 'cardmessage' && !!S.again) ||
      (S.screen === 'loading' && S.heading === TITLE) ||
      (!!adding && !!session && has(ADDING_SCREENS, S.screen))
    );
  }
  var ADDING_SCREENS = { cardstart: 1, cardscan: 1, cardcheck: 1, cardnotme: 1, cardmessage: 1, loading: 1 };

  /* Is the session this tab shows still the device's, and still live?
     Asked when its end or its idle limit comes due, and before the page is
     shown again (the lid opened, the tab switched to, the Back button), so
     a list whose session is over is never drawn or uncovered. */
  function checkSession(now) {
    if (!session || S.demo || !showing()) return;
    if (session.kept) {
      var stored = readStored();
      // Done in another tab, or another student signed in there.
      if (!stored) return leave(MESSAGES.signed_out);
      if (stored.token !== session.token) return leave(MESSAGES.signed_out, false);
    }
    var why = over(session, now);
    if (why === 'ended') return leave(MESSAGES.signed_out);
    if (why === 'idle') return signOut(MESSAGES.signed_out);
    return arm(now);
  }

  function stopClocks() {
    if (timer) clearTimeout(timer);
    timer = 0;
    if (tick && typeof clearInterval === 'function') clearInterval(tick);
    tick = 0;
  }

  /* One timer, set for whichever comes first: the session's end or the idle
     limit. And the tick, for a device whose timers stood still. */
  function arm(now) {
    if (timer) clearTimeout(timer);
    timer = 0;
    if (!session || S.demo) return;
    if (!tick && typeof setInterval === 'function') {
      tick = setInterval(function () {
        checkSession();
      }, TICK_MS);
    }
    var end = endsAt(session);
    var due = Math.min(end == null ? Infinity : end, lastActive(session, now) + IDLE_MS) - clock(now);
    timer = setTimeout(
      function () {
        timer = 0;
        checkSession();
      },
      Math.min(Math.max(due, 0) + 50, 0x7fffffff),
    );
  }

  /* The student touched the page. Counted for the card's session only, at
     most once a second; written beside the token every few seconds, so the
     device's other tabs see it. A touch after the limit does not bring the
     session back: it is checked first. */
  function active(now) {
    if (!session || S.demo || !showing()) return;
    var at = clock(now);
    if (at - (session.active || 0) < 1000) return;
    if (over(session, at)) {
      checkSession(at);
      return;
    }
    session.active = at;
    if (!session.kept || at - wrote < 5000) return;
    var stored = readStored();
    if (!stored || stored.token !== session.token) return;
    try {
      write(session);
    } catch (e) {
      /* this tab only */
    }
  }

  /* While the tab is hidden the page is covered (student.css, .sp-away),
     and it is uncovered only after the session has been checked. So the
     list of a session that ended while nobody was looking is never on
     screen, not for one frame, however the browser orders its events. */
  function cover() {
    if (session && !S.demo && showing() && typeof document !== 'undefined') {
      document.documentElement.classList.add('sp-away');
    }
  }
  function uncover() {
    checkSession();
    if (typeof document === 'undefined') return;
    // Still a tab nobody is looking at (the page finished loading in the background).
    if (document.visibilityState === 'hidden') {
      cover();
      return;
    }
    document.documentElement.classList.remove('sp-away');
  }

  /* ── What the student has opened ───────────────────────────── */

  /* A returned piece counts as opened once its row has been on screen in a
     visible tab (Colin, Nov 10), and stayed there: a row counts only if it
     is still in view when SEEN_AFTER_MS is up. A flick down the list
     passes every row and reads none, and a piece wrongly told as opened
     would lose its Updated mark for good. A row that leaves before then is
     not sent, and starts again the next time it comes into view. Time in a
     tab nobody is looking at does not count.
     assignments.js marks the rows that could be opened (data-unseen:
     returned, a result drawn, not opened since it came back). They are
     watched here; the ones read are told to the server in one call, once
     each. Nothing is watched while the results have not loaded. A browser
     that cannot say what is on screen sends nothing.
     The feedback screen (S4) will tighten this to a piece actually opened:
     it changes `watchRows` and `shown`, and nothing else. */
  var SEEN_AFTER_MS = 600;
  // Rows that came into view in the same moment go in the same call.
  var SEEN_SLACK_MS = 150;
  var watching = null; // { page, observer, since: { id: when it came into view }, timer }

  function stopWatchingRows() {
    if (!watching) return;
    if (watching.timer) clearTimeout(watching.timer);
    if (watching.observer) watching.observer.disconnect();
    watching = null;
  }

  function tabHidden() {
    return typeof document !== 'undefined' && document.visibilityState === 'hidden';
  }

  function watchRows() {
    stopWatchingRows();
    if (!S.page || !session || S.screen !== 'assignments') return;
    if (typeof IntersectionObserver !== 'function' || typeof document === 'undefined') return;
    var rows = document.querySelectorAll('[data-unseen]');
    if (!rows.length) return;
    var w = { page: S.page, observer: null, since: {}, timer: 0 };
    // The header stays over the top of the list: a row under it is not on screen.
    var head = document.querySelector('.sp-head');
    var under = (head && head.offsetHeight) || 0;
    // On a phone the tabs sit over the bottom of the list: a row under them is not on screen either.
    var bar = document.querySelector('.sp-tabs-bottom');
    var rect = bar && typeof bar.getBoundingClientRect === 'function' ? bar.getBoundingClientRect() : null;
    var over =
      rect && typeof window.innerHeight === 'number' && rect.top > window.innerHeight / 2 ? bar.offsetHeight || 0 : 0;
    w.observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          var id = entry.target.getAttribute('data-unseen');
          if (!entry.isIntersecting) delete w.since[id];
          else if (!(id in w.since)) w.since[id] = Date.now();
        });
        if (watching === w) shown();
      },
      { rootMargin: '-' + under + 'px 0px -' + over + 'px 0px', threshold: 0.6 },
    );
    Array.prototype.forEach.call(rows, function (row) {
      w.observer.observe(row);
    });
    watching = w;
  }

  // The tab has been hidden or shown: a row's time on screen starts over.
  function lookAgain() {
    if (!watching) return;
    var now = Date.now();
    Object.keys(watching.since).forEach(function (id) {
      watching.since[id] = now;
    });
    shown();
  }

  /* Rows are in view. When the first of them has been there long enough,
     the ones that have are told to the server. */
  function shown() {
    var w = watching;
    if (!w || S.page !== w.page || S.screen !== 'assignments') return;
    if (w.timer) clearTimeout(w.timer);
    w.timer = 0;
    if (tabHidden()) return;
    var first = Infinity;
    w.page.assessments.forEach(function (a) {
      if (a.unseen && a.id in w.since) first = Math.min(first, w.since[a.id]);
    });
    if (first === Infinity) return;
    w.timer = setTimeout(tellSeen, Math.max(first + SEEN_AFTER_MS + SEEN_SLACK_MS - Date.now(), 0));
  }

  /* Tells the server which pieces were opened: one call for every row that
     is still in view and has been for long enough. A piece is marked as
     told when it is sent, so it is sent once in a session whatever the
     answer; the server's own record decides what the next visit shows. A
     session that has ended signs this tab out. */
  function tellSeen() {
    var w = watching;
    if (!w) return Promise.resolve();
    if (w.timer) clearTimeout(w.timer);
    w.timer = 0;
    var page = w.page;
    if (S.page !== page || !session || tabHidden()) return Promise.resolve();
    var now = Date.now();
    var ids = page.assessments
      .filter(function (a) {
        return a.unseen && a.id in w.since && now - w.since[a.id] >= SEEN_AFTER_MS;
      })
      .map(function (a) {
        return a.id;
      })
      .slice(0, 500);
    page.assessments.forEach(function (a) {
      if (ids.indexOf(a.id) >= 0) a.unseen = false;
    });
    // Rows still in view that have not been there long enough yet.
    shown();
    if (!ids.length) return Promise.resolve();
    return ask('seen', { session: session.token, enrollment_id: session.enrollment, assessment_ids: ids }).then(
      function (res) {
        if (res && res.error === 'signed_out' && S.page === page) leave(MESSAGES.signed_out);
      },
    );
  }

  /* ── Flow ──────────────────────────────────────────────────── */

  /* What `card` said about a code:
       true         it is a card, and its screen is drawn (Is This You?, or
                    why the card won't open);
       false        it is not a card: the function said not_found, or it is
                    the function from before cards, which answers a route
                    it does not know with bad_request;
       'locked'     this address has made too many wrong tries;
       'unreached'  anything else (no internet, a server error, an answer
                    with no meaning here): not known. */
  // card_stopped: the card was replaced by a new one (Colin, Nov 10).
  var WONT_OPEN = { closed: 1, card_locked: 1, card_expired: 1, reprint: 1, card_stopped: 1 };
  function cardSaid(res) {
    var isCard = !!(res && res.ok === true && res.kind === 'card');
    var e = res && res.ok === false ? res.error : '';
    if (!isCard && !has(WONT_OPEN, e)) {
      if (e === 'locked') return 'locked';
      return e === 'not_found' || e === 'bad_request' ? false : 'unreached';
    }
    // A card, whether or not it will open: the last student is signed out.
    leaveLast();
    S.sending = false;
    S.again = false;
    S.typed = '';
    S.number = '';
    S.bday = { m: '', d: '', y: '' };
    if (isCard) {
      S.data = res;
      S.message = '';
      S.screen = 'cardcheck';
    } else {
      S.data = null;
      S.message = cardMessage(res);
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
    // The keyboard and a screen reader start at the first thing to answer.
    paint(isCard ? (res.check === 'password' ? '#sp-ident' : '#sp-bm') : undefined);
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

  // The code typed (or scanned with this page's camera) on a card's screen.
  function openCard(typed) {
    stopCamera();
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
    if (adding) return addCard(c);
    // A real code may be a slip's: student.js asks `card`, then `open`.
    if (!S.demo) return StudentPage.openCode(c, 'card');
    StudentPage.newTurn();
    S.code = c;
    return ask('card', { code: c }).then(function (res) {
      if (cardSaid(res) !== true) refused(res);
    });
  }

  /* ── Switching Classes ─────────────────────────────────────── */

  /* Add Another Card: a card's code typed by a student who is signed in.
     It is asked as a card only: a slip's code here is a code that didn't
     work, since a slip opens no class. A card that is recognised signs
     nobody out (Colin, Nov 9: a card joins a session only through Add
     Another Card), and one that won't open says why on this screen, with
     the student's own page one press away. */
  function addCard(c) {
    StudentPage.newTurn();
    S.code = c;
    S.sending = true;
    S.screen = 'loading';
    S.heading = TITLE;
    paint();
    return ask('card', { code: c }).then(function (res) {
      S.sending = false;
      if (!adding) return;
      if (res && res.ok === true && res.kind === 'card') {
        S.data = res;
        S.typed = '';
        S.number = '';
        S.bday = { m: '', d: '', y: '' };
        S.message = '';
        S.screen = 'cardcheck';
        paint(res.check === 'password' ? '#sp-ident' : '#sp-bm');
        return;
      }
      S.message = cardMessage(res && res.ok === true ? { ok: false, error: 'not_found' } : res);
      S.calm = false;
      S.screen = 'cardstart';
      paint('#sp-code');
    });
  }

  /* Add Another Card opens over the page; Back to Your Page closes it.
     The page's data is kept while a card is added, so going back draws it
     again without asking. */
  function startAdding() {
    if (!session || !S.page) return;
    StudentPage.newTurn();
    stopWatchingRows();
    adding = { from: session.enrollment };
    S.sheet = false;
    S.data = null;
    S.typed = '';
    S.message = '';
    S.sending = false;
    S.screen = 'cardstart';
    paint('.sp-big');
  }

  function backToPage() {
    StudentPage.newTurn();
    stopCamera();
    adding = null;
    S.data = null;
    S.code = '';
    S.typed = '';
    S.number = '';
    S.bday = { m: '', d: '', y: '' };
    S.message = '';
    S.sending = false;
    if (!session) return leave('');
    if (!S.page) {
      S.heading = TITLE;
      S.screen = 'loading';
      return openPage();
    }
    S.screen = 'assignments';
    paint('.sp-page-title');
    arm();
    watchRows();
    return Promise.resolve();
  }

  /* Another class from Your Classes. The device's session stays as it is;
     only which class it opens changes, here and in what the device keeps. */
  function openClass(enrollment) {
    var known = ((S.page && S.page.classes) || []).some(function (c) {
      return c.enrollmentId === enrollment;
    });
    if (!session || !known) return Promise.resolve();
    S.sheet = false;
    if (enrollment === session.enrollment) {
      paint('.sp-head-switch');
      return Promise.resolve();
    }
    StudentPage.newTurn();
    stopWatchingRows();
    session.enrollment = enrollment;
    if (session.kept) keep(session);
    S.page = null;
    S.reply = null;
    if (typeof StudentData !== 'undefined') StudentData.use(null);
    S.heading = TITLE;
    S.screen = 'loading';
    return openPage();
  }

  /* A tab, one of To Do, Sent and Back, or All Assignments. The page's data
     is already here: nothing is asked. The rows on screen change, so what
     is watched for "opened" starts again. */
  /* What the student looks at on the page, as s/page-view.js reads it. */
  var UI_KEYS = [
    'tab',
    'segment',
    'all',
    'pick',
    'search',
    'filter',
    'feedback',
    'whole',
    'levels',
    'form',
    'work',
    'workPage',
    'marksOff',
    'workPages',
    'compare',
  ];
  function uiOf() {
    var ui = {};
    UI_KEYS.forEach(function (k) {
      ui[k] = S[k];
    });
    return ui;
  }

  /* A tab, one of To Do, Sent and Back, All Assignments, a filter, or a
     piece's card. s/page-view.js says what each press changes (the preview
     answers the same presses the same way); the page's data is already
     here, so nothing is asked. The rows and cards on screen change, so
     what is watched for "opened" starts again. */
  function showPart(act, el) {
    if (!S.page || S.screen !== 'assignments' || typeof StudentPageView === 'undefined') return;
    var view = StudentPage.viewOf ? StudentPage.viewOf(S) : null;
    var out = StudentPageView.press(uiOf(), view, act, el);
    if (!out) return;
    UI_KEYS.forEach(function (k) {
      S[k] = out.ui[k];
    });
    S.sheet = false;
    stopWatchingRows();
    paint(out.focus);
    if (!out.piece && typeof window !== 'undefined' && typeof window.scrollTo === 'function') window.scrollTo(0, 0);
    watchRows();
  }

  /* ── Questionnaires and My Reports (S4-F4) ─────────────────── */

  /* Demo Mode's samples, in the shape the server's page is to send them
     (shared/student-view.js, questionnairesOf and reportsOf). Kept out of
     the page reply itself, which is the server's shape today. */
  function demoForms() {
    function at(offset) {
      return isoDay(offset) + 'T20:15:00Z';
    }
    var report = StudentPage.demoReport();
    return {
      questionnaires: [
        {
          id: 'demo-q-reflection',
          title: 'November Reflection',
          description: 'Core Competencies and your goal check-in',
          minutes: 10,
          state: 'open',
          closes_on: isoDay(9),
        },
        { id: 'demo-q-about', title: 'About Me', state: 'sent', sent_at: at(-58) },
        { id: 'demo-q-march', title: 'March Reflection', state: 'not_open_yet', opens_on: isoDay(112) },
      ],
      reports: [
        {
          id: 'demo-r-1',
          title: report.report,
          issued_at: at(-1),
          expires_on: isoDay(6),
          opened_at: null,
          overall: report.overall,
          comment: report.comment,
        },
        { id: 'demo-r-0', title: 'Interim Update', issued_at: at(-40), opened_at: at(-39) },
      ],
    };
  }

  /* Start, or See Your Report, from the card's page. A real card cannot
     open either yet: the server has no route that opens a questionnaire or
     a phone report from a card's session (S4-F4's pull request names what
     is missing), and the server's page lists none, so these buttons show
     only in Demo Mode. There they open the sample questionnaire and report
     on the slip's own screens, with the student already known. */
  function openForm(act, id) {
    if (!S.demo || !S.page || S.screen !== 'assignments') return;
    var forms = demoForms();
    var known = (act === 'q-start' ? forms.questionnaires : forms.reports).some(function (x) {
      return x.id === id;
    });
    if (!known) return;
    StudentPage.newTurn();
    stopWatchingRows();
    S.back = S.tab;
    S.sheet = false;
    if (act === 'r-open') {
      S.data = {
        ok: true,
        kind: 'report',
        token: 'demo',
        student: { first_name: S.page.student.firstName },
        course: { name: S.page.course.name, block: S.page.course.block },
        report: { title: StudentPage.demoReport().report },
      };
      S.report = StudentPage.demoReport();
      S.screen = 'report';
      paint('.pr-view h1, .pr-view h2');
      return;
    }
    S.screen = 'loading';
    paint();
    var mine = S;
    StudentPage.loadDemoTemplates(function () {
      if (S !== mine || S.screen !== 'loading' || !S.back) return;
      S.data = StudentPage.demoData('reflection');
      S.part = 0;
      S.answers = {};
      S.screen = 'part';
      paint('h1');
    });
  }

  // Back to Your Page from a questionnaire sent or a report read: the tab it was opened from.
  function pageBack() {
    if (!S.back || !S.page) return;
    StudentPage.newTurn();
    S.tab = S.back;
    S.back = '';
    S.data = null;
    S.report = null;
    S.screen = 'assignments';
    setTitle();
    paint('.sp-page-title');
    arm();
    watchRows();
  }

  function openSheet() {
    if (!S.page || S.screen !== 'assignments') return;
    S.sheet = true;
    paint('#sp-classes-title');
  }

  function closeSheet() {
    if (!S.sheet) return;
    S.sheet = false;
    paint('.sp-head-switch');
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
    // What the page draws from (S4-F1); index.html names it, so it is fetched only for an older copy.
    [
      '../shared/student-view.js',
      function () {
        return typeof StudentView !== 'undefined';
      },
    ],
    [
      'page-view.js',
      function () {
        return typeof StudentPageView !== 'undefined';
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
    var words = has(PAGE_WORDS, e) ? PAGE_WORDS[e] : '';
    if (words && session) {
      endOnServer(session.token);
      forget();
    }
    S.page = null;
    S.reply = null;
    if (typeof StudentData !== 'undefined') StudentData.use(null);
    S.message = MESSAGES[words || 'card_network'];
    S.again = !words;
    S.screen = 'cardmessage';
    paint();
  }

  /* The student's page for the session's class. The screen that asked stays
     up (Is This You? with its button reading Checking, or the loading
     screen) until the page's data and calc.js are both in (`ask` waits for
     both), so the list is drawn once, with its results. If calc.js can't be
     fetched the list still opens, without results (assignments.js says so
     and offers Try Again). */
  function openPage() {
    if (!session) {
      leave('');
      return Promise.resolve();
    }
    var mine = session;
    S.sending = true;
    S.message = '';
    paint();
    return ask('page', { session: mine.token, enrollment_id: mine.enrollment }).then(function (res) {
      S.sending = false;
      if (!(res && res.ok && typeof StudentData !== 'undefined')) {
        pageRefused(res && res.ok ? { ok: false, error: 'network' } : res);
        return;
      }
      // The session's end as the server has it now.
      if (res.expires_at && String(res.expires_at) !== mine.expires) {
        mine.expires = String(res.expires_at);
        if (mine.kept) keep(mine);
      }
      // A class opened afresh starts on Assignments, To Do.
      if (!S.page) {
        S.tab = 'assignments';
        S.segment = 'todo';
        S.all = false;
        S.pick = '';
        S.search = '';
        S.filter = 'all';
        S.feedback = '';
        S.whole = false;
        S.levels = false;
        S.form = '';
      }
      // A reply the page cannot read (a list that is not a list) is a
      // failed page: the plain message with Try Again, never a throw.
      var read;
      try {
        read = StudentData.fromServer(res);
        StudentData.use(read);
      } catch (e) {
        pageRefused({ ok: false, error: 'network' });
        return;
      }
      S.reply = res;
      S.page = read;
      // What the student typed to get in is not kept once they are in.
      S.number = '';
      S.bday = { m: '', d: '', y: '' };
      S.again = false;
      S.screen = 'assignments';
      setTitle();
      paint('.sp-page-title');
      window.scrollTo(0, 0);
      // Drawn in a tab nobody is looking at: covered until it is shown.
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') cover();
      arm();
      watchRows();
      // What the class takes, asked once the page is up (s/send.js): a class that takes no work stays as drawn.
      if (!S.demo && typeof StudentPage.pageOpened === 'function') StudentPage.pageOpened();
    });
  }

  /* The routes s/send.js asks for the class on screen (S5-W1): work,
     send-start, replace, send-finish, unsend and file-links. The device's
     session is added here, in the body as every card route sends it, and
     the token goes nowhere else. A real card only. A send names its own
     student (`enrollment`): when someone else is signed in now, nothing is
     asked, so one student's send is never started under another's session. */
  var CLASS_ROUTES = { work: 1, 'send-start': 1, replace: 1, 'send-finish': 1, unsend: 1, 'file-links': 1 };
  function askClass(route, body, enrollment) {
    if (S.demo || !session || !has(CLASS_ROUTES, route)) return Promise.resolve({ ok: false, error: 'signed_out' });
    if (enrollment && enrollment !== session.enrollment) return Promise.resolve({ ok: false, error: 'other_student' });
    return ask(route, Object.assign({}, body, { session: session.token, enrollment_id: session.enrollment }));
  }

  // Try Again on a list whose results didn't load.
  function fetchGradesAgain() {
    S.sending = true;
    paint();
    // Drawn only if the page that asked is still the one showing (not after Done).
    return StudentPage.whileCurrent(whenGradesAreIn()).then(function () {
      S.sending = false;
      paint();
      watchRows();
    });
  }

  /* The check passed: the function has started a session for this device
     and ended the last one. Its token is kept, then the page opens. */
  function signedIn(res) {
    ending = '';
    if (adding) return added(res);
    session = {
      token: String(res.session_token || ''),
      expires: String(res.expires_at || ''),
      enrollment: String(res.enrollment_id || ''),
      active: Date.now(),
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

  /* Add Another Card passed its check: the class joined this device's
     session, and the page opens on it. The server gives back no token for
     a joined session; if the session had ended meanwhile it started a new
     one, and gives back that one's token. */
  function added(res) {
    var e = String(res.enrollment_id || '');
    if (!session || !e) {
      adding = null;
      pageRefused({ ok: false, error: 'network' });
      return Promise.resolve();
    }
    adding = null;
    if (res.session_token) {
      session = { token: String(res.session_token), expires: '', enrollment: e, active: Date.now(), kept: false };
    }
    session.enrollment = e;
    if (res.expires_at) session.expires = String(res.expires_at);
    session.active = Date.now();
    if (!S.demo) keep(session);
    S.page = null;
    S.reply = null;
    if (typeof StudentData !== 'undefined') StudentData.use(null);
    return openPage();
  }

  /* Is This You? The code goes again with what the student typed; there is
     no token between `card` and `verify`. Adding a card, it goes to
     `add-card` with this device's session, which the class joins. */
  function checkCard() {
    var code = S.code;
    return verifyIdentity({
      send: function (ident) {
        var body = Object.assign({ code: code }, ident);
        if (adding && session) return ask('add-card', Object.assign(body, { session: session.token }));
        if (ending) body.session = ending;
        return ask('verify', body);
      },
      ok: signedIn,
      messageScreen: 'cardmessage',
      message: cardMessage,
      stops: refusedByFunction,
    });
  }

  function startDemo(hash) {
    // #demo-card-send: the sample class with Send Work on (S5-F2); off, as in every class, otherwise.
    // #demo-card-reflect: Send Work and Reflect on Feedback both on (S10).
    // #demo-card-group: Send Work on, and a piece sent as One per Group (S12-F1).
    // #demo-card-revise: Send Work on, a piece returned for revision and a revision returned (S11-F2),
    // in a class graded by both, so Before and After shows the board's "2.7 · 67%" and "3.0 · 75%".
    var m = /^demo-card(?:-(password|letter|both|send|reflect|group|revise))?$/i.exec(hash || '');
    if (!m) return false;
    var kind = (m[1] || '').toLowerCase();
    demo = {
      hash: hash,
      check: kind === 'password' ? 'password' : 'identity',
      system: kind === 'letter' || kind === 'both' ? kind : kind === 'revise' ? 'both' : 'proficiency',
      wrong: 0,
      seen: {},
      classes: [],
      group: kind === 'group',
      revise: kind === 'revise',
    };
    adding = null;
    S.demo = true;
    S.demoSend = kind === 'send' || kind === 'reflect' || kind === 'group' || kind === 'revise';
    S.demoGroup = kind === 'group';
    S.demoReflect = kind === 'reflect';
    S.demoRevise = kind === 'revise';
    S.demoRevisions = null;
    S.typed = prettyCode(DEMO.code);
    S.screen = 'cardstart';
    setTitle();
    paint();
    return true;
  }

  /* The page opened with no code in its address. A device that is signed
     in opens the student's page again; one whose session is over (its
     midnight has passed, or nobody touched it for fifteen minutes) says so
     on the card's first screen, and the list is never drawn. Opening the
     page is not activity. Anything else is left to student.js (the slip's
     first screen). */
  function resume() {
    var stored = readStored();
    if (!stored) return false;
    setTitle();
    var why = over(stored);
    if (why) {
      // Idle ends it as Done does: the server is told first.
      if (why === 'idle') endOnce(stored.token);
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
    adding = null;
    stopCamera();
    StudentPage.reset();
    if (typeof StudentData !== 'undefined') StudentData.use(null);
    stopWatchingRows();
    if (hash && startDemo(hash)) return;
    S.screen = 'cardstart';
    setTitle();
    paint('#sp-code');
  }

  function onClick(act, el) {
    if (act === 'card-yes') {
      checkCard();
    } else if (act === 'card-notme') {
      // An answer still on its way is for a card this student has handed back.
      StudentPage.newTurn();
      // The check may already have passed and kept a session (its page
      // still on the way): that student is signed out, as Done does, so
      // the next person on this device never opens their page. Adding a
      // card, the session is the student already signed in, and stays.
      if (session && !adding) {
        endOnServer(session.token);
        forget();
      }
      S.sending = false;
      S.message = '';
      S.screen = 'cardnotme';
      paint();
    } else if (act === 'card-restart') {
      restartCard();
    } else if (act === 'card-done') {
      signOut('', true);
    } else if (act === 'card-camera') {
      startCamera();
    } else if (act === 'card-type') {
      cameraOff('');
    } else if (act === 'classes-open') {
      openSheet();
    } else if (act === 'classes-close') {
      closeSheet();
    } else if (act === 'class-open') {
      openClass(el.getAttribute('data-enrollment') || '');
    } else if (act === 'card-add') {
      if (adding) {
        // Type a Different Code, while adding: back to Add Another Card.
        StudentPage.newTurn();
        S.data = null;
        S.message = '';
        S.sending = false;
        S.screen = 'cardstart';
        paint('#sp-code');
      } else {
        startAdding();
      }
    } else if (act === 'card-back') {
      backToPage();
    } else if (
      /^(tab|segment|all-open|all-close|filter|pick|open-piece|feedback|feedback-close|whole|whole-close|levels|form-pick|work|work-close|work-page|work-marks|compare)$/.test(
        act,
      )
    ) {
      showPart(act, el);
    } else if (act === 'q-start' || act === 'r-open') {
      openForm(act, el.getAttribute('data-form-id') || '');
    } else if (act === 'page-back') {
      pageBack();
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

  /* The window's events. A tab shown again may be showing a session that
     has since ended: after midnight, after fifteen idle minutes, after Done
     in another tab, or brought back by the Back button. Each of these
     checks the session before the page is uncovered. */
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') {
        // The camera is never left on in a tab nobody is looking at.
        if (scanning) cameraOff('');
        cover();
        lookAgain();
        return;
      }
      uncover();
      lookAgain();
    });
  }
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    ['pageshow', 'focus'].forEach(function (name) {
      window.addEventListener(name, uncover);
    });
    window.addEventListener('pagehide', cover);
    window.addEventListener('storage', function () {
      checkSession();
    });
    // Your Classes: Escape closes it, and Tab goes round inside it.
    window.addEventListener('keydown', function (e) {
      if (!S || !S.sheet || typeof document === 'undefined') return;
      if (e.key === 'Escape') {
        e.preventDefault();
        closeSheet();
        return;
      }
      if (e.key !== 'Tab') return;
      var inside = Array.prototype.slice.call(document.querySelectorAll('.sp-sheet button'));
      if (!inside.length) return;
      var at = inside.indexOf(document.activeElement);
      var next = e.shiftKey ? (at <= 0 ? inside.length - 1 : at - 1) : at < 0 || at === inside.length - 1 ? 0 : at + 1;
      e.preventDefault();
      inside[next].focus();
    });
    // What counts as activity: a touch, a key, the pointer, a scroll.
    ['pointerdown', 'pointermove', 'keydown', 'touchstart', 'wheel', 'scroll'].forEach(function (name) {
      window.addEventListener(
        name,
        function () {
          active();
        },
        { capture: true, passive: true },
      );
    });
  }

  StudentPage.classesSheet = classesSheet;
  StudentPage.demoForms = demoForms;
  StudentPage.pageBack = pageBack;
  StudentPage.askClass = askClass;
  // A send route that says the session or the class is over: as `page` saying it.
  StudentPage.sessionRefused = pageRefused;

  StudentPage.addScreens({
    file: 'app',
    render: {
      cardstart: renderCardStart,
      cardcheck: renderCardCheck,
      cardnotme: renderCardNotMe,
      cardmessage: renderCardMessage,
      cardscan: renderCardScan,
      signedout: renderSignedOut,
    },
    click: onClick,
    submit: onSubmit,
    start: function (hash) {
      demo = null;
      /* The page is starting over. Whatever this tab was showing, it is not
         showing the session now: the device's copy stays where it is, for a
         card to end or the page to open again. */
      session = null;
      adding = null;
      stopCamera();
      stopClocks();
      stopWatchingRows();
      if (typeof document !== 'undefined') document.documentElement.classList.remove('sp-away');
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
      tellSeen: tellSeen,
      codeFrom: codeFrom,
      adding: function () {
        return adding;
      },
      camera: function () {
        return scanning;
      },
      SCAN_EVERY_MS: SCAN_EVERY_MS,
      SESSION_KEY: SESSION_KEY,
      IDLE_MS: IDLE_MS,
      DEMO: DEMO,
    },
  });
})();
