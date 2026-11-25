/**
 * The Competencies tile (the Dashboard's coverage tile): one row for each
 * competency assessed in the period with how many of the class's assessments
 * carried it, one tick for each student in their level on it, a quiet line
 * for those not assessed, and the same for the Core Competencies tagged.
 * Counts come from the assessments' tagIds and coreCompetencyIds; levels are
 * the bands competencyDistribution gives (the ones the old Level Mix drew).
 * Nothing here works out a level. Dates are made from today, so the test
 * does not age.
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

/** 'YYYY-MM-DD' for `off` days from now. */
const day = off => new Date(Date.now() + off * 86400000).toISOString().slice(0, 10);
const TODAY = day(0);
// Term 1 is over; Term 2 holds today.
const TERMS = [
  { ordinal: 1, label: 'Term 1', starts_on: day(-120), ends_on: day(-60) },
  { ordinal: 2, label: 'Term 2', starts_on: day(-30), ends_on: day(30) },
];

const sec = (id, name, extra) =>
  Object.assign({ id, name, shortName: name, tags: [{ id: 't-' + id, label: name }] }, extra);

let n = 0;
/**
 * @param {{
 *   sections: any[], groups?: any[], assessments?: any[], scores?: Record<string, Record<string, number[]>>,
 *   terms?: any[]
 * }} spec
 * assessments: { date, tags: [section ids], core?: [core ids] }
 * scores: { sectionId: { studentId: [scores...] } }, dated 10 days ago.
 */
function setClass(spec) {
  n = 0;
  COURSES[CID] = { id: CID, name: 'Socials 9', gradingSystem: 'proficiency' };
  _cache.students[CID] = STUDENTS;
  _cache.learningMaps[CID] = {
    subjects: [],
    sections: spec.sections,
    competencyGroups: spec.groups || [],
    _customized: true,
    _version: 1,
  };
  _cache.categories[CID] = [];
  const assessments = (spec.assessments || []).map(a => ({
    id: 'a' + ++n,
    title: 'Work ' + n,
    date: a.date,
    tagIds: (a.tags || []).map(t => 't-' + t),
    coreCompetencyIds: a.core || [],
  }));
  _cache.assessments[CID] = assessments;
  /** @type {Record<string, any[]>} */
  const scores = {};
  Object.entries(spec.scores || {}).forEach(([secId, byStudent]) => {
    Object.entries(byStudent).forEach(([sid, list]) => {
      list.forEach((v, i) => {
        (scores[sid] = scores[sid] || []).push({
          assessmentId: 'sc' + secId + sid + i,
          tagId: 't-' + secId,
          score: v,
          date: day(-10 - i),
        });
      });
    });
  });
  // A score needs an assessment of its own to count.
  Object.values(scores)
    .flat()
    .forEach(s => assessments.push({ id: s.assessmentId, title: s.assessmentId, date: s.date, tagIds: [s.tagId] }));
  _cache.scores[CID] = scores;
  _cache.statuses[CID] = {};
  _cache.rubrics[CID] = [];
  _cache.overrides[CID] = {};
  _cache.observations[CID] = {};
  _cache.courseConfigs[CID] = { calcMethod: 'average', reportingTerms: spec.terms === undefined ? TERMS : spec.terms };
  clearProfCache();
}

function opts(extra) {
  return Object.assign({ cid: CID, allStudents: STUDENTS, todayStr: TODAY, compPage: 'curricular' }, extra || {});
}

function dom(html) {
  return parseHTML(
    '<!doctype html><html><body><div id="root">' + html + '</div></body></html>',
  ).document.getElementById('root');
}

const tile = extra => dom(DashCompetencies.html(opts(extra)));
const rowsOf = (el, page = 'curricular') =>
  Array.from(el.querySelectorAll('#dash-comp-page-' + page + ' .dash-comp-it'));
