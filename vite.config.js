import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import cesium from 'vite-plugin-cesium';

const isGitHubPages = process.env.GITHUB_PAGES === 'true';
const base = isGitHubPages ? '/ciee-debris-monitor/' : '/';

export default defineConfig({
  base,
  plugins: [
    react(),
    cesium()
  ],
  resolve: {
    alias: {
      cesium: 'cesium'
    }
  },
  define: {
    // Use a root-relative Cesium base to avoid nested output directories in Pages builds.
    CESIUM_BASE_URL: JSON.stringify('/cesium')
  },
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      '/api/tts': {
        target: 'http://127.0.0.1:5500',
        changeOrigin: true
      }
    }
  }
});
