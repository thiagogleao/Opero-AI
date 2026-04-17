import Anthropic from '@anthropic-ai/sdk'
import { auth } from '@clerk/nextjs/server'
import { NextRequest } from 'next/server'
import { getTenant } from '@/lib/tenant'
import { ShopifyAdmin } from '@/lib/shopify-admin'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'list_products',
    description: 'Lista ou busca produtos na loja Shopify',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Termo de busca (opcional)' },
        limit: { type: 'number', description: 'Máximo de resultados (padrão 20)' },
        status: { type: 'string', enum: ['active', 'draft', 'archived', 'any'], description: 'Filtro por status' },
      },
    },
  },
  {
    name: 'get_product',
    description: 'Obtém detalhes de um produto específico por ID',
    input_schema: {
      type: 'object' as const,
      properties: { product_id: { type: 'string', description: 'ID do produto no Shopify' } },
      required: ['product_id'],
    },
  },
  {
    name: 'list_orders',
    description: 'Lista pedidos recentes da loja',
    input_schema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string', enum: ['open', 'closed', 'cancelled', 'any'], description: 'Status do pedido' },
        limit: { type: 'number', description: 'Máximo de resultados (padrão 20)' },
        financial_status: { type: 'string', description: 'paid, pending, refunded, etc.' },
      },
    },
  },
  {
    name: 'get_order',
    description: 'Obtém detalhes de um pedido específico',
    input_schema: {
      type: 'object' as const,
      properties: { order_id: { type: 'string', description: 'ID do pedido no Shopify' } },
      required: ['order_id'],
    },
  },
  {
    name: 'list_customers',
    description: 'Lista ou busca clientes da loja',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Busca por nome, email, etc.' },
        limit: { type: 'number', description: 'Máximo de resultados (padrão 20)' },
      },
    },
  },
  {
    name: 'get_store_info',
    description: 'Obtém informações gerais da loja (nome, moeda, timezone, plano)',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'list_pages',
    description: 'Lista as páginas da loja',
    input_schema: {
      type: 'object' as const,
      properties: { limit: { type: 'number', description: 'Máximo de resultados' } },
    },
  },
  {
    name: 'create_product',
    description: 'Cria um novo produto na loja Shopify (requer confirmação)',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'Título do produto' },
        body_html: { type: 'string', description: 'Descrição em HTML' },
        vendor: { type: 'string', description: 'Marca/fornecedor' },
        product_type: { type: 'string', description: 'Tipo/categoria do produto' },
        tags: { type: 'string', description: 'Tags separadas por vírgula' },
        price: { type: 'string', description: 'Preço (ex: "99.90")' },
        compare_at_price: { type: 'string', description: 'Preço original (para mostrar desconto)' },
        status: { type: 'string', enum: ['active', 'draft'], description: 'Status (draft = rascunho)' },
      },
      required: ['title', 'price'],
    },
  },
  {
    name: 'update_product',
    description: 'Atualiza um produto existente (requer confirmação)',
    input_schema: {
      type: 'object' as const,
      properties: {
        product_id: { type: 'string', description: 'ID do produto' },
        title: { type: 'string' },
        body_html: { type: 'string' },
        price: { type: 'string', description: 'Novo preço' },
        compare_at_price: { type: 'string' },
        status: { type: 'string', enum: ['active', 'draft', 'archived'] },
        tags: { type: 'string' },
      },
      required: ['product_id'],
    },
  },
  {
    name: 'update_inventory',
    description: 'Ajusta o estoque de uma variante de produto (requer confirmação)',
    input_schema: {
      type: 'object' as const,
      properties: {
        variant_id: { type: 'string', description: 'ID da variante' },
        quantity: { type: 'number', description: 'Nova quantidade em estoque' },
      },
      required: ['variant_id', 'quantity'],
    },
  },
  {
    name: 'create_page',
    description: 'Cria uma nova página na loja (ex: página de vendas, sobre nós) — requer confirmação',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'Título da página' },
        body_html: { type: 'string', description: 'Conteúdo em HTML' },
        published: { type: 'boolean', description: 'Publicar imediatamente?' },
      },
      required: ['title', 'body_html'],
    },
  },
  {
    name: 'update_page',
    description: 'Atualiza uma página existente (requer confirmação)',
    input_schema: {
      type: 'object' as const,
      properties: {
        page_id: { type: 'string', description: 'ID da página' },
        title: { type: 'string' },
        body_html: { type: 'string' },
        published: { type: 'boolean' },
      },
      required: ['page_id'],
    },
  },
]

const WRITE_TOOLS = new Set(['create_product', 'update_product', 'update_inventory', 'create_page', 'update_page'])

