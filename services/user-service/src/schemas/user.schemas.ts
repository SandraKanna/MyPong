import { z } from 'zod';

export const patchMeSchema = z.object({
  username: z
    .string()
    .min(1)
    .max(30)
    .regex(/^[a-zA-Z0-9_-]+$/, 'Only alphanumeric characters, hyphens, and underscores are allowed'),
});

export type PatchMeInput = z.infer<typeof patchMeSchema>;

export const userLookupQuerySchema = z.object({
  ids: z
    .string() // comma-separated, e.g. "1,2,3" — not JSON, so split manually below
    .min(1, 'ids must not be empty') // rejects a missing/empty ids param
    .transform((raw) => raw.split(',').map((segment) => Number(segment))) // splits and converts to numbers here — coercing inside the piped array schema below hits a Zod 4 type-inference gap
    .pipe(
      z
        .array(
          z
            .number()
            .int('each id must be a positive integer') // non-numeric segment ("abc") → NaN → fails here
            .positive('each id must be a positive integer'), // empty segment ("1,,2") → 0 → fails here
        )
        .min(1, 'ids must not be empty')
        .max(50, 'ids must not exceed 50'), // caps batch size
    ),
});

export type UserLookupQuery = z.infer<typeof userLookupQuerySchema>;

// z.coerce.number() converts the raw string path param to a number before
// validating (route params always arrive as strings). The { error } on the
// base check covers non-numeric input ('abc' → NaN), which fails there
// before .int()/.positive() ever run.
export const idParamSchema = z.object({
  id: z.coerce.number({ error: 'Invalid user id' }).int('Invalid user id').positive('Invalid user id'),
});

export type IdParam = z.infer<typeof idParamSchema>;

// .default() fills in the value when the query param is absent. Every check
// on a field carries the same message because the API contract returns a
// single flat error string, not a per-check breakdown.
export const matchesQuerySchema = z.object({
  limit: z.coerce
    .number({ error: 'limit must be a positive integer' })
    .int('limit must be a positive integer')
    .min(1, 'limit must be a positive integer')
    .max(50, 'limit must not exceed 50')
    .default(20),
  offset: z.coerce
    .number({ error: 'offset must be a non-negative integer' })
    .int('offset must be a non-negative integer')
    .min(0, 'offset must be a non-negative integer')
    .default(0),
});

export type MatchesQuery = z.infer<typeof matchesQuerySchema>;
