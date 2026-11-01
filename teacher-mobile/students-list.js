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

  // `action` is what a tap does: open the profile (default) or, in the
  // All Students sheet, jump to that student's card.
  function buildCells(students, cid, allStatuses, allAssessments, renderBadges, action) {
    action = action || 'm-student-detail';
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
        '<div class="m-cell" role="button" tabindex="0" data-action="' +
        action +
        '" data-sid="' +
        st.id +
        '">' +
        '<div class="m-cell-avatar" style="background:' +
        color +
        '">' +
        MC.esc(initials) +
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

  // Students screen: the card stack only. The list, with search, opens as a
  // sheet from All Students under the stack (renderAllStudentsSheet).
  function renderList(opts) {
    var cid = opts.cid;
    var students = getStudents(cid);

    var nav = MC.navBar({
      id: 'students-list',
      title: 'Students',
      rightHTML:
        '<div class="m-sync" role="status"><div class="tb-sync-dot idle" id="sync-indicator-dot" title="All changes saved" aria-label="All changes saved"></div></div>' +
        '<button class="m-nav-bar-action" data-action="m-sort" title="Sort">' +
        MC.ICONS.sort +
        '</button>' +
        '<button class="m-nav-bar-action" data-action="m-settings" title="Settings">' +
        MC.ICONS.settings +
        '</button>',
    });

    var body;
    if (!students.length) {
      body =
        '<div class="m-empty"><div class="m-empty-title">No Students</div><div class="m-empty-subtitle">Add students on the desktop app</div></div>';
    } else {
      body =
        '<div class="m-card-stack" id="m-student-card-stack"></div>' +
        '<div class="m-card-foot">' +
        '<span class="m-card-count" id="m-student-card-count"></span>' +
        '<button class="m-card-all" data-action="m-all-students">All Students</button>' +
        '</div>';
    }

    return (
      '<div class="m-screen" id="m-screen-students-list">' +
      nav +
      '<div class="m-screen-content' +
      (students.length ? ' m-cards-mode' : '') +
      '">' +
      body +
      '</div></div>'
    );
  }

  function renderAllStudentsSheet(opts) {
    var cid = opts.cid;
    var students = sortStudents(getStudents(cid), opts.sortMode, cid);
    return (
      '<div class="m-sheet-title">All Students</div>' +
      '<div class="m-search-wrap m-search-wrap-sheet"><input class="m-search-input" type="search" placeholder="Search students..." data-action="m-student-search" autocomplete="off"></div>' +
      '<div class="m-list m-list-sheet" id="m-student-list">' +
      buildCells(students, cid, getAssignmentStatuses(cid), getAssessments(cid), opts.renderBadges, 'm-jump-student') +
      '</div>'
    );
  }

  return {
    buildCells: buildCells,
    renderList: renderList,
    renderAllStudentsSheet: renderAllStudentsSheet,
  };
})();
