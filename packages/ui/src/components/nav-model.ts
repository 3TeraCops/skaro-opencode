import type { IconName } from '../icons.ts';

export interface NavItem {
  id: string;
  label: string;
  icon: IconName;
  tip?: string;
  count?: number;
  countTip?: string;
  /** Tooltip of the collapsed rail item when the count is shown. */
  railTip?: string;
  separated?: boolean;
  /** Optional right-aligned text of a footer action (including "0%"). */
  trailing?: string;
}
