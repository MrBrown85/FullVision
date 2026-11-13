/* gradebook-chrome.js — the Gradebook grid's chrome: row and column hover, scroll sync,
   sticky Overall column, header height, slanted headers. Moved from teacher/page-gradebook.js on 2026-11-12. */
window.GradebookChrome = (function () {
  'use strict';

  /* ── 4-quadrant grid: row hover sync between Q3 and Q4 ───── */
  function initGridHoverSync() {
    var data = document.getElementById('gb-data');
    var rowheads = document.getElementById('gb-rowheads');
    if (!data || !rowheads) return;
    // A student's row lights up their name, and their name the row. The
    // two panes listen, not each row, so a row drawn again on its own
    // (page-gradebook.js, _redrawStudent) keeps it. Class Average lights nothing.
    var ROW = 'tr:not(.gb-stats-row)';
    var NAME = '.gb-grid-rowhead:not(.gb-grid-rowhead-stats)';
    var lit = null;
    function hover(pane, sel, other, otherSel) {
      var at = null;
      pane.addEventListener('mouseover', function (e) {
        var el = e.target.closest ? e.target.closest(sel) : null;
        if (el === at) return;
        at = el;
        var i = el && pane.contains(el) ? Array.prototype.indexOf.call(el.parentNode.children, el) : -1;
        if (lit) lit.classList.remove('gb-row-hover');
        lit = i >= 0 ? other.querySelectorAll(otherSel)[i] || null : null;
        if (lit) lit.classList.add('gb-row-hover');
      });
      pane.addEventListener('mouseleave', function () {
        if (lit) lit.classList.remove('gb-row-hover');
        lit = at = null;
      });
    }
    hover(data, ROW, rowheads, NAME);
    hover(rowheads, NAME, data, ROW);

    // Hover a Q4 cell → highlight its column too, header and all, so a
    // score reads against both its student and its assignment.
    data.addEventListener('mouseover', function (e) {
      var td = e.target.closest ? e.target.closest('td') : null;
      var idx = td && data.contains(td) ? td.cellIndex : -1;
      if (idx === _hoveredColIdx) return;
      hideColTooltip();
      if (idx < 0) return;
      _hoveredColIdx = idx;
      showColTooltip(_colHeadAt(idx), idx);
    });
    data.addEventListener('mouseleave', hideColTooltip);
  }

  /* A column's header: the slanted heading (Scores) or the competency code
     under its assessment (Competencies). */
  function _colHeadAt(idx) {
    return document.querySelectorAll('#gb-colheads .gb-grid-colhead, #gb-colheads .gb-grid-tag-header')[idx] || null;
  }

  /* ── 4-quadrant grid scroll sync ─────────────────────────── */
  var _gridScrollHandler = null;
  function initGridScrollSync() {
    // Remove previous listener to prevent stacking
    if (_gridScrollHandler && _gridScrollHandler.el) {
      _gridScrollHandler.el.removeEventListener('scroll', _gridScrollHandler.fn);
    }
    var data = document.getElementById('gb-data');
    var colheads = document.getElementById('gb-colheads');
    var colheadsInner = colheads && colheads.querySelector('.gb-grid-colheads-inner');
    var rowheads = document.getElementById('gb-rowheads');
    if (!data || !colheads || !rowheads) return;
    var pad = 0;
    var fn = function () {
      // The data area's horizontal scrollbar shortens its view; the names
      // get the same room at the bottom so the last rows still line up.
      var gap = data.scrollHeight - data.clientHeight - (rowheads.scrollHeight - rowheads.clientHeight);
      if (gap && pad + gap >= 0) {
        pad += gap;
        rowheads.style.setProperty('--gb-hscroll', pad + 'px');
      }
      if (colheadsInner) colheadsInner.style.transform = 'translateX(-' + data.scrollLeft + 'px)';
      rowheads.scrollTop = data.scrollTop;
    };
    data.addEventListener('scroll', fn, { passive: true });
    // A name that takes the focus (Tab, or ← from a score) scrolls the
    // names' column into view; the scores follow so the rows stay in line.
    rowheads.addEventListener(
      'scroll',
      function () {
        if (Math.abs(rowheads.scrollTop - data.scrollTop) > 1) data.scrollTop = rowheads.scrollTop;
      },
      { passive: true },
    );
    _gridScrollHandler = { el: data, fn: fn };
  }

  /* Put the data area back at a saved position and line the headers up with
     it now, not on the next scroll event. */
  function restoreGridScroll(pos) {
    var data = document.getElementById('gb-data');
    if (!data) return;
    data.scrollTop = pos.top;
    data.scrollLeft = pos.left;
    if (_gridScrollHandler) _gridScrollHandler.fn();
  }

  /* ── Sticky left positions ─────────────────────────────── */
  function applyStickyLeft() {
    var table = document.querySelector('.gb-table');
    if (!table) return;
    var firstRow = table.querySelector('tbody tr') || table.querySelector('thead tr');
    if (!firstRow) return;
    var nameCell = firstRow.querySelector('.gb-name, .gb-corner');
    var nameWidth = nameCell ? nameCell.offsetWidth : 150;
    var overallLeft = nameWidth;
    table.querySelectorAll('th.gb-overall-col-header, td.gb-overall-col').forEach(function (cell) {
      cell.style.left = overallLeft + 'px';
    });
  }

  /* ── Header row height resize (Scores view) ─────────────── */
  /* The slanted header's height: the one the teacher dragged to, kept on
     the teacher's preferences, or else just tall enough for the longest title, up to
     170px (a longer title ends in an ellipsis and shows whole on hover). */
  function _headerHeightPref() {
    return parseInt(getViewPref('gb_headerHeight') || '0', 10) || 0;
  }
  var _savedHeaderHeight = _headerHeightPref();
  var _headerHeight = _savedHeaderHeight || 170;

  var _measureCtx = null;
  function _fittedHeaderHeight() {
    var widest = 0;
    if (!_measureCtx) _measureCtx = document.createElement('canvas').getContext('2d');
    // Each title's own width in its font (the box it sits in is cut to the
    // header, so the page can't tell how long the words are).
    document
      .querySelectorAll('#gb-colheads .gb-scores-assess-name, #gb-colheads .gb-scores-assess-meta')
      .forEach(function (el) {
        var cs = getComputedStyle(el);
        _measureCtx.font = cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
        widest = Math.max(widest, _measureCtx.measureText(el.textContent).width);
      });
    // A title runs at 45°: its length is the height × √2 less the 40px the
    // label starts in (gradebook.css), plus a little air.
    return Math.max(100, Math.min(170, Math.ceil((widest + 48) / Math.SQRT2)));
  }

  function initHeaderResize() {
    var colheads = document.getElementById('gb-colheads');
    if (!colheads) return;
    // After signing in, the saved height arrives after this file loads.
    _savedHeaderHeight = _headerHeightPref();
    if (_savedHeaderHeight) _headerHeight = _savedHeaderHeight;
    // Add resize handle at bottom of colheads container
    var handle = colheads.querySelector('.gb-header-resize-handle');
    if (!handle) {
      handle = document.createElement('div');
      handle.className = 'gb-header-resize-handle';
      colheads.appendChild(handle);
    }
    handle.addEventListener('mousedown', function (e) {
      e.preventDefault();
      var startY = e.clientY;
      var startH = _headerHeight;
      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';

      function onMove(ev) {
        _headerHeight = Math.max(80, Math.min(400, startH + ev.clientY - startY));
        applyHeaderHeight();
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        _savedHeaderHeight = _headerHeight;
        saveViewPref('gb_headerHeight', _headerHeight);
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
    if (!_savedHeaderHeight) _headerHeight = _fittedHeaderHeight();
    applyHeaderHeight();
  }

  function applyHeaderHeight() {
    var container = document.getElementById('gb-colheads');
    // The tilted label's length, and the room the data area keeps for the
    // last labels, are derived from this in gradebook.css.
    var grid = container && container.closest('.gb-grid');
    if (grid) grid.style.setProperty('--gb-head-h', _headerHeight + 'px');
    var colheads = document.querySelectorAll('#gb-colheads .gb-grid-colhead');
    colheads.forEach(function (el) {
      el.style.height = _headerHeight + 'px';
    });
  }

  /* ── Column hover with 45-degree skew-aware hit-testing ── */
  var _hoveredColIdx = -1;

  /* The slanted header column under a point: { idx, el }, or null. Each
     title leans over the columns to its right, so the box under the pointer
     is often a different column; this follows the slant instead, the same
     band the hover highlights. */
  function _slantedColAt(clientX, clientY) {
    var inner = document.querySelector('#gb-colheads .gb-grid-colheads-inner');
    if (!inner) return null;
    var cols = inner.querySelectorAll('.gb-grid-colhead');
    if (!cols.length) return null;
    var innerRect = inner.getBoundingClientRect();
    var colW = cols[0].getBoundingClientRect().width;
    // innerRect.left already accounts for scroll — no scrollLeft needed
    var mouseX = clientX - innerRect.left;
    var mouseY = clientY - innerRect.top;
    // Skew correction: skewX(-45deg) with transform-origin:bottom-right
    // shifts fill RIGHT as you go up. At height h from bottom, column i's
    // fill spans [i*colW + h, (i+1)*colW + h]. To find column index:
    var hFromBottom = innerRect.height - mouseY;
    var idx = Math.floor((mouseX - hFromBottom) / colW);
    if (idx < 0 || idx >= cols.length) return null;
    return { idx: idx, el: cols[idx] };
  }

  function _inSlantedHeads(target) {
    return !!(
      target &&
      target.closest &&
      target.closest('#gb-colheads .gb-grid-colheads-inner:not(.gb-grid-colheads-comp)')
    );
  }

  function initColHoverTooltip() {
    var colheads = document.getElementById('gb-colheads');
    if (!colheads) return;
    // Use mousemove for skew-aware hit-testing instead of DOM hover
    colheads.addEventListener('mousemove', function (e) {
      var hit = _slantedColAt(e.clientX, e.clientY);
      var idx = hit ? hit.idx : -1;
      if (idx < 0) {
        if (_hoveredColIdx >= 0) hideColTooltip();
        return;
      }
      if (idx !== _hoveredColIdx) {
        hideColTooltip();
        _hoveredColIdx = idx;
        showColTooltip(hit.el, idx);
      }
    });
    colheads.addEventListener('mouseleave', function () {
      hideColTooltip();
    });
  }

  function showColTooltip(colEl, colIdx) {
    // Highlight the column header and its score cells; no card, so
    // nothing covers the scores below.
    if (colEl) colEl.classList.add('gb-col-hover');
    var table = document.querySelector('#gb-data table');
    if (table) {
      table.querySelectorAll('tbody tr').forEach(function (row) {
        var cell = row.children[colIdx];
        if (cell) cell.classList.add('gb-col-hover');
      });
    }
  }

  function hideColTooltip() {
    _hoveredColIdx = -1;
    document.querySelectorAll('.gb-col-hover').forEach(function (el) {
      el.classList.remove('gb-col-hover');
    });
  }

  /* The tooltip on a student's name, in two groups so the two kinds of
     number never sit side by side: the course grade as the class shows it
     (with how many assignments are NS, which count as 0 toward a %) and
     each category's grade, then each competency as a proficiency word
     with how many assignments it comes from, then how many competencies
     have evidence. Every value comes from calc.js. Kept in a map, not an
     attribute, so the HTML never round-trips through the DOM. */
  // html-safe: names, category and section names and grade text go through esc; levels come from calc.js.
  function nameTip(cid, student, sections) {
    var grade = studentGradeSummary(cid, student.id, viewedReportTerm(cid));
    var word = levelWord(cid, getOverallProficiency(cid, student.id));
    // The full name first: the name column cuts long ones off.
    var tip =
      '<div class="gb-tip-name">' +
      esc(displayName(student)) +
      '</div>' +
      '<div class="gb-tip-head">Course Grade</div>' +
      '<div class="gb-tip-grade" style="color:' +
      (grade.text ? PROF_COLORS[grade.level] || PROF_COLORS[0] : 'var(--text-3)') +
      '">' +
      (grade.text ? (word ? word + ' (' + esc(grade.text) + ')' : esc(grade.text)) : 'No Evidence') +
      '</div>';
    // NS lowers only a percentage; a Proficiency class shows none. Only work
    // the grade above counts: the year so far, outside 0% categories.
    if (courseGradeMode(cid) !== 'proficiency') {
      var ns = _scopedAssessments(cid).filter(function (a) {
        return getAssignmentStatus(cid, student.id, a.id) === 'NS' && countsTowardGrades(cid, a);
      }).length;
      if (ns > 0)
        tip +=
          '<div class="gb-tip-note">' +
          ns +
          (ns === 1 ? ' assessment missing (counts as 0)' : ' assessments missing (count as 0)') +
          '</div>';
    }
    // Categories make up the course grade, so they sit under it, each graded
    // as the class shows grades.
    var cats = getCategories(cid) || [];
    if (cats.length) {
      var scoped = _scopedAssessments(cid);
      tip += '<div class="gb-tip-head">Categories</div>';
      cats.forEach(function (cat) {
        var g = assessmentGroupGrade(
          cid,
          student.id,
          scoped.filter(function (a) {
            return (a.categoryId || a.category_id || null) === cat.id;
          }),
          categoryCalcMode(cat),
        );
        tip +=
          '<div class="gb-tip-row"><span class="gb-tip-label">' +
          esc(cat.name) +
          '</span><span class="gb-tip-val" style="color:' +
          (g ? PROF_COLORS[g.level] || PROF_COLORS[0] : 'var(--text-3)') +
          '">' +
          (g ? esc(g.text) : '\u2014') +
          '</span></div>';
      });
    }
    // Each competency's level rests only on work handed in (an NS clears its
    // scores), so the group says how much work that is, and each row how
    // many assignments it comes from.
    var allIds = {};
    var rows = '';
    var withEvidence = 0;
    sections.forEach(function (sec) {
      var ids = {};
      sec.tags.forEach(function (t) {
        getCountedTagScores(cid, student.id, t.id).forEach(function (sc) {
          if (_isScoredEvidence(sc)) ids[sc.assessmentId] = allIds[sc.assessmentId] = true;
        });
      });
      var n = Object.keys(ids).length;
      var sp = getSectionProficiency(cid, student.id, sec.id);
      if (getSectionProficiencyRaw(cid, student.id, sec.id) > 0) withEvidence++;
      var r = Math.max(0, Math.min(4, roundLevel(sp)));
      rows +=
        '<div class="gb-tip-row"><span class="gb-tip-label">' +
        esc(sec.shortName || sec.name) +
        '</span><span class="gb-tip-val" style="color:' +
        (r ? PROF_COLORS[r] : 'var(--text-3)') +
        '">' +
        esc(r ? levelText(cid, sp) : PROF_LABELS[0]) +
        (r && n ? ' <span class="gb-tip-count">· ' + n + (n === 1 ? ' assessment' : ' assessments') + '</span>' : '') +
        '</span></div>';
    });
    var handedIn = Object.keys(allIds).length;
    tip += '<div class="gb-tip-head">Competencies</div>';
    if (handedIn > 0)
      tip +=
        '<div class="gb-tip-note">From ' +
        handedIn +
        (handedIn === 1 ? ' assessment' : ' assessments') +
        ' handed in</div>';
    tip += '<div class="gb-tip-rows">' + rows + '</div>';
    tip +=
      '<div class="gb-tip-note gb-tip-foot">Evidence in ' +
      withEvidence +
      ' of ' +
      sections.length +
      (sections.length === 1 ? ' competency' : ' competencies') +
      '</div>';
    return tip;
  }

  /* ── Sorting ─────────────────────────────────────────────── */
  /* The rows in the order `sortCol` ({ key, dir, by }) gives, or as they are. */
  function sortRows(cid, students, sortCol) {
    if (!sortCol) return students;
    var key = sortCol.key;
    var dir = sortCol.dir === 'asc' ? 1 : -1;
    return students.slice().sort(function (a, b) {
      var va, vb;
      if (key === 'name') {
        var af = (a.firstName || '').toLowerCase();
        var al = (a.lastName || '').toLowerCase();
        var bf = (b.firstName || '').toLowerCase();
        var bl = (b.lastName || '').toLowerCase();
        va = sortCol.by === 'first' ? af + ' ' + al : al + ' ' + af;
        vb = sortCol.by === 'first' ? bf + ' ' + bl : bl + ' ' + bf;
        return va < vb ? -dir : va > vb ? dir : 0;
      } else if (key === 'overall' && courseGradeMode(cid) === 'letter') {
        va = (getCourseLetterData(cid, a.id) || {}).R || 0;
        vb = (getCourseLetterData(cid, b.id) || {}).R || 0;
      } else if (key === 'overall') {
        va = getOverallProficiency(cid, a.id);
        vb = getOverallProficiency(cid, b.id);
      } else if (key === 'coverage') {
        va = getCompletionPct(cid, a.id);
        vb = getCompletionPct(cid, b.id);
      } else if (key === 'grade') {
        va = (getCourseLetterData(cid, a.id) || {}).R || 0;
        vb = (getCourseLetterData(cid, b.id) || {}).R || 0;
      } else if (key.startsWith('grp-')) {
        var grpId = key.slice(4);
        va = getGroupProficiency(cid, a.id, grpId);
        vb = getGroupProficiency(cid, b.id, grpId);
      } else if (key.startsWith('sec-')) {
        var secId = key.slice(4);
        va = getSectionProficiency(cid, a.id, secId);
        vb = getSectionProficiency(cid, b.id, secId);
      } else if (key.startsWith('avg-')) {
        var aid = key.slice(4);
        var sc = getScores(cid);
        var assess = getAssessments(cid).find(function (a) {
          return a.id === aid;
        });
        var tagIds = assess ? scoreTagIds(assess, cid) : [];
        var getAvg = function (sid) {
          var ss = sc[sid] || [];
          var ts = tagIds
            .map(function (tid) {
              var e = ss.find(function (e) {
                return e.assessmentId === aid && e.tagId === tid;
              });
              return e ? scoreModValue(e) : 0;
            })
            .filter(function (v) {
              return v > 0;
            });
          var rubricVal = getRubricAssessmentScore(cid, assess, ss);
          if (rubricVal !== undefined) return rubricVal || 0;
          return ts.length > 0
            ? ts.reduce(function (x, y) {
                return x + y;
              }, 0) / ts.length
            : 0;
        };
        va = getAvg(a.id);
        vb = getAvg(b.id);
      } else {
        va = getOverallProficiency(cid, a.id);
        vb = getOverallProficiency(cid, b.id);
      }
      return (va - vb) * dir;
    });
  }

  /* ── Drawing again only what changed ─────────────────── */
  /* The piece's drafts and work to grade among the students shown, counted
     again into `_drafts` and `_work` as page-gradebook.js's _countDrafts and
     _countWork count them. */
  function recountPiece(_drafts, _work, cid, a, ids) {
    var mark = function (byAid) {
      var bySid = {};
      Object.keys(byAid).forEach(function (k) {
        byAid[k].forEach(function (s) {
          bySid[s] = true;
        });
      });
      return bySid;
    };
    if (_drafts) {
      var waiting = GraderWork.draftsIn(cid, a.id, ids);
      _drafts.total += waiting.length - (_drafts.byAid[a.id] || []).length;
      delete _drafts.byAid[a.id];
      delete _drafts.returns[a.id];
      if (waiting.length) {
        _drafts.byAid[a.id] = waiting;
        _drafts.returns[a.id] = GraderWork.draftsReturned(cid, a.id, ids);
      }
      _drafts.bySid = mark(_drafts.byAid);
    }
    if (_work && GraderWork.workOn(cid, a)) {
      var c = GraderWork.workCounts(cid, a.id, ids);
      _work.total += c.tograde - (_work.n[a.id] || 0);
      _work.n[a.id] = c.tograde;
      delete _work.byAid[a.id];
      if (c.ids.tograde.length) _work.byAid[a.id] = c.ids.tograde;
      _work.bySid = mark(_work.byAid);
    }
  }

  /* Put `html` in place of `old`, or before `before` when there is no
     `old`; '' takes `old` away. html-safe: the page hands it a part of its
     own draw (page-gradebook.js), escaped there. */
  function swapHtml(old, html, before) {
    if (old && html) old.outerHTML = html;
    else if (old) old.remove();
    // html-safe: as above, the page's own draw.
    else if (html && before) before.insertAdjacentHTML('beforebegin', html);
  }

  /* Write only the parts of draw `b` (page-gradebook.js, _build) that differ
     from `d`, the draw on the page: students' rows and names, the Class Average row, the
     toolbar. -1 when anything else differs (the columns, the rows' order),
     and nothing is written; else how many parts were. */
  function patch(d, b) {
    var data = document.getElementById('gb-data');
    var heads = document.getElementById('gb-rowheads');
    var bar = document.querySelector('#main > .gb-toolbar');
    if (!d || d.cid !== b.cid || d.frame !== b.frame || d.sids.join() !== b.sids.join() || !bar) return -1;
    var n = 0;
    var put = function (el, was, now) {
      if (was !== now) {
        // html-safe: `b`'s parts are page-gradebook.js's draw, escaped by its builders.
        el.outerHTML = now;
        n++;
      }
    };
    if (b.sids.length) {
      var trs = data ? data.querySelectorAll('tr') : [];
      if (!heads || trs.length !== b.rows.length + 1 || heads.children.length !== b.rows.length + 1) return -1;
      b.rows.forEach(function (row, i) {
        put(trs[i], d.rows[i], row);
        put(heads.children[i], d.rowheads[i], b.rowheads[i]);
      });
      put(trs[trs.length - 1], d.stats, b.stats);
      put(heads.lastElementChild, d.statsHead, b.statsHead);
    }
    put(bar, d.toolbar, b.toolbar);
    return n;
  }

  return {
    initGridHoverSync: initGridHoverSync,
    initGridScrollSync: initGridScrollSync,
    restoreGridScroll: restoreGridScroll,
    applyStickyLeft: applyStickyLeft,
    initHeaderResize: initHeaderResize,
    initColHoverTooltip: initColHoverTooltip,
    _slantedColAt: _slantedColAt,
    _inSlantedHeads: _inSlantedHeads,
    nameTip: nameTip,
    sortRows: sortRows,
    swapHtml: swapHtml,
    patch: patch,
    recountPiece: recountPiece,
  };
})();
