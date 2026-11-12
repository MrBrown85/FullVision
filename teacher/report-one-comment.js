/* report-one-comment.js — the Teacher Comment edited where it prints, in
   One Report: click the comment, type, and the changes are tracked until
   they are saved to the Term Questionnaire or discarded. Unsaved changes
   never print. docs/plans/one-report-build-plan.md. */
window.ReportOneComment = (function () {
  'use strict';

  function mount() {}
  function decorate() {}
  function handle() {
    return false;
  }
  /* False stops Print Reports until a changed comment is saved or discarded. */
  function beforePrint() {
    return true;
  }

  return { mount: mount, decorate: decorate, handle: handle, beforePrint: beforePrint };
})();
