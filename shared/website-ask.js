// @ts-check
/* shared/website-ask.js — "Open this website in a new tab?"

   One question, asked before any web address leaves FullVision for a new
   tab: a link inside a handout (shared/handout-viewer.js) and a link on a
   bulletin (s/bulletins.js; docs/plans/bulletins-plan.md, B1d). Nothing
   opens until the student presses Open Website, here in FullVision's own
   page, with the address in front of them; then it opens in a new tab with
   no way back to this page and no referrer.

     WebsiteAsk.open({ host, url, cls, backdrop, cancelFirst, focus, place, returnTo, onClose })
       host      where the question is drawn (the handout's layer, document.body)
       url       the address; nothing is asked unless it is http or https
       cls       the class its parts are named from: cls, cls-words, cls-url,
                 cls-go, cls-no (and cls-back, cls-buttons, cls-top, cls-bottom)
       backdrop  a dimmed layer under it that a tap closes (Cancel)
       cancelFirst  Cancel drawn before Open Website
       focus     'go' (the default) or 'no': which button has the keyboard
       place     'top' or 'bottom': which half of the screen it sits in, so
                 its buttons are never where the tap that opened it was
       returnTo  where the keyboard goes back to when it closes
     Returns the question's element, or null when the address was not one.
   One question at a time: asking again replaces it. Nothing is sent. */
/** @type {any} */ (window).WebsiteAsk = (function () {
  'use strict';

  /** @type {{ box: HTMLElement, back: HTMLElement | null, close: () => void } | null} */
  var openNow = null;

  /** @returns {any} */
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  /** The address, when it is a web address: a URL, or null. @param {unknown} url */
  function webAddress(url) {
    var u;
    try {
      u = new URL(String(url || ''));
    } catch (e) {
      return null;
    }
    return u.protocol === 'http:' || u.protocol === 'https:' ? u : null;
  }

  function close() {
    if (openNow) openNow.close();
  }

  /** @param {any} opts */
  function open(opts) {
    var o = opts || {};
    var u = webAddress(o.url);
    var host = o.host || (typeof document !== 'undefined' ? document.body : null);
    if (!u || !host) return null;
    close();
    var cls = String(o.cls || 'fv-ask');
    var box = el(
      'div',
      cls + (o.place === 'top' ? ' ' + cls + '-top' : o.place === 'bottom' ? ' ' + cls + '-bottom' : ''),
    );
    box.setAttribute('role', 'alertdialog');
    box.setAttribute('aria-label', 'Open a Website');
    var line = el('p', cls + '-words', 'Open this website in a new tab?');
    var where = el('p', cls + '-url', u.href.length > 300 ? u.href.slice(0, 300) + '…' : u.href);
    var go = el('button', cls + '-go', 'Open Website');
    var no = el('button', cls + '-no', 'Cancel');
    go.type = no.type = 'button';
    var back = o.backdrop ? el('button', cls + '-back') : null;
    if (back) {
      back.type = 'button';
      back.tabIndex = -1;
      back.setAttribute('aria-label', 'Cancel');
    }
    var me = {
      box: box,
      back: back,
      close: function () {
        if (box.parentNode) box.parentNode.removeChild(box);
        if (back && back.parentNode) back.parentNode.removeChild(back);
        if (typeof document !== 'undefined') document.removeEventListener('keydown', onKey, true);
        if (openNow === me) openNow = null;
        var to = o.returnTo;
        if (to && to.isConnected && typeof to.focus === 'function') to.focus({ preventScroll: true });
        if (typeof o.onClose === 'function') o.onClose();
      },
    };
    // Escape is Cancel; Tab goes between the two buttons. Only for a question with a backdrop (over the page).
    /** @param {KeyboardEvent} e */
    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        me.close();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        (document.activeElement === go ? no : go).focus();
      }
    }
    go.addEventListener('click', function () {
      me.close();
      window.open(u.href, '_blank', 'noopener,noreferrer');
    });
    no.addEventListener('click', me.close);
    if (back) back.addEventListener('click', me.close);
    box.appendChild(line);
    box.appendChild(where);
    var buttons = o.cancelFirst ? [no, go] : [go, no];
    if (o.backdrop) {
      var row = el('div', cls + '-buttons');
      buttons.forEach(function (b) {
        row.appendChild(b);
      });
      box.appendChild(row);
    } else {
      buttons.forEach(function (b) {
        box.appendChild(b);
      });
    }
    if (back) host.appendChild(back);
    host.appendChild(box);
    if (o.backdrop) document.addEventListener('keydown', onKey, true);
    openNow = me;
    (o.focus === 'no' ? no : go).focus();
    return box;
  }

  return { open: open, close: close, webAddress: webAddress };
})();
