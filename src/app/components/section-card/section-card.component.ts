import { Component, input, model, output } from '@angular/core';
import { IconComponent } from '../icon/icon.component';

// Bold number + unit shown in the header line, e.g. "3 otevření".
export interface SectionSummaryItem {
  value: string;
  label: string;
}

// Collapsible card: heading with a chevron, numeric summary and a quiet export
// icon in the header; the projected body is shown only while open.
@Component({
  selector: 'app-section-card',
  imports: [IconComponent],
  templateUrl: './section-card.component.html',
  styleUrl: './section-card.component.scss'
})
export class SectionCardComponent {
  title = input.required<string>();
  summary = input<SectionSummaryItem[]>([]);
  open = model<boolean>(true);
  // Title of the export icon; the icon is hidden when empty.
  exportLabel = input<string>('');
  exportDisabled = input<boolean>(false);
  exportClick = output<void>();

  toggle(): void {
    this.open.set(!this.open());
  }
}
