/**
 * The phone's new look, L5 and L6 (docs/plans/phone-look-plan.md):
 * teacher-mobile/student-look.js, the Students card and the profile.
 * With the switch off neither screen asks it for anything (card-widgets.js
 * and student-detail.js check on() first; tests/phone-return.test.js walks
 * the phone byte for byte). On, the card is the student's My Learning and
 * the profile puts the student's own words first.
 */
import './setup-mobile.js';
import { parseHTML } from 'linkedom';

const CID = 'test';
const originals = {};
const st = { id: 'stu1', firstName: 'Cece', lastName: 'Adams', preferred: '', pronouns: 'she/her', designations: [] };
const piece = (id, title, date, extra) => ({ id, title, date, type: 'summative', tagIds: ['t1'], ...extra });

function mock(overrides) {
  const mocks = {
    getStudents: () => [st],
    displayName: s => s.firstName + ' ' + s.lastName,
    displayNameFirst: s => s.firstName,
    getAssignedAssessments: () => [
      piece('a1', 'Lab One', '2026-11-01'),
      piece('a2', 'Quiz Two', '2026-11-05', { scoreMode: 'points', maxPoints: 10 }),
      piece('a3', 'Essay Three', '2026-11-09'),
      piece('a4', 'Nothing Yet', '2026-11-12'),
    ],
    assessmentCellValue: (cid, sid, a) =>
      ({
        a1: { kind: 'level', value: 3, level: 3, text: 'Proficient', status: null },
        a2: { kind: 'points', value: 8, level: 3, text: '8', status: null },
        a3: { kind: 'status', value: 0, level: 0, text: 'M', status: 'NS' },
        a4: { kind: 'none', value: 0, level: 0, text: '—', status: null },
      })[a.id],
    studentGradeSummary: () => ({ text: '3.1', level: 3 }),
    getOverallProficiency: () => 3.1,
    courseGradeMode: () => 'proficiency',
    getReturnSettings: () => ({ student_page: true }),
    getGradeReturn: (cid, sid, aid) =>
      aid === 'a1'
        ? { returned_at: '2026-11-02T10:00:00Z', seen_at: null }
        : { returned_at: '2026-11-06T10:00:00Z', seen_at: '2026-11-07T10:00:00Z' },
    ...overrides,
  };
  Object.keys(mocks).forEach(fn => {
    originals[fn] = globalThis[fn];
    globalThis[fn] = mocks[fn];
  });
}
const doc = html => parseHTML('<!doctype html><html><body>' + html + '</body></html>').document;

beforeEach(() => mock({}));
afterEach(() => {
  localStorage.removeItem('fv-build-phoneLook');
  Object.keys(originals).forEach(fn => {
    if (originals[fn] !== undefined) globalThis[fn] = originals[fn];
  });
});

describe('the switch', () => {
  it('is off unless the device has it', () => {
    expect(MStudentLook.on()).toBe(false);
    localStorage.setItem('fv-build-phoneLook', '1');
    expect(MStudentLook.on()).toBe(true);
  });
});

describe('the Students card (L5)', () => {
  it('names the student, the level in words with four bars, Observe and Profile', () => {
    const d = doc(MStudentLook.card(st, CID, ''));
    expect(d.querySelector('.m-sl-who').getAttribute('data-action')).toBe('m-all-students');
    expect(d.querySelector('.m-sl-word').textContent).toBe('Proficient');
    expect(d.querySelectorAll('.m-sl-bar.is-on').length).toBe(3);
    expect(d.querySelector('.m-sl-bar.is-now')).toBeTruthy();
    expect(d.querySelector('.m-sl-observe').getAttribute('data-action')).toBe('m-obs-quick-menu');
    expect(d.querySelector('.m-sl-profile').getAttribute('data-action')).toBe('m-student-detail');
  });

  it('a Letter class shows its letter and no bars', () => {
    mock({ courseGradeMode: () => 'letter', studentGradeSummary: () => ({ text: 'B', level: 3 }) });
    const d = doc(MStudentLook.card(st, CID, ''));
    expect(d.querySelector('.m-sl-word').textContent).toBe('B');
    expect(d.querySelector('.m-sl-bars')).toBeNull();
  });

  it('lists the newest pieces with a result, newest first, each opening the grader', () => {
    const d = doc(MStudentLook.card(st, CID, '<div class="box">To Grade</div>'));
    expect(d.querySelector('.m-sl-boxes .box')).toBeTruthy();
    const rows = [...d.querySelectorAll('.m-sl-work .m-sl-row:not(.m-sl-all)')];
    expect(rows.map(r => r.querySelector('.m-sl-row-title').textContent)).toEqual([
      'Essay Three',
      'Quiz Two',
      'Lab One',
    ]);
    expect(rows.map(r => r.querySelector('.m-sl-pill').textContent)).toEqual(['Missing', '8 / 10', 'Proficient']);
    rows.forEach(r => expect(r.getAttribute('data-action')).toBe('m-assess-grade'));
    expect(d.querySelector('.m-sl-all')).toBeNull();
  });

  it('marks what was returned and not opened since, only where the student page is on', () => {
    let d = doc(MStudentLook.card(st, CID, ''));
    expect(d.querySelector('.m-sl-unopened').textContent).toBe('1 Not Opened');
    const lab = [...d.querySelectorAll('.m-sl-row')].find(r => r.textContent.includes('Lab One'));
    expect(lab.querySelector('.m-sl-dot')).toBeTruthy();
    mock({ getReturnSettings: () => ({ student_page: false }) });
    d = doc(MStudentLook.card(st, CID, ''));
    expect(d.querySelector('.m-sl-unopened')).toBeNull();
    expect(d.querySelector('.m-sl-row .m-sl-dot')).toBeNull();
  });

  it('shows five pieces, then All N Pieces', () => {
    const many = Array.from({ length: 7 }, (_, i) => piece('p' + i, 'Piece ' + i, '2026-10-0' + (i + 1)));
    mock({
      getAssignedAssessments: () => many,
      assessmentCellValue: () => ({ kind: 'level', value: 2, level: 2, text: 'Developing', status: null }),
    });
    const d = doc(MStudentLook.card(st, CID, ''));
    expect(d.querySelectorAll('.m-sl-row:not(.m-sl-all)').length).toBe(5);
    expect(d.querySelector('.m-sl-all').textContent).toBe('All 7 Pieces');
  });
});

