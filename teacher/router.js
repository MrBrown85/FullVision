/* ── gb-router.js — Hash-based SPA router ─────────────────── */
window.Router = (function() {
  'use strict';

  var _routes = {
    '/dashboard': window.PageDashboard,
    '/assignments': window.PageAssignments,
    '/student': window.PageStudent,
    '/gradebook': window.PageGradebook,
    '/observations': window.PageObservations,
    '/reports': window.PageReports
  };

  var _titles = {
    '/dashboard': 'Dashboard',
    '/assignments': 'Assignments',
    '/student': 'Student',
    '/gradebook': 'Gradebook',
    '/observations': 'Observations',
    '/reports': 'Reports'
  };

  /* Map old HTML filenames to hash routes for link interception */
  var _fileToHash = {
    'index.html':        '/dashboard',
    'settings.html':     '/assignments',
    'student.html':      '/student',
    'spreadsheet.html':  '/gradebook',
    'observations.html': '/observations',
    'reports.html':      '/reports'
  };

  /* Map hash routes back to old HTML files (for Phase 1 fallback) */
  var _hashToFile = {
    '/assignments':  'settings.html',
    '/student':      'student.html',
    '/gradebook':    'spreadsheet.html',
    '/observations': 'observations.html',
    '/reports':      'reports.html'
  };

  var _currentPage = null;
  var _booted = false;

  /* ── Parse hash ──────────────────────────────────────────── */
  function _parseHash(hash) {
    // e.g. "#/student?id=st1&course=sci8" → { path: '/student', params: { id:'st1', course:'sci8' } }
    if (!hash || hash === '#' || hash === '#/') {
      return { path: '/dashboard', params: {} };
    }
    var raw = hash.replace(/^#/, '');
    var qIdx = raw.indexOf('?');
    var path = qIdx >= 0 ? raw.substring(0, qIdx) : raw;
    var params = {};
    if (qIdx >= 0) {
      var qs = raw.substring(qIdx + 1);
      qs.split('&').forEach(function(pair) {
        var parts = pair.split('=');
        if (parts[0]) {
          params[decodeURIComponent(parts[0])] = decodeURIComponent(parts[1] || '');
        }
      });
    }
    return { path: path, params: params };
  }

  /* ── Render dock ─────────────────────────────────────────── */
  function _renderDock(activePage) {
    var mount = document.getElementById('dock-mount');
    if (!mount) return;
    mount.innerHTML = renderDock(activePage);
    if (typeof _populateDockUser === 'function') _populateDockUser();
  }

  /* ── Route handler ───────────────────────────────────────── */
  function _onRoute() {
    var parsed = _parseHash(location.hash);
    var path = parsed.path;
    var params = parsed.params;

    // Determine which dock tab is active
    var dockPage = 'dashboard';
    if (path === '/assignments') dockPage = 'assignments';
    else if (path === '/student') dockPage = 'dashboard';
    else if (path === '/gradebook') dockPage = 'spreadsheet';
    else if (path === '/observations') dockPage = 'observations';
    else if (path === '/reports') dockPage = 'reports';

    // If route has no SPA module yet, fall back to old HTML page
    if (!_routes[path]) {
      var fallbackFile = _hashToFile[path];
      if (fallbackFile) {
        // Build query string from params
        var qs = Object.keys(params).map(function(k) {
          return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
        }).join('&');
        window.location.href = fallbackFile + (qs ? '?' + qs : '');
        return;
      }
      // Unknown route — default to dashboard
      path = '/dashboard';
      dockPage = 'dashboard';
    }

    var module = _routes[path];

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

    // Update page title for browser tab, history, and screen readers
    var pageTitle = _titles[path] || 'Dashboard';
    if (path === '/student' && params.id) {
      try {
        var stu = getStudents(getActiveCourse()).find(function(s) { return s.id === params.id; });
        if (stu) pageTitle = fullName(stu);
      } catch (e) { /* use default */ }
    }
    document.title = 'FullVision \u2014 ' + pageTitle;
  }

  /* ── Boot sequence (runs ONCE) ───────────────────────────── */
  async function boot() {
    if (_booted) return;
    _booted = true;

    await requireAuth();
    await initAllCourses();
    var cid = getActiveCourse();
    await initData(cid);
    // Seed demo data if no courses/students exist — lazy-loads seed-data.js on demand
    // Must await so cache is populated before first render (was fire-and-forget → empty dashboard)
    await loadSeedIfNeeded();
    migrateAllStudents();

    // Listen for hash changes
    window.addEventListener('hashchange', _onRoute);

    // Intercept clicks on dock links to use hash navigation
    document.addEventListener('click', function(e) {
      var link = e.target.closest('#app-dock a[href]');
      if (!link) return;
      var href = link.getAttribute('href');
      if (!href || href.charAt(0) === '#') return; // already a hash link

      // Check if this href maps to a hash route
      var filename = href.split('?')[0];
      var hashRoute = _fileToHash[filename];
      if (hashRoute) {
        e.preventDefault();
        // Preserve query params
        var qIdx = href.indexOf('?');
        var qs = qIdx >= 0 ? href.substring(qIdx + 1) : '';
        navigate(hashRoute + (qs ? '?' + qs : ''));
      }
    });

    // Set default hash if none, then trigger initial route
    if (!location.hash || location.hash === '#' || location.hash === '#/') {
      navigate('/dashboard', true);
    } else {
      _onRoute();
    }
  }

  /* ── Navigate ────────────────────────────────────────────── */
  function navigate(hash, replace) {
    // Ensure hash starts with #
    var fullHash = hash.charAt(0) === '#' ? hash : '#' + hash;
    if (replace) {
      history.replaceState(null, '', fullHash);
      _onRoute();
    } else {
      // Setting location.hash fires hashchange which calls _onRoute
      location.hash = fullHash;
    }
  }

  /* ── Public API ──────────────────────────────────────────── */
  return {
    boot: boot,
    navigate: navigate,
    parseHash: _parseHash,
    getCurrentPage: function() { return _currentPage; }
  };
})();

/* ── Auto-boot ─────────────────────────────────────────────── */
Router.boot();
