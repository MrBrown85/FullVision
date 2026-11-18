// @ts-check
/* ── add-work-class.js — Add Work for the Class (B1, B3) ─────────────────
   One page, on a computer, where a teacher puts paper work (photos or
   PDFs) on every student of one assessment, then adds it all with one
   button. Nothing is saved until Add Work is pressed
   (docs/plans/add-work-for-class-plan.md, DECISIONS "Add Work for the
   Class (2026-11-17)").

   This file is the screen: a page over the Assignments page (or the Work
   Wall), like the Work Wall, in Column or Grid. Beside it:
   - teacher/add-work-stage.js (AddWorkStage.stage, AddWorkStage.run): the
     staging model and the run, with no DOM. For each student, the pages
     waiting, in pieces (a piece is one file's pages, in order), where each
     came from (for the screen only), the choice for a student who already
     has work, and On Paper.
   - teacher/add-work-tray.js (AddWorkTray): files dropped off a student,
     or chosen from the tray, matched to students by name
     (shared/name-match.js), and the Waiting for a Student tray (B3).
   - teacher/add-work-split.js (AddWorkSplit, B2, when it is there): Split
     the Scan, over this page; its pieces come back through placePieces.

   File names never leave this computer: every page is renamed page-1.jpg,
   page-2.jpg and so on before the model keeps it, so no file name reaches
   the photo queue (shared/photo-queue.js keeps `name` until a page is up).

   Each student is one write, one after another, through the calls that
   exist (addStudentWorkPages, replaceStudentWorkPages, then one
   markStudentWorkOnPaper for the On Paper students). Nothing here sets
   Missing, Late, a level or a score. Upload trouble after a write is
   answered `sent` shows only on the sync dot.

   AddWorkClass.open(cid, aid, opts)  the page; false when it isn't offered.
                                      opts.onClose() once it has closed.
   AddWorkClass.close()               closes at once (no asking).
   AddWorkClass.isOpen()
   AddWorkClass.offered(cid, a)       whether the piece offers it: in every
                                      class, on a piece not a draft and not
                                      DIBELS-scored.
   AddWorkClass.students(cid, a)      the students it lists, in roster order.
   AddWorkClass.placePieces(pieces)   [{ sid, from, pages }] onto their
                                      students, drawn once; any that can't be
                                      placed wait in the tray. → { placed, waiting }. */
