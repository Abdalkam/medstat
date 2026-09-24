import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      disable: true, // <--- ADDED THIS: Stops service worker crashes in Tauri
      registerType: 'autoUpdate',
      workbox: {
        runtimeCaching: [
          {
            urlPattern: /\/api\/.*/i,
            handler: 'NetworkOnly',
          }
        ],
        navigateFallback: null,
      },
      manifest: {
        name: 'MedStat',
        short_name: 'MedStat',
        description: 'MedStat Healthcare Training App',
        theme_color: '#007AFF',
        background_color: '#F2F2F7',
        display: 'standalone',
        start_url: '/',
        scope: '/',
      }
    })
  ],
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**']
    },
    proxy: {
      '/api': {
        target: 'https://medstat-3rxl.onrender.com',
        changeOrigin: true,
        secure: true,
      }
    }
  }
})