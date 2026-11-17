/* ── add-work-class.js — Add Work for the Class (B1) ─────────────────────
   One page, on a computer, where a teacher puts paper work (photos or
   PDFs) on every student of one assessment, then adds it all with one
   button. Nothing is saved until Add Work is pressed
   (docs/plans/add-work-for-class-plan.md, DECISIONS "Add Work for the
   Class (2026-11-17)").

   Two parts:
   - The staging model (AddWorkClass.stage, AddWorkClass.run): for each
     student, the pages waiting, in pieces (a piece is one file's pages, in
     order), where each piece came from (for the screen only), the choice
     for a student who already has work, and On Paper. No HTML and no DOM:
     it is handed pages, however they arrived, and answers the writes to
     run. Later slices (Split the Scan, a folder matched by name) hand it
     pieces too.
   - The screen: a page over the Assignments page (or the Work Wall), like
     the Work Wall, in Column or Grid.

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
   AddWorkClass.offered(cid, a)       whether the piece offers it: where the
                                      row's + (Attach Work) is offered.
   AddWorkClass.students(cid, a)      the students it lists, in roster order. */
window.AddWorkClass = (function () {
  'use strict';

  var LAYOUT_KEY = 'fv-add-work-class-layout';
  var GLIDE_MS = 200;
  // The grader's Add Work takes these (_attachMenuHtml, grader.js).
  var ACCEPT = 'image/*,.heic,.heif,application/pdf';

  function _maxPages() {
    return typeof STUDENT_WORK_MAX_PAGES === 'number' ? STUDENT_WORK_MAX_PAGES : 30;
  }

  /* ── The staging model ─────────────────────────────────────────
     stage(list): list is [{ id, had }] in roster order, had 'none' (nothing
     in), 'work' (photos or links in) or 'paper' (handed in on paper).

     A row: { sid, had, pieces: [{ id, from, pages }], choice, onPaper, note }.
     choice: for had 'work', 'add' (the default), 'replace' or 'skip'; for
     had 'paper', 'replace' (the default) or 'skip'; null for had 'none',
     or when the student must be decided again (work came in meanwhile). */
  var _pieceSeq = 0;

  function _defaultChoice(had) {
    return had === 'work' ? 'add' : had === 'paper' ? 'replace' : null;
  }

  function _choices(had) {
    return had === 'work' ? ['add', 'replace', 'skip'] : had === 'paper' ? ['replace', 'skip'] : [];
  }

  // Each page a copy, named by where it sits: no file name is kept.
  function _renamed(pages, from) {
    return (pages || []).map(function (p, i) {
      var copy = Object.assign({}, p);
      copy.name = 'page-' + (from + i + 1) + '.jpg';
      return copy;
    });
  }

  function _pageCount(row) {
    return row.pieces.reduce(function (n, piece) {
      return n + piece.pages.length;
    }, 0);
  }

  function stage(list) {
    var rows = [];
    var byId = {};
    (list || []).forEach(function (st) {
      if (!st || !st.id || byId[st.id]) return;
      var had = st.had === 'work' || st.had === 'paper' ? st.had : 'none';
      var row = { sid: st.id, had: had, pieces: [], choice: _defaultChoice(had), onPaper: false, note: '' };
      rows.push(row);
      byId[st.id] = row;
    });

    function row(sid) {
      return byId[sid] || null;
    }

    function _settle(r) {
      if (!r.pieces.length) r.choice = _defaultChoice(r.had);
    }

    /* A piece ({ from, pages }) placed on a student, after what waits there.
       → { ok: true, piece } or { ok: false, reason: 'not_found' | 'empty'
       | 'too_many_pages' }. */
    function place(sid, given) {
      var r = row(sid);
      if (!r) return { ok: false, reason: 'not_found' };
      var pages = (given && given.pages) || [];
      if (!pages.length) return { ok: false, reason: 'empty' };
      if (_pageCount(r) + pages.length > _maxPages()) return { ok: false, reason: 'too_many_pages' };
      var piece = { id: 'p' + ++_pieceSeq, from: String((given && given.from) || ''), pages: _renamed(pages, 0) };
      if (!r.pieces.length) r.choice = _defaultChoice(r.had);
      r.pieces.push(piece);
      r.onPaper = false;
      r.note = '';
      return { ok: true, piece: piece };
    }

    function _find(sid, pid) {
      var r = row(sid);
      if (!r) return -1;
      for (var i = 0; i < r.pieces.length; i++) if (r.pieces[i].id === pid) return i;
      return -1;
    }

    /* One piece (pid), or every piece, from one student to another, after
       what waits there. → { ok, moved: [pieces] } or { ok: false, reason }. */
    function move(fromSid, toSid, pid) {
      var from = row(fromSid);
      var to = row(toSid);
      if (!from || !to) return { ok: false, reason: 'not_found' };
      if (from === to) return { ok: false, reason: 'same' };
      var moving = pid
        ? from.pieces.filter(function (p) {
            return p.id === pid;
          })
        : from.pieces.slice();
      if (!moving.length) return { ok: false, reason: 'empty' };
      var n = moving.reduce(function (k, p) {
        return k + p.pages.length;
      }, 0);
      if (_pageCount(to) + n > _maxPages()) return { ok: false, reason: 'too_many_pages' };
      from.pieces = from.pieces.filter(function (p) {
        return moving.indexOf(p) < 0;
      });
      if (!to.pieces.length) to.choice = _defaultChoice(to.had);
      to.pieces = to.pieces.concat(moving);
      to.onPaper = false;
      from.note = '';
      to.note = '';
      _settle(from);
      return { ok: true, moved: moving };
    }

    /* One piece, or all of a student's, taken off. → the pieces taken. */
    function takeOff(sid, pid) {
      var r = row(sid);
      if (!r) return [];
      var at = pid ? _find(sid, pid) : -1;
      var gone = pid ? (at < 0 ? [] : r.pieces.splice(at, 1)) : r.pieces.splice(0, r.pieces.length);
      if (gone.length) r.note = '';
      _settle(r);
      return gone;
    }

    function choose(sid, choice) {
      var r = row(sid);
      if (!r) return false;
      if (choice !== null && _choices(r.had).indexOf(choice) < 0) return false;
      r.choice = choice;
      r.note = '';
      return true;
    }

    // On Paper: only a student with nothing in and nothing placed.
    function setOnPaper(sid, on) {
      var r = row(sid);
      if (!r) return false;
      if (on && (r.had !== 'none' || r.pieces.length)) return false;
      r.onPaper = !!on;
      return true;
    }

    // What is in for the student now (an answer from the data layer).
    function setHad(sid, had, choice) {
      var r = row(sid);
      if (!r) return;
      r.had = had === 'work' || had === 'paper' ? had : 'none';
      r.choice = choice === undefined ? _defaultChoice(r.had) : choice;
      if (r.had !== 'none') r.onPaper = false;
    }

    function note(sid, text) {
      var r = row(sid);
      if (r) r.note = String(text || '');
    }

    // The student leaves the page (no longer in the class). → their pieces.
    function drop(sid) {
      var r = row(sid);
      if (!r) return [];
      rows.splice(rows.indexOf(r), 1);
      delete byId[sid];
      return r.pieces;
    }

    function _ready(r) {
      if (r.onPaper) return true;
      if (!r.pieces.length) return false;
      return r.had === 'none' || r.choice === 'add' || r.choice === 'replace';
    }
    function _decide(r) {
      return r.pieces.length > 0 && r.had !== 'none' && !r.choice;
    }

    function counts() {
      var out = { ready: 0, decide: 0, notIn: 0, files: 0, pages: 0, paper: 0, replace: 0 };
      rows.forEach(function (r) {
        out.files += r.pieces.length;
        out.pages += _pageCount(r);
        if (_ready(r)) out.ready++;
        if (r.onPaper) out.paper++;
        if (_decide(r)) out.decide++;
        if (r.pieces.length && r.had !== 'none' && r.choice === 'replace') out.replace++;
        if (r.had === 'none' && !r.pieces.length && !r.onPaper) out.notIn++;
      });
      return out;
    }

    function buttonLabel() {
      var n = counts().ready;
      return 'Add Work for ' + n + (n === 1 ? ' Student' : ' Students');
    }

    // "N ready to add · M to decide · K students with nothing to add stay Not In"
    function footerText() {
      var c = counts();
      var parts = [];
      if (c.ready) parts.push(c.ready + ' ready to add');
      if (c.decide) parts.push(c.decide + ' to decide');
      if (c.notIn)
        parts.push(
          c.notIn === 1
            ? '1 student with nothing to add stays Not In'
            : c.notIn + ' students with nothing to add stay Not In',
        );
      return parts.join(' · ');
    }

    /* The writes, in roster order: one per student with pages, then one
       for the On Paper students. Each student's pages are numbered in
       order across their pieces. */
    function writes() {
      var out = [];
      var paper = [];
      rows.forEach(function (r) {
        if (r.onPaper) paper.push(r.sid);
        if (!_ready(r) || !r.pieces.length) return;
        var pages = [];
        r.pieces.forEach(function (piece) {
          pages = pages.concat(_renamed(piece.pages, pages.length));
        });
        if (r.had === 'none') out.push({ kind: 'add', sid: r.sid, mode: 'new', pages: pages });
        else if (r.choice === 'add') out.push({ kind: 'add', sid: r.sid, mode: 'add', pages: pages });
        else out.push({ kind: 'replace', sid: r.sid, pages: pages });
      });
      if (paper.length) out.push({ kind: 'paper', sids: paper });
      return out;
    }

    return {
      rows: function () {
        return rows.slice();
      },
      row: row,
      choices: function (sid) {
        var r = row(sid);
        return r ? _choices(r.had) : [];
      },
      place: place,
      move: move,
      takeOff: takeOff,
      choose: choose,
      setOnPaper: setOnPaper,
      setHad: setHad,
      note: note,
      drop: drop,
      counts: counts,
      buttonLabel: buttonLabel,
      footerText: footerText,
      writes: writes,
    };
  }

  function _say(res) {
    return window.AddWorkFiles ? AddWorkFiles.answer(res) : "The photos couldn't be kept. Try again.";
  }

  /* The run: each write awaited in turn. api: { add(sid, pages, mode),
     replace(sid, pages), paper(sids) }, each a Promise of the data layer's
     answer. opts.alive() is asked before each write and each answer is
     used (false: the page closed, stop and change nothing more);
     opts.progress(done, total) before each student; opts.release(pieces)
     for pieces that leave the page. → Promise of { added, stopped, said,
     closed }: `stopped` is 'class_full' or 'storage_full' when the run
     stopped there, `said` its words (once). */
  function run(s, api, opts) {
    opts = opts || {};
    var alive =
      opts.alive ||
      function () {
        return true;
      };
    var release = opts.release || function () {};
    var list = s.writes();
    var total = list.reduce(function (n, w) {
      return n + (w.kind === 'paper' ? w.sids.length : 1);
    }, 0);
    var out = { added: 0, stopped: null, said: '', closed: false, total: total };
    var done = 0;
    var at = 0;

    function answerOf(p) {
      return Promise.resolve()
        .then(p)
        .then(null, function () {
          return { result: 'store_failed' };
        })
        .then(function (res) {
          return res || { result: 'store_failed' };
        });
    }

    function student(w, res) {
      var r = res.result;
      var sub = res.submission || null;
      if (r === 'sent') {
        release(s.takeOff(w.sid));
        s.setHad(w.sid, 'work');
        out.added++;
        return;
      }
      if (r === 'already_sent' || r === 'on_paper') {
        s.setHad(w.sid, r === 'on_paper' || (sub && sub.on_paper) ? 'paper' : 'work', null);
        s.note(w.sid, _say(res));
        return;
      }
      if (r === 'nothing_sent') {
        s.setHad(w.sid, 'none');
        s.note(w.sid, _say(res));
        return;
      }
      if (r === 'not_found') {
        release(s.drop(w.sid));
        return;
      }
      if (r === 'class_full' || r === 'storage_full') {
        out.stopped = r;
        out.said = _say(res);
        return;
      }
      s.note(w.sid, _say(res));
    }

    function paper(w, res) {
      if (res.result !== 'sent') {
        if (res.result === 'class_full' || res.result === 'storage_full') out.stopped = res.result;
        out.said = _say(res);
        return;
      }
      var made = {};
      (res.submissions || []).forEach(function (sub) {
        if (sub && sub.enrollment_id) made[sub.enrollment_id] = true;
      });
      w.sids.forEach(function (sid) {
        s.setOnPaper(sid, false);
        // A student not marked had work in by then.
        s.setHad(sid, made[sid] ? 'paper' : 'work');
      });
      out.added += typeof res.marked === 'number' ? res.marked : Object.keys(made).length;
    }

    function next() {
      if (!alive()) {
        out.closed = true;
        return Promise.resolve(out);
      }
      if (out.stopped || at >= list.length) return Promise.resolve(out);
      var w = list[at++];
      if (opts.progress) opts.progress(Math.min(done + 1, total), total);
      var call =
        w.kind === 'paper'
          ? function () {
              return api.paper(w.sids);
            }
          : w.kind === 'replace'
            ? function () {
                return api.replace(w.sid, w.pages);
              }
            : function () {
                return api.add(w.sid, w.pages, w.mode);
              };
      return answerOf(call).then(function (res) {
        if (!alive()) {
          out.closed = true;
          return out;
        }
        if (w.kind === 'paper') {
          done += w.sids.length;
          paper(w, res);
        } else {
          done++;
          student(w, res);
        }
        return next();
      });
    }
    return next();
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

  // shown: true when the caller has asked GraderWork.workShown already (a card's menu).
  function offered(cid, a, shown) {
    if (!cid || !a || a.isDraft || !window.GraderWork) return false;
    if (shown !== true && !GraderWork.workShown(cid, a)) return false;
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
    return isNaN(d) ? '' : d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
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
    var off = busy ? ' disabled' : '';
    var done = s.view === 'done';
    var sub = [s.a.title || '', course.name || '', _plural(s.list.length, 'student', 'students')]
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
      (busy || !c.ready ? ' disabled' : '') +
      '>' +
      esc(busy ? s.progress || 'Adding…' : s.stage.buttonLabel()) +
      '</button>' +
      '</div>' +
      '<div class="awc-scroll">' +
      (s.layout === 'grid' ? _gridHtml(s) : _columnHtml(s)) +
      '</div>' +
      '<div class="awc-foot">' +
      '<span class="awc-count">' +
      esc(s.stage.footerText()) +
      '</span>' +
      '<span class="awc-hint">Nothing is added until you press Add Work.</span>' +
      '</div></div>';
    return html;
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
            esc(_full(s, r.sid)) +
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

  // html-safe: names go through esc; ids are ours (esc too); words are fixed
  function _doneHtml(s) {
    var added = s.added;
    var html =
      '<div class="awc-scroll awc-done">' +
      '<h3 class="awc-done-title">' +
      esc('Added Work for ' + added + (added === 1 ? ' Student' : ' Students')) +
      '</h3>';
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
    var scroll = s.overlay.querySelector('.awc-scroll');
    var top = scroll ? scroll.scrollTop : 0;
    var active = document.activeElement;
    var key = opts.focus || (active && s.overlay.contains(active) ? active.getAttribute('data-key') : null);
    var before = {};
    (opts.glide || []).forEach(function (pid) {
      var el = s.overlay.querySelector('.awc-chip[data-piece="' + pid + '"]');
      if (el && el.getBoundingClientRect) before[pid] = el.getBoundingClientRect();
    });
    // html-safe: _pageHtml escapes every name, file name and word; the rest is fixed markup
    s.overlay.innerHTML = _pageHtml(s);
    var again = s.overlay.querySelector('.awc-scroll');
    if (again) again.scrollTop = top;
    if (key) {
      var el = s.overlay.querySelector('[data-key="' + key + '"]');
      if (!el || el.disabled) el = opts.fallback ? s.overlay.querySelector('[data-key="' + opts.fallback + '"]') : null;
      if (el && !el.disabled) el.focus({ preventScroll: !opts.focus });
    }
    if (opts.glide) _glide(s, before);
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

  function _readSubs(s) {
    s.subs = {};
    s.list.forEach(function (st) {
      s.subs[st.id] = getStudentSubmission(s.cid, st.id, s.aid);
    });
  }

  function _run() {
    var s = _s;
    if (!s || s.busy || !s.stage.counts().ready) return;
    s.busy = true;
    s.headNote = '';
    s.moveMenu = null;
    s.progress = '';
    _draw({ focus: 'run' });
    return run(s.stage, _api(s.cid, s.aid), {
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
    }).then(function (out) {
      if (_s !== s || out.closed) return;
      s.busy = false;
      s.added += out.added;
      _readSubs(s);
      var waiting = s.stage.counts();
      if (!out.stopped && !waiting.files && !waiting.paper) {
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
    markStudentWorkOnPaper(s.cid, s.aid, [sid])
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

  /* ── Leaving ── */
  function _leave() {
    var s = _s;
    if (!s || s.busy) return;
    var files = s.view === 'stage' ? s.stage.counts().files : 0;
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
    var btn = e.target && e.target.closest ? e.target.closest('[data-awc]') : null;
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
    var what = btn.getAttribute('data-awc');
    var sid = btn.getAttribute('data-sid');
    var pid = btn.getAttribute('data-piece');
    if (what === 'leave') return _leave();
    if (what === 'done') return close();
    if (what === 'layout') {
      s.layout = btn.getAttribute('data-layout') === 'grid' ? 'grid' : 'column';
      _keepLayout(s.layout);
      return _draw();
    }
    if (what === 'run') return _run();
    if (s.busy) return;
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
    if (!_s || !input || !input.classList || !input.classList.contains('awc-file')) return;
    var files = Array.prototype.slice.call(input.files || []);
    input.value = '';
    addFiles(input.getAttribute('data-sid'), files);
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
    if (s.busy || s.view !== 'stage' || (!files && !s.drag)) {
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
      return _overOff(s);
    }
    var target = _targetOf(e);
    var sid = target && target.getAttribute('data-awc-target');
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
    if (drop) drop.textContent = drop.getAttribute(files ? 'data-over' : 'data-move');
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
    var drag = s.drag;
    s.drag = null;
    if (s.busy || s.view !== 'stage') return;
    var target = _targetOf(e);
    var sid = target && target.getAttribute('data-awc-target');
    if (drag) {
      if (sid && sid !== drag.sid) _move(s, drag.sid, sid, drag.pid);
      return;
    }
    var files = e.dataTransfer && e.dataTransfer.files;
    if (!files || !files.length) return;
    if (!sid) {
      // The Waiting tray is a later slice: a file dropped off a student is not taken.
      s.headNote = 'Drop it on a student.';
      return _draw();
    }
    addFiles(sid, files);
  }

  function _dragStart(e) {
    var s = _s;
    var chip = e.target && e.target.closest ? e.target.closest('.awc-chip') : null;
    if (!s || !chip || s.busy) return;
    s.drag = { sid: chip.getAttribute('data-sid'), pid: chip.getAttribute('data-piece') };
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
    var chip = s.overlay.querySelector('.awc-chip.is-dragging');
    if (chip) chip.classList.remove('is-dragging');
  }

  // Escape: the Move to… list first, then the page (asking when files wait).
  // Ahead of the Work Wall's own Escape, which would close the wall too.
  function _keydown(e) {
    var s = _s;
    if (!s || e.defaultPrevented) return;
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
    if (!s || (!s.busy && !(s.view === 'stage' && s.stage.counts().files))) return;
    e.preventDefault();
    e.returnValue = '';
  }

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
      stillNotIn: [],
      leftAlone: {},
      paperDone: {},
      overlay: overlay,
      opener: document.activeElement,
      onClose: typeof opts.onClose === 'function' ? opts.onClose : null,
    };
    _readSubs(s);
    s.stage = stage(
      list.map(function (st) {
        return { id: st.id, had: _had(s.subs[st.id]) };
      }),
    );
    _s = s;
    overlay.addEventListener('click', _click);
    overlay.addEventListener('change', _change);
    overlay.addEventListener('dragover', _dragOver);
    overlay.addEventListener('dragleave', _dragLeave);
    overlay.addEventListener('drop', _drop);
    overlay.addEventListener('dragstart', _dragStart);
    overlay.addEventListener('dragend', _dragEnd);
    document.addEventListener('keydown', _keydown, true);
    if (window.addEventListener) window.addEventListener('beforeunload', _beforeUnload);
    _draw();
    var back = overlay.querySelector('.awc-back');
    if (back) back.focus();
    return true;
  }

  function close(quiet) {
    var s = _s;
    if (!s) return;
    _s = null;
    document.removeEventListener('keydown', _keydown, true);
    if (window.removeEventListener) window.removeEventListener('beforeunload', _beforeUnload);
    s.stage.rows().forEach(function (r) {
      _release(s, r.pieces);
    });
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
    stage: stage,
    run: run,
    // For tests: the files for one student, as a drop or the chooser gives them.
    addFiles: addFiles,
  };
})();
