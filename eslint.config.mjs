import blitzPlugin from '@blitz/eslint-plugin';
import { jsFileExtensions } from '@blitz/eslint-plugin/dist/configs/javascript.js';
import { getNamingConventionRule, tsFileExtensions } from '@blitz/eslint-plugin/dist/configs/typescript.js';

export default [
  {
    ignores: ['**/dist', '**/node_modules', '**/.wrangler', '**/amplify/build', '**/.history'],
  },
  ...blitzPlugin.configs.recommended(),
  {
    rules: {
      '@blitz/catch-error-name': 'off',
      '@typescript-eslint/no-this-alias': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@blitz/comment-syntax': 'off',
      '@blitz/block-scope-case': 'off',
      /*
       * @blitz/lines-around-comment requires blank lines before comments,
       * but this conflicts with prettier's formatting (which removes blank
       * lines in certain JSX/expression contexts). The two formatters fight
       * each other indefinitely. Disable the rule since it's purely
       * stylistic and the conflict prevents convergence.
       */
      '@blitz/lines-around-comment': 'off',
      /*
       * react-hooks/exhaustive-deps is reported by the @blitz plugin but
       * the rule is not registered in eslint's rule registry (plugin
       * loading issue), so eslint-disable-next-line directives for it
       * fail with "Definition for rule was not found". Disable globally.
       */
      'react-hooks/exhaustive-deps': 'off',
      /*
       * Empty functions are intentional stubs (e.g., no-op callbacks,
       * placeholder constructors). Disable the warning.
       */
      '@typescript-eslint/no-empty-function': 'off',
      'array-bracket-spacing': ['error', 'never'],
      'object-curly-newline': ['error', { consistent: true }],
      'keyword-spacing': ['error', { before: true, after: true }],
      'consistent-return': 'error',
      semi: ['error', 'always'],
      curly: ['error'],
      'no-eval': ['error'],
      'linebreak-style': ['error', 'unix'],
      'arrow-spacing': ['error', { before: true, after: true }],
    },
  },
  {
    files: ['**/*.tsx'],
    rules: {
      ...getNamingConventionRule({}, true),
    },
  },
  {
    files: ['**/*.d.ts'],
    rules: {
      '@typescript-eslint/no-empty-object-type': 'off',
    },
  },
  {
    files: [...tsFileExtensions, ...jsFileExtensions, '**/*.tsx'],
    ignores: ['functions/*', 'electron/**/*'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../'],
              message: "Relative imports are not allowed. Please use '~/' instead.",
            },
          ],
        },
      ],
    },
  },
];
