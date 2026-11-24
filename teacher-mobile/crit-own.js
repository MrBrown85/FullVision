// @ts-check
/* crit-own.js — the phone's Line for One Student (Nov 24 2026): on a pair or
   group's card, a line under a rubric criterion's comment for one member
   alone (rubric_score.own_comment; the desktop's is teacher/crit-comment.js).
   tab-grade.js draws it through html, and passes its taps, typing and
   leaving here. */
/** @type {any} */ (window).MCritOwn = (function () {
  'use strict';

  // What tab-grade.js lends (configure, at its load).
  /** @type {any} */
  var _deps = {
    findCriterion: function () {
      return null;
    },
    assessmentById: function () {
      return null;
    },
    syncReturnBar: function () {},
    fit: function () {},
    timers: {},
  };
  function configure(deps) {
    Object.keys(deps || {}).forEach(function (k) {
      _deps[k] = deps[k];
    });
  }
  function _esc(s) {
    return /** @type {any} */ (window).MComponents.esc(s);
  }

  /* On pair or group work, a line under the criterion's comment for one
     member alone (rubric_score.own_comment, as the desktop's Line for One
     Student): it prints only on their sheet and shows only on their page,
     and the group's grade is never copied over it. On a group's card the
     members who take its grade (not Missing or Excused) each have a name
     under the comment; tapped, it opens that member's box. */
  function _critOwnMembers(cid, a, sid) {
    if (!a || !isLinkedGroupMember(cid, a.id, sid)) return { group: false, ids: [sid] };
    var g = getCollabGroupOf(a, sid);
    return {
      group: true,
      ids: ((g && g.members) || []).filter(function (m) {
        return isLinkedGroupMember(cid, a.id, m) && !isGroupWithheld(cid, m, a.id);
      }),
    };
  }
  function _critOwnLines(cid, sid, aid, crit) {
    var a = _deps.assessmentById(cid, aid);
    return _critOwnMembers(cid, a, sid).ids.filter(function (m) {
      return !!getRubricCriterionOwn(cid, m, aid, crit);
    });
  }
  // html-safe: names and lines go through MC.esc; ids are ids; the rest is fixed markup.
  function _critOwnHtml(cid, sid, a, crit) {
    var who = _critOwnMembers(cid, a, sid);
    var students = getStudents(cid);
    var html = '';
    var buttons = '';
    var any = false;
    who.ids.forEach(function (m) {
      var st = students.find(function (x) {
        return x.id === m;
      });
      var text = getRubricCriterionOwn(cid, m, a.id, crit);
      if (text) any = true;
      if (!text && !who.group) return;
      html +=
        '<label class="m-crit-own"' +
        (text ? '' : ' hidden') +
        '><span class="m-crit-own-label">' +
        _esc((st ? displayNameWithLast(st) : '') + ' Only') +
        '</span><textarea class="m-crit-own-input" rows="1" maxlength="500" placeholder="' +
        _esc('Only on ' + (st ? displayNameFirst(st) : '') + '\u2019s sheet and page') +
        '" data-sid="' +
        m +
        '" data-aid="' +
        a.id +
        '" data-critid="' +
        crit.id +
        '">' +
        _esc(text) +
        '</textarea></label>';
      if (who.group)
        buttons +=
          '<button type="button" class="m-crit-own-btn" data-action="m-grade-crit-own" data-own="' +
          m +
          '"' +
          (text ? ' hidden' : '') +
          '>' +
          _esc(st ? displayNameFirst(st) : '') +
          '</button>';
    });
    if (!html) return '';
    var open = any || !!getRubricCriterionComment(cid, sid, a.id, crit);
    return (
      '<div class="m-crit-own-wrap"' +
      (open ? '' : ' hidden') +
      '>' +
      html +
      (buttons
        ? '<div class="m-crit-each"><span class="m-crit-each-label">Line for One Student:</span>' + buttons + '</div>'
        : '') +
      '</div>'
    );
  }
  // A member's name tapped: their box opens, the cursor in it.
  function openCritOwn(btn) {
    var wrap = btn.closest('.m-crit-own-wrap');
    var box = wrap && wrap.querySelector('.m-crit-own-input[data-sid="' + btn.dataset.own + '"]');
    if (!box) return;
    box.closest('.m-crit-own').hidden = false;
    btn.hidden = true;
    box.focus();
  }
  function _saveCritOwn(cid, el) {
    var key = 'own:' + el.dataset.sid + ':' + el.dataset.aid + ':' + el.dataset.critid;
    clearTimeout(_deps.timers[key]);
    delete _deps.timers[key];
    var found = _deps.findCriterion(cid, el.dataset.aid, el.dataset.critid);
    if (!found) return;
    var text = el.value.trim();
    if (text === getRubricCriterionOwn(cid, el.dataset.sid, el.dataset.aid, found.crit)) return;
    /** @type {any} */ (window).Grader.setCriterionOwn(cid, el.dataset.sid, el.dataset.aid, el.dataset.critid, text);
    var group = el.closest('.m-crit-group');
    var btn = group && group.querySelector('.m-crit-comment-btn');
    var card = el.closest('.m-swiper-card');
    if (btn && card) {
      var has =
        !!getRubricCriterionComment(cid, card.dataset.sid, el.dataset.aid, found.crit) ||
        _critOwnLines(cid, card.dataset.sid, el.dataset.aid, found.crit).length > 0;
      btn.classList.toggle('is-on', has);
    }
    _deps.syncReturnBar();
  }
  // Left empty: back behind the member's name.
  function _closeEmptyCritOwn(el) {
    if (el.value.trim()) return;
    var label = el.closest('.m-crit-own');
    var wrap = el.closest('.m-crit-own-wrap');
    var btn = wrap && wrap.querySelector('.m-crit-own-btn[data-own="' + el.dataset.sid + '"]');
    if (!btn) return;
    label.hidden = true;
    btn.hidden = false;
  }

  // Typed in: saves a moment after the last key.
  function input(cid, el) {
    _deps.fit(el);
    var key = 'own:' + el.dataset.sid + ':' + el.dataset.aid + ':' + el.dataset.critid;
    clearTimeout(_deps.timers[key]);
    _deps.timers[key] = setTimeout(function () {
      _saveCritOwn(cid, el);
    }, 800);
  }

  return {
    configure: configure,
    html: _critOwnHtml,
    lines: _critOwnLines,
    open: openCritOwn,
    save: _saveCritOwn,
    closeEmpty: _closeEmptyCritOwn,
    input: input,
  };
})();
