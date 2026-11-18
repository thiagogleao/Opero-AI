/**
 * The credit-model switch, with the rule of each model said in one sentence
 * next to it (and Meta's own rule, which follows none of them). Plain links:
 * the model lives in the URL (?modelo=primeiro|ultimo|dividido), so a shared
 * link opens the same view. Server-safe.
 */

import Link from 'next/link'
import type { Model } from '@/lib/attributionModels'
import { Icon } from '@/components/ui'
import { META_RULE, MODEL_ORDER, MODEL_TEXT } from './model'
import s from './ModelPicker.module.css'

export function ModelPicker({ active, hrefs }: { active: Model; hrefs: Record<Model, string> }) {
  return (
    <nav className={s.wrap} aria-label="Como o crédito de cada pedido é dado">
      <div className={s.head}>
        <span className="lbl">Como o crédito é dado</span>
        <span className={s.hint}>Muda os pedidos e as vendas por anúncio abaixo; o que o Meta declara não muda.</span>
      </div>
      <ul className={s.list}>
        {MODEL_ORDER.map(m => (
          <li key={m}>
            <Link href={hrefs[m]} scroll={false} className={s.item} aria-current={m === active ? 'true' : undefined}>
              <span className={s.label}>
                <span className={s.radio} aria-hidden="true" />
                {MODEL_TEXT[m].label}
              </span>
              <span className={s.sentence}>{MODEL_TEXT[m].sentence}</span>
            </Link>
          </li>
        ))}
        <li>
          <div className={`${s.item} ${s.meta}`}>
            <span className={s.label}><Icon name="info" size={13} />O que o Meta declara</span>
            <span className={s.sentence}>{META_RULE}</span>
          </div>
        </li>
      </ul>
    </nav>
  )
}
