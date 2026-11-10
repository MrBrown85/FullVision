/* Class Settings → Student Page tab (docs/plans/student-page-build-plan.md,
   S1; board "Teacher: Class Settings, Student Page").

   The tab is there only for a class whose student page is on (the build
   switch, course.student_page_enabled, read through getReturnSettings). For
   every other class it has no button, no address and no panel, unless the
   app was opened at the build address (below).

   What is on it:

   - S1-F4: Return Grades (When I Return Them, As Soon As I Save).
   - S0-W1: Student Cards, a bare list with Make Cards and Print All
     (teacher/student-cards.js).
   - S0-W1: the build switch itself, at the build address only.

   What later PRs add, none of which needs to change dash-class-manager.js:

   - S3: the rest of Student Cards (filters, Unlock, Reissue, Cards Work
     Until).
   - S5-F1: Send Work and Keep Photos Until.
   - S8-F1: the reminder and the "photos go for good" line on Keep Photos
     Until.
   - Then Preview as Student (S4), Reflect on Feedback (S10) and Show My
     Learning (S13).

   DashClassManager asks isShown(cid) before it draws the tab, opens it or
   builds its panel, and while the tab is shown hands over every sp* action,
   change and blur.

   RETURN GRADES is the class's return_grades setting: 'on_return' (When I
   Return Them), 'on_save' (As Soon As I Save), or no choice made, which
   works as As Soon As I Save. It is saved through saveCourseConfig and
   nowhere else; shared/data.js runs the rule that goes with the change.

   - No choice made (a class from before the setting): When I Return Them is
     the first choice offered, neither is marked as chosen, and a line says
     what the class does until the teacher picks. Opening the tab saves
     nothing: a class never changes how it returns grades because its
     teacher looked.
   - Leaving When I Return Them returns every grade that waits (DECISIONS,
     Student page build rulings 8). With grades waiting the tab asks first
     and names how many; Cancel leaves the setting and every one of them as
     they were.

   THE BUILD SWITCH is the class's student_page_enabled, off for every class
   until its teacher turns it on. Nothing in the app offers it. It shows, as
   a Student Page switch in a card of its own above the rest, only when the
   app was opened at an address that carries ?build=student-page, for
   example
     /dashboard?manage=student-page&build=student-page
   The address is read once, when this file loads (the app tidies its
   address afterwards), and holds until the page is reloaded without it.
   Opened that way, a class whose student page is off has the tab too, with
   the switch alone on it. Turning the switch off is leaving When I Return
   Them: with grades waiting it asks first, in the same words. It is saved
   through saveCourseConfig, like Return Grades, and a class turned on with
   no Return Grades choice made keeps none until its teacher picks. */
