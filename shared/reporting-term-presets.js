/* shared/reporting-term-presets.js — Surrey secondary schools' reporting
   periods, offered as one-click presets in Class Management
   (docs/DECISIONS.md, "Reporting periods"). Grandview Heights is the default.

   Every date comes from the school's published calendar on surreyschools.ca
   (read 2026-10-17) or the district's 2026-27 calendar. The rule for turning
   report dates into terms, for a semester school:

     Term 1  first day of school → the day the Term 1 report is published
     Term 2  the next day → the last day of Semester 1 (completion days included)
     Term 3  the first day of Semester 2 → the day the Term 3 report is published
     Term 4  the next day → the last student day, or the final report date

   Where a school has not published its semester turnaround, the district-wide
   Monday, Feb 1, 2027 is used and `assumed` says so. Terms are consecutive:
   Term 3 starts the day after Term 2 ends, so the weekend before Semester 2
   belongs to Term 3 and no date falls outside every term. Schools with no
   published report dates are not listed; a teacher there picks a generic
   preset or types dates.

   To refresh for a new school year: each school site serves an iCal feed of
   its "Report Cards" category at
   https://www.surreyschools.ca/<site>/_ci/calendar/subscription/YWzv
   and the whole calendar at the same path with the all-categories id.

   `report` names the report that closes a term, in the school's own words
   and month ("Nov report card", "Apr learning update"). The Term
   Questionnaire's report picker shows it when a class uses that school's
   terms. A term with no published report has none. */

