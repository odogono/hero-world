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
    // Other packages typecheck these files with their own tsconfig, where
    // this package's path aliases don't exist; tests and examples may use them.
    files: ['src/**/*.ts'],
    ignores: ['src/**/__test__/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              message:
                'Use a relative import: other packages typecheck odgn-ecs source without its tsconfig aliases.',
              regex:
                '^@(/|types|component|db|edl|entity|events|helpers|schema|system|world)(/|$)'
            }
          ]
        }
      ]
    }
  },
  {
    files: ['scripts/**', 'examples/**'],
    rules: {
      'no-console': 'off'
    }
  }
];
