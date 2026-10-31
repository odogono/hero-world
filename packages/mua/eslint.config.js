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
      'import-x/no-unresolved': 'off',
      'no-var': 'error',
      'prefer-arrow-callback': 'error',
      'prefer-const': 'error',
      'react/no-unknown-property': 'off'
    },
    settings: {
      'import/resolver': {
        typescript: {
          project: resolve(process.cwd(), './tsconfig.json')
        }
      }
    }
  },
  {
    // CLI / manual scripts print directly to the terminal
    files: ['index.ts', 'manual-test.ts', 'test-gameplay.ts', 'examples/**'],
    rules: {
      'no-console': 'off'
    }
  },
  {
    // @nkzw/eslint-config is a root workspace devDependency
    files: ['eslint.config.js'],
    rules: {
      'import-x/no-extraneous-dependencies': 'off'
    }
  }
];
