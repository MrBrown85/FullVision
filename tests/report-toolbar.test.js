/**
 * The Reports toolbar (teacher/report-toolbar.js): the Ready count and its
 * track, Approve and Next turning into Print Reports ›, and the pieces the
 * old bar had (the two icons) gone. Layout and the ⋯ menu's keys are in
 * e2e/reports-toolbar.spec.js.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseHTML } from 'linkedom';

/* A linkedom page: real elements and selectors, no layout. */
let stubDocument = null;
const bar = () => {
  stubDocument = globalThis.document;
  globalThis.document = parseHTML('<!DOCTYPE html><html><body></body></html>').document;
  document.body.innerHTML = window.ReportToolbar.html('<button class="seg-btn">Tab</button>');
  return {
    text: document.getElementById('tq-ready'),
    wrap: document.getElementById('tq-ready-wrap'),
    track: document.getElementById('tq-ready-track'),
    btn: document.getElementById('tq-approve-next'),
  };
};

describe('the Reports toolbar', () => {
  let t;
  beforeEach(() => {
    t = bar();
  });
  afterEach(() => {
    globalThis.document = stubDocument;
  });

  it('has ⋯ with Edit Student and Where This Information Comes From, and no icon buttons', () => {
    expect(document.getElementById('tq-edit-student-btn')).toBeNull();
    expect(document.getElementById('tq-info-btn')).toBeNull();
    const more = document.getElementById('tq-more-btn');
    expect(more.getAttribute('aria-label')).toBe('More');
    const items = [...more.parentNode.querySelectorAll('[role="menuitem"]')];
    expect(items.map(b => [b.dataset.action, b.textContent])).toEqual([
      ['tqEditStudent', 'Edit Student'],
      ['tqInfo', 'Where This Information Comes From'],
    ]);
    // Each with its icon first, as a card's ⋯ menu has.
    expect(
      items.map(b => [b.firstElementChild.tagName.toLowerCase(), b.firstElementChild.getAttribute('aria-hidden')]),
    ).toEqual([
      ['svg', 'true'],
      ['svg', 'true'],
    ]);
    expect(more.parentNode.querySelector('.assess-menu').hidden).toBe(true);
  });

  it('the Ready count says N of M Ready and its track fills to N of M', () => {
    window.ReportToolbar.setReady(9, 27);
    expect(t.text.textContent).toBe('9 of 27 Ready');
    expect(t.track.firstElementChild.style.width).toBe('33.33%');
    expect(t.track.getAttribute('role')).toBe('progressbar');
    expect(t.track.getAttribute('aria-valuenow')).toBe('9');
    expect(t.track.getAttribute('aria-valuemax')).toBe('27');
    expect(t.track.getAttribute('aria-valuetext')).toBe('9 of 27 Ready');
    expect(t.wrap.classList.contains('is-done')).toBe(false);
  });

  it('reads All M Ready, in green, when every student is Ready', () => {
    window.ReportToolbar.setReady(27, 27);
    expect(t.text.textContent).toBe('All 27 Ready');
    expect(t.track.firstElementChild.style.width).toBe('100%');
    expect(t.wrap.classList.contains('is-done')).toBe(true);
  });

  it('Approve and Next reads Print Reports › while everyone is Ready, and goes back when one is not', () => {
    const RT = window.ReportToolbar;
    RT.setApprove(t.btn, false, 'Saves this comment.');
    RT.setReady(26, 27);
    expect(t.btn.textContent).toBe('Approve and Next ›');
    expect(RT.printing()).toBe(false);
    RT.setReady(27, 27);
    expect(t.btn.textContent).toBe('Print Reports ›');
    expect(RT.printing()).toBe(true);
    expect(t.btn.disabled).toBe(false);
    RT.setReady(26, 27);
    expect(t.btn.textContent).toBe('Approve and Next ›');
    expect(t.btn.title).toBe('Saves this comment.');
  });

  it('a comment that still waits on the teacher keeps Approve and Next, and the button stays on', () => {
    const RT = window.ReportToolbar;
    RT.setReady(27, 27);
    RT.setApprove(t.btn, true, 'Saves this comment.');
    expect(t.btn.textContent).toBe('Approve and Next ›');
    expect(t.btn.disabled).toBe(false);
    expect(t.btn.title).toBe('Saves this comment.');
    expect(RT.printing()).toBe(false);
  });

  it('a class with no students is not All Ready', () => {
    window.ReportToolbar.setReady(0, 0);
    expect(t.text.textContent).toBe('0 of 0 Ready');
    expect(window.ReportToolbar.printing()).toBe(false);
  });
});
