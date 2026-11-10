/* Class Settings → Student Page tab (docs/plans/student-page-build-plan.md,
   S1; board "Teacher: Class Settings, Student Page").

   The tab is there only for a class whose student page is on (the build
   switch, course.student_page_enabled, read through getReturnSettings). For
   every other class, and for every signed-in teacher until the server knows
   the setting (S0-W1), it has no button, no address and no panel.

   What is on it:

   - S1-F4: Return Grades (When I Return Them, As Soon As I Save).

   What later PRs add, none of which needs to change dash-class-manager.js:

   - S3: the Student Cards card.
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
     they were. */
var CmStudentPage = (function () {
  'use strict';

  var RETURN_CHOICES = [
    { value: 'on_return', label: 'When I Return Them' },
    { value: 'on_save', label: 'As Soon As I Save' },
  ];

  function _settings(cid) {
    return typeof getReturnSettings === 'function' && cid ? getReturnSettings(cid) : null;
  }

  // Whether this class has the tab: only with its student page on.
  function isShown(cid) {
    var s = _settings(cid);
    return !!s && s.student_page === true;
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
    if (!isShown(cid)) return;
    var cfg = Object.assign({}, getCourseConfig(cid));
    cfg.return_grades = value;
    // The one writer of the setting. It returns what waits when the class
    // stops holding grades.
    saveCourseConfig(cid, cfg);
    _rerender();
    // The redraw made the chosen button a new element.
    var again = typeof document !== 'undefined' ? document.getElementById('sp-return-' + value) : null;
    if (again && typeof again.focus === 'function') again.focus({ preventScroll: true });
  }

  function _chooseReturnGrades(cid, value) {
    if (!isShown(cid)) return;
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

  /* ── The panel ─────────────────────────────────────────────── */

  // The panel's HTML for a class: nothing for a class without the tab.
  function render(cid) {
    if (!isShown(cid)) return '';
    return (
      '<div class="cm-section sp-card" data-cid="' +
      esc(cid) +
      '">' +
      '<h2 class="cm-grade-title">Student Page</h2>' +
      _returnGradesRow(cid) +
      '</div>'
    );
  }

  // Each returns true when the click, change or blur was this tab's.
  function handleAction(action, el) {
    if (action !== 'spReturnGrades') return false;
    _chooseReturnGrades(_cid(el), el && el.dataset ? el.dataset.value : null);
    return true;
  }

  function handleChange(el) {
    return false;
  }

  function handleBlur(el) {
    return false;
  }

  // Forget what the tab holds between classes (tests). It holds nothing.
  function _reset() {}

  return {
    isShown: isShown,
    render: render,
    handleAction: handleAction,
    handleChange: handleChange,
    handleBlur: handleBlur,
    _reset: _reset,
  };
})();
if (typeof window !== 'undefined') window.CmStudentPage = CmStudentPage;
