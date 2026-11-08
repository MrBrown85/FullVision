/* shared/sign-in.js — what the two sign-in screens share.
 *
 * login.html (desktop) and teacher-mobile/index.html (phone) each draw their own
 * sign-in card. The steps behind it live here so the two can't drift:
 * Try Demo Mode, the Restore Account prompt for an account set to be
 * deleted, where a password reset link lands, Check Your Inbox after
 * Create Account, and the teacher's name after a Google sign-in.
 *
 * Plain browser globals, like login-auth.js. Needs shared/html.js (esc) and
 * shared/supabase.js (getSupabase) at call time. */

/* A password reset link opens login.html, which shows Choose a New Password. */
function resetPasswordRedirect() {
  return location.origin + '/login.html?reset=1';
}

/* Portals live in user_metadata.portal; absent means teacher. */
function getPortal(user) {
  return (user && user.user_metadata && user.user_metadata.portal) || 'teacher';
}

/* The companion token stored beside gb-demo-mode. It isn't secret; it shows
 * Demo Mode was entered here rather than by setting one flag in DevTools.
 * signOut() in shared/supabase.js wipes every gb-* key, so both go together. */
function _demoToken() {
  try {
    return crypto.randomUUID();
  } catch (e) {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  }
}

/* Wipe this device's gb-* state and turn Demo Mode on. With opts.confirm,
 * asks first when there is data to lose and returns false if the teacher
 * says no. The caller decides where to go next. */
function startDemoMode(opts) {
  var keys = Object.keys(localStorage).filter(function (k) {
    return k.indexOf('gb-') === 0;
  });
  if (opts && opts.confirm) {
    var hasExistingState = keys.some(function (k) {
      return k !== 'gb-demo-mode' && k !== 'gb-demo-mode-token';
    });
    if (
      hasExistingState &&
      !window.confirm(
        'Demo Mode will erase the FullVision data on this device and load a sample class.\n\n' +
          'Anything not synced to your account will be lost. Continue?',
      )
    ) {
      return false;
    }
  }
  // The seed only fires when COURSES is empty, so old account data would block it.
  keys.forEach(function (k) {
    localStorage.removeItem(k);
  });
  localStorage.setItem('gb-demo-mode', '1');
  localStorage.setItem('gb-demo-mode-token', _demoToken());
  return true;
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
      <div class="confirm-message">Your account is scheduled for deletion on ${esc(deletionDate)}. Restore it now?</div>
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

/* The app reads the teacher's name from user_metadata.display_name, which the
 * sign-up form sets. Google fills full_name and name instead, so copy the
 * name across once after a Google sign-in. Returns the user, updated when the
 * copy worked; a failed copy only means the name shows as the email for now. */
async function ensureDisplayName(user) {
  var meta = (user && user.user_metadata) || {};
  if (meta.display_name) return user;
  var name = meta.full_name || meta.name;
  var sb = getSupabase();
  if (!name || !sb) return user;
  try {
    var res = await sb.auth.updateUser({ data: { display_name: name } });
    return (res && !res.error && res.data && res.data.user) || user;
  } catch (e) {
    return user;
  }
}

/* Signed in, but bootstrap_teacher failed, so there is no account to open.
 * The sign-in screens show this rather than the database's own message, and
 * never stay silent: before Nov 8, a teacher record left by a deleted sign-in
 * account kept its email and left the teacher on Sign In with no word. */
var ACCOUNT_OPEN_FAILED =
  "You're signed in, but FullVision couldn't open your account. Try again in a minute. If it keeps happening, email colin.brown04@gmail.com.";

function accountOpenError(cause) {
  var err = new Error(ACCOUNT_OPEN_FAILED);
  err.code = 'account_open_failed';
  err.cause = cause;
  return err;
}

/* After sign-in: if the teacher's account is set to be deleted, ask whether
 * to restore it. Returns true to go on into the app, false to stay on the
 * sign-in screen (the teacher chose Continue deletion and is signed out).
 * showSuccess(msg) is the screen's own success line. */
async function promptRestoreAccount(user, showSuccess) {
  if (getPortal(user) !== 'teacher') return true;
  var sb = getSupabase();
  if (!sb) return true;

  var bootRes = await sb.rpc('bootstrap_teacher', {
    p_email: (user && user.email) || '',
    p_display_name: (user && user.user_metadata && user.user_metadata.display_name) || null,
  });
  if (bootRes.error) throw accountOpenError(bootRes.error);

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

/* ── After Create Account ──────────────────────────────────────
 * Sign-up ends one of three ways. With email confirmation on (the usual
 * case), Supabase sends a link and the screen shows Check Your Inbox; the
 * link signs the teacher in and opens login.html?confirmed=1, which goes on
 * into the gradebook. With confirmation off, sign-up returns a session and
 * the teacher goes straight in. An address that already has an account
 * comes back with no identities (Supabase sends no email then), so the
 * screen offers Sign In instead of waiting for a link that won't come. */
function signUpOutcome(data) {
  if (data && data.session) return 'signed-in';
  var user = data && data.user;
  if (user && Array.isArray(user.identities) && user.identities.length === 0) return 'exists';
  return 'confirm';
}

/* Sign-in refused because the address was never confirmed. */
function isEmailNotConfirmed(err) {
  return !!err && (err.code === 'email_not_confirmed' || /email not confirmed/i.test(err.message || ''));
}

/* Check Your Inbox: shows the address, runs Resend Email with a cooldown
 * (Supabase allows one email a minute), and goes on into the app if the
 * link is opened in another tab of this browser, which shares the session.
 * Returns a function that stops watching. */
var RESEND_WAIT_SECONDS = 60;

function startCheckInbox(opts) {
  opts.emailEl.textContent = opts.email;
  var btn = opts.resendBtn;
  var label = btn.textContent;
  var timer = null;

  function cooldown(seconds) {
    clearInterval(timer);
    btn.disabled = true;
    btn.textContent = 'Resend Email (' + seconds + ')';
    timer = setInterval(function () {
      seconds -= 1;
      if (seconds > 0) {
        btn.textContent = 'Resend Email (' + seconds + ')';
        return;
      }
      clearInterval(timer);
      btn.disabled = false;
      btn.textContent = label;
    }, 1000);
  }

  btn.onclick = async function () {
    opts.clearMessages();
    btn.disabled = true;
    btn.textContent = 'Sending...';
    try {
      await resendSignUpEmail(opts.email);
      opts.showSuccess('Sent. Check your inbox again, including the spam folder.');
      cooldown(RESEND_WAIT_SECONDS);
    } catch (err) {
      var wait = /(\d+)\s*seconds?/.exec((err && err.message) || '');
      if (wait) {
        opts.showError('Wait a moment before sending another email.');
        cooldown(Number(wait[1]) || RESEND_WAIT_SECONDS);
      } else {
        opts.showError((err && err.message) || 'Could not send the email. Please try again.');
        btn.disabled = false;
        btn.textContent = label;
      }
    }
  };
  if (opts.justSent) cooldown(RESEND_WAIT_SECONDS);

  var sub = null;
  var sb = getSupabase();
  if (sb) {
    sub = sb.auth.onAuthStateChange(function (event, session) {
      if (event === 'SIGNED_IN' && session) opts.onSignedIn(session.user);
    }).data.subscription;
  }

  return function stop() {
    clearInterval(timer);
    btn.disabled = false;
    btn.textContent = label;
    btn.onclick = null;
    if (sub) sub.unsubscribe();
  };
}
