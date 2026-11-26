/**
 * The Gradebook's toolbar and filter panel (teacher/gradebook-toolbar.js;
 * Colin, Nov 25: Search with Filter in its end, Show, a chip for each filter,
 * ⋯ and + New Assessment). What each part draws, by the page's state; the
 * layout, the keys and the point to preview are in e2e/gradebook-toolbar.spec.js.
 */
import './setup.js';
import { afterEach, describe, expect, it } from 'vitest';
import { mount, unmount, click, key, fire } from './helpers/gradebook-dom.js';
import { seedClass, clearClass } from './helpers/pin-save-paths.js';

const CID = 'cT';
const SECS = ['S1', 'S2', 'S3', 'S4'];

// Four competencies: two in the folder "Inquiry", one in "Analysis", one in no folder.
function seed() {
  seedClass(CID, {
    students: [{ id: 's1', firstName: 'Ava', lastName: 'Adams' }],
    categories: [
      { id: 'c1', name: 'Labs', weight: 50, displayOrder: 0 },
      { id: 'c2', name: 'Quizzes', weight: 50, displayOrder: 1 },
    ],
    modules: [{ id: 'm1', name: 'Cells', color: '#ec4899' }],
    assessments: SECS.map((s, i) => ({
      id: 'a' + i,
      title: 'Piece ' + i,
      scoreMode: 'points',
      maxPoints: 10,
      tagIds: [s],
      date: '2026-10-1' + i,
      categoryId: i % 2 ? 'c2' : 'c1',
      moduleId: i < 2 ? 'm1' : '',
    })),
    learningMaps: {
      subjects: [],
      competencyGroups: [
        { id: 'g1', name: 'Inquiry', sortOrder: 0 },
        { id: 'g2', name: 'Analysis', sortOrder: 1 },
      ],
      sections: [
        {
          id: 'S1',
          name: 'Questioning',
          shortName: 'Questioning',
          groupId: 'g1',
          color: '#2563eb',
          tags: [{ id: 'S1', label: 'Q', text: 'q' }],
        },
        {
          id: 'S2',
          name: 'Predicting',
          shortName: 'Predicting',
          groupId: 'g1',
          color: '#2563eb',
          tags: [{ id: 'S2', label: 'P', text: 'p' }],
        },
        {
          id: 'S3',
          name: 'Evaluating',
          shortName: 'Evaluating',
          groupId: 'g2',
          color: '#2563eb',
          tags: [{ id: 'S3', label: 'E', text: 'e' }],
        },
        {
          id: 'S4',
          name: 'Sharing',
          shortName: 'Sharing',
          color: '#2563eb',
          tags: [{ id: 'S4', label: 'S', text: 's' }],
        },
      ],
      _customized: true,
      _version: 1,
      _flatVersion: 2,
    },
  });
}

const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));
const chips = () => $$('.atb-chip').map(c => c.textContent.trim());
const checked = sel => $(sel).getAttribute('aria-checked');
const openPanel = () => click($('.atb-filter-btn'));
const cols = () => $$('#gb-data tr:first-child td.gb-scores-cell').length;

afterEach(() => {
  unmount();
  clearClass(CID);
});

describe('the bar', () => {
  it('draws Search with Filter inside it, no Show without work, ⋯ with Print Grades and Export, and + New Assessment', () => {
    mount(seed, { course: CID });
    const bar = $('.gb-toolbar');
    expect(bar.querySelector('.atb-search .atb-field .atb-filter-btn')).not.toBeNull();
    expect($('.atb-filter-btn').getAttribute('aria-label')).toBe('Filter');
    expect($('.atb-filter-btn').getAttribute('title')).toBe('Filter');
    expect($('.atb-show')).toBeNull();
    expect($('.atb-chips')).toBeNull();
    expect($$('.atb-more-wrap .assess-menu-item').map(b => b.textContent.trim())).toEqual(['Print Grades', 'Export']);
    // Each with its icon first, as a card's ⋯ menu has.
    expect(
      $$('.atb-more-wrap .assess-menu-item').map(b => [
        b.firstElementChild.tagName.toLowerCase(),
        b.firstElementChild.getAttribute('aria-hidden'),
      ]),
    ).toEqual([
      ['svg', 'true'],
      ['svg', 'true'],
    ]);
    expect($('.atb-more-wrap [data-action="toggleCardMenu"]').getAttribute('aria-label')).toBe('More');
    expect($('.atb-end [data-href]').textContent).toBe('+ New Assessment');
    // The old pill, Filters button and strip are gone.
    expect($('.gb-work-pill, .gb-filter-trigger, .gb-filter-strip')).toBeNull();
  });

  it('draws no panel until Filter is pressed, and not the strip that pushed the grid down', () => {
    mount(seed, { course: CID });
    expect($('.gbf-panel')).toBeNull();
    expect($('.atb-filter-btn').getAttribute('aria-expanded')).toBe('false');
    openPanel();
    expect($('.gbf-panel')).not.toBeNull();
    expect($('.atb-filter-btn').getAttribute('aria-expanded')).toBe('true');
    expect($('#gb-filter-strip')).toBeNull();
  });

  it('shows × while the box holds a search, and it clears it', () => {
    mount(seed, { course: CID });
    expect($('.gb-search-clear')).toBeNull();
    const box = $('.gb-search-input');
    box.value = 'zzz';
    fire(box, 'input');
    expect($('.gb-search-clear').getAttribute('aria-label')).toBe('Clear Search');
    click($('.gb-search-clear'));
    expect($('.gb-search-input').value).toBe('');
  });
});