describe('the profile (L6)', () => {
  const q = (prompt, extra) => ({ id: prompt, prompt, kind: 'text', ...extra });
  const it_ = (text, prompt) => ({ q: q(prompt || 'x'), v: { text } });
  const base = {
    st,
    cid: CID,
    badges: '',
    answerText: (qq, v) => v.text,
    obs: [],
    allObs: [],
    obsHtml: ob => '<div class="ob">' + ob.text + '</div>',
    assessHtml: '<div class="work">work</div>',
    compsHtml: '<div class="comps">comps</div>',
  };

  it('puts what the student said first, the private note behind a tap', () => {
    const voice = {
      about: {
        at: '2026-09-16',
        say: it_('SEE-see'),
        languages: it_('English, Igbo'),
        learns: it_('With a partner'),
        goodAt: it_('Asking questions'),
        hard: it_('Finishing write-ups'),
        outside: it_('Soccer'),
        goal: it_('Hand in labs on time'),
        note: it_('Something private'),
        rest: [it_('Blue', 'Favourite colour?')],
      },
      checkin: { at: '2026-11-07', status: it_('Working On It'), next: it_('Ask for the sheet early') },
      reflections: [{ title: 'November Reflection', at: '2026-11-07', items: [it_('It went well', 'How did it go?')] }],
    };
    const d = doc(MStudentLook.profile({ ...base, voice }));
    expect(d.querySelector('.m-sl-id-line').textContent).toBe('SEE-see · she/her');
    expect([...d.querySelectorAll('.m-sl-id .m-sl-chip')].map(c => c.textContent)).toEqual([
      'English',
      'Igbo',
      'Learns Best: With a partner',
    ]);
    const note = d.querySelector('details.m-sl-note');
    expect(note.hasAttribute('open')).toBe(false);
    expect(note.querySelector('summary').textContent).toContain('A Private Note From Cece');
    expect(note.textContent).toContain('Something private');
    const heads = [...d.querySelectorAll('.m-sl-block-head h2')].map(h => h.textContent);
    expect(heads).toEqual(['Cece’s Goal', 'About Me', 'Reflections']);
    expect(d.querySelector('.m-sl-chip-status').textContent).toBe('Working On It');
    expect([...d.querySelectorAll('.m-sl-label')].map(l => l.textContent)).toEqual(
      expect.arrayContaining(['Good At', 'Hard Right Now', 'Outside School', 'Favourite colour?']),
    );
    expect(d.querySelector('details.m-sl-inline summary').textContent).toContain('November Reflection');
    const rows = [...d.querySelectorAll('.m-sl-rows details summary .m-sl-more-label')].map(s => s.textContent);
    expect(rows).toEqual(['All Work', 'Competencies']);
  });

  it('a student who has said nothing: who they are, Observe, and the rows', () => {
    const d = doc(MStudentLook.profile({ ...base, voice: null }));
    expect(d.querySelectorAll('.m-sl-block-head').length).toBe(0);
    expect(d.querySelector('.m-sl-static').textContent).toContain('None Answered');
    expect(d.querySelector('.m-sl-observe').getAttribute('data-action')).toBe('m-obs-quick-menu');
  });

  it('shows the newest observation, the rest behind All N, and open concerns', () => {
    globalThis.isOpenConcern = ob => ob.sentiment === 'concern';
    const obs = [
      { id: 'o1', text: 'Newest' },
      { id: 'o2', text: 'Older' },
    ];
    const d = doc(
      MStudentLook.profile({ ...base, voice: null, obs, allObs: [...obs, { id: 'o3', sentiment: 'concern' }] }),
    );
    const noticed = [...d.querySelectorAll('.m-sl-block')].find(b => b.textContent.includes('What You’ve Noticed'));
    expect(noticed.querySelector('.ob').textContent).toBe('Newest');
    expect(noticed.querySelector('details summary').textContent).toContain('All 2 Observations');
    expect(d.querySelector('.m-sl-chip-concern').textContent).toBe('1 Open Concern');
  });
});
