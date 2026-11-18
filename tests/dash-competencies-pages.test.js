/**
 * The Competencies tile's two pages (D3 of docs/plans/dashboard-inbox-plan.md):
 * Level Mix as one row per competency, Self-Assessment as one row per Core
 * Competency, the Lowest and Only words, each row's accessible name, the
 * row's list, and the flag-off cards unchanged. Counts are the bands
 * competencyDistribution gives; nothing here works out a level.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';

const CID = 'dash-comp-pages';
const STUDENTS = [
  { id: 's1', firstName: 'Ava', lastName: 'Chan' },
  { id: 's2', firstName: 'Ben', lastName: 'Diaz' },
  { id: 's3', firstName: 'Cy', lastName: 'Eng' },
  { id: 's4', firstName: 'Di', lastName: 'Fox' },
];
const IDS = STUDENTS.map(s => s.id);
const sec = (id, name, code) => ({ id, name, shortName: name, tags: [{ id, code, label: name }] });

let n = 0;
const sc = (tagId, score) => ({ assessmentId: 'a' + ++n, tagId, score, date: '2026-10-01' });

/** rows: { TAG: [score for s1, s2, s3, s4] } (0 or missing: not scored). */
function setClass(mode, rows) {
  n = 0;
  COURSES[CID] = { id: CID, name: 'Socials 9', gradingSystem: mode };
  _cache.students[CID] = STUDENTS;
  const tags = Object.keys(rows);
  _cache.learningMaps[CID] = {
    subjects: [],
    sections: tags.map(t => sec(t, 'Name ' + t, t + '1')),
    competencyGroups: [],
    _customized: true,
    _version: 1,
  };
  _cache.categories[CID] = [];
  /** @type {Record<string, any[]>} */
  const scores = {};
  tags.forEach(t =>
    rows[t].forEach((v, i) => {
      if (v) (scores[IDS[i]] = scores[IDS[i]] || []).push(sc(t, v));
    }),
  );
  _cache.scores[CID] = scores;
  _cache.assessments[CID] = Object.values(scores)
    .flat()
    .map(s => ({ id: s.assessmentId, title: s.assessmentId, date: s.date, tagIds: [s.tagId] }));
  _cache.statuses[CID] = {};
  _cache.rubrics[CID] = [];
  _cache.overrides[CID] = {};
  _cache.observations[CID] = {};
  _cache.courseConfigs[CID] = { calcMethod: 'average' };
  _cache.coreSelf[CID] = {};
  clearProfCache();
}

function opts(extra) {
  return Object.assign(
    {
      cid: CID,
      allStudents: STUDENTS,
      assessments: [],
      todayStr: '2026-11-15',
      ccCounts: {},
      ccAssessments: {},
      ccObs: {},
      coreSelf: coreSelfRatings(CID, IDS),
      coreView: 'self',
      compView: 'mix',
      obs: {},
      mixPop: null,
      helpRule: null,
      naComp: null,
    },
    extra || {},
  );
}

function dom(html) {
  return parseHTML(
    '<!doctype html><html><body><div id="root">' + html + '</div></body></html>',
  ).document.getElementById('root');
}

const tile = extra => dom(DashCompetencies.html(opts(extra)));
const rowsOf = (el, page) => Array.from(el.querySelectorAll('.dash-comp-ln[data-comp-page="' + page + '"]'));
const numOf = r => r.querySelector('.dash-comp-ln-num').textContent.replace(/^(Lowest|Only)/, '');

// IN: 2 Developing-or-below... see the scores: Ava 2, Ben 3, Cy 4, Di 4.
// EV: Ava 1, Ben 2, Cy 2, Di not scored. PL: nobody.
const THREE = { IN: [2, 3, 4, 4], EV: [1, 2, 2, 0], PL: [0, 0, 0, 0] };

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('fv-build-dashRow', '1');
});

afterEach(() => {
  delete COURSES[CID];
  delete _cache.students[CID];
  delete _cache.learningMaps[CID];
  delete _cache.scores[CID];
  delete _cache.assessments[CID];
  delete _cache.coreSelf[CID];
  localStorage.clear();
});

