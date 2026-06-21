import { buildApp } from './app';
import { config } from './config';

async function main() {
  const app = await buildApp(); // build the app: routes, plugins, etc
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

main();
