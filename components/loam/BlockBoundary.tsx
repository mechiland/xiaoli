'use client'

import { QueryErrorResetBoundary } from '@tanstack/react-query'
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { SectionTitle } from './Typography'
import { BlockError } from './BlockError'

interface InnerProps {
  onReset: () => void
  fallback?: (retry: () => void) => ReactNode
  children: ReactNode
}

class InnerBoundary extends Component<InnerProps, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Stays in the block; the rest of the page keeps rendering.
    console.warn('[BlockBoundary]', error.name, info.componentStack?.split('\n')[1]?.trim())
  }

  retry = () => {
    this.props.onReset()
    this.setState({ error: null })
  }

  render() {
    if (this.state.error) return this.props.fallback ? this.props.fallback(this.retry) : <BlockError onRetry={this.retry} />
    return this.props.children
  }
}

/**
 * One page block = error boundary + TanStack QueryErrorResetBoundary (ARCHITECTURE §3 "Per-block error states").
 * Use with `useSuspenseQuery` or `throwOnError` queries; a failure renders BlockError in the block's own space.
 */
export function BlockBoundary({
  title,
  children,
  fallback,
  className,
}: {
  title?: ReactNode
  children: ReactNode
  fallback?: (retry: () => void) => ReactNode
  className?: string
}) {
  return (
    <section className={className}>
      {title && <SectionTitle className="mb-3">{title}</SectionTitle>}
      <QueryErrorResetBoundary>
        {({ reset }) => (
          <InnerBoundary onReset={reset} fallback={fallback}>
            {children}
          </InnerBoundary>
        )}
      </QueryErrorResetBoundary>
    </section>
  )
}
