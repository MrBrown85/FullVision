/* Links without an href: <a data-href="/gradebook" role="link" tabindex="0">.

   A real href makes the browser print the address in a grey box at the
   bottom left whenever the pointer is over it. Teachers don't want that, so
   the app's links carry their address in data-href and this script follows
   it the way the browser would follow an href:

   - A plain click goes there, unless a page handler already took the click
     (preventDefault). A desktop app page opens through Router.navigate,
     without a reload. The check waits until every handler has run, as the
     browser's own link-follow does, so stopPropagation doesn't block it.
   - Cmd, Ctrl or Shift + click and a middle click open a new tab.
   - Enter on a focused link clicks it.

   The CSS reset for these links is :where(a[data-href]) in teacher/styles.css
   and login.css. Skip links keep their href: they are keyboard-only. */
(function () {
  'use strict';

  function linkFrom(e) {
    var t = e.target;
    return t && t.closest ? t.closest('a[data-href]') : null;
  }

  // A page of the desktop app opens in place through its router; going
  // there by location.assign would reload the whole app.
  function follow(link, newTab) {
    var url = new URL(link.getAttribute('data-href'), location.href);
    if (newTab) window.open(url.href, '_blank', 'noopener');
    else if (url.origin === location.origin && window.Router && window.Router.isRoute(url.pathname)) {
      window.Router.navigate(url.pathname + url.search);
    } else location.assign(url.href);
  }

  // Capture at the window so this runs whatever the page's handlers do;
  // the decision waits for them to finish.
  window.addEventListener(
    'click',
    function (e) {
      if (e.button !== 0) return;
      var link = linkFrom(e);
      if (!link) return;
      var newTab = e.metaKey || e.ctrlKey || e.shiftKey;
      setTimeout(function () {
        if (!e.defaultPrevented) follow(link, newTab);
      }, 0);
    },
    true,
  );

  window.addEventListener(
    'auxclick',
    function (e) {
      if (e.button !== 1) return;
      var link = linkFrom(e);
      if (!link) return;
      e.preventDefault();
      follow(link, true);
    },
    true,
  );

  window.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || e.defaultPrevented) return;
    var link = linkFrom(e);
    if (!link || link !== e.target) return;
    e.preventDefault();
    link.click();
  });
})();
