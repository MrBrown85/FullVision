/**
 * Habit Ratings (Colin, Nov 1: "each rating of each habit needs its own
 * selection"): every cell of the Work Habits grid, six habits × four
 * ratings, has its own group of frames bound to exactly that habit at
 * exactly that rating. Not Seen has none.
 *
 * - A cell has at least four frames that differ in structure.
 * - A frame fits only at its rating, and verify() fails it at any other.
 * - Generate never drafts a cell frame (Nov 4): the habits part for
 *   families says the student's habits together (hf01-hf38). The cell
 *   frames stay in Other Wording and Browse Sentences.
 * - Other Wording on a cell row offers only that cell's frames; on a row of
 *   the habits part for families, only that part's frames.
 * - A rating change still redraws the habits sentence (#586).
 * - The taxonomy fields (habit, level, skill, standing) match `when`.
 */
import './setup.js';
import { describe, expect, it } from 'vitest';

const RQ = ReportQuestionnaire;
const HE = { subj: 'he', obj: 'him', poss: 'his', refl: 'himself' };
const THEY = { subj: 'they', obj: 'them', poss: 'their', refl: 'themselves' };
const KEYS = ['completes', 'ready', 'others', 'part', 'feedback', 'devices'];
const LEVELS = [1, 2, 3, 4];
const all = v => Object.fromEntries(KEYS.map(k => [k, v]));
const cells = () => COMMENT_BANK.sentences.filter(s => s.group === 'Habit Ratings');
const cell = (habit, level) => cells().filter(s => s.habit === habit && s.level === level);
const FAMILY = ['Habits in Class', 'More Habits in Class', 'Habits That Would Help'];
const summaries = () => COMMENT_BANK.sentences.filter(s => FAMILY.indexOf(s.group) >= 0);
/* The Next Step frames, excluded where a cell frame is to be drafted: with
   a next step in the comment, the habits step takes the summary. */
const nextSteps = () => COMMENT_BANK.sentences.filter(s => s.group === 'Next Step').map(s => s.id);

function piece(day, pct) {
  const d = new Date(2026, 8, 1 + day);
  const iso =
    d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  return { id: 'p' + day, d: iso, pct };
}
/* A B student with eight even pieces and no record of handed-in work, so
   every habit is only what the teacher rates. */
function facts(over) {
  return Object.assign(
    {
      cid: 'cls-cells',
      sid: 'gabriel',
      name: 'Gabriel',
      first: 'Gabriel',
      course: 'History 12',
      family: 'socials',
      pronouns: HE,
      pronounsOnFile: true,
      comps: [],
      work: [],
      voice: {},
      confidence: [],
      record: { total: 0, handed: 0, late: 0, missing: 0 },
      notHandedIn: { count: 0, titles: [], groups: [] },
      habits: {},
      overall: 3,
      standing: '',
      letter: '',
      levelText: () => '',
      grade: {
        mode: 'letter',
        letter: 'B',
        pct: 80,
        next: null,
        pieces: Array.from({ length: 8 }, (_, i) => piece(i * 7, 80)),
      },
      enrolled: '2026-09-03',
      classStart: '2026-09-03',
      termStart: '2026-09-03',
    },
    over || {},
  );
}
const ctxFor = (habits, over) => CommentBank.context(facts(Object.assign({ habits }, over || {})), {});
/* One competency on three pieces, so the comment has a next step. */
const withNext = {
  comps: [
    {
      id: 'a',
      name: 'Evidence',
      scores: [0, 7, 14].map(d => Object.assign(piece(d, 75), { v: 3, title: 'Task ' + d })),
      start: 3,
      now: 3,
      level: 3,
      iCans: [],
    },
  ],
};
const habitsRow = d => d.sentences.find(x => x.step === 'habits');
/* Classmates' comments that hold every summary frame fitting this
   student, so the habits step has used them all. */
const summariesUsed = ctx =>
  summaries()
    .filter(s => CommentBank.fits(s, ctx))
    .map(s => CommentBank.fill(s, ctx));

