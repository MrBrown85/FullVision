/* The student's page for one class, drawn from a view (S4-F1; the
   artboard's "To Do Card", "All Caught Up", "All Assignments" and "Page on
   a Chromebook"; S4-F3: "Your Feedback" for each way of scoring, "The
   Whole Rubric" and "Your Feedback on a Chromebook").

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

   ui: { tab: 'assignments' | 'learning' | 'questionnaires' (the tab
         called Reflect), segment: 'outstanding' | 'upcoming', pick:
         the id of the card picked on a Chromebook,
         feedback: the id of the piece Your Feedback is open on, whole:
         true for its The Whole Rubric (also for work not back yet, from
         See the Rubric), compare: true for its Before and After (a
         returned revision, S11-F2), levels: What the Levels Mean is open
         (it starts closed), card: the id of a sent piece opened from My
         Learning, logout: Log Out? is asking, settings: Settings (the
         gear) is open, textSize: 'large' or 'larger' ('' is Normal),
         classes and classOn: the classes Switch Class lists and the one
         showing,
         form: the questionnaire picked on a Chromebook,
         noResults: the results didn't load (say so, with Try Again),
         sending: Try Again is under way, waiting: the view is not here yet,
         note: a line under the body (Demo Mode's) }.

   The three tabs (Colin, 2026-11-14): Assignments is what the student
   still has to do, Outstanding and Upcoming, the cards one under another
   to scroll; My Learning is their report card, the grade and every piece
   handed in or returned, each opening its feedback; Reflect is the
   questionnaires, each called a reflection. */
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

  /* The page never names the teacher (Colin's ruling 112, "Leave the
     name off."): it says "your teacher". */

  /* ── One row ───────────────────────────────────────────────── */

  /* What one row says, from one piece of the view:
     { kind, title, sub, result, unseen }. */
  function rowView(p) {
    var due = p.dueDate ? 'Due ' + fmtDate(p.dueDate, DUE_DAY) : p.date ? fmtDate(p.date, DAY) : '';
    var view = { kind: p.kind, title: p.title, sub: due, result: '' };
    // A revision asked for (S11-F2): "Needs Revision · due Nov 10" (the board's).
    if (p.kind === 'revise') {
      var by = p.revision && p.revision.reviseBy;
      view.sub = ['Needs Revision', by ? 'due ' + fmtDate(by, DAY) : ''].filter(Boolean).join(SEP);
      return view;
    }
    if (p.kind === 'missing' || p.kind === 'excused') {
      view.sub = [p.kind === 'missing' ? 'Missing' : 'Excused', due].filter(Boolean).join(SEP);
      return view;
    }
    // Sent and not back yet: "Sent Nov 4 · 3 photos" (the board's).
    if (p.kind === 'sent') {
      var sent = (p.send && p.send.sent) || {};
      view.sub = ['Sent ' + fmtDate(sent.at, DAY), p.late ? 'Late' : '', photosWord(sent.pages)]
        .filter(Boolean)
        .join(SEP);
      return view;
    }
    if (p.kind !== 'back') {
      if (p.late) view.sub = ['Late', due].filter(Boolean).join(SEP);
      return view;
    }
    var bits = [
      (p.updated ? 'Updated ' : 'Returned ') + fmtDate(p.updated ? p.updatedAt || p.returnedAt : p.returnedAt, DAY),
    ];
    if (p.result.kind === 'level' && p.result.word) bits.push(p.result.word);
    view.result = p.result.text || '';
    if (p.late) bits.push('Late');
    view.sub = bits.join(SEP);
    if (p.unseen && view.result !== '') view.unseen = p.id;
    return view;
  }

  // A piece's kind as a class name: one of the five, whatever the view held.
  function kindOf(p) {
    return /^(due|revise|sent|back|missing|excused)$/.test(p.kind) ? p.kind : 'due';
  }

  // "1 photo", "3 photos"; nothing for none.
  function photosWord(n) {
    n = Number(n) || 0;
    return n > 0 ? (n === 1 ? '1 photo' : n + ' photos') : '';
  }

  /* ── Outstanding and Upcoming (Colin, 2026-11-14) ─────────────

     Assignments holds what the student still has to hand in. Outstanding:
     work due today or earlier (or with no due date), work marked Missing,
     and work returned for revision (S11-F2), a revision first and then the
     oldest due date first. Upcoming: work due after today, soonest first.
     Work sent and waiting, and work that came back, are on My Learning. */
  var SEGMENTS = [
    { id: 'outstanding', label: 'Outstanding' },
    { id: 'upcoming', label: 'Upcoming' },
  ];

  // The class's today (the view's), or this device's, as YYYY-MM-DD.
  function todayOf(view) {
    if (view && /^\d{4}-\d{2}-\d{2}$/.test(String(view.today || ''))) return view.today;
    var d = new Date();
    var pad = function (n) {
      return (n < 10 ? '0' : '') + n;
    };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  // Which of Outstanding and Upcoming a piece is in, or '' (on My Learning, or Excused).
  function segmentOf(p, view) {
    if (!p) return '';
    if (p.kind === 'revise' || p.kind === 'missing') return 'outstanding';
    if (p.kind !== 'due') return '';
    return p.dueDate && p.dueDate > todayOf(view) ? 'upcoming' : 'outstanding';
  }

  function inSegment(view, id) {
    var list = view.work.filter(function (p) {
      return segmentOf(p, view) === id;
    });
    // Soonest first, by due date (its date when it has none); undated work last.
    var day = function (p) {
      return p.dueDate || p.date || '9999-12-31';
    };
    return list
      .map(function (p, i) {
        return { p: p, i: i };
      })
      .sort(function (x, y) {
        var r = (x.p.kind === 'revise' ? 0 : 1) - (y.p.kind === 'revise' ? 0 : 1);
        if (r) return r;
        var a = day(x.p);
        var b = day(y.p);
        if (a !== b) return a < b ? -1 : 1;
        return x.i - y.i;
      })
      .map(function (x) {
        return x.p;
      });
  }
  function counts(view) {
    return { outstanding: inSegment(view, 'outstanding').length, upcoming: inSegment(view, 'upcoming').length };
  }

  function segmentsHtml(ui, view) {
    var n = counts(view);
    var at = segmentIn(ui);
    return (
      '<div class="sp-segments" role="group" aria-label="Assignments">' +
      SEGMENTS.map(function (s) {
        var on = at === s.id;
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

  // The segment showing: Outstanding unless Upcoming was picked.
  function segmentIn(ui) {
    return ui && ui.segment === 'upcoming' ? 'upcoming' : 'outstanding';
  }

  var TICK =
    '<svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

  // Nothing outstanding: All Caught Up, and the way to what is coming when something is.
  function caughtUpHtml(view) {
    var next = counts(view).upcoming;
    return (
      '<div class="sp-caught-up"><span class="sp-out-mark">' +
      TICK +
      '</span><p class="sp-caught-up-words">All caught up</p>' +
      (next
        ? '<button type="button" class="sp-btn sp-btn-tint sp-btn-pill" data-act="segment" data-segment="upcoming">See What’s Coming Up</button>'
        : '') +
      '</div>'
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

  var NOTHING_UPCOMING = '<p class="sp-lead sp-empty">Nothing coming up yet.</p>';

  /* ── One piece as a card (the artboard's "To Do Card" and "Returned
     Work") ─────────────────────────────────────────────────── */

  // A level's chip: its words as the view gives them (calc.js's), coloured by the level.
  function chipHtml(text, level) {
    var lv = Math.round(Number(level));
    return '<span class="sp-level sp-lv-' + (lv >= 1 && lv <= 4 ? lv : 0) + '">' + esc(text) + '</span>';
  }

  var PILL_ICON = {
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    camera: '<path d="M4 8.5h3l1.6-2.2h6.8L17 8.5h3v10H4z"/><circle cx="12" cy="13.2" r="3.2"/>',
    again: '<path d="M19 12a7 7 0 1 1-2.1-5"/><path d="M19 4.5V8h-3.5"/>',
    lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
    next: '<path d="M4 12h15M13 6l6 6-6 6"/>',
    // The status pills (Colin, 2026-11-17): each status its own icon as well as its own word and colour.
    later: '<rect x="4" y="5.5" width="16" height="14.5" rx="2.5"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
    waiting:
      '<path d="M7 4h10M7 20h10M8 4v2.5a4 4 0 0 0 1.6 3.2L12 12l2.4-2.3A4 4 0 0 0 16 6.5V4M8 20v-2.5a4 4 0 0 1 1.6-3.2L12 12l2.4 2.3a4 4 0 0 1 1.6 3.2V20"/>',
    alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.01"/>',
    late: '<circle cx="11" cy="12" r="7.5"/><path d="M11 8.5V12l2.5 1.5M20.5 6.5v5M20.5 15v.01"/>',
    tick: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  };
  function pillIcon(name, size) {
    return (
      '<svg class="sp-pill-icon" viewBox="0 0 24 24" width="' +
      (size || 12) +
      '" height="' +
      (size || 12) +
      '" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
      PILL_ICON[name] +
      '</svg>'
    );
  }
  function pillHtml(kind, text, icon) {
    return '<span class="sp-flag sp-flag-' + kind + '">' + (icon ? pillIcon(icon, 14) : '') + esc(text) + '</span>';
  }

  // Work still to do whose last day to send has passed (the Closed Assignment board).
  function isClosed(p) {
    return (p.kind === 'due' || p.kind === 'missing') && !!(p.send && p.send.takes && !p.send.open);
  }

  // How many days off a day is from today: 0 today, 1 tomorrow, -1 yesterday; null for no date.
  function daysFrom(day, today) {
    var a = Date.parse(String(day).slice(0, 10) + 'T12:00:00Z');
    var b = Date.parse(String(today).slice(0, 10) + 'T12:00:00Z');
    if (isNaN(a) || isNaN(b)) return null;
    return Math.round((a - b) / 86400000);
  }
  /* The due date at the right of the status band: "Fri, Nov 20" for work to
     do, "Due Jan 31" beside Missing, "Was due Oct 22" once the day has passed. */
  function bandWhen(p, view) {
    if ((p.kind !== 'due' && p.kind !== 'missing') || !p.dueDate) return '';
    var n = daysFrom(p.dueDate, todayOf(view));
    if (n != null && n < 0) return 'Was due ' + fmtDate(p.dueDate, DAY);
    return p.kind === 'missing' ? 'Due ' + fmtDate(p.dueDate, DAY) : fmtDate(p.dueDate, DUE_DAY);
  }

  /* Work still to do, by its due date (Colin, 2026-11-17: students could not
     tell work not assessed yet from late work). "In 4 Days" in blue, "Due
     Tomorrow" and "Due Today" in amber, and once the day has passed "Not
     Assessed Yet" in grey: nobody has marked it Missing and it is not back,
     so nothing is wrong yet. Missing is the teacher's word, never the date's. */
  function timeStatus(p, view) {
    if (!p.dueDate) return null;
    var n = daysFrom(p.dueDate, todayOf(view));
    if (n == null) return null;
    if (n < 0) return { kind: 'waiting', word: 'Not Assessed Yet', icon: 'waiting' };
    if (n === 0) return { kind: 'due', word: 'Due Today', icon: 'clock' };
    if (n === 1) return { kind: 'due', word: 'Due Tomorrow', icon: 'clock' };
    return { kind: 'later', word: 'In ' + n + ' Days', icon: 'later' };
  }

  // When work was sent, to the minute: "Sent Nov 12, 3:41 p.m.".
  function sentAt(at) {
    if (!at) return 'Sent';
    var t = new Date(at);
    if (isNaN(t) || String(at).length <= 10) return 'Sent ' + fmtDate(at, DAY);
    return 'Sent ' + fmtDate(at, DAY) + ', ' + t.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' });
  }

  /* Where a piece stands, as the band across the top of its card says it
     (Colin, 2026-11-17, Option B of the mockup): { kind, word, icon },
     or null when there is nothing to say (work to do with no due date).
     How far off the due date is, Returned, Updated, Missing, Revise by,
     Sent with its photos, or Closed. Missing is the one solid band, with
     nothing more on it (Colin, 2026-11-17: no "counts as 0" on the card). */
  function statusOf(p, view) {
    // A returned grade changed since the student last looked says when (the board's "Updated Nov 12").
    if (p.kind === 'back' && p.updated)
      return { kind: 'updated', word: 'Updated ' + fmtDate(p.updatedAt || p.returnedAt, DAY), icon: 'tick' };
    if (p.kind === 'back') return { kind: 'back', word: 'Returned ' + fmtDate(p.returnedAt, DAY), icon: 'tick' };
    if (p.kind === 'missing') return { kind: 'missing', word: 'Missing', icon: 'alert' };
    // "Closed Nov 13" (the Closed Assignment board).
    if (isClosed(p))
      return {
        kind: 'closed',
        word: p.send.closesOn ? 'Closed ' + fmtDate(p.send.closesOn, DAY) : 'Closed',
        icon: 'lock',
      };
    if (p.kind === 'due') return timeStatus(p, view);
    if (p.kind === 'revise') {
      // "Revise by Tue, Nov 10" (the Needs Revision board).
      var by = p.revision && p.revision.reviseBy;
      return { kind: 'revise', word: by ? 'Revise by ' + fmtDate(by, DUE_DAY) : 'Needs Revision', icon: 'again' };
    }
    if (p.kind === 'sent') {
      // "Sent Nov 4 · 3 photos" (the Sent, Being Graded board).
      var sent = (p.send && p.send.sent) || {};
      var at = sent.at || (p.group && p.group.sentAt) || '';
      var pages = p.group && p.group.sent ? p.group.pages : sent.pages;
      return { kind: 'sent', word: [sentAt(at), photosWord(pages)].filter(Boolean).join(SEP), icon: 'camera' };
    }
    return null;
  }

  /* The band across the top of a card: the status with its icon on the left,
     the due date on the right. Each status has its own word, icon and colour. */
  function bandHtml(p, view) {
    var st = statusOf(p, view);
    if (!st) return '';
    var when = bandWhen(p, view);
    return (
      '<div class="sp-band sp-band-' +
      st.kind +
      '">' +
      pillHtml(st.kind, st.word, st.icon) +
      (when ? '<span class="sp-band-when">' + esc(when) + '</span>' : '') +
      '</div>'
    );
  }

  /* The pills under a card's title, beside its band: Closed on work that is
     also Missing, Group, and the teacher's Late. */
  function pills(p) {
    var out = [];
    if (p.kind === 'missing' && isClosed(p))
      out.push(pillHtml('closed', p.send.closesOn ? 'Closed ' + fmtDate(p.send.closesOn, DAY) : 'Closed', 'lock'));
    // One per Group (S12-F1, the board's "Group" tag).
    if (p.group) out.push(pillHtml('quiet', 'Group'));
    if (p.late) out.push(pillHtml('late', 'Late', 'late'));
    return out.join('');
  }

  // An id as it may sit inside a selector's quotes.
  function cssId(id) {
    return String(id).replace(/["\\]/g, '');
  }

  // A safe element id for a piece's heading.
  function domId(id) {
    return 'sp-piece-' + String(id).replace(/[^A-Za-z0-9_-]/g, '');
  }

  /* See the Rubric, on work not back yet that has one: the one thing
     about how it is graded a student looks for before starting. What
     You're Graded On, its I Can lines and its Core Competencies came off
     the card (Colin, 2026-11-14: "far too wordy"). */
  function rubricLinkHtml(p) {
    if (!p.rubric) return '';
    return (
      '<button type="button" class="sp-link-btn sp-rubric-link" data-act="whole" data-piece="' +
      esc(p.id) +
      '">See the Rubric' +
      GO_ARROW +
      '</button>'
    );
  }

  /* A returned piece with a result opens Your Feedback; so does work
     returned for revision with its grade kept, and a revision sent while
     its new grade is not back (the grade the student was given, S11-F2). */
  function hasFeedback(p) {
    if (!p || !p.result || !p.result.text) return false;
    return p.kind === 'back' || (!!p.revision && (p.kind === 'revise' || p.kind === 'sent'));
  }

  /* ── Sending (S5-F2, S5-F3; the artboard's "To Do Card", "Closed
     Assignment", "Sent, Being Graded" and "Unsend or Replace") ───── */

  /* On a card still to do that takes work: Send My Work while the piece is
     open; "Closed Nov 13" and "Hand this one in on paper" once its last
     day has passed. Nothing when the class takes no work. */
  function sendBlockHtml(p) {
    var send = p.send;
    if (!send || !send.takes) return '';
    // Closed: the pill under the title says when; a locked row says what to do.
    if (!send.open) return lockRowHtml('Hand this one in on paper', 'sp-send-closed-line');
    return (
      '<button type="button" class="sp-btn sp-btn-primary sp-btn-big sp-btn-icon" data-act="send-open" data-piece="' +
      esc(p.id) +
      '">' +
      pillIcon('camera', 20) +
      'Send My Work</button>'
    );
  }

  /* A quiz the student answers on the page (docs/plans/quizzes-plan.md Q3b; s/quiz.js opens it). Drawn only for a piece
     the page marked as one, which happens only with the quizzes switch on. */
  function quizBlockHtml(p) {
    if (!p.quiz) return '';
    return (
      '<button type="button" class="sp-btn sp-btn-primary sp-btn-big" data-act="quiz-open" data-piece="' +
      esc(p.id) +
      '">' +
      esc(p.quizWord || 'Start the Quiz') +
      '</button>'
    );
  }

  /* A returned quiz (Q5b; s/quiz.js sets `quizReturned` only once `quiz-result` has said it is back). The card and
     Your Feedback each offer the quiz's own returned view, the board's "When It Comes Back". */
  function seeQuizHtml(p) {
    if (!p || !p.quizReturned) return '';
    return (
      '<button type="button" class="sp-btn sp-btn-tint sp-btn-big" data-act="quiz-open" data-piece="' +
      esc(p.id) +
      '">See Your Quiz</button>'
    );
  }

  // A grey row with a lock: what the student can't change and why (the Closed and Being Graded boards).
  function lockRowHtml(text, cls) {
    return '<p class="sp-lock-row ' + cls + '">' + pillIcon('lock', 18) + '<span>' + esc(text) + '</span></p>';
  }

  // The student's own pages, small, as this device has them.
  function thumbsHtml(thumbs, label) {
    if (!thumbs || !thumbs.length) return '';
    return (
      '<div class="sp-send-thumbs">' +
      thumbs
        .map(function (url, i) {
          return '<img class="sp-send-thumb" src="' + esc(url) + '" alt="' + esc(label + ' ' + (i + 1)) + '">';
        })
        .join('') +
      '</div>'
    );
  }

  /* A piece sent as One per Group (S12-F1, the board "Student: Group
     Work"): when the group's work went in and how many photos, how many
     are in the group, whether the student sent any of it, and Add a Page
     while the piece still takes work and the student has sent none of
     their own (their own send, added to the group's). Counts only: the
     server sends no group-mate's name, so the board's name chips are not
     drawn. Before anyone has sent it, the usual Send My Work. */
  function groupBlockHtml(p) {
    var g = p.group;
    var size = g.members + ' in your group';
    if (!g.sent) {
      return (
        '<p class="sp-group-line">' +
        esc(size + '. One of you sends it for the whole group.') +
        '</p>' +
        sendBlockHtml(p)
      );
    }
    var open = p.send && p.send.takes && p.send.open && !(p.send.sent && p.send.sent.pages);
    return (
      '<div class="sp-group"><p class="sp-group-sent">' +
      esc([g.sentAt ? 'Sent ' + fmtDate(g.sentAt, DAY) : 'Sent', photosWord(g.pages)].filter(Boolean).join(SEP)) +
      '</p><p class="sp-group-line">' +
      esc(size + '. ' + (g.youSent ? 'You sent pages for your group.' : 'Someone in your group sent it.')) +
      '</p></div>' +
      (open
        ? '<button type="button" class="sp-btn sp-btn-tint sp-btn-big" data-act="send-open" data-piece="' +
          esc(p.id) +
          '">Add a Page</button>'
        : '')
    );
  }

  /* On a card sent and not back yet: the pages, and either who is grading
     it, or that it can still be changed with Replace Photos and Unsend. */
  function sentBlockHtml(p) {
    var sent = (p.send && p.send.sent) || {};
    var who = 'Your teacher';
    // Work the teacher added, open for the student's own pages too (ruling 107): theirs go first.
    var join = !!(sent.canSend && !sent.grading && p.send.takes && p.send.open);
    var line = sent.onPaper
      ? 'Handed in on paper'
      : sent.grading
        ? who + ' is grading this'
        : sent.canChange
          ? who + ' hasn’t started grading it. You can still change it.'
          : join
            ? 'Your photos go before the ' +
              (sent.pages === 1 ? 'page' : sent.pages + ' pages') +
              ' your teacher added.'
            : '';
    return (
      thumbsHtml(sent.thumbs, 'Your page') +
      (line
        ? sent.grading && !sent.onPaper
          ? lockRowHtml(line, 'sp-send-line')
          : '<p class="sp-send-line">' + esc(line) + '</p>'
        : '') +
      (join
        ? '<button type="button" class="sp-btn sp-btn-primary sp-btn-big" data-act="send-open" data-piece="' +
          esc(p.id) +
          '">Send My Work</button>'
        : '') +
      (sent.canChange && !sent.grading
        ? '<div class="sp-send-change"><button type="button" class="sp-btn sp-btn-tint" data-act="send-replace" data-piece="' +
          esc(p.id) +
          '">Replace Photos</button><button type="button" class="sp-btn sp-btn-quiet" data-act="send-unsend" data-piece="' +
          esc(p.id) +
          '">Unsend</button></div>'
        : '')
    );
  }

  /* ── Revisions (S11-F2; the artboard's "Student: Needs Revision",
     "Before and After a Revision" and "Before and After on a Chromebook")
     ── The page never names the teacher (Colin's ruling 112): the board's
     "Mr. Brown" is "Your Teacher". */

  /* What to Fix, the criteria to revise and the first version's pages,
     with Send My Revision while the piece takes work. On the card and on
     Your Feedback. */
  function reviseBlockHtml(p, where) {
    var r = p.revision;
    if (!r || p.kind !== 'revise') return '';
    var takes = p.send && p.send.takes;
    // The Needs Revision board: the teacher's words in a blue-tinted block, the first version under it, then the one button.
    return (
      '<section class="sp-revise sp-revise-' +
      where +
      '" aria-label="Needs Revision"><div class="sp-revise-said"><p class="sp-revise-who">Your Teacher</p><p class="sp-revise-fix">' +
      esc(r.whatToFix) +
      '</p>' +
      (r.criteria.length
        ? '<p class="sp-revise-crit"><span class="sp-revise-crit-title">Revise</span>' +
          r.criteria
            .map(function (name) {
              return '<span class="sp-revise-crit-name">' + esc(name) + '</span>';
            })
            .join('') +
          '</p>'
        : '') +
      '</div>' +
      (r.firstThumbs.length
        ? '<p class="sp-revise-first">Your First Version</p>' + thumbsHtml(r.firstThumbs, 'First version, page')
        : '') +
      (takes
        ? '<button type="button" class="sp-btn sp-btn-primary sp-btn-big sp-btn-icon" data-act="revise-open" data-piece="' +
          esc(p.id) +
          '">' +
          pillIcon('camera', 20) +
          'Send My Revision</button>'
        : '') +
      '</section>'
    );
  }

  // A returned revision's card opens Before and After.
  function hasCompare(p) {
    return !!(p && p.kind === 'back' && p.revision && p.revision.state === 'returned' && p.revision.before);
  }

  // One version's first page and when it was sent, on Before and After.
  function versionHtml(thumbs, label, sentAt) {
    return (
      '<figure class="sp-ba-version">' +
      (thumbs.length
        ? '<img class="sp-ba-photo" src="' + esc(thumbs[0]) + '" alt="' + esc(label + ', page 1') + '">'
        : '<span class="sp-ba-photo sp-ba-photo-none" aria-hidden="true"></span>') +
      '<figcaption><span class="sp-ba-label">' +
      esc(label) +
      '</span>' +
      (sentAt ? '<span class="sp-ba-sent">' + esc('Sent ' + fmtDate(sentAt, DAY)) + '</span>' : '') +
      '</figcaption></figure>'
    );
  }

  /* One line of Before and After: a level then and now, or "No change".
     Your Result (`result`) shows the old one as plain grey words and the
     new one bold in its level's colour (the board's "2.7 · 67% → 3.0 · 75%"). */
  function baRowHtml(name, before, beforeLevel, after, level, same, result) {
    var then = result
      ? '<span class="sp-ba-old">' + esc(before) + '</span>'
      : '<span class="sp-ba-was">' + chipHtml(before, beforeLevel) + '</span>';
    var now = result
      ? '<span class="sp-ba-new sp-ink-' + lvClass(level) + '">' + esc(after) + '</span>'
      : chipHtml(after, level);
    return (
      '<li class="sp-ba-row' +
      (result ? ' sp-ba-row-result' : '') +
      '"><span class="sp-ba-name">' +
      esc(name) +
      '</span><span class="sp-ba-move">' +
      (same ? '<span class="sp-ba-same">No change</span>' : before ? then + TO_ARROW : '') +
      now +
      '</span></li>'
    );
  }

  /* Before and After: the two versions, each row's level then and now,
     Your Result then and now, what the teacher asked and what the student
     did, then See Your Feedback and Reflect on Feedback. */
  function compareHtml(view, p) {
    var r = p.revision;
    var b = r.before;
    var sub = 'Revision returned ' + fmtDate(p.returnedAt, DAY);
    /* The Before and After boards: one card with both versions, each row's
       level then and now and Your Result; what was asked and what the
       student did in one card under it. On a Chromebook the versions sit
       on the left and the rest beside them (page-view.css). */
    var reflect = reflectButtonHtml(view, p, true);
    return (
      '<section class="sp-feedback sp-ba" aria-labelledby="sp-fb-title">' +
      feedbackHead(backWord(p, view), 'feedback-close', p.title, sub, p.unseen ? p.id : '', 'sp-fb-title') +
      '<div class="sp-ba-body"><div class="sp-ba-card">' +
      '<h2 class="sp-ba-title">Before and After</h2>' +
      '<div class="sp-ba-versions">' +
      versionHtml(r.firstThumbs, 'First Version', r.firstSentAt) +
      versionHtml(r.thumbs, 'Your Revision', r.sentAt) +
      '</div><div class="sp-ba-panel"><ul class="sp-ba-rows">' +
      b.rows
        .map(function (row) {
          return baRowHtml(row.name, row.before, row.beforeLevel, row.after, row.level, row.same);
        })
        .join('') +
      '</ul>' +
      (b.result.text && p.result.text
        ? '<ul class="sp-ba-rows sp-ba-result">' +
          baRowHtml('Your Result', b.result.text, b.result.level, p.result.text, p.result.level, false, true) +
          '</ul>'
        : '') +
      '</div></div>' +
      '<div class="sp-ba-saids"><div class="sp-ba-said"><h3 class="sp-ba-said-title">Your Teacher Asked</h3><p class="sp-ba-words">' +
      esc(r.whatToFix) +
      '</p></div>' +
      (r.note
        ? '<div class="sp-ba-said sp-ba-did"><h3 class="sp-ba-said-title">You Did</h3><p class="sp-ba-words">' +
          esc(r.note) +
          '</p></div>'
        : '') +
      '</div></div>' +
      // With Reflect on Feedback the board makes it the primary button and See Your Feedback the quieter one.
      '<div class="sp-ba-actions"><button type="button" class="sp-btn ' +
      (reflect ? 'sp-btn-tint' : 'sp-btn-primary') +
      ' sp-btn-big" data-act="feedback" data-piece="' +
      esc(p.id) +
      '">See Your Feedback</button>' +
      reflect +
      '</div></section>'
    );
  }

  // The teacher's comment on a returned card.
  /* A card's first line: its unit on the left and, on work still to do, when
     it is due on the right (the To Do Card board). Nothing when it has neither. */
  // The card's status band, then its unit in plain grey over the title.
  function headHtml(p, view) {
    return bandHtml(p, view) + (p.unit ? '<p class="sp-piece-head sp-piece-unit">' + esc(p.unit) + '</p>' : '');
  }

  /* ── For This Assignment (Handouts and Links; the board "What the
     Student Sees (Phone)") ──────────────────────────────────────
     Under the Description: the teacher's handout, which opens its pages
     here one at a time as See Your Work does, and each link, which opens
     in a new tab. A link is only ever an http(s) address (the view checks
     it, shared/student-view.js resourcesOf). */
  var RES_DOC =
    '<svg class="sp-res-icon sp-res-icon-doc" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 14h6M9 17h4"/></svg>';
  var RES_LINK =
    '<svg class="sp-res-icon sp-res-icon-link" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>';
  var RES_VIDEO =
    '<svg class="sp-res-icon sp-res-icon-video" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="2.5" y="5" width="19" height="14" rx="4"/><path d="m10 9 5 3-5 3z" fill="currentColor"/></svg>';
  var RES_GO =
    '<svg class="sp-res-go" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="m9 6 6 6-6 6"/></svg>';
  var VIDEO_HOSTS = /^(youtube\.com|m\.youtube\.com|youtu\.be|vimeo\.com)$/;
  // A handout file (2026111706): it opens over the page, in shared/handout-viewer.js.
  var RES_PAGE =
    '<svg class="sp-res-icon sp-res-icon-page" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 8.5h18"/><path d="m9.5 12.5-2 2 2 2M14.5 12.5l2 2-2 2"/></svg>';
  var RES_BOOK =
    '<svg class="sp-res-icon sp-res-icon-book" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5"/></svg>';
  var FILE_WORDS = { html: 'Web Page', txt: 'Text File', epub: 'Book' };

  function pagesWord(n) {
    return n === 1 ? '1 page' : n + ' pages';
  }

  function resourceRowHtml(p, r) {
    var words = function (line) {
      return (
        '<span class="sp-res-words"><span class="sp-res-name">' +
        esc(r.title) +
        '</span> <span class="sp-res-line">' +
        esc(line) +
        '</span></span>'
      );
    };
    if (r.kind === 'file' && FILE_WORDS[r.type]) {
      return (
        '<button type="button" class="sp-res-row" data-act="handout-file" data-piece="' +
        esc(p.id) +
        '" data-resource="' +
        esc(r.id) +
        '">' +
        (r.type === 'html' ? RES_PAGE : r.type === 'epub' ? RES_BOOK : RES_DOC) +
        words(FILE_WORDS[r.type]) +
        RES_GO +
        '</button>'
      );
    }
    if (r.kind === 'handout') {
      return (
        '<button type="button" class="sp-res-row" data-act="handout" data-piece="' +
        esc(p.id) +
        '" data-resource="' +
        esc(r.id) +
        '">' +
        RES_DOC +
        words('Handout' + SEP + pagesWord(r.pages)) +
        RES_GO +
        '</button>'
      );
    }
    return (
      '<a class="sp-res-row" href="' +
      esc(r.url) +
      '" target="_blank" rel="noopener noreferrer">' +
      (VIDEO_HOSTS.test(r.host) ? RES_VIDEO : RES_LINK) +
      words(r.host) +
      '<span class="sp-hidden-title"> (opens in a new tab)</span>' +
      RES_GO +
      '</a>'
    );
  }

  // The handouts and links, or (`linksOnly`: the handouts are in the card's carousel) the links alone.
  function resourcesHtml(p, linksOnly) {
    var list = (Array.isArray(p.resources) ? p.resources : []).filter(function (r) {
      return !linksOnly || (r && r.kind !== 'handout');
    });
    if (!list.length) return '';
    var id = domId(p.id) + '-res';
    return (
      '<section class="sp-res" aria-labelledby="' +
      id +
      '"><h3 class="sp-res-head" id="' +
      id +
      '">For This Assignment</h3>' +
      list
        .map(function (r) {
          return resourceRowHtml(p, r);
        })
        .join('') +
      '</section>'
    );
  }

  // The handout the page is open on: { piece, resource }, or null when it cannot be shown.
  function handoutOpen(view, ui) {
    if (!view || !ui.handout || !ui.handoutPiece) return null;
    var p = pieceIn(view.work, ui.handoutPiece);
    if (!p || p.id !== ui.handoutPiece) return null;
    var r = (p.resources || []).filter(function (x) {
      return x && x.kind === 'handout' && x.id === ui.handout;
    })[0];
    return r ? { piece: p, resource: r } : null;
  }

  // The handout's pages fetched, when they are in: [ { url } ], or null.
  function handoutPages(ui, r) {
    var got = ui.handoutPages && r && ui.handoutPages.id === r.id ? ui.handoutPages : null;
    if (!got || got.state !== 'ready') return null;
    // Pages come in one by one: one still on its way keeps its place, with no address yet.
    // An address this page would not show is left out.
    return (Array.isArray(got.pages) ? got.pages : [])
      .filter(function (pg) {
        return pg && typeof pg.url === 'string' && (pg.url === '' || PAGE_URL.test(pg.url));
      })
      .map(function (pg) {
        return { url: pg.url };
      });
  }

  /* A handout open in the page: the way back to the card, its name, which
     page this is, the page, and a way between the pages, as See Your Work
     shows the student's own. */
  function handoutPaneHtml(ui, open) {
    var r = open.resource;
    var got = ui.handoutPages && ui.handoutPages.id === r.id ? ui.handoutPages : null;
    var pages = handoutPages(ui, r) || [];
    var n = pages.length;
    var i = Math.max(0, Math.min(n - 1, Number(ui.handoutPage) || 0));
    var body;
    if (got && got.state === 'failed') {
      body =
        '<p class="sp-lead sp-msg" role="alert">The handout didn’t load. Check your internet and try again.</p>' +
        '<button type="button" class="sp-btn sp-btn-tint sp-work-retry" data-act="handout-retry" data-resource="' +
        esc(r.id) +
        '">Try Again</button>';
    } else if (!got || got.state !== 'ready') {
      body = '<p class="sp-lead sp-msg-calm" role="status">Getting the handout…</p>';
    } else if (!n) {
      body = '<p class="sp-lead sp-msg-calm">This handout can’t be shown here.</p>';
    } else {
      var dots = '';
      for (var k = 0; k < n; k++) dots += '<span class="sp-work-dot' + (k === i ? ' sp-work-dot-on' : '') + '"></span>';
      body =
        (pages[i].url
          ? '<figure class="sp-work-page sp-handout-page"><img class="sp-work-img" src="' +
            esc(pages[i].url) +
            '" alt="' +
            esc(r.title + ', page ' + (i + 1)) +
            '"></figure>'
          : '<figure class="sp-work-page sp-handout-page sp-handout-wait"><p class="sp-lead sp-msg-calm" role="status">Getting this page…</p></figure>') +
        (n > 1
          ? '<div class="sp-work-bar"><button type="button" class="sp-head-icon" data-act="handout-page" data-page="' +
            (i - 1) +
            '" aria-label="Previous Page"' +
            (i === 0 ? ' disabled' : '') +
            '>' +
            BACK_ARROW +
            '</button><span class="sp-work-dots" role="img" aria-label="' +
            esc('Page ' + (i + 1) + ' of ' + n) +
            '">' +
            dots +
            '</span><button type="button" class="sp-head-icon sp-work-next" data-act="handout-page" data-page="' +
            (i + 1) +
            '" aria-label="Next Page"' +
            (i === n - 1 ? ' disabled' : '') +
            '>' +
            BACK_ARROW +
            '</button></div>'
          : '');
    }
    return (
      '<section class="sp-feedback sp-work sp-handout" aria-labelledby="sp-handout-title">' +
      '<div class="sp-work-head"><button type="button" class="sp-head-icon" data-act="handout-close" aria-label="Back">' +
      BACK_ARROW +
      '</button><div class="sp-work-words"><h1 class="sp-work-title" id="sp-handout-title" tabindex="-1">' +
      esc(r.title) +
      '</h1><p class="sp-fb-sub">' +
      esc(n ? 'Page ' + (i + 1) + ' of ' + n : 'Handout' + SEP + pagesWord(r.pages)) +
      '</p></div></div>' +
      body +
      '</section>'
    );
  }

  /* Where a piece lives: Outstanding or Upcoming on Assignments, or My
     Learning for work sent, back or excused. { tab, segment }. */
  function homeOf(p, view) {
    var seg = segmentOf(p, view);
    return seg ? { tab: 'assignments', segment: seg } : { tab: 'learning', segment: '' };
  }
  // The pieces listed beside an open one on a Chromebook: its segment's, or My Learning's.
  function homeList(view, home) {
    return home.tab === 'assignments' ? inSegment(view, home.segment) : learningPieces(view);
  }
  // Over a piece opened from Assignments, the segments (hidden on a phone, page-view.css).
  function homeTop(ui, view, home) {
    return home.tab === 'assignments'
      ? '<div class="sp-fb-segments">' + segmentsHtml(Object.assign({}, ui, { segment: home.segment }), view) + '</div>'
      : '';
  }
  function backWord(p, view) {
    return homeOf(p, view).tab === 'learning' ? 'My Learning' : 'Assignments';
  }

  // A handout open in place of the cards, with the list on the left on a Chromebook.
  function handoutBody(ui, view, open) {
    var home = homeOf(open.piece, view);
    return (
      homeTop(ui, view, home) +
      '<div class="sp-split sp-split-feedback">' +
      sideHtml(homeList(view, home), open.piece, view) +
      handoutPaneHtml(ui, open) +
      '</div>'
    );
  }

  /* One card: its unit and when it is due, the title, where it stands,
     the teacher's instructions (the Description), the handouts and links,
     the student's plan from last time, See the Rubric, and Send My Work.
     The same card shows work sent, opened from My Learning. */
  function cardHtml(p, picked, view) {
    var todo = p.kind === 'due' || p.kind === 'missing';
    var tags = pills(p);
    // A card still to do shows its handout's pages to swipe through (s/page-carousel.js), above the Description.
    var car = todo && typeof StudentPageCarousel !== 'undefined' ? StudentPageCarousel.html(p) : '';
    return (
      '<article class="sp-piece sp-piece-' +
      kindOf(p) +
      (picked ? ' sp-picked' : '') +
      '" data-piece="' +
      esc(p.id) +
      '" aria-labelledby="' +
      domId(p.id) +
      '"><div class="sp-piece-card">' +
      headHtml(p, view) +
      '<h2 class="sp-piece-title" id="' +
      domId(p.id) +
      '" tabindex="-1">' +
      esc(p.title) +
      '</h2>' +
      (tags ? '<div class="sp-piece-tags">' + tags + '</div>' : '') +
      car +
      ((todo || p.kind === 'sent' || p.kind === 'revise') && p.description
        ? '<p class="sp-piece-about">' + esc(p.description) + '</p>'
        : '') +
      (todo || p.kind === 'revise' ? resourcesHtml(p, !!car) : '') +
      (p.kind === 'due' ? planHtml(p) : '') +
      (p.kind === 'sent' ? (p.group ? groupBlockHtml(p) : sentBlockHtml(p)) + seeWorkHtml(p) : '') +
      (todo ? rubricLinkHtml(p) + (p.group ? groupBlockHtml(p) : sendBlockHtml(p)) + quizBlockHtml(p) : '') +
      reviseBlockHtml(p, 'card') +
      (hasCompare(p)
        ? '<button type="button" class="sp-btn sp-btn-tint sp-btn-big" data-act="compare" data-piece="' +
          esc(p.id) +
          '">Before and After</button>'
        : '') +
      seeQuizHtml(p) +
      (hasFeedback(p)
        ? '<button type="button" class="sp-btn ' +
          // One primary button on a card: on Needs Revision it is Send My Revision.
          (p.kind === 'revise' && p.send && p.send.takes ? 'sp-btn-tint' : 'sp-btn-primary') +
          ' sp-btn-big" data-act="feedback" data-piece="' +
          esc(p.id) +
          '">See Your Feedback</button>'
        : '') +
      '</div></article>'
    );
  }

  // The piece with this id among these, or the first.
  function pieceIn(pieces, id) {
    for (var i = 0; i < pieces.length; i++) if (pieces[i].id === id) return pieces[i];
    return pieces[0] || null;
  }

  /* The cards of Outstanding or Upcoming. On a phone they sit one under
     another and the student scrolls down through them (Colin, 2026-11-14:
     "they're used to scroll"); on a Chromebook the list is on the left and
     the card picked on the right. page-view.css shows one or the other. */
  function deckHtml(ui, pieces, view) {
    var picked = pieceIn(pieces, ui.pick);
    return (
      '<div class="sp-split">' +
      sideHtml(pieces, picked, view) +
      '<div class="sp-deck">' +
      pieces
        .map(function (p) {
          return cardHtml(p, p === picked, view);
        })
        .join('') +
      '</div></div>'
    );
  }

  // A side row's press: a card on Assignments; on My Learning, the feedback, the pages, or the card of work sent.
  function sideAct(p, view) {
    if (segmentOf(p, view)) return 'pick';
    return learningAct(p) || 'open-piece';
  }

  /* What a piece's row on My Learning opens (DECISIONS, "See Your Work from
     My Learning (2026-11-18)"): work sent and waiting, or Missing, its card;
     a piece with feedback, Your Feedback (which offers See Your Work when
     there are pages); a piece with pages and no feedback, See Your Work;
     anything else, nothing. */
  function learningAct(p) {
    if (p.kind === 'sent' || p.kind === 'missing') return 'open-piece';
    if (hasFeedback(p)) return 'feedback';
    if (canSeeWork(p)) return 'work';
    return '';
  }

  // The Chromebook's list on the left, the piece picked marked.
  function sideHtml(pieces, picked, view) {
    return (
      '<ul class="sp-side">' +
      pieces
        .map(function (p) {
          var v = rowView(p);
          var on = p === picked;
          return (
            '<li><button type="button" class="sp-side-row' +
            (on ? ' sp-side-on' : '') +
            '" data-act="' +
            sideAct(p, view) +
            '" data-piece="' +
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
      '</ul>'
    );
  }

  /* ── Your Feedback (the artboard's "Your Feedback" boards, one per way of
     scoring, and "Your Feedback on a Chromebook") ───────────── */

  // What the Levels Mean: the board's line for each level, Emerging to Extending.
  var LEVEL_LINES = ['Just starting', 'Partly there', 'You met the goal', 'You went beyond the goal'];
  var PLUS_MINUS = 'A + means a little past that level. A − means not quite all the way there.';

  var GO_ARROW =
    '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M9 6l6 6-6 6"/></svg>';
  var TO_ARROW =
    '<svg class="sp-fb-to-mark" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
  var TICKED =
    '<svg class="sp-fb-box" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M7.5 12.3l3 3 6-6.3" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var NOT_YET =
    '<svg class="sp-fb-box sp-fb-box-open" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="3 3"/></svg>';
  var OPEN_CHEVRON =
    '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M6 9l6 6 6-6"/></svg>';
  var CLOSE_CHEVRON =
    '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M6 15l6-6 6 6"/></svg>';

  // A level number, 1 to 4, for a class name; 0 for anything else.
  function lvClass(level) {
    var lv = Math.round(Number(level));
    return lv >= 1 && lv <= 4 ? lv : 0;
  }

  // The piece Your Feedback or The Whole Rubric is open on, or null when it cannot be shown.
  function feedbackPiece(view, ui) {
    if (!view || !ui.feedback) return null;
    var p = pieceIn(view.work, ui.feedback);
    if (!p || p.id !== ui.feedback) return null;
    if (ui.whole) return p.rubric && p.kind !== 'excused' ? p : null;
    if (ui.compare) return hasCompare(p) ? p : null;
    return hasFeedback(p) ? p : null;
  }

  /* Your Result: the level's word, large, with the result beside it, then a
     row per criterion or competency; or points with their percent and a
     bar; or Complete. Every word and figure is the view's (calc.js's). */
  function yourResultHtml(p) {
    var r = p.result;
    if (r.kind === 'points') {
      return (
        '<section class="sp-fb-card sp-fb-points" aria-label="Your Result"><span class="sp-fb-score">' +
        esc(r.points) +
        '<span class="sp-fb-outof">' +
        esc(' / ' + r.outOf) +
        '</span></span><span class="sp-fb-meter"><span class="sp-fb-pct sp-lvt-' +
        lvClass(r.level) +
        '">' +
        esc(r.percent) +
        '</span><span class="sp-fb-bar"><span class="sp-fb-fill sp-lvf-' +
        lvClass(r.level) +
        '" style="width:' +
        Math.max(0, Math.min(100, Number(r.bar) || 0)) +
        '%"></span></span></span>' +
        '</section>'
      );
    }
    var big = r.word || r.text;
    var beside = r.word ? r.text : '';
    // A rubric's rows are under Your Rubric; competencies marked without one are listed here.
    var rows = (p.rubric ? [] : p.competencies || []).filter(function (row) {
      return row.text;
    });
    return (
      '<section class="sp-fb-card" aria-labelledby="sp-fb-result"><span class="sp-fb-label" id="sp-fb-result">Your Result</span>' +
      '<span class="sp-fb-result"><span class="sp-fb-big sp-lvt-' +
      lvClass(r.level) +
      '">' +
      esc(big) +
      '</span>' +
      (beside ? '<span class="sp-fb-beside">' + esc(beside) + '</span>' : '') +
      '</span>' +
      (rows.length
        ? '<ul class="sp-fb-rows">' +
          rows
            .map(function (row) {
              return (
                '<li class="sp-fb-row"><span class="sp-fb-row-name">' +
                esc(row.name) +
                '</span>' +
                (row.was
                  ? '<span class="sp-was-wrap">' +
                    chipHtml(row.text, row.level) +
                    '<span class="sp-was">' +
                    esc('Was ' + row.was) +
                    '</span></span>'
                  : chipHtml(row.text, row.level)) +
                '</li>'
              );
            })
            .join('') +
          '</ul>'
        : '') +
      '</section>'
    );
  }

  // Does this piece name levels by their words (a rubric, or competencies)?
  function namesLevels(p) {
    if (p.result.kind !== 'level') return false;
    return (p.rubric ? p.rubric.rows : p.competencies || []).some(function (row) {
      return !!row.text;
    });
  }

  /* What the Levels Mean: closed until the student opens it (ui.levels set
     means open), at the foot of Your Feedback. On a Chromebook it is always
     open, the four chips in a row (page-view.css). */
  function levelsHtml(view, ui) {
    var levels = view.levels || [];
    if (!levels.length) return '';
    var open = !!ui.levels;
    return (
      '<section class="sp-fb-card sp-fb-levels' +
      (open ? '' : ' sp-fb-levels-shut') +
      '"><button type="button" class="sp-fb-levels-btn" data-act="levels" aria-expanded="' +
      (open ? 'true' : 'false') +
      '" aria-controls="sp-fb-levels-list"><span>What the Levels Mean</span>' +
      (open ? CLOSE_CHEVRON : OPEN_CHEVRON) +
      '</button>' +
      '<div id="sp-fb-levels-list" class="sp-fb-levels-list"><ul class="sp-fb-legend">' +
      levels
        .map(function (l) {
          return (
            '<li class="sp-fb-legend-row"><span class="sp-fb-legend-chip">' +
            chipHtml(l.name, l.level) +
            '</span><span>' +
            esc(LEVEL_LINES[l.level - 1] || '') +
            '</span></li>'
          );
        })
        .join('') +
      '</ul><p class="sp-fb-fine">' +
      esc(PLUS_MINUS) +
      '</p></div>' +
      '</section>'
    );
  }

  // A part of a criterion's card: a heading and its words, in one of the board's tints.
  function partHtml(tint, title, body, mark) {
    return (
      '<div class="sp-fb-part sp-fb-' +
      tint +
      '">' +
      (mark || '') +
      '<div class="sp-fb-part-text"><span class="sp-fb-part-title">' +
      esc(title) +
      '</span>' +
      body +
      '</div></div>'
    );
  }

  function wordsHtml(text) {
    return '<span class="sp-fb-words">' + esc(text) + '</span>';
  }

  /* One criterion under Your Rubric: its name, the level given, and the
     teacher's comment on it; on a Single-Point Rubric the teacher's two
     notes, Went Beyond and Work On. What each level means is on The Whole
     Rubric, not here (Colin, 2026-11-14: the rubric scores and the
     teacher's comments, cleanly). */
  function criterionHtml(style, row) {
    var notes = '';
    if (style === 'single_point') {
      if (row.beyond) notes += partHtml('blue', 'Went Beyond', wordsHtml(row.beyond));
      if (row.comment) notes += partHtml('amber', 'Work On', wordsHtml(row.comment));
    } else if (row.comment) {
      notes += '<p class="sp-fb-note">' + esc(row.comment) + '</p>';
    }
    return (
      '<li class="sp-fb-criterion"><div class="sp-fb-crit-head"><h3 class="sp-fb-crit-name">' +
      esc(row.name) +
      '</h3>' +
      (row.text ? chipHtml(row.text, row.level) : '') +
      '</div>' +
      notes +
      '</li>'
    );
  }

  // When a piece came back, or when its revision is due: "Returned Nov 3".
  function feedbackSub(view, p) {
    if (p.kind === 'revise' && p.revision) {
      return p.revision.reviseBy ? 'Revise by ' + fmtDate(p.revision.reviseBy, DUE_DAY) : 'Needs Revision';
    }
    if (p.updated) return 'Updated ' + fmtDate(p.updatedAt || p.returnedAt, DAY);
    return p.returnedAt ? 'Returned ' + fmtDate(p.returnedAt, DAY) : '';
  }

  /* The top of Your Feedback and The Whole Rubric: the way back (on a
     phone; a Chromebook keeps its list on the left), the title and the line
     under it. A piece not opened since it came back carries its id as
     data-unseen on the title, which stays small enough to be wholly on
     screen. */
  function feedbackHead(back, act, title, sub, unseen, id) {
    return (
      '<button type="button" class="sp-fb-back" data-act="' +
      act +
      '">' +
      BACK_ARROW +
      '<span>' +
      esc(back) +
      '</span></button>' +
      '<div class="sp-fb-head"' +
      (unseen ? ' data-unseen="' + esc(unseen) + '"' : '') +
      '><h1 class="sp-fb-title" id="' +
      id +
      '" tabindex="-1">' +
      esc(title) +
      '</h1>' +
      (sub ? '<p class="sp-fb-sub">' + esc(sub) + '</p>' : '') +
      '</div>'
    );
  }

  // The Overall Comment on Your Feedback.
  function fbCommentHtml(p) {
    if (!p.comment) return '';
    return '<p class="sp-fb-comment">' + esc(p.comment) + '</p>';
  }

  /* The top of a returned quiz (s/quiz.js, teacher/preview-student.js): Your Result and the teacher's comment, as
     Your Feedback draws them, so the quiz's own view says the grade in the class's words and cannot differ from it. */
  function quizTopHtml(p) {
    if (!p || !p.result || p.result.kind === 'none') return '';
    // Inside `sp-view` and `sp-feedback`, where the page's stylesheet draws a result (the quiz's screen is not under either).
    return (
      '<div class="sp-view sp-quiz-topview"><section class="sp-feedback"><div class="sp-fb-top' +
      (p.comment ? ' sp-fb-top-two' : '') +
      '">' +
      yourResultHtml(p) +
      fbCommentHtml(p) +
      '</div></section></div>'
    );
  }

  function feedbackHtml(view, ui, p) {
    var rubric = p.rubric;
    var style = rubric ? rubric.style : '';
    var withLevels = namesLevels(p);
    var crits = rubric
      ? rubric.rows
          .filter(function (row) {
            return row.text || row.comment || row.beyond;
          })
          .map(function (row) {
            return criterionHtml(style, row);
          })
          .join('')
      : '';
    return (
      '<section class="sp-feedback" aria-labelledby="sp-fb-title">' +
      feedbackHead(
        backWord(p, view),
        'feedback-close',
        p.title,
        feedbackSub(view, p),
        p.unseen ? p.id : '',
        'sp-fb-title',
      ) +
      reviseBlockHtml(p, 'fb') +
      seeWorkHtml(p) +
      seeQuizHtml(p) +
      '<div class="sp-fb-top' +
      (p.comment ? ' sp-fb-top-two' : '') +
      '">' +
      yourResultHtml(p) +
      fbCommentHtml(p) +
      '</div>' +
      // A returned revision (S11-F2): its first version beside it.
      (hasCompare(p)
        ? '<button type="button" class="sp-btn sp-btn-tint sp-btn-big" data-act="compare" data-piece="' +
          esc(p.id) +
          '">Before and After</button>'
        : '') +
      (crits
        ? '<h2 class="sp-fb-section">Your Rubric</h2>' +
          '<ul class="sp-fb-crits">' +
          crits +
          '</ul>' +
          (style !== 'single_point'
            ? '<button type="button" class="sp-btn sp-btn-tint sp-btn-big" data-act="whole" data-piece="' +
              esc(p.id) +
              '">See the Whole Rubric</button>'
            : '')
        : '') +
      reflectButtonHtml(view, p) +
      (withLevels ? levelsHtml(view, ui) : '') +
      '</section>'
    );
  }

  /* Reflect on Feedback (S10-F1), under Your Feedback and See Your Work:
     only on returned work, and only while the class's switch is on. Once
     the student has reflected, the same place opens what they sent, and
     the teacher's answer when it has come ("Your Teacher Answered"). The
     screens themselves are the student page's (s/reflect.js); in Preview
     as Student the button is shown and opens nothing. */
  function reflectButtonHtml(view, p, primary) {
    if (!view || !view.reflectOn || !hasFeedback(p) || p.kind !== 'back') return '';
    var r = p.reflection;
    var open =
      '<button type="button" class="sp-btn ' +
      (primary ? 'sp-btn-primary' : 'sp-btn-tint') +
      ' sp-btn-big sp-fb-reflect" data-act="reflect-open" data-piece="' +
      esc(p.id) +
      '">';
    if (!r) return open + 'Reflect on Feedback</button>';
    var answered = !!(r.answer || r.followUpAnswer);
    return open + esc(answered ? 'Your Teacher Answered' : 'Your Reflection') + '</button>';
  }

  /* Your Plan From Last Time (S10-F2), on the next piece to do: the
     student's own words, from their reflection on an earlier piece. */
  function planHtml(p) {
    if (!p.plan || !p.plan.text) return '';
    return (
      '<section class="sp-plan" aria-labelledby="' +
      domId(p.id) +
      '-plan"><h3 class="sp-plan-title" id="' +
      domId(p.id) +
      '-plan">' +
      pillIcon('next', 14) +
      'Your Plan From Last Time</h3><p class="sp-plan-words">' +
      esc(p.plan.text) +
      '</p>' +
      (p.plan.fromTitle
        ? '<p class="sp-plan-from">' + esc('From your reflection on ' + p.plan.fromTitle) + '</p>'
        : '') +
      '</section>'
    );
  }

  // An Advanced Rubric's boxes at one level on The Whole Rubric, the ones ticked marked.
  function wholeChecksHtml(checks) {
    return checks
      .map(function (k) {
        return (
          '<span class="sp-fb-check">' + (k.ticked ? TICKED : NOT_YET) + '<span>' + esc(k.label) + '</span></span>'
        );
      })
      .join('');
  }

  /* The Whole Rubric: every criterion with each of its levels, the level
     given marked "You". A Single-Point Rubric has only its goal. */
  function wholeHtml(view, p) {
    var style = p.rubric.style;
    var cards = p.rubric.rows
      .map(function (row) {
        var levels = row.whole.filter(function (l) {
          if (style === 'single_point') return l.level === 3;
          return l.you || l.descriptor || l.checks.length;
        });
        return (
          '<section class="sp-fb-card sp-fb-whole"><h2 class="sp-fb-crit-name">' +
          esc(row.name) +
          '</h2><ul class="sp-fb-whole-levels">' +
          levels
            .map(function (l) {
              var you = l.you && row.text;
              return (
                '<li class="sp-fb-whole-level' +
                (you ? ' sp-fb-you sp-lv-' + lvClass(l.level) : '') +
                '"><span class="sp-fb-whole-name">' +
                esc(you ? row.text : style === 'single_point' ? 'The Goal' : l.name) +
                (you ? '<span class="sp-fb-you-tag">You</span>' : '') +
                '</span><span class="sp-fb-whole-words">' +
                (l.descriptor ? wordsHtml(l.descriptor) : '') +
                (style === 'advanced' ? wholeChecksHtml(l.checks) : '') +
                '</span></li>'
              );
            })
            .join('') +
          '</ul></section>'
        );
      })
      .join('');
    var back = hasFeedback(p) ? 'Your Feedback' : 'Assignments';
    return (
      '<section class="sp-feedback sp-whole" aria-labelledby="sp-fb-title">' +
      feedbackHead(back, 'whole-close', 'The Whole Rubric', p.title, '', 'sp-fb-title') +
      cards +
      '</section>'
    );
  }

  /* ── See Your Work, with Show Marks (S9-F3) ────────────────────
     The artboard's "Student: Returned Photo With Marks" and the See Your
     Work row on Your Feedback ("2 pages · 3 notes on your work"). Since
     Nov 18 (DECISIONS, "See Your Work from My Learning (2026-11-18)") every
     piece with pages handed in has it, sent by the student or added by the
     teacher (the view's piece.pages), marks or not: Your Feedback offers
     it, a row on My Learning with pages and no feedback opens it, and so
     does the card of work sent. Marks are drawn only where the `feedback`
     reply says the student was given some (piece.marks). The pages themselves are fetched by
     whoever draws the page (s/feedback.js on the student's device, the
     preview from the teacher's cache) and handed in as ui.workPages:
     { id, state: 'loading' | 'ready' | 'failed', pages: [ { url, marks } ] },
     the marks being the copy the student was given, never the teacher's
     working copy. A mark is drawn over the photo, never into it: the
     photo is shown as it was sent. */

  // "2 pages · 3 notes on your work" (the board's); with no note, "1 page with marks" (mine).
  function marksLine(m) {
    if (!m) return '';
    var pages = m.pages === 1 ? '1 page' : m.pages + ' pages';
    if (!m.notes) return pages + ' with marks';
    return pages + SEP + (m.notes === 1 ? '1 note' : m.notes + ' notes') + ' on your work';
  }

  // "1 page", "2 pages": what is there when no marks were given.
  function pagesLine(n) {
    return n === 1 ? '1 page' : n + ' pages';
  }

  // Can See Your Work open on piece `p`: pages handed in, or marks given on them.
  function canSeeWork(p) {
    return !!(p && (p.marks || p.pages > 0));
  }

  function seeWorkHtml(p) {
    if (!canSeeWork(p)) return '';
    return (
      '<button type="button" class="sp-fb-card sp-fb-work" data-act="work" data-piece="' +
      esc(p.id) +
      '"><span class="sp-fb-work-words"><span class="sp-fb-work-title">See Your Work</span><span class="sp-fb-work-line">' +
      esc(p.marks ? marksLine(p.marks) : pagesLine(p.pages)) +
      '</span></span>' +
      NEXT_ARROW +
      '</button>'
    );
  }

  function workOpen(ui, p) {
    return !!(ui.work && p && ui.work === p.id && canSeeWork(p));
  }

  /* See Your Work open with nothing under it but the list: opened from a
     row on My Learning (a piece with pages and no feedback) or from the
     card of work sent. With Your Feedback under it, feedbackBody draws it. */
  function workPiece(view, ui) {
    if (!view || !ui.work || feedbackPiece(view, ui)) return null;
    var p = pieceIn(view.work, ui.work);
    return p && p.id === ui.work && canSeeWork(p) ? p : null;
  }

  // Only a picture this page made or ships: a blob: address, or a drawn sample page.
  var PAGE_URL = /^(blob:|(\.\.)?\/assets\/sample-(work|handouts)\/)[^"'<>\s]*$/;

  // The pages fetched for piece `p`, when they are in: [ { url, marks } ], or null.
  function readyPages(ui, p) {
    var got = ui.workPages && p && ui.workPages.id === p.id ? ui.workPages : null;
    if (!got || got.state !== 'ready') return null;
    return (Array.isArray(got.pages) ? got.pages : []).filter(function (pg) {
      return pg && typeof pg.url === 'string' && PAGE_URL.test(pg.url);
    });
  }

  var INKS = { red: 'red', green: 'green', blue: 'blue' };
  var MARK_TYPES = { pen: 1, highlight: 1, note: 1, tick: 1, cross: 1 };

  // A place on the page, 0 to 1 from its top left, as a percent; null when it is not one.
  function placeOf(v) {
    return typeof v === 'number' && isFinite(v) && v >= 0 && v <= 1 ? Math.round(v * 10000) / 100 : null;
  }
  function inkOf(m, fallback) {
    return 'sp-ink-' + (INKS[m.color] || fallback);
  }
  function placed(x, y) {
    return ' style="left:' + x + '%;top:' + y + '%"';
  }

  /* One page's marks, drawn over the photo: lines and highlights in one
     drawing the size of the page; ticks, crosses and numbered notes placed
     on it. The notes' words are listed under the page, by number. Anything
     that is not a mark of the contract's five kinds, or has no place on
     the page, is left out. */
  function marksHtml(marks) {
    var all = marks && typeof marks === 'object' && Array.isArray(marks.marks) ? marks.marks.slice(0, 500) : [];
    var lines = '';
    var over = '';
    var notes = [];
    all.forEach(function (m) {
      if (!m || typeof m !== 'object' || !MARK_TYPES[m.type]) return;
      if (m.type === 'pen' || m.type === 'highlight') {
        var pts = (Array.isArray(m.points) ? m.points : [])
          .map(function (pt) {
            var x = Array.isArray(pt) ? placeOf(pt[0]) : null;
            var y = Array.isArray(pt) ? placeOf(pt[1]) : null;
            return x == null || y == null ? null : x + ',' + y;
          })
          .filter(Boolean);
        if (pts.length < 2) return;
        lines +=
          '<polyline class="sp-work-' +
          m.type +
          ' ' +
          inkOf(m, m.type === 'highlight' ? 'blue' : 'red') +
          '" points="' +
          pts.join(' ') +
          '" vector-effect="non-scaling-stroke"/>';
        return;
      }
      var x = placeOf(m.x);
      var y = placeOf(m.y);
      if (x == null || y == null) return;
      if (m.type === 'note') {
        var words = typeof m.text === 'string' ? m.text.trim().slice(0, 500) : '';
        if (!words) return;
        notes.push(words);
        over += '<span class="sp-work-pin"' + placed(x, y) + '>' + notes.length + '</span>';
        return;
      }
      over +=
        '<span class="sp-work-mark ' +
        inkOf(m, m.type === 'tick' ? 'green' : 'red') +
        '"' +
        placed(x, y) +
        '>' +
        (m.type === 'tick' ? '✓' : '✗') +
        '</span>';
    });
    return {
      over:
        (lines
          ? '<svg class="sp-work-ink" viewBox="0 0 100 100" preserveAspectRatio="none" focusable="false">' +
            lines +
            '</svg>'
          : '') + over,
      notes: notes,
    };
  }

  function workPageHtml(view, ui, pages, p) {
    var n = pages.length;
    var i = Math.max(0, Math.min(n - 1, Number(ui.workPage) || 0));
    var page = pages[i];
    // Show Marks is there only on a piece the student was given marks on.
    var marked = !!(p && p.marks);
    var showing = marked && !ui.marksOff;
    var drawn = showing ? marksHtml(page.marks) : { over: '', notes: [] };
    var alt = 'Your page ' + (i + 1) + (showing && drawn.over ? ' with your teacher’s marks' : '');
    var dots = '';
    for (var k = 0; k < n; k++) dots += '<span class="sp-work-dot' + (k === i ? ' sp-work-dot-on' : '') + '"></span>';
    return (
      '<figure class="sp-work-page"><img class="sp-work-img" src="' +
      esc(page.url) +
      '" alt="' +
      esc(alt) +
      '"><div class="sp-work-over" aria-hidden="true">' +
      drawn.over +
      '</div></figure>' +
      (drawn.notes.length
        ? '<ol class="sp-work-notes" aria-label="Notes on This Page">' +
          drawn.notes
            .map(function (t, k) {
              return (
                '<li><span class="sp-work-pin sp-work-pin-in" aria-hidden="true">' +
                (k + 1) +
                '</span><span>' +
                esc(t) +
                '</span></li>'
              );
            })
            .join('') +
          '</ol>'
        : '') +
      // The way between the pages and Show Marks; one page with no marks needs neither.
      (n > 1 || marked
        ? '<div class="sp-work-bar">' +
          (n > 1
            ? '<button type="button" class="sp-head-icon" data-act="work-page" data-page="' +
              (i - 1) +
              '" aria-label="Previous Page"' +
              (i === 0 ? ' disabled' : '') +
              '>' +
              BACK_ARROW +
              '</button><span class="sp-work-dots" role="img" aria-label="' +
              esc('Page ' + (i + 1) + ' of ' + n) +
              '">' +
              dots +
              '</span><button type="button" class="sp-head-icon sp-work-next" data-act="work-page" data-page="' +
              (i + 1) +
              '" aria-label="Next Page"' +
              (i === n - 1 ? ' disabled' : '') +
              '>' +
              BACK_ARROW +
              '</button>'
            : '') +
          (marked
            ? '<button type="button" class="sp-work-switch" role="switch" data-act="work-marks" aria-checked="' +
              (showing ? 'true' : 'false') +
              '"><span class="sp-work-track" aria-hidden="true"><span class="sp-work-knob"></span></span><span>Show Marks</span></button>'
            : '') +
          '</div>'
        : '')
    );
  }

  /* See Your Work: the way back (to Your Feedback, the card of work sent,
     or My Learning, whichever it was opened from), the piece's title, which
     page this is, the page with the marks the student was given over it,
     Show Marks when there are marks, and a way between the pages. */
  function seeWorkPaneHtml(view, ui, p) {
    var got = ui.workPages && ui.workPages.id === p.id ? ui.workPages : null;
    var pages = readyPages(ui, p) || [];
    var i = Math.max(0, Math.min(pages.length - 1, Number(ui.workPage) || 0));
    var body;
    if (got && got.state === 'failed') {
      body =
        '<p class="sp-lead sp-msg" role="alert">Your work didn’t load. Check your internet and try again.</p>' +
        '<button type="button" class="sp-btn sp-btn-tint sp-work-retry" data-act="work-retry" data-piece="' +
        esc(p.id) +
        '">Try Again</button>';
    } else if (!got || got.state !== 'ready') {
      body = '<p class="sp-lead sp-msg-calm" role="status">Getting your work…</p>';
    } else if (!pages.length) {
      body = '<p class="sp-lead sp-msg-calm">Your pages can’t be shown here.</p>';
    } else {
      body = workPageHtml(view, ui, pages, p);
    }
    return (
      '<section class="sp-feedback sp-work" aria-labelledby="sp-work-title">' +
      '<div class="sp-work-head"><button type="button" class="sp-head-icon" data-act="work-close" aria-label="Back">' +
      BACK_ARROW +
      '</button><div class="sp-work-words"><h1 class="sp-work-title" id="sp-work-title" tabindex="-1">' +
      esc(p.title) +
      '</h1>' +
      (pages.length ? '<p class="sp-fb-sub">' + esc('Page ' + (i + 1) + ' of ' + pages.length) + '</p>' : '') +
      '</div></div>' +
      body +
      reflectButtonHtml(view, p) +
      '</section>'
    );
  }

  /* Your Feedback, The Whole Rubric, Before and After or See Your Work, in
     place of the list it was opened from. On a Chromebook that list stays
     on the left; on a phone the screen is the piece alone. */
  function feedbackBody(ui, view, p) {
    var home = homeOf(p, view);
    return (
      homeTop(ui, view, home) +
      noResultsHtml(ui, view) +
      '<div class="sp-split sp-split-feedback">' +
      sideHtml(homeList(view, home), p, view) +
      (ui.whole
        ? wholeHtml(view, p)
        : ui.compare
          ? compareHtml(view, p)
          : workOpen(ui, p)
            ? seeWorkPaneHtml(view, ui, p)
            : feedbackHtml(view, ui, p)) +
      '</div>'
    );
  }

  // See Your Work opened from My Learning, in place of the list; on a Chromebook the list stays on the left.
  function workBody(ui, view, p) {
    var home = homeOf(p, view);
    return (
      homeTop(ui, view, home) +
      '<div class="sp-split sp-split-feedback">' +
      sideHtml(homeList(view, home), p, view) +
      seeWorkPaneHtml(view, ui, p) +
      '</div>'
    );
  }

  function assignmentsBody(ui, view) {
    var seg = segmentIn(ui);
    var pieces = inSegment(view, seg);
    return (
      // The tab's name, for the keyboard and a screen reader; the segments say the rest.
      '<h1 class="sp-page-title sp-hidden-title" tabindex="-1">Assignments</h1>' +
      segmentsHtml(ui, view) +
      (pieces.length ? deckHtml(ui, pieces, view) : seg === 'outstanding' ? caughtUpHtml(view) : NOTHING_UPCOMING)
    );
  }

  var BACK_ARROW =
    '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M15 5l-7 7 7 7"/></svg>';
  var NEXT_ARROW =
    '<svg class="sp-row-go" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M9 6l6 6-6 6"/></svg>';

  /* The tabs besides Assignments. Reflect (the student's questionnaires:
     Core Competency self-reflections, the teacher's own and the rest; each
     one is a reflection. Colin, 2026-11-16: "Reflect 'Questionnaires' into
     Reflect altogether") lists what the view holds; with nothing there it
     says so plainly. */
  var TAB_BODIES = {
    // Bulletins (docs/plans/bulletins-plan.md B1d): drawn by s/bulletins-view.js, only when the view has them.
    bulletins: { title: 'Bulletins', line: '' },
    learning: { title: 'My Learning', line: '' },
    questionnaires: { title: 'Reflect', line: 'Reflections from your teacher will show here.' },
  };

  /* ── Reflections (the artboard's "Questionnaires Tab" and "Questions on
     a Chromebook"). On a phone: Open Now as cards with Start, then Done
     and Coming Up as lists. On a Chromebook: the list on the left, the one
     picked on the right. Start is the student page's own press
     (s/app.js); in the preview nothing answers it. ───────── */

  var DONE_MARK =
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  var SOON_MARK =
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></svg>';

  // When a questionnaire is open, was sent, or opens.
  function formWhen(q) {
    if (q.state === 'sent') return q.sentOn ? 'Sent ' + fmtDate(q.sentOn, DAY) : 'Sent';
    if (q.state === 'soon') return q.opensOn ? 'Opens ' + fmtDate(q.opensOn, DAY) : '';
    return q.until ? 'Open until ' + fmtDate(q.until, DAY) : '';
  }
  function aboutMinutes(q) {
    return q.minutes > 0 ? 'about ' + q.minutes + ' minutes' : '';
  }

  // The Chromebook's list for either tab: a dot, the title and its line; the one picked marked.
  function formSide(items, picked, line, dot) {
    return (
      '<ul class="sp-side">' +
      items
        .map(function (x) {
          var on = x === picked;
          return (
            '<li><button type="button" class="sp-side-row' +
            (on ? ' sp-side-on' : '') +
            '" data-act="form-pick" data-form-id="' +
            esc(x.id) +
            '" aria-pressed="' +
            (on ? 'true' : 'false') +
            '"><span class="sp-dot sp-dot-' +
            dot(x) +
            '" aria-hidden="true"></span><span class="sp-row-text"><span class="sp-side-title">' +
            esc(x.title) +
            '</span><span class="sp-row-sub">' +
            esc(line(x)) +
            '</span></span></button></li>'
          );
        })
        .join('') +
      '</ul>'
    );
  }

  function startButton(q) {
    return q.state === 'open'
      ? '<button type="button" class="sp-btn sp-btn-primary sp-btn-big" data-act="q-start" data-form-id="' +
          esc(q.id) +
          '">Start</button>'
      : '';
  }

  // One questionnaire as a card: when, its title, what it asks and how long, Start.
  function formCard(view, q, desk) {
    var sub = desk
      ? [view.course && view.course.name, aboutMinutes(q)].filter(Boolean).join(SEP)
      : [q.line, aboutMinutes(q)].filter(Boolean).join(SEP);
    var when = formWhen(q);
    return (
      '<section class="sp-form-card">' +
      (when
        ? '<span class="sp-flag sp-flag-' + (q.state === 'sent' ? 'back' : 'due') + '">' + esc(when) + '</span>'
        : '') +
      '<h2 class="sp-form-title" tabindex="-1">' +
      esc(q.title) +
      '</h2>' +
      (sub ? '<p class="sp-form-sub">' + esc(sub) + '</p>' : '') +
      (desk && q.line ? '<p class="sp-form-line">' + esc(q.line) + '</p>' : '') +
      startButton(q) +
      '</section>'
    );
  }

  // A row of the phone's list: a mark, the title and its line; a button when it opens something.
  function formRow(x, line, mark, act) {
    var inner =
      (mark ? '<span class="sp-form-mark sp-form-mark-' + mark[0] + '">' + mark[1] + '</span>' : '') +
      '<span class="sp-row-text"><span class="sp-row-title">' +
      esc(x.title) +
      '</span><span class="sp-row-sub">' +
      esc(line) +
      '</span></span>';
    return (
      '<li class="sp-row">' +
      (act
        ? '<button type="button" class="sp-row-open" data-act="' +
          act +
          '" data-form-id="' +
          esc(x.id) +
          '">' +
          inner +
          NEXT_ARROW +
          '</button>'
        : '<span class="sp-row-open">' + inner + '</span>') +
      '</li>'
    );
  }

  // A heading over one part of the phone's list: Open Now, Done, Coming Up.
  function formsPartHtml(title, html) {
    return html ? '<h2 class="sp-list-head">' + esc(title) + '</h2>' + html : '';
  }

  function questionnairesBody(view, ui) {
    var items = view.questionnaires;
    var of = function (state) {
      return items.filter(function (q) {
        return q.state === state;
      });
    };
    var open = of('open');
    var done = of('sent');
    var soon = of('soon');
    var rows = function (list, mark) {
      return list.length
        ? '<ul class="sp-list">' +
            list
              .map(function (q) {
                return formRow(q, formWhen(q), mark, '');
              })
              .join('') +
            '</ul>'
        : '';
    };
    var picked = pieceIn(items, ui.form);
    return (
      '<h1 class="sp-page-title" tabindex="-1">Reflect</h1>' +
      '<div class="sp-split sp-forms">' +
      formSide(items, picked, formWhen, function (q) {
        return q.state === 'open' ? 'missing' : q.state === 'sent' ? 'back' : 'due';
      }) +
      '<div class="sp-forms-main"><div class="sp-forms-desk">' +
      formCard(view, picked, true) +
      '</div><div class="sp-forms-phone">' +
      formsPartHtml(
        'Open Now',
        open
          .map(function (q) {
            return formCard(view, q, false);
          })
          .join(''),
      ) +
      formsPartHtml('Done', rows(done, ['done', DONE_MARK])) +
      formsPartHtml('Coming Up', rows(soon, ['soon', SOON_MARK])) +
      '</div></div></div>'
    );
  }

  /* ── My Learning (Colin, 2026-11-14: "the student's report card, the
     screen students really want"). The grade at the top when the class
     shows My Learning (Show My Learning; view.learning, which
     shared/student-view.js builds from calc.js on returned work), then
     every piece the student has handed in, that is missing, or that came
     back, each with what it got; a piece that came back opens Your
     Feedback. With the switch off the grade is not shown and the list is.
     Every level, letter and % is the view's text. ──────────────── */

  var ML_ICON = {
    up: '<path d="M12 19V6M6.5 11.5L12 6l5.5 5.5"/>',
    down: '<path d="M12 5v13M6.5 12.5L12 18l5.5-5.5"/>',
  };
  function mlIcon(name, size) {
    return (
      '<svg class="sp-ml-icon sp-ml-icon-' +
      name +
      '" viewBox="0 0 24 24" width="' +
      (size || 16) +
      '" height="' +
      (size || 16) +
      '" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
      ML_ICON[name] +
      '</svg>'
    );
  }

  /* What a ladder says to a screen reader: the proficiency and the four
     names, no number for a level (DECISIONS, "Student-facing levels are
     proficiencies", 2026-11-12). */
  function ladderLabel(l, level) {
    return (
      'You are at ' +
      stepName(l, level) +
      ', on the steps ' +
      l.steps
        .map(function (st) {
          return st.name;
        })
        .join(', ')
    );
  }

  /* The four steps, Emerging to Extending, rising, every step reached in
     the student's own level's colour, You outlined on the one reached.
     `label` names the ladder for a screen reader; `named` writes each
     step's name under it (One Skill). */
  function ladderHtml(steps, at, label, named) {
    return (
      '<div class="sp-ml-ladder sp-ml-at-' +
      lvClass(at) +
      (named ? ' sp-ml-ladder-named' : '') +
      '" role="img" aria-label="' +
      esc(label) +
      '">' +
      steps
        .map(function (st) {
          var on = st.level === at;
          return (
            '<span class="sp-ml-step sp-ml-step-' +
            lvClass(st.level) +
            (on ? ' sp-ml-step-on' : '') +
            '">' +
            (on ? '<span class="sp-ml-you">You</span>' : '') +
            '<span class="sp-ml-bar' +
            (st.level <= at ? ' sp-ml-bar-on' : '') +
            '"></span>' +
            (named ? '<span class="sp-ml-step-name">' + esc(st.name) + '</span>' : '') +
            '</span>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  // "Up from Developing a month ago" (calc.js's gradeMonthChange, through the view).
  function trendHtml(l) {
    var t = l.trend;
    if (!t || !t.from) return '';
    var up = t.dir > 0;
    return (
      '<p class="sp-ml-trend ' +
      (up ? 'sp-ml-trend-up' : 'sp-ml-trend-down') +
      '">' +
      mlIcon(up ? 'up' : 'down', 14) +
      esc((up ? 'Up from ' : 'Down from ') + t.from + ' a month ago') +
      '</p>'
    );
  }

  function stepName(l, at) {
    var st = (l.steps || [])[at - 1];
    return st ? st.name : '';
  }

  // The grade at the top: "You're at Proficient" with its ladder, or the letter and %.
  function overallHtml(l) {
    var o = l.overall;
    if (o.letter && l.mode !== 'proficiency') {
      var ie = o.letter.grade === 'IE';
      return (
        '<section class="sp-ml-card sp-ml-overall sp-ml-overall-letter">' +
        PERIOD +
        '<div class="sp-ml-overall-row"><span class="sp-ml-letter sp-lv-' +
        lvClass(o.level) +
        '" role="img" aria-label="' +
        esc(ie ? 'IE, In Progress' : o.letter.grade) +
        '">' +
        esc(o.letter.grade) +
        '</span><span class="sp-ml-letter-side">' +
        (ie ? '<span class="sp-ml-ie">In Progress</span>' : '') +
        '<span class="sp-ml-pct">' +
        esc(o.letter.pct) +
        '</span>' +
        trendHtml(l) +
        '</span></div>' +
        '</section>'
      );
    }
    if (!o.word) return '';
    return (
      '<section class="sp-ml-card sp-ml-overall">' +
      PERIOD +
      '<div class="sp-ml-overall-row"><div class="sp-ml-overall-text"><p class="sp-ml-at"><span class="sp-ml-at-lead">You’re at</span>' +
      '<span class="sp-ml-at-word sp-ml-ink-' +
      lvClass(o.level) +
      '">' +
      esc(o.word) +
      '</span></p>' +
      trendHtml(l) +
      '</div>' +
      ladderHtml(l.steps, o.level, ladderLabel(l, o.level), false) +
      '</div>' +
      '</section>'
    );
  }

  // What the grade covers: the year so far (DECISIONS, "Year-to-date grading", 2026-11-03).
  var PERIOD = '<p class="sp-ml-period">This Year So Far</p>';

  // What Makes Up Your Grade, in a Letter or Both class: each category, what it counts, the student's letter and %.
  function categoriesHtml(l) {
    if (l.mode === 'proficiency' || !l.categories.length) return '';
    return (
      '<section class="sp-ml-card"><h2 class="sp-ml-card-title">What Makes Up Your Grade</h2><ul class="sp-ml-rows">' +
      l.categories
        .map(function (c) {
          return (
            '<li class="sp-ml-row sp-ml-row-still"><span class="sp-row-text"><span class="sp-row-title">' +
            esc(c.name) +
            '</span>' +
            (c.weight != null ? '<span class="sp-row-sub">' + esc('Counts ' + c.weight + '%') + '</span>' : '') +
            '</span>' +
            chipHtml(c.text, c.level) +
            '</li>'
          );
        })
        .join('') +
      '</ul></section>'
    );
  }

  /* The pieces on My Learning: work sent and waiting first, then the rest
     newest first (the view's order): missing, excused and back. */
  function learningPieces(view) {
    var on = view.work.filter(function (p) {
      return !segmentOf(p, view) || p.kind === 'missing';
    });
    return on
      .filter(function (p) {
        return p.kind === 'sent';
      })
      .concat(
        on.filter(function (p) {
          return p.kind !== 'sent';
        }),
      );
  }

  /* One piece's row: its title, a line on where it stands, and what it got.
     The line says when it was sent, that Missing counts as 0 in a class
     with a course % (a Proficiency class leaves Missing work out of a
     level), and what an updated result was. A blue dot marks a result not
     opened yet. */
  function learningRowHtml(p, view) {
    var zero = view.course && view.course.gradingSystem !== 'proficiency';
    var sub = '';
    var chip = '';
    var act = '';
    if (p.kind === 'sent') {
      var sent = (p.send && p.send.sent) || {};
      var at = sent.at || (p.group && p.group.sentAt) || '';
      sub = [sentAt(at), 'waiting for feedback'].join(SEP);
      chip = '<span class="sp-level sp-lv-0">Sent</span>';
      act = 'open-piece';
    } else if (p.kind === 'missing') {
      sub = [p.dueDate ? 'Due ' + fmtDate(p.dueDate, DAY) : '', zero ? 'counts as 0 until it’s in' : '']
        .filter(Boolean)
        .join(SEP);
      chip = '<span class="sp-level sp-lv-missing">Missing</span>';
      act = 'open-piece';
    } else if (p.kind === 'excused') {
      chip = '<span class="sp-level sp-lv-0">Excused</span>';
      act = learningAct(p);
    } else {
      var r = p.result || {};
      var was = r.was ? 'was ' + r.was : '';
      sub = (
        p.updated
          ? ['Updated ' + fmtDate(p.updatedAt || p.returnedAt, DAY), was]
          : [p.returnedAt ? 'Returned ' + fmtDate(p.returnedAt, DAY) : '']
      )
        .concat(p.late ? ['Late'] : [])
        .filter(Boolean)
        .join(SEP);
      chip = r.text ? chipHtml(r.text, r.level) : '';
      act = learningAct(p);
    }
    var fresh = p.kind === 'back' && p.unseen && p.result && p.result.text;
    var inner =
      '<span class="sp-ml-new' +
      (fresh ? ' sp-ml-new-on' : '') +
      '" aria-hidden="true"></span><span class="sp-row-text"><span class="sp-row-title">' +
      esc(p.title) +
      '</span>' +
      (sub ? '<span class="sp-row-sub">' + esc(sub) + '</span>' : '') +
      '</span>' +
      chip +
      (fresh ? '<span class="sp-hidden-title">New</span>' : '');
    /* A result not opened yet carries its id as data-unseen: it counts as
       opened once its row has been on screen (DECISIONS, "Student page
       build rulings (2026-11-10, later)" 5), as the Back cards' did. */
    return (
      '<li' +
      (fresh ? ' data-unseen="' + esc(p.id) + '"' : '') +
      '>' +
      (act
        ? '<button type="button" class="sp-ml-row" data-act="' +
          act +
          '" data-piece="' +
          esc(p.id) +
          '">' +
          inner +
          NEXT_ARROW +
          '</button>'
        : '<span class="sp-ml-row sp-ml-row-still">' + inner + '</span>') +
      '</li>'
    );
  }

  function workListHtml(view) {
    var pieces = learningPieces(view);
    if (!pieces.length) return '';
    return (
      '<section class="sp-ml-card sp-ml-work"><h2 class="sp-ml-card-title">Your Work</h2><ul class="sp-ml-rows">' +
      pieces
        .map(function (p) {
          return learningRowHtml(p, view);
        })
        .join('') +
      '</ul></section>'
    );
  }

  // Nothing handed in or back yet.
  function nothingYetHtml() {
    return (
      '<div class="sp-ml-empty"><h1 class="sp-page-title" tabindex="-1">Nothing Here Yet</h1>' +
      '<p class="sp-lead">Your work and your feedback show here once you hand something in or your teacher returns it.</p>' +
      '<button type="button" class="sp-btn sp-btn-tint sp-btn-pill" data-act="tab" data-tab="assignments">See Your Assignments</button></div>'
    );
  }

  /* The card of a piece sent and waiting, opened from My Learning (Unsend
     and Replace are on it while they can be used). */
  function sentCardBody(ui, view, p) {
    return (
      '<div class="sp-split sp-split-feedback">' +
      sideHtml(learningPieces(view), p, view) +
      '<section class="sp-feedback sp-ml-card-open">' +
      '<button type="button" class="sp-fb-back" data-act="card-close">' +
      BACK_ARROW +
      '<span>My Learning</span></button>' +
      '<div class="sp-deck sp-deck-one">' +
      cardHtml(p, true, view) +
      '</div></section></div>'
    );
  }

  // The sent piece My Learning has open, or null.
  function cardOpen(view, ui) {
    if (!view || !ui.card) return null;
    var p = pieceIn(view.work, ui.card);
    return p && p.id === ui.card && p.kind === 'sent' ? p : null;
  }

  function learningBody(view, ui) {
    var l = view.learning;
    var grade = l && !l.empty ? overallHtml(l) + categoriesHtml(l) : '';
    var list = workListHtml(view);
    if (!grade && !list) return nothingYetHtml();
    return (
      '<div class="sp-ml"><h1 class="sp-page-title sp-ml-title' +
      (grade ? ' sp-hidden-title' : '') +
      '" tabindex="-1">My Learning</h1>' +
      // The results didn't load: say so over the list, with Try Again.
      noResultsHtml(ui, view) +
      grade +
      list +
      '</div>'
    );
  }

  /* Bulletins is a tab only when the view holds them: the build switch is on and the server has the
     route (s/bulletins.js; the preview's own). Without them the page is the three tabs it was. */
  function hasBulletins(view) {
    return !!(view && view.bulletins && typeof StudentBulletinsView !== 'undefined');
  }
  // The tab showing: the one chosen when there is such a tab, else Assignments.
  function tabOf(ui, view) {
    if (ui.tab === 'bulletins') return hasBulletins(view) ? 'bulletins' : 'assignments';
    return TAB_BODIES[ui.tab] ? ui.tab : 'assignments';
  }

  function bodyHtml(view, ui) {
    if (ui.waiting || !view) return '<p class="sp-lead sp-empty" role="status">' + esc(WAITING) + '</p>';
    var tab = tabOf(ui, view);
    if (tab === 'bulletins') return StudentBulletinsView.body(view, ui);
    if (tab === 'questionnaires') {
      if ((view.questionnaires || []).length) return questionnairesBody(view, ui);
      return (
        '<h1 class="sp-page-title" tabindex="-1">' +
        esc(TAB_BODIES[tab].title) +
        '</h1><p class="sp-lead sp-empty">' +
        esc(TAB_BODIES[tab].line) +
        '</p>'
      );
    }
    var ho = handoutOpen(view, ui);
    if (ho) return handoutBody(ui, view, ho);
    var fb = feedbackPiece(view, ui);
    if (fb) return feedbackBody(ui, view, fb);
    var wk = workPiece(view, ui);
    if (wk) return workBody(ui, view, wk);
    if (tab === 'learning') {
      var c = cardOpen(view, ui);
      return c ? sentCardBody(ui, view, c) : learningBody(view, ui);
    }
    return assignmentsBody(ui, view);
  }

  /* ── The frame ─────────────────────────────────────────────── */

  // The gear in the header's right corner: it opens Settings.
  var GEAR =
    '<svg class="sp-gear-icon" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
  var TICK =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  var PLUS =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M12 5v14M5 12h14"/></svg>';
  var TABS = [
    // First in the bar (Colin, Nov 17), when the view has bulletins (hasBulletins).
    {
      id: 'bulletins',
      label: 'Bulletins',
      icon: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M9 4v5l1.5-1 1.5 1V4"/>',
    },
    {
      id: 'assignments',
      label: 'Assignments',
      icon: '<rect x="4" y="5" width="16" height="14" rx="3"/><path d="M8 10h8M8 14h5"/>',
    },
    { id: 'learning', label: 'My Learning', icon: '<path d="M4 20h4v-6H4zM10 20h4V9h-4zM16 20h4V4h-4z"/>' },
    {
      id: 'questionnaires',
      label: 'Reflect',
      icon: '<circle cx="12" cy="12" r="8"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5M12 16.5v.01"/>',
    },
  ];

  /* What is new on each tab since the student last looked (the board's red
     badge): a revision asked for on Assignments; work back or updated on
     My Learning. Reflect counts the reflections open and not yet answered
     (docs/plans/reflect-plan.md, "What changes" 6). */
  function newsOf(view, ui) {
    var n = { bulletins: 0, assignments: 0, learning: 0, questionnaires: 0 };
    if (!view || ui.waiting) return n;
    // Bulletins: the ones this student has not seen yet (s/bulletins-view.js).
    if (hasBulletins(view)) n.bulletins = StudentBulletinsView.count(view.bulletins);
    (view.changes || []).forEach(function (c) {
      n[c.why === 'revise' ? 'assignments' : 'learning'] += 1;
    });
    n.questionnaires = (view.questionnaires || []).filter(function (q) {
      return q && q.state === 'open';
    }).length;
    return n;
  }
  // The badge in words: "2 new", or on Reflect "2 to answer".
  function badgeWords(id, n) {
    return n + (id === 'questionnaires' ? ' to answer' : ' new');
  }

  /* The three tabs. Drawn twice, once in the header for a Chromebook and
     once along the bottom for a phone; page-view.css shows one. */
  function tabBarHtml(ui, where, view) {
    var on = tabOf(ui, view);
    var news = newsOf(view, ui);
    var bulletins = hasBulletins(view) && !ui.waiting;
    return (
      '<nav class="sp-tabs sp-tabs-' +
      where +
      '" aria-label="Your Page">' +
      TABS.filter(function (t) {
        return t.id !== 'bulletins' || bulletins;
      })
        .map(function (t) {
          var n = news[t.id];
          return (
            '<button type="button" class="sp-tab' +
            (t.id === on ? ' sp-tab-on' : '') +
            '" data-act="tab" data-tab="' +
            t.id +
            '"' +
            (t.id === on ? ' aria-current="page"' : '') +
            '><svg class="sp-tab-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
            t.icon +
            '</svg>' +
            (n ? '<span class="sp-tab-badge" aria-hidden="true">' + n + '</span>' : '') +
            '<span class="sp-tab-label">' +
            esc(t.label) +
            '</span>' +
            (n ? '<span class="sp-hidden-title">' + esc(badgeWords(t.id, n)) + '</span>' : '') +
            '</button>'
          );
        })
        .join('') +
      '</nav>'
    );
  }

  /* Text Size: how big the page is drawn on this device. Normal is the
     page as it was; Large and Larger draw everything bigger (student.css
     on the student page, preview-student.css in the preview). */
  var TEXT_SIZES = [
    { id: 'normal', label: 'Normal' },
    { id: 'large', label: 'Large' },
    { id: 'larger', label: 'Larger' },
  ];
  var TEXT_SIZE_IDS = { normal: 1, large: 1, larger: 1 };
  // The size the page is drawn at: 'large', 'larger', or '' for Normal.
  function textSizeOf(ui) {
    var z = ui && ui.textSize;
    return z === 'large' || z === 'larger' ? z : '';
  }

  /* Settings (Colin, 2026-11-17: "let's replace the log out button and the
     class picker button at the top with a gear icon. include relevant
     options for students."): a sheet from the bottom on a phone, a small
     menu under the gear on a Chromebook (page-view.css). Whose page this
     is, by the first name the page was sent; Switch Class, with more than
     one class on this device; Add Another Card; Text Size; and Log Out,
     last and set apart, which asks first as it did in the header.
     `ui.classes` is the classes this device's session has opened
     ({ enrollmentId, name, block, toDo }, s/assignments.js), and
     `ui.classOn` the one showing; the preview has neither. */
  /* A class's counts in Switch Class: how many pieces wait there ("3 to do"), once the server says,
     and bulletins not seen there yet ("2 new", s/bulletins.js); nothing at 0. A class with "2 new"
     holds its counts together, so they go under the name and the tick stays beside it
     (s/bulletins.css); without it the row is drawn exactly as before. */
  function countsHtml(c, ui) {
    var news = ui.classNews && ui.classNews[c.enrollmentId] > 0 ? ui.classNews[c.enrollmentId] : 0;
    var todo = c.toDo > 0 ? '<span class="sp-class-todo">' + esc(c.toDo + ' to do') + '</span>' : '';
    if (!news) return todo;
    return (
      '<span class="sp-class-counts">' +
      todo +
      '<span class="sp-bulletin-class-new">' +
      esc(news + ' new') +
      '</span></span>'
    );
  }

  function settingsSheetHtml(view, ui) {
    var first = String((view && view.student && view.student.firstName) || '').trim();
    var classes = (Array.isArray(ui.classes) ? ui.classes : []).filter(function (c) {
      return c && c.enrollmentId;
    });
    var size = textSizeOf(ui) || 'normal';
    var classList =
      classes.length > 1
        ? '<h3 class="sp-set-label" id="sp-set-classes">Switch Class</h3>' +
          '<ul class="sp-classes sp-set-classes" aria-labelledby="sp-set-classes">' +
          classes
            .map(function (c) {
              var on = c.enrollmentId === ui.classOn;
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
                countsHtml(c, ui) +
                (on ? '<span class="sp-class-tick">' + TICK + '</span>' : '') +
                '</button></li>'
              );
            })
            .join('') +
          '</ul>'
        : '';
    return (
      '<button type="button" class="sp-sheet-back sp-set-back" data-act="settings-close" aria-label="Close" tabindex="-1"></button>' +
      '<div class="sp-sheet sp-set" role="dialog" aria-modal="true" aria-labelledby="sp-set-title">' +
      '<span class="sp-sheet-grip sp-set-grip" aria-hidden="true"></span>' +
      '<div class="sp-set-top">' +
      '<h2 class="sp-sheet-title sp-set-title" id="sp-set-title" tabindex="-1">Settings</h2>' +
      '<button type="button" class="sp-set-done" data-act="settings-close">Done</button>' +
      '</div>' +
      (first ? '<p class="sp-set-who">Signed in as ' + esc(first) + '</p>' : '') +
      classList +
      '<button type="button" class="sp-set-row" data-act="card-add">' +
      PLUS +
      '<span>Add Another Card</span></button>' +
      '<h3 class="sp-set-label" id="sp-set-size-label">Text Size</h3>' +
      '<div class="sp-set-sizes" role="radiogroup" aria-labelledby="sp-set-size-label" aria-describedby="sp-set-size-hint">' +
      TEXT_SIZES.map(function (t) {
        var on = t.id === size;
        return (
          '<button type="button" class="sp-set-size sp-set-size-' +
          t.id +
          (on ? ' sp-set-size-on' : '') +
          '" role="radio" aria-checked="' +
          (on ? 'true' : 'false') +
          '" data-act="text-size" data-size="' +
          t.id +
          '">' +
          esc(t.label) +
          '</button>'
        );
      }).join('') +
      '</div>' +
      '<p class="sp-set-hint" id="sp-set-size-hint">Makes everything on your page bigger on this device.</p>' +
      '<button type="button" class="sp-set-out" data-act="logout-ask" aria-haspopup="dialog">Log Out</button>' +
      '</div>'
    );
  }

  /* The sheet just opened slides in from where it starts: up from the
     bottom on a phone, down from the gear on a Chromebook (page-view.css).
     Only on the drawing that opened it: drawn again under it (a text size
     chosen, the page's data arriving), it stays still. */
  function slideIn(root) {
    var sheet = root && root.querySelector ? root.querySelector('.sp-set') : null;
    if (sheet) sheet.classList.add('sp-set-in');
  }

  /* Log Out? (Colin, 2026-11-14: "Done should be Log Out and should also
     prompt a warning"): asked over the page before the session ends. Log
     Out ends it as Done did (card-done, s/app.js). */
  function logoutSheetHtml(ui) {
    var left = !!ui && ui.quizWaiting > 0;
    return (
      '<button type="button" class="sp-sheet-back sp-set-back" data-act="logout-cancel" aria-label="Cancel" tabindex="-1"></button>' +
      '<div class="sp-sheet sp-logout" role="alertdialog" aria-modal="true" aria-labelledby="sp-logout-title" aria-describedby="sp-logout-line">' +
      '<span class="sp-sheet-grip sp-set-grip" aria-hidden="true"></span>' +
      '<h2 class="sp-sheet-title sp-set-title" id="sp-logout-title" tabindex="-1">Log Out?</h2>' +
      '<p class="sp-lead" id="sp-logout-line">' +
      (left
        ? 'An answer on your quiz hasn’t reached your teacher yet. Wait a moment for it to send, or log out and lose it.'
        : 'You’ll need your card to open your page again.') +
      '</p>' +
      /* One under the other, Cancel last: at the foot of the sheet, where
         Settings' Log Out was under the finger, so a double tap cancels
         (s/app.js also ignores presses here for a moment after it opens). */
      '<div class="sp-logout-buttons">' +
      '<button type="button" class="sp-btn sp-btn-danger" data-act="card-done">' +
      (left ? 'Log Out Anyway' : 'Log Out') +
      '</button>' +
      '<button type="button" class="sp-btn sp-btn-tint" data-act="logout-cancel">' +
      (left ? 'Wait' : 'Cancel') +
      '</button>' +
      '</div></div>'
    );
  }

  /* Switch Class asking first, while a quiz answer waits to be saved (s/quiz.js): the same sheet, with its
     own words. Wait is last, at the foot. */
  function classHoldSheetHtml(ui) {
    return (
      '<button type="button" class="sp-sheet-back sp-set-back" data-act="class-hold-cancel" aria-label="Wait" tabindex="-1"></button>' +
      '<div class="sp-sheet sp-logout" role="alertdialog" aria-modal="true" aria-labelledby="sp-logout-title" aria-describedby="sp-logout-line">' +
      '<span class="sp-sheet-grip sp-set-grip" aria-hidden="true"></span>' +
      '<h2 class="sp-sheet-title sp-set-title" id="sp-logout-title" tabindex="-1">Switch Class?</h2>' +
      '<p class="sp-lead" id="sp-logout-line">An answer on your quiz hasn’t reached your teacher yet. Wait a moment for it to send, or switch and lose it.</p>' +
      '<div class="sp-logout-buttons">' +
      '<button type="button" class="sp-btn sp-btn-danger" data-act="class-open" data-enrollment="' +
      esc(ui.classHold) +
      '">Switch Class Anyway</button>' +
      '<button type="button" class="sp-btn sp-btn-tint" data-act="class-hold-cancel">Wait</button>' +
      '</div></div>'
    );
  }

  /* The whole page: the class's name with its block, the tabs on a
     Chromebook, the gear (Settings); the tab's body; the tabs along the
     bottom on a phone. */
  function html(view, ui) {
    ui = ui || {};
    var course = (view && view.course) || ui.course || {};
    var block = String(course.block || '').trim();
    var tab = tabOf(ui, view);
    var ready = !ui.waiting && view;
    var open =
      ready &&
      tab !== 'bulletins' &&
      (handoutOpen(view, ui) ||
        feedbackPiece(view, ui) ||
        workPiece(view, ui) ||
        (tab === 'learning' && cardOpen(view, ui)));
    return (
      '<div class="sp-view' +
      (open ? ' sp-on-feedback' : '') +
      // The cards or a piece open, with its list: on a Chromebook, a sidebar down the left (page-view.css).
      ((tab === 'assignments' || open) && ready ? ' sp-on-deck' : '') +
      (textSizeOf(ui) ? ' sp-text-' + textSizeOf(ui) : '') +
      '">' +
      '<header class="sp-head">' +
      '<div class="sp-head-class"><span class="sp-head-title">' +
      esc(course.name || '') +
      '</span>' +
      (block ? '<span class="sp-pill">' + esc(blockLabel(block)) + '</span>' : '') +
      '</div>' +
      '<span class="sp-head-gap"></span>' +
      tabBarHtml(ui, 'top', view) +
      '<span class="sp-head-gap"></span>' +
      '<button type="button" class="sp-gear" data-act="settings-open" aria-label="Settings" aria-haspopup="dialog" aria-expanded="' +
      (ui.settings && !ui.logout ? 'true' : 'false') +
      '">' +
      GEAR +
      '</button>' +
      '</header>' +
      '<main class="sp-page">' +
      bodyHtml(view, ui) +
      (ui.note ? '<p class="sp-fine">' + esc(ui.note) + '</p>' : '') +
      '</main>' +
      tabBarHtml(ui, 'bottom', view) +
      (ui.settings && !ui.logout ? settingsSheetHtml(view, ui) : '') +
      (ui.logout ? logoutSheetHtml(ui) : '') +
      (ui.classHold && !ui.logout ? classHoldSheetHtml(ui) : '') +
      '</div>'
    );
  }

  /* Draws the page into `root`. The preview's way in. */
  function draw(root, view, ui) {
    // html-safe: html() escapes every title, date line, result and name with esc; the rest is fixed markup
    root.innerHTML = html(view, ui);
  }

  /* ── What a press changes ──────────────────────────────────── */

  var TAB_IDS = { bulletins: 1, assignments: 1, learning: 1, questionnaires: 1 };
  var SEGMENT_IDS = { outstanding: 1, upcoming: 1 };
  var FEEDBACK_ACTS = {
    feedback: 1,
    whole: 1,
    'feedback-close': 1,
    'whole-close': 1,
    levels: 1,
    'form-pick': 1,
    work: 1,
    'work-close': 1,
    'work-page': 1,
    'work-marks': 1,
    compare: 1,
  };
  function has(map, key) {
    return typeof key === 'string' && Object.prototype.hasOwnProperty.call(map, key);
  }

  // Where focus goes back to on a piece's list: its row on My Learning, its card on Assignments.
  function backFocus(p, view) {
    if (!p) return '.sp-segment-on';
    return homeOf(p, view).tab === 'learning' ? '.sp-ml-row[data-piece="' + cssId(p.id) + '"]' : '#' + domId(p.id);
  }

  // Open piece `p` where it lives: its tab, and its segment on Assignments.
  function goHome(next, p, view) {
    var home = homeOf(p, view);
    next.tab = home.tab;
    if (home.segment) next.segment = home.segment;
    next.pick = p.id;
  }

  /* A press on one of the page's own buttons, answered with what the
     student now looks at: { ui, focus } (focus: where the keyboard goes
     after the page is drawn again), or null when the press is not one of
     these (Log Out, Switch Class, Add Another Card, Try Again: the
     student page's own).
     Nothing here reaches the network or the session, so the student page
     and the preview answer the same presses the same way. `el` is the
     button. */
  function press(ui, view, act, el) {
    var next = Object.assign({}, ui || {});
    var attr = function (name) {
      return (el && el.getAttribute && el.getAttribute(name)) || '';
    };
    // Log Out? goes with any press but its own.
    if (act !== 'logout-ask') next.logout = false;
    // Settings goes with any press but its own and a text size chosen in it.
    if (act !== 'settings-open' && act !== 'text-size') next.settings = false;
    /* Settings, and Log Out? from it, open over whatever is showing and
       leave it as it was: the page is not scrolled (`stay`), and closing
       either gives the focus back to the gear. */
    if (act === 'settings-open') {
      next.settings = true;
      return { ui: next, focus: '#sp-set-title', stay: true, slide: true };
    }
    if (act === 'settings-close') return { ui: next, focus: '.sp-gear', stay: true };
    if (act === 'text-size') {
      var z = attr('data-size');
      if (!has(TEXT_SIZE_IDS, z) || !next.settings) return null;
      next.textSize = z === 'normal' ? '' : z;
      return { ui: next, focus: '.sp-set-size[data-size="' + z + '"]', stay: true };
    }
    if (act === 'logout-ask') {
      next.logout = true;
      return { ui: next, focus: '#sp-logout-title', stay: true };
    }
    if (act === 'logout-cancel') return { ui: next, focus: '.sp-gear', stay: true };
    // Any other press leaves Your Feedback and The Whole Rubric.
    if (!has(FEEDBACK_ACTS, act)) {
      next.feedback = '';
      next.whole = false;
    }
    // A sent piece's card on My Learning goes with any press but the ones inside it.
    if (!has(FEEDBACK_ACTS, act) && !/^handout/.test(act) && act !== 'open-piece') next.card = '';
    // Before and After goes with any press but its own (S11-F2).
    if (act !== 'compare') next.compare = false;
    // See Your Work goes with any press but its own.
    if (!/^work/.test(act)) {
      next.work = '';
      next.workPage = 0;
      next.marksOff = false;
    }
    // A handout open in the page goes with any press but its own (Handouts and Links).
    if (!/^handout/.test(act)) {
      next.handout = '';
      next.handoutPiece = '';
      next.handoutPage = 0;
    }
    // A bulletin's file open full size goes with any press but its own (s/bulletins-view.js).
    if (!/^bulletin-(page|turn)$/.test(act)) {
      next.bulletinFile = '';
      next.bulletinPage = 0;
    }
    if (/^bulletin-/.test(act)) {
      return typeof StudentBulletinsView !== 'undefined'
        ? StudentBulletinsView.press(next, view, act, el, ui || {})
        : null;
    }
    if (act === 'handout') {
      var hp = view && pieceIn(view.work, attr('data-piece'));
      var hid = attr('data-resource');
      if (!hp || hp.id !== attr('data-piece')) return null;
      var hr = (hp.resources || []).filter(function (x) {
        return x && x.kind === 'handout' && x.id === hid;
      })[0];
      if (!hr) return null;
      next.feedback = '';
      next.whole = false;
      goHome(next, hp, view);
      next.handout = hr.id;
      next.handoutPiece = hp.id;
      // A page tapped in the card's carousel opens at that page.
      var hpage = Number(attr('data-page'));
      next.handoutPage = hpage >= 0 && hpage < hr.pages && Math.floor(hpage) === hpage ? hpage : 0;
      // Pages fetched for another handout are not this one's.
      if (next.handoutPages && next.handoutPages.id !== hr.id) next.handoutPages = null;
      return { ui: next, focus: '#sp-handout-title', handout: { piece: hp.id, resource: hr.id } };
    }
    if (act === 'handout-close') {
      var was2 = { piece: next.handoutPiece, resource: next.handout, page: Number(next.handoutPage) || 0 };
      var wasP = view && was2.piece ? pieceIn(view.work, was2.piece) : null;
      var inCar =
        !!wasP &&
        wasP.id === was2.piece &&
        typeof StudentPageCarousel !== 'undefined' &&
        StudentPageCarousel.shows(wasP);
      next.handout = '';
      next.handoutPiece = '';
      next.handoutPage = 0;
      return {
        ui: next,
        // Back on the card: its carousel at the page the student was on, or the handout's row.
        focus: !was2.resource
          ? '.sp-segment-on'
          : inCar
            ? '.sp-car-slide[data-resource="' + cssId(was2.resource) + '"][data-page="' + was2.page + '"]'
            : '[data-act="handout"][data-resource="' + cssId(was2.resource) + '"]',
      };
    }
    if (act === 'handout-page') {
      var openH = handoutOpen(view, next);
      if (!openH) return null;
      var hcount = (handoutPages(next, openH.resource) || []).length;
      var hto = Number(attr('data-page'));
      if (!hcount || !(hto >= 0 && hto < hcount) || Math.floor(hto) !== hto) return null;
      next.handoutPage = hto;
      return { ui: next, focus: '#sp-handout-title' };
    }
    if (act === 'work') {
      var wid = attr('data-piece');
      var w = view && pieceIn(view.work, wid);
      if (!w || w.id !== wid || !canSeeWork(w)) return null;
      // Your Feedback stays under it when it was opened from there; from a row or a card, nothing is.
      var fromFeedback = !!(ui && ui.feedback === w.id && hasFeedback(w));
      goHome(next, w, view);
      next.feedback = fromFeedback ? w.id : '';
      // The card of work sent stays under its own pages only.
      if (next.card && next.card !== w.id) next.card = '';
      next.whole = false;
      next.work = w.id;
      next.workPage = 0;
      next.marksOff = false;
      // Pages fetched for another piece are not this one's.
      if (next.workPages && next.workPages.id !== w.id) next.workPages = null;
      return { ui: next, focus: '#sp-work-title', work: w.id };
    }
    if (act === 'work-close') {
      var shut = view && next.work ? pieceIn(view.work, next.work) : null;
      next.work = '';
      next.workPage = 0;
      next.marksOff = false;
      // Back to Your Feedback or the card of work sent, at See Your Work; else to the piece's row.
      var under = next.feedback || next.card;
      return {
        ui: next,
        focus: under || !shut ? '[data-act="work"]' : backFocus(shut, view),
      };
    }
    if (act === 'work-page' || act === 'work-marks') {
      var on = view && next.work ? pieceIn(view.work, next.work) : null;
      if (!on || on.id !== next.work || !canSeeWork(on)) return null;
      if (act === 'work-marks' && !on.marks) return null;
      if (act === 'work-marks') {
        next.marksOff = !next.marksOff;
        return { ui: next, focus: '[data-act="work-marks"]' };
      }
      var count = (readyPages(next, on) || []).length;
      var to = Number(attr('data-page'));
      if (!count || !(to >= 0 && to < count) || Math.floor(to) !== to) return null;
      next.workPage = to;
      return { ui: next, focus: '#sp-work-title' };
    }
    if (act === 'tab') {
      if (!has(TAB_IDS, attr('data-tab'))) return null;
      next.tab = attr('data-tab');
      next.form = '';
      next.card = '';
      var top = el.closest && el.closest('.sp-tabs-top');
      return { ui: next, focus: (top ? '.sp-tabs-top' : '.sp-tabs-bottom') + ' .sp-tab-on' };
    }
    if (act === 'segment') {
      if (!has(SEGMENT_IDS, attr('data-segment'))) return null;
      next.tab = 'assignments';
      next.segment = attr('data-segment');
      next.pick = '';
      return { ui: next, focus: '.sp-segment-on' };
    }
    if (act === 'compare') {
      var bid = attr('data-piece');
      var c = view && pieceIn(view.work, bid);
      if (!c || c.id !== bid || !hasCompare(c)) return null;
      goHome(next, c, view);
      next.feedback = c.id;
      next.whole = false;
      next.compare = true;
      return { ui: next, focus: '#sp-fb-title' };
    }
    if (act === 'feedback' || act === 'whole') {
      var fid = attr('data-piece');
      var f = view && pieceIn(view.work, fid);
      if (!f || f.id !== fid) return null;
      next.feedback = f.id;
      next.whole = act === 'whole';
      if (!feedbackPiece(view, next)) return null;
      goHome(next, f, view);
      return { ui: next, focus: '#sp-fb-title' };
    }
    if (act === 'feedback-close' || act === 'whole-close') {
      var open = view && feedbackPiece(view, next);
      next.whole = false;
      // From The Whole Rubric back to Your Feedback, when the piece has some; otherwise to where it was opened.
      if (act === 'whole-close' && open && hasFeedback(open)) return { ui: next, focus: '#sp-fb-title' };
      next.feedback = '';
      // A sent piece's card stays open under its feedback.
      return { ui: next, focus: next.card ? '#' + domId(next.card) : backFocus(open, view) };
    }
    if (act === 'card-close') {
      var was = view && pieceIn(view.work, ui.card);
      return { ui: next, focus: was && was.id === ui.card ? backFocus(was, view) : '.sp-ml-title' };
    }
    if (act === 'form-pick') {
      var list = view ? view.questionnaires || [] : [];
      var fid2 = attr('data-form-id');
      var item = pieceIn(list, fid2);
      if (!item || item.id !== fid2) return null;
      next.form = item.id;
      return { ui: next, focus: '.sp-forms-desk .sp-form-title' };
    }
    if (act === 'levels') {
      next.levels = !next.levels;
      return { ui: next, focus: '.sp-fb-levels-btn' };
    }
    if (act === 'pick' || act === 'open-piece') {
      var id = attr('data-piece');
      var p = view && pieceIn(view.work, id);
      if (!p || p.id !== id) return null;
      if (segmentOf(p, view)) {
        goHome(next, p, view);
        next.card = '';
        return { ui: next, focus: '#' + domId(p.id), piece: p.id };
      }
      // Work sent and waiting opens its card on My Learning.
      if (p.kind !== 'sent') return null;
      next.tab = 'learning';
      next.card = p.id;
      return { ui: next, focus: '#' + domId(p.id) };
    }
    return null;
  }

  /* After the page is drawn into `root`: a card picked from elsewhere (a
     row on My Learning, a Chromebook's list) is brought into view on the
     phone, where the cards are one under another. `onPick` is kept for
     the callers; scrolling picks nothing. */
  function settle(root) {
    var deck = root && root.querySelector ? root.querySelector('.sp-deck') : null;
    var on = deck && deck.querySelector('.sp-picked');
    if (!on || deck.children[0] === on || typeof on.scrollIntoView !== 'function') return;
    // On a Chromebook the list on the left shows (page-view.css) and the card picked is the one drawn.
    var side = root.querySelector('.sp-side');
    if (side && side.offsetParent !== null) return;
    on.scrollIntoView({ block: 'start', behavior: 'auto' });
  }

  return {
    html: html,
    draw: draw,
    press: press,
    settle: settle,
    slideIn: slideIn,
    textSizeOf: textSizeOf,
    rowView: rowView,
    counts: counts,
    inSegment: inSegment,
    segmentOf: segmentOf,
    learningPieces: learningPieces,
    photosWord: photosWord,
    thumbsHtml: thumbsHtml,
    marksLine: marksLine,
    pagesLine: pagesLine,
    canSeeWork: canSeeWork,
    planHtml: planHtml,
    quizTopHtml: quizTopHtml,
    // "Returned Nov 24": the date as Your Feedback and the rows read it (a time is read in the student's own day).
    returnedOn: function (p) {
      return p && p.returnedAt ? 'Returned ' + fmtDate(p.returnedAt, DAY) : '';
    },
    // A reminder linked to a piece carries that card's band (s/bulletins-view.js).
    bandHtml: bandHtml,
  };
})();
