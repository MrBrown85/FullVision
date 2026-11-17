/**
 * The printed sticker sheet (teacher/scan-labels.js, B4): 80 stickers on a
 * letter page where Avery 5167 puts its labels, each with the QR code, the
 * student's first name and last initial, and the class. Every name goes in
 * through esc.
 */
import './setup.js';
import { readFileSync } from 'fs';
import { resolve as resolvePath } from 'path';
import { runInThisContext } from 'vm';
import { describe, expect, it } from 'vitest';

runInThisContext(readFileSync(resolvePath(import.meta.dirname, '..', 'teacher/scan-labels.js'), 'utf-8'), {
  filename: 'teacher/scan-labels.js',
});

describe('the sticker sheet', () => {
  const html = ScanLabels.sheetHtml('Jas B.', 'Socials 10 · C', 'K7M4QX2PABCD', false);

  it('holds 80 stickers, four across and twenty down, at the Avery 5167 positions', () => {
    const cells = [
      ...html.matchAll(/class="sl-cell" style="left:([\d.]+)in;top:([\d.]+)in;width:1.75in;height:0.5in"/g),
    ];
    expect(cells).toHaveLength(80);
    const lefts = [...new Set(cells.map(m => Number(m[1])))];
    const tops = [...new Set(cells.map(m => Number(m[2])))];
    expect(lefts).toEqual([0.28125, 2.34375, 4.40625, 6.46875]);
    expect(tops).toHaveLength(20);
    expect(tops[0]).toBe(0.5);
    expect(tops[19]).toBe(10);
    // The last column ends 0.28125 inches from the right edge of an 8.5 inch page.
    expect(lefts[3] + 1.75).toBeCloseTo(8.5 - 0.28125, 6);
  });

  it('each sticker has the QR, the name and the class', () => {
    expect(html.match(/<svg class="sl-qr" viewBox="0 0 21 21"/g)).toHaveLength(80);
    expect(html.match(/<div class="sl-name">Jas B\.<\/div>/g)).toHaveLength(80);
    expect(html.match(/<div class="sl-class">Socials 10 · C<\/div>/g)).toHaveLength(80);
  });

  it('plain paper draws the same page with cut lines', () => {
    expect(ScanLabels.sheetHtml('A', 'B', 'K7M4QX2PABCD', true)).toMatch(/^<div class="sl-sheet sl-plain">/);
    expect(html).toMatch(/^<div class="sl-sheet">/);
  });

  it('escapes a name and a class', () => {
    const odd = ScanLabels.stickerHtml('<b>Jo</b>', 'A & B', '');
    expect(odd).toContain('&lt;b&gt;Jo&lt;/b&gt;');
    expect(odd).toContain('A &amp; B');
  });

  it('a sticker says the first name and last initial, and the class with its block', () => {
    expect(ScanLabels.stickerName({ firstName: 'Jasleen', preferred: 'Jas', lastName: 'bains' })).toBe('Jas B.');
    expect(ScanLabels.stickerName({ firstName: 'Noor', lastName: '' })).toBe('Noor');
    expect(ScanLabels.shortClass({ name: 'Socials 10', block: 'C' })).toBe('Socials 10 · C');
    expect(ScanLabels.shortClass({ name: 'Science 8' })).toBe('Science 8');
  });

  it('the QR is version 1, level Q, holding FVS and the code', () => {
    const qr = qrcode(1, 'Q');
    qr.addData('FVSK7M4QX2PABCD', 'Alphanumeric');
    qr.make();
    expect(qr.getModuleCount()).toBe(21);
    const dark = [];
    for (let r = 0; r < 21; r++) for (let c = 0; c < 21; c++) if (qr.isDark(r, c)) dark.push('M' + c + ' ' + r);
    const svg = ScanLabels.qrSvg('K7M4QX2PABCD');
    expect(svg.match(/M\d+ \d+/g)).toEqual(dark);
  });
});
