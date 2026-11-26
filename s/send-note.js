// @ts-check
/* Check and Send's own parts (s/send.js): the Note for Your Teacher, See the
   Assignment, and the draft kept when the student goes Back.

   The note. Students write a
   paragraph or two there (Kant and the News, Nov 26 2026: notes of 400 to
   900 characters in what was a three-line box). The box starts at six lines
   and grows with the writing, so the whole note is in view; the count shows
   once 200 characters are left, so the limit (1,000, the database's
   submission_note_check) never stops a student without warning; and writing
   at the end of a long note keeps the last line above the pinned Send
   button, which the browser's own scroll to the caret does not allow for.

   See the Assignment opens in place, over the photos: the teacher's
   instructions, the handouts and links, and the rubric's criteria with
   each level, so a student checks the work against them without leaving
   (Philosophy 12, Nov 26 2026: Back used to lose the photos and the note).

   The draft. Back keeps the photos and the note of a send not yet started,
   one for each piece, in this tab's memory only: Send My Work on that piece
   opens them again. A sign-out (Done, 15 idle minutes, another class) lets
   them go with the rest of the student's sends (s/send.js, share). */
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

  var PLAN_ARROW =
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
  /** Your Plan From Last Time and Did You Do It? (S10-F2), above the note. Moved here from s/send.js.
   * @param {any} send @param {any} p @param {Record<string, string>} FOLLOWED */
  function planAsk(send, p, FOLLOWED) {
    if (!p.plan || !p.plan.text) return '';
    return (
      '<section class="sp-send-plan" aria-labelledby="sp-send-plan-title"><h2 class="sp-plan-title" id="sp-send-plan-title">' +
      PLAN_ARROW +
      'Your Plan From Last Time</h2><p class="sp-plan-words">' +
      esc(p.plan.text) +
      '</p><h3 class="sp-send-plan-ask" id="sp-send-plan-ask">Did You Do It?</h3><div class="sp-choices" role="radiogroup" aria-label="Did you follow your plan?">' +
      Object.keys(FOLLOWED)
        .map(function (k) {
          var on = send.followed === k;
          return (
            // Yes green when chosen, as the board; Partly and Not This Time blue.
            '<button type="button" class="sp-choice' +
            (k === 'yes' ? ' sp-choice-green' : '') +
            '" role="radio" aria-checked="' +
            on +
            '" tabindex="' +
            (on || (!send.followed && k === 'yes') ? '0' : '-1') +
            '" data-act="send-followed" data-value="' +
            k +
            '">' +
            esc(FOLLOWED[k]) +
            '</button>'
          );
        })
        .join('') +
      '</div></section>'
    );
  }

  /** The button, and the assignment under it when open.
   * @param {any} p the piece @param {boolean} open */
  function about(p, open) {
    var view = /** @type {any} */ (window).StudentPageView;
    var rubric = /** @type {any} */ (window).StudentRubric;
    var body =
      (p.description ? '<p class="sp-piece-about">' + esc(p.description) + '</p>' : '') +
      // A handout opens from the Assignments list only: send.js keeps the draft first (send-handout).
      (view && view.resourcesHtml
        ? view.resourcesHtml(p, false).replace(/data-act="handout"/g, 'data-act="send-handout"')
        : '') +
      (p.rubric && rubric ? '<div class="sp-send-about-rubric">' + rubric.cards(p) + '</div>' : '');
    if (!body) return '';
    return (
      '<button type="button" class="sp-btn sp-btn-tint sp-send-about-btn" data-act="send-about" aria-expanded="' +
      open +
      '" aria-controls="sp-send-about">' +
      (open ? 'Hide the Assignment' : 'See the Assignment') +
      '</button>' +
      (open
        ? '<section class="sp-view sp-send-about" id="sp-send-about" aria-label="The Assignment">' + body + '</section>'
        : '')
    );
  }

  /** @type {Record<string, any>} */
  var drafts = {};
  /** Back from Check and Send: a send not started, with something in it, is kept for its piece.
   * @param {any} send */
  function keep(send) {
    var key = send.student + ':' + send.id + ':' + !!send.replace;
    if (send.step === 'check' && !send.busy && (send.pages.length || send.note)) drafts[key] = send;
    else delete drafts[key];
  }
  /** The draft for this student's piece, if one is kept, taken off the list.
   * @param {string} student @param {string} id @param {boolean} replace */
  function kept(student, id, replace) {
    var key = student + ':' + id + ':' + !!replace;
    var send = drafts[key];
    delete drafts[key];
    return send && send.step === 'check' ? send : null;
  }

  /** Presses Check and Send leaves to this file; true when handled.
   * @param {string} act @param {any} el @param {any} S the page's state */
  function press(act, el, S) {
    if (act === 'card-done' || act === 'class-open' || act === 'card-add') drafts = {};
    if (S.screen !== 'send' || !S.send) return false;
    if (act === 'send-about') {
      S.send.about = !S.send.about;
      /** @type {any} */ (window).StudentPage.paint('[data-act="send-about"]');
      return true;
    }
    if (act !== 'send-handout') return false;
    // A handout under See the Assignment: the draft kept, then the handout opened as from its card,
    // before any redraw, so the page's own press (s/app.js, s/handouts.js) opens it.
    keep(S.send);
    S.send = null;
    S.screen = 'assignments';
    el.setAttribute('data-act', 'handout');
    el.click();
    return true;
  }

  /** @type {any} */ (window).SendNote = {
    press: press,
    html: html,
    input: input,
    planAsk: planAsk,
    about: about,
    keep: keep,
    kept: kept,
    clear: function () {
      drafts = {};
    },
  };
})();
