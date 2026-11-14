/**
 * The phone reopens on the tab the teacher last used on this device
 * (teacher-mobile/tab-bar.js, speed assessment P6): Students the first
 * time, or when what is saved is not one of the three tabs, or when
 * storage is off. The key starts with td-, which sign-out wipes.
 */
import './setup.js';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { runInThisContext } from 'vm';
import { beforeEach, describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';

const root = resolve(__dirname, '..');
runInThisContext(readFileSync(resolve(root, 'teacher-mobile/tab-bar.js'), 'utf-8'), {
  filename: 'teacher-mobile/tab-bar.js',
});
const MTabBar = globalThis.MTabBar;

describe('MTabBar', () => {
  beforeEach(() => localStorage.clear());

  it('opens on Students the first time', () => {
    expect(MTabBar.saved()).toBe('students');
  });

  it('opens on the tab used last', () => {
    MTabBar.remember('grade');
    expect(localStorage.getItem('td-mobile-tab')).toBe('grade');
    expect(MTabBar.saved()).toBe('grade');
    MTabBar.remember('observe');
    expect(MTabBar.saved()).toBe('observe');
  });

  it('opens on Students when what is saved is not a tab', () => {
    localStorage.setItem('td-mobile-tab', 'settings');
    expect(MTabBar.saved()).toBe('students');
    MTabBar.remember('nonsense');
    expect(localStorage.getItem('td-mobile-tab')).toBe('settings');
  });

  it('opens on Students when storage is off', () => {
    const get = localStorage.getItem;
    const set = localStorage.setItem;
    localStorage.getItem = () => {
      throw new Error('off');
    };
    localStorage.setItem = () => {
      throw new Error('off');
    };
    try {
      expect(() => MTabBar.remember('grade')).not.toThrow();
      expect(MTabBar.saved()).toBe('students');
    } finally {
      localStorage.getItem = get;
      localStorage.setItem = set;
    }
  });

  it('shows the open tab in the bar', () => {
    const { document } = parseHTML(
      '<nav>' +
        ['students', 'observe', 'grade']
          .map(t => `<button class="m-tab-item" data-tab="${t}"><svg class="m-tab-icon"></svg></button>`)
          .join('') +
        '</nav>',
    );
    const saved = globalThis.document;
    globalThis.document = document;
    try {
      MTabBar.paint('observe');
    } finally {
      globalThis.document = saved;
    }
    const tabs = [...document.querySelectorAll('.m-tab-item')];
    expect(tabs.map(t => t.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false']);
    expect(tabs.map(t => t.classList.contains('m-tab-active'))).toEqual([false, true, false]);
  });

  it('is wiped at sign-out with the other td- keys, and the shell opens on it', () => {
    expect(MTabBar.KEY.startsWith('td-')).toBe(true);
    expect(readFileSync(resolve(root, 'shared/supabase.js'), 'utf-8')).toContain("key.startsWith('td-')");
    const shell = readFileSync(resolve(root, 'teacher-mobile/shell.js'), 'utf-8');
    expect(shell).toContain('_activeTab = MTabBar.saved();');
    expect(shell).toContain('MTabBar.remember(tab);');
    const html = readFileSync(resolve(root, 'teacher-mobile/index.html'), 'utf-8');
    expect(html.indexOf('teacher-mobile/tab-bar.js')).toBeGreaterThan(-1);
    expect(html.indexOf('teacher-mobile/tab-bar.js')).toBeLessThan(html.indexOf('teacher-mobile/shell.js'));
  });
});
