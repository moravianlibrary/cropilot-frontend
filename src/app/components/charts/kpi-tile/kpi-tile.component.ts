import { Component, input } from '@angular/core';

// Headline number with a label (and optional hint), used in the statistics page.
@Component({
  selector: 'app-kpi-tile',
  template: `
    <div class="kpi">
      <span class="label">{{ label() }}</span>
      <span class="value">{{ value() }}</span>
      @if (hint()) {
        <span class="hint">{{ hint() }}</span>
      }
    </div>
  `,
  styleUrl: './kpi-tile.component.scss'
})
export class KpiTileComponent {
  label = input.required<string>();
  value = input.required<string | number>();
  hint = input<string>('');
}
