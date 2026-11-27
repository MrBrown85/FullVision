// @ts-check
/* grading-setup-copy-dialog.js — Copy Grading Setup's two dialogs, drawn like
   the rest of Class Settings (docs/DECISIONS.md, "Points and Proficiency
   locks until Edit"; Colin, 2026-11-27: "it should match the fullvision menu
   aesthetic elsewhere on the page").

   What to copy, and which classes, are one-line rows in the app's own list
   (cm-method-list) with a switch at the right, tinted when on; Import From
   Another Class picks its source from the same kind of list, one round
   button at a time. A small picture of each class's markers sits on its row,
   and before → after pictures on each class in the check step. The picture
   is decoration, named by its label; the class's name is always on its row.

   It adds openDialog to GradingSetupCopy (grading-setup-copy.js plans and
   applies the copy and draws the check step, with this file's pictures). The
   dialog is AssessmentCopy.dialog, given the class gsc-dialog for this look;
   other dialogs built on it keep theirs. Every behaviour the dialog had
   stays: same-course classes first, Import, the greyed Categories row when
   the source has none. */
(function () {
  'use strict';

  var G = /** @type {any} */ (window).GradingSetupCopy;
  var M = CmPtsModel;

  // A picture of a class's markers: the four bands, a tick for every step.
  function miniHtml(scale) {
    var at = M.starts(scale);
    var cuts = [0, at[2], at[3], at[4], 100];
    var bands = [1, 2, 3, 4]
      .map(function (l) {
        return '<span class="gsc-mini-band lv-' + l + '" style="width:' + (cuts[l] - cuts[l - 1]) + '%"></span>';
      })
      .join('');
    var ticks = M.values(scale)
      .map(function (v, i) {
        return (
          '<span class="gsc-mini-tick lv-' + COUNTS_AS_STEPS[i].key.charAt(0) + '" style="left:' + v + '%"></span>'
        );
      })
      .join('');
    return '<span class="gsc-mini-bands">' + bands + '</span>' + ticks;
  }
  // A picture drawn at once, with its name.
  function mini(scale, label) {
    return '<span class="gsc-mini" role="img" aria-label="' + esc(label) + '">' + miniHtml(scale) + '</span>';
  }
  // Fills a slot a row reserved (a class not loaded yet has no markers to show).
  function fillMini(slot, scale, label) {
    if (!slot) return;
    slot.innerHTML = miniHtml(scale);
    slot.setAttribute('role', 'img');
    slot.setAttribute('aria-label', label);
  }

  /* One row: a label (and a line after it), a picture, a switch. */
  // html-safe: ids, names and descriptions through esc; the picture is built here
  function row(o) {
    return (
      '<div class="cm-method gsc-row' +
      (o.on ? ' active' : '') +
      (o.off ? ' is-off' : '') +
      '"><span class="gsc-row-text"><span class="cm-method-name">' +
      esc(o.name) +
      '</span>' +
      (o.desc ? '<span class="cm-method-desc">' + esc(o.desc) + '</span>' : '') +
      '</span>' +
      (o.pic || '') +
      '<button type="button" class="rb-switch" role="switch" aria-checked="' +
      !!o.on +
      '" aria-label="' +
      esc(o.name) +
      '" ' +
      o.attr +
      (o.off ? ' disabled' : '') +
      '><span></span></button></div>'
    );
  }

  // html-safe: group keys and labels are constants; class names and summaries through esc
  function groupsHtml(srcCid, only, kept) {
    var src = G.describeSource(srcCid);
    return G.GROUPS.map(function (g) {
      var noCats = g.key === 'categories' && !src.categories;
      var on = !noCats && (kept ? !!kept[g.key] : only ? g.key === only : g.on);
      return row({
        name: g.label,
        desc: noCats ? 'none in ' + G.className(srcCid) : src[g.key],
        pic: g.key === 'gradingScale' ? '<span class="gsc-mini" data-gsc-mini="scale"></span>' : '',
        on: on,
        off: noCats,
        attr: 'data-gsc-group="' + g.key + '"',
      });
    }).join('');
  }

  function readGroups(root) {
    var groups = {};
    root.querySelectorAll('[data-gsc-group][aria-checked="true"]').forEach(function (b) {
      groups[b.dataset.gscGroup] = true;
    });
    return groups;
  }
  function readDsts(root) {
    return Array.prototype.map.call(root.querySelectorAll('[data-gsc-dst][aria-checked="true"]'), function (b) {
      return b.dataset.gscDst;
    });
  }

  // The classes to copy into, as rows with a switch: the same course first.
  // html-safe: class ids and names through esc
  function classRows(targets) {
    function one(c) {
      return row({
        name: c.name,
        pic: '<span class="gsc-mini" data-gsc-mini="' + esc(c.id) + '"></span>',
        on: false,
        attr: 'data-gsc-dst="' + esc(c.id) + '"',
      });
    }
    var out = targets.sameCourse.map(one);
    if (targets.sameCourse.length && targets.other.length) out.push('<div class="gsc-subhead">Other Classes</div>');
    return out.concat(targets.other.map(one)).join('');
  }

  // The class to import from, one round button at a time (the app's own radio rows).
  // html-safe: class ids and names through esc
  function sourceRows(all, chosen) {
    return all
      .map(function (c) {
        var on = c.id === chosen;
        return (
          '<button type="button" class="cm-method gsc-row' +
          (on ? ' active' : '') +
          '" role="radio" aria-checked="' +
          on +
          '" data-gsc-from="' +
          esc(c.id) +
          '"><span class="cm-method-dot" aria-hidden="true"></span><span class="gsc-row-text"><span class="cm-method-name">' +
          esc(c.name) +
          '</span></span><span class="gsc-mini" data-gsc-mini="' +
          esc(c.id) +
          '"></span></button>'
        );
      })
      .join('');
  }

  var DIALOG_HTML =
    '<div class="seg cm-seg gsc-mode" role="radiogroup" aria-label="Direction">' +
    '<button type="button" class="seg-btn cm-seg-btn" role="radio" data-gsc-mode="to">Copy to Other Classes</button>' +
    '<button type="button" class="seg-btn cm-seg-btn" role="radio" data-gsc-mode="from">Import From Another Class</button>' +
    '</div>' +
    '<div id="gsc-classes"></div>' +
    '<span class="cm-label gsc-label">What to Copy</span>' +
    '<div id="gsc-groups" class="cm-method-list"></div>';

  /* One open dialog: st = { cid, mode, only, from, targets, all }. */
  function srcOf(st) {
    return st.mode === 'to' ? st.cid : st.from;
  }

  // Review Changes waits for a class (or a source) and something to copy.
  function updateOk(root, st) {
    var ok = root.querySelector('[data-copy-ok]');
    if (!ok) return;
    var n = st.mode === 'from' ? 1 : readDsts(root).length;
    ok.disabled = !n || !Object.keys(readGroups(root)).length;
  }

  // The picture on each class's row, once the classes are loaded.
  function fillClassMinis(root, st) {
    st.all.forEach(function (c) {
      fillMini(
        root.querySelector('[data-gsc-mini="' + CSS.escape(c.id) + '"]'),
        getGradingScale(c.id),
        c.name + '’s markers',
      );
    });
  }

  function fillGroups(root, st) {
    var srcCid = srcOf(st);
    var box = root.querySelector('#gsc-groups');
    var kept = box.querySelector('[data-gsc-group]') ? readGroups(root) : null;
    box.textContent = 'Loading…';
    G.loadClass(srcCid).then(function () {
      if (srcOf(st) !== srcCid) return;
      box.innerHTML = groupsHtml(srcCid, st.only, kept);
      fillMini(
        box.querySelector('[data-gsc-mini="scale"]'),
        getGradingScale(srcCid),
        (st.mode === 'to' ? 'This class' : G.className(srcCid)) + '’s markers',
      );
      updateOk(root, st);
    });
  }

  function render(root, st) {
    root.querySelectorAll('[data-gsc-mode]').forEach(function (b) {
      var on = b.dataset.gscMode === st.mode;
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', String(on));
    });
    var me = esc(G.className(st.cid));
    // html-safe: the class name through esc; the rows are built from escaped names
    root.querySelector('#gsc-classes').innerHTML =
      '<span class="cm-label gsc-label">' +
      (st.mode === 'to' ? 'Copy ' + me + '’s Setup Into' : 'Import Into ' + me + ' From') +
      '</span><div class="cm-method-list"' +
      (st.mode === 'from' ? ' role="radiogroup" aria-label="Import from"' : '') +
      '>' +
      (st.mode === 'to' ? classRows(st.targets) : sourceRows(st.all, st.from)) +
      '</div>';
    fillClassMinis(root, st);
    Promise.all(
      st.all.map(function (c) {
        return G.loadClass(c.id);
      }),
    ).then(function () {
      fillClassMinis(root, st);
    });
    fillGroups(root, st);
    updateOk(root, st);
  }

  // A press on a source picks it.
  function pickSource(root, st, src) {
    st.from = src.dataset.gscFrom;
    root.querySelectorAll('[data-gsc-from]').forEach(function (b) {
      var on = b === src;
      b.setAttribute('aria-checked', String(on));
      b.classList.toggle('active', on);
    });
    fillGroups(root, st);
  }

  // A press on a row or its switch flips it; on a source, picks it; on a direction, turns the dialog round.
  function press(root, st, e) {
    var dir = e.target.closest && e.target.closest('[data-gsc-mode]');
    if (dir) {
      if (dir.dataset.gscMode !== st.mode) {
        st.mode = dir.dataset.gscMode;
        render(root, st);
      }
      return;
    }
    var src = e.target.closest && e.target.closest('[data-gsc-from]');
    if (src) return pickSource(root, st, src);
    var r = e.target.closest && e.target.closest('.gsc-row');
    var sw = r && r.querySelector('.rb-switch');
    if (!sw || sw.disabled) return;
    var on = sw.getAttribute('aria-checked') !== 'true';
    sw.setAttribute('aria-checked', String(on));
    r.classList.toggle('active', on);
    updateOk(root, st);
  }

  // Review Changes: plan each class's copy, then show the check step.
  function reviewChanges(root, st, onDone) {
    var srcCid = srcOf(st);
    var dsts = st.mode === 'from' ? [st.cid] : readDsts(root);
    var groups = readGroups(root);
    if (!srcCid || !dsts.length || !Object.keys(groups).length) return false;
    Promise.all(dsts.map(G.loadClass)).then(function () {
      G.review(
        dsts.map(function (d) {
          return G.planSetup(srcCid, d, groups);
        }),
        onDone,
      );
    });
    return true;
  }

  /* opts: { mode: 'to' | 'from', only: group key, onDone(dstCids) }. */
  function openDialog(cid, opts) {
    opts = opts || {};
    var targets = AssessmentCopy.copyTargets(cid);
    var all = targets.sameCourse.concat(targets.other);
    if (!all.length) {
      G.toast('You have no other classes to copy with.');
      return;
    }
    var st = {
      cid: cid,
      mode: opts.mode || 'to',
      only: opts.only || null,
      from: all[0].id,
      targets: targets,
      all: all,
    };
    var overlay = AssessmentCopy.dialog({
      title: st.only === 'categories' ? 'Copy Categories' : 'Copy Grading Setup',
      html: DIALOG_HTML,
      okLabel: 'Review Changes',
      onOpen: function (root) {
        root.classList.add('gsc-dialog');
        render(root, st);
        root.addEventListener('click', function (e) {
          press(root, st, e);
        });
      },
      onOk: function (root) {
        return reviewChanges(root, st, opts.onDone);
      },
    });
    // Land on the first class to pick; Review Changes waits for a choice.
    var first = overlay.querySelector('[data-gsc-dst], [data-gsc-from]');
    if (first && first.focus) first.focus();
    return overlay;
  }

  G.openDialog = openDialog;
  // Named, so the router can tell this file ran as well as grading-setup-copy.js (Router `needs`).
  /** @type {any} */ (window).GradingSetupCopyDialog = { openDialog: openDialog, mini: mini };
})();
