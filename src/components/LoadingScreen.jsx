import { motion } from 'framer-motion'

export default function LoadingScreen({ label = 'Loading…' }) {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-[#02040a] bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900/20 via-[#02040a] to-[#02040a]">
      <div className="flex flex-col items-center gap-4">
        <motion.img
          src="/img/logo-ciee.png"
          alt="CIEE"
          className="h-16 w-auto"
          animate={{ opacity: [0.55, 1, 0.55], filter: ['blur(0px)', 'blur(0px)', 'blur(0px)'] }}
          transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
        />
        <div className="mono text-xs text-gray-200/80 tracking-widest uppercase">{label}</div>
        <motion.div
          className="h-1 w-44 rounded-full bg-white/10 overflow-hidden border border-white/5"
          initial={false}
        >
          <motion.div
            className="h-full w-1/2 bg-gradient-to-r from-cyan-400/30 via-violet-400/30 to-emerald-400/30"
            animate={{ x: ['-20%', '120%'] }}
            transition={{ duration: 0.9, repeat: Infinity, ease: 'easeInOut' }}
          />
        </motion.div>
      </div>
    </div>
  )
}
