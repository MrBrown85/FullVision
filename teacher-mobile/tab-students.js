/* m-students.js — Feature 1: Student Quick-Look */

window.MStudents = (function () {
  'use strict';

  var MC = window.MComponents;
  var ListUI = window.MStudentsList;
  var DetailUI = window.MStudentDetail;
  var _sortMode = 'alpha'; // 'alpha' | 'proficiency' | 'missing' | 'lastObserved'
  var _activeCid = null;

  /* ── Shared helpers ──────────────────────────────────────────── */
  function _renderBadges(st) {
    var badges = '';
    if (st.designations && st.designations.length) {
      st.designations.forEach(function (code) {
        var des = BC_DESIGNATIONS[code];
        if (des && des.iep) badges += '<span class="m-badge m-badge-iep">IEP</span>';
        if (des && des.modified) badges += '<span class="m-badge m-badge-mod">MOD</span>';
        if (code === 'ELL') badges += '<span class="m-badge m-badge-ell">ELL</span>';
      });
    }
    return badges;
  }

  /* ── Student List Screen ────────────────────────────────────── */
  function renderList(cid) {
    _activeCid = cid;
    return ListUI.renderList({
      cid: cid,
      sortMode: _sortMode,
      renderBadges: _renderBadges,
    });
  }

  /* ── Rich Student Card (for card stack) ───────────────────── */
  // html-safe: MCardWidgets.assembleCard escapes every name and text and passes colours through cssColor.
  function _renderStudentCard(st, cid, data) {
    return MCardWidgets.assembleCard(st, cid, data);
  }

  /* The term whose questionnaire answers the cards show: the one the desktop
     Reports page opens on. The term holding today, else the last one begun,
     else the first; Report 1 for a class with no terms. */
  function _cardTermId(cid) {
    var terms = getReportingTerms(cid);
    var today = courseToday(cid);
    var pick =
      reportingTermOn(cid, today) ||
      terms
        .filter(function (t) {
          return t.starts_on <= today;
        })
        .pop() ||
      terms[0];
    return 'term-' + (pick ? pick.ordinal : 1);
  }

  /* ── Init card stack after DOM render ─────────────────────── */
  var _stackInstance = null;

  function initCardStack(cid) {
    destroyCardStack();

    var container = document.getElementById('m-student-card-stack');
    if (!container) return;

    var students = getStudents(cid);
    students = sortStudents(students, _sortMode, cid);
    if (!students.length) return;

    var sections = getSections(cid);
    var allStatuses = getAssignmentStatuses(cid);
    var allAssessments = getAssessments(cid);
    var data = {
      sections: sections,
      statuses: allStatuses,
      assessments: allAssessments,
      termId: _cardTermId(cid),
      widgetConfig: getCardWidgetConfig(),
    };

    _stackInstance = MCardStack.create(container, students, {
      counterEl: document.getElementById('m-student-card-count'),
      renderCard: function (st) {
        return _renderStudentCard(st, cid, data);
      },
      onTap: function () {
        /* taps handled by data-action delegation */
      },
      onSwipe: function () {
        /* no-op, browsing only */
      },
    });
    _watchMoreBelow(container);
  }

  /* A card whose list runs past its bottom says so: "More Below" over a
     fade, until it is scrolled to the end. Checked when cards are drawn
     and as a card's list scrolls. */
  var _moreObserver = null;
  var _moreScrollOn = false;
  function _markMoreBelow(box) {
    box.classList.toggle('m-more-below', box.scrollHeight - box.scrollTop - box.clientHeight > 4);
  }
  function _watchMoreBelow(container) {
    var check = function () {
      container.querySelectorAll('.m-scard-widgets').forEach(_markMoreBelow);
    };
    requestAnimationFrame(check);
    if (_moreObserver) _moreObserver.disconnect();
    if (typeof MutationObserver === 'function') {
      _moreObserver = new MutationObserver(function () {
        requestAnimationFrame(check);
      });
      _moreObserver.observe(container, { childList: true, subtree: true });
    }
    if (!_moreScrollOn) {
      _moreScrollOn = true;
      document.addEventListener(
        'scroll',
        function (e) {
          var box = e.target;
          if (box && box.classList && box.classList.contains('m-scard-widgets')) _markMoreBelow(box);
        },
        true,
      );
    }
  }

  /* ── All Students sheet: the list, with search ─────────────── */
  function renderAllStudents(cid) {
    return ListUI.renderAllStudentsSheet({ cid: cid, sortMode: _sortMode, renderBadges: _renderBadges });
  }

  function showAllStudents() {
    MC.presentSheet(renderAllStudents(_activeCid));
  }

  // Tapping a name in the sheet brings that student's card to the front.
  function jumpToStudent(sid) {
    MC.dismissSheet();
    if (!_stackInstance) return;
    var students = sortStudents(getStudents(_activeCid), _sortMode, _activeCid);
    for (var i = 0; i < students.length; i++) {
      if (students[i].id === sid) {
        _stackInstance.goTo(i);
        return;
      }
    }
  }

  function getCardIndex() {
    return _stackInstance ? _stackInstance.getCurrentIndex() : 0;
  }

  function goToCard(idx) {
    if (_stackInstance) _stackInstance.goTo(idx);
  }

  function destroyCardStack() {
    if (_stackInstance) {
      _stackInstance.destroy();
      _stackInstance = null;
    }
  }

  function setSortMode(mode) {
    _sortMode = mode;
    MC.dismissSheet();
    initCardStack(_activeCid);
  }

  function showSortSheet() {
    var labels = { alpha: 'Name', proficiency: 'Proficiency', missing: 'Missing Work', lastObserved: 'Last Observed' };
    var opts = ['alpha', 'proficiency', 'missing', 'lastObserved']
      .map(function (m) {
        var check = _sortMode === m ? ' <span style="color:var(--link)">✓</span>' : '';
        return (
          '<button class="m-sheet-row-btn" data-action="m-set-sort" data-mode="' +
          m +
          '">' +
          labels[m] +
          check +
          '</button>'
        );
      })
      .join('');
    MC.presentSheet(
      '<div style="padding:8px 0 16px">' +
        '<div style="font-size:17px;font-weight:600;text-align:center;margin-bottom:16px">Sort Students</div>' +
        opts +
        '</div>',
    );
  }

  /* ── Student Detail Screen ──────────────────────────────────── */
  // html-safe: MStudentDetail.renderDetail escapes every name and text and passes colours through cssColor.
  function renderDetail(cid, sid) {
    return DetailUI.renderDetail({
      cid: cid,
      sid: sid,
      renderBadges: _renderBadges,
    });
  }

  /* ── Handle search filtering ────────────────────────────────── */
  function filterList(query) {
    var q = (query || '').toLowerCase().trim();
    var matches = 0;
    document.querySelectorAll('#m-student-list .m-cell').forEach(function (cell) {
      // The shown name, then every name the student goes by (data-search).
      var name = (cell.querySelector('.m-cell-title') || {}).textContent || '';
      var names = (name + ' ' + (cell.getAttribute('data-search') || '')).toLowerCase();
      var match = names.indexOf(q) >= 0;
      if (match) matches++;
      cell.style.display = match ? '' : 'none';
    });
    _showNoMatch(q && !matches ? (query || '').trim() : '');
  }

  // "No students match “zz”." under the list when a search finds no one.
  function _showNoMatch(query) {
    var list = document.getElementById('m-student-list');
    if (!list) return;
    var el = document.getElementById('m-student-search-empty');
    if (!query) {
      if (el) el.remove();
      return;
    }
    if (!el) {
      el = document.createElement('div');
      el.id = 'm-student-search-empty';
      el.className = 'm-search-empty';
      el.setAttribute('role', 'status');
      list.parentNode.insertBefore(el, list.nextSibling);
    }
    el.textContent = 'No students match \u201c' + query + '\u201d.';
  }
  return {
    renderList: renderList,
    renderDetail: renderDetail,
    filterList: filterList,
    initCardStack: initCardStack,
    destroyCardStack: destroyCardStack,
    getCardIndex: getCardIndex,
    goToCard: goToCard,
    renderAllStudents: renderAllStudents,
    showAllStudents: showAllStudents,
    jumpToStudent: jumpToStudent,
    setSortMode: setSortMode,
    showSortSheet: showSortSheet,
  };
})();
