/**
 * The grader's cards away from the screen are not laid out or painted
 * (docs/plans/speed-assessment.md, section 7, P4). The browser does it from
 * one rule in teacher-mobile/styles.css; e2e/mobile-grade-card-visibility
 * counts the cards it skips and checks the scroll a card keeps. This pins
 * the rule where it must be: on the card's surface, not on the card, which
 * is the scroller (a skipped scroller loses the scroll a redraw gives it).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';

const css = readFileSync(new URL('../teacher-mobile/styles.css', import.meta.url), 'utf-8');

function rule(selector) {
  const at = css.indexOf('\n' + selector + ' {');
  if (at < 0) return null;
  return css.slice(at, css.indexOf('}', at));
}

describe('the grader’s cards off screen', () => {
  it('a card’s surface is skipped while away from the screen, taken as tall until drawn', () => {
    const surface = rule('.m-swiper-card > .m-grade-card-surface');
    expect(surface).not.toBeNull();
    expect(surface).toMatch(/content-visibility:\s*auto;/);
    expect(surface).toMatch(/contain-intrinsic-height:\s*auto \d{4,}px;/);
  });

  it('the card itself, the scroller, is never skipped', () => {
    const card = rule('.m-swiper-card');
    expect(card).not.toBeNull();
    expect(card).not.toMatch(/content-visibility/);
  });
});
