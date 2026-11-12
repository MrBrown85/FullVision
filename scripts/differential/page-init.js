/**
 * Runs in every page of a differential run before any of the app's scripts
 * (an init script), so build A and build B make the same ids and keys.
 *
 * - The clock is Playwright's fake clock (session.mjs installs it, paused):
 *   Date, timers, requestAnimationFrame and performance.now move only when
 *   the run moves them, by the same amounts in A and B. This script keeps
 *   the real setTimeout as window.__diffRealSetTimeout, for the run's own
 *   waiting (probe.mjs settle).
 * - Math.random, crypto.getRandomValues and crypto.randomUUID come from one
 *   seeded generator. Each page load takes the next seed from a counter kept
 *   in localStorage, so a reload or a second tab never repeats the ids the
 *   first page made, and A and B count their loads the same way.
 * - window.__diffFirstLoad is true on the first page load of the run only.
 *   The run's seeding script checks it, so a reload keeps what the device
 *   saved instead of writing the class again.
 *
 * Every key it keeps starts with `__diff-`; the comparison leaves those out.
 */
// eslint-disable-next-line no-unused-vars
function differentialPageInit(opts) {
  var LOADS_KEY = '__diff-loads';
  var SEEDED_KEY = '__diff-seeded';
  var ls = window.localStorage;

  window.__diffRealSetTimeout = window.setTimeout.bind(window);

  // ── Loads still on their way ──
  // Scripts and stylesheets the app adds, and its fetches, counted until
  // they land: the run waits for none to be on the way before it moves the
  // clock (probe.mjs settle), so a slow load cannot change the order things
  // happen in.
  window.__diffPending = 0;
  function track(el) {
    var tag = el && el.tagName;
    if (!(tag === 'SCRIPT' && el.src) && !(tag === 'LINK' && el.rel === 'stylesheet')) return;
    if (el.__diffTracked) return;
    el.__diffTracked = true;
    window.__diffPending++;
    var done = function () {
      el.removeEventListener('load', done);
      el.removeEventListener('error', done);
      window.__diffPending--;
    };
    el.addEventListener('load', done);
    el.addEventListener('error', done);
  }
  new MutationObserver(function (list) {
    list.forEach(function (m) {
      m.addedNodes.forEach(function (n) {
        // Those in the page as it loads are the browser's to wait for.
        if (document.readyState !== 'loading') track(n);
      });
    });
  }).observe(document, { childList: true, subtree: true });
  var realFetch = window.fetch;
  if (realFetch) {
    window.fetch = function () {
      window.__diffPending++;
      return realFetch.apply(this, arguments).finally(function () {
        window.__diffPending--;
      });
    };
  }

  // ── Messages between tabs ──
  // The app's BroadcastChannels carry its messages between tabs, and the
  // order two tabs' messages arrive in is up to the browser. Here each
  // message waits in the receiving tab until the run delivers it
  // (window.__diffDeliver, from session.mjs barrier), all at once and in a
  // fixed order: by sending tab, then as sent. Before it delivers, the run
  // sends a barrier from every tab and waits until every other tab has had
  // it, so every message sent before it is in. Delivery is what a browser
  // would do (each channel of that name but the sender's, a 'message' event
  // with a copy of the data), only at a time the run picks.
  window.__diffTab = 'load' + (Number(ls.getItem('__diff-loads')) || 0);
  window.__diffSeen = {};
  var RealBC = window.BroadcastChannel;
  if (RealBC) {
    var inbox = [];
    var instances = [];
    var transports = {};
    var sent = 0;
    var transport = function (name) {
      if (!transports[name]) {
        var t = new RealBC(name);
        t.onmessage = function (e) {
          var d = e.data;
          if (!d || !d.__diff) return;
          if (d.kind === 'barrier') window.__diffSeen[name + ' ' + d.from] = d.n;
          else inbox.push(d);
        };
        transports[name] = t;
      }
      return transports[name];
    };
    var DiffBC = function BroadcastChannel(name) {
      this.name = String(name);
      this.onmessage = null;
      this.onmessageerror = null;
      this._listeners = [];
      this._closed = false;
      this._id = window.__diffTab + '#' + instances.length;
      instances.push(this);
      transport(this.name);
    };
    DiffBC.prototype.postMessage = function (data) {
      if (this._closed) throw new DOMException('BroadcastChannel is closed', 'InvalidStateError');
      var env = {
        __diff: true,
        kind: 'msg',
        from: window.__diffTab,
        src: this._id,
        seq: ++sent,
        name: this.name,
        data: structuredClone(data),
      };
      transport(this.name).postMessage(env);
      inbox.push(env); // for this tab's other channels of the same name
    };
    DiffBC.prototype.addEventListener = function (type, fn) {
      if (type === 'message' && typeof fn === 'function') this._listeners.push(fn);
    };
    DiffBC.prototype.removeEventListener = function (type, fn) {
      this._listeners = this._listeners.filter(function (x) {
        return x !== fn;
      });
    };
    DiffBC.prototype.close = function () {
      this._closed = true;
    };
    window.BroadcastChannel = DiffBC;
    window.__diffDeliver = function () {
      var batch = inbox.splice(0, inbox.length).sort(function (a, b) {
        return a.from < b.from ? -1 : a.from > b.from ? 1 : a.seq - b.seq;
      });
      batch.forEach(function (env) {
        instances.forEach(function (ch) {
          if (ch._closed || ch.name !== env.name || ch._id === env.src) return;
          var ev = new MessageEvent('message', { data: structuredClone(env.data) });
          var fns = (typeof ch.onmessage === 'function' ? [ch.onmessage] : []).concat(ch._listeners);
          fns.forEach(function (fn) {
            try {
              fn.call(ch, ev);
            } catch (err) {
              window.__diffRealSetTimeout(function () {
                throw err;
              });
            }
          });
        });
      });
      return batch.length;
    };
    window.__diffBarrierSend = function (n) {
      Object.keys(transports).forEach(function (name) {
        transports[name].postMessage({ __diff: true, kind: 'barrier', from: window.__diffTab, n: n });
      });
      return { tab: window.__diffTab, names: Object.keys(transports) };
    };
  } else {
    window.__diffDeliver = function () {
      return 0;
    };
    window.__diffBarrierSend = function () {
      return { tab: window.__diffTab, names: [] };
    };
  }

  var first = !ls.getItem(SEEDED_KEY);
  window.__diffFirstLoad = first;
  if (first) ls.setItem(SEEDED_KEY, '1');

  // ── Random ──
  var loads = Number(ls.getItem(LOADS_KEY)) || 0;
  ls.setItem(LOADS_KEY, String(loads + 1));
  var state = (opts.seed * 7919 + loads * 104729 + 1) >>> 0;
  function next() {
    // mulberry32
    state = (state + 0x6d2b79f5) >>> 0;
    var t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  Math.random = next;
  var c = window.crypto;
  if (c) {
    c.getRandomValues = function (arr) {
      var bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
      for (var i = 0; i < bytes.length; i++) bytes[i] = Math.floor(next() * 256);
      return arr;
    };
    c.randomUUID = function () {
      var b = new Uint8Array(16);
      c.getRandomValues(b);
      b[6] = (b[6] & 0x0f) | 0x40;
      b[8] = (b[8] & 0x3f) | 0x80;
      var h = Array.prototype.map
        .call(b, function (x) {
          return (x + 0x100).toString(16).slice(1);
        })
        .join('');
      return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
    };
  }
}
