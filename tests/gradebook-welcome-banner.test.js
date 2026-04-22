import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
runInThisContext(readFileSync(resolve(root, 'teacher/page-gradebook.js'), 'utf-8'), {
  filename: 'teacher/page-gradebook.js',
});

const CID = '11111111-1111-1111-1111-111111111111';
const TEACHER_ID = '22222222-2222-2222-2222-222222222222';
const BANNER_COPY =
  'Welcome! This is a sample class. Explore the features, then delete it anytime from Course Settings.';

describe('PageGradebook Welcome Class banner', () => {
  var originalDocument;
  var originalPageGradebook;
  var elements;

  function makeElement() {
    return {
      innerHTML: '',
      style: {},
      scrollTop: 0,
      classList: {
        add() {},
        remove() {},
        toggle() {},
        contains() {
          return false;
        },
      },
      addEventListener() {},
      removeEventListener() {},
      appendChild() {},
      querySelector() {
        return null;
      },
      querySelectorAll() {
        return [];
      },
    };
  }

  beforeEach(() => {
    originalDocument = globalThis.document;
    originalPageGradebook = PageGradebook;
    localStorage.clear();
    _teacherId = TEACHER_ID;
    COURSES = {};
    COURSES[CID] = { id: CID, name: 'Welcome Class', calcMethod: 'average', gradingSystem: 'proficiency' };

    elements = {
      main: makeElement(),
      'page-layout': makeElement(),
      'sidebar-mount': makeElement(),
    };

    globalThis.document = {
      createElement() {
        return makeElement();
      },
      createTextNode: originalDocument.createTextNode,
      getElementById(id) {
        if (!elements[id]) elements[id] = makeElement();
        return elements[id];
      },
      querySelector() {
        return null;
      },
      querySelectorAll() {
        return [];
      },
      addEventListener() {},
      removeEventListener() {},
      body: { appendChild() {} },
    };

    globalThis.getStudents = () => [];
    globalThis.sortStudents = arr => arr;
    globalThis.getAssessments = () => [];
    globalThis.getSections = () => [];
    globalThis.getModules = () => [];
    globalThis.getScores = () => ({});
    globalThis.getActiveCourse = () => CID;
    globalThis.setActiveCourse = () => {};
    globalThis.initData = async () => {};
    globalThis.getCategories = () => [];
    globalThis.getCategoryById = () => null;
    globalThis.getSectionForTag = () => null;
    globalThis.courseShowsLetterGrades = () => false;
  });

  afterEach(() => {
    globalThis.document = originalDocument;
    PageGradebook = originalPageGradebook;
    localStorage.clear();
  });

  it('renders the banner for a seeded Welcome Class', async () => {
    localStorage.setItem('gb-welcome-class-seeded-' + TEACHER_ID + '-' + CID, '1');

    await PageGradebook.init({ course: CID });

    expect(elements.main.innerHTML).toContain(BANNER_COPY);
    expect(elements.main.innerHTML).toContain('dismissWelcomeBanner');
  });

  it('suppresses the banner after dismissal', async () => {
    localStorage.setItem('gb-welcome-class-seeded-' + TEACHER_ID + '-' + CID, '1');
    localStorage.setItem('gb-welcome-banner-dismissed-' + TEACHER_ID + '-' + CID, '1');

    await PageGradebook.init({ course: CID });

    expect(elements.main.innerHTML).not.toContain(BANNER_COPY);
  });
});
