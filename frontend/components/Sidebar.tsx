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
      <Link href="/" style={{ textDecoration: 'none', marginBottom: 8 }}>
        <div style={{
          width: 32, height: 32, borderRadius: 8,
          background: 'linear-gradient(135deg,#8B5CF6,#6D28D9)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 16, fontWeight: 700, color: 'white',
        }}>O</div>
      </Link>

      {NAV.map(item => (
        <Link key={item.href} href={item.href} title={item.title} style={{ textDecoration: 'none' }}>
          <div style={{
            width: 36, height: 36, borderRadius: 8, display: 'flex',
            alignItems: 'center', justifyContent: 'center', fontSize: 17, cursor: 'pointer',
            background: active === item.href ? 'rgba(139,92,246,0.15)' : 'transparent',
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
