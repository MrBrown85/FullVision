/**
 * Edit a Copy on scored work moves the assessment's rubric scores to the copy
 * (move_rubric_scores, migrations/20261102_move_rubric_scores.sql). Two
 * checkboxes at one level with the same wording used to map to the same new
 * checkbox, so the server move hit a duplicate row and was undone while this
 * device had already moved the scores (Nov 3 bug sweep, Database changes,
 * group 2). Each checkbox now maps to its own new one.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';

const U = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');

/* _scoreMoveMaps as written in page-assignments.js. */
function scoreMoveMaps() {
  const src = readFileSync('teacher/page-assignments.js', 'utf-8');
  const fn = src.match(/ {2}function _scoreMoveMaps\([^)]*\) \{[\s\S]*?\n {2}\}\n/);
  expect(fn, '_scoreMoveMaps in page-assignments.js').toBeTruthy();
  // eslint-disable-next-line no-new-func
  return new Function('getRubricById', '_writesEnabled', '_isUuid', fn[0] + '\nreturn _scoreMoveMaps;')(
    () => null,
    () => true,
    id => /^[0-9a-f-]{36}$/.test(id),
  );
}

describe('Edit a Copy score move maps', () => {
  const held = {
    id: 'held',
    criteria: [
      {
        id: 'hc1',
        checks: [
          { id: 'hk1', level: 3, label: 'Labels the axes' },
          { id: 'hk2', level: 3, label: 'Labels the axes' },
          { id: 'hk3', level: 4, label: 'Adds a trend line' },
        ],
      },
    ],
  };
  const copiedFrom = {
    criteria: { hc1: U(1) },
    checks: { hk1: U(11), hk2: U(12), hk3: U(13) },
  };
  const result = {
    rubrics: [
      {
        id: U(100),
        criteria: [
          {
            id: U(101),
            checks: [
              { id: U(111), level: 3, label: 'Labels the axes' },
              { id: U(112), level: 3, label: 'Labels the axes' },
              { id: U(113), level: 4, label: 'Adds a trend line' },
            ],
          },
        ],
      },
    ],
  };

  it('maps two checkboxes with the same wording at one level to two new checkboxes', () => {
    const maps = scoreMoveMaps()('cid', 'aid', U(100), copiedFrom, held, result);
    expect(maps.criteria).toEqual({ [U(1)]: U(101) });
    expect(maps.checks).toEqual({ [U(11)]: U(111), [U(12)]: U(112), [U(13)]: U(113) });
    const targets = Object.values(maps.checks);
    expect(new Set(targets).size).toBe(targets.length);
  });

  it('lets a checkbox added in the copy take its own new checkbox', () => {
    const added = {
      id: 'held',
      criteria: [
        {
          id: 'hc1',
          checks: [
            { id: 'new', level: 3, label: 'Labels the axes' },
            { id: 'hk1', level: 3, label: 'Labels the axes' },
          ],
        },
      ],
    };
    const maps = scoreMoveMaps()('cid', 'aid', U(100), copiedFrom, added, result);
    expect(maps.checks).toEqual({ [U(11)]: U(112) });
  });
});
