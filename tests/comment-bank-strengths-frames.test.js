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
    expect(CommentBank.stepPool('overall', ctx)).toEqual([]);
    const even = evenFacts('Proficient');
    const ectx = CommentBank.context(even, {});
    const s = frames.find(x => x.when.evenWord === 'Proficient');
    const text = CommentBank.fill(s, ectx, { first: true });
    expect(verified(s, text, CommentBank.provenance(s, ectx), f, 'overall').replaced.length).toBe(1);
  });

  const frames = COMMENT_BANK.sentences.filter(s => s.group === 'Overall' && s.when && s.when.evenWord);
  // Twelve "can" frames for Extending and Proficient (six print the word);
  // seven for Developing and Emerging, whose "is learning to" and "is
  // beginning to" leave fewer words to spend (three print the word).
  const COUNTS = { Extending: [12, 6], Proficient: [12, 6], Developing: [7, 3], Emerging: [7, 3] };
  it('has six or more frames per proficiency word, all nine words around the skill', () => {
    WORDS.forEach(w => {
      const mine = frames.filter(s => s.when.evenWord === w);
      expect(mine.length, w).toBe(COUNTS[w][0]);
      expect(mine.filter(s => s.needs.indexOf('evenWord') >= 0).length, w).toBe(COUNTS[w][1]);
      // Nine words around the skill (the slot counted once makes ten), so
      // an eleven-word skill keeps the realised sentence within 20.
      mine.forEach(s => expect(CommentLint.plain(s.text).split(/\s+/).length, s.id).toBe(10));
      // The length rule (a sentence over 20 words loses to a shorter one)
      // cannot favour one frame of the pool: each has the same number of
      // words around the skill.
      const around = mine.map(s => CommentLint.plain(s.text).split(/\s+/).length);
      expect(new Set(around).size, w + ': ' + around.join(',')).toBe(1);
      mine.forEach(s => {
        expect(s.claims, s.id).toEqual(['evenResults']);
        expect(s.needs, s.id).toContain('evenSkill');
        expect(s.text, s.id).not.toMatch(/\b(same|equal|level|competency)\b/i);
      });
      // No two start with the same three words.
      const starts = mine.map(s => CommentLint.plain(s.text).split(/\s+/).slice(0, 3).join(' '));
      expect(new Set(starts).size, w).toBe(starts.length);
    });
  });

  WORDS.forEach(w =>
    it(`${w}: the frames are the strengths pool in a Proficiency class, print the word and verify`, () => {
      const f = evenFacts(w);
      const ctx = CommentBank.context(f, {});
      expect(ctx.evenResults).toBe('yes');
      expect(ctx._evenWord).toBe(w);
      expect(ctx.evenWord).toBe(w);
      expect(ctx._strongSkill).toBe('');
      const pool = CommentBank.stepPool('overall', ctx);
      expect(pool.map(s => s.id).sort()).toEqual(
        frames
          .filter(s => s.when.evenWord === w)
          .map(s => s.id)
          .sort(),
      );
      pool.forEach(s => {
        const text = CommentBank.fill(s, ctx, { first: true });
        expect(text, s.id).not.toMatch(/[{}[\]]/);
        if (s.needs.indexOf('evenWord') >= 0) expect(text, s.id).toContain(w);
        else WORDS.forEach(x => expect(text, s.id).not.toContain(x));
        expect(text, s.id).toContain('support each claim with evidence from a source');
        const pv = CommentBank.provenance(s, ctx);
        expect(pv.factKeys, s.id).toContain('comp:a');
        expect(verified(s, text, pv, f, 'overall').replaced, s.id).toEqual([]);
        // Not even any more: the sentence is replaced.
        const changed = Object.assign({}, f, { comps: [comp('a', 'Evidence', 3.9), comp('b', 'Significance', 2.8)] });
        expect(verified(s, text, pv, changed, 'overall').replaced.length, s.id).toBe(1);
      });
      // The draft gets a strengths sentence.
      const d = CommentBank.draft(ctx, { seed: 3 });
      expect(d.sentences.some(x => x.step === 'overall')).toBe(true);
    }),
  );

  it('in a Letter class, only the frames that do not print the word fit, bound to the same word', () => {
    const f = evenFacts('Developing', {
      standing: '',
      letter: 'a C (62%)',
      grade: { mode: 'letter', letter: 'C', pct: 62, pieces: [] },
    });
    const ctx = CommentBank.context(f, {});
    expect(ctx.evenWord).toBe('');
    expect(ctx._evenWord).toBe('Developing');
    const pool = CommentBank.stepPool('overall', ctx);
    expect(pool.length).toBe(4);
    pool.forEach(s => {
      expect(s.when.evenWord).toBe('Developing');
      const text = CommentBank.fill(s, ctx, { first: true });
      expect(text).toMatch(/learning to/);
      WORDS.forEach(x => expect(text, s.id).not.toContain(x));
      expect(verified(s, text, CommentBank.provenance(s, ctx), f, 'overall').replaced).toEqual([]);
    });
  });
});

