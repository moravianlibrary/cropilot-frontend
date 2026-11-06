import { Component, computed, effect, ElementRef, inject, linkedSignal, signal, viewChild, viewChildren, WritableSignal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { CdkConnectedOverlay, CdkOverlayOrigin, ConnectedPosition } from '@angular/cdk/overlay';
import { catchError, forkJoin, throwError } from 'rxjs';
import { StatisticsService } from '../../services/statistics.service';
import { DashboardService } from '../../services/dashboard.service';
import { UiService } from '../../services/ui.service';
import { LocalStorageService } from '../../services/local-storage.service';
import { SelectComponent } from '../../components/select/select.component';
import { SegmentedControlComponent, SegmentedControlOption, SegmentedControlValue } from '../../components/segmented-control/segmented-control.component';
import { LoaderComponent } from '../../components/loader/loader.component';
import { IconComponent } from '../../components/icon/icon.component';
import { BarChartComponent, BarDatum, BarGroup, BarSeries } from '../../components/charts/bar-chart/bar-chart.component';
import { StackedBarComponent, StackedSegment } from '../../components/charts/stacked-bar/stacked-bar.component';
import { KpiDelta, KpiTileComponent } from '../../components/charts/kpi-tile/kpi-tile.component';
import { PhaseChartComponent, PhaseRow } from '../../components/charts/phase-chart/phase-chart.component';
import { SectionCardComponent, SectionSummaryItem } from '../../components/section-card/section-card.component';
import { SERIES_COLORS } from '../../components/charts/chart-colors';
import { defaultFitModeDict, filterPageNumberStartDict, filterScanTypeStartDict, flagMessages, gridModeDict, titleStateDict } from '../../app.config';
import { SelectOption } from '../../app.types';
import { AnomaliesRow, EditorUsageRow, StatsGroupBy, StatsPreset, TimeRow } from '../../stats.types';
import { fmtDuration, fmtNum, fmtPct, fmtSeconds } from '../../utils/stats-format';
import { downloadCsv, rowsToCsv } from '../../utils/utils';
import { locale, plural, t } from '../../i18n/i18n';
import { TPipe } from '../../i18n/t.pipe';

interface Kpi {
  label: string;
  value: string;
  hint?: string;
  tooltip?: string;
  tag?: string;
  hero?: boolean;
  delta?: KpiDelta | null;
  spark?: number[] | null;
}

// Savings estimate: slider default and localStorage key of the manual-cropping seconds per scan.
const DEFAULT_MANUAL_SECONDS = 45;
const MANUAL_SECONDS_KEY = 'statsManualCropSeconds';

// Per-scan values based on fewer reviewed / flagged scans than this are tagged "málo dat".
const SMALL_SAMPLE = 50;

// Page sections, in order; ids are the scroll anchors of the toolbar.
type SectionId = 'prehled' | 'cas' | 'kvalita' | 'anomalie' | 'editor';
const SECTIONS: { id: SectionId; label: string }[] = [
  { id: 'prehled', label: 'Přehled' },
  { id: 'cas', label: 'Čas' },
  { id: 'kvalita', label: 'Kvalita predikcí' },
  { id: 'anomalie', label: 'Anomálie' },
  { id: 'editor', label: 'Editor' }
];

type ExportKey = 'time' | 'quality' | 'anomalies' | 'usage' | 'settings';

// Czech labels for telemetry action names (shared vocabulary with the backend).
// Translated with t() at render time.
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

// Placement heuristics of "Přidat výřez" (frontend utils/page-placement.ts).
const PLACEMENT_LABELS: Record<string, string> = {
  prediction: 'Podle predikce', mirror: 'Zrcadlení výřezu', neighbor: 'Podle sousedního skenu', default: 'Výchozí obdélník'
};

const SETTING_LABELS: Record<string, string> = {
  gridMode: 'Mřížka',
  gridDensityLabel: 'Hustota mřížky',
  cropColorLabel: 'Barva výřezu a mřížky',
  gridLineWidthLabel: 'Tloušťka mřížky',
  outlineWidthLabel: 'Obrys výřezu',
  outlineDashed: 'Čárkovaný obrys',
  dimColor: 'Clona',
  dimOpacity: 'Viditelnost clony',
  defaultFitMode: 'Výchozí přiblížení',
  filterScanTypeStart: 'Filtr skenů při otevření',
  filterPageNumberStart: 'Filtr stran při otevření',
  showPredictions: 'Zobrazení predikcí (admin)'
};

const FILTER_LABELS: Record<string, string> = {
  scan_type: 'Filtr typu skenu',
  page_number: 'Filtr počtu stran'
};

// Card titles of the grouped tables ("Podle skupiny" …).
const BY_LABELS: Record<StatsGroupBy, string> = {
  group: 'Podle skupiny',
  crop_model: 'Podle ořezového modelu',
  rotation_model: 'Podle rotačního modelu',
  month: 'Podle měsíce'
};

// Phases of a title's timeline (GET /stats/time medians), in pipeline order.
const TIME_PHASES: { key: string; label: string; tooltip: string; field: keyof TimeRow; tone: PhaseRow['tone'] }[] = [
  { key: 'queue', label: 'Fronta', tooltip: 'Nahrání → start workeru', field: 'median_queue_s', tone: 'machine' },
  { key: 'processing', label: 'Zpracování', tooltip: 'Start workeru → predikce hotové', field: 'median_processing_s', tone: 'machine' },
  { key: 'wait', label: 'Čeká na kontrolu', tooltip: 'Predikce hotové → první otevření editoru', field: 'median_wait_review_s', tone: 'human-idle' },
  { key: 'review', label: 'Kontrola', tooltip: 'Aktivní čas v editoru', field: 'median_review_active_s', tone: 'human' },
  { key: 'after_save', label: 'Po uložení', tooltip: 'První uložení → dokončení (integrace)', field: 'median_after_save_s', tone: 'integration' }
];

// Median of the non-null values (used to combine per-row medians into one number).
const medianOf = (values: (number | null | undefined)[]): number | null => {
  const sorted = values.filter((v): v is number => v !== null && v !== undefined && !Number.isNaN(v)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const sumOf = <T>(rows: T[], pick: (r: T) => number | null | undefined): number => rows.reduce((s, r) => s + (pick(r) ?? 0), 0);

// Totals of the time rows: the hero numbers (same function for the current and the previous period).
const timeTotals = (rows: TimeRow[]) => {
  const machineTotal = sumOf(rows, r => r.machine_total_s);
  const machineScans = sumOf(rows, r => r.machine_scans);
  const reviewTotal = sumOf(rows, r => r.review_active_total_s);
  const reviewedScans = sumOf(rows, r => r.reviewed_scans);
  const reviewedChanged = sumOf(rows, r => r.reviewed_scans_changed);
  return {
    machineTotal,
    reviewTotal,
    reviewedScans,
    reviewedChanged,
    machinePerScan: machineScans ? machineTotal / machineScans : null,
    reviewPerScan: reviewedScans ? reviewTotal / reviewedScans : null,
    reviewPerChanged: reviewedChanged ? reviewTotal / reviewedChanged : null,
    humanMachineRatio: machineTotal ? reviewTotal / machineTotal : null,
    lead: medianOf(rows.map(r => r.median_lead_s))
  };
};

@Component({
  selector: 'app-statistics',
  imports: [
    FormsModule, CdkConnectedOverlay, CdkOverlayOrigin, SelectComponent, SegmentedControlComponent, LoaderComponent, IconComponent,
    BarChartComponent, StackedBarComponent, KpiTileComponent, PhaseChartComponent, SectionCardComponent, TPipe
  ],
  templateUrl: './statistics.component.html',
  styleUrl: './statistics.component.scss'
})
export class StatisticsComponent {
  stats = inject(StatisticsService);
  private dashboard = inject(DashboardService);
  private ui = inject(UiService);
  private storage = inject(LocalStorageService);
  private router = inject(Router);

  fmtNum = fmtNum;
  fmtPct = fmtPct;
  fmtDuration = fmtDuration;
  fmtSeconds = fmtSeconds;
  fmtSecondsValue = (value: number): string => fmtSeconds(value);
  // Axis ticks of the monthly chart: whole seconds ("6 s"), durations above a minute.
  fmtTick = (value: number): string => fmtSeconds(value, 0);
  smallSample = SMALL_SAMPLE;
  sections = SECTIONS;

  // Option lists are computed so their labels follow the UI language.
  presetOptions = computed<SegmentedControlOption[]>(() => [
    { value: 7, label: t('7 dní') },
    { value: 30, label: t('30 dní') },
    { value: 90, label: t('90 dní') },
    { value: 'custom', label: t('Vlastní') }
  ]);
  groupByOptions = computed<SegmentedControlOption[]>(() => [
    { value: 'group', label: t('Skupina') },
    { value: 'crop_model', label: t('Ořezový model') },
    { value: 'rotation_model', label: t('Rotační model') },
    { value: 'month', label: t('Měsíc') }
  ]);

  // The service keeps the Czech "all" option labels (value ''); translate them for display.
  private translateAllOption = (options: SelectOption[]): SelectOption[] =>
    options.map(o => o.value === '' ? { ...o, label: t(o.label) } : o);
  groupOptionsView = computed(() => this.translateAllOption(this.stats.groupOptions()));
  cropModelOptionsView = computed(() => this.translateAllOption(this.stats.cropModelOptions()));
  rotationModelOptionsView = computed(() => this.translateAllOption(this.stats.rotationModelOptions()));

  private dateDebounce?: ReturnType<typeof setTimeout>;

  // ---- Toolbar state ----
  exportOpen = signal<boolean>(false);
  exportPositions: ConnectedPosition[] = [
    { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 6 },
    { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -6 }
  ];
  activeSection = signal<SectionId>('prehled');
  usageOpen = signal<boolean>(true);
  settingsOpen = signal<boolean>(false);
  qualityDetails = signal<boolean>(false);

  private scrollEl = viewChild<ElementRef<HTMLElement>>('scroll');
  private sectionEls = viewChildren<ElementRef<HTMLElement>>('section');
  private observer?: IntersectionObserver;

  constructor() {
    // Highlight the section under the toolbar while scrolling; re-created whenever the sections (re)render.
    effect(onCleanup => {
      const root = this.scrollEl()?.nativeElement;
      const sections = this.sectionEls().map(s => s.nativeElement);
      if (!root || !sections.length) return;
      this.observer = new IntersectionObserver(() => this.updateActiveSection(root, sections), {
        root, threshold: [0, 0.25, 0.5, 0.75, 1]
      });
      sections.forEach(s => this.observer!.observe(s));
      onCleanup(() => this.observer?.disconnect());
    });
  }

  private updateActiveSection(root: HTMLElement, sections: HTMLElement[]): void {
    const rootTop = root.getBoundingClientRect().top;
    const atBottom = root.scrollTop + root.clientHeight >= root.scrollHeight - 2;
    // The active section is the last one whose top has passed the upper third of the viewport.
    const limit = rootTop + root.clientHeight * 0.3;
    let active = sections[0];
    for (const s of sections) if (s.getBoundingClientRect().top <= limit) active = s;
    if (atBottom) active = sections[sections.length - 1];
    this.activeSection.set(active.id as SectionId);
  }

  scrollTo(id: SectionId): void {
    const target = this.sectionEls().map(s => s.nativeElement).find(s => s.id === id);
    if (!target) return;
    this.activeSection.set(id);
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }


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
    this.observer?.disconnect();
  }

  private handleError(err: any, message: string) {
    this.stats.loading.set(false);
    if (err?.status === 403) {
      this.router.navigate(['/forbidden']);
    } else {
      this.ui.showToast(t(message) + ' ' + t('Zkuste stránku znovu načíst.'), { type: 'error' });
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

  onGroupBy(value: SegmentedControlValue): void {
    if (value === this.stats.groupBy()) return;
    this.stats.groupBy.set(value as StatsGroupBy);
    this.stats.reloadGrouped().pipe(catchError(err => this.handleError(err, 'Načtení seskupených statistik se nezdařilo.'))).subscribe();
  }

  rangeLabel = computed<string>(() => `${this.fmtDate(this.stats.from())} – ${this.fmtDate(this.stats.to())}`);
  previousRangeLabel = computed<string>(() => `${this.fmtDate(this.stats.previous().from)} – ${this.fmtDate(this.stats.previous().to)}`);

  private fmtDate(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(locale());
  }

  groupByLabel(groupBy: string): string {
    return this.groupByOptions().find(o => o.value === groupBy)?.label ?? t('Skupina');
  }

  // "Podle skupiny" … for the current grouping (usage only knows group | month).
  byLabel = computed<string>(() => t(BY_LABELS[this.stats.groupBy()]));
  usageByLabel = computed<string>(() => t(BY_LABELS[this.stats.usageGroupBy()]));


  // ========== PŘEHLED ==========
  // Hero numbers come from the monthly rows (stable whatever the grouping); the
  // previous period is fetched the same way, so the deltas compare like with like.
  private heroCurrent = computed(() => timeTotals(this.stats.timeMonthly()));
  private heroPrevious = computed(() => {
    const rows = this.stats.previousTimeMonthly();
    return rows ? timeTotals(rows) : null;
  });

  // Delta line of a "lower is better" metric; null unless both periods have a value.
  private deltaDown(current: number | null, previous: number | null | undefined): KpiDelta | null {
    if (current === null || previous === null || previous === undefined || !previous) return null;
    const change = (current - previous) / Math.abs(previous);
    const vs = t('vs. {range}', { range: this.previousRangeLabel() });
    if (Math.abs(change) < 0.0005) return { text: `± ${fmtPct(0)}`, vs, tone: 'neutral' };
    return { text: `${change < 0 ? '▼' : '▲'} ${fmtPct(Math.abs(change))}`, vs, tone: change < 0 ? 'good' : 'bad' };
  }

  // Human time per scan by month, for the hero sparkline (only with ≥ 2 points).
  private humanSpark = computed<number[] | null>(() => {
    const values = this.stats.timeMonthly().map(r => r.review_s_per_scan).filter((v): v is number => v !== null && v !== undefined);
    return values.length >= 2 ? values : null;
  });

  heroTiles = computed<Kpi[]>(() => {
    const cur = this.heroCurrent();
    const prev = this.heroPrevious();
    return [
      {
        label: t('Lidský čas na sken'), value: fmtSeconds(cur.reviewPerScan), hero: true,
        hint: plural(cur.reviewedScans, '{total} aktivně · {n} sken', '{total} aktivně · {n} skeny', '{total} aktivně · {n} skenů', { total: fmtDuration(cur.reviewTotal), n: fmtNum(cur.reviewedScans) }),
        tooltip: t('Aktivní čas v editoru na zkontrolovaný sken'),
        delta: this.deltaDown(cur.reviewPerScan, prev?.reviewPerScan), spark: this.humanSpark()
      },
      {
        label: t('Strojový čas na sken'), value: fmtSeconds(cur.machinePerScan),
        hint: t('{total} celkem', { total: fmtDuration(cur.machineTotal) }),
        tooltip: t('Čas zpracování workerem na sken'),
        delta: this.deltaDown(cur.machinePerScan, prev?.machinePerScan)
      },
      {
        label: t('Lidský čas na upravený sken'), value: fmtSeconds(cur.reviewPerChanged),
        hint: plural(cur.reviewedChanged, '{n} změněný sken', '{n} změněné skeny', '{n} změněných skenů', { n: fmtNum(cur.reviewedChanged) }),
        tooltip: t('Aktivní čas v editoru na skutečně změněný sken'),
        delta: this.deltaDown(cur.reviewPerChanged, prev?.reviewPerChanged)
      },
      {
        label: t('Od nahrání po uložení'), value: fmtSeconds(cur.lead),
        tooltip: t('Medián od nahrání titulu do prvního uložení'),
        delta: this.deltaDown(cur.lead, prev?.lead)
      }
    ];
  });

  // ========== ODHAD ÚSPORY ==========
  // Manual cropping time per scan is not measured anywhere; the admin sets it
  // with the slider (kept per browser) and the estimate compares it with the
  // active editor time of the period.
  readonly manualMin = 10;
  readonly manualMax = 120;
  manualSeconds = signal<number>(this.storage.get<number>(MANUAL_SECONDS_KEY, DEFAULT_MANUAL_SECONDS) ?? DEFAULT_MANUAL_SECONDS);

  onManualSeconds(value: string | number): void {
    const seconds = Math.min(this.manualMax, Math.max(this.manualMin, Number(value) || DEFAULT_MANUAL_SECONDS));
    this.manualSeconds.set(seconds);
    this.storage.set(MANUAL_SECONDS_KEY, seconds);
  }

  // Number of scans to estimate for: the period's count by default, adjustable
  // per session; re-derived (reset) whenever a new overview arrives.
  readonly scansMin = 10;
  scansCount = linkedSignal<number>(() => this.stats.overview()?.scans.total ?? 0);
  scansMax = computed<number>(() => {
    const actual = this.stats.overview()?.scans.total ?? 0;
    return Math.max(10000, Math.ceil((actual * 2) / 100) * 100);
  });

  onScansCount(value: string | number): void {
    this.scansCount.set(Math.min(this.scansMax(), Math.max(this.scansMin, Math.round(Number(value) || 0))));
  }

  savings = computed(() => {
    const ov = this.stats.overview();
    if (!ov || !ov.scans.total) return null;
    const scans = this.scansCount();
    const manual = scans * this.manualSeconds();
    // Human and machine time per scan as measured on the reviewed / processed
    // titles of the period (the hero tiles), applied to the chosen volume.
    const { reviewPerScan, machinePerScan } = this.heroCurrent();
    if (reviewPerScan === null) return null;
    const human = scans * reviewPerScan;
    return {
      manual: fmtDuration(manual),
      human: fmtDuration(human),
      machine: machinePerScan === null ? '–' : fmtDuration(scans * machinePerScan),
      saved: fmtDuration(Math.max(0, manual - human)),
      remaining: fmtPct(manual ? human / manual : null)
    };
  });

  // Compact strip: counts of the period as "number + unit" pairs.
  stripStats = computed<{ value: string; label: string }[]>(() => {
    const ov = this.stats.overview();
    if (!ov) return [];
    const st = ov.titles_by_state;
    const titles = this.stats.titlesTotal();
    const editedRatio = ov.scans.total ? ov.scans.edited / ov.scans.total : null;
    let titlesLabel = plural(titles, 'titul', 'tituly', 'titulů') + ' · ' + t('{ready} nových · {saved} uložených', { ready: fmtNum(st['ready'] ?? 0), saved: fmtNum(st['user_approved'] ?? 0) });
    // The integration states (completed / retrain) are only used on the NDK instance.
    if ((st['completed'] ?? 0) + (st['retrain'] ?? 0) > 0) {
      titlesLabel += ' · ' + t('{completed} dokončených · {retrain} na přetrénování', { completed: fmtNum(st['completed'] ?? 0), retrain: fmtNum(st['retrain'] ?? 0) });
    }
    return [
      { value: fmtNum(titles), label: titlesLabel },
      { value: fmtNum(ov.scans.total), label: plural(ov.scans.total, 'sken', 'skeny', 'skenů') },
      { value: fmtPct(editedRatio), label: t('upravených · {edited} z {total}', { edited: fmtNum(ov.scans.edited), total: fmtNum(ov.scans.total) }) },
      { value: fmtNum(ov.active_users), label: plural(ov.active_users, 'aktivní uživatel', 'aktivní uživatelé', 'aktivních uživatelů') },
      { value: fmtNum(ov.sessions), label: t('otevření editoru') },
      { value: fmtDuration(ov.editor_active_time_s ?? ov.editor_time_s), label: t('aktivně · {total} s otevřenou záložkou', { total: fmtDuration(ov.editor_time_s) }) }
    ];
  });

  stateSegments = computed<StackedSegment[]>(() => {
    const st = this.stats.overview()?.titles_by_state ?? {};
    return Object.entries(st)
      .filter(([, n]) => n > 0)
      .map(([state, n]) => ({ label: t(titleStateDict[state as keyof typeof titleStateDict] ?? state), value: n }));
  });


  // ========== ČAS ==========
  // Title timeline: medians of the five phases over the rows of the current grouping.
  timePhases = computed<PhaseRow[]>(() => {
    const rows = this.stats.time();
    const phases: PhaseRow[] = [];
    for (const p of TIME_PHASES) {
      const seconds = medianOf(rows.map(r => r[p.field] as number | null));
      if (seconds !== null) phases.push({ key: p.key, label: t(p.label), tooltip: t(p.tooltip), tone: p.tone, seconds });
    }
    return phases;
  });

  phaseLegend = computed(() => [
    { label: t('Stroj'), color: SERIES_COLORS.machine },
    { label: t('Člověk'), color: SERIES_COLORS.human },
    { label: t('Integrace'), color: SERIES_COLORS.integration }
  ]);

  monthlySeries = computed<BarSeries[]>(() => [
    { label: t('Člověk'), color: SERIES_COLORS.human },
    { label: t('Stroj'), color: SERIES_COLORS.machine }
  ]);

  monthlyGroups = computed<BarGroup[]>(() => this.stats.timeMonthly()
    .filter(r => r.review_s_per_scan !== null || r.machine_s_per_scan !== null)
    .map(r => ({ label: r.key_name || r.key, values: [r.review_s_per_scan, r.machine_s_per_scan] }))
  );

  // "Celkem" footer: sums, ratios recomputed from the sums, medians of the row medians.
  timeTotalRow = computed<TimeRow | null>(() => {
    const rows = this.stats.time();
    if (rows.length < 2) return null;
    const tt = timeTotals(rows);
    return {
      key: 'total', key_name: t('Celkem'),
      n_titles: sumOf(rows, r => r.n_titles), scans_total: sumOf(rows, r => r.scans_total), scans_changed: sumOf(rows, r => r.scans_changed),
      titles_with_machine: sumOf(rows, r => r.titles_with_machine), machine_scans: sumOf(rows, r => r.machine_scans),
      machine_total_s: tt.machineTotal, machine_s_per_scan: tt.machinePerScan,
      titles_with_review: sumOf(rows, r => r.titles_with_review), reviewed_scans: tt.reviewedScans, reviewed_scans_changed: tt.reviewedChanged,
      review_active_total_s: tt.reviewTotal, review_visible_total_s: sumOf(rows, r => r.review_visible_total_s), sessions: sumOf(rows, r => r.sessions),
      review_s_per_scan: tt.reviewPerScan, review_s_per_changed_scan: tt.reviewPerChanged,
      median_queue_s: medianOf(rows.map(r => r.median_queue_s)), median_processing_s: medianOf(rows.map(r => r.median_processing_s)),
      median_wait_review_s: medianOf(rows.map(r => r.median_wait_review_s)), median_review_active_s: medianOf(rows.map(r => r.median_review_active_s)),
      median_lead_s: tt.lead, median_after_save_s: medianOf(rows.map(r => r.median_after_save_s)),
      human_machine_ratio: tt.humanMachineRatio
    };
  });


  // ========== KVALITA PREDIKCÍ ==========
  qualityTiles = computed<Kpi[]>(() => {
    const rows = this.stats.quality();
    const scans = sumOf(rows, r => r.scans_total);
    const edited = sumOf(rows, r => r.scans_edited);
    // Means weighted by the number of titles (the backend averages per title).
    const weighted = (pick: (r: typeof rows[number]) => number | null): number | null => {
      const valid = rows.filter(r => pick(r) !== null && r.n_titles > 0);
      const weight = sumOf(valid, r => r.n_titles);
      return weight ? valid.reduce((s, r) => s + pick(r)! * r.n_titles, 0) / weight : null;
    };
    return [
      { label: t('Upravené skeny'), value: fmtPct(scans ? edited / scans : null), hint: t('{edited} z {total}', { edited: fmtNum(edited), total: fmtNum(scans) }), tooltip: t('Podíl skenů s uloženou úpravou · práh 30 %') },
      { label: 'IoU', value: fmtNum(weighted(r => r.mean_iou), 3), tooltip: t('Průměrný překryv predikce a výsledného výřezu (1 = shoda) · práh 0,98 / 0,95') },
      { label: t('Posun středu'), value: fmtPct(weighted(r => r.mean_center_shift), 1), tooltip: t('Průměrný posun středu výřezu v podílu velikosti skenu · práh 0,5 % / 1,5 %') },
      { label: t('Δ úhel'), value: `${fmtNum(weighted(r => r.mean_angle_delta), 2)}°`, tooltip: t('Průměrná změna úhlu rotace · práh 0,3° / 1°') }
    ];
  });


  // ========== ANOMÁLIE ==========
  anomalyTiles = computed<Kpi[]>(() => {
    const total = this.stats.anomaliesTotal();
    if (!total) return [];
    const lowData = t('málo dat');
    return [
      { label: t('Podezřelé skeny'), value: fmtNum(total.flagged), hint: t('{pct} ze všech', { pct: fmtPct(total.scans ? total.flagged / total.scans : null) }) },
      { label: t('Přesnost'), value: fmtPct(total.precision), hint: t('{edited} z {total}', { edited: fmtNum(total.flagged_edited), total: fmtNum(total.flagged) }), tooltip: t('Podíl podezřelých skenů, které uživatel skutečně změnil · práh 60 % / 30 %'), tag: total.flagged < SMALL_SAMPLE ? lowData : '' },
      { label: t('Záchyt'), value: fmtPct(total.recall), hint: t('{edited} z {total}', { edited: fmtNum(total.flagged_edited), total: fmtNum(total.edited) }), tooltip: t('Podíl změněných skenů, které byly označeny jako podezřelé · práh 60 % / 30 %'), tag: total.edited < SMALL_SAMPLE ? lowData : '' },
      { label: t('Změněné bez příznaku'), value: fmtNum(total.unflagged_edited), tooltip: t('Změněné skeny bez příznaku anomálie') }
    ];
  });

  flagRows = computed(() => {
    const total = this.stats.anomaliesTotal();
    if (!total) return [];
    return Object.entries(total.flags)
      .map(([flag, s]) => ({ flag, label: t(flagMessages[flag] ?? flag), ...s }))
      .sort((a, b) => b.n - a.n);
  });


  // ========== POUŽÍVÁNÍ EDITORU ==========
  usageTotals = computed(() => {
    const rows = this.stats.usage();
    const sessions = sumOf(rows, r => r.sessions);
    const duration = sumOf(rows, r => r.total_duration_s);
    const saves = sumOf(rows, r => r.saves);
    return {
      sessions,
      meanDuration: sessions ? duration / sessions : null,
      savesPerSession: sessions ? saves / sessions : null,
      shortcuts: sumOf(rows, r => r.shortcuts),
      mouseActions: sumOf(rows, r => r.mouse_actions)
    };
  });

  usageSummary = computed<SectionSummaryItem[]>(() => {
    const tt = this.usageTotals();
    if (!this.stats.usage().length) return [];
    return [
      { value: fmtNum(tt.sessions), label: t('otevření') },
      { value: fmtDuration(tt.meanDuration), label: t('na otevření') },
      { value: fmtNum(tt.savesPerSession, 2), label: t('uložení / otevření') },
      { value: fmtNum(tt.shortcuts), label: plural(tt.shortcuts, 'zkratka', 'zkratky', 'zkratek') },
      { value: fmtNum(tt.mouseActions), label: plural(tt.mouseActions, 'akce myší', 'akce myší', 'akcí myší') }
    ];
  });

  // Keyboard vs. mouse per action, summed over all rows of the current grouping.
  actionRows = computed(() => {
    const byAction = new Map<string, { action: string; label: string; keyboard: number; mouse: number }>();
    for (const row of this.stats.usage()) {
      for (const a of row.actions) {
        const entry = byAction.get(a.action) ?? { action: a.action, label: t(ACTION_LABELS[a.action] ?? a.action), keyboard: 0, mouse: 0 };
        entry.keyboard += a.keyboard;
        entry.mouse += a.mouse;
        byAction.set(a.action, entry);
      }
    }
    return [...byAction.values()].filter(a => a.keyboard + a.mouse > 0).sort((a, b) => (b.keyboard + b.mouse) - (a.keyboard + a.mouse));
  });

  topShortcuts = computed<BarDatum[]>(() =>
    [...this.actionRows()]
      .filter(a => a.keyboard > 0)
      .sort((a, b) => b.keyboard - a.keyboard)
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
    return Object.entries(merged)
      .map(([filter, values]) => ({
        filter,
        label: t(FILTER_LABELS[filter] ?? filter),
        segments: Object.entries(values).map(([value, n]) => ({ label: this.filterValueLabel(filter, value), value: n }))
      }))
      .filter(f => f.segments.some(s => s.value > 0));
  });

  // How "Přidat výřez" positioned new crops, summed over all rows of the current grouping.
  placementSegments = computed<StackedSegment[]>(() => {
    const merged: Record<string, number> = {};
    for (const row of this.stats.usage()) {
      for (const [strategy, n] of Object.entries(row.page_placements ?? {})) merged[strategy] = (merged[strategy] ?? 0) + n;
    }
    return Object.keys(PLACEMENT_LABELS)
      .filter(strategy => merged[strategy])
      .map(strategy => ({ label: t(PLACEMENT_LABELS[strategy]), value: merged[strategy] }));
  });

  keyboardShare(row: { keyboard: number; mouse: number }): number | null {
    const total = row.keyboard + row.mouse;
    return total ? row.keyboard / total : null;
  }

  private filterValueLabel(filter: string, value: string): string {
    if (filter === 'scan_type') return t(filterScanTypeStartDict[value as keyof typeof filterScanTypeStartDict] ?? value);
    if (filter === 'page_number') return t(filterPageNumberStartDict[value as keyof typeof filterPageNumberStartDict] ?? value);
    return value;
  }

  usageRowLabel(row: EditorUsageRow): string {
    return row.key_name;
  }


  // ========== NASTAVENÍ EDITORU ==========
  settingRows = computed(() => {
    const settings = this.stats.settings()?.settings ?? {};
    return Object.keys(SETTING_LABELS)
      .filter(key => settings[key])
      .map(key => ({
        key,
        label: t(SETTING_LABELS[key]),
        segments: Object.entries(settings[key])
          .sort((a, b) => b[1] - a[1])
          .map(([value, n]): StackedSegment => ({ label: this.settingValueLabel(key, value), value: n }))
      }));
  });

  settingsSummary = computed<SectionSummaryItem[]>(() => {
    const total = this.stats.settings()?.users_total ?? 0;
    return [{ value: fmtNum(total), label: plural(total, 'uživatel', 'uživatelé', 'uživatelů') }];
  });

  private settingValueLabel(setting: string, value: string): string {
    if (value === 'true') return t('Ano');
    if (value === 'false') return t('Ne');
    switch (setting) {
      case 'gridMode': return t(gridModeDict[value as keyof typeof gridModeDict] ?? value);
      case 'defaultFitMode': return t(defaultFitModeDict[value as keyof typeof defaultFitModeDict] ?? value);
      case 'filterScanTypeStart': return t(filterScanTypeStartDict[value as keyof typeof filterScanTypeStartDict] ?? value);
      case 'filterPageNumberStart': return t(filterPageNumberStartDict[value as keyof typeof filterPageNumberStartDict] ?? value);
      case 'dimOpacity': return t('{value} %', { value });
      // Remaining values are stored Czech labels ('Hustá', 'Tyrkysová', …).
      default: return t(value);
    }
  }


  // ========== CSV EXPORTS ==========
  exports = computed<{ key: ExportKey; label: string; disabled: boolean }[]>(() => [
    { key: 'time', label: t('Čas'), disabled: !this.stats.time().length },
    { key: 'quality', label: t('Kvalita predikcí'), disabled: !this.stats.quality().length },
    { key: 'anomalies', label: t('Anomálie'), disabled: !this.stats.anomaliesTotal() && !this.stats.anomalies().length },
    { key: 'usage', label: t('Používání editoru'), disabled: !this.stats.usage().length },
    { key: 'settings', label: t('Nastavení editoru'), disabled: !this.settingRows().length }
  ]);

  runExport(key: ExportKey): void {
    this.exportOpen.set(false);
    switch (key) {
      case 'time': return this.exportTime();
      case 'quality': return this.exportQuality();
      case 'anomalies': return this.exportAnomalies();
      case 'usage': return this.exportUsage();
      case 'settings': return this.exportSettings();
    }
  }

  private csvName(section: string): string {
    return `statistiky_${section}_${this.stats.from()}_${this.stats.to()}.csv`;
  }

  exportQuality(): void {
    const header = [this.groupByLabel(this.stats.groupBy()), ...['Tituly', 'Skeny', 'Upravené skeny', 'Podíl upravených', 'Podíl skutečně změněných', 'Průměrné IoU', 'Průměrný posun středu', 'Průměrná změna úhlu (°)', 'Přidané strany', 'Odebrané strany', 'Podíl změněné orientace', 'Dokončené', 'Přetrénování', 'Podíl přetrénování'].map(h => t(h))];
    const rows = this.stats.quality().map(r => [
      r.key_name, r.n_titles, r.scans_total, r.scans_edited, r.mean_edit_ratio, r.mean_changed_ratio, r.mean_iou, r.mean_center_shift, r.mean_angle_delta,
      r.pages_added, r.pages_removed, r.orientation_change_rate, r.completed, r.retrain, r.retrain_rate
    ]);
    downloadCsv(this.csvName('kvalita'), rowsToCsv([header, ...rows]));
  }

  exportTime(): void {
    const header = [this.groupByLabel(this.stats.groupBy()), ...[
      'Tituly', 'Skeny', 'Změněné skeny', 'Strojový čas (s)', 'Strojové skeny', 'Strojový čas na sken (s)',
      'Lidský čas (s)', 'Čas s otevřenou záložkou (s)', 'Zkontrolované skeny', 'Zkontrolované změněné skeny', 'Lidský čas na sken (s)', 'Lidský čas na upravený sken (s)',
      'Otevření editoru',
      'Medián fronty (s)', 'Medián zpracování (s)', 'Medián čekání na kontrolu (s)', 'Medián kontroly (s)', 'Medián průchodu (s)', 'Medián po uložení (s)'
    ].map(h => t(h))];
    const toRow = (r: TimeRow) => [
      r.key_name, r.n_titles, r.scans_total, r.scans_changed, r.machine_total_s, r.machine_scans, r.machine_s_per_scan,
      r.review_active_total_s, r.review_visible_total_s, r.reviewed_scans, r.reviewed_scans_changed, r.review_s_per_scan, r.review_s_per_changed_scan,
      r.sessions,
      r.median_queue_s, r.median_processing_s, r.median_wait_review_s, r.median_review_active_s, r.median_lead_s, r.median_after_save_s
    ];
    const total = this.timeTotalRow();
    const rows = [...this.stats.time().map(toRow), ...(total ? [toRow(total)] : [])];
    downloadCsv(this.csvName('cas'), rowsToCsv([header, ...rows]));
  }

  exportAnomalies(): void {
    const header = [this.groupByLabel(this.stats.groupBy()), ...['Anomálie', 'Počet skenů', 'Změněné skeny', 'Podíl změněných'].map(h => t(h))];
    const rows: unknown[][] = [];
    const total = this.stats.anomaliesTotal();
    const sources: AnomaliesRow[] = [...(total ? [{ ...total, key_name: t('Celkem') }] : []), ...this.stats.anomalies()];
    for (const r of sources) {
      for (const [flag, s] of Object.entries(r.flags)) rows.push([r.key_name, t(flagMessages[flag] ?? flag), s.n, s.edited, s.edit_rate]);
      rows.push([r.key_name, t('Celkem podezřelé'), r.flagged, r.flagged_edited, r.precision]);
    }
    downloadCsv(this.csvName('anomalie'), rowsToCsv([header, ...rows]));
  }

  exportUsage(): void {
    const header = [this.groupByLabel(this.stats.usageGroupBy()), ...['Otevření editoru', 'Celkový čas (s)', 'Aktivní čas (s)', 'Průměrný čas (s)', 'Uložení', 'Uložení na otevření', 'Zkratky', 'Akce myší'].map(h => t(h))];
    const rows = this.stats.usage().map(r => [
      r.key_name, r.sessions, r.total_duration_s, r.total_active_s ?? null, r.mean_duration_s, r.saves, r.saves_per_session, r.shortcuts, r.mouse_actions
    ]);
    const actionHeader = ['Akce', 'Klávesnice', 'Myš'].map(h => t(h));
    const actionRows = this.actionRows().map(a => [a.label, a.keyboard, a.mouse]);
    downloadCsv(this.csvName('editor'), rowsToCsv([header, ...rows, [], actionHeader, ...actionRows]));
  }

  exportSettings(): void {
    const header = ['Nastavení', 'Hodnota', 'Uživatelů'].map(h => t(h));
    const rows: unknown[][] = [];
    for (const s of this.settingRows()) for (const seg of s.segments) rows.push([s.label, seg.label, seg.value]);
    downloadCsv(this.csvName('nastaveni'), rowsToCsv([header, ...rows]));
  }
}
