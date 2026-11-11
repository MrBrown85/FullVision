/**
 * S9-F1: shared/markup-draw.js, Mark Up's drawing and hit-testing, kept
 * apart from any screen so the phone's Mark Up (S9-F2) can use it too.
 */
import './setup.js';
import { describe, expect, it } from 'vitest';

const D = window.MarkupDraw;
const page = (...marks) => ({ v: 1, marks });

describe('MarkupDraw.svgHtml', () => {
  it('draws each kind of mark over a page of the shape given, and numbers the notes', () => {
    const svg = D.svgHtml(
      page(
        {
          id: 'p',
          type: 'pen',
          color: 'blue',
          width: 0.004,
          points: [
            [0.1, 0.5],
            [0.2, 0.5],
          ],
        },
        { id: 'n1', type: 'note', x: 0.5, y: 0.25, text: 'First' },
        { id: 't', type: 'tick', x: 0.3, y: 0.3, color: 'green' },
        { id: 'c', type: 'cross', x: 0.6, y: 0.6, color: 'red' },
        { id: 'h', type: 'highlight', color: 'red', width: 0.03, points: [[0, 0]] },
        { id: 'n2', type: 'note', x: 0.5, y: 0.75, text: 'Second' },
      ),
      1.5,
    );
    expect(svg).toContain('viewBox="0 0 1000 1500"');
    expect(svg).toContain('points="100,750 200,750"');
    expect(svg).toContain('stroke="#1a73e8"');
    // A highlight is see-through; one point still draws.
    expect(svg).toMatch(/class="markup-highlight"[^>]*points="0,0 0,0"[^>]*stroke-opacity="0.35"/);
    expect(svg).toContain('class="markup-tick" data-mark="t"');
    expect(svg).toContain('class="markup-cross" data-mark="c"');
    expect(svg.match(/<text[^>]*>(\d)<\/text>/g).map(t => t.replace(/<[^>]+>/g, ''))).toEqual(['1', '2']);
    expect(svg).toContain('cy="375"');
  });

  it('puts a note’s words in its pin’s title only, escaped', () => {
    const svg = D.svgHtml(page({ id: 'n', type: 'note', x: 0.5, y: 0.5, text: '<b>"Why?"</b>' }), 1);
    expect(svg).toContain('<title>&lt;b&gt;&quot;Why?&quot;&lt;/b&gt;</title>');
    expect(svg).not.toContain('<b>');
  });

  it('a note being written shows the next number', () => {
    const svg = D.svgHtml(page({ id: 'n', type: 'note', x: 0.5, y: 0.5, text: 'a' }), 1, {
      pending: { x: 0.2, y: 0.2 },
    });
    expect(svg).toMatch(/markup-pin is-pending[\s\S]*>2<\/text>/);
  });

  it('a place off the page is drawn at its edge, and a page of no shape is a letter page', () => {
    const svg = D.svgHtml(page({ id: 't', type: 'tick', x: 4, y: -1 }), 0);
    expect(svg).toContain('viewBox="0 0 1000 1294.1"');
    expect(svg).toMatch(/d="M978 0 /);
  });
});

describe('MarkupDraw.toPage', () => {
  // A page 200 wide and 400 tall, centred at (300, 300) on screen.
  const box = { cx: 300, cy: 300, w: 200, h: 400 };
  it('reads a point on an upright page', () => {
    expect(D.toPage(200, 100, box, 0)).toEqual({ x: 0, y: 0 });
    expect(D.toPage(350, 400, box, 0)).toEqual({ x: 0.75, y: 0.75 });
  });
  it('reads it back on a page turned a quarter, a half and three quarters', () => {
    // The page's top left corner is on screen at the top right after 90°.
    expect(D.toPage(500, 200, box, 90)).toEqual({ x: 0, y: 0 });
    expect(D.toPage(400, 500, box, 180)).toEqual({ x: 0, y: 0 });
    expect(D.toPage(100, 400, box, 270)).toEqual({ x: 0, y: 0 });
    expect(D.toPage(300, 300, box, 90)).toEqual({ x: 0.5, y: 0.5 });
  });
  it('keeps a point off the page on its edge', () => {
    expect(D.toPage(0, 900, box, 0)).toEqual({ x: 0, y: 1 });
  });
});

describe('MarkupDraw.hitTest', () => {
  const marks = page(
    {
      id: 'line',
      type: 'pen',
      width: 0.004,
      points: [
        [0.1, 0.1],
        [0.9, 0.1],
      ],
    },
    { id: 'tick', type: 'tick', x: 0.5, y: 0.1 },
    { id: 'note', type: 'note', x: 0.5, y: 0.8, text: 'x' },
  );
  it('finds the top mark at a place', () => {
    expect(D.hitTest(marks, { x: 0.5, y: 0.1 }, 1)).toBe('tick');
    expect(D.hitTest(marks, { x: 0.3, y: 0.105 }, 1)).toBe('line');
    expect(D.hitTest(marks, { x: 0.51, y: 0.81 }, 1)).toBe('note');
  });
  it('finds nothing away from every mark', () => {
    expect(D.hitTest(marks, { x: 0.3, y: 0.5 }, 1)).toBe(null);
    expect(D.hitTest(page(), { x: 0.3, y: 0.5 }, 1)).toBe(null);
  });
});

describe('making and taking out marks', () => {
  it('a line grows point by point and skips points too close to matter', () => {
    const line = D.stroke('highlight', 'blue', { x: 0.1, y: 0.1 });
    expect(line).toMatchObject({ type: 'highlight', color: 'blue', width: D.HIGHLIGHT_WIDTH, points: [[0.1, 0.1]] });
    expect(D.extend(line, { x: 0.1005, y: 0.1 })).toBe(false);
    expect(D.extend(line, { x: 0.2, y: 0.1 })).toBe(true);
    expect(line.points).toEqual([
      [0.1, 0.1],
      [0.2, 0.1],
    ]);
    expect(D.stroke('pen', 'purple', { x: 0, y: 0 })).toMatchObject({ type: 'pen', color: 'red', width: D.PEN_WIDTH });
  });

  it('a note takes words and no colour; a tick or cross a colour', () => {
    expect(D.place('note', 'red', { x: 0.2, y: 0.3 }, 'Why?')).toMatchObject({
      type: 'note',
      x: 0.2,
      y: 0.3,
      text: 'Why?',
    });
    expect(D.place('note', 'red', { x: 0, y: 0 }, 'a').color).toBeUndefined();
    expect(D.place('tick', 'blue', { x: 0, y: 0 }).color).toBe('blue');
    const a = D.place('cross', 'red', { x: 0, y: 0 });
    const b = D.place('cross', 'red', { x: 0, y: 0 });
    expect(a.id).not.toBe(b.id);
  });

  it('plus and without make new sets and leave the old one as it was', () => {
    const start = page({ id: 'a', type: 'tick', x: 0, y: 0 });
    const more = D.plus(start, { id: 'b', type: 'cross', x: 1, y: 1 });
    const less = D.without(more, ['a']);
    expect(start.marks.map(m => m.id)).toEqual(['a']);
    expect(more.marks.map(m => m.id)).toEqual(['a', 'b']);
    expect(less.marks.map(m => m.id)).toEqual(['b']);
    expect(D.notes(page({ id: 'x', type: 'note', x: 0, y: 0, text: 'hi' }))).toEqual([
      { n: 1, id: 'x', x: 0, y: 0, text: 'hi' },
    ]);
  });

  it('Undo and Redo go back and forward over whole sets; a new change forgets what was undone', () => {
    const h = D.history(D.empty());
    expect(h.canUndo()).toBe(false);
    h.push(page({ id: 'a', type: 'tick', x: 0, y: 0 }));
    h.push(page({ id: 'a', type: 'tick', x: 0, y: 0 }, { id: 'b', type: 'tick', x: 0, y: 0 }));
    expect(h.undo().marks.map(m => m.id)).toEqual(['a']);
    expect(h.canRedo()).toBe(true);
    expect(h.redo().marks.map(m => m.id)).toEqual(['a', 'b']);
    h.undo();
    h.push(page({ id: 'c', type: 'tick', x: 0, y: 0 }));
    expect(h.canRedo()).toBe(false);
    expect(h.redo()).toBe(null);
    expect(h.undo().marks.map(m => m.id)).toEqual(['a']);
    expect(h.undo().marks).toEqual([]);
    expect(h.undo()).toBe(null);
    // What it answers is a copy: changing it changes nothing kept.
    h.now().marks.push({ id: 'z' });
    expect(h.now().marks).toEqual([]);
  });
});
