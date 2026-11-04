/**
 * The realiser's length rule on the realised sentence (sim-729, Nov 1): a
 * bank template under 20 words can run to 37 once {strengths} holds two
 * long skills. When two skills take a sentence past 20 words, the slot
 * holds the strongest skill alone and the provenance records that value;
 * a sentence still over 20 words with one skill is never drafted and fails
 * verify() with 'length'. Two short skills stay two.
 */
import './setup.js';
import { describe, expect, it } from 'vitest';

const THEY = { subj: 'they', obj: 'them', poss: 'their', refl: 'themselves' };

function day(n) {
  const d = new Date(2026, 8, 1 + n);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
const pts = (vs, gap = 7) => vs.map((v, i) => ({ id: 'w' + i, d: day(i * gap), v, title: 'Task ' + i }));
const comp = (id, name, level) => ({
  id,
  name,
  scores: pts([level, level, level]),
  start: level,
  now: level,
  level,
  iCans: [],
});
const piece = (id, title, d, pct) => ({ id, title, d, v: pct / 25, pct, note: '' });

/* A Foods 10 student whose marks climbed and whose two strongest skills
   are the table's two longest for ADST (11 words each): Designing and
   Sharing, with Making the next step. */
function facts(over) {
  const pieces = [
    piece('p1', 'Knife Skills Lab', '2026-09-08', 58),
    piece('p2', 'Muffin Lab', '2026-09-22', 66),
    piece('p3', 'Soup Project', '2026-10-06', 78),
    piece('p4', 'Plated Meal', '2026-10-20', 90),
  ];
  return Object.assign(
    {
      cid: 'len',
      sid: 's-noor',
      name: 'Noor',
      first: 'Noor',
      course: 'Foods 10',
      family: 'adst',
      pronouns: THEY,
      pronounsOnFile: true,
      comps: [comp('c1', 'Designing', 3.6), comp('c2', 'Sharing', 3.5), comp('c3', 'Making', 2.5)],
      work: pieces,
      voice: {},
      confidence: [],
      record: { total: 4, handed: 4, late: 0, missing: 0 },
      notHandedIn: { count: 0, titles: [], groups: [] },
      habits: {},
      absent: 0,
      late: 0,
      overall: 3.2,
      standing: 'Proficient',
      letter: 'B',
      grade: { mode: 'letter', letter: 'B', pct: 82, pieces, marked: { mine: 4, all: 4 } },
      levelText: v => Math.round(v * 25) + '%',
      enrolled: '',
      classStart: '',
      termStart: '',
    },
    over,
  );
}
const DESIGNING = 'plan a design with a sketch and measurements before making it';
const SHARING = 'explain how a project was made and what could be improved';
const byId = id => COMMENT_BANK.sentences.find(s => s.id === id);
const TOO_LONG = 'Early marks were lower than {his} later ones, and the later work shows {he} can {strengths}.';
const words = t => CommentRealiser.wordCount(t);

describe('{strengths} falls back to one skill when two run past 20 words', () => {
  it('names both skills in the context, and the strongest alone where two would be too long', () => {
    const ctx = CommentBank.context(facts(), {});
    expect(ctx.climb).toBe('yes');
    expect(ctx.strengths).toBe(DESIGNING + ' and ' + SHARING);
    expect(ctx.strength).toBe(DESIGNING);
    // n415 ("{He} can {strengths}, and {his} marks rose over the term.")
    // is 9 words before the slot: 32 with two skills, 20 with one.
    const n415 = byId('n415');
    const t = CommentBank.fill(n415, ctx);
    expect(t).toBe('They can ' + DESIGNING + ', and their marks rose over the term.');
    expect(words(t)).toBe(20);
    expect(t).not.toContain(SHARING);
    expect(CommentBank.provenance(n415, ctx).values.strengths).toBe(DESIGNING);
    expect(CommentBank.ctxFor(n415, ctx).strengths).toBe(DESIGNING);
  });

  it('keeps two skills when the sentence fits with both', () => {
    // Two short skills: "{He} can {strengths}." is 2 + 17 words.
    const two = 'plan a design with care and explain how a project was made';
    const ctx = Object.assign({}, CommentBank.context(facts(), {}), {
      strengths: two,
      strength: 'plan a design with care',
    });
    const short = { id: 'x1', part: 'now', group: 'Overall', text: '{He} can {strengths}.', needs: ['strengths'] };
    expect(CommentBank.fill(short, ctx)).toBe('They can ' + two + '.');
    expect(CommentBank.provenance(short, ctx).values.strengths).toBe(two);
    expect(CommentBank.ctxFor(short, ctx)).toBe(ctx);
    // The same frame with the two long skills (25 words) holds the first.
    const long = CommentBank.context(facts(), {});
    expect(CommentBank.fill(short, long)).toBe('They can ' + DESIGNING + '.');
  });

  it('never drafts a sentence over 24 words, and verify() keeps the one-skill sentence', () => {
    const f = facts();
    const ctx = CommentBank.context(f, {});
    const seen = {};
    for (let seed = 1; seed <= 12; seed++) {
      const d = CommentBank.draft(ctx, { seed });
      d.sentences.forEach(s => {
        expect(words(s.text), s.id + ': ' + s.text).toBeLessThanOrEqual(24);
        seen[s.id] = true;
      });
      expect(d.replaced).toEqual([]);
      // The provenance verifies against today's facts as filled.
      const v = CommentBank.verify(d, f, {});
      expect(v.replaced).toEqual([]);
    }
    // The marks climbed: a draft says so in one of the pipeline's climb
    // frames (vcl01-vcl08, Nov 4 2026; the n41x frames said "this term").
    const climb = Object.keys(seen).filter(id => /vcl\d\d/.test(id));
    expect(climb.length).toBeGreaterThan(0);
    const LONG = { id: 'x2', part: 'now', group: 'Overall', text: TOO_LONG, needs: ['climb', 'strengths'], claims: [] };
    const bank = { parts: COMMENT_BANK.parts, sentences: COMMENT_BANK.sentences.concat([LONG]) };
    for (let seed = 1; seed <= 12; seed++) {
      const d = CommentBank.draft(ctx, { seed, bank });
      d.sentences.forEach(s => expect(s.id).not.toBe('x2'));
    }
  });

  it('verify() fails a sentence that runs past 20 words as realised, and replaces it', () => {
    const f = facts();
    const ctx = CommentBank.context(f, {});
    // A frame 13 words before the slot: 24 with one skill, still too long.
    const LONG = { id: 'x2', part: 'now', group: 'Overall', text: TOO_LONG, needs: ['climb', 'strengths'], claims: [] };
    const bank = { parts: COMMENT_BANK.parts, sentences: COMMENT_BANK.sentences.concat([LONG]) };
    expect(CommentBank.fill(LONG, ctx)).not.toContain(SHARING);
    expect(words(CommentBank.fill(LONG, ctx))).toBeGreaterThan(20);
    const d = {
      sentences: [{ id: 'x2', part: 'now', step: 'overall', text: CommentBank.fill(LONG, ctx, { first: true }) }],
      provenance: [CommentBank.provenance(LONG, ctx)],
    };
    const v = CommentBank.verify(d, f, {}, { bank });
    expect(v.replaced).toHaveLength(1);
    expect(v.replaced[0].sentenceId).toBe('x2');
    expect(v.replaced[0].failed).toContain('length');
    v.sentences.forEach(s => expect(words(s.text), s.text).toBeLessThanOrEqual(20));
  });
});
