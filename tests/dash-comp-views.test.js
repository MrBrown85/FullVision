/**
 * The dashboard's Curricular Competencies card (docs/plans/dashboard-cards-plan.md,
 * part B): four views (Class Average, Level Mix, Needs Support, Change) in
 * both grading styles, the default view per style and the remembered pick,
 * and the page's competency filter (the bar above the students, the cards
 * weakest first on the picked competency). competencyMonthlyAverages in
 * shared/calc.js gives the Change view its months.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CID = 'comp-views';
const TODAY = '2026-11-15';
const STUDENTS = [
  { id: 's1', firstName: 'Ava', lastName: 'Chan' },
  { id: 's2', firstName: 'Ben', lastName: 'Diaz' },
  { id: 's3', firstName: 'Cy', lastName: 'Eng' },
];
const IDS = STUDENTS.map(s => s.id);
const sec = (id, name, code) => ({ id, name, shortName: name, tags: [{ id, code, label: name }] });

let n = 0;
const sc = (tagId, score, date) => ({ assessmentId: 'a' + ++n, tagId, score, date });

/* Inquiry (IN): Ava 2s (Developing), Ben 3s, Cy 4s. Evidence (EV): Ava 1s,
   Ben 2s, Cy not scored. Three scores each, so the rule (below Proficient,
   at least 3 scores) catches Ava on both and Ben on Evidence. */
function setClass(mode) {
  n = 0;
  COURSES[CID] = { id: CID, name: 'Socials 9', gradingSystem: mode };
  _cache.students[CID] = STUDENTS;
  _cache.learningMaps[CID] = {
    subjects: [],
    sections: [sec('IN', 'Inquiry', 'IN1'), sec('EV', 'Evidence', 'EV1')],
    competencyGroups: [],
    _customized: true,
    _version: 1,
  };
  _cache.categories[CID] = [];
  const scores = {
    s1: [
      sc('IN', 2, '2026-09-05'),
      sc('IN', 2, '2026-09-20'),
      sc('IN', 2, '2026-11-03'),
      sc('EV', 1, '2026-09-08'),
      sc('EV', 1, '2026-10-08'),
      sc('EV', 1, '2026-11-08'),
    ],
    s2: [
      sc('IN', 3, '2026-09-10'),
      sc('IN', 3, '2026-11-10'),
      sc('IN', 3, '2026-11-12'),
      sc('EV', 2, '2026-09-11'),
      sc('EV', 2, '2026-09-12'),
      sc('EV', 2, '2026-09-13'),
    ],
    s3: [sc('IN', 4, '2026-09-01'), sc('IN', 4, '2026-11-01'), sc('IN', 4, '2026-11-02')],
  };
  _cache.scores[CID] = scores;
  _cache.assessments[CID] = Object.values(scores)
    .flat()
    .map(s => ({ id: s.assessmentId, title: s.assessmentId, date: s.date, tagIds: [s.tagId] }));
  _cache.statuses[CID] = {};
  _cache.rubrics[CID] = [];
  _cache.overrides[CID] = {};
  _cache.observations[CID] = {};
  _cache.courseConfigs[CID] = { calcMethod: 'average' };
  clearProfCache();
}

function card(extra) {
  return DashOverview.competenciesCardHtml(
    Object.assign(
      { cid: CID, allStudents: STUDENTS, assessments: [], tagsWithEvidence: 2, allTags: [1, 2], todayStr: TODAY },
      extra || {},
    ),
  );
}
function dom(html) {
  return parseHTML(
    '<!doctype html><html><body><div id="root">' + html + '</div></body></html>',
  ).document.getElementById('root');
}
const texts = (el, sel) => Array.from(el.querySelectorAll(sel)).map(x => x.textContent);

afterEach(() => {
  delete COURSES[CID];
});

