/**
 * The phone's Observe feed draws a page at a time (speed, P7).
 *
 * A class's observations pile up over a year; the feed drew every one of
 * them on each visit and filter. It now draws the newest 30, then 30 more
 * on each Show More, and a visit or a filter starts again at 30. Counted,
 * not timed: the cards in the markup.
 */
import './setup-mobile.js';
import { parseHTML } from 'linkedom';

const CID = 'test';
const saved = {};

// 80 observations, one an hour, newest last in the array (the feed sorts).
function obs(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({
      id: 'ob' + i,
      studentId: i % 2 ? 'stu2' : 'stu1',
      text: 'Note ' + i,
      sentiment: i % 3 ? 'strength' : 'concern',
      created: new Date(Date.UTC(2026, 9, 1, 8) + i * 3600000).toISOString(),
      dims: [],
    });
  }
  return out;
}

function mock(list) {
  const m = {
    getStudents: () => [
      { id: 'stu1', firstName: 'Cece', lastName: 'Adams', preferred: '', designations: [] },
      { id: 'stu2', firstName: 'Noor', lastName: 'Khan', preferred: '', designations: [] },
    ],
    sortStudents: arr => arr,
    displayName: st => st.firstName + ' ' + st.lastName,
    getAllQuickObs: () => list,
    getStudentQuickObs: () => [],
    getActiveCourse: () => CID,
  };
  Object.keys(m).forEach(k => {
    saved[k] = globalThis[k];
    globalThis[k] = m[k];
  });
}

afterEach(() => {
  Object.keys(saved).forEach(k => {
    globalThis[k] = saved[k];
  });
});

function count(html) {
  return (html.match(/class="m-obs-card"/g) || []).length;
}

// The feed in a real DOM, so Show More and the filters can act on it.
function withFeed(fn) {
  const dom = parseHTML('<!doctype html><html><body></body></html>');
  const orig = globalThis.document;
  globalThis.document = dom.document;
  try {
    dom.document.body.innerHTML = MObserve.renderFeed(CID);
    return fn(dom.document);
  } finally {
    globalThis.document = orig;
  }
}

describe('Observe feed: a page at a time', () => {
  it('draws the newest 30 of 80, newest first, with Show More', () => {
    mock(obs(80));
    const html = MObserve.renderFeed(CID);
    expect(count(html)).toBe(30);
    expect(html).toContain('Note 79');
    expect(html).toContain('Note 50');
    expect(html).not.toContain('Note 49<');
    expect(html.indexOf('Note 79')).toBeLessThan(html.indexOf('Note 78'));
    expect(html).toContain('>Show More</button>');
    expect(html).toContain('Showing 30 of 80.');
  });

  it('Show More adds the next 30 under them, then the last 20, then no button', () => {
    mock(obs(80));
    withFeed(doc => {
      const cards = () => doc.querySelectorAll('#m-obs-cards .m-obs-card').length;
      MObserve.showMore(CID);
      expect(cards()).toBe(60);
      const texts = Array.from(doc.querySelectorAll('#m-obs-cards .m-obs-text')).map(e => e.textContent);
      expect(texts[30]).toBe('Note 49');
      expect(texts[59]).toBe('Note 20');
      expect(doc.querySelectorAll('.m-obs-more').length).toBe(1);
      MObserve.showMore(CID);
      expect(cards()).toBe(80);
      expect(doc.querySelector('.m-obs-more')).toBeNull();
    });
  });

  it('a day running past the page is not headed twice', () => {
    mock(obs(80));
    withFeed(doc => {
      MObserve.showMore(CID);
      const heads = Array.from(doc.querySelectorAll('#m-obs-cards .m-obs-date-group')).map(e => e.textContent);
      expect(new Set(heads).size).toBe(heads.length);
    });
  });

  it('a filter starts again at 30; a refresh keeps what is shown', () => {
    mock(obs(80));
    withFeed(doc => {
      const cards = () => doc.querySelectorAll('#m-obs-cards .m-obs-card').length;
      MObserve.showMore(CID);
      expect(cards()).toBe(60);
      MObserve.refreshFeed(CID);
      expect(cards()).toBe(60);
      MObserve.applyFilter(CID, 'student:stu1');
      expect(cards()).toBe(30);
      MObserve.applyFilter(CID, 'all');
      expect(cards()).toBe(30);
    });
  });

  it('a visit starts again at 30', () => {
    mock(obs(80));
    withFeed(() => MObserve.showMore(CID));
    expect(count(MObserve.renderFeed(CID))).toBe(30);
  });

  it('30 or fewer: every one, no button', () => {
    mock(obs(30));
    const html = MObserve.renderFeed(CID);
    expect(count(html)).toBe(30);
    expect(html).not.toContain('Show More');
  });
});
