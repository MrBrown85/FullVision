/**
 * Recording fake of the Supabase client's rpc() for write-path tests.
 *
 * - Every call is recorded in `calls`; calls the "server" accepted are also
 *   recorded in `committed`.
 * - create_* / duplicate_* return a fresh UUID; create_student_and_enroll
 *   returns { student_id, enrollment_id }; upsert_* return p_id when given,
 *   otherwise a fresh UUID; save_categories returns each row's id, a fresh
 *   UUID for new rows — the same shapes the real RPCs return.
 * - failNext(name, n) makes the next n calls to `name` fail with a network
 *   error.
 * - hold() parks every call until release(), so a test can start a save,
 *   change something while it is in flight, then let it finish.
 * - on(name, handler) answers that RPC with handler(params, n) instead (n is
 *   the 1-based call count); it may return a promise. Handled calls ignore
 *   hold().
 */

export function settle(rounds = 25) {
  var p = Promise.resolve();
  for (var i = 0; i < rounds; i++) {
    p = p.then(function () {
      return new Promise(function (r) {
        setImmediate(r);
      });
    });
  }
  return p;
}

export function makeFakeSupabase() {
  var seq = 0;
  var failures = {};
  var held = null;
  var handlers = {};
  var handledCount = {};

  function newId() {
    seq += 1;
    return 'aaaaaaaa-0000-4000-8000-' + String(seq).padStart(12, '0');
  }

  function respond(name, params) {
    if (failures[name] > 0) {
      failures[name] -= 1;
      return { data: null, error: { message: 'network: failed to fetch' } };
    }
    fake.committed.push({ name: name, params: params });
    if (name === 'create_student_and_enroll') {
      return { data: { student_id: newId(), enrollment_id: newId() }, error: null };
    }
    if (/^(create|duplicate)_/.test(name)) return { data: newId(), error: null };
    if (/^upsert_/.test(name)) return { data: (params && params.p_id) || newId(), error: null };
    if (name === 'save_categories') {
      return {
        data: (params.p_categories || []).map(function (c) {
          return c.id || newId();
        }),
        error: null,
      };
    }
    return { data: null, error: null };
  }

  var fake = {
    calls: [],
    committed: [],
    rpc: function (name, params) {
      params = params || {};
      fake.calls.push({ name: name, params: params });
      if (handlers[name]) {
        handledCount[name] = (handledCount[name] || 0) + 1;
        return Promise.resolve(handlers[name](params, handledCount[name]));
      }
      if (held) {
        return new Promise(function (resolve) {
          held.push(function () {
            resolve(respond(name, params));
          });
        });
      }
      return Promise.resolve(respond(name, params));
    },
    on: function (name, handler) {
      handlers[name] = handler;
    },
    failNext: function (name, times) {
      failures[name] = (failures[name] || 0) + (times || 1);
    },
    hold: function () {
      held = [];
    },
    release: async function () {
      while (held && held.length) {
        held.splice(0).forEach(function (go) {
          go();
        });
        await settle();
      }
      held = null;
      await settle();
    },
    count: function (name, where) {
      return fake.calls.filter(function (c) {
        return c.name === name && (!where || where(c.params));
      }).length;
    },
    committedCount: function (name, where) {
      return fake.committed.filter(function (c) {
        return c.name === name && (!where || where(c.params));
      }).length;
    },
  };
  return fake;
}
