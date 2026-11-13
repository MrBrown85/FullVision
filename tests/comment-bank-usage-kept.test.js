/**
 * Classmates' usage of the bank, kept per comment (speed assessment R3,
 * R4). classUsage read every bank sentence against every classmate's
 * comment on each call: on each key in Browse Sentences, each Generate and
 * each student change. Which sentences a comment holds is now kept per
 * comment's text, so only a changed comment is read again. The usage is
 * the same, to the order of its keys. Counted, not timed.
 */
import './setup.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

/* classUsage as it was before the comments were kept (main, Nov 13). */
function reference(bank, comments, record, sid) {
  const mine = sid == null ? null : String(sid);
  const list = comments
    .map(c =>
      c && typeof c === 'object'
        ? { sid: c.sid != null ? String(c.sid) : null, text: String(c.text || '') }
        : { sid: null, text: String(c == null ? '' : c) },
    )
    .filter(c => c.sid == null || c.sid !== mine);
  const out = {};
  const add = id => (out[id] = (out[id] || 0) + 1);
  bank.sentences.forEach(s => {
    const re = CommentBank.pattern(s);
    list.forEach(c => {
      if (re && re.test(c.text)) add(s.id);
    });
  });
  list.forEach(c => {
    const seen = {};
    (record[c.sid] || []).forEach(x => {
      const s = bank.sentences.find(y => y.id === x.id);
      if (!s || seen[x.id] || CommentBank.pattern(s) || c.text.indexOf(x.text) < 0) return;
      seen[x.id] = true;
      add(x.id);
    });
  });
  return out;
}

/* A bank sentence as a comment might say it: slots and choices filled. */
const said = s =>
  String(s.text)
    .replace(/\{\w+\}/g, 'Ada')
    .replace(/\[([^|\]]*)\|[^\]]*\]/g, '$1');

/* n comments of six bank sentences each, the same for the same start. */
function comments(bank, n = 27, start = 7) {
  let seed = start;
  const next = () => (seed = (seed * 16807) % 2147483647);
  const out = [];
  for (let i = 0; i < n; i++) {
    const parts = [];
    for (let k = 0; k < 6; k++) parts.push(said(bank.sentences[next() % bank.sentences.length]));
    out.push({ sid: 's' + i, text: parts.join(' ') });
  }
  return out;
}

const keyed = o => Object.keys(o).map(k => k + ':' + o[k]);

describe('classmates’ usage, kept per comment', () => {
  afterEach(() => vi.restoreAllMocks());

  it('is what reading every sentence against every comment gives, keys in the same order', () => {
    const bank = COMMENT_BANK;
    const list = comments(bank);
    const want = reference(bank, list, {}, 's3');
    expect(Object.keys(want).length).toBeGreaterThan(20);
    expect(keyed(CommentBank.classUsage(bank, list, 'cls-kept', 's3'))).toEqual(keyed(want));
    // Asked again, and with a plain string among them.
    const more = list.concat(['Plain: ' + said(bank.sentences[5])]);
    expect(keyed(CommentBank.classUsage(bank, more, 'cls-kept', 's3'))).toEqual(keyed(reference(bank, more, {}, 's3')));
  });

  it('reads only a changed comment again', () => {
    const bank = COMMENT_BANK;
    const list = comments(bank, 27, 11);
    const tests = vi.spyOn(RegExp.prototype, 'test');
    CommentBank.classUsage(bank, list, 'cls-kept2', null);
    const first = tests.mock.calls.length;
    expect(first).toBeGreaterThan(0);
    // The same comments again, for any student: no sentence is read against any of them.
    tests.mockClear();
    CommentBank.classUsage(bank, list, 'cls-kept2', 's0');
    CommentBank.classUsage(bank, list, 'cls-kept2', 's5');
    expect(tests.mock.calls.length).toBe(0);
    // One comment changed: that comment only.
    const changed = list.slice();
    changed[4] = { sid: 's4', text: list[4].text + ' ' + said(bank.sentences[40]) };
    tests.mockClear();
    const got = CommentBank.classUsage(bank, changed, 'cls-kept2', 's0');
    expect(tests.mock.calls.length).toBeGreaterThan(0);
    expect(tests.mock.calls.length).toBeLessThan(first / 10);
    tests.mockRestore();
    expect(keyed(got)).toEqual(keyed(reference(bank, changed, {}, 's0')));
  });

  it('reads the bank again when its sentences change (the teacher’s own put in place)', () => {
    const bank = { parts: COMMENT_BANK.parts, sentences: COMMENT_BANK.sentences.slice(0, 300) };
    const list = comments(bank, 8, 13);
    CommentBank.classUsage(bank, list, 'cls-kept3', null);
    const mine = { id: 'own-1', step: bank.sentences[0].step, text: 'Ada asks careful questions about every reading.' };
    bank.sentences.push(mine);
    list[0] = { sid: 's0', text: list[0].text + ' Ada asks careful questions about every reading.' };
    expect(keyed(CommentBank.classUsage(bank, list, 'cls-kept3', null))).toEqual(
      keyed(reference(bank, list, {}, null)),
    );
    // A sentence replaced in place, the list the same length.
    bank.sentences[bank.sentences.length - 1] = Object.assign({}, mine, {
      text: 'Ada reads every question with great care.',
    });
    expect(keyed(CommentBank.classUsage(bank, list, 'cls-kept3', null))).toEqual(
      keyed(reference(bank, list, {}, null)),
    );
  });

  it('counts sentences after the bank’s (a course set’s) after the bank’s own, as one list did', () => {
    const bank = { parts: COMMENT_BANK.parts, sentences: COMMENT_BANK.sentences.slice(0, 400) };
    const extra = [
      {
        id: 'set:x:s0',
        step: bank.sentences[0].step,
        text: 'Ada shows strong skill in Evidence and its uses this term.',
      },
    ];
    const list = comments(bank, 10, 17);
    list[2] = { sid: 's2', text: list[2].text + ' Ada shows strong skill in Evidence and its uses this term.' };
    const whole = { parts: bank.parts, sentences: bank.sentences.concat(extra) };
    const want = reference(whole, list, {}, 's1');
    expect(want['set:x:s0']).toBe(1);
    expect(keyed(CommentBank.classUsage(bank, list, 'cls-kept4', 's1', extra))).toEqual(keyed(want));
  });
});
