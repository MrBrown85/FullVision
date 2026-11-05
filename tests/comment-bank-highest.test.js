/**
 * Strengths for a staircase (Nov 2): the student's own highest-marked skill.
 *
 * - highestOf: no other route holds (strongest, a tie at the top, even
 *   results); two or more competencies judged on 3+ pieces; the judged
 *   ones at the highest proficiency as it prints, the next step's left out.
 * - highestSkills: those as skills from the table, the next step's skill
 *   left out; the skill named for the fewest classmates first, then the
 *   shortest wording.
 * - The frames (`when.highestWord`) say what the work shows at the
 *   competency's own proficiency word; the ones that say "highest" or
 *   "where {his} marks are highest" need `highestTop` (no competency with
 *   a level above).
 * - verify() checks the competency is still one of the highest-marked ones
 *   and not the next step, in the table's wording, at its own word.
 * - Browse Sentences: "Highest Marks · {word}" under Strengths.
 */
import './setup.js';
import { describe, expect, it } from 'vitest';

const HE = { subj: 'he', obj: 'him', poss: 'his', refl: 'himself' };
const THEY = { subj: 'they', obj: 'them', poss: 'their', refl: 'themselves' };
const WORDS = ['Extending', 'Proficient', 'Developing', 'Emerging'];
const RQ = ReportQuestionnaire;

