import { resolve } from 'node:path';

import nkzw from '@nkzw/eslint-config';

export default [
  {
    ignores: ['test-results/*', 'playwright-report/*']
  },
  ...nkzw,
  {
    rules: {
      '@typescript-eslint/consistent-type-definitions': ['error', 'type'],
      'arrow-body-style': ['error', 'as-needed'],
      'func-style': ['error', 'expression'],
      'import-x/no-unresolved': 'off',
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
    // build and test scripts print to the terminal
    files: ['build.ts', 'e2e/**'],
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
