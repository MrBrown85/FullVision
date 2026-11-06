/**
 * The student page header's email (docs/plans/dashboard-cards-plan.md, D):
 * shown only when the student has one, a button that copies it and says
 * Copied for 1.5 s, and selects the address where the browser won't copy.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';

const CID = 'course-email';
const SID = 'stu-email';
const ADDRESS = 'cece.adeyemi@students.example.ca';

function header(student) {
  _cache.students[CID] = [{ id: SID, firstName: 'Cece', lastName: 'Adeyemi', ...student }];
  return renderStudentHeader(CID, SID);
}

function mount(html) {
  const doc = parseHTML('<!DOCTYPE html><html><body>' + html + '</body></html>').document;
  globalThis.document = doc;
  return doc.querySelector('.stu-email-copy');
}

describe('student header email', () => {
  let stubDocument, clipboard, getSelection;

  beforeEach(() => {
    localStorage.clear();
    stubDocument = globalThis.document;
    clipboard = Object.getOwnPropertyDescriptor(globalThis.navigator, 'clipboard');
    getSelection = globalThis.getSelection;
    if (typeof COURSES === 'undefined') globalThis.COURSES = {};
    COURSES[CID] = { id: CID, name: 'Science 8', gradingSystem: 'proficiency' };
    _cache.assessments[CID] = [];
    _cache.scores[CID] = {};
    _cache.statuses[CID] = {};
    _cache.courseConfigs[CID] = {};
    clearProfCache();
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.document = stubDocument;
    if (clipboard) Object.defineProperty(globalThis.navigator, 'clipboard', clipboard);
    else delete globalThis.navigator.clipboard;
    globalThis.getSelection = getSelection;
    delete COURSES[CID];
    delete _cache.students[CID];
  });

  function setClipboard(value) {
    Object.defineProperty(globalThis.navigator, 'clipboard', { value, configurable: true, writable: true });
  }

  it('shows nothing when the student has no email', () => {
    const html = header({ pronouns: 'she/her', studentNumber: '2558147', email: '' });
    expect(html).toContain('2558147');
    expect(html).not.toContain('stu-email-copy');
    expect(html).not.toContain('mailto:');
  });

  it('appends the email to the line as a copy button', () => {
    const btn = mount(
      header({ pronouns: 'she/her', studentNumber: '2558147', dateOfBirth: '2010-01-01', email: ADDRESS }),
    );
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.getAttribute('type')).toBe('button');
    expect(btn.getAttribute('title')).toBe('Copy email address');
    expect(btn.getAttribute('aria-label')).toBe('Copy ' + ADDRESS);
    expect(btn.querySelector('.stu-email-text').textContent).toBe(ADDRESS);
    expect(btn.querySelector('.stu-email-text').getAttribute('title')).toBe(ADDRESS);
    expect(btn.querySelector('svg').getAttribute('aria-hidden')).toBe('true');
    // The fourth item, after pronouns, student number and birthday.
    const meta = btn.parentNode;
    expect(meta.className).toBe('sh-meta');
    expect(meta.lastElementChild).toBe(btn);
    expect(meta.querySelectorAll('.sh-dot').length).toBe(3);
    expect(meta.innerHTML).not.toContain('mailto:');
  });

  it('escapes the address', () => {
    const html = header({ email: 'a"<b>@example.ca' });
    expect(html).not.toContain('<b>');
    expect(html).toContain('aria-label="Copy a&quot;&lt;b&gt;@example.ca"');
  });

  it('copies the address and says Copied for 1.5 s', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn(() => Promise.resolve());
    setClipboard({ writeText });
    const btn = mount(header({ email: ADDRESS }));
    expect(await copyStudentEmail(btn)).toBe(true);
    expect(writeText).toHaveBeenCalledWith(ADDRESS);
    expect(btn.classList.contains('is-copied')).toBe(true);
    expect(btn.querySelector('.stu-email-copied').textContent).toBe('Copied');
    vi.advanceTimersByTime(1499);
    expect(btn.classList.contains('is-copied')).toBe(true);
    vi.advanceTimersByTime(1);
    expect(btn.classList.contains('is-copied')).toBe(false);
  });

  it('selects the address when there is no clipboard', async () => {
    setClipboard(undefined);
    const ranges = [];
    globalThis.getSelection = () => ({ removeAllRanges() {}, addRange: r => ranges.push(r) });
    const btn = mount(header({ email: ADDRESS }));
    document.createRange = () => ({
      selectNodeContents(node) {
        this.node = node;
      },
    });
    expect(await copyStudentEmail(btn)).toBe(false);
    expect(btn.classList.contains('is-copied')).toBe(false);
    expect(ranges.length).toBe(1);
    expect(ranges[0].node).toBe(btn.querySelector('.stu-email-text'));
    // The hidden textarea the last-resort copy uses is gone again.
    expect(document.querySelector('textarea')).toBe(null);
  });

  it('selects the address when the browser refuses', async () => {
    setClipboard({ writeText: () => Promise.reject(new Error('denied')) });
    const ranges = [];
    globalThis.getSelection = () => ({ removeAllRanges() {}, addRange: r => ranges.push(r) });
    const btn = mount(header({ email: ADDRESS }));
    document.createRange = () => ({ selectNodeContents() {} });
    expect(await copyStudentEmail(btn)).toBe(false);
    expect(ranges.length).toBe(1);
  });

  it('copyTextToClipboard resolves to whether it copied', async () => {
    setClipboard({ writeText: () => Promise.resolve() });
    expect(await copyTextToClipboard('x')).toBe(true);
    expect(UI.copyTextToClipboard).toBe(copyTextToClipboard);
  });
});
