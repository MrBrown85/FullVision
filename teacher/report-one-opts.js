// @ts-check
/* report-one-opts.js — the rows of a part's options in One Report's panel
   that are not a switch or a choice: a text box, a date (the Parent /
   Guardian Response's Return By) and the − n + of a part's lines.
   report-one-panel.js draws the switches and the choices and calls rowHtml
   for the rest; the same data-action values reach its handle and change. */
window.ReportOneOpts = (function () {
  'use strict';

  /* One option's row. o: ReportOne.optionsFor's { key, label, kind, value,
     long?, min?, max? }; base: its data-part and data-opt attributes; lid:
     its label's id. '' for a kind it does not draw. */
  function rowHtml(o, base, lid) {
    var draw = { text: _text, date: _date, lines: _lines }[o.kind];
    return draw ? draw(o, base, lid) : '';
  }
  function _text(o, base, lid) {
    return (
      '<div class="one-o-row"><label class="one-o-lbl" for="' +
      lid +
      '">' +
      esc(o.label) +
      '</label>' +
      (o.long
        ? '<textarea class="one-o-text" id="' +
          lid +
          '" rows="4" data-action="oneOptText"' +
          base +
          '>' +
          esc(o.value) +
          '</textarea>'
        : '<input type="text" class="one-o-text" id="' +
          lid +
          '" data-action="oneOptText"' +
          base +
          ' value="' +
          esc(o.value) +
          '">') +
      '</div>'
    );
  }
  function _date(o, base, lid) {
    return (
      '<div class="one-o-row"><label class="one-o-lbl" for="' +
      lid +
      '">' +
      esc(o.label) +
      '</label><input type="date" class="one-o-text one-o-date" id="' +
      lid +
      '" data-action="oneOptText"' +
      base +
      ' value="' +
      esc(o.value) +
      '"></div>'
    );
  }
  function _lines(o, base, lid) {
    var v = Number(o.value) || 0;
    var lo = o.min != null ? o.min : 0;
    var hi = o.max != null ? o.max : 40;
    return (
      '<div class="one-o-row one-o-lines"><span class="one-o-lbl" id="' +
      lid +
      '">' +
      esc(o.label) +
      '</span><div class="one-step" role="group" aria-labelledby="' +
      lid +
      '"><button type="button" class="one-step-btn" data-action="oneLines"' +
      base +
      ' data-value="-1" aria-label="Fewer Lines"' +
      (v <= lo ? ' aria-disabled="true"' : '') +
      '>−</button><span class="one-step-n" aria-live="polite">' +
      v +
      '</span><button type="button" class="one-step-btn" data-action="oneLines"' +
      base +
      ' data-value="1" aria-label="More Lines"' +
      (v >= hi ? ' aria-disabled="true"' : '') +
      '>+</button></div></div>'
    );
  }

  return { rowHtml: rowHtml };
})();
