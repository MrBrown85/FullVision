/* ── Portal routing ─────────────────────────────────────────────────────────
 * After a successful sign-in, route the user to their interface based on the
 * 'portal' field stored in user_metadata when the account was created.
 *
 * How portals are assigned:
 *   - Teacher accounts: user_metadata.portal = 'teacher' (or absent — defaults to teacher)
 *   - Teacher mobile:   same teacher account, device detection overrides destination
 *   - Student accounts: user_metadata.portal = 'student'  ← set by teacher/admin at invite time
 *   - Parent accounts:  user_metadata.portal = 'parent'   ← set by teacher/admin at invite time
 *
 * To add a new portal: create the directory, add its entry in the switch below,
 * and set the corresponding portal value when creating accounts.
 * ─────────────────────────────────────────────────────────────────────────── */
function getPortal(user) {
  return (user && user.user_metadata && user.user_metadata.portal) || 'teacher';
}

function portalRedirect(user) {
  var portal = getPortal(user);
  var preferMobile =
    portal === 'teacher' && window.innerWidth <= 768 && localStorage.getItem('td-mobile-pref') !== 'desktop';

  switch (portal) {
    case 'student':
      return (window.location.href = '/student/');
    case 'parent':
      return (window.location.href = '/parent/');
    case 'teacher':
    default:
      return (window.location.href = preferMobile ? '/teacher-mobile/' : '/teacher/app.html');
  }
}

/* Local HTML-entity escaper. login-auth.js does not load shared/data.js
 * (which defines the canonical esc()), so we duplicate the one-line helper
 * here rather than widen the login page's dependency set. */
/* Generate the companion token stored alongside gb-demo-mode. The token
 * itself is not secret — it lives in localStorage where any DevTools-capable
 * user can read it. What it proves is that demo mode was entered through a
 * legitimate code path (this file), not by flipping a single flag in
 * DevTools from the signed-out state. signOut() in shared/supabase.js
 * wipes every gb-* key, so both flags die together on sign-out. */
function _demoToken() {
  try {
    return crypto.randomUUID();
  } catch (e) {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  }
}

function escHtml(s) {
  return (s == null ? '' : String(s))
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDeletionDeadline(deletedAt) {
  var ts = Date.parse(deletedAt || '');
  if (!isFinite(ts)) return '30 days from now';
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(ts + 30 * 24 * 60 * 60 * 1000));
}

