/* report-issues.js — Issued reports: a fixed copy of every report at the
   moment it went home. Reprints use the copy, not later scores, and
   "changed since the last issue" compares each student's sheets with it.
   The sheets' HTML lives in IndexedDB (too big for localStorage); the
   index with each student's hash lives in localStorage so it is there
   before the database answers. Local on this device for now; the server
   row (report_issue) follows with its migration.
   docs/DECISIONS.md "Report forms" 9; docs/report-forms-plan.md Phase 2. */
window.ReportIssues = (function () {
  'use strict';

  var DB_NAME = 'fv-report-issues';
  var STORE = 'issues';
  var MAX_PER_CLASS = 12;

  function _indexKey(cid) {
    return 'gb-report-issues-' + cid;
  }

  /* djb2, hex. Enough to tell "this student's sheets changed". */
  function hash(str) {
    var h = 5381;
    str = String(str || '');
    for (var i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(16);
  }

  function _db() {
    return new Promise(function (resolve, reject) {
      if (typeof indexedDB === 'undefined') return reject(new Error('no indexedDB'));
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = function () {
        resolve(req.result);
      };
      req.onerror = function () {
        reject(req.error || new Error('indexedDB open failed'));
      };
    });
  }

  function _tx(mode, fn) {
    return _db().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, mode);
        var store = tx.objectStore(STORE);
        var out = fn(store);
        tx.oncomplete = function () {
          db.close();
          resolve(out && out.result !== undefined ? out.result : out);
        };
        tx.onerror = function () {
          db.close();
          reject(tx.error || new Error('indexedDB transaction failed'));
        };
      });
    });
  }

  function _readIndex(cid) {
    try {
      var raw = localStorage.getItem(_indexKey(cid));
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function _writeIndex(cid, list) {
    try {
      localStorage.setItem(_indexKey(cid), JSON.stringify(list));
    } catch (e) {
      /* the index is a convenience; the copy itself is in IndexedDB */
    }
  }

  /** Issues for a class, newest first; for one term when termId is given. */
  function list(cid, termId) {
    return _readIndex(cid).filter(function (e) {
      return !termId || e.termId === termId;
    });
  }

  function latest(cid, termId) {
    return list(cid, termId)[0] || null;
  }

  /** Students whose sheets differ from an issue: ids whose hash changed or
   *  who were not in it. `hashes` is { sid: hash } for the sheets now. */
  function changedSince(entry, hashes) {
    if (!entry || !entry.hashes) return Object.keys(hashes || {});
    return Object.keys(hashes || {}).filter(function (sid) {
      return entry.hashes[sid] !== hashes[sid];
    });
  }

  /** Saves a copy. `students` is [{ sid, name, sheets, html }]. Resolves to
   *  { entry, stored } where stored is false when IndexedDB refused and
   *  only the index (with the hashes) could be kept. */
  function issue(opts) {
    var now = new Date();
    var id = 'issue-' + now.getTime().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
    var hashes = {};
    opts.students.forEach(function (s) {
      hashes[s.sid] = hash(s.html);
    });
    var entry = {
      id: id,
      cid: opts.cid,
      termId: opts.termId,
      termLabel: opts.termLabel || '',
      paper: opts.paper || 'letter',
      issuedAt: now.toISOString(),
      count: opts.students.length,
      hashes: hashes,
    };
    var record = Object.assign({}, entry, {
      students: opts.students.map(function (s) {
        return { sid: s.sid, name: s.name, sheets: s.sheets, html: s.html };
      }),
    });
    var index = [entry].concat(_readIndex(opts.cid));
    var evicted = index.slice(MAX_PER_CLASS);
    index = index.slice(0, MAX_PER_CLASS);
    _writeIndex(opts.cid, index);
    return _tx('readwrite', function (store) {
      store.put(record);
      evicted.forEach(function (old) {
        store.delete(old.id);
      });
      return true;
    })
      .then(function () {
        return { entry: entry, stored: true };
      })
      .catch(function () {
        return { entry: entry, stored: false };
      });
  }

  /** The full copy, with each student's sheets, or null. */
  function load(id) {
    return _tx('readonly', function (store) {
      return store.get(id);
    }).catch(function () {
      return null;
    });
  }

  function remove(cid, id) {
    _writeIndex(
      cid,
      _readIndex(cid).filter(function (e) {
        return e.id !== id;
      }),
    );
    return _tx('readwrite', function (store) {
      store.delete(id);
      return true;
    }).catch(function () {
      return false;
    });
  }

  /** "Issued Oct 20, 2026, 3:40 p.m." */
  function label(entry) {
    if (!entry || !entry.issuedAt) return '';
    var d = new Date(entry.issuedAt);
    return (
      'Issued ' +
      d.toLocaleString('en-CA', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
    );
  }

  return {
    hash: hash,
    list: list,
    latest: latest,
    changedSince: changedSince,
    issue: issue,
    load: load,
    remove: remove,
    label: label,
  };
})();
