/**
 * Generate plan PR 7 (habits half): the habits part of the comment is one
 * summary sentence.
 *
 * - All six rated and every one seen Consistently: "work habits are
 *   excellent."
 * - Otherwise only the one or two rated Sometimes or Rarely are named (more
 *   than two: the two lowest, ties in the grid's order). Never a list of six.
 * - Not Seen and unrated habits are left out; nothing rated, no sentence.
 * - A rating changed on the Work Habits grid redraws only the habits
 *   sentence, unless the teacher edited it.
 * - Arts drafts never say "handing in complete work".
 */
import './setup.js';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const HE = { subj: 'he', obj: 'him', poss: 'his', refl: 'himself' };
const THEY = { subj: 'they', obj: 'them', poss: 'their', refl: 'themselves' };
const KEYS = ['completes', 'ready', 'others', 'part', 'feedback', 'devices'];
const words = t => t.trim().split(/\s+/).length;
const all = v => Object.fromEntries(KEYS.map(k => [k, v]));

function piece(day, pct) {
  const d = new Date(2026, 8, 1 + day);
  const iso =
    d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  return { id: 'p' + day, d: iso, pct };
}
/* A B student with eight even pieces, nothing missing and no record of
   handed-in work (so Completes Work is only what the teacher rates). */
function facts(over) {
  return Object.assign(
    {
      cid: 'cls-habits',
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
const habitsSentence = (f, picks, seed) => {
  const d = CommentBank.draft(CommentBank.context(f, picks || {}), { seed: seed || 1 });
  return d.sentences.filter(x => x.step === 'habits' || x.step === 'strongHabits');
};

describe('habitSummary', () => {
  const S = CommentBank.habitSummary;

  it('all six Consistently is excellent, with nothing to build', () => {
    expect(S(all(4))).toMatchObject({ excellent: true, good: false, build: [], strong: KEYS });
  });

  it('names one habit rated Sometimes or Rarely', () => {
    expect(S({ ...all(4), feedback: 2 })).toMatchObject({ excellent: false, good: false, build: ['feedback'] });
  });

  it('names two, the lower first', () => {
    expect(S({ ...all(3), ready: 2, devices: 1 }).build).toEqual(['devices', 'ready']);
  });

  it('with three or more, picks the two lowest, ties in the grid’s order', () => {
    expect(S({ ...all(4), completes: 2, part: 1, devices: 2 }).build).toEqual(['part', 'completes']);
    expect(S({ ...all(4), others: 2, feedback: 2, devices: 2, ready: 2 }).build).toEqual(['ready', 'others']);
  });

  it('leaves Not Seen out: the rest all Consistently is still excellent', () => {
    expect(S({ ...all(4), devices: 5 })).toMatchObject({ excellent: true, build: [] });
    expect(S({ ...all(5), part: 2 }).build).toEqual(['part']);
  });

  it('all rated, none below Usually, is good; not all six rated is neither', () => {
    expect(S({ ...all(4), ready: 3 })).toMatchObject({ excellent: false, good: true, build: [] });
    expect(S({ completes: 4, ready: 4 })).toMatchObject({ excellent: false, good: false, build: [] });
  });

  it('nothing rated gives nothing', () => {
    expect(S({})).toEqual({ excellent: false, good: false, build: [], strong: [], seen: [] });
    expect(S(all(5))).toMatchObject({ excellent: false, good: false, build: [], seen: [] });
  });
});

describe('the habits sentence in a draft', () => {
  it('all six Consistently: “His work habits are excellent.”', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const hs = habitsSentence(facts({ habits: all(4) }), {}, seed);
      expect(hs).toHaveLength(1);
      expect(hs[0].text).toMatch(/^His work habits are excellent( this term)?\.$/);
    }
    // No pronouns on file: the name again.
    const named = habitsSentence(facts({ habits: all(4), pronounsOnFile: false, pronouns: THEY }));
    expect(named[0].text).toMatch(/^Gabriel’s work habits are excellent/);
  });

  it('one weak habit: names only that one', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const [s] = habitsSentence(facts({ habits: { ...all(4), feedback: 2 } }), {}, seed);
      expect(s.text).toMatch(/using feedback\.$/);
      expect(s.text).not.toMatch(/ and /);
      expect(s.text).not.toMatch(/class time|others|taking part|devices|completing/);
    }
  });

  it('two weak habits: names both in one sentence', () => {
    const [s] = habitsSentence(facts({ habits: { ...all(3), ready: 2, devices: 1 } }));
    expect(s.text).toMatch(/using devices well and using class time well\.$/);
  });

  it('three weak habits: names the two lowest', () => {
    const [s] = habitsSentence(facts({ habits: { ...all(4), completes: 2, part: 1, devices: 2 } }));
    expect(s.text).toMatch(/taking part in class and completing work on time\.$/);
    expect(s.text).not.toMatch(/devices/);
  });

  it('Not Seen is ignored', () => {
    const [s] = habitsSentence(facts({ habits: { ...all(4), devices: 5 } }));
    expect(s.text).toMatch(/work habits are excellent/);
    const [t] = habitsSentence(facts({ habits: { ...all(5), others: 1 } }));
    expect(t.text).toMatch(/working well with others\.$/);
  });

  it('nothing rated: no habits sentence', () => {
    expect(habitsSentence(facts())).toEqual([]);
    expect(habitsSentence(facts({ habits: all(5) }))).toEqual([]);
  });

  it('is one sentence, and verifies against the ratings it was drafted from', () => {
    const f = facts({ habits: { ...all(4), part: 2 } });
    const d = CommentBank.draft(CommentBank.context(f, {}), { seed: 3 });
    expect(d.ids.filter(id => /^hs/.test(id))).toHaveLength(1);
    expect(CommentBank.verify(d, f, {}).replaced).toEqual([]);
    // The rating changed after the draft: the sentence no longer holds.
    const changed = { ...f, habits: { ...all(4), part: 3 } };
    const v = CommentBank.verify(d, changed, {});
    expect(v.replaced.map(r => r.sentenceId)).toEqual(d.ids.filter(id => /^hs/.test(id)));
    expect(v.replaced[0].failed).toContain('habits');
  });

  it('keeps every habits sentence at 20 words or fewer, in every kind of class', () => {
    const fams = ['', 'pe', 'arts', 'math', 'adst', 'ela', 'socials', 'science', 'career'];
    const sentences = COMMENT_BANK.sentences.filter(s => s.part === 'habits' && /^hs/.test(s.id));
    fams.forEach(family => {
      KEYS.forEach(a =>
        KEYS.forEach(b => {
          if (a === b) return;
          const ctx = CommentBank.context(facts({ family, habits: { ...all(4), [a]: 1, [b]: 2 } }), {});
          const one = CommentBank.context(facts({ family, habits: { ...all(4), [a]: 1 } }), {});
          const strong = CommentBank.context(facts({ family, habits: { ...all(1), [a]: 4, [b]: 4 } }), {});
          [ctx, one, strong].forEach(c =>
            sentences
              .filter(s => CommentBank.fits(s, c))
              .forEach(s => {
                const t = CommentBank.fill(s, c);
                expect(words(t), family + ' ' + s.id + ': ' + t).toBeLessThanOrEqual(20);
                expect(t).not.toMatch(/[{}[\]]/);
              }),
          );
        }),
      );
    });
  });

  it('on the IE path, names the habits rated Consistently, as the IE mockup', () => {
    const f = facts({
      habits: { completes: 2, ready: 4, others: 4, part: 4, feedback: 2, devices: 3 },
      grade: { ...facts().grade, basis: 'ie', ieAllowed: true, marked: { mine: 3, all: 8 } },
    });
    expect(CommentBank.reportPath(f)).toBe('ie');
    const hs = habitsSentence(f);
    expect(hs.map(x => x.step)).toEqual(['strongHabits']);
    expect(hs[0].text).toBe('He comes to class ready, works well with others and takes part.');
  });
});

