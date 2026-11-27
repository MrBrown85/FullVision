/**
 * The Student Page on a printed report (teacher/report-student-page.js;
 * DECISIONS, "The Student Page on a printed report", 2026-11-27): a QR code
 * in the letterhead, or a part of its own. The code opens the page's
 * address only, never a card's code. Both show only where the class's
 * Student Page is on, and both are off until a teacher turns them on.
 * Drawn for Demo Mode's Science 8.
 */
import './setup.js';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { runInThisContext } from 'vm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FROZEN_AT, loadDemoClass } from './helpers/golden-grades.js';

runInThisContext(readFileSync('teacher/report-one.js', 'utf-8'), { filename: 'teacher/report-one.js' });

const require = createRequire(import.meta.url);
const qrcode = require('../vendor/qrcode.js');
const jsQR = require('../vendor/jsqr/jsQR.js');

/* The matrix as an image, `px` pixels to a square, with four squares of
   white round it, as a phone camera would see it printed. */
function picture(matrix, px) {
  const n = matrix.length + 8;
  const w = n * px;
  const data = new Uint8ClampedArray(w * w * 4).fill(255);
  matrix.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (row[x] !== '1') continue;
      for (let dy = 0; dy < px; dy++)
        for (let dx = 0; dx < px; dx++) {
          const i = (((y + 4) * px + dy) * w + (x + 4) * px + dx) * 4;
          data[i] = data[i + 1] = data[i + 2] = 0;
        }
    }
  });
  return { data, w };
}

describe('the Student Page on a printed report', { timeout: 60000 }, () => {
  let cid, students, ctx, pageOn;
  const draw = (id, st, options) => ReportBlocks.renderReportBlock(id, cid, st, ctx, options);

  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(FROZEN_AT));
    cid = loadDemoClass();
    students = sortStudents(getStudents(cid), 'lastName');
    ctx = { termId: 'term-1', termLabel: 'Report 1' };
  }, 60000);
  beforeEach(() => {
    pageOn = true;
    vi.spyOn(globalThis, 'getReturnSettings').mockImplementation(() => ({
      student_page: pageOn,
      return_grades: 'on_save',
    }));
  });
  afterAll(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    localStorage.clear();
  });

  describe('the code', () => {
    it('is the one vendor/qrcode.js makes for HTTPS://FULLVISION.CA/S', () => {
      const q = qrcode(0, 'L');
      q.addData('HTTPS://FULLVISION.CA/S', 'Alphanumeric');
      q.make();
      const n = q.getModuleCount();
      const rows = [];
      for (let r = 0; r < n; r++) {
        let s = '';
        for (let c = 0; c < n; c++) s += q.isDark(r, c) ? '1' : '0';
        rows.push(s);
      }
      expect(ReportStudentPage.MATRIX).toEqual(rows);
      expect(n).toBe(21);
    });

    it('reads back as the address and nothing else', () => {
      const { data, w } = picture(ReportStudentPage.MATRIX, 6);
      const read = jsQR(data, w, w);
      expect(read && read.data).toBe('HTTPS://FULLVISION.CA/S');
    });

    it('draws every dark square once, with a square of white round it', () => {
      const svg = ReportStudentPage.svg();
      const dark = ReportStudentPage.MATRIX.join('').split('1').length - 1;
      expect(svg).toContain('viewBox="0 0 23 23"');
      expect(svg.split('h1v1h-1z').length - 1).toBe(dark);
      expect(svg).toContain('M1,1h1v1h-1z');
    });
  });

  describe('in the letterhead', () => {
    it('prints as before until it is turned on', () => {
      const st = students[0];
      expect(draw('header', st, {})).toBe(draw('header', st, { studentPage: false }));
      expect(draw('header', st, {})).not.toContain('report-code-qr');
    });

    it('prints the code beside the details when on', () => {
      const st = students[0];
      const html = draw('header', st, { studentPage: true });
      expect(html).toContain('report-header-code');
      expect(html).toContain('report-code-qr');
      expect(html).toContain('fullvision.ca/s');
      expect(html).toContain(printedStudentName(st));
      expect(html).toContain('Student No.');
    });

    it('keeps the letterhead’s other choices', () => {
      const st = students.find(s => s.studentNumber);
      const html = draw('header', st, { studentPage: true, studentNumber: false });
      expect(html).not.toContain('Student No.');
    });

    it('prints no code where the class’s Student Page is off', () => {
      pageOn = false;
      const st = students[0];
      expect(draw('header', st, { studentPage: true })).toBe(draw('header', st, {}));
    });
  });

  describe('as a part', () => {
    it('gives the code, the three steps and the card’s last day', () => {
      const st = students.find(s => s.dateOfBirth || s.studentNumber);
      const html = draw('student-page', st, {});
      expect(html).toContain('Your Student Page');
      expect(html).toContain('report-code-qr');
      expect(html).toContain('Scan or type the code on your Student Card.');
      expect(html).toContain('Enter your birthday or your student number.');
      expect(html).toMatch(/Works until [A-Z][a-z]{2} \d{1,2}, \d{4}/);
    });

    it('sends a student with no birthday or number to their card’s password', () => {
      const st = Object.assign({}, students[0], { dateOfBirth: '', studentNumber: '' });
      expect(draw('student-page', st, {})).toContain('Enter the password on your Student Card.');
    });

    it('carries no card code and no student’s words', () => {
      const html = draw('student-page', students[0], {});
      expect(html).not.toMatch(/[A-Z0-9]{4}-[A-Z0-9]{4}/);
      expect(html).not.toContain(students[0].firstName);
    });

    it('prints nothing where the class’s Student Page is off', () => {
      pageOn = false;
      expect(draw('student-page', students[0], {})).toBe('');
    });
  });

  describe('in One Report', () => {
    it('is offered only where the class’s Student Page is on', () => {
      const m = ReportOne.fromSetup('report-card');
      expect(ReportOne.available('student-page', cid)).toBe(true);
      expect(ReportOne.optionsFor(m, 'header', cid).map(o => o.key)).toContain('studentPage');
      pageOn = false;
      expect(ReportOne.available('student-page', cid)).toBe(false);
      expect(ReportOne.optionsFor(m, 'header', cid).map(o => o.key)).not.toContain('studentPage');
    });

    it('is off in every Setup', () => {
      ReportOne.SETUPS.forEach(s => {
        const m = ReportOne.fromSetup(s.id);
        expect(m.parts).not.toContain('student-page');
        const code = ReportOne.optionsFor(m, 'header', cid).find(o => o.key === 'studentPage');
        expect(code && code.value).toBe(false);
      });
    });

    it('goes in before the Parent / Guardian Response when switched on', () => {
      const m = ReportOne.fromSetup('report-card');
      expect(ReportOne.offParts(m, cid)).toContain('student-page');
      const parts = ReportOne.order(ReportOne.setOn(m, 'student-page', true));
      expect(parts.indexOf('student-page')).toBe(parts.indexOf('parent-response') - 1);
    });
  });
});
