// @ts-check
/* view-as-student.js — "View as Student": the teacher's way into Preview as
   Student (teacher/preview-student.js) from where they already are: a
   student's own page, an assignment card's ⋯ menu, and the Bulletins page.
   Class Settings › Student Page keeps its own Open Preview.

   It shows only where the preview can work: a class whose Student Page is
   on. The student is the one Class Settings would preview (the one chosen
   there, else the first on the roster). From an assignment card the preview
   opens with that piece showing, where the student page itself would show it
   (Assignments, or My Learning once it is handed in); from Bulletins, on the
   Bulletins tab. Nothing is sent. Escape gives the focus back to the control.

   A control is drawn by buttonHtml / menuItemHtml and answered here: one
   click handler on the document, for data-action="viewAsStudent". */
/** @type {any} */ (window).ViewAsStudent = (function () {
  'use strict';

  var EYE_ICON =
    '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8z"/><circle cx="8" cy="8" r="2"/></svg>';

  // The answer for the class last asked, kept to the end of the task: a page draws a menu per card in one go.
  /** @type {{ cid: string, on: boolean } | null} */
  var _memo = null;

  // True when the class has its Student Page on (the switch alone, so a menu on every card reads no roster).
  function offered(cid) {
    if (!cid || typeof PreviewStudent === 'undefined' || typeof getReturnSettings !== 'function') return false;
    if (_memo && _memo.cid === cid) return _memo.on;
    _memo = { cid: cid, on: getReturnSettings(cid).student_page === true };
    Promise.resolve().then(function () {
      _memo = null;
    });
    return _memo.on;
  }

  // html-safe: the class id goes through esc; the label and classes are fixed
  function buttonHtml(cid, cls, attrs) {
    if (!offered(cid)) return '';
    return (
      '<button type="button" class="' +
      cls +
      '" data-action="viewAsStudent" data-cid="' +
      esc(cid) +
      '"' +
      (attrs || '') +
      '>View as Student</button>'
    );
  }

  // The Bulletins page's, at the right end of its header: the preview opens on the Bulletins tab.
  function bulletinsButtonHtml(cid) {
    if (!offered(cid) || !CmStudentPage.previewStudent(cid)) return '';
    return buttonHtml(cid, 'btn sp-tint-btn bulletin-view-as', ' data-tab="bulletins"');
  }

  // One more item for the assignment card's ⋯ menu (`item` is that menu's own item builder). A Draft
  // is in no student's page, so it has none.
  // html-safe: ids go through esc; the label and icon are fixed
  function menuItemHtml(cid, a, item) {
    if (!a || a.isDraft || !offered(cid)) return '';
    return item('data-action="viewAsStudent" data-aid="' + esc(a.id) + '"', EYE_ICON, 'View as Student');
  }

  // Where the student page would show a piece: its card on Assignments while it is to do, work sent and
  // waiting on My Learning, Your Feedback once it is returned (the page's own presses, so the same page
  // is drawn as when a student taps it). A piece the student has none of leaves the page as it opens.
  function _uiFor(cid, sid, aid) {
    var ui = { tab: 'assignments' };
    if (!aid || typeof StudentView === 'undefined' || typeof StudentPageView === 'undefined') return ui;
    var built = StudentView.fromCache(cid, sid, {});
    if (!built || !built.ready) return ui;
    var el = {
      getAttribute: function (/** @type {string} */ name) {
        return name === 'data-piece' ? aid : '';
      },
    };
    var out =
      StudentPageView.press(ui, built.view, 'pick', el) || StudentPageView.press(ui, built.view, 'feedback', el);
    return out ? out.ui : ui;
  }

  function open(cid, trigger, opts) {
    if (!offered(cid)) return false;
    var sid = CmStudentPage.previewStudent(cid);
    if (!sid) return false;
    var o = opts || {};
    var ui = o.tab ? { tab: o.tab } : _uiFor(cid, sid, o.aid);
    return PreviewStudent.open(cid, sid, o.focusEl || trigger, o.returnId, { ui: ui });
  }

  document.addEventListener('click', function (e) {
    var t = /** @type {Element} */ (e.target);
    var el = /** @type {HTMLElement | null} */ (t && t.closest ? t.closest('[data-action="viewAsStudent"]') : null);
    if (!el) return;
    var d = el.dataset;
    var inMenu = el.closest('.assess-menu');
    // From a ⋯ menu the menu closes, so the focus goes back to its ⋯ button.
    var more =
      inMenu && inMenu.parentElement ? inMenu.parentElement.querySelector('[data-action="toggleCardMenu"]') : null;
    open(d.cid || (typeof getActiveCourse === 'function' ? getActiveCourse() : ''), more || el, {
      aid: d.aid,
      tab: d.tab,
    });
  });

  return {
    offered: offered,
    buttonHtml: buttonHtml,
    bulletinsButtonHtml: bulletinsButtonHtml,
    menuItemHtml: menuItemHtml,
    open: open,
  };
})();
