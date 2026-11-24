/**
 * Moving a card in the Reflect builder (teacher/cm-reflect-builder.js),
 * as One Report moves a statement (DECISIONS, "Reflect's builder works the
 * way One Report's editor does" 2): a question one card at a time, a
 * heading with the questions under it.
 */
import './setup.js';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'vm';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (typeof CmReflectBuilder === 'undefined')
  runInThisContext(readFileSync(resolve(ROOT, 'teacher/cm-reflect-builder.js'), 'utf-8'), {
    filename: 'teacher/cm-reflect-builder.js',
  });
const B = () => CmReflectBuilder;

/* 'a b | H c d | K e': lower case a question, upper case a heading. */
function cards(spec) {
  return spec
    .split(/\s+/)
    .filter(x => x && x !== '|')
    .map(p => ({ kind: p === p.toUpperCase() ? 'section' : 'text', prompt: p }));
}
const names = qs => qs.map(d => d.prompt).join(' ');
const at = (qs, p) => qs.findIndex(d => d.prompt === p);

describe('blocksOf', () => {
  it('splits the cards at each heading; questions before the first make a block with no heading', () => {
    expect(B().blocksOf(cards('a b H c d K e'))).toEqual([
      { start: 0, end: 2, head: false },
      { start: 2, end: 5, head: true },
      { start: 5, end: 7, head: true },
    ]);
    expect(B().blocksOf(cards('H a'))).toEqual([{ start: 0, end: 2, head: true }]);
    expect(B().blocksOf([])).toEqual([]);
  });
});

describe('moveBy', () => {
  const qs = cards('a b H c d K e');
  it('moves a question one card, past a heading into the block next to it', () => {
    expect(names(B().moveBy(qs, at(qs, 'b'), 1))).toBe('a H b c d K e');
    expect(names(B().moveBy(qs, at(qs, 'c'), -1))).toBe('a b c H d K e');
    expect(names(B().moveBy(qs, at(qs, 'd'), 1))).toBe('a b H c K d e');
  });
  it('moves a heading with its questions past the whole block next to it', () => {
    expect(names(B().moveBy(qs, at(qs, 'K'), -1))).toBe('a b K e H c d');
    expect(names(B().moveBy(qs, at(qs, 'H'), 1))).toBe('a b K e H c d');
    expect(names(B().moveBy(qs, at(qs, 'H'), -1))).toBe('H c d a b K e');
  });
  it('leaves the list as it was at either end', () => {
    expect(names(B().moveBy(qs, 0, -1))).toBe(names(qs));
    expect(names(B().moveBy(qs, qs.length - 1, 1))).toBe(names(qs));
    expect(names(B().moveBy(qs, at(qs, 'K'), 1))).toBe(names(qs));
  });
  it('keeps the same card objects', () => {
    var next = B().moveBy(qs, 1, 1);
    expect(next).not.toBe(qs);
    expect(next.every(d => qs.includes(d))).toBe(true);
  });
});

describe('moveTo', () => {
  const qs = cards('a b H c d K e');
  it('puts a question at the foot of the block picked', () => {
    expect(names(B().moveTo(qs, at(qs, 'a'), at(qs, 'K')))).toBe('b H c d K e a');
    expect(names(B().moveTo(qs, at(qs, 'e'), at(qs, 'H')))).toBe('a b H c d e K');
    expect(names(B().moveTo(qs, at(qs, 'e'), 0))).toBe('a b e H c d K');
  });
  it('does nothing for a heading or the block it is in', () => {
    expect(names(B().moveTo(qs, at(qs, 'H'), at(qs, 'K')))).toBe(names(qs));
    expect(names(B().moveTo(qs, at(qs, 'c'), at(qs, 'H')))).toBe(names(qs));
  });
});

describe('dropAt (a drag)', () => {
  const qs = cards('a b H c d K e');
  it('puts a question before the card it lands on, or at the end', () => {
    expect(names(B().dropAt(qs, at(qs, 'a'), at(qs, 'd')))).toBe('b H c a d K e');
    expect(names(B().dropAt(qs, at(qs, 'c'), qs.length))).toBe('a b H d K e c');
    expect(names(B().dropAt(qs, at(qs, 'e'), 0))).toBe('e a b H c d K');
  });
  it('carries a heading with its block, landing only at the top, before a heading or at the end', () => {
    expect(names(B().dropAt(qs, at(qs, 'H'), qs.length))).toBe('a b K e H c d');
    expect(names(B().dropAt(qs, at(qs, 'K'), at(qs, 'H')))).toBe('a b K e H c d');
    expect(names(B().dropAt(qs, at(qs, 'K'), 0))).toBe('K e a b H c d');
    expect(names(B().dropAt(qs, at(qs, 'K'), at(qs, 'c')))).toBe(names(qs));
  });
  it('a drop where it already is changes nothing', () => {
    expect(names(B().dropAt(qs, at(qs, 'H'), at(qs, 'K')))).toBe(names(qs));
    expect(names(B().dropAt(qs, at(qs, 'b'), at(qs, 'b')))).toBe(names(qs));
  });
});
