/* ── work-wall.js — seeing everyone's work (S14-F1 to F2) ──────────────
   The Work Wall: one assessment's work side by side, a card per student
   with the first page's thumbnail, sorted by Name, To Grade First or Level,
   filtered by level, To Grade or Not In. A card opens the student's pages
   full size; Grade in This Order opens the grader (PageAssignments.
   openGrader, unchanged) on the students shown, in the order shown.

   The Work tab: one student's work in one place on the teacher's student
   page (teacher/page-student.js draws the tab and calls tabHtml / mountTab
   here), filtered by competency, by where it stands (To Grade, To Return,
   Returned) and by category, newest or oldest first, each piece with its
   level. A filter redraws only the cards, which slide to their new places.

   Both are teacher views, so they read all work, drafts included (Colin,
   "Keep all grades", DECISIONS 2026-11-10 night 3); a draft is marked.
   Every level and grade is shown through calc.js (assessmentCellValue,
   formatLevel, rubricCriterionLevel, nearestScoreLevel, tagMarksByAssessment)
   in the class's grading style. Every count of To Grade and Not In comes
   from GraderWork (shared/grader.js). Every picture comes through
   WorkThumbs (shared/work-thumbs.js): the wall and the tab ask for
   thumbnails only; a whole page is asked for only once it is opened.

   Only in a class whose student page (the build switch) and Send Work are
   on, on a piece whose Students Send is not Nothing (GraderWork.workOn).
   Demo Mode only for now: nothing here calls the server.

   WorkWall.open(cid, aid, opts)  the wall over the page; false when work is
                                  off for that piece. opts.onClose(); and
                                  opts.onGrade(sid, studentIds) for a screen
                                  with its own grader (the phone), in place
                                  of PageAssignments.openGrader.
   WorkWall.close(), WorkWall.isOpen()
   WorkWall.tabOn(cid)            whether the student page shows a Work tab.
   WorkWall.tabSummary(cid, sid)  { stat } or { badge, tone } for the tab.
   WorkWall.tabHtml(cid, sid)     the tab's panel.
   WorkWall.mountTab(panel, cid, sid, { onChange })  pictures and clicks.
   WorkWall.unmountTab()          lets the tab's pictures go. */
