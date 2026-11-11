/* The student's page for one class on the student page (S4-F1): the view
   from shared/student-view.js, drawn by s/page-view.js.

   This file is the student page's side of it: it builds the view from the
   server's `page` reply (StudentView.fromPage, with s/student-data.js's
   reading of it), says whether the results loaded, and hands both to
   StudentPageView.html with what the student chose to look at (the tab,
   To Do, Sent or Back, All Assignments; s/app.js keeps those). The teacher's
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
    // Demo Mode's samples for Questionnaires and My Reports, which the server's page does not send yet (S4-F4).
    if (state.demo && StudentPage.demoForms) reply = Object.assign({}, reply, StudentPage.demoForms());
    try {
      return StudentView.fromPage(reply, state.page);
    } catch (e) {
      return null;
    }
  }

  function renderAssignments(state) {
    var view = viewOf(state);
    var ui = {
      tab: state.tab,
      segment: state.segment,
      all: state.all,
      pick: state.pick,
      search: state.search,
      filter: state.filter,
      feedback: state.feedback,
      whole: state.whole,
      levels: state.levels,
      form: state.form,
      sheet: state.sheet,
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
    return page + (state.sheet && StudentPage.classesSheet ? StudentPage.classesSheet(state.page) : '');
  }

  StudentPage.viewOf = viewOf;

  /* All Assignments' search: each letter typed draws the list again, and
     the box keeps the focus and the place being typed in. */
  function onInput(el) {
    if (!el || el.id !== 'sp-search' || !S || S.screen !== 'assignments') return;
    S.search = String(el.value || '').slice(0, 100);
    var at = typeof el.selectionStart === 'number' ? el.selectionStart : S.search.length;
    StudentPage.paint('#sp-search');
    var box = typeof document !== 'undefined' ? document.getElementById('sp-search') : null;
    if (box && typeof box.setSelectionRange === 'function') box.setSelectionRange(at, at);
  }

  // The state, as student.js hands it over.
  var S = null;

  StudentPage.addScreens({
    file: 'assignments',
    render: { assignments: renderAssignments },
    input: onInput,
    // Once the page is drawn: the phone's cards start at the one picked, and the count follows the swipe.
    drawn: function (root, state) {
      if (state.screen !== 'assignments' || typeof StudentPageView === 'undefined') return;
      StudentPageView.settle(root, function (id) {
        state.pick = id;
      });
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
