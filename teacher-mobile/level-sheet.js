// @ts-check
/* level-sheet.js — press and hold a level on the phone grader (Nov 2
   mockup, batch 2), moved out of tab-grade.js as it was. Holding a
   competency's 1–4 button for about half a second opens a sheet: the
   competency, the level, its descriptor, what Proficient means (the I Can
   statements) and the next step (CompetencyWording). Letting go doesn't
   score; a quick tap still does, and a finger that moves first cancels the
   hold. The grading screen is always on the active class. */
/** @type {any} */ (window).MLevelSheet = (function () {
  'use strict';

  /** @type {any} */
  var W = window;
  var MC = W.MComponents;

  var HOLD_MS = 450;
  /** @type {{ btn: Element, x: number, y: number, shown: boolean, timer: any } | null} */
  var _hold = null;

  function _levelSheetHtml(cid, tag, level) {
    var l = W.CompetencyWording.lines(tag, level);
    if (!l) return '';
    var word = typeof levelWord === 'function' ? levelWord(cid, level) : l.word;
    return (
      '<div class="m-level-sheet">' +
      '<h2 class="m-level-sheet-title">' +
      MC.esc(tag.label || tag.code || '') +
      '</h2>' +
      '<div class="m-level-sheet-level">' +
      level +
      (word ? ' \u00b7 ' + MC.esc(word) : '') +
      '</div>' +
      (l.descriptor ? '<p>' + MC.esc(l.descriptor) + '</p>' : '') +
      (l.iCans.length
        ? '<p><b>Proficient means:</b></p><ul>' +
          l.iCans
            .map(function (x) {
              return '<li>' + MC.esc(x) + '</li>';
            })
            .join('') +
          '</ul>'
        : '') +
      (l.next ? '<p><b>Next step:</b> ' + MC.esc(l.next) + '</p>' : '') +
      '</div>'
    );
  }

  /** @param {Element} btn */
  function showLevelSheet(btn) {
    var cid = typeof getActiveCourse === 'function' ? getActiveCourse() : null;
    var tag = cid && typeof getTagById === 'function' ? getTagById(cid, btn.getAttribute('data-tid')) : null;
    var level = parseInt(btn.getAttribute('data-score') || '', 10);
    if (!tag || !W.CompetencyWording) return;
    var html = _levelSheetHtml(cid, tag, level);
    if (!html) return;
    MC.presentSheet(html, { half: true });
    var l = W.CompetencyWording.lines(tag, level);
    if (l && !l.ready)
      W.CompetencyWording.loadBank().then(function (ok) {
        var box = document.querySelector('#m-sheet-container .m-level-sheet');
        // html-safe: _levelSheetHtml escapes the label, level word, descriptor, I Can statements and step (MC.esc)
        if (ok && box) box.outerHTML = _levelSheetHtml(cid, tag, level);
      });
  }

  function _holdDown(e) {
    // A finger or pen: a mouse's slow click still scores.
    if (e.pointerType === 'mouse') return;
    var btn = e.target.closest && e.target.closest('.m-score-btn[data-tid]');
    if (!btn) return;
    if (_hold) clearTimeout(_hold.timer);
    /** @type {NonNullable<typeof _hold>} */
    var hold = { btn: btn, x: e.clientX, y: e.clientY, shown: false, timer: 0 };
    _hold = hold;
    hold.timer = setTimeout(function () {
      hold.shown = true;
      showLevelSheet(btn);
    }, HOLD_MS);
  }
  function _holdMove(e) {
    if (!_hold || _hold.shown) return;
    if (Math.abs(e.clientX - _hold.x) + Math.abs(e.clientY - _hold.y) > 10) {
      clearTimeout(_hold.timer);
      _hold = null;
    }
  }
  function _holdUp() {
    if (!_hold) return;
    clearTimeout(_hold.timer);
    if (!_hold.shown) _hold = null;
  }
  // The click that ends a hold is swallowed, so the level isn't scored.
  function _holdClick(e) {
    if (!_hold) return;
    var held = _hold.shown && _hold.btn.contains(e.target);
    _hold = null;
    if (!held) return;
    e.preventDefault();
    e.stopPropagation();
  }
  document.addEventListener('pointerdown', _holdDown);
  document.addEventListener('pointermove', _holdMove);
  document.addEventListener('pointerup', _holdUp);
  document.addEventListener('pointercancel', _holdUp);
  document.addEventListener('click', _holdClick, true);

  return { show: showLevelSheet };
})();