var REPORTING_TERM_PRESETS = {
  schoolYear: '2026-2027',
  firstDay: '2026-09-08', // District calendar: "Sept. 8, 2026 Schools open"
  lastDay: '2027-06-24', // District calendar: "June 25, 2027 Administrative day/schools close"
  defaultSchool: 'grandviewheights',
  schools: [
    {
      id: 'grandviewheights',
      name: 'Grandview Heights Secondary',
      terms: [
        { label: 'Term 1', starts_on: '2026-09-08', ends_on: '2026-11-27', report: 'Nov Report Card' },
        { label: 'Term 2', starts_on: '2026-11-28', ends_on: '2027-01-26', report: 'Feb Report Card' },
        { label: 'Term 3', starts_on: '2027-01-27', ends_on: '2027-04-23', report: 'Apr Report Card' },
        { label: 'Term 4', starts_on: '2027-04-24', ends_on: '2027-06-24', report: 'Jun Report Card' },
      ],
      notes: 'Report cards Nov 27, Feb 5, Apr 23, Jun 24. Semester completion Jan 25-26; Semester 2 begins Jan 27.',
    },
    {
      id: 'earlmarriott',
      name: 'Earl Marriott Secondary',
      terms: [
        { label: 'Term 1', starts_on: '2026-09-08', ends_on: '2026-11-19', report: 'Nov Learning Update' },
        { label: 'Term 2', starts_on: '2026-11-20', ends_on: '2027-01-29' },
        { label: 'Term 3', starts_on: '2027-01-30', ends_on: '2027-04-22', report: 'Apr Learning Update' },
        { label: 'Term 4', starts_on: '2027-04-23', ends_on: '2027-06-24', report: 'Jun Learning Update' },
      ],
      notes:
        'Learning updates Nov 19, Apr 22, Jun 24. Last day of Semester 1 classes Jan 27, completion Jan 28-29, Semester 2 begins Feb 1.',
    },
    {
      id: 'envercreek',
      name: 'Enver Creek Secondary',
      terms: [
        { label: 'Term 1', starts_on: '2026-09-08', ends_on: '2026-11-18', report: 'Nov Mid-Term Marks' },
        { label: 'Term 2', starts_on: '2026-11-19', ends_on: '2027-01-29', report: 'Feb Semester 1 Final Marks' },
        { label: 'Term 3', starts_on: '2027-01-30', ends_on: '2027-04-14', report: 'Apr Report Card' },
        { label: 'Term 4', starts_on: '2027-04-15', ends_on: '2027-06-24' },
      ],
      notes:
        'Mid-term marks Nov 18, Semester 1 final marks Feb 3, report cards Apr 14. Completion Jan 28-29, Semester 2 begins Feb 1. No final report date published; the district last day is used.',
    },
    {
      id: 'frankhurt',
      name: 'Frank Hurt Secondary',
      assumed: 'semester turnaround',
      terms: [
        { label: 'Term 1', starts_on: '2026-09-08', ends_on: '2026-11-19', report: 'Nov Report Card' },
        { label: 'Term 2', starts_on: '2026-11-20', ends_on: '2027-01-29', report: 'Feb Report Card' },
        { label: 'Term 3', starts_on: '2027-01-30', ends_on: '2027-04-29', report: 'Apr Report Card' },
        { label: 'Term 4', starts_on: '2027-04-30', ends_on: '2027-06-25', report: 'Jun Report Card' },
      ],
      notes: 'Report cards Nov 19, Feb 4, Apr 29, Jun 25. Semester turnaround not published; Feb 1 assumed.',
    },
    {
      id: 'fraserheights',
      name: 'Fraser Heights Secondary',
      terms: [
        { label: 'Term 1', starts_on: '2026-09-08', ends_on: '2026-11-23', report: 'Nov Learning Update' },
        { label: 'Term 2', starts_on: '2026-11-24', ends_on: '2027-01-29', report: 'Feb Learning Update' },
        { label: 'Term 3', starts_on: '2027-01-30', ends_on: '2027-04-26', report: 'Apr Learning Update' },
        { label: 'Term 4', starts_on: '2027-04-27', ends_on: '2027-06-25', report: 'Jun Learning Update' },
      ],
      notes: 'Learning updates posted Nov 23, Feb 8, Apr 26, Jun 25. Start of Semester 2 Feb 1.',
    },
    {
      id: 'guildfordpark',
      name: 'Guildford Park Secondary',
      assumed: 'semester turnaround',
      terms: [
        { label: 'Term 1', starts_on: '2026-09-08', ends_on: '2026-11-06', report: 'Nov Report Card' },
        { label: 'Term 2', starts_on: '2026-11-07', ends_on: '2027-01-29', report: 'Feb Report Card' },
        { label: 'Term 3', starts_on: '2027-01-30', ends_on: '2027-04-16', report: 'Apr Report Card' },
        { label: 'Term 4', starts_on: '2027-04-17', ends_on: '2027-06-25', report: 'Jun Report Card' },
      ],
      notes: 'Report cards Nov 6, Feb 4, Apr 16, Jun 25. Semester turnaround not published; Feb 1 assumed.',
    },
    {
      id: 'panoramaridge',
      name: 'Panorama Ridge Secondary',
      assumed: 'semester turnaround',
      terms: [
        { label: 'Term 1', starts_on: '2026-09-08', ends_on: '2026-11-20', report: 'Nov Semester 1 Mid-Term Report' },
        { label: 'Term 2', starts_on: '2026-11-21', ends_on: '2027-01-29', report: 'Feb Semester 1 Report' },
        { label: 'Term 3', starts_on: '2027-01-30', ends_on: '2027-04-23', report: 'Apr Semester 2 Mid-Term Report' },
        { label: 'Term 4', starts_on: '2027-04-24', ends_on: '2027-06-25', report: 'Jun Final Report' },
      ],
      notes:
        'Semester 1 mid-term report Nov 20, Semester 1 report Feb 8, Semester 2 mid-term Apr 23, final Jun 25. Semester turnaround not published; Feb 1 assumed.',
    },
    {
      id: 'salish',
      name: 'Salish Secondary',
      terms: [
        { label: 'Term 1', starts_on: '2026-09-08', ends_on: '2026-11-17', report: 'Nov Learning Update' },
        { label: 'Term 2', starts_on: '2026-11-18', ends_on: '2027-01-29', report: 'Feb Learning Update' },
        { label: 'Term 3', starts_on: '2027-01-30', ends_on: '2027-04-20', report: 'Apr Learning Update' },
        { label: 'Term 4', starts_on: '2027-04-21', ends_on: '2027-06-25', report: 'Jun Semester 2 Summary' },
      ],
      notes:
        'Learning updates Nov 17, Feb 5, Apr 20; Semester 2 summary Jun 25. Last day of Semester 1 Jan 27, completion Jan 28-29, Semester 2 starts Feb 1.',
    },
    {
      id: 'sullivanheights',
      name: 'Sullivan Heights Secondary',
      assumed: 'semester turnaround',
      terms: [
        { label: 'Term 1', starts_on: '2026-09-08', ends_on: '2026-11-18', report: 'Nov Learning Update' },
        { label: 'Term 2', starts_on: '2026-11-19', ends_on: '2027-01-29', report: 'Feb Learning Update' },
        { label: 'Term 3', starts_on: '2027-01-30', ends_on: '2027-04-23', report: 'Apr Learning Update' },
        { label: 'Term 4', starts_on: '2027-04-24', ends_on: '2027-06-24', report: 'Jun Learning Update' },
      ],
      notes: 'Learning updates Nov 18, Feb 3, Apr 23, Jun 24. Semester turnaround not published; Feb 1 assumed.',
    },
  ],
};

