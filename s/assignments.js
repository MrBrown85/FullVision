/* The student's page for one class on the student page (S4-F1): the view
   from shared/student-view.js, drawn by s/page-view.js.

   This file is the student page's side of it: it builds the view from the
   server's `page` reply (StudentView.fromPage, with s/student-data.js's
   reading of it), says whether the results loaded, and hands both to
   StudentPageView.html with what the student chose to look at (the tab,
   Outstanding or Upcoming, a piece open; s/app.js keeps those). The teacher's
   Preview as Student hands StudentPageView the same kind of view, so the
   two draw the same thing.

   The line this build protects: a grade that was never returned shows
   nothing at all. The reply holds returned grades only, the view gives a
   result only to a piece that came back, and nothing here works one out.

   With calc.js or constants.js not in (app.js fetches them before this
   screen opens; the fetch can fail) the view is built with no grades, so a
   returned piece shows when it came back and no result, and the page says
   the results didn't load. A view that cannot be built shows the page's
   plain waiting line; nothing throws into a draw.

   A returned piece not opened since it came back carries its id as
   data-unseen; app.js watches those rows and tells the server (`seen`). */
(function () {
  'use strict';

  if (typeof StudentPage === 'undefined' || !StudentPage.addScreens) return;

  // calc.js and constants.js are both in: a result can be worked out and worded.
  function gradesAreIn() {
    return (
      typeof assessmentCellValue === 'function' &&
      typeof levelWord === 'function' &&
      typeof formatPoints === 'function' &&
      typeof scoreLevelText === 'function'
    );
  }

  /* The reply with no grade in it, for when calc.js or constants.js did not
     arrive: what came back still shows as back, with no result. */
  function withoutGrades(reply) {
    return Object.assign({}, reply, {
      assessments: (reply.assessments || []).map(function (a) {
        return Object.assign({}, a, { grade: null, previous: null });
      }),
    });
  }

  /* What the page draws (student-view.js's shape), or null while it cannot
     be built: no page yet, or student-view.js not in. */
  function viewOf(state) {
    if (!state || !state.page || !state.reply) return null;
    if (typeof StudentView === 'undefined' || !StudentView || typeof StudentView.fromPage !== 'function') return null;
    var reply = gradesAreIn() ? state.reply : withoutGrades(state.reply);
    // Reflections (S4-F4): Demo Mode's samples, or what a real card's `forms` answered (app.js).
    var forms = state.demo
      ? StudentPage.demoForms && StudentPage.demoForms()
      : StudentPage.formsOf && StudentPage.formsOf(state);
    if (forms) reply = Object.assign({}, reply, forms);
    try {
      // What the class takes and what is in (s/send.js; Demo Mode's until the `work` route exists).
      var work = typeof StudentPage.workOf === 'function' ? StudentPage.workOf(state) : null;
      // The teacher's Mark Up, and later reflections (s/feedback.js; Demo Mode's until the server sends `feedback`).
      var feedback = typeof StudentPage.feedbackOf === 'function' ? StudentPage.feedbackOf(state) : null;
      // Group work (S12-F1): counts only, Demo Mode's until the server sends `group_work`.
      var groups = typeof StudentPage.groupOf === 'function' ? StudentPage.groupOf(state) : null;
      var view = StudentView.fromPage(reply, state.page, work, feedback, groups);
      // Bulletins (s/bulletins.js): only with the build switch on and the server's answer in; else no tab.
      var bulletins = typeof StudentPage.bulletinsOf === 'function' ? StudentPage.bulletinsOf(state) : null;
      if (bulletins) view.bulletins = bulletins;
      // A quiz's button words, from what this tab has seen of it (s/quiz.js).
      if (typeof StudentPage.quizMarks === 'function') StudentPage.quizMarks(view, state);
      return view;
    } catch (e) {
      return null;
    }
  }

  function renderAssignments(state) {
    var view = viewOf(state);
    var ui = {
      tab: state.tab,
      segment: state.segment,
      pick: state.pick,
      card: state.card,
      logout: state.logout,
      // A quiz answer not yet saved: the Log Out sheet and the Switch Class question say so (s/quiz.js).
      quizWaiting: typeof StudentPage.quizWaiting === 'function' ? StudentPage.quizWaiting() : 0,
      classHold: state.classHold || '',
      feedback: state.feedback,
      whole: state.whole,
      compare: state.compare,
      levels: state.levels,
      work: state.work,
      workPage: state.workPage,
      marksOff: state.marksOff,
      workPages: state.workPages,
      // A handout open in the page (Handouts and Links; s/handouts.js fetches its pages).
      handout: state.handout,
      handoutPiece: state.handoutPiece,
      handoutPage: state.handoutPage,
      handoutPages: state.handoutPages,
      handoutMenu: state.handoutMenu,
      // A bulletin's file open full size (s/bulletins-view.js), and "2 new" by class in Switch Class.
      bulletinFile: state.bulletinFile,
      bulletinPage: state.bulletinPage,
      classNews: typeof StudentPage.bulletinNews === 'function' ? StudentPage.bulletinNews(state) : null,
      form: state.form,
      // Settings (the gear) and what it holds: Text Size, and the classes Switch Class lists.
      settings: state.settings,
      textSize: state.textSize,
      classes: state.page ? state.page.classes : null,
      classOn: state.page && state.page.student ? state.page.student.id : '',
      sending: state.sending,
      noResults: !gradesAreIn(),
      waiting: !view || typeof StudentPageView === 'undefined',
      course: state.page ? { name: state.page.course.name, block: state.page.course.block } : null,
      note: state.demo ? 'This is Demo Mode. Cece and her results are samples.' : '',
    };
    var page =
      typeof StudentPageView !== 'undefined'
        ? StudentPageView.html(view, ui)
        : '<p class="sp-lead sp-msg-calm sp-empty" role="status">Opening your page…</p>';
    return (
      page +
      // Unsend Your Work? and Replace Your Photos? over the card (s/send.js).
      (typeof StudentPage.sendDialog === 'function' ? StudentPage.sendDialog(state) : '')
    );
  }

  StudentPage.viewOf = viewOf;

  /* A Sent card's pictures, once this device has them (s/send.js, file-links): put into the cards
     of piece `p` on screen in place, exactly as page-view.js draws them, and nothing else is drawn
     again. true when that is done (or no card of it is on screen); false when a card on screen has
     no place for them, and the page is to be drawn again. */
  function placeThumbs(p) {
    if (!S || S.screen !== 'assignments' || S.sendAsk || typeof document === 'undefined') return true;
    var cards = p
      ? document.querySelectorAll('#app .sp-piece[data-piece="' + String(p.id).replace(/["\\]/g, '') + '"]')
      : [];
    if (!cards.length) return true;
    if (p.kind !== 'sent' || p.group || !p.send || !p.send.sent || typeof StudentPageView === 'undefined') return false;
    // html-safe: StudentPageView.thumbsHtml escapes every address and label.
    var html = StudentPageView.thumbsHtml(p.send.sent.thumbs, 'Your page');
    return Array.prototype.every.call(cards, function (card) {
      var old = card.querySelector('.sp-send-thumbs');
      // Where page-view.js's sentBlockHtml puts them: after the title and its tags.
      var after = card.querySelector('.sp-piece-card > .sp-piece-tags') || card.querySelector('.sp-piece-card > h2');
      if (!old && !after) return false;
      // html-safe: thumbsHtml escapes every address and label.
      if (html) (old || after).insertAdjacentHTML(old ? 'beforebegin' : 'afterend', html);
      if (old) old.remove();
      return true;
    });
  }
  StudentPage.placeThumbs = placeThumbs;

  // The state, as student.js hands it over.
  var S = null;

  StudentPage.addScreens({
    file: 'assignments',
    render: { assignments: renderAssignments },
    // Once the page is drawn: on a phone, a card picked from elsewhere is brought into view.
    drawn: function (root, state) {
      if (state.screen !== 'assignments' || typeof StudentPageView === 'undefined') return;
      StudentPageView.settle(root);
    },
    share: function (state) {
      S = state;
    },
    test: {
      viewOf: viewOf,
      rowView: function (p) {
        return StudentPageView.rowView(p);
      },
      counts: function (v) {
        return StudentPageView.counts(v);
      },
    },
  });
})();
