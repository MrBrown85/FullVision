// @ts-check
/* calc-scale.js — a grade under a scale that is not saved.

   Class Settings' Points and Proficiency edits a draft until Save. To show
   what a draft would do (Check With a Student, which letters change, the
   question at Save, a copy into another class) the grades are worked out
   under that scale for one call, with the same formulas: calc.js reads the
   scale through _scaleOf, and this swaps what _scaleOf gives. Nothing is
   written: the saved scale is never touched. The caches the draft's grades
   fill are thrown away when the call ends and the ones from before put
   back, also when it throws. */

/** The caches calc.js fills while it works out a grade, in clearProfCache's order. */
function _profCaches() {
  return [
    _tagScoresCache,
    _criterionIndexCache,
    _tagProfCache,
    _awCache,
    _assessMapCache,
    _sectionByIdCache,
    _assessmentOverallCache,
    _categoryAvgCache,
    _courseLetterCache,
    _pieceIndexCache,
    _pieceRankCache,
    _orderedEntriesCache,
    _countedScoresCache,
  ];
}
function _setProfCaches(c) {
  _tagScoresCache = c[0];
  _criterionIndexCache = c[1];
  _tagProfCache = c[2];
  _awCache = c[3];
  _assessMapCache = c[4];
  _sectionByIdCache = c[5];
  _assessmentOverallCache = c[6];
  _categoryAvgCache = c[7];
  _courseLetterCache = c[8];
  _pieceIndexCache = c[9];
  _pieceRankCache = c[10];
  _orderedEntriesCache = c[11];
  _countedScoresCache = c[12];
}

/** Run `fn` with the class's grades worked out under `scale` (a Points and
 * Proficiency scale: boundaries, percents, labels), and give back what it
 * returns. `fn` must finish at once, as withReturnedOnly's must. Calls can sit
 * inside each other, and inside readAsOfTerm. */
function withGradingScale(cid, scale, fn) {
  var was = _scaleOverride;
  var cachesWere = _profCaches();
  var result;
  _scaleOverride = { cid: cid, scale: scale };
  _setProfCaches(
    cachesWere.map(function () {
      return {};
    }),
  );
  try {
    result = fn();
  } finally {
    _scaleOverride = was;
    _setProfCaches(cachesWere);
  }
  if (result && typeof result.then === 'function') {
    throw new Error(
      'withGradingScale was given work that does not finish at once (it returned a promise). ' +
        'The rest of that work would use the saved scale. Work the grades out first, then wait.',
    );
  }
  return result;
}