describe('the default view', () => {
  it('is Class Average in a Letter class and Level Mix in a Proficiency or Both class', () => {
    setClass('letter');
    expect(DashOverview.compView(CID, null)).toBe('avg');
    setClass('proficiency');
    expect(DashOverview.compView(CID, null)).toBe('mix');
    setClass('both');
    expect(DashOverview.compView(CID, undefined)).toBe('mix');
  });

  it('a saved view wins; anything else falls back', () => {
    setClass('letter');
    expect(DashOverview.compView(CID, 'trend')).toBe('trend');
    expect(DashOverview.compView(CID, 'nope')).toBe('avg');
  });
});

describe('the views', () => {
  for (const mode of ['letter', 'proficiency']) {
    describe(mode + ' class', () => {
      beforeEach(() => setClass(mode));

      it('draws the view menu with four views and the one in use', () => {
        const el = dom(card({ compView: 'below' }));
        expect(el.querySelector('#dash-view-btn-comp').textContent).toBe('Needs Support');
        expect(texts(el, '#dash-view-menu-comp .dash-view-name')).toEqual([
          'Class Average',
          'Level Mix',
          'Needs Support',
          'Change',
        ]);
        expect(el.querySelector('.dash-comp-card').getAttribute('data-view')).toBe('below');
      });

      it('Class Average: a bar and the average as the class shows it', () => {
        const el = dom(card({ compView: 'avg' }));
        expect(texts(el, '.dash-comp-labels span')).toEqual(['Competency', '', 'Average']);
        const vals = texts(el, '.dash-comp-row .dash-comp-val');
        expect(vals).toEqual([formatLevel(CID, 3), formatLevel(CID, 1.5)]);
        expect(vals[0]).toBe(mode === 'letter' ? '75%' : '3.0');
        const row = el.querySelector('.dash-comp-row');
        expect(row.tagName).toBe('BUTTON');
        expect(row.getAttribute('data-action')).toBe('naComp');
        expect(row.getAttribute('data-key')).toBe('s:IN');
        expect(row.getAttribute('aria-pressed')).toBe('false');
      });

      it('Level Mix: a count per level in the class order, the largest bold, "k of n" Proficient or above', () => {
        const el = dom(card({ compView: 'mix' }));
        expect(texts(el, '.dash-comp-lab-mid span')).toEqual(['EXT', 'PRF', 'DEV', 'EMG']);
        const rows = el.querySelectorAll('.dash-comp-row');
        expect(texts(rows[0], '.dash-comp-cell')).toEqual(['1', '1', '1', '–']);
        expect(texts(rows[1], '.dash-comp-cell')).toEqual(['–', '–', '1', '1']);
        expect(texts(el, '.dash-comp-row > .dash-comp-val')).toEqual(['2 of 3', '0 of 2']);
        const seg = rows[0].querySelector('[data-action="mixSeg"][data-level="4"]');
        expect(seg.getAttribute('aria-label')).toBe('Inquiry: 1 Extending');
        expect(seg.classList.contains('is-top')).toBe(true);
        // The row's name is the filter's button; its "below" count is Ava.
        const pick = rows[0].querySelector('.dash-comp-pick');
        expect(pick.getAttribute('data-below')).toBe('1');
        expect(rows[1].querySelector('.dash-comp-pick').getAttribute('data-below')).toBe('2');
      });

      it('Needs Support: the students below on the most competencies first, a cell per column', () => {
        const el = dom(card({ compView: 'below' }));
        expect(texts(el, '.dash-comp-code')).toEqual(['IN', 'EV']);
        expect(el.querySelector('.dash-comp-code').getAttribute('data-action')).toBe('naComp');
        const rows = el.querySelectorAll('.dash-comp-row.is-student');
        expect(texts(el, '.dash-comp-row.is-student .dash-comp-name')).toEqual(['Ava C.', 'Ben D.']);
        expect(texts(el, '.dash-comp-row.is-student .dash-comp-val')).toEqual(['2 of 2', '1 of 2']);
        expect(rows[0].getAttribute('data-href')).toBe('/student?id=s1&course=' + CID + '&tab=comps');
        expect(rows[0].querySelector('.dash-comp-tip-line').textContent).toBe('Below on Inquiry, Evidence');
        const cells = rows[1].querySelectorAll('.dash-comp-sq');
        expect(cells[0].getAttribute('style')).toBe('background:var(--score-3)');
        expect(cells[1].getAttribute('style')).toBe('background:var(--score-2)');
      });

      it('Needs Support: past seven students, "+N more" opens the grid', () => {
        const many = Array.from({ length: 9 }, (_, i) => ({ id: 'm' + i, firstName: 'M' + i, lastName: 'Z' }));
        const lists = [{ col: DashInsights.columns(CID)[0], ids: many.map(s => s.id), values: {} }];
        const el = dom(card({ compView: 'below', allStudents: many, belowLists: lists }));
        expect(el.querySelectorAll('.dash-comp-row.is-student')).toHaveLength(7);
        const more = el.querySelector('.dash-comp-more');
        expect(more.textContent).toBe('+2 more');
        expect(more.getAttribute('data-action')).toBe('studentView');
        expect(more.getAttribute('data-view')).toBe('grid');
        // Every view keeps room for those eight rows.
        expect(card({ compView: 'avg', allStudents: many, belowLists: lists })).toContain('--comp-rows:8');
      });

      it('Change: a line per competency, the change, the months in the tip and the label row', () => {
        const el = dom(card({ compView: 'trend' }));
        expect(texts(el, '.dash-comp-lab-mid span')).toEqual(['Sept', 'Nov']);
        const rows = el.querySelectorAll('.dash-comp-row');
        expect(rows[0].querySelector('polyline')).toBeTruthy();
        expect(rows[0].querySelector('polyline').getAttribute('vector-effect')).toBe('non-scaling-stroke');
        // Inquiry: Sept (2 + 3 + 4) / 3 = 3, Nov (2 + 3 + 4) / 3 = 3. Evidence:
        // Sept (1 + 2) / 2 = 1.5, Oct 1, Nov 1.
        const val = texts(el, '.dash-comp-row > .dash-comp-val');
        if (mode === 'letter') {
          expect(val).toEqual(['→ 0', '↓ 13']);
          expect(rows[1].querySelector('.dash-comp-tip-line').textContent).toBe('Sept 38% · Oct 25% · Nov 25%');
        } else {
          expect(val).toEqual(['→ 0.0', '↓ 0.5']);
          expect(rows[1].querySelector('.dash-comp-tip-line').textContent).toBe('Sept 1.5 · Oct 1.0 · Nov 1.0');
        }
        expect(rows[1].querySelector('polyline').getAttribute('stroke')).toBe('var(--score-1)');
        expect(rows[0].querySelector('polyline').getAttribute('stroke')).toBe('var(--score-3)');
      });

      it('Change: fewer than two months shows "—" and says why', () => {
        const el = dom(card({ compView: 'trend', todayStr: '2026-09-30' }));
        const row = el.querySelector('.dash-comp-row');
        expect(row.querySelector('.dash-comp-val').textContent).toBe('—');
        expect(row.querySelector('polyline')).toBeNull();
        expect(row.querySelector('.dash-comp-tip-line').textContent).toBe('Not enough months yet');
      });

      it('marks the picked competency in every view', () => {
        for (const view of ['avg', 'mix', 'trend']) {
          const el = dom(card({ compView: view, naComp: 's:EV' }));
          const picked = el.querySelectorAll('[data-key="s:EV"][aria-pressed="true"]');
          expect(picked.length).toBe(1);
        }
        const el = dom(card({ compView: 'below', naComp: 's:EV' }));
        expect(el.querySelector('.dash-comp-code.is-picked').textContent).toBe('EV');
      });
    });
  }

  it('escapes names', () => {
    setClass('proficiency');
    _cache.learningMaps[CID].sections[0].shortName = '<b>Inquiry</b>';
    clearProfCache();
    for (const view of ['avg', 'mix', 'below', 'trend']) expect(card({ compView: view })).not.toContain('<b>');
  });
});