describe('the strengths frames per skill', () => {
  const frames = COMMENT_BANK.sentences.filter(s => s.group === 'Overall' && s.when && s.when.strongSkill);
  const forSkill = (family, key) => frames.filter(s => s.subjects[0] === family && s.when.strongSkill === key);
  /* The table row's competency strongest (four, on three pieces), one other
     a full step lower. */
  const strongFacts = (family, row) => facts(family, [comp('a', row.name, 4), comp('b', 'Other Area', 2.5)]);

  // The skills with strengths frames: the table's original 43 rows. The 43
  // rows lane H added (#611) have none yet; a later lane writes them.
  const covered = [];
  Object.entries(CommentBank.SKILLS).forEach(([family, rows]) =>
    rows.forEach(row => {
      if (forSkill(family, row.key).length) covered.push([family, row]);
    }),
  );

  it('give the table’s original 43 skills at least three frames each, bound to the skill and its kind of class', () => {
    expect(covered.length).toBe(43);
    expect(frames.length).toBe(129);
    covered.forEach(([family, row]) => {
      {
        const mine = forSkill(family, row.key);
        expect(mine.length, family + '.' + row.key).toBeGreaterThanOrEqual(3);
        mine.forEach(s => {
          expect(s).toMatchObject({ part: 'now', group: 'Overall', claims: ['strength'], subjects: [family] });
          expect(s.needs).toEqual(['strongSkill']);
          expect(s.text, s.id).not.toMatch(/\{strengths?\}/);
          expect(s.text, s.id).not.toMatch(/\b(competency|level)\b/i);
        });
      }
    });
  });

  covered.forEach(([family, row]) => {
    {
      it(`${family}.${row.key}: the frames are the strengths pool, differ in structure and verify`, () => {
        const f = strongFacts(family, row);
        const ctx = CommentBank.context(f, {});
        expect(ctx._strongSkill).toBe(row.key);
        expect(ctx.evenResults).toBe('');
        const mine = forSkill(family, row.key);
        const pool = CommentBank.stepPool('overall', ctx).map(s => s.id);
        expect(pool.sort()).toEqual(mine.map(s => s.id).sort());
        const texts = mine.map(s => CommentBank.fill(s, ctx, { first: true }));
        const starts = texts.map(x => x.split(/\s+/).slice(0, 3).join(' '));
        expect(new Set(starts).size, starts.join(' | ')).toBe(starts.length);
        texts.forEach(t => expect(t).not.toMatch(/[{}[\]]/));
        mine.forEach((s, i) => {
          const pv = CommentBank.provenance(s, ctx);
          expect(pv.factKeys, s.id).toContain('comp:a');
          expect(pv.values['when.strongSkill']).toBe(row.key);
          expect(verified(s, texts[i], pv, f, 'overall').replaced, s.id).toEqual([]);
          // The other competency now strongest: the frame no longer holds.
          const swapped = Object.assign({}, f, { comps: [comp('a', row.name, 2.5), comp('b', 'Other Area', 4)] });
          expect(verified(s, texts[i], pv, swapped, 'overall').replaced.length, s.id).toBe(1);
        });
      });
    }
  });
});

