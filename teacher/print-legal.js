// @ts-check
/* print-legal.js — printing on Legal paper.

   A web page can only suggest its paper. Chrome and Edge open their print
   box on the printer's own paper (Letter) and shrink a Legal page onto it,
   narrow with wide margins; Safari ignores the suggestion. Teachers
   thought the app was broken (Colin, 2026-11-25). Nothing a page does can
   choose the paper, so the app says it, twice:

   - In the Print box (Print Reports, Print Grades), when the paper is
     Legal: which setting to change in the teacher's own browser's print
     box, with a picture of it (stepHtml).
   - After a Legal print: "Did the pages come out small?", with the same
     picture and Use Letter Instead (after). A print box closed without
     printing ends the same way, so the bar asks; it does not say. */
window.PrintLegal = (function () {
  'use strict';

  var BAR_ID = 'print-legal-bar';
  var QUIET_KEY = 'fv-legal-print-quiet';

  /** The browser, from its user agent: 'edge', 'firefox', 'chrome', 'safari' or 'other'.
      @param {string} [ua] */
  function browser(ua) {
    var s = ua == null ? (typeof navigator !== 'undefined' && navigator.userAgent) || '' : String(ua);
    if (/Edg\//.test(s)) return 'edge';
    if (/Firefox\//.test(s)) return 'firefox';
    if (/Chrome\/|CriOS\//.test(s)) return 'chrome';
    if (/Safari\//.test(s)) return 'safari';
    return 'other';
  }

  /** @type {Record<string, string>} */
  var NAME = { chrome: 'Chrome', edge: 'Edge', firefox: 'Firefox', safari: 'Safari', other: 'your browser' };

  /* Where each print box keeps its paper, in the box's own words. Chrome,
     Edge and Firefox draw their own box, with Paper size under More
     settings; Safari uses the Mac's, whose paper is called US Legal and
     shows only with the box's details. */
  /** @param {string} b */
  function steps(b) {
    if (b === 'safari')
      return {
        first: 'Printer',
        open: '',
        row: 'Paper Size',
        value: 'US Legal',
        note: 'No Paper Size there? Click Show Details at the foot of the print box first.',
      };
    return { first: 'Destination', open: 'More settings', row: 'Paper size', value: 'Legal', note: '' };
  }

  /** The words of the steps, for the caption and a screen reader.
      @param {string} b */
  function stepText(b) {
    var s = steps(b);
    var path = (s.open ? [s.open, s.row, s.value] : [s.row, s.value]).join(' › ');
    return 'In ' + (b === 'other' ? 'your browser’s' : NAME[b] + '’s') + ' print box: ' + path + '.';
  }

  /* The step: a sentence, a small picture of the print box's settings with
     the one or two to change numbered, and the same in words. The picture
     is aria-hidden: its words are the caption under it. */
  /** @param {string} [b]  the browser; this one when left out
      @param {string} [lead]  the sentence over the picture, fixed text
      @returns {string} */
  // html-safe: fixed text from this file only (the browser's name is one of five fixed words)
  function stepHtml(b, lead) {
    var which = b || browser();
    var s = steps(which);
    var n = 0;
    var row = function (/** @type {string} */ label, /** @type {string} */ value, /** @type {string} */ cls) {
      var hit = cls.indexOf('pl-hit') >= 0;
      if (hit) n++;
      return (
        '<div class="pl-row ' +
        cls +
        '">' +
        (hit ? '<b class="pl-n">' + n + '</b>' : '') +
        '<span class="pl-k">' +
        label +
        '</span><span class="pl-v">' +
        value +
        '</span></div>'
      );
    };
    return (
      '<div class="pl-step">' +
      '<div class="pl-say">' +
      (lead || 'The print box may open on Letter. Before you press Print there, change it to Legal:') +
      '</div>' +
      '<div class="pl-pic" aria-hidden="true">' +
      row(s.first, 'Your printer', 'pl-dim') +
      (s.open ? row(s.open, '⌄', 'pl-hit') : '') +
      row(s.row, s.value + ' ▾', 'pl-hit pl-paper') +
      '</div>' +
      '<div class="pl-text">' +
      stepText(which) +
      (s.note ? ' ' + s.note : '') +
      '</div>' +
      '</div>'
    );
  }

  /* ── After a Legal print ───────────────────────────────────── */

  function _quiet() {
    try {
      return localStorage.getItem(QUIET_KEY) === '1';
    } catch (e) {
      return false;
    }
  }

  function close() {
    var bar = document.getElementById(BAR_ID);
    if (bar) bar.remove();
  }

  /** After a print. On Legal it asks, at the foot of the screen, whether
      the pages came out small. opts.useLetter switches to Letter and opens
      the Print box again.
      @param {{ paper: string, useLetter?: () => void }} opts */
  function after(opts) {
    close();
    if (!opts || opts.paper !== 'legal' || _quiet()) return;
    var bar = document.createElement('div');
    bar.id = BAR_ID;
    bar.className = 'print-legal-bar no-print';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'Printed on Legal');
    // html-safe: fixed markup; stepHtml is fixed text
    bar.innerHTML =
      '<div class="plb-main">' +
      '<div class="plb-q"><b>Did the pages come out small?</b> If they printed narrow with wide margins, the print box was still on Letter.</div>' +
      '<div class="plb-acts">' +
      '<button type="button" class="plb-how-btn" data-pl="how" aria-expanded="false">Show Me How</button>' +
      (opts.useLetter ? '<button type="button" data-pl="letter">Use Letter Instead</button>' : '') +
      '<button type="button" data-pl="quiet">Don’t Ask Again</button>' +
      '<button type="button" class="plb-x" data-pl="close" aria-label="Close">×</button>' +
      '</div></div>' +
      '<div class="plb-how" hidden>' +
      stepHtml(undefined, 'Next time, change the print box from Letter to Legal before you press Print there:') +
      '</div>';
    bar.addEventListener('click', function (e) {
      var t = /** @type {HTMLElement} */ (e.target);
      var btn = t && t.closest ? /** @type {HTMLElement | null} */ (t.closest('[data-pl]')) : null;
      if (!btn) return;
      var what = btn.getAttribute('data-pl');
      if (what === 'how') {
        var how = /** @type {HTMLElement} */ (bar.querySelector('.plb-how'));
        how.hidden = !how.hidden;
        btn.setAttribute('aria-expanded', String(!how.hidden));
      } else if (what === 'letter') {
        close();
        if (opts.useLetter) opts.useLetter();
      } else if (what === 'quiet') {
        try {
          localStorage.setItem(QUIET_KEY, '1');
        } catch (err) {
          /* storage blocked: it asks again next time */
        }
        close();
      } else close();
    });
    bar.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') close();
    });
    document.body.appendChild(bar);
    var first = /** @type {HTMLElement | null} */ (bar.querySelector('button'));
    if (first) first.focus({ preventScroll: true });
  }

  return { browser: browser, steps: steps, stepText: stepText, stepHtml: stepHtml, after: after, close: close };
})();
