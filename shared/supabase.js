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
    // One random id per page load, sent with every request. The database
    // records it against each change to a class, so this page can tell its
    // own changes from another device's when realtime reports them.
    window.__fvClientId = window.__fvClientId || _randomClientId();
    window._supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
      global: { headers: { 'x-fv-client': window.__fvClientId } },
    });
    return window._supabase;
  }

  function _randomClientId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
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
        emailRedirectTo: _confirmEmailRedirect(),
      },
    });
    if (error) throw error;
    return data;
  };

  /**
   * Sends the sign-up confirmation email again.
   * @param {string} email - The address the account was created with
   */
  window.resendSignUpEmail = async function (email) {
    const sb = getSupabase();
    if (!sb) throw new Error('Supabase not initialized');
    const { error } = await sb.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: _confirmEmailRedirect() },
    });
    if (error) throw error;
  };

  // The confirmation email's link signs the teacher in and opens
  // login.html?confirmed=1, which goes on into the gradebook.
  function _confirmEmailRedirect() {
    return location.origin + '/login.html?confirmed=1';
  }

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
    _leaveDemoMode();
    return data;
  };

  /**
   * Signs in with Google, or makes an account the first time. The browser
   * leaves for Google and comes back to login.html?signin=google, which goes
   * on into the app like a confirmation link. A teacher who already has an
   * email account with the same address gets that account: Supabase links a
   * verified address to the existing user.
   */
  window.signInWithGoogle = async function () {
    const sb = getSupabase();
    if (!sb) throw new Error('Supabase not initialized');
    _leaveDemoMode();
    const { error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: location.origin + '/login.html?signin=google' },
    });
    if (error) throw error;
  };

  /* A real sign-in ends Demo Mode. requireAuth() checks the demo flags before
   * the session, so flags left from Try Demo Mode kept a signed-in teacher in
   * the sample class and their own classes never loaded. enterDemoMode()
   * wipes every gb-* key before seeding, so while the flags are set all gb-*
   * data on this device is demo data and is safe to drop. */
  function _leaveDemoMode() {
    if (localStorage.getItem('gb-demo-mode') === null && localStorage.getItem('gb-demo-mode-token') === null) return;
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('gb-')) keys.push(key);
    }
    keys.forEach(k => localStorage.removeItem(k));
  }

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

  /* Add Work's photos still on this device for the signed-in teacher
     (shared/photo-queue.js), one per piece of work. Sign Out deletes them
     (_deletePhotoQueue), so they count as unsent. Never in Demo Mode, where
     the queue keeps the sample work for good. */
  function _photoQueueStats() {
    var pq = window.PhotoQueue;
    if (!pq || typeof pq.stats !== 'function') return null;
    try {
      var st = pq.stats() || {};
      return st.demo ? null : st;
    } catch (e) {
      return null;
    }
  }
  function _unsentPhotoCount() {
    var st = _photoQueueStats();
    if (!st || !(Number(st.queued || 0) > 0)) return 0;
    var pq = window.PhotoQueue;
    try {
      if (typeof pq.pages === 'function') {
        var batches = {};
        (pq.pages() || []).forEach(function (p) {
          batches[(p && (p.batch || p.id)) || ''] = true;
        });
        var n = Object.keys(batches).length;
        if (n > 0) return n;
      }
    } catch (e) {
      /* counted by page below */
    }
    return Number(st.queued || 0);
  }

  /* Changes still waiting in the offline queue (queued + failed) and photos
     still in the photo queue, for the signed-in user. Tries one upload of
     each first so a sign-out only warns about what genuinely could not be
     sent. */
  async function _unsentQueueCount() {
    var q = window.v2Queue;
    var hasQ = !!(q && typeof q.stats === 'function');
    var tries = [];
    if (navigator.onLine && hasQ && typeof q.flush === 'function' && q.stats().queued > 0) tries.push(q.flush());
    var pq = window.PhotoQueue;
    if (navigator.onLine && _unsentPhotoCount() > 0 && typeof pq.send === 'function') {
      tries.push(Promise.resolve().then(() => pq.send()));
    }
    if (tries.length) {
      await Promise.race([
        Promise.all(tries).catch(function () {}),
        new Promise(function (r) {
          setTimeout(r, 8000);
        }),
      ]);
    }
    var stats = hasQ ? q.stats() || {} : {};
    // Failed writes count too: signing out wipes them, and with them the
    // teacher's last chance to retry them.
    return Number(stats.queued || 0) + Number(stats.deadLettered || 0) + _unsentPhotoCount();
  }

  /**
   * Signs out the current user, clears application localStorage data, and redirects to login.
   *
   * Unsent changes in the offline queue would be lost by the wipe, so by
   * default the sign-out stops and resolves { unsent: n } instead; the caller
   * asks the teacher and calls again with { force: true }. It ends this
   * device's session only; other devices stay signed in.
   * @param {{force?: boolean}} [opts]
   * @returns {Promise<void|{unsent: number}>}
   */
  function _isNetworkAuthError(error) {
    if (!error) return false;
    if (error.name === 'AuthRetryableFetchError' || error.status === 0) return true;
    return /fetch|network|offline/i.test(error.message || '');
  }

  /* An auth error that says nothing about the session: the network, the
     Auth server's own trouble (5xx, 429, a reply that isn't JSON). The
     session may be fine; ask again. Any other error is the server saying
     the session is gone. */
  function _isPassingAuthError(error) {
    if (_isNetworkAuthError(error)) return true;
    if (error.name === 'AuthUnknownError') return true;
    return error.status === 429 || error.status >= 500;
  }

  /* requireAuth's waits between session checks that could not tell (another
     tab holding the auth lock, a network blip), and the most any one check
     or the whole series may take: supabase-js retries a token refresh on its
     own for up to about 25 s with no network, and the page waits on this. */
  const _AUTH_RETRY_WAITS_MS = [500, 1000, 2000];
  const _AUTH_CHECK_MS = 4000;
  const _AUTH_TOTAL_MS = 8000;
  // Resolves with the call's result, or { timedOut: true } after ms.
  function _within(promise, ms) {
    return Promise.race([
      promise,
      new Promise(function (resolve) {
        setTimeout(function () {
          resolve({ timedOut: true });
        }, ms);
      }),
    ]);
  }

  // `andSession`: the saved sign-in (sb-*) goes too.
  function _removeSavedClassData(andSession) {
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;
        if (key.startsWith('gb-') || key.startsWith('gb_') || (andSession === true && key.startsWith('sb-'))) {
          keys.push(key);
        }
      }
      keys.forEach(k => localStorage.removeItem(k));
    } catch (e) {
      console.warn('Could not clear saved class data:', e);
    }
  }

  // Resolves once the database is gone, or after 2 s if another tab still
  // has it open (the delete then finishes when that tab lets go).
  function _deleteReportCopies() {
    return new Promise(function (resolve) {
      try {
        if (typeof indexedDB === 'undefined') return resolve();
        const req = indexedDB.deleteDatabase('fv-report-issues');
        req.onsuccess = req.onerror = function () {
          resolve();
        };
        setTimeout(resolve, 2000);
      } catch (e) {
        console.warn('Could not clear printed report copies:', e);
        resolve();
      }
    });
  }

  /* The photo queue: through PhotoQueue.wipe() where the page has it (it
     also stops a send under way and tells the other tabs), else by deleting
     its database. Resolves either way, after 2 s at most. */
  function _deletePhotoQueue() {
    const q = window.PhotoQueue;
    if (q && typeof q.wipe === 'function') {
      return Promise.race([
        Promise.resolve()
          .then(() => q.wipe())
          .catch(e => console.warn('Could not clear waiting photos:', e)),
        new Promise(r => setTimeout(r, 2000)),
      ]);
    }
    return new Promise(function (resolve) {
      try {
        if (typeof indexedDB === 'undefined') return resolve();
        const req = indexedDB.deleteDatabase('fv-photo-queue');
        req.onsuccess = req.onerror = function () {
          resolve();
        };
        setTimeout(resolve, 2000);
      } catch (e) {
        console.warn('Could not clear waiting photos:', e);
        resolve();
      }
    });
  }

  /* Sign Out in one tab signs the whole device out: the other open tabs clear
     what they would save back and go to sign-in. Their wipe runs again on
     pagehide, after the pages' own pagehide saves (a delete still in its Undo
     window), so nothing those write stays. supabase-js's own SIGNED_OUT is
     not used: a failed token refresh raises it too, and that must keep the
     outbox. */
  let _authChannel = null;

  /* The sign-in re-check says the session is gone (expired or revoked), or
     that it is not the user this device's saved session names (`forged`).
     Saved class data is removed, so it isn't left on a shared computer, and
     the browser goes to Sign In. Start-up may have drawn the saved class
     already (docs/DECISIONS.md, "Start-up draws the saved class list
     first"): the page is hidden at once, and whatever it saves on its way
     out is removed again. The outbox (fv-*) always stays. A forged session
     is removed as well, or Sign In would come straight back in with it.
     Never resolves: the browser is leaving. */
  function _leaveSignedOut(forged) {
    const wipe = function () {
      _removeSavedClassData(forged === true);
    };
    wipe();
    window.addEventListener('pagehide', wipe);
    try {
      document.documentElement.style.visibility = 'hidden';
    } catch (e) {
      /* no page to hide */
    }
    window.location.href = '/login.html';
    return new Promise(function () {});
  }

  function _postSignedOut() {
    try {
      if (_authChannel) _authChannel.postMessage({ type: 'signed-out' });
    } catch (e) {
      /* channel closed */
    }
  }

  function _onSignedOutElsewhere() {
    if (/\/login\.html$/.test(window.location.pathname || '')) return;
    _clearDeviceData();
    window.addEventListener('pagehide', _clearDeviceData);
    window.location.href = '/login.html';
  }

  try {
    if (typeof BroadcastChannel !== 'undefined') {
      _authChannel = new BroadcastChannel('fv-auth');
      _authChannel.onmessage = function (e) {
        if (e && e.data && e.data.type === 'signed-out') _onSignedOutElsewhere();
      };
    }
  } catch (e) {
    _authChannel = null;
  }

  function _clearDeviceData() {
    // Clear all application + auth data from localStorage (FOIPPA: no data left on shared computers)
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      // gb- and gb_ prefixes (data layer uses dashes, some UI prefs use underscores)
      // sb- prefix (Supabase auth tokens)
      // td- prefix (cross-portal prefs like td-mobile-pref)
      // fv- prefix (offline write queue + dead letters, which hold student data)
      if (!key) continue;
      if (
        key.startsWith('gb-') ||
        key.startsWith('gb_') ||
        key.startsWith('sb-') ||
        key.startsWith('td-') ||
        key.startsWith('fv-')
      )
        keysToRemove.push(key);
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
    // Clear session storage and cookies
    sessionStorage.clear();
    document.cookie.split(';').forEach(c => {
      document.cookie = c.trim().split('=')[0] + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/';
    });
  }

  window.signOut = async function (opts) {
    opts = opts || {};
    const sb = getSupabase();
    if (!sb) return;
    // A delete still in its Undo window commits now, so it is sent below
    // instead of being saved back onto the device by pagehide after the wipe.
    try {
      if (typeof dismissUndoToast === 'function') dismissUndoToast();
    } catch (e) {
      console.warn('Could not commit the pending Undo:', e);
    }
    // Give in-flight writes a moment to land. Anything still unsent after
    // that sits in the outbox, which the check below reports.
    if (typeof waitForPendingSyncs === 'function') {
      await waitForPendingSyncs(5000);
    }
    if (!opts.force) {
      const unsent = await _unsentQueueCount();
      if (unsent > 0) return { unsent: unsent };
    }
    try {
      // This device only: signing out of the laptop leaves the phone and other
      // computers signed in (Supabase's default ends every session).
      const { error } = await sb.auth.signOut({ scope: 'local' });
      if (error) console.warn('Sign-out error (proceeding anyway):', error.message);
    } catch (err) {
      console.warn('Sign-out exception (proceeding anyway):', err);
    }
    _clearDeviceData();
    // The other open tabs leave too, so they do not save the class back.
    _postSignedOut();
    // Clear service worker caches
    if ('caches' in window) {
      caches.keys().then(names => names.forEach(name => caches.delete(name)));
    }
    // Printed report copies (teacher/report-issues.js) hold every student's
    // full report and live in IndexedDB, not localStorage.
    await _deleteReportCopies();
    // Photos of student work waiting on this device (shared/photo-queue.js,
    // IndexedDB) never outlive a sign-out on a shared device.
    await _deletePhotoQueue();
    // All portals share the same login page — it routes to the right interface after sign-in.
    // opts.redirect picks its tab (Leave Demo Mode's Create an Account: /login.html#signup).
    window.location.href = opts.redirect || '/login.html';
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
    //
    // getSession() is read first all the same, for the one thing only it
    // can say: whose session the saved one claims to be. The server naming
    // anyone else is a forged session. The caller need not wait for the
    // answer: start-up draws this device's saved class while it comes
    // (shared/data.js, _holdForSignIn).
    //
    // Only a real signed-out state goes to Sign In: the server saying the
    // session is gone, or no session saved at all. A check that throws or
    // can't reach the server (another tab holding the auth lock, a network
    // blip) waits and asks again; if it still can't tell, the page stays
    // and nothing is signed out. Sync trouble shows on the sync dot. (A
    // token refresh the Auth server refuses, even with a 429 or 5xx, is a
    // sign-out supabase-js makes itself: the next check then finds no
    // session and goes to Sign In, as before.)
    if (!_authCheckPromise) {
      _authCheckPromise = (async function () {
        const waits = _AUTH_RETRY_WAITS_MS;
        const started = Date.now();
        let saved = null; // what getSession said; null when it could not tell
        try {
          const read = await _within(sb.auth.getSession(), _AUTH_CHECK_MS);
          if (!read.timedOut && read.data) saved = read;
        } catch (e) {
          /* the server's answer below decides */
        }
        const session = saved && saved.data.session;
        const expected = (session && session.user && session.user.id) || null;
        for (let attempt = 0; ; attempt++) {
          let passing = null;
          try {
            const res = await _within(sb.auth.getUser(), _AUTH_CHECK_MS);
            if (res.timedOut) throw new Error('The session check timed out');
            const { data, error } = res;
            if (!error && data && data.user) {
              if (expected && data.user.id !== expected) return _leaveSignedOut(true);
              return;
            }
            // The session is gone (expired or revoked), not just unreachable.
            if (!error || !_isPassingAuthError(error)) return _leaveSignedOut();
            passing = error;
          } catch (e) {
            passing = e;
          }
          // Offline, or out of time: asking again can't tell either.
          const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
          if (attempt >= waits.length || offline || Date.now() - started >= _AUTH_TOTAL_MS) {
            console.warn('Session check could not tell after retries:', passing);
            break;
          }
          await new Promise(function (resolve) {
            setTimeout(resolve, waits[attempt]);
          });
        }
        // Still unsure. A browser with no saved session is signed out. A
        // session that is saved but can't be refreshed right now (offline the
        // next morning: getSession returns no session with an error) stays,
        // as does a read that times out. The first read's answer stands;
        // only one that could not tell is read again.
        try {
          const res = saved || (await _within(sb.auth.getSession(), _AUTH_CHECK_MS));
          if (!res.timedOut && res.data && !res.data.session && !res.error) {
            window.location.href = '/login.html';
            return new Promise(function () {});
          }
        } catch (e) {
          /* can't read it either: stay */
        }
      })();
    }
    return _authCheckPromise;
  };

  // Listen for auth state changes — notify on mid-session expiry, and send
  // what the outbox held while signed out once there is a session again.
  window.onAuthChange(function (user, event) {
    if (user && (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED')) {
      if (window.v2Queue && typeof window.v2Queue.resume === 'function' && window.v2Queue.stats().signedOut) {
        window.v2Queue.resume();
      }
    }
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
