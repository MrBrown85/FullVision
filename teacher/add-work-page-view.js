// @ts-check
/* ── add-work-page-view.js — a page full size (B5) ───────────────────────
   Split the Scan (Space on a piece, or See Full Size on a page) and the
   Waiting tray (the file's picture, or Space in Choose a Student) show a
   page full size here, over everything, until Space, Escape or Close.
   Left and right go through the pages it was given. The pictures are the
   pages already read on this computer; nothing is sent anywhere.

   AddWorkPageView.open({ pages: [{ blob, label }], at, title, onClose })
   AddWorkPageView.close()
   AddWorkPageView.isOpen() */
/** @type {any} */ (window).AddWorkPageView = (function () {
  'use strict';

  /** @type {any} */
  var _v = null;

  var PREV_ICON =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"></path></svg>';
  var NEXT_ICON =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"></path></svg>';

  function _url(blob) {
    try {
      return blob && URL.createObjectURL ? URL.createObjectURL(blob) : '';
    } catch (e) {
      return '';
    }
  }

  // html-safe: the title and labels go through esc; urls are ours (esc too); icons are fixed
  function _html(v) {
    var page = v.pages[v.at] || {};
    var many = v.pages.length > 1;
    var where = (page.label || '') + (many ? ' · ' + (v.at + 1) + ' of ' + v.pages.length : '');
    return (
      '<div class="awv-box" role="dialog" aria-modal="true" aria-label="' +
      esc((v.title ? v.title + ', ' : '') + where) +
      '">' +
      '<div class="awv-bar"><span class="awv-title">' +
      esc(v.title || '') +
      '</span><span class="awv-where" role="status">' +
      esc(where) +
      '</span><span class="awv-gap"></span>' +
      (many
        ? '<button type="button" class="awv-btn" data-awv="prev" aria-label="Previous page"' +
          (v.at ? '' : ' disabled') +
          '>' +
          PREV_ICON +
          '</button><button type="button" class="awv-btn" data-awv="next" aria-label="Next page"' +
          (v.at < v.pages.length - 1 ? '' : ' disabled') +
          '>' +
          NEXT_ICON +
          '</button>'
        : '') +
      '<button type="button" class="awv-close" data-awv="close">Close</button></div>' +
      '<div class="awv-pic">' +
      (v.url ? '<img src="' + esc(v.url) + '" alt="' + esc(page.label || 'Page') + '">' : '') +
      '</div>' +
      '<p class="awv-hint">Space or Escape closes it. The arrows go through the pages.</p></div>'
    );
  }

  function _draw(focus) {
    var v = _v;
    if (!v) return;
    if (v.url) URL.revokeObjectURL(v.url);
    v.url = _url((v.pages[v.at] || {}).blob);
    // html-safe: _html escapes every word; the rest is fixed markup
    v.el.innerHTML = _html(v);
    var el = /** @type {any} */ (v.el.querySelector(focus ? '[data-awv="' + focus + '"]' : '.awv-close'));
    if (!el || el.disabled) el = v.el.querySelector('.awv-close');
    if (el) el.focus();
  }

  function _go(d) {
    var v = _v;
    if (!v) return;
    var to = Math.max(0, Math.min(v.pages.length - 1, v.at + d));
    if (to === v.at) return;
    v.at = to;
    _draw(d < 0 ? 'prev' : 'next');
  }

  // First, before any page's own keys (window, capturing): this view's keys are its own.
  function _key(e) {
    var v = _v;
    if (!v || document.querySelector('.confirm-overlay')) return;
    var k = e.key;
    if (k === 'Escape' || k === ' ' || k === 'ArrowLeft' || k === 'ArrowRight' || k === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
    }
    if (k === 'Escape' || k === ' ') return close();
    if (k === 'ArrowLeft' || k === 'ArrowRight') return _go(k === 'ArrowLeft' ? -1 : 1);
    if (k === 'Tab') {
      // Focus stays in the view.
      var btns = Array.prototype.slice.call(v.el.querySelectorAll('button:not(:disabled)'));
      var i = btns.indexOf(document.activeElement);
      var next = btns[(i + (e.shiftKey ? btns.length - 1 : 1)) % btns.length];
      if (next) next.focus();
    }
  }

  function _click(e) {
    var btn = e.target && e.target.closest ? e.target.closest('[data-awv]') : null;
    if (!btn) {
      if (e.target === _v.el) close();
      return;
    }
    var what = btn.getAttribute('data-awv');
    if (what === 'close') return close();
    _go(what === 'prev' ? -1 : 1);
  }

  function open(opts) {
    close(true);
    opts = opts || {};
    var pages = (opts.pages || []).filter(function (p) {
      return p && p.blob;
    });
    if (!pages.length) return false;
    var el = document.createElement('div');
    el.className = 'awv-overlay';
    document.body.appendChild(el);
    _v = {
      el: el,
      pages: pages,
      at: Math.max(0, Math.min(pages.length - 1, Number(opts.at) || 0)),
      title: String(opts.title || ''),
      url: '',
      onClose: typeof opts.onClose === 'function' ? opts.onClose : null,
    };
    el.addEventListener('click', _click);
    window.addEventListener('keydown', _key, true);
    _draw();
    return true;
  }

  function close(quiet) {
    var v = _v;
    if (!v) return;
    _v = null;
    window.removeEventListener('keydown', _key, true);
    if (v.url) URL.revokeObjectURL(v.url);
    v.el.remove();
    if (!quiet && v.onClose) v.onClose();
  }

  return {
    open: open,
    close: function () {
      close();
    },
    isOpen: function () {
      return !!_v;
    },
  };
})();
