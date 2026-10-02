// Formatting helpers for the statistics page (current UI locale).
import { locale } from '../i18n/i18n';

// Formatters are cached per locale + digits; locale() is a signal, so callers in
// computed()s / templates re-run on a language switch.
const formatters = new Map<string, Intl.NumberFormat>();
const nf = (digits: number): Intl.NumberFormat => {
  const loc = locale();
  const key = `${loc}|${digits}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat(loc, { minimumFractionDigits: digits, maximumFractionDigits: digits });
    formatters.set(key, f);
  }
  return f;
};

// Czech puts a space before "%", English does not.
const pctSuffix = (): string => locale() === 'cs-CZ' ? ' %' : '%';

export const fmtNum = (value: number | null | undefined, digits = 0): string =>
  value === null || value === undefined || Number.isNaN(value) ? '–' : nf(digits).format(value);

// 0.1234 -> "12 %" (cs) / "12%" (en)
export const fmtPct = (ratio: number | null | undefined, digits = 0): string =>
  ratio === null || ratio === undefined || Number.isNaN(ratio) ? '–' : `${nf(digits).format(ratio * 100)}${pctSuffix()}`;

// 3725 -> "1 h 2 min"; 90 -> "1 min 30 s"
export const fmtDuration = (seconds: number | null | undefined): string => {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return '–';
  const s = Math.round(seconds);
  if (s < 60) return `${s} s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return `${h} h ${m} min`;
  return s % 60 ? `${m} min ${s % 60} s` : `${m} min`;
};

// Date -> "YYYY-MM-DD" in local time (what the API date filters expect)
export const toIsoDate = (date: Date): string => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

export const isoDaysAgo = (days: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return toIsoDate(d);
};

export const isoToday = (): string => toIsoDate(new Date());
