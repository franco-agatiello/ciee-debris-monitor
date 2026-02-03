import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { publicUrl } from '../utils/publicUrl'

const DEFAULT_MESSAGES = [
  'Initializing core…',
  'Bootstrapping UI layer…',
  'Parsing TLE data…',
  'Calibrating orbital sensors…',
  'Syncing reentry telemetry…',
  'Finalizing interface…',
]

function clamp01(n) {
  return Math.max(0, Math.min(1, n))
}

export default function LoadingScreen({
  title = 'CIEE Space Watch Suite',
  subtitle = 'SYSTEM BOOT',
  messages = DEFAULT_MESSAGES,
}) {
  const cycleMs = 2800

  const [pct, setPct] = useState(0)
  const [msgIndex, setMsgIndex] = useState(0)

  const msg = useMemo(() => {
    const list = Array.isArray(messages) && messages.length ? messages : DEFAULT_MESSAGES
    return list[msgIndex % list.length]
  }, [messages, msgIndex])

  useEffect(() => {
    let rafId = 0
    const start = performance.now()

    const tick = (t) => {
      const elapsed = (t - start) % cycleMs
      const p = clamp01(elapsed / cycleMs)
      const nextPct = Math.round(p * 100)
      setPct(nextPct)

      // Advance message every ~20%.
      const nextIndex = Math.floor(p * 5.0001)
      setMsgIndex(nextIndex)

      rafId = requestAnimationFrame(tick)
    }

    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [])

  return (
    <div
      className="min-h-screen w-full flex items-center justify-center overflow-hidden bg-[#02040a]"
      role="status"
      aria-live="polite"
      aria-label="Loading"
    >
      {/* background: subtle grid + vignette */}
      <div className="pointer-events-none absolute inset-0 opacity-[0.22]">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(34,211,238,0.18),_rgba(2,4,10,0)_55%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.06)_1px,transparent_1px)] bg-[size:48px_48px]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_rgba(2,4,10,0)_40%,_rgba(2,4,10,1)_78%)]" />
      </div>

      <div className="relative w-full max-w-xl px-6">
        <div className="rounded-3xl border border-white/10 bg-black/35 backdrop-blur-xl shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_30px_90px_rgba(0,0,0,0.55)] overflow-hidden">
          <div className="p-7 sm:p-9">
            <div className="flex items-center gap-4">
              <motion.img
                src={publicUrl('/img/logo-ciee.png')}
                alt="CIEE"
                className="h-12 w-auto"
                animate={{ opacity: [0.75, 1, 0.75] }}
                transition={{ duration: 1.35, repeat: Infinity, ease: 'easeInOut' }}
              />
              <div className="min-w-0">
                <div className="text-lg sm:text-xl font-extrabold tracking-tight text-white truncate">{title}</div>
                <div className="mt-0.5 text-[11px] mono tracking-[0.28em] uppercase text-cyan-200/80">
                  {subtitle}
                </div>
              </div>
              <div className="ml-auto text-right">
                <div
                  className="mono text-2xl sm:text-3xl font-extrabold text-cyan-200"
                  style={{ textShadow: '0 0 16px rgba(34,211,238,0.35)' }}
                >
                  {pct}%
                </div>
              </div>
            </div>

            {/* progress line */}
            <div className="mt-7">
              <div className="relative h-[10px]">
                <div className="absolute inset-0 rounded-full bg-white/10" />

                <motion.div
                  className="absolute left-0 top-1/2 h-[2px] -translate-y-1/2 rounded-full bg-cyan-300/90"
                  style={{
                    filter: 'drop-shadow(0 0 10px rgba(34,211,238,0.55))',
                  }}
                  animate={{ width: ['0%', '100%'] }}
                  transition={{ duration: cycleMs / 1000, ease: [0.32, 0.02, 0.2, 0.98], repeat: Infinity }}
                />

                {/* pulse/glitch overlay */}
                <motion.div
                  className="absolute left-0 top-1/2 h-[2px] -translate-y-1/2 rounded-full bg-cyan-200"
                  style={{ mixBlendMode: 'screen' }}
                  animate={{
                    opacity: [0, 0.55, 0],
                    x: ['-6%', '18%', '-2%'],
                    scaleY: [1, 2.6, 1],
                  }}
                  transition={{ duration: 0.65, repeat: Infinity, repeatDelay: 1.6, ease: 'easeInOut' }}
                />

                {/* scanning highlight */}
                <motion.div
                  className="absolute top-1/2 h-6 w-16 -translate-y-1/2 bg-gradient-to-r from-transparent via-cyan-200/25 to-transparent"
                  animate={{ x: ['-20%', '120%'] }}
                  transition={{ duration: 1.25, repeat: Infinity, ease: 'easeInOut' }}
                />
              </div>
            </div>

            {/* status text */}
            <div className="mt-5 flex items-center justify-between gap-3">
              <motion.div
                key={msg}
                className="mono text-xs tracking-[0.22em] uppercase text-white/70"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.22 }}
              >
                {msg}
              </motion.div>

              <motion.div
                className="mono text-[11px] text-cyan-200/70"
                animate={{ opacity: [0.55, 1, 0.55] }}
                transition={{ duration: 1.05, repeat: Infinity, ease: 'easeInOut' }}
              >
                LINK ▸ OK
              </motion.div>
            </div>
          </div>

          {/* subtle bottom glow */}
          <div className="h-10 bg-[radial-gradient(ellipse_at_center,_rgba(34,211,238,0.18),_rgba(0,0,0,0)_68%)]" />
        </div>
      </div>
    </div>
  )
}
