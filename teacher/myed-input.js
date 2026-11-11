/* myed-input.js — Reports › MyEdBC Input (student page build plan, S16-F1;
   docs/plans/myed-integration.md 2.2 and 4.5; the artboard's "MyEdBC
   Plugin: Reports › MyEdBC Input (FullVision)").

   One row per student, in MyEd's order (last name, then first name): the
   grade, the mark MyEd takes, the comment, its length against MyEd's 500
   characters, and whether the teacher has marked it ready. Beside the
   table, one student's comment with Generate, Mark Ready and Save.

   Every grade here is what a family would see: the rows are built inside
   the 'myed' report surface (teacher/report-scores.js), which is returned
   grades in a class that holds grades. Every figure, word and code comes
   from shared/calc.js (studentGradeSummary, levelText, levelCode,
   studentGradeBadges); this file joins them and computes none.

   What Mark Ready and Save keep needs the MyEd tables (Batch F), which are
   not applied. Until they are, the tab is shown only in Demo Mode, and
   what it keeps is kept on this device (localStorage), per class and
   report. Wiring it to the server is a later PR. */
window.MyEdInput = (function () {
  'use strict';

  var _inReportScores = function (fn) {
    return ReportScores.scoped('myed', fn);
  };
  rows = _inReportScores(rows);
  markFor = _inReportScores(markFor);

  // MyEd refuses a comment longer than this (the board; plan S16).
  var LIMIT = 500;

  /* ── What is kept (Demo Mode, this device) ───────────────────── */

  function _key(cid, termId) {
    return 'fv-myed-input:' + cid + ':' + termId;
  }
  function load(cid, termId) {
    try {
      var v = JSON.parse(localStorage.getItem(_key(cid, termId)) || '{}');
      return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    } catch (e) {
      return {};
    }
  }
  function _store(cid, termId, all) {
    try {
      localStorage.setItem(_key(cid, termId), JSON.stringify(all));
    } catch (e) {
      /* a full device keeps what is on screen until the page closes */
    }
  }
  function entry(cid, termId, sid) {
    var e = load(cid, termId)[sid] || {};
    return { comment: typeof e.comment === 'string' ? e.comment : '', ready: e.ready === true };
  }
  /* A comment saved. A changed comment is no longer ready: the teacher
     marks it again. Returns the entry as kept. */
  function saveComment(cid, termId, sid, text) {
    var all = load(cid, termId);
    var was = all[sid] || {};
    var comment = String(text == null ? '' : text);
    var ready = was.ready === true && was.comment === comment && comment.trim() !== '' && comment.length <= LIMIT;
    all[sid] = { comment: comment, ready: ready };
    _store(cid, termId, all);
    return entry(cid, termId, sid);
  }
  /* Mark Ready (or not). Only a comment within the limit can be ready. */
  function setReady(cid, termId, sid, on) {
    var all = load(cid, termId);
    var e = all[sid] || { comment: '' };
    var comment = typeof e.comment === 'string' ? e.comment : '';
    var ok = !!on && comment.trim() !== '' && comment.length <= LIMIT;
    all[sid] = { comment: comment, ready: ok };
    _store(cid, termId, all);
    return ok;
  }

  /* ── The rows ───────────────────────────────────────────────── */

  // "Last, First", as MyEd lists the class.
  function nameOf(st) {
    var last = String(st.lastName || '').trim();
    var first = String(st.firstName || '').trim();
    return last && first ? last + ', ' + first : last || first;
  }

  // MyEd's order: last name, then first name.
  function _ordered(cid) {
    return getStudents(cid)
      .slice()
      .sort(function (a, b) {
        return (
          String(a.lastName || '').localeCompare(String(b.lastName || '')) ||
          String(a.firstName || '').localeCompare(String(b.firstName || ''))
        );
      });
  }

  /* The mark MyEd takes for one student, as calc.js gives it: in a
     Proficiency class the level's code (EXT, PRF, DEV, EMG, or IE with no
     evidence); in a Letter or Both class (grades 10–12) the percent MyEd
     wants, without its % sign, or IE when the report says IE. '' when
     there is no mark to give. */
  function markFor(cid, sid, termId) {
    if (courseGradeMode(cid) === 'proficiency') return levelCode(getOverallProficiency(cid, sid));
    var letter = studentGradeBadges(cid, sid, termId).letter;
    if (!letter) return '';
    if (letter.basis) return letter.basis === 'ie' ? 'IE' : '';
    return String(letter.pct || '').replace(/%$/, '');
  }

  function statusOf(comment, ready) {
    var text = String(comment || '');
    if (!text.trim()) return 'No Comment';
    if (text.length > LIMIT) return 'Over Limit';
    return ready ? 'Ready' : 'Not Ready';
  }

  /* One row per student, in MyEd's order. Runs in the 'myed' surface. */
  function rows(cid, termId) {
    var kept = load(cid, termId);
    var letterOnly = courseGradeMode(cid) === 'letter';
    return _ordered(cid).map(function (st) {
      var e = kept[st.id] || {};
      var comment = typeof e.comment === 'string' ? e.comment : '';
      var overall = getOverallProficiency(cid, st.id);
      return {
        sid: st.id,
        name: nameOf(st),
        grade: studentGradeSummary(cid, st.id, termId).text,
        word: letterOnly ? '' : levelText(cid, overall, 'No Evidence'),
        mark: markFor(cid, st.id, termId),
        comment: comment,
        count: comment.length,
        status: statusOf(comment, e.ready === true),
      };
    });
  }

  var STATUSES = ['Ready', 'Over Limit', 'No Comment', 'Not Ready'];
  function counts(list) {
    var out = {};
    STATUSES.forEach(function (s) {
      out[s] = 0;
    });
    list.forEach(function (r) {
      out[r.status]++;
    });
    return out;
  }

  /* ── Generate ───────────────────────────────────────────────── */

  /* A draft from the Comment Bank for one student, as the Term
     Questionnaire's Generate Comment makes it: the facts read in the
     report's set of scores, the teacher's habit ratings and focus for this
     report. `n` gives another version. '' when the student has no marked
     work to draft from, or the bank has not loaded. */
  function draftFor(cid, termId, st, n) {
    if (typeof COMMENT_BANK === 'undefined') return '';
    return ReportScores.withReportScores('myed', function () {
      var f = CommentBank.facts(cid, st, termId);
      var g = (f && f.grade) || {};
      if (g.basis !== 'ie' && !(g.marked && g.marked.mine > 0)) return '';
      var rating = getStudentTermRating(cid, st.id, termId) || {};
      var picks = { habits: rating.habits || {}, focus: rating.focusSectionId || f.focusId };
      var d = CommentBank.draft(CommentBank.context(f, picks), {
        seed: CommentBank.seedFor(st.id + '|' + termId) + (n || 0),
      });
      return (d && d.text) || '';
    });
  }

  /* ── Drawing ────────────────────────────────────────────────── */

  var _state = { cid: null, termId: null, sid: null, n: {} };

  function _count(n) {
    return n + ' / ' + LIMIT;
  }

  function _statusClass(s) {
    return 'myed-status myed-status-' + s.toLowerCase().replace(/\s+/g, '-');
  }

  // html-safe: every value through esc; the rest is fixed markup
  function _rowHtml(r, selected, showWord) {
    return (
      '<button type="button" class="myed-row' +
      (selected ? ' selected' : '') +
      '" data-myed="pick" data-sid="' +
      esc(r.sid) +
      '" aria-pressed="' +
      (selected ? 'true' : 'false') +
      '">' +
      '<span class="myed-name">' +
      esc(r.name) +
      '</span>' +
      '<span>' +
      esc(r.grade || '—') +
      '</span>' +
      (showWord ? '<span>' + esc(r.word) + '</span>' : '') +
      '<span class="myed-mark">' +
      esc(r.mark || '—') +
      '</span>' +
      '<span class="myed-comment">' +
      esc(r.comment || 'No comment yet.') +
      '</span>' +
      '<span class="myed-count' +
      (r.count > LIMIT ? ' over' : '') +
      '">' +
      esc(r.count ? _count(r.count) : '—') +
      '</span>' +
      '<span class="' +
      _statusClass(r.status) +
      '">' +
      esc(r.status) +
      '</span>' +
      '</button>'
    );
  }

  // html-safe: every value through esc; the rest is fixed markup
  function _panelHtml(r) {
    if (!r) return '<div class="myed-panel"><p class="myed-hint">No students in this class yet.</p></div>';
    var over = r.count - LIMIT;
    var e = entry(_state.cid, _state.termId, r.sid);
    return (
      '<div class="myed-panel" aria-label="Comment for ' +
      esc(r.name) +
      '">' +
      '<h2 class="myed-panel-name">' +
      esc(r.name) +
      '</h2>' +
      '<div class="myed-panel-grade">' +
      esc([r.grade, r.word, r.mark ? 'MyEd Mark ' + r.mark : ''].filter(Boolean).join(' · ')) +
      '</div>' +
      '<label class="myed-label" for="myed-comment">Comment</label>' +
      '<textarea id="myed-comment" class="myed-box" data-myed="box">' +
      esc(r.comment) +
      '</textarea>' +
      '<div class="myed-panel-count"><span id="myed-count" class="' +
      (over > 0 ? 'over' : '') +
      '">' +
      esc(_count(r.count) + ' Characters') +
      '</span><span id="myed-over">' +
      esc(over > 0 ? over + ' over' : '') +
      '</span></div>' +
      '<div class="myed-hint" id="myed-limit-msg"' +
      (over > 0 ? '' : ' hidden') +
      '>' +
      esc('MyEd will not accept this comment until it is ' + LIMIT + ' characters or fewer.') +
      '</div>' +
      '<div class="myed-hint" id="myed-nodraft" role="status" hidden>' +
      esc('No marked work this report, so there is nothing to draft from yet.') +
      '</div>' +
      '<div class="myed-actions">' +
      '<button type="button" class="btn btn-ghost" data-myed="generate">Generate</button>' +
      '<button type="button" class="btn btn-ghost" data-myed="ready"' +
      (r.status === 'Ready' || r.status === 'Not Ready' ? '' : ' disabled') +
      '>' +
      (e.ready && r.status === 'Ready' ? 'Mark Not Ready' : 'Mark Ready') +
      '</button>' +
      '<button type="button" class="btn btn-primary myed-save" data-myed="save">Save</button>' +
      '</div>' +
      '</div>'
    );
  }

  // html-safe: every value through esc; the rest is fixed markup
  function html(cid, termId) {
    _state.cid = cid;
    _state.termId = termId;
    var list = rows(cid, termId);
    if (!list.some(r => r.sid === _state.sid)) _state.sid = list.length ? list[0].sid : null;
    var showWord = courseGradeMode(cid) !== 'letter';
    var c = counts(list);
    var head =
      '<div class="myed-row myed-head" aria-hidden="true"><span>Student</span><span>Score</span>' +
      (showWord ? '<span>Proficiency</span>' : '') +
      '<span>MyEd Mark</span><span>Comment</span><span>Characters</span><span>Status</span></div>';
    var selected = list.find(r => r.sid === _state.sid) || null;
    return (
      '<div class="myed-input' +
      (showWord ? '' : ' no-word') +
      '" id="myed-input" data-cid="' +
      esc(cid) +
      '">' +
      '<div class="myed-bar">' +
      '<div class="myed-counts">' +
      ['Ready', 'Over Limit', 'No Comment']
        .map(function (s) {
          return (
            '<div class="myed-count-card"><span class="myed-count-n">' +
            esc(String(c[s])) +
            '</span><span>' +
            esc(s) +
            '</span></div>'
          );
        })
        .join('') +
      '</div>' +
      '<button type="button" class="btn btn-ghost" data-myed="generateAll">Generate All Comments</button>' +
      '</div>' +
      '<p class="myed-hint myed-device">' +
      esc('Kept on this device for now. Demo Mode only while this is being built.') +
      '</p>' +
      '<div class="myed-body">' +
      '<div class="myed-table" role="group" aria-label="Students">' +
      head +
      list
        .map(function (r) {
          return _rowHtml(r, r.sid === _state.sid, showWord);
        })
        .join('') +
      '</div>' +
      _panelHtml(selected) +
      '</div>' +
      '</div>'
    );
  }

  /* ── Acting ─────────────────────────────────────────────────── */

  var _redraw = null;
  // True while the screen that drew the panel is still the one showing.
  function _current(cid, termId) {
    var root = document.getElementById('myed-input');
    return !!root && root.dataset.cid === cid && _state.cid === cid && _state.termId === termId;
  }

  function _syncCount(text) {
    var n = String(text || '').length;
    var over = n - LIMIT;
    var count = document.getElementById('myed-count');
    var overEl = document.getElementById('myed-over');
    var msg = document.getElementById('myed-limit-msg');
    if (count) {
      count.textContent = _count(n) + ' Characters';
      count.classList.toggle('over', over > 0);
    }
    if (overEl) overEl.textContent = over > 0 ? over + ' over' : '';
    if (msg) msg.hidden = !(over > 0);
  }

  // The box's text, saved when it differs from what is kept.
  function _saveBox() {
    var box = document.getElementById('myed-comment');
    if (!box || !_state.sid || !_current(_state.cid, _state.termId)) return;
    if (box.value !== entry(_state.cid, _state.termId, _state.sid).comment)
      saveComment(_state.cid, _state.termId, _state.sid, box.value);
  }

  function _student(cid, sid) {
    return getStudents(cid).find(function (s) {
      return s.id === sid;
    });
  }

  function _generate(cid, termId, sid) {
    var st = _student(cid, sid);
    if (!st) return false;
    var n = (_state.n[sid] || 0) + 1;
    var text = draftFor(cid, termId, st, n);
    if (!text) return false;
    _state.n[sid] = n;
    saveComment(cid, termId, sid, text);
    return true;
  }

  function act(what, el) {
    var cid = _state.cid;
    var termId = _state.termId;
    if (!cid || !_current(cid, termId)) return;
    // Every action reads returned grades in a class that holds them: none acts while they load.
    if (!ReportScores.ready(cid)) return;
    if (what === 'pick') {
      _saveBox();
      _state.sid = el.dataset.sid;
    } else if (what === 'save') {
      _saveBox();
    } else if (what === 'ready') {
      _saveBox();
      var e = entry(cid, termId, _state.sid);
      setReady(cid, termId, _state.sid, !e.ready);
    } else if (what === 'generate') {
      _saveBox();
      if (!_generate(cid, termId, _state.sid)) {
        var line = document.getElementById('myed-nodraft');
        if (line) line.hidden = typeof COMMENT_BANK === 'undefined';
        return;
      }
    } else if (what === 'generateAll') {
      _saveBox();
      // Only students with no comment yet: a comment the teacher has is never replaced.
      rows(cid, termId).forEach(function (r) {
        if (!r.comment.trim()) _generate(cid, termId, r.sid);
      });
    } else return;
    if (_redraw) _redraw();
  }

  /* Draws the tab into `output` and listens on what it drew. `redraw` is
     the page's own redraw, called after each change. */
  function mount(output, cid, termId, redraw) {
    if (_state.cid !== cid) _state = { cid: cid, termId: termId, sid: null, n: {} };
    _redraw = redraw;
    // html-safe: html() escapes every value
    output.innerHTML = html(cid, termId);
    var root = document.getElementById('myed-input');
    if (!root) return;
    root.addEventListener('click', function (e) {
      var el = e.target.closest('[data-myed]');
      if (!el || el.dataset.myed === 'box' || el.disabled) return;
      act(el.dataset.myed, el);
    });
    root.addEventListener('input', function (e) {
      if (e.target && e.target.id === 'myed-comment') _syncCount(e.target.value);
    });
  }

  // Before the page leaves the tab or the class: the box is saved.
  function leave() {
    _saveBox();
  }

  /* Picks a student from the roster. */
  function pick(sid) {
    _saveBox();
    _state.sid = sid;
    if (_redraw) _redraw();
  }

  return {
    LIMIT: LIMIT,
    rows: rows,
    counts: counts,
    markFor: markFor,
    statusOf: statusOf,
    nameOf: nameOf,
    draftFor: draftFor,
    load: load,
    entry: entry,
    saveComment: saveComment,
    setReady: setReady,
    html: html,
    mount: mount,
    leave: leave,
    pick: pick,
    act: act,
  };
})();
