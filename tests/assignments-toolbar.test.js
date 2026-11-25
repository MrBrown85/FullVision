/**
 * The Assignments toolbar, option C "Three Things" (teacher/assign-toolbar.js;
 * Colin, Nov 25): Search with Filter in its end, Show, a chip for each filter,
 * ⋯ and + New Assessment with its ▾. What each part draws, by the page's state;
 * Show's own rules are in tests/assignments-show-bar.test.js, the layout in
 * e2e/assignments-toolbar.spec.js.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { U, seedClass, clearClass, click, key, openAssignments, closePages } from './helpers/pin-save-paths.js';

const CID = U(1);
const LABS = U(61);
const QUIZZES = U(62);
const A1 = U(31);
const A2 = U(32);
const Q = U(41);
let wasDemo;

// Send Work on and a draft waiting, so Show has its options.
function seedWork() {
  seed({ student_page_enabled: true, return_grades: 'on_return' });
  saveDemoStudentWork(CID, {
    course: { send_work: true },
    assessments: [{ id: A1, students_send: 'photos' }],
    submissions: [],
  });
}

function seed(config = {}) {
  seedClass(CID, {
    students: [{ id: U(11), firstName: 'Ava', lastName: 'Adams' }],
    learningMaps: {
      subjects: [],
      sections: [{ id: U(51), name: 'Question', tags: [{ id: Q, label: 'Question', text: 'Ask' }] }],
      _customized: true,
      _version: 1,
      _flatVersion: 2,
    },
    categories: [
      { id: LABS, name: 'Labs & Investigations', weight: 50, displayOrder: 0 },
      { id: QUIZZES, name: 'Quizzes', weight: 50, displayOrder: 1 },
    ],
    assessments: [
      { id: A1, title: 'Density Lab', tagIds: [Q], date: '2026-10-10', categoryId: LABS },
      { id: A2, title: 'Unit Quiz', tagIds: [Q], date: '2026-10-11', categoryId: QUIZZES },
    ],
    courseConfigs: config,
  });
}

const bar = () => document.querySelector('.assess-toolbar');
const moreItems = () =>
  Array.from(document.querySelectorAll('.atb-more-wrap .assess-menu-item')).map(b => b.textContent.trim());
const newItems = () =>
  Array.from(document.querySelectorAll('.atb-new .assess-menu-item')).map(b => b.textContent.trim());
const chips = () => Array.from(document.querySelectorAll('.atb-chip')).map(c => c.textContent.trim());
const cardIds = () => Array.from(document.querySelectorAll('#main .assess-card')).map(c => c.id.slice(3));
const settled = () => new Promise(r => setTimeout(r, 10));

beforeEach(() => {
  wasDemo = window.isDemoMode;
  window.isDemoMode = () => true;
  localStorage.clear();
  AssignList.setView(false);
});
afterEach(() => {
  closePages();
  clearClass(CID);
  localStorage.clear();
  AssignList.setView(false);
  window.isDemoMode = wasDemo;
});

describe('the bar', () => {
  it('draws Search with Filter inside it, Show, then ⋯ and + New Assessment, and no old control', async () => {
    openAssignments(() => seed({ student_page_enabled: true }), CID);
    await settled();
    const parts = Array.from(bar().children).map(el => el.className.split(' ')[0]);
    // After the class picker (and a section toggle where the course has sections).
    expect(parts[0]).toBe('class-picker');
    expect(parts.slice(-4)).toEqual(['atb-search', 'atb-show-slot', 'atb-chips', 'atb-end']);
    const filter = bar().querySelector('.atb-search .atb-filter-btn');
    expect(filter.getAttribute('aria-label')).toBe('Filter');
    expect(filter.getAttribute('title')).toBe('Filter');
    // An icon only: no label, no count.
    expect(filter.textContent).toBe('');
    expect(bar().querySelector('.atb-end > .assess-menu-wrap [aria-label="More"]')).not.toBeNull();
    expect(bar().querySelector('.atb-new [data-action="showNewForm"]').textContent).toBe('+ New Assessment');
    expect(bar().querySelector('[aria-label="More Ways to Add"]')).not.toBeNull();
    // Nothing of the old bar is left.
    expect(
      bar().querySelector(
        '.assess-filter-btn, .assess-view-seg, .assess-seg-control, .assess-toolbar-actions, .assess-to-return-btn, .seg-sm',
      ),
    ).toBeNull();
    expect(bar().textContent).not.toMatch(/Filter ·/);
  });

  it('puts Show on the standard .seg, not .seg-sm', async () => {
    openAssignments(seedWork, CID);
    await settled();
    const show = bar().querySelector('.atb-show');
    expect(show.classList.contains('seg')).toBe(true);
    expect(show.classList.contains('seg-sm')).toBe(false);
  });
});

describe('Filter and its chips', () => {
  it('has the categories and Ungraded Only, and a chip for each filter that is on', async () => {
    openAssignments(() => seed(), CID);
    await settled();
    const menu = () =>
      Array.from(document.querySelectorAll('.assess-filter-menu .assess-filter-item')).map(b => b.textContent);
    expect(menu()).toEqual(['Labs & Investigations', 'Quizzes', 'Ungraded Only', 'Clear Filters']);
    expect(chips()).toEqual([]);
    expect(bar().querySelector('.atb-filter-btn').classList.contains('has-filters')).toBe(false);
    click(document.querySelector('.assess-filter-menu [data-catid="' + LABS + '"]'));
    expect(chips()).toEqual(['Labs & Investigations']);
    expect(cardIds()).toEqual([A1]);
    expect(bar().querySelector('.atb-filter-btn').classList.contains('has-filters')).toBe(true);
    click(document.querySelector('.assess-filter-menu [data-action="toggleUngraded"]'));
    expect(chips()).toEqual(['Labs & Investigations', 'Ungraded Only']);
  });

  it('a chip’s × takes its filter off; Clear Filters takes them all off', async () => {
    openAssignments(() => seed(), CID);
    await settled();
    click(document.querySelector('.assess-filter-menu [data-catid="' + LABS + '"]'));
    click(document.querySelector('.assess-filter-menu [data-catid="' + QUIZZES + '"]'));
    click(document.querySelector('.assess-filter-menu [data-action="toggleUngraded"]'));
    expect(chips()).toEqual(['Labs & Investigations', 'Quizzes', 'Ungraded Only']);
    click(document.querySelector('.atb-chip[data-catid="' + LABS + '"]'));
    expect(chips()).toEqual(['Quizzes', 'Ungraded Only']);
    click(document.querySelector('.atb-chip[data-action="toggleUngraded"]'));
    expect(chips()).toEqual(['Quizzes']);
    expect(document.querySelector('.atb-chip').getAttribute('aria-label')).toBe('Remove Filter: Quizzes');
    click(document.querySelector('.assess-filter-menu [data-action="clearFilterMenu"]'));
    expect(chips()).toEqual([]);
    expect(cardIds().sort()).toEqual([A1, A2].sort());
  });

  it('opens and closes as the old menu did: the button, a click outside, Escape', async () => {
    openAssignments(() => seed(), CID);
    await settled();
    const wrap = () => document.querySelector('.atb-search');
    const button = () => document.querySelector('.atb-filter-btn');
    click(button());
    expect(wrap().classList.contains('open')).toBe(true);
    expect(button().getAttribute('aria-expanded')).toBe('true');
    // Ticking keeps it open.
    click(document.querySelector('.assess-filter-menu [data-catid="' + LABS + '"]'));
    expect(wrap().classList.contains('open')).toBe(true);
    click(document.getElementById('main'));
    expect(wrap().classList.contains('open')).toBe(false);
    click(button());
    key(document.body, 'Escape');
    expect(wrap().classList.contains('open')).toBe(false);
  });
});

describe('the ⋯ menu', () => {
  it('in the Grade view: Expand All and Bulk Edit, then Rubrics; Collapse All appears once a card is open', async () => {
    openAssignments(() => seed(), CID);
    await settled();
    expect(moreItems()).toEqual(['Expand All', 'Bulk Edit', 'Rubrics']);
    expect(document.querySelectorAll('.atb-more-wrap .assess-menu-sep').length).toBe(1);
    click(document.querySelector('#ac-' + A1 + ' .assess-header'));
    expect(moreItems()).toEqual(['Expand All', 'Collapse All', 'Bulk Edit', 'Rubrics']);
    click(document.querySelector('.atb-more-wrap [data-action="expandAllAssess"]'));
    expect(moreItems()).toEqual(['Collapse All', 'Bulk Edit', 'Rubrics']);
    click(document.querySelector('.atb-more-wrap [data-action="collapseAllAssess"]'));
    expect(moreItems()).toEqual(['Expand All', 'Bulk Edit', 'Rubrics']);
  });

  it('in Bulk Edit it holds Rubrics alone, and Done Editing returns to the Grade view', async () => {
    openAssignments(() => seed(), CID);
    await settled();
    click(document.querySelector('.atb-more-wrap [data-alv-view="list"]'));
    expect(AssignList.on()).toBe(true);
    expect(moreItems()).toEqual(['Rubrics']);
    const done = document.querySelector('.atb-end > [data-alv-view="cards"]');
    expect(done.textContent).toBe('Done Editing');
    expect(done.className).toBe('tb-action-btn tb-action-secondary');
    click(done);
    expect(AssignList.on()).toBe(false);
    expect(document.querySelector('.atb-end > [data-alv-view="cards"]')).toBeNull();
  });

  it('is a menu of the page’s own kind: .assess-menu with .assess-menu-item, closed to begin with', async () => {
    openAssignments(() => seed(), CID);
    await settled();
    const menu = document.querySelector('.atb-more-wrap .assess-menu');
    expect(menu.hidden).toBe(true);
    expect(menu.getAttribute('role')).toBe('menu');
    expect(document.querySelector('[data-atb="more"]').getAttribute('aria-haspopup')).toBe('menu');
  });
});

describe('the ▾ menu', () => {
  it('holds New Quiz where quizzes are on, and is not drawn with nothing to hold', async () => {
    localStorage.setItem('fv-build-quizzes', '1');
    openAssignments(() => seed({ student_page_enabled: true }), CID);
    await settled();
    expect(newItems()[0]).toBe('New Quiz');
    expect(document.querySelector('[data-atb="new"]').getAttribute('aria-label')).toBe('More Ways to Add');
    closePages();
    clearClass(CID);
    openAssignments(() => seed({}), CID);
    await settled();
    expect(newItems().includes('New Quiz')).toBe(false);
    if (!newItems().length) {
      expect(document.querySelector('[data-atb="new"]')).toBeNull();
      expect(document.querySelector('.atb-new').classList.contains('atb-split')).toBe(false);
    }
  });
});

describe('a card’s category pill', () => {
  it('is a button; pressing it filters to its category and leaves the card as it was', async () => {
    openAssignments(() => seed(), CID);
    await settled();
    const pill = aid => document.querySelector('#ac-' + aid + ' .type-badge');
    expect(pill(A1).tagName).toBe('BUTTON');
    expect(pill(A1).getAttribute('aria-pressed')).toBe('false');
    expect(pill(A1).getAttribute('data-action')).toBe('toggleCategoryFilter');
    expect(document.getElementById('ac-' + A1).classList.contains('open')).toBe(false);
    click(pill(A1));
    expect(chips()).toEqual(['Labs & Investigations']);
    expect(cardIds()).toEqual([A1]);
    // It did not open the card, and the pill shows pressed.
    expect(document.getElementById('ac-' + A1).classList.contains('open')).toBe(false);
    expect(pill(A1).getAttribute('aria-pressed')).toBe('true');
    // The same toggle: pressed again, the filter is off.
    click(pill(A1));
    expect(chips()).toEqual([]);
    expect(cardIds().sort()).toEqual([A1, A2].sort());
  });

  it('leaves .type-badge as it was on the grader’s heading (a span)', async () => {
    const src = (await import('node:fs')).readFileSync(new URL('../teacher/styles.css', import.meta.url), 'utf-8');
    expect(src).toContain('.type-badge {');
    const css = (await import('node:fs')).readFileSync(new URL('../teacher/assignments.css', import.meta.url), 'utf-8');
    // The button look is scoped to the cards' meta line.
    expect(css).toContain('.assess-meta button.type-badge');
    expect(css).not.toMatch(/^button\.type-badge/m);
  });
});
