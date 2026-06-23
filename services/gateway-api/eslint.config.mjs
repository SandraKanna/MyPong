import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import { defineConfig } from 'eslint/config';
import { baseRules } from '../../eslint.config.base.mjs';

export default defineConfig(
  eslint.configs.recommended,
  tseslint.configs.recommendedTypeChecked,

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

  {
    files: ['tests/**/*.ts'],
    extends: [tseslint.configs.disableTypeChecked],
    rules: {
      ...baseRules,
    },
  },

  {
    ignores: ['dist/**', 'node_modules/**'],
  },
);
