/**
 * The Term Questionnaire's review screen (teacher/report-questionnaire.js,
 * fullvision-generate-plan PR 11a): the header's grade, At a Glance's
 * best piece, not-handed-in work and skill tags, the Voice rows, and the
 * page drawn for a Demo Mode student with the old controls gone.
 */
import './setup.js';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const RQ = ReportQuestionnaire;

describe('standingWord', () => {
  it('gives the Letter Grades Order word for each letter, nothing for IE or F', () => {
    expect(['A', 'B', 'C+', 'C', 'C-', 'IE', 'F', ''].map(RQ.standingWord)).toEqual([
      'Excellent',
      'Very good',
      'Good',
      'Satisfactory',
      'Minimally acceptable',
      '',
      '',
      '',
    ]);
  });
});

describe('bestPiece', () => {
  it('is the highest-marked piece, the latest when two tie, none without work', () => {
    const work = [
      { title: 'Lab 1', v: 3.5, d: '2026-09-10' },
      { title: 'Quiz', v: 4, d: '2026-09-20' },
      { title: 'Lab 2', v: 4, d: '2026-10-01' },
    ];
    expect(RQ.bestPiece(work).title).toBe('Lab 2');
    expect(RQ.bestPiece([])).toBeNull();
  });
});

describe('skillTags', () => {
  it('marks every competency at the top level Strongest and the lowest Next step', () => {
    const comps = [
      { id: 'a', level: 4 },
      { id: 'b', level: 4 },
      { id: 'c', level: 3 },
      { id: 'd', level: 2.7 },
      { id: 'e', level: 2.7 },
    ];
    expect(RQ.skillTags(comps)).toEqual({ a: 'Strongest', b: 'Strongest', d: 'Next step' });
  });
  it('tags nothing when every level is the same, or with one competency', () => {
    expect(RQ.skillTags([{ id: 'a', level: 3 }])).toEqual({});
    expect(
      RQ.skillTags([
        { id: 'a', level: 3 },
        { id: 'b', level: 3 },
      ]),
    ).toEqual({});
  });
});

