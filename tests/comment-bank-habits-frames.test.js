/**
 * The habits-part frames grown 2026-11-01 (Colin: "too little variation"):
 * Work Habits (hs16-hs37), Strong Habits (hs13-hs15), Attendance
 * (h61-h78) and Not Handed In (m02-m21). Every frame of a case is
 * reachable (selection picks each one for some seed), fills with no slot
 * left, holds the exact facts, verifies against them and fails verify()
 * once they change; absences-only and lates-only frames never fit when
 * both counts are entered.
 */
import './setup.js';
import { describe, expect, it } from 'vitest';

const HE = { subj: 'he', obj: 'him', poss: 'his', refl: 'himself' };
const THEY = { subj: 'they', obj: 'them', poss: 'their', refl: 'themselves' };
const KEYS = CommentBank.HABITS.map(h => h.key);
const all = v => Object.fromEntries(KEYS.map(k => [k, v]));
const byId = id => COMMENT_BANK.sentences.find(s => s.id === id);
const ids = (a, b, prefix, pad) =>
  Array.from({ length: b - a + 1 }, (_, i) => prefix + String(a + i).padStart(pad || 2, '0'));

function piece(day, pct) {
  const d = new Date(2026, 8, 1 + day);
  const iso =
    d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  return { id: 'p' + day, d: iso, pct };
}
/* A B student with eight even pieces; nothing missing or entered unless
   the test says so. */
