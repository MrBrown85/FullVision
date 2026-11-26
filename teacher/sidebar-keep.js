// @ts-check
/* sidebar-keep.js — the student list beside the page (renderSidebar in ui.js).

   The list is drawn once. Moving to another page, or a score changing, patches
   what really differs into the list that is there, so its rows, its search
   text and its scroll stay as they are and nothing flashes (Colin, Nov 26,
   2026). It is drawn new when the class differs, and a row whose kind differs
   (a link on one page, a button on another) is drawn new on its own.

   The router calls release() when a page changes and settle() once the new
   page has drawn: a list the page did not draw is cleared, except where the
   page hid it (Gradebook, My Sentence Starters), which keeps it for the next
   page. */
window.SidebarKeep = (function () {
  'use strict';

  /** @returns {any} */
  function _mount() {
    return document.getElementById('sidebar-mount');
  }

  /** Nodes the pages add to the list after it is drawn (a note under a name,
   * controls above the list) are not in the markup; they are kept, and the
   * page fills them again.
   * @param {Node} n */
  function _isPageOwned(n) {
    var el = /** @type {Element} */ (n);
    return n.nodeType === 1 && (el.id === 'gb-sidebar-extra' || el.classList.contains('student-row-note'));
  }

  /** Rows match by student, the rest by id (keep-dom.js does the patching).
   * @type {any} */
  var KEEP = {
    key: function (/** @type {Node} */ n) {
      if (n.nodeType !== 1) return '';
      var el = /** @type {Element} */ (n);
      var sid = el.getAttribute('data-sid');
      return sid ? 'sid:' + sid : el.id ? 'id:' + el.id : '';
    },
    own: _isPageOwned,
    // The grades are filled in place by the page (fillSidebarBadges).
    shallow: function (/** @type {Element} */ el) {
      return el.classList.contains('student-row-grades');
    },
    keepClasses: ['roster-hidden'],
    // A typed search is the teacher's, not the markup's.
    keepTyped: true,
  };

  /** The class a list's picker shows.
   * @param {ParentNode} root */
  function _course(root) {
    var sel = /** @type {HTMLSelectElement | null} */ (root.querySelector('#gb-course-select'));
    return sel ? sel.value : null;
  }

  /** Puts the list the page drew (renderSidebar's markup) in the mount,
   * patching the list already there when it is the same class's.
   * @param {string} html */
  function draw(html) {
    var mount = _mount();
    if (!mount) return;
    mount._fvStale = false;
    if (!mount.querySelector('#gb-sidebar')) {
      mount.innerHTML = html; // html-safe: renderSidebar's markup (ui.js), escaped where it is built
      return;
    }
    var t = document.createElement('template');
    t.innerHTML = html; // html-safe: as above
    var want = _course(t.content);
    if (!want || _course(mount) !== want) {
      mount.replaceChildren(t.content);
      return;
    }
    window.KeepDom.patch(mount, t.content, KEEP);
    var search = /** @type {HTMLInputElement | null} */ (document.getElementById('gb-roster-search'));
    var w = /** @type {any} */ (window);
    if (search && search.value && typeof w.filterRoster === 'function') w.filterRoster();
  }

  /** A page is changing: the list stays until the new page draws or hides it. */
  function release() {
    var mount = _mount();
    if (!mount) return;
    mount._fvStale = true;
    mount.style.display = '';
    var layout = document.getElementById('page-layout');
    if (layout) layout.classList.remove('sidebar-hidden', 'sidebar-overlay');
  }

  /** The new page has drawn. A list it neither drew nor hid is cleared. */
  function settle() {
    var mount = _mount();
    if (!mount || !mount._fvStale) return;
    mount._fvStale = false;
    if (mount.style.display === 'none') return;
    mount.innerHTML = '';
  }

  return { draw: draw, release: release, settle: settle };
})();
