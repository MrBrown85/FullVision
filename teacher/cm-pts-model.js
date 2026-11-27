// @ts-check
/* cm-pts-model.js — Points and Proficiency, as numbers.

   The scale a class saves is { boundaries, percents, labels }: where each
   proficiency starts on a points score, what each step (1 to 4, with + and −)
   counts as in the course %, and any renamed levels. Class Settings edits a
   draft of it until Save (docs/DECISIONS.md, "Points and Proficiency locks
   until Edit"). Everything here is pure except gradeEffects, which asks
   calc.js: it takes a scale and gives back a scale, a list of marks to draw,
   or the lines a question shows. Nothing here is drawn and nothing is saved.

   A grade is worked out only by calc.js. gradeEffects runs its functions under
   a scale that is not saved (withGradingScale) and reads what they say. */
window.CmPtsModel = (function () {
  'use strict';

  // Markers closer than this (in % of the ruler) go on two rows: a pill's
  // width on the narrowest ruler (.cm-pts-ruler's min-width, 420px).
  var CLOSE = 7.6;
  // A ghost this close to a live marker on its row is a small ring, not a pill.
  var NEAR = 4.2;
  // Two steps closer than this are the same.
  var SAME = 0.049;

  // The proficiency words, by level: the scale's own legend.
  function names() {
    var out = {};
    [1, 2, 3, 4].forEach(function (l) {
      out[l] = PROF_LABELS[l];
    });
    return out;
  }
  function stepId(key) {
    return key.replace('+', 'p').replace('-', 'm');
  }
  // 2- reads 2−.
  function stepLabel(key) {
    return key.replace('-', '−');
  }
  // Every step's percent, keyed as COUNTS_AS_STEPS.
  function stepValues(scale) {
    var list = countsAsStepPercents(scale && scale.percents);
    var out = {};
    COUNTS_AS_STEPS.forEach(function (step, i) {
      out[step.key] = list[i];
    });
    return out;
  }
  function hasOwnStep(scale, key) {
    var p = scale && scale.percents;
    return !!p && p[key] != null && p[key] !== '';
  }
  // The percents a save writes: every whole level, and each + or − that has
  // a value of its own.
  function ownPercents(scale) {
    var saved = stepValues(scale);
    var out = {};
    COUNTS_AS_STEPS.forEach(function (step) {
      if (step.key.length === 1 || hasOwnStep(scale, step.key)) out[step.key] = saved[step.key];
    });
    return out;
  }
  // Where each proficiency starts on a points score: { 1: 0, 2: 50, 3: 73, 4: 86 }.
  function starts(scale) {
    var at = { 1: 0 };
    ((scale && scale.boundaries) || DEFAULT_GRADING_SCALE.boundaries).forEach(function (row) {
      if (row.proficiency > 1) at[row.proficiency] = Number(row.min) || 0;
    });
    return at;
  }
  // One decimal at most: 91.7, 86.
  function pctText(v) {
    return String(Math.round(v * 10) / 10);
  }
  function left(v) {
    return Math.max(0, Math.min(100, v)) + '%';
  }
  function values(scale) {
    var v = stepValues(scale);
    return COUNTS_AS_STEPS.map(function (s) {
      return v[s.key];
    });
  }

  // Row 0 or 1 for each marker, lowest first: one too close to the last
  // marker on the top row drops to the second.
  function rows(vals) {
    var last = [-Infinity, -Infinity];
    return vals.map(function (v) {
      var row = v - last[0] >= CLOSE ? 0 : v - last[1] >= CLOSE ? 1 : last[0] <= last[1] ? 0 : 1;
      last[row] = v;
      return row;
    });
  }

  // A scale from its starts and its own percents; labels saved before the
  // scale moved here are kept as they were.
  function build(at, percents, labels) {
    return {
      boundaries: DEFAULT_GRADING_SCALE.boundaries.map(function (db) {
        return { min: db.proficiency === 1 ? 0 : at[db.proficiency], proficiency: db.proficiency };
      }),
      percents: percents,
      labels: labels || null,
    };
  }

  // Everything a scale stores, as one string: starts, own percents and level names.
  function stored(scale) {
    return JSON.stringify([starts(scale), ownPercents(scale), (scale && scale.labels) || null]);
  }

  // Whether two scales are the same to the teacher: the same starts and the same own percents.
  function sameScale(a, b) {
    return JSON.stringify([starts(a), ownPercents(a)]) === JSON.stringify([starts(b), ownPercents(b)]);
  }

  // The sentence for a scale that breaks a rule, or null: each proficiency
  // starts higher than the one below, each step counts for more than the one below.
  function invalid(scale) {
    var at = starts(scale);
    if (!(at[2] > at[1] && at[3] > at[2] && at[4] > at[3]))
      return 'Each proficiency must start higher than the one below it.';
    var ladder = countsAsStepPercents(scale.percents);
    var rising = ladder.every(function (x, i) {
      return i === 0 || x > ladder[i - 1];
    });
    return rising ? null : 'Each step must count for more than the one below it.';
  }

  /* One marker's or handle's new percent, typed, nudged or dragged, with the
     rules the old boxes had: a whole level always has a value; a + or −
     keeps its own, or is left in between when it is cleared or still shows
     its in-between value; each step counts for more than the one below;
     each proficiency starts higher than the one below it.
     Gives { scale } (the draft with the change; the same scale when nothing
     changes), { back: true } (blank or not a number: leave it as it is), or
     { error } with the sentence to show. */
  function edit(scale, pick, raw) {
    var saved = stepValues(scale);
    var at = starts(scale);
    var percents = ownPercents(scale);
    var text = String(raw == null ? '' : raw).trim();
    var v = parseFloat(text);
    if (pick.kind === 'edge') {
      if (!isFinite(v)) return { back: true };
      at[pick.level] = Math.max(0, Math.min(99, parseInt(text, 10) || 0));
      if (!(at[2] > at[1] && at[3] > at[2] && at[4] > at[3]))
        return { error: 'Each proficiency must start higher than the one below it.' };
    } else {
      var whole = pick.key.length === 1;
      if (text === '' || !isFinite(v)) {
        if (whole || text !== '') return { back: true };
        delete percents[pick.key];
      } else {
        var r = Math.round(Math.max(0, Math.min(100, v)) * 10) / 10;
        if (!whole && !hasOwnStep(scale, pick.key) && pctText(r) === pctText(saved[pick.key]))
          delete percents[pick.key];
        else percents[pick.key] = r;
      }
      var ladder = countsAsStepPercents(percents);
      var rising = ladder.every(function (x, i) {
        return i === 0 || x > ladder[i - 1];
      });
      if (!rising) return { error: 'Each step must count for more than the one below it.' };
    }
    return { scale: sameScale(scale, build(at, percents)) ? scale : build(at, percents, scale.labels) };
  }

  /* How far a drag can take a marker or handle: between its neighbours. */
  function range(scale, p) {
    if (p.kind === 'edge') {
      var at = starts(scale);
      return [at[p.level - 1] + 1, p.level === 4 ? 99 : at[p.level + 1] - 1];
    }
    var list = countsAsStepPercents(scale.percents);
    var i = COUNTS_AS_STEPS.findIndex(function (s) {
      return s.key === p.key;
    });
    var lo = i > 0 ? list[i - 1] + 0.1 : 0;
    var hi = i < list.length - 1 ? list[i + 1] - 0.1 : 100;
    return [Math.ceil(lo * 10) / 10, Math.floor(hi * 10) / 10];
  }

  // What a preset button would make of a scale: BC Letter Bands and Match
  // Columns move Counts As only; Reset to Defaults moves both.
  function preset(name, scale) {
    var labels = scale.labels || null;
    if (name === 'bc')
      return { boundaries: scale.boundaries, percents: Object.assign({}, BC_LETTER_BAND_PERCENTS), labels: labels };
    if (name === 'match')
      return {
        boundaries: scale.boundaries,
        percents: CmGradingBars.matchedPercents(scale.boundaries),
        labels: labels,
      };
    return structuredClone(DEFAULT_GRADING_SCALE);
  }

  /* What stays behind where the saved scale had its markers, drawn while a
     draft or a preview is on the ruler (the board's ghost rule): every step
     whose value differs from the saved one leaves a mark at its saved place,
     on the row it had when saved. A pill (dashed, hollow) when the teacher set
     that step themselves and no live marker on that row is within NEAR %,
     else a small ring. A ghost on its marker's row is tied to it by a dotted
     line. A band start that moved leaves a dashed line and tab.
     previewing: the live markers are a preset's, so none was set by hand. */
  function ghosts(saved, shown, previewing) {
    var sv = values(saved);
    var nv = values(shown);
    var rowsSaved = rows(sv);
    var rowsNow = rows(nv);
    /** @type {{ ghosts: any[], tethers: any[], edges: any[] }} */
    var out = { ghosts: [], tethers: [], edges: [] };
    COUNTS_AS_STEPS.forEach(function (step, i) {
      if (Math.abs(nv[i] - sv[i]) <= SAME) return;
      var key = step.key;
      var mine =
        !previewing &&
        hasOwnStep(shown, key) &&
        (!hasOwnStep(saved, key) || Number(shown.percents[key]) !== Number(saved.percents[key]));
      var room = !nv.some(function (v, j) {
        return rowsNow[j] === rowsSaved[i] && Math.abs(v - sv[i]) < NEAR;
      });
      out.ghosts.push({
        key: key,
        label: stepLabel(key),
        at: sv[i],
        low: rowsSaved[i] === 1,
        ring: !(mine && room),
        title: 'Put ' + stepLabel(key) + ' back at ' + pctText(sv[i]) + '%',
      });
      if (rowsSaved[i] === rowsNow[i])
        out.tethers.push({ at: Math.min(nv[i], sv[i]), width: Math.abs(nv[i] - sv[i]), low: rowsNow[i] === 1 });
    });
    var a = starts(saved);
    var b = starts(shown);
    [2, 3, 4].forEach(function (l) {
      if (a[l] === b[l]) return;
      out.edges.push({
        level: l,
        at: a[l],
        label: a[l] + '%',
        title: 'Put ' + names()[l] + ' back at ' + a[l] + '%',
      });
    });
    return out;
  }

  /* What a draft moved, for the question at Save and the lines in Copy
     Grading Setup: each step whose value changed (from → to, as shown), each
     band start that moved. */
  function changes(from, to) {
    var a = values(from);
    var b = values(to);
    /** @type {{ steps: any[], edges: any[] }} */
    var out = { steps: [], edges: [] };
    COUNTS_AS_STEPS.forEach(function (step, i) {
      if (Math.abs(a[i] - b[i]) <= SAME) return;
      out.steps.push({
        key: step.key,
        label: stepLabel(step.key),
        level: step.key.charAt(0),
        from: pctText(a[i]) + '%',
        to: pctText(b[i]) + '%',
      });
    });
    var x = starts(from);
    var y = starts(to);
    [2, 3, 4].forEach(function (l) {
      if (x[l] !== y[l]) out.edges.push({ level: l, name: names()[l], from: x[l] + '%', to: y[l] + '%' });
    });
    return out;
  }

  // The lines Copy Grading Setup lists: "3: 75% → 80%." and "Proficient starts at 73% → 70%."
  function lines(from, to) {
    var c = changes(from, to);
    return c.steps
      .map(function (s) {
        return s.label + ': ' + s.from + ' → ' + s.to + '.';
      })
      .concat(
        c.edges.map(function (e) {
          return e.name + ' starts at ' + e.from + ' → ' + e.to + '.';
        }),
      );
  }

  // Whether two scales differ in anything a teacher sees: a step's percent or a band start.
  function differs(a, b) {
    var c = changes(a, b);
    return c.steps.length > 0 || c.edges.length > 0;
  }

  /* What a scale would do to a class's course %, from calc.js, under the year
     so far: { pctMoves } (any student's course % as shown would differ) and
     { moves } (each student whose letter changes, in last-name order, with
     { name, from, to }). A Proficiency class shows no course %: nothing moves. */
  function gradeEffects(cid, from, to) {
    var none = { pctMoves: false, moves: [] };
    if (courseGradeMode(cid) === 'proficiency') return none;
    var students = sortStudents(getStudents(cid), 'lastName');
    function read(scale) {
      return readAsOfTerm(cid, null, function () {
        return withGradingScale(cid, scale, function () {
          return students.map(function (s) {
            var l = getCourseLetterData(cid, s.id);
            return { letter: (l && l.S) || '', pct: formatCoursePercent(cid, l ? l.R : null) };
          });
        });
      });
    }
    if (!differs(from, to)) return none;
    var a = read(from);
    var b = read(to);
    /** @type {{ pctMoves: boolean, moves: any[] }} */
    var out = { pctMoves: false, moves: [] };
    students.forEach(function (s, i) {
      if (a[i].pct !== b[i].pct) out.pctMoves = true;
      if (a[i].letter !== b[i].letter)
        out.moves.push({ name: fullName(s), from: a[i].letter || '—', to: b[i].letter || '—' });
    });
    return out;
  }

  return {
    CLOSE: CLOSE,
    names: names,
    stepId: stepId,
    stepLabel: stepLabel,
    stepValues: stepValues,
    hasOwnStep: hasOwnStep,
    ownPercents: ownPercents,
    starts: starts,
    pctText: pctText,
    left: left,
    values: values,
    rows: rows,
    build: build,
    invalid: invalid,
    sameScale: sameScale,
    stored: stored,
    edit: edit,
    range: range,
    preset: preset,
    ghosts: ghosts,
    changes: changes,
    differs: differs,
    lines: lines,
    gradeEffects: gradeEffects,
  };
})();
