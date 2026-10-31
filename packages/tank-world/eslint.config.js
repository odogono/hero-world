import { resolve } from 'node:path';

import nkzw from '@nkzw/eslint-config';

export default [
  {
    ignores: ['**/dist/*']
  },
  ...nkzw,
  {
    rules: {
      '@typescript-eslint/consistent-type-definitions': ['error', 'type'],
      'arrow-body-style': ['error', 'as-needed'],
      'arrow-parens': ['error', 'as-needed'],
      'arrow-spacing': ['error', { after: true, before: true }],
      'func-style': ['error', 'expression'],
      // Path aliases (@components etc.) and bun:* builtins; tsc covers this.
      'import-x/no-unresolved': 'off',
      'no-var': 'error',
      'prefer-arrow-callback': 'error',
      'prefer-const': 'error',
      'react/no-unknown-property': 'off'
    },
    settings: {
      'import/resolver': {
        typescript: {
          project: resolve(process.cwd(), './tsconfig.app.json')
        }
      }
    }
  },
  {
    // Playwright debugging script: console output is its purpose.
    files: ['test-app.js'],
    rules: { 'no-console': 'off' }
  }
];
