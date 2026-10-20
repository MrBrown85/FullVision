/**
 * Your Library on the server (migrations/20261020_report_template.sql):
 * ReportSheets keeps the device copy (gb-report-templates) and writes
 * through v2.saveReportTemplate / deleteReportTemplate; syncTemplates()
 * refreshes the copy from v2.listReportTemplates and keeps a form the
 * server has not confirmed yet. With no server the copy stands.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const T1 = '66666666-6666-4666-8666-000000000001';
const T2 = '66666666-6666-4666-8666-000000000002';
const base = () => ReportSheets.normalizeForm(undefined);
const tick = () => new Promise(r => setImmediate(r));

describe('ReportSheets library with the server', () => {
  var calls;
  var saved;
  var listed;
  var original;

  beforeEach(() => {
    localStorage.clear();
    calls = [];
    listed = null;
    original = {
      save: window.v2.saveReportTemplate,
      del: window.v2.deleteReportTemplate,
      list: window.v2.listReportTemplates,
    };
    window.v2.saveReportTemplate = params => {
      calls.push(['save', params]);
      return Promise.resolve({ data: saved ? saved(params) : null, error: null });
    };
    window.v2.deleteReportTemplate = id => {
      calls.push(['delete', id]);
      return Promise.resolve({ data: { id: id, deleted: true }, error: null });
    };
    window.v2.listReportTemplates = () => {
      calls.push(['list']);
      return Promise.resolve({ data: listed, error: null });
    };
  });

  afterEach(() => {
    window.v2.saveReportTemplate = original.save;
    window.v2.deleteReportTemplate = original.del;
    window.v2.listReportTemplates = original.list;
  });

  it('a save lands on the device at once and takes the server id when the save returns', async () => {
    saved = p => ({ id: T1, name: p.name, form: p.form, updated_at: '2026-10-20T20:00:00Z' });
    const entry = ReportSheets.saveTemplate('Humanities 8', ReportSheets.setType(base(), 'compact'));
    expect(entry.id).toMatch(/^t-/);
    expect(ReportSheets.templates().map(t => t.id)).toEqual([entry.id]);
    expect(calls[0][0]).toBe('save');
    expect(calls[0][1]).toMatchObject({ id: null, name: 'Humanities 8' });
    expect(calls[0][1].form.type).toBe('compact');
    await tick();
    expect(ReportSheets.templates().map(t => t.id)).toEqual([T1]);
    // The page still holds the local id until it re-renders.
    expect(ReportSheets.template(entry.id).type).toBe('compact');
    expect(ReportSheets.template(T1).type).toBe('compact');
  });

  it('the same name replaces the earlier form and updates the server row by id', async () => {
    saved = p => ({ id: p.id || T1, name: p.name, form: p.form });
    ReportSheets.saveTemplate('Humanities 8', base());
    await tick();
    ReportSheets.saveTemplate('humanities 8', ReportSheets.setType(base(), 'compact'));
    expect(ReportSheets.templates()).toHaveLength(1);
    expect(ReportSheets.templates()[0].id).toBe(T1);
    expect(ReportSheets.template(T1).type).toBe('compact');
    expect(calls.filter(c => c[0] === 'save')[1][1].id).toBe(T1);
  });

  it('removing a server-backed form deletes it on the server; a pending one only here', async () => {
    saved = p => ({ id: T1, name: p.name, form: p.form });
    ReportSheets.saveTemplate('A', base());
    await tick();
    ReportSheets.removeTemplate(T1);
    expect(ReportSheets.templates()).toEqual([]);
    expect(calls.filter(c => c[0] === 'delete')).toEqual([['delete', T1]]);
    saved = null;
    const pending = ReportSheets.saveTemplate('B', base());
    await tick();
    ReportSheets.removeTemplate(pending.id);
    expect(ReportSheets.templates()).toEqual([]);
    expect(calls.filter(c => c[0] === 'delete')).toHaveLength(1);
  });

  it('syncTemplates replaces the copy with the server rows and keeps an unconfirmed form', async () => {
    saved = null;
    const pending = ReportSheets.saveTemplate('Offline form', base());
    listed = [
      { id: T2, name: 'Science 8', form: ReportSheets.setType(base(), 'compact'), updated_at: '2026-10-20T10:00:00Z' },
      { id: T1, name: 'Humanities 8', form: base(), updated_at: '2026-10-19T10:00:00Z' },
    ];
    expect(await ReportSheets.syncTemplates()).toBe(true);
    expect(ReportSheets.templates().map(t => [t.id, t.name])).toEqual([
      [pending.id, 'Offline form'],
      [T2, 'Science 8'],
      [T1, 'Humanities 8'],
    ]);
    expect(ReportSheets.template(T2).type).toBe('compact');
    expect(await ReportSheets.syncTemplates()).toBe(false);
  });

  it('with no server the device copy stands', async () => {
    saved = null;
    ReportSheets.saveTemplate('Kept', base());
    listed = null;
    expect(await ReportSheets.syncTemplates()).toBe(false);
    expect(ReportSheets.templates().map(t => t.name)).toEqual(['Kept']);
  });
});
