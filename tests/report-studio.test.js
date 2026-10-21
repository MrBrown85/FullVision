/**
 * Page Studio's pure parts (teacher/report-studio.js): the two panes, the
 * palette's size badges, the fit line, the block toolbar, the Options
 * popover, the live-region text and the canvas zoom.
 */
import './setup.js';
import { describe, expect, it } from 'vitest';

const per = list =>
  Object.fromEntries(list.map((p, i) => [`s${i}`, { name: `S ${i}`, pushed: [], cut: [], used: 100, ...p }]));

describe('ReportStudio', () => {
  it('lays out two panes: the palette and the canvas with the fit line and the view switch', () => {
    const html = ReportStudio.layoutHtml({ view: 'one' });
    expect(html).toContain('id="studio-palette"');
    expect(html).toContain('id="studio-fit"');
    expect(html).toContain('One Student');
    expect(html).toContain('Everyone');
    expect(html).not.toContain('studio-inspector');
    expect(html).not.toContain('Drag a block onto a page');
  });

  it('badges a block by its measured height', () => {
    expect(ReportStudio.sizeBadge(0)).toBe('—');
    expect(ReportStudio.sizeBadge(80)).toBe('S');
    expect(ReportStudio.sizeBadge(300)).toBe('M');
    expect(ReportStudio.sizeBadge(301)).toBe('L');
    expect(ReportStudio.sizeBadge(900)).toBe('XL');
  });

  it('the fit line says the class fits, who is pushed past the page, or who is cut', () => {
    expect(ReportStudio.fitLineHtml({ perStudent: per([{}, {}, {}]) })).toBe('Fits for 3 of 3 students');
    const pushed = ReportStudio.fitLineHtml({ perStudent: per([{ pushed: ['next-steps'] }, {}, { pushed: ['x'] }]) });
    expect(pushed).toContain('Pushes past the page for 2 students');
    expect(pushed).toContain('data-action="studioView" data-view="all"');
    expect(ReportStudio.fitLineHtml({ perStudent: per([{ pushed: ['a'] }]) })).toContain('for 1 student<');
    const cut = ReportStudio.fitLineHtml({ perStudent: per([{ pushed: ['a'], cut: ['Learning Dispositions'] }, {}]) });
    expect(cut).toContain('Cut for 1 student');
    expect(cut).not.toContain('Pushes');
    expect(ReportStudio.fitLineHtml(null)).toBe('');
  });

  it('names the student whose report is longest', () => {
    expect(ReportStudio.longestStudent({ perStudent: per([{ used: 900 }, { used: 1800 }, { used: 700 }]) })).toBe('s1');
    expect(ReportStudio.longestStudent(null)).toBeNull();
  });

  it('scales two pages side by side when there is room, else one above the other', () => {
    expect(ReportStudio.fitZoom(1300)).toEqual({ zoom: 0.62, stacked: false });
    const narrow = ReportStudio.fitZoom(900);
    expect(narrow.stacked).toBe(false);
    expect(narrow.zoom).toBeLessThan(0.62);
    expect(ReportStudio.fitZoom(700).stacked).toBe(true);
  });

  it('renders the palette with every block grouped and the placed ones dimmed', () => {
    const html = ReportStudio.paletteHtml(ReportSheets.form(), { 'grade-table': 500 }, 'blocks', []);
    expect(html).toContain('Grades');
    expect(html).toContain('data-block="competency-table"');
    expect(html).toMatch(/class="studio-blk placed"[^>]*data-block="competency-table"/);
    expect(html).toMatch(/data-block="grade-table"[^>]*>[\s\S]*?studio-sz">L</);
    expect(html).not.toContain('data-block="header"');
  });

  it('the block toolbar holds Options, Leave Off <first name> and Remove; the letterhead only Options', () => {
    const f = ReportSheets.form();
    const who = { id: 'st1', name: 'Cece Adeyemi' };
    const table = ReportStudio.blockToolbarHtml(f, 'competency-table', who);
    expect(table).toContain('data-action="studioOptions"');
    expect(table).toContain('>Leave Off Cece<');
    expect(table).toContain('aria-pressed="false"');
    expect(table).toContain('data-action="studioRemove"');
    expect(table).toContain('aria-label="Remove Competency Table"');
    expect(table).not.toMatch(/Width|Height|Lines|Page 1|row \d/);
    // The comment has no options: two controls.
    const comment = ReportStudio.blockToolbarHtml(f, 'teacher-narrative', who);
    expect(comment).not.toContain('studioOptions');
    expect(comment).toContain('Leave Off Cece');
    // Left off for this student: the toggle is pressed.
    const off = ReportStudio.blockToolbarHtml(
      ReportSheets.hideFor(f, 'st1', 'competency-table', true),
      'competency-table',
      who,
    );
    expect(off).toContain('aria-pressed="true"');
    // The letterhead: Options only.
    const head = ReportStudio.blockToolbarHtml(f, 'header', who);
    expect(head).toContain('studioOptions');
    expect(head).not.toContain('Leave Off');
    expect(head).not.toContain('studioRemove');
    // Everyone view has no student: no Leave Off.
    expect(ReportStudio.blockToolbarHtml(f, 'competency-table', null)).not.toContain('Leave Off');
    expect(ReportStudio.blockToolbarHtml(f, 'grade-table', who)).toBe('');
  });

  it('the Options popover is a dialog with the block’s Show checkboxes, choices, no-evidence rule or text fields', () => {
    const f = ReportSheets.form();
    const table = ReportStudio.popoverHtml(f, 'competency-table');
    expect(table).toContain('role="dialog"');
    expect(table).toContain('Evidence Count');
    expect(table).toContain('When a Student Has No Evidence');
    expect(table).not.toContain('Leave off');
    const steps = ReportStudio.popoverHtml(f, 'next-steps');
    expect(steps).toContain('aria-label="I-can Statements"');
    const text = ReportStudio.popoverHtml(ReportSheets.place(f, 'text-block', { page: 1, y: 40 }), 'text-block');
    expect(text).toContain('id="studio-text-title"');
    expect(text).toContain('id="studio-text-body"');
    expect(ReportStudio.popoverHtml(f, 'grade-table')).toBe('');
    expect(ReportStudio.hasOptions('teacher-narrative')).toBe(false);
    expect(ReportStudio.hasOptions('header')).toBe(true);
    expect(ReportStudio.hasOptions('text-block')).toBe(true);
  });

  it('says where a block is for the live region', () => {
    const f = ReportSheets.move(
      ReportSheets.resize(ReportSheets.form(), 'teacher-narrative', { w: 6 }),
      'teacher-narrative',
      { x: 6, y: 9 },
    );
    expect(ReportStudio.placeText(f, 'teacher-narrative')).toBe(
      'Teacher Comment, page 1, columns 7 to 12, rows 10 to 17',
    );
    expect(ReportStudio.placeText(f, 'nope')).toBe('');
  });
});
