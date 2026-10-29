/* m-students.js — Feature 1: Student Quick-Look */

window.MStudents = (function () {
  'use strict';

  var MC = window.MComponents;
  var ListUI = window.MStudentsList;
  var DetailUI = window.MStudentDetail;
  var _viewMode = 'cards'; // 'cards' or 'list'
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

  function _syncViewVisibility(showCards) {
    var container = document.getElementById('m-student-card-stack');
    var list = document.getElementById('m-student-list');
    if (container) {
      container.style.display = showCards ? '' : 'none';
      // Cards view sizes the stack to the screen (see .m-cards-mode).
      var content = container.closest('.m-screen-content');
      if (content) content.classList.toggle('m-cards-mode', showCards);
    }
    if (list) {
      list.style.display = showCards ? 'none' : '';
      if (!showCards)
        list.querySelectorAll('.m-cell').forEach(function (c) {
          c.style.display = '';
        });
    }
  }

  /* ── Student List Screen ────────────────────────────────────── */
  function renderList(cid) {
    _activeCid = cid;
    return ListUI.renderList({
      cid: cid,
      viewMode: _viewMode,
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

    if (_viewMode === 'list') {
      _syncViewVisibility(false);
      return;
    }

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

    _syncViewVisibility(true);
    _initLongPress(container, cid);
  }

  // Long-press listeners — attached once per container element
  var _longPressContainer = null;
  var _longPressTimer = null;

  function _initLongPress(container, cid) {
    if (_longPressContainer === container) return;
    _longPressContainer = container;

    container.addEventListener(
      'touchstart',
      function (e) {
        if (e.target.closest('button') || e.target.closest('[data-action]')) return;
        _longPressTimer = setTimeout(function () {
          _longPressTimer = null;
          MCardWidgetEditor.show(function onUpdate() {
            initCardStack(cid);
          });
        }, 500);
      },
      { passive: true },
    );

    container.addEventListener(
      'touchmove',
      function () {
        if (_longPressTimer) {
          clearTimeout(_longPressTimer);
          _longPressTimer = null;
        }
      },
      { passive: true },
    );

    container.addEventListener(
      'touchend',
      function () {
        if (_longPressTimer) {
          clearTimeout(_longPressTimer);
          _longPressTimer = null;
        }
      },
      { passive: true },
    );
  }

  function setViewMode(mode) {
    if (mode !== 'cards' && mode !== 'list') return;
    _viewMode = mode;

    // Update toggle buttons
    document.querySelectorAll('.m-view-toggle-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });

    if (mode === 'list') {
      destroyCardStack();
      _syncViewVisibility(false);
    } else {
      _syncViewVisibility(true);
      initCardStack(_activeCid);
    }
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
    var listEl = document.getElementById('m-student-list');
    if (listEl) {
      var students = sortStudents(getStudents(_activeCid), mode, _activeCid);
      var allStatuses = getAssignmentStatuses(_activeCid);
      var allAssessments = getAssessments(_activeCid);
      listEl.innerHTML = ListUI.buildCells(students, _activeCid, allStatuses, allAssessments, _renderBadges);
    }
    if (_viewMode === 'cards') initCardStack(_activeCid);
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
        '<button class="m-btn-ghost" data-action="m-dismiss-sheet" style="margin-top:8px">Cancel</button>' +
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
    if (q) {
      // Searching: always show filtered list, hide cards
      _syncViewVisibility(false);
      document.querySelectorAll('#m-student-list .m-cell').forEach(function (cell) {
        var name = (cell.querySelector('.m-cell-title') || {}).textContent || '';
        var match = name.toLowerCase().indexOf(q) >= 0;
        if (match) matches++;
        cell.style.display = match ? '' : 'none';
      });
    } else {
      // Search cleared: restore the active view mode
      _syncViewVisibility(_viewMode === 'cards' && !!_stackInstance);
    }
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
    setViewMode: setViewMode,
    setSortMode: setSortMode,
    showSortSheet: showSortSheet,
  };
})();
