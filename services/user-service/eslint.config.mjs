import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import { defineConfig } from 'eslint/config';
import { baseRules } from '../../eslint.config.base.mjs';

export default defineConfig(
  eslint.configs.recommended,
  tseslint.configs.recommendedTypeChecked,

  // src — full type-checked rules
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      ...baseRules,
    },
  },

  // tests — disable type-checked rules (no project reference needed,
  // tests are excluded from tsconfig include intentionally)
  {
    files: ['tests/**/*.ts'],
    extends: [tseslint.configs.disableTypeChecked],
    rules: {
      ...baseRules,
    },
  },

  // ignore compiled output and dependencies
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
);
