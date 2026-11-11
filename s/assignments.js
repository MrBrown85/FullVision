/* The student's page for one class (docs/plans/student-page-build-plan.md,
   S4-F1; the artboard's "To Do Card", "All Caught Up", "Questionnaires
   Tab", "My Reports Tab" and "Page on a Chromebook"): the four tabs
   (Assignments, My Learning, Questionnaires, Reports) and, on Assignments,
   To Do, Sent and Back with their counts.

   What is drawn comes from shared/student-view.js (StudentView.fromPage),
   the one builder the real page and the teacher's Preview as Student both
   use, so the two cannot differ. It is fed the server's `page` reply and
   s/student-data.js's reading of it; every result is worked out and worded
   by shared/calc.js and shared/constants.js inside it. Nothing here
   formats a grade or works one out.

   The line this build protects: a grade that was never returned shows
   nothing at all. No level, no "draft", no hint that one exists. The reply
   holds returned grades only, and the view gives a result only to a piece
   that came back.

   With calc.js or constants.js not in (app.js fetches them before this
   screen opens; the fetch can fail) the view is built with no grades, so a
   returned piece shows when it came back and no result, and the list says
   the results didn't load. A view that cannot be built at all shows the
   page's plain waiting line; nothing throws into a draw.

   A returned piece not opened since it came back carries its id as
   data-unseen; app.js watches those rows and tells the server (`seen`).

   app.js draws the frame around this (the header, the tabs) and keeps
   which tab and which of To Do, Sent and Back is showing. */
