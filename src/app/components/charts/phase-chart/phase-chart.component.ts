import { Component, computed, input } from '@angular/core';
import { TPipe } from '../../../i18n/t.pipe';
import { SeriesTone } from '../chart-colors';

// One phase of a title's timeline: median duration and who "owns" the time.
// 'human-idle' is the human colour at reduced opacity (waiting, not working).
export interface PhaseRow {
  key: string;
  label: string;
  tooltip?: string;
  seconds: number;
  tone: SeriesTone | 'human-idle';
}

// Fixed logarithmic axis: the phases differ by orders of magnitude.
const AXIS_MIN_S = 10;
const AXIS_MAX_S = 86400;
const TICKS: { seconds: number; label: string }[] = [
  { seconds: 10, label: '10 s' },
  { seconds: 60, label: '1 min' },
  { seconds: 600, label: '10 min' },
  { seconds: 3600, label: '1 h' },
  { seconds: 86400, label: '1 den' }
];
const MIN_BAR_PCT = 1.5;

const logPct = (seconds: number): number => {
  const lo = Math.log10(AXIS_MIN_S);
  const hi = Math.log10(AXIS_MAX_S);
  if (seconds <= AXIS_MIN_S) return 0;
  return Math.min(100, ((Math.log10(seconds) - lo) / (hi - lo)) * 100);
};

// Horizontal bars of a title's phases on a log axis (10 s … 1 den), with gridlines.
@Component({
  selector: 'app-phase-chart',
  imports: [TPipe],
  templateUrl: './phase-chart.component.html',
  styleUrl: './phase-chart.component.scss'
})
export class PhaseChartComponent {
  rows = input.required<PhaseRow[]>();
  format = input.required<(seconds: number) => string>();
  emptyText = input<string>('Žádná data');

  ticks = TICKS.map(tick => ({ ...tick, pct: logPct(tick.seconds) }));

  bars = computed(() => this.rows().map(r => ({ ...r, pct: Math.max(MIN_BAR_PCT, logPct(r.seconds)) })));
}
