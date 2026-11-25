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
      // Search finds every name the student goes by: legal first and last,
      // and the preferred name, as a MyEd roster search does.
      var searchText = [st.firstName, st.lastName, st.preferred, fullName(st), displayNameWithLast(st)]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      var badges = renderBadges(st);

      // Missing work says so in words under the name; an unexplained red
      // dot on the avatar told the teacher nothing.
      var missingN = allAssessments.filter(function (a) {
        return allStatuses[st.id + ':' + a.id] === 'NS';
      }).length;
      var subtitle = [];
      if (st.pronouns) subtitle.push(MC.esc(st.pronouns));
      if (missingN) subtitle.push('<span class="m-cell-missing">' + missingN + ' missing</span>');
      subtitle = subtitle.join(' \u00b7 ');

      html +=
        '<div class="m-cell" role="button" tabindex="0" data-action="' +
        action +
        '" data-sid="' +
        st.id +
        '" data-search="' +
        MC.esc(searchText) +
        '">' +
        '<div class="m-cell-avatar" style="background:' +
        color +
        '">' +
        MC.esc(initials) +
        '</div>' +
        '<div class="m-cell-body">' +
        // A long name is cut, never the IEP, MOD or ELL badge after it.
        '<div class="m-cell-title m-student-title"><span class="m-student-title-name">' +
        MC.esc(name) +
        '</span>' +
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
  // sheet from the name at the top of a card (renderAllStudentsSheet): the one
  // way to it, since Nov 25 (there was an All Students button under the stack too).
  function renderList(opts) {
    var cid = opts.cid;
    var students = getStudents(cid);

    var nav = MC.tabBar(cid, {
      id: 'students-list',
      rightHTML: '<button class="m-nav-bar-action" data-action="m-sort" title="Sort">' + MC.ICONS.sort + '</button>',
    });

    var body;
    if (!students.length) {
      body =
        '<div class="m-empty"><div class="m-empty-title">No Students</div><div class="m-empty-subtitle">Add students on the desktop app</div></div>';
    } else {
      body = '<div class="m-card-stack" id="m-student-card-stack"></div>';
    }

    // Photos in a class about to go a year unopened (shared/photo-expiry.js): rarely anything.
    return (
      '<div class="m-screen" id="m-screen-students-list">' +
      nav +
      '<div class="m-screen-content' +
      (students.length ? ' m-cards-mode' : '') +
      '">' +
      PhotoExpiry.mount('phone') +
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
      buildCells(
        students,
        cid,
        getAssignmentStatuses(cid),
        getAssignedAssessments(cid),
        opts.renderBadges,
        'm-jump-student',
      ) +
      '</div>'
    );
  }

  return {
    renderList: renderList,
    renderAllStudentsSheet: renderAllStudentsSheet,
  };
})();
