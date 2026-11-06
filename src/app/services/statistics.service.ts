import { HttpClient, HttpParams } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { forkJoin, Observable, of, tap } from 'rxjs';
import { AuthService } from './auth.service';
import { SelectOption } from '../app.types';
import { AnomaliesRow, EditorUsageRow, ReviewQualityRow, StatsEnvelope, StatsGroupBy, StatsOverview, StatsPreset, StatsSettings, TimeRow, UsageGroupBy } from '../stats.types';
import { isoDaysAgo, isoToday, previousRange } from '../utils/stats-format';
import { t } from '../i18n/i18n';

interface DateRange {
  from: string;
  to: string;
}

// Admin statistics: filter state + the GET /stats/* calls.
// Everything returned is aggregated per group / model / month — never per user.
@Injectable({ providedIn: 'root' })
export class StatisticsService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);

  // ========== FILTERS ==========
  preset = signal<StatsPreset>(30);
  from = signal<string>(isoDaysAgo(30));
  to = signal<string>(isoToday());
  groupId = signal<string>('');
  cropModel = signal<string>('');
  rotationModel = signal<string>('');

  // One grouping for every section. Editor usage only supports group | month.
  groupBy = signal<StatsGroupBy>('group');
  usageGroupBy = computed<UsageGroupBy>(() => this.groupBy() === 'month' ? 'month' : 'group');

  // Previous window of equal length, for the "vs. previous period" deltas.
  previous = computed<DateRange>(() => previousRange(this.from(), this.to()));

  groupOptions = signal<SelectOption[]>([{ value: '', label: t('Všechny skupiny') }]);
  cropModelOptions = signal<SelectOption[]>([{ value: '', label: t('Všechny ořezové modely') }]);
  rotationModelOptions = signal<SelectOption[]>([{ value: '', label: t('Všechny rotační modely') }]);

  // ========== DATA ==========
  loading = signal<boolean>(false);
  overview = signal<StatsOverview | null>(null);
  quality = signal<ReviewQualityRow[]>([]);
  time = signal<TimeRow[]>([]);
  // Always grouped by month, for the trend chart and the hero sparkline.
  timeMonthly = signal<TimeRow[]>([]);
  // Anomalies: the one summary row (no group_by) and the grouped rows.
  anomaliesTotal = signal<AnomaliesRow | null>(null);
  anomalies = signal<AnomaliesRow[]>([]);
  usage = signal<EditorUsageRow[]>([]);
  settings = signal<StatsSettings | null>(null);
  // Previous period (same filters), for the hero deltas.
  previousTimeMonthly = signal<TimeRow[] | null>(null);

  // Grouping the usage rows were last fetched with (they only depend on group | month).
  private usageLoadedWith: UsageGroupBy | null = null;

  titlesTotal = computed<number>(() => {
    const states = this.overview()?.titles_by_state ?? {};
    return Object.values(states).reduce((sum, n) => sum + n, 0);
  });

  applyPreset(preset: StatsPreset): void {
    this.preset.set(preset);
    if (preset === 'custom') return;
    this.from.set(isoDaysAgo(preset));
    this.to.set(isoToday());
  }

  private params(extra: Record<string, string> = {}, range?: DateRange): HttpParams {
    let params = new HttpParams().set('from', range?.from ?? this.from()).set('to', range?.to ?? this.to());
    if (this.groupId()) params = params.set('group_id', this.groupId());
    if (this.cropModel()) params = params.set('crop_model', this.cropModel());
    if (this.rotationModel()) params = params.set('rotation_model', this.rotationModel());
    for (const [k, v] of Object.entries(extra)) if (v) params = params.set(k, v);
    return params;
  }

  private get<T>(path: string, params: HttpParams): Observable<T> {
    return this.http.get<T>(`${this.auth.apiUrl}/stats/${path}`, { headers: this.auth.authHeaders(), params });
  }

  fetchOverview(): Observable<StatsOverview> {
    return this.get<StatsOverview>('overview', this.params()).pipe(tap(res => this.overview.set(res)));
  }

  fetchReviewQuality(): Observable<StatsEnvelope<ReviewQualityRow>> {
    return this.get<StatsEnvelope<ReviewQualityRow>>('review-quality', this.params({ group_by: this.groupBy() }))
      .pipe(tap(res => this.quality.set(res.items)));
  }

  fetchTime(): Observable<StatsEnvelope<TimeRow>> {
    return this.get<StatsEnvelope<TimeRow>>('time', this.params({ group_by: this.groupBy() }))
      .pipe(tap(res => this.time.set(res.items)));
  }

  fetchTimeMonthly(): Observable<StatsEnvelope<TimeRow>> {
    return this.get<StatsEnvelope<TimeRow>>('time', this.params({ group_by: 'month' }))
      .pipe(tap(res => this.timeMonthly.set(res.items)));
  }

  fetchAnomaliesTotal(): Observable<StatsEnvelope<AnomaliesRow>> {
    return this.get<StatsEnvelope<AnomaliesRow>>('anomalies', this.params())
      .pipe(tap(res => this.anomaliesTotal.set(res.items[0] ?? null)));
  }

  fetchAnomalies(): Observable<StatsEnvelope<AnomaliesRow>> {
    return this.get<StatsEnvelope<AnomaliesRow>>('anomalies', this.params({ group_by: this.groupBy() }))
      .pipe(tap(res => this.anomalies.set(res.items)));
  }

  fetchEditorUsage(): Observable<StatsEnvelope<EditorUsageRow>> {
    const groupBy = this.usageGroupBy();
    return this.get<StatsEnvelope<EditorUsageRow>>('editor-usage', this.params({ group_by: groupBy }))
      .pipe(tap(res => {
        this.usage.set(res.items);
        this.usageLoadedWith = groupBy;
      }));
  }

  fetchSettings(): Observable<StatsSettings> {
    let params = new HttpParams();
    if (this.groupId()) params = params.set('group_id', this.groupId());
    return this.get<StatsSettings>('settings', params).pipe(tap(res => this.settings.set(res)));
  }

  // Previous period: monthly time rows (the hero tiles are computed from both windows the same way).
  fetchPrevious(): Observable<unknown> {
    return this.get<StatsEnvelope<TimeRow>>('time', this.params({ group_by: 'month' }, this.previous()))
      .pipe(tap(res => this.previousTimeMonthly.set(res.items)));
  }

  loadAll(): Observable<unknown> {
    return forkJoin([
      this.fetchOverview(),
      this.fetchReviewQuality(),
      this.fetchTime(),
      this.fetchTimeMonthly(),
      this.fetchAnomaliesTotal(),
      this.fetchAnomalies(),
      this.fetchEditorUsage(),
      this.fetchSettings(),
      this.fetchPrevious()
    ]);
  }

  // After a change of `groupBy`: only the endpoints that depend on it.
  reloadGrouped(): Observable<unknown> {
    return forkJoin([
      this.fetchReviewQuality(),
      this.fetchTime(),
      this.fetchAnomalies(),
      this.usageLoadedWith === this.usageGroupBy() ? of(null) : this.fetchEditorUsage()
    ]);
  }
}
