/**
 * Reports draws its tab bar from one list in page-reports.js and opens the
 * tab the address names from the same list (S16-T1). Today the list has two
 * tabs. A hidden entry, the way MyEdBC Input will sit until it is done, draws
 * no button and can't be opened from the address.
 */
import './setup.js';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';

// setup.js stubs PageReports for the router; this loads the real page.
runInThisContext(readFileSync('teacher/page-reports.js', 'utf-8'), { filename: 'teacher/page-reports.js' });

const { tabs, tabFor, tabBarHtml } = PageReports._helpers;

// The bar as it was written out by hand before the list (the toolbar literal on main).
const BAR_BEFORE =
  '<button class="seg-btn report-seg-btn active" data-action="switchTab" data-tab="questionnaire" role="tab" aria-selected="true" title="Write and approve each student’s report comment.">Term Questionnaire</button>\n' +
  '        <button class="seg-btn report-seg-btn" data-action="switchTab" data-tab="progress" role="tab" aria-selected="false" title="Build and print the class’s report cards.">Progress Reports</button>';

const hiddenTab = { id: 'myed', label: 'MyEdBC Input', title: 'Marks and comments for MyEdBC.', hidden: true };

function labels(html) {
  return Array.from(html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)).map(m => m[1]);
}

describe('the Reports tab list', () => {
  it('has two tabs today, Term Questionnaire then Progress Reports', () => {
    expect(tabs.map(t => t.id)).toEqual(['questionnaire', 'progress']);
    expect(tabs.map(t => t.label)).toEqual(['Term Questionnaire', 'Progress Reports']);
    expect(tabs.every(t => t.hidden === false)).toBe(true);
  });

  it('gives every tab what the page needs to draw it and to clear up after it', () => {
    tabs.forEach(t => {
      expect(typeof t.show, t.id + ' show').toBe('function');
      expect(typeof t.render, t.id + ' render').toBe('function');
      expect(typeof t.teardown, t.id + ' teardown').toBe('function');
    });
  });

  it('draws the bar the page had before the list, mark for mark', () => {
    expect(tabBarHtml(tabs)).toBe(BAR_BEFORE);
  });

  it('draws one button for each tab, in the list’s order', () => {
    const three = tabs.concat([Object.assign({}, hiddenTab, { hidden: false })]);
    expect(labels(tabBarHtml(three))).toEqual(['Term Questionnaire', 'Progress Reports', 'MyEdBC Input']);
    expect(tabBarHtml(three)).toContain('data-tab="myed"');
    // Only the first is drawn selected.
    expect(tabBarHtml(three).match(/aria-selected="true"/g)).toHaveLength(1);
  });

  it('draws no button for a hidden tab', () => {
    const withHidden = tabs.concat([hiddenTab]);
    expect(tabBarHtml(withHidden)).toBe(BAR_BEFORE);
    expect(tabBarHtml(withHidden)).not.toContain('MyEdBC Input');
  });

  it('escapes a tab’s words', () => {
    const html = tabBarHtml([{ id: 'a"b', label: 'Marks & <Comments>', title: 'Say "hi"' }]);
    expect(html).toContain('data-tab="a&quot;b"');
    expect(html).toContain('title="Say &quot;hi&quot;"');
    expect(html).toContain('>Marks &amp; &lt;Comments&gt;</button>');
  });
});

describe('which tab an address opens', () => {
  it('opens the tab it names', () => {
    expect(tabFor(tabs, 'questionnaire').id).toBe('questionnaire');
    expect(tabFor(tabs, 'progress').id).toBe('progress');
  });

  it('opens the first tab when it names none', () => {
    expect(tabFor(tabs, undefined).id).toBe('questionnaire');
    expect(tabFor(tabs, '').id).toBe('questionnaire');
  });

  it('can’t open a hidden tab: the first tab opens instead', () => {
    const withHidden = tabs.concat([hiddenTab]);
    expect(tabFor(withHidden, 'myed').id).toBe('questionnaire');
    expect(tabFor(withHidden, 'progress').id).toBe('progress');
  });

  it('opens that tab once it is no longer hidden', () => {
    const three = tabs.concat([Object.assign({}, hiddenTab, { hidden: false })]);
    expect(tabFor(three, 'myed').id).toBe('myed');
  });

  it('skips a hidden first tab when choosing where Reports opens', () => {
    const hiddenFirst = [hiddenTab].concat(tabs);
    expect(tabFor(hiddenFirst, undefined).id).toBe('questionnaire');
  });
});
