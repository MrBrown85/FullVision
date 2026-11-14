/**
 * Reports draws its tab bar from one list in page-reports.js and opens the
 * tab the address names from the same list (S16-T1). Today the list has two
 * tabs. A hidden entry, the way MyEdBC Input will sit until it is done, draws
 * no button and can't be opened from the address.
 *
 * An address naming a tab the list doesn't have at all (?tab=bogus) is a
 * different case with a known bug, pinned at the foot of this file.
 */
import './setup.js';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';

// setup.js stubs PageReports for the router; this loads the real page.
runInThisContext(readFileSync('teacher/page-reports.js', 'utf-8'), { filename: 'teacher/page-reports.js' });

const { tabs, unknownTab, tabFor, tabIdFor, tabBarHtml } = PageReports._helpers;

// The bar as it was written out by hand before the list (the toolbar literal on main).
const BAR_BEFORE =
  '<button class="seg-btn report-seg-btn active" data-action="switchTab" data-tab="questionnaire" role="tab" aria-selected="true" title="Write and approve each student’s report comment.">Term Questionnaire</button>\n' +
  '        <button class="seg-btn report-seg-btn" data-action="switchTab" data-tab="progress" role="tab" aria-selected="false" title="Build and print the class’s report cards.">Print Reports</button>';

const hiddenTab = { id: 'myed', label: 'MyEdBC Input', title: 'Marks and comments for MyEdBC.', hidden: true };

function labels(html) {
  return Array.from(html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)).map(m => m[1]);
}

describe('the Reports tab list', () => {
  it('has two tabs today, Term Questionnaire then Print Reports', () => {
    expect(tabs.map(t => t.id)).toEqual(['questionnaire', 'progress']);
    expect(tabs.map(t => t.label)).toEqual(['Term Questionnaire', 'Print Reports']);
    expect(tabs.every(t => t.hidden === false)).toBe(true);
    // The toolbar's Print Reports button belongs to the Print Reports tab.
    expect(tabs.map(t => !!t.printButton)).toEqual([false, true]);
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
    expect(labels(tabBarHtml(three))).toEqual(['Term Questionnaire', 'Print Reports', 'MyEdBC Input']);
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
    expect(tabFor(withHidden, 'myed')).not.toBe(unknownTab);
    expect(tabFor(withHidden, 'progress').id).toBe('progress');
    // The address is rewritten to the tab that opened, not the hidden one.
    expect(tabIdFor(withHidden, 'myed')).toBe('questionnaire');
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

/* TODAY'S BEHAVIOUR, PINNED, NOT ENDORSED. An address naming a tab the list
   doesn't have (/reports?tab=bogus) has always drawn Progress Reports'
   canvas with the Term Questionnaire button still lit, no student picker,
   Print Reports showing, and tab=bogus kept in the address. That is a bug.
   S16-T1 is a tidying PR and keeps it exactly; the fix (open the first tab
   instead) is a follow-up of its own. When that lands, these tests change
   with it. */
describe('an address naming a tab the list doesn’t have (a known bug, pinned as it is)', () => {
  it('gets the stray-tab entry, which is not one of the tabs', () => {
    expect(tabFor(tabs, 'bogus')).toBe(unknownTab);
    expect(tabs).not.toContain(unknownTab);
    // Not the same thing as a hidden tab, with or without one in the list.
    expect(tabFor(tabs.concat([hiddenTab]), 'bogus')).toBe(unknownTab);
  });

  it('keeps the stray name, so the address still says tab=bogus', () => {
    expect(tabIdFor(tabs, 'bogus')).toBe('bogus');
    expect(tabIdFor(tabs, 'progress')).toBe('progress');
    expect(tabIdFor(tabs, undefined)).toBe('questionnaire');
  });

  it('draws no button of its own and lights none', () => {
    expect(tabBarHtml(tabs)).toBe(BAR_BEFORE);
    expect(tabBarHtml(tabs)).not.toContain('data-tab="bogus"');
  });

  it('draws Progress Reports’ canvas', () => {
    const progress = tabs.find(t => t.id === 'progress');
    expect(unknownTab.render).toBe(progress.render);
  });

  it('shows Print Reports, which prints without the dialog: it has no print of its own', () => {
    expect(unknownTab.printButton).toBe(true);
    expect(unknownTab.print).toBeUndefined();
  });

  it('has no address of its own, no comment box, and hears no keys or resize', () => {
    expect(unknownTab.address).toBeUndefined();
    expect(unknownTab.longForm).toBeUndefined();
    expect(unknownTab.key).toBeUndefined();
    expect(unknownTab.resize).toBeUndefined();
    expect(unknownTab.show).toBeUndefined();
  });

  it('sends a roster click to the questionnaire', () => {
    expect(typeof unknownTab.pickStudent).toBe('function');
  });
});
