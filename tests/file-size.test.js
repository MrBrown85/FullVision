/**
 * File-size limit.
 *
 * A new source file may have at most 400 lines (FILE_LIMIT in
 * scripts/size-limits.mjs; DECISIONS, "Size limits for new code"). Files
 * already longer are listed in tests/file-size-baseline.json with their
 * length: a listed file may not grow, and when it shrinks its number comes
 * down (`node scripts/size-limits.mjs --update`), so it cannot grow back.
 *
 * Lines are counted the way `wc -l` counts them. Data files (the banks, the
 * demo class, minified files) are exempt.
 */
import { describe, expect, it } from 'vitest';
import { FILE_BASELINE, fileProblems, measure, readBaseline } from '../scripts/size-limits.mjs';

describe('file size limit', () => {
  it('no file is over its limit, and every listed number matches its file', () => {
    expect(fileProblems(measure(), readBaseline(FILE_BASELINE)).join('\n')).toBe('');
  });
});
