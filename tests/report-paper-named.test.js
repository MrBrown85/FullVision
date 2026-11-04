/**
 * Report sheets name the paper ("legal portrait") rather than giving inches,
 * so the print dialog picks the Legal tray instead of shrinking the sheet
 * onto Letter, as the class grade sheet already does (DECISIONS "Printed
 * class grade sheet" 11; step 4 group 2 #7).
 */
import './setup.js';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';

describe('report sheet @page size', () => {
  it('names Letter and Legal with portrait', () => {
    expect(ReportSheets.paperSize('letter')).toBe('letter portrait');
    expect(ReportSheets.paperSize('legal')).toBe('legal portrait');
    expect(ReportSheets.paperSize('nonsense')).toBe('letter portrait');
  });

  it('no report print rule gives the paper in inches', () => {
    ['teacher/report-sheets.js', 'teacher/page-reports.js'].forEach(f => {
      const src = readFileSync(f, 'utf8');
      expect(src).not.toMatch(/8\.5in 1[14]in/);
    });
  });
});