var CmStudentPage = (function () {
  'use strict';

  var RETURN_CHOICES = [
    { value: 'on_return', label: 'When I Return Them' },
    { value: 'on_save', label: 'As Soon As I Save' },
  ];

  // True when the app was opened at the build address (see the top).
  function _addressHasBuildFlag() {
    try {
      return new URLSearchParams(window.location.search).get('build') === 'student-page';
    } catch (e) {
      return false;
    }
  }
  var _buildFlag = _addressHasBuildFlag();

  function _settings(cid) {
    return typeof getReturnSettings === 'function' && cid ? getReturnSettings(cid) : null;
  }

  // Whether this class has the tab: with its student page on, or, at the
  // build address, any class (to turn it on).
  function isShown(cid) {
    var s = _settings(cid);
    if (!s) return false;
    return s.student_page === true || (_buildFlag && typeof COURSES !== 'undefined' && !!COURSES[cid]);
  }

  function _rerender() {
    if (typeof DashClassManager !== 'undefined' && DashClassManager.renderClassManager) {
      DashClassManager.renderClassManager();
    }
  }

  function _cid(el) {
    var box = el && el.closest ? el.closest('[data-cid]') : null;
    return box ? box.dataset.cid : null;
  }

  // The tab's one writer: Return Grades and the build switch are both class
  // settings, saved and sent as every class setting is.
  function _save(cid, cfg) {
    saveCourseConfig(cid, cfg);
  }

  /* ── Return Grades ─────────────────────────────────────────── */

  function _returnGradesRow(cid) {
    var chosen = _settings(cid).return_grades;
    return (
      '<div class="sp-row">' +
      '<div class="sp-row-head">' +
      '<div class="sp-row-title" id="sp-return-label">Return Grades</div>' +
      '<div class="cm-hint" id="sp-return-hint">' +
      esc("When a grade shows on a student's page. Until then it's a draft only you can see.") +
      '</div>' +
      '</div>' +
      '<div class="seg cm-seg" role="radiogroup" aria-labelledby="sp-return-label" aria-describedby="sp-return-hint">' +
      RETURN_CHOICES.map(function (c) {
        var on = c.value === chosen;
        return (
          '<button type="button" class="seg-btn cm-seg-btn' +
          (on ? ' active' : '') +
          '" id="sp-return-' +
          c.value +
          '" role="radio" aria-checked="' +
          on +
          '" data-action="spReturnGrades" data-value="' +
          c.value +
          '">' +
          esc(c.label) +
          '</button>'
        );
      }).join('') +
      '</div>' +
      (chosen
        ? ''
        : '<div class="cm-hint" id="sp-return-unset">' +
          esc("You haven't chosen yet. Until you do, a grade shows as soon as you save it.") +
          '</div>') +
      '<div class="cm-hint">' +
      esc('A change to a returned grade follows the same rule, and the student sees it marked Updated.') +
      '</div>' +
      '</div>'
    );
  }

  // The question asked before a class leaves When I Return Them with `n`
  // grades waiting. The message is ruling 8's.
  function _leaveQuestion(n) {
    return n === 1
      ? {
          title: 'Return 1 Grade Now?',
          message: '1 grade is waiting as a draft. Changing this returns it to the student now.',
        }
      : {
          title: 'Return ' + n + ' Grades Now?',
          message: n + ' grades are waiting as drafts. Changing this returns them to students now.',
        };
  }

  function _saveReturnGrades(cid, value) {
    if (!isShown(cid) || _settings(cid).student_page !== true) return;
    var cfg = Object.assign({}, getCourseConfig(cid));
    cfg.return_grades = value;
    // It returns what waits when the class stops holding grades.
    _save(cid, cfg);
    _rerender();
    // The redraw made the chosen button a new element.
    var again = typeof document !== 'undefined' ? document.getElementById('sp-return-' + value) : null;
    if (again && typeof again.focus === 'function') again.focus({ preventScroll: true });
  }

  function _chooseReturnGrades(cid, value) {
    if (!isShown(cid) || _settings(cid).student_page !== true) return;
    var known = RETURN_CHOICES.some(function (c) {
      return c.value === value;
    });
    var now = _settings(cid);
    if (!known || now.return_grades === value) return;
    var waiting = GradeState.holds(now) && value !== 'on_return' ? GradeState.draftsWaiting(cid) : 0;
    if (!waiting) {
      _saveReturnGrades(cid, value);
      return;
    }
    var q = _leaveQuestion(waiting);
    showConfirm(q.title, q.message, 'Return and Change', 'primary', function () {
      _saveReturnGrades(cid, value);
    });
  }

  /* ── The build switch ──────────────────────────────────────── */

  // The switch's card: only at the build address. The row is Class
  // Settings' own switch row (Folders Count as One).
  function _buildSwitchCard(cid) {
    var on = _settings(cid).student_page;
    return (
      '<div class="cm-section sp-build" data-cid="' +
      esc(cid) +
      '">' +
      '<div class="cm-recent-limit sp-build-row">' +
      '<span class="cm-recent-text"><label class="cm-label" for="sp-build-switch">Student Page</label>' +
      '<span class="cm-hint">' +
      esc(
        on
          ? 'On for this class: grades are Draft or Returned, and students can have cards. Still being built.'
          : 'Off for this class. Still being built: turn it on only for a class you are testing with.',
      ) +
      '</span></span>' +
      '<span class="gpd-switch"><input type="checkbox" role="switch" id="sp-build-switch" data-action-change="spBuildSwitch"' +
      (on ? ' checked' : '') +
      '><span class="gpd-switch-ui" aria-hidden="true"></span></span>' +
      '</div>' +
      '</div>'
    );
  }

  function _saveBuildSwitch(cid, on) {
    if (!_buildFlag || !isShown(cid)) return;
    var cfg = Object.assign({}, getCourseConfig(cid));
    if (on) cfg.student_page_enabled = true;
    else delete cfg.student_page_enabled;
    // Off returns what waits.
    _save(cid, cfg);
    _rerender();
    var again = typeof document !== 'undefined' ? document.getElementById('sp-build-switch') : null;
    if (again && typeof again.focus === 'function') again.focus({ preventScroll: true });
  }

  function _turnBuildSwitch(cid, el) {
    if (!_buildFlag || !isShown(cid)) return;
    var now = _settings(cid);
    var on = !!(el && el.checked);
    if (on === now.student_page) return;
    var waiting = !on && GradeState.holds(now) ? GradeState.draftsWaiting(cid) : 0;
    if (!waiting) {
      _saveBuildSwitch(cid, on);
      return;
    }
    // Still on until the teacher answers; Cancel leaves it so.
    el.checked = true;
    var q = _leaveQuestion(waiting);
    showConfirm(q.title, q.message, 'Return and Change', 'primary', function () {
      _saveBuildSwitch(cid, false);
    });
  }

  /* ── The panel ─────────────────────────────────────────────── */

  // The panel's HTML for a class: nothing for a class without the tab.
  function render(cid) {
    if (!isShown(cid)) return '';
    var on = _settings(cid).student_page;
    return (
      (_buildFlag ? _buildSwitchCard(cid) : '') +
      (on
        ? '<div class="cm-section sp-card" data-cid="' +
          esc(cid) +
          '">' +
          '<h2 class="cm-grade-title">Student Page</h2>' +
          _returnGradesRow(cid) +
          '</div>' +
          (typeof StudentCards !== 'undefined' ? StudentCards.render(cid) : '')
        : '')
    );
  }

  // Each returns true when the click, change or blur was this tab's.
  function handleAction(action, el) {
    if (/^spCards/.test(action)) {
      var cid = _cid(el);
      if (typeof StudentCards === 'undefined' || !cid || _settings(cid).student_page !== true) return false;
      return StudentCards.handleAction(action, el);
    }
    if (action !== 'spReturnGrades') return false;
    _chooseReturnGrades(_cid(el), el && el.dataset ? el.dataset.value : null);
    return true;
  }

  function handleChange(el) {
    if (!el || !el.dataset || el.dataset.actionChange !== 'spBuildSwitch') return false;
    _turnBuildSwitch(_cid(el), el);
    return true;
  }

  function handleBlur(el) {
    return false;
  }

  // Put the tab back as the address has it (tests).
  function _reset() {
    _buildFlag = _addressHasBuildFlag();
  }
  // Tests: as if the app had been opened at the build address, or not.
  function _setBuildFlag(on) {
    _buildFlag = !!on;
  }

  return {
    isShown: isShown,
    render: render,
    handleAction: handleAction,
    handleChange: handleChange,
    handleBlur: handleBlur,
    _reset: _reset,
    _setBuildFlag: _setBuildFlag,
  };
})();
if (typeof window !== 'undefined') window.CmStudentPage = CmStudentPage;
