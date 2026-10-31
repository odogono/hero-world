import { resolve } from 'node:path';

import { defineConfig } from 'vite';

import react from '@vitejs/plugin-react';

export default defineConfig({
  assetsInclude: ['**/*.wasm'],
  optimizeDeps: {
    exclude: ['@sqlite.org/sqlite-wasm']
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve('src'),
      '@components': resolve('src/components'),
      '@contexts': resolve('src/contexts'),
      '@helpers': resolve('src/helpers'),
      '@hooks': resolve('src/hooks'),
      '@screens': resolve('src/screens'),
      '@types': resolve('src/types')
    }
  },
  server: {
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin'
    },
    proxy: {
      '/api': {
        changeOrigin: true,
        target: 'http://127.0.0.1:3001'
      },
      '/health': {
        changeOrigin: true,
        target: 'http://127.0.0.1:3001'
      },
      '/ws': {
        target: 'ws://127.0.0.1:3001',
        ws: true
      }
    }
  }
});
