// Data colours of the statistics charts: one colour per "owner" of the time,
// consistent across the timeline, the monthly chart and the legends.
export const SERIES_COLORS = {
  human: 'var(--primary)',
  machine: 'var(--bg-contrast)',
  integration: '#7367A8'
} as const;

export type SeriesTone = keyof typeof SERIES_COLORS;
