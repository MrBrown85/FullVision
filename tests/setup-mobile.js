/**
 * Mobile test setup — extends base setup with mobile module loading.
 * Loads m-components.js, m-students.js, m-observe.js, m-grade.js
 * so their window.MComponents / MStudents / MObserve / MGrade are available.
 */
import './setup.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { runInThisContext } from 'vm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '..');

function load(file) {
  const code = readFileSync(resolve(root, file), 'utf-8');
  runInThisContext(code, { filename: file });
}

// Shim navigator.vibrate for haptic calls
if (!globalThis.navigator.vibrate) {
  globalThis.navigator.vibrate = () => true;
}

// Fix document.createElement to support textContent → innerHTML for _esc()
const _origCreateElement = globalThis.document.createElement;
globalThis.document.createElement = (tag) => {
  const el = _origCreateElement(tag);
  let _text = '';
  Object.defineProperty(el, 'textContent', {
    get() { return _text; },
    set(v) {
      _text = v;
      el.innerHTML = v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    },
  });
  return el;
};

// Shim missing DOM functions that mobile modules use
const _origGetElementById = globalThis.document.getElementById;
const _elements = {};
globalThis.document.getElementById = (id) => {
  if (_elements[id]) return _elements[id];
  return _origGetElementById(id);
};

// Create a richer stub element factory
function _mobileStubElement(id) {
  return {
    id: id || '',
    innerHTML: '',
    textContent: '',
    style: { display: '' },
    classList: {
      _classes: new Set(),
      add(...c) { c.forEach(x => this._classes.add(x)); },
      remove(...c) { c.forEach(x => this._classes.delete(x)); },
      toggle(c, force) { if (force === undefined) { if (this._classes.has(c)) this._classes.delete(c); else this._classes.add(c); } else if (force) this._classes.add(c); else this._classes.delete(c); return this._classes.has(c); },
      contains(c) { return this._classes.has(c); },
    },
    setAttribute(k, v) { this['_attr_' + k] = v; },
    getAttribute(k) { return this['_attr_' + k] ?? null; },
    removeAttribute(k) { delete this['_attr_' + k]; },
    appendChild(child) {},
    querySelector(sel) {
      // Return a nested stub for common selectors
      if (sel === '.m-sheet') return _mobileStubElement();
      if (sel === '[data-action="m-toast-undo"]') return _mobileStubElement();
      return null;
    },
    querySelectorAll(sel) { return []; },
    addEventListener() {},
    scrollIntoView() {},
    scrollTo() {},
    remove() {},
    onclick: null,
  };
}

// Provide stub elements that mobile shell expects
['m-sheet-backdrop', 'm-sheet-container', 'm-toast', 'm-nav-stack', 'm-tab-bar', 'm-offline-banner', 'm-swiper', 'm-thumb-strip', 'm-student-card-stack', 'm-quick-bar'].forEach(id => {
  _elements[id] = _mobileStubElement(id);
});

// Load mobile modules in dependency order
load('teacher-mobile/components.js');
load('teacher-mobile/card-stack.js');
load('teacher-mobile/card-widgets.js');
load('teacher-mobile/tab-students.js');
load('teacher-mobile/tab-observe.js');
load('teacher-mobile/tab-grade.js');
// NOTE: shell.js auto-boots — we test its logic through the modules instead