const nameOf = r => r.querySelector('.dash-comp-it-name').textContent;
const countOf = r => Number(r.querySelector('.dash-comp-it-n').textContent);
const levelWord = l => competencyDistribution('', [], {}).bands[l - 1].label;

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  DashCompetencies.close(false);
  delete COURSES[CID];
  delete _cache.students[CID];
  delete _cache.learningMaps[CID];
  delete _cache.scores[CID];
  delete _cache.assessments[CID];
  delete _cache.courseConfigs[CID];
  localStorage.clear();
});

// Inquiry: 3 this term, 1 last term. Evidence: 1 this term. Perspective: none.
const THREE = {
  sections: [sec('IN', 'Inquiry'), sec('EV', 'Evidence'), sec('PE', 'Perspective')],
  assessments: [
    { date: day(-5), tags: ['IN'] },
    { date: day(-3), tags: ['IN', 'EV'] },
    { date: day(-1), tags: ['IN'] },
    { date: day(-90), tags: ['IN'] },
  ],
  scores: { IN: { s1: [2], s2: [3], s3: [4], s4: [4] }, EV: { s1: [1], s2: [2], s3: [2] } },
};

describe('the count beside each competency', () => {
  beforeEach(() => setClass(THREE));

  it('is how many of the class assessments in the term carry it, one row for each assessed', () => {
    const rows = rowsOf(tile());
    expect(rows.map(nameOf)).toEqual(['Inquiry', 'Evidence']);
    // The scores' own assessments carry a tag too: IN 4 + 1 (Ava's) ... count them straight.
    const inTerm = getAssignedAssessments(CID).filter(a => a.date >= TERMS[1].starts_on && a.date <= TERMS[1].ends_on);
    const carrying = id => inTerm.filter(a => (a.tagIds || []).includes('t-' + id)).length;
    expect(countOf(rows[0])).toBe(carrying('IN'));
    expect(countOf(rows[1])).toBe(carrying('EV'));
  });

  it('counts the year when Year is picked, and the term switch changes the numbers', () => {
    const term = rowsOf(tile({ compSpan: 'term' }));
    const year = rowsOf(tile({ compSpan: 'year' }));
    const all = getAssignedAssessments(CID);
    const carrying = id => all.filter(a => (a.tagIds || []).includes('t-' + id)).length;
    expect(countOf(year[0])).toBe(carrying('IN'));
    expect(countOf(year[0])).toBeGreaterThan(countOf(term[0]));
    // Perspective was never assessed: in neither.
    expect(year.map(nameOf)).toEqual(['Inquiry', 'Evidence']);
  });

  it('is the year, with no switch, when the class has no terms or today is in none', () => {
    setClass(Object.assign({}, THREE, { terms: [] }));
    let el = tile({ compSpan: 'term' });
    expect(el.querySelector('.dash-comp-span')).toBeNull();
    expect(countOf(rowsOf(el)[0])).toBe(
      getAssignedAssessments(CID).filter(a => (a.tagIds || []).includes('t-IN')).length,
    );
    setClass(Object.assign({}, THREE, { terms: [TERMS[0]] }));
    el = tile({ compSpan: 'term' });
    expect(el.querySelector('.dash-comp-span')).toBeNull();
    expect(el.textContent).toContain('Not Assessed This Year');
  });

  it('draws the switch from the term whose dates hold today: its name, then Year', () => {
    const el = tile();
    const btns = Array.from(el.querySelectorAll('#dash-comp-page-curricular .dash-comp-span .seg-btn'));
    expect(btns.map(b => b.textContent)).toEqual(['Term 2', 'Year']);
    expect(btns.map(b => b.getAttribute('aria-pressed'))).toEqual(['true', 'false']);
    expect(btns[0].dataset.action).toBe('compSpan');
    const yr = tile({ compSpan: 'year' }).querySelectorAll('#dash-comp-page-curricular .dash-comp-span .seg-btn');
    expect(Array.from(yr).map(b => b.getAttribute('aria-pressed'))).toEqual(['false', 'true']);
  });

  it('a count of one is amber, any other is not', () => {
    const rows = rowsOf(tile({ compSpan: 'year' }));
    rows.forEach(r => {
      const el = r.querySelector('.dash-comp-it-n');
      expect(el.classList.contains('is-thin')).toBe(countOf(r) === 1);
    });
    setClass({
      sections: [sec('A', 'Alpha'), sec('B', 'Beta')],
      assessments: [
        { date: day(-2), tags: ['A'] },
        { date: day(-3), tags: ['B'] },
        { date: day(-4), tags: ['B'] },
      ],
    });
    const two = rowsOf(tile());
    expect(two[0].querySelector('.is-thin')).not.toBeNull();
    expect(two[1].querySelector('.is-thin')).toBeNull();
  });

  it('leaves out a draft and work dated outside the term', () => {
    setClass({
      sections: [sec('A', 'Alpha')],
      assessments: [
        { date: day(-2), tags: ['A'] },
        { date: day(-80), tags: ['A'] },
        { date: '', tags: ['A'] },
      ],
    });
    _cache.assessments[CID].push({ id: 'draft', date: day(-1), tagIds: ['t-A'], isDraft: true });
    expect(countOf(rowsOf(tile())[0])).toBe(1);
    // The year: the dated work, and the undated; a draft takes no work.
    expect(countOf(rowsOf(tile({ compSpan: 'year' }))[0])).toBe(3);
  });
});

