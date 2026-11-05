/**
 * Generate plan PR 7 (habits half), rewritten Nov 4 for families: the
 * habits part says what the student does, in the words of each habit's
 * hint, in two or three sentences (tests/comment-bank-habits-family.test.js
 * covers the wording).
 *
 * - The one or two rated Sometimes or Rarely are the habits that would help
 *   (more than two: the two lowest, ties in the grid's order).
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
  return d.sentences.filter(x => /^(habits|habitsMore|habitsBuild|strongHabits)$/.test(x.step));
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

  it('none below Usually is good, all Consistently excellent, however many are rated (Nov 4: no Not Seen)', () => {
    expect(S({ ...all(4), ready: 3 })).toMatchObject({ excellent: false, good: true, build: [] });
    expect(S({ completes: 4, ready: 3 })).toMatchObject({ excellent: false, good: true, build: [] });
    expect(S({ completes: 4, ready: 4 })).toMatchObject({ excellent: true, good: false, build: [] });
  });

  it('nothing rated gives nothing', () => {
    expect(S({})).toEqual({ excellent: false, good: false, build: [], strong: [], seen: [] });
    expect(S(all(5))).toMatchObject({ excellent: false, good: false, build: [], seen: [] });
  });
});

describe('the habits part in a draft', () => {
  it('all six Consistently: what he does, in two sentences, never a verdict', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const hs = habitsSentence(facts({ habits: all(4) }), {}, seed);
      expect(hs.map(x => x.step)).toEqual(['habits', 'habitsMore']);
      expect(hs[0].text).toMatch(/hands in his work on time and comes to class ready to start\.$/);
      expect(hs[1].text).toMatch(
        /listens to others, joins in class discussions, and uses feedback to improve his work\.$/,
      );
      hs.forEach(x => expect(x.text).not.toMatch(/work habits?|excellent|Consistently|six/i));
    }
    // No pronouns on file: they/them (Colin, Nov 1), the verbs agreeing.
    const named = habitsSentence(facts({ habits: all(4), pronounsOnFile: false, pronouns: THEY }));
    expect(named[0].text).toMatch(/\bhand in their work on time and come to class ready to start\.$/);
    expect(named[0].text).not.toMatch(/Gabriel/);
  });

  it('one weak habit: it alone is the habit that would help', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const hs = habitsSentence(facts({ habits: { ...all(4), feedback: 2 } }), {}, seed);
      expect(hs.map(x => x.step)).toEqual(['habits', 'habitsBuild']);
      expect(hs[1].text).toMatch(/using feedback to improve his work/);
      expect(hs[1].text).not.toMatch(/class|others|phone|handing/);
      expect(hs[0].text).not.toMatch(/feedback/);
    }
  });

  it('two weak habits: both in one sentence, in the grid’s order', () => {
    const hs = habitsSentence(facts({ habits: { ...all(3), ready: 2, devices: 1 } }));
    expect(hs[hs.length - 1].text).toMatch(
      /getting started as soon as class begins, and keeping his phone and devices on his work\.$/,
    );
  });

  it('three weak habits: names the two lowest', () => {
    const hs = habitsSentence(facts({ habits: { ...all(4), completes: 2, part: 1, devices: 2 } }));
    const help = hs.find(x => x.step === 'habitsBuild');
    expect(help.text).toMatch(/handing in each task by its due date, and sharing his ideas in class discussions\.$/);
    expect(help.text).not.toMatch(/phone/);
  });

  it('Not Seen is ignored', () => {
    const hs = habitsSentence(facts({ habits: { ...all(4), devices: 5 } }));
    expect(hs.map(x => x.text).join(' ')).not.toMatch(/phone/);
    const [t, ...rest] = habitsSentence(facts({ habits: { ...all(5), others: 1 } }));
    expect(rest).toEqual([]);
    expect(t.step).toBe('habitsBuild');
    expect(t.text).toMatch(/doing his share in group work/);
  });

  it('nothing rated: no habits sentence', () => {
    expect(habitsSentence(facts())).toEqual([]);
    expect(habitsSentence(facts({ habits: all(5) }))).toEqual([]);
  });

  it('verifies against the ratings it was drafted from', () => {
    const f = facts({ habits: { ...all(4), part: 2 } });
    const d = CommentBank.draft(CommentBank.context(f, {}), { seed: 3 });
    const ids = d.ids.filter(id => /^hf/.test(id));
    expect(ids).toHaveLength(2);
    expect(CommentBank.verify(d, f, {}).replaced).toEqual([]);
    // The rating changed after the draft: the habit that would help no
    // longer holds; what he does at Consistently still does.
    const changed = { ...f, habits: { ...all(4), part: 3 } };
    const v = CommentBank.verify(d, changed, {});
    expect(v.replaced.map(r => r.sentenceId)).toEqual([ids[1]]);
    expect(v.replaced[0].failed).toContain('habits');
    // A habit he does at Consistently drops: the strengths sentence goes too.
    const dropped = { ...f, habits: { ...all(4), part: 2, completes: 3 } };
    expect(CommentBank.verify(d, dropped, {}).replaced.map(r => r.sentenceId)).toContain(ids[0]);
  });

  it('keeps every habits sentence within its words (20; 26 for two habits that would help), in every kind of class', () => {
    const fams = ['', 'pe', 'arts', 'math', 'adst', 'ela', 'socials', 'science', 'career'];
    const sentences = COMMENT_BANK.sentences.filter(s => s.part === 'habits' && /^h[sf]/.test(s.id));
    fams.forEach(family => {
      KEYS.forEach(a =>
        KEYS.forEach(b => {
          if (a === b) return;
          const ctx = CommentBank.context(facts({ family, habits: { ...all(4), [a]: 1, [b]: 2 } }), {});
          const one = CommentBank.context(facts({ family, habits: { ...all(4), [a]: 1 } }), {});
          const strong = CommentBank.context(facts({ family, habits: { ...all(1), [a]: 4, [b]: 4 } }), {});
          const usual = CommentBank.context(facts({ family, habits: { ...all(3), [a]: 4, [b]: 2 } }), {});
          const some = CommentBank.context(facts({ family, habits: { ...all(2), [a]: 1, [b]: 1 } }), {});
          [ctx, one, strong, usual, some].forEach(c =>
            sentences
              .filter(s => CommentBank.fits(s, c))
              .forEach(s => {
                const t = CommentBank.fill(s, c);
                expect(words(t), family + ' ' + s.id + ': ' + t).toBeLessThanOrEqual(s.maxWords || 20);
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
    // hs11 whole, or one of the frames around the same phrase (hs13, hs15).
    expect(hs[0].text).toMatch(
      /\bhe comes to class ready to start, listens to others, and joins in class discussions\.$/i,
    );
    expect(hs[0].text).not.toMatch(/Consistently|excellent|work habits/);
  });
});

describe('Arts never says “handing in complete work”', () => {
  it('has no handed-in wording in any form of any habit', () => {
    ['build', 'does', 'do'].forEach(form =>
      KEYS.forEach(k => expect(CommentBank.habitWords(k, form, 'arts', HE), k + ' ' + form).not.toMatch(/hand/i)),
    );
    CommentBank.SAY_FORMS.forEach(form =>
      KEYS.forEach(k => expect(CommentBank.habitSay(k, form, 'arts'), k + ' ' + form).not.toMatch(/hand/i)),
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
  const others = d => d.sentences.filter(x => !/^habits/.test(x.step)).map(x => x.text);

  it('writes only the habits sentence again', () => {
    const prev = draftFor({ ...all(4), feedback: 2 });
    const d = redraw(prev, { ...all(4), devices: 1 });
    // The fact in each: the one habit below Usually, in whichever frame.
    // The habits part, two sentences before and after.
    expect(d.habits.before).toMatch(/using feedback to improve his work\.$/);
    expect(d.habits.after).toMatch(/keeping his phone and devices on his work\.$/);
    expect(d.habits.after).not.toMatch(/using feedback/);
    expect(others(d)).toEqual(others(prev));
    expect(d.sentences.map(x => x.step)).toEqual(prev.sentences.map(x => x.step));
    expect(d.text).toBe(prev.text.replace(d.habits.before, d.habits.after));
  });

  it('adds the sentence where the story puts it once habits are rated, and drops it when none fits', () => {
    const prev = draftFor({});
    expect(prev.sentences.some(x => x.step === 'habits')).toBe(false);
    const d = redraw(prev, all(4));
    expect(d.habits).toMatchObject({ before: '' });
    expect(d.habits.after).toMatch(/hands in his work on time/);
    expect(others(d)).toEqual(others(prev));
    const back = redraw(d, {});
    expect(back.habits).toMatchObject({ before: d.habits.after, after: '' });
    expect(back.text).toBe(prev.text);
  });

  it('with steps ATTENDANCE_STEPS draws only the attendance sentence again: added once entered, out once cleared', () => {
    const att = (prev, absent, late) =>
      CommentBank.redrawHabits(CommentBank.context(facts({ habits: all(4), absent, late }), {}), prev, {
        steps: CommentBank.ATTENDANCE_STEPS,
      });
    const prev = draftFor(all(4));
    expect(prev.sentences.some(x => x.step === 'attendance')).toBe(false);
    const d = att(prev, 3, 1);
    // One of the both-count attendance frames (h60, h73-h78): the exact
    // counts, both said.
    expect(d.habits.before).toBe('');
    expect(d.habits.after).toMatch(/three classes/);
    expect(d.habits.after).toMatch(/\bonce\b/);
    expect(d.sentences.filter(x => x.step !== 'attendance').map(x => x.text)).toEqual(prev.sentences.map(x => x.text));
    expect(d.text).toContain(d.habits.after);
    const back = att(d, null, null);
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
    expect(first).toMatch(/feedback/i);
    RQ.tqRate('devices', 1);
    expect(box.value).toMatch(/using feedback to improve his work, and keeping his phone and devices on his work\./);
    // Everything but the habits part is as it was.
    const strip = t =>
      RQ.sentencesOf(t)
        .filter(x => !/feedback|phone|hands in|ready to start|listens|discussions/.test(x))
        .join(' ');
    expect(strip(box.value)).toBe(strip(first));
    expect(saved()).toBe(box.value);
  });

  it('an edited habits sentence survives a rating change', () => {
    // The habits sentence as a whole sentence (a quoted title's period
    // would cut a regex short).
    const habitsOf = text => RQ.sentencesOf(text).find(x => /using feedback/i.test(x));
    RQ.tqGenerate();
    const habit = habitsOf(box.value);
    box.value = box.value.replace(habit, 'He is learning to act on feedback.');
    RQ.tqNarrativeInput();
    const edited = box.value;
    RQ.tqRate('devices', 1);
    expect(box.value).toBe(edited);
    // Generate again keeps the edited sentence (the rows follow the box
    // before it runs).
    RQ.tqGenerate();
    expect(box.value).toContain('He is learning to act on feedback.');
    // Put back as Generate wrote it, it is no longer the teacher's; another
    // sentence edited, the habits sentence untouched: only it changes.
    box.value = box.value.replace('He is learning to act on feedback.', habit);
    RQ.tqNarrativeInput();
    RQ.tqGenerate();
    const again = box.value;
    const sentence = habitsOf(again);
    box.value = again.replace(/^[^.]*\./, 'Gabriel worked hard.');
    RQ.tqRate('devices', 4);
    RQ.tqRate('feedback', 4);
    expect(box.value).not.toContain(sentence);
    expect(box.value).toMatch(/^Gabriel worked hard\./);
    expect(box.value).toMatch(/hands in his work on time/);
  });

  /* The Sentences card follows the comment without another Generate: a
     rating adds or changes the Habits row, attendance adds and removes
     the Attendance row (the States mockup's "Attendance entered"). */
  describe('the Sentences card follows', () => {
    let drawn, els;
    const label = (html, name) => new RegExp('qn-req-label">' + name + '<').test(html);
    beforeEach(() => {
      drawn = [];
      els = {
        'tq-sentences': {
          set outerHTML(v) {
            drawn.push(v);
          },
        },
        'tq-att-absences': { value: '', classList: { toggle() {} } },
        'tq-att-lates': { value: '', classList: { toggle() {} } },
        'tq-att-note': { innerHTML: '' },
      };
      globalThis.document.getElementById = id => (id === 'tq-narrative' ? box : els[id] || null);
    });

    it('a rating adds the Habits row, and changes it, without Generate', () => {
      upsertTermRating(CID, GABRIEL.id, TERM, { habits: {} });
      RQ.tqGenerate();
      expect(box.value).not.toMatch(/hands in his work/);
      drawn = [];
      KEYS.forEach(k => RQ.tqRate(k, 4));
      const excellent = /hands in his work on time/;
      expect(box.value).toMatch(excellent);
      expect(drawn.length).toBeGreaterThan(0);
      const card = drawn[drawn.length - 1];
      expect(label(card, 'Habits')).toBe(true);
      expect(card).toMatch(excellent);
      RQ.tqRate('devices', 1);
      expect(box.value).toMatch(/keeping his phone and devices on his work/);
      expect(drawn[drawn.length - 1]).toMatch(/keeping his phone and devices on his work/);
      expect(label(drawn[drawn.length - 1], 'Habits')).toBe(true);
      expect(saved()).toBe(box.value);
    });

    it('attendance entered adds the Attendance row and its sentence; cleared, both go', () => {
      RQ.tqGenerate();
      expect(box.value).not.toMatch(/has missed/);
      els['tq-att-absences'].value = '3';
      els['tq-att-lates'].value = '1';
      RQ.tqSetAttendance(GABRIEL.id);
      expect(els['tq-att-note'].innerHTML).toBe('Added to the comment.');
      // One of the both-count attendance frames, the exact counts said.
      const att = box.value.match(/[^.]*three classes[^.]*\./);
      expect(att).not.toBeNull();
      expect(att[0]).toMatch(/\bonce\b/);
      let card = drawn[drawn.length - 1];
      expect(label(card, 'Attendance')).toBe(true);
      expect(card).toContain(att[0].trim());
      expect(card).toContain('From Attendance above · new');
      expect(saved()).toBe(box.value);
      els['tq-att-absences'].value = '';
      els['tq-att-lates'].value = '';
      RQ.tqSetAttendance(GABRIEL.id);
      expect(box.value).not.toMatch(/has missed/);
      card = drawn[drawn.length - 1];
      expect(label(card, 'Attendance')).toBe(false);
      expect(card).not.toContain('From Attendance above');
      expect(saved()).toBe(box.value);
    });
  });
});
