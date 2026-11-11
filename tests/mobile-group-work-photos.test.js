/**
 * S12 follow-up: the phone grader shows a group's photos on each member's
 * card (as the desktop grader does since PR 1078).
 *
 * On a One per Group piece one member sends for the group. The phone's
 * speed grader drew the work from the student's own submission only, so
 * the pair's card (graded together) showed no photos, and a member graded
 * separately whose group-mate sent showed "Not In" with Add Work. Now each
 * card reads the group's work (getGroupWorkFiles, through
 * MGradePhotos.work), and the pair is still one card and one in To Grade.
 *
 * The fixture: five students. Aiden and Olivia are a pair on Light Lab
 * (One per Group); Aiden sent two pages for both. Ines sent her own. Tom
 * and Uma sent nothing.
 */
import './setup-mobile.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { U, seedClass, clearClass } from './helpers/pin-save-paths.js';

const CID = U(1);
const LAB = U(31);
const Q = U(41);
const NAMES = ['Aiden', 'Olivia', 'Ines', 'Tom', 'Uma'];
const S = NAMES.map((_, i) => U(101 + i));
const [AIDEN, OLIVIA, INES] = S;
let wasDemo;
let stubDocument;

function sub(sid, n, pages, note) {
  return {
    id: 'w' + n,
    assessment_id: LAB,
    enrollment_id: sid,
    version: 1,
    state: 'sent',
    sent_by: 'student',
    on_paper: false,
    note: note || null,
    sent_at: '2026-11-03T18:00:00Z',
    created_at: '2026-11-03T18:00:00Z',
    files: Array.from({ length: pages }, (_, i) => ({
      id: 'f' + n + 'p' + (i + 1),
      page: i + 1,
      path: 'w' + n + '-' + (i + 1) + '.jpg',
      thumb_path: 'w' + n + '-' + (i + 1) + '-t.jpg',
      sha256: 'h' + n + i,
    })),
  };
}

function seed({ groupWork = 'group' } = {}) {
  seedClass(CID, {
    students: S.map((id, i) => ({ id, firstName: NAMES[i], lastName: String.fromCharCode(65 + i) + 'son' })),
    learningMaps: {
      subjects: [],
      sections: [{ id: U(51), name: 'Light', tags: [{ id: Q, label: 'Refraction', text: 'Bend light' }] }],
      _customized: true,
      _version: 1,
      _flatVersion: 2,
    },
    assessments: [
      { id: LAB, title: 'Light Lab', tagIds: [Q], date: '2026-11-03', collaboration: 'pair', pairs: [[AIDEN, OLIVIA]] },
    ],
    courseConfigs: { student_page_enabled: true, return_grades: 'on_return' },
  });
  saveDemoStudentWork(CID, {
    course: { send_work: true },
    assessments: [{ id: LAB, students_send: 'photos', group_work: groupWork }],
    submissions: [sub(AIDEN, 1, 2, 'Page 2 has the table.'), sub(INES, 2, 1)],
  });
}

function phonePage() {
  const dom = parseHTML(
    '<!DOCTYPE html><html><body><div id="m-nav-stack"></div>' +
      '<div id="m-sheet-backdrop" class="u-hidden"></div><div id="m-sheet-container"></div>' +
      '<div id="m-toast"></div></body></html>',
  );
  dom.window.HTMLElement.prototype.scrollTo = function () {};
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  globalThis.document = dom.document;
}
const stack = () => document.getElementById('m-nav-stack');
function grading(opts) {
  // html-safe: MGrade.renderSwiper escapes names and text; a test page
  stack().innerHTML = MGrade.renderSwiper(CID, LAB, opts);
  return [...stack().querySelectorAll('.m-swiper-card')];
}
const pages = card => card.querySelectorAll('.m-work-pages img[data-fv-page]').length;
const line = card => {
  const el = card.querySelector('.m-work-sent span');
  return el ? el.textContent : null;
};
const lab = () => getAssessments(CID).find(a => a.id === LAB);

