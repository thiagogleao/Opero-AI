import Anthropic from '@anthropic-ai/sdk'
import { NextRequest } from 'next/server'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(req: NextRequest) {
  const { mode, messages, systemPrompt } = await req.json()

  // Insights mode: single structured JSON response (no streaming)
  if (mode === 'insights') {
    try {
      const msg = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: 'Analise os dados e retorne os insights no formato JSON especificado.' }],
      })
      const text = msg.content[0].type === 'text' ? msg.content[0].text : ''
      const match = text.match(/\[[\s\S]*\]/)
      if (!match) return Response.json({ insights: [], error: 'no_json' })
      const insights = JSON.parse(match[0])
      return Response.json({ insights })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      return Response.json({ insights: [], error: msg }, { status: 500 })
    }
  }

  // Chat mode: streaming
  const stream = anthropic.messages.stream({
    model: 'claude-sonnet-4-6',
    max_tokens: 1000,
    system: systemPrompt,
    messages,
  })

  const encoder = new TextEncoder()
  const readable = new ReadableStream({
    async start(controller) {
      for await (const chunk of stream) {
        if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
          controller.enqueue(encoder.encode(chunk.delta.text))
        }
      }
      controller.close()
    },
  })

  return new Response(readable, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
