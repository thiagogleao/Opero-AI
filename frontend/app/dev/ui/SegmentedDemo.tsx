'use client'

import { useState } from 'react'
import { Segmented } from '@/components/ui/Segmented'

/** Styleguide only: a Segmented control with local state. */
export function SegmentedDemo() {
  const [v, setV] = useState('lucro')
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <Segmented
        ariaLabel="Mostrar"
        value={v}
        onChange={setV}
        options={[{ value: 'lucro', label: 'Lucro' }, { value: 'receita', label: 'Receita' }, { value: 'pedidos', label: 'Pedidos' }]}
      />
      <span style={{ fontSize: 12, color: 'var(--tx-3)' }}>escolhido: {v}</span>
    </div>
  )
}
