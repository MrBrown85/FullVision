/* rubric-library.js — one rubric in several classes.
 *
 * A rubric belongs to one class. "Copy to another class" on the Rubric Bank
 * and "From another class" on the assessment form copy it, criteria and
 * descriptors included, into another class of the teacher's. Competencies
 * are matched by name in that class (AssessmentCopy.mapTags); a competency
 * with no match is listed before anything is saved and the criterion keeps
 * its descriptors. Copies are independent: scores are per criterion and a
 * copy has its own criteria, so nothing here touches scores.
 */
window.RubricLibrary = (function () {
  'use strict';

  function _norm(s) {
    return String(s == null ? '' : s)
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  }

  function _className(cid) {
    return (COURSES[cid] && courseDisplayName(COURSES[cid])) || 'another class';
  }

  function _labelOf(cid, tagId) {
    var tag = typeof getTagById === 'function' ? getTagById(cid, tagId) : null;
    return tag ? tag.label || tag.text || tag.code || '' : '';
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

  /* "Lab rubric" becomes "Lab rubric (2)" when the class already has one. */
  function uniqueName(name, existing) {
    var base = String(name || 'Rubric').trim() || 'Rubric';
    if (!_byName(existing, base)) return base;
    var n = 2;
    while (_byName(existing, base + ' (' + n + ')')) n++;
    return base + ' (' + n + ')';
  }

  /* A copy of `rubric` for `dstCid`: new ids, competencies matched by name. */
  function cloneRubric(srcCid, dstCid, rubric) {
    var clone = structuredClone(rubric);
    clone.id = uid();
    clone.criteria = (clone.criteria || []).map(function (c) {
      var next = Object.assign({}, c, { id: uid() });
      next.tagIds = AssessmentCopy.mapTags(srcCid, dstCid, c.tagIds || []).ids;
      return next;
    });
    return clone;
  }

  /* What copying `rubric` into `dstCid` would do. The target class must be
     loaded. Returns { dstCid, dstName, name, collision, criteria: [{ name,
     matched, dropped }], matchedCount, tagCount, mostlyDropped }. */
  function planCopy(srcCid, rubric, dstCid) {
    var existing = getRubrics(dstCid) || [];
    var plan = {
      dstCid: dstCid,
      dstName: _className(dstCid),
      name: uniqueName(rubric.name, existing),
      collision: !!_byName(existing, rubric.name),
      criteria: [],
      matchedCount: 0,
      tagCount: 0,
      mostlyDropped: false,
    };
    (rubric.criteria || []).forEach(function (crit) {
      if (!crit) return;
      var tags = AssessmentCopy.mapTags(srcCid, dstCid, crit.tagIds || []);
      var matched = tags.ids.map(function (id) {
        return _labelOf(dstCid, id);
      });
      plan.criteria.push({ name: crit.name, matched: matched, dropped: tags.dropped });
      plan.matchedCount += tags.ids.length;
      plan.tagCount += (crit.tagIds || []).length;
    });
    plan.mostlyDropped = plan.tagCount > 0 && plan.matchedCount * 2 < plan.tagCount;
    return plan;
  }

  /* The lines a dialog shows under a target class. */
  function summaryLines(plan) {
    var lines = [];
    var critCount = plan.criteria.length;
    lines.push(
      critCount +
        (critCount === 1 ? ' criterion' : ' criteria') +
        (plan.tagCount
          ? ', ' + plan.matchedCount + ' of ' + plan.tagCount + ' competencies matched'
          : ', no competencies'),
    );
    var dropped = [];
    plan.criteria.forEach(function (c) {
      c.dropped.forEach(function (label) {
        if (dropped.indexOf(label) < 0) dropped.push(label);
      });
    });
    if (plan.mostlyDropped) lines.push('This class teaches a different course; most competencies will be left off.');
    else if (dropped.length) {
      lines.push(
        dropped.join(', ') +
          (dropped.length === 1 ? ' has' : ' have') +
          ' no match in ' +
          plan.dstName +
          ' and will be left off.',
      );
    }
    if (plan.collision)
      lines.push(plan.dstName + ' already has a rubric with this name; the copy will be called ' + plan.name + '.');
    return lines;
  }

  function loadClass(cid) {
    if (typeof initData !== 'function') return Promise.resolve();
    return Promise.resolve(initData(cid)).catch(function (e) {
      console.warn('Could not load class for copying a rubric:', cid, e);
    });
  }

  /* Copy `rubric` into each class. The source gets a copy group the first
     time it is copied and every copy shares it, so a later edit can offer to
     update them. Resolves to [{ dstCid, rubric }]. */
  function copyTo(srcCid, rubric, dstCids) {
    var targets = (dstCids || []).filter(function (id) {
      return id && id !== srcCid;
    });
    return Promise.all(targets.map(loadClass)).then(function () {
      if (!targets.length) return [];
      var group = rubric.copyGroup;
      if (!group) {
        group = AssessmentCopy.newCopyGroup();
        rubric.copyGroup = group;
        saveRubrics(
          srcCid,
          (getRubrics(srcCid) || []).map(function (r) {
            return r.id === rubric.id ? Object.assign({}, r, { copyGroup: group }) : r;
          }),
        );
      }
      return targets.map(function (dstCid) {
        var plan = planCopy(srcCid, rubric, dstCid);
        var clone = cloneRubric(srcCid, dstCid, rubric);
        clone.name = plan.name;
        clone.copyGroup = group;
        saveRubrics(dstCid, (getRubrics(dstCid) || []).concat([clone]));
        return { dstCid: dstCid, rubric: clone };
      });
    });
  }

  /* ── Linked copies ─────────────────────────────────────────── */
  function _isLive(cid) {
    return !!COURSES[cid] && !(typeof isCourseArchived === 'function' && isCourseArchived(cid));
  }

  /* The copies of `rubric` in the classes already on this device. */
  function localCopies(cid, rubric) {
    if (!rubric || !rubric.copyGroup) return [];
    var out = [];
    Object.keys(COURSES || {}).forEach(function (id) {
      if (id === cid || !_isLive(id)) return;
      var list;
      try {
        list = getRubrics(id) || [];
      } catch (e) {
        list = [];
      }
      list.forEach(function (r) {
        if (r.copyGroup === rubric.copyGroup) out.push({ cid: id, rubricId: r.id, className: _className(id) });
      });
    });
    return out;
  }

  /* Every live copy of `rubric`: from the server when signed in, else from
     the classes on this device. Resolves to [{ cid, rubricId, className }]. */
  function findCopies(cid, rubric) {
    if (!rubric || !rubric.copyGroup) return Promise.resolve([]);
    var useServer =
      typeof _writesEnabled === 'function' &&
      _writesEnabled() &&
      window.v2 &&
      typeof window.v2.listRubricCopies === 'function';
    if (useServer) {
      return window.v2.listRubricCopies(rubric.copyGroup).then(function (res) {
        return ((res && res.data) || [])
          .filter(function (r) {
            return r.course_id !== cid && COURSES[r.course_id];
          })
          .map(function (r) {
            return { cid: r.course_id, rubricId: r.rubric_id, className: r.course_name || _className(r.course_id) };
          });
      });
    }
    var others = Object.keys(COURSES || {}).filter(function (id) {
      return id !== cid && _isLive(id);
    });
    return Promise.all(others.map(loadClass)).then(function () {
      return localCopies(cid, rubric);
    });
  }

  function _listNames(names) {
    if (names.length <= 1) return names[0] || '';
    return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
  }

  /* What a criterion says, ids left out, so two classes' copies compare. */
  function _critView(c) {
    var lv = (c && c.levels) || {};
    var vals = (c && c.levelValues) || {};
    return {
      name: _norm(c && c.name),
      levels: [4, 3, 2, 1].map(function (l) {
        return String(lv[l] || '');
      }),
      values: [4, 3, 2, 1].map(function (l) {
        return vals[l] != null && vals[l] !== '' ? Number(vals[l]) : l;
      }),
      weight: c && c.weight != null && c.weight !== '' ? Number(c.weight) : 1,
    };
  }

  function _same(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  /* The copy's criterion that stands for a source criterion: same name,
     else the one in the same position when neither side has a name match. */
  function _matchCopyCriterion(before, copy, idx, usedIds) {
    var bc = before.criteria[idx];
    var hit = (copy.criteria || []).find(function (c) {
      return c && !usedIds[c.id] && _norm(c.name) === _norm(bc.name);
    });
    if (hit) return hit;
    var pos = (copy.criteria || [])[idx];
    if (!pos || usedIds[pos.id]) return null;
    var posNamedElsewhere = (before.criteria || []).some(function (b, i) {
      return i !== idx && _norm(b.name) === _norm(pos.name);
    });
    return posNamedElsewhere ? null : pos;
  }

  /* Plan carrying an edit of `before` → `after` (same class) onto `copy` in
     dstCid. Only what the copy still shared with `before` changes; a field
     the other class had changed on its own stays. Returns { changed, next,
     lines, removals: [{ name, students, index }], skipped }. */
  function planLinkedEdit(srcCid, before, after, dstCid, copy) {
    var next = structuredClone(copy);
    var lines = [];
    var skipped = [];
    var removals = [];
    var scored = typeof RubricGuard !== 'undefined' ? RubricGuard.scoredStudentsByCriterion(dstCid, copy) : {};
    var usedIds = {};
    var afterById = {};
    (after.criteria || []).forEach(function (c) {
      if (c) afterById[c.id] = c;
    });

    if (_norm(before.name) !== _norm(after.name)) {
      if (_norm(copy.name) === _norm(before.name)) {
        next.name = after.name;
        lines.push('Name → ' + after.name);
      } else skipped.push('name');
    }

    (before.criteria || []).forEach(function (bc, idx) {
      if (!bc) return;
      var target = _matchCopyCriterion(before, copy, idx, usedIds);
      if (!target) return;
      usedIds[target.id] = true;
      var ac = afterById[bc.id];
      var nextCrit = next.criteria.find(function (c) {
        return c.id === target.id;
      });
      if (!ac) {
        var students = scored[target.id] || 0;
        removals.push({ id: target.id, name: target.name, students: students, index: removals.length });
        if (!students) {
          next.criteria = next.criteria.filter(function (c) {
            return c.id !== target.id;
          });
          lines.push('Remove criterion “' + target.name + '”');
        }
        return;
      }
      var bv = _critView(bc);
      var av = _critView(ac);
      var cv = _critView(target);
      if (_same(bv, av)) return;
      if (bv.name !== av.name) {
        if (cv.name === bv.name) {
          nextCrit.name = ac.name;
          lines.push('Criterion “' + bc.name + '” renamed to “' + ac.name + '”');
        } else skipped.push('the name of “' + target.name + '”');
      }
      if (!_same(bv.levels, av.levels)) {
        if (_same(cv.levels, bv.levels)) {
          nextCrit.levels = structuredClone(ac.levels || {});
          lines.push('Descriptors of “' + ac.name + '” updated');
        } else skipped.push('the descriptors of “' + target.name + '”');
      }
      if (!_same(bv.values, av.values)) {
        if (_same(cv.values, bv.values)) {
          nextCrit.levelValues = ac.levelValues ? structuredClone(ac.levelValues) : null;
          lines.push('Point values of “' + ac.name + '” updated');
        } else skipped.push('the point values of “' + target.name + '”');
      }
      if (bv.weight !== av.weight) {
        if (cv.weight === bv.weight) {
          nextCrit.weight = ac.weight;
          lines.push('Weight of “' + ac.name + '” → ' + av.weight);
        } else skipped.push('the weight of “' + target.name + '”');
      }
    });

    (after.criteria || []).forEach(function (ac) {
      if (!ac) return;
      var existed = (before.criteria || []).some(function (bc) {
        return bc && bc.id === ac.id;
      });
      if (existed) return;
      var added = Object.assign(structuredClone(ac), { id: uid() });
      var tags = AssessmentCopy.mapTags(srcCid, dstCid, ac.tagIds || []);
      added.tagIds = tags.ids;
      next.criteria.push(added);
      lines.push(
        'Add criterion “' +
          ac.name +
          '”' +
          (tags.dropped.length ? ' (no match for ' + _listNames(tags.dropped) + ')' : ''),
      );
    });

    var changed =
      lines.length > 0 ||
      removals.some(function (r) {
        return r.students > 0;
      });
    return { changed: changed, next: next, lines: lines, removals: removals, skipped: skipped };
  }

  /* After a rubric with copies is saved: "Update the other classes too?".
     A scored criterion is removed from a copy only when its own box is
     ticked. Resolves when the dialog is closed or there was nothing to ask. */
  function offerLinkedEdit(srcCid, before, after) {
    if (!before || !after || !after.copyGroup) return Promise.resolve();
    return findCopies(srcCid, after).then(function (copies) {
      if (!copies.length) return;
      return Promise.all(
        copies.map(function (c) {
          return loadClass(c.cid);
        }),
      ).then(function () {
        var rows = copies
          .map(function (c) {
            var copy = (getRubrics(c.cid) || []).find(function (r) {
              return r.id === c.rubricId;
            });
            if (!copy) return null;
            var plan = planLinkedEdit(srcCid, before, after, c.cid, copy);
            return plan.changed ? Object.assign({ copy: c, original: copy }, plan) : null;
          })
          .filter(Boolean);
        if (!rows.length) return;
        return new Promise(function (resolve) {
          var html =
            '<div class="copy-review-note">This rubric is also in ' +
            esc(
              _listNames(
                rows.map(function (r) {
                  return r.copy.className;
                }),
              ),
            ) +
            '. Make the same change there?</div>' +
            rows
              .map(function (r, i) {
                var scoredRemovals = r.removals.filter(function (x) {
                  return x.students > 0;
                });
                return (
                  '<div class="copy-review-class">' +
                  '<label class="copy-review-check"><input type="checkbox" checked data-rubric-row="' +
                  i +
                  '"> ' +
                  esc(r.copy.className) +
                  '</label>' +
                  (r.lines.length
                    ? '<ul class="copy-change-list">' +
                      r.lines
                        .map(function (l) {
                          return '<li>' + esc(l) + '</li>';
                        })
                        .join('') +
                      '</ul>'
                    : '') +
                  scoredRemovals
                    .map(function (x) {
                      return (
                        '<label class="copy-review-check rubric-linked-removal"><input type="checkbox" data-rubric-removal="' +
                        i +
                        ':' +
                        esc(x.id) +
                        '"> Also remove “' +
                        esc(x.name) +
                        '” and drop its scores from ' +
                        x.students +
                        (x.students === 1 ? ' student' : ' students') +
                        '</label>'
                      );
                    })
                    .join('') +
                  (r.skipped.length
                    ? '<div class="copy-review-note copy-review-muted">Its own ' +
                      esc(_listNames(r.skipped)) +
                      ' stays as it is.</div>'
                    : '') +
                  '</div>'
                );
              })
              .join('');
          AssessmentCopy.dialog({
            title: 'Update the other classes too?',
            html: html,
            okLabel: 'Update',
            cancelLabel: 'Only this class',
            onOk: function (root) {
              var names = [];
              rows.forEach(function (r, i) {
                var cb = root.querySelector('[data-rubric-row="' + i + '"]');
                if (!cb || !cb.checked) return;
                var nextRubric = r.next;
                root.querySelectorAll('[data-rubric-removal^="' + i + ':"]').forEach(function (box) {
                  if (!box.checked) return;
                  var critId = box.dataset.rubricRemoval.slice(String(i).length + 1);
                  nextRubric.criteria = nextRubric.criteria.filter(function (c) {
                    return c.id !== critId;
                  });
                });
                saveRubrics(
                  r.copy.cid,
                  (getRubrics(r.copy.cid) || []).map(function (x) {
                    return x.id === r.copy.rubricId ? nextRubric : x;
                  }),
                );
                names.push(r.copy.className);
              });
              if (names.length) _toast('Updated the rubric in ' + _listNames(names) + '.');
              resolve(names);
              return true;
            },
            onCancel: function () {
              resolve([]);
            },
          });
        });
      });
    });
  }

  /* Load the teacher's other live classes so "Also in …" chips can be drawn
     from this device's data. Resolves true when the class has a linked rubric
     and another class was loaded, so the caller knows to render again. */
  function warmCopies(cid) {
    var linked = (getRubrics(cid) || []).some(function (r) {
      return r && r.copyGroup;
    });
    var others = Object.keys(COURSES || {}).filter(function (id) {
      return id !== cid && _isLive(id);
    });
    if (!linked || !others.length) return Promise.resolve(false);
    return Promise.all(others.map(loadClass)).then(function () {
      return true;
    });
  }

  /* "Also in …" chips for a Rubric Bank row. */
  function renderCopies(cid, rubric) {
    return localCopies(cid, rubric)
      .map(function (c) {
        return (
          '<span class="copy-badge rubric-copy-badge" title="This rubric is also in ' +
          esc(c.className) +
          '">⇄ Also in ' +
          esc(AssessmentCopy.sectionLabel(c.className)) +
          '</span>'
        );
      })
      .join('');
  }

  /* The sentence a delete confirmation adds when copies exist. */
  function deleteNote(cid, rubric) {
    var copies = localCopies(cid, rubric);
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

  function _toast(message) {
    if (typeof showSyncToast !== 'function') return;
    try {
      showSyncToast(message, 'info');
    } catch (e) {
      /* a toast is only a courtesy */
    }
  }

  function _lines(lines) {
    return lines
      .map(function (l) {
        return '<div class="copy-review-muted">' + esc(l) + '</div>';
      })
      .join('');
  }

  /* ── Rubric Bank: Copy to another class ────────────────────── */
  function openCopyDialog(srcCid, rubricId, onDone) {
    var rubric = getRubricById(srcCid, rubricId);
    if (!rubric) return;
    var targets = AssessmentCopy.copyTargets(srcCid);
    var classes = targets.sameCourse.concat(targets.other);
    if (!classes.length) {
      _toast('You have no other classes to copy to.');
      return;
    }
    var html =
      '<div class="copy-review-note">Copy “' +
      esc(rubric.name) +
      '” into:</div>' +
      '<div id="rubric-copy-list" class="copy-from-list">Loading…</div>';

    var haveCopy = {};
    localCopies(srcCid, rubric).forEach(function (c) {
      haveCopy[c.cid] = true;
    });

    function row(c, plan) {
      var already = !!haveCopy[c.id];
      return (
        '<label class="copy-review-check rubric-copy-row' +
        (already ? ' af-copy-has' : '') +
        '"><input type="checkbox" data-rubric-dst="' +
        esc(c.id) +
        '"' +
        (already ? ' disabled' : '') +
        '> <span class="rubric-copy-row-name">' +
        esc(c.name) +
        '</span>' +
        (already ? '<span class="copy-review-muted"> · already here</span>' : '') +
        '</label>' +
        (already ? '' : '<div class="rubric-copy-summary">' + _lines(summaryLines(plan)) + '</div>')
      );
    }

    function updateOk(root) {
      var n = root.querySelectorAll('[data-rubric-dst]:checked').length;
      var ok = root.querySelector('[data-copy-ok]');
      if (ok) {
        ok.textContent = n ? 'Copy to ' + n + (n === 1 ? ' class' : ' classes') : 'Copy';
        ok.disabled = !n;
      }
    }

    AssessmentCopy.dialog({
      title: 'Copy rubric to another class',
      html: html,
      okLabel: 'Copy',
      onOpen: function (root) {
        updateOk(root);
        Promise.all(
          classes.map(function (c) {
            return loadClass(c.id);
          }),
        ).then(function () {
          var list = root.querySelector('#rubric-copy-list');
          if (!list) return;
          var parts = [];
          targets.sameCourse.forEach(function (c) {
            parts.push(row(c, planCopy(srcCid, rubric, c.id)));
          });
          if (targets.sameCourse.length && targets.other.length)
            parts.push('<div class="rubric-copy-group">Other Classes</div>');
          targets.other.forEach(function (c) {
            parts.push(row(c, planCopy(srcCid, rubric, c.id)));
          });
          list.innerHTML = parts.join('');
          list.addEventListener('change', function () {
            updateOk(root);
          });
        });
      },
      onOk: function (root) {
        var ids = Array.from(root.querySelectorAll('[data-rubric-dst]:checked')).map(function (cb) {
          return cb.dataset.rubricDst;
        });
        if (!ids.length) return false;
        copyTo(srcCid, rubric, ids).then(function (done) {
          _toast(
            'Copied “' +
              rubric.name +
              '” to ' +
              done
                .map(function (d) {
                  return _className(d.dstCid);
                })
                .join(', ') +
              '.',
          );
          if (onDone) onDone(done);
        });
        return true;
      },
    });
  }

  /* ── Assessment form: From another class ───────────────────── */
  function openPickDialog(dstCid, onPicked) {
    var targets = AssessmentCopy.copyTargets(dstCid);
    var classes = targets.sameCourse.concat(targets.other);
    if (!classes.length) {
      _toast('You have no other classes to copy from.');
      return;
    }
    var html =
      '<label class="copy-review-field">From <select class="af-input" id="rubric-pick-class">' +
      classes
        .map(function (c) {
          return '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>';
        })
        .join('') +
      '</select></label>' +
      '<div id="rubric-pick-list" class="copy-from-list">Loading…</div>';

    function fillList(root, srcCid) {
      var list = root.querySelector('#rubric-pick-list');
      list.textContent = 'Loading…';
      loadClass(srcCid).then(function () {
        var rows = getRubrics(srcCid) || [];
        if (!rows.length) {
          list.textContent = 'That class has no rubrics yet.';
          return;
        }
        list.innerHTML = rows
          .map(function (r) {
            var plan = planCopy(srcCid, r, dstCid);
            return (
              '<label class="copy-review-check rubric-copy-row"><input type="radio" name="rubric-pick" value="' +
              esc(r.id) +
              '"> <span class="rubric-copy-row-name">' +
              esc(r.name) +
              '</span></label>' +
              '<div class="rubric-copy-summary">' +
              _lines(summaryLines(plan)) +
              '</div>'
            );
          })
          .join('');
      });
    }

    AssessmentCopy.dialog({
      title: 'Use a rubric from another class',
      html: html,
      okLabel: 'Use in this class',
      onOpen: function (root) {
        var sel = root.querySelector('#rubric-pick-class');
        fillList(root, sel.value);
        sel.addEventListener('change', function () {
          fillList(root, sel.value);
        });
      },
      onOk: function (root) {
        var srcCid = root.querySelector('#rubric-pick-class').value;
        var picked = root.querySelector('input[name="rubric-pick"]:checked');
        if (!picked) return false;
        var rubric = getRubricById(srcCid, picked.value);
        if (!rubric) return true;
        copyTo(srcCid, rubric, [dstCid]).then(function (done) {
          if (onPicked && done[0]) onPicked(done[0].rubric);
        });
        return true;
      },
    });
  }

  return {
    uniqueName: uniqueName,
    loadClass: loadClass,
    cloneRubric: cloneRubric,
    planCopy: planCopy,
    summaryLines: summaryLines,
    copyTo: copyTo,
    localCopies: localCopies,
    warmCopies: warmCopies,
    findCopies: findCopies,
    planLinkedEdit: planLinkedEdit,
    offerLinkedEdit: offerLinkedEdit,
    renderCopies: renderCopies,
    deleteNote: deleteNote,
    openCopyDialog: openCopyDialog,
    openPickDialog: openPickDialog,
  };
})();
