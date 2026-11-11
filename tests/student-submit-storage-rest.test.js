/**
 * The two adapters send-routes.ts is wired to in index.ts, with a stand-in
 * fetch: the student-photos bucket through the Storage service's HTTP API
 * (supabase/functions/_shared/storage-rest.ts) and Supabase Auth's "who is
 * this" (supabase/functions/_shared/teacher-auth.ts).
 *
 * What these prove is what the function sends. Whether the Storage service
 * then does what the contract says (a link without upsert cannot overwrite;
 * the bucket refuses a type or a size; a delete by name) cannot be run here:
 * those are the questions in the pull request for the reviewer.
 */
import { describe, expect, it } from 'vitest';
import { BUCKET, PATH, pathParts, storageRest } from '../supabase/functions/_shared/storage-rest.ts';
import { authUser, tokenShape } from '../supabase/functions/_shared/teacher-auth.ts';

const URL_ = 'https://proj.supabase.co/';
const KEY = 'service-key-for-tests';
const C = 'c1c1c1c1-0000-4000-8000-000000000001';
const A = 'a1a1a1a1-0000-4000-8000-000000000001';
const E = 'e1e1e1e1-0000-4000-8000-000000000001';
const S = '5b5b5b5b-0000-4000-8000-000000000001';
const F = 'f0f0f0f0-0000-4000-8000-000000000001';
const PAGE = `${C}/${A}/${E}/${S}/${F}.jpg`;
const THUMB = `${C}/${A}/${E}/${S}/${F}-thumb.jpg`;

function fakeFetch(answer) {
  const sent = [];
  const fetcher = async (url, init) => {
    sent.push({ url, method: init.method, headers: init.headers, body: init.body });
    return answer(url, init);
  };
  return { fetcher, sent };
}
const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('the bucket’s paths', () => {
  it('only the two shapes the database makes', () => {
    expect(pathParts(PAGE)).toEqual({ course: C, assessment: A, enrollment: E, submission: S, file: F, thumb: false });
    expect(pathParts(THUMB)).toMatchObject({ thumb: true });
    for (const bad of [
      `${C}/${A}/${E}/${S}/${F}.png`,
      `${C}/${A}/${E}/${F}.jpg`,
      `${C}/${A}/${E}/${S}/x/${F}.jpg`,
      `${C}/../${E}/${S}/${F}.jpg`,
      `/${PAGE}`,
      PAGE.toUpperCase(),
      PAGE + '?download',
      PAGE + '\n',
      `${C}/${A}/${E}/${S}/${F}-thumb-thumb.jpg`,
      null,
      42,
    ]) {
      expect(pathParts(bad), String(bad)).toBe(null);
    }
    expect(BUCKET).toBe('student-photos');
    expect(PATH.source.startsWith('^')).toBe(true);
  });
});

