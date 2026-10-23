import './setup.js';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('account menu', () => {
  it('has Sign Out and no Delete Account', () => {
    var html = renderDock('dashboard');
    expect(html).toContain('Sign Out');
    expect(html).not.toContain('Delete Account');
    expect(html).not.toContain('data-action="deleteAccount"');
  });

  it('shows Reset Demo Data only in Demo Mode', () => {
    var original = window.isDemoMode;
    try {
      window.isDemoMode = function () {
        return false;
      };
      expect(renderDock('dashboard')).not.toContain('data-action="resetDemoData"');
      window.isDemoMode = function () {
        return true;
      };
      expect(renderDock('dashboard')).toContain('data-action="resetDemoData"');
    } finally {
      window.isDemoMode = original;
    }
  });
});

describe('Assignments toolbar', () => {
  it('has a Rubrics button and no Advanced menu', () => {
    var src = readFileSync(resolve(root, 'teacher/page-assignments.js'), 'utf8');
    expect(src).toContain('data-action="openRubricBank">Rubrics</button>');
    expect(src).not.toContain('>Advanced</button>');
    expect(src).not.toContain('tb-advanced-panel');
    expect(src).not.toContain('data-action="deleteAccount"');
  });
});
