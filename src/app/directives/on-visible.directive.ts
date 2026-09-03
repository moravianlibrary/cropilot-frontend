import { Directive, effect, ElementRef, inject, input, OnDestroy, output } from '@angular/core';

// Emits `appOnVisible` once when the host element first scrolls into view.
// Changing `appOnVisibleKey` re-arms the observer so the host can be notified
// again (e.g. a lazily loaded thumbnail whose cache entry was forgotten).
@Directive({ selector: '[appOnVisible]' })
export class OnVisibleDirective implements OnDestroy {
  key = input<unknown>(undefined, { alias: 'appOnVisibleKey' });
  appOnVisible = output<void>();

  private el = inject(ElementRef<HTMLElement>);
  private observer?: IntersectionObserver;

  private rearm = effect(() => {
    this.key();
    this.observe();
  });

  private observe(): void {
    this.observer?.disconnect();
    this.observer = new IntersectionObserver(entries => {
      if (!entries.some(e => e.isIntersecting)) return;
      this.observer?.disconnect();
      this.appOnVisible.emit();
    });
    this.observer.observe(this.el.nativeElement);
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }
}