describe('voiceRows', () => {
  const item = text => ({ v: { text } });
  it('lists the goal, then the About Me answers with their labels; the note is private', () => {
    const f = {
      voice: {
        goalStatus: 'On track',
        profile: {
          checkin: { coreGoal: item('Ask more questions') },
          about: {
            goodAt: item('Labs'),
            hard: item('Deadlines'),
            goal: item('Writing conclusions'),
            learns: item('With a partner'),
            note: item('My grandma is sick.'),
          },
        },
      },
    };
    const rows = RQ.voiceRows(f);
    expect(rows.map(r => [r.label, r.text])).toEqual([
      ['Goal', '“Ask more questions” · On track'],
      ['Good at', 'Labs'],
      ['Hard right now', 'Deadlines'],
      ['Wants to get better at', 'Writing conclusions'],
      ['Learns best', 'With a partner'],
      ['To you only', 'My grandma is sick.'],
    ]);
    expect(rows[5].priv).toBe(true);
    expect(rows[1].quote).toBe(true);
    expect(rows[4].quote).toBe(false);
  });
  it('shows only Goal, Not set yet, when nothing has come from the phone', () => {
    const rows = RQ.voiceRows({ voice: { profile: null, goalStatus: '' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ label: 'Goal', text: '', empty: 'Not set yet' });
  });
});

describe('Demo Mode (Science 8, Report 2)', () => {
  let cid, saved, hadDoc, oldDoc;
  beforeAll(() => {
    saved = window.isDemoMode;
    window.isDemoMode = () => true;
    localStorage.clear();
    runInThisContext(readFileSync('shared/seed-data.js', 'utf-8'), { filename: 'shared/seed-data.js' });
    seedIfNeeded();
    cid = 'sci8';
    setActiveTerm(cid, 2);
    hadDoc = 'document' in globalThis;
    oldDoc = globalThis.document;
    // The page reads the report picker's label through the document.
    globalThis.document = { getElementById: () => null, querySelectorAll: () => [] };
    RQ.configure({ activeCourse: cid, renderReports: () => {} });
  });
  afterAll(() => {
    if (hadDoc) globalThis.document = oldDoc;
    else delete globalThis.document;
    setActiveTerm(cid, null);
    window.isDemoMode = saved;
    localStorage.clear();
  });
  const cece = () => getStudents(cid).find(s => s.firstName === 'Cece');

  it('headerGrade: the level and the proficiency word in a Proficiency class, with the count', () => {
    const st = cece();
    const f = CommentBank.facts(cid, st, 'term-2');
    const g = RQ.headerGrade(cid, st.id, f);
    expect(g.big).toMatch(/^\d\.\d$/);
    expect(g.small).toMatch(/^(Emerging|Developing|Proficient|Extending) · \d+ of \d+ assignments$/);
    expect(g.small).toContain(f.record.handed + ' of ' + f.record.total + ' assignments');
  });

  it('headerGrade: the letter and percent with the standing word in a Letter class', () => {
    const st = cece();
    const was = COURSES[cid].gradingSystem;
    COURSES[cid].gradingSystem = 'letter';
    try {
      const f = CommentBank.facts(cid, st, 'term-2');
      const g = RQ.headerGrade(cid, st.id, f);
      expect(g.big).toMatch(/^[A-F][+-]? · \d+(\.\d)?%$/);
      const letter = g.big.split(' · ')[0];
      expect(g.small.split(' · ')[0]).toBe(RQ.standingWord(letter));
    } finally {
      COURSES[cid].gradingSystem = was;
    }
  });

  it('notHandedIn agrees with the record the comment counts', () => {
    const st = cece();
    const f = CommentBank.facts(cid, st, 'term-2');
    expect(RQ.notHandedIn(cid, st.id)).toHaveLength(f.record.missing);
  });

  it('draws the review screen: header, habits grid, At a Glance, Voice, comment, attendance; no bank', () => {
    const st = cece();
    RQ.tqStudentIndex = RQ.getTqStudents().findIndex(s => s.id === st.id);
    const html = RQ.renderTermQuestionnaire(cid);
    expect(html).toContain('Cece Adeyemi');
    expect(html).toContain('Student Dashboard ›');
    expect(html).toContain('data-href="/student?id=' + st.id + '&course=' + cid + '"');
    expect(html).toContain('Work Habits');
    expect((html.match(/role="radio"/g) || []).length).toBe(30);
    expect(html).toContain('Comes Ready, Uses Class Time');
    expect(html).toContain('At a Glance');
    expect(html).toContain('Best piece');
    expect(html).toContain('Not handed in');
    expect(html).toContain('Cece’s Voice');
    expect(html).toContain('Questionnaires ›');
    expect(html).toContain('Teacher Comment');
    expect(html).toContain('Generate Comment');
    expect(html).toContain('id="tq-narrative"');
    expect(html).toMatch(/\d+ characters/);
    expect(html).toContain('⌘⇧C');
    expect(html).toContain('Classes Absent');
    expect(html).toContain('Times Late');
    expect(html).toContain('Optional. Left out until entered.');
    expect(html).toContain('The Sentences card (PR 11b) goes here.');
    expect(html).not.toContain('Comment Bank');
    expect(html).not.toContain('What FullVision Has');
    expect(html).not.toContain('Save and Next');
    expect(html).not.toContain('MyEd');
  });

  it('a student with nothing from the phone shows Goal · Not set yet only', () => {
    const jas = getStudents(cid).find(s => s.firstName === 'Jasper');
    RQ.tqStudentIndex = RQ.getTqStudents().findIndex(s => s.id === jas.id);
    const html = RQ.renderTermQuestionnaire(cid);
    expect(html).toContain('Not set yet');
    expect(html).not.toContain('Good at');
    expect(html).not.toContain('>Private<');
  });

  it('the sources sheet names every part on the screen without MyEd or pronouns', () => {
    expect(RQ.SCREEN_SOURCES.map(r => r[0])).toEqual([
      'Grade',
      'Work Habits',
      'Best Piece',
      'Not Handed In',
      'Skills',
      'Goal and Voice',
      'Attendance',
      'Teacher Comment',
    ]);
    RQ.SCREEN_SOURCES.forEach(r => {
      expect(r[1]).not.toMatch(/MyEd|\bhis\b|\bher\b|\btheir\b/);
      expect(['FullVision', 'You', 'Student']).toContain(r[2]);
    });
  });
});
