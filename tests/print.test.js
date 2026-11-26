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
   * out as letter pages of eight cells, printSheet prints them, and student
   * cards are drawn through both.
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
  });
});

describe('print-file-names', () => {
  /**
   * Save as PDF names the file from document.title as print() runs, so each
   * print names itself (teacher/ui.js printFileName, setPrintTitle,
   * printThen): what was printed, then the student, class and term.
   */
  const DASH = ' – ';

  describe('the name', () => {
    it('joins the parts with dashes and drops blank ones', () => {
      expect(printFileName(['Progress Report', 'Cece Ahn', '', null, 'Science 8', 'Term 1'])).toBe(
        ['Progress Report', 'Cece Ahn', 'Science 8', 'Term 1'].join(DASH),
      );
    });

    it('takes out characters a file name can’t hold', () => {
      expect(printFileName(['Rubric', 'Lab: Part 1/2 "Cells"?', 'Sci*8 <B>|'])).toBe(
        ['Rubric', 'Lab Part 1 2 Cells', 'Sci 8 B'].join(DASH),
      );
      expect(printFileName(['..Notes.', '\u0007Tab\there'])).toBe('Notes' + DASH + 'Tab here');
    });

    it('keeps a long name to 150 characters, with no dash at its end', () => {
      const n = printFileName(['Rubrics', 'x'.repeat(146), 'Science 8']);
      expect(n.length).toBeLessThanOrEqual(150);
      expect(n).not.toMatch(/[\s–]$/);
    });

    it('gives nothing for nothing', () => {
      expect(printFileName([])).toBe('');
      expect(printFileName(null)).toBe('');
    });

    it('names a class with its block once', () => {
      expect(printClassName({ name: 'Science 8', block: 'B' })).toBe('Science 8 Block B');
      expect(printClassName({ name: 'Science 8 Block B', block: 'B' })).toBe('Science 8 Block B');
      expect(printClassName({ name: 'Science 8' })).toBe('Science 8');
      expect(printClassName(null)).toBe('');
    });
  });

  describe('the title while printing', () => {
    let orig;
    beforeEach(() => {
      orig = { print: window.print, add: window.addEventListener, remove: window.removeEventListener };
      document.title = 'FullVision — Reports';
    });
    afterEach(() => {
      window.print = orig.print;
      window.addEventListener = orig.add;
      window.removeEventListener = orig.remove;
      vi.useRealTimers();
    });

    it('is the file name during print() and the page’s own title after', () => {
      vi.useFakeTimers();
      const listeners = {};
      window.addEventListener = (type, fn) => (listeners[type] = fn);
      window.removeEventListener = type => delete listeners[type];
      let during = null;
      window.print = () => (during = document.title);
      printThen(() => {}, ['Student Cards', 'Science 8']);
      expect(during).toBe('Student Cards' + DASH + 'Science 8');
      listeners.afterprint();
      vi.runAllTimers();
      expect(document.title).toBe('FullVision — Reports');
    });

    it('leaves the title alone with no name, and when the page moved on meanwhile', () => {
      window.print = vi.fn();
      setPrintTitle([])();
      expect(document.title).toBe('FullVision — Reports');
      const restore = setPrintTitle(['Rubric', 'Lab Report']);
      document.title = 'FullVision — Dashboard';
      restore();
      expect(document.title).toBe('FullVision — Dashboard');
    });
  });

  describe('each print’s name', () => {
    const CID = 'pfn-c';
    const roster = [
      { id: 'p1', firstName: 'Cece', lastName: 'Ahn', enrollmentStatus: 'active' },
      { id: 'p2', firstName: 'Dev', lastName: 'Bains', enrollmentStatus: 'active' },
    ];
    let saved;
    beforeEach(() => {
      saved = {
        course: COURSES[CID],
        students: _cache.students[CID],
        assessments: _cache.assessments[CID],
        rubrics: _cache.rubrics[CID],
      };
      COURSES[CID] = { id: CID, name: 'Science 8', block: 'B', gradingSystem: 'proficiency' };
      _cache.students[CID] = roster;
      _cache.assessments[CID] = [
        { id: 'lab', title: 'Lab Report', scoreMode: 'proficiency', rubricId: 'rb', tagIds: [] },
        { id: 'quiz', title: 'Unit Quiz', scoreMode: 'points', maxPoints: 10, tagIds: [] },
      ];
      _cache.rubrics[CID] = [{ id: 'rb', name: 'Lab Rubric', criteria: [] }];
    });
    afterEach(() => {
      COURSES[CID] = saved.course;
      _cache.students[CID] = saved.students;
      _cache.assessments[CID] = saved.assessments;
      _cache.rubrics[CID] = saved.rubrics;
    });

    const rubric = (aid, opts) => printFileName(RubricPrint.printTitle(CID, aid, opts));

    it('a blank rubric: the assessment, else the rubric, and the class', () => {
      expect(rubric('lab', { mode: 'blank' })).toBe(['Rubric', 'Lab Report', 'Science 8 Block B'].join(DASH));
      expect(rubric(null, { mode: 'blank', rubricId: 'rb' })).toBe(
        ['Rubric', 'Lab Rubric', 'Science 8 Block B'].join(DASH),
      );
    });

    it('graded rubrics: plural for the class, the student’s name for one', () => {
      expect(rubric('lab', { mode: 'completed', students: 'all' })).toBe(
        ['Rubrics', 'Lab Report', 'Science 8 Block B'].join(DASH),
      );
      expect(rubric('lab', { mode: 'completed', students: 'pick', picked: ['p1'] })).toBe(
        ['Rubric', 'Cece Ahn', 'Lab Report', 'Science 8 Block B'].join(DASH),
      );
      expect(rubric('quiz', { mode: 'completed', students: 'all' })).toBe(
        ['Score Sheets', 'Unit Quiz', 'Science 8 Block B'].join(DASH),
      );
    });

    it('student cards', () => {
      const items = [{ name: 'Cece Ahn' }, { name: 'Dev Bains' }];
      expect(printFileName(QrSlips.sheetTitle('Student Card', items, '', 'Science 8 Block B'))).toBe(
        ['Student Cards', 'Science 8 Block B'].join(DASH),
      );
      expect(printFileName(QrSlips.sheetTitle('Student Card', items.slice(0, 1), '', 'Science 8 Block B'))).toBe(
        ['Student Card', 'Cece Ahn', 'Science 8 Block B'].join(DASH),
      );
    });

    it('student cards pass their names to the print', () => {
      const slips = readFileSync('teacher/qr-slips.js', 'utf-8');
      expect(slips).toMatch(/\}, titleParts\);/);
      expect(readFileSync('teacher/student-cards.js', 'utf-8')).toMatch(
        /QrSlips\.sheetTitle\('Student Card', items, '', printClassName\(course\)\)/,
      );
    });

    it('the DIBELS sheet names its frame and the page while it prints', () => {
      const src = readFileSync('teacher/assign-dibels.js', 'utf-8');
      const body = src.slice(src.indexOf('function printDibels('), src.indexOf('frame.remove();'));
      expect(body.replace(/\s+/g, ' ')).toContain(
        "printFileName([ a.title || 'DIBELS 8 Benchmark', printClassName(course), DIBELS_PERIOD_NAMES[period], ])",
      );
      expect(body).toContain('esc(fileName)');
      // (the type cast around frame.contentWindow puts a ")" before ".print()")
      expect(body.indexOf('setPrintTitle([fileName])')).toBeLessThan(body.indexOf('contentWindow).print()'));
      expect(body).toContain('restoreTitle();');
    });
  });
});
