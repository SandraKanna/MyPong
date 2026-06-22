/**
 * Shared ESLint rule overrides for all services.
 * This file exports plain data only — no ESLint package imports.
 * Each service provides its own ESLint installation and assembles
 * the full flat config using these rules as a base.
 */

export const baseRules = {
  // tsc (noUnusedLocals + noUnusedParameters) already enforces this
  '@typescript-eslint/no-unused-vars': 'off',

  // Explicit any is sometimes unavoidable (e.g. Zod internals, pg rows)
  // Warn instead of error so it's visible but not blocking
  '@typescript-eslint/no-explicit-any': 'warn',
};
