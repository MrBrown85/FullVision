/**
 * Each refusal M1 raises has its own plain sentence, and none takes another's
 * (shared/data-bulletins.js _bltMessage). The messages are copied in
 * tests/fixtures/bulletins-m1-messages.js from
 * migrations/2026111801_bulletins.sql (B1a, commit fb3bebfa).
 */
import './setup.js';
import { describe, expect, it } from 'vitest';
import { GENERAL, M1_MESSAGES, NOT_ACCEPTED } from './fixtures/bulletins-m1-messages.js';

describe('the server’s refusals', () => {
  it('every message M1 raises maps to its intended sentence', () => {
    for (const m of M1_MESSAGES) {
      expect(_bltMessage({ code: m.code, message: m.example }, m.call), m.call + ': ' + m.example).toBe(m.sentence);
    }
  });

  it('no two different rules share a sentence (the shape messages, which the page cannot cause, share one)', () => {
    const rulesBySentence = {};
    for (const m of M1_MESSAGES) (rulesBySentence[m.sentence] ||= new Set()).add(m.raised + '|' + m.code);
    for (const [sentence, rules] of Object.entries(rulesBySentence)) {
      if (sentence === NOT_ACCEPTED || sentence === GENERAL) continue;
      // One rule can serve several calls (not found), but never two rules.
      expect([...rules].length, sentence).toBe(1);
    }
  });

  it('the rules the page can cause are never the general sentence', () => {
    const general = M1_MESSAGES.filter(m => m.sentence === GENERAL).map(m => m.raised);
    expect(general).toEqual(["%: the student is not in the bulletin's class"]);
  });

  it('P0002 is told apart by the call: the class for a post or a read, the bulletin for the rest', () => {
    const e = { code: 'P0002', message: 'whatever' };
    expect(_bltMessage(e, 'post_bulletin')).toBe('This class is no longer there.');
    expect(_bltMessage(e, 'list_bulletins')).toBe('This class is no longer there.');
    for (const call of ['edit_bulletin', 'delete_bulletin', 'show_bulletin_again', 'list_bulletin_seen']) {
      expect(_bltMessage(e, call), call).toBe('That bulletin is no longer there.');
    }
  });

  it('a message nobody listed gets the one general sentence, never a rule’s', () => {
    for (const message of [
      'something new the server says',
      'a bulletin needs words, a link or a file and more', // a listed rule's start is not the rule
      'the words are too long, 2000 characters, a link, a date, an assessment, pages',
      "a link's title needs a link",
      '',
    ]) {
      expect(_bltMessage({ code: '22023', message }, 'post_bulletin'), message).toBe(GENERAL);
    }
    expect(_bltMessage(null)).toBe(GENERAL);
    expect(_bltMessage({ code: 'XX000', message: 'internal error' }, 'edit_bulletin')).toBe(GENERAL);
  });

  it('the server’s own words are never shown', () => {
    for (const m of M1_MESSAGES) {
      if (m.sentence === m.example) throw new Error('a sentence is the server’s own words: ' + m.example);
      expect(_bltMessage({ code: m.code, message: m.example }, m.call)).not.toContain('%');
    }
  });
});
