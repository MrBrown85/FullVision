/**
 * Generate plan PR 8: the next step, support, closing, late work and the
 * character limit.
 *
 * - The next step names one skill from the competency-to-skill table, tied
 *   to the lowest competency with 3+ scored pieces; never a bare label.
 * - Support lines are the teacher's: ticked from the class's checklist or
 *   written, picked per student or left out for one student.
 * - The closing sentence and the late-work line are used exactly as typed;
 *   the late-work line follows the missing-work sentence only for students
 *   with work labelled Missing.
 * - "For the Family" sentences: five per next-step skill (`when.nextSkill`),
 *   plus general ones per kind of class and for any class.
 * - The class settings live in report_config (blocks_config.commentSettings)
 *   and the late-work line is course.late_work_policy.
 */
import './setup.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const THEY = { subj: 'they', obj: 'them', poss: 'their', refl: 'themselves' };
const words = t => t.trim().split(/\s+/).length;

function day(n) {
  const d = new Date(2026, 8, 1 + n);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
const pts = (vs, gap = 7) => vs.map((v, i) => ({ id: 'w' + i, d: day(i * gap), v, title: 'Task ' + i }));
const comp = (id, name, level, n = 3) => ({
  id,
  name,
  scores: pts(Array.from({ length: n }, () => level)),
  start: level,
  now: level,
  level,
  iCans: ['I can explain why it matters'],
});

/* A History 12 student's facts, built by hand. */
function facts(over) {
  return Object.assign(
    {
      cid: 'lines',
      sid: 's1',
      name: 'Noor',
      first: 'Noor',
      course: 'History 12',
      family: 'socials',
      pronouns: THEY,
      pronounsOnFile: true,
      comps: [comp('c1', 'Evidence', 3.5), comp('c2', 'Perspective', 3), comp('c3', 'Significance', 2.5)],
      work: [],
      voice: {},
      confidence: [],
      record: { total: 6, handed: 6, late: 0, missing: 0 },
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
const line = (id, text, fits) => ({ id, text, fits: fits || [], own: false, on: true });
const draftOf = f => CommentBank.draft(CommentBank.context(f, {}), { seed: 3 });
const stepText = (d, step) => (d.sentences.find(s => s.step === step) || {}).text;

describe('the competency-to-skill table', () => {
  it('turns the Socials competencies into skills in plain words (the plan and the mockup)', () => {
    expect(CommentBank.skillOf('socials', 'Significance').skill).toBe(
      'explain why an event mattered and who it affected',
    );
    expect(CommentBank.skillOf('socials', 'Evidence').skill).toBe('support each claim with evidence from a source');
    expect(CommentBank.skillOf('socials', 'Perspective').skill).toBe('judge a source by who created it and why');
    expect(CommentBank.skillOf('socials', 'Cause & Consequence').key).toBe('cause');
    expect(CommentBank.skillOf('socials', 'Historical Significance').key).toBe('significance');
    expect(CommentBank.skillOf('science', 'Processing and Analyzing Data and Information').key).toBe('processing');
    expect(CommentBank.skillOf('science', 'Community Applications').key).toBe('applying');
    expect(CommentBank.skillOf('math', 'Reasoning and Modelling').key).toBe('reasoning');
    expect(CommentBank.skillOf('ela', 'Comprehend and Connect').key).toBe('reading');
  });
  it('has no skill for a label it does not know, or an unknown kind of class', () => {
    expect(CommentBank.skillOf('socials', 'Recognize Impacts')).toBeNull();
    expect(CommentBank.skillOf('', 'Evidence')).toBeNull();
  });
  it('words every skill to finish “Next, they can …” in 20 words or fewer', () => {
    Object.keys(CommentBank.SKILLS).forEach(fam =>
      CommentBank.SKILLS[fam].forEach(row => {
        const s = 'Next, they can ' + row.skill + '.';
        expect(words(s), row.skill).toBeLessThanOrEqual(20);
        expect(row.skill, row.skill).toMatch(/^[a-z]/);
      }),
    );
  });
});

describe('nextStepOf', () => {
  it('is the lowest competency with two or more scored pieces, not among the strongest', () => {
    const f = facts();
    expect(CommentBank.nextStepOf(f.comps).id).toBe('c3');
    // Two pieces are enough (Colin, 2026-11-03; was three).
    const two = [comp('a', 'Evidence', 3.5), comp('b', 'Perspective', 3), comp('c', 'Significance', 2, 2)];
    expect(CommentBank.nextStepOf(two).id).toBe('c');
    // One piece is too little: the next lowest with enough is used.
    const thin = [comp('a', 'Evidence', 3.5), comp('b', 'Perspective', 3), comp('c', 'Significance', 2, 1)];
    expect(CommentBank.nextStepOf(thin).id).toBe('b');
  });
  it('takes the first on a tie and none without enough evidence', () => {
    expect(CommentBank.nextStepOf([comp('a', 'Evidence', 3), comp('b', 'Perspective', 3)]).id).toBe('a');
    expect(CommentBank.nextStepOf([comp('a', 'Evidence', 3, 1)])).toBeNull();
  });
});

describe('the draft', () => {
  it('says the next step as a skill, never a bare competency label', () => {
    const d = draftOf(facts());
    // One of the frames written for Significance, filled for singular they.
    const got = d.sentences.find(x => x.step === 'nextStep');
    const forSkill = COMMENT_BANK.sentences
      .filter(s => s.when && s.when.nextSkill === 'significance' && s.subjects[0] === 'socials')
      .map(s => s.id);
    expect(forSkill).toContain(got.id);
    expect(got.text).toMatch(
      /^(Next, they can|The next step for them is to|Their next step is to|[A-Z]\w+ing .* (is their next step|is what they can practise next))/,
    );
    expect(got.text).not.toContain('Significance');
    expect(d.replaced).toEqual([]);
    // No skill in the table: no next-step sentence that names a competency.
    const d2 = draftOf(facts({ comps: [comp('c1', 'Evidence', 3.5), comp('c3', 'Recognize Impacts', 2.5)] }));
    const next = stepText(d2, 'nextStep') || '';
    expect(next).not.toContain('Recognize Impacts');
    expect(d2.text).not.toContain('Recognize Impacts');
  });

  it('leaves the support, closing and late-work lines out when the class has none', () => {
    const d = draftOf(facts({ notHandedIn: { count: 1, titles: ['Assessing the Treaty of Versailles'], groups: [] } }));
    ['support', 'closer', 'lateWork'].forEach(k => expect(stepText(d, k), k).toBeUndefined());
    // One of the one-title Not Handed In frames (m01-m06): the title, quoted.
    expect(stepText(d, 'notHandedIn')).toMatch(/not handed in/);
    expect(stepText(d, 'notHandedIn')).toMatch(/“Assessing the Treaty of Versailles\.?”/);
  });

  it('puts the class’s lines in the comment exactly as typed, in the target order', () => {
    const f = facts({
      notHandedIn: {
        count: 2,
        titles: ['Assessing the Treaty of Versailles', 'Current Events: Week of October 13'],
        groups: [],
      },
      classLines: {
        support: [
          line('sl-missing', 'In class, I will check in about missing work each week.', ['completes']),
          line('sl-sources', 'In class, I will give feedback on source work each week.', ['significance']),
        ],
        pick: null,
        closing: 'Extra help is at lunch on Tuesdays in [Room].',
        late: 'Late work is accepted until December 4.',
      },
    });
    const d = draftOf(f);
    const steps = d.sentences.map(s => s.step);
    // One of the two-title Not Handed In frames (m01, m07-m11): both titles.
    expect(stepText(d, 'notHandedIn')).toMatch(/not handed in/);
    expect(stepText(d, 'notHandedIn')).toMatch(
      /“Assessing the Treaty of Versailles” and “Current Events: Week of October 13\.?”/,
    );
    expect(steps[steps.indexOf('notHandedIn') + 1]).toBe('lateWork');
    expect(stepText(d, 'lateWork')).toBe('Late work is accepted until December 4.');
    // The line that fits the next step (Significance) is the one used.
    expect(stepText(d, 'support')).toBe('In class, I will give feedback on source work each week.');
    expect(steps.indexOf('nextStep')).toBeLessThan(steps.indexOf('support'));
    expect(steps.indexOf('support')).toBeLessThan(steps.indexOf('home'));
    expect(steps[steps.length - 1]).toBe('closer');
    expect(stepText(d, 'closer')).toBe('Extra help is at lunch on Tuesdays in [Room].');
    expect(d.replaced).toEqual([]);
    // The class's lines are not bank sentences: no classmate usage, no checks.
    expect(d.provenance.filter(p => p.classLine).map(p => p.sentenceId)).toEqual([
      'class:lateWork',
      'class:support',
      'class:closer',
    ]);
    expect(CommentBank.verify(d, f, {}).text).toBe(d.text);
  });

  it('adds the late-work line only for a student with work labelled Missing', () => {
    const f = facts({
      classLines: { support: [], pick: null, closing: '', late: 'Late work is accepted until December 4.' },
    });
    expect(draftOf(f).text).not.toContain('Late work');
  });

  it('uses the student’s own pick, or leaves the sentence out for that student only', () => {
    // Line a fits Noor's next step (Significance); line b fits nothing of hers.
    const support = [
      line('a', 'In class, I will give feedback on source work each week.', ['significance']),
      line('b', 'In class, I will check in about missing work each week.', ['completes']),
    ];
    const base = { support, pick: null, closing: '', late: '' };
    expect(stepText(draftOf(facts({ classLines: base })), 'support')).toBe(support[0].text);
    expect(stepText(draftOf(facts({ classLines: { ...base, pick: 'b' } })), 'support')).toBe(support[1].text);
    expect(stepText(draftOf(facts({ classLines: { ...base, pick: 'none' } })), 'support')).toBeUndefined();
    // A pick no longer ticked falls back to the class's line that fits.
    expect(stepText(draftOf(facts({ classLines: { ...base, pick: 'gone' } })), 'support')).toBe(support[0].text);
  });

  it('leaves the support sentence out when no ticked line fits the student, never the first ticked line', () => {
    const support = [
      line('a', 'In class, I will give a short checklist for each assignment.', ['ready']),
      line('b', 'In class, I will check in about missing work each week.', ['completes']),
    ];
    const f = facts({ classLines: { support, pick: null, closing: '', late: '' } });
    expect(CommentBank.supportChoice(f, {})).toBeNull();
    expect(stepText(draftOf(f), 'support')).toBeUndefined();
    expect(CommentBank.context(f, {}).supportLine).toBe('');
    // A line with no `fits` at all fits no one.
    const bare = facts({
      classLines: { support: [line('c', 'In class, I will say hello.')], pick: null, closing: '', late: '' },
    });
    expect(CommentBank.supportChoice(bare, {})).toBeNull();
  });

  it('picks a line that fits a habit rated Sometimes or Rarely when none fits the next step', () => {
    const support = [
      line('a', 'In class, I will give a short checklist for each assignment.', ['ready']),
      line('b', 'In class, I will check in about missing work each week.', ['completes']),
    ];
    const f = facts({ habits: { completes: 2 }, classLines: { support, pick: null, closing: '', late: '' } });
    expect(CommentBank.supportChoice(f, { completes: 2 })).toMatchObject({ line: { id: 'b' }, fit: 'completes' });
  });

  it('keeps the closing sentence last on the IE path, the support line before the meeting, no late-work line', () => {
    // The ticked line fits the student (Completes Work rated Sometimes), as
    // the IEPath mockup's "missing work" line fits a student with work out.
    const f = facts({
      grade: { mode: 'letter', letter: 'IE', pct: 40, basis: 'ie', pieces: [], marked: { mine: 2, all: 8 } },
      habits: { completes: 2 },
      classLines: {
        support: [line('a', 'In class, I will give a short checklist for each assignment.', ['completes'])],
        pick: null,
        closing: 'Extra help is at lunch on Tuesdays in [Room].',
        late: 'Late work is accepted until December 4.',
      },
    });
    const d = draftOf(f);
    const steps = d.sentences.map(s => s.step);
    expect(steps[steps.length - 1]).toBe('closer');
    // The IEPath mockup: the support line sits after the deadline, before
    // the meeting sentence.
    expect(stepText(d, 'support')).toBe('In class, I will give a short checklist for each assignment.');
    expect(steps.indexOf('ieDeadline')).toBeLessThan(steps.indexOf('support'));
    expect(steps.indexOf('support')).toBeLessThan(steps.indexOf('ieMeeting'));
    expect(steps).not.toContain('lateWork');
  });
});

describe('For the Family sentences', () => {
  const fam = COMMENT_BANK.sentences.filter(s => s.group === 'For the Family');
  const general = fam.filter(s => !s.when);
  const KINDS = ['socials', 'science', 'math', 'ela', 'arts', 'pe', 'adst', 'career'];
  it('has at least six general ones for every kind of class and ten for any class', () => {
    KINDS.forEach(k =>
      expect(general.filter(s => (s.subjects || []).indexOf(k) >= 0).length, k).toBeGreaterThanOrEqual(6),
    );
    expect(general.filter(s => !s.subjects).length).toBeGreaterThanOrEqual(10);
  });
  it('has at least three for every skill the next step can name, tagged to that kind of class', () => {
    KINDS.forEach(k =>
      CommentBank.SKILLS[k].forEach(r =>
        expect(
          fam.filter(s => s.when && s.when.nextSkill === r.key && (s.subjects || []).indexOf(k) >= 0).length,
          k + '.' + r.key,
        ).toBeGreaterThanOrEqual(3),
      ),
    );
  });
  it('are plain: one sentence each, 20 words or fewer, an invitation, claiming only the next step they help with', () => {
    fam.forEach(s => {
      expect(words(s.text), s.id).toBeLessThanOrEqual(20);
      expect(s.text, s.id).not.toMatch(/\b(make sure|remind|supervis|monitor|homework|classmates?|peers?)\b/i);
      expect(s.text, s.id).not.toMatch(/\b(still|again|only|finally|unfortunately)\b|!|\bat least\b/i);
      if (s.when) {
        expect(Object.keys(s.when), s.id).toEqual(['nextSkill']);
        expect(s.claims, s.id).toEqual(['nextStep']);
      } else expect(s.claims, s.id).toEqual([]);
    });
  });
  it('offers the sentences for the next step’s skill first, and the general ones without one', () => {
    // Noor's lowest competency with 3+ pieces is Significance.
    const f = facts();
    const ctx = CommentBank.context(f, {});
    expect(ctx._nextSkill).toBe('significance');
    const pool = CommentBank.stepPool('home', ctx);
    expect(pool.length).toBeGreaterThanOrEqual(3);
    pool.forEach(s => expect(s.when, s.id).toEqual({ nextSkill: 'significance' }));
    const d = draftOf(f);
    const home = d.sentences.find(s => s.step === 'home');
    expect(home.text).toMatch(/event|history/);
    // The same facts with no table skill for the next step: a general one.
    const g = facts({ comps: [comp('c1', 'Evidence', 3.5), comp('c2', 'Perspective', 3), comp('c3', 'Maps', 2.5)] });
    const gctx = CommentBank.context(g, {});
    expect(gctx._nextSkill).toBe('');
    CommentBank.stepPool('home', gctx).forEach(s => expect(s.when, s.id).toBeUndefined());
  });
  it('verify() replaces a skill-bound sentence once the next step is another skill', () => {
    const f = facts();
    const d = draftOf(f);
    const home = d.sentences.find(s => s.step === 'home');
    expect(COMMENT_BANK.sentences.find(s => s.id === home.id).when).toEqual({ nextSkill: 'significance' });
    expect(CommentBank.verify(d, f, {}).replaced).toEqual([]);
    // Perspective drops below Significance: the next step is Perspective now.
    const f2 = facts({
      comps: [comp('c1', 'Evidence', 3.5), comp('c2', 'Perspective', 2), comp('c3', 'Significance', 2.5)],
    });
    const v = CommentBank.verify(d, f2, {});
    const r = v.replaced.find(x => x.sentenceId === home.id);
    expect(r).toBeTruthy();
    expect(r.failed).toContain('nextStep');
    // The stand-in asserts nothing (plan PR 5): a general For the Family sentence.
    const by = COMMENT_BANK.sentences.find(s => s.id === r.by);
    expect(by.group).toBe('For the Family');
    expect(by.when).toBeUndefined();
    expect(by.claims).toEqual([]);
  });
  it('the mockup’s Socials sentence is one of them', () => {
    expect(fam.map(s => s.text)).toContain('At home, you can ask {him} what a news story means for the people in it.');
  });
  it('the old Support, In Class and At Home sentences are gone', () => {
    expect(COMMENT_BANK.sentences.filter(s => ['Support', 'In Class', 'At Home'].indexOf(s.group) >= 0)).toEqual([]);
  });
});

describe('the class settings (report_config) and the review screen', () => {
  const RQ = ReportQuestionnaire;
  const CID = 'course-lines';
  const TERM = 'term-1';
  const GAB = { id: 'stu-gab', firstName: 'Gabriel', lastName: 'Wong', pronouns: 'he/him' };
  const AVA = { id: 'stu-ava', firstName: 'Ava', lastName: 'Martin', pronouns: 'she/her' };
  let hadDoc, oldDoc, btn, inputs;
  const secs = ['Evidence', 'Perspective', 'Significance'];

  function seed(missing) {
    COURSES[CID] = { id: CID, name: 'History 12', gradingSystem: 'letter', gradeLevel: '12' };
    _cache.students[CID] = [Object.assign({}, GAB), Object.assign({}, AVA)];
    _cache.learningMaps[CID] = {
      sections: secs.map((n, i) => ({ id: 'sec' + i, name: n, shortName: n, tags: [{ id: 't' + i, label: n }] })),
    };
    _cache.categories[CID] = [];
    _cache.assessments[CID] = Array.from({ length: 10 }, (_, i) => ({
      id: 'a' + i,
      title: 'Task ' + (i + 1),
      scoreMode: 'proficiency',
      tagIds: ['t' + (i % 3)],
      type: 'summative',
      date: '2026-10-' + String(i + 1).padStart(2, '0'),
    }));
    const levels = [4, 3, 2];
    const rows = sid =>
      _cache.assessments[CID].filter(a => !(sid === GAB.id && (missing || []).indexOf(a.id) >= 0)).map(a => ({
        assessmentId: a.id,
        tagId: a.tagIds[0],
        score: levels[Number(a.tagIds[0].slice(1))],
        date: a.date,
      }));
    _cache.scores[CID] = { [GAB.id]: rows(GAB.id), [AVA.id]: rows(AVA.id) };
    const st = {};
    (missing || []).forEach(aid => (st[GAB.id + ':' + aid] = 'NS'));
    _cache.statuses[CID] = st;
    _cache.overrides[CID] = {};
    _cache.courseConfigs[CID] = {};
    _cache.observations[CID] = {};
    _cache.reflections[CID] = {};
    _cache.termRatings[CID] = {};
    _cache.reportConfig[CID] = null;
    localStorage.removeItem('gb-report-config-' + CID);
    clearProfCache();
  }
  function open(sid) {
    RQ.configure({ activeCourse: CID, renderReports: () => {} });
    RQ.tqStudentIndex = RQ.getTqStudents().findIndex(s => s.id === (sid || GAB.id));
    return RQ.renderTermQuestionnaire(CID);
  }
  const settings = () => (getReportConfig(CID) || {}).commentSettings || {};

  beforeAll(() => {
    hadDoc = 'document' in globalThis;
    oldDoc = globalThis.document;
    btn = { disabled: false, title: '' };
    inputs = {};
    globalThis.document = {
      getElementById: id => (id === 'tq-approve-next' ? btn : inputs[id] || null),
      querySelector: () => null,
      querySelectorAll: () => [],
    };
  });
  afterAll(() => {
    if (hadDoc) globalThis.document = oldDoc;
    else delete globalThis.document;
    delete COURSES[CID];
  });

  it('reads the class settings from report_config, and tolerates none', () => {
    seed();
    expect(CommentBank.classSettings(CID)).toEqual({
      supportChosen: [],
      supportOwn: [],
      supportFor: {},
      languageGoalsChosen: [],
      languageGoalsOwn: [],
      languageGoalsFor: {},
      closing: '',
      charLimit: null,
    });
    saveReportConfig(CID, {
      form: { sides: [] },
      commentSettings: {
        supportChosen: ['sl-sources'],
        closing: ' Bye. ',
        charLimit: '900',
        supportOwn: [{ id: 'own-1', text: 'Mine.' }, { id: 'x' }],
      },
    });
    const cs = CommentBank.classSettings(CID);
    expect(cs).toMatchObject({ supportChosen: ['sl-sources'], closing: 'Bye.', charLimit: 900 });
    expect(cs.supportOwn).toEqual([{ id: 'own-1', text: 'Mine.' }]);
    // The class's checklist: the Socials lines, then the teacher's own.
    const list = CommentBank.supportChecklist(CID, 'socials');
    expect(list.map(l => l.text)).toContain('In class, I will give feedback on source work each week.');
    expect(list.map(l => l.text)).not.toContain('In class, I will give feedback on each lab write-up.');
    expect(list[list.length - 1]).toMatchObject({ id: 'own-1', own: true, on: false });
    expect(list.find(l => l.id === 'sl-sources').on).toBe(true);
  });

  it('shows the empty states when the class has nothing set', () => {
    seed();
    const html = open();
    expect(html).toContain('No support lines chosen for this class. The comment leaves this sentence out.');
    expect(html).toContain('>Choose…</button>');
    expect(html).toContain('No closing sentence for this class.');
    expect(html).toContain('>Add One…</button>');
    expect(html).toContain('<span id="tq-limit-text"> · no limit</span> ▾');
    expect(html).not.toContain('qn-required');
  });

  it('shows the Not Handed In row with the late-work line for a student with missing work', () => {
    seed(['a9', 'a8']);
    COURSES[CID].lateWorkPolicy = 'Late work is accepted until December 4.';
    const html = open();
    expect(html).toContain('<span class="qn-req-label">Not Handed In</span>');
    expect(html).toMatch(/<span class="qn-req-text">[^<]*“Task 9”[^<]*“Task 10\.?”/);
    expect(html).toContain('>Late work is accepted until December 4.</button>');
    expect(html).toContain('2 of 10 · check that both are really missing before you approve');
    expect(open(AVA.id)).not.toContain('Not Handed In');
  });

  it('shows the Not Handed In sentence the comment has, and before Generate the one it will write (Step 4 group 2 #52)', () => {
    seed(['a9', 'a8']);
    const st = getStudents(CID).find(s => s.id === GAB.id);
    const f = CommentBank.facts(CID, st, TERM);
    const fixed = CommentBank.notHandedInSentence(f.notHandedIn);
    // Every frame of the step, until one words the fact differently.
    let d;
    for (let seedN = 1; seedN < 60; seedN++) {
      d = CommentBank.draft(CommentBank.context(f, {}), { seed: seedN, quiet: true });
      const x = d.sentences.find(y => y.step === 'notHandedIn');
      if (x && x.text !== fixed) break;
    }
    const said = d.sentences.find(y => y.step === 'notHandedIn').text;
    expect(said).not.toBe(fixed);
    upsertTermRating(CID, GAB.id, TERM, { narrative: d.text });
    const html = open();
    const row = html.slice(html.indexOf('id="tq-row-missing"'));
    expect(row.slice(0, row.indexOf('</div>\n    </div>'))).toContain(said);
    expect(row.slice(0, 600)).not.toContain(fixed);
  });

  it('leaves Completes Work blank until the teacher rates it; clearing returns it to blank (Step 4 group 3 #65, Nov 4)', () => {
    seed(['a9', 'a8']);
    const st = getStudents(CID).find(s => s.id === GAB.id);
    // The record has work in it, but nothing is rated from it.
    expect(CommentBank.facts(CID, st, TERM).record.total).toBeGreaterThan(0);
    expect(CommentBank.effectiveHabits({}, CommentBank.facts(CID, st, TERM).record)).toEqual({});
    const blank =
      /class="qn-hs" role="slider" tabindex="0" data-habit="completes" data-value="0"[^>]*aria-valuemax="4" aria-valuetext="Not rated"/;
    let html = open();
    expect(html).toMatch(blank);
    expect(html).not.toContain('from-record');
    expect(html).not.toContain('from the assignment record');
    expect(html).not.toContain('From assignments:');
    expect(html).toContain('id="tq-rated">0 of 6 rated');
    // Rated by the teacher: the slider shows their rating.
    upsertTermRating(CID, GAB.id, TERM, { habits: { completes: 4 } });
    html = open();
    expect(html).toMatch(
      /class="qn-hs set" role="slider" tabindex="0" data-habit="completes" data-value="4"[^>]*aria-valuenow="4" aria-valuetext="Consistently"/,
    );
    expect(html).toContain('id="tq-rated">1 of 6 rated');
    // Cleared: blank again, not the record's guess.
    upsertTermRating(CID, GAB.id, TERM, { habits: {} });
    html = open();
    expect(html).toMatch(blank);
    expect(html).toContain('id="tq-rated">0 of 6 rated');
  });

  it('saves the closing sentence for the class; approved comments keep the old one', () => {
    seed();
    saveReportConfig(CID, { commentSettings: { closing: 'Extra help is at lunch on Tuesdays in [Room].' } });
    upsertTermRating(CID, GAB.id, TERM, {
      narrative: 'Gabriel is earning a B. Extra help is at lunch on Tuesdays in [Room].',
    });
    upsertTermRating(CID, AVA.id, TERM, {
      narrative: 'Ava is earning an A. Extra help is at lunch on Tuesdays in [Room].',
      approvedAt: '2026-10-30T10:00:00Z',
    });
    open();
    RQ.tqLine('editClosing');
    expect(RQ.renderTermQuestionnaire(CID)).toContain(
      'Ends every new comment in History 12. Approved comments are flagged so you can update or keep each one. Leave it empty to end without one.',
    );
    inputs['tq-line-closing'] = { value: 'Extra help is at lunch on Wednesdays.', focus() {} };
    RQ.tqLine('saveClosing');
    expect(settings().closing).toBe('Extra help is at lunch on Wednesdays.');
    expect(getStudentTermRating(CID, GAB.id, TERM).narrative).toBe(
      'Gabriel is earning a B. Extra help is at lunch on Wednesdays.',
    );
    expect(getStudentTermRating(CID, AVA.id, TERM).narrative).toBe(
      'Ava is earning an A. Extra help is at lunch on Tuesdays in [Room].',
    );
    expect(getStudentTermRating(CID, AVA.id, TERM).approvedAt).toBe('2026-10-30T10:00:00Z');
    // Emptied: the sentence comes out of the comment not yet approved.
    RQ.tqLine('editClosing');
    inputs['tq-line-closing'] = { value: '', focus() {} };
    RQ.tqLine('saveClosing');
    expect(getStudentTermRating(CID, GAB.id, TERM).narrative).toBe('Gabriel is earning a B.');
    delete inputs['tq-line-closing'];
  });

  it('saves the late-work line as the class’s Late Work Policy', () => {
    seed(['a9']);
    open();
    RQ.tqLine('editLate');
    const html = RQ.renderTermQuestionnaire(CID);
    expect(html).toContain('aria-label="Late work line for History 12"');
    expect(html).toContain(
      'This is the class’s Late Work Policy. It follows the missing-work sentence for every student who has some.',
    );
    inputs['tq-line-late'] = { value: 'Late work is accepted until December 4.', focus() {} };
    RQ.tqLine('saveLate');
    expect(COURSES[CID].lateWorkPolicy).toBe('Late work is accepted until December 4.');
    delete inputs['tq-line-late'];
  });

  it('ticks lines, writes one, and picks or leaves out a line for one student', () => {
    seed();
    open();
    RQ.tqLineChange({ dataset: { tqSupport: 'sl-sources' }, checked: true });
    expect(settings().supportChosen).toEqual(['sl-sources']);
    RQ.tqLine('supportMenu');
    let html = RQ.renderTermQuestionnaire(CID);
    expect(html).toContain('role="menu" aria-label="Support lines for History 12"');
    expect(html).toContain('Use for Gabriel');
    expect(html).toContain('Lines you will do in History 12');
    expect(html).toContain('In use · fits Significance');
    expect(html).toContain('Leave this sentence out');
    expect(html).toContain('For Gabriel only');
    expect(html).toContain('+ Write Your Own');
    RQ.tqLine('writeOwn');
    inputs['tq-line-own'] = { value: 'In class, I will meet with the group each Friday.', focus() {} };
    RQ.tqLine('saveOwn');
    delete inputs['tq-line-own'];
    const own = settings().supportOwn[0];
    expect(own.text).toBe('In class, I will meet with the group each Friday.');
    expect(settings().supportChosen).toEqual(['sl-sources', own.id]);
    RQ.tqLine('pickSupport', { dataset: { line: own.id } });
    expect(settings().supportFor[TERM][GAB.id]).toBe(own.id);
    html = RQ.renderTermQuestionnaire(CID);
    expect(html).toContain(
      'In class, I will meet with the group each Friday.</span><span class="qn-req-source">One of your support lines for History 12',
    );
    RQ.tqLine('pickSupport', { dataset: { line: 'none' } });
    html = RQ.renderTermQuestionnaire(CID);
    expect(html).toContain('Left out of this comment.');
    // Ava still gets the class's line.
    const f = CommentBank.facts(
      CID,
      getStudents(CID).find(s => s.id === AVA.id),
      TERM,
    );
    expect(CommentBank.context(f, {}).supportLine).toBe('In class, I will give feedback on source work each week.');
  });

  it('puts a support line picked or ticked into a comment that had none, the rest as it was (Step 4 group 2 #51)', () => {
    seed();
    upsertTermRating(CID, GAB.id, TERM, { narrative: 'Gabriel is earning a B. Thank you for a good term.' });
    open();
    RQ.tqLineChange({ dataset: { tqSupport: 'sl-sources' }, checked: true });
    expect(getStudentTermRating(CID, GAB.id, TERM).narrative).toBe(
      'Gabriel is earning a B. Thank you for a good term. In class, I will give feedback on source work each week.',
    );
    // Swapped for another line in place, not added twice.
    RQ.tqLine('writeOwn');
    inputs['tq-line-own'] = { value: 'In class, I will meet with the group each Friday.', focus() {} };
    RQ.tqLine('saveOwn');
    delete inputs['tq-line-own'];
    RQ.tqLine('pickSupport', { dataset: { line: settings().supportOwn[0].id } });
    expect(getStudentTermRating(CID, GAB.id, TERM).narrative).toBe(
      'Gabriel is earning a B. Thank you for a good term. In class, I will meet with the group each Friday.',
    );
    // An approved comment is never rewritten.
    RQ.tqLine('pickSupport', { dataset: { line: 'none' } });
    upsertTermRating(CID, GAB.id, TERM, { narrative: 'Gabriel is earning a B.', approvedAt: '2026-10-30T10:00:00Z' });
    RQ.tqLine('pickSupport', { dataset: { line: 'sl-sources' } });
    expect(getStudentTermRating(CID, GAB.id, TERM).narrative).toBe('Gabriel is earning a B.');
  });

  it('says why the Support row is empty when no ticked line fits, not that it was left out', () => {
    seed();
    // A line of the teacher's own fits no skill: ticked, it is picked only by hand.
    saveReportConfig(CID, {
      commentSettings: {
        supportOwn: [{ id: 'own-1', text: 'In class, I will meet with the group each Friday.' }],
        supportChosen: ['own-1'],
      },
    });
    const html = open();
    expect(html).toContain('None of the ticked lines fits Gabriel, so the comment leaves this sentence out.');
    expect(html).not.toContain('Left out of this comment.');
  });

  it('sets the character limit from the count; past it the count turns orange and Approve stays on', () => {
    seed();
    upsertTermRating(CID, GAB.id, TERM, { narrative: 'x'.repeat(120) });
    open();
    RQ.tqLine('limitMenu');
    const html = RQ.renderTermQuestionnaire(CID);
    expect(html).toContain('Character limit for History 12');
    expect(html).toContain('placeholder="No limit"');
    expect(html).toContain(
      'The longest comment your school’s report card allows. The count turns orange past it; Approve still works.',
    );
    RQ.tqLineChange({ dataset: { tqLimit: '1' }, value: '100' });
    expect(settings().charLimit).toBe(100);
    const st = RQ.getTqStudents()[RQ.tqStudentIndex];
    expect(RQ.approveBlockers(st)).toEqual([]);
    RQ.syncApprove();
    expect(btn.disabled).toBe(false);
    expect(btn.title).toBe('Saves this comment to the report card and opens the next student. ⌘ Return');
    // Over the limit, the count says so.
    expect(RQ.renderTermQuestionnaire(CID)).toContain(
      '<span class="qn-count-text" id="tq-count">120 of 100 characters</span><span id="tq-limit-text"> · over the limit</span>',
    );
    expect(RQ.renderTermQuestionnaire(CID)).toContain('class="qn-count-btn over"');
    RQ.tqLineChange({ dataset: { tqLimit: '1' }, value: '' });
    expect(settings().charLimit).toBeNull();
    expect(RQ.approveBlockers(st)).toEqual([]);
    RQ.closeLines();
  });
});