(function () {
  'use strict';

  if (typeof StudentPage === 'undefined' || !StudentPage.addScreens) return;

  var fmtDate = StudentPage.fmtDate;

  var NO_RESULTS = 'Your results didn’t load. Check your internet and try again.';

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
    try {
      return StudentView.fromPage(gradesAreIn() ? state.reply : withoutGrades(state.reply), state.page);
    } catch (e) {
      return null;
    }
  }

  var SEP = ' · ';
  var DAY = { month: 'short', day: 'numeric' };
  var DUE_DAY = { weekday: 'short', month: 'short', day: 'numeric' };

  /* What one row says, from one piece of the view:
     { kind, title, sub, result, unseen }. */
  function rowView(p) {
    var due = p.dueDate ? 'Due ' + fmtDate(p.dueDate, DUE_DAY) : p.date ? fmtDate(p.date, DAY) : '';
    var view = { kind: p.kind, title: p.title, sub: due, result: '' };
    if (p.kind === 'missing' || p.kind === 'excused') {
      view.sub = [p.kind === 'missing' ? 'Missing' : 'Excused', due].filter(Boolean).join(SEP);
      return view;
    }
    if (p.kind !== 'back') {
      if (p.late) view.sub = ['Late', due].filter(Boolean).join(SEP);
      return view;
    }
    var bits = ['Back ' + fmtDate(p.returnedAt, DAY)];
    if (p.result.kind === 'level' && p.result.word) bits.push(p.result.word);
    view.result = p.result.text || '';
    if (p.late) bits.push('Late');
    if (p.updated) bits.push('Updated');
    view.sub = bits.join(SEP);
    if (p.unseen && view.result !== '') view.unseen = p.id;
    return view;
  }

  function rowHtml(view) {
    return (
      '<li class="sp-row"' +
      (view.unseen ? ' data-unseen="' + esc(view.unseen) + '"' : '') +
      '><span class="sp-dot sp-dot-' +
      view.kind +
      '" aria-hidden="true"></span>' +
      '<span class="sp-row-text"><span class="sp-row-title">' +
      esc(view.title) +
      '</span>' +
      (view.sub ? '<span class="sp-row-sub">' + esc(view.sub) + '</span>' : '') +
      '</span>' +
      (view.result ? '<span class="sp-row-result">' + esc(view.result) + '</span>' : '') +
      '</li>'
    );
  }

  function listHtml(pieces, empty) {
    if (!pieces.length) return empty;
    return (
      '<ul class="sp-list">' +
      pieces
        .map(function (p) {
          return rowHtml(rowView(p));
        })
        .join('') +
      '</ul>'
    );
  }

  /* To Do, Sent and Back. To Do is what is still to hand in: work not back
     yet, and work marked Missing. Sent is work the student has sent and is
     waiting on (nothing can be sent until S5). Back is work that came back. */
  var SEGMENTS = [
    { id: 'todo', label: 'To Do' },
    { id: 'sent', label: 'Sent' },
    { id: 'back', label: 'Back' },
  ];
  function inSegment(view, id) {
    return view.work.filter(function (p) {
      if (id === 'todo') return p.kind === 'due' || p.kind === 'missing';
      if (id === 'back') return p.kind === 'back';
      return false;
    });
  }
  function counts(view) {
    return {
      todo: view.counts.toDo + view.counts.missing,
      sent: view.counts.sent,
      back: view.counts.back,
    };
  }

  function segmentsHtml(state, view) {
    var n = counts(view);
    return (
      '<div class="sp-segments" role="group" aria-label="Assignments">' +
      SEGMENTS.map(function (s) {
        var on = (state.segment || 'todo') === s.id;
        return (
          '<button type="button" class="sp-segment' +
          (on ? ' sp-segment-on' : '') +
          '" data-act="segment" data-segment="' +
          s.id +
          '" aria-pressed="' +
          (on ? 'true' : 'false') +
          '">' +
          esc(s.label + ' ' + n[s.id]) +
          '</button>'
        );
      }).join('') +
      '</div>'
    );
  }

  var TICK =
    '<svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

  // The artboard's "All Caught Up".
  function caughtUpHtml() {
    return (
      '<div class="sp-caught-up"><span class="sp-out-mark">' +
      TICK +
      '</span><p class="sp-caught-up-words">All caught up</p>' +
      '<button type="button" class="sp-btn sp-btn-tint sp-btn-pill" data-act="segment" data-segment="back">See What’s Back</button></div>'
    );
  }

  /* The line over the list when calc.js didn't arrive and a piece has come
     back: the results are missing, not empty. */
  function noResultsHtml(state, view) {
    var any = view.work.some(function (p) {
      return p.kind === 'back';
    });
    if (gradesAreIn() || !any) return '';
    return (
      '<div class="sp-no-results"><p class="sp-msg sp-msg-calm" role="status">' +
      esc(NO_RESULTS) +
      '</p><button type="button" class="sp-btn sp-btn-quiet sp-btn-small" data-act="grades-retry"' +
      (state.sending ? ' disabled' : '') +
      '>' +
      (state.sending ? 'Loading…' : 'Try Again') +
      '</button></div>'
    );
  }

  var EMPTY = {
    sent: '<p class="sp-lead sp-empty">Nothing sent yet.</p>',
    back: '<p class="sp-lead sp-empty">Nothing back yet.</p>',
  };

  function assignmentsBody(state, view) {
    var seg = state.segment || 'todo';
    var pieces = inSegment(view, seg);
    var empty = seg === 'todo' ? caughtUpHtml() : EMPTY[seg];
    return (
      // The tab's name, for the keyboard and a screen reader (app.js moves there); the segments say the rest.
      '<h1 class="sp-page-title sp-hidden-title" tabindex="-1">Assignments</h1>' +
      segmentsHtml(state, view) +
      noResultsHtml(state, view) +
      (view.work.length ? listHtml(pieces, empty) : '<p class="sp-lead sp-empty">No assignments yet.</p>')
    );
  }

  /* All Assignments (the header's list button): every piece, newest first,
     each with its line and result. Search and filters come with S4-F2. */
  function allBody(state, view) {
    return (
      '<div class="sp-all-head"><button type="button" class="sp-btn sp-btn-quiet sp-btn-small" data-act="all-close">Back to Assignments</button></div>' +
      '<h1 class="sp-page-title" tabindex="-1">All Assignments</h1>' +
      noResultsHtml(state, view) +
      listHtml(view.work, '<p class="sp-lead sp-empty">No assignments yet.</p>')
    );
  }

  /* The other three tabs. Questionnaires and Reports open from the card's
     session in S4-F4; My Learning is a class switch, Show My Learning, that
     comes with S13 and is off until then. Each says so plainly. */
  var TAB_BODIES = {
    learning: {
      title: 'My Learning',
      line: 'Your teacher hasn’t turned on My Learning for this class.',
    },
    questionnaires: {
      title: 'Questionnaires',
      line: 'Questionnaires from your teacher will show here.',
    },
    reports: {
      title: 'Reports',
      line: 'Reports from your teacher will show here.',
    },
  };

  function renderAssignments(state) {
    var view = viewOf(state);
    var tab = TAB_BODIES[state.tab] ? state.tab : 'assignments';
    var body;
    if (!view) {
      // Not loaded: the plain waiting line, never a throw.
      body = '<p class="sp-lead sp-msg-calm sp-empty" role="status">Opening your page…</p>';
    } else if (tab !== 'assignments') {
      body =
        '<h1 class="sp-page-title" tabindex="-1">' +
        esc(TAB_BODIES[tab].title) +
        '</h1><p class="sp-lead sp-empty">' +
        esc(TAB_BODIES[tab].line) +
        '</p>';
    } else if (state.all) {
      body = allBody(state, view);
    } else {
      body = assignmentsBody(state, view);
    }
    return StudentPage.pageFrame(state, body);
  }

  StudentPage.addScreens({
    file: 'assignments',
    render: { assignments: renderAssignments },
    // The screen reads the state it is handed; it keeps none of its own.
    share: function () {},
    test: { rowView: rowView, viewOf: viewOf, counts: counts, inSegment: inSegment },
  });
})();
