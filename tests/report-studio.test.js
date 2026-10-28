/**
 * Page Studio's pure parts (teacher/report-studio.js): the two panes, the
 * palette with its ticks and greyed blocks, where a block lands, the fit
 * line, the selected block's card, the Options popover, the live-region
 * text and the canvas zoom.
 */
import './setup.js';
import { describe, expect, it } from 'vitest';

const per = list =>
  Object.fromEntries(
    list.map((p, i) => [`s${i}`, { name: `S ${i}`, sheets: 1, over: false, used: 100, free: [500, 500], ...p }]),
  );
const fit = list => ({ perStudent: per(list), sideHeight: 996 });

describe('ReportStudio', () => {
  it('lays out two panes: the palette and the canvas with the fit line and the view switch', () => {
    const html = ReportStudio.layoutHtml({ view: 'one' });
    expect(html).toContain('id="studio-palette"');
    expect(html).toContain('id="studio-fit"');
    expect(html).toContain('One Student');
    expect(html).toContain('Everyone');
    expect(html).not.toContain('studio-inspector');
  });

  it('the fit line counts sheets: one for all, or how many need more (a link to Everyone)', () => {
    const f = ReportSheets.form();
    expect(ReportStudio.fitLineHtml(fit([{}, {}, {}]), f)).toBe('1 sheet for all 3 students');
    expect(ReportStudio.fitLineHtml(fit([{}]), f)).toBe('1 sheet for 1 student');
    const more = ReportStudio.fitLineHtml(fit([{ sheets: 2 }, {}, { sheets: 2 }]), f);
    expect(more).toContain('2 sheets for 2 students');
    expect(more).toContain('data-action="studioView" data-view="all"');
    expect(ReportStudio.fitLineHtml(fit([{ sheets: 3 }]), f)).toContain('3 sheets for 1 student<');
    const over = ReportStudio.fitLineHtml(fit([{ sheets: 2, over: true }, {}]), f);
    expect(over).toContain('A block is taller than a page for 1 student');
    expect(ReportStudio.fitLineHtml(fit([{}, {}]), ReportSheets.setSides(f, 1))).toBe(
      'Front only · 1 page for all 2 students',
    );
    expect(ReportStudio.fitLineHtml(fit([{ sides: 2 }, { sides: 1 }]), ReportSheets.setSides(f, 1))).toContain(
      'Continues on the back for 1 student<',
    );
    expect(ReportStudio.fitLineHtml(null, f)).toBe('');
  });

  it('names the student whose report is longest', () => {
    expect(ReportStudio.longestStudent({ perStudent: per([{ used: 900 }, { used: 1800 }, { used: 700 }]) })).toBe('s1');
    expect(ReportStudio.longestStudent(null)).toBeNull();
  });

  it('a block lands on the first side with room for every student, after the report when taller than a side, nowhere when nothing fits', () => {
    const f = ReportSheets.form();
    const sizes = {
      observations: { row: 400, half: 600 },
      legend: { row: 100, half: 200 },
      big: { row: 1200, half: null },
    };
    expect(ReportStudio.landing(f, 'legend', sizes, fit([{ free: [300, 50] }, { free: [120, 400] }]))).toEqual({
      side: 0,
    });
    expect(ReportStudio.landing(f, 'observations', sizes, fit([{ free: [300, 500] }, { free: [900, 420] }]))).toEqual({
      side: 1,
    });
    expect(ReportStudio.landing(f, 'observations', sizes, fit([{ free: [300, 400] }]))).toEqual({
      reason: 'No room on either side',
    });
    expect(ReportStudio.landing(ReportSheets.setSides(f, 1), 'observations', sizes, fit([{ free: [300] }]))).toEqual({
      reason: 'No room on the Front',
    });
    expect(ReportStudio.landing(f, 'big', sizes, fit([{}]))).toEqual({ after: true });
    // An empty side has room for anything up to a side.
    expect(ReportStudio.landing(f, 'observations', sizes, fit([{ free: [0, 996] }]))).toEqual({ side: 1 });
    expect(ReportStudio.landing(f, 'legend', null, fit([{}]))).toBeNull();
    expect(ReportStudio.landing(f, 'legend', sizes, null)).toBeNull();
  });

  it('scales two pages side by side when there is room beside the gutter, else one above the other', () => {
    expect(ReportStudio.fitZoom(1600)).toEqual({ zoom: 0.62, stacked: false });
    const narrow = ReportStudio.fitZoom(1100);
    expect(narrow.stacked).toBe(false);
    expect(narrow.zoom).toBeLessThan(0.62);
    expect(ReportStudio.fitZoom(900).stacked).toBe(true);
  });

  it('renders the palette with every block grouped, the placed ones ticked and the ones with no room greyed', () => {
    const f = ReportSheets.form();
    const sizes = { observations: { row: 400, half: 600 } };
    const html = ReportStudio.paletteHtml(f, 'blocks', [], sizes, fit([{ free: [100, 100] }]));
    expect(html).toContain('Grades');
    expect(html).toMatch(/class="studio-blk placed"[^>]*data-block="competency-table"[^>]*aria-pressed="true"/);
    expect(html).toContain('Click to find it');
    expect(html).toMatch(/class="studio-blk nofit"[^>]*data-block="observations"[^>]*aria-disabled="true"/);
    expect(html).toContain('No room on either side');
    expect(html).not.toContain('Letterhead');
    expect(html).not.toMatch(/studio-sz|>S<|>XL</);
    // Retired blocks stay out unless placed.
    expect(html).not.toContain('data-block="section-chart"');
    // Before the class is measured nothing is greyed.
    expect(ReportStudio.paletteHtml(f, 'blocks', [], null, null)).not.toContain('nofit');
    const tpl = ReportStudio.paletteHtml(f, 'templates', [{ id: 't1', name: 'Mine' }]);
    expect(tpl).toContain('Starters');
    expect(tpl).toContain('Report Card');
    expect(tpl).toContain('Mine');
    expect(tpl).toContain('aria-label="Delete Mine"');
  });

  it('the selected block’s card says where it is and offers Lines, Size, Move, Options, Leave Off and Remove', () => {
    const f = ReportSheets.form();
    const who = { id: 'st1', name: 'Ethan Dubois' };
    const comment = ReportStudio.blockToolbarHtml(f, 'teacher-narrative', who);
    expect(comment).toContain('On the Front');
    expect(comment).toContain('Teacher Comment');
    expect(comment).toContain('<b>10</b>');
    expect(comment).toContain('data-action="studioLines"');
    expect(comment).toContain('Room for the longest comment in the class');
    expect(comment).toContain('data-action="studioSize"');
    expect(comment).toContain('>Move Up<');
    expect(comment).toContain('>Move Down<');
    expect(comment).toContain('>Move to Back<');
    expect(comment).toContain('Leave Off Ethan');
    expect(comment).toContain('>Remove<');
    expect(comment).not.toContain('studioOptions');
    // The legend: no lines; Options for the table.
    expect(ReportStudio.blockToolbarHtml(f, 'legend', who)).not.toContain('studioLines');
    expect(ReportStudio.blockToolbarHtml(f, 'competency-table', who)).toContain('Options ▾');
    // The letterhead: Options and a line, nothing to move.
    const head = ReportStudio.blockToolbarHtml(f, 'header', who);
    expect(head).toContain('Always first on the Front');
    expect(head).not.toContain('Move');
    expect(head).not.toContain('Remove');
    expect(head).not.toContain('studioSize');
    // The pinned Response: Comment Lines, no Move, no Size.
    const resp = ReportStudio.blockToolbarHtml(f, 'parent-response', who);
    expect(resp).toContain('On the Back');
    expect(resp).toContain('Always last on the Back');
    expect(resp).toContain('Comment Lines');
    expect(resp).not.toContain('Move');
    expect(resp).not.toContain('studioSize');
    // Move Up is off for the first row under the letterhead; Move Down for the last.
    expect(ReportStudio.blockToolbarHtml(f, 'competency-table', who)).toMatch(/data-dir="-1" disabled/);
    expect(ReportStudio.blockToolbarHtml(f, 'learner-dimensions', who)).toMatch(/data-dir="1" disabled/);
    expect(ReportStudio.blockToolbarHtml(f, 'nope', who)).toBe('');
    // Everyone view: no Leave Off.
    expect(ReportStudio.blockToolbarHtml(f, 'legend', null)).not.toContain('Leave Off');
  });

  it('the Options popover is a dialog with the block’s Show checkboxes, choices, no-evidence rule or text fields', () => {
    const f = ReportSheets.form();
    const table = ReportStudio.popoverHtml(f, 'competency-table');
    expect(table).toContain('role="dialog"');
    expect(table).toContain('aria-label="Competency Table Options"');
    expect(table).toContain('data-key="evidence"');
    expect(table).toContain('Hide Row');
    expect(table).not.toMatch(/Width|Height|Lines|row \d/);
    const withSteps = ReportSheets.insert(f, 'next-steps', { side: 0 });
    expect(ReportStudio.popoverHtml(withSteps, 'next-steps')).toContain('aria-label="I-can Statements"');
    const text = ReportStudio.popoverHtml(ReportSheets.insert(f, 'text-block', { side: 1 }), 'text-block');
    expect(text).toContain('id="studio-text-title"');
    expect(text).toContain('id="studio-text-body"');
    expect(ReportStudio.hasOptions('text-block')).toBe(true);
    expect(ReportStudio.hasOptions('legend')).toBe(false);
    expect(ReportStudio.hasOptions('teacher-narrative')).toBe(false);
  });

  it('says where a block is for the live region', () => {
    const f = ReportSheets.form();
    expect(ReportStudio.placeText(f, 'teacher-narrative')).toBe('Teacher Comment, Front, row 4 of 5');
    expect(ReportStudio.placeText(f, 'term-attendance')).toBe('Attendance, Front, row 5 of 5, beside Missing Work');
    expect(ReportStudio.placeText(f, 'parent-response')).toBe('Parent / Guardian Response, Back, row 2 of 2');
    expect(ReportStudio.placeText(f, 'nope')).toBe('');
  });
});
