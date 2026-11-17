/**
 * A work picture still on its way (shared/work-thumbs.js sets its source
 * once the file arrives) is a plain grey box, not the browser's
 * broken-picture mark with its alt text (Colin, Nov 16). One rule in
 * teacher/styles.css, which the desktop and phone apps both load.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const css = readFileSync(resolve(root, 'teacher/styles.css'), 'utf-8');
const thumbs = readFileSync(resolve(root, 'shared/work-thumbs.js'), 'utf-8');
const wall = readFileSync(resolve(root, 'shared/work-wall.js'), 'utf-8');

describe('a work picture still on its way', () => {
  const at = css.indexOf('img[data-work-pic]:not([src]) {');
  const rule = css.slice(at, css.indexOf('}', at));

  it('draws as a grey box with no broken mark or alt text', () => {
    expect(at).toBeGreaterThan(0);
    expect(rule).toContain("content: url('data:image/gif;base64,");
    expect(rule).toContain('background: #eceef2;');
    expect(rule).toContain('color: transparent;');
    expect(rule).toContain('font-size: 0;');
  });

  it('matches how the pictures are drawn: no source until the file arrives', () => {
    expect(wall).toMatch(/<img class="ww-img" data-work-pic data-aid="/);
    expect(wall).not.toMatch(/data-work-pic[^>]*\bsrc=/);
    expect(thumbs).toContain("img.setAttribute('src', entry.page.url);");
  });
});
