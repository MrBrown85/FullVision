/**
 * data/bc-core-competencies.json is the Ministry's description and facets of
 * each Core Competency, copied by scripts/bc_core_competencies.py. Nothing in
 * it may be typed by hand.
 *
 * The shape checks run everywhere. The golden check (every stored string
 * equals the text re-extracted from the cached Ministry page) needs the raw
 * pages, which are Crown copyright and stay out of the repo. It runs wherever
 * they are cached ($FV_BC_SOURCES/core, default ~/FullVision-bc-sources/core)
 * and is skipped elsewhere.
 */
import { execFileSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const bank = JSON.parse(readFileSync('data/bc-core-competencies.json', 'utf-8'));
const entries = Object.entries(bank).filter(([key]) => !key.startsWith('_'));

// CORE_COMPETENCIES groups, as the Ministry names them.
const GROUP = { Communication: 'Communication', Thinking: 'Thinking', 'Personal & Social': 'Personal and Social' };

const strings = entries.flatMap(([id, c]) =>
  [c.name, c.group, ...c.description, ...c.facets.flatMap(f => [f.name, ...f.text])].map(s => ({ id, s })),
);

describe('BC Core Competencies bank', () => {
  it('has one entry for each of FullVision’s Core Competencies, in its group', () => {
    expect(entries.map(([id]) => id).sort()).toEqual(CORE_COMPETENCIES.map(c => c.id).sort());
    for (const cc of CORE_COMPETENCIES) expect(bank[cc.id].group, cc.id).toBe(GROUP[cc.group]);
  });

  it('gives every Core Competency a description and named facets', () => {
    for (const [id, c] of entries) {
      expect(c.name, id).toBeTruthy();
      expect(c.description.length, id).toBeGreaterThan(0);
      expect(c.facets.length, id).toBeGreaterThanOrEqual(3);
      for (const f of c.facets) {
        expect(f.name, id).toBeTruthy();
        expect(f.text.length, `${id} ${f.name}`).toBeGreaterThan(0);
      }
    }
  });

  it('records where every one came from', () => {
    for (const [id, c] of entries) {
      expect(c.source.url, id).toMatch(/^https:\/\/curriculum\.gov\.bc\.ca\/competencies\//);
      expect(c.source.format, id).toBe('web');
      expect(c.source.sha256, id).toMatch(/^[0-9a-f]{64}$/);
      expect(c.source.fetched, id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('stores text only in NFC with single spaces', () => {
    const bad = strings.filter(({ s }) => !s || s !== s.normalize('NFC') || /^\s|\s$|\s\s|\n|\t/.test(s));
    expect(bad).toEqual([]);
  });

  const cached = join(process.env.FV_BC_SOURCES || join(homedir(), 'FullVision-bc-sources'), 'core');
  it.skipIf(!existsSync(cached))('matches the Ministry pages word for word', () => {
    let out = '';
    try {
      out = execFileSync('python3', ['scripts/bc_core_competencies.py', 'verify'], { encoding: 'utf-8' });
    } catch (e) {
      out = (e.stdout || '') + (e.stderr || '');
      throw new Error(out);
    }
    expect(out).toMatch(/verify: 0 problem\(s\)/);
  });
});
