/**
 * Dropping a module did nothing: the drop listener is on the document, so
 * onModuleDropZoneDrop's event.currentTarget was the document, and reading
 * its classList threw before the new order was saved.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('dropping a module', () => {
  const src = readFileSync(resolve(root, 'teacher/page-assignments.js'), 'utf-8');
  const drop = src.slice(src.indexOf('function onModuleDropZoneDrop'), src.indexOf('function onAssessDragStart'));

  it('does not read currentTarget, which is the document', () => {
    expect(drop).not.toContain('currentTarget');
  });

  it('saves the new order', () => {
    expect(drop).toContain('saveModules(cid, modules);');
  });

  // The server orders modules by display_order, which saveModules takes from
  // sortOrder. Moving one in the array without renumbering wrote nothing, and
  // the class reloaded in the old order (two modules were left at order 0).
  it('renumbers sortOrder before saving', () => {
    const renumber = drop.indexOf('u.sortOrder = i;');
    expect(renumber).toBeGreaterThan(-1);
    expect(renumber).toBeLessThan(drop.indexOf('saveModules(cid, modules);'));
  });
});

describe('closed module folders', () => {
  const src = readFileSync(resolve(root, 'teacher/page-assignments.js'), 'utf-8');
  const load = src.slice(src.indexOf('function _loadClosedModules'), src.indexOf('function _saveClosedModules'));
  const save = src.slice(src.indexOf('function _saveClosedModules'), src.indexOf('async function switchCourse'));

  // Browser storage is wiped at sign-out, so closed folders opened again.
  it("save with the teacher's preferences, not browser storage", () => {
    expect(save).toContain('saveDashboardPrefs({ closedModules: byClass })');
    expect(save).not.toContain('localStorage');
  });

  it('load from the preferences first', () => {
    expect(load.indexOf('getDashboardPrefs()')).toBeLessThan(load.indexOf('localStorage'));
  });
});
