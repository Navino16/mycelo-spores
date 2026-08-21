import { defineConfig, globalIgnores } from 'eslint/config'
import tseslint from 'typescript-eslint'

export default defineConfig(
  globalIgnores(['**/node_modules/**']),
  tseslint.configs.recommendedTypeChecked,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { project: './tsconfig.json', tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    // A stub implements an async interface without awaiting anything.
    files: ['**/test/**/*.ts'],
    rules: { '@typescript-eslint/require-await': 'off' },
  },
  {
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },
)
