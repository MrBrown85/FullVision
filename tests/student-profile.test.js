/**
 * The phone's student profile (docs/plans/phone-look-plan.md, L6):
 * teacher-mobile/student-detail.js. The student's own words first: who they
 * are, the private note behind a tap, the goal, About Me, What You've
 * Noticed, Reflections, then All Work and Competencies. And the two small
 * surprises: the student's words quoted over a new note, and an open
 * concern closed in one tap.
 */
import './setup-mobile.js';
import { parseHTML } from 'linkedom';
import { vi } from 'vitest';

const CID = 'test';
const st = { id: 'stu1', firstName: 'Cece', lastName: 'Adams', preferred: '', pronouns: 'she/her', designations: [] };
const originals = {};
const realVoice = globalThis.StudentVoice;
const realQuestionnaires = globalThis.Questionnaires;

function mock(overrides) {
  const mocks = {
    getStudents: () => [st],
    displayName: s => s.firstName + ' ' + s.lastName,
    displayNameFirst: s => s.firstName,
    getAssignmentStatuses: () => ({}),
    getAssignedAssessments: () => [],
    getSections: () => [],
    getGroupedSections: () => ({ groups: [], ungrouped: [] }),
    getStudentQuickObs: () => [],
    getActiveTerm: () => null,
    isStudentFlagged: () => false,
    ...overrides,
  };
  Object.keys(mocks).forEach(fn => {
    if (!(fn in originals)) originals[fn] = globalThis[fn];
    globalThis[fn] = mocks[fn];
  });
}

const q = (prompt, extra) => ({ id: prompt, prompt, kind: 'text', ...extra });
const item = (text, prompt, extra) => ({ q: q(prompt || 'x', extra), v: { text } });

/* The class's questionnaires and the student's answers. `entries` is what
   StudentVoice.entries gives; `profile` is the real one, which sorts them. */
function voice(entries, questionnaires) {
  globalThis.StudentVoice = {
    loaded: () => true,
    load: () => {},
    entries: () => entries,
    profile: realVoice.profile,
  };
  globalThis.Questionnaires = {
    list: () => questionnaires || [],
    status: realQuestionnaires.status,
  };
}
const aboutMe = (items, at) => ({ qid: 'about', kind: 'about_me', title: 'About Me', at: at || '2026-09-16', items });
const render = () =>
  parseHTML('<!doctype html><html><body>' + MStudents.renderDetail(CID, 'stu1') + '</body></html>').document;
const heads = d => [...d.querySelectorAll('.m-sp-head h2')].map(h => h.textContent);

beforeEach(() => {
  clearProfCache();
  globalThis.COURSES = { test: { id: 'test', name: 'Test Course', calcMethod: 'mostRecent', decayWeight: 0.65 } };
  mock({});
});
afterEach(() => {
  Object.keys(originals).forEach(fn => {
    if (originals[fn] !== undefined) globalThis[fn] = originals[fn];
    delete originals[fn];
  });
  globalThis.StudentVoice = realVoice;
  globalThis.Questionnaires = realQuestionnaires;
  vi.restoreAllMocks();
});

describe('who they are', () => {
  it('shows how to say the name with the stressed syllable bold, pronouns, chips and + Observe', () => {
    voice([
      aboutMe([
        { q: q('How do I say your name?'), v: { text: 'SEE-see' } },
        { q: q('Languages', { kind: 'choice', options: { other: true } }), v: { text: 'English, Igbo' } },
        {
          q: q('How do you learn best?', { kind: 'choice', options: { multiple: false } }),
          v: { text: 'with a partner' },
        },
      ]),
    ]);
    const d = render();
    expect(d.querySelector('.m-sp-line').innerHTML).toBe('<b>SEE</b>-see · she/her');
    expect([...d.querySelectorAll('.m-sp-who .m-sp-chip')].map(c => c.textContent)).toEqual([
      'English',
      'Igbo',
      'Learns Best With a Partner',
    ]);
    expect(d.querySelector('.m-sp-observe').textContent).toBe('+ Observe');
  });

  it('shows each designation, Flagged and the open concerns as chips', () => {
    mock({
      getStudents: () => [{ ...st, designations: ['G'] }],
      isStudentFlagged: () => true,
      getStudentQuickObs: () => [{ id: 'c1', text: 'x', sentiment: 'concern', created: '2026-11-20T10:00:00Z' }],
    });
    voice([]);
    const chips = [...render().querySelectorAll('.m-sp-who .m-sp-chips')[0].children].map(c => c.textContent.trim());
    expect(chips).toEqual(['G ' + BC_DESIGNATIONS.G.name, 'IEP', 'Flagged', '1 Open Concern ›']);
  });

  it('does not carry To Grade, the grade or tabs', () => {
    voice([]);
    const html = MStudents.renderDetail(CID, 'stu1');
    ['m-scard-tograde', 'm-hero', 'm-st-tab', 'Grade Newest'].forEach(t => expect(html).not.toContain(t));
  });
});

