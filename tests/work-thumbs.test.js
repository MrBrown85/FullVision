/**
 * shared/work-thumbs.js (S14-T1): pictures of student work through one
 * helper. Every address comes from openStudentWorkPage; one per file and
 * size is asked for once and kept while an img shows it; an answer that
 * comes after the screen moved on is let go, never drawn.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';

let doc;

let realOpen;
let asks;
let released;

function file(id, path) {
  return { id, page: 1, path: path + '.jpg', thumb_path: path + '-thumb.jpg' };
}

// openStudentWorkPage, held by the test: each ask waits until answer().
function fakeOpen() {
  asks = [];
  released = [];
  globalThis.openStudentWorkPage = (cid, f, which) =>
    new Promise(resolve => {
      const path = which === 'thumb' ? f.thumb_path : f.path;
      asks.push({
        cid,
        id: f.id,
        which,
        answer: () => resolve({ url: '/x/' + path, release: () => released.push(path) }),
        none: () => resolve(null),
      });
    });
}

const settle = () => new Promise(r => setTimeout(r, 0));

function draw(files, which) {
  const root = doc.createElement('div');
  root.innerHTML = files
    .map((f, i) => '<img data-work-pic data-i="' + i + '"' + (which ? ' data-work-which="' + which + '"' : '') + '>')
    .join('');
  doc.body.appendChild(root);
  return root;
}

beforeEach(() => {
  doc = parseHTML('<!DOCTYPE html><html><body></body></html>').document;
  realOpen = globalThis.openStudentWorkPage;
  fakeOpen();
});
afterEach(() => {
  globalThis.openStudentWorkPage = realOpen;
});

describe('WorkThumbs.holder', () => {
  it('asks for each thumbnail once and draws it', async () => {
    const files = [file('a', 'p-a'), file('b', 'p-b')];
    const root = draw(files);
    const pics = WorkThumbs.holder();
    pics.fill(root, 'c1', img => files[Number(img.dataset.i)]);
    expect(asks.map(a => [a.cid, a.id, a.which])).toEqual([
      ['c1', 'a', 'thumb'],
      ['c1', 'b', 'thumb'],
    ]);
    asks.forEach(a => a.answer());
    await settle();
    expect([...root.querySelectorAll('img')].map(i => i.getAttribute('src'))).toEqual([
      '/x/p-a-thumb.jpg',
      '/x/p-b-thumb.jpg',
    ]);
    expect(pics.held()).toBe(2);
  });

  it('a page opened full size asks for the page, not the thumbnail', () => {
    const files = [file('a', 'p-a')];
    const root = draw(files, 'page');
    WorkThumbs.holder().fill(root, 'c1', () => files[0]);
    expect(asks.map(a => a.which)).toEqual(['page']);
  });

  it('drawing the screen again asks for nothing new', async () => {
    const files = [file('a', 'p-a')];
    const pics = WorkThumbs.holder();
    let root = draw(files);
    pics.fill(root, 'c1', () => files[0]);
    asks[0].answer();
    await settle();
    root.remove();
    root = draw(files);
    pics.fill(root, 'c1', () => files[0]);
    expect(asks.length).toBe(1);
    expect(root.querySelector('img').getAttribute('src')).toBe('/x/p-a-thumb.jpg');
    pics.sweep();
    expect(released).toEqual([]);
  });

  it('a second img waiting on the same file gets the one answer', async () => {
    const files = [file('a', 'p-a'), file('a', 'p-a')];
    const root = draw(files);
    WorkThumbs.holder().fill(root, 'c1', img => files[Number(img.dataset.i)]);
    expect(asks.length).toBe(1);
    asks[0].answer();
    await settle();
    expect([...root.querySelectorAll('img')].every(i => i.getAttribute('src') === '/x/p-a-thumb.jpg')).toBe(true);
  });

  it('an answer after the img left the page is let go, not drawn', async () => {
    const files = [file('a', 'p-a')];
    const root = draw(files);
    const pics = WorkThumbs.holder();
    pics.fill(root, 'c1', () => files[0]);
    const img = root.querySelector('img');
    root.remove();
    asks[0].answer();
    await settle();
    expect(img.getAttribute('src')).toBe(null);
    expect(released).toEqual(['p-a-thumb.jpg']);
    expect(pics.held()).toBe(0);
  });

  it('an answer for work that changed meanwhile is let go, not drawn', async () => {
    let now = file('a', 'p-a');
    const root = draw([now]);
    WorkThumbs.holder().fill(root, 'c1', () => now);
    now = file('a2', 'p-a2'); // replaced while the answer was on its way
    asks[0].answer();
    await settle();
    expect(root.querySelector('img').getAttribute('src')).toBe(null);
    expect(released).toEqual(['p-a-thumb.jpg']);
  });

  it('releaseAll lets go of what is held and of answers still on their way', async () => {
    const files = [file('a', 'p-a'), file('b', 'p-b')];
    const root = draw(files);
    const pics = WorkThumbs.holder();
    pics.fill(root, 'c1', img => files[Number(img.dataset.i)]);
    asks[0].answer();
    await settle();
    pics.releaseAll();
    expect(released).toEqual(['p-a-thumb.jpg']);
    asks[1].answer();
    await settle();
    expect(released).toEqual(['p-a-thumb.jpg', 'p-b-thumb.jpg']);
    expect(root.querySelectorAll('img')[1].getAttribute('src')).toBe(null);
    expect(pics.held()).toBe(0);
  });

  it('an answer asked for before releaseAll does not take the screen drawn after it', async () => {
    const files = [file('a', 'p-a')];
    const pics = WorkThumbs.holder();
    pics.fill(draw(files), 'c1', () => files[0]);
    pics.releaseAll();
    const root = draw(files);
    pics.fill(root, 'c1', () => files[0]);
    expect(asks.length).toBe(2);
    asks[0].answer(); // the old one
    await settle();
    expect(released).toEqual(['p-a-thumb.jpg']);
    expect(root.querySelector('img').getAttribute('src')).toBe(null);
    asks[1].answer();
    await settle();
    expect(root.querySelector('img').getAttribute('src')).toBe('/x/p-a-thumb.jpg');
    expect(pics.held()).toBe(1);
  });

  it('sweep lets go of an address no img shows any more', async () => {
    const files = [file('a', 'p-a'), file('b', 'p-b')];
    const root = draw(files);
    const pics = WorkThumbs.holder();
    pics.fill(root, 'c1', img => files[Number(img.dataset.i)]);
    asks.forEach(a => a.answer());
    await settle();
    root.querySelectorAll('img')[0].remove();
    pics.sweep();
    expect(released).toEqual(['p-a-thumb.jpg']);
    expect(pics.held()).toBe(1);
  });

  it('no address: nothing is drawn and nothing asked', async () => {
    const root = draw([null, { id: 'z' }]);
    WorkThumbs.holder().fill(root, 'c1', img => (img.dataset.i === '0' ? null : { id: 'z' }));
    expect(asks).toEqual([]);
  });

  it('a null answer leaves the img empty', async () => {
    const files = [file('a', 'p-a')];
    const root = draw(files);
    const pics = WorkThumbs.holder();
    pics.fill(root, 'c1', () => files[0]);
    asks[0].none();
    await settle();
    expect(root.querySelector('img').getAttribute('src')).toBe(null);
    expect(pics.held()).toBe(0);
  });

  it('names no server function', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../shared/work-thumbs.js', import.meta.url), 'utf-8');
    expect(src).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|sendBeacon|_writeRpc|\.rpc\(|getSupabase/);
  });
});