describe('Show', () => {
  const counts = (c, show = 'all', avail = false) => ({
    show,
    avail,
    counts: { tograde: 0, toreturn: 0, questions: 0, ...c },
  });
  const labels = html => Array.from(html.matchAll(/<span class="atb-lab" data-t="([^"]+)"/g)).map(m => m[1]);

  it('is drawn when one option has a count, with All; each option only when its count is above 0', () => {
    expect(GradebookToolbar.showHtml(counts({}))).toBe('');
    expect(labels(GradebookToolbar.showHtml(counts({ tograde: 4 })))).toEqual(['All', 'To Grade']);
    expect(labels(GradebookToolbar.showHtml(counts({ toreturn: 2, questions: 1 })))).toEqual([
      'All',
      'To Return',
      'Questions',
    ]);
  });

  it('where something could wait it stays in the page, hidden, with All alone; where nothing could it is not drawn', () => {
    expect(GradebookToolbar.showHtml(counts({}, 'all', false))).toBe('');
    const html = GradebookToolbar.showHtml(counts({}, 'all', true));
    expect(html).toMatch(/^<div class="seg atb-show" role="group" aria-label="Show" hidden>/);
    expect(labels(html)).toEqual(['All']);
    // With an option waiting it is on screen.
    expect(GradebookToolbar.showHtml(counts({ tograde: 1 }, 'all', true))).not.toContain(' hidden>');
    // The first option to arrive is one button inserted into it, and the bar shows.
    mount(seed, { course: CID });
    $('#main').innerHTML = '<div class="gb-toolbar">' + html + '</div>';
    expect($('.atb-show').hasAttribute('hidden')).toBe(true);
    expect(GradebookToolbar.syncShow(counts({ toreturn: 2 }, 'all', true))).toBe(true);
    expect($('.atb-show').hasAttribute('hidden')).toBe(false);
    expect($$('.atb-show [data-show]').map(b => b.dataset.show)).toEqual(['all', 'toreturn']);
    // The last one to go hides it again.
    expect(GradebookToolbar.syncShow(counts({}, 'all', true))).toBe(true);
    expect($('.atb-show').hasAttribute('hidden')).toBe(true);
    expect($$('.atb-show [data-show]').map(b => b.dataset.show)).toEqual(['all']);
  });

  it('keeps a pressed option while its count is 0, and presses it', () => {
    const html = GradebookToolbar.showHtml(counts({ questions: 0 }, 'questions'));
    expect(labels(html)).toEqual(['All', 'Questions']);
    const pressed = Array.from(html.matchAll(/aria-pressed="(true|false)"[^>]*data-show="(\w+)"/g)).map(
      m => m[2] + ':' + m[1],
    );
    expect(pressed).toEqual(['all:false', 'questions:true']);
  });

  it('badges: To Grade and Questions blue, To Return amber, each with its count and title', () => {
    const html = GradebookToolbar.showHtml(counts({ tograde: 4, toreturn: 2, questions: 1 }));
    expect(html).toContain('atb-badge atb-badge-blue" data-n="tograde">4<');
    expect(html).toContain('atb-badge atb-badge-amber" data-n="toreturn">2<');
    expect(html).toContain('atb-badge atb-badge-blue" data-n="questions">1<');
    expect(html).toContain('title="Show only the students and assessments with work waiting to grade."');
    expect(html).toContain('title="Show only the students and assessments with a draft to return."');
    expect(html).toContain('title="Show only the students and assessments with a question waiting for you."');
  });

  it('follows the counts in place; an option comes or goes alone, in its place', () => {
    mount(seed, { course: CID });
    const show = state =>
      ($('#main').innerHTML = '<div class="gb-toolbar">' + GradebookToolbar.showHtml(state) + '</div>');
    const drawn = () => $$('.atb-show [data-show]').map(b => b.dataset.show);
    show(counts({ tograde: 4, toreturn: 2 }));
    expect(GradebookToolbar.syncShow(counts({ tograde: 3, toreturn: 2 }))).toBe(true);
    expect($('[data-n="tograde"]').textContent).toBe('3');
    // An option comes: it is drawn where the full bar draws it.
    expect(GradebookToolbar.syncShow(counts({ tograde: 3, toreturn: 2, questions: 1 }))).toBe(true);
    expect(drawn()).toEqual(['all', 'tograde', 'toreturn', 'questions']);
    expect(GradebookToolbar.syncShow(counts({ tograde: 3, questions: 1 }))).toBe(true);
    expect(drawn()).toEqual(['all', 'tograde', 'questions']);
    expect(GradebookToolbar.syncShow(counts({ toreturn: 5, tograde: 3, questions: 1 }))).toBe(true);
    expect(drawn()).toEqual(['all', 'tograde', 'toreturn', 'questions']);
    // The same bar the page draws whole.
    expect($('.atb-show').outerHTML).toBe(GradebookToolbar.showHtml(counts({ toreturn: 5, tograde: 3, questions: 1 })));
    // The bar itself comes or goes with the draw: the page swaps it.
    expect(GradebookToolbar.syncShow(counts({}))).toBe(false);
    $('#main').innerHTML = '';
    expect(GradebookToolbar.syncShow(counts({}))).toBe(true);
    expect(GradebookToolbar.syncShow(counts({ tograde: 1 }))).toBe(false);
  });
});

