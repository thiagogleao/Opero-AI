/**
 * The app shell. Pages use AppShell + PageHeader (+ PeriodNote); the pickers
 * are exported for special layouts. SERVER COMPONENTS ONLY: Freshness reads
 * the database, so a client component must import a picker from its own file
 * (e.g. '@/components/shell/StorePicker'), never from this barrel.
 */
import 'server-only'
export { AppShell, Logo } from './AppShell'
export { PageHeader, PeriodNote, periodName, periodNoteText } from './PageHeader'
export { Freshness, FreshnessFallback } from './Freshness'
export { StorePicker, type StorePickerProps } from './StorePicker'
export { PeriodPicker, type PeriodPickerProps, type PeriodOption } from './PeriodPicker'
export { SplitToggle } from './SplitToggle'
export { ViewerIndicator } from './ViewerIndicator'
export { NavLinks, type NavItem } from './NavLinks'
export { mergeQuery, hrefFor } from './url'
