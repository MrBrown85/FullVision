/**
 * The Next Step frames written for one skill (lane C, Nov 1): every skill in
 * the competency-to-skill table has at least three frames bound to it by
 * `when.nextSkill`, each reachable (it fits a student whose next step is
 * that skill), rendered differently from every other frame for the skill,
 * verified against the same competency, never naming the student twice,
 * and never offered for another skill or another kind of class.
 */
import './setup.js';
import { describe, expect, it } from 'vitest';

const HE = { subj: 'he', obj: 'him', poss: 'his', refl: 'himself' };

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

/* A student in a class of `family` whose next step is the table row `row`
   (its competency is the lowest with three pieces; one other is strongest). */
function facts(family, row, over) {
  return Object.assign(
    {
      cid: 'c-' + family,
      sid: 's1',
      name: 'Noor',
      first: 'Noor',
      course: 'A Class 10',
      family,
      pronouns: HE,
      pronounsOnFile: true,
      comps: [comp('a', 'Other Area', 4), comp('b', row.name, 2)],
      work: [],
      voice: {},
      confidence: [],
      record: { total: 6, handed: 6, late: 0, missing: 0 },
      notHandedIn: { count: 0, titles: [], groups: [] },
      habits: {},
      overall: 3,
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

/* verify() over a draft of this one sentence. */
const verified = (s, text, pv, f) =>
  CommentBank.verify(
    { text, sentences: [{ id: s.id, part: s.part, step: 'nextStep', text }], provenance: [pv] },
    f,
    {},
  );

// The Next Step frames (the For the Family sentences share `when.nextSkill`).
const frames = COMMENT_BANK.sentences.filter(s => s.group === 'Next Step' && s.when && s.when.nextSkill);
const forSkill = (family, key) => frames.filter(s => s.subjects[0] === family && s.when.nextSkill === key);

describe('the Next Step frames per skill', () => {
  it('give every skill in the table at least three frames, each bound to the skill and its kind of class', () => {
    Object.entries(CommentBank.SKILLS).forEach(([family, rows]) =>
      rows.forEach(row => {
        const mine = forSkill(family, row.key);
        expect(mine.length, family + '.' + row.key).toBeGreaterThanOrEqual(3);
        mine.forEach(s => {
          expect(s).toMatchObject({ part: 'go', group: 'Next Step', claims: ['nextStep'], subjects: [family] });
          expect(s.needs).toContain('nextSkill');
        });
      }),
    );
  });

  it('differ in structure within a skill: no two frames start with the same three words, as rendered', () => {
    Object.entries(CommentBank.SKILLS).forEach(([family, rows]) =>
      rows.forEach(row => {
        const ctx = CommentBank.context(facts(family, row), {});
        const texts = forSkill(family, row.key).map(s => CommentBank.fill(s, ctx));
        const starts = texts.map(x => x.split(/\s+/).slice(0, 3).join(' '));
        expect(new Set(starts).size, family + '.' + row.key + ': ' + starts.join(' | ')).toBe(starts.length);
        expect(new Set(texts).size, family + '.' + row.key).toBe(texts.length);
      }),
    );
  });

  it('name the student at most once each: no sentence has two pronoun slots', () => {
    frames.forEach(s => expect((s.text.match(/\{(He|he|him|His|his)\}/g) || []).length, s.id).toBeLessThanOrEqual(1));
  });

  it('state one thing to do, never a fault or a claim about the future', () => {
    frames.forEach(s => {
      expect(s.text, s.id).not.toMatch(/\b(still|again|only|finally|at least|unfortunately|competency|level)\b/i);
      expect(s.text, s.id).not.toMatch(/\b(will|should|must|needs? to)\b/i);
      expect(s.text, s.id).not.toMatch(/!/);
    });
  });

  Object.entries(CommentBank.SKILLS).forEach(([family, rows]) =>
    rows.forEach(row => {
      it(`fit, fill and verify for ${family}.${row.key}: the pool is its own frames`, () => {
        const f = facts(family, row);
        const ctx = CommentBank.context(f, {});
        expect(CommentBank.nextSkillOf(f)).toMatchObject({ key: row.key, skill: row.skill });
        const pool = CommentBank.stepPool('nextStep', ctx).map(s => s.id);
        expect(pool.sort()).toEqual(
          forSkill(family, row.key)
            .map(s => s.id)
            .sort(),
        );
        // Nothing written for another skill, and nothing of another kind of class.
        pool.forEach(id => {
          const s = COMMENT_BANK.sentences.find(x => x.id === id);
          if (s.when && s.when.nextSkill) expect([s.subjects[0], s.when.nextSkill], id).toEqual([family, row.key]);
        });
        forSkill(family, row.key).forEach(s => {
          const t = CommentBank.fill(s, ctx);
          expect(t, s.id).not.toMatch(/[{}[\]]/);
          expect(CommentRealiser.wordCount(t), s.id + ': ' + t).toBeLessThanOrEqual(20);
          const pv = CommentBank.provenance(s, ctx);
          expect(pv.factKeys, s.id).toContain('comp:b');
          expect(verified(s, t, pv, f).replaced, s.id).toEqual([]);
        });
      });
    }),
  );

  it('drop out of the pool when the next step moves to another competency, and fail verify() then', () => {
    const row = CommentBank.SKILLS.socials.find(r => r.key === 'evidence');
    const f = facts('socials', row);
    const ctx = CommentBank.context(f, {});
    const s = forSkill('socials', 'evidence')[0];
    const pv = CommentBank.provenance(s, ctx);
    expect(verified(s, CommentBank.fill(s, ctx), pv, f).replaced).toEqual([]);
    // The marks change: Perspective is now the lowest.
    const moved = facts('socials', row, {
      comps: [comp('a', 'Other Area', 4), comp('b', 'Evidence', 3), comp('c', 'Perspective', 2)],
    });
    const r = verified(s, CommentBank.fill(s, ctx), pv, moved);
    expect(r.replaced.map(x => x.sentenceId)).toEqual([s.id]);
    expect(r.replaced[0].failed).toContain('nextStep');
    const pool = CommentBank.stepPool('nextStep', CommentBank.context(moved, {})).map(s => s.id);
    expect(pool).not.toContain(s.id);
    forSkill('socials', 'perspective').forEach(x => expect(pool).toContain(x.id));
  });

  it('are never offered without a next step', () => {
    // One piece in each competency: nothing has enough evidence for a next
    // step (two are enough; Colin, 2026-11-03).
    const thin = (id, name) => Object.assign(comp(id, name, 3), { scores: pts([3]) });
    const f = facts('socials', CommentBank.SKILLS.socials[0], {
      comps: [thin('a', 'Evidence'), thin('b', 'Perspective')],
    });
    const ctx = CommentBank.context(f, {});
    expect(ctx._nextSkill).toBe('');
    frames.forEach(s => expect(CommentBank.fits(s, ctx), s.id).toBe(false));
  });

  it('are drawn in turn across a class: a skill’s frames are exhausted before one repeats', () => {
    const row = CommentBank.SKILLS.ela.find(r => r.key === 'writing');
    const ids = forSkill('ela', 'writing').map(s => s.id);
    const comments = [];
    const seen = [];
    for (let i = 0; i < ids.length; i++) {
      const f = facts('ela', row, { sid: 's' + i, cid: 'c-turns' });
      const d = CommentBank.draft(CommentBank.context(f, {}), { seed: 3 + i, comments, quiet: true });
      const next = d.sentences.find(x => x.step === 'nextStep');
      expect(ids).toContain(next.id);
      seen.push(next.id);
      comments.push({ sid: f.sid, text: d.text });
    }
    expect(new Set(seen).size).toBe(ids.length);
  });
});