describe('one tick for each student', () => {
  beforeEach(() => setClass(THREE));

  it('is as many ticks as the class has students, each a button named for the student and the level', () => {
    const el = tile({ compSpan: 'year' });
    for (const r of rowsOf(el)) {
      const ticks = Array.from(r.querySelectorAll('.dash-comp-tick'));
      expect(ticks).toHaveLength(STUDENTS.length);
      ticks.forEach(t => expect(t.tagName).toBe('BUTTON'));
    }
    const first = rowsOf(el)[0].querySelectorAll('.dash-comp-tick');
    expect(first[0].getAttribute('aria-label')).toBe('Cy Eng, ' + levelWord(4));
  });

  it("are the student's level on the competency, strongest first, hollow with no mark last", () => {
    const el = tile({ compSpan: 'year' });
    const levelOf = (sec, sid) => {
      const v = getSectionProficiency(CID, sid, sec);
      return v > 0 ? Math.max(1, Math.min(4, roundLevel(v))) : 0;
    };
    const rows = rowsOf(el);
    ['IN', 'EV'].forEach((id, i) => {
      const ticks = Array.from(rows[i].querySelectorAll('.dash-comp-tick'));
      const want = IDS.map(sid => ({ sid, level: levelOf(id, sid) })).sort((a, b) => b.level - a.level);
      expect(ticks.map(t => Number(t.dataset.compLevel))).toEqual(want.map(w => w.level));
      ticks.forEach(t => {
        const l = Number(t.dataset.compLevel);
        if (l) expect(t.getAttribute('style')).toContain('var(--score-' + l + ')');
        else expect(t.classList.contains('is-none')).toBe(true);
      });
    });
    // Evidence: Di has no mark, so the last tick is hollow.
    const ev = Array.from(rows[1].querySelectorAll('.dash-comp-tick'));
    expect(ev[ev.length - 1].classList.contains('is-none')).toBe(true);
    expect(ev[ev.length - 1].getAttribute('aria-label')).toBe('Di Fox, No Mark Yet');
  });

  it('levels are as of the term when the term is picked: work after its end does not move them', () => {
    // Today falls in Term 1; Ava scores Extending two weeks into the future of it, in Term 2.
    setClass({
      sections: [sec('A', 'Alpha')],
      terms: [
        { ordinal: 1, label: 'Term 1', starts_on: day(-60), ends_on: day(20) },
        { ordinal: 2, label: 'Term 2', starts_on: day(21), ends_on: day(90) },
      ],
      assessments: [
        { date: day(-5), tags: ['A'] },
        { date: day(40), tags: ['A'] },
      ],
    });
    _cache.scores[CID] = {
      s1: [
        { assessmentId: _cache.assessments[CID][0].id, tagId: 't-A', score: 2, date: day(-5) },
        { assessmentId: _cache.assessments[CID][1].id, tagId: 't-A', score: 4, date: day(40) },
      ],
    };
    clearProfCache();
    const level = o => {
      const r = rowsOf(tile(o))[0];
      return r.querySelector('[data-comp-sid="s1"]').dataset.compLevel;
    };
    expect(level({ compSpan: 'term' })).toBe('2');
    expect(level({ compSpan: 'year' })).toBe(
      String(Math.max(1, Math.min(4, roundLevel(getSectionProficiency(CID, 's1', 'A'))))),
    );
    expect(getActiveTerm(CID)).toBeNull();
  });
});

