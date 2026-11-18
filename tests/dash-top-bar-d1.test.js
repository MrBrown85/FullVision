/**
 * Dashboard top bar, slice D1: the Missing and Late line never repeats its
 * number, the "No Change" line is kept but hidden, and BuildFlags.
 */
import './setup.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
runInThisContext(readFileSync(resolve(root, 'shared/build-flags.js'), 'utf-8'), { filename: 'shared/build-flags.js' });

function items(ns, late) {
  return [...Array(ns).fill({ kind: 'ns' }), ...Array(late).fill({ kind: 'late' })];
}
function subLine(ns, late) {
  const html = DashInsights.missingGlanceHtml(items(ns, late), 'c1');
  const { document: d } = parseHTML('<div id="x">' + html + '</div>');
  return {
    html: d.querySelector('.dash-glance-sub').innerHTML,
    text: d.querySelector('.dash-glance-sub').textContent,
    big: d.querySelector('.dash-glance-value').textContent,
  };
}

describe('Missing and Late second line', () => {
  it('says All Missing when only Missing is above zero', () => {
    const r = subLine(12, 0);
    expect(r.big).toBe('12');
    expect(r.text).toBe('All Missing');
  });
  it('says All Late when only Late is above zero', () => {
    const r = subLine(0, 12);
    expect(r.big).toBe('12');
    expect(r.text).toBe('All Late');
  });
  it('keeps both parts when both are above zero', () => {
    expect(subLine(3, 2).html).toBe('<b>3</b> Missing · <b>2</b> Late');
  });
  it('keeps the plain line at zero', () => {
    expect(subLine(0, 0).text).toBe('Nothing is missing or late.');
  });
});

function avgCell(classChange) {
  const html = DashOverview.glanceHtml({ cid: 'c1', allStudents: [], classAvg: 0, missing: [], classChange });
  const { document: d } = parseHTML('<div id="x">' + html + '</div>');
  return d.querySelector('.dash-glance-change');
}

describe('the class change line', () => {
  it('is kept, hidden from view and from readers, when nothing changed', () => {
    const el = avgCell({ text: 'No Change', dir: 0, since: 'Report 2' });
    expect(el.textContent).toBe('No Change Since Report 2');
    expect(el.classList.contains('is-none')).toBe(true);
    expect(el.getAttribute('aria-hidden')).toBe('true');
  });
  it('shows a rise as before', () => {
    const el = avgCell({ text: '▲ 0.3', dir: 1, since: 'Report 2' });
    expect(el.textContent).toBe('▲ 0.3 Since Report 2');
    expect(el.classList.contains('is-up')).toBe(true);
    expect(el.classList.contains('is-none')).toBe(false);
    expect(el.hasAttribute('aria-hidden')).toBe(false);
  });
  it('shows a fall as before', () => {
    const el = avgCell({ text: '▼ 0.3', dir: -1, since: 'Report 2' });
    expect(el.classList.contains('is-down')).toBe(true);
    expect(el.hasAttribute('aria-hidden')).toBe(false);
  });
  it('draws nothing when there is no report to compare to', () => {
    expect(avgCell(null)).toBeNull();
  });
  it('hides the none state in the stylesheet', () => {
    const css = readFileSync(resolve(root, 'teacher/dashboard.css'), 'utf-8');
    expect(css).toMatch(/\.dash-glance-change\.is-none\s*\{\s*visibility:\s*hidden;/);
  });
});

describe('BuildFlags', () => {
  beforeEach(() => localStorage.clear());
  it('is off by default', () => {
    expect(BuildFlags.on('dashRow')).toBe(false);
    expect(BuildFlags.on('bulletins')).toBe(false);
    expect(BuildFlags.on('quizzes')).toBe(false);
  });
  it('turns on with the localStorage key', () => {
    localStorage.setItem('fv-build-dashRow', '1');
    expect(BuildFlags.on('dashRow')).toBe(true);
    expect(BuildFlags.on('bulletins')).toBe(false);
  });
  it('stays off when storage throws', () => {
    const real = localStorage.getItem;
    localStorage.getItem = () => {
      throw new Error('blocked');
    };
    try {
      expect(BuildFlags.on('dashRow')).toBe(false);
    } finally {
      localStorage.getItem = real;
    }
  });
  it('treats an unknown name as off, even with its key set', () => {
    localStorage.setItem('fv-build-nope', '1');
    expect(BuildFlags.on('nope')).toBe(false);
  });
});
