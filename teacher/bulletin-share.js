// @ts-check
/* Share on a reminder's ⋯ menu (Colin, Nov 18): the reminder's words, and
   its link when it has one, go to the device's share sheet (Teams, Mail,
   Messages) where there is one, and are copied where there is not; the item
   then reads Copied for a moment. Nothing is sent from FullVision. */
window.BulletinShare = (function () {
  'use strict';

  /** What is shared: the words, then the link. @param {any} b */
  function text(b) {
    var parts = [String((b && b.body) || '').trim()];
    if (b && b.link_url) parts.push((b.link_title ? b.link_title + ': ' : '') + b.link_url);
    return parts.filter(Boolean).join('\n');
  }

  /** The menu item, on a reminder with something to share. @param {any} b */
  // html-safe: the text goes through esc
  function itemHtml(b) {
    if (!b || b.kind !== 'reminder' || !text(b)) return '';
    return (
      '<button type="button" role="menuitem" class="bulletin-menu-item" data-bulletin-share="' +
      esc(text(b)) +
      '">Share</button>'
    );
  }

  function _copied(btn) {
    btn.textContent = 'Copied';
    setTimeout(function () {
      btn.textContent = 'Share';
    }, 1500);
  }

  function share(btn) {
    var t = btn.getAttribute('data-bulletin-share') || '';
    if (navigator.share) {
      navigator.share({ title: 'Reminder', text: t }).catch(function () {
        /* the teacher closed the share sheet */
      });
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText)
      navigator.clipboard.writeText(t).then(function () {
        _copied(btn);
      });
  }

  if (document.addEventListener)
    document.addEventListener(
      'click',
      function (e) {
        var t = /** @type {any} */ (e.target);
        var btn = t && t.closest && t.closest('[data-bulletin-share]');
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        share(btn);
      },
      true,
    );

  return { itemHtml: itemHtml, text: text };
})();
