/**
 * Routing the BC bank's new competency names (data/bc-curriculum-derived.json)
 * to Comment Bank skills moves no label that routes today. The fixture holds
 * the skill key (or null) for every label in curriculum_by_course.json and
 * every label the comment-bank tests send to skillOf, as main routed them on
 * Nov 1 2026, before this change.
 */
import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

const main = JSON.parse(readFileSync('tests/fixtures/skill-routing-main.json', 'utf-8'));

describe('Comment Bank routing of labels in use today', () => {
  it('sends every label to the same skill as on main, or still to none', () => {
    const moved = [];
    for (const [family, labels] of Object.entries(main))
      for (const [label, key] of Object.entries(labels)) {
        const now = CommentBank.skillOf(family, label);
        if ((now ? now.key : null) !== key) moved.push(`${family}: ${label}: ${key} → ${now ? now.key : null}`);
      }
    expect(moved).toEqual([]);
    expect(Object.values(main).reduce((n, labels) => n + Object.keys(labels).length, 0)).toBeGreaterThan(1700);
  });

  it('matches a bank name only whole, so a longer label is not swept in', () => {
    expect(CommentBank.skillOf('science', 'Hypotheses').key).toBe('questioning');
    expect(CommentBank.skillOf('science', 'Hypotheses and Models')).toBeNull();
    expect(CommentBank.skillOf('arts', 'Dance, Drama & Music').key).toBe('performing');
  });
});
