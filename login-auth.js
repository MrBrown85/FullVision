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
/* getPortal, startDemoMode, promptRestoreAccount and resetPasswordRedirect
 * live in shared/sign-in.js, which the phone sign-in screen uses too. */
function portalRedirect(user) {
  var portal = getPortal(user);

  switch (portal) {
    case 'student':
      return (window.location.href = '/student/');
    case 'parent':
      return (window.location.href = '/parent/');
    case 'teacher':
    default:
      return (window.location.href = teacherAppPath());
  }
}

function maybePromptRestoreAccount(user) {
  return promptRestoreAccount(user, showSuccess);
}

/* ── Password reset ────────────────────────────────────────────
   The reset email's link signs the teacher in for this one job and opens
   login.html?reset=1 (or the site's front page, which sends it here). The
   page shows Choose a New Password instead of going on to the gradebook.
   Supabase puts the link's tokens, or an error for a used or expired link,
   in the address; the client reads them as the page loads. */
var RESET_EXPIRED =
  'This reset link has expired or was already used. Enter your email and choose Forgot password? to get a new one.';

function isResetLink() {
  return new URLSearchParams(location.search).get('reset') === '1' || /(^|[#&])type=recovery(&|$)/.test(location.hash);
}

function resetLinkError() {
  var hash = new URLSearchParams(location.hash.replace(/^#/, ''));
  var query = new URLSearchParams(location.search);
  return hash.get('error') || hash.get('error_code') || query.get('error') || query.get('error_code') || null;
}

function showResetForm() {
  document.querySelector('.auth-tabs').hidden = true;
  document.getElementById('form-signin').hidden = true;
  document.getElementById('form-signup').hidden = true;
  document.querySelector('.auth-demo').hidden = true;
  document.getElementById('form-reset').hidden = false;
  document.getElementById('rs-password').focus();
}

/* A link that can't be used: back to Sign In, saying why. The address is
   cleaned so a reload doesn't try the link again. */
function resetLinkFailed() {
  history.replaceState(null, '', location.pathname);
  switchTab('signin');
  showError(RESET_EXPIRED);
}

async function startPasswordReset(sb) {
  if (resetLinkError()) return resetLinkFailed();
  var result = await sb.auth.getSession();
  if (!result.data.session) return resetLinkFailed();
  // The tokens have been read; keep them out of the address bar and history.
  history.replaceState(null, '', location.pathname + '?reset=1');
  showResetForm();
}

async function handleResetSubmit(e) {
  e.preventDefault();
  hideMessages();
  var password = document.getElementById('rs-password').value;
  if (password !== document.getElementById('rs-confirm').value) {
    showError('Passwords do not match.');
    return;
  }
  var btn = document.getElementById('rs-submit');
  btn.disabled = true;
  btn.textContent = 'Saving...';
  try {
    var sb = getSupabase();
    var result = await sb.auth.updateUser({ password: password });
    if (result.error) throw result.error;
    showSuccess('Your password is changed. Opening FullVision…');
    setTimeout(function () {
      portalRedirect(result.data.user);
    }, 1200);
  } catch (err) {
    showError(err.message || 'Could not save the new password. Please try again.');
    btn.disabled = false;
    btn.textContent = 'Save New Password';
  }
}

/* ── Redirect if already logged in ─────────────────────────── */
(async function () {
  if (isResetLink()) {
    var resetSb = getSupabase();
    if (resetSb) {
      try {
        await startPasswordReset(resetSb);
      } catch (e) {
        resetLinkFailed();
      }
    } else {
      resetLinkFailed();
    }
    return;
  }
  // Opt-in demo via URL: /login.html?demo=1 wipes local state, sets the demo
  // flag, and drops the user at the dashboard with Science 8 auto-seeded.
  // Useful for testing and for sharing a "just works" local link.
  if (new URLSearchParams(location.search).get('demo') === '1') {
    startDemoMode();
    window.location.href = teacherAppPath();
    return;
  }
  // Dev mode: only skip login on localhost when explicitly opted in with ?dev=1
  var hasConfig = !!(window.__ENV && window.__ENV.SUPABASE_URL && !window.__ENV.SUPABASE_URL.startsWith('__'));
  var isDevOptIn = new URLSearchParams(location.search).get('dev') === '1';
  if (location.hostname === 'localhost' && !hasConfig && isDevOptIn) {
    window.location.href = '/dashboard';
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
  if (!startDemoMode({ confirm: true })) return;
  // A phone opens the phone app; anything bigger, the desktop app.
  window.location.href = teacherAppPath();
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
    // The link comes back to this page, which shows Choose a New Password.
    var result = await sb.auth.resetPasswordForEmail(email, {
      redirectTo: resetPasswordRedirect(),
    });
    if (result.error) throw result.error;
    showSuccess('Password reset email sent. Check your inbox.');
  } catch (err) {
    showError(err.message || 'Could not send reset email.');
  }
}

/* ── Form submit listeners ── */
document.getElementById('form-signin').addEventListener('submit', handleSignIn);
document.getElementById('form-signup').addEventListener('submit', handleSignUp);
document.getElementById('form-reset').addEventListener('submit', handleResetSubmit);

// The splash page's Create an Account link opens the Sign Up tab.
if (window.location.hash === '#signup') switchTab('signup');
