// @ts-check
/* The Note for Your Teacher on Check and Send (s/send.js). Students write a
   paragraph or two there (Kant and the News, Nov 26 2026: notes of 400 to
   900 characters in what was a three-line box). The box starts at six lines
   and grows with the writing, so the whole note is in view; the count shows
   once 200 characters are left, so the limit (1,000, the database's
   submission_note_check) never stops a student without warning; and writing
   at the end of a long note keeps the last line above the pinned Send
   button, which the browser's own scroll to the caret does not allow for. */
(function () {
  'use strict';
  var WARN = 200;

  /** @param {string} note @param {number} max */
  function left(note, max) {
    var n = max - String(note || '').length;
    if (n > WARN) return '';
    return n <= 0 ? 'No room left in the note.' : n + (n === 1 ? ' character' : ' characters') + ' left.';
  }

  /** @param {string} note @param {number} max */
  function html(note, max) {
    return (
      '<label class="sp-send-note-label" for="sp-send-note">Note for Your Teacher</label>' +
      '<textarea id="sp-send-note" class="sp-send-note" maxlength="' +
      max +
      '" rows="6" aria-describedby="sp-send-count">' +
      esc(note) +
      '</textarea><p class="sp-send-count" id="sp-send-count" aria-live="polite">' +
      esc(left(note, max)) +
      '</p>'
    );
  }

  /** The note as typed, cut to max; the box grown and the count and scroll kept up.
   * @param {HTMLTextAreaElement} el @param {number} max */
  function input(el, max) {
    var note = String(el.value || '').slice(0, max);
    var wrap = el.parentNode;
    var page = /** @type {any} */ (window).StudentPage;
    if (page && page.grow) page.grow(el);
    var count = wrap && /** @type {Element} */ (wrap).querySelector('#sp-send-count');
    if (count) count.textContent = left(note, max);
    var foot = wrap && /** @type {Element} */ (wrap).querySelector('.sp-send-foot');
    if (!foot || el.selectionEnd < el.value.length || !window.scrollBy) return note;
    var over =
      (count && count.textContent ? count : el).getBoundingClientRect().bottom + 12 - foot.getBoundingClientRect().top;
    if (over > 0) window.scrollBy(0, over);
    return note;
  }

  /** @type {any} */ (window).SendNote = { html: html, input: input };
})();
