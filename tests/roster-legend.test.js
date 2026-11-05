/**
 * The key under the roster (teacher/ui.js): each proficiency code beside a
 * name and its word, IE as Insufficient Evidence. It shows while the codes
 * do, and the code badges carry the same words as tooltips.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CID = 'f0000000-0000-4000-8000-000000000077';

describe('roster key', () => {
  var el;
  var originalOverall;
  var originalGet;
  var originalStudents;

  beforeEach(() => {
    localStorage.clear();
    el = { hidden: true, innerHTML: '' };
    originalGet = document.getElementById;
    document.getElementById = id => (id === 'gb-roster-legend' ? el : null);
    originalStudents = globalThis.getStudents;
    globalThis.getStudents = function () {
      return [{ id: 'no-scores', firstName: 'Ana', lastName: 'Diaz' }];
    };
    originalOverall = globalThis.getOverallProficiency;
    globalThis.getOverallProficiency = function () {
      return 0;
    };
    COURSES[CID] = { id: CID, name: 'Science 9', gradingSystem: 'proficiency' };
  });

  afterEach(() => {
    setSidebarAnnotator(null);
    document.getElementById = originalGet;
    globalThis.getStudents = originalStudents;
    globalThis.getOverallProficiency = originalOverall;
    delete COURSES[CID];
  });

  it('names every code, IE as Insufficient Evidence', () => {
    _fillRosterLegend(CID);
    expect(el.hidden).toBe(false);
    var text = el.innerHTML.replace(/<[^>]+>/g, '|').replace(/\|+/g, '|');
    expect(text).toBe('|EXT|Extending|PRF|Proficient|DEV|Developing|EMG|Emerging|IE|Insufficient Evidence|');
    expect(el.innerHTML.match(/class="student-row-prof"/g)).toHaveLength(5);
  });

  it('gives the IE badge the same name as its tooltip', () => {
    expect(_sidebarBadgesHtml(CID, 'no-scores')).toContain('title="Insufficient Evidence">IE</span>');
  });

  it('is hidden with no students, in a Letter class, under Show: None, and while a page marks the roster', () => {
    globalThis.getStudents = function () {
      return [];
    };
    _fillRosterLegend(CID);
    expect(el.hidden).toBe(true);
    globalThis.getStudents = function () {
      return [{ id: 'no-scores' }];
    };

    COURSES[CID].gradingSystem = 'letter';
    _fillRosterLegend(CID);
    expect(el.hidden).toBe(true);
    expect(el.innerHTML).toBe('');

    COURSES[CID].gradingSystem = 'proficiency';
    localStorage.setItem('gb-roster-show-' + CID, 'none');
    _fillRosterLegend(CID);
    expect(el.hidden).toBe(true);

    localStorage.removeItem('gb-roster-show-' + CID);
    setSidebarAnnotator(function () {
      return {};
    });
    _fillRosterLegend(CID);
    expect(el.hidden).toBe(true);
  });
});
