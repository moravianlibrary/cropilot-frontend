import { Component, computed, inject, WritableSignal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { catchError, forkJoin, throwError } from 'rxjs';
import { StatisticsService } from '../../services/statistics.service';
import { DashboardService } from '../../services/dashboard.service';
import { UiService } from '../../services/ui.service';
import { SelectComponent } from '../../components/select/select.component';
import { SegmentedControlComponent, SegmentedControlOption, SegmentedControlValue } from '../../components/segmented-control/segmented-control.component';
import { LoaderComponent } from '../../components/loader/loader.component';
import { BarChartComponent, BarDatum } from '../../components/charts/bar-chart/bar-chart.component';
import { StackedBarComponent, StackedSegment } from '../../components/charts/stacked-bar/stacked-bar.component';
import { KpiTileComponent } from '../../components/charts/kpi-tile/kpi-tile.component';
import { defaultFitModeDict, filterPageNumberStartDict, filterScanTypeStartDict, flagMessages, gridModeDict, titleStateDict } from '../../app.config';
import { AnomaliesRow, EditorUsageRow, StatsGroupBy, StatsPreset, UsageGroupBy } from '../../stats.types';
import { fmtDuration, fmtNum, fmtPct } from '../../utils/stats-format';
import { downloadCsv, rowsToCsv } from '../../utils/utils';

interface Kpi {
  label: string;
  value: string;
  hint?: string;
}

// Czech labels for telemetry action names (shared vocabulary with the backend).
const ACTION_LABELS: Record<string, string> = {
  nav_prev: 'Předchozí sken', nav_next: 'Další sken', nav_first: 'První sken', nav_last: 'Poslední sken', nav_thumbnail: 'Klik na náhled',
  select_page_left: 'Výběr levého výřezu', select_page_right: 'Výběr pravého výřezu', cycle_page: 'Přepnutí výřezu', unselect_page: 'Zrušení výběru',
  add_page: 'Přidání výřezu', remove_page: 'Odebrání výřezu',
  move_page: 'Posun výřezu', resize_page: 'Změna velikosti výřezu', rotate_page: 'Otočení výřezu',
  rotate_scan_0: 'Otočení skenu 0°', rotate_scan_90: 'Otočení skenu 90°', rotate_scan_180: 'Otočení skenu 180°', rotate_scan_270: 'Otočení skenu 270°',
  zoom_in: 'Přiblížení', zoom_out: 'Oddálení', zoom_fit_pages: 'Přizpůsobit výřezům', zoom_reset: 'Přizpůsobit obrazovce',
  filter_all: 'Filtr: vše', filter_flagged: 'Filtr: podezřelé', filter_edited: 'Filtr: upravené', filter_ok: 'Filtr: OK',
  filter_single: 'Filtr: jednostrany', filter_double: 'Filtr: dvoustrany',
  save: 'Uložit vše', reset_scan_dialog: 'Reset skenu', reset_title_dialog: 'Reset dokumentu',
  toggle_grid: 'Mřížka', cycle_outline: 'Obrys', cycle_dim: 'Clona',
  toggle_predictions: 'Zobrazení predikcí', shortcuts_dialog: 'Nápověda zkratek', copy: 'Kopírování'
};

const SETTING_LABELS: Record<string, string> = {
  gridMode: 'Mřížka',
  gridDensityLabel: 'Hustota mřížky',
  gridColorLabel: 'Barva mřížky',
  gridLineWidthLabel: 'Tloušťka mřížky',
  outlineWidthLabel: 'Obrys výřezu',
  outlineDashed: 'Čárkovaný obrys',
  dimColor: 'Clona',
  defaultFitMode: 'Výchozí přiblížení',
  filterScanTypeStart: 'Filtr skenů při otevření',
  filterPageNumberStart: 'Filtr stran při otevření',
  showPredictions: 'Zobrazení predikcí (admin)'
};

const FILTER_LABELS: Record<string, string> = {
  scan_type: 'Filtr typu skenu',
  page_number: 'Filtr počtu stran'
};

@Component({
  selector: 'app-statistics',
  imports: [FormsModule, SelectComponent, SegmentedControlComponent, LoaderComponent, BarChartComponent, StackedBarComponent, KpiTileComponent],
  templateUrl: './statistics.component.html',
  styleUrl: './statistics.component.scss'
})
export class StatisticsComponent {
  stats = inject(StatisticsService);
  private dashboard = inject(DashboardService);
  private ui = inject(UiService);
  private router = inject(Router);

  fmtNum = fmtNum;
  fmtPct = fmtPct;
  fmtDuration = fmtDuration;
  flagMessages = flagMessages;
  titleStateDict = titleStateDict;

  presetOptions: SegmentedControlOption[] = [
    { value: 7, label: '7 dní' },
    { value: 30, label: '30 dní' },
    { value: 90, label: '90 dní' },
    { value: 'custom', label: 'Vlastní' }
  ];
  groupByOptions: SegmentedControlOption[] = [
    { value: 'group', label: 'Skupina' },
    { value: 'crop_model', label: 'Ořezový model' },
    { value: 'rotation_model', label: 'Rotační model' },
    { value: 'month', label: 'Měsíc' }
  ];
  anomaliesGroupByOptions: SegmentedControlOption[] = [{ value: '', label: 'Celkem' }, ...this.groupByOptions];
  usageGroupByOptions: SegmentedControlOption[] = [
    { value: 'group', label: 'Skupina' },
    { value: 'month', label: 'Měsíc' }
  ];

  private dateDebounce?: ReturnType<typeof setTimeout>;


  // ========== LIFECYCLE ==========
  ngOnInit(): void {
    this.stats.loading.set(true);
    forkJoin([this.dashboard.fetchGroups(), this.dashboard.fetchModels()]).pipe(
      catchError(err => this.handleError(err, 'Při načítání filtrů statistik se něco pokazilo.'))
    ).subscribe(([groups, models]) => {
      this.stats.groupOptions.set([
        { value: '', label: 'Všechny skupiny' },
        ...groups.map(g => ({ value: g._id, label: g.name }))
      ]);
      this.stats.cropModelOptions.set([
        { value: '', label: 'Všechny ořezové modely' },
        ...models.crop_models.map(m => ({ value: m, label: m }))
      ]);
      this.stats.rotationModelOptions.set([
        { value: '', label: 'Všechny rotační modely' },
        ...models.rotation_models.map(m => ({ value: m, label: m }))
      ]);
      this.reload();
    });
  }

  ngOnDestroy(): void {
    if (this.dateDebounce) clearTimeout(this.dateDebounce);
  }

  private handleError(err: any, message: string) {
    this.stats.loading.set(false);
    if (err?.status === 403) {
      this.router.navigate(['/forbidden']);
    } else {
      this.ui.showToast(message + ' Zkuste stránku znovu načíst.', { type: 'error' });
      console.error('Statistics failed:', err);
    }
    return throwError(() => err);
  }

  reload(): void {
    this.stats.loading.set(true);
    this.stats.loadAll().pipe(
      catchError(err => this.handleError(err, 'Při načítání statistik se něco pokazilo.'))
    ).subscribe(() => this.stats.loading.set(false));
  }


  // ========== FILTERS ==========
  onPreset(value: SegmentedControlValue): void {
    this.stats.applyPreset(value as StatsPreset);
    if (value !== 'custom') this.reload();
  }

  onDate(which: 'from' | 'to', value: string): void {
    if (!value) return;
    this.stats[which].set(value);
    if (this.dateDebounce) clearTimeout(this.dateDebounce);
    this.dateDebounce = setTimeout(() => this.reload(), 300);
  }

  onSelect(target: WritableSignal<string>, value: string | number | null): void {
    target.set(String(value ?? ''));
    this.reload();
  }

  onQualityGroupBy(value: SegmentedControlValue): void {
    this.stats.qualityGroupBy.set(value as StatsGroupBy);
    this.stats.fetchReviewQuality().pipe(catchError(err => this.handleError(err, 'Načtení kvality predikcí se nezdařilo.'))).subscribe();
  }

  onAnomaliesGroupBy(value: SegmentedControlValue): void {
    this.stats.anomaliesGroupBy.set(value as StatsGroupBy | '');
    this.stats.fetchAnomalies().pipe(catchError(err => this.handleError(err, 'Načtení anomálií se nezdařilo.'))).subscribe();
  }

  onUsageGroupBy(value: SegmentedControlValue): void {
    this.stats.usageGroupBy.set(value as UsageGroupBy);
    this.stats.fetchEditorUsage().pipe(catchError(err => this.handleError(err, 'Načtení používání editoru se nezdařilo.'))).subscribe();
  }

  rangeLabel = computed<string>(() => `${this.fmtDate(this.stats.from())} – ${this.fmtDate(this.stats.to())}`);

  private fmtDate(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('cs-CZ');
  }

  groupByLabel(groupBy: string): string {
    return this.groupByOptions.find(o => o.value === groupBy)?.label ?? 'Skupina';
  }


  // ========== DERIVED VIEWS ==========
  kpis = computed<Kpi[]>(() => {
    const ov = this.stats.overview();
    if (!ov) return [];
    const st = ov.titles_by_state;
    const finished = (st['completed'] ?? 0) + (st['retrain'] ?? 0);
    const editedRatio = ov.scans.total ? ov.scans.edited / ov.scans.total : null;
    return [
      { label: 'Tituly v období', value: fmtNum(this.stats.titlesTotal()), hint: `${fmtNum(st['ready'] ?? 0)} nových · ${fmtNum(st['user_approved'] ?? 0)} uložených` },
      { label: 'Dokončené tituly', value: fmtNum(st['completed'] ?? 0) },
      { label: 'Na přetrénování', value: fmtNum(st['retrain'] ?? 0), hint: finished ? `${fmtPct((st['retrain'] ?? 0) / finished)} z uzavřených` : undefined },
      { label: 'Skeny', value: fmtNum(ov.scans.total) },
      { label: 'Upravené skeny', value: fmtPct(editedRatio), hint: `${fmtNum(ov.scans.edited)} z ${fmtNum(ov.scans.total)}` },
      { label: 'Aktivní uživatelé', value: fmtNum(ov.active_users) },
      { label: 'Otevření editoru', value: fmtNum(ov.sessions) },
      { label: 'Čas v editoru', value: fmtDuration(ov.editor_time_s) }
    ];
  });

  stateSegments = computed<StackedSegment[]>(() => {
    const st = this.stats.overview()?.titles_by_state ?? {};
    return Object.entries(st)
      .filter(([, n]) => n > 0)
      .map(([state, n]) => ({ label: titleStateDict[state as keyof typeof titleStateDict] ?? state, value: n }));
  });

  anomaliesTotal = computed<AnomaliesRow | null>(() => {
    const rows = this.stats.anomalies();
    return this.stats.anomaliesGroupBy() === '' && rows.length ? rows[0] : null;
  });

  flagRows = computed(() => {
    const total = this.anomaliesTotal();
    if (!total) return [];
    return Object.entries(total.flags)
      .map(([flag, s]) => ({ flag, label: flagMessages[flag] ?? flag, ...s }))
      .sort((a, b) => b.n - a.n);
  });

  usageTotals = computed(() => {
    const rows = this.stats.usage();
    const sessions = rows.reduce((s, r) => s + r.sessions, 0);
    const duration = rows.reduce((s, r) => s + r.total_duration_s, 0);
    const saves = rows.reduce((s, r) => s + r.saves, 0);
    const shortcuts = rows.reduce((s, r) => s + r.shortcuts, 0);
    const mouse = rows.reduce((s, r) => s + r.mouse_actions, 0);
    return {
      sessions,
      meanDuration: sessions ? duration / sessions : null,
      savesPerSession: sessions ? saves / sessions : null,
      keyboardRatio: shortcuts + mouse ? shortcuts / (shortcuts + mouse) : null
    };
  });

  // Keyboard vs. mouse per action, summed over all rows of the current grouping.
  actionRows = computed(() => {
    const byAction = new Map<string, { action: string; label: string; keyboard: number; mouse: number }>();
    for (const row of this.stats.usage()) {
      for (const a of row.actions) {
        const entry = byAction.get(a.action) ?? { action: a.action, label: ACTION_LABELS[a.action] ?? a.action, keyboard: 0, mouse: 0 };
        entry.keyboard += a.keyboard;
        entry.mouse += a.mouse;
        byAction.set(a.action, entry);
      }
    }
    return [...byAction.values()].sort((a, b) => (b.keyboard + b.mouse) - (a.keyboard + a.mouse));
  });

  topShortcuts = computed<BarDatum[]>(() =>
    this.actionRows()
      .filter(a => a.keyboard > 0)
      .slice(0, 12)
      .map(a => ({ label: a.label, value: a.keyboard }))
  );

  filterUsage = computed(() => {
    const merged: Record<string, Record<string, number>> = {};
    for (const row of this.stats.usage()) {
      for (const [filter, values] of Object.entries(row.filters)) {
        merged[filter] ??= {};
        for (const [value, n] of Object.entries(values)) merged[filter][value] = (merged[filter][value] ?? 0) + n;
      }
    }
    return Object.entries(merged).map(([filter, values]) => ({
      filter,
      label: FILTER_LABELS[filter] ?? filter,
      segments: Object.entries(values).map(([value, n]) => ({ label: this.filterValueLabel(filter, value), value: n }))
    }));
  });

  settingRows = computed(() => {
    const settings = this.stats.settings()?.settings ?? {};
    return Object.keys(SETTING_LABELS)
      .filter(key => settings[key])
      .map(key => ({
        key,
        label: SETTING_LABELS[key],
        segments: Object.entries(settings[key])
          .sort((a, b) => b[1] - a[1])
          .map(([value, n]): StackedSegment => ({ label: this.settingValueLabel(key, value), value: n }))
      }));
  });

  keyboardShare(row: { keyboard: number; mouse: number }): number | null {
    const total = row.keyboard + row.mouse;
    return total ? row.keyboard / total : null;
  }

  private filterValueLabel(filter: string, value: string): string {
    if (filter === 'scan_type') return filterScanTypeStartDict[value as keyof typeof filterScanTypeStartDict] ?? value;
    if (filter === 'page_number') return filterPageNumberStartDict[value as keyof typeof filterPageNumberStartDict] ?? value;
    return value;
  }

  private settingValueLabel(setting: string, value: string): string {
    if (value === 'true') return 'Ano';
    if (value === 'false') return 'Ne';
    switch (setting) {
      case 'gridMode': return gridModeDict[value as keyof typeof gridModeDict] ?? value;
      case 'defaultFitMode': return defaultFitModeDict[value as keyof typeof defaultFitModeDict] ?? value;
      case 'filterScanTypeStart': return filterScanTypeStartDict[value as keyof typeof filterScanTypeStartDict] ?? value;
      case 'filterPageNumberStart': return filterPageNumberStartDict[value as keyof typeof filterPageNumberStartDict] ?? value;
      default: return value;
    }
  }

  usageRowLabel(row: EditorUsageRow): string {
    return row.key_name;
  }


  // ========== CSV EXPORTS ==========
  private csvName(section: string): string {
    return `statistiky_${section}_${this.stats.from()}_${this.stats.to()}.csv`;
  }

  exportQuality(): void {
    const header = [this.groupByLabel(this.stats.qualityGroupBy()), 'Tituly', 'Skeny', 'Upravené skeny', 'Podíl upravených', 'Podíl skutečně změněných', 'Průměrné IoU', 'Průměrný posun středu', 'Průměrná změna úhlu (°)', 'Přidané strany', 'Odebrané strany', 'Podíl změněné orientace', 'Dokončené', 'Přetrénování', 'Podíl přetrénování', 'Medián doby kontroly (s)'];
    const rows = this.stats.quality().map(r => [
      r.key_name, r.n_titles, r.scans_total, r.scans_edited, r.mean_edit_ratio, r.mean_changed_ratio, r.mean_iou, r.mean_center_shift, r.mean_angle_delta,
      r.pages_added, r.pages_removed, r.orientation_change_rate, r.completed, r.retrain, r.retrain_rate, r.median_turnaround_s
    ]);
    downloadCsv(this.csvName('kvalita'), rowsToCsv([header, ...rows]));
  }

  exportAnomalies(): void {
    const header = ['Skupina', 'Anomálie', 'Počet skenů', 'Upravené skeny', 'Podíl upravených'];
    const rows: unknown[][] = [];
    for (const r of this.stats.anomalies()) {
      for (const [flag, s] of Object.entries(r.flags)) rows.push([r.key_name, flagMessages[flag] ?? flag, s.n, s.edited, s.edit_rate]);
      rows.push([r.key_name, 'Celkem podezřelé', r.flagged, r.flagged_edited, r.precision]);
    }
    downloadCsv(this.csvName('anomalie'), rowsToCsv([header, ...rows]));
  }

  exportUsage(): void {
    const header = [this.groupByLabel(this.stats.usageGroupBy()), 'Otevření editoru', 'Celkový čas (s)', 'Průměrný čas (s)', 'Uložení', 'Uložení na otevření', 'Zkratky', 'Akce myší', 'Podíl klávesnice'];
    const rows = this.stats.usage().map(r => [
      r.key_name, r.sessions, r.total_duration_s, r.mean_duration_s, r.saves, r.saves_per_session, r.shortcuts, r.mouse_actions, r.keyboard_ratio
    ]);
    const actionHeader = ['Akce', 'Klávesnice', 'Myš'];
    const actionRows = this.actionRows().map(a => [a.label, a.keyboard, a.mouse]);
    downloadCsv(this.csvName('editor'), rowsToCsv([header, ...rows, [], actionHeader, ...actionRows]));
  }

  exportSettings(): void {
    const header = ['Nastavení', 'Hodnota', 'Uživatelů'];
    const rows: unknown[][] = [];
    for (const s of this.settingRows()) for (const seg of s.segments) rows.push([s.label, seg.label, seg.value]);
    downloadCsv(this.csvName('nastaveni'), rowsToCsv([header, ...rows]));
  }
}