function showRestoreAccountPrompt(deletionDate) {
  return new Promise(function (resolve) {
    var overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'restore-account-title');
    overlay.innerHTML = `<div class="confirm-card">
      <div class="confirm-title" id="restore-account-title">Restore Account</div>
      <div class="confirm-message">Your account is scheduled for deletion on ${escHtml(deletionDate)}. Restore it now?</div>
      <div class="confirm-actions">
        <button class="confirm-cancel" id="restore-continue-btn">Continue deletion</button>
        <button class="confirm-ok primary" id="restore-confirm-btn">Restore</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);

    function close(result) {
      overlay.remove();
      resolve(result);
    }

    overlay.querySelector('#restore-confirm-btn').focus();
    overlay.querySelector('#restore-confirm-btn').onclick = function () {
      close(true);
    };
    overlay.querySelector('#restore-continue-btn').onclick = function () {
      close(false);
    };
  });
}

async function maybePromptRestoreAccount(user) {
  if (getPortal(user) !== 'teacher') return true;
  var sb = getSupabase();
  if (!sb) return true;

  var bootRes = await sb.rpc('bootstrap_teacher', {
    p_email: (user && user.email) || '',
    p_display_name: (user && user.user_metadata && user.user_metadata.display_name) || null,
  });
  if (bootRes.error) throw bootRes.error;

  var teacher = bootRes.data || {};
  if (!teacher.deleted_at) return true;

  var shouldRestore = await showRestoreAccountPrompt(formatDeletionDeadline(teacher.deleted_at));
  if (!shouldRestore) {
    try {
      await sb.auth.signOut();
    } catch (e) {
      /* best effort */
    }
    showSuccess('Account deletion left in place. Sign in again within 30 days to restore it.');
    return false;
  }

  var restoreRes = await sb.rpc('restore_teacher', {});
  if (restoreRes.error) throw restoreRes.error;
  showSuccess('Account restored. Redirecting…');
  return true;
}

/* ── Redirect if already logged in ─────────────────────────── */
(async function () {
  // Opt-in demo via URL: /login.html?demo=1 wipes local state, sets the demo
  // flag, and drops the user at the dashboard with Science 8 auto-seeded.
  // Useful for testing and for sharing a "just works" local link.
  if (new URLSearchParams(location.search).get('demo') === '1') {
    Object.keys(localStorage)
      .filter(function (k) {
        return k.indexOf('gb-') === 0;
      })
      .forEach(function (k) {
        localStorage.removeItem(k);
      });
    localStorage.setItem('gb-demo-mode', '1');
    localStorage.setItem('gb-demo-mode-token', _demoToken());
    var preferMobile = window.innerWidth <= 768 && localStorage.getItem('td-mobile-pref') !== 'desktop';
    window.location.href = preferMobile ? '/teacher-mobile/' : '/teacher/app.html';
    return;
  }
  // Dev mode: only skip login on localhost when explicitly opted in with ?dev=1
  var hasConfig = !!(window.__ENV && window.__ENV.SUPABASE_URL && !window.__ENV.SUPABASE_URL.startsWith('__'));
  var isDevOptIn = new URLSearchParams(location.search).get('dev') === '1';
  if (location.hostname === 'localhost' && !hasConfig && isDevOptIn) {
    window.location.href = '/teacher/app.html';
    return;
  }
  try {
    var sb = getSupabase();
    if (sb) {
      var result = await sb.auth.getSession();
      var session = result.data.session;
      if (session) {
        var shouldRedirect = await maybePromptRestoreAccount(session.user);
        if (!shouldRedirect) return;
        portalRedirect(session.user);
        return;
      }
    }
  } catch (e) {
    /* not logged in, stay on page */
  }
})();

/* ── Tab switching ─────────────────────────────────────────── */
function switchTab(tab) {
  var isSignIn = tab === 'signin';
  document.getElementById('tab-signin').classList.toggle('active', isSignIn);
  document.getElementById('tab-signup').classList.toggle('active', !isSignIn);
  document.getElementById('tab-signin').setAttribute('aria-selected', isSignIn);
  document.getElementById('tab-signup').setAttribute('aria-selected', !isSignIn);
  document.getElementById('form-signin').hidden = !isSignIn;
  document.getElementById('form-signup').hidden = isSignIn;
  hideMessages();
}

function hideMessages() {
  document.getElementById('auth-error').classList.remove('visible');
  document.getElementById('auth-success').classList.remove('visible');
}

function showError(msg) {
  var el = document.getElementById('auth-error');
  el.textContent = msg;
  el.classList.add('visible');
  document.getElementById('auth-success').classList.remove('visible');
}

function showSuccess(msg) {
  var el = document.getElementById('auth-success');
  el.textContent = msg;
  el.classList.add('visible');
  document.getElementById('auth-error').classList.remove('visible');
}

/* ── Sign In ───────────────────────────────────────────────── */
async function handleSignIn(e) {
  e.preventDefault();
  hideMessages();
  var btn = document.getElementById('si-submit');
  btn.disabled = true;
  btn.textContent = 'Signing in...';
  try {
    var email = document.getElementById('si-email').value.trim();
    var password = document.getElementById('si-password').value;
    var result = await signIn(email, password);
    var shouldRedirect = await maybePromptRestoreAccount(result.user);
    if (!shouldRedirect) {
      btn.disabled = false;
      btn.textContent = 'Sign In';
      return;
    }
    portalRedirect(result.user);
  } catch (err) {
    showError(err.message || 'Sign in failed. Please try again.');
    btn.disabled = false;
    btn.textContent = 'Sign In';
  }
}

/* ── Sign Up ───────────────────────────────────────────────── */
async function handleSignUp(e) {
  e.preventDefault();
  hideMessages();
  var password = document.getElementById('su-password').value;
  var confirm = document.getElementById('su-confirm').value;
  if (password !== confirm) {
    showError('Passwords do not match.');
    return;
  }
  var btn = document.getElementById('su-submit');
  btn.disabled = true;
  btn.textContent = 'Creating account...';
  try {
    var name = document.getElementById('su-name').value.trim();
    var email = document.getElementById('su-email').value.trim();
    await signUp(email, password, name);
    showSuccess('Check your email for a confirmation link.');
    btn.textContent = 'Account Created';
    setTimeout(function () {
      btn.disabled = false;
      btn.textContent = 'Create Account';
    }, 4000);
  } catch (err) {
    showError(err.message || 'Sign up failed. Please try again.');
    btn.disabled = false;
    btn.textContent = 'Create Account';
  }
}

/* ── Delegated click handler ───────────────────────────────── */
document.addEventListener('click', function (e) {
  var btn = e.target.closest('[data-action]');
  if (!btn) return;
  switch (btn.dataset.action) {
    case 'switch-tab':
      switchTab(btn.dataset.tab);
      break;
    case 'forgot-password':
      e.preventDefault();
      handleForgot();
      break;
    case 'enter-demo-mode':
      e.preventDefault();
      enterDemoMode();
      break;
  }
});

/* ── Demo mode — bypass Supabase auth, run local-only with seeded data ── */
function enterDemoMode() {
  // P7.7: confirm before wiping. Skip the prompt only when this device has no
  // existing gb-* state to lose (fresh install or already-cleared session).
  var hasExistingState = Object.keys(localStorage).some(function (k) {
    return k.indexOf('gb-') === 0 && k !== 'gb-demo-mode' && k !== 'gb-demo-mode-token';
  });
  if (hasExistingState) {
    var ok = window.confirm(
      'Demo Mode will erase the FullVision data on this device and load a sample class.\n\n' +
        'Anything not synced to your account will be lost. Continue?',
    );
    if (!ok) return;
  }
  // Wipe any existing gb-* state so seedIfNeeded gets a clean slate.
  // The seed only fires when COURSES is empty AND the wiped flag isn't set,
  // so prior real-account data would otherwise block it.
  Object.keys(localStorage)
    .filter(function (k) {
      return k.indexOf('gb-') === 0;
    })
    .forEach(function (k) {
      localStorage.removeItem(k);
    });
  // Set the demo flag the rest of the app reads to skip auth + sync.
  // Cleared on sign-out (which also wipes all gb-* keys per FOIPPA).
  // The companion token proves demo mode was entered through this code path,
  // not by flipping a single flag in DevTools on a shared computer.
  localStorage.setItem('gb-demo-mode', '1');
  localStorage.setItem('gb-demo-mode-token', _demoToken());
  // Mobile pref: respect any existing td-mobile-pref override; otherwise let
  // viewport choose desktop vs mobile entry.
  var preferMobile = window.innerWidth <= 768 && localStorage.getItem('td-mobile-pref') !== 'desktop';
  window.location.href = preferMobile ? '/teacher-mobile/' : '/teacher/app.html';
}

/* ── Forgot password ───────────────────────────────────────── */
async function handleForgot() {
  hideMessages();
  var email = document.getElementById('si-email').value.trim();
  if (!email) {
    showError('Enter your email address first, then click "Forgot password?"');
    return;
  }
  try {
    var sb = getSupabase();
    var result = await sb.auth.resetPasswordForEmail(email);
    if (result.error) throw result.error;
    showSuccess('Password reset email sent. Check your inbox.');
  } catch (err) {
    showError(err.message || 'Could not send reset email.');
  }
}

/* ── Form submit listeners ── */
document.getElementById('form-signin').addEventListener('submit', handleSignIn);
document.getElementById('form-signup').addEventListener('submit', handleSignUp);