describe('the filter panel', () => {
  it('has a column for each of Category, Competencies and Modules that the class has', () => {
    mount(seed, { course: CID });
    openPanel();
    expect($$('.gbf-col .assess-filter-head').map(h => h.textContent)).toEqual(['Category', 'Competencies', 'Modules']);
    expect($$('.gbf-col[aria-label="Category"] .assess-filter-item').map(b => b.textContent.trim())).toEqual([
      'Labs',
      'Quizzes',
    ]);
    expect($$('.gbf-col[aria-label="Modules"] .assess-filter-item').map(b => b.textContent.trim())).toEqual(['Cells']);
    // The folders, then the competency in none; each competency waits under its folder.
    expect(
      $$('.gbf-col[aria-label="Competencies"] > .gbf-list > .gbf-folder [data-action="toggleFolderFilter"]').map(b =>
        b.textContent.trim(),
      ),
    ).toEqual(['Inquiry', 'Analysis']);
    expect($$('.gbf-kids[data-grpid="g1"] .gbf-kid').map(b => b.textContent.trim())).toEqual([
      'Questioning',
      'Predicting',
    ]);
    expect($('.gbf-kids[data-grpid="g1"]').hasAttribute('hidden')).toBe(true);
    expect(
      $$('.gbf-col[aria-label="Competencies"] > .gbf-list > [data-action="toggleSectionFilter"]').map(b =>
        b.textContent.trim(),
      ),
    ).toEqual(['Sharing']);
    expect($('.gbf-clear').hasAttribute('disabled')).toBe(true);
  });

  it('draws a column only when the class has the thing', () => {
    mount(
      () => {
        seed();
        _cache.modules[CID] = [];
        _cache.categories[CID] = [];
      },
      { course: CID },
    );
    openPanel();
    expect($$('.gbf-col .assess-filter-head').map(h => h.textContent)).toEqual(['Competencies']);
  });

  it('a category, a module and a competency each narrow the columns, with a chip, and Clear Filters lets them go', () => {
    mount(seed, { course: CID });
    expect(cols()).toBe(4);
    openPanel();
    click($('.gbf-panel [data-catid="c1"]'));
    expect(cols()).toBe(2);
    expect(chips()).toEqual(['Labs']);
    expect($('.atb-filter-btn').className).toContain('has-filters');
    // The panel stays open while the page redraws.
    expect($('.gbf-panel')).not.toBeNull();
    expect(checked('.gbf-panel [data-catid="c1"]')).toBe('true');
    click($('.gbf-panel [data-moduleid="m1"]'));
    expect(cols()).toBe(1);
    expect(chips()).toEqual(['Labs', 'Cells']);
    click($('.gbf-clear'));
    expect(cols()).toBe(4);
    expect(chips()).toEqual([]);
    expect($('.atb-filter-btn').className).not.toContain('has-filters');
    expect($('.gbf-clear').hasAttribute('disabled')).toBe(true);
  });

  it('a folder’s box ticks every competency in it, shows a dash for some, and is one chip with the folder’s name', () => {
    mount(seed, { course: CID });
    openPanel();
    const folder = () => $('.gbf-panel [data-action="toggleFolderFilter"][data-grpid="g1"]');
    expect(checked('.gbf-panel [data-grpid="g1"][data-action="toggleFolderFilter"]')).toBe('false');
    click(folder());
    expect(checked('.gbf-panel [data-grpid="g1"][data-action="toggleFolderFilter"]')).toBe('true');
    expect($$('.gbf-kids[data-grpid="g1"] .gbf-kid').map(b => b.getAttribute('aria-checked'))).toEqual([
      'true',
      'true',
    ]);
    expect(chips()).toEqual(['Inquiry']);
    expect(cols()).toBe(2);
    // One let go: a dash, and a chip for the one left.
    click($('.gbf-panel [data-secid="S1"]'));
    expect(checked('.gbf-panel [data-grpid="g1"][data-action="toggleFolderFilter"]')).toBe('mixed');
    expect(folder().className).toContain('is-some');
    expect(chips()).toEqual(['Predicting']);
    // The dash ticks them all again; all ticked, a click lets them all go.
    click(folder());
    expect(chips()).toEqual(['Inquiry']);
    click(folder());
    expect(chips()).toEqual([]);
    expect(cols()).toBe(4);
  });

  it('× on a folder’s chip lets all its competencies go; a competency in no folder is its own chip', () => {
    mount(seed, { course: CID });
    openPanel();
    click($('.gbf-panel [data-action="toggleFolderFilter"][data-grpid="g2"]'));
    click($('.gbf-panel [data-secid="S4"]'));
    expect(chips()).toEqual(['Analysis', 'Sharing']);
    click($('.atb-chip[data-grpid="g2"]'));
    expect(chips()).toEqual(['Sharing']);
    click($('.atb-chip[data-secid="S4"]'));
    expect(chips()).toEqual([]);
  });

  it('opens a folder with its chevron, and keeps it open through the page’s redraws', () => {
    mount(seed, { course: CID });
    openPanel();
    click($('.gbf-chev[data-grpid="g1"]'));
    expect($('.gbf-kids[data-grpid="g1"]').hasAttribute('hidden')).toBe(false);
    expect($('.gbf-chev[data-grpid="g1"]').getAttribute('aria-expanded')).toBe('true');
    click($('.gbf-panel [data-secid="S1"]'));
    expect($('.gbf-kids[data-grpid="g1"]').hasAttribute('hidden')).toBe(false);
    expect($('.gbf-kids[data-grpid="g2"]').hasAttribute('hidden')).toBe(true);
  });

  it('Escape closes it and returns the keyboard to Filter; a click outside closes it', () => {
    mount(seed, { course: CID });
    openPanel();
    key($('.gbf-panel [data-catid="c1"]'), 'Escape');
    expect($('.gbf-panel')).toBeNull();
    expect(document.activeElement).toBe($('.atb-filter-btn'));
    openPanel();
    click($('#gb-data'));
    expect($('.gbf-panel')).toBeNull();
  });

  it('a chip’s × hands the keyboard to Filter', () => {
    mount(seed, { course: CID });
    openPanel();
    click($('.gbf-panel [data-catid="c2"]'));
    click($('.atb-chip'));
    expect(chips()).toEqual([]);
    expect(document.activeElement).toBe($('.atb-filter-btn'));
  });

  it('a dashboard link’s students are a chip too, and × shows everyone', () => {
    mount(seed, { course: CID, students: 's1' });
    expect(chips()).toEqual(['Showing 1 Student']);
    click($('.atb-chip[data-action="clearStudentFilter"]'));
    expect(chips()).toEqual([]);
  });
});
