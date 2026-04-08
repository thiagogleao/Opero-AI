'use client'
import { motion } from 'framer-motion'
import { ReactNode } from 'react'

interface MetricCardProps {
  title: string
  value: string
  sub?: string
  icon: ReactNode
  gradient: string
  delay?: number
  trend?: number // positive = good, negative = bad
}

export default function MetricCard({ title, value, sub, icon, gradient, delay = 0, trend }: MetricCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay }}
      style={{
        background: '#111318',
        border: '1px solid #1E2028',
        borderRadius: 12,
        padding: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        cursor: 'default',
        transition: 'border-color 0.2s, transform 0.2s',
      }}
      whileHover={{ y: -3, borderColor: '#2A2D38' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 13, color: '#A1A1AA', fontWeight: 500 }}>{title}</span>
        <div style={{
          width: 36, height: 36, borderRadius: 10,
          background: gradient,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 18,
        }}>
          {icon}
        </div>
      </div>

      <div>
        <div style={{ fontSize: 26, fontWeight: 700, color: '#F4F4F5', letterSpacing: '-0.5px' }}>
          {value}
        </div>
        {sub && (
          <div style={{ fontSize: 12, color: '#52525B', marginTop: 2 }}>{sub}</div>
        )}
      </div>

      {trend !== undefined && (
        <div style={{
          fontSize: 12,
          color: trend >= 0 ? '#10B981' : '#F43F5E',
          display: 'flex', alignItems: 'center', gap: 4,
        }}>
          {trend >= 0 ? '↑' : '↓'} {Math.abs(trend).toFixed(1)}% vs período anterior
        </div>
      )}
    </motion.div>
  )
}
