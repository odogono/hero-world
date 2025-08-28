import path from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@components': path.resolve(__dirname, './src/components'),
      '@contexts': path.resolve(__dirname, './src/contexts'),
      '@helpers': path.resolve(__dirname, './src/helpers'),
      '@hooks': path.resolve(__dirname, './src/hooks'),
      '@screens': path.resolve(__dirname, './src/screens'),
      '@types': path.resolve(__dirname, './src/types')
    }
  },
  test: {
    coverage: {
      include: ['src/**/*.ts'],

      provider: 'v8',
      reporter: ['text', 'json', 'html']
    },
    environment: 'node',
    globals: true
  }
});
