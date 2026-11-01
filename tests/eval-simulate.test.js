/**
 * The simulation (plan PR 13): Generate over Demo Mode and synthetic
 * classes, reporting sentences never picked, over-picked, near-identical
 * pairs and thin parts. Synthetic data only.
 */
import './setup.js';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { formatReport, main, simulate } from '../scripts/eval/simulate.mjs';
import { KINDS, syntheticClass } from '../scripts/eval/synthetic.mjs';
import { loadClass, ROOT } from '../scripts/eval/app.mjs';

const dir = mkdtempSync(join(tmpdir(), 'fv-sim-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('the synthetic classes', () => {
  it('cover Letter, Both and Proficiency classes, grades 8 to 12, and several kinds of class', () => {
    const kinds = Object.values(KINDS);
    expect(new Set(kinds.map(k => k.system))).toEqual(new Set(['letter', 'both', 'proficiency']));
    const families = Object.keys(KINDS).map(kind => CommentBank.familyOf(loadClass(syntheticClass(kind), 1).cid));
    expect(families).not.toContain('');
    expect(new Set(families).size).toBe(kinds.length);
    expect(kinds.some(k => Number(k.grade) <= 9)).toBe(true);
    expect(kinds.some(k => Number(k.grade) >= 10)).toBe(true);
  });

  it('are the same every time, with invented names and none named Kai', () => {
    Object.keys(KINDS).forEach(kind => {
      const a = syntheticClass(kind);
      expect(syntheticClass(kind)).toEqual(a);
      a.gradebook.students.forEach(s => expect(s.first_name).not.toBe('Kai'));
      expect(new Set(a.gradebook.students.map(s => s.first_name + ' ' + s.last_name)).size).toBe(
        a.gradebook.students.length,
      );
    });
  });
});

describe('simulate', () => {
  let r;
  beforeAll(() => {
    r = simulate({ kinds: ['history12', 'english10', 'science9'], presses: 2 });
  });

  it('runs Demo Mode’s two reports and each synthetic class', () => {
    expect(r.classes.map(c => c.label)).toEqual([
      'Demo Mode: Science 8, Report 1',
      'Demo Mode: Science 8, Report 2',
      'History 12 (synthetic)',
      'English 10 (synthetic)',
      'Science 9 (synthetic)',
    ]);
    r.classes.forEach(c => {
      expect(c.students).toBeGreaterThan(20);
      expect(c.pairs).toBe((c.students * (c.students - 1)) / 2);
      expect(c.presses).toBe(2);
      expect(c.verifierReplaced).toBe(0);
    });
  });

  it('lists the sentences never picked, each marked by whether any student fit it', () => {
    expect(r.neverPicked.length).toBeGreaterThan(0);
    expect(r.neverPicked.length).toBeLessThan(r.bank);
    r.neverPicked.forEach(s => {
      expect(COMMENT_BANK.sentences.some(b => b.id === s.id)).toBe(true);
      expect(s.fit).toBeGreaterThanOrEqual(0);
    });
    // The grade sentences for a letter, a proficiency word and the goals
    // are all used somewhere.
    ['gr01', 'gr05', 'gr07', 'gr08'].forEach(id => expect(r.neverPicked.map(s => s.id)).not.toContain(id));
  });

  it('lists the over-picked sentences: in more comments of one class than the crowded mark, never a fixed part', () => {
    expect(r.overAt).toBe(CommentBank.USED_BY + 1);
    expect(r.overPicked.length).toBeGreaterThan(0);
    r.overPicked.forEach(o => {
      expect(o.comments).toBeGreaterThanOrEqual(r.overAt);
      expect(['grade', 'attendance', 'notHandedIn', 'example', 'nextStep']).not.toContain(o.step);
    });
    // A next-step frame can be in many Demo comments, but the step is
    // fixed by design, so it is never listed.
    expect(r.overPicked.some(o => COMMENT_BANK.sentences.find(s => s.id === o.id).group === 'Next Step')).toBe(false);
  });

  it('lists the near-identical pairs and the thin parts per class', () => {
    r.classes.forEach(c => {
      c.nearIdentical.forEach(pairs => pairs.forEach(p => expect(p.shared).toBeGreaterThanOrEqual(5)));
      c.thin.forEach(t => expect(t.students).toBeGreaterThanOrEqual(3 * t.sentences));
    });
    // The habits part is no longer thin: six "excellent" frames serve the
    // students rated all Consistently (2026-11-01).
    r.classes.forEach(c => expect(c.thin.map(t => t.step)).not.toContain('habits'));
    expect(r.classes.some(c => c.thin.length > 0)).toBe(true);
  });

  it('prints a plain report', () => {
    const text = formatReport(r);
    expect(text).toMatch(/^Simulation: 5 classes/);
    expect(text).toMatch(/Never picked: \d+ of \d+\./);
    expect(text).toMatch(/Over-picked \(in 4 or more comments of one class\): \d+\./);
    expect(text).toMatch(/thin: \w+, \d+ sentences fit \d+ students/);
  });
});

describe('main', () => {
  it('writes simulate.json only outside the FullVision folder', () => {
    main(['--no-demo', '--kinds', 'pe8', '--out', dir]);
    const out = JSON.parse(readFileSync(join(dir, 'simulate.json'), 'utf-8'));
    expect(out.classes.map(c => c.label)).toEqual(['Physical and Health Education 8 (synthetic)']);
    expect(() => main(['--no-demo', '--kinds', 'pe8', '--out', join(ROOT, 'sim-out')])).toThrow(/outside/);
  });

  it('refuses an unknown kind or option', () => {
    expect(() => main(['--kinds', 'latin9'])).toThrow(/No synthetic class "latin9"/);
    expect(() => main(['--fast'])).toThrow(/Unknown option --fast/);
  });
});
