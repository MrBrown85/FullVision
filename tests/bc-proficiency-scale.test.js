/**
 * data/bc-proficiency-scale.json is the Ministry's Provincial Proficiency Scale,
 * copied by scripts/bc_proficiency_scale.py. Nothing in it may be typed by hand.
 *
 * The shape checks run everywhere. The golden check (every stored sentence
 * equals the text re-extracted from the recorded PDF) needs the PDF, which is
 * Crown copyright and stays out of the repo, and a Python with pypdfium2
 * ($FV_PDF_PYTHON, default python3). It is skipped where either is missing.
 */
import { execFileSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const scale = JSON.parse(readFileSync('data/bc-proficiency-scale.json', 'utf-8'));

describe('BC proficiency scale', () => {
  it('has the four levels in order', () => {
    expect(scale.levels.map(l => [l.level, l.name])).toEqual([
      [1, 'Emerging'],
      [2, 'Developing'],
      [3, 'Proficient'],
      [4, 'Extending'],
    ]);
  });

  it('records where the text came from', () => {
    const s = scale._source;
    expect(s.url).toMatch(/^https:\/\/www2\.gov\.bc\.ca\/assets\/gov\/education\/.+\.pdf$/);
    expect(s.format).toBe('pdf');
    expect(s.page).toBeGreaterThan(0);
    expect(s.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(s.fetched).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('stores text only in NFC with single spaces', () => {
    for (const l of scale.levels) {
      expect(l.text.length, l.name).toBeGreaterThan(0);
      for (const t of l.text) {
        expect(t, l.name).toBe(t.normalize('NFC'));
        expect(/^\s|\s$|\s\s|\n|\t/.test(t), t).toBe(false);
      }
    }
  });

  it("opens each level with the Ministry's definition of it", () => {
    for (const l of scale.levels) expect(l.text.join(' '), l.name).toContain(`"${l.name}"`);
  });

  it("takes each level's anchor from its own text and no other level's", () => {
    for (const l of scale.levels) {
      expect(l.text.join(' '), l.name).toContain(l.anchor);
      for (const o of scale.levels) if (o !== l) expect(o.text.join(' ')).not.toContain(l.anchor);
    }
  });

  const sources = process.env.FV_BC_SOURCES || join(homedir(), 'FullVision-bc-sources');
  const pdf = join(sources, 'proficiency', 'unpacking-the-proficency-scale-support-for-educators.pdf');
  const python = process.env.FV_PDF_PYTHON || 'python3';
  let reader = false;
  try {
    execFileSync(python, ['-c', 'import pypdfium2'], { stdio: 'ignore' });
    reader = true;
  } catch {
    reader = false;
  }
  it.skipIf(!existsSync(pdf) || !reader)('matches the Ministry PDF word for word', () => {
    let out = '';
    try {
      out = execFileSync(python, ['scripts/bc_proficiency_scale.py', 'verify'], { encoding: 'utf-8' });
    } catch (e) {
      out = (e.stdout || '') + (e.stderr || '');
      throw new Error(out);
    }
    expect(out).toMatch(/verify: 0 problem\(s\)/);
  });
});
