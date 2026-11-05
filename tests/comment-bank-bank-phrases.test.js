/**
 * A competency imported from the BC bank (tag.bank_id) is named in a
 * comment by its cluster's phrase, and its next step is the cluster's step
 * toward the level above (data/bc-curriculum-comment.json, shipped as
 * shared/bank-comment.js; Colin, 2026-11-02). A competency without a bank id
 * keeps the SKILLS table's wording.
 */
import './setup.js';
import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

const comment = JSON.parse(readFileSync('data/bc-curriculum-comment.json', 'utf-8'));
const THEY = { subj: 'they', obj: 'them', poss: 'their', refl: 'themselves' };

function day(n) {
  const d = new Date(2026, 8, 1 + n);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
const comp = (id, name, level, bankId) => ({
  id,
  name,
  bankId: bankId || null,
  scores: [0, 1, 2].map(i => ({ id: 'w' + i, d: day(i * 7), v: level, title: 'Task ' + i })),
  start: level,
  now: level,
  level,
  iCans: ['I can explain why it matters'],
});

/* An SS 10 student: Evidence is the strength, Significance the next step. */
function facts(levels, bank = true, over) {
  const [e, p, s] = levels;
  return Object.assign(
    {
      cid: 'bank-phrases',
      sid: 's1',
      name: 'Noor',
      first: 'Noor',
      course: 'Social Studies 10',
      family: 'socials',
      pronouns: THEY,
      pronounsOnFile: true,
      comps: [
        comp('c1', 'Evidence', e, bank && 'bc.ss10.cc.3'),
        comp('c2', 'Perspective', p, bank && 'bc.ss10.cc.6'),
        comp('c3', 'Significance', s, bank && 'bc.ss10.cc.2'),
      ],
      work: [],
      voice: {},
      confidence: [],
      record: { total: 3, handed: 3, late: 0, missing: 0 },
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
      classLines: { support: [], pick: null, closing: '', late: '', charLimit: null },
    },
    over,
  );
}

describe('a bank competency in a comment', () => {
  it('is named by its cluster phrase, with its SKILLS key for the family lines', () => {
    const f = facts([3.6, 3, 2]);
    const sk = CommentBank.skillFor(f, f.comps[0]);
    expect(sk.skill).toBe(comment['ss-evi'].phrase);
    expect(sk.key).toBe('evidence');
    expect(CommentBank.context(f, {}).strengths).toBe(comment['ss-evi'].phrase);
  });

  it('keeps the table wording when the class is not linked to the bank', () => {
    const f = facts([3.6, 3, 2], false);
    const sk = CommentBank.skillFor(f, f.comps[0]);
    expect(sk.skill).toBe(CommentBank.SKILLS.socials.find(r => r.key === 'evidence').skill);
    expect(CommentBank.levelStepOf(f)).toBeNull();
    expect(CommentBank.context(f, {}).levelStep).toBe('');
  });

  it('takes the next step at the next-step competency’s level', () => {
    const steps = comment['ss-sig'].next_steps;
    expect(CommentBank.levelStepOf(facts([3.6, 3, 1.2])).text).toBe(steps.emerging);
    expect(CommentBank.levelStepOf(facts([3.6, 3, 2])).text).toBe(steps.developing);
    expect(CommentBank.levelStepOf(facts([4, 3.4, 2.9])).text).toBe(steps.proficient);
  });

  it('takes the card’s Extending step at Extending, else the phrase', () => {
    const f = facts([4, 4, 4]);
    // Every competency at Extending: a version 2 card's own Extending step,
    // said for the student; a version 1 card's phrase.
    const ls = CommentBank.levelStepOf(f);
    if (!ls) return;
    const sk = CommentBank.skillFor(f, ls.comp);
    if (sk.steps.Extending) {
      expect(ls.text).not.toMatch(/[{[]/);
      expect(ls.text).toMatch(/^explain what evidence would change (his|her|their) judgement of a source$/);
    } else expect(ls.text).toBe(sk.skill);
  });

  it('drafts the level step, and the draft verifies', () => {
    const f = facts([3.6, 3, 2]);
    for (let seed = 1; seed <= 6; seed++) {
      const d = CommentBank.draft(CommentBank.context(f, {}), { seed, quiet: true });
      // The pipeline's Next Step frames (v: 2), alone or joined to the
      // sentence before; each says the level step ({step}).
      const next = d.sentences.find(x => x.step === 'nextStep' || (x.steps || []).indexOf('nextStep') >= 0);
      expect(next && next.id, 'seed ' + seed).toMatch(/^(vns\d\d|j:.*\+vns\d\d:\w+)$/);
      // The step as written, or as a gerund ("The next thing to practise is …").
      const step = comment['ss-sig'].next_steps.developing;
      expect(
        [step, CommentForms.doing(step)].some(t => d.text.indexOf(t) >= 0),
        d.text,
      ).toBe(true);
      expect(CommentBank.verify(d, f, {}).replaced, 'seed ' + seed).toEqual([]);
    }
  });

  it('fails verify() once the next step moves to another competency', () => {
    const f = facts([3.6, 3, 2]);
    const d = CommentBank.draft(CommentBank.context(f, {}), { seed: 2, quiet: true });
    const moved = facts([3.6, 2, 3]);
    const r = CommentBank.verify(d, moved, {});
    const next = d.sentences.find(x => x.step === 'nextStep' || (x.steps || []).indexOf('nextStep') >= 0);
    expect(r.replaced.map(x => x.sentenceId)).toContain(next.id);
    expect(r.replaced.find(x => x.sentenceId === next.id).failed).toContain('nextStep');
  });
});
