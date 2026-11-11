/* The student's page for one class, drawn from a view (S4-F1; the
   artboard's "To Do Card", "All Caught Up", "All Assignments" and "Page on
   a Chromebook").

   One drawing for two places. The student page (s/assignments.js) and the
   teacher's Preview as Student (teacher/preview-student.js) both hand this
   file the view shared/student-view.js builds (StudentView.fromPage on the
   student's phone, StudentView.fromCache in the preview) and get the same
   HTML back, so what a teacher previews is what the student sees.

   So this file knows nothing of a session, the network, the address or
   the page's state: html(view, ui) is a pure function of the view and of
   what the student chose to look at (ui), and needs only esc
   (shared/html.js). Its buttons carry data-act names that the student page
   answers (s/app.js); in the preview nothing answers them. Its look is
   s/page-view.css, which both places load.

   Nothing here works out or formats a grade: a result is the view's text,
   which calc.js and constants.js gave it. A grade never returned is not in
   the view, so it cannot be drawn.

   ui: { tab: 'assignments' | 'learning' | 'questionnaires' | 'reports',
         segment: 'todo' | 'sent' | 'back', all: true for All Assignments,
         noResults: the results didn't load (say so, with Try Again),
         sending: Try Again is under way, waiting: the view is not here yet,
         note: a line under the body (Demo Mode's), sheet: Your Classes is
         open }. */
