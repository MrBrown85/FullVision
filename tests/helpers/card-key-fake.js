/**
 * A fixed, made-up card key for the tests of the two edge functions, and
 * the tags it makes, worked out a second way.
 *
 * FAKE_KEY is the bytes 00 to 1f. It is not a secret and is not the real
 * key's shape by accident: any 64 hex characters are a key.
 *
 * The functions make their tags with Web Crypto
 * (supabase/functions/_shared/card-key.ts). The helpers here make them with
 * Node's own HMAC from the message formats as the design writes them, so a
 * test that compares the two is comparing two pieces of code, not one with
 * itself. A stand-in database uses these to know which card a tag names;
 * the real database cannot, since it never has the key.
 */
import { createHmac } from 'node:crypto';

export const FAKE_KEY = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';

const hmac = (message, key) =>
  createHmac('sha256', Buffer.from(key || FAKE_KEY, 'hex'))
    .update(message, 'utf8')
    .digest('hex');

/** Letters and digits only, upper case: a code as it is tagged. */
export const bare = code =>
  String(code || '')
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase();

export const codeTag = (code, key) => hmac('fv.card.code.v1\n' + bare(code), key);
export const passwordTag = (code, digits, key) => hmac('fv.card.pass.v1\n' + bare(code) + '\n' + digits, key);
export const keyId = key => hmac('fv.card.keyid.v1', key).slice(0, 8);

/** A random source for drawCode and drawPassword that hands out the given bytes in order, then stops. */
export function bytesFrom(list) {
  let at = 0;
  const source = into => {
    for (let i = 0; i < into.length; i++) {
      if (at >= list.length) throw new Error('the test gave too few bytes');
      into[i] = list[at++];
    }
    source.calls += 1;
    return into;
  };
  source.calls = 0;
  source.used = () => at;
  return source;
}
