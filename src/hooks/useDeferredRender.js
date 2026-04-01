import { useEffect, useState } from 'react'

/**
 * Defer mounting heavy components until after route transitions / initial interaction.
 *
 * Typical usage:
 *   const ready = useDeferredRender({ delayMs: 750 })
 *   return ready ? <HeavyViz/> : <Skeleton/>
 */
export function useDeferredRender({
  delayMs = 750,
  useIdleCallback = true,
  idleTimeoutMs = 1500,
  resetKey,
} = {}) {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    let innerCleanup = null
    setReady(false)

    const afterDelay = () => {
      if (cancelled) return

      // Prefer idle time if available so we don't compete with paint during transitions.
      if (useIdleCallback && typeof window !== 'undefined' && 'requestIdleCallback' in window) {
        const id = window.requestIdleCallback(
          () => {
            if (!cancelled) setReady(true)
          },
          { timeout: idleTimeoutMs }
        )
        return () => window.cancelIdleCallback?.(id)
      }

      const raf = window.requestAnimationFrame(() => {
        if (!cancelled) setReady(true)
      })
      return () => window.cancelAnimationFrame(raf)
    }

    const t = window.setTimeout(() => {
      innerCleanup = afterDelay()
    }, delayMs)

    return () => {
      cancelled = true
      window.clearTimeout(t)
      if (innerCleanup) innerCleanup()
    }
  }, [delayMs, useIdleCallback, idleTimeoutMs, resetKey])

  return ready
}
