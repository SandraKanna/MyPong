import { z } from 'zod';

const envSchema = z.object({
  PORT: z.string().regex(/^\d+$/).transform(Number),
  JWT_SECRET: z.string().min(32),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:');
  console.error(z.prettifyError(parsed.error));
  process.exit(1);
}

export const config = parsed.data;
