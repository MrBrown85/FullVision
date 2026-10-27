/**
 * The module name box on the Assignments page: selecting its text dragged
 * the whole module, Enter and Escape did nothing, and clearing it left an
 * empty box.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(resolve(root, 'teacher/page-assignments.js'), 'utf-8');
const css = readFileSync(resolve(root, 'teacher/assignments.css'), 'utf-8');

describe('module name box', () => {
  it('has a label', () => {
    expect(src).toContain('aria-label="Module name"');
  });

  it('stops the folder dragging while the name is edited', () => {
    const focus = src.slice(src.indexOf('function _handleFocus'), src.indexOf('function _handleBlur'));
    expect(focus).toContain('_setModuleDraggable(el, false)');
    const blur = src.slice(src.indexOf('function _handleBlur'), src.indexOf('function _handleKeydown'));
    expect(blur).toContain('_setModuleDraggable(el, true)');
  });

  it('saves on Enter and puts the saved name back on Escape', () => {
    const keys = src.slice(src.indexOf('function _handleKeydown'), src.indexOf('var checkInput'));
    expect(keys).toContain("e.key === 'Enter'");
    expect(keys).toContain("e.key === 'Escape'");
    expect(keys).toContain('_moduleNameSaved(e.target)');
  });

  it('shows the saved name again after an empty one', () => {
    const blur = src.slice(src.indexOf('function _handleBlur'), src.indexOf('function _handleKeydown'));
    expect(blur).toContain('el.value = saved;');
  });

  it('has one focus style', () => {
    const focus = css.slice(css.indexOf('.mod-folder-name-input:focus {'));
    const rule = focus.slice(0, focus.indexOf('}'));
    expect(rule).toContain('border-color: var(--active)');
    expect(rule).not.toContain('border-bottom');
  });
});
