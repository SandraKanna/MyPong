import { buildServer } from './app';
import { config } from './config';
import { createInternalClient } from './ws/internalClient';

async function main() {
  const wsClient = createInternalClient({
    url:         config.GATEWAY_WS_URL,
    secret:      config.INTERNAL_SERVICE_SECRET,
    serviceName: 'match-service',
  });

  const { httpServer } = buildServer();

  await new Promise<void>((resolve) => {
    httpServer.listen(config.PORT, resolve);
  });

  console.log(`match-service health server listening on port ${config.PORT.toString()}`);

  process.on('SIGTERM', () => {
    wsClient.close();
    httpServer.close(() => { process.exit(0); });
  });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
