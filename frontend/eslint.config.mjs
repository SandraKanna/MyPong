import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import { defineConfig } from 'eslint/config';
import { baseRules } from '../eslint.config.base.mjs';

export default defineConfig(
  eslint.configs.recommended,

  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [tseslint.configs.recommendedTypeChecked],
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

  {
    ignores: ['dist/**', 'node_modules/**'],
  },
);
