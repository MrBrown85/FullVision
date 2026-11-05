/**
 * The best piece with no teacher note says what it shows (Colin, 2026-11-02;
 * the sample voice, Nov 4): "Their Task 2 is their best piece so far, and it
 * shows they can …", from the competency the piece scored highest on at
 * Proficient or above, even with one mark, in its skill phrase (the bank's,
 * else the table's) or its own label in plain words. Never the next step's
 * skill. A note says what the piece shows itself.
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

/* Three pieces of work, each scored on every competency at its level. */
const withWork = (levels, bank = true, title = 'Task') => {
  const f = facts(levels, bank);
  f.work = [0, 1, 2].map(i => ({
    id: 'w' + i,
    title: title + ' ' + i,
    d: day(i * 7),
    v: levels[0],
    pct: null,
    note: '',
  }));
  return f;
};

describe('the best piece names its skill', () => {
  it('names the competency the piece scored highest on, Proficient or above', () => {
    // Evidence is scored highest on the piece (and is the strength).
    const f = withWork([3.8, 3, 2]);
    const top = CommentBank.bestPieceOf(f);
    const sk = CommentBank.bestPieceSkillOf(f, top);
    expect(sk.comp.id).toBe('c1');
    expect(sk.skill).toBe(CommentBank.skillFor(f, f.comps[0]).skill);
    const ctx = CommentBank.context(f, {});
    expect(ctx.piece).toBe('Task 2');
    expect(ctx.pieceSkill).toBe(sk.skill);
    expect(ctx.pieceComp).toBe('');
  });

  it('names none below Proficient; an unlinked class names the table’s skill, else the label', () => {
    expect(
      CommentBank.bestPieceSkillOf(withWork([2.4, 2.4, 1.6]), CommentBank.bestPieceOf(withWork([2.4, 2.4, 1.6]))),
    ).toBeNull();
    const plain = withWork([3.8, 3, 2], false);
    expect(CommentBank.bestPieceSkillOf(plain, CommentBank.bestPieceOf(plain)).skill).toBe(
      CommentBank.skillOf('socials', 'Evidence').skill,
    );
    // Labels no table row matches: the label itself, in plain words.
    const own = withWork([3.8, 3, 2], false);
    own.comps = own.comps.map((c, i) => ({ ...c, name: ['Reasoning and Argument', 'Ethics', 'Worldviews'][i] }));
    const sk = CommentBank.bestPieceSkillOf(own, CommentBank.bestPieceOf(own));
    expect(sk).toMatchObject({ label: 'reasoning and argument' });
    expect(CommentBank.context(own, {}).pieceComp).toBe('reasoning and argument');
  });

  it('never names the next step’s skill: the next highest on the piece instead', () => {
    // All three level: the next step is Evidence (report order), so the
    // piece shows Perspective.
    const f = withWork([3, 3, 3]);
    expect(CommentBank.nextSkillOf(f).comp.id).toBe('c1');
    expect(CommentBank.bestPieceSkillOf(f, CommentBank.bestPieceOf(f)).comp.id).toBe('c2');
  });

  it('leaves the skill to the teacher’s note when there is one', () => {
    const f = withWork([3.8, 3, 2]);
    f.work[2].note = 'compared two accounts of the strike';
    expect(CommentBank.bestPieceSkillOf(f, f.work[2])).toBeNull();
    expect(CommentBank.context(f, {}).bestNote).toBe('compared two accounts of the strike');
  });

  it('has a frame within 20 words for every cluster phrase of nine words or fewer, with a three-word title', () => {
    const frames = COMMENT_BANK.sentences.filter(s => (s.needs || []).indexOf('pieceSkill') >= 0);
    Object.keys(comment)
      .filter(k => !k.startsWith('_'))
      .forEach(k => {
        if (CommentRealiser.wordCount(comment[k].phrase) > 9) return;
        const ctx = {
          _p: THEY,
          name: 'Noor',
          piece: 'Strike Essay',
          pieceWork: 'yes',
          pieceTest: 'yes',
          pieceSkill: comment[k].phrase,
        };
        const fit = frames.filter(s => !CommentRealiser.tooLong(CommentBank.fill(s, ctx)));
        expect(fit.length, k).toBeGreaterThan(0);
      });
  });

  it('verifies, and is flagged once the piece no longer shows that skill', () => {
    const f = withWork([3.8, 3, 2]);
    const ctx = CommentBank.context(f, {});
    const s = COMMENT_BANK.sentences.find(x => x.id === 'bp12');
    const d = {
      text: CommentBank.fill(s, ctx),
      sentences: [{ id: 'bp12', step: 'example', text: CommentBank.fill(s, ctx) }],
      provenance: [CommentBank.provenance(s, ctx)],
    };
    expect(d.text).toBe('Their best piece is their Task 2; it shows they can ' + ctx.pieceSkill + '.');
    expect(CommentBank.verify(d, f, {}).replaced).toEqual([]);
    const lower = withWork([2.4, 2.4, 2]);
    expect(CommentBank.verify(d, lower, {}).replaced.map(x => x.sentenceId)).toContain('bp12');
  });
});
