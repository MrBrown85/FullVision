/**
 * The habits part for families (Colin, Nov 4 2026): families never see the
 * questionnaire's six ratings, so Generate says what the student does, in
 * the words of each habit's hint, in two or three sentences:
 *
 * - what the student does at Consistently, then at Usually ("usually",
 *   "most days"); one level alone with four or more habits in two
 *   sentences (getting the work done, then the rest);
 * - nothing above Sometimes: "Some days …", at most two;
 * - a habit rated Sometimes or Rarely: the one or two that would help most
 *   (the two lowest), in the grid's order, and one strengths sentence;
 * - never "work habits", "six", "all of his habits", "excellent", "good",
 *   a rating word or "rated"; never a blank habit (Not Seen is unrated).
 *
 * verify() proves every habit each sentence names against the ratings, and
 * a comment saved with an old Work Habits sentence keeps it as written.
 */
import './setup.js';
import { describe, expect, it } from 'vitest';

const RQ = ReportQuestionnaire;
const HE = { subj: 'he', obj: 'him', poss: 'his', refl: 'himself' };
const SHE = { subj: 'she', obj: 'her', poss: 'her', refl: 'herself' };
const THEY = { subj: 'they', obj: 'them', poss: 'their', refl: 'themselves' };
const KEYS = ['completes', 'ready', 'others', 'part', 'feedback', 'devices'];
const HABIT_STEP = /^(habits|habitsMore|habitsBuild|strongHabits)$/;
// Rule 1: no label, count, verdict or rating word. "usually" and "some
// days" describing what the student does are fine.
const BANNED =
  /\bwork habits?\b|\bsix\b|\b(all|every|each)( one)? of (his|her|their|[A-Z]\w+’s) habits\b|\ball (his|her|their) habits\b|\bexcellent\b|\bgood\b|\bconsistently\b|\bsometimes\b|\brarely\b|\brated\b|\bUsually\b/i;
const BANNED_WORDS = t => BANNED.test(t.replace(/\busually\b/g, ''));

