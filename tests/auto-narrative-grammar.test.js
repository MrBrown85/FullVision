/**
 * The report-card narrative generator (tqAutoNarrative). From the
 * 2026-10-16 Demo Mode test:
 *   "working at a developing level across cause. the Historical Inquiry
 *    Essay…" — a short section name, and a lowercase sentence start;
 *   "a student who are capable" — singular they conjugated as plural;
 *   two students with similar profiles got the same opening sentence.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const CID = 'course-narrative';
const TERM = 'term-1';
const NOOR = { id: 'stu-noor', firstName: 'Noor', lastName: 'Khan', pronouns: 'they/them' };
const SAM = { id: 'stu-sam', firstName: 'Sam', lastName: 'Lee', pronouns: 'they/them' };

const section = (id, tagId) => ({
  id,
  name: 'Cause and Consequence',
  shortName: 'Cause',
  tags: [{ id: tagId, label: 'Causes ' + id }],
});
const assess = (id, title, tagId) => ({ id, title, scoreMode: 'proficiency', tagIds: [tagId], type: 'summative' });
const score = (assessmentId, tagId, level) => ({ assessmentId, tagId, score: level, date: '2026-10-10' });

function seed(level, ratings = {}) {
  COURSES[CID] = { id: CID, name: 'Socials 9', gradingSystem: 'proficiency' };
  _cache.students[CID] = [NOOR, SAM];
  _cache.learningMaps[CID] = { sections: [section('sec-1', 't1'), section('sec-2', 't2')] };
  _cache.categories[CID] = [];
  _cache.assessments[CID] = [assess('a1', 'Historical Inquiry Essay', 't1'), assess('a2', 'Map Quiz', 't2')];
  const scores = [score('a1', 't1', level), score('a2', 't2', level)];
  _cache.scores[CID] = { [NOOR.id]: scores, [SAM.id]: scores.map(s => ({ ...s })) };
  _cache.statuses[CID] = {};
  _cache.overrides[CID] = {};
  _cache.courseConfigs[CID] = {};
  _cache.observations[CID] = {};
  _cache.reflections[CID] = {};
  _cache.termRatings[CID] = ratings;
  clearProfCache();
  ReportQuestionnaire.configure({ activeCourse: CID, renderReports() {} });
}

function narrative(student) {
  ReportQuestionnaire.tqAutoNarrative(student.id);
  return getStudentTermRating(CID, student.id, TERM).narrative;
}

const firstSentence = (html, name) =>
  html
    .replace(/<[^>]*>/g, ' ')
    .trim()
    .split('. ')[0]
    .split(name)
    .join('NAME');

describe('auto narrative', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    vi.restoreAllMocks();
    delete COURSES[CID];
  });

  it('names sections in full, once, and starts every sentence with a capital', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    seed(2, { [NOOR.id]: { [TERM]: { mentionAssessments: ['a1', 'a2'] } } });
    const text = narrative(NOOR);
    expect(text).toContain('working at a developing level across cause and consequence.');
    expect(text).not.toContain('across cause.');
    expect(text).toContain('The Historical Inquiry Essay and the Map Quiz were areas of difficulty');
    expect(text).not.toMatch(/[.!?] +[a-z]/);
    expect(text).not.toMatch(/ {2}/);
  });

  it('conjugates a name as singular for a they/them student', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    seed(2, { [NOOR.id]: { [TERM]: { workHabits: 4, participation: 4 } } });
    const text = narrative(NOOR);
    expect(text).toContain('Noor comes prepared every day and is always an active, thoughtful voice');
    expect(text).not.toContain('and are always');
  });

  it('says "a student who is capable", not "who are"', () => {
    // The last option everywhere: the steady closer about potential.
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    seed(3);
    const text = narrative(NOOR);
    expect(text).toContain('I see a student who is capable of more and is getting closer');
    expect(text).not.toContain('who are');
  });

  it('gives two students with the same profile different openings', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    seed(2);
    const noor = narrative(NOOR);
    const sam = narrative(SAM);
    expect(firstSentence(noor, 'Noor')).not.toBe(firstSentence(sam, 'Sam'));
  });
});

describe('_tidyNarrative', () => {
  it('capitalizes sentence starts and closes doubled spaces', () => {
    expect(ReportQuestionnaire._tidyNarrative('one.  the two! three? four')).toBe('One. The two! Three? Four');
  });

  it('leaves a quoted teacher note as written', () => {
    expect(ReportQuestionnaire._tidyNarrative('I noted: "asked a question. then helped." the end')).toBe(
      'I noted: "asked a question. then helped." The end',
    );
  });

  it('leaves decimals alone', () => {
    expect(ReportQuestionnaire._tidyNarrative('scored 85.5 / 100 on it')).toBe('Scored 85.5 / 100 on it');
  });
});

describe('_unusedOpenings', () => {
  const openings = ['Sam has had a solid term in Socials 9', 'This has been a good term for Sam in Socials 9'];

  it('drops an opening a classmate already has', () => {
    const others = [{ name: 'Noor', narrative: '<p>Noor has had a solid term in Socials 9. More.</p>' }];
    expect(ReportQuestionnaire._unusedOpenings(openings, 'Sam', others)).toEqual([openings[1]]);
  });

  it('keeps them all once every opening is taken', () => {
    const others = [
      { name: 'Noor', narrative: '<p>Noor has had a solid term in Socials 9. More.</p>' },
      { name: 'Ava', narrative: '<p>This has been a good term for Ava in Socials 9. More.</p>' },
    ];
    expect(ReportQuestionnaire._unusedOpenings(openings, 'Sam', others)).toEqual(openings);
  });
});
