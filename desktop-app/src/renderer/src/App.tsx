import { useEffect, useState } from 'react'
import Briefing from './pages/Briefing'
import Home from './pages/Home'
import Dashboard from './pages/Dashboard'
import PersonalFinance from './pages/PersonalFinance'

type Route = 'briefing' | 'home' | 'dashboard' | 'finance'

function getRoute(): Route {
  const hash = window.location.hash.replace('#', '')
  if (hash === 'briefing') return 'briefing'
  if (hash === 'dashboard') return 'dashboard'
  if (hash === 'finance') return 'finance'
  return 'home'
}

function NavBar({ route }: { route: Route }) {
  const tabs: { id: Route; label: string }[] = [
    { id: 'home',      label: '🏠 Início' },
    { id: 'dashboard', label: '📊 Lojas' },
    { id: 'finance',   label: '💰 Finanças' },
  ]

  return (
    <div style={{
      display: 'flex', gap: 4, padding: '0 20px',
      background: '#0d0d10', borderBottom: '1px solid #1a1a26',
      WebkitAppRegion: 'drag' as any,
    }}>
      {tabs.map(t => (
        <button
          key={t.id}
          onClick={() => { window.location.hash = t.id }}
          style={{
            background: 'none',
            border: 'none',
            borderBottom: route === t.id ? '2px solid #22c55e' : '2px solid transparent',
            color: route === t.id ? '#fff' : '#555',
            padding: '10px 14px',
            fontSize: 13,
            fontWeight: route === t.id ? 600 : 400,
            cursor: 'pointer',
            WebkitAppRegion: 'no-drag' as any,
            transition: 'color 0.15s',
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

export default function App() {
  const [route, setRoute] = useState<Route>(getRoute)

  useEffect(() => {
    const onHash = () => setRoute(getRoute())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  if (route === 'briefing') {
    return <Briefing onOpenDashboard={() => { window.location.hash = 'home' }} />
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', background: '#0d0d10' }}>
      <NavBar route={route} />
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {route === 'home'      && <Home />}
        {route === 'dashboard' && <Dashboard />}
        {route === 'finance'   && <PersonalFinance />}
      </div>
    </div>
  )
}