describe('Level Mix, one row per competency', () => {
  it('reads "Proficient or Above" as the Proficient and Extending bands, of those scored', () => {
    setClass('proficiency', THREE);
    const el = tile();
    const rows = rowsOf(el, 'curricular');
    expect(rows).toHaveLength(3);
    const cols = DashInsights.columns(CID);
    cols.forEach((col, i) => {
      const d = competencyDistribution(CID, IDS, col.which);
      const above = d.bands[2].ids.length + d.bands[3].ids.length;
      const scored = d.bands.reduce((a, b) => a + b.ids.length, 0);
      expect(numOf(rows[i])).toBe(scored ? above + ' of ' + scored : '—');
    });
    expect(numOf(rows[0])).toBe('3 of 4');
    expect(el.textContent).toContain('Proficient or Above');
  });

  it("keeps the gradebook order and draws each bar in the top bar's level colours", () => {
    setClass('proficiency', THREE);
    const rows = rowsOf(tile(), 'curricular');
    expect(rows.map(r => r.querySelector('.dash-comp-ln-name').textContent)).toEqual(['Name IN', 'Name EV', 'Name PL']);
    const segs = Array.from(rows[0].querySelectorAll('.dash-comp-ln-bar i')).map(i => i.getAttribute('style'));
    expect(segs).toEqual([
      'flex:1;background:var(--score-2)',
      'flex:1;background:var(--score-3)',
      'flex:2;background:var(--score-4)',
    ]);
    expect(tile().querySelector('.dash-comp-legend').textContent).toBe('EmergingDevelopingProficientExtending');
  });

  it('marks Lowest on exactly one row, none on a tie, none when nobody is scored', () => {
    setClass('proficiency', THREE);
    const el = tile();
    const tags = Array.from(el.querySelectorAll('.dash-comp-ln-tag')).map(t => t.textContent);
    expect(tags).toEqual(['Lowest']);
    expect(rowsOf(el, 'curricular')[1].querySelector('.dash-comp-ln-tag').textContent).toBe('Lowest');
    expect(rowsOf(el, 'curricular')[2].querySelector('.dash-comp-ln-tag')).toBeNull();
    expect(rowsOf(el, 'curricular')[2].getAttribute('aria-label')).toBe('Name PL: not scored yet');
    // A tie marks none.
    setClass('proficiency', { IN: [2, 3, 3, 4], EV: [2, 3, 3, 4] });
    expect(tile().querySelectorAll('.dash-comp-ln-tag')).toHaveLength(0);
    // Nobody scored on anything.
    setClass('proficiency', { IN: [0, 0, 0, 0], EV: [0, 0, 0, 0] });
    expect(tile().querySelectorAll('.dash-comp-ln-tag')).toHaveLength(0);
    // One scored competency alone is not "lowest".
    setClass('proficiency', { IN: [2, 3, 3, 4], EV: [0, 0, 0, 0] });
    expect(tile().querySelectorAll('.dash-comp-ln-tag')).toHaveLength(0);
  });

  it('lowestKey works from counts alone', () => {
    const L = DashCompetencies.lowestKey;
    expect(
      L([
        { key: 'a', scored: 4, above: 3 },
        { key: 'b', scored: 4, above: 1 },
      ]),
    ).toBe('b');
    expect(
      L([
        { key: 'a', scored: 4, above: 1 },
        { key: 'b', scored: 4, above: 1 },
      ]),
    ).toBe('');
    expect(
      L([
        { key: 'a', scored: 0, above: 0 },
        { key: 'b', scored: 4, above: 1 },
      ]),
    ).toBe('');
  });

  it("names its counts in the row's accessible name", () => {
    setClass('proficiency', THREE);
    const r = rowsOf(tile(), 'curricular');
    expect(r[1].getAttribute('aria-label')).toBe(
      'Name EV: 0 of 3 Proficient or above, the lowest. Emerging 1, Developing 2, Proficient 0, Extending 0',
    );
    expect(r[0].getAttribute('aria-label')).toBe(
      'Name IN: 3 of 4 Proficient or above. Emerging 0, Developing 1, Proficient 1, Extending 2',
    );
    expect(r[0].getAttribute('aria-haspopup')).toBe('dialog');
  });

  it('bands by the four levels in a Letter class and a Both class too', () => {
    for (const mode of ['letter', 'both']) {
      setClass(mode, THREE);
      const rows = rowsOf(tile({ compView: mode === 'letter' ? 'avg' : 'mix' }), 'curricular');
      // A Letter class has no saved pick: the tile still opens on Level Mix.
      expect(rows).toHaveLength(3);
      expect(numOf(rows[0])).toBe('3 of 4');
      expect(rows[0].getAttribute('aria-label')).toContain('Emerging 0, Developing 1, Proficient 1, Extending 2');
    }
  });

  it('keeps a saved Class Average in a Letter class', () => {
    setClass('letter', THREE);
    localStorage.setItem('fv-dash-comp-view:' + CID, 'avg');
    expect(rowsOf(tile({ compView: 'avg' }), 'curricular')).toHaveLength(0);
  });

  it("the other views are today's card, untouched", () => {
    setClass('proficiency', THREE);
    for (const view of ['avg', 'below', 'trend']) {
      const o = opts({ compView: view });
      const html = DashCompetencies.html(o);
      expect(html).toContain(DashOverview.competenciesCardHtml(o));
    }
  });
});

