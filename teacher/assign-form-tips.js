// @ts-check
/* assign-form-tips.js — Assignments: card tips and the form's hover-overs. Moved from teacher/page-assignments.js
   on 2026-11-26 with scripts/split/cut.mjs, as text, unchanged. PageAssignments hands
   over what this file uses through configure(). It loads before page-assignments.js. */
/** @type {any} */ (window).AssignFormTips = (function () {
  'use strict';

  /* Handed over by PageAssignments (configure). */
  var pageState,
    _afAfterPause,
    _byKeyboard,
    _compCounts,
    _getAssessmentCategoryId,
    _holdsGrades,
    _loadDibelsOnce,
    _newFormHtml,
    _refreshClassResultsSoon,
    _renderGrader,
    _returnShownIds,
    _seedReturns,
    _syncCodes,
    refreshLedgerSummary,
    renderAssessToolbar,
    renderAssessmentList,
    sortAssessmentsForList;
  function configure(h) {
    if ('pageState' in h) pageState = h.pageState;
    if ('_afAfterPause' in h) _afAfterPause = h._afAfterPause;
    if ('_byKeyboard' in h) _byKeyboard = h._byKeyboard;
    if ('_compCounts' in h) _compCounts = h._compCounts;
    if ('_getAssessmentCategoryId' in h) _getAssessmentCategoryId = h._getAssessmentCategoryId;
    if ('_holdsGrades' in h) _holdsGrades = h._holdsGrades;
    if ('_loadDibelsOnce' in h) _loadDibelsOnce = h._loadDibelsOnce;
    if ('_newFormHtml' in h) _newFormHtml = h._newFormHtml;
    if ('_refreshClassResultsSoon' in h) _refreshClassResultsSoon = h._refreshClassResultsSoon;
    if ('_renderGrader' in h) _renderGrader = h._renderGrader;
    if ('_returnShownIds' in h) _returnShownIds = h._returnShownIds;
    if ('_seedReturns' in h) _seedReturns = h._seedReturns;
    if ('_syncCodes' in h) _syncCodes = h._syncCodes;
    if ('refreshLedgerSummary' in h) refreshLedgerSummary = h.refreshLedgerSummary;
    if ('renderAssessToolbar' in h) renderAssessToolbar = h.renderAssessToolbar;
    if ('renderAssessmentList' in h) renderAssessmentList = h.renderAssessmentList;
    if ('sortAssessmentsForList' in h) sortAssessmentsForList = h.sortAssessmentsForList;
  }

  function _chipTipAttrs(name, text) {
    return ' tabindex="0" data-chip-tip="' + esc(text) + '" data-chip-tip-name="' + esc(name) + '"';
  }

  /* The card's scoring and Factor (Nov 3 sweep): how the work is scored,
     unless its rubric chip already says so, and its Factor when it isn't
     1x, so a teacher needn't open the form or the gradebook to see them. */
  function _cardScoringBadges(a) {
    var mode = a.scoreMode || 'proficiency';
    var kind = '';
    var tip = '';
    if (mode === 'points') {
      kind = formatPoints(Number(a.maxPoints) || 100) + ' Points';
      tip = 'Scored in points.';
    } else if (mode === 'complete') {
      kind = 'Complete/Incomplete';
      tip = 'Scored Complete or Incomplete.';
    } else if (mode === 'dibels') {
      kind = 'DIBELS';
      tip = 'A DIBELS 8 benchmark. It counts toward no grade.';
    } else if (!a.rubricId || !getRubricById(pageState.activeCourse, a.rubricId)) {
      kind = 'Competencies';
      tip = 'Scored on each competency, with no rubric.';
    }
    var factor = getAssessmentWeight(a);
    return (
      (kind ? '<span class="score-badge"' + _chipTipAttrs(kind, tip) + '>' + esc(kind) + '</span>' : '') +
      (factor !== 1 && mode !== 'dibels'
        ? '<span class="score-badge"' +
          _chipTipAttrs(
            'Factor ' + formatFactor(factor),
            'Counts ' + formatPoints(factor) + ' times as much as work at Factor 1\u00d7.',
          ) +
          '>' +
          esc('Factor ' + formatFactor(factor)) +
          '</span>'
        : '')
    );
  }

  function _categoryChipTip(cid, categoryId) {
    if (!categoryId) return 'This work has no category.';
    var category = getCategoryById(cid, categoryId);
    if (!category) return 'This work’s category can’t be found.';
    var weight = Number(category.weight || 0);
    return weight > 0
      ? 'Category worth ' + weight + '% of the course grade.'
      : 'Category worth 0%, so this work doesn’t count toward the course grade.';
  }

  function _showChipTip(chip) {
    var tip = document.getElementById('gb-tooltip');
    if (!tip) return;
    tip.className = 'dark';
    tip.setAttribute('role', 'tooltip');
    tip.innerHTML =
      '<div class="gb-code-tip"><strong>' +
      esc(chip.dataset.chipTipName) +
      '</strong>' +
      (chip.dataset.chipTip || chip.dataset.nameTipText
        ? '<div class="gb-code-tip-group">' + esc(chip.dataset.chipTip || chip.dataset.nameTipText) + '</div>'
        : '') +
      '</div>';
    tip.style.display = 'block';
    pageState._chipTipSource = chip;
    chip.setAttribute('aria-describedby', 'gb-tooltip');
    var rect = chip.getBoundingClientRect();
    var left = rect.left + rect.width / 2 - tip.offsetWidth / 2;
    if (left < 8) left = 8;
    if (left + tip.offsetWidth > window.innerWidth - 8) left = window.innerWidth - tip.offsetWidth - 8;
    var top = rect.bottom + 6;
    if (top + tip.offsetHeight > window.innerHeight - 8) top = rect.top - tip.offsetHeight - 6;
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  }

  /* A criterion name cut off in the score grid shows in full in the same
     tip (a competency row adds its wording): after a short hover, so it
     doesn't flash up while grading, or at once on a tap. */
  var NAME_TIP_MS = 600;

  function _hasNameTip(label) {
    var name = label.querySelector('.rsg-criterion-name');
    return !!label.dataset.nameTipText || (!!name && name.scrollWidth > name.clientWidth);
  }
  function _queueNameTip(label) {
    clearTimeout(pageState._nameTipTimer);
    if (!_hasNameTip(label)) return;
    pageState._nameTipTimer = setTimeout(function () {
      if (label.isConnected) _showChipTip(label);
    }, NAME_TIP_MS);
  }

  function _hideChipTip() {
    clearTimeout(pageState._nameTipTimer);
    if (!pageState._chipTipSource) return;
    pageState._chipTipSource.removeAttribute('aria-describedby');
    pageState._chipTipSource = null;
    var tip = document.getElementById('gb-tooltip');
    if (tip) {
      tip.style.display = 'none';
      tip.className = '';
      tip.removeAttribute('role');
    }
  }

  /* A folder's checkbox ticks or unticks every competency in it; it shows a
     dash when only some are ticked (Colin, Nov 2). _syncCodes keeps it in
     step with the competencies. */
  function _afGroupBox(secs, name) {
    return (
      '<input type="checkbox" class="af-group-cb" data-tags="' +
      esc(_afSecTagIds(secs)) +
      '" data-action-change="tickGroup" aria-label="' +
      esc('All of ' + name) +
      '">'
    );
  }
  function _tickGroup(box) {
    var ids = String(box.dataset.tags || '')
      .split(',')
      .filter(Boolean);
    /** @type {any[]} */
    var boxes = ids
      .map(function (id) {
        return document.querySelector('.af-tag-cb[value="' + CSS.escape(id) + '"]');
      })
      .filter(Boolean);
    var allOn = boxes.every(function (cb) {
      return cb.checked;
    });
    boxes.forEach(function (cb) {
      if (cb.checked === allOn && !cb.disabled) cb.click();
    });
    _syncCodes();
  }

  function _afSecTagIds(secs) {
    return (secs || [])
      .map(function (sec) {
        return sec.tags && sec.tags[0] ? sec.tags[0].id : '';
      })
      .filter(Boolean)
      .join(',');
  }

  // The class's other assessments (not the one being edited), newest first.
  function _afOtherAssessments(cid) {
    return getAssessments(cid)
      .filter(function (a) {
        return a && a.id !== pageState._editingAssessId;
      })
      .sort(function (a, b) {
        return String(b.dateAssigned || b.date || '').localeCompare(String(a.dateAssigned || a.date || ''));
      });
  }

  function _afPlural(n, one, many) {
    return n + ' ' + (n === 1 ? one : many);
  }

  function _afLatest(list) {
    var a = list[0];
    if (!a) return '';
    var d = a.dateAssigned || a.date;
    return 'last ' + a.title + (d ? ', ' + formatDate(d) : '');
  }

  // { html, dark } for one hover target, or null.
  function _afTipContent(el) {
    var cid = pageState.activeCourse;
    var kind = el.dataset.afTip;
    var all = _afOtherAssessments(cid);
    if (kind === 'comp') {
      var tag = getTagById(cid, el.dataset.tag);
      if (!tag) return null;
      var sec = (getSections(cid) || []).find(function (x) {
        return (x.tags || []).some(function (t) {
          return t.id === tag.id;
        });
      });
      var used = all.filter(function (a) {
        return (a.tagIds || []).indexOf(tag.id) >= 0;
      });
      var icans = (tag.i_can_statements || []).filter(Boolean);
      // Where it comes from: the curriculum, the course and its folder.
      var folder = sec && sec.groupId ? getCompetencyGroupById(cid, sec.groupId) : null;
      var source = [
        tag.bank_id ? 'BC Curriculum' : '',
        (COURSES[cid] || {}).name,
        folder ? folder.name : sec ? sec.name : '',
      ]
        .filter(Boolean)
        .join(' \u00b7 ');
      return {
        dark: true,
        html:
          '<div class="gb-code-tip"><strong>' +
          esc([tag.code, tag.label || tag.shortName].filter(Boolean).join(' \u00b7 ')) +
          '</strong>' +
          (tag.text ? '<div>' + esc(tag.text) + '</div>' : '') +
          (icans.length
            ? '<ul class="gb-code-tip-icans">' +
              icans
                .map(function (x) {
                  return '<li>' + esc(x) + '</li>';
                })
                .join('') +
              '</ul>'
            : '') +
          '<div class="gb-code-tip-group">' +
          esc(source) +
          '</div><div class="af-tip-strong">' +
          esc(
            used.length
              ? 'Scored on ' + _afPlural(used.length, 'assessment', 'assessments') + ' so far \u00b7 ' + _afLatest(used)
              : 'Not scored on any assessment yet.',
          ) +
          '</div></div>',
      };
    }
    if (kind === 'folder') {
      var ids = String(el.dataset.tags || '')
        .split(',')
        .filter(Boolean);
      if (!ids.length) return null;
      var counts = _compCounts(cid, pageState._editingAssessId);
      return {
        dark: false,
        html:
          '<div class="gb-tip-head">' +
          esc(el.dataset.name + ' \u00b7 ' + _afPlural(ids.length, 'competency', 'competencies')) +
          '</div>' +
          ids
            .map(function (id) {
              var t = getTagById(cid, id);
              var n = counts[id] || 0;
              return (
                '<div class="gb-tip-row"><span class="gb-tip-label">' +
                esc([t && t.code, t && (t.label || t.shortName)].filter(Boolean).join(' ')) +
                '</span><span class="gb-tip-val">' +
                esc(_afPlural(n, 'assessment', 'assessments')) +
                '</span></div>'
              );
            })
            .join('') +
          '<div class="gb-tip-note gb-tip-foot">How many assessments have scored each one so far this year.</div>',
      };
    }
    if (kind === 'rubric') {
      var rid = /** @type {any} */ (document.getElementById('af-rubric') || {}).value;
      var rubric =
        pageState._pendingFormRubric && pageState._pendingFormRubric.id === rid
          ? pageState._pendingFormRubric
          : rid
            ? getRubricById(cid, rid)
            : null;
      if (!rubric) return null;
      var on = all.filter(function (a) {
        return a.rubricId === rubric.id;
      });
      return {
        dark: false,
        html:
          '<div class="gb-tip-head">' +
          esc(rubric.name + ' \u00b7 ' + _afPlural((rubric.criteria || []).length, 'criterion', 'criteria')) +
          '</div>' +
          (rubric.criteria || [])
            .map(function (c) {
              return (
                '<div class="gb-tip-row"><span class="gb-tip-label">' +
                esc(c.name || '') +
                '</span><span class="gb-tip-val">' +
                esc(
                  (c.tagIds || [])
                    .map(function (id) {
                      var t = getTagById(cid, id);
                      return (t && t.code) || id;
                    })
                    .join(' '),
                ) +
                '</span></div>'
              );
            })
            .join('') +
          ((rubric.tagIds || []).length
            ? '<div class="gb-tip-row"><span class="gb-tip-label">Whole Rubric</span><span class="gb-tip-val">' +
              esc(
                rubric.tagIds
                  .map(function (id) {
                    var t = getTagById(cid, id);
                    return (t && t.code) || id;
                  })
                  .join(' '),
              ) +
              '</span></div>'
            : '') +
          '<div class="gb-tip-note gb-tip-foot">' +
          esc(
            on.length
              ? 'Used on ' + _afPlural(on.length, 'assessment', 'assessments') + ' \u00b7 ' + _afLatest(on)
              : 'Not used on any other assessment yet.',
          ) +
          '</div>',
      };
    }
    if (kind === 'factor') {
      var w = FactorField.read(el);
      var pct = courseShowsLetterGrades(COURSES[cid]) ? ' and the course %' : '';
      var how =
        w === 1
          ? 'Counts once toward each competency it scores' +
            pct +
            '. 2\u00d7 counts it twice; 0.5\u00d7 counts it half.'
          : w === 2
            ? 'Counts twice toward each competency it scores' + pct + '.'
            : w === 0.5
              ? 'Counts half toward each competency it scores' + pct + '.'
              : 'Counts ' + formatFactor(w) + ' toward each competency it scores' + pct + '.';
      return {
        dark: true,
        html:
          '<div class="gb-code-tip"><strong>' +
          esc('Factor ' + formatFactor(w)) +
          '</strong><div class="gb-code-tip-group">' +
          esc(how) +
          '</div></div>',
      };
    }
    if (kind === 'core') {
      var cc = /** @type {any} */ (getCoreCompetency(el.dataset.cc));
      if (!cc) return null;
      var bank = window.BANK_CORE_COMPETENCIES && window.BANK_CORE_COMPETENCIES[cc.id];
      var tagged = all.filter(function (a) {
        return (a.coreCompetencyIds || []).indexOf(cc.id) >= 0;
      });
      return {
        dark: true,
        html:
          '<div class="gb-code-tip"><strong>' +
          esc(cc.label) +
          '</strong>' +
          (bank ? '<div>' + esc(bank.description) + '</div>' : '') +
          '<div class="gb-code-tip-group">' +
          esc(
            cc.group +
              ' \u00b7 tagged on ' +
              tagged.length +
              ' of ' +
              _afPlural(all.length, 'assessment', 'assessments') +
              (tagged.length ? ' \u00b7 last ' + tagged[0].title : ''),
          ) +
          '</div></div>',
      };
    }
    return null;
  }

  function _afLoadCore() {
    if (window.BANK_CORE_COMPETENCIES || pageState._afCoreLoading || typeof document === 'undefined')
      return pageState._afCoreLoading;
    pageState._afCoreLoading = new Promise(
      /** @param {(value?: any) => void} resolve */ function (resolve) {
        var s = document.createElement('script');
        s.src = '/shared/bank-core-competencies.js';
        s.onload = s.onerror = function () {
          resolve();
        };
        document.head.appendChild(s);
      },
    );
    return pageState._afCoreLoading;
  }

  function _showAfTip(el, byKeyboard) {
    var tip = document.getElementById('gb-tooltip');
    if (!tip) return;
    if (el.dataset.afTip === 'core' && !window.BANK_CORE_COMPETENCIES) {
      var load = _afLoadCore();
      if (load)
        load.then(function () {
          if (pageState._afTipSource === el) _showAfTip(el, byKeyboard);
        });
    }
    var content = _afTipContent(el);
    if (!content) return _hideAfTip();
    _hideChipTip();
    tip.className = (content.dark ? 'dark ' : '') + 'af-tip';
    tip.setAttribute('role', 'tooltip');
    // html-safe: _afTipContent escapes every value
    tip.innerHTML = content.html;
    tip.style.display = 'block';
    if (pageState._afTipSource && pageState._afTipSource !== el) _afUndescribe(pageState._afTipSource);
    if (pageState._afTipSource !== el) {
      // Keep what the field was already described by (the category's hint).
      el.dataset.afDescribedBy = el.getAttribute('aria-describedby') || '';
      el.setAttribute('aria-describedby', (el.dataset.afDescribedBy + ' gb-tooltip').trim());
    }
    pageState._afTipSource = el;
    var rect = el.getBoundingClientRect();
    var left = rect.left + rect.width / 2 - tip.offsetWidth / 2;
    if (left < 8) left = 8;
    if (left + tip.offsetWidth > window.innerWidth - 8) left = window.innerWidth - tip.offsetWidth - 8;
    var above = rect.top - tip.offsetHeight - 6;
    var below = rect.bottom + 6;
    var top = byKeyboard && above >= 8 ? above : below;
    if (top + tip.offsetHeight > window.innerHeight - 8) top = above >= 8 ? above : 8;
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  }

  function _afUndescribe(el) {
    var before = el.dataset.afDescribedBy;
    if (before) el.setAttribute('aria-describedby', before);
    else el.removeAttribute('aria-describedby');
    delete el.dataset.afDescribedBy;
  }

  function _hideAfTip() {
    if (!pageState._afTipSource) return;
    _afUndescribe(pageState._afTipSource);
    pageState._afTipSource = null;
    var tip = document.getElementById('gb-tooltip');
    if (tip) {
      tip.style.display = 'none';
      tip.className = '';
      tip.removeAttribute('role');
    }
  }

  function _afTipTarget(e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-af-tip]') : null;
    return el && el.closest('#new-assess-form') ? el : null;
  }
  function _afTipOver(e) {
    var el = _afTipTarget(e);
    if (!el || el === pageState._afTipSource) return;
    _afAfterPause(el, function () {
      _showAfTip(el, false);
    });
  }
  function _afTipOut(e) {
    var el = _afTipTarget(e);
    if (
      el &&
      el === pageState._afTipSource &&
      !(e.relatedTarget && el.contains(e.relatedTarget)) &&
      el !== document.activeElement
    )
      _hideAfTip();
  }
  function _afTipFocus(e) {
    var el = _afTipTarget(e);
    if (el && _byKeyboard(e)) _showAfTip(el, true);
  }
  function _afTipBlur(e) {
    var el = _afTipTarget(e);
    if (el && el === pageState._afTipSource) _hideAfTip();
  }
  // Scrolling closes a hovered tip; a focused field's tip (the browser
  // scrolls a field into view as it's focused) moves with it.
  function _afTipScroll() {
    var el = pageState._afTipSource;
    if (!el) return;
    var a = document.activeElement;
    if (a && (a === el || el.contains(a)) && document.body.contains(el)) _showAfTip(el, true);
    else _hideAfTip();
  }
  // A changed category, date or Factor updates its open tip.
  function _afTipChange(e) {
    var el = _afTipTarget(e);
    if (el && el === pageState._afTipSource) _showAfTip(el, el === document.activeElement);
  }

  function _openFormToKeep(cid) {
    if (!pageState._showingNewForm) return null;
    var form = document.getElementById('new-assess-form');
    if (!form || form.dataset.cid !== cid || !form.querySelector('#af-title')) return null;
    return form;
  }

  function render() {
    _hideChipTip();
    _hideAfTip();
    if (pageState._grader) return _renderGrader();
    var cid = pageState.activeCourse;
    var course = COURSES[cid];
    if (!course) return;
    pageState._pageBehind = false;
    // A signed-in class's student work, read again now and then (S6-W1).
    if (typeof refreshStudentWork === 'function') refreshStudentWork(cid);
    _loadDibelsOnce(cid);
    var sections = getSections(cid);
    var allAssessments = sortAssessmentsForList(getAssessments(cid));
    var students = sortStudents(getStudents(cid), 'lastName');
    var scores = getScores(cid);
    var modules = getModules(cid);

    // Apply filters
    var assessments = allAssessments;
    if (pageState.filterCategories.length > 0) {
      assessments = assessments.filter(function (a) {
        var catId = _getAssessmentCategoryId(a);
        return catId && pageState.filterCategories.indexOf(catId) >= 0;
      });
    }
    if (pageState.assessSearch) {
      var q = pageState.assessSearch.toLowerCase();
      assessments = assessments.filter(function (a) {
        return (
          (a.title || '').toLowerCase().includes(q) ||
          (a.description || '').toLowerCase().includes(q) ||
          (a.tagIds || []).some(function (tid) {
            var tag = getTagById(cid, tid);
            return tid.toLowerCase().includes(q) || (tag && tag.label.toLowerCase().includes(q));
          }) ||
          (a.moduleId &&
            (function () {
              var mod = getModuleById(cid, a.moduleId);
              return mod && mod.name.toLowerCase().includes(q);
            })())
        );
      });
    }
    if (pageState.showUngraded) {
      assessments = assessments.filter(function (a) {
        return students.some(function (st) {
          var sc = scores[st.id] || [];
          return !scoreTagIds(a, cid).every(function (tid) {
            return sc.some(function (s) {
              return s.assessmentId === a.id && s.tagId === tid && isScoreEntered(a, s);
            });
          });
        });
      });
    }

    // What is waiting to return (S1-F2): the toolbar's count is the drafts
    // on screen, summed over the assessments listed; pressed, it leaves
    // only the assessments with one. A class that holds no grades has none.
    // Each card's counts are worked out here, once a draw, and handed to
    // the cards (nums).
    var shownIds = _returnShownIds(cid);
    var nums = {};
    assessments.forEach(function (a) {
      nums[a.id] = {};
    });
    pageState._toReturnTotal = 0;
    if (_holdsGrades(cid)) {
      assessments.forEach(function (a) {
        nums[a.id].drafts = GraderWork.draftsIn(cid, a.id, shownIds).length;
        pageState._toReturnTotal += nums[a.id].drafts;
      });
      // Returning the last draft turns the filter off.
      if (!pageState._toReturnTotal) pageState._toReturnOnly = false;
      if (pageState._toReturnOnly)
        assessments = assessments.filter(function (a) {
          return nums[a.id].drafts > 0;
        });
    } else pageState._toReturnOnly = false;

    // The Show bar (assign-show.js): each card's To Grade, Not In and
    // Submitted, the same counts as the gradebook's bar and the dashboard's
    // To Grade cell (GraderWork), over the students on screen; with
    // Submitted, To Grade or Not In on, only the assessments it counts.
    assessments = AssignShow.listed(cid, assessments, nums, shownIds);

    // Render toolbar
    var result = renderAssessToolbar(cid);
    // The bar's parts stay, only what changed is changed (keep-dom.js).
    KeepDom.patch(/** @type {Element} */ (document.getElementById('page-toolbar-mount')), result.toolbarHtml);

    // Render assessment list
    var keptForm = _openFormToKeep(cid);
    var keptFocus = keptForm && keptForm.contains(document.activeElement) ? document.activeElement : null;
    pageState._keepingForm = !!keptForm;
    pageState._drawnReturns = {};
    try {
      // html-safe: AssignList.html escapes every title and name (assign-list.js); renderAssessmentList is reviewed
      /** @type {any} */ (document.getElementById('main')).innerHTML = AssignList.on()
        ? AssignList.html(cid, assessments, allAssessments, _newFormHtml(cid))
        : renderAssessmentList(cid, assessments, allAssessments, students, scores, modules, nums, shownIds);
    } finally {
      pageState._keepingForm = false;
    }
    if (keptForm) {
      var freshForm = document.getElementById('new-assess-form');
      if (freshForm) freshForm.replaceWith(keptForm);
      if (keptFocus && keptFocus.isConnected) /** @type {any} */ (keptFocus).focus({ preventScroll: true });
    }
    _afterCardsDrawn(document.getElementById('main'));
    AssignList.afterDraw(document.getElementById('main'));
  }

  /* After a draw of the list or of cards: the ledgers' counts, the Class
     Results panel, and what was drawn to return remembered (S1-F2). */
  function _afterCardsDrawn(root) {
    var kept = pageState._drawnReturns || {};
    root.querySelectorAll('.assess-header[data-aid]').forEach(function (head) {
      head._countsHtml = kept['n' + head.dataset.aid];
    });
    root.querySelectorAll('.ldg-grid').forEach(refreshLedgerSummary);
    _refreshClassResultsSoon();
    _seedReturns(root);
    pageState._drawnReturns = null;
    CritComment.afterDraw();
  }

  return {
    configure: configure,
    _afGroupBox: _afGroupBox,
    _afSecTagIds: _afSecTagIds,
    _afTipBlur: _afTipBlur,
    _afTipChange: _afTipChange,
    _afTipFocus: _afTipFocus,
    _afTipOut: _afTipOut,
    _afTipOver: _afTipOver,
    _afTipScroll: _afTipScroll,
    _afterCardsDrawn: _afterCardsDrawn,
    _cardScoringBadges: _cardScoringBadges,
    _categoryChipTip: _categoryChipTip,
    _chipTipAttrs: _chipTipAttrs,
    _hasNameTip: _hasNameTip,
    _hideAfTip: _hideAfTip,
    _hideChipTip: _hideChipTip,
    _queueNameTip: _queueNameTip,
    _showChipTip: _showChipTip,
    _tickGroup: _tickGroup,
    render: render,
  };
})();
