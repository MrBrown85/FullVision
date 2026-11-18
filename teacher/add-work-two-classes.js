// @ts-check
/* ── add-work-two-classes.js — Add Work for the Class: one pile, two
   classes; a late paper (B6) ─────────────────────────────────────────
   The screen's part of slice B6 (docs/plans/add-work-for-class-plan.md);
   where each piece goes is teacher/add-work-targets.js.

   One pile, two classes. Offered only when another class of this teacher
   has an assessment with the same title (capitals and spaces aside,
   nothing looser) on which Add Work for the Class is offered. The teacher
   turns it on; it is never on by itself, and there are two classes at
   most. The other class is read without changing the class the app is on
   (loadClass and refreshStudentWork, as the class picker's preload does);
   when it can't be read, one plain line says so and the choice stays off.
   Signed in, a class or student whose id is still a local one (not saved
   yet, CLAUDE.md rule 6) is not used. With it on, both classes' students
   are listed, each class under its name; names matched from files, the
   Waiting tray and Split the Scan search both lists and show the class, so
   a name in both classes is offered, never taken; Class List Order is not
   offered. Turned on after files were placed, every file the app matched
   by its name is matched again against both (_matchAgain). Turning it off
   puts every piece on the second class's students back in the Waiting
   tray, and the files waiting by their names are matched again against
   the one class (never placed).

   A late paper. Each piece has a For choice: the page's assessment to
   start, or another of the student's class on which Add Work for the Class
   is offered. A piece for another assessment stays on the student's row,
   with that assessment's Already In and choices. It never sets Late,
   Missing or a zero.

   AddWorkTwoClasses.barHtml(s, ctx)   the switch, above the students.
   AddWorkTwoClasses.heading(s, sid, kind)  a class's name before its first row.
   AddWorkTwoClasses.label(s, sid)     " · Block A" with two classes on.
   AddWorkTwoClasses.classTag(s, sid)  the class beside a Not In student.
   AddWorkTwoClasses.forHtml(s, sid, piece, ctx)  a piece's For choice.
   AddWorkTwoClasses.lateHtml(s, sid, ctx)  a student's pieces for other assessments.
   AddWorkTwoClasses.splitOpts(s)      Split the Scan's lists with two classes.
   AddWorkTwoClasses.click / change(s, …, ctx) → true when taken.
   AddWorkTwoClasses.candidates(s, ctx), turnOn(s, cid, ctx), turnOff(s, ctx).
   AddWorkTwoClasses.carryFor(s, given, placed)  a waiting file's For choice, again. */
