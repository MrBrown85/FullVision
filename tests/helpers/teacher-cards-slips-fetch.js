/**
 * A stand-in for teacher-cards' slips route (plan S3-S1), for the browser
 * tests of shared/data.js: it records each request's body and answers each
 * named student (or `roster` when none are named) with a slip made, a code,
 * and a password where `passwords` has one.
 */
export function slipsFetch({ roster = [], passwords = {}, replayFirst = false } = {}) {
  const bodies = [];
  const was = { fetch: globalThis.fetch, env: window.__ENV };
  window.__ENV = Object.assign({}, window.__ENV, { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_KEY: 'anon' });
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    bodies.push({ url: String(url), body, auth: init.headers.Authorization });
    const ids = body.enrollment_ids || roster;
    const replayed = replayFirst && bodies.length === 1;
    const results = ids.map((id, i) => {
      const r = { enrollment_id: id, result: 'made', slip_id: id };
      if (!replayed) {
        r.code = 'K7M-4Q' + 'XYZ'[i % 3];
        if (passwords[id]) r.password = passwords[id];
      }
      return r;
    });
    return new Response(JSON.stringify({ replayed, results }), { status: 200 });
  };
  return {
    bodies,
    restore() {
      globalThis.fetch = was.fetch;
      window.__ENV = was.env;
    },
  };
}
/** A Supabase client whose sign-in hands out a token. */
export const signedIn = extra =>
  Object.assign({ auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) } }, extra);
