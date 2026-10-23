/* ── Rubric Bank ────────────────────────────────────────────────
   The window the Rubrics button opens: the class's rubrics on the left,
   grouped by whether an assessment uses them, and the selected rubric read
   only on the right with its actions. All My Classes lists every class's
   rubrics; one from another class can be copied in. The page owns editing,
   deleting and the new-assessment form; it passes them in as hooks so this
   file never reaches into the page's state.

   Hooks: edit(rid), newRubric(), remove(rid), print(rid, aid),
   useInNew(rid), goToAssessment(aid), changed().
   ─────────────────────────────────────────────────────────────── */
window.RubricBank = (function () {
  'use strict';

  var OVERLAY_ID = 'rubric-bank-overlay';
  var SELECTED_KEY = 'rubric-bank-selected';
  var USES_SHOWN = 4;

  // { cid, hooks, scope, selected, selCid, query, openClasses, loaded,
  //   menuOpen, renaming, allUses, trigger, keyHandler }
  var _s = null;

  /* ── Data ───────────────────────────────────────────────── */

  function _norm(s) {
    return String(s == null ? '' : s)
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  }

  function _rubrics(cid) {
    return (typeof getRubrics === 'function' && getRubrics(cid)) || [];
  }

  function _className(cid) {
    return (COURSES[cid] && courseDisplayName(COURSES[cid])) || 'This Class';
  }

  /* The assessments that use a rubric, newest first. */
  function usesOf(cid, rid) {
    return ((typeof getAssessments === 'function' && getAssessments(cid)) || [])
      .filter(function (a) {
        return a && a.rubricId === rid;
      })
      .sort(function (a, b) {
        return String(b.date || '').localeCompare(String(a.date || ''));
      });
  }

  function _tagLabel(cid, tagId) {
    var tag = typeof getTagById === 'function' ? getTagById(cid, tagId) : null;
    return tag ? tag.label || tag.text || tag.code || '' : '';
  }

  function _levels(cid) {
    return typeof levelOrderFor === 'function' ? levelOrderFor(cid) : [4, 3, 2, 1];
  }

  /* A rubric matches when its name or a linked competency contains the query. */
  function matches(cid, rubric, query) {
    var q = _norm(query);
    if (!q) return true;
    if (_norm(rubric.name).indexOf(q) >= 0) return true;
    return (rubric.criteria || []).some(function (c) {
      return (c.tagIds || []).some(function (tid) {
        return _norm(_tagLabel(cid, tid)).indexOf(q) >= 0;
      });
    });
  }

  /* Used rubrics first, then the rest, each in the class's own order. */
  function groups(cid, query) {
    var used = [];
    var unused = [];
    _rubrics(cid).forEach(function (r) {
      if (!matches(cid, r, query)) return;
      (usesOf(cid, r.id).length ? used : unused).push(r);
    });
    return { used: used, unused: unused };
  }

  /* The teacher's other live classes, same course first, as Copy lists them. */
  function otherClasses(cid) {
    if (!window.AssessmentCopy) return [];
    var t = AssessmentCopy.copyTargets(cid);
    return t.sameCourse.concat(t.other);
  }

  function _plural(n, one, many) {
    return n + ' ' + (n === 1 ? one : many);
  }

  function rowMeta(cid, rubric) {
    var n = usesOf(cid, rubric.id).length;
    return (
      _plural((rubric.criteria || []).length, 'Criterion', 'Criteria') +
      ' · ' +
      (n ? _plural(n, 'Assessment', 'Assessments') : 'Not Used')
    );
  }

  /* "Linked With Science 8 Block D", or the count when there are several. */
  function linkedLabel(cid, rubric) {
    if (!window.RubricLibrary || !rubric.copyGroup) return '';
    var copies = RubricLibrary.localCopies(cid, rubric);
    if (!copies.length) return '';
    if (copies.length === 1) return 'Linked With ' + copies[0].className;
    return 'Linked With ' + copies.length + ' Classes';
  }

  /* How a rubric's competencies land in another class, matched by name the
     way Copy matches them: { total, matched, byTag: { tagId: true|false } }. */
  function matchInfo(srcCid, dstCid, rubric) {
    var out = { total: 0, matched: 0, byTag: {} };
    if (!window.AssessmentCopy) return out;
    (rubric.criteria || []).forEach(function (c) {
      (c.tagIds || []).forEach(function (tid) {
        var hit = AssessmentCopy.mapTags(srcCid, dstCid, [tid]).ids.length > 0;
        out.byTag[tid] = hit;
        out.total++;
        if (hit) out.matched++;
      });
    });
    return out;
  }

  function _canCopy(cid) {
    return !!window.RubricLibrary && otherClasses(cid).length > 0;
  }

  /* A copy in the same class: new ids, numbered name, not linked. */
  function duplicate(cid, rid) {
    var list = _rubrics(cid);
    var src = list.find(function (r) {
      return r.id === rid;
    });
    if (!src) return null;
    var copy = structuredClone(src);
    copy.id = uid();
    delete copy.copyGroup;
    copy.criteria = (copy.criteria || []).map(function (c) {
      return Object.assign({}, c, { id: uid() });
    });
    copy.name = window.RubricLibrary ? RubricLibrary.uniqueName(src.name, list) : src.name + ' (2)';
    copy.title = copy.name;
    saveRubrics(cid, list.concat([copy]));
    return copy;
  }

  /* Rename in place. Empty names and names another rubric has are refused. */
  function rename(cid, rid, name) {
    var next = String(name || '').trim();
    if (!next) return false;
    var list = _rubrics(cid);
    var clash = list.some(function (r) {
      return r.id !== rid && _norm(r.name) === _norm(next);
    });
    if (clash) return false;
    saveRubrics(
      cid,
      list.map(function (r) {
        return r.id === rid ? Object.assign({}, r, { name: next, title: next }) : r;
      }),
    );
    return true;
  }

  /* What deleting a rubric takes with it: each assessment that uses it and
     how many students have rubric scores there. The database deletes those
     scores with the rubric (rubric_score cascades from criterion). */
  function deleteImpact(cid, rid) {
    var students = (typeof getStudents === 'function' && getStudents(cid)) || [];
    var scored = window.RubricPrint && RubricPrint.isStudentScored;
    var rows = usesOf(cid, rid).map(function (a) {
      var n = scored
        ? students.filter(function (s) {
            return RubricPrint.isStudentScored(cid, a.id, s.id);
          }).length
        : 0;
      return { id: a.id, title: a.title || 'Untitled', date: a.date || '', scored: n };
    });
    var total = rows.reduce(function (sum, r) {
      return sum + r.scored;
    }, 0);
    return { uses: rows, scored: total };
  }

  /* The delete confirmation (mockup C4): the assessments that use the rubric,
     how many students have scores in each, what happens to them, and the
     linked copy that stays. Cancel has focus; Escape cancels. */
  function confirmDelete(cid, rid, onConfirm) {
    var rubric = getRubricById(cid, rid);
    if (!rubric) return;
    var impact = deleteImpact(cid, rid);
    var copies = window.RubricLibrary ? RubricLibrary.localCopies(cid, rubric) : [];
    var html = '<div class="confirm-card rb-del-card">';
    html += '<div class="confirm-title" id="rb-del-title">Delete ' + esc(rubric.name) + '?</div>';
    if (impact.uses.length) {
      html +=
        '<div class="confirm-message">' +
        esc(_plural(impact.uses.length, 'assessment uses', 'assessments use')) +
        ' this rubric.</div>';
      html += '<div class="rb-del-list">';
      impact.uses.forEach(function (u) {
        html +=
          '<div class="rb-del-row"><span class="rb-del-name">' +
          esc(u.title) +
          '</span><span class="rb-del-meta">' +
          esc(
            [u.date ? formatDate(u.date) : '', u.scored ? _plural(u.scored, 'Student Scored', 'Students Scored') : '']
              .filter(Boolean)
              .join(' · '),
          ) +
          '</span></div>';
      });
      html += '</div>';
      html +=
        '<div class="rb-del-warn' +
        (impact.scored ? ' is-danger' : '') +
        '">' +
        (impact.scored
          ? 'The rubric scores in these assessments will be deleted with it. This cannot be undone.'
          : 'They will lose their rubric link.') +
        '</div>';
    } else {
      html += '<div class="confirm-message">No assessment uses this rubric. This cannot be undone.</div>';
    }
    if (copies.length) {
      var names = copies.map(function (c) {
        return c.className;
      });
      var list = names.length === 1 ? names[0] : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
      html +=
        '<div class="rb-del-note">This rubric is linked with ' +
        esc(list) +
        '. ' +
        (names.length === 1 ? 'That copy stays.' : 'Those copies stay.') +
        '</div>';
    }
    html +=
      '<div class="confirm-actions"><button type="button" class="confirm-cancel" data-del="cancel">Cancel</button>' +
      '<button type="button" class="confirm-ok danger" data-del="ok">Delete Rubric</button></div></div>';

    var trigger = document.activeElement;
    var overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.setAttribute('role', 'alertdialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'rb-del-title');
    overlay.innerHTML = html;
    function done(ok) {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      try {
        if (trigger && document.body.contains(trigger) && trigger.focus) trigger.focus();
      } catch (e) {
        /* the trigger may have been redrawn */
      }
      if (ok) onConfirm();
    }
    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        done(false);
      } else if (e.key === 'Tab') {
        // Keep focus on the two buttons.
        var btns = overlay.querySelectorAll('button');
        var first = btns[0];
        var last = btns[btns.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) return done(false);
      var btn = e.target.closest ? e.target.closest('[data-del]') : null;
      if (btn) done(btn.dataset.del === 'ok');
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
    overlay.querySelector('[data-del="cancel"]').focus();
  }

  /* ── Remembered selection ───────────────────────────────── */

  function _loadSelected(cid) {
    try {
      var map = JSON.parse(localStorage.getItem(SELECTED_KEY) || '{}');
      return (map && map[cid]) || null;
    } catch (e) {
      return null;
    }
  }

  function _saveSelected(cid, rid) {
    try {
      var map = JSON.parse(localStorage.getItem(SELECTED_KEY) || '{}') || {};
      map[cid] = rid;
      localStorage.setItem(SELECTED_KEY, JSON.stringify(map));
    } catch (e) {
      /* storage blocked: the first rubric is selected next time */
    }
  }

  /* The selected rubric, falling back to the first in this class. */
  function _current() {
    var hit = _rubrics(_s.selCid).find(function (r) {
      return r.id === _s.selected;
    });
    if (hit) return hit;
    var g = groups(_s.cid, '');
    var first = g.used[0] || g.unused[0] || null;
    _s.selCid = _s.cid;
    _s.selected = first ? first.id : null;
    return first;
  }

  function _isForeign() {
    return _s.selCid !== _s.cid;
  }

  /* ── Rendering ──────────────────────────────────────────── */

  function _rowHtml(cid, r) {
    var selected = r.id === _s.selected && cid === _s.selCid;
    return (
      '<button type="button" class="rb-row' +
      (selected ? ' is-selected' : '') +
      '" data-rb="select" data-cid="' +
      esc(cid) +
      '" data-rid="' +
      esc(r.id) +
      '" aria-current="' +
      (selected ? 'true' : 'false') +
      '"><span class="rb-row-name">' +
      esc(r.name) +
      '</span><span class="rb-row-meta">' +
      esc(rowMeta(cid, r)) +
      '</span></button>'
    );
  }

  function _classListHtml() {
    var cid = _s.cid;
    var g = groups(cid, _s.query);
    if (!_rubrics(cid).length) return '<div class="rb-empty-list">No rubrics yet.</div>';
    if (!g.used.length && !g.unused.length) return '<div class="rb-empty-list">No rubrics match.</div>';
    var html = '';
    if (g.used.length) {
      html += '<div class="rb-group">Used in ' + esc(_className(cid)) + ' · ' + g.used.length + '</div>';
      g.used.forEach(function (r) {
        html += _rowHtml(cid, r);
      });
    }
    if (g.unused.length) {
      html += '<div class="rb-group">Not Used Yet · ' + g.unused.length + '</div>';
      g.unused.forEach(function (r) {
        html += _rowHtml(cid, r);
      });
    }
    return html;
  }

  /* One collapsible group per class, this class first and open. A search
     opens every group that has a match. */
  function _allListHtml() {
    var cid = _s.cid;
    var classes = [{ id: cid, name: _className(cid) + ' (This Class)' }].concat(
      otherClasses(cid).map(function (c) {
        return { id: c.id, name: c.name };
      }),
    );
    var searching = !!_norm(_s.query);
    var html = '';
    var any = false;
    classes.forEach(function (c) {
      var own = c.id === cid;
      var ready = own || _s.loaded;
      var rows = ready
        ? _rubrics(c.id).filter(function (r) {
            return matches(c.id, r, _s.query);
          })
        : [];
      if (searching && !rows.length) return;
      any = true;
      var open = searching || !!_s.openClasses[c.id];
      html +=
        '<button type="button" class="rb-class" data-rb="group" data-cid="' +
        esc(c.id) +
        '" aria-expanded="' +
        (open ? 'true' : 'false') +
        '"><svg class="rb-chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg><span>' +
        esc(c.name) +
        (ready ? ' · ' + rows.length : '') +
        '</span></button>';
      if (!open) return;
      if (!ready) html += '<div class="rb-empty-list">Loading…</div>';
      else if (!rows.length) html += '<div class="rb-empty-list">No rubrics yet.</div>';
      rows.forEach(function (r) {
        html += _rowHtml(c.id, r);
      });
    });
    if (!any) return '<div class="rb-empty-list">No rubrics match.</div>';
    return html;
  }

  function listHtml() {
    return _s.scope === 'all' ? _allListHtml() : _classListHtml();
  }

  /* The header shows each level's value when every criterion uses the
     defaults; otherwise each cell shows its own. */
  function _defaultValues(rubric) {
    return (rubric.criteria || []).every(function (c) {
      return !c.levelValues;
    });
  }

  /* The rubric as a read-only table in `cid`'s level order. `opts.srcCid`
     is where the rubric's competencies live (another class when browsing);
     `opts.match` marks the chips with no match in this class. */
  function gridHtml(cid, rubric, opts) {
    opts = opts || {};
    var srcCid = opts.srcCid || cid;
    var levels = _levels(cid);
    var plainValues = _defaultValues(rubric);
    var html = '<table class="rb-grid"><thead><tr><th class="rb-crit-head" scope="col">Criterion</th>';
    levels.forEach(function (lv) {
      html +=
        '<th scope="col" class="rb-level-head l' +
        lv +
        '"><span>' +
        PROF_LABELS[lv] +
        '</span>' +
        (plainValues ? '<span class="rb-level-value">' + lv + '</span>' : '') +
        '</th>';
    });
    html += '</tr></thead><tbody>';
    (rubric.criteria || []).forEach(function (c) {
      var chips = (c.tagIds || [])
        .map(function (tid) {
          var label = _tagLabel(srcCid, tid);
          if (!label) return '';
          var missing = opts.match && opts.match.byTag[tid] === false;
          return (
            '<span class="rb-chip' +
            (missing ? ' is-missing' : '') +
            '"' +
            (missing ? ' title="No match in ' + esc(_className(cid)) + '"' : '') +
            '>' +
            esc(label) +
            '</span>'
          );
        })
        .join('');
      html +=
        '<tr><th scope="row" class="rb-crit"><span class="rb-crit-name">' +
        esc(c.name) +
        '</span>' +
        (chips ? '<span class="rb-chips">' + chips + '</span>' : '') +
        '<span class="rb-weight">Weight ' +
        esc(String(c.weight != null ? c.weight : 1)) +
        '</span></th>';
      levels.forEach(function (lv) {
        var value = c.levelValues && c.levelValues[lv] != null ? c.levelValues[lv] : lv;
        html +=
          '<td class="rb-cell">' +
          esc((c.levels && c.levels[lv]) || '') +
          (plainValues ? '' : '<span class="rb-cell-value">Value ' + esc(String(value)) + '</span>') +
          '</td>';
      });
      html += '</tr>';
    });
    html += '</tbody></table>';
    return html;
  }

  function _menuHtml() {
    return (
      '<div class="rb-menu" role="menu">' +
      '<button type="button" role="menuitem" data-rb="duplicate">Duplicate</button>' +
      '<button type="button" role="menuitem" data-rb="rename">Rename</button>' +
      '<div class="rb-menu-sep"></div>' +
      '<button type="button" role="menuitem" class="is-danger" data-rb="delete">Delete Rubric</button>' +
      '</div>'
    );
  }

  /* A rubric from another class: where it is from, how its competencies
     match this class, and Copy. */
  function _foreignPaneHtml(r) {
    var cid = _s.cid;
    var src = _s.selCid;
    var here = _className(cid);
    var n = usesOf(src, r.id).length;
    var match = matchInfo(src, cid, r);
    var html = '<div class="rb-pane-head"><div class="rb-title-wrap">';
    html += '<h3 class="rb-title" id="rb-title">' + esc(r.name) + '</h3>';
    html +=
      '<div class="rb-sub"><span>' +
      esc(
        'From ' +
          _className(src) +
          ' · ' +
          _plural((r.criteria || []).length, 'Criterion', 'Criteria') +
          ' · ' +
          (n ? 'Used in ' + _plural(n, _className(src) + ' Assessment', _className(src) + ' Assessments') : 'Not Used'),
      ) +
      '</span></div></div>';
    html +=
      '<div class="rb-actions"><button type="button" class="rb-btn rb-btn-primary" data-rb="copy-here">Copy to ' +
      esc(here) +
      '</button></div></div>';
    if (match.total) {
      var missing = match.total - match.matched;
      html +=
        '<div class="rb-note"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg><span>' +
        esc(
          'Competencies are matched to ' +
            here +
            ' by name. ' +
            match.matched +
            ' of ' +
            match.total +
            ' match.' +
            (missing
              ? ' The ' +
                (missing === 1 ? 'other is' : missing + ' others are') +
                ' left off the copy; you can add competencies in the editor afterwards.'
              : ''),
        ) +
        '</span></div>';
    }
    html += '<div class="rb-grid-wrap">' + gridHtml(cid, r, { srcCid: src, match: match }) + '</div>';
    if (match.total > match.matched) {
      html +=
        '<div class="rb-foot rb-legend"><span><span class="rb-chip">Matches</span> Found in ' +
        esc(here) +
        '</span><span><span class="rb-chip is-missing">No Match</span> Not in ' +
        esc(here) +
        '</span></div>';
    }
    return html;
  }

  function paneHtml() {
    var cid = _s.cid;
    var r = _current();
    if (!r) {
      return (
        '<div class="rb-empty-pane"><div class="rb-empty-title">This class has no rubrics yet.</div>' +
        '<div class="rb-empty-actions"><button type="button" class="rb-btn rb-btn-primary" data-rb="new">+ New Rubric</button>' +
        (_canCopy(cid)
          ? '<button type="button" class="rb-btn" data-rb="scope" data-scope="all">Copy One From Another Class</button>'
          : '') +
        '</div></div>'
      );
    }
    if (_isForeign()) return _foreignPaneHtml(r);
    var uses = usesOf(cid, r.id);
    var linked = linkedLabel(cid, r);
    var html = '<div class="rb-pane-head"><div class="rb-title-wrap">';
    if (_s.renaming) {
      html +=
        '<input class="rb-rename" id="rb-rename" aria-label="Rubric name" value="' + esc(r.name) + '" maxlength="120">';
    } else {
      html += '<h3 class="rb-title" id="rb-title">' + esc(r.name) + '</h3>';
    }
    html +=
      '<div class="rb-sub"><span>' +
      esc(_plural((r.criteria || []).length, 'Criterion', 'Criteria')) +
      '</span>' +
      (linked ? '<span class="rb-linked">' + esc(linked) + '</span>' : '') +
      '</div></div>';
    html += '<div class="rb-actions">';
    html += '<button type="button" class="rb-btn rb-btn-primary" data-rb="edit">Edit Rubric</button>';
    if (uses.length) html += '<button type="button" class="rb-btn" data-rb="print">Print</button>';
    if (_canCopy(cid)) html += '<button type="button" class="rb-btn" data-rb="copy">Copy to Class</button>';
    html +=
      '<div class="rb-more-wrap"><button type="button" class="rb-btn rb-more' +
      (_s.menuOpen ? ' is-open' : '') +
      '" data-rb="more" aria-label="More actions" aria-haspopup="menu" aria-expanded="' +
      (_s.menuOpen ? 'true' : 'false') +
      '"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg></button>' +
      (_s.menuOpen ? _menuHtml() : '') +
      '</div></div></div>';
    html += '<div class="rb-grid-wrap">' + gridHtml(cid, r) + '</div>';
    html += '<div class="rb-foot"><div class="rb-used">';
    if (uses.length) {
      html += '<span class="rb-used-label">Used In</span>';
      // Four chips keep the footer to one line; the rest wait behind "+ n More".
      var shown = _s.allUses ? uses : uses.slice(0, USES_SHOWN);
      shown.forEach(function (a) {
        html +=
          '<button type="button" class="rb-use-chip" data-rb="goto" data-aid="' +
          esc(a.id) +
          '">' +
          esc(a.title || 'Untitled') +
          '</button>';
      });
      if (uses.length > shown.length) {
        html +=
          '<button type="button" class="rb-use-more" data-rb="more-uses">+ ' +
          (uses.length - shown.length) +
          ' More</button>';
      }
    }
    html += '</div><button type="button" class="rb-btn rb-btn-link" data-rb="use">Use in New Assessment</button></div>';
    return html;
  }

  function _scopeHtml() {
    if (!otherClasses(_s.cid).length) return '';
    var all = _s.scope === 'all';
    return (
      '<div class="rb-scope" role="group" aria-label="Which rubrics">' +
      '<button type="button" class="rb-scope-btn' +
      (all ? '' : ' is-active') +
      '" data-rb="scope" data-scope="class" aria-pressed="' +
      (all ? 'false' : 'true') +
      '">This Class</button>' +
      '<button type="button" class="rb-scope-btn' +
      (all ? ' is-active' : '') +
      '" data-rb="scope" data-scope="all" aria-pressed="' +
      (all ? 'true' : 'false') +
      '">All My Classes</button></div>'
    );
  }

  function _overlayHtml() {
    return (
      '<div class="rb-card" role="dialog" aria-modal="true" aria-labelledby="rb-heading">' +
      '<div class="rb-head"><h2 class="rb-heading" id="rb-heading">Rubric Bank</h2>' +
      '<div id="rb-scope">' +
      _scopeHtml() +
      '</div>' +
      '<div class="rb-head-gap"></div>' +
      '<button type="button" class="rb-btn rb-btn-new" data-rb="new">+ New Rubric</button>' +
      '<button type="button" class="rb-close" data-rb="close" aria-label="Close"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' +
      '</div>' +
      '<div class="rb-body"><div class="rb-side">' +
      '<label class="rb-search"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>' +
      '<input type="search" id="rb-search" placeholder="Search Rubrics" aria-label="Search rubrics or competencies" value="' +
      esc(_s.query) +
      '"></label>' +
      '<div class="rb-list" id="rb-list">' +
      listHtml() +
      '</div>' +
      '<div class="rb-hint">↑ ↓ to move through the list. Enter opens the editor.</div>' +
      '</div><div class="rb-pane" id="rb-pane">' +
      paneHtml() +
      '</div></div></div>'
    );
  }

  function _root() {
    return document.getElementById(OVERLAY_ID);
  }

  function _renderList() {
    var el = document.getElementById('rb-list');
    if (el) el.innerHTML = listHtml();
  }

  function _renderPane() {
    var el = document.getElementById('rb-pane');
    if (el) el.innerHTML = paneHtml();
    var input = document.getElementById('rb-rename');
    if (input) {
      input.focus();
      input.select();
    }
  }

  function refresh() {
    if (!_s || !_root()) return;
    var scope = document.getElementById('rb-scope');
    if (scope) scope.innerHTML = _scopeHtml();
    _renderList();
    _renderPane();
  }

  /* ── Actions ───────────────────────────────────────────── */

  function _select(rid, cid) {
    if (!rid) return;
    _s.selected = rid;
    _s.selCid = cid || _s.cid;
    _s.menuOpen = false;
    _s.renaming = false;
    _s.allUses = false;
    if (_s.selCid === _s.cid) _saveSelected(_s.cid, rid);
    refresh();
    var row = _root() && _root().querySelector('.rb-row.is-selected');
    if (row && row.scrollIntoView) row.scrollIntoView({ block: 'nearest' });
  }

  /* Up and Down walk the rows as drawn, across open class groups too. */
  function _step(dir) {
    var rows = Array.prototype.slice.call(_root().querySelectorAll('#rb-list .rb-row'));
    if (!rows.length) return;
    var i = rows.findIndex(function (row) {
      return row.dataset.rid === _s.selected && row.dataset.cid === _s.selCid;
    });
    var next = rows[i < 0 ? 0 : Math.max(0, Math.min(rows.length - 1, i + dir))];
    _select(next.dataset.rid, next.dataset.cid);
    var row = _root() && _root().querySelector('.rb-row.is-selected');
    if (row && row.focus) row.focus();
  }

  /* All My Classes needs the other classes' rubrics on this device. */
  function _loadOthers() {
    if (_s.loaded) return;
    var cid = _s.cid;
    var load = window.RubricLibrary && RubricLibrary.loadClass;
    var ids = otherClasses(cid).map(function (c) {
      return c.id;
    });
    Promise.all(ids.map(load || Promise.resolve.bind(Promise))).then(function () {
      if (!_s || _s.cid !== cid) return;
      _s.loaded = true;
      _renderList();
    });
  }

  function _setScope(scope) {
    _s.scope = scope === 'all' ? 'all' : 'class';
    _s.openClasses = {};
    _s.openClasses[_s.cid] = true;
    if (_s.scope === 'all') _loadOthers();
    else if (_isForeign()) {
      _s.selCid = _s.cid;
      _s.selected = _loadSelected(_s.cid);
    }
    refresh();
  }

  /* Copy another class's rubric here, then show it in This Class. */
  function _copyHere() {
    var cid = _s.cid;
    var src = _s.selCid;
    var rubric = getRubricById(src, _s.selected);
    if (!rubric || !window.RubricLibrary) return;
    RubricLibrary.copyTo(src, rubric, [cid]).then(function (done) {
      if (_s && _s.hooks.changed) _s.hooks.changed();
      if (!_s || _s.cid !== cid || !done[0]) return;
      _s.scope = 'class';
      _select(done[0].rubric.id, cid);
    });
  }

  function _finishRename(save) {
    var input = document.getElementById('rb-rename');
    if (save && input && !rename(_s.cid, _s.selected, input.value)) {
      input.classList.add('is-invalid');
      input.setAttribute('aria-invalid', 'true');
      return;
    }
    _s.renaming = false;
    refresh();
    if (save && _s.hooks.changed) _s.hooks.changed();
    var title = document.getElementById('rb-title');
    if (title) title.setAttribute('tabindex', '-1');
  }

  function _act(action, el) {
    var cid = _s.cid;
    var hooks = _s.hooks;
    var rid = _s.selected;
    if (action !== 'more') _s.menuOpen = false;
    switch (action) {
      case 'close':
        close();
        break;
      case 'scope':
        _setScope(el.dataset.scope);
        break;
      case 'group':
        _s.openClasses[el.dataset.cid] = !_s.openClasses[el.dataset.cid];
        _renderList();
        break;
      case 'select':
        _select(el.dataset.rid, el.dataset.cid);
        break;
      case 'new':
        close();
        if (hooks.newRubric) hooks.newRubric();
        break;
      case 'copy-here':
        _copyHere();
        break;
      case 'edit':
        if (_isForeign()) break;
        close();
        if (hooks.edit) hooks.edit(rid);
        break;
      case 'print': {
        var uses = usesOf(cid, rid);
        if (!uses.length) break;
        close();
        if (hooks.print) hooks.print(rid, uses[0].id);
        break;
      }
      case 'copy':
        RubricLibrary.openCopyDialog(cid, rid, function () {
          if (hooks.changed) hooks.changed();
          refresh();
        });
        break;
      case 'more':
        _s.menuOpen = !_s.menuOpen;
        _renderPane();
        if (_s.menuOpen) {
          var first = _root().querySelector('.rb-menu button');
          if (first) first.focus();
        }
        break;
      case 'duplicate': {
        var copy = duplicate(cid, rid);
        if (hooks.changed) hooks.changed();
        if (copy) _select(copy.id, cid);
        break;
      }
      case 'rename':
        _s.renaming = true;
        _renderPane();
        break;
      case 'delete':
        _renderPane();
        if (hooks.remove) hooks.remove(rid);
        break;
      case 'more-uses':
        _s.allUses = true;
        _renderPane();
        break;
      case 'goto':
        close();
        if (hooks.goToAssessment) hooks.goToAssessment(el.dataset.aid);
        break;
      case 'use':
        close();
        if (hooks.useInNew) hooks.useInNew(rid);
        break;
    }
  }

  function _onKey(e) {
    if (!_s) return;
    // A dialog opened from here (Copy, Delete) handles its own keys.
    var top = document.querySelector('.confirm-overlay');
    if (top) return;
    var target = e.target;
    if (target && target.id === 'rb-rename') {
      if (e.key === 'Enter') {
        e.preventDefault();
        _finishRename(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        _finishRename(false);
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      if (_s.menuOpen) {
        _s.menuOpen = false;
        _renderPane();
        var more = _root().querySelector('[data-rb="more"]');
        if (more) more.focus();
      } else {
        close();
      }
      return;
    }
    var inList = target && (target.id === 'rb-search' || (target.closest && target.closest('#rb-list')));
    if (!inList) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      _step(e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'Enter' && _s.selected && !(target.dataset && target.dataset.rb === 'group')) {
      e.preventDefault();
      _act('edit');
    }
  }

  /* ── Open and close ────────────────────────────────────── */

  function open(cid, hooks) {
    close();
    if (!cid) return;
    _s = {
      cid: cid,
      hooks: hooks || {},
      scope: 'class',
      selected: _loadSelected(cid),
      selCid: cid,
      query: '',
      openClasses: {},
      loaded: false,
      menuOpen: false,
      renaming: false,
      allUses: false,
      trigger: document.activeElement,
    };
    _s.openClasses[cid] = true;
    _current();
    var overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.className = 'rb-overlay';
    overlay.innerHTML = _overlayHtml();
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) {
        close();
        return;
      }
      if (_s.menuOpen && !(e.target.closest && e.target.closest('.rb-more-wrap'))) {
        _s.menuOpen = false;
        _renderPane();
      }
      var btn = e.target.closest ? e.target.closest('[data-rb]') : null;
      if (btn) _act(btn.dataset.rb, btn);
    });
    overlay.addEventListener('input', function (e) {
      if (e.target && e.target.id === 'rb-search') {
        _s.query = e.target.value;
        _renderList();
      }
    });
    overlay.addEventListener('focusout', function (e) {
      if (e.target && e.target.id === 'rb-rename' && _s && _s.renaming) _finishRename(true);
    });
    _s.keyHandler = _onKey;
    document.addEventListener('keydown', _s.keyHandler);
    document.body.appendChild(overlay);
    var search = document.getElementById('rb-search');
    if (search) search.focus();
  }

  function close() {
    var overlay = _root();
    if (overlay && overlay.remove) overlay.remove();
    if (!_s) return;
    document.removeEventListener('keydown', _s.keyHandler);
    var trigger = _s.trigger;
    _s = null;
    try {
      if (trigger && document.body.contains(trigger) && trigger.focus) trigger.focus();
    } catch (e) {
      /* the button may have been redrawn */
    }
  }

  function isOpen() {
    return !!_s;
  }

  return {
    open: open,
    close: close,
    refresh: refresh,
    isOpen: isOpen,
    usesOf: usesOf,
    matches: matches,
    groups: groups,
    otherClasses: otherClasses,
    rowMeta: rowMeta,
    linkedLabel: linkedLabel,
    matchInfo: matchInfo,
    deleteImpact: deleteImpact,
    confirmDelete: confirmDelete,
    duplicate: duplicate,
    rename: rename,
    gridHtml: gridHtml,
  };
})();
