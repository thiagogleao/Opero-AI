'use client'
import Link from 'next/link'
import { UserButton } from '@clerk/nextjs'

interface Props {
  active: '/' | '/profit' | '/settings'
}

const NAV = [
  { icon: '📊', href: '/'        },
  { icon: '💰', href: '/profit'  },
  { icon: '⚙️', href: '/settings'},
] as const

export default function Sidebar({ active }: Props) {
  return (
    <aside style={{
      width: 56, minHeight: '100vh', background: 'var(--bg-sidebar)',
      borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column',
      alignItems: 'center', paddingTop: 16, gap: 8,
      position: 'fixed', left: 0, top: 0, zIndex: 10,
    }}>
      <Link href="/" style={{ textDecoration: 'none' }}>
        <div style={{
          width: 32, height: 32, borderRadius: 8,
          background: 'linear-gradient(135deg,#8B5CF6,#6D28D9)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 16, fontWeight: 700, color: 'white', marginBottom: 8,
        }}>O</div>
      </Link>

      {NAV.map(item => (
        <Link key={item.href} href={item.href} style={{ textDecoration: 'none' }}>
          <div style={{
            width: 36, height: 36, borderRadius: 8, display: 'flex',
            alignItems: 'center', justifyContent: 'center', fontSize: 17, cursor: 'pointer',
            background: active === item.href ? 'rgba(139,92,246,0.15)' : 'transparent',
          }}>{item.icon}</div>
        </Link>
      ))}

      {/* Spacer + UserButton at bottom */}
      <div style={{ flex: 1 }} />
      <div style={{ marginBottom: 16 }}>
        <UserButton
          appearance={{
            elements: {
              avatarBox: { width: 32, height: 32 },
              userButtonPopoverCard: { background: 'var(--bg-surface)', border: '1px solid var(--border)' },
            }
          }}
        />
      </div>
    </aside>
  )
}
