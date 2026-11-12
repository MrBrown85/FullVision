/**
 * One Report's pages on screen (teacher/report-one-page.js): what it adds
 * to a page is no-print and never changes what prints, it adds nothing in
 * Everyone view, and its controls change the model through ReportOne.
 * docs/plans/one-report-build-plan.md.
 */
import './setup.js';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { runInThisContext } from 'vm';
import { parseHTML } from 'linkedom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

runInThisContext(readFileSync(resolve(__dirname, '../teacher/report-one-page.js'), 'utf-8'), {
  filename: 'teacher/report-one-page.js',
});

const PAGE = `<div id="rb-preview"><div class="sheet-student"><div class="sheet-zoom" data-side="0">
<div class="report-sheet one-sheet"><div class="sheet-body">
  <div class="sheet-row"><div class="sheet-cell" data-part="header"><div class="report-header">Cece Adeyemi</div></div></div>
  <div class="sheet-row"><div class="sheet-cell" data-part="proficiency"><div class="report-block-box">
    <div class="report-block-title">Proficiency</div>
    <table><tbody>
      <tr data-row="Questioning and Predicting"><td class="report-ct-name">Questioning and Predicting</td><td>Proficient</td></tr>
      <tr data-row="Planning and Conducting"><td class="report-ct-name">Planning and Conducting</td><td>Developing</td></tr>
    </tbody></table></div></div></div>
  <div class="sheet-row"><div class="sheet-cell" data-part="assessments"><div class="one-part one-assessments">
    <div class="report-block-title">Assessments</div>
    <div class="gr-table"><div class="gr-row" data-row="a1"><span class="gr-c gr-title">Cell Quiz</span><span class="gr-c gr-result">8 / 10</span></div></div>
  </div></div></div>
</div></div></div></div></div>`;

let stub;
let preview;
let doc;

function fakeApi(over) {
  const student = { id: 's1', firstName: 'Cece', lastName: 'Adeyemi' };
  let model = ReportOne.fromSetup('report-card');
  return Object.assign(
    {
      cid: 'sci8',
      model: () => model,
      set: vi.fn(m => {
        model = m;
      }),
      student: () => student,
      students: () => Array.from({ length: 27 }, (_, i) => ({ id: 's' + (i + 1) })),
      scope: () => null,
      setScope: vi.fn(),
      goStudent: vi.fn(),
      view: () => 'one',
      ctx: () => ({}),
      fit: () => null,
      redraw: vi.fn(),
      announce: vi.fn(),
    },
    over || {},
  );
}

/* What prints: the page without anything marked no-print. */
function printed(root) {
  const copy = root.cloneNode(true);
  copy.querySelectorAll('.no-print').forEach(x => x.remove());
  return copy.textContent.replace(/\s+/g, ' ').trim();
}

beforeEach(() => {
  stub = globalThis.document;
  ({ document: doc } = parseHTML('<!doctype html><html><body>' + PAGE + '</body></html>'));
  globalThis.document = doc;
  preview = doc.getElementById('rb-preview');
});
afterEach(() => {
  globalThis.document = stub;
});

describe('decorate', () => {
  it('adds only no-print elements, and what prints is unchanged', () => {
    const api = fakeApi();
    const before = Array.from(preview.querySelectorAll('*'));
    const text = printed(preview);
    ReportOnePage.decorate(preview, api);
    const added = Array.from(preview.querySelectorAll('*')).filter(x => before.indexOf(x) < 0);
    expect(added.length).toBeGreaterThan(0);
    added.forEach(x => expect(x.closest('.no-print'), x.outerHTML).toBeTruthy());
    expect(printed(preview)).toBe(text);
    // A Hide pill on each part but the letterhead, a − on each row, the Add strip.
    expect(preview.querySelectorAll('.one-hide').length).toBe(2);
    expect(preview.querySelector('[data-part="header"] .one-hide')).toBeNull();
    expect(preview.querySelectorAll('.one-rm').length).toBe(3);
    expect(preview.querySelector('.one-add')).toBeTruthy();
  });

  it('decorating twice is decorating once', () => {
    const api = fakeApi();
    ReportOnePage.decorate(preview, api);
    const once = preview.innerHTML;
    ReportOnePage.decorate(preview, api);
    expect(preview.innerHTML).toBe(once);
  });

  it('adds nothing in Everyone view', () => {
    const html = preview.innerHTML;
    ReportOnePage.decorate(preview, fakeApi({ view: () => 'all' }));
    expect(preview.innerHTML).toBe(html);
  });

  it('says above the pages when changes apply to one student', () => {
    ReportOnePage.decorate(preview, fakeApi({ scope: () => 's1' }));
    const banner = preview.querySelector('.one-banner');
    expect(banner.classList.contains('no-print')).toBe(true);
    expect(banner.textContent).toContain('Changes now apply to Cece only.');
  });
});

describe('the page’s controls', () => {
  it('a row’s − leaves that row off for the class, with an Undo label', () => {
    const api = fakeApi();
    ReportOnePage.decorate(preview, api);
    const btn = Array.from(preview.querySelectorAll('.one-rm')).find(
      b => b.getAttribute('data-row') === 'Planning and Conducting',
    );
    expect(ReportOnePage.handle(btn.getAttribute('data-action'), btn, api)).toBe(true);
    expect(api.set).toHaveBeenCalledTimes(1);
    const [m, label] = api.set.mock.calls[0];
    expect(ReportOne.removedOf(m, 'proficiency')).toEqual(['Planning and Conducting']);
    expect(label).toBe('Removed Planning and Conducting for everyone');
  });

  it('with Changes Apply To on a student, the row is left off for that student only', () => {
    const api = fakeApi({ scope: () => 's1' });
    ReportOnePage.decorate(preview, api);
    const btn = Array.from(preview.querySelectorAll('.one-rm')).find(b => b.getAttribute('data-row') === 'a1');
    ReportOnePage.handle('oneRowOff', btn, api);
    const [m, label] = api.set.mock.calls[0];
    expect(ReportOne.removedOf(m, 'assessments')).toEqual([]);
    expect(ReportOne.removedOf(m, 'assessments', 's1')).toEqual(['a1']);
    expect(label).toBe('Removed Cell Quiz for Cece');
  });

  it('Hide switches the part off', () => {
    const api = fakeApi();
    ReportOnePage.decorate(preview, api);
    const hide = preview.querySelector('[data-part="proficiency"] .one-hide');
    ReportOnePage.handle('oneHide', hide, api);
    const [m, label] = api.set.mock.calls[0];
    expect(ReportOne.isOn(m, 'proficiency')).toBe(false);
    expect(label).toBe('Hid Proficiency');
  });

  it('a part with rows left off shows how many, and Show puts them back', () => {
    const api = fakeApi();
    api.set(ReportOne.setRemoved(api.model(), 'proficiency', 'Questioning and Predicting', true));
    ReportOnePage.decorate(preview, api);
    const chip = preview.querySelector('[data-part="proficiency"] .one-gone');
    expect(chip.textContent).toBe('1 removed · Show');
    ReportOnePage.handle(chip.getAttribute('data-action'), chip, api);
    expect(ReportOne.removedOf(api.model(), 'proficiency')).toEqual([]);
  });
});
