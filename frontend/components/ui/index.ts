/**
 * Opero v2 UI primitives. Import from '@/components/ui'. Each file's header
 * documents its props; the styleguide at /dev/ui shows every one with real
 * data. Client components (InfoTip, DataTable, Segmented, ClientTabs) are
 * marked 'use client' and can be used from server components.
 */
export { Icon, type IconName, type IconProps } from './Icon'
export { Chip, VerdictChips, Badge, StatusDot, CodePill, type ChipTone, type ChipProps, type BadgeProps } from './Chip'
export {
  Card, Block, Button, ButtonLink, Callout, EmptyState, ErrorState, Skeleton, SkeletonBlock, Avatar, initials,
  type CardProps, type BlockProps, type ButtonProps, type ButtonLinkProps,
} from './Card'
export { InfoTip, useIsClient, type InfoTipProps } from './InfoTip'
export { Money, Pct, Roas, Count, Delta, RichLine, type DeltaProps } from './Display'
export { KpiCard, KpiGrid, type KpiCardProps } from './KpiCard'
export { RoasGauge, type RoasGaugeProps } from './RoasGauge'
export { BreakdownBar, BreakdownLedger, type BreakdownLedgerProps, type LedgerKey } from './Breakdown'
export { VerdictCard, type VerdictCardProps } from './VerdictCard'
export { DataTable, type DataColumn, type DataRow, type DataTableProps } from './DataTable'
export { Tabs, SegmentedLinks, type TabLink } from './Tabs'
export { Segmented, ClientTabs, type SegmentedProps, type ClientTabsProps } from './Segmented'
