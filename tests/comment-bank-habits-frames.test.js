/**
 * The habits-part frames grown 2026-11-01 (Colin: "too little variation"),
 * and since Nov 4 2026 the pipeline's habits-as-behaviour and attendance
 * frames that replaced the ones that counted, rated or said "this term":
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
function picks(f, step, n, exclude) {
  const out = {};
  const comments = [];
  for (let seed = 1; seed <= (n || 40); seed++) {
    // A classmate of their own: a sentence with no pattern (m01, hs11)
    // counts as used through the draft record, by student id.
    const ctx = ctxOf({ ...f, sid: 's' + seed });
    const d = CommentBank.draft(ctx, { seed, comments: comments.slice(), exclude: exclude || [] });
    comments.push({ sid: 's' + seed, text: d.text });
    const s = d.sentences.find(x => x.step === step);
    if (s) out[s.id] = s.text;
  }
  return out;
}
/* opts.any: the frames the case may draw from (the pipeline's), when not
   every one is listed in want. A retired frame (COMMENT_BANK.retired, Nov 4
   2026) is never drafted, so it is left out of want. */
function expectReachable(f, step, want, opts) {
  opts = Array.isArray(opts) ? { exclude: opts } : opts || {};
  const got = picks(f, step, 0, opts.exclude);
  const live = want.filter(id => byId(id));
  live.forEach(id => expect(Object.keys(got), id + ' never picked').toContain(id));
  Object.keys(got).forEach(id => {
    expect(live.concat(opts.any || []), id + ' picked outside its case').toContain(id);
    expect(got[id], id).not.toMatch(/[{}[\]]/);
    expect(CommentRealiser.wordCount(got[id]), id + ': ' + got[id]).toBeLessThanOrEqual(24);
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
    expect(got.m20).toMatch(/the 15 assignments/);
    Object.values(got).forEach(t => expect(t).not.toMatch(/this term/));
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

// Each case drafts the comment many times: slow on CI's machines.
// Since Nov 4 2026 Generate draws the attendance sentence from the
// pipeline's frames (vat01-vat05); the older ones that do not say "this
// term" (h63, h69, h74, h75) stay in Browse and Other Wording.
describe('Attendance frames', { timeout: 20000 }, () => {
  const att = (absent, late) => facts({ absent, late });

  it('absences only: vat01-vat02, the classes missed, singular for one', () => {
    const got = expectReachable(att(3, 0), 'attendance', ['vat01', 'vat02']);
    Object.values(got).forEach(t => {
      expect(t).toMatch(/three classes/);
      expect(t).not.toMatch(/late|this term/);
    });
    const oneClass = picks(att(1, null), 'attendance');
    Object.values(oneClass).forEach(t => expect(t).toMatch(/one class\b/));
  });

  it('lates only: vat03-vat04, once, twice, then times', () => {
    const got = expectReachable(att(0, 2), 'attendance', ['vat03', 'vat04']);
    Object.values(got).forEach(t => {
      expect(t).toMatch(/\btwice\b/);
      expect(t).not.toMatch(/missed|away|absent|this term/);
    });
    Object.values(picks(att(null, 1), 'attendance')).forEach(t => expect(t).toMatch(/\bonce\b/));
    Object.values(picks(att(null, 12), 'attendance')).forEach(t => expect(t).toMatch(/\b12 times\b/));
  });

  it('both counts: vat05, both halves said and the exact counts', () => {
    const got = expectReachable(att(4, 1), 'attendance', ['vat05']);
    expect(got.vat05).toBe('He has missed four classes and been late once.');
  });

  it('a frame fails verify() once the counts change, and an absences-only one once a late is entered', () => {
    expectVerifies(att(3, 0), 'attendance', att(4, 0));
    expectVerifies(att(3, 0), 'attendance', att(3, 1));
    expectVerifies(att(0, 2), 'attendance', att(1, 2));
    expectVerifies(att(4, 1), 'attendance', att(4, 2));
  });

  it('singular they takes plural verbs in every frame', () => {
    [att(2, 0), att(0, 2), att(2, 2)].forEach(base => {
      const got = picks({ ...base, pronouns: THEY }, 'attendance');
      expect(Object.keys(got).length).toBeGreaterThan(0);
      Object.values(got).forEach(t => expect(t).not.toMatch(/\b(has|was)\b/));
    });
  });
});

// The habits as behaviour (the Generate pipeline, Nov 4 2026; plan v2,
// Colin's added rule): a habit at Consistently is said as what the student
// does, a habit at Sometimes or Rarely as one to build, never a count, a
// rating word or the questionnaire's list. Said only when notable.
describe('Work Habits frames', { timeout: 20000 }, () => {
  const hab = habits => facts({ habits });
  const v2 = re =>
    COMMENT_BANK.sentences.filter(s => s.v === 2 && s.group === 'Work Habits' && re.test(s.id)).map(s => s.id);
  const LIST_WORDS = /\b(all six|every one|each skill|rated|Consistently|Usually|Sometimes|Rarely|work habits are)\b/;

  it('all at Consistently: what the student does, one or two habits, never a habit name or a rating', () => {
    const got = expectReachable(hab(all(4)), 'habits', [], { any: v2(/^vh[dp]\d\d$/) });
    expect(Object.keys(got).length).toBeGreaterThanOrEqual(8);
    Object.values(got).forEach(t => {
      expect(t).not.toMatch(LIST_WORDS);
      expect(t).not.toMatch(
        /to build|Completes Work|Comes Ready|Works With Others|Takes Part|Uses Feedback|Uses Devices/,
      );
    });
  });

  it('nothing notable (all Usually): no habits sentence, nothing padded', () => {
    expect(picks(hab(all(3)), 'habits')).toEqual({});
  });

  it('one habit to build: the invitation for that habit, named only through its slot', () => {
    const got = expectReachable(hab({ ...all(4), feedback: 2 }), 'habits', [], { any: v2(/^vh[ic]\d\d$/) });
    expect(Object.keys(got).length).toBeGreaterThanOrEqual(6);
    Object.entries(got).forEach(([id, t]) => {
      expect(t, id).not.toMatch(LIST_WORDS);
      expect(t, id).toMatch(/feedback|change/i);
    });
  });

  it('two habits to build: both invitations, the lower first', () => {
    const got = expectReachable(hab({ ...all(4), ready: 2, devices: 1 }), 'habits', [], { any: v2(/^vh[2ic]\d\d$/) });
    expect(Object.keys(got).filter(id => /^vh2/.test(id)).length).toBeGreaterThanOrEqual(4);
    const P = COMMENT_BANK.pipeline.habits;
    Object.values(got).forEach(t => {
      const dev = P.devices.invite.map(x => x.replace('{his}', 'his').replace('{him}', 'him'));
      const rdy = P.ready.invite.map(x =>
        x.replace('{his}', 'his').replace('{he}', 'he').replace('[needs|need]', 'needs'),
      );
      const lower = t.toLowerCase();
      const at = w => Math.min(...w.map(x => (lower.indexOf(x) < 0 ? Infinity : lower.indexOf(x))));
      // The lower (Uses Devices, Rarely) always; with both, it comes first.
      expect(at(dev), t).toBeLessThan(Infinity);
      if (at(rdy) < Infinity) expect(at(dev), t).toBeLessThan(at(rdy));
    });
  });

  it('every frame reads in PE and Arts, within 24 words with the longest phrases', () => {
    ['pe', 'arts'].forEach(family => {
      const two = picks(facts({ family, habits: { ...all(4), completes: 1, others: 2 } }), 'habits');
      expect(Object.keys(two).length).toBeGreaterThan(0);
      Object.values(two).forEach(t => {
        expect(t).not.toMatch(/\bhand(s|ing)? in\b/i);
        expect(CommentRealiser.wordCount(t), family + ': ' + t).toBeLessThanOrEqual(24);
      });
    });
  });

  it('a frame fails verify() once a rating changes', () => {
    expectVerifies(hab({ ...all(3), part: 4 }), 'habits', hab({ ...all(3), part: 3 }));
    expectVerifies(hab({ ...all(4), feedback: 2 }), 'habits', hab({ ...all(4), feedback: 3 }));
  });

  it('they/them: every predicate agrees ("they come", never "they comes")', () => {
    const got = picks(facts({ habits: { ...all(4), feedback: 2 }, pronouns: THEY }), 'habits');
    Object.values(got).forEach(t =>
      expect(t).not.toMatch(
        /\bthey (comes|completes|finishes|works|shares|joins|asks|uses|makes|keeps|starts|is|has)\b/i,
      ),
    );
    const got2 = picks(facts({ habits: all(4), pronouns: THEY }), 'habits');
    Object.values(got2).forEach(t =>
      expect(t).not.toMatch(
        /\bthey (comes|completes|finishes|works|shares|joins|asks|uses|makes|keeps|starts|is|has)\b/i,
      ),
    );
  });
});

describe('Strong Habits frames (the IE comment)', () => {
  const ie = habits =>
    facts({
      habits,
      grade: { ...facts().grade, basis: 'ie', ieAllowed: true, marked: { mine: 3, all: 8 } },
    });

  it('say what the student does at Consistently, as behaviour after the student', () => {
    const f = ie({ completes: 2, ready: 4, others: 4, part: 4, feedback: 2, devices: 3 });
    expect(CommentBank.reportPath(f)).toBe('ie');
    const any = COMMENT_BANK.sentences.filter(s => s.v === 2 && s.group === 'Strong Habits').map(s => s.id);
    const got = expectReachable(f, 'strongHabits', [], { any });
    expect(Object.keys(got).length).toBeGreaterThanOrEqual(4);
    const P = COMMENT_BANK.pipeline.habits;
    const does = ['ready', 'others', 'part'].reduce((a, k) => a.concat(P[k].does), []);
    Object.values(got).forEach(t =>
      expect(
        does.some(d => t.indexOf(d) >= 0),
        t,
      ).toBe(true),
    );
  });

  it('the phrase agrees with singular they, and is they/them with no pronouns on file', () => {
    const named = { ...ie({ ...all(2), ready: 4 }), pronouns: THEY, pronounsOnFile: false };
    expect(ctxOf(named).habitDoes).toMatch(/^(come to class ready to work|start the task as soon as class begins)$/);
    const d = CommentBank.draft(ctxOf(named), { seed: 2 });
    const s = d.sentences.find(x => x.step === 'strongHabits');
    expect(s.text).toMatch(
      /\bthey (?:consistently |reliably )?(come to class ready to work|start the task as soon as class begins)\.$/i,
    );
    expect(s.text).not.toMatch(/Gabriel|\bhe\b/);
  });

  it('the frames fail verify() once a strong habit drops', () => {
    const f = ie({ ...all(2), ready: 4, others: 4 });
    expectVerifies(f, 'strongHabits', ie({ ...all(2), ready: 3, others: 3 }));
  });
});

describe('the frames and the lint', () => {
  it('every pipeline frame of the habits part is in its group, claims its fact and needs only slots the context builds', () => {
    const ctx = ctxOf(facts({ absent: 2, late: 1, habits: { ...all(4), part: 2 } }));
    const mine = COMMENT_BANK.sentences.filter(s => s.v === 2 && s.part === 'habits');
    expect(mine.length).toBeGreaterThanOrEqual(40);
    mine.forEach(s => {
      expect(['Work Habits', 'Strong Habits', 'Attendance'], s.id).toContain(s.group);
      expect(s.claims, s.id).toEqual([
        { 'Work Habits': 'habitBehaviour', 'Strong Habits': 'habitBehaviour', Attendance: 'attendance' }[s.group],
      ]);
      (s.needs || []).forEach(k => expect(Object.prototype.hasOwnProperty.call(ctx, k), s.id + ' ' + k).toBe(true));
      expect(CommentLint.findings(s.text), s.id).toEqual([]);
      expect(s.text, s.id).not.toMatch(/\b(still|again|only|finally|at least|unfortunately)\b/i);
    });
  });

  it('no two frames of a case open with the same three words, as rendered', () => {
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
    // A case is a group and the slots a frame needs: a frame for one habit
    // and one for two habits are different cases, though both open "He …".
    cases.forEach(f => {
      const ctx = ctxOf(f);
      const seen = {};
      COMMENT_BANK.sentences
        .filter(s => s.part === 'habits' && !s.habit && CommentBank.fits(s, ctx))
        .forEach(s => {
          const start = CommentBank.fill(s, ctx).toLowerCase().split(/\s+/).slice(0, 3).join(' ');
          const key = s.group + '|' + (s.v || 1) + '|' + (s.needs || []).slice().sort().join(',') + '|' + start;
          const other = seen[key];
          if (other) expect.fail(s.id + ' opens like ' + other + ': ' + CommentBank.fill(s, ctx));
          seen[key] = s.id;
        });
    });
  });
});
