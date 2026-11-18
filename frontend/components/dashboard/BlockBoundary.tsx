'use client'

/**
 * BlockBoundary — keeps one broken block from taking the page down. A render
 * error inside it (a client block like the AI card throwing) shows that
 * block's ErrorState instead of sending the whole Resumo to app/error.tsx.
 * Server-side failures are caught by each async block itself.
 *
 *   <BlockBoundary title="Leitura da IA"><InsightsCard … /></BlockBoundary>
 */

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Block, ErrorState } from '@/components/ui/Card'

export class BlockBoundary extends Component<{ title: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[resumo] bloco "${this.props.title}"`, error, info.componentStack)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <Block title={this.props.title}>
        <ErrorState compact>Este bloco não carregou. O resto da página não foi afetado.</ErrorState>
      </Block>
    )
  }
}
