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
