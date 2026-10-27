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
});
