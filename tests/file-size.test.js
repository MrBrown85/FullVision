/**
 * File-size limit.
 *
 * A source file may not grow past 1500 lines. Files already past it are
 * listed in tests/file-size-baseline.json with their line count. A listed
 * file may stay the same or shrink, but not grow. New files start under
 * the limit.
 *
 * Lines are counted the way `wc -l` counts them: the number of newline
 * characters.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LIMIT = 1500;
const DIRS = ['shared', 'teacher', 'teacher-mobile', 's'];

// Data, not code: curriculum and comment banks, the demo class, minified files.
const EXEMPT = [/^shared\/bank-[^/]*\.js$/, /^shared\/comment-bank\.js$/, /^shared\/seed-data\.js$/, /\.min\.js$/];

const baseline = JSON.parse(readFileSync(resolve(root, 'tests/file-size-baseline.json'), 'utf-8'));

function lineCount(rel) {
  const text = readFileSync(resolve(root, rel), 'utf-8');
  return (text.match(/\n/g) || []).length;
}

function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(resolve(root, dir), { withFileTypes: true })) {
    const rel = dir + '/' + entry.name;
    if (entry.isDirectory()) out.push(...sourceFiles(rel));
    else if (entry.name.endsWith('.js') && !EXEMPT.some(re => re.test(rel))) out.push(rel);
  }
  return out;
}

const fmt = n => n.toLocaleString('en-US');
const files = DIRS.flatMap(sourceFiles);

describe('file size limit', () => {
  it('no file grows past its limit', () => {
    const problems = [];
    for (const rel of files) {
      const lines = lineCount(rel);
      const listed = rel in baseline;
      const limit = listed ? baseline[rel] : LIMIT;
      if (lines <= limit) continue;
      const fix = listed
        ? 'raise the number in tests/file-size-baseline.json in this PR and say why in the PR'
        : 'add it to tests/file-size-baseline.json in this PR and say why in the PR';
      problems.push(
        `${rel} has ${fmt(lines)} lines; ${listed ? 'its' : 'the'} limit is ${fmt(limit)}. Move a piece into its own file, or ${fix}.`,
      );
    }
    expect(problems.join('\n')).toBe('');
  });

  it('every baseline entry is still needed', () => {
    const problems = [];
    for (const rel of Object.keys(baseline)) {
      if (!existsSync(resolve(root, rel))) {
        problems.push(`${rel} no longer exists. Delete its entry from tests/file-size-baseline.json.`);
      } else if (lineCount(rel) <= LIMIT) {
        problems.push(
          `${rel} is now ${fmt(LIMIT)} lines or fewer. Delete its entry from tests/file-size-baseline.json.`,
        );
      }
    }
    expect(problems.join('\n')).toBe('');
  });
});
