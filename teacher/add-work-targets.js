// @ts-check
/* ── add-work-targets.js — Add Work for the Class: where each piece goes (B6)
   No HTML and no DOM. A target is one class and one assessment, with its
   own staging model (AddWorkStage.stage, unchanged). The page's own class
   and assessment is the first target. One pile, two classes adds the other
   class's same-titled assessment as a second target. A late paper's piece
   moved to another assessment of its student's class goes to that
   assessment's target (made when first needed).

   Each student has one home target: their class's target for the page's
   assessment (the first class's, or the second's). Their row on the page is
   that target's row. A late piece stays on the student's row on screen
   but belongs to its own target, with its own Already In and choices.

   AddWorkTargets.create(main, read) → a set. `main` and every class added:
     { cid, aid, a, list, subs, name }: the class and assessment, the
     assessment, the students listed (roster order), their work in that
     assessment (sid → submission or null), the class's name. read(cid, aid)
     answers the same for another assessment of a class, for a late paper,
     or null when it can't be had.
   The set answers the staging model's own calls (rows, row, choices, place,
   move, takeOff, choose, setOnPaper, setHad, note, drop, counts,
   buttonLabel, footerText, writes), for every target at once: a student's
   calls go to their home target, a piece's to the target that holds it.
   And: targets(), main(), classes() (the home targets), home(sid),
   holder(pid) ({ t, sid, piece }), late(sid) ([{ t, piece }]),
   setFor(sid, pid, aid) (a piece to another assessment), addClass(given),
   removeClass() (→ the pieces that were on the second class), subs().

   AddWorkTargets.run(set, apiFor, opts): every target's writes, one target
   after another, each through AddWorkStage.run with apiFor(t) (that
   target's class and assessment). class_full or storage_full stops that
   target only; the others still run. → Promise of { added, paper,
   stopped, said, closed, total }; `said` names the class when there are
   two. */
