/* gb-supabase.js — Supabase authentication layer for FullVision */

(function() {
  'use strict';

  const SUPABASE_URL = (window.__ENV && window.__ENV.SUPABASE_URL) || '';
  const SUPABASE_KEY = (window.__ENV && window.__ENV.SUPABASE_KEY) || '';

  // Wait for Supabase CDN to be available, then initialize
  function _initClient() {
    if (window._supabase) return window._supabase;
    if (typeof supabase === 'undefined' || !supabase.createClient) {
      console.error('Supabase CDN not loaded. Ensure the CDN script tag appears before gb-supabase.js.');
      return null;
    }
    window._supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    return window._supabase;
  }

  // Initialize immediately (CDN script should already be loaded synchronously)
  _initClient();

  /* ── Public API ──────────────────────────────────────────────── */

  /**
   * Returns the initialized Supabase client.
   * @returns {object|null} The Supabase client instance, or null if the CDN is unavailable
   */
  window.getSupabase = function() {
    return window._supabase || _initClient();
  };

  /**
   * Returns the currently logged-in user, or null.
   * @returns {Promise<object|null>} The Supabase user object, or null if not authenticated
   */
  window.getCurrentUser = async function() {
    const sb = getSupabase();
    if (!sb) return null;
    const { data: { user } } = await sb.auth.getUser();
    return user;
  };

  /**
   * Returns true if a user is logged in.
   * @returns {Promise<boolean>} Whether a user is currently authenticated
   */
  window.isLoggedIn = async function() {
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
  window.signUp = async function(email, password, displayName) {
    const sb = getSupabase();
    if (!sb) throw new Error('Supabase not initialized');
    const { data, error } = await sb.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: displayName }
      }
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
  window.signIn = async function(email, password) {
    const sb = getSupabase();
    if (!sb) throw new Error('Supabase not initialized');
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  };

  /**
   * Signs out the current user, clears application localStorage data, and redirects to login.
   * @returns {Promise<void>}
   */
  window.signOut = async function() {
    const sb = getSupabase();
    if (!sb) return;
    // Wait for any pending data syncs to finish before clearing local data
    if (typeof waitForPendingSyncs === 'function') {
      await waitForPendingSyncs(5000);
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
      if (key && (key.startsWith('gb-') || key.startsWith('sb-'))) keysToRemove.push(key);
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
    window.location.href = 'login.html';
  };

  /**
   * Listens for auth state changes and invokes the callback with the current user.
   * @param {function(object|null, string): void} callback - Called with (user, event) on each auth state change
   * @returns {object|undefined} The Supabase auth subscription object, or undefined if client unavailable
   */
  window.onAuthChange = function(callback) {
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
  window.requireAuth = async function() {
    // Auth check
    const sb = getSupabase();
    if (!sb) { window.location.href = 'login.html'; return new Promise(function() {}); }

    // Fast path: check localStorage for cached session (Supabase stores this automatically)
    const storageKey = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'));
    if (storageKey) {
      try {
        const stored = JSON.parse(localStorage.getItem(storageKey));
        if (stored && stored.access_token && stored.expires_at) {
          // Check if token is expired
          const expiresAt = stored.expires_at * 1000; // convert to ms
          if (Date.now() < expiresAt) {
            return; // Session exists and is not expired — allow page to load
          }
        }
      } catch(e) {
        console.warn('Session token parse failed:', e);
      }
    }

    // Slow path: no cached session found, check with Supabase
    try {
      const { data: { session } } = await sb.auth.getSession();
      if (!session) { window.location.href = 'login.html'; return new Promise(function() {}); }
    } catch(e) {
      console.warn('Session check failed:', e);
      window.location.href = 'login.html';
      return new Promise(function() {}); // Never resolve — page is redirecting
    }
  };

  // Listen for auth state changes — notify on mid-session expiry
  window.onAuthChange(function(user, event) {
    if (event === 'TOKEN_REFRESHED' && !user) {
      // Session expired while the app was open
      if (typeof showSyncToast === 'function') {
        var el = document.getElementById('sync-toast');
        if (el) el.remove();
        var toast = document.createElement('div');
        toast.className = 'sync-toast error';
        toast.id = 'sync-toast';
        toast.setAttribute('role', 'alert');
        toast.innerHTML = '<span>Session expired</span><button class="sync-toast-btn" data-action="go-login">Sign In</button>';
        document.body.appendChild(toast);
      }
    }
  });

  // Delegated click handler for session-expired login redirect
  document.addEventListener('click', function(e) {
    var btn = e.target.closest('[data-action="go-login"]');
    if (btn) {
      window.location.href = 'login.html';
    }
  });

})();

// Idle timeout: sign out after 30 minutes of inactivity on shared computers
(function() {
  var _idleTimer = null;
  var IDLE_TIMEOUT = 30 * 60 * 1000; // 30 minutes
  function resetIdleTimer() {
    if (_idleTimer) clearTimeout(_idleTimer);
    _idleTimer = setTimeout(function() {
      if (typeof signOut === 'function') signOut();
    }, IDLE_TIMEOUT);
  }
  ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'].forEach(function(evt) {
    document.addEventListener(evt, resetIdleTimer, { passive: true });
  });
  resetIdleTimer();
})();
