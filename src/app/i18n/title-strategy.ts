import { effect, inject, Injectable } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterStateSnapshot, TitleStrategy } from '@angular/router';
import { lang, t } from './i18n';

// Route `title`s are Czech source strings; translate them and re-apply on a
// language change.
@Injectable({ providedIn: 'root' })
export class TranslatedTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);
  private current = '';

  constructor() {
    super();
    effect(() => {
      lang();
      if (this.current) this.title.setTitle(t(this.current));
    });
  }

  override updateTitle(snapshot: RouterStateSnapshot): void {
    const title = this.buildTitle(snapshot);
    if (title === undefined) return;
    this.current = title;
    this.title.setTitle(t(title));
  }
}
