/**
 * The Term Questionnaire's layout (Questionnaire glance plan, step 6), as
 * reports.css sets it: side by side (1281 px and wider) the right column
 * stays in view while the left scrolls and scrolls on its own when taller
 * than the window, and the left column takes the room a hidden student
 * list leaves; at 1280 px and under the columns stack as before. The
 * measured widths and positions are in e2e/questionnaire-observations.spec.js.
 */
import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('teacher/reports.css', 'utf-8');
/* The declarations of one rule inside a media block, as { prop: value }. */
function rule(media, selector) {
  const at = css.indexOf('@media (' + media + ') {\n  ' + selector + ' {');
  if (at < 0) return null;
  const body = css.slice(css.indexOf('{', css.indexOf(selector, at)) + 1, css.indexOf('}', css.indexOf(selector, at)));
  const out = {};
  body
    .split(';')
    .map(s => s.trim())
    .filter(Boolean)
    .forEach(s => {
      const i = s.indexOf(':');
      out[s.slice(0, i).trim()] = s.slice(i + 1).trim();
    });
  return out;
}

describe('the questionnaire’s columns', () => {
  it('pins the right column side by side, scrolling on its own when taller than the window', () => {
    const right = css.slice(css.indexOf('@media (min-width: 1281px) {\n  .qn-left {'));
    expect(right).toContain('.qn-right {');
    const r = rule('min-width: 1281px', '.qn-left');
    expect(r).toMatchObject({ flex: '1 0 470px', width: 'auto', 'min-width': '0' });
    const block = right.slice(right.indexOf('.qn-right {'), right.indexOf('}', right.indexOf('.qn-right {')));
    expect(block).toContain('flex: 0 1 670px;');
    expect(block).toContain('position: sticky;');
    expect(block).toContain('top: 0;');
    expect(block).toContain('align-self: flex-start;');
    expect(block).toContain('max-height: calc(100vh - var(--dock-h) - 53px - 36px);');
    expect(block).toContain('overflow-y: auto;');
    expect(block).toContain('padding: 0 4px 6px;');
    expect(block).toContain('margin: 0 -4px;');
  });

  it('still stacks the columns at 1280 px and under', () => {
    expect(rule('max-width: 1280px', '.qn')).toMatchObject({ 'flex-direction': 'column', 'align-items': 'stretch' });
  });
});
