/**
 * The reflections' wording edited where it prints (teacher/report-one-words.js):
 * the changes to the wording (pure), and what the page gets: words to type
 * in and controls, only in One Student view, never anything that prints.
 * docs/plans/edit-on-page-mockup.html.
 */
import './setup.js';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { runInThisContext } from 'vm';
import { parseHTML } from 'linkedom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

runInThisContext(readFileSync(resolve(__dirname, '../teacher/report-one-word-ops.js'), 'utf-8'), {
  filename: 'teacher/report-one-word-ops.js',
});
runInThisContext(readFileSync(resolve(__dirname, '../teacher/report-one-words.js'), 'utf-8'), {
  filename: 'teacher/report-one-words.js',
});

const O = ReportOneWords.ops;
const W = () => ({
  items: [
    { label: 'A', prompt: 'a', group: 'One' },
    { label: 'B', prompt: '', group: 'One' },
    { label: 'C', prompt: 'c', group: 'Two' },
    { label: 'D', prompt: '', group: 'Two' },
  ],
  open: ['Q1', 'Q2'],
  scale: ['Rarely', 'Sometimes', 'Usually', 'Consistently'],
});
const labels = w => w.items.map(i => (typeof i === 'string' ? i : i.label + '/' + (i.group || ''))).join(' ');

describe('the wording, changed', () => {
  it('finds the run of statements under a heading', () => {
    expect(O.blockAt(W(), 1)).toEqual({ start: 0, end: 2, group: 'One' });
    expect(O.blocks(W()).map(b => b.group)).toEqual(['One', 'Two']);
  });

  it('renames one heading: every statement under it, no other', () => {
    const w = O.setText(W(), 'head.2', 'Second');
    expect(labels(w)).toBe('A/One B/One C/Second D/Second');
    expect(O.textAt(w, 'head.3')).toBe('Second');
  });

  it('sets a statement, the line under it, a scale word, a question', () => {
    let w = O.setText(W(), 'items.1.prompt', 'bee');
    w = O.setText(w, 'items.0.label', 'Ay');
    w = O.setText(w, 'scale.3', 'Always');
    w = O.setText(w, 'open.1', 'Why?');
    expect(w.items[0].label).toBe('Ay');
    expect(w.items[1].prompt).toBe('bee');
    expect(w.scale[3]).toBe('Always');
    expect(w.open).toEqual(['Q1', 'Why?']);
  });

  it('moves a statement under another heading', () => {
    expect(labels(O.moveItem(W(), 0, 4, 'Two'))).toBe('B/One C/Two D/Two A/Two');
    expect(labels(O.moveItem(W(), 3, 1, 'One'))).toBe('A/One D/One B/One C/Two');
  });

  it('one step past the edge of its heading joins the next heading', () => {
    expect(labels(O.moveItemBy(W(), 1, 1))).toBe('A/One B/Two C/Two D/Two');
    expect(labels(O.moveItemBy(W(), 2, -1))).toBe('A/One B/One C/One D/Two');
    expect(labels(O.moveItemBy(W(), 0, -1))).toBe(labels(W()));
  });

  it('moves a heading with its statements', () => {
    expect(labels(O.moveBlockBy(W(), 2, -1))).toBe('C/Two D/Two A/One B/One');
    expect(labels(O.moveBlock(W(), 0, 4))).toBe('C/Two D/Two A/One B/One');
  });

  it('a new heading takes the statements below it; at the end of a run it starts with a blank one', () => {
    expect(labels(O.addHeading(W(), 1, 'New'))).toBe('A/One B/New C/Two D/Two');
    const w = O.addHeading(W(), 2, 'New');
    expect(labels(w)).toBe('A/One B/One /New C/Two D/Two');
    // The blank statement keeps the heading when saved.
    expect(labels(O.clean(w))).toBe('A/One B/One /New C/Two D/Two');
  });

  it('removing a heading keeps its statements under the heading above', () => {
    expect(labels(O.removeHeading(W(), 2))).toBe('A/One B/One C/One D/One');
    expect(labels(O.removeHeading(W(), 0))).toBe('A/Two B/Two C/Two D/Two');
  });

  it('a blank statement is dropped unless it is the one statement under a heading', () => {
    const w = O.addItem(W(), 1, 'One');
    expect(labels(O.clean(w))).toBe(labels(W()));
  });

  it('pasted lines are a statement each, "Name – the line under it" split in two', () => {
    const r = O.pasteItems(W(), 2, 'One', 'Honesty – I tell the truth\nPatience\tI wait\n\n', false);
    expect(r.n).toBe(2);
    expect(r.w.items[2]).toEqual({ label: 'Honesty', prompt: 'I tell the truth', group: 'One' });
    expect(r.w.items[3]).toEqual({ label: 'Patience', prompt: 'I wait', group: 'One' });
  });

  it('keeps plain statements plain until one needs a heading', () => {
    const w = { items: ['x', 'y', 'z'] };
    expect(O.setText(w, 'items.1.label', 'why').items).toEqual(['x', 'why', 'z']);
    const h = O.addHeading(w, 1, 'Later');
    expect(h.items).toEqual(['x', { label: 'y', group: 'Later' }, { label: 'z', group: 'Later' }]);
  });

  it('names a new heading so it does not repeat one', () => {
    const w = O.addHeading(W(), 1, 'New Heading');
    expect(O.uniqueName(w, 'New Heading')).toBe('New Heading 2');
  });
});

