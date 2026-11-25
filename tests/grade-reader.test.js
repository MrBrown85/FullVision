/**
 * Full Screen scoring on the phone grader (docs/plans/phone-look-plan.md, L4):
 * teacher-mobile/grade-reader.js on Demo Mode's Light Refraction Lab, which
 * has work waiting. The paper on a black page, one white bar with one
 * criterion, its track and a dot for each criterion; the dots become a strip
 * of the levels given once every criterion is scored, and the bar takes
 * For Revision and Return and Next. Every score is the card's own write.
 */
import './setup-mobile.js';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { newBankIndex } from './helpers/bc-bank-fixture.js';

const CID = 'sci8';
const LIGHT = 'sci8a21';
let wasDemo;
let stubDocument;
let sid;

function seedDemo() {
  window.isDemoMode = () => true;
  Object.keys(COURSES).forEach(cid => _clearCourseLocalState(cid));
  localStorage.clear();
  CURRICULUM_INDEX = newBankIndex(['SCI8']);
  seedIfNeeded();
  setStudentPageSwitch(CID, true, 'on_return');
  const work = getCourseSubmissions(CID);
  work.course.send_work = true;
  saveDemoStudentWork(CID, work);
}

function page() {
  const dom = parseHTML(
    '<!DOCTYPE html><html><body><div id="m-nav-stack"></div>' +
      '<div id="m-sheet-backdrop" class="u-hidden"></div><div id="m-sheet-container"></div>' +
      '<div id="m-toast"></div></body></html>',
  );
  dom.window.HTMLElement.prototype.scrollTo = function () {};
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  dom.window.HTMLElement.prototype.focus = function () {};
  globalThis.document = dom.document;
}

const reader = () => document.getElementById('m-reader');
const bar = () => reader().querySelector('.m-reader-bar');
const tap = el => MGradeReader.onClick({ target: el });
const track = value => bar().querySelector('.m-score-btns [data-score="' + value + '"]');
const dots = () => [...bar().querySelectorAll('.m-reader-dot')];
const chips = () => [...bar().querySelectorAll('.m-reader-chip')];

beforeAll(() => {
  wasDemo = window.isDemoMode;
  runInThisContext(readFileSync('shared/seed-data.js', 'utf-8'), { filename: 'shared/seed-data.js' });
});
afterAll(() => {
  window.isDemoMode = wasDemo;
  CURRICULUM_INDEX = null;
  localStorage.clear();
});
beforeEach(() => {
  stubDocument = globalThis.document;
  page();
  seedDemo();
  // The first student with work waiting and no grade yet.
  const a = getAssessments(CID).find(x => x.id === LIGHT);
  sid = MGradePhotos.toGrade(CID, a)[0];
  // html-safe: MGrade.renderSwiper escapes names and text; a test page
  document.getElementById('m-nav-stack').innerHTML = MGrade.renderSwiper(CID, LIGHT, { only: 'tograde' });
  MGrade.setupSwiper(CID, LIGHT);
  vi.useFakeTimers();
});
afterEach(() => {
  MGradeReader.close();
  vi.useRealTimers();
  globalThis.document = stubDocument;
});

const crits = () => getRubricById(CID, getAssessments(CID).find(a => a.id === LIGHT).rubricId).criteria;

