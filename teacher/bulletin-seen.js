// @ts-check
/* Who has seen a bulletin, and who answered what (Colin, Nov 18: "much
   better looking ... you've got space"). Opened from Seen by N of M on a
   bulletin: a summary bar, then Not Seen Yet and Seen side by side as name
   chips with initials, Show It Again under the ones who have not seen it,
   and each reaction (Got It, Done, Have a Question) with the names who gave
   it. Notes about paused pages and missing cards close it. */
window.BulletinSeen = (function () {
  'use strict';

  /** @param {string} name */
  function _initials(name) {
    var parts = String(name || '')
      .trim()
      .split(/\s+/);
    var a = parts[0] ? parts[0].charAt(0) : '';
    var b = parts.length > 1 ? parts[parts.length - 1].charAt(0) : '';
    return (a + b).toUpperCase() || '?';
  }

  /** Name chips for a list of student ids; pickable ones are buttons (Remind only them).
      @param {string[]} ids @param {(id: string) => string} nameOf @param {boolean} [pick] */
  // html-safe: every name, id and initials go through esc
  function _chips(ids, nameOf, pick) {
    return (
      '<ul class="bsl-chips">' +
      ids
        .map(function (id) {
          var n = nameOf(id);
          var face = '<span class="bsl-av" aria-hidden="true">' + esc(_initials(n)) + '</span>' + esc(n);
          return pick
            ? '<li><button type="button" class="bsl-chip is-pick" data-bsl-pick="' +
                esc(id) +
                '" aria-pressed="false">' +
                face +
                '</button></li>'
            : '<li class="bsl-chip">' + face + '</li>';
        })
        .join('') +
      '</ul>'
    );
  }

  /** @param {string} cls @param {string} title @param {number} n @param {string} body */
  // html-safe: the title goes through esc; n is a number; body is built here from escaped parts
  function _group(cls, title, n, body) {
    return (
      '<section class="bsl-group ' +
      cls +
      '"><h4 class="bsl-head">' +
      esc(title) +
      '<span class="bsl-count">' +
      n +
      '</span></h4>' +
      body +
      '</section>'
    );
  }

  /** @param {number} all @param {number} picked */
  function _againLabel(all, picked) {
    if (picked) return picked === 1 ? 'Remind 1 Student' : 'Remind ' + picked + ' Students';
    return all === 1 ? 'Remind Them' : 'Remind All ' + all;
  }

  /* Picking names: the group's Remind button names how many and carries their ids. */
  if (document.addEventListener)
    document.addEventListener(
      'click',
      function (e) {
        var t = /** @type {any} */ (e.target);
        var chip = t && t.closest && t.closest('[data-bsl-pick]');
        if (!chip) return;
        e.stopPropagation();
        chip.setAttribute('aria-pressed', chip.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
        var group = chip.closest('.bsl-group');
        var btn = group && group.querySelector('.bsl-again');
        if (!btn) return;
        var ids = Array.prototype.map.call(
          group.querySelectorAll('[data-bsl-pick][aria-pressed="true"]'),
          function (/** @type {any} */ c) {
            return c.getAttribute('data-bsl-pick');
          },
        );
        btn.setAttribute('data-ids', ids.join(','));
        btn.textContent = _againLabel(Number(btn.getAttribute('data-all')) || 0, ids.length);
      },
      true,
    );

  var REACTIONS = [
    ['got_it', 'is-got'],
    ['done', 'is-done'],
    ['question', 'is-question'],
  ];

  /**
   * The panel's inside, once who has seen it has been read.
   * @param {any} b the bulletin
   * @param {any} st its panel state ({ data, again })
   * @param {(id: string) => string} nameOf
   * @param {string} manageHref Class Settings, for students with no card
   */
  // html-safe: names through _chips/esc; counts are numbers; ids and hrefs through esc
  function bodyHtml(b, st, nameOf, manageHref) {
    var data = st.data;
    var notSeen = data.not_seen || [];
    var seen = data.seen || [];
    var total = notSeen.length + seen.length;
    var pct = total ? Math.round((100 * seen.length) / total) : 0;
    var h =
      '<div class="bsl-summary"><span class="bsl-big">' +
      seen.length +
      '<span class="bsl-of"> of ' +
      total +
      '</span></span><span class="bsl-sum-text">' +
      esc(notSeen.length ? 'have seen it' : 'Everyone who can see it has seen it') +
      '</span><span class="bsl-bar" style="--seen:' +
      pct +
      '%"></span></div>';

    var groups = '';
    if (notSeen.length) {
      // Show It Again, renamed for what it does (Colin, Nov 18: "what does 'show it again' mean?"):
      // the bulletin goes back to the top of their student page; nothing is sent to a phone. Picked
      // names remind only them (migration 2026111809).
      var again =
        st.again === 'done'
          ? '<span class="bsl-aside">Back at the top of their student page.</span>'
          : '<div class="bsl-again-row"><button type="button" class="bsl-again" data-bulletin="again" data-id="' +
            esc(b.id) +
            '" data-all="' +
            notSeen.length +
            '"' +
            (st.again === 'busy' ? ' disabled' : '') +
            '>' +
            _againLabel(notSeen.length, 0) +
            '</button><span class="bsl-aside">' +
            esc(notSeen.length > 1 ? 'Pick names to remind only them. ' : '') +
            'It goes back to the top of their student page.</span></div>';
      groups += _group('is-not', 'Not Seen Yet', notSeen.length, _chips(notSeen, nameOf, notSeen.length > 1) + again);
    }
    if (seen.length) groups += _group('is-seen', 'Seen', seen.length, _chips(seen, nameOf));
    if (groups) h += '<div class="bsl-groups">' + groups + '</div>';

    if (b.reactions_on) {
      var reacts = '';
      REACTIONS.forEach(function (r) {
        var ids = (data.reactions && data.reactions[r[0]]) || [];
        if (ids.length) reacts += _group(r[1], BULLETIN_REACTION_WORDS[r[0]], ids.length, _chips(ids, nameOf));
      });
      if (reacts) h += '<h4 class="bsl-sub">Answers</h4><div class="bsl-groups">' + reacts + '</div>';
    }

    var notes = '';
    if (data.paused && data.paused.length)
      notes +=
        '<span class="bsl-aside">' +
        esc(
          data.paused.length +
            (data.paused.length === 1 ? ' student is' : ' students are') +
            ' not counted (page paused).',
        ) +
        '</span>';
    if (data.no_card && data.no_card.length)
      notes +=
        '<a class="bulletin-note-link bsl-aside" href="' +
        esc(manageHref) +
        '">' +
        esc(data.no_card.length + ' Have No Card Yet') +
        '</a>';
    if (notes) h += '<div class="bsl-notes">' + notes + '</div>';
    return h;
  }

  return { bodyHtml: bodyHtml };
})();