/** The school year a date falls in, as 'YYYY-YYYY'. August and later start a new year. */
function reportingSchoolYear(date) {
  var d = String(date || '');
  var y = parseInt(d.slice(0, 4), 10);
  var m = parseInt(d.slice(5, 7), 10);
  if (!y || !m) return null;
  var start = m >= 8 ? y : y - 1;
  return start + '-' + (start + 1);
}

/** The schools with published presets for the preset school year, default first. */
function reportingTermSchools() {
  var def = REPORTING_TERM_PRESETS.defaultSchool;
  return REPORTING_TERM_PRESETS.schools
    .slice()
    .sort(function (a, b) {
      if (a.id === def) return -1;
      if (b.id === def) return 1;
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    })
    .map(function (s) {
      return { id: s.id, name: s.name, assumed: s.assumed || null, notes: s.notes || '' };
    });
}

/** A school's terms as editor rows (ordinals 1..n), or null when the school
 * is unknown or the presets are for a different school year than `date`
 * (default today) falls in. */
function reportingTermPreset(schoolId, date) {
  var year = reportingSchoolYear(date || new Date().toISOString().slice(0, 10));
  if (year && year !== REPORTING_TERM_PRESETS.schoolYear) return null;
  var school = REPORTING_TERM_PRESETS.schools.find(function (s) {
    return s.id === (schoolId || REPORTING_TERM_PRESETS.defaultSchool);
  });
  if (!school) return null;
  return school.terms.map(function (t, i) {
    return { ordinal: i + 1, label: t.label, starts_on: t.starts_on, ends_on: t.ends_on };
  });
}

/** The school whose preset a class's terms come from: every term matches the
 * school's term with the same number (Term 3 is the school's third term), so
 * a semester class carrying only Terms 3 and 4 still matches. Null when the
 * terms match no school. */
function reportingTermsSchoolMatch(terms) {
  if (!Array.isArray(terms) || !terms.length) return null;
  var school = REPORTING_TERM_PRESETS.schools.find(function (s) {
    return terms.every(function (t) {
      var st = s.terms[Number(t.ordinal) - 1];
      return !!st && st.starts_on === t.starts_on && st.ends_on === t.ends_on;
    });
  });
  return school ? { school: school } : null;
}

/** The report name for each of a class's terms when they are a school's
 * preset terms (all of them, or one semester's), else null. Entries are ''
 * for a term with no published report. */
function reportingTermReportNames(terms) {
  var match = reportingTermsSchoolMatch(terms);
  if (!match) return null;
  return terms.map(function (t) {
    return match.school.terms[Number(t.ordinal) - 1].report || '';
  });
}

if (typeof window !== 'undefined') {
  window.REPORTING_TERM_PRESETS = REPORTING_TERM_PRESETS;
  window.reportingSchoolYear = reportingSchoolYear;
  window.reportingTermSchools = reportingTermSchools;
  window.reportingTermPreset = reportingTermPreset;
  window.reportingTermReportNames = reportingTermReportNames;
  window.reportingTermsSchoolMatch = reportingTermsSchoolMatch;
}
