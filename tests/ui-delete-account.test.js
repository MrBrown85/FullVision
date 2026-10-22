import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('delete-account desktop flow', () => {
  var originalGetCurrentUser;
  var originalReauth;
  var originalSignOut;
  var originalSoftDeleteTeacher;

  beforeEach(() => {
    originalGetCurrentUser = globalThis.getCurrentUser;
    originalReauth = globalThis.reauthenticateWithPassword;
    originalSignOut = globalThis.signOut;
    originalSoftDeleteTeacher = window.v2 && window.v2.softDeleteTeacher;
    window.v2 = window.v2 || {};
  });

  afterEach(() => {
    globalThis.getCurrentUser = originalGetCurrentUser;
    globalThis.reauthenticateWithPassword = originalReauth;
    globalThis.signOut = originalSignOut;
    window.v2.softDeleteTeacher = originalSoftDeleteTeacher;
  });

  it('keeps Delete Account out of the account menu', () => {
    var html = renderDock('dashboard');
    expect(html).toContain('Sign Out');
    expect(html).not.toContain('Delete Account');
    expect(html).not.toContain('data-action="deleteAccount"');
  });

  it('shows Reset Demo Data in the account menu only in Demo Mode', () => {
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

  it('puts Delete Account last in the Assignments Advanced menu', () => {
    var src = readFileSync(resolve(root, 'teacher/page-assignments.js'), 'utf8');
    var adv = src.slice(src.indexOf('var advHtml ='), src.indexOf('return { toolbarHtml: toolbarHtml'));
    expect(adv).toContain('data-action="deleteAccount"');
    expect(adv.lastIndexOf('data-action=')).toBe(adv.indexOf('data-action="deleteAccount"'));
  });

  it('reauthenticates, soft-deletes, and signs out when confirmation matches', async () => {
    var calls = [];
    globalThis.getCurrentUser = async function () {
      return { email: 'teacher@example.com' };
    };
    globalThis.reauthenticateWithPassword = async function (password) {
      calls.push(['reauth', password]);
    };
    window.v2.softDeleteTeacher = async function () {
      calls.push(['softDelete']);
      return { data: null, error: null };
    };
    globalThis.signOut = async function () {
      calls.push(['signOut']);
    };

    await softDeleteAccountWithPassword('teacher@example.com', 'secret-pass');

    expect(calls).toEqual([['reauth', 'secret-pass'], ['softDelete'], ['signOut']]);
  });

  it('rejects when the typed email does not match the signed-in account', async () => {
    globalThis.getCurrentUser = async function () {
      return { email: 'teacher@example.com' };
    };
    globalThis.reauthenticateWithPassword = async function () {
      throw new Error('should not be called');
    };
    window.v2.softDeleteTeacher = async function () {
      throw new Error('should not be called');
    };

    await expect(softDeleteAccountWithPassword('wrong@example.com', 'secret-pass')).rejects.toThrow(
      /Type your account email exactly/,
    );
  });
});
