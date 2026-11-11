/**
 * What an address counts as for the student-submit function's rate limits
 * (supabase/functions/student-submit/handler.ts, addressKey and ipHash).
 *
 * The limits live in SQL and are keyed on a hash the function makes from
 * the caller's address. An IPv4 address counts whole. An IPv6 address counts
 * as its /64: a home or school network is handed a whole /64, and a device
 * on it can take a new address within it whenever it likes, so counting
 * each full address let one connection step around the per-address limit.
 */
import { describe, expect, it } from 'vitest';
import { readCardKey } from '../supabase/functions/_shared/card-key.ts';
import { addressKey, ipHash, makeHandler } from '../supabase/functions/student-submit/handler.ts';
import { FAKE_KEY } from './helpers/card-key-fake.js';

const from = headers => new Request('https://x.supabase.co/functions/v1/student-submit', { method: 'POST', headers });
const hashOf = address => ipHash(from({ 'cf-connecting-ip': address }), 'k1');

describe('student-submit: what an address counts as', () => {
  it('counts an IPv4 address whole, as it always has', () => {
    expect(addressKey('203.0.113.7')).toBe('203.0.113.7');
    expect(addressKey('203.0.113.8')).toBe('203.0.113.8');
    expect(addressKey('10.0.0.1')).toBe('10.0.0.1');
    expect(addressKey('  203.0.113.7 ')).toBe('203.0.113.7');
    expect(addressKey('203.0.113.7:51234')).toBe('203.0.113.7');
    expect(addressKey('203.000.113.007')).toBe('203.0.113.7');
  });

  it('counts two IPv6 addresses in one /64 as one', () => {
    const key = '2001:db8:1:2::/64';
    for (const address of [
      '2001:db8:1:2::1',
      '2001:db8:1:2:aaaa:bbbb:cccc:dddd',
      '2001:db8:1:2:ffff:ffff:ffff:ffff',
      '2001:0db8:0001:0002:0000:0000:0000:0001',
      '2001:DB8:1:2::BEEF',
      '2001:db8:1:2::',
      '2001:db8:1:2:0:0:0:0',
      '2001:db8:1:2::192.0.2.1',
      '[2001:db8:1:2::1]',
      '[2001:db8:1:2::1]:443',
      '2001:db8:1:2::1%en0',
      '[2001:db8:1:2::1%25en0]:443',
    ]) {
      expect(addressKey(address), address).toBe(key);
    }
  });

  it('counts two /64s as two', () => {
    const keys = [
      '2001:db8:1:2::1',
      '2001:db8:1:3::1',
      '2001:db8:2:2::1',
      '2001:db9:1:2::1',
      '2002:db8:1:2::1',
      '2001:db8:1::1',
      '2001:db8::1',
      '::1',
      'fe80::1%en0',
    ].map(addressKey);
    expect(keys).toEqual([
      '2001:db8:1:2::/64',
      '2001:db8:1:3::/64',
      '2001:db8:2:2::/64',
      '2001:db9:1:2::/64',
      '2002:db8:1:2::/64',
      '2001:db8:1:0::/64',
      '2001:db8:0:0::/64',
      '0:0:0:0::/64',
      'fe80:0:0:0::/64',
    ]);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('counts an IPv4 address written as IPv6 as that IPv4 address', () => {
    for (const address of [
      '::ffff:203.0.113.7',
      '::FFFF:203.0.113.7',
      '::ffff:cb00:7107',
      '0:0:0:0:0:ffff:203.0.113.7',
      '0000:0000:0000:0000:0000:ffff:cb00:7107',
      '[::ffff:203.0.113.7]:443',
    ]) {
      expect(addressKey(address), address).toBe('203.0.113.7');
    }
    expect(addressKey('::ffff:203.0.113.8')).toBe('203.0.113.8');
    // Only the mapped form. Other addresses that end in an IPv4 address are IPv6 addresses.
    expect(addressKey('::203.0.113.7')).toBe('0:0:0:0::/64');
    expect(addressKey('64:ff9b::203.0.113.7')).toBe('64:ff9b:0:0::/64');
    expect(addressKey('::fffe:203.0.113.7')).toBe('0:0:0:0::/64');
  });

  it('counts anything that is not an address as unknown, the key a missing address has', () => {
    for (const address of [
      '',
      '   ',
      null,
      undefined,
      'unknown',
      'localhost',
      'not an address',
      '203.0.113',
      '203.0.113.7.9',
      '203.0.113.256',
      '203.0.113.-1',
      '1e3.0.0.1',
      '2001:db8:1:2',
      '2001:db8:1:2:3:4:5:6:7',
      '2001:db8::1::2',
      '2001:db8:::1',
      ':2001:db8:1:2:3:4:5',
      '2001:db8:1:2:3:4:5:',
      '2001:db8:1:2:3:4:5:6::',
      '2001:dbg8:1:2::1',
      '2001:db8:12345:2::1',
      '::ffff:203.0.113.256',
      '::ffff:203.0.113',
      '1:2:3:4:5:6:7:203.0.113.7',
      '[2001:db8:1:2::1',
      '2001:db8:1:2::1]',
      '%en0',
      '<script>',
      '2001:db8:1:2::' + '1'.repeat(200),
      '\u0000',
    ]) {
      expect(addressKey(address), String(address)).toBe('unknown');
    }
  });

  it('never gives a made-up address a key of its own', () => {
    const keys = new Set();
    for (let i = 0; i < 200; i++) keys.add(addressKey('guess-' + i));
    for (let i = 0; i < 200; i++) keys.add(addressKey('2001:db8:1:2:' + i.toString(16) + '::' + i.toString(16)));
    expect([...keys].sort()).toEqual(['2001:db8:1:2::/64', 'unknown']);
  });
});

describe('student-submit: the hashed address', () => {
  it('is the same for two addresses in one /64 and different for two /64s', async () => {
    const a = await hashOf('2001:db8:1:2::1');
    const b = await hashOf('2001:db8:1:2:aaaa:bbbb:cccc:dddd');
    const c = await hashOf('2001:db8:1:3::1');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).toBe(a);
    expect(c).not.toBe(a);
  });

  it('is unchanged for an IPv4 address: the hash of the address itself', async () => {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode('k1'),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('203.0.113.7')));
    const before = Array.from(sig, b => b.toString(16).padStart(2, '0')).join('');
    expect(await hashOf('203.0.113.7')).toBe(before);
    expect(await hashOf('203.0.113.8')).not.toBe(before);
    // The same connection, written as IPv6.
    expect(await hashOf('::ffff:203.0.113.7')).toBe(before);
  });

  it('still takes the address from cf-connecting-ip, then the last forwarded entry', async () => {
    const a = await hashOf('2001:db8:1:2::1');
    const forged = await ipHash(
      from({ 'cf-connecting-ip': '2001:db8:1:2::9', 'x-forwarded-for': '2001:db8:ffff:1::1, 2001:db8:1:2::9' }),
      'k1',
    );
    const local = await ipHash(from({ 'x-forwarded-for': '2001:db8:ffff:1::1, 2001:db8:1:2::7' }), 'k1');
    expect(forged).toBe(a);
    expect(local).toBe(a);
  });

  it('gives no address and a made-up one the same hash', async () => {
    const none = await ipHash(from({}), 'k1');
    expect(await hashOf('not an address')).toBe(none);
    expect(await hashOf('2001:db8:1:2')).toBe(none);
    expect(await hashOf('2001:db8:1:2::1')).not.toBe(none);
  });

  it('reaches every route as one key for one /64, with no part of the address', async () => {
    const calls = [];
    const record =
      route =>
      async (...args) => {
        calls.push({ route, hash: args.at(-1), args });
        return { ok: true };
      };
    const handle = makeHandler({
      region: 'ca-central-1',
      ipKey: 'test-key',
      cardKey: await readCardKey(FAKE_KEY),
      log: () => {},
      db: {
        open: record('open'),
        verify: record('verify'),
        check: record('check'),
        submit: record('submit'),
        async call(text, params) {
          calls.push({ route: 'card', hash: params.at(-1), args: params });
          return { ok: true };
        },
      },
    });
    const token = 'a'.repeat(64);
    const bodies = [
      { route: 'open', code: 'K7M-4QX' },
      { route: 'verify', token, student_number: '0123456' },
      { route: 'check', token, birthday: '2012-05-15' },
      { route: 'submit', token, answers: {} },
      { route: 'card', code: 'P3R8-WD4K' },
      { route: 'done', session: token },
    ];
    for (const address of ['2001:db8:1:2::1', '2001:db8:1:2:aaaa:bbbb:cccc:dddd']) {
      for (const body of bodies) {
        const res = await handle(
          new Request('https://x.supabase.co/functions/v1/student-submit', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'cf-connecting-ip': address },
            body: JSON.stringify(body),
          }),
        );
        expect(res.status).toBe(200);
      }
    }
    expect(calls).toHaveLength(12);
    expect(new Set(calls.map(c => c.hash)).size).toBe(1);
    expect(calls[0].hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(calls)).not.toContain('2001');
  });
});