describe('the grade frames per proficiency word', () => {
  const frames = COMMENT_BANK.sentences.filter(s => s.group === 'Grade' && s.when && s.when.grade === 'proficiency');
  it('has ten frames per word beside the generic ones, each saying the word and "proficiency"', () => {
    WORDS.forEach(w => {
      const mine = frames.filter(s => s.when.standing === w);
      expect(mine.length, w).toBe(10);
      mine.forEach(s => {
        expect(s.text, s.id).toContain(w);
        // Every frame names the scale or the student's proficiency, never "level".
        expect(s.text, s.id).toMatch(/\bproficiency\b/);
        expect(s.text, s.id).not.toMatch(/\blevel\b/i);
        expect(s.claims).toEqual(['grade']);
        // The scale's descriptor, as the report legend words it; Extending is
        // never "beyond the course".
        if (w === 'Extending') expect(s.text, s.id).not.toMatch(/beyond/i);
      });
      const starts = mine.map(s => CommentLint.plain(s.text).split(/\s+/).slice(0, 3).join(' '));
      expect(new Set(starts).size, w).toBe(starts.length);
    });
    expect(frames.filter(s => !s.when.standing).length).toBeGreaterThanOrEqual(7);
  });

  WORDS.forEach(w =>
    it(`${w}: the word's frames and the generic ones share the grade tier, fill and verify`, () => {
      const f = facts('science', [comp('a', 'Questioning', LEVEL[w])], { overall: LEVEL[w], standing: w });
      const ctx = CommentBank.context(f, {});
      const pool = CommentBank.stepPool('grade', ctx).map(s => s.id);
      expect(pool).toContain('gr05');
      frames.filter(s => s.when.standing === w).forEach(s => expect(pool, s.id).toContain(s.id));
      WORDS.filter(x => x !== w).forEach(x =>
        frames.filter(s => s.when.standing === x).forEach(s => expect(pool, s.id).not.toContain(s.id)),
      );
      frames
        .filter(s => s.when.standing === w)
        .forEach(s => {
          const text = CommentBank.fill(s, ctx, { first: true });
          expect(text).not.toMatch(/[{}[\]]/);
          expect(text).toContain(w);
          expect(verified(s, text, CommentBank.provenance(s, ctx), f, 'grade').replaced).toEqual([]);
        });
    }),
  );
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

  it('every frame fits on the IE path, says [date] until one is picked, then the date, and verifies', () => {
    const none = CommentBank.context(ieFacts(''), {});
    const picked = CommentBank.context(ieFacts('2026-12-18'), {});
    frames.forEach(s => {
      expect(CommentBank.fits(s, none), s.id).toBe(true);
      expect(CommentBank.fill(s, none, { first: true }), s.id).toContain('[date]');
      const text = CommentBank.fill(s, picked, { first: true });
      expect(text, s.id).toContain('December 18');
      expect(
        verified(s, text, CommentBank.provenance(s, picked), ieFacts('2026-12-18'), 'ieDeadline').replaced,
      ).toEqual([]);
      expect(
        verified(s, text, CommentBank.provenance(s, picked), ieFacts('2027-01-08'), 'ieDeadline').replaced.length,
      ).toBe(1);
    });
  });
  it('the deadline picker finds the deadline sentence by its date, whichever frame it is, and replaces the date', () => {
    const RQ = ReportQuestionnaire;
    const none = CommentBank.context(ieFacts(''), {});
    const picked = CommentBank.context(ieFacts('2026-12-18'), {});
    frames.forEach(s => {
      const before = CommentBank.fill(s, none, { first: true });
      const text = 'Noor’s mark this term is IE. ' + before + ' Please contact me so we can talk about this plan.';
      // From the draft's record of the step, else from the text.
      const last = { sentences: [{ step: 'ieDeadline', text: before }] };
      expect(RQ.deadlineSentence(text, '[date]', last, null), s.id).toBe(before);
      expect(RQ.deadlineSentence(text, '[date]', null, null), s.id).toBe(before);
      expect(RQ.deadlineSentence(text, '[date]', null, [{ step: 'ieDeadline', text: before }]), s.id).toBe(before);
      const after = before.replace('[date]', 'December 18');
      expect(after, s.id).toBe(CommentBank.fill(s, picked, { first: true }));
      const again = text.replace(before, after);
      expect(RQ.deadlineSentence(again, 'December 18', null, null), s.id).toBe(after);
      expect(RQ.deadlineSentence(again, '[date]', null, null), s.id).toBe('');
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
