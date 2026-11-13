// @ts-check
/* shared/overwrite-count.js — how often a score that waited meets a newer one
 *
 * The server keeps no version for a score: the last write to arrive wins. A
 * score that waited in this device's outbox (offline, or the laptop asleep)
 * can land over a newer one scored on another device meanwhile. Nobody has
 * measured whether that happens (docs/DECISIONS.md, "Older scores landing
 * over newer ones: measured before anything is built"). This file counts it
 * and changes nothing else.
 *
 * When: the outbox's own flush:start event, in the tab that sends (the
 * owner). The listener only notes the time and sets a timer; the count runs
 * in its own task after the drain has started its sends, and nothing in the
 * outbox waits for it. Neither shared/data.js nor shared/offline-queue.js
 * calls this file.
 *
 * Which writes: every score write still waiting (v2Queue.queued, copies,
 * read and never written) that was queued at least a minute before the
 * drain started. One is measured when this tab holds the baseline row it
 * was made against (shared/data.js _baselineUndo, read and never changed),
 * for every write waiting on the same field:
 *   upsert_tag_score      a competency's level, +/−, and comment
 *   upsert_rubric_score   a criterion's level, +/−, Work On and Went Beyond
 *   upsert_score          the score of points, Complete/Incomplete or
 *                         unlinked proficiency work (value, +/−)
 *   save_score_comment    the Overall Comment
 *   set_score_status      Missing, Excused or Late
 * Not measured, because what this device last knew can't be told, and
 * counted as such: clear_score (a whole cell, which the baseline keeps in
 * another shape), set_rubric_check and save_score_report_note, a write
 * queued before this page loaded (the baseline is in memory only, so a
 * browser closed or reloaded while offline leaves every waiting score here)
 * or by another tab, upsert_score on work scored by competency or rubric (the
 * cache keeps no copy of score.value there), a field with a rejected write in
 * the failed list, and cells past the read's cap. No read is made for them.
 *
 * Counted: a cell whose server value differs from what this device last knew
 * and from every value this device has waiting for it. A proficiency 0 is no
 * score, as in restoreScoreCells. The read races the drain on purpose: a
 * waiting write that lands before the read returns shows the server holding
 * this device's own value, and the cell does not count. So the count can come
 * out low, never high.
 *
 * Sent: one Sentry warning, "Overwrite count: <n> of <m> waiting cells changed
 * on the server, <k> not measured (waited <bucket>)", the bucket from the
 * oldest waiting score write, measured or not. k counts the cells with no
 * measured write, so "could not look" is told apart from "never happens".
 * At most once per bucket per page load; also when n is 0, and when only k
 * has anything (with no read). Nothing else: no ids, names, class, scores
 * or comments.
 * Demo Mode has no server and never reports. Nothing shows on screen.
 */
