import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['**/.claude-plugin/types/**', 'node_modules/**', 'eslint.config.js', 'scripts/**'] },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      // Claude Code awaits the promise an event handler returns and handles its rejection, although the mod API types
      // declare the handlers as returning void. The arguments check also never finishes on calls into those types.
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { arguments: false, attributes: false } },
      ],
    },
  },
  {
    // Tests index fixtures they built themselves, so a missing element is a test failure, not a runtime case.
    files: ['**/*.test.ts', '**/*.test.tsx', '**/tests/**'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
)
