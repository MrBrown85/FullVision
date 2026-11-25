// @ts-check
/* Build flags: unfinished work stays behind a flag so a release never shows
   it. A flag is off until its default here turns true (the slice that ships
   it), or until localStorage 'fv-build-<name>' is '1' on that browser, which
   is how tests and reviewers see it. Unknown names are off.

   dashRow (the Dashboard's middle row) is on since D9, bulletins
   (Bulletins, stage 1) since B1g, quizzes (Quizzes) since Q6 and inboxStacks
   (the Inbox redrawn, docs/plans/inbox-redesign-plan.md) since I5; nothing
   asks for any of them any more. The names stay so a browser that still has
   'fv-build-dashRow', 'fv-build-bulletins', 'fv-build-quizzes' or
   'fv-build-inboxStacks' set, to '1' or '0', changes nothing: a default that
   is on wins over what the device has.

   phoneLook (the phone's new look, docs/plans/phone-look-plan.md) is on
   for everyone since Colin's word on Nov 25: the phone's <html> carries the
   class m-look and teacher-mobile/look.css restyles what is already drawn.
   The old layout's code stays until L8 deletes it. */
(function () {
  /** @type {Record<string, boolean>} */
  var DEFAULTS = { dashRow: true, bulletins: true, quizzes: true, inboxStacks: true, phoneLook: true };

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