window.StudentPageView = (function () {
  'use strict';

  var SEP = ' · ';
  var DAY = { month: 'short', day: 'numeric' };
  var DUE_DAY = { weekday: 'short', month: 'short', day: 'numeric' };
  var NO_RESULTS = 'Your results didn’t load. Check your internet and try again.';
  var WAITING = 'Opening your page…';

  // A date as the student page shows it: a day (YYYY-MM-DD) at noon, so no time zone moves it.
  function fmtDate(iso, opts) {
    if (!iso) return '';
    var t = new Date(String(iso).length === 10 ? iso + 'T12:00:00' : iso);
    return isNaN(t) ? '' : t.toLocaleDateString('en-CA', opts || { month: 'long', day: 'numeric' });
  }

  // "Block A", as the class's name shows it.
  function blockLabel(block) {
    var b = String(block || '').trim();
    return /^[A-Za-z0-9]{1,2}$/.test(b) ? 'Block ' + b.toUpperCase() : b;
  }

  /* ── One row ───────────────────────────────────────────────── */

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
    var kind = /^(due|back|missing|excused)$/.test(view.kind) ? view.kind : 'due';
    return (
      '<li class="sp-row"' +
      (view.unseen ? ' data-unseen="' + esc(view.unseen) + '"' : '') +
      '><span class="sp-dot sp-dot-' +
      kind +
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

  /* ── To Do, Sent and Back ──────────────────────────────────── */

  /* To Do is what is still to hand in: work not back yet, and work marked
     Missing. Sent is work sent and waiting (nothing can be sent until S5).
     Back is work that came back. */
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
    return { todo: view.counts.toDo + view.counts.missing, sent: view.counts.sent, back: view.counts.back };
  }

  function segmentsHtml(ui, view) {
    var n = counts(view);
    return (
      '<div class="sp-segments" role="group" aria-label="Assignments">' +
      SEGMENTS.map(function (s) {
        var on = (ui.segment || 'todo') === s.id;
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

  /* The line over the list when the results didn't load and a piece has
     come back: the results are missing, not empty. */
  function noResultsHtml(ui, view) {
    var any = view.work.some(function (p) {
      return p.kind === 'back';
    });
    if (!ui.noResults || !any) return '';
    return (
      '<div class="sp-no-results"><p class="sp-msg" role="status">' +
      esc(NO_RESULTS) +
      '</p><button type="button" class="sp-btn sp-btn-quiet" data-act="grades-retry"' +
      (ui.sending ? ' disabled' : '') +
      '>' +
      (ui.sending ? 'Loading…' : 'Try Again') +
      '</button></div>'
    );
  }

  var EMPTY = {
    sent: '<p class="sp-lead sp-empty">Nothing sent yet.</p>',
    back: '<p class="sp-lead sp-empty">Nothing back yet.</p>',
  };

  function assignmentsBody(ui, view) {
    var seg = ui.segment || 'todo';
    return (
      // The tab's name, for the keyboard and a screen reader; the segments say the rest.
      '<h1 class="sp-page-title sp-hidden-title" tabindex="-1">Assignments</h1>' +
      segmentsHtml(ui, view) +
      noResultsHtml(ui, view) +
      (view.work.length
        ? listHtml(inSegment(view, seg), seg === 'todo' ? caughtUpHtml() : EMPTY[seg])
        : '<p class="sp-lead sp-empty">No assignments yet.</p>')
    );
  }

  /* All Assignments (the header's list button): every piece, newest first.
     Search and filters come with S4-F2. */
  function allBody(ui, view) {
    return (
      '<div class="sp-all-head"><button type="button" class="sp-btn sp-btn-quiet" data-act="all-close">Back to Assignments</button></div>' +
      '<h1 class="sp-page-title" tabindex="-1">All Assignments</h1>' +
      noResultsHtml(ui, view) +
      listHtml(view.work, '<p class="sp-lead sp-empty">No assignments yet.</p>')
    );
  }

  /* The other three tabs. Questionnaires and Reports come in S4-F4; My
     Learning is a class switch, Show My Learning, that comes with S13 and
     is off until then. Each says so plainly. */
  var TAB_BODIES = {
    learning: { title: 'My Learning', line: 'Your teacher hasn’t turned on My Learning for this class.' },
    questionnaires: { title: 'Questionnaires', line: 'Questionnaires from your teacher will show here.' },
    reports: { title: 'Reports', line: 'Reports from your teacher will show here.' },
  };

  function bodyHtml(view, ui) {
    if (ui.waiting || !view) return '<p class="sp-lead sp-empty" role="status">' + esc(WAITING) + '</p>';
    var tab = TAB_BODIES[ui.tab] ? ui.tab : 'assignments';
    if (tab !== 'assignments') {
      return (
        '<h1 class="sp-page-title" tabindex="-1">' +
        esc(TAB_BODIES[tab].title) +
        '</h1><p class="sp-lead sp-empty">' +
        esc(TAB_BODIES[tab].line) +
        '</p>'
      );
    }
    return ui.all ? allBody(ui, view) : assignmentsBody(ui, view);
  }

  /* ── The frame ─────────────────────────────────────────────── */

  var CHEVRON =
    '<svg class="sp-chevron" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M6 9l6 6 6-6"/></svg>';
  var MENU =
    '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
  var TABS = [
    {
      id: 'assignments',
      label: 'Assignments',
      icon: '<rect x="4" y="5" width="16" height="14" rx="3"/><path d="M8 10h8M8 14h5"/>',
    },
    { id: 'learning', label: 'My Learning', icon: '<path d="M4 20h4v-6H4zM10 20h4V9h-4zM16 20h4V4h-4z"/>' },
    {
      id: 'questionnaires',
      label: 'Questionnaires',
      icon: '<circle cx="12" cy="12" r="8"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5M12 16.5v.01"/>',
    },
    { id: 'reports', label: 'Reports', icon: '<path d="M7 3h7l4 4v14H7z"/><path d="M10 12h5M10 16h5"/>' },
  ];

  /* The four tabs. Drawn twice, once in the header for a Chromebook and
     once along the bottom for a phone; page-view.css shows one. */
  function tabBarHtml(ui, where) {
    var on = TAB_BODIES[ui.tab] ? ui.tab : 'assignments';
    return (
      '<nav class="sp-tabs sp-tabs-' +
      where +
      '" aria-label="Your Page">' +
      TABS.map(function (t) {
        return (
          '<button type="button" class="sp-tab' +
          (t.id === on ? ' sp-tab-on' : '') +
          '" data-act="tab" data-tab="' +
          t.id +
          '"' +
          (t.id === on ? ' aria-current="page"' : '') +
          '><svg class="sp-tab-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
          t.icon +
          '</svg><span>' +
          esc(t.label) +
          '</span></button>'
        );
      }).join('') +
      '</nav>'
    );
  }

  /* The whole page: the class's name with its block (it opens Your
     Classes), the tabs on a Chromebook, Done and the All Assignments
     button; the tab's body; the tabs along the bottom on a phone. */
  function html(view, ui) {
    ui = ui || {};
    var course = (view && view.course) || ui.course || {};
    var block = String(course.block || '').trim();
    var all = !!ui.all && (TAB_BODIES[ui.tab] ? ui.tab : 'assignments') === 'assignments';
    return (
      '<div class="sp-view">' +
      '<header class="sp-head">' +
      '<button type="button" class="sp-head-switch" data-act="classes-open" aria-haspopup="dialog" aria-expanded="' +
      (ui.sheet ? 'true' : 'false') +
      '"><span class="sp-head-title">' +
      esc(course.name || '') +
      '</span>' +
      (block ? '<span class="sp-pill">' + esc(blockLabel(block)) + '</span>' : '') +
      CHEVRON +
      '</button>' +
      '<span class="sp-head-gap"></span>' +
      tabBarHtml(ui, 'top') +
      '<span class="sp-head-gap"></span>' +
      '<button type="button" class="sp-done" data-act="card-done">Done</button>' +
      '<button type="button" class="sp-head-icon" data-act="all-open" aria-label="All assignments"' +
      (all ? ' aria-pressed="true"' : '') +
      '>' +
      MENU +
      '</button>' +
      '</header>' +
      '<main class="sp-page">' +
      bodyHtml(view, ui) +
      (ui.note ? '<p class="sp-fine">' + esc(ui.note) + '</p>' : '') +
      '</main>' +
      tabBarHtml(ui, 'bottom') +
      '</div>'
    );
  }

  /* Draws the page into `root`. The preview's way in. */
  function draw(root, view, ui) {
    // html-safe: html() escapes every title, date line, result and name with esc; the rest is fixed markup
    root.innerHTML = html(view, ui);
  }

  return {
    html: html,
    draw: draw,
    rowView: rowView,
    counts: counts,
    inSegment: inSegment,
  };
})();