describe('storageRest', () => {
  it('signUpload: one path, the service key, and no x-upsert header', async () => {
    const f = fakeFetch(() => json(200, { url: `/object/upload/sign/student-photos/${PAGE}?token=abc` }));
    const link = await storageRest(f.fetcher, URL_, KEY).signUpload(PAGE);
    expect(link).toBe(`https://proj.supabase.co/storage/v1/object/upload/sign/student-photos/${PAGE}?token=abc`);
    expect(f.sent).toEqual([
      {
        url: `https://proj.supabase.co/storage/v1/object/upload/sign/student-photos/${PAGE}`,
        method: 'POST',
        headers: { Authorization: 'Bearer ' + KEY, apikey: KEY, 'Content-Type': 'application/json' },
        body: '{}',
      },
    ]);
    expect(Object.keys(f.sent[0].headers).map(h => h.toLowerCase())).not.toContain('x-upsert');
  });

  it('signDownloads: the paths named, the seconds given, a link for every one or none', async () => {
    const f = fakeFetch((url, init) => {
      const { paths } = JSON.parse(init.body);
      return json(
        200,
        paths.map(p => ({ path: p, signedURL: `/object/sign/student-photos/${p}?token=t`, error: null })),
      );
    });
    const links = await storageRest(f.fetcher, URL_, KEY).signDownloads([PAGE, THUMB], 300);
    expect(links).toEqual({
      [PAGE]: `https://proj.supabase.co/storage/v1/object/sign/student-photos/${PAGE}?token=t`,
      [THUMB]: `https://proj.supabase.co/storage/v1/object/sign/student-photos/${THUMB}?token=t`,
    });
    expect(f.sent[0].url).toBe('https://proj.supabase.co/storage/v1/object/sign/student-photos');
    expect(JSON.parse(f.sent[0].body)).toEqual({ expiresIn: 300, paths: [PAGE, THUMB] });

    // One path with no link, or a link elsewhere: no link at all.
    for (const answer of [
      [{ path: PAGE, signedURL: '/object/sign/x?token=t', error: null }],
      [
        { path: PAGE, signedURL: '/object/sign/x', error: null },
        { path: THUMB, signedURL: null, error: 'Either the object does not exist or you do not have access to it' },
      ],
      [
        { path: PAGE, signedURL: 'https://evil.example/x', error: null },
        { path: THUMB, signedURL: '/object/sign/y', error: null },
      ],
      { error: 'nope' },
    ]) {
      const g = fakeFetch(() => json(200, answer));
      await expect(storageRest(g.fetcher, URL_, KEY).signDownloads([PAGE, THUMB], 300)).rejects.toThrow('storage');
    }
    // Nothing to sign: nothing asked.
    const h = fakeFetch(() => json(200, []));
    expect(await storageRest(h.fetcher, URL_, KEY).signDownloads([], 300)).toEqual({});
    expect(h.sent).toEqual([]);
  });

  it('read: the bytes; a missing file; a large file stopped at the limit, never read whole', async () => {
    const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 1, 2, 3]);
    const f = fakeFetch(() => new Response(bytes, { status: 200 }));
    const store = storageRest(f.fetcher, URL_, KEY);
    expect(await store.read(PAGE, 10)).toEqual({ bytes });
    expect(f.sent[0]).toMatchObject({
      url: `https://proj.supabase.co/storage/v1/object/authenticated/student-photos/${PAGE}`,
      method: 'GET',
    });
    for (const status of [400, 404]) {
      const g = fakeFetch(() => json(status, { statusCode: '404', error: 'not_found' }));
      expect(await storageRest(g.fetcher, URL_, KEY).read(PAGE, 10)).toBe('missing');
    }
    // N2: a 400 whose body does not say 404 (a wrong key, a bad request) is an error, never 'missing'.
    for (const body of [{ statusCode: '403', error: 'Unauthorized' }, { statusCode: '400' }, {}, 'not json']) {
      const g = fakeFetch(() => (typeof body === 'string' ? new Response(body, { status: 400 }) : json(400, body)));
      await expect(storageRest(g.fetcher, URL_, KEY).read(PAGE, 10)).rejects.toThrow('storage read 400');
    }
    // Said too large.
    const told = fakeFetch(() => new Response('x', { status: 200, headers: { 'content-length': '11' } }));
    expect(await storageRest(told.fetcher, URL_, KEY).read(PAGE, 10)).toBe('too_large');
    // Streamed past the limit, in parts: stopped, and the rest not pulled.
    let pulled = 0;
    const stream = new ReadableStream({
      pull(c) {
        pulled++;
        c.enqueue(new Uint8Array(6));
        if (pulled > 50) c.close();
      },
    });
    const big = fakeFetch(() => new Response(stream, { status: 200 }));
    expect(await storageRest(big.fetcher, URL_, KEY).read(PAGE, 10)).toBe('too_large');
    expect(pulled).toBeLessThan(5);
  });

  it('a look (a read of 0 bytes) says only whether the file is there, and pulls at most one part of it', async () => {
    let pulled = 0;
    const stream = () =>
      new ReadableStream({
        pull(c) {
          pulled++;
          c.enqueue(new Uint8Array(64 * 1024));
          if (pulled > 50) c.close();
        },
      });
    const there = fakeFetch(() => new Response(stream(), { status: 200 }));
    expect(await storageRest(there.fetcher, URL_, KEY).read(PAGE, 0)).toBe('too_large');
    expect(pulled).toBeLessThan(3);
    const told = fakeFetch(() => new Response(stream(), { status: 200, headers: { 'content-length': '2000000' } }));
    pulled = 0;
    expect(await storageRest(told.fetcher, URL_, KEY).read(PAGE, 0)).toBe('too_large');
    expect(pulled).toBeLessThan(2);
    const gone = fakeFetch(() => json(404, { statusCode: '404', error: 'not_found' }));
    expect(await storageRest(gone.fetcher, URL_, KEY).read(PAGE, 0)).toBe('missing');
  });

  it('a Storage error names the step and the status, never the path or the key', async () => {
    const f = fakeFetch(() => json(500, { message: `failed for ${PAGE}` }));
    const store = storageRest(f.fetcher, URL_, KEY);
    for (const step of [
      () => store.read(PAGE, 10),
      () => store.signUpload(PAGE),
      () => store.remove([PAGE]),
      () => store.overwrite(PAGE, new Uint8Array(1)),
    ]) {
      const e = await step().catch(x => x);
      expect(e.name).toBe('StorageError');
      expect(e.message).not.toContain(E);
      expect(e.message).not.toContain(KEY);
    }
  });

  it('overwrite: PUT to the path, typed image/jpeg, private, no-store (Storage keeps the header as sent), replacing the file there', async () => {
    const f = fakeFetch(() => json(200, { Key: 'x' }));
    const bytes = Uint8Array.from([1, 2]);
    await storageRest(f.fetcher, URL_, KEY).overwrite(THUMB, bytes);
    expect(f.sent[0]).toEqual({
      url: `https://proj.supabase.co/storage/v1/object/student-photos/${THUMB}`,
      method: 'PUT',
      headers: {
        Authorization: 'Bearer ' + KEY,
        apikey: KEY,
        'Content-Type': 'image/jpeg',
        'x-upsert': 'true',
        'Cache-Control': 'private, no-store',
      },
      body: bytes,
    });
  });

  it('remove: DELETE by exact names; nothing to remove asks nothing', async () => {
    const f = fakeFetch(() => json(200, []));
    const store = storageRest(f.fetcher, URL_, KEY);
    await store.remove([PAGE, THUMB]);
    expect(f.sent[0]).toMatchObject({
      url: 'https://proj.supabase.co/storage/v1/object/student-photos',
      method: 'DELETE',
      body: JSON.stringify({ prefixes: [PAGE, THUMB] }),
    });
    await store.remove([]);
    expect(f.sent.length).toBe(1);
  });

  it('a path of any other shape never reaches the Storage service, from any of the five', async () => {
    const f = fakeFetch(() => json(200, {}));
    const store = storageRest(f.fetcher, URL_, KEY);
    const bad = `${C}/../../other-bucket/x.jpg`;
    for (const step of [
      () => store.signUpload(bad),
      () => store.signDownloads([PAGE, bad], 300),
      () => store.read(bad, 10),
      () => store.overwrite(bad, new Uint8Array(1)),
      () => store.remove([PAGE, bad]),
    ]) {
      await expect(step()).rejects.toThrow('storage path');
    }
    expect(f.sent).toEqual([]);
  });
});