describe('Arts never says “handing in complete work”', () => {
  it('has no handed-in wording in any form of any habit', () => {
    ['build', 'does', 'do'].forEach(form =>
      KEYS.forEach(k => expect(CommentBank.habitWords(k, form, 'arts', HE), k + ' ' + form).not.toMatch(/hand/i)),
    );
  });

  it('never drafts it, at any Completes Work rating, on the grade or the IE path', () => {
    const ie = { ...facts().grade, basis: 'ie', ieAllowed: true, marked: { mine: 3, all: 8 } };
    [1, 2, 3, 4, 5].forEach(c =>
      [1, 2, 3, 4].forEach(rest => {
        const habits = { ...all(rest), completes: c };
        [facts({ family: 'arts', habits }), facts({ family: 'arts', habits, grade: ie })].forEach(f => {
          for (let seed = 1; seed <= 3; seed++) {
            const d = CommentBank.draft(CommentBank.context(f, {}), { seed });
            expect(d.text, c + '/' + rest).not.toMatch(/hand(s|ing|ed)? in complete/i);
          }
        });
      }),
    );
  });
});

describe('redrawHabits: a rating changed after Generate', () => {
  const draftFor = habits => {
    const f = facts({ habits });
    return CommentBank.draft(CommentBank.context(f, {}), { seed: 5 });
  };
  const redraw = (prev, habits) => CommentBank.redrawHabits(CommentBank.context(facts({ habits }), {}), prev);
  const others = d => d.sentences.filter(x => x.step !== 'habits').map(x => x.text);

  it('writes only the habits sentence again', () => {
    const prev = draftFor({ ...all(4), feedback: 2 });
    const d = redraw(prev, { ...all(4), devices: 1 });
    expect(d.habits.before).toMatch(/using feedback/);
    expect(d.habits.after).toMatch(/using devices well/);
    expect(others(d)).toEqual(others(prev));
    expect(d.sentences.map(x => x.step)).toEqual(prev.sentences.map(x => x.step));
    expect(d.text).toBe(prev.text.replace(d.habits.before, d.habits.after));
  });

  it('adds the sentence where the story puts it once habits are rated, and drops it when none fits', () => {
    const prev = draftFor({});
    expect(prev.sentences.some(x => x.step === 'habits')).toBe(false);
    const d = redraw(prev, all(4));
    expect(d.habits).toMatchObject({ before: '' });
    expect(d.habits.after).toMatch(/excellent/);
    expect(others(d)).toEqual(others(prev));
    const back = redraw(d, {});
    expect(back.habits).toMatchObject({ before: d.habits.after, after: '' });
    expect(back.text).toBe(prev.text);
  });
});

