import { describe, expect, it } from 'vitest';
import { findProblems, run } from '../scripts/typecheck-ratchet.mjs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const TAG = '// @ts-check';
const base = () => ({
  checked: ['shared/a.js'],
  notYetChecked: ['shared/b.js'],
  files: [
    { path: 'shared/a.js', firstLine: TAG },
    { path: 'shared/b.js', firstLine: '(function () {' },
  ],
  tsconfigFiles: ['types/globals.d.ts', 'shared/a.js'],
});

describe('type-check ratchet', () => {
  it('passes on the clean case', () => {
    expect(findProblems(base())).toEqual([]);
  });

  it('fails when a checked file loses // @ts-check', () => {
    const s = base();
    s.files[0].firstLine = "'use strict';";
    const p = findProblems(s);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/^shared\/a\.js lost its \/\/ @ts-check line/);
  });

  it('fails when a checked file leaves tsconfig.json', () => {
    const s = base();
    s.tsconfigFiles = ['types/globals.d.ts'];
    const p = findProblems(s);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/^shared\/a\.js is no longer in the "files" list of tsconfig\.json/);
  });

  it('fails when a checked file no longer exists', () => {
    const s = base();
    s.files = s.files.filter(f => f.path !== 'shared/a.js');
    const p = findProblems(s);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/^shared\/a\.js is on the checked list but no longer exists.*remove it/);
  });

  it('fails when a new file has no // @ts-check', () => {
    const s = base();
    s.files.push({ path: 'teacher/new.js', firstLine: '' });
    const p = findProblems(s);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/^teacher\/new\.js is a new file without \/\/ @ts-check/);
  });

  it('fails when a new file has // @ts-check but is not in tsconfig.json', () => {
    const s = base();
    s.files.push({ path: 's/new.js', firstLine: TAG });
    const p = findProblems(s);
    expect(
      p.some(m => /^s\/new\.js starts with \/\/ @ts-check but is not in the "files" list of tsconfig\.json/.test(m)),
    ).toBe(true);
  });

  it('fails when a not-yet-checked file is checked but not moved', () => {
    const s = base();
    s.files[1].firstLine = TAG;
    s.tsconfigFiles.push('shared/b.js');
    const p = findProblems(s);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/^shared\/b\.js is now type-checked\. Move it/);
  });

  it('fails when a not-yet-checked file no longer exists', () => {
    const s = base();
    s.files = s.files.filter(f => f.path !== 'shared/b.js');
    const p = findProblems(s);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/^shared\/b\.js is on the not-yet-checked list but no longer exists\. Remove it/);
  });

  it('fails when a checked new file is in tsconfig.json but on neither list', () => {
    const s = base();
    s.files.push({ path: 'shared/c.js', firstLine: TAG });
    s.tsconfigFiles.push('shared/c.js');
    const p = findProblems(s);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/^shared\/c\.js is type-checked but is not on the checked list/);
  });

  it('ignores exempt data files', () => {
    const s = base();
    s.files.push(
      { path: 'shared/bank-sets.js', firstLine: '' },
      { path: 'shared/seed-data.js', firstLine: '' },
      { path: 's/x.min.js', firstLine: '' },
    );
    expect(findProblems(s)).toEqual([]);
  });

  it('passes on the real repository', () => {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    expect(run(root)).toEqual([]);
  });
});
