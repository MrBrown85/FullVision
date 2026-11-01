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
  function _renderStudentCard(st, cid, data) {
    return MCardWidgets.assembleCard(st, cid, data);
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
      termId: 'term-1',
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
      var name = (cell.querySelector('.m-cell-title') || {}).textContent || '';
      var match = name.toLowerCase().indexOf(q) >= 0;
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