describe('folders', () => {
  const GROUPS = [
    { id: 'g1', name: 'Questioning', sortOrder: 1 },
    { id: 'g2', name: 'Evaluating', sortOrder: 2 },
    { id: 'g3', name: 'Empty Folder', sortOrder: 3 },
  ];

  it('a name is a heading over its rows only with more than one folder, and none for a folder with no row', () => {
    setClass({
      sections: [
        sec('A', 'Alpha', { groupId: 'g1' }),
        sec('B', 'Beta', { groupId: 'g2' }),
        sec('C', 'Gamma', { groupId: 'g3' }),
      ],
      groups: GROUPS,
      assessments: [
        { date: day(-2), tags: ['A'] },
        { date: day(-2), tags: ['B'] },
      ],
    });
    const el = tile();
    const heads = Array.from(el.querySelectorAll('#dash-comp-page-curricular .dash-comp-fold')).map(h => h.textContent);
    expect(heads).toEqual(['Questioning', 'Evaluating']);
    // The competency not assessed is in the quiet line, not under a heading.
    expect(el.querySelector('.dash-comp-na-name').textContent).toBe('Gamma');
  });

  it('draws no heading when only one folder has rows, or the class has no folders', () => {
    setClass({
      sections: [sec('A', 'Alpha', { groupId: 'g1' }), sec('B', 'Beta', { groupId: 'g2' })],
      groups: GROUPS,
      assessments: [{ date: day(-2), tags: ['A'] }],
    });
    expect(tile().querySelectorAll('.dash-comp-fold')).toHaveLength(0);
    setClass({ sections: [sec('A', 'Alpha'), sec('B', 'Beta')], assessments: [{ date: day(-2), tags: ['A', 'B'] }] });
    expect(tile().querySelectorAll('.dash-comp-fold')).toHaveLength(0);
  });

  it("lists rows in the class's own order, folder by folder", () => {
    setClass({
      sections: [sec('A', 'Alpha', { groupId: 'g2' }), sec('B', 'Beta', { groupId: 'g1' }), sec('C', 'Gamma')],
      groups: GROUPS,
      assessments: [{ date: day(-2), tags: ['A', 'B', 'C'] }],
    });
    const el = tile();
    expect(rowsOf(el).map(nameOf)).toEqual(['Beta', 'Alpha', 'Gamma']);
    expect(Array.from(el.querySelectorAll('.dash-comp-fold')).map(h => h.textContent)).toEqual([
      'Questioning',
      'Evaluating',
      'Other Competencies',
    ]);
  });
});

