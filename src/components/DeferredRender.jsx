import { useDeferredRender } from '../hooks/useDeferredRender.js'

/**
 * DeferredRender
 * - Waits (delay + idle) before mounting the real component.
 * - IMPORTANT: spreads all props to the child so data/handlers aren't swallowed.
 *
 * Usage:
 *   <DeferredRender component={ReentryMapModule} delayMs={750} fallback={<Loading/>} someProp={...} />
 */
export default function DeferredRender({
  component: Component,
  fallback = null,
  delayMs = 750,
  useIdleCallback = true,
  idleTimeoutMs = 1500,
  resetKey,
  ...props
}) {
  const ready = useDeferredRender({ delayMs, useIdleCallback, idleTimeoutMs, resetKey })

  if (!ready) {
    return typeof fallback === 'function' ? fallback(props) : fallback
  }

  return <Component {...props} />
}
