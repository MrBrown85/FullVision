/* students-list.js — Mobile students list rendering helpers */
window.MStudentsList = (function () {
  'use strict';

  var MC = window.MComponents;

  // The grade beside each name, as the class is set to grade (see
  // studentGradeBadges): level out of 4, letter and %, or both.
  function _gradeBadgesHtml(grades) {
    var html = '';
    if (grades.prof) {
      html +=
        '<div class="m-prof-badge" style="background:' +
        MC.profBg(grades.prof.level) +
        '">' +
        grades.prof.text +
        '</div>';
    }
    if (grades.letter) {
      html +=
        '<div class="m-prof-badge m-grade-pill" style="background:' +
        MC.profBg(grades.letter.level) +
        '">' +
        MC.esc(grades.letter.text) +
        '</div>';
    }
    return html || '<div class="m-prof-badge" style="background:' + MC.profBg(0) + '">—</div>';
  }

  function buildCells(students, cid, allStatuses, allAssessments, renderBadges) {
    var html = '';
    students.forEach(function (st) {
      var grades = studentGradeBadges(cid, st.id);
      var color = MC.avatarColor(st.id);
      var initials = MC.avatarInitials(st);
      var name = displayName(st);
      var subtitle = '';
      if (st.pronouns) subtitle += MC.esc(st.pronouns);

      var badges = renderBadges(st);

      var hasMissing = allAssessments.some(function (a) {
        return allStatuses[st.id + ':' + a.id] === 'NS';
      });
      var missingDot = hasMissing ? '<div class="m-missing-dot"></div>' : '';

      html +=
        '<div class="m-cell" role="button" tabindex="0" data-action="m-student-detail" data-sid="' +
        st.id +
        '">' +
        '<div class="m-cell-avatar" style="background:' +
        color +
        '">' +
        initials +
        missingDot +
        '</div>' +
        '<div class="m-cell-body">' +
        '<div class="m-cell-title">' +
        MC.esc(name) +
        badges +
        '</div>' +
        (subtitle ? '<div class="m-cell-subtitle">' + subtitle + '</div>' : '') +
        '</div>' +
        '<div class="m-cell-accessory">' +
        _gradeBadgesHtml(grades) +
        MC.ICONS.chevronRight +
        '</div></div>';
    });
    return html;
  }

  function renderList(opts) {
    var cid = opts.cid;
    var viewMode = opts.viewMode;
    var sortMode = opts.sortMode;
    var renderBadges = opts.renderBadges;
    var students = getStudents(cid);
    students = sortStudents(students, sortMode, cid);

    var toggleHTML =
      '<div class="m-view-toggle">' +
      '<button class="m-view-toggle-btn' +
      (viewMode === 'cards' ? ' active' : '') +
      '" data-action="m-set-view" data-mode="cards">Cards</button>' +
      '<button class="m-view-toggle-btn' +
      (viewMode === 'list' ? ' active' : '') +
      '" data-action="m-set-view" data-mode="list">List</button>' +
      '</div>';

    var nav = MC.navBar({
      id: 'students-list',
      title: 'Students',
      rightHTML:
        toggleHTML +
        '<button class="m-nav-bar-action" data-action="m-sort" title="Sort">' +
        MC.ICONS.sort +
        '</button>' +
        '<button class="m-nav-bar-action" data-action="m-settings" title="Settings">' +
        MC.ICONS.settings +
        '</button>',
    });

    var search =
      '<div class="m-search-wrap"><input class="m-search-input" type="search" placeholder="Search students..." data-action="m-student-search" autocomplete="off"></div>';
    var allStatuses = getAssignmentStatuses(cid);
    var allAssessments = getAssessments(cid);

    var cells = '';
    if (!students.length) {
      cells =
        '<div class="m-empty"><div class="m-empty-icon">👤</div><div class="m-empty-title">No Students</div><div class="m-empty-subtitle">Add students on the desktop app</div></div>';
    } else {
      cells =
        '<div class="m-list" id="m-student-list">' +
        buildCells(students, cid, allStatuses, allAssessments, renderBadges) +
        '</div>';
    }

    var cardStack = students.length ? '<div class="m-card-stack" id="m-student-card-stack"></div>' : '';

    return (
      '<div class="m-screen" id="m-screen-students-list">' +
      nav +
      '<div class="m-screen-content">' +
      MC.largeTitleHTML('Students') +
      search +
      cardStack +
      cells +
      '</div></div>'
    );
  }

  return {
    buildCells: buildCells,
    renderList: renderList,
  };
})();
