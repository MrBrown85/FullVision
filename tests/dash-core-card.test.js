/**
 * The dashboard's Core Competencies card (docs/plans/dashboard-cards-plan.md,
 * part C): Self-Assessment, one blue square per student for the step they
 * gave this term, and Evidence, one square per tagged assessment and
 * observation; with no self-assessment in the class this term, Evidence only
 * and a link to set up a reflection. The term comes from
 * shared/core-self.js, which the student page reads too.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CID = 'core-card';
const STUDENTS = [
  { id: 's1', firstName: 'Ava', lastName: 'Chan' },
  { id: 's2', firstName: 'Ben', lastName: 'Diaz' },
  { id: 's3', firstName: 'Cy', lastName: 'Eng' },
];
const IDS = STUDENTS.map(s => s.id);
const TERMS = [
  { ordinal: 1, label: 'Term 1', starts_on: '2000-01-01', ends_on: '2000-06-30' },
  { ordinal: 2, label: 'Term 2', starts_on: '2000-07-01', ends_on: '2099-12-31' },
];

function setSelf(data) {
  _cache.coreSelf[CID] = data;
}

function card(extra) {
  return DashOverview.coreCardHtml(
    Object.assign(
      {
        cid: CID,
        allStudents: STUDENTS,
        ccCounts: {},
        ccAssessments: {},
        ccObs: {},
        coreSelf: coreSelfRatings(CID, IDS),
        coreView: 'self',
      },
      extra || {},
    ),
  );
}

// One row's markup, by its core competency id.
function row(html, id) {
  const at = html.lastIndexOf('<div class="dash-core-row', html.indexOf('data-core="' + id + '"'));
  const end = html.indexOf('<div class="dash-core-row', at + 1);
  return html.slice(at, end < 0 ? undefined : end);
}

const count = (s, re) => (s.match(re) || []).length;

describe('Core Competencies card', () => {
  let voice;

  beforeEach(() => {
    localStorage.clear();
    COURSES[CID] = { id: CID, name: 'Socials 9', gradingSystem: 'proficiency' };
    _cache.students[CID] = STUDENTS;
    _cache.courseConfigs[CID] = { reportingTerms: TERMS };
    setSelf({});
    voice = { loaded: StudentVoice.loaded, entries: StudentVoice.entries };
  });

  afterEach(() => {
    StudentVoice.loaded = voice.loaded;
    StudentVoice.entries = voice.entries;
    delete COURSES[CID];
    delete _cache.coreSelf[CID];
    delete _cache.courseConfigs[CID];
  });

  it('reads this term: the one today falls in, else the picked one, else the term in view', () => {
    expect(coreSelfTerm(CID).key).toBe('T2');
    expect(coreSelfTerm(CID, 1).key).toBe('T1');
    expect(coreSelfTerm(CID, null, { ordinal: 1 }).key).toBe('T1');
    expect(coreSelfTerm(CID, 2, { ordinal: 1 }).key).toBe('T2');
    _cache.courseConfigs[CID] = { reportingTerms: [] };
    expect(coreSelfTerm(CID)).toEqual({ terms: [], key: '' });
  });

  it('with no self-assessment this term: Evidence only, no menu, and Set Up a Reflection', () => {
    // A step from last term doesn't count.
    setSelf({ s1: { T1: { COM: { level: 3 } } } });
    const html = card();
    expect(html).not.toContain('dash-view-btn');
    expect(html).toContain('<span class="dash-core-sub">Evidence</span>');
    expect(html).toContain(
      'data-href="/dashboard?course=core-card&amp;manage=questionnaires">Set Up a Reflection →</a>',
    );
    expect(html).toContain('dash-core-list dash-core-evidence');
  });

  it('Self-Assessment: one square per student, Leading first, then grey; "k of N"', () => {
    setSelf({ s1: { T2: { COM: { level: 2 } } }, s2: { T2: { COM: { level: 4 }, CT: { level: 1 } } } });
    const html = card();
    expect(html).toContain('data-action="viewMenu" data-menu="core"');
    expect(html).toContain('data-href="/dashboard?course=core-card&amp;manage=questionnaires">Questionnaires →</a>');
    const com = row(html, 'COM');
    expect(count(com, /class="dash-core-sq /g)).toBe(3);
    const titles = [...com.matchAll(/class="dash-core-sq ([^"]+)" title="([^"]+)"/g)].map(m => [m[1], m[2]]);
    expect(titles).toEqual([
      ['is-self-4', 'Ben Diaz: Leading'],
      ['is-self-2', 'Ava Chan: Growing'],
      ['is-none', 'Cy Eng: not yet'],
    ]);
    expect(com).toContain('<span class="dash-core-val">2 of 3</span>');
    expect(com).toContain('Leading 1 · Confident 0 · Growing 1 · Beginning 0');
    expect(com).toContain('Not yet: Cy Eng');
  });

  it('is amber under two thirds of the class', () => {
    setSelf({ s1: { T2: { COM: { level: 3 }, CT: { level: 3 } } }, s2: { T2: { COM: { level: 3 } } } });
    const html = card();
    expect(row(html, 'COM')).toContain('<span class="dash-core-val">2 of 3</span>');
    expect(row(html, 'CT')).toContain('<span class="dash-core-val is-amber">1 of 3</span>');
    expect(row(html, 'SAR')).toContain('<span class="dash-core-val is-amber">0 of 3</span>');
  });

  it("lists the first 8 who haven't, then +N more", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ id: 'm' + i, firstName: 'P' + i, lastName: 'Q' + i }));
    setSelf({ m0: { T2: { COM: { level: 3 } } } });
    const html = DashOverview.coreCardHtml({
      cid: CID,
      allStudents: many,
      coreSelf: coreSelfRatings(
        CID,
        many.map(s => s.id),
      ),
      coreView: 'self',
    });
    const line = row(html, 'COM').match(/Not yet: ([^<]+)</)[1];
    expect(line.split(', ').length).toBe(9);
    expect(line).toMatch(/, \+3 more$/);
  });

  it("the teacher's entry wins over the student's own; the student's counts where there is none", () => {
    setSelf({ s1: { T2: { COM: { level: 4 } } } });
    StudentVoice.loaded = () => true;
    const reflection = levels => [
      {
        kind: 'core_reflection',
        period: 2,
        at: '2026-11-01T10:00:00Z',
        items: [{ q: { kind: 'scale4', core_ids: ['COM', 'COL'] }, v: { json: { levels } } }],
      },
    ];
    StudentVoice.entries = (cid, sid) =>
      sid === 's1' ? reflection({ COM: 1 }) : sid === 's3' ? reflection({ COL: 3 }) : [];
    const ratings = coreSelfRatings(CID, IDS);
    expect(ratings.byCore.COM).toEqual({ s1: 4 });
    expect(ratings.byCore.COL).toEqual({ s3: 3 });
    const html = card({ coreSelf: ratings });
    expect(row(html, 'COM')).toContain('title="Ava Chan: Leading"');
    expect(row(html, 'COL')).toContain('title="Cy Eng: Confident"');
    // Last term's reflection doesn't count this term.
    StudentVoice.entries = () => reflection({ COM: 2 }).map(e => Object.assign(e, { period: 1 }));
    setSelf({});
    expect(coreSelfRatings(CID, IDS).any).toBe(false);
  });

  it('Evidence: a dark square per tagged assessment, a light one per observation, and the total', () => {
    setSelf({ s1: { T2: { COM: { level: 3 } } } });
    const html = card({
      coreView: 'evidence',
      ccCounts: { CRT: 2 },
      ccAssessments: { CRT: ['Causes Essay', 'Source Analysis'] },
      ccObs: { CRT: 3, COL: 1 },
    });
    expect(html).toContain('data-href="/assignments?course=core-card">Assignments →</a>');
    expect(html).toContain('<span>Evidence</span>');
    const crt = row(html, 'CRT');
    expect(count(crt, /dash-core-sq is-work/g)).toBe(2);
    expect(count(crt, /dash-core-sq is-obs/g)).toBe(3);
    expect(crt).toContain('<span class="dash-core-val">5</span>');
    expect(crt).toContain(
      '<div class="dist-tip-name">Causes Essay</div><div class="dist-tip-name">Source Analysis</div>',
    );
    expect(crt).toContain('3 observations');
    expect(row(html, 'COL')).toContain('<span class="dash-core-val">1</span>');
    expect(row(html, 'COL')).toContain('1 observation<');
    const ct = row(html, 'CT');
    expect(ct).toContain('dash-core-row is-empty');
    expect(ct).toContain('<span class="dash-core-val is-amber">None yet</span>');
    expect(ct).toContain('Tag work in Assignments, or an observation with + Add Tag');
  });

  it('defaults to Self-Assessment when any student has one, and keeps Evidence when picked', () => {
    setSelf({ s1: { T2: { COM: { level: 3 } } } });
    expect(DashOverview.coreView({ coreSelf: coreSelfRatings(CID, IDS) })).toBe('self');
    expect(DashOverview.coreView({ coreSelf: coreSelfRatings(CID, IDS), coreView: 'evidence' })).toBe('evidence');
    setSelf({});
    expect(DashOverview.coreView({ coreSelf: coreSelfRatings(CID, IDS), coreView: 'self' })).toBe('evidence');
    expect(DashOverview.coreView({})).toBe('evidence');
  });

  it('groups the rows beside a bar per group, with no headings', () => {
    setSelf({ s1: { T2: { COM: { level: 3 } } } });
    for (const view of ['self', 'evidence']) {
      const html = card({ coreView: view });
      const bars = [...html.matchAll(/<span class="dash-core-gbar" title="([^"]+)" aria-hidden="true">/g)].map(
        m => m[1],
      );
      expect(bars).toEqual(['Communication', 'Thinking', 'Personal &amp; Social']);
      const groups = html.split('class="dash-core-group"').slice(1);
      expect(groups.map(g => count(g, /class="dash-core-row[" ]/g))).toEqual([2, 2, 3]);
      // Every row is there in every view, so the card keeps its height.
      expect(count(html, /class="dash-core-row[" ]/g)).toBe(7);
    }
  });

  it("the groups share the card's height: each grows by its rows, a gap between them (plan F.2)", () => {
    const html = card({ coreView: 'evidence' });
    expect([...html.matchAll(/style="--core-rows:(\d)"/g)].map(m => m[1])).toEqual(['2', '2', '3']);
    expect(count(html, /class="dash-core-gap"/g)).toBe(2);
    // Every name keeps its full text in a title.
    expect(html).toContain('<span class="dash-core-name" title="Personal Awareness &amp; Responsibility">');
  });

  it("the Self-Assessment tip ends with the questionnaire while anyone hasn't (plan F.7b)", () => {
    setSelf({
      s1: { T2: { COM: { level: 3 } } },
      s2: { T2: { COM: { level: 2 } } },
      s3: { T2: { COM: { level: 4 } } },
    });
    const html = card({ coreView: 'self' });
    expect(row(html, 'COM')).not.toContain('Open the Questionnaire');
    const ct = row(html, 'CT');
    expect(ct).toContain(
      '<a class="dash-core-tip-link" role="link" tabindex="0" data-href="/dashboard?course=' +
        CID +
        '&amp;manage=questionnaires">Open the Questionnaire →</a>',
    );
    expect(ct.indexOf('Not yet:')).toBeLessThan(ct.indexOf('Open the Questionnaire'));
  });

  it('escapes names and titles', () => {
    setSelf({ s1: { T2: { COM: { level: 3 } } } });
    const html = DashOverview.coreCardHtml({
      cid: CID,
      allStudents: [{ id: 's1', firstName: '<b>', lastName: 'X' }],
      coreSelf: coreSelfRatings(CID, ['s1']),
      coreView: 'self',
    });
    expect(html).not.toContain('<b>');
    const ev = card({ coreView: 'evidence', ccCounts: { COM: 1 }, ccAssessments: { COM: ['<i>Lab</i>'] } });
    expect(ev).not.toContain('<i>');
    expect(ev).toContain('&lt;i&gt;Lab&lt;/i&gt;');
  });

  it('the overview still draws the card for older callers', () => {
    const html = DashOverview.renderOverviewPanel({
      cid: CID,
      sections: [],
      allStudents: STUDENTS,
      assessments: [],
      sectionClassAvgs: [],
      tagsWithEvidence: 0,
      allTags: [],
      ccCounts: { COM: 1 },
      ccAssessments: { COM: ['Lab'] },
    });
    expect(html).toContain('dash-core-list dash-core-evidence');
    expect(row(html, 'COM')).toContain('<span class="dash-core-val">1</span>');
  });
});