window.WorkWall = (function () {
  'use strict';

  var LEVELS = [4, 3, 2, 1];
  var SORTS = [
    { id: 'name', label: 'Name' },
    { id: 'tograde', label: 'To Grade First' },
    { id: 'level', label: 'Level' },
  ];

  /* ── Shared reads ─────────────────────────────────────────── */
  function _piece(cid, aid) {
    return (
      (getAssessments(cid) || []).find(function (a) {
        return a && a.id === aid;
      }) || null
    );
  }

  function _focus(el) {
    if (el && typeof el.focus === 'function') el.focus();
  }

  function _roster(cid) {
    return sortStudents(getStudents(cid) || [], 'lastName');
  }

  function _day(iso) {
    if (!iso) return '';
    var d = new Date(String(iso).length <= 10 ? iso + 'T00:00:00' : iso);
    return isNaN(d) ? '' : d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
  }

  function _pages(sub) {
    return ((sub && sub.files) || []).slice().sort(function (x, y) {
      return (x.page || 0) - (y.page || 0);
    });
  }

  /* What one student's piece shows on a card: { text, level, value, draft }.
     `by` is null for the whole piece, or { kind: 'criterion' | 'competency',
     id, obj }. level is the 1–4 band (0 for none), value the 0–4 level to
     sort by. */
  function _mark(cid, sid, a, by) {
    var cell = assessmentCellValue(cid, sid, a);
    var draft = typeof GradeState !== 'undefined' && GradeState.stateOf(cid, sid, a.id) === GradeState.DRAFT;
    var out = { text: '', level: 0, value: 0, draft: draft, toGrade: false };
    if (GraderWork.workStateOf(cid, a.id, sid) === 'tograde') {
      out.text = 'To Grade';
      out.toGrade = true;
      out.draft = false;
      return out;
    }
    if (cell.kind === 'status') {
      out.text = cell.text;
      return out;
    }
    if (by) {
      var v = null;
      if (by.kind === 'criterion') v = rubricCriterionLevel(cid, sid, a, by.obj);
      else {
        var m = (tagMarksByAssessment(cid, sid, by.id) || []).find(function (e) {
          return e.assessmentId === a.id;
        });
        v = m && m.score > 0 ? m.score : null;
      }
      if (!(v > 0)) return out;
      out.text = formatLevel(cid, v, '');
      out.level = nearestScoreLevel(v).level;
      out.value = v;
      return out;
    }
    if (cell.kind === 'points') {
      var max = a.maxPoints || 100;
      out.text = formatPoints(cell.value) + '/' + formatPoints(max);
      out.level = cell.level || 0;
      out.value = (Number(cell.value) / max) * 4;
    } else if (cell.kind === 'level' || cell.kind === 'complete') {
      out.text = cell.text;
      out.level = cell.kind === 'level' ? cell.level || 0 : 0;
      out.value = cell.kind === 'level' ? cell.value : 0;
    }
    return out;
  }

  function _chipHtml(mark) {
    if (!mark.text) return '';
    var cls = 'ww-chip' + (mark.toGrade ? ' is-tograde' : ' ww-lv-' + mark.level) + (mark.draft ? ' is-draft' : '');
    return (
      '<span class="' +
      cls +
      '"' +
      (mark.draft ? ' title="Draft: graded, not returned"' : '') +
      '>' +
      esc(mark.text) +
      (mark.draft ? '<span class="ww-sr">, Draft: graded, not returned</span>' : '') +
      '</span>'
    );
  }

  /* The criteria (rubric work) or competencies a piece can be looked at by. */
  function _views(cid, a) {
    if (a.rubricId && !isPointsScored(a)) {
      var rubric = getRubricById(cid, a.rubricId);
      var crits = (rubric && rubric.criteria) || [];
      return {
        label: 'Criterion',
        list: crits.map(function (c) {
          return { kind: 'criterion', id: c.id, name: c.name || c.label || 'Criterion', obj: c };
        }),
      };
    }
    if (isPointsScored(a) || isCompletionScored(a)) return { label: '', list: [] };
    var tags = scoreTagIds(a, cid).filter(function (t) {
      return !isUnlinkedTag(t);
    });
    if (tags.length < 2) return { label: '', list: [] };
    return {
      label: 'Competency',
      list: tags.map(function (t) {
        var sec = getSectionForTag(cid, t);
        var tag =
          sec &&
          (sec.tags || []).find(function (x) {
            return x.id === t;
          });
        return { kind: 'competency', id: t, name: (tag && tag.label) || (sec && sec.name) || t };
      }),
    };
  }

  /* ── The full-size viewer (both screens) ──────────────────────
     items: [{ cid, sid, aid }], each with pages in. Steps a page at a time
     and an item at a time; the whole page is asked for only here. */
  var _view = null;
  var _viewPics = null;

  function _viewItem() {
    if (!_view) return null;
    var it = _view.items[_view.at];
    if (!it) return null;
    var st = (getStudents(it.cid) || []).find(function (s) {
      return s.id === it.sid;
    });
    var a = _piece(it.cid, it.aid);
    var sub = getStudentSubmission(it.cid, it.sid, it.aid);
    return st && a && sub ? { it: it, st: st, a: a, sub: sub, pages: _pages(sub) } : null;
  }

  function _openViewer(items, at, opts) {
    _closeViewer(true);
    if (!items.length) return;
    _view = {
      items: items,
      at: Math.max(0, Math.min(at || 0, items.length - 1)),
      page: (opts && opts.page) || 0,
      step: (opts && opts.step) || 'Student',
      onGrade: (opts && opts.onGrade) || null,
      opener: document.activeElement,
    };
    _viewPics = WorkThumbs.holder();
    var overlay = document.createElement('div');
    overlay.id = 'work-viewer-overlay';
    overlay.className = 'wv-overlay';
    document.body.appendChild(overlay);
    overlay.addEventListener('mousedown', function (e) {
      if (e.target === overlay) _closeViewer();
    });
    overlay.addEventListener('click', _viewerClick);
    _view.overlay = overlay;
    _drawViewer();
    var close = overlay.querySelector('[data-wv="close"]');
    _focus(close);
  }

  function _drawViewer() {
    if (!_view) return;
    var v = _viewItem();
    if (!v) return _closeViewer();
    var n = v.pages.length;
    _view.page = Math.max(0, Math.min(_view.page, n - 1));
    var file = v.pages[_view.page];
    var name = displayName(v.st);
    var many = _view.items.length > 1;
    var step = _view.step;
    var html =
      '<div class="wv-dialog" role="dialog" aria-modal="true" aria-labelledby="wv-title">' +
      '<div class="wv-head">' +
      (many
        ? '<button type="button" class="wv-step" data-wv="item" data-dir="-1" aria-label="Previous ' +
          esc(step) +
          '"' +
          (_view.at === 0 ? ' disabled' : '') +
          '>‹</button>'
        : '') +
      '<div class="wv-titles"><h2 class="wv-title" id="wv-title">' +
      esc(name) +
      '</h2><span class="wv-sub">' +
      esc(v.a.title || '') +
      '</span></div>' +
      (many
        ? '<button type="button" class="wv-step" data-wv="item" data-dir="1" aria-label="Next ' +
          esc(step) +
          '"' +
          (_view.at === _view.items.length - 1 ? ' disabled' : '') +
          '>›</button>'
        : '') +
      '<span class="wv-gap"></span>' +
      (_view.onGrade
        ? '<button type="button" class="btn btn-primary wv-grade" data-wv="grade">Open in Grader</button>'
        : '') +
      '<button type="button" class="btn wv-close" data-wv="close">Close</button>' +
      '</div>' +
      '<div class="wv-body">' +
      (file
        ? '<img class="wv-img" data-work-pic data-work-which="page" data-page="' +
          _view.page +
          '" alt="' +
          esc(name + "'s page " + (_view.page + 1)) +
          '">'
        : '') +
      '</div>' +
      '<div class="wv-foot">' +
      (n > 1
        ? '<button type="button" class="wv-step" data-wv="page" data-dir="-1" aria-label="Previous page"' +
          (_view.page === 0 ? ' disabled' : '') +
          '>‹</button><span class="wv-at">' +
          esc(_view.page + 1 + ' of ' + n) +
          '</span><button type="button" class="wv-step" data-wv="page" data-dir="1" aria-label="Next page"' +
          (_view.page === n - 1 ? ' disabled' : '') +
          '>›</button>'
        : '') +
      (v.sub.note
        ? '<p class="wv-note"><strong>' +
          esc(displayNameFirst(v.st) + "'s Note, Sent With the Work") +
          '</strong> ' +
          esc(v.sub.note) +
          '</p>'
        : '') +
      '</div></div>';
    // The picture being replaced lets go of its address.
    _viewPics.releaseAll();
    // html-safe: every name, title, note and number above goes through esc; the rest is fixed markup
    _view.overlay.innerHTML = html;
    var it = v.it;
    var shown = { sid: it.sid, aid: it.aid, file: file && file.id };
    _viewPics.fill(_view.overlay, it.cid, function (img) {
      var now = _viewItem();
      if (!now || now.it.sid !== shown.sid || now.it.aid !== shown.aid) return null;
      var f = now.pages[Number(img.getAttribute('data-page'))];
      return f && f.id === shown.file ? f : null;
    });
  }

  function _viewerClick(e) {
    var btn = e.target.closest && e.target.closest('[data-wv]');
    if (!btn || !_view || btn.disabled) return;
    var what = btn.getAttribute('data-wv');
    var dir = Number(btn.getAttribute('data-dir')) || 0;
    if (what === 'close') return _closeViewer();
    if (what === 'page') {
      _view.page += dir;
      return _drawViewer();
    }
    if (what === 'item') {
      _view.at = Math.max(0, Math.min(_view.items.length - 1, _view.at + dir));
      _view.page = 0;
      _drawViewer();
      var same = _view && _view.overlay.querySelector('[data-wv="item"][data-dir="' + dir + '"]');
      if (same && !same.disabled) _focus(same);
      return;
    }
    if (what === 'grade') {
      var it = _view.items[_view.at];
      var go = _view.onGrade;
      _closeViewer(true);
      if (go && it) go(it);
    }
  }

  function _closeViewer(quiet) {
    if (!_view) return;
    var opener = _view.opener;
    if (_viewPics) _viewPics.releaseAll();
    _viewPics = null;
    if (_view.overlay) _view.overlay.remove();
    _view = null;
    if (!quiet && opener && opener.isConnected) _focus(opener);
  }

  /* ── The Work Wall ────────────────────────────────────────── */
  var _wall = null; // { cid, aid, sort, filter, by, overlay, pics, onClose, opener }

  function _wallModel(w) {
    var cid = w.cid;
    var a = _piece(cid, w.aid);
    var roster = _roster(cid);
    var ids = roster.map(function (s) {
      return s.id;
    });
    var counts = GraderWork.workCounts(cid, a.id, ids);
    var views = _views(cid, a);
    var by =
      views.list.find(function (x) {
        return x.id === w.by;
      }) || null;
    // A pair or group still graded together is one piece of work to grade
    // (GraderWork counts it once): its members share a unit key.
    var unitOf = {};
    (groupGradingUnits(cid, a, ids) || []).forEach(function (u, n) {
      (u.linked || []).forEach(function (sid) {
        unitOf[sid] = 'u' + n;
      });
    });
    var rows = roster.map(function (st, i) {
      var sub = getStudentSubmission(cid, st.id, a.id);
      return {
        st: st,
        order: i,
        sub: sub,
        pages: _pages(sub),
        state: GraderWork.workStateOf(cid, a.id, st.id),
        mark: _mark(cid, st.id, a, by),
        unit: unitOf[st.id] || null,
      };
    });
    var byLevel = {};
    LEVELS.forEach(function (n) {
      byLevel[n] = rows.filter(function (r) {
        return r.mark.level === n;
      }).length;
    });
    return {
      a: a,
      rows: rows,
      views: views,
      by: by,
      counts: { all: rows.length, tograde: counts.tograde, notin: counts.notin, level: byLevel },
    };
  }

  function _shownRows(w, m) {
    var f = w.filter;
    var rows = m.rows.filter(function (r) {
      if (f === 'all') return true;
      if (f === 'tograde') return r.state === 'tograde';
      if (f === 'notin') return r.state === 'notin';
      return r.mark.level === Number(f);
    });
    // To Grade shows a card per piece of work, as it counts: one card for a
    // pair or group, the member whose work is in (or the first) standing
    // for it.
    if (f === 'tograde') rows = _onePerUnit(rows);
    var rank = function (r) {
      if (w.sort === 'tograde') return r.state === 'tograde' ? 0 : r.state === 'notin' ? 2 : 1;
      if (w.sort === 'level') return r.state === 'notin' ? 2 : r.mark.level ? 0 : 1;
      return 0;
    };
    return rows.slice().sort(function (x, y) {
      var d = rank(x) - rank(y);
      if (d) return d;
      if (w.sort === 'level' && x.mark.value !== y.mark.value) return y.mark.value - x.mark.value;
      return x.order - y.order;
    });
  }

  function _onePerUnit(rows) {
    var pick = {};
    rows.forEach(function (r) {
      if (!r.unit) return;
      var had = pick[r.unit];
      if (!had || (!had.pages.length && r.pages.length)) pick[r.unit] = r;
    });
    return rows.filter(function (r) {
      return !r.unit || pick[r.unit] === r;
    });
  }

  /* Cards in groups: one per level when sorted by Level or filtered to a
     level, else one group with no heading. */
  function _groups(w, rows) {
    var byLevel = w.sort === 'level' || LEVELS.indexOf(Number(w.filter)) >= 0;
    if (!byLevel) return [{ key: 'all', rows: rows }];
    var out = [];
    LEVELS.forEach(function (n) {
      var list = rows.filter(function (r) {
        return r.mark.level === n;
      });
      if (list.length) out.push({ key: 'lv' + n, level: n, title: scoreLevelText(n, 0), rows: list });
    });
    var none = rows.filter(function (r) {
      return !r.mark.level && r.state !== 'notin';
    });
    if (none.length) out.push({ key: 'none', title: 'No Level Yet', rows: none });
    var notin = rows.filter(function (r) {
      return !r.mark.level && r.state === 'notin';
    });
    if (notin.length) out.push({ key: 'notin', title: 'Not In', rows: notin });
    return out;
  }

  function _cardHtml(w, r) {
    var name = displayName(r.st);
    var first = r.pages[0];
    var pic = first
      ? '<img class="ww-img" data-work-pic data-sid="' +
        esc(r.st.id) +
        '" alt="' +
        esc(name + "'s first page") +
        '" loading="lazy">'
      : '<span class="ww-nopic">' +
        esc(r.sub && r.sub.on_paper ? 'Handed in on paper' : r.state === 'notin' ? 'Not In' : 'No work sent') +
        '</span>';
    return (
      '<button type="button" class="ww-card' +
      (first ? '' : ' is-empty') +
      '" data-ww="open" data-sid="' +
      esc(r.st.id) +
      '" data-cid="' +
      esc(w.cid) +
      '" data-aid="' +
      esc(w.aid) +
      '"><span class="ww-pic">' +
      pic +
      (r.pages.length > 1 ? '<span class="ww-count">' + esc(r.pages.length + ' pages') + '</span>' : '') +
      '</span><span class="ww-foot"><span class="ww-name">' +
      esc(name) +
      '</span>' +
      _chipHtml(r.mark) +
      '</span></button>'
    );
  }

  function _pill(w, id, label, n, dot) {
    var on = String(w.filter) === String(id);
    return (
      '<button type="button" class="ww-pill' +
      (dot ? ' ww-pill-lv ww-lv-' + id : ' ww-pill-work') +
      (id === 'all' ? ' ww-pill-all' : '') +
      (on ? ' is-on' : '') +
      '" data-ww="filter" data-filter="' +
      esc(String(id)) +
      '" aria-pressed="' +
      on +
      '">' +
      (dot ? '<span class="ww-dot" aria-hidden="true"></span>' : '') +
      esc(label + ' ' + n) +
      '</button>'
    );
  }

  function _wallHtml(w, m, canGrade) {
    var rows = _shownRows(w, m);
    var course = (typeof COURSES !== 'undefined' && COURSES[w.cid]) || {};
    var html =
      '<div class="ww-page" role="dialog" aria-modal="true" aria-labelledby="ww-title">' +
      '<div class="ww-bar">' +
      '<button type="button" class="ww-back" data-ww="close" aria-label="Back to Assignments">' +
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"></path></svg></button>' +
      '<div class="ww-titles"><h2 class="ww-title" id="ww-title">Work Wall</h2><span class="ww-sub">' +
      esc((m.a.title || '') + (course.name ? ' · ' + course.name : '')) +
      '</span></div><span class="ww-gap"></span>' +
      '<span class="ww-label" id="ww-sort-label">Sort</span>' +
      '<div class="ww-seg" role="group" aria-labelledby="ww-sort-label">' +
      SORTS.map(function (s) {
        var on = w.sort === s.id;
        return (
          '<button type="button" class="ww-seg-btn' +
          (on ? ' is-on' : '') +
          '" data-ww="sort" data-sort="' +
          s.id +
          '" aria-pressed="' +
          on +
          '">' +
          esc(s.label) +
          '</button>'
        );
      }).join('') +
      '</div>' +
      (canGrade
        ? '<button type="button" class="ww-grade" data-ww="grade"' +
          (rows.length ? '' : ' disabled') +
          '><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4l13 8-13 8z"></path></svg>Grade in This Order</button>'
        : '') +
      '</div>' +
      '<div class="ww-filters">' +
      _pill(w, 'all', 'All', m.counts.all) +
      LEVELS.map(function (n) {
        return _pill(w, n, scoreLevelText(n, 0), m.counts.level[n], true);
      }).join('') +
      _pill(w, 'tograde', 'To Grade', m.counts.tograde) +
      _pill(w, 'notin', 'Not In', m.counts.notin) +
      '<span class="ww-gap"></span>' +
      (m.views.list.length
        ? '<label class="ww-label" for="ww-by">' +
          esc(m.views.label) +
          '</label><select id="ww-by" class="ww-by" data-ww="by">' +
          '<option value=""' +
          (m.by ? '' : ' selected') +
          '>Whole Piece</option>' +
          m.views.list
            .map(function (x) {
              return (
                '<option value="' +
                esc(x.id) +
                '"' +
                (m.by && m.by.id === x.id ? ' selected' : '') +
                '>' +
                esc(x.name) +
                '</option>'
              );
            })
            .join('') +
          '</select>'
        : '') +
      '</div>' +
      '<div class="ww-scroll">';
    if (!rows.length) {
      html += '<p class="ww-empty">No students match this filter.</p>';
    } else {
      _groups(w, rows).forEach(function (g) {
        html += '<section class="ww-group">';
        if (g.title)
          html +=
            '<h3 class="ww-group-head">' +
            (g.level ? '<span class="ww-dot ww-lv-' + g.level + '" aria-hidden="true"></span>' : '') +
            esc(g.title) +
            '<span class="ww-group-n">' +
            esc(g.rows.length + (g.rows.length === 1 ? ' student' : ' students')) +
            '</span></h3>';
        html +=
          '<div class="ww-grid">' +
          g.rows
            .map(function (r) {
              return _cardHtml(w, r);
            })
            .join('') +
          '</div></section>';
      });
    }
    html += '</div></div>';
    return { html: html, rows: rows };
  }

  function _drawWall() {
    var w = _wall;
    if (!w) return;
    var a = _piece(w.cid, w.aid);
    if (!a || !GraderWork.workShown(w.cid, a)) return close();
    if (window.WorkRubricCard) WorkRubricCard.hide();
    var m = _wallModel(w);
    var drawn = _wallHtml(w, m, !!(w.onGrade || (window.PageAssignments && PageAssignments.openGrader)));
    var focus = document.activeElement;
    var keep =
      focus && w.overlay.contains(focus) && focus.getAttribute
        ? {
            ww: focus.getAttribute('data-ww'),
            key: focus.getAttribute('data-sort') || focus.getAttribute('data-filter') || focus.getAttribute('data-sid'),
          }
        : null;
    var scroller = w.overlay.querySelector('.ww-scroll');
    var top = scroller ? scroller.scrollTop : 0;
    // html-safe: _wallHtml escapes every name, title, label and count; the rest is fixed markup
    w.overlay.innerHTML = drawn.html;
    w.shown = drawn.rows.map(function (r) {
      return r.st.id;
    });
    var nowScroll = w.overlay.querySelector('.ww-scroll');
    if (nowScroll) nowScroll.scrollTop = top;
    var cid = w.cid;
    var aid = w.aid;
    w.pics.fill(w.overlay, cid, function (img) {
      if (_wall !== w) return null;
      return _pages(getStudentSubmission(cid, img.getAttribute('data-sid'), aid))[0] || null;
    });
    // Each address is kept until the wall closes, so a sort or a filter
    // asks for nothing again.
    if (keep && keep.ww) {
      var again = Array.prototype.find.call(w.overlay.querySelectorAll('[data-ww="' + keep.ww + '"]'), function (el) {
        var k = el.getAttribute('data-sort') || el.getAttribute('data-filter') || el.getAttribute('data-sid');
        return k === keep.key;
      });
      _focus(again);
    }
  }

  function _wallClick(e) {
    var w = _wall;
    var btn = e.target.closest && e.target.closest('[data-ww]');
    if (!w || !btn || btn.disabled || btn.tagName === 'SELECT') return;
    var what = btn.getAttribute('data-ww');
    if (what === 'close') return close();
    if (what === 'sort') {
      w.sort = btn.getAttribute('data-sort');
      return _drawWall();
    }
    if (what === 'filter') {
      var f = btn.getAttribute('data-filter');
      w.filter = String(w.filter) === f && f !== 'all' ? 'all' : f;
      return _drawWall();
    }
    if (what === 'grade') return _gradeInOrder(w, w.shown[0]);
    if (what === 'open') {
      var sid = btn.getAttribute('data-sid');
      var withPages = w.shown.filter(function (id) {
        return _pages(getStudentSubmission(w.cid, id, w.aid)).length > 0;
      });
      var at = withPages.indexOf(sid);
      // Nothing to look at: straight to the grader, where Add Work is.
      if (at < 0) return _gradeInOrder(w, sid);
      _openViewer(
        withPages.map(function (id) {
          return { cid: w.cid, sid: id, aid: w.aid };
        }),
        at,
        {
          step: 'Student',
          onGrade:
            w.onGrade || (window.PageAssignments && PageAssignments.openGrader)
              ? function (it) {
                  if (_wall === w) _gradeInOrder(w, it.sid);
                }
              : null,
        },
      );
    }
  }

  function _wallChange(e) {
    var w = _wall;
    if (!w || !e.target || e.target.getAttribute('data-ww') !== 'by') return;
    w.by = e.target.value || '';
    _drawWall();
  }

  /* The grader (unchanged) on the students shown, in the order shown,
     starting at `sid`. The wall draws again when it closes. */
  function _gradeInOrder(w, sid) {
    if (!sid) return;
    var ids = w.shown.slice();
    if (ids.indexOf(sid) < 0) ids.unshift(sid);
    // A screen with its own grader (the phone) passes its way in.
    if (w.onGrade) return w.onGrade(sid, ids);
    if (!window.PageAssignments || !PageAssignments.openGrader) return;
    var over = !!(window.Router && Router.getCurrentPage && Router.getCurrentPage() === window.PageAssignments);
    PageAssignments.openGrader(w.cid, w.aid, sid, {
      studentIds: ids,
      overPage: over,
      onClose: function () {
        if (_wall !== w) return;
        if (typeof clearProfCache === 'function') clearProfCache();
        _drawWall();
        var back = w.overlay.querySelector('.ww-grade');
        _focus(back);
      },
    });
  }

  function _keydown(e) {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    if (window.PageAssignments && PageAssignments.graderOpen && PageAssignments.graderOpen()) return;
    if (document.querySelector('.confirm-overlay')) return;
    if (_view) {
      e.preventDefault();
      return _closeViewer();
    }
    if (_wall) {
      e.preventDefault();
      close();
    }
  }
  var _keysOn = false;
  function _keys(on) {
    if (on === _keysOn) return;
    _keysOn = on;
    if (on) document.addEventListener('keydown', _keydown);
    else document.removeEventListener('keydown', _keydown);
  }

  function open(cid, aid, opts) {
    var a = _piece(cid, aid);
    if (!a || !GraderWork.workShown(cid, a)) return false;
    close(true);
    opts = opts || {};
    var counts = GraderWork.workCounts(cid, aid);
    var overlay = document.createElement('div');
    overlay.id = 'work-wall-overlay';
    overlay.className = 'ww-overlay';
    document.body.appendChild(overlay);
    _wall = {
      cid: cid,
      aid: aid,
      // To Grade First while work waits; Level once it is all graded.
      sort: counts.ids.tograde.length ? 'tograde' : 'level',
      filter: 'all',
      by: '',
      overlay: overlay,
      pics: WorkThumbs.holder(),
      shown: [],
      onClose: opts.onClose || null,
      onGrade: typeof opts.onGrade === 'function' ? opts.onGrade : null,
      opener: document.activeElement,
    };
    overlay.addEventListener('click', _wallClick);
    overlay.addEventListener('change', _wallChange);
    _keys(true);
    if (window.WorkRubricCard) WorkRubricCard.wire();
    _drawWall();
    var back = overlay.querySelector('.ww-back');
    _focus(back);
    // A signed-in class's work, read again: the wall is drawn again if it changed (S6-W1).
    var mine = _wall;
    if (typeof refreshStudentWork === 'function') {
      refreshStudentWork(cid, { force: true }).then(function (res) {
        if (_wall === mine && res && res.changed) _drawWall();
      });
    }
    return true;
  }

  function close(quiet) {
    _closeViewer(true);
    var w = _wall;
    if (!w) return;
    _wall = null;
    if (window.WorkRubricCard) WorkRubricCard.hide();
    w.pics.releaseAll();
    w.overlay.remove();
    if (!_tab) _keys(false);
    if (!quiet && w.opener && w.opener.isConnected) _focus(w.opener);
    if (!quiet && w.onClose) w.onClose();
  }

  /* ── The Work tab on the teacher's student page ──────────────── */
  var _tab = null; // { cid, sid, panel, pics, lookup, onChange, gen }
  // What the teacher picked, kept while the same student is shown: the
  // competency, where the work stands, the category and the order.
  var _tabPick = { key: '' };
  // Where a piece stands, as the Assignments page's Show names it.
  var TAB_STATES = [
    { id: 'all', label: 'All' },
    { id: 'tograde', label: 'To Grade' },
    { id: 'toreturn', label: 'To Return' },
    { id: 'returned', label: 'Returned' },
  ];
  var TAB_SORTS = [
    { id: 'new', label: 'Newest First' },
    { id: 'old', label: 'Oldest First' },
  ];
  var SLIDE_MS = 250; // the class dashboard's cards slide this long (dashboard.css .is-sliding)

  function tabOn(cid) {
    return !!cid && GraderWork.workShownInClass(cid);
  }

  /* The pieces this student has work in for, newest first. */
  function _tabPieces(cid, sid) {
    return (getAssessments(cid) || [])
      .filter(function (a) {
        return a && GraderWork.workShown(cid, a) && !!getStudentSubmission(cid, sid, a.id);
      })
      .map(function (a) {
        var sub = getStudentSubmission(cid, sid, a.id);
        return { a: a, sub: sub, pages: _pages(sub), at: sub.sent_at || sub.created_at || a.date || '' };
      })
      .sort(function (x, y) {
        return String(y.at).localeCompare(String(x.at));
      });
  }

  /* The competencies a piece measures, as the class's sections. */
  function _pieceSections(cid, a) {
    var tags = a.rubricId && !isPointsScored(a) ? rubricCompetencyIds(cid, a) : scoreTagIds(a, cid);
    var out = [];
    (tags || []).forEach(function (t) {
      if (isUnlinkedTag(t)) return;
      var sec = getSectionForTag(cid, t);
      if (sec && out.indexOf(sec.id) < 0) out.push(sec.id);
    });
    return out;
  }

  /* To Grade, To Return or Returned. Work that takes nothing new (Send Work
     off) and has no grade yet is still to grade. */
  function _tabState(cid, sid, a) {
    var s = GraderWork.workStateOf(cid, a.id, sid);
    if (s === 'tograde' || s === 'toreturn' || s === 'returned') return s;
    return assessmentCellValue(cid, sid, a).kind === 'none' ? 'tograde' : 'returned';
  }

  function tabSummary(cid, sid) {
    var list = _tabPieces(cid, sid);
    var waiting = list.filter(function (p) {
      return GraderWork.workStateOf(cid, p.a.id, sid) === 'tograde';
    }).length;
    // Work to grade takes the figure's place as a blue badge.
    if (waiting) return { badge: waiting + ' to Grade', tone: 'todo' };
    return { stat: _piecesText(list.length) };
  }

  function _piecesText(n) {
    return n + (n === 1 ? ' Piece' : ' Pieces');
  }

  function _tabModel(cid, sid) {
    var key = cid + '|' + sid;
    if (_tabPick.key !== key) _tabPick = { key: key, comp: '', state: 'all', cat: '', sort: 'new' };
    var pick = _tabPick;
    var pieces = _tabPieces(cid, sid);
    var secIds = [];
    var catIds = [];
    pieces.forEach(function (p) {
      p.secs = _pieceSections(cid, p.a);
      p.secs.forEach(function (id) {
        if (secIds.indexOf(id) < 0) secIds.push(id);
      });
      p.state = _tabState(cid, sid, p.a);
      p.cat = p.a.categoryId || p.a.category_id || '';
      if (p.cat && catIds.indexOf(p.cat) < 0) catIds.push(p.cat);
    });
    var sections = (getSections(cid) || []).filter(function (s) {
      return secIds.indexOf(s.id) >= 0;
    });
    if (
      pick.comp &&
      !sections.some(function (s) {
        return s.id === pick.comp;
      })
    )
      pick.comp = '';
    // A category list only when the work spans two or more.
    var cats =
      typeof getCategories === 'function'
        ? (getCategories(cid) || []).filter(function (c) {
            return c && catIds.indexOf(c.id) >= 0;
          })
        : [];
    if (cats.length < 2) cats = [];
    if (
      pick.cat &&
      !cats.some(function (c) {
        return c.id === pick.cat;
      })
    )
      pick.cat = '';
    var inView = pieces.filter(function (p) {
      return (!pick.comp || p.secs.indexOf(pick.comp) >= 0) && (!pick.cat || p.cat === pick.cat);
    });
    var counts = { all: inView.length, tograde: 0, toreturn: 0, returned: 0 };
    inView.forEach(function (p) {
      counts[p.state]++;
    });
    var shown = inView.filter(function (p) {
      return pick.state === 'all' || p.state === pick.state;
    });
    if (pick.sort === 'old') shown.reverse();
    return { pieces: pieces, sections: sections, cats: cats, counts: counts, shown: shown, pick: pick };
  }

  function _secName(sec) {
    var tag = (sec.tags || [])[0];
    return (tag && tag.label) || sec.name || '';
  }

  function _tabCountText(m) {
    var all = _piecesText(m.pieces.length);
    return m.shown.length === m.pieces.length ? all : m.shown.length + ' of ' + all;
  }

  // html-safe: ids are ours or through esc; labels through esc
  function _tabControlsHtml(m) {
    var pick = m.pick;
    var chip = function (id, label) {
      var on = pick.comp === id;
      return (
        '<button type="button" class="sw-chip' +
        (on ? ' is-on' : '') +
        '" data-sw="comp" data-comp="' +
        esc(id) +
        '" aria-pressed="' +
        on +
        '">' +
        esc(label) +
        '</button>'
      );
    };
    var seg = function (what, list, now, labelId, counts) {
      return (
        '<div class="ww-seg sw-seg" role="group" aria-labelledby="' +
        labelId +
        '">' +
        list
          .map(function (s) {
            var on = now === s.id;
            return (
              '<button type="button" class="ww-seg-btn' +
              (on ? ' is-on' : '') +
              '" data-sw="' +
              what +
              '" data-key="' +
              s.id +
              '" aria-pressed="' +
              on +
              '">' +
              esc(s.label) +
              (counts ? ' <span class="sw-n">' + esc(String(counts[s.id])) + '</span>' : '') +
              '</button>'
            );
          })
          .join('') +
        '</div>'
      );
    };
    var anyPages = m.shown.some(function (p) {
      return p.pages.length > 0;
    });
    return (
      '<div class="sw-bar">' +
      (m.sections.length > 1
        ? chip('', 'All Competencies') +
          m.sections
            .map(function (s) {
              return chip(s.id, _secName(s));
            })
            .join('')
        : '') +
      '<span class="ww-gap"></span>' +
      '<button type="button" class="ww-grade" data-sw="full"' +
      (anyPages ? '' : ' disabled') +
      '><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4l13 8-13 8z"></path></svg>View Full Size</button>' +
      '</div>' +
      '<div class="sw-tools">' +
      '<span class="ww-label" id="sw-state-label">Show</span>' +
      seg('state', TAB_STATES, pick.state, 'sw-state-label', m.counts) +
      (m.cats.length
        ? '<label class="ww-label sw-cat-label" for="sw-cat">Category</label><select id="sw-cat" class="ww-by" data-sw="cat">' +
          '<option value=""' +
          (pick.cat ? '' : ' selected') +
          '>All Categories</option>' +
          m.cats
            .map(function (c) {
              return (
                '<option value="' +
                esc(c.id) +
                '"' +
                (pick.cat === c.id ? ' selected' : '') +
                '>' +
                esc(c.name || '') +
                '</option>'
              );
            })
            .join('') +
          '</select>'
        : '') +
      '<span class="ww-gap"></span>' +
      '<span class="ww-label" id="sw-sort-label">Sort</span>' +
      seg('sort', TAB_SORTS, pick.sort, 'sw-sort-label', null) +
      '</div>'
    );
  }

  // html-safe: ids are ours, the title and words through esc
  function _tabCardHtml(cid, sid, p) {
    var first = p.pages[0];
    var title = p.a.title || '';
    return (
      '<button type="button" class="sw-card' +
      (first ? '' : ' is-empty') +
      '" data-sw="open" data-aid="' +
      esc(p.a.id) +
      '" data-cid="' +
      esc(cid) +
      '" data-sid="' +
      esc(sid) +
      '"><span class="sw-pic">' +
      (first
        ? '<img class="ww-img" data-work-pic data-aid="' + esc(p.a.id) + '" alt="' + esc(title) + '" loading="lazy">'
        : '<span class="ww-nopic">' +
          esc(p.sub.on_paper ? 'Handed in on paper' : _links(p.sub).length ? 'A link' : 'No pages') +
          '</span>') +
      '</span><span class="sw-foot"><span class="sw-title">' +
      esc(title) +
      '</span><span class="sw-row"><span class="sw-date">' +
      esc(_day(p.at)) +
      '</span><span class="ww-gap"></span>' +
      _chipHtml(_mark(cid, sid, p.a, null)) +
      '</span></span></button>'
    );
  }

  function tabHtml(cid, sid) {
    var m = _tabModel(cid, sid);
    var st = (getStudents(cid) || []).find(function (s) {
      return s.id === sid;
    });
    if (!m.pieces.length) {
      return (
        '<div class="sw-tab"><p class="ww-empty">' +
        esc('No work has come in from ' + (st ? displayNameFirst(st) : 'this student') + ' yet.') +
        '</p></div>'
      );
    }
    return (
      '<div class="sw-tab"><div class="sw-controls">' +
      _tabControlsHtml(m) +
      '</div>' +
      '<div class="sw-headrow"><h3 class="sw-head">All Work</h3><span class="sw-count" aria-live="polite">' +
      esc(_tabCountText(m)) +
      '</span></div><div class="sw-grid">' +
      m.shown
        .map(function (p) {
          return _tabCardHtml(cid, sid, p);
        })
        .join('') +
      '</div><p class="ww-empty sw-none"' +
      (m.shown.length ? ' hidden' : '') +
      '>No work matches these filters.</p></div>'
    );
  }

  function _tabMoves(el) {
    if (!el || typeof el.getBoundingClientRect !== 'function') return false;
    if (typeof document !== 'undefined' && document.hidden) return false;
    // Nothing laid out (a hidden panel, or no layout at all): nothing to slide.
    if (!(el.getBoundingClientRect().width > 0)) return false;
    var mq = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    return !(mq && mq.matches);
  }

  function _swKey(el) {
    return el.getAttribute('data-comp') != null ? el.getAttribute('data-comp') : el.getAttribute('data-key') || '';
  }

  /* A filter or the order changed: the controls and the count are drawn
     again, and the cards rearrange, not the page. */
  function _tabRedraw(t) {
    var root = t.panel.querySelector('.sw-tab');
    var controls = root && root.querySelector('.sw-controls');
    var grid = root && root.querySelector('.sw-grid');
    if (!controls || !grid) {
      if (t.onChange) t.onChange();
      return;
    }
    var move = _tabMoves(grid);
    // Where each card is now, before anything above it changes height.
    var before = {};
    Array.prototype.forEach.call(grid.querySelectorAll('.sw-card.is-leaving'), function (el) {
      el.remove();
    });
    if (move) {
      Array.prototype.forEach.call(grid.querySelectorAll('.sw-card[data-aid]'), function (el) {
        before[el.getAttribute('data-aid')] = el.getBoundingClientRect();
      });
    }
    var m = _tabModel(t.cid, t.sid);
    var focus = document.activeElement;
    var keep =
      focus && controls.contains(focus) && focus.getAttribute('data-sw')
        ? { sw: focus.getAttribute('data-sw'), key: _swKey(focus) }
        : null;
    // html-safe: _tabControlsHtml escapes every label and id
    controls.innerHTML = _tabControlsHtml(m);
    if (keep) {
      _focus(
        Array.prototype.find.call(controls.querySelectorAll('[data-sw="' + keep.sw + '"]'), function (el) {
          return keep.sw === 'cat' || _swKey(el) === keep.key;
        }),
      );
    }
    var count = root.querySelector('.sw-count');
    if (count) count.textContent = _tabCountText(m);
    var none = root.querySelector('.sw-none');
    if (none) {
      if (m.shown.length) none.setAttribute('hidden', '');
      else none.removeAttribute('hidden');
    }
    _tabRearrange(t, grid, m, move ? before : null);
  }

  /* FLIP, as the class dashboard's student cards (dash-student-cards.js
     slideFrom): each card that stays starts where it was and slides to its
     new place; a card that comes in fades and grows in; one that goes fades
     out where it was. Cards that stay are moved, not drawn again, so their
     pictures stay. With Reduce Motion on, everything happens at once. */
  function _tabRearrange(t, grid, m, before) {
    var old = {};
    Array.prototype.forEach.call(grid.querySelectorAll('.sw-card[data-aid]'), function (el) {
      old[el.getAttribute('data-aid')] = el;
    });
    var made = document.createElement('div');
    var fresh = [];
    var cards = m.shown.map(function (p) {
      var el = old[p.a.id];
      if (el) {
        delete old[p.a.id];
        return el;
      }
      // html-safe: _tabCardHtml escapes the title; ids are ours
      made.innerHTML = _tabCardHtml(t.cid, t.sid, p);
      el = made.firstElementChild;
      fresh.push(el);
      return el;
    });
    var leaving = Object.keys(old).map(function (k) {
      return old[k];
    });
    leaving.forEach(function (el) {
      if (!before || !before[el.getAttribute('data-aid')]) return el.remove();
      var r = before[el.getAttribute('data-aid')];
      // Out of the grid's flow, the size it was, until it has faded.
      el.classList.add('is-leaving', 'is-placing');
      el.removeAttribute('data-sw');
      el.setAttribute('aria-hidden', 'true');
      el.setAttribute('tabindex', '-1');
      el.style.width = r.width + 'px';
      el.style.height = r.height + 'px';
    });
    cards.forEach(function (el) {
      grid.appendChild(el);
    });
    if (t.lookup) t.pics.fill(grid, t.cid, t.lookup);
    if (!before) return;
    t.gen = (t.gen || 0) + 1;
    var gen = t.gen;
    // Every new place is read before any card is moved.
    var box = grid.getBoundingClientRect();
    var now = cards.map(function (el) {
      return el.getBoundingClientRect();
    });
    leaving.forEach(function (el) {
      var r = before[el.getAttribute('data-aid')];
      el.style.left = r.left - box.left + 'px';
      el.style.top = r.top - box.top + 'px';
      el.style.transform = '';
    });
    cards.forEach(function (el, n) {
      var a = before[el.getAttribute('data-aid')];
      el.classList.remove('is-sliding');
      el.classList.add('is-placing');
      if (fresh.indexOf(el) >= 0 || !a) {
        el.style.transform = '';
        el.classList.add('is-entering');
        return;
      }
      var dx = a.left - now[n].left;
      var dy = a.top - now[n].top;
      el.style.transform = dx || dy ? 'translate(' + dx + 'px, ' + dy + 'px)' : '';
    });
    // One layout read, so the old places take before the change.
    void grid.offsetHeight;
    cards.concat(leaving).forEach(function (el) {
      el.classList.remove('is-placing', 'is-entering');
      el.classList.add('is-sliding');
      if (!el.classList.contains('is-leaving')) el.style.transform = '';
    });
    leaving.forEach(function (el) {
      el.classList.add('is-gone');
    });
    setTimeout(function () {
      if (t.gen !== gen) return;
      leaving.forEach(function (el) {
        el.remove();
      });
      cards.forEach(function (el) {
        el.classList.remove('is-sliding');
      });
    }, SLIDE_MS + 20);
  }

  function _tabClick(e) {
    var t = _tab;
    var btn = e.target.closest && e.target.closest('[data-sw]');
    if (!t || !btn || btn.disabled) return;
    var what = btn.getAttribute('data-sw');
    if (what === 'comp' || what === 'state' || what === 'sort') {
      if (what === 'comp') _tabPick.comp = btn.getAttribute('data-comp') || '';
      else _tabPick[what] = btn.getAttribute('data-key') || (what === 'state' ? 'all' : 'new');
      _tabRedraw(t);
      return;
    }
    var m = _tabModel(t.cid, t.sid);
    var items = m.shown
      .filter(function (p) {
        return p.pages.length > 0;
      })
      .map(function (p) {
        return { cid: t.cid, sid: t.sid, aid: p.a.id };
      });
    var grade = function (it) {
      if (_tab !== t || !window.PageAssignments || !PageAssignments.openGrader) return;
      PageAssignments.openGrader(t.cid, it.aid, t.sid, {
        studentIds: [t.sid],
        onClose: function () {
          if (_tab === t && t.onChange) t.onChange();
        },
      });
    };
    var canGrade = !!(window.PageAssignments && PageAssignments.openGrader);
    if (what === 'full') return _openViewer(items, 0, { step: 'Piece', onGrade: canGrade ? grade : null });
    if (what === 'open') {
      var aid = btn.getAttribute('data-aid');
      var at = items.findIndex(function (it) {
        return it.aid === aid;
      });
      if (at < 0) return canGrade ? grade({ cid: t.cid, sid: t.sid, aid: aid }) : undefined;
      _openViewer(items, at, { step: 'Piece', onGrade: canGrade ? grade : null });
    }
  }

  function _tabChange(e) {
    var t = _tab;
    if (!t || !e.target || e.target.getAttribute('data-sw') !== 'cat') return;
    _tabPick.cat = e.target.value || '';
    _tabRedraw(t);
  }

  function mountTab(panel, cid, sid, opts) {
    if (!panel) return unmountTab();
    var same = _tab && _tab.cid === cid && _tab.sid === sid;
    var pics = same ? _tab.pics : WorkThumbs.holder();
    if (!same) unmountTab();
    else {
      _tab.panel.removeEventListener('click', _tabClick);
      _tab.panel.removeEventListener('change', _tabChange);
    }
    _tab = {
      cid: cid,
      sid: sid,
      panel: panel,
      pics: pics,
      gen: 0,
      onChange: (opts && opts.onChange) || null,
      lookup: function (img) {
        if (_tab !== t) return null;
        return _pages(getStudentSubmission(cid, sid, img.getAttribute('data-aid')))[0] || null;
      },
    };
    var t = _tab;
    panel.addEventListener('click', _tabClick);
    panel.addEventListener('change', _tabChange);
    pics.fill(panel, cid, t.lookup);
    // Kept until the teacher leaves this student or the tab.
    _keys(true);
    if (window.WorkRubricCard) WorkRubricCard.wire();
  }

  /* ── Work on the teacher's other screens ──────────────────────
     seeWorkHtml: See the Work on a student's row in the Assignments page's
     whole-class grid, when work is in for them; it opens the grader on
     their pages (the page's gradeSubmissions action). Pointing at it, or
     tabbing to it, shows the first pages in a card beside the button, for
     a look without opening anything (the glance, below).

     pieceHtml and mountPiece: the student's pages for one piece, whole,
     beside the rubric in an open row of All Your Work on the teacher's
     student page, to sit with a student and talk it through. A page opens
     full size. unmountTab(true) lets these pictures go too. */
  // html-safe: ids are ours; fixed words
  // icon: the Assignments page's row draws the button as that icon (fixed
  // markup, LINE_ICONS), named See the Work; it then answers null, not '',
  // when the piece shows work but none is in, so the row can offer its +
  // without asking again. known: true or false when the caller has already
  // looked for the student's work, so it is not looked up again.
  function seeWorkHtml(cid, aid, sid, icon, known) {
    var a = _piece(cid, aid);
    if (!a || !GraderWork.workShown(cid, a)) return '';
    var none = icon ? null : '';
    if (known === false) return none;
    if (known !== true) {
      var subs = typeof getGroupSubmissions === 'function' ? getGroupSubmissions(cid, sid, aid) : [];
      if (!subs.length && !getStudentSubmission(cid, sid, aid)) return none;
    }
    _glanceWire();
    return (
      '<button type="button" class="' +
      (icon ? 'rsg-work-btn' : 'assess-add-work-btn') +
      ' rsg-see-work" data-stop-prop="true" data-action="gradeSubmissions" data-cid="' +
      esc(cid) +
      '" data-aid="' +
      esc(aid) +
      '" data-sid="' +
      esc(sid) +
      '"' +
      (icon ? ' aria-label="See the Work" title="See the Work">' + icon : '>See the Work') +
      '</button>'
    );
  }

  // The web links a teacher attached as the student's work (Demo Mode; the
  // Assignments page's +), only http and https.
  function _links(sub) {
    return ((sub && sub.links) || []).filter(function (l) {
      return l && /^https?:\/\//i.test(String(l.url || ''));
    });
  }

  // html-safe: the title goes through esc; ids are ours; fixed words
  function pieceHtml(cid, sid, aid) {
    var a = _piece(cid, aid);
    if (!a || !GraderWork.workShown(cid, a)) return '';
    var sub = getStudentSubmission(cid, sid, aid);
    if (!sub) return '';
    var pages = _pages(sub);
    var head = '<div class="stu-ov-work" data-aid="' + esc(aid) + '"><div class="stu-ov-label">Your Work</div>';
    var links = _links(sub)
      .map(function (l) {
        return (
          '<a class="stu-ov-link" href="' +
          esc(l.url) +
          '" target="_blank" rel="noopener noreferrer">' +
          esc(l.title || l.url) +
          '</a>'
        );
      })
      .join('');
    if (!pages.length) return head + (links || '<div class="stu-ov-read">Handed in on paper.</div>') + '</div>';
    return (
      head +
      pages
        .map(function (f, i) {
          var what = 'Page ' + (i + 1) + ' of ' + pages.length;
          return (
            '<button type="button" class="ovw-page" data-ovw="' +
            i +
            '" aria-label="' +
            esc(what + ', full size') +
            '"><img class="ovw-img" data-work-pic data-work-which="page" data-aid="' +
            esc(aid) +
            '" data-page="' +
            i +
            '" alt="' +
            esc(what + ' of ' + (a.title || 'this work')) +
            '" loading="lazy"></button>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  /* The glance: the student's first pages (two at most) in a card by the
     See the Work button while the pointer rests on it or it has focus. It
     takes no clicks and no focus, and goes when the pointer or focus
     leaves, on a click, a scroll or Escape, and when the row is drawn
     again.

     It is meant to be there the moment the pointer arrives:
     - when the pointer first comes into an open card, the thumbnails of
       every row's first pages are fetched (small: about 20 KB each), the
       links for all of them signed in one request (openStudentWorkPage
       batches the links asked for in one turn);
     - when the pointer comes onto a button, its full pages start at once,
       and the card shows after a tenth of a second with the thumbnail,
       then the full page as soon as it is in;
     - pictures are kept in this tab's memory, the most recent 240
       thumbnails and 16 full pages, for ten minutes at most, so a second
       look fetches nothing. Nothing is written to the device. */
  var GLANCE_WAIT = 100; // ms the pointer rests before the card shows
  var GLANCE_WIDE = 340; // px, a page's width in the card
  var GLANCE_MAX = { thumb: 240, page: 16 }; // pictures kept in memory, of each size
  var GLANCE_AGE = 10 * 60 * 1000; // ms a kept picture is used for
  var _glance = null; // { btn, el, shown, cid }
  var _glanceTimer = null;
  var _glanceDoc = null;
  var _glanceKept = new Map(); // which|path -> { which, at, page: { url, release } | null | undefined, wait: Promise }
  var _glanceWarmed = typeof WeakSet === 'function' ? new WeakSet() : null; // the buttons whose thumbnails are asked for
  function _glanceBtn(e) {
    return e.target && e.target.closest ? e.target.closest('.rsg-see-work') : null;
  }
  // The pages a button's glance shows: the student's, or their group's, first two.
  function _glancePages(btn) {
    var cid = btn.getAttribute('data-cid');
    var aid = btn.getAttribute('data-aid');
    var sid = btn.getAttribute('data-sid');
    var sub = getStudentSubmission(cid, sid, aid);
    if (!sub && typeof getGroupSubmissions === 'function') sub = getGroupSubmissions(cid, sid, aid)[0] || null;
    var pages = _pages(sub);
    return { cid: cid, all: pages, shown: pages.slice(0, 2) };
  }
  function _glanceKey(which, f) {
    var path = which === 'thumb' ? f.thumb_path : f.path;
    return path ? which + '|' + path : null;
  }
  // A kept picture, or one asked for now: { page, wait }. Its address is let go when it is pushed out.
  function _glanceGet(cid, f, which) {
    var key = _glanceKey(which, f);
    if (!key) return null;
    var kept = _glanceKept.get(key);
    if (kept && Date.now() - kept.at > GLANCE_AGE) {
      _glanceDrop(key, kept);
      kept = null;
    }
    if (kept) {
      // The most recently used goes last, and is pushed out last.
      _glanceKept.delete(key);
      _glanceKept.set(key, kept);
      return kept;
    }
    var entry = { which: which, at: Date.now(), page: undefined, wait: null };
    entry.wait = openStudentWorkPage(cid, f, which).then(
      function (page) {
        entry.page = page || null;
        if (_glanceKept.get(key) !== entry && page && page.release) page.release();
        return entry.page;
      },
      function () {
        entry.page = null;
        return null;
      },
    );
    _glanceKept.set(key, entry);
    _glanceTrim(which);
    return entry;
  }
  function _glanceDrop(key, entry) {
    _glanceKept.delete(key);
    if (entry.page && entry.page.release) {
      var page = entry.page;
      // Not while the card shows it: it is let go when it is pushed out again.
      if (!(_glance && _glance.el.querySelector('img[src="' + page.url + '"]'))) page.release();
    }
  }
  function _glanceTrim(which) {
    var n = 0;
    _glanceKept.forEach(function (e) {
      if (e.which === which) n++;
    });
    if (n <= GLANCE_MAX[which]) return;
    var over = n - GLANCE_MAX[which];
    Array.from(_glanceKept.entries()).some(function (pair) {
      if (pair[1].which !== which) return false;
      _glanceDrop(pair[0], pair[1]);
      return --over <= 0;
    });
  }
  // The thumbnails of every See the Work in an open card, the first time the pointer comes into it.
  function _glanceWarm(card) {
    if (!card || !card.querySelectorAll) return;
    Array.prototype.forEach.call(card.querySelectorAll('.rsg-see-work'), function (btn) {
      if (_glanceWarmed) {
        if (_glanceWarmed.has(btn)) return;
        _glanceWarmed.add(btn);
      }
      var p = _glancePages(btn);
      p.shown.forEach(function (f) {
        _glanceGet(p.cid, f, 'thumb');
      });
    });
  }
  function _glanceWire() {
    if (typeof document === 'undefined' || _glanceDoc === document || !document.addEventListener) return;
    _glanceDoc = document;
    // In the capture phase: the grid stops a row's events before they reach the document.
    document.addEventListener(
      'mouseover',
      function (e) {
        var btn = _glanceBtn(e);
        if (!btn) {
          var card = e.target && e.target.closest ? e.target.closest('.assess-card.open') : null;
          if (card) _glanceWarm(card);
          return _glance && _glanceHide();
        }
        if (_glance && _glance.btn === btn) return;
        clearTimeout(_glanceTimer);
        // The full pages start now; the card shows when the pointer has rested.
        var p = _glancePages(btn);
        p.shown.forEach(function (f) {
          _glanceGet(p.cid, f, 'thumb');
          _glanceGet(p.cid, f, 'page');
        });
        _glanceTimer = setTimeout(function () {
          // Still there and still under the pointer: the page may have scrolled meanwhile.
          if (btn.isConnected && btn.matches(':hover')) _glanceShow(btn);
        }, GLANCE_WAIT);
      },
      true,
    );
    document.addEventListener(
      'mouseout',
      function (e) {
        if (_glanceBtn(e)) _glanceHide();
      },
      true,
    );
    document.addEventListener(
      'focusin',
      function (e) {
        var btn = _glanceBtn(e);
        if (btn) _glanceShow(btn);
      },
      true,
    );
    document.addEventListener('focusout', _glanceHide, true);
    document.addEventListener('click', _glanceHide, true);
    // A scroll takes the card off; a card still waiting to show is checked when its time comes.
    document.addEventListener('scroll', _glanceOff, true);
    document.addEventListener(
      'keydown',
      function (e) {
        if (e.key === 'Escape') _glanceHide();
      },
      true,
    );
  }
  function _glanceHide() {
    clearTimeout(_glanceTimer);
    _glanceOff();
  }
  function _glanceOff() {
    if (!_glance) return;
    _glance.el.remove();
    _glance = null;
  }
  // The sharpest picture there is for page `i` of the card on screen: the full page, else its thumbnail.
  function _glancePaint(el, i, f, cid) {
    var img = el.querySelector('img[data-page="' + i + '"]');
    if (!img) return;
    var page = _glanceGet(cid, f, 'page');
    var thumb = _glanceGet(cid, f, 'thumb');
    var put = function (entry, sharp) {
      if (!entry || !entry.page || !(_glance && _glance.el === el)) return;
      if (!sharp && img.getAttribute('data-sharp') === '1') return;
      img.setAttribute('src', entry.page.url);
      if (sharp) img.setAttribute('data-sharp', '1');
    };
    if (page && page.page) return put(page, true);
    if (thumb && thumb.page) put(thumb, false);
    else if (thumb && thumb.wait)
      thumb.wait.then(function () {
        put(thumb, false);
      });
    if (page && page.wait)
      page.wait.then(function () {
        put(page, true);
      });
  }
  function _glanceShow(btn) {
    _glanceHide();
    var p = _glancePages(btn);
    var cid = p.cid;
    var pages = p.all;
    if (!pages.length) return;
    var shown = p.shown;
    // A page keeps its shape, and the card fits the window.
    var win = typeof window !== 'undefined' ? window : {};
    var roomW = (win.innerWidth || 1280) - 24;
    var roomH = (win.innerHeight || 800) - 24;
    var shape = function (f) {
      return f.width > 0 && f.height > 0 ? f.height / f.width : 11 / 8.5;
    };
    var tall = Math.max.apply(null, shown.map(shape));
    var wide = Math.floor(
      Math.min(GLANCE_WIDE, (roomW - 16 - 8 * (shown.length - 1)) / shown.length, (roomH - 48) / tall),
    );
    var more = pages.length - shown.length;
    var el = document.createElement('div');
    el.className = 'ww-glance';
    el.setAttribute('aria-hidden', 'true');
    // html-safe: numbers we worked out and fixed words; no name or title is written
    el.innerHTML =
      '<div class="ww-glance-pages">' +
      shown
        .map(function (f, i) {
          return (
            '<img class="ww-glance-img" data-page="' +
            i +
            '" alt="" width="' +
            wide +
            '" height="' +
            Math.round(wide * shape(f)) +
            '">'
          );
        })
        .join('') +
      '</div>' +
      (more > 0 ? '<div class="ww-glance-more">' + (more === 1 ? '1 more page' : more + ' more pages') + '</div>' : '');
    _glance = { btn: btn, el: el };
    // The pictures first, so one already kept is in place when the card is first painted.
    shown.forEach(function (f, i) {
      _glancePaint(el, i, f, cid);
    });
    document.body.appendChild(el);
    // Under the button, or over it when there is more room there; kept inside the window.
    var at = btn.getBoundingClientRect ? btn.getBoundingClientRect() : { left: 0, top: 0, bottom: 0 };
    var box = el.getBoundingClientRect ? el.getBoundingClientRect() : { width: 0, height: 0 };
    var below = roomH + 24 - at.bottom - 8;
    var top = below >= box.height + 12 || below >= at.top ? at.bottom + 8 : at.top - 8 - box.height;
    el.style.left = Math.max(12, Math.min(at.left, roomW + 12 - box.width)) + 'px';
    el.style.top = Math.max(12, Math.min(top, roomH + 12 - box.height)) + 'px';
  }

  var _row = null; // { cid, sid, root, pics }: the open rows' pictures on the student page
  function _rowClick(e) {
    var r = _row;
    var btn = e.target.closest && e.target.closest('[data-ovw]');
    var box = btn && btn.closest('.stu-ov-work');
    if (!r || !box) return;
    _openViewer([{ cid: r.cid, sid: r.sid, aid: box.getAttribute('data-aid') }], 0, {
      step: 'Piece',
      page: Number(btn.getAttribute('data-ovw')) || 0,
    });
  }
  function mountPiece(root, cid, sid) {
    if (_row && (_row.root !== root || _row.cid !== cid || _row.sid !== sid)) unmountPiece();
    if (!root) return;
    if (!_row) {
      _row = { cid: cid, sid: sid, root: root, pics: WorkThumbs.holder() };
      root.addEventListener('click', _rowClick);
    }
    var r = _row;
    _keys(true); // Escape closes a page opened full size
    r.pics.sweep();
    r.pics.fill(root, cid, function (img) {
      if (_row !== r || !img.closest('.stu-ov-work')) return null;
      var sub = getStudentSubmission(cid, sid, img.getAttribute('data-aid'));
      return _pages(sub)[Number(img.getAttribute('data-page')) || 0] || null;
    });
  }
  function unmountPiece() {
    if (!_row) return;
    _row.root.removeEventListener('click', _rowClick);
    _row.pics.releaseAll();
    _row = null;
    _closeViewer(true);
    if (!_wall && !_tab) _keys(false);
  }

  function unmountTab(all) {
    if (all) unmountPiece();
    var t = _tab;
    if (!t) return;
    _tab = null;
    if (window.WorkRubricCard) WorkRubricCard.hide();
    _closeViewer(true);
    t.panel.removeEventListener('click', _tabClick);
    t.panel.removeEventListener('change', _tabChange);
    t.pics.releaseAll();
    if (!_wall) _keys(false);
  }

  return {
    open: open,
    close: close,
    isOpen: function () {
      return !!_wall;
    },
    tabOn: tabOn,
    tabSummary: tabSummary,
    tabHtml: tabHtml,
    mountTab: mountTab,
    unmountTab: unmountTab,
    seeWorkHtml: seeWorkHtml,
    // A piece's mark and chip as its card shows them: the rubric card's overall (teacher/work-rubric-card.js).
    cardMark: function (cid, sid, aid) {
      var a = _piece(cid, aid);
      if (!a) return null;
      var mark = _mark(cid, sid, a, null);
      return { piece: a, mark: mark, chip: _chipHtml(mark), day: _day };
    },
    pieceHtml: pieceHtml,
    mountPiece: mountPiece,
  };
})();
