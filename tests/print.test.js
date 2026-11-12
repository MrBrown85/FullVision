/**
 * print: the tests that were tests/print-*.test.js, one describe
 * block per former file, named after it. Each block keeps its own setup
 * and hooks. Merged 2026-11-11 to cut the file count (CI time).
 */
import { readFileSync, readdirSync } from 'fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';

describe('print-fonts', () => {
  /**
   * Printouts use fonts Chrome can embed. Apple's system fonts (San Francisco,
   * SF Mono) print as Type 3 fonts, a new one for every size and weight; a
   * class set of reports went to the copier as a 466 MB print job instead of
   * 48 MB. The screen keeps the system fonts through --font-base and
   * --font-mono, and @media print in teacher/styles.css swaps both for fonts
   * that embed (Helvetica Neue, Menlo; Arial, Consolas on Windows). So no
   * stylesheet names a system font except through those two tokens.
   */

  const styles = readFileSync('teacher/styles.css', 'utf-8');
  const printBlock = styles.slice(
    styles.indexOf('@media print'),
    styles.indexOf('}', styles.indexOf('--font-mono:', styles.indexOf('@media print'))),
  );

  describe('print fonts', () => {
    it('swaps both font tokens for embeddable fonts in print', () => {
      expect(printBlock).toContain("--font-base: 'Helvetica Neue', Helvetica, Arial, sans-serif;");
      expect(printBlock).toContain("--font-mono: Menlo, Consolas, 'Courier New', monospace;");
    });

    it('names Apple system fonts only in the two tokens', () => {
      const files = readdirSync('teacher')
        .filter(f => f.endsWith('.css'))
        .map(f => 'teacher/' + f);
      const bad = [];
      files.forEach(f =>
        readFileSync(f, 'utf-8')
          .split('\n')
          .forEach((line, i) => {
            if (/font-family:.*(-apple-system|BlinkMacSystemFont|'SF Pro|'SF Mono'|system-ui)/.test(line))
              bad.push(f + ':' + (i + 1));
          }),
      );
      expect(bad).toEqual([]);
    });
  });
});

describe('print-mode', () => {
  /**
   * One sheet printing on its own (grade sheets, rubrics, QR slips) goes
   * through ui.js: setPrintMode / clearPrintMode / printThen.
   */

  describe('printing one sheet', () => {
    let doc, orig;
    beforeEach(() => {
      doc = parseHTML(
        '<!DOCTYPE html><html><head><style id="other">@page{}</style></head><body></body></html>',
      ).document;
      orig = { document: globalThis.document, print: window.print };
      globalThis.document = doc;
    });
    afterEach(() => {
      globalThis.document = orig.document;
      window.print = orig.print;
      vi.useRealTimers();
    });

    it('gives every page the same margin, the first and both sides included', () => {
      const css = printPageCss('legal portrait', '0.4in');
      expect(css).toContain('@page { size: legal portrait; margin: 0.4in; }');
      ['@page :left', '@page :right', '@page :first'].forEach(sel =>
        expect(css).toContain(sel + ' { margin: 0.4in; }'),
      );
    });

    it('puts its page rule last in <head> every time, and clears it', () => {
      setPrintMode('sheet-style', 'sheet-active', 'letter portrait', '0.25in');
      doc.head.appendChild(doc.createElement('style')).id = 'later';
      setPrintMode('sheet-style', 'sheet-active', 'letter portrait', '0.25in');
      expect(doc.head.lastElementChild.id).toBe('sheet-style');
      expect(doc.querySelectorAll('#sheet-style').length).toBe(1);
      expect(doc.body.classList.contains('sheet-active')).toBe(true);
      clearPrintMode('sheet-style', 'sheet-active');
      expect(doc.getElementById('sheet-style')).toBe(null);
      expect(doc.body.classList.contains('sheet-active')).toBe(false);
    });

    it('prints, then cleans up once whether or not afterprint fires', () => {
      vi.useFakeTimers();
      const listeners = {};
      const add = window.addEventListener;
      const remove = window.removeEventListener;
      window.addEventListener = (type, fn) => (listeners[type] = fn);
      window.removeEventListener = type => delete listeners[type];
      window.print = vi.fn();
      const cleanup = vi.fn();
      try {
        printThen(cleanup);
        expect(window.print).toHaveBeenCalledTimes(1);
        listeners.afterprint();
        vi.runAllTimers();
        expect(cleanup).toHaveBeenCalledTimes(1);
        expect(listeners.afterprint).toBeUndefined();
      } finally {
        window.addEventListener = add;
        window.removeEventListener = remove;
      }
    });
  });
});

describe('print-sheet', () => {
  /**
   * The eight-to-a-page print sheet in teacher/qr-slips.js
   * (docs/plans/student-page-build-plan.md, S3-T1): sheetPages lays any list
   * out as letter pages of eight cells, printSheet prints them, and the QR
   * slips are drawn through both. Student cards will be the second caller.
   */

  function parse(html) {
    var doc = parseHTML('<!doctype html><html><head></head><body></body></html>').document;
    var box = doc.createElement('div');
    box.innerHTML = html;
    return box;
  }

  /* The sheet as [[cell text, …], …], a list per page. */
  function layout(html) {
    return Array.from(parse(html).querySelectorAll('.qs-page')).map(page =>
      Array.from(page.children).map(cell => {
        expect(cell.className).toBe('qs-slip');
        return cell.textContent;
      }),
    );
  }

  function numbered(n) {
    var items = [];
    for (var i = 1; i <= n; i++) items.push({ label: 'Item ' + i });
    return items;
  }

  function roster(n) {
    var students = [];
    var codes = [];
    for (var i = 0; i < n; i++) {
      var last = String.fromCharCode(65 + (i % 26)) + (i >= 26 ? 'z' : '');
      students.push({ id: 'e' + i, firstName: 'Student', lastName: last });
      codes.push({ enrollment_id: 'e' + i, code: 'AAA-' + (200 + i) });
    }
    return { students, codes };
  }

  describe('the print sheet: sheetPages', () => {
    it.each([0, 1, 7, 8, 9, 16, 17, 27])('lays %i items out eight to a page, in order', n => {
      var pages = layout(QrSlips.sheetPages(numbered(n), item => esc(item.label)));
      expect(pages).toHaveLength(Math.ceil(n / 8));
      pages.forEach((cells, p) => {
        expect(cells.length).toBeLessThanOrEqual(8);
        expect(cells.length).toBe(p < pages.length - 1 ? 8 : n - 8 * p);
      });
      expect(pages.flat()).toEqual(numbered(n).map(item => item.label));
    });

    it('puts what renderCell returns inside the cell, one call per item', () => {
      var seen = [];
      var items = numbered(3);
      var html = QrSlips.sheetPages(items, item => {
        seen.push(item);
        return '<b class="mine">' + esc(item.label) + '</b>';
      });
      expect(seen).toEqual(items);
      expect(html).toBe(
        '<div class="qs-page">' +
          '<div class="qs-slip"><b class="mine">Item 1</b></div>' +
          '<div class="qs-slip"><b class="mine">Item 2</b></div>' +
          '<div class="qs-slip"><b class="mine">Item 3</b></div>' +
          '</div>',
      );
    });
  });

  describe('the print sheet: slips are drawn through it', () => {
    it.each([1, 8, 9, 27])('%i slips fill the same pages and cells as the sheet lays out', n => {
      var r = roster(n);
      var slips = QrSlips.buildSlips(r.students, r.codes, 'https://fullvision.ca');
      expect(slips).toHaveLength(n);
      var asSlips = parse(QrSlips.buildPages(slips, { title: 'About Me' }, 'Science 8', () => ''));
      var asSheet = layout(QrSlips.sheetPages(slips, s => esc(s.name)));
      var names = Array.from(asSlips.querySelectorAll('.qs-page')).map(page =>
        Array.from(page.children).map(cell => {
          expect(cell.className).toBe('qs-slip');
          expect(cell.querySelectorAll('.qs-name')).toHaveLength(1);
          return cell.querySelector('.qs-name').textContent;
        }),
      );
      expect(names).toEqual(asSheet);
      expect(names).toHaveLength(Math.ceil(n / 8));
    });
  });

  describe('the print sheet: printSheet', () => {
    var doc, orig;

    beforeEach(() => {
      doc = parseHTML('<!doctype html><html><head></head><body><main id="app"></main></body></html>').document;
      orig = {
        document: globalThis.document,
        print: window.print,
        getStudents: globalThis.getStudents,
        origin: location.origin,
        add: window.addEventListener,
        remove: window.removeEventListener,
      };
      globalThis.document = doc;
      location.origin = 'https://fullvision.ca';
      // printThen (ui.js) cleans up on afterprint or on the next tick.
      window.addEventListener = () => {};
      window.removeEventListener = () => {};
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
      globalThis.document = orig.document;
      window.print = orig.print;
      globalThis.getStudents = orig.getStudents;
      location.origin = orig.origin;
      window.addEventListener = orig.add;
      window.removeEventListener = orig.remove;
    });

    /* What is on the page while the print dialog is open. */
    function whilePrinting(run) {
      var shot = null;
      window.print = () => {
        var root = doc.getElementById('qr-slips-root');
        var style = doc.getElementById('qr-slips-page');
        shot = {
          html: root.innerHTML,
          roots: doc.querySelectorAll('#qr-slips-root').length,
          active: doc.body.classList.contains('qr-slips-active'),
          pageRule: style ? style.textContent : '',
        };
      };
      var returned = run();
      return { shot, returned };
    }

    it('prints the sheet as letter pages with a quarter-inch margin, then takes it off the page', () => {
      var items = numbered(9);
      var cell = item => esc(item.label);
      var { shot } = whilePrinting(() => QrSlips.printSheet(items, cell));
      expect(shot.html).toBe(QrSlips.sheetPages(items, cell));
      expect(shot.active).toBe(true);
      expect(shot.pageRule).toBe(printPageCss('letter portrait', '0.25in'));
      vi.runAllTimers();
      expect(doc.getElementById('qr-slips-root').innerHTML).toBe('');
      expect(doc.getElementById('qr-slips-page')).toBe(null);
      expect(doc.body.classList.contains('qr-slips-active')).toBe(false);

      // A second sheet reuses the same root.
      var again = whilePrinting(() => QrSlips.printSheet(numbered(2), cell));
      expect(again.shot.roots).toBe(1);
      expect(layout(again.shot.html)).toEqual([['Item 1', 'Item 2']]);
      vi.runAllTimers();
    });

    it('QrSlips.print sends the slips through it and returns how many', () => {
      var r = roster(9);
      globalThis.getStudents = () => r.students;
      var q = { title: 'About Me', closes_on: '2026-11-14' };
      var { shot, returned } = whilePrinting(() => QrSlips.print('no-such-course', q, r.codes));
      expect(returned).toBe(9);
      // Read back from the page, so compared as the page writes it (<rect/> comes back <rect></rect>).
      var built = QrSlips.buildPages(QrSlips.buildSlips(r.students, r.codes), q, '');
      expect(shot.html).toBe(parse(built).innerHTML);
      expect(parse(shot.html).querySelectorAll('.qs-page')).toHaveLength(2);
      expect(parse(shot.html).querySelectorAll('.qs-slip .qs-qr svg')).toHaveLength(9);
      vi.runAllTimers();
      expect(doc.getElementById('qr-slips-root').innerHTML).toBe('');

      // Nothing to print: no dialog.
      var none = whilePrinting(() => QrSlips.print('no-such-course', q, []));
      expect(none.returned).toBe(0);
      expect(none.shot).toBe(null);
    });
  });
});
