/**
 * The Dashboard's middle row behind the dashRow switch (D2 of
 * docs/plans/dashboard-inbox-plan.md): the height rule, the left column's
 * two shapes, Recent Assessments' model, and the Competencies tile. With the
 * switch off, renderOverviewPanel draws what it always did.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';

const CID = 'dash-row';
const STUDENTS = [
  { id: 's1', firstName: 'Ava', lastName: 'Chan' },
  { id: 's2', firstName: 'Ben', lastName: 'Diaz' },
  { id: 's3', firstName: 'Cy', lastName: 'Eng' },
];

function setFlags(on) {
  localStorage.clear();
  for (const [k, v] of Object.entries(on)) if (v) localStorage.setItem('fv-build-' + k, '1');
}

function opts(extra) {
  return Object.assign(
    {
      cid: CID,
      sections: [],
      allStudents: STUDENTS,
      assessments: [],
      classAvg: 0,
      classR: 0,
      ccCounts: {},
      ccAssessments: {},
      ccObs: {},
      coreSelf: coreSelfRatings(
        CID,
        STUDENTS.map(s => s.id),
      ),
      coreView: 'self',
      compView: 'mix',
      obs: {},
      classChange: null,
      mixPop: null,
      helpRule: null,
      naComp: null,
    },
    extra || {},
  );
}

beforeEach(() => {
  localStorage.clear();
  COURSES[CID] = { id: CID, name: 'Science 8', gradingSystem: 'proficiency' };
  _cache.students[CID] = STUDENTS;
  _cache.assessments[CID] = [];
  _cache.scores[CID] = {};
  _cache.coreSelf[CID] = {};
});

afterEach(() => {
  delete COURSES[CID];
  delete _cache.students[CID];
  delete _cache.assessments[CID];
  delete _cache.scores[CID];
  delete _cache.coreSelf[CID];
  delete window.DashBulletins;
  delete window.DashInbox;
  localStorage.clear();
});

describe('the row height rule', () => {
  it('is the window less where the row starts less 12, never under 510', () => {
    expect(DashOverview.rowHeight(800, 278)).toBe(510);
    expect(DashOverview.rowHeight(900, 278)).toBe(610);
    expect(DashOverview.rowHeight(720, 278)).toBe(510); // 430 by the rule: the floor
    expect(DashOverview.rowHeight(900, 318)).toBe(570); // a taller start: the photo-expiry line
    expect(DashOverview.rowHeight(1000, 278)).toBe(710);
    expect(DashOverview.rowHeight(400, 278)).toBe(510);
    // 200% zoom on an 800 px window: a 400 px tall layout viewport. The floor holds.
    expect(DashOverview.rowHeight(400, 278)).toBe(510);
    expect(DashOverview.rowHeight(450, 278)).toBe(510);
  });
});

// The flag-off row is guarded byte for byte against the pre-D2 output in
// tests/dash-overview-flag-off.test.js.

describe('with the dashRow switch on', () => {
  beforeEach(() => setFlags({ dashRow: true }));

  it('draws one row: the left column, then the one Competencies tile', () => {
    const html = DashOverview.renderOverviewPanel(opts());
    expect(html).toContain('<div class="dash-row"');
    expect(html).not.toContain('dash-overview-cards');
    expect(html.indexOf('dash-row-left')).toBeLessThan(html.indexOf('dash-comp-tile'));
    expect(html).toContain('dash-recent'); // no Inbox yet: Recent Assessments holds the slot
    expect(html).not.toContain('dash-row-bulletins');
    expect(html).not.toContain('has-bulletins');
  });

  it('gives the Inbox slot to DashInbox when it exists and the class takes work', () => {
    window.DashInbox = { html: () => '<section id="stub-inbox"></section>' };
    // The class does not take work: Recent Assessments still.
    expect(DashOverview.renderOverviewPanel(opts())).toContain('dash-recent');
    const was = GraderWork.workOnInClass;
    GraderWork.workOnInClass = () => true;
    try {
      const html = DashOverview.renderOverviewPanel(opts());
      expect(html).toContain('id="stub-inbox"');
      expect(html).not.toContain('dash-recent');
    } finally {
      GraderWork.workOnInClass = was;
    }
  });

  it('splits the column only with the bulletins flag on and DashBulletins built', () => {
    window.DashBulletins = { html: () => '<section id="stub-bulletins"></section>', destroy: () => {} };
    // Built, flag off: the Inbox has the whole column.
    let html = DashOverview.renderOverviewPanel(opts());
    expect(html).not.toContain('stub-bulletins');
    expect(html).not.toContain('has-bulletins');
    // Flag on, not built: the same.
    delete window.DashBulletins;
    setFlags({ dashRow: true, bulletins: true });
    html = DashOverview.renderOverviewPanel(opts());
    expect(html).not.toContain('has-bulletins');
    // Both: the split.
    window.DashBulletins = { html: () => '<section id="stub-bulletins"></section>', destroy: () => {} };
    html = DashOverview.renderOverviewPanel(opts());
    expect(html).toContain('dash-row-left has-bulletins');
    expect(html).toContain('<div class="dash-row-slot dash-row-bulletins"><section id="stub-bulletins">');
  });

  it('draws the tile from the open page, Curricular by default', () => {
    expect(DashOverview.renderOverviewPanel(opts())).toContain('<section class="dash-comp-tile"');
    expect(DashOverview.renderOverviewPanel(opts())).toContain('data-page="curricular"');
    expect(DashOverview.renderOverviewPanel(opts({ compPage: 'core' }))).toContain('data-page="core"');
  });
});

describe('Recent Assessments', () => {
  beforeEach(() => {
    _cache.assessments[CID] = [
      { id: 'a1', title: 'Old Lab', date: '2026-09-10' },
      { id: 'a3', title: 'Newest Quiz', date: '2026-11-02' },
      { id: 'a2', title: 'Middle <b>Test</b>', date: '2026-10-05' },
      { id: 'ad', title: 'Draft Piece', date: '2026-11-10', isDraft: true },
    ];
    _cache.scores[CID] = {
      s1: [
        { assessmentId: 'a3', tagId: 't1', score: 3 },
        { assessmentId: 'a2', tagId: 't1', score: 2 },
      ],
      s2: [{ assessmentId: 'a3', tagId: 't1', score: 4 }],
    };
  });

  it('lists the newest first and leaves drafts out', () => {
    const m = DashRecent.model(CID, STUDENTS);
    expect(m.rows.map(r => r.id)).toEqual(['a3', 'a2', 'a1']);
  });

  it('counts assessed with the Assignments page helper, hasScoreOrFeedback', () => {
    const m = DashRecent.model(CID, STUDENTS);
    for (const r of m.rows) {
      const expected = STUDENTS.filter(s => hasScoreOrFeedback(CID, s.id, r.id)).length;
      expect(r.assessed).toBe(expected);
      expect(r.total).toBe(3);
    }
    expect(m.rows.map(r => r.assessed)).toEqual([2, 1, 0]);
  });

  it('links each row to the piece in Assignments and escapes titles', () => {
    const html = DashRecent.html(CID, STUDENTS);
    expect(html).toContain('data-href="/assignments?course=' + CID + '&amp;open=a3"');
    expect(html).toContain('2 of 3 assessed');
    expect(html).toContain('Middle &lt;b&gt;Test&lt;/b&gt;');
    expect(html).not.toContain('<b>Test</b>');
    expect(html).toContain('Recent Assessments');
    expect(html).not.toContain('Draft Piece');
  });

  it('says how to send work only while Send Work is off', () => {
    expect(DashRecent.html(CID, STUDENTS)).toContain('Students can send photos of their work once Send Work is on.');
    expect(DashRecent.html(CID, STUDENTS)).toContain('manage=student-page');
    const was = window.getCourseSendWork;
    globalThis.getCourseSendWork = () => ({ send_work: true });
    try {
      expect(DashRecent.html(CID, STUDENTS)).not.toContain('once Send Work is on');
    } finally {
      globalThis.getCourseSendWork = was;
    }
  });

  it('says so when the class has no assessments', () => {
    _cache.assessments[CID] = [];
    expect(DashRecent.html(CID, STUDENTS)).toContain('No assessments in this class yet.');
  });
});

describe('the Competencies tile', () => {
  it('reads a saved choice: Core only when it says Core', () => {
    expect(DashCompetencies.pageOf(null)).toBe('curricular');
    expect(DashCompetencies.pageOf('nonsense')).toBe('curricular');
    expect(DashCompetencies.pageOf('core')).toBe('core');
    expect(DashCompetencies.PREF_KEY).toBe('fv-dash-comp-page:');
  });

  it('draws two tabs and two pages with the open one selected', () => {
    const html = DashCompetencies.html(opts({ compPage: 'core' }));
    expect(html).toContain('role="tablist"');
    expect(html).toMatch(/id="dash-comp-tab-core" role="tab" aria-selected="true"/);
    expect(html).toMatch(/id="dash-comp-tab-curricular" role="tab" aria-selected="false"/);
    expect(html).toContain('>Curricular</button>');
    expect(html).toContain('>Core</button>');
    // Each page holds today's card, unchanged.
    expect(html).toContain(DashOverview.competenciesCardHtml(opts({ compPage: 'core' })));
    expect(html).toContain(DashOverview.coreCardHtml(opts({ compPage: 'core' })));
    expect(html).toMatch(/dash-comp-page is-on" id="dash-comp-page-core"/);
    expect(html).toMatch(/class="dash-comp-page" id="dash-comp-page-curricular"/);
  });

  it('moves between the two with the arrow keys, Home and End', () => {
    expect(DashCompetencies.pageForKey('curricular', 'ArrowRight')).toBe('core');
    expect(DashCompetencies.pageForKey('core', 'ArrowRight')).toBe('curricular');
    expect(DashCompetencies.pageForKey('core', 'ArrowLeft')).toBe('curricular');
    expect(DashCompetencies.pageForKey('curricular', 'ArrowLeft')).toBe('core');
    expect(DashCompetencies.pageForKey('core', 'Home')).toBe('curricular');
    expect(DashCompetencies.pageForKey('curricular', 'End')).toBe('core');
    expect(DashCompetencies.pageForKey('core', 'Enter')).toBeNull();
  });

  it('show() flips aria-selected on the real markup, with the real segSelect', () => {
    const { document: doc } = parseHTML('<html><body>' + DashCompetencies.html(opts()) + '</body></html>');
    // linkedom has no layout: the pill's glide measures boxes, so give it some.
    const box = { top: 0, left: 0, width: 80, height: 28, right: 80, bottom: 28 };
    doc.querySelectorAll('.dash-comp-tile *').forEach(el => (el.getBoundingClientRect = () => box));
    const sel = id => doc.querySelector('#dash-comp-tab-' + id).getAttribute('aria-selected');
    expect([sel('curricular'), sel('core')]).toEqual(['true', 'false']);
    DashCompetencies.show(doc, 'core');
    expect([sel('curricular'), sel('core')]).toEqual(['false', 'true']);
    expect(doc.querySelector('#dash-comp-tab-core').classList.contains('active')).toBe(true);
    DashCompetencies.show(doc, 'curricular');
    expect([sel('curricular'), sel('core')]).toEqual(['true', 'false']);
  });

  it('show() turns the tile in place and keeps one tab in the tab order', () => {
    const { document: doc } = parseHTML('<html><body>' + DashCompetencies.html(opts()) + '</body></html>');
    const was = globalThis.segSelect;
    globalThis.segSelect = () => {}; // the pill's glide measures boxes, which linkedom has none of
    try {
      const tab = DashCompetencies.show(doc, 'core');
      expect(tab.id).toBe('dash-comp-tab-core');
      expect(doc.querySelector('.dash-comp-tile').getAttribute('data-page')).toBe('core');
      expect(doc.querySelector('#dash-comp-page-core').classList.contains('is-on')).toBe(true);
      expect(doc.querySelector('#dash-comp-page-curricular').classList.contains('is-on')).toBe(false);
      expect(doc.querySelector('#dash-comp-tab-core').getAttribute('tabindex')).toBe('0');
      expect(doc.querySelector('#dash-comp-tab-curricular').getAttribute('tabindex')).toBe('-1');
      expect(DashCompetencies.show(parseHTML('<html><body></body></html>').document, 'core')).toBeNull();
    } finally {
      globalThis.segSelect = was;
    }
  });
});
