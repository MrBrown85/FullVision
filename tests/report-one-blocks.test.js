/**
 * The block options One Report turns on (docs/plans/one-report-build-plan.md,
 * step 3): reworded questions, the legend's Ministry descriptors, family
 * wording on Proficiency, and a blank Core Competency form. Each is off by
 * default; tests/report-surfaces-output.test.js holds that nothing printed
 * today changes. Drawn for Demo Mode's Science 8.
 */
import './setup.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { FROZEN_AT, loadDemoClass } from './helpers/golden-grades.js';

const WORDED = ['student-reflection-learning', 'student-reflection-habits', 'parent-response'];

describe('One Report block options', { timeout: 60000 }, () => {
  let cid, students, ctx, wasDemo;
  const draw = (id, st, options) => ReportBlocks.renderReportBlock(id, cid, st, ctx, options);

  beforeAll(() => {
    wasDemo = window.isDemoMode;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(FROZEN_AT));
    cid = loadDemoClass();
    clearProfCache();
    students = sortStudents(getStudents(cid), 'lastName');
    ctx = { termId: 'term-1', termLabel: 'Report 1' };
  }, 60000);

  afterAll(() => {
    vi.useRealTimers();
    window.isDemoMode = wasDemo;
    CURRICULUM_INDEX = null;
    localStorage.clear();
    clearProfCache();
  });

  describe.each(WORDED)('%s', id => {
    it("prints the same with today's wording as with none", () => {
      students.forEach(st => {
        expect(draw(id, st, { wording: ReportBlocks.wordingOf(id) })).toBe(draw(id, st, {}));
      });
    });

    it('gives a fresh copy each time', () => {
      const w = ReportBlocks.wordingOf(id);
      w.title = 'Changed';
      expect(ReportBlocks.wordingOf(id).title).not.toBe('Changed');
    });

    it('prints a changed item in place of the old one, escaped', () => {
      const st = students[0];
      const w = ReportBlocks.wordingOf(id);
      const key = id === 'parent-response' ? 'checks' : 'items';
      const old = w[key][0];
      const oldText = typeof old === 'string' ? old : old.label;
      w[key][0] =
        id === 'student-reflection-learning' ? { label: 'I <b>try</b> hard', group: old.group } : 'I <b>try</b> hard';
      w.title = 'Our <b>Own</b> Title';
      const html = draw(id, st, { wording: w });
      expect(html).toContain('I &lt;b&gt;try&lt;/b&gt; hard');
      expect(html).toContain('Our &lt;b&gt;Own&lt;/b&gt; Title');
      expect(html).not.toContain('<b>try</b>');
      expect(html).not.toContain(esc(oldText));
      expect(html).not.toContain(oldText);
    });

    it('fills {name} and {teacher} in the intro', () => {
      const st = students[0];
      const html = draw(id, st, { wording: { intro: '{name} & {teacher}' } });
      const teacher = getConfig().displayName || '';
      expect(html).toContain(esc(displayNameFirst(st)) + ' &amp; ' + esc(teacher) + '<');
    });
  });

  it('prints flat items as one group with no prompts', () => {
    const st = students[0];
    const html = draw('student-reflection-learning', st, { wording: { items: ['Focus', 'Effort'] } });
    expect(html).toContain('Focus');
    expect(html).toContain('Effort');
    expect(html).not.toContain('Learning Dispositions');
    expect(html).not.toContain('report-habit-desc');
    expect((html.match(/report-bubble/g) || []).length).toBe(8);
  });

  it('has no wording for other blocks', () => {
    expect(ReportBlocks.wordingOf('proficiency')).toBeNull();
  });

  it("prints the legend's Ministry descriptors only when asked", () => {
    const plain = draw('legend', students[0], {});
    const full = draw('legend', students[0], { descriptors: true });
    expect(plain).not.toContain('concepts and competencies');
    expect(full).toContain('Initial understanding of the concepts and competencies relevant to the expected learning');
    expect(full).toContain('Sophisticated understanding of the concepts and competencies');
    expect(plain).toContain('Initial understanding');
  });

  it('prints family wording on Proficiency only when asked', () => {
    const st = students.find(s => /Lowest now:/.test(draw('proficiency', s, {})));
    expect(st).toBeTruthy();
    const plain = draw('proficiency', st, {});
    const fam = draw('proficiency', st, { family: true });
    expect(plain).toContain('Assessed');
    expect(plain).not.toContain('Pieces of Work');
    expect(fam).toContain('Pieces of Work');
    expect(fam).not.toContain('>Assessed<');
    expect(fam).toContain('Strongest now:');
    expect(fam).toContain('Next focus:');
    expect(fam).not.toContain('Highest now:');
    expect(fam).not.toContain('Lowest now:');
    // Nothing else changes.
    const back = fam
      .replace('Pieces of Work', 'Assessed')
      .replace('Strongest now:', 'Highest now:')
      .replace('Next focus:', 'Lowest now:');
    expect(back).toBe(plain);
    const half = draw('proficiency', st, { size: 'half', family: true });
    expect(half).toContain('>Work<');
    expect(half).not.toContain('>Ev.<');
  });

  it('prints a blank Core Competency form with no student answer', () => {
    const st = students.find(s => draw('self-assessment', s, {}).indexOf('report-self-item') >= 0);
    expect(st).toBeTruthy();
    const answered = draw('self-assessment', st, {});
    const blank = draw('self-assessment', st, { blank: true });
    expect(blank).not.toContain('report-self-item');
    expect(blank).not.toContain('own words');
    const quotes = answered.match(/“[^”]+”/g) || [];
    expect(quotes.length).toBeGreaterThan(0);
    quotes.forEach(q => expect(blank).not.toContain(q.slice(1, -1)));
    expect(blank).toContain(
      esc(displayNameFirst(st)) + ', describe one example from this term for each Core Competency.',
    );
    ['Communication:', 'Thinking:', 'Personal and Social:', 'My goal for next term:'].forEach(t =>
      expect(blank).toContain(t),
    );
    expect((blank.match(/report-reflect-open-field/g) || []).length).toBe(7);
    expect(draw('self-assessment', st, { blank: true, goal: false })).not.toContain('My goal for next term:');
    // A student who has answered nothing still gets the form.
    const none = students.find(s => draw('self-assessment', s, {}) === '');
    if (none) expect(draw('self-assessment', none, { blank: true })).toContain('Communication:');
  });

  it('takes its own title in both forms, escaped', () => {
    const st = students.find(s => draw('self-assessment', s, {}).indexOf('report-self-item') >= 0);
    const title = 'Core Competency <b>Self</b>-Assessment';
    [{}, { blank: true }].forEach(o => {
      const html = draw('self-assessment', st, Object.assign({ title }, o));
      expect(html).toContain('Core Competency &lt;b&gt;Self&lt;/b&gt;-Assessment');
      expect(html).not.toContain('Self-Assessment and Goal');
    });
  });
});
