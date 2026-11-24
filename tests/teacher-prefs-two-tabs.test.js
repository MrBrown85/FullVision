/**
 * Teacher preferences on two computers (docs/ROADMAP.md 1.7). A save sends
 * only the preferences that changed, and patch_teacher_preferences merges
 * them into what the server holds (dashboard_prefs key by key, two levels
 * deep: migrations/2026112404_teacher_preferences_patch.sql). So a tab left
 * open since before a change on another computer can only overwrite the key
 * it changed itself. It used to send its whole copy.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'vm';
import { makeFakeSupabase, settle } from './helpers/fake-supabase.js';

// Production loads the outbox next to shared/data.js; so do these tests.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
runInThisContext(readFileSync(resolve(root, 'shared/offline-queue.js'), 'utf-8'), {
  filename: 'shared/offline-queue.js',
});

const CLASS_A = '11111111-1111-4111-8111-111111111111';
const CLASS_B = '22222222-2222-4222-8222-222222222222';

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);

/* The teacher_preference row, and patch_teacher_preferences as the migration
   writes it: a key in the patch sets that column; dashboard_prefs merges each
   key, and one level further where both sides are objects. */
function makeServer(row) {
  const server = { row: JSON.parse(JSON.stringify(row)) };
  server.apply = patch => {
    const r = server.row;
    ['active_course_id', 'view_mode', 'mobile_view_mode', 'mobile_sort_mode'].forEach(k => {
      if (k in patch) r[k] = patch[k] === '' ? null : patch[k];
    });
    if ('card_widget_config' in patch) r.card_widget_config = patch.card_widget_config;
    if ('dashboard_prefs' in patch) {
      const change = patch.dashboard_prefs;
      if (change === null) r.dashboard_prefs = null;
      else {
        const old = isObj(r.dashboard_prefs) ? r.dashboard_prefs : {};
        const next = Object.assign({}, old);
        Object.keys(change).forEach(k => {
          next[k] = isObj(change[k]) && isObj(old[k]) ? Object.assign({}, old[k], change[k]) : change[k];
        });
        r.dashboard_prefs = next;
      }
    }
    return { data: null, error: null };
  };
  return server;
}

/* What bootstrap_teacher gives a tab that opens now (_configFromTeacher). */
function configFrom(row) {
  return JSON.parse(
    JSON.stringify({
      activeCourse: row.active_course_id,
      viewMode: row.view_mode,
      mobileViewMode: row.mobile_view_mode,
      mobileSortMode: row.mobile_sort_mode,
      cardWidgetConfig: row.card_widget_config,
      dashboardPrefs: row.dashboard_prefs,
    }),
  );
}