/** @type {any} */ (window).AddWorkTwoClasses = (function () {
  'use strict';

  var X_ICON =
    '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg>';

  function _title(t) {
    return String(t || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  function _signedIn() {
    return typeof isDemoMode === 'function' ? !isDemoMode() : true;
  }
  function _saved(id) {
    return !_signedIn() || (typeof _isUuid === 'function' ? _isUuid(id) : true);
  }

  function _two(s) {
    return s.stage.classes().length > 1;
  }

  function _name(cid) {
    var c = (typeof COURSES !== 'undefined' && COURSES[cid]) || {};
    return String(c.name || 'Another class');
  }

  /* The other classes with this assessment's title: [{ cid, aid, name }]. A
     class not loaded yet is checked again when it is turned on. */
  function candidates(s, ctx) {
    var want = _title(s.a && s.a.title);
    if (!want || typeof COURSES === 'undefined') return [];
    var out = [];
    Object.keys(COURSES).forEach(function (cid) {
      if (cid === s.cid || (typeof isCourseArchived === 'function' && isCourseArchived(cid)) || !_saved(cid)) return;
      var a = (getAssessments(cid) || []).find(function (x) {
        return x && !x.isDraft && _title(x.title) === want;
      });
      if (!a) return;
      var loaded = typeof isClassLoaded !== 'function' || isClassLoaded(cid);
      if (loaded && !ctx.offered(cid, a)) return;
      out.push({ cid: cid, aid: a.id, name: _name(cid) });
    });
    return out;
  }

  function _st(s) {
    return s.twoState || (s.twoState = { line: '', reading: '', pick: '' });
  }

  // html-safe: class names and words go through esc; ids are ours (esc too)
  function barHtml(s, ctx) {
    if (s.view !== 'stage') return '';
    var st = _st(s);
    var on = _two(s);
    var list = on ? [] : candidates(s, ctx);
    if (!on && !list.length) return '';
    var other = on ? s.stage.classes()[1] : null;
    var pick =
      st.pick &&
      list.some(function (c) {
        return c.cid === st.pick;
      })
        ? st.pick
        : list[0] && list[0].cid;
    var off = s.busy || st.reading ? ' disabled' : '';
    var line = st.reading
      ? 'Reading ' + st.reading + '…'
      : st.line ||
        (on
          ? 'Both classes are listed. Each student’s pages go to their own class.'
          : (list.length === 1 ? list[0].name : 'Another class') +
            ' has ' +
            (s.a.title || 'this assessment') +
            ' too. Turn this on when the pile has papers from both.');
    var html =
      '<section class="awc-two" aria-label="Two Classes">' +
      '<button type="button" class="awc-two-switch" role="switch" data-awc="two" data-key="two" aria-checked="' +
      on +
      '"' +
      off +
      '><span class="awc-two-track" aria-hidden="true"><span class="awc-two-knob"></span></span>' +
      '<span>This Pile Has Two Classes</span></button>';
    if (on) html += '<span class="awc-two-name">' + esc(other.name) + '</span>';
    else if (list.length > 1)
      html +=
        '<label class="awc-two-pick"><span class="awc-sr">The other class</span><select data-awc-two-pick' +
        off +
        '>' +
        list
          .map(function (c) {
            return (
              '<option value="' +
              esc(c.cid) +
              '"' +
              (c.cid === pick ? ' selected' : '') +
              '>' +
              esc(c.name) +
              '</option>'
            );
          })
          .join('') +
        '</select></label>';
    return html + '<p class="awc-two-line" role="status">' + esc(line) + '</p></section>';
  }

  function _list(cid, a, ctx) {
    return ctx.students(cid, a) || [];
  }

  /* The other class turned on: read, checked, added. → Promise. */
  function turnOn(s, cid, ctx) {
    var st = _st(s);
    var c = candidates(s, ctx).find(function (x) {
      return x.cid === cid;
    });
    if (!c || _two(s)) return Promise.resolve(false);
    st.reading = c.name;
    st.line = '';
    ctx.draw({ focus: 'two' });
    var load = typeof loadClass === 'function' ? loadClass(cid) : Promise.resolve();
    return Promise.resolve(load)
      .then(function () {
        return typeof refreshStudentWork === 'function' ? refreshStudentWork(cid, { force: true }) : { changed: false };
      })
      .then(null, function (e) {
        return { error: e };
      })
      .then(function (res) {
        var ok = false;
        if (ctx.state() !== s) return false;
        st.reading = '';
        // Add Work pressed meanwhile, or the summary showing: dropped, unsaid.
        if (s.view !== 'stage' || s.busy) return false;
        var given = res && res.error ? null : ctx.read(cid, c.aid);
        var students = given ? getStudents(cid) || [] : [];
        if (!given || !students.length) {
          st.line = c.name + ' can’t be read right now. Check the connection and try again.';
        } else if (
          !_saved(cid) ||
          !given.list.every(function (x) {
            return _saved(x.id);
          })
        ) {
          st.line = c.name + ' is still saving. Try again in a moment.';
        } else {
          given.name = c.name;
          s.stage.addClass(given);
          given.list.forEach(function (x) {
            s.byId[x.id] = x;
          });
          s.subs = s.stage.subs();
          st.line = _againLine(_matchAgain(s, ctx));
          ok = true;
        }
        ctx.draw({ focus: 'two' });
        return ok;
      });
  }

  function _twoFiles(n) {
    return n === 1 ? '1 file' : n + ' files';
  }
  // The line under the switch once it is on: what moved, or the usual line.
  function _againLine(n) {
    var parts = [];
    if (n.back) parts.push(_twoFiles(n.back) + ' went back to Waiting for a Student');
    if (n.placed) parts.push(n.placed === 1 ? '1 waiting file was placed' : n.placed + ' waiting files were placed');
    if (!parts.length) return '';
    var said = parts.join(', and ');
    return 'Both classes are listed. ' + said.charAt(0).toUpperCase() + said.slice(1) + '.';
  }

  /* With both classes listed, every file the app matched by its name is
     matched again, as if it were dropped now. One still certain for the
     same student stays; any other goes back to waiting, saying why, and is
     never moved to another student. So the switch's order changes nothing,
     but in one case: a name certain for one student in each view (the
     first class's Noor Al-Rashid, then the second class's Al Rashid) waits
     when the files came first, where a drop with the switch on places it.
     Waiting is the safe answer. A file the teacher placed or moved, and a
     piece from Split the Scan (named by the teacher or by its sticker), is
     not matched by name and is left alone. A For choice the teacher made
     goes with the file to the tray (carryFor). → { back, placed }. */
  function _matchAgain(s, ctx) {
    var out = { back: 0, placed: 0 };
    if (!s.tray || typeof s.tray.again !== 'function' || !s.byName) return out;
    // Waiting files first, so a file sent back below is not placed again.
    out.placed = s.tray.again(true);
    var held = [];
    Object.keys(s.byName).forEach(function (pid) {
      var h = s.stage.holder(pid);
      if (!h) {
        delete s.byName[pid];
        return;
      }
      var m = s.tray.match(h.piece.from);
      if (m.kind === 'one' && m.sid === h.sid) return;
      delete s.byName[pid];
      // Only a choice the teacher made: the class's own assessment is the default.
      var chose = h.t.home ? null : { forCid: h.t.cid, forAid: h.t.aid };
      var gone = s.stage.takeOff(h.sid, pid);
      ctx.release(gone);
      gone.forEach(function (p) {
        held.push({ from: p.from, pages: p.pages, m: m, chose: chose });
      });
    });
    // In the order of their names, as a drop of them would be.
    held.sort(function (a, b) {
      return NameMatch.compare(a.from, b.from);
    });
    held.forEach(function (x) {
      s.tray.hold(x.from, x.pages, x.m, Object.assign({ byName: true, noAuto: true }, x.chose));
    });
    out.back = held.length;
    return out;
  }

  function _twoAssessment(cid, aid) {
    return (
      (getAssessments(cid) || []).find(function (x) {
        return x && x.id === aid;
      }) || null
    );
  }
  function _twoTitle(cid, aid) {
    var a = _twoAssessment(cid, aid);
    return (a && a.title) || 'that assessment';
  }

  /* A waiting file's For choice, made by the teacher before it went back,
     put on it again when it is placed: on a student of the same class it is
     for that assessment again; in the other class, which doesn't have it,
     it is for that class's own, and the row says so. → the placing. */
  function carryFor(s, given, placed) {
    var home = s.stage.home(given.sid);
    if (!placed.ok || !given.forAid || !home) return placed;
    var file = given.from || 'This file';
    var now = ' It is for ' + ((home.a && home.a.title) || 'this assessment') + '.';
    if (home.cid !== given.forCid) {
      s.stage.note(
        given.sid,
        file +
          ' was for ' +
          _twoTitle(given.forCid, given.forAid) +
          ' in ' +
          _name(given.forCid) +
          '.' +
          now.replace(' It is', ' Here it is'),
      );
      return placed;
    }
    var res = s.stage.setFor(given.sid, placed.piece.id, given.forAid);
    if (res.ok) return { ok: true, piece: res.piece };
    var a = _twoAssessment(given.forCid, given.forAid);
    var st = s.byId[given.sid];
    var who = st && typeof displayNameWithLast === 'function' ? displayNameWithLast(st) : 'this student';
    var said =
      !a || (res.reason !== 'not_found' && res.reason !== 'too_many_pages')
        ? // The assessment is gone, or something else: as before.
          (given.from || 'That file') + ' couldn’t go to ' + ((a && a.title) || 'that assessment') + '.'
        : file +
          ' was for ' +
          (a.title || 'Untitled') +
          (res.reason === 'too_many_pages'
            ? ', where ' + who + ' has no room for more pages.'
            : ', which ' + who + ' is not part of.') +
          now;
    s.stage.note(given.sid, said);
    return placed;
  }

  /* The second class off: its students leave the page, and every piece that
     was on them waits in the tray, matched again by nobody. */
  function turnOff(s, ctx) {
    var second = s.stage.classes()[1];
    if (!second) return 0;
    var pieces = s.stage.removeClass();
    ctx.release(pieces);
    second.list.forEach(function (x) {
      delete s.byId[x.id];
    });
    s.scanOrder = s.scanOrder.filter(function (sid) {
      return !!s.stage.home(sid);
    });
    s.subs = s.stage.subs();
    // The files waiting by their names: matched again against one class, never placed.
    if (s.tray && typeof s.tray.again === 'function') s.tray.again(false);
    var st = _st(s);
    st.line = pieces.length
      ? (pieces.length === 1 ? '1 file' : pieces.length + ' files') +
        ' from ' +
        second.name +
        ' went back to Waiting for a Student.'
      : '';
    if (pieces.length)
      s.tray.placeOrHold(
        pieces.map(function (p) {
          return { sid: '', from: p.from, pages: p.pages };
        }),
      );
    ctx.draw({ focus: 'two' });
    return pieces.length;
  }

  function heading(s, sid, kind) {
    if (!_two(s)) return '';
    var t = s.stage.home(sid);
    var rows = t ? t.stage.rows() : [];
    if (!rows.length || rows[0].sid !== sid) return '';
    return kind === 'card'
      ? '<h3 class="awc-class-head is-card">' + esc(t.name) + '</h3>'
      : '<div class="awc-class-head" role="row"><span role="rowheader">' + esc(t.name) + '</span></div>';
  }

  function label(s, sid) {
    if (!_two(s)) return '';
    var t = s.stage.home(sid);
    return t ? ' · ' + t.name : '';
  }

  function classTag(s, sid) {
    var l = label(s, sid);
    return l ? '<span class="awc-class-tag">' + esc(l.slice(3)) + '</span>' : '';
  }

  function splitOpts(s) {
    if (!_two(s)) return null;
    return {
      list: s.stage.classes().reduce(function (all, t) {
        return all.concat(t.list);
      }, []),
      label: function (sid) {
        return label(s, sid);
      },
      had: function (sid) {
        return !!s.subs[sid];
      },
      noListOrder: true,
      // Both classes, for their sticker codes (B4).
      cids: s.stage.classes().map(function (t) {
        return t.cid;
      }),
    };
  }

  /* ── A late paper ── */
  // The assessments a piece of this class can be for. Kept while the page is open.
  function _choicesFor(s, cid, ctx) {
    s.forCache = s.forCache || {};
    if (!s.forCache[cid])
      s.forCache[cid] = (getAssessments(cid) || []).filter(function (a) {
        return a && ctx.offered(cid, a);
      });
    return s.forCache[cid];
  }

  // html-safe: titles go through esc; ids are ours (esc too)
  function forHtml(s, sid, piece, ctx) {
    var h = s.stage.holder(piece.id);
    var home = s.stage.home(sid);
    if (!h || !home) return '';
    var list = _choicesFor(s, home.cid, ctx);
    if (list.length < 2) return '';
    return (
      '<label class="awc-for"><span>For</span><select data-awc-for data-sid="' +
      esc(sid) +
      '" data-piece="' +
      esc(piece.id) +
      '" data-key="for:' +
      esc(piece.id) +
      '" aria-label="' +
      esc('Which assessment ' + (piece.from || 'this file') + ' is for') +
      '"' +
      (s.busy ? ' disabled' : '') +
      '>' +
      list
        .map(function (a) {
          return (
            '<option value="' +
            esc(a.id) +
            '"' +
            (a.id === h.t.aid ? ' selected' : '') +
            '>' +
            esc(a.title || 'Untitled') +
            '</option>'
          );
        })
        .join('') +
      '</select></label>'
    );
  }

  // html-safe: names, titles and file names go through esc; ids are ours (esc too); icons are fixed
  function lateHtml(s, sid, ctx) {
    var late = s.stage.late(sid);
    if (!late.length) return '';
    var off = s.busy ? ' disabled' : '';
    var html = '';
    var shown = {};
    late.forEach(function (x) {
      var url = s.urls[x.piece.id];
      html +=
        '<div class="awc-chip is-late" data-piece="' +
        esc(x.piece.id) +
        '" data-sid="' +
        esc(sid) +
        '">' +
        (url ? '<span class="awc-thumb"><img src="' + esc(url) + '" alt=""></span>' : '') +
        '<span class="awc-file-name">' +
        esc(x.piece.from || 'File') +
        '</span>' +
        '<span class="awc-pages">' +
        esc(x.piece.pages.length + (x.piece.pages.length === 1 ? ' page' : ' pages')) +
        '</span>' +
        forHtml(s, sid, x.piece, ctx) +
        '<button type="button" class="awc-off" data-awc="off" data-sid="' +
        esc(sid) +
        '" data-piece="' +
        esc(x.piece.id) +
        '" data-key="off:' +
        esc(x.piece.id) +
        '" aria-label="Take this file off" title="Take this file off"' +
        off +
        '>' +
        X_ICON +
        '</button></div>';
      // That assessment's Already In and choices, once for each.
      if (shown[x.t.key]) return;
      shown[x.t.key] = true;
      var r = x.t.stage.row(sid);
      if (!r || r.had === 'none') return;
      var title = (x.t.a && x.t.a.title) || 'that assessment';
      html +=
        '<div class="awc-late-in"><span class="awc-had">' +
        esc((r.had === 'paper' ? 'Handed in on paper' : 'Already has work') + ' in ' + title) +
        '</span><div class="awc-choices" role="group" aria-label="' +
        esc('What to do in ' + title) +
        '">' +
        x.t.stage
          .choices(sid)
          .map(function (choice) {
            var on = r.choice === choice;
            return (
              '<button type="button" class="awc-choice' +
              (on ? ' is-on' : '') +
              '" data-awc="lateChoice" data-target="' +
              esc(x.t.key) +
              '" data-sid="' +
              esc(sid) +
              '" data-choice="' +
              choice +
              '" aria-pressed="' +
              on +
              '"' +
              off +
              '>' +
              esc(choice === 'add' ? 'Add as More Pages' : choice === 'replace' ? 'Replace Them' : 'Skip') +
              '</button>'
            );
          })
          .join('') +
        '</div></div>';
    });
    return html + '<p class="awc-late-hint">Changing which assessment a file is for doesn’t set Late.</p>';
  }

  /* ── Events ── */
  function click(s, what, btn, ctx) {
    if (what === 'two') {
      if (_two(s)) turnOff(s, ctx);
      else {
        var sel = /** @type {any} */ (s.overlay.querySelector('[data-awc-two-pick]'));
        var list = candidates(s, ctx);
        var cid = (sel && sel.value) || (list[0] && list[0].cid);
        if (cid) turnOn(s, cid, ctx);
      }
      return true;
    }
    if (what === 'lateChoice') {
      var key = btn.getAttribute('data-target');
      var t = s.stage.targets().find(function (x) {
        return x.key === key;
      });
      if (t) t.stage.choose(btn.getAttribute('data-sid'), btn.getAttribute('data-choice'));
      ctx.draw();
      return true;
    }
    return false;
  }

  function change(s, el, ctx) {
    if (el.hasAttribute && el.hasAttribute('data-awc-two-pick')) {
      _st(s).pick = el.value;
      ctx.draw({ focus: 'two' });
      return true;
    }
    if (!el.hasAttribute || !el.hasAttribute('data-awc-for')) return false;
    var sid = el.getAttribute('data-sid');
    var pid = el.getAttribute('data-piece');
    var res = s.stage.setFor(sid, pid, el.value);
    if (!res.ok)
      s.headNote =
        res.reason === 'too_many_pages'
          ? 'A piece of work can have 30 pages at most.'
          : 'That file couldn’t be moved to that assessment.';
    ctx.draw({ focus: 'for:' + pid });
    return true;
  }

  return {
    candidates: candidates,
    turnOn: turnOn,
    turnOff: turnOff,
    carryFor: carryFor,
    barHtml: barHtml,
    heading: heading,
    label: label,
    classTag: classTag,
    splitOpts: splitOpts,
    forHtml: forHtml,
    lateHtml: lateHtml,
    click: click,
    change: change,
  };
})();
