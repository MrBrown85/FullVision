// @ts-check
/* dash-tile-redraw.js — a click inside one Dashboard tile draws that tile
   alone. PageDashboard.render() builds the whole page as one string; for the
   Inbox's view switch and its stacks, the Competencies tile's This Term | Year
   and a student's flag, that threw away the top bar, Bulletins and every
   student card for a change in one place. Each function here returns true
   when it drew the one thing, false when the page was not in a state it knows
   (no tile, Class Settings open, the list itself changing), and the caller
   then draws the whole Dashboard as before. Nothing here touches grades. */
window.DashTileRedraw = (function () {
  'use strict';

  /** The Inbox slot alone; the left column's quiet class and its glide follow.
   * @param {string} cid
   * @returns {boolean} */
  function inbox(cid) {
    var DI = /** @type {any} */ (window).DashInbox;
    var slot = document.querySelector('.dash-row-inbox');
    var left = document.querySelector('.dash-row-left');
    if (!DI || !slot || !left || !document.getElementById('dash-inbox')) return false;
    var bulletins = !!document.querySelector('.dash-row-bulletins');
    DI.beforeRender();
    var html = DI.html(cid, {
      classCounts: /** @type {any} */ (window).GraderWork.classWorkCounts,
      bulletins: bulletins,
    });
    if (!html) return false;
    // html-safe: DashInbox.html builds the tile; every name and title goes through esc.
    slot.innerHTML = html;
    left.classList.toggle('has-quiet-inbox', bulletins && !!DI.quiet());
    DI.afterRender(cid);
    return true;
  }

  /** The Competencies tile alone, with the page and span the teacher chose.
   * @param {string} cid @param {(key: string) => string | null} read the saved choices (localStorage)
   * @returns {boolean} */
  function competencies(cid, read) {
    var DC = /** @type {any} */ (window).DashCompetencies;
    var host = document.querySelector('.dash-row-comp');
    if (!DC || !host || !host.querySelector('.dash-comp-tile')) return false;
    // html-safe: DashCompetencies.html escapes every name, title and label.
    host.innerHTML = DC.html({
      cid: cid,
      allStudents: getStudents(cid),
      compPage: DC.pageOf(read(DC.PREF_KEY + cid)),
      compSpan: DC.spanOf(read(DC.SPAN_KEY + cid)),
    });
    return true;
  }

  /** One student's flag: the card's mark and the Flagged count change in
   * place. False where the list itself changes (Flagged only, Flagged First,
   * the grid), which draws the students again.
   * @param {string} cid @param {string} sid @param {{ flaggedOnly: boolean, sortMode: string, view: string }} now
   * @returns {boolean} */
  function flag(cid, sid, now) {
    if (now.flaggedOnly || now.sortMode === 'flagged' || now.view !== 'cards') return false;
    var btn = /** @type {HTMLElement | undefined} */ (
      Array.prototype.find.call(
        document.querySelectorAll('#dash-students .dash-flag-btn'),
        function (/** @type {HTMLElement} */ b) {
          return b.getAttribute('data-sid') === sid;
        },
      )
    );
    var card = btn && btn.closest('.dash-card');
    if (!btn || !card) return false;
    var on = isStudentFlagged(cid, sid);
    var label = on ? 'Unflag student' : 'Flag student';
    card.classList.toggle('flagged', on);
    btn.classList.toggle('is-on', on);
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.setAttribute('aria-pressed', String(on));
    btn.textContent = on ? '⚑' : '⚐';
    _count(Object.keys(getFlags(cid)).filter(k => getFlags(cid)[k]).length);
    var roster = /** @type {any} */ (window).refreshRosterRows;
    if (typeof roster === 'function') roster();
    return true;
  }

  /** The number on the Flagged button, added, changed or taken off.
   * @param {number} n */
  function _count(n) {
    var show = /** @type {HTMLElement | null} */ (document.querySelector('.dash-show [data-show="flagged"]'));
    if (!show) return;
    var badge = show.querySelector('.atb-badge');
    if (!n) {
      if (badge) badge.remove();
      show.setAttribute('aria-label', 'Show flagged students only');
      return;
    }
    if (!badge) {
      // html-safe: a fixed string.
      show.insertAdjacentHTML('beforeend', '<span class="atb-badge atb-badge-blue" data-n="flagged"></span>');
      badge = /** @type {Element} */ (show.querySelector('.atb-badge'));
    }
    badge.textContent = String(n);
    show.setAttribute('aria-label', 'Show flagged students only, ' + n + ' flagged');
  }

  return { inbox: inbox, competencies: competencies, flag: flag };
})();
