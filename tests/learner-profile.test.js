/**
 * The Learner Profile's student voice (docs/STUDENT-VOICE-PLAN.md, PR 8;
 * canvas 9d): teacher/student-voice.js reads a student's questionnaire
 * answers and picks out what the profile places by name;
 * teacher/learner-profile.js draws the ID card, About Me, the student's
 * goals and Reflections. Every answer shows, blanks say "No answer", and the
 * student's words are escaped.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';

const CID = 'course-lp';
const T = id => QUESTIONNAIRE_TEMPLATES.find(t => t.id === id);

function questionnaire(id, tid, extra) {
  const t = T(tid);
  return Object.assign(
    {
      id,
      course_id: CID,
      kind: t.kind,
      title: t.title,
      theme: t.theme || null,
      template_id: tid,
      is_on: true,
      questions: t.questions.map((q, i) =>
        Object.assign(
          { id: id + '-' + (i + 1), core_ids: [], options: {}, repeated_key: null, teacher_only: false },
          q,
        ),
      ),
    },
    extra,
  );
}

function answersFor(q, byNumber) {
  const out = {};
  Object.keys(byNumber).forEach(n => {
    const v = byNumber[n];
    out[q.id + '-' + n] =
      typeof v === 'string'
        ? { num: null, text: v, json: null }
        : Array.isArray(v)
          ? { num: null, text: v.join(', '), json: v }
          : v;
  });
  return out;
}

function seed() {
  const about = questionnaire('qa', 'about-me');
  const refl = questionnaire('qr', 'core-8-1', { report_period: 1 });
  const goal = questionnaire('qg', 'goal-checkin', { parent_id: 'qr' });
  localStorage.setItem('gb-questionnaires-' + CID, JSON.stringify([about, refl, goal]));
  localStorage.setItem(
    'gb-responses-' + CID,
    JSON.stringify({
      qa: {
        e1: [
          {
            id: 'r1',
            submitted_at: '2025-09-16T18:00:00Z',
            answers: answersFor(about, {
              1: 'HAR-jote',
              2: ['English', 'Punjabi'],
              3: ['In a group'],
              4: 'Cricket <b>with</b> cousins',
              5: 'Building things',
              7: 'Study 15 min after school\n- ask when stuck',
              8: 'Tired in the mornings',
            }),
          },
        ],
      },
      qr: {
        e1: [
          {
            id: 'r2',
            submitted_at: '2025-11-07T18:00:00Z',
            answers: answersFor(refl, {
              1: { num: null, text: 'funny · family', json: ['funny', '', '', 'family'] },
              3: { num: null, text: 'x', json: { levels: { PAR: 1, PPI: 3 }, why: { PPI: 'Family is everything' } } },
            }),
          },
        ],
      },
      qg: {
        e1: [
          {
            id: 'r3',
            submitted_at: '2025-11-07T18:00:00Z',
            answers: answersFor(goal, {
              1: { num: 1, text: 'Not Started', json: null },
              2: 'study earlier',
              3: 'PAR',
              4: 'turn stuff in',
            }),
          },
        ],
      },
    }),
  );
}

describe('StudentVoice', () => {
  let originals;
  beforeEach(() => {
    localStorage.clear();
    originals = { isDemoMode: globalThis.isDemoMode };
    globalThis.isDemoMode = () => true;
    Questionnaires._reset();
    StudentVoice._reset();
    seed();
  });
  afterEach(() => {
    globalThis.isDemoMode = originals.isDemoMode;
  });

  it('gives each submission newest first, every question in order, blanks as null', () => {
    expect(StudentVoice.loaded(CID)).toBe(true);
    const list = StudentVoice.entries(CID, 'e1');
    expect(list).toHaveLength(3);
    expect(list[list.length - 1].kind).toBe('about_me');
    const about = list.find(e => e.kind === 'about_me');
    expect(about.items).toHaveLength(8);
    expect(about.items[5].v).toBeNull(); // "What is hard for me right now?" skipped
    expect(StudentVoice.entries(CID, 'someone-else')).toEqual([]);
  });

  it('picks out what the profile places by name, and keeps the rest', () => {
    const p = StudentVoice.profile(StudentVoice.entries(CID, 'e1'));
    expect(p.about.say.v.text).toBe('HAR-jote');
    expect(p.about.languages.v.json).toEqual(['English', 'Punjabi']);
    expect(p.about.learns.v.json).toEqual(['In a group']);
    expect(p.about.goal.q.repeated_key).toBe('better_at');
    expect(p.about.note.q.teacher_only).toBe(true);
    expect(p.about.rest).toHaveLength(0);
    expect(p.checkin.status.v.text).toBe('Not Started');
    expect(p.checkin.next.v.text).toBe('study earlier');
    expect(p.checkin.core.v.text).toBe('PAR');
    expect(p.checkin.coreGoal.v.text).toBe('turn stuff in');
    expect(p.checkin.coreStep.v).toBeNull();
    expect(p.reflections).toHaveLength(1);
    expect(p.last).toBe('2025-11-07T18:00:00Z');
  });
});

describe('LearnerProfile', () => {
  let originals;
  let doc;
  beforeEach(() => {
    localStorage.clear();
    originals = { isDemoMode: globalThis.isDemoMode };
    globalThis.isDemoMode = () => true;
    Questionnaires._reset();
    StudentVoice._reset();
    seed();
    doc = parseHTML('<!doctype html><html><body></body></html>').document;
  });
  afterEach(() => {
    globalThis.isDemoMode = originals.isDemoMode;
  });

  function opts() {
    const model = StudentVoice.profile(StudentVoice.entries(CID, 'e1'));
    return {
      model,
      first: 'Harjot',
      initials: 'HG',
      classLabel: 'Science 8 · Block B',
      grade: '8',
      pronouns: 'he/him',
      courseName: 'Science 8',
      aboutOn: true,
      goalCount: LearnerProfile.goalCount(model),
    };
  }
  const mount = html => {
    const box = doc.createElement('div');
    box.innerHTML = html;
    return box;
  };

  it('the ID card: the stressed part of the name in bold, languages, how they learn, jump links', () => {
    const box = mount(LearnerProfile.idCardHtml(opts()));
    expect(box.querySelector('.id-band').textContent).toBe('Science 8 · Block BGrade 8');
    expect(box.querySelector('.id-say strong').textContent).toBe('HAR');
    expect(box.querySelector('.id-say').textContent).toBe('Say it HAR-jote');
    expect([...box.querySelectorAll('.id-facts .stu-chip')].map(c => c.textContent)).toEqual(['English', 'Punjabi']);
    expect(box.textContent).toContain('In a group');
    expect([...box.querySelectorAll('.id-jump a')].map(a => a.textContent)).toEqual([
      'About Me Sep 16',
      'Goals 2 set',
      'Reflections Nov 7',
    ]);
    expect(box.querySelector('.id-private-text').textContent).toBe('Tired in the mornings');
    expect(box.querySelector('.id-private-foot').textContent).toContain('Only you see this.');
  });

  it('About Me: each answer in a bubble under its question, escaped, repeated questions tagged', () => {
    const box = mount(LearnerProfile.aboutHtml(opts()));
    expect([...box.querySelectorAll('h3')].map(h => h.textContent)).toEqual(['As a Learner', 'Outside School']);
    const bubbles = [...box.querySelectorAll('.qw-b')].map(b => b.textContent);
    expect(bubbles).toContain('Building things');
    expect(bubbles).toContain('Cricket <b>with</b> cousins');
    expect(box.querySelector('.qw-b b')).toBeNull();
    expect(box.querySelectorAll('.qw-again').length).toBe(2);
    expect(box.textContent).toContain('No answer');
  });

  it('About Me not turned on, or not answered yet, says which', () => {
    const o = opts();
    o.model = { about: null, checkin: null, reflections: [], last: null };
    expect(mount(LearnerProfile.aboutHtml(o)).textContent).toContain('Harjot hasn’t answered About Me yet.');
    o.aboutOn = false;
    expect(mount(LearnerProfile.aboutHtml(o)).textContent).toContain('About Me isn’t turned on for this class.');
  });

  it('the student’s goals: the course goal in full with its status and next step, then the Core Competency goal', () => {
    const course = mount(LearnerProfile.courseGoalHtml(opts()));
    expect(course.querySelector('h3').textContent).toBe('Science 8 Goal');
    expect(course.querySelector('.src').textContent).toBe('From Harjot');
    expect(course.querySelector('.st').textContent).toBe('Not Started');
    expect(course.textContent).toContain('What do I want to get better at in Science 8, and how?');
    expect(course.querySelector('.qw-b').textContent).toBe('Study 15 min after school\n- ask when stuck');
    expect(course.querySelector('.gl-check').textContent).toContain('Check-in · Nov 7');
    const core = mount(LearnerProfile.coreGoalHtml(opts()));
    expect(core.querySelector('.gl-title').textContent).toBe('Personal Awareness & Responsibility');
    expect(core.querySelector('.qw-b').textContent).toBe('turn stuff in');
    expect(core.querySelector('.gl-none').textContent).toBe('No answer');
  });

  it('Reflections: the shield as bubbles with blanks shown, a step and a why for each competency', () => {
    const box = mount(LearnerProfile.reflectionsHtml(opts()));
    expect(box.querySelector('.qw-head span').textContent).toBe('Nov 7 · Self-Awareness and Goal Setting');
    const shield = box.querySelectorAll('.sh-grid .qw');
    expect(shield).toHaveLength(4);
    expect(shield[0].querySelector('.qw-b').textContent).toBe('funny');
    expect(shield[1].querySelector('.gl-none').textContent).toBe('No answer');
    const cards = box.querySelectorAll('.qw-pair .gl-card');
    expect(cards[0].querySelector('.stu-core-step.on').textContent).toBe('Beginning');
    expect(cards[0].querySelector('.gl-none').textContent).toBe('No answer');
    expect(cards[1].querySelector('.stu-core-step.on').textContent).toBe('Confident');
    expect(cards[1].querySelector('.qw-b').textContent).toBe('Family is everything');
  });
});
