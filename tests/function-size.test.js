/**
 * Function-size limit.
 *
 * A new function may have at most 50 lines (FUNCTION_LIMIT in
 * scripts/size-limits.mjs; DECISIONS, "Size limits for new code"), counted as
 * ESLint's max-lines-per-function counts them. A function invoked where it is
 * written, such as the closure that wraps a page file, does not count.
 *
 * Functions already longer are listed in tests/function-size-baseline.json by
 * file and name (`teacher/page-assignments.js :: render > forEach callback 2`)
 * with their length: a listed function may not grow, and when it shrinks its
 * number comes down (`node scripts/size-limits.mjs --update`). A function cut
 * to another file keeps its entry: --update follows it.
 */
import { describe, expect, it } from 'vitest';
import {
  FUNCTION_BASELINE,
  fileProblems,
  functionProblems,
  longFunctions,
  measure,
  readBaseline,
  updated,
} from '../scripts/size-limits.mjs';

describe('function size limit', () => {
  it('no function is over its limit, and every listed number matches its function', () => {
    expect(functionProblems(measure(), readBaseline(FUNCTION_BASELINE)).join('\n')).toBe('');
  });

  it('names a function by where it sits, and leaves out a closure invoked in place', () => {
    const body = n => Array.from({ length: n }, (_, i) => `    x${i}();`).join('\n');
    const src = [
      'window.Page = (function () {',
      '  function render() {',
      body(3),
      '    list.forEach(function () {',
      body(55),
      '    });',
      '  }',
      '  var api = {',
      '    save: function () {',
      body(60),
      '    },',
      '  };',
      '  return api;',
      '})();',
    ].join('\n');
    const found = longFunctions(src, 50);
    expect(Object.keys(found).sort()).toEqual(['render', 'render > forEach callback 1', 'save']);
    expect(found['render > forEach callback 1'].lines).toBe(57);
  });

  it('--update lists a new long file only when listed files shrank by nearly as much', () => {
    const fn = (file, name, lines) => ({ [file + ' :: ' + name]: { lines, line: 1, file, name } });
    // A 1,000-line part cut from a listed file, with 100 lines of wiring.
    const cut = { files: { 'a.js': 2100, 'a-part.js': 1100 }, functions: fn('a-part.js', 'big', 300) };
    const u = updated(cut, { 'a.js': 3000 }, { 'a.js :: big': 300 });
    expect(u.files).toEqual({ 'a-part.js': 1100, 'a.js': 2100 });
    expect(u.functions).toEqual({ 'a-part.js :: big': 300 });
    expect(fileProblems(cut, u.files).concat(functionProblems(cut, u.functions))).toEqual([]);
    // New code: nothing shrank to pay for it, so it is not listed and still fails.
    const fresh = { files: { 'a.js': 3000, 'new.js': 900 }, functions: {} };
    const v = updated(fresh, { 'a.js': 3000 }, {});
    expect(v.files).toEqual({ 'a.js': 3000 });
    expect(fileProblems(fresh, v.files)).toHaveLength(1);
    // New code slipped in beside a move: together they outgrow what left, so none is listed.
    const both = { files: { 'a.js': 2100, 'a-part.js': 1100, 'new.js': 900 }, functions: {} };
    expect(Object.keys(updated(both, { 'a.js': 3000 }, {}).files)).toEqual(['a.js']);
  });
});
