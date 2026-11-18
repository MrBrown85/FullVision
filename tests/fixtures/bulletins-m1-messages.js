/* Every message the teacher's Bulletins functions raise while they run, copied
   from migrations/2026111801_bulletins.sql on the branch
   origin/claude/bulletins-b1a-database at commit fb3bebfa (B1a, migration M1).
   That file is not on this branch, so this list is a copy: when M1 changes, a
   message added or reworded there is added or reworded here, and
   tests/bulletins-refusals.test.js checks that shared/data-bulletins.js
   (_BLT_REFUSALS) gives each one its own plain sentence.

   raised   the message as the SQL writes it (a % is filled in by the server)
   example  the message as the server sends it
   code     the error code it carries
   call     the function that raised it (more than one for a shared check)
   sentence what the teacher is shown
   Apply-time guard messages ("Nothing was changed.") are not here: they stop
   the migration, never a call from the app. */
export const GENERAL = 'Bulletins could not be saved. Try again in a moment.';
export const NOT_ACCEPTED = 'This bulletin was not accepted. Check it and try again.';

export const M1_MESSAGES = [
  // bulletin_patched: the shape of p_bulletin / p_patch
  {
    raised: 'a bulletin is an object',
    example: 'a bulletin is an object',
    code: '22023',
    call: 'post_bulletin',
    sentence: NOT_ACCEPTED,
  },
  {
    raised: 'a bulletin has no % that can be set',
    example: 'a bulletin has no colour that can be set',
    code: '22023',
    call: 'post_bulletin',
    sentence: NOT_ACCEPTED,
  },
  {
    raised: '% must be a %',
    example: 'pinned must be a boolean',
    code: '22023',
    call: 'edit_bulletin',
    sentence: NOT_ACCEPTED,
  },
  {
    raised: '% must be a %',
    example: 'body must be a string',
    code: '22023',
    call: 'post_bulletin',
    sentence: NOT_ACCEPTED,
  },
  {
    raised: '% must be a date',
    example: 'pinned_until must be a date',
    code: '22023',
    call: 'post_bulletin',
    sentence: 'Stays Pinned Until must be a date.',
  },
  {
    raised: '% must be a id',
    example: 'assessment_id must be a id',
    code: '22023',
    call: 'post_bulletin',
    sentence: 'The linked assessment could not be found. Choose another one, or None.',
  },
  // bulletin_patched: the rules (_why)
  {
    raised: 'a bulletin is an announcement or a reminder',
    example: 'a bulletin is an announcement or a reminder',
    code: '22023',
    call: 'post_bulletin',
    sentence: 'Choose Announcement or Reminder.',
  },
  {
    raised: "a bulletin's words can be 2000 characters at most",
    example: "a bulletin's words can be 2000 characters at most",
    code: '22023',
    call: 'post_bulletin',
    sentence: 'Words can be up to 2,000 characters.',
  },
  {
    raised:
      'a link must start with http:// or https:// and a host (no name or password), with no spaces or hidden characters, 2000 characters at most',
    example:
      'a link must start with http:// or https:// and a host (no name or password), with no spaces or hidden characters, 2000 characters at most',
    code: '22023',
    call: 'edit_bulletin',
    sentence:
      'A link must start with http:// or https:// and a host, with no user name, password, spaces or hidden characters.',
  },
  {
    raised: "a link's name needs a link",
    example: "a link's name needs a link",
    code: '22023',
    call: 'post_bulletin',
    sentence: 'A link name needs a link. Add the link, or clear the name.',
  },
  {
    raised: "a link's name can be 200 characters at most",
    example: "a link's name can be 200 characters at most",
    code: '22023',
    call: 'post_bulletin',
    sentence: 'A link name can be up to 200 characters.',
  },
  {
    raised: 'only a reminder can stay pinned until a date',
    example: 'only a reminder can stay pinned until a date',
    code: '22023',
    call: 'edit_bulletin',
    sentence: 'Only a reminder can stay pinned until a date.',
  },
  {
    raised: 'a date to stay pinned until needs the reminder pinned',
    example: 'a date to stay pinned until needs the reminder pinned',
    code: '22023',
    call: 'edit_bulletin',
    sentence: 'A reminder has to be pinned to stay pinned until a date.',
  },
  {
    raised: 'the date to stay pinned until has passed',
    example: 'the date to stay pinned until has passed',
    code: '22023',
    call: 'post_bulletin',
    sentence: 'Stays Pinned Until cannot be before today.',
  },
  {
    raised: 'the linked assessment is not in this class',
    example: 'the linked assessment is not in this class',
    code: '22023',
    call: 'post_bulletin',
    sentence: 'The linked assessment is not in this class. Choose another one, or None.',
  },
  {
    raised: 'a bulletin needs words, a link or a file',
    example: 'a bulletin needs words, a link or a file',
    code: '22023',
    call: 'post_bulletin',
    sentence: 'Write something, add a link or add a file.',
  },
  // post_bulletin: p_files
  {
    raised: 'files must be a list',
    example: 'files must be a list',
    code: '22023',
    call: 'post_bulletin',
    sentence: NOT_ACCEPTED,
  },
  {
    raised: 'a file is { kind: photo or pdf, title, pages }: a photo is 1 page, a PDF 1 to 20',
    example: 'a file is { kind: photo or pdf, title, pages }: a photo is 1 page, a PDF 1 to 20',
    code: '22023',
    call: 'post_bulletin',
    sentence: 'A file could not be used. A photo is one page, and a PDF is 1 to 20 pages.',
  },
  {
    raised: "a file's name can be 200 characters at most",
    example: "a file's name can be 200 characters at most",
    code: '22023',
    call: 'post_bulletin',
    sentence: 'A file name can be up to 200 characters.',
  },
  {
    raised: 'a bulletin can have 20 pages at most',
    example: 'a bulletin can have 20 pages at most',
    code: '22023',
    call: 'post_bulletin',
    sentence: 'A bulletin can hold up to 20 pages in all.',
  },
  {
    raised: 'a class can hold 2000 bulletin pages at most: delete some bulletins with files first',
    example: 'a class can hold 2000 bulletin pages at most: delete some bulletins with files first',
    code: '22023',
    call: 'post_bulletin',
    sentence: 'This class holds as many bulletin pages as it can. Delete some bulletins with files, then try again.',
  },
  // show_bulletin_again
  {
    raised: 'a bulletin students cannot see yet cannot be shown again',
    example: 'a bulletin students cannot see yet cannot be shown again',
    code: '22023',
    call: 'show_bulletin_again',
    sentence: 'Students cannot see that bulletin yet, so it cannot be shown again.',
  },
  // not found, and signed out: told apart by the call
  {
    raised: 'course not found',
    example: 'course not found',
    code: 'P0002',
    call: 'post_bulletin',
    sentence: 'This class is no longer there.',
  },
  {
    raised: 'course not found',
    example: 'course not found',
    code: 'P0002',
    call: 'list_bulletins',
    sentence: 'This class is no longer there.',
  },
  {
    raised: 'bulletin not found',
    example: 'bulletin not found',
    code: 'P0002',
    call: 'edit_bulletin',
    sentence: 'That bulletin is no longer there.',
  },
  {
    raised: 'bulletin not found',
    example: 'bulletin not found',
    code: 'P0002',
    call: 'delete_bulletin',
    sentence: 'That bulletin is no longer there.',
  },
  {
    raised: 'bulletin not found',
    example: 'bulletin not found',
    code: 'P0002',
    call: 'show_bulletin_again',
    sentence: 'That bulletin is no longer there.',
  },
  {
    raised: 'bulletin not found',
    example: 'bulletin not found',
    code: 'P0002',
    call: 'list_bulletin_seen',
    sentence: 'That bulletin is no longer there.',
  },
  {
    raised: 'not authenticated',
    example: 'not authenticated',
    code: 'PT401',
    call: 'post_bulletin',
    sentence: 'You are signed out. Sign in again, then try again.',
  },
  // The same-class trigger: only a student's own write can raise it, never a teacher's call.
  {
    raised: "%: the student is not in the bulletin's class",
    example: "bulletin_seen: the student is not in the bulletin's class",
    code: '23514',
    call: 'post_bulletin',
    sentence: GENERAL,
  },
];
