/**
 * The differential run's list of mark writers (scripts/differential/writers.mjs)
 * is read from the code: every exported function of shared/data.js, the
 * shared/data-*.js files and shared/grader.js whose name looks like a
 * writer's is on it, as a writer or as not one, and every name on it exists.
 * A new writer cannot be added without the run's ledger counting it.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  NOT_WRITERS,
  WRITERS,
  WRITER_NAMES,
  ledgerLines,
  looksLikeWriter,
  unreached,
} from '../scripts/differential/writers.mjs';

const ROOT = new URL('..', import.meta.url).pathname;

/* The exported names: top-level function declarations and window.x =
   function, not starting with _ (private by the code's own rule), and
   every key of the object window.Grader is made from. */
function exportedNames() {
  const files = [
    'shared/data.js',
    ...readdirSync(ROOT + 'shared')
      .filter(f => /^data-.*\.js$/.test(f))
      .map(f => 'shared/' + f),
  ];
  const names = new Set();
  for (const f of files) {
    const text = readFileSync(ROOT + f, 'utf8');
    for (const m of text.matchAll(
      /^(?:async )?function ([A-Za-z$][\w$]*)\s*\(|^window\.([A-Za-z$][\w$]*) = (?:async )?function/gm,
    ))
      names.add(m[1] || m[2]);
  }
  const grader = readFileSync(ROOT + 'shared/grader.js', 'utf8');
  const exported = grader.slice(grader.lastIndexOf('\n  return {'));
  for (const m of exported.matchAll(/^\s+([A-Za-z]\w*):/gm)) names.add('Grader.' + m[1]);
  return names;
}

describe('the mark writers list', () => {
  const names = exportedNames();

  it('finds the exports it reads (the scan itself works)', () => {
    expect(names.has('upsertScore')).toBe(true);
    expect(names.has('Grader.setLevel')).toBe(true);
    expect(names.has('saveAssignmentStatuses')).toBe(true);
  });

  it('lists every export whose name looks like a writer, as a writer or as not one', () => {
    const unlisted = [...names].filter(n => looksLikeWriter(n) && !(n in WRITERS) && !(n in NOT_WRITERS));
    expect(unlisted).toEqual([]);
  });

  it('lists only names that exist', () => {
    const gone = [...Object.keys(WRITERS), ...Object.keys(NOT_WRITERS)].filter(n => !names.has(n));
    expect(gone).toEqual([]);
  });

  it('gives every writer an area and a reason, and every other name a reason', () => {
    for (const [n, [area, why]] of Object.entries(WRITERS)) {
      expect(area, n).toMatch(/^(status|score|comment|note|tick|dibels|group|return|override|roster)$/);
      expect(why, n).toBeTruthy();
    }
    for (const [n, why] of Object.entries(NOT_WRITERS)) expect(why, n).toBeTruthy();
    expect(Object.keys(WRITERS).filter(n => n in NOT_WRITERS)).toEqual([]);
  });

  it('fails a scan that has a writer missing from the list', () => {
    expect(looksLikeWriter('saveScoreFlag')).toBe(true);
    expect(looksLikeWriter('Grader.somethingNew')).toBe(true);
    expect(looksLikeWriter('getScores')).toBe(false);
  });
});

describe('the ledger readout', () => {
  it('names what was called, with counts, and what was not', () => {
    const lines = ledgerLines('signed-in', [
      { upsertScore: 3, saveScores: 1 },
      { upsertScore: 3, saveScores: 2 },
    ]);
    expect(lines[0]).toContain('saveScores A 1 | B 2');
    expect(lines[0]).toContain('upsertScore 3');
    expect(lines[1]).toContain('setPointsScore');
    expect(lines[1]).not.toContain('upsertScore');
    expect(lines[1].split('run: ')[1].split(', ').length).toBe(WRITER_NAMES.length - 2);
  });

  it('--must-reach fails a writer not called on both sides', () => {
    const ledgers = [{ upsertScore: 1, setPointsScore: 1 }, { upsertScore: 1 }];
    expect(unreached(['upsertScore', 'setPointsScore', 'saveScores'], ledgers)).toEqual([
      'setPointsScore',
      'saveScores',
    ]);
  });
});
