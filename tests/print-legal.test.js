/**
 * Printing on Legal paper (teacher/print-legal.js): which browser's print
 * box the step pictures, and its words. A page can only suggest its paper;
 * the step names the setting to change in the teacher's own browser.
 */
import './setup.js';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { runInThisContext } from 'vm';
import { describe, expect, it } from 'vitest';

runInThisContext(readFileSync(resolve(__dirname, '../teacher/print-legal.js'), 'utf-8'), {
  filename: 'teacher/print-legal.js',
});
const P = window.PrintLegal;

const UA = {
  chromeMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  chromeWin:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
  safari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  firefox: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0',
};

describe('the browser whose print box the step shows', () => {
  it('Edge says Chrome and Safari in its name, and is Edge; Chrome says Safari, and is Chrome', () => {
    expect(P.browser(UA.chromeMac)).toBe('chrome');
    expect(P.browser(UA.chromeWin)).toBe('chrome');
    expect(P.browser(UA.edge)).toBe('edge');
    expect(P.browser(UA.safari)).toBe('safari');
    expect(P.browser(UA.firefox)).toBe('firefox');
    expect(P.browser('curl/8')).toBe('other');
  });
});

describe('the step, in the print box’s own words', () => {
  it('Chrome, Edge and Firefox keep the paper under More settings', () => {
    expect(P.stepText('chrome')).toBe('In Chrome’s print box: More settings › Paper size › Legal.');
    expect(P.stepText('edge')).toBe('In Edge’s print box: More settings › Paper size › Legal.');
    expect(P.stepText('firefox')).toBe('In Firefox’s print box: More settings › Paper size › Legal.');
  });

  it('Safari uses the Mac’s print box: Paper Size, US Legal, behind Show Details', () => {
    expect(P.stepText('safari')).toBe('In Safari’s print box: Paper Size › US Legal.');
    expect(P.stepHtml('safari')).toContain('Click Show Details');
  });

  it('the picture numbers each setting to change, and is hidden from a screen reader, which reads the words', () => {
    const chrome = P.stepHtml('chrome');
    expect(chrome.match(/class="pl-n"/g)).toHaveLength(2);
    expect(chrome).toContain('class="pl-pic" aria-hidden="true"');
    expect(P.stepHtml('safari').match(/class="pl-n"/g)).toHaveLength(1);
  });
});
