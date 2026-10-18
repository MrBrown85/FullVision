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
    return (COURSES[cid] && COURSES[cid].name) || 'another class';
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

  /* Copy `rubric` into each class. Resolves to [{ dstCid, rubric }]. */
  function copyTo(srcCid, rubric, dstCids) {
    var targets = (dstCids || []).filter(function (id) {
      return id && id !== srcCid;
    });
    return Promise.all(targets.map(loadClass)).then(function () {
      return targets.map(function (dstCid) {
        var plan = planCopy(srcCid, rubric, dstCid);
        var clone = cloneRubric(srcCid, dstCid, rubric);
        clone.name = plan.name;
        saveRubrics(dstCid, (getRubrics(dstCid) || []).concat([clone]));
        return { dstCid: dstCid, rubric: clone };
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

    function row(c, plan) {
      return (
        '<label class="copy-review-check rubric-copy-row"><input type="checkbox" data-rubric-dst="' +
        esc(c.id) +
        '"> <span class="rubric-copy-row-name">' +
        esc(c.name) +
        '</span></label>' +
        '<div class="rubric-copy-summary">' +
        _lines(summaryLines(plan)) +
        '</div>'
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
            parts.push('<div class="rubric-copy-group">Other classes</div>');
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
    cloneRubric: cloneRubric,
    planCopy: planCopy,
    summaryLines: summaryLines,
    copyTo: copyTo,
    openCopyDialog: openCopyDialog,
    openPickDialog: openPickDialog,
  };
})();
