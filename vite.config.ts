import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: 'generateSW',
      registerType: 'autoUpdate',
      injectRegister: false, // registered in src/main.tsx
      manifest: {
        name: 'Mafia Timer',
        short_name: 'Mafia',
        description: 'Speech timer for the Mafia party game.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        theme_color: '#000000',
        background_color: '#000000',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Everything in dist/ (public/ included) except the sounds: app shell, font, logo, icons.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,txt,webmanifest}'],
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
        // The cues are NOT precached: media elements fetch with Range headers (every seek), and
        // the precache handler cannot answer those, so a seek failed and playback restarted at 0.
        // A runtime cache with range support serves 206 slices of the full file instead. Only
        // full 200 responses are stored (never a 206); cues.ts warms the cache with a plain fetch.
        runtimeCaching: [
          {
            urlPattern: /\/sounds\/[^/]+\.mp3$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'sounds', // SOUND_CACHE in src/audio/cues.ts
              rangeRequests: true,
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
    restoreMocks: true,
    unstubGlobals: true,
  },
});
