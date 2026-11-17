// @ts-check
/* ── add-work-stage.js — Add Work for the Class: the staging model and the run ──
   Moved out of teacher/add-work-class.js (the screen) on 2026-11-17 so the
   screen has room for later slices. No HTML and no DOM here: the model is
   handed pages, however they arrived (a file chosen, Split the Scan, a
   folder matched by name), and answers the writes to run; run() makes them
   one at a time through the data layer's calls, passed in.

   AddWorkStage.stage(list)          the model (see below).
   AddWorkStage.run(stage, api, opts) the writes, each awaited in turn. */
/** @type {any} */ (window).AddWorkStage = (function () {
  'use strict';

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
        // The pieces in this write: only these leave the student when it is added.
        var ids = r.pieces.map(function (piece) {
          pages = pages.concat(_renamed(piece.pages, pages.length));
          return piece.id;
        });
        var w = { kind: 'replace', sid: r.sid, pages: pages, pieces: ids };
        if (r.had === 'none' || r.choice === 'add') {
          w.kind = 'add';
          w.mode = r.had === 'none' ? 'new' : 'add';
        }
        out.push(w);
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
     for pieces that leave the page. → Promise of { added, paper, stopped,
     said, closed }: `added` the students whose pages were added, `paper`
     those set to Handed in on paper; `stopped` is 'class_full' or 'storage_full' when the run
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
    var out = { added: 0, paper: 0, stopped: null, said: '', closed: false, total: total };
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
        // Only the pieces that were written: one placed since stays, waiting.
        var gone = [];
        (w.pieces || []).forEach(function (pid) {
          gone = gone.concat(s.takeOff(w.sid, pid));
        });
        release(gone);
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
      out.paper += typeof res.marked === 'number' ? res.marked : Object.keys(made).length;
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

  return { stage: stage, run: run };
})();
