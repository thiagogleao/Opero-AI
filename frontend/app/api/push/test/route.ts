import { sendPushToAll } from '@/lib/push'
import { mobileAuthOk, unauthorized } from '@/lib/mobileAuth'

export const runtime = 'nodejs'

/** Fire a test notification to every registered device. */
export async function POST(req: Request) {
  if (!(await mobileAuthOk(req))) return unauthorized()

  const result = await sendPushToAll({
    title: '🎉 Opero AI',
    body: 'Notificações ativadas! Você será avisado a cada venda.',
    url: '/m',
    tag: 'test',
  })

  return Response.json(result)
}
