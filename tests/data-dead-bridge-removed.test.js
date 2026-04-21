/**
 * Regression guard — the legacy Supabase bridge helpers (_doSync,
 * _syncToSupabase, _initRealtimeSync, _handleCrossTabChange,
 * _refreshFromSupabase, _deleteFromSupabase) were removed in Phase 6.1 of
 * the reconciliation plan (2026-04-20). They all short-circuited against
 * dropped legacy public-schema tables; writes now route through the v2
 * RPC dispatch + window.v2Queue instead.
 *
 * This test fails the moment any of those helpers gets re-introduced —
 * preventing a regression to the pre-v2 bridge pattern.
 */
import './setup.js';
import { describe, expect, it } from 'vitest';

describe('legacy Supabase bridge helpers are gone (Phase 6.1)', () => {
  it('_doSync is undefined', () => {
    expect(typeof globalThis._doSync).toBe('undefined');
  });

  it('_syncToSupabase is undefined', () => {
    expect(typeof globalThis._syncToSupabase).toBe('undefined');
  });

  it('_initRealtimeSync is undefined', () => {
    expect(typeof globalThis._initRealtimeSync).toBe('undefined');
  });

  it('_handleCrossTabChange is undefined', () => {
    expect(typeof globalThis._handleCrossTabChange).toBe('undefined');
  });

  it('_refreshFromSupabase is undefined', () => {
    expect(typeof globalThis._refreshFromSupabase).toBe('undefined');
  });

  it('_deleteFromSupabase is undefined', () => {
    expect(typeof globalThis._deleteFromSupabase).toBe('undefined');
  });

  it('window.refreshFromSupabase is not re-exported', () => {
    expect(typeof window.refreshFromSupabase).toBe('undefined');
  });
});
