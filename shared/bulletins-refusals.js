// @ts-check
/* bulletins-refusals.js — Bulletins' plain sentences for the server's
   refusals, and the class's date. Part of the Bulletins data layer
   (shared/data-bulletins.js, loaded first), moved here unchanged for the
   file's size. */

/**
 * Today as the class keeps it (its own time zone, as the server's date checks do:
 * courseToday in shared/data.js), not the device's. The device's date only where
 * the class is not known.
 * @param {string} [cid]
 */
function _bltToday(cid) {
  return cid && typeof courseToday === 'function' ? courseToday(cid) : getTodayStr();
}

var BULLETIN_GENERAL = 'Bulletins could not be saved. Try again in a moment.';
var BULLETIN_NOT_ACCEPTED = 'This bulletin was not accepted. Check it and try again.';

/**
 * The server's refusals, each with its own plain sentence. The keys are the
 * messages migrations/2026111801_bulletins.sql raises (B1a, commit fb3bebfa;
 * tests/fixtures/bulletins-m1-messages.js holds the list). Each is matched
 * whole (an anchored pattern, with the words that carry a name or a number as
 * a wildcard), so no refusal can take another's sentence. A message not listed
 * here gets BULLETIN_GENERAL, never a neighbour's sentence.
 * @type {[RegExp, string][]}
 */
var _BLT_REFUSALS = [
  // The shape of what was sent: nothing the page's own box can make.
  [/^a bulletin is an object$/, BULLETIN_NOT_ACCEPTED],
  [/^a bulletin has no [a-z_]+ that can be set$/, BULLETIN_NOT_ACCEPTED],
  [/^[a-z_]+ must be a (boolean|string)$/, BULLETIN_NOT_ACCEPTED],
  [/^files must be a list$/, BULLETIN_NOT_ACCEPTED],
  // A value.
  [/^pinned_until must be a date$/, 'Stays Pinned Until must be a date.'],
  [/^assessment_id must be a id$/, 'The linked assessment could not be found. Choose another one, or None.'],
  [/^a bulletin is an announcement or a reminder$/, 'Choose Announcement or Reminder.'],
  [/^a bulletin's words can be 2000 characters at most$/, 'Words can be up to 2,000 characters.'],
  [
    /^a link must start with http:\/\/ or https:\/\/ and a host/,
    'A link must start with http:// or https:// and a host, with no user name, password, spaces or hidden characters.',
  ],
  [/^a link's name needs a link$/, 'A link name needs a link. Add the link, or clear the name.'],
  [/^a link's name can be 200 characters at most$/, 'A link name can be up to 200 characters.'],
  [/^only a reminder can stay pinned until a date$/, 'Only a reminder can stay pinned until a date.'],
  [
    /^a date to stay pinned until needs the reminder pinned$/,
    'A reminder has to be pinned to stay pinned until a date.',
  ],
  [/^the date to stay pinned until has passed$/, 'Stays Pinned Until cannot be before today.'],
  [
    /^the linked assessment is not in this class$/,
    'The linked assessment is not in this class. Choose another one, or None.',
  ],
  [/^a bulletin needs words, a link or a file$/, 'Write something, add a link or add a file.'],
  // Files.
  [
    /^a file is \{ kind: photo or pdf, title, pages \}/,
    'A file could not be used. A photo is one page, and a PDF is 1 to 20 pages.',
  ],
  [/^a file's name can be 200 characters at most$/, 'A file name can be up to 200 characters.'],
  [/^a bulletin can have 20 pages at most$/, 'A bulletin can hold up to 20 pages in all.'],
  [
    /^a class can hold 2000 bulletin pages at most/,
    'This class holds as many bulletin pages as it can. Delete some bulletins with files, then try again.',
  ],
  // Show It Again.
  [
    /^a bulletin students cannot see yet cannot be shown again$/,
    'Students cannot see that bulletin yet, so it cannot be shown again.',
  ],
];

/**
 * The plain sentence for a refused write. The server's own words are never
 * shown. PT401 (signed out) and P0002 (not found) are told apart by the call
 * they came from: for a post or a read, P0002 is the class (gone or in the
 * trash); for any other call it is the bulletin. Everything else is looked up
 * in _BLT_REFUSALS by its whole message.
 * @param {any} error @param {string} [rpc] the call that was refused
 */
function _bltMessage(error, rpc) {
  var code = error && error.code ? String(error.code) : '';
  var text = error && error.message ? String(error.message).trim() : '';
  if (code === 'PT401') return 'You are signed out. Sign in again, then try again.';
  if (code === 'P0002') {
    var classCall = rpc === 'post_bulletin' || rpc === 'list_bulletins' || (!rpc && text === 'course not found');
    return classCall ? 'This class is no longer there.' : 'That bulletin is no longer there.';
  }
  for (var i = 0; i < _BLT_REFUSALS.length; i++) {
    if (_BLT_REFUSALS[i][0].test(text)) return _BLT_REFUSALS[i][1];
  }
  return BULLETIN_GENERAL;
}

var BULLETIN_LOST = ''; // a lost post has no reason to give: the page says it was not posted
