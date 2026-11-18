import { Skeleton } from '@/components/ui'
import s from './m.module.css'

/** The phone's own loading screen (the root one is shaped like the desktop shell). */
export default function MobileLoading() {
  return (
    <div className={s.root} aria-busy="true" aria-label="Carregando">
      <div className={s.header}>
        <div className={s.brand}><span className={s.brandMark} /><span className={s.brandName}>Opero</span></div>
      </div>
      <div className={s.chips}>
        {[64, 76, 132, 84, 96].map((w, i) => <Skeleton key={i} width={w} height={36} radius={18} />)}
      </div>
      <div className={s.content}>
        <Skeleton height={40} radius={10} />
        <Skeleton height={300} radius={16} />
        <Skeleton height={220} radius={16} />
      </div>
    </div>
  )
}
