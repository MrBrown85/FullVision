/**
 * A key in the Teacher Comment box (speed assessment R8): the count under
 * the box asks which sentences are over 20 words two or three times a key
 * (the count's tail, its colour, Approve). They are counted once per text.
 * Counted, not timed.
 */
import './setup.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

const RQ = ReportQuestionnaire;
const long =
  'This sentence has more than twenty words in it so that the realiser counts it as long for a report card comment today.';

describe('long sentences, once per text', () => {
  afterEach(() => vi.restoreAllMocks());

  it('reads a comment’s sentences once however often it is asked, and again when it changes', () => {
    const tooLong = vi.spyOn(CommentRealiser, 'tooLong');
    const text = 'Short one. ' + long + ' Another short one.';
    expect(RQ.longSentences(text)).toEqual([long]);
    const first = tooLong.mock.calls.length;
    expect(first).toBe(3);
    expect(RQ.longSentences(text)).toEqual([long]);
    expect(RQ.longSentences(text)).toEqual([long]);
    expect(tooLong.mock.calls.length).toBe(first);
    expect(RQ.longSentences(text + ' One more.')).toEqual([long]);
    expect(tooLong.mock.calls.length).toBe(first + 4);
  });

  it('gives a list of its own each time', () => {
    const a = RQ.longSentences(long);
    a.push('changed');
    expect(RQ.longSentences(long)).toEqual([long]);
  });
});
