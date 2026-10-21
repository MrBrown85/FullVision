/**
 * Page Studio's pure parts (teacher/report-studio.js): the palette's size
 * badges, the fit line, the inspector and the canvas zoom.
 */
import './setup.js';
import { describe, expect, it } from 'vitest';

const per = list => Object.fromEntries(list.map((p, i) => [`s${i}`, { name: `S ${i}`, pushed: [], cut: [], ...p }]));

describe('ReportStudio', () => {
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

  it('the inspector holds the block’s options, Leave Off and Remove, and nothing about size or place', () => {
    const f = ReportSheets.form();
    const html = ReportStudio.inspectorHtml(f, 'competency-table', { id: 'st1', name: 'Cece Adeyemi' });
    expect(html).toContain('Competency Table');
    expect(html).toContain('Evidence Count');
    expect(html).toContain('Leave off Cece Adeyemi&rsquo;s report');
    expect(html).toContain('Remove from Report');
    expect(html).not.toMatch(/Width|Height|Lines|Page 1|row \d|Longest|Shortest|overflow|Blank back/);
    const none = ReportStudio.inspectorHtml(f, null, null);
    expect(none).toContain('Select a block on the page');
    const head = ReportStudio.inspectorHtml(f, 'header', null);
    expect(head).toContain('Student Number');
    expect(head).not.toContain('Remove from Report');
  });

  it('the canvas carries the fit line and the view switch, and no hint sentence', () => {
    const html = ReportStudio.layoutHtml({ view: 'one' });
    expect(html).toContain('id="studio-fit"');
    expect(html).toContain('One Student');
    expect(html).toContain('Everyone');
    expect(html).not.toContain('Drag a block onto a page');
  });
});
