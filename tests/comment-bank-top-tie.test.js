/**
 * Strengths for a tie at the top (Nov 1): with 8–12 competencies several
 * tie at the top, so the "strongest" gate finds no half-step lead and most
 * students got no strengths sentence.
 *
 * - topTieOf: nothing past the "strongest" gate; two or more competencies,
 *   each on 3+ pieces, within half a step of the highest, every one of them
 *   half a step or more over the rest (of which there is at least one).
 * - topSkillOf: the strongest skill, else one of the tie: the skill named
 *   for the fewest classmates this session, then the shortest wording.
 * - The per-skill frames that do not assert "strongest" (`when.topSkill`)
 *   fit under the strongest and under the tie; the ones that do
 *   (`when.strongSkill`) stay gated on the strongest.
 * - Order: strongest, then the tie, then even results.
 * - verify() checks the tie facts; the At a Glance tag stays "Strongest".
 */
import './setup.js';
import { describe, expect, it } from 'vitest';

const HE = { subj: 'he', obj: 'him', poss: 'his', refl: 'himself' };
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
/* A competency named by its id, for the gate tests. */
const c = (id, level, n) => comp(id, 'Area ' + id, level, n);

function facts(comps, over) {
  return Object.assign(
    {
      cid: 'c-tie',
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
      overall: 3.2,
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
/* Three at the top within half a step (3.6, 3.4, 3.3), one a full step
   below: a tie, no strongest. */
const tieComps = () => [
  comp('a', 'Evidence', 3.6),
  comp('b', 'Significance', 3.4),
  comp('c', 'Cause and Consequence', 3.3),
  comp('d', 'Inquiry', 2.6),
];
const byId = id => COMMENT_BANK.sentences.find(s => s.id === id);
const topFrames = COMMENT_BANK.sentences.filter(s => s.group === 'Overall' && s.when && s.when.topSkill);
const strongFrames = COMMENT_BANK.sentences.filter(s => s.group === 'Overall' && s.when && s.when.strongSkill);
const skillWords = key => CommentBank.SKILLS.socials.find(r => r.key === key).skill;
const wc = t => CommentRealiser.wordCount(t);
const verified = (s, text, pv, f, step) =>
  CommentBank.verify({ text, sentences: [{ id: s.id, part: s.part, step, text }], provenance: [pv] }, f, {});

describe('the tie at the top (topTieOf)', () => {
  it('holds for three within half a step of the highest, all half a step or more over the rest', () => {
    const comps = tieComps();
    expect(CommentBank.strongestOf(comps)).toEqual([]);
    expect(ids(CommentBank.topTieOf(comps))).toEqual(['a', 'b', 'c']);
    // Exactly half a step over the rest counts (3.3 over 2.8).
    expect(ids(CommentBank.topTieOf([c('a', 3.6), c('b', 3.4), c('c', 3.3), c('d', 2.8)]))).toEqual(['a', 'b', 'c']);
  });

  it('fails under half a step over the rest, with a tied competency on two pieces, or with no rest', () => {
    // 3.3 over 2.9 is not half a step.
    expect(CommentBank.topTieOf([c('a', 3.6), c('b', 3.4), c('c', 3.3), c('d', 2.9)])).toEqual([]);
    // A tied competency on two pieces.
    expect(CommentBank.topTieOf([c('a', 3.6), c('b', 3.4, 2), c('c', 3.3), c('d', 2.6)])).toEqual([]);
    // Every competency within half a step: the even case, not a tie.
    expect(CommentBank.topTieOf([c('a', 3.6), c('b', 3.4), c('c', 3.3)])).toEqual([]);
    expect(CommentBank.topTieOf([c('a', 3.4), c('b', 3.2)])).toEqual([]);
    // Half a step below the highest is the rest (3.1), and the tie is only 0.3 over it.
    expect(CommentBank.topTieOf([c('a', 3.6), c('b', 3.4), c('c', 3.1)])).toEqual([]);
    // Two at the top half a step over the third pass the strongest gate instead.
    expect(ids(CommentBank.strongestOf([c('a', 3.6), c('b', 3.5), c('c', 2.8)]))).toEqual(['a', 'b']);
    expect(CommentBank.topTieOf([c('a', 3.6), c('b', 3.5), c('c', 2.8)])).toEqual([]);
  });

  it('yields to the strongest gate, and ignores a competency with no level', () => {
    const strong = [comp('a', 'Evidence', 4), comp('b', 'Significance', 3.4), comp('c', 'Cause', 3.3)];
    expect(ids(CommentBank.strongestOf(strong))).toEqual(['a']);
    expect(CommentBank.topTieOf(strong)).toEqual([]);
    expect(ids(CommentBank.topTieOf(tieComps().concat([comp('e', 'Perspective', 0)])))).toEqual(['a', 'b', 'c']);
  });

  it('names the tied skills from the table, the next step left out', () => {
    const f = facts(tieComps());
    expect(CommentBank.nextStepOf(f.comps).id).toBe('d');
    expect(CommentBank.topTieSkills(f).map(x => x.key)).toEqual(['evidence', 'significance', 'cause']);
    // The rest on one piece: the next step is the lowest of the tie, and it
    // is not also the strength.
    const thin = facts([
      comp('a', 'Evidence', 3.6),
      comp('b', 'Significance', 3.4),
      comp('c', 'Cause and Consequence', 3.3),
      comp('d', 'Inquiry', 2.5, 1),
    ]);
    expect(ids(CommentBank.topTieOf(thin.comps))).toEqual(['a', 'b', 'c']);
    expect(CommentBank.nextStepOf(thin.comps).id).toBe('c');
    expect(CommentBank.topTieSkills(thin).map(x => x.key)).toEqual(['evidence', 'significance']);
  });
});

describe('the strength named (topSkillOf)', () => {
  it('is the strongest skill when there is one, else the shortest wording of the tie', () => {
    const strong = facts([comp('a', 'Evidence', 4), comp('b', 'Significance', 3.4), comp('c', 'Cause', 3.3)]);
    expect(CommentBank.topSkillOf(strong).key).toBe('evidence');
    const f = facts(tieComps(), { cid: 'c-tie-shortest' });
    const words = ['evidence', 'significance', 'cause'].map(k => [k, wc(skillWords(k))]);
    const shortest = words.slice().sort((x, y) => x[1] - y[1])[0][0];
    expect(CommentBank.topSkillOf(f).key).toBe(shortest);
    expect(CommentBank.topSkillOf(facts([comp('a', 'Evidence', 3.4), comp('b', 'Significance', 3.2)]))).toBeNull();
  });

  it('across a class, names the skill the fewest classmates have, so a tie spreads', () => {
    const comps = () => [
      comp('a', 'Evidence', 3.6),
      comp('b', 'Significance', 3.5),
      comp('c', 'Cause and Consequence', 3.4),
      comp('d', 'Inquiry', 2.8),
    ];
    const keys = [];
    const comments = [];
    for (let i = 1; i <= 5; i++) {
      const f = facts(comps(), { cid: 'c-tie-spread', sid: 'st' + i });
      const ctx = CommentBank.context(f, {});
      expect(ctx._strongSkill).toBe('');
      const d = CommentBank.draft(ctx, { seed: i, comments: comments.slice() });
      comments.push({ sid: 'st' + i, text: d.text });
      const row = d.sentences.find(x => x.step === 'overall');
      expect(row, 'student ' + i).toBeTruthy();
      expect(byId(row.id).when.topSkill).toBe(ctx._topSkill);
      keys.push(ctx._topSkill);
    }
    // Three skills in the tie: each named once before any twice, in turn.
    expect(new Set(keys.slice(0, 3)).size).toBe(3);
    expect(keys[3]).toBe(keys[0]);
    expect(keys[4]).toBe(keys[1]);
  });
});

describe('the per-skill frames under a tie', () => {
  it('splits the 129 frames: 43 that claim a strength (topSkill), 86 that assert the strongest (strongSkill)', () => {
    expect(topFrames.length).toBe(43);
    expect(strongFrames.length).toBe(86);
    topFrames.forEach(s => {
      expect(s.needs, s.id).toEqual(['topSkill']);
      expect(s.claims, s.id).toEqual(['strength']);
      expect(s.text, s.id).not.toMatch(/strongest|highest|\bmost\b|\bbest\b|\btop\b/i);
    });
    strongFrames.forEach(s => expect(s.text, s.id).toMatch(/strongest|highest|\bmost\b|\bbest\b|\btop\b/i));
    // Every skill with frames has one that fits a tie.
    const covered = new Set(strongFrames.map(s => s.subjects[0] + '.' + s.when.strongSkill));
    covered.forEach(k =>
      expect(
        topFrames.some(s => s.subjects[0] + '.' + s.when.topSkill === k),
        k,
      ).toBe(true),
    );
  });

  it('under a tie, the strengths pool is the tie frames for the skill named; the strongest frames are out', () => {
    const f = facts(tieComps(), { cid: 'c-tie-pool' });
    const ctx = CommentBank.context(f, {});
    const key = ctx._topSkill;
    expect(key).toBeTruthy();
    expect(ctx.topSkill).toBe(key);
    expect(ctx._strongSkill).toBe('');
    expect(ctx.strengths).toBe('');
    expect(ctx.evenResults).toBe('');
    const pool = CommentBank.stepPool('overall', ctx).map(s => s.id);
    const mine = topFrames.filter(s => s.subjects[0] === 'socials' && s.when.topSkill === key).map(s => s.id);
    expect(mine.length).toBeGreaterThan(0);
    expect(pool.sort()).toEqual(mine.sort());
    strongFrames.forEach(s => expect(CommentBank.fits(s, ctx), s.id).toBe(false));
    const d = CommentBank.draft(ctx, { seed: 2 });
    const row = d.sentences.find(x => x.step === 'overall');
    expect(mine).toContain(row.id);
    expect(row.text).not.toMatch(/[{}[\]]/);
    expect(d.replaced).toEqual([]);
  });

  it('under the strongest, both kinds fit and share the tier', () => {
    const f = facts([comp('a', 'Evidence', 4), comp('b', 'Significance', 3.4), comp('c', 'Cause', 3.3)]);
    const ctx = CommentBank.context(f, {});
    expect(ctx._strongSkill).toBe('evidence');
    expect(ctx._topSkill).toBe('evidence');
    const pool = CommentBank.stepPool('overall', ctx).map(s => s.id);
    expect(pool).toContain('n617');
    expect(pool).toContain('n616');
    expect(pool).toContain('n618');
  });

  it('comes after the strongest and before even results', () => {
    // Even: every competency within half a step at the overall word.
    const even = facts([comp('a', 'Evidence', 3.1), comp('b', 'Significance', 3.0), comp('c', 'Cause', 2.9)], {
      overall: 3.0,
    });
    const ectx = CommentBank.context(even, {});
    expect(ectx.evenResults).toBe('yes');
    expect(ectx._topSkill).toBe('');
    expect(CommentBank.topTieOf(even.comps)).toEqual([]);
    // A tie: no even-results frame fits.
    const tctx = CommentBank.context(facts(tieComps(), { cid: 'c-tie-order' }), {});
    expect(tctx.evenResults).toBe('');
    expect(tctx._evenWord).toBe('');
    COMMENT_BANK.sentences
      .filter(s => s.when && s.when.evenWord)
      .forEach(s => expect(CommentBank.fits(s, tctx), s.id).toBe(false));
  });

  it('verify() keeps the sentence while the competency is in the tie or strongest, and replaces it otherwise', () => {
    const f = facts(tieComps(), { cid: 'c-tie-verify' });
    const ctx = CommentBank.context(f, {});
    const key = ctx._topSkill;
    const s = topFrames.find(x => x.subjects[0] === 'socials' && x.when.topSkill === key);
    const text = CommentBank.fill(s, ctx, { first: true });
    const pv = CommentBank.provenance(s, ctx);
    const cid = ctx._facts.topSkill[0].split(':')[1];
    expect(pv.factKeys).toContain('comp:' + cid);
    expect(pv.values['when.topSkill']).toBe(key);
    expect(verified(s, text, pv, f, 'overall').replaced).toEqual([]);
    // That competency now the strongest: still a strength.
    const strongest = Object.assign({}, f, {
      comps: f.comps.map(c => (c.id === cid ? comp(c.id, c.name, 4) : comp(c.id, c.name, 3.2))),
    });
    expect(ids(CommentBank.strongestOf(strongest.comps))).toEqual([cid]);
    expect(verified(s, text, pv, strongest, 'overall').replaced).toEqual([]);
    // That competency now a full step below the others: replaced.
    const dropped = Object.assign({}, f, {
      comps: f.comps.map(c => (c.id === cid ? comp(c.id, c.name, 2.4) : c)),
    });
    expect(verified(s, text, pv, dropped, 'overall').replaced.length).toBe(1);
    // Every competency within half a step (the even case): replaced.
    const flat = Object.assign({}, f, { comps: f.comps.map(c => comp(c.id, c.name, 3.3)) });
    expect(verified(s, text, pv, flat, 'overall').replaced.length).toBe(1);
    // Another competency's key under the same frame: replaced.
    const other = Object.assign({}, pv, {
      values: Object.assign({}, pv.values, { 'when.topSkill': 'inquiry', topSkill: 'inquiry' }),
    });
    expect(verified(s, text, other, f, 'overall').replaced.length).toBe(1);
  });

  it('Browse Sentences files a tie frame under its skill, and the student’s own case names the skill', () => {
    expect(
      RQ.browseCase('strengths', { when: { topSkill: 'evidence' }, needs: ['topSkill'], subjects: ['socials'] }),
    ).toEqual(['skill:socials:evidence']);
    const ctx = CommentBank.context(facts(tieComps(), { cid: 'c-tie-browse' }), {});
    expect(RQ.browseOwn('strengths', ctx)[0]).toBe('skill:socials:' + ctx._topSkill);
  });

  it('the At a Glance tag still means strongest: none under a tie', () => {
    expect(RQ.skillTags(tieComps())).toEqual({ d: 'Next step' });
  });
});