describe('Full Screen', () => {
  it('opens on the paper, with a close, the name, Mark Up and one bar', () => {
    const files = MGradePhotos.work(CID, sid, LIGHT).files;
    MGradePhotos.openFull(CID, document.querySelector('.m-swiper-card[data-sid="' + sid + '"] .m-work'));
    expect(reader().getAttribute('role')).toBe('dialog');
    expect(reader().querySelectorAll('.m-reader-page')).toHaveLength(files.length);
    expect(reader().querySelector('[data-action="m-reader-close"]').getAttribute('aria-label')).toBe('Close');
    expect(reader().querySelector('.m-reader-name').textContent).toBe(
      displayName(getStudents(CID).find(s => s.id === sid)),
    );
    expect(reader().querySelector('[data-action="m-markup-open"]').getAttribute('data-sid')).toBe(sid);
    // One criterion, its track in the class's order, and a dot for each criterion.
    expect(bar().querySelector('.m-crit-name').textContent).toBe(crits()[0].name);
    expect([...bar().querySelectorAll('.m-score-btns .m-score-btn')].map(b => b.textContent)).toEqual(
      levelOrderFor(CID).map(lv => levelCode(lv)),
    );
    expect(dots()).toHaveLength(crits().length);
    expect(dots()[0].classList.contains('is-current')).toBe(true);
    expect(chips()).toHaveLength(0);
  });

  it('a level is the card’s own write, and the bar moves on to the next criterion unscored', () => {
    MGradePhotos.openFull(CID, document.querySelector('.m-swiper-card[data-sid="' + sid + '"] .m-work'));
    const spy = vi.spyOn(Grader, 'setLevelOnPhone');
    tap(track(3));
    expect(spy.mock.calls[0].slice(0, 6)).toEqual([CID, sid, LIGHT, rubricCriterionScoreKeys(crits()[0])[0], 3, 0]);
    // The tapped level fills at once; the bar moves on a moment later.
    expect(track(3).classList.contains('m-score-active')).toBe(true);
    vi.advanceTimersByTime(300);
    expect(bar().querySelector('.m-crit-name').textContent).toBe(crits()[1].name);
    expect(dots()[0].getAttribute('data-level')).toBe('3');
    expect(dots()[1].classList.contains('is-current')).toBe(true);
    // The card under it has the level too.
    const card = document.querySelector('.m-swiper-card[data-sid="' + sid + '"]');
    expect(
      card
        .querySelector('.m-crit-group[data-critid="' + crits()[0].id + '"] .m-score-active')
        .getAttribute('data-score'),
    ).toBe('3');
  });

  it('− and + show once a level is chosen, and a dot goes back to its criterion', () => {
    MGradePhotos.openFull(CID, document.querySelector('.m-swiper-card[data-sid="' + sid + '"] .m-work'));
    expect(bar().querySelector('.m-mod-btn')).toBeNull();
    tap(track(2));
    expect(bar().querySelectorAll('.m-mod-btn')).toHaveLength(2);
    tap(bar().querySelector('.m-mod-btn[data-mod="1"]'));
    expect(bar().querySelector('.m-score-active').textContent).toBe('DEV +');
    vi.advanceTimersByTime(300);
    tap(dots()[0]);
    expect(bar().querySelector('.m-crit-name').textContent).toBe(crits()[0].name);
  });

  it('once every criterion is scored the dots become a strip of levels, with the bar’s buttons', () => {
    MGradePhotos.openFull(CID, document.querySelector('.m-swiper-card[data-sid="' + sid + '"] .m-work'));
    crits().forEach((c, i) => {
      tap(track(i % 2 ? 4 : 3));
      vi.advanceTimersByTime(300);
    });
    expect(dots()).toHaveLength(0);
    expect(chips().map(c => c.textContent)).toEqual(crits().map((c, i) => (i % 2 ? 'EXT' : 'PRF')));
    expect(chips()[0].getAttribute('data-level')).toBe('3');
    expect(bar().querySelector('.m-reader-act .m-grade-return-btn').textContent).toMatch(/^Return and (Next|Finish)$/);
    // A chip goes back to its criterion, outlined.
    tap(chips()[1]);
    expect(chips()[1].classList.contains('is-current')).toBe(true);
    expect(bar().querySelector('.m-crit-name').textContent).toBe(crits()[1].name);
  });

  it('Return and Next closes Full Screen first, and the close button closes it', () => {
    MGradePhotos.openFull(CID, document.querySelector('.m-swiper-card[data-sid="' + sid + '"] .m-work'));
    tap(reader().querySelector('[data-action="m-reader-close"]'));
    expect(reader()).toBeNull();
    MGradePhotos.openFull(CID, document.querySelector('.m-swiper-card[data-sid="' + sid + '"] .m-work'));
    crits().forEach(() => {
      tap(bar().querySelector('.m-score-btns [data-score="3"]'));
      vi.advanceTimersByTime(300);
    });
    tap(bar().querySelector('.m-reader-act [data-action="m-grade-return-next"]'));
    expect(reader()).toBeNull();
  });
});