describe('competencyMonthlyAverages', () => {
  beforeEach(() => {
    setClass('proficiency');
    // Two students; Ava in August and September, Ben in September and
    // November; nobody in October; Ben's December score is after today and
    // a 0 is no score.
    _cache.scores[CID] = {
      s1: [sc('IN', 1, '2026-08-30'), sc('IN', 3, '2026-09-05'), sc('IN', 2, '2026-09-20'), sc('IN', 0, '2026-10-01')],
      s2: [sc('IN', 3, '2026-09-10'), sc('IN', 4, '2026-11-03'), sc('IN', 2, '2026-12-01')],
    };
    _cache.assessments[CID] = Object.values(_cache.scores[CID])
      .flat()
      .map(s => ({ id: s.assessmentId, title: s.assessmentId, tagIds: [s.tagId] }));
    clearProfCache();
  });

  it("averages each student's month, then the class, skipping empty months", () => {
    expect(competencyMonthlyAverages(CID, ['s1', 's2'], { sectionId: 'IN' }, TODAY)).toEqual([
      { month: '2026-08', avg: 1, students: 1 },
      { month: '2026-09', avg: 2.75, students: 2 },
      { month: '2026-11', avg: 4, students: 1 },
    ]);
  });

  it("a score with no date takes its assessment's", () => {
    _cache.scores[CID].s1[0].date = '';
    _cache.assessments[CID][0].date = '2026-10-04';
    clearProfCache();
    const months = competencyMonthlyAverages(CID, ['s1'], { sectionId: 'IN' }, TODAY).map(m => m.month);
    expect(months).toEqual(['2026-09', '2026-10']);
  });

  it('prints the change in levels in a Proficiency class and in points of a percent otherwise', () => {
    expect(levelMoveText(CID, 1, 4)).toEqual({ text: '↑ 3.0', dir: 1 });
    expect(levelMoveText(CID, 2.75, 2.71)).toEqual({ text: '↓ 0.1', dir: -1 });
    COURSES[CID].gradingSystem = 'letter';
    expect(levelMoveText(CID, 1, 4)).toEqual({ text: '↑ 75', dir: 1 });
    COURSES[CID].gradingSystem = 'both';
    expect(levelMoveText(CID, 3, 3)).toEqual({ text: '→ 0', dir: 0 });
    expect(levelMoveText(CID, 0, 3)).toBeNull();
  });
});

