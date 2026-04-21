import { Component, ElementRef, forwardRef, input, computed, signal, inject, output, viewChild, viewChildren } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { SelectOption } from '../../app.types';
import { OverlayScrollbars } from 'overlayscrollbars';
import { scrollToElement, waitForElement } from '../../utils/utils';
import { UiService } from '../../services/ui.service';

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
  uiSvc = inject(UiService);
  
  maxDropdownHeight = input<number>(240);
  inputName = input<string>('');
  location = input<string>('');
  options = input<SelectOption[]>([]);
  placeholder = input<string>('');
  usedIn = input<boolean>(false);
  usedOut = output<boolean>();

  selectWrapper = viewChild<ElementRef<HTMLDivElement>>('selectWrapper');
  comboInput = viewChild<ElementRef<HTMLInputElement>>('comboInput');
  selectOptionsButtons = viewChildren<ElementRef<HTMLButtonElement>>('item');
  private osInstance?: ReturnType<typeof OverlayScrollbars>;

  paddingRight = signal<number>(16);
  isOpen = signal<boolean>(false);
  value = signal<number | string>(0);
  private label = signal<string>('');

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

  private browsingIndex = signal<number | null>(null);
  browsingOption = computed<SelectOption | null>(() => {
    const browsingIndex = this.browsingIndex();
    return browsingIndex !== null
    ? this.filteredOptions()[browsingIndex]
    : null;
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
    this.browsingIndex.set(null);

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

  private isHandledKey(key: string): boolean {
    return [
      'Escape',
      'ArrowUp', 'ArrowDown',
      'Enter'
    ].includes(key);
  }

  onKeyDown(e: KeyboardEvent): void {
    if (!this.isHandledKey(e.key)) return;
    e.preventDefault();
    
    if (e.key === 'Escape') {
      this.blur();
      return;
    }

    if (['ArrowUp', 'ArrowDown'].includes(e.key)) {
      const filteredOptions = this.filteredOptions();

      if (e.key === 'ArrowDown') {
        this.browsingIndex.update(prev => prev === null || prev === filteredOptions.length - 1 ? 0 : prev + 1);
      }

      if (e.key === 'ArrowUp') {
        this.browsingIndex.update(prev => !prev ? filteredOptions.length - 1 : prev - 1);
      }

      scrollToElement(this.selectOptionsButtons()[this.browsingIndex() ?? 0].nativeElement);

      return;
    }

    if (e.key === 'Enter') {
      const browsingOption = this.browsingOption();
      if (browsingOption) this.select(browsingOption);
      return;
    }
  }
}