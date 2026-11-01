/**
 * Habit Ratings (Colin, Nov 1: "each rating of each habit needs its own
 * selection"): every cell of the Work Habits grid, six habits × four
 * ratings, has its own group of frames bound to exactly that habit at
 * exactly that rating. Not Seen has none.
 *
 * - A cell has at least four frames that differ in structure.
 * - A frame fits only at its rating, and verify() fails it at any other.
 * - Generate drafts a cell frame only when exactly one habit is rated below
 *   Usually: that habit's frames share the summary's tier and rotate with
 *   it, least used first, and every one names that habit.
 * - Other Wording on a cell row offers only that cell's frames; on the
 *   summary row, cell frames whose rating matches are eligible.
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
const summaries = () => COMMENT_BANK.sentences.filter(s => s.group === 'Work Habits');

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

  it('names what the student does, or one next step, never a deficit or a claim about the future', () => {
    cells().forEach(s => {
      expect(s.text, s.id).not.toMatch(
        /\b(rarely|fails?|needs? to|still|again|only|finally|unfortunately|at least)\b/i,
      );
      expect(s.text, s.id).not.toMatch(/\b(will|should)\b/i);
      expect(s.text, s.id).not.toMatch(/hand(s|ed|ing)? in/i);
      expect(s.text, s.id).not.toMatch(/!/);
      if (s.level <= 2) expect(s.text, s.id).toMatch(/next step|thing (to do|for \{him\} to do)/);
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
  const drafted = (habits, comments, seed) =>
    habitsRow(CommentBank.draft(ctxFor(habits), { seed: seed || 1, comments: comments || [] }));
  /* The habits sentence of n classmates with the same ratings, drafted in
     turn with each draft a classmate's comment (exhaust before repeat). */
  const overClass = (habits, n) => {
    const comments = [];
    const rows = [];
    for (let i = 1; i <= n; i++) {
      const d = CommentBank.draft(ctxFor(habits, { sid: 'cell-s' + i }), { seed: i, comments: comments.slice() });
      comments.push({ sid: 'cell-s' + i, text: d.text });
      rows.push(habitsRow(d));
    }
    return rows;
  };

  it('keeps the summary sentence as the only pick at Usually and Consistently', () => {
    KEYS.forEach(habit =>
      [3, 4].forEach(level => {
        for (let seed = 1; seed <= 4; seed++) {
          const row = drafted({ ...all(4), [habit]: level }, [], seed);
          expect(row, habit + ' ' + level).toBeTruthy();
          expect(row.id, habit + ' ' + level + ' seed ' + seed).toMatch(/^hs/);
        }
      }),
    );
  });

  it('with one habit below Usually, that habit’s cell frames share the summary’s tier and rotate with it from the first student', () => {
    KEYS.forEach(habit =>
      [1, 2].forEach(level => {
        const habits = { ...all(4), [habit]: level };
        const ctx = ctxFor(habits);
        const pool = summaries()
          .filter(s => CommentBank.fits(s, ctx))
          .map(s => s.id)
          .concat(cell(habit, level).map(s => s.id));
        const rows = overClass(habits, pool.length);
        const ids = rows.map(r => r.id);
        // Exhaust before repeat over both sets: every frame once before any twice.
        expect(ids.slice().sort(), habit + ' ' + level).toEqual(pool.slice().sort());
        // A cell frame comes before the summary frames alone could run out.
        expect(
          ids.slice(0, pool.length - cell(habit, level).length).some(id => /^hl/.test(id)),
          habit + ' ' + level,
        ).toBe(true);
        rows.forEach(r => {
          const s = COMMENT_BANK.sentences.find(x => x.id === r.id);
          if (s.habit) expect([s.habit, s.level], r.id).toEqual([habit, level]);
          expect(r.text, r.id).not.toMatch(/[{}[\]]/);
        });
      }),
    );
  });

  it('never drafts a cell frame when no habit, or two, are rated below Usually', () => {
    [
      all(4),
      { ...all(4), ready: 3 },
      { ...all(4), feedback: 2, devices: 1 },
      { ...all(3), part: 2, others: 2 },
    ].forEach(habits => {
      const ctx = ctxFor(habits);
      const comments = summariesUsed(ctx);
      for (let seed = 1; seed <= 4; seed++) {
        const row = drafted(habits, comments, seed);
        if (row) expect(row.id, JSON.stringify(habits)).not.toMatch(/^hl/);
      }
    });
  });

  it('verify() fails a cell frame at any other rating', () => {
    const habits = { ...all(4), feedback: 2 };
    const f = facts({ habits });
    const d = CommentBank.draft(CommentBank.context(f, {}), { seed: 1, comments: summariesUsed(ctxFor(habits)) });
    const row = habitsRow(d);
    expect(row.id).toMatch(/^hl/);
    expect(CommentBank.verify(d, f, {}).replaced).toEqual([]);
    [1, 3, 4, 5].forEach(lv => {
      const v = CommentBank.verify(d, facts({ habits: { ...all(4), feedback: lv } }), {});
      const mine = v.replaced.find(r => r.sentenceId === row.id);
      expect(mine, 'feedback ' + lv).toBeTruthy();
      expect(mine.failed).toContain('habits');
    });
  });

  it('a rating change redraws a cell frame as the habits sentence, and nothing else (#586)', () => {
    const habits = { ...all(4), feedback: 2 };
    const prev = CommentBank.draft(ctxFor(habits), { seed: 1, comments: summariesUsed(ctxFor(habits)) });
    expect(habitsRow(prev).id).toMatch(/^hl/);
    const d = CommentBank.redrawHabits(ctxFor({ ...all(4), devices: 1 }), prev);
    expect(d.habits.before).toBe(habitsRow(prev).text);
    expect(d.habits.after).toMatch(/using devices well/);
    expect(d.sentences.map(x => x.step)).toEqual(prev.sentences.map(x => x.step));
    expect(d.text).toBe(prev.text.replace(d.habits.before, d.habits.after));
  });
});

describe('Other Wording and the Habit Ratings frames', () => {
  const rowOf = s => ({ id: s.id, step: 'habits', s, text: s.text });

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

  it('on the summary row, a cell frame whose rating matches is eligible once the summary frames are used', () => {
    const ctx = ctxFor({ ...all(4), part: 2 });
    const usage = {};
    summaries().forEach(s => (usage[s.id] = 1));
    const row = summaries().find(s => CommentBank.fits(s, ctx));
    const alts = RQ.alternatives(rowOf(row), ctx, usage, {});
    expect(alts).toHaveLength(2);
    alts.forEach(s => {
      expect(s.group).toBe('Habit Ratings');
      expect(CommentBank.fits(s, ctx)).toBe(true);
    });
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
    // No sentence conditions on the standing word: the grade sentence says
    // it once, so the Overall sentences that did were cut (2026-11-01).
    expect(COMMENT_BANK.sentences.filter(s => s.standing).length).toBe(0);
  });
});
