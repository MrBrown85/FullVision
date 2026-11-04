/**
 * Round three, lane I (Nov 1): the Overall frames for a second-language
 * class (bank n859–n891). The table's languages skills run 11 to 17 words,
 * so the untagged frames that carry {strengths} or {evenSkill} realise over
 * 20 words for most of them and are never drafted. The languages frames
 * carry no slot for the skill:
 * - even results: per proficiency word (`when.evenWord`), the picture only;
 *   the ones that print the word fit a Proficiency class, the rest a Letter
 *   class too;
 * - the climb story: the marks rose (claims improved), no skill;
 * - the hidden and newcomer stories: one per skill (`when.topSkill`), the
 *   story and the strength in one sentence within 20 words.
 * Each fits a they/them student within 20 words and verifies.
 */
import './setup.js';
import { describe, expect, it } from 'vitest';

const THEY = { subj: 'they', obj: 'them', poss: 'their', refl: 'themselves' };
const WORDS = ['Extending', 'Proficient', 'Developing', 'Emerging'];
const LEVEL = { Extending: 3.8, Proficient: 3.1, Developing: 2.1, Emerging: 1.2 };

function day(n) {
  const d = new Date(2026, 8, 1 + n);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
const pts = (vs, gap = 7) => vs.map((v, i) => ({ id: 'w' + i, d: day(i * gap), v, title: 'Task ' + i }));
const comp = (id, name, level, n = 3, scores) => ({
  id,
  name,
  scores: scores || pts(Array(n).fill(level)),
  start: level,
  now: level,
  level,
  iCans: [],
});
const piece = (id, title, d, pct) => ({ id, title, d, v: pct / 25, pct, note: '' });
const facts = over =>
  Object.assign(
    {
      cid: 'c-languages',
      sid: 's1',
      name: 'Alexandria',
      first: 'Alexandria',
      course: 'Core French 10',
      family: 'languages',
      pronouns: THEY,
      pronounsOnFile: false,
      comps: [],
      work: pts([3, 3, 3]),
      voice: {},
      confidence: [],
      record: { total: 6, handed: 6, late: 0, missing: 0 },
      notHandedIn: { count: 0, titles: [], groups: [] },
      habits: {},
      overall: 3.1,
      standing: 'Proficient',
      letter: '',
      grade: { mode: 'proficiency', pieces: [] },
      levelText: () => '',
      enrolled: '',
      classStart: '',
      termStart: '',
      absent: 0,
      late: 0,
    },
    over,
  );
const verified = (s, text, pv, f, step) =>
  CommentBank.verify({ text, sentences: [{ id: s.id, part: s.part, step, text }], provenance: [pv] }, f, {});
const mine = COMMENT_BANK.sentences.filter(
  s => s.group === 'Overall' && s.subjects && s.subjects[0] === 'languages' && !(s.when && s.when.topSkill && !s.story),
);
const wc = t => CommentRealiser.wordCount(t);
/* Fills, checks the length and the slots, and that verify() keeps it. */
function realised(s, ctx, f) {
  const t = CommentBank.fill(s, ctx, { first: true });
  expect(t, s.id).not.toMatch(/[{}[\]]/);
  expect(wc(t), s.id + ': ' + t).toBeLessThanOrEqual(20);
  expect(verified(s, t, CommentBank.provenance(s, ctx), f, 'overall').replaced, s.id).toEqual([]);
  return t;
}

describe('the languages Overall frames', () => {
  it('are 33: twelve even, three climb, nine hidden and nine newcomer, all tagged languages (live or retired)', () => {
    // Since Nov 4 2026 the ones with a banned phrase are retired, their text
    // kept (COMMENT_BANK.retired); the rest stay in Browse.
    const gone = COMMENT_BANK.retired.filter(
      s => s.group === 'Overall' && (s.subjects || []).indexOf('languages') >= 0 && s.retired === '2026-11-04',
    );
    const both = mine.concat(gone);
    expect(both.length).toBe(33);
    expect(both.filter(s => s.when && s.when.evenWord).length).toBe(12);
    expect(both.filter(s => s.story === 'climb').length).toBe(3);
    expect(both.filter(s => s.story === 'hidden').length).toBe(9);
    expect(both.filter(s => s.story === 'newcomer').length).toBe(9);
    mine.forEach(s => expect(CommentLint.findings(s.text), s.id).toEqual([]));
    mine.forEach(s => {
      expect(s.subjects, s.id).toEqual(['languages']);
      expect(s.text, s.id).not.toMatch(/\{(strengths?|evenSkill|topSkill)\}/);
      // Nothing that is false for a signed language.
      expect(s.text, s.id).not.toMatch(/\b(speak|hear|pronounc|spell|accent)/i);
    });
  });

  WORDS.forEach(w =>
    it(`${w}: the even frames fit the even-results tier, print the word only in a Proficiency class, and verify`, () => {
      const comps = [
        comp('a', 'Listening', LEVEL[w]),
        comp('b', 'Speaking', LEVEL[w] - 0.3),
        comp('c', 'Culture', LEVEL[w] - 0.2, 1),
      ];
      const f = facts({ comps, overall: LEVEL[w], standing: w });
      const ctx = CommentBank.context(f, {});
      expect(ctx._evenWord).toBe(w);
      const pool = CommentBank.stepPool('overall', ctx).map(s => s.id);
      const even = mine.filter(s => s.when && s.when.evenWord === w);
      expect(even.length).toBeLessThanOrEqual(3);
      even.forEach(s => {
        expect(pool, s.id).toContain(s.id);
        expect(s.claims, s.id).toEqual(['evenResults']);
        const t = realised(s, ctx, f);
        if (s.needs.indexOf('evenWord') >= 0) expect(t, s.id).toContain(w);
        else WORDS.forEach(x => expect(t, s.id).not.toContain(x));
        const changed = Object.assign({}, f, { comps: [comp('a', 'Listening', 3.9), comp('b', 'Speaking', 2.8)] });
        expect(verified(s, t, CommentBank.provenance(s, ctx), changed, 'overall').replaced.length, s.id).toBe(1);
      });
      // Generate says the strength in the pipeline's frames (Nov 4 2026),
      // never the even results as a list.
      const d = CommentBank.draft(ctx, { seed: 2 });
      expect(d.replaced).toEqual([]);
      d.sentences.forEach(x => expect(x.text).not.toMatch(/across (all )?(the )?skills|marks are close/));
      // A Letter class: only the frames that do not print the word fit.
      const lf = facts({
        comps,
        overall: LEVEL[w],
        standing: '',
        letter: 'a B (78%)',
        grade: { mode: 'letter', letter: 'B', pct: 78, pieces: [] },
      });
      const lpool = CommentBank.stepPool('overall', CommentBank.context(lf, {})).map(s => s.id);
      even.forEach(s => expect(lpool.includes(s.id), s.id).toBe(s.needs.indexOf('evenWord') < 0));
    }),
  );

  it('the climb frames fit a student whose marks rose and say no skill', () => {
    const pieces = [
      piece('p1', 'A', '2026-09-08', 55),
      piece('p2', 'B', '2026-09-22', 62),
      piece('p3', 'C', '2026-10-06', 78),
      piece('p4', 'D', '2026-10-20', 90),
    ];
    const scores = pieces.map(p => ({ id: p.id, d: p.d, v: p.v, title: p.title }));
    const f = facts({
      comps: [
        comp('a', 'Reading', 3.2, 4, scores),
        comp(
          'b',
          'Culture',
          2.5,
          4,
          scores.map(x => ({ ...x, v: x.v - 0.6 })),
        ),
      ],
      work: pieces,
      overall: 3.2,
      record: { total: 4, handed: 4, late: 0, missing: 0 },
      grade: { mode: 'proficiency', pieces, marked: { mine: 4, all: 4 } },
    });
    const ctx = CommentBank.context(f, {});
    expect(ctx.climb).toBe('yes');
    const pool = CommentBank.stepPool('overall', ctx).map(s => s.id);
    mine
      .filter(s => s.story === 'climb')
      .forEach(s => {
        expect(s.needs, s.id).toEqual(['climb']);
        expect(s.claims, s.id).toEqual(['improved']);
        expect(pool, s.id).toContain(s.id);
        realised(s, ctx, f);
      });
    const d = CommentBank.draft(ctx, { seed: 1 });
    const ov = d.sentences.find(x => x.step === 'overall');
    expect(ov && ov.text).toMatch(/in the language/i);
  });

  CommentBank.SKILLS.languages.forEach(row =>
    it(`${row.key}: the hidden and newcomer frames fit their story with the skill, and no other`, () => {
      const base = { comps: [comp('a', row.name, 4), comp('b', 'Other Area', 2.5)] };
      const hid = mine.find(s => s.story === 'hidden' && s.when.topSkill === row.key);
      const nw = mine.find(s => s.story === 'newcomer' && s.when.topSkill === row.key);
      expect(hid.needs).toEqual(['hidden', 'topSkill']);
      expect(nw.needs).toEqual(['newcomer', 'topSkill']);
      const hf = facts(
        Object.assign({}, base, {
          record: { total: 10, handed: 6, late: 0, missing: 4 },
          notHandedIn: { count: 4, titles: ['A', 'B', 'C', 'D'], groups: [] },
          grade: { mode: 'proficiency', pieces: [], marked: { mine: 6, all: 10 } },
        }),
      );
      const hctx = CommentBank.context(hf, {});
      expect(hctx.hidden).toBe('yes');
      expect(CommentBank.stepPool('overall', hctx).map(s => s.id)).toContain(hid.id);
      realised(hid, hctx, hf);
      const nf = facts(
        Object.assign({}, base, { enrolled: '2026-10-13', classStart: '2026-09-03', termStart: '2026-09-01' }),
      );
      const nctx = CommentBank.context(nf, {});
      expect(nctx.newcomer).toBe('yes');
      expect(CommentBank.stepPool('overall', nctx).map(s => s.id)).toContain(nw.id);
      realised(nw, nctx, nf);
      // A plain strongest: neither story frame is in the pool.
      const pool = CommentBank.stepPool('overall', CommentBank.context(facts(base), {})).map(s => s.id);
      expect(pool).not.toContain(hid.id);
      expect(pool).not.toContain(nw.id);
    }),
  );
});
