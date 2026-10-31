import { resolve } from 'node:path';

import nkzw from '@nkzw/eslint-config';

export default [
  {
    ignores: ['**/dist/*', 'src/edl/parser.ts']
  },
  ...nkzw,
  {
    rules: {
      '@typescript-eslint/consistent-type-definitions': ['error', 'type'],
      'arrow-body-style': ['error', 'as-needed'],
      'arrow-parens': ['error', 'as-needed'],
      'arrow-spacing': ['error', { after: true, before: true }],
      'func-style': ['error', 'expression'],
      'import-x/no-extraneous-dependencies': [
        'error',
        {
          packageDir: [
            import.meta.dirname,
            resolve(import.meta.dirname, '../..')
          ]
        }
      ],
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
    files: ['scripts/**', 'examples/**'],
    rules: {
      'no-console': 'off'
    }
  }
];
