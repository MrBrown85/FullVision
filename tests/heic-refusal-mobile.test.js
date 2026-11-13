/**
 * Add Work on the phone (S7-F3) and a student's To Grade list and the
 * Grade tab's count (S7-F4), on Demo Mode's sample work (Science 8, Cell
 * Microscope Lab). teacher-mobile/add-work.js and grade-photos.js; the data
 * functions are tests/teacher-work.test.js's.
 */
import './setup-mobile.js';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { newBankIndex } from './helpers/bc-bank-fixture.js';
import { ungradeLabNotSent } from './helpers/demo-lab-not-in.js';

const CID = 'sci8';
const LAB = 'sci8a1';
// Light Refraction Lab: the sample's piece with work waiting (ruling 115).
const LIGHT = 'sci8a21';
let wasDemo;
let stubDocument;
let store;
let urls;

function seedDemo() {
  window.isDemoMode = () => true;
  Object.keys(COURSES).forEach(cid => _clearCourseLocalState(cid));
  localStorage.clear();
  CURRICULUM_INDEX = newBankIndex(['SCI8']);
  seedIfNeeded();
}

function turnOn({ sendWork = true, page = true } = {}) {
  if (page) setStudentPageSwitch(CID, true, 'on_return');
  const work = getCourseSubmissions(CID);
  work.course.send_work = sendWork;
  saveDemoStudentWork(CID, work);
}

function memoryStore() {
  const metas = new Map();
  const files = new Map();
  const copy = v => JSON.parse(JSON.stringify(v));
  return {
    async list() {
      return [...metas.values()].map(copy);
    },
    async putAll(items) {
      items.forEach(i => {
        metas.set(i.meta.id, copy(i.meta));
        files.set(i.meta.id, { photo: i.photo, thumb: i.thumb });
      });
    },
    async update(id, patch) {
      if (metas.has(id)) metas.set(id, window.PhotoQueue.applyPatch(copy(metas.get(id)), copy(patch)));
    },
    async blobs(id) {
      return files.get(id) || null;
    },
    async remove(ids) {
      ids.forEach(id => {
        metas.delete(id);
        files.delete(id);
      });
    },
    async clear() {
      metas.clear();
      files.clear();
    },
    count: () => metas.size,
  };
}

// What PhotoShrink.prepare gives for one file: n pages.
function shrunkOf(n = 1) {
  return {
    ok: true,
    kind: 'jpeg',
    pages: Array.from({ length: n }, (_, i) => ({
      blob: new Blob(['page' + i], { type: 'image/jpeg' }),
      thumb: new Blob(['t' + i], { type: 'image/jpeg' }),
      hash: String(i).padStart(64, 'b'),
      width: 1500,
      height: 2000,
    })),
  };
}
const photo = name => ({ name: name || 'IMG_1.jpg', size: 10 });

function page() {
  const dom = parseHTML(
    '<!DOCTYPE html><html><body><div id="m-nav-stack"></div>' +
      '<nav id="m-tab-bar"><button class="m-tab-item" data-tab="grade"><span class="m-tab-label">Grade</span></button></nav>' +
      '<div id="m-sheet-backdrop" class="u-hidden"></div><div id="m-sheet-container"></div>' +
      '<div id="m-toast"></div></body></html>',
  );
  dom.window.HTMLElement.prototype.scrollTo = function () {};
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  dom.window.HTMLElement.prototype.focus = function () {};
  globalThis.document = dom.document;
}
const stack = () => document.getElementById('m-nav-stack');
const lab = () => getAssessments(CID).find(a => a.id === LAB);
const name = sid => getStudents(CID).find(s => s.id === sid);
const shortName = sid => displayNameFirst(name(sid)) + ' ' + name(sid).lastName.charAt(0) + '.';
const screen = () => document.getElementById('m-addwork');
const click = sel => screen().querySelector(sel).click();
const flush = () => new Promise(r => setTimeout(r, 0));

function grading() {
  // html-safe: MGrade.renderSwiper escapes names and text; a test page
  stack().innerHTML = MGrade.renderSwiper(CID, LAB);
  return stack();
}

beforeAll(() => {
  wasDemo = window.isDemoMode;
  runInThisContext(readFileSync('shared/seed-data.js', 'utf-8'), { filename: 'shared/seed-data.js' });
});
afterAll(() => {
  window.isDemoMode = wasDemo;
  CURRICULUM_INDEX = null;
  localStorage.clear();
});
beforeEach(() => {
  stubDocument = globalThis.document;
  page();
  seedDemo();
  // The students who sent nothing have no grade yet, so they are Not In.
  ungradeLabNotSent(CID, LAB);
  store = memoryStore();
  window.PhotoQueue.configure({ store, isDemo: () => window.isDemoMode(), upload: async () => ({ error: null }) });
  urls = { made: 0, revoked: [] };
  URL.createObjectURL = () => 'blob:t' + ++urls.made;
  URL.revokeObjectURL = u => urls.revoked.push(u);
  MAddWork.configure({ prepare: async () => shrunkOf(1), onGrade: null });
});
afterEach(() => {
  MAddWork.close();
  globalThis.document = stubDocument;
  vi.restoreAllMocks();
});

describe('a HEIC photo with no reader, on the phone', () => {
  it('says to take the photo here or save a JPEG; other unreadable photos keep the old words', async () => {
    turnOn();
    MAddWork.open(CID, LAB, MGradePhotos.notIn(CID, lab())[0]);
    const msg = () => screen().querySelector('.m-addwork-msg').textContent;
    MAddWork.configure({ prepare: async () => ({ ok: false, reason: 'no_decoder', kind: 'heic' }) });
    await MAddWork.addFiles([photo('IMG_1.heic')]);
    expect(msg()).toBe('Take the photo here, or save it as a JPEG first.');
    MAddWork.configure({ prepare: async () => ({ ok: false, reason: 'unreadable', kind: 'jpeg' }) });
    await MAddWork.addFiles([photo('IMG_2.jpg')]);
    expect(msg()).toBe("That file couldn't be used. Try another photo.");
    MAddWork.configure({ prepare: async () => ({ ok: false, reason: 'unreadable', kind: 'heic' }) });
    await MAddWork.addFiles([photo('IMG_3.heic')]);
    expect(msg()).toBe("That file couldn't be used. Try another photo.");
  });
});
