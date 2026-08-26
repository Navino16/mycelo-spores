import { defineConfig, globalIgnores } from 'eslint/config'
import tseslint from 'typescript-eslint'

export default defineConfig(
  // .superpowers/ is the gitignored SDD workspace: scratch .ts files live there, outside every
  // tsconfig include, and globalIgnores does not read .gitignore.
  globalIgnores(['**/node_modules/**', '.superpowers/**', 'dist/**']),
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
        }, {
          // A relative specifier climbing two levels leaves the spore. It resolves while both
          // spores share one `spores:` root and throws in a multi-root install, so it is refused
          // outright: the package specifier above is the only supported cross-spore reference.
          group: ['../../*', '../../**'],
          message: 'Reference another spore by its package name, never by a relative path (design §5).',
        }],
      }],
      // no-restricted-imports does not visit ImportExpression at typescript-eslint 8.66, measured:
      // `import('@mycelo/spore-radarr')` exits 0 against the pattern above.
      'no-restricted-syntax': ['error', {
        selector: 'ImportExpression > Literal[value=/^(@mycelo\\/spore-|\\.\\.\\/\\.\\.\\/)/]',
        message: 'A spore may import only types from another spore, so it cannot import() one (design §5).',
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
