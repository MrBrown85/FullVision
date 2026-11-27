// @ts-check
/* rubric-print-controls.js — Print Rubrics: the dialog's radios, boxes and
   tiles. Moved from teacher/rubric-print.js on 2026-11-27 with
   scripts/split/cut.mjs, as text, unchanged. It uses only esc() and loads
   before rubric-print.js. */
/** @type {any} */ (window).RubricPrintControls = (function () {
  'use strict';

  function _radio(name, value, checked, label, help) {
    return (
      '<label class="rp-option"><input type="radio" name="' +
      name +
      '" value="' +
      value +
      '"' +
      (checked ? ' checked' : '') +
      '><span>' +
      esc(label) +
      (help ? ' <span class="rp-help">' + esc(help) + '</span>' : '') +
      '</span></label>'
    );
  }

  function _check(key, checked, label) {
    return (
      '<label class="rp-option"><input type="checkbox" data-include="' +
      key +
      '"' +
      (checked ? ' checked' : '') +
      '><span>' +
      esc(label) +
      '</span></label>'
    );
  }

  /* A choice drawn as a tile: a real radio, so arrows and Space work. */
  function _tile(name, value, checked, title, help, drawing, disabled) {
    return (
      '<label class="rp-tile' +
      (checked ? ' is-on' : '') +
      (disabled ? ' is-disabled' : '') +
      '"><input type="radio" name="' +
      name +
      '" value="' +
      value +
      '"' +
      (checked ? ' checked' : '') +
      (disabled ? ' disabled' : '') +
      '>' +
      (drawing || '') +
      '<span class="rp-tile-title">' +
      esc(title) +
      '</span><span class="rp-tile-help">' +
      esc(help) +
      '</span></label>'
    );
  }

  /* A small page with its sheets, for the Rubrics per Page tiles. */
  function _pageDrawing(layout) {
    var cells = '';
    for (var i = 0; i < layout.cols * layout.rows; i++) cells += '<span></span>';
    return (
      '<span class="rp-page-icon is-' +
      layout.orientation +
      '" style="grid-template-columns:repeat(' +
      layout.cols +
      ',1fr);grid-template-rows:repeat(' +
      layout.rows +
      ',1fr)" aria-hidden="true">' +
      cells +
      '</span>'
    );
  }

  return {
    _check: _check,
    _pageDrawing: _pageDrawing,
    _radio: _radio,
    _tile: _tile,
  };
})();
