// @ts-check
/* Build flags: unfinished work stays behind a flag so a release never shows
   it. A flag is off until its default here turns true (the slice that ships
   it), or until localStorage 'fv-build-<name>' is '1' on that browser, which
   is how tests and reviewers see it. Unknown names are off. Nothing reads a
   flag yet. */
(function () {
  /** @type {Record<string, boolean>} */
  var DEFAULTS = { dashRow: false, bulletins: false, quizzes: false };

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
