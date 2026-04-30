/* shared/supabase.js — Supabase authentication layer for FullVision
 *
 * PORTAL CONVENTION
 * Each interface HTML file sets window.__PORTAL before loading this script:
 *
 *   teacher/app.html        → window.__PORTAL = 'teacher'         (default, can omit)
 *   teacher-mobile/index.html → window.__PORTAL = 'teacher-mobile'
 *   student/index.html      → window.__PORTAL = 'student'
 *   parent/index.html       → window.__PORTAL = 'parent'
 *
 * This script does NOT redirect to portal-specific URLs — all unauthenticated
 * users are sent to /login.html. The login page reads user.user_metadata.portal
 * after sign-in and routes each user to their correct interface.
 */

(function () {
  'use strict';

  // Dev mode: bypass all Supabase on localhost when credentials are missing
  const _hasSupabaseConfig = !!(
    window.__ENV &&
    window.__ENV.SUPABASE_URL &&
    !window.__ENV.SUPABASE_URL.startsWith('__')
  );
  const _isDevMode = location.hostname === 'localhost' && !_hasSupabaseConfig;

  const SUPABASE_URL = (window.__ENV && window.__ENV.SUPABASE_URL) || '';
  const SUPABASE_KEY = (window.__ENV && window.__ENV.SUPABASE_KEY) || '';

  // Wait for Supabase CDN to be available, then initialize
  function _initClient() {
    if (_isDevMode) return null;
    if (window._supabase) return window._supabase;
    if (typeof supabase === 'undefined' || !supabase.createClient) {
      console.error('Supabase CDN not loaded. Ensure the CDN script tag appears before gb-supabase.js.');
      return null;
    }
    if (!SUPABASE_URL || !SUPABASE_KEY || SUPABASE_URL.startsWith('__')) {
      console.error('Supabase credentials missing. Check environment variables.');
      return null;
    }
    window._supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    return window._supabase;
  }

  // Initialize immediately (CDN script should already be loaded synchronously)
  _initClient();

  // Cache the one server auth-check per page load so subsequent requireAuth()
  // callers reuse the same promise instead of round-tripping again.
  let _authCheckPromise = null;

  /* ── Public API ──────────────────────────────────────────────── */

  /**
   * Returns the initialized Supabase client.
   * @returns {object|null} The Supabase client instance, or null if the CDN is unavailable
   */
  window.getSupabase = function () {
    return window._supabase || _initClient();
  };

  /**
   * Returns the currently logged-in user, or null.
   * @returns {Promise<object|null>} The Supabase user object, or null if not authenticated
   */
  window.getCurrentUser = async function () {
    const sb = getSupabase();
    if (!sb) return null;
    const {
      data: { user },
    } = await sb.auth.getUser();
    return user;
  };

  /**
   * Returns true if a user is logged in.
   * @returns {Promise<boolean>} Whether a user is currently authenticated
   */
  window.isLoggedIn = async function () {
    const user = await getCurrentUser();
    return !!user;
  };

  /**
   * Creates a new account with Supabase auth.
   * @param {string} email - The user's email address
   * @param {string} password - The user's chosen password
   * @param {string} displayName - The user's display name stored in user metadata
   * @returns {Promise<object>} The Supabase sign-up data (user and session)
   */
  window.signUp = async function (email, password, displayName) {
    const sb = getSupabase();
    if (!sb) throw new Error('Supabase not initialized');
    const { data, error } = await sb.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: displayName },
      },
    });
    if (error) throw error;
    return data;
  };

  /**
   * Signs in with email and password.
   * @param {string} email - The user's email address
   * @param {string} password - The user's password
   * @returns {Promise<object>} The Supabase sign-in data (user and session)
   */
  window.signIn = async function (email, password) {
    const sb = getSupabase();
    if (!sb) throw new Error('Supabase not initialized');
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  };

  /**
   * Re-checks the current account password before a sensitive action.
   * Uses the signed-in user's email as the identity source of truth.
   * @param {string} password - The current account password
   * @returns {Promise<object>} The refreshed Supabase sign-in payload
   */
  window.reauthenticateWithPassword = async function (password) {
    const sb = getSupabase();
    if (!sb) throw new Error('Supabase not initialized');
    const user = await getCurrentUser();
    const email = (user && user.email) || '';
    if (!email) throw new Error('Could not verify the current account email.');
    if (!password) throw new Error('Enter your password to continue.');
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  };

  window.refreshSupabaseSession = async function () {
    const sb = getSupabase();
    if (!sb) throw new Error('Supabase not initialized');
    const { data, error } = await sb.auth.refreshSession();
    if (error) throw error;
    if (!data || !data.session) throw new Error('No refreshed session returned.');
    return data;
  };

  window.showSessionExpiredToast = function () {
    var el = document.getElementById('sync-toast');
    if (el) el.remove();
    var toast = document.createElement('div');
    toast.className = 'sync-toast error';
    toast.id = 'sync-toast';
    toast.setAttribute('role', 'alert');
    toast.innerHTML =
      '<span>Session expired</span><button class="sync-toast-btn" data-action="go-login">Sign In</button>';
    document.body.appendChild(toast);
  };

  /**
   * Signs out the current user, clears application localStorage data, and redirects to login.
   * @returns {Promise<void>}
   */
  window.signOut = async function () {
    const sb = getSupabase();
    if (!sb) return;
    // Wait for any pending data syncs to finish before clearing local data
    if (typeof waitForPendingSyncs === 'function') {
      await waitForPendingSyncs();
    }
    try {
      const { error } = await sb.auth.signOut();
      if (error) console.warn('Sign-out error (proceeding anyway):', error.message);
    } catch (err) {
      console.warn('Sign-out exception (proceeding anyway):', err);
    }
    // Clear all application + auth data from localStorage (FOIPPA: no data left on shared computers)
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      // gb- and gb_ prefixes (data layer uses dashes, some UI prefs use underscores)
      // sb- prefix (Supabase auth tokens)
      // td- prefix (cross-portal prefs like td-mobile-pref)
      if (key && (key.startsWith('gb-') || key.startsWith('gb_') || key.startsWith('sb-') || key.startsWith('td-')))
        keysToRemove.push(key);
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
    // Clear session storage and cookies
    sessionStorage.clear();
    document.cookie.split(';').forEach(c => {
      document.cookie = c.trim().split('=')[0] + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/';
    });
    // Clear service worker caches
    if ('caches' in window) {
      caches.keys().then(names => names.forEach(name => caches.delete(name)));
    }
    // All portals share the same login page — it routes to the right interface after sign-in
    window.location.href = '/login.html';
  };

  /**
   * Listens for auth state changes and invokes the callback with the current user.
   * @param {function(object|null, string): void} callback - Called with (user, event) on each auth state change
   * @returns {object|undefined} The Supabase auth subscription object, or undefined if client unavailable
   */
  window.onAuthChange = function (callback) {
    const sb = getSupabase();
    if (!sb) return;
    try {
      return sb.auth.onAuthStateChange((_event, session) => {
        callback(session?.user || null, _event);
      });
    } catch (err) {
      console.error('Failed to subscribe to auth changes:', err);
    }
  };

  /**
   * Redirects to login.html if the user is not logged in.
   * @returns {void}
   */
  /* Demo mode requires BOTH the gb-demo-mode flag AND a companion token set
   * by login-auth.js when the user enters through a legitimate path (Try
   * Demo button or ?demo=1 URL). A DevTools-capable user on a shared
   * computer who sets only gb-demo-mode='1' after sign-out does NOT get
   * demo access — they are redirected to the login page. signOut() wipes
   * every gb-* key, so both flags die together on sign-out. The token is
   * not a secret; it's an intent signal that raises the bar from "one
   * flag" to "must have gone through the flow that generates the token." */
  window.isDemoMode = function () {
    if (localStorage.getItem('gb-demo-mode') !== '1') return false;
    var token = localStorage.getItem('gb-demo-mode-token');
    return !!token && token.length >= 16;
  };

  window.requireAuth = async function () {
    // Demo mode: bypass auth, stub the user, run local-only with seeded data.
    // Set by the "Try Demo Mode" button on the login page.
    if (window.isDemoMode()) {
      window.getCurrentUser = async () => ({
        id: 'demo-user',
        email: 'demo@fullvision.local',
        user_metadata: { display_name: 'Demo Teacher' },
      });
      window.isLoggedIn = async () => true;
      return;
    }
    // Defence-in-depth: a stale gb-demo-mode=1 without the companion token
    // (previously legitimate demo, then manually-fiddled state, or a partial
    // localStorage copy-paste between browsers) must not be treated as active
    // demo. Clear the orphan so downstream read paths in shared/data.js that
    // still check the single flag directly don't see a false positive.
    if (localStorage.getItem('gb-demo-mode') === '1') {
      localStorage.removeItem('gb-demo-mode');
    }
    // Dev mode: bypass auth on localhost when credentials are missing
    if (_isDevMode) {
      window.getCurrentUser = async () => ({
        id: 'dev-user',
        email: 'dev@localhost',
        user_metadata: { display_name: 'Dev Teacher' },
      });
      window.isLoggedIn = async () => true;
      return;
    }
    // Auth check
    const sb = getSupabase();
    if (!sb) {
      window.location.href = '/login.html';
      return new Promise(function () {});
    }

    // Always call sb.auth.getUser() — it round-trips to the Supabase Auth
    // server, so a user who edits the cached expires_at in localStorage
    // cannot fake a live session. getSession() (the old fast path) reads
    // straight from storage and is editable; getUser() re-validates the
    // JWT signature server-side.
    if (!_authCheckPromise) {
      _authCheckPromise = (async function () {
        try {
          const { data, error } = await sb.auth.getUser();
          if (error || !data || !data.user) {
            window.location.href = '/login.html';
            return new Promise(function () {});
          }
        } catch (e) {
          console.warn('Session check failed:', e);
          window.location.href = '/login.html';
          return new Promise(function () {});
        }
      })();
    }
    return _authCheckPromise;
  };

  // Listen for auth state changes — notify on mid-session expiry
  window.onAuthChange(function (user, event) {
    if (event === 'TOKEN_REFRESHED' && !user) {
      if (typeof isLongFormAuthContextActive === 'function' && isLongFormAuthContextActive()) {
        if (typeof markLongFormSessionExpired === 'function') markLongFormSessionExpired();
      } else if (typeof showSessionExpiredToast === 'function') {
        // Session expired while the app was open
        showSessionExpiredToast();
      }
    }
  });

  // Delegated click handler for session-expired login redirect
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-action="go-login"]');
    if (btn) {
      window.location.href = '/login.html';
    }
  });
})();

// Idle timeout: sign out after 30 minutes of inactivity on shared computers
// Skip on login page — signOut() there causes pointless reload
(function () {
  if (window.location.pathname.indexOf('login') !== -1) return;
  var _idleTimer = null;
  var IDLE_TIMEOUT = 30 * 60 * 1000; // 30 minutes
  function resetIdleTimer() {
    if (_idleTimer) clearTimeout(_idleTimer);
    _idleTimer = setTimeout(function () {
      if (typeof isLongFormAuthContextActive === 'function' && isLongFormAuthContextActive()) {
        if (typeof markLongFormSessionExpired === 'function') markLongFormSessionExpired();
        return;
      }
      if (typeof signOut === 'function') signOut();
    }, IDLE_TIMEOUT);
  }
  ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'].forEach(function (evt) {
    document.addEventListener(evt, resetIdleTimer, { passive: true });
  });
  resetIdleTimer();
})();
