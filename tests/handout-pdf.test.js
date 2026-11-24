/**
 * shared/handout-pdf.js: one PDF file from a handout's JPEG pages, and
 * shared/handout-out.js's file name. The PDF is parsed back enough to check
 * the header, the page count, the xref offsets, the page sizes, and that
 * every JPEG's bytes sit in it unchanged. Print and Save to Phone in a real
 * browser are in e2e/student-handout-out.spec.js.
 */
import { readFileSync } from 'node:fs';
import { runInThisContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

runInThisContext(readFileSync(new URL('../shared/handout-pdf.js', import.meta.url), 'utf-8'), {
  filename: 'shared/handout-pdf.js',
});
runInThisContext(readFileSync(new URL('../shared/handout-out.js', import.meta.url), 'utf-8'), {
  filename: 'shared/handout-out.js',
});
const Pdf = window.HandoutPdf;

// A JPEG's real parts around bytes of no meaning: start, a header, a frame of w × h, a scan, end.
function jpeg(w, h, comps = 3, filler = 40) {
  const body = [];
  for (let i = 0; i < filler; i++) body.push((i * 37 + w) & 0x7f);
  const frame = [0xff, 0xc0, 0x00, 8 + comps * 3, 8, h >> 8, h & 255, w >> 8, w & 255, comps];
  for (let c = 0; c < comps; c++) frame.push(c + 1, 0x11, 0);
  return new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xe0,
    0x00,
    0x04,
    0x4a,
    0x46,
    ...frame,
    0xff,
    0xda,
    0x00,
    0x02,
    ...body,
    0xff,
    0xd9,
  ]);
}
const text = bytes => Buffer.from(bytes).toString('latin1');
const find = (hay, needle) => Buffer.from(hay).indexOf(Buffer.from(needle));

describe('HandoutPdf.jpegInfo', () => {
  it('reads the size and colour parts', () => {
    expect(Pdf.jpegInfo(jpeg(1500, 2000))).toEqual({ width: 1500, height: 2000, components: 3 });
    expect(Pdf.jpegInfo(jpeg(10, 20, 1))).toEqual({ width: 10, height: 20, components: 1 });
  });
  it('refuses what it cannot hold as it is', () => {
    expect(Pdf.jpegInfo(new Uint8Array([1, 2, 3, 4, 5]))).toBeNull();
    expect(Pdf.jpegInfo(jpeg(10, 20, 4))).toBeNull();
    expect(Pdf.jpegInfo(null)).toBeNull();
  });
});

describe('HandoutPdf.build', () => {
  const pictures = [jpeg(1500, 2000), jpeg(2000, 1500, 3, 90), jpeg(800, 800, 1, 7)];
  const pages = pictures.map(b => ({ bytes: b, ...Pdf.jpegInfo(b) }));
  const pdf = Pdf.build(pages);

  it('starts and ends as a PDF', () => {
    expect(text(pdf.slice(0, 8))).toBe('%PDF-1.4');
    expect(text(pdf.slice(-6))).toBe('%%EOF\n');
  });

  it('has one page object per picture, sized to its shape with the long side 792', () => {
    const s = text(pdf);
    expect(s).toContain('/Count 3');
    expect((s.match(/\/Type \/Page /g) || []).length).toBe(3);
    const boxes = [...s.matchAll(/\/MediaBox \[0 0 (\d+) (\d+)\]/g)].map(m => [Number(m[1]), Number(m[2])]);
    expect(boxes).toEqual([
      [594, 792],
      [792, 594],
      [792, 792],
    ]);
  });

  it('keeps every picture inside, byte for byte, with its own size and colour space', () => {
    const s = text(pdf);
    pictures.forEach(p => expect(find(pdf, p)).toBeGreaterThan(0));
    expect(s).toContain('/Width 1500 /Height 2000 /ColorSpace /DeviceRGB');
    expect(s).toContain('/Width 800 /Height 800 /ColorSpace /DeviceGray');
    expect((s.match(/\/Filter \/DCTDecode/g) || []).length).toBe(3);
    expect(s).toContain('/Length ' + pictures[1].length + ' >>');
  });

  it('has an xref table whose offsets land on each object', () => {
    const s = text(pdf);
    const start = Number(/startxref\n(\d+)\n%%EOF/.exec(s)[1]);
    expect(s.slice(start, start + 4)).toBe('xref');
    const count = 3 + 3 * pages.length;
    const lines = s.slice(start).split('\n');
    expect(lines[1]).toBe('0 ' + count);
    expect(lines[2]).toBe('0000000000 65535 f ');
    for (let n = 1; n < count; n++) {
      const entry = lines[2 + n];
      expect(entry).toMatch(/^\d{10} 00000 n $/);
      const at = Number(entry.slice(0, 10));
      expect(s.slice(at, at + String(n).length + 6)).toBe(n + ' 0 obj');
    }
    expect(s).toContain('/Size ' + count + ' /Root 1 0 R');
  });

  it('will not write a page that is not a JPEG, or no pages', () => {
    expect(() => Pdf.build([])).toThrow();
    expect(() => Pdf.build([{ bytes: new Uint8Array([1, 2, 3]) }])).toThrow();
  });
});

describe('HandoutOut.fileName', () => {
  it('cleans the title as Save to Phone does for a book, and ends it .pdf', () => {
    expect(window.HandoutOut.fileName('Density Lab: Part 1 / Notes')).toBe('Density Lab Part 1 Notes.pdf');
    expect(window.HandoutOut.fileName('  ')).toBe('Handout.pdf');
  });
});