describe('the quiet line', () => {
  it('counts the competencies with no assessment in the period and opens to their names', () => {
    setClass(THREE);
    const el = tile();
    const btn = el.querySelector('#dash-comp-page-curricular .dash-comp-quiet');
    expect(btn.textContent).toBe('1 Not Assessed This Term');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    const names = el.querySelectorAll('#dash-comp-page-curricular .dash-comp-na-name');
    expect(Array.from(names).map(b => b.textContent)).toEqual(['Perspective']);
    // A button that opens New Assessment with that competency's tags.
    expect(names[0].tagName).toBe('BUTTON');
    expect(names[0].dataset.compNew).toBe('t-PE');
    expect(el.querySelector('#dash-comp-na-curricular').hidden).toBe(true);
    // In the year, Perspective is still unassessed, and it says Year.
    expect(tile({ compSpan: 'year' }).querySelector('.dash-comp-quiet').textContent).toBe('1 Not Assessed This Year');
  });

  it('names the competencies assessed last term but not this one, and none when all are assessed', () => {
    setClass({
      sections: [sec('A', 'Alpha'), sec('B', 'Beta')],
      assessments: [
        { date: day(-2), tags: ['A'] },
        { date: day(-90), tags: ['B'] },
      ],
    });
    const term = tile();
    expect(
      Array.from(term.querySelectorAll('#dash-comp-page-curricular .dash-comp-na-name')).map(b => b.textContent),
    ).toEqual(['Beta']);
    // The year has both, so no line at all.
    expect(tile({ compSpan: 'year' }).querySelector('#dash-comp-page-curricular .dash-comp-quiet')).toBeNull();
  });
});

describe('Core', () => {
  beforeEach(() =>
    setClass({
      sections: [sec('A', 'Alpha')],
      assessments: [
        { date: day(-2), tags: ['A'], core: ['CRT', 'COM'] },
        { date: day(-3), tags: ['A'], core: ['CRT'] },
        { date: day(-4), tags: ['A'], core: ['CRT', 'COM', 'CT'] },
        { date: day(-90), tags: ['A'], core: ['SAR'] },
      ],
    }),
  );

  it('lists each Core Competency tagged, the most tagged first, with its count and a bar sized by its count', () => {
    const el = tile({ compPage: 'core' });
    const rows = rowsOf(el, 'core');
    expect(rows.map(nameOf)).toEqual(['Critical & Reflective Thinking', 'Communicating', 'Creative Thinking']);
    expect(rows.map(countOf)).toEqual([3, 2, 1]);
    expect(rows.map(r => r.querySelector('.dash-comp-bar i').getAttribute('style'))).toEqual([
      '--n:3;--top:3',
      '--n:2;--top:3',
      '--n:1;--top:3',
    ]);
    // No amber, no ticks, no buttons on a name.
    expect(el.querySelector('#dash-comp-page-core .is-thin')).toBeNull();
    expect(el.querySelector('#dash-comp-page-core .dash-comp-tick')).toBeNull();
    expect(el.querySelector('#dash-comp-page-core button.dash-comp-it-name')).toBeNull();
  });

  it('counts the year when Year is picked and lists the rest as not tagged', () => {
    const term = tile({ compPage: 'core' });
    expect(term.querySelector('#dash-comp-page-core .dash-comp-quiet').textContent).toBe('4 Not Tagged This Term');
    const year = tile({ compPage: 'core', compSpan: 'year' });
    expect(rowsOf(year, 'core').map(nameOf)).toContain('Social Awareness & Responsibility');
    expect(year.querySelector('#dash-comp-page-core .dash-comp-quiet').textContent).toBe('3 Not Tagged This Year');
    const names = Array.from(term.querySelectorAll('#dash-comp-page-core .dash-comp-na-name')).map(x => x.textContent);
    expect(names).toEqual([
      'Collaborating',
      'Personal & Cultural Identity',
      'Personal Awareness & Responsibility',
      'Social Awareness & Responsibility',
    ]);
  });

  it('says so in one plain sentence when nothing is tagged', () => {
    setClass({ sections: [sec('A', 'Alpha')], assessments: [{ date: day(-2), tags: ['A'] }] });
    const el = tile({ compPage: 'core' });
    expect(rowsOf(el, 'core')).toHaveLength(0);
    expect(el.querySelector('#dash-comp-page-core .dash-comp-plain').textContent).toBe(
      'Nothing is tagged this term yet.',
    );
    expect(el.querySelector('#dash-comp-page-core .dash-comp-quiet').textContent).toBe('7 Not Tagged This Term');
  });
});