describe('the Habit Ratings cells', () => {
  it('has 120 frames: at least four in each of the 24 cells, each bound to exactly that habit and rating', () => {
    expect(cells()).toHaveLength(120);
    KEYS.forEach(habit =>
      LEVELS.forEach(level => {
        const mine = cell(habit, level);
        expect(mine.length, habit + ' ' + level).toBeGreaterThanOrEqual(4);
        mine.forEach(s => {
          expect(s.part, s.id).toBe('habits');
          expect(s.when, s.id).toEqual({ [habit]: level });
          expect(s.claims, s.id).toEqual(['habits']);
          expect(s.needs || [], s.id).toEqual([]);
          expect(CommentBank.stepOf(s), s.id).toBe('habits');
        });
      }),
    );
    expect(cells().some(s => s.level === 5 || s.when[s.habit] === 5)).toBe(false);
  });

  it('frames in a cell differ in structure: no two start with the same three words, and none sits inside another', () => {
    KEYS.forEach(habit =>
      LEVELS.forEach(level => {
        const ctx = ctxFor({ ...all(4), [habit]: level });
        const texts = cell(habit, level).map(s => ({ s, t: CommentBank.fill(s, ctx) }));
        const openers = texts.map(x => x.t.toLowerCase().split(/\s+/).slice(0, 3).join(' '));
        expect(new Set(openers).size, habit + ' ' + level + ': ' + openers.join(' | ')).toBe(openers.length);
        texts.forEach(a =>
          texts.forEach(b => {
            if (a !== b) expect(CommentBank.usedBy(a.s, [b.t]), a.s.id + ' inside ' + b.s.id).toBe(0);
          }),
        );
      }),
    );
  });

  it('reads at 20 words or fewer for he and for they, with every slot filled', () => {
    cells().forEach(s => {
      [HE, THEY].forEach(p => {
        const ctx = ctxFor({ ...all(4), [s.habit]: s.level }, { pronouns: p, pronounsOnFile: p === HE });
        const t = CommentBank.fill(s, ctx);
        expect(t, s.id).not.toMatch(/[{}[\]]/);
        expect(CommentRealiser.wordCount(t), s.id + ': ' + t).toBeLessThanOrEqual(20);
      });
    });
  });

  it('names what the student does, or one thing to do, never a deficit, a second next step or a claim about the future', () => {
    cells().forEach(s => {
      expect(s.text, s.id).not.toMatch(
        /\b(rarely|fails?|needs? to|still|again|only|finally|unfortunately|at least)\b/i,
      );
      expect(s.text, s.id).not.toMatch(/\b(will|should)\b/i);
      expect(s.text, s.id).not.toMatch(/hand(s|ed|ing)? in/i);
      expect(s.text, s.id).not.toMatch(/!/);
      // The Next Step sentence is the comment's one next step (the review of
      // #603): no frame says "next step" or "to do next". A Sometimes or
      // Rarely frame names a thing to do, so it advises; a Usually or
      // Consistently frame does not.
      expect(s.text, s.id).not.toMatch(/next step|to do next/i);
      expect(CommentBank.advises(s), s.id).toBe(s.level <= 2);
      if (s.level >= 3) expect(CommentLint.advisesText(s.text), s.id).toBe(false);
      expect(s.text, s.id).not.toMatch(/^\{His\} next step/);
    });
  });

  it('does not assume a phone: a devices frame about the phone put away when asked says so (`phone`), the rest say device', () => {
    cells().forEach(s => {
      if (s.habit !== 'devices') expect(s.text, s.id).not.toMatch(/phone/i);
      else expect(!!s.phone, s.id).toBe(/\bphone\b/i.test(s.text));
    });
    LEVELS.forEach(level => {
      const mine = cell('devices', level);
      expect(mine.filter(s => !s.phone).length, 'devices ' + level + ' frames without a phone').toBeGreaterThanOrEqual(
        2,
      );
    });
  });

  it('fits only at its rating: true for a student rated so, false at every other rating and at Not Seen', () => {
    cells().forEach(s => {
      [1, 2, 3, 4, 5].forEach(lv => {
        const ctx = ctxFor({ ...all(4), [s.habit]: lv });
        expect(CommentBank.fits(s, ctx), s.id + ' at ' + lv).toBe(lv === s.level);
      });
      expect(CommentBank.fits(s, ctxFor({})), s.id + ' unrated').toBe(false);
    });
  });

  it('is offered by Browse Sentences for every cell: the fitting frames are its own', () => {
    KEYS.forEach(habit =>
      LEVELS.forEach(level => {
        const ctx = ctxFor({ ...all(4), [habit]: level });
        const list = RQ.browseList('habits', ctx, { fits: true });
        const ids = list.rows.map(r => r.id);
        cell(habit, level).forEach(s => expect(ids, s.id).toContain(s.id));
        cells()
          .filter(s => s.habit !== habit || s.level !== level)
          .forEach(s => {
            // Another cell fits only when it is a habit rated Consistently.
            expect(ids.indexOf(s.id) >= 0, s.id).toBe(s.habit !== habit && s.level === 4);
          });
      }),
    );
  });
});

