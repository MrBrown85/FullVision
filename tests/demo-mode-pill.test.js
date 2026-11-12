import './setup.js';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function withDemo(on, fn) {
  var original = window.isDemoMode;
  window.isDemoMode = function () {
    return on;
  };
  try {
    return fn();
  } finally {
    window.isDemoMode = original;
  }
}

describe('Demo Mode pill', () => {
  it('is in the top bar only in Demo Mode', () => {
    expect(withDemo(false, () => renderDock('dashboard'))).not.toContain('tb-demo-pill');
    expect(withDemo(true, () => renderDock('dashboard'))).toContain('tb-demo-pill');
  });

  it('sits at the left, after Toggle Sidebar', () => {
    var html = withDemo(true, () => renderDock('dashboard'));
    var left = html.slice(html.indexOf('tb-left'), html.indexOf('tb-center'));
    expect(left.indexOf('toggleSidebar')).toBeGreaterThan(-1);
    expect(left.indexOf('tb-demo-pill')).toBeGreaterThan(left.indexOf('toggleSidebar'));
  });

  it('says what Demo Mode is and offers the ways out', () => {
    var html = withDemo(true, () => renderDock('dashboard'));
    var panel = html.slice(html.indexOf('tb-demo-panel'), html.indexOf('tb-center'));
    expect(panel).toContain('Demo Mode');
    expect(panel).toContain('A sample Science 8 class. Nothing is saved to an account.');
    expect(panel).toContain('href="/login.html#signup" data-action="leaveDemoMode">Create an Account</a>');
    expect(panel).toContain('href="/login.html" data-action="leaveDemoMode">Sign In</a>');
    expect(panel).toContain('data-action="resetDemoData">Reset Demo Data</button>');
  });

  it('keeps Reset Demo Data in the account menu too', () => {
    var html = withDemo(true, () => renderDock('dashboard'));
    var menu = html.slice(html.indexOf('tb-user-dropdown'));
    expect(menu).toContain('data-action="resetDemoData"');
  });

  it('is on the phone too, with the same sheet', () => {
    var src = readFileSync(resolve(root, 'teacher-mobile/shell.js'), 'utf8');
    expect(src).toContain('_addDemoPill(stack.querySelector');
    expect(src).toContain('Demo Mode');
    expect(src).toContain("'/login.html#signup'");
    expect(src).toContain('Reset Demo Data');
  });

  it('leaves Demo Mode before the sign-in page, signing out a live session', () => {
    expect(typeof window.leaveDemoMode).toBe('function');
    var data = readFileSync(resolve(root, 'shared/data-demo.js'), 'utf8');
    expect(data).toContain('await signOut({ force: !!opts.force, redirect: href })');
    expect(window.leaveDemoUnsentText(1)).toBe(
      '1 change has not reached the server. Leaving Demo Mode signs out and deletes it.',
    );
    expect(window.leaveDemoUnsentText(3)).toBe(
      '3 changes have not reached the server. Leaving Demo Mode signs out and deletes them.',
    );
    var shell = readFileSync(resolve(root, 'teacher-mobile/shell.js'), 'utf8');
    expect(shell).toContain('window.leaveDemoMode(demoHref)');
  });

  it('runs one shared reset on both apps', () => {
    expect(typeof window.resetDemoData).toBe('function');
    var ui = readFileSync(resolve(root, 'teacher/ui.js'), 'utf8');
    expect(ui).toContain('await window.resetDemoData()');
  });
});

describe('sign-in tagline', () => {
  it('matches the splash page on both sign-in pages', () => {
    var tagline = 'The Gradebook for Communicating Student Learning in BC';
    expect(readFileSync(resolve(root, 'login.html'), 'utf8')).toContain('<p class="auth-subtitle">' + tagline + '</p>');
    expect(readFileSync(resolve(root, 'teacher-mobile/index.html'), 'utf8')).toContain(
      '<p class="m-auth-subtitle">' + tagline + '</p>',
    );
  });
});