describe('the page filter', () => {
  let stub, doc, active, saved;

  beforeEach(() => {
    localStorage.clear();
    stub = {
      document: globalThis.document,
      getComputedStyle: globalThis.getComputedStyle,
      PageDashboard: globalThis.PageDashboard,
      voiceLoaded: StudentVoice.loaded,
    };
    doc = parseHTML(
      '<!DOCTYPE html><html><body><div id="page-toolbar-mount"></div><div id="sidebar-mount"></div><main id="main"></main></body></html>',
    ).document;
    globalThis.document = doc;
    globalThis.getComputedStyle = () => ({ paddingLeft: '0', paddingRight: '0' });
    active = null;
    Object.defineProperty(doc, 'activeElement', { get: () => active || doc.body, configurable: true });
    doc.defaultView.HTMLElement.prototype.focus = function () {
      active = this;
    };
    Object.defineProperty(doc.defaultView.HTMLSelectElement.prototype, 'value', {
      get() {
        return this._value || '';
      },
      set(v) {
        this._value = v;
      },
      configurable: true,
    });
    StudentVoice.loaded = () => true;
    setClass('proficiency');
    _cache.coreSelf[CID] = {};
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
    delete _cache.coreSelf[CID];
  });

  function click(el) {
    el.dispatchEvent(new doc.defaultView.Event('click', { bubbles: true, cancelable: true }));
  }
  function key(k) {
    const e = new doc.defaultView.Event('keydown', { bubbles: true, cancelable: true });
    Object.assign(e, { key: k });
    (doc.activeElement || doc.body).dispatchEvent(e);
  }
  const cardOrder = () =>
    Array.from(doc.querySelectorAll('.dash-grid > .dash-card')).map(c => c.getAttribute('data-sid'));
  const pick = k => doc.querySelector('.dash-comp-card .dash-comp-pick[data-key="' + k + '"]');

  it('remembers the view per class on this device', () => {
    expect(doc.getElementById('dash-view-btn-comp').textContent).toBe('Level Mix');
    click(doc.getElementById('dash-view-btn-comp'));
    click(doc.querySelector('#dash-view-menu-comp [data-view="trend"]'));
    expect(localStorage.getItem('fv-dash-comp-view:' + CID)).toBe('trend');
    PageDashboard.render();
    expect(doc.getElementById('dash-view-btn-comp').textContent).toBe('Change');
    expect(doc.querySelector('.dash-comp-card').getAttribute('data-view')).toBe('trend');
  });

  it('a row sorts the cards weakest first, focuses their chips and shows the bar; the chip clears it', () => {
    expect(cardOrder()).toEqual(['s1', 's2', 's3']);
    click(pick('s:EV'));
    // Evidence: Ava 1, Ben 2, Cy not scored (last).
    expect(cardOrder()).toEqual(['s1', 's2', 's3']);
    click(pick('s:EV'));
    expect(doc.querySelector('.dash-comp-filter')).toBeNull();

    // Reverse the names so the sort shows: Inquiry puts Ava (2) first.
    doc.querySelector('.dash-sort-select').value = 'last-desc';
    doc.querySelector('.dash-sort-select').dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }));
    expect(cardOrder()).toEqual(['s3', 's2', 's1']);
    click(pick('s:IN'));
    expect(cardOrder()).toEqual(['s1', 's2', 's3']);
    expect(pick('s:IN').getAttribute('aria-pressed')).toBe('true');
    expect(doc.activeElement).toBe(pick('s:IN'));

    const bar = doc.querySelector('.dash-comp-filter');
    const chip = bar.querySelector('.dash-comp-chip');
    expect(chip.getAttribute('aria-label')).toBe('Clear the Inquiry filter');
    expect(bar.querySelector('.dash-comp-filter-note').textContent).toBe('Weakest first');
    expect(bar.querySelector('.dash-comp-record').textContent).toBe('Record an Observation for the 1 Below');
    expect(bar.querySelector('.dash-comp-gb').textContent).toBe('View Inquiry in Gradebook →');
    expect(bar.querySelector('.dash-comp-gb').getAttribute('data-href')).toBe(
      '/gradebook?course=' + CID + '&section=IN',
    );
    expect(doc.querySelectorAll('.dash-card-seg.is-focus[data-key="s:IN"]')).toHaveLength(3);
    expect(doc.querySelector('.dash-card[data-sid="s1"]').classList.contains('is-focus-below')).toBe(true);
    // The teacher's sort is untouched.
    expect(doc.querySelector('.dash-sort-select').value).toBe('last-desc');

    click(chip);
    expect(doc.querySelector('.dash-comp-filter')).toBeNull();
    expect(cardOrder()).toEqual(['s3', 's2', 's1']);
    expect(doc.querySelectorAll('.dash-card-seg.is-focus')).toHaveLength(0);
    expect(doc.activeElement).toBe(pick('s:IN'));
  });

  it('the grid sorts the same way', () => {
    click(doc.querySelector('[data-action="studentView"][data-view="grid"]'));
    click(pick('s:IN'));
    const rows = Array.from(doc.querySelectorAll('.dash-sg tbody .dash-sg-name')).map(r => r.textContent);
    expect(rows).toEqual(['Ava C.', 'Ben D.', 'Cy E.']);
    expect(doc.querySelector('.dash-sg th[aria-sort="ascending"]')).toBeTruthy();
  });

  it('Escape clears the filter when nothing else is open', () => {
    click(pick('s:IN'));
    expect(doc.querySelector('.dash-comp-filter')).toBeTruthy();
    key('Escape');
    expect(doc.querySelector('.dash-comp-filter')).toBeNull();
    expect(doc.activeElement).toBe(pick('s:IN'));
  });

  it('Escape leaves the filter when the account menu took it', () => {
    click(pick('s:IN'));
    doc.getElementById('page-toolbar-mount').innerHTML =
      '<div class="tb-group tb-right"><div class="tb-user-menu open">' +
      '<button type="button" class="tb-user-btn" aria-expanded="true">Account</button>' +
      '<div class="tb-user-dropdown" role="menu"><button type="button" role="menuitem">Sign Out</button></div>' +
      '</div></div>';
    // The menu's own listener runs first: it closes and calls preventDefault.
    const menuEsc = e => {
      if (e.key !== 'Escape') return;
      doc.querySelector('.tb-user-btn').setAttribute('aria-expanded', 'false');
      e.preventDefault();
    };
    doc.addEventListener('keydown', menuEsc, true);
    doc.querySelector('[role="menuitem"]').focus();
    key('Escape');
    doc.removeEventListener('keydown', menuEsc, true);
    expect(doc.querySelector('.dash-comp-filter')).toBeTruthy();

    // With the menu open and the focus still on the page, Escape is the menu's too.
    doc.querySelector('.tb-user-btn').setAttribute('aria-expanded', 'true');
    pick('s:IN').focus();
    key('Escape');
    expect(doc.querySelector('.dash-comp-filter')).toBeTruthy();

    // Closed, Escape on the page clears it again.
    doc.querySelector('.tb-user-btn').setAttribute('aria-expanded', 'false');
    key('Escape');
    expect(doc.querySelector('.dash-comp-filter')).toBeNull();
  });

  it('choosing a sort clears the filter, so the sort wins', () => {
    click(doc.querySelector('[data-action="studentView"][data-view="cards"]'));
    click(pick('s:IN'));
    expect(cardOrder()).toEqual(['s1', 's2', 's3']);
    const sel = doc.querySelector('.dash-sort-select');
    sel.value = 'last-desc';
    sel.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }));
    expect(doc.querySelector('.dash-comp-filter')).toBeNull();
    expect(cardOrder()).toEqual(['s3', 's2', 's1']);

    click(doc.querySelector('[data-action="studentView"][data-view="grid"]'));
    click(pick('s:IN'));
    expect(doc.querySelector('.dash-comp-filter')).toBeTruthy();
    const hadCSS = 'CSS' in globalThis;
    const css = globalThis.CSS;
    globalThis.CSS = { escape: x => x };
    try {
      click(doc.querySelector('.dash-sg-sort[data-key="name"]'));
    } finally {
      if (hadCSS) globalThis.CSS = css;
      else delete globalThis.CSS;
    }
    expect(doc.querySelector('.dash-comp-filter')).toBeNull();
    const rows = Array.from(doc.querySelectorAll('.dash-sg tbody .dash-sg-name')).map(r => r.textContent);
    expect(rows).toEqual(['Ava C.', 'Ben D.', 'Cy E.']);
  });

  it('"Record an Observation" opens the capture with the students below picked', () => {
    const calls = [];
    const open = ObsCapture.openDialog;
    ObsCapture.openDialog = o => calls.push(o);
    try {
      click(pick('s:EV'));
      click(doc.querySelector('.dash-comp-record'));
    } finally {
      ObsCapture.openDialog = open;
    }
    expect(calls).toHaveLength(1);
    expect(calls[0].students).toEqual(['s1', 's2']);
    expect(calls[0].lockStudents).toBeFalsy();
    expect(calls[0].subtitle).toBe('Evidence · 2 students');
  });
});