/** Runs with a real document holding the tile, as the page does. */
let _doc = null;
function mount(o) {
  const html = DashCompetencies.html(o);
  const { document: d } = parseHTML('<!doctype html><html><body>' + html + '</body></html>');
  if (!_doc) _doc = globalThis.document;
  globalThis.document = d;
  return d;
}
function unmount() {
  DashCompetencies.close(false);
  if (_doc) globalThis.document = _doc;
  _doc = null;
}
function openRow(d, key) {
  DashCompetencies.toggle(d.querySelector('[data-comp-open="' + key + '"]'));
  return d.getElementById('dash-comp-pop');
}

describe("a row's list", () => {
  function open(key, extra) {
    return openRow(mount(opts(extra)), key);
  }

  beforeEach(() => {
    setClass('proficiency', THREE);
  });
  afterEach(unmount);

  it('says how many are below Proficient and lists them with their level as the class shows it', () => {
    const pop = open('s:EV');
    expect(pop.hidden).toBe(false);
    expect(pop.textContent).toContain('3 below Proficient: 1 Emerging, 2 Developing');
    expect(pop.textContent).toContain('Show These 3 in Student Cards ↓');
    expect(pop.textContent).toContain('Open in Gradebook →');
    const chips = pop.querySelectorAll('.dash-ins-person');
    expect(chips).toHaveLength(3);
    // Each chip carries the level text calc.js gives the class.
    const ava = Array.from(chips).find(c => c.textContent.includes('Ava'));
    expect(ava.querySelector('.dash-ins-val').textContent).toBe(
      formatLevel(CID, competencyDistribution(CID, IDS, { sectionId: 'EV' }).values.s1),
    );
    const show = pop.querySelector('[data-comp-scroll]');
    expect(show.getAttribute('data-action')).toBe('naComp');
    expect(show.getAttribute('data-key')).toBe('s:EV');
  });

  it('shows a letter-class student as the class shows grades', () => {
    setClass('letter', THREE);
    localStorage.setItem('fv-dash-comp-view:' + CID, 'mix');
    const pop = open('s:EV');
    const ava = Array.from(pop.querySelectorAll('.dash-ins-person')).find(c => c.textContent.includes('Ava'));
    expect(ava.querySelector('.dash-ins-val').textContent).toBe(
      formatLevel(CID, competencyDistribution(CID, IDS, { sectionId: 'EV' }).values.s1),
    );
  });

  it('is kept across a redraw and closes when its competency is gone', () => {
    open('s:EV');
    const again = dom(DashCompetencies.html(opts()));
    expect(again.querySelector('[data-comp-open="s:EV"]').getAttribute('aria-expanded')).toBe('true');
    expect(again.querySelector('#dash-comp-pop').hasAttribute('hidden')).toBe(false);
    // A view that shows no rows drops it.
    const other = dom(DashCompetencies.html(opts({ compView: 'avg' })));
    expect(other.querySelector('#dash-comp-pop').hasAttribute('hidden')).toBe(true);
  });

  it('says "No one is below Proficient" with nothing to show', () => {
    setClass('proficiency', { IN: [3, 3, 4, 4], EV: [2, 2, 3, 3] });
    const pop = open('s:IN');
    expect(pop.textContent).toContain('No one is below Proficient.');
    expect(pop.querySelector('[data-comp-scroll]')).toBeNull();
  });

  it('is hidden at rest', () => {
    const d = mount(opts());
    expect(d.getElementById('dash-comp-pop').hasAttribute('hidden')).toBe(true);
    expect(d.getElementById('dash-comp-tipbox').hasAttribute('hidden')).toBe(true);
  });
});

