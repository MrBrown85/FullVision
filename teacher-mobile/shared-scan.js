// @ts-check
/* shared-scan.js — a scan shared from the phone's mail arrives (B7).

   On Android, the installed app is in the share sheet for a PDF
   (manifest.json share_target). The service worker (sw.js, "A scan shared
   from the phone's mail") keeps the PDF in its memory only, without its
   file name, and opens this app with ?scan=<id>. This file reads that,
   takes the PDF from the worker once, or tells the worker to let it go.
   Nothing here writes the scan anywhere: the screen that splits it
   (teacher-mobile/split-scan.js) holds it in memory until it closes.

   MSharedScan.arrived()  what the address says, read once at start-up,
                          before the app tidies the address: null, or
                          { id } for a scan waiting, or { said } when the
                          share kept nothing (none, many, not_pdf, too_big,
                          unreadable).
   MSharedScan.take(id)   Promise of a File named scan.pdf, or null when
                          the worker no longer has it. The worker lets it
                          go either way.
   MSharedScan.drop()     the worker lets any waiting scan go.
   MSharedScan.held()     Promise of true while a scan waits (for tests).
   MSharedScan.refuse()   not signed in: the worker lets the scan go, and
                          the words to show.
   MSharedScan.receive(arrived)  signed in, at start-up: Promise of what
                          Split a Scan opens with ({ file } or { said }),
                          or null with no share (any scan left waiting is
                          let go). Taken before the class loads, so it
                          waits in the worker as briefly as it can. */

/** @type {any} */ (window).MSharedScan = (function () {
  'use strict';

  var ADDRESS = '/teacher-mobile/shared-scan';
  var REFUSED = ['none', 'many', 'not_pdf', 'too_big', 'unreadable'];

  function arrived(search) {
    var q = typeof search === 'string' ? search : (window.location && window.location.search) || '';
    var m = /[?&]scan=([^&#]*)/.exec(q);
    if (!m) return null;
    var v = decodeURIComponent(m[1] || '');
    if (REFUSED.indexOf(v) >= 0) return { said: v };
    if (/^[0-9a-f]{24}$/.test(v)) return { id: v };
    return { said: 'unreadable' };
  }

  function _worker() {
    var sw = typeof navigator !== 'undefined' && navigator.serviceWorker;
    return (sw && sw.controller) || null;
  }

  function drop() {
    var w = _worker();
    if (!w) return;
    try {
      w.postMessage({ type: 'FV_SHARED_SCAN_DROP' });
    } catch (e) {
      /* no worker to tell: it holds nothing for this page */
    }
  }

  function take(id) {
    if (!id || typeof fetch !== 'function') return Promise.resolve(null);
    return fetch(ADDRESS + '?take=' + encodeURIComponent(id), { cache: 'no-store' })
      .then(function (res) {
        if (!res || !res.ok) return null;
        return res.blob().then(function (blob) {
          if (!blob || !blob.size) return null;
          // A plain name: the shared file's own name never reached this page.
          return new File([blob], 'scan.pdf', { type: 'application/pdf' });
        });
      })
      .then(null, function () {
        drop();
        return null;
      });
  }

  function held() {
    var w = _worker();
    if (!w || typeof MessageChannel === 'undefined') return Promise.resolve(false);
    var worker = w;
    return new Promise(function (resolve) {
      var ch = new MessageChannel();
      var done = false;
      ch.port1.onmessage = function (e) {
        done = true;
        resolve(!!(e.data && e.data.held));
      };
      worker.postMessage({ type: 'FV_SHARED_SCAN_HELD' }, [ch.port2]);
      setTimeout(function () {
        if (!done) resolve(false);
      }, 2000);
    });
  }

  // Student work is not kept for someone not signed in.
  function refuse() {
    drop();
    return 'Sign in, then share the scan again.';
  }

  function receive(shared) {
    if (!shared) {
      drop();
      return Promise.resolve(null);
    }
    if (!shared.id) return Promise.resolve({ said: shared.said || 'unreadable' });
    return take(shared.id).then(function (file) {
      return file ? { file: file } : { said: 'missing' };
    });
  }

  return { arrived: arrived, take: take, drop: drop, held: held, refuse: refuse, receive: receive };
})();
