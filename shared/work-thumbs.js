/* ── work-thumbs.js — pictures of student work, through one helper (S14-T1) ──
   Every address for a page of student work comes from data.js's
   openStudentWorkPage(cid, file, which), which answers { url, release } or
   null. A queued photo's address holds its bytes until it is let go, and the
   answer comes back later, when the screen may have moved on. This helper
   does both jobs in one place for a screen that shows many pictures at once
   (the Work Wall, the Work tab on the teacher's student page).

   var pics = WorkThumbs.holder();
   pics.fill(root, cid, lookup)
     For each <img data-work-pic> inside root with no src yet, shows the
     picture of the file lookup(img) gives: its thumbnail, or the whole page
     when the img says data-work-which="page" (only for a page opened full
     size). One address per file and size is asked for once and kept while
     any img on the page shows it, so drawing the screen again asks for
     nothing new. An answer is drawn only if, when it comes, the holder has
     not been let go and lookup(img) still gives a file with the same id and
     address; otherwise that img is left alone, and an address no img took
     is let go.
   pics.sweep()       lets go of every address no img on the page shows.
   pics.releaseAll()  lets go of everything; answers still on their way are
                      let go when they come.
   pics.held()        how many addresses are held (for tests).

   Other screens that show work today load their pictures their own way
   (the grader's work pane in teacher/page-assignments.js,
   teacher-mobile/grade-photos.js, teacher-mobile/add-work.js); they can move
   to this later. Nothing here calls the server. */
window.WorkThumbs = (function () {
  'use strict';

  function _which(img) {
    return img.getAttribute('data-work-which') === 'page' ? 'page' : 'thumb';
  }

  function _address(file, which) {
    var a = file ? (which === 'thumb' ? file.thumb_path : file.path) : null;
    return typeof a === 'string' && a ? a : null;
  }

  function _key(cid, file, which) {
    return [cid, which, file.id, _address(file, which)].join('|');
  }

  function holder() {
    var held = {}; // key → { page, imgs }
    var waiting = {}; // key → [img, …] asked for, answer not in yet
    var gen = 0;

    function _show(entry, img) {
      img.setAttribute('src', entry.page.url);
      if (entry.imgs.indexOf(img) < 0) entry.imgs.push(img);
    }

    function fill(root, cid, lookup) {
      if (!root || typeof lookup !== 'function' || typeof openStudentWorkPage !== 'function') return;
      Array.prototype.forEach.call(root.querySelectorAll('img[data-work-pic]'), function (img) {
        if (img.getAttribute('src')) return;
        var which = _which(img);
        var file = lookup(img);
        if (!_address(file, which)) return;
        var key = _key(cid, file, which);
        if (held[key]) return _show(held[key], img);
        if (waiting[key]) {
          if (waiting[key].indexOf(img) < 0) waiting[key].push(img);
          return;
        }
        waiting[key] = [img];
        var mine = gen;
        openStudentWorkPage(cid, file, which).then(function (page) {
          // Let go of everything since it was asked: no img takes it.
          var imgs = mine === gen ? waiting[key] || [] : [];
          if (mine === gen) delete waiting[key];
          if (!page) return;
          var entry = { page: page, imgs: [] };
          imgs.forEach(function (one) {
            if (!one.isConnected || one.getAttribute('src') || _which(one) !== which) return;
            var now = lookup(one);
            if (!_address(now, which) || _key(cid, now, which) !== key) return;
            _show(entry, one);
          });
          if (!entry.imgs.length) return page.release();
          held[key] = entry;
        });
      });
    }

    function sweep() {
      Object.keys(held).forEach(function (key) {
        var entry = held[key];
        entry.imgs = entry.imgs.filter(function (img) {
          return img.isConnected && img.getAttribute('src') === entry.page.url;
        });
        if (entry.imgs.length) return;
        entry.page.release();
        delete held[key];
      });
    }

    function releaseAll() {
      gen++;
      Object.keys(held).forEach(function (key) {
        held[key].page.release();
      });
      held = {};
      waiting = {};
    }

    return {
      fill: fill,
      sweep: sweep,
      releaseAll: releaseAll,
      held: function () {
        return Object.keys(held).length;
      },
    };
  }

  return { holder: holder };
})();