describe('Self-Assessment, one row per Core Competency', () => {
  function withSelf(byCore) {
    _cache.coreSelf[CID] = byCore;
    return opts({ coreSelf: { any: true, byCore } });
  }
  beforeEach(() => setClass('proficiency', THREE));

  it('counts who has self-assessed, says Only under half and names its counts', () => {
    const o = withSelf({
      [CORE_COMPETENCIES[0].id]: { s1: 1, s2: 2, s3: 4 },
      [CORE_COMPETENCIES[1].id]: { s1: 3 },
    });
    const el = dom(DashCompetencies.html(o));
    const rows = rowsOf(el, 'core');
    expect(rows).toHaveLength(CORE_COMPETENCIES.length);
    const by = id => rows.find(r => r.getAttribute('data-comp-open') === id);
    const comm = by(CORE_COMPETENCIES[0].id);
    expect(comm.querySelector('.dash-comp-ln-num').textContent).toBe('3 of 4');
    expect(comm.querySelector('.dash-comp-ln-tag')).toBeNull();
    expect(comm.getAttribute('aria-label')).toBe(
      CORE_COMPETENCIES[0].label + ': 3 of 4 self-assessed. Beginning 1, Growing 1, Confident 0, Leading 1, Not yet 1',
    );
    const few = by(CORE_COMPETENCIES[1].id);
    expect(few.querySelector('.dash-comp-ln-num').textContent).toBe('Only1 of 4');
    expect(few.getAttribute('aria-label')).toContain(': only 1 of 4 self-assessed.');
    expect(el.textContent).toContain('Self-Assessed');
    // Exactly half is not "only".
    expect(DashCompetencies.isFew(2, 4)).toBe(false);
    expect(DashCompetencies.isFew(1, 4)).toBe(true);
  });

  it('draws the bar in the self-assessment blues, never the level colours', () => {
    const el = dom(DashCompetencies.html(withSelf({ [CORE_COMPETENCIES[0].id]: { s1: 1, s2: 2, s3: 3, s4: 4 } })));
    const html = el.querySelector('#dash-comp-page-core').innerHTML;
    expect(html).toContain('dash-comp-st-1');
    expect(html).toContain('dash-comp-st-4');
    expect(html).not.toContain('--score-');
    expect(el.querySelector('#dash-comp-page-core .dash-comp-legend').textContent).toBe(
      'BeginningGrowingConfidentLeading',
    );
    const css = require('node:fs').readFileSync(
      require('node:path').resolve(__dirname, '../teacher/dash-competencies.css'),
      'utf8',
    );
    for (const k of [1, 2, 3, 4]) expect(css).toMatch(new RegExp('\\.dash-comp-st-' + k + ' \\{[^}]*--self-' + k));
  });

  it("lists the students at each step in the row's list", () => {
    const id = CORE_COMPETENCIES[0].id;
    const o = withSelf({ [id]: { s1: 1, s2: 1, s3: 4 } });
    const pop = openRow(mount(o), id);
    expect(pop.textContent).toContain('Beginning · 2');
    expect(pop.textContent).toContain('Leading · 1');
    expect(pop.textContent).toContain('Not Yet · 1');
    expect(pop.textContent).toContain('Open the Questionnaire →');
    unmount();
  });

  it("says what today's card says, with no menu, when nobody has self-assessed", () => {
    const o = opts({ coreSelf: coreSelfRatings(CID, IDS) });
    const html = DashCompetencies.html(o);
    expect(html).toContain(DashOverview.coreCardHtml(o));
    expect(dom(html).querySelectorAll('.dash-comp-ln[data-comp-page="core"]')).toHaveLength(0);
    expect(dom(DashOverview.coreCardHtml(o)).querySelector('.dash-view-btn')).toBeNull();
  });
});

describe('with the dashRow switch off', () => {
  it("draws today's two cards for every view, exactly", () => {
    setClass('proficiency', THREE);
    localStorage.clear();
    for (const compView of ['avg', 'mix', 'below', 'trend']) {
      for (const coreView of ['self', 'evidence']) {
        const o = opts({ compView, coreView });
        const missing = DashInsights.missingItems(CID, STUDENTS);
        const expected =
          '<div class="dash-section dash-overview">' +
          DashOverview.glanceHtml(Object.assign({}, o, { missing })) +
          '<div class="dash-overview-row dash-overview-cards">' +
          DashOverview.competenciesCardHtml(o) +
          DashOverview.coreCardHtml(o) +
          '</div></div>';
        expect(DashOverview.renderOverviewPanel(o)).toBe(expected);
        expect(expected).not.toContain('dash-comp-ln');
        expect(expected).not.toContain('dash-comp-tile');
      }
    }
  });
});
