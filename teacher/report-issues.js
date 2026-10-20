/* report-issues.js — Issued reports: a fixed copy of every report at the
   moment it went home. Reprints use the copy, not later scores, and
   "changed since the last issue" compares each student's sheets with it.
   The record is the server row (report_issue and report_issue_student,
   migrations/20261020_report_issue.sql, through v2.createReportIssue and
   friends). This device keeps a copy too: the sheets' HTML in IndexedDB
   (too big for localStorage) and an index with each student's hash in
   localStorage, so the list is there before the server answers, Demo Mode
   works, and an issue made offline is kept until it can be sent. Each index
   entry carries serverId once the server has the issue.
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

  function _v2(name) {
    return typeof window !== 'undefined' && window.v2 && typeof window.v2[name] === 'function' ? window.v2[name] : null;
  }
  function _isUuid(id) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id || ''));
  }
  /* 'term-2' ↔ 2. Report periods are "Report N" on the page, so the id is
     always term-N; anything else counts as the first term. */
  function _termNumber(termId) {
    var m = /^term-(\d+)$/.exec(String(termId || ''));
    var n = m ? Number(m[1]) : 1;
    return n >= 1 && n <= 6 ? n : 1;
  }
  function _termId(n) {
    return 'term-' + n;
  }
  /* A server row (from list_report_issues) as an index entry. */
  function _entryFromRow(row) {
    return {
      id: row.id,
      serverId: row.id,
      cid: row.course_id,
      termId: _termId(row.term),
      termLabel: row.term_label || '',
      paper: row.paper || 'letter',
      issuedAt: row.issued_at,
      count: row.student_count || 0,
      hashes: row.hashes || {},
    };
  }
  function _byNewest(a, b) {
    return String(b.issuedAt || '').localeCompare(String(a.issuedAt || ''));
  }

  /** Refresh the index from the server. Resolves true when it changed.
   *  With no server (Demo Mode, signed out, offline) the index stays.
   *  An issue the server has (serverId) but no longer lists was deleted
   *  elsewhere, so its copy goes here too; one made here that the server
   *  never got (no serverId) is kept. */
  function sync(cid) {
    var list = _v2('listReportIssues');
    if (!list || !_isUuid(cid)) return Promise.resolve(false);
    return list(cid).then(
      function (res) {
        if (!res || !Array.isArray(res.data)) return false;
        var local = _readIndex(cid);
        var before = JSON.stringify(local);
        var serverIds = {};
        var merged = res.data.map(function (row) {
          serverIds[row.id] = true;
          var mine = local.find(function (e) {
            return e.serverId === row.id;
          });
          return mine ? Object.assign({}, _entryFromRow(row), { id: mine.id }) : _entryFromRow(row);
        });
        var gone = [];
        local.forEach(function (e) {
          if (!e.serverId) merged.push(e);
          else if (!serverIds[e.serverId]) gone.push(e.id);
        });
        merged.sort(_byNewest);
        _writeIndex(cid, merged);
        if (gone.length) {
          _tx('readwrite', function (store) {
            gone.forEach(function (id) {
              store.delete(id);
            });
            return true;
          }).catch(function () {
            /* no local copy to drop */
          });
        }
        return JSON.stringify(merged) !== before;
      },
      function () {
        return false;
      },
    );
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

  /** Saves a copy. `students` is [{ sid, name, sheets, html }]; `form` is
   *  the form they were laid out with. Resolves to { entry, stored, server }:
   *  stored is false when IndexedDB refused and only the index (with the
   *  hashes) could be kept here; server is true once the server has the
   *  issue (entry.serverId is set), false with no server or when it could
   *  not be reached. The device copy is written first either way. */
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
    // Only the newest copies stay in IndexedDB. An entry the server has
    // stays in the index (load() fetches it); one it does not is gone.
    var evicted = index.slice(MAX_PER_CLASS);
    index = index.slice(0, MAX_PER_CLASS).concat(
      evicted.filter(function (e) {
        return !!e.serverId;
      }),
    );
    _writeIndex(opts.cid, index);
    var local = _tx('readwrite', function (store) {
      store.put(record);
      evicted.forEach(function (old) {
        store.delete(old.id);
      });
      return true;
    })
      .then(function () {
        return true;
      })
      .catch(function () {
        return false;
      });
    var create = _v2('createReportIssue');
    var remote =
      create && _isUuid(opts.cid)
        ? create({
            courseId: opts.cid,
            term: _termNumber(opts.termId),
            termLabel: opts.termLabel || null,
            paper: opts.paper || 'letter',
            form: opts.form || null,
            students: opts.students.map(function (s) {
              return { enrollmentId: s.sid, sheets: s.sheets, hash: hashes[s.sid], html: s.html };
            }),
          }).then(
            function (res) {
              var row = res && res.data && res.data.id ? res.data : null;
              if (!row) return false;
              entry.serverId = row.id;
              if (row.issued_at) entry.issuedAt = row.issued_at;
              _writeIndex(
                opts.cid,
                _readIndex(opts.cid).map(function (e) {
                  return e.id === id ? Object.assign({}, e, { serverId: row.id, issuedAt: entry.issuedAt }) : e;
                }),
              );
              return true;
            },
            function () {
              return false;
            },
          )
        : Promise.resolve(false);
    return Promise.all([local, remote]).then(function (r) {
      return { entry: entry, stored: r[0], server: r[1] };
    });
  }

  /** The full copy, with each student's sheets, or null. The device copy
   *  answers first; an issue the server has (its index entry names the
   *  serverId, found through cid) is fetched when it is not here, and kept
   *  here for next time. A row from the server has no student names. */
  function load(id, cid) {
    return _tx('readonly', function (store) {
      return store.get(id);
    })
      .catch(function () {
        return null;
      })
      .then(function (rec) {
        if (rec) return rec;
        var entry = cid
          ? _readIndex(cid).find(function (e) {
              return e.id === id || e.serverId === id;
            })
          : null;
        var get = _v2('getReportIssue');
        if (!entry || !entry.serverId || !get) return null;
        return get(entry.serverId).then(
          function (res) {
            var row = res && res.data && res.data.id ? res.data : null;
            if (!row) return null;
            var full = Object.assign({}, entry, {
              students: (row.students || []).map(function (s) {
                return { sid: s.enrollment_id, name: '', sheets: s.sheets, html: s.html };
              }),
            });
            _tx('readwrite', function (store) {
              store.put(full);
              return true;
            }).catch(function () {
              /* shown from memory this time */
            });
            return full;
          },
          function () {
            return null;
          },
        );
      });
  }

  function remove(cid, id) {
    var entry = _readIndex(cid).find(function (e) {
      return e.id === id;
    });
    _writeIndex(
      cid,
      _readIndex(cid).filter(function (e) {
        return e.id !== id;
      }),
    );
    var del = _v2('deleteReportIssue');
    if (entry && entry.serverId && del) del(entry.serverId);
    return _tx('readwrite', function (store) {
      store.delete(id);
      return true;
    }).catch(function () {
      return false;
    });
  }

  /** "Printed Oct 20, 3:40 p.m."; the year is added when it is not this year. */
  function label(entry, now) {
    if (!entry || !entry.issuedAt) return '';
    var d = new Date(entry.issuedAt);
    var ref = now ? new Date(now) : new Date();
    var opts = { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
    if (d.getFullYear() !== ref.getFullYear()) opts.year = 'numeric';
    return 'Printed ' + d.toLocaleString('en-CA', opts);
  }

  return {
    hash: hash,
    sync: sync,
    list: list,
    latest: latest,
    changedSince: changedSince,
    issue: issue,
    load: load,
    remove: remove,
    label: label,
  };
})();
