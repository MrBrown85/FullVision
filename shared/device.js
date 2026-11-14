/* shared/device.js — which app a teacher lands in: phone or desktop.
 *
 * Phones get the phone app (teacher-mobile/); iPads, laptops and desktops
 * get the desktop app (/dashboard). The screen's short side tells them
 * apart: phones are under 600 points wide (the largest is about 440), the
 * smallest iPad is 744. The window's width isn't used, so a narrow desktop
 * window or a split-screen iPad still gets the desktop app.
 *
 * Switch to Desktop on the phone app sets td-mobile-pref = 'desktop', which
 * this respects. */
function isPhone() {
  var s = window.screen || {};
  var shortSide = Math.min(s.width || Infinity, s.height || Infinity);
  return shortSide < 600;
}

function prefersMobileApp() {
  return isPhone() && localStorage.getItem('td-mobile-pref') !== 'desktop';
}

/* Where a teacher's app starts on this device. */
function teacherAppPath() {
  return prefersMobileApp() ? '/teacher-mobile/' : '/dashboard';
}

/* An iPad gets the desktop app with a touch layer on top: html.fv-tablet.
 * teacher/tablet.css styles only under that class, and only below 1100
 * points wide (an iPad held upright), so a computer never sees a change,
 * even in a narrow window or on a touch screen.
 *
 * iPadOS asks for desktop sites with a Mac's user agent, so an iPad is a
 * "Macintosh" with more than one touch point; a real Mac has none. An
 * Android tablet says Android without Mobile. */
function isTablet() {
  if (isPhone() || typeof navigator === 'undefined') return false;
  var ua = navigator.userAgent || '';
  if (/iPad/.test(ua)) return true;
  if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return true;
  return /Android/.test(ua) && !/Mobile/.test(ua);
}

if (typeof document !== 'undefined' && document.documentElement && isTablet()) {
  document.documentElement.classList.add('fv-tablet');
}
