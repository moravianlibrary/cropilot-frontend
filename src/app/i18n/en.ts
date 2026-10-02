import { EN_COMMON } from './en/common';
import { EN_DASHBOARD } from './en/dashboard';
import { EN_DIALOGS } from './en/dialogs';
import { EN_EDITOR } from './en/editor';
import { EN_STATISTICS } from './en/statistics';

// English dictionary keyed by the Czech source string, split by UI area.
export const EN: Record<string, string> = {
  ...EN_COMMON,
  ...EN_DASHBOARD,
  ...EN_DIALOGS,
  ...EN_STATISTICS,
  ...EN_EDITOR,
};
