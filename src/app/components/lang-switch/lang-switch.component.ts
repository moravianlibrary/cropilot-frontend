import { Component, computed, input } from '@angular/core';
import { lang, setLang } from '../../i18n/i18n';

// Small, unobtrusive language toggle in the dashboard top panel. Shows the
// language it switches to.
@Component({
  selector: 'app-lang-switch',
  templateUrl: './lang-switch.component.html',
  styleUrl: './lang-switch.component.scss',
})
export class LangSwitchComponent {
  tabindex = input<number>(0);

  target = computed(() => lang() === 'cs' ? 'en' : 'cs');
  // Labels stay in the target language so a user who can't read the current
  // one still recognizes the toggle.
  label = computed(() => this.target() === 'en' ? 'Switch to English' : 'Přepnout do češtiny');

  toggle(): void {
    setLang(this.target());
  }
}
