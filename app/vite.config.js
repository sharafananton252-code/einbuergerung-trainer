import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: '/einbuergerung-trainer/',
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'questions.json',
        'images/**/*.png',
        'icons/*.png',
        'favicon.svg'
      ],
      manifest: {
        name: 'Einbürgerungstest Trainer',
        short_name: 'EB-Trainer',
        description: 'Тренажёр для теста на гражданство Германии (Einbürgerungstest) — Niedersachsen',
        lang: 'de',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#ffffff',
        theme_color: '#111111',
        icons: [
          { src: 'icons/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,json,svg,webmanifest}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        navigateFallback: 'index.html'
      },
      devOptions: {
        enabled: false
      }
    })
  ]
})
