/**
 * v2 student-profile + student-records dispatch tests — shared/data.js (Phase 4.6)
 *
 * Covers window.v2 helpers:
 *   getStudentProfile     → get_student_profile
 *   addNote / deleteNote  → upsert_note / delete_note
 *   saveGoal              → upsert_goal
 *   saveReflection        → upsert_reflection
 *   saveSectionOverride   → upsert_section_override
 *   clearSectionOverride  → clear_section_override
 *   bulkAttendance        → bulk_attendance
 */
import './setup.js';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';

const ENR1 = '11111111-1111-1111-1111-111111111111';
const ENR2 = '22222222-2222-2222-2222-222222222222';
const SEC = '33333333-3333-3333-3333-333333333333';
const NOTE_ID = '44444444-4444-4444-4444-444444444444';

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

describe('v2 student-profile / student-records dispatch', () => {
  var originalGetSupabase;
  var originalUseSupabase;
  var client;

  beforeEach(() => {
    originalGetSupabase = getSupabase;
    originalUseSupabase = _useSupabase;
    _useSupabase = true;
    localStorage.clear();
    client = makeRecordingClient();
    globalThis.getSupabase = () => client;
  });

  afterEach(() => {
    globalThis.getSupabase = originalGetSupabase;
    _useSupabase = originalUseSupabase;
  });

  describe('getStudentProfile', () => {
    it('calls get_student_profile with enrollment id', async () => {
      await window.v2.getStudentProfile(ENR1);
      expect(client.calls[0]).toEqual({ name: 'get_student_profile', payload: { p_enrollment_id: ENR1 } });
    });
  });

  describe('notes', () => {
    it('addNote calls upsert_note with enrollment_id + body', async () => {
      await window.v2.addNote(ENR1, 'Helpful note');
      expect(client.calls[0]).toEqual({
        name: 'upsert_note',
        payload: { p_enrollment_id: ENR1, p_body: 'Helpful note' },
      });
    });

    it('addNote coerces missing body to empty string', async () => {
      await window.v2.addNote(ENR1);
      expect(client.calls[0].payload.p_body).toBe('');
    });

    it('deleteNote calls delete_note', async () => {
      await window.v2.deleteNote(NOTE_ID);
      expect(client.calls[0]).toEqual({ name: 'delete_note', payload: { p_id: NOTE_ID } });
    });
  });

  describe('saveGoal', () => {
    it('calls upsert_goal with enrollment_id + section_id + body', async () => {
      await window.v2.saveGoal(ENR1, SEC, 'Ask better questions');
      expect(client.calls[0]).toEqual({
        name: 'upsert_goal',
        payload: { p_enrollment_id: ENR1, p_section_id: SEC, p_body: 'Ask better questions' },
      });
    });
  });

  describe('saveReflection', () => {
    it('calls upsert_reflection with body + confidence as Number', async () => {
      await window.v2.saveReflection(ENR1, SEC, 'I got this', 4);
      expect(client.calls[0]).toEqual({
        name: 'upsert_reflection',
        payload: { p_enrollment_id: ENR1, p_section_id: SEC, p_body: 'I got this', p_confidence: 4 },
      });
    });

    it('passes null confidence when undefined', async () => {
      await window.v2.saveReflection(ENR1, SEC, 'x');
      expect(client.calls[0].payload.p_confidence).toBeNull();
    });

    it('coerces string confidence to Number', async () => {
      await window.v2.saveReflection(ENR1, SEC, 'x', '3');
      expect(client.calls[0].payload.p_confidence).toBe(3);
    });
  });

  describe('section overrides', () => {
    it('saveSectionOverride calls upsert_section_override with numeric level + reason', async () => {
      await window.v2.saveSectionOverride(ENR1, SEC, 4, 'Conference evidence');
      expect(client.calls[0]).toEqual({
        name: 'upsert_section_override',
        payload: { p_enrollment_id: ENR1, p_section_id: SEC, p_level: 4, p_reason: 'Conference evidence' },
      });
    });

    it('saveSectionOverride nulls empty reason', async () => {
      await window.v2.saveSectionOverride(ENR1, SEC, 3, '');
      expect(client.calls[0].payload.p_reason).toBeNull();
    });

    it('clearSectionOverride calls clear_section_override', async () => {
      await window.v2.clearSectionOverride(ENR1, SEC);
      expect(client.calls[0]).toEqual({
        name: 'clear_section_override',
        payload: { p_enrollment_id: ENR1, p_section_id: SEC },
      });
    });
  });

  describe('bulkAttendance', () => {
    it('calls bulk_attendance with filtered UUIDs + date + status', async () => {
      await window.v2.bulkAttendance([ENR1, 'junk', ENR2], '2026-04-20', 'Absent');
      expect(client.calls[0]).toEqual({
        name: 'bulk_attendance',
        payload: { p_enrollment_ids: [ENR1, ENR2], p_date: '2026-04-20', p_status: 'Absent' },
      });
    });

    it('coerces missing status to empty string', async () => {
      await window.v2.bulkAttendance([ENR1], '2026-04-20');
      expect(client.calls[0].payload.p_status).toBe('');
    });
  });
});
