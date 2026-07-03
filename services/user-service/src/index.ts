import { buildApp }              from './app';
import { config }                from './config';
import { createInternalClient }  from './ws/internalClient';
import { recordMatchResult }     from './services/match.service';
import { handleMatchRecorded }   from './handlers/matchRecorded';

async function main() {
  const app = await buildApp();

  const wsClient = createInternalClient({
    url:         config.GATEWAY_WS_URL,
    secret:      config.INTERNAL_SERVICE_SECRET,
    serviceName: 'user-service',
    // No healthFilePath — healthcheck is HTTP-based (port 4002/health),
    // independent of the WS connection state.
  });

  wsClient.onMessage('user:matchRecorded', (msg) => {
    void handleMatchRecorded(msg.payload, recordMatchResult);
  });

  try {
    await app.listen({ port: config.PORT, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  process.on('SIGTERM', async () => {
    wsClient.close();
    await app.close();
    process.exit(0);
  });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
