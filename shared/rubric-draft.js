/* rubric-draft.js — a rubric criterion drafted from a curricular competency.
 *
 * "From competency" in the rubric editor builds a criterion for a competency:
 * named after it, linked to it, with the four level descriptors written from
 * its I-can statements and the BC proficiency scale (initial, partial,
 * complete and sophisticated understanding). The Proficient column is the
 * I-can statements themselves, since they describe meeting the expectation;
 * the other three put the first statement into the scale's words. Everything
 * is in the student's voice, because the descriptors print on the rubric
 * handout. Pure functions: no data is read or written here.
 */
window.RubricDraft = (function () {
  'use strict';

  // The Proficient column keeps at most this many statements, so a drafted
  // rubric still fits the half and quarter sheet handouts.
  var MAX_PROFICIENT = 3;

  function _clean(s) {
    return String(s == null ? '' : s)
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[.;:,]+$/, '');
  }

  /* A competency's I-can statements: the list when the class has it (built
     from the curriculum index), else the newline-separated text the server
     keeps in tag.i_can_text. */
  function statementsOf(tag) {
    if (!tag) return [];
    var list = tag.i_can_statements || tag.iCanStatements;
    if (!Array.isArray(list) || !list.length) {
      var text = tag.i_can_text || tag.iCanText || tag.text || '';
      list = String(text).split(/\n+/);
    }
    return list.map(_clean).filter(Boolean);
  }

  /* "I can design for welding." → "design for welding". A statement that
     doesn't start with "I can" is kept as written. */
  function actionOf(statement) {
    var s = _clean(statement);
    var m = s.match(/^i\s+(?:can|am able to)\s+(.+)$/i);
    return m ? m[1] : s;
  }

  function _sentence(s) {
    s = _clean(s);
    if (!s) return '';
    return s.charAt(0).toUpperCase() + s.slice(1) + '.';
  }

  /* The four descriptors for a competency, keyed 4 (Extending) to 1
     (Emerging). `generic` is true when the competency has no I-can
     statements and the draft could only use the scale's words. */
  function draftLevels(tag) {
    var statements = statementsOf(tag);
    if (!statements.length) {
      return {
        generic: true,
        levels: {
          4: 'Independently and in new situations, I can show this competency, and I can explain my thinking to others.',
          3: 'I can show this competency on my own in most situations.',
          2: 'In familiar situations and with some help, I can show this competency.',
          1: 'With support, I am beginning to show this competency.',
        },
      };
    }
    var first = actionOf(statements[0]);
    var proficient = statements
      .slice(0, MAX_PROFICIENT)
      .map(function (s) {
        return _sentence('I can ' + actionOf(s));
      })
      .join(' ');
    return {
      generic: false,
      levels: {
        4: 'Independently and in new situations, I can ' + first + ', and I can explain my thinking to others.',
        3: proficient,
        2: 'In familiar situations and with some help, I can ' + first + '.',
        1: 'With support, I am beginning to ' + first + '.',
      },
    };
  }

  function _tagName(tag) {
    return _clean((tag && (tag.label || tag.name || tag.code)) || '') || 'Criterion';
  }

  /* A new criterion for one competency. `newId` makes the id (uid() in the
     app) so this stays pure. */
  function draftCriterion(tag, newId) {
    var d = draftLevels(tag);
    return {
      id: newId(),
      name: _tagName(tag),
      tagIds: tag && tag.id ? [tag.id] : [],
      levels: d.levels,
      weight: 1,
      levelValues: null,
    };
  }

  /* "Criterion 2", "Unnamed" or nothing: a name the teacher didn't choose. */
  function isDefaultName(name) {
    return /^(criterion \d+|unnamed|)$/i.test(_clean(name));
  }

  /* True for a criterion nobody has touched: the default name, no
     competencies and no descriptors. A new rubric starts with one. */
  function isBlankCriterion(crit) {
    if (!crit) return false;
    return !hasDescriptors(crit) && !(crit.tagIds || []).length && isDefaultName(crit.name);
  }

  function hasDescriptors(crit) {
    var levels = (crit && crit.levels) || {};
    return [1, 2, 3, 4].some(function (l) {
      return !!String(levels[l] || '').trim();
    });
  }

  return {
    MAX_PROFICIENT: MAX_PROFICIENT,
    statementsOf: statementsOf,
    actionOf: actionOf,
    draftLevels: draftLevels,
    draftCriterion: draftCriterion,
    isDefaultName: isDefaultName,
    isBlankCriterion: isBlankCriterion,
    hasDescriptors: hasDescriptors,
  };
})();