describe('Generate and the Habit Ratings frames', () => {
  it('never drafts a cell frame, at any rating, with or without a next step, even once the habits part’s frames are used', () => {
    KEYS.forEach(habit =>
      LEVELS.forEach(level => {
        const habits = { ...all(4), [habit]: level };
        [ctxFor(habits), ctxFor(habits, withNext)].forEach(ctx => {
          const comments = summariesUsed(ctx);
          for (let seed = 1; seed <= 3; seed++) {
            const d = CommentBank.draft(ctx, { seed, comments });
            d.sentences
              .filter(x => /^habits/.test(x.step))
              .forEach(x => expect(x.id, habit + ' ' + level + ' seed ' + seed).toMatch(/^hf/));
            expect(
              d.ids.some(id => /^hl/.test(id)),
              habit + ' ' + level,
            ).toBe(false);
          }
          // The cell frames stay in Browse Sentences.
          const browse = RQ.browseList('habits', ctx, { fits: true }).rows.map(r => r.id);
          cell(habit, level).forEach(s => expect(browse, s.id).toContain(s.id));
        });
      }),
    );
  });

  it('a rating change redraws the habits part, and nothing else (#586)', () => {
    const prev = CommentBank.draft(ctxFor({ ...all(4), feedback: 2 }), { seed: 1, exclude: nextSteps() });
    const d = CommentBank.redrawHabits(ctxFor({ ...all(4), devices: 1 }), prev);
    expect(d.habits.after).toMatch(/keeping his phone and devices on his work\.$/);
    expect(d.sentences.map(x => x.step)).toEqual(prev.sentences.map(x => x.step));
    expect(d.text).toBe(prev.text.replace(d.habits.before, d.habits.after));
  });
});

describe('Other Wording and the Habit Ratings frames', () => {
  const rowOf = s => ({ id: s.id, step: CommentBank.stepOf(s), s, text: s.text });

  it('on a cell row offers only that cell’s other frames', () => {
    KEYS.forEach(habit =>
      LEVELS.forEach(level => {
        const ctx = ctxFor({ ...all(4), [habit]: level });
        const mine = cell(habit, level);
        const alts = RQ.alternatives(rowOf(mine[0]), ctx, {}, {});
        expect(alts.length, habit + ' ' + level).toBe(2);
        alts.forEach(s => {
          expect(s.habit, s.id).toBe(habit);
          expect(s.level, s.id).toBe(level);
          expect(s.id).not.toBe(mine[0].id);
        });
      }),
    );
  });

  it('on a row of the habits part for families, offers only that part’s frames, never a cell frame', () => {
    const ctx = ctxFor({ ...all(4), part: 2 });
    FAMILY.forEach(group => {
      const row = summaries().find(s => s.group === group && CommentBank.fits(s, ctx));
      if (!row) return;
      const alts = RQ.alternatives(rowOf(row), ctx, {}, {});
      expect(alts.length, group).toBeGreaterThan(0);
      alts.forEach(s => {
        expect(s.group).toBe(group);
        expect(CommentBank.fits(s, ctx)).toBe(true);
      });
    });
  });
});

