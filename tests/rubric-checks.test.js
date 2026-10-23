/**
 * The level rule for Advanced Rubrics (shared/rubric-checks.js).
 *
 * The suggested level is the highest level whose boxes are all ticked. A tick
 * writes the suggestion when the current level was unset or came from the
 * boxes; a level the teacher picked by hand stays (Rubric Bank plan §5,
 * decided 2026-10-22).
 */
import './setup.js';
import { describe, expect, it } from 'vitest';

function criterion() {
  return {
    id: 'crit-safety',
    name: 'Safety',
    checks: [
      { id: 'k4a', level: 4, label: 'Reminds others of safety steps', displayOrder: 0 },
      { id: 'k4b', level: 4, label: 'Sets up and cleans without being asked', displayOrder: 1 },
      { id: 'k3a', level: 3, label: 'Goggles on for the whole lab', displayOrder: 0 },
      { id: 'k3b', level: 3, label: 'Handles glassware correctly', displayOrder: 1 },
      { id: 'k3c', level: 3, label: 'Cleans the station', displayOrder: 2 },
      { id: 'k2a', level: 2, label: 'Needs one reminder', displayOrder: 0 },
      { id: 'k1a', level: 1, label: 'Needs several reminders', displayOrder: 0 },
    ],
  };
}

describe('RubricChecks.suggestedLevel', () => {
  it('is 0 with nothing ticked, no checks, or no criterion', () => {
    expect(RubricChecks.suggestedLevel(criterion(), [])).toBe(0);
    expect(RubricChecks.suggestedLevel({ id: 'c', checks: [] }, ['k3a'])).toBe(0);
    expect(RubricChecks.suggestedLevel(null, ['k3a'])).toBe(0);
  });

  it('is the highest level whose boxes are all ticked', () => {
    expect(RubricChecks.suggestedLevel(criterion(), ['k3a', 'k3b', 'k3c'])).toBe(3);
    // Extending complete, Proficient not: Extending wins all the same.
    expect(RubricChecks.suggestedLevel(criterion(), ['k4a', 'k4b', 'k3a'])).toBe(4);
    // Every box ticked: the top.
    expect(RubricChecks.suggestedLevel(criterion(), ['k4a', 'k4b', 'k3a', 'k3b', 'k3c', 'k2a', 'k1a'])).toBe(4);
  });

  it('does not suggest a level with a box still clear', () => {
    expect(RubricChecks.suggestedLevel(criterion(), ['k3a', 'k3b'])).toBe(0);
    expect(RubricChecks.suggestedLevel(criterion(), ['k4a', 'k3a', 'k3b', 'k2a'])).toBe(2);
  });

  it('never suggests a level with no boxes', () => {
    var c = criterion();
    c.checks = c.checks.filter(function (k) {
      return k.level !== 4;
    });
    expect(RubricChecks.suggestedLevel(c, ['k3a', 'k3b', 'k3c'])).toBe(3);
  });

  it('takes a Set or a single id too', () => {
    expect(RubricChecks.suggestedLevel(criterion(), new Set(['k1a']))).toBe(1);
    expect(RubricChecks.suggestedLevel(criterion(), 'k2a')).toBe(2);
  });
});

describe('RubricChecks.levelAfterTick', () => {
  it('writes the suggestion when no level was set', () => {
    expect(RubricChecks.levelAfterTick(criterion(), 0, ['k3a', 'k3b'], ['k3a', 'k3b', 'k3c'])).toBe(3);
    expect(RubricChecks.levelAfterTick(criterion(), null, [], ['k1a'])).toBe(1);
  });

  it('leaves no level when nothing is complete yet', () => {
    expect(RubricChecks.levelAfterTick(criterion(), 0, [], ['k3a'])).toBe(0);
  });

  it('follows the boxes while the level matches what they suggested', () => {
    // Proficient from the boxes, then the last Extending box: Extending.
    expect(
      RubricChecks.levelAfterTick(criterion(), 3, ['k3a', 'k3b', 'k3c', 'k4a'], ['k3a', 'k3b', 'k3c', 'k4a', 'k4b']),
    ).toBe(4);
    // Unticking a Proficient box drops the suggestion: the level goes too.
    expect(RubricChecks.levelAfterTick(criterion(), 3, ['k3a', 'k3b', 'k3c'], ['k3a', 'k3b'])).toBe(0);
    // Unticking down to a lower complete level follows it.
    expect(RubricChecks.levelAfterTick(criterion(), 3, ['k3a', 'k3b', 'k3c', 'k2a'], ['k3a', 'k3b', 'k2a'])).toBe(2);
  });

  it('keeps a level the teacher picked by hand', () => {
    // Boxes said nothing; the teacher chose Developing; a tick completes Proficient.
    expect(RubricChecks.levelAfterTick(criterion(), 2, ['k3a', 'k3b'], ['k3a', 'k3b', 'k3c'])).toBe(2);
    // Boxes said Proficient; the teacher chose Extending; unticking a box.
    expect(RubricChecks.levelAfterTick(criterion(), 4, ['k3a', 'k3b', 'k3c'], ['k3a', 'k3b'])).toBe(4);
  });

  it('treats a string level like a number', () => {
    expect(
      RubricChecks.levelAfterTick(criterion(), '3', ['k3a', 'k3b', 'k3c'], ['k3a', 'k3b', 'k3c', 'k4a', 'k4b']),
    ).toBe(4);
  });
});

describe('RubricChecks counts', () => {
  it('counts ticked boxes against the total', () => {
    expect(RubricChecks.tickedCount(criterion(), ['k3a', 'k4a', 'nope'])).toEqual({ ticked: 2, total: 7 });
    expect(RubricChecks.tickedCount({ checks: [] }, [])).toEqual({ ticked: 0, total: 0 });
  });

  it('lists a level’s boxes in display order', () => {
    var c = criterion();
    c.checks.push({ id: 'k3z', level: 3, label: 'First', displayOrder: -1 });
    expect(
      RubricChecks.checksAt(c, 3).map(function (k) {
        return k.id;
      }),
    ).toEqual(['k3z', 'k3a', 'k3b', 'k3c']);
    expect(RubricChecks.checksAt(c, 2).length).toBe(1);
  });

  it('counts every checkbox in a rubric', () => {
    expect(RubricChecks.countChecks({ criteria: [criterion(), { id: 'x', checks: [] }, { id: 'y' }] })).toBe(7);
    expect(RubricChecks.hasChecks(criterion())).toBe(true);
    expect(RubricChecks.hasChecks({ id: 'y' })).toBe(false);
  });
});