describe('what they said', () => {
  const full = () =>
    voice(
      [
        {
          qid: 'check',
          kind: 'goal_checkin',
          title: 'Goal Check-In',
          at: '2026-11-07',
          items: [
            { q: q('How is your goal going?', { kind: 'goal_status' }), v: { text: 'Working On It' } },
            item('Ask for the sheet early', 'What is your next step?'),
          ],
        },
        aboutMe([
          { q: q('Good at', { repeated_key: 'good_at' }), v: { text: 'Asking questions' } },
          { q: q('Hard', { repeated_key: 'hard' }), v: { text: 'Finishing write-ups' } },
          { q: q('Better at', { repeated_key: 'better_at' }), v: { text: 'Hand in labs on time' } },
          { q: q('What do you do outside school?'), v: { text: 'Soccer' } },
          { q: q('Note to teacher', { teacher_only: true }), v: { text: 'Something private' } },
          item('Blue', 'Favourite colour?'),
        ]),
        {
          qid: 'nov',
          kind: 'core_reflection',
          title: 'November Reflection',
          at: '2026-11-07',
          items: [item('It went well', 'How did it go?')],
        },
      ],
      [
        { id: 'check', title: 'Goal Check-In', is_on: true },
        { id: 'about', title: 'About Me', is_on: true },
        { id: 'nov', title: 'November Reflection', is_on: true },
        { id: 'unit2', title: 'Unit 2 Exit Reflection', is_on: true },
        { id: 'off', title: 'A Reflection That Is Off', is_on: false },
      ],
    );

  it('goes in the board’s order: goal, About Me, Reflections, then the two rows', () => {
    full();
    const d = render();
    expect(heads(d)).toEqual(['Cece’s Goal', 'About Me', 'Reflections']);
    expect(d.querySelector('.m-sp-chip-status').textContent).toBe('Working On It');
    expect([...d.querySelectorAll('.m-sp-label')].map(l => l.textContent)).toEqual(
      expect.arrayContaining(['Good At', 'Hard Right Now', 'Outside School', 'Favourite colour?']),
    );
    const rows = [...d.querySelectorAll('.m-sp-rows .m-sp-row-label')].map(s => s.textContent);
    expect(rows).toEqual(['All Work', 'Competencies']);
  });

  it('keeps the private note behind a tap, and out of Reflections', () => {
    full();
    const d = render();
    const note = d.querySelector('details.m-sp-note');
    expect(note.hasAttribute('open')).toBe(false);
    expect(note.querySelector('summary').textContent).toContain('A Private Note From Cece');
    expect(note.textContent).toContain('Something private');
    const refl = [...d.querySelectorAll('.m-sp-card')].find(c => c.textContent.startsWith('Reflections'));
    expect(refl.textContent).not.toContain('Something private');
  });

  it('lists each reflection: an answered one opens in place, one not answered says so, one that is off is left out', () => {
    full();
    const refl = [...render().querySelectorAll('.m-sp-card')].find(c => c.textContent.startsWith('Reflections'));
    const labels = [...refl.querySelectorAll('.m-sp-row-label')].map(l => l.textContent);
    expect(labels).toEqual(['Goal Check-In', 'About Me', 'November Reflection', 'Unit 2 Exit Reflection']);
    const open = [...refl.querySelectorAll('details.m-sp-row')].find(r => r.textContent.startsWith('November'));
    expect(open.textContent).toContain('It went well');
    const flat = [...refl.querySelectorAll('.m-sp-flat')];
    expect(flat.map(f => f.textContent)).toEqual(['Unit 2 Exit ReflectionNot Answered']);
  });

  it('long answers are cut at five lines: a clamp with a More that shows only when they run long', () => {
    full();
    const d = render();
    const answers = d.querySelectorAll('.m-sp-answer');
    expect(answers.length).toBeGreaterThan(0);
    answers.forEach(a => {
      expect(a.querySelector('.m-sp-bubble > .m-sp-clamp')).toBeTruthy();
      expect(a.querySelector('.m-sp-more').textContent).toBe('More');
      expect(a.classList.contains('is-long')).toBe(false);
    });
  });
});

