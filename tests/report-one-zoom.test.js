/**
 * Progress Reports' zoom (teacher/report-one-zoom.js): the maths that
 * decides how large a student's sides are drawn and how many sit in a row.
 * Pure functions, swept across pane widths from a phone to a wide monitor.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { runInThisContext } from 'vm';
import { describe, expect, it } from 'vitest';

globalThis.window = globalThis.window || globalThis;
runInThisContext(readFileSync(resolve(__dirname, '../teacher/report-one-zoom.js'), 'utf-8'), {
  filename: 'teacher/report-one-zoom.js',
});
const Z = window.ReportOneZoom;
const { GAP, PAIR_PAD, ROW_GAP, LABEL, MIN, MAX } = Z.GEOM;

// The canvas pads 24 px a side; the preview is 22 px over and 40 px under.
const PAD_X = 48;
const PAD_Y = 62;
const PAPERS = ['letter', 'legal'];

// A browser lays a width out to 1/64 px, to the nearest: a row as wide as
// the browser could make it.
const up64 = v => Math.ceil(v * 64) / 64;
function laidRow(n, z, paper) {
  const w = up64(Z.PAPER[paper].w * z + (n > 1 ? PAIR_PAD : 0));
  return n * w + (n - 1) * GAP;
}
function rowsHeight(r, z, paper) {
  return r * (Z.PAPER[paper].h * z + LABEL) + (r - 1) * ROW_GAP;
}
function box(width, height, paper, sides) {
  return { width: width - PAD_X, height: height - PAD_Y, paper, sides };
}

// The maths on main before this change, kept to show the bug it had.
function oldOneZoom(canvasWidth) {
  const sheetW = 8.5 * 96;
  const two = (canvasWidth - 48 - 22) / (2 * sheetW);
  if (two >= 0.75) return { zoom: Math.round(Math.min(1, two) * 1000) / 1000, stacked: false };
  const one = Math.min(1, Math.max(0.3, (canvasWidth - 48) / sheetW));
  return { zoom: Math.round(one * 1000) / 1000, stacked: true };
}

describe('Automatic', () => {
  it('on main, rounding up made two sides wider than a 1,385 px pane', () => {
    const z = oldOneZoom(1385).zoom;
    expect(z).toBe(0.806);
    expect(2 * 816 * z + 22).toBeGreaterThan(1385 - 48);
  });

  it('never makes a row wider than the pane, 320 to 2,400 px, 1 to 6 sides, both papers', () => {
    const bad = [];
    for (const paper of PAPERS) {
      for (let sides = 1; sides <= 6; sides++) {
        for (let w = 320; w <= 2400; w++) {
          const b = box(w, 1000, paper, sides);
          const z = Z.zoomFor('auto', b);
          const cols = Z.columns(z, b);
          if (cols > 1 && laidRow(cols, z, paper) > b.width) bad.push([paper, sides, w, z, cols]);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('puts the two sides of a sheet side by side at 1,385 px and on wider panes', () => {
    for (const paper of PAPERS) {
      for (let w = 1385; w <= 2400; w += 5) {
        const b = box(w, 1000, paper, 4);
        expect(Z.columns(Z.zoomFor('auto', b), b), String(w)).toBeGreaterThanOrEqual(2);
      }
      const at = box(1385, 1000, paper, 4);
      expect(Z.zoomFor('auto', at)).toBeCloseTo(0.805, 3);
    }
  });

  it('shows one side at up to full size where two do not fit at three quarters', () => {
    const b = box(1000, 1000, 'letter', 2);
    expect(Z.columns(Z.zoomFor('auto', b), b)).toBe(1);
    expect(Z.zoomFor('auto', box(3000, 1000, 'letter', 2))).toBe(1);
  });
});

describe('the fit choices fit what they say', () => {
  it('Fit Width: one side as wide as the pane', () => {
    for (const paper of PAPERS) {
      for (let w = 320; w <= 2400; w++) {
        const b = box(w, 900, paper, 2);
        const z = Z.zoomFor('width', b);
        const want = (b.width - 1) / 816;
        if (want >= MIN && want <= MAX) {
          expect(laidRow(1, z, paper)).toBeLessThanOrEqual(b.width);
          expect(b.width - 816 * z).toBeLessThan(3);
        }
      }
    }
  });

  it('Whole Page: a whole side, label and all, without scrolling', () => {
    for (const paper of PAPERS) {
      for (let h = 500; h <= 1600; h += 7) {
        for (const w of [600, 1000, 1385, 2000]) {
          const b = box(w, h, paper, 4);
          const z = Z.zoomFor('page', b);
          if (z <= MIN) continue;
          expect(rowsHeight(1, z, paper), `${paper} ${w}x${h}`).toBeLessThanOrEqual(b.height);
          expect(laidRow(1, z, paper)).toBeLessThanOrEqual(b.width);
        }
      }
    }
  });

  it('All Pages: every side inside the pane, in as many rows as that takes', () => {
    const bad = [];
    for (const paper of PAPERS) {
      for (let sides = 1; sides <= 6; sides++) {
        for (let w = 320; w <= 2400; w += 3) {
          for (const h of [600, 800, 1038, 1300]) {
            const b = box(w, h, paper, sides);
            const z = Z.zoomFor('all', b);
            if (z <= MIN) continue;
            const cols = Z.columns(z, b);
            const rows = Math.ceil(sides / cols);
            if (laidRow(cols, z, paper) > b.width || rowsHeight(rows, z, paper) > b.height) {
              bad.push([paper, sides, w, h, z, cols]);
            }
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('All Pages is never smaller than one side per row would be', () => {
    const b = box(1385, 1038, 'legal', 4);
    const z = Z.zoomFor('all', b);
    expect(Z.columns(z, b)).toBe(4);
    expect(z).toBeGreaterThan(0.3);
  });

  it('a percent is that scale', () => {
    expect(Z.zoomFor(125, box(900, 900, 'letter', 2))).toBe(1.25);
    expect(Z.zoomFor(50, box(2400, 900, 'legal', 2))).toBe(0.5);
  });
});

describe('a sheet’s front and back share a row', () => {
  it('a row never holds a back without its front, 1 to 6 sides, every width and zoom', () => {
    const bad = [];
    for (const paper of PAPERS) {
      for (let sides = 1; sides <= 6; sides++) {
        for (let w = 320; w <= 2400; w += 2) {
          const choices = ['auto', 'width', 'page', 'all', 30, 50, 75, 100];
          for (const c of choices) {
            const b = box(w, 1038, paper, sides);
            const cols = Z.columns(Z.zoomFor(c, b), b);
            // Side s sits in column s % cols: a back (odd s) opening a row is a split sheet.
            for (let s = 1; s < sides; s += 2) if (cols > 1 && s % cols === 0) bad.push([paper, sides, w, c, cols]);
            if (cols !== 1 && cols % 2) bad.push([paper, sides, w, c, cols]);
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('a sheet’s two sides are closer than two sheets', () => {
    // 8 px within a sheet; 7 + 8 + 7 between sheets.
    expect(GAP).toBeLessThan(GAP + 2 * PAIR_PAD);
    expect(GAP + 2 * PAIR_PAD).toBe(22);
  });

  it('stacks one side per row when only one fits', () => {
    const b = box(700, 900, 'letter', 4);
    expect(Z.columns(Z.zoomFor(100, b), b)).toBe(1);
  });
});

describe('Zoom Out and Zoom In', () => {
  it('step through 50, 60, 75, 90, 100, 125 and 150 from wherever the scale is', () => {
    expect(Z.step(1, 1)).toBe(125);
    expect(Z.step(1, -1)).toBe(90);
    expect(Z.step(0.805, 1)).toBe(90);
    expect(Z.step(0.805, -1)).toBe(75);
    expect(Z.step(0.75, -1)).toBe(60);
    expect(Z.step(0.6, -1)).toBe(50);
  });

  it('turn a fit choice into a percent', () => {
    const b = box(1385, 1038, 'legal', 4);
    const fit = Z.zoomFor('all', b);
    const p = Z.step(fit, -1);
    expect(typeof p).toBe('number');
    expect(p / 100).toBeLessThan(fit);
    expect(Z.zoomFor(p, b)).toBe(p / 100);
  });

  it('stop at 30% and 150%, where the button is disabled', () => {
    expect(Z.step(0.5, -1)).toBe(30);
    expect(Z.step(0.3, -1)).toBe(30);
    expect(Z.step(1.5, 1)).toBe(150);
    expect(Z.atMin(0.3)).toBe(true);
    expect(Z.atMin(0.5)).toBe(false);
    expect(Z.atMax(1.5)).toBe(true);
    expect(Z.atMax(1.25)).toBe(false);
    expect(Z.zoomFor(10, box(900, 900, 'letter', 2))).toBe(MIN);
  });
});

describe('the choice on this device', () => {
  function memory() {
    const m = new Map();
    return {
      getItem: k => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => m.set(k, String(v)),
      removeItem: k => m.delete(k),
      m,
    };
  }

  it('is read back as it was saved', () => {
    for (const c of ['width', 'page', 'all', 75, 125]) {
      const s = memory();
      Z.saveChoice(c, s);
      expect(Z.readChoice(s)).toBe(c);
    }
    const s = memory();
    Z.saveChoice(80.6, s);
    expect(Z.readChoice(s)).toBe(81);
    Z.saveChoice('auto', s);
    expect(s.m.size).toBe(0);
    expect(Z.readChoice(s)).toBe('auto');
  });

  it('ignores garbage, and works without storage', () => {
    for (const junk of ['', 'zoom', '999', '10', '75.5', '{"a":1}', 'AUTO', '-50']) {
      const s = memory();
      s.setItem('gb-report-zoom-one', junk);
      expect(Z.readChoice(s), junk).toBe('auto');
    }
    const throwing = {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('blocked');
      },
      removeItem() {
        throw new Error('blocked');
      },
    };
    expect(Z.readChoice(throwing)).toBe('auto');
    expect(() => Z.saveChoice(75, throwing)).not.toThrow();
    expect(Z.readChoice(null)).toBe('auto');
  });

  it('names the choice on its button', () => {
    expect(Z.label('auto')).toBe('Automatic');
    expect(Z.label('width')).toBe('Fit Width');
    expect(Z.label('page')).toBe('Whole Page');
    expect(Z.label('all')).toBe('All Pages');
    expect(Z.label(81)).toBe('81%');
  });
});