describe('what the tile no longer has', () => {
  it('has no view menu, legend, column heads for levels, counts in words or Lowest and Only tags', () => {
    setClass(THREE);
    const html = DashCompetencies.html(opts());
    for (const gone of [
      'dash-view-btn',
      'Level Mix',
      'Class Average',
      'Needs Support',
      'Proficient or Above',
      'dash-comp-legend',
      'dash-comp-labels',
      'Lowest',
      'Only',
      'Self-Assessment',
      'Evidence</span>',
    ]) {
      expect(html).not.toContain(gone);
    }
  });

  it('a class with no competencies says so; one with none assessed says nothing is yet, with its names behind the line', () => {
    setClass({ sections: [] });
    expect(tile().textContent).toContain('No competencies in this class yet.');
    setClass({ sections: [sec('A', 'Alpha'), sec('B', 'Beta')], assessments: [] });
    const el = tile();
    expect(el.querySelector('#dash-comp-page-curricular .dash-comp-plain').textContent).toBe(
      'Nothing assessed this term yet.',
    );
    expect(el.querySelector('#dash-comp-page-curricular .dash-comp-quiet').textContent).toBe(
      '2 Not Assessed This Term',
    );
  });

  it('the headings name their column in a dark word: Assessed on Curricular, Tagged on Core', () => {
    setClass(THREE);
    const el = tile();
    expect(el.querySelector('#dash-comp-page-curricular .dash-comp-colhead').textContent).toBe('Assessed');
    expect(el.querySelector('#dash-comp-page-core .dash-comp-colhead').textContent).toBe('Tagged');
    expect(el.querySelector('#dash-comp-page-curricular .dash-comp-sub-link').textContent).toBe('Gradebook →');
    expect(el.querySelector('#dash-comp-page-core .dash-comp-sub-link').textContent).toBe('Assignments →');
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

describe("a tick's list", () => {
  beforeEach(() => setClass(THREE));
  afterEach(unmount);

  it("opens the students at that level, as the old Level Mix bar's segment did, one list at a time, and closes again", () => {
    const o = opts({ compSpan: 'year' });
    const d = mount(o);
    const row = d.querySelector('.dash-comp-it');
    const key = row.querySelector('[data-comp-tick]').dataset.compKey;
    expect(key).toBe('s:IN');
    const ext = row.querySelector('[data-comp-level="4"]');
    DashCompetencies.toggleTick(ext);
    const pop = d.getElementById('dash-comp-pop');
    expect(pop.hidden).toBe(false);
    const want = d.createElement('div');
    want.innerHTML = DashInsights.popHtml(CID, o.allStudents, { key, level: 4 });
    expect(pop.innerHTML).toBe(want.innerHTML);
    expect(pop.querySelector('.dash-mix-pop-head').textContent).toContain(levelWord(4));
    expect(ext.getAttribute('aria-expanded')).toBe('true');
    // Another level swaps the list; the same tick twice closes it.
    const dev = row.querySelector('[data-comp-level="2"]');
    DashCompetencies.toggleTick(dev);
    expect(pop.querySelector('.dash-mix-pop-head').textContent).toContain(levelWord(2));
    expect(d.querySelectorAll('[data-comp-tick][aria-expanded="true"]')).toHaveLength(1);
    DashCompetencies.toggleTick(dev);
    expect(d.getElementById('dash-comp-pop').hidden).toBe(true);
  });

  it('keeps the open list across a redraw', () => {
    const o = opts({ compSpan: 'year' });
    const d = mount(o);
    DashCompetencies.toggleTick(d.querySelector('[data-comp-level="3"]'));
    const again = dom(DashCompetencies.html(o));
    expect(again.querySelector('#dash-comp-pop').hidden).toBe(false);
    expect(again.querySelector('#dash-comp-pop').innerHTML).toContain('dash-mix-pop-head');
  });
});

describe('the tile is only ever drawn through esc', () => {
  it('a competency named with markup is text', () => {
    setClass({ sections: [sec('A', '<img src=x onerror=alert(1)>')], assessments: [{ date: day(-2), tags: ['A'] }] });
    const html = DashCompetencies.html(opts());
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
});