type Input = Record<string, unknown>

async function executeTool(name: string, input: Input, shopify: ShopifyAdmin): Promise<string> {
  try {
    switch (name) {
      case 'list_products': {
        const { query, limit = 20, status = 'active' } = input as { query?: string; limit?: number; status?: string }
        const params = new URLSearchParams({ limit: String(limit), status })
        if (query) params.set('title', query)
        const data = await shopify.get(`/products.json?${params}`)
        type P = { id: unknown; title: unknown; status: unknown; tags: unknown; variants: { price: unknown; inventory_quantity: unknown; id: unknown }[] }
        return JSON.stringify((data.products as P[] ?? []).map(p => ({
          id: p.id, title: p.title, status: p.status, tags: p.tags,
          price: p.variants?.[0]?.price,
          inventory: p.variants?.[0]?.inventory_quantity,
          variant_id: p.variants?.[0]?.id,
        })))
      }
      case 'get_product': {
        const data = await shopify.get(`/products/${input.product_id}.json`)
        return JSON.stringify(data.product)
      }
      case 'list_orders': {
        const { status = 'any', limit = 20, financial_status } = input as { status?: string; limit?: number; financial_status?: string }
        const params = new URLSearchParams({ status, limit: String(limit) })
        if (financial_status) params.set('financial_status', financial_status)
        const data = await shopify.get(`/orders.json?${params}`)
        type O = { id: unknown; order_number: unknown; created_at: unknown; total_price: unknown; financial_status: unknown; fulfillment_status: unknown; customer: { email: unknown } }
        return JSON.stringify((data.orders as O[] ?? []).map(o => ({
          id: o.id, order_number: o.order_number, created_at: o.created_at,
          total_price: o.total_price, financial_status: o.financial_status,
          fulfillment_status: o.fulfillment_status, customer: o.customer?.email,
        })))
      }
      case 'get_order': {
        const data = await shopify.get(`/orders/${input.order_id}.json`)
        return JSON.stringify(data.order)
      }
      case 'list_customers': {
        const { query, limit = 20 } = input as { query?: string; limit?: number }
        const params = new URLSearchParams({ limit: String(limit) })
        if (query) params.set('query', query)
        const data = await shopify.get(`/customers.json?${params}`)
        type C = { id: unknown; first_name: unknown; last_name: unknown; email: unknown; orders_count: unknown; total_spent: unknown }
        return JSON.stringify((data.customers as C[] ?? []).map(c => ({
          id: c.id, name: `${c.first_name} ${c.last_name}`, email: c.email,
          orders_count: c.orders_count, total_spent: c.total_spent,
        })))
      }
      case 'get_store_info': {
        const data = await shopify.get('/shop.json')
        return JSON.stringify(data.shop)
      }
      case 'list_pages': {
        const { limit = 20 } = input as { limit?: number }
        const data = await shopify.get(`/pages.json?limit=${limit}`)
        return JSON.stringify(data.pages)
      }
      case 'create_product': {
        const { title, body_html, vendor, product_type, tags, price, compare_at_price, status = 'draft' } = input as {
          title: string; body_html?: string; vendor?: string; product_type?: string
          tags?: string; price: string; compare_at_price?: string; status?: string
        }
        const data = await shopify.post('/products.json', {
          product: {
            title, body_html, vendor, product_type, tags, status,
            variants: [{ price, compare_at_price }],
          },
        })
        return JSON.stringify({ success: true, product_id: data.product?.id, title: data.product?.title })
      }
      case 'update_product': {
        const { product_id, price, compare_at_price, ...fields } = input as {
          product_id: string; price?: string; compare_at_price?: string; [k: string]: unknown
        }
        const update: Input = { id: product_id, ...fields }
        if (price || compare_at_price) update.variants = [{ price, compare_at_price }]
        const data = await shopify.put(`/products/${product_id}.json`, { product: update })
        return JSON.stringify({ success: true, product_id: data.product?.id })
      }
      case 'update_inventory': {
        const { variant_id, quantity } = input as { variant_id: string; quantity: number }
        const varData = await shopify.get(`/variants/${variant_id}.json`)
        const inventoryItemId = varData.variant?.inventory_item_id
        const locData = await shopify.get('/locations.json')
        const locationId = (locData.locations as { id: unknown }[])?.[0]?.id
        if (!inventoryItemId || !locationId) return JSON.stringify({ error: 'inventory item or location not found' })
        const data = await shopify.post('/inventory_levels/set.json', {
          inventory_item_id: inventoryItemId, location_id: locationId, available: quantity,
        })
        return JSON.stringify({ success: true, available: data.inventory_level?.available })
      }
      case 'create_page': {
        const { title, body_html, published = false } = input as { title: string; body_html: string; published?: boolean }
        const data = await shopify.post('/pages.json', { page: { title, body_html, published } })
        return JSON.stringify({ success: true, page_id: data.page?.id, title: data.page?.title })
      }
      case 'update_page': {
        const { page_id, ...fields } = input as { page_id: string; [k: string]: unknown }
        const data = await shopify.put(`/pages/${page_id}.json`, { page: { id: page_id, ...fields } })
        return JSON.stringify({ success: true, page_id: data.page?.id })
      }
      default:
        return JSON.stringify({ error: `unknown tool: ${name}` })
    }
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : String(err) })
  }
}

