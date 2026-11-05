/**
 * Round two, lane G (Nov 1): strengths for even results, strengths frames
 * per skill, grade frames per proficiency word, and more IE deadline frames.
 *
 * - evenComps: nothing past the "strongest" gate, every competency with a
 *   level within half a step and at the overall proficiency word, two or
 *   more judged on 3+ pieces; the n5xx frames fit on that alone, say the
 *   proficiency word only where the class shows it, and verify.
 * - Every skill in the table has 3+ strengths frames (`when.strongSkill`),
 *   each reachable, structurally distinct, verified against the competency.
 * - Ten grade frames per proficiency word rotate with the generic ones.
 * - Four IE Deadline frames, and the deadline sentence is found by its date,
 *   whichever frame it is.
 */
import './setup.js';
import { describe, expect, it } from 'vitest';

const HE = { subj: 'he', obj: 'him', poss: 'his', refl: 'himself' };
const WORDS = ['Extending', 'Proficient', 'Developing', 'Emerging'];
const LEVEL = { Extending: 3.8, Proficient: 3.1, Developing: 2.1, Emerging: 1.2 };

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

function facts(family, comps, over) {
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
      comps,
      // Three scored pieces, so the term is not the thin story (which has no strengths step).
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
}
const byId = id => COMMENT_BANK.sentences.find(s => s.id === id);
const verified = (s, text, pv, f, step) =>
  CommentBank.verify({ text, sentences: [{ id: s.id, part: s.part, step, text }], provenance: [pv] }, f, {});

/* Two even competencies in the socials table, at `level`. */
const evenFacts = (word, over) =>
  facts(
    'socials',
    [
      comp('a', 'Evidence', LEVEL[word]),
      comp('b', 'Significance', LEVEL[word] - 0.3),
      comp('c', 'Inquiry', LEVEL[word] - 0.2, 1),
    ],
    Object.assign({ overall: LEVEL[word], standing: word }, over),
  );