describe('the Work Habits grid (teacher/report-questionnaire.js)', () => {
  const RQ = ReportQuestionnaire;
  const CID = 'course-habits';
  const TERM = 'term-1';
  const GABRIEL = { id: 'stu-gabriel', firstName: 'Gabriel', lastName: 'Ortiz', pronouns: 'he/him' };
  let hadDoc, oldDoc, box;

  function seed() {
    COURSES[CID] = { id: CID, name: 'History 12', gradingSystem: 'letter', gradeLevel: '12' };
    _cache.students[CID] = [Object.assign({}, GABRIEL, { designations: [] })];
    _cache.learningMaps[CID] = {
      sections: [{ id: 'sec-1', name: 'Evidence', shortName: 'Evidence', tags: [{ id: 't1', label: 'Evidence' }] }],
    };
    _cache.categories[CID] = [];
    _cache.assessments[CID] = Array.from({ length: 6 }, (_, i) => ({
      id: 'a' + i,
      title: 'Task ' + (i + 1),
      scoreMode: 'proficiency',
      tagIds: ['t1'],
      type: 'summative',
      date: '2026-10-' + String(i + 1).padStart(2, '0'),
    }));
    _cache.scores[CID] = {
      [GABRIEL.id]: Array.from({ length: 6 }, (_, i) => ({
        assessmentId: 'a' + i,
        tagId: 't1',
        score: 3,
        date: '2026-10-' + String(i + 1).padStart(2, '0'),
      })),
    };
    _cache.statuses[CID] = {};
    _cache.overrides[CID] = {};
    _cache.courseConfigs[CID] = {};
    _cache.observations[CID] = {};
    _cache.reflections[CID] = {};
    _cache.termRatings[CID] = {};
    clearProfCache();
  }

  beforeAll(() => {
    hadDoc = 'document' in globalThis;
    oldDoc = globalThis.document;
  });
  afterAll(() => {
    if (hadDoc) globalThis.document = oldDoc;
    else delete globalThis.document;
  });
  beforeEach(() => {
    localStorage.clear();
    seed();
    box = {
      value: '',
      dataset: { cid: CID, sid: GABRIEL.id, term: TERM },
      style: {},
      scrollHeight: 0,
      focus() {},
      select() {},
    };
    globalThis.document = {
      getElementById: id => (id === 'tq-narrative' ? box : null),
      querySelector: () => null,
      querySelectorAll: () => [],
      body: { classList: { add() {}, remove() {} } },
    };
    RQ.configure({ activeCourse: CID, renderReports: () => {} });
    RQ.tqStudentIndex = 0;
    upsertTermRating(CID, GABRIEL.id, TERM, { habits: { ...all(4), feedback: 2 } });
  });
  afterEach(() => {
    delete COURSES[CID];
    clearProfCache();
  });
  const saved = () => RQ.plainComment((getStudentTermRating(CID, GABRIEL.id, TERM) || {}).narrative || '');

  it('a rating change redraws the habits sentence Generate wrote, and nothing else', () => {
    expect(ReportBlocks.getTermId()).toBe(TERM);
    RQ.tqGenerate();
    const first = box.value;
    expect(first).toMatch(/using feedback\./);
    RQ.tqRate('devices', 1);
    expect(box.value).toMatch(/using devices well and using feedback\./);
    const strip = t => t.replace(/[^.]*work habits?[^.]*\./i, '');
    expect(strip(box.value)).toBe(strip(first));
    expect(saved()).toBe(box.value);
  });

  it('an edited habits sentence survives a rating change', () => {
    RQ.tqGenerate();
    const habit = box.value.match(/[^.]*using feedback\./)[0].trim();
    box.value = box.value.replace(habit, 'He is learning to act on feedback.');
    RQ.tqNarrativeInput();
    const edited = box.value;
    RQ.tqRate('devices', 1);
    expect(box.value).toBe(edited);
    // Another sentence edited, the habits sentence untouched: only it changes.
    RQ.tqGenerate();
    const again = box.value;
    const sentence = again.match(/[^.]*using feedback\./)[0].trim();
    box.value = again.replace(/^[^.]*\./, 'Gabriel worked hard.');
    RQ.tqRate('devices', 4);
    RQ.tqRate('feedback', 4);
    expect(box.value).not.toContain(sentence);
    expect(box.value).toMatch(/^Gabriel worked hard\./);
    expect(box.value).toMatch(/work habits are excellent/);
  });
});
