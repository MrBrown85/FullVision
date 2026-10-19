/* assessment-copy.js — one assessment in several classes.
 *
 * A teacher with two sections of the same course creates an assessment once
 * and adds it to the other class (Teams' "Assign to", JumpRope's "Classes").
 * Each class keeps its own ordinary assessment; the copies share a
 * `copyGroup` id so that editing one can offer to update the others.
 *
 * Nothing here touches scores. Category, competencies, rubric and folder are
 * matched by name in the other class; what can't be matched is shown to the
 * teacher before anything is saved.
 */
window.AssessmentCopy = (function () {
  'use strict';

  /* ── Small helpers ─────────────────────────────────────────── */
  function _norm(s) {
    return String(s == null ? '' : s)
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  }

  function newCopyGroup() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    // RFC 4122 v4 from Math.random, for old browsers and the test runner.
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  function _className(cid) {
    return (COURSES[cid] && COURSES[cid].name) || 'another class';
  }

  function _isLive(cid) {
    return !!COURSES[cid] && !(typeof isCourseArchived === 'function' && isCourseArchived(cid));
  }

  /* "English 9 - Block A", "English 9 (B)", "English 9 Period 3" and
     "English 9 B" are the same course. Brackets and a section word with its
     label are dropped, then a trailing single letter (never a number: the
     9 in "English 9" is the grade). */
  function _courseKey(name) {
    var s = _norm(name)
      .replace(/\(.*?\)/g, ' ')
      .replace(/\b(block|blk|section|sec|period|per)\b\s*[a-z0-9]*/g, ' ')
      .replace(/[-–—:|/]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return s.replace(/\s+[a-z]$/, '').trim();
  }

  function _sameCourse(a, b) {
    var ca = COURSES[a] || {};
    var cb = COURSES[b] || {};
    var ta = ca.curriculumTags || [];
    var tb = cb.curriculumTags || [];
    if (ta.length && tb.length) {
      return ta.some(function (t) {
        return tb.indexOf(t) >= 0;
      });
    }
    var ka = _courseKey(ca.name);
    return !!ka && ka === _courseKey(cb.name);
  }

  /* The teacher's other live classes, same course first. */
  function copyTargets(cid) {
    var sameCourse = [];
    var other = [];
    Object.keys(COURSES || {}).forEach(function (id) {
      if (id === cid || !_isLive(id)) return;
      var row = { id: id, name: _className(id) };
      (_sameCourse(cid, id) ? sameCourse : other).push(row);
    });
    var byName = function (a, b) {
      return a.name.localeCompare(b.name);
    };
    return { sameCourse: sameCourse.sort(byName), other: other.sort(byName) };
  }

  /* Make another class's data available without switching to it. */
  function loadClass(cid) {
    if (typeof initData !== 'function') return Promise.resolve();
    return Promise.resolve(initData(cid)).catch(function (e) {
      console.warn('Could not load class for copying:', cid, e);
    });
  }

  /* ── Matching ──────────────────────────────────────────────── */
  /* Each competency (one tag per section in the flat learning map), keyed by
     its short label, then its full text. */
  function _tagIndex(cid) {
    var byId = {};
    var byKey = {};
    (getSections(cid) || []).forEach(function (sec) {
      (sec.tags || []).forEach(function (tag) {
        var info = {
          id: tag.id,
          label: tag.label || tag.text || tag.code || '',
          text: tag.text || tag.i_can_text || '',
          section: sec.name || '',
        };
        byId[tag.id] = info;
        [_norm(info.label), _norm(info.text)].forEach(function (k) {
          if (!k) return;
          (byKey[k] = byKey[k] || []).push(info);
        });
      });
    });
    return { byId: byId, byKey: byKey };
  }

  function _matchTag(info, dstIndex) {
    var candidates = dstIndex.byKey[_norm(info.label)] || dstIndex.byKey[_norm(info.text)] || [];
    if (candidates.length <= 1) return candidates[0] || null;
    var sameSection = candidates.filter(function (c) {
      return _norm(c.section) === _norm(info.section);
    });
    return sameSection[0] || candidates[0] || null;
  }

  /* Source tag ids → { ids: target ids, dropped: labels with no match }. */
  function mapTags(srcCid, dstCid, tagIds) {
    var src = _tagIndex(srcCid);
    var dst = _tagIndex(dstCid);
    var ids = [];
    var dropped = [];
    (tagIds || []).forEach(function (id) {
      var info = src.byId[id];
      if (!info) return;
      var hit = _matchTag(info, dst);
      if (hit) {
        if (ids.indexOf(hit.id) < 0) ids.push(hit.id);
      } else dropped.push(info.label);
    });
    return { ids: ids, dropped: dropped };
  }

  function _byName(list, name) {
    var n = _norm(name);
    if (!n) return null;
    return (
      (list || []).find(function (x) {
        return _norm(x.name) === n;
      }) || null
    );
  }

  function _categoryOf(cid, a) {
    var id = a && (a.categoryId || a.category_id);
    if (!id) return null;
    return (
      (getCategories(cid) || []).find(function (c) {
        return c.id === id;
      }) || null
    );
  }

  function _rubricOf(cid, a) {
    if (!a || !a.rubricId) return null;
    return (
      (getRubrics(cid) || []).find(function (r) {
        return r.id === a.rubricId;
      }) || null
    );
  }

  function _moduleOf(cid, a) {
    if (!a || !a.moduleId) return null;
    return (
      (getModules(cid) || []).find(function (m) {
        return m.id === a.moduleId;
      }) || null
    );
  }

  /* What copying `a` from srcCid into dstCid would do. Both classes must be
     loaded. Nothing is saved. */
  function planCopy(srcCid, a, dstCid) {
    var plan = { srcCid: srcCid, dstCid: dstCid, dstName: _className(dstCid), notes: [], needsReview: false };

    // Category: same name, or the teacher picks one. A class with categories
    // needs one on every assessment (docs/grading-compliance-plan.md 1.4).
    var dstCats = (getCategories(dstCid) || []).slice().sort(function (x, y) {
      return (x.displayOrder || 0) - (y.displayOrder || 0);
    });
    var srcCat = _categoryOf(srcCid, a);
    var catHit = srcCat ? _byName(dstCats, srcCat.name) : null;
    plan.category = {
      id: catHit ? catHit.id : dstCats.length ? dstCats[0].id : null,
      srcName: srcCat ? srcCat.name : '',
      options: dstCats.map(function (c) {
        return { id: c.id, name: c.name };
      }),
      needsChoice: !catHit && dstCats.length > 0,
    };
    if (plan.category.needsChoice) plan.needsReview = true;

    var tags = mapTags(srcCid, dstCid, a.tagIds);
    plan.tagIds = tags.ids;
    plan.droppedTags = tags.dropped;
    if (tags.dropped.length) {
      plan.needsReview = true;
      plan.notes.push(
        (tags.dropped.length === 1 ? 'This competency isn’t' : 'These competencies aren’t') +
          ' in ' +
          plan.dstName +
          ' and will be left off: ' +
          tags.dropped.join(', ') +
          '.',
      );
    }

    var srcRubric = _rubricOf(srcCid, a);
    if (srcRubric) {
      var rubHit = _byName(getRubrics(dstCid), srcRubric.name);
      plan.rubric = rubHit
        ? { mode: 'match', id: rubHit.id, name: rubHit.name }
        : { mode: 'copy', source: srcRubric, name: srcRubric.name };
      if (!rubHit) {
        plan.needsReview = true;
        plan.notes.push('The rubric “' + srcRubric.name + '” will be copied into ' + plan.dstName + '.');
      }
    } else plan.rubric = { mode: 'none' };

    var srcModule = _moduleOf(srcCid, a);
    var modHit = srcModule ? _byName(getModules(dstCid), srcModule.name) : null;
    plan.moduleId = modHit ? modHit.id : null;
    if (srcModule && !modHit) {
      plan.notes.push(plan.dstName + ' has no module named “' + srcModule.name + '”, so it goes in No Module.');
    }

    if (a.collaboration === 'pair' || a.collaboration === 'group') {
      plan.notes.push('Pairs and groups are set up in each class, so the copy starts as individual work.');
    }
    return plan;
  }

  function _dateOf(a) {
    return a.dateAssigned || a.date || a.assigned_at || '';
  }
  function _dueOf(a) {
    return a.dueDate || a.due_date || '';
  }

  /* The new assessment for the target class, plus a rubric to add when the
     plan copies one. `dates` = { dateAssigned, dueDate } for this class. */
  function buildCopy(a, plan, dates, copyGroup) {
    var rubricToAdd = null;
    var rubricId = '';
    if (plan.rubric.mode === 'match') rubricId = plan.rubric.id;
    else if (plan.rubric.mode === 'copy') {
      rubricToAdd = _cloneRubric(plan.srcCid, plan.dstCid, plan.rubric.source);
      rubricId = rubricToAdd.id;
    }
    var assigned = (dates && dates.dateAssigned) || _dateOf(a);
    var due = dates && dates.dueDate !== undefined ? dates.dueDate : _dueOf(a);
    var copy = {
      id: uid(),
      title: a.title,
      date: assigned,
      dateAssigned: assigned,
      type: a.type || 'summative',
      tagIds: plan.tagIds.slice(),
      evidenceType: a.evidenceType,
      description: a.description || '',
      notes: '',
      created: new Date().toISOString(),
      copyGroup: copyGroup,
    };
    if (due) copy.dueDate = due;
    if (plan.category.id) {
      copy.categoryId = plan.category.id;
      copy.category_id = plan.category.id;
    }
    if (plan.moduleId) copy.moduleId = plan.moduleId;
    if (rubricId) copy.rubricId = rubricId;
    if (a.coreCompetencyIds && a.coreCompetencyIds.length) copy.coreCompetencyIds = a.coreCompetencyIds.slice();
    if (a.scoreMode && a.scoreMode !== 'proficiency') copy.scoreMode = a.scoreMode;
    if (a.maxPoints != null && a.scoreMode && a.scoreMode !== 'proficiency') copy.maxPoints = a.maxPoints;
    if (a.weight != null && a.weight !== 1) copy.weight = a.weight;
    return { assessment: copy, rubric: rubricToAdd };
  }

  function _cloneRubric(srcCid, dstCid, rubric) {
    return RubricLibrary.cloneRubric(srcCid, dstCid, rubric);
  }

  /* Save one planned copy into its class. */
  function applyCopy(a, plan, dates, copyGroup) {
    var built = buildCopy(a, plan, dates, copyGroup);
    if (built.rubric) saveRubrics(plan.dstCid, (getRubrics(plan.dstCid) || []).concat([built.rubric]));
    var list = (getAssessments(plan.dstCid) || []).slice();
    list.push(built.assessment);
    saveAssessments(plan.dstCid, list);
    return built.assessment;
  }

  /* ── Linked copies ─────────────────────────────────────────── */
  /* The other classes holding a copy of `a`: [{ cid, assessmentId, className }]. */
  function findCopies(cid, a) {
    if (!a || !a.copyGroup) return Promise.resolve([]);
    var useServer =
      typeof _writesEnabled === 'function' &&
      _writesEnabled() &&
      window.v2 &&
      typeof window.v2.listAssessmentCopies === 'function';
    if (useServer) {
      return window.v2.listAssessmentCopies(a.copyGroup).then(function (res) {
        return ((res && res.data) || [])
          .filter(function (r) {
            return r.course_id !== cid && COURSES[r.course_id];
          })
          .map(function (r) {
            return {
              cid: r.course_id,
              assessmentId: r.assessment_id,
              className: r.course_name || _className(r.course_id),
            };
          });
      });
    }
    // Demo Mode and local-only: every class is on this device.
    var others = Object.keys(COURSES || {}).filter(function (id) {
      return id !== cid && _isLive(id);
    });
    return Promise.all(others.map(loadClass)).then(function () {
      var out = [];
      others.forEach(function (id) {
        (getAssessments(id) || []).forEach(function (x) {
          if (x.copyGroup === a.copyGroup) out.push({ cid: id, assessmentId: x.id, className: _className(id) });
        });
      });
      return out;
    });
  }

  /* An assessment's fields as words that mean the same thing in any class. */
  function _view(cid, a) {
    var cat = _categoryOf(cid, a);
    var rub = _rubricOf(cid, a);
    var mod = _moduleOf(cid, a);
    var tags = _tagIndex(cid);
    return {
      title: a.title || '',
      description: a.description || '',
      dateAssigned: _dateOf(a),
      dueDate: _dueOf(a),
      scoreMode: a.scoreMode || 'proficiency',
      maxPoints: a.scoreMode && a.scoreMode !== 'proficiency' ? Number(a.maxPoints) || 0 : 0,
      weight: Number(a.weight) || 1,
      evidenceType: a.evidenceType || '',
      category: cat ? _norm(cat.name) : '',
      rubric: rub ? _norm(rub.name) : '',
      module: mod ? _norm(mod.name) : '',
      tags: (a.tagIds || [])
        .map(function (id) {
          return tags.byId[id] ? _norm(tags.byId[id].label) : '';
        })
        .filter(Boolean)
        .sort()
        .join('|'),
    };
  }

  var FIELD_LABELS = {
    title: 'title',
    description: 'description',
    dateAssigned: 'date assigned',
    dueDate: 'due date',
    scoreMode: 'scoring mode',
    maxPoints: 'max points',
    weight: 'proficiency weight',
    evidenceType: 'evidence type',
    category: 'category',
    rubric: 'rubric',
    module: 'module',
    tags: 'competencies',
  };

  /* What changed between `before` and `after` in srcCid, applied to a copy in
     dstCid only where the copy still matched `before`. A field the other
     class had already changed on its own (its own due date, say) is left
     alone and reported as skipped. */
  function planLinkedEdit(srcCid, before, after, dstCid, copy) {
    var b = _view(srcCid, before);
    var n = _view(srcCid, after);
    var c = _view(dstCid, copy);
    // Competencies the other class doesn't have were left off its copy, so
    // compare only the ones it has.
    var dstLabels = {};
    var dstTags = _tagIndex(dstCid).byId;
    Object.keys(dstTags).forEach(function (id) {
      dstLabels[_norm(dstTags[id].label)] = true;
    });
    var only = function (joined) {
      return joined
        .split('|')
        .filter(function (l) {
          return l && dstLabels[l];
        })
        .join('|');
    };
    b.tags = only(b.tags);
    n.tags = only(n.tags);
    var changes = {};
    var skipped = [];
    Object.keys(FIELD_LABELS).forEach(function (f) {
      if (b[f] === n[f]) return;
      if (c[f] !== b[f]) {
        skipped.push(FIELD_LABELS[f]);
        return;
      }
      changes[f] = true;
    });
    var patch = {};
    if (changes.title) patch.title = after.title;
    if (changes.description) patch.description = after.description || '';
    if (changes.dateAssigned) {
      patch.date = _dateOf(after);
      patch.dateAssigned = _dateOf(after);
    }
    if (changes.dueDate) patch.dueDate = _dueOf(after) || undefined;
    if (changes.scoreMode || changes.maxPoints) {
      patch.scoreMode = after.scoreMode;
      patch.maxPoints = after.maxPoints;
    }
    if (changes.weight) patch.weight = after.weight;
    if (changes.evidenceType) patch.evidenceType = after.evidenceType;
    if (changes.category) {
      var cat = _categoryOf(srcCid, after);
      var hit = cat ? _byName(getCategories(dstCid), cat.name) : null;
      if (hit) {
        patch.categoryId = hit.id;
        patch.category_id = hit.id;
      } else skipped.push('category');
    }
    if (changes.rubric) {
      var rub = _rubricOf(srcCid, after);
      if (!rub) patch.rubricId = undefined;
      else {
        var rhit = _byName(getRubrics(dstCid), rub.name);
        if (rhit) patch.rubricId = rhit.id;
        else skipped.push('rubric');
      }
    }
    if (changes.module) {
      var mod = _moduleOf(srcCid, after);
      var mhit = mod ? _byName(getModules(dstCid), mod.name) : null;
      patch.moduleId = mhit ? mhit.id : undefined;
    }
    if (changes.tags) patch.tagIds = mapTags(srcCid, dstCid, after.tagIds).ids;
    return { patch: patch, skipped: skipped, changed: Object.keys(patch).length > 0 };
  }

  function applyLinkedEdit(dstCid, assessmentId, patch) {
    var list = (getAssessments(dstCid) || []).map(function (x) {
      if (x.id !== assessmentId) return x;
      var next = Object.assign({}, x, patch);
      Object.keys(patch).forEach(function (k) {
        if (patch[k] === undefined) delete next[k];
      });
      return next;
    });
    saveAssessments(dstCid, list);
  }

  /* ── Dialogs ───────────────────────────────────────────────── */
  function _dialog(opts) {
    var triggerEl = document.activeElement;
    var overlay = document.createElement('div');
    overlay.className = 'confirm-overlay copy-dialog';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'copy-dialog-title');
    overlay.innerHTML =
      '<div class="confirm-card copy-dialog-card">' +
      '<div class="confirm-title" id="copy-dialog-title">' +
      esc(opts.title) +
      '</div>' +
      '<div class="copy-dialog-body">' +
      opts.html +
      '</div>' +
      '<div class="confirm-actions">' +
      '<button type="button" class="confirm-cancel" data-copy-cancel>' +
      esc(opts.cancelLabel || 'Cancel') +
      '</button>' +
      '<button type="button" class="confirm-ok primary" data-copy-ok>' +
      esc(opts.okLabel || 'OK') +
      '</button>' +
      '</div></div>';
    document.body.appendChild(overlay);
    function close() {
      overlay.remove();
      document.removeEventListener('keydown', keyHandler);
      try {
        if (triggerEl && typeof triggerEl.focus === 'function') triggerEl.focus();
      } catch (e) {
        /* trigger may be gone */
      }
    }
    function keyHandler(e) {
      if (e.key === 'Escape') {
        close();
        if (opts.onCancel) opts.onCancel();
        return;
      }
      if (e.key !== 'Tab') return;
      var f = overlay.querySelectorAll('button, select, input, [tabindex]:not([tabindex="-1"])');
      if (!f.length) return;
      var first = f[0];
      var last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', keyHandler);
    overlay.querySelector('[data-copy-ok]').addEventListener('click', function () {
      var keep = opts.onOk ? opts.onOk(overlay) : true;
      if (keep !== false) close();
    });
    overlay.querySelector('[data-copy-cancel]').addEventListener('click', function () {
      close();
      if (opts.onCancel) opts.onCancel();
    });
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) {
        close();
        if (opts.onCancel) opts.onCancel();
      }
    });
    if (opts.onOpen) opts.onOpen(overlay);
    // Land on the first thing to decide (a category picker, a class to
    // untick); OK only when there is nothing to decide.
    var focusEl =
      overlay.querySelector('.copy-dialog-body select, .copy-dialog-body input:not(:disabled)') ||
      overlay.querySelector('[data-copy-ok]');
    if (focusEl) focusEl.focus();
    return overlay;
  }

  /* Show the plans that need the teacher, if any. Resolves with the plans
     (category choices applied) or null when the teacher cancels. */
  function reviewPlans(plans, okLabel) {
    var needs = plans.filter(function (p) {
      return p.needsReview;
    });
    if (!needs.length) return Promise.resolve(plans);
    return new Promise(function (resolve) {
      var html = needs
        .map(function (p, i) {
          var out =
            '<div class="copy-review-class"><div class="copy-review-name">' + esc(p.heading || p.dstName) + '</div>';
          if (p.category.needsChoice) {
            out +=
              '<label class="copy-review-field">' +
              (p.category.srcName ? 'There’s no “' + esc(p.category.srcName) + '” category here. Use' : 'Category') +
              ' <select class="af-input" data-copy-cat="' +
              i +
              '">' +
              p.category.options
                .map(function (o) {
                  return (
                    '<option value="' +
                    esc(o.id) +
                    '"' +
                    (o.id === p.category.id ? ' selected' : '') +
                    '>' +
                    esc(o.name) +
                    '</option>'
                  );
                })
                .join('') +
              '</select></label>';
          }
          p.notes.forEach(function (n) {
            out += '<div class="copy-review-note">' + esc(n) + '</div>';
          });
          return out + '</div>';
        })
        .join('');
      _dialog({
        title: 'Check before adding',
        html: html,
        okLabel: okLabel || 'Add',
        cancelLabel: 'Don’t add',
        onOk: function (root) {
          needs.forEach(function (p, i) {
            var sel = root.querySelector('[data-copy-cat="' + i + '"]');
            if (sel) p.category.id = sel.value || null;
          });
          resolve(plans);
        },
        onCancel: function () {
          resolve(null);
        },
      });
    });
  }

  function _toast(message) {
    if (typeof showSyncToast !== 'function') return;
    try {
      showSyncToast(message, 'info');
    } catch (e) {
      /* a toast is only a courtesy */
    }
  }

  function _listNames(names) {
    if (names.length <= 1) return names[0] || '';
    return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
  }

  /* Copy `a` (already saved in srcCid with a copyGroup) into each target:
     [{ cid, dateAssigned?, dueDate? }]. */
  function copyToClasses(srcCid, a, targets) {
    if (!targets || !targets.length || !a.copyGroup) return Promise.resolve([]);
    return Promise.all(
      targets.map(function (t) {
        return loadClass(t.cid);
      }),
    )
      .then(function () {
        var plans = targets.map(function (t) {
          var p = planCopy(srcCid, a, t.cid);
          p.dates = { dateAssigned: t.dateAssigned, dueDate: t.dueDate };
          return p;
        });
        return reviewPlans(plans, 'Add to ' + (plans.length === 1 ? plans[0].dstName : plans.length + ' classes'));
      })
      .then(function (plans) {
        if (!plans) return [];
        plans.forEach(function (p) {
          applyCopy(a, p, p.dates, a.copyGroup);
        });
        _toast(
          'Added to ' +
            _listNames(
              plans.map(function (p) {
                return p.dstName;
              }),
            ) +
            '.',
        );
        return plans;
      });
  }

  /* After an edit to a linked assessment, offer to make the same change in
     the other classes' copies. */
  function offerLinkedEdit(srcCid, before, after) {
    if (!after || !after.copyGroup) return Promise.resolve();
    return findCopies(srcCid, after).then(function (copies) {
      if (!copies.length) return;
      return Promise.all(
        copies.map(function (c) {
          return loadClass(c.cid);
        }),
      ).then(function () {
        var rows = copies
          .map(function (c) {
            var copy = (getAssessments(c.cid) || []).find(function (x) {
              return x.id === c.assessmentId;
            });
            if (!copy) return null;
            var plan = planLinkedEdit(srcCid, before, after, c.cid, copy);
            return plan.changed || plan.skipped.length ? Object.assign({ copy: c }, plan) : null;
          })
          .filter(Boolean);
        var actionable = rows.filter(function (r) {
          return r.changed;
        });
        if (!actionable.length) return;
        return new Promise(function (resolve) {
          var html =
            '<div class="copy-review-note">This assessment is also in ' +
            esc(
              _listNames(
                actionable.map(function (r) {
                  return r.copy.className;
                }),
              ),
            ) +
            '. Make the same change there?</div>' +
            actionable
              .map(function (r, i) {
                var lines = describePatch(r.copy.cid, r.patch);
                return (
                  '<div class="copy-review-class">' +
                  '<label class="copy-review-check"><input type="checkbox" checked data-copy-row="' +
                  i +
                  '"> ' +
                  esc(r.copy.className) +
                  '</label>' +
                  (lines.length
                    ? '<ul class="copy-change-list">' +
                      lines
                        .map(function (l) {
                          return '<li>' + esc(l) + '</li>';
                        })
                        .join('') +
                      '</ul>'
                    : '') +
                  (r.skipped.length
                    ? '<div class="copy-review-note copy-review-muted">Its own ' +
                      esc(_listNames(r.skipped)) +
                      ' stays as it is.</div>'
                    : '') +
                  '</div>'
                );
              })
              .join('');
          _dialog({
            title: 'Update the other classes too?',
            html: html,
            okLabel: 'Update',
            cancelLabel: 'Only this class',
            onOk: function (root) {
              var names = [];
              actionable.forEach(function (r, i) {
                var cb = root.querySelector('[data-copy-row="' + i + '"]');
                if (cb && !cb.checked) return;
                applyLinkedEdit(r.copy.cid, r.copy.assessmentId, r.patch);
                names.push(r.copy.className);
              });
              if (names.length) _toast('Updated in ' + _listNames(names) + '.');
              resolve();
            },
            onCancel: function () {
              resolve();
            },
          });
        });
      });
    });
  }

  /* ── Describing a linked edit ─────────────────────────────── */
  function _fmtDate(d) {
    if (!d) return 'none';
    return typeof formatDate === 'function' ? formatDate(d) : d;
  }

  /* "Title → Density lab report", one line per field the patch changes,
     in the words of the class it lands in. */
  function describePatch(dstCid, patch) {
    var out = [];
    if ('title' in patch) out.push('Title → ' + patch.title);
    if ('description' in patch) out.push(patch.description ? 'Description updated' : 'Description cleared');
    if ('dateAssigned' in patch) out.push('Date assigned → ' + _fmtDate(patch.dateAssigned));
    if ('dueDate' in patch) out.push('Due date → ' + _fmtDate(patch.dueDate));
    if ('scoreMode' in patch) {
      var modeWords = { points: 'Points', complete: 'Complete/Incomplete', proficiency: 'Proficiency' };
      out.push(
        'Scoring → ' +
          (modeWords[patch.scoreMode] || patch.scoreMode || 'Proficiency') +
          (patch.scoreMode === 'points' && patch.maxPoints != null ? ' out of ' + patch.maxPoints : ''),
      );
    }
    if ('weight' in patch) out.push('Proficiency weight → ' + (patch.weight || 1) + 'x');
    if ('evidenceType' in patch) out.push('Evidence type → ' + (patch.evidenceType || 'none'));
    if ('categoryId' in patch) {
      var cat = (getCategories(dstCid) || []).find(function (c) {
        return c.id === patch.categoryId;
      });
      out.push('Category → ' + (cat ? cat.name : 'none'));
    }
    if ('rubricId' in patch) {
      var rub = patch.rubricId
        ? (getRubrics(dstCid) || []).find(function (r) {
            return r.id === patch.rubricId;
          })
        : null;
      out.push('Rubric → ' + (rub ? rub.name : 'none'));
    }
    if ('moduleId' in patch) {
      var mod = patch.moduleId
        ? (getModules(dstCid) || []).find(function (m) {
            return m.id === patch.moduleId;
          })
        : null;
      out.push('Module → ' + (mod ? mod.name : 'none'));
    }
    if ('tagIds' in patch) {
      var idx = _tagIndex(dstCid);
      var names = (patch.tagIds || [])
        .map(function (id) {
          return idx.byId[id] ? idx.byId[id].label : '';
        })
        .filter(Boolean);
      out.push('Competencies → ' + (names.length ? names.join(', ') : 'none'));
    }
    return out;
  }

  /* ── Remembering the classes a teacher adds to ─────────────── */
  function _rememberKey(cid) {
    return 'gb-copy-targets-' + cid;
  }

  /* The classes the teacher ticked last time they made an assessment in
     this class, on this device. Only live classes count. */
  function rememberedTargets(cid) {
    try {
      var raw = localStorage.getItem(_rememberKey(cid));
      var ids = raw ? JSON.parse(raw) : [];
      return Array.isArray(ids)
        ? ids.filter(function (id) {
            return id !== cid && _isLive(id);
          })
        : [];
    } catch (e) {
      return [];
    }
  }

  function rememberTargets(cid, ids) {
    try {
      if (!ids || !ids.length) localStorage.removeItem(_rememberKey(cid));
      else localStorage.setItem(_rememberKey(cid), JSON.stringify(ids));
    } catch (e) {
      /* no storage: remembered for this page only */
    }
  }

  /* "Block A" from "English 9 - Block A"; the whole name when nothing is
     left over, so two sections always get distinct labels. */
  function sectionLabel(name) {
    var n = String(name || '').trim();
    var key = _courseKey(n);
    var rest = _norm(n)
      .replace(/[-–—:|/]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (key && rest.indexOf(key) === 0) rest = rest.slice(key.length).trim();
    rest = rest.replace(/^[()\s]+|[()\s]+$/g, '');
    if (!rest) return n;
    // Give the words back their capitals from the original name.
    var i = _norm(n).lastIndexOf(rest);
    return i >= 0 ? n.slice(i, i + rest.length).replace(/^[()\s]+|[()\s]+$/g, '') || n : n;
  }

  /* ── The form's Classes field ──────────────────────────────── */
  function _chip(t, active, disabled) {
    return (
      '<button type="button" class="af-copy-chip' +
      (active ? ' active' : '') +
      '" data-action="copyTargetToggle" data-cid="' +
      esc(t.id) +
      '" aria-pressed="' +
      (active ? 'true' : 'false') +
      '"' +
      (disabled ? ' disabled' : '') +
      '><span class="af-copy-chip-mark" aria-hidden="true"></span>' +
      esc(t.name) +
      '</button>'
    );
  }

  /* The Classes row: this class, then the other sections of the same course
     as toggle chips, then any other classes behind "More". A new assessment
     starts with the classes ticked last time; an edit starts with none. */
  function renderClassesField(cid, assess) {
    var targets = copyTargets(cid);
    if (!targets.sameCourse.length && !targets.other.length) return '';
    var pre = assess ? [] : rememberedTargets(cid);
    var html =
      '<div class="af-field af-copy-field" id="af-copy-field">' +
      '<label class="af-label">Classes</label>' +
      '<div class="af-copy-chips" role="group" aria-label="Classes this assessment goes to">' +
      '<span class="af-copy-chip af-copy-this" aria-current="true"><span class="af-copy-chip-mark" aria-hidden="true"></span>' +
      esc(_className(cid)) +
      '</span>' +
      targets.sameCourse
        .map(function (t) {
          return _chip(t, pre.indexOf(t.id) >= 0, false);
        })
        .join('');
    if (targets.other.length) {
      var anyPre = targets.other.some(function (t) {
        return pre.indexOf(t.id) >= 0;
      });
      html +=
        '<details class="af-copy-more"' +
        (anyPre || !targets.sameCourse.length ? ' open' : '') +
        '><summary>' +
        (targets.sameCourse.length ? 'More classes' : 'Other classes') +
        '</summary><div class="af-copy-chips">' +
        targets.other
          .map(function (t) {
            return _chip(t, pre.indexOf(t.id) >= 0, false);
          })
          .join('') +
        '</div></details>';
    }
    html +=
      '</div>' +
      '<div class="af-rubric-info" id="af-copy-existing"' +
      (assess && assess.copyGroup ? '' : ' hidden') +
      '></div>' +
      '<div class="af-copy-dates-bar" id="af-copy-dates-bar" hidden>' +
      '<span class="af-copy-dates-label">Dates</span>' +
      '<div class="seg seg-sm af-type-toggle af-copy-dates-mode" role="group" aria-label="Dates">' +
      '<button type="button" class="seg-btn af-type-btn active" data-action="copyDatesMode" data-mode="same" aria-pressed="true">Same for every class</button>' +
      '<button type="button" class="seg-btn af-type-btn" data-action="copyDatesMode" data-mode="per" aria-pressed="false">Set per class</button>' +
      '</div>' +
      '</div>' +
      '<div id="af-copy-dates"></div>' +
      '</div>';
    return html;
  }

  /* Kept for callers from before the chips. */
  function renderAlsoAddTo(cid, assess) {
    return renderClassesField(cid, assess);
  }

  function _activeChips() {
    return Array.from(document.querySelectorAll('.af-copy-chip.active[data-cid]'));
  }

  function toggleTarget(el) {
    if (!el || el.disabled) return;
    var on = !el.classList.contains('active');
    el.classList.toggle('active', on);
    el.setAttribute('aria-pressed', on ? 'true' : 'false');
    onTargetsChanged();
  }

  function setDatesMode(el) {
    var bar = document.getElementById('af-copy-dates-bar');
    if (!bar) return;
    bar.querySelectorAll('[data-mode]').forEach(function (b) {
      var on = b === el;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    onTargetsChanged();
  }

  function _perClassDates() {
    var bar = document.getElementById('af-copy-dates-bar');
    var per = bar && bar.querySelector('[data-mode="per"]');
    return !!(per && per.classList.contains('active'));
  }

  /* Mark classes that already hold a copy of the assessment being edited. */
  function markExistingCopies(cid, assess) {
    if (!assess || !assess.copyGroup) return Promise.resolve();
    return findCopies(cid, assess).then(function (copies) {
      var names = [];
      copies.forEach(function (c) {
        var chip = document.querySelector('.af-copy-chip[data-cid="' + c.cid + '"]');
        if (chip) {
          chip.classList.remove('active');
          chip.classList.add('af-copy-has');
          chip.setAttribute('aria-pressed', 'false');
          chip.disabled = true;
          chip.title = 'Already in this class';
        }
        names.push(c.className);
      });
      var line = document.getElementById('af-copy-existing');
      if (line && names.length) {
        line.hidden = false;
        line.textContent = 'Already in ' + _listNames(names) + '. Saving offers to update those copies too.';
      }
      onTargetsChanged();
    });
  }

  /* Redraw the dates bar and per-class date rows for the ticked classes. */
  function onTargetsChanged() {
    var ticked = _activeChips();
    var bar = document.getElementById('af-copy-dates-bar');
    var mount = document.getElementById('af-copy-dates');
    if (bar) bar.hidden = ticked.length === 0;
    if (!mount) return;
    if (!ticked.length || !_perClassDates()) {
      mount.innerHTML = '';
      return;
    }
    var assigned = (document.getElementById('af-date-assigned') || {}).value || '';
    var due = (document.getElementById('af-due') || {}).value || '';
    var existing = {};
    mount.querySelectorAll('.af-copy-date-row').forEach(function (row) {
      existing[row.dataset.cid] = {
        a: (row.querySelector('[data-copy-assigned]') || {}).value,
        d: (row.querySelector('[data-copy-due]') || {}).value,
      };
    });
    mount.innerHTML = ticked
      .map(function (chip) {
        var id = chip.dataset.cid;
        var keep = existing[id] || {};
        return (
          '<div class="af-copy-date-row" data-cid="' +
          esc(id) +
          '"><span class="af-copy-date-name">' +
          esc(_className(id)) +
          '</span><label>Assigned <input class="af-input" type="date" data-copy-assigned value="' +
          esc(keep.a || assigned) +
          '"></label><label>Due <input class="af-input" type="date" data-copy-due value="' +
          esc(keep.d != null ? keep.d : due) +
          '"></label></div>'
        );
      })
      .join('');
  }

  /* The ticked classes with their dates: [{ cid, dateAssigned, dueDate }].
     Also remembers the choice for the next assessment in this class. */
  function readTargets(cid) {
    var perClass = _perClassDates();
    var targets = _activeChips().map(function (chip) {
      var t = { cid: chip.dataset.cid };
      if (perClass) {
        var row = document.querySelector('.af-copy-date-row[data-cid="' + chip.dataset.cid + '"]');
        if (row) {
          t.dateAssigned = (row.querySelector('[data-copy-assigned]') || {}).value || undefined;
          t.dueDate = (row.querySelector('[data-copy-due]') || {}).value || '';
        }
      }
      return t;
    });
    if (cid && document.getElementById('af-copy-field')) {
      rememberTargets(
        cid,
        targets.map(function (t) {
          return t.cid;
        }),
      );
    }
    return targets;
  }

  /* ── On the assessment card and in the toolbar ─────────────── */
  /* The other classes on this device that hold a copy of `a`:
     [{ cid, assessmentId, className }]. Reads only what is already loaded
     or saved locally, so it is synchronous. */
  function localCopies(cid, a) {
    if (!a || !a.copyGroup) return [];
    var out = [];
    Object.keys(COURSES || {}).forEach(function (id) {
      if (id === cid || !_isLive(id)) return;
      var list;
      try {
        list = getAssessments(id) || [];
      } catch (e) {
        list = [];
      }
      list.forEach(function (x) {
        if (x.copyGroup === a.copyGroup) out.push({ cid: id, assessmentId: x.id, className: _className(id) });
      });
    });
    return out;
  }

  /* "Also in Block B" chips for an assessment card; each opens that copy. */
  function renderCardCopies(cid, a) {
    return localCopies(cid, a)
      .map(function (c) {
        return (
          '<button type="button" class="copy-badge" data-action="openCopyIn" data-cid="' +
          esc(c.cid) +
          '" data-aid="' +
          esc(c.assessmentId) +
          '" data-stop-prop="true" title="Open this assessment in ' +
          esc(c.className) +
          '">⇄ Also in ' +
          esc(sectionLabel(c.className)) +
          '</button>'
        );
      })
      .join('');
  }

  /* One-click switching between sections of the same course. Returns ''
     unless the class has one to three siblings. */
  function renderSiblingToggle(cid) {
    var sibs = copyTargets(cid).sameCourse;
    if (!sibs.length || sibs.length > 3) return '';
    var all = [{ id: cid, name: _className(cid) }].concat(sibs);
    return (
      '<div class="seg assess-sibling-toggle" role="group" aria-label="Sections of this course">' +
      all
        .map(function (c) {
          var on = c.id === cid;
          return (
            '<button type="button" class="seg-btn assess-sibling-btn' +
            (on ? ' active' : '') +
            '" data-action="switchToClass" data-cid="' +
            esc(c.id) +
            '" aria-pressed="' +
            (on ? 'true' : 'false') +
            '" title="' +
            esc(c.name) +
            '">' +
            esc(sectionLabel(c.name)) +
            '</button>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  /* A line for the delete confirmation when copies exist elsewhere. */
  function deleteNote(cid, a) {
    var copies = localCopies(cid, a);
    if (!copies.length) return '';
    return (
      ' It is also in ' +
      _listNames(
        copies.map(function (c) {
          return c.className;
        }),
      ) +
      '; that copy stays.'
    );
  }

  /* ── Add from another class ────────────────────────────────── */
  /* Pick assessments in another class and copy them into cid. Links each
     source to its copy, giving the source a copyGroup if it has none. */
  function openAddFromClass(cid, onDone) {
    var targets = copyTargets(cid);
    var classes = targets.sameCourse.concat(targets.other);
    if (!classes.length) {
      _toast('You have no other classes to copy from.');
      return;
    }
    var html =
      '<label class="copy-review-field">From <select class="af-input" id="copy-from-class">' +
      classes
        .map(function (c) {
          return '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>';
        })
        .join('') +
      '</select></label>' +
      '<div id="copy-from-list" class="copy-from-list">Loading…</div>';

    function fillList(root, srcCid) {
      var list = root.querySelector('#copy-from-list');
      list.textContent = 'Loading…';
      loadClass(srcCid).then(function () {
        var mine = getAssessments(cid) || [];
        var have = {};
        mine.forEach(function (x) {
          if (x.copyGroup) have[x.copyGroup] = true;
        });
        var rows = (getAssessments(srcCid) || []).slice().sort(function (x, y) {
          return String(_dateOf(y)).localeCompare(String(_dateOf(x)));
        });
        if (!rows.length) {
          list.textContent = 'That class has no assessments yet.';
          return;
        }
        list.innerHTML = rows
          .map(function (x) {
            var already = x.copyGroup && have[x.copyGroup];
            var cat = _categoryOf(srcCid, x);
            return (
              '<label class="copy-review-check' +
              (already ? ' af-copy-has' : '') +
              '"><input type="checkbox" data-copy-src="' +
              esc(x.id) +
              '"' +
              (already ? ' disabled' : '') +
              '> <span>' +
              esc(x.title) +
              '</span><span class="copy-review-muted"> ' +
              esc([_dateOf(x), cat ? cat.name : '', already ? 'already here' : ''].filter(Boolean).join(' · ')) +
              '</span></label>'
            );
          })
          .join('');
      });
    }

    _dialog({
      title: 'Add from another class',
      html: html,
      okLabel: 'Add',
      onOpen: function (root) {
        var sel = root.querySelector('#copy-from-class');
        fillList(root, sel.value);
        sel.addEventListener('change', function () {
          fillList(root, sel.value);
        });
      },
      onOk: function (root) {
        var srcCid = root.querySelector('#copy-from-class').value;
        var ids = Array.from(root.querySelectorAll('[data-copy-src]:checked')).map(function (cb) {
          return cb.dataset.copySrc;
        });
        if (!ids.length) return true;
        _addFrom(srcCid, ids, cid).then(function (added) {
          if (onDone && added) onDone();
        });
        return true;
      },
    });
  }

  function _addFrom(srcCid, ids, dstCid) {
    return Promise.all([loadClass(srcCid), loadClass(dstCid)]).then(function () {
      var srcList = (getAssessments(srcCid) || []).slice();
      var sourceChanged = false;
      var picked = [];
      srcList = srcList.map(function (x) {
        if (ids.indexOf(x.id) < 0) return x;
        var next = x.copyGroup ? x : Object.assign({}, x, { copyGroup: newCopyGroup() });
        if (next !== x) sourceChanged = true;
        picked.push(next);
        return next;
      });
      var plans = picked.map(function (x) {
        var p = planCopy(srcCid, x, dstCid);
        p.source = x;
        // Several assessments into one class: name each by its title.
        p.heading = x.title;
        return p;
      });
      return reviewPlans(plans, 'Add').then(function (ok) {
        if (!ok) return false;
        if (sourceChanged) saveAssessments(srcCid, srcList);
        ok.forEach(function (p) {
          applyCopy(p.source, p, null, p.source.copyGroup);
        });
        _toast(
          'Added ' +
            ok.length +
            (ok.length === 1 ? ' assessment' : ' assessments') +
            ' from ' +
            _className(srcCid) +
            '.',
        );
        return true;
      });
    });
  }

  return {
    newCopyGroup: newCopyGroup,
    copyTargets: copyTargets,
    mapTags: mapTags,
    planCopy: planCopy,
    buildCopy: buildCopy,
    applyCopy: applyCopy,
    findCopies: findCopies,
    planLinkedEdit: planLinkedEdit,
    applyLinkedEdit: applyLinkedEdit,
    reviewPlans: reviewPlans,
    copyToClasses: copyToClasses,
    offerLinkedEdit: offerLinkedEdit,
    renderAlsoAddTo: renderAlsoAddTo,
    renderClassesField: renderClassesField,
    markExistingCopies: markExistingCopies,
    onTargetsChanged: onTargetsChanged,
    toggleTarget: toggleTarget,
    setDatesMode: setDatesMode,
    readTargets: readTargets,
    rememberedTargets: rememberedTargets,
    rememberTargets: rememberTargets,
    describePatch: describePatch,
    sectionLabel: sectionLabel,
    localCopies: localCopies,
    renderCardCopies: renderCardCopies,
    renderSiblingToggle: renderSiblingToggle,
    deleteNote: deleteNote,
    openAddFromClass: openAddFromClass,
    dialog: _dialog,
    _courseKey: _courseKey,
  };
})();