function previewText(name: string, input: Input): string {
  switch (name) {
    case 'create_product': return `Criar produto "${input.title}" por R$${input.price} (status: ${input.status ?? 'draft'})`
    case 'update_product': return `Atualizar produto #${input.product_id}${input.price ? ` → R$${input.price}` : ''}${input.title ? ` → "${input.title}"` : ''}`
    case 'update_inventory': return `Ajustar estoque da variante #${input.variant_id} para ${input.quantity} unidades`
    case 'create_page': return `Criar página "${input.title}"${input.published ? ' (publicada imediatamente)' : ' (rascunho)'}`
    case 'update_page': return `Atualizar página #${input.page_id}`
    default: return `Executar ${name}`
  }
}

function toolLabel(name: string): string {
  const labels: Record<string, string> = {
    list_products: 'Buscando produtos...',
    get_product: 'Carregando produto...',
    list_orders: 'Buscando pedidos...',
    get_order: 'Carregando pedido...',
    list_customers: 'Buscando clientes...',
    get_store_info: 'Carregando info da loja...',
    list_pages: 'Buscando páginas...',
  }
  return labels[name] ?? `Executando ${name}...`
}

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return new Response('Unauthorized', { status: 401 })

  const tenant = await getTenant(userId)
  if (!tenant?.shopify_domain || !tenant?.shopify_access_token) {
    return Response.json({ error: 'Shopify não conectado' }, { status: 400 })
  }

  const shopify = new ShopifyAdmin(tenant.shopify_domain, tenant.shopify_access_token)

  const body = await req.json() as {
    messages: Anthropic.MessageParam[]
    systemPrompt: string
    confirm?: { tool_use_id: string; approved: boolean }
  }

  let currentMessages = [...body.messages]

  // If resuming after a confirmation, the last assistant message already has tool_use.
  // We just need to append the tool_result.
  if (body.confirm) {
    const { tool_use_id, approved } = body.confirm
    currentMessages.push({
      role: 'user',
      content: [{
        type: 'tool_result',
        tool_use_id,
        content: approved
          ? JSON.stringify({ status: 'approved_by_user' })
          : JSON.stringify({ error: 'Ação cancelada pelo usuário.' }),
      }],
    })
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))

      try {
        // Agentic loop
        for (let i = 0; i < 10; i++) {
          const response = await anthropic.messages.create({
            model: 'claude-sonnet-4-6',
            max_tokens: 4096,
            system: body.systemPrompt,
            tools: TOOLS,
            messages: currentMessages,
          })

          // Emit text blocks
          for (const block of response.content) {
            if (block.type === 'text' && block.text) {
              send({ type: 'text', delta: block.text })
            }
          }

          currentMessages = [...currentMessages, { role: 'assistant', content: response.content }]

          if (response.stop_reason === 'end_turn') {
            send({ type: 'done', messages: currentMessages })
            break
          }

          if (response.stop_reason === 'tool_use') {
            const toolBlock = response.content.find(b => b.type === 'tool_use') as Anthropic.ToolUseBlock

            if (WRITE_TOOLS.has(toolBlock.name)) {
              // Pause — needs user confirmation
              send({
                type: 'confirm_required',
                tool_use_id: toolBlock.id,
                name: toolBlock.name,
                input: toolBlock.input,
                preview: previewText(toolBlock.name, toolBlock.input as Input),
                messages: currentMessages,
              })
              break
            }

            // Auto-execute read tool
            send({ type: 'tool_run', name: toolBlock.name, label: toolLabel(toolBlock.name) })
            const result = await executeTool(toolBlock.name, toolBlock.input as Input, shopify)
            send({ type: 'tool_done', name: toolBlock.name })

            currentMessages = [...currentMessages, {
              role: 'user',
              content: [{ type: 'tool_result', tool_use_id: toolBlock.id, content: result }],
            }]
          }
        }
      } catch (err) {
        send({ type: 'error', message: err instanceof Error ? err.message : String(err) })
      }

      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
