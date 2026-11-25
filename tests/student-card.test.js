/**
 * The phone's Students card (docs/plans/phone-look-plan.md, L5):
 * teacher-mobile/student-card.js. The student's My Learning: the name (a tap
 * for every student), the level in words with four bars, + Observe and
 * Profile, To Grade and To Return, the newest pieces with a result, and the
 * Not Opened chip and dots.
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
    samePieceDateOrder: () => 0,
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
    if (!(fn in originals)) originals[fn] = globalThis[fn];
    globalThis[fn] = mocks[fn];
  });
}
const doc = html => parseHTML('<!doctype html><html><body>' + html + '</body></html>').document;
const card = () => doc(MStudentCard.render(st, CID));

beforeEach(() => mock({}));
afterEach(() => {
  Object.keys(originals).forEach(fn => {
    if (originals[fn] !== undefined) globalThis[fn] = originals[fn];
    delete originals[fn];
  });
});

describe('the top of the card', () => {
  it('names the student, the level in words with four bars, Observe and Profile', () => {
    const d = card();
    expect(d.querySelector('.m-sc-who').getAttribute('data-action')).toBe('m-all-students');
    // Its place in the class sits in the name row when the stack gives one.
    expect(d.querySelector('.m-sc-place')).toBeNull();
    expect(doc(MStudentCard.render(st, CID, '6 of 30')).querySelector('.m-sc-who .m-sc-place').textContent).toBe(
      '6 of 30',
    );
    expect(d.querySelector('.m-sc-name').textContent).toBe('Cece Adams');
    expect(d.querySelector('.m-sc-word').textContent).toBe('Proficient');
    expect(d.querySelectorAll('.m-sc-bar.is-on').length).toBe(3);
    expect(d.querySelector('.m-sc-bar.is-now')).toBeTruthy();
    expect(d.querySelector('.m-sc-observe').getAttribute('data-action')).toBe('m-obs-quick-menu');
    expect(d.querySelector('.m-sc-observe').textContent).toBe('+ Observe');
    expect(d.querySelector('.m-sc-profile').getAttribute('data-action')).toBe('m-student-detail');
  });

  it('a Letter class shows its letter and no bars', () => {
    mock({ courseGradeMode: () => 'letter', studentGradeSummary: () => ({ text: 'B', level: 3 }) });
    const d = card();
    expect(d.querySelector('.m-sc-word').textContent).toBe('B');
    expect(d.querySelector('.m-sc-bars')).toBeNull();
  });

  it('has none of the old widgets', () => {
    const html = MStudentCard.render(st, CID);
    ['m-wdg', 'm-scard-hero', 'm-scard-sec', 'Evidence Coverage', 'View Profile'].forEach(t =>
      expect(html).not.toContain(t),
    );
  });
});

describe('the pieces', () => {
  it('lists the pieces with a result, newest first, each opening the grader', () => {
    const rows = [...card().querySelectorAll('.m-sc-work .m-sc-row:not(.m-sc-all)')];
    expect(rows.map(r => r.querySelector('.m-sc-row-title').textContent)).toEqual([
      'Essay Three',
      'Quiz Two',
      'Lab One',
    ]);
    expect(rows.map(r => r.querySelector('.m-sc-pill').textContent)).toEqual(['Missing', '8 / 10', 'Proficient']);
    rows.forEach(r => expect(r.getAttribute('data-action')).toBe('m-assess-grade'));
    expect(card().querySelector('.m-sc-all')).toBeNull();
  });

  it('words a result the way the class shows grades, not as a level', () => {
    mock({ assessmentCellValue: () => ({ kind: 'level', value: 2.7, level: 3, text: '2.7', status: null }) });
    expect(card().querySelector('.m-sc-pill').textContent).toBe('2.7');
  });

  it('shows five pieces, then All N Pieces, which opens the profile', () => {
    const many = Array.from({ length: 7 }, (_, i) => piece('p' + i, 'Piece ' + i, '2026-10-0' + (i + 1)));
    mock({
      getAssignedAssessments: () => many,
      assessmentCellValue: () => ({ kind: 'level', value: 2, level: 2, text: 'Developing', status: null }),
    });
    const d = card();
    expect(d.querySelectorAll('.m-sc-row:not(.m-sc-all)').length).toBe(5);
    const all = d.querySelector('.m-sc-all');
    expect(all.textContent).toBe('All 7 Pieces');
    expect(all.getAttribute('data-action')).toBe('m-student-detail');
  });

  it('marks what was returned and not opened since, only where the student page is on', () => {
    let d = card();
    expect(d.querySelector('.m-sc-unopened').textContent).toBe('1 Not Opened');
    const lab = [...d.querySelectorAll('.m-sc-row')].find(r => r.textContent.includes('Lab One'));
    expect(lab.querySelector('.m-sc-dot')).toBeTruthy();
    mock({ getReturnSettings: () => ({ student_page: false }) });
    d = card();
    expect(d.querySelector('.m-sc-unopened')).toBeNull();
    expect(d.querySelector('.m-sc-row .m-sc-dot')).toBeNull();
  });

  it('a piece opened since it was returned again counts as not opened', () => {
    mock({
      getGradeReturn: (cid, sid, aid) =>
        aid === 'a2'
          ? { returned_at: '2026-11-06T10:00:00Z', updated_at: '2026-11-08T10:00:00Z', seen_at: '2026-11-07T10:00:00Z' }
          : { returned_at: '2026-11-02T10:00:00Z', seen_at: '2026-11-03T10:00:00Z' },
    });
    expect(card().querySelector('.m-sc-unopened').textContent).toBe('1 Not Opened');
  });
});

describe('To Grade and To Return', () => {
  it('puts To Grade under the buttons, ahead of the pieces', () => {
    const real = globalThis.MGradePhotos;
    globalThis.MGradePhotos = { studentListHtml: () => '<div class="m-scard-tograde">To Grade</div>' };
    try {
      const d = card();
      const boxes = d.querySelector('.m-sc-scroll > .m-sc-boxes');
      expect(boxes.querySelector('.m-scard-tograde')).toBeTruthy();
      expect(boxes.nextElementSibling.className).toBe('m-sc-work');
    } finally {
      globalThis.MGradePhotos = real;
    }
  });

  it('lists a draft with its grade, "can’t see it yet" and Return', () => {
    const real = globalThis.MGrade;
    globalThis.MGrade = { studentDrafts: () => [piece('a1', 'Lab One', '2026-11-01')] };
    try {
      const d = card();
      const row = d.querySelector('.m-scard-return-row');
      expect(row.querySelector('.m-scard-return-title').textContent).toBe('Lab One');
      expect(row.querySelector('.m-scard-return-text').textContent).toContain('Cece can’t see it yet');
      expect(row.querySelector('[data-action="m-card-return"]').getAttribute('data-aid')).toBe('a1');
    } finally {
      globalThis.MGrade = real;
    }
  });

  it('leaves the box out when there is nothing to grade or return', () => {
    expect(card().querySelector('.m-sc-boxes')).toBeNull();
  });
});
