/**
 * The glance row's Next Report card (teacher/dash-next-report.js, Colin, Nov 26 2026): the class's next report that has
 * not ended, how many of its comments are approved, and when it ends; it opens Write Comments.
 */
import './setup.js';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

describe('Next Report', () => {
  let terms, ratings, today;
  beforeAll(() => {
    runInThisContext(readFileSync(new URL('../teacher/dash-next-report.js', import.meta.url), 'utf8'));
  });
  const saved = {};
  const stub = (name, fn) => {
    saved[name] = globalThis[name];
    globalThis[name] = fn;
  };
  afterEach(() => {
    Object.keys(saved).forEach(k => (globalThis[k] = saved[k]));
  });
  const setUp = () => {
    stub('getReportingTerms', () => terms);
    stub('courseToday', () => today);
    stub('reportingTermReportNames', () => null);
    stub('getStudentTermRating', (cid, sid, termId) => (ratings[termId] || {})[sid] || null);
  };
  const students = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  it('names the first report that has not ended, with its approved count and end day', () => {
    terms = [
      { ordinal: 1, label: 'Term 1', starts_on: '2026-09-01', ends_on: '2026-11-06' },
      { ordinal: 2, label: 'Term 2', starts_on: '2026-11-07', ends_on: '2027-01-29' },
    ];
    ratings = {
      'term-2': { a: { approvedAt: '2026-11-20' }, b: { approvedAt: null } },
      'term-1': { c: { approvedAt: 'x' } },
    };
    today = '2026-11-27';
    setUp();
    const html = DashNextReport.html('c1', students);
    expect(html).toContain('<span class="dash-glance-label">Next Report</span>');
    expect(html).toContain('1<span class="dash-glance-word">of 3 ready</span>');
    expect(html).toContain('<b>Term 2</b> · ends Fri, Jan 29');
    expect(html).toMatch(/width:33\.3+%/);
    expect(html).toMatch(
      /^<a class="dash-glance-cell dash-glance-next" role="link" tabindex="0" data-href="\/reports\?course=c1&amp;tab=questionnaire"/,
    );
  });

  it('after the last report has ended, shows that one as ended', () => {
    terms = [{ ordinal: 1, label: 'Term 1', starts_on: '2026-01-01', ends_on: '2026-06-30' }];
    ratings = {};
    today = '2026-11-27';
    setUp();
    expect(DashNextReport.html('c1', students)).toContain('<b>Term 1</b> · ended Tue, Jun 30');
  });

  it("uses the school's report name when the class is on its dates", () => {
    terms = [{ ordinal: 1, label: 'Term 1', starts_on: '2026-09-01', ends_on: '2026-12-11' }];
    ratings = {};
    today = '2026-11-27';
    setUp();
    globalThis.reportingTermReportNames = () => ['Nov Report Card'];
    expect(DashNextReport.html('c1', students)).toContain('<b>Nov Report Card</b> · ends Fri, Dec 11');
  });

  it('with no report dates set says so, and still opens Write Comments', () => {
    terms = [];
    ratings = {};
    today = '2026-11-27';
    setUp();
    const html = DashNextReport.html('c1', students);
    expect(html).toContain('No report dates set');
    expect(html).toContain('dash-glance-next');
  });
});
