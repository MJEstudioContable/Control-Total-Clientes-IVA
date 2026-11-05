import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: true,
    // Con VITE_BACKEND_URL=/__api el front habla con el backend simulado de
    // tools/smoke a través del dev server (útil detrás de un proxy/preview,
    // donde el navegador no puede llegar a localhost:8787).
    proxy: {
      '/__api': {
        target: process.env.SMOKE_BACKEND || 'http://127.0.0.1:8787',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/__api/, ''),
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Control Total Clientes IVA · MJ Estudio Contable',
        short_name: 'MJ Clientes',
        description: 'Gestión de clientes e IVA de MJ Estudio Contable',
        lang: 'es-PY',
        theme_color: '#f4f7fa',
        background_color: '#f4f7fa',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
})
