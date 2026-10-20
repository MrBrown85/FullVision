/**
 * Page Studio's pure parts (teacher/report-studio.js): the palette's size
 * badges, the stats strip, the toolbar count and the canvas zoom.
 */
import './setup.js';
import { describe, expect, it } from 'vitest';

describe('ReportStudio', () => {
  it('badges a block by its measured height', () => {
    expect(ReportStudio.sizeBadge(0)).toBe('—');
    expect(ReportStudio.sizeBadge(80)).toBe('S');
    expect(ReportStudio.sizeBadge(300)).toBe('M');
    expect(ReportStudio.sizeBadge(301)).toBe('L');
    expect(ReportStudio.sizeBadge(900)).toBe('XL');
  });

  it('reads the longest, the shortest, overflow and blank backs from the class fit', () => {
    const st = ReportStudio.stats({
      students: 3,
      pages: 8,
      over: ['Priya Kaur'],
      perStudent: {
        a: { name: 'Cece Adeyemi', sheets: 1, sides: 2, used: 900, over: false },
        b: { name: 'Priya Kaur', sheets: 2, sides: 3, used: 1800, over: true },
        c: { name: 'Ethan Dubois', sheets: 1, sides: 2, used: 700, over: false },
      },
    });
    expect(st.longest).toMatchObject({ name: 'Priya Kaur', pages: 3 });
    expect(st.shortest).toMatchObject({ name: 'Ethan Dubois', pages: 2 });
    expect(st.over).toBe(1);
    expect(st.blankBacks).toBe(1);
    expect(ReportStudio.stats(null)).toEqual({ longest: null, shortest: null, over: 0, blankBacks: 0 });
  });

  it('counts the class for the toolbar', () => {
    expect(ReportStudio.countText({ students: 27, pages: 54, over: [] })).toBe('27 students · 54 pages · duplex safe');
    expect(ReportStudio.countText({ students: 1, pages: 2, over: ['x'] })).toBe('1 student · 2 pages · 1 over');
    expect(ReportStudio.countText(null)).toBe('');
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

  it('the inspector names the selected block and its place, and always shows the stats', () => {
    const f = ReportSheets.form();
    const html = ReportStudio.inspectorHtml(f, 'competency-table', ReportStudio.stats(null));
    expect(html).toContain('Competency Table');
    expect(html).toContain('Page 1 · row 4');
    expect(html).toContain('Remove from Report');
    expect(html).toContain('Longest report in class');
    const none = ReportStudio.inspectorHtml(f, null, ReportStudio.stats(null));
    expect(none).toContain('Select a block on the page');
    expect(ReportStudio.inspectorHtml(f, 'header', null)).not.toContain('Remove from Report');
  });
});
