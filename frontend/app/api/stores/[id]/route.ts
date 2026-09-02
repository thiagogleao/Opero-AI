import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { getTenantsByUserId } from '@/lib/tenant'
import { query } from '@/lib/db'

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  if (id === userId)
    return NextResponse.json({ error: 'Não é possível remover a loja principal' }, { status: 400 })

  const stores = await getTenantsByUserId(userId)
  const store = stores.find(s => s.id === id)
  if (!store) return NextResponse.json({ error: 'Loja não encontrada' }, { status: 404 })

  await query('DELETE FROM tenants WHERE id = $1', [id])
  return NextResponse.json({ ok: true })
}
