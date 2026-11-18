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

  /* The `:root` block inside `@media (prefers-color-scheme: dark)`, and the
     `:root` block before it. */
  const darkAt = styles.indexOf('@media (prefers-color-scheme: dark) {\n  :root {');
  const darkEnd = styles.indexOf('\n  }\n', darkAt);
  const dark = styles.slice(darkAt, darkEnd);
  const light = styles.slice(0, darkAt);
  const one = (css, name) => {
    const found = tokens(css, name);
    expect(found.length, `${name} declared once here`).toBe(1);
    return found[0];
  };

  it('teacher app: --active-fill and the hover blue pass 4.5:1 under white, in light and in the dark block', () => {
    expect(darkAt).toBeGreaterThan(0);
    for (const name of ['--active-fill', '--btn-hover-blue']) {
      for (const [mode, css] of [
        ['light', light],
        ['dark', dark],
      ]) {
        const hex = one(css, name);
        expect(whiteOn(hex), `${mode} ${name} ${hex}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('the hover blue reads as a different state from the fill (at least 1.25:1 apart)', () => {
    for (const css of [light, dark]) {
      const [a, b] = [lum(one(css, '--active-fill')), lum(one(css, '--btn-hover-blue'))].sort((x, y) => y - x);
      expect((a + 0.05) / (b + 0.05)).toBeGreaterThanOrEqual(1.25);
    }
  });

  it('the dark fill is at least 3:1 against the dark surface, so a chosen pill stands out', () => {
    const fill = one(dark, '--active-fill');
    const surface = one(dark, '--surface');
    const [a, b] = [lum(fill), lum(surface)].sort((x, y) => y - x);
    expect((a + 0.05) / (b + 0.05)).toBeGreaterThanOrEqual(3.0);
  });

  it('the Dashboard Inbox buttons put no white on the bare --active blue', () => {
    // Board A draws Grade Submissions as a ghost button in the link colour and
    // +N as a white label, so neither is white on blue now; any rule for them
    // that does put white text on a blue fill must use the fill token.
    const css = read('teacher/dash-inbox.css');
    for (const sel of ['dash-inbox-new', 'dash-inbox-grade']) {
      const rules = css.match(new RegExp(`\\.${sel}\\s*\\{[^}]*\\}`, 'g')) || [];
      expect(rules.length, sel).toBeGreaterThan(0);
      for (const r of rules) {
        expect(r, sel).not.toMatch(/background:\s*var\(--active\)\s*;/);
        if (/color:\s*#fff/.test(r)) expect(r, sel).toMatch(/background:\s*var\(--active-fill\)/);
      }
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
