import { Component, input, output } from '@angular/core';
import { IconComponent } from '../icon/icon.component';

export type SegmentedControlValue = string | number;
export type SegmentedControlVariant = 'default' | 'lines' | 'swatches';
export type SegmentedControlSize = 'small' | 'medium';

export interface SegmentedControlOption {
  value: SegmentedControlValue;
  label: string;
  ariaLabel?: string;
  icon?: string;
  iconSize?: number;
  color?: string;
  lineWidth?: number;
  disabled?: boolean;
}

@Component({
  selector: 'app-segmented-control',
  imports: [IconComponent],
  templateUrl: './segmented-control.component.html',
  styleUrl: './segmented-control.component.scss',
  host: {
    '[class.segmented-control-fit]': 'fit()'
  }
})
export class SegmentedControlComponent {
  options = input.required<readonly SegmentedControlOption[]>();
  value = input<SegmentedControlValue | null>(null);
  ariaLabel = input<string>('');
  variant = input<SegmentedControlVariant>('default');
  size = input<SegmentedControlSize>('medium');
  fit = input<boolean>(false);

  valueChange = output<SegmentedControlValue>();

  select(option: SegmentedControlOption): void {
    if (!option.disabled && option.value !== this.value()) {
      this.valueChange.emit(option.value);
    }
  }
}
