/* grading-setup-copy.js — one class's grading setup in another class.
 *
 * A teacher with several sections sets up grading once and copies it, as
 * Teams' "Import settings" does. "Copy grading setup…" in Class Settings
 * copies to other classes or imports from one; "Copy from another class"
 * beside the categories imports the categories alone.
 *
 * What copies: grading system, categories and weights, calculation method,
 * Points and Proficiency (the markers: where each proficiency starts on a
 * points score and what each step counts as in the course %), course %
 * rounding, Rubric Levels (the order of the four levels), late work policy,
 * and (only when ticked) reporting terms. The dialogs are in
 * grading-setup-copy-dialog.js, which adds openDialog and review to this
 * module. Categories are matched by name: a same-named category keeps its id,
 * so its assessments stay in it. A category the source doesn't have is
 * removed, and its assessments move to one the teacher picks first.
 * Copies are not linked, and scores are never touched.
 */
window.GradingSetupCopy = (function () {
  'use strict';

  var GROUPS = [
    { key: 'gradingSystem', label: 'Grading System', on: true },
    { key: 'categories', label: 'Categories and Weights', on: true },
    { key: 'calcMethod', label: 'Calculation Method', on: true },
    { key: 'gradingScale', label: 'Points and Proficiency', on: true },
    { key: 'roundPercent', label: 'Course %', on: true },
    { key: 'levelOrder', label: 'Rubric Levels', on: true },
    { key: 'lateWorkPolicy', label: 'Late Work Policy', on: true },
    // Dates belong to one school year (docs/DECISIONS.md, Reporting periods 6).
    { key: 'reportingTerms', label: 'Reporting Terms', on: false },
  ];

  var SYSTEM_LABELS = { proficiency: 'Proficiency', letter: 'Letter', both: 'Both' };

  /* Rubric Levels as Class Details names it: 'asc' or 'desc'. */
  function _levelOrderOf(cid) {
    return levelOrderFor(cid)[0] === 1 ? 'asc' : 'desc';
  }
  function _levelOrderLabel(order) {
    return order === 'asc' ? 'Emerging First' : 'Extending First';
  }
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
    return (COURSES[cid] && courseDisplayName(COURSES[cid])) || 'another class';
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
    var method = cc.calcMethod || course.calcMethod || 'average';
    var dw = cc.decayWeight != null ? cc.decayWeight : course.decayWeight || 0.65;
    return {
      method: method,
      decayWeight: Number(dw),
      recentLimit: getRecentScoreLimit(cid),
      foldersCountAsOne: getFoldersCountAsOne(cid),
      coursesCountEqually: getCoursesCountEqually(cid),
    };
  }

  function _calcLabel(calc) {
    var label = METHOD_LABELS[calc.method] || calc.method;
    if (calc.method === 'decayingAvg') label += ' (' + Math.round(calc.decayWeight * 100) + '%)';
    if (calc.recentLimit && calc.method !== 'mostRecent') label += ', last ' + calc.recentLimit + ' scores';
    if (!calc.foldersCountAsOne) label += ', folders not counted as one';
    if (calc.coursesCountEqually) label += ', each course counted equally';
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
      gradingScale: '',
      roundPercent: getRoundWholePercent(cid) ? 'Whole Number' : 'One Decimal',
      levelOrder: _levelOrderLabel(_levelOrderOf(cid)),
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

  // A category's Calculation, as Class Settings names it.
  var _CALC_MODE_LABELS = { points: 'Total Points', percent: 'Average of Percentages' };

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
        calcMode: categoryCalcMode(s),
        displayOrder: i,
        before: hit
          ? {
              name: hit.name,
              weight: Number(hit.weight) || 0,
              calcMode: categoryCalcMode(hit),
              order: dst.indexOf(hit),
            }
          : null,
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
      if (r.before.calcMode !== r.calcMode)
        lines.push(r.name + ': ' + _CALC_MODE_LABELS[r.before.calcMode] + ' → ' + _CALC_MODE_LABELS[r.calcMode] + '.');
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
    // Class Settings already offers to move it.
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
      // The target's list this plan was worked out from: the copy is made
      // only if the server still holds it (_categoriesCurrent).
      opened: dst.map(function (d, i) {
        return { id: d.id, name: d.name, weight: d.weight, displayOrder: i, calcMode: categoryCalcMode(d) };
      }),
    };
  }

  /* ── Points and Proficiency ────────────────────────────────── */
  /* The markers copy whole: where each proficiency starts and what each step
     counts as. plan.scale is the source's; plan.scaleBefore the target's now,
     for the before and after pictures. When the course % of any student in the
     target would change and a reporting term there has already ended, the
     sentence that says every term changes is kept in plan.endedNote. */
  function planScale(plan, srcCid, dstCid, add) {
    var from = getGradingScale(dstCid);
    var to = getGradingScale(srcCid);
    plan.scaleBefore = structuredClone(from);
    plan.scale = structuredClone(to);
    var lines = CmPtsModel.lines(from, to);
    // Level names are part of the scale: a difference in them alone is a change too.
    if (JSON.stringify(from.labels || null) !== JSON.stringify(to.labels || null))
      lines.push('The level names change.');
    add('gradingScale', lines);
    var ended = CmGrading._cmEndedTerm(dstCid);
    if (ended && CmPtsModel.gradeEffects(dstCid, from, to).pctMoves)
      plan.endedNote =
        'This changes the course % for every term, including ' +
        (ended.label || 'Term ' + ended.ordinal) +
        ', which has already ended. Report cards printed before today won’t match.';
  }

  // Course % rounding, Rubric Levels and the late work policy: one line each.
  function planSimple(srcCid, dstCid, groups, add) {
    if (groups.roundPercent) {
      var ra = getRoundWholePercent(srcCid);
      var rb = getRoundWholePercent(dstCid);
      var rl = function (w) {
        return w ? 'Whole number' : 'One decimal';
      };
      add('roundPercent', ra === rb ? [] : [rl(rb) + ' → ' + rl(ra) + '.']);
    }
    if (groups.levelOrder) {
      var oa = _levelOrderOf(srcCid);
      var ob = _levelOrderOf(dstCid);
      add('levelOrder', oa === ob ? [] : [_levelOrderLabel(ob) + ' → ' + _levelOrderLabel(oa) + '.']);
    }
    if (groups.lateWorkPolicy) {
      var la = ((COURSES[srcCid] && COURSES[srcCid].lateWorkPolicy) || '').trim();
      var lb = ((COURSES[dstCid] && COURSES[dstCid].lateWorkPolicy) || '').trim();
      add('lateWorkPolicy', la === lb ? [] : [la ? 'Use “' + la + '”.' : 'Clear the late work policy.']);
    }
  }

  /* ── Planning a whole copy ─────────────────────────────────── */
  /* groups: { key: true } for the ticked groups. Both classes must be
     loaded. Returns { dstCid, dstName, changes: [{ key, label, lines }],
     same: [labels already matching], skipped: [notes], categories }. */
  function planSetup(srcCid, dstCid, groups) {
    var plan = { srcCid: srcCid, dstCid: dstCid, dstName: _className(dstCid), changes: [], same: [], skipped: [] };
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
      var calcSame =
        ca.method === cb.method &&
        (ca.method !== 'decayingAvg' || ca.decayWeight === cb.decayWeight) &&
        (ca.recentLimit || null) === (cb.recentLimit || null) &&
        ca.foldersCountAsOne === cb.foldersCountAsOne &&
        ca.coursesCountEqually === cb.coursesCountEqually;
      add('calcMethod', calcSame ? [] : [_calcLabel(cb) + ' → ' + _calcLabel(ca) + '.']);
    }
    if (groups.gradingScale) planScale(plan, srcCid, dstCid, add);
    planSimple(srcCid, dstCid, groups, add);
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

  // `copy`: { from, rest }, kept with the save in case it has to wait
  // (saveCategories in shared/data.js).
  function _saveCats(cid, rows, copy) {
    saveCategories(
      cid,
      rows.map(function (r, i) {
        return { id: r.id, name: r.name, weight: r.weight, displayOrder: i, calcMode: categoryCalcMode(r) };
      }),
      copy ? { copy: copy } : undefined,
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

  /* The copy replaces the target's whole list. If that list changed on
     another device after the plan was worked out, the plan is for a list
     that is gone: copying it would delete a category added there. So the
     server's list is read first (categoriesStillCurrent in shared/data.js).
     Resolves null to go ahead, else 'changed' or 'offline': the categories
     are then left as they are. */
  function _categoriesCurrent(dstCid, cats) {
    if (typeof categoriesStillCurrent !== 'function') return Promise.resolve(null);
    return Promise.resolve(categoriesStillCurrent(dstCid, cats.opened || [])).then(function (res) {
      return res && res.ok ? null : (res && res.why) || 'offline';
    });
  }

  /* moves: { [removedCategoryId]: rowIndex, uncategorized: rowIndex | null }.
     The server refuses to delete a category that still has assessments, so
     a removed category that has some stays at 0% until its work has moved:
     1. save the new list plus those categories at 0% (still totals 100),
     2. move the work and wait for it to land,
     3. save the final list, which deletes them. */
  function _applyCategories(dstCid, cats, moves, copy) {
    moves = moves || {};
    var rows = cats.rows.map(function (r) {
      return { id: r.id || uid(), name: r.name, weight: r.weight, calcMode: r.calcMode };
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

    return _saveCats(dstCid, rows.concat(holding), copy).then(function () {
      if (!holding.length && !moveUncat) return;
      var ids = _landedIds(dstCid, rows);
      // Signed in, a category the server hasn't saved has no id to point
      // work at yet (offline, or the save was refused). Leave the work where
      // it is; Class Settings offers the move once the list lands.
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
          return { id: ids[i], name: r.name, weight: r.weight, calcMode: r.calcMode };
        });
        return _saveCats(dstCid, finalRows, copy);
      });
    });
  }

  /* What a copy sets on the class's course row (courseUpdates) and in its
     settings (cc, a copy), for the ticked groups. True when cc changed. */
  function stageSettings(plan, keys, cc, courseUpdates) {
    var srcCid = plan.srcCid;
    var changed = false;
    if (keys.gradingSystem) courseUpdates.gradingSystem = courseGradeMode(srcCid);
    if (keys.calcMethod) {
      var calc = _calcOf(srcCid);
      courseUpdates.calcMethod = calc.method;
      courseUpdates.decayWeight = calc.decayWeight;
      cc.calcMethod = calc.method;
      cc.decayWeight = calc.decayWeight;
      cc.recentScoreLimit = calc.recentLimit;
      cc.foldersCountAsOne = calc.foldersCountAsOne;
      cc.coursesCountEqually = calc.coursesCountEqually;
      changed = true;
    }
    if (keys.gradingScale) {
      cc.gradingScale = structuredClone(plan.scale);
      changed = true;
    }
    if (keys.roundPercent) {
      cc.roundPercent = !!getRoundWholePercent(srcCid);
      changed = true;
    }
    if (keys.levelOrder) {
      cc.levelOrder = _levelOrderOf(srcCid);
      changed = true;
    }
    if (keys.lateWorkPolicy) {
      var late = ((COURSES[srcCid] && COURSES[srcCid].lateWorkPolicy) || '').trim();
      courseUpdates.lateWorkPolicy = late || null;
    }
    return changed;
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
    var ccChanged = stageSettings(plan, keys, cc, courseUpdates);
    if (Object.keys(courseUpdates).length) updateCourse(dstCid, courseUpdates);
    if (ccChanged) saveCourseConfig(dstCid, cc);
    if (keys.reportingTerms) saveReportingTerms(dstCid, getReportingTerms(srcCid));
    var done =
      keys.categories && plan.categories
        ? _categoriesCurrent(dstCid, plan.categories).then(function (why) {
            // Not copied: plan.categoriesNotCopied says why ('changed' on
            // another device, or 'offline'), and the class says so itself
            // above its categories when it is next opened in Class
            // Settings: the message after the copy is gone in seconds.
            var note = {
              from: _className(srcCid),
              rest: plan.changes.some(function (c) {
                return c.key !== 'categories';
              }),
            };
            if (!why) return _applyCategories(dstCid, plan.categories, moves, note);
            plan.categoriesNotCopied = why;
            if (typeof noteCategoriesNotCopied === 'function') {
              noteCategoriesNotCopied(dstCid, { why: why, from: note.from, rest: note.rest });
            }
          })
        : null;
    return Promise.resolve(done).then(function () {
      if (typeof clearProfCache === 'function') clearProfCache();
      return plan;
    });
  }

  /* What the teacher is told after a copy. Categories left alone because
     they changed on another device, or could not be checked, are named. */
  function copiedMessage(changing) {
    var names = function (plans) {
      return plans
        .map(function (p) {
          return p.dstName;
        })
        .join(', ');
    };
    var changed = changing.filter(function (p) {
      return p.categoriesNotCopied === 'changed';
    });
    var offline = changing.filter(function (p) {
      return p.categoriesNotCopied && p.categoriesNotCopied !== 'changed';
    });
    if (!changed.length && !offline.length) return 'Copied the grading setup to ' + names(changing) + '.';
    var parts = [];
    if (changed.length)
      parts.push('The categories in ' + names(changed) + ' changed on another device, so they were not copied.');
    if (offline.length)
      parts.push('Categories need a connection to copy, so the categories in ' + names(offline) + ' were not copied.');
    var more = changing.some(function (p) {
      return p.changes.some(function (c) {
        return c.key !== 'categories' || !p.categoriesNotCopied;
      });
    });
    if (more) parts.push('Everything else was copied.');
    return parts.join(' ');
  }

  /* ── The check step ────────────────────────────────────────── */
  /* Where a removed category's work most likely belongs: a new category
     sharing its first word ("Quizzes" → "Quizzes & Checks"), else the first. */
  function guessRow(name, rows) {
    var norm = function (s) {
      return String(s == null ? '' : s)
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
    };
    var word = norm(name).split(/[^a-z0-9]+/)[0];
    if (!word) return 0;
    var i = rows.findIndex(function (r) {
      return (
        norm(r.name)
          .split(/[^a-z0-9]+/)
          .indexOf(word) >= 0
      );
    });
    return i < 0 ? 0 : i;
  }

  /* With allowNone (work with no category), the select starts on "Choose a
     Category" and Copy waits for a choice; leaving the work is one of them
     (Colin, 2026-11-03: "Make me choose"). */
  function moveSelect(attr, rows, selected, allowNone) {
    return (
      '<select class="af-input" ' +
      attr +
      '>' +
      (allowNone ? '<option value="" selected>Choose a Category</option>' : '') +
      rows
        .map(function (r, i) {
          return '<option value="' + i + '"' + (i === selected ? ' selected' : '') + '>' + esc(r.name) + '</option>';
        })
        .join('') +
      (allowNone ? '<option value="none">Leave them with no category</option>' : '') +
      '</select>'
    );
  }

  // The category choices a plan asks for: where each removed category's work goes, and work with none.
  function moveFields(p, pi) {
    var cats = p.categories;
    var out = '';
    cats.removed.forEach(function (d) {
      if (!d.count) return;
      out +=
        '<label class="copy-review-field">Move the ' +
        _plural(d.count, 'assessment', 'assessments') +
        ' in ' +
        esc(d.name) +
        ' to ' +
        moveSelect(
          'data-gsc-move="' + pi + '" data-gsc-cat="' + esc(d.id) + '"',
          cats.rows,
          guessRow(d.name, cats.rows),
          false,
        ) +
        '</label>';
    });
    if (cats.uncategorized)
      out +=
        '<label class="copy-review-field">Put the ' +
        _plural(cats.uncategorized, 'assessment', 'assessments') +
        ' with no category in ' +
        moveSelect('data-gsc-move="' + pi + '" data-gsc-cat="uncategorized"', cats.rows, -1, true) +
        '</label>';
    return out;
  }

  // One class in the check step: its name, its markers before → after, what changes.
  // html-safe: names and lines through esc
  function classHtml(p, pi) {
    var out =
      '<div class="copy-review-class"><div class="gsc-review-head"><span class="copy-review-name">' +
      esc(p.dstName) +
      '</span>';
    if (p.scale)
      out +=
        '<span class="gsc-review-pair">' +
        mini(p.scaleBefore, p.dstName + '’s markers now') +
        '<span aria-hidden="true">→</span>' +
        mini(p.scale, p.dstName + '’s markers after copying') +
        '</span>';
    out += '</div>';
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
      if (c.key === 'categories') out += moveFields(p, pi);
      if (c.key === 'gradingScale' && p.endedNote)
        out += '<div class="copy-review-note copy-review-muted">' + esc(p.endedNote) + '</div>';
    });
    if (p.same.length && p.changes.length)
      out += '<div class="copy-review-note copy-review-muted">Already the same: ' + esc(p.same.join(', ')) + '.</div>';
    p.skipped.forEach(function (s) {
      out += '<div class="copy-review-note copy-review-muted">' + esc(s) + '</div>';
    });
    return out + '</div>';
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
    // html-safe: the source's name through esc; each class through classHtml
    var html =
      '<div class="copy-review-note">From ' +
      esc(_className(plans[0].srcCid)) +
      '. Grades in these classes will follow the new setup. Scores are not changed.</div>' +
      plans.map(classHtml).join('');
    var n = changing.length;
    var overlay = AssessmentCopy.dialog({
      title: 'Check Before Copying',
      html: html,
      okLabel: n === 1 ? 'Copy Setup' : 'Copy to ' + _plural(n, 'Class', 'Classes'),
      cancelLabel: 'Don’t Copy',
      onOpen: function (root) {
        root.classList.add('gsc-dialog');
        // A choice clears the outline a stopped Copy left.
        root.addEventListener('change', function (e) {
          var sel = e.target.closest('[data-gsc-move]');
          if (!sel) return;
          sel.style.border = '';
          sel.removeAttribute('aria-invalid');
        });
      },
      onOk: function (root) {
        var unchosen = Array.prototype.filter.call(root.querySelectorAll('[data-gsc-move]'), function (sel) {
          return sel.value === '';
        });
        if (unchosen.length) {
          unchosen.forEach(function (sel) {
            sel.style.border = '2px solid var(--score-1)';
            sel.setAttribute('aria-invalid', 'true');
          });
          unchosen[0].focus();
          return false;
        }
        var movesByPlan = plans.map(function () {
          return {};
        });
        root.querySelectorAll('[data-gsc-move]').forEach(function (sel) {
          movesByPlan[Number(sel.dataset.gscMove)][sel.dataset.gscCat] =
            sel.value === 'none' ? null : Number(sel.value);
        });
        Promise.all(
          plans.map(function (p, i) {
            return p.changes.length ? applySetup(p, movesByPlan[i]) : null;
          }),
        ).then(function () {
          _toast(copiedMessage(changing));
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
    return overlay;
  }

  // The small picture of a class's markers (grading-setup-copy-dialog.js draws it; both load together).
  function mini(scale, label) {
    return /** @type {any} */ (window).GradingSetupCopyDialog.mini(scale, label);
  }

  return {
    describeSource: describeSource,
    planCategories: planCategories,
    planSetup: planSetup,
    applySetup: applySetup,
    copiedMessage: copiedMessage,
    review: review,
    // For grading-setup-copy-dialog.js, which adds openDialog.
    GROUPS: GROUPS,
    loadClass: loadClass,
    className: _className,
    plural: _plural,
    toast: _toast,
  };
})();