/** @type {any} */ (window).AddWorkClass = (function () {
  'use strict';

  var LAYOUT_KEY = 'fv-add-work-class-layout';
  var GLIDE_MS = 200;
  // The grader's Add Work takes these (_attachMenuHtml, grader.js).
  var ACCEPT = 'image/*,.heic,.heif,application/pdf';

  /* Where each piece goes: one target per class and assessment, each with
     its own staging model (teacher/add-work-targets.js, B6). s.stage is the
     set of targets, answering the staging model's own calls. One pile, two
     classes and a late paper's assessment are drawn by
     teacher/add-work-two-classes.js (AddWorkTwoClasses) when it is there. */
  function _two() {
    return /** @type {any} */ (window).AddWorkTwoClasses || null;
  }
  // What the two-classes screen may use of this page.
  var _ctx = {
    state: function () {
      return _s;
    },
    draw: function (o) {
      if (_s) _draw(o);
    },
    release: function (pieces) {
      if (_s) _release(_s, pieces);
    },
    read: _read,
    students: students,
    offered: offered,
    full: function (s, sid) {
      return _full(s, sid);
    },
  };

  function _say(res) {
    return window.AddWorkFiles ? AddWorkFiles.answer(res) : "The photos couldn't be kept. Try again.";
  }

  /* ── Who is listed ─────────────────────────────────────────── */
  function _piece(cid, aid) {
    return (
      (getAssessments(cid) || []).find(function (a) {
        return a && a.id === aid;
      }) || null
    );
  }

  /* The students, in roster order (the Assignments page's), as the row's +
     is offered: every student but those graded together in a pair or a
     group (their row has no +). Withdrawn students are not in the roster. */
  function students(cid, a) {
    var list = sortStudents(getStudents(cid) || [], 'lastName');
    var ids = list.map(function (st) {
      return st.id;
    });
    var units = typeof groupGradingUnits === 'function' ? groupGradingUnits(cid, a, ids) : null;
    if (!units) return list;
    var together = {};
    units.forEach(function (u) {
      (u.linked || []).forEach(function (sid) {
        together[sid] = true;
      });
    });
    return list.filter(function (st) {
      return !together[st.id];
    });
  }

  /* Offered in every class (plan decision 2, Colin, Nov 17 2026): on every
     piece that is not a draft and not DIBELS-scored, student page and Send
     Work on or off. The third argument (once "shown") is no longer read. */
  function offered(cid, a) {
    if (!cid || !a || a.isDraft) return false;
    if (typeof isDibelsScored === 'function' && isDibelsScored(a)) return false;
    // Only a pair or group piece can leave nobody to list; a card's menu draws this for every piece.
    if (a.collaboration !== 'pair' && a.collaboration !== 'group') return true;
    return students(cid, a).length > 0;
  }

  function _had(sub) {
    if (!sub) return 'none';
    return sub.on_paper ? 'paper' : 'work';
  }

  function _day(iso) {
    if (!iso) return '';
    var d = new Date(String(iso).length <= 10 ? iso + 'T00:00:00' : iso);
    return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
  }

  // "Nothing in", "2 photos, Oct 30", "Handed in on paper".
  function _alreadyText(sub) {
    if (!sub) return 'Nothing in';
    if (sub.on_paper) return 'Handed in on paper';
    var n = (sub.files || []).length;
    var links = (sub.links || []).length;
    var what = n
      ? n + (n === 1 ? ' photo' : ' photos')
      : links
        ? links + (links === 1 ? ' link' : ' links')
        : 'Handed in';
    var day = _day(sub.sent_at || sub.created_at);
    return what + (day ? ', ' + day : '');
  }

  /* ── The screen ──────────────────────────────────────────────── */
  /** @type {any} */
  var _s = null; // the open page's state

  function _layout() {
    try {
      return localStorage.getItem(LAYOUT_KEY) === 'grid' ? 'grid' : 'column';
    } catch (e) {
      return 'column';
    }
  }
  function _keepLayout(v) {
    try {
      localStorage.setItem(LAYOUT_KEY, v);
    } catch (e) {
      /* a remembered layout is only a convenience */
    }
  }

  function _student(s, sid) {
    return s.byId[sid] || null;
  }
  function _first(s, sid) {
    var st = _student(s, sid);
    return st ? displayNameFirst(st) || displayNameWithLast(st) : '';
  }
  function _full(s, sid) {
    var st = _student(s, sid);
    return st ? displayNameWithLast(st) : '';
  }

  function _plural(n, one, many) {
    return n + ' ' + (n === 1 ? one : many);
  }

  var CHOICE_WORDS = { add: 'Add as More Pages', replace: 'Replace Them' };

  /* ── Drawing ── */
  var X_ICON =
    '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg>';
  var BACK_ICON =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"></path></svg>';
  var COLUMN_ICON =
    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"></path></svg>';
  var GRID_ICON =
    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"></rect><rect x="14" y="3" width="7" height="7" rx="1"></rect><rect x="3" y="14" width="7" height="7" rx="1"></rect><rect x="14" y="14" width="7" height="7" rx="1"></rect></svg>';

  // html-safe: every name, file name and word goes through esc; ids are ours (esc too); icons are fixed
  function _pageHtml(s) {
    var c = s.stage.counts();
    var course = (typeof COURSES !== 'undefined' && COURSES[s.cid]) || {};
    var busy = !!s.busy;
    var reading = _readingAny(s);
    var off = busy ? ' disabled' : '';
    var done = s.view === 'done';
    var classes = s.stage.classes();
    var sub = [
      s.a.title || '',
      classes.length > 1
        ? classes
            .map(function (t) {
              return t.name;
            })
            .join(' and ')
        : course.name || '',
      _plural(s.stage.rows().length, 'student', 'students'),
    ]
      .filter(Boolean)
      .join(' · ');
    var html =
      '<div class="awc-page" role="dialog" aria-modal="true" aria-labelledby="awc-title">' +
      '<div class="awc-bar">' +
      '<button type="button" class="awc-back" data-awc="leave" data-key="back" aria-label="Back to Assignments"' +
      off +
      '>' +
      BACK_ICON +
      '</button>' +
      '<div class="awc-titles"><h2 class="awc-title" id="awc-title">Add Work for the Class</h2>' +
      '<span class="awc-sub">' +
      esc(sub) +
      '</span></div>' +
      '<p class="awc-note" role="status">' +
      esc(s.headNote || '') +
      '</p>' +
      '<span class="awc-gap"></span>';
    if (done) {
      html +=
        _gradeButtons(s) +
        '<button type="button" class="awc-primary" data-awc="done" data-key="done">Done</button></div>' +
        _doneHtml(s) +
        '</div>';
      return html;
    }
    html +=
      '<span class="awc-label" id="awc-layout-label">Layout</span>' +
      '<div class="awc-seg" role="group" aria-labelledby="awc-layout-label">' +
      _segBtn('column', 'Column', COLUMN_ICON, s.layout === 'column') +
      _segBtn('grid', 'Grid', GRID_ICON, s.layout === 'grid') +
      '</div>' +
      '<button type="button" class="awc-cancel" data-awc="leave" data-key="cancel"' +
      off +
      '>Cancel</button>' +
      '<button type="button" class="awc-primary" data-awc="run" data-key="run"' +
      (busy || reading || !c.ready ? ' disabled' : '') +
      '>' +
      esc(
        busy
          ? s.progress || 'Adding…'
          : reading
            ? (s.twoState && s.twoState.reading ? 'Reading ' + s.twoState.reading + '…' : '') ||
              (s.tray && s.tray.progress()) ||
              'Reading Files…'
            : s.stage.buttonLabel(),
      ) +
      '</button>' +
      '</div>' +
      '<div class="awc-body is-' +
      esc(s.layout) +
      '" data-keep-scroll="awc-body">' +
      (s.layout === 'grid' ? '' : s.tray.html()) +
      '<div class="awc-scroll" data-keep-scroll="awc-scroll">' +
      (_two() ? AddWorkTwoClasses.barHtml(s, _ctx) : '') +
      (s.layout === 'grid' ? s.tray.html() + _gridHtml(s) : _columnHtml(s)) +
      '</div></div>' +
      '<div class="awc-foot">' +
      '<span class="awc-count">' +
      esc(_footer(s)) +
      '</span>' +
      '<span class="awc-hint">Nothing is added until you press Add Work.</span>' +
      '</div></div>';
    return html;
  }

  // Whether any file is still being read (shrunk) for any student.
  function _readingAny(s) {
    if (s.tray && s.tray.reading()) return true;
    // The other class being read (B6): Add Work waits for it too.
    if (s.twoState && s.twoState.reading) return true;
    return Object.keys(s.reading).some(function (sid) {
      return s.reading[sid] > 0;
    });
  }

  // "N ready to add · 3 files waiting · …": the tray's count after the ready students.
  function _footer(s) {
    var parts = s.stage.footerText() ? s.stage.footerText().split(' · ') : [];
    var waiting = s.tray ? s.tray.count() : 0;
    if (waiting) parts.splice(s.stage.counts().ready ? 1 : 0, 0, _plural(waiting, 'file', 'files') + ' waiting');
    return parts.join(' · ');
  }

  function _segBtn(id, label, icon, on) {
    return (
      '<button type="button" class="awc-seg-btn' +
      (on ? ' is-on' : '') +
      '" data-awc="layout" data-layout="' +
      id +
      '" data-key="layout:' +
      id +
      '" aria-pressed="' +
      on +
      '">' +
      icon +
      esc(label) +
      '</button>'
    );
  }

  // html-safe: names go through esc; ids are ours (esc too)
  function _columnHtml(s) {
    return (
      '<div class="awc-table" role="table" aria-label="Students">' +
      '<div class="awc-head" role="row"><span role="columnheader">Student</span><span role="columnheader">Work to Add</span><span role="columnheader">Already In</span></div>' +
      s.stage
        .rows()
        .map(function (r) {
          return (
            (_two() ? AddWorkTwoClasses.heading(s, r.sid, 'row') : '') +
            '<div class="awc-row' +
            (r.pieces.length ? ' has-work' : '') +
            '" role="row" data-awc-target="' +
            esc(r.sid) +
            '">' +
            '<span class="awc-name" role="cell">' +
            esc(_full(s, r.sid)) +
            '</span>' +
            '<div class="awc-work" role="cell">' +
            _workHtml(s, r, false) +
            '</div>' +
            '<div class="awc-in" role="cell">' +
            _alreadyHtml(s, r) +
            '</div></div>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  // html-safe: names go through esc; ids are ours (esc too)
  function _gridHtml(s) {
    return (
      '<div class="awc-grid" role="list" aria-label="Students">' +
      s.stage
        .rows()
        .map(function (r) {
          var first = r.pieces[0];
          var url = first && s.urls[first.id];
          return (
            (_two() ? AddWorkTwoClasses.heading(s, r.sid, 'card') : '') +
            '<div class="awc-card' +
            (r.pieces.length ? ' has-work' : '') +
            '" role="listitem" data-awc-target="' +
            esc(r.sid) +
            '">' +
            (first
              ? '<div class="awc-card-pic">' +
                (url ? '<img src="' + esc(url) + '" alt="' + esc(_first(s, r.sid) + '’s first page') + '">' : '') +
                '</div>'
              : '') +
            '<span class="awc-name">' +
            esc(_full(s, r.sid)) +
            '</span>' +
            '<div class="awc-work">' +
            _workHtml(s, r, true) +
            '</div>' +
            '<div class="awc-in">' +
            _alreadyHtml(s, r) +
            '</div></div>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  // The file chooser for one student, hidden; the drop space opens it.
  function _fileInput(sid) {
    return (
      '<input type="file" class="awc-file" multiple accept="' +
      ACCEPT +
      '" hidden tabindex="-1" aria-hidden="true" data-sid="' +
      esc(sid) +
      '">'
    );
  }

  // html-safe: names and file names go through esc; ids are ours (esc too); icons are fixed
  function _workHtml(s, r, grid) {
    var sid = r.sid;
    var off = s.busy ? ' disabled' : '';
    var first = _first(s, sid);
    var reading = s.reading[sid] || 0;
    var html = '';
    r.pieces.forEach(function (piece) {
      var url = s.urls[piece.id];
      var menu = s.moveMenu && s.moveMenu.pid === piece.id;
      html +=
        '<div class="awc-chip" draggable="' +
        (s.busy ? 'false' : 'true') +
        '" data-piece="' +
        esc(piece.id) +
        '" data-sid="' +
        esc(sid) +
        '">' +
        (grid || !url ? '' : '<span class="awc-thumb"><img src="' + esc(url) + '" alt=""></span>') +
        '<span class="awc-file-name">' +
        esc(piece.from || 'File') +
        '</span>' +
        '<span class="awc-pages">' +
        esc(_plural(piece.pages.length, 'page', 'pages')) +
        '</span>' +
        (_two() ? AddWorkTwoClasses.forHtml(s, sid, piece, _ctx) : '') +
        '<span class="awc-move-wrap">' +
        '<button type="button" class="awc-move" data-awc="moveMenu" data-sid="' +
        esc(sid) +
        '" data-piece="' +
        esc(piece.id) +
        '" data-key="move:' +
        esc(piece.id) +
        '" aria-haspopup="menu" aria-expanded="' +
        menu +
        '"' +
        off +
        '>Move to…</button>' +
        (menu ? _moveMenuHtml(s, sid, piece.id) : '') +
        '</span>' +
        '<button type="button" class="awc-off" data-awc="off" data-sid="' +
        esc(sid) +
        '" data-piece="' +
        esc(piece.id) +
        '" data-key="off:' +
        esc(piece.id) +
        '" aria-label="Take this file off" title="Take this file off"' +
        off +
        '>' +
        X_ICON +
        '</button></div>';
    });
    // A late paper's pieces: on this row, each for its own assessment.
    if (_two()) html += AddWorkTwoClasses.lateHtml(s, sid, _ctx);
    if (reading) html += '<span class="awc-reading" role="status">Reading…</span>';
    var empty = !r.pieces.length && !reading;
    if (r.onPaper && empty) {
      html += '<span class="awc-paper-set">Handed in on paper when you press Add Work</span>';
    } else {
      html +=
        '<button type="button" class="awc-drop' +
        (empty ? '' : ' is-more') +
        '" data-awc="choose" data-sid="' +
        esc(sid) +
        '" data-key="drop:' +
        esc(sid) +
        '" data-idle="' +
        esc(empty ? 'Drop here, or click to choose' : 'Add More…') +
        '" data-over="' +
        esc('Drop to Add for ' + first) +
        '" data-move="' +
        esc('Drop to Move to ' + first) +
        '" aria-label="' +
        esc((empty ? 'Choose files for ' : 'Add more files for ') + first) +
        '"' +
        off +
        '>' +
        esc(empty ? 'Drop here, or click to choose' : 'Add More…') +
        '</button>';
    }
    html += _fileInput(sid);
    if (r.had === 'none' && empty)
      html +=
        '<button type="button" class="awc-paper' +
        (r.onPaper ? ' is-on' : '') +
        '" data-awc="paper" data-sid="' +
        esc(sid) +
        '" data-key="paper:' +
        esc(sid) +
        '" aria-pressed="' +
        r.onPaper +
        '"' +
        off +
        '>On Paper</button>';
    if (r.note) html += '<p class="awc-row-note" role="status">' + esc(r.note) + '</p>';
    return html;
  }

  // html-safe: names go through esc; ids are ours (esc too)
  function _moveMenuHtml(s, sid, pid) {
    return (
      '<span class="awc-move-menu" role="menu" aria-label="Move to">' +
      s.stage
        .rows()
        .filter(function (r) {
          return r.sid !== sid;
        })
        .map(function (r) {
          return (
            '<button type="button" role="menuitem" class="awc-move-item" data-awc="moveTo" data-sid="' +
            esc(sid) +
            '" data-piece="' +
            esc(pid) +
            '" data-to="' +
            esc(r.sid) +
            '">' +
            esc(_full(s, r.sid) + (_two() ? AddWorkTwoClasses.label(s, r.sid) : '')) +
            '</button>'
          );
        })
        .join('') +
      '</span>'
    );
  }

  // html-safe: names go through esc; ids are ours (esc too); words are fixed
  function _alreadyHtml(s, r) {
    var off = s.busy ? ' disabled' : '';
    var text = esc(_alreadyText(s.subs[r.sid] || null));
    if (!r.pieces.length || r.had === 'none') return '<span class="awc-had">' + text + '</span>';
    var first = _first(s, r.sid);
    var btn = function (choice, label) {
      var on = r.choice === choice;
      return (
        '<button type="button" class="awc-choice' +
        (on ? ' is-on' : '') +
        '" data-awc="choice" data-choice="' +
        choice +
        '" data-sid="' +
        esc(r.sid) +
        '" data-key="choice:' +
        esc(r.sid) +
        ':' +
        choice +
        '" aria-pressed="' +
        on +
        '"' +
        off +
        '>' +
        esc(label) +
        '</button>'
      );
    };
    var html =
      '<span class="awc-had">' +
      text +
      '</span>' +
      '<div class="awc-choices" role="group" aria-label="' +
      esc('What to do for ' + first) +
      '">' +
      s.stage
        .choices(r.sid)
        .map(function (choice) {
          return btn(choice, choice === 'skip' ? 'Skip ' + first : CHOICE_WORDS[choice]);
        })
        .join('') +
      '</div>';
    // Replace Them deletes the photos that are in (replaceStudentWorkPages).
    if (r.choice === 'replace' && r.had === 'work' && ((s.subs[r.sid] || {}).files || []).length)
      html += '<p class="awc-warn">Deleted photos can’t come back.</p>';
    return html;
  }

  // "1 set to Handed in on paper"
  function _paperLine(n) {
    return n + ' set to Handed in on paper';
  }

  // html-safe: names go through esc; ids are ours (esc too); words are fixed
  function _doneHtml(s) {
    var added = s.added;
    var paper = s.paperSet;
    var students = function (n) {
      return n + (n === 1 ? ' Student' : ' Students');
    };
    // Only students whose pages went in count as Added Work; On Paper says so on its own.
    var title =
      added || !paper ? 'Added Work for ' + students(added) : 'Set ' + students(paper) + ' to Handed In on Paper';
    var html =
      '<div class="awc-scroll awc-done">' +
      '<h3 class="awc-done-title">' +
      esc(title) +
      '</h3>' +
      (added && paper ? '<p class="awc-done-paper">' + esc(_paperLine(paper)) + '</p>' : '');
    var still = s.stillNotIn.filter(function (sid) {
      return !s.leftAlone[sid];
    });
    if (still.length) {
      html +=
        '<h4 class="awc-done-sub">' +
        esc('Still Not In (' + still.length + ')') +
        '</h4><ul class="awc-done-list">' +
        still
          .map(function (sid) {
            var paper = s.paperDone[sid];
            return (
              '<li class="awc-done-row"><span class="awc-name">' +
              esc(_full(s, sid)) +
              '</span>' +
              (_two() ? AddWorkTwoClasses.classTag(s, sid) : '') +
              (paper
                ? '<span class="awc-had">' + esc(paper === true ? 'Handed in on paper' : paper) + '</span>'
                : '<button type="button" class="awc-paper" data-awc="paperNow" data-sid="' +
                  esc(sid) +
                  '" data-key="paperNow:' +
                  esc(sid) +
                  '">On Paper</button>' +
                  '<button type="button" class="awc-leave-in" data-awc="leaveNotIn" data-sid="' +
                  esc(sid) +
                  '" data-key="leaveNotIn:' +
                  esc(sid) +
                  '">Leave Not In</button>') +
              '</li>'
            );
          })
          .join('') +
        '</ul>';
    }
    return html + '</div>';
  }

  /* Draw the page again: scroll, focus (by data-key) and, for a moved
     piece, a glide from where it was. */
  function _draw(opts) {
    var s = _s;
    if (!s) return;
    opts = opts || {};
    // Every scroll on the page (the students, the tray) stays where it was.
    var tops = {};
    Array.prototype.forEach.call(s.overlay.querySelectorAll('[data-keep-scroll]'), function (el) {
      tops[el.getAttribute('data-keep-scroll')] = el.scrollTop;
    });
    var active = document.activeElement;
    var key = opts.focus || (active && s.overlay.contains(active) ? active.getAttribute('data-key') : null);
    var before = Object.assign({}, opts.glideFrom || {});
    (opts.glide || []).forEach(function (pid) {
      var el = s.overlay.querySelector('.awc-chip[data-piece="' + pid + '"]');
      if (el && el.getBoundingClientRect) before[pid] = el.getBoundingClientRect();
    });
    // html-safe: _pageHtml escapes every name, file name and word; the rest is fixed markup
    s.overlay.innerHTML = _pageHtml(s);
    // The chip being dragged is gone: its drag can no longer end, so it is let go.
    if (s.drag && !(s.drag.el && s.drag.el.isConnected)) s.drag = null;
    Array.prototype.forEach.call(s.overlay.querySelectorAll('[data-keep-scroll]'), function (el) {
      var top = tops[el.getAttribute('data-keep-scroll')];
      if (top) el.scrollTop = top;
    });
    if (key) {
      var el = s.overlay.querySelector('[data-key="' + key + '"]');
      if (!el || el.disabled) el = opts.fallback ? s.overlay.querySelector('[data-key="' + opts.fallback + '"]') : null;
      if (el && !el.disabled) el.focus({ preventScroll: !opts.focus });
    }
    if (Object.keys(before).length) _glide(s, before);
  }

  function _reducedMotion() {
    try {
      return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) {
      return false;
    }
  }

  // FLIP: each moved piece starts where it was and glides to its new place.
  function _glide(s, before) {
    if (_reducedMotion()) return;
    Object.keys(before).forEach(function (pid) {
      var el = s.overlay.querySelector('.awc-chip[data-piece="' + pid + '"]');
      if (!el || !el.getBoundingClientRect || !el.animate) return;
      var now = el.getBoundingClientRect();
      var dx = before[pid].left - now.left;
      var dy = before[pid].top - now.top;
      if (!dx && !dy) return;
      el.animate([{ transform: 'translate(' + dx + 'px,' + dy + 'px)' }, { transform: 'none' }], {
        duration: GLIDE_MS,
        easing: 'cubic-bezier(0.25, 0.1, 0.25, 1)',
      });
    });
  }

  /* ── Files ── */
  function _release(s, pieces) {
    (pieces || []).forEach(function (piece) {
      var url = s.urls[piece.id];
      if (!url) return;
      delete s.urls[piece.id];
      try {
        URL.revokeObjectURL(url);
      } catch (e) {
        /* nothing held */
      }
    });
  }

  function _thumbUrl(page) {
    if (!page || !page.thumb || typeof URL === 'undefined' || !URL.createObjectURL) return '';
    try {
      return URL.createObjectURL(page.thumb);
    } catch (e) {
      return '';
    }
  }

  /* Files for one student: each shrunk at once, in turn, through
     AddWorkFiles.prepare, so a refusal shows beside that student and that
     file does not wait. → Promise. */
  function addFiles(sid, files) {
    var s = _s;
    files = Array.prototype.slice.call(files || []);
    if (!s || s.busy || s.view !== 'stage' || !files.length || !s.stage.row(sid)) return Promise.resolve();
    if (!window.AddWorkFiles || !window.PhotoShrink) {
      s.stage.note(sid, "Photos can't be added on this page.");
      _draw();
      return Promise.resolve();
    }
    s.headNote = '';
    s.stage.note(sid, '');
    s.reading[sid] = (s.reading[sid] || 0) + files.length;
    _draw();
    var said = '';
    return files
      .reduce(function (p, file) {
        return p.then(function () {
          if (_s !== s) return;
          var name = String((file && file.name) || '');
          return AddWorkFiles.prepare([file]).then(
            function (got) {
              if (_s !== s) return;
              s.reading[sid] = Math.max(0, (s.reading[sid] || 0) - 1);
              if (got.said || !got.pages.length) {
                said = got.said || said;
                return;
              }
              var placed = s.stage.place(sid, { from: name, pages: got.pages });
              if (!placed.ok) {
                if (placed.reason === 'too_many_pages') said = 'A piece of work can have 30 pages at most.';
                return;
              }
              var url = _thumbUrl(placed.piece.pages[0]);
              if (url) s.urls[placed.piece.id] = url;
              _draw();
            },
            function () {
              if (_s !== s) return;
              s.reading[sid] = Math.max(0, (s.reading[sid] || 0) - 1);
              said = "That file couldn't be used. Try another photo.";
            },
          );
        });
      }, Promise.resolve())
      .then(function () {
        if (_s !== s) return;
        if (said) s.stage.note(sid, said);
        _draw();
      });
  }

  function _move(s, from, to, pid, focusKey) {
    var res = s.stage.move(from, to, pid);
    s.moveMenu = null;
    // Moved by the teacher: no longer the app's match by name.
    (res.moved || []).forEach(function (p) {
      delete s.byName[p.id];
    });
    if (!res.ok) {
      if (res.reason === 'too_many_pages') s.stage.note(to, 'A piece of work can have 30 pages at most.');
      _draw({ focus: focusKey || null });
      return;
    }
    _draw({
      glide: res.moved.map(function (p) {
        return p.id;
      }),
      focus: focusKey || null,
    });
  }

  /* Pieces with their pages already read (Split the Scan, the tray) onto
     their students, with no draw. → [{ ok, piece, reason }], one each. */
  function _placeAll(s, pieces) {
    return (pieces || []).map(function (given) {
      if (!given || s.busy || s.view !== 'stage') return { ok: false, reason: 'busy' };
      var placed = s.stage.place(given.sid, { from: given.from, pages: given.pages });
      if (!placed.ok) return placed;
      // A For choice the teacher made, kept while the file waited (B6).
      if (given.forAid && _two()) placed = AddWorkTwoClasses.carryFor(s, given, placed);
      // Off a scan: its place in the pile, for Grade in Scan Order.
      if (given.scan && s.scanOrder.indexOf(given.sid) < 0) s.scanOrder.push(given.sid);
      // Placed by the app from the file's name (the tray), not by the teacher's hand.
      if (given.byName) s.byName[placed.piece.id] = true;
      var url = given.url || _thumbUrl(placed.piece.pages[0]);
      if (url) s.urls[placed.piece.id] = url;
      s.headNote = '';
      return placed;
    });
  }

  function placePieces(pieces) {
    var s = _s;
    if (!s || s.busy || s.view !== 'stage') return { placed: 0, waiting: 0 };
    return s.tray.placeOrHold(pieces);
  }

  /* ── The run ── */
  function _api(cid, aid) {
    return {
      add: function (sid, pages, mode) {
        return addStudentWorkPages(cid, sid, aid, pages, { mode: mode });
      },
      replace: function (sid, pages) {
        return replaceStudentWorkPages(cid, sid, aid, pages);
      },
      paper: function (sids) {
        return markStudentWorkOnPaper(cid, aid, sids);
      },
    };
  }

  // Each target's students' work in its own class and assessment.
  function _subsOf(cid, aid, list) {
    var subs = {};
    list.forEach(function (st) {
      subs[st.id] = getStudentSubmission(cid, st.id, aid);
    });
    return subs;
  }
  function _readSubs(s) {
    s.stage.targets().forEach(function (t) {
      t.subs = _subsOf(t.cid, t.aid, t.list);
    });
    s.subs = s.stage.subs();
  }
  // A class and assessment as a target takes them, or null.
  function _read(cid, aid) {
    var a = _piece(cid, aid);
    if (!a || !offered(cid, a)) return null;
    var list = students(cid, a);
    var course = (typeof COURSES !== 'undefined' && COURSES[cid]) || {};
    return { cid: cid, aid: aid, a: a, list: list, subs: _subsOf(cid, aid, list), name: course.name || '' };
  }

  function _run() {
    var s = _s;
    // A file still being read would land during the run: Add Work waits for it.
    if (!s || s.busy || _readingAny(s) || !s.stage.counts().ready) return;
    s.busy = true;
    s.headNote = '';
    s.moveMenu = null;
    s.progress = '';
    _draw({ focus: 'run' });
    // Who was added to the page's assessment, for Grade in Scan Order.
    var sent = function (t, sid) {
      return function (res) {
        if (res && res.result === 'sent') s.addedAny[sid] = true;
        if (t.home && res && res.result === 'sent' && s.addedSids.indexOf(sid) < 0) s.addedSids.push(sid);
        return res;
      };
    };
    // Each target through its own class and assessment's calls.
    return AddWorkTargets.run(
      s.stage,
      function (t) {
        var api = _api(t.cid, t.aid);
        return {
          add: function (sid, pages, mode) {
            return Promise.resolve(api.add(sid, pages, mode)).then(sent(t, sid));
          },
          replace: function (sid, pages) {
            return Promise.resolve(api.replace(sid, pages)).then(sent(t, sid));
          },
          paper: api.paper,
        };
      },
      {
        alive: function () {
          return _s === s;
        },
        progress: function (n, total) {
          s.progress = 'Adding ' + n + ' of ' + total + '…';
          var btn = s.overlay.querySelector('.awc-primary');
          if (btn) btn.textContent = s.progress;
        },
        release: function (pieces) {
          _release(s, pieces);
        },
      },
    ).then(function (out) {
      if (_s !== s || out.closed) return;
      s.busy = false;
      // Each student once, across targets and runs.
      s.added = Object.keys(s.addedAny).length;
      s.paperSet += out.paper;
      _readSubs(s);
      var waiting = s.stage.counts();
      if (!out.stopped && !waiting.files && !waiting.paper && !s.tray.count()) {
        s.view = 'done';
        s.stillNotIn = s.stage
          .rows()
          .filter(function (r) {
            return r.had === 'none';
          })
          .map(function (r) {
            return r.sid;
          });
        _draw({ focus: 'done' });
        return;
      }
      var parts = [];
      if (s.added) parts.push('Added Work for ' + s.added + (s.added === 1 ? ' Student.' : ' Students.'));
      if (s.paperSet) parts.push(_paperLine(s.paperSet) + '.');
      if (out.said) parts.push(out.said);
      s.headNote = parts.join(' ');
      _draw({ focus: 'run', fallback: 'cancel' });
    });
  }

  // After the run, the next student's On Paper (or Done) takes the focus
  // when a student's buttons go.
  function _nextKey(s, sid) {
    var still = s.stillNotIn.filter(function (id) {
      return !s.leftAlone[id] && (!s.paperDone[id] || id === sid);
    });
    var next = still[still.indexOf(sid) + 1];
    return next ? 'paperNow:' + next : 'done';
  }

  // On Paper after the run: the teacher's click, one student.
  function _paperNow(sid) {
    var s = _s;
    if (!s || s.paperDone[sid]) return;
    var focus = _nextKey(s, sid);
    s.paperDone[sid] = 'Saving…';
    _draw({ focus: focus });
    var t = s.stage.home(sid) || s.stage.main();
    markStudentWorkOnPaper(t.cid, t.aid, [sid])
      .then(null, function () {
        return { result: 'store_failed' };
      })
      .then(function (res) {
        if (_s !== s) return;
        if (res && res.result === 'sent') s.paperDone[sid] = true;
        else {
          delete s.paperDone[sid];
          s.headNote = _say(res || {});
        }
        _draw();
      });
  }

  /* ── Grade in Scan Order ──
     The students added, in the order their pieces came off the scan; the
     ones added from files, not the scan, after them in the list's order.
     Kept in memory only. */
  // For one class (`t`, the page's own when left out), its own students only.
  function scanOrder(s, t) {
    t = t || s.stage.main();
    var mine = function (sid) {
      return s.addedSids.indexOf(sid) >= 0 && !!t.stage.row(sid);
    };
    var scanned = s.scanOrder.filter(mine);
    if (!scanned.length) return [];
    return scanned.concat(
      t.list
        .map(function (st) {
          return st.id;
        })
        .filter(function (sid) {
          return mine(sid) && scanned.indexOf(sid) < 0;
        }),
    );
  }

  // One button per class with students off the scan: "Grade Block A in Scan Order".
  // html-safe: class names go through esc; ids are ours (esc too)
  function _gradeButtons(s) {
    var pa = /** @type {any} */ (window).PageAssignments;
    if (!pa || !pa.openGrader) return '';
    var classes = s.stage.classes();
    return classes
      .map(function (t, i) {
        if (!scanOrder(s, t).length) return '';
        // Another class's grader opens there: the Assignments page switches class.
        if (i > 0 && !pa.switchCourse) return '';
        return (
          '<button type="button" class="awc-cancel" data-awc="scanOrder" data-cid="' +
          esc(t.cid) +
          '" data-key="scanOrder:' +
          esc(t.cid) +
          '">' +
          esc(classes.length > 1 ? 'Grade ' + (t.name || 'This Class') + ' in Scan Order' : 'Grade in Scan Order') +
          '</button>'
        );
      })
      .join('');
  }

  // The grader (PageAssignments.openGrader, unchanged) on those students, from
  // the first. The page behind is drawn again when the grader closes. For the
  // second class the Assignments page switches to it first, as it does to
  // open a copy in another class (switchCourse).
  function _gradeInOrder(cid) {
    var s = _s;
    var t =
      s &&
      (s.stage.classes().find(function (x) {
        return x.cid === cid;
      }) ||
        s.stage.main());
    var ids = s ? scanOrder(s, t) : [];
    var pa = /** @type {any} */ (window).PageAssignments;
    if (!s || !ids.length || !pa || !pa.openGrader) return;
    var router = /** @type {any} */ (window).Router;
    var over = !!(router && router.getCurrentPage && router.getCurrentPage() === pa);
    var after = s.onClose;
    close(true);
    if (t !== s.stage.main()) {
      var wall = /** @type {any} */ (window).WorkWall;
      if (wall && wall.isOpen && wall.isOpen()) wall.close();
      return Promise.resolve(pa.switchCourse(t.cid)).then(function () {
        pa.openGrader(t.cid, t.aid, ids[0], { studentIds: ids, overPage: over });
      });
    }
    pa.openGrader(s.cid, s.aid, ids[0], {
      studentIds: ids,
      overPage: over,
      onClose: function () {
        if (after) after();
      },
    });
  }

  /* ── Leaving ── */
  function _leave() {
    var s = _s;
    if (!s || s.busy) return;
    var files = s.view === 'stage' ? s.stage.counts().files + s.tray.count() : 0;
    if (!files) return close();
    if (typeof showConfirm !== 'function') return close();
    showConfirm(
      'Leave without adding?',
      files === 1 ? '1 file is waiting.' : files + ' files are waiting.',
      'Leave',
      'danger',
      function () {
        if (_s === s) close();
      },
      'Keep Adding',
    );
  }

  /* ── Events ── */
  function _click(e) {
    var s = _s;
    var btn = e.target && e.target.closest ? e.target.closest('[data-awc], [data-awt]') : null;
    if (!s) return;
    if (
      s.moveMenu &&
      (!btn || (btn.getAttribute('data-awc') !== 'moveTo' && btn.getAttribute('data-awc') !== 'moveMenu'))
    ) {
      s.moveMenu = null;
      _draw();
      if (!btn) return;
    }
    if (!btn || btn.disabled) return;
    if (!btn.hasAttribute('data-awc')) {
      if (!s.busy) s.tray.click(btn);
      return;
    }
    var what = btn.getAttribute('data-awc');
    var sid = btn.getAttribute('data-sid');
    var pid = btn.getAttribute('data-piece');
    if (what === 'leave') return _leave();
    if (what === 'done') return close();
    if (what === 'scanOrder') return _gradeInOrder(btn.getAttribute('data-cid'));
    if (what === 'layout') {
      s.layout = btn.getAttribute('data-layout') === 'grid' ? 'grid' : 'column';
      _keepLayout(s.layout);
      return _draw();
    }
    if (what === 'run') return _run();
    if (s.busy) return;
    if (_two() && AddWorkTwoClasses.click(s, what, btn, _ctx)) return;
    if (what === 'choose') {
      var input = btn.parentNode && btn.parentNode.querySelector('.awc-file');
      if (input) input.click();
      return;
    }
    if (what === 'off') {
      _release(s, s.stage.takeOff(sid, pid));
      return _draw({ fallback: 'drop:' + sid });
    }
    if (what === 'moveMenu') {
      var open = s.moveMenu && s.moveMenu.pid === pid;
      s.moveMenu = open ? null : { sid: sid, pid: pid };
      _draw();
      if (!open) {
        var item = s.overlay.querySelector('.awc-move-menu .awc-move-item');
        if (item) item.focus();
      }
      return;
    }
    if (what === 'moveTo') return _move(s, sid, btn.getAttribute('data-to'), pid, 'move:' + pid);
    if (what === 'choice') {
      s.stage.choose(sid, btn.getAttribute('data-choice'));
      return _draw();
    }
    if (what === 'paper') {
      var r = s.stage.row(sid);
      s.stage.setOnPaper(sid, !(r && r.onPaper));
      return _draw();
    }
    if (what === 'paperNow') return _paperNow(sid);
    if (what === 'leaveNotIn') {
      var focus = _nextKey(s, sid);
      s.leftAlone[sid] = true;
      return _draw({ focus: focus, fallback: 'done' });
    }
  }

  function _change(e) {
    var input = e.target;
    if (!_s || !input || !input.classList) return;
    if (_s.tray.change(input)) return;
    if (_two() && AddWorkTwoClasses.change(_s, input, _ctx)) return;
    if (!input.classList.contains('awc-file')) return;
    var files = Array.prototype.slice.call(input.files || []);
    input.value = '';
    addFiles(input.getAttribute('data-sid'), files);
  }

  // Typing in the tray's Choose a Student.
  function _input(e) {
    if (_s) _s.tray.input(e.target);
  }

  function _hasFiles(e) {
    var types = e.dataTransfer && e.dataTransfer.types;
    return !!types && Array.prototype.indexOf.call(types, 'Files') >= 0;
  }

  function _targetOf(e) {
    return e.target && e.target.closest ? e.target.closest('[data-awc-target]') : null;
  }

  function _overOff(s) {
    if (!s.over) return;
    s.over.classList.remove('is-over');
    var drop = s.over.querySelector('.awc-drop');
    if (drop) drop.textContent = drop.getAttribute('data-idle');
    s.over = null;
  }

  function _dragOver(e) {
    var s = _s;
    if (!s) return;
    // Nothing dropped here opens in the browser.
    e.preventDefault();
    var files = _hasFiles(e);
    // A drag that carries files is always files from the computer, never a
    // chip still marked as moving (its dragend may never have come).
    if (files) s.drag = null;
    if (s.busy || s.view !== 'stage' || (!files && !s.drag)) {
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
      return _overOff(s);
    }
    var target = _targetOf(e);
    var sid = target && target.getAttribute('data-awc-target');
    // Files off a student go to the tray, matched by name: its drop space lights.
    if (files && !target) target = s.overlay.querySelector('[data-awt-drop]');
    if (!target || (s.drag && s.drag.sid === sid)) {
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
      return _overOff(s);
    }
    if (e.dataTransfer) e.dataTransfer.dropEffect = files ? 'copy' : 'move';
    if (s.over === target) return;
    _overOff(s);
    s.over = target;
    target.classList.add('is-over');
    var drop = target.querySelector('.awc-drop');
    // A file from the tray is added, as a file from the computer is.
    if (drop) drop.textContent = drop.getAttribute(files || (s.drag && s.drag.tray) ? 'data-over' : 'data-move');
  }

  function _dragLeave(e) {
    var s = _s;
    if (!s || !s.over) return;
    // Leaving the page altogether: the highlight goes.
    if (!e.relatedTarget || !s.overlay.contains(e.relatedTarget)) _overOff(s);
  }

  function _drop(e) {
    var s = _s;
    if (!s) return;
    e.preventDefault();
    _overOff(s);
    var drag = _hasFiles(e) ? null : s.drag;
    s.drag = null;
    if (s.busy || s.view !== 'stage') return;
    var target = _targetOf(e);
    var sid = target && target.getAttribute('data-awc-target');
    if (drag) {
      if (drag.tray) {
        if (sid) s.tray.placeItem(drag.tray, sid);
      } else if (sid && sid !== drag.sid) _move(s, drag.sid, sid, drag.pid);
      return;
    }
    var files = e.dataTransfer && e.dataTransfer.files;
    if (!files || !files.length) return;
    // Off a student, or a folder anywhere: each file is matched by its name.
    if (!sid || s.tray.hasFolder(e.dataTransfer)) return s.tray.takeDrop(e.dataTransfer);
    // On a student: that student's, whatever it is called.
    addFiles(sid, files);
  }

  function _dragStart(e) {
    var s = _s;
    var chip = e.target && e.target.closest ? e.target.closest('.awc-chip, .awt-item') : null;
    if (!s || !chip || s.busy) return;
    s.drag = chip.hasAttribute('data-awt-item')
      ? { tray: chip.getAttribute('data-awt-item'), el: chip }
      : { sid: chip.getAttribute('data-sid'), pid: chip.getAttribute('data-piece'), el: chip };
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      try {
        e.dataTransfer.setData('text/plain', '');
      } catch (err) {
        /* some browsers want data to start a drag */
      }
    }
    chip.classList.add('is-dragging');
  }
  function _dragEnd() {
    var s = _s;
    if (!s) return;
    s.drag = null;
    _overOff(s);
    var chip = s.overlay.querySelector('.is-dragging');
    if (chip) chip.classList.remove('is-dragging');
  }

  // Escape: the Move to… list first, then the page (asking when files wait).
  // Ahead of the Work Wall's own Escape, which would close the wall too.
  function _keydown(e) {
    var s = _s;
    if (!s || e.defaultPrevented) return;
    // Split the Scan, over this page, has the keys while it is open.
    var split = /** @type {any} */ (window).AddWorkSplit;
    if (split && typeof split.isOpen === 'function' && split.isOpen()) return;
    if (s.tray.keydown(e)) return;
    if (s.moveMenu && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      var items = Array.prototype.slice.call(s.overlay.querySelectorAll('.awc-move-menu .awc-move-item'));
      var at = items.indexOf(document.activeElement);
      var next = items[(at + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length];
      if (next) {
        e.preventDefault();
        next.focus();
      }
      return;
    }
    if (e.key !== 'Escape') return;
    if (document.querySelector('.confirm-overlay')) return;
    e.preventDefault();
    e.stopPropagation();
    if (s.moveMenu) {
      var pid = s.moveMenu.pid;
      s.moveMenu = null;
      return _draw({ focus: 'move:' + pid });
    }
    _leave();
  }

  function _beforeUnload(e) {
    var s = _s;
    if (!s || (!s.busy && !(s.view === 'stage' && s.stage.counts().files + s.tray.count()))) return;
    e.preventDefault();
    e.returnValue = '';
  }

  /* Opens the page for one piece. → false when the piece is not offered
     (nothing is taken then). opts:
       onClose  called when the page closes
       drop     a drop's own DataTransfer: once the page is drawn it goes to
                the tray exactly as a drop off a student does
                (tray.takeDrop), folders and all. A browser gives up a
                dropped folder's contents only while the drop is handled, so
                a caller passing this calls open synchronously inside its
                drop handler, with no wait before it.
       files    File objects (an array or FileList), used when drop is not
                given: they go to the tray as files chosen there do
                (tray.take), so a single PDF opens Split the Scan.
     Nothing is saved until Add Work is pressed on the page. */
  function open(cid, aid, opts) {
    var a = _piece(cid, aid);
    if (!offered(cid, a)) return false;
    close(true);
    opts = opts || {};
    var list = students(cid, a);
    var byId = {};
    list.forEach(function (st) {
      byId[st.id] = st;
    });
    var overlay = document.createElement('div');
    overlay.id = 'add-work-class-overlay';
    overlay.className = 'awc-overlay';
    document.body.appendChild(overlay);
    var s = {
      cid: cid,
      aid: aid,
      a: a,
      list: list,
      byId: byId,
      subs: {},
      layout: _layout(),
      view: 'stage',
      busy: false,
      progress: '',
      reading: {},
      urls: {},
      moveMenu: null,
      drag: null,
      over: null,
      headNote: '',
      added: 0,
      paperSet: 0,
      stillNotIn: [],
      leftAlone: {},
      paperDone: {},
      scanOrder: [],
      byName: {},
      addedSids: [],
      addedAny: {},
      overlay: overlay,
      opener: document.activeElement,
      onClose: typeof opts.onClose === 'function' ? opts.onClose : null,
    };
    var course = (typeof COURSES !== 'undefined' && COURSES[cid]) || {};
    s.stage = AddWorkTargets.create(
      { cid: cid, aid: aid, a: a, list: list, subs: _subsOf(cid, aid, list), name: course.name || '' },
      _read,
    );
    s.subs = s.stage.subs();
    s.tray = AddWorkTray.create({
      cid: cid,
      aid: aid,
      alive: function () {
        return _s === s;
      },
      busy: function () {
        return s.busy || s.view !== 'stage';
      },
      // Every class on the page: a name in both is offered, never taken.
      roster: function () {
        return s.stage.classes().reduce(function (all, t) {
          return all.concat(getStudents(t.cid) || []);
        }, []);
      },
      rows: function () {
        return s.stage.rows().map(function (r) {
          return r.sid;
        });
      },
      full: function (sid) {
        return _full(s, sid) + (_two() ? AddWorkTwoClasses.label(s, sid) : '');
      },
      // The name alone, without its class: for "Two students are named …".
      name: function (sid) {
        return _full(s, sid);
      },
      // Split the Scan with two classes: both lists, each name with its class.
      split: function () {
        return _two() ? AddWorkTwoClasses.splitOpts(s, _ctx) : null;
      },
      classes: function () {
        return s.stage.classes().map(function (t) {
          return t.name;
        });
      },
      first: function (sid) {
        return _first(s, sid);
      },
      place: function (pieces) {
        return _placeAll(s, pieces);
      },
      draw: function (o) {
        if (_s === s) _draw(o);
      },
      layout: function () {
        return s.layout;
      },
    });
    _s = s;
    overlay.addEventListener('click', _click);
    overlay.addEventListener('change', _change);
    overlay.addEventListener('input', _input);
    overlay.addEventListener('dragover', _dragOver);
    overlay.addEventListener('dragleave', _dragLeave);
    overlay.addEventListener('drop', _drop);
    overlay.addEventListener('dragstart', _dragStart);
    // On the document: a chip drawn away mid-drag still ends its drag.
    document.addEventListener('dragend', _dragEnd, true);
    document.addEventListener('keydown', _keydown, true);
    if (window.addEventListener) window.addEventListener('beforeunload', _beforeUnload);
    _draw();
    var back = /** @type {HTMLElement | null} */ (overlay.querySelector('.awc-back'));
    if (back) back.focus();
    if (opts.drop) s.tray.takeDrop(opts.drop);
    else if (opts.files) s.tray.take(opts.files);
    return true;
  }

  function close(quiet) {
    var s = _s;
    if (!s) return;
    _s = null;
    document.removeEventListener('keydown', _keydown, true);
    document.removeEventListener('dragend', _dragEnd, true);
    if (window.removeEventListener) window.removeEventListener('beforeunload', _beforeUnload);
    s.stage.rows().forEach(function (r) {
      _release(s, r.pieces);
    });
    s.tray.release();
    var split = /** @type {any} */ (window).AddWorkSplit;
    if (split && typeof split.isOpen === 'function' && split.isOpen()) split.close();
    s.overlay.remove();
    if (quiet) return;
    if (s.opener && s.opener.isConnected && typeof s.opener.focus === 'function') s.opener.focus();
    if (s.onClose) s.onClose();
  }

  return {
    open: open,
    close: close,
    isOpen: function () {
      return !!_s;
    },
    offered: offered,
    students: students,
    placePieces: placePieces,
    // For tests: the files for one student, as a drop or the chooser gives them.
    addFiles: addFiles,
    // For tests: files dropped off a student or chosen from the tray, and what waits.
    takeFiles: function (files) {
      return _s ? _s.tray.take(files) : Promise.resolve();
    },
    waiting: function () {
      return _s ? _s.tray.items() : [];
    },
    // For tests: Grade in Scan Order's students, as the button would open them.
    scanOrder: function () {
      return _s ? scanOrder(_s) : [];
    },
  };
})();
