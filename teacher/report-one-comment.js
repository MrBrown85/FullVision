/* report-one-comment.js — the Teacher Comment edited where it prints, in
   One Report: click the comment, type, and the changes are tracked until
   they are saved to the Term Questionnaire or discarded. Unsaved changes
   never print: the printed comment underneath is never touched, the marks
   and the editor are no-print, and Print Reports stops while a change is
   waiting. docs/plans/one-report-build-plan.md. */
window.ReportOneComment = (function () {
  'use strict';

  var CELL = '.sheet-cell[data-part="teacher-narrative"]';
  var TARGET = 'one-com-target';
  var ED_W = 560; // the editor is never narrower than this

  var _apiFn = null;
  var _preview = null;
  // Unsaved edits, kept in memory: 'cid|termId|sid' -> plain text.
  var _drafts = {};
  var _ed = null; // the open editor
  var _ask = null; // the open save question
  var _pending = null; // what to open once a student is drawn: { sid, open, why, then }

  /* ── Text ─────────────────────────────────────────────── */

  function _key(cid, termId, sid) {
    return cid + '|' + (termId || '') + '|' + sid;
  }
  function _trimEnd(t) {
    return String(t == null ? '' : t).replace(/\s+$/, '');
  }
  /* The saved comment as the Term Questionnaire's box shows it: plain text,
     a paragraph per line (an old HTML comment read as text). */
  function _plain(narrative) {
    var RQ = window.ReportQuestionnaire;
    var s = String(narrative == null ? '' : narrative);
    return _trimEnd(RQ && RQ.plainComment ? RQ.plainComment(s) : s);
  }
  function _rating(cid, sid, termId) {
    return (typeof getStudentTermRating === 'function' && getStudentTermRating(cid, sid, termId)) || null;
  }
  function _saved(cid, sid, termId) {
    var r = _rating(cid, sid, termId);
    return _plain(r && r.narrative);
  }

  function tokens(t) {
    return String(t || '')
      .split(/(\s+)/)
      .filter(function (x) {
        return x !== '';
      });
  }
  /* The word diff from a to b: [['=', text] | ['+', text] | ['-', text]],
     runs joined. A longest common subsequence over words and spaces. */
  function diffOps(a, b) {
    var A = tokens(a);
    var B = tokens(b);
    var n = A.length;
    var m = B.length;
    var ops = [];
    var push = function (op, t) {
      var last = ops[ops.length - 1];
      if (last && last[0] === op) last[1] += t;
      else ops.push([op, t]);
    };
    // A comment far past any report's length: shown as replaced whole.
    if (n * m > 4000000) {
      if (n) push('-', A.join(''));
      if (m) push('+', B.join(''));
      return ops;
    }
    var L = [];
    var i, j;
    for (i = 0; i <= n; i++) L.push(new Array(m + 1).fill(0));
    for (i = n - 1; i >= 0; i--)
      for (j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    i = 0;
    j = 0;
    while (i < n && j < m) {
      if (A[i] === B[j]) {
        push('=', A[i]);
        i++;
        j++;
      } else if (L[i + 1][j] >= L[i][j + 1]) push('-', A[i++]);
      else push('+', B[j++]);
    }
    while (i < n) push('-', A[i++]);
    while (j < m) push('+', B[j++]);
    return ops;
  }
  /* Added words underlined, removed words struck through. */
  function diffHtml(a, b) {
    return diffOps(a, b)
      .map(function (o) {
        if (o[0] === '=') return esc(o[1]);
        return (o[0] === '+' ? '<ins>' : '<del>') + esc(o[1]) + (o[0] === '+' ? '</ins>' : '</del>');
      })
      .join('');
  }
  function _words(t) {
    t = String(t || '').trim();
    return t ? t.split(/\s+/).length : 0;
  }
  function diffCount(a, b) {
    var add = 0;
    var del = 0;
    diffOps(a, b).forEach(function (o) {
      if (o[0] === '+') add += _words(o[1]);
      if (o[0] === '-') del += _words(o[1]);
    });
    return { add: add, del: del };
  }
  function _n(n, one) {
    return n + ' ' + (n === 1 ? one : one + 's');
  }
  /* "6 words added, 1 word removed"; "No changes"; for a new comment
     "42 words". */
  function countText(before, after) {
    before = _trimEnd(before);
    after = _trimEnd(after);
    if (before === after) return 'No changes';
    if (!before.trim()) return _n(_words(after), 'word');
    var c = diffCount(before, after);
    var parts = [];
    if (c.add) parts.push(_n(c.add, 'word') + ' added');
    if (c.del) parts.push(_n(c.del, 'word') + ' removed');
    return parts.join(', ') || 'Spacing changed';
  }

  /* ── The save (the Term Questionnaire's) ──────────────── */

  /* Saves the comment as the questionnaire saves a typed comment that is
     not yet approved: upsertTermRating with the narrative as plain text,
     which clears an approval when the words change (as the server does),
     and the record the questionnaire keeps with a typed comment
     (draft_meta.name, the name it was written with, and teacher_text, the
     sentences the teacher wrote), so Generate keeps what was typed here. */
  function _write(cid, sid, termId, text) {
    var RQ = window.ReportQuestionnaire;
    var r = _rating(cid, sid, termId) || {};
    var data = { narrative: text };
    var meta = r.draftMeta ? Object.assign({}, r.draftMeta) : { v: 1, sentences: [] };
    var changed = false;
    if (!meta.name && String(text).trim()) {
      var st = (getStudents(cid) || []).find(function (s) {
        return String(s.id) === String(sid);
      });
      if (st && displayNameFirst(st)) {
        meta.name = displayNameFirst(st);
        changed = true;
      }
    }
    // The sentences that were not in the saved comment are the teacher's.
    var split = RQ && RQ.sentencesOf ? RQ.sentencesOf : null;
    if (split) {
      var had = {};
      split(_plain(r.narrative)).forEach(function (s) {
        had[s] = true;
      });
      // The teacher's sentences are the ones still in the comment, and the
      // new ones: a sentence deleted here is no longer kept as theirs (the
      // questionnaire rebuilds the list on every save too).
      var now = split(text);
      var mine = (Array.isArray(meta.teacher_text) ? meta.teacher_text : []).filter(function (s) {
        return now.indexOf(s) >= 0;
      });
      now.forEach(function (s) {
        if (!had[s] && mine.indexOf(s) < 0) mine.push(s);
      });
      if (mine.length || Array.isArray(meta.teacher_text)) {
        meta.teacher_text = mine;
        changed = true;
      }
    }
    if (changed || r.draftMeta) data.draftMeta = meta;
    upsertTermRating(cid, sid, termId, data);
  }

  /* ── The page ─────────────────────────────────────────── */

  function _api() {
    return _apiFn ? _apiFn() : null;
  }
  function _ctx(api) {
    var c = (api && api.ctx && api.ctx()) || {};
    return { termId: c.termId };
  }
  function _first(st) {
    return st ? displayNameFirst(st) : '';
  }
  function _full(st) {
    if (!st) return '';
    return typeof displayNameWithLast === 'function' ? displayNameWithLast(st) : _first(st);
  }
  function _studentById(api, sid) {
    return (
      (api.students() || []).find(function (s) {
        return String(s.id) === String(sid);
      }) || null
    );
  }
  function _target() {
    return _preview ? _preview.querySelector(CELL + ' .' + TARGET) : null;
  }
  /* Where an element sits in the preview's scrolled content. */
  function _place(el) {
    var pv = _preview.getBoundingClientRect();
    var r = el.getBoundingClientRect();
    return {
      left: r.left - pv.left + _preview.scrollLeft - _preview.clientLeft,
      top: r.top - pv.top + _preview.scrollTop - _preview.clientTop,
      width: r.width,
      height: r.height,
    };
  }
  function _attach(el) {
    if (_preview && el.parentNode !== _preview) _preview.appendChild(el);
  }

  /* The comment's marks: a tracked-changes layer over the printed comment
     and a note on its heading. Both are no-print; the comment underneath
     is what prints. */
  function _paint(api) {
    var cell = _preview && _preview.querySelector(CELL);
    if (!cell || !api || api.view() !== 'one') return;
    var st = api.student();
    if (!st) return;
    var box = cell.querySelector('.report-comment-box') || cell;
    box.classList.add(TARGET);
    box.tabIndex = 0;
    box.setAttribute('role', 'button');
    box.setAttribute('aria-label', 'Edit ' + _first(st) + '’s comment');
    box.dataset.sid = String(st.id);
    Array.prototype.forEach.call(box.querySelectorAll('.one-com-diff, .one-com-unsaved'), function (x) {
      x.remove();
    });
    var termId = _ctx(api).termId;
    var draft = _drafts[_key(api.cid, termId, st.id)];
    box.classList.toggle('one-com-changed', draft != null);
    if (draft == null) return;
    var base = _saved(api.cid, st.id, termId);
    var text = box.querySelector('.report-comment-text, .report-ruled-empty');
    var layer = document.createElement('div');
    layer.className = 'one-com-diff no-print';
    layer.setAttribute('aria-hidden', 'true');
    if (text) {
      layer.style.top = text.offsetTop + 'px';
      layer.style.minHeight = text.offsetHeight + 'px';
    }
    // html-safe: diffHtml escapes every word through esc
    layer.innerHTML = diffHtml(base, draft);
    box.appendChild(layer);
    var title = box.querySelector('.report-block-title');
    if (title) {
      var note = document.createElement('span');
      note.className = 'one-com-unsaved no-print';
      // html-safe: fixed text; the student id goes through esc
      note.innerHTML =
        'Unsaved changes · <button type="button" data-action="oneComSave" data-sid="' +
        esc(String(st.id)) +
        '">Save</button> · <button type="button" data-action="oneComDiscard" data-sid="' +
        esc(String(st.id)) +
        '">Discard</button>';
      title.appendChild(note);
    }
  }

  /* ── The editor ───────────────────────────────────────── */

  function openEditor(api, opts) {
    opts = opts || {};
    closeAsk();
    if (_ed) return;
    var target = _target();
    var st = api.student();
    if (!target || !st || api.view() !== 'one') return;
    var termId = _ctx(api).termId;
    var key = _key(api.cid, termId, st.id);
    var base = _saved(api.cid, st.id, termId);
    var wrap = document.createElement('div');
    wrap.className = 'one-com-edit no-print';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-label', 'Edit ' + _first(st) + '’s comment');
    var next = opts.fromWrite ? _nextWithout(api, st.id) : null;
    // html-safe: the name goes through esc; the rest is fixed text
    wrap.innerHTML =
      '<div class="one-ce-bar"><b>Teacher Comment · ' +
      esc(_full(st)) +
      '</b><span class="one-ce-count" aria-live="polite"></span></div>' +
      '<textarea class="one-ce-text" spellcheck="true" aria-label="Comment"></textarea>' +
      '<div class="one-ce-foot"><span>Esc cancels · click off to finish</span>' +
      (next ? '<button type="button" data-action="oneComNext">Next Without a Comment ›</button>' : '') +
      '</div>';
    var ta = wrap.querySelector('textarea');
    var count = wrap.querySelector('.one-ce-count');
    _ed = {
      el: wrap,
      ta: ta,
      cid: api.cid,
      termId: termId,
      sid: st.id,
      key: key,
      base: base,
      before: _drafts[key],
      fromWrite: !!opts.fromWrite,
      then: opts.then || null,
    };
    ta.value = _drafts[key] != null ? _drafts[key] : base;
    var sync = function () {
      ta.style.height = 'auto';
      ta.style.height = Math.max(80, ta.scrollHeight) + 'px';
      count.textContent = countText(base, ta.value);
    };
    _attach(wrap);
    _position();
    sync();
    ta.addEventListener('input', sync);
    ta.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        finish(true);
      }
    });
    wrap.addEventListener('focusout', function () {
      setTimeout(function () {
        if (_ed && _ed.el === wrap && document.activeElement && !wrap.contains(document.activeElement)) {
          // Focus left the editor for something else on the page (Tab).
          if (document.activeElement !== document.body) finish(false);
        }
      }, 0);
    });
    document.addEventListener('pointerdown', _outside, true);
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }
  function _position() {
    if (!_ed) return;
    var target = _target();
    if (!target) return;
    var a = _place(target);
    var w = Math.max(a.width, ED_W);
    var maxLeft = _preview.scrollLeft + _preview.clientWidth - w - 8;
    var left = Math.max(_preview.scrollLeft + 8, Math.min(a.left - (w - a.width) / 2, maxLeft));
    _ed.el.style.width = w + 'px';
    _ed.el.style.left = left + 'px';
    _ed.el.style.top = Math.max(0, a.top - 30) + 'px';
  }
  function _outside(e) {
    if (!_ed) return;
    if (_ed.el.contains(e.target)) return;
    finish(false, null, true);
  }
  /* After a click off, the question waits for that click to land, so
     whatever it clicked (a part, another control) does not take its
     focus; a question that click opened itself (Print Reports) stands. */
  function _afterClick(fn) {
    var done = false;
    var run = function () {
      if (done) return;
      done = true;
      document.removeEventListener('pointerup', up, true);
      setTimeout(fn, 0);
    };
    var up = function () {
      run();
    };
    document.addEventListener('pointerup', up, true);
    setTimeout(run, 700);
  }
  function _closeEditor() {
    if (!_ed) return;
    document.removeEventListener('pointerdown', _outside, true);
    if (_ed && _ed.el.parentNode) _ed.el.remove();
    _ed = null;
  }
  /* Ends the edit. Cancel puts back what there was before it (a draft from
     an earlier edit too). Otherwise a change is kept as a draft, shown as
     tracked changes, and the save question asked; `then` runs once it is
     answered (or now, when nothing changed). */
  function finish(cancel, then, clickedOff) {
    if (!_ed) return;
    var ed = _ed;
    then = then || ed.then;
    var v = _trimEnd(ed.ta.value);
    _closeEditor();
    if (cancel) {
      if (ed.before == null) delete _drafts[ed.key];
      else _drafts[ed.key] = ed.before;
    } else if (v === ed.base) delete _drafts[ed.key];
    else _drafts[ed.key] = v;
    var api = _api();
    if (!api || String(api.cid) !== String(ed.cid)) return;
    _paint(api);
    if (!cancel && _drafts[ed.key] != null) {
      if (!clickedOff) return askToSave(api, null, then);
      return _afterClick(function () {
        var now = _api();
        var st = now && now.view() === 'one' ? now.student() : null;
        if (_ed || _ask || !st || String(st.id) !== String(ed.sid)) return;
        if (_drafts[ed.key] != null) askToSave(now, null, then);
      });
    }
    _focusComment();
    if (!cancel && then) then();
  }
  function _focusComment() {
    var t = _target();
    if (t) t.focus({ preventScroll: true });
  }

  /* ── The save question ────────────────────────────────── */

  function closeAsk() {
    if (_ask && _ask.el.parentNode) _ask.el.remove();
    _ask = null;
  }
  function askToSave(api, why, then) {
    closeAsk();
    var target = _target();
    var st = api.student();
    if (!target || !st) return;
    var termId = _ctx(api).termId;
    var key = _key(api.cid, termId, st.id);
    var draft = _drafts[key];
    if (draft == null) return;
    var base = _saved(api.cid, st.id, termId);
    var r = _rating(api.cid, st.id, termId);
    var first = _first(st);
    var body =
      (why ? why + ' ' : '') +
      countText(base, draft) +
      '. It saves to ' +
      first +
      '’s Term Questionnaire too' +
      (r && r.approvedAt ? ', and the comment will need approving again.' : '.');
    var el = document.createElement('div');
    el.className = 'one-com-ask no-print';
    el.setAttribute('role', 'alertdialog');
    el.setAttribute('aria-labelledby', 'one-com-ask-t');
    el.setAttribute('aria-describedby', 'one-com-ask-d');
    // html-safe: every piece of text goes through esc
    el.innerHTML =
      '<div><b id="one-com-ask-t">Save your changes to ' +
      esc(first) +
      '’s comment?</b><span id="one-com-ask-d">' +
      esc(body) +
      '</span></div><div class="one-cp-btns">' +
      '<button type="button" data-action="oneComKeep">Keep Editing</button>' +
      '<button type="button" data-action="oneComDiscard">Discard</button>' +
      '<button type="button" data-action="oneComSave" class="primary">Save</button></div>';
    el.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        // The question closes; the change stays, marked on the page.
        e.preventDefault();
        e.stopPropagation();
        closeAsk();
        _focusComment();
      }
    });
    _ask = { el: el, sid: st.id, key: _key(api.cid, _ctx(api).termId, st.id), then: then || null };
    _attach(el);
    _positionAsk();
    el.querySelector('[data-action="oneComSave"]').focus({ preventScroll: true });
  }
  function _positionAsk() {
    if (!_ask) return;
    var target = _target();
    if (!target) return;
    var a = _place(target);
    var w = _ask.el.offsetWidth;
    var left = Math.max(_preview.scrollLeft + 8, Math.min(a.left, _preview.scrollLeft + _preview.clientWidth - w - 8));
    _ask.el.style.left = left + 'px';
    _ask.el.style.top = Math.max(0, a.top - _ask.el.offsetHeight - 12) + 'px';
  }

  function save(api, sid) {
    var termId = _ctx(api).termId;
    var key = _key(api.cid, termId, sid);
    var draft = _drafts[key];
    var then = _ask && String(_ask.sid) === String(sid) ? _ask.then : null;
    closeAsk();
    if (draft == null) return;
    var cid = api.cid;
    var before = _rating(cid, sid, termId) || {};
    var prev = {
      narrative: before.narrative || '',
      draftMeta: before.draftMeta || null,
      approvedAt: before.approvedAt || null,
    };
    _write(cid, sid, termId, draft);
    delete _drafts[key];
    var st = _studentById(api, sid);
    api.redraw(sid);
    api.announce('Saved');
    _focusComment();
    if (typeof showUndoToast === 'function') {
      showUndoToast('Saved ' + _first(st) + '’s comment', function () {
        // The comment as it was: its words, its record and its approval.
        // (With approvedAt named, upsertTermRating keeps it; a comment with
        // no record before goes back to an empty one.)
        upsertTermRating(cid, sid, termId, {
          narrative: prev.narrative,
          draftMeta: prev.draftMeta || { v: 1, sentences: [] },
          approvedAt: prev.approvedAt,
        });
        var now = _api();
        if (now && String(now.cid) === String(cid)) now.redraw(sid);
      });
    }
    if (then) then();
  }
  function discard(api, sid) {
    var termId = _ctx(api).termId;
    var then = _ask && String(_ask.sid) === String(sid) ? _ask.then : null;
    closeAsk();
    delete _drafts[_key(api.cid, termId, sid)];
    _paint(api);
    api.announce('Discarded');
    _focusComment();
    if (then) then();
  }

  /* ── Write Them ───────────────────────────────────────── */

  function _noComment(api, sid) {
    if (_saved(api.cid, sid, _ctx(api).termId).trim()) return false;
    var fit = api.fit && api.fit();
    var per = fit && fit.perStudent && fit.perStudent[sid];
    return per ? !!per.noComment : true;
  }
  /* The next student with no comment after `sid`, round to the top. */
  function _nextWithout(api, sid) {
    var list = api.students() || [];
    var at = list.findIndex(function (s) {
      return String(s.id) === String(sid);
    });
    for (var k = 1; k <= list.length; k++) {
      var s = list[(at + k) % list.length];
      if (String(s.id) !== String(sid) && _noComment(api, s.id)) return s;
    }
    return null;
  }
  function _openFor(api, sid, opts) {
    var cur = api.student();
    if (api.view() === 'one' && cur && String(cur.id) === String(sid)) {
      if (opts.open) openEditor(api, opts);
      else askToSave(api, opts.why, opts.then);
      return;
    }
    _pending = Object.assign({ sid: sid }, opts);
    api.goStudent(sid);
  }
  function writeThem(api) {
    var list = api.students() || [];
    var s = list.find(function (x) {
      return _noComment(api, x.id);
    });
    if (!s) {
      api.announce('Every student has a comment');
      return;
    }
    _openFor(api, s.id, { open: true, fromWrite: true });
  }
  function _goNext(api) {
    if (!_ed) return;
    var sid = _ed.sid;
    finish(false, function () {
      var now = _api();
      var nx = now && _nextWithout(now, sid);
      if (nx) _openFor(now, nx.id, { open: true, fromWrite: true });
    });
  }

  /* ── The interface page-reports.js calls ──────────────── */

  var _unloadBound = false;
  function mount(previewEl, apiFn) {
    _apiFn = apiFn;
    _preview = previewEl;
    if (!_unloadBound && typeof window !== 'undefined' && window.addEventListener) {
      // Closing or reloading the tab with a comment change not yet saved asks first.
      _unloadBound = true;
      window.addEventListener('beforeunload', function (e) {
        if (!Object.keys(_drafts).length) return;
        e.preventDefault();
        e.returnValue = '';
      });
    }
    if (!previewEl || previewEl._oneComment) return;
    previewEl._oneComment = true;
    previewEl.addEventListener('click', function (e) {
      if (_ed || !e.target.closest) return;
      var t = e.target.closest('.' + TARGET);
      if (!t) return;
      var ctl = e.target.closest('button, a, [data-action]');
      if (ctl && t.contains(ctl)) return;
      var api = _api();
      if (api && api.view() === 'one') openEditor(api);
    });
    previewEl.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      if (!e.target.classList || !e.target.classList.contains(TARGET)) return;
      e.preventDefault();
      e.stopPropagation();
      var api = _api();
      if (api && api.view() === 'one') openEditor(api);
    });
  }

  /* After each draw: the comment is made editable, a draft's marks are put
     back, and an open editor or question is kept over the comment. */
  function decorate(previewEl, api) {
    _preview = previewEl;
    if (!api) return;
    var st = api.view() === 'one' ? api.student() : null;
    if (_ed && (!st || String(st.id) !== String(_ed.sid) || String(api.cid) !== String(_ed.cid))) {
      // The canvas moved on while the editor was open: the change is kept.
      var ed = _ed;
      var v = _trimEnd(ed.ta.value);
      _closeEditor();
      if (v === ed.base) delete _drafts[ed.key];
      else _drafts[ed.key] = v;
    }
    if (_ask && (!st || String(st.id) !== String(_ask.sid))) closeAsk();
    // The question is about one report's comment: it closes when the report
    // period changes (the change is kept, unsaved, under its own period).
    if (_ask && _ask.key !== _key(api.cid, _ctx(api).termId, _ask.sid)) closeAsk();
    _paint(api);
    if (_ed) {
      _attach(_ed.el);
      _position();
    }
    if (_ask) {
      _attach(_ask.el);
      _positionAsk();
    }
    var p = _pending;
    if (p && st && String(st.id) === String(p.sid)) {
      _pending = null;
      setTimeout(function () {
        var now = _api();
        if (!now || now.view() !== 'one') return;
        var t = _target();
        if (t) t.scrollIntoView({ block: 'center' });
        if (p.open) openEditor(now, p);
        else askToSave(now, p.why, p.then);
      }, 0);
    }
  }

  function handle(action, el, api) {
    switch (action) {
      case 'oneWriteThem':
        writeThem(api);
        return true;
      case 'oneComSave':
      case 'oneComDiscard': {
        var sid = (el && el.dataset && el.dataset.sid) || (_ask && _ask.sid) || (api.student() && api.student().id);
        if (sid == null) return true;
        if (action === 'oneComSave') save(api, sid);
        else discard(api, sid);
        return true;
      }
      case 'oneComKeep': {
        var then = _ask ? _ask.then : null;
        closeAsk();
        openEditor(api, { then: then });
        return true;
      }
      case 'oneComNext':
        _goNext(api);
        return true;
    }
    return false;
  }

  /* Before the preview moves to another student (Previous or Next Student,
     teacher/report-one-head.js): a comment being edited, or changed and not
     saved, for the student shown is asked about first, and `then` runs once
     it is saved or discarded; Keep Editing or Escape leaves everything where
     it was. With nothing to ask, `then` runs at once. */
  function beforeLeave(api, then) {
    if (_ed) return finish(false, then);
    var st = api && api.view() === 'one' ? api.student() : null;
    if (st && _drafts[_key(api.cid, _ctx(api).termId, st.id)] != null) return askToSave(api, null, then);
    then();
  }

  /* False stops Print Reports until a changed comment is saved or discarded. */
  function beforePrint(api) {
    if (!api) return true;
    if (_ed) finish(false);
    var termId = _ctx(api).termId;
    var waiting = (api.students() || []).find(function (s) {
      return _drafts[_key(api.cid, termId, s.id)] != null;
    });
    if (!waiting) return true;
    _openFor(api, waiting.id, { why: 'Save or discard before printing.' });
    return false;
  }

  return {
    mount: mount,
    decorate: decorate,
    handle: handle,
    beforePrint: beforePrint,
    beforeLeave: beforeLeave,
    _test: {
      tokens: tokens,
      diffOps: diffOps,
      diffHtml: diffHtml,
      diffCount: diffCount,
      countText: countText,
      write: _write,
      drafts: function () {
        return _drafts;
      },
      setDraft: function (cid, termId, sid, text) {
        if (text == null) delete _drafts[_key(cid, termId, sid)];
        else _drafts[_key(cid, termId, sid)] = text;
      },
      save: save,
      discard: discard,
      reset: function () {
        _closeEditor();
        closeAsk();
        _drafts = {};
        _pending = null;
      },
    },
  };
})();
