/**
 * v2 ReportConfig + TeacherPreference + teacher-lifecycle dispatch tests
 * shared/data.js (Phase 4.8)
 *
 * Covers window.v2 helpers:
 *   applyReportPreset       → apply_report_preset
 *   saveReportConfig        → save_report_config (nulls preset when omitted)
 *   toggleReportBlock       → toggle_report_block (boolean coerce)
 *   saveTeacherPreferences  → save_teacher_preferences (jsonb patch)
 *   softDeleteTeacher       → soft_delete_teacher
 *   restoreTeacher          → restore_teacher
 *   importRosterCsv         → import_roster_csv (v2-namespace alias)
 *   importTeamsClass        → import_teams_class
 *   importJsonRestore       → import_json_restore
 */
import './setup.js';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';

const CID = '11111111-1111-1111-1111-111111111111';

function makeRecordingClient() {
  var calls = [];
  return {
    calls: calls,
    rpc(name, payload) {
      calls.push({ name: name, payload: payload || {} });
      return Promise.resolve({ data: null, error: null });
    },
  };
}

describe('v2 report-config / preferences / teacher-lifecycle dispatch', () => {
  var originalGetSupabase;
  var originalUseSupabase;
  var client;

  beforeEach(() => {
    originalGetSupabase = getSupabase;
    originalUseSupabase = _useSupabase;
    _useSupabase = true;
    client = makeRecordingClient();
    globalThis.getSupabase = () => client;
  });

  afterEach(() => {
    globalThis.getSupabase = originalGetSupabase;
    _useSupabase = originalUseSupabase;
  });

  describe('ReportConfig', () => {
    it('applyReportPreset calls apply_report_preset', async () => {
      await window.v2.applyReportPreset(CID, 'standard');
      expect(client.calls[0]).toEqual({
        name: 'apply_report_preset',
        payload: { p_course_id: CID, p_preset: 'standard' },
      });
    });

    it('saveReportConfig defaults preset to null (server→custom)', async () => {
      await window.v2.saveReportConfig(CID, { headerBlock: true });
      expect(client.calls[0]).toEqual({
        name: 'save_report_config',
        payload: { p_course_id: CID, p_blocks_config: { headerBlock: true }, p_preset: null },
      });
    });

    it('saveReportConfig passes explicit preset through', async () => {
      await window.v2.saveReportConfig(CID, {}, 'custom');
      expect(client.calls[0].payload.p_preset).toBe('custom');
    });

    it('toggleReportBlock coerces enabled to boolean', async () => {
      await window.v2.toggleReportBlock(CID, 'strengths', 1);
      expect(client.calls[0]).toEqual({
        name: 'toggle_report_block',
        payload: { p_course_id: CID, p_block_key: 'strengths', p_enabled: true },
      });
    });
  });

  describe('TeacherPreferences', () => {
    it('passes jsonb patch to save_teacher_preferences', async () => {
      await window.v2.saveTeacherPreferences({ view_mode: 'classic', active_course_id: CID });
      expect(client.calls[0]).toEqual({
        name: 'save_teacher_preferences',
        payload: { p_patch: { view_mode: 'classic', active_course_id: CID } },
      });
    });

    it('coerces null/undefined patch to empty object', async () => {
      await window.v2.saveTeacherPreferences();
      expect(client.calls[0].payload.p_patch).toEqual({});
    });
  });

  describe('teacher-lifecycle', () => {
    it('softDeleteTeacher calls soft_delete_teacher with no params', async () => {
      await window.v2.softDeleteTeacher();
      expect(client.calls[0]).toEqual({ name: 'soft_delete_teacher', payload: {} });
    });

    it('restoreTeacher calls restore_teacher with no params', async () => {
      await window.v2.restoreTeacher();
      expect(client.calls[0]).toEqual({ name: 'restore_teacher', payload: {} });
    });
  });

  describe('imports (Phase 4.9 surface)', () => {
    it('v2.importRosterCsv calls import_roster_csv', async () => {
      await window.v2.importRosterCsv(CID, [{ first_name: 'A' }]);
      expect(client.calls[0]).toEqual({
        name: 'import_roster_csv',
        payload: { p_course_id: CID, p_rows: [{ first_name: 'A' }] },
      });
    });

    it('v2.importTeamsClass wraps payload in p_payload', async () => {
      var pl = { class_name: 'Science 8', students: [] };
      await window.v2.importTeamsClass(pl);
      expect(client.calls[0]).toEqual({
        name: 'import_teams_class',
        payload: { p_payload: pl },
      });
    });

    it('v2.importJsonRestore wraps payload in p_payload', async () => {
      var pl = { courses: [{ id: CID }] };
      await window.v2.importJsonRestore(pl);
      expect(client.calls[0]).toEqual({
        name: 'import_json_restore',
        payload: { p_payload: pl },
      });
    });

    it('imports default to empty payload / rows when missing', async () => {
      await window.v2.importRosterCsv(CID);
      await window.v2.importTeamsClass();
      await window.v2.importJsonRestore();
      expect(client.calls[0].payload.p_rows).toEqual([]);
      expect(client.calls[1].payload.p_payload).toEqual({});
      expect(client.calls[2].payload.p_payload).toEqual({});
    });
  });
});
