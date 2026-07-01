import { config } from './config';
import { createInternalClient } from './ws/internalClient';

function main(): void {
  const wsClient = createInternalClient({
    url:            config.GATEWAY_WS_URL,
    secret:         config.INTERNAL_SERVICE_SECRET,
    serviceName:    'match-service',
    healthFilePath: '/tmp/healthy',
  });

  process.on('SIGTERM', () => {
    wsClient.close();
    process.exit(0);
  });
}

main();
