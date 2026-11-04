import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  server: { port: 5173 },
  build: { outDir: 'dist', sourcemap: false },
  plugins: [
    // App instalável e modo offline: guarda a página e os últimos dados consultados.
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['senai-logo.png', 'senai-logo-branco.png'],
      manifest: {
        name: 'Almoxarifado Inteligente',
        short_name: 'Almoxarifado',
        description: 'Sistema de almoxarifado SENAI · Klabin',
        lang: 'pt-BR',
        start_url: '/',
        display: 'standalone',
        background_color: '#f3f5f9',
        theme_color: '#2957a4',
        icons: [
          { src: '/icone-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icone-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icone-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        globPatterns: ['**/*.{js,css,html,png,svg,ico}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        runtimeCaching: [
          {
            // Consultas ao banco: tenta a internet; sem ela, usa a última resposta salva.
            urlPattern: ({ url, request }) => request.method === 'GET' && url.hostname.endsWith('.supabase.co') && url.pathname.startsWith('/rest/v1/'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'almox-dados',
              networkTimeoutSeconds: 8,
              expiration: { maxEntries: 500, maxAgeSeconds: 7 * 24 * 3600 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // Fotos dos materiais.
            urlPattern: ({ url }) => url.hostname.endsWith('.supabase.co') && url.pathname.startsWith('/storage/v1/object/public/'),
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'almox-fotos', expiration: { maxEntries: 300, maxAgeSeconds: 30 * 24 * 3600 } },
          },
        ],
      },
    }),
  ],
});
