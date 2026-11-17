// @ts-check
/* card-menu.js — the Assignments page's card menus: an assessment bar's ⋯
   menu, its Set Everyone To submenu, and a grid row's + (Attach Work) menu.
   Moved from teacher/page-assignments.js on 2026-11-16; PageAssignments
   uses it through CardMenu.

   A menu (.assess-menu inside .assess-menu-wrap) opens below its button,
   or above it when there's more room there, and on the side of the button
   with room, so a bar near the bottom of the window keeps its whole menu
   in sight (Colin, Nov 16: it was cut off). A menu taller than the room
   scrolls inside itself. One menu is open at a time; a click elsewhere or
   Esc closes it.

   A submenu (.assess-submenu, after its item's button in the menu) opens
   beside the menu on hover, a click, Enter or → (a click never shuts what
   the hover opened), and closes on ← or Esc or on hovering another item.
   It is placed against the window, so a menu that scrolls inside itself
   can't cut it off, and follows its item when the page scrolls. */
window.CardMenu = (function () {
  'use strict';

  var TOGGLES = '[data-action="toggleCardMenu"], [data-action="attachWorkMenu"]';
  var GAP = 6; // between a button and its menu
  var EDGE = 8; // kept clear of the window's edge

  // The window, less what sits outside the page's scroll area (the top bar).
  function _bounds(el) {
    var b = { top: 0, bottom: window.innerHeight, left: 0, right: window.innerWidth };
    var box = el.closest('.page-main');
    if (box) {
      var r = box.getBoundingClientRect();
      b.top = Math.max(b.top, r.top);
      b.bottom = Math.min(b.bottom, r.bottom);
      b.left = Math.max(b.left, r.left);
      b.right = Math.min(b.right, r.right);
    }
    return b;
  }

  function place(btn, menu) {
    menu.classList.remove('is-up', 'is-left');
    menu.style.maxHeight = '';
    var room = _bounds(btn);
    var b = btn.getBoundingClientRect();
    // Lined up with the button's right edge, or its left when that would
    // run past the page's left side (a narrow window wraps the ⋯ there).
    menu.classList.toggle('is-left', b.right - menu.offsetWidth < room.left + EDGE);
    var below = room.bottom - b.bottom - GAP - EDGE;
    var above = b.top - room.top - GAP - EDGE;
    var h = menu.offsetHeight;
    var up = h > below && above > below;
    menu.classList.toggle('is-up', up);
    var fit = up ? above : below;
    if (h > fit) menu.style.maxHeight = Math.max(fit, 120) + 'px';
  }

  function _subBtn(sub) {
    return sub.previousElementSibling;
  }
  // The button that opens a menu: its item's for a submenu, else the wrap's.
  function _opener(menu) {
    if (menu.classList.contains('assess-submenu')) return _subBtn(menu);
    return menu.parentNode.querySelector(TOGGLES);
  }

  function close(except) {
    document.querySelectorAll('.assess-menu-wrap .assess-menu').forEach(function (menu) {
      if (menu === except || menu.hidden) return;
      menu.hidden = true;
      var btn = _opener(menu);
      if (btn) btn.setAttribute('aria-expanded', 'false');
    });
  }

  // A menu's items that show (a closed card's Set Everyone To doesn't), not
  // its submenu's.
  function _buttons(menu) {
    return Array.prototype.filter.call(menu.querySelectorAll('button'), function (b) {
      return b.closest('.assess-menu') === menu && b.getClientRects().length > 0;
    });
  }
  function _focusFirst(menu) {
    var first = _buttons(menu)[0];
    if (first) first.focus({ preventScroll: true });
  }

  function toggle(btn) {
    var menu = btn.parentNode.querySelector('.assess-menu');
    if (!menu) return;
    close(menu);
    menu.hidden = !menu.hidden;
    btn.setAttribute('aria-expanded', String(!menu.hidden));
    if (!menu.hidden) {
      place(btn, menu);
      _focusFirst(menu);
    }
  }

  function _closeSubs(menu) {
    menu.querySelectorAll('.assess-submenu:not([hidden])').forEach(function (sub) {
      sub.hidden = true;
      _subBtn(sub).setAttribute('aria-expanded', 'false');
    });
  }

  // Beside the menu, on the side with room, level with its item and inside
  // the window.
  function _placeSub(btn, sub) {
    var room = _bounds(btn);
    var m = btn.closest('.assess-menu').getBoundingClientRect();
    var b = btn.getBoundingClientRect();
    var w = sub.offsetWidth;
    var h = Math.min(sub.scrollHeight, room.bottom - room.top - 2 * EDGE);
    var left = m.left - w - 4;
    if (left < room.left + EDGE) left = Math.min(m.right + 4, room.right - EDGE - w);
    var top = Math.max(room.top + EDGE, Math.min(b.top - 5, room.bottom - EDGE - h));
    sub.style.left = left + 'px';
    sub.style.top = top + 'px';
    sub.style.maxHeight = h + 'px';
  }

  // focus: move to its first item (a click or a key; not a hover).
  function openSub(btn, focus) {
    var sub = btn.nextElementSibling;
    if (!sub || !sub.classList.contains('assess-submenu')) return;
    if (sub.hidden) {
      _closeSubs(btn.closest('.assess-menu'));
      sub.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      _placeSub(btn, sub);
    }
    if (focus) _focusFirst(sub);
  }

  // ↑ ↓ move through an open menu; Esc closes it and goes back to its
  // button; → opens a submenu and ← closes it. True when it was the menu's.
  function keydown(e) {
    var menu = e.target.closest && e.target.closest('.assess-menu-wrap .assess-menu:not([hidden])');
    if (!menu) return false;
    var isSub = menu.classList.contains('assess-submenu');
    if (e.key === 'Escape' || (isSub && e.key === 'ArrowLeft')) {
      e.preventDefault();
      if (isSub) _closeSubs(menu.parentNode.closest('.assess-menu'));
      else close();
      var btn = _opener(menu);
      if (btn) btn.focus({ preventScroll: true });
      return true;
    }
    if (e.key === 'ArrowRight' && e.target.getAttribute('aria-haspopup') === 'menu') {
      e.preventDefault();
      openSub(e.target, true);
      return true;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return false;
    e.preventDefault();
    var items = _buttons(menu);
    var i = items.indexOf(e.target) + (e.key === 'ArrowDown' ? 1 : -1);
    items[(i + items.length) % items.length].focus();
    return true;
  }

  // Hover: a submenu's item opens it; any other item in its menu closes it.
  document.addEventListener('mouseover', function (e) {
    var item = e.target.closest && e.target.closest('.assess-menu-wrap .assess-menu-item');
    if (!item) return;
    var menu = item.closest('.assess-menu');
    if (item.getAttribute('aria-haspopup') === 'menu') openSub(item, false);
    else if (!menu.classList.contains('assess-submenu')) _closeSubs(menu);
  });
  // A submenu is placed against the window, so it follows its item when
  // the page scrolls or the window changes size.
  function _followSubs() {
    document.querySelectorAll('.assess-menu-wrap .assess-submenu:not([hidden])').forEach(function (sub) {
      _placeSub(_subBtn(sub), sub);
    });
  }
  document.addEventListener(
    'scroll',
    function (e) {
      var t = /** @type {Element} */ (e.target);
      if (!(t.closest && t.closest('.assess-submenu'))) _followSubs();
    },
    true,
  );
  window.addEventListener('resize', _followSubs);

  return { TOGGLES: TOGGLES, close: close, toggle: toggle, place: place, openSub: openSub, keydown: keydown };
})();
