/* grading-setup-copy.js — one class's grading setup in another class.
 *
 * A teacher with several sections sets up grading once and copies it, as
 * Teams' "Import settings" does. "Copy grading setup…" in Class Management
 * copies to other classes or imports from one; "Copy from another class"
 * beside the categories imports the categories alone.
 *
 * What copies: grading system, categories and weights, calculation method,
 * course % rounding, late work policy, and (only when ticked) reporting
 * terms. Categories are matched by name: a same-named category keeps its id,
 * so its assessments stay in it. A category the source doesn't have is
 * removed, and its assessments move to one the teacher picks first.
 * Copies are not linked, and scores are never touched.
 */
window.GradingSetupCopy = (function () {
  'use strict';

  var GROUPS = [
    { key: 'gradingSystem', label: 'Grading system', on: true },
    { key: 'categories', label: 'Categories and weights', on: true },
    { key: 'calcMethod', label: 'Calculation method', on: true },
    { key: 'roundPercent', label: 'Course %', on: true },
    { key: 'lateWorkPolicy', label: 'Late work policy', on: true },
    // Dates belong to one school year (docs/DECISIONS.md, Reporting periods 6).
    { key: 'reportingTerms', label: 'Reporting terms', on: false },
  ];

  var SYSTEM_LABELS = { proficiency: 'Proficiency', letter: 'Letter', both: 'Both' };
  var METHOD_LABELS = {
    mostRecent: 'Most Recent',
    highest: 'Highest',
    average: 'Mean',
    median: 'Median',
    mode: 'Mode',
    decayingAvg: 'Decaying Avg',
  };

  function _norm(s) {
    return String(s == null ? '' : s)
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  }

  function _className(cid) {
    return (COURSES[cid] && COURSES[cid].name) || 'another class';
  }

  function _plural(n, one, many) {
    return n + ' ' + (n === 1 ? one : many);
  }

  function _toast(message) {
    if (typeof showSyncToast !== 'function') return;
    try {
      showSyncToast(message, 'info');
    } catch (e) {
      /* a toast is only a courtesy */
    }
  }

  /* Make another class's data available without switching to it. */
  function loadClass(cid) {
    if (typeof initData !== 'function') return Promise.resolve();
    return Promise.resolve(initData(cid)).catch(function (e) {
      console.warn('Could not load class for copying:', cid, e);
    });
  }

  /* ── Reading a class's setup ───────────────────────────────── */
  function _sortedCategories(cid) {
    return (getCategories(cid) || []).slice().sort(function (a, b) {
      return (Number(a.displayOrder) || 0) - (Number(b.displayOrder) || 0);
    });
  }

  function _calcOf(cid) {
    var cc = getCourseConfig(cid) || {};
    var course = COURSES[cid] || {};
    var method = cc.calcMethod || course.calcMethod || 'mostRecent';
    var dw = cc.decayWeight != null ? cc.decayWeight : course.decayWeight || 0.65;
    return { method: method, decayWeight: Number(dw) };
  }

  function _calcLabel(calc) {
    var label = METHOD_LABELS[calc.method] || calc.method;
    if (calc.method === 'decayingAvg') label += ' (' + Math.round(calc.decayWeight * 100) + '%)';
    return label;
  }

  function _termsKey(terms) {
    return JSON.stringify(
      (terms || []).map(function (t) {
        return [t.label, t.starts_on, t.ends_on];
      }),
    );
  }

  /* The source's value for each group, as the dialog shows it. */
  function describeSource(cid) {
    var cats = _sortedCategories(cid);
    var terms = getReportingTerms(cid);
    var late = (COURSES[cid] && COURSES[cid].lateWorkPolicy) || '';
    return {
      gradingSystem: SYSTEM_LABELS[courseGradeMode(cid)],
      categories: cats.length
        ? cats
            .map(function (c) {
              return (c.name || 'Unnamed') + ' ' + (Number(c.weight) || 0) + '%';
            })
            .join(', ')
        : '',
      calcMethod: _calcLabel(_calcOf(cid)),
      roundPercent: getRoundWholePercent(cid) ? 'Whole number' : 'One decimal',
      lateWorkPolicy: late || 'None',
      reportingTerms: terms.length
        ? terms
            .map(function (t) {
              return t.label;
            })
            .join(', ')
        : 'None',
    };
  }

  /* ── Categories ────────────────────────────────────────────── */
  /* What the source's categories would do in dstCid. Nothing is saved.
     rows: the target's new list, in the source's order; a row with an id
     is an existing category kept under that id. */
  function planCategories(srcCid, dstCid) {
    var src = _sortedCategories(srcCid);
    var dst = _sortedCategories(dstCid);
    var used = {};
    var rows = src.map(function (s, i) {
      var hit = dst.find(function (d) {
        return !used[d.id] && _norm(d.name) === _norm(s.name);
      });
      if (hit) used[hit.id] = true;
      return {
        id: hit ? hit.id : null,
        name: String(s.name || '').trim(),
        weight: Number(s.weight) || 0,
        displayOrder: i,
        before: hit ? { name: hit.name, weight: Number(hit.weight) || 0, order: dst.indexOf(hit) } : null,
      };
    });
    var assessments = getAssessments(dstCid) || [];
    var catOf = function (a) {
      return (a && (a.categoryId || a.category_id)) || '';
    };
    var removed = dst
      .filter(function (d) {
        return !used[d.id];
      })
      .map(function (d) {
        return {
          id: d.id,
          name: d.name || 'Unnamed',
          count: assessments.filter(function (a) {
            return catOf(a) === d.id;
          }).length,
        };
      });
    var dstIds = dst.map(function (d) {
      return d.id;
    });
    var uncategorized = assessments.filter(function (a) {
      return dstIds.indexOf(catOf(a)) < 0;
    }).length;

    var lines = [];
    rows.forEach(function (r) {
      if (!r.before) {
        lines.push('Add ' + r.name + ' at ' + r.weight + '%.');
        return;
      }
      if (r.before.weight !== r.weight) lines.push(r.name + ': ' + r.before.weight + '% → ' + r.weight + '%.');
      if (r.before.name !== r.name) lines.push('Rename ' + r.before.name + ' to ' + r.name + '.');
    });
    removed.forEach(function (d) {
      lines.push(
        'Remove ' +
          d.name +
          (d.count ? ' (' + _plural(d.count, 'assessment moves', 'assessments move') + ')' : '') +
          '.',
      );
    });
    var kept = rows.filter(function (r) {
      return r.before;
    });
    var reordered = kept.some(function (r, i) {
      return i > 0 && r.before.order < kept[i - 1].before.order;
    });
    if (reordered) lines.push('Put the categories in the same order.');
    var same = !lines.length;
    // Work with no category only moves when the list changes; otherwise
    // Class Management already offers to move it.
    if (!same && uncategorized)
      lines.push(
        _plural(uncategorized, 'assessment has', 'assessments have') +
          ' no category, so ' +
          (uncategorized === 1 ? 'it doesn’t' : 'they don’t') +
          ' count toward the letter grade until moved.',
      );

    return {
      available: src.length > 0,
      rows: rows,
      removed: removed,
      uncategorized: same ? 0 : uncategorized,
      lines: lines,
      same: same,
    };
  }

  /* ── Planning a whole copy ─────────────────────────────────── */
  /* groups: { key: true } for the ticked groups. Both classes must be
     loaded. Returns { dstCid, dstName, changes: [{ key, label, lines }],
     same: [labels already matching], skipped: [notes], categories }. */
  function planSetup(srcCid, dstCid, groups) {
    var plan = { srcCid: srcCid, dstCid: dstCid, dstName: _className(dstCid), changes: [], same: [], skipped: [] };
    var srcCourse = COURSES[srcCid] || {};
    var dstCourse = COURSES[dstCid] || {};
    function add(key, lines) {
      var label = GROUPS.find(function (g) {
        return g.key === key;
      }).label;
      if (lines.length) plan.changes.push({ key: key, label: label, lines: lines });
      else plan.same.push(label);
    }

    if (groups.gradingSystem) {
      var a = courseGradeMode(srcCid);
      var b = courseGradeMode(dstCid);
      add('gradingSystem', a === b ? [] : [SYSTEM_LABELS[b] + ' → ' + SYSTEM_LABELS[a] + '.']);
    }
    if (groups.categories) {
      var cats = planCategories(srcCid, dstCid);
      if (!cats.available) plan.skipped.push(_className(srcCid) + ' has no categories, so the categories here stay.');
      else {
        plan.categories = cats;
        add('categories', cats.same ? [] : cats.lines);
      }
    }
    if (groups.calcMethod) {
      var ca = _calcOf(srcCid);
      var cb = _calcOf(dstCid);
      var calcSame = ca.method === cb.method && (ca.method !== 'decayingAvg' || ca.decayWeight === cb.decayWeight);
      add('calcMethod', calcSame ? [] : [_calcLabel(cb) + ' → ' + _calcLabel(ca) + '.']);
    }
    if (groups.roundPercent) {
      var ra = getRoundWholePercent(srcCid);
      var rb = getRoundWholePercent(dstCid);
      var rl = function (w) {
        return w ? 'Whole number' : 'One decimal';
      };
      add('roundPercent', ra === rb ? [] : [rl(rb) + ' → ' + rl(ra) + '.']);
    }
    if (groups.lateWorkPolicy) {
      var la = (srcCourse.lateWorkPolicy || '').trim();
      var lb = (dstCourse.lateWorkPolicy || '').trim();
      add('lateWorkPolicy', la === lb ? [] : [la ? 'Use “' + la + '”.' : 'Clear the late work policy.']);
    }
    if (groups.reportingTerms) {
      var ta = getReportingTerms(srcCid);
      var tb = getReportingTerms(dstCid);
      add(
        'reportingTerms',
        _termsKey(ta) === _termsKey(tb)
          ? []
          : [
              ta.length
                ? 'Use ' +
                  ta
                    .map(function (t) {
                      return t.label + ' (' + t.starts_on + ' to ' + t.ends_on + ')';
                    })
                    .join(', ') +
                  '.'
                : 'Remove the reporting terms.',
            ],
      );
    }
    return plan;
  }

  /* ── Applying ──────────────────────────────────────────────── */
  function _wait(queue, cid) {
    return Promise.resolve(queue && queue[cid]);
  }

  function _categoryQueue() {
    return typeof _categorySaveQueue !== 'undefined' ? _categorySaveQueue : null;
  }

  function _assessmentQueue() {
    return typeof _assessmentSaveQueue !== 'undefined' ? _assessmentSaveQueue : null;
  }

  function _saveCats(cid, rows) {
    saveCategories(
      cid,
      rows.map(function (r, i) {
        return { id: r.id, name: r.name, weight: r.weight, displayOrder: i };
      }),
    );
    return _wait(_categoryQueue(), cid);
  }

  /* After a save lands, the cache holds the server's ids in list order. */
  function _landedIds(cid, rows) {
    var cached = _sortedCategories(cid);
    return rows.map(function (r, i) {
      var byName = cached.find(function (c) {
        return _norm(c.name) === _norm(r.name);
      });
      return (cached[i] && _norm(cached[i].name) === _norm(r.name) ? cached[i].id : byName && byName.id) || r.id;
    });
  }

  /* moves: { [removedCategoryId]: rowIndex, uncategorized: rowIndex | null }.
     The server refuses to delete a category that still has assessments, so
     a removed category that has some stays at 0% until its work has moved:
     1. save the new list plus those categories at 0% (still totals 100),
     2. move the work and wait for it to land,
     3. save the final list, which deletes them. */
  function _applyCategories(dstCid, cats, moves) {
    moves = moves || {};
    var rows = cats.rows.map(function (r) {
      return { id: r.id || uid(), name: r.name, weight: r.weight };
    });
    var holding = cats.removed
      .filter(function (d) {
        return d.count > 0;
      })
      .map(function (d) {
        return { id: d.id, name: d.name, weight: 0 };
      });
    var moveUncat = cats.uncategorized > 0 && moves.uncategorized != null && moves.uncategorized !== '';
    var removedIds = cats.removed.map(function (d) {
      return d.id;
    });
    var knownIds = removedIds.concat(
      cats.rows
        .filter(function (r) {
          return r.id;
        })
        .map(function (r) {
          return r.id;
        }),
    );

    return _saveCats(dstCid, rows.concat(holding)).then(function () {
      if (!holding.length && !moveUncat) return;
      var ids = _landedIds(dstCid, rows);
      // Signed in, a category the server hasn't saved has no id to point
      // work at yet (offline, or the save was refused). Leave the work where
      // it is; Class Management offers the move once the list lands.
      var writes = typeof _writesEnabled === 'function' && _writesEnabled() && _isUuid(dstCid);
      if (writes && !ids.every(_isUuid)) return;
      var target = function (idx) {
        var i = Number(idx);
        return ids[i >= 0 && i < ids.length ? i : 0];
      };
      var moved = 0;
      var list = (getAssessments(dstCid) || []).map(function (a) {
        var cur = (a && (a.categoryId || a.category_id)) || '';
        var to = null;
        if (removedIds.indexOf(cur) >= 0) to = target(moves[cur]);
        else if (moveUncat && knownIds.indexOf(cur) < 0) to = target(moves.uncategorized);
        if (!to) return a;
        moved++;
        return Object.assign({}, a, { categoryId: to, category_id: to });
      });
      if (moved) saveAssessments(dstCid, list);
      return _wait(_assessmentQueue(), dstCid).then(function () {
        if (!holding.length) return;
        var finalRows = rows.map(function (r, i) {
          return { id: ids[i], name: r.name, weight: r.weight };
        });
        return _saveCats(dstCid, finalRows);
      });
    });
  }

  /* Apply one class's plan. Resolves when every write has been handed to the
     data layer (and, for categories, landed in order). */
  function applySetup(plan, moves) {
    var srcCid = plan.srcCid;
    var dstCid = plan.dstCid;
    var keys = {};
    plan.changes.forEach(function (c) {
      keys[c.key] = true;
    });
    var courseUpdates = {};
    var cc = Object.assign({}, getCourseConfig(dstCid) || {});
    var ccChanged = false;
    if (keys.gradingSystem) courseUpdates.gradingSystem = courseGradeMode(srcCid);
    if (keys.calcMethod) {
      var calc = _calcOf(srcCid);
      courseUpdates.calcMethod = calc.method;
      courseUpdates.decayWeight = calc.decayWeight;
      cc.calcMethod = calc.method;
      cc.decayWeight = calc.decayWeight;
      ccChanged = true;
    }
    if (keys.roundPercent) {
      cc.roundPercent = !!getRoundWholePercent(srcCid);
      ccChanged = true;
    }
    if (keys.lateWorkPolicy) {
      var late = ((COURSES[srcCid] && COURSES[srcCid].lateWorkPolicy) || '').trim();
      courseUpdates.lateWorkPolicy = late || null;
    }
    if (Object.keys(courseUpdates).length) updateCourse(dstCid, courseUpdates);
    if (ccChanged) saveCourseConfig(dstCid, cc);
    if (keys.reportingTerms) saveReportingTerms(dstCid, getReportingTerms(srcCid));
    var done = keys.categories && plan.categories ? _applyCategories(dstCid, plan.categories, moves) : null;
    return Promise.resolve(done).then(function () {
      if (typeof clearProfCache === 'function') clearProfCache();
      return plan;
    });
  }

  /* ── Dialogs ───────────────────────────────────────────────── */
  function _groupsHtml(srcCid, only) {
    if (!srcCid) return '';
    var src = describeSource(srcCid);
    return GROUPS.map(function (g) {
      var noCats = g.key === 'categories' && !src.categories;
      var checked = only ? g.key === only : g.on;
      return (
        '<label class="copy-review-check gsc-group' +
        (noCats ? ' af-copy-has' : '') +
        '"><input type="checkbox" data-gsc-group="' +
        g.key +
        '"' +
        (checked && !noCats ? ' checked' : '') +
        (noCats ? ' disabled' : '') +
        '> <span><strong>' +
        esc(g.label) +
        '</strong> <span class="copy-review-muted">· ' +
        esc(noCats ? 'none in ' + _className(srcCid) : src[g.key]) +
        '</span></span></label>'
      );
    }).join('');
  }

  function _readGroups(root) {
    var groups = {};
    root.querySelectorAll('[data-gsc-group]:checked').forEach(function (cb) {
      groups[cb.dataset.gscGroup] = true;
    });
    return groups;
  }

  function _classRows(targets, type, name) {
    var row = function (c) {
      return (
        '<label class="copy-review-check"><input type="' +
        type +
        '" name="' +
        name +
        '" value="' +
        esc(c.id) +
        '"> ' +
        esc(c.name) +
        '</label>'
      );
    };
    var parts = targets.sameCourse.map(row);
    if (targets.sameCourse.length && targets.other.length)
      parts.push('<div class="rubric-copy-group">Other classes</div>');
    return parts.concat(targets.other.map(row)).join('');
  }

  /* opts: { mode: 'to' | 'from', only: group key, onDone(dstCids) }. */
  function openDialog(cid, opts) {
    opts = opts || {};
    var targets = AssessmentCopy.copyTargets(cid);
    if (!targets.sameCourse.length && !targets.other.length) {
      _toast('You have no other classes to copy with.');
      return;
    }
    var mode = opts.mode || 'to';
    var only = opts.only || null;
    var title = only === 'categories' ? 'Copy categories' : 'Copy grading setup';
    var html =
      '<div class="seg cm-seg gsc-mode" role="radiogroup" aria-label="Direction">' +
      '<button type="button" class="seg-btn cm-seg-btn" role="radio" data-gsc-mode="to">Copy to other classes</button>' +
      '<button type="button" class="seg-btn cm-seg-btn" role="radio" data-gsc-mode="from">Import from another class</button>' +
      '</div>' +
      '<div id="gsc-classes"></div>' +
      '<div class="copy-review-note" id="gsc-groups-title"></div>' +
      '<div id="gsc-groups" class="copy-from-list"></div>';

    function srcOf(root) {
      if (mode === 'to') return cid;
      var sel = root.querySelector('#gsc-from');
      return sel ? sel.value : null;
    }

    function dstsOf(root) {
      if (mode === 'from') return [cid];
      return Array.from(root.querySelectorAll('input[name="gsc-dst"]:checked')).map(function (cb) {
        return cb.value;
      });
    }

    function fillGroups(root) {
      var srcCid = srcOf(root);
      var box = root.querySelector('#gsc-groups');
      var kept = box.querySelector('[data-gsc-group]') ? _readGroups(root) : null;
      root.querySelector('#gsc-groups-title').textContent = 'What to copy:';
      box.textContent = 'Loading…';
      loadClass(srcCid).then(function () {
        if (srcOf(root) !== srcCid) return;
        box.innerHTML = _groupsHtml(srcCid, only);
        if (kept)
          box.querySelectorAll('[data-gsc-group]:not(:disabled)').forEach(function (cb) {
            cb.checked = !!kept[cb.dataset.gscGroup];
          });
        updateOk(root);
      });
    }

    function render(root) {
      root.querySelectorAll('[data-gsc-mode]').forEach(function (b) {
        var on = b.dataset.gscMode === mode;
        b.classList.toggle('active', on);
        b.setAttribute('aria-checked', String(on));
      });
      var classes = root.querySelector('#gsc-classes');
      if (mode === 'to') {
        classes.innerHTML =
          '<div class="copy-review-note">Copy ' +
          esc(_className(cid)) +
          '’s setup into:</div><div class="copy-from-list">' +
          _classRows(targets, 'checkbox', 'gsc-dst') +
          '</div>';
      } else {
        var all = targets.sameCourse.concat(targets.other);
        classes.innerHTML =
          '<label class="copy-review-field">Import into ' +
          esc(_className(cid)) +
          ' from <select class="af-input" id="gsc-from">' +
          all
            .map(function (c) {
              return '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>';
            })
            .join('') +
          '</select></label>';
        classes.querySelector('#gsc-from').addEventListener('change', function () {
          fillGroups(root);
        });
      }
      fillGroups(root);
      updateOk(root);
    }

    function updateOk(root) {
      var ok = root.querySelector('[data-copy-ok]');
      if (!ok) return;
      var n = dstsOf(root).length;
      var g = Object.keys(_readGroups(root)).length;
      ok.disabled = !n || !g;
    }

    AssessmentCopy.dialog({
      title: title,
      html: html,
      okLabel: 'Review changes',
      onOpen: function (root) {
        render(root);
        root.addEventListener('click', function (e) {
          var b = e.target.closest && e.target.closest('[data-gsc-mode]');
          if (!b || b.dataset.gscMode === mode) return;
          mode = b.dataset.gscMode;
          render(root);
        });
        root.addEventListener('change', function () {
          updateOk(root);
        });
      },
      onOk: function (root) {
        var srcCid = srcOf(root);
        var dsts = dstsOf(root);
        var groups = _readGroups(root);
        if (!srcCid || !dsts.length || !Object.keys(groups).length) return false;
        Promise.all(dsts.map(loadClass)).then(function () {
          var plans = dsts.map(function (d) {
            return planSetup(srcCid, d, groups);
          });
          review(plans, opts.onDone);
        });
        return true;
      },
    });
  }

  /* Where a removed category's work most likely belongs: a new category
     sharing its first word ("Quizzes" → "Quizzes & Checks"), else the first. */
  function _guessRow(name, rows) {
    var word = _norm(name).split(/[^a-z0-9]+/)[0];
    if (!word) return 0;
    var i = rows.findIndex(function (r) {
      return (
        _norm(r.name)
          .split(/[^a-z0-9]+/)
          .indexOf(word) >= 0
      );
    });
    return i < 0 ? 0 : i;
  }

  function _moveSelect(attr, rows, selected, allowNone) {
    return (
      '<select class="af-input" ' +
      attr +
      '>' +
      rows
        .map(function (r, i) {
          return '<option value="' + i + '"' + (i === selected ? ' selected' : '') + '>' + esc(r.name) + '</option>';
        })
        .join('') +
      (allowNone ? '<option value="">Leave them with no category</option>' : '') +
      '</select>'
    );
  }

  /* Show every class's changes; the teacher picks where moved work goes. */
  function review(plans, onDone) {
    var changing = plans.filter(function (p) {
      return p.changes.length;
    });
    if (!changing.length) {
      var notes = plans.reduce(function (acc, p) {
        return acc.concat(p.skipped);
      }, []);
      _toast(
        notes[0] ||
          (plans.length === 1
            ? _className(plans[0].dstCid) + ' already has this setup.'
            : 'Those classes already have this setup.'),
      );
      return;
    }
    var html =
      '<div class="copy-review-note">From ' +
      esc(_className(plans[0].srcCid)) +
      '. Grades in these classes will follow the new setup. Scores are not changed.</div>' +
      plans
        .map(function (p, pi) {
          var out = '<div class="copy-review-class"><div class="copy-review-name">' + esc(p.dstName) + '</div>';
          if (!p.changes.length) out += '<div class="copy-review-note copy-review-muted">Already the same.</div>';
          p.changes.forEach(function (c) {
            out +=
              '<div class="copy-review-note"><strong>' +
              esc(c.label) +
              '</strong></div><ul class="copy-change-list">' +
              c.lines
                .map(function (l) {
                  return '<li>' + esc(l) + '</li>';
                })
                .join('') +
              '</ul>';
            if (c.key !== 'categories') return;
            var cats = p.categories;
            cats.removed.forEach(function (d) {
              if (!d.count) return;
              out +=
                '<label class="copy-review-field">Move the ' +
                _plural(d.count, 'assessment', 'assessments') +
                ' in ' +
                esc(d.name) +
                ' to ' +
                _moveSelect(
                  'data-gsc-move="' + pi + '" data-gsc-cat="' + esc(d.id) + '"',
                  cats.rows,
                  _guessRow(d.name, cats.rows),
                  false,
                ) +
                '</label>';
            });
            if (cats.uncategorized)
              out +=
                '<label class="copy-review-field">Put the ' +
                _plural(cats.uncategorized, 'assessment', 'assessments') +
                ' with no category in ' +
                _moveSelect('data-gsc-move="' + pi + '" data-gsc-cat="uncategorized"', cats.rows, 0, true) +
                '</label>';
          });
          if (p.same.length && p.changes.length)
            out +=
              '<div class="copy-review-note copy-review-muted">Already the same: ' + esc(p.same.join(', ')) + '.</div>';
          p.skipped.forEach(function (s) {
            out += '<div class="copy-review-note copy-review-muted">' + esc(s) + '</div>';
          });
          return out + '</div>';
        })
        .join('');
    var n = changing.length;
    AssessmentCopy.dialog({
      title: 'Check before copying',
      html: html,
      okLabel: n === 1 ? 'Copy setup' : 'Copy to ' + _plural(n, 'class', 'classes'),
      cancelLabel: 'Don’t copy',
      onOk: function (root) {
        var movesByPlan = plans.map(function () {
          return {};
        });
        root.querySelectorAll('[data-gsc-move]').forEach(function (sel) {
          movesByPlan[Number(sel.dataset.gscMove)][sel.dataset.gscCat] = sel.value === '' ? null : Number(sel.value);
        });
        Promise.all(
          plans.map(function (p, i) {
            return p.changes.length ? applySetup(p, movesByPlan[i]) : null;
          }),
        ).then(function () {
          _toast(
            'Copied the grading setup to ' +
              changing
                .map(function (p) {
                  return p.dstName;
                })
                .join(', ') +
              '.',
          );
          if (onDone)
            onDone(
              changing.map(function (p) {
                return p.dstCid;
              }),
            );
        });
        return true;
      },
    });
  }

  return {
    GROUPS: GROUPS,
    describeSource: describeSource,
    planCategories: planCategories,
    planSetup: planSetup,
    applySetup: applySetup,
    openDialog: openDialog,
    review: review,
  };
})();
