import { computed, Directive, ElementRef, inject, input, signal } from '@angular/core';
import { SortDirection, SortField } from '../app.types';

@Directive({
  selector: '[thTooltip]',
  host: {
    '(click)': 'startTooltip()',
    '(mousemove)': 'startTooltip()',
    '(mouseleave)': 'cancelTooltip()',
  }
})
export class ThTooltipDirective {
  direction = input<SortDirection>(null);
  activeField = input<SortField>(null);
  private text = computed(() => {
    const direction = this.direction();
    const activeField = this.activeField();
    
    // Date
    if (['created_at', 'modified_at'].includes(activeField ?? '')) {
      return direction === 'asc'
        ? 'Řazení od nejstarších'
        : (direction === 'desc'
          ? 'Řazení od nejnovějších'
          : 'Žádné řazení'
        )
    }

    // Text
    return direction === 'asc'
      ? 'Řazení Z-A'
      : (direction === 'desc'
        ? 'Řazení A-Z'
        : 'Žádné řazení'
      )
  });

  private el = inject<ElementRef<HTMLElement>>(ElementRef);
  private tooltip?: HTMLElement;
  private timer?: ReturnType<typeof setTimeout>;
  private visible = signal<boolean>(false);

  startTooltip() {
    if (this.visible() || this.timer) this.cancelTooltip();
    this.timer = setTimeout(() => this.show(), 3000);
  }

  cancelTooltip() {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.hide();
  }

  private show() {
    this.visible.set(true);

    const dateSortWrapper = this.el.nativeElement;
    const rect = dateSortWrapper.getBoundingClientRect();

    this.tooltip = document.createElement('div');
    this.tooltip.className = 'th-tooltip';
    this.tooltip.textContent = this.text();

    document.body.appendChild(this.tooltip);

    const tooltipRect = this.tooltip.getBoundingClientRect();

    const right = rect.right - tooltipRect.width / 2 - 8;
    const top = rect.bottom + 8;

    this.tooltip.style.left = `${right}px`;
    this.tooltip.style.top = `${top}px`;
  }

  private hide() {
    if (this.tooltip) {
      this.tooltip.remove();
      this.tooltip = undefined;
    }

    this.visible.set(false);
  }
}
