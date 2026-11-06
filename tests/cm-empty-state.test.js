/**
 * Class Settings with no classes: the first screen offers Create a Class
 * and, for a signed-in teacher, Try Demo Mode. Open Demo Mode says
 * what happens before it leaves for /login.html?demo=1, which clears this
 * device's FullVision data. In Demo Mode itself only Create a Class shows.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

var main;
var originalGetElementById;
var originalConfirm;
var originalDemo;
var originalQueue;
var confirms;

function act(action) {
  return DashClassManager.handleAction(action, { dataset: {}, tagName: 'BUTTON' });
}

function openEmpty() {
  DashClassManager.resetState();
  DashClassManager.configure({ activeCourse: null, onRender() {}, onCourseChange() {} });
  DashClassManager.openClassManager();
}

beforeEach(() => {
  localStorage.clear();
  _useSupabase = false;
  saveCourses({});
  main = { innerHTML: '' };
  originalGetElementById = document.getElementById;
  document.getElementById = id => (id === 'main' ? main : originalGetElementById.call(document, id));
  originalConfirm = globalThis.showConfirm;
  confirms = [];
  globalThis.showConfirm = function (title, message, okLabel, okStyle, onConfirm) {
    confirms.push({ title, message, okLabel, onConfirm });
  };
  originalDemo = window.isDemoMode;
  originalQueue = window.v2Queue;
  window.isDemoMode = () => false;
});

afterEach(() => {
  document.getElementById = originalGetElementById;
  globalThis.showConfirm = originalConfirm;
  window.isDemoMode = originalDemo;
  window.v2Queue = originalQueue;
  DashClassManager.resetState();
});

describe('the zero-class screen', () => {
  it('offers Create a Class and Try Demo Mode, with a link to the Getting Started Guide', () => {
    openEmpty();
    var html = main.innerHTML;
    expect(html).toContain('No classes yet');
    expect(html).not.toContain('cm-empty-text');
    expect(html).toContain('>Create a Class</h2>');
    expect(html).toContain('Build a class from BC curriculum courses, then add students.');
    expect(html).toMatch(/data-action="cmStartCreate">Create a Class<\/button>/);
    expect(html).toContain('>Try Demo Mode</h2>');
    expect(html).toContain('A sample Science 8 class with 27 students. Nothing is saved to your account.');
    expect(html).toMatch(/data-action="cmOpenDemoMode">Open Demo Mode<\/button>/);
    expect(html).toContain('href="/help/create-a-class">Getting Started Guide</a>');
  });

  it('hides the Demo Mode card in Demo Mode', () => {
    window.isDemoMode = () => true;
    openEmpty();
    var html = main.innerHTML;
    expect(html).toContain('No classes yet');
    expect(html).toContain('data-action="cmStartCreate"');
    expect(html).not.toContain('Try Demo Mode');
    expect(html).not.toContain('cmOpenDemoMode');
  });

  it('Open Demo Mode asks first and says how to come back', () => {
    openEmpty();
    window.v2Queue = { stats: () => ({ queued: 0, deadLettered: 0 }) };
    act('cmOpenDemoMode');
    expect(confirms).toHaveLength(1);
    expect(confirms[0].title).toBe('Open Demo Mode');
    expect(confirms[0].okLabel).toBe('Open Demo Mode');
    expect(confirms[0].message).toContain('clears the FullVision data stored on it.');
    expect(confirms[0].message).toContain('Classes saved to your account are not changed.');
    expect(confirms[0].message).toContain('choose Sign Out in the account menu, then sign in.');
    expect(confirms[0].message).not.toContain('will be lost');
  });

  it('Open Demo Mode names changes not yet sent to the account', () => {
    openEmpty();
    window.v2Queue = { stats: () => ({ queued: 2, deadLettered: 1 }) };
    act('cmOpenDemoMode');
    expect(confirms[0].message).toContain(
      '3 changes on this device have not been sent to your account and will be lost.',
    );
  });
});
