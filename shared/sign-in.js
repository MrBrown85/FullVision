/* shared/sign-in.js — what the two sign-in screens share.
 *
 * login.html (desktop) and teacher-mobile/index.html (phone) each draw their own
 * sign-in card. The steps behind it live here so the two can't drift:
 * Try Demo Mode, the Restore Account prompt for an account set to be
 * deleted, and where a password reset link lands.
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