describe('authUser and tokenShape', () => {
  const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.payload.signature';
  it('a 200 naming a user is that user; a refused token is nobody; an outage throws', async () => {
    const id = 'f1f1f1f1-0000-4000-8000-000000000001';
    const yes = fakeFetch(() => json(200, { id: id.toUpperCase(), email: 'a@b.c' }));
    expect(await authUser(yes.fetcher, URL_, 'anon')(TOKEN)).toBe(id);
    expect(yes.sent[0]).toEqual({
      url: 'https://proj.supabase.co/auth/v1/user',
      method: 'GET',
      headers: { Authorization: 'Bearer ' + TOKEN, apikey: 'anon' },
      body: undefined,
    });
    for (const status of [401, 403, 404]) {
      expect(await authUser(fakeFetch(() => json(status, {})).fetcher, URL_, 'anon')(TOKEN)).toBe(null);
    }
    expect(await authUser(fakeFetch(() => json(200, { id: 'nobody' })).fetcher, URL_, 'anon')(TOKEN)).toBe(null);
    for (const status of [429, 500, 503]) {
      await expect(authUser(fakeFetch(() => json(status, {})).fetcher, URL_, 'anon')(TOKEN)).rejects.toThrow('auth');
    }
  });

  it('only a token’s shape passes tokenShape', () => {
    expect(tokenShape(TOKEN)).toBe(TOKEN);
    for (const bad of [
      null,
      '',
      'short',
      'has space in it at all',
      'x'.repeat(4097),
      ['x'.repeat(30)],
      'a\nb'.repeat(10),
    ]) {
      expect(tokenShape(bad)).toBe(null);
    }
  });
});

