'use client'
import Link from 'next/link'
import { UserButton } from '@clerk/nextjs'

type ActivePath = '/' | '/profit' | '/settings' | '/products' | '/campaigns'

interface Props {
  active: ActivePath
}

const NAV = [
  { icon: '📊', href: '/',          title: 'Dashboard'  },
  { icon: '📦', href: '/products',  title: 'Produtos'   },
  { icon: '📣', href: '/campaigns', title: 'Campanhas'  },
  { icon: '💰', href: '/profit',    title: 'Lucro'      },
  { icon: '⚙️', href: '/settings',  title: 'Config'     },
] as const

export default function Sidebar({ active }: Props) {
  return (
    <aside style={{
      width: 56, minHeight: '100vh', background: 'var(--bg-sidebar)',
      borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column',
      alignItems: 'center', paddingTop: 16, gap: 4,
      position: 'fixed', left: 0, top: 0, zIndex: 10,
    }}>
      <Link href="/" style={{ textDecoration: 'none', marginBottom: 8 }} title="Opero AI">
        <svg width="32" height="32" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 33 C14 26 28 14 37 16 L37 34 L12 34 Z" fill="rgba(16,185,129,0.09)"/>
          <circle cx="24" cy="24" r="19" stroke="#10b981" strokeWidth="2.5" fill="none"/>
          <path d="M12 33 C14 26 28 14 37 16" stroke="#10b981" strokeWidth="2.2" strokeLinecap="round" fill="none"/>
          <circle cx="37" cy="16" r="2.6" fill="#10b981"/>
        </svg>
      </Link>

      {NAV.map(item => (
        <Link key={item.href} href={item.href} title={item.title} style={{ textDecoration: 'none' }}>
          <div style={{
            width: 36, height: 36, borderRadius: 8, display: 'flex',
            alignItems: 'center', justifyContent: 'center', fontSize: 17, cursor: 'pointer',
            background: active === item.href ? 'rgba(16,185,129,0.12)' : 'transparent',
            transition: 'background 0.15s',
          }}>{item.icon}</div>
        </Link>
      ))}

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
