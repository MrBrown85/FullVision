/**
 * data/bc-curriculum-source.json is the Ministry's grade 8–12 curriculum text,
 * copied by scripts/bc_curriculum.py. Nothing in it may be typed by hand.
 *
 * The shape checks run everywhere. The golden check (every stored string equals
 * the text re-extracted from its recorded DOCX, PDF or page, after NFC and
 * whitespace normalisation only) needs the raw Ministry files, which are Crown
 * copyright and stay out of the repo. It runs wherever they are cached
 * ($FV_BC_SOURCES, default ~/FullVision-bc-sources) and is skipped elsewhere.
 */
import { execFileSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const source = JSON.parse(readFileSync('data/bc-curriculum-source.json', 'utf-8'));
const flags = JSON.parse(readFileSync('data/bc-curriculum-flags.json', 'utf-8'));
const courseLists = JSON.parse(readFileSync('data/bc-curriculum-courses.json', 'utf-8'));
const courses = Object.entries(source).filter(([key]) => !key.startsWith('_'));

const FAMILIES = new Set([
  'Applied Design, Skills and Technologies',
  'Arts Education',
  'Career Education',
  'English Language Arts',
  'Mathematics',
  'Physical and Health Education',
  'Science',
  'Social Studies',
]);

function* strings(key, c) {
  for (const b of c.big_ideas) yield { key, kind: 'bi', ...b };
  for (const cat of c.categories)
    for (const x of cat.competencies) {
      yield { key, kind: 'cc', ...x };
      for (const ch of x.children) yield { key, kind: 'cc', ...ch };
    }
  for (const g of c.content)
    for (const it of g.items) {
      yield { key, kind: 'ct', ...it };
      for (const ch of it.children) yield { key, kind: 'ct', ...ch };
    }
}
const all = courses.flatMap(([key, c]) => [...strings(key, c)]);

describe('BC curriculum source', () => {
  it('covers grades 8 to 12 in the eight subject families', () => {
    expect(courses.length).toBeGreaterThan(200);
    for (const [key, c] of courses) {
      expect(c.grade, key).toBeGreaterThanOrEqual(8);
      expect(c.grade, key).toBeLessThanOrEqual(12);
      expect(FAMILIES.has(c.subject), key).toBe(true);
    }
  });

  it('records where every course came from', () => {
    for (const [key, c] of courses) {
      const s = c.source;
      expect(s.url, key).toMatch(/^https:\/\/curriculum\.gov\.bc\.ca\//);
      expect(['docx', 'pdf', 'web'], key).toContain(s.format);
      expect(s.sha256, key).toMatch(/^[0-9a-f]{64}$/);
      expect(s.fetched, key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('gives every string a unique, well-formed id', () => {
    const ids = all.map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of all) {
      expect(s.id).toMatch(new RegExp(`^bc\\.${s.key.toLowerCase()}\\.${s.kind}\\.\\d+(\\.\\d+)?$`));
      expect(s.status).toBe('current');
    }
  });

  it('stores text only in NFC with single spaces', () => {
    const bad = all.filter(s => !s.raw || s.raw !== s.raw.normalize('NFC') || /^\s|\s$|\s\s|\n|\t/.test(s.raw));
    expect(bad.map(s => s.id)).toEqual([]);
  });

  it('leaves out the "Students are expected…" stems', () => {
    expect(all.filter(s => /^Students are expected/.test(s.raw)).map(s => s.id)).toEqual([]);
  });

  it('flags every course it could not fill instead of guessing', () => {
    const flagged = new Set(flags.map(f => f.course));
    for (const [key, c] of courses) {
      const comps = c.categories.reduce((n, cat) => n + cat.competencies.length, 0);
      if (!c.big_ideas.length || !comps || !c.content.length) expect(flagged.has(key), key).toBe(true);
    }
  });

  it('lists every official course once, by a key in the bank or a proposed new one', () => {
    const listed = [...courseLists.matched, ...courseLists.official_new].map(r => r.key);
    expect(new Set(listed).size).toBe(listed.length);
    expect(listed.sort()).toEqual(courses.map(([key]) => key).sort());
  });

  const sources = process.env.FV_BC_SOURCES || join(homedir(), 'FullVision-bc-sources');
  it.skipIf(!existsSync(join(sources, 'manifest.json')))('matches the Ministry files word for word', () => {
    let out = '';
    try {
      out = execFileSync('python3', ['scripts/bc_curriculum.py', 'verify'], { encoding: 'utf-8' });
    } catch (e) {
      out = (e.stdout || '') + (e.stderr || '');
      throw new Error(out);
    }
    expect(out).toMatch(/verify: 0 problem\(s\)/);
  });
});