(function () {
  'use strict';

  var MIN_WAIT_MS = 60 * 1000; // a normal online tap goes in about two seconds
  var MAX_CELLS = 200; // cells in one read
  var MAX_IDS = 80; // student and work ids in one read, so its address stays short
  var ROW_LIMIT = 1000; // a read this long may have been cut short: no report
  var KEEP = {}; // a note sent as null keeps the server's

  // The score writes that can be measured, and every score write (the rest
  // are counted as not measured).
  var ENDPOINTS = ['upsert_tag_score', 'upsert_rubric_score', 'upsert_score', 'save_score_comment', 'set_score_status'];
  var SCORE_ENDPOINTS = ENDPOINTS.concat(['clear_score', 'set_rubric_check', 'save_score_report_note']);

  /** @type {Record<string, true>} buckets reported or being read this page load */
  var _buckets = {};
  /** @type {Record<string, true>} outbox entry ids already in a report */
  var _measured = {};
  /** @type {(() => void) | null} */
  var _unsubscribe = null;

  /**
   * @param {unknown} v
   * @returns {Record<string, unknown> | null}
   */
  function _obj(v) {
    return v && typeof v === 'object' && !Array.isArray(v) ? /** @type {Record<string, unknown>} */ (v) : null;
  }

  /**
   * @param {unknown} v
   * @returns {boolean}
   */
  function _id(v) {
    return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
  }

  /**
   * @param {unknown} v
   * @returns {string}
   */
  function _text(v) {
    return v == null ? '' : String(v);
  }

  /**
   * A level and its +/− as the app compares them: 0 is no level.
   * @param {unknown} value
   * @param {unknown} mod
   * @returns {string}
   */
  function _level(value, mod) {
    var lv = Number(value) || 0;
    return lv + ':' + (lv ? normalizeScoreMod(lv, mod) : 0);
  }

  /**
   * @param {number} ms
   * @returns {string}
   */
  function _bucket(ms) {
    if (ms < 10 * 60 * 1000) return '1-10 min';
    if (ms < 60 * 60 * 1000) return '10-60 min';
    if (ms < 24 * 60 * 60 * 1000) return '1-24 h';
    return 'over 24 h';
  }

  /**
   * The cache's copy of a piece of work, read only.
   * @param {unknown} cid
   * @param {unknown} aid
   * @returns {Record<string, unknown> | null}
   */
  function _work(cid, aid) {
    var cache = _obj(typeof _cache !== 'undefined' ? /** @type {unknown} */ (_cache) : null);
    var byCid = cache && _obj(cache.assessments);
    var list = byCid && typeof cid === 'string' ? byCid[cid] : null;
    if (!Array.isArray(list)) return null;
    for (var i = 0; i < list.length; i++) {
      var a = _obj(list[i]);
      if (a && a.id === aid) return a;
    }
    return null;
  }

  /**
   * One field set a write sets, as compared: what this device last knew
   * (prev), what it is sending (send, KEEP fields match anything), and how to
   * read the server's value from the rows of `table`.
   * @typedef {{ cell: string, key: string, table: string, prev: unknown[], send: unknown[],
   *   ids?: string[], pick: (row: Record<string, unknown>) => boolean, read: (row: Record<string, unknown> | null) => unknown[] }} Target
   */

  /**
   * What a score write sets, from its payload alone: one key per field set.
   * @param {string} endpoint
   * @param {Record<string, unknown>} p the payload
   * @returns {string | null}
   */
  function _keyOf(endpoint, p) {
    if (!_id(p.p_enrollment_id) || !_id(p.p_assessment_id)) return null;
    var cell = p.p_enrollment_id + ':' + p.p_assessment_id;
    if (endpoint === 'set_score_status') return 'status:' + cell;
    if (endpoint === 'upsert_score') return 'score:' + cell;
    if (endpoint === 'save_score_comment') return 'comment:' + cell;
    if (endpoint === 'upsert_tag_score') return _id(p.p_tag_id) ? 'tag:' + cell + ':' + p.p_tag_id : null;
    if (endpoint === 'upsert_rubric_score') {
      return _id(p.p_criterion_id) ? 'criterion:' + cell + ':' + p.p_criterion_id : null;
    }
    return null;
  }

  /**
   * @param {string} endpoint
   * @param {Record<string, unknown>} p the payload
   * @param {unknown} undoValue the baseline row the write was made against
   * @returns {Target | null}
   */
  function _target(endpoint, p, undoValue) {
    var sid = p.p_enrollment_id;
    var aid = p.p_assessment_id;
    var targetKey = _keyOf(endpoint, p);
    if (!targetKey) return null;
    var undo = _obj(undoValue);
    if (!undo || !('prev' in undo)) return null;
    var cell = sid + ':' + aid;
    /** @param {Record<string, unknown>} r */
    var sameCell = function (r) {
      return r.enrollment_id === sid && r.assessment_id === aid;
    };
    if (endpoint === 'set_score_status') {
      if (undo.field !== 'statuses') return null;
      return {
        cell: cell,
        key: targetKey,
        table: 'score',
        prev: [_text(undo.prev)],
        send: [_text(p.p_status)],
        pick: sameCell,
        read: function (r) {
          return [_text(r && r.status)];
        },
      };
    }
    if (undo.field !== 'scores' || !Array.isArray(undo.prev)) return null;
    /** @type {Record<string, unknown>[]} */
    var entries = [];
    undo.prev.forEach(function (e) {
      var o = _obj(e);
      if (o && o.assessmentId === aid) entries.push(o);
    });
    var work = _work(undo.cid, aid);
    var points = !!work && isPointsScored(work);

    if (endpoint === 'upsert_tag_score' || endpoint === 'upsert_rubric_score') {
      var rubric = endpoint === 'upsert_rubric_score';
      var key = rubric ? p.p_criterion_id : p.p_tag_id;
      if (points) return null;
      var col = rubric ? 'criterion_id' : 'tag_id';
      var entry = entries.find(function (e) {
        return e.tagId === key;
      });
      return {
        cell: cell,
        key: targetKey,
        table: rubric ? 'rubric_score' : 'tag_score',
        prev: [
          _level(entry && entry.score, entry && entry.mod),
          _text(entry && entry.critNote),
          rubric ? _text(entry && entry.critBeyond) : '',
        ],
        send: [
          _level(p.p_value, p.p_modifier),
          p.p_comment == null ? KEEP : _text(p.p_comment),
          !rubric || p.p_beyond == null ? KEEP : _text(p.p_beyond),
        ],
        pick: function (r) {
          return sameCell(r) && r[col] === key;
        },
        read: function (r) {
          return [_level(r && r.value, r && r.modifier), _text(r && r.comment), rubric ? _text(r && r.beyond) : ''];
        },
      };
    }

    if (endpoint === 'upsert_score') {
      // Only where the cache holds score.value: points work keeps it on every
      // entry of the cell, unlinked proficiency work on its one entry.
      if (!work) return null;
      var unlinked =
        !points &&
        !work.rubricId &&
        !work.rubric_id &&
        !(Array.isArray(work.tagIds) && work.tagIds.length) &&
        !(Array.isArray(work.tag_ids) && work.tag_ids.length);
      if (!points && !unlinked) return null;
      /** @param {unknown} value @param {unknown} mod */
      var score = function (value, mod) {
        if (points) return value == null || value === '' ? '' : String(Number(value));
        return _level(value, mod);
      };
      /** @type {Record<string, true>} */
      var seen = {};
      entries.forEach(function (e) {
        if (points ? e.score != null && e.score !== '' : Number(e.score) > 0) seen[score(e.score, e.mod)] = true;
      });
      var known = Object.keys(seen);
      if (known.length > 1) return null; // the cache disagrees with itself
      return {
        cell: cell,
        key: targetKey,
        table: 'score',
        prev: [known.length ? known[0] : score(null, 0)],
        send: [score(p.p_value, p.p_modifier)],
        pick: sameCell,
        read: function (r) {
          return [score(r && r.value, r && r.modifier)];
        },
      };
    }

    if (endpoint === 'save_score_comment') {
      /** @type {Record<string, true>} */
      var notes = {};
      entries.forEach(function (e) {
        notes[_text(e.note)] = true;
      });
      var said = Object.keys(notes);
      if (said.length > 1) return null;
      return {
        cell: cell,
        key: targetKey,
        table: 'score',
        prev: [said.length ? said[0] : ''],
        send: [_text(p.p_comment)],
        pick: sameCell,
        read: function (r) {
          return [_text(r && r.comment)];
        },
      };
    }
    return null;
  }

  /**
   * @param {unknown[]} server
   * @param {unknown[]} other
   * @returns {boolean}
   */
  function _same(server, other) {
    return server.every(function (v, i) {
      return other[i] === KEEP || other[i] === v;
    });
  }

  var COLUMNS = {
    score: 'enrollment_id,assessment_id,value,modifier,status,comment',
    tag_score: 'enrollment_id,assessment_id,tag_id,value,modifier,comment',
    rubric_score: 'enrollment_id,assessment_id,criterion_id,value,modifier,comment,beyond',
  };
  var KEY_COLUMN = { score: null, tag_score: 'tag_id', rubric_score: 'criterion_id' };

  /**
   * The rows of one read, or null when the answer is not what was asked for.
   * @param {unknown} res
   * @param {string} table
   * @returns {Record<string, unknown>[] | null}
   */
  function _rows(res, table) {
    var answer = _obj(res);
    if (!answer || answer.error || !Array.isArray(answer.data) || answer.data.length >= ROW_LIMIT) return null;
    /** @type {Record<string, unknown>[]} */
    var rows = [];
    var keyCol = /** @type {Record<string, string | null>} */ (KEY_COLUMN)[table];
    for (var i = 0; i < answer.data.length; i++) {
      var r = _obj(answer.data[i]);
      if (!r || !_id(r.enrollment_id) || !_id(r.assessment_id) || (keyCol && !_id(r[keyCol]))) return null;
      rows.push(r);
    }
    return rows;
  }

  /**
   * @param {number} startedAt when the drain started
   * @returns {void}
   */
  function _measure(startedAt) {
    if (typeof isDemoMode === 'function' && isDemoMode()) return;
    var sentry = window.Sentry;
    if (!sentry || typeof sentry.captureMessage !== 'function') return;
    var hub = sentry;
    var capture = sentry.captureMessage;
    var undoById = _obj(typeof _baselineUndo !== 'undefined' ? /** @type {unknown} */ (_baselineUndo) : null);
    var queue = _obj(/** @type {unknown} */ (window.v2Queue));
    if (!undoById || !queue || typeof queue.queued !== 'function') return;
    var undos = undoById;
    var sb = typeof getSupabase === 'function' ? getSupabase() : null;
    if (!sb || typeof sb.from !== 'function') return;

    // Targets with a rejected write waiting in the failed list are left out.
    /** @type {Record<string, true>} */
    var failed = {};
    if (typeof queue.deadLetter === 'function') {
      var dead = queue.deadLetter();
      (Array.isArray(dead) ? dead : []).forEach(function (/** @type {unknown} */ d) {
        var e = _obj(d);
        var p = e && _obj(e.payload);
        var key = e && p && typeof e.endpoint === 'string' ? _keyOf(e.endpoint, p) : null;
        if (key) failed[key] = true;
      });
    }

    // Every waiting score write that waited long enough, grouped by what it
    // sets. queued() hands back copies; even so, an entry here is only ever
    // read, never assigned to.
    /** @type {Record<string, { cell: string, endpoint: string, entries: Record<string, unknown>[] }>} */
    var groups = {};
    /** @type {string[]} */
    var order = [];
    var oldest = 0;
    var queued = /** @type {(endpoint: string) => unknown} */ (queue.queued);
    SCORE_ENDPOINTS.forEach(function (endpoint) {
      var list = queued(endpoint);
      (Array.isArray(list) ? list : []).forEach(function (/** @type {unknown} */ item) {
        var e = _obj(item);
        if (!e || typeof e.id !== 'string') return;
        var waited = startedAt - Date.parse(_text(e.created_at));
        if (!(waited >= MIN_WAIT_MS)) return;
        if (waited > oldest) oldest = waited;
        var p = _obj(e.payload) || {};
        var cell =
          typeof p.p_enrollment_id === 'string' && typeof p.p_assessment_id === 'string'
            ? p.p_enrollment_id + ':' + p.p_assessment_id
            : 'entry:' + e.id;
        var key = (ENDPOINTS.indexOf(endpoint) >= 0 && _keyOf(endpoint, p)) || 'other:' + endpoint + ':' + e.id;
        if (!groups[key]) {
          groups[key] = { cell: cell, endpoint: endpoint, entries: [] };
          order.push(key);
        }
        groups[key].entries.push(e);
      });
    });
    if (!order.length) return;
    var bucket = _bucket(oldest);
    if (_buckets[bucket]) return;

    // A target is measured only when every write waiting for it was made on
    // this page against a baseline this tab holds. Oldest first: the first
    // holds what this device knew before it; every later one adds a value it
    // is sending. One measured in an earlier report is left out of this one.
    /** @type {Target[]} */
    var measurable = [];
    /** @type {Record<string, true>} */
    var unmeasured = {};
    /** @type {string[]} */
    var reported = [];
    order.forEach(function (key) {
      var g = groups[key];
      var ids = g.entries.map(function (e) {
        return /** @type {string} */ (e.id);
      });
      if (
        ids.some(function (id) {
          return _measured[id];
        })
      )
        return;
      reported = reported.concat(ids);
      /** @type {Target | null} */
      var base = null;
      var ok = ENDPOINTS.indexOf(g.endpoint) >= 0 && !failed[key];
      for (var i = 0; ok && i < g.entries.length; i++) {
        var p = _obj(g.entries[i].payload);
        var t = p ? _target(g.endpoint, p, undos[/** @type {string} */ (g.entries[i].id)]) : null;
        if (!t) ok = false;
        else if (!base) {
          base = t;
          base.send = [t.send];
        } else base.send = base.send.concat([t.send]);
      }
      if (ok && base) measurable.push(base);
      else unmeasured[g.cell] = true;
    });
    if (!reported.length) return;

    // The first cells, as long as the read stays small; the rest are not
    // measured.
    /** @type {Record<string, true>} */
    var cells = {};
    /** @type {Record<string, true>} */
    var sids = {};
    /** @type {Record<string, true>} */
    var aids = {};
    /** @type {Target[]} */
    var targets = [];
    measurable.forEach(function (t) {
      var parts = t.cell.split(':');
      if (!cells[t.cell]) {
        var more = (sids[parts[0]] ? 0 : 1) + (aids[parts[1]] ? 0 : 1);
        if (
          Object.keys(cells).length >= MAX_CELLS ||
          Object.keys(sids).length + Object.keys(aids).length + more > MAX_IDS
        ) {
          unmeasured[t.cell] = true;
          return;
        }
        cells[t.cell] = true;
        sids[parts[0]] = true;
        aids[parts[1]] = true;
      }
      targets.push(t);
    });
    // A cell with any measured write counts among the measured.
    var k = Object.keys(unmeasured).filter(function (cell) {
      return !cells[cell];
    }).length;

    _buckets[bucket] = true;
    /** @param {number} n @param {number} m */
    var report = function (n, m) {
      reported.forEach(function (id) {
        _measured[id] = true;
      });
      capture.call(
        hub,
        'Overwrite count: ' +
          n +
          ' of ' +
          m +
          ' waiting cells changed on the server, ' +
          k +
          ' not measured (waited ' +
          bucket +
          ')',
        'warning',
      );
    };
    // Nothing to compare: no read.
    if (!targets.length) {
      report(0, 0);
      return;
    }
    /** @type {Record<string, true>} */
    var tables = {};
    targets.forEach(function (t) {
      tables[t.table] = true;
    });
    var names = Object.keys(tables);
    var client = sb;
    var reads = names.map(function (table) {
      return Promise.resolve(
        client
          .from(table)
          .select(/** @type {Record<string, string>} */ (COLUMNS)[table])
          .in('enrollment_id', Object.keys(sids))
          .in('assessment_id', Object.keys(aids)),
      );
    });
    Promise.all(reads)
      .then(function (answers) {
        /** @type {Record<string, Record<string, unknown>[]>} */
        var rowsOf = {};
        for (var i = 0; i < names.length; i++) {
          var rows = _rows(answers[i], names[i]);
          if (!rows) throw new Error('unreadable');
          rowsOf[names[i]] = rows;
        }
        /** @type {Record<string, true>} */
        var changed = {};
        targets.forEach(function (t) {
          var row = rowsOf[t.table].find(t.pick) || null;
          var server = t.read(row);
          if (_same(server, t.prev)) return;
          var mine = t.send.some(function (s) {
            return _same(server, /** @type {unknown[]} */ (s));
          });
          if (!mine) changed[t.cell] = true;
        });
        report(Object.keys(changed).length, Object.keys(cells).length);
      })
      .catch(function () {
        // A failed or unreadable read reports nothing; a later drain may try
        // this bucket again.
        delete _buckets[bucket];
      });
  }

  /**
   * @param {unknown} evt the outbox's event
   * @returns {void}
   */
  function _onEvent(evt) {
    try {
      var e = _obj(evt);
      var stats = e && _obj(e.stats);
      if (!e || e.kind !== 'flush:start' || !stats || stats.owner !== true) return;
      var startedAt = Date.now();
      setTimeout(function () {
        try {
          _measure(startedAt);
        } catch (err) {
          /* counting must never reach the outbox */
        }
      }, 0);
    } catch (err) {
      /* counting must never reach the outbox */
    }
  }

  /** @returns {void} */
  function detach() {
    if (_unsubscribe) _unsubscribe();
    _unsubscribe = null;
  }

  // A page loads this file once; a test loading it again stands for a
  // reload, so the old copy lets go first.
  var previous = _obj(/** @type {unknown} */ (window.OverwriteCount));
  if (previous && typeof previous.detach === 'function') previous.detach();
  try {
    var q = _obj(/** @type {unknown} */ (window.v2Queue));
    if (q && typeof q.subscribe === 'function') {
      var off = q.subscribe(_onEvent);
      _unsubscribe = typeof off === 'function' ? off : null;
    }
  } catch (err) {
    _unsubscribe = null;
  }
  window.OverwriteCount = { detach: detach };
})();
