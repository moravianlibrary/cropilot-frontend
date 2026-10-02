import { computed, signal } from '@angular/core';
import { EN } from './en';

// UI localization. Czech is the source language: every UI string stays written
// in Czech in the code and that Czech text is the lookup key into the English
// dictionary (src/app/i18n/en/). A string missing from the dictionary falls back
// to Czech, so an untranslated string never breaks the UI.
//
// Usage:
//   template:  {{ 'Uložit' | t }}   {{ 'Sken {n} z {total}' | t: { n: 1, total: 9 } }}
//   code:      t('Uložit'),  plural(count, '{n} titul', '{n} tituly', '{n} titulů')
//
// `t()` reads the `lang` signal, so computed()s, effects and templates that call
// it re-render when the language changes.

export type Lang = 'cs' | 'en';
export const LANGS: Lang[] = ['cs', 'en'];

const STORAGE_KEY = 'lang';

const readStoredLang = (): Lang => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === 'en' ? 'en' : 'cs';
  } catch {
    return 'cs';
  }
};

export const lang = signal<Lang>(readStoredLang());

// BCP 47 locale for Intl / toLocale* formatting.
export const locale = computed(() => lang() === 'en' ? 'en-GB' : 'cs-CZ');

export const setLang = (value: Lang): void => {
  lang.set(value);
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // Storage unavailable (private mode): the choice lasts for this session only.
  }
  document.documentElement.lang = value;
};

document.documentElement.lang = lang();

const interpolate = (text: string, params?: Record<string, unknown>): string => {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (match, key) => key in params ? String(params[key] ?? '') : match);
};

// Translates a Czech source string to the current language.
export const t = (text: string, params?: Record<string, unknown>): string => {
  if (text == null || text === '') return text ?? '';
  const translated = lang() === 'en' ? (EN[text] ?? text) : text;
  return interpolate(translated, params);
};

// Pluralized string. Pass the three Czech forms (1 / 2–4 / 0, 5+); `{n}` is
// replaced by the count. English uses the translation of `one` for 1 and of
// `many` otherwise, so the dictionary needs entries for those two forms.
export const plural = (
  n: number,
  one: string,
  few: string,
  many: string,
  params?: Record<string, unknown>
): string => {
  const all = { n, ...params };
  if (lang() === 'en') return t(n === 1 ? one : many, all);
  const abs = Math.abs(n);
  return t(abs === 1 ? one : abs >= 2 && abs <= 4 ? few : many, all);
};
