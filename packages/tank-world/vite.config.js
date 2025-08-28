import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
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
    }
  },
  optimizeDeps: {
    exclude: ['@sqlite.org/sqlite-wasm']
  },
  assetsInclude: ['**/*.wasm']
});