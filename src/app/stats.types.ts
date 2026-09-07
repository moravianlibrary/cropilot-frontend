// ========== TELEMETRY (frontend -> POST /events) ==========
// Contract shared with the backend (app/db/schemas/usage_event.py). Events carry
// no user identity; the backend derives the user from the JWT and only ever
// exposes aggregates per group / model / month.

import { DefaultFitMode, DimColor, GridColorLabel, GridDensityLabel, GridLineWidthLabel, GridMode, OutlineWidthLabel, PageNumberType, ScanType } from './app.types';

// Frontend sends one heartbeat every HEARTBEAT_SECONDS while the editor tab is
// visible; the backend computes session duration as heartbeats * HEARTBEAT_SECONDS.
export const HEARTBEAT_SECONDS = 30;

// One vocabulary for keyboard shortcuts and mouse actions so the backend can
// compute a keyboard-vs-mouse ratio per action.
export type TelemetryAction =
  | 'nav_prev' | 'nav_next' | 'nav_first' | 'nav_last' | 'nav_thumbnail'
  | 'select_page_left' | 'select_page_right' | 'cycle_page' | 'unselect_page'
  | 'add_page' | 'remove_page'
  | 'move_page' | 'resize_page' | 'rotate_page'
  | 'rotate_scan_0' | 'rotate_scan_90' | 'rotate_scan_180' | 'rotate_scan_270'
  | 'zoom_in' | 'zoom_out' | 'zoom_fit_pages' | 'zoom_reset'
  | 'filter_all' | 'filter_flagged' | 'filter_edited' | 'filter_ok'
  | 'filter_single' | 'filter_double'
  | 'save' | 'reset_scan_dialog' | 'reset_title_dialog'
  | 'toggle_grid' | 'cycle_outline' | 'cycle_dim'
  | 'toggle_predictions' | 'shortcuts_dialog' | 'copy';

export type TelemetryVia = 'keyboard' | 'mouse';

// Flat snapshot of all editor settings (values as stored in localStorage).
export interface EditorSettingsSnapshot {
  dimColor: DimColor;
  dimOpacity: number;
  gridMode: GridMode;
  gridDensityLabel: GridDensityLabel;
  gridColorLabel: GridColorLabel;
  gridLineWidthLabel: GridLineWidthLabel;
  outlineWidthLabel: OutlineWidthLabel;
  outlineDashed: boolean;
  defaultFitMode: DefaultFitMode;
  filterScanTypeStart: ScanType;
  filterPageNumberStart: PageNumberType;
  showPredictions: boolean;
}

export type TelemetryEventMap = {
  editor_open: { scans_total: number; scans_flagged: number; can_write: boolean };
  settings_snapshot: EditorSettingsSnapshot;
  editor_heartbeat: { active: boolean };
  editor_close: { duration_ms_visible: number; saves: number };
  shortcut: { action: TelemetryAction; key: string };
  mouse_action: { action: TelemetryAction };
  filter_change: { filter: 'scan_type' | 'page_number'; value: string; via: TelemetryVia };
  save: { scans_edited: number; via: TelemetryVia };
  reset_scan: Record<string, never>;
  reset_title: Record<string, never>;
  predictions_toggled: { enabled: boolean };
};
export type TelemetryEventType = keyof TelemetryEventMap;

export interface TelemetryEvent<T extends TelemetryEventType = TelemetryEventType> {
  type: T;
  client_ts: string;          // ISO 8601
  session_id: string;         // uuid per editor open
  title_id: string | null;
  payload: TelemetryEventMap[T];
}


// ========== STATISTICS (GET /stats/*) ==========
export type StatsGroupBy = 'group' | 'crop_model' | 'rotation_model' | 'month';
export type UsageGroupBy = 'group' | 'month';
export type StatsPreset = 7 | 30 | 90 | 'custom';

export interface StatsQuery {
  from?: string;   // YYYY-MM-DD
  to?: string;     // YYYY-MM-DD (inclusive)
  group_id?: string;
  crop_model?: string;
  rotation_model?: string;
}

export interface StatsEnvelope<T> {
  from: string;
  to: string;
  group_by: string | null;
  items: T[];
}

export interface StatsKeyed {
  key: string;
  key_name: string;
}

export interface StatsOverview {
  from: string;
  to: string;
  titles_by_state: Record<string, number>;
  scans: { total: number; edited: number };
  active_users: number;
  sessions: number;
  editor_time_s: number;
}

export interface ReviewQualityRow extends StatsKeyed {
  n_titles: number;
  mean_edit_ratio: number | null;
  mean_changed_ratio: number | null;
  mean_iou: number | null;
  mean_center_shift: number | null;
  mean_angle_delta: number | null;
  pages_added: number;
  pages_removed: number;
  scans_total: number;
  scans_edited: number;
  orientation_changed: number;
  orientation_change_rate: number | null;
  retrain: number;
  completed: number;
  retrain_rate: number | null;
  median_turnaround_s: number | null;
}

export interface AnomalyFlagStats {
  n: number;
  edited: number;
  edit_rate: number | null;
}

export interface AnomaliesRow extends StatsKeyed {
  scans: number;
  edited: number;
  flagged: number;
  flagged_edited: number;
  unflagged_edited: number;
  precision: number | null;
  recall: number | null;
  flags: Record<string, AnomalyFlagStats>;
}

export interface ActionUsage {
  action: TelemetryAction | string;
  keyboard: number;
  mouse: number;
}

export interface EditorUsageRow extends StatsKeyed {
  sessions: number;
  total_duration_s: number;
  mean_duration_s: number | null;
  saves: number;
  saves_per_session: number | null;
  shortcuts: number;
  mouse_actions: number;
  filter_changes: number;
  keyboard_ratio: number | null;
  actions: ActionUsage[];
  top_shortcuts: { action: TelemetryAction | string; n: number }[];
  filters: Record<string, Record<string, number>>;
}

export interface StatsSettings {
  users_total: number;
  settings: Record<string, Record<string, number>>;
}
