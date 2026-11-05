import { resolve } from 'node:path';

import nkzw from '@nkzw/eslint-config';

export default [
  ...nkzw,
  {
    rules: {
      '@typescript-eslint/consistent-type-definitions': ['error', 'type'],
      'arrow-body-style': ['error', 'as-needed'],
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
      'prefer-arrow-callback': 'error'
    }
  }
];
