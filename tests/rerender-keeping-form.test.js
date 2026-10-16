/**
 * Saving a rubric made from "+ New Rubric" re-renders the Assignments page,
 * which rebuilt the new-assessment form and lost its typed title and
 * description. rerenderKeeping (teacher/ui.js) puts the form the teacher
 * was filling in back in place of the fresh copy.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('rerenderKeeping', () => {
  var stubDocument;
  var doc;

  // The page's render: rebuilds #main from scratch, form included.
  function render() {
    doc.getElementById('main').innerHTML =
      '<div id="new-assess-form"><input id="af-title" value=""><textarea id="af-desc"></textarea>' +
      '<select id="af-rubric"><option value="">None</option></select></div>' +
      '<div id="assess-list">2 assessments</div>';
  }

  beforeEach(() => {
    stubDocument = globalThis.document;
    doc = parseHTML('<!DOCTYPE html><html><body><div id="main"></div></body></html>').document;
    globalThis.document = doc;
    render();
  });

  afterEach(() => {
    globalThis.document = stubDocument;
  });

  it('keeps the typed title and description', () => {
    doc.getElementById('af-title').value = 'Persuasive Essay';
    doc.getElementById('af-desc').value = 'Argue one side of the debate.';
    doc.getElementById('assess-list').textContent = 'stale';

    rerenderKeeping('new-assess-form', render);

    expect(doc.getElementById('af-title').value).toBe('Persuasive Essay');
    expect(doc.getElementById('af-desc').value).toBe('Argue one side of the debate.');
    // The rest of the page is the fresh render.
    expect(doc.getElementById('assess-list').textContent).toBe('2 assessments');
    expect(doc.querySelectorAll('#new-assess-form').length).toBe(1);
  });

  it('keeps the same form element, so later updates reach it', () => {
    const before = doc.getElementById('new-assess-form');
    rerenderKeeping('new-assess-form', render);
    expect(doc.getElementById('new-assess-form')).toBe(before);
  });

  it('just renders when the element is not on the page', () => {
    doc.getElementById('main').innerHTML = '';
    rerenderKeeping('new-assess-form', render);
    expect(doc.getElementById('af-title').value).toBe('');
  });
});

describe('saving a rubric from the assessment form', () => {
  const src = readFileSync(resolve(root, 'teacher/page-assignments.js'), 'utf-8');
  const save = src.slice(src.indexOf('function saveRubricEdit'), src.indexOf('function newRubricFromForm'));

  it('re-renders the page around the open form', () => {
    expect(save).toContain("if (_showingNewForm) rerenderKeeping('new-assess-form', render);");
  });
});
