import { Component, computed, input } from '@angular/core';
import { TPipe } from '../../../i18n/t.pipe';

export interface BarDatum {
  label: string;
  value: number;
  hint?: string;
}

// Multi-series mode: one group of bars per category, one bar per series.
export interface BarSeries {
  label: string;
  color: string;
}

export interface BarGroup {
  label: string;
  // One value per series (null = no bar).
  values: (number | null)[];
}

// Minimal CSS bar chart, no external dependency. Single series: `data`
// (vertical columns or horizontal rows). Multiple series: `series` + `groups`
// (vertical columns with a value axis, value labels and hover tooltips).
@Component({
  selector: 'app-bar-chart',
  imports: [TPipe],
  templateUrl: './bar-chart.component.html',
  styleUrl: './bar-chart.component.scss',
  host: {
    '[class.horizontal]': 'horizontal()'
  }
})
export class BarChartComponent {
  data = input<BarDatum[]>([]);
  series = input<BarSeries[]>([]);
  groups = input<BarGroup[]>([]);
  horizontal = input<boolean>(false);
  showValues = input<boolean>(true);
  height = input<number>(160);
  emptyText = input<string>('Žádná data');
  // Optional formatter for the displayed values (default: raw number).
  format = input<((value: number) => string) | undefined>(undefined);
  // Formatter of the axis ticks in multi-series mode (default: `format`).
  tickFormat = input<((value: number) => string) | undefined>(undefined);

  grouped = computed<boolean>(() => this.series().length > 0);

  isEmpty = computed<boolean>(() => this.grouped()
    ? !this.groups().some(g => g.values.some(v => v !== null && v !== undefined))
    : !this.data().length
  );

  max = computed<number>(() => Math.max(0, ...this.data().map(d => d.value)));

  // Axis of the multi-series chart: "nice" step (1 / 2 / 2.5 / 5 × 10^k), ~3 ticks.
  axis = computed<{ max: number; ticks: number[] }>(() => {
    const values = this.groups().flatMap(g => g.values).filter((v): v is number => v !== null && v !== undefined);
    const max = Math.max(0, ...values);
    if (max <= 0) return { max: 1, ticks: [1] };
    const rough = max / 3;
    const pow = 10 ** Math.floor(Math.log10(rough));
    const candidates = [1, 2, 2.5, 5, 10].map(c => c * pow);
    const step = candidates.find(c => c >= rough) ?? candidates[candidates.length - 1];
    const top = Math.ceil(max / step - 1e-9) * step;
    const ticks: number[] = [];
    for (let v = step; v <= top + 1e-9; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
    return { max: top, ticks };
  });

  fmtValue(value: number): string {
    return this.format()?.(value) ?? String(value);
  }

  fmtTick(value: number): string {
    return (this.tickFormat() ?? this.format())?.(value) ?? String(value);
  }

  percent(value: number): number {
    const max = this.max();
    return max > 0 ? Math.round((value / max) * 1000) / 10 : 0;
  }

  axisPercent(value: number | null | undefined): number {
    if (value === null || value === undefined) return 0;
    return Math.round((value / this.axis().max) * 1000) / 10;
  }
}
