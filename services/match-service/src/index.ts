import { buildServer } from './app';
import { config } from './config';

async function main() {
  const { httpServer } = buildServer();

  await new Promise<void>((resolve) => {
    httpServer.listen(config.PORT, resolve);
  });

  console.log(`match-service health server listening on port ${config.PORT.toString()}`);

  process.on('SIGTERM', () => {
    httpServer.close(() => { process.exit(0); });
  });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
