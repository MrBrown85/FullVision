/**
 * The best piece with no teacher note names the skill it shows (Colin,
 * 2026-11-02): "Her best piece was “Task 2,” which shows she can …", in the
 * phrase of a bank competency it was scored Proficient or above on. One
 * sentence per skill: never a skill the comment can name elsewhere (the
 * strengths, the next step and the other strength routes), and only within
 * 20 words. A note says what the piece shows itself.
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
  it('names a skill no other sentence can, from a bank competency scored Proficient or above', () => {
    // Evidence is the strength and Significance the next step: the piece
    // shows Perspective.
    const f = withWork([3.8, 3, 2]);
    const top = CommentBank.bestPieceOf(f);
    const sk = CommentBank.bestPieceSkillOf(f, top);
    expect(sk.comp.id).toBe('c2');
    expect(sk.skill).toBe(CommentBank.skillFor(f, f.comps[1]).skill);
    const ctx = CommentBank.context(f, {});
    expect(ctx.bestPiece).toBe('Their best piece was “Task 2”, which shows they can ' + sk.skill + '.');
  });

  it('names none when every skill on the piece is taken, below Proficient, or the class is not linked', () => {
    // Perspective below Proficient on the piece.
    expect(
      CommentBank.bestPieceSkillOf(withWork([3.8, 2.4, 1.6]), CommentBank.bestPieceOf(withWork([3.8, 2.4, 1.6]))),
    ).toBeNull();
    const plain = withWork([3.8, 3, 2], false);
    expect(CommentBank.bestPieceSkillOf(plain, CommentBank.bestPieceOf(plain))).toBeNull();
    expect(CommentBank.context(plain, {}).bestPiece).toBe('Their best piece was “Task 2.”');
  });

  it('leaves the skill to the teacher’s note when there is one', () => {
    const f = withWork([3.8, 3, 2]);
    f.work[2].note = 'compared two accounts of the strike';
    expect(CommentBank.bestPieceSkillOf(f, f.work[2])).toBeNull();
    expect(CommentBank.context(f, {}).bestPiece).toBe(
      'Their best piece was “Task 2”, where they compared two accounts of the strike.',
    );
  });

  it('stays within 20 words for every cluster’s phrase (a title counts as one word)', () => {
    Object.keys(comment)
      .filter(k => !k.startsWith('_'))
      .forEach(k => {
        const t = CommentBank.bestPieceSentence({
          title: 'A Long Title About the Strike',
          skill: comment[k].phrase,
          name: 'Noor',
        });
        expect(CommentRealiser.tooLong(t), k).toBe(false);
      });
  });

  it('verifies, and is flagged once the piece no longer shows that skill', () => {
    const f = withWork([3.8, 3, 2]);
    const ctx = CommentBank.context(f, {});
    const s = COMMENT_BANK.sentences.find(x => x.id === 'n36');
    const d = {
      text: CommentBank.fill(s, ctx),
      sentences: [{ id: 'n36', step: 'example', text: CommentBank.fill(s, ctx) }],
      provenance: [CommentBank.provenance(s, ctx)],
    };
    expect(CommentBank.verify(d, f, {}).replaced).toEqual([]);
    const lower = withWork([3.8, 2.4, 2]);
    expect(CommentBank.verify(d, lower, {}).replaced.map(x => x.sentenceId)).toContain('n36');
  });
});
