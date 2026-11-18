import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/* White words on the app's blue fills are at least 4.5:1 (WCAG AA). Reads the
   token values out of the stylesheets so a lighter blue cannot slip back in. */

const root = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

const lin = c => {
  c /= 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const lum = hex => {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
};
const whiteOn = hex => 1.05 / (lum(hex) + 0.05);

/* The value of `--name: #hex` in the nth place it is declared. */
function tokens(css, name) {
  const re = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})\\b`, 'g');
  return [...css.matchAll(re)].map(m => m[1]);
}

describe('white on the primary blue fill', () => {
  const styles = read('teacher/styles.css');

  it('teacher app: --active-fill (light and dark) and the hover blue pass 4.5:1', () => {
    for (const name of ['--active-fill', '--btn-hover-blue']) {
      const found = tokens(styles, name);
      expect(found.length, `${name} is declared for light and dark`).toBe(2);
      for (const hex of found) expect(whiteOn(hex), `${name} ${hex}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('student page: --sp-blue-fill passes 4.5:1 in both stylesheets that define it', () => {
    for (const f of ['s/student.css', 's/page-view.css']) {
      const found = tokens(read(f), '--sp-blue-fill');
      expect(found.length, f).toBe(1);
      expect(whiteOn(found[0]), `${f} ${found[0]}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('the plain primary buttons use the fill token, not --active', () => {
    expect(styles).toMatch(/\.btn-primary\s*\{[^}]*background:\s*var\(--active-fill\)/);
    expect(read('login.css')).toMatch(/\.auth-submit\s*\{[^}]*background:\s*var\(--active-fill\)/);
    expect(read('s/student.css')).toMatch(/\.sp-btn-primary\s*\{[^}]*background:\s*var\(--sp-blue-fill\)/);
  });
});
