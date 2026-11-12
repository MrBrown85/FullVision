/* cm-roster-file.js — Class Settings › Import Roster: reading the file a teacher chooses (CSV or tab text, column matching, dates).
   Moved from teacher/dash-class-manager.js on 2026-11-12; DashClassManager uses it through CmRosterFile. */
var CmRosterFile = (function () {
  'use strict';

  /* ── Import Roster: reading the file ────────────────────────
     Columns are read by their header, so a MyEd export or a spreadsheet in
     any column order lands in the right fields. A column whose header isn't
     known is guessed from its values (every cell an email address, a
     student number, a date, a name), and the guess is marked. A column that
     looks like designations is only suggested: designations are never
     imported unless the teacher chooses them. A file with no header the
     importer knows is read in the old fixed order: First, Last, Preferred,
     Pronouns, Student Number, Date of Birth, Email; or Name, Preferred,
     Pronouns with fewer than four columns. */
  var ROSTER_IMPORT_FIELDS = [
    ['', 'Ignore'],
    ['lastName', 'Last Name'],
    ['firstName', 'First Name'],
    ['fullName', 'Full Name'],
    ['preferred', 'Preferred Name'],
    ['pronouns', 'Pronouns'],
    ['studentNumber', 'Student Number'],
    ['dateOfBirth', 'Date of Birth'],
    ['email', 'Student Email'],
    ['parentEmail', 'Parent Email'],
    ['parentEmail2', 'Parent Email 2'],
    ['designations', 'Designations'],
    ['ell', 'ELL'],
  ];
  /* The column menu: each choice says what it takes, so there are no rules
     to read up front. */
  var ROSTER_FIELD_MENU = [
    [
      'Name',
      [
        ['fullName', 'Last, First or First Last, in one column.'],
        ['lastName', 'When the file has names in two columns.'],
        ['firstName', 'When the file has names in two columns.'],
        ['preferred', 'The name they go by. MyEd calls it Usual First Name.'],
      ],
    ],
    [
      'About the Student',
      [
        ['studentNumber', "MyEd's Pupil #. Matches students when you import again."],
        ['dateOfBirth', '2012-05-15, May 15 2012, or 5/15/2012.'],
        ['pronouns', 'As written, like she/her.'],
        ['email', 'Their school address.'],
      ],
    ],
    [
      'Family',
      [
        ['parentEmail', 'One or two addresses in a cell.'],
        ['parentEmail2', "A second parent's address, in its own column."],
      ],
    ],
    [
      'Support',
      [
        ['designations', 'BC letter codes, like P or Q.'],
        ['ell', 'Yes, or blank.'],
      ],
    ],
  ];
  var ROSTER_HEADER_ALIASES = {
    lastName: ['last', 'last name', 'lastname', 'surname', 'legal surname', 'legal last name', 'family name'],
    firstName: ['first', 'first name', 'firstname', 'given name', 'legal first name', 'legal given name'],
    fullName: ['name', 'student name', 'full name', 'student'],
    preferred: ['preferred', 'preferred name', 'usual first name', 'usual name', 'nickname', 'goes by'],
    pronouns: ['pronouns', 'pronoun'],
    studentNumber: [
      'student number',
      'studentnumber',
      'student #',
      'student no',
      'student id',
      'pupil #',
      'pupil number',
      'pupil no',
      'local id',
    ],
    dateOfBirth: ['dob', 'date of birth', 'birth date', 'birthdate', 'birthday'],
    email: ['email', 'student email', 'school email', 'e-mail', 'email address'],
    parentEmail: [
      'parent email',
      'guardian email',
      'parent 1 email',
      'guardian 1 email',
      'parent/guardian email',
      'contact email',
      'family email',
    ],
    parentEmail2: ['parent email 2', 'guardian email 2', 'parent 2 email', 'guardian 2 email', 'second parent email'],
    designations: ['designation', 'designations', 'special ed', 'special education', 'special ed category'],
    ell: ['ell', 'esl', 'ell status', 'esl status', 'english language learner'],
  };
  /* Columns a class list often has that FullVision doesn't keep. They are
     left out on purpose, so a file with them still goes straight through. */
  var ROSTER_SKIPPED_HEADERS = [
    'grade',
    'grade level',
    'gr',
    'homeroom',
    'hr',
    'gender',
    'sex',
    'yog',
    'year of graduation',
    'block',
    'period',
    'class',
    'course',
    'section',
    'term',
    'school',
    'teacher',
    'room',
    'status',
    'age',
  ];
  var ROSTER_MYED_HEADERS = [
    'legal surname',
    'legal first name',
    'legal last name',
    'legal given name',
    'usual first name',
    'usual surname',
    'pupil #',
    'pupil number',
    'pupil no',
  ];

  function _rosterHeaderKey(header) {
    return String(header || '')
      .trim()
      .toLowerCase()
      .replace(/[_.]+/g, ' ')
      .replace(/\s+/g, ' ');
  }

  function rosterFieldFor(header) {
    var k = _rosterHeaderKey(header);
    var found = '';
    Object.keys(ROSTER_HEADER_ALIASES).some(function (field) {
      if (ROSTER_HEADER_ALIASES[field].indexOf(k) >= 0) found = field;
      return !!found;
    });
    return found;
  }

  /* Rows of cells. Commas or tabs (whichever the first line has more of),
     "quoted, cells", "" for a quote inside one, CRLF or LF, a leading BOM.
     Each row remembers its place in the file (row.line, 1 for the first),
     so a problem can say "Row 6", as the spreadsheet does. */
  function parseRosterCsv(text) {
    text = String(text || '').replace(/^﻿/, '');
    var first = text.split(/\r?\n/)[0] || '';
    var delim = first.split('\t').length > first.split(',').length ? '\t' : ',';
    var rows = [];
    var row = [];
    var cell = '';
    var quoted = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (quoted) {
        if (c === '"' && text[i + 1] === '"') {
          cell += '"';
          i++;
        } else if (c === '"') quoted = false;
        else cell += c;
      } else if (c === '"' && !cell.trim()) {
        quoted = true;
        cell = '';
      } else if (c === delim) {
        row.push(cell);
        cell = '';
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
      } else cell += c;
    }
    if (cell || row.length) {
      row.push(cell);
      rows.push(row);
    }
    var out = [];
    rows.forEach(function (r, n) {
      var cells = r.map(function (s) {
        return s.trim();
      });
      if (!cells.some(Boolean)) return;
      Object.defineProperty(cells, 'line', { value: n + 1, enumerable: false });
      out.push(cells);
    });
    return out;
  }

  var _ROSTER_MONTHS = {
    jan: 1,
    feb: 2,
    mar: 3,
    apr: 4,
    may: 5,
    jun: 6,
    jul: 7,
    aug: 8,
    sep: 9,
    oct: 10,
    nov: 11,
    dec: 12,
  };
  var _ROSTER_NUM_DATE = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/;

  function _rosterYmd(y, mo, d) {
    var t = new Date(Date.UTC(y, mo - 1, d));
    if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return '';
    return y + '-' + (mo < 10 ? '0' : '') + mo + '-' + (d < 10 ? '0' : '') + d;
  }

  function _rosterYear(y) {
    if (y.length === 4) return +y;
    var yy = +y;
    return yy <= new Date().getFullYear() % 100 ? 2000 + yy : 1900 + yy;
  }

  /* A date as YYYY-MM-DD, or '' when it can't be read or isn't a real date.
     Year first (2012-05-15, 2012/5/15) and written dates (May 15, 2012;
     15 May 2012; Sept 30 2012) are read as they are. A number date with the
     year last is read in the column's order: 'mdy' or 'dmy'. Without one,
     it is read only when a part over 12 says which is the day. */
  function _rosterDate(v, order) {
    v = String(v || '').trim();
    var m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(v);
    if (m) return _rosterYmd(+m[1], +m[2], +m[3]);
    m = _ROSTER_NUM_DATE.exec(v);
    if (m) {
      var a = +m[1],
        b = +m[2],
        y = _rosterYear(m[3]);
      var o = order === 'mdy' || order === 'dmy' ? order : a > 12 ? 'dmy' : b > 12 ? 'mdy' : '';
      if (!o) return '';
      return o === 'mdy' ? _rosterYmd(y, a, b) : _rosterYmd(y, b, a);
    }
    m = /^([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/i.exec(v);
    if (m && _ROSTER_MONTHS[m[1].slice(0, 3).toLowerCase()])
      return _rosterYmd(+m[3], _ROSTER_MONTHS[m[1].slice(0, 3).toLowerCase()], +m[2]);
    m = /^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)\.?,?\s+(\d{4})$/i.exec(v);
    if (m && _ROSTER_MONTHS[m[2].slice(0, 3).toLowerCase()])
      return _rosterYmd(+m[3], _ROSTER_MONTHS[m[2].slice(0, 3).toLowerCase()], +m[1]);
    return '';
  }

  /* Which way a column's number dates run, from all of them together:
     'mdy' when some second part is over 12 (5/22/2012 can only be May 22),
     'dmy' when some first part is, 'ask' when every one could go either
     way, '' when the column has no number dates with the year last. */
  function rosterDateOrder(values) {
    var mdy = false,
      dmy = false,
      any = false;
    values.forEach(function (v) {
      var m = _ROSTER_NUM_DATE.exec(String(v || '').trim());
      if (!m) return;
      any = true;
      if (+m[1] > 12) dmy = true;
      if (+m[2] > 12) mdy = true;
    });
    if (!any) return '';
    if (mdy && !dmy) return 'mdy';
    if (dmy && !mdy) return 'dmy';
    return 'ask';
  }

  function _rosterEmailOk(v) {
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
  }

  var _ROSTER_HOME_MAIL = /@(gmail|hotmail|outlook|live|yahoo|icloud|me|shaw|telus|msn|aol|protonmail|mail)\./i;

  function _rosterCodes(v) {
    return String(v || '')
      .toUpperCase()
      .split(/[\s,;/]+/)
      .filter(Boolean);
  }

  function _rosterIsCode(code) {
    return !!(BC_DESIGNATIONS[code] || SUPPORT_FLAGS[code]);
  }

  /* A field for a column with no header FullVision knows, from its values,
     or '' for none. `used` holds the fields other columns already fill. */
  function _rosterGuess(values, used, header) {
    if (!values.length) return { field: '' };
    var all = function (test) {
      return values.every(test);
    };
    if (all(_rosterEmailOk)) {
      var domains = {};
      values.forEach(function (v) {
        domains[v.split('@')[1].toLowerCase()] = true;
      });
      var school = Object.keys(domains).length === 1 && !values.some(v => _ROSTER_HOME_MAIL.test(v));
      if (school && !used.email && !/parent|guardian|family|home|contact/.test(header)) return { field: 'email' };
      if (!used.parentEmail) return { field: 'parentEmail' };
      if (!used.parentEmail2) return { field: 'parentEmail2' };
      return { field: '' };
    }
    if (
      all(function (v) {
        return v.split(/[\s,;]+/).every(_rosterEmailOk);
      })
    )
      return { field: used.parentEmail ? (used.parentEmail2 ? '' : 'parentEmail2') : 'parentEmail' };
    if (
      all(function (v) {
        return /^[A-Z]{0,4}-?\d{3,10}$/i.test(v);
      })
    ) {
      var seen = {};
      values.forEach(function (v) {
        seen[v.toLowerCase()] = true;
      });
      if (Object.keys(seen).length >= values.length * 0.75 && !used.studentNumber) return { field: 'studentNumber' };
    }
    if (
      !used.dateOfBirth &&
      all(function (v) {
        return /\d{4}|\d{1,2}[/.-]\d{1,2}[/.-]\d{2}/.test(v) && /^[\w ,./-]+$/.test(v) && v.length <= 20;
      })
    )
      return { field: 'dateOfBirth' };
    if (
      all(function (v) {
        return _rosterCodes(v).every(_rosterIsCode);
      })
    )
      return { field: '', suggest: 'designations' };
    if (
      !used.pronouns &&
      all(function (v) {
        return /^(she|he|they|ze|xe|any)\s*\/\s*\w+$/i.test(v);
      })
    )
      return { field: 'pronouns' };
    if (
      !used.firstName &&
      !used.lastName &&
      !used.fullName &&
      all(function (v) {
        return /[a-z]/i.test(v) && !/[@\d]/.test(v) && v.length <= 60;
      }) &&
      values.filter(function (v) {
        return /,/.test(v) || /\s/.test(v);
      }).length >=
        values.length * 0.8
    )
      return { field: 'fullName' };
    return { field: '' };
  }

  /* The file as { headers, body, map, how, suggest, dateOrder, myEd }.
     map[i] is the field column i fills; how[i] is 'header' (its header is
     a known name), 'guess' (read from its values), 'order' (the old fixed
     order, no headers) or 'chosen' (the teacher chose it); suggest[i] is a
     field offered but not chosen; dateOrder[i] is a date column's order. */
  function rosterImportTable(text) {
    var rows = parseRosterCsv(text);
    var table = { headers: [], body: [], map: [], how: [], suggest: [], dateOrder: [], myEd: false };
    if (!rows.length) return table;
    var map = rows[0].map(rosterFieldFor);
    var known = map.some(Boolean);
    if (!known) {
      var width = Math.max.apply(
        null,
        rows.map(function (r) {
          return r.length;
        }),
      );
      // Headers FullVision doesn't know (words over columns of numbers,
      // dates or addresses): guess every column from its values.
      var wordsOnly = function (v) {
        return !v || (/[a-z]/i.test(v) && v.indexOf('@') < 0);
      };
      var looksLikeHeader =
        rows.length > 1 &&
        rows[0].every(wordsOnly) &&
        rows.slice(1).some(function (r) {
          return r.some(function (v, i) {
            return rows[0][i] && /[@\d]/.test(v);
          });
        });
      if (looksLikeHeader) {
        table.headers = rows[0];
        table.body = rows.slice(1);
      } else {
        var order =
          width >= 4
            ? ['firstName', 'lastName', 'preferred', 'pronouns', 'studentNumber', 'dateOfBirth', 'email']
            : ['fullName', 'preferred', 'pronouns'];
        table.headers = order.slice(0, width).map(function () {
          return '';
        });
        table.body = rows;
        table.map = order.slice(0, width);
        table.how = table.map.map(function () {
          return 'order';
        });
        table.suggest = table.map.map(function () {
          return '';
        });
        table.dateOrder = table.map.map(function (f, i) {
          return f === 'dateOfBirth' ? rosterDateOrder(_rosterColumn(table, i)) : '';
        });
        return table;
      }
    } else {
      table.headers = rows[0];
      table.body = rows.slice(1);
    }
    var used = {};
    table.map = table.headers.map(function (h) {
      return rosterFieldFor(h);
    });
    table.map.forEach(function (f) {
      if (f) used[f] = true;
    });
    if (used.firstName || used.lastName) used.fullName = true;
    table.how = table.map.map(function (f) {
      return f ? 'header' : '';
    });
    table.suggest = table.map.map(function () {
      return '';
    });
    table.headers.forEach(function (h, i) {
      if (table.map[i] || ROSTER_SKIPPED_HEADERS.indexOf(_rosterHeaderKey(h)) >= 0) return;
      var g = _rosterGuess(_rosterColumn(table, i), used, _rosterHeaderKey(h));
      if (g.field) {
        table.map[i] = g.field;
        table.how[i] = 'guess';
        used[g.field] = true;
        if (g.field === 'fullName') used.firstName = used.lastName = true;
      } else if (g.suggest) {
        // One code in every row is a column of something else (a block).
        var vals = _rosterColumn(table, i);
        var same = vals.every(function (v) {
          return v === vals[0];
        });
        if (!(same && vals.length === table.body.length && vals.length > 1)) table.suggest[i] = g.suggest;
      }
    });
    table.dateOrder = table.map.map(function (f, i) {
      return f === 'dateOfBirth' ? rosterDateOrder(_rosterColumn(table, i)) : '';
    });
    table.myEd = table.headers.some(function (h) {
      return ROSTER_MYED_HEADERS.indexOf(_rosterHeaderKey(h)) >= 0;
    });
    return table;
  }

  /* Column i's filled-in cells. */
  function _rosterColumn(table, i) {
    return table.body
      .map(function (r) {
        return (r[i] || '').trim();
      })
      .filter(Boolean);
  }

  /* Every column read by its header (or one FullVision leaves out on
     purpose), a name among them, and no date order to ask about: the file
     goes straight to Ready to Add with nothing to match. */
  function rosterImportReady(table) {
    if (!table || !table.headers.some(Boolean)) return false;
    var named = false;
    var ok = table.headers.every(function (h, i) {
      var f = table.map[i];
      if (f === 'firstName' || f === 'lastName' || f === 'fullName') named = true;
      if (table.dateOrder[i] === 'ask') return false;
      if (table.suggest[i]) return false;
      if (f) return table.how[i] === 'header';
      return !h || ROSTER_SKIPPED_HEADERS.indexOf(_rosterHeaderKey(h)) >= 0 || !_rosterColumn(table, i).length;
    });
    return ok && named;
  }

  function _rosterSplitName(v) {
    if (v.indexOf(',') >= 0) {
      var parts = v.split(',');
      return { first: parts.slice(1).join(',').trim(), last: parts[0].trim() };
    }
    var words = v.split(/\s+/);
    return { first: words[0] || '', last: words.slice(1).join(' ') };
  }

  /* The table's rows as students, and what needs a look. `fixes` holds what
     the teacher typed for a row: { line: { dateOfBirth, studentNumber,
     name } }. Returns
       rows      students, each with .line (its row in the file)
       problems  [{ kind, line, field, value, otherLine }] kinds: 'date' (left
                 blank), 'number' (the same number as an earlier row: left
                 blank), 'email' and 'code' (left out)
       unnamed   [{ line, cells }] rows with no name, left out
       waiting   { column: count } number dates waiting for the column's
                 order to be chosen
       skipped   { dates, emails, codes } counts, as before.
     A blank cell never clears anything; codes that aren't BC designations
     are left out. */
  function rosterRowsFromTable(table, fixes) {
    fixes = fixes || {};
    var out = [];
    var problems = [];
    var unnamed = [];
    var waiting = {};
    var skipped = { dates: 0, emails: 0, codes: 0 };
    var named = !table.headers.length || table.headers.some(Boolean);
    var addCode = function (p, code) {
      p.designations = p.designations || [];
      if (p.designations.indexOf(code) < 0) p.designations.push(code);
    };
    table.body.forEach(function (r, idx) {
      var line = r.line || idx + (named ? 2 : 1);
      var fix = fixes[line] || {};
      var p = { parentEmails: [] };
      Object.defineProperty(p, 'line', { value: line, enumerable: false, writable: true });
      table.map.forEach(function (field, i) {
        var v = (r[i] || '').trim();
        if (field === 'dateOfBirth' && fix.dateOfBirth) v = fix.dateOfBirth;
        if (field === 'studentNumber' && fix.studentNumber) v = fix.studentNumber;
        if (!field || !v) return;
        if (field === 'fullName') {
          var nm = _rosterSplitName(v);
          if (!p.firstName) p.firstName = nm.first;
          if (!p.lastName) p.lastName = nm.last;
        } else if (field === 'dateOfBirth') {
          var order = fix.dateOfBirth ? '' : table.dateOrder[i];
          if (order === 'ask' && _ROSTER_NUM_DATE.test(v) && !_rosterDate(v)) {
            waiting[i] = (waiting[i] || 0) + 1;
            return;
          }
          var d = _rosterDate(v, order);
          if (d) p.dateOfBirth = d;
          else {
            skipped.dates++;
            problems.push({ kind: 'date', line: line, field: 'dateOfBirth', value: v, p: p });
          }
        } else if (field === 'email') {
          if (_rosterEmailOk(v)) p.email = v;
          else {
            skipped.emails++;
            problems.push({ kind: 'email', line: line, value: v, p: p });
          }
        } else if (field === 'parentEmail' || field === 'parentEmail2') {
          v.split(/[;,\s]+/)
            .filter(Boolean)
            .forEach(function (e) {
              if (!_rosterEmailOk(e)) {
                skipped.emails++;
                problems.push({ kind: 'email', line: line, value: e, p: p });
              } else if (p.parentEmails.indexOf(e) < 0) p.parentEmails.push(e);
            });
        } else if (field === 'designations') {
          _rosterCodes(v).forEach(function (code) {
            if (_rosterIsCode(code)) addCode(p, code);
            else {
              skipped.codes++;
              problems.push({ kind: 'code', line: line, value: code, p: p });
            }
          });
        } else if (field === 'ell') {
          if (/^(y|yes|true|1|x|ell|esl)$/i.test(v)) addCode(p, 'ELL');
        } else p[field] = v;
      });
      if (fix.name) {
        var typed = _rosterSplitName(fix.name.trim());
        p.firstName = typed.first;
        p.lastName = typed.last;
      }
      if (p.firstName || p.lastName) out.push(p);
      else
        unnamed.push({
          line: line,
          cells: r.filter(Boolean).slice(0, 4),
        });
    });
    // The same student number twice: the first row keeps it, later ones go
    // in without a number until it's fixed (MyEd has the right one).
    var byNumber = {};
    out.forEach(function (p) {
      var key = String(p.studentNumber || '')
        .trim()
        .toLowerCase();
      if (!key) return;
      if (byNumber[key]) {
        problems.push({
          kind: 'number',
          line: p.line,
          field: 'studentNumber',
          value: p.studentNumber,
          other: byNumber[key],
          p: p,
        });
        delete p.studentNumber;
      } else byNumber[key] = p;
    });
    problems.sort(function (a, b) {
      return a.line - b.line;
    });
    return { rows: out, skipped: skipped, problems: problems, unnamed: unnamed, waiting: waiting };
  }

  return {
    ROSTER_IMPORT_FIELDS: ROSTER_IMPORT_FIELDS,
    ROSTER_FIELD_MENU: ROSTER_FIELD_MENU,
    ROSTER_SKIPPED_HEADERS: ROSTER_SKIPPED_HEADERS,
    _ROSTER_NUM_DATE: _ROSTER_NUM_DATE,
    _rosterHeaderKey: _rosterHeaderKey,
    parseRosterCsv: parseRosterCsv,
    _rosterDate: _rosterDate,
    rosterDateOrder: rosterDateOrder,
    _rosterCodes: _rosterCodes,
    rosterImportTable: rosterImportTable,
    _rosterColumn: _rosterColumn,
    rosterImportReady: rosterImportReady,
    rosterRowsFromTable: rosterRowsFromTable,
  };
})();
if (typeof window !== 'undefined') window.CmRosterFile = CmRosterFile;
