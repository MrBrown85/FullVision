/* report-one-panel.js — One Report's panel: the Setup, who a change
   applies to, the parts on the report in print order (a switch each, drag
   the icon to reorder, options under the name), the Feedback Pages and Add
   a Part. It reads and changes the model only through ReportOne and the
   api page-reports.js gives it (_oneApi). The design is the One Report
   section of docs/plans/quick-report-options-mockup.html;
   docs/plans/one-report-build-plan.md.

   page-reports.js calls mount(palette, apiFn) each time the screen is
   built, render(palette, api) on every redraw, handle(action, el, api, e)
   for a click on a [data-action="one…"], change(action, el, api) for a
   change event the same way, and fitHtml(api) for the line over the pages.
   Which options are open, which sections are folded and whether the Setup
   menu is open are this module's own, kept across redraws. */
window.ReportOnePanel = (function () {
  'use strict';

  var _apiFn = null; // () => api, set at mount
  var _palette = null;
  var _open = {}; // parts whose options are open
  var _fold = { add: true }; // sections folded shut: on, fb, add
  var _menu = false; // the Setup menu is open
  var _focusAfter = null; // a selector to focus once the panel is redrawn
  var _drag = null; // a pointer drag in progress
  var _owed = false; // a redraw asked for during the drag
  var _lit = null; // the part lit on the page while a row is pointed to
  var _docBound = false;
  var GLIDE = 200; // ms

  /* ── Icons ─────────────────────────────────────────────────── */

  var IC = {
    head: '<rect x="2.5" y="3" width="11" height="10" rx="1.5"/><path d="M2.5 6.5h11"/>',
    prof: '<path d="M3 5h3M3 8h3M3 11h3"/><circle cx="9" cy="5" r=".9"/><circle cx="11.5" cy="5" r=".9"/><circle cx="9" cy="8" r=".9"/><circle cx="9" cy="11" r=".9"/><circle cx="11.5" cy="11" r=".9"/>',
    legend: '<circle cx="4" cy="8" r="1.4"/><circle cx="8" cy="8" r="1.4"/><circle cx="12" cy="8" r="1.4"/>',
    list: '<path d="M3 4h10M3 8h10M3 12h10"/>',
    sum: '<rect x="2.5" y="3" width="11" height="10" rx="1.5"/><path d="M2.5 7h11M7 3v10"/>',
    grade: '<circle cx="8" cy="8" r="5.5"/><circle cx="8" cy="8" r="2"/>',
    miss: '<circle cx="8" cy="8" r="5.5"/><path d="M8 5v3.5M8 11v.01"/>',
    att: '<rect x="2.5" y="3.5" width="11" height="10" rx="1.5"/><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3"/>',
    prog: '<path d="M2.5 12l3.5-3.5 2.5 2 5-5.5"/>',
    next: '<path d="M3 8h9M9 4.5L12.5 8 9 11.5"/>',
    com: '<path d="M3 3.5h10v7H7.5L4.5 13v-2.5H3z"/>',
    habit: '<circle cx="8" cy="8" r="5.5"/><path d="M8 5v3l2 1.5"/>',
    cc: '<circle cx="8" cy="5.5" r="2.5"/><path d="M3.5 13.5c.8-2.6 2.5-3.8 4.5-3.8s3.7 1.2 4.5 3.8"/>',
    refl: '<path d="M3 13l1-3 7-7 2 2-7 7z"/>',
    home: '<path d="M2.5 7.5L8 3l5.5 4.5M4 6.5v6.5h8V6.5"/>',
    resp: '<path d="M2.5 9.5h11" stroke-dasharray="1.5 1.5"/><rect x="3.5" y="3" width="9" height="4" rx="1"/><path d="M4 12h8"/>',
    text: '<path d="M3.5 4h9M8 4v9"/>',
    rub: '<rect x="2.5" y="3" width="11" height="10" rx="1.5"/><path d="M2.5 8h11M6.2 3v10M9.8 3v10"/>',
    acom: '<path d="M3 3.5h10v7H7.5L4.5 13v-2.5H3z"/><path d="M5.5 6.5h5"/>',
    obs: '<rect x="3.5" y="2.5" width="9" height="11" rx="1.5"/><path d="M6 6h4M6 9h4"/>',
    part: '<rect x="3" y="2.5" width="10" height="11" rx="1.5"/><path d="M5.5 6h5M5.5 9h3"/>',
  };
  var ICON_OF = {
    header: 'head',
    proficiency: 'prof',
    legend: 'legend',
    assessments: 'list',
    'category-summary': 'sum',
    'course-grade': 'grade',
    'grade-table': 'sum',
    'missing-work': 'miss',
    'term-attendance': 'att',
    progress: 'prog',
    'next-steps': 'next',
    'teacher-narrative': 'com',
    'self-assessment': 'cc',
    'learner-dimensions': 'habit',
    'student-reflection-learning': 'refl',
    'student-reflection-habits': 'refl',
    'support-home': 'home',
    'text-block': 'text',
    'parent-response': 'resp',
    'fb-rubrics': 'rub',
    'fb-comments': 'acom',
    'fb-observations': 'obs',
  };
  function _icon(key) {
    return '<svg class="one-gi" viewBox="0 0 16 16" aria-hidden="true">' + IC[ICON_OF[key] || 'part'] + '</svg>';
  }

  /* ── Small readers ─────────────────────────────────────────── */

  function _first(st) {
    if (!st) return '';
    return typeof displayNameFirst === 'function' ? displayNameFirst(st) : st.firstName || '';
  }
  function _n(n, one, many) {
    return n + ' ' + (n === 1 ? one : many);
  }
  function _isFb(key) {
    return ReportOne.FEEDBACK.some(function (f) {
      return f.key === key;
    });
  }
  function _reduced() {
    try {
      return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) {
      return false;
    }
  }
  /* The student on the canvas, in One Student view only. */
  function _canvas(api) {
    return api.view() === 'one' ? api.student() || null : null;
  }
  /* Does a part open options under its name. */
  function _hasOpts(m, key, cid) {
    if (_isFb(key)) return false;
    var d = ReportOne.PARTS[key];
    if (key === 'assessments' || (d && d.wording)) return true;
    return ReportOne.optionsFor(m, key, cid).length > 0;
  }
  /* A part that can be dragged: on for the class, not the letterhead or
     the response. */
  function _draggable(m, key) {
    return ReportOne.canMove(key) && m.parts.indexOf(key) >= 0;
  }
  /* Was the part changed for this student only. */
  function _mine(m, key, sid) {
    var p = sid && m.perStudent[sid];
    if (!p) return false;
    return p.on.indexOf(key) >= 0 || p.off.indexOf(key) >= 0 || !!(p.removed[key] && p.removed[key].length);
  }
  function _setupOf(m) {
    return ReportOne.SETUPS.filter(function (s) {
      return s.id === m.setup;
    })[0];
  }

  /* ── Drawing ───────────────────────────────────────────────── */

  /* The small line under a part's name. */
  function _subHtml(m, key, api, on, c) {
    if (key === 'teacher-narrative' && on) {
      var fit = api.fit();
      var none = fit && fit.noComment ? fit.noComment.length : 0;
      if (none)
        return (
          '<div class="one-sub warn">' +
          (none === 1 ? '1 student has' : none + ' students have') +
          ' none · <button type="button" class="one-link" data-action="oneWriteThem">Write Them</button></div>'
        );
    }
    var bits = [];
    var p = c.csid && m.perStudent[c.csid];
    if (p && p.on.indexOf(key) >= 0) bits.push('For ' + c.first + ' only');
    if (p && p.off.indexOf(key) >= 0 && !c.sid) bits.push('Off for ' + c.first);
    if (on && !_isFb(key)) {
      var gone = ReportOne.removedOf(m, key, c.csid).length;
      if (gone)
        bits.push(
          key === 'assessments'
            ? _n(gone, 'assessment left off', 'assessments left off')
            : _n(gone, 'row left off', 'rows left off'),
        );
    }
    if (m.titles[key]) bits.push('Prints as “' + m.titles[key] + '”');
    if (m.wording[key]) bits.push('Your wording');
    if (key === ReportOne.PINNED && on) bits.push('At the foot of the last page');
    if (key === 'proficiency' && on && ReportOne.isOn(m, 'course-grade', c.sid))
      bits.push('Overall prints under ' + ReportOne.label('course-grade', api.cid));
    return bits.length ? '<div class="one-sub">' + esc(bits.join(' · ')) + '</div>' : '';
  }

  /* A part's options, under its row. */
  function _optsHtml(m, key, api, open) {
    var list = ReportOne.optionsFor(m, key, api.cid);
    var d = ReportOne.PARTS[key] || {};
    var h =
      '<div class="one-opts' +
      (open ? ' open settled' : '') +
      '" id="one-opts-' +
      esc(key) +
      '"><div class="one-opts-in">';
    var chips = [];
    var flush = function () {
      if (chips.length) h += '<div class="one-chips">' + chips.join('') + '</div>';
      chips = [];
    };
    list.forEach(function (o) {
      var base = ' data-part="' + esc(key) + '" data-opt="' + esc(o.key) + '"';
      var lid = 'one-o-' + esc(key) + '-' + esc(o.key);
      if (o.kind === 'toggle') {
        chips.push(
          '<button type="button" class="one-chip" data-action="oneOpt"' +
            base +
            ' aria-pressed="' +
            !!o.value +
            '">' +
            esc(o.label) +
            '</button>',
        );
        return;
      }
      flush();
      if (o.kind === 'choice') {
        h +=
          '<div class="one-o-row"><span class="one-o-lbl" id="' +
          lid +
          '">' +
          esc(o.label) +
          '</span><div class="seg seg-sm one-o-seg" role="radiogroup" aria-labelledby="' +
          lid +
          '">' +
          o.choices
            .map(function (ch, i) {
              return (
                '<button type="button" class="seg-btn" role="radio" aria-checked="' +
                (ch.v === o.value) +
                '" data-action="oneOptChoice"' +
                base +
                ' data-value="' +
                i +
                '">' +
                esc(ch.label) +
                '</button>'
              );
            })
            .join('') +
          '</div></div>';
      } else if (o.kind === 'text') {
        h +=
          '<div class="one-o-row"><label class="one-o-lbl" for="' +
          lid +
          '">' +
          esc(o.label) +
          '</label>' +
          (o.long
            ? '<textarea class="one-o-text" id="' +
              lid +
              '" rows="4" data-action="oneOptText"' +
              base +
              '>' +
              esc(o.value) +
              '</textarea>'
            : '<input type="text" class="one-o-text" id="' +
              lid +
              '" data-action="oneOptText"' +
              base +
              ' value="' +
              esc(o.value) +
              '">') +
          '</div>';
      } else if (o.kind === 'lines') {
        var v = Number(o.value) || 0;
        var lo = o.min != null ? o.min : 0;
        var hi = o.max != null ? o.max : 40;
        h +=
          '<div class="one-o-row one-o-lines"><span class="one-o-lbl" id="' +
          lid +
          '">' +
          esc(o.label) +
          '</span><div class="one-step" role="group" aria-labelledby="' +
          lid +
          '"><button type="button" class="one-step-btn" data-action="oneLines"' +
          base +
          ' data-value="-1" aria-label="Fewer Lines"' +
          (v <= lo ? ' aria-disabled="true"' : '') +
          '>−</button><span class="one-step-n" aria-live="polite">' +
          v +
          '</span><button type="button" class="one-step-btn" data-action="oneLines"' +
          base +
          ' data-value="1" aria-label="More Lines"' +
          (v >= hi ? ' aria-disabled="true"' : '') +
          '>+</button></div></div>';
      }
    });
    flush();
    if (key === 'assessments')
      h +=
        '<button type="button" class="one-o-action" data-action="oneChoose" data-part="assessments">Choose Assessments…</button>';
    if (d.wording)
      h +=
        '<button type="button" class="one-o-action" data-action="oneWording" data-part="' +
        esc(key) +
        '">' +
        (key === 'parent-response' ? 'Edit Wording…' : 'Edit Questions…') +
        '</button>';
    return h + '</div></div>';
  }

  /* One part's row. c: { list: 'on' | 'fb' | 'add', on, sid, csid, first }. */
  function _rowHtml(m, key, api, c) {
    var label = ReportOne.label(key, api.cid);
    var on = c.on;
    var drag = c.list === 'on' && _draggable(m, key);
    var pinned = c.list === 'on' && key === ReportOne.PINNED;
    var opts = c.list !== 'add' && on && _hasOpts(m, key, api.cid);
    var open = opts && !!_open[key];
    var k = esc(key);
    var h =
      '<div class="one-item' +
      (drag ? ' can-drag' : '') +
      (open ? ' is-open' : '') +
      '" data-part="' +
      k +
      '"><div class="one-row' +
      (on ? ' on' : '') +
      (pinned ? ' pinned' : '') +
      '">';
    if (c.csid && _mine(m, key, c.csid))
      h += '<span class="one-mine" title="' + esc('Changed for ' + c.first + ' only') + '"></span>';
    h += '<span class="one-grip" aria-hidden="true">' + (drag ? '⋮⋮' : '') + '</span>';
    h += drag
      ? '<span class="one-tint" role="button" tabindex="0" data-action="oneDrag" data-part="' +
        k +
        '" aria-label="' +
        esc('Move ' + label + '. Use the up and down arrow keys.') +
        '" title="Drag up or down to move it">' +
        _icon(key) +
        '</span>'
      : '<span class="one-tint" aria-hidden="true">' + _icon(key) + '</span>';
    h +=
      '<div class="one-main"><button type="button" class="one-name" data-action="' +
      (c.list === 'add' ? 'oneAdd' : 'oneOpen') +
      '" data-part="' +
      k +
      '"' +
      (opts
        ? ' aria-expanded="' + open + '" aria-controls="one-opts-' + k + '"'
        : ' title="' + (c.list === 'add' ? 'Add it to the report' : 'Show it on the page') + '"') +
      '><span class="one-label">' +
      esc(label) +
      '</span>' +
      (opts ? '<span class="one-chev" aria-hidden="true">›</span>' : '') +
      '</button>' +
      _subHtml(m, key, api, on, c) +
      '</div>';
    if (key !== 'header')
      h +=
        '<button type="button" class="one-sw" role="switch" aria-checked="' +
        on +
        '" aria-label="' +
        esc(label) +
        '" data-action="oneSwitch" data-part="' +
        k +
        '"><i></i></button>';
    h += '</div>';
    if (opts) h += _optsHtml(m, key, api, open);
    return h + '</div>';
  }

  /* A section's heading, a button that folds it, and the start of its body. */
  function _secOpen(id, title, aside) {
    var open = !_fold[id];
    return (
      '<button type="button" class="one-sec-h" data-action="oneFold" data-value="' +
      id +
      '" aria-expanded="' +
      open +
      '" aria-controls="one-sec-' +
      id +
      '"><span class="one-sec-chev" aria-hidden="true">›</span>' +
      title +
      '<span class="one-aside">' +
      esc(aside) +
      '</span></button><div class="one-fold' +
      (open ? ' open settled' : '') +
      '" id="one-sec-' +
      id +
      '"><div class="one-fold-in">'
    );
  }

  function _setupHtml(m) {
    var cur = _setupOf(m);
    return (
      '<div class="one-setup"><button type="button" class="one-setup-btn" data-action="oneSetupMenu" aria-haspopup="true" aria-expanded="' +
      _menu +
      '" aria-controls="one-setup-menu"><span class="one-setup-k">Setup</span><span class="one-setup-name">' +
      esc(cur ? cur.name : 'Your Setup') +
      '</span><span class="one-setup-chev" aria-hidden="true">▾</span></button>' +
      '<div class="one-setup-menu" id="one-setup-menu" role="menu" aria-label="Setups"' +
      (_menu ? '' : ' hidden') +
      '>' +
      ReportOne.SETUPS.map(function (s) {
        return (
          '<button type="button" class="one-setup-item" role="menuitemradio" aria-checked="' +
          (!!cur && cur.id === s.id) +
          '" data-action="oneSetup" data-value="' +
          esc(s.id) +
          '">' +
          esc(s.name) +
          '<span>' +
          esc(s.blurb) +
          '</span></button>'
        );
      }).join('') +
      '</div></div>'
    );
  }

  function _appliesToHtml(m, c) {
    var seg = function (value, text, on) {
      return (
        '<button type="button" class="seg-btn" role="radio" aria-checked="' +
        on +
        '" data-action="oneScope" data-value="' +
        value +
        '">' +
        esc(text) +
        '</button>'
      );
    };
    var h =
      '<div class="one-scope-row"><span class="one-scope-lbl" id="one-scope-lbl">Changes Apply To</span>' +
      '<div class="seg seg-sm one-scope" role="radiogroup" aria-labelledby="one-scope-lbl">' +
      seg('class', 'Class', !c.sid) +
      (c.csid ? seg('student', c.first, !!c.sid) : '') +
      '</div></div>';
    var n = c.csid ? ReportOne.exceptions(m, c.csid) : 0;
    if (n)
      h +=
        '<div class="one-scope-note"><span class="one-dot" aria-hidden="true">●</span> ' +
        esc(_n(n, 'change', 'changes') + ' for ' + c.first + ' only') +
        ' · <button type="button" class="one-link" data-action="oneUseClass">Use Class Setting</button></div>';
    return h;
  }

  function panelHtml(api) {
    var m = api.model();
    var cid = api.cid;
    var st = _canvas(api);
    var c = { sid: api.scope(), csid: st ? st.id : null, first: _first(st) };
    var h = '<div class="one-panel">' + _setupHtml(m) + _appliesToHtml(m, c);

    var on = ReportOne.order(m, c.sid).filter(function (k) {
      return ReportOne.available(k, cid);
    });
    h += _secOpen('on', 'On the Report', _n(on.length, 'part', 'parts')) + '<div class="one-card one-onlist">';
    on.forEach(function (k) {
      h += _rowHtml(m, k, api, { list: 'on', on: true, sid: c.sid, csid: c.csid, first: c.first });
    });
    h += '</div></div></div>';

    var fbOn = ReportOne.FEEDBACK.filter(function (f) {
      return ReportOne.isOn(m, f.key);
    }).length;
    h += _secOpen('fb', 'Feedback Pages', fbOn ? fbOn + ' on' : 'None') + '<div class="one-card">';
    ReportOne.FEEDBACK.forEach(function (f) {
      h += _rowHtml(m, f.key, api, {
        list: 'fb',
        on: ReportOne.isOn(m, f.key),
        sid: c.sid,
        csid: c.csid,
        first: c.first,
      });
    });
    h += '</div></div></div>';

    var off = ReportOne.offParts(m, cid, c.sid);
    h += _secOpen('add', 'Add a Part', off.length ? off.length + ' more' : 'None');
    if (!off.length) h += '<div class="one-empty">Every part is on the report.</div>';
    ReportOne.GROUPS.forEach(function (g, gi) {
      var keys = off.filter(function (k) {
        return ReportOne.groupOf(k) === gi;
      });
      if (!keys.length) return;
      h += '<div class="one-group">' + esc(g) + '</div><div class="one-card">';
      keys.forEach(function (k) {
        h += _rowHtml(m, k, api, { list: 'add', on: false, sid: c.sid, csid: c.csid, first: c.first });
      });
      h += '</div>';
    });
    h += '</div></div></div>';
    return h;
  }

  /* ── Gliding (FLIP) ────────────────────────────────────────── */

  function _items(root) {
    return root && root.querySelectorAll
      ? Array.prototype.slice.call(root.querySelectorAll('.one-onlist > .one-item'))
      : [];
  }
  function _tops(root) {
    var out = {};
    _items(root).forEach(function (el) {
      out[el.dataset.part] = el.offsetTop;
    });
    return out;
  }
  /* Each row that moved slides from where it was to where it is. */
  function _glide(root, before) {
    if (!before || _reduced()) return;
    _items(root).forEach(function (el) {
      var was = before[el.dataset.part];
      if (was == null) return;
      var dy = was - el.offsetTop;
      if (Math.abs(dy) < 1) return;
      el.style.transition = 'none';
      el.style.transform = 'translateY(' + dy + 'px)';
      void el.offsetHeight;
      el.style.transition = 'transform ' + GLIDE + 'ms cubic-bezier(.2,.7,.2,1)';
      el.style.transform = '';
      el.addEventListener('transitionend', function done() {
        el.style.transition = '';
        el.removeEventListener('transitionend', done);
      });
    });
  }

  function render(palette, api) {
    if (!palette) return;
    // Never under a part being dragged: the drop reads the rows it moved.
    // The redraw is owed until the part is let go.
    if (_drag && palette === _palette) {
      _owed = true;
      return;
    }
    _owed = false;
    _palette = palette;
    var before = _tops(palette);
    // html-safe: every label, name and value goes through esc(); keys are registry keys (esc()'d too); icons are this file's literals
    palette.innerHTML = panelHtml(api);
    _glide(palette, before);
    if (_focusAfter && palette.querySelector) {
      var el = palette.querySelector(_focusAfter);
      _focusAfter = null;
      if (el && el.focus) el.focus();
    }
  }
  function _redrawPanel() {
    if (_palette && _apiFn) render(_palette, _apiFn());
  }

  /* ── The page: light a part, or find it ────────────────────── */

  function _cells(key) {
    if (typeof document === 'undefined' || !document.querySelectorAll) return [];
    var sel = _isFb(key) ? '#rb-preview .fb-sheet .sheet-body' : '#rb-preview .sheet-cell[data-part="' + key + '"]';
    return Array.prototype.slice.call(document.querySelectorAll(sel));
  }
  function _light(key) {
    if (_lit === key) return;
    _unlight();
    _lit = key;
    if (key)
      _cells(key).forEach(function (el) {
        el.classList.add('one-hl');
      });
  }
  function _unlight() {
    if (!_lit) return;
    _cells(_lit).forEach(function (el) {
      el.classList.remove('one-hl');
    });
    _lit = null;
  }
  /* Scrolls a part into view on the page and flashes it. */
  function _flash(key, api) {
    var els = _cells(key);
    if (!els.length) {
      var st = api.student();
      api.announce(ReportOne.label(key, api.cid) + ' prints nothing' + (st ? ' for ' + _first(st) : '') + '.');
      return;
    }
    if (els[0].scrollIntoView) els[0].scrollIntoView({ block: 'center', behavior: _reduced() ? 'auto' : 'smooth' });
    els.forEach(function (el) {
      el.classList.add('one-hl', 'one-flash');
    });
    setTimeout(function () {
      els.forEach(function (el) {
        el.classList.remove('one-flash');
        if (_lit !== key) el.classList.remove('one-hl');
      });
    }, 1200);
  }

  /* ── Folding ───────────────────────────────────────────────── */

  /* Opens or shuts a fold in place, so it slides; once open it lets its
     contents show past its edge (a focus ring, a dragged row's shadow). */
  function _setFold(wrap, open) {
    if (!wrap) return;
    wrap.classList.remove('settled');
    wrap.classList.toggle('open', open);
    if (!open) return;
    if (_reduced()) {
      wrap.classList.add('settled');
      return;
    }
    setTimeout(function () {
      if (wrap.classList.contains('open')) wrap.classList.add('settled');
    }, GLIDE);
  }

  /* ── The Setup menu ────────────────────────────────────────── */

  function _menuEls() {
    if (!_palette || !_palette.querySelector) return {};
    return { btn: _palette.querySelector('.one-setup-btn'), menu: _palette.querySelector('.one-setup-menu') };
  }
  function _menuItems() {
    var e = _menuEls();
    return e.menu ? Array.prototype.slice.call(e.menu.querySelectorAll('.one-setup-item')) : [];
  }
  function _setMenu(open, focus) {
    _menu = !!open;
    var e = _menuEls();
    if (!e.btn || !e.menu) return;
    e.btn.setAttribute('aria-expanded', String(_menu));
    e.menu.hidden = !_menu;
    if (_menu && focus) {
      var items = _menuItems();
      var cur =
        items.filter(function (b) {
          return b.getAttribute('aria-checked') === 'true';
        })[0] || items[0];
      if (cur) cur.focus();
    } else if (!_menu && focus) e.btn.focus();
  }

  /* ── Moving a part ─────────────────────────────────────────── */

  /* Where a part goes in m.parts to sit just before `next` or just after
     `prev` (two parts that can be dragged). */
  function _indexFor(m, key, prev, next) {
    var list = m.parts.filter(function (k) {
      return k !== key;
    });
    if (next && list.indexOf(next) >= 0) return list.indexOf(next);
    if (prev && list.indexOf(prev) >= 0) return list.indexOf(prev) + 1;
    return null;
  }
  function _dragKeys(root) {
    return _items(root)
      .filter(function (el) {
        return el.classList.contains('can-drag');
      })
      .map(function (el) {
        return el.dataset.part;
      });
  }
  function _placeText(api, key) {
    var keys = ReportOne.order(api.model(), api.scope()).filter(function (k) {
      return ReportOne.available(k, api.cid);
    });
    return ReportOne.label(key, api.cid) + ', ' + (keys.indexOf(key) + 1) + ' of ' + keys.length + ' on the report.';
  }
  function _keyMove(key, dir) {
    var api = _apiFn && _apiFn();
    if (!api) return;
    var keys = _dragKeys(_palette);
    var i = keys.indexOf(key);
    var j = i + dir;
    if (i < 0 || j < 0 || j >= keys.length) {
      api.announce(ReportOne.label(key, api.cid) + (dir < 0 ? ' is as high as it goes.' : ' is as low as it goes.'));
      return;
    }
    var m = api.model();
    var to = dir < 0 ? _indexFor(m, key, null, keys[j]) : _indexFor(m, key, keys[j], null);
    if (to == null) return;
    api.set(ReportOne.move(m, key, to));
    api.announce(_placeText(api, key));
  }

  function _onPointerDown(e) {
    var h = e.target.closest && e.target.closest('[data-action="oneDrag"]');
    if (!h || e.button !== 0) return;
    e.preventDefault();
    if (h.focus) h.focus({ preventScroll: true });
    var item = h.closest('.one-item');
    var list = item && item.parentNode;
    if (!item || !list) return;
    _unlight();
    _drag = { key: h.dataset.part, item: item, list: list, moved: false };
    item.classList.add('dragging');
    var panel = _palette && _palette.querySelector('.one-panel');
    if (panel) panel.classList.add('is-dragging');
    document.addEventListener('pointermove', _onPointerMove);
    document.addEventListener('pointerup', _onPointerUp);
    document.addEventListener('pointercancel', _onPointerUp);
  }
  function _onPointerMove(e) {
    if (!_drag) return;
    var list = _drag.list;
    var box = list.getBoundingClientRect();
    var items = Array.prototype.filter.call(list.children, function (el) {
      return el.classList.contains('can-drag');
    });
    var cur = items.indexOf(_drag.item);
    var target = cur;
    items.forEach(function (el, i) {
      var mid = box.top + el.offsetTop + el.offsetHeight / 2;
      if (i > cur && e.clientY > mid) target = Math.max(target, i);
      if (i < cur && e.clientY < mid) target = Math.min(target, i);
    });
    if (target === cur) return;
    var before = _tops(_palette);
    var ref = target > cur ? items[target].nextSibling : items[target];
    list.insertBefore(_drag.item, ref);
    _drag.moved = true;
    _glide(_palette, before);
  }
  function _onPointerUp() {
    document.removeEventListener('pointermove', _onPointerMove);
    document.removeEventListener('pointerup', _onPointerUp);
    document.removeEventListener('pointercancel', _onPointerUp);
    var d = _drag;
    _drag = null;
    if (d) _drop(d);
    // A redraw that came while the part was held (the class fit coming in).
    if (_owed) _redrawPanel();
  }
  function _drop(d) {
    d.item.classList.remove('dragging');
    var panel = _palette && _palette.querySelector('.one-panel');
    if (panel) panel.classList.remove('is-dragging');
    if (!d.moved) return;
    var api = _apiFn && _apiFn();
    if (!api) return;
    var keys = _dragKeys(_palette);
    var i = keys.indexOf(d.key);
    var m = api.model();
    var to = _indexFor(m, d.key, keys[i - 1], keys[i + 1]);
    if (to == null) return;
    _focusAfter = '[data-action="oneDrag"][data-part="' + d.key + '"]';
    api.set(ReportOne.move(m, d.key, to), 'Moved ' + ReportOne.label(d.key, api.cid));
    api.announce(_placeText(api, d.key));
  }

  /* ── Listeners ─────────────────────────────────────────────── */

  function _onKeyDown(e) {
    var t = e.target;
    if (!t || !t.closest) return;
    if (_menu && t.closest('.one-setup')) {
      var items = _menuItems();
      var at = items.indexOf(t);
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        _setMenu(false, true);
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        if (!items.length) return;
        var to =
          e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? items.length - 1
              : at < 0
                ? 0
                : (at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[to].focus();
        return;
      }
    }
    if (!_menu && e.key === 'ArrowDown' && t.classList && t.classList.contains('one-setup-btn')) {
      e.preventDefault();
      _setMenu(true, true);
      return;
    }
    var h = t.closest('[data-action="oneDrag"]');
    if (h && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      e.stopPropagation();
      _keyMove(h.dataset.part, e.key === 'ArrowUp' ? -1 : 1);
    }
  }
  function _onFocusOut(e) {
    if (!_menu) return;
    var to = e.relatedTarget;
    if (to && to.closest && !to.closest('.one-setup')) _setMenu(false, false);
  }
  function _onPointerOver(e) {
    if (_drag) return;
    var item = e.target.closest && e.target.closest('.one-item');
    _light(item ? item.dataset.part : null);
  }
  function _onDocClick(e) {
    if (!_menu) return;
    var t = e.target;
    if (t && t.closest && t.closest('.one-setup')) return;
    _setMenu(false, false);
  }

  function mount(palette, apiFn) {
    _apiFn = apiFn;
    _palette = palette;
    _menu = false;
    _drag = null;
    _lit = null;
    if (!palette || !palette.addEventListener) return;
    palette.addEventListener('keydown', _onKeyDown);
    palette.addEventListener('focusout', _onFocusOut);
    palette.addEventListener('pointerdown', _onPointerDown);
    palette.addEventListener('pointerover', _onPointerOver);
    palette.addEventListener('pointerleave', _unlight);
    if (!_docBound && typeof document !== 'undefined' && document.addEventListener) {
      _docBound = true;
      document.addEventListener('click', _onDocClick);
    }
  }

  /* ── Clicks and changes ────────────────────────────────────── */

  function _switch(api, m, key, on) {
    var sid = _isFb(key) ? null : api.scope();
    var st = sid ? api.student() : null;
    // A part switched off leaves the list: focus goes to the row after it.
    if (!on) {
      var keys = _items(_palette).map(function (el) {
        return el.dataset.part;
      });
      var i = keys.indexOf(key);
      var next = i >= 0 ? keys[i + 1] || keys[i - 1] : null;
      if (next) _focusAfter = '.one-onlist [data-action="oneOpen"][data-part="' + next + '"]';
    }
    api.set(
      ReportOne.setOn(m, key, on, sid),
      (on ? 'Added ' : 'Removed ') + ReportOne.label(key, api.cid) + (st ? ' for ' + _first(st) : ''),
    );
  }
  function _optOf(m, key, optKey, cid) {
    return ReportOne.optionsFor(m, key, cid).filter(function (o) {
      return o.key === optKey;
    })[0];
  }

  function handle(action, el, api) {
    var m = api.model();
    var key = el.dataset.part;
    var o;
    switch (action) {
      case 'oneSwitch':
        if (key === 'header') return true;
        _switch(api, m, key, !ReportOne.isOn(m, key, _isFb(key) ? null : api.scope()));
        return true;
      case 'oneAdd':
        _switch(api, m, key, true);
        return true;
      case 'oneOpen': {
        if (!_hasOpts(m, key, api.cid)) {
          _flash(key, api);
          return true;
        }
        _open[key] = !_open[key];
        var item = el.closest('.one-item');
        if (item) item.classList.toggle('is-open', _open[key]);
        el.setAttribute('aria-expanded', String(_open[key]));
        _setFold(item && item.querySelector('.one-opts'), _open[key]);
        return true;
      }
      case 'oneFold': {
        var id = el.dataset.value;
        _fold[id] = !_fold[id];
        el.setAttribute('aria-expanded', String(!_fold[id]));
        _setFold(el.nextElementSibling, !_fold[id]);
        return true;
      }
      case 'oneSetupMenu':
        _setMenu(!_menu, true);
        return true;
      case 'oneSetup': {
        var s = ReportOne.SETUPS.filter(function (x) {
          return x.id === el.dataset.value;
        })[0];
        if (!s) return true;
        _menu = false;
        _focusAfter = '.one-setup-btn';
        api.set(ReportOne.fromSetup(s.id), 'Changed to ' + s.name);
        return true;
      }
      case 'oneScope':
        api.setScope(el.dataset.value === 'student');
        return true;
      case 'oneUseClass': {
        var st = api.student();
        if (!st) return true;
        _focusAfter = '[data-action="oneScope"][data-value="class"]';
        api.set(ReportOne.clearStudent(m, st.id), 'Removed ' + _first(st) + '’s changes');
        return true;
      }
      case 'oneOpt':
        o = _optOf(m, key, el.dataset.opt, api.cid);
        if (o) api.set(ReportOne.setOption(m, key, o.key, !o.value));
        return true;
      case 'oneOptChoice': {
        o = _optOf(m, key, el.dataset.opt, api.cid);
        var ch = o && o.choices && o.choices[Number(el.dataset.value)];
        if (ch && ch.v !== o.value) api.set(ReportOne.setOption(m, key, o.key, ch.v));
        return true;
      }
      case 'oneLines': {
        if (el.getAttribute('aria-disabled') === 'true') return true;
        o = _optOf(m, key, 'lines', api.cid);
        if (!o) return true;
        var lo = o.min != null ? o.min : 0;
        var hi = o.max != null ? o.max : 40;
        var v = Math.max(lo, Math.min(hi, (Number(o.value) || 0) + Number(el.dataset.value)));
        if (v !== o.value) api.set(ReportOne.setOption(m, key, 'lines', v));
        return true;
      }
      case 'oneOptText': // saved on change
      case 'oneDrag': // moved by pointer and arrow keys
        return true;
    }
    return false;
  }

  function change(action, el, api) {
    if (action !== 'oneOptText') return false;
    var m = api.model();
    var o = _optOf(m, el.dataset.part, el.dataset.opt, api.cid);
    if (o && o.value !== el.value) api.set(ReportOne.setOption(m, el.dataset.part, el.dataset.opt, el.value));
    return true;
  }

  /* ── The line over the pages ───────────────────────────────── */

  function fitHtml(api) {
    var fit = api.fit();
    if (!fit) return '';
    var bits = [];
    var st = _canvas(api);
    var per = st && fit.perStudent && fit.perStudent[st.id];
    if (per) bits.push(esc(_n(per.sheets, 'sheet', 'sheets') + ' for ' + _first(st)));
    bits.push(esc(_n(fit.sheets, 'sheet', 'sheets') + ' for the class, double-sided'));
    var h = bits.join(' · ');
    var over = fit.over || [];
    if (over.length) {
      var names = over.slice(0, 3).join(', ') + (over.length > 3 ? ' and ' + (over.length - 3) + ' more' : '');
      h += ' · <span class="one-fit-over">' + esc('Too long for a page: ' + names) + '</span>';
    }
    return h;
  }

  return {
    mount: mount,
    render: render,
    handle: handle,
    change: change,
    fitHtml: fitHtml,
    _helpers: { panelHtml: panelHtml, indexFor: _indexFor },
  };
})();
