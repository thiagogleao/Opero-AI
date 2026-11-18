/**
 * A plain <a> with the Button look. The OAuth starts (/api/shopify/auth,
 * /api/facebook/auth) answer with a redirect to Shopify or Facebook, so they
 * need a full page load, not next/link's client navigation (which is what
 * ButtonLink does). The look is the ui Button's own classes, not a copy.
 */

import type { ReactNode } from 'react'
import { Icon, type IconName } from '@/components/ui'
import ui from '@/components/ui/Card.module.css'

export function AnchorButton({ href, children, icon, variant = 'secondary', size = 'sm' }: {
  href: string; children: ReactNode; icon?: IconName; variant?: 'primary' | 'secondary' | 'ghost'; size?: 'sm' | 'md'
}) {
  const v = variant === 'primary' ? ui.primary : variant === 'ghost' ? ui.ghost : ui.secondary
  return (
    <a href={href} className={`${ui.btn} ${v} ${size === 'sm' ? ui.btnSm : ''}`}>
      {icon && <Icon name={icon} size={size === 'sm' ? 13 : 15} />}
      {children}
    </a>
  )
}
