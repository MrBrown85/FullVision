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
function portalRedirect(user) {
  var portal = (user && user.user_metadata && user.user_metadata.portal) || 'teacher';
  var preferMobile = portal === 'teacher' && window.innerWidth <= 768 && localStorage.getItem('td-mobile-pref') !== 'desktop';

  switch (portal) {
    case 'student':
      return window.location.href = '/student/';
    case 'parent':
      return window.location.href = '/parent/';
    case 'teacher':
    default:
      return window.location.href = preferMobile ? '/teacher-mobile/' : '/teacher/app.html';
  }
}

/* ── Redirect if already logged in ─────────────────────────── */
(async function() {
  try {
    var sb = getSupabase();
    if (sb) {
      var result = await sb.auth.getSession();
      var session = result.data.session;
      if (session) {
        portalRedirect(session.user);
        return;
      }
    }
  } catch(e) { /* not logged in, stay on page */ }
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
    portalRedirect(result.user);
  } catch(err) {
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
    setTimeout(function() { btn.disabled = false; btn.textContent = 'Create Account'; }, 4000);
  } catch(err) {
    showError(err.message || 'Sign up failed. Please try again.');
    btn.disabled = false;
    btn.textContent = 'Create Account';
  }
}

/* ── Delegated click handler ───────────────────────────────── */
document.addEventListener('click', function(e) {
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
  }
});

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
  } catch(err) {
    showError(err.message || 'Could not send reset email.');
  }
}

/* ── Form submit listeners (replaces inline onsubmit handlers) ── */
document.getElementById('form-signin').addEventListener('submit', handleSignIn);
document.getElementById('form-signup').addEventListener('submit', handleSignUp);