function piece(day, pct) {
  const d = new Date(2026, 8, 1 + day);
  const iso =
    d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  return { id: 'p' + day, d: iso, pct };
}
function facts(over) {
  return Object.assign(
    {
      cid: 'cls-family',
      sid: 'stu',
      name: 'Liam',
      first: 'Liam',
      course: 'Science 8',
      family: 'science',
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
/* "423432" (the grid's order) as ratings; a space is a blank habit. */
const rated = profile => {
  const out = {};
  KEYS.forEach((k, i) => {
    if (profile[i] && profile[i] !== ' ') out[k] = Number(profile[i]);
  });
  return out;
};
const habitsPart = d => d.sentences.filter(x => HABIT_STEP.test(x.step));
const draftOf = (f, seed) => CommentBank.draft(CommentBank.context(f, {}), { seed: seed || 3 });

const PROFILES = [
  '444444',
  '333333',
  '434334',
  '423432',
  '223123',
  '443424',
  '122212',
  '344344',
  '111111',
  '222222',
  '121212',
  '4 4 4 ',
  '  3   ',
  '1     ',
  '5 5 4 ',
  '453453',
  '412341',
];
const PEOPLE = [
  { name: 'Liam', pronouns: HE, pronounsOnFile: true },
  { name: 'Cece', pronouns: SHE, pronounsOnFile: true },
  { name: 'Sam', pronouns: THEY, pronounsOnFile: false },
];
const FAMILIES = ['science', 'pe', 'arts'];

describe('Generate’s habits part, for many ratings, kinds of class and pronouns', { timeout: 60000 }, () => {
  const cases = [];
  PROFILES.forEach(profile =>
    FAMILIES.forEach(family =>
      PEOPLE.forEach(who =>
        cases.push({ profile, family, f: facts({ ...who, first: who.name, family, habits: rated(profile) }) }),
      ),
    ),
  );

  it('says none of the banned words, in 2–3 sentences (1 when only habits that would help fit)', () => {
    cases.forEach(({ profile, family, f }) => {
      for (let seed = 1; seed <= 10; seed++) {
        const hs = habitsPart(draftOf(f, seed));
        hs.forEach(x => expect(BANNED_WORDS(x.text), profile + ' ' + family + ': ' + x.text).toBe(false));
        expect(hs.length, profile).toBeLessThanOrEqual(3);
        hs.forEach(x => expect(CommentRealiser.wordCount(x.text), x.text).toBeLessThanOrEqual(26));
      }
    });
  });

  it('names each habit at the rating its sentence says, and only habits that are rated', () => {
    cases.forEach(({ profile, family, f }) => {
      const habits = rated(profile);
      const d = draftOf(f, 4);
      habitsPart(d).forEach(x => {
        const pv = d.provenance[d.sentences.indexOf(x)];
        const named = [];
        Object.keys(pv.values).forEach(slot => {
          const def = CommentBank.HABIT_SLOTS[slot];
          const at = def ? def.at : slot === 'strongHabits' || slot === 'habitStrengths' ? [4] : null;
          if (!at) return;
          (pv.sources[slot] || [])
            .filter(k => /^habit:/.test(k))
            .forEach(k => {
              const key = k.slice(6);
              named.push(key);
              expect(at, profile + ' ' + slot + ' ' + key).toContain(habits[key]);
            });
        });
        // The words in the sentence are the named habits' own: every
        // habit phrase the text holds is one of them.
        KEYS.forEach(k => {
          ['well', 'usual', 'some', 'help'].forEach(form => {
            const phrase = CommentBank.habitSay(k, form, family)
              .replace(/\[([^|\]]*)\|[^\]]*\]/g, '$1')
              .replace(/\{his\}/g, f.pronouns.poss);
            const bare = phrase.split(' ').slice(1).join(' ');
            if (bare.split(' ').length >= 3 && x.text.indexOf(bare) >= 0)
              expect(named, profile + ' ' + family + ' ' + k + ': ' + x.text).toContain(k);
          });
        });
      });
    });
  });

  it('verify() passes every draft on 10 seeds', () => {
    cases.forEach(({ profile, f }) => {
      for (let seed = 1; seed <= 10; seed++) {
        const d = draftOf(f, seed);
        expect(CommentBank.verify(d, f, {}).replaced, profile + ' seed ' + seed).toEqual([]);
      }
    });
  });

  it('nothing rated, or only blanks and old Not Seen: no habits part', () => {
    ['      ', '555555'].forEach(p =>
      FAMILIES.forEach(family => expect(habitsPart(draftOf(facts({ family, habits: rated(p) })))).toEqual([])),
    );
  });

  it('a blank or Not Seen habit is never named', () => {
    const f = facts({ habits: rated('4 4 4 ') });
    for (let seed = 1; seed <= 10; seed++) {
      const t = habitsPart(draftOf(f, seed))
        .map(x => x.text)
        .join(' ');
      expect(t).toMatch(/hands in his work on time/);
      expect(t).not.toMatch(/class ready|discussions|phone/);
    }
    const ns = facts({ habits: rated('5 5 4 ') });
    const t = habitsPart(draftOf(ns))
      .map(x => x.text)
      .join(' ');
    expect(t).toMatch(/uses feedback to improve his work/);
    expect(t).not.toMatch(/hands in|class ready|others|discussions|phone/);
  });
});

describe('the approved shapes (Colin, Nov 4)', () => {
  const part = (profile, who, seed) =>
    habitsPart(draftOf(facts({ ...who, first: who.name, habits: rated(profile) }), seed)).map(x => x.text);
  const cece = { name: 'Cece', pronouns: SHE, pronounsOnFile: true };
  const he = name => ({ name, pronouns: HE, pronounsOnFile: true });

  it('Cece 444444: two sentences, getting the work done, then the rest', () => {
    const [a, b, c] = part('444444', cece);
    expect(a).toMatch(/hands in her work on time and comes to class ready to start\.$/);
    expect(b).toMatch(/listens to others, joins in class discussions, and uses feedback to improve her work\.$/);
    expect(c).toBeUndefined();
  });

  it('Sam 333333 (no pronouns on file): they, with plural verbs, usually or most days', () => {
    const [a, b] = part('333333', { name: 'Sam', pronouns: null, pronounsOnFile: false });
    expect(a).toMatch(/hand in their work on time and come to class ready to start/);
    expect(a).toMatch(/usually|most days|often/i);
    expect(b).toMatch(/work well with others in a group and join in class discussions/);
  });

  it('Fatima 344344: Consistently first, then usually', () => {
    const [a, b] = part('344344', { name: 'Fatima', pronouns: SHE, pronounsOnFile: true });
    expect(a).toMatch(/comes to class ready to start, listens to others, and uses feedback to improve her work\.$/);
    expect(b).toMatch(/hands in her work on time and joins in class discussions/);
  });

  it('Liam 423432: what he does at Consistently, then the two habits that would help', () => {
    const [a, b, c] = part('423432', he('Liam'));
    expect(a).toMatch(/hands in his work on time and joins in class discussions\.$/);
    expect(b).toMatch(/getting started as soon as class begins, and keeping his phone and devices on his work\.$/);
    expect(c).toBeUndefined();
  });

  it('Mateo 223123: what he does at Usually, then the two lowest in the grid’s order', () => {
    const [a, b] = part('223123', he('Mateo'));
    expect(a).toMatch(/works well with others in a group/);
    expect(b).toMatch(/handing in each task by its due date, and sharing his ideas in class discussions\.$/);
  });

  it('Jasper 122212: some days, then the two that would help', () => {
    const [a, b] = part('122212', he('Jasper'));
    expect(a).toMatch(
      /^(Some days|On some days,|At times,) he comes to class ready and joins in group work\.$|comes to class ready and joins in group work on some days\.$/,
    );
    expect(b).toMatch(/handing in each task by its due date, and using feedback to improve his work\.$/);
  });

  it('one habit that would help says so in its own words', () => {
    const [, b] = part('443424', he('Ethan'));
    expect(b).toMatch(/using feedback to improve his work/);
    expect(b).not.toMatch(/two habits/i);
  });

  it('Another Version varies the frame, never the parts or their order', () => {
    const seen = new Set();
    for (let seed = 1; seed <= 12; seed++) {
      const hs = habitsPart(draftOf(facts({ habits: rated('423432') }), seed));
      expect(hs.map(x => x.step)).toEqual(['habits', 'habitsBuild']);
      seen.add(hs[0].id);
      expect(hs[1].text).toMatch(/getting started as soon as class begins, and keeping his phone/);
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe('Browse Sentences and Other Wording for the habits part', () => {
  it('offer none of the banned words for these students', () => {
    PROFILES.forEach(profile =>
      FAMILIES.forEach(family => {
        const ctx = CommentBank.context(facts({ family, habits: rated(profile) }), {});
        const rows = RQ.browseList('habits', ctx, { fits: true }).rows;
        rows.forEach(r => expect(BANNED_WORDS(r.text), profile + ' ' + r.id + ': ' + r.text).toBe(false));
        CommentBank.parts(ctx, '', { more: { habits: true } })[0].rows.forEach(r =>
          expect(BANNED_WORDS(r.text), r.id + ': ' + r.text).toBe(false),
        );
      }),
    );
  });

  it('the old Work Habits frames are gone from the bank and Browse', () => {
    ['hs01', 'hs02', 'hs04', 'hs12', 'hs14', 'hs27', 'hs32', 'hs36'].forEach(id =>
      expect(
        COMMENT_BANK.sentences.find(s => s.id === id),
        id,
      ).toBeUndefined(),
    );
  });
});

describe('a comment saved with an old Work Habits sentence', () => {
  it('keeps it as written through verify()', () => {
    const f = facts({ habits: rated('444444') });
    const d = draftOf(f);
    const at = d.sentences.findIndex(x => x.step === 'habits');
    const old = {
      sentences: d.sentences.map((x, i) =>
        i === at ? { id: 'hs02', part: 'habits', step: 'habits', text: 'His work habits are excellent this term.' } : x,
      ),
      provenance: d.provenance.map((p, i) =>
        i === at
          ? {
              sentenceId: 'hs02',
              part: 'habits',
              claims: ['habits'],
              factKeys: [],
              values: { habitsExcellent: 'yes' },
              sources: {},
            }
          : p,
      ),
    };
    const v = CommentBank.verify(old, f, {});
    expect(v.replaced).toEqual([]);
    expect(v.sentences[at].text).toBe('His work habits are excellent this term.');
  });
});
