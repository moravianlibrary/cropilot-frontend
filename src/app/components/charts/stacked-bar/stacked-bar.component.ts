import { Component, computed, input } from '@angular/core';

export interface StackedSegment {
  label: string;
  value: number;
  color?: string;
}

const PALETTE = [
  'var(--primary)',
  'var(--bg-contrast)',
  'var(--status-icon-success)',
  'var(--status-icon-warning)',
  'var(--status-icon-edited)',
  'var(--status-icon-error)',
  'var(--status-icon-info)',
  'var(--text-bright)'
];

// One 100 % horizontal bar showing a distribution, with a legend.
@Component({
  selector: 'app-stacked-bar',
  templateUrl: './stacked-bar.component.html',
  styleUrl: './stacked-bar.component.scss'
})
export class StackedBarComponent {
  segments = input.required<StackedSegment[]>();
  showLegend = input<boolean>(true);
  emptyText = input<string>('Žádná data');

  total = computed<number>(() => this.segments().reduce((sum, s) => sum + s.value, 0));

  colored = computed(() => this.segments()
    .filter(s => s.value > 0)
    .map((s, i) => ({ ...s, color: s.color ?? PALETTE[i % PALETTE.length], pct: this.pct(s.value) }))
  );

  pct(value: number): number {
    const total = this.total();
    return total > 0 ? Math.round((value / total) * 1000) / 10 : 0;
  }

  // Czech decimal comma for the legend / tooltip
  fmtPct(pct: number): string {
    return new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 1 }).format(pct);
  }
}
