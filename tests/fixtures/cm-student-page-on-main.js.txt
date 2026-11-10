/* Class Settings → Student Page tab (docs/plans/student-page-build-plan.md,
   S1-T4; board "Teacher: Class Settings, Student Page").

   Empty and hidden for now: the tab has no button, no address and no panel
   in any class. Later PRs fill it, and none of them needs to change
   dash-class-manager.js again:

   - S1-F4: Return Grades (When I Return Them, As Soon As I Save). It also
     shows the tab, behind the build switch (course.student_page_enabled),
     by changing isShown below.
   - S3: the Student Cards card.
   - S5-F1: Send Work and Keep Photos Until.
   - S8-F1: the reminder and the "photos go for good" line on Keep Photos
     Until.
   - Then Preview as Student (S4), Reflect on Feedback (S10) and Show My
     Learning (S13).

   DashClassManager asks isShown(cid) before it draws the tab, opens it or
   builds its panel, and while the tab is shown hands over every sp* action,
   change and blur. */
var CmStudentPage = (function () {
  'use strict';

  // Whether this class has the tab. No class does until S1-F4.
  function isShown(cid) {
    return false;
  }

  // The panel's HTML for a class.
  function render(cid) {
    return '';
  }

  // Each returns true when the click, change or blur was this tab's.
  function handleAction(action, el) {
    return false;
  }

  function handleChange(el) {
    return false;
  }

  function handleBlur(el) {
    return false;
  }

  // Forget what the tab holds between classes (tests).
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
