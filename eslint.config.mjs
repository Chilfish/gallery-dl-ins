// @ts-check
import antfu from '@antfu/eslint-config'

export default antfu(
  {
    type: 'lib',
    formatters: true,
  },
  {
    ignores: ['tests/fixtures/raw/*.json', '**/*.md'],
  },
  {
    rules: {
      'unused-imports/no-unused-vars': 'warn',
      'no-console': 'off',
      'antfu/no-top-level-await': 'off',
      'node/prefer-global/buffer': 'off',
      'node/prefer-global/process': 'off',
      'accessor-pairs': 'off',
      'style/multiline-ternary': 'off',
      'ts/no-use-before-define': 'warn',
      'no-case-declarations': 'off',
    },
  },
)
