/**
 * The student card key (supabase/functions/_shared/card-key.ts): reading
 * it, the three tags it makes, and drawing a new code and password.
 *
 * ── THE KNOWN ANSWERS BELOW MUST NEVER BE REGENERATED ──────────────────────
 * They are what the three message formats give for a fixed, made-up key.
 * Every live card in every class was stored as a tag in these formats. If
 * one of these tests fails, card-key.ts has changed what a tag is, and
 * deploying it would stop every card from opening, with no error anywhere.
 * The fix is always in card-key.ts. Changing an expected value here to make
 * a failing run pass is the one thing this file exists to prevent.
 *
 * They were worked out on Nov 10 2026 outside this code, two ways that
 * agreed: Node's crypto.createHmac, and
 *   printf 'fv.card.code.v1\nK7M4QX2P' |
 *     openssl dgst -sha256 -mac HMAC -macopt hexkey:000102…1e1f
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ALPHABET,
  CODE_LENGTH,
  drawCode,
  drawPassword,
  keyLine,
  loadCardKey,
  prettyCode,
  readCardKey,
  tidy,
} from '../supabase/functions/_shared/card-key.ts';
import { FAKE_KEY, bytesFrom, codeTag, keyId, passwordTag } from './helpers/card-key-fake.js';

// Never regenerate these (see the top of the file).
const KNOWN = {
  key: '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
  keyId: '84c20222',
  code: {
    K7M4QX2P: '6e378dc16c71e059b359f5587e4224bdf661aec4b2bdeec3a05bfcb3a224831b',
    P3R8WD4K: '0870600496bf2d6a05bef270982f6d1359dfdb5f5ba40742c67c54d661bbe25a',
  },
  password: [
    ['K7M4QX2P', '4821', 'cc968eefc4387a5a8cd44720e2e7875d9c426571a5d995ce93113703ba15d142'],
    ['K7M4QX2P', '0007', 'da09f2db98ab210d29aebf1cc5c47a5123094538bc10c9e04d0d305846de6bcf'],
    ['P3R8WD4K', '4821', '43487c36f9cc08d7fa149a65a96517d5a2f2ed0167e8665ab665fb7ffc6c3270'],
  ],
};

describe('the card key: known answers (never regenerate them)', () => {
  it('the fake key is the one the answers were made with', () => {
    expect(FAKE_KEY).toBe(KNOWN.key);
  });

  it('a code’s tag is HMAC-SHA-256 of "fv.card.code.v1", a newline and the code', async () => {
    const key = await readCardKey(KNOWN.key);
    for (const [code, tag] of Object.entries(KNOWN.code)) {
      expect(await key.codeTag(code), code).toBe(tag);
    }
  });

  it('a password’s tag is HMAC-SHA-256 of "fv.card.pass.v1", the code and the four digits, a newline between', async () => {
    const key = await readCardKey(KNOWN.key);
    for (const [code, digits, tag] of KNOWN.password) {
      expect(await key.passwordTag(code, digits), code + ' ' + digits).toBe(tag);
    }
  });

  it('the key id is the first 8 hex characters of the HMAC of "fv.card.keyid.v1"', async () => {
    expect((await readCardKey(KNOWN.key)).id).toBe(KNOWN.keyId);
  });

  it('the tests’ second way of making a tag gives the same answers', () => {
    expect(codeTag('K7M4QX2P')).toBe(KNOWN.code.K7M4QX2P);
    expect(codeTag('k7m4-qx2p')).toBe(KNOWN.code.K7M4QX2P);
    expect(passwordTag('K7M4-QX2P', '4821')).toBe(KNOWN.password[0][2]);
    expect(keyId()).toBe(KNOWN.keyId);
  });
});

describe('the card key: tags', () => {
  it('a tag is 64 lower-case hex characters, and the key id 8', async () => {
    const key = await readCardKey(FAKE_KEY);
    expect(await key.codeTag('K7M4QX2P')).toMatch(/^[0-9a-f]{64}$/);
    expect(await key.passwordTag('K7M4QX2P', '4821')).toMatch(/^[0-9a-f]{64}$/);
    expect(key.id).toMatch(/^[0-9a-f]{8}$/);
  });

  it('the same key written in upper case is the same key', async () => {
    const key = await readCardKey(FAKE_KEY.toUpperCase());
    expect(key.id).toBe(KNOWN.keyId);
    expect(await key.codeTag('K7M4QX2P')).toBe(KNOWN.code.K7M4QX2P);
  });

  it('another key gives other tags and another id', async () => {
    const other = 'ff'.repeat(32);
    const key = await readCardKey(other);
    expect(key.id).not.toBe(KNOWN.keyId);
    expect(key.id).toBe(keyId(other));
    expect(await key.codeTag('K7M4QX2P')).not.toBe(KNOWN.code.K7M4QX2P);
    expect(await key.codeTag('K7M4QX2P')).toBe(codeTag('K7M4QX2P', other));
    expect(await key.passwordTag('K7M4QX2P', '4821')).toBe(passwordTag('K7M4QX2P', '4821', other));
  });

  it('a password’s tag belongs to its card: the same digits on another card are another tag', async () => {
    const key = await readCardKey(FAKE_KEY);
    expect(await key.passwordTag('K7M4QX2P', '4821')).not.toBe(await key.passwordTag('P3R8WD4K', '4821'));
    // And a code's tag is never a password's, whatever is typed.
    expect(await key.passwordTag('K7M4QX2P', '')).not.toBe(await key.codeTag('K7M4QX2P'));
  });

  it('tags only a tidied code of eight characters, so no part of a message can hold a newline', async () => {
    const key = await readCardKey(FAKE_KEY);
    for (const code of [
      'K7M4-QX2P',
      'k7m4qx2p',
      'K7M4QX',
      'K7M4QX2PX',
      '',
      'K7M4QX2\n',
      'K7M4\nX2P',
      null,
      undefined,
      12345678,
    ]) {
      await expect(async () => key.codeTag(code), String(code)).rejects.toThrow(TypeError);
      await expect(async () => key.passwordTag(code, '4821'), String(code)).rejects.toThrow(TypeError);
    }
    for (const typed of ['48 21', '4821\n', '48\n21', 'abcd', null, undefined, 4821, 'A'.repeat(33)]) {
      await expect(async () => key.passwordTag('K7M4QX2P', typed), String(typed)).rejects.toThrow(TypeError);
    }
    // What a student may type in place of four digits is still tagged: it matches no card.
    expect(await key.passwordTag('K7M4QX2P', '')).toMatch(/^[0-9a-f]{64}$/);
    expect(await key.passwordTag('K7M4QX2P', 'ABCD')).toBe(passwordTag('K7M4QX2P', 'ABCD'));
  });

  it('tidies what was typed: letters and digits only, upper case', () => {
    expect(tidy('k7m4-qx2p')).toBe('K7M4QX2P');
    expect(tidy(' K7M4 QX2P\n')).toBe('K7M4QX2P');
    expect(tidy('K7M-4QX')).toBe('K7M4QX');
    expect(tidy('#K7M4–QX2P')).toBe('K7M4QX2P');
    expect(tidy('4 8-2 1')).toBe('4821');
    expect(tidy('')).toBe('');
    expect(tidy(null)).toBe('');
    expect(tidy(undefined)).toBe('');
    // Letters from other alphabets are dropped, not turned into something else.
    expect(tidy('ß7ı4é')).toBe('74');
  });

  it('shows a code with a dash after four', () => {
    expect(prettyCode('K7M4QX2P')).toBe('K7M4-QX2P');
    expect(prettyCode('K7M4QX')).toBe('K7M4QX');
    expect(tidy(prettyCode('K7M4QX2P'))).toBe('K7M4QX2P');
  });
});

describe('the card key: reading it', () => {
  it.each([
    ['not set', undefined],
    ['null', null],
    ['empty', ''],
    ['short', FAKE_KEY.slice(0, 63)],
    ['half', FAKE_KEY.slice(0, 32)],
    ['long', FAKE_KEY + '0'],
    ['not hex', 'g' + FAKE_KEY.slice(1)],
    ['a space in front', ' ' + FAKE_KEY.slice(1)],
    ['a newline after', FAKE_KEY + '\n'],
    ['quoted', '"' + FAKE_KEY.slice(2) + '"'],
    ['with 0x', '0x' + FAKE_KEY.slice(2)],
    ['base64 of 32 bytes', 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8='],
    ['a number', 12],
    ['a list', [FAKE_KEY]],
  ])('%s is no key', async (name, value) => {
    expect(await readCardKey(value)).toBeNull();
  });

  it('gives no way to read the key back', async () => {
    const key = await readCardKey(FAKE_KEY);
    expect(Object.keys(key).sort()).toEqual(['codeTag', 'id', 'passwordTag']);
    expect(Object.isFrozen(key)).toBe(true);
    const seen = JSON.stringify(key) + String(key) + Object.values(key).join(' ');
    expect(seen).not.toContain(FAKE_KEY);
    expect(seen).not.toContain(FAKE_KEY.slice(0, 16));
  });

  it('the start line says present with the key id, missing, or malformed, and never the key', async () => {
    const key = await readCardKey(FAKE_KEY);
    expect(keyLine('student-submit', FAKE_KEY, key)).toEqual({
      start: 'student-submit',
      card_key: 'present',
      key_id: KNOWN.keyId,
    });
    expect(keyLine('teacher-cards', undefined, null)).toEqual({ start: 'teacher-cards', card_key: 'missing' });
    expect(keyLine('teacher-cards', '', null)).toEqual({ start: 'teacher-cards', card_key: 'missing' });
    const short = FAKE_KEY.slice(0, 40);
    const line = keyLine('student-submit', short, await readCardKey(short));
    expect(line).toEqual({ start: 'student-submit', card_key: 'malformed' });
    for (const said of [line, keyLine('student-submit', FAKE_KEY, key)]) {
      const text = JSON.stringify(said);
      expect(text).not.toContain(FAKE_KEY.slice(0, 8));
      expect(text).not.toContain('40');
      expect(text).not.toContain('64');
    }
  });
});

describe('the card key: what a function does with it at start (loadCardKey)', () => {
  it('reads the secret once, logs the one line and gives back the key', async () => {
    const lines = [];
    let reads = 0;
    const key = await loadCardKey(
      'student-submit',
      () => (reads++, FAKE_KEY),
      line => lines.push(line),
    );
    expect(reads).toBe(1);
    expect(key.id).toBe(KNOWN.keyId);
    expect(await key.codeTag('K7M4QX2P')).toBe(KNOWN.code.K7M4QX2P);
    expect(lines).toEqual(['{"start":"student-submit","card_key":"present","key_id":"84c20222"}']);
  });

  it.each([
    ['not set', undefined, 'missing'],
    ['empty', '', 'missing'],
    ['one character short', FAKE_KEY.slice(0, 63), 'malformed'],
    ['not hex', 'z'.repeat(64), 'malformed'],
  ])('%s: no key, and the line says %s', async (name, value, said) => {
    const lines = [];
    const key = await loadCardKey(
      'teacher-cards',
      () => value,
      line => lines.push(line),
    );
    expect(key).toBeNull();
    expect(lines).toEqual([JSON.stringify({ start: 'teacher-cards', card_key: said })]);
  });

  it('the line never holds the secret, whatever it was', async () => {
    for (const value of [FAKE_KEY, FAKE_KEY.toUpperCase(), FAKE_KEY.slice(0, 40), 'hunter2-hunter2', ' ' + FAKE_KEY]) {
      const lines = [];
      await loadCardKey(
        'student-submit',
        () => value,
        line => lines.push(line),
      );
      expect(lines).toHaveLength(1);
      expect(lines[0]).not.toContain(value.trim().slice(0, 8));
      expect(lines[0].length).toBeLessThan(80);
    }
  });

  it('holds the secret’s text under no name outside the call', () => {
    const source = readFileSync(new URL('../supabase/functions/_shared/card-key.ts', import.meta.url), 'utf8');
    const body = source.slice(source.indexOf('export async function loadCardKey'));
    const fn = body.slice(0, body.indexOf('\n}\n') + 3);
    // One local, used to make the key and to say whether a secret was set.
    expect(fn.match(/\bvalue\b/g)).toHaveLength(3);
    expect(fn).toContain('const value = read();');
    // Nothing at the top of the module can hold a secret: no variable there is assigned after start.
    expect(source.match(/^(let|var) /gm)).toBeNull();
  });
});

describe('the card key: drawing a code and a password', () => {
  it('a code is eight characters from the slip alphabet, with no dash', () => {
    expect(ALPHABET).toBe('ABCDEFGHJKMNPQRTUVWXYZ2346789');
    expect(ALPHABET).toHaveLength(29);
    expect(CODE_LENGTH).toBe(8);
    const shape = new RegExp('^[' + ALPHABET + ']{8}$');
    const seen = new Set();
    for (let i = 0; i < 2000; i++) {
      const code = drawCode();
      expect(code).toMatch(shape);
      for (const ch of code) seen.add(ch);
    }
    // 16,000 characters: every one of the 29 turns up, and nothing else.
    expect([...seen].sort().join('')).toBe([...ALPHABET].sort().join(''));
  });

  it('a password is four digits', () => {
    const seen = new Set();
    for (let i = 0; i < 500; i++) {
      const pw = drawPassword();
      expect(pw).toMatch(/^\d{4}$/);
      for (const ch of pw) seen.add(ch);
    }
    expect([...seen].sort().join('')).toBe('0123456789');
  });

  it('uses the random source it is given, and nothing else', () => {
    // Bytes 0 to 7 are the alphabet's first eight characters.
    const source = bytesFrom([0, 1, 2, 3, 4, 5, 6, 7, 99, 99, 99, 99, 99, 99, 99, 99]);
    expect(drawCode(source)).toBe('ABCDEFGH');
    expect(source.calls).toBe(1);
    // The same bytes give the same code.
    expect(drawCode(bytesFrom([0, 1, 2, 3, 4, 5, 6, 7, 99, 99, 99, 99, 99, 99, 99, 99]))).toBe('ABCDEFGH');
    // A byte past the alphabet wraps round: 29 is A again, 57 is the last character, 58 is A.
    expect(drawCode(bytesFrom([29, 30, 57, 58, 28, 231, 203, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe('AB9A99A' + 'A');
    expect(drawPassword(bytesFrom([4, 8, 2, 1, 0, 0, 0, 0]))).toBe('4821');
    expect(drawPassword(bytesFrom([14, 28, 102, 249, 0, 0, 0, 0]))).toBe('4829');
  });

  it('throws away a byte that would make some characters likelier (rejection sampling)', () => {
    // 232 is 8 × 29: bytes 232 to 255 are not used, or A to X would each turn up 9 times in 256 and the rest 8.
    const source = bytesFrom([232, 255, 240, 0, 233, 1, 2, 254, 3, 4, 5, 6, 7, 0, 0, 0]);
    expect(drawCode(source)).toBe('ABCDEFGH');
    // 250 is 25 × 10: bytes 250 to 255 are not used for a digit.
    expect(drawPassword(bytesFrom([250, 251, 9, 255, 9, 0, 1, 0]))).toBe('9901');
  });

  it('asks for more when too many bytes were thrown away', () => {
    const first = Array(16).fill(255);
    first[3] = 0; // one good byte in the first sixteen
    const source = bytesFrom([...first, 1, 2, 3, 4, 5, 6, 7, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(drawCode(source)).toBe('ABCDEFGH');
    expect(source.calls).toBe(2);
  });

  it('every character is equally likely from every usable byte', () => {
    // Each of the 232 usable bytes once: each of the 29 characters exactly 8 times.
    const counts = {};
    for (let b = 0; b < 232; b += 8) {
      const bytes = Array.from({ length: 16 }, (_, i) => (i < 8 ? b + i : 0));
      for (const ch of drawCode(bytesFrom(bytes))) counts[ch] = (counts[ch] || 0) + 1;
    }
    expect(Object.keys(counts)).toHaveLength(29);
    expect(new Set(Object.values(counts))).toEqual(new Set([8]));
  });

  it('stops, and does not spin, when the random source is broken', () => {
    expect(() => drawCode(into => into.fill(255))).toThrow('random');
    expect(() => drawPassword(into => into.fill(250))).toThrow('random');
  });

  it('wipes its buffer when it is done', () => {
    let buffer;
    const code = drawCode(into => {
      buffer = into;
      for (let i = 0; i < into.length; i++) into[i] = i + 1;
    });
    expect(code).toBe('BCDEFGHJ');
    expect([...buffer].every(b => b === 0)).toBe(true);
  });
});
