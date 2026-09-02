import { HttpClient, HttpParams } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { forkJoin, Observable, tap } from 'rxjs';
import { AuthService } from './auth.service';
import { SelectOption } from '../app.types';
import { AnomaliesRow, EditorUsageRow, ReviewQualityRow, StatsEnvelope, StatsGroupBy, StatsOverview, StatsPreset, StatsSettings, UsageGroupBy } from '../stats.types';
import { isoDaysAgo, isoToday } from '../utils/stats-format';

// Admin statistics: filter state + the five GET /stats/* calls.
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

  qualityGroupBy = signal<StatsGroupBy>('group');
  anomaliesGroupBy = signal<StatsGroupBy | ''>('');
  usageGroupBy = signal<UsageGroupBy>('group');

  groupOptions = signal<SelectOption[]>([{ value: '', label: 'Všechny skupiny' }]);
  cropModelOptions = signal<SelectOption[]>([{ value: '', label: 'Všechny ořezové modely' }]);
  rotationModelOptions = signal<SelectOption[]>([{ value: '', label: 'Všechny rotační modely' }]);

  // ========== DATA ==========
  loading = signal<boolean>(false);
  overview = signal<StatsOverview | null>(null);
  quality = signal<ReviewQualityRow[]>([]);
  anomalies = signal<AnomaliesRow[]>([]);
  usage = signal<EditorUsageRow[]>([]);
  settings = signal<StatsSettings | null>(null);

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

  private params(extra: Record<string, string> = {}): HttpParams {
    let params = new HttpParams().set('from', this.from()).set('to', this.to());
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
    return this.get<StatsEnvelope<ReviewQualityRow>>('review-quality', this.params({ group_by: this.qualityGroupBy() }))
      .pipe(tap(res => this.quality.set(res.items)));
  }

  fetchAnomalies(): Observable<StatsEnvelope<AnomaliesRow>> {
    return this.get<StatsEnvelope<AnomaliesRow>>('anomalies', this.params({ group_by: this.anomaliesGroupBy() }))
      .pipe(tap(res => this.anomalies.set(res.items)));
  }

  fetchEditorUsage(): Observable<StatsEnvelope<EditorUsageRow>> {
    return this.get<StatsEnvelope<EditorUsageRow>>('editor-usage', this.params({ group_by: this.usageGroupBy() }))
      .pipe(tap(res => this.usage.set(res.items)));
  }

  fetchSettings(): Observable<StatsSettings> {
    let params = new HttpParams();
    if (this.groupId()) params = params.set('group_id', this.groupId());
    return this.get<StatsSettings>('settings', params).pipe(tap(res => this.settings.set(res)));
  }

  loadAll(): Observable<unknown> {
    return forkJoin([
      this.fetchOverview(),
      this.fetchReviewQuality(),
      this.fetchAnomalies(),
      this.fetchEditorUsage(),
      this.fetchSettings()
    ]);
  }
}
