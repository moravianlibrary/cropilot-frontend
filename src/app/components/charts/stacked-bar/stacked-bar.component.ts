import { Component, computed, input } from '@angular/core';
import { TPipe } from '../../../i18n/t.pipe';
import { locale, plural, t } from '../../../i18n/i18n';

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
  imports: [TPipe],
  templateUrl: './stacked-bar.component.html',
  styleUrl: './stacked-bar.component.scss',
  host: {
    '[class.inline]': 'inline()'
  }
})
export class StackedBarComponent {
  segments = input.required<StackedSegment[]>();
  showLegend = input<boolean>(true);
  // Bar and legend on one line (compact strips) instead of legend below.
  inline = input<boolean>(false);
  emptyText = input<string>('Žádná data');

  total = computed<number>(() => this.segments().reduce((sum, s) => sum + s.value, 0));

  ariaLabel = computed<string>(() => {
    const n = this.segments().length;
    return plural(n, '{n} hodnota', '{n} hodnoty', '{n} hodnot');
  });

  colored = computed(() => this.segments()
    .filter(s => s.value > 0)
    .map((s, i) => ({ ...s, color: s.color ?? PALETTE[i % PALETTE.length], pct: this.pct(s.value) }))
  );

  pct(value: number): number {
    const total = this.total();
    return total > 0 ? Math.round((value / total) * 1000) / 10 : 0;
  }

  // Locale decimal separator and percent spacing for the legend / tooltip
  fmtPct(pct: number): string {
    return t('{value} %', { value: new Intl.NumberFormat(locale(), { maximumFractionDigits: 1 }).format(pct) });
  }
}
