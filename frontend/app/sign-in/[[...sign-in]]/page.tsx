import { SignIn } from '@clerk/nextjs'

export default function SignInPage() {
  return (
    <div style={{
      minHeight: '100vh', background: 'var(--bg)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexDirection: 'column', gap: 32,
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, marginBottom: 8 }}>
          <svg width="40" height="40" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 33 C14 26 28 14 37 16 L37 34 L12 34 Z" fill="rgba(16,185,129,0.09)"/>
            <circle cx="24" cy="24" r="19" stroke="#10b981" strokeWidth="2.5" fill="none"/>
            <path d="M12 33 C14 26 28 14 37 16" stroke="#10b981" strokeWidth="2.2" strokeLinecap="round" fill="none"/>
            <circle cx="37" cy="16" r="2.6" fill="#10b981"/>
          </svg>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <span style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.04em', color: 'var(--text-primary)' }}>opero</span>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', color: '#10b981', background: 'rgba(16,185,129,0.13)', padding: '3px 7px', borderRadius: 4 }}>AI</span>
          </div>
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-faint)' }}>Facebook Ads + Shopify analytics</p>
      </div>
      <SignIn />
    </div>
  )
}
