import { sendPushToAll } from '@/lib/push'
import { mobileAuthOk, unauthorized } from '@/lib/mobileAuth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Fire a test notification to every registered device and say how many it
 *  reached (`sent`), so "enviado" never means "sent to nobody". */
export async function POST(req: Request) {
  if (!(await mobileAuthOk(req))) return unauthorized()

  const result = await sendPushToAll({
    title: '🎉 Opero AI',
    body: 'Notificações ativadas neste aparelho.',
    kind: 'test',
    url: '/m',
    tag: 'test',
  })

  return Response.json(result)
}
