/**
 * The phone's bars are solid, not blurred (speed, P8).
 *
 * The tab bar, the nav bar, the grader's student strip and the piece tabs
 * each had a 20px backdrop blur over the content. A blur is drawn again on
 * every frame the content under it moves, the costliest thing on an old
 * phone while the swiper slides. They are solid --surface now, the colour
 * the 82% glass gave over the page, in light and dark.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(resolve(root, 'teacher-mobile/styles.css'), 'utf-8');

// The declarations of the first rule whose selector list is exactly `selector`.
function rule(selector) {
  const at = css.search(new RegExp('(^|\\n)' + selector.replace(/[.#]/g, '\\$&') + '\\s*\\{'));
  expect(at, selector + ' is in teacher-mobile/styles.css').toBeGreaterThanOrEqual(0);
  const open = css.indexOf('{', at);
  return css.slice(open + 1, css.indexOf('}', open));
}

describe('phone bars: solid, no blur', () => {
  for (const selector of ['#m-tab-bar', '.m-nav-bar', '.m-thumb-strip', '.m-work-tabs']) {
    it(selector + ' has a solid surface and no backdrop blur', () => {
      const body = rule(selector);
      expect(body).not.toMatch(/backdrop-filter/);
      expect(body).toMatch(/background:\s*var\(--surface\);/);
    });
  }

  it('no backdrop blur is left in the phone stylesheet', () => {
    expect(css).not.toMatch(/backdrop-filter/);
  });
});
