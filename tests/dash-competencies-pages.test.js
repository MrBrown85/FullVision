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
    // The bar is under the row's button, one button per level (D9).
    const bar = r => r.closest('.dash-comp-lnbox').querySelectorAll('.dash-comp-ln-bar .dash-comp-ln-seg');
    const segs = Array.from(bar(rows[0])).map(i => i.getAttribute('style'));
    // The class's own level order (Extending first by default), as today's Level Mix.
    expect(segs).toEqual([
      'flex:2;background:var(--score-4)',
      'flex:1;background:var(--score-3)',
      'flex:1;background:var(--score-2)',
    ]);
    expect(tile().querySelector('.dash-comp-legend').textContent).toBe('ExtendingProficientDevelopingEmerging');
    COURSES[CID].levelOrder = 'asc';
    const asc = rowsOf(tile(), 'curricular')[0];
    expect(Array.from(bar(asc)).map(i => i.getAttribute('style'))[0]).toBe('flex:1;background:var(--score-2)');
    expect(tile().querySelector('.dash-comp-legend').textContent).toBe('EmergingDevelopingProficientExtending');
  });

  it('has no native tooltip on a row: its own tip is the only one', () => {
    setClass('proficiency', THREE);
    for (const r of rowsOf(tile(), 'curricular')) expect(r.hasAttribute('title')).toBe(false);
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

  it("opens on today's card's default for the class, and bands by the four levels in every style", () => {
    // A Letter class with no saved view opens on Class Average, as the flag-off card does.
    setClass('letter', THREE);
    expect(DashOverview.compView(CID, null)).toBe('avg');
    expect(rowsOf(tile({ compView: DashOverview.compView(CID, null) }), 'curricular')).toHaveLength(0);
    // Picked, Level Mix bands by the four levels in a Letter class too.
    const letter = rowsOf(tile({ compView: 'mix' }), 'curricular');
    expect(numOf(letter[0])).toBe('3 of 4');
    expect(letter[0].getAttribute('aria-label')).toContain('Emerging 0, Developing 1, Proficient 1, Extending 2');
    // A Both class opens on Level Mix.
    setClass('both', THREE);
    expect(rowsOf(tile({ compView: DashOverview.compView(CID, null) }), 'curricular')).toHaveLength(3);
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

/* Today's Level Mix let a teacher open any level's students (with that
   level's shared next step) from its count. The tile keeps that: one button
   per level on its segment of the bar (D9). */
describe("a Level Mix row's level buttons", () => {
  const nameOf = l => competencyDistribution('', [], {}).bands[l - 1].label;
  beforeEach(() => setClass('proficiency', THREE));
  afterEach(unmount);

  it('draws one button per level with students, in the class order, sized by its count', () => {
    const el = tile({ compView: 'mix' });
    const segs = [...el.querySelectorAll('.dash-comp-lnbox')[0].querySelectorAll('[data-comp-level]')];
    // IN: Ava 2, Ben 3, Cy 4, Di 4: Developing 1, Proficient 1, Extending 2, in the class's level order.
    const order = levelOrderFor(CID).filter(l => [2, 3, 4].includes(l));
    expect(segs.map(b => Number(b.dataset.compLevel))).toEqual(order);
    const want = { 2: '1', 3: '1', 4: '2' };
    segs.forEach(b => {
      const l = Number(b.dataset.compLevel);
      expect(b.getAttribute('style')).toBe('flex:' + want[l] + ';background:var(--score-' + l + ')');
      expect(b.getAttribute('aria-label')).toMatch(new RegExp(': ' + want[l] + ' ' + nameOf(l) + '$'));
      expect(b.getAttribute('aria-expanded')).toBe('false');
      expect(b.tagName).toBe('BUTTON');
    });
    // A competency nobody is scored on has none; the row itself stays the board's button.
    const pl = [...el.querySelectorAll('.dash-comp-lnbox')].find(x => x.querySelector('[data-comp-open="s:PL"]'));
    expect(pl ? pl.querySelectorAll('[data-comp-level]').length : 0).toBe(0);
    expect(el.querySelector('.dash-comp-lnbox [data-comp-open]').tagName).toBe('BUTTON');
  });

  it("each level's button opens today's list for that level, one list at a time, and closes again", () => {
    const o = opts({ compView: 'mix' });
    const d = mount(o);
    const key = d.querySelector('.dash-comp-lnbox [data-comp-open]').dataset.compOpen;
    for (const level of [2, 3, 4]) {
      const seg = d.querySelector('[data-comp-key="' + key + '"][data-comp-level="' + level + '"]');
      DashCompetencies.toggleLevel(seg);
      const pop = d.getElementById('dash-comp-pop');
      expect(pop.hidden).toBe(false);
      // The list is today's, word for word: its heading names the level.
      const want = d.createElement('div');
      want.innerHTML = DashInsights.popHtml(CID, o.allStudents, { key, level });
      expect(pop.innerHTML).toBe(want.innerHTML);
      expect(pop.querySelector('.dash-mix-pop-head').textContent).toContain(' · ' + nameOf(level) + ' · ');
      expect(seg.getAttribute('aria-expanded')).toBe('true');
      expect(d.querySelectorAll('[aria-expanded="true"]')).toHaveLength(1);
    }
    // The row's own click swaps to the board's list of those below Proficient.
    DashCompetencies.toggle(d.querySelector('[data-comp-open="' + key + '"]'));
    expect(d.getElementById('dash-comp-pop').textContent).toContain('below');
    expect(d.querySelectorAll('[data-comp-level][aria-expanded="true"]')).toHaveLength(0);
    // The same level twice: open, then closed.
    const ext = d.querySelector('[data-comp-key="' + key + '"][data-comp-level="4"]');
    DashCompetencies.toggleLevel(ext);
    DashCompetencies.toggleLevel(ext);
    expect(d.getElementById('dash-comp-pop').hidden).toBe(true);
  });
});

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

  it('shows no hover tip for the row whose list is open, and takes a showing tip down when it opens', () => {
    const d = mount(opts());
    const box = d.getElementById('dash-comp-tipbox');
    const rowOf = key => d.querySelector('[data-comp-open="' + key + '"]');
    // A tip showing on a row comes down when that row's list opens.
    DashCompetencies.showTip(rowOf('s:EV'));
    expect(box.hidden).toBe(false);
    openRow(d, 's:EV');
    expect(box.hidden).toBe(true);
    // Pointing within the open row shows nothing.
    DashCompetencies.showTip(rowOf('s:EV'));
    expect(box.hidden).toBe(true);
    // Another row's tip still shows.
    DashCompetencies.showTip(rowOf('s:IN'));
    expect(box.hidden).toBe(false);
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

  it('counts who has self-assessed, says Only under two thirds and names its counts', () => {
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
    // Today's Core card's own test (k * 3 < n * 2): exactly two thirds is not "only".
    expect(DashCompetencies.isFew(2, 4)).toBe(true);
    expect(DashCompetencies.isFew(3, 4)).toBe(false);
    expect(DashCompetencies.isFew(2, 3)).toBe(false);
    // The sample class: 13, 16 and 11 of 27 are marked, 19 and 21 are not.
    expect([11, 13, 16, 18, 19, 21].map(k => DashCompetencies.isFew(k, 27))).toEqual([
      true,
      true,
      true,
      false,
      false,
      false,
    ]);
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

describe("each Core view's link is the one today's card uses for that view", () => {
  const head = html => dom(html).querySelector('.dash-core-head a');
  beforeEach(() => setClass('proficiency', THREE));
  it('Self-Assessment: Questionnaires; Evidence: Assignments; nothing self-assessed: Set Up a Reflection', () => {
    const self = opts({ coreSelf: { any: true, byCore: {} }, coreView: 'self' });
    expect(head(DashCompetencies.html(self)).textContent).toBe('Questionnaires →');
    const ev = opts({ coreSelf: { any: true, byCore: {} }, coreView: 'evidence' });
    expect(head(DashCompetencies.html(ev)).textContent).toBe('Assignments →');
    expect(head(DashCompetencies.html(opts())).textContent).toBe('Set Up a Reflection →');
    // And the tile adds none of its own: the head is today's card's.
    expect(DashCompetencies.html(ev)).toContain(head(DashOverview.coreCardHtml(ev)).outerHTML);
  });
});

describe("an old 'fv-build-dashRow' on the device", () => {
  it('changes nothing: the row and the tile draw with it set to 0 or not set at all (D9)', () => {
    setClass('proficiency', THREE);
    const without = DashOverview.renderOverviewPanel(opts());
    expect(without).toContain('dash-comp-tile');
    expect(without).toContain('dash-comp-ln');
    localStorage.setItem('fv-build-dashRow', '0');
    expect(DashOverview.renderOverviewPanel(opts())).toBe(without);
  });
});