describe('every call to Storage or Auth has a deadline (review L4)', () => {
  // A Storage or Auth that never answers: the call ends only when its signal does.
  const hanging = () => {
    const seen = [];
    const fetcher = (url, init) =>
      new Promise((_, reject) => {
        seen.push(init && init.signal);
        if (!init || !init.signal) return;
        init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
      });
    return { fetcher, seen };
  };

  it('each of the five Storage calls gives up at its deadline, with a Storage error that names no path or key', async () => {
    const h = hanging();
    const store = storageRest(h.fetcher, URL_, KEY, { timeoutMs: 20 });
    for (const call of [
      () => store.signUpload(PAGE),
      () => store.signDownloads([PAGE], 300),
      () => store.read(PAGE, 10),
      () => store.overwrite(PAGE, new Uint8Array(1)),
      () => store.remove([PAGE]),
    ]) {
      const e = await call().then(
        () => null,
        x => x,
      );
      expect(e).toBeInstanceOf(Error);
      expect(e.name).toBe('StorageError');
      expect(e.message).not.toContain(PAGE);
      expect(e.message).not.toContain(KEY);
    }
    expect(h.seen.length).toBe(5);
    expect(h.seen.every(sig => sig instanceof AbortSignal)).toBe(true);
  });

  it('a read whose answer stops part way gives up at its deadline, and is never taken for the whole file', async () => {
    const stalled = new ReadableStream({
      start(c) {
        c.enqueue(Uint8Array.from([0xff, 0xd8, 0xff]));
      },
      pull() {
        return new Promise(() => {});
      },
    });
    const store = storageRest(async () => new Response(stalled, { status: 200 }), URL_, KEY, { timeoutMs: 20 });
    await expect(store.read(PAGE, 2_000_000)).rejects.toThrow('storage');
  });

  it('the deadline is 10 seconds unless one is given', async () => {
    const sigs = [];
    const fetcher = async (url, init) => (sigs.push(init.signal), json(200, { url: '/object/upload/sign/x?token=t' }));
    await storageRest(fetcher, URL_, KEY).signUpload(PAGE);
    await authUser(async (url, init) => (sigs.push(init.signal), json(200, { id: 'x' })), URL_, 'anon')('t'.repeat(30));
    expect(sigs.length).toBe(2);
    expect(sigs.every(sig => sig instanceof AbortSignal && !sig.aborted)).toBe(true);
    const src = (await import('node:fs')).readFileSync('supabase/functions/_shared/storage-rest.ts', 'utf8');
    expect(src).toMatch(/TIMEOUT_MS = 10_000/);
    const auth = (await import('node:fs')).readFileSync('supabase/functions/_shared/teacher-auth.ts', 'utf8');
    expect(auth).toMatch(/TIMEOUT_MS = 10_000/);
  });

  it('Auth that does not answer in time is an outage, thrown, never "nobody" and never "signed in"', async () => {
    const h = hanging();
    await expect(authUser(h.fetcher, URL_, 'anon', { timeoutMs: 20 })('t'.repeat(30))).rejects.toThrow('auth');
    // A fetch that never lets go, signal or not, and an answer whose body never ends: the same.
    const deaf = () => new Promise(() => {});
    await expect(authUser(deaf, URL_, 'anon', { timeoutMs: 20 })('t'.repeat(30))).rejects.toThrow('auth');
    const endless = async () =>
      new Response(new ReadableStream({ pull: () => new Promise(() => {}) }), { status: 200 });
    await expect(authUser(endless, URL_, 'anon', { timeoutMs: 20 })('t'.repeat(30))).rejects.toThrow('auth');
  });

  it('a Storage that ignores the signal, or whose answer never ends, still gives up at the deadline', async () => {
    const deaf = () => new Promise(() => {});
    const endless = async () =>
      new Response(new ReadableStream({ pull: () => new Promise(() => {}) }), { status: 200 });
    for (const fetcher of [deaf, endless]) {
      const store = storageRest(fetcher, URL_, KEY, { timeoutMs: 20 });
      for (const call of [
        () => store.signUpload(PAGE),
        () => store.signDownloads([PAGE], 300),
        () => store.read(PAGE, 10),
        () => store.overwrite(PAGE, new Uint8Array(1)),
        () => store.remove([PAGE]),
      ]) {
        await expect(call()).rejects.toThrow(/^storage [a-z-]+-timeout 0$/);
      }
    }
  });
});
