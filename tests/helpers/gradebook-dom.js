/* A linkedom page with the gradebook (teacher/page-gradebook.js) loaded on
   it, for tests that drive the grid: mount(seed) draws the class `seed`
   fills in, and the helpers send keys and clicks the way a browser does.
   Call unmount() in afterEach. */
import { parseHTML } from 'linkedom';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';

let stubDocument = null;
let win = null;

export function mount(seed, params = {}) {
  localStorage.clear();
  stubDocument = globalThis.document;
  const dom = parseHTML(
    '<!DOCTYPE html><html><body><div id="page-layout"><div id="sidebar-mount"></div><div id="main"></div></div><div id="gb-tooltip"></div></body></html>',
  );
  win = dom.window;
  const doc = dom.document;
  const make = doc.createElement.bind(doc);
  // The slanted header measures its titles on a canvas.
  doc.createElement = tag => {
    const el = make(tag);
    if (tag === 'canvas') el.getContext = () => ({ measureText: () => ({ width: 50 }) });
    if (tag === 'input' && !el.select) el.select = () => {};
    return el;
  };
  // linkedom draws no layout: scrolling into view does nothing.
  const proto = Object.getPrototypeOf(Object.getPrototypeOf(doc.createElement('div')));
  if (!proto.scrollIntoView) proto.scrollIntoView = function () {};
  globalThis.document = doc;
  globalThis.CSS = { escape: s => String(s) };
  globalThis.getComputedStyle = () => ({});
  PageAssignments.graderOpen = () => false;
  runInThisContext(readFileSync('teacher/page-gradebook.js', 'utf-8'), { filename: 'teacher/page-gradebook.js' });
  seed();
  clearProfCache();
  PageGradebook.init({ course: params.course, ...params });
  return doc;
}

export function unmount() {
  if (typeof dismissUndoToast === 'function') dismissUndoToast();
  PageGradebook.destroy();
  globalThis.document = stubDocument;
}

export function key(target, k, opts = {}) {
  const e = new win.Event('keydown', { bubbles: true, cancelable: true });
  e.key = k;
  Object.assign(e, opts);
  target.dispatchEvent(e);
  return e;
}

export function click(target) {
  const e = new win.Event('click', { bubbles: true, cancelable: true });
  target.dispatchEvent(e);
  return e;
}

export function fire(target, type) {
  const e = new win.Event(type, { bubbles: true, cancelable: true });
  target.dispatchEvent(e);
  return e;
}

export function showCompetencies() {
  click(document.querySelector('[data-action="setView"][data-mode="detailed"]'));
}
