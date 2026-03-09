import { Component, computed, ElementRef, inject, input, NgZone, signal, viewChild } from '@angular/core';

@Component({
  selector: 'app-tags-overflow',
  imports: [],
  templateUrl: './tags-overflow.component.html',
  styleUrl: './tags-overflow.component.scss'
})
export class TagsOverflowComponent {
  private ngZone = inject(NgZone);
  
  tags = input<string[]>([]);

  containerRef = viewChild<ElementRef<HTMLDivElement>>('container');
  measureRef = viewChild<ElementRef<HTMLDivElement>>('measure');

  fitCount = signal(0);

  visibleTags = computed(() => this.tags().slice(0, this.fitCount()));
  hiddenCount = computed(() => Math.max(0, this.tags().length - this.fitCount()));

  private resizeObserver?: ResizeObserver;
  private rafId: number | null = null;

  ngAfterViewInit(): void {
    const container = this.containerRef()?.nativeElement;
    if (!container) return;

    this.calculate();

    this.ngZone.runOutsideAngular(() => {
      this.resizeObserver = new ResizeObserver(() => {
        if (this.rafId !== null) cancelAnimationFrame(this.rafId);

        this.rafId = requestAnimationFrame(() => {
          this.ngZone.run(() => this.calculate());
        });
      });

      this.resizeObserver.observe(container);
    });
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
  }

  private calculate(): void {
    const container = this.containerRef()?.nativeElement;
    const measure = this.measureRef()?.nativeElement;
    const tags = this.tags();

    if (!container || !measure) return;

    if (!tags.length) {
      if (this.fitCount() !== 0) this.fitCount.set(0);
      return;
    }

    const containerWidth = container.clientWidth;
    if (!containerWidth) return;

    const gap = 8;
    const tagWidths = tags.map(tag => this.measureTag(tag, measure));

    let used = 0;
    let count = 0;

    for (let i = 0; i < tags.length; i++) {
      const nextWidth = tagWidths[i] + (i > 0 ? gap : 0);
      const remainingAfterThis = tags.length - (i + 1);

      const moreWidth =
        remainingAfterThis > 0
          ? this.measureTag(`+${remainingAfterThis}`, measure) + gap
          : 0;

      if (used + nextWidth + moreWidth <= containerWidth) {
        used += nextWidth;
        count++;
      } else {
        break;
      }
    }

    if (this.fitCount() !== count) this.fitCount.set(count);
  }

  private measureTag(text: string, measure: HTMLDivElement): number {
    const el = document.createElement('span');
    el.className = 'tag';
    el.textContent = text;
    measure.appendChild(el);

    const width = Math.ceil(el.getBoundingClientRect().width);
    el.remove();

    return width;
  }
}
