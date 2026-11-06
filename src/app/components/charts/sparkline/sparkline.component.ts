import { Component, computed, input } from '@angular/core';

// Tiny trend line without axes: grey polyline, last point marked in primary.
@Component({
  selector: 'app-sparkline',
  template: `
    <svg [attr.viewBox]="'0 0 ' + width() + ' ' + height()" [attr.width]="width()" [attr.height]="height()" aria-hidden="true">
      <polyline class="line" [attr.points]="points()" />
      <circle class="dot" [attr.cx]="last().x" [attr.cy]="last().y" r="3" />
    </svg>
  `,
  styles: `
    :host { display: inline-block; flex: 0 0 auto; line-height: 0; }
    svg { display: block; }
    .line { fill: none; stroke: var(--text-bright); stroke-width: 1.5; stroke-linejoin: round; stroke-linecap: round; }
    .dot { fill: var(--primary); }
  `
})
export class SparklineComponent {
  values = input.required<number[]>();
  width = input<number>(84);
  height = input<number>(28);

  private coords = computed(() => {
    const values = this.values();
    const w = this.width();
    const h = this.height();
    const pad = 4;
    if (!values.length) return [];
    const min = Math.min(...values);
    const span = Math.max(...values) - min;
    const stepX = values.length > 1 ? (w - 2 * pad) / (values.length - 1) : 0;
    return values.map((v, i) => ({
      x: pad + i * stepX,
      y: span ? h - pad - ((v - min) / span) * (h - 2 * pad) : h / 2
    }));
  });

  points = computed<string>(() => this.coords().map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '));
  last = computed(() => this.coords().at(-1) ?? { x: 0, y: 0 });
}
