/* assign-competency-picker.js — the assessment form's competency picker: Choose Competencies, the Codes and List views, the focus box and type to narrow.
   Moved from teacher/page-assignments.js on 2026-11-12; PageAssignments uses it through AssignCompPicker. */
window.AssignCompPicker = (function () {
  'use strict';

  /* What the Assignments page hands over on every call (configure): the class
     on screen and the form helpers the picker uses, by the names it uses. */
  var activeCourse = null;
  var onTagChange, _hideAfTip, _refreshCompHint, _rubricTagIds, _formChosenRubric;
  var _renderRubricView, _renderTagRubric, _afSecTagIds, _afGroupBox;
  function configure(page) {
    activeCourse = page.activeCourse;
    onTagChange = page.onTagChange;
    _hideAfTip = page._hideAfTip;
    _refreshCompHint = page._refreshCompHint;
    _rubricTagIds = page._rubricTagIds;
    _formChosenRubric = page._formChosenRubric;
    _renderRubricView = page._renderRubricView;
    _renderTagRubric = page._renderTagRubric;
    _afSecTagIds = page._afSecTagIds;
    _afGroupBox = page._afGroupBox;
  }

  /* ── The competency picker (redesign PR 4, 2026-11-02) ─────
     List (the default, Colin, Nov 2): one row per competency with its whole
     wording, under its folder; no hover-overs, since everything shows.
     Codes: every competency a one-click chip in its Ministry group;
     hovering or focusing one fills the focus box with its wording and I
     Can statements. The checkboxes in the list are the form's
     record either way: a chip ticks its checkbox, so saving, a rubric's
     own ticks and the I Can toggles are unchanged. With a rubric they're
     the rubric's, shown read only. (Same As was removed, Colin, Nov 2: it
     looked like a row of competencies.) */
  var COMP_VIEW_KEY = 'fv-assess-comp-view';
  function _compView() {
    try {
      return localStorage.getItem(COMP_VIEW_KEY) === 'codes' ? 'codes' : 'list';
    } catch (e) {
      return 'list';
    }
  }
  /* Choose Competencies: the list in a window over the form (Colin, Nov 4,
     option A). Done keeps the ticks; Cancel or Escape puts back the ones the
     window opened with. */
  var _compPickerStart = null;
  function _compTicks() {
    return Array.from(document.querySelectorAll('.af-tag-cb:checked')).map(function (cb) {
      return cb.value;
    });
  }
  function _setCompTick(cb, on) {
    if (cb.checked === on) return;
    cb.checked = on;
    onTagChange(cb, cb.dataset.section);
  }
  function _compPickerOpen() {
    var o = document.getElementById('af-comp-dialog');
    return !!(o && !o.hidden);
  }
  function openCompPicker() {
    var overlay = document.getElementById('af-comp-dialog');
    if (!overlay || !overlay.hidden) return;
    _hideAfTip();
    _compPickerStart = _compTicks();
    overlay.hidden = false;
    document.body.classList.add('af-comp-open'); // assignments.css: the tooltip stays above the window
    overlay.onkeydown = _compPickerKey;
    var find = document.getElementById('af-comp-find');
    if (find) find.focus();
  }
  // Esc is Cancel (a search with text clears first); Tab stays in the window.
  function _compPickerKey(e) {
    if (e.key === 'Escape' && !e.isComposing) {
      if (e.target && e.target.id === 'af-comp-find' && e.target.value) return;
      e.preventDefault();
      closeCompPicker(true);
      return;
    }
    if (e.key !== 'Tab') return;
    var box = e.currentTarget.querySelector('.af-comp-dialog');
    var items = Array.from(
      box.querySelectorAll('button, input, select, textarea, [tabindex]:not([tabindex="-1"])'),
    ).filter(function (n) {
      return !n.disabled && n.offsetParent !== null;
    });
    if (!items.length) return;
    var first = items[0];
    var last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
  function closeCompPicker(restore) {
    var overlay = document.getElementById('af-comp-dialog');
    if (!overlay || overlay.hidden) return;
    if (restore && _compPickerStart) {
      var keep = _compPickerStart;
      document.querySelectorAll('.af-tag-cb').forEach(function (cb) {
        _setCompTick(cb, keep.indexOf(cb.value) >= 0);
      });
      _syncCodes();
    }
    _compPickerStart = null;
    var find = document.getElementById('af-comp-find');
    if (find && find.value) {
      find.value = '';
      _filterComps('');
    }
    _hideAfTip();
    overlay.hidden = true;
    document.body.classList.remove('af-comp-open');
    var back = document.getElementById('af-comp-choose');
    if (back) back.focus({ preventScroll: true });
  }
  // A chip's ✕: untick that competency.
  function _removeComp(tagId) {
    var cb = Array.from(document.querySelectorAll('.af-tag-cb')).find(function (x) {
      return x.value === tagId;
    });
    if (!cb || cb.disabled) return;
    _setCompTick(cb, false);
    _syncCodes();
    var next = document.querySelector('#af-comp-chosen .af-comp-chip-x') || document.getElementById('af-comp-choose');
    if (next) next.focus({ preventScroll: true });
  }

  function setCompView(view) {
    var card = document.querySelector('.af-card-competencies');
    if (!card) return;
    card.dataset.view = view === 'list' ? 'list' : 'codes';
    try {
      localStorage.setItem(COMP_VIEW_KEY, card.dataset.view);
    } catch (e) {}
    _syncCodes();
  }

  // How many of the class's other assessments scored each competency.
  function _compCounts(cid, exceptId) {
    var counts = {};
    getAssessments(cid).forEach(function (a) {
      if (!a || a.id === exceptId) return;
      (a.tagIds || []).forEach(function (t) {
        counts[t] = (counts[t] || 0) + 1;
      });
    });
    return counts;
  }

  function _compPickerHtml(cid, assess, sections, compGroups) {
    if (!sections.length) return '';
    var counts = _compCounts(cid, assess ? assess.id : null);
    var lm = getLearningMap(cid) || {};
    var subjects = lm.subjects || [];
    var subjectName = {};
    subjects.forEach(function (sub) {
      subjectName[sub.id] = sub.name || sub.id;
    });
    // Rows: each Ministry group with its competencies, in the class's order.
    var rows = [];
    var byGroup = {};
    compGroups.forEach(function (g) {
      byGroup[g.id] = { name: g.name, color: g.color, subject: null, secs: [] };
    });
    var loose = { name: 'Other Competencies', color: null, subject: null, secs: [] };
    sections.forEach(function (sec) {
      var row = (sec.groupId && byGroup[sec.groupId]) || loose;
      if (!row.subject) row.subject = sec.subject;
      row.secs.push(sec);
    });
    compGroups.forEach(function (g) {
      if (byGroup[g.id].secs.length) rows.push(byGroup[g.id]);
    });
    if (loose.secs.length) rows.push(loose);
    var twoCourses = subjects.length > 1;
    var lastSubject = null;
    var html = '';
    html += '<div class="af-codes" id="af-codes">';
    rows.forEach(function (row) {
      if (twoCourses && row.subject && row.subject !== lastSubject) {
        lastSubject = row.subject;
        html += '<div class="af-codes-course">' + esc(subjectName[row.subject] || row.subject) + '</div>';
      }
      html +=
        '<div class="af-codes-group"><label class="af-codes-group-name" data-af-tip="folder" data-tags="' +
        esc(_afSecTagIds(row.secs)) +
        '" data-name="' +
        esc(row.name) +
        '">' +
        _afGroupBox(row.secs, row.name) +
        esc(row.name) +
        '</label><span class="af-codes-chips">';
      row.secs.forEach(function (sec) {
        var tag = sec.tags[0];
        if (!tag) return;
        var n = counts[tag.id] || 0;
        html +=
          // How often it's been scored shows in the focus box, not on the
          // chip (Colin, Nov 2: the numbers were a distraction).
          '<button type="button" class="af-code" data-action="toggleCode" data-tag="' +
          esc(tag.id) +
          '" data-group="' +
          esc(row.name) +
          '" data-count="' +
          n +
          '" aria-pressed="false"><b>' +
          esc(tag.code || tag.id) +
          '</b>' +
          esc(tag.label || tag.shortName || sec.name || '') +
          '</button>';
      });
      html += '</span></div>';
    });
    html += '</div>';
    html +=
      '<div class="af-codes-focus" id="af-codes-focus" aria-live="polite">' +
      '<p class="af-codes-focus-hint">Point at a competency, or tab to it, to read its wording here.</p></div>';
    return html;
  }

  // Chips, header chips and the rubric note follow the checkboxes.
  function _syncCodes() {
    _refreshCompHint();
    var card = document.querySelector('.af-card-competencies');
    if (!card) return;
    var cid = activeCourse;
    var mode = (document.getElementById('af-scoremode') || {}).value || 'proficiency';
    // The list follows the rubric only when its criteria score competencies;
    // with a rubric that scores none, the teacher ticks them.
    var fromRubric = mode === 'proficiency' && _rubricTagIds(_formChosenRubric()).length > 0;
    card.classList.toggle('is-rubric', fromRubric);
    var note = document.getElementById('af-comp-rubric-note');
    if (note) note.hidden = !fromRubric;
    var chosen = [];
    document.querySelectorAll('.af-tag-cb').forEach(function (cb) {
      if (cb.checked) chosen.push(cb.value);
      cb.disabled = fromRubric;
    });
    card.querySelectorAll('.af-group-cb').forEach(function (box) {
      var ids = String(box.dataset.tags || '')
        .split(',')
        .filter(Boolean);
      var n = ids.filter(function (id) {
        return chosen.indexOf(id) >= 0;
      }).length;
      box.checked = !!ids.length && n === ids.length;
      box.indeterminate = n > 0 && n < ids.length;
      box.disabled = fromRubric;
    });
    card.querySelectorAll('.af-code').forEach(function (chip) {
      var on = chosen.indexOf(chip.dataset.tag) >= 0;
      chip.classList.toggle('on', on);
      chip.setAttribute('aria-pressed', String(on));
      chip.setAttribute('aria-disabled', String(fromRubric));
    });
    var head = document.getElementById('af-comp-chosen');
    if (head) {
      head.innerHTML = chosen
        .map(function (t) {
          var tag = getTagById(cid, t);
          var code = (tag && tag.code) || t;
          return (
            '<span class="af-comp-chip" tabindex="0" data-af-tip="comp" data-tag="' +
            esc(t) +
            '"><b>' +
            esc(code) +
            '</b>' +
            esc((tag && (tag.label || tag.shortName)) || '') +
            (fromRubric
              ? ''
              : '<button type="button" class="af-comp-chip-x" data-action="removeComp" data-tag="' +
                esc(t) +
                '" aria-label="' +
                esc('Remove ' + code) +
                '"><svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button>') +
            '</span>'
          );
        })
        .join('');
    }
    var count = document.getElementById('af-comp-count');
    if (count) count.textContent = chosen.length ? chosen.length + ' chosen' : 'None chosen';
    var choose = document.getElementById('af-comp-choose');
    if (choose) choose.hidden = fromRubric;
    card.querySelectorAll('.af-comp-view .seg-btn').forEach(function (b) {
      var on = b.dataset.view === card.dataset.view;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    _renderRubricView();
    _renderTagRubric();
  }

  function toggleCode(chip) {
    if (!chip || chip.getAttribute('aria-disabled') === 'true') return;
    var cb = document.querySelector('.af-tag-cb[value="' + chip.dataset.tag + '"]');
    if (cb) cb.click();
    _syncCodes();
  }

  // Ticks exactly these competencies (Start From a Past Assessment).
  function _tickExactly(tagIds) {
    var want = String(tagIds || '')
      .split(',')
      .filter(Boolean);
    document.querySelectorAll('.af-tag-cb').forEach(function (cb) {
      var on = want.indexOf(cb.value) >= 0;
      if (cb.checked !== on && !cb.disabled) cb.click();
    });
    _syncCodes();
  }

  // The focus box: the competency pointed at or focused, in full.
  function _showCodeFocus(chip) {
    var box = document.getElementById('af-codes-focus');
    if (!box || !chip) return;
    var tag = getTagById(activeCourse, chip.dataset.tag);
    if (!tag) return;
    document.querySelectorAll('.af-code.is-focus').forEach(function (c) {
      c.classList.remove('is-focus');
    });
    chip.classList.add('is-focus');
    var n = Number(chip.dataset.count) || 0;
    var icans = (tag.i_can_statements || []).filter(function (x) {
      return String(x || '').trim();
    });
    box.innerHTML =
      '<div class="af-codes-focus-head"><span class="af-codes-focus-code">' +
      esc(tag.code || tag.id) +
      '</span><span class="af-codes-focus-name">' +
      esc(tag.label || tag.shortName || '') +
      '</span><span class="af-codes-focus-group">' +
      esc(chip.dataset.group || '') +
      '</span><span class="af-codes-focus-count' +
      (n <= 1 ? ' is-thin' : '') +
      '">Scored ' +
      n +
      '× this year</span></div>' +
      '<p class="af-codes-focus-text">' +
      esc(tag.text || tag.source_text || '') +
      '</p>' +
      (icans.length
        ? '<div class="af-codes-focus-label">I Can</div><ul class="af-codes-focus-icans">' +
          icans
            .map(function (x) {
              return '<li>' + esc(x) + '</li>';
            })
            .join('') +
          '</ul>'
        : '');
    var boxRect = box.getBoundingClientRect();
    var r = chip.getBoundingClientRect();
    box.style.setProperty('--af-point', Math.max(16, Math.round(r.left + r.width / 2 - boxRect.left - 8)) + 'px');
  }
  function _codeHover(e) {
    var chip = e.target && e.target.closest ? e.target.closest('.af-code') : null;
    if (chip) _showCodeFocus(chip);
  }

  // Type to narrow the chips and the list; Enter ticks the first match.
  function _filterComps(q) {
    var query = String(q || '')
      .trim()
      .toLowerCase();
    var cid = activeCourse;
    var match = function (id) {
      if (!query) return true;
      var tag = getTagById(cid, id) || {};
      return [tag.code, tag.id, tag.label, tag.shortName, tag.text].some(function (x) {
        return (
          String(x || '')
            .toLowerCase()
            .indexOf(query) >= 0
        );
      });
    };
    document.querySelectorAll('.af-code').forEach(function (chip) {
      chip.hidden = !match(chip.dataset.tag);
    });
    document.querySelectorAll('.af-codes-group').forEach(function (g) {
      g.hidden = !g.querySelector('.af-code:not([hidden])');
    });
    document.querySelectorAll('.af-comp-list .af-tag-row').forEach(function (row) {
      var cb = row.querySelector('.af-tag-cb');
      var hide = cb ? !match(cb.value) : false;
      row.hidden = hide;
      var list = row.nextElementSibling;
      if (hide && list && list.classList.contains('af-tag-icans')) list.hidden = true;
    });
  }
  function _compKeydown(e) {
    var t = e.target;
    if (!t || !t.closest) return;
    if (t.id === 'af-comp-find') {
      if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        var first = document.querySelector('.af-code:not([hidden])');
        if (first) toggleCode(first);
      } else if (e.key === 'Escape' && t.value) {
        e.preventDefault();
        t.value = '';
        _filterComps('');
      }
      return;
    }
    if (!t.classList.contains('af-code')) return;
    var keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    if (!keys[e.key]) return;
    var chips = Array.from(document.querySelectorAll('.af-code:not([hidden])'));
    var i = chips.indexOf(t);
    var next = chips[i + keys[e.key]];
    if (next) {
      e.preventDefault();
      next.focus();
    }
  }
  function _compInput(e) {
    if (e.target && e.target.id === 'af-comp-find') _filterComps(e.target.value);
  }

  return {
    configure: configure,
    _compView: _compView,
    _compPickerOpen: _compPickerOpen,
    openCompPicker: openCompPicker,
    closeCompPicker: closeCompPicker,
    _removeComp: _removeComp,
    setCompView: setCompView,
    _compCounts: _compCounts,
    _compPickerHtml: _compPickerHtml,
    _syncCodes: _syncCodes,
    toggleCode: toggleCode,
    _tickExactly: _tickExactly,
    _codeHover: _codeHover,
    _compKeydown: _compKeydown,
    _compInput: _compInput,
  };
})();
