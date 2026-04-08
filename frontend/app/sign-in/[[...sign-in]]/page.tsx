import { SignIn } from '@clerk/nextjs'

export default function SignInPage() {
  return (
    <div style={{
      minHeight: '100vh', background: 'var(--bg)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexDirection: 'column', gap: 32,
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{
          width: 48, height: 48, borderRadius: 12,
          background: 'linear-gradient(135deg,#8B5CF6,#6D28D9)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 24, fontWeight: 700, color: 'white', margin: '0 auto 12px',
        }}>O</div>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>Opero AI</h1>
        <p style={{ fontSize: 13, color: 'var(--text-faint)', marginTop: 4 }}>Facebook Ads + Shopify analytics</p>
      </div>
      <SignIn />
    </div>
  )
}
