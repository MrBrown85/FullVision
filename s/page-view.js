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
         segment: 'todo' | 'sent' | 'back', pick: the id of the card
         showing, all: true for All Assignments, search and filter: All
         Assignments' search words and filter ('all' | 'todo' | 'sent' |
         'back'),
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

  // A piece's kind as a class name: one of the four, whatever the view held.
  function kindOf(p) {
    return /^(due|back|missing|excused)$/.test(p.kind) ? p.kind : 'due';
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

  /* ── One piece as a card (the artboard's "To Do Card" and "Returned
     Work") ─────────────────────────────────────────────────── */

  // A level's chip: its words as the view gives them (calc.js's), coloured by the level.
  function chipHtml(text, level) {
    var lv = Math.round(Number(level));
    return '<span class="sp-level sp-lv-' + (lv >= 1 && lv <= 4 ? lv : 0) + '">' + esc(text) + '</span>';
  }

  /* What came back with a piece: Your Result, then each competency or
     rubric criterion with the level given, worded by the view. */
  function resultRows(p) {
    var rows = [];
    if (p.result && p.result.text) rows.push({ name: 'Your Result', text: p.result.text, level: null });
    (p.rubric ? p.rubric.rows : p.competencies || []).forEach(function (r) {
      if (r.text) rows.push({ name: r.name, text: r.text, level: r.level });
    });
    if (!rows.length) return '';
    return (
      '<ul class="sp-piece-rows">' +
      rows
        .map(function (r) {
          return (
            '<li class="sp-piece-row"><span class="sp-piece-row-name">' +
            esc(r.name) +
            '</span>' +
            chipHtml(r.text, r.level) +
            '</li>'
          );
        })
        .join('') +
      '</ul>'
    );
  }

  // The card's pills: when it is due or came back, Missing, Late, Updated.
  function pills(p) {
    var due = p.dueDate ? 'Due ' + fmtDate(p.dueDate, DUE_DAY) : '';
    var out = [];
    if (p.kind === 'back') out.push(['back', 'Returned ' + fmtDate(p.returnedAt, DAY)]);
    else if (p.kind === 'missing') out.push(['missing', 'Missing']);
    if (p.kind !== 'back' && due) out.push(['due', due]);
    if (p.late) out.push(['quiet', 'Late']);
    if (p.updated) out.push(['new', 'Updated']);
    return out
      .map(function (x) {
        return '<span class="sp-flag sp-flag-' + x[0] + '">' + esc(x[1]) + '</span>';
      })
      .join('');
  }

  // A safe element id for a piece's heading.
  function domId(id) {
    return 'sp-piece-' + String(id).replace(/[^A-Za-z0-9_-]/g, '');
  }

  /* One card. A returned piece not opened since it came back carries its
     id as data-unseen: the student page counts it opened once the card has
     been on screen. */
  function cardHtml(p, picked) {
    var unseen = p.kind === 'back' && p.unseen && p.result && p.result.text;
    return (
      '<article class="sp-piece sp-piece-' +
      kindOf(p) +
      (picked ? ' sp-picked' : '') +
      '" data-piece="' +
      esc(p.id) +
      '"' +
      (unseen ? ' data-unseen="' + esc(p.id) + '"' : '') +
      ' aria-labelledby="' +
      domId(p.id) +
      '"><div class="sp-piece-card"><div class="sp-piece-tags">' +
      pills(p) +
      '</div><h2 class="sp-piece-title" id="' +
      domId(p.id) +
      '" tabindex="-1">' +
      esc(p.title) +
      '</h2>' +
      (p.kind === 'back' ? resultRows(p) : '') +
      (p.kind === 'back' && p.comment ? '<p class="sp-piece-comment">' + esc(p.comment) + '</p>' : '') +
      '</div></article>'
    );
  }

  // The piece with this id among these, or the first.
  function pieceIn(pieces, id) {
    for (var i = 0; i < pieces.length; i++) if (pieces[i].id === id) return pieces[i];
    return pieces[0] || null;
  }

  /* The cards of one of To Do, Sent and Back. On a phone they sit side by
     side and the student swipes between them ("1 of 3"); on a Chromebook
     the list is on the left and the card picked on the right (the
     Chromebook board). page-view.css shows one or the other. */
  function deckHtml(ui, pieces) {
    var picked = pieceIn(pieces, ui.pick);
    return (
      '<div class="sp-split">' +
      '<ul class="sp-side">' +
      pieces
        .map(function (p) {
          var v = rowView(p);
          var on = p === picked;
          return (
            '<li><button type="button" class="sp-side-row' +
            (on ? ' sp-side-on' : '') +
            '" data-act="pick" data-piece="' +
            esc(p.id) +
            '" aria-pressed="' +
            (on ? 'true' : 'false') +
            '"><span class="sp-dot sp-dot-' +
            kindOf(p) +
            '" aria-hidden="true"></span><span class="sp-row-text"><span class="sp-side-title">' +
            esc(v.title) +
            '</span>' +
            (v.sub ? '<span class="sp-row-sub">' + esc(v.sub) + '</span>' : '') +
            '</span></button></li>'
          );
        })
        .join('') +
      '</ul>' +
      '<div class="sp-deck">' +
      pieces
        .map(function (p) {
          return cardHtml(p, p === picked);
        })
        .join('') +
      '</div></div>' +
      (pieces.length > 1
        ? '<p class="sp-deck-count" aria-hidden="true">' +
          esc(pieces.indexOf(picked) + 1 + ' of ' + pieces.length) +
          '</p>'
        : '')
    );
  }

  function assignmentsBody(ui, view) {
    var seg = ui.segment || 'todo';
    var pieces = inSegment(view, seg);
    return (
      // The tab's name, for the keyboard and a screen reader; the segments say the rest.
      '<h1 class="sp-page-title sp-hidden-title" tabindex="-1">Assignments</h1>' +
      segmentsHtml(ui, view) +
      noResultsHtml(ui, view) +
      (!view.work.length
        ? '<p class="sp-lead sp-empty">No assignments yet.</p>'
        : pieces.length
          ? deckHtml(ui, pieces)
          : seg === 'todo'
            ? caughtUpHtml()
            : EMPTY[seg])
    );
  }

  /* ── All Assignments (the artboard's board): search, filters, every
     piece; a row opens its card. ───────────────────────────── */

  var FILTERS = [
    { id: 'all', label: 'All' },
    { id: 'todo', label: 'To Do' },
    { id: 'sent', label: 'Sent' },
    { id: 'back', label: 'Back' },
  ];

  // What the search words and the filter leave of the list. The words are matched against the title.
  function matching(view, ui) {
    var words = String(ui.search || '')
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    var filter = ui.filter || 'all';
    return view.work.filter(function (p) {
      if (filter !== 'all' && segmentOf(p) !== filter) return false;
      var title = String(p.title || '').toLowerCase();
      return words.every(function (w) {
        return title.indexOf(w) >= 0;
      });
    });
  }

  // Which of To Do, Sent and Back a piece is in, or '' (Excused).
  function segmentOf(p) {
    return p.kind === 'back' ? 'back' : p.kind === 'due' || p.kind === 'missing' ? 'todo' : '';
  }

  var BACK_ARROW =
    '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M15 5l-7 7 7 7"/></svg>';
  var NEXT_ARROW =
    '<svg class="sp-row-go" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M9 6l6 6-6 6"/></svg>';

  /* One row of All Assignments. It opens the piece's card; Excused work has
     no card, so its row opens nothing. */
  function allRowHtml(p) {
    var v = rowView(p);
    var inner =
      '<span class="sp-dot sp-dot-' +
      kindOf(p) +
      '" aria-hidden="true"></span><span class="sp-row-text"><span class="sp-row-title">' +
      esc(v.title) +
      '</span>' +
      (v.sub ? '<span class="sp-row-sub">' + esc(v.sub) + '</span>' : '') +
      '</span>' +
      (v.result ? '<span class="sp-row-result">' + esc(v.result) + '</span>' : '');
    return (
      '<li class="sp-row"' +
      (v.unseen ? ' data-unseen="' + esc(v.unseen) + '"' : '') +
      '>' +
      (segmentOf(p)
        ? '<button type="button" class="sp-row-open" data-act="open-piece" data-piece="' +
          esc(p.id) +
          '">' +
          inner +
          NEXT_ARROW +
          '</button>'
        : '<span class="sp-row-open">' + inner + '</span>') +
      '</li>'
    );
  }

  function allBody(ui, view) {
    var shown = matching(view, ui);
    var filter = ui.filter || 'all';
    return (
      '<div class="sp-all-head"><button type="button" class="sp-head-icon" data-act="all-close" aria-label="Back to cards">' +
      BACK_ARROW +
      '</button><h1 class="sp-page-title" tabindex="-1">All Assignments</h1></div>' +
      '<label class="sp-hidden-title" for="sp-search">Search assignments</label>' +
      '<input id="sp-search" class="sp-search" type="search" placeholder="Search assignments" autocomplete="off" value="' +
      esc(ui.search || '') +
      '">' +
      '<div class="sp-filters" role="group" aria-label="Show">' +
      FILTERS.map(function (f) {
        var on = f.id === filter;
        return (
          '<button type="button" class="sp-filter' +
          (on ? ' sp-filter-on' : '') +
          '" data-act="filter" data-filter="' +
          f.id +
          '" aria-pressed="' +
          (on ? 'true' : 'false') +
          '">' +
          esc(f.label) +
          '</button>'
        );
      }).join('') +
      '</div>' +
      noResultsHtml(ui, view) +
      (!view.work.length
        ? '<p class="sp-lead sp-empty">No assignments yet.</p>'
        : shown.length
          ? '<ul class="sp-list">' + shown.map(allRowHtml).join('') + '</ul>'
          : '<p class="sp-lead sp-empty" role="status">Nothing matches.</p>')
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

  /* ── What a press changes ──────────────────────────────────── */

  var TAB_IDS = { assignments: 1, learning: 1, questionnaires: 1, reports: 1 };
  var SEGMENT_IDS = { todo: 1, sent: 1, back: 1 };
  var FILTER_IDS = { all: 1, todo: 1, sent: 1, back: 1 };
  function has(map, key) {
    return typeof key === 'string' && Object.prototype.hasOwnProperty.call(map, key);
  }

  /* A press on one of the page's own buttons, answered with what the
     student now looks at: { ui, focus } (focus: where the keyboard goes
     after the page is drawn again), or null when the press is not one of
     these (Done, Your Classes, Try Again: the student page's own). Nothing
     here reaches the network or the session, so the student page and the
     preview answer the same presses the same way. `el` is the button. */
  function press(ui, view, act, el) {
    var next = Object.assign({}, ui || {});
    var attr = function (name) {
      return (el && el.getAttribute && el.getAttribute(name)) || '';
    };
    if (act === 'tab') {
      if (!has(TAB_IDS, attr('data-tab'))) return null;
      next.tab = attr('data-tab');
      next.all = false;
      var top = el.closest && el.closest('.sp-tabs-top');
      return { ui: next, focus: (top ? '.sp-tabs-top' : '.sp-tabs-bottom') + ' .sp-tab-on' };
    }
    if (act === 'segment') {
      if (!has(SEGMENT_IDS, attr('data-segment'))) return null;
      next.tab = 'assignments';
      next.segment = attr('data-segment');
      next.all = false;
      next.pick = '';
      return { ui: next, focus: '.sp-segment-on' };
    }
    if (act === 'all-open' || act === 'all-close') {
      next.tab = 'assignments';
      next.all = act === 'all-open';
      return { ui: next, focus: next.all ? '.sp-page-title' : '.sp-segment-on' };
    }
    if (act === 'filter') {
      if (!has(FILTER_IDS, attr('data-filter'))) return null;
      next.filter = attr('data-filter');
      return { ui: next, focus: '.sp-filter-on' };
    }
    if (act === 'pick' || act === 'open-piece') {
      var id = attr('data-piece');
      var p = view && pieceIn(view.work, id);
      if (!p || p.id !== id || !segmentOf(p)) return null;
      next.tab = 'assignments';
      next.all = false;
      next.segment = segmentOf(p);
      next.pick = p.id;
      return { ui: next, focus: '#' + domId(p.id), piece: p.id };
    }
    return null;
  }

  /* After the page is drawn into `root`: the phone's cards start at the one
     picked, and the count under them ("2 of 3") follows the swipe.
     `onPick(id)` is told each card the student swipes to. */
  function settle(root, onPick) {
    var deck = root && root.querySelector ? root.querySelector('.sp-deck') : null;
    if (!deck) return;
    var cards = Array.prototype.slice.call(deck.querySelectorAll('.sp-piece'));
    var on = deck.querySelector('.sp-picked');
    if (on && deck.scrollWidth > deck.clientWidth && typeof deck.scrollTo === 'function') {
      deck.scrollTo({ left: on.offsetLeft - deck.offsetLeft, behavior: 'auto' });
    }
    var count = root.querySelector('.sp-deck-count');
    deck.addEventListener(
      'scroll',
      function () {
        if (!deck.clientWidth || deck.scrollWidth <= deck.clientWidth) return;
        var at = Math.max(0, Math.min(cards.length - 1, Math.round(deck.scrollLeft / deck.clientWidth)));
        if (count) count.textContent = at + 1 + ' of ' + cards.length;
        if (onPick && cards[at]) onPick(cards[at].getAttribute('data-piece'));
      },
      { passive: true },
    );
  }

  return {
    html: html,
    draw: draw,
    press: press,
    settle: settle,
    rowView: rowView,
    counts: counts,
    inSegment: inSegment,
    matching: matching,
    segmentOf: segmentOf,
  };
})();