describe('even results (evenComps)', () => {
  it('holds when nothing passes the strongest gate and every competency is within half a step at the overall word', () => {
    const f = evenFacts('Proficient');
    expect(CommentBank.strongestOf(f.comps)).toEqual([]);
    // Highest first; the competency on one piece counts for the band.
    expect(CommentBank.evenComps(f.comps, f.overall).map(c => c.id)).toEqual(['a', 'c', 'b']);
    // The lowest (b) is the next step, so it is not also the strength; the
    // one-piece competency (c) is never the strength named.
    expect(CommentBank.nextStepOf(f.comps).id).toBe('b');
    expect(CommentBank.evenSkills(f).map(x => x.key)).toEqual(['evidence']);
    // Three even competencies: the shortest skill wording first, so the
    // realised sentence stays within 20 words for more students.
    const three = evenFacts('Proficient', {
      comps: [comp('a', 'Significance', 3.1), comp('b', 'Evidence', 3.0), comp('c', 'Cause', 2.9)],
    });
    expect(CommentBank.nextStepOf(three.comps).id).toBe('c');
    expect(CommentBank.evenSkills(three).map(x => x.key)).toEqual(['evidence', 'significance']);
    expect(CommentBank.evenSkillText(f)).toBe('support each claim with evidence from a source');
  });

  it('does not hold with a strongest competency, a half-step gap, or one judged competency', () => {
    expect(CommentBank.evenComps([comp('a', 'Evidence', 3.8), comp('b', 'Significance', 3)], 3.4)).toEqual([]);
    // Within the gate's gap but no 3-piece pair.
    expect(CommentBank.evenComps([comp('a', 'Evidence', 3.1), comp('b', 'Significance', 3, 2)], 3.1)).toEqual([]);
    // 0.5 is the gate's gap: not even.
    const half = [comp('a', 'Evidence', 3.4), comp('b', 'Significance', 3.2), comp('c', 'Inquiry', 2.9)];
    expect(CommentBank.strongestOf(half)).toEqual([]);
    expect(CommentBank.evenComps(half, 3.2)).toEqual([]);
  });

  it('does not hold when a thin competency sits outside the band, or one rounds to another word (the review of #613)', () => {
    // Two judged at 3.1 and 3.0, one on a single piece a full step above.
    const thinAbove = [comp('a', 'Evidence', 3.1), comp('b', 'Significance', 3.0), comp('c', 'Inquiry', 4.0, 1)];
    expect(CommentBank.strongestOf(thinAbove)).toEqual([]);
    expect(CommentBank.evenComps(thinAbove, 3.2)).toEqual([]);
    // Three judged at 3.1, 3.0 and 2.9, one on a single piece far below.
    const thinBelow = [
      comp('a', 'Evidence', 3.1),
      comp('b', 'Significance', 3.0),
      comp('c', 'Cause', 2.9),
      comp('d', 'Inquiry', 1.2, 1),
    ];
    expect(CommentBank.strongestOf(thinBelow)).toEqual([]);
    expect(CommentBank.evenComps(thinBelow, 2.9)).toEqual([]);
    // Within the band, but one rounds to Developing while the overall is Proficient.
    expect(CommentBank.evenComps([comp('a', 'Evidence', 2.7), comp('b', 'Significance', 2.3)], 2.5)).toEqual([]);
    // Both Developing, the overall Proficient from other work.
    expect(CommentBank.evenComps([comp('a', 'Evidence', 2.4), comp('b', 'Significance', 2.2)], 2.5)).toEqual([]);
    // The same two at the overall word: even.
    expect(CommentBank.evenComps([comp('a', 'Evidence', 2.4), comp('b', 'Significance', 2.2)], 2.3).length).toBe(2);
    // The frames are not offered and fail verify() for the thin-above student.
    const f = evenFacts('Proficient', { comps: thinAbove, overall: 3.2 });
    const ctx = CommentBank.context(f, {});
    expect(ctx.evenResults).toBe('');
    expect(ctx._evenWord).toBe('');
    // The Even Marks frames (the sample voice, Nov 4) are not offered.
    expect(CommentBank.stepPool('growth', ctx).filter(x => (x.needs || []).indexOf('evenResults') >= 0)).toEqual([]);
  });

  // The untagged frames, which carry the skill ({evenSkill}); the languages
  // family has its own, without it (tested with the languages frames).
  const frames = COMMENT_BANK.sentences.filter(s => s.group === 'Overall' && s.when && s.when.evenWord && !s.subjects);
  const skillWords = (family, key) => CommentBank.SKILLS[family].find(r => r.key === key).skill;

  // Twelve "can" frames for Extending and Proficient (six print the word);
  // seven for Developing and Emerging, whose "is learning to" and "is
  // beginning to" leave fewer words to spend (three print the word).
  const COUNTS = { Extending: [12, 6], Proficient: [12, 6], Developing: [7, 3], Emerging: [7, 3] };
});

