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
