// @ts-check
/* Build flags: unfinished work stays behind a flag so a release never shows
   it. A flag is off until its default here turns true (the slice that ships
   it), or until localStorage 'fv-build-<name>' is '1' on that browser, which
   is how tests and reviewers see it. Unknown names are off.

   dashRow (the Dashboard's middle row) is on since D9 and bulletins
   (Bulletins, stage 1) since B1g; nothing asks for either any more. The
   names stay so a browser that still has 'fv-build-dashRow' or
   'fv-build-bulletins' set, to '1' or '0', changes nothing: a default that
   is on wins over what the device has. */
(function () {
  /** @type {Record<string, boolean>} */
  var DEFAULTS = { dashRow: true, bulletins: true, quizzes: false };

  /** @param {string} name */
  function on(name) {
    if (!Object.prototype.hasOwnProperty.call(DEFAULTS, name)) return false;
    if (DEFAULTS[name] === true) return true;
    try {
      return localStorage.getItem('fv-build-' + name) === '1';
    } catch (e) {
      return false;
    }
  }

  window.BuildFlags = { on: on };
})();