describe('the IE deadline frames', () => {
  const frames = COMMENT_BANK.sentences.filter(s => s.group === 'IE Deadline');
  const ieFacts = deadline =>
    facts('socials', [comp('a', 'Evidence', 3)], {
      standing: '',
      overall: 0,
      record: { total: 8, handed: 4, late: 0, missing: 4 },
      notHandedIn: { count: 4, titles: ['A', 'B', 'C', 'D'], groups: [] },
      grade: {
        mode: 'letter',
        letter: 'IE',
        basis: 'ie',
        pieces: [],
        marked: { mine: 4, all: 8 },
        ieDeadline: deadline,
      },
    });

  it('has four frames, each with the date as its one fact', () => {
    expect(frames.length).toBe(4);
    frames.forEach(s => {
      expect(s).toMatchObject({ part: 'go', needs: ['ieDeadline'], when: { path: 'ie' }, claims: ['ie', 'deadline'] });
      expect(s.text).toContain('{ieDeadline}');
    });
  });

  it('no frame fits until a date is picked; then each says the date and verifies', () => {
    const none = CommentBank.context(ieFacts(''), {});
    const picked = CommentBank.context(ieFacts('2026-12-18'), {});
    expect(none.ieDeadline).toBe('');
    frames.forEach(s => {
      expect(CommentBank.fits(s, none), s.id).toBe(false);
      const text = CommentBank.fill(s, picked, { first: true });
      expect(text, s.id).toContain('December 18');
      expect(
        verified(s, text, CommentBank.provenance(s, picked), ieFacts('2026-12-18'), 'ieDeadline').replaced,
      ).toEqual([]);
      expect(
        verified(s, text, CommentBank.provenance(s, picked), ieFacts('2027-01-08'), 'ieDeadline').replaced.length,
      ).toBe(1);
      // With the date cleared, the sentence fails and nothing stands in.
      const v = verified(s, text, CommentBank.provenance(s, picked), ieFacts(''), 'ieDeadline');
      expect(v.replaced, s.id).toEqual([{ sentenceId: s.id, failed: expect.arrayContaining(['deadline']), by: null }]);
      expect(v.sentences, s.id).toEqual([]);
    });
  });

  it('verify fails any deadline sentence without a real date: [date] goes, or says the date once one is picked', () => {
    const picked = CommentBank.context(ieFacts('2026-12-18'), {});
    frames.forEach(s => {
      const legacy = CommentBank.fill(s, picked, { first: true }).replace('December 18', '[date]');
      const pv = Object.assign(CommentBank.provenance(s, picked), { values: { ieDeadline: '[date]' } });
      const none = verified(s, legacy, pv, ieFacts(''), 'ieDeadline');
      expect(none.text, s.id).toBe('');
      expect(none.replaced[0], s.id).toMatchObject({ sentenceId: s.id, failed: ['deadline'], by: null });
      const dated = verified(s, legacy, pv, ieFacts('2026-12-18'), 'ieDeadline');
      expect(dated.text, s.id).toBe(CommentBank.fill(s, picked, { first: true }));
      expect(dated.text).not.toContain('[date]');
      // A sentence the teacher kept that still says [date] is held to the same rule.
      const kept = { sentenceId: 'kept:ieDeadline', part: 'go', claims: [], factKeys: [], values: {}, kept: true };
      expect(verified(s, legacy, kept, ieFacts(''), 'ieDeadline').text).toBe('');
      expect(verified(s, legacy, kept, ieFacts('2026-12-18'), 'ieDeadline').text).toContain('December 18');
    });
  });

  it('the deadline picker finds the deadline sentence by its date, whichever frame it is, and replaces the date', () => {
    const RQ = ReportQuestionnaire;
    const picked = CommentBank.context(ieFacts('2026-12-18'), {});
    const moved = CommentBank.context(ieFacts('2027-01-08'), {});
    frames.forEach(s => {
      const before = CommentBank.fill(s, picked, { first: true });
      const text = 'Noor’s mark this term is IE. ' + before + ' Please contact me so we can talk about this plan.';
      // From the draft's record of the step, else from the text.
      const last = { sentences: [{ step: 'ieDeadline', text: before }] };
      expect(RQ.deadlineSentence(text, 'December 18', last, null), s.id).toBe(before);
      expect(RQ.deadlineSentence(text, 'December 18', null, null), s.id).toBe(before);
      expect(RQ.deadlineSentence(text, 'December 18', null, [{ step: 'ieDeadline', text: before }]), s.id).toBe(before);
      const after = before.replace('December 18', 'January 8');
      expect(after, s.id).toBe(CommentBank.fill(s, moved, { first: true }));
      const again = text.replace(before, after);
      expect(RQ.deadlineSentence(again, 'January 8', null, null), s.id).toBe(after);
      expect(RQ.deadlineSentence(again, 'December 18', null, null), s.id).toBe('');
      // No date picked before: there is no sentence to find.
      expect(RQ.deadlineSentence(text, '', null, null), s.id).toBe('');
    });
  });

  it("the picker matches the whole date, prefers the sentence that says IE, and never edits a teacher's sentence", () => {
    const RQ = ReportQuestionnaire;
    const deadline = 'The deadline to replace this IE with a grade is December 1.';
    // "December 1" is not in "December 18": the teacher's sentence is left alone.
    const text = 'Noor’s mark this term is IE. The next test is December 18. ' + deadline + ' Please contact me.';
    expect(RQ.deadlineSentence(text, 'December 1', null, null)).toBe(deadline);
    // A teacher-typed sentence with the same date earlier in the comment:
    // the sentence that says IE is the deadline's.
    const typed = 'Noor’s mark this term is IE. Work is due December 1. ' + deadline + ' Please contact me.';
    expect(RQ.deadlineSentence(typed, 'December 1', null, null)).toBe(deadline);
    // A row the teacher edited is never the one changed, even for its step.
    const rows = [{ step: 'ieDeadline', text: 'Work is due December 1.', edited: true }];
    expect(RQ.deadlineSentence(typed, 'December 1', null, rows)).toBe(deadline);
    // No sentence holds the date as a whole: nothing to change.
    expect(RQ.deadlineSentence('The next test is December 18. Please contact me.', 'December 1', null, null)).toBe('');
  });
});
