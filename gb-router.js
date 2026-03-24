/* ── gb-router.js — Hash-based SPA router ─────────────────── */
window.Router = (function() {
  'use strict';

  /* ── Lazy-loaded page module definitions ───────────────────
     Scripts are loaded on first navigation to a route.
     Sub-modules load before their parent page module. */
  var _routes = {
    '/dashboard':    { scripts: ['dash-overview.js', 'dash-class-manager.js', 'dash-curriculum-wizard.js', 'page-dashboard.js'], globalName: 'PageDashboard' },
    '/assignments':  { scripts: ['assign-form.js', 'assign-scoring.js', 'assign-rubric-editor.js', 'page-assignments.js'], globalName: 'PageAssignments' },
    '/student':      { scripts: ['page-student.js'], globalName: 'PageStudent' },
    '/gradebook':    { scripts: ['page-gradebook.js'], globalName: 'PageGradebook' },
    '/observations': { scripts: ['page-observations.js'], globalName: 'PageObservations' },
    '/reports':      { scripts: ['report-blocks.js', 'report-builder.js', 'report-narrative.js', 'page-reports.js'], globalName: 'PageReports' }
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
  var _loadedScripts = {};  // Track which scripts have been loaded

  /* ── Load a single script, returning a promise ────────────── */
  function _loadScript(src) {
    if (_loadedScripts[src]) return _loadedScripts[src];
    _loadedScripts[src] = new Promise(function(resolve, reject) {
      var script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = function() { reject(new Error('Failed to load ' + src)); };
      document.head.appendChild(script);
    });
    return _loadedScripts[src];
  }

  /* ── Load scripts sequentially (order matters for deps) ──── */
  async function _loadScripts(srcs) {
    for (var i = 0; i < srcs.length; i++) {
      await _loadScript(srcs[i]);
    }
  }

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
  async function _onRoute() {
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

    // Check if route exists
    var routeDef = _routes[path];
    if (!routeDef) {
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
      routeDef = _routes[path];
    }

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

    // Lazy-load page scripts if not yet loaded
    if (!window[routeDef.globalName]) {
      await _loadScripts(routeDef.scripts);
    }

    // Init new page
    var module = window[routeDef.globalName];
    _currentPage = module;
    if (module && module.init) {
      module.init(params);
    }
  }

  /* ── Boot sequence (runs ONCE) ───────────────────────────── */
  async function boot() {
    if (_booted) return;
    _booted = true;

    requireAuth();
    await initAllCourses();
    var cid = getActiveCourse();
    await initData(cid);
    // Seed demo data if no courses/students exist
    // seedIfNeeded writes directly to cache, so no need to reload from Supabase
    seedIfNeeded();
    migrateAllStudents();

    // Listen for hash changes
    window.addEventListener('hashchange', function() { _onRoute(); });

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
    parseHash: _parseHash
  };
})();

/* ── Auto-boot ─────────────────────────────────────────────── */
Router.boot();
