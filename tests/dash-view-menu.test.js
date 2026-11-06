/**
 * The dashboard cards' view menu (DashOverview.viewMenuHtml, run by
 * teacher/page-dashboard.js): a pill naming the view in use and a menu of
 * menuitemradio buttons. It opens on a click (focus on the view in use),
 * arrow keys move, Enter picks (the menu's registered setter, a redraw,
 * focus back on the pill), and Escape or a click outside close it. The Core
 * Competencies card registers 'core'; Curricular Competencies uses the same
 * builder and handlers.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CID = 'view-menu';
const VIEWS = [
  { key: 'a', label: 'First View', hint: 'What the first shows' },
  { key: 'b', label: 'Second View', hint: 'What the second shows' },
];

describe('viewMenuHtml', () => {
  it('draws the pill and a closed menu of radio items', () => {
    const html = DashOverview.viewMenuHtml({ id: 'demo', label: 'Demo view', views: VIEWS, current: 'b' });
    expect(html).toContain(
      '<button type="button" class="dash-view-btn" id="dash-view-btn-demo" aria-haspopup="menu" aria-expanded="false" aria-controls="dash-view-menu-demo" aria-label="Demo view: Second View" data-action="viewMenu" data-menu="demo"><span>Second View</span><svg',
    );
    expect(html).toContain(
      '<div class="dash-view-menu" id="dash-view-menu-demo" role="menu" aria-label="Demo view" hidden>',
    );
    const items = [...html.matchAll(/role="menuitemradio" aria-checked="(true|false)"[^>]*data-view="(\w+)"/g)].map(
      m => [m[2], m[1]],
    );
    expect(items).toEqual([
      ['a', 'false'],
      ['b', 'true'],
    ]);
    expect(html).toContain('data-action="viewPick" data-menu="demo" data-view="a"');
    expect(html).toContain(
      '<span class="dash-view-name">First View</span><span class="dash-view-hint">What the first shows</span>',
    );
  });

  it('falls back to the first view and escapes every label', () => {
    const html = DashOverview.viewMenuHtml({
      id: 'x',
      label: 'X',
      views: [{ key: 'k', label: '<b>Bold</b>', hint: '"quoted"' }],
      current: 'nope',
    });
    expect(html).toContain('aria-checked="true"');
    expect(html).not.toContain('<b>');
    expect(html).toContain('&quot;quoted&quot;');
    expect(DashOverview.viewMenuHtml({ id: 'y', views: [] })).toBe('');
  });
});

describe('the view menu on the dashboard', () => {
  let stub, doc, active, saved;

  beforeEach(() => {
    localStorage.clear();
    stub = {
      document: globalThis.document,
      getComputedStyle: globalThis.getComputedStyle,
      CSS: globalThis.CSS,
      PageDashboard: globalThis.PageDashboard,
    };
    doc = parseHTML(
      '<!DOCTYPE html><html><body><div id="page-toolbar-mount"></div><div id="sidebar-mount"></div><main id="main"></main><button id="outside">Outside</button></body></html>',
    ).document;
    globalThis.document = doc;
    globalThis.getComputedStyle = () => ({ paddingLeft: '0', paddingRight: '0' });
    active = null;
    Object.defineProperty(doc, 'activeElement', { get: () => active || doc.body, configurable: true });
    doc.defaultView.HTMLElement.prototype.focus = function () {
      active = this;
    };
    // linkedom's select has a read-only value; the page sets the sort menu's.
    Object.defineProperty(doc.defaultView.HTMLSelectElement.prototype, 'value', {
      get() {
        return this._value || '';
      },
      set(v) {
        this._value = v;
      },
      configurable: true,
    });
    // The questionnaire answers: none to fetch here.
    stub.voiceLoaded = StudentVoice.loaded;
    StudentVoice.loaded = () => true;
    COURSES[CID] = { id: CID, name: 'Socials 9', gradingSystem: 'proficiency' };
    _cache.courseConfigs[CID] = {
      reportingTerms: [{ ordinal: 1, label: 'Term 1', starts_on: '2000-01-01', ends_on: '2099-12-31' }],
    };
    saveStudents(CID, [
      { id: 's1', firstName: 'Ava', lastName: 'Chan' },
      { id: 's2', firstName: 'Ben', lastName: 'Diaz' },
    ]);
    _cache.assessments[CID] = [{ id: 'a1', title: 'Trench Letter', coreCompetencyIds: ['COM'], tagIds: [] }];
    _cache.observations[CID] = {
      s1: [{ id: 'o1', text: 'Led the group', dims: ['collaboration', 'cc:COL'], date: '2026-10-01' }],
      s2: [{ id: 'o2', text: 'Listened well', dims: ['cc:COL', 'cc:COM'], date: '2026-10-02' }],
    };
    _cache.coreSelf[CID] = { s1: { T1: { COM: { level: 3 } } } };
    setActiveCourse(CID);
    runInThisContext(readFileSync(resolve(root, 'teacher/page-dashboard.js'), 'utf-8'), {
      filename: 'teacher/page-dashboard.js',
    });
    PageDashboard.init({});
    saved = PageDashboard;
  });

  afterEach(() => {
    const remove = globalThis.removeEventListener;
    globalThis.removeEventListener = () => {};
    saved.destroy();
    globalThis.removeEventListener = remove;
    globalThis.document = stub.document;
    globalThis.getComputedStyle = stub.getComputedStyle;
    globalThis.PageDashboard = stub.PageDashboard;
    StudentVoice.loaded = stub.voiceLoaded;
    delete COURSES[CID];
    delete _cache.coreSelf[CID];
    delete _cache.observations[CID];
  });

  const pill = () => doc.getElementById('dash-view-btn-core');
  const menu = () => doc.getElementById('dash-view-menu-core');
  function click(el) {
    el.dispatchEvent(new doc.defaultView.Event('click', { bubbles: true, cancelable: true }));
  }
  function key(k) {
    const e = new doc.defaultView.Event('keydown', { bubbles: true, cancelable: true });
    Object.assign(e, { key: k });
    (doc.activeElement || doc.body).dispatchEvent(e);
    return e;
  }

  it('counts the tagged observations across the class in the Evidence view', () => {
    localStorage.setItem('fv-dash-core-view:' + CID, 'evidence');
    PageDashboard.render();
    const card = doc.querySelector('.dash-core-card');
    const val = id => card.querySelector('[data-core="' + id + '"] .dash-core-val').textContent;
    expect(val('COL')).toBe('2');
    expect(val('COM')).toBe('2');
    expect(card.querySelectorAll('[data-core="COM"] .is-work').length).toBe(1);
    expect(card.querySelectorAll('[data-core="COM"] .is-obs').length).toBe(1);
    expect(val('CT')).toBe('None yet');
  });

  it('opens on a click with focus on the view in use, and a second click closes it', () => {
    expect(pill().textContent).toBe('Self-Assessment');
    expect(menu().hidden).toBe(true);
    click(pill());
    expect(menu().hidden).toBe(false);
    expect(pill().getAttribute('aria-expanded')).toBe('true');
    expect(doc.activeElement.getAttribute('data-view')).toBe('self');
    click(pill());
    expect(menu().hidden).toBe(true);
    expect(pill().getAttribute('aria-expanded')).toBe('false');
  });

  it('moves with the arrow keys and picks with Enter: remembered for the class, focus on the pill', () => {
    click(pill());
    key('ArrowDown');
    expect(doc.activeElement.getAttribute('data-view')).toBe('evidence');
    key('ArrowDown');
    expect(doc.activeElement.getAttribute('data-view')).toBe('self');
    key('End');
    const e = key('Enter');
    expect(e.defaultPrevented).toBe(true);
    expect(localStorage.getItem('fv-dash-core-view:' + CID)).toBe('evidence');
    expect(pill().textContent).toBe('Evidence');
    expect(menu().hidden).toBe(true);
    expect(doc.activeElement).toBe(pill());
    expect(doc.querySelector('.dash-core-head a').textContent).toBe('Assignments →');
    expect(menu().querySelector('[aria-checked="true"]').getAttribute('data-view')).toBe('evidence');
  });

  it('picks with a click too', () => {
    click(pill());
    click(menu().querySelector('[data-view="evidence"]'));
    expect(localStorage.getItem('fv-dash-core-view:' + CID)).toBe('evidence');
    expect(doc.activeElement).toBe(pill());
  });

  it('Escape closes it and puts focus back on the pill', () => {
    click(pill());
    key('Escape');
    expect(menu().hidden).toBe(true);
    expect(pill().getAttribute('aria-expanded')).toBe('false');
    expect(doc.activeElement).toBe(pill());
  });

  it('a click outside closes it without picking', () => {
    click(pill());
    click(doc.getElementById('outside'));
    expect(menu().hidden).toBe(true);
    expect(localStorage.getItem('fv-dash-core-view:' + CID)).toBe(null);
  });

  it('Down on the closed pill opens it', () => {
    pill().focus();
    key('ArrowDown');
    expect(menu().hidden).toBe(false);
    expect(doc.activeElement.getAttribute('role')).toBe('menuitemradio');
  });
});