/* ── The page ──────────────────────────────────────────────────── */

const KEY = 'student-reflection-learning';
let stub;
let preview;

function pageHtml(wording) {
  const html = ReportBlocks.renderBlockStudentReflectionLearning('sci8', { id: 's1', firstName: 'Cece' }, { wording });
  return `<div id="rb-preview" class="studio-one"><div class="sheet-student"><div class="sheet-zoom">
<div class="report-sheet one-sheet"><div class="sheet-body"><div class="sheet-row">
<div class="sheet-cell" data-part="${KEY}">${html}</div></div></div></div></div></div></div>`;
}
function fakeApi(over) {
  let model = ReportOne.fromSetup('report-card');
  return Object.assign(
    {
      cid: 'sci8',
      model: () => model,
      set: vi.fn(m => {
        model = m;
      }),
      student: () => ({ id: 's1', firstName: 'Cece' }),
      students: () => [{ id: 's1' }],
      view: () => 'one',
      goStudent: vi.fn(),
      announce: vi.fn(),
      classes: () => [],
      copyWording: vi.fn(),
    },
    over || {},
  );
}
function printed(root) {
  const copy = root.cloneNode(true);
  copy.querySelectorAll('.no-print').forEach(x => x.remove());
  return copy.textContent.replace(/\s+/g, ' ').trim();
}
function load(wording) {
  const { document: doc } = parseHTML('<!doctype html><html><body>' + pageHtml(wording) + '</body></html>');
  globalThis.document = doc;
  preview = doc.getElementById('rb-preview');
}

beforeEach(() => {
  stub = globalThis.document;
  load(null);
});
afterEach(() => {
  globalThis.document = stub;
});

describe('the printed form names what it prints', () => {
  it('marks each statement, line under it, heading, scale word and question', () => {
    expect(preview.querySelector('[data-wt="items.0.label"]').textContent).toBe('Engagement');
    expect(preview.querySelector('[data-wt="items.0.prompt"]').textContent).toContain('participate');
    expect(preview.querySelector('tr[data-whead="0"]').textContent.trim()).toBe('Learning Dispositions');
    expect(preview.querySelector('[data-wt="scale.0"]').textContent).toBe('Rarely');
    expect(preview.querySelector('[data-wt="open.0"]').textContent).toContain('strength');
    // The instructions keep {name} beside the name they print.
    const intro = preview.querySelector('[data-wt="intro"]');
    expect(intro.getAttribute('data-wraw')).toContain('{name}');
    expect(intro.textContent).toContain('Cece');
  });

  it('a heading with only a blank statement under it prints alone', () => {
    const w = O.addHeading(ReportBlocks.wordingOf(KEY), 9, 'Later');
    load(w);
    const heads = Array.from(preview.querySelectorAll('tr[data-whead]')).map(t => t.textContent.trim());
    expect(heads).toEqual(['Learning Dispositions', 'Relational & Identity', 'Later']);
    expect(preview.querySelectorAll('tr[data-wrow^="items."]').length).toBe(9);
  });
});

describe('decorate', () => {
  it('makes the words typeable and adds only no-print controls; what prints is unchanged', () => {
    const text = printed(preview);
    const before = Array.from(preview.querySelectorAll('*'));
    ReportOneWords.decorate(preview, fakeApi());
    const added = Array.from(preview.querySelectorAll('*')).filter(x => before.indexOf(x) < 0);
    expect(added.length).toBeGreaterThan(0);
    added.forEach(x => expect(x.closest('.no-print'), x.outerHTML).toBeTruthy());
    expect(printed(preview)).toBe(text);
    expect(preview.querySelector('[data-wt="items.0.label"]').getAttribute('contenteditable')).toBe('plaintext-only');
    // A ⋯ beside each statement, heading and question; a grip beside each rated row.
    expect(preview.querySelectorAll('.one-w-more').length).toBe(9 + 2 + 3);
    expect(preview.querySelectorAll('.one-w-grip').length).toBe(9 + 2);
  });

  it('adds nothing in Everyone view', () => {
    const html = preview.innerHTML;
    ReportOneWords.decorate(preview, fakeApi({ view: () => 'all' }));
    expect(preview.innerHTML).toBe(html);
  });
});

describe('Edit Questions', () => {
  it('goes to One Student view when the pages show everyone', () => {
    const api = fakeApi({ view: () => 'all' });
    expect(ReportOneWords.open(api, KEY)).toBe(true);
    expect(api.goStudent).toHaveBeenCalledWith('s1');
  });

  it('leaves the dialog to the panel when there is no student', () => {
    const api = fakeApi({ student: () => null, students: () => [] });
    expect(ReportOneWords.open(api, KEY)).toBe(false);
  });
});