/** @type {any} */ (window).AddWorkTargets = (function () {
  'use strict';

  function _had(sub) {
    if (!sub) return 'none';
    return sub.on_paper ? 'paper' : 'work';
  }

  function _target(given, home) {
    var subs = given.subs || {};
    return {
      key: given.cid + '|' + given.aid,
      cid: given.cid,
      aid: given.aid,
      a: given.a || null,
      name: String(given.name || ''),
      home: !!home,
      list: (given.list || []).slice(),
      subs: subs,
      stage: AddWorkStage.stage(
        (given.list || []).map(function (st) {
          return { id: st.id, had: _had(subs[st.id]) };
        }),
      ),
    };
  }

  function _ready(r) {
    if (r.onPaper) return true;
    if (!r.pieces.length) return false;
    return r.had === 'none' || r.choice === 'add' || r.choice === 'replace';
  }

  function create(main, read) {
    var all = [_target(main, true)];

    function targets() {
      return all.slice();
    }
    function classes() {
      return all.filter(function (t) {
        return t.home;
      });
    }
    function home(sid) {
      return (
        classes().find(function (t) {
          return !!t.stage.row(sid);
        }) || null
      );
    }
    // The targets a student's pieces can be in: their class's.
    function _theirs(sid) {
      var h = home(sid);
      var cid = h ? h.cid : null;
      return cid
        ? all.filter(function (t) {
            return t.cid === cid;
          })
        : [];
    }
    function holder(pid) {
      for (var i = 0; i < all.length; i++) {
        var rows = all[i].stage.rows();
        for (var j = 0; j < rows.length; j++) {
          var piece = rows[j].pieces.find(function (p) {
            return p.id === pid;
          });
          if (piece) return { t: all[i], sid: rows[j].sid, piece: piece };
        }
      }
      return null;
    }
    function late(sid) {
      var out = [];
      all.forEach(function (t) {
        if (t.home) return;
        var r = t.stage.row(sid);
        if (r)
          r.pieces.forEach(function (piece) {
            out.push({ t: t, piece: piece });
          });
      });
      return out;
    }

    // A piece taken from one target and put in another, keeping its id (the
    // screen holds its picture by id). → { ok, piece } or { ok: false, reason }.
    function _carry(from, sid, pid, to, toSid) {
      var gone = from.stage.takeOff(sid, pid);
      if (!gone.length) return { ok: false, reason: 'empty' };
      var old = gone[0];
      var placed = to.stage.place(toSid, { from: old.from, pages: old.pages });
      if (!placed.ok) {
        var back = from.stage.place(sid, { from: old.from, pages: old.pages });
        if (back.ok) back.piece.id = old.id;
        return placed;
      }
      placed.piece.id = old.id;
      return placed;
    }

    /* ── The staging model's calls, across targets ── */
    function rows() {
      var out = [];
      classes().forEach(function (t) {
        out = out.concat(t.stage.rows());
      });
      return out;
    }
    function row(sid) {
      var h = home(sid);
      return h ? h.stage.row(sid) : null;
    }
    function choices(sid) {
      var h = home(sid);
      return h ? h.stage.choices(sid) : [];
    }
    function place(sid, given) {
      var h = home(sid);
      return h ? h.stage.place(sid, given) : { ok: false, reason: 'not_found' };
    }
    function move(fromSid, toSid, pid) {
      var to = home(toSid);
      if (!home(fromSid) || !to) return { ok: false, reason: 'not_found' };
      if (fromSid === toSid) return { ok: false, reason: 'same' };
      var ids = pid
        ? [pid]
        : _theirs(fromSid).reduce(function (list, t) {
            var r = t.stage.row(fromSid);
            return list.concat(
              r
                ? r.pieces.map(function (p) {
                    return p.id;
                  })
                : [],
            );
          }, []);
      var moved = [];
      for (var i = 0; i < ids.length; i++) {
        var h = holder(ids[i]);
        if (!h || h.sid !== fromSid) continue;
        // A late piece moved to someone else goes to their page's assessment.
        var res = h.t === to ? to.stage.move(fromSid, toSid, ids[i]) : _carry(h.t, fromSid, ids[i], to, toSid);
        if (!res.ok) return moved.length ? { ok: true, moved: moved } : res;
        moved = moved.concat(res.moved || [res.piece]);
      }
      return moved.length ? { ok: true, moved: moved } : { ok: false, reason: 'empty' };
    }
    function takeOff(sid, pid) {
      if (pid) {
        var h = holder(pid);
        return h && h.sid === sid ? h.t.stage.takeOff(sid, pid) : [];
      }
      return _theirs(sid).reduce(function (gone, t) {
        return gone.concat(t.stage.takeOff(sid));
      }, []);
    }
    function choose(sid, choice) {
      var h = home(sid);
      return h ? h.stage.choose(sid, choice) : false;
    }
    function setOnPaper(sid, on) {
      var h = home(sid);
      return h ? h.stage.setOnPaper(sid, on) : false;
    }
    function setHad(sid, had, choice) {
      var h = home(sid);
      if (h) h.stage.setHad(sid, had, choice);
    }
    function note(sid, text) {
      var h = home(sid);
      if (h) h.stage.note(sid, text);
    }
    function drop(sid) {
      return _theirs(sid).reduce(function (gone, t) {
        return gone.concat(t.stage.drop(sid));
      }, []);
    }

    /* Counts over every target. A student is counted once however many
       targets they are ready in; Not In is the page's assessment only (a
       late paper does not hand in the page's). */
    function counts() {
      var out = { ready: 0, decide: 0, notIn: 0, files: 0, pages: 0, paper: 0, replace: 0 };
      var ready = {};
      all.forEach(function (t) {
        var c = t.stage.counts();
        out.decide += c.decide;
        out.files += c.files;
        out.pages += c.pages;
        out.paper += c.paper;
        out.replace += c.replace;
        if (t.home) out.notIn += c.notIn;
        t.stage.rows().forEach(function (r) {
          if (_ready(r)) ready[r.sid] = true;
        });
      });
      out.ready = Object.keys(ready).length;
      return out;
    }
    function buttonLabel() {
      var n = counts().ready;
      return 'Add Work for ' + n + (n === 1 ? ' Student' : ' Students');
    }
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
    function writes() {
      return all.reduce(function (out, t) {
        return out.concat(
          t.stage.writes().map(function (w) {
            return Object.assign({ cid: t.cid, aid: t.aid }, w);
          }),
        );
      }, []);
    }

    /* ── Late papers ── */
    // The target for `aid` in `cid`: the class's own, a late one, or a new one.
    function _for(cid, aid) {
      var t = all.find(function (x) {
        return x.cid === cid && x.aid === aid;
      });
      if (t) return t;
      var given = typeof read === 'function' ? read(cid, aid) : null;
      if (!given) return null;
      t = _target(Object.assign({}, given, { cid: cid, aid: aid }), false);
      all.push(t);
      return t;
    }

    /* Piece `pid` of student `sid` to assessment `aid` of their class.
       → { ok, piece, t } or { ok: false, reason }. */
    function setFor(sid, pid, aid) {
      var h = holder(pid);
      var hm = home(sid);
      if (!h || h.sid !== sid || !hm) return { ok: false, reason: 'not_found' };
      if (h.t.aid === aid) return { ok: true, piece: h.piece, t: h.t };
      var to = _for(hm.cid, aid);
      if (!to || !to.stage.row(sid)) return { ok: false, reason: 'not_found' };
      var res = _carry(h.t, sid, pid, to, sid);
      return res.ok ? { ok: true, piece: res.piece, t: to } : res;
    }

    /* ── Two classes ── */
    function addClass(given) {
      if (classes().length >= 2) return null;
      var t = _target(given, true);
      all.push(t);
      return t;
    }
    // The second class, and its late targets, leave. → every piece they held.
    function removeClass() {
      var second = classes()[1];
      if (!second) return [];
      var pieces = [];
      all = all.filter(function (t) {
        if (t.cid !== second.cid) return true;
        t.stage.rows().forEach(function (r) {
          pieces = pieces.concat(r.pieces);
        });
        return false;
      });
      return pieces;
    }

    // The students' work in the page's assessment, each in their own class.
    function subs() {
      var out = {};
      classes().forEach(function (t) {
        t.list.forEach(function (st) {
          out[st.id] = t.subs[st.id] || null;
        });
      });
      return out;
    }

    return {
      rows: rows,
      row: row,
      choices: choices,
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
      targets: targets,
      main: function () {
        return all[0];
      },
      classes: classes,
      home: home,
      holder: holder,
      late: late,
      setFor: setFor,
      addClass: addClass,
      removeClass: removeClass,
      subs: subs,
    };
  }

  /* Every target's writes, one target after another. */
  function run(set, apiFor, opts) {
    opts = opts || {};
    var list = set.targets().filter(function (t) {
      return t.stage.writes().length > 0;
    });
    var two = set.classes().length > 1;
    var totals = list.map(function (t) {
      return t.stage.writes().reduce(function (n, w) {
        return n + (w.kind === 'paper' ? w.sids.length : 1);
      }, 0);
    });
    var total = totals.reduce(function (a, b) {
      return a + b;
    }, 0);
    var out = { added: 0, paper: 0, stopped: null, said: '', closed: false, total: total };
    var said = [];
    var before = 0;
    return list
      .reduce(function (chain, t, i) {
        return chain.then(function () {
          if (out.closed) return;
          var base = before;
          before += totals[i];
          return AddWorkStage.run(t.stage, apiFor(t), {
            alive: opts.alive,
            release: opts.release,
            progress: function (n) {
              if (opts.progress) opts.progress(Math.min(base + n, total), total);
            },
          }).then(function (one) {
            out.added += one.added;
            out.paper += one.paper;
            if (one.closed) out.closed = true;
            if (one.stopped && !out.stopped) out.stopped = one.stopped;
            if (one.said) said.push(two ? t.name + ': ' + one.said : one.said);
          });
        });
      }, Promise.resolve())
      .then(function () {
        out.said = said
          .filter(function (x, i) {
            return said.indexOf(x) === i;
          })
          .join(' ');
        return out;
      });
  }

  return { create: create, run: run };
})();
