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
    '/reports': 'Reporting',
  };

  /* Pages whose scripts load the first time the page is opened, and
     features whose scripts load the first time a button uses them
     (withScripts), not with the app. Reports' scripts (about 740 KB) are
     used by no other page. They run in the order app.html had them, each
     once; page-reports.js comes last because it reads ReportPreview and
     ReportQuestionnaire as it loads. comment-realiser.js stays in
     app.html: comment-bank.js reads it as it loads. sw.js precaches every
     file here, so each opens offline too (e2e/loading-on-demand.spec.js). */
  var _onDemand = {
    '/reports': {
      page: 'PageReports',
      scripts: [
        '/teacher/report-sheets.js',
        '/teacher/report-issues.js',
        '/teacher/report-qn-browse-cases.js',
        '/teacher/report-qn-voice-observations.js',
        '/teacher/report-questionnaire.js',
        '/teacher/grade-report.js',
        '/teacher/report-preview.js',
        '/shared/phone-report-view.js',
        '/teacher/phone-reports.js',
        '/teacher/report-feedback.js',
        '/teacher/report-feedback-cards.js',
        '/teacher/report-one.js',
        '/teacher/report-one-panel.js',
        '/teacher/report-one-page.js',
        '/teacher/report-one-comment.js',
        '/teacher/report-one-zoom.js',
        '/teacher/report-one-head.js',
        '/teacher/report-print-paper.js',
        '/teacher/page-reports.js',
      ],
    },
    /* Assignments' page module is a tag, but its rubric forms draw with the
       rubric library and the Rubric Bank (about 80 KB), which no other page
       uses: they load before Assignments first draws. `needs` names the
       globals that say a load has run (for Reports, its page). */
    '/assignments': {
      page: 'PageAssignments',
      needs: ['RubricLibrary', 'RubricBank'],
      scripts: ['/teacher/rubric-library.js', '/teacher/rubric-bank.js'],
    },
    /* Scripts one button or dialog uses, loaded the first time it is
       pressed (withScripts), not with the app. */
    gradesPrint: { title: 'Print Grades', needs: ['GradesPrint'], scripts: ['/teacher/grades-print.js'] },
    gradingSetupCopy: {
      title: 'Copy Grading Setup',
      needs: ['GradingSetupCopy'],
      scripts: ['/teacher/grading-setup-copy.js'],
    },
    // The QR maker every print sheet of slips or cards draws with (teacher/qr-slips.js printSheet).
    qrcode: { title: 'QR Codes', needs: ['qrcode'], scripts: ['/vendor/qrcode.js'] },
  };
  var _ran = {}; // src → true once the script has run
  var _pageLoads = {}; // path or feature → the load in progress
  var _pressed = {}; // feature → the press to run once its scripts have

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
    // On a phone the tabs scroll sideways; keep the open one in view.
    var seg = typeof mount.querySelector === 'function' ? mount.querySelector('.tb-seg') : null;
    var on = seg && seg.querySelector('.tb-seg-active');
    if (on && seg.scrollWidth > seg.clientWidth) {
      seg.scrollLeft = on.offsetLeft - seg.offsetLeft - (seg.clientWidth - on.offsetWidth) / 2;
    }
    if (typeof _populateDockUser === 'function') _populateDockUser();
    if (window.UI && typeof window.UI.refreshSyncStatusUI === 'function') window.UI.refreshSyncStatusUI();
  }

  /* ── Pages loaded on demand ──────────────────────────────── */
  // Whether an entry's scripts have run: each global it needs is there.
  function _ready(spec) {
    return (spec.needs || [spec.page]).every(function (name) {
      return !!window[name];
    });
  }

  // The page module for a path, once its scripts have run.
  function _pageFor(path) {
    var spec = _onDemand[path];
    if (spec && !_ready(spec)) return null;
    if (!_routes[path] && spec) _routes[path] = window[spec.page];
    return _routes[path];
  }

  function _runScript(src) {
    return new Promise(function (resolve, reject) {
      var el = document.createElement('script');
      el.src = src;
      el.onload = function () {
        _ran[src] = true;
        resolve();
      };
      el.onerror = function () {
        if (el.parentNode) el.parentNode.removeChild(el);
        reject(new Error('Could not load ' + src));
      };
      document.head.appendChild(el);
    });
  }

  /* Fetches every script a page or feature still needs side by side
     (preload), then runs them one at a time in order, so one that fails
     stops the rest. A failed load is forgotten, so Try Again starts from
     the file that failed. */
  function _loadPage(path) {
    if (_pageLoads[path]) return _pageLoads[path];
    var spec = _onDemand[path];
    var todo = spec.scripts.filter(function (src) {
      return !_ran[src];
    });
    var hints = todo.map(function (src) {
      var link = document.createElement('link');
      link.rel = 'preload';
      link.as = 'script';
      link.href = src;
      document.head.appendChild(link);
      return link;
    });
    var load = todo
      .reduce(function (chain, src) {
        return chain.then(function () {
          return _runScript(src);
        });
      }, Promise.resolve())
      .then(function () {
        if (!_ready(spec) || (spec.page && !_pageFor(path))) throw new Error(path + ' did not load');
      });
    _pageLoads[path] = load;
    function settle() {
      hints.forEach(function (link) {
        if (link.parentNode) link.parentNode.removeChild(link);
      });
      _pageLoads[path] = null;
    }
    load.then(settle, settle);
    return load;
  }

  // While a page's scripts load: the app's loading screen, in the page.
  function _showPageLoading(title) {
    var main = document.getElementById('main');
    // html-safe: FVLoading.html is fixed markup; the label goes through esc.
    main.innerHTML = FVLoading.html('teacher', 'Opening ' + title, true);
    FVLoading.start(main, 'teacher');
  }

  // A page's scripts could not be fetched (offline before the app was
  // ever cached, or the connection dropped): say so, with Try Again.
  function _showPageLoadFailed(title) {
    var main = document.getElementById('main');
    main.innerHTML = '';
    var box = document.createElement('div');
    box.className = 'empty-state';
    box.setAttribute('role', 'alert');
    var head = document.createElement('div');
    head.className = 'empty-state-title';
    head.textContent = title + ' Could Not Open';
    var text = document.createElement('div');
    text.className = 'empty-state-text';
    text.textContent = 'FullVision could not load this page. Check your internet connection, then try again.';
    var retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'btn btn-primary';
    retry.style.marginTop = '16px';
    retry.textContent = 'Try Again';
    retry.addEventListener('click', function () {
      _onRoute();
    });
    box.appendChild(head);
    box.appendChild(text);
    box.appendChild(retry);
    main.appendChild(box);
    retry.focus();
  }

  /* A button or dialog whose scripts load the first time it is used (a
     feature in _onDemand). run() runs at once when they have run already,
     so a press works as it always did; otherwise once they have. Presses
     while they load run once, the last one, and only if its page is still
     the one showing. A file that cannot be fetched: a question that says
     so, whose Try Again presses again. */
  function withScripts(key, run) {
    var spec = _onDemand[key];
    if (!spec || _ready(spec)) return run();
    var loading = !!_pageLoads[key];
    _pressed[key] = { run: run, page: _currentPage };
    if (loading) return;
    _loadPage(key).then(
      function () {
        var press = _pressed[key];
        _pressed[key] = null;
        if (press && press.page === _currentPage) press.run();
      },
      function () {
        var press = _pressed[key];
        _pressed[key] = null;
        if (!press || press.page !== _currentPage) return;
        showConfirm(
          spec.title + ' Could Not Open',
          'FullVision could not load this. Check your internet connection, then try again.',
          'Try Again',
          'primary',
          function () {
            withScripts(key, press.run);
          },
        );
      },
    );
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

    var module = _pageFor(path);
    _currentUrl = location.pathname + location.search;

    // Destroy previous page
    if (_currentPage && _currentPage.destroy) {
      _currentPage.destroy();
    }
    _currentPage = null;

    // Clear DOM mounts
    document.getElementById('main').innerHTML = '';
    document.getElementById('page-toolbar-mount').innerHTML = '';
    document.getElementById('sidebar-mount').innerHTML = '';
    document.getElementById('sidebar-mount').style.display = '';
    document.getElementById('page-layout').classList.remove('sidebar-hidden', 'sidebar-overlay');

    // Re-render dock on every route change
    _renderDock(dockPage);

    // A page whose scripts have not loaded yet: the loading screen until
    // they have, then this route again (unless the teacher has moved on).
    if (!module && _onDemand[path]) {
      var title = _titles[path];
      document.title = 'FullVision — ' + title;
      _showPageLoading(title);
      return _loadPage(path).then(
        function () {
          if (seq === _routeSeq) _onRoute();
        },
        function () {
          if (seq === _routeSeq) _showPageLoadFailed(title);
        },
      );
    }

    // Init new page
    _currentPage = module;
    /* A page whose first draw throws must not take the app down with it:
       the dock, the address and the title are still set, and the page
       stays the current page (so the data layer's redraw reaches its
       render()). The error is not swallowed: it is thrown again a moment
       later, outside whoever navigated, so it is the uncaught error it
       always was (Sentry reports it, and every browser test that fails on
       a page error fails on it). */
    if (module && module.init) {
      try {
        module.init(params);
      } catch (e) {
        setTimeout(function () {
          throw e;
        }, 0);
      }
    }
    // The page sent the teacher on from its init (an old link's redirect);
    // that route has drawn and titled the page already.
    if (seq !== _routeSeq) return;

    // Update page title for browser tab, history, and screen readers
    var pageTitle = _titles[path] || 'Dashboard';
    // /dashboard?manage=… is Class Settings' own address.
    if (path === '/dashboard' && params.manage && params.manage !== 'starters') pageTitle = 'Class Settings';
    if (path === '/student' && params.id) {
      try {
        var stu = getStudents(getActiveCourse()).find(function (s) {
          return s.id === params.id;
        });
        if (stu) pageTitle = displayName(stu);
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

    // The scripts of a page loaded on demand that the app opens on start
    // loading now, beside sign-in and the class's data, not after them.
    var startPath = _parseUrl(location.pathname, location.search).path;
    if (_onDemand[startPath] && !_pageFor(startPath)) _loadPage(startPath).catch(function () {});

    // The sign-in re-check (getUser) is asked now and answers beside the
    // class list, not before it (docs/DECISIONS.md, "Start-up draws the
    // saved class list first"). With this teacher's list saved on this
    // device, initAllCourses returns before the re-check has answered and
    // the saved list and class are drawn, locked, with nothing sent until
    // it passes. With none saved it waits for the re-check, as before.
    var drawn = false;
    await initAllCourses({
      signInCheck: requireAuth(),
      // The server's list differs from the saved one already drawn.
      onChange: function () {
        if (drawn) _onRoute();
      },
    });
    // Open the class a deep link names, not the last one used.
    var linked = _parseUrl(location.pathname, location.search).params.course;
    if (_needsCourseLoad(linked)) setActiveCourse(linked);
    var cid = getActiveCourse();
    var loadStarted = performance.now();
    await initData(cid);
    recordLoadTiming('class.boot', cid, performance.now() - loadStarted);
    // The server's list, taken while that class loaded, no longer has it.
    if (getActiveCourse() !== cid) await initData(getActiveCourse());
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

    // A page loaded on demand keeps the loading screen up until it draws.
    var drawing = _onRoute();
    drawn = true;
    if (drawing) await drawing;
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
    withScripts: withScripts,
    // Every page's address, for the tests that walk every page.
    routes: function () {
      return Object.keys(_routes);
    },
  };
})();

/* ── Auto-boot ─────────────────────────────────────────────── */
Router.boot();