describe('one next step a comment (advises)', () => {
  const adv = {
    id: 'zz-adv',
    part: 'habits',
    group: 'Habits That Would Help',
    text: 'The next step for {him} is {habitHelpOne}.',
    needs: ['habitHelpOne'],
    claims: ['habits'],
    advises: true,
    src: 'new',
  };
  const next = {
    id: 'zz-next',
    part: 'go',
    group: 'Next Step',
    text: 'Next, {he} can try one thing.',
    claims: [],
    advises: true,
    src: 'new',
  };
  const habits = { ...all(4), feedback: 2 };
  const bank = () => ({ parts: COMMENT_BANK.parts, sentences: COMMENT_BANK.sentences.concat([adv, next]) });
  const exclude = () =>
    summaries()
      .filter(s => s.group === 'Habits That Would Help')
      .map(s => s.id);
  const advising = d => d.sentences.filter(x => CommentBank.advises(bank().sentences.find(s => s.id === x.id)));

  it('advises: the Next Step sentence (claims nextStep), a sentence flagged advises, and every Sometimes or Rarely cell frame', () => {
    expect(CommentBank.advises(adv)).toBe(true);
    expect(CommentBank.advises(next)).toBe(true);
    COMMENT_BANK.sentences
      .filter(s => s.group === 'Next Step')
      .forEach(s => expect(CommentBank.advises(s), s.id).toBe(true));
    cells().forEach(s => expect(CommentBank.advises(s), s.id).toBe(s.level <= 2));
    expect(cells().filter(s => s.advises === true).length).toBe(60);
  });

  it('a draft never holds two advising sentences: the Next Step step keeps the one, whatever the order', () => {
    const ctx = ctxFor(habits);
    const d = CommentBank.draft(ctx, { seed: 1, bank: bank(), exclude: exclude() });
    expect(d.sentences.some(x => x.step === 'nextStep')).toBe(true);
    expect(d.ids).not.toContain('zz-adv');
    expect(advising(d)).toHaveLength(1);
    const first = CommentBank.draft(ctx, {
      seed: 1,
      bank: bank(),
      exclude: exclude(),
      order: ['nextStep', 'habits', 'habitsBuild'],
    });
    expect(first.sentences.some(x => x.step === 'nextStep')).toBe(true);
    expect(first.ids).not.toContain('zz-adv');
    expect(advising(first)).toHaveLength(1);
    // With no Next Step sentence in the draft, an advising habits frame after
    // the Next Step step's place is allowed, and it is the one.
    const alone = CommentBank.draft(ctx, {
      seed: 1,
      bank: bank(),
      exclude: exclude().concat(
        ['zz-next'],
        COMMENT_BANK.sentences.filter(s => s.group === 'Next Step').map(s => s.id),
      ),
      order: ['nextStep', 'habits', 'habitsBuild'],
    });
    expect(alone.ids).toContain('zz-adv');
    expect(advising(alone)).toHaveLength(1);
  });
});

describe('the taxonomy fields', () => {
  it('match each sentence’s conditions: habit and level, skill, standing, story', () => {
    COMMENT_BANK.sentences.forEach(s => {
      const when = s.when || {};
      const habitKeys = Object.keys(when).filter(k => KEYS.indexOf(k) >= 0);
      if (habitKeys.length === 1) {
        expect(s.habit, s.id).toBe(habitKeys[0]);
        expect(s.level, s.id).toBe(when[habitKeys[0]]);
      } else {
        expect(s.habit, s.id).toBeUndefined();
        expect(s.level, s.id).toBeUndefined();
      }
      if (when.nextSkill) expect(s.skill, s.id).toBe(when.nextSkill);
      else expect(s.skill, s.id).toBeUndefined();
      if (when.standing) expect(s.standing, s.id).toBe(when.standing);
      else expect(s.standing, s.id).toBeUndefined();
      const story = (s.needs || []).find(k => ['climb', 'split', 'hidden', 'newcomer'].indexOf(k) >= 0);
      if (story) expect(s.story, s.id).toBe(story);
      else expect(s.story, s.id).toBeUndefined();
    });
    expect(COMMENT_BANK.sentences.filter(s => s.skill).length).toBeGreaterThan(300);
    // No Overall sentence conditions on the standing word: the grade
    // sentence says it once, so the ones that did were cut (2026-11-01).
    // The grade frames for one proficiency word (gv01-gv35, the sample
    // voice) carry it.
    expect(COMMENT_BANK.sentences.filter(s => s.standing && s.group !== 'Grade').length).toBe(0);
    expect(COMMENT_BANK.sentences.filter(s => s.standing).length).toBe(20);
  });
});