describe('teacher preferences on two computers', () => {
  let fake, server, original;
  const setOnline = on => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => on });
  const patches = () => fake.calls.filter(c => c.name === 'patch_teacher_preferences').map(c => c.params.p_patch);

  beforeEach(() => {
    original = {
      getSupabase: globalThis.getSupabase,
      useSupabase: _useSupabase,
      isDemoMode: window.isDemoMode,
    };
    localStorage.clear();
    COURSES[CLASS_A] = { id: CLASS_A, name: 'Humanities 8' };
    COURSES[CLASS_B] = { id: CLASS_B, name: 'Science 9' };
    server = makeServer({
      active_course_id: CLASS_A,
      view_mode: 'dashboard',
      mobile_view_mode: 'cards',
      mobile_sort_mode: 'alpha',
      card_widget_config: null,
      dashboard_prefs: {
        studentView: 'cards',
        view: { gb_newestFirst: '1', 'gb-roster-sort-c1': 'lastName' },
        closedModules: { [CLASS_A]: ['m1'] },
      },
    });
    fake = makeFakeSupabase();
    fake.on('patch_teacher_preferences', params => server.apply(params.p_patch));
    globalThis.getSupabase = () => fake;
    _useSupabase = true;
    _supabaseDegraded = false;
    _teacherId = 'teacher-uuid';
    setOnline(true);
    window.v2Queue.clear();
    // This tab opened in the morning, with the server's copy as it was then.
    _cache.config = configFrom(server.row);
    localStorage.setItem('gb-config', JSON.stringify(_cache.config));
  });

  afterEach(() => {
    globalThis.getSupabase = original.getSupabase;
    _useSupabase = original.useSupabase;
    window.isDemoMode = original.isDemoMode;
    setOnline(true);
    window.v2Queue.clear();
    delete COURSES[CLASS_A];
    delete COURSES[CLASS_B];
    _cache.config = null;
    localStorage.clear();
  });

  /* Another computer changes these since this tab opened. */
  function changeOnAnotherComputer() {
    server.apply({
      view_mode: 'classic',
      mobile_sort_mode: 'recent',
      dashboard_prefs: { studentView: 'grid', view: { 'gb-roster-sort-c1': 'firstName' } },
    });
  }

  it("an old tab can't put back a key another computer changed", async () => {
    changeOnAnotherComputer();

    // The old tab, still holding the morning's copy of everything.
    setActiveCourse(CLASS_B);
    saveViewPref('gb_newestFirst', '0');
    saveDashboardPrefs({ helpRule: { below: 3, min: 2 } });
    await window.v2Queue.flush();
    await settle();

    expect(patches()).toEqual([
      { active_course_id: CLASS_B },
      { dashboard_prefs: { view: { gb_newestFirst: '0' } } },
      { dashboard_prefs: { helpRule: { below: 3, min: 2 } } },
    ]);
    expect(server.row).toEqual({
      active_course_id: CLASS_B,
      view_mode: 'classic', // the other computer's
      mobile_view_mode: 'cards',
      mobile_sort_mode: 'recent', // the other computer's
      card_widget_config: null,
      dashboard_prefs: {
        studentView: 'grid', // the other computer's
        view: { gb_newestFirst: '0', 'gb-roster-sort-c1': 'firstName' }, // one each
        closedModules: { [CLASS_A]: ['m1'] },
        helpRule: { below: 3, min: 2 },
      },
    });
  });

  it('the key the old tab did change is the one that changes', async () => {
    changeOnAnotherComputer();

    saveViewPref('gb-roster-sort-c1', 'studentNumber');
    await window.v2Queue.flush();
    await settle();

    expect(server.row.view_mode).toBe('classic');
    expect(server.row.dashboard_prefs.studentView).toBe('grid');
    expect(server.row.dashboard_prefs.view).toEqual({ gb_newestFirst: '1', 'gb-roster-sort-c1': 'studentNumber' });
  });

  it('closing a folder on one class sends only that class', async () => {
    const byClass = Object.assign({}, getDashboardPrefs().closedModules);
    byClass[CLASS_B] = ['m7'];
    saveDashboardPrefs({ closedModules: byClass });
    await window.v2Queue.flush();
    await settle();

    expect(patches()).toEqual([{ dashboard_prefs: { closedModules: { [CLASS_B]: ['m7'] } } }]);
  });

  it('a save that changes nothing sends nothing', async () => {
    setActiveCourse(CLASS_A);
    saveConfig(Object.assign({}, getConfig()));
    saveViewPref('gb_newestFirst', '1');
    saveDashboardPrefs({ studentView: 'cards' });
    await window.v2Queue.flush();
    await settle();

    expect(fake.calls).toEqual([]);
  });

  it('a change made offline waits in the outbox, in order, and lands once online', async () => {
    setOnline(false);
    saveConfig(Object.assign({}, getConfig(), { viewMode: 'compact' }));
    saveConfig(Object.assign({}, getConfig(), { viewMode: 'wide' }));
    await settle();

    const queued = window.v2Queue.queued('patch_teacher_preferences');
    expect(queued.map(e => e.payload.p_patch)).toEqual([{ view_mode: 'compact' }, { view_mode: 'wide' }]);
    // One key for every preference save, so they go one at a time, in order.
    const stored = JSON.parse(localStorage.getItem('fv-sync-queue-v1')).entries;
    expect(stored.map(e => e.key)).toEqual(['teacher-preferences', 'teacher-preferences']);
    expect(fake.calls).toEqual([]);

    setOnline(true);
    await window.v2Queue.flush();
    await settle();

    expect(server.row.view_mode).toBe('wide');
    // Each carried its entry's id as the idempotency key.
    const keys = fake.calls.map(c => c.params.p_idempotency_key);
    expect(keys.every(Boolean)).toBe(true);
    expect(new Set(keys).size).toBe(2);
  });

  it('Demo Mode keeps every preference on this computer and sends nothing', async () => {
    window.isDemoMode = () => true;
    localStorage.setItem('gb-demo-mode', '1');

    setActiveCourse(CLASS_B);
    saveViewPref('gb_newestFirst', '0');
    saveDashboardPrefs({ studentView: 'grid' });
    saveCardWidgetConfig({ order: ['hero'], disabled: [] });
    await window.v2Queue.flush();
    await settle();

    expect(fake.calls).toEqual([]);
    expect(window.v2Queue.queued('patch_teacher_preferences')).toEqual([]);
    expect(getConfig().activeCourse).toBe(CLASS_B);
    expect(getViewPref('gb_newestFirst')).toBe('0');
    expect(getDashboardPrefs().studentView).toBe('grid');
    expect(JSON.parse(localStorage.getItem('gb-config')).dashboardPrefs.view.gb_newestFirst).toBe('0');
  });
});
