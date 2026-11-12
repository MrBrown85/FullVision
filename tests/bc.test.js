/**
 * bc: the tests that were tests/bc-*.test.js, one describe
 * block per former file, named after it. Each block keeps its own setup
 * and hooks. Merged 2026-11-11 to cut the file count (CI time).
 */
import { execFileSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { createHash } from 'crypto';

describe('bc-core-competencies', () => {
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
});

describe('bc-curriculum-ican', () => {
  /**
   * data/bc-curriculum-ican.json holds the I Can statements for BC curriculum
   * competencies (stage 3 of the bank rebuild), keyed by competency id in
   * data/bc-curriculum-source.json. It covers every subject in the source:
   * Social Studies, English Language Arts, Science, Mathematics, Physical and
   * Health Education, Career Education, Applied Design, Skills and Technologies
   * and Arts Education. These checks read only the two JSON files and keep their
   * own rules, apart from whatever produced the statements.
   */

  const source = JSON.parse(readFileSync('data/bc-curriculum-source.json', 'utf-8'));
  const ican = JSON.parse(readFileSync('data/bc-curriculum-ican.json', 'utf-8'));

  const SUBJECTS = new Set([
    'Social Studies',
    'English Language Arts',
    'Science',
    'Mathematics',
    'Physical and Health Education',
    'Career Education',
    'Applied Design, Skills and Technologies',
    'Arts Education',
  ]);
  const rows = Object.entries(source)
    .filter(([key, course]) => !key.startsWith('_') && SUBJECTS.has(course.subject))
    .flatMap(([key, course]) =>
      course.categories.flatMap(cat =>
        cat.competencies.map(x => ({ key, grade: course.grade, id: x.id, raw: x.raw, ic: ican[x.id] })),
      ),
    );
  const statements = rows.flatMap(r => (r.ic ? r.ic.i_can_statements.map(s => ({ ...r, s })) : []));

  // Words a statement may not use: vague verbs a teacher cannot see in student
  // work, words that shame or qualify a level, and outdated terms.
  const BANNED =
    /\b(understand|appreciate|know|learn about|still|again|finally|unfortunately|always|independently|with support|aboriginal|gay)\b/i;
  const CAP = { 8: 14, 9: 17, 10: 17, 11: 22, 12: 22 };
  const sha = raw => createHash('sha256').update(raw, 'utf8').digest('hex').slice(0, 16);
  const words = s => s.split(/\s+/).filter(Boolean).length;

  describe('BC curriculum I Can statements', () => {
    it('covers every competency in its eight subjects, and nothing else', () => {
      expect(rows.length).toBe(5029);
      expect(rows.filter(r => !r.ic).map(r => r.id)).toEqual([]);
      const ids = new Set(rows.map(r => r.id));
      expect(Object.keys(ican).filter(id => !id.startsWith('_') && !ids.has(id))).toEqual([]);
      for (const r of rows) expect(r.ic.course, r.id).toBe(r.key);
    });

    it('gives each competency 2 to 4 statements, none repeated', () => {
      const bad = rows.filter(r => {
        const s = r.ic.i_can_statements;
        return s.length < 2 || s.length > 4 || new Set(s).size !== s.length;
      });
      expect(bad.map(r => r.id)).toEqual([]);
    });

    it('starts every statement "I can" and a lower-case word, with no ending punctuation', () => {
      const bad = statements.filter(x => !/^I can [a-z]/.test(x.s) || /[.!?;:,]$/.test(x.s) || x.s !== x.s.trim());
      expect(bad.map(x => `${x.id}: ${x.s}`)).toEqual([]);
    });

    it('uses none of the banned words', () => {
      expect(statements.filter(x => BANNED.test(x.s)).map(x => `${x.id}: ${x.s}`)).toEqual([]);
    });

    it('keeps statements within the word cap for the grade: 14 at 8, 17 at 9-10, 22 at 11-12', () => {
      expect(statements.filter(x => words(x.s) > CAP[x.grade]).map(x => `${x.id} (${words(x.s)}): ${x.s}`)).toEqual([]);
    });

    it('was written against the current Ministry text', () => {
      // A change to the official wording flags the statements built on it.
      expect(rows.filter(r => r.ic.prov.raw_sha !== sha(r.raw)).map(r => r.id)).toEqual([]);
      for (const r of rows) {
        expect(['exemplar', 'adapted'], r.id).toContain(r.ic.prov.method);
        expect(r.ic.prov.approved_by_owner, r.id).toBe(true);
        expect(ican[r.ic.prov.exemplar], `${r.id} exemplar`).toBeTruthy();
      }
    });

    it('gives identical Ministry wording within a cluster identical statements', () => {
      const byWording = new Map();
      for (const r of rows) {
        const k = r.ic.cluster + '\u0000' + r.raw;
        const set = JSON.stringify(r.ic.i_can_statements);
        if (!byWording.has(k)) byWording.set(k, { set, id: r.id });
        else expect(set, `${r.id} vs ${byWording.get(k).id}`).toBe(byWording.get(k).set);
      }
    });
  });
});

describe('bc-curriculum-source', () => {
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
});

describe('bc-proficiency-scale', () => {
  /**
   * data/bc-proficiency-scale.json is the Ministry's Provincial Proficiency Scale,
   * copied by scripts/bc_proficiency_scale.py. Nothing in it may be typed by hand.
   *
   * The shape checks run everywhere. The golden check (every stored sentence
   * equals the text re-extracted from the recorded PDF) needs the PDF, which is
   * Crown copyright and stays out of the repo, and a Python with pypdfium2
   * ($FV_PDF_PYTHON, default python3). It is skipped where either is missing.
   */

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
});
