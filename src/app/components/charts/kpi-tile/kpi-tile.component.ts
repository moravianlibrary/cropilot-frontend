import { Component, input } from '@angular/core';
import { SparklineComponent } from '../sparkline/sparkline.component';

// Change against the previous period: "▼ 12 %" + "vs. 7. 9. – 6. 10.".
export interface KpiDelta {
  text: string;
  vs: string;
  tone: 'good' | 'bad' | 'neutral';
}

// Headline number with a label, used in the statistics page. Optional hint line,
// small-sample tag next to the value, delta vs. the previous period and sparkline.
@Component({
  selector: 'app-kpi-tile',
  imports: [SparklineComponent],
  template: `
    <div class="kpi" [class.hero]="hero()" [attr.title]="tooltip() || null">
      <span class="label">{{ label() }}</span>
      <span class="value">
        {{ value() }}
        @if (tag()) {
          <span class="tag">{{ tag() }}</span>
        }
      </span>
      @if (hint()) {
        <span class="hint">{{ hint() }}</span>
      }
      @let sparkValues = spark();
      @if (delta() || sparkValues?.length) {
        <div class="foot">
          @if (delta(); as d) {
            <span class="delta" [class.good]="d.tone === 'good'" [class.bad]="d.tone === 'bad'">{{ d.text }} <span class="vs">{{ d.vs }}</span></span>
          } @else {
            <span></span>
          }
          @if (sparkValues?.length) {
            <app-sparkline [values]="sparkValues!" />
          }
        </div>
      }
    </div>
  `,
  styleUrl: './kpi-tile.component.scss'
})
export class KpiTileComponent {
  label = input.required<string>();
  value = input.required<string | number>();
  hint = input<string>('');
  // Definition of the metric (native tooltip of the tile).
  tooltip = input<string>('');
  // Highlighted tile with a bigger number (the one headline of the page).
  hero = input<boolean>(false);
  // Muted tag next to the value, e.g. "málo dat".
  tag = input<string>('');
  delta = input<KpiDelta | null>(null);
  spark = input<number[] | null>(null);
}
