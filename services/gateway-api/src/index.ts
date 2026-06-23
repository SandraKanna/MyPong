import { buildApp } from './app.js';
import { config } from './config.js';

async function main() {
  const app = await buildApp();
  try {
    await app.listen({ 
      port: config.PORT, // use the port validated by zod in config.ts, not hardcoded
      host: '0.0.0.0' //  bind to all network interfaces, not just localhost
                        // required for the container to be reachable from
                        // other containers on the Docker network
    });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
