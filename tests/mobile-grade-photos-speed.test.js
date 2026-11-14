/**
 * The phone grader's pictures, counted (docs/plans/speed-assessment.md,
 * section 7, P1).
 *
 * The grader asked for the full-size page of every student's every page
 * when it opened, for a 188 px strip, and asked again for a card's pages
 * each time the card was drawn again. Now only the card on screen and the
 * one each side are filled at first, the rest when the cards stop on them,
 * and a card drawn again keeps the pictures it had. The strip still shows
 * the full page, so it is as sharp as before: the pinned strip's thumbnail
 * stands in until the page is in. Full screen shows the strip's pages
 * again, with no new request.
 *
 * The fixture: 25 students, each with two pages sent on Lab.
 */
import './setup-mobile.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { U, seedClass, clearClass } from './helpers/pin-save-paths.js';

const CID = U(1);
const LAB = U(31);
const Q = U(41);
const N = 25;
const S = Array.from({ length: N }, (_, i) => U(101 + i));
let wasDemo;
let stubDocument;
let asked;
let win;

function sub(sid, n) {
  return {
    id: 'w' + n,
    assessment_id: LAB,
    enrollment_id: sid,
    version: 1,
    state: 'sent',
    sent_by: 'student',
    on_paper: false,
    note: null,
    sent_at: '2026-11-03T18:00:00Z',
    created_at: '2026-11-03T18:00:00Z',
    files: [1, 2].map(p => ({
      id: 'f' + n + 'p' + p,
      page: p,
      path: 'w' + n + '-' + p + '.jpg',
      thumb_path: 'w' + n + '-' + p + '-t.jpg',
    })),
  };
}

