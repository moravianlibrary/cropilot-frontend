import { Component, ElementRef, forwardRef, input, computed, signal, inject, output, viewChild } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { SelectOption } from '../../app.types';
import { DashboardService } from '../../services/dashboard.service';
import { OverlayScrollbars } from 'overlayscrollbars';
import { waitForElement } from '../../utils/utils';

@Component({
  selector: 'app-select',
  imports: [],
  templateUrl: './select.component.html',
  styleUrls: ['./select.component.scss'],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => SelectComponent),
      multi: true,
    },
  ],
})
export class SelectComponent implements ControlValueAccessor {
  dashSvc = inject(DashboardService);
  
  maxDropdownHeight = input<number>(240);
  inputName = input<string>('');
  options = input<SelectOption[]>([]);
  placeholder = input<string>('');
  usedIn = input<boolean>(false);
  usedOut = output<boolean>();

  selectWrapper = viewChild<ElementRef<HTMLDivElement>>('selectWrapper');
  comboInput = viewChild<ElementRef<HTMLInputElement>>('comboInput');
  private osInstance?: ReturnType<typeof OverlayScrollbars>;

  paddingRight = signal<number>(16);
  isOpen = signal<boolean>(false);
  value = signal<number | string>(0);
  label = signal<string>('');

  displayedLabel = computed<string>(() => {
    const label = this.label();
    const selectedOption = this.selectedOption();
    return this.isOpen()
      ? label
      : selectedOption ? selectedOption.label : '';
  });

  selectedOption = computed<SelectOption | undefined>(() => {
    if (this.placeholder() && !this.usedIn()) return undefined;
    return this.options().find(o => o.value === this.value());
  });

  filteredOptions = computed<SelectOption[]>(() => {
    const label = this.label().trim().toLowerCase();
    const opts = this.options();
    if (!label) return opts;
    return opts.filter(o => o.label.toLowerCase().includes(label));
  });

  private onChange: (v: number | string | null) => void = () => {};
  private onTouched: () => void = () => {};

  writeValue(v: number | null): void {
    this.value.set(v ?? 0);
  }
  registerOnChange(fn: any): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: any): void {
    this.onTouched = fn;
  }

  async open(): Promise<void> {
    this.isOpen.set(true);
    this.label.set('');

    const items = await waitForElement('.items', this.selectWrapper()?.nativeElement);
      
    this.osInstance = OverlayScrollbars(items, {
      overflow: { x: 'hidden', y: 'scroll' },
      scrollbars: {
        theme: 'os-theme-orezy',
        dragScroll: true,
        clickScroll: true,
      },
    });
    items.classList.remove('os-pending');

    const hasScrollbar = this.osInstance.state().hasOverflow.y;
    if (hasScrollbar) {
      this.paddingRight.set(26);
    }
  }

  close(): void {
    this.isOpen.set(false);
    this.onTouched();
  }

  select(opt: SelectOption): void {
    this.value.set(opt.value);
    this.onChange(opt.value);
    this.label.set(opt.label);
    this.usedOut.emit(true);
    this.blur();
  }

  focus(): void {
    this.comboInput()?.nativeElement.focus();
  }

  blur(): void {
    this.comboInput()?.nativeElement.blur();
  }

  onInput(e: Event): void {
    const v = (e.target as HTMLInputElement).value;
    this.label.set(v);
    if (!this.usedIn()) this.usedOut.emit(true);
  }

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      this.blur();
      return;
    }
  }
}