describe('a student who has said nothing', () => {
  it('has who they are, Observe and the rows; Reflections is one row that says None Answered', () => {
    voice([], []);
    const d = render();
    expect(heads(d)).toEqual([]);
    expect(d.querySelector('.m-sp-flat').textContent).toContain('None Answered');
    expect(d.querySelector('.m-sp-observe')).toBeTruthy();
    expect([...d.querySelectorAll('.m-sp-rows .m-sp-row-label')].map(s => s.textContent)).toEqual([
      'Reflections',
      'All Work',
      'Competencies',
    ]);
  });

  it('opens that row to the reflections waiting', () => {
    voice([], [{ id: 'nov', title: 'November Reflection', is_on: true }]);
    const row = render().querySelector('details.m-sp-tag-row');
    expect(row.querySelector('summary').textContent).toContain('None Answered');
    expect(row.textContent).toContain('November Reflection');
  });

  it('leaves Reflections out until the answers have loaded', () => {
    globalThis.StudentVoice = { loaded: () => false, load: () => {}, entries: () => [], profile: realVoice.profile };
    const d = render();
    expect(d.querySelector('.m-sp-flat')).toBeNull();
    expect(d.querySelector('.m-sp-observe')).toBeTruthy();
  });
});

describe('what you’ve noticed', () => {
  it('shows the newest observation, then All N behind a row', () => {
    voice([]);
    mock({
      getStudentQuickObs: () => [
        { id: 'o1', text: 'Newest', created: '2026-11-20T10:00:00Z' },
        { id: 'o2', text: 'Older', created: '2026-11-10T10:00:00Z' },
      ],
    });
    const d = render();
    const card = [...d.querySelectorAll('.m-sp-card')].find(c => c.textContent.includes('What You’ve Noticed'));
    expect(card.querySelector('.m-obs-text').textContent).toBe('Newest');
    const row = card.querySelector('details.m-sp-row');
    expect(row.querySelector('summary').textContent).toContain('All 2 Observations');
    expect(row.textContent).toContain('Older');
  });
});

describe('the student’s own words over a new note', () => {
  it('quotes what is hard right now, else what they are good at, else outside school', () => {
    voice([
      aboutMe([
        { q: q('Good at', { repeated_key: 'good_at' }), v: { text: 'Drawing' } },
        { q: q('Hard', { repeated_key: 'hard' }), v: { text: 'Finishing write-ups' } },
      ]),
    ]);
    expect(MStudentDetail.wordsFor(CID, 'stu1')).toEqual({
      label: 'Hard Right Now',
      day: 'Sep 16',
      text: 'Finishing write-ups',
    });
    voice([aboutMe([{ q: q('Good at', { repeated_key: 'good_at' }), v: { text: 'Drawing' } }])]);
    expect(MStudentDetail.wordsFor(CID, 'stu1').label).toBe('Good At');
    voice([]);
    expect(MStudentDetail.wordsFor(CID, 'stu1')).toBeNull();
  });
});

describe('an open concern, closed in one tap', () => {
  const concern = { id: 'c1', text: 'Missed two deadlines', created: '2026-11-20T10:00:00Z', sentiment: 'concern' };

  it('the sheet shows the concern with Called Home, Spoke With Student, Still Happening and Resolved', () => {
    mock({ getStudentQuickObs: () => [concern, { id: 'n1', text: 'A strength', sentiment: 'strength' }] });
    const d = parseHTML(
      '<!doctype html><html><body>' + MStudentDetail.concernsSheetHtml(CID, 'stu1') + '</body></html>',
    ).document;
    expect(d.body.textContent).toContain('Missed two deadlines');
    expect(d.body.textContent).not.toContain('A strength');
    const buttons = [...d.querySelectorAll('.m-sp-concern-btn')];
    expect(buttons.map(b => b.textContent)).toEqual([
      'Called Home',
      'Spoke With Student',
      'Still Happening',
      'Resolved',
    ]);
    expect(buttons.map(b => b.getAttribute('data-kind'))).toEqual([
      'called_home',
      'spoke_with_student',
      'still_happening',
      'resolved',
    ]);
    buttons.forEach(b => expect(b.getAttribute('data-obid')).toBe('c1'));
  });

  it('a tap adds that follow-up with the existing write, closes the sheet and offers Undo', () => {
    const added = vi.fn(() => ({ id: 'fu1' }));
    const removed = vi.fn();
    const realAdd = globalThis.addObservationFollowUp;
    const realRemove = globalThis.deleteObservationFollowUp;
    globalThis.addObservationFollowUp = added;
    globalThis.deleteObservationFollowUp = removed;
    const dismiss = vi.spyOn(MComponents, 'dismissSheet').mockImplementation(() => {});
    const toast = vi.spyOn(MComponents, 'showToast').mockImplementation(() => {});
    MStudentDetail.followUp(CID, 'stu1', 'c1', 'resolved');
    expect(added).toHaveBeenCalledWith(CID, 'c1', 'resolved', '');
    expect(dismiss).toHaveBeenCalled();
    expect(toast.mock.calls[0][0]).toBe('Resolved');
    toast.mock.calls[0][1].onUndo();
    expect(removed).toHaveBeenCalledWith(CID, 'c1', 'fu1');
    globalThis.addObservationFollowUp = realAdd;
    globalThis.deleteObservationFollowUp = realRemove;
  });
});
