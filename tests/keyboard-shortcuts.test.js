import './setup.js';
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Every aria-keyshortcuts value written in the app's source.
function declaredShortcuts() {
  const found = new Set();
  for (const dir of ['teacher', 'teacher-mobile', 'shared']) {
    for (const f of readdirSync(resolve(root, dir))) {
      if (!/\.(js|html)$/.test(f)) continue;
      const src = readFileSync(resolve(root, dir, f), 'utf8');
      for (const m of src.matchAll(/aria-keyshortcuts="([^"]+)"/g)) found.add(m[1]);
    }
  }
  return found;
}

describe('KEYBOARD_SHORTCUTS', () => {
  it('lists every aria-keyshortcuts in the app', () => {
    const listed = new Set(KEYBOARD_SHORTCUTS.map(s => s.keys));
    for (const keys of declaredShortcuts()) expect(listed, keys).toContain(keys);
  });

  it('lists nothing the app no longer declares', () => {
    const declared = declaredShortcuts();
    for (const s of KEYBOARD_SHORTCUTS) expect(declared, s.action).toContain(s.keys);
  });

  it('names each row with a context and an action in Title Case', () => {
    for (const s of KEYBOARD_SHORTCUTS) {
      expect(s.context).toMatch(/^[A-Z]/);
      expect(s.action).toMatch(/^[A-Z]/);
    }
  });

  it('shows ⌘ on a Mac and Ctrl elsewhere', () => {
    expect(shortcutKeys('Control+Shift+Enter Meta+Shift+Enter', true)).toEqual(['⌘', 'Shift', 'Enter']);
    expect(shortcutKeys('Control+Shift+Enter Meta+Shift+Enter', false)).toEqual(['Ctrl', 'Shift', 'Enter']);
    expect(shortcutKeys('Meta+Enter Control+Enter', false)).toEqual(['Ctrl', 'Enter']);
    expect(shortcutKeys('Escape', true)).toEqual(['Esc']);
    expect(shortcutKeys('?', false)).toEqual(['?']);
  });
});

describe('Help button', () => {
  it('sits between the sync dot and the account button', () => {
    const html = renderDock('dashboard');
    const sync = html.indexOf('id="sync-indicator-dot"');
    const help = html.indexOf('data-action="toggleHelp"');
    const account = html.indexOf('class="tb-user-menu"');
    expect(sync).toBeGreaterThan(-1);
    expect(help).toBeGreaterThan(sync);
    expect(account).toBeGreaterThan(help);
    expect(html).toContain('aria-controls="help-panel"');
  });

  it('the phone Settings sheet links to the help site', () => {
    const src = readFileSync(resolve(root, 'teacher-mobile/shell.js'), 'utf8');
    expect(src).toContain('href="/help" target="_blank" rel="noopener">Help</a>');
  });
});
