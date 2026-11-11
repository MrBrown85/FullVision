// Who a sign-in token belongs to, asked of Supabase Auth (GET /auth/v1/user).
//
// The same check as teacher-cards' authUser (supabase/functions/teacher-cards/
// handler.ts), kept here so student-submit's `sweep` route can use it without
// reaching into another function's folder. FullVision has no student or
// parent logins: every user Auth knows is a teacher.
//
// Only a 200 that names a user is a yes. A token Auth refuses (any 4xx but
// "slow down") is null. Anything else is thrown, so an Auth outage is never
// read as "signed in". An answer that has not come in TIMEOUT_MS is an
// outage too (review L4). Nothing here decodes a token, and no token is
// logged.
//
// No Deno imports: `fetcher` is fetch.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A sign-in token's shape: what a Supabase access token can be, and no more. */
export function tokenShape(v: unknown): string | null {
  return typeof v === 'string' && /^[A-Za-z0-9._~+/=-]{20,4096}$/.test(v) ? v : null;
}

/** How long Auth may take to say whose a token is. */
export const TIMEOUT_MS = 10_000;

export function authUser(
  fetcher: typeof fetch,
  supabaseUrl: string,
  anonKey: string,
  opts: { timeoutMs?: number } = {},
) {
  const url = supabaseUrl.replace(/\/+$/, '') + '/auth/v1/user';
  const ms = opts.timeoutMs || TIMEOUT_MS;
  return function whoIs(token: string): Promise<string | null> {
    const signal = AbortSignal.timeout(ms);
    let off = () => {};
    const timedOut = new Promise<never>((_, reject) => {
      const on = () => reject(new Error('auth'));
      signal.addEventListener('abort', on, { once: true });
      off = () => signal.removeEventListener('abort', on);
    });
    const asked = ask(token, signal).catch(e => {
      throw signal.aborted ? new Error('auth') : e;
    });
    return Promise.race([asked, timedOut]).finally(off);
  };

  async function ask(token: string, signal: AbortSignal): Promise<string | null> {
    const res = await fetcher(url, {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + token, apikey: anonKey },
      signal,
    });
    if (res.status !== 200) {
      try {
        if (res.body) await res.body.cancel();
      } catch {
        /* nothing to release */
      }
      if (res.status >= 400 && res.status < 500 && res.status !== 429) return null;
      throw new Error('auth');
    }
    const user: unknown = await res.json();
    const id = user && typeof user === 'object' ? (user as { id?: unknown }).id : null;
    return typeof id === 'string' && UUID.test(id) ? id.toLowerCase() : null;
  }
}
