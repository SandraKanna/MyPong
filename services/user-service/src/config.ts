import { z } from 'zod';

const envSchema = z.object({
  PORT: z.string().regex(/^\d+$/).transform(Number),
  DATABASE_URL: z.url(),
  // Path to the directory where uploaded avatars are stored.
  // Docker: /var/www/avatars (avatars_data volume). Native dev: ./avatars-dev.
  AVATARS_DIR: z.string().min(1),
  // ws:// URL — z.string().min(1) used instead of z.url() because Zod v4
  // may reject ws:// as a non-http scheme.
  GATEWAY_WS_URL:          z.string().min(1),
  INTERNAL_SERVICE_SECRET: z.string().min(32),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:');
  console.error(z.prettifyError(parsed.error));
  process.exit(1);
}

export const config = parsed.data;
