/* report-one-page.js — what One Report's pages do on screen: Hide a part,
   leave a row off, rename a heading, edit the Teacher Comment where it
   prints, choose the assessments, reword the questions. Everything it
   adds to a page is no-print; a printed copy is the layout's own HTML
   (report-one.js). docs/plans/one-report-build-plan.md. */
window.ReportOnePage = (function () {
  'use strict';

  var _api = null; // () => api, set at mount
  var MINE = 'one-pg'; // on every element this file adds to the page
  var _dlg = null; // the open dialog: { kind, key, overlay, card, opener, q, work, timer }
  var _then = null; // run once after the next draw (focus, flash)
  var _renaming = null; // { h, key, old }
  var _hot = null; // the row whose − button shows

  var PAGE_CELLS = '.sheet-zoom > .report-sheet.one-sheet > .sheet-body > .sheet-row > .sheet-cell[data-part]';
  var WORDED = ['student-reflection-learning', 'student-reflection-habits', 'parent-response'];

  function mount(preview, apiFn) {
    _api = apiFn;
    if (preview && !preview._onePage) {
      preview._onePage = true;
      preview.addEventListener('mouseover', _onOver);
      preview.addEventListener('mouseleave', _onLeave);
      preview.addEventListener('dblclick', _onDbl);
      preview.addEventListener('keydown', _onKey);
      preview.addEventListener('pointerdown', _onPointerDown);
    }
    if (_comment()) _comment().mount(preview, apiFn);
  }

  /* The Teacher Comment's editor is its own file (report-one-comment.js). */
  function _comment() {
    return typeof ReportOneComment !== 'undefined' ? ReportOneComment : null;
  }

  /* ── Small helpers ─────────────────────────────────────────── */

  function _el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function _btn(cls, text, action, data) {
    var b = _el('button', MINE + ' no-print ' + cls, text);
    b.type = 'button';
    if (action) b.setAttribute('data-action', action);
    Object.keys(data || {}).forEach(function (k) {
      b.setAttribute('data-' + k, data[k]);
    });
    return b;
  }
  function _first(student) {
    if (!student) return '';
    return typeof displayNameFirst === 'function'
      ? displayNameFirst(student)
      : student.preferred || student.firstName || '';
  }
  function _label(api, key) {
    return ReportOne.label(key, api.cid);
  }
  function _each(list, fn) {
    Array.prototype.forEach.call(list || [], fn);
  }
  function _cells(preview) {
    return Array.prototype.slice.call(preview.querySelectorAll(PAGE_CELLS));
  }
  function _cellsOf(preview, key) {
    return _cells(preview).filter(function (c) {
      return c.getAttribute('data-part') === key;
    });
  }
  /* The rows left off a part, kept apart: the class's and this student's own. */
  function _offLists(m, key, sid) {
    var cls = (m.removed && m.removed[key]) || [];
    var p = sid && m.perStudent && m.perStudent[sid];
    var own = ((p && p.removed && p.removed[key]) || []).filter(function (r) {
      return cls.indexOf(r) < 0;
    });
    return { cls: cls, own: own };
  }
  function _focus(el) {
    if (el && el.focus) el.focus({ preventScroll: true });
  }
  function _reduced() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  /* ── After each draw of the pages ──────────────────────────── */

  function decorate(preview, api) {
    if (preview) _decorateMine(preview, api);
    if (_dlg) _refreshDialog(api);
    if (_comment()) _comment().decorate(preview, api);
  }
  /* This file's controls only: in One Student view, none in Everyone. */
  function _decorateMine(preview, api) {
    _clear(preview);
    var student = api.view() === 'one' ? api.student() : null;
    if (student) {
      var m = api.model();
      _banner(preview, api, student);
      _parts(preview, api, m, student);
      _addStrip(preview, api, m);
    }
    if (_then) {
      var fn = _then;
      _then = null;
      fn(preview);
    }
  }

  /* Takes off what an earlier decorate added, so decorating twice is decorating once. */
  function _clear(preview) {
    _each(preview.querySelectorAll('.' + MINE), function (x) {
      if (x.parentNode) x.parentNode.removeChild(x);
    });
    _each(preview.querySelectorAll('.one-hover, .one-row-hot, .one-pg-flash'), function (x) {
      x.classList.remove('one-hover', 'one-row-hot', 'one-pg-flash');
    });
    _hot = null;
  }

  function _banner(preview, api, student) {
    if (!api.scope()) return;
    var b = _el('div', MINE + ' no-print one-banner');
    b.setAttribute('role', 'status');
    b.appendChild(document.createTextNode('Parts and rows you switch off now apply to '));
    b.appendChild(_el('b', '', _first(student)));
    b.appendChild(document.createTextNode(' only. Options, headings and wording are the class’s. '));
    b.appendChild(_btn('one-banner-back', 'Back to the Class', 'oneScopeClass'));
    preview.insertBefore(b, preview.firstChild);
  }

  function _parts(preview, api, m, student) {
    var sid = student.id;
    var seen = {};
    var cells = _cells(preview);
    cells.forEach(function (cell) {
      var key = cell.getAttribute('data-part');
      if (key === 'header') return;
      if (!seen[key]) {
        seen[key] = true;
        var label = _label(api, key);
        if (!cell.hasAttribute('tabindex')) cell.setAttribute('tabindex', '0');
        if (!cell.hasAttribute('aria-label')) cell.setAttribute('aria-label', label);
        cell
          .appendChild(_btn('one-hide', 'Hide', 'oneHide', { part: key }))
          .setAttribute('aria-label', 'Hide ' + label);
        var h = key === 'progress' ? null : cell.querySelector('.report-block-title');
        if (h) {
          h.setAttribute('data-one-title', key);
          h.setAttribute('tabindex', '0');
          h.setAttribute('title', 'Double-click or press Enter to rename');
        }
        _chip(cell, h, api, m, key, student);
      }
      _rowButtons(cell, key);
    });
  }

  /* The dashed chip beside a heading: rows left off this part. */
  function _chip(cell, h, api, m, key, student) {
    var d = ReportOne.PARTS[key];
    if (key !== 'assessments' && !(d && d.rows)) return;
    var n = ReportOne.removedOf(m, key, student.id).length;
    if (!n) return;
    var chip;
    if (key === 'assessments') {
      chip = _btn('one-gone', n + ' not listed · Choose…', 'oneChoose', { part: key });
    } else {
      var scope = api.scope();
      var lists = _offLists(m, key, student.id);
      // Show puts back the rows this scope left off: the class's, or the
      // student's own. Rows the class left off can't come back for one student.
      var forSid = scope ? (lists.own.length ? scope : null) : lists.cls.length ? '' : student.id;
      if (forSid == null) {
        chip = _el('span', MINE + ' no-print one-gone one-gone-note', n + ' removed for the class');
      } else {
        chip = _btn('one-gone', n + ' removed · Show', 'oneShowRemoved', { part: key, for: forSid });
        chip.setAttribute(
          'aria-label',
          'Show the ' + n + ' removed ' + (n === 1 ? 'row' : 'rows') + ' in ' + _label(api, key),
        );
      }
    }
    if (h) h.appendChild(chip);
    else {
      chip.classList.add('one-gone-top');
      cell.appendChild(chip);
    }
  }

  /* A − button beside each row that can be left off, in the page's left
     margin (the sheet's body clips what overflows it). */
  function _rowButtons(cell, key) {
    var rows = cell.querySelectorAll('[data-row]');
    if (!rows.length) return;
    var sheet = cell.closest('.report-sheet');
    if (!sheet) return;
    var layer = null;
    _each(sheet.children, function (x) {
      if (x.classList.contains('one-rows')) layer = x;
    });
    if (!layer) {
      layer = _el('div', MINE + ' no-print one-rows');
      sheet.appendChild(layer);
    }
    var sr = _rect(sheet);
    var scale = sheet.offsetWidth ? sr.width / sheet.offsetWidth || 1 : 1;
    _each(rows, function (row) {
      var rowKey = row.getAttribute('data-row');
      var name = key === 'assessments' ? _rowName(row) : rowKey;
      var b = _btn('one-rm', '', 'oneRowOff', { part: key, row: rowKey });
      b.setAttribute('aria-label', 'Remove ' + name + ' from the report');
      b.setAttribute('title', 'Remove from the report');
      b.appendChild(_el('span', '', '−')).setAttribute('aria-hidden', 'true');
      var rr = _rect(row);
      // Positions in px to a tenth (Math.round: toFixed is kept for grades, in calc.js).
      b.style.top = Math.round(((rr.top - sr.top) / scale + rr.height / scale / 2) * 10) / 10 + 'px';
      b.style.left = Math.round(((rr.left - sr.left) / scale) * 10) / 10 + 'px';
      b._oneRow = row;
      row._oneBtn = b;
      layer.appendChild(b);
    });
  }
  function _rect(el) {
    return el.getBoundingClientRect ? el.getBoundingClientRect() : { top: 0, left: 0, width: 0, height: 0 };
  }
  function _rowName(row) {
    var t = row.querySelector('.gr-title');
    return ((t || row).textContent || '').replace(/\s+/g, ' ').trim();
  }

  function _addStrip(preview, api, m) {
    var off = ReportOne.offParts(m, api.cid, api.scope());
    if (!off.length) return;
    var strip = _el('div', MINE + ' no-print one-add');
    strip.setAttribute('role', 'group');
    strip.setAttribute('aria-label', 'Add to the report');
    strip.appendChild(_el('span', 'one-add-lbl', 'Add to the report'));
    off.forEach(function (k) {
      strip.appendChild(_btn('one-add-btn', '+ ' + _label(api, k), 'oneAddPart', { part: k }));
    });
    preview.appendChild(strip);
  }

  /* ── Pointer and keys on the page ──────────────────────────── */

  // Point to a part: it tints with its Hide pill. Point to a row: its −
  // shows; on the − itself the row tints red.
  function _onOver(e) {
    var preview = e.currentTarget;
    var t = e.target;
    if (!t.closest) return;
    var rm = t.closest('.one-rm');
    var row = rm ? rm._oneRow : t.closest('[data-row]');
    // In the margin beside the row last pointed to, on the way to its −:
    // that row stays the one whose − shows (only it takes the click, so a
    // short row's neighbour can't).
    if (!row && _hot && !t.closest('.sheet-cell') && _hot.closest('.report-sheet') === t.closest('.report-sheet'))
      row = _hot;
    var cell = row ? row.closest('.sheet-cell[data-part]') : t.closest('.sheet-cell[data-part]');
    var key = cell && cell.getAttribute('data-part');
    if (key === 'header') key = null;
    _each(preview.querySelectorAll('.one-hover'), function (x) {
      if (x.getAttribute('data-part') !== key) x.classList.remove('one-hover');
    });
    if (key)
      _cellsOf(preview, key).forEach(function (x) {
        x.classList.add('one-hover');
      });
    if (_hot && _hot !== row) {
      if (_hot._oneBtn) _hot._oneBtn.classList.remove('one-rm-on');
      _hot.classList.remove('one-row-hot');
    }
    _hot = row && row._oneBtn ? row : null;
    if (_hot) {
      _hot._oneBtn.classList.add('one-rm-on');
      _hot.classList.toggle('one-row-hot', !!rm);
    }
  }
  function _onLeave(e) {
    _each(e.currentTarget.querySelectorAll('.one-hover, .one-row-hot, .one-rm-on'), function (x) {
      x.classList.remove('one-hover', 'one-row-hot', 'one-rm-on');
    });
    _hot = null;
  }
  // A drag that starts on a control or a heading being renamed is not a
  // drag of the part.
  function _onPointerDown(e) {
    if (e.target.closest && e.target.closest('.' + MINE + ', [data-one-title][contenteditable]')) e.stopPropagation();
  }
  function _onDbl(e) {
    var h = e.target.closest ? e.target.closest('[data-one-title]') : null;
    if (h && !_renaming) {
      e.preventDefault();
      _rename(h);
    }
  }
  function _onKey(e) {
    var t = e.target;
    if (_renaming && t === _renaming.h) {
      // Every key belongs to the heading while it is renamed.
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        _endRename(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        _endRename(false);
      }
      return;
    }
    if (t.hasAttribute && t.hasAttribute('data-one-title')) {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        _rename(t);
      }
      return;
    }
    if (t.closest && t.closest('.' + MINE)) {
      if (/^(Delete|Backspace|ArrowUp|ArrowDown)$/.test(e.key)) e.stopPropagation();
      return;
    }
    // A part with focus: Delete hides it. The arrows don't move it (the
    // panel orders the parts).
    var cell = t.matches && t.matches('.sheet-cell[data-part]') ? t : null;
    var api = _api && _api();
    if (!cell || !api || api.view() !== 'one') return;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') e.stopPropagation();
    if ((e.key === 'Delete' || e.key === 'Backspace') && cell.getAttribute('data-part') !== 'header') {
      e.preventDefault();
      e.stopPropagation();
      _hide(api, cell.getAttribute('data-part'));
    }
  }

  /* ── Rename a heading ──────────────────────────────────────── */

  function _rename(h) {
    _each(h.querySelectorAll('.' + MINE), function (x) {
      x.parentNode.removeChild(x);
    });
    _renaming = { h: h, key: h.getAttribute('data-one-title'), old: h.textContent };
    h.setAttribute('contenteditable', 'true');
    h.setAttribute('role', 'textbox');
    h.setAttribute('aria-label', 'Heading');
    h.classList.add('one-editing');
    h.focus();
    if (window.getSelection && document.createRange) {
      var r = document.createRange();
      r.selectNodeContents(h);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    }
    h.addEventListener('blur', _onRenameBlur);
  }
  function _onRenameBlur() {
    if (_renaming) _endRename(true);
  }
  function _endRename(save) {
    var r = _renaming;
    if (!r) return;
    _renaming = null;
    var h = r.h;
    h.removeEventListener('blur', _onRenameBlur);
    h.removeAttribute('contenteditable');
    h.removeAttribute('role');
    h.removeAttribute('aria-label');
    h.classList.remove('one-editing');
    var bare = function (t) {
      return String(t || '')
        .replace(/\s+/g, ' ')
        .replace(/\s*\(continued\)$/, '')
        .trim();
    };
    var text = bare(h.textContent);
    var api = _api && _api();
    var refocus = function (preview) {
      var c = _cellsOf(preview, r.key)[0];
      var again = c && c.querySelector('[data-one-title]');
      _focus(again);
    };
    if (!api || !save || text === bare(r.old)) {
      h.textContent = r.old;
      var preview = h.closest('#rb-preview') || document.getElementById('rb-preview');
      if (api && preview) {
        _then = save ? null : refocus;
        _decorateMine(preview, api);
      }
      return;
    }
    _then = refocus;
    api.set(
      ReportOne.setTitle(api.model(), r.key, text),
      text ? 'Renamed ' + r.old.trim() + ' to ' + text : 'Put back the heading ' + _label(api, r.key),
    );
  }

  /* ── Actions on the page ───────────────────────────────────── */

  function _hide(api, key) {
    var preview = document.getElementById('rb-preview');
    var keys = preview
      ? _cells(preview)
          .map(function (c) {
            return c.getAttribute('data-part');
          })
          .filter(function (k, i, a) {
            return a.indexOf(k) === i;
          })
      : [];
    var next = keys[keys.indexOf(key) + 1] || keys[keys.indexOf(key) - 1];
    _then = function (p) {
      var c = next && _cellsOf(p, next)[0];
      _focus(c);
    };
    api.set(ReportOne.setOn(api.model(), key, false, api.scope()), 'Hid ' + _label(api, key));
    api.announce('Hid ' + _label(api, key) + '.');
  }

  function _rowOff(api, el) {
    var key = el.getAttribute('data-part');
    var rowKey = el.getAttribute('data-row');
    var row = el._oneRow;
    var name = key === 'assessments' && row ? _rowName(row) : rowKey;
    // Focus goes to the next row's −, else the one before, else the part.
    var preview = document.getElementById('rb-preview');
    var rows = [];
    if (preview)
      _cellsOf(preview, key).forEach(function (c) {
        _each(c.querySelectorAll('[data-row]'), function (r) {
          rows.push(r.getAttribute('data-row'));
        });
      });
    var at = rows.indexOf(rowKey);
    var next = rows[at + 1] != null ? rows[at + 1] : rows[at - 1];
    _then = function (p) {
      var target = null;
      _each(p.querySelectorAll('.one-rm'), function (b) {
        if (!target && b.getAttribute('data-part') === key && b.getAttribute('data-row') === next) target = b;
      });
      if (!target) target = _cellsOf(p, key)[0];
      if (target) {
        if (target._oneRow) target.classList.add('one-rm-on');
        _focus(target);
      }
    };
    var scope = api.scope();
    api.set(
      ReportOne.setRemoved(api.model(), key, rowKey, true, scope),
      'Removed ' + name + (scope ? ' for ' + _first(api.student()) : ' for everyone'),
    );
  }

  function _showRemoved(api, el) {
    var key = el.getAttribute('data-part');
    var forSid = el.getAttribute('data-for') || null;
    var m = api.model();
    var n = forSid ? _offLists(m, key, forSid).own.length : (m.removed[key] || []).length;
    _then = function (p) {
      var c = _cellsOf(p, key)[0];
      _focus(c);
    };
    api.set(
      ReportOne.setRemovedAll(m, key, [], forSid),
      'Put back ' +
        n +
        (n === 1 ? ' row' : ' rows') +
        ' in ' +
        _label(api, key) +
        (forSid ? ' for ' + _first(api.student()) : ' for everyone'),
    );
  }

  function _addPart(api, key) {
    var label = _label(api, key);
    _then = function (p) {
      var cells = _cellsOf(p, key);
      if (!cells.length) {
        api.announce(label + ' has nothing to print for ' + _first(api.student()) + '.');
        return;
      }
      if (cells[0].scrollIntoView)
        cells[0].scrollIntoView({ block: 'center', behavior: _reduced() ? 'auto' : 'smooth' });
      _focus(cells[0]);
      cells.forEach(function (c) {
        c.classList.add('one-pg-flash');
      });
      setTimeout(function () {
        cells.forEach(function (c) {
          c.classList.remove('one-pg-flash');
        });
      }, 1200);
    };
    api.set(ReportOne.setOn(api.model(), key, true, api.scope()), 'Added ' + label);
  }

  function handle(action, el, api, e) {
    switch (action) {
      case 'oneHide':
        _hide(api, el.getAttribute('data-part'));
        return true;
      case 'oneRowOff':
        _rowOff(api, el);
        return true;
      case 'oneShowRemoved':
        _showRemoved(api, el);
        return true;
      case 'oneAddPart':
        _addPart(api, el.getAttribute('data-part'));
        return true;
      case 'oneScopeClass':
        api.setScope(false);
        return true;
      case 'oneChoose':
        _openDialog(api, 'choose', 'assessments', el);
        return true;
      case 'oneWording':
        if (WORDED.indexOf(el.getAttribute('data-part')) < 0) return false;
        _openDialog(api, 'wording', el.getAttribute('data-part'), el);
        return true;
    }
    return !!(_comment() && _comment().handle(action, el, api, e));
  }

  function change() {
    return false;
  }

  /* ── Dialogs ───────────────────────────────────────────────── */

  function _openDialog(api, kind, key, opener) {
    if (_dlg) _closeDialog(false);
    var overlay = _el('div', MINE + ' no-print one-dlg-overlay');
    var card = _el('div', 'one-dlg one-dlg-' + kind);
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-labelledby', 'one-dlg-title');
    card.setAttribute('aria-describedby', 'one-dlg-sub');
    overlay.appendChild(card);
    _dlg = {
      kind: kind,
      key: key,
      overlay: overlay,
      card: card,
      opener: {
        el: opener,
        action: opener && opener.getAttribute ? opener.getAttribute('data-action') : '',
        part: opener && opener.getAttribute ? opener.getAttribute('data-part') || '' : '',
      },
      q: '',
      work: null,
      timer: null,
    };
    overlay.addEventListener('click', _onDlgClick);
    overlay.addEventListener('input', _onDlgInput);
    overlay.addEventListener('keydown', _onDlgKey);
    document.body.appendChild(overlay);
    if (kind === 'choose') _drawChoose(api, true);
    else {
      _dlg.work = ReportOne.wordingOf(api.model(), key);
      _drawWording(api);
    }
    var f = card.querySelector('input, textarea') || card.querySelector('button');
    if (f) f.focus();
  }

  function _closeDialog(focusBack) {
    var d = _dlg;
    if (!d) return;
    _flushWording();
    _dlg = null;
    if (d.overlay.parentNode) d.overlay.parentNode.removeChild(d.overlay);
    if (focusBack === false) return;
    var target = d.opener.el && d.opener.el.isConnected ? d.opener.el : null;
    if (!target && d.opener.action) {
      _each(document.querySelectorAll('[data-action="' + d.opener.action + '"]'), function (x) {
        if (!target && (x.getAttribute('data-part') || '') === d.opener.part) target = x;
      });
    }
    if (target && target.focus) target.focus();
  }

  function _refreshDialog(api) {
    if (!_dlg) return;
    if (_dlg.kind === 'choose') _drawChoose(api, false);
    else _drawReset(api);
  }

  /* Keeps Tab inside the dialog (as page-reports.js _trapTab). */
  function _trapTab(e, box) {
    var items = Array.prototype.slice
      .call(box.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea, [tabindex="0"]'))
      .filter(function (x) {
        return !x.hidden && x.offsetParent !== null;
      });
    if (!items.length) return;
    var first = items[0];
    var last = items[items.length - 1];
    var at = document.activeElement;
    if (!box.contains(at)) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    } else if (e.shiftKey && at === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && at === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function _onDlgKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      _closeDialog();
    } else if (e.key === 'Tab' && _dlg) _trapTab(e, _dlg.card);
  }

  function _onDlgClick(e) {
    var api = _api && _api();
    if (!_dlg || !api) return;
    if (e.target === _dlg.overlay) {
      _closeDialog();
      return;
    }
    var b = e.target.closest ? e.target.closest('[data-one]') : null;
    if (!b || b.disabled) return;
    var what = b.getAttribute('data-one');
    if (what === 'close') _closeDialog();
    else if (_dlg.kind === 'choose') _chooseClick(api, what, b);
    else _wordingClick(api, what, b);
  }

  function _onDlgInput(e) {
    var api = _api && _api();
    if (!_dlg || !api) return;
    var t = e.target;
    if (_dlg.kind === 'choose' && t.getAttribute('data-one') === 'search') {
      _dlg.q = t.value;
      _drawChoose(api, false);
    } else if (_dlg.kind === 'wording' && t.hasAttribute('data-f')) {
      _wordingInput(api, t);
    }
  }

  /* ── Choose Assessments ────────────────────────────────────── */

  function _chooseRows(api) {
    var student = api.student();
    if (!student) return [];
    var m = api.model();
    var lists = _offLists(m, 'assessments', student.id);
    return ReportOne.rowsOf(m, 'assessments', api.cid, student, api.ctx()).map(function (r) {
      r.classOff = lists.cls.indexOf(r.key) >= 0;
      r.ownOff = lists.own.indexOf(r.key) >= 0;
      return r;
    });
  }

  function _drawChoose(api, whole) {
    var d = _dlg;
    var scope = api.scope();
    var first = _first(api.student());
    var rows = _chooseRows(api);
    var listed = rows.filter(function (r) {
      return !r.removed;
    }).length;
    var sub = listed + ' of ' + rows.length + ' listed ' + (scope ? 'for ' + first : 'for the class');
    if (whole) {
      // html-safe: fixed markup; sub is esc()'d
      d.card.innerHTML =
        '<div class="one-dlg-head"><div><h2 id="one-dlg-title">Choose Assessments</h2><p id="one-dlg-sub">' +
        esc(sub) +
        '</p></div><button type="button" class="one-dlg-done" data-one="close">Done</button></div>' +
        '<input type="search" class="one-dlg-search" data-one="search" placeholder="Search Assessments" aria-label="Search assessments">' +
        '<div class="one-dlg-quick"><span class="one-dlg-lbl">Turn On Only:</span>' +
        '<button type="button" class="one-dlg-act" data-one="all">Everything</button>' +
        '<button type="button" class="one-dlg-act" data-one="none">Turn All Off</button></div>' +
        '<div class="one-dlg-list" data-one-list></div>' +
        '<p class="one-dlg-foot">Missing Work always lists missing pieces, whatever is chosen here.</p>';
    } else {
      d.card.querySelector('#one-dlg-sub').textContent = sub;
    }
    var list = d.card.querySelector('[data-one-list]');
    var scrollTop = list.scrollTop;
    var active = document.activeElement;
    var focusKey = active && list.contains(active) ? active.getAttribute('data-key') : null;
    var q = d.q.trim().toLowerCase();
    var vis = rows.filter(function (r) {
      return !q || (r.label + ' ' + (r.sub || '')).toLowerCase().indexOf(q) >= 0;
    });
    // html-safe: every value through esc()
    list.innerHTML = vis.length
      ? vis
          .map(function (r) {
            var on = !r.removed;
            var locked = scope ? r.classOff : r.ownOff && !r.classOff;
            var why = locked ? (scope ? 'Left off for the class' : 'Left off for ' + first + ' only') : '';
            return (
              '<button type="button" class="one-pick' +
              (on ? ' on' : '') +
              '" role="switch" aria-checked="' +
              on +
              '" data-one="row" data-key="' +
              esc(r.key) +
              '"' +
              (locked ? ' disabled' : '') +
              '><span class="one-pick-t"><b>' +
              esc(r.label) +
              '</b><span>' +
              esc([r.sub, why].filter(Boolean).join(' · ')) +
              '</span></span><span class="one-pick-r' +
              (r.missing ? ' ms' : '') +
              '">' +
              esc(r.result || '') +
              '</span><span class="one-pick-sw" aria-hidden="true"><i></i></span></button>'
            );
          })
          .join('')
      : '<p class="one-dlg-empty">' + (rows.length ? 'Nothing matches.' : 'No assessments yet.') + '</p>';
    list.scrollTop = scrollTop;
    if (focusKey != null) {
      var again = null;
      _each(list.querySelectorAll('[data-key]'), function (x) {
        if (!again && x.getAttribute('data-key') === focusKey) again = x;
      });
      if (again) again.focus({ preventScroll: true });
    }
  }

  function _chooseClick(api, what, b) {
    var scope = api.scope();
    var first = _first(api.student());
    var rows = _chooseRows(api);
    var m = api.model();
    var K = 'assessments';
    if (what === 'row') {
      var r = rows.filter(function (x) {
        return x.key === b.getAttribute('data-key');
      })[0];
      if (!r) return;
      var turnOn = r.removed;
      api.set(
        ReportOne.setRemoved(m, K, r.key, !turnOn, scope),
        (turnOn ? 'Listed ' : 'Left off ') + r.label + (scope ? ' for ' + first : ' for everyone'),
      );
      _drawChoose(api, false);
      return;
    }
    if (what !== 'all' && what !== 'none') return;
    var lists = _offLists(m, K, scope || (api.student() && api.student().id));
    var n;
    var next;
    if (what === 'all') {
      n = rows.filter(function (x) {
        return scope ? x.ownOff : x.classOff;
      }).length;
      next = [];
    } else {
      var have = scope ? lists.own.concat(lists.cls) : lists.cls;
      var keys = [];
      var take = function (list) {
        list.forEach(function (x) {
          if (have.indexOf(x.key) < 0 && keys.indexOf(x.key) < 0) keys.push(x.key);
        });
      };
      // For one student, that student's list; for the class, every
      // student's (one may list work another has no mark for).
      if (scope) take(rows);
      else
        api.students().forEach(function (st) {
          take(ReportOne.rowsOf(m, K, api.cid, st, api.ctx()));
        });
      n = keys.length;
      next = (scope ? lists.own : lists.cls).concat(keys);
    }
    if (!n) {
      api.announce('Nothing changed.');
      return;
    }
    api.set(
      ReportOne.setRemovedAll(m, K, next, scope),
      'Changed ' +
        n +
        (n === 1 ? ' assessment' : ' assessments') +
        ' ' +
        (scope ? 'for ' + first : 'for all ' + api.students().length + ' students'),
    );
    _drawChoose(api, false);
  }

  /* ── Edit Questions / Edit Wording ─────────────────────────── */

  var FIELD = {
    title: 'Heading',
    intro: 'Instructions',
    scale: 'Scale',
    items: 'Rate Each',
    checkHead: 'Check List Heading',
    checks: 'Check Any That Apply',
    fields: 'Lines to Fill In',
    open: 'Write About',
  };
  var ADD = {
    items: 'Add a Statement',
    checks: 'Add an Item',
    fields: 'Add a Line',
    open: 'Add a Question',
  };
  function _fieldLabel(key, f) {
    if (key === 'parent-response' && f === 'checks') return 'Tick Boxes';
    if (key === 'parent-response' && f === 'open') return 'Write-In Boxes';
    return FIELD[f] || f;
  }
  function _addLabel(key, f) {
    if (key === 'parent-response' && f === 'open') return 'Add a Box';
    return ADD[f] || 'Add';
  }

  function _drawWording(api) {
    var d = _dlg;
    var key = d.key;
    var w = d.work || {};
    var html =
      '<div class="one-dlg-head"><div><h2 id="one-dlg-title">' +
      (key === 'parent-response' ? 'Edit Wording' : 'Edit Questions') +
      '</h2><p id="one-dlg-sub">' +
      esc(_label(api, key)) +
      '. This wording is for this class only.</p></div>' +
      '<button type="button" class="one-dlg-done" data-one="close">Done</button></div><div class="one-ed">';
    Object.keys(w).forEach(function (f) {
      var label = _fieldLabel(key, f);
      var v = w[f];
      var id = 'one-ed-' + f;
      if (typeof v === 'string') {
        if (f === 'intro') {
          html +=
            '<label class="one-ed-lbl" for="' +
            id +
            '">' +
            esc(label) +
            ' <span>{name} prints the student’s first name, {teacher} your name.</span></label>' +
            '<textarea class="one-ed-one" id="' +
            id +
            '" rows="3" data-f="intro">' +
            esc(v) +
            '</textarea>';
        } else {
          html +=
            '<label class="one-ed-lbl" for="' +
            id +
            '">' +
            esc(label) +
            '</label><input class="one-ed-one" id="' +
            id +
            '" data-f="' +
            esc(f) +
            '" value="' +
            esc(v) +
            '">';
        }
        return;
      }
      if (!Array.isArray(v)) return;
      html += '<div class="one-ed-lbl" id="' + id + '">' + esc(label) + '</div>';
      if (f === 'scale') {
        // The scale keeps its four columns: each word can change.
        html +=
          '<div class="one-ed-scale" role="group" aria-labelledby="' +
          id +
          '">' +
          v
            .map(function (x, i) {
              return (
                '<input data-f="scale" data-i="' +
                i +
                '" aria-label="Scale word ' +
                (i + 1) +
                '" value="' +
                esc(x) +
                '">'
              );
            })
            .join('') +
          '</div>';
        return;
      }
      html +=
        '<div class="one-ed-list" role="group" aria-labelledby="' +
        id +
        '">' +
        v
          .map(function (x, i) {
            var n = label + ' ' + (i + 1);
            var obj = x && typeof x === 'object';
            return (
              '<div class="one-ed-item' +
              (obj ? ' two' : '') +
              '"><div class="one-ed-ins"><input data-f="' +
              esc(f) +
              '" data-i="' +
              i +
              '"' +
              (obj ? ' data-sub="label"' : '') +
              ' aria-label="' +
              esc(n) +
              '" value="' +
              esc(obj ? x.label || '' : x) +
              '">' +
              (obj
                ? '<input class="one-ed-prompt" data-f="' +
                  esc(f) +
                  '" data-i="' +
                  i +
                  '" data-sub="prompt" aria-label="' +
                  esc(n) +
                  ', the line under it" placeholder="The line under it" value="' +
                  esc(x.prompt || '') +
                  '">'
                : '') +
              '</div><button type="button" class="one-ed-x" data-one="del" data-f="' +
              esc(f) +
              '" data-i="' +
              i +
              '" aria-label="Remove ' +
              esc(n) +
              '" title="Remove">×</button></div>'
            );
          })
          .join('') +
        '<button type="button" class="one-ed-add" data-one="add" data-f="' +
        esc(f) +
        '">+ ' +
        esc(_addLabel(key, f)) +
        '</button></div>';
    });
    html += '<div class="one-ed-reset" data-one-reset></div></div>';
    // html-safe: every value through esc(); labels are this file's own
    d.card.innerHTML = html;
    _drawReset(api);
  }

  function _drawReset(api) {
    var slot = _dlg && _dlg.card.querySelector('[data-one-reset]');
    if (!slot) return;
    var m = api.model();
    var changed = !!(m.wording && m.wording[_dlg.key]);
    var has = !!slot.querySelector('button');
    if (changed === has) return;
    slot.textContent = '';
    if (changed) {
      var b = _el('button', 'one-ed-resetbtn', 'Reset to Original Wording');
      b.type = 'button';
      b.setAttribute('data-one', 'reset');
      slot.appendChild(b);
    }
  }

  function _wordingInput(api, t) {
    var w = _dlg.work;
    var f = t.getAttribute('data-f');
    var i = t.getAttribute('data-i');
    if (i == null) w[f] = t.value;
    else {
      var sub = t.getAttribute('data-sub');
      if (sub) {
        var item = Object.assign({}, w[f][+i]);
        item[sub] = t.value;
        w[f][+i] = item;
      } else w[f][+i] = t.value;
    }
    _scheduleSave(api);
  }
  function _scheduleSave(api) {
    if (_dlg.timer) clearTimeout(_dlg.timer);
    var key = _dlg.key;
    _dlg.timer = setTimeout(function () {
      if (_dlg && _dlg.key === key) {
        _dlg.timer = null;
        _saveWording(api);
      }
    }, 300);
  }
  function _flushWording() {
    if (!_dlg || _dlg.kind !== 'wording' || !_dlg.timer) return;
    clearTimeout(_dlg.timer);
    _dlg.timer = null;
    var api = _api && _api();
    if (api) _saveWording(api);
  }
  /* What is saved: blank lines left out, a blank heading or instructions
     print the original. The original wording saved is no wording. */
  function _clean(w) {
    var out = {};
    Object.keys(w || {}).forEach(function (f) {
      var v = w[f];
      if (typeof v === 'string') {
        if (v.trim()) out[f] = v;
      } else if (Array.isArray(v)) {
        out[f] = v.filter(function (x) {
          return x && typeof x === 'object' ? String(x.label || '').trim() : String(x || '').trim();
        });
      } else out[f] = v;
    });
    return out;
  }
  function _saveWording(api) {
    var key = _dlg.key;
    var m = api.model();
    var w = _clean(_dlg.work);
    var same = JSON.stringify(w) === JSON.stringify(_clean(ReportBlocks.wordingOf(key)));
    var cur = (m.wording && m.wording[key]) || null;
    if (same ? !cur : JSON.stringify(cur) === JSON.stringify(w)) return;
    api.set(ReportOne.setWording(m, key, same ? null : w));
  }

  function _wordingClick(api, what, b) {
    var d = _dlg;
    var f = b.getAttribute('data-f');
    var focusSel = null;
    if (what === 'add') {
      var list = d.work[f];
      var last = list[list.length - 1];
      var objs = list.some(function (x) {
        return x && typeof x === 'object';
      });
      list.push(objs ? { label: '', prompt: '', group: last && last.group } : '');
      focusSel = { f: f, i: list.length - 1 };
    } else if (what === 'del') {
      var i = +b.getAttribute('data-i');
      d.work[f].splice(i, 1);
      _flushNow(api);
      focusSel = { f: f, i: Math.min(i, d.work[f].length - 1), del: true };
    } else if (what === 'reset') {
      if (d.timer) clearTimeout(d.timer);
      d.timer = null;
      api.set(ReportOne.setWording(api.model(), d.key, null), 'Put back the original wording');
      if (!_dlg) return;
      d.work = ReportOne.wordingOf(api.model(), d.key);
      focusSel = { first: true };
    } else return;
    _drawWording(api);
    var target = null;
    if (focusSel.first) target = d.card.querySelector('[data-f]');
    else if (focusSel.i >= 0)
      _each(d.card.querySelectorAll(focusSel.del ? '[data-one="del"]' : 'input[data-f]'), function (x) {
        if (!target && x.getAttribute('data-f') === focusSel.f && x.getAttribute('data-i') === String(focusSel.i))
          target = x;
      });
    if (!target)
      _each(d.card.querySelectorAll('[data-one="add"]'), function (x) {
        if (!target && x.getAttribute('data-f') === focusSel.f) target = x;
      });
    if (target) target.focus();
  }
  function _flushNow(api) {
    if (_dlg.timer) clearTimeout(_dlg.timer);
    _dlg.timer = null;
    _saveWording(api);
  }

  /* Print Reports asks this first; false stops the print (a comment with
     unsaved changes is saved or discarded first). */
  function beforePrint(api) {
    _flushWording();
    if (_renaming) _endRename(true);
    return _comment() ? _comment().beforePrint(api) : true;
  }

  return { mount: mount, decorate: decorate, handle: handle, change: change, beforePrint: beforePrint };
})();
