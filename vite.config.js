import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: process.env.GITHUB_PAGES
    ? `/${(process.env.GITHUB_REPOSITORY || '').split('/')[1] || 'ciee-debris-monitor'}/`
    : '/',
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: false
  }
})
