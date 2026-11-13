/**
 * One Report's panel (teacher/report-one-panel.js), drawn over a real
 * Report Card model with a fake api: the parts in print order with their
 * switches, a switch click turning a part off through api.set, a part's
 * options when it is open, and the fit line in sheets.
 */
import './setup.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';

runInThisContext(readFileSync('teacher/report-one.js', 'utf-8'), { filename: 'teacher/report-one.js' });
runInThisContext(readFileSync('teacher/report-one-panel.js', 'utf-8'), { filename: 'teacher/report-one-panel.js' });

const CECE = { id: 'st1', firstName: 'Cece', lastName: 'Adeyemi' };

function fakeApi(over = {}) {
  const calls = [];
  let model = ReportOne.fromSetup('report-card');
  const api = {
    cid: 'nope',
    calls,
    model: () => model,
    set: (m, label) => {
      calls.push({ m, label });
      model = m;
    },
    student: () => CECE,
    scope: () => null,
    setScope: () => {},
    fit: () => null,
    view: () => 'one',
    redraw: () => {},
    announce: () => {},
    ...over,
  };
  return api;
}
const el = (data, attrs = {}) => ({
  dataset: data,
  getAttribute: k => attrs[k] ?? null,
  setAttribute: () => {},
  closest: () => null,
});
const draw = api => {
  const palette = { innerHTML: '' };
  ReportOnePanel.render(palette, api);
  return palette.innerHTML;
};
const onList = html => html.slice(html.indexOf('one-onlist'), html.indexOf('one-sec-fb'));

describe('ReportOnePanel', () => {
  let api;
  beforeEach(() => {
    api = fakeApi();
  });

  it('lists the Report Card parts in print order, each with a switch but the letterhead', () => {
    const html = onList(draw(api));
    const parts = [...html.matchAll(/class="one-item[^"]*" data-part="([^"]+)"/g)].map(m => m[1]);
    const expected = ReportOne.order(api.model(), null).filter(k => ReportOne.available(k, api.cid));
    expect(parts).toEqual(expected);
    expect(parts[0]).toBe('header');
    expect(parts[parts.length - 1]).toBe('parent-response');
    parts.forEach(k => {
      const sw = new RegExp('role="switch" aria-checked="true"[^>]*data-action="oneSwitch" data-part="' + k + '"');
      if (k === 'header') expect(html).not.toMatch(sw);
      else expect(html).toMatch(sw);
    });
    // Only the parts between the letterhead and the response can be dragged.
    expect(html).not.toContain('data-action="oneDrag" data-part="header"');
    expect(html).not.toContain('data-action="oneDrag" data-part="parent-response"');
    expect(html).toContain('data-action="oneDrag" data-part="proficiency"');
    expect(draw(api)).toContain('Report Card');
  });

  it('puts the parts that are off under Add a Part, switched off', () => {
    const html = draw(api);
    const add = html.slice(html.indexOf('one-sec-add'));
    ReportOne.offParts(api.model(), api.cid, null).forEach(k => {
      expect(add).toContain('aria-checked="false" aria-label="' + esc(ReportOne.label(k, api.cid)) + '"');
    });
  });

  it('switches a part off through api.set, with an Undo label', () => {
    draw(api);
    expect(ReportOnePanel.handle('oneSwitch', el({ part: 'legend' }), api)).toBe(true);
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0].label).toBe('Removed Proficiency Legend');
    expect(ReportOne.isOn(api.calls[0].m, 'legend')).toBe(false);
    expect(api.calls[0].m.parts).not.toContain('legend');
  });

  it('switches a part off for the student only when changes apply to the student', () => {
    api = fakeApi({ scope: () => CECE.id });
    draw(api);
    ReportOnePanel.handle('oneSwitch', el({ part: 'legend' }), api);
    const m = api.calls[0].m;
    expect(api.calls[0].label).toBe('Removed Proficiency Legend for Cece');
    expect(m.parts).toContain('legend');
    expect(ReportOne.isOn(m, 'legend', CECE.id)).toBe(false);
    const html = draw(api);
    expect(html).toContain('1 change for Cece only');
    expect(html).toContain('data-action="oneUseClass"');
    expect(html).toContain('class="one-mine"');
  });

  it('shows an open part’s options and saves a change to one', () => {
    let html = draw(api);
    expect(html).not.toMatch(/one-opts open[^"]*" id="one-opts-assessments"/);
    ReportOnePanel.handle('oneOpen', el({ part: 'assessments' }), api);
    html = draw(api);
    expect(html).toMatch(/one-opts open[^"]*" id="one-opts-assessments"/);
    expect(html).toContain('data-action="oneOpt" data-part="assessments" data-opt="date" aria-pressed="true"');
    expect(html).toContain('data-action="oneOptChoice" data-part="assessments" data-opt="order" data-value="1"');
    expect(html).toContain('data-action="oneChoose" data-part="assessments"');
    ReportOnePanel.handle('oneOpt', el({ part: 'assessments', opt: 'date' }), api);
    expect(api.calls[0].label).toBeUndefined();
    expect(api.calls[0].m.options.assessments.date).toBe(false);
    ReportOnePanel.handle('oneOptChoice', el({ part: 'assessments', opt: 'order', value: '1' }), api);
    expect(api.calls[1].m.options.assessments.order).toBe('newest');
    ReportOnePanel.handle('oneOpen', el({ part: 'assessments' }), api); // shut it again for the other tests
  });

  it('changes the Setup from the menu', () => {
    ReportOnePanel.handle('oneSetup', el({ value: 'grades' }), api);
    expect(api.calls[0].label).toBe('Changed to Grades');
    expect(api.calls[0].m.parts).toEqual(ReportOne.fromSetup('grades').parts);
  });

  it('says sheets in the fit line, and names who is too long', () => {
    expect(ReportOnePanel.fitHtml(api)).toBe('');
    const fit = {
      sheets: 54,
      perStudent: { st1: { sheets: 2, over: false, noComment: false, name: 'Cece Adeyemi' } },
      noComment: [],
      over: ['A <b>', 'Bo'],
    };
    api = fakeApi({ fit: () => fit });
    const line = ReportOnePanel.fitHtml(api);
    expect(line).toContain('2 sheets for Cece · 54 sheets for the class, double-sided');
    expect(line).toContain('<span class="one-fit-over">Too long for a page: A &lt;b&gt;, Bo</span>');
    expect(line).not.toMatch(/page(s)? for/);
    api = fakeApi({ fit: () => fit, view: () => 'all' });
    expect(ReportOnePanel.fitHtml(api)).toMatch(/^54 sheets for the class/);
  });

  it('offers Write Them when students have no comment', () => {
    api = fakeApi({ fit: () => ({ sheets: 1, perStudent: {}, noComment: ['A', 'B'], over: [] }) });
    expect(draw(api)).toContain(
      '2 students have none · <button type="button" class="one-link" data-action="oneWriteThem">',
    );
  });
});
