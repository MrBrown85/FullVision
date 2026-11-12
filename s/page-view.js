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

   ui: { tab: 'assignments' | 'learning' | 'questionnaires' | 'reports',
         segment: 'todo' | 'sent' | 'back', pick: the id of the card
         showing, all: true for All Assignments, search and filter: All
         Assignments' search words and filter ('all' | 'todo' | 'sent' |
         'back' | 'new' | 'revise'),
         feedback: the id of the piece Your Feedback is open on, whole:
         true for its The Whole Rubric (also for work not back yet, from
         See the Rubric), compare: true for its Before and After (a
         returned revision, S11-F2), levels: What the Levels Mean is closed
         (it starts open),
         form: the questionnaire or report picked on a Chromebook,
         noResults: the results didn't load (say so, with Try Again),
         sending: Try Again is under way, waiting: the view is not here yet,
         note: a line under the body (Demo Mode's), sheet: Your Classes is
         open, skill: the id of the skill One Skill is open on }. */
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

  /* ── What the server also tells (S4-M1) ────────────────────────
     Each part below draws only when the view holds it: until the server
     sends a unit, a category, a Description, Core Competencies or I Can
     lines, the page is as it was. The page never names the teacher
     (Colin's ruling 112, "Leave the name off."): it says "your teacher". */

  /* A category and what it counts: "Practice Questions · counts 40% of your
     grade"; "Practice · doesn't count toward your grade" for a category
     that counts toward nothing; the name alone where no percent is true. */
  function categoryLine(category) {
    if (!category || !category.name) return '';
    var pct = category.percent;
    if (pct === 0) return category.name + SEP + 'doesn’t count toward your grade';
    if (typeof pct === 'number' && pct > 0) return category.name + SEP + 'counts ' + pct + '% of your grade';
    return category.name;
  }

  // "Counts toward Perspective", "Counts toward Evidence and Ethical Judgment".
  function towardLine(names) {
    if (!names || !names.length) return '';
    var all = names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] : names[0];
    return 'Counts toward ' + all;
  }

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
    var bits = ['Back ' + fmtDate(p.returnedAt, DAY)];
    if (p.result.kind === 'level' && p.result.word) bits.push(p.result.word);
    view.result = p.result.text || '';
    if (p.late) bits.push('Late');
    if (p.updated) bits.push('Updated');
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

  /* ── To Do, Sent and Back ──────────────────────────────────── */

  /* To Do is what is still to hand in: work not back yet, work marked
     Missing, and work returned for revision (S11-F2). Sent is work sent and
     waiting for its grade (S5-F2).
     Back is work that came back. */
  var SEGMENTS = [
    { id: 'todo', label: 'To Do' },
    { id: 'sent', label: 'Sent' },
    { id: 'back', label: 'Back' },
  ];
  function inSegment(view, id) {
    var list = view.work.filter(function (p) {
      if (id === 'todo') return p.kind === 'due' || p.kind === 'missing' || p.kind === 'revise';
      if (id === 'back') return p.kind === 'back';
      return id === 'sent' && p.kind === 'sent';
    });
    // A revision asked for leads To Do (the Needs Revision board: "1 of 3"); the rest keep their order.
    if (id !== 'todo') return list;
    return list
      .filter(function (p) {
        return p.kind === 'revise';
      })
      .concat(
        list.filter(function (p) {
          return p.kind !== 'revise';
        }),
      );
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
    if (p.result && p.result.text)
      rows.push({ name: 'Your Result', text: p.result.text, level: null, was: p.result.was });
    (p.rubric ? p.rubric.rows : p.competencies || []).forEach(function (r) {
      // A rubric criterion names the competencies it counts toward under it (the Returned Work board).
      var toward = p.rubric && r.toward ? r.toward.join(', ') : '';
      if (r.text) rows.push({ name: r.name, text: r.text, level: r.level, was: r.was, toward: toward });
    });
    if (!rows.length) return '';
    return (
      '<ul class="sp-piece-rows">' +
      rows
        .map(function (r) {
          return (
            '<li class="sp-piece-row">' +
            (r.toward
              ? '<span class="sp-piece-row-label"><span class="sp-piece-row-name">' +
                esc(r.name) +
                '</span><span class="sp-piece-row-sub">' +
                esc(r.toward) +
                '</span></span>'
              : '<span class="sp-piece-row-name">' + esc(r.name) + '</span>') +
            (r.was
              ? '<span class="sp-was-wrap">' +
                chipHtml(r.text, r.level) +
                '<span class="sp-was">' +
                esc('Was ' + r.was) +
                '</span></span>'
              : chipHtml(r.text, r.level)) +
            '</li>'
          );
        })
        .join('') +
      '</ul>'
    );
  }

  /* What changed on an updated grade, under its rows: who and when, and
     each level that moved: "Your result was updated on Nov 12". */
  function updatedNoteHtml(p) {
    var moved = (p.rubric ? p.rubric.rows : p.competencies || []).filter(function (r) {
      return r.was && r.text;
    });
    // A result-only piece (points, Complete) says how its result moved.
    if (p.result && p.result.was && p.result.text)
      moved = moved.concat([{ name: 'Your result', was: p.result.was, text: p.result.text }]);
    if (!p.updated || !moved.length) return '';
    return (
      '<div class="sp-updated-note"><p class="sp-updated-title">' +
      esc('Your result was updated on ' + fmtDate(p.updatedAt || p.returnedAt, DAY)) +
      '</p>' +
      moved
        .map(function (r) {
          return '<p class="sp-updated-line">' + esc(r.name + ' went from ' + r.was + ' to ' + r.text + '.') + '</p>';
        })
        .join('') +
      '</div>'
    );
  }

  var PILL_ICON = {
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    camera: '<path d="M4 8.5h3l1.6-2.2h6.8L17 8.5h3v10H4z"/><circle cx="12" cy="13.2" r="3.2"/>',
    again: '<path d="M19 12a7 7 0 1 1-2.1-5"/><path d="M19 4.5V8h-3.5"/>',
    lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
    next: '<path d="M4 12h15M13 6l6 6-6 6"/>',
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
    return '<span class="sp-flag sp-flag-' + kind + '">' + (icon ? pillIcon(icon) : '') + esc(text) + '</span>';
  }

  // Work still to do whose last day to send has passed (the Closed Assignment board).
  function isClosed(p) {
    return (p.kind === 'due' || p.kind === 'missing') && !!(p.send && p.send.takes && !p.send.open);
  }

  /* The pill at the top right of a card still to do, on the unit's line: when
     it is due, with a clock (the To Do Card board). A closed piece has none. */
  function duePill(p) {
    if ((p.kind !== 'due' && p.kind !== 'missing') || !p.dueDate || isClosed(p)) return '';
    return pillHtml('due', 'Due ' + fmtDate(p.dueDate, DUE_DAY), 'clock');
  }

  /* The card's pills under its title: where it stands (Returned, Updated,
     Missing, Revise by, Sent with its photos, Closed), Group, Late. */
  function pills(p) {
    var out = [];
    // A returned grade changed since the student last looked says when (the board's "Updated Nov 12").
    if (p.kind === 'back' && p.updated)
      out.push(pillHtml('updated', 'Updated ' + fmtDate(p.updatedAt || p.returnedAt, DAY)));
    else if (p.kind === 'back') out.push(pillHtml('back', 'Returned ' + fmtDate(p.returnedAt, DAY)));
    else if (p.kind === 'missing') out.push(pillHtml('missing', 'Missing'));
    else if (p.kind === 'revise') {
      // "Revise by Tue, Nov 10" (the Needs Revision board).
      var by = p.revision && p.revision.reviseBy;
      out.push(pillHtml('revise', by ? 'Revise by ' + fmtDate(by, DUE_DAY) : 'Needs Revision', 'again'));
    } else if (p.kind === 'sent') {
      // "Sent Nov 4 · 3 photos" (the Sent, Being Graded board).
      var sent = (p.send && p.send.sent) || {};
      var at = sent.at || (p.group && p.group.sentAt) || '';
      var pages = p.group && p.group.sent ? p.group.pages : sent.pages;
      out.push(
        pillHtml(
          'sent',
          [at ? 'Sent ' + fmtDate(at, DAY) : 'Sent', photosWord(pages)].filter(Boolean).join(SEP),
          'camera',
        ),
      );
    }
    // "Closed Nov 13" (the Closed Assignment board).
    if (isClosed(p))
      out.push(pillHtml('closed', p.send.closesOn ? 'Closed ' + fmtDate(p.send.closesOn, DAY) : 'Closed'));
    // One per Group (S12-F1, the board's "Group" tag).
    if (p.group) out.push(pillHtml('quiet', 'Group'));
    if (p.late) out.push(pillHtml('quiet', 'Late'));
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

  /* What You're Graded On, on work not back yet (the To Do card board): its
     competencies by name, each with its I Can lines when the server sends
     them, and See the Rubric when it has one. */
  function gradedOnHtml(p) {
    var names = p.gradedOn || [];
    if (!names.length && !p.rubric) return '';
    return (
      '<div class="sp-graded-on"><span class="sp-graded-on-title">What You’re Graded On</span>' +
      names
        .map(function (g) {
          return (
            '<span class="sp-graded-on-name">' +
            esc(g.name) +
            '</span>' +
            (g.iCan || [])
              .map(function (line) {
                return '<span class="sp-graded-on-ican">' + esc(line) + '</span>';
              })
              .join('')
          );
        })
        .join('') +
      (p.rubric
        ? '<button type="button" class="sp-link-btn" data-act="whole" data-piece="' +
          esc(p.id) +
          '">See the Rubric' +
          GO_ARROW +
          '</button>'
        : '') +
      '</div>'
    );
  }

  /* A returned piece with a result opens Your Feedback; so does work
     returned for revision with its grade kept, and a revision sent while
     its new grade is not back (the grade the student was given, S11-F2). */
  function hasFeedback(p) {
    if (!p || !p.result || !p.result.text) return false;
    return p.kind === 'back' || (!!p.revision && (p.kind === 'revise' || p.kind === 'sent'));
  }

  /* One card. A returned piece not opened since it came back carries its
     id as data-unseen: the student page counts it opened once the card has
     been on screen. */
  // The Core Competencies a piece is for, under What You're Graded On.
  function coreHtml(p) {
    var list = p.coreCompetencies || [];
    if (!list.length) return '';
    return (
      '<div class="sp-core"><span class="sp-graded-on-title sp-core-label">' +
      (list.length === 1 ? 'Core Competency' : 'Core Competencies') +
      '</span>' +
      list
        .map(function (c) {
          return '<span class="sp-core-name">' + esc(c.name) + '</span>';
        })
        .join('') +
      '</div>'
    );
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
    var sub = [view.course && view.course.name, 'Revision returned ' + fmtDate(p.returnedAt, DAY)]
      .filter(Boolean)
      .join(SEP);
    /* The Before and After boards: one card with both versions, each row's
       level then and now and Your Result; what was asked and what the
       student did in one card under it. On a Chromebook the versions sit
       on the left and the rest beside them (page-view.css). */
    var reflect = reflectButtonHtml(view, p, true);
    return (
      '<section class="sp-feedback sp-ba" aria-labelledby="sp-fb-title">' +
      feedbackHead('Assignments', 'feedback-close', p.title, sub, p.unseen ? p.id : '', 'sp-fb-title') +
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
  function cardCommentHtml(p) {
    if (!p.comment) return '';
    return '<p class="sp-piece-comment">' + esc(p.comment) + '</p>';
  }

  /* A card's first line: its unit on the left and, on work still to do, when
     it is due on the right (the To Do Card board). Nothing when it has neither. */
  function headHtml(p) {
    var due = duePill(p);
    if (!p.unit && !due) return '';
    return (
      '<div class="sp-piece-head">' +
      (p.unit ? '<p class="sp-piece-unit">' + esc(p.unit) + '</p>' : '<span></span>') +
      due +
      '</div>'
    );
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

  function resourcesHtml(p) {
    var list = Array.isArray(p.resources) ? p.resources : [];
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
    return (Array.isArray(got.pages) ? got.pages : []).filter(function (pg) {
      return pg && typeof pg.url === 'string' && PAGE_URL.test(pg.url);
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
        '<figure class="sp-work-page sp-handout-page"><img class="sp-work-img" src="' +
        esc(pages[i].url) +
        '" alt="' +
        esc(r.title + ', page ' + (i + 1)) +
        '"></figure>' +
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

  // A handout open in place of the cards, with the list on the left on a Chromebook.
  function handoutBody(ui, view, open) {
    var seg = segmentOf(open.piece) || ui.segment || 'todo';
    var pieces = inSegment(view, seg);
    return (
      '<div class="sp-fb-segments">' +
      segmentsHtml(Object.assign({}, ui, { segment: seg }), view) +
      '</div>' +
      '<div class="sp-split sp-split-feedback">' +
      sideHtml(pieces, open.piece) +
      handoutPaneHtml(ui, open) +
      '</div>'
    );
  }

  function cardHtml(p, picked) {
    var unseen = p.kind === 'back' && p.unseen && p.result && p.result.text;
    var todo = p.kind === 'due' || p.kind === 'missing';
    var tags = pills(p);
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
      '"><div class="sp-piece-card">' +
      headHtml(p) +
      '<h2 class="sp-piece-title" id="' +
      domId(p.id) +
      '" tabindex="-1">' +
      esc(p.title) +
      '</h2>' +
      (tags ? '<div class="sp-piece-tags">' + tags + '</div>' : '') +
      (todo && p.category
        ? '<p class="sp-piece-category"><span class="sp-category-pill">' + esc(p.category.name) + '</span></p>'
        : '') +
      (todo && p.description ? '<p class="sp-piece-about">' + esc(p.description) + '</p>' : '') +
      (todo ? resourcesHtml(p) : '') +
      (p.kind === 'due' ? planHtml(p) : '') +
      (p.kind === 'back' ? resultRows(p) + updatedNoteHtml(p) : '') +
      (p.kind === 'back' ? cardCommentHtml(p) : '') +
      (p.kind === 'sent' ? (p.group ? groupBlockHtml(p) : sentBlockHtml(p)) : '') +
      (todo ? gradedOnHtml(p) + coreHtml(p) + (p.group ? groupBlockHtml(p) : sendBlockHtml(p)) : '') +
      reviseBlockHtml(p, 'card') +
      (hasCompare(p)
        ? '<button type="button" class="sp-btn sp-btn-tint sp-btn-big" data-act="compare" data-piece="' +
          esc(p.id) +
          '">Before and After</button>'
        : '') +
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

  /* The cards of one of To Do, Sent and Back. On a phone they sit side by
     side and the student swipes between them ("1 of 3"); on a Chromebook
     the list is on the left and the card picked on the right (the
     Chromebook board). page-view.css shows one or the other. */
  function deckHtml(ui, pieces, view) {
    var picked = pieceIn(pieces, ui.pick);
    return (
      '<div class="sp-split">' +
      sideHtml(pieces, picked) +
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

  // The Chromebook's list on the left, the piece picked marked.
  function sideHtml(pieces, picked) {
    return (
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
    if (ui.whole) return p.rubric && segmentOf(p) ? p : null;
    if (ui.compare) return hasCompare(p) ? p : null;
    return hasFeedback(p) ? p : null;
  }

  // Under Your Result: the piece's category and what it counts, when the server sends it.
  function categoryHtml(p) {
    var line = categoryLine(p.category);
    return line ? '<p class="sp-fb-category">' + esc(line) + '</p>' : '';
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
        categoryHtml(p) +
        '</section>'
      );
    }
    var big = r.word || r.text;
    var beside = r.word ? r.text : '';
    var rows = (p.rubric ? p.rubric.rows : p.competencies || []).filter(function (row) {
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
      categoryHtml(p) +
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

  /* What the Levels Mean: open until the student closes it (ui.levels set
     means closed), above Your Rubric (the Your Feedback board). On a
     Chromebook it is always open, the four chips in a row (page-view.css). */
  function levelsHtml(view, ui) {
    var levels = view.levels || [];
    if (!levels.length) return '';
    var open = !ui.levels;
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

  function checksHtml(checks, mark) {
    return checks
      .map(function (k) {
        return '<span class="sp-fb-check">' + mark + '<span>' + esc(k.label) + '</span></span>';
      })
      .join('');
  }

  /* One criterion's card under Your Rubric. A Standard rubric: what the
     level given means here and what the next level up asks. An Advanced
     Rubric: the boxes ticked, and the next level's boxes still to show. A
     Single-Point Rubric: the goal, then Went Beyond or Work On. Then the
     teacher's comment on the criterion (on a Single-Point Rubric that is
     Work On). */
  function criterionHtml(style, row) {
    var parts = '';
    var lv = lvClass(row.level);
    if (style === 'single_point') {
      if (row.goal) parts += partHtml('plain sp-fb-goal', 'The Goal', wordsHtml(row.goal));
      if (row.beyond) parts += partHtml('blue', 'Went Beyond', wordsHtml(row.beyond));
      if (row.comment) parts += partHtml('amber', 'Work On', wordsHtml(row.comment));
    } else {
      if (style === 'advanced') {
        if (row.shown && row.shown.length) {
          parts += partHtml('plain sp-fb-lvt-' + lv, 'What You Showed', checksHtml(row.shown, TICKED));
        }
        if (row.next && row.next.checks.length) {
          parts += partHtml('amber', 'To Reach ' + row.next.name + ', Also Show', checksHtml(row.next.checks, NOT_YET));
        }
      } else {
        if (row.descriptor && row.levelName) {
          parts += partHtml(
            'plain sp-fb-lvt-' + lv,
            'What ' + row.levelName + ' Means Here',
            wordsHtml(row.descriptor),
          );
        }
        if (row.next && row.next.descriptor) {
          parts += partHtml('amber', 'To Reach ' + row.next.name, wordsHtml(row.next.descriptor), TO_ARROW);
        }
      }
      if (row.comment) parts += '<p class="sp-fb-note">' + esc(row.comment) + '</p>';
    }
    return (
      '<section class="sp-fb-card sp-fb-criterion"><div class="sp-fb-crit-head"><h3 class="sp-fb-crit-name">' +
      esc(row.name) +
      '</h3>' +
      (row.text ? chipHtml(row.text, row.level) : '') +
      '</div>' +
      (towardLine(row.toward) ? '<p class="sp-fb-toward">' + esc(towardLine(row.toward)) + '</p>' : '') +
      parts +
      '</section>'
    );
  }

  // The piece's class and when it came back: "Science 8 · Returned Nov 3".
  function feedbackSub(view, p) {
    var when = p.kind === 'back' ? 'Returned ' + fmtDate(p.returnedAt, DAY) : '';
    if (p.kind === 'revise' && p.revision) {
      when = p.revision.reviseBy ? 'Revise by ' + fmtDate(p.revision.reviseBy, DUE_DAY) : 'Needs Revision';
    }
    return [view.course && view.course.name, when].filter(Boolean).join(SEP);
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
        'Assignments',
        'feedback-close',
        p.title,
        feedbackSub(view, p),
        p.unseen ? p.id : '',
        'sp-fb-title',
      ) +
      reviseBlockHtml(p, 'fb') +
      seeWorkHtml(p) +
      '<div class="sp-fb-top' +
      (p.comment ? ' sp-fb-top-two' : '') +
      '">' +
      yourResultHtml(p) +
      fbCommentHtml(p) +
      '</div>' +
      (crits
        ? (withLevels ? levelsHtml(view, ui) : '') +
          '<h2 class="sp-fb-section">Your Rubric</h2>' +
          '<div class="sp-fb-crits">' +
          crits +
          '</div>' +
          (style !== 'single_point'
            ? '<button type="button" class="sp-btn sp-btn-tint sp-btn-big" data-act="whole" data-piece="' +
              esc(p.id) +
              '">See the Whole Rubric</button>'
            : '')
        : withLevels
          ? levelsHtml(view, ui)
          : '') +
      reflectButtonHtml(view, p) +
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
     Work row on Your Feedback ("2 pages · 3 notes on your work"). Only a
     returned piece whose `feedback` reply says the student was given marks
     has it (the view's piece.marks). The pages themselves are fetched by
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

  function seeWorkHtml(p) {
    if (!p.marks) return '';
    return (
      '<button type="button" class="sp-fb-card sp-fb-work" data-act="work" data-piece="' +
      esc(p.id) +
      '"><span class="sp-fb-work-words"><span class="sp-fb-work-title">See Your Work</span><span class="sp-fb-work-line">' +
      esc(marksLine(p.marks)) +
      '</span></span>' +
      NEXT_ARROW +
      '</button>'
    );
  }

  function workOpen(ui, p) {
    return !!(ui.work && p && ui.work === p.id && p.marks);
  }

  // Only a picture this page made or ships: a blob: address, or a drawn sample page.
  var PAGE_URL = /^(blob:|\/assets\/sample-work\/|\.\.\/assets\/sample-work\/)[^"'<>\s]*$/;

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

  function workPageHtml(view, ui, pages) {
    var n = pages.length;
    var i = Math.max(0, Math.min(n - 1, Number(ui.workPage) || 0));
    var page = pages[i];
    var showing = !ui.marksOff;
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
      '<div class="sp-work-bar">' +
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
      '<button type="button" class="sp-work-switch" role="switch" data-act="work-marks" aria-checked="' +
      (showing ? 'true' : 'false') +
      '"><span class="sp-work-track" aria-hidden="true"><span class="sp-work-knob"></span></span><span>Show Marks</span></button>' +
      '</div>'
    );
  }

  /* See Your Work: the way back to Your Feedback, the piece's title, which
     page this is, the page with the marks the student was given over it,
     Show Marks, and a way between the pages. */
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
      body = workPageHtml(view, ui, pages);
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

  /* Your Feedback, or The Whole Rubric, in place of the cards. On a
     Chromebook the list stays on the left, as on the board; on a phone the
     screen is the feedback alone. */
  function feedbackBody(ui, view, p) {
    var seg = segmentOf(p);
    var pieces = inSegment(view, seg);
    return (
      '<div class="sp-fb-segments">' +
      segmentsHtml(Object.assign({}, ui, { segment: seg }), view) +
      '</div>' +
      noResultsHtml(ui, view) +
      '<div class="sp-split sp-split-feedback">' +
      sideHtml(pieces, p) +
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
          ? deckHtml(ui, pieces, view)
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
  // Needs Revision (the All Assignments board's), shown while a piece of the class has a revision (S11-F2).
  var REVISE_FILTER = { id: 'revise', label: 'Needs Revision' };

  /* What Changed Since You Last Looked (the artboard's board): the pieces
     back or updated that the student has not opened since. */
  function changedIds(view) {
    var ids = {};
    (view.changes || []).forEach(function (c) {
      ids[c.id] = c.why;
    });
    return ids;
  }

  /* "3 Things Since You Last Looked", and a line saying what they are. The
     board's line named the teacher ("Mr. Brown answered your question…");
     the page never does (Colin's ruling 112). Answers and revisions come
     with S10 and S11. */
  function sinceHtml(view) {
    var changes = view.changes || [];
    if (!changes.length) return '';
    var back = changes.filter(function (c) {
      return c.why === 'back';
    }).length;
    var revise = changes.filter(function (c) {
      return c.why === 'revise';
    }).length;
    var updated = changes.length - back - revise;
    var bits = [];
    if (back) bits.push(back === 1 ? '1 piece came back' : back + ' pieces came back');
    if (updated) bits.push(updated === 1 ? '1 result was updated' : updated + ' results were updated');
    // The board's "…asked for 1 revision.", with no name (S11-F2).
    if (revise) bits.push('your teacher asked for ' + (revise === 1 ? '1 revision' : revise + ' revisions'));
    var line =
      (bits.length > 2 ? bits.slice(0, -1).join(', ') + ' and ' + bits[bits.length - 1] : bits.join(' and ')) + '.';
    return (
      '<div class="sp-since"><p class="sp-since-title">' +
      esc(changes.length === 1 ? '1 Thing Since You Last Looked' : changes.length + ' Things Since You Last Looked') +
      '</p><p class="sp-since-line">' +
      esc(line.charAt(0).toUpperCase() + line.slice(1)) +
      '</p></div>'
    );
  }

  // What the search words and the filter leave of the list. The words are matched against the title.
  function matching(view, ui) {
    var words = String(ui.search || '')
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    var filter = ui.filter || 'all';
    var changed = changedIds(view);
    return view.work.filter(function (p) {
      if (filter === 'new') {
        if (!changed[p.id]) return false;
      } else if (filter === 'revise') {
        if (p.kind !== 'revise') return false;
      } else if (filter !== 'all' && segmentOf(p) !== filter) return false;
      var title = String(p.title || '').toLowerCase();
      return words.every(function (w) {
        return title.indexOf(w) >= 0;
      });
    });
  }

  // Which of To Do, Sent and Back a piece is in, or '' (Excused).
  function segmentOf(p) {
    return p.kind === 'back'
      ? 'back'
      : p.kind === 'sent'
        ? 'sent'
        : p.kind === 'due' || p.kind === 'missing' || p.kind === 'revise'
          ? 'todo'
          : '';
  }

  var BACK_ARROW =
    '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M15 5l-7 7 7 7"/></svg>';
  var NEXT_ARROW =
    '<svg class="sp-row-go" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M9 6l6 6-6 6"/></svg>';

  /* One row of All Assignments. It opens the piece's card; Excused work has
     no card, so its row opens nothing. */
  function allRowHtml(p, why) {
    var by = p.revision && p.revision.reviseBy;
    var v = rowView(p);
    var inner =
      '<span class="sp-dot sp-dot-' +
      kindOf(p) +
      '" aria-hidden="true"></span><span class="sp-row-text"><span class="sp-row-title">' +
      esc(v.title) +
      '</span>' +
      (v.sub ? '<span class="sp-row-sub">' + esc(v.sub) + '</span>' : '') +
      // A piece back since the student last looked says so (the board's "Returned").
      (why === 'back' ? '<span class="sp-row-flags"><span class="sp-row-flag">Returned</span></span>' : '') +
      // A revision asked for since the student last looked (the board's "Revise by Nov 10").
      (why === 'revise' && by
        ? '<span class="sp-row-flags"><span class="sp-row-flag sp-row-flag-revise">' +
          esc('Revise by ' + fmtDate(by, DAY)) +
          '</span></span>'
        : '') +
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
    var changed = changedIds(view);
    var news = (view.changes || []).length;
    var revising = view.work.some(function (p) {
      return !!p.revision;
    });
    // New with nothing new (it was all opened) shows everything; so does Needs Revision with no revision.
    var filter = (ui.filter === 'new' && !news) || (ui.filter === 'revise' && !revising) ? 'all' : ui.filter || 'all';
    var shown = matching(view, Object.assign({}, ui, { filter: filter }));
    return (
      '<div class="sp-all-head"><button type="button" class="sp-head-icon" data-act="all-close" aria-label="Back to cards">' +
      BACK_ARROW +
      '</button><h1 class="sp-page-title" tabindex="-1">All Assignments</h1></div>' +
      '<label class="sp-hidden-title" for="sp-search">Search assignments</label>' +
      '<input id="sp-search" class="sp-search" type="search" placeholder="Search assignments" autocomplete="off" value="' +
      esc(ui.search || '') +
      '">' +
      '<div class="sp-filters" role="group" aria-label="Show">' +
      FILTERS.concat(news ? [{ id: 'new', label: 'New ' + news }] : [], revising ? [REVISE_FILTER] : [])
        .map(function (f) {
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
        })
        .join('') +
      '</div>' +
      noResultsHtml(ui, view) +
      sinceHtml(view) +
      (!view.work.length
        ? '<p class="sp-lead sp-empty">No assignments yet.</p>'
        : shown.length
          ? groupsOf(shown)
              .map(function (g) {
                return (
                  (g.head ? '<h2 class="sp-list-head">' + esc(g.head) + '</h2>' : '') +
                  '<ul class="sp-list">' +
                  g.rows
                    .map(function (p) {
                      return allRowHtml(p, changed[p.id]);
                    })
                    .join('') +
                  '</ul>'
                );
              })
              .join('')
          : '<p class="sp-lead sp-empty" role="status">Nothing matches.</p>')
    );
  }

  /* All Assignments' groups (the board's "This Week" and "Unit 1 ·
     Medieval Europe"): work still to hand in first, under This Week; then
     the rest under its unit, in the order the units come; work with no
     unit last, in a list of its own with no heading. With no unit and
     nothing to hand in, one list as before. */
  function groupsOf(rows) {
    var now = rows.filter(function (p) {
      return p.kind === 'due' || p.kind === 'missing';
    });
    var rest = rows.filter(function (p) {
      return p.kind !== 'due' && p.kind !== 'missing';
    });
    var units = [];
    var byUnit = {};
    var loose = [];
    rest.forEach(function (p) {
      var u = String(p.unit || '').trim();
      if (!u) return loose.push(p);
      if (!byUnit[u]) units.push((byUnit[u] = { head: u, rows: [] }));
      byUnit[u].rows.push(p);
    });
    var out = [];
    // A heading only says something when another group sits beside it.
    if (now.length) out.push({ head: rest.length ? 'This Week' : '', rows: now });
    return out.concat(units, loose.length ? [{ head: '', rows: loose }] : []);
  }

  /* The other three tabs. My Learning is a class switch, Show My Learning,
     that comes with S13 and is off until then. Questionnaires and Reports
     list what the view holds (S4-F4); with nothing there, each says so
     plainly. */
  var TAB_BODIES = {
    learning: { title: 'My Learning', line: 'Your teacher hasn’t turned on My Learning for this class.' },
    questionnaires: { title: 'Questionnaires', line: 'Questionnaires from your teacher will show here.' },
    reports: { title: 'My Reports', line: 'Reports from your teacher will show here.' },
  };

  /* ── Questionnaires and My Reports (the artboard's "Questionnaires Tab",
     "My Reports Tab", "Questions on a Chromebook" and "Reports on a
     Chromebook"). On a phone: what is open as a card, the rest as a list.
     On a Chromebook: the list on the left, the one picked on the right.
     Start and See Your Report are the student page's own presses
     (s/app.js); in the preview nothing answers them. ───────── */

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
  // A report's date and how long it stays open: "Nov 20 · Open until Nov 27".
  function reportWhen(r) {
    return [fmtDate(r.issued, DAY), r.until ? 'Open until ' + fmtDate(r.until, DAY) : ''].filter(Boolean).join(SEP);
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

  function questionnairesBody(view, ui) {
    var items = view.questionnaires;
    var open = items.filter(function (q) {
      return q.state === 'open';
    });
    var rest = items.filter(function (q) {
      return q.state !== 'open';
    });
    var picked = pieceIn(items, ui.form);
    return (
      '<h1 class="sp-page-title" tabindex="-1">Questionnaires</h1>' +
      '<div class="sp-split sp-forms">' +
      formSide(items, picked, formWhen, function (q) {
        return q.state === 'open' ? 'missing' : q.state === 'sent' ? 'back' : 'due';
      }) +
      '<div class="sp-forms-main"><div class="sp-forms-desk">' +
      formCard(view, picked, true) +
      '</div><div class="sp-forms-phone">' +
      open
        .map(function (q) {
          return formCard(view, q, false);
        })
        .join('') +
      (rest.length
        ? '<ul class="sp-list">' +
          rest
            .map(function (q) {
              return formRow(q, formWhen(q), q.state === 'sent' ? ['done', DONE_MARK] : ['soon', SOON_MARK], '');
            })
            .join('') +
          '</ul>'
        : '') +
      '</div></div></div>'
    );
  }

  /* One report as a card: its title (New until it is opened), when, the
     class with the report's result as the teacher sent it, the comment. */
  function reportCard(view, r) {
    var shown = r.result.word || r.result.text;
    return (
      '<section class="sp-form-card"><div class="sp-report-head"><h2 class="sp-form-title" tabindex="-1">' +
      esc(r.title) +
      '</h2>' +
      (r.isNew ? '<span class="sp-flag sp-flag-new">New</span>' : '') +
      '</div><p class="sp-form-sub">' +
      esc(reportWhen(r)) +
      '</p>' +
      (shown
        ? '<div class="sp-report-result"><span class="sp-report-class">' +
          esc((view.course && view.course.name) || '') +
          '</span>' +
          chipHtml(shown, r.result.level) +
          '</div>'
        : '') +
      (r.comment ? '<p class="sp-report-comment">' + esc(r.comment) + '</p>' : '') +
      '<button type="button" class="sp-btn sp-btn-tint sp-btn-big" data-act="r-open" data-form-id="' +
      esc(r.id) +
      '">See Your Report</button></section>'
    );
  }

  function reportsBody(view, ui) {
    var items = view.reports;
    var picked = pieceIn(items, ui.form);
    var line = function (r) {
      return [r.isNew ? 'New' : '', reportWhen(r)].filter(Boolean).join(SEP);
    };
    return (
      '<h1 class="sp-page-title" tabindex="-1">My Reports</h1>' +
      '<div class="sp-split sp-forms">' +
      formSide(items, picked, line, function (r) {
        return r.isNew ? 'new' : 'due';
      }) +
      '<div class="sp-forms-main"><div class="sp-forms-desk">' +
      reportCard(view, picked) +
      '</div><div class="sp-forms-phone">' +
      reportCard(view, items[0]) +
      (items.length > 1
        ? '<ul class="sp-list">' +
          items
            .slice(1)
            .map(function (r) {
              return formRow(r, fmtDate(r.issued, DAY), null, 'r-open');
            })
            .join('') +
          '</ul>'
        : '') +
      '</div></div></div>'
    );
  }

  /* ── My Learning (the artboard's "My Learning" boards for each grading
     style, "One Skill" with its First Piece and Top Step forms, "Nothing
     Marked Yet", "Skills Across Two Courses", "Points-Only Class" and "My
     Learning on a Chromebook"; S13-F2 and F3). Drawn only from
     view.learning, which shared/student-view.js builds from calc.js on
     returned work when the class shows My Learning. Every level, letter
     and % is the view's text. ───────────────────────────────── */

  var ML_ICON = {
    next: '<path d="M4 12h15M13 6l6 6-6 6"/>',
    star: '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z" fill="currentColor" stroke="none"/>',
    up: '<path d="M12 19V6M6.5 11.5L12 6l5.5 5.5"/>',
    down: '<path d="M12 5v13M6.5 12.5L12 18l5.5-5.5"/>',
    target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none"/>',
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

  /* A small four-bar picture of a level (the boards' skill rows): the bars
     up to it in its colour. Words say the level; the picture only repeats it. */
  function miniBarsHtml(level) {
    var at = lvClass(level);
    var out = '<span class="sp-ml-mini sp-ml-at-' + at + '" aria-hidden="true">';
    for (var i = 1; i <= 4; i++) out += '<i' + (i <= at ? ' class="sp-ml-mini-on"' : '') + '></i>';
    return out + '</span>';
  }

  // A skill's level as its row shows it: the little ladder and its word (or %) in a chip, or Not Yet.
  function skillLevelHtml(s) {
    if (!s.text) return '<span class="sp-ml-level sp-ml-none">Not Yet</span>';
    return '<span class="sp-ml-level">' + miniBarsHtml(s.level) + chipHtml(s.text, s.level) + '</span>';
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

  /* Next Step: the comment bank's step for the skill Generate would name,
     opening that skill. */
  function nextHtml(l) {
    var n = l.next;
    if (!n) return '';
    return (
      '<button type="button" class="sp-ml-card sp-ml-next" data-act="skill" data-skill="' +
      esc(n.id) +
      '">' +
      mlIcon('next', 20) +
      '<span class="sp-ml-next-text"><span class="sp-ml-next-title">' +
      esc('Next Step: ' + n.name) +
      '</span><span class="sp-ml-next-line">' +
      esc(n.text) +
      '</span></span>' +
      NEXT_ARROW +
      '</button>'
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
        '<section class="sp-ml-card sp-ml-overall sp-ml-overall-letter"><span class="sp-ml-letter sp-lv-' +
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
        '</span></section>'
      );
    }
    if (!o.word) return '';
    return (
      '<section class="sp-ml-card sp-ml-overall"><div class="sp-ml-overall-text"><p class="sp-ml-at"><span class="sp-ml-at-lead">You’re at</span>' +
      '<span class="sp-ml-at-word sp-ml-ink-' +
      lvClass(o.level) +
      '">' +
      esc(o.word) +
      '</span></p>' +
      trendHtml(l) +
      '</div>' +
      ladderHtml(l.steps, o.level, 'Step ' + o.level + ' of 4: ' + stepName(l, o.level), false) +
      '</section>'
    );
  }

  function strongestHtml(l) {
    var s = l.strongest;
    if (!s || l.mode === 'letter') return '';
    return (
      '<button type="button" class="sp-ml-card sp-ml-strongest" data-act="skill" data-skill="' +
      esc(s.id) +
      '">' +
      mlIcon('star', 18) +
      '<span class="sp-ml-next-text"><span class="sp-ml-strongest-title">Your Strongest</span><span class="sp-ml-strongest-line"><span class="sp-ml-strongest-name">' +
      esc(s.name) +
      '</span>' +
      (s.text ? chipHtml(s.text, s.level) : '') +
      '</span></span>' +
      NEXT_ARROW +
      '</button>'
    );
  }

  /* Missing work: each piece, oldest first, opening its card. A Letter or
     Both class counts Missing as 0 in the course %, so it says so; a
     Proficiency class leaves Missing work out of a level, so it does not. */
  function missingHtml(l) {
    var n = l.missing.length;
    if (!n) return '';
    var zero = l.mode !== 'proficiency';
    return (
      '<section class="sp-ml-card sp-ml-missing"><h2 class="sp-ml-card-title sp-ml-missing-title">' +
      esc(n + ' Missing') +
      '</h2>' +
      (zero
        ? '<p class="sp-ml-line">' +
          esc(n === 1 ? 'It counts as 0 until it’s in.' : 'Each counts as 0 until it’s in.') +
          '</p>'
        : '') +
      '<ul class="sp-ml-rows">' +
      l.missing
        .map(function (p) {
          return (
            '<li><button type="button" class="sp-ml-row" data-act="open-piece" data-piece="' +
            esc(p.id) +
            '"><span class="sp-row-text"><span class="sp-row-title">' +
            esc(p.title) +
            '</span>' +
            (p.dueDate ? '<span class="sp-row-sub">' + esc('Due ' + fmtDate(p.dueDate, DAY)) + '</span>' : '') +
            '</span>' +
            NEXT_ARROW +
            '</button></li>'
          );
        })
        .join('') +
      '</ul></section>'
    );
  }

  // What Makes Up Your Grade: each category, what it counts, the student's letter and %.
  function categoriesHtml(l) {
    if (!l.categories.length) return '';
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

  function skillRowHtml(s) {
    return (
      '<li><button type="button" class="sp-ml-row" data-act="skill" data-skill="' +
      esc(s.id) +
      '"><span class="sp-ml-skill-name">' +
      esc(s.name) +
      '</span>' +
      skillLevelHtml(s) +
      NEXT_ARROW +
      '</button></li>'
    );
  }

  /* Your Skills: in their folders (the first open), under each course's
     name when there are two. */
  function skillsHtml(l) {
    var firstFolder = true;
    var lastSubject = '';
    var body = l.groups
      .map(function (g) {
        var head = '';
        if (g.subject && g.subject !== lastSubject) {
          head = '<h3 class="sp-ml-subject">' + esc(g.subject) + '</h3>';
          lastSubject = g.subject;
        }
        var rows = '<ul class="sp-ml-rows">' + g.skills.map(skillRowHtml).join('') + '</ul>';
        if (!g.folder) return head + rows;
        var open = firstFolder;
        firstFolder = false;
        var n = g.skills.length;
        return (
          head +
          '<details class="sp-ml-folder"' +
          (open ? ' open' : '') +
          '><summary class="sp-ml-folder-head"><span class="sp-ml-folder-name">' +
          esc(g.folder) +
          '</span><span class="sp-ml-folder-count">' +
          esc(n + (n === 1 ? ' skill' : ' skills')) +
          '</span></summary>' +
          rows +
          '</details>'
        );
      })
      .join('');
    return (
      '<section class="sp-ml-card sp-ml-skills"><h2 class="sp-ml-card-title">Your Skills</h2>' + body + '</section>'
    );
  }

  /* Your Work: a list of pieces with what each got. A returned piece of the
     page (a points class: "31 / 40" and its %), or a skill's mark on a
     piece (One Skill: "Proficient +" and its code). */
  function workHtml(pieces) {
    if (!pieces.length) return '';
    return (
      '<section class="sp-ml-card"><h2 class="sp-ml-card-title">Your Work</h2><ul class="sp-ml-rows">' +
      pieces
        .map(function (p) {
          var r = p.result;
          var day = p.date || p.dueDate;
          var level = r
            ? r.kind === 'points'
              ? '<span class="sp-ml-word">' + esc(r.text) + '</span>' + chipHtml(r.percent, r.level)
              : chipHtml(r.text, r.level)
            : chipHtml(p.text, p.level);
          return (
            '<li class="sp-ml-row sp-ml-row-still"><span class="sp-row-text"><span class="sp-row-title">' +
            esc(p.title) +
            '</span>' +
            (day ? '<span class="sp-row-sub">' + esc(fmtDate(day, DAY)) + '</span>' : '') +
            '</span><span class="sp-ml-level">' +
            level +
            '</span></li>'
          );
        })
        .join('') +
      '</ul></section>'
    );
  }

  // Nothing Marked Yet.
  function nothingYetHtml() {
    return (
      '<div class="sp-ml-empty"><h1 class="sp-page-title" tabindex="-1">Nothing Marked Yet</h1>' +
      '<p class="sp-lead">Your learning shows here once your teacher marks your first piece of work.</p>' +
      '<button type="button" class="sp-btn sp-btn-tint sp-btn-pill" data-act="tab" data-tab="assignments">See Your Assignments</button></div>'
    );
  }

  function skillIn(l, id) {
    var found = null;
    l.groups.forEach(function (g) {
      g.skills.forEach(function (s) {
        if (!found && s.id === id) found = s;
      });
    });
    return found;
  }

  /* How It's Going: the last four pieces, oldest on the left, each placed
     at its mark (a + or − a third of a step), the four steps up the side.
     Shown from the second piece on. */
  var CHART = { w: 300, h: 128, left: 70 };
  function chartY(v) {
    return Math.round(8 + ((4 - Math.max(1, Math.min(4, Number(v) || 1))) / 3) * (CHART.h - 16));
  }
  function chartX(i, n) {
    return Math.round(CHART.left + 14 + (i * (CHART.w - CHART.left - 28)) / Math.max(1, n - 1));
  }
  var HOW_MANY = { 2: 'two', 3: 'three', 4: 'four' };
  function goingHtml(l, s) {
    var pts = s.pieces.slice(0, 4).reverse();
    if (pts.length < 2) return '';
    var label =
      'Your last ' +
      HOW_MANY[pts.length] +
      ' pieces: ' +
      pts
        .map(function (p) {
          return p.text;
        })
        .join(', ');
    var grid = l.steps
      .map(function (st) {
        var y = chartY(st.level);
        return (
          '<line x1="' +
          CHART.left +
          '" x2="' +
          CHART.w +
          '" y1="' +
          y +
          '" y2="' +
          y +
          '" class="sp-ml-grid"/><text x="0" y="' +
          (y + 4) +
          '" class="sp-ml-axis">' +
          esc(st.name) +
          '</text>'
        );
      })
      .join('');
    var path = pts
      .map(function (p, i) {
        return (i ? 'L' : 'M') + chartX(i, pts.length) + ' ' + chartY(p.value);
      })
      .join(' ');
    // Each dot in its own level's colour; the latest ringed.
    var last = pts.length - 1;
    var dots = pts
      .map(function (p, i) {
        var x = chartX(i, pts.length);
        var y = chartY(p.value);
        return (
          (i === last
            ? '<circle cx="' + x + '" cy="' + y + '" r="8.5" class="sp-ml-ring sp-ml-ring-' + lvClass(p.level) + '"/>'
            : '') +
          '<circle cx="' +
          x +
          '" cy="' +
          y +
          '" r="5" class="sp-ml-dot sp-ml-dot-' +
          lvClass(p.level) +
          '"/>'
        );
      })
      .join('');
    return (
      '<section class="sp-ml-card"><h2 class="sp-ml-card-title">How It’s Going</h2><svg class="sp-ml-chart" viewBox="0 0 ' +
      CHART.w +
      ' ' +
      CHART.h +
      '" role="img" aria-label="' +
      esc(label) +
      '">' +
      grid +
      '<path d="' +
      path +
      '" class="sp-ml-path sp-ml-path-' +
      lvClass(s.level) +
      '"/>' +
      dots +
      '</svg><div class="sp-ml-dates" aria-hidden="true">' +
      pts
        .map(function (p, i) {
          return '<span' + (i === last ? ' class="sp-ml-date-last"' : '') + '>' + esc(fmtDate(p.date, DAY)) + '</span>';
        })
        .join('') +
      '</div></section>'
    );
  }

  /* One Skill's Next Step (the comment bank's step for the level it shows),
     or at Extending "You've Reached the Top Step". */
  function skillNextHtml(l, s) {
    var n = s.next;
    if (n && n.top) {
      // The top step is a step of the ladder, so only where the ladder shows (not a Letter class).
      if (l.mode === 'letter') return '';
      return '<p class="sp-ml-card sp-ml-top">' + mlIcon('star', 18) + '<span>You’ve Reached the Top Step</span></p>';
    }
    if (!n || !n.text) return '';
    return (
      '<section class="sp-ml-card sp-ml-next sp-ml-next-still">' +
      mlIcon('next', 20) +
      '<span class="sp-ml-next-text"><h2 class="sp-ml-next-title">Next Step</h2><span class="sp-ml-next-line">' +
      esc(n.text) +
      '</span></span></section>'
    );
  }

  // One Skill: its I Can lines, the ladder (or its % in a Letter class), How It's Going, Your Work.
  function skillHtml(l, s) {
    var levels = l.mode !== 'letter';
    var where = '';
    if (levels && s.level) {
      where =
        '<section class="sp-ml-card">' +
        ladderHtml(l.steps, s.level, 'You are at ' + stepName(l, s.level) + ', step ' + s.level + ' of 4', true) +
        '</section>';
    } else if (s.text) {
      where = '<section class="sp-ml-card"><ul class="sp-ml-rows">' + skillRowHtml(s) + '</ul></section>';
    }
    return (
      '<div class="sp-ml sp-ml-one"><button type="button" class="sp-fb-back" data-act="skill-close">' +
      BACK_ARROW +
      'My Learning</button><h1 class="sp-page-title" id="sp-ml-skill-title" tabindex="-1">' +
      esc(s.name) +
      '</h1>' +
      (s.iCan.length
        ? '<ul class="sp-ml-card sp-ml-ican">' +
          s.iCan
            .map(function (t) {
              return '<li>' + mlIcon('target', 18) + '<span>' + esc(t) + '</span></li>';
            })
            .join('') +
          '</ul>'
        : '') +
      where +
      skillNextHtml(l, s) +
      (levels ? goingHtml(l, s) : '') +
      (s.pieces.length ? workHtml(s.pieces) : '<p class="sp-lead sp-empty">Nothing marked on this skill yet.</p>') +
      '</div>'
    );
  }

  function learningBody(view, ui) {
    var l = view.learning;
    if (l.empty) return nothingYetHtml();
    var s = ui.skill ? skillIn(l, ui.skill) : null;
    if (s) return skillHtml(l, s);
    var anySkill = l.groups.some(function (g) {
      return g.skills.some(function (k) {
        return !!k.text;
      });
    });
    // A Letter class whose work is marked by points alone shows its work, not its skills.
    var showWork = l.mode === 'letter' && !anySkill;
    /* The boards' order: the grade, Next Step, Your Strongest (three across
       on a Chromebook), What Makes Up Your Grade, Missing, the skills. A
       falling grade puts its Missing work straight under the grade. */
    var falling = !!(l.trend && l.trend.dir < 0);
    return (
      '<div class="sp-ml"><h1 class="sp-page-title sp-ml-title" tabindex="-1">My Learning</h1><div class="sp-ml-head">' +
      overallHtml(l) +
      (falling ? missingHtml(l) : '') +
      nextHtml(l) +
      strongestHtml(l) +
      '</div>' +
      // A Letter and Skills class leads with its skills, as its board does; a Letter class with its categories.
      (l.mode === 'letter' ? categoriesHtml(l) : '') +
      (falling ? '' : missingHtml(l)) +
      (showWork ? workHtml(l.work) : skillsHtml(l)) +
      '</div>'
    );
  }

  function bodyHtml(view, ui) {
    if (ui.waiting || !view) return '<p class="sp-lead sp-empty" role="status">' + esc(WAITING) + '</p>';
    var tab = TAB_BODIES[ui.tab] ? ui.tab : 'assignments';
    if (tab === 'questionnaires' && (view.questionnaires || []).length) return questionnairesBody(view, ui);
    if (tab === 'reports' && (view.reports || []).length) return reportsBody(view, ui);
    if (tab === 'learning' && view.learning) return learningBody(view, ui);
    if (tab !== 'assignments') {
      return (
        '<h1 class="sp-page-title" tabindex="-1">' +
        esc(TAB_BODIES[tab].title) +
        '</h1><p class="sp-lead sp-empty">' +
        esc(TAB_BODIES[tab].line) +
        '</p>'
      );
    }
    if (ui.all) return allBody(ui, view);
    var ho = handoutOpen(view, ui);
    if (ho) return handoutBody(ui, view, ho);
    var fb = feedbackPiece(view, ui);
    return fb ? feedbackBody(ui, view, fb) : assignmentsBody(ui, view);
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
  function tabBarHtml(ui, where, view) {
    var on = TAB_BODIES[ui.tab] ? ui.tab : 'assignments';
    // What changed since the student last looked, as a count on Assignments (the board's red badge).
    var news = view && !ui.waiting ? (view.changes || []).length : 0;
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
          '</svg>' +
          (t.id === 'assignments' && news ? '<span class="sp-tab-badge" aria-hidden="true">' + news + '</span>' : '') +
          '<span class="sp-tab-label">' +
          esc(t.label) +
          '</span>' +
          (t.id === 'assignments' && news ? '<span class="sp-hidden-title">' + esc(news + ' new') + '</span>' : '') +
          '</button>'
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
    var onAssignments = (TAB_BODIES[ui.tab] ? ui.tab : 'assignments') === 'assignments';
    var all = !!ui.all && onAssignments;
    var fb = onAssignments && !all && !ui.waiting && (handoutOpen(view, ui) || feedbackPiece(view, ui));
    return (
      '<div class="sp-view' +
      (fb ? ' sp-on-feedback' : '') +
      // The cards or Your Feedback, with To Do, Sent and Back: on a Chromebook, a sidebar down the left (page-view.css).
      (onAssignments && !all && !ui.waiting && view ? ' sp-on-deck' : '') +
      '">' +
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
      tabBarHtml(ui, 'top', view) +
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
      tabBarHtml(ui, 'bottom', view) +
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
  var FILTER_IDS = { all: 1, todo: 1, sent: 1, back: 1, new: 1, revise: 1 };
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
    // Any other press leaves Your Feedback and The Whole Rubric.
    if (!has(FEEDBACK_ACTS, act)) {
      next.feedback = '';
      next.whole = false;
    }
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
    if (act === 'handout') {
      var hp = view && pieceIn(view.work, attr('data-piece'));
      var hid = attr('data-resource');
      if (!hp || hp.id !== attr('data-piece')) return null;
      var hr = (hp.resources || []).filter(function (x) {
        return x && x.kind === 'handout' && x.id === hid;
      })[0];
      if (!hr) return null;
      next.tab = 'assignments';
      next.all = false;
      next.feedback = '';
      next.whole = false;
      next.segment = segmentOf(hp) || next.segment;
      next.pick = hp.id;
      next.handout = hr.id;
      next.handoutPiece = hp.id;
      next.handoutPage = 0;
      // Pages fetched for another handout are not this one's.
      if (next.handoutPages && next.handoutPages.id !== hr.id) next.handoutPages = null;
      return { ui: next, focus: '#sp-handout-title', handout: { piece: hp.id, resource: hr.id } };
    }
    if (act === 'handout-close') {
      var was2 = { piece: next.handoutPiece, resource: next.handout };
      next.handout = '';
      next.handoutPiece = '';
      next.handoutPage = 0;
      return {
        ui: next,
        focus: was2.resource ? '[data-act="handout"][data-resource="' + cssId(was2.resource) + '"]' : '.sp-segment-on',
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
      if (!w || w.id !== wid || !w.marks || !hasFeedback(w)) return null;
      next.tab = 'assignments';
      next.all = false;
      next.feedback = w.id;
      next.whole = false;
      next.segment = segmentOf(w);
      next.pick = w.id;
      next.work = w.id;
      next.workPage = 0;
      next.marksOff = false;
      // Pages fetched for another piece are not this one's.
      if (next.workPages && next.workPages.id !== w.id) next.workPages = null;
      return { ui: next, focus: '#sp-work-title', work: w.id };
    }
    if (act === 'work-close') {
      next.work = '';
      next.workPage = 0;
      next.marksOff = false;
      return { ui: next, focus: '[data-act="work"]' };
    }
    if (act === 'work-page' || act === 'work-marks') {
      var on = view && next.work ? pieceIn(view.work, next.work) : null;
      if (!on || on.id !== next.work || !on.marks) return null;
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
    if (act === 'skill') {
      var l = view && view.learning;
      var sk = l && skillIn(l, attr('data-skill'));
      if (!sk) return null;
      next.tab = 'learning';
      next.skill = sk.id;
      return { ui: next, focus: '#sp-ml-skill-title' };
    }
    if (act === 'skill-close') {
      var was = next.skill;
      next.skill = '';
      return { ui: next, focus: was ? '[data-act="skill"][data-skill="' + cssId(was) + '"]' : '.sp-ml-title' };
    }
    if (act === 'tab') {
      if (!has(TAB_IDS, attr('data-tab'))) return null;
      next.tab = attr('data-tab');
      next.all = false;
      next.form = '';
      next.skill = '';
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
    if (act === 'compare') {
      var bid = attr('data-piece');
      var c = view && pieceIn(view.work, bid);
      if (!c || c.id !== bid || !hasCompare(c)) return null;
      next.tab = 'assignments';
      next.all = false;
      next.feedback = c.id;
      next.whole = false;
      next.compare = true;
      next.segment = segmentOf(c);
      next.pick = c.id;
      return { ui: next, focus: '#sp-fb-title' };
    }
    if (act === 'feedback' || act === 'whole') {
      var fid = attr('data-piece');
      var f = view && pieceIn(view.work, fid);
      if (!f || f.id !== fid) return null;
      next.feedback = f.id;
      next.whole = act === 'whole';
      if (!feedbackPiece(view, next)) return null;
      next.tab = 'assignments';
      next.all = false;
      next.segment = segmentOf(f);
      next.pick = f.id;
      return { ui: next, focus: '#sp-fb-title' };
    }
    if (act === 'feedback-close' || act === 'whole-close') {
      var open = view && feedbackPiece(view, next);
      next.whole = false;
      // From The Whole Rubric back to Your Feedback, when the piece has some; otherwise to its card.
      if (act === 'whole-close' && open && hasFeedback(open)) return { ui: next, focus: '#sp-fb-title' };
      next.feedback = '';
      return { ui: next, focus: open ? '#' + domId(open.id) : '.sp-segment-on' };
    }
    if (act === 'form-pick') {
      var list = view ? (next.tab === 'reports' ? view.reports : view.questionnaires) || [] : [];
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
    photosWord: photosWord,
    thumbsHtml: thumbsHtml,
    marksLine: marksLine,
    planHtml: planHtml,
  };
})();
