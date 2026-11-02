/**
 * Progress in levels (Colin, 2026-11-02): for a competency from the BC bank
 * that climbed a level or more over the term past the "improved" gate, the
 * Overall sentence can say "Noor rose from Developing to Proficient in their
 * ability to {phrase}." Never the next step's skill, only where the class
 * shows proficiency words, and only within 20 words.
 */
import './setup.js';
import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

const comment = JSON.parse(readFileSync('data/bc-curriculum-comment.json', 'utf-8'));
const THEY = { subj: 'they', obj: 'them', poss: 'their', refl: 'themselves' };
const day = n => {
  const d = new Date(2026, 8, 1 + n);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};
/* A competency with dated scores: `vals` over five weeks. */
const comp = (id, name, vals, start, now, bankId) => ({
  id,
  name,
  bankId: bankId || null,
  scores: vals.map((v, i) => ({ id: id + 'w' + i, d: day(i * 9), v, title: 'Task ' + i })),
  start,
  now,
  level: now,
  iCans: [],
});
function facts(comps) {
  return {
    cid: 'progress',
    sid: 's1',
    name: 'Noor',
    first: 'Noor',
    course: 'Social Studies 10',
    family: 'socials',
    pronouns: THEY,
    pronounsOnFile: true,
    comps,
    work: [],
    voice: {},
    confidence: [],
    record: { total: 5, handed: 5, late: 0, missing: 0 },
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
  };
}
const climbing = () => [
  comp('c1', 'Evidence', [2, 2, 2.2, 3, 3.2], 2, 3.1, 'bc.ss10.cc.3'),
  comp('c2', 'Perspective', [3, 3, 3, 3, 3], 3, 3, 'bc.ss10.cc.6'),
  comp('c3', 'Significance', [1.8, 2, 2, 2, 2], 2, 2, 'bc.ss10.cc.2'),
];

describe('progress in levels', () => {
  it('names the climb by its level words and the competency’s phrase', () => {
    const f = facts(climbing());
    const pg = CommentBank.progressOf(f);
    expect(pg.comp.id).toBe('c1');
    expect([pg.from, pg.to, pg.skill]).toEqual(['Developing', 'Proficient', comment['ss-evi'].phrase]);
    const ctx = CommentBank.context(f, {});
    expect(ctx.progressSkill).toBe(pg.skill);
    const pool = CommentBank.stepPool('overall', ctx).map(s => s.id);
    expect(pool.some(id => /^pg\d\d$/.test(id))).toBe(true);
  });

  it('says it in sentences that verify, and is flagged once the climb is gone', () => {
    const f = facts(climbing());
    const ctx = CommentBank.context(f, {});
    const pg1 = COMMENT_BANK.sentences.find(x => x.id === 'pg01');
    const pg2 = COMMENT_BANK.sentences.find(x => x.id === 'pg02');
    expect(CommentBank.fill(pg1, ctx)).toBe(
      'They rose from Developing to Proficient in their ability to ' + comment['ss-evi'].phrase + '.',
    );
    expect(CommentBank.fill(pg2, ctx)).toBe(
      'They have reached Proficient in their ability to ' + comment['ss-evi'].phrase + ', up from Developing.',
    );
    const text = CommentBank.fill(pg1, ctx);
    const d = {
      text,
      sentences: [{ id: 'pg01', step: 'overall', text }],
      provenance: [CommentBank.provenance(pg1, ctx)],
    };
    expect(CommentBank.verify(d, f, {}).replaced).toEqual([]);
    const flat = climbing();
    flat[0] = comp('c1', 'Evidence', [3, 3, 3, 3, 3.1], 3, 3.1, 'bc.ss10.cc.3');
    expect(CommentBank.verify(d, facts(flat), {}).replaced.map(x => x.sentenceId)).toContain('pg01');
  });

  it('leaves out a climb below the gate, the next step’s skill, a Letter class and a class not linked to the bank', () => {
    const few = climbing();
    few[0].scores = few[0].scores.slice(0, 2);
    expect(CommentBank.progressOf(facts(few))).toBeNull();
    const low = climbing();
    low[1] = comp('c2', 'Perspective', [3.6, 3.6, 3.6, 3.6, 3.6], 3.6, 3.6, 'bc.ss10.cc.6');
    low[2] = comp('c3', 'Significance', [3.4, 3.4, 3.4, 3.4, 3.4], 3.4, 3.4, 'bc.ss10.cc.2');
    expect(CommentBank.nextStepOf(low).id).toBe('c1');
    expect(CommentBank.progressOf(facts(low))).toBeNull();
    const letter = Object.assign(facts(climbing()), { standing: '' });
    expect(CommentBank.progressOf(letter)).toBeNull();
    const plain = climbing().map(c => Object.assign(c, { bankId: null }));
    expect(CommentBank.progressOf(facts(plain))).toBeNull();
  });

  it('stays within 20 words in every frame for every cluster it is offered for', () => {
    const frames = COMMENT_BANK.sentences.filter(s => /^pg\d\d$/.test(s.id));
    expect(frames.length).toBe(2);
    Object.keys(comment)
      .filter(k => !k.startsWith('_'))
      .forEach(k => {
        if (CommentRealiser.wordCount(comment[k].phrase) > 9) return; // progressOf leaves these out
        frames.forEach(s => {
          const t = s.text
            .replace('{He} [has|have]', 'Noor has')
            .replace('{He}', 'Noor')
            .replace('{his}', 'her')
            .replace('{progressFrom}', 'Developing')
            .replace('{progressTo}', 'Proficient')
            .replace('{progressSkill}', comment[k].phrase);
          expect(CommentRealiser.tooLong(t), s.id + ' ' + k).toBe(false);
        });
      });
  });
});