function day(n) {
  const d = new Date(2026, 8, 1 + n);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
const pts = (vs, gap = 7) => vs.map((v, i) => ({ id: 'w' + i, d: day(i * gap), v, title: 'Task ' + i }));
const comp = (id, name, level, n = 3) => ({
  id,
  name,
  scores: pts(Array(n).fill(level)),
  start: level,
  now: level,
  level,
  iCans: [],
});
const ids = xs => xs.map(c => c.id);
const skillWords = (family, key) => CommentBank.SKILLS[family].find(r => r.key === key).skill;

function facts(comps, over) {
  return Object.assign(
    {
      cid: 'c-high',
      sid: 's1',
      name: 'Noor',
      first: 'Noor',
      course: 'History 12',
      family: 'socials',
      pronouns: HE,
      pronounsOnFile: true,
      comps,
      work: pts([3, 3, 3]),
      voice: {},
      confidence: [],
      record: { total: 6, handed: 6, late: 0, missing: 0 },
      notHandedIn: { count: 0, titles: [], groups: [] },
      habits: {},
      overall: 2.8,
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
}
/* A staircase: two at 3.0, then 2.8, 2.7, 2.5, and the next step a full
   step and more below. No half-step lead anywhere, so no strongest and no
   tie; a 2.0 spread, so not even. */
const stairs = () => [
  comp('a', 'Evidence', 3.0),
  comp('b', 'Significance', 3.0, 4),
  comp('c', 'Cause and Consequence', 2.8),
  comp('d', 'Continuity and Change', 2.7),
  comp('e', 'Inquiry', 2.5),
  comp('f', 'Perspective', 1.0),
];
const frames = COMMENT_BANK.sentences.filter(s => s.when && s.when.highestWord);
const isHigh = id => /^n10\d\d$/.test(id) && frames.some(s => s.id === id);
const verified = (s, text, pv, f) =>
  CommentBank.verify({ text, sentences: [{ id: s.id, part: s.part, step: 'overall', text }], provenance: [pv] }, f, {});

describe('the highest-marked skill (highestOf)', () => {
  it('holds for a staircase: the judged competencies at the highest proficiency, the next step left out', () => {
    const f = facts(stairs());
    expect(CommentBank.strongestOf(f.comps)).toEqual([]);
    expect(CommentBank.topTieOf(f.comps)).toEqual([]);
    expect(CommentBank.evenComps(f.comps, f.overall)).toEqual([]);
    expect(CommentBank.nextStepOf(f.comps).id).toBe('f');
    expect(ids(CommentBank.highestOf(f.comps, f.overall))).toEqual(['a', 'b']);
    const ctx = CommentBank.context(f, {});
    expect(ctx.strengths).toBe('');
    expect(ctx._topSkill).toBe('');
    expect(ctx.evenResults).toBe('');
    // The shorter wording first: Evidence's eight words, Significance's nine.
    expect(ctx._highestSkills.map(x => x.key)).toEqual(['evidence', 'significance']);
    expect(ctx.highestSkill).toBe(skillWords('socials', 'evidence'));
    expect(ctx._highestWord).toBe('Proficient');
    expect(ctx.highestTop).toBe('yes');
  });

  it('comes after strongest, a tie and even results', () => {
    const strongest = [comp('a', 'Evidence', 3.6), comp('b', 'Significance', 2.8), comp('c', 'Inquiry', 2.6)];
    expect(CommentBank.strongestOf(strongest).length).toBe(1);
    expect(CommentBank.highestOf(strongest, 3)).toEqual([]);
    const tie = [
      comp('a', 'Evidence', 3.6),
      comp('b', 'Significance', 3.4),
      comp('c', 'Cause and Consequence', 3.3),
      comp('d', 'Inquiry', 2.6),
    ];
    expect(CommentBank.strongestOf(tie)).toEqual([]);
    expect(CommentBank.topTieOf(tie).length).toBe(3);
    expect(CommentBank.highestOf(tie, 3.2)).toEqual([]);
    const even = [comp('a', 'Evidence', 3.1), comp('b', 'Significance', 3.0), comp('c', 'Inquiry', 2.9)];
    expect(CommentBank.evenComps(even, 3).length).toBe(3);
    expect(CommentBank.highestOf(even, 3)).toEqual([]);
    const ctx = CommentBank.context(facts(tie, { overall: 3.2 }), {});
    expect(ctx._topSkill).not.toBe('');
    expect(ctx.highestSkill).toBe('');
  });

  it('needs two or more judged competencies: one skill on 3+ pieces names nothing', () => {
    const comps = [comp('a', 'Evidence', 3.0), comp('b', 'Significance', 3.0, 2), comp('c', 'Inquiry', 2.0, 1)];
    expect(CommentBank.strongestOf(comps)).toEqual([]);
    expect(CommentBank.topTieOf(comps)).toEqual([]);
    expect(CommentBank.highestOf(comps, 2.8)).toEqual([]);
    const ctx = CommentBank.context(facts(comps), {});
    expect(ctx.highestSkill).toBe('');
    expect(ctx._highestWord).toBe('');
    expect(CommentBank.stepPool('overall', ctx).filter(s => isHigh(s.id))).toEqual([]);
    // The strength still comes (Colin, Nov 4: every part, every comment),
    // from another route, never a highest-marked frame.
    const d = CommentBank.draft(ctx, { seed: 1 });
    const o = d.sentences.find(x => x.step === 'overall');
    expect(o).toBeTruthy();
    expect(isHigh(o.id)).toBe(false);
  });

  it('leaves out the next step, even when it ties at the top, and says "highest" only with nothing above', () => {
    // Evidence and Significance both 3.0 on 3 pieces; Evidence, first in
    // report order, is the next step. Inquiry, on one piece, sits above.
    const comps = [comp('a', 'Evidence', 3.0), comp('b', 'Significance', 3.0), comp('c', 'Inquiry', 3.6, 1)];
    const f = facts(comps);
    expect(CommentBank.strongestOf(comps)).toEqual([]);
    expect(CommentBank.topTieOf(comps)).toEqual([]);
    expect(CommentBank.evenComps(comps, f.overall)).toEqual([]);
    expect(CommentBank.nextStepOf(comps).id).toBe('a');
    expect(ids(CommentBank.highestOf(comps, f.overall))).toEqual(['b']);
    const ctx = CommentBank.context(f, {});
    expect(ctx.highestSkill).toBe(skillWords('socials', 'significance'));
    expect(ctx.highestTop).toBe('');
    const pool = CommentBank.stepPool('overall', ctx);
    expect(pool.length).toBeGreaterThan(0);
    pool.forEach(s => {
      expect(s.when.highestWord, s.id).toBe('Proficient');
      expect(s.needs, s.id).not.toContain('highestTop');
    });
    const d = CommentBank.draft(ctx, { seed: 3 });
    const row = d.sentences.find(x => x.step === 'overall');
    expect(row.text).toContain(skillWords('socials', 'significance'));
    expect(row.text).not.toContain(skillWords('socials', 'evidence'));
    expect(d.replaced).toEqual([]);
  });

  it('across a class, names the top skill the fewest classmates have, two equal tops in turn', () => {
    const keys = [];
    const comments = [];
    for (let i = 1; i <= 4; i++) {
      const f = facts(stairs(), { cid: 'c-high-spread', sid: 'st' + i });
      const ctx = CommentBank.context(f, {});
      const d = CommentBank.draft(ctx, { seed: i, comments: comments.slice() });
      comments.push({ sid: 'st' + i, text: d.text });
      const row = d.sentences.find(x => x.step === 'overall');
      expect(row, 'student ' + i).toBeTruthy();
      expect(isHigh(row.id), row.id).toBe(true);
      const named = ['evidence', 'significance'].filter(k => row.text.indexOf(skillWords('socials', k)) >= 0);
      expect(named.length, row.text).toBe(1);
      expect(d.replaced).toEqual([]);
      keys.push(named[0]);
    }
    expect(keys).toEqual(['evidence', 'significance', 'evidence', 'significance']);
  });
});

describe('verify() for the highest-marked skill', () => {
  const f = facts(stairs());
  const ctx = CommentBank.context(f, {});
  const s = frames.find(x => x.when.highestWord === 'Proficient');
  const text = CommentBank.fill(s, ctx, { first: true });
  const pv = CommentBank.provenance(s, ctx);
  const named = (id, key, over) =>
    Object.assign({}, pv, {
      values: Object.assign({}, pv.values, { highestSkill: skillWords('socials', key) }, over),
      sources: Object.assign({}, pv.sources, { highestSkill: ['comp:' + id] }),
    });

  it('accepts either equal top, in the table’s wording, and nothing else', () => {
    expect(pv.sources.highestSkill).toEqual(['comp:a']);
    expect(pv.factKeys).toContain('comp:a');
    expect(verified(s, text, pv, f).replaced).toEqual([]);
    expect(verified(s, text, named('b', 'significance'), f).replaced).toEqual([]);
    // A competency below the top.
    expect(verified(s, text, named('c', 'cause'), f).replaced.length).toBe(1);
    // The next step.
    expect(verified(s, text, named('f', 'perspective'), f).replaced.length).toBe(1);
    // Another competency's wording.
    expect(verified(s, text, named('a', 'significance'), f).replaced.length).toBe(1);
    // Another proficiency word.
    expect(verified(s, text, named('a', 'evidence', { 'when.highestWord': 'Extending' }), f).replaced.length).toBe(1);
  });

  it('fails once another route holds, or the competency drops below the top', () => {
    const now = stairs();
    now[1] = comp('b', 'Significance', 3.6, 4);
    // Significance now leads by half a step: the strongest, not this route.
    expect(CommentBank.strongestOf(now).length).toBe(1);
    expect(verified(s, text, pv, facts(now)).replaced.length).toBe(1);
    const lower = stairs();
    lower[0] = comp('a', 'Evidence', 2.9);
    expect(verified(s, text, pv, facts(lower)).replaced.length).toBe(1);
  });

  it('fails a frame that says "highest" once a competency on any number of pieces sits above', () => {
    const dev = stairs().map(c => comp(c.id, c.name, c.level - 1, c.scores.length));
    const fd = facts(dev, { overall: 1.8, standing: 'Developing' });
    const dctx = CommentBank.context(fd, {});
    expect(dctx._highestWord).toBe('Developing');
    expect(dctx.highestTop).toBe('yes');
    const ranked = frames.find(x => x.when.highestWord === 'Developing' && x.needs.indexOf('highestTop') >= 0);
    const t = CommentBank.fill(ranked, dctx, { first: true });
    const rpv = CommentBank.provenance(ranked, dctx);
    expect(verified(ranked, t, rpv, fd).replaced).toEqual([]);
    const above = facts(dev.concat([comp('g', 'Ethical Judgment', 2.6, 1)]), { overall: 1.8, standing: 'Developing' });
    expect(CommentBank.context(above, {}).highestTop).toBe('');
    expect(verified(ranked, t, rpv, above).replaced.length).toBe(1);
  });
});

describe('the highest-marked skill frames', () => {
  // Five for Extending and Developing since Nov 4: n1026 and n1027 read the
  // same as n1007 and n1013 once "is able to" became "can".
  it('has five or more structurally different frames for each proficiency word, for every kind of class', () => {
    WORDS.forEach(w => {
      const mine = frames.filter(s => s.when.highestWord === w);
      expect(mine.length, w).toBeGreaterThanOrEqual(5);
      expect(new Set(mine.map(s => s.text)).size, w).toBe(mine.length);
      mine.forEach(s => {
        expect(s.group, s.id).toBe('Overall');
        expect(s.claims, s.id).toEqual(['strength']);
        expect(Object.keys(s.when), s.id).toEqual(['highestWord']);
        expect(s.subjects, s.id).toBeUndefined();
        expect(s.except, s.id).toBeUndefined();
        expect(s.needs[0], s.id).toBe('highestSkill');
        // A frame that ranks within the student's own work needs nothing
        // with a level above; none ranks against anyone else.
        const ranks = /\bhighest\b/.test(s.text);
        expect(s.needs.indexOf('highestTop') >= 0, s.id).toBe(ranks);
        expect(s.text, s.id).not.toMatch(/\b(strongest|best|most|top|strength)\b/i);
        expect(CommentLint.findings(s.text), s.id).toEqual([]);
      });
    });
    expect(frames.length).toBe(22);
  });

  it('binds the verb to the competency’s own word: can, learning to, beginning to', () => {
    frames.forEach(s => {
      const w = s.when.highestWord;
      if (w === 'Extending' || w === 'Proficient') expect(s.text, s.id).toMatch(/\bcan\b|able to/);
      if (w === 'Developing') expect(s.text, s.id).toMatch(/learn|building/i);
      if (w === 'Emerging') expect(s.text, s.id).toMatch(/beginning to|begun to|begin/i);
    });
  });

  it('fills every frame for he and for they, within 20 words with a skill of each kind of class', () => {
    Object.keys(CommentBank.SKILLS).forEach(fam => {
      CommentBank.SKILLS[fam].forEach(r => {
        WORDS.forEach(w => {
          const ctx = {
            _p: HE,
            name: 'Noor',
            highestSkill: r.skill,
            highestTop: 'yes',
            _highestWord: w,
            _highestSkill: r.key,
          };
          let fit = 0;
          frames
            .filter(s => s.when.highestWord === w)
            .forEach(s => {
              [HE, THEY].forEach(p => {
                const t = CommentBank.fill(s, Object.assign({}, ctx, { _p: p }), { first: true });
                expect(t, s.id).not.toMatch(/[{}[\]]|\bthey (is|has|learns|begins|shows)\b/);
              });
              if (!CommentRealiser.tooLong(CommentBank.fill(s, ctx))) fit++;
            });
          // Every skill fits a frame at every word: no wording in the table
          // runs past twelve words (Nov 2).
          expect(CommentRealiser.wordCount(r.skill), fam + ':' + r.key).toBeLessThanOrEqual(12);
          expect(fit, fam + ':' + r.key + ':' + w).toBeGreaterThan(0);
        });
      });
    });
  });

  it('prints the Emerging frames as a start, where the marks are highest, never a deficit', () => {
    // 1.4, 1.4, 1.2, 1.0: all Emerging, the overall Developing from other
    // work, so not even results.
    const comps = [
      comp('a', 'Evidence', 1.4),
      comp('b', 'Significance', 1.4),
      comp('c', 'Cause and Consequence', 1.2),
      comp('d', 'Inquiry', 1.0),
    ];
    const f = facts(comps, { overall: 2.0, standing: 'Developing' });
    expect(CommentBank.evenComps(comps, 2.0)).toEqual([]);
    const ctx = CommentBank.context(f, {});
    expect(ctx._highestWord).toBe('Emerging');
    expect(ctx.highestTop).toBe('yes');
    const pool = CommentBank.stepPool('overall', ctx);
    expect(pool.length).toBe(frames.filter(s => s.when.highestWord === 'Emerging').length);
    pool.forEach(s => {
      const t = CommentBank.fill(s, ctx, { first: true });
      expect(t, s.id).toMatch(/beginning to|begun to|begins to/i);
      expect(t, s.id).not.toMatch(/\b(not yet|struggl|difficult|weak|low|behind)\b/i);
      expect(verified(s, t, CommentBank.provenance(s, ctx), f).replaced, s.id).toEqual([]);
    });
    expect(pool.filter(s => /marks are highest/.test(s.text)).length).toBe(3);
    const d = CommentBank.draft(ctx, { seed: 2 });
    const row = d.sentences.find(x => x.step === 'overall');
    expect(isHigh(row.id)).toBe(true);
    expect(d.replaced).toEqual([]);
  });

  it('takes the next equal top when the first runs past 20 words', () => {
    // Developing in a Languages class: Writing's wording is twelve words,
    // Reading's ten; "is learning to …, where {his} marks are highest" has
    // nine of its own.
    const comps = [
      comp('a', 'Writing', 2.0),
      comp('b', 'Reading', 2.0),
      comp('c', 'Vocabulary', 1.8),
      comp('d', 'Culture', 1.7),
      comp('e', 'Grammar', 1.5),
      comp('f', 'Speaking', 1.0),
    ];
    const f = facts(comps, { family: 'languages', course: 'Core French 10', overall: 1.8, standing: 'Developing' });
    expect(CommentBank.topTieOf(comps)).toEqual([]);
    const ctx = CommentBank.context(f, {});
    expect(ctx._highestSkills.map(x => x.key)).toEqual(['reading', 'writing']);
    const first = Object.assign({}, ctx, {
      highestSkill: skillWords('languages', 'writing'),
      _highestSkill: 'writing',
      _highestSkills: ctx._highestSkills.slice().reverse(),
      _facts: Object.assign({}, ctx._facts, { highestSkill: ['comp:a'] }),
    });
    const s = frames.find(
      x => x.when.highestWord === 'Developing' && /^\{He\} \[is\|are\] learning to .*, where/.test(x.text),
    );
    expect(
      CommentRealiser.tooLong(CommentBank.fill(s, Object.assign({}, ctx, { highestSkill: first.highestSkill }))),
    ).toBe(true);
    const text = CommentBank.fill(s, first);
    expect(CommentRealiser.tooLong(text)).toBe(false);
    expect(text).toContain(skillWords('languages', 'reading'));
    const pv = CommentBank.provenance(s, first);
    expect(pv.sources.highestSkill).toEqual(['comp:b']);
    expect(verified(s, text, pv, f).replaced).toEqual([]);
  });
});

describe('Browse Sentences', () => {
  it('lists Highest Marks by proficiency word under Strengths, and the student’s own first', () => {
    const cases = RQ.browseCases('strengths');
    WORDS.forEach(w => expect(cases.find(c => c.id === 'high:' + w).label).toBe('Highest Marks · ' + w));
    frames.forEach(s => expect(RQ.browseCase('strengths', s), s.id).toEqual(['high:' + s.when.highestWord]));
    const ctx = CommentBank.context(facts(stairs()), {});
    expect(RQ.browseOwn('strengths', ctx)[0]).toBe('high:Proficient');
  });
});
