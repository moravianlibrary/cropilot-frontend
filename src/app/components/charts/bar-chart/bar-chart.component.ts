import { Component, computed, input } from '@angular/core';

export interface BarDatum {
  label: string;
  value: number;
  hint?: string;
}

// Minimal CSS bar chart (vertical or horizontal), no external dependency.
@Component({
  selector: 'app-bar-chart',
  templateUrl: './bar-chart.component.html',
  styleUrl: './bar-chart.component.scss',
  host: {
    '[class.horizontal]': 'horizontal()'
  }
})
export class BarChartComponent {
  data = input.required<BarDatum[]>();
  horizontal = input<boolean>(false);
  showValues = input<boolean>(true);
  height = input<number>(160);
  emptyText = input<string>('Žádná data');

  max = computed<number>(() => Math.max(0, ...this.data().map(d => d.value)));

  percent(value: number): number {
    const max = this.max();
    return max > 0 ? Math.round((value / max) * 1000) / 10 : 0;
  }
}
