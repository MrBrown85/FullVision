/**
 * data/bc-curriculum-derived.json gives every competency in
 * data/bc-curriculum-source.json a folder, a code and a name, built by
 * scripts/bc_curriculum_derive.py from the Ministry's headings and curated
 * lists. These checks read only the two JSON files, so they run in CI, and they
 * do not reuse the script's own checks.
 */
import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

const source = JSON.parse(readFileSync('data/bc-curriculum-source.json', 'utf-8'));
const derived = JSON.parse(readFileSync('data/bc-curriculum-derived.json', 'utf-8'));
const keys = Object.keys(source).filter(k => !k.startsWith('_'));

const SHORT = new Set('a an the and or nor but of to in for with on by at as'.split(' '));
const STOP = new Set('a an the and or of to in for with on by from through about as at that which into'.split(' '));
const WORD_STEMS = new Set(
  'AD AI AM AN AS AT BE BY DO ED GO HA HE HI IF IN IS IT ME MY NO OF OH OK ON OR SO TO UN UP US WE ACT AND ANT ART CAN CON HAP IMP MED OLD PAT REL SOP'.split(
    ' ',
  ),
);
const words = t => (t.toLowerCase().match(/[a-z][a-z'’-]*/g) || []).filter(w => !STOP.has(w));
const sha = raw => createHash('sha256').update(raw, 'utf8').digest('hex').slice(0, 16);

const rows = keys.flatMap(key =>
  source[key].categories.flatMap((cat, ci) =>
    cat.competencies.map((x, xi) => ({
      key,
      subject: source[key].subject,
      path: cat.path,
      siblings: cat.competencies.length,
      raw: x.raw,
      src: x,
      dcat: derived[key]?.categories[ci],
      d: derived[key]?.categories[ci]?.competencies[xi],
    })),
  ),
);
const list = (bad, f) => bad.map(f);

describe('BC curriculum derived layer', () => {
  it('matches the source course for course and id for id, children left out', () => {
    expect(
      Object.keys(derived)
        .filter(k => !k.startsWith('_'))
        .sort(),
    ).toEqual([...keys].sort());
    for (const key of keys) {
      expect(
        derived[key].categories.map(c => c.path),
        key,
      ).toEqual(source[key].categories.map(c => c.path));
      expect(
        derived[key].categories.map(c => c.competencies.map(x => x.id)),
        key,
      ).toEqual(source[key].categories.map(c => c.competencies.map(x => x.id)));
    }
  });

  it('was built from the current Ministry text', () => {
    expect(
      list(
        rows.filter(r => r.d.prov.raw_sha !== sha(r.raw)),
        r => r.d.id,
      ),
    ).toEqual([]);
    const fileSha = createHash('sha256').update(readFileSync('data/bc-curriculum-source.json')).digest('hex');
    expect(derived._derived.source_sha256).toBe(fileSha);
  });

  it('places every competency', () => {
    expect(derived._derived.unplaced).toEqual([]);
    expect(
      list(
        rows.filter(r => !r.d.code || !r.d.short_label),
        r => r.d.id,
      ),
    ).toEqual([]);
  });

  it('keeps codes to 6 characters, unique per course, with no look-alikes', () => {
    const bad = rows.filter(r => {
      const m = /^([A-Z]{2,3})([1-9][0-9]?)?$/.exec(r.d.code);
      return !m || r.d.code.length > 6 || (m[2] && /[ILO]$/.test(m[1])) || WORD_STEMS.has(m[1]);
    });
    expect(list(bad, r => `${r.d.id} ${r.d.code}`)).toEqual([]);
    for (const key of keys) {
      const codes = rows.filter(r => r.key === key).map(r => r.d.code);
      expect(new Set(codes).size, key).toBe(codes.length);
    }
  });

  it('numbers codes by position under their heading', () => {
    for (const key of keys) {
      if (source[key].subject === 'Social Studies') continue;
      for (const cat of derived[key].categories)
        cat.competencies.forEach((x, i) => expect(x.code, x.id).toBe(cat.stem + (i + 1)));
    }
  });

  it('codes and names Social Studies by the bracket concept, numbered only when a course has it twice', () => {
    // Owner decisions 7 and 8, kept here apart from the script's own table.
    const CONCEPT = {
      significance: ['SIG', 'Significance'],
      evidence: ['EVI', 'Evidence'],
      'continuity and change': ['CHG', 'Continuity & Change'],
      'cause and consequence': ['CAU', 'Cause & Consequence'],
      perspective: ['PER', 'Perspective'],
      'ethical judgment': ['ETH', 'Ethical Judgment'],
      'sense of place': ['PLC', 'Sense of Place'],
      'evidence and interpretation': ['EVN', 'Geographic Evidence'],
      'patterns and trends': ['PTR', 'Patterns & Trends'],
      'geographical value judgments': ['GVJ', 'Value Judgments'],
      'geographical importance': ['GIM', 'Geographic Merit'],
      'interactions and associations': ['IAS', 'Factor Interactions'],
      'critical media literacy': ['CML', 'Media Literacy'],
    };
    const UNBRACKETED = [
      [/^Use [\w ]*inquiry processes/, 'INQ', 'Inquiry'],
      [/^Use indigenous principles of learning/, 'IPR', 'Indigenous Learning'],
      [/^Assess the relevance of philosophical ideas/, 'RLV', 'Everyday Relevance'],
    ];
    for (const key of keys) {
      if (source[key].subject !== 'Social Studies') continue;
      const ss = rows.filter(r => r.key === key);
      const want = ss.map(r => {
        const plain = UNBRACKETED.find(([re]) => re.test(r.raw));
        if (plain) return { stem: plain[1], name: plain[2] };
        const m = /\(([^()]*)\)$/.exec(r.raw);
        expect(m && CONCEPT[m[1]], `${r.d.id}: ${r.raw}`).toBeTruthy();
        return { stem: CONCEPT[m[1]][0], name: CONCEPT[m[1]][1] };
      });
      const times = want.reduce((n, w) => ({ ...n, [w.stem]: (n[w.stem] || 0) + 1 }), {});
      const seen = {};
      ss.forEach((r, i) => {
        const { stem, name } = want[i];
        if (times[stem] > 1) {
          seen[stem] = (seen[stem] || 0) + 1;
          expect(r.d.code, r.d.id).toBe(stem + seen[stem]);
        } else {
          expect(r.d.code, r.d.id).toBe(stem);
          expect(r.d.short_label, r.d.id).toBe(name);
        }
      });
    }
  });

  it('keeps names to 20 characters, Title Case, unique per course', () => {
    const titleCase = n =>
      n
        .split(' ')
        .every((w, i) =>
          w === '&' || (i > 0 && SHORT.has(w.toLowerCase()))
            ? w === '&' || w === w.toLowerCase()
            : w.split('-').every(p => /^[A-Z0-9]/.test(p)),
        );
    // Names use "&", never the word "and".
    const bad = rows.filter(
      r => r.d.short_label.length > 20 || !titleCase(r.d.short_label) || /\band\b/i.test(r.d.short_label),
    );
    expect(list(bad, r => `${r.d.id} ${r.d.short_label}`)).toEqual([]);
    for (const key of keys) {
      const names = rows.filter(r => r.key === key).map(r => r.d.short_label.toLowerCase());
      expect(
        names.filter((n, i) => names.indexOf(n) !== i),
        key,
      ).toEqual([]);
    }
  });

  it('gives the same wording the same name in every course', () => {
    const byRaw = new Map();
    for (const r of rows) {
      const name = r.d.short_label.replace(/ \d+$/, '');
      byRaw.set(r.raw, (byRaw.get(r.raw) || new Set()).add(name));
    }
    const split = [...byRaw].filter(([, names]) => names.size > 1);
    expect(split.map(([raw, names]) => `${[...names].join(' / ')}: ${raw}`)).toEqual([]);
  });

  it('gives no name that is the statement’s first words, cut', () => {
    const cut = rows.filter(r => {
      const lw = words(r.d.short_label);
      const rw = words(r.raw);
      const prefix = lw.length > 0 && rw.slice(0, lw.length).join(' ') === lw.join(' ');
      const sameStart = r.d.short_label.split(' ')[0].toLowerCase() === r.raw.split(' ')[0].toLowerCase();
      return prefix && sameStart && lw.length >= 3 && rw.length > lw.length && r.siblings > 1;
    });
    expect(list(cut, r => `${r.d.id} ${r.d.short_label}`)).toEqual([]);
  });

  it('ends every name on a word, not a dangling and / of / using', () => {
    const bad = rows.filter(r => /\b(and|or|of|to|in|for|with|using|how|about|the|a|an)$/i.test(r.d.short_label));
    expect(list(bad, r => `${r.d.id} ${r.d.short_label}`)).toEqual([]);
  });

  it('names folders from the Ministry heading, 30 characters or fewer', () => {
    for (const key of keys) {
      // A course with phases prints "Applied Design" as their parent heading:
      // it stays in path and is never a folder, however much sits under it.
      const phased = source[key].categories.some(c => c.path.length > 1);
      source[key].categories.forEach((cat, ci) => {
        const d = derived[key].categories[ci];
        const heading = cat.path.length ? cat.path[cat.path.length - 1] : '';
        const parent = phased && cat.path.length === 1 && heading === 'Applied Design';
        if (source[key].subject === 'Social Studies' || !heading || cat.competencies.length === 1 || parent) {
          expect(d.folder, `${key} ${heading}`).toBeNull();
          return;
        }
        expect(d.folder.length, d.folder).toBeLessThanOrEqual(30);
        // Every word of the folder name is in the official path; the bracket gloss is not.
        const pathWords = new Set(words(cat.path.join(' ')));
        expect(
          words(d.folder).filter(w => !pathWords.has(w)),
          `${key} ${d.folder}`,
        ).toEqual([]);
        expect(d.folder, key).not.toMatch(/\(/);
      });
    }
  });

  it('gives no name the same as a BC Core Competency, which FullVision tracks apart', () => {
    const core = new Set(CORE_COMPETENCIES.map(c => c.label.toLowerCase()));
    expect(
      list(
        rows.filter(r => core.has(r.d.short_label.toLowerCase())),
        r => `${r.d.id} ${r.d.short_label}`,
      ),
    ).toEqual([]);
  });

  it('gives no name the same as its folder', () => {
    const bad = rows.filter(r => r.dcat.folder && r.dcat.folder.toLowerCase() === r.d.short_label.toLowerCase());
    expect(list(bad, r => `${r.d.id} ${r.d.short_label}`)).toEqual([]);
  });

  it('records where every value came from', () => {
    for (const r of rows) {
      expect(r.d.prov.code, r.d.id).toMatch(/^(stem\+position|concept)$/);
      expect(r.d.prov.short_label, r.d.id).toMatch(/^(rule:\w+|concept|list)$/);
      expect(typeof r.d.prov.rule, r.d.id).toBe('string');
      expect(r.d.prov.folder, r.d.id).toMatch(/^(heading|short list|none: .+)$/);
    }
  });

  it('marks Social Studies names from a hand list as such', () => {
    // A concept used twice (SIG1, SIG2) or a statement with no concept (INQ)
    // is named from a list in the script, not from the bracket concept.
    const ss = rows.filter(r => r.subject === 'Social Studies');
    const listed = ss.filter(r => /\d$/.test(r.d.code) || ['INQ', 'IPR', 'RLV'].includes(r.d.code));
    expect(
      list(
        listed.filter(r => r.d.prov.short_label !== 'list'),
        r => r.d.id,
      ),
    ).toEqual([]);
    expect(
      list(
        listed.filter(r => r.d.prov.rule.startsWith('(')),
        r => r.d.id,
      ),
    ).toEqual([]);
    const concept = ss.filter(r => !listed.includes(r));
    expect(
      list(
        concept.filter(r => r.d.prov.short_label !== 'concept'),
        r => r.d.id,
      ),
    ).toEqual([]);
  });

  it('is exactly what the script builds', () => {
    let out = '';
    try {
      out = execFileSync('python3', ['scripts/bc_curriculum_derive.py', 'check'], { encoding: 'utf-8' });
    } catch (e) {
      throw new Error((e.stdout || '') + (e.stderr || ''));
    }
    expect(out).toMatch(/check: 0 problem\(s\), 0 unplaced/);
  });
});