beforeEach(() => {
  wasDemo = window.isDemoMode;
  window.isDemoMode = () => true;
  localStorage.clear();
  stubDocument = globalThis.document;
  phonePage();
});
afterEach(() => {
  globalThis.document = stubDocument;
  clearClass(CID);
  localStorage.clear();
  window.isDemoMode = wasDemo;
});

describe('the speed grader on a One per Group pair', () => {
  it('the pair is one card in To Grade, and it shows the pair’s pages', () => {
    seed();
    expect(MGradePhotos.toGradeCount(CID, lab())).toBe(GraderWork.workCounts(CID, LAB).tograde);
    expect(MGradePhotos.toGradeCount(CID, lab())).toBe(2);
    const cards = grading({ only: 'tograde' });
    expect(cards.length).toBe(2);
    const pair = cards[0];
    expect(pages(pair)).toBe(2);
    expect(line(pair)).toBe('Sent by Aiden A. for the group, Nov 3 · 2 photos');
    expect(pair.querySelector('.m-work-note').textContent).toContain('Page 2 has the table.');
    expect(pages(cards[1])).toBe(1);
  });

  it('a member graded separately sees the pages a group-mate sent, not Not In', () => {
    seed();
    Grader.gradeSeparately(CID, LAB, OLIVIA);
    expect(MGradePhotos.toGradeCount(CID, lab())).toBe(GraderWork.workCounts(CID, LAB).tograde);
    const cards = grading();
    const olivia = cards.find(c =>
      c.querySelector('.m-work[data-sid="' + OLIVIA + '"], .m-work-notin[data-sid="' + OLIVIA + '"]'),
    );
    expect(olivia).toBeTruthy();
    expect(olivia.querySelector('.m-work-notin')).toBeNull();
    expect(olivia.querySelector('.m-work-add')).toBeNull();
    expect(pages(olivia)).toBe(2);
    expect(line(olivia)).toBe('Sent by Aiden A. for the group, Nov 3 · 2 photos');
  });

  it('the full-screen sheet shows every page of the group’s work', () => {
    seed();
    Grader.gradeSeparately(CID, LAB, OLIVIA);
    grading();
    const box = stack().querySelector('.m-work[data-sid="' + OLIVIA + '"]');
    MGradePhotos.openFull(CID, box);
    expect(document.querySelectorAll('#m-sheet-container .m-work-sheet-page').length).toBe(2);
    MComponents.dismissSheet();
  });

  it('the pictures are asked for from the group’s pages', async () => {
    seed();
    Grader.gradeSeparately(CID, LAB, OLIVIA);
    const asked = [];
    const real = globalThis.openStudentWorkPage;
    globalThis.openStudentWorkPage = (cid, f, which) => {
      asked.push(f && f.id);
      return Promise.resolve({ url: '/x.jpg', release() {} });
    };
    try {
      grading();
      MGradePhotos.hydrate(stack().querySelector('.m-work[data-sid="' + OLIVIA + '"]').parentNode, CID);
      await new Promise(r => setTimeout(r, 0));
      expect(asked).toEqual(expect.arrayContaining(['f1p1', 'f1p2']));
    } finally {
      globalThis.openStudentWorkPage = real;
    }
  });

  it('on Each Student the pair card shows nothing and Olivia is Not In, as before', () => {
    seed({ groupWork: 'each' });
    expect(MGradePhotos.work(CID, OLIVIA, LAB)).toBeNull();
    const pair = grading()[0];
    expect(pair.querySelector('.m-work')).toBeNull();
  });

  it('Mark Up on a group-mate’s card reaches the group’s second page', () => {
    seed();
    expect(MMarkUp.can(CID, LAB, OLIVIA, 1)).toBe(true);
    expect(MMarkUp.can(CID, LAB, OLIVIA, 2)).toBe(false);
  });
});
