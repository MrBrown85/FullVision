import './setup-mobile.js';
import { describe, it, expect, beforeEach } from 'vitest';

describe('Card Widget Editor', () => {
  beforeEach(() => {
    localStorage.clear();
    Object.keys(_cache).forEach(function (k) {
      delete _cache[k];
    });
  });

  it('builds editor HTML with all widgets listed', () => {
    var html = MCardWidgetEditor.buildEditorHTML();
    expect(html).toContain('Customize Card');
    WIDGET_REGISTRY.forEach(function (w) {
      expect(html).toContain(w.label);
    });
  });

  it('shows enabled widgets with toggles on', () => {
    var html = MCardWidgetEditor.buildEditorHTML();
    expect(html).toContain('data-widget="hero"');
    expect(html).toMatch(/data-widget="hero"[^>]*data-enabled="true"/);
  });

  it('toggleWidget enables a disabled widget', () => {
    var config = getCardWidgetConfig();
    expect(config.disabled).toContain('narrative');
    MCardWidgetEditor.toggleWidget('narrative');
    config = getCardWidgetConfig();
    expect(config.order).toContain('narrative');
    expect(config.disabled).not.toContain('narrative');
  });

  it('toggleWidget disables an enabled widget', () => {
    var config = getCardWidgetConfig();
    expect(config.order).toContain('sectionBars');
    MCardWidgetEditor.toggleWidget('sectionBars');
    config = getCardWidgetConfig();
    expect(config.order).not.toContain('sectionBars');
    expect(config.disabled).toContain('sectionBars');
  });

  it('moveWidget reorders within enabled list', () => {
    MCardWidgetEditor.moveWidget('obsSnippet', 1);
    var config = getCardWidgetConfig();
    expect(config.order[0]).toBe('hero');
    expect(config.order[1]).toBe('obsSnippet');
    expect(config.order[2]).toBe('toGrade');
    expect(config.order[3]).toBe('sectionBars');
  });

  it('resetToDefaults clears saved config', () => {
    saveCardWidgetConfig({ order: ['hero'], disabled: [] });
    MCardWidgetEditor.resetToDefaults();
    var config = getCardWidgetConfig();
    expect(config.order).toEqual([
      'hero',
      'toGrade',
      'sectionBars',
      'completion',
      'growth',
      'obsSnippet',
      'dispositions',
      'actions',
    ]);
  });

  it('To Grade is listed and turns on and off but has no drag handle', () => {
    var html = MCardWidgetEditor.buildEditorHTML();
    expect(html).toMatch(/data-widget="toGrade" data-enabled="true"><div class="m-wdg-editor-drag-spacer">/);
    MCardWidgetEditor.toggleWidget('toGrade');
    expect(getCardWidgetConfig().disabled).toContain('toGrade');
    expect(getCardWidgetConfig().order).not.toContain('toGrade');
  });
});
