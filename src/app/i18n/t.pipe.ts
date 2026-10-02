import { Pipe, PipeTransform } from '@angular/core';
import { t } from './i18n';

// {{ 'Uložit' | t }} / {{ 'Sken {n} z {total}' | t: { n, total } }}
// Impure so the text updates when the language changes; the lookup is a single
// object read, cheap enough to run every change detection.
@Pipe({ name: 't', pure: false })
export class TPipe implements PipeTransform {
  transform(text: string | null | undefined, params?: Record<string, unknown>): string {
    return t(text ?? '', params);
  }
}