function facts(over) {
  return Object.assign(
    {
      cid: 'cls-frames',
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
const ctxOf = f => CommentBank.context(f, {});

/* The ids a step picks over `n` classmates with the same facts, drafted in
   turn with each draft counting as a classmate's comment (exhaust before
   repeat, as Generate runs over a class), and each one's sentence for the
   step. A frame that starts like the sentence before it ("He …" after the
   grade sentence) comes after the others at equal use, so a class, not one
   student, is what reaches every frame. */
function picks(f, step, n) {
  const out = {};
  const comments = [];
  for (let seed = 1; seed <= (n || 40); seed++) {
    // A classmate of their own: a sentence with no pattern (m01, hs11)
    // counts as used through the draft record, by student id.
    const ctx = ctxOf({ ...f, sid: 's' + seed });
    const d = CommentBank.draft(ctx, { seed, comments: comments.slice() });
    comments.push({ sid: 's' + seed, text: d.text });
    const s = d.sentences.find(x => x.step === step);
    if (s) out[s.id] = s.text;
  }
  return out;
}
function expectReachable(f, step, want) {
  const got = picks(f, step);
  want.forEach(id => expect(Object.keys(got), id + ' never picked').toContain(id));
  Object.keys(got).forEach(id => {
    expect(want, id + ' picked outside its case').toContain(id);
    expect(got[id], id).not.toMatch(/[{}[\]]/);
    expect(CommentRealiser.wordCount(got[id]), id + ': ' + got[id]).toBeLessThanOrEqual(20);
  });
  return got;
}
function expectVerifies(f, step, changed) {
  const ctx = ctxOf(f);
  for (let seed = 1; seed <= 12; seed++) {
    const d = CommentBank.draft(ctx, { seed });
    const s = d.sentences.find(x => x.step === step);
    expect(s, 'seed ' + seed).toBeTruthy();
    expect(CommentBank.verify(d, f, {}).replaced).toEqual([]);
    const v = CommentBank.verify(d, changed, {});
    expect(
      v.replaced.map(r => r.sentenceId),
      s.id + ' after the facts changed',
    ).toContain(s.id);
  }
}

describe('Not Handed In frames', () => {
  const nh = (count, titles, groups) => facts({ notHandedIn: { count, titles, groups: groups || [] } });
  const one = nh(1, ['4.2 Map Quiz']);
  const two = nh(2, ['Map Quiz', 'Poster']);
  const many = nh(4, ['Map Quiz', 'Poster', 'Lab: Heat', 'Essay']);
  const group = nh(
    15,
    ['Current Events: Week 1', 'Current Events: Week 2', 'Current Events: Week 3'],
    [{ name: 'Current Events', count: 6 }],
  );

  it('one title: m01-m06, the title quoted with the lesson number dropped', () => {
    const got = expectReachable(one, 'notHandedIn', ids(1, 6, 'm'));
    Object.values(got).forEach(t => {
      expect(t).toMatch(/not handed in/);
      expect(t).toMatch(/“Map Quiz\.?”/);
      expect(t).not.toMatch(/4\.2/);
    });
  });

  it('two titles: m01, m07-m11, both titles joined with "and"', () => {
    const got = expectReachable(two, 'notHandedIn', ['m01'].concat(ids(7, 11, 'm')));
    Object.values(got).forEach(t => expect(t).toMatch(/“Map Quiz” and “Poster\.?”/));
  });

  it('three or more with no group: m01, m12-m16, the count only', () => {
    const got = expectReachable(many, 'notHandedIn', ['m01'].concat(ids(12, 16, 'm')));
    Object.values(got).forEach(t => {
      expect(t).toMatch(/\b(Four|four)\b/);
      expect(t).not.toMatch(/“|including/);
    });
  });

  it('the count and a group: m01, m17-m21, numerals inside a sentence and words at its start', () => {
    const got = expectReachable(group, 'notHandedIn', ['m01'].concat(ids(17, 21, 'm')));
    Object.values(got).forEach(t => {
      expect(t).toMatch(/\bFifteen\b|\b15\b/);
      expect(t).toMatch(/six Current Events assignments/);
    });
    expect(got.m17).toMatch(/^This term, 15 assignments/);
    expect(got.m20).toMatch(/the 15 assignments/);
  });

  it('a frame fails verify() once the work it names changes', () => {
    expectVerifies(two, 'notHandedIn', nh(1, ['Poster']));
    expectVerifies(group, 'notHandedIn', nh(15, ['Current Events: Week 1']));
  });

  it('the slots come from one builder (missingSlots), shared with verify()', () => {
    expect(CommentBank.missingSlots(one.notHandedIn)).toEqual({ title: '“Map Quiz”', titles: '', many: '', group: '' });
    expect(CommentBank.missingSlots(two.notHandedIn).titles).toBe('“Map Quiz” and “Poster”');
    expect(CommentBank.missingSlots(many.notHandedIn)).toMatchObject({ many: 'yes', group: '' });
    expect(CommentBank.missingSlots(group.notHandedIn)).toMatchObject({
      many: '',
      group: 'six Current Events assignments',
    });
    expect(CommentBank.missingSlots({ count: 0, titles: [], groups: [] })).toEqual({
      title: '',
      titles: '',
      many: '',
      group: '',
    });
  });
});

describe('Attendance frames', () => {
  const att = (absent, late) => facts({ absent, late });

  it('absences only: h60 (its late half left out) and h62-h66, the classes missed, singular for one', () => {
    const got = expectReachable(att(3, 0), 'attendance', ['h60'].concat(ids(62, 66, 'h')));
    Object.values(got).forEach(t => {
      expect(t).toMatch(/three classes/);
      expect(t).not.toMatch(/late/);
    });
    const oneClass = picks(att(1, null), 'attendance');
    Object.values(oneClass).forEach(t => expect(t).toMatch(/one class\b/));
  });

  it('lates only: h60 (its absent half left out) and h68-h72, once, twice, then times', () => {
    const got = expectReachable(att(0, 2), 'attendance', ['h60'].concat(ids(68, 72, 'h')));
    Object.values(got).forEach(t => {
      expect(t).toMatch(/\btwice\b/);
      expect(t).not.toMatch(/missed|away|absent/);
    });
    Object.values(picks(att(null, 1), 'attendance')).forEach(t => expect(t).toMatch(/\bonce\b/));
    Object.values(picks(att(null, 12), 'attendance')).forEach(t => expect(t).toMatch(/\b12 times\b/));
  });

  it('both counts: h60, h74-h78, both halves said and the exact counts', () => {
    const got = expectReachable(att(4, 1), 'attendance', ['h60'].concat(ids(74, 78, 'h')));
    Object.values(got).forEach(t => {
      expect(t).toMatch(/four classes/);
      expect(t).toMatch(/\bonce\b/);
    });
    expect(got.h60).toBe('He has missed four classes and been late once this term.');
  });

  it('a frame fails verify() once the counts change, and an absences-only one once a late is entered', () => {
    expectVerifies(att(3, 0), 'attendance', att(4, 0));
    expectVerifies(att(3, 0), 'attendance', att(3, 1));
    expectVerifies(att(0, 2), 'attendance', att(1, 2));
    expectVerifies(att(4, 1), 'attendance', att(4, 2));
  });

  it('singular they takes plural verbs in every frame', () => {
    const f = facts({ absent: 2, late: 2, pronouns: THEY });
    const got = picks(f, 'attendance');
    expect(Object.keys(got).length).toBeGreaterThan(3);
    Object.values(got).forEach(t => expect(t).not.toMatch(/\b(has|was)\b/));
  });
});

describe('Work Habits frames', () => {
  const hab = habits => facts({ habits });

  it('excellent: hs01, hs02, hs17, hs18, hs20, hs21, never a habit name', () => {
    const got = expectReachable(hab(all(4)), 'habits', ['hs01', 'hs02', 'hs17', 'hs18', 'hs20', 'hs21']);
    Object.values(got).forEach(t => expect(t).not.toMatch(/Usually|to build|class time|feedback/));
  });

  it('good: hs03, hs04, hs23-hs27', () => {
    const got = expectReachable(hab({ ...all(3), part: 4 }), 'habits', ['hs03', 'hs04'].concat(ids(23, 27, 'hs')));
    Object.values(got).forEach(t => expect(t).not.toMatch(/excellent|to build/));
  });

  it('one habit to build: hs05-hs07, hs28-hs33, named only through the summary slot', () => {
    const got = expectReachable(hab({ ...all(4), feedback: 2 }), 'habits', ids(5, 7, 'hs').concat(ids(28, 33, 'hs')));
    Object.values(got).forEach(t => {
      expect(t).toMatch(/using feedback/i);
      expect(t).not.toMatch(/ and |excellent|good/);
    });
    expect(got.hs32).toBe('Using feedback is the work habit to build next.');
  });

  it('two habits to build: hs08-hs10, hs34-hs37, the lower first', () => {
    const got = expectReachable(
      hab({ ...all(4), ready: 2, devices: 1 }),
      'habits',
      ids(8, 10, 'hs').concat(ids(34, 37, 'hs')),
    );
    Object.values(got).forEach(t => expect(t).toMatch(/using devices well and using class time well/i));
  });

  it('every frame reads in PE and Arts through habitWords, under 20 words with the longest phrases', () => {
    ['pe', 'arts'].forEach(family => {
      const two = picks(facts({ family, habits: { ...all(4), completes: 1, others: 2 } }), 'habits');
      Object.values(two).forEach(t => {
        expect(t).not.toMatch(/hand/i);
        expect(CommentRealiser.wordCount(t), family + ': ' + t).toBeLessThanOrEqual(20);
      });
      if (family === 'pe') Object.values(two).forEach(t => expect(t).toMatch(/taking a full part in every activity/i));
      if (family === 'arts') Object.values(two).forEach(t => expect(t).toMatch(/completing his work/i));
    });
  });

  it('a frame fails verify() once a rating changes', () => {
    expectVerifies(hab(all(4)), 'habits', hab({ ...all(4), part: 3 }));
    expectVerifies(hab({ ...all(4), feedback: 2 }), 'habits', hab({ ...all(4), feedback: 3 }));
  });

  it('"all six" and "every one" frames need every habit rated (habitsAllSeen): a Not Seen habit leaves hs01/hs02 (hs03/hs04) only', () => {
    const notSeen = hab({ ...all(4), devices: 5 });
    expect(ctxOf(notSeen).habitsExcellent).toBe('yes');
    expect(ctxOf(notSeen).habitsAllSeen).toBe('');
    expect(Object.keys(picks(notSeen, 'habits')).sort()).toEqual(['hs01', 'hs02']);
    const goodNotSeen = hab({ ...all(3), part: 4, others: 5 });
    expect(Object.keys(picks(goodNotSeen, 'habits')).sort()).toEqual(['hs03', 'hs04']);
    // Drafted with all six rated, a frame fails verify() once one is Not Seen.
    const ctx = ctxOf(hab(all(4)));
    let found = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const d = CommentBank.draft(ctx, { seed });
      const s = d.sentences.find(x => x.step === 'habits');
      if (!/^hs(17|18|20|21)$/.test(s.id)) continue;
      found++;
      expect(CommentBank.verify(d, hab(all(4)), {}).replaced).toEqual([]);
      const v = CommentBank.verify(d, notSeen, {});
      expect(
        v.replaced.map(r => r.sentenceId),
        s.id,
      ).toContain(s.id);
    }
    expect(found).toBeGreaterThan(0);
  });
});

describe('Strong Habits frames (the IE comment)', () => {
  const ie = habits =>
    facts({
      habits,
      grade: { ...facts().grade, basis: 'ie', ieAllowed: true, marked: { mine: 3, all: 8 } },
    });

  it('hs11, hs13-hs15 name the habits rated Consistently, at most three, as a verb phrase after the student', () => {
    const f = ie({ completes: 2, ready: 4, others: 4, part: 4, feedback: 2, devices: 3 });
    expect(CommentBank.reportPath(f)).toBe('ie');
    const got = expectReachable(f, 'strongHabits', ['hs11', 'hs13', 'hs14', 'hs15']);
    Object.values(got).forEach(t =>
      expect(t).toMatch(/\bhe comes to class ready, works well with others and takes part\.$/i),
    );
    expect(got.hs13).toBe('This term, he comes to class ready, works well with others and takes part.');
    expect(got.hs15).toBe('Among his strengths, he comes to class ready, works well with others and takes part.');
  });

  it('the phrase agrees with singular they, and is they/them with no pronouns on file', () => {
    const they = { ...ie({ ...all(2), ready: 4 }), pronouns: THEY };
    expect(ctxOf(they).strongHabits).toBe('come to class ready');
    // No pronouns on file: they/them (#596), through the realiser.
    const named = { ...ie({ ...all(2), ready: 4 }), pronouns: THEY, pronounsOnFile: false };
    expect(ctxOf(named).strongHabits).toBe('come to class ready');
    const d = CommentBank.draft(ctxOf(named), { seed: 2 });
    const s = d.sentences.find(x => x.step === 'strongHabits');
    expect(s.text).toMatch(/\bthey come to class ready\.$/i);
    expect(s.text).not.toMatch(/Gabriel|\bhe\b/);
  });

  it('all six Consistently is hs12, and the frames fail verify() once a strong habit drops', () => {
    const got = picks(ie(all(4)), 'strongHabits');
    expect(Object.keys(got)).toEqual(['hs12']);
    const f = ie({ ...all(2), ready: 4, others: 4 });
    expectVerifies(f, 'strongHabits', ie({ ...all(2), ready: 4, others: 3 }));
  });
});

describe('the frames and the lint', () => {
  it('every new frame is in its part and group, claims its fact and needs only slots the context builds', () => {
    const ctx = ctxOf(facts({ absent: 2, late: 1, habits: { ...all(4), part: 2 } }));
    const mine = COMMENT_BANK.sentences.filter(s =>
      /^(hs(1[3-9]|[23]\d)|h(6[1-9]|7\d)|m(0[2-9]|1\d|2[01]))$/.test(s.id),
    );
    expect(mine).toHaveLength(57);
    mine.forEach(s => {
      expect(s.part, s.id).toBe('habits');
      expect(['Work Habits', 'Strong Habits', 'Attendance', 'Not Handed In'], s.id).toContain(s.group);
      expect(s.claims, s.id).toEqual([
        {
          'Work Habits': 'habits',
          'Strong Habits': 'habits',
          Attendance: 'attendance',
          'Not Handed In': 'notHandedIn',
        }[s.group],
      ]);
      (s.needs || []).forEach(k => expect(Object.prototype.hasOwnProperty.call(ctx, k), s.id + ' ' + k).toBe(true));
      expect(CommentLint.findings(s.text), s.id).toEqual([]);
      expect(s.text, s.id).not.toMatch(/\b(still|again|only|finally|at least|unfortunately)\b/i);
    });
  });

  it('no two frames of a case open with the same three words, as rendered (slot-built h60, m01 and hs11 included)', () => {
    const ie = { ...facts().grade, basis: 'ie', ieAllowed: true, marked: { mine: 3, all: 8 } };
    const cases = [
      facts({ habits: all(4) }),
      facts({ habits: { ...all(3), part: 4 } }),
      facts({ habits: { ...all(4), feedback: 2 } }),
      facts({ habits: { ...all(4), ready: 2, devices: 1 } }),
      facts({ habits: { completes: 2, ready: 4, others: 4, part: 4, feedback: 2, devices: 3 }, grade: ie }),
      facts({ absent: 3, late: 0 }),
      facts({ absent: 0, late: 2 }),
      facts({ absent: 4, late: 1 }),
      facts({ notHandedIn: { count: 1, titles: ['Map Quiz'], groups: [] } }),
      facts({ notHandedIn: { count: 2, titles: ['Map Quiz', 'Poster'], groups: [] } }),
      facts({ notHandedIn: { count: 4, titles: ['Map Quiz', 'Poster', 'Lab: Heat', 'Essay'], groups: [] } }),
      facts({
        notHandedIn: { count: 15, titles: ['Current Events: Week 1'], groups: [{ name: 'Current Events', count: 6 }] },
      }),
    ];
    // hs01/hs02 and hs03/hs04 (plan PR 7) share a start; no other pair does.
    const allowed = ['hs01|hs02', 'hs03|hs04'];
    cases.forEach(f => {
      const ctx = ctxOf(f);
      const seen = {};
      COMMENT_BANK.sentences
        .filter(s => s.part === 'habits' && CommentBank.fits(s, ctx))
        .forEach(s => {
          const start = CommentBank.fill(s, ctx).toLowerCase().split(/\s+/).slice(0, 3).join(' ');
          const key = s.group + '|' + start;
          const other = seen[key];
          if (other && allowed.indexOf(other + '|' + s.id) < 0)
            expect.fail(s.id + ' opens like ' + other + ': ' + CommentBank.fill(s, ctx));
          seen[key] = s.id;
        });
    });
  });
});
