/* ── add-work-files.js — a teacher's files, made into pages of work ──────
   Add Work's Choose Files on the teacher's computer: each file shrunk the
   way a student's are (PhotoShrink.prepare), its pages kept in order, then
   recorded as the teacher's work (addStudentWorkPages and friends, in
   shared/data-student-work.js). The grader's Add Work, the row's + (Attach
   Work) on the Assignments page and Add Work for the Class
   (teacher/add-work-class.js) all use these. Moved from
   teacher/page-assignments.js on 2026-11-17, unchanged. The refusals say
   what the phone's Add Work says (teacher-mobile/add-work.js).

   AddWorkFiles.prepare(files)  Promise of { pages, said }: `said` is the
                                first refusal ('' when every file is used).
   AddWorkFiles.refusal(res)    the words for a file PhotoShrink refused.
   AddWorkFiles.answer(res)     the words for a data-layer answer that
                                isn't "added". */
window.AddWorkFiles = (function () {
  'use strict';

  function refusal(res) {
    var R = (window.PhotoShrink && PhotoShrink.REASONS) || {};
    if (res && res.reason === R.OFFICE) return 'Save it as a PDF first.';
    // A PDF becomes pages through shared/photo-readers.js (pdf.js, PR 1073).
    if (res && res.kind === 'pdf' && res.locked)
      return 'That PDF has a password. Save a copy without one, then add it.';
    if (res && res.kind === 'pdf' && res.reason === R.NO_DECODER)
      return "The PDF reader couldn't load. Check the connection and try again.";
    if (res && (res.reason === R.TOO_MANY_PAGES || res.reason === R.PDF_TOO_LARGE))
      return 'That PDF is too long to add here.';
    if (res && res.kind === 'heic' && res.reason === R.NO_DECODER)
      return 'Save that photo as a JPEG first, then add it.';
    return "That file couldn't be used. Try another photo.";
  }

  function answer(res) {
    if (res.result === 'too_many_pages') return 'A piece of work can have 30 pages at most.';
    if (res.result === 'storage_full') return 'This computer is full. Free some space, then try again.';
    if (res.result === 'already_sent') return 'Work came in for this student meanwhile. It is shown now.';
    if (res.result === 'not_available') return 'Adding work is not ready for signed-in classes yet.';
    if (res.result === 'class_full') return 'This class has no room for more photos.';
    if (res.result === 'nothing_sent') return 'That work was taken away meanwhile. Add it again as new work.';
    if (res.result === 'uploading') return "That work is still uploading. Try again when it's in.";
    if (res.result === 'on_paper') return 'This was handed in on paper. Use Replace Them to add photos.';
    if (res.result === 'not_found') return 'This student is no longer in this class.';
    return "The photos couldn't be kept. Try again.";
  }

  /* Each file shrunk in turn, its pages kept in order. */
  function prepare(files) {
    var pages = [];
    var said = '';
    return files
      .reduce(function (p, file) {
        return p.then(function () {
          if (said) return;
          return PhotoShrink.prepare(file, { openPdf: window.PhotoReaders && PhotoReaders.openPdf }).then(
            function (res) {
              if (!res || !res.ok) said = refusal(res);
              else pages = pages.concat(res.pages);
              if (!said && pages.length > STUDENT_WORK_MAX_PAGES) said = 'A piece of work can have 30 pages at most.';
            },
          );
        });
      }, Promise.resolve())
      .then(function () {
        return { pages: pages, said: said };
      });
  }

  return { prepare: prepare, refusal: refusal, answer: answer };
})();
