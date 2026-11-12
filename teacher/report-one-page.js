/* report-one-page.js — what One Report's pages do on screen: Hide a part,
   leave a row off, rename a heading, edit the Teacher Comment where it
   prints, choose the assessments, reword the questions. Everything it
   adds to a page is no-print; a printed copy is the layout's own HTML
   (report-one.js). docs/plans/one-report-build-plan.md. */
window.ReportOnePage = (function () {
  'use strict';

  var _api = null; // () => api, set at mount

  function mount(preview, apiFn) {
    _api = apiFn;
    if (_comment()) _comment().mount(preview, apiFn);
  }

  /* The Teacher Comment's editor is its own file (report-one-comment.js). */
  function _comment() {
    return typeof ReportOneComment !== 'undefined' ? ReportOneComment : null;
  }

  /* After each draw of the pages. */
  function decorate(preview, api) {
    if (_comment()) _comment().decorate(preview, api);
  }

  function handle(action, el, api, e) {
    return !!(_comment() && _comment().handle(action, el, api, e));
  }

  function change() {
    return false;
  }

  /* Print Reports asks this first; false stops the print (a comment with
     unsaved changes is saved or discarded first). */
  function beforePrint(api) {
    return _comment() ? _comment().beforePrint(api) : true;
  }

  return { mount: mount, decorate: decorate, handle: handle, change: change, beforePrint: beforePrint };
})();
