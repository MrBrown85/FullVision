// @ts-check
/* report-one-undo.js — One Report's Undo list: every named change to a
   class's report (page-reports.js _setOne), newest last, for ⌘Z (Ctrl+Z)
   on Print Reports outside a text box. A change made some other way since
   (the toast's Undo, another tab, a reload) ends the list rather than undo
   past it. */
window.ReportOneUndo = (function () {
  'use strict';

  /** @type {{ cid: string, before: any, after: string, label: string }[]} */
  var list = [];

  /**
   * A named change, made: `before` is the report it replaced, `after` the report now.
   * @param {string} cid @param {any} before @param {any} after @param {string} label
   */
  function push(cid, before, after, label) {
    var step = { cid: cid, before: before, after: JSON.stringify(after), label: label };
    list.push(step);
    if (list.length > 50) list.shift();
    return step;
  }
  /** The toast's Undo took this step: it leaves the list. @param {object} step */
  function drop(step) {
    if (list[list.length - 1] === step) list.pop();
  }
  /**
   * The step ⌘Z undoes now for class cid, whose report is `now`, taken off
   * the list; null when there is none.
   * @param {string} cid @param {any} now
   */
  function take(cid, now) {
    var step = list[list.length - 1];
    if (!step || step.cid !== cid) return null;
    if (JSON.stringify(now) !== step.after) {
      list = [];
      return null;
    }
    list.pop();
    return step;
  }
  /**
   * ⌘Z or Ctrl+Z outside a text box, a dialog and a drag.
   * @param {KeyboardEvent} e
   */
  function isKey(e) {
    if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || String(e.key).toLowerCase() !== 'z') return false;
    var t = /** @type {HTMLElement | null} */ (e.target);
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return false;
    return !document.querySelector(
      '.confirm-overlay, .one-dlg-overlay, .one-com-edit, .one-com-ask, .is-dragging, .one-w-menu, body.one-w-dragging',
    );
  }

  return { push: push, drop: drop, take: take, isKey: isKey };
})();
