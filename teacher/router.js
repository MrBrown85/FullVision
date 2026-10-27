/* ── gb-router.js — SPA router on real paths (/dashboard, /gradebook?course=…) ── */
window.Router = (function () {
  'use strict';

  var _routes = {
    '/dashboard': window.PageDashboard,
    '/assignments': window.PageAssignments,
    '/student': window.PageStudent,
    '/gradebook': window.PageGradebook,
    '/observations': window.PageObservations,
    '/observations/starters': window.PageStarters,
    '/reports': window.PageReports,
  };

  var _titles = {
    '/dashboard': 'Dashboard',
    '/assignments': 'Assignments',
    '/student': 'Student',
    '/gradebook': 'Gradebook',
    '/observations': 'Observations',
    '/observations/starters': 'My Sentence Starters',
    '/reports': 'Reports',
  };

  var _currentPage = null;
  var _currentUrl = null;
  var _routeSeq = 0;
  var _booted = false;

  function _isRoute(path) {
    return Object.prototype.hasOwnProperty.call(_routes, path);
  }

  function _flushPendingEdits() {
    var active = document.activeElement;
    if (!active || typeof active.blur !== 'function') return;
    var tag = active.tagName || '';
    var isEditable = active.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    if (!isEditable) return;
    try {
      active.blur();
    } catch (e) {
      /* best-effort flush */
    }
  }

  /* ── Parse URL ───────────────────────────────────────────── */
  function _parseUrl(pathname, search) {
    // e.g. ("/student", "?id=st1&course=sci8") → { path: '/student', params: { id:'st1', course:'sci8' } }
    var path = pathname || '/dashboard';
    if (path.length > 1 && path.charAt(path.length - 1) === '/') path = path.slice(0, -1);
    var params = {};
    var qs = (search || '').replace(/^\?/, '');
    if (qs) {
      qs.split('&').forEach(function (pair) {
        var parts = pair.split('=');
        if (parts[0]) {
          params[_decode(parts[0])] = _decode(parts[1] || '');
        }
      });
    }
    return { path: path, params: params };
  }

  // A broken %-code in a pasted link (%E0%A4%A) is kept as typed rather
  // than throwing, which left the app on its loading screen.
  function _decode(s) {
    try {
      return decodeURIComponent(s);
    } catch (e) {
      return s;
    }
  }

  // "#/gradebook?course=x", "/gradebook?course=x" → "/gradebook?course=x"
  function _toUrl(target) {
    var url = String(target || '').replace(/^#/, '');
    return url.charAt(0) === '/' ? url : '/' + url;
  }

  // The clean address to show instead of the one the app opened at, or null.
  // Links from before clean URLs (/teacher/app.html#/gradebook?course=x) and
  // a trailing slash (/gradebook/) both get tidied. Only "#/" hashes are
  // routes; #main (the skip link) and anything else are left alone.
  function _legacyUrl(pathname, search, hash) {
    if (hash && hash.indexOf('#/') === 0) return hash.length > 2 ? _toUrl(hash) : '/dashboard';
    if (!pathname || pathname === '/' || /\/app\.html$/.test(pathname)) return '/dashboard';
    if (pathname.length > 1 && pathname.charAt(pathname.length - 1) === '/') {
      return pathname.slice(0, -1) + (search || '');
    }
    return null;
  }

  /* ── Render dock ─────────────────────────────────────────── */
  function _renderDock(activePage) {
    var mount = document.getElementById('dock-mount');
    if (!mount) return;
    mount.innerHTML = renderDock(activePage);
    if (typeof _populateDockUser === 'function') _populateDockUser();
    if (window.UI && typeof window.UI.refreshSyncStatusUI === 'function') window.UI.refreshSyncStatusUI();
  }

  function _needsCourseLoad(cid) {
    // getActiveCourse() never returns an archived class, so one is never
    // "loaded" and would loop here.
    return (
      !!cid && typeof COURSES !== 'undefined' && !!COURSES[cid] && !isCourseArchived(cid) && cid !== getActiveCourse()
    );
  }

  /* ── Route handler ───────────────────────────────────────── */
  function _onRoute() {
    var seq = ++_routeSeq;
    var parsed = _parseUrl(location.pathname, location.search);
    var path = parsed.path;
    var params = parsed.params;

    _flushPendingEdits();

    // A link to another class (?course=X) loads that class before the page
    // renders; pages used to show whatever localStorage held for X.
    if (_needsCourseLoad(params.course)) {
      switchActiveCourse(params.course).then(function (current) {
        if (current) _onRoute();
      });
      return;
    }

    // Determine which dock tab is active
    var dockPage = 'dashboard';
    if (path === '/assignments') dockPage = 'assignments';
    else if (path === '/student') dockPage = 'dashboard';
    else if (path === '/gradebook') dockPage = 'spreadsheet';
    else if (path === '/observations' || path === '/observations/starters') dockPage = 'observations';
    else if (path === '/reports') dockPage = 'reports';

    // Unknown route — show the dashboard at its own address
    if (!_isRoute(path)) {
      path = '/dashboard';
      dockPage = 'dashboard';
      params = {};
      history.replaceState(null, '', '/dashboard');
    }

    var module = _routes[path];
    _currentUrl = location.pathname + location.search;

    // Destroy previous page
    if (_currentPage && _currentPage.destroy) {
      _currentPage.destroy();
    }

    // Clear DOM mounts
    document.getElementById('main').innerHTML = '';
    document.getElementById('page-toolbar-mount').innerHTML = '';
    document.getElementById('sidebar-mount').innerHTML = '';
    document.getElementById('sidebar-mount').style.display = '';
    document.getElementById('page-layout').classList.remove('sidebar-hidden');

    // Re-render dock on every route change
    _renderDock(dockPage);

    // Init new page
    _currentPage = module;
    if (module && module.init) {
      module.init(params);
    }
    // The page sent the teacher on from its init (an old link's redirect);
    // that route has drawn and titled the page already.
    if (seq !== _routeSeq) return;

    // Update page title for browser tab, history, and screen readers
    var pageTitle = _titles[path] || 'Dashboard';
    if (path === '/student' && params.id) {
      try {
        var stu = getStudents(getActiveCourse()).find(function (s) {
          return s.id === params.id;
        });
        if (stu) pageTitle = fullName(stu);
      } catch (e) {
        /* use default */
      }
    }
    document.title = 'FullVision \u2014 ' + pageTitle;
  }

  /* ── Boot sequence (runs ONCE) ───────────────────────────── */
  async function boot() {
    if (_booted) return;
    _booted = true;

    var legacy = _legacyUrl(location.pathname, location.search, location.hash);
    if (legacy) history.replaceState(null, '', legacy);

    await requireAuth();
    await initAllCourses();
    // Open the class a deep link names, not the last one used.
    var linked = _parseUrl(location.pathname, location.search).params.course;
    if (_needsCourseLoad(linked)) setActiveCourse(linked);
    var cid = getActiveCourse();
    var loadStarted = performance.now();
    await initData(cid);
    recordLoadTiming('class.boot', cid, performance.now() - loadStarted);
    // Seed demo data if no courses/students exist — lazy-loads seed-data.js on demand
    await loadSeedIfNeeded();
    migrateAllStudents();

    // Back and forward. A fragment-only change (the skip link's #main) also
    // fires popstate; the page itself hasn't changed, so leave it be.
    window.addEventListener('popstate', function () {
      if (location.pathname + location.search !== _currentUrl) _onRoute();
    });
    // An old "#/…" link clicked inside the app
    window.addEventListener('hashchange', function () {
      if (location.hash.indexOf('#/') === 0) navigate(location.hash, true);
    });

    // Plain <a href="/student?…"> links to app pages switch pages in place
    // instead of reloading the app. data-href links go through link-nav.js.
    // In-page links (#main, the skip link) are the browser's to follow.
    document.addEventListener('click', function (e) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var link = e.target.closest && e.target.closest('a[href]');
      if (!link || (link.target && link.target !== '_self') || link.hasAttribute('download')) return;
      if (link.getAttribute('href').charAt(0) === '#') return;
      var url = new URL(link.getAttribute('href'), location.href);
      if (url.origin !== location.origin || !_isRoute(_parseUrl(url.pathname).path)) return;
      e.preventDefault();
      navigate(url.pathname + url.search);
    });

    _onRoute();
    _hideLoading();
    // Then the teacher's other classes, in the background once the first
    // page is up, so each is ready before it is opened.
    _whenIdle(function () {
      if (typeof preloadClasses === 'function') preloadClasses();
    });
  }

  // The loading screen fades out over the page that is now drawn.
  function _hideLoading() {
    var el = document.getElementById('app-loading');
    if (!el || !el.classList) return;
    el.classList.add('is-done');
    setTimeout(function () {
      if (typeof el.remove === 'function') el.remove();
    }, 200);
  }

  function _whenIdle(fn) {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(fn, { timeout: 3000 });
    else setTimeout(fn, 1500);
  }

  /* ── Navigate ────────────────────────────────────────────── */
  // Accepts "/gradebook?course=x" or the older "#/gradebook?course=x".
  // Going to the address already showing does nothing, unless replacing.
  function navigate(target, replace) {
    var url = _toUrl(target);
    if (!replace && url === location.pathname + location.search) return;
    if (replace) history.replaceState(null, '', url);
    else history.pushState(null, '', url);
    _onRoute();
  }

  // Change the address without re-rendering: a page recording its own state
  // (the open tab, a cleared filter) so a reload or a link reopens it.
  function setUrl(target) {
    var url = _toUrl(target);
    if (url !== location.pathname + location.search) history.replaceState(null, '', url);
    _currentUrl = url;
  }

  /* ── Public API ──────────────────────────────────────────── */
  return {
    boot: boot,
    navigate: navigate,
    setUrl: setUrl,
    isRoute: function (pathname) {
      return _isRoute(_parseUrl(pathname).path);
    },
    parseUrl: _parseUrl,
    legacyUrl: _legacyUrl,
    getCurrentPage: function () {
      return _currentPage;
    },
  };
})();

/* ── Auto-boot ─────────────────────────────────────────────── */
Router.boot();