function seed() {
  seedClass(CID, {
    students: S.map((id, i) => ({ id, firstName: 'Kid' + String(i).padStart(2, '0'), lastName: 'Son' })),
    learningMaps: {
      subjects: [],
      sections: [{ id: U(51), name: 'Light', tags: [{ id: Q, label: 'Refraction', text: 'Bend light' }] }],
      _customized: true,
      _version: 1,
      _flatVersion: 2,
    },
    assessments: [{ id: LAB, title: 'Lab', tagIds: [Q], date: '2026-11-03' }],
    courseConfigs: { student_page_enabled: true },
  });
  saveDemoStudentWork(CID, {
    course: { send_work: true },
    assessments: [{ id: LAB, students_send: 'photos' }],
    submissions: S.map((sid, i) => sub(sid, i)),
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
  win = dom.window;
}

const settle = () => new Promise(r => setTimeout(r, 0));
const pages = () => asked.filter(a => a.which === 'page').length;
const thumbs = () => asked.filter(a => a.which === 'thumb').length;
const swiper = () => document.getElementById('m-swiper');
const card = i => swiper().children[i];
const shown = el => [...el.querySelectorAll('img[data-fv-page]')].filter(img => img.getAttribute('src')).length;

function openGrader() {
  // html-safe: MGrade.renderSwiper escapes names and text; a test page
  document.getElementById('m-nav-stack').innerHTML = MGrade.renderSwiper(CID, LAB);
  MGrade.setupSwiper(CID, LAB);
}

beforeEach(() => {
  wasDemo = window.isDemoMode;
  window.isDemoMode = () => true;
  localStorage.clear();
  stubDocument = globalThis.document;
  phonePage();
  seed();
  asked = [];
  vi.spyOn(globalThis, 'openStudentWorkPage').mockImplementation((cid, file, which) => {
    asked.push({ id: file.id, which });
    return Promise.resolve({ url: 'blob:' + which + ':' + file.id, release() {} });
  });
});
afterEach(() => {
  // The pictures are let go once they leave the page, as when the screen closes.
  document.getElementById('m-nav-stack').innerHTML = '';
  document.getElementById('m-sheet-container').innerHTML = '';
  MGradePhotos.releaseUnused();
  vi.restoreAllMocks();
  globalThis.document = stubDocument;
  clearClass(CID);
  localStorage.clear();
  window.isDemoMode = wasDemo;
});

describe('the phone grader’s pictures', () => {
  it('opening asks for the first card and its neighbour only: 4 full pages and 4 thumbnails', async () => {
    openGrader();
    await settle();
    expect(swiper().children.length).toBe(N);
    // Before: 100 requests, 50 full pages and 50 thumbnails. Now: two cards × two pages, each page and its thumbnail.
    expect(asked.length).toBe(8);
    expect(pages()).toBe(4);
    expect(thumbs()).toBe(4);
    expect(new Set(asked.map(a => a.which + a.id)).size).toBe(8);
    expect(shown(card(0))).toBe(4); // the strip's two pages and the pinned strip's two
    expect(shown(card(1))).toBe(4);
    expect(shown(card(2))).toBe(0);
  });

  it('the card on screen shows full pages in its strip, thumbnails only in the pinned strip', async () => {
    openGrader();
    await settle();
    const strip = [...card(0).querySelectorAll('.m-work-page img')].map(img => img.getAttribute('src'));
    expect(strip).toEqual(['blob:page:f0p1', 'blob:page:f0p2']);
    const pin = [...card(0).querySelectorAll('.m-work-pin img')].map(img => img.getAttribute('src'));
    expect(pin).toEqual(['blob:thumb:f0p1', 'blob:thumb:f0p2']);
    expect(card(1).querySelector('.m-work-page img').getAttribute('src')).toBe('blob:page:f1p1');
  });

  it('the thumbnail stands in until the full page is in, with no request of its own', async () => {
    const later = [];
    openStudentWorkPage.mockImplementation((cid, file, which) => {
      asked.push({ id: file.id, which });
      const page = { url: 'blob:' + which + ':' + file.id, release() {} };
      if (which === 'thumb') return Promise.resolve(page);
      return new Promise(r => later.push(() => r(page)));
    });
    openGrader();
    await settle();
    const img = card(0).querySelector('.m-work-page img');
    expect(img.getAttribute('src')).toBe('blob:thumb:f0p1');
    later.forEach(go => go());
    await settle();
    expect(img.getAttribute('src')).toBe('blob:page:f0p1');
    expect(card(0).querySelector('.m-work-pin img').getAttribute('src')).toBe('blob:thumb:f0p1');
    expect(asked.length).toBe(8);
  });

  it('a full page in before its thumbnail is not swapped back', async () => {
    const later = [];
    openStudentWorkPage.mockImplementation((cid, file, which) => {
      asked.push({ id: file.id, which });
      const page = { url: 'blob:' + which + ':' + file.id, release() {} };
      if (which === 'page') return Promise.resolve(page);
      return new Promise(r => later.push(() => r(page)));
    });
    openGrader();
    await settle();
    later.forEach(go => go());
    await settle();
    expect(card(0).querySelector('.m-work-page img').getAttribute('src')).toBe('blob:page:f0p1');
    expect(card(0).querySelector('.m-work-pin img').getAttribute('src')).toBe('blob:thumb:f0p1');
  });

  it('a card further on is filled when the cards stop there', async () => {
    openGrader();
    await settle();
    const sw = swiper();
    Object.defineProperty(sw, 'clientWidth', { value: 300, configurable: true });
    sw.scrollLeft = 300 * 10;
    sw.dispatchEvent(new win.Event('scroll'));
    await new Promise(r => setTimeout(r, 150));
    await settle();
    expect(shown(card(10))).toBe(4);
    expect(shown(card(9))).toBe(4);
    expect(shown(card(11))).toBe(4);
    expect(shown(card(5))).toBe(0);
    // Three more cards × two pages, each page and its thumbnail.
    expect(pages()).toBe(4 + 6);
    expect(thumbs()).toBe(4 + 6);
    expect(card(10).querySelector('.m-work-page img').getAttribute('src')).toBe('blob:page:f10p1');
  });

  it('a card drawn again keeps its pictures, with no new request', async () => {
    openGrader();
    await settle();
    const before = asked.length;
    const old = card(0);
    // As _refreshCard does: the card swapped for a fresh copy, then filled.
    old.outerHTML = old.outerHTML.replace(/ src="[^"]*"/g, '');
    MGradePhotos.hydrate(card(0), CID);
    await settle();
    expect(asked.length).toBe(before);
    expect(shown(card(0))).toBe(4);
    expect(card(0).querySelector('.m-work-page img').getAttribute('src')).toBe('blob:page:f0p1');
  });

  it('full screen shows the pages the strip already has, with no new request', async () => {
    openGrader();
    await settle();
    const before = asked.length;
    MGradePhotos.openFull(CID, card(0).querySelector('.m-work-full'));
    await settle();
    expect(asked.length).toBe(before);
    const sheet = [...document.querySelectorAll('#m-sheet-container .m-work-sheet-page')];
    expect(sheet.map(img => img.getAttribute('src'))).toEqual(['blob:page:f0p1', 'blob:page:f0p2']);
  });

  it('a page with no thumbnail shows the page in the strip', async () => {
    const work = getStudentSubmission(CID, S[0], LAB);
    saveDemoStudentWork(CID, {
      course: { send_work: true },
      assessments: [{ id: LAB, students_send: 'photos' }],
      submissions: [{ ...work, files: work.files.map(f => ({ ...f, thumb_path: null })) }],
    });
    openGrader();
    await settle();
    expect(shown(card(0))).toBe(4); // the strip and the pinned strip share each page’s address
    expect(asked.filter(a => a.which === 'page').map(a => a.id)).toEqual(['f0p1', 'f0p2']);
  });
});
