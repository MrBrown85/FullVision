// @ts-check
/* A Standard rubric's cell words on the class grid (Colin, Nov 18): teachers
   see an Advanced Rubric's boxes under each level and asked for the words
   they wrote for a Standard one too. Show Level Words, at the top of the
   grid, shows every Standard row's wording joined under the level bar, each
   level's under its own button, and this device remembers the choice. The words are drawn only
   while Words is on (a long class grid stays as light as before), so
   switching draws the page again. It takes the place of the descriptor bar
   that showed one level's words on hover. */
window.RubricWords = (function () {
  'use strict';

  var KEY = 'rsg-words';

  function shown() {
    try {
      return localStorage.getItem(KEY) === 'show';
    } catch (e) {
      return false;
    }
  }

  function apply(on) {
    if (!document.querySelectorAll) return;
    document.querySelectorAll('[data-rw="toggle"]').forEach(function (b) {
      /** @type {HTMLInputElement} */ (b).checked = on;
    });
  }

  function toggle() {
    var on = !shown();
    try {
      localStorage.setItem(KEY, on ? 'show' : 'hide');
    } catch (e) {
      /* storage blocked: this page only */
    }
    apply(on);
    if (window.PageAssignments && PageAssignments.render) PageAssignments.render();
  }

  // What the teacher wrote for one level of a criterion.
  function words(crit, lv) {
    var l = crit && crit.levels;
    return (l && (l[lv] || l[String(lv)])) || '';
  }
  function hasWords(crit, order) {
    return order.some(function (lv) {
      return !!words(crit, lv);
    });
  }

  /* One switch at the top of a Standard rubric's grid, not one per row
     (the council, Nov 18: seven buttons for one choice read as noise). */
  // html-safe: fixed markup
  function switchHtml(rubric, order) {
    var any = ((rubric && rubric.criteria) || []).some(function (c) {
      return hasWords(c, order);
    });
    if (!any) return '';
    return (
      '<label class="rsg-words-bar"><span>Show Level Words</span><span class="gpd-switch">' +
      '<input type="checkbox" role="switch" data-rw="toggle"' +
      (shown() ? ' checked' : '') +
      '><span class="gpd-switch-ui" aria-hidden="true"></span></span></label>'
    );
  }

  // html-safe: each level's words go through esc
  function panelHtml(crit, order, chosen) {
    if (!shown() || !hasWords(crit, order)) return '';
    return (
      '<div class="rsg-words">' +
      order
        .map(function (lv) {
          return (
            '<div class="rsg-words-col' +
            (Number(chosen) === lv ? ' is-chosen' : '') +
            '">' +
            esc(words(crit, lv)) +
            '</div>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  if (document.addEventListener)
    document.addEventListener(
      'click',
      function (e) {
        var t = /** @type {any} */ (e.target);
        var b = t && t.closest && t.closest('[data-rw="toggle"]');
        if (!b) return;
        e.stopPropagation();
        toggle();
      },
      true,
    );
  apply(shown());

  return { switchHtml: switchHtml, panelHtml: panelHtml, shown: shown, toggle: toggle };
})();
