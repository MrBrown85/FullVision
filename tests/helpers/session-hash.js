/**
 * The student-submit function hashes a device's session token and a slip's
 * token before any statement (migrations 2026112401 and 2026112403): the
 * database is given SHA-256 of the token, never the token.
 *
 * The route tests were written with tokens in their stand-in databases.
 * `tokensAtTheDatabase(makeHandler)` makes handlers whose stand-in database
 * still sees those tokens: each hash of a `session` the test sent is turned
 * back into that token before the stand-in gets it. A token that reaches the
 * database as itself fails the test, so every route test also checks the
 * hashing.
 */
import { createHash } from 'node:crypto';

export const sha256 = text => createHash('sha256').update(text).digest('hex');

export function tokensAtTheDatabase(makeHandler) {
  return opts => {
    const sent = new Map(); // hash → the token the test sent
    const back = v => {
      if (typeof v === 'string') {
        for (const token of sent.values()) {
          if (v === token) throw new Error('a session token reached the database as itself');
        }
        return sent.has(v) ? sent.get(v) : v;
      }
      return Array.isArray(v) ? v.map(back) : v;
    };
    const db = opts.db
      ? Object.fromEntries(
          Object.entries(opts.db).map(([k, f]) => [k, typeof f === 'function' ? (...a) => f(...a.map(back)) : f]),
        )
      : opts.db;
    const handle = makeHandler({ ...opts, db });
    return async req => {
      try {
        const body = JSON.parse(await req.clone().text());
        // A card's session token and a slip's token (2026112403) alike.
        for (const s of [body && body.session, body && body.token]) {
          if (typeof s === 'string' && s.length > 0 && s.length <= 128) sent.set(sha256(s), s);
        }
      } catch {
        // Not JSON: the handler refuses it.
      }
      return handle(req);
    };
  };
}
