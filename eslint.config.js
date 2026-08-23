import { defineConfig, globalIgnores } from 'eslint/config'
import tseslint from 'typescript-eslint'

export default defineConfig(
  // .superpowers/ is the gitignored SDD workspace: scratch .ts files live there, outside every
  // tsconfig include, and globalIgnores does not read .gitignore.
  globalIgnores(['**/node_modules/**', '.superpowers/**']),
  tseslint.configs.recommendedTypeChecked,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { project: './tsconfig.json', tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // design §5: a spore may import only types from another spore. A value import needs real
      // resolution on the operator's machine, which a registry unpack cannot promise.
      '@typescript-eslint/no-restricted-imports': ['error', {
        patterns: [{
          group: ['@mycelo/spore-*'],
          allowTypeImports: true,
          message: 'A spore may import only types from another spore (design §5).',
        }],
      }],
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
