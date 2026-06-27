import { z } from 'zod';

export const patchMeSchema = z.object({
  username: z
    .string()
    .min(1)
    .max(30)
    .regex(/^[a-zA-Z0-9_-]+$/, 'Only alphanumeric characters, hyphens, and underscores are allowed'),
});

export type PatchMeInput = z.infer<typeof patchMeSchema>;
