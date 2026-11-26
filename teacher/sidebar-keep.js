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

  /** @param {Node} n */
  function _key(n) {
    if (n.nodeType !== 1) return '';
    var el = /** @type {HTMLElement} */ (n);
    var sid = el.getAttribute('data-sid');
    return sid ? 'sid:' + sid : el.id ? 'id:' + el.id : '';
  }

  /** @param {Element} old @param {Element} fresh */
  function _syncAttrs(old, fresh) {
    var keepHidden = old.classList.contains('roster-hidden');
    var i;
    for (i = old.attributes.length - 1; i >= 0; i--) {
      var name = old.attributes[i].name;
      if (!fresh.hasAttribute(name)) old.removeAttribute(name);
    }
    for (i = 0; i < fresh.attributes.length; i++) {
      var a = fresh.attributes[i];
      // A typed value is the teacher's (the search box), not the markup's.
      if (a.name === 'value' && /^(INPUT|TEXTAREA)$/.test(old.tagName)) continue;
      if (old.getAttribute(a.name) !== a.value) old.setAttribute(a.name, a.value);
    }
    if (keepHidden) old.classList.add('roster-hidden');
  }

  /** @param {Node} old @param {Node} fresh */
  function _patch(old, fresh) {
    if (old.nodeType === 3) {
      if (old.nodeValue !== fresh.nodeValue) old.nodeValue = fresh.nodeValue;
      return;
    }
    if (old.nodeType !== 1) return;
    var o = /** @type {Element} */ (old);
    _syncAttrs(o, /** @type {Element} */ (fresh));
    // The grades are filled in place by the page (fillSidebarBadges).
    if (o.classList.contains('student-row-grades')) return;
    _children(o, fresh);
  }

  /** @param {Node} parent @param {Node} fresh */
  function _children(parent, fresh) {
    var olds = Array.prototype.slice.call(parent.childNodes);
    /** @type {Record<string, Node>} */
    var byKey = {};
    /** @type {Node[]} */
    var loose = [];
    olds.forEach(function (n) {
      var k = _key(n);
      if (k) byKey[k] = n;
      else if (!_isPageOwned(n)) loose.push(n);
    });
    /** @type {Node[]} */
    var used = [];
    var pos = 0;
    Array.prototype.slice.call(fresh.childNodes).forEach(function (f) {
      var k = _key(f);
      /** @type {Node | null} */
      var m = null;
      if (k) {
        m = byKey[k] || null;
        if (m) delete byKey[k];
      } else {
        for (var i = 0; i < loose.length; i++) {
          if (loose[i].nodeType === f.nodeType && loose[i].nodeName === f.nodeName) {
            m = loose.splice(i, 1)[0];
            break;
          }
        }
      }
      /** @type {Node} */
      var put = f;
      if (m && m.nodeName === f.nodeName) {
        _patch(m, f);
        put = m;
      }
      used.push(put);
      var at = parent.childNodes[pos];
      if (at !== put) parent.insertBefore(put, at || null);
      pos++;
    });
    olds.forEach(function (n) {
      if (used.indexOf(n) < 0 && !_isPageOwned(n) && n.parentNode === parent) parent.removeChild(n);
    });
  }

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
    _children(mount, t.content);
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
