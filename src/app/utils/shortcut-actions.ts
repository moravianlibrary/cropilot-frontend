import { TelemetryAction } from '../stats.types';

export interface ShortcutContext {
  pageSelected: boolean;
  dialogOpen: boolean;
}

const MODIFIER_KEYS = ['Shift', 'Control', 'Meta', 'Alt'];
const ARROWS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
const SCAN_ROTATION: Record<string, TelemetryAction> = {
  d: 'rotate_scan_270',
  f: 'rotate_scan_0',
  g: 'rotate_scan_90',
  h: 'rotate_scan_180'
};
const FILTER_KEYS: Record<string, TelemetryAction> = {
  F1: 'filter_all',
  F2: 'filter_flagged',
  F3: 'filter_edited',
  F4: 'filter_ok'
};

// Maps a keydown handled by EditorService.onKeyDown to a stable action name for
// telemetry. Mirrors the branches of onKeyDown; returns null for anything that
// should not be recorded (modifier-only presses, key repeat, dialog-only keys).
export function shortcutAction(e: KeyboardEvent, ctx: ShortcutContext): TelemetryAction | null {
  if (e.repeat) return null;
  if (MODIFIER_KEYS.includes(e.key)) return null;

  const mod = e.ctrlKey || e.metaKey;
  const key = e.key;
  const k = key.toLowerCase();

  // Shortcuts that also work while a dialog is open
  if (mod && key === 'Enter') return ctx.dialogOpen ? null : 'save';
  if (k === 'k') return 'shortcuts_dialog';
  if (ctx.dialogOpen) return null;

  if (mod && k === 'r') return e.shiftKey ? 'reset_title_dialog' : 'reset_scan_dialog';
  if (mod && k === 'c') return 'copy';

  if ((e.altKey || e.metaKey) && ['+', '1'].includes(key)) return 'filter_single';
  if ((e.altKey || e.metaKey) && ['ě', 'Ě', '2'].includes(key)) return 'filter_double';
  if (['+', '1'].includes(key)) return 'select_page_left';
  if (['ě', 'Ě', '2'].includes(key)) return 'select_page_right';

  if (key === 'Escape') return ctx.pageSelected ? 'unselect_page' : null;
  if (key === 'Backspace' || key === 'Delete') return ctx.pageSelected ? 'remove_page' : null;
  if (k === 'p') return 'add_page';
  if (k === 'j') return 'toggle_predictions';
  if (k === 'm') return 'toggle_grid';
  if (k === 'o') return 'cycle_outline';
  if (k === 'c') return 'cycle_dim';

  if (ARROWS.includes(key)) {
    if (ctx.pageSelected) return e.shiftKey ? 'resize_page' : 'move_page';
    return key === 'ArrowLeft' || key === 'ArrowUp' ? 'nav_prev' : 'nav_next';
  }
  if (key === 'PageUp') return 'nav_prev';
  if (key === 'PageDown') return 'nav_next';
  if (key === 'Home') return 'nav_first';
  if (key === 'End') return 'nav_last';

  if (k === 'a' || k === 's') return ctx.pageSelected ? 'rotate_page' : null;
  if (SCAN_ROTATION[k]) return SCAN_ROTATION[k];

  if (k === 'q') return 'zoom_in';
  if (k === 'w') return 'zoom_out';
  if (k === 'e') return 'zoom_fit_pages';
  if (k === 'r') return 'zoom_reset';

  if (key === 'Enter' || k === 'b') return ctx.pageSelected ? 'cycle_page' : 'nav_next';
  if (key === 'Tab') return ctx.pageSelected ? 'cycle_page' : null;
  if (FILTER_KEYS[key]) return FILTER_KEYS[key];

  return null;
}
