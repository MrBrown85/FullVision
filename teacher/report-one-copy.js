// @ts-check
/* report-one-copy.js — Use This Wording in My Other Classes, from a
   reflection's or the response's ⋯ menu on One Report's page
   (report-one-words.js): this class's wording for the part, saved into
   the classes the teacher picks, with one Undo that puts every class back.
   Each class's report settings are read and saved whole; only its wording
   for that part changes. */
window.ReportOneCopy = (function () {
  'use strict';

  /**
   * @param {string} tag @param {string} [cls] @param {string} [text]
   * @returns {any}
   */
  function _el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  /**
   * The teacher's other classes, not archived, each saying whether it has
   * its own wording for key.
   * @param {string} cid @param {string} key
   * @returns {{ cid: string, name: string, own: boolean }[]}
   */
  function classes(cid, key) {
    return Object.keys(COURSES || {})
      .filter(function (id) {
        return id !== cid && !isCourseArchived(id);
      })
      .map(function (id) {
        var rc = getReportConfig(id) || {};
        var w = rc.one && rc.one.wording;
        return { cid: id, name: printClassName(COURSES[id]), own: !!(w && w[key]) };
      });
  }

  /**
   * Saves wording (null: the original) as key's wording in each of cids.
   * @param {string} key @param {any} wording @param {string[]} cids
   */
  function copy(key, wording, cids) {
    /** @type {{ cid: string, one: any }[]} */
    var befores = [];
    cids.forEach(function (id) {
      var rc = Object.assign({}, getReportConfig(id) || {});
      befores.push({ cid: id, one: rc.one ? JSON.parse(JSON.stringify(rc.one)) : null });
      var theirs = ReportOne.forConfig(rc);
      var w = wording ? JSON.parse(JSON.stringify(wording)) : null;
      rc.one = ReportOne.normalize(ReportOne.setWording(theirs, key, w));
      saveReportConfig(id, rc);
    });
    var n = cids.length;
    showUndoToast('Used this wording in ' + n + (n === 1 ? ' other class' : ' other classes'), function () {
      befores.forEach(function (b) {
        var rc = Object.assign({}, getReportConfig(b.cid) || {});
        if (b.one) rc.one = b.one;
        else delete rc.one;
        saveReportConfig(b.cid, rc);
      });
    });
  }

  /**
   * The dialog: the other classes to tick, then Use in N Classes.
   * @param {{ cid: string, model(): any }} api @param {string} key
   */
  function dialog(api, key) {
    var list = classes(api.cid, key);
    var opener = /** @type {HTMLElement | null} */ (document.activeElement);
    var overlay = _el('div', 'one-pg no-print one-dlg-overlay one-w-copy');
    var card = _el('div', 'one-dlg');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-labelledby', 'one-w-copy-title');
    var head = _el('div', 'one-dlg-head');
    var hd = _el('div');
    var h2 = _el('h2', '', 'Use This Wording in My Other Classes');
    h2.id = 'one-w-copy-title';
    hd.appendChild(h2);
    hd.appendChild(_el('p', '', ReportOne.label(key, api.cid) + ', as it is in this class now.'));
    head.appendChild(hd);
    card.appendChild(head);
    var box = _el('div', 'one-w-copy-list');
    list.forEach(function (c) {
      var row = _el('label', 'one-w-copy-row');
      var cb = _el('input');
      cb.type = 'checkbox';
      cb.value = c.cid;
      row.appendChild(cb);
      var t = _el('span', '', c.name);
      if (c.own) t.appendChild(_el('small', '', 'Has its own wording. This replaces it.'));
      row.appendChild(t);
      box.appendChild(row);
    });
    card.appendChild(box);
    var foot = _el('div', 'one-w-copy-foot');
    var cancel = _el('button', 'one-w-copy-cancel', 'Cancel');
    cancel.type = 'button';
    var go = _el('button', 'one-dlg-done', 'Use in 0 Classes');
    go.type = 'button';
    go.disabled = true;
    foot.appendChild(cancel);
    foot.appendChild(go);
    card.appendChild(foot);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    var chosen = function () {
      return Array.prototype.slice.call(box.querySelectorAll('input:checked')).map(function (x) {
        return x.value;
      });
    };
    var close = function () {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      if (opener && opener.isConnected && opener.focus) opener.focus();
    };
    box.addEventListener('change', function () {
      var n = chosen().length;
      go.disabled = !n;
      go.textContent = 'Use in ' + n + (n === 1 ? ' Class' : ' Classes');
    });
    cancel.addEventListener('click', close);
    overlay.addEventListener('click', function (/** @type {MouseEvent} */ e) {
      if (e.target === overlay) close();
    });
    overlay.addEventListener('keydown', function (/** @type {KeyboardEvent} */ e) {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      } else if (e.key === 'Tab') {
        // Tab stays in the dialog.
        var items = Array.prototype.slice.call(card.querySelectorAll('input, button:not([disabled])'));
        var at = items.indexOf(document.activeElement);
        if (e.shiftKey ? at <= 0 : at === items.length - 1) {
          e.preventDefault();
          items[e.shiftKey ? items.length - 1 : 0].focus();
        }
      }
    });
    go.addEventListener('click', function () {
      var cids = chosen();
      var m = api.model();
      close();
      if (cids.length) copy(key, (m.wording && m.wording[key]) || null, cids);
    });
    var first = box.querySelector('input');
    if (first) first.focus();
  }

  return { classes: classes, copy: copy, dialog: dialog };
})();
